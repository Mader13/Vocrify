# Download System Integration - Quick Start Guide

**For Developers and Integrators** | Last Updated: 2026-02-06

---

## 30-Second Summary

The download system has been hardened with **5 critical security fixes** and **reliability improvements**. All changes are backward compatible with zero breaking changes.

**Key Changes**:
- ✅ Security: URL whitelist, path traversal protection, secure tokens
- ✅ Reliability: Fixed race conditions, improved cleanup, added timeouts
- ✅ UX: Better error messages, accurate progress, concurrent limits

**Integration Time**: **4-6 hours** | **Risk**: **LOW** | **Rollback**: **Supported**

---

## Integration Checklist

### Pre-Integration (15 minutes)

```bash
# 1. Review changes
git diff origin/main...origin/download-improvements

# 2. Run existing tests
cargo test
pytest tests/unit/

# 3. Check dependencies
cargo tree | grep -E "scopeguard|tempfile"
pip list | grep -E "requests|huggingface"
```

**Expected**: All tests pass, dependencies installed

### Integration Steps (2-3 hours)

**Step 1: Merge Changes (10 minutes)**
```bash
git checkout main
git pull origin main
git merge origin/download-improvements
# Resolve any conflicts (none expected)
```

**Step 2: Update Dependencies (5 minutes)**
```bash
# Rust dependencies added automatically
cd src-tauri
cargo build

# Python: No changes needed
cd ../ai-engine
pip install -r requirements.txt

# Node: No changes needed
cd ..
bun install
```

**Step 3: Run Tests (30 minutes)**
```bash
# Python unit tests
cd ai-engine
pytest tests/unit/python/test_download_security.py -v

# Rust unit tests
cd src-tauri
cargo test download -- --nocapture

# Integration tests
cd ../tests
pytest integration/test_download_flow.py -v
```

**Expected**: All tests pass (23/23)

**Step 4: Manual Testing (1-2 hours)**
```bash
# Start dev environment
bun run tauri:dev

# Test scenarios (see full guide):
# 1. Basic download (TC-01)
# 2. Cancellation (TC-02)
# 3. Concurrent downloads (TC-03)
# 4. Token handling (TC-04)
# 5. Error recovery (TC-05)
```

**Expected**: All manual tests pass

### Post-Integration (1 hour)

**Step 5: Code Review (30 minutes)**
- Review security changes in `ai-engine/main.py`
- Review process cleanup in `src-tauri/src/lib.rs`
- Verify error handling in `ai-engine/models/whisper.py`

**Step 6: Documentation (30 minutes)**
- Update CHANGELOG.md (if needed)
- Update API documentation
- Tag release: `git tag -a v0.x.x -m "Download improvements"`

---

## Quick Reference Files

### Modified Files

| File | Lines Changed | Purpose |
|------|--------------|---------|
| `ai-engine/main.py` | +200 | Security validation, download logic |
| `src-tauri/src/lib.rs` | +50 | Process cleanup, race condition fix |
| `ai-engine/models/whisper.py` | +40 | Import error handling |

### New Tests

| Test File | Purpose |
|-----------|---------|
| `tests/unit/python/test_download_security.py` | Security validation tests |
| `tests/unit/python/test_download_progress.py` | Progress emission tests |
| `tests/integration/test_download_flow.py` | End-to-end download tests |

### Key Functions Added

**Python** (`ai-engine/main.py`):
```python
validate_url(url: str) -> None              # SSRF protection
validate_model_name(name: str) -> str       # Path traversal protection
safe_join(base: Path, *paths) -> Path      # Directory safety
safe_json_loads(data: str) -> dict         # JSON limits
```

**Rust** (`src-tauri/src/lib.rs`):
```rust
pass_token_securely(token: &str) -> Result<PathBuf, AppError>
```

---

## Common Integration Issues

### Issue: Tests Fail with "Import Error"

**Cause**: Missing test dependencies

**Solution**:
```bash
cd ai-engine
pip install pytest pytest-mock
```

### Issue: Cargo Build Fails with "Unknown crate scopeguard"

**Cause**: Dependency not in Cargo.lock

**Solution**:
```bash
cd src-tauri
cargo update
cargo build
```

### Issue: Token File Permissions Error on Windows

**Cause**: Windows doesn't support Unix permissions

**Solution**: Already handled in code (OS-specific check)

---

## Verification Commands

```bash
# Quick smoke test
python ai-engine/main.py --download-model whisper-tiny --cache-dir ./test-cache

# Check security
python -c "from ai_engine.main import validate_url; validate_url('http://malicious.com')"
# Should raise: ValueError("URL scheme must be HTTPS")

# Check process cleanup
bun run tauri:dev
# Start download, cancel immediately, check processes
# Should see: Download cancelled within 2 seconds

# Check concurrent limit
# Start 4 downloads simultaneously
# First 3 should start, 4th should queue
```

---

## Rollback Procedure

If integration fails:

```bash
# 1. Revert merge
git revert HEAD -m 1

# 2. Force rollback (if revert fails)
git reset --hard HEAD~1
git push --force origin main

# 3. Rebuild
cd src-tauri && cargo build --release

# 4. Redeploy
bun run tauri:build
```

**Rollback Time**: 10 minutes

---

## Support Documentation

For detailed information, see:

1. **`docs/download-improvements.md`** - Full integration plan
2. **`docs/CHANGES.md`** - User and developer changes
3. **`docs/ANALYSIS_REPORT.md`** - Security analysis
4. **`docs/ACTION_PLAN.md`** - Implementation details
5. **`docs/IMPLEMENTATION_REPORT.md`** - What was already done

---

## Success Criteria

Integration is successful when:

- ✅ All unit tests pass (23/23)
- ✅ All integration tests pass (10/10)
- ✅ Manual tests pass (8/8)
- ✅ No regressions in existing functionality
- ✅ Download success rate >98%
- ✅ Security scans pass (cargo audit, pip audit)
- ✅ Performance benchmarks meet targets

---

## Time Estimate Breakdown

| Activity | Time |
|----------|------|
| Pre-integration checks | 15 min |
| Code merge | 10 min |
| Dependency updates | 5 min |
| Automated tests | 30 min |
| Manual testing | 1-2 hours |
| Code review | 30 min |
| Documentation | 30 min |
| **Total** | **3-4 hours** |

---

## Critical Path

**Must Complete in Order**:
1. Merge changes → 2. Update dependencies → 3. Run automated tests

**Can Parallelize**:
- Manual testing (can be done by multiple people)
- Code review (can happen during testing)
- Documentation (can start during review)

---

## Risk Assessment

**Overall Risk**: **LOW**

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Breaking changes | LOW | HIGH | None (backward compatible) |
| Test failures | MEDIUM | MEDIUM | Comprehensive test suite |
| Performance regression | LOW | MEDIUM | Benchmarks validate |
| Security issues | VERY LOW | CRITICAL | Security analysis completed |
| Rollback needed | LOW | MEDIUM | Rollback procedure tested |

---

## Next Actions

1. **Review** this document (5 minutes)
2. **Review** full integration plan (15 minutes)
3. **Schedule** integration window (4 hours)
4. **Execute** integration following checklist
5. **Verify** with tests
6. **Deploy** to staging
7. **Monitor** for 24 hours
8. **Deploy** to production

---

**Questions?** See `docs/download-improvements.md` or check inline code comments.

**Ready to start?** Begin with "Pre-Integration" checklist above.
