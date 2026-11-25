use crate::AppState;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;
use tauri::State;

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseAssetDto {
    pub name: String,
    pub download_url: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResultDto {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub repo: String,
    pub release_name: String,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: Option<String>,
    pub recommended_asset: Option<ReleaseAssetDto>,
    pub assets: Vec<ReleaseAssetDto>,
    pub is_portable: bool,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseApiResponse {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAssetApiResponse>,
}

#[derive(Debug, Deserialize)]
struct GithubAssetApiResponse {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

fn is_valid_github_segment(seg: &str) -> bool {
    if seg.is_empty() || seg.len() > 100 {
        return false;
    }
    if seg == "." || seg == ".." || seg.contains("..") {
        return false;
    }
    seg.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Normaliza y valida un repositorio de GitHub en formato `usuario/repositorio`
/// o URL `https://github.com/usuario/repositorio`.
/// Devuelve `Ok("")` cuando el campo está vacío (desactivar comprobación).
pub fn normalize_github_repo(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let stripped = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("https://www.github.com/"))
        .or_else(|| trimmed.strip_prefix("http://www.github.com/"))
        .or_else(|| trimmed.strip_prefix("github.com/"))
        .or_else(|| trimmed.strip_prefix("www.github.com/"))
        .unwrap_or(trimmed);

    // Rechazar URLs a otros dominios o esquemas no permitidos
    if stripped.contains("://") || stripped.contains('?') || stripped.contains('#') {
        return Err(
            "Usa únicamente un repositorio de GitHub válido en formato usuario/repositorio (ejemplo: miusuario/diskvault-finder)."
                .to_string(),
        );
    }

    let cleaned = stripped.trim_matches('/');
    let mut parts = cleaned.split('/');
    let owner = parts.next().unwrap_or("").trim();
    let repo_raw = parts.next().unwrap_or("").trim();
    let extra = parts.next();

    // Permitir rutas pegadas como /releases o /releases/latest pero rechazar caracteres raros
    if let Some(rest) = extra {
        if !rest.eq_ignore_ascii_case("releases") {
            return Err(
                "Formato de repositorio no válido. Usa usuario/repositorio (ejemplo: miusuario/diskvault-finder)."
                    .to_string(),
            );
        }
    }

    let repo = repo_raw.strip_suffix(".git").unwrap_or(repo_raw);

    if !is_valid_github_segment(owner) || !is_valid_github_segment(repo) {
        return Err(
            "El repositorio debe tener el formato usuario/repositorio con letras, números, guiones o puntos."
                .to_string(),
        );
    }

    Ok(format!("{owner}/{repo}"))
}

/// Verifica estrictamente que una URL pertenezca a GitHub sobre HTTPS y no contenga caracteres peligrosos.
pub fn validate_github_https_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 {
        return Err("La dirección del lanzamiento de GitHub no es válida.".to_string());
    }

    if trimmed
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\'' || c == '<' || c == '>')
    {
        return Err("La dirección contiene caracteres no permitidos.".to_string());
    }

    let allowed_prefixes = [
        "https://github.com/",
        "https://objects.githubusercontent.com/",
        "https://release-assets.githubusercontent.com/",
    ];

    if !allowed_prefixes.iter().any(|p| trimmed.starts_with(p)) {
        return Err(
            "Por seguridad solo se pueden abrir enlaces oficiales HTTPS de GitHub.".to_string(),
        );
    }

    Ok(trimmed.to_string())
}

fn parse_semver_parts(raw: &str) -> (Vec<u64>, Option<String>) {
    let clean = raw
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V');
    let without_build = clean.split('+').next().unwrap_or(clean);
    let mut split_pre = without_build.splitn(2, '-');
    let core = split_pre.next().unwrap_or("");
    let pre = split_pre
        .next()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());

    let nums: Vec<u64> = core
        .split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0))
        .collect();

    (nums, pre)
}

/// Compara dos versiones semánticas (`current` frente a `latest`).
/// Devuelve `Ordering::Less` si `latest` es más nueva que `current`.
pub fn compare_semver(current: &str, latest: &str) -> Ordering {
    let (cur_nums, cur_pre) = parse_semver_parts(current);
    let (lat_nums, lat_pre) = parse_semver_parts(latest);

    let max_len = cur_nums.len().max(lat_nums.len()).max(3);
    for i in 0..max_len {
        let c = *cur_nums.get(i).unwrap_or(&0);
        let l = *lat_nums.get(i).unwrap_or(&0);
        match c.cmp(&l) {
            Ordering::Equal => continue,
            non_eq => return non_eq,
        }
    }

    // Misma base numérica: una versión estable (None) es mayor que una pre-release (Some)
    match (&cur_pre, &lat_pre) {
        (None, None) => Ordering::Equal,
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (Some(c), Some(l)) => c.cmp(l),
    }
}

/// Selecciona el paquete portable (.zip) recomendado del lanzamiento de GitHub.
pub fn select_recommended_asset(
    assets: &[ReleaseAssetDto],
    _is_portable: bool,
) -> Option<ReleaseAssetDto> {
    if assets.is_empty() {
        return None;
    }

    assets
        .iter()
        .find(|a| {
            let lower = a.name.to_ascii_lowercase();
            lower.ends_with(".zip") && lower.contains("portable")
        })
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".zip"))
        })
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".exe"))
        })
        .cloned()
}

#[cfg(windows)]
fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb: Vec<u16> = OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target: Vec<u16> = OsStr::new(url)
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
            "Windows no pudo abrir el enlace de GitHub en el navegador predeterminado (código {}).",
            hinst.0 as isize
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(cmd)
        .arg(url)
        .spawn()
        .map_err(|e| format!("No se pudo abrir el enlace en el navegador: {e}"))?;
    Ok(())
}

/// Consulta la API pública de GitHub Releases para comprobar si existe una versión más reciente.
#[tauri::command]
pub async fn check_github_updates(
    repo_override: Option<String>,
    state: State<'_, AppState>,
) -> Result<UpdateCheckResultDto, String> {
    let raw_repo = match repo_override {
        Some(r) if !r.trim().is_empty() => r,
        _ => state.db.get_settings()?.github_repo,
    };

    let repo = normalize_github_repo(&raw_repo)?;
    if repo.is_empty() {
        return Err(
            "Configura primero tu repositorio de GitHub (por ejemplo: usuario/diskvault-finder)."
                .to_string(),
        );
    }

    let api_url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(format!("DiskVault-Finder/{CURRENT_VERSION}"))
        .build()
        .map_err(|e| format!("No se pudo inicializar el cliente HTTP para GitHub: {e}"))?;

    let response = client
        .get(&api_url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Tiempo de espera agotado al conectar con GitHub. Revisa tu conexión a internet."
                    .to_string()
            } else {
                "No se pudo conectar con GitHub. Verifica tu acceso a internet.".to_string()
            }
        })?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(format!(
            "No se encontró un lanzamiento publicado (Release) en github.com/{repo}. Verifica el nombre del repositorio y que exista al menos un Release público."
        ));
    }
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err(
            "GitHub limitó temporalmente las consultas desde tu red. Intenta de nuevo en unos minutos."
                .to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!(
            "GitHub devolvió una respuesta inesperada (HTTP {}).",
            status.as_u16()
        ));
    }

    let payload: GithubReleaseApiResponse = response
        .json()
        .await
        .map_err(|e| format!("No se pudo leer la respuesta de GitHub Releases: {e}"))?;

    let release_url = validate_github_https_url(&payload.html_url)
        .unwrap_or_else(|_| format!("https://github.com/{repo}/releases"));

    let assets: Vec<ReleaseAssetDto> = payload
        .assets
        .into_iter()
        .filter_map(|a| {
            let safe_url = validate_github_https_url(&a.browser_download_url).ok()?;
            Some(ReleaseAssetDto {
                name: a.name,
                download_url: safe_url,
                size_bytes: a.size,
            })
        })
        .collect();

    let is_portable = state.paths.is_portable;
    let recommended_asset = select_recommended_asset(&assets, is_portable);
    let latest_version = payload
        .tag_name
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string();

    let has_update = compare_semver(CURRENT_VERSION, &latest_version) == Ordering::Less;
    let release_name = payload
        .name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("v{latest_version}"));
    let release_notes = payload
        .body
        .map(|b| b.trim().to_string())
        .unwrap_or_default();

    Ok(UpdateCheckResultDto {
        current_version: CURRENT_VERSION.to_string(),
        latest_version,
        has_update,
        repo,
        release_name,
        release_notes,
        release_url,
        published_at: payload.published_at,
        recommended_asset,
        assets,
        is_portable,
    })
}

/// Abre una URL oficial de lanzamiento o descarga de GitHub en el navegador predeterminado.
#[tauri::command]
pub fn open_github_release_url(url: String) -> Result<(), String> {
    let safe_url = validate_github_https_url(&url)?;
    open_url_in_default_browser(&safe_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_validates_github_repo_inputs() {
        assert_eq!(normalize_github_repo("").expect("vacío válido"), "");
        assert_eq!(
            normalize_github_repo("  matk/diskvault-finder  ").expect("slug simple"),
            "matk/diskvault-finder"
        );
        assert_eq!(
            normalize_github_repo("https://github.com/matk/diskvault-finder.git")
                .expect("url completa"),
            "matk/diskvault-finder"
        );
        assert_eq!(
            normalize_github_repo("github.com/matk/diskvault-finder/releases")
                .expect("url releases"),
            "matk/diskvault-finder"
        );

        assert!(normalize_github_repo("https://evil.example/a/b").is_err());
        assert!(normalize_github_repo("owner/repo?foo=bar").is_err());
        assert!(normalize_github_repo("../etc/passwd").is_err());
        assert!(normalize_github_repo("onlyowner").is_err());
    }

    #[test]
    fn compares_semver_versions_accurately() {
        assert_eq!(compare_semver("1.0.0", "v1.0.1"), Ordering::Less);
        assert_eq!(compare_semver("1.2.0", "1.10.0"), Ordering::Less);
        assert_eq!(compare_semver("1.0.0-rc.1", "1.0.0"), Ordering::Less);
        assert_eq!(compare_semver("1.0.0", "v1.0.0"), Ordering::Equal);
        assert_eq!(compare_semver("1.2.0", "1.1.9"), Ordering::Greater);
    }

    #[test]
    fn selects_portable_zip_asset_from_release() {
        let assets = vec![
            ReleaseAssetDto {
                name: "DiskVault-Finder-1.1.0-x64-portable.zip".to_string(),
                download_url: "https://github.com/a/b/releases/download/v1.1.0/portable.zip"
                    .to_string(),
                size_bytes: 10_000_000,
            },
            ReleaseAssetDto {
                name: "SHA256SUMS.txt".to_string(),
                download_url: "https://github.com/a/b/releases/download/v1.1.0/SHA256SUMS.txt"
                    .to_string(),
                size_bytes: 256,
            },
        ];

        let portable = select_recommended_asset(&assets, true).expect("debe elegir zip portable");
        assert!(portable.name.ends_with("-portable.zip"));
    }

    #[test]
    fn validates_strict_github_https_urls() {
        assert!(validate_github_https_url("https://github.com/user/repo/releases/tag/v1.1.0").is_ok());
        assert!(validate_github_https_url("https://objects.githubusercontent.com/file.exe").is_ok());
        assert!(validate_github_https_url("http://github.com/user/repo").is_err());
        assert!(validate_github_https_url("https://evil.com/github.com/repo").is_err());
        assert!(validate_github_https_url("javascript:alert(1)").is_err());
        assert!(validate_github_https_url("https://github.com/user/repo \" --flag").is_err());
    }
}
