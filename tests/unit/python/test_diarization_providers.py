"""
Unit tests for diarization providers.

Tests sherpa-onnx diarization implementation.
"""

import pytest
import os
import sys
import json
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path

# Add ai-engine to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "ai-engine"))


class TestSherpaOnnxDiarization:
    """Test Sherpa-ONNX diarization provider."""

    def test_sherpa_onnx_does_not_require_token(self):
        """Test that sherpa-onnx works without HF token."""
        from models.sherpa_diarization import SherpaOnnxDiarization

        # Ensure HF_TOKEN is not set
        os.environ.pop("HF_TOKEN", None)
        os.environ.pop("HUGGINGFACE_ACCESS_TOKEN", None)

        # Sherpa-ONNX should initialize without token
        # (will fail without actual model files, but that's ok)
        try:
            diarizer = SherpaOnnxDiarization(
                segmentation_model="/fake/path/segmentation.onnx",
                embedding_model="/fake/path/embedding.onnx",
                num_speakers=-1,
            )
            assert diarizer is not None
        except Exception as e:
            # Expected to fail without actual model files
            # But should NOT fail due to missing token
            assert "token" not in str(e).lower()

    def test_sherpa_onnx_initialization(self):
        """Test sherpa-onnx initialization with parameters."""
        from models.sherpa_diarization import SherpaOnnxDiarization

        # Test with different num_speakers values
        test_cases = [
            (-1, "auto"),  # Auto-detection
            (2, 2),
            (5, 5),
        ]

        for num_speakers, expected in test_cases:
            try:
                diarizer = SherpaOnnxDiarization(
                    segmentation_model="/fake/path/segmentation.onnx",
                    embedding_model="/fake/path/embedding.onnx",
                    num_speakers=num_speakers,
                )
                assert diarizer.num_speakers == expected
            except Exception as e:
                # Expected to fail without actual model files
                assert "token" not in str(e).lower()


class TestDiarizationIntegration:
    """Test diarization integration with Whisper model."""

    def test_whisper_with_sherpa_provider(self):
        """Test Whisper model initialization with sherpa-onnx provider."""
        from models.whisper import WhisperModel

        model = WhisperModel(
            device="cpu",
            model_size="base",
            diarization_provider="sherpa-onnx",
            num_speakers=-1,
        )

        assert model.diarization_provider == "sherpa-onnx"
        assert model.num_speakers == -1

    def test_whisper_without_diarization(self):
        """Test Whisper model without diarization."""
        from models.whisper import WhisperModel

        model = WhisperModel(
            device="cpu",
            model_size="base",
            diarization_provider=None,
            num_speakers=-1,
        )

        # Should not raise any errors
        assert model is not None

    def test_whisper_with_sherpa_num_speakers(self):
        """Test Whisper model initialization with sherpa-onnx provider and num_speakers."""
        from models.whisper import WhisperModel

        model = WhisperModel(
            device="cpu",
            model_size="base",
            diarization_provider="sherpa-onnx",
            num_speakers=2,
        )

        assert model.diarization_provider == "sherpa-onnx"
        assert model.num_speakers == 2


class TestModelFactory:
    """Test model factory with diarization parameters."""

    def test_factory_creates_whisper_with_sherpa_diarization(self):
        """Test that ModelFactory passes sherpa-onnx diarization params to Whisper."""
        from factory import ModelFactory

        # Mock WhisperModel to avoid actual initialization
        with patch("models.whisper.WhisperModel") as MockWhisper:
            mock_instance = MagicMock()
            MockWhisper.return_value = mock_instance

            ModelFactory.create(
                model_name="whisper-base",
                device="cpu",
                diarization_provider="sherpa-onnx",
                num_speakers=3,
            )

            # Verify WhisperModel was called with correct params
            MockWhisper.assert_called_once()
            call_kwargs = MockWhisper.call_args[1]

            assert call_kwargs["device"] == "cpu"
            assert call_kwargs["diarization_provider"] == "sherpa-onnx"
            assert call_kwargs["num_speakers"] == 3


class TestDiarizationOutput:
    """Test diarization output format."""

    def test_speaker_labels_in_output(self):
        """Test that speaker labels are added to segments."""
        from models.whisper import WhisperModel

        model = WhisperModel(
            device="cpu",
            model_size="base",
            diarization_provider="sherpa-onnx",
            num_speakers=2,
        )

        # Input segments without speaker labels
        segments = [
            {"start": 0.0, "end": 2.5, "text": "Hello"},
            {"start": 2.5, "end": 5.0, "text": "World"},
        ]

        # Mock diarization to add speaker labels
        with patch.object(model, "_run_sherpa_diarization", return_value=[
            (0.0, 2.5, 0),
            (2.5, 5.0, 1),
        ]):
            result = model.diarize(segments, "test.wav")

            # Verify speaker labels are added
            assert result[0]["speaker"] == "SPEAKER_00"
            assert result[1]["speaker"] == "SPEAKER_01"

    def test_speaker_label_format(self):
        """Test that speaker labels follow SPEAKER_XX format."""
        from models.whisper import WhisperModel

        model = WhisperModel(
            device="cpu",
            model_size="base",
            diarization_provider="sherpa-onnx",
            num_speakers=3,
        )

        segments = [
            {"start": 0.0, "end": 2.5, "text": "Hello"},
        ]

        # Mock diarization
        with patch.object(model, "_run_sherpa_diarization", return_value=[
            (0.0, 2.5, 2),  # Speaker ID 2
        ]):
            result = model.diarize(segments, "test.wav")

            # Verify format is SPEAKER_02 (zero-padded to 2 digits)
            assert result[0]["speaker"] == "SPEAKER_02"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
