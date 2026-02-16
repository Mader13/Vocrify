import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";

export async function getFileSize(filePath: string): Promise<CommandResult<number>> {
  try {
    const size = await invoke<number>("get_file_size", { path: filePath });
    return { success: true, data: size };
  } catch (error) {
    logger.error("Failed to get file size", { filePath, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function deleteFile(filePath: string): Promise<CommandResult<void>> {
  try {
    await invoke("delete_file", { path: filePath });
    return { success: true };
  } catch (error) {
    logger.error("Failed to delete file", { filePath, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function convertToMp3(
  inputPath: string,
  outputPath: string
): Promise<CommandResult<string>> {
  try {
    const result = await invoke<string>("convert_to_mp3", {
      inputPath,
      outputPath,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to convert to MP3", { inputPath, outputPath, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function getArchiveDir(): Promise<CommandResult<string>> {
  try {
    const dir = await invoke<string>("get_archive_dir");
    return { success: true, data: dir };
  } catch (error) {
    logger.error("Failed to get archive directory", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
