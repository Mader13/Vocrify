use tauri::{AppHandle, State};

use crate::{
    app_state::PerformanceConfigState, RuntimeReadinessStatus,
};

/// Check runtime environment status
#[tauri::command]
pub async fn check_runtime_environment(app: AppHandle) -> Result<crate::RuntimeCheckResult, String> {
    crate::application::setup::check_runtime_environment(&app).await
}

/// Check FFmpeg installation
#[tauri::command]
pub async fn check_ffmpeg_status(app: AppHandle) -> Result<crate::FFmpegCheckResult, String> {
    crate::application::setup::check_ffmpeg_status(&app).await
}

#[tauri::command]
pub async fn check_runtime_readiness(app: AppHandle) -> Result<RuntimeReadinessStatus, String> {
    crate::application::setup::check_runtime_readiness(&app).await
}

/// Check AI models installation status
#[tauri::command]
pub async fn check_models_status(app: AppHandle) -> Result<crate::ModelCheckResult, String> {
    crate::application::setup::check_models_status(&app).await
}

/// Get complete environment status
#[tauri::command]
pub async fn get_environment_status(app: AppHandle) -> Result<crate::EnvironmentStatus, String> {
    crate::application::setup::get_environment_status(&app).await
}

/// Mark setup as complete
/// Note: We skip runtime checks here because frontend already validated
/// runtimeCheck and ffmpegCheck status before enabling the finish button.
/// This avoids spawning extra runtime checks on every setup completion.
#[tauri::command]
pub async fn mark_setup_complete(app: AppHandle) -> Result<(), String> {
    crate::application::setup::mark_setup_complete(&app).await
}

/// Reset setup status (for re-run from settings)
#[tauri::command]
pub async fn reset_setup(app: AppHandle) -> Result<(), String> {
    crate::application::setup::reset_setup(&app)
}

/// Fast-path setup check using cached state.
/// Returns true if setup_state.json indicates setup completion.
/// Falls back to full is_setup_complete() check if cache is invalid/missing.
#[tauri::command]
pub async fn is_setup_complete_fast(
    app: AppHandle,
    perf_config: State<'_, PerformanceConfigState>,
) -> Result<bool, String> {
    crate::application::setup::is_setup_complete_fast(&app, &perf_config).await
}

/// Check if setup has been completed.
/// Returns true if setup was ever completed successfully (completed_at is set).
#[tauri::command]
pub async fn is_setup_complete(app: AppHandle) -> Result<bool, String> {
    crate::application::setup::is_setup_complete(&app).await
}
