"""
Integration tests for model management

This test module covers:
- Model download from HuggingFace
- Model download from GitHub (Sherpa-ONNX)
- Model listing
- Model deletion
- Disk space calculation
- Token-based authentication
"""
import pytest
import json
import subprocess
import tempfile
import os
from pathlib import Path
from unittest.mock import Mock, patch

# Test configuration
PYTHON_EXE = "python"
AI_ENGINE_PATH = str(Path(__file__).parent.parent.parent / "ai-engine" / "main.py")


@pytest.mark.integration
class TestModelDownload:
    """Test model download functionality."""

    @pytest.fixture
    def cache_dir(self, tmp_path):
        """Create a temporary cache directory."""
        cache = tmp_path / "models"
        cache.mkdir()
        return str(cache)

    def test_list_models_empty_cache(self, cache_dir):
        """Test listing models when cache is empty."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--list-models", "--cache-dir", cache_dir],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate()

        # Should get empty list
        response = json.loads(stdout.strip())
        assert response["type"] == "ModelsList"
        assert len(response["data"]) == 0

    def test_download_whisper_model(self, cache_dir):
        """Test downloading a Whisper model from HuggingFace."""
        pytest.skip("Requires network and HuggingFace access - mark as @network to run")

        process = subprocess.Popen(
            [
                PYTHON_EXE, AI_ENGINE_PATH,
                "--download-model", "whisper-tiny",
                "--cache-dir", cache_dir,
                "--model-type", "whisper"
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Read progress events
        events = []
        while True:
            line = process.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line.strip())
                events.append(event)
                if event.get("type") in ["DownloadComplete", "error"]:
                    break
            except json.JSONDecodeError:
                pass

        process.wait(timeout=300)  # 5 minutes timeout

        # Verify download completed
        complete_events = [e for e in events if e.get("type") == "DownloadComplete"]
        assert len(complete_events) > 0, "Expected DownloadComplete event"

        # Verify model directory exists
        model_dir = Path(cache_dir) / "whisper-tiny"
        assert model_dir.exists(), "Model directory should exist"

    def test_download_with_invalid_model(self, cache_dir):
        """Test download fails with invalid model name."""
        pytest.skip("Requires network - mark as @network to run")

        process = subprocess.Popen(
            [
                PYTHON_EXE, AI_ENGINE_PATH,
                "--download-model", "nonexistent-model",
                "--cache-dir", cache_dir,
                "--model-type", "diarization",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Should get error
        events = []
        while True:
            line = process.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line.strip())
                events.append(event)
                if event.get("type") in ["error", "DownloadComplete"]:
                    break
            except json.JSONDecodeError:
                pass

        process.wait()

        # Should get error event
        error_events = [e for e in events if e.get("type") == "error"]
        assert len(error_events) > 0, "Expected error event for invalid model"

    def test_download_sherpa_onnx_model(self, cache_dir):
        """Test downloading Sherpa-ONNX models from GitHub."""
        pytest.skip("Requires network - mark as @network to run")

        process = subprocess.Popen(
            [
                PYTHON_EXE, AI_ENGINE_PATH,
                "--download-model", "sherpa-onnx-diarization",
                "--cache-dir", cache_dir,
                "--model-type", "diarization"
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Monitor progress
        events = []
        while True:
            line = process.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line.strip())
                events.append(event)
                if event.get("type") in ["DownloadComplete", "error"]:
                    break
            except json.JSONDecodeError:
                pass

        process.wait(timeout=600)  # 10 minutes timeout

        # Verify download completed
        complete_events = [e for e in events if e.get("type") == "DownloadComplete"]
        assert len(complete_events) > 0

        # Verify model directories exist
        segmentation_dir = Path(cache_dir) / "sherpa-onnx-diarization" / "sherpa-onnx-segmentation"
        embedding_dir = Path(cache_dir) / "sherpa-onnx-diarization" / "sherpa-onnx-embedding"
        assert segmentation_dir.exists() or embedding_dir.exists()

    def test_download_progress_events(self, cache_dir):
        """Test that download progress events are emitted."""
        pytest.skip("Requires network - mark as @network to run")

        process = subprocess.Popen(
            [
                PYTHON_EXE, AI_ENGINE_PATH,
                "--download-model", "whisper-tiny",
                "--cache-dir", cache_dir,
                "--model-type", "whisper"
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        progress_events = []
        while True:
            line = process.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line.strip())
                if event.get("type") == "Progress":
                    progress_events.append(event)
                elif event.get("type") in ["DownloadComplete", "error"]:
                    break
            except json.JSONDecodeError:
                pass

        process.wait()

        # Should have progress events
        assert len(progress_events) > 0, "Expected progress events"

        # Verify progress values are reasonable
        for event in progress_events:
            data = event.get("data", {})
            assert "current" in data
            assert "total" in data
            assert "percent" in data
            assert 0 <= data["percent"] <= 100

    @pytest.mark.parametrize("model_name,model_type", [
        ("whisper-tiny", "whisper"),
        ("whisper-base", "whisper"),
        ("whisper-small", "whisper"),
        ("sherpa-onnx-diarization", "diarization"),
    ])
    def test_download_all_model_types(self, cache_dir, model_name, model_type):
        """Test downloading all supported model types."""
        pytest.skip("Requires network - mark as @network to run")

        process = subprocess.Popen(
            [
                PYTHON_EXE, AI_ENGINE_PATH,
                "--download-model", model_name,
                "--cache-dir", cache_dir,
                "--model-type", model_type
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Wait for completion
        events = []
        while True:
            line = process.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line.strip())
                events.append(event)
                if event.get("type") in ["DownloadComplete", "error"]:
                    break
            except json.JSONDecodeError:
                pass

        process.wait(timeout=600)

        # Verify completion
        complete_events = [e for e in events if e.get("type") == "DownloadComplete"]
        assert len(complete_events) > 0


@pytest.mark.integration
class TestModelListing:
    """Test model listing functionality."""

    @pytest.fixture
    def populated_cache(self, tmp_path):
        """Create a cache with some fake models."""
        cache = tmp_path / "models"
        cache.mkdir()

        # Create fake model directories
        models = ["whisper-tiny", "whisper-base", "sherpa-onnx-diarization"]
        for model in models:
            model_dir = cache / model
            model_dir.mkdir()
            # Add fake model file
            (model_dir / "model.bin").write_bytes(b"x" * (1024 * 1024 * 50))  # 50MB

        return str(cache)

    def test_list_models_populated_cache(self, populated_cache):
        """Test listing models when cache has models."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--list-models", "--cache-dir", populated_cache],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate()
        response = json.loads(stdout.strip())

        assert response["type"] == "ModelsList"
        models = response["data"]
        assert len(models) == 3

        # Verify model data
        model_names = {m["name"] for m in models}
        assert "whisper-tiny" in model_names
        assert "whisper-base" in model_names
        assert "sherpa-onnx-diarization" in model_names

        # Verify all have size info
        for model in models:
            assert "size_mb" in model
            assert model["size_mb"] > 0
            assert "model_type" in model
            assert model["installed"] is True


@pytest.mark.integration
class TestModelDeletion:
    """Test model deletion functionality."""

    @pytest.fixture
    def cache_with_models(self, tmp_path):
        """Create a cache with models to delete."""
        cache = tmp_path / "models"
        cache.mkdir()

        # Create fake models
        for model in ["whisper-tiny", "whisper-base"]:
            model_dir = cache / model
            model_dir.mkdir()
            (model_dir / "model.bin").write_bytes(b"x" * 1024)

        return str(cache)

    def test_delete_existing_model(self, cache_with_models):
        """Test deleting an existing model."""
        model_dir = Path(cache_with_models) / "whisper-tiny"
        assert model_dir.exists()

        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--delete-model", "whisper-tiny", "--cache-dir", cache_with_models],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate()
        response = json.loads(stdout.strip())

        assert response["type"] == "DeleteComplete"
        assert not model_dir.exists(), "Model directory should be deleted"

    def test_delete_nonexistent_model(self, cache_with_models):
        """Test deleting a model that doesn't exist."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--delete-model", "nonexistent-model", "--cache-dir", cache_with_models],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate()
        response = json.loads(stdout.strip())

        assert response["type"] == "error"
        assert "not found" in response["error"].lower()


@pytest.mark.integration
class TestDiskSpace:
    """Test disk space calculation."""

    def test_calculate_disk_usage(self, tmp_path):
        """Test calculating disk usage for models."""
        cache = tmp_path / "models"
        cache.mkdir()

        # Create models with known sizes
        (cache / "model1").mkdir()
        (cache / "model1" / "file1.bin").write_bytes(b"x" * (1024 * 1024))  # 1MB
        (cache / "model1" / "file2.bin").write_bytes(b"x" * (2 * 1024 * 1024))  # 2MB

        (cache / "model2").mkdir()
        (cache / "model2" / "file3.bin").write_bytes(b"x" * (512 * 1024))  # 512KB

        # List models to get sizes
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--list-models", "--cache-dir", str(cache)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate()
        response = json.loads(stdout.strip())

        models = response["data"]
        total_size = sum(m["size_mb"] for m in models)

        # Should be approximately 3-4MB
        assert 3 <= total_size <= 4


@pytest.mark.integration
@pytest.mark.network
class TestModelDownloadScenarios:
    """Test various model download scenarios."""

    def test_download_resume_after_interruption(self, tmp_path):
        """Test that download can resume after interruption."""
        pytest.skip("Complex scenario - requires implementation")

    def test_concurrent_downloads(self, tmp_path):
        """Test downloading multiple models concurrently."""
        pytest.skip("Requires concurrent process management")

    def test_download_with_insufficient_disk_space(self, tmp_path):
        """Test download failure when disk is full."""
        pytest.skip("Requires disk space simulation")

    def test_download_with_network_timeout(self, tmp_path):
        """Test download timeout handling."""
        pytest.skip("Requires network simulation")


# Helper functions

def wait_for_download_complete(process, timeout=600):
    """Wait for download to complete or error."""
    import time

    start_time = time.time()
    events = []

    while time.time() - start_time < timeout:
        line = process.stdout.readline()
        if not line:
            break

        try:
            event = json.loads(line.strip())
            events.append(event)

            if event.get("type") in ["DownloadComplete", "error"]:
                return events
        except json.JSONDecodeError:
            pass

    return events


# Pytest fixtures

@pytest.fixture
def mock_huggingface_token():
    """Provide a mock HuggingFace token."""
    return "hf_test_token_12345"


@pytest.fixture
def token_file(self, tmp_path, mock_huggingface_token):
    """Create a temporary token file."""
    token_path = tmp_path / "token.txt"
    token_path.write_text(mock_huggingface_token)
    return str(token_path)
