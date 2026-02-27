# Vocrify (Transcribe Video)

Desktop application for video and audio transcription with speaker diarization.

## Overview

Vocrify is a Tauri app with a React frontend and a Rust backend.

- Transcription is handled by Rust `transcribe-rs`
- Speaker diarization is handled by Sherpa-ONNX
- GPU acceleration is supported with automatic device selection

## Current Architecture

- Frontend: React 19, TypeScript, Tailwind CSS 4, Zustand
- Desktop shell and backend: Tauri 2 + Rust
- Transcription engines: `transcribe-rs` (Whisper, Parakeet, Moonshine)
- Diarization runtime: native Sherpa-ONNX (`sherpa-rs`) in Rust
- Python `ai-engine`: setup checks, model management, and support utilities
- Device priority: CUDA > MPS > Vulkan > CPU

## Tech Stack

- UI: React 19, TypeScript, Tailwind CSS 4, Zustand
- Desktop: Tauri 2
- Rust AI deps: `transcribe-rs`, `ort`, `sherpa-rs`
- Python tools: model download and environment checks in `ai-engine/`

## Prerequisites

### Required

1. Bun
2. Rust toolchain
3. Python 3.10 or 3.12
4. Windows only: Visual Studio Build Tools with C++ workload

### Optional for GPU

- NVIDIA: CUDA 12.1+ drivers
- Apple Silicon: macOS 12.3+ (MPS)
- Windows/Linux AMD/Intel: Vulkan SDK 1.3+

## Quick Start

```bash
# 1) Install JS deps
bun install

# 2) Install Python deps (for ai-engine utilities)
cd ai-engine
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
# source venv/bin/activate

pip install -r requirements.txt

# 3) Start app in dev mode
cd ..
bun run tauri:dev
```

## Development Commands

```bash
# Tauri + Vite dev
bun run tauri:dev

# Web dev only
bun run dev

# Production web build
bun run build

# Production desktop build
bun run tauri:build

# Production portable build (no installer)
bun run tauri:build:portable

# Type check
bunx tsc --noEmit

# Lint
bun run lint
bun run lint:fix

# Format
bun run format

# Tests
bun run test
bun run test:coverage
```

## Python AI Engine Commands

```bash
cd ai-engine

# Environment checks
python main.py --command check_environment

# List models
python main.py --list-models --cache-dir <models_dir>

# Download diarization model
python main.py --download-model sherpa-onnx-diarization --model-type diarization --cache-dir <models_dir>

# Delete model
python main.py --delete-model sherpa-onnx-diarization --cache-dir <models_dir>
```

## Project Structure

```text
transcribe-video/
  src/                 # React app
  src-tauri/           # Rust backend (Tauri)
  ai-engine/           # Python setup/model utilities
  scripts/             # Build/dev helper scripts
  docs/                # Technical docs and reports
```

## Troubleshooting

### ONNX Runtime mismatch on Windows

If diarization/transcription fails with ONNX version mismatch or CRT assertion errors, see:

- `docs/ONNX_RUNTIME_COMPATIBILITY.md`

Quick check:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
(Get-Item src-tauri\target\debug\onnxruntime.dll).VersionInfo.FileVersion
```

Expected: `onnxruntime.dll` version in `target/debug` should be `>= 1.22.x`.

### link.exe not found (Windows)

Install Visual Studio Build Tools and enable `Desktop development with C++`.

### GPU not detected

- CUDA: check `nvidia-smi`
- MPS: `python -c "import torch; print(torch.backends.mps.is_available())"`

## Notes

- Use `bun`, not `npm`.
- Keep Rust and Python environments in sync after dependency updates.
- For architecture and coding rules, see `AGENTS.md`.
- Portable archive output: `src-tauri/target/release/bundle/portable/`.
