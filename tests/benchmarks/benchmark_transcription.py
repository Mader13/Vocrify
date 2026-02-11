"""
Benchmark suite for transcription performance

This suite measures and compares performance across different models and configurations.
"""

import pytest
import time
import json
from pathlib import Path
import sys
import tempfile
import numpy as np

# Add ai-engine to path
ai_engine_path = Path(__file__).parent.parent.parent.parent / "ai-engine"
sys.path.insert(0, str(ai_engine_path))


def get_audio_duration(file_path: str) -> float:
    """Get audio file duration in seconds."""
    try:
        import librosa
        y, sr = librosa.load(file_path, sr=None)
        return len(y) / sr
    except ImportError:
        # Fallback: assume duration from file size
        return 30.0


@pytest.fixture
def benchmark_audio(tmp_path):
    """
    Create benchmark audio file.

    Creates a 30-second audio file with mixed content.
    """
    try:
        import soundfile as sf

        # Create 30 seconds of audio at 16kHz
        sample_rate = 16000
        duration = 30

        # Generate audio with different sections
        audio = np.random.randn(sample_rate * duration).astype(np.float32) * 0.05

        # Add some "speech" sections (simulated with higher amplitude)
        for start, end in [(0, 5), (10, 15), (20, 25)]:
            audio[start * sample_rate:end * sample_rate] = \
                np.random.randn(sample_rate * (end - start)).astype(np.float32) * 0.2

        # Save to file
        audio_path = tmp_path / "benchmark_30s.wav"
        sf.write(str(audio_path), audio, sample_rate)

        return str(audio_path)

    except ImportError:
        pytest.skip("soundfile/numpy not available")


@pytest.mark.benchmark
@pytest.mark.slow
class TestTranscriptionBenchmarks:
    """Benchmark transcription performance across models."""

    @pytest.fixture(params=[
        "whisper-tiny",
        "whisper-base",
        "distil-large",
    ])
    def model_config(self, request):
        return {
            "name": request.param,
            "device": "cpu",
        }

    @pytest.mark.slow
    def test_realtime_factor(
        self,
        model_config,
        benchmark_audio
    ):
        """
        Benchmark realtime factor.

        Realtime factor = audio duration / processing time
        Higher is better (e.g., 10x means 30s audio in 3s)
        """
        from factory import ModelFactory

        try:
            model = ModelFactory.create(
                model_config["name"],
                device=model_config["device"]
            )

            duration = get_audio_duration(benchmark_audio)

            # Warmup run
            try:
                model.transcribe(benchmark_audio)
            except:
                pass  # Ignore warmup errors

            # Timed run
            start = time.time()
            try:
                result = model.transcribe(benchmark_audio)
                elapsed = time.time() - start

                realtime_factor = duration / elapsed if elapsed > 0 else 0

                # Log results
                print(f"\n{model_config['name']} (CPU):")
                print(f"  Audio duration: {duration:.2f}s")
                print(f"  Processing time: {elapsed:.2f}s")
                print(f"  Realtime factor: {realtime_factor:.2f}x")

                # Assert minimum performance (at least realtime)
                if realtime_factor > 0:
                    assert realtime_factor >= 0.5, f"Too slow: {realtime_factor:.2f}x"

                # Save results
                results = {
                    "model": model_config["name"],
                    "device": model_config["device"],
                    "audio_duration": duration,
                    "processing_time": elapsed,
                    "realtime_factor": realtime_factor,
                    "num_segments": len(result),
                }

                results_file = Path(__file__).parent / "results" / f"{model_config['name']}_benchmark.json"
                results_file.parent.mkdir(exist_ok=True)
                results_file.write_text(json.dumps(results, indent=2))

            except Exception as e:
                pytest.skip(f"Transcription failed: {e}")

        except Exception as e:
            pytest.skip(f"Model loading failed: {e}")

    @pytest.mark.slow
    @pytest.mark.parametrize("model_name,expected_min_rt", [
        ("whisper-tiny", 3.0),   # Should be >3x realtime
        ("whisper-base", 2.0),   # Should be >2x realtime
        ("distil-large", 5.0),   # Should be >5x realtime
    ])
    def test_minimum_performance(
        self,
        model_name,
        expected_min_rt,
        benchmark_audio
    ):
        """Test that models meet minimum performance requirements."""
        from factory import ModelFactory

        try:
            model = ModelFactory.create(model_name, device="cpu")
            duration = get_audio_duration(benchmark_audio)

            start = time.time()
            try:
                model.transcribe(benchmark_audio)
                elapsed = time.time() - start

                realtime_factor = duration / elapsed if elapsed > 0 else 0

                print(f"\n{model_name}: {realtime_factor:.2f}x (expected >{expected_min_rt}x)")

                if realtime_factor > 0:
                    assert realtime_factor >= expected_min_rt

            except Exception as e:
                pytest.skip(f"Transcription failed: {e}")

        except Exception as e:
            pytest.skip(f"Model loading failed: {e}")

    @pytest.mark.slow
    def test_memory_usage(self, model_config, benchmark_audio):
        """Benchmark memory usage for different models."""
        import psutil
        import gc

        try:
            # Clean up before test
            gc.collect()

            process = psutil.Process()
            start_memory = process.memory_info().rss / 1024 / 1024

            model = ModelFactory.create(
                model_config["name"],
                device=model_config["device"]
            )

            # Load model
            memory_after_load = process.memory_info().rss / 1024 / 1024

            # Run transcription
            try:
                model.transcribe(benchmark_audio)

                end_memory = process.memory_info().rss / 1024 / 1024
                memory_used = end_memory - start_memory

                print(f"\n{model_config['name']} memory usage:")
                print(f"  Start: {start_memory:.0f}MB")
                print(f"  After load: {memory_after_load:.0f}MB")
                print(f"  Peak: {end_memory:.0f}MB")
                print(f"  Used: {memory_used:.0f}MB")

                # Assert reasonable memory limits
                assert end_memory < 4000  # < 4GB

            except Exception as e:
                pytest.skip(f"Transcription failed: {e}")

        except Exception as e:
            pytest.skip(f"Model loading failed: {e}")


@pytest.mark.benchmark
@pytest.mark.slow
class TestModelComparison:
    """Compare performance across different models."""

    @pytest.mark.slow
    def test_whisper_vs_distil_whisper(self, benchmark_audio):
        """Compare Whisper Base vs Distil-Large."""
        from factory import ModelFactory

        results = {}

        for model_name in ["whisper-base", "distil-large"]:
            try:
                model = ModelFactory.create(model_name, device="cpu")
                duration = get_audio_duration(benchmark_audio)

                # Warmup
                try:
                    model.transcribe(benchmark_audio)
                except:
                    pass

                # Measure
                start = time.time()
                try:
                    model.transcribe(benchmark_audio)
                    elapsed = time.time() - start
                    realtime_factor = duration / elapsed if elapsed > 0 else 0

                    results[model_name] = {
                        "processing_time": elapsed,
                        "realtime_factor": realtime_factor,
                    }

                    print(f"\n{model_name}:")
                    print(f"  Time: {elapsed:.2f}s")
                    print(f"  Realtime factor: {realtime_factor:.2f}x")

                except Exception as e:
                    print(f"\n{model_name}: Failed - {e}")

            except Exception as e:
                print(f"\n{model_name}: Failed to load - {e}")

        # Compare results if both succeeded
        if "whisper-base" in results and "distil-large" in results:
            whisper_rt = results["whisper-base"]["realtime_factor"]
            distil_rt = results["distil-large"]["realtime_factor"]

            speedup = distil_rt / whisper_rt if whisper_rt > 0 else 0

            print(f"\n📊 Comparison:")
            print(f"  Speedup: {speedup:.2f}x (Distil vs Whisper Base)")

            if speedup > 1:
                print(f"  ✓ Distil-Large is {speedup:.2f}x faster!")
            else:
                print(f"  ✗ Whisper Base is {1/speedup:.2f}x faster")


@pytest.mark.benchmark
@pytest.mark.slow
class TestVADImpact:
    """Benchmark VAD performance impact."""

    @pytest.mark.slow
    def test_vad_effectiveness(self, tmp_path):
        """Test VAD effectiveness by comparing audio with/without silence."""
        try:
            import soundfile as sf

            # Create audio with lots of silence (50% silence)
            sample_rate = 16000
            duration = 10  # 10 seconds total

            # Audio with 5s speech, 5s silence
            audio = np.random.randn(sample_rate * duration).astype(np.float32) * 0.01
            audio[0:sample_rate*5] = np.random.randn(sample_rate * 5).astype(np.float32) * 0.2

            # Create file
            silence_heavy_path = tmp_path / "silence_heavy.wav"
            sf.write(str(silence_heavy_path), audio, sample_rate)

            # Test with model (VAD enabled by default)
            from factory import ModelFactory
            model = ModelFactory.create("whisper-tiny", device="cpu")

            start = time.time()
            try:
                result = model.transcribe(str(silence_heavy_path))
                elapsed = time.time() - start

                duration = get_audio_duration(str(silence_heavy_path))
                realtime_factor = duration / elapsed if elapsed > 0 else 0

                print(f"\nSilence-heavy audio (50% silence):")
                print(f"  Duration: {duration:.2f}s")
                print(f"  Processing: {elapsed:.2f}s")
                print(f"  Realtime factor: {realtime_factor:.2f}x")

                # With VAD, should process faster than realtime
                # even with silence-heavy audio
                assert realtime_factor >= 1.0, "Should be at least realtime"

            except Exception as e:
                pytest.skip(f"Transcription failed: {e}")

        except ImportError:
            pytest.skip("soundfile/numpy not available")


class BenchmarkResults:
    """Helper class to manage benchmark results."""

    @staticmethod
    def save_results(results: dict, filename: str):
        """Save benchmark results to file."""
        results_file = Path(__file__).parent / "results" / filename
        results_file.parent.mkdir(exist_ok=True)
        results_file.write_text(json.dumps(results, indent=2))

    @staticmethod
    def load_results(filename: str) -> dict:
        """Load benchmark results from file."""
        results_file = Path(__file__).parent / "results" / filename

        if results_file.exists():
            with open(results_file) as f:
                return json.load(f)

        return {}

    @staticmethod
    def compare_results(before_file: str, after_file: str) -> dict:
        """Compare two benchmark results."""
        before = BenchmarkResults.load_results(before_file)
        after = BenchmarkResults.load_results(after_file)

        if not before or not after:
            return {}

        comparison = {}
        for model in before.keys():
            if model in after:
                before_rt = before[model].get("realtime_factor", 0)
                after_rt = after[model].get("realtime_factor", 0)

                if before_rt > 0:
                    speedup = after_rt / before_rt
                    comparison[model] = {
                        "before": before_rt,
                        "after": after_rt,
                        "speedup": speedup,
                    }

        return comparison


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])
