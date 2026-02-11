# Comprehensive Test Plan for Transcribe Video

## Overview

This document provides a complete testing plan for the Transcribe Video application, covering all aspects from unit tests to end-to-end user workflows.

## Test Scope

### Components Under Test
1. **Python AI Engine** (`ai-engine/`)
   - Model loading and inference
   - JSON protocol and event emission
   - Security validation (paths, URLs, JSON)
   - Download management
   - Server mode

2. **Rust Backend** (`src-tauri/`)
   - Task queue management
   - Process spawning and cleanup
   - File validation
   - Model management operations
   - Tauri command handlers

3. **Frontend** (`src/`)
   - UI components
   - State management
   - Event handling
   - File upload

### Test Levels

```
┌─────────────────────────────────────────┐
│         E2E Tests (Full System)         │
│  - Real user workflows                  │
│  - GUI automation                       │
│  - Performance benchmarks               │
├─────────────────────────────────────────┤
│       Integration Tests (API Level)     │
│  - Component interactions               │
│  - Event propagation                    │
│  - Process communication                │
├─────────────────────────────────────────┤
│         Unit Tests (Component Level)    │
│  - Python functions                     │
│  - Rust functions                       │
│  - Security validation                  │
└─────────────────────────────────────────┘
```

## Test Scenarios

### 1. File Processing Scenarios

#### 1.1 Small Audio File (< 1MB)
**Test ID**: `TS-FILE-001`
**Priority**: High
**Type**: Integration

**Steps**:
1. Create or use test audio file (< 1MB)
2. Upload file through UI
3. Select whisper-tiny model
4. Start transcription with CPU device
5. Verify progress events
6. Verify transcription result

**Expected Result**:
- Transcription completes in < 30 seconds
- Progress events emitted (loading, transcribing, complete)
- Result contains segments with timestamps
- No errors in logs

**Test Files**:
- `tests/integration/test_transcription_flow.py::test_small_file_transcription`

#### 1.2 Large Video File (> 100MB)
**Test ID**: `TS-FILE-002`
**Priority**: Medium
**Type**: E2E
**Marker**: `@slow`

**Steps**:
1. Use test video file (> 100MB)
2. Upload and transcribe with whisper-base
3. Monitor progress events for > 5 minutes
4. Verify memory usage stays reasonable
5. Verify UI remains responsive

**Expected Result**:
- Transcription completes without timeout
- Progress updates every 0.5-1 second
- Memory usage < 2GB
- UI doesn't freeze

**Test Files**:
- `tests/e2e/test_user_workflows.py::test_large_file_transcription`

#### 1.3 Invalid File Format
**Test ID**: `TS-FILE-003`
**Priority**: High
**Type**: Integration

**Steps**:
1. Create test file with invalid format (e.g., .pdf, .exe)
2. Attempt to transcribe
3. Verify error handling

**Expected Result**:
- Clear error message shown to user
- No crash or hang
- Python process exits cleanly

**Test Files**:
- `tests/integration/test_transcription_flow.py::test_invalid_file_format`

### 2. Device Scenarios

#### 2.1 CPU Transcription
**Test ID**: `TS-DEV-001`
**Priority**: High
**Type**: Unit

**Steps**:
1. Create model with device="cpu"
2. Verify model loads on CPU
3. Run test transcription

**Expected Result**:
- Model loads successfully
- Transcription completes
- No CUDA errors

**Test Files**:
- `tests/unit/python/test_factory.py::test_create_whisper_model_with_cpu`

#### 2.2 CUDA Transcription (if available)
**Test ID**: `TS-DEV-002`
**Priority**: Medium
**Type**: Integration
**Marker**: `@gpu`

**Steps**:
1. Check CUDA availability
2. Create model with device="cuda"
3. Verify GPU is used
4. Compare speed vs CPU

**Expected Result**:
- Model loads on GPU
- Transcription is faster than CPU
- No out-of-memory errors

**Test Files**:
- `tests/integration/test_transcription_flow.py::test_cuda_transcription`

### 3. Diarization Scenarios

#### 3.1 Without Diarization
**Test ID**: `TS-DIA-001`
**Priority**: High
**Type**: Integration

**Steps**:
1. Transcribe with diarization=false
2. Verify segments have no speaker labels

**Expected Result**:
- All segments have `speaker: null`
- Transcription completes normally

**Test Files**:
- `tests/integration/test_transcription_flow.py::test_transcription_without_diarization`

#### 3.2 With PyAnnote Diarization
**Test ID**: `TS-DIA-002`
**Priority**: High
**Type**: Integration
**Marker**: `@models`

**Steps**:
1. Ensure pyannote model is downloaded
2. Transcribe with diarization=true, provider="pyannote"
3. Verify speaker labels

**Expected Result**:
- Segments have speaker labels (SPEAKER_00, SPEAKER_01, etc.)
- At least 2 speakers detected (if applicable)

**Test Files**:
- `tests/integration/test_transcription_flow.py::test_pyannote_diarization`

#### 3.3 With Sherpa-ONNX Diarization
**Test ID**: `TS-DIA-003`
**Priority**: Medium
**Type**: Integration
**Marker**: `@models`

**Steps**:
1. Ensure sherpa-onnx model is downloaded
2. Transcribe with provider="sherpa-onnx", num_speakers=2
3. Verify speaker labels

**Expected Result**:
- Segments have speaker labels
- Exactly 2 speakers detected

**Test Files**:
- `tests/integration/test_transcription_flow.py::test sherpa_onnx_diarization`

### 4. Model Management Scenarios

#### 4.1 Download Whisper Model from HuggingFace
**Test ID**: `TS-MOD-001`
**Priority**: High
**Type**: Integration
**Marker**: `@network`

**Steps**:
1. Call download_model for "whisper-tiny"
2. Monitor progress events
3. Verify model directory created
4. Verify model files present
5. Verify model appears in list

**Expected Result**:
- Download completes successfully
- Progress events show 0-100%
- Model directory contains .bin files
- Model size matches expected (~75MB for tiny)

**Test Files**:
- `tests/integration/test_model_management.py::test_download_whisper_model`

#### 4.2 Download PyAnnote Models with Token
**Test ID**: `TS-MOD-002`
**Priority**: High
**Type**: Integration
**Marker**: `@network`

**Steps**:
1. Set HuggingFace token
2. Download "pyannote-diarization"
3. Verify both segmentation and embedding models downloaded

**Expected Result**:
- Download succeeds with valid token
- Fails with invalid token
- Both models present in cache

**Test Files**:
- `tests/integration/test_model_management.py::test_download_with_valid_token`
- `tests/integration/test_model_management.py::test_download_with_invalid_token`

#### 4.3 Download Sherpa-ONNX from GitHub
**Test ID**: `TS-MOD-003`
**Priority**: Medium
**Type**: Integration
**Marker**: `@network`

**Steps**:
1. Download "sherpa-onnx-diarization"
2. Verify models downloaded from GitHub
3. Verify tar.bz2 extraction

**Expected Result**:
- Download succeeds without token
- Files extracted from tar.bz2
- .onnx files present

**Test Files**:
- `tests/integration/test_model_management.py::test_download_sherpa_onnx_model`

#### 4.4 List Installed Models
**Test ID**: `TS-MOD-004`
**Priority**: High
**Type**: Unit

**Steps**:
1. Create mock models directory
2. Call get_local_models
3. Verify model list

**Expected Result**:
- All models listed with correct sizes
- Model types detected correctly
- Paths are absolute

**Test Files**:
- `tests/unit/python/test_main.py::test_list_models_populated_cache`

#### 4.5 Delete Model
**Test ID**: `TS-MOD-005`
**Priority**: High
**Type**: Integration

**Steps**:
1. Download a model
2. Call delete_model
3. Verify directory removed
4. Verify model removed from list

**Expected Result**:
- Directory completely deleted
- Model no longer in list

**Test Files**:
- `tests/integration/test_model_management.py::test_delete_existing_model`

### 5. Task Queue Scenarios

#### 5.1 Max 2 Concurrent Tasks
**Test ID**: `TS-TASK-001`
**Priority**: High
**Type**: E2E
**Marker**: `@slow`

**Steps**:
1. Start 3 transcriptions simultaneously
2. Verify only 2 start immediately
3. Verify 3rd is queued
4. Wait for first to complete
5. Verify 3rd starts

**Expected Result**:
- Queue limit enforced correctly
- Queued task starts when slot available

**Test Files**:
- `tests/e2e/test_user_workflows.py::test_concurrent_task_limit`

#### 5.2 Cancel Running Task
**Test ID**: `TS-TASK-002`
**Priority**: High
**Type**: E2E

**Steps**:
1. Start long transcription
2. Click cancel button
3. Verify Python process killed
4. Verify no orphaned processes

**Expected Result**:
- Task stops immediately
- Partial results not shown
- Process cleaned up

**Test Files**:
- `tests/e2e/test_user_workflows.py::test_cancel_running_task`

#### 5.3 Cancel Queued Task
**Test ID**: `TS-TASK-003`
**Priority**: Medium
**Type**: E2E

**Steps**:
1. Start 3 tasks (2 run, 1 queued)
2. Cancel queued task
3. Verify task removed from queue

**Expected Result**:
- Task removed from queue
- Running tasks unaffected

**Test Files**:
- `tests/e2e/test_user_workflows.py::test_cancel_queued_task`

### 6. Error Scenarios

#### 6.1 Missing Model
**Test ID**: `TS-ERR-001`
**Priority**: High
**Type**: Integration

**Steps**:
1. Select model not downloaded
2. Attempt transcription
3. Verify error message

**Expected Result**:
- Clear error: "Model not downloaded"
- Option to download model shown

**Test Files**:
- `tests/integration/test_transcription_flow.py::test_missing_model_error`

#### 6.2 Network Error During Download
**Test ID**: `TS-ERR-002`
**Priority**: High
**Type**: Integration
**Marker**: `@network`

**Steps**:
1. Start model download
2. Disconnect network
3. Verify error handling

**Expected Result**:
- Download fails gracefully
- Error message shown
- Partial files cleaned up

**Test Files**:
- `tests/integration/test_model_management.py::test_network_error_during_download`

#### 6.3 Insufficient Disk Space
**Test ID**: `TS-ERR-003`
**Priority**: Medium
**Type**: Integration

**Steps**:
1. Fill disk to near capacity
2. Attempt large model download
3. Verify error handling

**Expected Result**:
- Error detected before download
- Clear message: "Insufficient disk space"
- No partial files left

**Test Files**:
- `tests/integration/test_model_management.py::test_insufficient_disk_space`

### 7. Security Scenarios

#### 7.1 Path Traversal Attack
**Test ID**: `TS-SEC-001`
**Priority**: Critical
**Type**: Unit
**Marker**: `@security`

**Steps**:
1. Attempt to load file with "../../../etc/passwd"
2. Verify path validation blocks it

**Expected Result**:
- ValueError raised
- Error message: "Path traversal detected"
- File not accessed

**Test Files**:
- `tests/unit/python/test_main.py::test_safe_join_prevents_path_traversal`

#### 7.2 Command Injection
**Test ID**: `TS-SEC-002`
**Priority**: Critical
**Type**: Unit
**Marker**: `@security`

**Steps**:
1. Pass filename with "file.mp3; rm -rf /"
2. Verify sanitization

**Expected Result**:
- Special characters escaped/rejected
- Command not executed

**Test Files**:
- `tests/unit/python/test_main.py::test_validate_model_name_invalid_characters`

#### 7.3 JSON Bomb (DoS)
**Test ID**: `TS-SEC-003`
**Priority**: High
**Type**: Unit
**Marker**: `@security`

**Steps**:
1. Send extremely deep JSON (> 100 levels)
2. Verify size/depth limits enforced

**Expected Result**:
- JSON rejected
- Error: "nesting depth exceeds maximum"

**Test Files**:
- `tests/unit/python/test_main.py::test_json_depth_limit_enforcement`

#### 7.4 SSRF via URL
**Test ID**: `TS-SEC-004`
**Priority**: High
**Type**: Unit
**Marker**: `@security`

**Steps**:
1. Attempt download from non-whitelisted URL
2. Verify URL validation blocks it

**Expected Result**:
- ValueError raised
- Error: "hostname not in allowed list"

**Test Files**:
- `tests/unit/python/test_main.py::test_validate_url_blocks_untrusted_hosts`

### 8. Performance Scenarios

#### 8.1 Transcription Speed Benchmarks
**Test ID**: `TS-PERF-001`
**Priority**: Medium
**Type**: E2E
**Marker**: `@performance @slow`

**File Sizes and Expected Times**:
- 1 MB file: < 30 seconds
- 10 MB file: < 2 minutes
- 100 MB file: < 10 minutes

**Test Files**:
- `tests/e2e/test_user_workflows.py::test_transcription_speed_benchmark`

#### 8.2 Memory Usage
**Test ID**: `TS-PERF-002`
**Priority**: Medium
**Type**: E2E
**Marker**: `@performance`

**Expected Limits**:
- Base memory: < 500 MB
- During transcription: < 2 GB
- No memory leaks after 10 transcriptions

**Test Files**:
- `tests/e2e/test_user_workflows.py::test_memory_usage_benchmark`

#### 8.3 UI Responsiveness
**Test ID**: `TS-PERF-003`
**Priority**: High
**Type**: E2E

**Steps**:
1. Start long transcription
2. Try to interact with UI
3. Verify responsiveness

**Expected Result**:
- UI remains responsive
- No freezing
- Progress updates smooth

**Test Files**:
- `tests/e2e/test_user_workflows.py::test_ui_responsiveness_during_transcription`

## Test Execution Plan

### Pre-Test Setup

1. **Environment Setup**
   ```bash
   # Install Python dependencies
   cd ai-engine
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   pip install -r requirements.txt

   # Install test dependencies
   pip install -r ../tests/requirements.txt
   ```

2. **Download Test Models**
   ```bash
   # Small models for quick tests
   python main.py --download-model whisper-tiny --cache-dir /tmp/test_models --model-type whisper

   # Optional: Large models for full tests
   python main.py --download-model whisper-base --cache-dir /tmp/test_models --model-type whisper
   ```

3. **Prepare Test Fixtures**
   ```bash
   # Create test audio files
   mkdir -p tests/fixtures/audio
   mkdir -p tests/fixtures/video

   # Add test files (see fixtures/README.md for format)
   ```

### Daily Test Run (Fast Feedback)

Run on every commit/PR:
```bash
# Unit tests only (fast, no external dependencies)
pytest tests/unit/ -m "not slow" -v

# Expected: < 1 minute, 100% pass
```

### Pre-Merge Test Run (Full Validation)

Run before merging to main:
```bash
# Unit tests (all)
pytest tests/unit/ -v

# Integration tests (offline)
pytest tests/integration/ -m "not network" -v

# Expected: < 10 minutes, 100% pass
```

### Weekly Test Run (Complete Coverage)

Run full suite weekly:
```bash
# All tests
pytest tests/ -v

# Including network tests
pytest tests/ -m "network" -v

# Expected: < 1 hour, 100% pass
```

### Pre-Release Test Run (Production Validation)

Run before release:
```bash
# Build production binary
bun run tauri:build

# Run E2E tests on production build
pytest tests/e2e/ -v

# Performance benchmarks
pytest tests/ -m "performance" -v

# Expected: < 2 hours, 100% pass
```

## Test Coverage Goals

### Code Coverage Targets

| Component | Statement Coverage | Branch Coverage | Function Coverage |
|-----------|-------------------|-----------------|-------------------|
| Python (ai-engine) | > 85% | > 80% | > 85% |
| Rust (src-tauri) | > 80% | > 75% | > 80% |
| Frontend (src) | > 75% | > 70% | > 75% |

### Scenario Coverage

- **Happy Paths**: All core workflows ✅
- **Error Paths**: All error conditions ✅
- **Edge Cases**: Boundary values ✅
- **Security**: All attack vectors ✅
- **Performance**: All benchmarks ✅

## Test Metrics

### Track These Metrics

1. **Pass Rate**
   - Target: 100% for all tests
   - Minimum: 95% (with documented failures)

2. **Flaky Test Rate**
   - Target: 0%
   - Maximum: 2% (need fixes)

3. **Test Execution Time**
   - Unit: < 1 minute
   - Integration: < 10 minutes
   - E2E: < 30 minutes

4. **Coverage Trends**
   - Improve or maintain coverage
   - Alert if coverage drops > 5%

## Continuous Integration

### GitHub Actions Workflow

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  unit-tests:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        python-version: ['3.8', '3.9', '3.10', '3.11', '3.12']
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          cd ai-engine
          pip install -r requirements.txt
          pip install -r ../tests/requirements.txt
      - name: Run unit tests
        run: pytest tests/unit/ -m "not slow" -v

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: |
          cd ai-engine
          pip install -r requirements.txt
          pip install -r ../tests/requirements.txt
      - name: Run integration tests
        run: pytest tests/integration/ -m "not network" -v

  rust-tests:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v2
      - name: Run Rust tests
        run: cargo test --manifest-path=src-tauri/Cargo.toml
```

## Test Documentation

### Results Tracking

After each test run, document:
1. Test execution date/time
2. Number of tests passed/failed
3. Code coverage percentage
4. Any flaky tests identified
5. Performance metrics

### Failure Analysis

For each test failure:
1. Root cause analysis
2. Fix implemented
3. Regression test added
4. Documentation updated

## Test Maintenance

### Regular Tasks

- **Weekly**: Review and update test scenarios
- **Monthly**: Update test fixtures and data
- **Per Release**: Run full E2E suite
- **Quarterly**: Review and improve test coverage

### Test Cleanup

```bash
# Remove test artifacts
rm -rf tests/.pytest_cache
rm -rf tests/__pycache__
rm -rf tests/fixtures/**/*.tmp

# Clear model cache
rm -rf /tmp/test_models
```

## Summary

This test plan provides comprehensive coverage of:
- ✅ All user workflows
- ✅ All error scenarios
- ✅ Security validation
- ✅ Performance benchmarks
- ✅ Cross-platform compatibility

For questions or updates to this plan, please refer to:
- `tests/README.md` - Testing framework overview
- `tests/INDEX.md` - Test suite index
- `CLAUDE.md` - Project architecture
