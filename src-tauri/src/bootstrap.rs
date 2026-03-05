use std::path::PathBuf;
use std::sync::atomic::Ordering;

use tauri::{Manager, RunEvent, WindowEvent};

use crate::{
    app_state::{self, ManagedState, PerformanceConfigState, TranscriptionManagerState},
};
use crate::lifecycle::{
    read_close_behavior, request_app_quit, setup_tray_menu, show_and_focus_main_window,
};
use crate::models_dir::build_transcription_manager;

fn on_window_close_requested(window: &tauri::Window) {
    match read_close_behavior(&window.app_handle()) {
        app_state::CloseBehavior::HideToTray => {
            let _ = window.hide();
        }
        app_state::CloseBehavior::Exit => {
            let app_handle = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                request_app_quit(app_handle).await;
            });
        }
    }
}

fn resolve_app_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    match app_handle.path().app_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("[WARN] Failed to get app data dir for performance config: {}", e);
            // Use a temporary path for config loading - will use defaults
            PathBuf::from(".")
        }
    }
}

fn apply_startup_performance_config(app: &tauri::App, app_data_dir: &std::path::Path) {
    let loaded_config = crate::PerformanceConfig::load(app_data_dir);

    // Log performance configuration status on startup
    loaded_config.log_status();

    // Update the managed performance config state with loaded values
    if let Ok(mut config_guard) = app.state::<PerformanceConfigState>().write() {
        *config_guard = loaded_config;
        eprintln!("[INFO] Performance config state updated with loaded values");
    } else {
        eprintln!("[WARN] Failed to update performance config state, using defaults");
    }
}

fn spawn_lazy_transcription_manager_init(
    manager_state_inner: app_state::TranscriptionManagerState,
    app_handle_for_spawn: tauri::AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        eprintln!("[INFO] Starting lazy TranscriptionManager initialization...");
        let mut manager_guard = manager_state_inner.lock().await;

        // Double-check it wasn't already initialized
        if manager_guard.is_some() {
            eprintln!("[INFO] TranscriptionManager already initialized, skipping");
            return;
        }

        *manager_guard = match build_transcription_manager(&app_handle_for_spawn) {
            Ok(manager) => {
                eprintln!("[INFO] TranscriptionManager lazy initialization completed successfully");
                Some(manager)
            }
            Err(e) => {
                eprintln!("[WARN] Failed to initialize TranscriptionManager: {}", e);
                None
            }
        };
    });
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.app_handle();

    setup_tray_menu(app).map_err(|error| {
        Box::<dyn std::error::Error>::from(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("failed to setup tray menu: {}", error),
        ))
    })?;

    let app_data_dir = resolve_app_data_dir(&app_handle);
    apply_startup_performance_config(app, &app_data_dir);

    // Spawn async task to initialize TranscriptionManager in background
    // This prevents blocking the window creation during startup
    let manager_state = app.state::<TranscriptionManagerState>();
    let manager_state_inner = (*manager_state).clone(); // Clone the Arc to get 'static ownership
    let app_handle_for_spawn = app_handle.clone();
    spawn_lazy_transcription_manager_init(manager_state_inner, app_handle_for_spawn);

    Ok(())
}

pub(crate) fn build_app(managed_state: ManagedState) -> tauri::App {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_and_focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(managed_state.task_manager)
        .manage(managed_state.transcription_manager_state)
        .manage(managed_state.rust_task_handles)
        .manage(managed_state.performance_config_state)
        .manage(managed_state.quit_guard_state)
        .manage(managed_state.close_behavior_state)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                on_window_close_requested(window);
            }
        })
        .setup(setup_app)
        .invoke_handler(crate::command_registry::app_invoke_handler!())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
}

pub(crate) fn run_app(app: tauri::App) {
    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let quit_guard = app_handle.state::<app_state::QuitGuardState>();
            if !quit_guard.load(Ordering::SeqCst) {
                api.prevent_exit();
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    request_app_quit(app_handle).await;
                });
            }
        }
    });
}