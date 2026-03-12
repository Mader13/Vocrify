/**
 * Core Tasks Store - internal module.
 *
 * All Zustand store definitions live here so that higher-level modules
 * (settingsStore, archiveStore, tasksStore) can import without circular deps.
 * External consumers should import from `@/stores` (the barrel) instead.
 */

import { create } from "zustand";
import { useMemo } from "react";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_SETTINGS } from "@/types";
import type {
  TranscriptionTask,
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionSegment,
  TaskStatus,
  ProgressStage,
  ProgressMetrics,
  SpeakerTurn,
  DiarizationProvider,
  EnginePreference,
  ArchiveMode,
  ArchiveCompression,
  ArchiveSettings,
  AppSettings,
  CloseBehavior,
} from "@/types";
import { logger } from "@/lib/logger";
import { recoverInterruptedTasks } from "@/stores/utils/task-recovery";
import { canArchiveTask } from "@/stores/utils/archive-eligibility";
import { isModelPendingDeletion } from "@/stores/utils/model-deletion";
import { getStoredMediaPathsForDeletion } from "@/stores/utils/task-media-cleanup";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/i18n";

// ============================================================================
// Types
// ============================================================================

export type ViewType = "transcription" | "models" | "settings" | "archive";

/**
 * UI-specific AppSettings extending base types with additional fields
 */
export type { AppSettings } from "@/types";

interface TasksState {
  tasks: TranscriptionTask[];
  view: ViewType;
  options: TranscriptionOptions;
  settings: AppSettings;
  archiveSettings: ArchiveSettings;
  selectedTaskId: string | null;
  upsertTask: (task: TranscriptionTask) => void;
  updateTaskProgress: (taskId: string, progress: number, stage?: ProgressStage, metrics?: ProgressMetrics) => void;
  updateTaskStatus: (
    taskId: string,
    status: TaskStatus,
    result?: TranscriptionResult,
    error?: string | null,
  ) => void;
  appendTaskSegment: (taskId: string, segment: TranscriptionSegment, index: number, totalSegments: number | null) => void;
  appendStreamingSegment: (taskId: string, segment: TranscriptionSegment) => void;
  finalizeTaskResult: (taskId: string, segments: TranscriptionSegment[], language: string, duration: number) => void;
  setTasks: (tasks: TranscriptionTask[]) => void;
  setView: (view: ViewType) => void;
  setOptions: (options: Partial<TranscriptionOptions>) => void;
  setSettings: (settings: Partial<AppSettings>) => void;
  setArchiveSettings: (settings: Partial<ArchiveSettings>) => void;
  resetSettings: () => void;
  deleteTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  archiveTask: (taskId: string) => void;
  archiveTaskWithMode: (taskId: string, mode: ArchiveMode, compression?: ArchiveCompression) => Promise<void>;
  unarchiveTask: (taskId: string) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  updateLastDiarizationProvider: (provider: DiarizationProvider) => void;
  initializeTaskStorage: () => Promise<void>;
  addTask: (path: string, name: string, size: number, options: TranscriptionOptions) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  setSpeakerSegments: (taskId: string, speakerSegments: TranscriptionSegment[], speakerTurns: SpeakerTurn[]) => void;
  updateSpeakerNameMap: (taskId: string, speakerNameMap: Record<string, string>) => void;
  updateTaskFileName: (taskId: string, fileName: string) => void;
}

// ============================================================================
// Initial state
// ============================================================================

const initialState: Pick<TasksState, "tasks" | "view" | "options" | "settings" | "archiveSettings" | "selectedTaskId"> = {
  tasks: [],
  view: "transcription",
  options: {
    model: "whisper-base",
    device: "auto",
    language: "auto",
    enableDiarization: false,
    diarizationProvider: "none",
    numSpeakers: 2,
    audioProfile: "standard",
  },
  settings: {
    ...DEFAULT_SETTINGS,
  },
  archiveSettings: {
    defaultMode: "delete_video",
    compression: "none",
    rememberChoice: true,
    showFileSizes: true,
  },
  selectedTaskId: null,
};

// ============================================================================
// Helpers
// ============================================================================

function filterTasksByView(tasks: TranscriptionTask[], view: ViewType): TranscriptionTask[] {
  if (view === "models" || view === "settings" || view === "archive") {
    return [];
  }
  return tasks.filter((task) => !task.archived);
}

function getArchivedTasks(tasks: TranscriptionTask[]): TranscriptionTask[] {
  return tasks.filter((task) => task.archived);
}

function ensureTaskResult(task: TranscriptionTask): TranscriptionTask {
  if (!task.result) {
    return {
      ...task,
      result: {
        segments: [],
        language: "",
        duration: 0,
      },
    };
  }
  return task;
}

let taskStorageInitialized = false;
let taskStorageInitializationPromise: Promise<void> | null = null;

function persistTaskSnapshot(task: TranscriptionTask): void {
  (async () => {
    try {
      const { saveTranscription } = await import("@/services/storage");
      const result = await saveTranscription(task);

      if (!result.success) {
        logger.warn("Failed to persist task snapshot", {
          taskId: task.id,
          error: result.error,
        });
      }
    } catch (error) {
      logger.error("Unexpected task persistence error", {
        taskId: task.id,
        error: String(error),
      });
    }
  })();
}

type PersistedTasksState = Partial<TasksState> & {
  settings?: Partial<AppSettings>;
};

export function migratePersistedTasksState(persistedState: unknown, version: number): PersistedTasksState {
  if (!persistedState || typeof persistedState !== "object") {
    return {};
  }

  const typedPersisted = persistedState as PersistedTasksState;
  if (version < 2) {
    return {
      ...typedPersisted,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(typedPersisted.settings ?? {}),
        closeBehavior:
          typedPersisted.settings?.closeBehavior === "exit"
            ? "exit"
            : DEFAULT_SETTINGS.closeBehavior,
      },
    };
  }

  return typedPersisted;
}

// ============================================================================
// Tasks Store
// ============================================================================

export const useTasks = create<TasksState>()(
  persist(
    (set, get) => {
      const validateSettings = (state: TasksState) => {
        if (!state.settings) return;
        const { settings } = state;
        const validEnginePrefs: EnginePreference[] = ["auto", "rust"];
        const validDevices = ["auto", "cpu", "cuda", "mps", "vulkan"] as const;
        const validCloseBehaviors: CloseBehavior[] = ["hide_to_tray", "exit"];

        if (settings.enginePreference && !validEnginePrefs.includes(settings.enginePreference)) {
          logger.warn("Invalid enginePreference in localStorage, resetting to default", {
            invalid: settings.enginePreference
          });
          set((state) => ({
            settings: { ...state.settings, enginePreference: "auto" }
          }));
        }

        if (settings.defaultDevice && !(validDevices as readonly string[]).includes(settings.defaultDevice)) {
          logger.warn("Invalid defaultDevice in localStorage, resetting to default", {
            invalid: settings.defaultDevice
          });
          set((state) => ({
            settings: { ...state.settings, defaultDevice: "auto" }
          }));
        }

        if (settings.closeBehavior && !validCloseBehaviors.includes(settings.closeBehavior)) {
          logger.warn("Invalid closeBehavior in localStorage, resetting to default", {
            invalid: settings.closeBehavior,
          });
          set((state) => ({
            settings: { ...state.settings, closeBehavior: DEFAULT_SETTINGS.closeBehavior },
          }));
        }

        if (settings.language && !SUPPORTED_LOCALES.includes(settings.language)) {
          logger.warn("Invalid UI locale in localStorage, resetting to default", {
            invalid: settings.language,
          });
          set((state) => ({
            settings: { ...state.settings, language: DEFAULT_LOCALE },
          }));
        }
      };

      const state = get();
      if (state?.settings) {
        validateSettings(state);
      }

      return {
        ...initialState,

        initializeTaskStorage: async () => {
          if (taskStorageInitialized) {
            return;
          }

          if (taskStorageInitializationPromise) {
            await taskStorageInitializationPromise;
            return;
          }

          taskStorageInitializationPromise = (async () => {
            const {
              loadAllTranscriptions,
              loadLegacyPersistedTasks,
              clearLegacyPersistedTasks,
              saveTranscription,
            } = await import("@/services/storage");

            const loadedTasksResult = await loadAllTranscriptions();
            let tasksFromStorage = loadedTasksResult.success && loadedTasksResult.data
              ? loadedTasksResult.data
              : [];
            let migratedLegacyCount = 0;

            if (tasksFromStorage.length === 0) {
              const legacyTasks = loadLegacyPersistedTasks();
              if (legacyTasks.length > 0) {
                tasksFromStorage = legacyTasks;
                migratedLegacyCount = legacyTasks.length;

                const migrationResults = await Promise.all(
                  legacyTasks.map((task) => saveTranscription(task)),
                );
                const failedMigrations = migrationResults.filter((result) => !result.success).length;
                if (failedMigrations > 0) {
                  logger.warn("Some legacy task migrations failed", {
                    migratedLegacyCount,
                    failedMigrations,
                  });
                }
              }
            }

            const processingTaskIds = new Set(
              tasksFromStorage
                .filter((task) => task.status === "processing")
                .map((task) => task.id),
            );

            const {
              tasks: recoveredTasks,
              recoveredCount,
              hasActiveProcessing,
            } = recoverInterruptedTasks(tasksFromStorage);

            set({ tasks: recoveredTasks });

            if (processingTaskIds.size > 0) {
              await Promise.all(
                recoveredTasks
                  .filter((task) => processingTaskIds.has(task.id))
                  .map((task) => saveTranscription(task)),
              );
            }

            if (tasksFromStorage.length > 0 || migratedLegacyCount > 0) {
              clearLegacyPersistedTasks();
            }

            taskStorageInitialized = true;

            logger.info("Task storage initialized", {
              loadedCount: tasksFromStorage.length,
              recoveredCount,
              hasActiveProcessing,
              migratedLegacyCount,
            });
          })()
            .catch((error) => {
              logger.error("Failed to initialize task storage", {
                error: String(error),
              });
            })
            .finally(() => {
              taskStorageInitializationPromise = null;
            });

          await taskStorageInitializationPromise;
        },

        upsertTask: (task) => {
          logger.transcriptionInfo("Task created/updated", { taskId: task.id, fileName: task.fileName, status: task.status });
          set((state) => {
            const index = state.tasks.findIndex((t) => t.id === task.id);
            if (index === -1) {
              return { tasks: [...state.tasks, task] };
            }
            return {
              tasks: state.tasks.map((t, i) => (i === index ? task : t)),
            };
          });
          persistTaskSnapshot(task);
        },

        updateTaskProgress: (taskId, progress, stage, metrics) => {
          logger.transcriptionDebug("Progress update", { taskId, progress, stage, metrics });
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId
                ? { ...task, progress, lastProgressUpdate: Date.now(), ...(stage && { stage }), ...(metrics && { metrics }) }
                : task,
            ),
          }));
        },

        updateTaskStatus: (taskId, status, result, error) => {
          logger.transcriptionInfo("Status update", { taskId, status, error, hasResult: !!result });
          let taskToPersist: TranscriptionTask | null = null;

          set((state) => {
            const taskExists = state.tasks.some((t) => t.id === taskId);
            if (!taskExists) {
              logger.transcriptionError("Task not found in store", { taskId, availableTasks: state.tasks.map(t => t.id) });
            }

            const tasks = state.tasks.map((task) => {
              if (task.id !== taskId) return task;

              const updatedTask: TranscriptionTask = {
                ...task,
                status,
                progress: status === "completed" ? 100 : task.progress,
                stage: status === "completed" ? undefined : task.stage,
                ...(result && { result }),
                ...(error !== undefined && { error }),
                ...(status === "processing" && !task.startedAt && { startedAt: new Date() }),
                ...(status === "processing" && { lastProgressUpdate: Date.now() }),
              };

              taskToPersist = updatedTask;
              return updatedTask;
            });

            return { tasks };
          });

          if (taskToPersist) {
            persistTaskSnapshot(taskToPersist);
          }
        },

        setSpeakerSegments: (taskId, speakerSegments, speakerTurns) => {
          logger.transcriptionInfo("Speaker segments set", { taskId, count: speakerSegments.length });
          let taskToPersist: TranscriptionTask | null = null;

          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) return task;
              if (!task.result) return task;

              const updatedTask: TranscriptionTask = {
                ...task,
                result: {
                  ...task.result,
                  speakerSegments,
                  speakerTurns,
                },
              };

              taskToPersist = updatedTask;
              return updatedTask;
            }),
          }));

          if (taskToPersist) {
            persistTaskSnapshot(taskToPersist);
          }
        },

        updateSpeakerNameMap: (taskId, speakerNameMap) => {
          logger.transcriptionInfo("Speaker name map updated", {
            taskId,
            mappedSpeakers: Object.keys(speakerNameMap).length,
          });

          let taskToPersist: TranscriptionTask | null = null;

          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) {
                return task;
              }

              const updatedTask: TranscriptionTask = { ...task, speakerNameMap };
              taskToPersist = updatedTask;
              return updatedTask;
            }),
          }));

          if (taskToPersist) {
            persistTaskSnapshot(taskToPersist);
          }
        },

        updateTaskFileName: (taskId, fileName) => {
          logger.transcriptionInfo("Task filename updated", { taskId, fileName });

          let taskToPersist: TranscriptionTask | null = null;

          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) {
                return task;
              }

              const updatedTask: TranscriptionTask = { ...task, fileName };
              taskToPersist = updatedTask;
              return updatedTask;
            }),
          }));

          if (taskToPersist) {
            persistTaskSnapshot(taskToPersist);
          }
        },

        appendTaskSegment: (taskId, segment, index, _totalSegments) => {
          logger.transcriptionDebug("Appending segment", { taskId, index, segmentText: segment.text.substring(0, 50) });
          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) return task;

              const taskWithResult = ensureTaskResult(task);
              const existingSegments = taskWithResult.result?.segments || [];
              const newSegments = [...existingSegments];

              if (index < newSegments.length) {
                newSegments[index] = segment;
              } else if (index === newSegments.length) {
                newSegments.push(segment);
              } else {
                while (newSegments.length < index) {
                  newSegments.push({ start: 0, end: 0, text: "...", speaker: null, confidence: 0 });
                }
                newSegments.push(segment);
              }

              const result = taskWithResult.result;
              if (!result) {
                return taskWithResult;
              }

              return {
                ...taskWithResult,
                result: {
                  ...result,
                  segments: newSegments,
                  duration: Math.max(result.duration || 0, segment.end),
                },
              };
            }),
          }));
        },

        appendStreamingSegment: (taskId, segment) => {
          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) return task;
              const streamingSegments = task.streamingSegments || [];
              return {
                ...task,
                streamingSegments: [...streamingSegments, segment].slice(-5),
              };
            }),
          }));
        },

        finalizeTaskResult: (taskId, segments, language, duration) => {
          logger.transcriptionInfo("Finalizing result", { taskId, segmentCount: segments.length, language, duration });
          let taskToPersist: TranscriptionTask | null = null;

          set((state) => {
            const tasks = state.tasks.map((task) => {
              if (task.id !== taskId) {
                return task;
              }

              const updatedTask: TranscriptionTask = {
                ...task,
                result: {
                  segments,
                  language,
                  duration,
                },
              };

              taskToPersist = updatedTask;
              return updatedTask;
            });

            return { tasks };
          });

          if (taskToPersist) {
            persistTaskSnapshot(taskToPersist);
          }
        },

        setTasks: (tasks) => {
          logger.info("Tasks set", { count: tasks.length });
          set({ tasks });
        },

        setView: (view) => {
          logger.info("View changed", { view });
          set({ view });
        },

        setOptions: (newOptions) => {
          logger.info("Options updated", { options: newOptions });
          set((state) => ({ options: { ...state.options, ...newOptions } }));
        },

        setSettings: (newSettings) => {
          logger.info("Settings updated", { settings: newSettings });
          set((state) => ({ settings: { ...state.settings, ...newSettings } }));
        },

        updateSettings: (newSettings) => {
          logger.info("Settings updated", { settings: newSettings });
          set((state) => ({ settings: { ...state.settings, ...newSettings } }));
        },

        updateLastDiarizationProvider: (provider) => {
          logger.info("Last diarization provider updated", { provider });
          set((state) => ({
            settings: { ...state.settings, lastDiarizationProvider: provider },
          }));
        },

        resetSettings: () => {
          logger.info("Settings reset to defaults");
          set(() => ({ settings: { ...DEFAULT_SETTINGS } }));
        },

        removeTask: async (taskId) => {
          const task = get().tasks.find((t) => t.id === taskId);
          const filesToDelete = task ? getStoredMediaPathsForDeletion(task) : [];

          const { deleteTranscription } = await import("@/services/storage");
          const deletionResult = await deleteTranscription(taskId);

          if (!deletionResult.success) {
            logger.error("Failed to remove task snapshot from persistent storage", {
              taskId,
              error: deletionResult.error,
            });
            return;
          }

          logger.info("Task removed", { taskId });
          set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }));

          if (filesToDelete.length > 0) {
            const { deleteFile } = await import("@/services/tauri");

            for (const filePath of filesToDelete) {
              try {
                const result = await deleteFile(filePath);
                if (result.success) {
                  logger.transcriptionInfo("Stored media file deleted", { taskId, filePath });
                } else {
                  logger.warn("Failed to delete stored media file", { taskId, filePath, error: result.error });
                }
              } catch (error) {
                logger.error("Error deleting stored media file", { taskId, filePath, error: String(error) });
              }
            }
          }
        },

        deleteTask: (taskId) => {
          logger.transcriptionInfo("Task deleted", { taskId });
          get().removeTask(taskId);
        },

        archiveTask: (taskId) => {
          logger.transcriptionInfo("Task archived", { taskId });

          let taskToPersist: TranscriptionTask | null = null;

          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) {
                return task;
              }

              const updatedTask: TranscriptionTask = { ...task, archived: true };
              taskToPersist = updatedTask;
              return updatedTask;
            }),
          }));

          if (taskToPersist) {
            persistTaskSnapshot(taskToPersist);
          }
        },

        unarchiveTask: (taskId) => {
          logger.transcriptionInfo("Task unarchived", { taskId });

          let taskToPersist: TranscriptionTask | null = null;

          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) {
                return task;
              }

              const updatedTask: TranscriptionTask = { ...task, archived: false };
              taskToPersist = updatedTask;
              return updatedTask;
            }),
          }));

          if (taskToPersist) {
            persistTaskSnapshot(taskToPersist);
          }
        },

        setArchiveSettings: (newSettings) => {
          logger.info("Archive settings updated", { settings: newSettings });
          set((state) => ({ archiveSettings: { ...state.archiveSettings, ...newSettings } }));
        },

        archiveTaskWithMode: async (taskId, mode, compressionOverride) => {
          const task = get().tasks.find((t) => t.id === taskId);
          if (!task) {
            logger.error("Archive task not found", { taskId });
            return;
          }

          if (!canArchiveTask(task)) {
            logger.warn("Archive denied for non-archivable task", { taskId, status: task.status });
            throw new Error(`Task status '${task.status}' cannot be archived`);
          }

          const { convertToMp3, getArchiveDir, getFileSize, copyFile, compressMedia, deleteFile } = await import("@/services/tauri");

          logger.transcriptionInfo("Task archiving with mode", { taskId, mode, fileName: task.fileName });

          let archivedMediaPath: string | undefined;
          let archiveDestPath: string | undefined;
          let archiveSize: number | undefined;
          let taskToPersist: TranscriptionTask | null = null;
          const sourcePath = task.managedCopyPath ?? task.filePath;
          const sourceWasManagedCopy = Boolean(task.managedCopyPath && sourcePath === task.managedCopyPath);
          const sourceExt = sourcePath?.split(".").pop()?.toLowerCase();
          const requiresArchivedMedia = mode !== "text_only";

          const readArchiveSize = async (filePath: string): Promise<number> => {
            const sizeResult = await getFileSize(filePath);
            if (sizeResult.success && typeof sizeResult.data === "number") {
              return sizeResult.data;
            }
            logger.warn("Archive task: failed to read archive file size", {
              taskId,
              filePath,
              error: sizeResult.error,
            });
            return task.fileSize;
          };

          try {
            const archiveDirResult = await getArchiveDir();
            if (requiresArchivedMedia && !sourcePath) {
              throw new Error("Archive source media is unavailable");
            }

            if (requiresArchivedMedia && (!archiveDirResult.success || !archiveDirResult.data)) {
              throw new Error(archiveDirResult.error || "Failed to resolve archive directory");
            }

            switch (mode) {
              case "keep_all": {
                if (archiveDirResult.data && sourcePath) {
                  const ext = sourceExt || "bin";
                  const compression = compressionOverride ?? get().archiveSettings.compression;
                  archiveDestPath = `${archiveDirResult.data}/${task.id}.${ext}`;

                  if (compression === "none") {
                    const copyResult = await copyFile(sourcePath, archiveDestPath);
                    if (!copyResult.success || !copyResult.data) {
                      throw new Error(copyResult.error || "Failed to copy media to archive");
                    }

                    archivedMediaPath = copyResult.data;
                    logger.transcriptionInfo("keep_all: copied media file to archive", {
                      taskId,
                      archivedMediaPath,
                      archiveDestPath,
                      ext,
                      compression,
                      source: sourceWasManagedCopy ? "managed_copy" : "original",
                    });
                    archiveSize = await readArchiveSize(copyResult.data);
                  } else {
                    const compressResult = await compressMedia(sourcePath, archiveDestPath, compression);
                    if (!compressResult.success || !compressResult.data) {
                      throw new Error(compressResult.error || "Failed to compress media for archive");
                    }

                    archivedMediaPath = compressResult.data;
                    logger.transcriptionInfo("keep_all: compressed file to archive", {
                      taskId,
                      archivedMediaPath,
                      archiveDestPath,
                      ext,
                      compression,
                    });
                    archiveSize = await readArchiveSize(compressResult.data);
                  }
                }
                break;
              }

              case "delete_video": {
                if (archiveDirResult.data && sourcePath) {
                  const ext = sourceExt;
                  const isAudioFile = ext && ["mp3", "wav", "m4a", "flac", "ogg"].includes(ext);
                  archiveDestPath = `${archiveDirResult.data}/${task.id}.mp3`;

                  if (isAudioFile && ext === "mp3") {
                    const copyResult = await copyFile(sourcePath, archiveDestPath);
                    if (!copyResult.success || !copyResult.data) {
                      throw new Error(copyResult.error || "Failed to copy archived audio");
                    }

                    archivedMediaPath = copyResult.data;
                    logger.transcriptionInfo("delete_video: copied managed MP3 to archive", {
                      taskId,
                      archivedMediaPath,
                      archiveDestPath,
                      source: sourceWasManagedCopy ? "managed_copy" : "original",
                    });
                    archiveSize = await readArchiveSize(copyResult.data);
                  } else if (isAudioFile) {
                    const convertResult = await convertToMp3(sourcePath, archiveDestPath);
                    if (!convertResult.success || !convertResult.data) {
                      throw new Error(convertResult.error || "Failed to convert archived audio");
                    }

                    archivedMediaPath = convertResult.data;
                    logger.transcriptionInfo("delete_video: converted audio file for archive", {
                      taskId,
                      archivedMediaPath,
                      archiveDestPath,
                    });
                    archiveSize = await readArchiveSize(convertResult.data);
                  } else {
                    const convertResult = await convertToMp3(sourcePath, archiveDestPath);
                    if (!convertResult.success || !convertResult.data) {
                      throw new Error(convertResult.error || "Failed to extract archived audio");
                    }

                    archivedMediaPath = convertResult.data;
                    logger.transcriptionInfo("delete_video: converted video to MP3", {
                      taskId,
                      archivedMediaPath,
                      archiveDestPath,
                    });
                    archiveSize = await readArchiveSize(convertResult.data);
                  }
                }
                break;
              }

              case "text_only": {
                logger.transcriptionInfo("text_only: no files copied to archive", { taskId });
                archiveSize = 0;
                break;
              }
            }

            if (requiresArchivedMedia && !archivedMediaPath) {
              throw new Error("Archive completed without a playable media file");
            }

            if (sourceWasManagedCopy && task.managedCopyPath && (mode === "text_only" || task.managedCopyPath !== archivedMediaPath)) {
              const deleteManagedCopyResult = await deleteFile(task.managedCopyPath);
              if (!deleteManagedCopyResult.success) {
                logger.warn("Archive task: failed to cleanup old managed copy after transfer", {
                  taskId,
                  managedCopyPath: task.managedCopyPath,
                  error: deleteManagedCopyResult.error,
                });
              }
            }

            set((state) => ({
              tasks: state.tasks.map((t) => {
                if (t.id !== taskId) {
                  return t;
                }

                const updatedTask: TranscriptionTask = {
                  ...t,
                  archived: true,
                  archivedAt: new Date(),
                  archiveMode: mode,
                  filePath: mode === "keep_all" ? archivedMediaPath : undefined,
                  audioPath: mode === "delete_video" ? archivedMediaPath : undefined,
                  archiveSize: archiveSize ?? (mode === "text_only" ? 0 : task.fileSize),
                  managedCopyPath: mode === "text_only" ? undefined : sourceWasManagedCopy ? archivedMediaPath : t.managedCopyPath,
                  managedCopySize:
                    mode === "text_only" ? undefined : sourceWasManagedCopy && archiveSize !== undefined ? archiveSize : t.managedCopySize,
                  managedCopyStatus: mode === "text_only" ? undefined : sourceWasManagedCopy ? "done" : t.managedCopyStatus,
                  managedCopyError: mode === "text_only" ? undefined : sourceWasManagedCopy ? undefined : t.managedCopyError,
                };

                taskToPersist = updatedTask;
                return updatedTask;
              }),
            }));

            logger.transcriptionInfo("Task archived successfully", {
              taskId,
              mode,
              archivedMediaPath,
              archiveDestPath,
              sourceWasManagedCopy,
            });

            if (taskToPersist) {
              persistTaskSnapshot(taskToPersist);
            }
          } catch (error) {
            logger.error("Archive task failed", {
              taskId,
              mode,
              sourcePath,
              sourceWasManagedCopy,
              archiveDestPath,
              error: String(error),
            });
            throw error;
          }
        },

        addTask: async (path, name, size, options) => {
          logger.uploadInfo("Adding file", { fileName: name, filePath: path });

          const validatedOptions = { ...options };

          if (isModelPendingDeletion(validatedOptions.model)) {
            throw new Error(
              `Model "${validatedOptions.model}" is scheduled for deletion and cannot be used for new transcriptions. Select another model first.`,
            );
          }

          if (validatedOptions.enableDiarization) {
            if (!validatedOptions.diarizationProvider || validatedOptions.diarizationProvider === "none") {
              logger.transcriptionError("Invalid diarization configuration", {
                fileName: name,
                enableDiarization: validatedOptions.enableDiarization,
                diarizationProvider: validatedOptions.diarizationProvider
              });
              throw new Error(
                "Diarization is enabled but no provider is selected. Please install the Sherpa-ONNX diarization model first."
              );
            }
          }

          const id = crypto.randomUUID();
          const task: TranscriptionTask = {
            id,
            fileName: name,
            filePath: path,
            fileSize: size,
            status: "queued",
            progress: 0,
            options: validatedOptions,
            result: null,
            error: null,
            createdAt: new Date(),
            startedAt: null,
            completedAt: null,
          };

          get().upsertTask(task);
          logger.transcriptionInfo("Task added successfully", { taskId: id, fileName: name });

          if (validatedOptions.enableDiarization && validatedOptions.diarizationProvider && validatedOptions.diarizationProvider !== "none") {
            get().updateLastDiarizationProvider(validatedOptions.diarizationProvider);
          }
        },

        retryTask: async (taskId) => {
          const task = get().tasks.find((t) => t.id === taskId);
          if (!task) {
            logger.transcriptionError("Task not found for retry", { taskId });
            return;
          }

          if (isModelPendingDeletion(task.options.model)) {
            logger.transcriptionWarn("Retry blocked: model scheduled for deletion", {
              taskId,
              modelName: task.options.model,
            });
            get().updateTaskStatus(
              taskId,
              "failed",
              undefined,
              `Model "${task.options.model}" is scheduled for deletion and cannot be retried. Select another model.`,
            );
            return;
          }

          logger.transcriptionInfo("Retrying task", { taskId, fileName: task.fileName });
          get().updateTaskStatus(taskId, "queued", undefined, null);
        },

        cancelTask: async (taskId) => {
          logger.transcriptionInfo("Cancelling task", { taskId });
          const { cancelTranscription } = await import("@/services/tauri");
          const result = await cancelTranscription(taskId);
          if (result.success) {
            get().updateTaskStatus(taskId, "cancelled");
            logger.transcriptionInfo("Task cancelled successfully", { taskId });
          } else {
            logger.transcriptionError("Failed to cancel task", { taskId, error: result.error });
          }
        },
      };
    },
    {
      name: "vocrify-tasks",
      version: 2,
      migrate: migratePersistedTasksState,
      merge: (persistedState: unknown, currentState: TasksState): TasksState => {
        const typedPersisted = persistedState as Partial<TasksState> | undefined;

        return {
          ...currentState,
          ...typedPersisted,
          tasks: currentState.tasks,
          options: {
            ...currentState.options,
            ...(typedPersisted?.options ?? {}),
          },
          settings: {
            ...currentState.settings,
            ...(typedPersisted?.settings ?? {}),
          },
          archiveSettings: {
            ...currentState.archiveSettings,
            ...(typedPersisted?.archiveSettings ?? {}),
          },
        };
      },
      partialize: (state) => ({
        options: state.options,
        settings: state.settings,
        archiveSettings: state.archiveSettings,
        view: state.view,
      }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

// ============================================================================
// Derived hooks
// ============================================================================

export function useTasksByView(view: ViewType): TranscriptionTask[] {
  const tasks = useTasks((state) => state.tasks);
  return useMemo(() => filterTasksByView(tasks, view), [tasks, view]);
}

export function useArchivedTasks(): TranscriptionTask[] {
  const tasks = useTasks((state) => state.tasks);
  return useMemo(() => getArchivedTasks(tasks), [tasks]);
}

// ============================================================================
// UI Store
// ============================================================================

interface UIState {
  isDragging: boolean;
  setDragging: (isDragging: boolean) => void;
  isSettingsOpen: boolean;
  setSettingsOpen: (isSettingsOpen: boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  modelsActiveTab: "transcription" | "diarization";
  setModelsActiveTab: (tab: "transcription" | "diarization") => void;
  selectedTaskId: string | null;
  setSelectedTask: (taskId: string | null) => void;
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  displayMode: "clean" | "speakers";
  setDisplayMode: (mode: "clean" | "speakers") => void;
  completedViewModeByTask: Record<string, "balanced" | "transcript-focus">;
  getCompletedViewModeForTask: (taskId: string) => "balanced" | "transcript-focus";
  setCompletedViewModeForTask: (taskId: string, mode: "balanced" | "transcript-focus") => void;
}

const useUIState = create<UIState>((set, get) => ({
  isDragging: false,
  setDragging: (isDragging) => set({ isDragging }),
  isSettingsOpen: false,
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  currentView: "transcription",
  setCurrentView: (view) => set({ currentView: view }),
  modelsActiveTab: "transcription",
  setModelsActiveTab: (tab) => set({ modelsActiveTab: tab }),
  selectedTaskId: null,
  setSelectedTask: (taskId) => set({ selectedTaskId: taskId }),
  isSidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  displayMode: "clean",
  setDisplayMode: (mode) => set({ displayMode: mode }),
  completedViewModeByTask: {},
  getCompletedViewModeForTask: (taskId) => get().completedViewModeByTask[taskId] ?? "balanced",
  setCompletedViewModeForTask: (taskId, mode) => set((state) => ({
    completedViewModeByTask: {
      ...state.completedViewModeByTask,
      [taskId]: mode,
    },
  })),
}));

export const useUIStore = useUIState;

// ============================================================================
// Utility
// ============================================================================

export function getTaskStatusById(taskId: string): TaskStatus | null {
  return useTasks.getState().tasks.find((task) => task.id === taskId)?.status ?? null;
}
