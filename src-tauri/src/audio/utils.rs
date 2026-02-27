//! Audio utilities module
//!
//! Provides utility functions for audio processing:
//! - Get audio duration
//! - Slice audio segments
//! - Merge intervals

use anyhow::Result;
use std::path::Path;
use symphonia::core::audio::Signal;

use super::loader::AudioBuffer;

/// Get audio duration in seconds
pub fn get_duration(path: &Path) -> Result<f64> {
    let audio = super::loader::load(path)?;
    Ok(audio.duration())
}

/// Extract audio segment from file
pub fn slice_audio(path: &Path, start_ms: u64, end_ms: u64) -> Result<AudioBuffer> {
    eprintln!(
        "[AUDIO] Slicing {:?} from {}ms to {}ms",
        path, start_ms, end_ms
    );

    let audio = super::loader::load(path)?;
    let segment = audio.slice(start_ms, end_ms);

    eprintln!(
        "[AUDIO] Sliced {} samples ({:.2}s)",
        segment.samples.len(),
        segment.duration()
    );

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

/// Generate downsampled waveform peaks natively using Symphonia (Streamed)
/// This reads the file packet-by-packet to compute peaks without loading
/// the entire audio track into RAM, which is crucial for 1GB+ video files.
pub fn generate_waveform_peaks(path: &Path, target_peaks: usize) -> Result<Vec<f32>> {
    use anyhow::Context;
    use symphonia::core::audio::AudioBufferRef;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    eprintln!(
        "[AUDIO] Generating {} waveform peaks from {:?}",
        target_peaks, path
    );

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext.to_lowercase().as_str());
    }

    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open file for peaks: {:?}", path))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .with_context(|| format!("Failed to probe file: {:?}", path))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow::anyhow!("No audio track found in file for peaks: {:?}", path))?;

    let track_id = track.id;
    let codec_params = &track.codec_params;
    let _channels = codec_params.channels.map_or(2, |c| c.count()) as usize;

    // Estimate total frames
    let _estimated_frames = match codec_params.n_frames {
        Some(frames) => frames,
        None => {
            // Rough estimation if exact frame count isn't specified
            if let Some(_tb) = codec_params.time_base {
                if let Some(ts) = track.codec_params.n_frames {
                    ts // fallback to something similar
                } else {
                    // We don't know the exact length, we'll collect all maxes and downsample at the end
                    0
                }
            } else {
                0
            }
        }
    };

    let decoder_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(codec_params, &decoder_opts)
        .context(format!("Failed to create decoder for file: {:?}", path))?;

    // Since we stream, we can either:
    // 1. Group samples into exactly `target_peaks` bins if we know total length
    // 2. Just accumulate local maxes every N samples, then downsample again at the end.
    // Let's use approach 2 to handle unknown duration properly.

    let mut all_peaks = Vec::new();
    // Accumulate the max over small blocks
    let block_size = 4096; // 4096 frames
    let mut current_block_max: f32 = 0.0;
    let mut frames_in_block = 0;

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let frames = decoded.frames();
                let spec = decoded.spec();
                let num_channels = spec.channels.count();

                for i in 0..frames {
                    let mut max_abs = 0.0f32;
                    // Aggregate across all channels to find max amplitude for this frame
                    for ch in 0..num_channels {
                        let sample = match decoded {
                            AudioBufferRef::U8(ref buf) => {
                                (buf.chan(ch)[i] as f32 / 128.0 - 1.0).abs()
                            }
                            AudioBufferRef::U16(ref buf) => {
                                (buf.chan(ch)[i] as f32 / u16::MAX as f32).abs()
                            }
                            AudioBufferRef::U24(ref buf) => {
                                (buf.chan(ch)[i].inner() as f32 / 16777215.0).abs()
                            }
                            AudioBufferRef::U32(ref buf) => {
                                (buf.chan(ch)[i] as f32 / u32::MAX as f32).abs()
                            }
                            AudioBufferRef::S8(ref buf) => (buf.chan(ch)[i] as f32 / 127.0).abs(),
                            AudioBufferRef::S16(ref buf) => {
                                (buf.chan(ch)[i] as f32 / i16::MAX as f32).abs()
                            }
                            AudioBufferRef::S24(ref buf) => {
                                (buf.chan(ch)[i].inner() as f32 / 8388607.0).abs()
                            }
                            AudioBufferRef::S32(ref buf) => {
                                (buf.chan(ch)[i] as f32 / i32::MAX as f32).abs()
                            }
                            AudioBufferRef::F32(ref buf) => buf.chan(ch)[i].abs(),
                            AudioBufferRef::F64(ref buf) => (buf.chan(ch)[i] as f32).abs(),
                        };
                        max_abs = max_abs.max(sample);
                    }

                    current_block_max = current_block_max.max(max_abs);
                    frames_in_block += 1;

                    if frames_in_block >= block_size {
                        all_peaks.push(current_block_max);
                        current_block_max = 0.0;
                        frames_in_block = 0;
                    }
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => {
                continue;
            }
            Err(e) => {
                eprintln!("[AUDIO] Decode error while generating peaks: {}", e);
                break;
            }
        }
    }

    // Push the last partial block
    if frames_in_block > 0 {
        all_peaks.push(current_block_max);
    }

    if all_peaks.is_empty() {
        return Ok(vec![0.0; target_peaks.max(1)]);
    }

    // Downsample `all_peaks` to exactly `target_peaks` using maximum pooling
    let mut final_peaks = Vec::with_capacity(target_peaks);
    if all_peaks.len() <= target_peaks {
        // If we have fewer blocks than target peaks, just send them (or duplicate)
        final_peaks.extend(all_peaks.iter().cloned());
        // Pad the rest with 0s if strictly requiring target length
    } else {
        // Binning
        let bin_size = all_peaks.len() as f64 / target_peaks as f64;
        for i in 0..target_peaks {
            let start = (i as f64 * bin_size).floor() as usize;
            let mut end = ((i + 1) as f64 * bin_size).ceil() as usize;
            end = end.min(all_peaks.len()).max(start); // ensure end >= start

            let mut bin_max = 0.0f32;
            for &p in &all_peaks[start..end] {
                bin_max = bin_max.max(p);
            }
            final_peaks.push(bin_max);
        }
    }

    eprintln!(
        "[AUDIO] Successfully generated {} peaks.",
        final_peaks.len()
    );
    Ok(final_peaks)
}
