use crate::storage::roots::{normalize_input_path, validate_path_internal, PathValidationInfo};

/// Valida que la ruta sea UNC (`\\servidor\recurso` o subcarpeta) y devuelve
/// `(ruta_completa_normalizada, raiz_recurso_unc)`.
pub fn parse_unc_share_root(raw: &str) -> Result<(String, String), String> {
    let normalized = normalize_input_path(raw);
    if !normalized.starts_with(r"\\") {
        return Err(
            "La ruta debe tener formato de red UNC válido, por ejemplo: \\\\192.168.1.50\\Compartido"
                .to_string(),
        );
    }

    let without_prefix = normalized.trim_start_matches('\\');
    let mut parts = without_prefix.split('\\').filter(|seg| !seg.is_empty());
    let server = parts.next().unwrap_or("");
    let share = parts.next().unwrap_or("");

    if server.is_empty() || share.is_empty() {
        return Err(
            "Debes indicar servidor y carpeta compartida en formato \\\\servidor\\recurso."
                .to_string(),
        );
    }

    let share_root = format!(r"\\{server}\{share}");
    Ok((normalized, share_root))
}

/// Traduce los códigos de error Win32 más frecuentes de WNetAddConnection2W a español claro.
pub fn translate_win32_smb_error(code: u32) -> String {
    match code {
        5 => "Acceso denegado. Verifica que el usuario tenga permisos de lectura en esta carpeta compartida.".to_string(),
        53 => "No se encontró la ruta de red. Comprueba que el NAS esté encendido y que la IP o nombre del servidor sea correcto.".to_string(),
        67 => "No se encontró el nombre del recurso compartido en el servidor NAS.".to_string(),
        85 => "El recurso de red ya está asignado actualmente en Windows.".to_string(),
        86 | 1326 => "Usuario o contraseña incorrectos. Verifica las credenciales SMB del NAS.".to_string(),
        1208 => "Error de red extendido al negociar la conexión SMB con el servidor.".to_string(),
        1219 => "Windows ya tiene una sesión abierta con este servidor usando otro usuario. Cierra las conexiones previas a este NAS o deja usuario y contraseña vacíos para usar la sesión actual.".to_string(),
        1222 => "La red local no está disponible en este momento.".to_string(),
        1231 => "No se pudo alcanzar la ubicación de red. Revisa tu conexión Wi-Fi o cable Ethernet.".to_string(),
        1385 => "El usuario no tiene permisos para iniciar sesión en red en este equipo o NAS.".to_string(),
        2202 => "El nombre de usuario especificado no tiene un formato válido.".to_string(),
        _ => format!(
            "Windows no pudo conectar con el recurso compartido SMB (código de error {code})."
        ),
    }
}

#[cfg(windows)]
fn wnet_connect_share(
    share_root: &str,
    username: &str,
    password: &str,
    remember_in_windows: bool,
) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::NO_ERROR;
    use windows::Win32::NetworkManagement::WNet::{
        WNetAddConnection2W, CONNECT_UPDATE_PROFILE, NETRESOURCEW, NET_CONNECT_FLAGS,
        RESOURCETYPE_DISK,
    };

    let mut remote_wide: Vec<u16> = OsStr::new(share_root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let user_trimmed = username.trim();
    let user_wide: Option<Vec<u16>> = if user_trimmed.is_empty() {
        None
    } else {
        Some(
            OsStr::new(user_trimmed)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect(),
        )
    };

    let pass_wide: Option<Vec<u16>> = if password.is_empty() && user_trimmed.is_empty() {
        None
    } else {
        Some(
            OsStr::new(password)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect(),
        )
    };

    let net_resource = NETRESOURCEW {
        dwType: RESOURCETYPE_DISK,
        lpRemoteName: PWSTR(remote_wide.as_mut_ptr()),
        ..Default::default()
    };

    let user_ptr = match &user_wide {
        Some(buf) => PCWSTR(buf.as_ptr()),
        None => PCWSTR::null(),
    };
    let pass_ptr = match &pass_wide {
        Some(buf) => PCWSTR(buf.as_ptr()),
        None => PCWSTR::null(),
    };

    let flags = if remember_in_windows {
        CONNECT_UPDATE_PROFILE
    } else {
        NET_CONNECT_FLAGS(0)
    };

    let err = unsafe { WNetAddConnection2W(&net_resource, pass_ptr, user_ptr, flags) };
    if err != NO_ERROR {
        return Err(translate_win32_smb_error(err.0));
    }

    Ok(())
}

#[cfg(not(windows))]
fn wnet_connect_share(
    _share_root: &str,
    _username: &str,
    _password: &str,
    _remember_in_windows: bool,
) -> Result<(), String> {
    Err("La autenticación de recursos compartidos SMB mediante Windows Credential Manager solo está disponible en Windows.".to_string())
}

/// Conecta un recurso compartido SMB delegando las credenciales a Windows (`WNetAddConnection2W`).
/// Nunca almacena `username` ni `password` en SQLite, archivos ni registros.
#[tauri::command]
pub async fn connect_smb_share(
    unc_path: String,
    username: String,
    password: String,
    remember_in_windows: bool,
) -> Result<PathValidationInfo, String> {
    tokio::task::spawn_blocking(move || {
        let (full_normalized, share_root) = parse_unc_share_root(&unc_path)?;
        wnet_connect_share(&share_root, &username, &password, remember_in_windows)?;

        let mut info = validate_path_internal(&full_normalized)?;
        if info.is_accessible {
            info.message = if remember_in_windows {
                "Conexión SMB autenticada y recordada en el Administrador de credenciales de Windows."
                    .to_string()
            } else {
                "Conexión SMB autenticada correctamente para la sesión actual.".to_string()
            };
            Ok(info)
        } else {
            Err(info.message)
        }
    })
    .await
    .map_err(|e| format!("Error al conectar con el recurso SMB en segundo plano: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_unc_share_roots_and_rejects_local_paths() {
        let (full, root) =
            parse_unc_share_root(r"  \\192.168.1.50\Videos\Familia\  ").expect("UNC válido");
        assert_eq!(full, r"\\192.168.1.50\Videos\Familia");
        assert_eq!(root, r"\\192.168.1.50\Videos");

        let (full2, root2) = parse_unc_share_root(r"\\NAS-HOME\Respaldos").expect("UNC raíz");
        assert_eq!(full2, r"\\NAS-HOME\Respaldos");
        assert_eq!(root2, r"\\NAS-HOME\Respaldos");

        assert!(parse_unc_share_root(r"C:\Users\Admin").is_err());
        assert!(parse_unc_share_root(r"\\192.168.1.50").is_err());
        assert!(parse_unc_share_root("").is_err());
    }

    #[test]
    fn translates_common_smb_errors_to_spanish() {
        assert!(translate_win32_smb_error(1326).contains("incorrectos"));
        assert!(translate_win32_smb_error(53).contains("ruta de red"));
        assert!(translate_win32_smb_error(1219).contains("sesión abierta"));
        assert!(translate_win32_smb_error(5).contains("Acceso denegado"));
    }
}
