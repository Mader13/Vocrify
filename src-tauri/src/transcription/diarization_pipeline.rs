use std::sync::Arc;

use crate::diarization::{DiarizationConfig, DiarizationEngine};
use crate::types::{SpeakerTurn, TranscriptionSegment};

use super::{normalize_diarization_provider, TranscriptionStage};

pub fn log_diarization_stats(speaker_segments: &[TranscriptionSegment]) {
    eprintln!(
        "[DIARIZATION] Received {} segments from native engine",
        speaker_segments.len()
    );
    let unique_speakers: std::collections::HashSet<&str> = speaker_segments
        .iter()
        .filter_map(|s| s.speaker.as_deref())
        .collect();
    let mut durations_by_speaker: std::collections::BTreeMap<&str, f64> =
        std::collections::BTreeMap::new();
    for segment in speaker_segments {
        let duration = (segment.end - segment.start).max(0.0);
        *durations_by_speaker
            .entry(segment.speaker.as_deref().unwrap_or("UNKNOWN"))
            .or_insert(0.0) += duration;
    }
    eprintln!(
        "[DIARIZATION] Unique speakers from native engine: {} ({:?})",
        unique_speakers.len(),
        unique_speakers
    );
    eprintln!(
        "[DIARIZATION] Raw durations from native engine (s): {:?}",
        durations_by_speaker
    );
}

pub async fn run_native_diarization(
    engine: Arc<DiarizationEngine>,
    samples: Arc<[f32]>,
    diarization_provider: Option<String>,
    num_speakers: i32,
    stage_sender: Option<&tokio::sync::mpsc::UnboundedSender<TranscriptionStage>>,
) -> Result<(Vec<SpeakerTurn>, Vec<TranscriptionSegment>), String> {
    let requested_speakers = if num_speakers > 0 {
        Some(num_speakers)
    } else {
        None
    };

    let mut config = DiarizationConfig {
        num_speakers: requested_speakers,
        ..DiarizationConfig::default()
    };

    if let Some(provider) = diarization_provider {
        let normalized = normalize_diarization_provider(provider);
        if !normalized.is_empty() && normalized != "none" && normalized != "native" {
            config.provider = Some(normalized);
        }
    }

    let progress_sender = stage_sender.cloned();
    let progress_callback: Option<Arc<dyn Fn(u8) + Send + Sync>> = progress_sender.map(|tx| {
        Arc::new(move |pct: u8| {
            let _ = tx.send(TranscriptionStage::DiarizingProgress(pct));
        }) as Arc<dyn Fn(u8) + Send + Sync>
    });

    eprintln!("[DIARIZATION] Using native sherpa-rs");
    let speaker_segments = tokio::task::spawn_blocking(move || {
        engine.diarize_adaptive(samples, config, progress_callback)
    })
    .await
    .map_err(|e| format!("Diarization task join error: {e}"))??;

    let speaker_turns: Vec<SpeakerTurn> = speaker_segments
        .iter()
        .map(|s| SpeakerTurn {
            start: s.start,
            end: s.end,
            speaker: s.speaker.clone(),
        })
        .collect();

    let diarization_segments: Vec<TranscriptionSegment> = speaker_segments
        .into_iter()
        .map(|s| TranscriptionSegment {
            start: s.start,
            end: s.end,
            text: String::new(),
            speaker: Some(s.speaker),
            confidence: 1.0,
        })
        .collect();

    log_diarization_stats(&diarization_segments);

    Ok((speaker_turns, diarization_segments))
}