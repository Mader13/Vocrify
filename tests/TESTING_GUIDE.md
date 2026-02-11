# Diarization Testing Guide

## Overview

This guide provides comprehensive testing instructions for the speaker diarization feature in Transcribe Video.

## Test Environment Setup

### Prerequisites

1. **Python 3.8-3.12** (NOT 3.13+)
   ```bash
   cd ai-engine
   python --version  # Must be 3.8-3.12
   ```

2. **Node.js and Bun**
   ```bash
   node --version
   bun --version
   ```

3. **Rust**
   ```bash
   rustc --version
   cargo --version
   ```

### Initial Setup

```bash
# 1. Set up Python environment
cd ai-engine
fix_environment.bat  # Windows
# OR
./fix_environment.sh  # Unix

# 2. Install frontend dependencies
bun install

# 3. Build Rust backend
cd src-tauri
cargo build
```

## Test Suite Structure

```
tests/
├── diarization-test-plan.md      # Comprehensive test plan
├── TESTING_GUIDE.md               # This file
├── run_diarization_tests.bat     # Windows test runner
├── run_diarization_tests.sh      # Unix test runner
├── unit/
│   ├── python/
│   │   └── test_diarization_providers.py  # Python unit tests
│   └── rust/
│       └── test_diarization.rs            # Rust unit tests
└── test-data/
    └── audio-samples/              # Test audio files (create manually)
        ├── short-2speakers.wav     # 30s, 2 speakers
        ├── medium-3speakers.wav    # 5min, 3 speakers
        └── long-4speakers.wav      # 10min, 4 speakers
```

## Running Tests

### Quick Test Run

**Windows:**
```bash
cd tests
run_diarization_tests.bat
```

**Unix/Mac:**
```bash
cd tests
chmod +x run_diarization_tests.sh
./run_diarization_tests.sh
```

### Individual Test Suites

#### Python Unit Tests
```bash
cd ai-engine
source venv/Scripts/activate  # Windows
# OR
source venv/bin/activate       # Unix

pytest ../tests/unit/python/test_diarization_providers.py -v
```

#### Rust Unit Tests
```bash
cargo test --manifest-path=src-tauri/Cargo.toml
```

#### Manual Integration Tests
See "Manual Testing" section below.

## Manual Testing

### Test Case 1: Sherpa-ONNX Basic Flow

**Objective:** Verify sherpa-onnx diarization works end-to-end WITHOUT HuggingFace token.

**Setup:**
1. No HuggingFace token required
2. Install sherpa-onnx-diarization model

**Steps:**
```bash
# 1. Start the application
bun run tauri:dev

# 2. In the app:
#    - Go to Models tab
#    - Download "sherpa-onnx-diarization" model
#    - Wait for download to complete

# 3. Drop an audio file with multiple speakers
#    - Use test-data/audio-samples/short-2speakers.wav

# 4. In diarization options modal:
#    - Toggle "Enable Diarization" to ON
#    - Select "sherpa-onnx" provider
#    - Set "Number of Speakers" to "Auto" or "2"

# 5. Start transcription

# 6. Verify results:
#    - Transcription completes successfully
#    - Each segment has a "speaker" field (e.g., "SPEAKER_00", "SPEAKER_01")
#    - Waveform shows different colors for different speakers
#    - Speaker badges appear on segments
```

**Expected Results:**
- ✅ No HuggingFace token required
- ✅ Speaker labels appear in transcription
- ✅ Waveform colored by speaker
- ✅ Sherpa-ONNX models downloaded from GitHub

### Test Case 2: PyAnnote with HuggingFace Token

**Objective:** Verify pyannote diarization works with valid HuggingFace token.

**Setup:**
1. Get HuggingFace token from https://huggingface.co/settings/tokens
2. Accept pyannote user agreements

**Steps:**
```bash
# 1. Start the application
bun run tauri:dev

# 2. Set HuggingFace token:
#    - Go to Settings
#    - Find "HuggingFace Token" section
#    - Paste your token (format: hf_...)
#    - Click "Save Token"

# 3. In the app:
#    - Go to Models tab
#    - Download "pyannote-diarization" model
#    - Wait for both stages (segmentation + embedding) to complete

# 4. Drop an audio file with multiple speakers
#    - Use test-data/audio-samples/short-2speakers.wav

# 5. In diarization options modal:
#    - Toggle "Enable Diarization" to ON
#    - Select "pyannote" provider
#    - Set "Number of Speakers" to "Auto"

# 6. Start transcription

# 7. Verify results:
#    - Token is used for authentication
#    - PyAnnote models load successfully
#    - Speaker labels appear
#    - Results quality is good
```

**Expected Results:**
- ✅ Token accepted and stored
- ✅ PyAnnote authentication succeeds
- ✅ Models download from HuggingFace
- ✅ Speaker labels appear
- ✅ High-quality diarization results

### Test Case 3: Missing Token Error

**Objective:** Verify clear error message when pyannote is used without token.

**Setup:**
1. Ensure NO HuggingFace token is set
2. Install pyannote-diarization model

**Steps:**
```bash
# 1. Start the application
bun run tauri:dev

# 2. Clear any existing token:
#    - Go to Settings
#    - Find "HuggingFace Token" section
#    - Click "Remove Token" if present

# 3. Drop an audio file

# 4. Enable diarization with pyannote provider

# 5. Start transcription

# 6. Verify error message:
#    - Error is shown quickly (not after long wait)
#    - Error message is clear: "HuggingFace token required"
#    - Error message explains how to fix: "Set token in settings"
#    - App doesn't crash
```

**Expected Results:**
- ✅ Clear error message
- ✅ Error mentions "HuggingFace token"
- ✅ Error explains how to fix
- ✅ Graceful failure (no crash)

### Test Case 4: No Diarization Models Installed

**Objective:** Verify error when user tries diarization without any models.

**Setup:**
1. Uninstall all diarization models (if any)

**Steps:**
```bash
# 1. Start the application
bun run tauri:dev

# 2. Go to Models tab
#    - Delete any existing diarization models

# 3. Drop an audio file

# 4. Try to enable diarization
#    - Modal should show "No diarization models installed"
#    - Provider dropdown should be disabled
#    - Link to download models should be shown

# 5. If somehow enabled, start transcription
#    - Should show clear error
#    - Error should mention missing models
```

**Expected Results:**
- ✅ Clear message about missing models
- ✅ Link to download models
- ✅ Diarization option disabled
- ✅ Helpful error if enabled somehow

### Test Case 5: Provider Selection Logic

**Objective:** Verify automatic provider selection works correctly.

**Setup:**
1. Install sherpa-onnx-diarization only
2. Test with both providers installed
3. Test with only pyannote installed

**Test Scenarios:**

**Scenario A: Only sherpa-onnx installed**
```bash
# 1. Install sherpa-onnx-diarization
# 2. Drop audio file
# 3. Enable diarization
# Expected: Provider auto-selected to "sherpa-onnx"
# Expected: Only sherpa-onnx shown in dropdown
```

**Scenario B: Only pyannote installed**
```bash
# 1. Install pyannote-diarization
# 2. Set HuggingFace token
# 3. Drop audio file
# 4. Enable diarization
# Expected: Provider auto-selected to "pyannote"
# Expected: Only pyannote shown in dropdown
```

**Scenario C: Both installed**
```bash
# 1. Install both models
# 2. Set HuggingFace token
# 3. Drop audio file
# 4. Enable diarization
# Expected: Last used provider selected
# Expected: Both providers shown in dropdown
# Expected: Can switch between providers
```

**Expected Results:**
- ✅ Auto-selection works correctly
- ✅ Dropdown shows only installed providers
- ✅ Last used provider remembered
- ✅ Can manually switch providers

### Test Case 6: Waveform Speaker Coloring

**Objective:** Verify waveform colors match speakers.

**Setup:**
1. Complete a diarized transcription
2. Open transcription view

**Steps:**
```bash
# 1. After transcription completes
# 2. Click on the result to open transcription view

# 3. Check waveform:
#    - Different segments should have different colors
#    - Same speaker should have same color across segments
#    - Colors should be distinct (e.g., blue, red, green)

# 4. Toggle coloring mode:
#    - Find "Color by" dropdown (if available)
#    - Switch between "Segments" and "Speakers"
#    - Verify colors update accordingly

# 5. Check speaker badges:
#    - Each segment should show speaker badge (e.g., "SPEAKER_00")
#    - Badge color should match waveform color
#    - Badge text should be readable
```

**Expected Results:**
- ✅ Waveform colored by speaker
- ✅ Colors consistent per speaker
- ✅ Color switching works
- ✅ Speaker badges visible and colored

### Test Case 7: Export with Speaker Information

**Objective:** Verify exported transcription includes speaker labels.

**Setup:**
1. Complete a diarized transcription

**Steps:**
```bash
# 1. After transcription completes
# 2. Click "Export" button
# 3. Choose format (TXT, SRT, VTT, JSON)
# 4. Save file
# 5. Open exported file
# 6. Verify speaker information included
```

**Expected Results:**
- ✅ TXT format: Speaker labels shown (e.g., "[SPEAKER_00] Hello")
- ✅ SRT format: Speaker labels in subtitle text
- ✅ VTT format: Speaker labels in caption text
- ✅ JSON format: Full speaker metadata

### Test Case 8: Memory and Performance

**Objective:** Verify diarization doesn't cause memory leaks.

**Setup:**
1. Use Task Manager or Process Monitor
2. Use medium-long audio file (5+ minutes)

**Steps:**
```bash
# 1. Open Task Manager
# 2. Note initial memory usage
# 3. Start diarized transcription
# 4. Monitor memory during processing
# 5. After completion, verify memory is freed
# 6. Start another transcription
# 7. Verify memory doesn't grow unbounded
```

**Expected Results:**
- ✅ Memory increases during processing
- ✅ Memory freed after completion
- ✅ No memory leaks across multiple runs
- ✅ Peak memory is reasonable (<2GB for 5min audio)

## Test Results Template

Use this template to document your test results:

```markdown
# Diarization Test Results

**Date:** YYYY-MM-DD
**Tester:** Your Name
**Environment:** Windows/Mac/Linux, Python version

## Summary

| Test Case | Status | Notes |
|-----------|--------|-------|
| Sherpa-ONNX Basic Flow | ⬜ Pass / ⬜ Fail | |
| PyAnnote with Token | ⬜ Pass / ⬜ Fail | |
| Missing Token Error | ⬜ Pass / ⬜ Fail | |
| No Models Installed | ⬜ Pass / ⬜ Fail | |
| Provider Selection | ⬜ Pass / ⬜ Fail | |
| Waveform Coloring | ⬜ Pass / ⬜ Fail | |
| Export with Speakers | ⬜ Pass / ⬜ Fail | |
| Memory and Performance | ⬜ Pass / ⬜ Fail | |

## Detailed Results

### Test Case 1: Sherpa-ONNX Basic Flow
- **Status:** Pass/Fail
- **Issues Found:**
  - Issue 1
  - Issue 2
- **Screenshots:** (attach if applicable)

### Test Case 2: PyAnnote with Token
- **Status:** Pass/Fail
- **Issues Found:**

[... continue for each test case ...]

## Overall Assessment

- **Total Tests:** 8
- **Passed:** X
- **Failed:** Y
- **Blocked:** Z

## Critical Issues

List any critical issues that block release:

1. Issue 1
2. Issue 2

## Recommendations

Recommendations for improvements:

1. Recommendation 1
2. Recommendation 2
```

## Common Issues and Solutions

### Issue: PyAnnote fails with "OSError: Can't load tokenizer"

**Cause:** HuggingFace token not set or invalid

**Solution:**
1. Verify token is set in Settings
2. Token must start with "hf_"
3. Accept user agreements at:
   - https://huggingface.co/pyannote/segmentation-3.0
   - https://huggingface.co/pyannote/embedding

### Issue: Sherpa-ONNX fails with "File not found"

**Cause:** Model files not downloaded correctly

**Solution:**
1. Delete model directory
2. Re-download model
3. Verify all files present:
   - sherpa-onnx-segmentation/
   - sherpa-onnx-embedding/

### Issue: Memory usage keeps growing

**Cause:** Memory leak in diarization

**Solution:**
1. Restart application
2. Report issue with:
   - Audio file duration
   - Python version
   - System specs

### Issue: Speaker labels are wrong

**Cause:** Too many/few speakers specified

**Solution:**
1. Set "Number of Speakers" to "Auto"
2. Or manually set correct number
3. Re-run diarization

## Next Steps

After completing tests:

1. Document all findings in test results template
2. Create GitHub issues for any failures
3. Update test cases based on findings
4. Share results with development team

## Contact

For questions about testing, contact:
- Development team: [github issues]
- Documentation: [link to docs]
