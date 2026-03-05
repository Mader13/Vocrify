use std::path::Path;
use std::sync::Arc;

#[cfg(feature = "rust-transcribe")]
pub async fn load_audio_file(
    audio_path: &Path,
    audio_profile: Option<String>,
    apply_dithering: bool,
) -> Result<Arc<[f32]>, String> {
    let audio_path = audio_path.to_path_buf();
    let profile = audio_profile.unwrap_or_else(|| "standard".to_string());

    tokio::task::spawn_blocking(move || -> Result<Arc<[f32]>, String> {
        use crate::audio;

        eprintln!(
            "[INFO] Loading audio file using audio module: {:?}",
            audio_path
        );

        let audio_buffer =
            audio::loader::load(&audio_path).map_err(|e| format!("Failed to load audio: {}", e))?;

        let mono = if audio_buffer.channels > 1 {
            eprintln!("[INFO] Converting {} channels to mono", audio_buffer.channels);
            audio_buffer.to_mono()
        } else {
            audio_buffer
        };

        let mut resampled = if mono.sample_rate != 16000 {
            eprintln!("[INFO] Resampling from {}Hz to 16000Hz (Sinc)", mono.sample_rate);
            mono.resample(16000)
        } else {
            mono
        };
        // Smart Audio Processing Based on Profile
        if profile == "noisy" {
            eprintln!("[INFO] Audio Profile: Noisy. Applying DSP High-Pass Filter.");
            resampled.apply_high_pass_filter();
            // Global AGC is skipped here. It will be applied strictly per-segment
            // inside the transcription loop to avoid amplifying wind during silences.
        } else {
            // Phase 1: Peak Normalization for standard profile
            // We keep global AGC for standard clean clips to ensure uniform volume if it's generally quiet.
            resampled.normalize();
        }

        if apply_dithering {
            // Dithering reduces Whisper silence hallucinations, but should not affect other engines.
            resampled.apply_white_noise_dithering();
        }

        eprintln!(
            "[INFO] Loaded {} samples ({:.2}s)",
            resampled.samples.len(),
            resampled.samples.len() as f64 / 16000.0
        );

        Ok(Arc::<[f32]>::from(resampled.samples.into_boxed_slice()))
    })
    .await
    .map_err(|e| format!("Spawn blocking failed: {}", e))?
}