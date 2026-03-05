
<h1 align="center">Vocrify</h1>

<p align="center">
Fast desktop transcription for audio & video
</p>

<p align="center">
Local AI • Speaker diarization • GPU acceleration
</p>

<p align="center">
<img src="https://github.com/user-attachments/assets/6095647a-0776-4533-9e8c-8d5636e107a2" width="900"/>
</p>

<p align="center">

![Rust](https://img.shields.io/badge/backend-Rust-orange)
![React](https://img.shields.io/badge/frontend-React-blue)
![Tauri](https://img.shields.io/badge/runtime-Tauri-purple)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

</p>

---

# ✨ Features

- 🎙 **Fast local transcription**
- 👥 **Speaker diarization**
- ⚡ **GPU acceleration**
- 🔒 **Runs fully locally**
- 🎧 Supports **audio and video**

---

# Overview

Vocrify is a **Windows desktop application** for audio and video transcription with speaker diarization.

The application runs **fully locally** and uses modern AI speech models.

### Key capabilities

- Accurate speech recognition
- Automatic speaker separation
- GPU acceleration
- Clean transcript navigation

---

# Architecture

Vocrify uses a **modern Rust + web stack**.

| Layer | Technology |
|-----|-----|
| UI | React 19 |
| State | Zustand |
| Styling | Tailwind CSS 4 |
| Desktop Runtime | Tauri 2 |
| Backend | Rust |
| Speech Recognition | transcribe-rs |
| Speaker Diarization | Sherpa-ONNX |
| Runtime | ONNX Runtime |

---

# Tech Stack

- **React 19**
- **TypeScript**
- **Tailwind CSS 4**
- **Zustand**
- **Tauri 2**
- **Rust**
- **transcribe-rs**
- **Sherpa-ONNX**
- **ONNX Runtime**

---

# Project Structure

```
vocrify/
  src/                 # React application
  src-tauri/           # Rust backend (Tauri)
  scripts/             # build/dev scripts
  docs/                # architecture docs
```

---

# Prerequisites

## Required

1. **Bun**
2. **Rust toolchain**
3. **Visual Studio Build Tools**  
   with **Desktop development with C++**

---

## Optional (GPU acceleration)

### NVIDIA

CUDA **12.1+**

### AMD / Intel

Vulkan SDK **1.3+**

---

# Quick Start

```bash
# install dependencies
bun install

# run in dev mode
bun run tauri:dev
```

---

# Development Commands

```bash
# run desktop app
bun run tauri:dev

# web dev mode
bun run dev

# production web build
bun run build

# production desktop build
bun run tauri:build

# portable build
bun run tauri:build:portable

# type checking
bunx tsc --noEmit

# lint
bun run lint
bun run lint:fix

# formatting
bun run format

# tests
bun run test
bun run test:coverage

# rust tests
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

---

# Testing Layout

### Frontend

```
src/**/__tests__/
```

### Rust tests

```
src-tauri/src/tests/*_tests.rs
```

Registered via

```
src-tauri/src/lib.rs
```

### Experimental tests

```
src-tauri/test-support/legacy-rust-tests/
```

Not executed in CI.

---

# Troubleshooting

## ONNX Runtime mismatch

If diarization/transcription fails with runtime mismatch:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
(Get-Item src-tauri\target\debug\onnxruntime.dll).VersionInfo.FileVersion
```

Expected:

```
onnxruntime.dll >= 1.22.x
```

---

## link.exe not found

Install:

```
Visual Studio Build Tools
Desktop development with C++
```

---

## GPU not detected

Check GPU environment:

### NVIDIA

```
nvidia-smi
```

### Vulkan

Ensure GPU drivers and Vulkan runtime are installed.

---

# Notes

- Use **bun**, not npm
- Architecture and coding rules → `AGENTS.md`

Portable build output:

```
src-tauri/target/release/bundle/portable/
```

---

# License

MIT
