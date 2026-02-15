# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Transcribe Video is a cross-platform desktop application for video transcription with speaker diarization. It combines:

- **Frontend**: React + TypeScript with Vite, styled with Tailwind CSS v4
- **Backend**: Rust via Tauri framework
- **AI Engine**: Python 3.8-3.12 (NOT 3.13+) using faster-whisper and pyannote.audio

**Architecture**: The app spawns Python subprocesses from Rust that process video/audio files and emit JSON events via stdout for progress updates and results.

## Development Commands

### Frontend (TypeScript/React)

```bash
# Development (Vite dev server only, no Tauri)
bun run dev

# Build frontend for production
bun run build

# Preview production build
bun run preview
```

### Full App (Tauri + Rust + Frontend)

```bash
# Start full app in development mode
bun run tauri:dev

# Build production binary for current platform
bun run tauri:build
```

### Python AI Engine

**CRITICAL**: Requires Python 3.8-3.12 ONLY (NOT 3.13+). If you have Python 3.13+ installed,
see `ai-engine/PYTHON_SETUP.md` for detailed setup instructions.

**Quick Environment Fix (Windows)**:

```bash
cd ai-engine

# Run automated fix script (RECOMMENDED)
fix_environment.bat

# OR manually set up:
# 1. Install Python 3.12 from https://www.python.org/downloads/
# 2. Create venv with Python 3.12
py -3.12 -m venv venv

# 3. Activate virtual environment
venv\Scripts\activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Test AI engine
python main.py --test
```

**Manual Setup Steps**:

```bash
cd ai-engine

# Check Python version (MUST be 3.8-3.12)
python --version

# If Python 3.13+, install Python 3.12 and use:
py -3.12 -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run diagnostics
python check_environment.py

# Test AI engine in isolation
python main.py --test

# Run AI engine in server mode (standalone)
python main.py --server

# Run transcription directly
python main.py --file /path/to/video.mp4 --model whisper-base --device cpu
```

**Troubleshooting**:

- If you see "No module named 'faster_whisper'": Wrong Python version
- If you see "PyAnnote requires token": See PYTHON_SETUP.md for HuggingFace setup
- Run `python check_environment.py` for full diagnostics

### Testing

```bash
# Python unit tests (from ai-engine directory)
cd ai-engine
pytest

# Rust unit tests (from root)
cargo test --manifest-path=src-tauri/Cargo.toml
```

## Project Architecture

### Frontend Structure

```
src/
├── components/
│   ├── features/        # Feature-specific components (DropZone, TaskList, VideoPlayer, etc.)
│   ├── layout/          # Layout components (Header)
│   └── ui/              # Base UI components (Button, Card, etc.)
├── stores/              # Zustand state stores (index.ts, modelsStore.ts)
├── services/            # Tauri API wrappers (tauri.ts)
├── types/               # TypeScript type definitions (index.ts)
├── hooks/               # Custom React hooks
├── lib/                 # Utilities and helpers
├── pages/               # Page components
└── App.tsx              # Main app component
```

### Backend Structure (Rust)

```
src-tauri/src/
└── lib.rs               # Main Tauri commands + task queue management
```

Key Tauri commands (all in `lib.rs`):

- `start_transcription`, `cancel_transcription`
- `get_local_models`, `get_disk_usage`, `delete_model`
- `get_huggingface_token`, `save_huggingface_token`
- Model download and management commands

### AI Engine Structure (Python)

```
ai-engine/
├── main.py              # CLI entry point, JSON stdout protocol
├── base.py              # BaseModel abstract interface
├── factory.py           # ModelFactory for creating model instances
├── models/
│   ├── whisper.py       # Whisper implementation
│   └── parakeet.py      # Parakeet placeholder
├── logger.py            # Structured logging with JSON output
└── requirements.txt     # Python dependencies
```

## Key Architecture Patterns

## Key Architecture Patterns

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

### 1. Communication Flow

Frontend → Rust (Tauri commands) → Python subprocess → JSON stdout → Rust events → Frontend

Python engine outputs JSON messages to stdout:

```json
// Progress update
{"type": "progress", "stage": "transcribing", "progress": 50, "message": "..."}

// Result
{"type": "result", "segments": [{"start": 0.0, "end": 2.5, "text": "...", "speaker": "SPEAKER_00"}]}

// Error
{"type": "error", "error": "..."}
```

### 2. State Management

- Zustand stores in `/src/stores`
- All types defined in `/src/types/index.ts`
- Tauri event listeners update frontend state via `listen()` from `@tauri-apps/api/event`

### 3. Model Management

Models defined in `/src/types/index.ts`:

- Whisper models (tiny/base/small/medium/large-v3)
- Parakeet models (NVIDIA)
- Diarization providers (pyannote, sherpa-onnx)

Model state tracked in `modelsStore.ts` (installed status, downloads)

### 4. Task Queue

Rust backend manages concurrent task queue (max 2 concurrent by default)
Each task spawns a separate Python subprocess with cancellation support via token/cancellation token pattern

## Important Constraints

### Python Version

**Python 3.13+ is NOT supported** - Key dependencies (faster-whisper, pyannote.audio) only support up to Python 3.12

### Path Aliases

TypeScript uses `@/*` for src directory imports (configured in vite.config.ts and tsconfig.json)

### File Organization Rules

- Source code in `/src`
- Tests in `/tests` (organized by `unit/python`, `unit/rust`, `integration`, `e2e`)
- Docs in `/docs`
- Config in `/config`
- Root folder reserved for config files only

### Component Organization

- UI components: reusable base components (`/src/components/ui`)
- Feature components: domain-specific (`/src/components/features`)
- Features include: DropZone, TaskList, VideoPlayer, TranscriptionView, ModelCard, etc.

## Common Patterns

### Adding a New Tauri Command

1. Add `#[tauri::command]` function in `src-tauri/src/lib.rs`
2. Register in `tauri::Builder` with `.invoke_handler()`
3. Create wrapper in `/src/services/tauri.ts` using `invoke()`
4. Add types to `/src/types/index.ts` if needed

### Adding a Feature Component

1. Create in `/src/components/features/YourComponent.tsx`
2. Export from `/src/components/features/index.ts`
3. Import and use in pages or other components

### Working with State

- Use Zustand stores from `/src/stores`
- Subscribe to Tauri events with `listen()` from `@tauri-apps/api/event`
- Events: `progress:<taskId>`, `complete:<taskId>`, `error:<taskId>`, `log:*`

## User Commands

### (cfs X) - Spawn Swarm

When the user writes `(cfs X)` where X is a number, spawn a Claude Flow swarm with X agents.

Example usage:

- `(cfs 4)` - Spawn 4 agents for parallel work
- `(cfs 8)` - Spawn 8 agents for larger tasks

Use the Task tool to spawn agents in parallel, and always initialize the swarm first using CLI tools.

## Claude Flow Integration

This project uses Claude Flow V3 for advanced multi-agent orchestration. **Always leverage Claude Flow capabilities** for complex tasks.

### When to Use Claude Flow

**Multi-agent swarm (cfs X):**

- Complex refactoring across multiple files
- Parallel feature implementation
- Large-scale code reviews
- Architectural changes
- Testing comprehensive scenarios

**Memory system:**

- Store patterns for reuse: `npx @claude-flow/cli@latest memory store --key "pattern-name" --value "description" --namespace patterns`
- Search past solutions: `npx @claude-flow/cli@latest memory search --query "your query"`
- Retrieve specific patterns: `npx @claude-flow/cli@latest memory retrieve --key "pattern-name"`

**Task orchestration:**

- Create tasks with dependencies
- Track progress across sessions
- Coordinate complex workflows

### Quick Claude Flow Commands

```bash
# Initialize swarm (use before spawning agents)
bunx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Check system health
bunx @claude-flow/cli@latest doctor --fix

# Memory operations
bunx @claude-flow/cli@latest memory store --key "key" --value "value" --namespace patterns
bunx @claude-flow/cli@latest memory search --query "query"

# Session management
bunx @claude-flow/cli@latest session list
bunx @claude-flow/cli@latest session resume <id>
```

### Available Agent Types (60+)

**Core Development:** `coder`, `reviewer`, `tester`, `planner`, `researcher`
**Swarm Coordination:** `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`
**Specialized:** `security-architect`, `performance-engineer`, `memory-specialist`
**GitHub:** `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### Swarm Best Practices

1. **Always initialize swarm** before spawning agents for complex tasks
2. **Use hierarchical topology** for coding swarms (better coordination)
3. **Keep max agents 6-8** for tight coordination
4. **Spawn all agents in one message** using Task tool with `run_in_background: true`
5. **Never poll status** - trust agents to return results

## Build Requirements

- **Bun**: JavaScript runtime and package manager
- **Rust**: For Tauri backend compilation
- **Visual Studio Build Tools** (Windows): C++ build tools for Rust
- **Python 3.8-3.12**: For AI engine (NOT 3.13+)
- **FFmpeg**: Required for audio processing
- **Claude Flow CLI**: `bunx @claude-flow/cli@latest` (installed via bun)

## Testing Strategy

- Python: pytest in `/tests/unit/python`
- Rust: cargo test in `/tests/unit/rust`
- Tests organized by layer: unit → integration → e2e

## Claude Flow V3 - Advanced Features Usage

This project has Claude Flow V3 fully configured with advanced AI capabilities. Use these features automatically for all development tasks.

### Daily Workflow Commands

**Before starting work:**

```bash
# Quick health check
bunx @claude-flow/cli@latest doctor

# Check neural system status
bunx @claude-flow/cli@latest neural status
```

**When analyzing code:**

```bash
# Check complexity (find files > 15 complexity)
bunx @claude-flow/cli@latest analyze complexity src/ --threshold 15

# Find circular dependencies
bunx @claude-flow/cli@latest analyze circular src/

# Security scan
bunx @claude-flow/cli@latest security scan --target . --quick
```

**When working on features:**

```bash
# Route task to optimal agent automatically
bunx @claude-flow/cli@latest route "Add video export feature"

# Get context before editing files
bunx @claude-flow/cli@latest hooks pre-edit -f src/App.tsx

# Search for similar patterns
bunx @claude-flow/cli@latest embeddings search -q "authentication error handling"
```

**When debugging:**

```bash
# Search memory for past solutions
bunx @claude-flow/cli@latest memory search --query "tauri command error"

# Get AI prediction
bunx @claude-flow/cli@latest neural predict -t "Fix video player freeze"

# Analyze performance bottlenecks
bunx @claude-flow/cli@latest performance bottleneck
```

### Automatic Features (Already Configured)

The following systems run automatically:

- **Neural Networks**: 50+ patterns learned from codebase
- **Hooks System**: Pretrained with 30+ patterns, 16+ strategies
- **Q-Learning Router**: Routes tasks to optimal agent automatically
- **Memory System**: Semantic search with HNSW indexing
- **Guidance Control**: CLAUDE.md compiled into policy bundle (81/100 score)

### When to Use Each Feature

**1. Neural Networks** - Use for pattern recognition and predictions

```bash
# Predict best approach for task
bunx @claude-flow/cli@latest neural predict -t "Refactor Tauri command handler"

# List learned patterns
bunx @claude-flow/cli@latest neural patterns --action list
```

**2. Security Scanning** - Use before commits and PRs

```bash
# Full security scan
bunx @claude-flow/cli@latest security scan --target . --depth advanced

# Check for secrets
bunx @claude-flow/cli@latest security secrets

# CVE vulnerability check
bunx @claude-flow/cli@latest security cve --list
```

**3. Hooks System** - Use for intelligent workflow automation

```bash
# Get AI suggestions before editing
bunx @claude-flow/cli@latest hooks pre-edit -f src/services/tauri.ts

# Route task using learned patterns
bunx @claude-flow/cli@latest hooks route -t "Implement model download progress"

# View learning metrics
bunx @claude-flow/cli@latest hooks metrics --v3-dashboard
```

**4. Code Analysis** - Use for understanding codebase structure

```bash
# Find high-complexity files (need refactoring)
bunx @claude-flow/cli@latest analyze complexity src/ --threshold 15

# Extract all functions
bunx @claude-flow/cli@latest analyze symbols src/ --type function

# Find module boundaries
bunx @claude-flow/cli@latest analyze boundaries src/

# Build dependency graph
bunx @claude-flow/cli@latest analyze dependencies src/ --format dot
```

**5. Performance Monitoring** - Use when optimizing

```bash
# Run benchmarks
bunx @claude-flow/cli@latest performance benchmark

# Profile specific feature
bunx @claude-flow/cli@latest performance profile

# Find bottlenecks
bunx @claude-flow/cli@latest performance bottleneck
```

**6. Embeddings & Semantic Search** - Use for finding similar code

```bash
# Semantic search (finds similar code, not just text match)
bunx @claude-flow/cli@latest embeddings search -q "video player controls"

# Compare two code snippets
bunx @claude-flow/cli@latest embeddings compare -t "auth" -u "authentication"

# Generate embedding for text
bunx @claude-flow/cli@latest embeddings generate -t "Tauri event listener pattern"
```

**7. Guidance Control** - Use for checking rules and best practices

```bash
# Get relevant rules for task
bunx @claude-flow/cli@latest guidance retrieve -t "Add new Tauri command"

# Check if command is safe
bunx @claude-flow/cli@latest guidance gates -c "rm -rf src-tauri/"

# View guidance status
bunx @claude-flow/cli@latest guidance status
```

**8. Q-Learning Routing** - Use for automatic agent selection

```bash
# Route task to best agent (coder, tester, reviewer, etc.)
bunx @claude-flow/cli@latest route "Write unit tests for transcription service"

# View routing statistics
bunx @claude-flow/cli@latest route stats

# List all available agents
bunx @claude-flow/cli@latest route list-agents
```

**9. Memory System** - Use for storing and retrieving patterns

```bash
# Store successful pattern for reuse
bunx @claude-flow/cli@latest memory store --key "tauri-event-pattern" --value "Use listen() from @tauri-apps/api/event for Tauri events" --namespace patterns

# Search for patterns
bunx @claude-flow/cli@latest memory search --query "event handling"

# Retrieve specific pattern
bunx @claude-flow/cli@latest memory retrieve --key "tauri-event-pattern"

# View memory statistics
bunx @claude-flow/cli@latest memory stats
```

**10. Process Management** - Use for background automation

```bash
# List all background workers
bunx @claude-flow/cli@latest process workers --action list

# Trigger specific worker
bunx @claude-flow/cli@latest process daemon --action trigger --worker map

# Monitor processes
bunx @claude-flow/cli@latest process monitor --watch
```

### Common Workflows

**Workflow 1: Adding a New Feature**

```bash
# 1. Get guidance
bunx @claude-flow/cli@latest guidance retrieve -t "Add video export feature"

# 2. Route to optimal agent
bunx @claude-flow/cli@latest route "Implement video export with progress tracking"

# 3. Search for similar patterns
bunx @claude-flow/cli@latest memory search --query "file download progress"

# 4. Check complexity before implementing
bunx @claude-flow/cli@latest analyze complexity src/components/features/
```

**Workflow 2: Debugging an Issue**

```bash
# 1. Search memory for similar issues
bunx @claude-flow/cli@latest memory search --query "video player freeze"

# 2. Get AI prediction
bunx @claude-flow/cli@latest neural predict -t "Fix video player freeze on seek"

# 3. Analyze problematic file
bunx @claude-flow/cli@latest analyze complexity src/components/features/VideoPlayer.tsx

# 4. Check for circular dependencies
bunx @claude-flow/cli@latest analyze circular src/
```

**Workflow 3: Code Review**

```bash
# 1. Security scan
bunx @claude-flow/cli@latest security scan --target . --quick

# 2. Complexity check
bunx @claude-flow/cli@latest analyze complexity src/

# 3. Find circular dependencies
bunx @claude-flow/cli@latest analyze circular src/

# 4. Performance check
bunx @claude-flow/cli@latest performance bottleneck
```

**Workflow 4: Refactoring**

```bash
# 1. Find complex files
bunx @claude-flow/cli@latest analyze complexity src/ --threshold 15

# 2. Find module boundaries
bunx @claude-flow/cli@latest analyze boundaries src/

# 3. Check dependencies
bunx @claude-flow/cli@latest analyze dependencies src/

# 4. Search for refactoring patterns
bunx @claude-flow/cli@latest memory search --query "refactor large component"
```

### Quick Reference Card

**Daily Commands:**

```bash
bunx @claude-flow/cli@latest doctor                    # Health check
bunx @claude-flow/cli@latest neural status             # Check neural
bunx @claude-flow/cli@latest memory stats              # Memory stats
bunx @claude-flow/cli@latest security scan             # Security check
```

**Development Commands:**

```bash
bunx @claude-flow/cli@latest route "task"              # Route task
bunx @claude-flow/cli@latest hooks route -t "task"     # Route with hooks
bunx @claude-flow/cli@latest memory search -q "query"  # Search memory
bunx @claude-flow/cli@latest embeddings search -q "x"  # Semantic search
```

**Analysis Commands:**

```bash
bunx @claude-flow/cli@latest analyze complexity src/   # Complexity
bunx @claude-flow/cli@latest analyze circular src/     # Circular deps
bunx @claude-flow/cli@latest performance benchmark     # Benchmark
```

### Important Notes

1. **Automatic Usage**: Claude Code (this AI) automatically uses these systems. You don't need to manually run commands unless troubleshooting.

2. **Memory Persistence**: Patterns and learnings persist across sessions in `.swarm/memory.db`

3. **Continuous Learning**: The system learns from every task. Patterns improve over time.

4. **Performance**: All systems are optimized:
   - Embedding generation: ~4ms
   - SONA adaptation: ~3μs
   - Memory search: HNSW indexed (150x-12,500x faster)

5. **Privacy**: All data stored locally. No external API calls unless configured.

### Setup Documentation

For detailed setup instructions on other projects, see: `docs/CLAUDE-FLOW-SETUP.md`
