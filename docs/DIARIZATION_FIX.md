# Diarization Implementation Fix

## Summary
Fixed the diarization feature in the Python AI engine to properly handle HuggingFace tokens and provider validation.

## Issues Fixed

### 1. HuggingFace Token Not Being Passed
**Problem**: The pyannote models require a HuggingFace token, but it wasn't being passed from the Rust backend to Python.

**Solution**:
- Added `huggingfaceToken` parameter to the transcribe command schema in `main.py`
- The token is now read from command parameters and set as `HF_TOKEN` environment variable
- The pyannote pipeline reads the token from environment variables

### 2. Missing Diarization Provider Validation
**Problem**: When `diarization_provider` is "none" but `enable_diarization` is true, the code would fail without a clear error message.

**Solution**:
- Added validation in `main.py` server mode (line 1805-1810)
- Emits clear error message when diarization is enabled but provider is "none"
- Prevents confusing failures later in the process

### 3. PyAnnote Token Handling
**Problem**: The pyannote pipeline wasn't using the token properly, leading to authentication failures.

**Solution**:
- Updated `_load_pyannote_diarization()` in `whisper.py` to:
  - Read token from environment variables (`HF_TOKEN` or `HUGGINGFACE_ACCESS_TOKEN`)
  - Pass token to `Pipeline.from_pretrained()` via `use_auth_token` parameter
  - Provide clear error messages when token is missing or invalid
  - Include instructions for getting and setting up the token

### 4. Better Debug Logging
**Problem**: When diarization failed, there was no output to help diagnose the issue.

**Solution**:
- Added debug logging in `whisper.py` to track:
  - When diarization starts (with provider name)
  - When pipeline loads
  - Success/failure of token authentication
- All debug messages go to stderr to avoid interfering with JSON IPC

## Files Modified

### 1. `ai-engine/main.py`
- **Line 88-101**: Added `huggingfaceToken`, `diarization_provider`, and `num_speakers` to command schema
- **Line 1776-1825**: Updated transcribe command handler to:
  - Extract HuggingFace token from command
  - Set token as environment variable
  - Validate diarization provider
  - Pass provider to model factory

### 2. `ai-engine/models/whisper.py`
- **Line 14**: Added `import json` for debug logging
- **Line 103-175**: Rewrote `_load_pyannote_diarization()` to:
  - Check for token in environment variables
  - Provide detailed error messages
  - Pass token to pipeline
  - Add debug logging
- **Line 232-250**: Updated `diarize()` method to:
  - Add debug logging for diarization startup
  - Track when pipeline loads

## Usage

### For Users
1. **Set HuggingFace Token**:
   - Go to https://huggingface.co/settings/tokens
   - Create a new access token (read permissions sufficient)
   - Accept user agreements for:
     - https://huggingface.co/pyannote/speaker-diarization-3.1
     - https://huggingface.co/pyannote/segmentation-3.0
     - https://huggingface.co/pyannote/embedding
   - Add token in application settings

2. **Enable Diarization**:
   - Select "Enable Speaker Diarization" in the UI
   - Choose provider: "pyannote" (requires token) or "sherpa-onnx" (no token needed)
   - Start transcription

### For Developers
The transcribe command now accepts these additional parameters:
```json
{
  "type": "transcribe",
  "file": "/path/to/video.mp4",
  "model": "whisper-base",
  "device": "cpu",
  "language": "auto",
  "diarization": true,
  "diarization_provider": "pyannote",
  "huggingfaceToken": "hf_xxxxx",
  "taskId": "task-123"
}
```

## Error Messages

### Missing Token
```
HuggingFace token is required for PyAnnote diarization.
Please set the HF_TOKEN or HUGGINGFACE_ACCESS_TOKEN environment variable,
or provide a HuggingFace token in the application settings.

To get a token:
1. Go to https://huggingface.co/settings/tokens
2. Create a new access token (read permissions are sufficient)
3. Accept the user agreement for pyannote models:
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
   - https://huggingface.co/pyannote/embedding
4. Add the token in the application settings
```

### Invalid Provider
```
Diarization is enabled but diarization_provider is set to 'none'.
Please specify 'pyannote' or 'sherpa-onnx'
```

### Authentication Failed
```
Failed to load PyAnnote model: ...

This usually means:
1. You haven't accepted the user agreement for PyAnnote models
2. Your HuggingFace token is invalid or expired

Please visit these URLs and accept the user agreements:
- https://huggingface.co/pyannote/speaker-diarization-3.1
- https://huggingface.co/pyannote/segmentation-3.0
- https://huggingface.co/pyannote/embedding

Then update your HuggingFace token in the application settings.
```

## Testing

### Test Diarization with PyAnnote
```bash
cd ai-engine
export HF_TOKEN="your_token_here"
python main.py --server
# Then send: {"type":"transcribe","file":"test.mp4","diarization":true,"diarization_provider":"pyannote"}
```

### Test Diarization with Sherpa-ONNX
```bash
cd ai-engine
python main.py --server
# Then send: {"type":"transcribe","file":"test.mp4","diarization":true,"diarization_provider":"sherpa-onnx"}
```

## Notes
- All debug logging goes to stderr to keep stdout clean for JSON IPC
- Token is never logged or exposed in error messages
- Provider validation happens early to fail fast with clear messages
- PyAnnote is the default provider (better quality, requires token)
- Sherpa-ONNX is alternative (no token required, different tradeoffs)
