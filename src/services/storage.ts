import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionTask } from "@/types";
import { logger } from "@/lib/logger";
import type { CommandResult } from "@/services/tauri/core";

/**
 * Task metadata returned from list_transcriptions
 */
export interface TaskMetadata {
  id: string;
  fileName: string;
  filePath: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  duration: number | null;
  segmentCount: number | null;
  hasResult: boolean;
  fileSizeBytes: number;
}

/**
 * Storage information returned from get_storage_info
 */
export interface StorageInfo {
  directory: string;
  taskCount: number;
  totalSizeBytes: number;
}

/**
 * Get the transcription storage directory
 * Calls Rust get_transcription_dir command
 */
export async function getTranscriptionDir(): Promise<CommandResult<string>> {
  try {
    const result = await invoke<string>("get_transcription_dir");
    logger.info("Retrieved transcription directory", { directory: result });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to get transcription directory", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Save a transcription task to persistent storage
 * Calls Rust save_transcription command with the full task object
 */
export async function saveTranscription(
  task: TranscriptionTask
): Promise<CommandResult<void>> {
  logger.info("Saving transcription", {
    taskId: task.id,
    fileName: task.fileName,
    status: task.status,
  });

  try {
    await invoke("save_transcription", { task });
    logger.info("Transcription saved successfully", { taskId: task.id });
    return { success: true };
  } catch (error) {
    logger.error("Failed to save transcription", {
      taskId: task.id,
      error: String(error),
      errorDetails: error instanceof Error ? error.stack : String(error),
    });
    return { success: false, error: String(error) };
  }
}

/**
 * Load a transcription task from storage by ID
 * Calls Rust load_transcription command
 */
export async function loadTranscription(
  taskId: string
): Promise<CommandResult<TranscriptionTask>> {
  logger.info("Loading transcription", { taskId });

  try {
    const result = await invoke<TranscriptionTask>("load_transcription", { taskId });
    logger.info("Transcription loaded successfully", {
      taskId,
      fileName: result.fileName,
      status: result.status,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to load transcription", {
      taskId,
      error: String(error),
      errorDetails: error instanceof Error ? error.stack : String(error),
    });
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a transcription task from storage
 * Calls Rust delete_transcription command
 */
export async function deleteTranscription(
  taskId: string
): Promise<CommandResult<void>> {
  logger.info("Deleting transcription", { taskId });

  try {
    await invoke("delete_transcription", { taskId });
    logger.info("Transcription deleted successfully", { taskId });
    return { success: true };
  } catch (error) {
    logger.error("Failed to delete transcription", {
      taskId,
      error: String(error),
      errorDetails: error instanceof Error ? error.stack : String(error),
    });
    return { success: false, error: String(error) };
  }
}

/**
 * List all transcription tasks with metadata
 * Calls Rust list_transcriptions command
 */
export async function listTranscriptions(): Promise<
  CommandResult<TaskMetadata[]>
> {
  logger.info("Listing transcriptions");

  try {
    const result = await invoke<TaskMetadata[]>("list_transcriptions");
    logger.info("Transcriptions listed successfully", {
      count: result.length,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to list transcriptions", {
      error: String(error),
      errorDetails: error instanceof Error ? error.stack : String(error),
    });
    return { success: false, error: String(error) };
  }
}

/**
 * Get storage directory information
 * Calls Rust get_storage_info command
 */
export async function getStorageInfo(): Promise<CommandResult<StorageInfo>> {
  logger.info("Getting storage info");

  try {
    const result = await invoke<StorageInfo>("get_storage_info");
    logger.info("Storage info retrieved successfully", {
      directory: result.directory,
      taskCount: result.taskCount,
      totalSizeBytes: result.totalSizeBytes,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to get storage info", {
      error: String(error),
      errorDetails: error instanceof Error ? error.stack : String(error),
    });
    return { success: false, error: String(error) };
  }
}
