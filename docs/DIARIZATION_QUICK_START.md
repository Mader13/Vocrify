# Diarization Quick Start Guide

## For Users: Getting Diarization Working

### Step 1: Get HuggingFace Token (Required for PyAnnote)

1. Go to https://huggingface.co/settings/tokens
2. Click "New token"
3. Give it a name (e.g., "Transcribe Video App")
4. Select "Read" permissions (sufficient for diarization models)
5. Copy the token (starts with `hf_`)

### Step 2: Accept User Agreements

Visit and accept the user agreement for each model:
- https://huggingface.co/pyannote/speaker-diarization-3.1
- https://huggingface.co/pyannote/segmentation-3.0
- https://huggingface.co/pyannote/embedding

### Step 3: Configure Token in App

1. Open the Transcribe Video application
2. Go to Settings → HuggingFace
3. Paste your token
4. Click "Save"

### Step 4: Use Diarization

1. Drop a video file into the app
2. Enable "Speaker Diarization"
3. Choose provider:
   - **PyAnnote** (recommended): Better quality, requires token
   - **Sherpa-ONNX**: Good quality, no token required
4. Click "Start Transcription"

## For Developers: Integration Steps

### 1. Update Rust Backend to Pass Token

In your transcription command construction:

```rust
// Read token from app settings
let hf_token = settings.get_huggingface_token();

// Build command JSON
let mut command = json::object::Object::default();
command.insert("type".to_string(), json::!("transcribe"));
command.insert("file".to_string(), json!(file_path));
command.insert("model".to_string(), json!(model_name));
command.insert("device".to_string(), json!(device));
command.insert("language".to_string(), json!(language));
command.insert("diarization".to_string(), json!(enable_diarization));
command.insert("taskId".to_string(), json!(task_id));

// NEW: Add diarization-specific parameters
if enable_diarization {
    command.insert("huggingfaceToken".to_string(), json!(hf_token));
    command.insert("diarization_provider".to_string(), json!(provider));
    if provider == "sherpa-onnx" {
        command.insert("num_speakers".to_string(), json!(num_speakers));
    }
}
```

### 2. Handle New Error Messages

The Python engine now emits these errors:

**Missing Token**:
```json
{
  "type": "error",
  "error": "HuggingFace token is required for PyAnnote diarization.\n..."
}
```
**Action**: Prompt user to add token in settings

**Invalid Provider**:
```json
{
  "type": "error",
  "error": "Diarization is enabled but diarization_provider is set to 'none'..."
}
```
**Action**: Show error, don't allow diarization with "none" provider

**Authentication Failed**:
```json
{
  "type": "error",
  "error": "Failed to load PyAnnote model: ...\nYou haven't accepted the user agreement..."
}
```
**Action**: Show error with link to accept user agreements

### 3. Debug Messages (for development)

New debug messages appear on stderr:
```json
{"type": "debug", "message": "Loading PyAnnote pipeline with HuggingFace token"}
{"type": "debug", "message": "PyAnnote pipeline loaded successfully"}
{"type": "debug", "message": "Starting diarization with provider: pyannote"}
{"type": "debug", "message": "Diarization pipeline loaded, processing audio file"}
```

## Testing Your Integration

### Test 1: Basic Diarization (PyAnnote)
```json
{
  "type": "transcribe",
  "file": "/path/to/test.mp4",
  "model": "whisper-base",
  "device": "cpu",
  "language": "auto",
  "diarization": true,
  "diarization_provider": "pyannote",
  "huggingfaceToken": "hf_your_token_here",
  "taskId": "test-1"
}
```

**Expected Result**:
- Progress updates at 85%, 95%
- Segments with `speaker` field (e.g., "SPEAKER_00", "SPEAKER_01")

### Test 2: Sherpa-ONNX (No Token)
```json
{
  "type": "transcribe",
  "file": "/path/to/test.mp4",
  "model": "whisper-base",
  "device": "cpu",
  "language": "auto",
  "diarization": true,
  "diarization_provider": "sherpa-onnx",
  "num_speakers": 2,
  "taskId": "test-2"
}
```

**Expected Result**:
- Same as PyAnnote but without needing token
- May have different speaker labels

### Test 3: Missing Token (Should Fail)
```json
{
  "type": "transcribe",
  "file": "/path/to/test.mp4",
  "model": "whisper-base",
  "device": "cpu",
  "language": "auto",
  "diarization": true,
  "diarization_provider": "pyannote",
  "taskId": "test-3"
}
```

**Expected Result**:
- Error response with setup instructions

### Test 4: Invalid Provider (Should Fail)
```json
{
  "type": "transcribe",
  "file": "/path/to/test.mp4",
  "model": "whisper-base",
  "device": "cpu",
  "language": "auto",
  "diarization": true,
  "diarization_provider": "none",
  "taskId": "test-4"
}
```

**Expected Result**:
- Error response about invalid provider

## Troubleshooting

### Issue: "HuggingFace token is required"
**Solution**:
1. Generate token at https://huggingface.co/settings/tokens
2. Add token in app settings
3. Make sure token is passed to Python engine

### Issue: "Failed to load PyAnnote model... unauthorized"
**Solution**:
1. Verify token is valid (not expired)
2. Accept user agreements for all 3 PyAnnote models
3. Check token has "Read" permissions

### Issue: Diarization doesn't start (no output)
**Solution**:
1. Check stderr for debug messages
2. Verify provider is not "none"
3. Ensure token is set for PyAnnote
4. Check file path exists

### Issue: All speakers labeled as "SPEAKER_00"
**Solution**:
1. Audio may have only one speaker
2. Try different provider (PyAnnote vs Sherpa-ONNX)
3. Check audio quality (background noise, overlapping speech)

## Performance Tips

### For CPU Users:
- Use "sherpa-onnx" provider (faster on CPU)
- Smaller model (whisper-base or whisper-small)
- Limit audio length if possible

### For GPU Users:
- Use "pyannote" provider (better quality)
- Larger model (whisper-medium or whisper-large-v3)
- Both transcription and diarization can use GPU

## File Locations

### Modified Files:
- `ai-engine/main.py` - Token handling and validation
- `ai-engine/models/whisper.py` - PyAnnote loading with token

### Documentation:
- `DIARIZATION_FIX.md` - Detailed technical documentation
- `DIARIZATION_CHANGES_SUMMARY.md` - Complete change summary
- `DIARIZATION_QUICK_START.md` - This file

## Support

For issues or questions:
1. Check stderr debug messages
2. Review error messages (they include solutions)
3. Verify token and user agreements
4. Test with different providers

## Key Takeaways

✅ PyAnnote requires HuggingFace token (better quality)
✅ Sherpa-ONNX doesn't require token (good alternative)
✅ Clear error messages for all failure modes
✅ Debug logging on stderr for troubleshooting
✅ Provider validation prevents invalid configurations
