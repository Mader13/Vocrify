/**
 * Settings Store - Provides typed selectors for app and archive settings.
 *
 * Settings live in the unified `useTasks` persist store so that they are
 * serialized together with tasks (single localStorage key).  This module
 * re-exports narrowed hooks that only subscribe to settings slices, keeping
 * consumer components decoupled from the monolithic store.
 */

import { useTasks } from "./_store";
import type { AppSettings } from "./_store";
import type { ArchiveSettings } from "@/types";

// ---------------------------------------------------------------------------
// Re-export the core type so consumers don't need to reach into tasksStore
// ---------------------------------------------------------------------------
export type { AppSettings };

// ---------------------------------------------------------------------------
// Settings selectors (subscribe only to the settings slice)
// ---------------------------------------------------------------------------

/** Full settings object */
export function useSettings() {
  return useTasks((s) => s.settings);
}

/** Single setting value by key */
export function useSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return useTasks((s) => s.settings[key]);
}

/** Settings mutation helpers */
export function useSettingsActions() {
  const setSettings = useTasks((s) => s.setSettings);
  const updateSettings = useTasks((s) => s.updateSettings);
  const resetSettings = useTasks((s) => s.resetSettings);
  const updateLastDiarizationProvider = useTasks((s) => s.updateLastDiarizationProvider);
  return { setSettings, updateSettings, resetSettings, updateLastDiarizationProvider };
}

// ---------------------------------------------------------------------------
// Archive settings selectors
// ---------------------------------------------------------------------------

export function useArchiveSettings(): ArchiveSettings {
  return useTasks((s) => s.archiveSettings);
}

export function useArchiveSettingsActions() {
  const setArchiveSettings = useTasks((s) => s.setArchiveSettings);
  return { setArchiveSettings };
}

// ---------------------------------------------------------------------------
// Backward-compatible alias: useSettingsStore === useTasks
// Consumers that call `useSettingsStore.getState().tasks` (modelsStore) still
// work because the alias points at the full store.
// ---------------------------------------------------------------------------
export const useSettingsStore = useTasks;
