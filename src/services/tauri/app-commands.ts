import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";

export async function getAppVersion(): Promise<CommandResult<string>> {
  try {
    const version = await getVersion();
    return { success: true, data: version };
  } catch (error) {
    logger.error("Failed to get app version", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function openAppDirectory(): Promise<CommandResult<void>> {
  try {
    await invoke("open_app_directory_command");
    return { success: true };
  } catch (error) {
    logger.error("Failed to open app directory", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function openExternalUrl(url: string): Promise<CommandResult<void>> {
  try {
    await invoke("plugin:opener|open_url", { url });
    return { success: true };
  } catch (error) {
    logger.error("Failed to open external URL", { url, error: String(error) });
    return { success: false, error: String(error) };
  }
}
