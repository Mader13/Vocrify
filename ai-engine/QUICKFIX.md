# Quick Fix for Python Dependencies

## The Problem

❌ **You have Python 3.14.2, but need Python 3.8-3.12**

The dependencies (`faster-whisper`, `pyannote.audio`) don't support Python 3.13+.

## The Solution (2 minutes)

### Option 1: Automated Fix (Windows)

```bash
cd E:\Dev\Transcribe-video\ai-engine
fix_environment.bat
```

That's it! The script will:
1. Check for Python 3.12
2. Create a clean virtual environment
3. Install all dependencies
4. Test everything works

### Option 2: Manual Fix

```bash
# 1. Install Python 3.12 from: https://www.python.org/downloads/
#    (Make sure to check "Add to PATH" during installation)

# 2. Open Command Prompt and run:
cd E:\Dev\Transcribe-video\ai-engine

# 3. Remove old venv (if exists)
rmdir /s /q venv

# 4. Create venv with Python 3.12
py -3.12 -m venv venv

# 5. Activate venv
venv\Scripts\activate

# 6. Install dependencies
pip install -r requirements.txt

# 7. Test it works
python main.py --test
```

## Verify It Works

```bash
# Check environment
python check_environment.py

# Should see:
# ✅ Python version is COMPATIBLE (3.8-3.12)
# ✅ All dependencies installed
```

## What If I Don't Have Python 3.12?

1. Download from https://www.python.org/downloads/
2. Install "Windows installer (64-bit)" for Python 3.12.x
3. Check "Add Python 3.12 to PATH" during installation
4. Re-run the fix script

## Need More Help?

- Full guide: `PYTHON_SETUP.md`
- Diagnostics: `python check_environment.py`
- Summary: `DEPENDENCY_FIX_SUMMARY.md`

## Key Files

- `fix_environment.bat` - Automated fix script
- `check_environment.py` - Environment diagnostics
- `requirements.txt` - Fixed dependencies
- `PYTHON_SETUP.md` - Detailed setup guide
