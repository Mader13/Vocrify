use crate::task_queue::{dequeue_next_task, enqueue_task, TaskManager};
use crate::transcription_orchestrator::cleanup_temp_wav_file;

use super::{QueuedTask, TranscriptionOptions};

fn create_options() -> TranscriptionOptions {
    TranscriptionOptions {
        model: "whisper-base".to_string(),
        device: "cpu".to_string(),
        language: "auto".to_string(),
        enable_diarization: false,
        diarization_provider: None,
        num_speakers: -1,
    }
}

#[test]
fn queue_contract_preserves_fifo_after_module_split() {
    let mut manager = TaskManager::default();

    enqueue_task(
        &mut manager.queued_tasks,
        QueuedTask {
            id: "first".to_string(),
            file_path: "a.wav".to_string(),
            options: create_options(),
        },
    );
    enqueue_task(
        &mut manager.queued_tasks,
        QueuedTask {
            id: "second".to_string(),
            file_path: "b.wav".to_string(),
            options: create_options(),
        },
    );

    let first = dequeue_next_task(&mut manager.queued_tasks).expect("first exists");
    let second = dequeue_next_task(&mut manager.queued_tasks).expect("second exists");

    assert_eq!(first.id, "first");
    assert_eq!(second.id, "second");
}

#[test]
fn cleanup_contract_removes_temp_file_only_when_flag_enabled() {
    let temp_path = std::env::temp_dir().join(format!(
        "transcribe-video-refactor-contract-{}.wav",
        std::process::id()
    ));

    std::fs::write(&temp_path, b"wav").expect("temp file created");
    cleanup_temp_wav_file(&temp_path, true);
    assert!(!temp_path.exists());
}
