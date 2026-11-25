use crate::indexer::engine::{trigger_refresh_all, IndexerState};
use crate::storage::db::Database;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Runtime};
use tokio::sync::Notify;

/// Inicia el planificador en segundo plano:
/// 1. Refresca al arrancar si `refresh_on_startup === true`.
/// 2. Comprueba periódicamente `auto_refresh_hours` y actualiza automáticamente el caché.
/// 3. Reacciona al instante cuando los ajustes cambian vía `settings_notify` sin reiniciar la app.
pub fn start_auto_refresh_scheduler<R: Runtime>(
    app: AppHandle<R>,
    db: Arc<Database>,
    indexer: Arc<IndexerState>,
    settings_notify: Arc<Notify>,
) {
    tauri::async_runtime::spawn(async move {
        // Pequeña espera inicial para no competir con el primer pintado de la ventana.
        tokio::time::sleep(Duration::from_secs(2)).await;

        let mut last_run = Instant::now();

        if let Ok(settings) = db.get_settings() {
            if settings.refresh_on_startup {
                let has_enabled_roots = db
                    .list_watched_roots()
                    .map(|roots| roots.iter().any(|r| r.enabled))
                    .unwrap_or(false);

                if has_enabled_roots {
                    let _ = trigger_refresh_all(
                        Arc::clone(&db),
                        Arc::clone(&indexer),
                        app.clone(),
                    )
                    .await;
                    last_run = Instant::now();
                }
            }
        }

        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = settings_notify.notified() => {
                    // Ajustes modificados: reevaluar inmediatamente el nuevo intervalo configurado.
                }
            }

            let hours = match db.get_settings() {
                Ok(s) => s.auto_refresh_hours,
                Err(_) => continue,
            };

            if hours == 0 {
                continue;
            }

            let interval = Duration::from_secs(u64::from(hours) * 3600);
            if last_run.elapsed() >= interval {
                let has_enabled_roots = db
                    .list_watched_roots()
                    .map(|roots| roots.iter().any(|r| r.enabled))
                    .unwrap_or(false);

                if has_enabled_roots {
                    let _ = trigger_refresh_all(
                        Arc::clone(&db),
                        Arc::clone(&indexer),
                        app.clone(),
                    )
                    .await;
                }
                last_run = Instant::now();
            }
        }
    });
}
