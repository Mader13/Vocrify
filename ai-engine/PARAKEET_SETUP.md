# Parakeet ASR Model Setup Guide

This guide explains how to set up Parakeet ASR models using NVIDIA NeMo Toolkit for the Transcribe Video application.

## Table of Contents

- [Overview](#overview)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Platform-Specific Notes](#platform-specific-notes)

## Overview

**Parakeet** is NVIDIA's state-of-the-art automatic speech recognition (ASR) model family, available through the NeMo Toolkit. It provides:

- Multilingual transcription support
- High accuracy on diverse audio
- GPU acceleration support
- Multiple model sizes (0.6B to 1.1B parameters)

**Available Models:**
- `parakeet-tdt-0.6b-v3` - Multilingual, compact (recommended)
- `parakeet-tdt-1.1b-v1` - Larger model, better accuracy
- `nvidia/parakeet-tdt-0.6b-v3` - HuggingFace hosted version

## System Requirements

### Python Version
- **Required:** Python 3.10, 3.11, or 3.12
- **NOT Supported:** Python 3.13+ (NeMo incompatible)
- Check your version: `python --version`

### Operating System
- **Linux:** Full support (Ubuntu 20.04+, CentOS 7+)
- **macOS:** Supported (11.0+ for x86_64, 12.0+ for Apple Silicon)
- **Windows:** Limited support (WSL2 recommended)
  - Native Windows may have compatibility issues
  - Use WSL2 on Windows 11 for best results

### Hardware
- **CPU:** Multi-core processor recommended
- **RAM:** 16GB+ recommended (32GB for large models)
- **GPU (Optional):** NVIDIA GPU with 16GB+ VRAM for acceleration
  - CUDA 11.8 or 12.1 required
- **Storage:** ~2GB free space for models

## Installation

### Step 1: Set Up Python Environment

**If you don't have Python 3.12 installed:**

```bash
# Windows
# Download from: https://www.python.org/downloads/
# Install Python 3.12

# Linux/macOS
# Use pyenv or conda
pyenv install 3.12
pyenv local 3.12
```

### Step 2: Create Virtual Environment

**Strongly recommended** to use a separate venv for Parakeet due to dependency complexity:

```bash
cd ai-engine

# Create venv with Python 3.12
python -m venv venv-parakeet

# Activate venv
# Windows:
venv-parakeet\Scripts\activate

# Linux/macOS:
source venv-parakeet/bin/activate
```

### Step 3: Install Base Dependencies

First install the base requirements:

```bash
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

### Step 4: Install Parakeet Dependencies

Now install NeMo Toolkit and Parakeet-specific dependencies:

```bash
pip install -r requirements-parakeet.txt
```

**Expected output:**
- Downloading ~500MB of dependencies
- Installing nemo-toolkit and ASR modules
- Installing audio processing libraries
- May take 5-10 minutes depending on connection

### Step 5: Verify Installation

Run the environment check:

```bash
python check_environment.py
```

You should see:
```
Parakeet (NeMo Toolkit) Dependency Check
======================================================================
✅ nemo                     2.2.1           (OK)
✅ omegaconf                2.3.0           (OK)
✅ hydra                    <version>       (OK)
----------------------------------------------------------------------
✅ All Parakeet dependencies installed

📖 Parakeet models are available:
   - parakeet-tdt-0.6b-v3 (multilingual)
   - parakeet-tdt-1.1b-v1 (larger model)
```

### Step 6: Test Parakeet Model

Test with a sample transcription:

```bash
python main.py --test --model parakeet-tdt-0.6b-v3
```

## Verification

### Verify NeMo Installation

```bash
python -c "import nemo.collections.asr as nemo_asr; print('✅ NeMo ASR loaded')"
```

### Check Available Models

```bash
python -c "
import nemo.collections.asr as nemo_asr
print('Available Parakeet models:')
for model in nemo_asr.models.ASRModel.list_available_models():
    if 'parakeet' in str(model).lower():
        print(f'  - {model}')
"
```

### Test Transcription

```bash
# Test with sample audio file
python main.py \
  --file /path/to/audio.mp4 \
  --model parakeet-tdt-0.6b-v3 \
  --device cpu
```

## Troubleshooting

### Issue: "No module named 'nemo'"

**Solution:** Reinstall NeMo Toolkit

```bash
pip uninstall nemo-toolkit
pip install nemo-toolkit==2.2.1
```

### Issue: "numpy version conflict"

**Symptoms:**
```
ERROR: nemo-toolkit[asr] requires numpy<2.0.0
```

**Solution:** Keep numpy 1.24.4 from base requirements

```bash
pip install numpy==1.24.4 --force-reinstall
```

**Do NOT upgrade to numpy 2.x** - NeMo doesn't support it yet (as of 2025-02).

Track numpy 2.x support: [GitHub Issue #15034](https://github.com/NVIDIA-NeMo/NeMo/issues/15034)

### Issue: "WebSocket error during inference"

**Solution:** Upgrade websocket-client

```bash
pip install websocket-client --upgrade
```

### Issue: "CUDA out of memory"

**Solutions:**
1. Use CPU mode: `--device cpu`
2. Reduce batch size in model configuration
3. Use smaller model: `parakeet-tdt-0.6b-v3` instead of `1.1b`

### Issue: "ImportError: libsox.so not found"

**Linux:** Install system dependencies

```bash
sudo apt-get update
sudo apt-get install -y libsox-dev libsox-fmt-all ffmpeg
```

**macOS:**

```bash
brew install ffmpeg sox
```

### Issue: Windows Installation Fails

**Symptoms:** Build errors, missing dependencies

**Solutions:**
1. **Use WSL2 (Recommended):**
   ```bash
   # Install WSL2 on Windows 11
   wsl --install -d Ubuntu
   ```

2. **Install Visual Studio Build Tools:**
   - Download from: https://visualstudio.microsoft.com/downloads/
   - Install "Build Tools for Visual Studio 2022"
   - Select "C++ build tools"

3. **Install vcpkg for dependencies:**
   ```bash
   git clone https://github.com/Microsoft/vcpkg.git
   cd vcpkg
   ./bootstrap-vcpkg.bat
   ```

### Issue: Slow model download

**Solution:** Use mirror or pre-download

```bash
# Set HuggingFace mirror (if available)
export HF_ENDPOINT=https://hf-mirror.com

# Or pre-download models
python -c "
from nemo.collections.asr.models import ASRModel
model = ASRModel.from_pretrained('nvidia/parakeet-tdt-0.6b-v3')
print('Model downloaded to:', model.model_path)
"
```

## Platform-Specific Notes

### Linux (Ubuntu 20.04+)

**Best supported platform.**

```bash
# System dependencies
sudo apt-get update
sudo apt-get install -y \
    ffmpeg \
    libsox-dev \
    libsox-fmt-all \
    python3.12 \
    python3.12-venv

# CUDA setup (if using GPU)
# Download from: https://developer.nvidia.com/cuda-downloads
```

### macOS

**Good support, some limitations.**

```bash
# Install dependencies via Homebrew
brew install ffmpeg sox python@3.12

# Create venv
python3.12 -m venv venv-parakeet
source venv-parakeet/bin/activate

# Install
pip install -r requirements.txt
pip install -r requirements-parakeet.txt
```

**Note:** GPU acceleration not available on macOS (use CPU mode).

### Windows

**Limited support - WSL2 highly recommended.**

**Option 1: WSL2 (Recommended)**
```powershell
# Install WSL2
wsl --install -d Ubuntu

# Inside WSL2
sudo apt update
sudo apt install -y python3.12 python3.12-venv ffmpeg libsox-dev

# Follow Linux installation steps
```

**Option 2: Native Windows (Experimental)**
```powershell
# Install Python 3.12 from python.org
# Install Visual Studio Build Tools
# Install ffmpeg from gyan.dev

# Create venv
py -3.12 -m venv venv-parakeet
venv-parakeet\Scripts\activate

# Install
pip install -r requirements.txt
pip install -r requirements-parakeet.txt
```

**Warning:** Native Windows may have issues with some NeMo dependencies. Use WSL2 if possible.

## Alternative: Docker Installation

For a consistent environment, use Docker:

```dockerfile
# Dockerfile
FROM nvcr.io/nvidia/pytorch:24.07-py3

RUN apt-get update && apt-get install -y ffmpeg libsox-dev

WORKDIR /app
COPY requirements.txt requirements-parakeet.txt ./

RUN pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install -r requirements-parakeet.txt

CMD ["python", "check_environment.py"]
```

Build and run:

```bash
docker build -t transcribe-parakeet .
docker run --gpus all -it transcribe-parakeet
```

## Usage Examples

### Basic Transcription

```bash
python main.py \
  --file video.mp4 \
  --model parakeet-tdt-0.6b-v3 \
  --device cpu
```

### GPU Accelerated

```bash
python main.py \
  --file video.mp4 \
  --model parakeet-tdt-1.1b-v1 \
  --device cuda
```

### Multilingual

```bash
python main.py \
  --file multilingual-audio.mp4 \
  --model parakeet-tdt-0.6b-v3 \
  --language auto
```

## Model Comparison

| Model | Parameters | Languages | Speed | Accuracy | VRAM |
|-------|-----------|-----------|-------|----------|------|
| parakeet-tdt-0.6b-v3 | 0.6B | Multilingual | Fast | High | 2GB |
| parakeet-tdt-1.1b-v1 | 1.1B | Multilingual | Medium | Very High | 4GB |

## Next Steps

1. **Test with sample audio:**
   ```bash
   python main.py --test
   ```

2. **Run full transcription:**
   ```bash
   python main.py --file your-video.mp4 --model parakeet-tdt-0.6b-v3
   ```

3. **Compare with Whisper:**
   ```bash
   # Run with Whisper
   python main.py --file video.mp4 --model whisper-base

   # Run with Parakeet
   python main.py --file video.mp4 --model parakeet-tdt-0.6b-v3

   # Compare results
   ```

## Additional Resources

- [NeMo Framework Documentation](https://docs.nvidia.com/nemo-framework/)
- [NeMo GitHub Repository](https://github.com/NVIDIA/NeMo)
- [Parakeet Model Card](https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/parakeet-tdt-1.1b)
- [Installation Guide](https://docs.nvidia.com/nemo-framework/user-guide/latest/installation.html)

## Version History

- **2025-02-06:** Initial setup guide
  - NeMo Toolkit 2.2.1
  - Parakeet TDT 0.6B v3
  - Python 3.10-3.12 support
  - NumPy <2.0.0 requirement

## Support

For issues specific to this project:
1. Check `check_environment.py` output
2. Review troubleshooting section above
3. Check main project documentation: `PYTHON_SETUP.md`

For NeMo Toolkit issues:
- [NeMo GitHub Issues](https://github.com/NVIDIA-NeMo/NeMo/issues)
- [NeMo Discussion Forum](https://github.com/NVIDIA/NeMo/discussions)
