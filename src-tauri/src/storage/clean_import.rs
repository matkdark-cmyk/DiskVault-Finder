use crate::storage::db::{Database, WatchedRoot};
use crate::storage::roots::{
    detect_is_network_path, normalize_input_path, suggest_root_name, validate_path_internal,
};
use crate::AppState;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanDestinationCandidate {
    pub name: String,
    pub path: String,
    pub is_network: bool,
    pub exists: bool,
    pub already_added: bool,
    pub source_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskVaultCleanDetectionDto {
    pub found_sources: Vec<String>,
    pub candidates: Vec<CleanDestinationCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRootCandidate {
    pub name: String,
    pub path: String,
}

fn looks_like_windows_path(raw: &str) -> bool {
    let t = raw.trim().trim_matches('"');
    if t.starts_with(r"\\") && t.len() >= 5 {
        let rest = t.trim_start_matches('\\');
        let mut parts = rest.split('\\').filter(|s| !s.is_empty());
        return parts.next().is_some() && parts.next().is_some();
    }
    let bytes = t.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

const PATH_OBJECT_KEYS: &[&str] = &[
    "path",
    "dest_path",
    "destination",
    "destination_path",
    "nas_path",
    "target_path",
    "root_path",
    "folder",
    "folder_path",
    "unc_path",
    "share_path",
    "backup_path",
];

const NAME_OBJECT_KEYS: &[&str] = &["name", "label", "title", "alias", "display_name"];

const CONTAINER_ARRAY_KEYS: &[&str] = &[
    "destinations",
    "nas_paths",
    "target_paths",
    "roots",
    "watched_roots",
    "folders",
    "targets",
    "profiles",
    "backups",
    "locations",
];

fn extract_from_json_value(
    value: &Value,
    source_label: &str,
    out: &mut Vec<(String, String, String)>,
) {
    match value {
        Value::Object(map) => {
            // 1. Si este objeto tiene directamente una clave de ruta
            let mut found_path: Option<String> = None;
            for key in PATH_OBJECT_KEYS {
                if let Some(Value::String(s)) = map.get(*key) {
                    if looks_like_windows_path(s) {
                        found_path = Some(normalize_input_path(s));
                        break;
                    }
                }
            }
            if let Some(path) = found_path {
                let name = NAME_OBJECT_KEYS
                    .iter()
                    .find_map(|k| map.get(*k).and_then(|v| v.as_str()))
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| suggest_root_name(&path));
                out.push((name, path, source_label.to_string()));
            }

            // 2. Recorrer arrays/objetos hijos
            for (k, v) in map {
                let key_lower = k.to_ascii_lowercase();
                if let Value::Array(arr) = v {
                    if CONTAINER_ARRAY_KEYS.iter().any(|ak| *ak == key_lower) {
                        for item in arr {
                            match item {
                                Value::String(s) if looks_like_windows_path(s) => {
                                    let norm = normalize_input_path(s);
                                    out.push((
                                        suggest_root_name(&norm),
                                        norm,
                                        source_label.to_string(),
                                    ));
                                }
                                _ => extract_from_json_value(item, source_label, out),
                            }
                        }
                        continue;
                    }
                }
                extract_from_json_value(v, source_label, out);
            }
        }
        Value::Array(arr) => {
            for item in arr {
                extract_from_json_value(item, source_label, out);
            }
        }
        _ => {}
    }
}

fn extract_from_json_file(
    file_path: &Path,
    out: &mut Vec<(String, String, String)>,
) -> Result<(), String> {
    let raw = fs::read_to_string(file_path).map_err(|e| {
        format!(
            "No se pudo leer el archivo '{}': {e}",
            file_path.display()
        )
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| {
        format!(
            "El archivo '{}' no tiene un formato JSON válido: {e}",
            file_path.display()
        )
    })?;
    let label = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string_lossy().to_string());
    extract_from_json_value(&parsed, &label, out);
    Ok(())
}

fn extract_from_sqlite_file(
    file_path: &Path,
    out: &mut Vec<(String, String, String)>,
) -> Result<(), String> {
    let conn = Connection::open_with_flags(file_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(
        |e| {
            format!(
                "No se pudo abrir la base de datos '{}' en modo lectura: {e}",
                file_path.display()
            )
        },
    )?;

    let label = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string_lossy().to_string());

    let candidate_queries = [
        "SELECT name, path FROM destinations",
        "SELECT label, path FROM destinations",
        "SELECT name, dest_path FROM destinations",
        "SELECT name, path FROM watched_roots",
        "SELECT name, path FROM targets",
        "SELECT name, destination_path FROM profiles",
    ];

    for sql in candidate_queries {
        if let Ok(mut stmt) = conn.prepare(sql) {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for row in rows.flatten() {
                    let (raw_name, raw_path) = row;
                    if looks_like_windows_path(&raw_path) {
                        let norm = normalize_input_path(&raw_path);
                        let name = if raw_name.trim().is_empty() {
                            suggest_root_name(&norm)
                        } else {
                            raw_name.trim().to_string()
                        };
                        out.push((name, norm, label.clone()));
                    }
                }
            }
        }
    }

    Ok(())
}

fn standard_clean_candidate_dirs() -> Vec<PathBuf> {
    let mut dirs_to_check: Vec<PathBuf> = Vec::new();

    if let Some(roaming) = dirs::config_dir() {
        dirs_to_check.push(roaming.join("DiskVaultClean"));
        dirs_to_check.push(roaming.join("DiskVault Clean"));
        dirs_to_check.push(roaming.join("cl.diskvault.clean"));
    }
    if let Some(local) = dirs::data_local_dir() {
        dirs_to_check.push(local.join("DiskVaultClean"));
        dirs_to_check.push(local.join("DiskVault Clean"));
        dirs_to_check.push(local.join("cl.diskvault.clean"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent().and_then(|p| p.parent()) {
            dirs_to_check.push(parent.join("DiskVaultClean").join("data"));
            dirs_to_check.push(parent.join("DiskVault Clean").join("data"));
        }
    }

    dirs_to_check
}

fn build_candidates_dto(
    db: &Database,
    found_sources: Vec<String>,
    raw_items: Vec<(String, String, String)>,
) -> Result<DiskVaultCleanDetectionDto, String> {
    let existing_roots = db.list_watched_roots()?;
    let existing_keys: HashSet<String> = existing_roots
        .iter()
        .map(|r| normalize_input_path(&r.path).to_ascii_lowercase())
        .collect();

    let mut seen: HashSet<String> = HashSet::new();
    let mut candidates: Vec<CleanDestinationCandidate> = Vec::new();

    for (name, path, source_label) in raw_items {
        let key = path.to_ascii_lowercase();
        if !seen.insert(key.clone()) {
            continue;
        }
        let is_network = detect_is_network_path(&path);
        let exists = Path::new(&path).exists();
        let already_added = existing_keys.contains(&key);

        candidates.push(CleanDestinationCandidate {
            name,
            path,
            is_network,
            exists,
            already_added,
            source_label,
        });
    }

    Ok(DiskVaultCleanDetectionDto {
        found_sources,
        candidates,
    })
}

pub fn detect_clean_destinations_sync(db: &Database) -> Result<DiskVaultCleanDetectionDto, String> {
    let mut found_sources: Vec<String> = Vec::new();
    let mut raw_items: Vec<(String, String, String)> = Vec::new();

    const KNOWN_JSON_FILES: &[&str] = &[
        "settings.json",
        "config.json",
        "destinations.json",
        "profiles.json",
        "diskvault-clean.json",
    ];
    const KNOWN_DB_FILES: &[&str] = &["clean.db", "diskvault-clean.db", "diskvault.db"];

    for dir in standard_clean_candidate_dirs() {
        if !dir.exists() || !dir.is_dir() {
            continue;
        }

        for json_name in KNOWN_JSON_FILES {
            let file = dir.join(json_name);
            if file.is_file() {
                let before = raw_items.len();
                if extract_from_json_file(&file, &mut raw_items).is_ok()
                    && raw_items.len() > before
                {
                    found_sources.push(file.to_string_lossy().to_string());
                }
            }
        }

        for db_name in KNOWN_DB_FILES {
            let file = dir.join(db_name);
            if file.is_file() {
                let before = raw_items.len();
                if extract_from_sqlite_file(&file, &mut raw_items).is_ok()
                    && raw_items.len() > before
                {
                    found_sources.push(file.to_string_lossy().to_string());
                }
            }
        }
    }

    build_candidates_dto(db, found_sources, raw_items)
}

pub fn inspect_clean_file_sync(
    db: &Database,
    file_path: &str,
) -> Result<DiskVaultCleanDetectionDto, String> {
    let path = PathBuf::from(file_path.trim());
    if !path.is_file() {
        return Err("El archivo seleccionado no existe o no se puede leer.".to_string());
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut raw_items: Vec<(String, String, String)> = Vec::new();
    if ext == "json" {
        extract_from_json_file(&path, &mut raw_items)?;
    } else if ext == "db" || ext == "sqlite" || ext == "sqlite3" {
        extract_from_sqlite_file(&path, &mut raw_items)?;
    } else {
        // Intentar primero JSON y luego SQLite
        if extract_from_json_file(&path, &mut raw_items).is_err() {
            extract_from_sqlite_file(&path, &mut raw_items)?;
        }
    }

    build_candidates_dto(db, vec![path.to_string_lossy().to_string()], raw_items)
}

pub fn import_candidates_sync(
    db: &Database,
    candidates: &[ImportRootCandidate],
) -> Result<Vec<WatchedRoot>, String> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let existing_keys: HashSet<String> = db
        .list_watched_roots()?
        .into_iter()
        .map(|r| normalize_input_path(&r.path).to_ascii_lowercase())
        .collect();

    let mut added: Vec<WatchedRoot> = Vec::new();

    for cand in candidates {
        let normalized = normalize_input_path(&cand.path);
        if normalized.is_empty() || existing_keys.contains(&normalized.to_ascii_lowercase()) {
            continue;
        }

        let is_network = detect_is_network_path(&normalized);
        let initial_status = match validate_path_internal(&normalized) {
            Ok(info) if info.is_accessible => "pending",
            _ => "offline",
        };
        let final_name = if cand.name.trim().is_empty() {
            suggest_root_name(&normalized)
        } else {
            cand.name.trim().to_string()
        };

        if let Ok(root) = db.insert_watched_root(&final_name, &normalized, is_network, initial_status)
        {
            added.push(root);
        }
    }

    Ok(added)
}

#[tauri::command]
pub async fn detect_diskvault_clean_destinations(
    state: State<'_, AppState>,
) -> Result<DiskVaultCleanDetectionDto, String> {
    let db = std::sync::Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || detect_clean_destinations_sync(&db))
        .await
        .map_err(|e| format!("Error al buscar configuraciones de DiskVault Clean: {e}"))?
}

#[tauri::command]
pub async fn inspect_diskvault_clean_file(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<DiskVaultCleanDetectionDto, String> {
    let db = std::sync::Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || inspect_clean_file_sync(&db, &file_path))
        .await
        .map_err(|e| format!("Error al leer el archivo de DiskVault Clean: {e}"))?
}

#[tauri::command]
pub async fn import_diskvault_clean_destinations(
    candidates: Vec<ImportRootCandidate>,
    state: State<'_, AppState>,
) -> Result<Vec<WatchedRoot>, String> {
    let db = std::sync::Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || import_candidates_sync(&db, &candidates))
        .await
        .map_err(|e| format!("Error al importar destinos desde DiskVault Clean: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn extracts_and_deduplicates_destinations_from_clean_json() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj válido")
            .as_nanos();
        let json_path = std::env::temp_dir().join(format!("dv_clean_test_{nanos}.json"));

        let sample_json = r#"{
            "destinations": [
                { "name": "NAS Familia", "path": "\\\\192.168.1.50\\Familia\\" },
                { "label": "Respaldo Videos", "dest_path": "Z:\\Videos" },
                { "name": "Duplicado", "path": "\\\\192.168.1.50\\Familia" }
            ],
            "nas_paths": [
                "\\\\192.168.1.50\\Peliculas"
            ]
        }"#;
        fs::write(&json_path, sample_json).expect("debe escribir JSON temporal");

        let db = Database::open_in_memory().expect("debe abrir BD en memoria");
        db.insert_watched_root("Ya Agregada", r"Z:\Videos", false, "pending")
            .expect("debe insertar raíz previa");

        let dto = inspect_clean_file_sync(&db, &json_path.to_string_lossy())
            .expect("debe detectar candidatos");
        assert_eq!(dto.candidates.len(), 3);

        let familia = dto
            .candidates
            .iter()
            .find(|c| c.path == r"\\192.168.1.50\Familia")
            .expect("debe encontrar NAS Familia");
        assert_eq!(familia.name, "NAS Familia");
        assert!(familia.is_network);
        assert!(!familia.already_added);

        let videos = dto
            .candidates
            .iter()
            .find(|c| c.path == r"Z:\Videos")
            .expect("debe encontrar Z:\\Videos");
        assert!(videos.already_added);

        // Importar los 2 nuevos
        let imported = import_candidates_sync(
            &db,
            &[
                ImportRootCandidate {
                    name: "NAS Familia".to_string(),
                    path: r"\\192.168.1.50\Familia".to_string(),
                },
                ImportRootCandidate {
                    name: "Ya Existe".to_string(),
                    path: r"Z:\Videos".to_string(),
                },
            ],
        )
        .expect("debe importar solo nuevos");
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].name, "NAS Familia");

        let _ = fs::remove_file(&json_path);
    }
}
