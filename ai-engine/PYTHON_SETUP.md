# Python AI Engine Setup Guide

## CRITICAL ISSUE DETECTED

**Your system is running Python 3.14.2, but this project requires Python 3.8-3.12.**

The core dependencies (`faster-whisper` and `pyannote.audio`) do NOT support Python 3.13+.

## Quick Fix (Recommended)

### Option 1: Use Python 3.12 from Windows Store

1. Install Python 3.12.x from https://www.python.org/downloads/
   - Download "Windows installer (64-bit)" for Python 3.12.x
   - During installation, check "Add Python 3.12 to PATH"

2. Remove old virtual environment:
   ```bash
   cd E:\Dev\Transcribe-video\ai-engine
   rmdir /s venv
   ```

3. Create new venv with Python 3.12:
   ```bash
   py -3.12 -m venv venv
   ```

4. Activate and install:
   ```bash
   venv\Scripts\activate
   pip install -r requirements.txt
   ```

### Option 2: Use pyenv-win (For Multiple Python Versions)

1. Install pyenv-win:
   ```powershell
   Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/pyenv-win/pyenv-win/master/pyenv-win/install-pyenv-win.ps1" -OutFile "./install-pyenv-win.ps1"; &"./install-pyenv-win.ps1"
   ```

2. Install Python 3.12:
   ```bash
   pyenv install 3.12.8
   pyenv local 3.12.8
   ```

3. Create venv:
   ```bash
   cd E:\Dev\Transcribe-video\ai-engine
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```

## Verify Installation

After installing dependencies, verify the setup:

```bash
cd E:\Dev\Transcribe-video\ai-engine
venv\Scripts\activate
python main.py --test
```

Expected output:
```json
{
  "type": "hello",
  "message": "Hello from AI Engine!",
  "version": "0.1.0",
  "python_version": "3.12.x"
}
```

## Troubleshooting

### Error: "No module named 'faster_whisper'"

**Cause**: Wrong Python version (3.13+) or incompatible numpy version.

**Solution**:
```bash
# Check Python version
python --version  # Must be 3.8-3.12

# Reinstall with correct Python version
py -3.12 -m venv venv
venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Error: "PyAnnote requires HuggingFace token"

**Cause**: PyAnnote models are gated and require authentication.

**Solution**:
1. Get token from https://huggingface.co/settings/tokens
2. Accept license at:
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
3. Login:
   ```bash
   huggingface-cli login
   # Enter your token when prompted
   ```

### Error: "CUDA not available" (GPU acceleration)

**Cause**: Default installation uses CPU-only PyTorch.

**Solution for NVIDIA GPU**:
1. Check CUDA version: `nvidia-smi`
2. Edit `requirements.txt`, uncomment appropriate torch line:
   - For CUDA 11.8: `torch==2.2.2+cu118`
   - For CUDA 12.1: `torch==2.2.2+cu121`
3. Reinstall:
   ```bash
   pip uninstall torch
   pip install torch==2.2.2+cu118 --extra-index-url https://download.pytorch.org/whl/cu118
   ```

### Error: "FFmpeg not found"

**Cause**: FFmpeg system binary not installed.

**Solution**:
1. Install FFmpeg:
   - Download from https://www.gyan.dev/ffmpeg/builds/
   - Extract to `C:\ffmpeg`
   - Add to PATH: `setx PATH "%PATH%;C:\ffmpeg\bin"`
2. Verify: `ffmpeg -version`

## Dependency Overview

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| faster-whisper | 1.0.3 | Fast transcription (CTranslate2) |
| pyannote.audio | 3.3.1 | Speaker diarization |
| torch | 2.2.2 | Deep learning framework |
| numpy | 1.24.4 | Numerical computing |

### Audio Processing

| Package | Version | Purpose |
|---------|---------|---------|
| librosa | 0.10.1 | Audio loading/processing |
| soundfile | 0.12.1 | Audio I/O |
| ffmpeg-python | 0.2.0 | FFmpeg Python bindings |

### Model Management

| Package | Version | Purpose |
|---------|---------|---------|
| huggingface_hub | 0.23.4 | Model downloads |
| requests | 2.31.0 | HTTP requests |
| tqdm | 4.66.4 | Progress bars |

## Version Compatibility Matrix

| Python | faster-whisper | pyannote.audio | torch | Status |
|--------|----------------|----------------|-------|--------|
| 3.8 | ✅ 1.0.3 | ✅ 3.3.1 | ✅ 2.2.2 | Supported |
| 3.9 | ✅ 1.0.3 | ✅ 3.3.1 | ✅ 2.2.2 | Supported |
| 3.10 | ✅ 1.0.3 | ✅ 3.3.1 | ✅ 2.2.2 | Supported |
| 3.11 | ✅ 1.0.3 | ✅ 3.3.1 | ✅ 2.2.2 | Supported |
| 3.12 | ✅ 1.0.3 | ✅ 3.3.1 | ✅ 2.2.2 | Supported |
| 3.13 | ❌ | ❌ | ✅ | NOT SUPPORTED |
| 3.14 | ❌ | ❌ | ✅ | NOT SUPPORTED |

## Installation Commands

### Fresh Installation (Python 3.12)

```bash
# Navigate to ai-engine directory
cd E:\Dev\Transcribe-video\ai-engine

# Create virtual environment
py -3.12 -m venv venv

# Activate virtual environment
venv\Scripts\activate

# Upgrade pip
python -m pip install --upgrade pip

# Install dependencies
pip install -r requirements.txt

# Verify installation
python main.py --test
```

### Upgrade Existing Installation

```bash
cd E:\Dev\Transcribe-video\ai-engine

# Activate existing venv
venv\Scripts\activate

# Upgrade all packages
pip install --upgrade -r requirements.txt

# Verify
python main.py --test
```

### Development Installation (with testing tools)

```bash
# Install dependencies with dev tools
pip install -r requirements.txt
pip install pytest pytest-cov black flake8 mypy

# Run tests
pytest

# Format code
black .
```

## GPU Acceleration (Optional)

### NVIDIA GPU with CUDA 11.8

```bash
pip uninstall torch
pip install torch==2.2.2+cu118 --extra-index-url https://download.pytorch.org/whl/cu118
pip install faster-whisper==1.0.1
```

### NVIDIA GPU with CUDA 12.1

```bash
pip uninstall torch
pip install torch==2.2.2+cu121 --extra-index-url https://download.pytorch.org/whl/cu121
pip install faster-whisper==1.0.1
```

### CPU-only (Default)

```bash
pip install torch==2.2.2
pip install faster-whisper==1.0.3
```

## HuggingFace Token Setup

### For PyAnnote Diarization

1. Create account at https://huggingface.co/join
2. Generate token at https://huggingface.co/settings/tokens
3. Accept license terms:
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
   - https://huggingface.co/pyannote/embedding
4. Login:
   ```bash
   huggingface-cli login
   # Enter token when prompted
   ```

### Set Token via Environment Variable

```bash
# Windows (Command Prompt)
set HUGGINGFACE_ACCESS_TOKEN=your_token_here

# Windows (PowerShell)
$env:HUGGINGFACE_ACCESS_TOKEN="your_token_here"

# Permanent (User Environment Variable)
setx HUGGINGFACE_ACCESS_TOKEN "your_token_here"
```

## Model Download Locations

Models are cached in:
- Windows: `%USERPROFILE%\.cache\huggingface\hub\`
- Custom: Set `--cache-dir` parameter

Typical model sizes:
- whisper-tiny: ~80 MB
- whisper-base: ~160 MB
- whisper-small: ~500 MB
- whisper-medium: ~1.6 GB
- whisper-large-v3: ~3.2 GB

## Performance Tips

1. **Use GPU for faster transcription**: 10-50x speedup
2. **Use smaller models for speed**: tiny/base are fastest
3. **Use larger models for accuracy**: medium/large-v3 are best
4. **Disable diarization if not needed**: Saves processing time
5. **Use SSD for model cache**: Faster model loading

## Getting Help

If you encounter issues:

1. Check Python version: `python --version` (must be 3.8-3.12)
2. Check pip version: `pip --version` (upgrade if needed)
3. Clear cache: `pip cache purge`
4. Reinstall: `pip install --force-reinstall -r requirements.txt`
5. Check logs: Enable debug mode in main.py

## Links

- Project docs: `E:\Dev\Transcribe-video\CLAUDE.md`
- Requirements: `E:\Dev\Transcribe-video\ai-engine\requirements.txt`
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- pyannote.audio: https://github.com/pyannote/pyannote-audio
- PyTorch: https://pytorch.org/
