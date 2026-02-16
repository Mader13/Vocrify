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
  ArchiveSettings,
} from "@/types";
import { logger } from "@/lib/logger";

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
  theme: "light" | "dark";
  language: string;
  huggingFaceToken: string | null;
  numSpeakers: number;
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
  archiveTaskWithMode: (taskId: string, mode: ArchiveMode) => Promise<void>;
  unarchiveTask: (taskId: string) => void;
  setHuggingFaceToken: (token: string | null) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  updateLastDiarizationProvider: (provider: DiarizationProvider) => void;
  addTask: (path: string, name: string, size: number, options: TranscriptionOptions) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  setSpeakerSegments: (taskId: string, speakerSegments: TranscriptionSegment[], speakerTurns: SpeakerTurn[]) => void;
}

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
  },
  settings: {
    autoSave: true,
    exportFormat: "txt",
    theme: "light",
    language: "en",
    outputDirectory: "",
    maxConcurrentTasks: 3,
    enableDiarization: false,
    defaultModel: "whisper-base",
    defaultDevice: "auto",
    defaultLanguage: "auto",
    huggingFaceToken: "",
    diarizationProvider: "none",
    numSpeakers: 2,
    lastDiarizationProvider: "none",
    enginePreference: "auto",
  },
  archiveSettings: {
    defaultMode: "delete_video",
    rememberChoice: true,
    showFileSizes: true,
  },
  selectedTaskId: null,
};

function filterTasksByView(tasks: TranscriptionTask[], view: ViewType): TranscriptionTask[] {
  if (view === "models" || view === "settings" || view === "archive") {
    return [];
  }
  // For transcription view, show only non-archived tasks
  return tasks.filter((task) => !task.archived);
}

function getArchivedTasks(tasks: TranscriptionTask[]): TranscriptionTask[] {
  return tasks.filter((task) => task.archived);
}

/**
 * Helper to ensure a task has a result object for streaming
 */
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

export const useTasks = create<TasksState>()(
  persist(
    (set, get) => {
      const validateSettings = (state: TasksState) => {
        if (!state.settings) return;
        const { settings } = state;
        const validEnginePrefs: EnginePreference[] = ["auto", "rust", "python"];
        const validDevices: DeviceType[] = ["auto", "cpu", "cuda", "mps", "vulkan"];

        // Reset invalid enginePreference to default
        if (settings.enginePreference && !validEnginePrefs.includes(settings.enginePreference)) {
          logger.warn("Invalid enginePreference in localStorage, resetting to default", {
            invalid: settings.enginePreference
          });
          set((state) => ({
            settings: { ...state.settings, enginePreference: "auto" }
          }));
        }

        // Reset invalid defaultDevice to default
        if (settings.defaultDevice && !validDevices.includes(settings.defaultDevice)) {
          logger.warn("Invalid defaultDevice in localStorage, resetting to default", {
            invalid: settings.defaultDevice
          });
          set((state) => ({
            settings: { ...state.settings, defaultDevice: "auto" }
          }));
        }
      };

      // Run validation after rehydration
      const state = get();
      if (state?.settings) {
        validateSettings(state);
      }

      // Load HuggingFace token from backend on store creation
      (async () => {
        try {
          const { getHuggingFaceToken } = await import("@/services/tauri");
          const result = await getHuggingFaceToken();
          if (result.success && result.data) {
            logger.info("Loaded HuggingFace token from backend");
            set((state) => ({
              settings: { ...state.settings, huggingFaceToken: result.data ?? null }
            }));
          }
        } catch (error) {
          logger.error("Failed to load HuggingFace token from backend", { error: String(error) });
        }
      })();

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
            task.id === taskId ? { ...task, progress, ...(stage && { stage }), ...(metrics && { metrics }) } : task,
          ),
        }));
      },

      updateTaskStatus: (taskId, status, result, error) => {
        logger.transcriptionInfo("Status update", { taskId, status, error });
        set((state) => {
          const tasks = state.tasks.map((task) => {
            if (task.id !== taskId) return task;
            const updatedTask: TranscriptionTask = {
              ...task,
              status,
              progress: status === "completed" ? 100 : task.progress,
              ...(result && { result }),
              ...(error !== undefined && { error }),
              ...(status === "processing" && !task.startedAt && { startedAt: new Date() }),
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

            return {
              ...taskWithResult,
              result: {
                ...taskWithResult.result!,
                segments: newSegments,
                duration: Math.max(taskWithResult.result!.duration || 0, segment.end),
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

      setHuggingFaceToken: async (token) => {
        logger.info("HuggingFace token updated");
        set((state) => ({ settings: { ...state.settings, huggingFaceToken: token } }));

        // Also save to Rust backend for use during transcription
        try {
          const { saveHuggingFaceToken } = await import("@/services/tauri");
          if (token) {
            await saveHuggingFaceToken(token);
            logger.info("HuggingFace token saved to backend");
          }
        } catch (error) {
          logger.error("Failed to save HuggingFace token to backend", { error: String(error) });
        }
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

      removeTask: (taskId) => {
        logger.info("Task removed", { taskId });
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }));
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

      archiveTaskWithMode: async (taskId, mode) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) {
          logger.error("Archive task not found", { taskId });
          return;
        }

        const { convertToMp3, getArchiveDir, getFileSize } = await import("@/services/tauri");

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
              // Copy original file to archive (keep as is - video stays video)
              if (task.filePath && archiveDirResult.success) {
                const ext = task.filePath.split(".").pop()?.toLowerCase();
                
                // For video files, we keep as-is (original file stays accessible)
                // For audio files, we can reference them directly
                const isAudioFile = ext && ["mp3", "wav", "m4a", "flac", "ogg"].includes(ext);
                if (isAudioFile) {
                  audioPath = task.filePath;
                  logger.transcriptionInfo("keep_all: using existing audio file", { taskId, audioPath });
                } else {
                  // For video - original file stays at original path
                  logger.transcriptionInfo("keep_all: keeping original video file", { taskId, originalPath: task.filePath });
                }
              }
              archiveSize = task.fileSize;
              break;
            }

            case "delete_video": {
              // Convert to MP3 and save to archive
              if (task.filePath && archiveDirResult.success) {
                const ext = task.filePath.split(".").pop()?.toLowerCase();
                const isAudioFile = ext && ["mp3", "wav", "m4a", "flac", "ogg"].includes(ext);
                
                if (isAudioFile) {
                  // Already audio - convert to ensure it's MP3
                  const mp3Path = `${archiveDirResult.data}/${task.id}.mp3`;
                  const convertResult = await convertToMp3(task.filePath, mp3Path);
                  if (convertResult.success && convertResult.data) {
                    audioPath = convertResult.data;
                    logger.transcriptionInfo("delete_video: copied audio to archive", { taskId, audioPath });
                    archiveSize = await readArchiveSize(convertResult.data);
                  }
                } else {
                  // Convert video to MP3
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
              // text_only - don't need to copy any files
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
                    audioPath: audioPath,
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

        // Validate diarization configuration
        const validatedOptions = { ...options };

        if (validatedOptions.enableDiarization) {
          // If diarization is enabled but provider is "none" or invalid, we need to handle it
          if (!validatedOptions.diarizationProvider || validatedOptions.diarizationProvider === "none") {
            logger.transcriptionError("Invalid diarization configuration", {
              fileName: name,
              enableDiarization: validatedOptions.enableDiarization,
              diarizationProvider: validatedOptions.diarizationProvider
            });
            throw new Error(
              "Diarization is enabled but no provider is selected. Please install a diarization model (pyannote or sherpa-onnx) first."
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

        // If diarization is enabled, update last used provider
        if (validatedOptions.enableDiarization && validatedOptions.diarizationProvider && validatedOptions.diarizationProvider !== "none") {
          get().updateLastDiarizationProvider(validatedOptions.diarizationProvider);
        }
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

export function useTasksByView(view: ViewType): TranscriptionTask[] {
  const tasks = useTasks((state) => state.tasks);
  return useMemo(() => filterTasksByView(tasks, view), [tasks, view]);
}

export function useArchivedTasks(): TranscriptionTask[] {
  const tasks = useTasks((state) => state.tasks);
  return useMemo(() => getArchivedTasks(tasks), [tasks]);
}

export const useSettingsStore = useTasks;

interface UIState {
  isDragging: boolean;
  setDragging: (isDragging: boolean) => void;
  isSettingsOpen: boolean;
  setSettingsOpen: (isSettingsOpen: boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  selectedTaskId: string | null;
  setSelectedTask: (taskId: string | null) => void;
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  displayMode: "segments" | "speakers";
  setDisplayMode: (mode: "segments" | "speakers") => void;
}

const useUIState = create<UIState>((set) => ({
  isDragging: false,
  setDragging: (isDragging) => set({ isDragging }),
  isSettingsOpen: false,
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  currentView: "transcription",
  setCurrentView: (view) => set({ currentView: view }),
  selectedTaskId: null,
  setSelectedTask: (taskId) => set({ selectedTaskId: taskId }),
  isSidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  displayMode: "segments",
  setDisplayMode: (mode) => set({ displayMode: mode }),
}));

export const useUIStore = useUIState;

// Re-export models store
export { useModelsStore, initializeModelsStore } from "./modelsStore";

// Re-export setup store
export { useSetupStore } from "./setupStore";

// Re-export notification store
export { useNotificationStore } from "@/services/notifications";
