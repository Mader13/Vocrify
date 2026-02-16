import { invoke } from "@tauri-apps/api/core";
import type { LocalModel, DiskUsage, ModelDownloadProgress, ModelDownloadStageEvent } from "@/types";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";

export async function downloadModel(
  modelName: string,
  modelType: string,
  huggingFaceToken?: string | null
): Promise<CommandResult<string>> {
  logger.modelInfo("Starting model download", { modelName, modelType });

  try {
    const result = await invoke<string>("download_model", {
      modelName,
      modelType,
      huggingFaceToken: huggingFaceToken || null,
    });
    logger.modelInfo("Model download started", { modelName });
    return { success: true, data: result };
  } catch (error) {
    logger.modelError("Failed to download model", { modelName, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function getLocalModels(): Promise<CommandResult<LocalModel[]>> {
  try {
    const models = await invoke<LocalModel[]>("get_local_models");
    return { success: true, data: models };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function saveHuggingFaceToken(token: string): Promise<CommandResult<void>> {
  try {
    await invoke("save_huggingface_token", { token });
    return { success: true };
  } catch (error) {
    logger.error("Failed to save HuggingFace token", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function getHuggingFaceToken(): Promise<CommandResult<string | null>> {
  try {
    const token = await invoke<string | null>("get_huggingface_token_command");
    return { success: true, data: token };
  } catch (error) {
    logger.error("Failed to get HuggingFace token", { error: String(error) });
    return { success: false, error: String(error), data: null };
  }
}

export async function deleteModel(modelName: string): Promise<CommandResult<void>> {
  try {
    await invoke("delete_model", { modelName });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function openModelsFolder(): Promise<CommandResult<void>> {
  try {
    await invoke("open_models_folder_command");
    return { success: true };
  } catch (error) {
    console.error("Failed to open models folder:", error);
    return { success: false, error: String(error) };
  }
}

export async function getDiskUsage(): Promise<CommandResult<DiskUsage>> {
  try {
    const usage = await invoke<Record<string, number>>("get_disk_usage");

    const normalized: DiskUsage = {
      totalSizeMb: typeof usage?.totalSizeMb === "number"
        ? usage.totalSizeMb
        : typeof usage?.total_size_mb === "number"
        ? usage.total_size_mb
        : 0,
      freeSpaceMb: typeof usage?.freeSpaceMb === "number"
        ? usage.freeSpaceMb
        : typeof usage?.free_space_mb === "number"
        ? usage.free_space_mb
        : 0,
    };

    return { success: true, data: normalized };
  } catch (error) {
    console.error("Failed to get disk usage:", error);
    return { success: false, error: String(error) };
  }
}

export async function clearCache(): Promise<CommandResult<void>> {
  try {
    await invoke<void>("clear_cache");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Failed to clear cache:", error);
    return { success: false, error: String(error) };
  }
}

export async function saveSelectedModel(model: string): Promise<CommandResult<void>> {
  try {
    await invoke("save_selected_model", { model });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function loadSelectedModel(): Promise<CommandResult<string | null>> {
  try {
    const model = await invoke<string | null>("load_selected_model");
    return { success: true, data: model };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function cancelModelDownload(
  modelName: string
): Promise<CommandResult<void>> {
  try {
    await invoke("cancel_model_download", { modelName });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export type { ModelDownloadProgress, ModelDownloadStageEvent };
