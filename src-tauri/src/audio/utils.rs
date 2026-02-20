//! Audio utilities module
//!
//! Provides utility functions for audio processing:
//! - Get audio duration
//! - Slice audio segments
//! - Merge intervals

use anyhow::Result;
use std::path::Path;

use super::loader::AudioBuffer;

/// Get audio duration in seconds
pub fn get_duration(path: &Path) -> Result<f64> {
    let audio = super::loader::load(path)?;
    Ok(audio.duration())
}

/// Extract audio segment from file
pub fn slice_audio(path: &Path, start_ms: u64, end_ms: u64) -> Result<AudioBuffer> {
    eprintln!("[AUDIO] Slicing {:?} from {}ms to {}ms", path, start_ms, end_ms);

    let audio = super::loader::load(path)?;
    let segment = audio.slice(start_ms, end_ms);

    eprintln!("[AUDIO] Sliced {} samples ({:.2}s)", 
        segment.samples.len(), segment.duration());

    Ok(segment)
}

/// Merge adjacent intervals with same speaker
/// 
/// # Arguments
/// * `intervals` - Slice of (start_ms, end_ms, speaker) tuples
/// * `gap_threshold_ms` - Maximum gap between intervals to merge
/// 
/// # Returns
/// Vec of merged (start_ms, end_ms, speaker) tuples
pub fn merge_intervals(
    intervals: &[(u64, u64, String)],
    gap_threshold_ms: u64,
) -> Vec<(u64, u64, String)> {
    if intervals.is_empty() {
        return Vec::new();
    }

    let mut merged: Vec<(u64, u64, String)> = Vec::new();
    let mut current_start = intervals[0].0;
    let mut current_end = intervals[0].1;
    let mut current_speaker = intervals[0].2.clone();

    for interval in &intervals[1..] {
        let (start, end, speaker) = interval;

        // If same speaker and gap is small enough, merge
        if speaker == &current_speaker && start.saturating_sub(current_end) <= gap_threshold_ms {
            current_end = *end;
        } else {
            // Push current and start new
            merged.push((current_start, current_end, current_speaker.clone()));
            current_start = *start;
            current_end = *end;
            current_speaker = speaker.clone();
        }
    }

    // Push last interval
    merged.push((current_start, current_end, current_speaker));

    merged
}

/// Calculate total duration from intervals
pub fn total_duration(intervals: &[(u64, u64, String)]) -> u64 {
    intervals.iter().map(|(_, end, _)| end).sum()
}

/// Check if two intervals overlap
pub fn intervals_overlap(a_start: u64, a_end: u64, b_start: u64, b_end: u64) -> bool {
    a_start < b_end && b_start < a_end
}
