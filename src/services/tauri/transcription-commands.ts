import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionOptions } from "@/types";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";

export async function startTranscription(
  taskId: string,
  filePath: string,
  options: TranscriptionOptions
): Promise<CommandResult<void>> {
  logger.transcriptionInfo("Starting transcription", { taskId, fileName: filePath });

  const numSpeakersAsNumber = typeof options.numSpeakers === "string"
    ? options.numSpeakers === "auto" ? -1 : parseInt(options.numSpeakers, 10)
    : options.numSpeakers;

  logger.transcriptionDebug("Transcription options", {
    model: options.model,
    device: options.device,
    language: options.language,
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
        enable_diarization: options.enableDiarization,
        diarization_provider: options.diarizationProvider,
        num_speakers: numSpeakersAsNumber,
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
