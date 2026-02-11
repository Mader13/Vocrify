# Quick Fix Guide - Transcribe Video

This guide will help you fix the critical issues identified in the test report and get your transcription app working in about 45 minutes.

---

## Critical Issues Summary

❌ Python 3.14.2 installed (need 3.12)
❌ Missing ML dependencies (faster-whisper, pyannote.audio)
❌ FFmpeg not installed
❌ HuggingFace token not configured

---

## Step 1: Install Python 3.12 (10 minutes)

### Download & Install

1. **Download Python 3.12**:
   - Go to: https://www.python.org/downloads/
   - Download: Python 3.12.x (latest 3.12 release)
   - Choose: "Windows installer (64-bit)"

2. **Install with Important Settings**:
   - ✅ Check "Add Python 3.12 to PATH"
   - ✅ Check "Install for all users" (optional)
   - Click "Install Now"

3. **Verify Installation**:
   ```bash
   py -3.12 --version
   # Should output: Python 3.12.x
   ```

---

## Step 2: Setup Virtual Environment (5 minutes)

### Create Clean Virtual Environment

1. **Open Command Prompt** in the project root:
   ```bash
   cd E:\Dev\Transcribe-video
   ```

2. **Remove Old Virtual Environment** (if exists):
   ```bash
   # Remove old venv if it exists
   rmdir /s /q ai-engine\venv
   ```

3. **Create New Virtual Environment**:
   ```bash
   py -3.12 -m venv ai-engine\venv
   ```

4. **Activate Virtual Environment**:
   ```bash
   # Windows Command Prompt
   ai-engine\venv\Scripts\activate

   # Windows PowerShell
   ai-engine\venv\Scripts\Activate.ps1

   # Git Bash / MSYS2
   source ai-engine/venv/Scripts/activate
   ```

5. **Verify Activation**:
   ```bash
   # You should see (venv) in your prompt
   python --version
   # Should output: Python 3.12.x
   ```

---

## Step 3: Install Python Dependencies (10 minutes)

### Install Required Packages

1. **Stay in Project Root** with venv activated:
   ```bash
   # Make sure you see (venv) in prompt
   cd ai-engine
   ```

2. **Upgrade pip**:
   ```bash
   python -m pip install --upgrade pip
   ```

3. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Verify Installation**:
   ```bash
   python check_environment.py
   ```

**Expected Output** (should show all ✅):
```
✅ Python version is compatible
✅ Virtual environment active
✅ faster_whisper installed
✅ pyannote.audio installed
✅ All dependencies OK
```

**If Errors Occur**:

- **Network timeout**: Use mirror
  ```bash
  pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  ```

- **Build errors**: Install Visual Studio Build Tools
  - Download: https://visualstudio.microsoft.com/downloads/
  - Install "Build Tools for Visual Studio 2022"
  - Select "C++ build tools"

---

## Step 4: Install FFmpeg (5 minutes)

### Windows Installation

1. **Download FFmpeg**:
   - Go to: https://www.gyan.dev/ffmpeg/builds/
   - Download: `ffmpeg-release-essentials.zip`

2. **Extract FFmpeg**:
   - Extract to: `C:\ffmpeg`
   - You should have: `C:\ffmpeg\bin\ffmpeg.exe`

3. **Add to PATH**:
   ```bash
   # Method 1: Command (restart terminal after)
   setx PATH "%PATH%;C:\ffmpeg\bin"

   # Method 2: Manual
   # 1. Press Win + X, select "System"
   # 2. Click "Advanced system settings"
   # 3. Click "Environment Variables"
   # 4. Under "System variables", find "Path"
   # 5. Click "Edit", then "New"
   # 6. Add: C:\ffmpeg\bin
   # 7. Click OK on all dialogs
   ```

4. **Verify Installation**:
   ```bash
   # Restart terminal first!
   ffmpeg -version
   # Should show version info
   ```

---

## Step 5: Configure HuggingFace Token (5 minutes)

### For PyAnnote Speaker Diarization

1. **Create HuggingFace Account** (if needed):
   - Go to: https://huggingface.co/join
   - Sign up for free account

2. **Get Access Token**:
   - Go to: https://huggingface.co/settings/tokens
   - Click "New token"
   - Type: "Read"
   - Name: "transcribe-video"
   - Click "Generate token"
   - **Copy the token** (starts with `hf_...`)

3. **Accept Model Licenses**:
   - PyAnnote Segmentation: https://huggingface.co/pyannote/segmentation-3.0
     - Click "Agree and access repository"
   - PyAnnote Embedding: https://huggingface.co/pyannote/embedding
     - Click "Agree and access repository"

4. **Set Token in App**:
   - Start the app: `bun run tauri:dev`
   - Go to "Settings" tab
   - Paste token in "HuggingFace Token" field
   - Click "Save"

**OR** set via environment variable:
```bash
# Windows Command Prompt
set HUGGINGFACE_ACCESS_TOKEN=hf_your_token_here

# Windows PowerShell
$env:HUGGINGFACE_ACCESS_TOKEN="hf_your_token_here"
```

---

## Step 6: Fix tsconfig.json (2 minutes)

### Remove Trailing Commas

1. **Open `tsconfig.json`** in text editor

2. **Look for**:
   ```json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "ESNext",  // ← Remove this comma if it's the last item
     }
   }
   ```

3. **Fix** (remove trailing comma):
   ```json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "ESNext"
     }
   }
   ```

4. **Validate**:
   ```bash
   bun run build
   # Should build without tsconfig errors
   ```

---

## Step 7: Verify Everything Works (10 minutes)

### Run Integration Tests

1. **Make Sure Virtual Environment is Active**:
   ```bash
   ai-engine\venv\Scripts\activate
   ```

2. **Run Test Suite**:
   ```bash
   python test_integration.py
   ```

**Expected Output**:
```
✓ Python Version Compatibility
✓ AI Engine Test Mode
✓ AI Engine Dependencies
✓ Event Emission Format
✓ Project Structure
✓ Rust Compilation
✓ Frontend Build
✓ Configuration Files
✓ Documentation

Overall Verdict: Integration tests PASSED (100% pass rate)
```

3. **Test AI Engine**:
   ```bash
   cd ai-engine
   python main.py --test
   ```

**Expected Output**:
```json
{"type": "hello", "message": "Hello from AI Engine!", "version": "0.1.0", "python_version": "3.12.x"}
```

---

## Step 8: Test Transcription (5 minutes)

### Start the App

1. **Start Full Application**:
   ```bash
   # From project root, with venv activated
   bun run tauri:dev
   ```

2. **Download a Model** (first time only):
   - Open app in browser
   - Go to "Models" tab
   - Click "Download" next to "whisper-base"
   - Wait for download to complete (~160MB)

3. **Test Transcription**:
   - Find a short video/audio file (< 1 minute for testing)
   - Drag & drop into the app
   - Click "Start Transcription"
   - Wait for processing
   - Verify transcription appears

---

## Troubleshooting

### Common Issues

#### Issue: "py -3.12 not found"

**Solution**:
- Make sure you installed Python 3.12
- Restart your terminal
- Try: `python3.12 --version`

#### Issue: "Virtual environment activation fails"

**Solution (PowerShell)**:
```powershell
# Allow running scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then activate
ai-engine\venv\Scripts\Activate.ps1
```

#### Issue: "pip install fails with build errors"

**Solution**:
- Install Visual Studio Build Tools
- Use pre-built wheels:
  ```bash
  pip install --only-binary :all: faster-whisper
  ```

#### Issue: "ffmpeg not found"

**Solution**:
- Make sure you added `C:\ffmpeg\bin` to PATH
- **Restart your terminal** (this is important!)
- Verify: `ffmpeg -version`

#### Issue: "HuggingFace token error"

**Solution**:
- Make sure you accepted the model licenses
- Verify token starts with `hf_`
- Try setting via app Settings instead of env var

#### Issue: "Transcription is very slow"

**Solution**:
- This is normal on CPU
- For GPU acceleration, you need:
  - NVIDIA GPU
  - CUDA Toolkit installed
  - PyTorch with CUDA:
    ```bash
    pip uninstall torch
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
    ```

---

## Verification Checklist

Before considering the setup complete, verify:

- [ ] Python 3.12.x installed (`py -3.12 --version`)
- [ ] Virtual environment created and active (`(venv)` in prompt)
- [ ] All dependencies installed (`python check_environment.py` shows all ✅)
- [ ] FFmpeg installed and in PATH (`ffmpeg -version`)
- [ ] HuggingFace token configured in app settings
- [ ] Integration tests pass (`python test_integration.py`)
- [ ] AI engine test works (`python ai-engine/main.py --test`)
- [ ] App starts without errors (`bun run tauri:dev`)
- [ ] Can download models in the app
- [ ] Successfully transcribed a test file

---

## Next Steps

Once everything is working:

1. **Download Larger Models** (optional):
   - `whisper-small` (~500MB) - Better accuracy
   - `whisper-medium` (~1.6GB) - Even better
   - `whisper-large-v3` (~3GB) - Best accuracy

2. **Enable GPU** (if you have NVIDIA GPU):
   - Install CUDA Toolkit
   - Reinstall PyTorch with CUDA
   - Select "CUDA" device in app

3. **Enable Speaker Diarization**:
   - Configure HuggingFace token
   - Select "pyannote" as diarization provider
   - Transcribe with speaker labels

---

## Time Estimate Summary

| Step | Task | Time |
|------|------|------|
| 1 | Install Python 3.12 | 10 min |
| 2 | Create virtual environment | 5 min |
| 3 | Install dependencies | 10 min |
| 4 | Install FFmpeg | 5 min |
| 5 | Configure HuggingFace | 5 min |
| 6 | Fix tsconfig.json | 2 min |
| 7 | Verify with tests | 10 min |
| 8 | Test transcription | 5 min |
| **Total** | **Complete Setup** | **~52 min** |

---

## Need Help?

If you encounter issues not covered here:

1. Check the main documentation:
   - `README.md` - Project overview
   - `TEST_REPORT.md` - Detailed test results
   - `CLAUDE.md` - Project architecture

2. Check Python environment:
   ```bash
   python ai-engine/check_environment.py
   ```

3. Run diagnostic tests:
   ```bash
   python test_integration.py
   ```

4. Check error logs:
   - Tauri dev server output
   - Browser console (F12)
   - Python stderr output

---

**Last Updated**: 2026-02-06
**For**: Transcribe Video v0.1.0
