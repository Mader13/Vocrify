import { invoke } from "@tauri-apps/api/core";
import type { DevicesResponse } from "@/types";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";

export async function getAvailableDevices(refresh = false): Promise<CommandResult<DevicesResponse>> {
  try {
    const response = await invoke<DevicesResponse>("get_available_devices", { refresh });
    logger.info("Detected compute devices", {
      devices: response.devices.map(d => `${d.name} (${d.deviceType})`).join(", "),
      recommended: response.recommended,
      cached: !refresh,
    });
    return { success: true, data: response };
  } catch (error) {
    logger.error("Failed to get available devices", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export type FFmpegStatus =
  | { tag: "NotInstalled" }
  | { tag: "Installed"; path: string }
  | { tag: "Downloading" }
  | { tag: "Extracting" }
  | { tag: "Completed" }
  | { tag: "Failed"; error: string };

export interface FFmpegProgress {
  currentBytes: number;
  totalBytes: number;
  percent: number;
  status: string;
}

export interface FFmpegStatusEvent {
  status: string;
  message: string;
}

export async function getFFmpegStatus(): Promise<CommandResult<FFmpegStatus>> {
  try {
    const result = await invoke<{ status: string; path?: string }>("get_ffmpeg_status");

    if (result.status === "installed" && result.path) {
      return { success: true, data: { tag: "Installed", path: result.path } };
    } else {
      return { success: true, data: { tag: "NotInstalled" } };
    }
  } catch (error) {
    logger.error("Failed to check FFmpeg status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function downloadFFmpeg(): Promise<CommandResult<void>> {
  try {
    await invoke("download_ffmpeg");
    return { success: true };
  } catch (error) {
    logger.error("Failed to download FFmpeg", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
