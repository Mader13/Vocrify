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
} from "@/types";
import { startTranscription } from "./tauri";
import { logger } from "@/lib/logger";
import { invoke } from "@tauri-apps/api/core";

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
 * Phase 3: transcribe-rs supports Whisper, Parakeet, Moonshine, SenseVoice
 */
export function shouldUseRustEngine(model: string): boolean {
  // All transcribe-rs supported models use Rust
  if (model.startsWith("whisper") ||
      model.startsWith("parakeet") || 
      model.startsWith("moonshine") ||
      model.startsWith("sense")) {
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
      await invoke("load_model_rust", { modelName: options.model });

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
          },
        },
      });
      window.dispatchEvent(event);

      return { success: true };
    } catch (rustError) {
      logger.transcriptionWarn(
        "Rust engine failed, attempting Python fallback",
        {
          taskId,
          error: String(rustError),
        }
      );

      // If auto mode, fall back to Python
      if (preference === "auto") {
        return startTranscription(taskId, filePath, options);
      }

      // If rust-only mode, return the error
      return {
        success: false,
        error: rustError instanceof Error ? rustError.message : String(rustError),
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
