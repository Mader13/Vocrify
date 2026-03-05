use tauri::AppHandle;

use crate::application::storage::{self, StorageInfo, StorageLocation, TaskMetadata, TranscriptionTask};
use crate::AppError;

/// Get the transcription storage directory
#[tauri::command]
pub async fn get_transcription_dir(app: AppHandle) -> Result<String, AppError> {
    storage::get_transcription_dir(&app).await
}

/// Save a transcription task to file
#[tauri::command]
pub async fn save_transcription(app: AppHandle, task: TranscriptionTask) -> Result<(), AppError> {
    storage::save_transcription(&app, task).await
}

/// Load a transcription task from file
#[tauri::command]
pub async fn load_transcription(
    app: AppHandle,
    task_id: String,
) -> Result<TranscriptionTask, AppError> {
    storage::load_transcription(&app, task_id).await
}

/// Delete a transcription task file
#[tauri::command]
pub async fn delete_transcription(app: AppHandle, task_id: String) -> Result<(), AppError> {
    storage::delete_transcription(&app, task_id).await
}

/// List all transcription metadata
#[tauri::command]
pub async fn list_transcriptions(
    app: AppHandle,
) -> Result<Vec<TaskMetadata>, AppError> {
    storage::list_transcriptions(&app).await
}

/// Get storage information
#[tauri::command]
pub async fn get_storage_info(
    app: AppHandle,
) -> Result<StorageInfo, AppError> {
    storage::get_storage_info(&app).await
}

#[tauri::command]
pub async fn get_storage_location(app: AppHandle) -> Result<StorageLocation, AppError> {
    storage::get_storage_location(&app).await
}

#[tauri::command]
pub async fn set_storage_location(
    app: AppHandle,
    directory: String,
) -> Result<StorageLocation, AppError> {
    storage::set_storage_location(&app, directory).await
}

#[tauri::command]
pub async fn validate_storage_location(
    app: AppHandle,
    directory: String,
) -> Result<String, AppError> {
    storage::validate_storage_location(&app, directory).await
}

#[tauri::command]
pub async fn open_storage_location_command(app: AppHandle) -> Result<(), AppError> {
    storage::open_storage_location(&app).await
}
