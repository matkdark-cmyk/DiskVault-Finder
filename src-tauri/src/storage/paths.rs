use std::fs;
use std::path::{Path, PathBuf};

pub const PORTABLE_FLAG_FILE: &str = "portable.flag";
pub const APP_FOLDER_NAME: &str = "DiskVaultFinder";
pub const DB_FILE_NAME: &str = "finder.db";

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub is_portable: bool,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
}

pub fn resolve_app_paths() -> Result<AppPaths, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("No se pudo determinar la ruta del ejecutable actual: {e}"))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "No se pudo obtener la carpeta del ejecutable actual.".to_string())?;

    let installed_base = dirs::config_dir().ok_or_else(|| {
        "No se pudo localizar la carpeta de configuración del usuario (%APPDATA%).".to_string()
    })?;

    resolve_paths_with_dirs(exe_dir, &installed_base)
}

pub fn resolve_paths_with_dirs(exe_dir: &Path, installed_base: &Path) -> Result<AppPaths, String> {
    let is_portable = exe_dir.join(PORTABLE_FLAG_FILE).exists();
    let data_dir = if is_portable {
        exe_dir.join("data")
    } else {
        installed_base.join(APP_FOLDER_NAME)
    };

    fs::create_dir_all(&data_dir).map_err(|e| {
        format!(
            "No se pudo crear la carpeta de datos '{}': {e}",
            data_dir.display()
        )
    })?;

    let db_path = data_dir.join(DB_FILE_NAME);
    Ok(AppPaths {
        is_portable,
        data_dir,
        db_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj del sistema inválido")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("diskvault_finder_{label}_{nanos}"));
        fs::create_dir_all(&dir).expect("debe crear carpeta temporal");
        dir
    }

    #[test]
    fn detects_portable_mode_when_flag_exists() {
        let exe_dir = unique_temp_dir("portable_exe");
        let appdata_dir = unique_temp_dir("portable_appdata");
        fs::write(exe_dir.join(PORTABLE_FLAG_FILE), b"").expect("debe crear portable.flag");

        let resolved =
            resolve_paths_with_dirs(&exe_dir, &appdata_dir).expect("debe resolver modo portable");
        assert!(resolved.is_portable);
        assert_eq!(resolved.data_dir, exe_dir.join("data"));
        assert_eq!(resolved.db_path, exe_dir.join("data").join(DB_FILE_NAME));
        assert!(resolved.data_dir.exists());

        let _ = fs::remove_dir_all(&exe_dir);
        let _ = fs::remove_dir_all(&appdata_dir);
    }

    #[test]
    fn uses_appdata_when_portable_flag_is_absent() {
        let exe_dir = unique_temp_dir("installed_exe");
        let appdata_dir = unique_temp_dir("installed_appdata");

        let resolved =
            resolve_paths_with_dirs(&exe_dir, &appdata_dir).expect("debe resolver modo instalado");
        assert!(!resolved.is_portable);
        assert_eq!(resolved.data_dir, appdata_dir.join(APP_FOLDER_NAME));
        assert_eq!(
            resolved.db_path,
            appdata_dir.join(APP_FOLDER_NAME).join(DB_FILE_NAME)
        );
        assert!(resolved.data_dir.exists());

        let _ = fs::remove_dir_all(&exe_dir);
        let _ = fs::remove_dir_all(&appdata_dir);
    }
}
