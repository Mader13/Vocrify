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
import type {
  TranscriptionTask,
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionSegment,
  TaskStatus,
  ProgressStage,
  ProgressMetrics,
  SpeakerTurn,
  AIModel,
  DeviceType,
  Language,
  DiarizationProvider,
  EnginePreference,
  ArchiveMode,
  ArchiveCompression,
  ArchiveSettings,
  AudioProfile,
  AppLocale,
} from "@/types";
import { logger } from "@/lib/logger";
import { recoverInterruptedTasks } from "@/stores/utils/task-recovery";
import { canArchiveTask } from "@/stores/utils/archive-eligibility";
import { isModelPendingDeletion } from "@/stores/utils/model-deletion";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/i18n";

// ============================================================================
// Types
// ============================================================================

export type ViewType = "transcription" | "models" | "settings" | "archive";

/**
 * UI-specific AppSettings extending base types with additional fields
 */
export interface AppSettings {
  // Core settings (typed properly)
  defaultModel: AIModel;
  defaultDevice: DeviceType;
  defaultLanguage: Language;
  enableDiarization: boolean;
  diarizationProvider: DiarizationProvider;
  maxConcurrentTasks: number;
  outputDirectory: string;
  lastDiarizationProvider: DiarizationProvider;
  enginePreference: EnginePreference;

  // UI-specific fields
  autoSave: boolean;
  exportFormat: string;
  theme: "light" | "dark" | "system";
  language: AppLocale;
  numSpeakers: number;
  audioProfile: AudioProfile;
}

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
    autoSave: true,
    exportFormat: "txt",
    theme: "system",
    language: "en",
    outputDirectory: "",
    maxConcurrentTasks: 3,
    enableDiarization: false,
    defaultModel: "whisper-base",
    defaultDevice: "auto",
    defaultLanguage: "auto",
    diarizationProvider: "none",
    numSpeakers: 2,
    lastDiarizationProvider: "none",
    enginePreference: "auto",
    audioProfile: "standard",
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

// ============================================================================
// Tasks Store
// ============================================================================

export const useTasks = create<TasksState>()(
  persist(
    (set, get) => {
      const validateSettings = (state: TasksState) => {
        if (!state.settings) return;
        const { settings } = state;
        const validEnginePrefs: EnginePreference[] = ["auto", "rust", "python"];
        const validDevices: DeviceType[] = ["auto", "cpu", "cuda", "mps", "vulkan"];

        if (settings.enginePreference && !validEnginePrefs.includes(settings.enginePreference)) {
          logger.warn("Invalid enginePreference in localStorage, resetting to default", {
            invalid: settings.enginePreference
          });
          set((state) => ({
            settings: { ...state.settings, enginePreference: "auto" }
          }));
        }

        if (settings.defaultDevice && !validDevices.includes(settings.defaultDevice)) {
          logger.warn("Invalid defaultDevice in localStorage, resetting to default", {
            invalid: settings.defaultDevice
          });
          set((state) => ({
            settings: { ...state.settings, defaultDevice: "auto" }
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
              return updatedTask;
            });
            return { tasks };
          });
        },

        setSpeakerSegments: (taskId, speakerSegments, speakerTurns) => {
          logger.transcriptionInfo("Speaker segments set", { taskId, count: speakerSegments.length });
          set((state) => ({
            tasks: state.tasks.map((task) => {
              if (task.id !== taskId) return task;
              if (!task.result) return task;
              return {
                ...task,
                result: {
                  ...task.result,
                  speakerSegments,
                  speakerTurns,
                },
              };
            }),
          }));
        },

        updateSpeakerNameMap: (taskId, speakerNameMap) => {
          logger.transcriptionInfo("Speaker name map updated", {
            taskId,
            mappedSpeakers: Object.keys(speakerNameMap).length,
          });
          set((state) => ({
            tasks: state.tasks.map((task) => (
              task.id === taskId
                ? { ...task, speakerNameMap }
                : task
            )),
          }));
        },

        updateTaskFileName: (taskId, fileName) => {
          logger.transcriptionInfo("Task filename updated", { taskId, fileName });
          set((state) => ({
            tasks: state.tasks.map((task) => (
              task.id === taskId
                ? { ...task, fileName }
                : task
            )),
          }));
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
          set((state) => {
            const tasks = state.tasks.map((task) => {
              if (task.id !== taskId) {
                return task;
              }
              return {
                ...task,
                result: {
                  segments,
                  language,
                  duration,
                },
              };
            });
            return { tasks };
          });
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
          set(() => ({ settings: initialState.settings }));
        },

        removeTask: async (taskId) => {
          const task = get().tasks.find((t) => t.id === taskId);

          let fileToDelete: string | undefined;

          if (task?.archiveMode === "keep_all") {
            fileToDelete = task.filePath;
          } else if (task?.archiveMode === "delete_video") {
            fileToDelete = task.audioPath;
          }

          logger.info("Task removed", { taskId });
          set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }));

          if (fileToDelete) {
            try {
              const { deleteFile } = await import("@/services/tauri");
              const result = await deleteFile(fileToDelete);
              if (result.success) {
                logger.transcriptionInfo("Archived file deleted", { taskId, filePath: fileToDelete });
              } else {
                logger.warn("Failed to delete archived file", { taskId, filePath: fileToDelete, error: result.error });
              }
            } catch (error) {
              logger.error("Error deleting archived file", { taskId, error: String(error) });
            }
          }
        },

        deleteTask: (taskId) => {
          logger.transcriptionInfo("Task deleted", { taskId });
          get().removeTask(taskId);
        },

        archiveTask: (taskId) => {
          logger.transcriptionInfo("Task archived", { taskId });
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId ? { ...task, archived: true } : task
            ),
          }));
        },

        unarchiveTask: (taskId) => {
          logger.transcriptionInfo("Task unarchived", { taskId });
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId ? { ...task, archived: false } : task
            ),
          }));
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

          const { convertToMp3, getArchiveDir, getFileSize, copyFile, compressMedia } = await import("@/services/tauri");

          logger.transcriptionInfo("Task archiving with mode", { taskId, mode, fileName: task.fileName });

          let audioPath: string | undefined;
          let archiveSize: number | undefined;

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
            if (!archiveDirResult.success || !archiveDirResult.data) {
              logger.warn("Failed to get archive directory", { taskId, error: archiveDirResult.error });
            }

            switch (mode) {
              case "keep_all": {
                if (task.filePath && archiveDirResult.success) {
                  const ext = task.filePath.split(".").pop()?.toLowerCase() || "";
                  const compression = compressionOverride ?? get().archiveSettings.compression;
                  const destPath = `${archiveDirResult.data}/${task.id}.${ext}`;

                  if (compression === "none") {
                    const copyResult = await copyFile(task.filePath, destPath);
                    if (copyResult.success && copyResult.data) {
                      audioPath = copyResult.data;
                      logger.transcriptionInfo("keep_all: copied original file to archive", { taskId, audioPath, ext, compression });
                      archiveSize = await readArchiveSize(copyResult.data);
                    } else {
                      logger.warn("keep_all: copy failed", { taskId, error: copyResult.error });
                    }
                  } else {
                    const compressResult = await compressMedia(task.filePath, destPath, compression);
                    if (compressResult.success && compressResult.data) {
                      audioPath = compressResult.data;
                      logger.transcriptionInfo("keep_all: compressed file to archive", { taskId, audioPath, ext, compression });
                      archiveSize = await readArchiveSize(compressResult.data);
                    } else {
                      logger.warn("keep_all: compression failed", { taskId, error: compressResult.error });
                    }
                  }
                }
                break;
              }

              case "delete_video": {
                if (task.filePath && archiveDirResult.success) {
                  const ext = task.filePath.split(".").pop()?.toLowerCase();
                  const isAudioFile = ext && ["mp3", "wav", "m4a", "flac", "ogg"].includes(ext);

                  if (isAudioFile) {
                    const mp3Path = `${archiveDirResult.data}/${task.id}.mp3`;
                    const convertResult = await convertToMp3(task.filePath, mp3Path);
                    if (convertResult.success && convertResult.data) {
                      audioPath = convertResult.data;
                      logger.transcriptionInfo("delete_video: copied audio to archive", { taskId, audioPath });
                      archiveSize = await readArchiveSize(convertResult.data);
                    }
                  } else {
                    const mp3Path = `${archiveDirResult.data}/${task.id}.mp3`;
                    const convertResult = await convertToMp3(task.filePath, mp3Path);
                    if (convertResult.success && convertResult.data) {
                      audioPath = convertResult.data;
                      logger.transcriptionInfo("delete_video: converted to MP3", { taskId, audioPath });
                      archiveSize = await readArchiveSize(convertResult.data);
                    } else {
                      logger.warn("delete_video: conversion failed", { taskId, error: convertResult.error });
                    }
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

            set((state) => ({
              tasks: state.tasks.map((t) =>
                t.id === taskId
                  ? {
                      ...t,
                      archived: true,
                      archivedAt: new Date(),
                      archiveMode: mode,
                      filePath: mode === "keep_all" && audioPath ? audioPath : undefined,
                      audioPath: mode === "delete_video" ? audioPath : undefined,
                      archiveSize: archiveSize ?? task.fileSize,
                    }
                  : t
              ),
            }));

            logger.transcriptionInfo("Task archived successfully", { taskId, mode });
          } catch (error) {
            logger.error("Archive task failed", { taskId, error: String(error) });
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
      version: 1,
      migrate: (persistedState: unknown, _version: number) => {
        return persistedState as TasksState;
      },
      merge: (persistedState: unknown, currentState: TasksState): TasksState => {
        const typedPersisted = persistedState as Partial<TasksState> | undefined;
        const persistedTasks = Array.isArray(typedPersisted?.tasks) ? typedPersisted.tasks : [];

        const { tasks: recoveredTasks, recoveredCount, hasActiveProcessing } = recoverInterruptedTasks(persistedTasks);

        if (recoveredCount > 0) {
          if (hasActiveProcessing) {
            logger.transcriptionInfo("Found processing tasks after app restart - will sync with backend", {
              recoveredCount,
            });
          } else {
            logger.transcriptionWarn("Recovered interrupted transcription tasks after app restart", {
              recoveredCount,
            });
          }
        }

        return {
          ...currentState,
          ...typedPersisted,
          tasks: recoveredTasks,
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
        tasks: state.tasks,
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

/** @deprecated Use `useTasks` directly - this alias exists for backward compat */
export const useSettingsStore = useTasks;

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
