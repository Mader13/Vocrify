# Diarization End-to-End Test Plan

## Test Environment
- Date: 2025-02-06
- Platform: Windows
- Python Version: 3.8-3.12 (NOT 3.13+)
- Node Version: Current

## Test Categories

### 1. Python Engine Tests

#### 1.1 PyAnnote Provider
- [ ] Verify pyannote loads with HF token
- [ ] Verify clear error message when token is missing
- [ ] Test diarization produces speaker labels
- [ ] Verify memory cleanup after diarization

#### 1.2 Sherpa-ONNX Provider
- [ ] Verify sherpa-onnx works WITHOUT HF token
- [ ] Test diarization produces speaker labels
- [ ] Verify model downloads correctly from GitHub
- [ ] Verify memory cleanup after diarization

### 2. Rust Backend Tests

#### 2.1 Token Passing
- [ ] Verify HF token is retrieved from app store
- [ ] Verify token is passed as environment variable to Python
- [ ] Verify token is passed via command-line to Python
- [ ] Test token rotation (new token replaces old)

#### 2.2 Command-Line Arguments
- [ ] Verify `--diarization` flag is added when enabled
- [ ] Verify `--diarization-provider` is passed correctly
- [ ] Verify `--num-speakers` is passed correctly
- [ ] Test with invalid provider value

#### 2.3 Environment Variables
- [ ] Verify HF_TOKEN is set in child process
- [ ] Verify HUGGINGFACE_HUB_HOME is set correctly
- [ ] Test environment variable cleanup after process

### 3. Frontend Tests

#### 3.1 UI Components
- [ ] DiarizationOptionsModal renders correctly
- [ ] Provider dropdown shows only installed providers
- [ ] Toggle enables/disables provider selection
- [ ] Error message shows when no diarization model installed
- [ ] "None" provider is not selectable when diarization enabled

#### 3.2 State Management
- [ ] `enableDiarization` state updates correctly
- [ ] `diarizationProvider` state persists to localStorage
- [ ] Available providers calculated from installed models
- [ ] Last used provider is remembered

#### 3.3 Integration with Settings
- [ ] Settings load correctly on startup
- [ ] Settings save correctly when changed
- [ ] Defaults apply when no settings exist
- [ ] Provider selection updates modelsStore

### 4. Waveform Display Tests

#### 4.1 Speaker-Based Coloring
- [ ] Waveform shows different colors for different speakers
- [ ] Color switching works between "segments" and "speakers" modes
- [ ] Colors are consistent for the same speaker across segments

#### 4.2 Speaker Badges
- [ ] Speaker badges appear on transcription segments
- [ ] Badge color matches waveform color
- [ ] Badge text shows speaker ID (e.g., "SPEAKER_00")
- [ ] Badges are hidden when diarization is disabled

### 5. End-to-End Integration Tests

#### 5.1 Complete Transcription Flow
- [ ] Select file with multiple speakers
- [ ] Enable diarization with sherpa-onnx (no token needed)
- [ ] Start transcription
- [ ] Verify speaker labels appear in results
- [ ] Verify waveform shows speaker colors
- [ ] Export transcription and verify speaker info included

#### 5.2 PyAnnote Flow (with token)
- [ ] Set valid HF token
- [ ] Enable diarization with pyannote
- [ ] Start transcription
- [ ] Verify pyannote loads successfully
- [ ] Verify speaker labels appear
- [ ] Verify results quality

#### 5.3 Error Handling
- [ ] Try pyannote without token (should show clear error)
- [ ] Try diarization with no models installed (should show clear error)
- [ ] Try invalid num_speakers value (should handle gracefully)
- [ ] Cancel transcription during diarization (should cleanup)

### 6. Performance Tests

#### 6.1 Memory Usage
- [ ] Test memory usage before diarization
- [ ] Test memory usage during diarization
- [ ] Verify memory is freed after diarization completes
- [ ] Test with long audio file (>10 minutes)

#### 6.2 Processing Speed
- [ ] Measure diarization time for 1-minute audio
- [ ] Measure diarization time for 5-minute audio
- [ ] Verify progress updates are emitted regularly

## Test Data

### Sample Audio Files
- Short sample (30s, 2 speakers)
- Medium sample (5min, 3 speakers)
- Long sample (10min, 2-4 speakers)

### Test Cases

### Test Case 1: Sherpa-ONNX Basic Flow
```typescript
const test = {
  name: "Sherpa-ONNX Basic Flow",
  setup: () => {
    // Install sherpa-onnx-diarization model
    // NO HuggingFace token needed
  },
  steps: [
    "Drop audio file",
    "Enable diarization",
    "Select sherpa-onnx provider",
    "Start transcription",
    "Wait for completion",
    "Verify speaker labels present",
    "Verify waveform colored by speaker",
  ],
  expected: {
    speakerLabels: true,
    waveformColors: true,
    noErrors: true,
  },
};
```

### Test Case 2: PyAnnote with Token
```typescript
const test = {
  name: "PyAnnote with Token",
  setup: () => {
    // Set valid HF token
    // Install pyannote-diarization model
  },
  steps: [
    "Set HF token in settings",
    "Verify token accepted",
    "Drop audio file",
    "Enable diarization with pyannote",
    "Start transcription",
    "Wait for completion",
    "Verify speaker labels present",
  ],
  expected: {
    tokenUsed: true,
    speakerLabels: true,
    noAuthErrors: true,
  },
};
```

### Test Case 3: Missing Token Error
```typescript
const test = {
  name: "Missing Token Error",
  setup: () => {
    // Clear HF token
    // Ensure pyannote model is installed
  },
  steps: [
    "Clear HF token",
    "Drop audio file",
    "Enable diarization with pyannote",
    "Start transcription",
    "Verify error message is clear",
  ],
  expected: {
    errorShown: true,
    errorMessage: "HuggingFace token required",
    gracefulFailure: true,
  },
};
```

## Success Criteria

- All tests pass
- No memory leaks
- Clear error messages for all failure modes
- Speaker labels appear correctly in results
- Waveform colors match speakers
- Export includes speaker information
- Both providers (pyannote and sherpa-onnx) work correctly

## Known Issues (from swarming)

1. Sherpa-ONNX diarization was not integrated with ModelFactory
2. No HuggingFace token retrieval in Rust backend
3. Frontend diarization provider handling incomplete
4. No waveform speaker coloring
5. No speaker badges in transcription view

## Test Execution Status

- [ ] Test suite created
- [ ] Tests executed
- [ ] Results documented
- [ ] Issues reported
- [ ] Fixes verified
