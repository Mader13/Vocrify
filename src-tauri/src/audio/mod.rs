//! Audio processing module for Transcribe Video
//!
//! Provides unified audio loading, conversion, and processing using Rust-native libraries.
//! Uses fully native Rust audio processing.
//!
//! # Features
//! - Load audio from multiple formats (WAV, FLAC, MP3, M4A, MKV, OGG)
//! - Convert to Whisper-compatible format (16kHz mono)
//! - Extract audio segments
//! - Get audio metadata (duration, sample rate, channels)

pub mod converter;
pub mod loader;
pub mod utils;
pub mod vad;

pub use converter::{save_wav, to_whisper_format};
pub use loader::AudioBuffer;
pub use utils::{get_duration, merge_intervals, slice_audio};

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
#[path = "audio_tests.rs"]
mod tests;
