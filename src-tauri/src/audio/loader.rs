//! Audio loader module
//!
//! Loads audio files in various formats using symphonia backend.
//! Supports: WAV, FLAC, MP3, M4A (AAC), MKV, OGG, ALAC

use anyhow::{Result, Context, anyhow};
use std::path::Path;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Audio buffer containing decoded PCM samples
#[derive(Debug, Clone)]
pub struct AudioBuffer {
    pub samples: Vec<f32>,  // Normalized [-1.0, 1.0]
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioBuffer {
    /// Create a new AudioBuffer
    pub fn new(samples: Vec<f32>, sample_rate: u32, channels: u16) -> Self {
        Self { samples, sample_rate, channels }
    }

    /// Get duration in seconds
    pub fn duration(&self) -> f64 {
        if self.sample_rate == 0 || self.channels == 0 {
            0.0
        } else {
            self.samples.len() as f64 / (self.sample_rate as f64 * self.channels as f64)
        }
    }

    /// Convert stereo/multi-channel to mono by averaging
    pub fn to_mono(&self) -> AudioBuffer {
        if self.channels == 1 {
            return self.clone();
        }

        let mono_samples: Vec<f32> = self.samples
            .chunks(self.channels as usize)
            .map(|chunk| {
                chunk.iter().sum::<f32>() / self.channels as f32
            })
            .collect();

        AudioBuffer {
            samples: mono_samples,
            sample_rate: self.sample_rate,
            channels: 1,
        }
    }

    /// Resample to a new sample rate (simple linear interpolation)
    pub fn resample(&self, target_rate: u32) -> AudioBuffer {
        if self.sample_rate == target_rate {
            return self.clone();
        }

        let ratio = self.sample_rate as f64 / target_rate as f64;
        let new_len = (self.samples.len() as f64 / ratio) as usize;
        
        let mut resampled = Vec::with_capacity(new_len);
        
        for i in 0..new_len {
            let src_idx = (i as f64 * ratio) as usize;
            let next_idx = (src_idx + 1).min(self.samples.len() - 1);
            let frac = ((i as f64 * ratio) - src_idx as f64) as f32;
            
            let sample = self.samples[src_idx] * (1.0 - frac) + self.samples[next_idx] * frac;
            resampled.push(sample);
        }

        AudioBuffer {
            samples: resampled,
            sample_rate: target_rate,
            channels: self.channels,
        }
    }

    /// Slice audio from start_ms to end_ms
    pub fn slice(&self, start_ms: u64, end_ms: u64) -> AudioBuffer {
        let start_sample = (start_ms as f64 * self.sample_rate as f64 / 1000.0) as usize;
        let end_sample = (end_ms as f64 * self.sample_rate as f64 / 1000.0) as usize;
        
        let start_sample = start_sample.min(self.samples.len());
        let end_sample = end_sample.min(self.samples.len());
        
        let sliced_samples = if start_sample < end_sample {
            self.samples[start_sample..end_sample].to_vec()
        } else {
            Vec::new()
        };

        AudioBuffer {
            samples: sliced_samples,
            sample_rate: self.sample_rate,
            channels: self.channels,
        }
    }
}

/// Load audio file with automatic format detection
pub fn load(path: &Path) -> Result<AudioBuffer> {
    eprintln!("[AUDIO] Loading audio file: {:?}", path);

    // Create hint for format detection
    let mut hint = Hint::new();
    
    // Try to infer format from extension
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        match ext.to_lowercase().as_str() {
            "wav" => { hint.with_extension("wav"); }
            "flac" => { hint.with_extension("flac"); }
            "mp3" => { hint.with_extension("mp3"); }
            "m4a" | "aac" => { hint.with_extension("m4a"); }
            "mkv" => { hint.with_extension("mkv"); }
            "ogg" => { hint.with_extension("ogg"); }
            "alac" => { hint.with_extension("alac"); }
            _ => {}
        }
    }

    // Open file
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open audio file: {:?}", path))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Use default options
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    // Probe the media source
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .with_context(|| format!("Failed to probe audio file: {:?}", path))?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format.tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("No audio track found in file: {:?}", path))?;

    let track_id = track.id;
    let codec_params = &track.codec_params;

    // Get sample rate and channels
    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map_or(2, |c| c.count()) as u16;

    eprintln!("[AUDIO] Track info: sample_rate={}, channels={}", sample_rate, channels);

    // Create decoder
    let decoder_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(codec_params, &decoder_opts)
        .context(format!("Failed to create decoder for file: {:?}", path))?;

    // Decode all packets
    let mut samples: Vec<f32> = Vec::new();

    while let Ok(packet) = format.next_packet() {
        // Check if packet belongs to our track
        if packet.track_id() != track_id {
            continue;
        }

        // Decode the packet
        match decoder.decode(&packet) {
            Ok(decoded) => {
                // Get the audio buffer and convert to f32 samples
                // symphonia returns AudioBuffer which can be converted to samples
                use symphonia::core::audio::{AudioBufferRef, Signal};

                let spec = decoded.spec();
                let num_channels = spec.channels.count();

                // Get actual number of frames (samples per channel)
                let frames = decoded.frames();

                for i in 0..frames {
                    for ch in 0..num_channels {
                        // Access sample using AudioBuffer methods with ref to avoid move
                        let sample = match decoded {
                            AudioBufferRef::U8(ref buf) => buf.chan(ch)[i] as f32 / 128.0 - 1.0,
                            AudioBufferRef::U16(ref buf) => buf.chan(ch)[i] as f32 / u16::MAX as f32,
                            AudioBufferRef::U24(ref buf) => buf.chan(ch)[i].inner() as f32 / 16777215.0,
                            AudioBufferRef::U32(ref buf) => buf.chan(ch)[i] as f32 / u32::MAX as f32,
                            AudioBufferRef::S8(ref buf) => buf.chan(ch)[i] as f32 / 127.0,
                            AudioBufferRef::S16(ref buf) => buf.chan(ch)[i] as f32 / i16::MAX as f32,
                            AudioBufferRef::S24(ref buf) => buf.chan(ch)[i].inner() as f32 / 8388607.0,
                            AudioBufferRef::S32(ref buf) => buf.chan(ch)[i] as f32 / i32::MAX as f32,
                            AudioBufferRef::F32(ref buf) => buf.chan(ch)[i],
                            AudioBufferRef::F64(ref buf) => buf.chan(ch)[i] as f32,
                        };
                        samples.push(sample);
                    }
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => {
                // Skip decode errors (common at end of file)
                continue;
            }
            Err(e) => {
                eprintln!("[AUDIO] Decode error: {}", e);
                break;
            }
        }
    }

    eprintln!("[AUDIO] Loaded {} samples ({:.2}s)", samples.len(), samples.len() as f64 / (sample_rate as f64 * channels as f64));

    Ok(AudioBuffer::new(samples, sample_rate, channels))
}

/// Load audio using audrey (fallback for simpler formats)
#[allow(dead_code)]
fn load_with_audrey(path: &Path) -> Result<AudioBuffer> {
    use audrey::read::BufFileReader;

    eprintln!("[AUDIO] Loading with audrey: {:?}", path);

    let mut reader = BufFileReader::open(path)
        .context(format!("Failed to open audio file with audrey: {:?}", path))?;

    let desc = reader.description();
    let sample_rate = desc.sample_rate();
    let channels = desc.channel_count() as u16;

    // Read samples
    let samples: Vec<f32> = reader.samples()
        .filter_map(|r: Result<i16, _>| r.ok())
        .map(|s: i16| s as f32 / i16::MAX as f32)
        .collect();

    eprintln!("[AUDIO] Loaded {} samples with audrey", samples.len());

    Ok(AudioBuffer::new(samples, sample_rate as u32, channels))
}
