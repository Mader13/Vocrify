//! FFmpeg use cases.

use tauri::AppHandle;

pub(crate) async fn get_ffmpeg_status(app: &AppHandle) -> Result<crate::FFmpegStatusResponse, String> {
    crate::infrastructure::runtime::ffmpeg_manager::get_ffmpeg_status(app.clone()).await
}

pub(crate) async fn download_ffmpeg(app: &AppHandle) -> Result<(), String> {
    crate::infrastructure::runtime::ffmpeg_manager::download_ffmpeg(app.clone()).await
}
