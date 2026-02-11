# Quick Start: Install ffmpeg for Parakeet

## Windows (Recommended Methods)

### Method 1: Using winget (Easiest)
```powershell
winget install ffmpeg
```

### Method 2: Using Chocolatey
```powershell
choco install ffmpeg
```

### Method 3: Using Scoop
```powershell
scoop install ffmpeg
```

### Method 4: Manual Installation

1. **Download**:
   - Go to: https://www.gyan.dev/ffmpeg/builds/
   - Download: `ffmpeg-release-essentials.zip`

2. **Extract**:
   - Extract to: `C:\ffmpeg`

3. **Add to PATH**:
   ```powershell
   # Open PowerShell as Administrator and run:
   [System.Environment]::SetEnvironmentVariable('Path', $env:Path + ';C:\ffmpeg\bin', [System.EnvironmentVariableTarget]::User)
   ```

4. **Restart Terminal** (IMPORTANT!)

## Verify Installation

```bash
ffmpeg -version
```

Expected output:
```
ffmpeg version N-xxx ...
Copyright (c) 2000-2025 the FFmpeg developers
...
```

## Test Parakeet After ffmpeg Installation

```bash
cd E:\Dev\Transcribe-video\ai-engine
venv_parakeet\Scripts\activate
python test_parakeet.py
```

## Troubleshooting

### "ffmpeg not found" after installation
1. Close ALL terminal windows
2. Reopen terminal
3. Try `ffmpeg -version` again

### "Permission denied"
Run terminal/cmd as Administrator

### ffmpeg works in terminal but not in Python
This is a PATH issue. Make sure to:
1. Restart your IDE/editor
2. Or use full path in code (not recommended)

## Alternative: Use Static Binary in Project

If you can't install ffmpeg system-wide, download a static binary:

1. Download: https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
2. Extract `ffmpeg.exe` to: `E:\Dev\Transcribe-video\ai-engine\bin\`
3. Update `parakeet.py` line 105:
   ```python
   ffmpeg_path = r"E:\Dev\Transcribe-video\ai-engine\bin\ffmpeg.exe"
   subprocess.run([ffmpeg_path, '-i', file_path, ...], ...)
   ```

---
**Once ffmpeg is installed, Parakeet transcription will work!**
