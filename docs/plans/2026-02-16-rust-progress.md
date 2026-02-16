# Rust Transcription Progress Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add smooth, stage-aware progress updates for Rust transcription so the UI no longer jumps from 5% to 100%.

**Architecture:** Emit `progress-update` events from the Rust backend on a timer based on estimated processing time. Use stage buckets (loading/transcribing/diarizing/finalizing) with clamped percent ranges and include metrics for UI.

**Tech Stack:** Rust (Tauri backend), Tokio, existing progress event types

---

### Task 1: Document model speed estimates in Rust

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

No existing Rust tests for progress; skip automated test and use a local trace log in Task 3.

**Step 2: Run test to verify it fails**

Skip.

**Step 3: Write minimal implementation**

Add a small helper in `src-tauri/src/lib.rs`:

```rust
fn model_rtf_estimate(model: &str) -> f64 {
    match model {
        "whisper-tiny" => 3.0,
        "whisper-base" => 2.5,
        "whisper-small" => 1.8,
        "whisper-medium" => 1.2,
        "whisper-large" => 0.9,
        "parakeet" => 4.0,
        "parakeet-tdt-0.6b-v3" => 4.2,
        "parakeet-tdt-1.1b" => 2.2,
        _ => 1.5,
    }
}
```

**Step 4: Run test to verify it passes**

Skip.

**Step 5: Commit**

Defer to the final commit after all tasks.

---

### Task 2: Emit smooth progress during Rust transcription

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

No existing Rust tests; use runtime logging in Task 3.

**Step 2: Run test to verify it fails**

Skip.

**Step 3: Write minimal implementation**

Inside `transcribe_rust`:

1. Emit `loading` start at 0% and end at 10% (already 5%, adjust to 0/10).
2. After audio is loaded and duration is known, compute:

```rust
let duration_s = /* audio duration in seconds */;
let rtf = model_rtf_estimate(&options.model);
let expected_s = (duration_s / rtf).max(1.0);
```

3. Spawn a Tokio task that, every 500–1000ms, emits:

```rust
let elapsed = start.elapsed().as_secs_f64();
let ratio = (elapsed / expected_s).min(1.0);
let progress = 10.0 + ratio * 80.0; // 10..90
```

Use stage "transcribing" and include `metrics` with `processedDuration`, `totalDuration`, `estimatedTimeRemaining`.

4. Stop the timer once transcription completes.

5. If diarization is enabled, emit stage "diarizing" with progress range 90..98 on a short timer (similar structure, but capped).

6. Emit "finalizing" at 98%, then 100% immediately before `transcription-complete`.

**Step 4: Run test to verify it passes**

Run a manual check using dev run and observe logs/events:

```bash
bun run tauri:dev
```

Expected: multiple `progress-update` events increasing smoothly instead of a single jump.

**Step 5: Commit**

Defer to the final commit after all tasks.

---

### Task 3: Add temporary debug logging for verification

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

Skip.

**Step 2: Run test to verify it fails**

Skip.

**Step 3: Write minimal implementation**

Add `eprintln!` logs for progress stage transitions and the computed percent. Remove or keep logs based on existing logging style.

**Step 4: Run test to verify it passes**

Run `bun run tauri:dev` and confirm logs show staged progress.

**Step 5: Commit**

Defer to final commit.

---

### Task 4: Cleanup and finalize

**Files:**

- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

Skip.

**Step 2: Run test to verify it fails**

Skip.

**Step 3: Write minimal implementation**

Remove any temporary debug logging not desired in production.

**Step 4: Run test to verify it passes**

Skip automated tests; rely on manual progress verification if Rust build is available.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs docs/plans/2026-02-16-rust-progress.md
git commit -m "feat: add smooth rust transcription progress"
```

---

## Notes

- If Rust build fails on Windows, ensure Visual Studio C++ Build Tools are installed (link.exe error).
- Tests currently emit React `act(...)` warnings in `tests/unit/notification-center.test.ts`. These pre-exist and are unrelated.
