//! Audio processing module for Transcribe Video
//!
//! Provides unified audio loading, conversion, and processing using Rust-native libraries.
//! Replaces Python-based audio processing (pydub, soundfile) with Rust equivalents.
//!
//! # Features
//! - Load audio from multiple formats (WAV, FLAC, MP3, M4A, MKV, OGG)
//! - Convert to Whisper-compatible format (16kHz mono)
//! - Extract audio segments
//! - Get audio metadata (duration, sample rate, channels)

pub mod loader;
pub mod converter;
pub mod utils;

pub use loader::AudioBuffer;
pub use converter::{to_whisper_format, save_wav};
pub use utils::{get_duration, slice_audio, merge_intervals};

use anyhow::Result;
use std::path::Path;

/// Load audio file with automatic format detection
pub fn load_audio_file(path: &Path) -> Result<AudioBuffer> {
    loader::load(path)
}

/// Convert audio to Whisper format (16kHz mono)
pub fn convert_to_whisper_format(audio: AudioBuffer) -> Result<AudioBuffer> {
    converter::to_whisper_format(audio)
}

/// Save audio buffer to WAV file
pub fn save_wav_file(audio: &AudioBuffer, path: &Path) -> Result<()> {
    converter::save_wav(audio, path)
}

/// Get audio duration in seconds
pub fn get_audio_duration(path: &Path) -> Result<f64> {
    utils::get_duration(path)
}

/// Extract audio segment from file
pub fn extract_audio_segment(path: &Path, start_ms: u64, end_ms: u64) -> Result<AudioBuffer> {
    utils::slice_audio(path, start_ms, end_ms)
}

#[cfg(test)]
mod tests;
