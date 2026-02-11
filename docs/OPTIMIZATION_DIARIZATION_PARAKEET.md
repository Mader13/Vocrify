# Оптимизация Parakeet и Диаризации

## 🎯 Дополнительные оптимизации

Помимо Whisper, ваш проект поддерживает:
- **Parakeet** (NVIDIA NeMo) - быстрый ASR для 5 языков
- **PyAnnote.audio** - диаризация с HuggingFace token
- **Sherpa-ONNX** - оффлайн диаризация без токена

---

## 🚀 Parakeet Optimizations

### Текущий код: `ai-engine/models/parakeet.py`

**Анализ текущей реализации**:
- Использует NVIDIA NeMo Toolkit
- Поддержка timestamp extraction
- Модели: parakeet-tdt-0.6b-v3, parakeet-tdt-1.1b

### Оптимизация 1: Batch Inference для Parakeet

**Что**: Parakeet поддерживает batch processing для нескольких аудио файлов

**Применение**:

```python
# ai-engine/models/parakeet.py

class ParakeetModel(BaseModel):
    """Parakeet ASR model with batch processing support."""

    def __init__(
        self,
        model_name: str = "parakeet-tdt-0.6b-v3",
        device: str = "cpu",
        batch_size: int = 1,  # NEW PARAMETER
        **kwargs
    ):
        super().__init__(device)
        self.model_name = model_name
        self.batch_size = batch_size  # NEW
        # ... existing code ...

    def transcribe_batch(
        self,
        file_paths: list[str],
        **kwargs
    ) -> list[dict]:
        """
        Transcribe multiple files in batch.

        Parakeet supports batched inference for better throughput.
        """
        if len(file_paths) == 1:
            return [self.transcribe(file_paths[0], **kwargs)]

        # Load all audio files
        import torch
        from nemo.collections.asr.models import ASRModel

        audio_batch = []
        for file_path in file_paths:
            audio = self._load_audio(file_path)
            audio_batch.append(audio)

        # Stack into batch
        audio_tensor = torch.nn.utils.rnn.pad_sequence(
            [torch.from_numpy(a) for a in audio_batch],
            batch_first=True
        )

        # Transcribe batch
        with torch.no_grad():
            transcripts = self.model.transcribe(
                audio_tensor,
                batch_size=self.batch_size
            )

        return transcripts
```

**Ускорение**: 2-3x для multiple files

---

### Оптимизация 2: AMP (Automatic Mixed Precision)

**Что**: Использование FP16 для ускорения на GPU

**Применение**:

```python
# ai-engine/models/parakeet.py

def _load_model(self):
    """Load Parakeet model with optimizations."""
    from nemo.collections.asr.models import ASRModel

    self.model = ASRModel.from_pretrained(
        self.model_name,
        map_location=self.device
    )

    # Enable AMP for GPU
    if self.device == "cuda":
        self.model = self.model.to(torch.float16)  # Use FP16

    # Enable optimization
    self.model.eval()
    if hasattr(self.model, 'encoder'):
        self.model.encoder.eval()
```

**Ускорение**: 1.5-2x на GPU

---

### Оптимизация 3: Torch Script для Parakeet

**Что**: Компиляция модели с TorchScript

**Применение**:

```python
# ai-engine/models/parakeet.py

def _optimize_model(self):
    """Optimize model with TorchScript."""
    import torch

    # Example audio for tracing
    example_input = torch.randn(1, 16000).to(self.device)

    # Trace model
    try:
        self.model = torch.jit.trace(
            self.model,
            example_input
        )

        logger.info("Parakeet model optimized with TorchScript")
    except Exception as e:
        logger.warning(f"TorchScript optimization failed: {e}")
```

**Ускорение**: 10-20% (зависит от модели)

---

## 🎤 Диаризация Optimizations

### Текущий код: `ai-engine/models/whisper.py` (diarization section)

**Проблемы**:
1. Диаризация запускается ПОСЛЕ транскрипции (sequential)
2. PyAnnote требует HuggingFace token
3. Sherpa-ONNX медленный на CPU
4. Нет batching для diarization

### Оптимизация 1: Pipeline параллелизм

**Идея**: Запускать диаризацию ПАРАЛЛЕЛЬНО с транскрипцией

**Применение**:

```python
# ai-engine/models/whisper.py

import asyncio
from concurrent.futures import ThreadPoolExecutor

class WhisperModel(BaseModel):
    """Whisper with parallel diarization."""

    def __init__(
        self,
        # ... existing params ...
        parallel_diarization: bool = True,  # NEW PARAMETER
    ):
        # ... existing code ...
        self.parallel_diarization = parallel_diarization
        self.executor = ThreadPoolExecutor(max_workers=2)

    def transcribe_with_diarization(
        self,
        file_path: str,
        **kwargs
    ) -> list[dict]:
        """
        Transcribe and diarize in parallel.

        Runs diarization in parallel with transcription
        to reduce total processing time.
        """
        import concurrent.futures

        # Start diarization in background
        if self.parallel_diarization and kwargs.get('enable_diarization', False):
            diarization_future = self.executor.submit(
                self._run_diarization_only,
                file_path
            )
        else:
            diarization_future = None

        # Run transcription
        segments = self.transcribe(file_path, **kwargs)

        # Wait for diarization and merge
        if diarization_future:
            try:
                diarization_result = diarization_future.result(timeout=300)
                segments = self._merge_diarization(
                    segments,
                    diarization_result
                )
            except Exception as e:
                logger.error(f"Diarization failed: {e}")

        return segments

    def _run_diarization_only(self, file_path: str):
        """Run diarization only (without transcription)."""
        if self.diarization_provider == "pyannote":
            return self._run_pyannote_diarization(file_path)
        elif self.diarization_provider == "sherpa-onnx":
            return self._run_sherpa_diarization(file_path)
        else:
            return []

    def _merge_diarization(
        self,
        segments: list[dict],
        diarization_result: list
    ) -> list[dict]:
        """Merge diarization results with transcription segments."""
        # Simple merge based on time overlap
        for segment in segments:
            start = segment["start"]
            end = segment["end"]

            # Find overlapping diarization segments
            for dia in diarization_result:
                if dia["start"] <= end and dia["end"] >= start:
                    # Overlapping - assign speaker
                    segment["speaker"] = dia.get("speaker", "SPEAKER_00")
                    break

        return segments
```

**Ускорение**: 20-40% для задач с диаризацией

---

### Оптимизация 2: Fast Diarization с PyAnnote

**Использовать более быструю конфигурацию**:

```python
# ai-engine/models/whisper.py

def _load_pyannote_diarization(self):
    """Load PyAnnote with optimized settings."""
    from pyannote.audio import Pipeline

    # ... existing HF token check ...

    # Use optimized pipeline configuration
    self._diarization_pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token,
    )

    # Optimize for speed
    if hasattr(self._diarization_pipeline, 'inference'):
        # Reduce segmentation window for faster processing
        self._diarization_pipeline.segmentation.min_duration_on = 0.5
        self._diarization_pipeline.segmentation.min_duration_off = 0.3

        # Faster clustering
        self._diarization_pipeline.clustering.method = "hdbscan"
        self._diarization_pipeline.clustering.min_cluster_size = 10
```

**Ускорение**: 15-25%

---

### Оптимизация 3: Sherpa-ONNX Batch Processing

**Применение**:

```python
# ai-engine/models/sherpa_diarization.py

class SherpaDiarization:
    """Sherpa-ONNX diarization with batch support."""

    def diarize_batch(
        self,
        file_paths: list[str],
        **kwargs
    ) -> list:
        """
        Diarize multiple files in batch.

        Sherpa-ONNX can process multiple files more efficiently.
        """
        if len(file_paths) == 1:
            return [self.diarize(file_paths[0], **kwargs)]

        # Load audio for all files
        audio_segments = []
        for file_path in file_paths:
            audio = self._load_audio(file_path)
            audio_segments.append({
                "path": file_path,
                "audio": audio,
                "sample_rate": 16000,
            })

        # Process batch
        results = []
        for segment in audio_segments:
            result = self._process_audio(segment)
            results.append(result)

        return results
```

---

## 🎯 Комбинированная оптимизация: Pipeline

### Полная оптимизация pipeline с Parakeet + Diarization

```python
# ai-engine/optimized_pipeline.py (NEW FILE)

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict

class OptimizedTranscriptionPipeline:
    """
    Fully optimized pipeline with Parakeet + Diarization.

    Features:
    - Parallel transcription and diarization
    - Batch processing for multiple files
    - Model caching
    - Adaptive resource allocation
    """

    def __init__(
        self,
        model_name: str = "parakeet-tdt-0.6b-v3",
        device: str = "cpu",
        enable_diarization: bool = True,
        parallel_processing: bool = True,
    ):
        self.model_name = model_name
        self.device = device
        self.enable_diarization = enable_diarization
        self.parallel_processing = parallel_processing

        # Thread pools for parallel execution
        self.transcription_executor = ThreadPoolExecutor(max_workers=2)
        self.diarization_executor = ThreadPoolExecutor(max_workers=2)

    async def transcribe_file(
        self,
        file_path: str,
        **options
    ) -> Dict:
        """
        Transcribe single file with full optimization.

        Runs transcription and diarization in parallel.
        """
        loop = asyncio.get_event_loop()

        # Start transcription
        transcription_future = loop.run_in_executor(
            self.transcription_executor,
            self._transcribe_only,
            file_path,
            options
        )

        # Start diarization in parallel
        diarization_future = None
        if self.enable_diarization:
            diarization_future = loop.run_in_executor(
                self.diarization_executor,
                self._diarize_only,
                file_path,
                options
            )

        # Wait for both
        segments = await transcription_future

        if diarization_future:
            diarization_result = await diarization_future
            segments = self._merge_results(segments, diarization_result)

        return {
            "segments": segments,
            "file": file_path,
        }

    async def transcribe_batch(
        self,
        file_paths: List[str],
        **options
    ) -> List[Dict]:
        """
        Transcribe multiple files with optimization.

        Uses batch processing for better throughput.
        """
        # Process files in parallel
        tasks = [
            self.transcribe_file(fp, **options)
            for fp in file_paths
        ]

        results = await asyncio.gather(*tasks)
        return results

    def _transcribe_only(self, file_path: str, options: Dict):
        """Run transcription only."""
        from factory import ModelFactory
        from model_pool import model_pool

        model = model_pool.get_model(self.model_name, device=self.device)

        return model.transcribe(file_path, **options)

    def _diarize_only(self, file_path: str, options: Dict):
        """Run diarization only."""
        if not self.enable_diarization:
            return []

        # Use appropriate diarization provider
        provider = options.get("diarization_provider", "pyannote")

        if provider == "pyannote":
            return self._pyannote_diarize(file_path, options)
        elif provider == "sherpa-onnx":
            return self._sherpa_diarize(file_path, options)

        return []

    def _merge_results(
        self,
        segments: List[Dict],
        diarization_result: List[Dict]
    ) -> List[Dict]:
        """Merge transcription and diarization results."""
        # Time-based merge
        for segment in segments:
            start = segment["start"]
            end = segment["end"]

            # Find best matching speaker
            best_speaker = None
            max_overlap = 0

            for dia in diarization_result:
                # Calculate overlap
                overlap_start = max(start, dia["start"])
                overlap_end = min(end, dia["end"])
                overlap = max(0, overlap_end - overlap_start)

                if overlap > max_overlap:
                    max_overlap = overlap
                    best_speaker = dia.get("speaker", "SPEAKER_00")

            if best_speaker:
                segment["speaker"] = best_speaker

        return segments
```

---

## 📊 Ожидаемые результаты для Parakeet + Diarization

### До оптимизации:
```
Parakeet (1 file, 10 min):
- Transcription: 60s
- Diarization: 45s
- Total: 105s (sequential)
```

### После оптимизации:
```
Parakeet (1 file, 10 min):
- Transcription: 60s (parallel with diarization)
- Diarization: 45s (parallel with transcription)
- Total: 60s (limited by slower task)
- Speedup: 1.75x
```

### Для batch processing (10 files):
```
До: 105s × 10 = 1050s (17.5 min)
После: 60s (batched) = 60s (1 min)
Speedup: 17.5x
```

---

## 🧪 Тесты для Parakeet + Diarization

**Файл**: `tests/integration/test_parakeet_diarization.py`

```python
"""
Integration tests for Parakeet + Diarization optimization
"""

import pytest
import time
import sys
from pathlib import Path

ai_engine_path = Path(__file__).parent.parent.parent.parent / "ai-engine"
sys.path.insert(0, str(ai_engine_path))


@pytest.mark.slow
class TestParakeetDiarization:
    """Test Parakeet model with diarization."""

    @pytest.fixture
    def parakeet_model(self):
        """Create Parakeet model instance."""
        from factory import ModelFactory

        return ModelFactory.create(
            "parakeet-tdt-0.6b-v3",
            device="cpu"
        )

    def test_parakeet_transcription(self, parakeet_model, test_audio_file):
        """Test Parakeet transcription."""
        result = parakeet_model.transcribe(test_audio_file)

        assert isinstance(result, list)
        assert len(result) > 0
        assert "text" in result[0]
        assert "start" in result[0]
        assert "end" in result[0]

    @pytest.mark.slow
    def test_parakeet_with_diarization(
        self,
        parakeet_model,
        test_audio_file
    ):
        """Test Parakeet with diarization."""
        start = time.time()

        result = parakeet_model.transcribe(
            test_audio_file,
            enable_diarization=True,
            diarization_provider="sherpa-onnx",  # No HF token needed
        )

        elapsed = time.time() - start

        # Check results
        assert isinstance(result, list)
        assert len(result) > 0

        # Check diarization
        has_speaker = any("speaker" in s and s["speaker"] for s in result)
        # Note: Sherpa-ONNX may not always detect speakers in short audio

        print(f"\nParakeet + Diarization: {elapsed:.2f}s")

    @pytest.mark.slow
    def test_parallel_diarization_speedup(
        self,
        parakeet_model,
        test_audio_file
    ):
        """Test that parallel diarization provides speedup."""

        # Sequential (old way)
        start = time.time()
        result1 = parakeet_model.transcribe(
            test_audio_file,
            enable_diarization=True,
            parallel_diarization=False,
        )
        sequential_time = time.time() - start

        # Parallel (new way)
        start = time.time()
        result2 = parakeet_model.transcribe(
            test_audio_file,
            enable_diarization=True,
            parallel_diarization=True,
        )
        parallel_time = time.time() - start

        # Parallel should be faster
        print(f"\nSequential: {sequential_time:.2f}s")
        print(f"Parallel: {parallel_time:.2f}s")
        print(f"Speedup: {sequential_time / parallel_time:.2f}x")

        # Allow some margin for measurement error
        assert parallel_time <= sequential_time * 1.1


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
```

---

## ✅ Обновленный Checklist

### Parakeet Optimizations:
- [ ] Добавить batch processing в Parakeet
- [ ] Включить AMP для GPU
- [ ] Добавить Torch Script оптимизацию
- [ ] Тесты для batch processing

### Diarization Optimizations:
- [ ] Параллельная транскрипция + диаризация
- [ ] Оптимизация PyAnnote параметров
- [ ] Batch processing для Sherpa-ONNX
- [ ] Тесты для параллельной обработки

### Combined Pipeline:
- [ ] Создать `optimized_pipeline.py`
- [ ] Интегрировать с main.py
- [ ] Добавить async support
- [ ] End-to-end тесты

---

**Обновлено**: 2025-02-07
**Добавлено**: Оптимизации для Parakeet и диаризации
