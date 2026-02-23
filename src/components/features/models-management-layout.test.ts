import { describe, expect, it } from "vitest";

import type { AvailableModel, ModelDownloadState } from "@/types";
import {
  MODELS_LAYOUT_BASE_SPLIT_WIDTH,
  MODELS_LAYOUT_SIDEBAR_EXPANDED_OFFSET,
  buildModelsSummary,
  getModelsPageLayoutMode,
} from "@/components/features/models-management-layout";

const sampleModels: AvailableModel[] = [
  { name: "whisper-base", modelType: "whisper", description: "Base", sizeMb: 139, installed: true },
  { name: "whisper-small", modelType: "whisper", description: "Small", sizeMb: 466, installed: false },
  { name: "parakeet-tdt-0.6b-v3", modelType: "parakeet", description: "Parakeet", sizeMb: 640, installed: true },
  { name: "sherpa-onnx-diarization", modelType: "diarization", description: "Sherpa", sizeMb: 45, installed: false },
];

const sampleDownloads: Record<string, ModelDownloadState> = {
  "whisper-small": {
    modelName: "whisper-small",
    progress: 44,
    currentMb: 205,
    totalMb: 466,
    speedMbS: 4.2,
    status: "downloading",
  },
};

describe("getModelsPageLayoutMode", () => {
  it("returns stacked for invalid widths", () => {
    expect(getModelsPageLayoutMode(0, { sidebarCollapsed: true })).toBe("stacked");
    expect(getModelsPageLayoutMode(-20, { sidebarCollapsed: false })).toBe("stacked");
    expect(getModelsPageLayoutMode(Number.NaN, { sidebarCollapsed: true })).toBe("stacked");
  });

  it("returns split at base threshold when sidebar is collapsed", () => {
    expect(getModelsPageLayoutMode(MODELS_LAYOUT_BASE_SPLIT_WIDTH - 1, { sidebarCollapsed: true })).toBe("stacked");
    expect(getModelsPageLayoutMode(MODELS_LAYOUT_BASE_SPLIT_WIDTH, { sidebarCollapsed: true })).toBe("split");
  });

  it("requires expanded offset width when sidebar is open", () => {
    const expandedThreshold = MODELS_LAYOUT_BASE_SPLIT_WIDTH + MODELS_LAYOUT_SIDEBAR_EXPANDED_OFFSET;
    expect(getModelsPageLayoutMode(expandedThreshold - 1, { sidebarCollapsed: false })).toBe("stacked");
    expect(getModelsPageLayoutMode(expandedThreshold, { sidebarCollapsed: false })).toBe("split");
  });
});

describe("buildModelsSummary", () => {
  it("calculates installed/total/downloading counts per section", () => {
    const summary = buildModelsSummary(sampleModels, sampleDownloads);

    expect(summary.total).toBe(4);
    expect(summary.installed).toBe(2);
    expect(summary.downloading).toBe(1);
    expect(summary.whisper.installed).toBe(1);
    expect(summary.whisper.total).toBe(2);
    expect(summary.parakeet.installed).toBe(1);
    expect(summary.parakeet.total).toBe(1);
    expect(summary.diarization.installed).toBe(0);
    expect(summary.diarization.total).toBe(1);
  });
});
