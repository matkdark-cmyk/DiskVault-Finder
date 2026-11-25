use crate::storage::db::Database;
use rusqlite::{params_from_iter, types::Value};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub filter: String,
    pub root_id: Option<i64>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub id: i64,
    pub root_id: i64,
    pub root_name: String,
    pub root_status: String,
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
pub struct SearchResponse {
    pub items: Vec<SearchResultItem>,
    pub total_matches: i64,
    pub elapsed_ms: u64,
    pub query: String,
    pub filter: String,
}

fn escape_like_pattern(token: &str) -> String {
    let mut out = String::with_capacity(token.len());
    for ch in token.chars() {
        match ch {
            '\\' => out.push_str(r"\\"),
            '%' => out.push_str(r"\%"),
            '_' => out.push_str(r"\_"),
            _ => out.push(ch),
        }
    }
    out
}

fn escape_fts5_phrase(token: &str) -> String {
    format!("\"{}\"", token.replace('"', "\"\""))
}

pub fn execute_search(db: &Database, req: &SearchRequest) -> Result<SearchResponse, String> {
    let started = Instant::now();
    let trimmed_query = req.query.trim().to_string();
    let filter = req.filter.trim().to_ascii_lowercase();
    let limit = req.limit.unwrap_or(200).clamp(1, 1000) as i64;
    let offset = req.offset.unwrap_or(0) as i64;

    // Separar tokens de >= 3 caracteres (índice FTS5 trigram) y tokens cortos de 1-2 caracteres (ej. "4k")
    let tokens: Vec<&str> = trimmed_query
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .collect();

    let mut fts_phrases: Vec<String> = Vec::new();
    let mut short_tokens: Vec<String> = Vec::new();

    for token in &tokens {
        if token.chars().count() >= 3 {
            fts_phrases.push(escape_fts5_phrase(token));
        } else {
            short_tokens.push(token.to_lowercase());
        }
    }

    let use_fts = !fts_phrases.is_empty();
    let mut from_clause = String::from(
        "FROM indexed_entries e INNER JOIN watched_roots r ON r.id = e.root_id",
    );
    if use_fts {
        from_clause.push_str(" INNER JOIN entries_fts f ON f.rowid = e.id");
    }

    let mut where_clauses: Vec<String> = vec!["r.enabled = 1".to_string()];
    let mut where_params: Vec<Value> = Vec::new();

    if use_fts {
        where_clauses.push("entries_fts MATCH ?".to_string());
        where_params.push(Value::Text(fts_phrases.join(" ")));
    }

    for short in &short_tokens {
        let pattern = format!("%{}%", escape_like_pattern(short));
        where_clauses.push(
            "(lower(e.name) LIKE ? ESCAPE '\\' OR lower(e.full_path) LIKE ? ESCAPE '\\')"
                .to_string(),
        );
        where_params.push(Value::Text(pattern.clone()));
        where_params.push(Value::Text(pattern));
    }

    if let Some(root_id) = req.root_id {
        where_clauses.push("e.root_id = ?".to_string());
        where_params.push(Value::Integer(root_id));
    }

    match filter.as_str() {
        "all" | "" => {}
        "file" => {
            where_clauses.push("e.is_dir = 0".to_string());
        }
        "video" => {
            where_clauses.push("e.is_dir = 0 AND e.category = 'video'".to_string());
        }
        "folder" => {
            where_clauses.push("e.is_dir = 1".to_string());
        }
        "image" | "audio" | "document" | "archive" | "other" => {
            where_clauses.push("e.is_dir = 0 AND e.category = ?".to_string());
            where_params.push(Value::Text(filter.clone()));
        }
        _ => {
            return Err(format!(
                "Filtro de búsqueda no reconocido: '{filter}'."
            ));
        }
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let count_sql = format!("SELECT COUNT(*) {from_clause}{where_sql}");

    let mut select_params = where_params.clone();
    let order_sql = if !trimmed_query.is_empty() {
        select_params.push(Value::Text(trimmed_query.to_lowercase()));
        " ORDER BY CASE WHEN instr(lower(e.name), ?) > 0 THEN 0 ELSE 1 END ASC, e.is_dir DESC, e.modified_ts DESC, e.name COLLATE NOCASE ASC"
    } else {
        " ORDER BY e.is_dir DESC, e.modified_ts DESC, e.name COLLATE NOCASE ASC"
    };

    select_params.push(Value::Integer(limit));
    select_params.push(Value::Integer(offset));

    let select_sql = format!(
        "SELECT e.id, e.root_id, r.name, r.status, e.parent_path, e.full_path,
                e.name, e.extension, e.category, e.is_dir, e.size_bytes, e.modified_ts
         {from_clause}{where_sql}{order_sql}
         LIMIT ? OFFSET ?"
    );

    let (total_matches, items) = db.with_conn(|conn| {
        let total: i64 = conn.query_row(
            &count_sql,
            params_from_iter(where_params.iter()),
            |row| row.get(0),
        )?;

        let mut stmt = conn.prepare(&select_sql)?;
        let rows = stmt.query_map(params_from_iter(select_params.iter()), |row| {
            Ok(SearchResultItem {
                id: row.get(0)?,
                root_id: row.get(1)?,
                root_name: row.get(2)?,
                root_status: row.get(3)?,
                parent_path: row.get(4)?,
                full_path: row.get(5)?,
                name: row.get(6)?,
                extension: row.get(7)?,
                category: row.get(8)?,
                is_dir: row.get::<_, i64>(9)? != 0,
                size_bytes: row.get(10)?,
                modified_ts: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok((total, list))
    })?;

    Ok(SearchResponse {
        items,
        total_matches,
        elapsed_ms: started.elapsed().as_millis() as u64,
        query: trimmed_query,
        filter: if filter.is_empty() {
            "all".to_string()
        } else {
            filter
        },
    })
}

#[tauri::command]
pub fn search_entries(
    request: SearchRequest,
    state: State<'_, crate::AppState>,
) -> Result<SearchResponse, String> {
    execute_search(&state.db, &request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::IndexedEntryDraft;

    fn seed_test_db() -> (Database, i64, i64) {
        let db = Database::open_in_memory().expect("debe crear BD en memoria");
        let root_a = db
            .insert_watched_root("NAS Media", r"\\192.168.1.50\Media", true, "ready")
            .expect("debe crear root A");
        let root_b = db
            .insert_watched_root("Respaldo PC", r"D:\Respaldo", false, "ready")
            .expect("debe crear root B");

        db.replace_root_entries(
            root_a.id,
            &[
                IndexedEntryDraft {
                    parent_path: r"\\192.168.1.50\Media".to_string(),
                    full_path: r"\\192.168.1.50\Media\Vacaciones_2025".to_string(),
                    name: "Vacaciones_2025".to_string(),
                    extension: String::new(),
                    category: "folder".to_string(),
                    is_dir: true,
                    size_bytes: 0,
                    modified_ts: 1_735_689_500,
                },
                IndexedEntryDraft {
                    parent_path: r"\\192.168.1.50\Media\Vacaciones_2025".to_string(),
                    full_path: r"\\192.168.1.50\Media\Vacaciones_2025\Video_Vacaciones_2025_4K.mp4"
                        .to_string(),
                    name: "Video_Vacaciones_2025_4K.mp4".to_string(),
                    extension: "mp4".to_string(),
                    category: "video".to_string(),
                    is_dir: false,
                    size_bytes: 3_200_000_000,
                    modified_ts: 1_735_689_600,
                },
                IndexedEntryDraft {
                    parent_path: r"\\192.168.1.50\Media\Vacaciones_2025".to_string(),
                    full_path: r"\\192.168.1.50\Media\Vacaciones_2025\Foto_Playa.jpg".to_string(),
                    name: "Foto_Playa.jpg".to_string(),
                    extension: "jpg".to_string(),
                    category: "image".to_string(),
                    is_dir: false,
                    size_bytes: 4_500_000,
                    modified_ts: 1_735_689_550,
                },
            ],
        )
        .expect("debe cargar entradas root A");

        db.replace_root_entries(
            root_b.id,
            &[IndexedEntryDraft {
                parent_path: r"D:\Respaldo".to_string(),
                full_path: r"D:\Respaldo\Boleta_Vacaciones.pdf".to_string(),
                name: "Boleta_Vacaciones.pdf".to_string(),
                extension: "pdf".to_string(),
                category: "document".to_string(),
                is_dir: false,
                size_bytes: 120_000,
                modified_ts: 1_735_689_400,
            }],
        )
        .expect("debe cargar entradas root B");

        (db, root_a.id, root_b.id)
    }

    #[test]
    fn finds_partial_substrings_including_short_tokens_like_4k() {
        let (db, _, _) = seed_test_db();

        let by_word = execute_search(
            &db,
            &SearchRequest {
                query: "vacaciones".to_string(),
                filter: "video".to_string(),
                root_id: None,
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("debe buscar por palabra");
        assert_eq!(by_word.total_matches, 1);
        assert_eq!(by_word.items[0].name, "Video_Vacaciones_2025_4K.mp4");

        let by_4k = execute_search(
            &db,
            &SearchRequest {
                query: "4k".to_string(),
                filter: "all".to_string(),
                root_id: None,
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("debe buscar por subcadena corta '4k'");
        assert_eq!(by_4k.total_matches, 1);
        assert_eq!(by_4k.items[0].name, "Video_Vacaciones_2025_4K.mp4");

        let by_multi = execute_search(
            &db,
            &SearchRequest {
                query: "vacaciones 4k".to_string(),
                filter: "file".to_string(),
                root_id: None,
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("debe combinar FTS5 trigram y token corto");
        assert_eq!(by_multi.total_matches, 1);
        assert_eq!(by_multi.items[0].name, "Video_Vacaciones_2025_4K.mp4");
    }

    #[test]
    fn enforces_exact_category_and_root_filters() {
        let (db, root_a, root_b) = seed_test_db();

        // Filtro 'all' con 'vacaciones' -> carpeta + video + foto (está dentro de carpeta Vacaciones_2025) + pdf
        let all_res = execute_search(
            &db,
            &SearchRequest {
                query: "vacaciones".to_string(),
                filter: "all".to_string(),
                root_id: None,
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("filtro all");
        assert_eq!(all_res.total_matches, 4);

        // Filtro 'file' excluye carpetas
        let file_res = execute_search(
            &db,
            &SearchRequest {
                query: "vacaciones".to_string(),
                filter: "file".to_string(),
                root_id: None,
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("filtro file");
        assert_eq!(file_res.total_matches, 3);
        assert!(file_res.items.iter().all(|i| !i.is_dir));

        // Filtro 'folder' devuelve solo carpetas
        let folder_res = execute_search(
            &db,
            &SearchRequest {
                query: "vacaciones".to_string(),
                filter: "folder".to_string(),
                root_id: None,
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("filtro folder");
        assert_eq!(folder_res.total_matches, 1);
        assert!(folder_res.items[0].is_dir);
        assert_eq!(folder_res.items[0].name, "Vacaciones_2025");

        // Scope por root_id
        let root_b_res = execute_search(
            &db,
            &SearchRequest {
                query: "vacaciones".to_string(),
                filter: "all".to_string(),
                root_id: Some(root_b),
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("scope root_b");
        assert_eq!(root_b_res.total_matches, 1);
        assert_eq!(root_b_res.items[0].name, "Boleta_Vacaciones.pdf");
        assert_ne!(root_b_res.items[0].root_id, root_a);

        // Pausar root_b debe excluir sus resultados sin borrar su caché
        db.set_watched_root_enabled(root_b, false)
            .expect("debe pausar root_b");
        let after_pause = execute_search(
            &db,
            &SearchRequest {
                query: "vacaciones".to_string(),
                filter: "all".to_string(),
                root_id: None,
                limit: Some(50),
                offset: Some(0),
            },
        )
        .expect("búsqueda tras pausar root_b");
        assert_eq!(after_pause.total_matches, 3);
    }
}
