use std::collections::{HashMap, VecDeque};
use std::sync::{atomic::AtomicBool, Arc};

use tokio::sync::Mutex;

use crate::TranscriptionOptions;

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone)]
pub(crate) struct QueuedTask {
    pub(crate) id: String,
    #[allow(dead_code)]
    pub(crate) file_path: String,
    #[allow(dead_code)]
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
    #[allow(dead_code)]
    pub(crate) queue_processor_guard: Arc<tokio::sync::Mutex<()>>,
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn enqueue_task(queue: &mut VecDeque<QueuedTask>, task: QueuedTask) {
    queue.push_back(task);
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn dequeue_next_task(queue: &mut VecDeque<QueuedTask>) -> Option<QueuedTask> {
    queue.pop_front()
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn should_process_next_after_cleanup(manager: &mut TaskManager, task_id: &str) -> bool {
    manager.running_tasks.remove(task_id);
    !manager.queued_tasks.is_empty()
}
