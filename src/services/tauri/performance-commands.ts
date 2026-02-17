import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";
import type { PerformanceConfig } from "@/types/settings";

/**
 * Get the current performance configuration
 */
export async function getPerformanceConfig(): Promise<CommandResult<PerformanceConfig>> {
  try {
    const result = await invoke<PerformanceConfig>("get_performance_config");
    logger.info("Performance config retrieved", result);
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to get performance config", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Update performance configuration
 * @param config The new performance configuration
 * @param persist Whether to persist the changes to disk (default: false for session-only)
 */
export async function updatePerformanceConfig(
  config: PerformanceConfig,
  persist: boolean = false
): Promise<CommandResult<PerformanceConfig>> {
  try {
    const result = await invoke<PerformanceConfig>("update_performance_config", {
      config,
      persist,
    });
    logger.info("Performance config updated", { config, persist });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to update performance config", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
