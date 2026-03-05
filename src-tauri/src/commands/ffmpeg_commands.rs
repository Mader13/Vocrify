use tauri::AppHandle;

use crate::application::ffmpeg;

/// Check if FFmpeg is installed
#[tauri::command]
pub async fn get_ffmpeg_status(app: AppHandle) -> Result<crate::FFmpegStatusResponse, String> {
    ffmpeg::get_ffmpeg_status(&app).await
}

/// Download FFmpeg binary
#[tauri::command]
pub async fn download_ffmpeg(app: AppHandle) -> Result<(), String> {
    ffmpeg::download_ffmpeg(&app).await
}
