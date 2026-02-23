import type { AvailableModel, ModelDownloadState } from "@/types";

export const MODELS_LAYOUT_BASE_SPLIT_WIDTH = 1040;
export const MODELS_LAYOUT_SIDEBAR_EXPANDED_OFFSET = 160;

export type ModelsPageLayoutMode = "stacked" | "split";

interface ModelsLayoutOptions {
  sidebarCollapsed?: boolean;
}

interface ModelSectionSummary {
  installed: number;
  total: number;
}

export interface ModelsSummary {
  total: number;
  installed: number;
  downloading: number;
  whisper: ModelSectionSummary;
  parakeet: ModelSectionSummary;
  diarization: ModelSectionSummary;
}

function summarizeSection(models: AvailableModel[], type: AvailableModel["modelType"]): ModelSectionSummary {
  const sectionModels = models.filter((model) => model.modelType === type);
  return {
    total: sectionModels.length,
    installed: sectionModels.filter((model) => model.installed).length,
  };
}

export function getModelsPageLayoutMode(
  containerWidth: number,
  options?: ModelsLayoutOptions,
): ModelsPageLayoutMode {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return "stacked";
  }

  const splitThreshold = options?.sidebarCollapsed
    ? MODELS_LAYOUT_BASE_SPLIT_WIDTH
    : MODELS_LAYOUT_BASE_SPLIT_WIDTH + MODELS_LAYOUT_SIDEBAR_EXPANDED_OFFSET;

  return containerWidth >= splitThreshold ? "split" : "stacked";
}

export function buildModelsSummary(
  models: AvailableModel[],
  downloads: Record<string, ModelDownloadState>,
): ModelsSummary {
  const installed = models.filter((model) => model.installed).length;
  const downloading = Object.values(downloads).filter(
    (download) => download.status === "downloading",
  ).length;

  return {
    total: models.length,
    installed,
    downloading,
    whisper: summarizeSection(models, "whisper"),
    parakeet: summarizeSection(models, "parakeet"),
    diarization: summarizeSection(models, "diarization"),
  };
}
