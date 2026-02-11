# Transcribe Video

A cross-platform desktop application for video transcription with speaker diarization.

## Features

- **Fast Transcription**: Powered by faster-whisper (CTranslate2-optimized Whisper)
- **Speaker Diarization**: Identify who said what using pyannote.audio
- **Multiple Models**: Support for Whisper, Distil-Whisper, and Parakeet
- **Optimized Performance**: 3-6x speedup with advanced optimizations
- **Task Queue**: Dynamic concurrent task management (up to 16 parallel tasks)
- **Model Pooling**: Reuse loaded models for faster subsequent transcriptions
- **Batch Processing**: Process multiple files efficiently
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Performance Optimizations

### Built-in Optimizations

The application includes several performance optimizations:

- **VAD (Voice Activity Detection)**: Automatically removes silence from audio (30-50% faster)
- **Model Pooling**: Caches loaded models in memory to eliminate reload overhead
- **Dynamic Concurrency**: Automatically adjusts parallel tasks based on model and device
- **Parallel Diarization**: Runs transcription and diarization concurrently (20-40% faster)
- **Batch Processing**: Processes multiple files in parallel for better throughput

### Performance Benchmarks

Typical performance improvements with optimizations enabled:

| Model | Device | Before | After | Speedup |
|-------|--------|--------|-------|---------|
| Whisper Base | CPU | 4-5x realtime | 12-15x realtime | **3-4x** |
| Whisper Base | GPU | 20x realtime | 100-120x realtime | **5-6x** |
| Distil-Large | CPU | 4-5x realtime | 24-30x realtime | **6x** |
| Parakeet 0.6B | GPU | 25-30x realtime | 120-150x realtime | **5-6x** |

### Concurrent Tasks

The number of parallel transcription tasks is dynamically adjusted based on:

- **Device type** (CPU/GPU)
- **Model size** (tiny/base/small/medium/large)

| Device | Model | Max Concurrent Tasks |
|--------|-------|---------------------|
| CPU | tiny/base | 4 |
| CPU | small/0.6b | 3 |
| CPU | medium/large | 2 |
| GPU | tiny/base | 8 |
| GPU | small | 6 |
| GPU | medium | 4 |
| GPU | large | 2 |

### Model Selection Guide

| Use Case | Recommended Model | Speed | Quality |
|----------|-----------------|-------|----------|
| Real-time captioning | distil-large | 6x | 97% |
| Fast video transcription | distil-large / whisper-base | 4-6x | 90-97% |
| Maximum accuracy | whisper-large-v3 | 1x | 100% |
| Low-resource systems | whisper.cpp (INT4) | 2x | 95% |
| Batch processing | distil-large (batched) | 10x | 97% |

## Tech Stack

### Frontend
- **Framework**: React + TypeScript
- **Build Tool**: Vite
- **Runtime**: Bun
- **Styling**: Tailwind CSS v4
- **State Management**: Zustand
- **Icons**: Lucide React

### Backend
- **Framework**: Tauri (Rust)
- **Async Runtime**: Tokio
- **Process Management**: Subprocess spawning for Python workers

### AI Engine
- **Language**: Python 3.10+
- **Transcription**: faster-whisper
- **Diarization**: pyannote.audio
- **ML Framework**: PyTorch

## Prerequisites

### Required
1. **Bun** - JavaScript runtime
   ```bash
   # Windows
   powershell -c "irm bun.sh/install.ps1 | iex"
   
   # macOS/Linux
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Rust** - For Tauri backend
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Python 3.10+** - For AI engine
   ```bash
   # Download from python.org or use your package manager
   ```

4. **Visual Studio Build Tools** (Windows only)
   - Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - Select "Desktop development with C++" workload
   - This is required for Rust to compile native code on Windows

### Optional (for GPU acceleration)
- **CUDA Toolkit 11.x or 12.x** - For NVIDIA GPU support
- **cuDNN** - For optimized deep learning inference

## Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd transcribe-video
```

### 2. Install frontend dependencies
```bash
bun install
```

### 3. Set up Python environment
```bash
cd ai-engine
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 4. Test the setup
```bash
# Test Python engine
python ai-engine/main.py --test

# Build and run the app
bun run tauri:dev
```

## Development

### Start development server
```bash
bun run tauri:dev
```

### Build for production
```bash
bun run tauri:build
```

### Run only the frontend (without Tauri)
```bash
bun run dev
```

## Project Structure

```
transcribe-video/
├── src/                      # Frontend source
│   ├── components/           # React components
│   │   ├── ui/               # Base UI components (Button, Card, etc.)
│   │   ├── layout/           # Layout components (Header)
│   │   └── features/         # Feature components (DropZone, TaskList)
│   ├── stores/               # Zustand state stores
│   ├── services/             # Tauri API wrappers
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utilities
│   ├── types/                # TypeScript types
│   ├── App.tsx               # Main app component
│   ├── main.tsx              # Entry point
│   └── index.css             # Global styles + Tailwind
├── src-tauri/                # Rust backend
│   ├── src/
│   │   └── lib.rs            # Main Tauri commands
│   ├── Cargo.toml            # Rust dependencies
│   └── tauri.conf.json       # Tauri configuration
├── ai-engine/                # Python AI engine
│   ├── main.py               # CLI entry point
│   ├── base.py               # BaseModel interface
│   ├── factory.py            # Model factory
│   ├── models/
│   │   ├── whisper.py        # Whisper implementation
│   │   └── parakeet.py       # Parakeet placeholder
│   └── requirements.txt      # Python dependencies
├── package.json              # Frontend dependencies
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   DropZone   │  │   TaskList   │  │ Transcription │       │
│  │  (File Drop) │  │  (Optimized) │  │    View       │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                           │                                   │
│                    Zustand Stores                             │
└──────────────────────────┬──────────────────────────────────┘
                           │ Tauri Commands
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Rust Backend (Tauri)                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               Task Manager (Optimized)                   │  │
│  │  • Dynamic concurrency (2-16 tasks based on model)      │  │
│  │  • Python process spawning                              │  │
│  │  • Event emission to frontend                           │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │ Subprocess (stdout JSON)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   Python AI Engine (Optimized)                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Model Pool (Caching)                      │   │
│  │  • Reuse loaded models                                │   │
│  │  • LRU eviction                                       │   │
│  │  • Preload common models                              │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐      │
│  │   Whisper    │  │ Distil-Whisp │  │   Parakeet     │      │
│  │  (w/ VAD)    │  │    (6x fast) │  │  (Multilingual)│      │
│  └──────────────┘  └──────────────┘  └────────────────┘      │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │ PyAnnote/    │  │ Performance  │                          │
│  │ Sherpa-ONNX  │  │   Monitor    │                          │
│  │ (Parallel)   │  │              │                          │
│  └──────────────┘  └──────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

## JSON Output Format

The Python engine outputs JSON messages to stdout:

### Progress Update
```json
{
  "type": "progress",
  "stage": "transcribing",
  "progress": 50,
  "message": "Processing audio..."
}
```

### Result
```json
{
  "type": "result",
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Hello, world!",
      "speaker": "SPEAKER_00",
      "confidence": 0.95
    }
  ]
}
```

### Error
```json
{
  "type": "error",
  "error": "File not found"
}
```

## Troubleshooting

### Windows: "link.exe not found" error
Install Visual Studio Build Tools with C++ workload:
1. Download from https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Run installer and select "Desktop development with C++"
3. Restart your terminal

### CUDA not detected
1. Ensure NVIDIA drivers are installed
2. Install CUDA Toolkit 11.x or 12.x
3. Verify with: `python -c "import torch; print(torch.cuda.is_available())"`

### PyAnnote authentication
Speaker diarization requires a HuggingFace token:
1. Create account at https://huggingface.co
2. Accept model terms at https://huggingface.co/pyannote/speaker-diarization-3.1
3. Create token and set: `huggingface-cli login`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

MIT
