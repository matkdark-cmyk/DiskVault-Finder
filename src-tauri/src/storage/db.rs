use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FinderSettings {
    pub theme_mode: String,
    pub auto_refresh_hours: u32,
    pub refresh_on_startup: bool,
    pub start_with_windows: bool,
    #[serde(default = "default_true")]
    pub start_minimized_to_tray: bool,
    pub minimize_to_tray: bool,
    #[serde(default = "default_search_filter")]
    pub default_search_filter: String,
    #[serde(default = "default_view_mode")]
    pub default_view_mode: String,
    #[serde(default)]
    pub github_repo: String,
    #[serde(default = "default_true")]
    pub check_updates_on_startup: bool,
}

fn default_true() -> bool {
    true
}

fn default_search_filter() -> String {
    "all".to_string()
}

fn default_view_mode() -> String {
    "list".to_string()
}

pub type AppSettings = FinderSettings;

impl Default for FinderSettings {
    fn default() -> Self {
        Self {
            theme_mode: "system".to_string(),
            auto_refresh_hours: 3,
            refresh_on_startup: true,
            start_with_windows: false,
            start_minimized_to_tray: true,
            minimize_to_tray: true,
            default_search_filter: "all".to_string(),
            default_view_mode: "list".to_string(),
            github_repo: String::new(),
            check_updates_on_startup: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedRoot {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub is_network: bool,
    pub enabled: bool,
    pub status: String,
    pub last_indexed_at: Option<String>,
    pub item_count: i64,
    pub total_bytes: i64,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct IndexedEntryDraft {
    pub parent_path: String,
    pub full_path: String,
    pub name: String,
    pub extension: String,
    pub category: String,
    pub is_dir: bool,
    pub size_bytes: i64,
    pub modified_ts: i64,
}

pub struct Database {
    conn: Mutex<Connection>,
}

const SCHEMA_SQL: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS watched_roots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    is_network INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    last_indexed_at TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indexed_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id INTEGER NOT NULL REFERENCES watched_roots(id) ON DELETE CASCADE,
    parent_path TEXT NOT NULL,
    full_path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    extension TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    is_dir INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    modified_ts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_indexed_entries_root_parent
    ON indexed_entries(root_id, parent_path);
CREATE INDEX IF NOT EXISTS idx_indexed_entries_category
    ON indexed_entries(category);
CREATE INDEX IF NOT EXISTS idx_indexed_entries_is_dir
    ON indexed_entries(is_dir);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    name,
    full_path,
    content='indexed_entries',
    content_rowid='id',
    tokenize='trigram case_sensitive 0'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON indexed_entries BEGIN
    INSERT INTO entries_fts(rowid, name, full_path)
    VALUES (new.id, new.name, new.full_path);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON indexed_entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, name, full_path)
    VALUES ('delete', old.id, old.name, old.full_path);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON indexed_entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, name, full_path)
    VALUES ('delete', old.id, old.name, old.full_path);
    INSERT INTO entries_fts(rowid, name, full_path)
    VALUES (new.id, new.name, new.full_path);
END;

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('theme_mode', 'system');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_refresh_hours', '3');
INSERT OR IGNORE INTO settings (key, value) VALUES ('refresh_on_startup', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('start_with_windows', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('start_minimized_to_tray', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('minimize_to_tray', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_search_filter', 'all');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_view_mode', 'list');
INSERT OR IGNORE INTO settings (key, value) VALUES ('github_repo', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('check_updates_on_startup', 'true');
"#;

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| {
            format!(
                "No se pudo abrir la base de datos SQLite en '{}': {e}",
                path.display()
            )
        })?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.initialize_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("No se pudo crear la base de datos SQLite en memoria: {e}"))?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.initialize_schema()?;
        Ok(db)
    }

    fn initialize_schema(&self) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "No se pudo bloquear la conexión a SQLite.".to_string())?;
        conn.execute_batch(SCHEMA_SQL)
            .map_err(|e| format!("Error al inicializar el esquema SQLite FTS5: {e}"))?;
        Ok(())
    }

    pub fn with_conn<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "No se pudo acceder a la base de datos SQLite.".to_string())?;
        f(&conn).map_err(|e| format!("Error de base de datos SQLite: {e}"))
    }

    pub fn with_conn_mut<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut Connection) -> Result<T, String>,
    {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "No se pudo acceder a la base de datos SQLite.".to_string())?;
        f(&mut conn)
    }

    pub fn get_settings(&self) -> Result<FinderSettings, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
            let rows = stmt.query_map([], |row| {
                let key: String = row.get(0)?;
                let value: String = row.get(1)?;
                Ok((key, value))
            })?;

            let mut settings = FinderSettings::default();
            for item in rows {
                let (key, value) = item?;
                match key.as_str() {
                    "theme_mode" => settings.theme_mode = value,
                    "auto_refresh_hours" => {
                        if let Ok(hours) = value.parse::<u32>() {
                            settings.auto_refresh_hours = hours;
                        }
                    }
                    "refresh_on_startup" => settings.refresh_on_startup = value == "true",
                    "start_with_windows" => settings.start_with_windows = value == "true",
                    "start_minimized_to_tray" => {
                        settings.start_minimized_to_tray = value == "true"
                    }
                    "minimize_to_tray" => settings.minimize_to_tray = value == "true",
                    "default_search_filter" => settings.default_search_filter = value,
                    "default_view_mode" => settings.default_view_mode = value,
                    "github_repo" => settings.github_repo = value,
                    "check_updates_on_startup" => {
                        settings.check_updates_on_startup = value == "true"
                    }
                    _ => {}
                }
            }
            Ok(settings)
        })
    }

    pub fn save_settings(&self, settings: &FinderSettings) -> Result<(), String> {
        let pairs: [(&str, String); 10] = [
            ("theme_mode", settings.theme_mode.clone()),
            ("auto_refresh_hours", settings.auto_refresh_hours.to_string()),
            (
                "refresh_on_startup",
                if settings.refresh_on_startup {
                    "true"
                } else {
                    "false"
                }
                .to_string(),
            ),
            (
                "start_with_windows",
                if settings.start_with_windows {
                    "true"
                } else {
                    "false"
                }
                .to_string(),
            ),
            (
                "start_minimized_to_tray",
                if settings.start_minimized_to_tray {
                    "true"
                } else {
                    "false"
                }
                .to_string(),
            ),
            (
                "minimize_to_tray",
                if settings.minimize_to_tray {
                    "true"
                } else {
                    "false"
                }
                .to_string(),
            ),
            (
                "default_search_filter",
                settings.default_search_filter.clone(),
            ),
            ("default_view_mode", settings.default_view_mode.clone()),
            ("github_repo", settings.github_repo.clone()),
            (
                "check_updates_on_startup",
                if settings.check_updates_on_startup {
                    "true"
                } else {
                    "false"
                }
                .to_string(),
            ),
        ];

        self.with_conn_mut(|conn| {
            let tx = conn
                .transaction()
                .map_err(|e| format!("No se pudo iniciar la transacción de ajustes: {e}"))?;
            {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO settings (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    )
                    .map_err(|e| format!("No se pudo preparar el guardado de ajustes: {e}"))?;
                for (key, value) in &pairs {
                    stmt.execute(params![key, value])
                        .map_err(|e| format!("No se pudo guardar el ajuste '{key}': {e}"))?;
                }
            }
            tx.commit()
                .map_err(|e| format!("No se pudo confirmar el guardado de ajustes: {e}"))?;
            Ok(())
        })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }

    pub fn get_minimize_to_tray(&self) -> bool {
        self.get_settings()
            .map(|s| s.minimize_to_tray)
            .unwrap_or(true)
    }

    pub fn list_watched_roots(&self) -> Result<Vec<WatchedRoot>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, path, is_network, enabled, status, last_indexed_at,
                        item_count, total_bytes, created_at
                 FROM watched_roots
                 ORDER BY id ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(WatchedRoot {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    is_network: row.get::<_, i64>(3)? != 0,
                    enabled: row.get::<_, i64>(4)? != 0,
                    status: row.get(5)?,
                    last_indexed_at: row.get(6)?,
                    item_count: row.get(7)?,
                    total_bytes: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?;

            let mut roots = Vec::new();
            for row in rows {
                roots.push(row?);
            }
            Ok(roots)
        })
    }

    pub fn insert_watched_root(
        &self,
        name: &str,
        path: &str,
        is_network: bool,
        status: &str,
    ) -> Result<WatchedRoot, String> {
        let created_at = Utc::now().to_rfc3339();
        let conn = self
            .conn
            .lock()
            .map_err(|_| "No se pudo acceder a la base de datos SQLite.".to_string())?;

        let result = conn.execute(
            "INSERT INTO watched_roots (name, path, is_network, enabled, status, created_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)",
            params![name, path, if is_network { 1 } else { 0 }, status, created_at],
        );

        if let Err(err) = result {
            let msg = err.to_string();
            if msg.contains("UNIQUE constraint failed") {
                return Err(format!(
                    "La ruta '{path}' ya está registrada en tus ubicaciones."
                ));
            }
            return Err(format!("No se pudo guardar la ubicación: {err}"));
        }

        let id = conn.last_insert_rowid();
        Ok(WatchedRoot {
            id,
            name: name.to_string(),
            path: path.to_string(),
            is_network,
            enabled: true,
            status: status.to_string(),
            last_indexed_at: None,
            item_count: 0,
            total_bytes: 0,
            created_at,
        })
    }

    pub fn delete_watched_root(&self, id: i64) -> Result<(), String> {
        let affected = self.with_conn(|conn| {
            conn.execute("DELETE FROM watched_roots WHERE id = ?1", params![id])
        })?;

        if affected == 0 {
            return Err("La ubicación seleccionada ya no existe en la base de datos.".to_string());
        }
        Ok(())
    }

    pub fn get_watched_root_by_id(&self, id: i64) -> Result<Option<WatchedRoot>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, path, is_network, enabled, status, last_indexed_at,
                        item_count, total_bytes, created_at
                 FROM watched_roots
                 WHERE id = ?1",
            )?;
            let row = stmt.query_row(params![id], |row| {
                Ok(WatchedRoot {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    is_network: row.get::<_, i64>(3)? != 0,
                    enabled: row.get::<_, i64>(4)? != 0,
                    status: row.get(5)?,
                    last_indexed_at: row.get(6)?,
                    item_count: row.get(7)?,
                    total_bytes: row.get(8)?,
                    created_at: row.get(9)?,
                })
            });

            match row {
                Ok(root) => Ok(Some(root)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(err) => Err(err),
            }
        })
    }

    pub fn update_root_status(&self, id: i64, status: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE watched_roots SET status = ?1 WHERE id = ?2",
                params![status, id],
            )?;
            Ok(())
        })
    }

    pub fn set_watched_root_enabled(&self, id: i64, enabled: bool) -> Result<WatchedRoot, String> {
        let affected = self.with_conn(|conn| {
            conn.execute(
                "UPDATE watched_roots SET enabled = ?1 WHERE id = ?2",
                params![if enabled { 1 } else { 0 }, id],
            )
        })?;
        if affected == 0 {
            return Err("La ubicación seleccionada ya no existe.".to_string());
        }
        self.get_watched_root_by_id(id)?
            .ok_or_else(|| "No se pudo recargar la ubicación actualizada.".to_string())
    }

    pub fn rename_watched_root(&self, id: i64, new_name: &str) -> Result<WatchedRoot, String> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err("El nombre visible de la ubicación no puede estar vacío.".to_string());
        }
        let affected = self.with_conn(|conn| {
            conn.execute(
                "UPDATE watched_roots SET name = ?1 WHERE id = ?2",
                params![trimmed, id],
            )
        })?;
        if affected == 0 {
            return Err("La ubicación seleccionada ya no existe.".to_string());
        }
        self.get_watched_root_by_id(id)?
            .ok_or_else(|| "No se pudo recargar la ubicación renombrada.".to_string())
    }

    pub fn clear_all_indexed_entries(&self) -> Result<(), String> {
        self.with_conn_mut(|conn| {
            let tx = conn
                .transaction()
                .map_err(|e| format!("No se pudo iniciar la limpieza del caché: {e}"))?;
            tx.execute("DELETE FROM indexed_entries", [])
                .map_err(|e| format!("No se pudo limpiar el índice local: {e}"))?;
            tx.execute(
                "UPDATE watched_roots
                 SET status = 'pending', item_count = 0, total_bytes = 0, last_indexed_at = NULL",
                [],
            )
            .map_err(|e| format!("No se pudieron restablecer las estadísticas de raíces: {e}"))?;
            tx.commit()
                .map_err(|e| format!("No se pudo confirmar la limpieza del caché: {e}"))?;
            Ok(())
        })
    }

    pub fn optimize_and_vacuum(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "INSERT INTO entries_fts(entries_fts) VALUES('optimize');
                 PRAGMA wal_checkpoint(TRUNCATE);
                 VACUUM;",
            )?;
            Ok(())
        })
    }

    pub fn query_cache_counts(&self) -> Result<(i64, i64, i64, i64, i64, i64, Option<String>), String> {
        self.with_conn(|conn| {
            let (total_roots, enabled_roots, last_indexed_at): (i64, i64, Option<String>) =
                conn.query_row(
                    "SELECT COUNT(*),
                            COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0),
                            MAX(last_indexed_at)
                     FROM watched_roots",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;

            let (total_entries, total_files, total_dirs, total_indexed_bytes): (i64, i64, i64, i64) =
                conn.query_row(
                    "SELECT COUNT(*),
                            COALESCE(SUM(CASE WHEN is_dir = 0 THEN 1 ELSE 0 END), 0),
                            COALESCE(SUM(CASE WHEN is_dir = 1 THEN 1 ELSE 0 END), 0),
                            COALESCE(SUM(CASE WHEN is_dir = 0 THEN size_bytes ELSE 0 END), 0)
                     FROM indexed_entries",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )?;

            Ok((
                total_roots,
                enabled_roots,
                total_entries,
                total_files,
                total_dirs,
                total_indexed_bytes,
                last_indexed_at,
            ))
        })
    }

    pub fn replace_root_entries(
        &self,
        root_id: i64,
        entries: &[IndexedEntryDraft],
    ) -> Result<(i64, i64, String), String> {
        let indexed_at = Utc::now().to_rfc3339();
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "No se pudo acceder a la base de datos SQLite.".to_string())?;

        let tx = conn
            .transaction()
            .map_err(|e| format!("No se pudo iniciar la transacción de indexación: {e}"))?;

        tx.execute(
            "DELETE FROM indexed_entries WHERE root_id = ?1",
            params![root_id],
        )
        .map_err(|e| format!("No se pudo limpiar el índice anterior de la ubicación: {e}"))?;

        let mut total_bytes: i64 = 0;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO indexed_entries
                     (root_id, parent_path, full_path, name, extension, category, is_dir, size_bytes, modified_ts)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )
                .map_err(|e| format!("No se pudo preparar la inserción de archivos: {e}"))?;

            for entry in entries {
                if !entry.is_dir && entry.size_bytes > 0 {
                    total_bytes += entry.size_bytes;
                }
                stmt.execute(params![
                    root_id,
                    entry.parent_path,
                    entry.full_path,
                    entry.name,
                    entry.extension,
                    entry.category,
                    if entry.is_dir { 1 } else { 0 },
                    entry.size_bytes,
                    entry.modified_ts,
                ])
                .map_err(|e| {
                    format!(
                        "No se pudo guardar '{}' en el índice SQLite: {e}",
                        entry.name
                    )
                })?;
            }
        }

        let item_count = entries.len() as i64;
        tx.execute(
            "UPDATE watched_roots
             SET status = 'ready', last_indexed_at = ?1, item_count = ?2, total_bytes = ?3
             WHERE id = ?4",
            params![indexed_at, item_count, total_bytes, root_id],
        )
        .map_err(|e| format!("No se pudo actualizar el resumen de la ubicación: {e}"))?;

        tx.commit()
            .map_err(|e| format!("No se pudo confirmar la transacción de caché SQLite: {e}"))?;

        Ok((item_count, total_bytes, indexed_at))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_default_settings() {
        let db = Database::open_in_memory().expect("debe crear BD en memoria");
        let settings = db.get_settings().expect("debe leer ajustes");
        assert_eq!(settings.theme_mode, "system");
        assert_eq!(settings.auto_refresh_hours, 3);
        assert!(settings.refresh_on_startup);
        assert!(!settings.start_with_windows);
        assert!(settings.minimize_to_tray);
    }

    #[test]
    fn fts5_trigram_finds_partial_substring_and_syncs_triggers() {
        let db = Database::open_in_memory().expect("debe crear BD en memoria");
        let root = db
            .insert_watched_root("NAS Videos", r"\\192.168.1.50\Videos", true, "pending")
            .expect("debe insertar raíz");

        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO indexed_entries
                 (root_id, parent_path, full_path, name, extension, category, is_dir, size_bytes, modified_ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    root.id,
                    r"\\192.168.1.50\Videos\Familia",
                    r"\\192.168.1.50\Videos\Familia\Video_Vacaciones_2025_4K.mp4",
                    "Video_Vacaciones_2025_4K.mp4",
                    "mp4",
                    "video",
                    0,
                    2_450_000_000_i64,
                    1_735_689_600_i64
                ],
            )?;
            conn.execute(
                "INSERT INTO indexed_entries
                 (root_id, parent_path, full_path, name, extension, category, is_dir, size_bytes, modified_ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    root.id,
                    r"\\192.168.1.50\Videos\Trabajo",
                    r"\\192.168.1.50\Videos\Trabajo\Informe_Anual.pdf",
                    "Informe_Anual.pdf",
                    "pdf",
                    "document",
                    0,
                    1_024_000_i64,
                    1_735_689_700_i64
                ],
            )?;
            Ok(())
        })
        .expect("debe insertar archivos de prueba");

        // Búsqueda parcial insensible a mayúsculas con FTS5 trigram ("vacaciones")
        let matches: Vec<String> = db
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT e.name
                     FROM entries_fts f
                     JOIN indexed_entries e ON e.id = f.rowid
                     WHERE entries_fts MATCH ?1",
                )?;
                let rows = stmt.query_map(params![r#""vacaciones""#], |row| row.get(0))?;
                let mut list = Vec::new();
                for r in rows {
                    list.push(r?);
                }
                Ok(list)
            })
            .expect("debe ejecutar consulta FTS5");

        assert_eq!(matches, vec!["Video_Vacaciones_2025_4K.mp4"]);

        // Comprobar trigger AFTER UPDATE (actualizando tanto name como full_path)
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE indexed_entries
                 SET name = 'Viaje_Patagonia_2025_4K.mp4',
                     full_path = '\\\\192.168.1.50\\Videos\\Familia\\Viaje_Patagonia_2025_4K.mp4'
                 WHERE name = 'Video_Vacaciones_2025_4K.mp4'",
                [],
            )?;
            Ok(())
        })
        .expect("debe actualizar registro");

        let old_count: i64 = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH ?1",
                    params![r#""vacaciones""#],
                    |row| row.get(0),
                )
            })
            .expect("debe contar coincidencias antiguas");
        assert_eq!(old_count, 0);

        let new_count: i64 = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH ?1",
                    params![r#""patagonia""#],
                    |row| row.get(0),
                )
            })
            .expect("debe contar coincidencias nuevas");
        assert_eq!(new_count, 1);

        // Comprobar ON DELETE CASCADE + trigger AFTER DELETE al eliminar la raíz
        db.delete_watched_root(root.id)
            .expect("debe eliminar raíz y sus entradas");

        let remaining_fts: i64 = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH ?1",
                    params![r#""patagonia""#],
                    |row| row.get(0),
                )
            })
            .expect("debe verificar limpieza en FTS5");
        assert_eq!(remaining_fts, 0);
    }
}
