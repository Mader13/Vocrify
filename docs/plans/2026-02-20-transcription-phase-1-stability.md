# Transcription Stability Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Устранить ошибки корректности в пайплайне транскрипции (completion, queue fairness, recovery, IPC schema), чтобы задачи не зависали и всегда переходили в финальный статус.

**Architecture:** В этой фазе запрещены любые крупные архитектурные изменения. Мы чинем только контракт между frontend <-> Tauri <-> Python/Rust, добавляем недостающие тесты и фиксируем поведение очереди. Все изменения локальны и обратимо-тестируемы.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri Rust, Vitest, Cargo test.

---

### Task 1: Align Recovery Semantics After App Restart

**Files:**
- Modify: `src/stores/utils/task-recovery.ts`
- Modify: `src/stores/utils/task-recovery.test.ts`
- Modify: `src/types/transcription.ts`

**Step 1: Write the failing test**

Подтвердить ожидаемое поведение: задача, которая была `processing` во время закрытия приложения, должна стать `interrupted` с `completedAt`.

**Step 2: Run test to verify it fails**

Run: `bun run test src/stores/utils/task-recovery.test.ts`
Expected: FAIL (текущая реализация возвращает `processing`).

**Step 3: Write minimal implementation**

Обновить `recoverInterruptedTasks` так, чтобы он выставлял `status: "interrupted"`, заполнял `completedAt`, и задавал user-friendly error.

**Step 4: Run test to verify it passes**

Run: `bun run test src/stores/utils/task-recovery.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/stores/utils/task-recovery.ts src/stores/utils/task-recovery.test.ts src/types/transcription.ts
git commit -m "fix: mark interrupted processing tasks correctly after restart"
```

### Task 2: Fix Completion Contract for Python Path

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/services/transcription.ts`
- Create: `src/services/transcription.contract.test.ts`

**Step 1: Write the failing test**

Добавить тест, который проверяет, что Python path приводит к `updateTaskStatus(taskId, "completed", result)` после `transcription-complete`.

**Step 2: Run test to verify it fails**

Run: `bun run test src/services/transcription.contract.test.ts`
Expected: FAIL (сейчас Python completion может не завершать задачу в UI).

**Step 3: Write minimal implementation**

Подписать `App` на `onTranscriptionComplete` и унифицировать завершение задачи для обоих путей (Rust/Python), убрать дублирующий completion-channel.

**Step 4: Run test to verify it passes**

Run: `bun run test src/services/transcription.contract.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/services/transcription.ts src/services/transcription.contract.test.ts
git commit -m "fix: unify transcription completion handling across rust and python paths"
```

### Task 3: Make Queue Fair (FIFO) and Guarantee Next Task Scheduling

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/lib_queue_tests.rs`

**Step 1: Write the failing test**

Добавить тесты на порядок очереди (FIFO) и обязательный запуск следующей задачи после завершения текущей.

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml queue`
Expected: FAIL (текущая очередь LIFO и неполное продвижение).

**Step 3: Write minimal implementation**

Заменить `push + pop` на FIFO (`VecDeque` или remove(0) с явным комментарием), вызвать `process_next_queued_task` в финализации/cleanup каждого task outcome.

**Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml queue`
Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/lib_queue_tests.rs
git commit -m "fix: enforce fifo queue and deterministic next-task scheduling"
```

### Task 4: Fix Python Result Schema Compatibility (`speakerTurns` vs `speaker_turns`)

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `ai-engine/ipc_events.py`
- Create: `src-tauri/src/lib_ipc_schema_tests.rs`

**Step 1: Write the failing test**

Тест: Rust parser корректно принимает оба варианта ключей (`speakerTurns` и `speaker_turns`) без потери данных.

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ipc_schema`
Expected: FAIL (camelCase payload частично теряется).

**Step 3: Write minimal implementation**

Добавить `#[serde(alias = "speakerTurns")]`/эквивалент в Rust enum и оставить Python payload стабильным.

**Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ipc_schema`
Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs ai-engine/ipc_events.py src-tauri/src/lib_ipc_schema_tests.rs
git commit -m "fix: accept both camelCase and snake_case speaker fields from python ipc"
```

### Task 5: Remove Dead/Confusing Routing Code in Frontend

**Files:**
- Modify: `src/services/transcription.ts`
- Create: `src/services/transcription-routing.test.ts`

**Step 1: Write the failing test**

Тест: routing logic не содержит мертвых переменных и корректно отражает фактическую поддержку моделей.

**Step 2: Run test to verify it fails**

Run: `bun run test src/services/transcription-routing.test.ts`
Expected: FAIL (legacy contract не синхронизирован).

**Step 3: Write minimal implementation**

Удалить неиспользуемый `bypassRustForContainer` и синхронизировать `SUPPORTED_RUST_MODELS` с фактической backend-поддержкой.

**Step 4: Run test to verify it passes**

Run: `bun run test src/services/transcription-routing.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/transcription.ts src/services/transcription-routing.test.ts
git commit -m "refactor: remove dead routing branches and align model support contract"
```

### Task 6: Phase 1 Verification Gate

**Files:**
- Modify: `docs/plans/2026-02-20-transcription-phase-1-stability.md`

**Step 1: Run frontend checks**

Run: `bunx tsc --noEmit && bun run test && bun run lint`
Expected: PASS.

**Step 2: Run Rust checks**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

**Step 3: Manual smoke**

Run: `bun run tauri:dev`
Expected: задачи в обоих путях (Rust и Python) доходят до `completed` без зависания.

**Step 4: Record outcomes**

Сохранить результаты в changelog/notes для перехода к Фазе 2.

**Step 5: Commit**

```bash
git add docs/plans/2026-02-20-transcription-phase-1-stability.md
git commit -m "docs: close phase 1 verification gate"
```
