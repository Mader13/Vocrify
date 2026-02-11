# AI Engine - Python Setup Guide

## ⚠️ Python Version Requirement

**Required: Python 3.8 - 3.12**

Python 3.13+ is NOT supported yet by the following key dependencies:
- `faster-whisper` (supports up to Python 3.12)
- `pyannote.audio` (supports up to Python 3.12)
- PyTorch (stable support up to Python 3.12)

Your current Python version: **3.14.2** ❌

## Installation Options

### Option 1: Install Python 3.11 (Recommended)

**Windows:**
1. Download Python 3.11 from [python.org](https://www.python.org/downloads/release/python-3119/)
2. Run installer and check "Add Python to PATH"
3. Open new terminal and verify:
   ```bash
   python3.11 --version  # or py -3.11 --version
   ```

**macOS:**
```bash
brew install python@3.11
python3.11 --version
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install python3.11 python3.11-venv python3.11-pip
python3.11 --version
```

### Option 2: Use pyenv (Cross-platform)

```bash
# Install pyenv first (see https://github.com/pyenv/pyenv)
pyenv install 3.11.9
pyenv global 3.11.9
python --version
```

### Option 3: Use conda/mamba

```bash
conda create -n transcribe python=3.11
conda activate transcribe
```

## Setup After Installing Python 3.11

### 1. Create Virtual Environment

```bash
cd ai-engine

# Windows
python3.11 -m venv venv
venv\Scripts\activate

# macOS/Linux
python3.11 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
# Option A: Using pip with requirements.txt
pip install -r requirements.txt

# Option B: Using pip with pyproject.toml (recommended)
pip install -e .

# Option C: Install with dev dependencies
pip install -e ".[dev]"
```

### 3. Verify Installation

```bash
python main.py --test
```

Expected output:
```json
{"type": "hello", "message": "Hello from AI Engine!", "version": "0.1.0", ...}
```

## Troubleshooting

### "No module named 'faster_whisper'"
- Ensure you're in the virtual environment (see prompt with `(venv)`)
- Re-run: `pip install -r requirements.txt`

### CUDA/GPU Support
For GPU acceleration, ensure you have CUDA installed:
```bash
# Check CUDA version
nvidia-smi

# Install CUDA-enabled PyTorch (if not automatically installed)
pip install torch==2.5.1+cu121 --extra-index-url https://download.pytorch.org/whl/cu121
```

### FFmpeg Requirement
FFmpeg is required for audio processing:

**Windows:** Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH

**macOS:** `brew install ffmpeg`

**Linux:** `sudo apt install ffmpeg`

## First Transcription Test

```bash
python main.py --file /path/to/audio.mp3 --model whisper-base --device cpu
```

## Model Downloads

First run will download models automatically:
- Whisper models: ~150MB - 3GB depending on size
- PyAnnote diarization: ~400MB

Models are cached in `~/.cache/`.

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Format code
black .
ruff check .

# Run tests
pytest
```

## Quick Reference

| Task | Command |
|------|---------|
| Check Python version | `python --version` |
| Create venv | `python3.11 -m venv venv` |
| Activate (Windows) | `venv\Scripts\activate` |
| Activate (Unix) | `source venv/bin/activate` |
| Install deps | `pip install -r requirements.txt` |
| Test engine | `python main.py --test` |
| Transcribe | `python main.py --file audio.mp3 --model whisper-base` |
