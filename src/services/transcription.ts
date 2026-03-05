/**
 * Transcription Service
 *
 * This module routes transcription to the Rust backend (`transcribe-rs`).
 * Speaker diarization is handled natively in Rust.
 */

import type {
  TranscriptionOptions,
  EnginePreference,
  TranscriptionResult,
  ProgressEvent,
  SegmentEvent,
  TaskStatus,
  ProgressStage,
} from "@/types";
import {
  onTranscriptionComplete,
  copyFile,
  compressMedia,
  convertToMp3,
  getFileSize,
  getFFmpegStatus,
  loadModelRust,
  transcribeRust,
  initTranscriptionManager as initTranscriptionManagerCommand,
} from "./tauri";
import type { RustTranscriptionOptions } from "./tauri/transcription-commands";
import { subscribeToTranscriptionTransportEvents } from "./tauri/events";
import { logger } from "@/lib/logger";
import { normalizeNumSpeakers } from "@/lib/speaker-utils";
import { getManagedCopyStorageDirectory } from "@/services/storage";
import { useTasks } from "@/stores";

let loadedRustModel: string | null = null;
const managedCopyInFlight = new Set<string>();

function getFileExtension(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ?? "";
}

function isAudioExtension(ext: string): boolean {
  return ["mp3", "wav", "m4a", "flac", "ogg", "aac"].includes(ext);
}

async function processManagedCopy(taskId: string): Promise<void> {
  if (managedCopyInFlight.has(taskId)) {
    return;
  }

  const state = useTasks.getState();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task?.filePath) {
    return;
  }

  if (!state.settings.managedCopyEnabled) {
    return;
  }

  if (state.settings.managedCopyLifecycle !== "on_complete") {
    return;
  }

  if (task.managedCopyStatus === "done" && task.managedCopyPath) {
    return;
  }

  managedCopyInFlight.add(taskId);

  const setManagedCopyTaskState = (
    patch: Partial<Pick<typeof task, "managedCopyPath" | "managedCopySize" | "managedCopyStatus" | "managedCopyError" | "managedCopyCreatedAt">>,
  ) => {
    const currentTask = useTasks.getState().tasks.find((item) => item.id === taskId);
    if (!currentTask) {
      return;
    }

    useTasks.getState().upsertTask({
      ...currentTask,
      ...patch,
    });
  };

  try {
    setManagedCopyTaskState({
      managedCopyStatus: "pending",
      managedCopyError: undefined,
    });

    const directoryResult = await getManagedCopyStorageDirectory();
    if (!directoryResult.success || !directoryResult.data) {
      throw new Error(directoryResult.error || "Failed to resolve storage directory");
    }

    const compression = state.settings.managedCopyCompression;
    const sourcePath = task.filePath;
    const sourceExt = getFileExtension(sourcePath);
    const isAudio = isAudioExtension(sourceExt);

    let targetPath = "";

    const needsFfmpeg = compression !== "none";
    if (needsFfmpeg) {
      const ffmpegStatusResult = await getFFmpegStatus();
      if (!ffmpegStatusResult.success || ffmpegStatusResult.data?.tag !== "Installed") {
        throw new Error("FFmpeg is required for managed media compression but is not installed");
      }
    }

    if (isAudio && compression !== "none") {
      targetPath = `${directoryResult.data}/${task.id}.mp3`;
      const convertResult = await convertToMp3(sourcePath, targetPath);
      if (!convertResult.success || !convertResult.data) {
        throw new Error(convertResult.error || "Failed to convert managed copy to mp3");
      }
      targetPath = convertResult.data;
    } else {
      const extension = sourceExt || "bin";
      targetPath = `${directoryResult.data}/${task.id}.${extension}`;

      if (compression === "none") {
        const copyResult = await copyFile(sourcePath, targetPath);
        if (!copyResult.success || !copyResult.data) {
          throw new Error(copyResult.error || "Failed to copy managed media");
        }
        targetPath = copyResult.data;
      } else {
        const compressResult = await compressMedia(sourcePath, targetPath, compression);
        if (!compressResult.success || !compressResult.data) {
          throw new Error(compressResult.error || "Failed to compress managed media");
        }
        targetPath = compressResult.data;
      }
    }

    const fileSizeResult = await getFileSize(targetPath);
    const managedCopySize = fileSizeResult.success && typeof fileSizeResult.data === "number"
      ? fileSizeResult.data
      : undefined;

    setManagedCopyTaskState({
      managedCopyPath: targetPath,
      managedCopySize,
      managedCopyStatus: "done",
      managedCopyError: undefined,
      managedCopyCreatedAt: new Date(),
    });

    logger.transcriptionInfo("Managed copy generated", {
      taskId,
      managedCopyPath: targetPath,
      managedCopySize,
      compression,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setManagedCopyTaskState({
      managedCopyStatus: "failed",
      managedCopyError: message,
    });

    logger.transcriptionError("Managed copy generation failed", {
      taskId,
      error: message,
    });
  } finally {
    managedCopyInFlight.delete(taskId);
  }
}

type UpdateTaskStatus = (
  taskId: string,
  status: TaskStatus,
  result?: TranscriptionResult,
  error?: string,
) => void;

interface CompletionPayload {
  taskId: string;
  result: TranscriptionResult;
}

function logCompletion(taskId: string, result: TranscriptionResult): void {
  logger.transcriptionDebug("Transcription complete", {
    taskId,
    segments: result.segments?.length,
    speakerTurns: result.speakerTurns?.length,
    speakerSegments: result.speakerSegments?.length,
    hasSpeakerData: !!(result.speakerTurns && result.speakerTurns.length > 0),
  });
}

function completeTask(
  payload: CompletionPayload,
  updateTaskStatus: UpdateTaskStatus,
): void {
  logCompletion(payload.taskId, payload.result);
  updateTaskStatus(payload.taskId, "completed", payload.result);
  void processManagedCopy(payload.taskId);
}

export async function subscribeToTranscriptionCompletion(
  updateTaskStatus: UpdateTaskStatus,
): Promise<() => void> {
  const handleCompletion = (payload: CompletionPayload) => {
    completeTask(payload, updateTaskStatus);
  };

  const unlistenTauri = await onTranscriptionComplete((taskId, result) => {
    handleCompletion({ taskId, result });
  });

  const handleWindowCompletion = (event: Event) => {
    const detail = (event as CustomEvent<CompletionPayload>).detail;
    if (!detail?.taskId || !detail?.result) {
      return;
    }

    handleCompletion(detail);
  };

  window.addEventListener("transcription-complete", handleWindowCompletion);

  return () => {
    unlistenTauri();
    window.removeEventListener("transcription-complete", handleWindowCompletion);
  };
}

interface TranscriptionRuntimeHandlers {
  updateTaskProgress: (taskId: string, progress: number, stage?: ProgressStage, metrics?: ProgressEvent["metrics"]) => void;
  updateTaskStatus: UpdateTaskStatus;
  appendTaskSegment: (taskId: string, segment: SegmentEvent["segment"], index: number, totalSegments: number | null) => void;
  appendStreamingSegment: (taskId: string, segment: SegmentEvent["segment"]) => void;
  getTaskStatus: (taskId: string) => TaskStatus | null;
}

export async function subscribeToTranscriptionRuntime(
  handlers: TranscriptionRuntimeHandlers,
): Promise<() => void> {
  const unlistenTransport = await subscribeToTranscriptionTransportEvents({
    onProgress: (event: ProgressEvent) => {
      handlers.updateTaskProgress(event.taskId, event.progress, event.stage, event.metrics);
    },
    onError: (taskId: string, error: string) => {
      const status = handlers.getTaskStatus(taskId);
      if (status === "completed" || status === "cancelled" || status === "interrupted") {
        logger.transcriptionWarn("Ignoring late transcription error for finalized task", {
          taskId,
          status,
          error,
        });
        return;
      }

      handlers.updateTaskStatus(taskId, "failed", undefined, error);
    },
    onSegment: ({ taskId, segment }: { taskId: string; segment: SegmentEvent }) => {
      handlers.appendTaskSegment(taskId, segment.segment, segment.index, segment.total);
      handlers.appendStreamingSegment(taskId, segment.segment);
    },
  });

  const unlistenCompletion = await subscribeToTranscriptionCompletion(handlers.updateTaskStatus);

  return () => {
    unlistenTransport();
    unlistenCompletion();
  };
}

/**
 * Transcribe with Rust Engine
 *
 * This function routes the transcription request to the Tauri Rust backend.
 *
 * @param taskId - Unique task identifier
 * @param filePath - Path to the audio/video file
 * @param options - Transcription options
 * @param preference - Engine preference setting (ignored, always uses Rust)
 * @returns Promise<CommandResult<void>>
 */
export async function transcribeWithFallback(
  taskId: string,
  filePath: string,
  options: TranscriptionOptions,
  _preference: EnginePreference = "auto"
): Promise<{ success: boolean; error?: string }> {
  // Only the base "parakeet" model is English-only; "parakeet-tdt-0.6b-v3" is multilingual.
  const isEnglishOnlyParakeet = options.model === "parakeet";
  const normalizedLanguage = (options.language || "auto").trim().toLowerCase();

  if (isEnglishOnlyParakeet && normalizedLanguage !== "auto" && !normalizedLanguage.startsWith("en")) {
    const error = `Parakeet supports English only (received language='${options.language}')`;
    logger.transcriptionError("Invalid language for Parakeet", {
      taskId,
      model: options.model,
      language: options.language,
    });
    return { success: false, error };
  }

  // For the English-only Parakeet model, default "auto" to "en" since it cannot detect language.
  const effectiveLanguage = isEnglishOnlyParakeet && (normalizedLanguage === "auto" || normalizedLanguage === "")
    ? "en"
    : (options.language ?? "auto");

  logger.transcriptionInfo("Starting transcription via Rust backend", {
    taskId,
    model: options.model,
  });

  try {
    // Ensure model is loaded for transcribe-rs before transcription.
    if (loadedRustModel !== options.model) {
      const loadResult = await loadModelRust(options.model);
      if (!loadResult.success) {
        throw new Error(loadResult.error ?? "Failed to load model");
      }
      loadedRustModel = options.model;
    }

    // Match Rust command schema (`RustTranscriptionOptions`) for transcribe_rust.
    const numSpeakersAsNumber = normalizeNumSpeakers(options.numSpeakers);

    // Phase 3: Call Rust transcribe-rs engine via tauri service wrapper
    const rustOptions: RustTranscriptionOptions = {
      model: options.model,
      device: options.device,
      language: effectiveLanguage,
      enableDiarization: options.enableDiarization,
      diarizationProvider: options.diarizationProvider,
      numSpeakers: numSpeakersAsNumber,
      audioProfile: options.audioProfile,
    };
    const transcribeResult = await transcribeRust(taskId, filePath, rustOptions);
    if (!transcribeResult.success || !transcribeResult.data) {
      throw new Error(transcribeResult.error ?? "Transcription failed");
    }
    const result = transcribeResult.data;

    logger.transcriptionInfo("Transcription completed successfully with Rust engine", {
      taskId,
      engine: "transcribe-rs",
      duration: result.duration,
      segments: result.segments.length,
    });

    // Emit completion event for the UI
    const event = new CustomEvent("transcription-complete", {
      detail: {
        taskId,
        result: {
          segments: result.segments.map((s: { start: number; end: number; text: string; speaker?: string; confidence: number }) => ({
            start: s.start,
            end: s.end,
            text: s.text,
            speaker: s.speaker,
            confidence: s.confidence,
          })),
          language: result.language,
          duration: result.duration,
          speakerTurns: result.speakerTurns,
          speakerSegments: result.speakerSegments,
          metrics: result.metrics,
        },
      },
    });
    window.dispatchEvent(event);

    return { success: true };
  } catch (rustError) {
    const errorMessage = rustError instanceof Error ? rustError.message : String(rustError);

    if (errorMessage.includes("model") || errorMessage.includes("load")) {
      loadedRustModel = null;
    }

    // Cancelled by user
    if (errorMessage.includes("CANCELLED")) {
      logger.transcriptionInfo("Rust transcription cancelled by user", { taskId });
      return { success: false, error: "CANCELLED" };
    }

    logger.transcriptionError(
      "Rust engine failed",
      {
        taskId,
        error: errorMessage,
      }
    );

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Initialize the transcription manager (call at app startup)
 */
export async function initTranscriptionManager(): Promise<void> {
  const result = await initTranscriptionManagerCommand();
  if (!result.success) {
    logger.warn("Failed to initialize TranscriptionManager", { error: result.error });
  }
}

/**
 * Load a model for transcription
 */
export async function loadModel(modelName: string): Promise<void> {
  const result = await loadModelRust(modelName);
  if (!result.success) {
    logger.error(`Failed to load model ${modelName}`, { error: result.error });
    throw new Error(result.error ?? `Failed to load model ${modelName}`);
  }
  logger.info(`Model loaded: ${modelName}`);
}
