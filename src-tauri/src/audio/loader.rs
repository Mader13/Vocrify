//! Audio loader module
//!
//! Loads audio files in various formats using symphonia backend.
//! Supports: WAV, FLAC, MP3, M4A (AAC), MKV, OGG, ALAC

use anyhow::{anyhow, Context, Result};
use std::path::Path;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Audio buffer containing decoded PCM samples
#[derive(Debug, Clone)]
pub struct AudioBuffer {
    pub samples: Vec<f32>, // Normalized [-1.0, 1.0]
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioBuffer {
    /// Create a new AudioBuffer
    pub fn new(samples: Vec<f32>, sample_rate: u32, channels: u16) -> Self {
        Self {
            samples,
            sample_rate,
            channels,
        }
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

        let mono_samples: Vec<f32> = self
            .samples
            .chunks(self.channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / self.channels as f32)
            .collect();

        AudioBuffer {
            samples: mono_samples,
            sample_rate: self.sample_rate,
            channels: 1,
        }
    }

    /// Resample to a new sample rate using Sinc interpolation (rubato)
    pub fn resample(&self, target_rate: u32) -> AudioBuffer {
        if self.sample_rate == target_rate {
            return self.clone();
        }

        use rubato::{
            Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType,
            WindowFunction,
        };

        let ratio = target_rate as f64 / self.sample_rate as f64;

        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };

        let chunk_size = 1024;
        let mut resampler =
            match SincFixedIn::<f32>::new(ratio, 2.0, params, chunk_size, self.channels as usize) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!(
                        "[AUDIO] Failed to initialize Sinc resampler: {}, falling back to no-op",
                        e
                    );
                    return self.clone();
                }
            };

        let num_channels = self.channels as usize;
        let num_frames = self.samples.len() / num_channels;

        if num_frames == 0 {
            return self.clone();
        }

        let mut input_channels = vec![vec![0.0f32; num_frames]; num_channels];
        for (i, &sample) in self.samples.iter().enumerate() {
            let ch = i % num_channels;
            let frame = i / num_channels;
            input_channels[ch][frame] = sample;
        }

        let mut resampled_channels =
            vec![Vec::with_capacity((num_frames as f64 * ratio) as usize + 1024); num_channels];

        let mut input_buffer = resampler.input_buffer_allocate(true);
        let mut output_buffer = resampler.output_buffer_allocate(true);

        let mut in_idx = 0;

        while in_idx < num_frames {
            let frames_to_process = chunk_size.min(num_frames - in_idx);
            let is_last = in_idx + chunk_size >= num_frames;

            for ch in 0..num_channels {
                input_buffer[ch].clear();
                let end_idx = in_idx + frames_to_process;
                input_buffer[ch].extend_from_slice(&input_channels[ch][in_idx..end_idx]);

                if is_last && frames_to_process < chunk_size {
                    input_buffer[ch].resize(chunk_size, 0.0);
                }
            }

            match resampler.process_into_buffer(&input_buffer, &mut output_buffer, None) {
                Ok((_in_len, out_len)) => {
                    let final_out_len = if is_last && frames_to_process < chunk_size {
                        (frames_to_process as f64 * ratio).round() as usize
                    } else {
                        out_len
                    };

                    let safe_out_len = final_out_len.min(out_len);

                    for ch in 0..num_channels {
                        resampled_channels[ch]
                            .extend_from_slice(&output_buffer[ch][..safe_out_len]);
                    }
                }
                Err(e) => {
                    eprintln!("[AUDIO] Sinc resampler error at frame {}: {}", in_idx, e);
                    break;
                }
            }

            in_idx += chunk_size;
        }

        let new_num_frames = resampled_channels[0].len();
        let mut resampled = Vec::with_capacity(new_num_frames * num_channels);

        for frame in 0..new_num_frames {
            for ch in 0..num_channels {
                resampled.push(resampled_channels[ch][frame]);
            }
        }

        AudioBuffer {
            samples: resampled,
            sample_rate: target_rate,
            channels: self.channels,
        }
    }

    /// Apply AGC (Automatic Gain Control) normalization.
    /// WARNING: Do not apply this globally to noisy audio files, as it will amplify wind/background noise.
    /// Apply this ONLY to speech segments identified by VAD.
    pub fn normalize(&mut self) {
        let mut max_amp: f32 = 0.0;
        for &s in &self.samples {
            max_amp = max_amp.max(s.abs());
        }

        // Apply AGC if too quiet (below 0.99) OR if clipped (above 1.0) due to Sinc overshoot
        if max_amp > 0.0 {
            let factor = 0.99 / max_amp;

            // Limit highest amplification to ~10x (20dB) to avoid blowing up background noise
            let factor = factor.min(10.0);

            // Only normalize if difference is more than 5%
            if factor > 1.05 || factor < 0.95 {
                eprintln!("[AUDIO] AGC: Normalizing volume with factor {:.2} (max pre-norm abs amp: {:.2})", factor, max_amp);
                for s in &mut self.samples {
                    *s *= factor;
                }
            }
        }
    }

    /// Apply a 2nd-order Butterworth High-Pass Filter (cutoff ~150Hz)
    /// to strip wind rumble and mic handling noise while preserving human speech.
    pub fn apply_high_pass_filter(&mut self) {
        use biquad::*;

        // Human voice fundamental frequencies start around 85Hz (low male) to 165Hz (female)
        // Wind noise is heavily concentrated below 150Hz.
        // A 100Hz cutoff is a safe, standard high-pass filter for dialogue parsing.
        let cutoff_freq = 100.0.hz();
        let sample_rate = self.sample_rate.hz();

        // 2nd-order Butterworth filter Q-factor
        let q_factor = Q_BUTTERWORTH_F32;

        let coeffs = match Coefficients::<f32>::from_params(
            Type::HighPass,
            sample_rate,
            cutoff_freq,
            q_factor,
        ) {
            Ok(c) => c,
            Err(e) => {
                eprintln!(
                    "[AUDIO] DSP Error: Failed to generate biquad coefficients: {:?}",
                    e
                );
                return;
            }
        };

        let mut biquad1 = DirectForm1::<f32>::new(coeffs);

        // To prevent phase distortion (important for some audio models),
        // we process the biquad filter.
        let mut processed_samples = Vec::with_capacity(self.samples.len());
        for sample in &self.samples {
            processed_samples.push(biquad1.run(*sample));
        }

        self.samples = processed_samples;
        eprintln!("[AUDIO] Applied DSP High-Pass Filter (Butterworth 2nd-order, Cutoff: 100Hz)");
    }

    /// Внедрение маскировочного белого шума (White Noise Dithering).
    /// Абсолютная цифровая тишина (после VAD или чисто записанная) вызывает
    /// у моделей Whisper (особенно LargeV3) жесточайшие галлюцинации-субтитры
    /// из обучающей выборки (например, "Редактор субтитров Н.Закамолдина").
    ///
    /// Маленький и неслышимый для человека шум (амплитуда `0.0005`) заставляет
    /// Attention-механизм нейросети цепляться за него, понимая, что это реальная запись,
    /// где просто никто не говорит, и останавливает генерацию текста-галлюцинаций.
    pub fn apply_white_noise_dithering(&mut self) {
        // Pseudo-random number generator (XorShift32) to avoid adding heavyweight
        // rand crate dependencies just for simple noise generation
        let mut rng_state: u32 = 0x12345678;

        // Amplitude sets the noise floor to about -66dB (barely audible if cranked to 100%)
        let amplitude: f32 = 0.0005;

        for sample in self.samples.iter_mut() {
            // XorShift 32
            rng_state ^= rng_state << 13;
            rng_state ^= rng_state >> 17;
            rng_state ^= rng_state << 5;

            // Map u32 to float range [-1.0, 1.0]
            let noise_sample = ((rng_state as f32) / (u32::MAX as f32)) * 2.0 - 1.0;

            // Add noise and clamp to standard normalized boundary
            *sample = (*sample + noise_sample * amplitude).clamp(-1.0, 1.0);
        }

        eprintln!("[AUDIO] Applied generic White Noise Dithering (amplitude: {:.4}) to stop Whisper hallucinations", amplitude);
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
            "wav" => {
                hint.with_extension("wav");
            }
            "flac" => {
                hint.with_extension("flac");
            }
            "mp3" => {
                hint.with_extension("mp3");
            }
            "m4a" | "aac" => {
                hint.with_extension("m4a");
            }
            "mkv" => {
                hint.with_extension("mkv");
            }
            "ogg" => {
                hint.with_extension("ogg");
            }
            "alac" => {
                hint.with_extension("alac");
            }
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
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("No audio track found in file: {:?}", path))?;

    let track_id = track.id;
    let codec_params = &track.codec_params;

    // Get sample rate and channels
    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map_or(2, |c| c.count()) as u16;

    eprintln!(
        "[AUDIO] Track info: sample_rate={}, channels={}",
        sample_rate, channels
    );

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
                            AudioBufferRef::U16(ref buf) => {
                                buf.chan(ch)[i] as f32 / u16::MAX as f32
                            }
                            AudioBufferRef::U24(ref buf) => {
                                buf.chan(ch)[i].inner() as f32 / 16777215.0
                            }
                            AudioBufferRef::U32(ref buf) => {
                                buf.chan(ch)[i] as f32 / u32::MAX as f32
                            }
                            AudioBufferRef::S8(ref buf) => buf.chan(ch)[i] as f32 / 127.0,
                            AudioBufferRef::S16(ref buf) => {
                                buf.chan(ch)[i] as f32 / i16::MAX as f32
                            }
                            AudioBufferRef::S24(ref buf) => {
                                buf.chan(ch)[i].inner() as f32 / 8388607.0
                            }
                            AudioBufferRef::S32(ref buf) => {
                                buf.chan(ch)[i] as f32 / i32::MAX as f32
                            }
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

    eprintln!(
        "[AUDIO] Loaded {} samples ({:.2}s)",
        samples.len(),
        samples.len() as f64 / (sample_rate as f64 * channels as f64)
    );

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
    let samples: Vec<f32> = reader
        .samples()
        .filter_map(|r: Result<i16, _>| r.ok())
        .map(|s: i16| s as f32 / i16::MAX as f32)
        .collect();

    eprintln!("[AUDIO] Loaded {} samples with audrey", samples.len());

    Ok(AudioBuffer::new(samples, sample_rate as u32, channels))
}
