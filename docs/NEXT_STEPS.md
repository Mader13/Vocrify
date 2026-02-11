# 🎯 Next Steps: Complete the Fixes

**Status**: CRITICAL vulnerabilities mostly patched | **Updated**: 2026-02-05

---

## ✅ What's Already Fixed

### **Fully Complete (3 CRITICAL + 2 other)**:
1. ✅ **CRITICAL-2**: JSON deserialization protection - 5-layer security
2. ✅ **CRITICAL-3**: URL whitelist for downloads - SSRF prevention
3. ✅ **CRITICAL-5**: Race condition fix - queue overflow prevented
4. ✅ **HIGH-3**: Import error handling - all dependencies covered
5. ✅ **MEDIUM-1**: Language validation - 99 languages supported

### **Partially Complete (2 CRITICAL)**:
6. ⚠️ **CRITICAL-1**: Path validation - scopeguard added, need validation function
7. ⚠️ **CRITICAL-4**: Process cleanup - scopeguard pattern applied

---

## 🔧 Manual Fixes Required

### **CRITICAL-1: Complete Path Validation**

Add to `src-tauri/src/lib.rs`:

```rust
fn validate_file_path(path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path);

    if !path.exists() || !path.is_file() {
        return Err(AppError::NotFound);
    }

    let absolute = path.canonicalize()
        .map_err(|e| AppError::IoError(e))?;

    // Optional: restrict to allowed directories
    if !ALLOWED_DIRS.is_empty() {
        let allowed = ALLOWED_DIRS.iter()
            .any(|dir| absolute.starts_with(dir));
        if !allowed {
            return Err(AppError::AccessDenied);
        }
    }

    Ok(absolute)
}

// In spawn_transcription():
let validated_path = validate_file_path(&file_path)?;
cmd.arg(&validated_path);
```

### **HIGH-2: Error Propagation**

Replace stderr handling in `src-tauri/src/lib.rs:303-317`:

```rust
fn is_critical_error(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("traceback")
        || (lower.contains("error") && !lower.contains("warning"))
        || lower.contains("exception")
}

let stderr_handle = tokio::spawn(async move {
    let mut error_count = 0;
    while let Ok(Some(line)) = stderr_reader.next_line().await {
        if is_critical_error(&line) {
            error_count += 1;
            let _ = app.emit("transcription-error", serde_json::json!({
                "taskId": task_id,
                "error": line,
            }));
        }
    }
    error_count
});

let stderr_errors = stderr_handle.await.unwrap_or(0);
if stderr_errors > 0 {
    return Err(AppError::PythonError(format!(
        "{} errors in stderr", stderr_errors
    )));
}
```

### **HIGH-6: Path Traversal Protection**

Add to `ai-engine/main.py`:

```python
import re
from pathlib import Path

VALID_MODEL_NAME = re.compile(r'^[a-zA-Z0-9_-]+$')

def validate_model_name(model_name: str) -> str:
    if not VALID_MODEL_NAME.match(model_name):
        raise ValueError(f"Invalid model name: {model_name}")
    return model_name

def safe_join(base: Path, *paths: str) -> Path:
    result = Path(base).absolute().resolve()
    for path in paths:
        p = Path(path).absolute().resolve()
        if not p.is_relative_to(result):
            raise ValueError("Path traversal detected")
    return result / path

# In download_model() and delete_model():
model_name = validate_model_name(args.download_model)
target_dir = safe_join(Path(cache_dir), model_name)
```

### **HIGH-7: Secure Token Passing**

Add to `src-tauri/src/lib.rs`:

```rust
use tempfile::NamedTempFile;

fn pass_token_securely(token: &str) -> Result<PathBuf, AppError> {
    let temp_file = NamedTempFile::new()?;
    writeln!(temp_file, "{}", token)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::metadata(temp_file.path())?.permissions();
        let mut new_perms = perms.clone();
        new_perms.set_mode(0o400);
        std::fs::set_permissions(temp_file.path(), new_perms)?;
    }

    let path = temp_file.path().to_path_buf();
    temp_file.keep()?;
    Ok(path)
}

// In spawn_model_download():
if let Some(token) = hugging_face_token {
    let token_file = pass_token_securely(&token)?;
    cmd.arg("--token-file").arg(&token_file);
    // Store token_file for cleanup
}
```

### **MEDIUM-5: Duration Calculation**

Fix in `src-tauri/src/lib.rs:366`:

```rust
let duration = segments.iter()
    .map(|s| s.end)
    .reduce(|a, b| a.max(b))
    .unwrap_or(0.0);

let result = TranscriptionResult {
    segments,
    language: options.language.clone(),
    duration,
};
```

---

## 🧪 Testing Checklist

```bash
# 1. Test Python AI engine
cd ai-engine
python main.py --test

# 2. Test Rust backend
cd src-tauri
cargo test

# 3. Test JSON validation
echo '{"type":"ping"}' | python ai-engine/main.py --server

# 4. Test path validation (should reject)
echo '{"type":"transcribe","file":"../../../etc/passwd"}' | python ai-engine/main.py --server

# 5. Test URL validation
python ai-engine/main.py --download-model malicious --cache-dir ./cache

# 6. Run full app
bun run tauri:dev
```

---

## 📦 Dependencies to Add

### Cargo.toml
```toml
[dependencies]
scopeguard = "1.2"
tempfile = "3"
```

### requirements.txt
```txt
jsonschema>=4.0.0
```

### package.json
```json
{
  "dependencies": {
    "zod": "^3.0.0"
  }
}
```

---

## 🚀 Deployment Readiness

### **Before Production**
- [ ] All CRITICAL fixes complete and tested
- [ ] Security tests passing
- [ ] Error handling verified
- [ ] Documentation updated
- [ ] Monitoring configured

### **Ready for**:
- ✅ Staging deployment (with monitoring)
- ⚠️ Production (after manual fixes)
- ❌ Security audit (need external review)

---

**Last Updated**: 2026-02-05 21:40
**Est. Time to Complete**: 4-6 hours for manual fixes
**Priority**: CRITICAL fixes first, then HIGH
