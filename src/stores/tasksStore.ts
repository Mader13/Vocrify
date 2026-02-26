/**
 * Tasks Store - Core Zustand store for transcription tasks.
 *
 * This is a thin re-export from the internal `_store` module.
 * New code should import from the specific store module:
 *   import { useTasks } from "@/stores/tasksStore";
 *   import { useSettings } from "@/stores/settingsStore";
 *   import { useArchivedTasks } from "@/stores/archiveStore";
 */

export {
  useTasks,
  useTasksByView,
  useArchivedTasks,
  useSettingsStore,
  useUIStore,
  getTaskStatusById,
  type ViewType,
  type AppSettings,
} from "./_store";
