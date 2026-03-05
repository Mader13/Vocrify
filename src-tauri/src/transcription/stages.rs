/// Transcription stage for progress reporting
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptionStage {
    Transcribing,
    Diarizing,
    DiarizingProgress(u8),
}