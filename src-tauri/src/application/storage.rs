//! Storage use cases.

use tauri::AppHandle;

use crate::{AppError, storage};

pub use storage::{StorageInfo, TaskMetadata, TranscriptionTask};
pub use storage::StorageLocation;

pub(crate) async fn get_transcription_dir(app: &AppHandle) -> Result<String, AppError> {
    storage::get_transcription_dir(app.clone()).await
}

pub(crate) async fn save_transcription(
    app: &AppHandle,
    task: TranscriptionTask,
) -> Result<(), AppError> {
    storage::save_transcription(app.clone(), task).await
}

pub(crate) async fn load_transcription(
    app: &AppHandle,
    task_id: String,
) -> Result<TranscriptionTask, AppError> {
    storage::load_transcription(app.clone(), task_id).await
}

pub(crate) async fn delete_transcription(app: &AppHandle, task_id: String) -> Result<(), AppError> {
    storage::delete_transcription(app.clone(), task_id).await
}

pub(crate) async fn list_transcriptions(app: &AppHandle) -> Result<Vec<TaskMetadata>, AppError> {
    storage::list_transcriptions(app.clone()).await
}

pub(crate) async fn get_storage_info(app: &AppHandle) -> Result<StorageInfo, AppError> {
    storage::get_storage_info(app.clone()).await
}

pub(crate) async fn get_storage_location(app: &AppHandle) -> Result<StorageLocation, AppError> {
    storage::get_storage_location(app.clone()).await
}

pub(crate) async fn set_storage_location(
    app: &AppHandle,
    directory: String,
) -> Result<StorageLocation, AppError> {
    storage::set_storage_location(app.clone(), directory).await
}

pub(crate) async fn validate_storage_location(
    app: &AppHandle,
    directory: String,
) -> Result<String, AppError> {
    storage::validate_storage_location(app.clone(), directory).await
}

pub(crate) async fn open_storage_location(app: &AppHandle) -> Result<(), AppError> {
    storage::open_storage_location(app.clone()).await
}
