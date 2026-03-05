use tauri::AppHandle;

use crate::{AppError, FileMetadata, TranscriptionResult};

/// Select media files using native dialog
#[tauri::command]
pub async fn select_media_files(app: AppHandle) -> Result<Vec<String>, AppError> {
    crate::application::media::select_media_files(&app)
}

/// Export transcription to a file
#[tauri::command]
pub async fn export_transcription(
    app: AppHandle,
    result: TranscriptionResult,
    format: String,
    output_path: String,
    export_mode: Option<String>,
) -> Result<(), AppError> {
    crate::application::media::export_transcription(&app, result, format, output_path, export_mode)
}

/// Get file metadata including size
#[tauri::command]
pub async fn get_files_metadata(app: AppHandle, file_paths: Vec<String>) -> Result<Vec<FileMetadata>, AppError> {
    crate::application::media::get_files_metadata(&app, file_paths)
}

/// Read a file as Base64 encoded string
/// This is used for loading media files into WaveSurfer.js which cannot fetch from Tauri asset URLs
#[tauri::command]
pub async fn read_file_as_base64(app: AppHandle, file_path: String) -> Result<String, AppError> {
    crate::application::media::read_file_as_base64(&app, file_path)
}

/// Get file size in bytes
#[tauri::command]
pub async fn get_file_size(app: AppHandle, path: String) -> Result<u64, AppError> {
    crate::application::media::get_file_size(&app, path)
}

/// Delete a file
#[tauri::command]
pub async fn delete_file(app: AppHandle, path: String) -> Result<(), AppError> {
    crate::application::media::delete_file(&app, path)
}

/// Convert audio/video to MP3 using FFmpeg
#[tauri::command]
pub async fn convert_to_mp3(
    app: AppHandle,
    input_path: String,
    output_path: String,
) -> Result<String, AppError> {
    crate::application::media::convert_to_mp3(&app, input_path, output_path).await
}
