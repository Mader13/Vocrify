# AGENTS.md

## Project Overview

Tauri desktop application for video/audio transcription using AI (Whisper/Parakeet). Built with React 19, TypeScript, Tailwind CSS 4, and Zustand for state management.

## Commands

**Package Manager:** `bun` (not npm). Always use `bun` instead of `npm`.

### Development

**Standard workflow - run backend and frontend in separate terminals:**

```bash
# Terminal 1 - Start AI Engine (Python backend)
bun run dev:ai

# Terminal 2 - Start web dev server (Vite)
bun run dev

# OR for Tauri (native window)
# Terminal 2 - Start Tauri dev mode
bun run tauri:dev
```

### Build

```bash
# Build for production
bun run build

# Build Tauri application
bun run tauri:build
```

### Preview

```bash
# Preview production build
bun run preview
```

### Linting/Type Checking

```bash
# TypeScript check
bunx tsc --noEmit

# Vite type checking included in build
bun run build
```

### Installing Dependencies

```bash
# Install all dependencies (creates/updates bun.lock)
bun install

# Add new dependency
bun add <package>

# Add dev dependency
bun add -d <package>
```

### Python Dependencies (AI Engine)

The AI backend (located in `ai-engine/`) uses PyTorch with support for multiple acceleration backends.

**Supported Devices:**
| Device | Description | Performance |
|--------|-------------|-------------|
| **CUDA** | NVIDIA GPU (RTX, GTX, etc.) | ⚡ Fastest |
| **MPS** | Apple Silicon (M1/M2/M3/M4) | 🚀 Fast |
| **CPU** | Any modern CPU | 🐢 Slowest (fallback) |

**Installation by Platform:**

```bash
cd ai-engine

# Windows/Linux with NVIDIA GPU (CUDA 12.1) - RECOMMENDED
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu121

# macOS with Apple Silicon (M1/M2/M3/M4) - MPS acceleration built-in
pip install -r requirements.txt

# CPU-only (any platform) - slowest but works everywhere
pip install -r requirements.txt
```

**Requirements:**

- Python 3.10 or 3.12 (3.13+ NOT supported)
- For CUDA: NVIDIA GPU with CUDA 12.1+ drivers
- For MPS: macOS 12.3+ with Apple Silicon
- Verify CUDA: `nvidia-smi` (should show CUDA Version >= 12.1)
- Verify MPS: `python -c "import torch; print(torch.backends.mps.is_available())"`

**Device Detection:**
The app automatically detects available devices at startup. Device priority: CUDA > MPS > CPU.
See `ai-engine/device_detection.py` for implementation details.

## Code Style

### Do

- Use TypeScript strict mode for all types
- Follow JSDoc comments for functions (see `src/lib/utils.ts:8-10`)
- Use Zustand for state management (see `src/stores/index.ts:37-192`)
- Use `cn()` utility from `@/lib/utils` for class name merging
- Use class-variance-authority for component variants (see `src/components/ui/button.tsx:5-29`)
- Organize imports: React imports first, then library imports, then @/ imports
- Use functional components with proper TypeScript generics

### Don't

- Never use inline styles (use Tailwind utility classes)
- Don't mix client/server state in the same store
- Never call Tauri APIs directly in components (use `src/services/tauri.ts` abstraction)
- Avoid any() type - use proper TypeScript types

## Architecture

| Layer              | Location                   | Pattern                                 |
| ------------------ | -------------------------- | --------------------------------------- |
| State Management   | `src/stores/`              | Zustand with persistence                |
| Type Definitions   | `src/types/`               | Centralized TypeScript interfaces       |
| Utilities          | `src/lib/`                 | Helper functions (cn, formatTime, etc.) |
| UI Components      | `src/components/ui/`       | Reusable atoms with CVA variants        |
| Feature Components | `src/components/features/` | Feature-specific composed components    |
| Tauri Bridge       | `src/services/tauri.ts`    | Native API abstraction                  |
| Layout             | `src/components/layout/`   | Shell and navigation components         |

### Key Patterns

**Class Name Merging:**

```tsx
import { cn } from "@/lib/utils";
// Use: <div className={cn("base-class", condition && "conditional")} />
```

**Component Variants:**

```tsx
import { cva } from "class-variance-authority";
const variants = cva("base classes", {
  variants: { variant: { default: "...", primary: "..." } },
});
```

**Zustand Store:**

```tsx
export const useStore = create<State>()((set, get) => ({
  // state
  items: [],
  // actions
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
}));
```

## Import Conventions

```tsx
// React imports
import * as React from "react";
import { useState, useEffect } from "react";

// Library imports (alphabetical)
import { clsx, type ClassValue } from "clsx";
import { cva, type VariantProps } from "class-variance-authority";
import { create } from "zustand";

// Component imports (relative paths)
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Type imports (use @ alias)
import type { TranscriptionTask, TaskStatus } from "@/types";
```

## Types

All types are defined in `src/types/index.ts` and exported. Use the exported constants:

```tsx
import type { TaskStatus, AIModel, Language } from "@/types";
import { MODEL_NAMES, LANGUAGE_NAMES } from "@/types";

// Type usage
const status: TaskStatus = "processing";
const model: AIModel = "whisper-base";
```

## Error Handling

- UI state stores errors in the task object (`error: string | null`)
- Use try/catch in async operations
- Log errors appropriately (Tauri backend handles logging)
- Display user-friendly error messages in components

## Boundaries

### Allowed without asking

- Edit components, stores, types, and utilities
- Add new UI components following existing patterns
- Modify feature components in `src/components/features/`
- Run tests/linters/build commands
- Add new Zustand stores following established patterns

### Ask first

- New bun dependencies
- Changes to Tauri API integration (`src/services/tauri.ts`)
- Database/schema changes (if added)
- Environment variable changes
- Changes to `tailwind.config.js` or Vite config

### Never do

- Commit API keys or secrets
- Remove TypeScript strict mode
- Bypass the `cn()` utility for class merging
- Mix different state management solutions
- Use inline styles instead of Tailwind classes

## Anti-Patterns (THIS PROJECT)

1. **Inline styles** - Use Tailwind utility classes via `cn()` utility
2. **Direct Tauri imports in components** - Use `src/services/tauri.ts` abstraction
3. **any types** - Use proper TypeScript types from `@/types`
4. **Class variance without CVA** - Use class-variance-authority for component variants
5. **Non-persisted sensitive data in Zustand without middleware** - Use persist middleware

## Configuration

- **TypeScript**: ~5.8.3 with strict mode
- **React**: ^19.1.0
- **Vite**: ^7.0.4
- **Tailwind CSS**: ^4.1.18 with `@tailwindcss/vite`
- **Zustand**: ^5.0.11 for state management
- **Tauri**: v2 with `@tauri-apps/api` v2
- **Node**: >=18 required

## Testing

No test framework configured yet. When adding tests:

- Use Vitest for unit tests
- Place tests alongside source files: `*.test.tsx` or `*.spec.tsx`
- Run tests with `npx vitest`

## A Note To The Agent

We are build this together. When you learn something non-obvious, add it here so future changes go faster

**Device Support (Multi-Platform Acceleration)**

- App supports 3 device types: CUDA (NVIDIA GPU), MPS (Apple Silicon), CPU (fallback)
- Device detection module: `ai-engine/device_detection.py`
- Device priority: CUDA > MPS > CPU
- TypeScript types: `DeviceType`, `DeviceInfo`, `DevicesResponse` in `src/types/index.ts`
- API: `getAvailableDevices()` in `src/services/tauri.ts`

**Important: PyTorch Installation for GPU Support**

- CUDA (NVIDIA): Use `--extra-index-url https://download.pytorch.org/whl/cu121` flag
- MPS (Apple Silicon): Built into standard PyTorch, no extra flags needed
- CPU: Standard installation works everywhere
- Verify CUDA: `python -c "import torch; print(torch.cuda.is_available())"`
- Verify MPS: `python -c "import torch; print(torch.backends.mps.is_available())"`
- Current stable version: torch 2.5.1+cu121 (compatible with RTX 4060)

**Phase 3: Migration to transcribe-rs (COMPLETED)**

- Transcription is now handled by Rust transcribe-rs (not Python faster-whisper)
- Supported engines: Whisper (GGML), Parakeet (ONNX), Moonshine (ONNX), SenseVoice (ONNX)
- Python is ONLY used for speaker diarization (PyAnnote/Sherpa-ONNX)
- **Build requirements:**
  - macOS: No additional SDK needed (Metal is built-in) ✓
  - Linux: Vulkan SDK 1.3+ required
  - Windows: Vulkan SDK 1.3+ required + **long path support** (see below)
- **transcribe-rs DISABLED by default** (Windows path length limitation - whisper.cpp paths exceed 260 chars)
- **Enable transcribe-rs:**

  ```bash
  # Windows: Set env var and build
  set VULKAN_SDK=E:\Programs\Vulkan SDK
  cargo build --features rust-transcribe

  # Linux/macOS
  cargo build --features rust-transcribe
  ```

- **Windows long path support:**
  1. Registry: `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled = 1`
  2. Group Policy: Computer Configuration > Admin Templates > System > Filesystem > Enable Win32 long paths
  3. May need to move project to short path: `C:\project` instead of `E:\Dev\Transcribe-video`
- Rust modules:
  - `src-tauri/src/transcription_manager.rs` - Main transcription interface using transcribe-rs
  - `src-tauri/src/model_manager.rs` - Model download/management (supports ONNX format)
  - `src-tauri/src/whisper_engine.rs` - Legacy whisper-rs module (kept for compatibility)
- New Tauri commands:
  - `init_transcription_manager` - Initialize the transcribe-rs manager
  - `load_model_rust` - Load a model for transcription
  - `transcribe_rust` - Transcribe using transcribe-rs
  - `unload_model_rust` - Unload the current model
  - `is_model_loaded_rust` - Check if a model is loaded
- Model download URLs:
  - Whisper GGML: `https://huggingface.co/ggerganov/whisper.cpp`
  - Parakeet V3 int8: `https://blob.handy.computer/parakeet-v3-int8.tar.gz`
  - SenseVoice int8: `https://blob.handy.computer/sense-voice-int8.tar.gz`
- Updated files:
  - `src-tauri/Cargo.toml` - Added transcribe-rs dependency
  - `src/services/transcription.ts` - Updated to use transcribe_rust command
  - `src/types/index.ts` - Updated engine preference descriptions
  - `ai-engine/requirements.txt` - Removed faster-whisper dependency
- See full plan: `my-plans/transcription-system-v3.md`
