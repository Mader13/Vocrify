import pytest
import os
from unittest.mock import Mock, patch
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from ai_engine.models.whisper import WhisperModel

def test_whisper_model_init():
    """Test Whisper model initialization."""
    model = WhisperModel(device="cpu", model_size="tiny")
    assert model.device == "cpu"
    assert model.model_size == "tiny"

def test_whisper_model_invalid_size():
    """Test invalid model size raises error."""
    with pytest.raises(ValueError):
        WhisperModel(device="cpu", model_size="invalid")

@pytest.mark.skipif(
    os.getenv("CI") == "true",
    reason="Skip in CI - no actual models"
)
def test_whisper_transcribe_mock():
    """Test transcription with mocked model."""
    # Add mock test here
    pass

def test_whisper_model_list_sizes():
    """Test that Whisper model sizes include expected values."""
    model = WhisperModel(device="cpu", model_size="tiny")
    valid_sizes = model.get_available_sizes()
    assert "tiny" in valid_sizes
    assert "base" in valid_sizes
    assert "small" in valid_sizes
    assert "medium" in valid_sizes

@patch('ai_engine.models.whisper.WhisperModel._load_model')
def test_whisper_model_load_success(mock_load):
    """Test successful model loading."""
    mock_load.return_value = Mock()
    model = WhisperModel(device="cpu", model_size="tiny")
    assert model._model is not None

@patch('ai_engine.models.whisper.WhisperModel._load_model')
def test_whisper_model_load_failure(mock_load):
    """Test model loading failure."""
    mock_load.side_effect = Exception("Model load failed")
    with pytest.raises(Exception):
        WhisperModel(device="cpu", model_size="tiny")