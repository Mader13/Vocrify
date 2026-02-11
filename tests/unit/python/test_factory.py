"""
Unit tests for ModelFactory.

Tests cover:
- Creating Whisper models
- Creating Distil-Whisper models
- Creating Parakeet models
- Invalid model handling
- Model listing and info
- Distil model factory integration
"""

import pytest
import os
import sys
from unittest.mock import Mock, patch, MagicMock

# Add ai-engine to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))

from factory import ModelFactory


# ============================================================================
# Whisper Model Creation Tests
# ============================================================================

class TestWhisperModelFactory:
    """Test creating Whisper models via factory."""

    @patch('models.whisper.WhisperModel')
    def test_create_whisper_tiny(self, mock_whisper):
        """Test creating Whisper Tiny model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        model = ModelFactory.create("whisper-tiny", device="cpu")

        assert model is not None
        mock_whisper.assert_called_once()

    @patch('models.whisper.WhisperModel')
    def test_create_whisper_base(self, mock_whisper):
        """Test creating Whisper Base model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        model = ModelFactory.create("whisper-base", device="cpu")

        assert model is not None
        mock_whisper.assert_called_once()

    @patch('models.whisper.WhisperModel')
    def test_create_whisper_small(self, mock_whisper):
        """Test creating Whisper Small model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        model = ModelFactory.create("whisper-small", device="cpu")

        assert model is not None

    @patch('models.whisper.WhisperModel')
    def test_create_whisper_medium(self, mock_whisper):
        """Test creating Whisper Medium model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        model = ModelFactory.create("whisper-medium", device="cpu")

        assert model is not None

    @patch('models.whisper.WhisperModel')
    def test_create_whisper_large(self, mock_whisper):
        """Test creating Whisper Large model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        model = ModelFactory.create("whisper-large", device="cpu")

        assert model is not None

    @patch('models.whisper.WhisperModel')
    def test_create_whisper_large_v3(self, mock_whisper):
        """Test creating Whisper Large V3 model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        model = ModelFactory.create("whisper-large-v3", device="cpu")

        assert model is not None

    @patch('models.whisper.WhisperModel')
    def test_whisper_model_size_parameter(self, mock_whisper):
        """Test that model_size is correctly extracted from model name."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["model_size"] == "base"

    @patch('models.whisper.WhisperModel')
    def test_whisper_passes_device(self, mock_whisper):
        """Test that device parameter is passed to Whisper model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cuda")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["device"] == "cuda"

    @patch('models.whisper.WhisperModel')
    def test_whisper_default_batch_size_cpu(self, mock_whisper):
        """Test default batch_size for CPU."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["batch_size"] == 1

    @patch('models.whisper.WhisperModel')
    def test_whisper_default_batch_size_cuda(self, mock_whisper):
        """Test default batch_size for CUDA."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cuda")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["batch_size"] == 16

    @patch('models.whisper.WhisperModel')
    def test_whisper_custom_batch_size(self, mock_whisper):
        """Test custom batch_size parameter."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cuda", batch_size=8)

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["batch_size"] == 8


# ============================================================================
# Distil-Whisper Model Creation Tests
# ============================================================================

class TestDistilWhisperModelFactory:
    """Test creating Distil-Whisper models via factory."""

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_create_distil_small(self, mock_distil):
        """Test creating Distil-Whisper Small model."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        model = ModelFactory.create("distil-small", device="cpu")

        assert model is not None
        mock_distil.assert_called_once()

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_create_distil_medium(self, mock_distil):
        """Test creating Distil-Whisper Medium model."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        model = ModelFactory.create("distil-medium", device="cpu")

        assert model is not None

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_create_distil_large(self, mock_distil):
        """Test creating Distil-Whisper Large model."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        model = ModelFactory.create("distil-large", device="cpu")

        assert model is not None

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_create_distil_large_v3(self, mock_distil):
        """Test creating Distil-Whisper Large V3 model."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        model = ModelFactory.create("distil-large-v3", device="cpu")

        assert model is not None
        mock_distil.assert_called_once()

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_model_size_mapping(self, mock_distil):
        """Test that distil model names are correctly mapped."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        ModelFactory.create("distil-small", device="cpu")

        call_kwargs = mock_distil.call_args[1]
        assert call_kwargs["model_size"] == "small"

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_default_batch_size_cpu(self, mock_distil):
        """Test default batch_size for CPU with Distil."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        ModelFactory.create("distil-small", device="cpu")

        call_kwargs = mock_distil.call_args[1]
        assert call_kwargs["batch_size"] == 1

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_default_batch_size_cuda(self, mock_distil):
        """Test default batch_size for CUDA with Distil."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        ModelFactory.create("distil-small", device="cuda")

        call_kwargs = mock_distil.call_args[1]
        assert call_kwargs["batch_size"] == 16

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_custom_batch_size(self, mock_distil):
        """Test custom batch_size with Distil models."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        ModelFactory.create("distil-large-v3", device="cuda", batch_size=12)

        call_kwargs = mock_distil.call_args[1]
        assert call_kwargs["batch_size"] == 12


# ============================================================================
# Parakeet Model Creation Tests
# ============================================================================

class TestParakeetModelFactory:
    """Test creating Parakeet models via factory."""

    @patch('models.parakeet.ParakeetModel')
    def test_create_parakeet_generic(self, mock_parakeet):
        """Test creating generic Parakeet model."""
        mock_instance = Mock()
        mock_parakeet.return_value = mock_instance

        model = ModelFactory.create("parakeet", device="cpu")

        assert model is not None
        mock_parakeet.assert_called_once()

    @patch('models.parakeet.ParakeetModel')
    def test_create_parakeet_tdt_0_6b(self, mock_parakeet):
        """Test creating Parakeet TDT 0.6B model."""
        mock_instance = Mock()
        mock_parakeet.return_value = mock_instance

        model = ModelFactory.create("parakeet-tdt-0.6b-v3", device="cpu")

        assert model is not None

    @patch('models.parakeet.ParakeetModel')
    def test_create_parakeet_tdt_1_1b(self, mock_parakeet):
        """Test creating Parakeet TDT 1.1B model."""
        mock_instance = Mock()
        mock_parakeet.return_value = mock_instance

        model = ModelFactory.create("parakeet-tdt-1.1b", device="cpu")

        assert model is not None

    @patch('models.parakeet.ParakeetModel')
    def test_create_parakeet_tdt_1_1b_ls(self, mock_parakeet):
        """Test creating Parakeet TDT 1.1B LS (large speaker) model."""
        mock_instance = Mock()
        mock_parakeet.return_value = mock_instance

        model = ModelFactory.create("parakeet-tdt-1.1b-ls", device="cpu")

        assert model is not None


# ============================================================================
# Invalid Model Tests
# ============================================================================

class TestInvalidModelFactory:
    """Test invalid model handling."""

    def test_create_invalid_model_name(self):
        """Test creating invalid model raises ValueError."""
        with pytest.raises(ValueError, match="Unknown model"):
            ModelFactory.create("invalid-model-name")

    def test_create_empty_model_name(self):
        """Test creating empty model name raises ValueError."""
        with pytest.raises(ValueError, match="Unknown model"):
            ModelFactory.create("")


# ============================================================================
# Model Listing Tests
# ============================================================================

class TestModelListing:
    """Test model listing functionality."""

    def test_list_models(self):
        """Test that list_models returns expected models."""
        models = ModelFactory.list_models()

        assert isinstance(models, list)
        assert len(models) > 0

    def test_list_models_contains_whisper(self):
        """Test that list_models includes Whisper models."""
        models = ModelFactory.list_models()

        assert "whisper-tiny" in models
        assert "whisper-base" in models
        assert "whisper-small" in models
        assert "whisper-medium" in models
        assert "whisper-large" in models

    def test_list_models_contains_distil(self):
        """Test that list_models includes Distil-Whisper models."""
        models = ModelFactory.list_models()

        assert "distil-small" in models
        assert "distil-medium" in models
        assert "distil-large" in models
        assert "distil-large-v3" in models

    def test_list_models_contains_parakeet(self):
        """Test that list_models includes Parakeet models."""
        models = ModelFactory.list_models()

        assert "parakeet" in models
        assert "parakeet-tdt-0.6b-v3" in models
        assert "parakeet-tdt-1.1b" in models
        assert "parakeet-tdt-1.1b-ls" in models


# ============================================================================
# Model Info Tests
# ============================================================================

class TestModelInfo:
    """Test get_model_info functionality."""

    def test_get_whisper_tiny_info(self):
        """Test getting info for Whisper Tiny."""
        info = ModelFactory.get_model_info("whisper-tiny")

        assert info["name"] == "Whisper Tiny"
        assert "size" in info
        assert "speed" in info
        assert "quality" in info
        assert "languages" in info

    def test_get_whisper_base_info(self):
        """Test getting info for Whisper Base."""
        info = ModelFactory.get_model_info("whisper-base")

        assert info["name"] == "Whisper Base"
        assert info["size"] == "~150 MB"

    def test_get_distil_small_info(self):
        """Test getting info for Distil-Whisper Small."""
        info = ModelFactory.get_model_info("distil-small")

        assert info["name"] == "Distil-Whisper Small"
        assert "6x faster" in info["speed"]
        assert info["languages"] == "English only"

    def test_get_distil_medium_info(self):
        """Test getting info for Distil-Whisper Medium."""
        info = ModelFactory.get_model_info("distil-medium")

        assert info["name"] == "Distil-Whisper Medium"
        assert info["size"] == "~760 MB"

    def test_get_distil_large_v3_info(self):
        """Test getting info for Distil-Whisper Large V3."""
        info = ModelFactory.get_model_info("distil-large-v3")

        assert info["name"] == "Distil-Whisper Large V3"
        assert "6x faster" in info["speed"]
        assert info["languages"] == "Multilingual"
        assert "BEST CHOICE" in info["note"]

    def test_get_parakeet_info(self):
        """Test getting info for Parakeet."""
        info = ModelFactory.get_model_info("parakeet")

        assert info["name"] == "Parakeet TDT 0.6B (NVIDIA)"
        assert "very fast" in info["speed"]

    def test_get_unknown_model_info(self):
        """Test getting info for unknown model."""
        info = ModelFactory.get_model_info("unknown-model")

        assert "name" in info
        assert info["name"] == "unknown-model"
        assert info.get("note") == "Unknown model"


# ============================================================================
# Factory Parameter Passing Tests
# ============================================================================

class TestFactoryParameterPassing:
    """Test that factory correctly passes parameters to model constructors."""

    @patch('models.whisper.WhisperModel')
    def test_passes_download_root(self, mock_whisper):
        """Test that download_root is passed to model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu", download_root="/tmp/models")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["download_root"] == "/tmp/models"

    @patch('models.whisper.WhisperModel')
    def test_passes_diarization_provider(self, mock_whisper):
        """Test that diarization_provider is passed to model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu", diarization_provider="sherpa-onnx")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["diarization_provider"] == "sherpa-onnx"

    @patch('models.whisper.WhisperModel')
    def test_default_diarization_provider(self, mock_whisper):
        """Test default diarization_provider is pyannote."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["diarization_provider"] == "pyannote"

    @patch('models.whisper.WhisperModel')
    def test_passes_num_speakers(self, mock_whisper):
        """Test that num_speakers is passed to model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu", num_speakers=2)

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["num_speakers"] == 2

    @patch('models.whisper.WhisperModel')
    def test_default_num_speakers(self, mock_whisper):
        """Test default num_speakers is -1 (auto)."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["num_speakers"] == -1

    @patch('models.whisper.WhisperModel')
    def test_passes_enable_vad(self, mock_whisper):
        """Test that enable_vad is passed to model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu", enable_vad=False)

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["enable_vad"] is False

    @patch('models.whisper.WhisperModel')
    def test_default_enable_vad(self, mock_whisper):
        """Test default enable_vad is True."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["enable_vad"] is True

    @patch('models.whisper.WhisperModel')
    def test_passes_beam_size(self, mock_whisper):
        """Test that beam_size is passed to model."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu", beam_size=5)

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["beam_size"] == 5

    @patch('models.whisper.WhisperModel')
    def test_default_beam_size(self, mock_whisper):
        """Test default beam_size is 1 (greedy)."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper-base", device="cpu")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["beam_size"] == 1

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_receives_same_parameters(self, mock_distil):
        """Test that Distil models receive same parameters as Whisper."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        ModelFactory.create(
            "distil-small",
            device="cuda",
            download_root="/models",
            diarization_provider="sherpa-onnx",
            num_speakers=3,
            enable_vad=True,
            beam_size=3,
            best_of=2,
            batch_size=8
        )

        call_kwargs = mock_distil.call_args[1]
        assert call_kwargs["device"] == "cuda"
        assert call_kwargs["download_root"] == "/models"
        assert call_kwargs["diarization_provider"] == "sherpa-onnx"
        assert call_kwargs["num_speakers"] == 3
        assert call_kwargs["enable_vad"] is True
        assert call_kwargs["beam_size"] == 3
        assert call_kwargs["best_of"] == 2
        assert call_kwargs["batch_size"] == 8


# ============================================================================
# Edge Cases
# ============================================================================

class TestFactoryEdgeCases:
    """Test edge cases for factory functionality."""

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_whisper_name_variants(self, mock_distil):
        """Test various distil-whisper name variants."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        # Test with "distil-whisper-" prefix
        ModelFactory.create("distil-whisper-small", device="cpu")

        call_kwargs = mock_distil.call_args[1]
        # Should strip both prefixes and default to large-v3
        assert call_kwargs["model_size"] == "large-v3"

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_empty_size_defaults_to_large_v3(self, mock_distil):
        """Test that empty distil size defaults to large-v3."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        ModelFactory.create("distil", device="cpu")

        call_kwargs = mock_distil.call_args[1]
        assert call_kwargs["model_size"] == "large-v3"

    @patch('models.distil_whisper.DistilWhisperModel')
    def test_distil_whisper_only_defaults(self, mock_distil):
        """Test that 'distil-whisper' (no size) defaults to large-v3."""
        mock_instance = Mock()
        mock_distil.return_value = mock_instance

        ModelFactory.create("distil-whisper", device="cpu")

        call_kwargs = mock_distil.call_args[1]
        assert call_kwargs["model_size"] == "large-v3"

    @patch('models.whisper.WhisperModel')
    def test_whisper_empty_size_defaults_to_base(self, mock_whisper):
        """Test that 'whisper' (no size) defaults to base."""
        mock_instance = Mock()
        mock_whisper.return_value = mock_instance

        ModelFactory.create("whisper", device="cpu")

        call_kwargs = mock_whisper.call_args[1]
        assert call_kwargs["model_size"] == "base"
