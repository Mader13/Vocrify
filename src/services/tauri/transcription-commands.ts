import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionOptions } from "@/types";
import { logger } from "@/lib/logger";
import { normalizeNumSpeakers } from "@/lib/speaker-utils";
import type { CommandResult } from "./core";

export async function startTranscription(
  taskId: string,
  filePath: string,
  options: TranscriptionOptions
): Promise<CommandResult<void>> {
  logger.transcriptionInfo("Starting transcription", { taskId, fileName: filePath });

  const numSpeakersAsNumber = normalizeNumSpeakers(options.numSpeakers);

  logger.transcriptionDebug("Transcription options", {
    model: options.model,
    device: options.device,
    language: options.language,
    audioProfile: options.audioProfile,
    enableDiarization: options.enableDiarization,
    diarizationProvider: options.diarizationProvider,
    numSpeakers: options.numSpeakers,
    numSpeakersConverted: numSpeakersAsNumber,
  });

  try {
    await invoke("start_transcription", {
      taskId,
      filePath,
      options: {
        model: options.model,
        device: options.device,
        language: options.language,
        audioProfile: options.audioProfile,
        enableDiarization: options.enableDiarization,
        diarizationProvider: options.diarizationProvider,
        numSpeakers: numSpeakersAsNumber,
      },
    });
    logger.transcriptionInfo("Transcription started successfully", { taskId });
    return { success: true };
  } catch (error) {
    logger.transcriptionError("Failed to start transcription", {
      taskId,
      error: String(error),
      errorDetails: error instanceof Error ? error.stack : String(error),
    });
    return { success: false, error: String(error) };
  }
}

export async function cancelTranscription(
  taskId: string
): Promise<CommandResult<void>> {
  logger.transcriptionInfo("Cancelling transcription", { taskId });

  try {
    await invoke("cancel_transcription", { taskId });
    logger.transcriptionInfo("Transcription cancelled", { taskId });
    return { success: true };
  } catch (error) {
    logger.transcriptionError("Failed to cancel transcription", { taskId, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function getQueueStatus(): Promise<
  CommandResult<{ running: number; queued: number }>
> {
  try {
    const data = await invoke<{ running: number; queued: number }>(
      "get_queue_status"
    );
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function testPythonEngine(): Promise<CommandResult<string>> {
  try {
    const output = await invoke<string>("run_python_engine");
    return { success: true, data: output };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function checkCudaAvailable(): Promise<CommandResult<boolean>> {
  try {
    const available = await invoke<boolean>("check_cuda_available");
    return { success: true, data: available };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export interface RustTranscriptionResult {
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
}

export interface RustTranscriptionOptions {
  model: string;
  device: string;
  language: string;
  enableDiarization: boolean;
  diarizationProvider?: string;
  numSpeakers: number;
  audioProfile?: string;
}

export async function loadModelRust(
  modelName: string,
): Promise<CommandResult<void>> {
  logger.transcriptionInfo("Loading model for Rust engine", { modelName });
  try {
    await invoke("load_model_rust", { modelName });
    logger.transcriptionInfo("Model loaded successfully", { modelName });
    return { success: true };
  } catch (error) {
    logger.transcriptionError("Failed to load model", { modelName, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function transcribeRust(
  taskId: string,
  filePath: string,
  options: RustTranscriptionOptions,
): Promise<CommandResult<RustTranscriptionResult>> {
  logger.transcriptionInfo("Calling transcribe_rust", { taskId, model: options.model });
  try {
    const result = await invoke<RustTranscriptionResult>("transcribe_rust", {
      taskId,
      filePath,
      options,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.transcriptionError("transcribe_rust failed", { taskId, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function initTranscriptionManager(): Promise<CommandResult<void>> {
  try {
    await invoke("init_transcription_manager");
    logger.info("TranscriptionManager initialized successfully");
    return { success: true };
  } catch (error) {
    logger.warn("Failed to initialize TranscriptionManager", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
