use crate::{AppError, AudioInfo};

/// Convert audio file to WAV format (16kHz mono)
#[tauri::command]
pub(crate) async fn convert_audio_to_wav(
    input_path: String,
    output_path: String,
) -> Result<AudioInfo, String> {
    crate::application::audio::convert_audio_to_wav(input_path, output_path)
}

/// Get audio file duration
#[tauri::command]
pub(crate) async fn get_audio_duration(file_path: String) -> Result<f64, String> {
    crate::application::audio::get_audio_duration(file_path)
}

/// Extract audio segment and save as WAV
#[tauri::command]
pub(crate) async fn extract_audio_segment(
    file_path: String,
    start_ms: u64,
    end_ms: u64,
    output_path: String,
) -> Result<AudioInfo, String> {
    crate::application::audio::extract_audio_segment(file_path, start_ms, end_ms, output_path)
}

/// Get audio file metadata
#[tauri::command]
pub(crate) async fn get_audio_metadata(file_path: String) -> Result<AudioInfo, String> {
    crate::application::audio::get_audio_metadata(file_path)
}

/// Generate waveform peaks for a media file without loading into RAM fully
#[tauri::command]
pub(crate) async fn generate_waveform_peaks(
    file_path: String,
    target_peaks: usize,
) -> Result<Vec<f32>, AppError> {
    crate::application::audio::generate_waveform_peaks(file_path, target_peaks).await
}
