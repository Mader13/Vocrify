# Python Dependencies Update - Parakeet ASR Support

## Summary

This update adds comprehensive support for NVIDIA Parakeet ASR models through the NeMo Toolkit to the Transcribe Video application.

## Files Modified

### 1. **ai-engine/requirements.txt**
   - Added section explaining Parakeet is optional
   - Documented dependency conflicts and warnings
   - Added references to requirements-parakeet.txt
   - Updated compatibility notes

### 2. **ai-engine/requirements-parakeet.txt** (NEW)
   - Complete dependencies for NeMo Toolkit 2.2.1
   - Includes nemo-toolkit, ASR domain dependencies
   - Audio processing libraries (webrtcvad, pydub, sox)
   - Configuration management (omegaconf, hydra-core)
   - Comprehensive documentation and troubleshooting
   - Platform-specific installation instructions
   - Version compatibility matrix

### 3. **ai-engine/check_environment.py**
   - Added `check_parakeet_dependencies()` function
   - Checks for nemo, omegaconf, hydra
   - Provides helpful installation messages
   - Integrated into main environment check flow
   - Shows Parakeet status in summary

## Files Created

### 1. **ai-engine/PARAKEET_SETUP.md**
   Complete Parakeet installation and troubleshooting guide:
   - System requirements (Python 3.10-3.12, OS compatibility)
   - Step-by-step installation instructions
   - Verification and testing procedures
   - Comprehensive troubleshooting section
   - Platform-specific notes (Linux/macOS/Windows)
   - Docker installation option
   - Usage examples and model comparison

### 2. **ai-engine/install_parakeet.bat**
   Automated installation script for Windows:
   - Checks Python version compatibility
   - Warns about Windows limitations
   - Offers WSL2 installation instructions
   - Creates virtual environment
   - Installs all dependencies
   - Verifies installation
   - Provides usage instructions

### 3. **ai-engine/install_parakeet.sh**
   Automated installation script for Linux/macOS:
   - Checks Python version compatibility
   - Installs system dependencies (ffmpeg, sox)
   - Creates virtual environment
   - Installs all dependencies
   - Verifies installation
   - Provides usage instructions

## Key Dependencies

### Core NeMo Toolkit
- **nemo-toolkit==2.2.1** - Main framework
- **omegaconf==2.3.0** - Configuration management
- **hydra-core==1.3.2** - Configuration framework

### ASR-Specific Dependencies
- **websocket-client==1.8.0** - Real-time inference
- **jiwer==3.0.4** - Word Error Rate calculation
- **inflect==7.3.1** - Text normalization
- **unidecode==1.3.8** - ASCII conversion

### Audio Processing
- **webrtcvad==2.0.10** - Voice Activity Detection
- **pydub==0.25.1** - Audio utilities
- **sox==1.4.1** - Sound processing

## Critical Constraints

### Python Version
- **Required:** Python 3.10, 3.11, or 3.12
- **NOT Supported:** Python 3.13+
- Reason: NeMo Toolkit doesn't support Python 3.13+ yet

### NumPy Version
- **Required:** numpy<2.0.0
- **Current:** numpy==1.24.4 (from base requirements)
- Reason: NeMo[asr] has hard dependency on numpy<2.0.0
- Status: Tracking issue #15034 for numpy 2.x support

### Platform Support
- **Linux:** Full support (best option)
- **macOS:** Good support (CPU-only)
- **Windows:** Limited support (WSL2 recommended)
- Reason: NeMo has limited Windows support

## Installation Methods

### Method 1: Manual Installation
```bash
cd ai-engine
python -m venv venv-parakeet
source venv-parakeet/bin/activate  # Linux/macOS
# or
venv-parakeet\Scripts\activate  # Windows

pip install -r requirements.txt
pip install -r requirements-parakeet.txt
```

### Method 2: Automated Script
```bash
# Linux/macOS
chmod +x install_parakeet.sh
./install_parakeet.sh

# Windows
install_parakeet.bat
```

### Method 3: Docker (Recommended for consistency)
See `PARAKEET_SETUP.md` for Dockerfile example.

## Verification

Run environment check:
```bash
python check_environment.py
```

Expected output includes:
```
Parakeet (NeMo Toolkit) Dependency Check
======================================================================
✅ nemo                     2.2.1           (OK)
✅ omegaconf                2.3.0           (OK)
✅ hydra                    core           (OK)
----------------------------------------------------------------------
✅ All Parakeet dependencies installed
```

Test Parakeet model:
```bash
python main.py --test --model parakeet-tdt-0.6b-v3
```

## Available Models

- `parakeet-tdt-0.6b-v3` - Multilingual, compact (recommended)
- `parakeet-tdt-1.1b-v1` - Larger model, better accuracy

## Usage Examples

```bash
# Basic transcription
python main.py \
  --file video.mp4 \
  --model parakeet-tdt-0.6b-v3 \
  --device cpu

# GPU accelerated
python main.py \
  --file video.mp4 \
  --model parakeet-tdt-1.1b-v1 \
  --device cuda

# Multilingual
python main.py \
  --file multilingual.mp4 \
  --model parakeet-tdt-0.6b-v3 \
  --language auto
```

## Known Issues and Solutions

### Issue 1: NumPy Version Conflict
**Symptom:** `ERROR: nemo-toolkit[asr] requires numpy<2.0.0`

**Solution:**
```bash
pip install numpy==1.24.4 --force-reinstall
```

### Issue 2: Windows Installation Fails
**Symptom:** Build errors, missing dependencies

**Solution:** Use WSL2
```powershell
wsl --install -d Ubuntu
# Then follow Linux installation steps in WSL2
```

### Issue 3: CUDA Out of Memory
**Symptom:** GPU memory error during inference

**Solutions:**
1. Use CPU mode: `--device cpu`
2. Use smaller model: `parakeet-tdt-0.6b-v3`
3. Close other GPU applications

### Issue 4: Import Errors
**Symptom:** `ImportError: No module named 'nemo'`

**Solution:**
```bash
pip uninstall nemo-toolkit
pip install nemo-toolkit==2.2.1
```

## Compatibility Matrix

| Component | Version | Status |
|-----------|---------|--------|
| Python | 3.10-3.12 | ✅ Supported |
| Python | 3.13+ | ❌ Not supported |
| NumPy | 1.24.4 | ✅ Compatible |
| NumPy | 2.x | ❌ Not supported (yet) |
| PyTorch | 2.2.2 | ✅ Compatible |
| Linux | Ubuntu 20.04+ | ✅ Full support |
| macOS | 11.0+ | ✅ Good support |
| Windows | Native | ⚠️ Limited support |
| Windows | WSL2 | ✅ Full support |

## Performance Comparison

| Model | Parameters | VRAM | Speed | Accuracy | Best For |
|-------|-----------|------|-------|----------|----------|
| parakeet-tdt-0.6b-v3 | 0.6B | 2GB | Fast | High | General use |
| parakeet-tdt-1.1b-v1 | 1.1B | 4GB | Medium | Very High | High accuracy |
| whisper-base | 39M | 1GB | Very Fast | Good | Quick transcription |
| whisper-large-v3 | 1.5B | 4GB | Slow | Excellent | Best accuracy |

## Resource Requirements

### Minimum
- **RAM:** 16GB
- **Storage:** 2GB free
- **CPU:** 4+ cores
- **Internet:** 5-10 min download time

### Recommended
- **RAM:** 32GB
- **Storage:** 5GB free
- **CPU:** 8+ cores
- **GPU:** NVIDIA GPU with 16GB+ VRAM
- **CUDA:** 11.8 or 12.1

## Next Steps

1. **Choose installation method:**
   - Automated: Run `install_parakeet.bat` (Windows) or `install_parakeet.sh` (Linux/macOS)
   - Manual: Follow steps in `PARAKEET_SETUP.md`

2. **Verify installation:**
   ```bash
   python check_environment.py
   ```

3. **Test with sample audio:**
   ```bash
   python main.py --test --model parakeet-tdt-0.6b-v3
   ```

4. **Compare with Whisper:**
   ```bash
   # Run with both models and compare results
   python main.py --file test.mp4 --model whisper-base
   python main.py --file test.mp4 --model parakeet-tdt-0.6b-v3
   ```

## Documentation

- **Setup Guide:** `PARAKEET_SETUP.md` - Complete installation and troubleshooting
- **Base Requirements:** `requirements.txt` - Core dependencies
- **Parakeet Requirements:** `requirements-parakeet.txt` - Parakeet-specific dependencies
- **Environment Check:** `check_environment.py` - Verify installation
- **Main Script:** `main.py` - Run transcriptions

## Support Resources

- **NeMo Framework:** https://docs.nvidia.com/nemo-framework/
- **NeMo GitHub:** https://github.com/NVIDIA-NeMo/NeMo
- **Parakeet Models:** https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/parakeet-tdt-1.1b
- **Issue Tracker:** https://github.com/NVIDIA-NeMo/NeMo/issues

## Version History

- **2025-02-06:** Initial Parakeet support
  - NeMo Toolkit 2.2.1
  - Parakeet TDT 0.6B v3 and 1.1B v1 models
  - Python 3.10-3.12 support
  - NumPy <2.0.0 requirement
  - Automated installation scripts
  - Comprehensive documentation

## Notes

- Parakeet is **optional** - base app works fine with just faster-whisper
- Heavy dependencies (~500MB download) - use separate venv if needed
- Best performance on Linux - Windows users should use WSL2
- GPU acceleration requires NVIDIA GPU with CUDA support
- Multilingual support out of the box
- Regular updates from NVIDIA team

---

**Last Updated:** 2025-02-06
**Tested On:** Python 3.10, 3.11, 3.12 (Ubuntu 22.04)
