use tauri::{AppHandle, State};

use crate::{app_state::{CloseBehavior, CloseBehaviorState, TaskManagerState}, AppError};

#[allow(dead_code)]
pub(crate) fn parse_close_behavior(value: &str) -> CloseBehavior {
    crate::application::lifecycle::parse_close_behavior(value)
}

#[allow(dead_code)]
pub(crate) fn close_behavior_to_str(value: CloseBehavior) -> &'static str {
    crate::application::lifecycle::close_behavior_to_str(value)
}

/// Open archive directory in system file manager
#[tauri::command]
pub(crate) async fn open_archive_folder_command(app: AppHandle) -> Result<(), AppError> {
    crate::application::lifecycle::open_archive_folder(&app)
}

/// Open application directory in system file manager
#[tauri::command]
pub(crate) async fn open_app_directory_command(app: AppHandle) -> Result<(), AppError> {
    crate::application::lifecycle::open_app_directory(&app)
}

#[tauri::command]
pub(crate) async fn set_close_behavior_command(
    close_behavior_state: State<'_, CloseBehaviorState>,
    close_behavior: String,
) -> Result<(), AppError> {
    crate::application::lifecycle::set_close_behavior(&close_behavior_state, close_behavior)
}

#[tauri::command]
pub(crate) async fn get_close_behavior_command(
    close_behavior_state: State<'_, CloseBehaviorState>,
) -> Result<String, AppError> {
    crate::application::lifecycle::get_close_behavior(&close_behavior_state)
}

#[tauri::command]
pub(crate) async fn has_active_work_now(
    task_manager: State<'_, TaskManagerState>,
) -> Result<bool, AppError> {
    crate::application::lifecycle::has_active_work_now(&task_manager).await
}

#[tauri::command]
pub(crate) async fn quit_application_command(app: AppHandle) -> Result<(), AppError> {
    crate::application::lifecycle::quit_application(&app);
    Ok(())
}
