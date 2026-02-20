use std::collections::{HashMap, VecDeque};
use std::sync::{atomic::AtomicBool, Arc};

use tokio::sync::Mutex;

use crate::TranscriptionOptions;

#[derive(Debug, Clone)]
pub(crate) struct QueuedTask {
    pub(crate) id: String,
    pub(crate) file_path: String,
    pub(crate) options: TranscriptionOptions,
}

#[derive(Debug)]
pub(crate) struct RunningTask {
    pub(crate) handle: tokio::task::JoinHandle<()>,
    pub(crate) child_process: Arc<Mutex<Option<tokio::process::Child>>>,
}

#[derive(Default)]
pub(crate) struct TaskManager {
    pub(crate) running_tasks: HashMap<String, RunningTask>,
    pub(crate) queued_tasks: VecDeque<QueuedTask>,
    pub(crate) downloading_models: HashMap<String, tokio::task::JoinHandle<()>>,
    pub(crate) downloading_processes: HashMap<String, Arc<Mutex<Option<tokio::process::Child>>>>,
    pub(crate) cancel_tokens: HashMap<String, Arc<AtomicBool>>,
    pub(crate) queue_processor_guard: Arc<tokio::sync::Mutex<()>>,
}

pub(crate) fn enqueue_task(queue: &mut VecDeque<QueuedTask>, task: QueuedTask) {
    queue.push_back(task);
}

pub(crate) fn dequeue_next_task(queue: &mut VecDeque<QueuedTask>) -> Option<QueuedTask> {
    queue.pop_front()
}

pub(crate) fn should_process_next_after_cleanup(manager: &mut TaskManager, task_id: &str) -> bool {
    manager.running_tasks.remove(task_id);
    !manager.queued_tasks.is_empty()
}
