# Transcribe Video - Setup Checklist

Quick checklist to get your transcription app working. Print this out and check off each item.

---

## Part 1: Python Environment ✅

### Python Version Check
- [ ] Verify Python 3.10 is available: `py -3.10 --version`
- [ ] Should show: `Python 3.10.11`

### Create Virtual Environment
- [ ] Open terminal in project root: `cd E:\Dev\Transcribe-video`
- [ ] Create venv: `py -3.10 -m venv ai-engine/venv`
- [ ] Activate venv (Windows CMD): `ai-engine\venv\Scripts\activate`
- [ ] Activate venv (PowerShell): `ai-engine\venv\Scripts\Activate.ps1`
- [ ] Verify activation: Prompt shows `(venv)`
- [ ] Check Python version: `python --version` → `Python 3.10.11`

### Install Dependencies
- [ ] Stay in project root, venv activated
- [ ] Upgrade pip: `python -m pip install --upgrade pip`
- [ ] Install dependencies: `pip install -r ai-engine/requirements.txt`
- [ ] Wait for installation to complete (~5 minutes)
- [ ] Verify: `python ai-engine/check_environment.py`
- [ ] All checks should show ✅

---

## Part 2: System Dependencies ✅

### FFmpeg Installation
- [ ] Download from: https://www.gyan.dev/ffmpeg/builds/
- [ ] Download: `ffmpeg-release-essentials.zip`
- [ ] Extract to: `C:\ffmpeg`
- [ ] Verify: `C:\ffmpeg\bin\ffmpeg.exe` exists
- [ ] Add to PATH: `setx PATH "%PATH%;C:\ffmpeg\bin`
- [ ] Close and reopen terminal
- [ ] Verify: `ffmpeg -version`

---

## Part 3: App Configuration ✅

### HuggingFace Token Setup
- [ ] Create account: https://huggingface.co/join
- [ ] Get token: https://huggingface.co/settings/tokens
- [ ] Create new token (Type: "Read")
- [ ] Copy token (starts with `hf_`)
- [ ] Accept license: https://huggingface.co/pyannote/segmentation-3.0
- [ ] Accept license: https://huggingface.co/pyannote/embedding
- [ ] Set token in app Settings OR via env: `set HUGGINGFACE_ACCESS_TOKEN=hf_xxx`

### Fix Configuration
- [ ] Open `tsconfig.json` in editor
- [ ] Remove trailing commas
- [ ] Save file
- [ ] Validate: `bun run build` (should succeed)

---

## Part 4: Verification ✅

### Run Integration Tests
- [ ] Make sure venv is activated: `(venv)` in prompt
- [ ] Run tests: `python test_integration.py`
- [ ] Check results: All 9 tests should pass ✅
- [ ] Pass rate should be: 100%

### Test AI Engine
- [ ] Run test mode: `py -3.10 ai-engine/main.py --test`
- [ ] Should see: `{"type": "hello", "message": "Hello from AI Engine!"}`

### Test Full App
- [ ] With venv activated, run: `bun run tauri:dev`
- [ ] App window should open
- [ ] No errors in console
- [ ] Can access all tabs (Home, Models, Settings)

---

## Part 5: First Transcription ✅

### Download Model
- [ ] Go to "Models" tab in app
- [ ] Find "whisper-base" model
- [ ] Click "Download" button
- [ ] Wait for download (~160MB)
- [ ] Status should show "Installed" ✅

### Test Transcription
- [ ] Prepare a short test video (< 1 minute)
- [ ] Go to "Home" tab
- [ ] Drag & drop video file
- [ ] Select model: "whisper-base"
- [ ] Select device: "CPU"
- [ ] Click "Start Transcription"
- [ ] Watch progress updates
- [ ] Wait for completion
- [ ] Verify transcription text appears
- [ ] ✅ SUCCESS!

---

## Troubleshooting 🔧

### If pip install fails
- [ ] Check you're using Python 3.10: `python --version`
- [ ] Upgrade pip: `python -m pip install --upgrade pip`
- [ ] Try clearing cache: `pip cache purge`
- [ ] Try installing one by one:
  ```bash
  pip install faster-whisper
  pip install pyannote.audio
  pip install torch
  ```

### If ffmpeg not found
- [ ] Make sure you restarted terminal after adding to PATH
- [ ] Check PATH: `echo %PATH%` (should contain `C:\ffmpeg\bin`)
- [ ] Try full path: `C:\ffmpeg\bin\ffmpeg.exe -version`

### If app won't start
- [ ] Check venv is activated: `(venv)` in prompt
- [ ] Check Node installed: `node --version`
- [ ] Check Bun installed: `bun --version`
- [ ] Try rebuilding: `bun run build`
- [ ] Check console for error messages

### If transcription fails
- [ ] Check model is downloaded: Models tab
- [ ] Check HuggingFace token: Settings tab
- [ ] Check file format: MP4, MP3, WAV work best
- [ ] Try shorter file first (< 30 seconds)
- [ ] Check console for error messages

---

## Quick Reference Commands 📝

```bash
# Python environment
py -3.10 --version                    # Check Python 3.10
py -3.10 -m venv ai-engine/venv       # Create venv
ai-engine\venv\Scripts\activate       # Activate venv
python --version                      # Verify active version

# Dependencies
cd ai-engine                          # Go to ai-engine dir
pip install -r requirements.txt       # Install dependencies
python check_environment.py           # Verify setup

# Testing
python test_integration.py            # Run integration tests
py -3.10 ai-engine/main.py --test    # Test AI engine

# App
bun run tauri:dev                     # Start development server
bun run build                         # Build frontend
cargo check --manifest-path=src-tauri/Cargo.toml  # Check Rust

# FFmpeg
ffmpeg -version                       # Verify FFmpeg
```

---

## Success Criteria 🎯

You'll know everything is working when:

- [ ] `python --version` shows `Python 3.10.11`
- [ ] `python ai-engine/check_environment.py` shows all ✅
- [ ] `python test_integration.py` shows 100% pass rate
- [ ] `ffmpeg -version` works
- [ ] `bun run tauri:dev` starts without errors
- [ ] You can download models in the app
- [ ] You successfully transcribe a test file
- [ ] Transcription results appear on screen

---

## Time Estimate ⏱️

| Task | Time | Done? |
|------|------|-------|
| Create venv | 2 min | ☐ |
| Install dependencies | 5 min | ☐ |
| Install FFmpeg | 3 min | ☐ |
| Configure HF token | 2 min | ☐ |
| Fix tsconfig.json | 1 min | ☐ |
| Run tests | 2 min | ☐ |
| Test transcription | 5 min | ☐ |
| **TOTAL** | **20 min** | ☐ |

---

## Support Links 📚

- **Main Docs**: `README.md`
- **Test Report**: `TEST_REPORT.md` (detailed results)
- **Quick Fix**: `QUICK_FIX_GUIDE.md` (step-by-step)
- **Test Summary**: `TEST_SUMMARY.md` (executive summary)
- **Architecture**: `CLAUDE.md` (project structure)

---

## Notes 📝

```
Current Python installations:
- Python 3.14.2 (C:\Python314\python.exe) - DON'T USE
- Python 3.10.11 (via py launcher) - USE THIS ✅

Virtual environment location:
- E:\Dev\Transcribe-video\ai-engine\venv\

Model cache location (default):
- E:\Dev\Transcribe-video\models\

Project structure:
- Frontend: src/ (React + TypeScript)
- Backend:  src-tauri/src/ (Rust)
- AI Engine: ai-engine/ (Python)
- Tests:    tests/
```

---

**Last Updated**: 2026-02-06
**For**: Transcribe Video v0.1.0
**Python Version**: 3.10.11 ✅
**Status**: Ready to Setup!
