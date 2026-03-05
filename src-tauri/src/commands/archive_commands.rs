use tauri::AppHandle;

use crate::AppError;

/// Copy file to another location (archive helper)
#[tauri::command]
pub async fn copy_file(
    app: AppHandle,
    source_path: String,
    dest_path: String,
) -> Result<String, AppError> {
    crate::application::archive::copy_file(&app, source_path, dest_path)
}

/// Compress media using FFmpeg.
///
/// Supported compression levels: none | light | medium | heavy.
/// Returns output path on success.
#[tauri::command]
pub async fn compress_media(
    app: AppHandle,
    input_path: String,
    output_path: String,
    compression: String,
) -> Result<String, AppError> {
    crate::application::archive::compress_media(&app, input_path, output_path, compression).await
}

/// Get or create the archive directory
#[tauri::command]
pub async fn get_archive_dir(app: AppHandle) -> Result<String, AppError> {
    crate::application::archive::get_archive_dir(&app)
}
