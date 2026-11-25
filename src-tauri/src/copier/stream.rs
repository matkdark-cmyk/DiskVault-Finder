use crate::explorer::browser::validate_path_within_watched_roots;
use crate::storage::db::Database;
use crate::storage::roots::{normalize_input_path, query_disk_space};
use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime, State};

const COPY_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const SAFETY_HEADROOM_BYTES: u64 = 50 * 1024 * 1024;
const PROGRESS_EMIT_INTERVAL_MS: u128 = 150;
const SMB_RETRY_DELAYS_SECS: [u64; 2] = [1, 3];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConflictPolicy {
    KeepBoth,
    Overwrite,
    Skip,
}

impl Default for ConflictPolicy {
    fn default() -> Self {
        Self::KeepBoth
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PcQuickFoldersDto {
    pub desktop_dir: Option<String>,
    pub downloads_dir: Option<String>,
    pub documents_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyPreflightDto {
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_bytes: u64,
    pub conflicting_names: Vec<String>,
    pub dest_free_bytes: Option<u64>,
    pub dest_total_bytes: Option<u64>,
    pub has_enough_space: bool,
    pub quick_folders: PcQuickFoldersDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyToPcRequest {
    pub source_paths: Vec<String>,
    pub dest_dir: String,
    #[serde(default)]
    pub conflict_policy: ConflictPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyProgressEvent {
    pub job_id: String,
    pub current_file: String,
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub speed_bps: u64,
    pub eta_seconds: Option<u64>,
    pub is_paused: bool,
    pub status: String,
    pub dest_dir: String,
    pub first_output_path: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyJobResultDto {
    pub job_id: String,
    pub status: String,
    pub files_copied: u64,
    pub files_skipped: u64,
    pub bytes_copied: u64,
    pub dest_dir: String,
    pub first_output_path: Option<String>,
}

pub struct CopierState {
    pub is_running: AtomicBool,
    pub pause_flag: Arc<AtomicBool>,
    pub cancel_flag: Arc<AtomicBool>,
    last_progress: Mutex<Option<CopyProgressEvent>>,
}

impl Default for CopierState {
    fn default() -> Self {
        Self::new()
    }
}

impl CopierState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            pause_flag: Arc::new(AtomicBool::new(false)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            last_progress: Mutex::new(None),
        }
    }

    pub fn set_paused(&self, paused: bool) {
        self.pause_flag.store(paused, Ordering::SeqCst);
    }

    pub fn request_cancel(&self) {
        if self.is_running.load(Ordering::SeqCst) {
            self.cancel_flag.store(true, Ordering::SeqCst);
            self.pause_flag.store(false, Ordering::SeqCst);
        }
    }

    fn store_progress(&self, ev: CopyProgressEvent) {
        if let Ok(mut guard) = self.last_progress.lock() {
            *guard = Some(ev);
        }
    }
}

pub fn build_pc_quick_folders() -> PcQuickFoldersDto {
    PcQuickFoldersDto {
        desktop_dir: dirs::desktop_dir().map(|p| p.to_string_lossy().to_string()),
        downloads_dir: dirs::download_dir().map(|p| p.to_string_lossy().to_string()),
        documents_dir: dirs::document_dir().map(|p| p.to_string_lossy().to_string()),
    }
}

fn path_to_os(normalized: &str) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(normalized)
    }
    #[cfg(not(windows))]
    {
        if normalized.starts_with('\\') && !normalized.starts_with(r"\\") {
            PathBuf::from(normalized.replace('\\', "/"))
        } else {
            PathBuf::from(normalized)
        }
    }
}

fn validate_sources(db: &Database, source_paths: &[String]) -> Result<Vec<PathBuf>, String> {
    if source_paths.is_empty() {
        return Err("Debes seleccionar al menos un archivo o carpeta para copiar.".to_string());
    }

    let mut validated = Vec::with_capacity(source_paths.len());
    for raw in source_paths {
        let normalized = normalize_input_path(raw);
        let check = db.with_conn(|conn| {
            validate_path_within_watched_roots(conn, &normalized)
                .map_err(|msg| rusqlite::Error::ToSqlConversionFailure(msg.into()))
        });
        if let Err(err) = check {
            let cleaned = err
                .strip_prefix("Error de base de datos SQLite: ")
                .unwrap_or(&err);
            return Err(cleaned.to_string());
        }

        let os_path = path_to_os(&normalized);
        if !os_path.exists() {
            return Err(format!(
                "No se puede copiar '{normalized}' porque el NAS está sin conexión o el elemento ya no existe."
            ));
        }
        validated.push(os_path);
    }

    Ok(validated)
}

#[derive(Debug, Clone)]
struct PlannedFileCopy {
    src: PathBuf,
    dst: PathBuf,
    display_name: String,
    size_bytes: u64,
}

/// Genera un nombre alternativo no colisionante: `archivo (1).mp4` o `carpeta (1)`.
pub fn resolve_keep_both_path(target: &Path, is_dir: bool) -> PathBuf {
    if !target.exists() {
        return target.to_path_buf();
    }

    let parent = target.parent().unwrap_or_else(|| Path::new(""));
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "copia".to_string());

    let (stem, ext) = if is_dir {
        (file_name, String::new())
    } else {
        match file_name.rfind('.') {
            Some(idx) if idx > 0 => (file_name[..idx].to_string(), file_name[idx..].to_string()),
            _ => (file_name, String::new()),
        }
    };

    for counter in 1..=9999_u32 {
        let candidate_name = format!("{stem} ({counter}){ext}");
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    parent.join(format!("{stem} ({ts}){ext}"))
}

fn build_temp_path(final_dest: &Path) -> PathBuf {
    let mut os_name: OsString = final_dest
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| OsString::from("archivo"));
    os_name.push(".dvtmp");
    final_dest.with_file_name(os_name)
}

fn plan_copy_operations(
    sources: &[PathBuf],
    dest_dir: &Path,
    policy: ConflictPolicy,
) -> Result<(Vec<PathBuf>, Vec<PlannedFileCopy>, u64, Option<String>), String> {
    let mut dirs_to_create: Vec<PathBuf> = Vec::new();
    let mut files_to_copy: Vec<PlannedFileCopy> = Vec::new();
    let mut files_skipped: u64 = 0;
    let mut first_output_path: Option<String> = None;

    for src in sources {
        let base_name = src
            .file_name()
            .ok_or_else(|| format!("Ruta de origen inválida: '{}'", src.display()))?;
        let initial_dest = dest_dir.join(base_name);

        if src.is_dir() {
            let root_dest = match policy {
                ConflictPolicy::KeepBoth => resolve_keep_both_path(&initial_dest, true),
                ConflictPolicy::Overwrite | ConflictPolicy::Skip => initial_dest,
            };

            if first_output_path.is_none() {
                first_output_path = Some(root_dest.to_string_lossy().to_string());
            }

            dirs_to_create.push(root_dest.clone());

            for entry_res in WalkDir::new(src).skip_hidden(false).follow_links(false) {
                let entry = entry_res.map_err(|e| {
                    format!("Error al recorrer la carpeta '{}': {e}", src.display())
                })?;
                if entry.depth == 0 {
                    continue;
                }
                let entry_path = entry.path();
                let rel = entry_path.strip_prefix(src).map_err(|e| {
                    format!("Error al calcular ruta relativa de '{}': {e}", entry_path.display())
                })?;
                let target_path = root_dest.join(rel);

                if entry.file_type().is_dir() {
                    dirs_to_create.push(target_path);
                } else {
                    if target_path.exists() && policy == ConflictPolicy::Skip {
                        files_skipped += 1;
                        continue;
                    }
                    let resolved_dst = match policy {
                        ConflictPolicy::KeepBoth => resolve_keep_both_path(&target_path, false),
                        ConflictPolicy::Overwrite | ConflictPolicy::Skip => target_path,
                    };
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    let display_name = entry.file_name().to_string_lossy().to_string();
                    files_to_copy.push(PlannedFileCopy {
                        src: entry_path,
                        dst: resolved_dst,
                        display_name,
                        size_bytes: size,
                    });
                }
            }
        } else {
            if initial_dest.exists() && policy == ConflictPolicy::Skip {
                files_skipped += 1;
                if first_output_path.is_none() {
                    first_output_path = Some(initial_dest.to_string_lossy().to_string());
                }
                continue;
            }
            let resolved_dst = match policy {
                ConflictPolicy::KeepBoth => resolve_keep_both_path(&initial_dest, false),
                ConflictPolicy::Overwrite | ConflictPolicy::Skip => initial_dest,
            };
            if first_output_path.is_none() {
                first_output_path = Some(resolved_dst.to_string_lossy().to_string());
            }
            let size = fs::metadata(src).map(|m| m.len()).unwrap_or(0);
            let display_name = base_name.to_string_lossy().to_string();
            files_to_copy.push(PlannedFileCopy {
                src: src.clone(),
                dst: resolved_dst,
                display_name,
                size_bytes: size,
            });
        }
    }

    Ok((dirs_to_create, files_to_copy, files_skipped, first_output_path))
}

pub fn preflight_copy_sync(
    db: &Database,
    source_paths: &[String],
    raw_dest_dir: &str,
) -> Result<CopyPreflightDto, String> {
    let sources = validate_sources(db, source_paths)?;
    let dest_trimmed = raw_dest_dir.trim();
    let dest_path = if dest_trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(dest_trimmed))
    };

    let mut total_files: u64 = 0;
    let mut total_dirs: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut conflicting_names: Vec<String> = Vec::new();

    for src in &sources {
        if let (Some(dest), Some(name)) = (&dest_path, src.file_name()) {
            if dest.join(name).exists() {
                conflicting_names.push(name.to_string_lossy().to_string());
            }
        }

        if src.is_dir() {
            total_dirs += 1;
            for entry_res in WalkDir::new(src).skip_hidden(false).follow_links(false) {
                let entry = match entry_res {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                if entry.depth == 0 {
                    continue;
                }
                if entry.file_type().is_dir() {
                    total_dirs += 1;
                } else {
                    total_files += 1;
                    if let Ok(meta) = entry.metadata() {
                        total_bytes = total_bytes.saturating_add(meta.len());
                    }
                }
            }
        } else {
            total_files += 1;
            if let Ok(meta) = fs::metadata(src) {
                total_bytes = total_bytes.saturating_add(meta.len());
            }
        }
    }

    let (dest_free_bytes, dest_total_bytes) = match &dest_path {
        Some(p) if p.exists() => query_disk_space(&p.to_string_lossy()),
        _ => (None, None),
    };

    let has_enough_space = match dest_free_bytes {
        Some(free) => free >= total_bytes.saturating_add(SAFETY_HEADROOM_BYTES),
        None => true,
    };

    Ok(CopyPreflightDto {
        total_files,
        total_dirs,
        total_bytes,
        conflicting_names,
        dest_free_bytes,
        dest_total_bytes,
        has_enough_space,
        quick_folders: build_pc_quick_folders(),
    })
}

fn read_chunk_with_smb_retry(
    src_path: &Path,
    reader: &mut File,
    offset: u64,
    buf: &mut [u8],
    cancel_flag: &AtomicBool,
) -> Result<usize, std::io::Error> {
    let mut attempt = 0;
    loop {
        match reader.read(buf) {
            Ok(n) => return Ok(n),
            Err(err) => {
                if attempt >= SMB_RETRY_DELAYS_SECS.len() || cancel_flag.load(Ordering::SeqCst) {
                    return Err(err);
                }
                let wait_secs = SMB_RETRY_DELAYS_SECS[attempt];
                attempt += 1;

                // Dormir en incrementos cortos para responder rápido a cancelaciones
                for _ in 0..(wait_secs * 10) {
                    if cancel_flag.load(Ordering::SeqCst) {
                        return Err(err);
                    }
                    thread::sleep(Duration::from_millis(100));
                }

                // Reabrir y posicionarse en el byte exacto tras microcorte SMB
                let mut reopened = File::open(src_path)?;
                reopened.seek(SeekFrom::Start(offset))?;
                *reader = reopened;
            }
        }
    }
}

pub fn execute_copy_job_sync<F>(
    sources: &[PathBuf],
    dest_dir: &Path,
    policy: ConflictPolicy,
    pause_flag: &AtomicBool,
    cancel_flag: &AtomicBool,
    mut on_progress: F,
) -> Result<CopyJobResultDto, String>
where
    F: FnMut(CopyProgressEvent),
{
    if !dest_dir.exists() || !dest_dir.is_dir() {
        return Err(format!(
            "La carpeta destino '{}' no existe en el PC.",
            dest_dir.display()
        ));
    }

    let job_id = format!(
        "copy-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let dest_dir_str = dest_dir.to_string_lossy().to_string();

    let (dirs_to_create, files_to_copy, files_skipped, first_output_path) =
        plan_copy_operations(sources, dest_dir, policy)?;

    for dir in &dirs_to_create {
        if cancel_flag.load(Ordering::SeqCst) {
            on_progress(CopyProgressEvent {
                job_id: job_id.clone(),
                current_file: String::new(),
                files_done: 0,
                files_total: files_to_copy.len() as u64,
                bytes_done: 0,
                bytes_total: 0,
                speed_bps: 0,
                eta_seconds: None,
                is_paused: false,
                status: "cancelled".to_string(),
                dest_dir: dest_dir_str.clone(),
                first_output_path: first_output_path.clone(),
                error_message: None,
            });
            return Ok(CopyJobResultDto {
                job_id,
                status: "cancelled".to_string(),
                files_copied: 0,
                files_skipped,
                bytes_copied: 0,
                dest_dir: dest_dir_str,
                first_output_path,
            });
        }
        fs::create_dir_all(dir).map_err(|e| {
            format!(
                "No se pudo crear la carpeta destino '{}': {e}",
                dir.display()
            )
        })?;
    }

    let files_total = files_to_copy.len() as u64;
    let bytes_total: u64 = files_to_copy.iter().map(|f| f.size_bytes).sum();
    let mut files_done: u64 = 0;
    let mut bytes_done: u64 = 0;

    let mut active_elapsed = Duration::ZERO;
    let mut segment_started = Instant::now();
    let mut last_emit = Instant::now()
        .checked_sub(Duration::from_millis(PROGRESS_EMIT_INTERVAL_MS as u64))
        .unwrap_or_else(Instant::now);

    let mut buffer = vec![0u8; COPY_CHUNK_BYTES];

    let calc_speed_and_eta = |done: u64, total: u64, elapsed: Duration| -> (u64, Option<u64>) {
        let secs = elapsed.as_secs_f64();
        if secs < 0.05 || done == 0 {
            return (0, None);
        }
        let speed = (done as f64 / secs) as u64;
        let remaining = total.saturating_sub(done);
        let eta = if speed > 0 {
            Some(remaining / speed)
        } else {
            None
        };
        (speed, eta)
    };

    for planned in &files_to_copy {
        if cancel_flag.load(Ordering::SeqCst) {
            on_progress(CopyProgressEvent {
                job_id: job_id.clone(),
                current_file: planned.display_name.clone(),
                files_done,
                files_total,
                bytes_done,
                bytes_total,
                speed_bps: 0,
                eta_seconds: None,
                is_paused: false,
                status: "cancelled".to_string(),
                dest_dir: dest_dir_str.clone(),
                first_output_path: first_output_path.clone(),
                error_message: None,
            });
            return Ok(CopyJobResultDto {
                job_id,
                status: "cancelled".to_string(),
                files_copied: files_done,
                files_skipped,
                bytes_copied: bytes_done,
                dest_dir: dest_dir_str,
                first_output_path,
            });
        }

        if let Some(parent) = planned.dst.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "No se pudo preparar la carpeta destino '{}': {e}",
                    parent.display()
                )
            })?;
        }

        let src_modified = fs::metadata(&planned.src)
            .ok()
            .and_then(|m| m.modified().ok());
        let mut reader = File::open(&planned.src).map_err(|e| {
            format!(
                "No se pudo abrir '{}' en el NAS para copiar: {e}",
                planned.display_name
            )
        })?;

        let tmp_path = build_temp_path(&planned.dst);
        let mut writer = File::create(&tmp_path).map_err(|e| {
            format!(
                "No se pudo crear el archivo temporal '{}' en el PC: {e}",
                tmp_path.display()
            )
        })?;

        let mut file_offset: u64 = 0;

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                drop(writer);
                let _ = fs::remove_file(&tmp_path);
                on_progress(CopyProgressEvent {
                    job_id: job_id.clone(),
                    current_file: planned.display_name.clone(),
                    files_done,
                    files_total,
                    bytes_done,
                    bytes_total,
                    speed_bps: 0,
                    eta_seconds: None,
                    is_paused: false,
                    status: "cancelled".to_string(),
                    dest_dir: dest_dir_str.clone(),
                    first_output_path: first_output_path.clone(),
                    error_message: None,
                });
                return Ok(CopyJobResultDto {
                    job_id,
                    status: "cancelled".to_string(),
                    files_copied: files_done,
                    files_skipped,
                    bytes_copied: bytes_done,
                    dest_dir: dest_dir_str,
                    first_output_path,
                });
            }

            if pause_flag.load(Ordering::SeqCst) {
                active_elapsed += segment_started.elapsed();
                on_progress(CopyProgressEvent {
                    job_id: job_id.clone(),
                    current_file: planned.display_name.clone(),
                    files_done,
                    files_total,
                    bytes_done,
                    bytes_total,
                    speed_bps: 0,
                    eta_seconds: None,
                    is_paused: true,
                    status: "paused".to_string(),
                    dest_dir: dest_dir_str.clone(),
                    first_output_path: first_output_path.clone(),
                    error_message: None,
                });

                while pause_flag.load(Ordering::SeqCst) {
                    if cancel_flag.load(Ordering::SeqCst) {
                        drop(writer);
                        let _ = fs::remove_file(&tmp_path);
                        on_progress(CopyProgressEvent {
                            job_id: job_id.clone(),
                            current_file: planned.display_name.clone(),
                            files_done,
                            files_total,
                            bytes_done,
                            bytes_total,
                            speed_bps: 0,
                            eta_seconds: None,
                            is_paused: false,
                            status: "cancelled".to_string(),
                            dest_dir: dest_dir_str.clone(),
                            first_output_path: first_output_path.clone(),
                            error_message: None,
                        });
                        return Ok(CopyJobResultDto {
                            job_id,
                            status: "cancelled".to_string(),
                            files_copied: files_done,
                            files_skipped,
                            bytes_copied: bytes_done,
                            dest_dir: dest_dir_str,
                            first_output_path,
                        });
                    }
                    thread::sleep(Duration::from_millis(120));
                }
                segment_started = Instant::now();
            }

            let bytes_read = match read_chunk_with_smb_retry(
                &planned.src,
                &mut reader,
                file_offset,
                &mut buffer,
                cancel_flag,
            ) {
                Ok(n) => n,
                Err(err) => {
                    drop(writer);
                    let _ = fs::remove_file(&tmp_path);
                    let msg = format!(
                        "Error al leer '{}' desde el NAS (tras reintentos): {err}",
                        planned.display_name
                    );
                    on_progress(CopyProgressEvent {
                        job_id: job_id.clone(),
                        current_file: planned.display_name.clone(),
                        files_done,
                        files_total,
                        bytes_done,
                        bytes_total,
                        speed_bps: 0,
                        eta_seconds: None,
                        is_paused: false,
                        status: "failed".to_string(),
                        dest_dir: dest_dir_str.clone(),
                        first_output_path: first_output_path.clone(),
                        error_message: Some(msg.clone()),
                    });
                    return Err(msg);
                }
            };

            if bytes_read == 0 {
                break;
            }

            if let Err(err) = writer.write_all(&buffer[..bytes_read]) {
                drop(writer);
                let _ = fs::remove_file(&tmp_path);
                let msg = format!(
                    "Error al escribir '{}' en el PC: {err}",
                    planned.display_name
                );
                on_progress(CopyProgressEvent {
                    job_id: job_id.clone(),
                    current_file: planned.display_name.clone(),
                    files_done,
                    files_total,
                    bytes_done,
                    bytes_total,
                    speed_bps: 0,
                    eta_seconds: None,
                    is_paused: false,
                    status: "failed".to_string(),
                    dest_dir: dest_dir_str.clone(),
                    first_output_path: first_output_path.clone(),
                    error_message: Some(msg.clone()),
                });
                return Err(msg);
            }

            file_offset += bytes_read as u64;
            bytes_done += bytes_read as u64;

            if last_emit.elapsed().as_millis() >= PROGRESS_EMIT_INTERVAL_MS {
                let total_elapsed = active_elapsed + segment_started.elapsed();
                let (speed_bps, eta_seconds) =
                    calc_speed_and_eta(bytes_done, bytes_total, total_elapsed);
                on_progress(CopyProgressEvent {
                    job_id: job_id.clone(),
                    current_file: planned.display_name.clone(),
                    files_done,
                    files_total,
                    bytes_done,
                    bytes_total,
                    speed_bps,
                    eta_seconds,
                    is_paused: false,
                    status: "running".to_string(),
                    dest_dir: dest_dir_str.clone(),
                    first_output_path: first_output_path.clone(),
                    error_message: None,
                });
                last_emit = Instant::now();
            }
        }

        if let Err(err) = writer.flush() {
            drop(writer);
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "Error al vaciar el búfer de '{}': {err}",
                planned.display_name
            ));
        }

        if let Some(mtime) = src_modified {
            let _ = writer.set_modified(mtime);
        }
        drop(writer);

        if planned.dst.exists() {
            let _ = fs::remove_file(&planned.dst);
        }

        if let Err(err) = fs::rename(&tmp_path, &planned.dst) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "No se pudo finalizar el archivo '{}' en el PC: {err}",
                planned.display_name
            ));
        }

        files_done += 1;
    }

    let total_elapsed = active_elapsed + segment_started.elapsed();
    let (speed_bps, _) = calc_speed_and_eta(bytes_done, bytes_total, total_elapsed);

    on_progress(CopyProgressEvent {
        job_id: job_id.clone(),
        current_file: String::new(),
        files_done,
        files_total,
        bytes_done,
        bytes_total,
        speed_bps,
        eta_seconds: Some(0),
        is_paused: false,
        status: "completed".to_string(),
        dest_dir: dest_dir_str.clone(),
        first_output_path: first_output_path.clone(),
        error_message: None,
    });

    Ok(CopyJobResultDto {
        job_id,
        status: "completed".to_string(),
        files_copied: files_done,
        files_skipped,
        bytes_copied: bytes_done,
        dest_dir: dest_dir_str,
        first_output_path,
    })
}

fn emit_copy_progress<R: Runtime>(
    app: &AppHandle<R>,
    copier: &CopierState,
    event: CopyProgressEvent,
) {
    copier.store_progress(event.clone());
    let _ = app.emit("copy-progress", &event);
}

#[tauri::command]
pub async fn preflight_copy_to_pc(
    source_paths: Vec<String>,
    dest_dir: String,
    state: State<'_, crate::AppState>,
) -> Result<CopyPreflightDto, String> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || preflight_copy_sync(&db, &source_paths, &dest_dir))
        .await
        .map_err(|e| format!("Error al preparar la copia hacia el PC: {e}"))?
}

#[tauri::command]
pub async fn start_copy_to_pc(
    request: CopyToPcRequest,
    app: AppHandle,
    state: State<'_, crate::AppState>,
    copier: State<'_, Arc<CopierState>>,
) -> Result<CopyJobResultDto, String> {
    if copier
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "Ya hay una copia en curso hacia el PC. Espera a que termine o cancélala primero."
                .to_string(),
        );
    }

    copier.pause_flag.store(false, Ordering::SeqCst);
    copier.cancel_flag.store(false, Ordering::SeqCst);

    let db = Arc::clone(&state.db);
    let copier_arc = Arc::clone(&*copier);

    let result = tokio::task::spawn_blocking(move || {
        let sources = validate_sources(&db, &request.source_paths)?;
        let dest_dir = PathBuf::from(request.dest_dir.trim());
        execute_copy_job_sync(
            &sources,
            &dest_dir,
            request.conflict_policy,
            &copier_arc.pause_flag,
            &copier_arc.cancel_flag,
            |ev| emit_copy_progress(&app, &copier_arc, ev),
        )
    })
    .await
    .map_err(|e| format!("Error en el hilo de copia hacia el PC: {e}"));

    copier.is_running.store(false, Ordering::SeqCst);
    copier.pause_flag.store(false, Ordering::SeqCst);
    copier.cancel_flag.store(false, Ordering::SeqCst);

    result?
}

#[tauri::command]
pub fn pause_or_resume_copy(
    paused: bool,
    copier: State<'_, Arc<CopierState>>,
) -> Result<(), String> {
    if !copier.is_running.load(Ordering::SeqCst) {
        return Ok(());
    }
    copier.set_paused(paused);
    Ok(())
}

#[tauri::command]
pub fn cancel_active_copy(copier: State<'_, Arc<CopierState>>) -> Result<(), String> {
    copier.request_cancel();
    Ok(())
}

#[tauri::command]
pub fn get_pc_quick_folders() -> Result<PcQuickFoldersDto, String> {
    Ok(build_pc_quick_folders())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj inválido")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("diskvault_copier_{label}_{nanos}"));
        fs::create_dir_all(&dir).expect("debe crear carpeta temporal");
        dir
    }

    #[test]
    fn copies_directory_tree_with_byte_equality() {
        let src_parent = temp_dir("tree_src");
        let dst_parent = temp_dir("tree_dst");

        let folder = src_parent.join("Vacaciones");
        fs::create_dir_all(folder.join("Sub")).expect("debe crear subcarpeta");

        let payload_a: Vec<u8> = (0..12_345).map(|i| (i % 251) as u8).collect();
        let payload_b: Vec<u8> = (0..64_000).map(|i| ((i * 7) % 256) as u8).collect();
        fs::write(folder.join("resumen.txt"), &payload_a).expect("debe escribir resumen");
        fs::write(folder.join("Sub").join("clip.bin"), &payload_b).expect("debe escribir clip");

        let pause = AtomicBool::new(false);
        let cancel = AtomicBool::new(false);

        let result = execute_copy_job_sync(
            &[folder],
            &dst_parent,
            ConflictPolicy::KeepBoth,
            &pause,
            &cancel,
            |_| {},
        )
        .expect("debe copiar carpeta completa");

        assert_eq!(result.status, "completed");
        assert_eq!(result.files_copied, 2);
        assert_eq!(
            fs::read(dst_parent.join("Vacaciones").join("resumen.txt")).unwrap(),
            payload_a
        );
        assert_eq!(
            fs::read(dst_parent.join("Vacaciones").join("Sub").join("clip.bin")).unwrap(),
            payload_b
        );

        let _ = fs::remove_dir_all(&src_parent);
        let _ = fs::remove_dir_all(&dst_parent);
    }

    #[test]
    fn keep_both_policy_renames_colliding_file_without_overwriting() {
        let src_dir = temp_dir("keepboth_src");
        let dst_dir = temp_dir("keepboth_dst");

        let src_file = src_dir.join("archivo.txt");
        fs::write(&src_file, b"version nueva desde NAS").expect("debe escribir origen");
        fs::write(dst_dir.join("archivo.txt"), b"version original en PC")
            .expect("debe escribir existente");

        let pause = AtomicBool::new(false);
        let cancel = AtomicBool::new(false);

        let result = execute_copy_job_sync(
            &[src_file],
            &dst_dir,
            ConflictPolicy::KeepBoth,
            &pause,
            &cancel,
            |_| {},
        )
        .expect("debe aplicar KeepBoth");

        assert_eq!(result.status, "completed");
        assert_eq!(
            fs::read(dst_dir.join("archivo.txt")).unwrap(),
            b"version original en PC"
        );
        assert_eq!(
            fs::read(dst_dir.join("archivo (1).txt")).unwrap(),
            b"version nueva desde NAS"
        );

        let _ = fs::remove_dir_all(&src_dir);
        let _ = fs::remove_dir_all(&dst_dir);
    }

    #[test]
    fn cancellation_leaves_zero_dvtmp_files_in_destination() {
        let src_dir = temp_dir("cancel_src");
        let dst_dir = temp_dir("cancel_dst");

        // Crear un archivo de 12 MB (> 4 MB chunk) para cancelar en mitad de la copia
        let src_file = src_dir.join("grande.bin");
        fs::write(&src_file, vec![42u8; 12 * 1024 * 1024]).expect("debe crear archivo 12 MB");

        let pause = AtomicBool::new(false);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_on_progress = Arc::clone(&cancel);

        // Activar cancelación en el primer evento de progreso o antes de terminar
        let result = execute_copy_job_sync(
            &[src_file],
            &dst_dir,
            ConflictPolicy::Overwrite,
            &pause,
            &cancel,
            |ev| {
                if ev.status == "running" {
                    cancel_on_progress.store(true, Ordering::SeqCst);
                }
            },
        )
        .expect("debe responder limpiamente");

        // También verificar cancelación inmediata previa al primer bloque
        let cancel_immediate = AtomicBool::new(true);
        let cancelled = execute_copy_job_sync(
            &[src_dir.join("grande.bin")],
            &dst_dir,
            ConflictPolicy::Overwrite,
            &pause,
            &cancel_immediate,
            |_| {},
        )
        .expect("debe cancelar sin error");
        assert_eq!(cancelled.status, "cancelled");
        assert!(result.status == "cancelled" || result.status == "completed");

        // Verificar que no quedó NINGÚN archivo temporal .dvtmp en destino
        let leftovers: Vec<String> = fs::read_dir(&dst_dir)
            .expect("debe leer destino")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".dvtmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "No debe quedar ningún archivo .dvtmp tras cancelar, encontrados: {:?}",
            leftovers
        );

        let _ = fs::remove_dir_all(&src_dir);
        let _ = fs::remove_dir_all(&dst_dir);
    }
}
