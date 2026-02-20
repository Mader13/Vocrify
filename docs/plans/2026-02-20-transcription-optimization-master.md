# Transcription Pipeline Optimization Program Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Построить безопасный трехфазный путь улучшения транскрипции: сначала убрать риски зависаний/некорректных статусов, затем ускорить пайплайн, и только после этого провести крупный рефакторинг.

**Architecture:** Программа разделена на фазы с жесткими quality gates между ними. Фаза 1 фиксирует контракт событий и очередь задач (корректность), Фаза 2 оптимизирует hot path без изменения внешнего контракта, Фаза 3 вычищает legacy и модульно упрощает архитектуру. Каждая следующая фаза стартует только после прохождения тестов и gate-критериев предыдущей.

**Tech Stack:** Tauri (Rust), React 19 + TypeScript, Zustand, Vitest, Cargo test.

---

## Priority Decision

1. **Phase 1 - Stability (highest priority):** исправляет ошибки завершения задач, fairness очереди, рассинхрон IPC и восстановление статусов после рестарта.
2. **Phase 2 - Performance:** ускоряет уже стабильный путь (model lifecycle, память, I/O, прогресс/heartbeat).
3. **Phase 3 - Refactor:** снижает технический долг и убирает legacy только после стабилизации и измеримого ускорения.

## Subplans

- `docs/plans/2026-02-20-transcription-phase-1-stability.md`
- `docs/plans/2026-02-20-transcription-phase-2-performance.md`
- `docs/plans/2026-02-20-transcription-phase-3-refactor.md`

### Task 1: Freeze Baseline and Gates

**Files:**
- Create: `docs/plans/2026-02-20-transcription-optimization-master.md`
- Modify: `docs/plans/2026-02-20-transcription-phase-1-stability.md`
- Modify: `docs/plans/2026-02-20-transcription-phase-2-performance.md`
- Modify: `docs/plans/2026-02-20-transcription-phase-3-refactor.md`

**Step 1: Зафиксировать baseline метрики до изменений**

Run: `bunx tsc --noEmit && bun run test src/stores/utils/task-recovery.test.ts`
Expected: текущий baseline сохранен (включая известные падения для Phase 1).

**Step 2: Утвердить gate для завершения Phase 1**

Run: `bun run test && bun run lint`
Expected: все критичные regressions по completion/queue/recovery закрыты.

**Step 3: Утвердить gate для завершения Phase 2**

Run: `bun run test && bunx tsc --noEmit`
Expected: стабильность сохранена, метрики ускорения документированы.

**Step 4: Утвердить gate для завершения Phase 3**

Run: `bun run test && bun run lint && bun run build`
Expected: нет архитектурных regressions, сборка green.

**Step 5: Commit**

```bash
git add docs/plans/2026-02-20-transcription-optimization-master.md docs/plans/2026-02-20-transcription-phase-1-stability.md docs/plans/2026-02-20-transcription-phase-2-performance.md docs/plans/2026-02-20-transcription-phase-3-refactor.md
git commit -m "docs: add three-phase transcription optimization program"
```
