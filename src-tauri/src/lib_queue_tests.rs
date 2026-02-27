use super::{
    dequeue_next_task, enqueue_task, should_process_next_after_cleanup, QueuedTask, TaskManager,
    TranscriptionOptions,
};

fn create_options() -> TranscriptionOptions {
    TranscriptionOptions {
        model: "whisper-base".to_string(),
        device: "cpu".to_string(),
        language: "auto".to_string(),
        enable_diarization: false,
        diarization_provider: None,
        num_speakers: -1,
        audio_profile: None,
    }
}

fn create_task(id: &str) -> QueuedTask {
    QueuedTask {
        id: id.to_string(),
        file_path: format!("/tmp/{id}.wav"),
        options: create_options(),
    }
}

#[test]
fn queue_is_fifo() {
    let mut manager = TaskManager::default();

    enqueue_task(&mut manager.queued_tasks, create_task("first"));
    enqueue_task(&mut manager.queued_tasks, create_task("second"));
    enqueue_task(&mut manager.queued_tasks, create_task("third"));

    let first = dequeue_next_task(&mut manager.queued_tasks).expect("first task should exist");
    let second = dequeue_next_task(&mut manager.queued_tasks).expect("second task should exist");
    let third = dequeue_next_task(&mut manager.queued_tasks).expect("third task should exist");

    assert_eq!(first.id, "first");
    assert_eq!(second.id, "second");
    assert_eq!(third.id, "third");
}

#[test]
fn cleanup_requests_next_task_when_queue_not_empty() {
    let mut manager = TaskManager::default();
    enqueue_task(&mut manager.queued_tasks, create_task("queued"));

    let should_process = should_process_next_after_cleanup(&mut manager, "finished-task");

    assert!(should_process);
}
