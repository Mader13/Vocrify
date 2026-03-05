/// Transcription options (matches frontend TranscriptionOptions)
#[derive(Debug, Clone)]
pub struct TranscriptionOptions {
    pub language: Option<String>,
    pub translate: bool,
    pub enable_diarization: bool,
    pub diarization_provider: Option<String>,
    pub num_speakers: i32,
    pub audio_profile: Option<String>,
}

impl Default for TranscriptionOptions {
    fn default() -> Self {
        Self {
            language: None,
            translate: false,
            enable_diarization: false,
            diarization_provider: None,
            num_speakers: 2,
            audio_profile: None,
        }
    }
}

pub fn normalize_diarization_provider(provider: String) -> String {
    let normalized = provider.trim().to_ascii_lowercase();
    if normalized == "sherpa-onnx" {
        "native".to_string()
    } else {
        normalized
    }
}

pub fn normalize_optional_language(language: Option<String>) -> Option<String> {
    language.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Implement From for frontend TranscriptionOptions (camelCase)
impl From<crate::TranscriptionOptions> for TranscriptionOptions {
    fn from(opts: crate::TranscriptionOptions) -> Self {
        Self {
            language: normalize_optional_language(Some(opts.language)),
            translate: false,
            enable_diarization: opts.enable_diarization,
            diarization_provider: opts.diarization_provider.map(normalize_diarization_provider),
            num_speakers: opts.num_speakers,
            audio_profile: opts.audio_profile,
        }
    }
}

/// Implement From for RustTranscriptionOptions (Phase 3: transcribe-rs)
impl From<crate::RustTranscriptionOptions> for TranscriptionOptions {
    fn from(opts: crate::RustTranscriptionOptions) -> Self {
        Self {
            language: normalize_optional_language(opts.language),
            translate: false,
            enable_diarization: opts.enable_diarization,
            diarization_provider: opts.diarization_provider.map(normalize_diarization_provider),
            num_speakers: opts.num_speakers,
            audio_profile: opts.audio_profile,
        }
    }
}