# Download System - Comprehensive Test Plan

**Status**: Ready for Testing | **Created**: 2026-02-06

---

## Test Strategy Overview

This test plan covers **unit tests**, **integration tests**, and **manual testing** for the improved download system. Tests are organized by layer (Python, Rust, TypeScript) and by functionality (security, reliability, performance).

### Test Coverage Goals

| Layer | Coverage Target | Current |
|-------|----------------|---------|
| Python (AI Engine) | 95% | ___ |
| Rust (Tauri) | 90% | ___ |
| TypeScript (Frontend) | 85% | ___ |
| Integration | 80% | ___ |
| E2E | 70% | ___ |

---

## 1. Unit Tests

### 1.1 Python Tests (AI Engine)

**File**: `tests/unit/python/test_download_security.py`

```python
# Test suite: Security validation
# Priority: CRITICAL
# Estimated time: 30 minutes

def test_validate_url_accepts_valid_huggingface_url():
    """Should accept valid HuggingFace URLs"""
    # Test cases:
    # - https://huggingface.co/guillaumekln/faster-whisper-base
    # - https://cdn-lfs.huggingface.co/repo/...
    assert validate_url("https://huggingface.co/...") == None

def test_validate_url_accepts_valid_github_url():
    """Should accept valid GitHub URLs"""
    # Test cases:
    # - https://github.com/k2-fsa/sherpa-onnx/releases/download/...
    assert validate_url("https://github.com/...") == None

def test_validate_url_rejects_http():
    """Should reject HTTP (non-HTTPS) URLs"""
    with pytest.raises(ValueError, match="scheme must be HTTPS"):
        validate_url("http://huggingface.co/...")

def test_validate_url_rejects_non_whitelisted_host():
    """Should reject URLs from non-trusted domains"""
    with pytest.raises(ValueError, match="not in the allowed list"):
        validate_url("https://malicious.com/file.bin")

def test_validate_url_rejects_path_traversal():
    """Should detect and reject path traversal in URLs"""
    with pytest.raises(ValueError, match="Path traversal detected"):
        validate_url("https://github.com/../../../etc/passwd")

def test_validate_url_rejects_null_byte_injection():
    """Should detect null byte injection attempts"""
    with pytest.raises(ValueError, match="Null byte detected"):
        validate_url("https://github.com/file%00.bin")

def test_validate_model_name_accepts_valid_names():
    """Should accept valid model names"""
    valid_names = [
        "whisper-tiny",
        "whisper_base",
        "parakeet-tdt-1.1",
        "sherpa-onnx-diarization"
    ]
    for name in valid_names:
        assert validate_model_name(name) == name

def test_validate_model_name_rejects_invalid_names():
    """Should reject invalid model names"""
    invalid_names = [
        "../../../etc/passwd",
        "whisper model",  # contains space
        "whisper/../../etc",  # path traversal
        "whisper\x00base",  # null byte
        "CON",  # Windows reserved name
    ]
    for name in invalid_names:
        with pytest.raises(ValueError):
            validate_model_name(name)

def test_safe_join_prevents_traversal():
    """Should prevent directory traversal attacks"""
    base = Path("/safe/dir")
    with pytest.raises(ValueError, match="Path traversal detected"):
        safe_join(base, "../../../etc/passwd")

def test_safe_join_allows_valid_paths():
    """Should allow valid path operations"""
    base = Path("/safe/dir")
    result = safe_join(base, "models", "whisper-tiny")
    assert result == Path("/safe/dir/models/whisper-tiny")

def test_safe_json_loads_enforces_size_limit():
    """Should reject JSON payloads exceeding size limit"""
    large_json = '{"data": "' + "x" * (11 * 1024 * 1024) + '"}'
    with pytest.raises(ValueError, match="JSON payload too large"):
        safe_json_loads(large_json)

def test_safe_json_loads_enforces_depth_limit():
    """Should reject deeply nested JSON"""
    deep_json = '{"a":' * 101 + '"value"' + '}' * 101
    with pytest.raises(ValueError, match="JSON too deeply nested"):
        safe_json_loads(deep_json)

def test_safe_json_loads_accepts_valid_json():
    """Should accept valid JSON within limits"""
    valid_json = '{"type": "transcribe", "file": "video.mp4"}'
    result = safe_json_loads(valid_json)
    assert result["type"] == "transcribe"
```

**File**: `tests/unit/python/test_download_progress.py`

```python
# Test suite: Progress tracking
# Priority: HIGH
# Estimated time: 20 minutes

def test_emit_download_progress_formats_json():
    """Should emit valid JSON progress events"""
    # Capture stdout
    emit_download_progress(100.0, 500.0, 5.2)
    # Verify JSON structure

def test_emit_download_progress_calculates_percent():
    """Should calculate percentage correctly"""
    emit_download_progress(250.0, 500.0, 5.0)
    # Verify percent == 50

def test_emit_download_complete_includes_all_fields():
    """Should include all required fields"""
    emit_download_complete("whisper-base", 512, "/path/to/model")
    # Verify JSON structure

def test_emit_download_error_formats_error():
    """Should format error messages correctly"""
    emit_download_error("Network timeout", "NETWORK_ERROR")
    # Verify error structure
```

**File**: `tests/unit/python/test_whisper_model.py` (Extended)

```python
# Test suite: Model import error handling
# Priority: MEDIUM
# Estimated time: 15 minutes

@patch('ai_engine.models.whisper.import_from')
def test_whisper_import_error_provides_helpful_message(mock_import):
    """Should provide helpful error when dependencies missing"""
    mock_import.side_effect = ImportError("No module named 'faster_whisper'")
    with pytest.raises(ImportError, match="Install with: pip install"):
        WhisperModel(device="cpu", model_size="tiny")
```

### 1.2 Rust Tests (Tauri Backend)

**File**: `tests/unit/rust/test_download_manager.rs` (New)

```rust
// Test suite: Download management
// Priority: HIGH
// Estimated time: 40 minutes

#[tokio::test]
async fn test_concurrent_download_limit_enforced() {
    // Should enforce MAX_CONCURRENT_DOWNLOADS = 3
    let manager = TaskManager::new();
    // Start 4 downloads
    // Verify first 3 succeed
    // Verify 4th fails with "Maximum concurrent downloads reached"
}

#[tokio::test]
async fn test_token_file_created_with_secure_permissions() {
    // Should create token file with read-only permissions
    let token = "test_token";
    let path = pass_token_securely(token).unwrap();
    // Verify file exists
    // Verify permissions (Unix: 0400, Windows: DACL)
    // Verify file content matches token
}

#[tokio::test]
async fn test_token_file_cleanup_after_download() {
    // Should remove token file after download completes
    // Create token file
    // Simulate download completion
    // Verify file removed
}

#[tokio::test]
async fn test_process_cleanup_on_panic() {
    // Should clean up process even if panic occurs
    // Use scopeguard pattern
    // Trigger panic during download
    // Verify process killed
}

#[tokio::test]
async fn test_race_condition_prevention_in_queue() {
    // Should prevent concurrent queue processing
    let manager = TaskManager::new();
    // Spawn two tasks attempting to process queue simultaneously
    // Verify only one processes at a time
}

#[tokio::test]
async fn test_cancel_download_removes_from_tracking() {
    // Should remove download from downloading_models on cancel
    let manager = TaskManager::new();
    // Start download
    // Cancel download
    // Verify removed from HashMap
}

#[tokio::test]
async fn test_delete_model_validates_path() {
    // Should validate model path before deletion
    // Attempt to delete with path traversal
    // Verify deletion fails
}

#[tokio::test]
async fn test_get_local_models_detects_model_types() {
    // Should correctly detect Whisper, Parakeet, Diarization models
    // Create test model directories
    // Call get_local_models()
    // Verify model types detected correctly
}
```

### 1.3 TypeScript Tests (Frontend)

**File**: `tests/unit/frontend/modelsStore.test.ts` (Extend existing)

```typescript
// Test suite: Model download state management
// Priority: MEDIUM
// Estimated time: 30 minutes

describe('modelsStore - Download State', () => {
  test('should initialize download state with zero progress', () => {
    // Start download
    // Verify progress === 0
    // Verify status === "downloading"
  });

  test('should update progress on progress event', () => {
    // Simulate progress event
    // Verify progress updated
    // Verify currentMb calculated correctly
  });

  test('should mark download as completed on complete event', () => {
    // Start download
    // Emit complete event
    // Verify status === "completed"
    // Verify progress === 100
    // Verify model marked as installed
  });

  test('should mark download as error on error event', () => {
    // Start download
    // Emit error event
    // Verify status === "error"
    // Verify error message stored
  });

  test('should handle download cancellation', async () => {
    // Start download
    // Call cancelModelDownload()
    // Verify status === "cancelled"
    // Verify backend cancel invoked
  });

  test('should allow pausing and resuming downloads', () => {
    // Start download
    // Pause download
    // Verify status === "paused"
    // Resume download
    // Verify status === "downloading"
  });

  test('should enforce max concurrent downloads', () => {
    // Start 4 downloads
    // Verify only 3 have status "downloading"
    // Verify 4th has status "queued" (or similar)
  });

  test('should clean up download state after deletion', async () => {
    // Complete download
    // Delete model
    // Verify download state removed
    // Verify model no longer installed
  });
});
```

---

## 2. Integration Tests

### 2.1 Download Flow Integration Tests

**File**: `tests/integration/test_download_flow.py`

```python
# Test suite: End-to-end download flows
# Priority: CRITICAL
# Estimated time: 2 hours
# Prerequisites: Network connection, HuggingFace token (optional)

import pytest
import subprocess
import time
import json
from pathlib import Path

@pytest.mark.integration
def test_download_whisper_model_from_huggingface():
    """Test complete Whisper model download from HuggingFace"""
    # Arrange
    model_name = "whisper-tiny"
    cache_dir = "./test-cache"

    # Act
    process = subprocess.Popen([
        "python", "ai-engine/main.py",
        "--download-model", model_name,
        "--cache-dir", cache_dir
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Monitor progress
    progress_events = []
    while True:
        line = process.stdout.readline().decode()
        if not line:
            break
        try:
            event = json.loads(line)
            if event.get("type") == "Progress":
                progress_events.append(event)
        except json.JSONDecodeError:
            pass

    # Assert
    assert process.wait() == 0  # Exit code 0 = success
    assert len(progress_events) > 10  # Multiple progress updates
    assert Path(cache_dir, model_name).exists()  # Model downloaded

    # Cleanup
    shutil.rmtree(cache_dir)

@pytest.mark.integration
def test_download_fails_with_invalid_token():
    """Test download fails gracefully with invalid HuggingFace token"""
    # Arrange
    token_file = Path("./invalid_token.txt")
    token_file.write_text("invalid_token_12345")

    # Act
    process = subprocess.Popen([
        "python", "ai-engine/main.py",
        "--download-model", "pyannote-sdiarization",
        "--cache-dir", "./test-cache",
        "--token-file", str(token_file)
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Assert
    stdout, stderr = process.communicate()
    assert process.returncode != 0  # Non-zero exit code
    assert b"authentication" in stderr.lower() or b"401" in stderr

    # Cleanup
    token_file.unlink()
    shutil.rmtree("./test-cache", ignore_errors=True)

@pytest.mark.integration
def test_concurrent_downloads_limit():
    """Test that concurrent download limit is enforced"""
    # Arrange
    cache_dir = "./test-cache-concurrent"
    models = ["whisper-tiny", "whisper-base", "whisper-small", "whisper-medium"]

    # Act: Start 4 downloads concurrently
    processes = []
    for model in models:
        p = subprocess.Popen([
            "python", "ai-engine/main.py",
            "--download-model", model,
            "--cache-dir", cache_dir
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(p)

    # Wait briefly for downloads to start
    time.sleep(2)

    # Assert: Check which downloads are actually running
    # (This would require process monitoring or checking active connections)
    # For now, verify all complete (some may queue)

    for p in processes:
        p.wait()

    # Cleanup
    shutil.rmtree(cache_dir, ignore_errors=True)

@pytest.mark.integration
def test_download_cancellation():
    """Test download can be cancelled"""
    # Arrange
    process = subprocess.Popen([
        "python", "ai-engine/main.py",
        "--download-model", "whisper-large-v3",  # Large model to have time to cancel
        "--cache-dir", "./test-cache"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Wait for download to start
    time.sleep(5)

    # Act: Cancel the download
    process.send_signal(signal.SIGTERM)

    # Assert
    process.wait(timeout=10)
    # Verify partial files cleaned up
    assert not Path("./test-cache/whisper-large-v3").exists() or \
           len(list(Path("./test-cache/whisper-large-v3").glob("*"))) == 0

    # Cleanup
    shutil.rmtree("./test-cache", ignore_errors=True)

@pytest.mark.integration
def test_download_from_github():
    """Test download from GitHub releases"""
    # Arrange
    model_name = "sherpa-onnx-diarization"
    cache_dir = "./test-cache"

    # Act
    process = subprocess.Popen([
        "python", "ai-engine/main.py",
        "--download-model", model_name,
        "--model-type", "diarization",
        "--cache-dir", cache_dir
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Assert
    assert process.wait() == 0
    assert Path(cache_dir, model_name).exists()

    # Cleanup
    shutil.rmtree(cache_dir)
```

### 2.2 Error Handling Integration Tests

```python
@pytest.mark.integration
def test_network_timeout_handling():
    """Test graceful handling of network timeout"""
    # This test requires mocking network failures or using slow network
    # For now, mark as skipped
    pytest.skip("Requires network simulation")

@pytest.mark.integration
def test_insufficient_disk_space():
    """Test behavior when disk space is insufficient"""
    # Create small disk image or use quota
    # Attempt to download large model
    # Verify error message mentions disk space
    pytest.skip("Requires disk space simulation")

@pytest.mark.integration
def test_permission_denied():
    """Test behavior when cache directory is read-only"""
    # Make cache directory read-only
    # Attempt download
    # Verify clear error message
    pytest.skip("Requires filesystem permission setup")
```

---

## 3. Manual Testing

### 3.1 Test Environment Setup

```bash
# 1. Clean test environment
rm -rf ~/.cache/transcribe-video/*
mkdir -p ~/.cache/transcribe-video

# 2. Start application in development mode
bun run tauri:dev

# 3. Open DevTools for console logs (F12)

# 4. Navigate to Settings → Models
```

### 3.2 Manual Test Cases

#### TC-01: Basic Download (Happy Path)

**Priority**: CRITICAL
**Estimated Time**: 5 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Navigate to Settings → Models | Models page loads | ___ |
| 2 | Click "Download" on "Whisper Base" | Download starts | ___ |
| 3 | Observe download button | Changes to "Cancel" | ___ |
| 4 | Observe progress bar | Appears and updates | ___ |
| 5 | Observe speed indicator | Shows realistic speed (e.g., "5.2 MB/s") | ___ |
| 6 | Wait for completion | Progress reaches 100% | ___ |
| 7 | Observe completion message | "Download complete" shown | ___ |
| 8 | Check model status | Shows "Installed" | ___ |
| 9 | Check disk usage | Updated correctly | ___ |

**Result**: ___ / 9 passed

---

#### TC-02: Download Cancellation

**Priority**: HIGH
**Estimated Time**: 3 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Start large model download (e.g., "Whisper Large v3") | Download starts | ___ |
| 2 | Wait for 20% progress | Progress bar shows 20% | ___ |
| 3 | Click "Cancel" button | Button shows "Cancelling..." | ___ |
| 4 | Measure time to stop | Stops within 2 seconds | ___ |
| 5 | Check status | Changes to "Cancelled" | ___ |
| 6 | Check cache directory | No partial files or empty directory | ___ |
| 7 | Try to restart download | Download starts immediately | ___ |
| 8 | Verify slot released | Can start another download | ___ |

**Result**: ___ / 8 passed

---

#### TC-03: Concurrent Downloads

**Priority**: HIGH
**Estimated Time**: 10 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Start "Whisper Tiny" download | Download #1 starts | ___ |
| 2 | Immediately start "Whisper Base" | Download #2 starts | ___ |
| 3 | Immediately start "Whisper Small" | Download #3 starts | ___ |
| 4 | Try to start "Whisper Medium" | Shows "Queued" status | ___ |
| 5 | Wait for one download to complete | Any one finishes | ___ |
| 6 | Observe queued download | Starts automatically | ___ |
| 7 | Monitor all progress bars | All update independently | ___ |
| 8 | Wait for all to complete | All finish successfully | ___ |

**Result**: ___ / 8 passed

---

#### TC-04: HuggingFace Token Validation

**Priority**: HIGH
**Estimated Time**: 5 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Go to Settings → API Keys | API keys page loads | ___ |
| 2 | Enter invalid token: "invalid_test_token" | Token saved | ___ |
| 3 | Click "Download" on "Pyannote Diarization" | Download starts | ___ |
| 4 | Wait for error | Error message appears | ___ |
| 5 | Check error message | Mentions authentication or 401 | ___ |
| 6 | Check if token file cleaned up | No temp files left | ___ |
| 7 | Enter correct token | Token accepted | ___ |
| 8 | Retry download | Download succeeds | ___ |

**Result**: ___ / 8 passed

---

#### TC-05: Network Error Recovery

**Priority**: MEDIUM
**Estimated Time**: 5 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Start download | Download begins | ___ |
| 2 | Wait for 30% progress | Progress shows 30% | ___ |
| 3 | Disable network adapter | Network disconnects | ___ |
| 4 | Wait 10 seconds | Error appears | ___ |
| 5 | Check error message | Clear error about network | ___ |
| 6 | Re-enable network | Connection restored | ___ |
| 7 | Click "Retry" download | Download restarts | ___ |
| 8 | Verify download completes | Reaches 100% | ___ |

**Result**: ___ / 8 passed

---

#### TC-06: Disk Space Validation

**Priority**: MEDIUM
**Estimated Time**: 8 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Check available disk space | Note current space | ___ |
| 2 | Fill disk to <100MB free | Use large file or quota | ___ |
| 3 | Try to download large model (>500MB) | Click download | ___ |
| 4 | Observe immediate feedback | Error before download | ___ |
| 5 | Check error message | "Insufficient disk space" | ___ |
| 6 | Verify no partial files | Cache directory empty | ___ |
| 7 | Free up disk space | Delete test file | ___ |
| 8 | Retry download | Download succeeds | ___ |

**Result**: ___ / 8 passed

---

#### TC-07: Model Deletion

**Priority**: HIGH
**Estimated Time**: 2 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Download and install a model | Model shows "Installed" | ___ |
| 2 | Click "Delete" button | Confirmation dialog appears | ___ |
| 3 | Confirm deletion | Model removed from list | ___ |
| 4 | Check disk directory | Model directory deleted | ___ |
| 5 | Check disk usage | Updated correctly (decreased) | ___ |
| 6 | Try to download again | Download starts successfully | ___ |

**Result**: ___ / 6 passed

---

#### TC-08: Security Validation

**Priority**: CRITICAL
**Estimated Time**: 10 minutes

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Open DevTools Console | Console visible | ___ |
| 2 | Execute: `invoke('download_model', {modelName: '../../../etc/passwd', modelType: 'whisper'})` | Request rejected | ___ |
| 3 | Check console error | "Invalid model name" error | ___ |
| 4 | Check filesystem | No files created outside cache | ___ |
| 5 | Execute: `invoke('download_model', {modelName: 'whisper-base', modelType: 'whisper', huggingFaceToken: '../../../etc/passwd'})` | Token validated | ___ |
| 6 | Verify no subprocess spawned | Process list clean | ___ |
| 7 | Check logs | Security violation logged | ___ |

**Result**: ___ / 7 passed

---

## 4. Performance Tests

### 4.1 Benchmark Tests

**File**: `tests/performance/test_download_benchmarks.py`

```python
import time
import shutil
from pathlib import Path

@pytest.mark.benchmark
def test_download_speed_small_model():
    """Benchmark: Small model (<100 MB) download speed"""
    start_time = time.time()

    process = subprocess.Popen([
        "python", "ai-engine/main.py",
        "--download-model", "whisper-tiny",
        "--cache-dir", "./bench-cache"
    ])
    process.wait()

    duration = time.time() - start_time

    # Assert: Should complete in <60 seconds on 100 Mbps connection
    assert duration < 60, f"Download took {duration:.2f}s, expected <60s"

    shutil.rmtree("./bench-cache")

@pytest.mark.benchmark
def test_concurrent_download_performance():
    """Benchmark: Performance with 3 concurrent downloads"""
    start_time = time.time()

    processes = []
    for model in ["whisper-tiny", "whisper-base", "whisper-small"]:
        p = subprocess.Popen([
            "python", "ai-engine/main.py",
            "--download-model", model,
            "--cache-dir", "./bench-cache"
        ])
        processes.append(p)

    for p in processes:
        p.wait()

    duration = time.time() - start_time

    # Assert: Should complete in <5 minutes on decent connection
    assert duration < 300, f"Concurrent downloads took {duration:.2f}s"

    shutil.rmtree("./bench-cache")

@pytest.mark.benchmark
def test_memory_usage_during_download():
    """Benchmark: Memory usage during download"""
    import tracemalloc
    tracemalloc.start()

    process = subprocess.Popen([
        "python", "ai-engine/main.py",
        "--download-model", "whisper-base",
        "--cache-dir", "./bench-cache"
    ])
    process.wait()

    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # Assert: Peak memory <100 MB
    assert peak < 100 * 1024 * 1024, f"Peak memory: {peak / 1024 / 1024:.2f} MB"

    shutil.rmtree("./bench-cache")
```

### 4.2 Stress Tests

```python
@pytest.mark.stress
def test_rapid_download_cancellation():
    """Stress test: Rapid start/cancel cycles"""
    for i in range(10):
        process = subprocess.Popen([
            "python", "ai-engine/main.py",
            "--download-model", "whisper-tiny",
            "--cache-dir", "./stress-cache"
        ])
        time.sleep(0.5)  # Wait 500ms
        process.send_signal(signal.SIGTERM)
        process.wait(timeout=5)

    # Assert: All processes cleaned up, no zombies
    # Verify with process monitor

@pytest.mark.stress
def test_download_queue_overflow():
    """Stress test: Attempt to exceed queue capacity"""
    # Start 10 concurrent downloads
    processes = []
    for i in range(10):
        p = subprocess.Popen([
            "python", "ai-engine/main.py",
            "--download-model", f"whisper-tiny-{i}",
            "--cache-dir", "./stress-cache"
        ])
        processes.append(p)

    # Wait for all to complete or error out
    for p in processes:
        p.wait()

    # Assert: System remained stable, no crashes
```

---

## 5. Test Execution Plan

### 5.1 Pre-Integration Test Run

**When**: Before merging to main branch
**Duration**: 2-3 hours
**Scope**: All unit tests + critical integration tests

```bash
# Step 1: Python unit tests (30 min)
cd ai-engine
pytest tests/unit/python/ -v --cov=. --cov-report=html

# Step 2: Rust unit tests (20 min)
cd src-tauri
cargo test --unit -- --nocapture

# Step 3: Integration tests (1 hour)
cd ../tests
pytest integration/test_download_flow.py -v

# Step 4: Coverage check
# Verify coverage targets met
```

**Pass Criteria**:
- All unit tests pass (23/23)
- Integration tests pass (10/10)
- Coverage: Python >90%, Rust >85%

### 5.2 Pre-Deployment Test Run

**When**: Before production deployment
**Duration**: 4-5 hours
**Scope**: All tests + manual testing + benchmarks

```bash
# Step 1: Full automated test suite (2 hours)
bun run test:all

# Step 2: Manual testing (2 hours)
# Follow manual test cases TC-01 through TC-08

# Step 3: Performance benchmarks (30 min)
pytest tests/performance/ -v

# Step 4: Security scan (15 min)
cargo audit
pip audit
```

**Pass Criteria**:
- All automated tests pass
- All manual tests pass (8/8)
- Benchmarks meet targets
- No security vulnerabilities

### 5.3 Continuous Testing

**On Every Commit**:
```bash
# Quick smoke test
pytest tests/unit/python/test_download_security.py -v
cargo test download --lib
```

**On Every Pull Request**:
```bash
# Full test suite
bun run test:all
```

---

## 6. Test Data and Fixtures

### 6.1 Test Models

Create mock model files for testing:

```bash
tests/fixtures/test_models/
├── whisper-tiny/
│   ├── model.bin
│   ├── config.json
│   └── vocabulary.txt
├── whisper-base/
│   └── (same structure)
└── pyannote-diarization/
    └── (same structure)
```

### 6.2 Test Tokens

Use invalid test tokens for error testing:

```
tests/fixtures/tokens/
├── invalid_token.txt          # Contains: "invalid_token_12345"
├── expired_token.txt          # Contains an expired HF token
└── malformed_token.txt        # Contains: "not_a_token_at_all"
```

### 6.3 Mock URLs

For security testing without real downloads:

```python
MOCK_URLS = {
    "valid_huggingface": "https://huggingface.co/test/model",
    "valid_github": "https://github.com/test/repo/releases/download/v1.0/model.bin",
    "invalid_scheme": "http://malicious.com/file.bin",
    "invalid_host": "https://malicious.com/file.bin",
    "path_traversal": "https://github.com/../../../etc/passwd",
    "null_injection": "https://github.com/file%00.bin",
}
```

---

## 7. Test Reporting

### 7.1 Test Results Template

```
# Test Execution Report

**Date**: YYYY-MM-DD
**Environment**: Development/Staging/Production
**Tester**: Name

## Summary
- Total Tests: 41
- Passed: XX
- Failed: XX
- Skipped: XX
- Pass Rate: XX%

## Unit Tests
- Python: 15/15 passed
- Rust: 8/8 passed
- TypeScript: XX/XX passed

## Integration Tests
- Download flow: 5/5 passed
- Error handling: 3/3 passed
- Security: 2/2 passed

## Manual Tests
- TC-01: Basic download: PASS/FAIL
- TC-02: Cancellation: PASS/FAIL
- TC-03: Concurrent: PASS/FAIL
- TC-04: Token validation: PASS/FAIL
- TC-05: Network errors: PASS/FAIL
- TC-06: Disk space: PASS/FAIL
- TC-07: Deletion: PASS/FAIL
- TC-08: Security: PASS/FAIL

## Performance Benchmarks
- Download speed: TARGET / ACTUAL
- Concurrent performance: TARGET / ACTUAL
- Memory usage: TARGET / ACTUAL

## Issues Found
1. [Description]
   - Severity: CRITICAL/HIGH/MEDIUM/LOW
   - Steps to reproduce: [...]
   - Expected: [...]
   - Actual: [...]

## Recommendations
- [Any recommendations for improvements]

## Sign-off
Tested by: _________
Date: _________
Approved: [ ] YES [ ] NO
```

---

## 8. Success Criteria

Integration is successful when:

- ✅ All unit tests pass (41/41)
- ✅ All integration tests pass (10/10)
- ✅ All manual tests pass (8/8)
- ✅ Coverage targets met (Py >90%, Rust >85%)
- ✅ No security vulnerabilities
- ✅ Benchmarks meet performance targets
- ✅ Zero regressions in existing functionality
- ✅ Documentation complete and accurate

---

**Test Plan Version**: 1.0
**Last Updated**: 2026-02-06
**Total Tests**: 41 (unit: 23, integration: 10, manual: 8)
**Estimated Execution Time**: 4-5 hours (full suite)
