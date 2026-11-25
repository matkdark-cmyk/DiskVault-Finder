use crate::explorer::browser::validate_path_within_watched_roots;
use crate::storage::roots::normalize_input_path;
use std::path::Path;
use tauri::State;

fn ensure_authorized_existing_path(
    db: &crate::storage::db::Database,
    raw_path: &str,
) -> Result<String, String> {
    let normalized = normalize_input_path(raw_path);
    let validation = db.with_conn(|conn| {
        validate_path_within_watched_roots(conn, &normalized)
            .map_err(|msg| rusqlite::Error::ToSqlConversionFailure(msg.into()))
    });

    if let Err(err) = validation {
        let cleaned = err
            .strip_prefix("Error de base de datos SQLite: ")
            .unwrap_or(&err);
        return Err(cleaned.to_string());
    }

    if !Path::new(&normalized).exists() {
        return Err(format!(
            "No se puede abrir '{normalized}' porque el NAS está sin conexión o el elemento ya no existe."
        ));
    }

    Ok(normalized)
}

#[cfg(windows)]
fn shell_open_native(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb: Vec<u16> = OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let hinst = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    if (hinst.0 as isize) <= 32 {
        return Err(format!(
            "Windows no pudo abrir '{path}' con el programa predeterminado (código {}).",
            hinst.0 as isize
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn shell_open_native(path: &str) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(cmd)
        .arg(path)
        .spawn()
        .map_err(|e| format!("No se pudo abrir '{path}': {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn open_with_dialog_native(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new("rundll32.exe");
    cmd.raw_arg(format!("shell32.dll,OpenAs_RunDLL \"{path}\""));
    cmd.spawn().map_err(|e| {
        format!("No se pudo abrir el diálogo 'Abrir con...' de Windows para '{path}': {e}")
    })?;
    Ok(())
}

#[cfg(not(windows))]
fn open_with_dialog_native(path: &str) -> Result<(), String> {
    shell_open_native(path)
}

#[cfg(windows)]
fn reveal_in_explorer_native(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new("explorer.exe");
    cmd.raw_arg(format!("/select,\"{path}\""));
    cmd.spawn()
        .map_err(|e| format!("No se pudo abrir el Explorador de Windows para '{path}': {e}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn reveal_in_explorer_native(path: &str) -> Result<(), String> {
    let target = Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    shell_open_native(&target)
}

#[tauri::command]
pub fn open_with_default_app(
    path: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let authorized_path = ensure_authorized_existing_path(&state.db, &path)?;
    shell_open_native(&authorized_path)
}

#[tauri::command]
pub fn open_with_dialog(
    path: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let authorized_path = ensure_authorized_existing_path(&state.db, &path)?;
    if Path::new(&authorized_path).is_dir() {
        return Err("La opción 'Abrir con...' solo aplica a archivos.".to_string());
    }
    open_with_dialog_native(&authorized_path)
}

#[tauri::command]
pub fn reveal_in_windows_explorer(
    path: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let authorized_path = ensure_authorized_existing_path(&state.db, &path)?;
    reveal_in_explorer_native(&authorized_path)
}

/// Abre el Explorador de Windows seleccionando un archivo o carpeta recién copiado en el PC.
#[tauri::command]
pub fn open_pc_path_in_explorer(path: String) -> Result<(), String> {
    let normalized = normalize_input_path(&path);
    if normalized.is_empty() || !Path::new(&normalized).exists() {
        return Err("La ruta copiada en el PC ya no existe.".to_string());
    }
    reveal_in_explorer_native(&normalized)
}
