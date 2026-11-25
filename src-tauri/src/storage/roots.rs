use crate::storage::db::{AppSettings, WatchedRoot};
use crate::{parse_window_theme, AppState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapState {
    pub is_portable: bool,
    pub data_dir: String,
    pub roots: Vec<WatchedRoot>,
    pub settings: AppSettings,
    pub needs_onboarding: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathValidationInfo {
    pub normalized_path: String,
    pub suggested_name: String,
    pub is_network: bool,
    pub exists: bool,
    pub is_accessible: bool,
    pub free_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub message: String,
}

pub fn normalize_input_path(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let is_unc = trimmed.starts_with(r"\\");
    let mut normalized = trimmed.replace('/', r"\");

    if is_unc {
        let rest = normalized.trim_start_matches('\\');
        let trimmed_end = rest.trim_end_matches('\\');
        normalized = format!(r"\\{trimmed_end}");
    } else {
        // Keep drive roots like "C:\" intact while trimming redundant trailing slashes on subfolders
        let bytes = normalized.as_bytes();
        let is_drive_root =
            bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
        if is_drive_root && normalized.trim_end_matches('\\').len() == 2 {
            normalized = format!("{}:\\", normalized.chars().next().unwrap_or('C').to_ascii_uppercase());
        } else {
            normalized = normalized.trim_end_matches('\\').to_string();
        }
    }

    normalized
}

pub fn suggest_root_name(normalized_path: &str) -> String {
    let clean = normalized_path.trim_end_matches('\\');
    if clean.len() == 2 && clean.ends_with(':') {
        return format!("Disco ({clean})");
    }
    if let Some(last) = clean.rsplit('\\').find(|seg| !seg.is_empty()) {
        return last.to_string();
    }
    "Nueva ubicación".to_string()
}

pub fn detect_is_network_path(normalized_path: &str) -> bool {
    if normalized_path.starts_with(r"\\") {
        return true;
    }

    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetDriveTypeW;

        const DRIVE_REMOTE: u32 = 4;

        let bytes = normalized_path.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            let root_drive = format!("{}:\\", (bytes[0] as char).to_ascii_uppercase());
            let wide: Vec<u16> = OsStr::new(&root_drive)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
            return drive_type == DRIVE_REMOTE;
        }
    }

    false
}

pub fn query_disk_space(path: &str) -> (Option<u64>, Option<u64>) {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut free_available: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free: u64 = 0;

        let result = unsafe {
            GetDiskFreeSpaceExW(
                PCWSTR(wide.as_ptr()),
                Some(&mut free_available),
                Some(&mut total_bytes),
                Some(&mut total_free),
            )
        };

        if result.is_ok() {
            return (Some(free_available), Some(total_bytes));
        }
    }

    #[cfg(not(windows))]
    {
        let _ = path;
    }

    (None, None)
}

pub(crate) fn validate_path_internal(raw_path: &str) -> Result<PathValidationInfo, String> {
    let normalized_path = normalize_input_path(raw_path);
    if normalized_path.is_empty() {
        return Err("Debes escribir o seleccionar una ruta de carpeta válida.".to_string());
    }

    let is_network = detect_is_network_path(&normalized_path);
    let suggested_name = suggest_root_name(&normalized_path);
    let target = Path::new(&normalized_path);

    let exists = target.exists();
    if !exists {
        let message = if is_network {
            "No se pudo conectar con la ruta de red. Verifica que el NAS esté encendido y accesible desde Windows.".to_string()
        } else {
            "La carpeta especificada no existe en este equipo.".to_string()
        };
        return Ok(PathValidationInfo {
            normalized_path,
            suggested_name,
            is_network,
            exists: false,
            is_accessible: false,
            free_bytes: None,
            total_bytes: None,
            message,
        });
    }

    if !target.is_dir() {
        return Ok(PathValidationInfo {
            normalized_path,
            suggested_name,
            is_network,
            exists: true,
            is_accessible: false,
            free_bytes: None,
            total_bytes: None,
            message: "La ruta seleccionada apunta a un archivo, no a una carpeta.".to_string(),
        });
    }

    match fs::read_dir(target) {
        Ok(_) => {
            let (free_bytes, total_bytes) = query_disk_space(&normalized_path);
            let message = if is_network {
                "Conexión de red verificada correctamente.".to_string()
            } else {
                "Carpeta local verificada correctamente.".to_string()
            };
            Ok(PathValidationInfo {
                normalized_path,
                suggested_name,
                is_network,
                exists: true,
                is_accessible: true,
                free_bytes,
                total_bytes,
                message,
            })
        }
        Err(err) => Ok(PathValidationInfo {
            normalized_path,
            suggested_name,
            is_network,
            exists: true,
            is_accessible: false,
            free_bytes: None,
            total_bytes: None,
            message: format!(
                "La carpeta existe pero no se pudo leer su contenido (verifica permisos o credenciales SMB): {err}"
            ),
        }),
    }
}

#[tauri::command]
pub fn get_app_bootstrap(state: State<'_, AppState>) -> Result<BootstrapState, String> {
    let roots = state.db.list_watched_roots()?;
    let mut settings = state.db.get_settings()?;
    if state.paths.is_portable {
        settings.start_with_windows = false;
    }
    let needs_onboarding = roots.is_empty();

    Ok(BootstrapState {
        is_portable: state.paths.is_portable,
        data_dir: state.paths.data_dir.to_string_lossy().to_string(),
        roots,
        settings,
        needs_onboarding,
    })
}

#[tauri::command]
pub async fn validate_nas_or_local_path(path: String) -> Result<PathValidationInfo, String> {
    tauri::async_runtime::spawn_blocking(move || validate_path_internal(&path))
        .await
        .map_err(|e| format!("Error al comprobar la ruta en segundo plano: {e}"))?
}

#[tauri::command]
pub async fn add_watched_root(
    name: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<WatchedRoot, String> {
    let validation = tauri::async_runtime::spawn_blocking(move || validate_path_internal(&path))
        .await
        .map_err(|e| format!("Error al validar la ruta antes de agregarla: {e}"))??;

    if !validation.is_accessible {
        return Err(validation.message);
    }

    let trimmed_name = name.trim();
    let final_name = if trimmed_name.is_empty() {
        validation.suggested_name
    } else {
        trimmed_name.to_string()
    };

    state.db.insert_watched_root(
        &final_name,
        &validation.normalized_path,
        validation.is_network,
        "pending",
    )
}

#[tauri::command]
pub fn remove_watched_root(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_watched_root(id)
}

#[tauri::command]
pub fn list_watched_roots(state: State<'_, AppState>) -> Result<Vec<WatchedRoot>, String> {
    state.db.list_watched_roots()
}

#[tauri::command]
pub fn toggle_watched_root(
    id: i64,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<WatchedRoot, String> {
    state.db.set_watched_root_enabled(id, enabled)
}

#[tauri::command]
pub fn rename_watched_root(
    id: i64,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<WatchedRoot, String> {
    state.db.rename_watched_root(id, &new_name)
}

#[tauri::command]
pub fn update_theme_mode(
    mode: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let target_theme = parse_window_theme(&mode)?;
    state.db.set_setting("theme_mode", &mode)?;

    if let Some(window) = app.get_webview_window("main") {
        window
            .set_theme(target_theme)
            .map_err(|e| format!("No se pudo aplicar el tema en la ventana nativa: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_unc_and_local_paths_properly() {
        assert_eq!(
            normalize_input_path(r"  \\192.168.1.50\Respaldos\  "),
            r"\\192.168.1.50\Respaldos"
        );
        assert_eq!(normalize_input_path("z:/"), r"Z:\");
        assert_eq!(normalize_input_path(r"D:\Archivos\Videos\"), r"D:\Archivos\Videos");
    }

    #[test]
    fn suggests_clean_names_for_paths() {
        assert_eq!(suggest_root_name(r"\\192.168.1.50\Respaldos"), "Respaldos");
        assert_eq!(suggest_root_name(r"Z:\"), "Disco (Z:)");
        assert_eq!(suggest_root_name(r"D:\Peliculas"), "Peliculas");
    }

    #[test]
    fn detects_unc_as_network_path() {
        assert!(detect_is_network_path(r"\\192.168.1.50\Media"));
        assert!(!detect_is_network_path(r"C:\Users"));
    }
}
