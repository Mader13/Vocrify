# Action Plan: Transcribe Video Fixes

**Status**: Analysis Complete | **Next Steps**: Implementation

---

## 🚨 Critical Fixes Required (Week 1)

### 1. Path Validation (CRITICAL-1)
**File**: `src-tauri/src/lib.rs:273`
```rust
// Add before spawning Python process
fn validate_file_path(path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path);
    if !path.exists() || !path.is_file() {
        return Err(AppError::NotFound);
    }
    let absolute = path.canonicalize()?;
    Ok(absolute)
}
```

### 2. JSON Validation (CRITICAL-2)
**File**: `ai-engine/main.py:737`
```python
MAX_JSON_SIZE = 10 * 1024 * 1024  # 10MB
MAX_JSON_DEPTH = 100

def safe_json_loads(data: str) -> dict:
    if len(data.encode('utf-8')) > MAX_JSON_SIZE:
        raise ValueError("JSON payload too large")
    obj = json.loads(data)
    # Validate depth and structure...
    return obj
```

### 3. URL Whitelist (CRITICAL-3)
**File**: `ai-engine/main.py:212`
```python
ALLOWED_HOSTS = {"github.com", "huggingface.co", "cdn-lfs.huggingface.co"}

def validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("Only HTTPS allowed")
    if parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"Host not allowed: {parsed.hostname}")
```

### 4. Process Cleanup (CRITICAL-4)
**File**: `src-tauri/src/lib.rs:293`
```rust
use scopeguard::scopeguard;

let mut child = cmd.spawn()?;
let child_guard = scopeguard(child, |mut child| {
    let _ = child.start_kill();
});
// ... reading logic ...
let status = child_guard.wait().await?;
scopeguard::into_inner(child_guard);
```

### 5. Race Condition Fix (CRITICAL-5)
**File**: `src-tauri/src/lib.rs:383`
```rust
pub struct TaskManager {
    running_tasks: HashMap<String, JoinHandle<()>>,
    queued_tasks: Vec<TaskState>,
    downloading_models: HashMap<String, JoinHandle<()>>,
    processing_queue: bool, // NEW
}
```

---

## 📋 High Priority Fixes (Week 2)

### 6. Secure Token Passing
**File**: `src-tauri/src/lib.rs:766`
```rust
fn pass_token_securely(token: &str) -> Result<PathBuf, AppError> {
    let temp_file = NamedTempFile::new()?;
    writeln!(temp_file, "{}", token)?;
    // Set read-only permissions
    Ok(temp_file.path().to_path_buf())
}
```

### 7. Path Traversal Protection
**File**: `ai-engine/main.py:377`
```python
VALID_MODEL_NAME = re.compile(r'^[a-zA-Z0-9_-]+$')

def safe_join(base: Path, *paths: str) -> Path:
    result = Path(base).absolute()
    for path in paths:
        p = Path(path).absolute()
        if not p.is_relative_to(result):
            raise ValueError("Path traversal detected")
    return result / path
```

### 8. Download Limits
**File**: `ai-engine/main.py:221`
```python
MAX_DOWNLOAD_SIZE = 2 * 1024 * 1024 * 1024  # 2GB
DOWNLOAD_TIMEOUT = 300  # 5 minutes

response = requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT)
# Check size and enforce limits...
```

---

## 🔧 Medium Priority (Week 3-4)

### 9. Error Handling
- Add specific import error handling in whisper.py
- Implement JSON schema validation
- Add cache directory writability check
- Implement language validation

### 10. Resource Management
- Fix memory leak in sherpa_diarization.py
- Add graceful shutdown (SIGINT/SIGTERM)
- Fix missing duration calculation
- Remove duplicate code

### 11. Code Quality
- Standardize progress reporting
- Fix JSON parsing inconsistency
- Use Path::canonicalize() instead of custom
- Centralize file type validation

---

## ✅ Testing & Documentation (Week 5-6)

### Test Coverage
```bash
# Unit tests
pytest tests/unit/python/
cargo test --unit

# Integration tests
pytest tests/integration/
cargo test --integration

# E2E tests
pytest tests/e2e/
```

### Documentation
- API documentation (all public functions)
- Deployment guide
- Security hardening guide
- Monitoring setup guide

---

## 📊 Implementation Order

### Phase 1: Security (Week 1)
- [ ] CRITICAL-1: Path validation
- [ ] CRITICAL-2: JSON limits
- [ ] CRITICAL-3: URL whitelist
- [ ] CRITICAL-4: Process cleanup
- [ ] CRITICAL-5: Race condition

### Phase 2: Stability (Week 2)
- [ ] HIGH-7: Secure token passing
- [ ] HIGH-6: Path traversal
- [ ] HIGH-8: Safe tar extract
- [ ] HIGH-9: Download limits
- [ ] HIGH-10: Frontend JSON parsing
- [ ] HIGH-1: Cancel cleanup
- [ ] HIGH-2: Error propagation

### Phase 3: Reliability (Week 3)
- [ ] HIGH-3: Import error handling
- [ ] HIGH-4: JSON schema validation
- [ ] HIGH-5: Memory leak fix
- [ ] MEDIUM-3: Cache validation
- [ ] MEDIUM-4: Language validation
- [ ] MEDIUM-5: Graceful shutdown

### Phase 4: Quality (Week 4)
- [ ] MEDIUM-1,6: Duplicate code removal
- [ ] MEDIUM-2: Progress reporting
- [ ] MEDIUM-7: Duration calculation
- [ ] MEDIUM-8: JSON consistency
- [ ] LOW-1,2: Path normalization, file types

### Phase 5: Testing (Week 5-6)
- [ ] Unit tests (95% coverage goal)
- [ ] Integration tests (85% coverage)
- [ ] E2E tests (70% coverage)
- [ ] Edge case tests (90% coverage)
- [ ] Documentation completion

---

## 🎯 Success Metrics

### Before Fixes
- ❌ 100% users affected by process leaks
- ❌ Multiple critical security vulnerabilities
- ❌ Unreliable error detection
- ❌ GPU memory never released

### After Fixes
- ✅ Zero process leaks
- ✅ All critical vulnerabilities patched
- ✅ 95%+ error detection accuracy
- ✅ Proper resource management

---

## 📦 Dependencies to Add

### Cargo.toml (Rust)
```toml
[dependencies]
scopeguard = "1.2"
tempfile = "3"
```

### requirements.txt (Python)
```txt
whisperx==3.1.1
faster-whisper==1.0.1
pyannote.audio==3.1.1
jsonschema>=4.0.0
```

### package.json (TypeScript)
```json
{
  "dependencies": {
    "zod": "^3.0.0"
  }
}
```

---

## 🚀 Quick Start Commands

### Apply Security Fixes (Week 1)
```bash
# Backup current code
git checkout -b before-security-fixes

# Apply patches
git apply patches/security-phase1.patch

# Test
cargo test
pytest tests/unit/

# Deploy
git commit -m "Security: Fix critical vulnerabilities (Phase 1)"
git push origin security-fixes-phase1
```

### Apply Stability Fixes (Week 2)
```bash
git checkout -b stability-fixes
git apply patches/stability-phase1.patch
# Test and deploy...
```

---

## 📞 Support

For questions or clarification:
- Review `docs/ANALYSIS_REPORT.md` for detailed findings
- Check individual fix patches for implementation details
- Run test suites to verify fixes

---

**Last Updated**: 2026-02-05
**Status**: Ready for Implementation
**Total Issues**: 35 | **Critical**: 7 | **High**: 12 | **Medium**: 11 | **Low**: 5
