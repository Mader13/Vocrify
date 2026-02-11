# Integration Test Plan for Download System

This document describes comprehensive integration testing strategies for the improved download system.

## Overview

The integration tests verify the complete download flow from the frontend (React/TypeScript) through the backend (Rust/Tauri) to the AI engine (Python), ensuring all components work together correctly.

## Test Environment Setup

### Prerequisites
1. Python 3.8-3.12 installed
2. Rust and Cargo installed
3. Node.js and Bun installed
4. FFmpeg installed
5. Valid HuggingFace token (for testing authenticated downloads)

### Test Fixtures
- Located in `/tests/fixtures/`
- Contains:
  - Small model files for mock downloads
  - Test video/audio files
  - Configuration templates

### Mock Servers
- HuggingFace mock server (for testing without external dependencies)
- GitHub releases mock server (for Sherpa-ONNX downloads)

## Test Scenarios

### 1. Full Download Flow - Whisper Model

**Objective:** Verify end-to-end download of a Whisper model from HuggingFace.

**Steps:**
1. Frontend initiates download via `downloadModel()` Tauri command
2. Rust backend validates request and spawns Python process
3. Python engine downloads model using `snapshot_download()`
4. Progress updates flow: Python → Rust → Frontend
5. Completion event sent when download finishes
6. Model appears in local models list

**Expected Results:**
- Model downloaded to correct cache directory
- Progress percentage increases from 0 to 100
- Frontend receives and displays progress updates
- Model size matches expected size
- Model is usable for transcription

**Test Cases:**
```typescript
describe('Whisper Model Download Flow', () => {
  it('should download whisper-tiny model successfully', async () => {
    // 1. Trigger download
    const downloadPromise = invoke('download_model', {
      modelName: 'whisper-tiny',
      modelType: 'whisper',
      huggingFaceToken: null
    });

    // 2. Listen for progress events
    const progressEvents: ProgressEvent[] = [];
    const unlisten = await listen('model-download-progress', (event) => {
      progressEvents.push(event.payload as ProgressEvent);
    });

    // 3. Wait for completion
    await downloadPromise;

    // 4. Verify progress sequence
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[0].percent).toBe(0);
    expect(progressEvents[progressEvents.length - 1].percent).toBe(100);

    // 5. Verify model exists
    const models = await invoke('get_local_models');
    const tinyModel = models.find((m: LocalModel) => m.name === 'whisper-tiny');
    expect(tinyModel).toBeDefined();
    expect(tinyModel.installed).toBe(true);

    unlisten();
  });

  it('should handle large model download (whisper-large-v3)', async () => {
    // Test with larger model
    // Verify resumable downloads work
    // Verify disk space checking
  });
});
```

### 2. Full Download Flow - Diarization Model

**Objective:** Verify download of diarization models that require authentication.

**Steps:**
1. Set up valid HuggingFace token
2. Request pyannote/speaker-diarization-3.1 download
3. Verify token is passed securely via temp file
4. Monitor progress through download
5. Verify model is installed correctly

**Expected Results:**
- Authentication successful
- Model downloaded with token
- Token file cleaned up after download
- Model appears in diarization models list

**Test Cases:**
```typescript
describe('Diarization Model Download Flow', () => {
  it('should download pyannote model with valid token', async () => {
    // Set token
    await invoke('save_huggingface_token', { token: 'hf_test_token' });

    // Download model
    await invoke('download_model', {
      modelName: 'pyannote/speaker-diarization-3.1',
      modelType: 'diarization',
      huggingFaceToken: 'hf_test_token'
    });

    // Verify model installed
    const models = await invoke('get_local_models');
    const pyannoteModel = models.find((m: LocalModel) =>
      m.name.includes('pyannote')
    );
    expect(pyannoteModel).toBeDefined();
  });

  it('should fail with invalid token', async () => {
    // Should emit error event
    const errorPromise = new Promise((resolve) => {
      listen('model-download-error', (event) => {
        resolve(event.payload);
      });
    });

    await invoke('download_model', {
      modelName: 'pyannote/speaker-diarization-3.1',
      modelType: 'diarization',
      huggingFaceToken: 'invalid_token'
    });

    const error = await errorPromise;
    expect(error).toContain('authentication');
  });
});
```

### 3. Sherpa-ONNX Model Download

**Objective:** Verify download of Sherpa-ONNX models from GitHub releases.

**Steps:**
1. Request sherpa-onnx-diarization model
2. Download from GitHub releases URL
3. Extract tar.bz2 or save .onnx file
4. Verify installation

**Expected Results:**
- File downloaded from GitHub
- Correctly extracted if tar.bz2
- Model appears in local models

**Test Cases:**
```typescript
describe('Sherpa-ONNX Download Flow', () => {
  it('should download and extract sherpa-onnx-segmentation', async () => {
    await invoke('download_model', {
      modelName: 'sherpa-onnx-segmentation',
      modelType: 'diarization',
      huggingFaceToken: null
    });

    const models = await invoke('get_local_models');
    const sherpaModel = models.find((m: LocalModel) =>
      m.name.includes('sherpa-onnx')
    );
    expect(sherpaModel).toBeDefined();
    expect(sherpaModel.modelType).toBe('diarization');
  });
});
```

### 4. Concurrent Downloads

**Objective:** Verify the system handles multiple simultaneous downloads correctly.

**Steps:**
1. Start 3 model downloads simultaneously
2. Verify all progress independently
3. Verify MAX_CONCURRENT_DOWNLOADS limit enforced
4. Queue 4th download while 3 are running
5. Complete one, verify 4th starts

**Expected Results:**
- First 3 downloads start immediately
- 4th download queued until one completes
- Each download has independent progress
- All downloads complete successfully

**Test Cases:**
```typescript
describe('Concurrent Download Management', () => {
  it('should limit concurrent downloads to 3', async () => {
    // Start 4 downloads simultaneously
    const downloads = [
      invoke('download_model', { modelName: 'whisper-tiny', modelType: 'whisper' }),
      invoke('download_model', { modelName: 'whisper-base', modelType: 'whisper' }),
      invoke('download_model', { modelName: 'whisper-small', modelType: 'whisper' }),
      invoke('download_model', { modelName: 'whisper-medium', modelType: 'whisper' }),
    ];

    // First 3 should start, 4th should queue
    const queueStatus = await invoke('get_queue_status');
    expect(queueStatus.running).toBe(3);
    expect(queueStatus.queued).toBe(1);

    await Promise.all(downloads);
  });

  it('should process queued download after completion', async () => {
    // This requires mocking to test properly
    // or timing verification with actual small files
  });
});
```

### 5. Download Cancellation

**Objective:** Verify downloads can be cancelled mid-progress.

**Steps:**
1. Start a large model download
2. Wait for progress to reach 50%
3. Cancel download via `cancel_model_download()`
4. Verify cleanup

**Expected Results:**
- Download stops immediately
- Partial files cleaned up
- Cancellation event emitted
- Model not added to local models

**Test Cases:**
```typescript
describe('Download Cancellation', () => {
  it('should cancel download and clean up files', async () => {
    // Start download
    const downloadPromise = invoke('download_model', {
      modelName: 'whisper-large-v3',
      modelType: 'whisper'
    });

    // Wait for some progress
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Cancel download
    await invoke('cancel_model_download', { modelName: 'whisper-large-v3' });

    // Verify cleanup
    const models = await invoke('get_local_models');
    const largeModel = models.find((m: LocalModel) => m.name === 'whisper-large-v3');
    expect(largeModel).toBeUndefined();
  });

  it('should emit cancellation event', async () => {
    const cancelledPromise = new Promise((resolve) => {
      const unlisten = listen('model-download-cancelled', (event) => {
        unlisten();
        resolve(event.payload);
      });
    });

    // Start and cancel
    invoke('download_model', { modelName: 'whisper-medium', modelType: 'whisper' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await invoke('cancel_model_download', { modelName: 'whisper-medium' });

    await expect(cancelledPromise).resolves.toBeDefined();
  });
});
```

### 6. Network Failure Scenarios

**Objective:** Verify system handles network failures gracefully.

**Test Cases:**

#### 6.1 Connection Timeout
```typescript
it('should retry on connection timeout', async () => {
  // Mock network timeout
  // Verify retry logic triggers
  // Verify success after retries
});
```

#### 6.2 Network Unreachable
```typescript
it('should fail gracefully when network unreachable', async () => {
  // Mock network unreachable
  const errorPromise = new Promise((resolve) => {
    listen('model-download-error', (event) => {
      resolve(event.payload);
    });
  });

  // Attempt download
  await invoke('download_model', { modelName: 'whisper-tiny', modelType: 'whisper' });

  const error = await errorPromise;
  expect(error).toContain('network');
});
```

#### 6.3 Intermittent Network
```typescript
it('should resume on intermittent connection', async () => {
  // Mock intermittent network (success, fail, success)
  // Verify download resumes after temporary failure
});
```

### 7. Disk Space Scenarios

**Objective:** Verify disk space checking and handling.

**Test Cases:**

#### 7.1 Sufficient Disk Space
```typescript
it('should proceed with sufficient disk space', async () => {
  const diskUsage = await invoke('get_disk_usage');
  const requiredSpace = 500; // MB

  if (diskUsage.freeSpaceMb > requiredSpace) {
    await invoke('download_model', { modelName: 'whisper-base', modelType: 'whisper' });
    // Should succeed
  }
});
```

#### 7.2 Insufficient Disk Space
```typescript
it('should fail gracefully with insufficient disk space', async () => {
  // Mock disk space check to return low space
  const errorPromise = new Promise((resolve) => {
    listen('model-download-error', (event) => {
      resolve(event.payload);
    });
  });

  // Attempt download
  await invoke('download_model', { modelName: 'whisper-large-v3', modelType: 'whisper' });

  const error = await errorPromise;
  expect(error).toContain('disk space');
});
```

### 8. Download Resumption

**Objective:** Verify interrupted downloads can be resumed.

**Steps:**
1. Start download of large model
2. Interrupt at 50% (kill process)
3. Restart download of same model
4. Verify resumes from 50%

**Expected Results:**
- Download resumes from interruption point
- No data re-downloaded
- Completes successfully

**Test Cases:**
```typescript
describe('Download Resumption', () => {
  it('should resume interrupted download', async () => {
    // Start download
    invoke('download_model', { modelName: 'whisper-large-v3', modelType: 'whisper' });

    // Wait for 50%
    await waitForProgress(50);

    // Kill process (simulate crash)
    await killPythonProcess();

    // Restart download
    await invoke('download_model', { modelName: 'whisper-large-v3', modelType: 'whisper' });

    // Should resume from 50%, not 0%
    const firstProgress = await waitForNextProgress();
    expect(firstProgress.percent).toBeGreaterThan(50);
  });
});
```

### 9. Model Type Variations

**Objective:** Verify downloads work for all model types.

**Test Cases:**
```typescript
describe('Different Model Types', () => {
  const testCases = [
    { name: 'whisper-tiny', type: 'whisper', size: ~75 },
    { name: 'whisper-base', type: 'whisper', size: ~150 },
    { name: 'whisper-small', type: 'whisper', size: ~500 },
    { name: 'whisper-medium', type: 'whisper', size: ~1500 },
    { name: 'whisper-large-v3', type: 'whisper', size: ~3000 },
    { name: 'pyannote/speaker-diarization-3.1', type: 'diarization', size: ~400 },
    { name: 'sherpa-onnx-diarization', type: 'diarization', size: ~100 },
  ];

  testCases.forEach(({ name, type, size }) => {
    it(`should download ${name}`, async () => {
      await invoke('download_model', { modelName: name, modelType: type });

      const models = await invoke('get_local_models');
      const model = models.find((m: LocalModel) => m.name === name);
      expect(model).toBeDefined();
      expect(model.sizeMb).toBeCloseTo(size, 1);
    });
  });
});
```

### 10. Security Tests

**Objective:** Verify security measures are in place.

**Test Cases:**

#### 10.1 Path Traversal Prevention
```typescript
it('should reject path traversal in model names', async () => {
  const maliciousNames = [
    '../../../etc/passwd',
    'whisper-tiny/../../etc/passwd',
    '/absolute/path',
  ];

  for (const name of maliciousNames) {
    await expect(
      invoke('download_model', { modelName: name, modelType: 'whisper' })
    ).rejects.toThrow('Invalid model name');
  }
});
```

#### 10.2 URL Validation
```typescript
it('should validate download URLs', async () => {
  // This would require mocking to test internal URL validation
  // Verify only allowed hosts are used
});
```

#### 10.3 Token File Cleanup
```typescript
it('should clean up token file after download', async () => {
  await invoke('save_huggingface_token', { token: 'test_token' });
  await invoke('download_model', {
    modelName: 'pyannote/speaker-diarization-3.1',
    modelType: 'diarization',
    huggingFaceToken: 'test_token'
  });

  // Verify temp token file is cleaned up
  // This would require checking the temp directory
});
```

## Test Execution

### Run All Integration Tests
```bash
# From project root
bun run test:integration

# Or manually
cd tests/integration
bun test
```

### Run Specific Test Suite
```bash
bun test tests/integration/download-flow.test.ts
bun test tests/integration/concurrent-downloads.test.ts
```

### Run with Coverage
```bash
bun test --coverage
```

## Continuous Integration

### GitHub Actions Workflow
```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        python-version: [3.9, 3.10, 3.11, 3.12]

    steps:
      - uses: actions/checkout@v3
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: ${{ matrix.python-version }}
      - name: Setup Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      - name: Install dependencies
        run: |
          pip install -r ai-engine/requirements.txt
          bun install
      - name: Run integration tests
        run: bun run test:integration
        env:
          HUGGINGFACE_TOKEN: ${{ secrets.TEST_HF_TOKEN }}
```

## Mock Server Setup

For testing without external dependencies, run mock servers:

### HuggingFace Mock Server
```python
# tests/mocks/huggingface_mock.py
from flask import Flask, request, jsonify, send_file
import os

app = Flask(__name__)

@app.route('/api/models/<repo_id>/resolve/<filename>')
def mock_download(repo_id, filename):
    # Return fake model file
    return send_file('fixtures/fake_model.bin')

if __name__ == '__main__':
    app.run(port=5000)
```

### GitHub Releases Mock Server
```python
# tests/mocks/github_mock.py
from flask import Flask, send_file

app = Flask(__name__)

@app.route('/repos/<user>/<repo>/releases/download/<tag>/<filename>')
def mock_github_download(user, repo, tag, filename):
    return send_file(f'fixtures/{filename}')

if __name__ == '__main__':
    app.run(port=5001)
```

## Test Data Management

### Cleanup After Tests
```typescript
afterEach(async () => {
  // Clean up downloaded models
  const models = await invoke('get_local_models');
  for (const model of models) {
    await invoke('delete_model', { modelName: model.name });
  }
});
```

### Test Fixtures
- Small model files (~10MB) for quick tests
- Large model files (simulated) for stress tests
- Corrupted files for error handling tests

## Performance Benchmarks

### Download Speed
- Measure average download speed
- Compare against expected speed
- Alert if significantly slower

### Memory Usage
- Monitor memory during downloads
- Check for memory leaks
- Verify cleanup after completion

### CPU Usage
- Monitor CPU during downloads
- Verify not blocking main thread
- Check UI responsiveness

## Troubleshooting

### Common Issues

1. **Test Fails with Network Error**
   - Check internet connection
   - Verify HuggingFace token is valid
   - Try using mock server

2. **Download Not Progressing**
   - Check Python process is running
   - Verify cache directory is writable
   - Check disk space

3. **Tests Timeout**
   - Increase timeout for large models
   - Use smaller models for testing
   - Check system resources

## Test Metrics to Track

- Success rate of downloads
- Average download time per model
- Failure rate by error type
- Retry success rate
- Cancellation success rate
- Memory usage during downloads
- CPU usage during downloads

## Future Enhancements

1. Add visual regression tests for progress UI
2. Add load testing for concurrent downloads
3. Add cross-platform compatibility tests
4. Add accessibility testing for download UI
5. Add internationalization testing
