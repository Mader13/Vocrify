import { create } from "zustand";
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
} from "@/types";
import { logger } from "@/lib/logger";

export type ViewType = "transcription" | "models" | "settings";

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
  resetSettings: () => void;
  deleteTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  setHuggingFaceToken: (token: string | null) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  updateLastDiarizationProvider: (provider: DiarizationProvider) => void;
  addTask: (path: string, name: string, size: number, options: TranscriptionOptions) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  setSpeakerSegments: (taskId: string, speakerSegments: TranscriptionSegment[], speakerTurns: SpeakerTurn[]) => void;
}

const initialState: Pick<TasksState, "tasks" | "view" | "options" | "settings" | "selectedTaskId"> = {
  tasks: [],
  view: "transcription",
  options: {
    model: "whisper-base",
    device: "cpu",
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
    defaultDevice: "cpu",
    defaultLanguage: "auto",
    huggingFaceToken: "",
    diarizationProvider: "none",
    numSpeakers: 2,
    lastDiarizationProvider: "none",
    enginePreference: "auto",
  },
  selectedTaskId: null,
};

function filterTasksByView(tasks: TranscriptionTask[], view: ViewType): TranscriptionTask[] {
  if (view === "models" || view === "settings") {
    return [];
  }
  return tasks;
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
      partialize: (state) => ({
        tasks: state.tasks,
        options: state.options,
        settings: state.settings,
        view: state.view,
      }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function useTasksByView(view: ViewType): TranscriptionTask[] {
  return useTasks((state) => filterTasksByView(state.tasks, view));
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
