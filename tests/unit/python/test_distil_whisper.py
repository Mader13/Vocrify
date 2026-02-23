"""
Unit tests for Distil-Whisper model.

Tests cover:
- Model initialization for all distil variants
- Model loading with GPU batching
- Transcription method behavior
- Size mapping and model naming
"""

import pytest
import os
import sys
from unittest.mock import Mock, patch, MagicMock, call
from pathlib import Path

# Add ai-engine to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))

from models.distil_whisper import DistilWhisperModel
from base import TranscriptionSegment


# ============================================================================
# Model Initialization Tests
# ============================================================================

class TestDistilWhisperModelInit:
    """Test Distil-Whisper model initialization."""

    def test_init_with_defaults(self):
        """Test model initialization with default parameters."""
        model = DistilWhisperModel()
        assert model.device == "cpu"
        assert model.model_size == "large-v3"
        assert model.batch_size == 1
        assert model.enable_vad is True
        assert model.beam_size == 1
        assert model.best_of == 1

    def test_init_with_custom_device(self):
        """Test initialization with custom device."""
        model = DistilWhisperModel(device="cuda")
        assert model.device == "cuda"

    def test_init_with_custom_model_size(self):
        """Test initialization with different model sizes."""
        for size in ["tiny", "small", "medium", "large-v3", "distil-small", "distil-medium", "distil-large-v3"]:
            model = DistilWhisperModel(model_size=size)
            assert model.model_size == size

    def test_init_with_batch_size_cpu(self):
        """Test batch_size parameter on CPU."""
        model = DistilWhisperModel(device="cpu", batch_size=8)
        assert model.batch_size == 8

    def test_init_with_batch_size_gpu(self):
        """Test batch_size parameter on GPU."""
        model = DistilWhisperModel(device="cuda", batch_size=16)
        assert model.batch_size == 16

    def test_init_with_vad_disabled(self):
        """Test initialization with VAD disabled."""
        model = DistilWhisperModel(enable_vad=False)
        assert model.enable_vad is False

    def test_init_with_beam_size(self):
        """Test initialization with custom beam size."""
        model = DistilWhisperModel(beam_size=5)
        assert model.beam_size == 5

    def test_init_with_best_of(self):
        """Test initialization with custom best_of parameter."""
        model = DistilWhisperModel(best_of=5)
        assert model.best_of == 5

    def test_initial_model_state(self):
        """Test that model is not loaded initially (lazy loading)."""
        model = DistilWhisperModel()
        assert model._model is None
        assert model._batched_model is None


# ============================================================================
# Size Mapping Tests
# ============================================================================

class TestDistilWhisperSizeMapping:
    """Test Distil-Whisper model size mapping."""

    def test_size_map_contains_all_variants(self):
        """Test that SIZE_MAP contains all expected variants."""
        expected_sizes = [
            "tiny", "small", "medium", "large", "large-v3",
            "distil-small", "distil-medium", "distil-large", "distil-large-v3"
        ]
        for size in expected_sizes:
            assert size in DistilWhisperModel.SIZE_MAP

    def test_small_maps_to_distil_small_en(self):
        """Test that small maps to distil-whisper/distil-small.en."""
        assert DistilWhisperModel.SIZE_MAP["small"] == "distil-whisper/distil-small.en"
        assert DistilWhisperModel.SIZE_MAP["distil-small"] == "distil-whisper/distil-small.en"

    def test_medium_maps_to_distil_medium_en(self):
        """Test that medium maps to distil-whisper/distil-medium.en."""
        assert DistilWhisperModel.SIZE_MAP["medium"] == "distil-whisper/distil-medium.en"
        assert DistilWhisperModel.SIZE_MAP["distil-medium"] == "distil-whisper/distil-medium.en"

    def test_large_maps_to_distil_large_v3(self):
        """Test that large variants map to distil-whisper/distil-large-v3."""
        assert DistilWhisperModel.SIZE_MAP["large"] == "distil-whisper/distil-large-v3"
        assert DistilWhisperModel.SIZE_MAP["large-v3"] == "distil-whisper/distil-large-v3"
        assert DistilWhisperModel.SIZE_MAP["distil-large"] == "distil-whisper/distil-large-v3"
        assert DistilWhisperModel.SIZE_MAP["distil-large-v3"] == "distil-whisper/distil-large-v3"

    def test_tiny_maps_to_distil_small_en(self):
        """Test that tiny also maps to distil-small.en."""
        assert DistilWhisperModel.SIZE_MAP["tiny"] == "distil-whisper/distil-small.en"


# ============================================================================
# Model Loading Tests
# ============================================================================

class TestDistilWhisperModelLoading:
    """Test Distil-Whisper model loading behavior."""

    @patch('models.distil_whisper.FasterWhisper')
    def test_load_model_creates_faster_whisper(self, mock_fw):
        """Test that _load_model creates a FasterWhisper instance."""
        mock_model_instance = Mock()
        mock_fw.return_value = mock_model_instance

        model = DistilWhisperModel(device="cpu", model_size="small")
        model._load_model()

        assert model._model is not None
        mock_fw.assert_called_once()

    @patch('models.distil_whisper.FasterWhisper')
    def test_load_model_with_cpu_device(self, mock_fw):
        """Test model loading with CPU device uses int8 compute type."""
        model = DistilWhisperModel(device="cpu", model_size="small")
        model._load_model()

        call_kwargs = mock_fw.call_args[1]
        assert call_kwargs["device"] == "cpu"
        assert call_kwargs["compute_type"] == "int8"

    @patch('models.distil_whisper.FasterWhisper')
    def test_load_model_with_cuda_device(self, mock_fw):
        """Test model loading with CUDA device uses float16 compute type."""
        model = DistilWhisperModel(device="cuda", model_size="small")
        model._load_model()

        call_kwargs = mock_fw.call_args[1]
        assert call_kwargs["device"] == "cuda"
        assert call_kwargs["compute_type"] == "float16"

    @patch('models.distil_whisper.FasterWhisper')
    def test_load_model_is_idempotent(self, mock_fw):
        """Test that calling _load_model multiple times only loads once."""
        model = DistilWhisperModel(device="cpu", model_size="small")
        model._load_model()
        model._load_model()
        model._load_model()

        # Should only be called once due to early return
        assert mock_fw.call_count == 1

    @patch('models.distil_whisper.FasterWhisper')
    @patch('models.distil_whisper.BatchedInferencePipeline')
    def test_load_model_with_batching_on_cuda(self, mock_batched, mock_fw):
        """Test that batch_size > 1 on CUDA creates BatchedInferencePipeline."""
        mock_model_instance = Mock()
        mock_fw.return_value = mock_model_instance
        mock_batched_instance = Mock()
        mock_batched.return_value = mock_batched_instance

        model = DistilWhisperModel(device="cuda", model_size="small", batch_size=16)
        model._load_model()

        assert model._batched_model is not None
        mock_batched.assert_called_once_with(model=mock_model_instance)

    @patch('models.distil_whisper.FasterWhisper')
    @patch('models.distil_whisper.BatchedInferencePipeline')
    def test_load_model_no_batching_on_cpu(self, mock_batched, mock_fw):
        """Test that batch_size > 1 on CPU does NOT create BatchedInferencePipeline."""
        mock_model_instance = Mock()
        mock_fw.return_value = mock_model_instance

        model = DistilWhisperModel(device="cpu", model_size="small", batch_size=16)
        model._load_model()

        assert model._batched_model is None
        mock_batched.assert_not_called()

    @patch('models.distil_whisper.FasterWhisper')
    def test_load_model_without_faster_whisper(self, mock_fw):
        """Test ImportError when faster-whisper is not installed."""
        mock_fw.side_effect = ImportError("faster-whisper not found")

        model = DistilWhisperModel(device="cpu", model_size="small")

        with pytest.raises(ImportError) as exc_info:
            model._load_model()

        assert "faster-whisper is required" in str(exc_info.value)


# ============================================================================
# Model Selection Tests
# ============================================================================

class TestDistilWhisperModelSelection:
    """Test selection of batched vs regular model."""

    @patch('models.distil_whisper.FasterWhisper')
    @patch('models.distil_whisper.BatchedInferencePipeline')
    def test_get_model_for_transcription_returns_batched(self, mock_batched, mock_fw):
        """Test that _get_model_for_transcription returns batched model when available."""
        mock_model_instance = Mock()
        mock_fw.return_value = mock_model_instance
        mock_batched_instance = Mock()
        mock_batched.return_value = mock_batched_instance

        model = DistilWhisperModel(device="cuda", model_size="small", batch_size=16)
        result = model._get_model_for_transcription()

        assert result is mock_batched_instance

    @patch('models.distil_whisper.FasterWhisper')
    def test_get_model_for_transcription_returns_regular(self, mock_fw):
        """Test that _get_model_for_transcription returns regular model when no batching."""
        mock_model_instance = Mock()
        mock_fw.return_value = mock_model_instance

        model = DistilWhisperModel(device="cpu", model_size="small", batch_size=1)
        result = model._get_model_for_transcription()

        assert result is mock_model_instance


# ============================================================================
# Transcription Tests
# ============================================================================

class TestDistilWhisperTranscribe:
    """Test Distil-Whisper transcription method."""

    def setup_method(self):
        """Set up test fixtures."""
        self.sample_segments = [
            Mock(start=0.0, end=2.5, text="Hello world", avg_logprob=-0.1),
            Mock(start=2.5, end=5.0, text="This is a test", avg_logprob=-0.15),
        ]

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_returns_segments(self, mock_fw):
        """Test that transcribe returns list of segment dicts."""
        mock_model = Mock()
        mock_fw.return_value = mock_model

        # Mock the transcribe generator
        mock_info = Mock(language="en", language_probability=0.95)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small")
        result = model.transcribe("test.wav")

        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0]["text"] == "Hello world"
        assert result[1]["text"] == "This is a test"

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_with_language(self, mock_fw):
        """Test transcribe with explicit language parameter."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small")
        model.transcribe("test.wav", language="en")

        # Verify language was passed
        call_kwargs = mock_model.transcribe.call_args[1]
        assert call_kwargs["language"] == "en"

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_segment_format(self, mock_fw):
        """Test that transcribe returns properly formatted segment dicts."""
        mock_segment = Mock(start=1.5, end=3.7, text="Test segment", avg_logprob=-0.2)
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small")
        result = model.transcribe("test.wav")

        segment = result[0]
        assert "start" in segment
        assert "end" in segment
        assert "text" in segment
        assert "speaker" in segment
        assert "confidence" in segment
        assert segment["start"] == 1.5
        assert segment["end"] == 3.7
        assert segment["text"] == "Test segment"
        assert segment["speaker"] is None
        assert segment["confidence"] == -0.2

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_segment_without_avg_logprob(self, mock_fw):
        """Test transcribe handles segments without avg_logprob attribute."""
        mock_segment = Mock(start=0.0, end=1.0, text="Test")
        # Remove avg_logprob to test default behavior
        del mock_segment.avg_logprob

        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small")
        result = model.transcribe("test.wav")

        assert result[0]["confidence"] == 0.9  # Default value

    @patch('models.distil_whisper.FasterWhisper')
    @patch('models.distil_whisper.BatchedInferencePipeline')
    def test_transcribe_with_batched_model(self, mock_batched, mock_fw):
        """Test transcribe uses BatchedInferencePipeline when available."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_batched_instance = Mock()
        mock_batched.return_value = mock_batched_instance

        mock_info = Mock(language="en", language_probability=1.0)
        mock_batched_instance.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cuda", model_size="small", batch_size=16)
        result = model.transcribe("test.wav")

        # Verify batch_size was passed to transcribe
        call_kwargs = mock_batched_instance.transcribe.call_args[1]
        assert "batch_size" in call_kwargs
        assert call_kwargs["batch_size"] == 16
        assert len(result) == 2

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_with_vad_enabled(self, mock_fw):
        """Test transcribe with VAD enabled passes VAD parameters."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small", enable_vad=True)
        model.transcribe("test.wav")

        call_kwargs = mock_model.transcribe.call_args[1]
        assert call_kwargs["vad_filter"] is True
        assert "vad_parameters" in call_kwargs
        assert call_kwargs["vad_parameters"]["min_silence_duration_ms"] == 500

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_with_vad_disabled(self, mock_fw):
        """Test transcribe with VAD disabled."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small", enable_vad=False)
        model.transcribe("test.wav")

        call_kwargs = mock_model.transcribe.call_args[1]
        assert call_kwargs["vad_filter"] is False

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_with_beam_size(self, mock_fw):
        """Test transcribe passes beam_size parameter."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small", beam_size=5)
        model.transcribe("test.wav")

        call_kwargs = mock_model.transcribe.call_args[1]
        assert call_kwargs["beam_size"] == 5

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_with_best_of(self, mock_fw):
        """Test transcribe passes best_of parameter."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small", best_of=3)
        model.transcribe("test.wav")

        call_kwargs = mock_model.transcribe.call_args[1]
        assert call_kwargs["best_of"] == 3

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_returns_empty_list_on_error(self, mock_fw):
        """Test transcribe returns empty list when model is None."""
        mock_fw.return_value = None

        model = DistilWhisperModel(device="cpu", model_size="small")
        result = model.transcribe("test.wav")

        assert result == []

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_with_word_timestamps(self, mock_fw):
        """Test transcribe enables word_timestamps."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small")
        model.transcribe("test.wav")

        call_kwargs = mock_model.transcribe.call_args[1]
        assert call_kwargs["word_timestamps"] is True


# ============================================================================
# Streaming Callback Tests
# ============================================================================

class TestDistilWhisperStreamingCallback:
    """Test stream_callback functionality in Distil-Whisper."""

    @patch('models.distil_whisper.FasterWhisper')
    def test_stream_callback_is_called(self, mock_fw):
        """Test that stream_callback is called for each segment."""
        mock_segments = [
            Mock(start=0.0, end=1.0, text="First", avg_logprob=-0.1),
            Mock(start=1.0, end=2.0, text="Second", avg_logprob=-0.1),
        ]
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(mock_segments), mock_info)

        callback_calls = []

        def mock_callback(stream, segment):
            callback_calls.append({"stream": stream, "segment": segment})

        model = DistilWhisperModel(device="cpu", model_size="small")
        model.transcribe("test.wav", stream_callback=mock_callback)

        assert len(callback_calls) == 2
        assert callback_calls[0]["stream"] is True
        assert callback_calls[0]["segment"]["text"] == "First"
        assert callback_calls[1]["stream"] is True
        assert callback_calls[1]["segment"]["text"] == "Second"

    @patch('models.distil_whisper.FasterWhisper')
    def test_stream_callback_receives_correct_format(self, mock_fw):
        """Test that stream_callback receives properly formatted segment."""
        mock_segment = Mock(start=5.5, end=7.8, text="Callback test", avg_logprob=-0.05)
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        received_segment = None

        def mock_callback(stream, segment):
            nonlocal received_segment
            received_segment = segment

        model = DistilWhisperModel(device="cpu", model_size="small")
        model.transcribe("test.wav", stream_callback=mock_callback)

        assert received_segment is not None
        assert received_segment["start"] == 5.5
        assert received_segment["end"] == 7.8
        assert received_segment["text"] == "Callback test"

    @patch('models.distil_whisper.FasterWhisper')
    def test_transcribe_without_callback(self, mock_fw):
        """Test transcribe works without stream_callback."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=1.0)
        mock_model.transcribe.return_value = (iter(self.sample_segments), mock_info)

        model = DistilWhisperModel(device="cpu", model_size="small")
        result = model.transcribe("test.wav")  # No callback

        assert len(result) == 2  # Should still return segments


# ============================================================================
# Property Tests
# ============================================================================

class TestDistilWhisperProperties:
    """Test Distil-Whisper model properties."""

    def test_name_property(self):
        """Test the name property returns correct format."""
        model = DistilWhisperModel(device="cpu", model_size="small")
        assert model.name == "distil-whisper-small"

        model = DistilWhisperModel(device="cpu", model_size="distil-large-v3")
        assert model.name == "distil-whisper-distil-large-v3"

    def test_supports_diarization_property(self):
        """Test that supports_diarization returns True."""
        model = DistilWhisperModel()
        assert model.supports_diarization is True


# ============================================================================
# Edge Cases and Error Handling
# ============================================================================

class TestDistilWhisperEdgeCases:
    """Test edge cases and error handling."""

    def test_model_size_with_slashes(self):
        """Test model initialization with full model name (with slashes)."""
        # This tests using a HuggingFace model ID directly
        model = DistilWhisperModel(model_size="distil-whisper/distil-small.en")
        assert model.model_size == "distil-whisper/distil-small.en"

    @patch('models.distil_whisper.FasterWhisper')
    def test_batch_size_boundary_values(self, mock_fw):
        """Test batch_size with boundary values."""
        mock_model = Mock()
        mock_fw.return_value = mock_model

        # Test batch_size = 1 (no batching)
        model1 = DistilWhisperModel(device="cuda", batch_size=1)
        model1._load_model()
        assert model1._batched_model is None

        # Test batch_size = 16 (max batching)
        model16 = DistilWhisperModel(device="cuda", batch_size=16)
        model16._load_model()
        assert model16._batched_model is not None

    def test_diarization_provider_default(self):
        """Test default diarization provider."""
        model = DistilWhisperModel()
        assert model.diarization_provider == "sherpa-onnx"

    def test_diarization_provider_sherpa(self):
        """Test sherpa-onnx diarization provider."""
        model = DistilWhisperModel(diarization_provider="sherpa-onnx")
        assert model.diarization_provider == "sherpa-onnx"

    def test_num_speakers_default(self):
        """Test default num_speakers (auto detection)."""
        model = DistilWhisperModel()
        assert model.num_speakers == -1

    def test_num_speakers_custom(self):
        """Test custom num_speakers."""
        model = DistilWhisperModel(num_speakers=2)
        assert model.num_speakers == 2

    def test_download_root_default(self):
        """Test default download_root is None."""
        model = DistilWhisperModel()
        assert model.download_root is None

    def test_download_root_custom(self):
        """Test custom download_root."""
        model = DistilWhisperModel(download_root="/tmp/models")
        assert model.download_root == "/tmp/models"
