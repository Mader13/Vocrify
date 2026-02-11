# Test Strategy for Transcription System

## Test Structure

```
tests/
├── unit/
│   ├── __init__.py
│   ├── test_base_model.py
│   ├── test_model_factory.py
│   ├── test_whisper_model.py
│   ├── test_parakeet_model.py
│   ├── test_diarization.py
│   ├── test_server_mode.py
│   ├── test_progress_emitter.py
│   ├── test_download_manager.py
│   └── mocks/
│       ├── mock_whisper.py
│       ├── mock_diarization.py
│       └── mock_downloads.py
├── integration/
│   ├── __init__.py
│   ├── test_rust_python_communication.py
│   ├── test_model_download_flow.py
│   ├── test_json_rpc_protocol.py
│   ├── test_error_recovery.py
│   └── fixtures/
│       ├── sample_audio.wav
│       ├── sample_video.mp4
│       ├── invalid_file.txt
│       └── corrupt_file.mp3
├── e2e/
│   ├── __init__.py
│   ├── test_full_transcription_workflow.py
│   ├── test_concurrent_tasks.py
│   ├── test_progress_reporting.py
│   ├── test_cancellation_flow.py
│   └── performance/
│       ├── test_large_file_handling.py
│       ├── test_memory_usage.py
│       └── test_gpu_fallback.py
└── edge_cases/
    ├── __init__.py
    ├── test_invalid_inputs.py
    ├── test_missing_models.py
    ├── test_network_failures.py
    ├── test_disk_space.py
    ├── test_permission_errors.py
    ├── test_audio_formats.py
    └── test_system_limits.py
```

## Test Cases

### Unit Tests (Python)

#### Test: Base Model Interface
- **Given**: A model instance implementing BaseModel
- **When**: Calling transcribe() method
- **Then**: Returns list of segment dictionaries with required keys
- **Mock**: Mock model returning test segments

#### Test: Model Factory Initialization
- **Given**: Valid model names from registry
- **When**: Creating model instances via factory
- **Then**: Returns correct model type with proper configuration
- **Mock**: Mock model classes for whisper and parakeet

#### Test: Whisper Model Loading
- **Given**: Model size parameter and device specification
- **When**: Loading Whisper model
- **Then**: Model loads on specified device with correct size
- **Mock**: Mock faster-whisper library

#### Test: Parakeet Model GPU Validation
- **Given**: Device specification
- **When**: Creating Parakeet model
- **Then**: Validates GPU availability for NVIDIA models
- **Mock**: Mock torch CUDA availability

#### Test: Diarization Provider Selection
- **Given**: Model name and provider preference
- **When**: Creating model with diarization enabled
- **Then**: Selects correct diarization implementation
- **Mock**: Mock pyannote and sherpa providers

#### Test: Server Mode JSON Processing
- **Given**: Valid JSON command on stdin
- **When**: Processing in server mode
- **Then: Returns JSON response with proper structure
- **Mock**: Mock stdin and stdout

#### Test: Progress Emitter Output
- **Given**: Progress stage, percentage, and message
- **When**: Emitting progress update
- **Then: Outputs valid JSON to stdout
- **Mock**: stdout capture

#### Test: Download Cancellation
- **Given**: Active download operation
- **When**: Sending cancellation signal
- **Then: Stops download and cleans up
- **Mock**: Mock download with cancellation flag

### Integration Tests

#### Test: Rust-Python Communication
- **Given**: Tauri app running with Python subprocess
- **When**: Sending JSON RPC command
- **Then: Receives proper JSON response
- **Mock**: Mock Python process with server mode

#### Test: Model Download Flow
- **Given**: Model repository URL and cache directory
- **When: Downloading model via huggingface_hub
- **Then: Stores model files and emits progress
- **Mock: Mock huggingface_hub with fake downloads

#### Test: JSON RPC Protocol Error Handling
- **Given**: Invalid JSON command
- **When**: Processing malformed input
- **Then: Returns error response without crashing
- **Mock**: Various malformed JSON inputs

#### Test: Process Recovery After Crash
- **Given**: Python process crashes during transcription
- **When: Rust application detects crash
- **Then: Re-spawns process and reports error
- **Mock**: Mock process termination

#### Test: File Cleanup on Failure
- **Given: Transcription fails midway
- **When: Process encounters error
- **Then: Cleans up temporary files
- **Mock**: Simulated failure scenarios

### E2E Workflow Tests

#### Test: Full Transcription Workflow
- **Given**: Valid audio/video file and model specification
- **When: Running complete transcription pipeline
- **Then: Returns accurate transcription with timestamps
- **File**: tests/e2e/fixtures/sample_audio.wav

#### Test: Model Download and Usage
- **Given**: Cache directory and model name
- **When: Downloading and using model
- **Then: Model downloads successfully and transcribes
- **File**: tests/e2e/fixtures/sample_video.mp4

#### Test: Progress Reporting End-to-End
- **Given**: Long audio file (>5 minutes)
- **When: Running with progress monitoring
- **Then: Reports progress at regular intervals
- **File**: tests/e2e/fixtures/long_audio.wav

#### Test: Cancellation During Transcription
- **Given**: Ongoing transcription task
- **When: Sending cancellation command
- **Then: Stops gracefully and reports status
- **File**: tests/e2e/fixtures/medium_audio.wav

#### Test: Concurrent Task Management
- **Given**: Multiple audio files
- **When: Submitting concurrent transcription tasks
- **Then: Processes all tasks without conflicts
- **Files**: Multiple sample files in parallel

### Edge Case Tests

#### Test: Invalid File Inputs
- **Given**: Non-existent file path
- **When: Attempting to transcribe
- **Then: Returns specific error about file not found
- **File**: tests/integration/fixtures/invalid_file.txt

#### Test: Missing Model Scenario
- **Given**: Model cache is empty
- **When: Requesting model download
- **Then: Downloads model successfully
- **Mock**: Empty cache directory

#### Test: Network Interruption
- **Given**: Active model download
- **When: Simulating network timeout
- **Then: Retries with exponential backoff
- **Mock**: Network interruption during download

#### Test: GPU Memory Exhaustion
- **Given**: CUDA device with limited memory
- **When: Loading large model
- **Then: Falls back to CPU gracefully
- **Mock**: Mock torch.cuda memory error

#### Test: Large File Handling
- **Given**: Audio file >2GB
- **When: Processing large file
- **Then: Processes in chunks and manages memory
- **File**: tests/e2e/fixtures/large_audio.wav

#### Test: Disk Space Exhaustion
- **Given**: Nearly full disk
- **When: Attempting to download model
- **Then: Detects and reports disk space error
- **Mock**: Mock disk space checks

#### Test: Permission Denied Errors
- **Given**: Read-only cache directory
- **When: Attempting to write model
- **Then: Reports permission error gracefully
- **Mock**: Mock file permission errors

#### Test: Corrupted Model Files
- **Given**: Model files with missing parts
- **When: Loading model
- **Then: Detects corruption and redownloads
- **File**: tests/integration/fixtures/corrupt_model/

#### Test: Audio Format Support
- **Given**: Various audio formats
- **When: Testing transcription
- **Then: Supports all common formats
- **Files**: .mp3, .wav, .flac, .m4a, .ogg

#### Test: System Resource Limits
- **Given**: High CPU usage scenario
- **When: Running multiple transcriptions
- **Then: Manages system resources properly
- **Mock**: High system load simulation

## Test Execution Strategy

### Order of Execution
1. **Unit Tests** - Fastest, run on every commit
2. **Integration Tests** - Medium speed, run on PR
3. **E2E Tests** - Slower, run nightly and before release
4. **Edge Case Tests** - Variable speed, run on feature branches

### Dependencies
- Unit tests: None
- Integration tests: Requires sample audio files
- E2E tests: Requires full model downloads
- Edge cases: Requires various test fixtures

### CI/CD Pipeline
```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run unit tests
        run: |
          cd ai-engine
          python -m pytest tests/unit -v --cov=ai_engine

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run integration tests
        run: |
          cd ai-engine
          python -m pytest tests/integration -v
        timeout-minutes: 30

  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        model: [whisper-tiny, whisper-base, parakeet]
    steps:
      - uses: actions/checkout@v4
      - name: Download models
        run: |
          cd ai-engine
          python main.py --download-model ${{ matrix.model }} --cache-dir ./cache
      - name: Run E2E tests
        run: |
          python -m pytest tests/e2e -v
        timeout-minutes: 60

  edge-cases:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run edge case tests
        run: |
          cd ai-engine
          python -m pytest tests/edge_cases -v
        timeout-minutes: 45
```

### Local Development
```bash
# Run all tests
npm test

# Run specific test categories
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:edge

# Run with coverage
npm run test:coverage

# Run with debugging
npm run test:debug
```

## Coverage Goals

### Unit Tests: 95%+
- BaseModel interface and methods
- Model factory logic
- Individual model implementations
- Server mode processing
- Progress emission
- Download management

### Integration Tests: 85%+
- Rust-Python communication
- Model download flow
- JSON RPC protocol
- Error recovery paths
- File handling

### E2E Tests: 70%+
- Full workflow coverage
- Progress reporting
- Cancellation handling
- Concurrent tasks

### Edge Cases: 90%+
- Error conditions
- Boundary conditions
- System limitations
- Resource constraints

## Mock Strategy

### External Dependencies
- **faster-whisper**: Mock transcribe method
- **pyannote.audio**: Mock diarization
- **huggingface_hub**: Mock downloads
- **torch**: Mock CUDA availability
- **ffmpeg**: Mock audio processing

### Test Data
- Use small sample files for quick testing
- Generate synthetic audio for specific test cases
- Create corrupted files for error testing
- Use placeholder model files for unit tests

## Performance Considerations

- Test files should be small (under 10MB) for unit tests
- Integration tests can use medium files (under 100MB)
- E2E tests should use representative files
- Mock external dependencies to speed up tests
- Parallel test execution where safe