/**
 * Transcription Service with Engine Fallback
 *
 * Phase 3: Updated for transcribe-rs
 * This module provides intelligent routing between:
 * - Rust transcribe-rs (Whisper GGML, Parakeet ONNX) - fast, GPU-accelerated
 * - Python engine (PyAnnote diarization only) - diarization support
 *
 * Routing logic:
 * - Whisper/Parakeet models → Rust transcribe-rs (with auto-fallback to Python)
 * - Diarization → Python (PyAnnote/Sherpa-ONNX)
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
  startTranscription,
} from "./tauri";
import { subscribeToTranscriptionTransportEvents } from "./tauri/events";
import { logger } from "@/lib/logger";
import { invoke } from "@tauri-apps/api/core";

let loadedRustModel: string | null = null;

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

const RUST_UNSUPPORTED_CONTAINER_EXTENSIONS = new Set([
  "mp4",
  "m4a",
  "mov",
  "mkv",
  "avi",
  "webm",
]);

function getFileExtension(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dotIndex + 1).toLowerCase();
}

function shouldBypassRustForFile(filePath: string): boolean {
  const extension = getFileExtension(filePath);
  return extension.length > 0 && RUST_UNSUPPORTED_CONTAINER_EXTENSIONS.has(extension);
}

/**
 * Check if a model should use Rust transcribe-rs
 * Phase 3: transcribe-rs supports Whisper, Parakeet, Moonshine
 */
export function shouldUseRustEngine(model: string): boolean {
  // All transcribe-rs supported models use Rust
  if (model.startsWith("whisper") ||
      model.startsWith("parakeet") || 
      model.startsWith("moonshine")) {
    return true;
  }

  // Short names like "base", "small", "tiny" are Whisper models
  if (["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"].includes(model)) {
    return true;
  }

  return false;
}

/**
 * Get the engine name for display purposes
 * Phase 3: Updated for transcribe-rs
 */
export function getEngineName(model: string, preference: EnginePreference): string {
  if (!shouldUseRustEngine(model)) {
    return "python";
  }

  switch (preference) {
    case "rust":
      return "transcribe-rs";
    case "python":
      return "python";
    case "auto":
    default:
      return "transcribe-rs (auto)";
  }
}

/**
 * Transcribe with automatic engine selection and fallback
 *
 * This function:
 * 1. Determines the appropriate engine based on model type and preference
 * 2. Attempts transcription with the selected engine
 * 3. Falls back to Python if Rust fails (when preference is "auto")
 *
 * @param taskId - Unique task identifier
 * @param filePath - Path to the audio/video file
 * @param options - Transcription options
 * @param preference - Engine preference setting
 * @returns Promise<CommandResult<void>>
 */
export async function transcribeWithFallback(
  taskId: string,
  filePath: string,
  options: TranscriptionOptions,
  preference: EnginePreference = "auto"
): Promise<{ success: boolean; error?: string }> {
  const useRust = shouldUseRustEngine(options.model);
  const bypassRustForContainer = shouldBypassRustForFile(filePath);

  logger.transcriptionInfo("Starting transcription with engine selection", {
    taskId,
    model: options.model,
    useRust,
    bypassRustForContainer,
    preference,
  });

  // Parakeet/Python-only models → Python directly
  if (!useRust) {
    logger.transcriptionInfo("Using Python engine (model requires it)", {
      taskId,
      model: options.model,
    });
    return startTranscription(taskId, filePath, options);
  }

  // Check preference
  if (preference === "python") {
    logger.transcriptionInfo("Using Python engine (preference)", { taskId });
    return startTranscription(taskId, filePath, options);
  }

  // Rust engine now handles all formats via automatic FFmpeg conversion
  // (mp4, m4a, mov, mkv, avi, webm are converted to WAV internally)

  // Try Rust transcribe-rs first
  if (preference === "rust" || preference === "auto") {
    try {
      logger.transcriptionInfo("Attempting Rust transcribe-rs transcription", {
        taskId,
        model: options.model,
      });

      // Ensure model is loaded for transcribe-rs before transcription.
      if (loadedRustModel !== options.model) {
        await invoke("load_model_rust", { modelName: options.model });
        loadedRustModel = options.model;
      }

      // Match Rust command schema (`RustTranscriptionOptions`) for transcribe_rust.
      const numSpeakersAsNumber = typeof options.numSpeakers === "string"
        ? (options.numSpeakers === "auto" ? -1 : parseInt(options.numSpeakers, 10))
        : options.numSpeakers;

      // Phase 3: Call Rust transcribe-rs engine
      const result = await invoke<{
        segments: Array<{
          start: number;
          end: number;
          text: string;
          speaker?: string;
          confidence: number;
        }>;
        language: string;
        duration: number;
        speakerTurns?: Array<{
          start: number;
          end: number;
          speaker: string;
        }>;
        speakerSegments?: Array<{
          start: number;
          end: number;
          text: string;
          speaker?: string;
          confidence: number;
        }>;
        metrics?: {
          modelLoadMs?: number;
          decodeMs?: number;
          inferenceMs?: number;
          diarizationMs?: number;
          totalMs?: number;
        };
      }>("transcribe_rust", {
        taskId,
        filePath,
        options: {
          model: options.model,
          device: options.device,
          language: options.language,
          enable_diarization: options.enableDiarization,
          diarization_provider: options.diarizationProvider,
          num_speakers: numSpeakersAsNumber,
        },
      });

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
            segments: result.segments.map(s => ({
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

      // Cancelled by user — do not fall back to Python
      if (errorMessage.includes("CANCELLED")) {
        logger.transcriptionInfo("Rust transcription cancelled by user", { taskId });
        return { success: false, error: "CANCELLED" };
      }

      logger.transcriptionWarn(
        "Rust engine failed, attempting Python fallback",
        {
          taskId,
          error: errorMessage,
        }
      );

      // If auto mode, fall back to Python
      if (preference === "auto") {
        return startTranscription(taskId, filePath, options);
      }

      // If rust-only mode, return the error
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // Fallback to Python
  return startTranscription(taskId, filePath, options);
}

/**
 * Check if Rust transcribe-rs is available
 * Phase 3: Check if the Rust transcription manager is initialized
 */
export async function checkRustEngineAvailable(): Promise<boolean> {
  try {
    // Try to initialize the transcription manager
    await invoke("init_transcription_manager");
    // If we get here, transcribe-rs is available
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current engine status
 * Phase 3: transcribe-rs is now the recommended engine
 */
export async function getEngineStatus(): Promise<{
  rustAvailable: boolean;
  pythonAvailable: boolean;
  recommendedEngine: "rust" | "python";
}> {
  const rustAvailable = await checkRustEngineAvailable();

  // Python is always available (it's the fallback for diarization)
  const pythonAvailable = true;

  // Phase 3: Recommend transcribe-rs (Rust) for all supported models
  const recommendedEngine = rustAvailable ? "rust" : "python";

  return {
    rustAvailable,
    pythonAvailable,
    recommendedEngine,
  };
}

/**
 * Initialize the transcription manager (call at app startup)
 * Phase 3: Required to use transcribe-rs
 */
export async function initTranscriptionManager(): Promise<void> {
  try {
    await invoke("init_transcription_manager");
    logger.info("TranscriptionManager initialized successfully");
  } catch (error) {
    logger.warn("Failed to initialize TranscriptionManager:", error);
    // Don't throw - Python fallback will still work
  }
}

/**
 * Load a model for transcription
 * Phase 3: Required before transcribing with transcribe-rs
 */
export async function loadModel(modelName: string): Promise<void> {
  try {
    await invoke("load_model_rust", { modelName });
    logger.info(`Model loaded: ${modelName}`);
  } catch (error) {
    logger.error(`Failed to load model ${modelName}:`, error);
    throw error;
  }
}
