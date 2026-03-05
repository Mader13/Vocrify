use tauri::AppHandle;

use crate::{AppError, AudioInfo};

pub(crate) fn convert_audio_to_wav(
    app: &AppHandle,
    input_path: String,
    output_path: String,
) -> Result<AudioInfo, String> {
    let input = crate::path_validation::validate_scoped_existing_file_path(app, &input_path)
        .map_err(|e| e.to_string())?;
    let output = crate::path_validation::validate_scoped_output_path(app, &output_path)
        .map_err(|e| e.to_string())?;

    eprintln!("[AUDIO CMD] Converting {:?} to WAV at {:?}", input, output);

    let audio = crate::audio::converter::convert_to_wav(&input, &output)
        .map_err(|e| format!("Failed to convert audio: {}", e))?;

    Ok(AudioInfo {
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        duration: audio.duration(),
        format: "wav".to_string(),
    })
}

pub(crate) fn get_audio_duration(app: &AppHandle, file_path: String) -> Result<f64, String> {
    let path = crate::path_validation::validate_scoped_existing_file_path(app, &file_path)
        .map_err(|e| e.to_string())?;

    crate::audio::utils::get_duration(&path).map_err(|e| format!("Failed to get duration: {}", e))
}

pub(crate) fn extract_audio_segment(
    app: &AppHandle,
    file_path: String,
    start_ms: u64,
    end_ms: u64,
    output_path: String,
) -> Result<AudioInfo, String> {
    let input = crate::path_validation::validate_scoped_existing_file_path(app, &file_path)
        .map_err(|e| e.to_string())?;
    let output = crate::path_validation::validate_scoped_output_path(app, &output_path)
        .map_err(|e| e.to_string())?;

    eprintln!(
        "[AUDIO CMD] Extracting segment from {}ms to {}ms",
        start_ms, end_ms
    );

    let segment = crate::audio::utils::slice_audio(&input, start_ms, end_ms)
        .map_err(|e| format!("Failed to extract segment: {}", e))?;

    crate::audio::converter::save_wav(&segment, &output)
        .map_err(|e| format!("Failed to save segment: {}", e))?;

    Ok(AudioInfo {
        sample_rate: segment.sample_rate,
        channels: segment.channels,
        duration: segment.duration(),
        format: "wav".to_string(),
    })
}

pub(crate) fn get_audio_metadata(app: &AppHandle, file_path: String) -> Result<AudioInfo, String> {
    let path = crate::path_validation::validate_scoped_existing_file_path(app, &file_path)
        .map_err(|e| e.to_string())?;

    let audio = crate::audio::loader::load(&path)
        .map_err(|e| format!("Failed to load audio: {}", e))?;

    Ok(AudioInfo {
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        duration: audio.duration(),
        format: path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown")
            .to_string(),
    })
}

pub(crate) async fn generate_waveform_peaks(
    app: &AppHandle,
    file_path: String,
    target_peaks: usize,
) -> Result<Vec<f32>, AppError> {
    eprintln!(
        "[AUDIO] Request to generate {} peaks for {}",
        target_peaks, file_path
    );
    let path = crate::path_validation::validate_scoped_existing_file_path(app, &file_path)?;

    let peaks = tokio::task::spawn_blocking(move || {
        crate::audio::utils::generate_waveform_peaks(&path, target_peaks)
    })
    .await
    .map_err(|e| AppError::Other(format!("Task execution failed: {}", e)))?
    .map_err(|e| AppError::Other(format!("Peak generation failed: {}", e)))?;

    Ok(peaks)
}
