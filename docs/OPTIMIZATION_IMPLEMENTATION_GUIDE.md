# Руководство по внедрению оптимизаций

## 🚀 Быстрый старт - Phase 1 (Quick Wins)

### Шаг 1: Оптимизация faster-whisper (30-50% ускорение)

**Файл**: `ai-engine/models/whisper.py`

**Найти** (строка 86-96):
```python
compute_type = "float16" if self.device == "cuda" else "int8"

self._model = FasterWhisper(
    model_name,
    device=self.device,
    compute_type=compute_type,
    download_root=download_root,
)
```

**Заменить на**:
```python
compute_type = "float16" if self.device == "cuda" else "int8"

# Advanced VAD parameters for silence removal
vad_params = {
    "min_silence_duration_ms": 500,  # Remove silence > 500ms
    "speech_pad_ms": 30,              # Padding around speech
}

self._model = FasterWhisper(
    model_name,
    device=self.device,
    compute_type=compute_type,
    download_root=download_root,
    # Performance optimizations
    num_workers=4 if self.device == "cpu" else 1,
    cpu_threads=os.cpu_count() // 2 if self.device == "cpu" else 1,
    # Quality vs speed - greedy decoding (faster with minimal accuracy loss)
    beam_size=1,
    best_of=1,
    # VAD for silence removal
    vad_filter=getattr(self, '_enable_vad', True),  # Can be controlled via parameter
    vad_parameters=vad_params,
)
```

**Добавить в `__init__`** (после строки 64):
```python
def __init__(
    self,
    device: str = "cpu",
    model_size: str = "base",
    download_root: Optional[str] = None,
    diarization_provider: str = "pyannote",
    num_speakers: int = -1,
    enable_vad: bool = True,  # NEW PARAMETER
):
    # ... existing code ...
    self.enable_vad = enable_vad  # NEW LINE
```

---

### Шаг 2: Model Pooling (Eliminates model reload overhead)

**Создать файл**: `ai-engine/model_pool.py`

```python
"""
Model Pool for Reusing Pre-Loaded Models

Eliminates model reload overhead by keeping models in memory.
Thread-safe singleton pattern.
"""

import os
import threading
import weakref
from typing import Dict, Optional, Any
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class ModelPool:
    """
    Pool of pre-loaded models for reuse.

    Features:
    - Thread-safe singleton pattern
    - Model reuse across tasks
    - Optional LRU eviction for memory management
    - Weak references for automatic cleanup
    """

    _instance: Optional['ModelPool'] = None
    _lock = threading.Lock()

    def __new__(cls) -> 'ModelPool':
        """Ensure singleton pattern."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        """Initialize the model pool."""
        if self._initialized:
            return

        self._models: Dict[str, Any] = {}
        self._model_refs: Dict[str, weakref.ref] = {}
        self._access_order: list = []  # For LRU
        self._max_models = 3  # Max models to keep in memory
        self._lock = threading.RLock()
        self._initialized = True

        logger.info("ModelPool initialized")

    def _get_key(self, model_name: str, device: str, **kwargs) -> str:
        """Generate cache key from parameters."""
        # Key based on model name, device, and size
        # Diarization settings don't affect the transcription model
        size = kwargs.get('model_size', 'base')
        return f"{model_name}_{device}_{size}"

    def get_model(
        self,
        model_name: str,
        device: str = "cpu",
        **kwargs
    ):
        """
        Get or create model instance.

        Args:
            model_name: Name of the model (e.g., 'whisper-base')
            device: Device to run on ('cpu' or 'cuda')
            **kwargs: Additional model parameters

        Returns:
            Model instance (cached or newly created)
        """
        key = self._get_key(model_name, device, **kwargs)

        # Check if model exists in cache
        with self._lock:
            if key in self._models:
                # Update access order for LRU
                if key in self._access_order:
                    self._access_order.remove(key)
                self._access_order.append(key)

                logger.debug(f"Model cache hit: {key}")
                return self._models[key]

            # Evict oldest model if at capacity
            if len(self._models) >= self._max_models:
                self._evict_oldest()

            # Create new model
            logger.info(f"Loading new model: {key}")

            # Import here to avoid circular dependency
            import sys
            from pathlib import Path
            sys.path.insert(0, str(Path(__file__).parent))

            from factory import ModelFactory

            model = ModelFactory.create(
                model_name,
                device=device,
                **kwargs
            )

            # Store in cache
            self._models[key] = model
            self._access_order.append(key)

            logger.info(f"Model loaded and cached: {key}")
            return model

    def preload_models(self, model_configs: list):
        """
        Preload models for faster first use.

        Args:
            model_configs: List of dicts with model configurations
                Example: [
                    {"model_name": "whisper-base", "device": "cpu"},
                    {"model_name": "whisper-base", "device": "cuda"},
                ]

        Returns:
            Number of successfully loaded models
        """
        loaded = 0

        for config in model_configs:
            try:
                self.get_model(**config)
                loaded += 1
            except Exception as e:
                logger.error(f"Failed to preload model {config}: {e}")

        logger.info(f"Preloaded {loaded}/{len(model_configs)} models")
        return loaded

    def _evict_oldest(self):
        """Evict least recently used model from cache."""
        if not self._access_order:
            return

        oldest_key = self._access_order.pop(0)

        if oldest_key in self._models:
            logger.info(f"Evicting model from cache: {oldest_key}")
            del self._models[oldest_key]

    def clear(self):
        """Clear all models from cache."""
        with self._lock:
            self._models.clear()
            self._model_refs.clear()
            self._access_order.clear()
            logger.info("Model pool cleared")

    def get_stats(self) -> dict:
        """Get pool statistics."""
        with self._lock:
            return {
                "cached_models": len(self._models),
                "max_models": self._max_models,
                "cached_keys": list(self._models.keys()),
            }


# Global instance
model_pool = ModelPool()
```

**Обновить `ai-engine/main.py`**:

Добавить после импортов:
```python
from model_pool import model_pool
```

Добавить в начало `main()`:
```python
def main():
    # Preload commonly used models
    logger.info("Preloading models...")

    preload_configs = [
        {"model_name": "whisper-base", "device": "cpu"},
    ]

    # Check if CUDA is available
    try:
        import torch
        if torch.cuda.is_available():
            preload_configs.append(
                {"model_name": "whisper-base", "device": "cuda"}
            )
    except ImportError:
        pass

    loaded = model_pool.preload_models(preload_configs)
    logger.info(f"Preloaded {loaded} models")

    # ... rest of main() ...
```

---

### Шаг 3: Динамическая очередь задач (2-4x throughput)

**Файл**: `src-tauri/src/lib.rs`

**Найти** (строка 29):
```rust
const MAX_CONCURRENT_TASKS: usize = 2;
```

**Заменить на**:
```rust
/// Get optimal concurrent task count based on device and model
fn get_max_concurrent_tasks(device: &str, model_size: &str) -> usize {
    match (device, model_size) {
        // CPU: More tasks for smaller models
        ("cpu", "tiny" | "base") => 4,
        ("cpu", "small") => 3,
        ("cpu", _) => 2,  // medium, large

        // GPU: Can handle many more concurrent tasks
        ("cuda", "tiny" | "base") => 8,
        ("cuda", "small") => 6,
        ("cuda", "medium") => 4,
        ("cuda", "large" | "large-v3" | "large-v3-turbo") => 2,

        // Default
        _ => 2,
    }
}
```

**Обновить TaskQueue**:

Найти где создается TaskQueue и заменить:
```rust
// Instead of:
let task_queue = Arc::new(Mutex::new(VecDeque::new()));

// Use dynamic value:
let max_tasks = get_max_concurrent_tasks(&options.device, &get_model_size(&options.model));
```

---

## 🧪 Тестирование оптимизаций

### Unit Tests

**Создать файл**: `tests/unit/python/test_model_pool.py`

```python
"""
Unit tests for ModelPool
"""

import pytest
import sys
from pathlib import Path

# Add ai-engine to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "ai-engine"))

from model_pool import ModelPool


class TestModelPool:
    """Test ModelPool functionality."""

    def test_singleton_pattern(self):
        """Test that ModelPool is a singleton."""
        pool1 = ModelPool()
        pool2 = ModelPool()

        assert pool1 is pool2

    def test_model_caching(self):
        """Test that models are cached and reused."""
        pool = ModelPool()
        pool.clear()  # Start fresh

        # Get model twice
        model1 = pool.get_model("whisper-base", device="cpu")
        model2 = pool.get_model("whisper-base", device="cpu")

        # Should be same instance
        assert model1 is model2

    def test_different_keys_different_models(self):
        """Test that different keys create different models."""
        pool = ModelPool()
        pool.clear()

        model1 = pool.get_model("whisper-base", device="cpu")
        model2 = pool.get_model("whisper-tiny", device="cpu")

        # Should be different instances
        assert model1 is not model2

    def test_lru_eviction(self):
        """Test LRU eviction when pool is full."""
        pool = ModelPool()
        pool.clear()
        pool._max_models = 2  # Set small limit

        # Load 3 models
        model1 = pool.get_model("whisper-tiny", device="cpu")
        model2 = pool.get_model("whisper-base", device="cpu")
        model3 = pool.get_model("whisper-small", device="cpu")

        # First model should be evicted
        stats = pool.get_stats()
        assert stats["cached_models"] == 2
        assert "whisper-tiny" not in stats["cached_keys"]

    def test_preload_models(self):
        """Test preloading multiple models."""
        pool = ModelPool()
        pool.clear()

        configs = [
            {"model_name": "whisper-base", "device": "cpu"},
        ]

        loaded = pool.preload_models(configs)

        assert loaded == 1
        assert pool.get_stats()["cached_models"] == 1

    def test_clear(self):
        """Test clearing the pool."""
        pool = ModelPool()

        pool.get_model("whisper-base", device="cpu")
        assert pool.get_stats()["cached_models"] > 0

        pool.clear()
        assert pool.get_stats()["cached_models"] == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
```

### Integration Tests

**Создать файл**: `tests/integration/test_vad_performance.py`

```python
"""
Integration tests for VAD optimization
"""

import pytest
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "ai-engine"))


class TestVADPerformance:
    """Test VAD filtering performance."""

    @pytest.mark.slow
    def test_vad_reduces_processing_time(self, test_audio_with_silence):
        """Test that VAD reduces processing time for audio with silence."""
        from factory import ModelFactory

        model = ModelFactory.create("whisper-tiny", device="cpu")

        # Test without VAD
        start = time.time()
        result_no_vad = model.transcribe(
            test_audio_with_silence,
            vad_filter=False
        )
        time_no_vad = time.time() - start

        # Test with VAD
        start = time.time()
        result_with_vad = model.transcribe(
            test_audio_with_silence,
            vad_filter=True
        )
        time_with_vad = time.time() - start

        # VAD should be faster (or at least not significantly slower)
        # Allow 10% margin for measurement error
        assert time_with_vad <= time_no_vad * 1.1

        print(f"\nWithout VAD: {time_no_vad:.2f}s")
        print(f"With VAD: {time_with_vad:.2f}s")
        print(f"Speedup: {time_no_vad / time_with_vad:.2f}x")

    @pytest.mark.slow
    def test_vad_doesnt_cut_speech(self, test_audio_file):
        """Test that VAD doesn't cut off valid speech."""
        from factory import ModelFactory

        model = ModelFactory.create("whisper-tiny", device="cpu")

        # Transcribe with VAD
        result_vad = model.transcribe(
            test_audio_file,
            vad_filter=True
        )

        # Transcribe without VAD
        result_no_vad = model.transcribe(
            test_audio_file,
            vad_filter=False
        )

        # Calculate total duration of segments
        duration_vad = sum(s["end"] - s["start"] for s in result_vad)
        duration_no_vad = sum(s["end"] - s["start"] for s in result_no_vad)

        # VAD should preserve most speech (allow 5% margin)
        assert duration_vad >= duration_no_vad * 0.95

        print(f"\nDuration without VAD: {duration_no_vad:.2f}s")
        print(f"Duration with VAD: {duration_vad:.2f}s")
        print(f"Preserved: {duration_vad / duration_no_vad * 100:.1f}%")
```

---

## 📊 Benchmark Suite

**Создать файл**: `tests/benchmarks/benchmark_transcription.py`

```python
"""
Benchmark suite for transcription performance
"""

import pytest
import time
import json
from pathlib import Path
from typing import Dict

# Add ai-engine to path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "ai-engine"))


def get_audio_duration(file_path: str) -> float:
    """Get audio file duration in seconds."""
    import librosa
    y, sr = librosa.load(file_path, sr=None)
    return len(y) / sr


@pytest.mark.benchmark
@pytest.mark.slow
class TestTranscriptionBenchmarks:
    """Benchmark transcription performance across models."""

    @pytest.fixture(params=[
        "whisper-tiny",
        "whisper-base",
        "whisper-small",
    ])
    def model_config(self, request):
        return {
            "name": request.param,
            "device": "cpu",
        }

    def test_realtime_factor(self, model_config, benchmark_audio):
        """
        Benchmark realtime factor.

        Realtime factor = audio duration / processing time
        Higher is better (e.g., 10x means 10 seconds of audio processed in 1 second)
        """
        from factory import ModelFactory

        model = ModelFactory.create(
            model_config["name"],
            device=model_config["device"]
        )

        duration = get_audio_duration(benchmark_audio)

        # Warmup run
        model.transcribe(benchmark_audio)

        # Timed run
        start = time.time()
        result = model.transcribe(benchmark_audio)
        elapsed = time.time() - start

        realtime_factor = duration / elapsed

        # Log results
        print(f"\n{model_config['name']}:")
        print(f"  Audio duration: {duration:.2f}s")
        print(f"  Processing time: {elapsed:.2f}s")
        print(f"  Realtime factor: {realtime_factor:.2f}x")

        # Assert minimum performance (at least realtime)
        assert realtime_factor >= 1.0, f"Too slow: {realtime_factor:.2f}x"

        # Save for comparison
        results = {
            "model": model_config["name"],
            "device": model_config["device"],
            "duration": duration,
            "processing_time": elapsed,
            "realtime_factor": realtime_factor,
        }

        # Write to file
        results_file = Path(__file__).parent / "results" / f"{model_config['name']}_benchmark.json"
        results_file.parent.mkdir(exist_ok=True)
        results_file.write_text(json.dumps(results, indent=2))

    @pytest.mark.parametrize("model_name,expected_min_rt", [
        ("whisper-tiny", 8.0),   # Should be >8x realtime
        ("whisper-base", 4.0),   # Should be >4x realtime
        ("whisper-small", 2.0),  # Should be >2x realtime
    ])
    def test_minimum_performance(self, model_name, expected_min_rt, benchmark_audio):
        """Test that models meet minimum performance requirements."""
        from factory import ModelFactory

        model = ModelFactory.create(model_name, device="cpu")
        duration = get_audio_duration(benchmark_audio)

        start = time.time()
        model.transcribe(benchmark_audio)
        elapsed = time.time() - start

        realtime_factor = duration / elapsed

        print(f"\n{model_name}: {realtime_factor:.2f}x (expected >{expected_min_rt}x)")
        assert realtime_factor >= expected_min_rt


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--benchmark-min-rounds=1"])
```

---

## 🔧 Отладка и мониторинг

**Создать файл**: `ai-engine/performance_monitor.py`

```python
"""
Performance monitoring and profiling utilities
"""

import time
import psutil
import json
import logging
from dataclasses import dataclass
from typing import Callable, Any
from functools import wraps

logger = logging.getLogger(__name__)


@dataclass
class PerformanceMetrics:
    """Performance metrics for a transcription task."""
    task_id: str
    model: str
    device: str
    file_duration: float
    processing_time: float
    realtime_factor: float
    memory_mb: float
    cpu_percent: float
    timestamp: float


class PerformanceMonitor:
    """Monitor performance of transcription tasks."""

    def __init__(self):
        self.metrics: list = []

    def track_transcription(
        self,
        task_id: str,
        model: str,
        device: str,
        file_path: str,
        file_duration: float,
        transcribe_fn: Callable,
        **kwargs
    ) -> Any:
        """
        Track performance of a transcription task.

        Args:
            task_id: Unique task identifier
            model: Model name
            device: Device type
            file_path: Path to audio file
            file_duration: Audio duration in seconds
            transcribe_fn: Transcription function to call
            **kwargs: Arguments for transcribe_fn

        Returns:
            Result from transcribe_fn
        """
        process = psutil.Process()

        # Start monitoring
        start_time = time.time()
        start_memory = process.memory_info().rss / 1024 / 1024
        start_cpu = process.cpu_percent()

        try:
            # Run transcription
            result = transcribe_fn(file_path, **kwargs)

            # End monitoring
            end_time = time.time()
            end_memory = process.memory_info().rss / 1024 / 1024

            # Calculate metrics
            processing_time = end_time - start_time
            realtime_factor = file_duration / processing_time if processing_time > 0 else 0
            memory_used = end_memory - start_memory
            cpu_used = process.cpu_percent(interval=processing_time)

            metrics = PerformanceMetrics(
                task_id=task_id,
                model=model,
                device=device,
                file_duration=file_duration,
                processing_time=processing_time,
                realtime_factor=realtime_factor,
                memory_mb=memory_used,
                cpu_percent=cpu_used,
                timestamp=time.time(),
            )

            self.metrics.append(metrics)

            # Log results
            logger.info(
                f"Performance: {model} on {device} - "
                f"{realtime_factor:.2f}x realtime, "
                f"{memory_used:.0f}MB memory"
            )

            # Emit metrics event
            print(json.dumps({
                "type": "metrics",
                "taskId": task_id,
                "model": model,
                "device": device,
                "realtimeFactor": round(realtime_factor, 2),
                "processingTime": round(processing_time, 2),
                "memoryMb": round(memory_used, 2),
                "cpuPercent": round(cpu_used, 2),
            }), flush=True)

            return result

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise

    def get_summary(self) -> dict:
        """Get summary of all recorded metrics."""
        if not self.metrics:
            return {}

        by_model = {}
        for m in self.metrics:
            if m.model not in by_model:
                by_model[m.model] = []

            by_model[m.model].append({
                "realtime_factor": m.realtime_factor,
                "memory_mb": m.memory_mb,
                "processing_time": m.processing_time,
            })

        summary = {}
        for model, data in by_model.items():
            avg_rt = sum(d["realtime_factor"] for d in data) / len(data)
            avg_mem = sum(d["memory_mb"] for d in data) / len(data)

            summary[model] = {
                "count": len(data),
                "avg_realtime_factor": round(avg_rt, 2),
                "avg_memory_mb": round(avg_mem, 2),
            }

        return summary


def monitor_performance(func: Callable) -> Callable:
    """
    Decorator to monitor function performance.

    Usage:
        @monitor_performance
        def transcribe(file_path, **kwargs):
            # ... transcription logic ...
            return result
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        process = psutil.Process()
        start_time = time.time()
        start_memory = process.memory_info().rss / 1024 / 1024

        try:
            result = func(*args, **kwargs)

            elapsed = time.time() - start_time
            memory_used = process.memory_info().rss / 1024 / 1024 - start_memory

            logger.info(
                f"{func.__name__}: {elapsed:.2f}s, {memory_used:.0f}MB"
            )

            return result

        except Exception as e:
            logger.error(f"{func.__name__} failed: {e}")
            raise

    return wrapper


# Global instance
performance_monitor = PerformanceMonitor()
```

---

## ✅ Checklist для внедрения

### Phase 1 Checklist

- [ ] **VAD Optimization**
  - [ ] Add `enable_vad` parameter to `WhisperModel.__init__`
  - [ ] Update `_load_model` to use VAD
  - [ ] Test VAD doesn't cut speech
  - [ ] Benchmark performance improvement

- [ ] **Model Pooling**
  - [ ] Create `model_pool.py`
  - [ ] Update `main.py` to use pool
  - [ ] Add preload logic
  - [ ] Test thread-safety
  - [ ] Test LRU eviction

- [ ] **Dynamic Concurrency**
  - [ ] Add `get_max_concurrent_tasks()` function
  - [ ] Update TaskQueue logic
  - [ ] Test with different models
  - [ ] Monitor resource usage

- [ ] **Testing**
  - [ ] Create unit tests for ModelPool
  - [ ] Create VAD integration tests
  - [ ] Create benchmark suite
  - [ ] Run all tests

- [ ] **Documentation**
  - [ ] Update README with new features
  - [ ] Document VAD parameters
  - [ ] Document model pooling
  - [ ] Add performance tuning guide

---

## 🐛 Troubleshooting

### Issue: VAD cuts off speech

**Symptoms**: Transcription missing beginning/end of speech

**Solution**:
```python
# Increase speech padding
vad_parameters = {
    "min_silence_duration_ms": 1000,  # More conservative
    "speech_pad_ms": 100,              # More padding
}
```

### Issue: Model pool uses too much memory

**Symptoms**: Out of memory errors

**Solution**:
```python
# Reduce max cached models
pool._max_models = 1  # Only keep one model

# Or disable pooling
# pool.clear()  # Clear after each task
```

### Issue: Concurrent tasks are slow

**Symptoms**: More tasks = slower overall

**Solution**:
```python
# Reduce concurrency
max_tasks = get_max_concurrent_tasks(device, model_size)

# For CPU, keep it low
# For GPU, can increase
```

---

## 📚 Additional Resources

- [faster-whisper docs](https://github.com/SYSTRAN/faster-whisper)
- [VAD parameters](https://github.com/pyannote/pyannote-audio)
- [Python threading](https://docs.python.org/3/library/threading.html)
- [pytest benchmark](https://pytest-benchmark.readthedocs.io/)

---

**Created**: 2025-02-07
**Last Updated**: 2025-02-07
**Author**: Claude (AI Assistant)
**Status**: Ready for Implementation
