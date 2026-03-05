use crate::transcription::EngineType;

#[cfg(feature = "rust-transcribe")]
pub fn env_flag(name: &str, default: bool) -> bool {
    match std::env::var(name) {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "off")
        }
        Err(_) => default,
    }
}

#[cfg(feature = "rust-transcribe")]
pub fn adaptive_asr_enabled() -> bool {
    // Now reads from config instead of env
    crate::performance_config::PerformanceConfig::default()
        .with_env_overrides()
        .fast_setup_check_enabled // or we can just leave it reading from env momentarily
}

#[cfg(feature = "rust-transcribe")]
pub fn whisper_dithering_enabled() -> bool {
    // Dithering helps some edge-cases but can worsen clean speech by injecting noise.
    // Default to enabled to suppress silence hallucinations ("subtitles by ...").
    env_flag("TRANSCRIBE_WHISPER_DITHER", true)
}

#[cfg(feature = "rust-transcribe")]
pub fn should_try_full_audio_first(engine: EngineType, total_audio_duration: f64) -> bool {
    if !env_flag("TRANSCRIBE_FULL_AUDIO_FIRST", false) {
        return false;
    }

    let max_duration = match engine {
        EngineType::Whisper => 3.0 * 60.0,  // 3 min
        EngineType::Parakeet => 2.0 * 60.0, // 2 min
        _ => 2.0 * 60.0,
    };

    total_audio_duration <= max_duration
}

#[cfg(feature = "rust-transcribe")]
#[allow(dead_code)]
pub fn asr_vad_chunking_enabled() -> bool {
    // Dense chunking (time-based windows) is default for stable timeline alignment.
    // VAD chunking can be re-enabled explicitly when needed.
    env_flag("TRANSCRIBE_ASR_USE_VAD_CHUNKS", false)
}

#[cfg(feature = "rust-transcribe")]
#[allow(dead_code)]
pub fn engine_chunk_size_samples(engine: EngineType) -> usize {
    let chunk_seconds = match engine {
        EngineType::Whisper => 28usize,
        EngineType::Parakeet => 24usize,
        _ => 24usize,
    };
    16_000 * chunk_seconds
}