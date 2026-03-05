/// Supported transcription engines
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineType {
    Whisper,
    Parakeet,
    GigaAM,
    Moonshine,
    SenseVoice,
}

impl EngineType {
    /// Detect engine type from model name
    pub fn from_model_name(model_name: &str) -> Option<Self> {
        if model_name.starts_with("whisper-") || model_name.starts_with("ggml-") {
            Some(EngineType::Whisper)
        } else if model_name.starts_with("parakeet-") {
            Some(EngineType::Parakeet)
        } else if model_name.starts_with("gigaam-") {
            Some(EngineType::GigaAM)
        } else if model_name.starts_with("moonshine-") {
            Some(EngineType::Moonshine)
        } else if model_name.starts_with("sense-") || model_name.starts_with("sensevoice-") {
            Some(EngineType::SenseVoice)
        } else {
            None
        }
    }
}
