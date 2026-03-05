use tauri::{AppHandle, State};

use crate::{
    app_state::{TaskManagerState, TranscriptionManagerState},
    AppError, DiskUsage, LocalModel, SetModelsDirResponse,
};

/// Get models directory
#[tauri::command]
pub(crate) async fn get_models_dir_command(app: AppHandle) -> Result<String, AppError> {
    crate::application::models::get_models_dir(&app)
}

/// Update models directory
#[tauri::command]
pub(crate) async fn set_models_dir_command(
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
    models_dir: String,
    move_existing_models: Option<bool>,
) -> Result<SetModelsDirResponse, AppError> {
    crate::application::models::set_models_dir(&app, &state, models_dir, move_existing_models).await
}

/// Open models directory in system file manager
#[tauri::command]
pub(crate) async fn open_models_folder_command(app: AppHandle) -> Result<(), AppError> {
    crate::application::models::open_models_folder(&app)
}

/// Download a model
#[tauri::command]
pub(crate) async fn download_model(
    app: AppHandle,
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
    model_type: String,
    hugging_face_token: Option<String>,
) -> Result<String, AppError> {
    crate::application::models::download_model(
        &app,
        &task_manager,
        model_name,
        model_type,
        hugging_face_token,
    )
    .await
}

/// Get list of installed models
#[tauri::command]
pub(crate) async fn get_local_models(app: AppHandle) -> Result<Vec<LocalModel>, AppError> {
    crate::application::models::get_local_models(&app)
}

/// Delete a model
#[tauri::command]
pub(crate) async fn delete_model(app: AppHandle, model_name: String) -> Result<(), AppError> {
    crate::application::models::delete_model(&app, model_name).await
}

/// Cancel a model download
#[tauri::command]
pub(crate) async fn cancel_model_download(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
) -> Result<(), AppError> {
    crate::application::models::cancel_model_download(&task_manager, model_name).await
}

/// Get disk usage
#[tauri::command]
pub(crate) async fn get_disk_usage(app: AppHandle) -> Result<DiskUsage, AppError> {
    crate::application::models::get_disk_usage(&app)
}

/// Clear model cache directories
#[tauri::command]
pub(crate) async fn clear_cache(app: AppHandle) -> Result<(), AppError> {
    crate::application::models::clear_cache(&app)
}

/// Save selected model to store
#[tauri::command]
pub(crate) async fn save_selected_model(app: AppHandle, model: String) -> Result<(), AppError> {
    crate::application::models::save_selected_model(&app, model)
}

/// Load selected model from store
#[tauri::command]
pub(crate) async fn load_selected_model(app: AppHandle) -> Result<Option<String>, AppError> {
    crate::application::models::load_selected_model(&app)
}
