use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

pub const TRAY_ID: &str = "diskvault-finder-tray";

pub fn show_and_focus_main_window<R: Runtime>(app: &AppHandle<R>, focus_search: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if focus_search {
            let _ = window.emit("focus-search", ());
        }
    }
}

pub fn create_system_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let open_item = MenuItem::with_id(app, "open", "Abrir Buscador", true, None::<&str>)
        .map_err(|e| format!("No se pudo crear la opción 'Abrir Buscador': {e}"))?;
    let refresh_item = MenuItem::with_id(
        app,
        "refresh",
        "Actualizar caché ahora",
        true,
        None::<&str>,
    )
    .map_err(|e| format!("No se pudo crear la opción 'Actualizar caché ahora': {e}"))?;
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|e| format!("No se pudo crear el separador del menú de bandeja: {e}"))?;
    let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)
        .map_err(|e| format!("No se pudo crear la opción 'Salir': {e}"))?;

    let menu = Menu::with_items(app, &[&open_item, &refresh_item, &separator, &quit_item])
        .map_err(|e| format!("No se pudo construir el menú de la bandeja del sistema: {e}"))?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("DiskVault Finder")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "open" => {
                show_and_focus_main_window(app_handle, true);
            }
            "refresh" => {
                let _ = app_handle.emit("tray-refresh-requested", ());
                if let (Some(app_state), Some(indexer)) = (
                    app_handle.try_state::<crate::AppState>(),
                    app_handle.try_state::<std::sync::Arc<crate::indexer::engine::IndexerState>>(),
                ) {
                    let db = std::sync::Arc::clone(&app_state.db);
                    let idx = std::sync::Arc::clone(&*indexer);
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::indexer::engine::trigger_refresh_all(db, idx, handle).await;
                    });
                }
            }
            "quit" => {
                if let Some(state) = app_handle.try_state::<crate::AppState>() {
                    state.is_quitting.store(true, Ordering::SeqCst);
                }
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_and_focus_main_window(tray.app_handle(), true);
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .build(app)
        .map_err(|e| format!("No se pudo inicializar el ícono en la bandeja del sistema: {e}"))?;

    Ok(())
}
