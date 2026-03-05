use std::sync::atomic::Ordering;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::app_state;

const TRAY_ID: &str = "main-tray";
const TRAY_MENU_SHOW_ID: &str = "tray_show_main_window";
const TRAY_MENU_QUIT_ID: &str = "tray_quit_app";

#[cfg(target_os = "windows")]
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.ico");

#[cfg(not(target_os = "windows"))]
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");

pub(crate) fn show_and_focus_main_window(app: &AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.unminimize();
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
}

async fn has_active_work_now(app: &AppHandle) -> bool {
    let task_manager_state = app.state::<app_state::TaskManagerState>();
    let manager = task_manager_state.lock().await;
    !manager.running_tasks.is_empty() || !manager.queued_tasks.is_empty()
}

fn confirm_quit_if_active_work(app: &AppHandle) -> bool {
    app.dialog()
        .message("Active transcription tasks are still running or queued. Quit anyway?")
        .title("Confirm Quit")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show()
}

pub(crate) async fn request_app_quit(app: AppHandle) {
    let quit_guard = app.state::<app_state::QuitGuardState>();

    if quit_guard.swap(true, Ordering::SeqCst) {
        return;
    }

    let has_active_before = has_active_work_now(&app).await;
    if has_active_before && !confirm_quit_if_active_work(&app) {
        quit_guard.store(false, Ordering::SeqCst);
        return;
    }

    let has_active_after = has_active_work_now(&app).await;
    if has_active_after && !confirm_quit_if_active_work(&app) {
        quit_guard.store(false, Ordering::SeqCst);
        return;
    }

    app.exit(0);
}

pub(crate) fn setup_tray_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let title_item = MenuItem::with_id(app, "tray_title", "Vocrify", false, None::<&str>)?;
    let show_item = MenuItem::with_id(app, TRAY_MENU_SHOW_ID, "Open", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&title_item, &show_item, &quit_item])?;
    let tray_icon = Image::from_bytes(TRAY_ICON_BYTES).map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("failed to decode tray icon bytes: {}", error),
        )
    })?;

    let app_handle = app.app_handle();
    let app_handle_for_menu = app_handle.clone();
    let app_handle_for_tray_click = app_handle.clone();

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |_app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW_ID => {
                show_and_focus_main_window(&app_handle_for_menu);
            }
            TRAY_MENU_QUIT_ID => {
                let handle = app_handle_for_menu.clone();
                tauri::async_runtime::spawn(async move {
                    request_app_quit(handle).await;
                });
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_and_focus_main_window(&app_handle_for_tray_click);
            }
        })
        .build(app)?;

    Ok(())
}

pub(crate) fn read_close_behavior(app: &AppHandle) -> app_state::CloseBehavior {
    let close_behavior_state = app.state::<app_state::CloseBehaviorState>();
    let behavior = match close_behavior_state.read() {
        Ok(guard) => *guard,
        Err(_) => app_state::CloseBehavior::HideToTray,
    };

    behavior
}
