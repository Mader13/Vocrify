import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import type { CloseBehavior } from "@/types";
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

export async function setCloseBehavior(closeBehavior: CloseBehavior): Promise<CommandResult<void>> {
  try {
    await invoke("set_close_behavior_command", { closeBehavior });
    return { success: true };
  } catch (error) {
    logger.error("Failed to set close behavior", { closeBehavior, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function getCloseBehavior(): Promise<CommandResult<CloseBehavior>> {
  try {
    const closeBehavior = await invoke<CloseBehavior>("get_close_behavior_command");
    return { success: true, data: closeBehavior };
  } catch (error) {
    logger.error("Failed to get close behavior", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function hasActiveWorkNow(): Promise<CommandResult<boolean>> {
  try {
    const hasActive = await invoke<boolean>("has_active_work_now");
    return { success: true, data: hasActive };
  } catch (error) {
    logger.error("Failed to check active work status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function quitApplication(): Promise<CommandResult<void>> {
  try {
    await invoke("quit_application_command");
    return { success: true };
  } catch (error) {
    logger.error("Failed to quit application", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
