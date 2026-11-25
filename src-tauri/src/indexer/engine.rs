use crate::indexer::categories::classify_entry;
use crate::storage::db::{Database, IndexedEntryDraft, WatchedRoot};
use jwalk::{Parallelism, WalkDir};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Runtime, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexProgress {
    pub is_running: bool,
    pub current_root_id: Option<i64>,
    pub current_root_name: Option<String>,
    pub roots_completed: usize,
    pub roots_total: usize,
    pub items_scanned: u64,
    pub bytes_scanned: u64,
    pub phase: String,
    pub last_message: Option<String>,
}

impl Default for IndexProgress {
    fn default() -> Self {
        Self {
            is_running: false,
            current_root_id: None,
            current_root_name: None,
            roots_completed: 0,
            roots_total: 0,
            items_scanned: 0,
            bytes_scanned: 0,
            phase: "idle".to_string(),
            last_message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexRefreshReport {
    pub refreshed_roots: usize,
    pub offline_roots: usize,
    pub failed_roots: usize,
    pub cancelled: bool,
    pub total_items: i64,
    pub total_bytes: i64,
}

pub struct IndexerState {
    pub is_running: AtomicBool,
    pub cancel_flag: AtomicBool,
    progress: Mutex<IndexProgress>,
}

impl Default for IndexerState {
    fn default() -> Self {
        Self::new()
    }
}

impl IndexerState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            cancel_flag: AtomicBool::new(false),
            progress: Mutex::new(IndexProgress::default()),
        }
    }

    pub fn snapshot(&self) -> IndexProgress {
        self.progress
            .lock()
            .map(|p| p.clone())
            .unwrap_or_default()
    }

    fn set_progress(&self, next: IndexProgress) {
        if let Ok(mut guard) = self.progress.lock() {
            *guard = next;
        }
    }

    pub fn request_cancel(&self) {
        if self.is_running.load(Ordering::SeqCst) {
            self.cancel_flag.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootRefreshOutcome {
    Refreshed { item_count: i64, total_bytes: i64 },
    Offline,
    Cancelled,
}

/// Comprueba conectividad real antes de tocar cualquier registro en SQLite.
/// Si el NAS o disco no responde, nunca se debe borrar el caché existente.
pub fn check_root_connectivity(path: &str) -> bool {
    let target = Path::new(path);
    target.exists() && target.is_dir() && fs::read_dir(target).is_ok()
}

fn should_skip_system_folder(name: &str) -> bool {
    name.eq_ignore_ascii_case("$RECYCLE.BIN")
        || name.eq_ignore_ascii_case("System Volume Information")
}

/// Escanea una raíz y actualiza SQLite en una sola transacción atómica.
/// Protege el caché existente si la ruta está desconectada o si se cancela el escaneo.
pub fn refresh_root_sync<F>(
    db: &Database,
    root: &WatchedRoot,
    cancel_flag: &AtomicBool,
    mut on_scan_tick: F,
) -> Result<RootRefreshOutcome, String>
where
    F: FnMut(&str, u64, u64),
{
    on_scan_tick("checking", 0, 0);

    // Regla innegociable: comprobar conectividad real antes de modificar SQLite.
    if !check_root_connectivity(&root.path) {
        db.update_root_status(root.id, "offline")?;
        return Ok(RootRefreshOutcome::Offline);
    }

    let previous_status = root.status.clone();
    db.update_root_status(root.id, "indexing")?;

    let threads = if root.is_network { 2 } else { 4 };
    let walker = WalkDir::new(&root.path)
        .skip_hidden(false)
        .follow_links(false)
        .parallelism(Parallelism::RayonNewPool(threads))
        .process_read_dir(|_depth, _path, _state, children| {
            children.retain(|entry_result| match entry_result {
                Ok(entry) => {
                    let name = entry.file_name().to_string_lossy();
                    !should_skip_system_folder(&name)
                }
                Err(_) => false,
            });
        });

    let mut drafts: Vec<IndexedEntryDraft> = Vec::new();
    let mut items_scanned: u64 = 0;
    let mut bytes_scanned: u64 = 0;

    on_scan_tick("scanning", 0, 0);

    for entry_res in walker {
        if cancel_flag.load(Ordering::SeqCst) {
            let restore_status = if previous_status == "indexing" {
                "pending"
            } else {
                previous_status.as_str()
            };
            let _ = db.update_root_status(root.id, restore_status);
            return Ok(RootRefreshOutcome::Cancelled);
        }

        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.depth == 0 {
            continue;
        }

        let is_dir = entry.file_type().is_dir();
        let full_path_buf = entry.path();
        let full_path = full_path_buf.to_string_lossy().to_string();
        let parent_path = full_path_buf
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| root.path.clone());
        let name = entry.file_name().to_string_lossy().to_string();
        let extension = if is_dir {
            String::new()
        } else {
            full_path_buf
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
        };
        let category = classify_entry(is_dir, &extension).to_string();

        let (size_bytes, modified_ts) = match entry.metadata() {
            Ok(meta) => {
                let sz = if is_dir { 0 } else { meta.len() as i64 };
                let ts = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                (sz, ts)
            }
            Err(_) => (0, 0),
        };

        items_scanned += 1;
        if size_bytes > 0 {
            bytes_scanned += size_bytes as u64;
        }

        drafts.push(IndexedEntryDraft {
            parent_path,
            full_path,
            name,
            extension,
            category,
            is_dir,
            size_bytes,
            modified_ts,
        });

        if items_scanned % 250 == 0 {
            on_scan_tick("scanning", items_scanned, bytes_scanned);
        }
    }

    if cancel_flag.load(Ordering::SeqCst) {
        let restore_status = if previous_status == "indexing" {
            "pending"
        } else {
            previous_status.as_str()
        };
        let _ = db.update_root_status(root.id, restore_status);
        return Ok(RootRefreshOutcome::Cancelled);
    }

    // Doble comprobación antes de escribir por si el NAS se desconectó en mitad del escaneo.
    if !check_root_connectivity(&root.path) {
        db.update_root_status(root.id, "offline")?;
        return Ok(RootRefreshOutcome::Offline);
    }

    on_scan_tick("writing", items_scanned, bytes_scanned);

    let (item_count, total_bytes, _indexed_at) = db.replace_root_entries(root.id, &drafts)?;
    Ok(RootRefreshOutcome::Refreshed {
        item_count,
        total_bytes,
    })
}

fn emit_progress<R: Runtime>(
    app: Option<&AppHandle<R>>,
    state: &IndexerState,
    progress: IndexProgress,
) {
    state.set_progress(progress.clone());
    if let Some(handle) = app {
        let _ = handle.emit("index-progress", &progress);
    }
}

pub fn run_refresh_roots_blocking<R: Runtime>(
    db: &Database,
    indexer: &IndexerState,
    app: Option<&AppHandle<R>>,
    only_root_id: Option<i64>,
) -> Result<IndexRefreshReport, String> {
    if indexer
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Ya hay una actualización de caché en curso.".to_string());
    }

    indexer.cancel_flag.store(false, Ordering::SeqCst);

    let result = (|| -> Result<IndexRefreshReport, String> {
        let roots: Vec<WatchedRoot> = match only_root_id {
            Some(id) => match db.get_watched_root_by_id(id)? {
                Some(r) => vec![r],
                None => {
                    return Err("La ubicación solicitada no existe.".to_string());
                }
            },
            None => db
                .list_watched_roots()?
                .into_iter()
                .filter(|r| r.enabled)
                .collect(),
        };

        let roots_total = roots.len();
        let mut report = IndexRefreshReport {
            refreshed_roots: 0,
            offline_roots: 0,
            failed_roots: 0,
            cancelled: false,
            total_items: 0,
            total_bytes: 0,
        };

        if roots_total == 0 {
            emit_progress(
                app,
                indexer,
                IndexProgress {
                    is_running: false,
                    phase: "done".to_string(),
                    last_message: Some("No hay ubicaciones habilitadas para indexar.".to_string()),
                    ..IndexProgress::default()
                },
            );
            return Ok(report);
        }

        for (idx, root) in roots.iter().enumerate() {
            if indexer.cancel_flag.load(Ordering::SeqCst) {
                report.cancelled = true;
                break;
            }

            let root_id = root.id;
            let root_name = root.name.clone();

            let outcome = refresh_root_sync(
                db,
                root,
                &indexer.cancel_flag,
                |phase, items, bytes| {
                    emit_progress(
                        app,
                        indexer,
                        IndexProgress {
                            is_running: true,
                            current_root_id: Some(root_id),
                            current_root_name: Some(root_name.clone()),
                            roots_completed: idx,
                            roots_total,
                            items_scanned: items,
                            bytes_scanned: bytes,
                            phase: phase.to_string(),
                            last_message: None,
                        },
                    );
                },
            );

            match outcome {
                Ok(RootRefreshOutcome::Refreshed {
                    item_count,
                    total_bytes,
                }) => {
                    report.refreshed_roots += 1;
                    report.total_items += item_count;
                    report.total_bytes += total_bytes;
                }
                Ok(RootRefreshOutcome::Offline) => {
                    report.offline_roots += 1;
                }
                Ok(RootRefreshOutcome::Cancelled) => {
                    report.cancelled = true;
                    break;
                }
                Err(_) => {
                    report.failed_roots += 1;
                    let _ = db.update_root_status(root.id, "error");
                }
            }

            if let Some(handle) = app {
                let _ = handle.emit("index-root-updated", root.id);
            }
        }

        let summary_msg = if report.cancelled {
            "Actualización de caché cancelada por el usuario.".to_string()
        } else if report.offline_roots > 0 && report.refreshed_roots == 0 {
            "Las ubicaciones del NAS no respondieron. Se conservó el caché local intacto."
                .to_string()
        } else if report.offline_roots > 0 {
            format!(
                "Actualizadas {} ubicaciones ({} sin conexión, caché conservado).",
                report.refreshed_roots, report.offline_roots
            )
        } else {
            format!(
                "Caché actualizado: {} elementos indexados.",
                report.total_items
            )
        };

        emit_progress(
            app,
            indexer,
            IndexProgress {
                is_running: false,
                current_root_id: None,
                current_root_name: None,
                roots_completed: if report.cancelled {
                    report.refreshed_roots + report.offline_roots
                } else {
                    roots_total
                },
                roots_total,
                items_scanned: report.total_items as u64,
                bytes_scanned: report.total_bytes as u64,
                phase: if report.cancelled {
                    "cancelled".to_string()
                } else {
                    "done".to_string()
                },
                last_message: Some(summary_msg),
            },
        );

        Ok(report)
    })();

    indexer.is_running.store(false, Ordering::SeqCst);
    indexer.cancel_flag.store(false, Ordering::SeqCst);
    result
}

pub async fn trigger_refresh_all<R: Runtime>(
    db: Arc<Database>,
    indexer: Arc<IndexerState>,
    app: AppHandle<R>,
) -> Result<IndexRefreshReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_refresh_roots_blocking(&db, &indexer, Some(&app), None)
    })
    .await
    .map_err(|e| format!("Error al ejecutar el motor de indexación: {e}"))?
}

#[tauri::command]
pub async fn refresh_all_roots(
    app: AppHandle,
    app_state: State<'_, crate::AppState>,
    indexer: State<'_, Arc<IndexerState>>,
) -> Result<IndexRefreshReport, String> {
    let db = Arc::clone(&app_state.db);
    let idx = Arc::clone(&*indexer);
    trigger_refresh_all(db, idx, app).await
}

#[tauri::command]
pub async fn refresh_single_root(
    root_id: i64,
    app: AppHandle,
    app_state: State<'_, crate::AppState>,
    indexer: State<'_, Arc<IndexerState>>,
) -> Result<IndexRefreshReport, String> {
    let db = Arc::clone(&app_state.db);
    let idx = Arc::clone(&*indexer);
    tauri::async_runtime::spawn_blocking(move || {
        run_refresh_roots_blocking(&db, &idx, Some(&app), Some(root_id))
    })
    .await
    .map_err(|e| format!("Error al actualizar la ubicación seleccionada: {e}"))?
}

#[tauri::command]
pub fn cancel_indexing(indexer: State<'_, Arc<IndexerState>>) -> Result<(), String> {
    indexer.request_cancel();
    Ok(())
}

#[tauri::command]
pub fn get_index_progress(indexer: State<'_, Arc<IndexerState>>) -> Result<IndexProgress, String> {
    Ok(indexer.snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::SystemTime;

    fn create_temp_tree(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj inválido")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("diskvault_idx_{label}_{nanos}"));
        fs::create_dir_all(dir.join("Familia")).expect("debe crear subcarpeta Familia");
        fs::create_dir_all(dir.join("Documentos")).expect("debe crear subcarpeta Documentos");
        fs::write(
            dir.join("Familia").join("Video_Vacaciones_2025_4K.mp4"),
            vec![0u8; 2048],
        )
        .expect("debe crear video de prueba");
        fs::write(
            dir.join("Documentos").join("Presupuesto_NAS.pdf"),
            vec![0u8; 512],
        )
        .expect("debe crear pdf de prueba");
        dir
    }

    #[test]
    fn indexes_directory_tree_and_preserves_cache_when_root_goes_offline() {
        let temp_root = create_temp_tree("offline_protection");
        let root_path = temp_root.to_string_lossy().to_string();

        let db = Database::open_in_memory().expect("debe abrir SQLite en memoria");
        let root = db
            .insert_watched_root("NAS Casa", &root_path, false, "pending")
            .expect("debe insertar raíz");

        let cancel = AtomicBool::new(false);
        let outcome = refresh_root_sync(&db, &root, &cancel, |_, _, _| {})
            .expect("debe indexar sin error");

        assert_eq!(
            outcome,
            RootRefreshOutcome::Refreshed {
                item_count: 4, // 2 subcarpetas + 2 archivos
                total_bytes: 2560
            }
        );

        let updated_root = db
            .get_watched_root_by_id(root.id)
            .expect("debe consultar raíz")
            .expect("la raíz debe existir");
        assert_eq!(updated_root.status, "ready");
        assert_eq!(updated_root.item_count, 4);
        assert_eq!(updated_root.total_bytes, 2560);
        assert!(updated_root.last_indexed_at.is_some());

        // Simular desconexión total del NAS eliminando el directorio temporal
        fs::remove_dir_all(&temp_root).expect("debe eliminar carpeta temporal");

        let offline_outcome = refresh_root_sync(&db, &updated_root, &cancel, |_, _, _| {})
            .expect("debe detectar desconexión sin fallar");
        assert_eq!(offline_outcome, RootRefreshOutcome::Offline);

        let offline_root = db
            .get_watched_root_by_id(root.id)
            .expect("debe consultar raíz")
            .expect("la raíz debe existir");
        assert_eq!(offline_root.status, "offline");
        // Caché intacto: item_count y registros en SQLite/FTS5 NO se borraron
        assert_eq!(offline_root.item_count, 4);

        let cached_count: i64 = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM indexed_entries WHERE root_id = ?1",
                    rusqlite::params![root.id],
                    |row| row.get(0),
                )
            })
            .expect("debe contar registros cacheados");
        assert_eq!(cached_count, 4);

        let fts_count: i64 = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH '\"vacaciones\"'",
                    [],
                    |row| row.get(0),
                )
            })
            .expect("debe consultar FTS5 con NAS desconectado");
        assert_eq!(fts_count, 1);
    }
}
