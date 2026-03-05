use crate::post_processing::PostProcessing;
use crate::timeline_normalizer::TimelineNormalizer;
use crate::types::TranscriptionSegment;

use super::TranscriptionStage;

pub fn send_stage(
    stage_sender: Option<&tokio::sync::mpsc::UnboundedSender<TranscriptionStage>>,
    stage: TranscriptionStage,
) {
    if let Some(tx) = stage_sender {
        let _ = tx.send(stage);
    }
}

#[cfg(feature = "rust-transcribe")]
pub fn to_internal_segments(
    segments: Vec<transcribe_rs::TranscriptionSegment>,
) -> Vec<TranscriptionSegment> {
    segments
        .into_iter()
        .map(|s| TranscriptionSegment {
            start: s.start as f64,
            end: s.end as f64,
            text: s.text,
            speaker: None,
            confidence: 1.0,
        })
        .collect()
}

pub fn normalize_and_filter_segments(
    raw_segments: Vec<TranscriptionSegment>,
    total_audio_duration: f64,
    engine_name: &str,
) -> Vec<TranscriptionSegment> {
    let normalized_segments =
        TimelineNormalizer::normalize_segment_timeline(&raw_segments, total_audio_duration);
    if normalized_segments.len() < raw_segments.len() {
        eprintln!(
            "[ASR] {} timeline normalization dropped {} invalid/duplicate segment(s)",
            engine_name,
            raw_segments.len() - normalized_segments.len()
        );
    }

    let segments = PostProcessing::filter_hallucinations(&normalized_segments);
    if segments.len() < normalized_segments.len() {
        eprintln!(
            "[VAD] Filtered {} hallucination segment(s) out of {}",
            normalized_segments.len() - segments.len(),
            normalized_segments.len()
        );
    }

    segments
}