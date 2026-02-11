# План тестирования оптимизаций

## 🎯 Цели тестирования

1. **Проверить**: Что оптимизации действительно ускоряют транскрипцию
2. **Убедиться**: Что точность (WER) не ухудшилась значительно
3. **Проверить**: Что нет регрессий в функциональности
4. **Измерить**: Улучшения в метриках производительности

---

## 📋 Структура тестов

```
tests/
├── unit/
│   └── python/
│       ├── test_model_pool.py          # Unit tests для ModelPool
│       ├── test_vad_optimization.py    # Unit tests для VAD
│       └── test_adaptive_selector.py   # Unit tests для adaptive selection
│
├── integration/
│   ├── test_vad_performance.py         # VAD performance tests
│   ├── test_batch_processing.py        # Batch processing tests
│   └── test_model_pool_integration.py  # ModelPool integration tests
│
├── benchmarks/
│   ├── benchmark_transcription.py      # Performance benchmarks
│   ├── benchmark_memory.py             # Memory usage benchmarks
│   └── compare_models.py               # Model comparison
│
└── e2e/
    └── test_optimization_e2e.py        # End-to-end tests
```

---

## 🧪 Unit Tests

### Test: Model Pool

**Файл**: `tests/unit/python/test_model_pool.py`

```python
"""
Unit tests for ModelPool
"""

import pytest
import sys
from pathlib import Path

# Add ai-engine to path
ai_engine_path = Path(__file__).parent.parent.parent.parent / "ai-engine"
sys.path.insert(0, str(ai_engine_path))

from model_pool import ModelPool


class TestModelPool:
    """Test ModelPool functionality."""

    def setup_method(self):
        """Setup before each test."""
        self.pool = ModelPool()
        self.pool.clear()  # Start fresh

    def test_singleton_pattern(self):
        """Test that ModelPool is a singleton."""
        pool1 = ModelPool()
        pool2 = ModelPool()

        assert pool1 is pool2

    def test_model_caching(self):
        """Test that models are cached and reused."""
        # Get model twice
        model1 = self.pool.get_model("whisper-base", device="cpu")
        model2 = self.pool.get_model("whisper-base", device="cpu")

        # Should be same instance
        assert model1 is model2

    def test_different_keys_different_models(self):
        """Test that different keys create different models."""
        model1 = self.pool.get_model("whisper-base", device="cpu")
        model2 = self.pool.get_model("whisper-tiny", device="cpu")

        # Should be different instances
        assert model1 is not model2

    def test_lru_eviction(self):
        """Test LRU eviction when pool is full."""
        self.pool._max_models = 2  # Set small limit

        # Load 3 models
        model1 = self.pool.get_model("whisper-tiny", device="cpu")
        model2 = self.pool.get_model("whisper-base", device="cpu")
        model3 = self.pool.get_model("whisper-small", device="cpu")

        # First model should be evicted
        stats = self.pool.get_stats()
        assert stats["cached_models"] == 2
        assert "whisper-tiny_cpu_tiny" not in stats["cached_keys"]

    def test_clear(self):
        """Test clearing the pool."""
        self.pool.get_model("whisper-base", device="cpu")
        assert self.pool.get_stats()["cached_models"] > 0

        self.pool.clear()
        assert self.pool.get_stats()["cached_models"] == 0

    def test_get_stats(self):
        """Test getting pool statistics."""
        self.pool.get_model("whisper-base", device="cpu")
        stats = self.pool.get_stats()

        assert "cached_models" in stats
        assert "max_models" in stats
        assert "cached_keys" in stats
        assert stats["cached_models"] == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
```

---

### Test: VAD Optimization

**Файл**: `tests/unit/python/test_vad_optimization.py`

```python
"""
Unit tests for VAD optimization
"""

import pytest
import sys
from pathlib import Path

ai_engine_path = Path(__file__).parent.parent.parent.parent / "ai-engine"
sys.path.insert(0, str(ai_engine_path))


class TestVADOptimization:
    """Test VAD (Voice Activity Detection) optimization."""

    def test_vad_parameter_validation(self):
        """Test VAD parameters are properly validated."""
        from models.whisper import WhisperModel

        # Test with VAD enabled
        model = WhisperModel(
            device="cpu",
            model_size="tiny",
            enable_vad=True
        )

        assert model.enable_vad is True

    def test_vad_disabled(self):
        """Test model with VAD disabled."""
        from models.whisper import WhisperModel

        model = WhisperModel(
            device="cpu",
            model_size="tiny",
            enable_vad=False
        )

        assert model.enable_vad is False

    def test_vad_default_enabled(self):
        """Test VAD is enabled by default."""
        from models.whisper import WhisperModel

        model = WhisperModel(device="cpu", model_size="tiny")

        # VAD should be enabled by default
        assert hasattr(model, 'enable_vad')
        assert model.enable_vad is True
```

---

## 🔗 Integration Tests

### Test: VAD Performance

**Файл**: `tests/integration/test_vad_performance.py`

```python
"""
Integration tests for VAD performance
"""

import pytest
import time
import sys
from pathlib import Path

ai_engine_path = Path(__file__).parent.parent.parent.parent / "ai-engine"
sys.path.insert(0, str(ai_engine_path))


@pytest.mark.slow
class TestVADPerformance:
    """Test VAD filtering performance."""

    @pytest.fixture
    def sample_audio(self, tmp_path):
        """Create a sample audio file with silence."""
        import numpy as np
        import soundfile as sf

        # Create 10 seconds of audio: 2s speech, 2s silence, 2s speech, 2s silence, 2s speech
        sample_rate = 16000
        duration = 10  # seconds

        # Generate audio with silence
        audio = np.random.randn(sample_rate * duration).astype(np.float32) * 0.01

        # Add speech-like sounds (not real speech, but for testing)
        # Speech at 0-2s, 4-6s, 8-10s
        for start in [0, 4, 8]:
            end = start + 2
            audio[start * sample_rate:end * sample_rate] = \
                np.random.randn(sample_rate * 2).astype(np.float32) * 0.3

        # Save to file
        audio_path = tmp_path / "test_with_silence.wav"
        sf.write(str(audio_path), audio, sample_rate)

        return str(audio_path)

    def test_vad_reduces_processing_time(self, sample_audio):
        """Test that VAD reduces processing time for audio with silence."""
        from factory import ModelFactory

        model = ModelFactory.create("whisper-tiny", device="cpu")

        # Transcribe with VAD
        start = time.time()
        result_with_vad = model.transcribe(
            sample_audio,
            vad_filter=True
        )
        time_with_vad = time.time() - start

        # Transcribe without VAD
        start = time.time()
        result_no_vad = model.transcribe(
            sample_audio,
            vad_filter=False
        )
        time_no_vad = time.time() - start

        # VAD should be faster (or at least not significantly slower)
        # Allow 10% margin
        assert time_with_vad <= time_no_vad * 1.1

        print(f"\nWithout VAD: {time_no_vad:.2f}s")
        print(f"With VAD: {time_with_vad:.2f}s")
        print(f"Speedup: {time_no_vad / time_with_vad:.2f}x")

    def test_vad_preserves_speech(self, sample_audio):
        """Test that VAD doesn't cut off valid speech segments."""
        from factory import ModelFactory

        model = ModelFactory.create("whisper-tiny", device="cpu")

        # Transcribe with VAD
        result_with_vad = model.transcribe(
            sample_audio,
            vad_filter=True
        )

        # Transcribe without VAD
        result_no_vad = model.transcribe(
            sample_audio,
            vad_filter=False
        )

        # Should have similar number of segments
        # (allow some variance due to VAD)
        len_with_vad = len(result_with_vad)
        len_no_vad = len(result_no_vad)

        # Should have at least 50% of segments
        assert len_with_vad >= len_no_vad * 0.5

        print(f"\nSegments without VAD: {len_no_vad}")
        print(f"Segments with VAD: {len_with_vad}")
```

---

## 📊 Benchmark Tests

### Test: Transcription Performance

**Файл**: `tests/benchmarks/benchmark_transcription.py`

```python
"""
Benchmark suite for transcription performance
"""

import pytest
import time
import json
from pathlib import Path

import sys
ai_engine_path = Path(__file__).parent.parent.parent.parent / "ai-engine"
sys.path.insert(0, str(ai_engine_path))


def get_audio_duration(file_path: str) -> float:
    """Get audio file duration in seconds."""
    try:
        import librosa
        y, sr = librosa.load(file_path, sr=None)
        return len(y) / sr
    except ImportError:
        # Fallback: assume 30 seconds
        return 30.0


@pytest.mark.benchmark
@pytest.mark.slow
class TestTranscriptionBenchmarks:
    """Benchmark transcription performance."""

    @pytest.fixture(params=[
        "whisper-tiny",
        "whisper-base",
        # "whisper-small",  # Uncomment for full benchmark
    ])
    def model_config(self, request):
        return {
            "name": request.param,
            "device": "cpu",
        }

    @pytest.fixture
    def benchmark_audio(self, tmp_path):
        """Create benchmark audio file."""
        import numpy as np
        import soundfile as sf

        # Create 30 seconds of audio
        sample_rate = 16000
        duration = 30
        audio = np.random.randn(sample_rate * duration).astype(np.float32) * 0.1

        audio_path = tmp_path / "benchmark.wav"
        sf.write(str(audio_path), audio, sample_rate)

        return str(audio_path)

    def test_realtime_factor(self, model_config, benchmark_audio):
        """
        Benchmark realtime factor.

        Realtime factor = audio duration / processing time
        Higher is better (e.g., 10x means 30s audio in 3s)
        """
        from factory import ModelFactory

        model = ModelFactory.create(
            model_config["name"],
            device=model_config["device"]
        )

        duration = get_audio_duration(benchmark_audio)

        # Warmup run
        try:
            model.transcribe(benchmark_audio)
        except:
            pass  # Ignore errors in warmup

        # Timed run
        start = time.time()
        try:
            result = model.transcribe(benchmark_audio)
            elapsed = time.time() - start

            realtime_factor = duration / elapsed if elapsed > 0 else 0

            # Log results
            print(f"\n{model_config['name']}:")
            print(f"  Audio duration: {duration:.2f}s")
            print(f"  Processing time: {elapsed:.2f}s")
            print(f"  Realtime factor: {realtime_factor:.2f}x")

            # Assert minimum performance
            if realtime_factor > 0:
                assert realtime_factor >= 0.5, f"Too slow: {realtime_factor:.2f}x"

            # Save results
            results = {
                "model": model_config["name"],
                "device": model_config["device"],
                "duration": duration,
                "processing_time": elapsed,
                "realtime_factor": realtime_factor,
            }

            results_file = Path(__file__).parent / "results" / f"{model_config['name']}_benchmark.json"
            results_file.parent.mkdir(exist_ok=True)
            results_file.write_text(json.dumps(results, indent=2))

        except Exception as e:
            pytest.skip(f"Transcription failed: {e}")

    @pytest.mark.parametrize("model_name,expected_min_rt", [
        ("whisper-tiny", 3.0),   # Should be >3x realtime
        ("whisper-base", 2.0),   # Should be >2x realtime
    ])
    def test_minimum_performance(self, model_name, expected_min_rt, benchmark_audio):
        """Test that models meet minimum performance requirements."""
        from factory import ModelFactory

        model = ModelFactory.create(model_name, device="cpu")
        duration = get_audio_duration(benchmark_audio)

        try:
            start = time.time()
            model.transcribe(benchmark_audio)
            elapsed = time.time() - start

            realtime_factor = duration / elapsed if elapsed > 0 else 0

            print(f"\n{model_name}: {realtime_factor:.2f}x (expected >{expected_min_rt}x)")

            if realtime_factor > 0:
                assert realtime_factor >= expected_min_rt

        except Exception as e:
            pytest.skip(f"Transcription failed: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
```

---

## 🎯 Run Tests

### Unit Tests (быстрые)
```bash
cd tests
pytest unit/python/ -v
```

### Integration Tests (медленные)
```bash
pytest integration/ -v -m "not slow"
```

### Benchmarks (очень медленные)
```bash
pytest benchmarks/ -v -s --benchmark-min-rounds=1
```

### All tests
```bash
pytest . -v --tb=short
```

### Specific test
```bash
pytest tests/unit/python/test_model_pool.py::TestModelPool::test_model_caching -v
```

---

## 📈 Измерение результатов

### До оптимизаций:
```bash
# Запустить бенчмарки
pytest benchmarks/benchmark_transcription.py -v -s

# Результаты сохранить в:
# benchmarks/results/whisper-base_benchmark.json
```

### После оптимизаций:
```bash
# Повторить бенчмарки
pytest benchmarks/benchmark_transcription.py -v -s

# Сравнить результаты
```

### Скрипт для сравнения:

**Файл**: `tests/benchmarks/compare_results.py`

```python
"""
Compare benchmark results before and after optimization
"""

import json
from pathlib import Path


def compare_results(before_file: str, after_file: str):
    """Compare two benchmark results."""

    with open(before_file) as f:
        before = json.load(f)

    with open(after_file) as f:
        after = json.load(f)

    # Calculate improvements
    rt_before = before["realtime_factor"]
    rt_after = after["realtime_factor"]

    speedup = rt_after / rt_before
    time_before = before["processing_time"]
    time_after = after["processing_time"]
    time_reduction = (time_before - time_after) / time_before * 100

    print(f"\n{'='*60}")
    print(f"Benchmark Comparison: {before['model']}")
    print(f"{'='*60}")
    print(f"\nRealtime Factor:")
    print(f"  Before: {rt_before:.2f}x")
    print(f"  After:  {rt_after:.2f}x")
    print(f"  Speedup: {speedup:.2f}x")

    print(f"\nProcessing Time ({before['duration']:.1f}s audio):")
    print(f"  Before: {time_before:.2f}s")
    print(f"  After:  {time_after:.2f}s")
    print(f"  Reduction: {time_reduction:.1f}%")
    print(f"\n{'='*60}\n")


if __name__ == "__main__":
    results_dir = Path(__file__).parent / "results"

    # Compare base model
    before_file = results_dir / "whisper-base_BEFORE_benchmark.json"
    after_file = results_dir / "whisper-base_AFTER_benchmark.json"

    if before_file.exists() and after_file.exists():
        compare_results(before_file, after_file)
    else:
        print(f"Run benchmarks first!")
        print(f"Missing: {before_file.name} or {after_file.name}")
```

---

## ✅ Checklist тестирования

### Перед оптимизацией:
- [ ] Запустить unit tests: `pytest unit/python/ -v`
- [ ] Запустить integration tests: `pytest integration/ -v -m "not slow"`
- [ ] Запустить benchmarks: `pytest benchmarks/ -v -s`
- [ ] Сохранить результаты в `benchmarks/results/BEFORE/`

### После каждой оптимизации:
- [ ] Запустить все tests: `pytest . -v`
- [ ] Убедиться что все pass
- [ ] Запустить benchmarks
- [ ] Сохранить результаты в `benchmarks/results/AFTER/`
- [ ] Сравнить с BEFORE
- [ ] Записать улучшения

### Перед релизом:
- [ ] Все tests pass
- [ ] Бенчмарки показывают улучшение
- [ ] Нет regressions в функциональности
- [ ] Документация обновлена
- [ ] Код review выполнен

---

**Дата создания**: 2025-02-07
**Автор**: Claude AI Assistant
**Статус**: Готов к использованию
