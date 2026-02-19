# AGENTS.md

## Project Overview

Tauri desktop application for video/audio transcription using AI. Built with React 19, TypeScript, Tailwind CSS 4, and Zustand for state management.

**Core Architecture (Phase 3 - transcribe-rs):**

- **Primary Engine:** Rust transcribe-rs (Whisper GGML, Parakeet ONNX, Moonshine ONNX)
- **Secondary Engine:** Python backend for diarization only (PyAnnote, Sherpa-ONNX)
- **GPU Acceleration:** CUDA (NVIDIA), MPS (Apple Silicon), Vulkan (AMD/Intel), CPU (fallback)
- **Multi-agent System:** Claude Flow v3.1 with 99+ specialized agents

## Commands

**Package Manager:** `bun` (not npm). Always use `bun` instead of `npm`.

### Development

**Standard workflow:**

```bash
# Terminal 1 - Start Python backend (for diarization only)
bun run dev:ai

# Terminal 2 - Start Tauri dev mode (includes Vite)
bun run tauri:dev
```

**Note:** The Rust backend (transcribe-rs) handles all transcription. Python backend is only used for speaker diarization when enabled.

### Build

```bash
# Build for production (web)
bun run build

# Build Tauri application (includes ai-engine in resources)
bun run tauri:build

# Build with Rust transcribe-rs enabled (requires Vulkan SDK on Windows/Linux)
cargo build --features rust-transcribe
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

# ESLint check
bun run lint

# ESLint fix
bun run lint:fix

# Format code
bun run format
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

### Python Dependencies (AI Engine - Diarization Only)

The Python backend (`ai-engine/`) is **only** used for speaker diarization.

**PyTorch Installation by Platform:**

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
The app automatically detects available devices at startup. Device priority: CUDA > MPS > Vulkan > CPU.
See Rust `engine_router.rs` and `performance_config.rs` for implementation details.

## Code Style

### Software Engineering Principles

We follow these principles to maintain clean, maintainable, and scalable code:

#### SOLID Principles

| Principle                       | Description                                    | Application                                                                |
| ------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| **SRP** (Single Responsibility) | Each module/class/function does one thing well | One reason to change; separate UI from business logic                      |
| **OCP** (Open-Closed)           | Open for extension, closed for modification    | Use composition over inheritance; strategy pattern                         |
| **LSP** (Liskov Substitution)   | Subtypes must be substitutable for base types  | Implement proper interfaces; don't weaken preconditions                    |
| **ISP** (Interface Segregation) | Many small interfaces > one large interface    | Use focused interfaces (e.g., `ITranscriptionService`, `IModelDownloader`) |
| **DIP** (Dependency Inversion)  | Depend on abstractions, not concretions        | Inject dependencies; use interfaces for services                           |

#### Other Principles

| Principle                                         | Description                                       | Application                                                  |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| **DRY** (Don't Repeat Yourself)                   | Each piece of knowledge has single representation | Extract common logic to utilities; reuse components          |
| **KISS** (Keep It Simple, Stupid)                 | Simplicity over cleverness                        | Prefer readable code; avoid over-engineering                 |
| **YAGNI** (You Aren't Gonna Need It)              | Don't implement until necessary                   | No speculative features; build when required                 |
| **BOYSC** (Breathe Only When Strictly Convenient) | Keep entities small and focused                   | Small functions (<20 lines), small components, small modules |

**Implementation Guidelines:**

- **Functions**: Max 20 lines, single responsibility
- **Components**: Max 300 lines, focused on one feature
- **Files**: Max 500 lines, co-locate related code
- **Interfaces**: Define contracts in `src/types/`, implement in services
- **Services**: One service per domain (transcription, models, storage)
- **State**: Separate client state from server state in stores

### Self-Documenting Code

We prioritize **self-documenting code** over excessive comments. The code itself should be the primary source of truth.

**Principles:**

| Principle | Description | Example |
|-----------|-------------|---------|
| **Meaningful Names** | Use descriptive names for variables, functions, and types | `transcribeWithFallback()` instead of `process()` |
| **Type-Driven Design** | Leverage TypeScript's type system to encode intent | `type TaskStatus = "queued" \| "processing" \| "completed"` |
| **Small Functions** | Each function does one thing, named after its purpose | `validateFilePath()`, `loadAudioFile()` |
| **Consistent Patterns** | Follow established patterns for predictable code | Service layer pattern, CVA variants |
| **Explicit Over Clever** | Prefer readable code over clever one-liners | Named intermediate variables over nested chains |

**Comments Guidelines:**

- **DO comment** *why* something is done (non-obvious decisions, workarounds)
- **DO comment** complex algorithms or business logic that isn't self-evident
- **DON'T comment** *what* the code does (the code itself should show this)
- **DON'T add** redundant JSDoc that just restates the function signature

**Example:**

```tsx
// ❌ Redundant comment - code is self-explanatory
// Start transcription for the given task
async function startTranscription(taskId: string, filePath: string) {
  await invoke("start_transcription", { taskId, filePath });
}

// ✅ Good comment - explains WHY this workaround exists
// Rust audio decode fails on .mp4/.mkv containers (audrey crate limitation).
// Route to Python backend which uses FFmpeg for broader format support.
function shouldBypassRustForFile(filePath: string): boolean {
  const extension = getFileExtension(filePath);
  return RUST_UNSUPPORTED_CONTAINER_EXTENSIONS.has(extension);
}
```

### Do

- Use TypeScript strict mode for all types
- Write self-documenting code with meaningful names (functions, variables, types)
- Add JSDoc comments only for non-obvious *why* decisions (see `src/lib/utils.ts`)
- Use Zustand for state management with persist middleware (see `src/stores/index.ts`)
- Use `cn()` utility from `@/lib/utils` for class name merging
- Use class-variance-authority (CVA) for component variants (see `src/components/ui/button.tsx`)
- Organize imports: React imports first, then library imports, then @/ imports
- Use functional components with proper TypeScript generics
- Follow factory pattern for UI components (CVA variants + composition)

### Don't

- Never use inline styles (use Tailwind utility classes)
- Don't mix client/server state in the same store
- Never call Tauri APIs directly in components (use `src/services/tauri.ts` abstraction)
- Avoid any() type - use proper TypeScript types from `@/types`
- Don't bypass component variants - use CVA for variant styling

## Architecture

### Backend (Rust - Tauri)

| Module                     | Location                                 | Purpose                                                   |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| **Core**                   |                                          |                                                           |
| `lib.rs`                   | `src-tauri/src/lib.rs`                   | Main entry point, module organization, Tauri commands     |
| `main.rs`                  | `src-tauri/src/main.rs`                  | Tauri app configuration, command routing                  |
| **Transcription (Phase 3)**|                                          |                                                           |
| `transcription_manager.rs` | `src-tauri/src/transcription_manager.rs` | **Primary**: transcribe-rs unified interface              |
| `whisper_engine.rs`        | `src-tauri/src/whisper_engine.rs`        | Legacy whisper-rs module (deprecated, kept for reference) |
| `engine_router.rs`         | `src-tauri/src/engine_router.rs`         | Engine routing logic (Auto/RustOnly/PythonOnly)           |
| **Model Management**       |                                          |                                                           |
| `onnx_model_downloader.rs` | `src-tauri/src/onnx_model_downloader.rs` | Downloads ONNX models (Parakeet, Moonshine)               |
| `model_downloader.rs`      | `src-tauri/src/model_downloader.rs`      | Unified model download manager                            |
| **Diarization**            |                                          |                                                           |
| `sherpa_diarizer.rs`       | `src-tauri/src/sherpa_diarizer.rs`       | Sherpa-ONNX speaker diarization (lightweight)             |
| `python_bridge.rs`         | `src-tauri/src/python_bridge.rs`         | Bridges to Python for PyAnnote diarization                |
| **Infrastructure**         |                                          |                                                           |
| `ffmpeg_manager.rs`        | `src-tauri/src/ffmpeg_manager.rs`        | FFmpeg download and management                            |
| `storage.rs`               | `src-tauri/src/storage.rs`               | Persistent storage (Tauri Store)                          |
| `performance_config.rs`    | `src-tauri/src/performance_config.rs`    | Feature flags, device detection, concurrency tuning       |
| `python_installer.rs`      | `src-tauri/src/python_installer.rs`      | Portable Python installation for runtime                  |

### Frontend (React + TypeScript)

| Layer              | Location                   | Pattern                                               |
| ------------------ | -------------------------- | ----------------------------------------------------- |
| State Management   | `src/stores/`              | Zustand with persist middleware                       |
| Type Definitions   | `src/types/`               | Centralized TypeScript interfaces                     |
| Utilities          | `src/lib/`                 | Helper functions (cn, logger, formatTime, date-utils) |
| UI Components      | `src/components/ui/`       | Reusable atoms with CVA variants                      |
| Feature Components | `src/components/features/` | Feature-specific composed components                  |
| Services Layer     | `src/services/`            | Tauri API abstraction, transcription service          |
| Layout             | `src/components/layout/`   | Shell and navigation components                       |

**Key Frontend Services:**

- `tauri/index.ts` - Complete Tauri API abstraction (transcription, models, devices, dialogs)
- `transcription.ts` - Transcription service with engine routing (Rust transcribe-rs → Python fallback)
- `storage.ts` - Local storage management
- `notifications.ts` - Notification system with desktop support
- `store.ts` - Zustand store with task and settings management

### Engine Routing (Phase 3 - transcribe-rs)

```
User Request (transcribe)
    ↓
transcribeWithFallback() in src/services/transcription.ts
    ↓
┌─────────────────────────────────────────────────────────┐
│ Model Type Check                                         │
│ - whisper/moonshine/parakeet → Rust transcribe-rs      │
│ - other → Python engine                                 │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Engine Preference Check                                  │
│ - auto: Rust → Python fallback                          │
│ - rust: Rust only (error if unavailable)                │
│ - python: Python only                                   │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Rust transcribe-rs (Primary Engine)                      │
│ Engines:                                                 │
│ - Whisper (GGML models)                                 │
│ - Parakeet (ONNX models)                                │
│ - Moonshine (ONNX models)                               │
│ GPU: CUDA (NVIDIA) / MPS (Apple) / Vulkan (AMD/Intel)  │
└─────────────────────────────────────────────────────────┘
    ↓ (if diarization enabled)
┌─────────────────────────────────────────────────────────┐
│ Python Backend (Diarization Only)                        │
│ - PyAnnote (high accuracy, requires HF token)           │
│ - Sherpa-ONNX (lightweight, CPU-friendly)               │
│ GPU: CUDA / MPS                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Patterns

**Class Name Merging:**

```tsx
import { cn } from "@/lib/utils";
// Use: <div className={cn("base-class", condition && "conditional")} />
```

**Component Variants (CVA):**

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("base classes", {
  variants: {
    variant: {
      default: "...",
      primary: "...",
      destructive: "...",
    },
    size: {
      sm: "...",
      md: "...",
      lg: "...",
    },
  },
});

type ButtonProps = VariantProps<typeof buttonVariants>;
```

**Zustand Store with Persist:**

```tsx
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      // state
      items: [],
      // actions
      addItem: (item) => set((state) => ({ items: [...state.items, item] })),
    }),
    {
      name: "app-storage",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
```

**Service Layer Pattern (Tauri API):**

```tsx
// src/services/tauri/transcription-commands.ts
export async function startTranscription(
  taskId: string,
  filePath: string,
  options: TranscriptionOptions
): Promise<CommandResult<void>> {
  try {
    await invoke("start_transcription", { taskId, filePath, options });
    return { success: true };
  } catch (error) {
    logger.error("Failed to start transcription", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
```

## Import Conventions

```tsx
// React imports
import * as React from "react";
import { useState, useEffect, useCallback } from "react";

// Library imports (alphabetical)
import { clsx, type ClassValue } from "clsx";
import { cva, type VariantProps } from "class-variance-authority";
import { create } from "zustand";
import { invoke, listen } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// Component imports (relative paths)
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Service imports
import { startTranscription, getAvailableDevices } from "@/services/tauri";
import { transcribeWithFallback } from "@/services/transcription";

// Type imports (use @ alias)
import type {
  TranscriptionTask,
  TaskStatus,
  AIModel,
  Language,
  EnginePreference,
} from "@/types";
```

## Types

All types are defined in `src/types/index.ts` and exported. Use exported constants:

```tsx
import type { TaskStatus, AIModel, Language, EnginePreference } from "@/types";
import { MODEL_NAMES, LANGUAGE_NAMES, ENGINE_PREFERENCES } from "@/types";

// Type usage
const status: TaskStatus = "processing";
const model: AIModel = "whisper-base";
const engine: EnginePreference = "auto";
```

**Key Type Categories:**

- **Task Management:** `TranscriptionTask`, `TaskStatus`, `ProgressStage`, `ProgressMetrics`
- **Transcription:** `TranscriptionOptions`, `TranscriptionResult`, `TranscriptionSegment`, `SpeakerTurn`
- **Models:** `AIModel`, `ModelConfig`, `AvailableModel`, `LocalModel`, `ModelType`
- **Devices:** `DeviceType`, `DeviceInfo`, `DevicesResponse`
- **Diarization:** `DiarizationProvider`, `SpeakerCount`
- **Settings:** `AppSettings`, `EnginePreference`, `ArchiveMode`
- **Notifications:** `Notification`, `NotificationSettings`, `NotificationVariant`

## Error Handling

- UI state stores errors in task object (`error: string | null`)
- Use try/catch in async operations
- Log errors appropriately using `@/lib/logger`:
  - `logger.error()` - General errors
  - `logger.transcriptionError()` - Transcription-specific
  - `logger.modelError()` - Model-related
- Display user-friendly error messages in components
- Rust backend returns `Result<T, AppError>` - handle gracefully
- Services return `CommandResult<T>` pattern for consistent error handling

## Boundaries

### Allowed without asking

- Edit components, stores, types, and utilities
- Add new UI components following CVA pattern
- Modify feature components in `src/components/features/`
- Run tests/linters/build commands
- Add new Zustand stores with persist middleware
- Add new services in `src/services/`

### Ask first

- New bun dependencies
- Changes to Tauri API integration (`src/services/tauri/`)
- Rust backend module changes
- Database/schema changes (if added)
- Environment variable changes
- Changes to `tailwind.config.js` or Vite config

### Never do

- Commit API keys or secrets
- Remove TypeScript strict mode
- Bypass `cn()` utility for class merging
- Mix different state management solutions
- Use inline styles instead of Tailwind classes
- Call Tauri APIs directly in components (use `src/services/tauri/`)

## Anti-Patterns (THIS PROJECT)

1. **Inline styles** - Use Tailwind utility classes via `cn()` utility
2. **Direct Tauri imports in components** - Use `src/services/tauri/` abstraction
3. **any types** - Use proper TypeScript types from `@/types`
4. **Class variance without CVA** - Use class-variance-authority for component variants
5. **Non-persisted sensitive data in Zustand** - Use persist middleware
6. **Service layer bypass** - Never call `invoke()` directly in components
7. **Bypassing engine router** - Always use `transcribeWithFallback()` from `src/services/transcription.ts`

## Configuration

- **TypeScript**: ~5.8.3 with strict mode
- **React**: ^19.1.0
- **Vite**: ^7.0.4
- **Tailwind CSS**: ^4.1.18 with `@tailwindcss/vite`
- **Zustand**: ^5.0.11 for state management
- **Tauri**: v2.10.2 with `@tauri-apps/api` v2
- **Node**: >=18 required

**Rust Dependencies (Phase 3):**

- `tauri` ^2.10.2
- `transcribe-rs` =0.2.2 (optional, requires Vulkan SDK on Windows/Linux)
- `ort` =2.0.0-rc.10 (ONNX Runtime)
- `audrey` ^0.3 (audio processing)
- `tokio` ^1.49.0 (async runtime)

**Frontend Dependencies:**

- `react-window` ^2.2.6 - Virtualized lists for performance
- `wavesurfer.js` ^7.12.1 - Audio waveform visualization
- `framer-motion` ^12.33.0 - Animations
- `zod` ^3.0.0 - Schema validation

## Testing

**Test Framework:** Vitest for unit and component tests

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run tests with UI
bun run test:ui

# Generate coverage report
bun run test:coverage
```

**Test Location:**

- Place tests alongside source files: `*.test.tsx` or `*.spec.tsx`
- Example: `src/stores/index.test.ts`, `src/components/ui/button.test.tsx`

## Multi-Agent System (Claude Flow v3.1)

This project uses **Claude Flow v3.1** for multi-agent AI orchestration:

- **99+ specialized agents** (coder, tester, security, devops, etc.)
- **Swarm coordination** with hierarchical-mesh topology
- **Self-learning** with ReasoningBank and HNSW indexing
- **Memory Database** (AgentDB) with vector search
- **Hooks system** for automatic workflow optimization
- **MCP integration** for extended tooling

**Status:**
```
✅ Global installation: v3.1.0-alpha.14
✅ Daemon: Running
✅ Memory: Initialized
✅ Swarm: Initialized (hierarchical-mesh, max 15 agents)
✅ Skills: 29 skills available
✅ Agents: 99 agents available
```

**Usage:**
```bash
# Check system status
claude-flow status

# Start daemon
claude-flow daemon start

# Search memory
claude-flow memory search -q "API patterns"
```

See `.claude-flow/` directory for configuration and `docs/CLAUDE_FLOW_GUIDE.md` for detailed usage.

## A Note To The Agent

We are building this together. When you learn something non-obvious, add it here so future changes go faster.

### Documentation Synchronization Rule

**CRITICAL:** When making architectural changes, you MUST update BOTH documentation files:

1. **`agents.md`** (this file) - Architecture, gotchas, and agent-specific guidance
2. **`.claude/claude.md`** (if exists) - Claude Code context and project overview

**Synchronization Checklist:**
- [ ] Update architecture diagrams in both files
- [ ] Update module descriptions in both files
- [ ] Update gotchas and known issues in both files
- [ ] Verify commands and paths are accurate in both files

**Why:** `agents.md` is used by all AI assistants, while `claude.md` provides context for Claude Code specifically. Keeping them synchronized ensures consistent understanding across all AI tools.

### Device Support (Multi-Platform Acceleration)

- App supports 4 device types: CUDA (NVIDIA GPU), MPS (Apple Silicon), Vulkan (AMD/Intel), CPU (fallback)
- Device detection: Rust `performance_config.rs` and `engine_router.rs` detect available devices
- Device priority: CUDA > MPS > Vulkan > CPU
- TypeScript types: `DeviceType`, `DeviceInfo`, `DevicesResponse` in `src/types/devices.ts`
- API: `getAvailableDevices()` in `src/services/tauri/device-commands.ts`

### PyTorch Installation (for Diarization)

- CUDA (NVIDIA): Use `--extra-index-url https://download.pytorch.org/whl/cu121` flag
- MPS (Apple Silicon): Built into standard PyTorch, no extra flags needed
- CPU: Standard installation works everywhere
- Verify CUDA: `python -c "import torch; print(torch.cuda.is_available())"`
- Verify MPS: `python -c "import torch; print(torch.backends.mps.is_available())"`
- Current stable version: torch 2.5.1+cu121 (compatible with RTX 4060)

### Phase 3: transcribe-rs Architecture (COMPLETED)

**Primary Engine:** Rust transcribe-rs handles all transcription

- Supported engines: Whisper (GGML), Parakeet (ONNX), Moonshine (ONNX)
- **Note:** SenseVoice is NOT yet supported in transcribe-rs 0.2.2
- GPU acceleration: CUDA (NVIDIA), MPS (macOS Metal), Vulkan (AMD/Intel)
- **Rust module:** `src-tauri/src/transcription_manager.rs`

**Secondary Engine:** Python for diarization only

- PyAnnote (high accuracy, requires HuggingFace token)
- Sherpa-ONNX (lightweight, CPU-friendly)
- **Rust modules:** `src-tauri/src/python_bridge.rs`, `src-tauri/src/sherpa_diarizer.rs`

**Build Requirements:**

- macOS: No additional SDK needed (Metal is built-in) ✓
- Linux: Vulkan SDK 1.3+ required
- Windows: Vulkan SDK 1.3+ required + **long path support** (see below)

**Enable transcribe-rs:**

```bash
# Windows: Set env var and build
set VULKAN_SDK=E:\Programs\Vulkan SDK
cargo build --features rust-transcribe

# Linux/macOS
cargo build --features rust-transcribe
```

**Windows Long Path Support:**

1. Registry: `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled = 1`
2. Group Policy: Computer Configuration > Admin Templates > System > Filesystem > Enable Win32 long paths
3. May need to move project to short path: `C:\project` instead of `E:\Dev\Transcribe-video`

**Rust Transcription Commands (Phase 3):**

- `init_transcription_manager` - Initialize transcribe-rs
- `load_model_rust` - Load a model for transcription
- `transcribe_rust` - Transcribe using transcribe-rs
- `unload_model_rust` - Unload current model
- `is_model_loaded_rust` - Check if a model is loaded

**Model Download URLs:**

- Whisper GGML: `https://huggingface.co/ggerganov/whisper.cpp`
- Parakeet V3 int8: `https://blob.handy.computer/parakeet-v3-int8.tar.gz`
- Moonshine: `https://huggingface.co/coqui/moonshine`

**Updated Files (Phase 3):**

- `src-tauri/Cargo.toml` - Added transcribe-rs dependency
- `src/services/transcription.ts` - Engine routing with fallback
- `src/types/transcription.ts` - Updated transcription types
- `ai-engine/requirements.txt` - Removed faster-whisper, kept diarization dependencies

### Runtime Routing Gotchas (Updated Feb 2026)

- **CRITICAL:** UI task start path MUST use `src/services/transcription.ts::transcribeWithFallback()` (not direct `startTranscription`) or Rust transcribe-rs path is bypassed entirely.
- `transcribe_rust` requires model preloading via `load_model_rust` before transcription; otherwise it fails with engine/model-not-initialized and falls back.
- `TranscriptionManager` must be initialized with Python bridge paths (`python_exe`, `ai-engine/main.py`, `models_dir` as cache). If created with `None` bridge args, diarization silently degrades (transcription succeeds, speaker turns/segments are omitted).
- Python backend CLI accepts only `--device cpu|cuda|mps|vulkan`; when UI exposes `auto`, map to Python-compatible device on fallback.
- `python_bridge.rs` invokes Python diarization via compatibility flags (`--diarize-only`, `--provider`, `--audio`, `--num-speakers`, `--cache-dir`). If `ai-engine/main.py` no longer supports this contract, diarization fails at process startup and Rust currently returns transcription without speaker fields.
- Embeddable/isolated Python can start without script directory on `sys.path` (notably in `src-tauri/target/debug/resources`), causing `ModuleNotFoundError: commands`. Keep the `main.py` startup guard that inserts `Path(__file__).resolve().parent` into `sys.path` before importing `commands`.
- Rust audio decode currently fails on several media containers (`.mp4`, `.m4a`, `.mov`, `.mkv`, `.avi`, `.webm`) with "no supported format was detected"; in `auto` mode `transcribeWithFallback()` should bypass Rust for these extensions and call Python directly.
- **Critical:** Never call `invoke("transcribe_rust")` directly from components. Always use `transcribeWithFallback()`.
- Setup wizard checks (`check_python_environment`, `check_ffmpeg_status`, `check_models_status`) should not rely on `main.py --command` for embeddable Python: `main.py` imports `commands` package, which can fail before checks run if optional deps are missing. Prefer direct calls to `environment_checks.py` helpers.
- Model downloads can appear stuck at 0% if Python process exits before emitting JSON progress (e.g., missing `requests`/`tenacity`/`huggingface_hub` in embeddable Python). Backend should emit `model-download-error` on any spawn/early-exit failure and remove task from `downloading_models` to avoid permanent stuck state.

### Python Env Gotcha (Windows)

- Tauri `get_python_executable()` prefers `ai-engine/venv`, then `ai-engine/.venv`, then parent `.venv`.
- If project root `.venv` is selected but has no `torch`, diarization fails despite GPU/driver being present.
- Setup completion must be derived from live runtime checks (Python+PyTorch and FFmpeg), not only a persisted `.setup_complete` marker.
- Setup Installer may validate system Python via `py` launcher; runtime resolver must also consider `py` (not only `python`) or setup can report success while `check_python_environment`/`check_ffmpeg_status` fail in production.
- Production bundles must include `ai-engine` runtime files in Tauri resources. Use `bun run prepare:tauri-resources` before `tauri build` (now wired into scripts/config); otherwise setup checks fail because `main.py` is missing at runtime.
- Setup Installer must reject unsupported system Python versions (3.13+). If it accepts Python 3.14 because `torch` is installed, wizard gets stuck in a false-success state and never installs portable 3.12.
- On some Windows systems `nvidia-smi` is not on PATH for Tauri process (despite NVIDIA GPU present). Python installer should probe common NVSMI paths / fallback GPU detection, otherwise it mis-detects target as CPU and installs `torch+cpu`.
- If embeddable Python already has `torch` installed, do not assume it is correct: on NVIDIA systems check `torch.version.cuda`; if missing, upgrade existing CPU-only wheel to CUDA wheel during setup repair/reinstall.

### Logging System

- Structured logger in `src/lib/logger.ts` with categories:
  - `transcription` - Transcription operations
  - `upload` - File upload operations
  - `model` - Model management
  - `system` - General system events
- Use category-specific methods: `logger.transcriptionInfo()`, `logger.modelError()`, etc.

### Component Factory Pattern

- All UI components use CVA for variants
- Variants are exported as types: `type ButtonProps = VariantProps<typeof buttonVariants>`
- Use composition for complex components (e.g., `ModelDisplayCard` uses `ModelCard` + `ModelWarning`)

### Performance Optimization

- Use `react-window` for virtualized lists (TaskList, ModelCards)
- Lazy load heavy components (VideoPlayer, Waveform)
- Memoize expensive computations using `useMemo`
- Use `useCallback` for event handlers to prevent re-renders

### Notification System

- Centralized notification service in `src/services/notifications.ts`
- Supports desktop notifications via Tauri
- Categories: `download`, `transcription`, `error`, `info`
- Configurable: position, duration, sound, categories

### FFmpeg Container Limitation

Rust audio decoding via `audrey` crate only supports WAV/FLAC formats. For other containers:

- **Unsupported:** `.mp4`, `.m4a`, `.mov`, `.mkv`, `.avi`, `.webm`
- **Workaround:** `transcribeWithFallback()` automatically detects these extensions and routes to Python backend
- **Future:** Consider adding `symphonia` or FFmpeg WASM for broader format support in Rust

### Model Concurrency Tuning

The app dynamically adjusts concurrent transcription tasks based on device and model size:

| Device | Model | Max Concurrent Tasks |
|--------|-------|---------------------|
| CPU | tiny/base | 4 |
| CPU | small/0.6b | 3 |
| CPU | medium/large | 2 |
| GPU (CUDA/MPS) | tiny/base | 8 |
| GPU (CUDA/MPS) | small | 6 |
| GPU (CUDA/MPS) | medium | 4 |
| GPU (CUDA/MPS) | large | 2 |

See `get_max_concurrent_tasks()` in `src-tauri/src/lib.rs` for implementation.
