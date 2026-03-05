# AGENTS.md

## Project Context

Tauri desktop app for video/audio transcription. React 19 + TypeScript + Tailwind CSS 4 + Zustand + Rust.

**GPU Priority:** CUDA > Vulkan > CPU

---

## Priority Order (For Conflict Resolution)

1. **Security** — never commit secrets
2. **Type safety** — no `any`, strict mode always
3. **Architecture** — service layer, no direct `invoke()`
4. **Code style** — naming, size limits
5. **Formatting** — Tailwind classes, prettier

---

## Decision Rules

### DO WITHOUT ASKING
- Edit components, stores, types, utilities
- Add UI components using CVA pattern
- Modify `src/components/features/`
- Run tests/linters/builds
- Add Zustand stores with persist middleware

### ASK BEFORE
- Adding bun dependencies
- Changing `src/services/tauri/`
- Modifying Rust modules
- Config changes (tailwind, Vite, tsconfig)
- Architecture/feature/UX decisions — present 2-3 options with trade-offs

### NEVER
- Commit secrets or API keys
- Remove TypeScript strict mode
- Use `any` type
- Use inline styles
- Call `invoke()` directly in components
- Bypass `cn()` utility
- Bypass `transcribeWithFallback()` engine router

---

## Code Standards

Strictly follow key principles of programming: SOLID, DRY, KISS.

### Import Order

```tsx
// 1. React
import * as React from "react";

// 2. Libraries (alphabetical)
import { clsx } from "clsx";
import { invoke } from "@tauri-apps/api/core";

// 3. Internal (@/)
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { startTranscription } from "@/services/tauri";
import type { TaskStatus } from "@/types";
```

### Size Limits

- Functions: <20 lines
- Components: <300 lines
- Files: <500 lines

### Naming

- Functions: descriptive verbs (`transcribeWithFallback`, `validateFilePath`)
- Types: explicit unions (`type TaskStatus = "queued" | "processing" | "completed"`)

### Comments

- DO: explain WHY (non-obvious decisions, workarounds)
- DON'T: explain WHAT (code is self-documenting)

---

## Required Patterns

### Class Merging

```tsx
import { cn } from "@/lib/utils";
<div className={cn("base", condition && "active")} />
```

### Component Variants (CVA)

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const variants = cva("base", {
  variants: {
    variant: { default: "...", primary: "...", destructive: "..." },
    size: { sm: "...", md: "...", lg: "..." },
  },
});
type Props = VariantProps<typeof variants>;
```

### Zustand Store

```tsx
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const useStore = create<State>()(
  persist(
    (set) => ({ items: [], add: (item) => set((s) => ({ items: [...s.items, item] })) }),
    { name: "store-name", storage: createJSONStorage(() => localStorage) }
  )
);
```

### Service Layer

```tsx
// Wrap all Tauri calls in services/tauri/
export async function startTranscription(
  taskId: string, filePath: string, options: TranscriptionOptions
): Promise<CommandResult<void>> {
  try {
    await invoke("start_transcription", { taskId, filePath, options });
    return { success: true };
  } catch (error) {
    logger.error("Transcription failed", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
```

---

## Architecture

### Frontend Layers

**Components:** `components/ui/` = reusable with CVA, `components/features/` = business logic

**Services:** All Tauri calls through `services/` layer, never `invoke()` directly

**State:** Zustand + persist in `stores/`, typed interfaces in `types/`

**Utils:** `lib/` = utilities (cn, validators), `hooks/` = custom hooks, `i18n/` = localization

### Rust Layers

**Layers:** `interfaces` (Tauri commands) → `application` (workflows) → `domain` (entities)

**Modules:** `audio/`, `transcription/`, `infrastructure/`, `commands/` — see `src-tauri/src/`

---

## Types

**Rule:** All types exported from `src/types/index.ts`. No `any` — only explicit union/types.

---

## Error Handling

**Frontend:**
```tsx
task: { ...task, error: string | null }
logger.error("General")
logger.transcriptionError("Transcription-specific")
logger.modelError("Model-related")
```

**Rust:** Return `Result<T, AppError>`; services return `CommandResult<T>`

---

## Testing

**Frontend:** Vitest, naming: `does X when Y`, run: `bun run test`

**Rust:** `cargo test --lib`

---

## Commands

```bash
bun run tauri:dev        # Dev
bun run tauri:build      # Build
bunx tsc --noEmit        # Type check
bun run lint             # Lint
bun run test             # Tests
cargo test --lib         # Rust tests
```

Остальное см. `package.json`

---

## Before Submitting

IF making architectural change → THEN explain trade-offs in 2-3 sentences  
IF adding dependency → THEN justify why it's needed  
IF unsure → THEN ask user, don't assume

### Checklist

- [ ] Import order correct
- [ ] No `any` types
- [ ] `cn()` used for classes
- [ ] CVA for component variants
- [ ] Zustand stores use persist
- [ ] No direct `invoke()` in components
- [ ] Functions <20 lines, components <300 lines
- [ ] Comments explain why, not what
- [ ] TypeScript strict mode preserved
- [ ] Tests added for new features
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run lint` passes

---

<!-- Last updated: 2026-03-03 -->
