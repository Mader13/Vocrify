use tauri::{AppHandle, State};

use crate::app_state::TranscriptionManagerState;

/// Wait for TranscriptionManager to be initialized (with timeout).
/// This is used by Rust transcription commands to ensure the manager is ready.
#[allow(dead_code)]
pub(crate) async fn ensure_manager_initialized(
    state: &State<'_, TranscriptionManagerState>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    crate::application::transcription::ensure_manager_initialized(state, app_handle).await
}

/// Initialize the transcription manager (call at app startup)
#[tauri::command]
pub(crate) async fn init_transcription_manager(
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    crate::application::transcription::init_transcription_manager(&app, &state).await
}

/// Load a model for Rust transcription
#[tauri::command]
pub(crate) async fn load_model_rust(
    model_name: String,
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    crate::application::transcription::load_model_rust(model_name, &app, &state).await
}

/// Unload current model
#[tauri::command]
pub(crate) async fn unload_model_rust(
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    crate::application::transcription::unload_model_rust(&app, &state).await
}

/// Check if a model is currently loaded
#[tauri::command]
pub(crate) async fn is_model_loaded_rust(
    state: State<'_, TranscriptionManagerState>,
) -> Result<bool, String> {
    crate::application::transcription::is_model_loaded_rust(&state).await
}

/// Get the currently loaded model name
#[tauri::command]
pub(crate) async fn get_current_model_rust(
    state: State<'_, TranscriptionManagerState>,
) -> Result<Option<String>, String> {
    crate::application::transcription::get_current_model_rust(&state).await
}
