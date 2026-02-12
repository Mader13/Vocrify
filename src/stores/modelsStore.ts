import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  AvailableModel,
  DiskUsage,
  ModelDownloadState,
  ModelType,
} from "@/types";
import {
  getLocalModels,
  downloadModel,
  cancelModelDownload as cancelDownloadService,
  deleteModel as deleteModelService,
  getDiskUsage,
  saveSelectedModel,
  loadSelectedModel,
  onModelDownloadProgress,
  onModelDownloadComplete,
  onModelDownloadError,
  onModelDownloadStage,
  onModelDownloadStageComplete,
} from "@/services/tauri";
import { AVAILABLE_MODELS } from "@/types";
import { useSettingsStore } from "./index";
import { logger } from "@/lib/logger";

interface ModelsState {
  availableModels: AvailableModel[];
  downloads: Record<string, ModelDownloadState>;
  diskUsage: DiskUsage;
  selectedTranscriptionModel: string | null;
  selectedDiarizationModel: string | null;
  isLoading: boolean;

  loadModels: () => Promise<void>;
  loadDiskUsage: () => Promise<void>;
  downloadModel: (name: string, modelType: ModelType) => Promise<void>;
  cancelModelDownload: (name: string) => Promise<void>;
  pauseModelDownload: (name: string) => void;
  resumeModelDownload: (name: string) => void;
  deleteModel: (name: string) => Promise<void>;
  setSelectedTranscriptionModel: (model: string | null) => Promise<void>;
  setSelectedDiarizationModel: (model: string | null) => Promise<void>;
  updateDownloadProgress: (modelName: string, progress: number) => void;
  setDownloadCompleted: (modelName: string) => void;
  setDownloadError: (modelName: string, error: string) => void;
  updateDownloadStage: (modelName: string, stage: string, submodelName: string, progress: number, currentMb: number, totalMb: number) => void;
  setStageCompleted: (modelName: string, stage: string) => void;
  getInstalledModels: () => AvailableModel[];
}

const getModelSizeMb = (modelName: string): number => {
  const model = AVAILABLE_MODELS.find((m) => m.name === modelName);
  return model?.sizeMb || 0;
};

/**
 * Setup model download event listeners
 * Returns array of unlisten functions for cleanup
 */
async function setupDownloadEventListeners(
  updateProgress: (modelName: string, progress: number) => void,
  setCompleted: (modelName: string) => void,
  setError: (modelName: string, error: string) => void,
  updateStage: (modelName: string, stage: string, submodelName: string, progress: number, currentMb: number, totalMb: number) => void,
  setStageCompleted: (modelName: string, stage: string) => void
): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];

  // Listen for download progress updates
  unlisteners.push(
    await onModelDownloadProgress((progress) => {
      logger.modelDebug("Download progress", progress);
      updateProgress(progress.modelName, progress.percent);
    })
  );

  // Listen for download completion
  unlisteners.push(
    await onModelDownloadComplete((modelName) => {
      logger.modelInfo("Download complete", { modelName });
      if (modelName) {
        setCompleted(modelName);
      }
    })
  );

  // Listen for download errors
  unlisteners.push(
    await onModelDownloadError((modelName, error) => {
      logger.modelError("Download error", { modelName, error });
      if (modelName && error) {
        setError(modelName, error);
      }
    })
  );

  // Listen for stage progress updates
  unlisteners.push(
    await onModelDownloadStage((stage) => {
      logger.modelDebug("Download stage progress", stage);
      updateStage(
        stage.modelName,
        stage.stage,
        stage.submodelName,
        stage.percent,
        stage.currentMb,
        stage.totalMb
      );
    })
  );

  // Listen for stage completion
  unlisteners.push(
    await onModelDownloadStageComplete((modelName, stage) => {
      logger.modelInfo("Download stage complete", { modelName, stage });
      setStageCompleted(modelName, stage);
    })
  );

  return unlisteners;
}

let listenersInitialized = false;
let unlisteners: UnlistenFn[] = [];

export const useModelsStore = create<ModelsState>()((set, get) => ({
  availableModels: [...AVAILABLE_MODELS],
  downloads: {},
  diskUsage: {
    totalSizeMb: 0,
    freeSpaceMb: 0,
  },
  selectedTranscriptionModel: null,
  selectedDiarizationModel: null,
  isLoading: false,

  loadModels: async () => {
    set({ isLoading: true });
    try {
      const result = await getLocalModels();
      logger.modelDebug("loadModels result", result);
      if (result.success && result.data) {
        const localModels = result.data;
        logger.modelDebug("Local models from backend", { models: localModels.map(m => m.name) });

        set((state) => {
          const newModels = state.availableModels.map((model) => {
            const localModel = localModels.find((lm) => lm.name === model.name);
            if (localModel) {
              return {
                ...model,
                installed: true,
                path: localModel.path,
              };
            }
            return {
              ...model,
              installed: false,
              path: undefined,
            };
          });
          logger.modelDebug("Updated models", { models: newModels.map(m => ({ name: m.name, installed: m.installed })) });
          return { availableModels: newModels };
        });
      }
    } catch (error) {
      logger.modelError("Failed to load models", { error });
    } finally {
      set({ isLoading: false });
    }
  },

  loadDiskUsage: async () => {
    try {
      const result = await getDiskUsage();
      if (result.success && result.data) {
        set({ diskUsage: result.data });
      }
    } catch (error) {
      logger.modelError("Failed to load disk usage", { error });
    }
  },

  downloadModel: async (name: string, modelType: ModelType) => {
    const { huggingFaceToken } = useSettingsStore.getState().settings;
    const sizeMb = getModelSizeMb(name);

    set((state) => ({
      downloads: {
        ...state.downloads,
        [name]: {
          modelName: name,
          progress: 0,
          currentMb: 0,
          totalMb: sizeMb,
          speedMbS: "0",
          status: "downloading",
        },
      },
    }));

    try {
      const result = await downloadModel(name, modelType, huggingFaceToken);
      if (!result.success) {
        throw new Error(result.error || "Download failed");
      }

      // Download completed successfully
      // Note: Status is managed by event listeners (onModelDownloadComplete)
      // which calls setDownloadCompleted to update the state

      // Reload models to update installed status
      get().loadModels();
    } catch (error) {
      set((state) => ({
        downloads: {
          ...state.downloads,
          [name]: {
            ...state.downloads[name],
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        },
      }));
    }
  },

  cancelModelDownload: async (name: string) => {
    try {
      // Update UI to show cancellation in progress
      set((state) => ({
        downloads: {
          ...state.downloads,
          [name]: {
            ...state.downloads[name],
            status: "cancelled",
          },
        },
      }));

      // Call the cancel service
      const result = await cancelDownloadService(name);
      if (!result.success) {
        throw new Error(result.error || "Failed to cancel download");
      }
    } catch (error) {
      set((state) => ({
        downloads: {
          ...state.downloads,
          [name]: {
            ...state.downloads[name],
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        },
      }));
    }
  },

  pauseModelDownload: (name: string) => {
    set((state) => {
      const download = state.downloads[name];
      if (!download || download.status !== "downloading") return state;

      return {
        downloads: {
          ...state.downloads,
          [name]: {
            ...download,
            status: "paused",
          },
        },
      };
    });
  },

  resumeModelDownload: (name: string) => {
    set((state) => {
      const download = state.downloads[name];
      if (!download || download.status !== "paused") return state;

      return {
        downloads: {
          ...state.downloads,
          [name]: {
            ...download,
            status: "downloading",
          },
        },
      };
    });
  },

  deleteModel: async (name: string) => {
    try {
      const result = await deleteModelService(name);
      if (result.success) {
        logger.modelInfo("Model deleted successfully", { modelName: name });
        set((state) => {
          const newDownloads = { ...state.downloads };
          delete newDownloads[name];

          // Clear selected model if the deleted model was selected
          const newState: Partial<ModelsState> = {
            downloads: newDownloads,
          };

          if (state.selectedTranscriptionModel === name) {
            logger.modelInfo("Cleared selected transcription model (was deleted)", { modelName: name });
            newState.selectedTranscriptionModel = null;
          }

          if (state.selectedDiarizationModel === name) {
            logger.modelInfo("Cleared selected diarization model (was deleted)", { modelName: name });
            newState.selectedDiarizationModel = null;
          }

          return newState;
        });
        // Force reload models and update UI
        await get().loadModels();
        await get().loadDiskUsage();
        logger.modelDebug("Models and disk usage reloaded after delete");
      } else {
        logger.modelError("Delete model failed", { error: result.error });
      }
    } catch (error) {
      logger.modelError("Failed to delete model", { error });
    }
  },

  setSelectedTranscriptionModel: async (model: string | null) => {
    set({ selectedTranscriptionModel: model });
    if (model) {
      await saveSelectedModel(`transcription:${model}`);
      const { updateSettings } = useSettingsStore.getState();
      // Type assertion needed: model comes from AvailableModel.name (string)
      // but AppSettings.defaultModel requires AIModel type
      updateSettings({ defaultModel: model as import("@/types").AIModel });
    }
  },

  setSelectedDiarizationModel: async (model: string | null) => {
    set({ selectedDiarizationModel: model });
    if (model) {
      await saveSelectedModel(`diarization:${model}`);
    }
  },

  updateDownloadProgress: (modelName: string, progress: number) => {
    set((state) => {
      const download = state.downloads[modelName];
      if (!download) {
        // Download may have completed quickly, removing the state before late progress events arrive
        logger.modelDebug("No download state found for model (may have completed)", { modelName });
        return state;
      }

      // Calculate current MB based on progress and total
      const currentMb = Math.round((download.totalMb * progress) / 100);

      logger.modelDebug("Updating progress", {
        modelName,
        progress,
        currentMb,
        totalMb: download.totalMb
      });

      return {
        downloads: {
          ...state.downloads,
          [modelName]: {
            ...download,
            progress,
            currentMb,
          },
        },
      };
    });
  },

  setDownloadCompleted: (modelName: string) => {
    logger.modelInfo("Download completed event received", { modelName });
    
    set((state) => {
      // Remove download entry - backend will verify installation
      const newDownloads = { ...state.downloads };
      delete newDownloads[modelName];

      return {
        downloads: newDownloads,
        // Don't set installed: true here - let loadModels() verify from backend
        // This prevents showing "installed" before backend confirms all files exist
      };
    });

    // Reload models from backend to verify installation (with delay for filesystem)
    setTimeout(() => {
      logger.modelDebug("Reloading models after download complete", { modelName });
      get().loadModels();
    }, 1000); // Increased delay for multi-stage downloads
  },

  setDownloadError: (modelName: string, error: string) => {
    set((state) => ({
      downloads: {
        ...state.downloads,
        [modelName]: {
          ...state.downloads[modelName],
          status: "error",
          error,
        },
      },
    }));
  },

  updateDownloadStage: (
    modelName: string,
    stage: string,
    submodelName: string,
    progress: number,
    currentMb: number,
    totalMb: number
  ) => {
    set((state) => {
      const download = state.downloads[modelName];
      if (!download) {
        // Download may have completed quickly, removing the state before late progress events arrive
        logger.modelDebug("No download state found for model (may have completed)", { modelName });
        return state;
      }

      // Initialize stages object if not exists - ALWAYS create new object for immutability
      const stages = { ...download.stages };

      // Update the specific stage - create new object for the stage too
      stages[stage as keyof typeof stages] = {
        progress,
        currentMb,
        totalMb,
        completed: false,
      };

      // Calculate combined progress
      // For diarization models: segmentation (smaller) + embedding (larger)
      const segmentationProgress = stages.segmentation?.progress || 0;
      const embeddingProgress = stages.embedding?.progress || 0;
      const segmentationTotal = stages.segmentation?.totalMb || 0;
      const embeddingTotal = stages.embedding?.totalMb || 0;
      const totalSize = segmentationTotal + embeddingTotal;

      let combinedProgress = progress;
      if (totalSize > 0) {
        // Weighted average based on size
        const segmentationWeight = segmentationTotal / totalSize;
        const embeddingWeight = embeddingTotal / totalSize;
        combinedProgress =
          segmentationProgress * segmentationWeight +
          embeddingProgress * embeddingWeight;
      } else {
        // Fallback to simple average if sizes not available
        combinedProgress =
          stages.segmentation && stages.embedding
            ? (segmentationProgress + embeddingProgress) / 2
            : progress;
      }

      logger.modelDebug("Updating stage progress", {
        modelName,
        stage,
        submodelName,
        progress,
        combinedProgress: combinedProgress.toFixed(1),
        stages,
      });

      return {
        downloads: {
          ...state.downloads,
          [modelName]: {
            ...download,
            currentStage: stage as "segmentation" | "embedding" | null,
            stages,
            progress: combinedProgress,
            currentMb:
              (stages.segmentation?.currentMb || 0) +
              (stages.embedding?.currentMb || 0),
            totalMb: download.totalMb, // Keep original total
          },
        },
      };
    });
  },

  setStageCompleted: (modelName: string, stage: string) => {
    set((state) => {
      const download = state.downloads[modelName];
      if (!download || !download.stages) {
        // Download may have completed quickly, removing the state before late stage events arrive
        logger.modelDebug("No download state or stages found for model (may have completed)", { modelName });
        return state;
      }

      const stages = { ...download.stages };
      if (stages[stage as keyof typeof stages]) {
        stages[stage as keyof typeof stages] = {
          ...stages[stage as keyof typeof stages]!,
          completed: true,
          progress: 100,
        };
      }

      logger.modelDebug("Stage completed", { modelName, stage });

      return {
        downloads: {
          ...state.downloads,
          [modelName]: {
            ...download,
            stages,
          },
        },
      };
    });
  },

  getInstalledModels: () => {
    const state = get();
    return state.availableModels.filter((model) => model.installed);
  },
}));

/**
 * Initialize models store
 */
export async function initializeModelsStore() {
  const store = useModelsStore.getState();

  // Setup event listeners only once
  if (!listenersInitialized) {
    try {
      unlisteners = await setupDownloadEventListeners(
        store.updateDownloadProgress,
        store.setDownloadCompleted,
        store.setDownloadError,
        store.updateDownloadStage,
        store.setStageCompleted
      );
      listenersInitialized = true;
    } catch (error) {
      console.error("Failed to initialize model event listeners:", error);
    }
  }

  await store.loadModels();
  await store.loadDiskUsage();

  const result = await loadSelectedModel();
  if (result.success && result.data) {
    // Parse stored value to determine if it's transcription or diarization model
    if (result.data.startsWith('transcription:')) {
      store.setSelectedTranscriptionModel(result.data.replace('transcription:', ''));
    } else if (result.data.startsWith('diarization:')) {
      store.setSelectedDiarizationModel(result.data.replace('diarization:', ''));
    } else {
      // Legacy format - assume it's a transcription model
      store.setSelectedTranscriptionModel(result.data);
    }
  }
}

/**
 * Cleanup models store event listeners
 * Call this when the app is unmounting to prevent memory leaks
 */
export function cleanupModelsStore() {
  unlisteners.forEach(unlisten => unlisten());
  unlisteners = [];
  listenersInitialized = false;
}
