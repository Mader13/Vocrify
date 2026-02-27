//! Audio converter module
//!
//! Converts audio to Whisper-compatible format (16kHz mono WAV)
//! and saves audio buffers to WAV files.

use anyhow::{Context, Result};
use hound::{WavSpec, WavWriter};
use std::path::Path;

use super::loader::AudioBuffer;

/// Convert audio to Whisper format (16kHz mono)
pub fn to_whisper_format(audio: AudioBuffer) -> Result<AudioBuffer> {
    eprintln!(
        "[AUDIO] Converting to Whisper format: sr={}, channels={}",
        audio.sample_rate, audio.channels
    );

    // Convert to mono if stereo/multi-channel
    let mono = if audio.channels > 1 {
        eprintln!("[AUDIO] Converting {} channels to mono", audio.channels);
        audio.to_mono()
    } else {
        audio.clone()
    };

    // Resample to 16kHz if needed
    let resampled = if mono.sample_rate != 16000 {
        eprintln!("[AUDIO] Resampling from {}Hz to 16000Hz", mono.sample_rate);
        mono.resample(16000)
    } else {
        mono
    };

    eprintln!(
        "[AUDIO] Whisper format ready: {} samples, sr=16000, channels=1",
        resampled.samples.len()
    );

    Ok(resampled)
}

/// Save audio buffer to WAV file
pub fn save_wav(audio: &AudioBuffer, path: &Path) -> Result<()> {
    eprintln!("[AUDIO] Saving WAV to: {:?}", path);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .context(format!("Failed to create directory: {:?}", parent))?;
    }

    // Create WAV spec for 16-bit PCM at audio's sample rate
    let spec = WavSpec {
        channels: audio.channels,
        sample_rate: audio.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer =
        WavWriter::create(path, spec).context(format!("Failed to create WAV file: {:?}", path))?;

    // Write samples (convert f32 [-1.0, 1.0] to i16)
    for &sample in &audio.samples {
        // Clamp to [-1.0, 1.0] and convert to i16
        let clamped = sample.clamp(-1.0, 1.0);
        let int_sample = (clamped * i16::MAX as f32) as i16;
        writer
            .write_sample(int_sample)
            .context(format!("Failed to write sample to WAV file: {:?}", path))?;
    }

    writer
        .finalize()
        .context(format!("Failed to finalize WAV file: {:?}", path))?;

    eprintln!("[AUDIO] Saved {} samples to WAV", audio.samples.len());

    Ok(())
}

/// Convert audio file to WAV format (16kHz mono)
pub fn convert_to_wav(input_path: &Path, output_path: &Path) -> Result<AudioBuffer> {
    eprintln!(
        "[AUDIO] Converting {:?} to WAV at {:?}",
        input_path, output_path
    );

    // Load audio
    let audio = super::loader::load(input_path)?;

    // Convert to Whisper format
    let whisper_format = to_whisper_format(audio)?;

    // Save to WAV
    save_wav(&whisper_format, output_path)?;

    Ok(whisper_format)
}
