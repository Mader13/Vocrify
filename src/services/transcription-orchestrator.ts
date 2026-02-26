/**
 * Transcription Orchestrator
 *
 * Centralized service that manages transcription task lifecycle:
 * - Queue processing: starts queued tasks respecting concurrency limits
 * - Stale detection: marks stuck tasks as interrupted
 * - Pending deletion reconciliation: cleans up models scheduled for deletion
 *
 * Extracted from App.tsx useEffect hooks (Phase 3.1).
 */

import { useTasks } from "@/stores";
import { useModelsStore } from "@/stores/modelsStore";
import { transcribeWithFallback } from "./transcription";
import { getQueuedTaskIdsToStart } from "./transcription-queue";
import { collectStaleProcessingTaskIds } from "./transcription-heartbeat";
import { hasBlockingTasksForModel } from "@/stores/utils/model-deletion";
import { logger } from "@/lib/logger";

const STALE_THRESHOLD_MS = 2 * 60 * 1000;
const STALE_CHECK_INTERVAL_MS = 30 * 1000;

class TranscriptionOrchestrator {
  private staleIntervalId: ReturnType<typeof setInterval> | null = null;
  private unsubscribeTasks: (() => void) | null = null;
  private unsubscribeModels: (() => void) | null = null;
  private isRunning = false;
  private isProcessingQueue = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Stale detection on a fixed interval
    this.checkStaleTasks();
    this.staleIntervalId = setInterval(
      () => this.checkStaleTasks(),
      STALE_CHECK_INTERVAL_MS,
    );

    // React to task store changes for queue processing & deletion reconciliation
    this.unsubscribeTasks = useTasks.subscribe(() => {
      this.processTaskQueue();
      this.reconcilePendingDeletions();
    });

    // React to model store changes for deletion reconciliation
    this.unsubscribeModels = useModelsStore.subscribe(() => {
      this.reconcilePendingDeletions();
    });

    // Initial processing
    this.processTaskQueue();
    this.reconcilePendingDeletions();
  }

  stop(): void {
    if (this.staleIntervalId) {
      clearInterval(this.staleIntervalId);
      this.staleIntervalId = null;
    }
    this.unsubscribeTasks?.();
    this.unsubscribeTasks = null;
    this.unsubscribeModels?.();
    this.unsubscribeModels = null;
    this.isRunning = false;
  }

  private checkStaleTasks(): void {
    const now = Date.now();
    const { tasks, updateTaskStatus } = useTasks.getState();
    const staleTaskIds = collectStaleProcessingTaskIds(tasks, now, STALE_THRESHOLD_MS);

    staleTaskIds.forEach((taskId) => {
      const task = tasks.find((item) => item.id === taskId);
      const timeSinceLastUpdate = task?.lastProgressUpdate
        ? now - task.lastProgressUpdate
        : undefined;

      logger.transcriptionWarn(
        "Marking task as interrupted - no progress updates received",
        { taskId, timeSinceLastUpdate },
      );
      updateTaskStatus(
        taskId,
        "interrupted",
        undefined,
        "Transcription was interrupted: no progress received from backend. The task may have failed or been terminated.",
      );
    });
  }

  private processTaskQueue(): void {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const { tasks, updateTaskStatus, settings } = useTasks.getState();
      const { enginePreference, maxConcurrentTasks } = settings;
      const startTaskIds = new Set(getQueuedTaskIdsToStart(tasks, maxConcurrentTasks));

      logger.transcriptionDebug("Processing tasks", { total: tasks.length });

      tasks.forEach((task) => {
        logger.transcriptionDebug("Task status", { taskId: task.id, status: task.status });

        if (task.status !== "queued" || !startTaskIds.has(task.id) || !task.filePath) {
          return;
        }

        if (useModelsStore.getState().isModelPendingDeletion(task.options.model)) {
          logger.transcriptionWarn("Skipping queued task: model scheduled for deletion", {
            taskId: task.id,
            modelName: task.options.model,
          });
          updateTaskStatus(
            task.id,
            "failed",
            undefined,
            `Model "${task.options.model}" is scheduled for deletion and cannot start new transcription tasks.`,
          );
          return;
        }

        logger.transcriptionInfo("Starting task", { taskId: task.id, fileName: task.filePath });
        updateTaskStatus(task.id, "processing");
        transcribeWithFallback(task.id, task.filePath, task.options, enginePreference).catch(
          (error) => {
            logger.transcriptionError("Task failed", { taskId: task.id, error });
            updateTaskStatus(task.id, "failed", undefined, error.message);
          },
        );
      });
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private reconcilePendingDeletions(): void {
    const { pendingModelDeletions, reconcilePendingModelDeletions } =
      useModelsStore.getState();
    const pendingModels = Object.keys(pendingModelDeletions);

    if (pendingModels.length === 0) return;

    const { tasks } = useTasks.getState();
    const hasReadyDeletion = pendingModels.some(
      (modelName) => !hasBlockingTasksForModel(tasks, modelName),
    );

    if (!hasReadyDeletion) return;

    void reconcilePendingModelDeletions();
  }
}

export const orchestrator = new TranscriptionOrchestrator();
