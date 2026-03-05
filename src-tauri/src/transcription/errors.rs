use thiserror::Error;

/// Transcription errors
#[derive(Debug, Error)]
pub enum TranscriptionError {
    #[error("Failed to load model: {0}")]
    ModelLoad(String),

    #[error("Failed to transcribe audio: {0}")]
    Transcription(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Engine not initialized")]
    EngineNotInitialized,

    #[error("Unsupported model format: {0}")]
    UnsupportedFormat(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}