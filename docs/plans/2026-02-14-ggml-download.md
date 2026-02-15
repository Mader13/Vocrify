# GGML Download Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the Rust transcribe-rs path a production-ready way to download and cache `ggml-*.bin` Whisper models whenever the user only has the CTranslate2 `model.bin` bundle, so `load_model_rust` succeeds reliably.

**Architecture:** Extend the Tauri backend with a `download_ggml_model` command that writes into the existing `get_models_dir()` directory using `whisper_engine::download_ggml_model`. The frontend transcription service will preflight compatibility, call the new command when necessary, and retry the Rust pipeline once the GGML artifact is present.

**Tech Stack:** Rust/Tauri backend (+ `reqwest` already in `whisper_engine.rs`), TypeScript frontend (Vite + Tauri API), Zustand stores for user settings, `cargo test`, `bunx tsc` for verification.

---

### Task 1: Wire direct GGML download command into the backend

**Files:** `src-tauri/src/whisper_engine.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/types.rs` (if new error type), `src-tauri/Cargo.toml`

**Step 1:** Write a `tauri::command` named `download_ggml_model` that takes `(model_name: String)` and:

1. Calls `get_models_dir(&app)` to find `AppData/Vocrify/models`.
2. Invokes `whisper_engine::download_ggml_model(&model_name, &models_dir)` (reuse the existing helper).
3. Returns `Result<String, String>` (path on success, error message on failure).

**Step 2:** Add the command to `invoke_handler` and create a small unit test for invalid model names (`download_ggml_model`) that checks the function fails fast without hitting HTTP (call with unsupported name and assert error).

**Step 3:** Ensure the command logs progress/errors for easier debugging and reuses `get_models_dir` normalization (matching the rest of model management).

### Task 2: Add frontend helpers/packages to trigger GGML downloads

**Files:** `src/services/transcription.ts`, `src/stores/modelsStore.ts` (optional UI hook)

**Step 1:** Export a helper `downloadGgmlModel(modelName: string)` that calls the new command via `invoke`. Log start/completion/error.

**Step 2:** Update `transcribeWithFallback` so that when `is_model_rust_compatible` is `false` and the preference allows Rust:

1. Call `downloadGgmlModel` and wait for it to finish (handle rejection by logging and falling back to Python or bubbling error if preference is `rust`).
2. Re-run `is_model_rust_compatible` (or check the downloaded path) before invoking `load_model_rust`; if still incompatible, surface a clear message.

**Step 3:** Update state/UX (via `modelsStore` or notifications) if needed so the UI can show “Downloading GGML model for Rust engine” when this flow runs automatically.

### Task 3: Ensure Rust-side guarantees and tests

**Files:** `src-tauri/src/transcription_manager.rs`, `src-tauri/src/whisper_engine.rs` (given download already there)

**Step 1:** Add a non-network unit test for `whisper_engine::download_ggml_model` that runs `download_ggml_model("unknown")` and asserts it errors quickly (so we have a failing test before adding behavior). Run it to verify failure.

**Step 2:** Add or extend existing tests around `is_model_rust_compatible`/`find_ggml_file` to show that after we trigger GGML download the path is accepted (use temp dir + dummy `ggml-xxxx.bin`).

**Step 3:** After the tests fail for missing functionality (RED), implement the new helpers and rerun `cargo test download_ggml_model_invalid` plus the `find_ggml_file*` tests.

### Verification steps

- `cargo test download_ggml_model_invalid --features rust-transcribe` (should fail before implementation, pass after) plus the existing `test_find_ggml_file*` suite.
- `cargo check --features rust-transcribe`
- `bunx tsc --noEmit`

### Plan complete and saved to `docs/plans/2026-02-14-ggml-download.md`. Two execution options:

1. Subagent-Driven: Continue here with superpowers:subagent-driven-development, reviewing after each change.
2. Parallel Session: Start a fresh session use superpowers:executing-plans for step-by-step automation.
