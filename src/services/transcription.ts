/**
 * Transcription Service with Engine Fallback
 *
 * This module provides intelligent routing between:
 * - Rust whisper-rs (Whisper GGML models) - fast, GPU-accelerated
 * - Python engine (Parakeet, PyAnnote) - feature-rich, Python-only models
 *
 * Routing logic:
 * - Whisper models → Rust (with auto-fallback to Python)
 * - Parakeet models → Python (NVIDIA NeMo)
 * - Diarization → Python (PyAnnote/Sherpa-ONNX)
 */

import type {
  TranscriptionOptions,
  EnginePreference,
} from "@/types";
import { startTranscription } from "./tauri";
import { logger } from "@/lib/logger";

/**
 * Check if a model should use Rust whisper-rs
 */
export function shouldUseRustEngine(model: string): boolean {
  // Parakeet models always use Python
  if (model.startsWith("parakeet") || model.startsWith("nvidia/")) {
    return false;
  }

  // Whisper/Distil-Whisper models can use Rust
  return true;
}

/**
 * Get the engine name for display purposes
 */
export function getEngineName(model: string, preference: EnginePreference): string {
  if (!shouldUseRustEngine(model)) {
    return "python";
  }

  switch (preference) {
    case "rust":
      return "rust-whisper";
    case "python":
      return "python";
    case "auto":
    default:
      return "rust-whisper (auto)";
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

  logger.transcriptionInfo("Starting transcription with engine selection", {
    taskId,
    model: options.model,
    useRust,
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

  // Try Rust whisper-rs first
  if (preference === "rust" || preference === "auto") {
    try {
      logger.transcriptionInfo("Attempting Rust whisper-rs transcription", {
        taskId,
        model: options.model,
      });

      // For now, we still use Python backend as the Rust engine
      // is not fully integrated yet. This will be updated when
      // the Rust transcription command is ready.
      // TODO: Replace with actual Rust whisper-rs invocation
      // const result = await invoke("transcribe_rust", { taskId, filePath, options });

      // Currently using Python backend for all transcription
      // Rust engine integration is in progress
      const result = await startTranscription(taskId, filePath, options);

      if (result.success) {
        logger.transcriptionInfo("Transcription completed successfully", {
          taskId,
          engine: "python", // Will be "rust" when Rust engine is integrated
        });
        return result;
      }

      // If Rust failed and preference is "auto", try Python fallback
      if (preference === "auto" && !result.success) {
        logger.transcriptionWarn(
          "Primary engine failed, attempting Python fallback",
          {
            taskId,
            originalError: result.error,
          }
        );

        return startTranscription(taskId, filePath, options);
      }

      return result;
    } catch (error) {
      // Unexpected error - try Python fallback if auto
      if (preference === "auto") {
        logger.transcriptionWarn(
          "Unexpected error, attempting Python fallback",
          {
            taskId,
            error: String(error),
          }
        );

        return startTranscription(taskId, filePath, options);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Fallback to Python
  return startTranscription(taskId, filePath, options);
}

/**
 * Check if Rust whisper-rs is available
 * This can be used to show UI indicators about engine availability
 */
export async function checkRustEngineAvailable(): Promise<boolean> {
  try {
    // TODO: Implement actual check when Rust engine is integrated
    // For now, return false to indicate Python is being used
    return false;
  } catch {
    return false;
  }
}

/**
 * Get the current engine status
 */
export async function getEngineStatus(): Promise<{
  rustAvailable: boolean;
  pythonAvailable: boolean;
  recommendedEngine: "rust" | "python";
}> {
  const rustAvailable = await checkRustEngineAvailable();

  // Python is always available (it's the fallback)
  const pythonAvailable = true;

  // Recommend Rust if available, otherwise Python
  const recommendedEngine = rustAvailable ? "rust" : "python";

  return {
    rustAvailable,
    pythonAvailable,
    recommendedEngine,
  };
}
