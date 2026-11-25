pub mod copier;
pub mod explorer;
pub mod indexer;
pub mod search;
pub mod storage;
pub mod tray;

use copier::stream::CopierState;
use indexer::engine::IndexerState;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use storage::{
    db::Database,
    paths::{resolve_app_paths, AppPaths},
};
use tauri::{Manager, Theme};
use tokio::sync::Notify;

pub struct AppState {
    pub db: Arc<Database>,
    pub paths: AppPaths,
    pub is_quitting: AtomicBool,
    pub scheduler_notify: Arc<Notify>,
}

pub fn parse_window_theme(mode: &str) -> Result<Option<Theme>, String> {
    match mode {
        "system" => Ok(None),
        "dark" => Ok(Some(Theme::Dark)),
        "light" => Ok(Some(Theme::Light)),
        _ => Err(format!(
            "Modo de tema no válido: '{mode}'. Usa 'system', 'dark' o 'light'."
        )),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start_minimized = std::env::args().any(|arg| arg.eq_ignore_ascii_case("--minimized"));

    let paths = resolve_app_paths()
        .expect("No se pudieron inicializar las rutas de almacenamiento de DiskVault Finder");
    let db = Arc::new(
        Database::open(&paths.db_path)
            .expect("No se pudo abrir la base de datos SQLite de DiskVault Finder"),
    );
    let indexer_state = Arc::new(IndexerState::new());
    let copier_state = Arc::new(CopierState::new());
    let scheduler_notify = Arc::new(Notify::new());

    let initial_theme_mode = db
        .get_settings()
        .map(|s| s.theme_mode)
        .unwrap_or_else(|_| "system".to_string());

    let scheduler_db = Arc::clone(&db);
    let scheduler_indexer = Arc::clone(&indexer_state);
    let scheduler_notify_bg = Arc::clone(&scheduler_notify);

    let state = AppState {
        db,
        paths,
        is_quitting: AtomicBool::new(false),
        scheduler_notify,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .manage(indexer_state)
        .manage(copier_state)
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(target_theme) = parse_window_theme(&initial_theme_mode) {
                    let _ = window.set_theme(target_theme);
                }
                if start_minimized {
                    let _ = window.hide();
                }
            }

            tray::create_system_tray(app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            indexer::scheduler::start_auto_refresh_scheduler(
                app.handle().clone(),
                scheduler_db,
                scheduler_indexer,
                scheduler_notify_bg,
            );

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle();
                if let Some(app_state) = app_handle.try_state::<AppState>() {
                    if app_state.is_quitting.load(Ordering::SeqCst) {
                        return;
                    }
                    if app_state.db.get_minimize_to_tray() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            storage::roots::get_app_bootstrap,
            storage::roots::list_watched_roots,
            storage::roots::validate_nas_or_local_path,
            storage::roots::add_watched_root,
            storage::roots::remove_watched_root,
            storage::roots::toggle_watched_root,
            storage::roots::rename_watched_root,
            storage::roots::update_theme_mode,
            storage::settings::get_finder_settings,
            storage::settings::update_finder_settings,
            storage::settings::reset_finder_settings,
            storage::settings::open_data_folder,
            storage::settings::get_cache_stats,
            storage::settings::vacuum_cache_db,
            storage::settings::clear_all_cache,
            storage::smb::connect_smb_share,
            storage::updater::check_github_updates,
            storage::updater::open_github_release_url,
            storage::clean_import::detect_diskvault_clean_destinations,
            storage::clean_import::inspect_diskvault_clean_file,
            storage::clean_import::import_diskvault_clean_destinations,
            indexer::engine::refresh_all_roots,
            indexer::engine::refresh_single_root,
            indexer::engine::cancel_indexing,
            indexer::engine::get_index_progress,
            search::query::search_entries,
            explorer::browser::list_directory,
            explorer::opener::open_with_default_app,
            explorer::opener::open_with_dialog,
            explorer::opener::reveal_in_windows_explorer,
            explorer::opener::open_pc_path_in_explorer,
            explorer::ops::create_folder_on_nas,
            explorer::ops::rename_entry_on_nas,
            explorer::ops::move_entry_on_nas,
            explorer::ops::delete_entry_on_nas,
            explorer::ops::get_entry_properties,
            copier::stream::preflight_copy_to_pc,
            copier::stream::start_copy_to_pc,
            copier::stream::pause_or_resume_copy,
            copier::stream::cancel_active_copy,
            copier::stream::get_pc_quick_folders,
        ])
        .run(tauri::generate_context!())
        .expect("Error al iniciar DiskVault Finder");
}
