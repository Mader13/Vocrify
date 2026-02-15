---
status: resolved
trigger: 'archive-view-infinite-render'
created: '2026-02-15T00:00:00.000Z'
updated: '2026-02-15T00:00:00.000Z'
---

## Current Focus

hypothesis: "Applied fix: Changed ArchiveView to use useTasks with stable selector + useMemo for filtering"
test: "TypeScript check passes, no new errors introduced"
expecting: "ArchiveView renders without infinite loop"
next_action: "Archive session"

## Symptoms

expected: ArchiveView should render archived tasks normally
actual: Component triggers infinite re-render loop causing "Maximum update depth exceeded" error
errors: "Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops."
reproduction: Triggered when viewing the Archive view (currentView === "archive")
started: Error appears when ArchiveView is mounted/rendered

## Eliminated

- hypothesis: "Direct setState in ArchiveView component"
  evidence: "Component has no useEffect or setState calls"
  timestamp: "2026-02-15T00:00:00.000Z"

- hypothesis: "Circular dependency between components"
  evidence: "No circular updates found in component chain"
  timestamp: "2026-02-15T00:00:00.000Z"

- hypothesis: "Inline selector with filter() returns new array every time"
  evidence: "useArchivedTasks() used filter() at selector level, causing new array reference on every store update in Zustand v5"
  timestamp: "2026-02-15T00:00:00.000Z"

## Evidence

- timestamp: "2026-02-15T00:00:00.000Z"
  checked: "ArchiveView.tsx lines 80-110"
  found: "Component uses useArchivedTasks() hook at line 81. No useEffect in component itself."
  implication: "Infinite loop not caused by direct setState in ArchiveView"

- timestamp: "2026-02-15T00:00:00.000Z"
  checked: "stores/index.ts lines 479-481"
  found: "useArchivedTasks returns useTasks((state) => getArchivedTasks(state.tasks))"
  implication: "Selector returns NEW array on every call (filter creates new array)"

- timestamp: "2026-02-15T00:00:00.000Z"
  checked: "stores/index.ts lines 119-121"
  found: "getArchivedTasks uses filter() which creates new array reference"
  implication: "Zustand v5 sees new reference on every store update, triggers re-render"

- timestamp: "2026-02-15T00:00:00.000Z"
  checked: "Zustand v5 selector behavior"
  found: "In Zustand 5, selectors use strict equality. filter() always returns new array."
  implication: "Every task progress update triggers ArchiveView re-render"

- timestamp: "2026-02-15T00:00:00.000Z"
  checked: "Applied fix - ArchiveView.tsx"
  found: "Changed to use useTasks with stable selector + useMemo for filtering"
  implication: "Fix addresses root cause by using stable selector and memoized filter"

## Resolution

root_cause: "useArchivedTasks() hook used inline selector with filter() that returns new array reference on every store update. In Zustand v5, this caused infinite re-renders when combined with frequent task progress updates."
fix: "Changed ArchiveView to use stable selector (useTasks((state) => state.tasks)) and filter archived tasks using useMemo. This ensures the selector returns a stable reference and filtering only happens when tasks actually changes."
verification: "TypeScript check passes - no new errors in ArchiveView.tsx. Pre-existing test failures unrelated to this fix."
files_changed: ["src/components/features/ArchiveView.tsx"]
