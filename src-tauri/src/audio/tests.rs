//! Audio module tests

use super::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::utils::intervals_overlap;
    use tempfile::tempdir;

    #[test]
    fn test_audio_buffer_duration() {
        // 16000 samples at 16kHz = 1 second for mono
        let audio = AudioBuffer::new(vec![0.0; 16000], 16000, 1);
        assert!((audio.duration() - 1.0).abs() < 0.001);

        // 32000 samples at 16kHz = 2 seconds for mono
        let audio = AudioBuffer::new(vec![0.0; 32000], 16000, 1);
        assert!((audio.duration() - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_audio_buffer_to_mono() {
        // Stereo to mono
        let stereo = AudioBuffer::new(
            vec![0.2, 0.4, 0.6, 0.8], // 2 samples per channel
            16000,
            2,
        );
        let mono = stereo.to_mono();

        assert_eq!(mono.channels, 1);
        assert_eq!(mono.samples.len(), 2);
        // Average of each stereo pair
        assert!((mono.samples[0] - 0.3).abs() < 0.001); // (0.2 + 0.4) / 2
        assert!((mono.samples[1] - 0.7).abs() < 0.001); // (0.6 + 0.8) / 2
    }

    #[test]
    fn test_audio_buffer_resample() {
        // Resample from 44100 to 16000
        let samples: Vec<f32> = (0..44100).map(|i| (i as f32 * 0.001).sin()).collect();
        let audio = AudioBuffer::new(samples, 44100, 1);

        let resampled = audio.resample(16000);

        assert_eq!(resampled.sample_rate, 16000);
        assert_eq!(resampled.channels, 1);
        // Should have approximately 16000 samples
        assert!(resampled.samples.len() > 15900 && resampled.samples.len() < 16100);
    }

    #[test]
    fn test_audio_buffer_slice() {
        // 1 second of audio at 16kHz
        let samples: Vec<f32> = (0..16000).map(|i| (i as f32 * 0.001).sin()).collect();
        let audio = AudioBuffer::new(samples, 16000, 1);

        // Slice from 250ms to 750ms (500ms = 8000 samples)
        let sliced = audio.slice(250, 750);

        assert_eq!(sliced.sample_rate, 16000);
        assert_eq!(sliced.channels, 1);
        // 500ms should be 8000 samples
        assert!(sliced.samples.len() > 7900 && sliced.samples.len() < 8100);
    }

    #[test]
    fn test_save_and_load_wav() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");

        // Create test audio
        let samples: Vec<f32> = (0..16000).map(|i| (i as f32 * 0.001).sin()).collect();
        let original = AudioBuffer::new(samples.clone(), 16000, 1);

        // Save
        save_wav(&original, &wav_path).unwrap();

        // Load
        let loaded = loader::load(&wav_path).unwrap();

        // Verify (allow for some quantization error)
        assert_eq!(loaded.sample_rate, 16000);
        assert_eq!(loaded.channels, 1);
        assert_eq!(loaded.samples.len(), original.samples.len());

        // Check samples are close (16-bit quantization)
        for (orig, loaded) in original.samples.iter().zip(loaded.samples.iter()) {
            assert!((orig - loaded).abs() < 0.01);
        }
    }

    #[test]
    fn test_to_whisper_format() {
        // Create stereo 44.1kHz test audio
        let samples: Vec<f32> = (0..88200).map(|i| (i as f32 * 0.001).sin()).collect();
        let stereo = AudioBuffer::new(samples, 44100, 2);

        // Convert to whisper format
        let whisper = to_whisper_format(stereo).unwrap();

        assert_eq!(whisper.sample_rate, 16000);
        assert_eq!(whisper.channels, 1);
        // Duration should be approximately the same
        assert!((whisper.duration() - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_merge_intervals() {
        let intervals = vec![
            (0, 1000, "SPEAKER_0".to_string()),
            (1000, 2000, "SPEAKER_0".to_string()),
            (2500, 3500, "SPEAKER_0".to_string()), // 500ms gap
            (4000, 5000, "SPEAKER_1".to_string()),
            (5000, 6000, "SPEAKER_1".to_string()),
        ];

        // Merge with 1000ms threshold
        let merged = merge_intervals(&intervals, 1000);

        // Should merge first three (same speaker, gaps < 1000ms)
        // and last two (same speaker, no gap)
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].2, "SPEAKER_0");
        assert_eq!(merged[0].0, 0);
        assert_eq!(merged[0].1, 3500);
        assert_eq!(merged[1].2, "SPEAKER_1");
        assert_eq!(merged[1].0, 4000);
        assert_eq!(merged[1].1, 6000);
    }

    #[test]
    fn test_intervals_overlap() {
        assert!(intervals_overlap(0, 1000, 500, 1500)); // Overlap
        assert!(!intervals_overlap(0, 1000, 1000, 2000)); // Adjacent, no overlap
        assert!(!intervals_overlap(0, 1000, 1500, 2000)); // No overlap
    }
}
