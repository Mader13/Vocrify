# Quick Start Guide - Testing Framework

## 5-Minute Setup

```bash
# 1. Install test dependencies
cd tests
pip install -r requirements.txt

# 2. Run a quick smoke test
pytest tests/unit/python/test_main.py::test_json_size_limit_enforcement -v

# 3. Run all Python unit tests (fast, no external dependencies)
pytest tests/unit/python/ -v

# 4. Run Rust unit tests
cargo test --manifest-path=src-tauri/Cargo.toml
```

## Running Tests by Category

### Fast Tests (< 1 minute)
```bash
pytest tests/unit/ -m "not slow" -v
```

### All Unit Tests (~1-2 minutes)
```bash
pytest tests/unit/ -v
```

### Integration Tests (offline, ~5 minutes)
```bash
pytest tests/integration/ -m "not network" -v
```

### All Tests (slow, requires network/models)
```bash
pytest tests/ -v
```

## Running Specific Tests

### By File
```bash
pytest tests/unit/python/test_main.py -v
```

### By Test Name
```bash
pytest tests/unit/python/test_main.py::test_safe_join_prevents_path_traversal -v
```

### By Marker
```bash
# Security tests only
pytest tests/ -m "security" -v

# Network tests only (requires internet)
pytest tests/ -m "network" -v

# Performance tests only
pytest tests/ -m "performance" -v
```

## Generating Coverage Reports

### HTML Report (Recommended)
```bash
pytest tests/unit/python/ --cov=../ai-engine --cov-report=html
# Open in browser
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
start htmlcov/index.html  # Windows
```

### Terminal Report
```bash
pytest tests/unit/python/ --cov=../ai-engine --cov-report=term-missing
```

## Common Test Scenarios

### Test Model Download (requires network)
```bash
pytest tests/integration/test_model_management.py::test_download_whisper_model -v -s
```

### Test Security Validation
```bash
pytest tests/unit/python/test_main.py -k "path_traversal or injection" -v
```

### Test Task Queue
```bash
pytest tests/integration/test_transcription_flow.py::test_max_concurrent_tasks -v
```

## Troubleshooting

### Import Errors
```bash
# Add ai-engine to path
export PYTHONPATH="$PWD/ai-engine:$PYTHONPATH"
# Or run from project root
pytest tests/unit/python/ -v
```

### Tests Timeout
```bash
# Run fast tests only
pytest tests/unit/ -m "not slow" -v
```

### Network Tests Fail
```bash
# Skip network tests
pytest tests/ -m "not network" -v
```

### Missing Models
```bash
# Download test model first
cd ai-engine
python main.py --download-model whisper-tiny --cache-dir /tmp/test_models --model-type whisper
```

## Test Markers Reference

| Marker | Description | Example |
|--------|-------------|---------|
| `unit` | Fast, isolated tests | `pytest -m unit` |
| `integration` | Component interaction tests | `pytest -m integration` |
| `e2e` | Full system tests | `pytest -m e2e` |
| `slow` | Tests taking >10 seconds | `pytest -m "not slow"` |
| `network` | Requires internet | `pytest -m "not network"` |
| `security` | Security tests | `pytest -m security` |
| `gpu` | Requires CUDA | `pytest -m "not gpu"` |
| `models` | Requires downloaded models | `pytest -m "not models"` |
| `performance` | Performance benchmarks | `pytest -m performance` |

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run tests
  run: |
    cd tests
    pip install -r requirements.txt
    pytest tests/unit/ -m "not slow" -v
```

### Pre-Commit Hook
```bash
# .git/hooks/pre-commit
#!/bin/bash
pytest tests/unit/ -m "not slow" -q
```

## Next Steps

1. ✅ Run fast unit tests to verify setup
2. 📖 Read `tests/TEST_PLAN.md` for comprehensive test scenarios
3. 🔒 Review security tests (`test_main.py`)
4. 🚀 Set up CI/CD workflow
5. 📊 Generate coverage report

## Additional Resources

- **Full Test Plan**: `tests/TEST_PLAN.md`
- **Framework Overview**: `tests/README.md`
- **Test Summary**: `tests/TESTING_SUMMARY.md`
- **Project Docs**: `CLAUDE.md`

---

**Need Help?** Check `tests/README.md` for detailed troubleshooting.
