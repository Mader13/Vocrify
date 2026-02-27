# AGENTS.md

## Project Overview

Tauri desktop application for video/audio transcription using AI. Built with React 19, TypeScript, Tailwind CSS 4, and Zustand for state management.

**Core Architecture:**

- **Transcription Engine:** Rust `transcribe-rs` (Whisper GGML, Parakeet ONNX, Moonshine ONNX, SenseVoice ONNX)
- **Speaker Diarization:** Python Sherpa-ONNX (via PythonBridge) - only when diarization is enabled
- **GPU Acceleration:** CUDA (NVIDIA), MPS (Apple Silicon), Vulkan (AMD/Intel), CPU (fallback)

## Commands

**Package Manager:** `bun` (not npm). Always use `bun` instead of `npm`.

### Development

**Standard workflow:**

# Terminal 2 - Start Tauri dev mode (includes Vite)

bun run tauri:dev

````

**Note:** The Rust `transcribe-rs` engine handles all transcription. Python is only used for Sherpa-ONNX speaker diarization when enabled.

### Build

```bash
# Build for production (web)
bun run build

# Build Tauri application
bun run tauri:build
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

The Python backend (`ai-engine/`) is **only** used for speaker diarization (Sherpa-ONNX). All transcription is handled by the Rust `transcribe-rs` engine.

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

| Principle                | Description                                               | Example                                                     |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------- |
| **Meaningful Names**     | Use descriptive names for variables, functions, and types | `transcribeWithFallback()` instead of `process()`           |
| **Type-Driven Design**   | Leverage TypeScript's type system to encode intent        | `type TaskStatus = "queued" \| "processing" \| "completed"` |
| **Small Functions**      | Each function does one thing, named after its purpose     | `validateFilePath()`, `loadAudioFile()`                     |
| **Consistent Patterns**  | Follow established patterns for predictable code          | Service layer pattern, CVA variants                         |
| **Explicit Over Clever** | Prefer readable code over clever one-liners               | Named intermediate variables over nested chains             |

**Comments Guidelines:**

- **DO comment** _why_ something is done (non-obvious decisions, workarounds)
- **DO comment** complex algorithms or business logic that isn't self-evident
- **DON'T comment** _what_ the code does (the code itself should show this)
- **DON'T add** redundant JSDoc that just restates the function signature

### Do

- Use TypeScript strict mode for all types
- Write self-documenting code with meaningful names (functions, variables, types)
- Add JSDoc comments only for non-obvious _why_ decisions (see `src/lib/utils.ts`)
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
- **Architectural decisions** — When designing system architecture, data flow, or component structure, ask the user which approach to take. Present alternatives with trade-offs.
- **Feature implementation** — When implementing new features, ask the user which design/flow to use. Present options with pros/cons.
- **UX/UI design decisions** — When designing interface solutions (layout, user flows, interaction patterns, visual hierarchy), ask the user which option to choose. Present alternatives with trade-offs.

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
