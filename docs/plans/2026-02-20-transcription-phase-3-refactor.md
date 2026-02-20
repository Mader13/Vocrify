# Transcription Architecture Refactor Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Снизить технический долг и упростить поддержку транскрипционного стека через модульный рефакторинг после стабилизации и ускорения.

**Architecture:** В этой фазе мы не оптимизируем метрики, а упрощаем структуру кода: выносим крупные блоки из `lib.rs`, убираем legacy-маршруты/экспорты, нормализуем service boundaries и синхронизируем архитектурную документацию. Рефакторинг выполняется итеративно с compile-safe шагами.

**Tech Stack:** Rust modules, TypeScript service layer, Tauri commands, docs in `AGENTS.md` and `.claude/claude.md`.

---

### Task 1: Split `lib.rs` into Focused Modules

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/task_queue.rs`
- Create: `src-tauri/src/python_ipc.rs`
- Create: `src-tauri/src/transcription_orchestrator.rs`

**Step 1: Write the failing test**

Добавить/обновить compile-oriented tests, которые проверяют публичные команды и их сигнатуры после модульного разделения.

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL на этапе неразрешенных импортов после первого extraction шага.

**Step 3: Write minimal implementation**

Пошагово переносить логику в новые модули, оставляя `lib.rs` как thin composition root.

**Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/task_queue.rs src-tauri/src/python_ipc.rs src-tauri/src/transcription_orchestrator.rs
git commit -m "refactor: extract queue and ipc orchestration modules from lib.rs"
```

### Task 2: Remove Legacy Engine Surface Safely

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src/services/transcription.ts`
- Create: `src/services/transcription-legacy-compat.test.ts`

**Step 1: Write the failing test**

Тест: активный путь использует только transcribe-rs + diarization bridge, legacy surface не влияет на runtime.

**Step 2: Run test to verify it fails**

Run: `bun run test src/services/transcription-legacy-compat.test.ts`
Expected: FAIL при наличии legacy-dependent веток.

**Step 3: Write minimal implementation**

Постепенно убрать/скрыть неиспользуемые re-export и legacy routing hooks, не ломая invoke handler.

**Step 4: Run test to verify it passes**

Run: `bun run test src/services/transcription-legacy-compat.test.ts && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/Cargo.toml src/services/transcription.ts src/services/transcription-legacy-compat.test.ts
git commit -m "refactor: retire legacy engine surface and keep transcribe-rs primary path"
```

### Task 3: Normalize Frontend Service Boundaries

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/services/transcription.ts`
- Modify: `src/services/tauri/events.ts`
- Modify: `src/stores/index.ts`

**Step 1: Write the failing test**

Тест: компонентный слой не управляет transport-level деталями, а работает через единый service API.

**Step 2: Run test to verify it fails**

Run: `bun run test src/App.transcription-boundary.test.tsx`
Expected: FAIL (часть orchestration остается в App/store).

**Step 3: Write minimal implementation**

Сместить orchestration логики в service layer, оставить App как UI-shell.

**Step 4: Run test to verify it passes**

Run: `bun run test src/App.transcription-boundary.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/services/transcription.ts src/services/tauri/events.ts src/stores/index.ts src/App.transcription-boundary.test.tsx
git commit -m "refactor: move transcription orchestration from app layer to service boundary"
```

### Task 4: Clean Dead Store Action Utilities

**Files:**
- Modify: `src/stores/actions/task-actions.ts`
- Modify: `src/stores/actions/settings-actions.ts`
- Modify: `src/stores/actions/archive-actions.ts`
- Modify: `src/stores/index.ts`
- Create: `src/stores/store-actions-contract.test.ts`

**Step 1: Write the failing test**

Тест: store actions имеют один источник истины, без неиспользуемых дубликатов.

**Step 2: Run test to verify it fails**

Run: `bun run test src/stores/store-actions-contract.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Либо интегрировать pure actions в store pipeline, либо удалить неиспользуемые файлы с обновлением импортов.

**Step 4: Run test to verify it passes**

Run: `bun run test src/stores/store-actions-contract.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/stores/actions/task-actions.ts src/stores/actions/settings-actions.ts src/stores/actions/archive-actions.ts src/stores/index.ts src/stores/store-actions-contract.test.ts
git commit -m "refactor: consolidate store actions and remove dead duplicate helpers"
```

### Task 5: Synchronize Architecture Docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/CLAUDE.md`
- Modify: `docs/plans/2026-02-20-transcription-phase-3-refactor.md`

**Step 1: Write the failing check**

Подготовить checklist синхронизации: архитектура, маршрутизация движков, gotchas, команды.

Checklist:

- [x] Обновить backend module map (extractions из `lib.rs`)
- [x] Синхронизировать service boundary для transport событий
- [x] Отразить удаление legacy `rust-whisper` feature
- [x] Зафиксировать single source of truth для store actions

**Step 2: Run check to verify mismatch exists**

Run: `bunx tsc --noEmit`
Expected: PASS (техническая проверка), затем manual diff docs показывает рассинхрон до обновления.

**Step 3: Write minimal implementation**

Обновить оба документа синхронно, сохранить единый source-of-truth по Phase 3.

**Step 4: Run check to verify consistency**

Run: `git diff -- AGENTS.md .claude/claude.md`
Expected: отражены одинаковые архитектурные изменения.

**Step 5: Commit**

```bash
git add AGENTS.md .claude/claude.md docs/plans/2026-02-20-transcription-phase-3-refactor.md
git commit -m "docs: synchronize architecture updates across agent documentation"
```

### Task 6: Phase 3 Verification Gate

**Files:**
- Modify: `docs/plans/2026-02-20-transcription-phase-3-refactor.md`

**Step 1: Run full frontend checks**

Run: `bunx tsc --noEmit && bun run test && bun run lint && bun run build`
Expected: PASS.

**Step 2: Run full backend checks**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

**Step 3: Smoke run**

Run: `bun run tauri:dev`
Expected: базовые user workflows транскрипции и диаризации без регрессий.

**Step 4: Handoff notes**

Зафиксировать, какие legacy элементы окончательно удалены и какие API стабилизированы.

Handoff notes:

- Legacy removed: deprecated Cargo feature `rust-whisper`; legacy Whisper re-export from `src-tauri/src/lib.rs`; duplicate pure store action helpers under `src/stores/actions/`.
- Rust backend boundaries stabilized: `task_queue.rs`, `python_ipc.rs`, and `transcription_orchestrator.rs` extracted from `lib.rs` as focused modules.
- Frontend service boundary stabilized: App-level transport wiring moved behind `subscribeToTranscriptionRuntime` and `subscribeToTranscriptionTransportEvents`.
- Verification status: TypeScript, tests, lint, build, and Cargo tests are green.
- Smoke-run note: `bun run tauri:dev` currently fails if port `5173` is occupied by another Vite instance; free the port and rerun smoke validation.

**Step 5: Commit**

```bash
git add docs/plans/2026-02-20-transcription-phase-3-refactor.md
git commit -m "docs: close phase 3 verification gate"
```
