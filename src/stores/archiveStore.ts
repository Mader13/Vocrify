/**
 * Archive Store - Provides typed selectors and helpers for archived tasks.
 *
 * The underlying data lives in the unified `useTasks` persist store.
 * This module re-exports narrowed hooks so archive-related components
 * only subscribe to the slices they need.
 */

import { useMemo } from "react";
import { useTasks } from "./_store";
import type { TranscriptionTask } from "@/types";

// ---------------------------------------------------------------------------
// Archived tasks selector
// ---------------------------------------------------------------------------

export function useArchivedTasks(): TranscriptionTask[] {
  const tasks = useTasks((s) => s.tasks);
  return useMemo(() => tasks.filter((t) => t.archived), [tasks]);
}

// ---------------------------------------------------------------------------
// Archive actions
// ---------------------------------------------------------------------------

export function useArchiveActions() {
  const archiveTask = useTasks((s) => s.archiveTask);
  const unarchiveTask = useTasks((s) => s.unarchiveTask);
  const archiveTaskWithMode = useTasks((s) => s.archiveTaskWithMode);
  const removeTask = useTasks((s) => s.removeTask);
  return { archiveTask, unarchiveTask, archiveTaskWithMode, removeTask };
}

// ---------------------------------------------------------------------------
// Archive settings (delegated to settingsStore for single source of truth)
// ---------------------------------------------------------------------------

export { useArchiveSettings, useArchiveSettingsActions } from "./settingsStore";
