"""
Integration tests for model download/delete lifecycle.

Tests the complete flow:
1. Download model
2. Verify structure
3. Verify detection via check_models
4. Delete model
5. Verify deletion

These tests verify the flat structure for diarization models:
- sherpa-onnx-segmentation/
- sherpa-onnx-embedding/
"""

import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add ai-engine to path
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ai-engine"))

from main import check_models, get_model_size_mb


class TestModelLifecycle:
    """Test model download and delete lifecycle."""

    @pytest.fixture
    def temp_cache(self, tmp_path):
        """Create a temporary cache directory."""
        cache_dir = tmp_path / "models"
        cache_dir.mkdir()
        return cache_dir

    def test_check_models_detects_sherpa_diarization(self, temp_cache):
        """Test that check_models detects Sherpa-ONNX diarization with flat structure."""
        # Create flat structure
        seg_path = temp_cache / "sherpa-onnx-segmentation"
        seg_path.mkdir()
        (seg_path / "model.onnx").write_bytes(b"0" * (35 * 1024 * 1024))  # 35MB

        emb_path = temp_cache / "sherpa-onnx-embedding"
        emb_path.mkdir()
        (emb_path / "model.onnx").write_bytes(b"0" * (85 * 1024 * 1024))  # 85MB

        # Verify detection
        result = check_models(str(temp_cache))

        diarization_models = [
            m for m in result["installedModels"] if m["model_type"] == "diarization"
        ]
        assert len(diarization_models) == 1
        assert diarization_models[0]["name"] == "sherpa-onnx-diarization"
        assert diarization_models[0]["size_mb"] == 120  # 35 + 85

    def test_check_models_skips_individual_components(self, temp_cache):
        """Test that individual diarization components are not listed separately."""
        # Create only segmentation (incomplete diarization)
        seg_path = temp_cache / "sherpa-onnx-segmentation"
        seg_path.mkdir()
        (seg_path / "model.onnx").write_bytes(b"0" * 1024)
        # No embedding

        # Verify no diarization model detected (individual components skipped)
        result = check_models(str(temp_cache))

        # Should not list individual components
        model_names = [m["name"] for m in result["installedModels"]]
        assert "sherpa-onnx-segmentation" not in model_names
        assert "sherpa-onnx-diarization" not in model_names  # Incomplete

    def test_check_models_with_whisper_and_sherpa_diarization(self, temp_cache):
        """Test detection of both transcription and sherpa-onnx diarization models."""
        # Create whisper model
        whisper_path = temp_cache / "whisper-base"
        whisper_path.mkdir()
        (whisper_path / "model.bin").write_bytes(b"0" * (150 * 1024 * 1024))

        # Create Sherpa diarization
        seg_path = temp_cache / "sherpa-onnx-segmentation"
        seg_path.mkdir()
        (seg_path / "model.onnx").write_bytes(b"0" * (35 * 1024 * 1024))

        emb_path = temp_cache / "sherpa-onnx-embedding"
        emb_path.mkdir()
        (emb_path / "model.onnx").write_bytes(b"0" * (85 * 1024 * 1024))

        # Verify detection
        result = check_models(str(temp_cache))

        assert result["status"] == "ok"  # Has transcription model
        assert result["hasRequiredModel"] is True

        models = result["installedModels"]
        assert len(models) == 2

        model_types = {m["model_type"] for m in models}
        assert "whisper" in model_types
        assert "diarization" in model_types

    def test_check_models_empty_cache(self, temp_cache):
        """Test check_models with empty cache directory."""
        result = check_models(str(temp_cache))

        assert result["status"] == "warning"
        assert result["hasRequiredModel"] is False
        assert len(result["installedModels"]) == 0

    def test_check_models_nonexistent_cache(self, tmp_path):
        """Test check_models with nonexistent cache directory."""
        nonexistent = tmp_path / "nonexistent"

        result = check_models(str(nonexistent))

        assert result["status"] == "warning"
        assert result["hasRequiredModel"] is False
        assert len(result["installedModels"]) == 0


class TestDiarizationSizeCalculation:
    """Test size calculation for diarization models."""

    @pytest.fixture
    def temp_cache(self, tmp_path):
        """Create a temporary cache directory."""
        cache_dir = tmp_path / "models"
        cache_dir.mkdir()
        return cache_dir

    def test_sherpa_size_calculation(self, temp_cache):
        """Test that Sherpa size is sum of segmentation + embedding."""
        seg_path = temp_cache / "sherpa-onnx-segmentation"
        seg_path.mkdir()
        (seg_path / "model.onnx").write_bytes(b"0" * (35 * 1024 * 1024))

        emb_path = temp_cache / "sherpa-onnx-embedding"
        emb_path.mkdir()
        (emb_path / "model.onnx").write_bytes(b"0" * (85 * 1024 * 1024))

        result = check_models(str(temp_cache))

        diarization = next(
            m
            for m in result["installedModels"]
            if m["name"] == "sherpa-onnx-diarization"
        )
        assert diarization["size_mb"] == 120


class TestModelDeletion:
    """Test model deletion scenarios."""

    @pytest.fixture
    def temp_cache(self, tmp_path):
        """Create a temporary cache directory."""
        cache_dir = tmp_path / "models"
        cache_dir.mkdir()
        return cache_dir

    def test_delete_sherpa_removes_both_components(self, temp_cache):
        """Test that deleting Sherpa removes both segmentation and embedding."""
        # Create structure
        seg_path = temp_cache / "sherpa-onnx-segmentation"
        seg_path.mkdir()
        (seg_path / "model.onnx").write_bytes(b"0" * 1024)

        emb_path = temp_cache / "sherpa-onnx-embedding"
        emb_path.mkdir()
        (emb_path / "model.onnx").write_bytes(b"0" * 1024)

        # Import delete function
        from main import delete_model

        # Delete
        delete_model("sherpa-onnx-diarization", str(temp_cache))

        # Verify both removed
        assert not seg_path.exists()
        assert not emb_path.exists()


class TestEdgeCases:
    """Test edge cases in model detection."""

    @pytest.fixture
    def temp_cache(self, tmp_path):
        """Create a temporary cache directory."""
        cache_dir = tmp_path / "models"
        cache_dir.mkdir()
        return cache_dir

    def test_partial_sherpa_not_detected(self, temp_cache):
        """Test that partial Sherpa (only embedding) is not detected."""
        # No segmentation
        emb_path = temp_cache / "sherpa-onnx-embedding"
        emb_path.mkdir()
        (emb_path / "model.onnx").write_bytes(b"0" * 1024)

        result = check_models(str(temp_cache))

        diarization_models = [
            m for m in result["installedModels"] if m["model_type"] == "diarization"
        ]
        assert len(diarization_models) == 0

    def test_unknown_directories_ignored(self, temp_cache):
        """Test that unknown directories are ignored."""
        # Create unknown directory
        unknown = temp_cache / "some-random-folder"
        unknown.mkdir()
        (unknown / "file.txt").write_text("test")

        result = check_models(str(temp_cache))

        assert len(result["installedModels"]) == 0
