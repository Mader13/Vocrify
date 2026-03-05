use crate::transcription_manager::{
    EngineType, TranscriptionManager, TranscriptionOptions, TranscriptionResult,
    TranscriptionSegment,
};
use tempfile::TempDir;

#[test]
fn test_engine_type_from_model_name() {
    assert_eq!(
        EngineType::from_model_name("whisper-base"),
        Some(EngineType::Whisper)
    );
    assert_eq!(
        EngineType::from_model_name("parakeet-tdt-0.6b-v3"),
        Some(EngineType::Parakeet)
    );
    assert_eq!(
        EngineType::from_model_name("gigaam-v3"),
        Some(EngineType::GigaAM)
    );
    assert_eq!(
        EngineType::from_model_name("moonshine-tiny"),
        Some(EngineType::Moonshine)
    );
    assert_eq!(
        EngineType::from_model_name("sense-voice"),
        Some(EngineType::SenseVoice)
    );
    assert_eq!(EngineType::from_model_name("unknown"), None);
}

#[test]
fn test_transcription_manager_new() {
    let temp_dir = TempDir::new().unwrap();
    let manager = TranscriptionManager::new(temp_dir.path(), None).unwrap();
    assert!(!manager.is_model_loaded());
}

#[test]
fn test_transcription_options_default() {
    let options = TranscriptionOptions::default();
    assert!(options.language.is_none());
    assert!(!options.translate);
    assert!(!options.enable_diarization);
    assert_eq!(options.num_speakers, 2);
}

#[test]
fn test_filter_hallucinations_removes_known_phrases() {
    let segments = vec![
        TranscriptionSegment {
            start: 0.0,
            end: 5.0,
            text: "Hello world".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 5.0,
            end: 8.0,
            text: "Thanks for watching".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 8.0,
            end: 12.0,
            text: "Thank you for watching".to_string(),
            speaker: None,
            confidence: 1.0,
        },
    ];
    let filtered = TranscriptionManager::filter_hallucinations(&segments);
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].text, "Hello world");
}

#[test]
fn test_filter_hallucinations_removes_russian_subtitle_credit() {
    let segments = vec![
        TranscriptionSegment {
            start: 0.0,
            end: 3.0,
            text: "Редактор субтитров Иван Петров".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 3.0,
            end: 7.0,
            text: "Это нормальная фраза из разговора".to_string(),
            speaker: None,
            confidence: 1.0,
        },
    ];
    let filtered = TranscriptionManager::filter_hallucinations(&segments);
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].text, "Это нормальная фраза из разговора");
}

#[test]
fn test_filter_hallucinations_keeps_sparse_but_valid_segments() {
    let segments = vec![
        TranscriptionSegment {
            start: 0.0,
            end: 5.0,
            text: "Normal speech with adequate density".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 10.0,
            end: 30.0,
            text: "Um hmm".to_string(),
            speaker: None,
            confidence: 1.0,
        },
    ];
    let filtered = TranscriptionManager::filter_hallucinations(&segments);
    assert_eq!(filtered.len(), 2);
    assert_eq!(filtered[1].text, "Um hmm");
}

#[test]
fn test_filter_hallucinations_removes_repetitive() {
    let segments = vec![
        TranscriptionSegment {
            start: 0.0,
            end: 3.0,
            text: "hello hello hello hello".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 3.0,
            end: 6.0,
            text: "this is real speech".to_string(),
            speaker: None,
            confidence: 1.0,
        },
    ];
    let filtered = TranscriptionManager::filter_hallucinations(&segments);
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].text, "this is real speech");
}

#[test]
fn test_filter_hallucinations_keeps_valid_segments() {
    let segments = vec![
        TranscriptionSegment {
            start: 0.0,
            end: 5.0,
            text: "This is a normal transcription segment".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 5.0,
            end: 10.0,
            text: "Another segment with enough content".to_string(),
            speaker: None,
            confidence: 1.0,
        },
    ];
    let filtered = TranscriptionManager::filter_hallucinations(&segments);
    assert_eq!(filtered.len(), 2);
}

#[test]
fn test_filter_hallucinations_removes_empty() {
    let segments = vec![
        TranscriptionSegment {
            start: 0.0,
            end: 1.0,
            text: "  ".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 1.0,
            end: 2.0,
            text: ".".to_string(),
            speaker: None,
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 2.0,
            end: 5.0,
            text: "Real words here".to_string(),
            speaker: None,
            confidence: 1.0,
        },
    ];
    let filtered = TranscriptionManager::filter_hallucinations(&segments);
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].text, "Real words here");
}

#[test]
fn test_normalized_speech_intervals_merges_small_gaps() {
    let segments = vec![
        TranscriptionSegment {
            start: 0.5,
            end: 1.0,
            text: String::new(),
            speaker: Some("SPEAKER_00".to_string()),
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 1.03,
            end: 1.4,
            text: String::new(),
            speaker: Some("SPEAKER_00".to_string()),
            confidence: 1.0,
        },
        TranscriptionSegment {
            start: 2.0,
            end: 2.3,
            text: String::new(),
            speaker: Some("SPEAKER_01".to_string()),
            confidence: 1.0,
        },
    ];

    let merged = TranscriptionManager::normalized_speech_intervals(&segments, 3.0);
    assert_eq!(merged.len(), 2);
    assert!((merged[0].0 - 0.5).abs() < 0.001);
    assert!((merged[0].1 - 1.4).abs() < 0.001);
    assert!((merged[1].0 - 2.0).abs() < 0.001);
    assert!((merged[1].1 - 2.3).abs() < 0.001);
}

#[test]
fn test_try_apply_soft_dga_rejects_too_low_coverage() {
    let audio = vec![1.0f32; 480_000];
    let segments = vec![TranscriptionSegment {
        start: 5.0,
        end: 5.1,
        text: String::new(),
        speaker: Some("SPEAKER_00".to_string()),
        confidence: 1.0,
    }];

    let masked = TranscriptionManager::try_apply_soft_dga(&audio, &segments, 16_000);
    assert!(masked.is_none());
}

#[test]
fn test_try_apply_soft_dga_attenuates_non_speech() {
    let audio = vec![1.0f32; 32_000];
    let segments = vec![TranscriptionSegment {
        start: 0.8,
        end: 1.2,
        text: String::new(),
        speaker: Some("SPEAKER_00".to_string()),
        confidence: 1.0,
    }];

    let masked = TranscriptionManager::try_apply_soft_dga(&audio, &segments, 16_000)
        .expect("soft dga should be applied");

    let outside_sample = masked[0];
    let inside_sample = masked[16_000];
    assert!(outside_sample < 0.1);
    assert!((inside_sample - 1.0).abs() < 0.001);
}

#[test]
fn test_try_apply_soft_dga_skips_when_mask_ends_too_early() {
    let audio = vec![1.0f32; 4_048_000];
    let segments = vec![TranscriptionSegment {
        start: 0.5,
        end: 179.0,
        text: String::new(),
        speaker: Some("SPEAKER_00".to_string()),
        confidence: 1.0,
    }];

    let masked = TranscriptionManager::try_apply_soft_dga(&audio, &segments, 16_000);
    assert!(masked.is_none());
}

#[test]
fn test_should_retry_without_dga_on_large_missing_tail() {
    let result = TranscriptionResult {
        segments: vec![TranscriptionSegment {
            start: 0.0,
            end: 179.0,
            text: "sample".to_string(),
            speaker: None,
            confidence: 1.0,
        }],
        language: "en".to_string(),
        duration: 179.0,
        speaker_turns: None,
        speaker_segments: None,
        metrics: None,
    };

    assert!(TranscriptionManager::should_retry_without_dga(
        &result, 253.0
    ));
}
