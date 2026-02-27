import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  AIModel,
  AvailableModel,
  DiskUsage,
  ModelDownloadProgress,
  ModelDownloadState,
  ModelType,
} from "@/types";
import { MODEL_NAMES } from "@/types";
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
  onModelDownloadRetrying,
  onModelDownloadStage,
  onModelDownloadStageComplete,
} from "@/services/tauri";
import { AVAILABLE_MODELS } from "@/types";
import { useSettingsStore } from "./_store";
import { logger } from "@/lib/logger";
import { countBlockingTasksForModel } from "./utils/model-deletion";

interface PendingModelDeletionState {
  requestedAt: number;
  lastAttemptAt?: number;
  lastError?: string;
}

const PENDING_MODEL_DELETIONS_STORAGE_KEY = "vocrify-pending-model-deletions";

function loadPendingModelDeletions(): Record<string, PendingModelDeletionState> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PENDING_MODEL_DELETIONS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, PendingModelDeletionState>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch (error) {
    logger.modelWarn("Failed to parse pending model deletions from storage", { error });
    return {};
  }
}

function persistPendingModelDeletions(pendingModelDeletions: Record<string, PendingModelDeletionState>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      PENDING_MODEL_DELETIONS_STORAGE_KEY,
      JSON.stringify(pendingModelDeletions),
    );
  } catch (error) {
    logger.modelWarn("Failed to persist pending model deletions", { error });
  }
}

function isModelMissingError(errorMessage: string | undefined): boolean {
  if (!errorMessage) {
    return false;
  }

  return errorMessage.toLowerCase().includes("model not found");
}

interface ModelsState {
  availableModels: AvailableModel[];
  downloads: Record<string, ModelDownloadState>;
  deletingModels: Record<string, boolean>;
  pendingModelDeletions: Record<string, PendingModelDeletionState>;
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
  updateDownloadProgress: (progress: ModelDownloadProgress) => void;
  setDownloadCompleted: (modelName: string) => void;
  setDownloadError: (modelName: string, error: string) => void;
  updateDownloadStage: (modelName: string, stage: string, submodelName: string, progress: number, currentMb: number, totalMb: number) => void;
  setStageCompleted: (modelName: string, stage: string) => void;
  getInstalledModels: () => AvailableModel[];
  reconcilePendingModelDeletions: () => Promise<void>;
  isModelPendingDeletion: (modelName: string) => boolean;
}

// Valid model names - used for validation
const VALID_MODELS = Object.keys(MODEL_NAMES) as AIModel[];

/**
 * Validate that a model name is a valid AIModel
 * Returns true if valid, false otherwise
 */
function isValidModel(model: string | null): model is AIModel {
  if (!model) return false;
  // Check if it's a valid model name (not corrupted with paths or commas)
  if (model.includes(',') || model.includes('\\') || model.includes('/')) {
    console.error('[MODEL_VALIDATION] Invalid model name detected:', model);
    return false;
  }
  return VALID_MODELS.includes(model as AIModel);
}

const getModelSizeMb = (modelName: string): number => {
  const model = AVAILABLE_MODELS.find((m) => m.name === modelName);
  return model?.sizeMb || 0;
};

/**
 * Setup model download event listeners
 * Returns array of unlisten functions for cleanup
 *
 * NOTE: We only listen to progress and stage events here.
 * Complete/Error notifications are handled by NotificationEmitter to avoid duplicates.
 */
async function setupDownloadEventListeners(
  updateProgress: (progress: ModelDownloadProgress) => void,
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
      updateProgress(progress);
    })
  );

  // Listen for download completion (for state updates only, notifications handled by NotificationEmitter)
  unlisteners.push(
    await onModelDownloadComplete((modelName) => {
      logger.modelInfo("Download complete", { modelName });
      if (modelName) {
        setCompleted(modelName);
      }
    })
  );

  // Listen for download errors (for state updates only, notifications handled by NotificationEmitter)
  unlisteners.push(
    await onModelDownloadError((modelName, error) => {
      logger.modelError("Download error", { modelName, error });
      if (modelName && error) {
        setError(modelName, error);
      }
    })
  );

  // Listen for download retrying events (temporary network errors)
  // These should NOT change the status from "downloading" to "error"
    unlisteners.push(
    await onModelDownloadRetrying((modelName, message) => {
      logger.modelWarn("Download retrying", { modelName, message });
      // Do NOT call setError() here - keep status as "downloading"
      // The download will retry automatically via tenacity
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
  deletingModels: {},
  pendingModelDeletions: loadPendingModelDeletions(),
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
          const installedModelNames = new Set(localModels.map((model) => model.name));
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

          const nextPendingModelDeletions = { ...state.pendingModelDeletions };
          let pendingChanged = false;
          for (const modelName of Object.keys(nextPendingModelDeletions)) {
            if (!installedModelNames.has(modelName)) {
              delete nextPendingModelDeletions[modelName];
              pendingChanged = true;
            }
          }

          if (pendingChanged) {
            persistPendingModelDeletions(nextPendingModelDeletions);
          }

          logger.modelDebug("Updated models", { models: newModels.map(m => ({ name: m.name, installed: m.installed })) });

          if (!pendingChanged) {
            return { availableModels: newModels };
          }

          return {
            availableModels: newModels,
            pendingModelDeletions: nextPendingModelDeletions,
          };
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
    const sizeMb = getModelSizeMb(name);

    set((state) => ({
      downloads: {
        ...state.downloads,
        [name]: {
          modelName: name,
          progress: 0,
          currentMb: 0,
          totalMb: sizeMb,
          speedMbS: 0,
          etaS: undefined,
          totalEstimated: false,
          status: "downloading",
        },
      },
    }));

    try {
      const result = await downloadModel(name, modelType);
      if (!result.success) {
        throw new Error(result.error || "Download failed");
      }

      // Download completed successfully
      // Note: Status is managed by event listeners (onModelDownloadComplete)
      // which calls setDownloadCompleted to update the state
      // IMPORTANT: Don't call loadModels() here anymore!
      // onModelDownloadComplete will call setDownloadCompleted which already triggers loadModels()
      // This prevents showing "installed" before backend confirms all files exist
      // The 1 second delay in setDownloadCompleted gives time for multi-stage downloads to complete
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
    const hadSelectedModel =
      get().selectedTranscriptionModel === name ||
      get().selectedDiarizationModel === name;

    set((state) => ({
      deletingModels: {
        ...state.deletingModels,
        [name]: true,
      },
    }));

    try {
      const blockingTasks = countBlockingTasksForModel(useSettingsStore.getState().tasks, name);

      if (blockingTasks > 0) {
        logger.modelInfo("Model deletion scheduled after active tasks finish", {
          modelName: name,
          blockingTasks,
        });

        set((state) => {
          const nextPendingModelDeletions = {
            ...state.pendingModelDeletions,
            [name]: {
              requestedAt: state.pendingModelDeletions[name]?.requestedAt ?? Date.now(),
              lastAttemptAt: Date.now(),
            },
          };
          persistPendingModelDeletions(nextPendingModelDeletions);

          const nextState: Partial<ModelsState> = {
            pendingModelDeletions: nextPendingModelDeletions,
          };

          if (state.selectedTranscriptionModel === name) {
            nextState.selectedTranscriptionModel = null;
          }

          if (state.selectedDiarizationModel === name) {
            nextState.selectedDiarizationModel = null;
          }

          return nextState;
        });

        if (hadSelectedModel) {
          await saveSelectedModel("");
        }
        return;
      }

      const result = await deleteModelService(name);
      if (result.success || isModelMissingError(result.error)) {
        logger.modelInfo("Model deleted successfully", { modelName: name });

        set((state) => {
          const newDownloads = { ...state.downloads };
          delete newDownloads[name];
          const newPendingModelDeletions = { ...state.pendingModelDeletions };
          delete newPendingModelDeletions[name];
          persistPendingModelDeletions(newPendingModelDeletions);

          // Clear selected model if the deleted model was selected
          const newState: Partial<ModelsState> = {
            downloads: newDownloads,
            pendingModelDeletions: newPendingModelDeletions,
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

        if (hadSelectedModel) {
          await saveSelectedModel("");
        }
        // Force reload models and update UI
        await get().loadModels();
        await get().loadDiskUsage();
        logger.modelDebug("Models and disk usage reloaded after delete");
      } else {
        logger.modelWarn("Delete model failed, keeping pending deletion", {
          modelName: name,
          error: result.error,
        });

        set((state) => {
          const nextPendingModelDeletions = {
            ...state.pendingModelDeletions,
            [name]: {
              requestedAt: state.pendingModelDeletions[name]?.requestedAt ?? Date.now(),
              lastAttemptAt: Date.now(),
              lastError: result.error,
            },
          };
          persistPendingModelDeletions(nextPendingModelDeletions);

          return {
            pendingModelDeletions: nextPendingModelDeletions,
          };
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.modelWarn("Failed to delete model, keeping pending deletion", {
        modelName: name,
        error: errorMessage,
      });

      set((state) => {
        const nextPendingModelDeletions = {
          ...state.pendingModelDeletions,
          [name]: {
            requestedAt: state.pendingModelDeletions[name]?.requestedAt ?? Date.now(),
            lastAttemptAt: Date.now(),
            lastError: errorMessage,
          },
        };
        persistPendingModelDeletions(nextPendingModelDeletions);

        return {
          pendingModelDeletions: nextPendingModelDeletions,
        };
      });
    } finally {
      set((state) => {
        if (!state.deletingModels[name]) {
          return state;
        }

        const newDeletingModels = { ...state.deletingModels };
        delete newDeletingModels[name];

        return {
          deletingModels: newDeletingModels,
        };
      });
    }
  },

  setSelectedTranscriptionModel: async (model: string | null) => {
    // Validate the model before saving
    if (model && !isValidModel(model)) {
      console.error('[MODEL_VALIDATION] Invalid model selected:', model);
      logger.modelError("Invalid model selected", { model });
      return;
    }

    if (model && get().pendingModelDeletions[model]) {
      logger.modelWarn("Cannot select model scheduled for deletion", { modelName: model });
      return;
    }

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
    if (model && get().pendingModelDeletions[model]) {
      logger.modelWarn("Cannot select diarization model scheduled for deletion", { modelName: model });
      return;
    }

    set({ selectedDiarizationModel: model });
    if (model) {
      await saveSelectedModel(`diarization:${model}`);
    }
  },

  updateDownloadProgress: (progressEvent: ModelDownloadProgress) => {
    set((state) => {
      const modelName = progressEvent.modelName;
      const download = state.downloads[modelName];
      if (!download) {
        // Download may have completed quickly, removing the state before late progress events arrive
        logger.modelDebug("No download state found for model (may have completed)", { modelName });
        return state;
      }

      const backendCurrentMb = Number.isFinite(progressEvent.currentMb)
        ? progressEvent.currentMb
        : 0;
      const backendTotalMb = Number.isFinite(progressEvent.totalMb)
        ? progressEvent.totalMb
        : 0;
      const fallbackTotalMb = download.totalMb || 0;
      const hasBackendEstimatedFlag = progressEvent.totalEstimated === true;

      // Prefer backend total, fallback to static model estimate from UI catalog
      const totalMb = backendTotalMb > 0 ? backendTotalMb : fallbackTotalMb;
      const currentMb = backendCurrentMb > 0
        ? backendCurrentMb
        : (totalMb > 0 ? Math.round((totalMb * progressEvent.percent) / 100) : 0);

      // Normalize progress defensively:
      // backend can occasionally report 100% before bytes catch up.
      let progress = progressEvent.percent;
      const computedProgress =
        totalMb > 0 && currentMb >= 0
          ? Math.min(100, (currentMb / totalMb) * 100)
          : NaN;

      if (!Number.isFinite(progress) || progress <= 0) {
        if (Number.isFinite(computedProgress)) {
          progress = computedProgress;
        }
      } else if (
        Number.isFinite(computedProgress) &&
        progress >= 99.9 &&
        computedProgress < 99.5 &&
        progressEvent.status === "downloading"
      ) {
        // Prevent false instant 100% while still downloading.
        progress = computedProgress;
      }

      // While status is downloading, avoid showing 100% until bytes are essentially complete.
      if (
        progressEvent.status === "downloading" &&
        Number.isFinite(computedProgress) &&
        computedProgress < 99.5
      ) {
        progress = Math.min(progress, 99.4);
      }

      const totalEstimated = hasBackendEstimatedFlag || backendTotalMb <= 0;
      const etaS =
        typeof progressEvent.etaS === "number" && Number.isFinite(progressEvent.etaS) && progressEvent.etaS > 0
          ? progressEvent.etaS
          : undefined;

      logger.modelDebug("Updating progress", {
        modelName,
        progress,
        currentMb,
        totalMb,
        speedMbS: progressEvent.speedMbS,
        etaS,
        totalEstimated,
      });

      return {
        downloads: {
          ...state.downloads,
          [modelName]: {
            ...download,
            progress,
            currentMb,
            totalMb,
            speedMbS: Math.max(0, progressEvent.speedMbS || 0),
            etaS,
            totalEstimated,
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
      const stageKey = stage as keyof typeof stages;
      const stageEntry = stages[stageKey];
      if (stageEntry) {
        stages[stageKey] = {
          ...stageEntry,
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

  reconcilePendingModelDeletions: async () => {
    const pendingModelNames = Object.keys(get().pendingModelDeletions);
    if (pendingModelNames.length === 0) {
      return;
    }

    logger.modelDebug("Reconciling pending model deletions", {
      pendingCount: pendingModelNames.length,
      models: pendingModelNames,
    });

    for (const modelName of pendingModelNames) {
      if (get().deletingModels[modelName]) {
        continue;
      }

      const blockingTasks = countBlockingTasksForModel(useSettingsStore.getState().tasks, modelName);
      if (blockingTasks > 0) {
        continue;
      }

      await get().deleteModel(modelName);
    }
  },

  isModelPendingDeletion: (modelName: string) => {
    return Boolean(get().pendingModelDeletions[modelName]);
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
      logger.modelError("Failed to initialize model event listeners", { error });
    }
  }

  await store.loadModels();
  await store.loadDiskUsage();

  const result = await loadSelectedModel();
  if (result.success && result.data) {
    let modelName: string | null = null;
    let modelCategory: 'transcription' | 'diarization' = 'transcription';

    // Parse stored value to determine category and model name
    if (result.data.startsWith('transcription:')) {
      modelName = result.data.replace('transcription:', '');
      modelCategory = 'transcription';
    } else if (result.data.startsWith('diarization:')) {
      modelName = result.data.replace('diarization:', '');
      modelCategory = 'diarization';
    } else {
      // Legacy format - assume transcription model
      modelName = result.data;
      modelCategory = 'transcription';
    }

    // Validate the loaded model name - discard if corrupted
    if (isValidModel(modelName) && !store.isModelPendingDeletion(modelName)) {
      if (modelCategory === 'diarization') {
        store.setSelectedDiarizationModel(modelName);
      } else {
        store.setSelectedTranscriptionModel(modelName);
      }
    } else {
      console.warn('[MODEL_VALIDATION] Discarding corrupted model selection:', modelName);
      // Clear the corrupted value from storage
      await saveSelectedModel('');
    }
  }

  await store.reconcilePendingModelDeletions();
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
