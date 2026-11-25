use crate::storage::db::Database;
use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const SESSION_RESTORE_KEY: &str = "pending_session_restore";

pub struct UpdaterState {
    pub is_downloading: AtomicBool,
    pub cancel_flag: AtomicBool,
}

impl UpdaterState {
    pub fn new() -> Self {
        Self {
            is_downloading: AtomicBool::new(false),
            cancel_flag: AtomicBool::new(false),
        }
    }
}

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
    pub sha256_url: Option<String>,
    pub assets: Vec<ReleaseAssetDto>,
    pub is_portable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressEvent {
    pub phase: String, // "downloading" | "verifying" | "installing" | "restarting" | "cancelled" | "error"
    pub percent: u8,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
    pub speed_bps: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionSnapshotDto {
    pub workspace_mode: String,
    pub selected_root_id: Option<i64>,
    pub current_path: Option<String>,
    pub history: Vec<String>,
    pub history_index: i32,
    pub selected_item_path: Option<String>,
    pub search_query: String,
    pub search_filter: String,
    pub view_mode: String,
    pub sort_field: String,
    pub sort_direction: String,
    pub updated_from_version: String,
    pub updated_to_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallUpdateRequest {
    pub download_url: String,
    pub asset_name: String,
    pub latest_version: String,
    pub sha256_url: Option<String>,
    pub session_snapshot: SessionSnapshotDto,
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
        "https://github-releases.githubusercontent.com/",
    ];

    if !allowed_prefixes.iter().any(|p| trimmed.starts_with(p)) {
        return Err(
            "Por seguridad solo se pueden abrir o descargar enlaces oficiales HTTPS de GitHub."
                .to_string(),
        );
    }

    Ok(trimmed.to_string())
}

/// Valida y limpia el nombre del instalador descargado para evitar traversal o extensiones inválidas.
pub fn sanitize_installer_filename(raw_name: &str) -> Result<String, String> {
    let trimmed = raw_name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 160
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err("El nombre del archivo instalador no es válido.".to_string());
    }

    if !trimmed
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b' '))
    {
        return Err("El nombre del archivo instalador contiene caracteres no permitidos.".to_string());
    }

    let lower = trimmed.to_ascii_lowercase();
    if !lower.ends_with(".exe") {
        return Err(
            "La actualización automática requiere un instalador nativo de Windows (.exe)."
                .to_string(),
        );
    }

    Ok(trimmed.to_string())
}

/// Extrae el hash SHA-256 esperado para `asset_name` desde el contenido de `SHA256SUMS.txt`.
pub fn parse_expected_sha256(sums_text: &str, asset_name: &str) -> Option<String> {
    let target_lower = asset_name.trim().to_ascii_lowercase();
    for line in sums_text.lines() {
        let trimmed = line.trim().trim_start_matches('\u{feff}');
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let hash = parts.next()?;
        let file = parts.next()?.trim_start_matches('*');
        if hash.len() == 64
            && hash.bytes().all(|b| b.is_ascii_hexdigit())
            && file.to_ascii_lowercase() == target_lower
        {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

fn bytes_to_hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(out, "{b:02x}");
    }
    out
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

    match (&cur_pre, &lat_pre) {
        (None, None) => Ordering::Equal,
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (Some(c), Some(l)) => c.cmp(l),
    }
}

/// Selecciona el instalador nativo de Windows (.exe) recomendado del lanzamiento de GitHub.
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
            lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("nsis"))
        })
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".exe"))
        })
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".msi"))
        })
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".zip"))
        })
        .cloned()
}

pub fn save_session_snapshot_sync(
    db: &Database,
    snapshot: &SessionSnapshotDto,
) -> Result<(), String> {
    let json = serde_json::to_string(snapshot)
        .map_err(|e| format!("No se pudo serializar el estado de la sesión actual: {e}"))?;
    db.set_setting(SESSION_RESTORE_KEY, &json)?;
    // Asegurar que WAL quede volcado a finder.db antes de cerrar para instalar
    let _ = db.with_conn(|conn| conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);"));
    Ok(())
}

pub fn consume_session_snapshot_sync(
    db: &Database,
) -> Result<Option<SessionSnapshotDto>, String> {
    let raw: Option<String> = db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let res = stmt.query_row([SESSION_RESTORE_KEY], |row| row.get::<_, String>(0));
        match res {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })?;

    let Some(json) = raw else {
        return Ok(None);
    };
    if json.trim().is_empty() {
        return Ok(None);
    }

    // Limpiar inmediatamente para no restaurar dos veces en inicios futuros
    let _ = db.set_setting(SESSION_RESTORE_KEY, "");

    match serde_json::from_str::<SessionSnapshotDto>(&json) {
        Ok(snapshot) => Ok(Some(snapshot)),
        Err(_) => Ok(None),
    }
}

fn build_github_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("Demasiadas redirecciones al conectar con GitHub.");
        }
        let url_str = attempt.url().as_str();
        if validate_github_https_url(url_str).is_ok() {
            attempt.follow()
        } else {
            attempt.error("Redirección bloqueada: solo se permiten servidores HTTPS oficiales de GitHub.")
        }
    });

    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(redirect_policy)
        .user_agent(format!("DiskVault-Finder/{CURRENT_VERSION}"))
        .build()
        .map_err(|e| format!("No se pudo inicializar el cliente HTTP seguro: {e}"))
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

#[cfg(windows)]
const UPDATE_RUNNER_PS1: &str = r#"
param(
    [Parameter(Mandatory=$true)][int]$TargetPid,
    [Parameter(Mandatory=$true)][string]$InstallerPath,
    [Parameter(Mandatory=$true)][string]$ExePath,
    [Parameter(Mandatory=$true)][string]$NewVersion
)

$ErrorActionPreference = 'SilentlyContinue'

$form = $null
$statusLabel = $null
$bar = $null

function Set-UiStatus {
    param([string]$Text, [int]$Percent)
    if ($null -ne $statusLabel) {
        $statusLabel.Text = $Text
    }
    if ($null -ne $bar -and $Percent -ge 0 -and $Percent -le 100) {
        $bar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
        $bar.Value = $Percent
    }
    if ($null -ne $form) {
        [System.Windows.Forms.Application]::DoEvents()
    }
}

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Actualizando DiskVault Finder"
    $form.Size = New-Object System.Drawing.Size(430, 155)
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ControlBox = $false
    $form.TopMost = $true
    $form.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 250)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = "Instalando DiskVault Finder v$NewVersion"
    $titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10.5, [System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(24, 24, 24)
    $titleLabel.Location = New-Object System.Drawing.Point(20, 18)
    $titleLabel.Size = New-Object System.Drawing.Size(385, 24)
    $form.Controls.Add($titleLabel)

    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.Text = "Cerrando la versión anterior de forma segura..."
    $statusLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 90)
    $statusLabel.Location = New-Object System.Drawing.Point(20, 48)
    $statusLabel.Size = New-Object System.Drawing.Size(385, 22)
    $form.Controls.Add($statusLabel)

    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Location = New-Object System.Drawing.Point(20, 80)
    $bar.Size = New-Object System.Drawing.Size(375, 20)
    $bar.Minimum = 0
    $bar.Maximum = 100
    $bar.Value = 15
    $form.Controls.Add($bar)

    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
} catch {
    $form = $null
}

# 1. Esperar a que termine el proceso anterior de DiskVault Finder
$waited = 0
while ($waited -lt 250) {
    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (-not $proc) { break }
    Start-Sleep -Milliseconds 100
    $waited++
    if ($waited % 3 -eq 0) {
        $p = [Math]::Min(35, 15 + [int]($waited / 4))
        Set-UiStatus -Text "Cerrando la versión anterior de forma segura..." -Percent $p
    }
}

# 2. Ejecutar el instalador NSIS en modo silencioso (/S) mostrando progreso vivo
Set-UiStatus -Text "Instalando nueva versión (conservando tus carpetas y caché)..." -Percent 45
$installProc = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -PassThru
$tick = 0
while ($installProc -and -not $installProc.HasExited) {
    Start-Sleep -Milliseconds 180
    $tick++
    $pct = [Math]::Min(88, 45 + [int]($tick * 1.5))
    Set-UiStatus -Text "Instalando DiskVault Finder v$NewVersion..." -Percent $pct
}

# 3. Localizar ejecutable actualizado y reiniciar exactamente donde se dejó
Set-UiStatus -Text "Reiniciando DiskVault Finder donde lo dejaste..." -Percent 95
Start-Sleep -Milliseconds 350

$launchTarget = $null
$candidates = @(
    $ExePath,
    (Join-Path $env:LOCALAPPDATA "DiskVault Finder\DiskVault Finder.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\DiskVault Finder\DiskVault Finder.exe"),
    (Join-Path $env:LOCALAPPDATA "DiskVault Finder\diskvault-finder.exe")
)
foreach ($cand in $candidates) {
    if ($cand -and (Test-Path $cand)) {
        $launchTarget = $cand
        break
    }
}

if ($launchTarget) {
    Start-Process -FilePath $launchTarget
}

Set-UiStatus -Text "¡Actualización completada!" -Percent 100
Start-Sleep -Milliseconds 450

if ($null -ne $form) {
    $form.Close()
    $form.Dispose()
}

# 4. Limpiar archivo temporal descargado
if (Test-Path $InstallerPath) {
    Remove-Item -Path $InstallerPath -Force -ErrorAction SilentlyContinue
}
"#;

#[cfg(windows)]
fn spawn_windows_silent_updater(
    installer_path: &Path,
    new_version: &str,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let current_exe = std::env::current_exe().map_err(|e| {
        format!("No se pudo determinar la ruta del ejecutable actual para reiniciar: {e}")
    })?;
    let current_pid = std::process::id();

    let safe_version: String = new_version
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    let version_arg = if safe_version.is_empty() {
        "nueva".to_string()
    } else {
        safe_version
    };

    let script_path = installer_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("apply-update.ps1");

    fs::write(&script_path, UPDATE_RUNNER_PS1.as_bytes()).map_err(|e| {
        format!("No se pudo preparar el asistente de actualización de Windows: {e}")
    })?;

    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
    ])
    .arg(&script_path)
    .arg("-TargetPid")
    .arg(current_pid.to_string())
    .arg("-InstallerPath")
    .arg(installer_path)
    .arg("-ExePath")
    .arg(&current_exe)
    .arg("-NewVersion")
    .arg(&version_arg)
    .creation_flags(CREATE_NO_WINDOW);

    cmd.spawn()
        .map_err(|e| format!("No se pudo iniciar el proceso de instalación automática: {e}"))?;

    Ok(())
}

#[cfg(not(windows))]
fn spawn_windows_silent_updater(
    _installer_path: &Path,
    _new_version: &str,
) -> Result<(), String> {
    Err("La instalación automática con reinicio solo está disponible en Windows.".to_string())
}

fn emit_update_progress(app: &AppHandle, progress: UpdateProgressEvent) {
    let _ = app.emit("update:progress", progress);
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

    let sha256_url = assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"))
        .map(|a| a.download_url.clone());

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
        sha256_url,
        assets,
        is_portable,
    })
}

/// Descarga el instalador desde GitHub con progreso en vivo, verifica SHA-256,
/// guarda el estado exacto de la sesión actual, ejecuta el instalador silencioso
/// y reinicia DiskVault Finder automáticamente donde lo dejaste.
#[tauri::command]
pub async fn download_and_install_update(
    request: InstallUpdateRequest,
    app: AppHandle,
    state: State<'_, AppState>,
    updater_state: State<'_, Arc<UpdaterState>>,
) -> Result<(), String> {
    if updater_state
        .is_downloading
        .compare_exchange(false, true, AtomicOrdering::SeqCst, AtomicOrdering::SeqCst)
        .is_err()
    {
        return Err("Ya hay una descarga de actualización en curso.".to_string());
    }
    updater_state
        .cancel_flag
        .store(false, AtomicOrdering::SeqCst);

    struct Guard(Arc<UpdaterState>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.is_downloading.store(false, AtomicOrdering::SeqCst);
        }
    }
    let _guard = Guard(Arc::clone(updater_state.inner()));

    let download_url = validate_github_https_url(&request.download_url)?;
    let safe_filename = sanitize_installer_filename(&request.asset_name)?;
    let validated_sha_url = match &request.sha256_url {
        Some(url) if !url.trim().is_empty() => Some(validate_github_https_url(url)?),
        _ => None,
    };

    emit_update_progress(
        &app,
        UpdateProgressEvent {
            phase: "downloading".to_string(),
            percent: 0,
            bytes_downloaded: 0,
            bytes_total: 0,
            speed_bps: 0,
            message: format!("Conectando con GitHub para descargar {safe_filename}..."),
        },
    );

    let client = build_github_http_client(300)?;

    // 1. Descargar SHA256SUMS.txt si existe en el Release para verificación criptográfica
    let mut expected_sha256: Option<String> = None;
    if let Some(sha_url) = validated_sha_url {
        if let Ok(resp) = client.get(&sha_url).send().await {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    if text.len() <= 65_536 {
                        expected_sha256 = parse_expected_sha256(&text, &safe_filename);
                    }
                }
            }
        }
    }

    // 2. Descargar instalador por streaming con progreso en tiempo real
    let mut response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar la actualización desde GitHub: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub devolvió HTTP {} al descargar el instalador.",
            response.status().as_u16()
        ));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let update_dir = std::env::temp_dir().join("DiskVaultFinder-Update");
    fs::create_dir_all(&update_dir).map_err(|e| {
        format!("No se pudo crear la carpeta temporal de actualización: {e}")
    })?;
    let installer_path: PathBuf = update_dir.join(&safe_filename);

    let mut file = File::create(&installer_path).map_err(|e| {
        format!("No se pudo crear el archivo temporal del instalador: {e}")
    })?;

    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut first_two_bytes: [u8; 2] = [0; 2];
    let mut first_bytes_read: usize = 0;
    let started_at = Instant::now();
    let mut last_emit = Instant::now();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Error de red durante la descarga de la actualización: {e}"))?
    {
        if updater_state.cancel_flag.load(AtomicOrdering::SeqCst) {
            drop(file);
            let _ = fs::remove_file(&installer_path);
            emit_update_progress(
                &app,
                UpdateProgressEvent {
                    phase: "cancelled".to_string(),
                    percent: 0,
                    bytes_downloaded: downloaded,
                    bytes_total: total_bytes,
                    speed_bps: 0,
                    message: "Actualización cancelada.".to_string(),
                },
            );
            return Err("Actualización cancelada por el usuario.".to_string());
        }

        if first_bytes_read < 2 {
            for &b in chunk.iter() {
                if first_bytes_read < 2 {
                    first_two_bytes[first_bytes_read] = b;
                    first_bytes_read += 1;
                } else {
                    break;
                }
            }
        }

        file.write_all(&chunk).map_err(|e| {
            let _ = fs::remove_file(&installer_path);
            format!("No se pudo escribir el instalador descargado en disco: {e}")
        })?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(120) {
            let elapsed_secs = started_at.elapsed().as_secs_f64().max(0.05);
            let speed_bps = (downloaded as f64 / elapsed_secs) as u64;
            let pct = if total_bytes > 0 {
                ((downloaded.saturating_mul(85)) / total_bytes).min(85) as u8
            } else {
                40
            };
            emit_update_progress(
                &app,
                UpdateProgressEvent {
                    phase: "downloading".to_string(),
                    percent: pct,
                    bytes_downloaded: downloaded,
                    bytes_total: total_bytes,
                    speed_bps,
                    message: format!("Descargando DiskVault Finder v{}...", request.latest_version),
                },
            );
            last_emit = Instant::now();
        }
    }

    file.flush()
        .map_err(|e| format!("No se pudo finalizar la escritura del instalador: {e}"))?;
    drop(file);

    // 3. Verificación de integridad (cabecera ejecutable Windows MZ + SHA-256)
    emit_update_progress(
        &app,
        UpdateProgressEvent {
            phase: "verifying".to_string(),
            percent: 90,
            bytes_downloaded: downloaded,
            bytes_total: total_bytes.max(downloaded),
            speed_bps: 0,
            message: "Verificando integridad SHA-256 del instalador...".to_string(),
        },
    );

    if downloaded < 1024 || first_two_bytes != [b'M', b'Z'] {
        let _ = fs::remove_file(&installer_path);
        return Err(
            "El archivo descargado no es un instalador ejecutable válido de Windows.".to_string(),
        );
    }

    let actual_sha256 = bytes_to_hex_lower(&hasher.finalize());
    if let Some(expected) = expected_sha256 {
        if actual_sha256 != expected {
            let _ = fs::remove_file(&installer_path);
            return Err(
                "La verificación SHA-256 falló: el archivo descargado no coincide con SHA256SUMS.txt. Se canceló la instalación por seguridad."
                    .to_string(),
            );
        }
    }

    // 4. Guardar exactamente dónde estaba el usuario (carpeta, búsqueda, vista, orden) y volcar SQLite
    emit_update_progress(
        &app,
        UpdateProgressEvent {
            phase: "installing".to_string(),
            percent: 95,
            bytes_downloaded: downloaded,
            bytes_total: total_bytes.max(downloaded),
            speed_bps: 0,
            message: "Guardando tu sesión actual y preparando la instalación...".to_string(),
        },
    );

    save_session_snapshot_sync(&state.db, &request.session_snapshot)?;

    // 5. Lanzar el asistente silencioso que instala y reinicia DiskVault Finder automáticamente
    spawn_windows_silent_updater(&installer_path, &request.latest_version)?;

    emit_update_progress(
        &app,
        UpdateProgressEvent {
            phase: "restarting".to_string(),
            percent: 100,
            bytes_downloaded: downloaded,
            bytes_total: total_bytes.max(downloaded),
            speed_bps: 0,
            message: "Reiniciando para completar la instalación...".to_string(),
        },
    );

    // Permitir cierre limpio sin quedar atrapado en la bandeja del sistema
    state.is_quitting.store(true, AtomicOrdering::SeqCst);
    let app_to_exit = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(350)).await;
        app_to_exit.exit(0);
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_update_download(updater_state: State<'_, Arc<UpdaterState>>) {
    updater_state
        .cancel_flag
        .store(true, AtomicOrdering::SeqCst);
}

#[tauri::command]
pub fn save_session_for_update(
    snapshot: SessionSnapshotDto,
    state: State<'_, AppState>,
) -> Result<(), String> {
    save_session_snapshot_sync(&state.db, &snapshot)
}

#[tauri::command]
pub fn consume_pending_session_restore(
    state: State<'_, AppState>,
) -> Result<Option<SessionSnapshotDto>, String> {
    consume_session_snapshot_sync(&state.db)
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
    fn selects_native_windows_installer_from_release() {
        let assets = vec![
            ReleaseAssetDto {
                name: "DiskVault-Finder-1.1.0-x64-setup.exe".to_string(),
                download_url: "https://github.com/a/b/releases/download/v1.1.0/setup.exe"
                    .to_string(),
                size_bytes: 12_000_000,
            },
            ReleaseAssetDto {
                name: "SHA256SUMS.txt".to_string(),
                download_url: "https://github.com/a/b/releases/download/v1.1.0/SHA256SUMS.txt"
                    .to_string(),
                size_bytes: 256,
            },
        ];

        let installer =
            select_recommended_asset(&assets, false).expect("debe elegir instalador .exe");
        assert!(installer.name.ends_with("-setup.exe"));
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

    #[test]
    fn sanitizes_installer_filenames_and_parses_sha256sums() {
        assert_eq!(
            sanitize_installer_filename("DiskVault-Finder-1.1.0-x64-setup.exe").unwrap(),
            "DiskVault-Finder-1.1.0-x64-setup.exe"
        );
        assert!(sanitize_installer_filename("..\\evil.exe").is_err());
        assert!(sanitize_installer_filename("archive.zip").is_err());
        assert!(sanitize_installer_filename("a/b.exe").is_err());

        let sums = "\u{feff}0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  DiskVault-Finder-1.1.0-x64-setup.exe\n";
        assert_eq!(
            parse_expected_sha256(sums, "DiskVault-Finder-1.1.0-x64-setup.exe").as_deref(),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        );
        assert!(parse_expected_sha256(sums, "other.exe").is_none());
    }

    #[test]
    fn saves_and_consumes_session_restore_snapshot_once() {
        let db = Database::open_in_memory().expect("debe abrir BD en memoria");
        let snap = SessionSnapshotDto {
            workspace_mode: "browse".to_string(),
            selected_root_id: Some(2),
            current_path: Some(r"\\192.168.1.50\Videos\Familia".to_string()),
            history: vec![
                r"\\192.168.1.50\Videos".to_string(),
                r"\\192.168.1.50\Videos\Familia".to_string(),
            ],
            history_index: 1,
            selected_item_path: Some(r"\\192.168.1.50\Videos\Familia\clip.mp4".to_string()),
            search_query: String::new(),
            search_filter: "all".to_string(),
            view_mode: "grid".to_string(),
            sort_field: "modified".to_string(),
            sort_direction: "desc".to_string(),
            updated_from_version: "1.0.0".to_string(),
            updated_to_version: "1.1.0".to_string(),
        };

        save_session_snapshot_sync(&db, &snap).expect("debe guardar sesión");
        let restored = consume_session_snapshot_sync(&db)
            .expect("debe leer sesión")
            .expect("debe existir sesión pendiente");
        assert_eq!(restored, snap);

        let second = consume_session_snapshot_sync(&db).expect("segunda lectura limpia");
        assert!(second.is_none());
    }
}
