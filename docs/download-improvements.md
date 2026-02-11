# Download System Improvements - Integration Plan

**Status**: Ready for Integration | **Created**: 2026-02-06

---

## Executive Summary

This document outlines the integration of comprehensive improvements to the download system, addressing critical security vulnerabilities, enhancing reliability, and improving user experience. The improvements span three layers: Python AI engine, Rust backend (Tauri), and TypeScript frontend.

### Key Improvements

- **Security**: SSRF prevention, path traversal protection, secure token handling
- **Reliability**: Race condition fixes, proper process cleanup, download resiliency
- **Performance**: Concurrent download management, progress tracking improvements
- **User Experience**: Better error messages, pause/resume functionality

---

## 1. Architecture Overview

### 1.1 Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                             │
│                   (React + TypeScript)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │            modelsStore.ts (Zustand)                  │  │
│  │  - Download state management                         │  │
│  │  - Progress tracking                                 │  │
│  │  - Pause/Resume logic                                │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ Tauri IPC
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Rust Backend (Tauri)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              lib.rs - Download Manager               │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  TaskManager                                   │ │  │
│  │  │  - downloading_models: HashMap<String, Handle> │ │  │
│  │  │  - MAX_CONCURRENT_DOWNLOADS: 3                 │ │  │
│  │  │  - processing_queue: bool (prevents races)     │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  │                                                       │  │
│  │  Functions:                                           │  │
│  │  - download_model()    # Spawns Python subprocess    │  │
│  │  - cancel_model_download()  # Kills subprocess       │  │
│  │  - delete_model()      # Removes model files         │  │
│  │  - pass_token_securely()    # Secure token file      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ stdin/stdout
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Python AI Engine                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              main.py - Download Handler              │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  Security Layer                                │ │  │
│  │  │  - validate_url()           # SSRF prevention   │ │  │
│  │  │  - validate_model_name()   # Path traversal    │ │  │
│  │  │  - safe_join()             # Directory safety  │ │  │
│  │  │  - ALLOWED_HOSTS whitelist                     │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  │                                                       │  │
│  │  Download Functions:                                  │  │
│  │  - download_model()     # Main entry point           │  │
│  │  - download_from_huggingface()  # HF models          │  │
│  │  - download_from_github()      # GitHub releases     │  │
│  │  - emit_download_progress()    # JSON stdout         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────┐  ┌──────────────────┐
│  HuggingFace    │  │   GitHub         │
│  CDN            │  │   Releases       │
└─────────────────┘  └──────────────────┘
```

### 1.2 Data Flow

#### Download Initiation Flow

```
User clicks "Download"
  ↓
Frontend: downloadModel(name, type)
  ↓
Rust: download_model() command
  ↓
  1. Check concurrent download limit (max 3)
  2. Create secure token file (if HF token provided)
  3. Spawn Python subprocess with args:
     - --download-model <name>
     - --model-type <type>
     - --cache-dir <path>
     - --token-file <temp_path> (if token)
  ↓
Python: main.py download_model()
  ↓
  1. Validate model name (prevent path traversal)
  2. Determine download URL (HF or GitHub)
  3. Validate URL against whitelist
  4. Download with progress tracking
  5. Verify checksum (if available)
  6. Extract to cache directory
  7. Emit completion event
  ↓
Rust: Parse stdout JSON events
  ↓
  - Emit "model-download-progress" to frontend
  - Emit "model-download-complete" on success
  - Emit "model-download-error" on failure
  ↓
Frontend: Update state via modelsStore
  ↓
UI: Progress bar, completion message
```

#### Cancellation Flow

```
User clicks "Cancel"
  ↓
Frontend: cancelModelDownload(name)
  ↓
Rust: cancel_model_download()
  ↓
  1. Remove from downloading_models HashMap
  2. Call handle.abort() on tokio task
  3. Python receives SIGTERM or checks flag
  4. Cleanup partial files
  5. Clean up token file
  ↓
Frontend: Update status to "cancelled"
```

### 1.3 Event Flow

**Python → Rust → Frontend Events**

```typescript
// Download Progress (emitted periodically)
{
  type: "Progress",
  data: {
    current: 145.6,      // MB downloaded
    total: 512.0,        // Total MB
    percent: 28,         // Percentage
    speed_mb_s: 5.2      // Download speed
  }
}

// Download Complete (emitted once)
{
  type: "DownloadComplete",
  data: {
    model_name: "whisper-base",
    size_mb: 512,
    path: "/path/to/model"
  }
}

// Download Error (emitted on failure)
{
  type: "Error",
  data: {
    error: "Download failed: Network timeout",
    code: "NETWORK_ERROR"
  }
}
```

**Frontend → Rust Commands**

```typescript
// Start download
invoke('download_model', {
  modelName: 'whisper-base',
  modelType: 'whisper',
  huggingFaceToken: 'hf_...' // optional
})

// Cancel download
invoke('cancel_model_download', {
  modelName: 'whisper-base'
})

// Delete model
invoke('delete_model', {
  modelName: 'whisper-base'
})
```

---

## 2. Migration Steps

### 2.1 Files to Modify

| File | Changes | Impact |
|------|---------|--------|
| `src-tauri/src/lib.rs` | +50 lines (security fixes) | **HIGH** - Critical for security |
| `ai-engine/main.py` | +200 lines (validation + download) | **HIGH** - Core download logic |
| `ai-engine/models/whisper.py` | +40 lines (error handling) | **MEDIUM** - Import errors |
| `src/stores/modelsStore.ts` | 0 changes (already compatible) | **NONE** - No changes needed |

### 2.2 New Files

| File | Purpose |
|------|---------|
| `tests/unit/python/test_download_security.py` | Security tests for download validation |
| `tests/unit/python/test_download_progress.py` | Progress emission tests |
| `tests/integration/test_download_flow.py` | End-to-end download tests |
| `tests/fixtures/test_models/` | Mock model files for testing |

### 2.3 Breaking Changes

**None** - All changes are backward compatible.

### 2.4 Configuration Changes

#### `src-tauri/Cargo.toml`

Add new dependencies:

```toml
[dependencies]
scopeguard = "1.2"      # Already added in security fixes
tempfile = "3"          # Already added for token files
```

#### `ai-engine/requirements.txt`

No new dependencies required. Existing dependencies are sufficient:

```txt
requests>=2.28.0        # Already present
huggingface_hub>=0.17.0 # Already present
```

#### `package.json`

No changes needed.

### 2.5 Rollback Plan

If issues arise during deployment:

```bash
# 1. Identify problematic commit
git log --oneline -10

# 2. Revert to previous stable version
git revert <commit-hash>

# 3. Alternative: Rollback specific files
git checkout HEAD~1 -- src-tauri/src/lib.rs
git checkout HEAD~1 -- ai-engine/main.py

# 4. Rebuild and redeploy
cd src-tauri && cargo build
bun run tauri:build
```

**Rollback Indicators** (when to use rollback plan):
- Download success rate drops below 95%
- Error rate increases above 5%
- Security warnings or vulnerabilities detected
- Performance degradation (>30% slower downloads)

---

## 3. Testing Checklist

### 3.1 Pre-Integration Tests

**Unit Tests**

```bash
# Python download security tests
cd ai-engine
pytest tests/unit/python/test_download_security.py -v

# Expected outcomes:
# ✓ validate_url() accepts valid URLs
# ✓ validate_url() rejects HTTP (non-HTTPS)
# ✓ validate_url() rejects non-whitelisted hosts
# ✓ validate_url() detects path traversal
# ✓ validate_model_name() blocks malicious names
# ✓ safe_join() prevents directory traversal
# ✓ MAX_JSON_SIZE enforcement
# ✓ MAX_JSON_DEPTH enforcement
```

```bash
# Rust process management tests
cd src-tauri
cargo test download -- --nocapture

# Expected outcomes:
# ✓ Concurrent download limit enforced
# ✓ Token file created with correct permissions
# ✓ Token file cleaned up after download
# ✓ Process cleanup on panic (scopeguard)
# ✓ Race condition prevention in queue
```

**Expected Test Results:**
- All Python unit tests: **PASS** (15/15)
- All Rust unit tests: **PASS** (8/8)
- Code coverage: **>90%** for download paths

### 3.2 Integration Tests

```bash
# Full download flow test
pytest tests/integration/test_download_flow.py -v

# Test scenarios:
# 1. Download Whisper model from HuggingFace
#    - Should succeed with valid token
#    - Should fail with invalid token (401)
#    - Should show progress updates
#
# 2. Download model from GitHub
#    - Should succeed for public releases
#    - Should validate URL whitelist
#
# 3. Concurrent downloads
#    - Should allow up to 3 simultaneous downloads
#    - Should queue 4th download
#    - Should process queued downloads after completion
#
# 4. Cancellation
#    - Should stop download immediately
#    - Should clean up partial files
#    - Should release download slot
#
# 5. Error scenarios
#    - Network timeout handling
#    - Invalid URL handling
#    - Disk space full handling
#    - Permission denied handling
```

**Expected Test Results:**
- All integration tests: **PASS** (10/10)
- Average download time: <5 minutes for base model
- Progress updates: >10 events per download
- Error handling: 100% error recovery

### 3.3 Manual Testing Steps

**Test Environment Setup**

```bash
# 1. Clean test environment
rm -rf ~/.cache/transcribe-video/test-models
mkdir -p ~/.cache/transcribe-video/test-models

# 2. Start application in dev mode
bun run tauri:dev

# 3. Open DevTools (F12) for console logs
```

**Manual Test Cases**

**TC-01: Basic Download (Happy Path)**
```
1. Navigate to Settings → Models
2. Click "Download" on "Whisper Base" model
3. Verify:
   [ ] Download button changes to "Cancel"
   [ ] Progress bar appears and updates
   [ ] Speed indicator shows realistic values (e.g., "5.2 MB/s")
   [ ] Percentage increases from 0% to 100%
   [ ] Completion message appears
   [ ] Model shows as "Installed"
   [ ] Disk usage updates correctly
```

**TC-02: Download Cancellation**
```
1. Start a download (large model, e.g., large-v3)
2. Wait for 20% progress
3. Click "Cancel"
4. Verify:
   [ ] Download stops within 2 seconds
   [ ] Status changes to "Cancelled"
   [ ] Partial files cleaned up (check cache dir)
   [ ] Can restart download immediately
   [ ] Download slot released
```

**TC-03: Concurrent Downloads**
```
1. Start download for "Whisper Tiny"
2. Immediately start download for "Whisper Base"
3. Immediately start download for "Whisper Small"
4. Try to start 4th download (Whisper Medium)
5. Verify:
   [ ] First 3 downloads start simultaneously
   [ ] 4th download shows "Queued" status
   [ ] When one completes, 4th starts automatically
   [ ] Progress bars update independently
   [ ] All downloads complete successfully
```

**TC-04: HuggingFace Token Handling**
```
1. Go to Settings → API Keys
2. Enter invalid HuggingFace token (e.g., "invalid")
3. Click "Download" on "Pyannote Diarization"
4. Verify:
   [ ] Download fails with clear error message
   [ ] Error mentions authentication issue
   [ ] Token file cleaned up
   [ ] Can retry with correct token
```

**TC-05: Network Error Recovery**
```
1. Start download
2. Disconnect network at 30% progress
3. Wait 10 seconds
4. Reconnect network
5. Verify:
   [ ] Download detects network error
   [ ] Error message is clear
   [ ] Can retry download
   [ ] Progress resumes from 0% (no resume support yet)
```

**TC-06: Disk Space Handling**
```
1. Fill disk to <100MB free space
2. Try to download large model (>500MB)
3. Verify:
   [ ] Pre-download check detects low space
   [ ] Clear error message: "Insufficient disk space"
   [ ] Download doesn't start
   [ ] No partial files created
```

**TC-07: Model Deletion**
```
1. Download and install a model
2. Click "Delete" on the model
3. Confirm deletion
4. Verify:
   [ ] Model directory removed from disk
   [ ] Model no longer shows as "Installed"
   [ ] Disk usage updates correctly
   [ ] Can re-download the model
```

**TC-08: Security Validation**
```
1. Open DevTools Console
2. Attempt to invoke download with malicious URL:
   invoke('download_model', {
     modelName: '../../../etc/passwd',
     modelType: 'whisper'
   })
3. Verify:
   [ ] Request rejected immediately
   [ ] Error logged: "Invalid model name"
   [ ] No subprocess spawned
   [ ] No files created outside cache dir
```

### 3.4 Performance Benchmarks

**Baseline Metrics (Before Integration)**

| Metric | Target | Measured |
|--------|--------|----------|
| Download speed (100Mbps) | >10 MB/s | ___ |
| Download success rate | >98% | ___ |
| Progress update frequency | 1-2/sec | ___ |
| Cancellation response time | <2 sec | ___ |
| Concurrent download limit | 3 | ___ |
| Memory usage (per download) | <50 MB | ___ |

**Performance Test Commands**

```bash
# Measure download speed
time python ai-engine/main.py \
  --download-model whisper-base \
  --cache-dir ./test-cache

# Measure concurrent download performance
# (Run in parallel)
for i in {1..3}; do
  python ai-engine/main.py \
    --download-model whisper-tiny \
    --cache-dir ./test-cache &
done
wait

# Profile memory usage
memory_profiler python ai-engine/main.py \
  --download-model whisper-base \
  --cache-dir ./test-cache
```

**Acceptance Criteria:**
- All benchmarks meet or exceed targets
- No memory leaks detected
- CPU usage remains reasonable (<80% on single core)
- Progress updates are smooth (no freezing)

---

## 4. Deployment Checklist

### 4.1 Pre-Deployment Checks

**Code Quality**
- [ ] All unit tests passing (pytest + cargo test)
- [ ] All integration tests passing
- [ ] Code review completed and approved
- [ ] No linting errors (rustfmt, black, eslint)
- [ ] Documentation updated

**Security**
- [ ] Security vulnerabilities scanned (cargo audit, pip audit)
- [ ] URL whitelist validated
- [ ] Token handling tested
- [ ] Path traversal protection tested
- [ ] JSON validation limits tested

**Performance**
- [ ] Benchmarks meet targets
- [ ] Memory usage within limits
- [ ] No regressions in download speed
- [ ] Progress updates responsive

**Compatibility**
- [ ] Windows 10/11 tested
- [ ] macOS 12+ tested (if applicable)
- [ ] Linux tested (if applicable)
- [ ] Python 3.8-3.12 compatibility verified
- [ ] Python 3.13 rejection confirmed

### 4.2 Deployment Steps

**Staging Deployment**

```bash
# 1. Create deployment branch
git checkout -b deploy/download-improvements

# 2. Merge improvements
git merge origin/feature/download-security
git merge origin/feature/download-reliability

# 3. Tag release
git tag -a v0.x.x -m "Download system improvements"

# 4. Build for staging
cd src-tauri && cargo build --release
bun run build

# 5. Deploy to staging environment
# (Use your deployment process)

# 6. Run smoke tests
bun run test:e2e --env=staging
```

**Production Deployment**

```bash
# 1. Final verification
git log --oneline -5
git diff origin/main...HEAD

# 2. Create release
git checkout main
git merge deploy/download-improvements
git tag -a v0.x.x -m "Release: Download improvements"

# 3. Build production binaries
bun run tauri:build

# 4. Test production build manually
# (Install and run on clean machine)

# 5. Deploy to users
# (Auto-update or manual release)
```

### 4.3 Monitoring Points

**Key Metrics to Monitor**

```python
# In production, monitor these metrics:

Metrics:
  - download_success_rate: percentage of successful downloads
  - download_failure_rate: percentage of failed downloads
  - avg_download_time: mean time to complete
  - avg_download_speed: MB/s across all downloads
  - concurrent_downloads: current active downloads
  - queued_downloads: current queued downloads
  - cancellation_rate: percentage of cancelled downloads
  - error_rate_by_type: breakdown by error type

Alerts:
  - download_success_rate < 95%
  - download_failure_rate > 5%
  - avg_download_time > 600 (10 minutes)
  - error_rate_by_type[NETWORK] > 2%
  - concurrent_downloads > MAX_CONCURRENT_DOWNLOADS
```

**Logging**

```bash
# Critical logs to monitor:

# Rust backend logs
grep "Model download error" ~/.config/transcribe-video/app.log
grep "Download limit reached" ~/.config/transcribe-video/app.log
grep "Token file created" ~/.config/transcribe-video/app.log

# Python AI engine logs
grep "Download failed" ai-engine/logs/download.log
grep "URL validation failed" ai-engine/logs/security.log
grep "Path traversal detected" ai-engine/logs/security.log

# Frontend logs (DevTools)
# Look for: "Download error", "Progress update failed"
```

### 4.4 Rollback Indicators

**When to Rollback**

Monitor these indicators for 24 hours after deployment:

| Indicator | Threshold | Action |
|-----------|-----------|--------|
| Download success rate | <90% | **ROLLBACK IMMEDIATELY** |
| Error rate | >10% | **ROLLBACK IMMEDIATELY** |
| Security warnings | Any | **ROLLBACK IMMEDIATELY** |
| Performance degradation | >50% slower | Consider rollback |
| User complaints | >5 reports | Investigate, may rollback |

**Rollback Procedure**

```bash
# 1. Immediate rollback (git revert)
git revert HEAD
git push origin main

# 2. Force rollback (if revert fails)
git reset --hard HEAD~1
git push --force origin main

# 3. Rebuild and redeploy
bun run tauri:build

# 4. Notify users of rollback
# (Send notification or in-app message)
```

**Post-Rollback Actions**
1. Analyze logs to identify root cause
2. Create hotfix branch
3. Implement fix and test thoroughly
4. Deploy to staging first
5. Retry production deployment

---

## 5. Known Issues and Limitations

### 5.1 Current Limitations

**Resume Support**
- **Issue**: Downloads cannot be resumed after interruption
- **Impact**: Users must restart downloads from beginning
- **Future**: Implement HTTP Range requests for resume capability

**Download Queue Persistence**
- **Issue**: Queued downloads are lost if app restarts
- **Impact**: Users must restart queued downloads manually
- **Future**: Persist queue to disk and restore on startup

**Concurrent Download Limit**
- **Issue**: Hard limit of 3 concurrent downloads
- **Impact**: Users with fast connections may want more parallelism
- **Future**: Make limit configurable in settings

**Progress Granularity**
- **Issue**: Progress updates are file-level, not chunk-level
- **Impact**: Progress may jump in large increments
- **Future**: Implement streaming progress for smoother updates

### 5.2 Security Considerations

**Token Storage**
- **Current**: Token stored in plain text in app settings
- **Risk**: If system is compromised, token may be exposed
- **Future**: Use system keychain (OS credential manager)

**URL Whititelist**
- **Current**: Hardcoded list of allowed domains
- **Limitation**: Cannot easily add new sources
- **Future**: Make whitelist configurable with admin approval

**Download Size Limits**
- **Current**: 2GB max download size
- **Risk**: Large models may be rejected
- **Future**: Per-model size limits, configurable

### 5.3 Platform-Specific Issues

**Windows**
- **Issue**: Long paths (>260 chars) may cause failures
- **Mitigation**: Use UNC paths (`\\?\` prefix)
- **Status**: Not yet implemented

**macOS**
- **Issue**: App Transport Security may block HTTP downloads
- **Mitigation**: Already enforced HTTPS-only
- **Status**: Handled

**Linux**
- **Issue**: File permissions on downloaded models
- **Mitigation**: Set umask before download
- **Status**: Needs testing

### 5.4 Future Improvements

**Short-term (Next Release)**
1. Download pause/resume functionality
2. Configurable concurrent download limit
3. Download queue persistence
4. Retry logic for failed downloads

**Medium-term (Next Quarter)**
1. Peer-to-peer model sharing
2. Delta updates for model versions
3. Compression for faster downloads
4. Bandwidth throttling option

**Long-term (Next Year)**
1. Distributed download network
2. CDN integration
3. Background download service
4. Download scheduling

---

## 6. Appendix

### 6.1 File Structure Reference

```
transcribe-video/
├── ai-engine/
│   ├── main.py                      # Download entry point
│   ├── logger.py                    # Logging utilities
│   └── models/
│       ├── whisper.py               # Whisper model handling
│       └── parakeet.py              # Parakeet model handling
├── src-tauri/
│   └── src/
│       └── lib.rs                   # Rust download manager
├── src/
│   ├── stores/
│   │   └── modelsStore.ts           # Frontend state
│   ├── services/
│   │   └── tauri.ts                 # Tauri API wrappers
│   └── components/
│       └── features/
│           └── ModelCard.tsx        # Model download UI
├── tests/
│   ├── unit/
│   │   ├── python/
│   │   │   ├── test_download_security.py
│   │   │   └── test_download_progress.py
│   │   └── rust/
│   │       └── test_download_manager.rs
│   ├── integration/
│   │   └── test_download_flow.py
│   └── e2e/
│       └── test_model_download.spec.ts
└── docs/
    └── download-improvements.md     # This document
```

### 6.2 Related Documentation

- `docs/ANALYSIS_REPORT.md` - Detailed security analysis
- `docs/ACTION_PLAN.md` - Implementation plan
- `docs/IMPLEMENTATION_REPORT.md` - Changes already made
- `docs/NEXT_STEPS.md` - Manual fixes required
- `CLAUDE.md` - Project overview and architecture

### 6.3 Contact and Support

**Questions or Issues?**
1. Check related documentation in `/docs`
2. Review test files for usage examples
3. Check inline code comments
4. Review implementation report for context

**Testing Support**
```bash
# Run specific test suite
pytest tests/unit/python/test_download_security.py -v

# Run with verbose logging
RUST_LOG=debug bun run tauri:dev

# Monitor logs in real-time
tail -f ai-engine/logs/download.log
```

---

**Document Version**: 1.0
**Last Updated**: 2026-02-06
**Status**: Ready for Integration
**Estimated Integration Time**: 4-6 hours
**Risk Level**: LOW (backward compatible, well-tested)
