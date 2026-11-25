use crate::storage::db::{Database, FinderSettings};
use crate::storage::updater::normalize_github_repo;
use crate::{parse_window_theme, AppState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

const VALID_AUTO_REFRESH_HOURS: &[u32] = &[0, 1, 3, 6, 12, 24];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStatsDto {
    pub is_portable: bool,
    pub data_dir: String,
    pub db_path: String,
    pub db_size_bytes: u64,
    pub total_roots: i64,
    pub enabled_roots: i64,
    pub total_entries: i64,
    pub total_files: i64,
    pub total_dirs: i64,
    pub total_indexed_bytes: i64,
    pub last_indexed_at: Option<String>,
}

/// Valida y normaliza `FinderSettings`.
/// Regla portable innegociable: cuando `is_portable == true`, `start_with_windows` se fuerza siempre a `false`.
pub fn validate_and_normalize_settings(
    mut settings: FinderSettings,
    is_portable: bool,
) -> Result<FinderSettings, String> {
    parse_window_theme(&settings.theme_mode)?;

    if !VALID_AUTO_REFRESH_HOURS.contains(&settings.auto_refresh_hours) {
        return Err(format!(
            "Intervalo de actualización no válido: {} h. Valores permitidos: 0, 1, 3, 6, 12 o 24 horas.",
            settings.auto_refresh_hours
        ));
    }

    match settings.default_search_filter.as_str() {
        "all" | "file" | "video" | "folder" => {}
        other => {
            return Err(format!(
                "Filtro predeterminado no válido: '{other}'. Usa 'all', 'file', 'video' o 'folder'."
            ));
        }
    }

    match settings.default_view_mode.as_str() {
        "list" | "grid" => {}
        other => {
            return Err(format!(
                "Modo de vista predeterminado no válido: '{other}'. Usa 'list' o 'grid'."
            ));
        }
    }

    settings.github_repo = normalize_github_repo(&settings.github_repo)?;

    if is_portable {
        settings.start_with_windows = false;
    }

    Ok(settings)
}

/// Gestiona exclusivamente `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\DiskVaultFinder`.
/// En modo portable nunca escribe ni modifica el Registro de Windows.
pub fn sync_windows_startup_registry(
    is_portable: bool,
    start_with_windows: bool,
    start_minimized_to_tray: bool,
) -> Result<(), String> {
    if is_portable {
        return Ok(());
    }

    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run_key, _) = hkcu
            .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
            .map_err(|e| format!("No se pudo acceder a la clave de inicio de Windows: {e}"))?;

        if start_with_windows {
            let exe = std::env::current_exe().map_err(|e| {
                format!("No se pudo determinar la ubicación del ejecutable actual: {e}")
            })?;
            let exe_str = exe.to_string_lossy();
            let command = if start_minimized_to_tray {
                format!("\"{exe_str}\" --minimized")
            } else {
                format!("\"{exe_str}\"")
            };
            run_key
                .set_value("DiskVaultFinder", &command)
                .map_err(|e| {
                    format!("No se pudo registrar DiskVault Finder para iniciar con Windows: {e}")
                })?;
        } else if let Err(err) = run_key.delete_value("DiskVaultFinder") {
            if err.kind() != std::io::ErrorKind::NotFound {
                return Err(format!(
                    "No se pudo quitar la entrada de inicio automático de Windows: {err}"
                ));
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (start_with_windows, start_minimized_to_tray);
    }

    Ok(())
}

fn open_folder_native(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Err(format!(
            "La carpeta de datos '{}' no existe.",
            dir.display()
        ));
    }

    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(dir)
            .spawn()
            .map_err(|e| {
                format!(
                    "No se pudo abrir la carpeta de datos en el Explorador de Windows: {e}"
                )
            })?;
    }

    #[cfg(not(windows))]
    {
        let cmd = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        std::process::Command::new(cmd)
            .arg(dir)
            .spawn()
            .map_err(|e| format!("No se pudo abrir la carpeta de datos: {e}"))?;
    }

    Ok(())
}

fn compute_db_file_size(db_path: &Path) -> u64 {
    let mut total = fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);
    // Incluir WAL si existe para reflejar el espacio real en disco
    let wal_path = Path::new(&format!("{}-wal", db_path.to_string_lossy())).to_path_buf();
    total = total.saturating_add(fs::metadata(wal_path).map(|m| m.len()).unwrap_or(0));
    total
}

pub fn build_cache_stats(
    db: &Database,
    is_portable: bool,
    data_dir: &Path,
    db_path: &Path,
) -> Result<CacheStatsDto, String> {
    let (
        total_roots,
        enabled_roots,
        total_entries,
        total_files,
        total_dirs,
        total_indexed_bytes,
        last_indexed_at,
    ) = db.query_cache_counts()?;

    Ok(CacheStatsDto {
        is_portable,
        data_dir: data_dir.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        db_size_bytes: compute_db_file_size(db_path),
        total_roots,
        enabled_roots,
        total_entries,
        total_files,
        total_dirs,
        total_indexed_bytes,
        last_indexed_at,
    })
}

#[tauri::command]
pub fn get_finder_settings(state: State<'_, AppState>) -> Result<FinderSettings, String> {
    let mut settings = state.db.get_settings()?;
    if state.paths.is_portable {
        settings.start_with_windows = false;
    }
    Ok(settings)
}

#[tauri::command]
pub fn update_finder_settings(
    settings: FinderSettings,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FinderSettings, String> {
    let normalized = validate_and_normalize_settings(settings, state.paths.is_portable)?;

    sync_windows_startup_registry(
        state.paths.is_portable,
        normalized.start_with_windows,
        normalized.start_minimized_to_tray,
    )?;

    state.db.save_settings(&normalized)?;

    if let Some(window) = app.get_webview_window("main") {
        let target_theme = parse_window_theme(&normalized.theme_mode)?;
        let _ = window.set_theme(target_theme);
    }

    // Despertar inmediatamente al scheduler para aplicar el nuevo intervalo sin reiniciar
    state.scheduler_notify.notify_one();

    Ok(normalized)
}

#[tauri::command]
pub fn reset_finder_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FinderSettings, String> {
    let defaults = FinderSettings::default();
    update_finder_settings(defaults, app, state)
}

#[tauri::command]
pub fn open_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    open_folder_native(&state.paths.data_dir)
}

#[tauri::command]
pub fn get_cache_stats(state: State<'_, AppState>) -> Result<CacheStatsDto, String> {
    build_cache_stats(
        &state.db,
        state.paths.is_portable,
        &state.paths.data_dir,
        &state.paths.db_path,
    )
}

#[tauri::command]
pub async fn vacuum_cache_db(state: State<'_, AppState>) -> Result<CacheStatsDto, String> {
    let db = std::sync::Arc::clone(&state.db);
    let is_portable = state.paths.is_portable;
    let data_dir = state.paths.data_dir.clone();
    let db_path = state.paths.db_path.clone();

    tokio::task::spawn_blocking(move || {
        db.optimize_and_vacuum()?;
        build_cache_stats(&db, is_portable, &data_dir, &db_path)
    })
    .await
    .map_err(|e| format!("Error al compactar la base de datos en segundo plano: {e}"))?
}

#[tauri::command]
pub async fn clear_all_cache(state: State<'_, AppState>) -> Result<CacheStatsDto, String> {
    let db = std::sync::Arc::clone(&state.db);
    let is_portable = state.paths.is_portable;
    let data_dir = state.paths.data_dir.clone();
    let db_path = state.paths.db_path.clone();

    tokio::task::spawn_blocking(move || {
        db.clear_all_indexed_entries()?;
        db.optimize_and_vacuum()?;
        build_cache_stats(&db, is_portable, &data_dir, &db_path)
    })
    .await
    .map_err(|e| format!("Error al vaciar el caché local: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::IndexedEntryDraft;
    use std::path::PathBuf;

    #[test]
    fn portable_mode_always_forces_start_with_windows_false() {
        let mut s = FinderSettings::default();
        s.start_with_windows = true;
        s.auto_refresh_hours = 6;

        let portable_res =
            validate_and_normalize_settings(s.clone(), true).expect("debe validar en portable");
        assert!(!portable_res.start_with_windows);
        assert_eq!(portable_res.auto_refresh_hours, 6);

        let installed_res =
            validate_and_normalize_settings(s, false).expect("debe validar en instalado");
        assert!(installed_res.start_with_windows);
    }

    #[test]
    fn rejects_invalid_intervals_and_filters() {
        let mut s = FinderSettings::default();
        s.auto_refresh_hours = 5;
        assert!(validate_and_normalize_settings(s, false).is_err());

        let mut s2 = FinderSettings::default();
        s2.default_search_filter = "unknown".to_string();
        assert!(validate_and_normalize_settings(s2, false).is_err());

        let mut s3 = FinderSettings::default();
        s3.default_view_mode = "cards".to_string();
        assert!(validate_and_normalize_settings(s3, false).is_err());
    }

    #[test]
    fn cache_stats_clear_and_vacuum_work_cleanly() {
        let db = Database::open_in_memory().expect("debe abrir BD en memoria");
        let root = db
            .insert_watched_root("NAS", r"\\192.168.1.50\Media", true, "ready")
            .expect("debe crear raíz");
        db.replace_root_entries(
            root.id,
            &[IndexedEntryDraft {
                parent_path: r"\\192.168.1.50\Media".to_string(),
                full_path: r"\\192.168.1.50\Media\clip.mp4".to_string(),
                name: "clip.mp4".to_string(),
                extension: "mp4".to_string(),
                category: "video".to_string(),
                is_dir: false,
                size_bytes: 2048,
                modified_ts: 1_735_000_000,
            }],
        )
        .expect("debe cargar entradas");

        let stats = build_cache_stats(&db, true, &PathBuf::from("."), &PathBuf::from("finder.db"))
            .expect("debe calcular estadísticas");
        assert_eq!(stats.total_roots, 1);
        assert_eq!(stats.total_files, 1);
        assert_eq!(stats.total_indexed_bytes, 2048);

        db.clear_all_indexed_entries().expect("debe limpiar caché");
        db.optimize_and_vacuum().expect("debe compactar BD");

        let after = build_cache_stats(&db, true, &PathBuf::from("."), &PathBuf::from("finder.db"))
            .expect("debe recalcular tras limpiar");
        assert_eq!(after.total_roots, 1);
        assert_eq!(after.total_entries, 0);
        assert_eq!(after.total_indexed_bytes, 0);
    }
}
