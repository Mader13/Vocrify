/**
 * Stores Barrel - re-exports all stores for backward-compatible `@/stores` imports.
 */

// ---------------------------------------------------------------------------
// Core tasks store (tasks CRUD, settings, archive, options, UI state)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Settings store (focused selectors)
// ---------------------------------------------------------------------------
export {
  useSettings,
  useSetting,
  useSettingsActions,
  useArchiveSettings,
  useArchiveSettingsActions,
} from "./settingsStore";

// ---------------------------------------------------------------------------
// Archive store (focused selectors)
// ---------------------------------------------------------------------------
export { useArchivedTasks as useArchivedTasksList, useArchiveActions } from "./archiveStore";

// ---------------------------------------------------------------------------
// Models store
// ---------------------------------------------------------------------------
export { useModelsStore, initializeModelsStore } from "./modelsStore";

// ---------------------------------------------------------------------------
// Setup store
// ---------------------------------------------------------------------------
export { useSetupStore } from "./setupStore";

// ---------------------------------------------------------------------------
// Notification settings store (renamed to fix collision - see Phase 3.5)
// ---------------------------------------------------------------------------
export { useNotificationSettingsStore } from "@/services/notifications";

// Backward-compatible alias - will be removed in a future release
export { useNotificationSettingsStore as useNotificationStore } from "@/services/notifications";

// ---------------------------------------------------------------------------
// Playback store
// ---------------------------------------------------------------------------
export { usePlaybackStore, type MiniPlayerPosition } from "./playbackStore";
