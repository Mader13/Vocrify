use tauri::{AppHandle, State};

use crate::{
    app_state::{RustTaskHandles, TaskManagerState},
    AppError, DevicesResponse,
};

/// Cancel a running transcription task
#[tauri::command]
pub(crate) async fn cancel_transcription(
    task_manager: State<'_, TaskManagerState>,
    rust_handles: State<'_, RustTaskHandles>,
    task_id: String,
) -> Result<(), AppError> {
    crate::application::device::cancel_transcription(&task_manager, &rust_handles, task_id).await
}

/// Get the current queue status
#[tauri::command]
pub(crate) async fn get_queue_status(
    task_manager: State<'_, TaskManagerState>,
) -> Result<serde_json::Value, AppError> {
    crate::application::device::get_queue_status(&task_manager).await
}

/// Get available compute devices (CUDA, MPS, Vulkan, CPU)
#[tauri::command]
pub(crate) async fn get_available_devices(
    _app: AppHandle,
    refresh: bool,
) -> Result<DevicesResponse, AppError> {
    crate::application::device::get_available_devices(refresh).await
}
