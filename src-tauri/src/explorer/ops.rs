use crate::explorer::browser::validate_path_within_watched_roots;
use crate::indexer::categories::classify_entry;
use crate::storage::db::Database;
use crate::storage::roots::{detect_is_network_path, normalize_input_path};
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::State;

const STREAM_CHUNK_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedEntryDto {
    pub root_id: i64,
    pub parent_path: String,
    pub full_path: String,
    pub name: String,
    pub extension: String,
    pub category: String,
    pub is_dir: bool,
    pub size_bytes: i64,
    pub modified_ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteResultDto {
    pub deleted_path: String,
    pub used_recycle_bin: bool,
    pub removed_entries: i64,
    pub freed_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryPropertiesDto {
    pub name: String,
    pub full_path: String,
    pub parent_path: String,
    pub root_name: String,
    pub is_network: bool,
    pub is_dir: bool,
    pub category: String,
    pub extension: String,
    pub size_bytes: i64,
    pub created_ts: i64,
    pub modified_ts: i64,
    pub child_files: i64,
    pub child_dirs: i64,
}

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Valida nombres de archivos/carpetas según las reglas oficiales de Windows.
pub fn validate_windows_filename(raw_name: &str) -> Result<String, String> {
    if raw_name.trim().is_empty() {
        return Err("El nombre no puede estar vacío.".to_string());
    }

    if raw_name.ends_with(' ') || raw_name.ends_with('.') {
        return Err("El nombre no puede terminar en punto ni en espacio.".to_string());
    }

    let trimmed_start = raw_name.trim_start();
    if trimmed_start != raw_name {
        return Err("El nombre no puede comenzar con espacios en blanco.".to_string());
    }

    if raw_name == "." || raw_name == ".." {
        return Err("El nombre no es válido en Windows.".to_string());
    }

    const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    for ch in raw_name.chars() {
        if (ch as u32) < 32 || FORBIDDEN.contains(&ch) {
            return Err(
                "El nombre contiene caracteres no permitidos por Windows (< > : \" / \\ | ? *)."
                    .to_string(),
            );
        }
    }

    let stem = raw_name.split('.').next().unwrap_or(raw_name).trim();
    if WINDOWS_RESERVED_NAMES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(stem))
    {
        return Err(format!(
            "'{raw_name}' es un nombre reservado por Windows y no se puede utilizar."
        ));
    }

    Ok(raw_name.to_string())
}

fn validate_within_roots(db: &Database, normalized_path: &str) -> Result<i64, String> {
    let res = db.with_conn(|conn| {
        validate_path_within_watched_roots(conn, normalized_path)
            .map_err(|msg| rusqlite::Error::ToSqlConversionFailure(msg.into()))
    });

    match res {
        Ok(id) => Ok(id),
        Err(err) => {
            let cleaned = err
                .strip_prefix("Error de base de datos SQLite: ")
                .unwrap_or(&err);
            Err(cleaned.to_string())
        }
    }
}

fn is_watched_root_itself(db: &Database, normalized_path: &str) -> Result<bool, String> {
    let roots = db.list_watched_roots()?;
    let target_key = normalize_input_path(normalized_path).to_ascii_lowercase();
    Ok(roots
        .iter()
        .any(|r| normalize_input_path(&r.path).to_ascii_lowercase() == target_key))
}

fn join_child_normalized(parent: &str, child_name: &str) -> String {
    let clean_parent = normalize_input_path(parent);
    if clean_parent.ends_with('\\') {
        format!("{clean_parent}{child_name}")
    } else {
        format!("{clean_parent}\\{child_name}")
    }
}

fn parent_of_normalized(normalized_path: &str) -> Result<String, String> {
    let clean = normalize_input_path(normalized_path);
    if let Some(idx) = clean.rfind('\\') {
        let head = &clean[..idx];
        if head.len() == 2 && head.ends_with(':') {
            return Ok(format!("{head}\\"));
        }
        if !head.is_empty() && head != r"\" {
            return Ok(head.to_string());
        }
    }
    Err(format!(
        "No se pudo determinar la carpeta contenedora de '{normalized_path}'."
    ))
}

fn path_to_os(normalized_path: &str) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(normalized_path)
    }
    #[cfg(not(windows))]
    {
        // En pruebas unitarias sobre Linux, restaurar '/' si es una ruta absoluta POSIX
        if normalized_path.starts_with('\\') && !normalized_path.starts_with(r"\\") {
            PathBuf::from(normalized_path.replace('\\', "/"))
        } else {
            PathBuf::from(normalized_path)
        }
    }
}

fn escape_like(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str(r"\\"),
            '%' => out.push_str(r"\%"),
            '_' => out.push_str(r"\_"),
            _ => out.push(ch),
        }
    }
    out
}

fn recalculate_root_stats_tx(tx: &Transaction<'_>, root_id: i64) -> Result<(), String> {
    tx.execute(
        "UPDATE watched_roots
         SET item_count = (SELECT COUNT(*) FROM indexed_entries WHERE root_id = ?1),
             total_bytes = COALESCE(
                 (SELECT SUM(CASE WHEN is_dir = 0 THEN size_bytes ELSE 0 END)
                  FROM indexed_entries
                  WHERE root_id = ?1),
                 0
             )
         WHERE id = ?1",
        params![root_id],
    )
    .map_err(|e| format!("No se pudieron actualizar las estadísticas de la ubicación: {e}"))?;
    Ok(())
}

fn metadata_timestamps_and_size(path: &Path, is_dir: bool) -> (i64, i64, i64) {
    match fs::metadata(path) {
        Ok(meta) => {
            let size = if is_dir { 0 } else { meta.len() as i64 };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let created = meta
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            (size, modified, created)
        }
        Err(_) => (0, 0, 0),
    }
}

fn replace_path_prefix_ci(full: &str, old_prefix: &str, new_prefix: &str) -> String {
    let norm_full = normalize_input_path(full);
    let norm_old = normalize_input_path(old_prefix);
    if norm_full.len() >= norm_old.len()
        && norm_full.is_char_boundary(norm_old.len())
        && norm_full[..norm_old.len()].eq_ignore_ascii_case(&norm_old)
    {
        format!("{}{}", new_prefix, &norm_full[norm_old.len()..])
    } else {
        norm_full
    }
}

fn copy_file_streaming_verified(src: &Path, dst: &Path) -> Result<(), String> {
    let src_meta = fs::metadata(src)
        .map_err(|e| format!("No se pudo leer los metadatos de '{}': {e}", src.display()))?;
    let expected_len = src_meta.len();
    let src_modified = src_meta.modified().ok();

    let mut reader = File::open(src)
        .map_err(|e| format!("No se pudo abrir '{}' para mover: {e}", src.display()))?;
    let mut writer = File::create(dst)
        .map_err(|e| format!("No se pudo crear '{}' en el destino: {e}", dst.display()))?;

    let mut buf = vec![0u8; STREAM_CHUNK_BYTES];
    let mut written: u64 = 0;

    loop {
        let n = reader.read(&mut buf).map_err(|e| {
            let _ = fs::remove_file(dst);
            format!("Error al leer '{}' durante el movimiento: {e}", src.display())
        })?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| {
            let _ = fs::remove_file(dst);
            format!("Error al escribir '{}' en el destino: {e}", dst.display())
        })?;
        written += n as u64;
    }

    writer.flush().map_err(|e| {
        let _ = fs::remove_file(dst);
        format!("No se pudo finalizar la escritura de '{}': {e}", dst.display())
    })?;

    if let Some(mtime) = src_modified {
        let _ = writer.set_modified(mtime);
    }
    drop(writer);

    let dst_len = fs::metadata(dst)
        .map_err(|e| format!("No se pudo verificar el archivo movido '{}': {e}", dst.display()))?
        .len();
    if written != expected_len || dst_len != expected_len {
        let _ = fs::remove_file(dst);
        return Err(format!(
            "Verificación de integridad fallida al mover '{}': tamaño incompleto.",
            src.display()
        ));
    }

    Ok(())
}

fn copy_dir_recursive_verified(src_dir: &Path, dst_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dst_dir).map_err(|e| {
        format!(
            "No se pudo crear la carpeta destino '{}': {e}",
            dst_dir.display()
        )
    })?;

    let entries = fs::read_dir(src_dir).map_err(|e| {
        format!(
            "No se pudo leer la carpeta origen '{}': {e}",
            src_dir.display()
        )
    })?;

    for entry_res in entries {
        let entry = entry_res
            .map_err(|e| format!("Error leyendo contenido de '{}': {e}", src_dir.display()))?;
        let src_path = entry.path();
        let dst_path = dst_dir.join(entry.file_name());
        let meta = entry
            .metadata()
            .map_err(|e| format!("Error leyendo metadatos de '{}': {e}", src_path.display()))?;
        if meta.is_dir() {
            copy_dir_recursive_verified(&src_path, &dst_path)?;
        } else {
            copy_file_streaming_verified(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn is_cross_device_error(err: &std::io::Error) -> bool {
    // Windows ERROR_NOT_SAME_DEVICE = 17; Unix EXDEV = 18
    matches!(err.raw_os_error(), Some(17) | Some(18))
}

pub fn create_folder_sync(
    db: &Database,
    parent_path: &str,
    folder_name: &str,
) -> Result<IndexedEntryDto, String> {
    let norm_parent = normalize_input_path(parent_path);
    let root_id = validate_within_roots(db, &norm_parent)?;
    let valid_name = validate_windows_filename(folder_name)?;

    let os_parent = path_to_os(&norm_parent);
    if !os_parent.exists() || !os_parent.is_dir() {
        return Err(
            "La carpeta destino no existe o el NAS está sin conexión en este momento.".to_string(),
        );
    }

    let new_full_path = join_child_normalized(&norm_parent, &valid_name);
    let os_new = path_to_os(&new_full_path);
    if os_new.exists() {
        return Err(format!(
            "Ya existe un archivo o carpeta llamado '{valid_name}' en esta ubicación."
        ));
    }

    fs::create_dir(&os_new)
        .map_err(|e| format!("No se pudo crear la carpeta '{valid_name}': {e}"))?;

    let (_, modified_ts, _) = metadata_timestamps_and_size(&os_new, true);

    db.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("No se pudo iniciar la transacción SQLite: {e}"))?;

        tx.execute(
            "INSERT OR REPLACE INTO indexed_entries
             (root_id, parent_path, full_path, name, extension, category, is_dir, size_bytes, modified_ts)
             VALUES (?1, ?2, ?3, ?4, '', 'folder', 1, 0, ?5)",
            params![root_id, norm_parent, new_full_path, valid_name, modified_ts],
        )
        .map_err(|e| format!("No se pudo registrar la nueva carpeta en el caché: {e}"))?;

        recalculate_root_stats_tx(&tx, root_id)?;

        tx.commit()
            .map_err(|e| format!("No se pudo confirmar la creación de carpeta en el caché: {e}"))?;
        Ok(())
    })?;

    Ok(IndexedEntryDto {
        root_id,
        parent_path: norm_parent,
        full_path: new_full_path,
        name: valid_name,
        extension: String::new(),
        category: "folder".to_string(),
        is_dir: true,
        size_bytes: 0,
        modified_ts,
    })
}

pub fn rename_entry_sync(
    db: &Database,
    raw_path: &str,
    new_name: &str,
) -> Result<IndexedEntryDto, String> {
    let old_path = normalize_input_path(raw_path);
    let root_id = validate_within_roots(db, &old_path)?;

    if is_watched_root_itself(db, &old_path)? {
        return Err(
            "No se puede renombrar una carpeta raíz registrada. Solo puedes renombrar su contenido interno."
                .to_string(),
        );
    }

    let valid_name = validate_windows_filename(new_name)?;
    let os_old = path_to_os(&old_path);
    if !os_old.exists() {
        return Err(
            "El elemento seleccionado ya no existe o el NAS está sin conexión.".to_string(),
        );
    }

    let is_dir = os_old.is_dir();
    let parent_path = parent_of_normalized(&old_path)?;
    let new_path = join_child_normalized(&parent_path, &valid_name);
    let os_new = path_to_os(&new_path);

    let is_case_only_rename = old_path.eq_ignore_ascii_case(&new_path);
    if !is_case_only_rename && os_new.exists() {
        return Err(format!(
            "Ya existe otro elemento llamado '{valid_name}' en esta carpeta."
        ));
    }

    if old_path != new_path {
        fs::rename(&os_old, &os_new)
            .map_err(|e| format!("No se pudo renombrar a '{valid_name}': {e}"))?;
    }

    let extension = if is_dir {
        String::new()
    } else {
        Path::new(&valid_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
    };
    let category = classify_entry(is_dir, &extension).to_string();
    let (size_bytes, modified_ts, _) = metadata_timestamps_and_size(&os_new, is_dir);

    db.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("No se pudo iniciar la transacción SQLite: {e}"))?;

        let updated_self = tx
            .execute(
                "UPDATE indexed_entries
                 SET name = ?1, full_path = ?2, extension = ?3, category = ?4, modified_ts = ?5
                 WHERE root_id = ?6 AND lower(replace(full_path, '/', '\\')) = lower(?7)",
                params![
                    valid_name,
                    new_path,
                    extension,
                    category,
                    modified_ts,
                    root_id,
                    old_path
                ],
            )
            .map_err(|e| format!("No se pudo actualizar el elemento en el caché: {e}"))?;

        if updated_self == 0 {
            tx.execute(
                "INSERT OR REPLACE INTO indexed_entries
                 (root_id, parent_path, full_path, name, extension, category, is_dir, size_bytes, modified_ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    root_id,
                    parent_path,
                    new_path,
                    valid_name,
                    extension,
                    category,
                    if is_dir { 1 } else { 0 },
                    size_bytes,
                    modified_ts
                ],
            )
            .map_err(|e| format!("No se pudo insertar el elemento renombrado en el caché: {e}"))?;
        }

        if is_dir {
            let prefix_pattern = format!("{}\\%", escape_like(&old_path.to_ascii_lowercase()));
            let descendants: Vec<(i64, String, String)> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT id, full_path, parent_path
                         FROM indexed_entries
                         WHERE root_id = ?1
                           AND lower(replace(full_path, '/', '\\')) LIKE ?2 ESCAPE '\\'",
                    )
                    .map_err(|e| format!("Error al consultar subelementos en caché: {e}"))?;
                let rows = stmt
                    .query_map(params![root_id, prefix_pattern], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|e| format!("Error al leer subelementos en caché: {e}"))?;
                let mut list = Vec::new();
                for r in rows {
                    list.push(r.map_err(|e| format!("Error de fila en caché: {e}"))?);
                }
                list
            };

            let mut update_child = tx
                .prepare(
                    "UPDATE indexed_entries
                     SET full_path = ?1, parent_path = ?2
                     WHERE id = ?3",
                )
                .map_err(|e| format!("Error al preparar actualización de descendientes: {e}"))?;

            for (child_id, child_full, child_parent) in descendants {
                let next_full = replace_path_prefix_ci(&child_full, &old_path, &new_path);
                let next_parent = replace_path_prefix_ci(&child_parent, &old_path, &new_path);
                update_child
                    .execute(params![next_full, next_parent, child_id])
                    .map_err(|e| {
                        format!("Error al actualizar la ruta del subelemento en el caché: {e}")
                    })?;
            }
        }

        recalculate_root_stats_tx(&tx, root_id)?;
        tx.commit()
            .map_err(|e| format!("No se pudo confirmar el renombrado en SQLite: {e}"))?;
        Ok(())
    })?;

    Ok(IndexedEntryDto {
        root_id,
        parent_path,
        full_path: new_path,
        name: valid_name,
        extension,
        category,
        is_dir,
        size_bytes,
        modified_ts,
    })
}

pub fn move_entry_sync(
    db: &Database,
    raw_source: &str,
    raw_dest_folder: &str,
) -> Result<IndexedEntryDto, String> {
    let source_path = normalize_input_path(raw_source);
    let dest_folder = normalize_input_path(raw_dest_folder);

    let source_root_id = validate_within_roots(db, &source_path)?;
    let dest_root_id = validate_within_roots(db, &dest_folder)?;

    if is_watched_root_itself(db, &source_path)? {
        return Err("No se puede mover una carpeta raíz registrada.".to_string());
    }

    let os_source = path_to_os(&source_path);
    let os_dest_dir = path_to_os(&dest_folder);

    if !os_source.exists() {
        return Err(
            "El elemento de origen no existe o el NAS está sin conexión.".to_string(),
        );
    }
    if !os_dest_dir.exists() || !os_dest_dir.is_dir() {
        return Err(
            "La carpeta destino no existe o no es accesible en este momento.".to_string(),
        );
    }

    let is_dir = os_source.is_dir();
    let current_parent = parent_of_normalized(&source_path)?;
    if current_parent.eq_ignore_ascii_case(&dest_folder) {
        return Err("El elemento ya se encuentra dentro de esa carpeta.".to_string());
    }

    if is_dir {
        let src_lower = source_path.to_ascii_lowercase();
        let dst_lower = dest_folder.to_ascii_lowercase();
        let src_prefix = format!("{src_lower}\\");
        if dst_lower == src_lower || dst_lower.starts_with(&src_prefix) {
            return Err(
                "No se puede mover una carpeta dentro de sí misma ni dentro de una de sus subcarpetas."
                    .to_string(),
            );
        }
    }

    let entry_name = source_path
        .rsplit('\\')
        .find(|s| !s.is_empty())
        .ok_or_else(|| "No se pudo obtener el nombre del elemento a mover.".to_string())?
        .to_string();

    let dest_path = join_child_normalized(&dest_folder, &entry_name);
    let os_dest = path_to_os(&dest_path);

    if os_dest.exists() {
        return Err(format!(
            "Ya existe un archivo o carpeta llamado '{entry_name}' en la carpeta destino."
        ));
    }

    match fs::rename(&os_source, &os_dest) {
        Ok(()) => {}
        Err(err) if is_cross_device_error(&err) => {
            if is_dir {
                copy_dir_recursive_verified(&os_source, &os_dest)?;
                fs::remove_dir_all(&os_source).map_err(|e| {
                    format!(
                        "La carpeta se copió al destino pero no se pudo quitar el origen: {e}"
                    )
                })?;
            } else {
                copy_file_streaming_verified(&os_source, &os_dest)?;
                fs::remove_file(&os_source).map_err(|e| {
                    format!(
                        "El archivo se copió al destino pero no se pudo quitar el origen: {e}"
                    )
                })?;
            }
        }
        Err(err) => {
            return Err(format!("No se pudo mover '{entry_name}': {err}"));
        }
    }

    let extension = if is_dir {
        String::new()
    } else {
        Path::new(&entry_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
    };
    let category = classify_entry(is_dir, &extension).to_string();
    let (size_bytes, modified_ts, _) = metadata_timestamps_and_size(&os_dest, is_dir);

    db.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("No se pudo iniciar la transacción SQLite: {e}"))?;

        let updated = tx
            .execute(
                "UPDATE indexed_entries
                 SET root_id = ?1, parent_path = ?2, full_path = ?3, modified_ts = ?4
                 WHERE root_id = ?5 AND lower(replace(full_path, '/', '\\')) = lower(?6)",
                params![
                    dest_root_id,
                    dest_folder,
                    dest_path,
                    modified_ts,
                    source_root_id,
                    source_path
                ],
            )
            .map_err(|e| format!("No se pudo actualizar el elemento movido en el caché: {e}"))?;

        if updated == 0 {
            tx.execute(
                "INSERT OR REPLACE INTO indexed_entries
                 (root_id, parent_path, full_path, name, extension, category, is_dir, size_bytes, modified_ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    dest_root_id,
                    dest_folder,
                    dest_path,
                    entry_name,
                    extension,
                    category,
                    if is_dir { 1 } else { 0 },
                    size_bytes,
                    modified_ts
                ],
            )
            .map_err(|e| format!("No se pudo registrar el elemento movido en el caché: {e}"))?;
        }

        if is_dir {
            let prefix_pattern = format!("{}\\%", escape_like(&source_path.to_ascii_lowercase()));
            let descendants: Vec<(i64, String, String)> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT id, full_path, parent_path
                         FROM indexed_entries
                         WHERE root_id = ?1
                           AND lower(replace(full_path, '/', '\\')) LIKE ?2 ESCAPE '\\'",
                    )
                    .map_err(|e| format!("Error al buscar descendientes movidos en caché: {e}"))?;
                let rows = stmt
                    .query_map(params![source_root_id, prefix_pattern], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|e| format!("Error al leer descendientes en caché: {e}"))?;
                let mut list = Vec::new();
                for r in rows {
                    list.push(r.map_err(|e| format!("Error leyendo fila descendiente: {e}"))?);
                }
                list
            };

            let mut update_child = tx
                .prepare(
                    "UPDATE indexed_entries
                     SET root_id = ?1, full_path = ?2, parent_path = ?3
                     WHERE id = ?4",
                )
                .map_err(|e| format!("Error al preparar actualización de descendientes: {e}"))?;

            for (child_id, child_full, child_parent) in descendants {
                let next_full = replace_path_prefix_ci(&child_full, &source_path, &dest_path);
                let next_parent = replace_path_prefix_ci(&child_parent, &source_path, &dest_path);
                update_child
                    .execute(params![dest_root_id, next_full, next_parent, child_id])
                    .map_err(|e| {
                        format!("Error al actualizar subelemento movido en caché: {e}")
                    })?;
            }
        }

        recalculate_root_stats_tx(&tx, source_root_id)?;
        if dest_root_id != source_root_id {
            recalculate_root_stats_tx(&tx, dest_root_id)?;
        }

        tx.commit()
            .map_err(|e| format!("No se pudo confirmar el movimiento en SQLite: {e}"))?;
        Ok(())
    })?;

    Ok(IndexedEntryDto {
        root_id: dest_root_id,
        parent_path: dest_folder,
        full_path: dest_path,
        name: entry_name,
        extension,
        category,
        is_dir,
        size_bytes,
        modified_ts,
    })
}

pub fn delete_entry_sync(
    db: &Database,
    raw_path: &str,
    permanent: bool,
) -> Result<DeleteResultDto, String> {
    let target_path = normalize_input_path(raw_path);
    let root_id = validate_within_roots(db, &target_path)?;

    if is_watched_root_itself(db, &target_path)? {
        return Err(
            "No se puede eliminar una carpeta raíz registrada desde el explorador. Si deseas quitarla de la lista, hazlo desde el panel lateral."
                .to_string(),
        );
    }

    let root = db
        .get_watched_root_by_id(root_id)?
        .ok_or_else(|| "La ubicación de este elemento ya no existe.".to_string())?;

    let os_target = path_to_os(&target_path);
    if !os_target.exists() {
        return Err(
            "El elemento ya no existe o el NAS está sin conexión en este momento.".to_string(),
        );
    }

    let is_dir = os_target.is_dir();
    let is_network = root.is_network || detect_is_network_path(&target_path);
    let used_recycle_bin: bool;

    if is_network || permanent {
        if is_dir {
            fs::remove_dir_all(&os_target)
                .map_err(|e| format!("No se pudo eliminar la carpeta '{target_path}': {e}"))?;
        } else {
            fs::remove_file(&os_target)
                .map_err(|e| format!("No se pudo eliminar el archivo '{target_path}': {e}"))?;
        }
        used_recycle_bin = false;
    } else {
        trash::delete(&os_target).map_err(|e| {
            format!("No se pudo enviar '{target_path}' a la Papelera de Reciclaje: {e}")
        })?;
        used_recycle_bin = true;
    }

    let (removed_entries, freed_bytes) = db.with_conn_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("No se pudo iniciar la transacción SQLite: {e}"))?;

        let prefix_pattern = format!("{}\\%", escape_like(&target_path.to_ascii_lowercase()));

        let (count_to_remove, bytes_to_free): (i64, i64) = tx
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN is_dir = 0 THEN size_bytes ELSE 0 END), 0)
                 FROM indexed_entries
                 WHERE root_id = ?1
                   AND (lower(replace(full_path, '/', '\\')) = lower(?2)
                        OR lower(replace(full_path, '/', '\\')) LIKE ?3 ESCAPE '\\')",
                params![root_id, target_path, prefix_pattern],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| format!("Error al calcular elementos eliminados en caché: {e}"))?;

        tx.execute(
            "DELETE FROM indexed_entries
             WHERE root_id = ?1
               AND (lower(replace(full_path, '/', '\\')) = lower(?2)
                    OR lower(replace(full_path, '/', '\\')) LIKE ?3 ESCAPE '\\')",
            params![root_id, target_path, prefix_pattern],
        )
        .map_err(|e| format!("No se pudo eliminar el elemento del caché SQLite: {e}"))?;

        recalculate_root_stats_tx(&tx, root_id)?;

        tx.commit()
            .map_err(|e| format!("No se pudo confirmar la eliminación en SQLite: {e}"))?;
        Ok((count_to_remove, bytes_to_free))
    })?;

    Ok(DeleteResultDto {
        deleted_path: target_path,
        used_recycle_bin,
        removed_entries,
        freed_bytes,
    })
}

pub fn get_entry_properties_sync(
    db: &Database,
    raw_path: &str,
) -> Result<EntryPropertiesDto, String> {
    let target_path = normalize_input_path(raw_path);
    let root_id = validate_within_roots(db, &target_path)?;
    let root = db
        .get_watched_root_by_id(root_id)?
        .ok_or_else(|| "La ubicación de este elemento ya no existe.".to_string())?;

    let os_target = path_to_os(&target_path);
    let exists_live = os_target.exists();

    let name = target_path
        .rsplit('\\')
        .find(|s| !s.is_empty())
        .unwrap_or(&root.name)
        .to_string();
    let parent_path = parent_of_normalized(&target_path).unwrap_or_else(|_| root.path.clone());

    let (is_dir, extension, category, mut size_bytes, modified_ts, created_ts) = if exists_live {
        let is_dir = os_target.is_dir();
        let ext = if is_dir {
            String::new()
        } else {
            Path::new(&name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
        };
        let cat = classify_entry(is_dir, &ext).to_string();
        let (sz, mtime, ctime) = metadata_timestamps_and_size(&os_target, is_dir);
        (is_dir, ext, cat, sz, mtime, ctime)
    } else {
        // Fallback desde caché SQLite cuando el NAS está offline
        db.with_conn(|conn| {
            conn.query_row(
                "SELECT is_dir, extension, category, size_bytes, modified_ts
                 FROM indexed_entries
                 WHERE root_id = ?1 AND lower(replace(full_path, '/', '\\')) = lower(?2)",
                params![root_id, target_path],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)? != 0,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        0_i64,
                    ))
                },
            )
        })
        .map_err(|_| "No se encontró información del elemento en disco ni en caché.".to_string())?
    };

    let mut child_files: i64 = 0;
    let mut child_dirs: i64 = 0;

    if is_dir {
        let prefix_pattern = format!("{}\\%", escape_like(&target_path.to_ascii_lowercase()));
        if let Ok((files, dirs, total_sz)) = db.with_conn(|conn| {
            conn.query_row(
                "SELECT
                    COALESCE(SUM(CASE WHEN is_dir = 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_dir = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_dir = 0 THEN size_bytes ELSE 0 END), 0)
                 FROM indexed_entries
                 WHERE root_id = ?1
                   AND lower(replace(full_path, '/', '\\')) LIKE ?2 ESCAPE '\\'",
                params![root_id, prefix_pattern],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
        }) {
            child_files = files;
            child_dirs = dirs;
            size_bytes = total_sz;
        }
    }

    Ok(EntryPropertiesDto {
        name,
        full_path: target_path,
        parent_path,
        root_name: root.name,
        is_network: root.is_network || detect_is_network_path(&root.path),
        is_dir,
        category,
        extension,
        size_bytes,
        created_ts,
        modified_ts,
        child_files,
        child_dirs,
    })
}

#[tauri::command]
pub async fn create_folder_on_nas(
    parent_path: String,
    folder_name: String,
    state: State<'_, crate::AppState>,
) -> Result<IndexedEntryDto, String> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || create_folder_sync(&db, &parent_path, &folder_name))
        .await
        .map_err(|e| format!("Error al crear la carpeta en segundo plano: {e}"))?
}

#[tauri::command]
pub async fn rename_entry_on_nas(
    path: String,
    new_name: String,
    state: State<'_, crate::AppState>,
) -> Result<IndexedEntryDto, String> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || rename_entry_sync(&db, &path, &new_name))
        .await
        .map_err(|e| format!("Error al renombrar el elemento en segundo plano: {e}"))?
}

#[tauri::command]
pub async fn move_entry_on_nas(
    source_path: String,
    dest_folder_path: String,
    state: State<'_, crate::AppState>,
) -> Result<IndexedEntryDto, String> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || move_entry_sync(&db, &source_path, &dest_folder_path))
        .await
        .map_err(|e| format!("Error al mover el elemento en segundo plano: {e}"))?
}

#[tauri::command]
pub async fn delete_entry_on_nas(
    path: String,
    permanent: bool,
    state: State<'_, crate::AppState>,
) -> Result<DeleteResultDto, String> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || delete_entry_sync(&db, &path, permanent))
        .await
        .map_err(|e| format!("Error al eliminar el elemento en segundo plano: {e}"))?
}

#[tauri::command]
pub async fn get_entry_properties(
    path: String,
    state: State<'_, crate::AppState>,
) -> Result<EntryPropertiesDto, String> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || get_entry_properties_sync(&db, &path))
        .await
        .map_err(|e| format!("Error al consultar propiedades: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::engine::refresh_root_sync;
    use crate::search::query::{execute_search, SearchRequest};
    use std::sync::atomic::AtomicBool;
    use std::time::SystemTime;

    fn unique_temp_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj inválido")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("diskvault_ops_{label}_{nanos}"));
        fs::create_dir_all(&dir).expect("debe crear carpeta temporal");
        dir
    }

    #[test]
    fn validates_windows_filenames_strictly() {
        assert!(validate_windows_filename("").is_err());
        assert!(validate_windows_filename("   ").is_err());
        assert!(validate_windows_filename("archivo<1>.mp4").is_err());
        assert!(validate_windows_filename("video>4k.mp4").is_err());
        assert!(validate_windows_filename("hora:12.txt").is_err());
        assert!(validate_windows_filename("quien?.pdf").is_err());
        assert!(validate_windows_filename("todo*.jpg").is_err());
        assert!(validate_windows_filename("carpeta.").is_err());
        assert!(validate_windows_filename("carpeta ").is_err());
        assert!(validate_windows_filename("CON").is_err());
        assert!(validate_windows_filename("nul.txt").is_err());
        assert!(validate_windows_filename("COM1").is_err());
        assert!(validate_windows_filename("LPT9.log").is_err());

        assert_eq!(
            validate_windows_filename("Vacaciones Otoño 2025 (4K).mp4").unwrap(),
            "Vacaciones Otoño 2025 (4K).mp4"
        );
        assert_eq!(
            validate_windows_filename("Diseño Gráfico - Año Nuevo").unwrap(),
            "Diseño Gráfico - Año Nuevo"
        );
    }

    #[test]
    fn live_fs_ops_sync_sqlite_fts5_immediately_and_block_unsafe_actions() {
        let temp_root = unique_temp_root("sync_fts5");
        let root_str = normalize_input_path(&temp_root.to_string_lossy());

        let db = Database::open_in_memory().expect("debe abrir BD en memoria");
        let root = db
            .insert_watched_root("NAS Test", &root_str, false, "pending")
            .expect("debe registrar raíz");

        let cancel = AtomicBool::new(false);
        refresh_root_sync(&db, &root, &cancel, |_, _, _| {}).expect("indexado inicial");

        // 1. Crear carpeta -> existe en disco y aparece al instante en FTS5
        let created = create_folder_sync(&db, &root_str, "Proyectos 2025")
            .expect("debe crear carpeta");
        assert!(path_to_os(&created.full_path).is_dir());

        let search_created = execute_search(
            &db,
            &SearchRequest {
                query: "proyectos".to_string(),
                filter: "folder".to_string(),
                root_id: Some(root.id),
                limit: Some(20),
                offset: Some(0),
            },
        )
        .expect("búsqueda tras crear carpeta");
        assert_eq!(search_created.total_matches, 1);

        // Crear un archivo dentro de la carpeta y reindexar para probar renombrado/movimiento con hijos
        let child_file_path = join_child_normalized(&created.full_path, "Clip_Montaña_4K.mp4");
        fs::write(path_to_os(&child_file_path), vec![7u8; 1024]).expect("debe crear archivo hijo");
        refresh_root_sync(&db, &root, &cancel, |_, _, _| {}).expect("debe sincronizar archivo hijo");

        // 2. Renombrar carpeta con subarchivos -> los hijos actualizan full_path y parent_path en FTS5
        let renamed = rename_entry_sync(&db, &created.full_path, "Viaje Patagonia")
            .expect("debe renombrar carpeta con hijos");
        assert!(path_to_os(&renamed.full_path).is_dir());

        let search_new_parent = execute_search(
            &db,
            &SearchRequest {
                query: "patagonia".to_string(),
                filter: "video".to_string(),
                root_id: Some(root.id),
                limit: Some(20),
                offset: Some(0),
            },
        )
        .expect("debe encontrar video hijo buscando por el nuevo nombre de su carpeta");
        assert_eq!(search_new_parent.total_matches, 1);
        assert!(search_new_parent.items[0]
            .full_path
            .contains("Viaje Patagonia"));
        assert!(search_new_parent.items[0]
            .parent_path
            .ends_with("Viaje Patagonia"));

        // 3. Bloqueo de seguridad: no se puede eliminar la raíz ni mover carpeta dentro de sí misma
        assert!(delete_entry_sync(&db, &root_str, true).is_err());
        assert!(rename_entry_sync(&db, &root_str, "OtroNombre").is_err());
        assert!(move_entry_sync(&db, &renamed.full_path, &renamed.full_path).is_err());

        // 4. Mover carpeta con hijos a otra subcarpeta
        let dest_folder = create_folder_sync(&db, &root_str, "Archivo Histórico")
            .expect("debe crear carpeta destino");
        let moved = move_entry_sync(&db, &renamed.full_path, &dest_folder.full_path)
            .expect("debe mover carpeta con hijos");
        assert!(path_to_os(&moved.full_path).is_dir());

        let search_moved = execute_search(
            &db,
            &SearchRequest {
                query: "histórico".to_string(),
                filter: "video".to_string(),
                root_id: Some(root.id),
                limit: Some(20),
                offset: Some(0),
            },
        )
        .expect("debe encontrar el video hijo dentro de la carpeta destino movida");
        assert_eq!(search_moved.total_matches, 1);
        assert!(search_moved.items[0].full_path.contains("Archivo Histórico"));

        // 5. Eliminar carpeta con hijos -> desaparece de disco y de SQLite/FTS5
        let del_res = delete_entry_sync(&db, &moved.full_path, true)
            .expect("debe eliminar carpeta permanentemente");
        assert!(!del_res.used_recycle_bin);
        assert!(!path_to_os(&moved.full_path).exists());
        assert_eq!(del_res.removed_entries, 2); // carpeta + video hijo

        let search_after_delete = execute_search(
            &db,
            &SearchRequest {
                query: "patagonia".to_string(),
                filter: "all".to_string(),
                root_id: Some(root.id),
                limit: Some(20),
                offset: Some(0),
            },
        )
        .expect("búsqueda tras eliminar");
        assert_eq!(search_after_delete.total_matches, 0);

        let _ = fs::remove_dir_all(&temp_root);
    }
}
