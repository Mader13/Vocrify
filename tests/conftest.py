"""
Pytest configuration and shared fixtures for Transcribe Video tests.

This file provides:
- Custom pytest markers
- Shared fixtures for all tests
- Test configuration hooks
- Mock objects and test utilities
"""

import pytest
import os
import sys
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, MagicMock
from typing import Generator, Dict, Any
import io

# Add ai-engine to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ai-engine'))


# ============================================================================
# Custom Pytest Markers
# ============================================================================

def pytest_configure(config):
    """Configure custom pytest markers."""
    config.addinivalue_line(
        "markers", "unit: Unit tests (fast, isolated)"
    )
    config.addinivalue_line(
        "markers", "integration: Integration tests (slower, may use external services)"
    )
    config.addinivalue_line(
        "markers", "e2e: End-to-end tests (slowest, full system tests)"
    )
    config.addinivalue_line(
        "markers", "slow: Tests that take a long time to run"
    )
    config.addinivalue_line(
        "markers", "network: Tests that require network access"
    )
    config.addinivalue_line(
        "markers", "download: Tests related to model downloads"
    )
    config.addinivalue_line(
        "markers", "transcription: Tests related to transcription"
    )
    config.addinivalue_line(
        "markers", "diarization: Tests related to speaker diarization"
    )
    config.addinivalue_line(
        "markers", "security: Security-related tests"
    )
    config.addinivalue_line(
        "markers", "performance: Performance and benchmarking tests"
    )


# ============================================================================
# Path Fixtures
# ============================================================================

@pytest.fixture
def ai_engine_path() -> Path:
    """Get the path to the ai-engine directory."""
    return Path(__file__).parent.parent / "ai-engine"


@pytest.fixture
def tests_path() -> Path:
    """Get the path to the tests directory."""
    return Path(__file__).parent


@pytest.fixture
def fixtures_path() -> Path:
    """Get the path to the test fixtures directory."""
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


# ============================================================================
# Model Fixtures
# ============================================================================

@pytest.fixture
def sample_models() -> Dict[str, Dict[str, Any]]:
    """Sample model configurations for testing."""
    return {
        "whisper-tiny": {
            "name": "whisper-tiny",
            "type": "whisper",
            "size_mb": 75,
            "repo_id": "guillaumekln/faster-whisper-tiny",
        },
        "whisper-base": {
            "name": "whisper-base",
            "type": "whisper",
            "size_mb": 150,
            "repo_id": "guillaumekln/faster-whisper-base",
        },
        "whisper-small": {
            "name": "whisper-small",
            "type": "whisper",
            "size_mb": 500,
            "repo_id": "guillaumekln/faster-whisper-small",
        },
        "pyannote-diarization": {
            "name": "pyannote/speaker-diarization-3.1",
            "type": "diarization",
            "size_mb": 400,
            "repo_id": "pyannote/speaker-diarization-3.1",
            "requires_token": True,
        },
        "sherpa-onnx": {
            "name": "sherpa-onnx-diarization",
            "type": "diarization",
            "size_mb": 100,
            "url": "https://github.com/user/repo/releases/download/v1/model.onnx",
        },
    }


@pytest.fixture
def mock_model_dir(temp_dir: Path, sample_models: Dict[str, Dict[str, Any]]) -> Path:
    """Create a mock models directory with test models."""
    models_dir = temp_dir / "models"
    models_dir.mkdir()

    for model_name, model_info in sample_models.items():
        model_path = models_dir / model_name
        model_path.mkdir()

        # Create some fake model files
        (model_path / "model.bin").write_bytes(b"0" * (model_info["size_mb"] * 1024 * 1024))
        (model_path / "config.json").write_text(json.dumps(model_info))

    return models_dir


# ============================================================================
# Download Mock Fixtures
# ============================================================================

@pytest.fixture
def mock_snapshot_download():
    """Mock huggingface_hub.snapshot_download."""
    with pytest.mock.patch('main.snapshot_download') as mock:
        yield mock


@pytest.fixture
def mock_requests_get():
    """Mock requests.get for Sherpa-ONNX downloads."""
    with pytest.mock.patch('main.requests.get') as mock:
        yield mock


@pytest.fixture
def mock_huggingface_login():
    """Mock huggingface_hub.login."""
    with pytest.mock.patch('main.login') as mock:
        yield mock


# ============================================================================
# Progress and Event Fixtures
# ============================================================================

@pytest.fixture
def progress_events() -> Dict[str, list]:
    """Capture progress events emitted during tests."""
    events = {
        "progress": [],
        "error": [],
        "complete": [],
    }

    # Capture print statements (which emit JSON events)
    with pytest.mock.patch('builtins.print') as mock_print:
        yield events

        # Parse captured output
        for call in mock_print.call_args_list:
            try:
                output = call[0][0] if call[0] else ""
                if output:
                    event = json.loads(output)
                    event_type = event.get("type", "")
                    if event_type == "progress":
                        events["progress"].append(event)
                    elif event_type == "error":
                        events["error"].append(event)
                    elif event_type == "DownloadComplete":
                        events["complete"].append(event)
            except (json.JSONDecodeError, IndexError):
                pass


@pytest.fixture
def capture_stdout(capsys) -> Generator:
    """Capture stdout for parsing JSON events."""
    yield capsys


# ============================================================================
# Network Mock Fixtures
# ============================================================================

@pytest.fixture
def mock_network_success():
    """Mock successful network responses."""
    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.headers = {"content-length": "104857600"}  # 100 MB
    mock_response.raise_for_status = Mock()
    return mock_response


@pytest.fixture
def mock_network_failure():
    """Mock network failure."""
    mock_response = Mock()
    mock_response.status_code = 500
    mock_response.raise_for_status = Mock(side_effect=Exception("Network error"))
    return mock_response


@pytest.fixture
def mock_network_timeout():
    """Mock network timeout."""
    import requests
    return requests.exceptions.Timeout("Connection timed out")


# ============================================================================
# Token and Authentication Fixtures
# ============================================================================

@pytest.fixture
def sample_huggingface_token() -> str:
    """Sample HuggingFace token for testing."""
    return "hf_test_token_1234567890"


@pytest.fixture
def mock_token_file(temp_dir: Path, sample_huggingface_token: str) -> Path:
    """Create a mock token file."""
    token_file = temp_dir / "hf_token.txt"
    token_file.write_text(sample_huggingface_token)
    return token_file


# ============================================================================
# Cache and Storage Fixtures
# ============================================================================

@pytest.fixture
def mock_cache_dir(temp_dir: Path) -> Path:
    """Create a mock cache directory."""
    cache_dir = temp_dir / "cache"
    cache_dir.mkdir(parents=True)
    return cache_dir


@pytest.fixture
def mock_model_cache(mock_cache_dir: Path) -> Path:
    """Create a mock model cache with downloaded models."""
    models_cache = mock_cache_dir / "hub"
    models_cache.mkdir(parents=True)
    return models_cache


# ============================================================================
# Error and Exception Fixtures
# ============================================================================

@pytest.fixture
def mock_insufficient_disk_space():
    """Mock insufficient disk space error."""
    return OSError("No space left on device")


@pytest.fixture
def mock_permission_denied():
    """Mock permission denied error."""
    return PermissionError("Permission denied")


@pytest.fixture
def mock_network_unreachable():
    """Mock network unreachable error."""
    import requests
    return requests.exceptions.ConnectionError("Network unreachable")


# ============================================================================
# Test Data Fixtures
# ============================================================================

@pytest.fixture
def sample_audio_file(temp_dir: Path) -> Path:
    """Create a sample audio file for testing."""
    audio_file = temp_dir / "test_audio.wav"
    # Write a minimal WAV file header
    with open(audio_file, "wb") as f:
        f.write(b"RIFF")
        f.write((36).to_bytes(4, 'little'))  # File size
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write((16).to_bytes(4, 'little'))  # Chunk size
        f.write((1).to_bytes(2, 'little'))  # Audio format (PCM)
        f.write((1).to_bytes(2, 'little'))  # Channels
        f.write((16000).to_bytes(4, 'little'))  # Sample rate
        f.write((32000).to_bytes(4, 'little'))  # Byte rate
        f.write((2).to_bytes(2, 'little'))  # Block align
        f.write((16).to_bytes(2, 'little'))  # Bits per sample
        f.write(b"data")
        f.write((0).to_bytes(4, 'little'))  # Data size
    return audio_file


@pytest.fixture
def sample_video_file(temp_dir: Path) -> Path:
    """Create a sample video file for testing."""
    video_file = temp_dir / "test_video.mp4"
    # Write minimal MP4 header (just for testing existence)
    video_file.write_bytes(b"\x00\x00\x00\x20ftypmp42")
    return video_file


# ============================================================================
# Transcription Result Fixtures
# ============================================================================

@pytest.fixture
def sample_transcription_result() -> Dict[str, Any]:
    """Sample transcription result for testing."""
    return {
        "type": "result",
        "segments": [
            {
                "start": 0.0,
                "end": 2.5,
                "text": "Hello, world!",
                "speaker": "SPEAKER_00",
                "confidence": 0.95,
            },
            {
                "start": 2.5,
                "end": 5.0,
                "text": "This is a test.",
                "speaker": "SPEAKER_01",
                "confidence": 0.92,
            },
        ],
    }


# ============================================================================
# Configuration Fixtures
# ============================================================================

@pytest.fixture
def mock_config() -> Dict[str, Any]:
    """Mock application configuration."""
    return {
        "models_dir": "/tmp/test_models",
        "max_concurrent_downloads": 3,
        "max_concurrent_tasks": 2,
        "download_timeout": 300,
        "max_download_size": 2 * 1024 * 1024 * 1024,  # 2GB
    }


# ============================================================================
# Cleanup Helpers
# ============================================================================

@pytest.fixture(autouse=True)
def reset_download_state():
    """Reset download cancellation state before each test."""
    import main
    main._download_cancelled["cancelled"] = False
    yield
    main._download_cancelled["cancelled"] = False


# ============================================================================
# Performance Monitoring Fixtures
# ============================================================================

@pytest.fixture
def performance_tracker():
    """Track performance metrics during tests."""
    import time

    class Tracker:
        def __init__(self):
            self.metrics = {}

        def start(self, name: str):
            self.metrics[name] = {"start": time.time()}

        def end(self, name: str):
            if name in self.metrics:
                self.metrics[name]["end"] = time.time()
                self.metrics[name]["duration"] = (
                    self.metrics[name]["end"] - self.metrics[name]["start"]
                )

        def get_duration(self, name: str) -> float:
            return self.metrics.get(name, {}).get("duration", 0.0)

    tracker = Tracker()
    yield tracker
    # Print performance summary after test
    for name, data in tracker.metrics.items():
        if "duration" in data:
            print(f"\n[PERF] {name}: {data['duration']:.3f}s")


# ============================================================================
# Async Support
# ============================================================================

@pytest.fixture
def event_loop():
    """Create an event loop for async tests."""
    import asyncio
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
