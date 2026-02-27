import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { FileMetadata, TranscriptionResult, ExportMode } from "@/types";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";

export async function getFilesMetadata(filePaths: string[]): Promise<CommandResult<FileMetadata[]>> {
  try {
    const metadata = await invoke<FileMetadata[]>("get_files_metadata", {
      filePaths,
    });
    return { success: true, data: metadata };
  } catch (error) {
    logger.error("Failed to get file metadata", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function selectMediaFiles(): Promise<CommandResult<FileMetadata[]>> {
  try {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Media Files",
          extensions: ["mp3", "mp4", "wav", "m4a", "flac", "ogg", "webm", "mov", "avi", "mkv"],
        },
        {
          name: "Audio Files",
          extensions: ["mp3", "wav", "m4a", "flac", "ogg"],
        },
        {
          name: "Video Files",
          extensions: ["mp4", "webm", "mov", "avi", "mkv"],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (selected === null) {
      return { success: true, data: [] };
    }

    const filePaths = Array.isArray(selected) ? selected : [selected];
    const metadataResult = await getFilesMetadata(filePaths);
    if (!metadataResult.success || !metadataResult.data) {
      return { success: false, error: metadataResult.error || "Failed to get file metadata" };
    }

    return { success: true, data: metadataResult.data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function selectOutputDirectory(): Promise<CommandResult<string | null>> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    return { success: true, data: selected };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function selectExportPath(
  defaultName: string,
  format: "txt" | "srt" | "vtt" | "json" | "md"
): Promise<CommandResult<string | null>> {
  const formatLabels: Record<string, string> = {
    txt: "Text Files",
    srt: "Subtitle Files",
    vtt: "WebVTT Files",
    json: "JSON Files",
    md: "Markdown Files",
  };

  try {
    const selected = await save({
      filters: [
        {
          name: formatLabels[format] || format.toUpperCase(),
          extensions: [format],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
      defaultPath: defaultName,
    });

    return { success: true, data: selected };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function exportTranscription(
  result: TranscriptionResult,
  format: "txt" | "srt" | "vtt" | "json" | "md",
  outputPath: string,
  exportMode: ExportMode = "with_timestamps"
): Promise<CommandResult<void>> {
  try {
    await invoke("export_transcription", {
      result,
      format,
      outputPath,
      exportMode,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getModelsDir(): Promise<CommandResult<string>> {
  try {
    const dir = await invoke<string>("get_models_dir_command");
    return { success: true, data: dir };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function getAssetUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

export async function readFileAsBase64(filePath: string): Promise<CommandResult<string>> {
  try {
    const base64 = await invoke<string>("read_file_as_base64", { filePath });
    return { success: true, data: base64 };
  } catch (error) {
    logger.error("Failed to read file as base64", { filePath, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function generateWaveformPeaks(filePath: string, targetPeaks: number): Promise<CommandResult<number[]>> {
  try {
    const peaks = await invoke<number[]>("generate_waveform_peaks", { filePath, targetPeaks });
    return { success: true, data: peaks };
  } catch (error) {
    logger.error("Failed to generate waveform peaks backend", { filePath, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function readFileAsArrayBuffer(filePath: string): Promise<CommandResult<ArrayBuffer>> {
  try {
    // First get as base64, then convert to ArrayBuffer
    const base64Result = await readFileAsBase64(filePath);
    if (!base64Result.success || !base64Result.data) {
      return { success: false, error: base64Result.error || "Failed to read file" };
    }

    // Convert base64 to ArrayBuffer
    const binaryString = atob(base64Result.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return { success: true, data: bytes.buffer };
  } catch (error) {
    logger.error("Failed to read file as ArrayBuffer", { filePath, error: String(error) });
    return { success: false, error: String(error) };
  }
}
