use crate::indexer::categories::classify_entry;
use crate::indexer::engine::check_root_connectivity;
use crate::storage::db::WatchedRoot;
use crate::storage::roots::normalize_input_path;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BreadcrumbSegment {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryItem {
    pub name: String,
    pub full_path: String,
    pub parent_path: String,
    pub extension: String,
    pub category: String,
    pub is_dir: bool,
    pub size_bytes: i64,
    pub modified_ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub root_id: i64,
    pub root_name: String,
    pub root_path: String,
    pub current_path: String,
    pub parent_path: Option<String>,
    pub breadcrumbs: Vec<BreadcrumbSegment>,
    pub items: Vec<DirectoryItem>,
    pub source: String,
    pub is_offline: bool,
}

fn contains_parent_traversal(path: &str) -> bool {
    path.split('\\').any(|segment| segment == "..")
}

fn path_key(path: &str) -> String {
    normalize_input_path(path).to_ascii_lowercase()
}

fn is_path_equal_or_child(target_key: &str, root_key: &str) -> bool {
    if target_key == root_key {
        return true;
    }
    if root_key.ends_with('\\') {
        target_key.starts_with(root_key)
    } else {
        target_key.starts_with(root_key)
            && target_key
                .as_bytes()
                .get(root_key.len())
                .copied()
                == Some(b'\\')
    }
}

/// Valida que la ruta solicitada pertenezca estrictamente a alguna de las carpetas
/// registradas en `watched_roots` (soportando UNC `\\servidor\recurso` y unidades `Z:\`),
/// bloqueando saltos de ruta (`..`) o accesos fuera del alcance autorizado.
pub fn validate_path_within_watched_roots(
    conn: &Connection,
    target_path: &str,
) -> Result<i64, String> {
    let normalized = normalize_input_path(target_path);
    if normalized.is_empty() {
        return Err("La ruta solicitada está vacía.".to_string());
    }
    if contains_parent_traversal(&normalized) {
        return Err(
            "Ruta no permitida: no se admiten segmentos relativos ('..').".to_string(),
        );
    }

    let target_key = normalized.to_ascii_lowercase();
    let mut stmt = conn
        .prepare("SELECT id, path FROM watched_roots ORDER BY length(path) DESC")
        .map_err(|e| format!("No se pudo consultar las ubicaciones registradas: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let root_path: String = row.get(1)?;
            Ok((id, root_path))
        })
        .map_err(|e| format!("Error al leer las ubicaciones registradas: {e}"))?;

    for row in rows {
        let (id, root_path) =
            row.map_err(|e| format!("Error al leer fila de ubicación: {e}"))?;
        let root_key = path_key(&root_path);
        if is_path_equal_or_child(&target_key, &root_key) {
            return Ok(id);
        }
    }

    Err(
        "Acceso denegado: la ruta solicitada está fuera de las ubicaciones configuradas en DiskVault Finder."
            .to_string(),
    )
}

pub fn build_breadcrumbs(root: &WatchedRoot, current_path: &str) -> Vec<BreadcrumbSegment> {
    let norm_root = normalize_input_path(&root.path);
    let norm_current = normalize_input_path(current_path);

    let mut crumbs = vec![BreadcrumbSegment {
        name: root.name.clone(),
        path: norm_root.clone(),
    }];

    let root_key = norm_root.to_ascii_lowercase();
    let current_key = norm_current.to_ascii_lowercase();

    if current_key == root_key {
        return crumbs;
    }

    let remainder = if norm_root.ends_with('\\') {
        &norm_current[norm_root.len()..]
    } else if norm_current.len() > norm_root.len() {
        norm_current[norm_root.len()..].trim_start_matches('\\')
    } else {
        ""
    };

    let mut running = norm_root;
    for part in remainder.split('\\').filter(|s| !s.is_empty()) {
        if running.ends_with('\\') {
            running.push_str(part);
        } else {
            running.push('\\');
            running.push_str(part);
        }
        crumbs.push(BreadcrumbSegment {
            name: part.to_string(),
            path: running.clone(),
        });
    }

    crumbs
}

pub fn compute_parent_within_root(root_path: &str, current_path: &str) -> Option<String> {
    let norm_root = normalize_input_path(root_path);
    let norm_current = normalize_input_path(current_path);

    if norm_current.eq_ignore_ascii_case(&norm_root) {
        return None;
    }

    if let Some(idx) = norm_current.rfind('\\') {
        let candidate = &norm_current[..idx];
        let parent = if candidate.len() == 2 && candidate.ends_with(':') {
            format!("{candidate}\\")
        } else {
            candidate.to_string()
        };
        let parent_key = path_key(&parent);
        let root_key = path_key(&norm_root);
        if is_path_equal_or_child(&parent_key, &root_key) {
            return Some(parent);
        }
    }

    Some(norm_root)
}

fn should_skip_system_folder(name: &str) -> bool {
    name.eq_ignore_ascii_case("$RECYCLE.BIN")
        || name.eq_ignore_ascii_case("System Volume Information")
}

fn read_directory_live(dir_path: &str) -> Result<Vec<DirectoryItem>, std::io::Error> {
    let mut items = Vec::new();
    let read_dir = fs::read_dir(dir_path)?;

    for entry_res in read_dir {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_system_folder(&name) {
            continue;
        }

        let path_buf = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let full_path = normalize_input_path(&path_buf.to_string_lossy());
        let extension = if is_dir {
            String::new()
        } else {
            path_buf
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
        };
        let category = classify_entry(is_dir, &extension).to_string();
        let size_bytes = if is_dir { 0 } else { meta.len() as i64 };
        let modified_ts = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        items.push(DirectoryItem {
            name,
            full_path,
            parent_path: dir_path.to_string(),
            extension,
            category,
            is_dir,
            size_bytes,
            modified_ts,
        });
    }

    Ok(items)
}

pub fn list_directory_sync(
    db: &crate::storage::db::Database,
    raw_path: &str,
) -> Result<DirectoryListing, String> {
    let normalized_path = normalize_input_path(raw_path);

    let root_id = db.with_conn(|conn| {
        validate_path_within_watched_roots(conn, &normalized_path)
            .map_err(|msg| rusqlite::Error::ToSqlConversionFailure(msg.into()))
    });

    let root_id = match root_id {
        Ok(id) => id,
        Err(err) => {
            // Recuperar el mensaje limpio en español si vino desde validate_path_within_watched_roots
            let cleaned = err
                .strip_prefix("Error de base de datos SQLite: ")
                .unwrap_or(&err);
            return Err(cleaned.to_string());
        }
    };

    let root = db
        .get_watched_root_by_id(root_id)?
        .ok_or_else(|| "La ubicación solicitada ya no existe.".to_string())?;

    let breadcrumbs = build_breadcrumbs(&root, &normalized_path);
    let parent_path = compute_parent_within_root(&root.path, &normalized_path);

    match read_directory_live(&normalized_path) {
        Ok(items) => Ok(DirectoryListing {
            root_id: root.id,
            root_name: root.name,
            root_path: root.path,
            current_path: normalized_path,
            parent_path,
            breadcrumbs,
            items,
            source: "live".to_string(),
            is_offline: false,
        }),
        Err(io_err) => {
            // Si el NAS/disco no responde, conservar el caché local y navegar desde SQLite
            if !check_root_connectivity(&root.path) {
                let _ = db.update_root_status(root.id, "offline");
                let cached_items = read_directory_from_cache(db, root.id, &normalized_path)?;
                return Ok(DirectoryListing {
                    root_id: root.id,
                    root_name: root.name,
                    root_path: root.path,
                    current_path: normalized_path,
                    parent_path,
                    breadcrumbs,
                    items: cached_items,
                    source: "cache".to_string(),
                    is_offline: true,
                });
            }

            if !Path::new(&normalized_path).exists() {
                return Err(format!(
                    "La carpeta '{normalized_path}' ya no existe en el NAS o disco."
                ));
            }

            Err(format!(
                "No se pudo abrir la carpeta '{normalized_path}': {io_err}"
            ))
        }
    }
}

fn read_directory_from_cache(
    db: &crate::storage::db::Database,
    root_id: i64,
    dir_path: &str,
) -> Result<Vec<DirectoryItem>, String> {
    let target_key = path_key(dir_path);
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT name, full_path, parent_path, extension, category, is_dir, size_bytes, modified_ts
             FROM indexed_entries
             WHERE root_id = ?1 AND lower(rtrim(replace(parent_path, '/', '\\'), '\\')) = lower(rtrim(?2, '\\'))
             ORDER BY is_dir DESC, name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![root_id, target_key], |row| {
            Ok(DirectoryItem {
                name: row.get(0)?,
                full_path: row.get(1)?,
                parent_path: row.get(2)?,
                extension: row.get(3)?,
                category: row.get(4)?,
                is_dir: row.get::<_, i64>(5)? != 0,
                size_bytes: row.get(6)?,
                modified_ts: row.get(7)?,
            })
        })?;
        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    })
}

#[tauri::command]
pub async fn list_directory(
    path: String,
    state: State<'_, crate::AppState>,
) -> Result<DirectoryListing, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || list_directory_sync(&db, &path))
        .await
        .map_err(|e| format!("Error al leer el contenido de la carpeta: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::engine::refresh_root_sync;
    use crate::storage::db::Database;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::time::SystemTime;

    #[test]
    fn validates_paths_strictly_within_watched_roots() {
        let db = Database::open_in_memory().expect("debe abrir BD");
        let nas = db
            .insert_watched_root("NAS Media", r"\\192.168.1.50\Media", true, "ready")
            .expect("debe registrar NAS");
        let mapped = db
            .insert_watched_root("Unidad Z", r"Z:\", true, "ready")
            .expect("debe registrar Z");

        db.with_conn(|conn| {
            assert_eq!(
                validate_path_within_watched_roots(conn, r"\\192.168.1.50\Media").unwrap(),
                nas.id
            );
            assert_eq!(
                validate_path_within_watched_roots(conn, r"\\192.168.1.50\media\Vacaciones\2025")
                    .unwrap(),
                nas.id
            );
            assert_eq!(
                validate_path_within_watched_roots(conn, r"z:\Peliculas\4K").unwrap(),
                mapped.id
            );

            // Rechaza rutas fuera del alcance o falsos prefijos
            assert!(validate_path_within_watched_roots(conn, r"\\192.168.1.50\Media2").is_err());
            assert!(validate_path_within_watched_roots(conn, r"C:\Windows\System32").is_err());
            // Rechaza path traversal
            assert!(
                validate_path_within_watched_roots(conn, r"\\192.168.1.50\Media\..\Secreto")
                    .is_err()
            );
            Ok(())
        })
        .expect("debe ejecutar validaciones");
    }

    #[test]
    fn builds_breadcrumbs_and_parent_for_unc_and_drive_paths() {
        let root = WatchedRoot {
            id: 1,
            name: "NAS Media".to_string(),
            path: r"\\192.168.1.50\Media".to_string(),
            is_network: true,
            enabled: true,
            status: "ready".to_string(),
            last_indexed_at: None,
            item_count: 0,
            total_bytes: 0,
            created_at: String::new(),
        };

        let crumbs = build_breadcrumbs(&root, r"\\192.168.1.50\Media\2025\Vacaciones");
        assert_eq!(crumbs.len(), 3);
        assert_eq!(crumbs[0].name, "NAS Media");
        assert_eq!(crumbs[0].path, r"\\192.168.1.50\Media");
        assert_eq!(crumbs[1].name, "2025");
        assert_eq!(crumbs[1].path, r"\\192.168.1.50\Media\2025");
        assert_eq!(crumbs[2].name, "Vacaciones");
        assert_eq!(crumbs[2].path, r"\\192.168.1.50\Media\2025\Vacaciones");

        assert_eq!(
            compute_parent_within_root(&root.path, &root.path),
            None
        );
        assert_eq!(
            compute_parent_within_root(&root.path, r"\\192.168.1.50\Media\2025\Vacaciones"),
            Some(r"\\192.168.1.50\Media\2025".to_string())
        );
    }

    #[test]
    fn lists_live_directory_and_falls_back_to_cache_when_offline() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj inválido")
            .as_nanos();
        let temp_root: PathBuf =
            std::env::temp_dir().join(format!("diskvault_browser_test_{nanos}"));
        fs::create_dir_all(temp_root.join("Videos")).expect("debe crear carpeta Videos");
        fs::write(temp_root.join("Notas.txt"), b"hola").expect("debe crear archivo");

        let db = Database::open_in_memory().expect("debe abrir BD");
        let root_path = normalize_input_path(&temp_root.to_string_lossy());
        let root = db
            .insert_watched_root("Prueba", &root_path, false, "pending")
            .expect("debe registrar raíz");

        let cancel = AtomicBool::new(false);
        refresh_root_sync(&db, &root, &cancel, |_, _, _| {}).expect("debe indexar");

        // 1. Lectura en vivo
        let live = list_directory_sync(&db, &root_path).expect("debe leer en vivo");
        assert_eq!(live.source, "live");
        assert!(!live.is_offline);
        assert_eq!(live.items.len(), 2);

        // 2. Desconectar y comprobar fallback transparente al caché SQLite
        fs::remove_dir_all(&temp_root).expect("debe eliminar carpeta temporal");
        let cached = list_directory_sync(&db, &root_path).expect("debe leer desde caché");
        assert_eq!(cached.source, "cache");
        assert!(cached.is_offline);
        assert_eq!(cached.items.len(), 2);
    }
}
