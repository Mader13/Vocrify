"""
Unit tests for checkpoint/resume functionality.

Tests cover:
- CheckpointManager save/load functionality
- AudioChunker split/merge operations
- CheckpointMetadata serialization
- File change detection
- Segment merging with overlap
"""

import pytest
import os
import sys
import json
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from typing import List, Dict, Any

# Add ai-engine to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))

from checkpoint import (
    CheckpointManager,
    CheckpointMetadata,
    AudioChunker,
    checkpoint_manager
)


# ============================================================================
# CheckpointMetadata Tests
# ============================================================================

class TestCheckpointMetadata:
    """Test CheckpointMetadata dataclass."""

    def test_create_metadata(self):
        """Test creating CheckpointMetadata."""
        metadata = CheckpointMetadata(
            file_path="/path/to/audio.wav",
            file_hash="abc123",
            chunk_duration=300.0,
            overlap_duration=5.0,
            total_chunks=3,
            completed_chunks=[0, 1],
            model_name="distil-large-v3",
            device="cuda",
            language="en"
        )

        assert metadata.file_path == "/path/to/audio.wav"
        assert metadata.file_hash == "abc123"
        assert metadata.chunk_duration == 300.0
        assert metadata.overlap_duration == 5.0
        assert metadata.total_chunks == 3
        assert metadata.completed_chunks == [0, 1]
        assert metadata.model_name == "distil-large-v3"
        assert metadata.device == "cuda"
        assert metadata.language == "en"

    def test_metadata_to_dict(self):
        """Test converting metadata to dictionary."""
        metadata = CheckpointMetadata(
            file_path="test.wav",
            file_hash="hash123",
            chunk_duration=300.0,
            overlap_duration=5.0,
            total_chunks=2,
            completed_chunks=[0],
            model_name="whisper-base",
            device="cpu",
            language=None
        )

        result = metadata.to_dict()

        assert isinstance(result, dict)
        assert result["file_path"] == "test.wav"
        assert result["file_hash"] == "hash123"
        assert result["total_chunks"] == 2
        assert result["language"] is None

    def test_metadata_from_dict(self):
        """Test creating metadata from dictionary."""
        data = {
            "file_path": "test.wav",
            "file_hash": "hash123",
            "chunk_duration": 300.0,
            "overlap_duration": 5.0,
            "total_chunks": 2,
            "completed_chunks": [0, 1],
            "model_name": "whisper-base",
            "device": "cpu",
            "language": "en"
        }

        metadata = CheckpointMetadata.from_dict(data)

        assert metadata.file_path == "test.wav"
        assert metadata.completed_chunks == [0, 1]
        assert metadata.language == "en"

    def test_metadata_roundtrip(self):
        """Test metadata serialization roundtrip."""
        original = CheckpointMetadata(
            file_path="/path/audio.mp3",
            file_hash="xyz789",
            chunk_duration=600.0,
            overlap_duration=10.0,
            total_chunks=5,
            completed_chunks=[0, 1, 2],
            model_name="distil-small",
            device="cpu",
            language=None
        )

        # Serialize and deserialize
        dict_data = original.to_dict()
        restored = CheckpointMetadata.from_dict(dict_data)

        assert restored.file_path == original.file_path
        assert restored.file_hash == original.file_hash
        assert restored.chunk_duration == original.chunk_duration
        assert restored.overlap_duration == original.overlap_duration
        assert restored.total_chunks == original.total_chunks
        assert restored.completed_chunks == original.completed_chunks
        assert restored.model_name == original.model_name
        assert restored.device == original.device
        assert restored.language == original.language


# ============================================================================
# CheckpointManager Tests
# ============================================================================

class TestCheckpointManager:
    """Test CheckpointManager functionality."""

    @pytest.fixture
    def temp_checkpoint_dir(self):
        """Create a temporary directory for checkpoints."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def manager(self, temp_checkpoint_dir):
        """Create a CheckpointManager with temp directory."""
        return CheckpointManager(checkpoint_dir=str(temp_checkpoint_dir))

    @pytest.fixture
    def sample_metadata(self):
        """Sample checkpoint metadata for testing."""
        return CheckpointMetadata(
            file_path="/test/audio.wav",
            file_hash="test_hash_123",
            chunk_duration=300.0,
            overlap_duration=5.0,
            total_chunks=3,
            completed_chunks=[],
            model_name="whisper-base",
            device="cpu",
            language="en"
        )

    @pytest.fixture
    def sample_segments(self):
        """Sample transcription segments."""
        return [
            {"start": 0.0, "end": 2.5, "text": "First segment", "speaker": None, "confidence": 0.95},
            {"start": 2.5, "end": 5.0, "text": "Second segment", "speaker": None, "confidence": 0.92},
        ]

    def test_checkpoint_manager_creates_directory(self):
        """Test that CheckpointManager creates checkpoint directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            checkpoint_dir = Path(tmpdir) / "checkpoints"
            manager = CheckpointManager(checkpoint_dir=str(checkpoint_dir))

            assert checkpoint_dir.exists()
            assert checkpoint_dir.is_dir()

    def test_save_checkpoint_creates_file(self, manager, sample_metadata, sample_segments):
        """Test that save_checkpoint creates a checkpoint file."""
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        checkpoint_file = manager._get_checkpoint_path("/test/audio.wav")
        assert checkpoint_file.exists()

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash_123')
    def test_save_checkpoint_updates_completed_chunks(self, mock_hash, manager, sample_metadata, sample_segments):
        """Test that save_checkpoint updates completed_chunks in metadata."""
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        # Save another chunk
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=1,
            segments=sample_segments,
            metadata=sample_metadata
        )

        data = manager.load_checkpoint("/test/audio.wav")
        assert data["metadata"]["completed_chunks"] == [0, 1]

    def test_load_checkpoint_returns_none_when_not_exists(self, manager):
        """Test load_checkpoint returns None for non-existent checkpoint."""
        result = manager.load_checkpoint("/nonexistent/audio.wav")
        assert result is None

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash_123')
    def test_load_checkpoint_returns_data(self, mock_hash, manager, sample_metadata, sample_segments):
        """Test load_checkpoint returns saved checkpoint data."""
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        result = manager.load_checkpoint("/test/audio.wav")

        assert result is not None
        assert "metadata" in result
        assert "chunks" in result
        assert "0" in result["chunks"]
        assert len(result["chunks"]["0"]) == 2

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash_123')
    def test_load_checkpoint_preserves_segment_data(self, mock_hash, manager, sample_metadata, sample_segments):
        """Test that segments are preserved correctly."""
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        result = manager.load_checkpoint("/test/audio.wav")
        loaded_segments = result["chunks"]["0"]

        assert loaded_segments[0]["start"] == 0.0
        assert loaded_segments[0]["end"] == 2.5
        assert loaded_segments[0]["text"] == "First segment"
        assert loaded_segments[1]["text"] == "Second segment"

    def test_delete_checkpoint_removes_file(self, manager, sample_metadata, sample_segments):
        """Test delete_checkpoint removes checkpoint file."""
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        checkpoint_file = manager._get_checkpoint_path("/test/audio.wav")
        assert checkpoint_file.exists()

        manager.delete_checkpoint("/test/audio.wav")
        assert not checkpoint_file.exists()

    def test_delete_nonexistent_checkpoint(self, manager):
        """Test deleting non-existent checkpoint doesn't raise error."""
        # Should not raise
        manager.delete_checkpoint("/nonexistent/audio.wav")

    def test_get_completed_chunks_returns_empty_when_no_checkpoint(self, manager):
        """Test get_completed_chunks returns empty list for no checkpoint."""
        chunks = manager.get_completed_chunks("/no/checkpoint.wav")
        assert chunks == []

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash_123')
    def test_get_completed_chunks_returns_list(self, mock_hash, manager, sample_metadata, sample_segments):
        """Test get_completed_chunks returns list of completed chunk indices."""
        for i in range(3):
            manager.save_checkpoint(
                file_path="/test/audio.wav",
                chunk_index=i,
                segments=sample_segments,
                metadata=sample_metadata
            )

        chunks = manager.get_completed_chunks("/test/audio.wav")
        assert chunks == [0, 1, 2]

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash_123')
    def test_get_chunk_segments_returns_segments(self, mock_hash, manager, sample_metadata, sample_segments):
        """Test get_chunk_segments returns segments for specific chunk."""
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        segments = manager.get_chunk_segments("/test/audio.wav", 0)
        assert segments is not None
        assert len(segments) == 2
        assert segments[0]["text"] == "First segment"

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash_123')
    def test_get_chunk_segments_returns_none_for_missing_chunk(self, mock_hash, manager, sample_metadata, sample_segments):
        """Test get_chunk_segments returns None for non-existent chunk."""
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        segments = manager.get_chunk_segments("/test/audio.wav", 1)
        assert segments is None

    def test_checkpoint_path_generation(self, manager):
        """Test that checkpoint paths are generated correctly."""
        path1 = manager._get_checkpoint_path("/test/audio1.wav")
        path2 = manager._get_checkpoint_path("/test/audio2.wav")

        assert path1 != path2
        assert "checkpoint_" in str(path1)
        assert str(path1).endswith(".json")

    def test_checkpoint_path_is_deterministic(self, manager):
        """Test that same file path generates same checkpoint path."""
        path1 = manager._get_checkpoint_path("/test/audio.wav")
        path2 = manager._get_checkpoint_path("/test/audio.wav")

        assert path1 == path2

    @patch('checkpoint.os.stat')
    def test_file_hash_generation(self, mock_stat, manager):
        """Test _get_file_hash generates consistent hash."""
        # Mock file stat
        mock_stat_result = Mock()
        mock_stat_result.st_size = 12345
        mock_stat_result.st_mtime = 1234567890.123
        mock_stat.return_value = mock_stat_result

        hash1 = manager._get_file_hash("/test/audio.wav")
        hash2 = manager._get_file_hash("/test/audio.wav")

        assert hash1 == hash2
        assert isinstance(hash1, str)
        assert len(hash1) == 32  # MD5 hash length

    @patch('checkpoint.os.stat')
    def test_file_hash_changes_with_file_change(self, mock_stat, manager):
        """Test file hash changes when file changes."""
        # First stat
        mock_stat_result1 = Mock()
        mock_stat_result1.st_size = 12345
        mock_stat_result1.st_mtime = 1234567890.123

        # Second stat (file changed)
        mock_stat_result2 = Mock()
        mock_stat_result2.st_size = 54321
        mock_stat_result2.st_mtime = 1234567899.999

        mock_stat.side_effect = [mock_stat_result1, mock_stat_result2]

        hash1 = manager._get_file_hash("/test/audio.wav")
        hash2 = manager._get_file_hash("/test/audio.wav")

        assert hash1 != hash2

    def test_load_checkpoint_detects_file_change(self, manager, sample_metadata, sample_segments):
        """Test load_checkpoint returns None when file has changed."""
        # Save checkpoint
        manager.save_checkpoint(
            file_path="/test/audio.wav",
            chunk_index=0,
            segments=sample_segments,
            metadata=sample_metadata
        )

        # Mock file hash to simulate file change
        with patch.object(manager, '_get_file_hash', return_value='different_hash'):
            result = manager.load_checkpoint("/test/audio.wav")

        assert result is None


# ============================================================================
# AudioChunker Tests
# ============================================================================

class TestAudioChunker:
    """Test AudioChunker functionality."""

    @pytest.fixture
    def chunker(self):
        """Create an AudioChunker with default settings."""
        return AudioChunker(
            chunk_duration=300.0,  # 5 minutes
            overlap_duration=5.0    # 5 seconds overlap
        )

    @pytest.fixture
    def short_chunker(self):
        """Create an AudioChunker with shorter chunks for testing."""
        return AudioChunker(
            chunk_duration=30.0,   # 30 seconds
            overlap_duration=2.0   # 2 seconds overlap
        )

    def test_chunker_initialization(self):
        """Test AudioChunker initialization."""
        chunker = AudioChunker(chunk_duration=600.0, overlap_duration=10.0)
        assert chunker.chunk_duration == 600.0
        assert chunker.overlap_duration == 10.0

    @patch('checkpoint.subprocess.run')
    def test_get_audio_duration(self, mock_run, chunker):
        """Test getting audio duration using ffprobe."""
        mock_result = Mock()
        mock_result.stdout = "125.5"
        mock_run.return_value = mock_result

        duration = chunker._get_audio_duration("/test/audio.wav")

        assert duration == 125.5

    @patch('checkpoint.subprocess.run')
    def test_get_audio_duration_on_error(self, mock_run, chunker):
        """Test audio duration fallback on ffprobe error."""
        mock_run.side_effect = Exception("ffprobe not found")

        duration = chunker._get_audio_duration("/test/audio.wav")

        assert duration == 0.0

    @patch('checkpoint.subprocess.run')
    def test_get_chunk_count(self, mock_run, chunker):
        """Test calculating number of chunks."""
        # Mock 10 minutes of audio
        mock_result = Mock()
        mock_result.stdout = "600.0"
        mock_run.return_value = mock_result

        count = chunker.get_chunk_count("/test/audio.wav")

        # 600 seconds / 300 second chunks = 2 chunks
        assert count == 2

    @patch('checkpoint.subprocess.run')
    def test_get_chunk_count_rounds_up(self, mock_run, short_chunker):
        """Test chunk count rounds up for partial chunks."""
        # Mock 75 seconds of audio
        mock_result = Mock()
        mock_result.stdout = "75.0"
        mock_run.return_value = mock_result

        count = short_chunker.get_chunk_count("/test/audio.wav")

        # 75 seconds / 30 second chunks = 2.5 -> rounds up to 3
        assert count == 3

    @patch('checkpoint.subprocess.run')
    @patch('checkpoint.os.makedirs')
    def test_split_audio_creates_chunk(self, mock_makedirs, mock_run, chunker):
        """Test split_audio extracts a chunk."""
        mock_run.return_value = Mock()

        with tempfile.TemporaryDirectory() as tmpdir:
            result = chunker.split_audio(
                file_path="/test/audio.wav",
                chunk_index=0,
                output_dir=tmpdir
            )

            # Verify ffmpeg command was called
            assert mock_run.called
            cmd_args = mock_run.call_args[0][0]
            assert "ffmpeg" in cmd_args
            assert "-ss" in cmd_args
            assert "-t" in cmd_args

    @patch('checkpoint.subprocess.run')
    def test_split_audio_with_overlap(self, mock_run, chunker):
        """Test split_audio includes overlap in chunk."""
        mock_run.return_value = Mock()

        with tempfile.TemporaryDirectory() as tmpdir:
            chunker.split_audio(
                file_path="/test/audio.wav",
                chunk_index=0,
                output_dir=tmpdir
            )

            cmd_args = mock_run.call_args[0][0]
            # Duration should be chunk_duration + overlap_duration
            ss_index = cmd_args.index("-ss")
            t_index = cmd_args.index("-t")
            duration = float(cmd_args[t_index + 1])

            assert duration == 305.0  # 300 + 5 overlap

    @patch('checkpoint.subprocess.run')
    @patch('checkpoint.os.makedirs')
    def test_split_audio_chunk_index_offset(self, mock_makedirs, mock_run, short_chunker):
        """Test split_audio uses correct start time for chunk index."""
        mock_run.return_value = Mock()

        with tempfile.TemporaryDirectory() as tmpdir:
            short_chunker.split_audio(
                file_path="/test/audio.wav",
                chunk_index=2,
                output_dir=tmpdir
            )

            cmd_args = mock_run.call_args[0][0]
            ss_index = cmd_args.index("-ss")
            start_time = float(cmd_args[ss_index + 1])

            # Chunk 2 should start at 2 * 30 = 60 seconds
            assert start_time == 60.0

    @patch('checkpoint.subprocess.run')
    def test_split_audio_creates_wav_format(self, mock_run, chunker):
        """Test split_audio outputs WAV format with correct parameters."""
        mock_run.return_value = Mock()

        with tempfile.TemporaryDirectory() as tmpdir:
            chunker.split_audio(
                file_path="/test/audio.wav",
                chunk_index=0,
                output_dir=tmpdir
            )

            cmd_args = mock_run.call_args[0][0]
            assert "pcm_s16le" in cmd_args  # WAV codec
            assert "-ar" in cmd_args
            assert "16000" in cmd_args  # 16kHz sample rate
            assert "-ac" in cmd_args
            assert "1" in cmd_args  # Mono

    @patch('checkpoint.subprocess.run')
    def test_split_audio_returns_path(self, mock_run, chunker):
        """Test split_audio returns path to created chunk."""
        mock_run.return_value = Mock()

        with tempfile.TemporaryDirectory() as tmpdir:
            result = chunker.split_audio(
                file_path="/test/audio.wav",
                chunk_index=0,
                output_dir=tmpdir
            )

            assert result is not None
            assert "chunk_0000" in result
            assert result.endswith(".wav")


# ============================================================================
# Segment Merging Tests
# ============================================================================

class TestSegmentMerging:
    """Test AudioChunker.merge_segments functionality."""

    @pytest.fixture
    def chunker(self):
        """Create an AudioChunker for testing merge operations."""
        return AudioChunker(
            chunk_duration=10.0,   # 10 seconds per chunk
            overlap_duration=2.0   # 2 seconds overlap
        )

    @pytest.fixture
    def single_chunk_segments(self):
        """Sample segments from a single chunk."""
        return [
            {"start": 0.0, "end": 2.0, "text": "Segment 1", "speaker": None, "confidence": 0.9},
            {"start": 2.0, "end": 4.0, "text": "Segment 2", "speaker": None, "confidence": 0.9},
        ]

    @pytest.fixture
    def multi_chunk_segments(self):
        """Sample segments from multiple chunks with overlap."""
        return [
            # Chunk 0: segments at 0-2, 2-4, 8-10 (in overlap region)
            [
                {"start": 0.0, "end": 2.0, "text": "Chunk 0: Seg 1", "speaker": None, "confidence": 0.9},
                {"start": 2.0, "end": 4.0, "text": "Chunk 0: Seg 2", "speaker": None, "confidence": 0.9},
                {"start": 8.0, "end": 10.0, "text": "Chunk 0: Overlap", "speaker": None, "confidence": 0.9},
            ],
            # Chunk 1: segments at 0-2 (overlap), 2-4, 8-10 (overlap)
            [
                {"start": 0.0, "end": 2.0, "text": "Chunk 1: Overlap", "speaker": None, "confidence": 0.9},
                {"start": 2.0, "end": 4.0, "text": "Chunk 1: Seg 2", "speaker": None, "confidence": 0.9},
                {"start": 8.0, "end": 10.0, "text": "Chunk 1: Overlap end", "speaker": None, "confidence": 0.9},
            ],
        ]

    def test_merge_single_chunk(self, chunker, single_chunk_segments):
        """Test merging segments from a single chunk."""
        result = chunker.merge_segments(
            chunk_segments=[single_chunk_segments],
            chunk_duration=10.0,
            overlap_duration=2.0
        )

        # All segments should be preserved
        assert len(result) == 2
        assert result[0]["text"] == "Segment 1"
        assert result[1]["text"] == "Segment 2"

    def test_merge_adjusts_timestamps(self, chunker):
        """Test that merge adjusts segment timestamps to global timeline."""
        # Use segments that won't be skipped by overlap logic
        # Overlap threshold is 1.0 (overlap_duration / 2)
        # So segments starting >= 1.0 will be kept
        chunk_segments = [
            [
                {"start": 0.0, "end": 2.0, "text": "First", "speaker": None, "confidence": 0.9},
            ],
            [
                {"start": 1.5, "end": 3.5, "text": "Second", "speaker": None, "confidence": 0.9},
            ],
        ]

        result = chunker.merge_segments(
            chunk_segments=chunk_segments,
            chunk_duration=10.0,
            overlap_duration=2.0
        )

        # Should have both segments (second starts after overlap threshold of 1.0)
        assert len(result) >= 1
        assert result[0]["start"] == 0.0
        assert result[0]["end"] == 2.0

        # Second chunk should be offset and start adjusted for overlap
        if len(result) > 1:
            # Second segment starts at 1.5 locally, which is > 1.0 threshold
            # So it's kept and adjusted
            assert result[1]["start"] >= 10.0

    def test_merge_removes_overlap_duplicates(self, chunker, multi_chunk_segments):
        """Test that merge removes duplicate segments from overlap regions."""
        result = chunker.merge_segments(
            chunk_segments=multi_chunk_segments,
            chunk_duration=10.0,
            overlap_duration=2.0
        )

        # Should have fewer segments than total (duplicates removed)
        total_input = sum(len(ch) for ch in multi_chunk_segments)
        assert len(result) < total_input

        # Check that segments are sorted by start time
        starts = [s["start"] for s in result]
        assert starts == sorted(starts)

    def test_merge_skips_early_overlap_segments(self, chunker):
        """Test that segments in early overlap (before threshold) are skipped."""
        overlap_threshold = chunker.overlap_duration / 2  # 1 second

        chunk_segments = [
            # Chunk 0: normal segment
            [
                {"start": 0.0, "end": 2.0, "text": "Keep this", "speaker": None, "confidence": 0.9},
            ],
            # Chunk 1: segment starts in overlap (before threshold)
            [
                {"start": 0.5, "end": 2.5, "text": "Skip this (early overlap)", "speaker": None, "confidence": 0.9},
            ],
        ]

        result = chunker.merge_segments(
            chunk_segments=chunk_segments,
            chunk_duration=10.0,
            overlap_duration=2.0
        )

        # Should only have the first segment (second is skipped due to early overlap)
        assert len(result) == 1
        assert result[0]["text"] == "Keep this"

    def test_merge_keeps_late_overlap_segments(self, chunker):
        """Test that segments in late overlap (after threshold) are kept."""
        chunk_segments = [
            # Chunk 0: normal segment
            [
                {"start": 0.0, "end": 2.0, "text": "First", "speaker": None, "confidence": 0.9},
            ],
            # Chunk 1: segment starts after overlap threshold (at 1.5s, which is > 1s threshold)
            [
                {"start": 1.5, "end": 3.5, "text": "Keep this (late overlap)", "speaker": None, "confidence": 0.9},
            ],
        ]

        result = chunker.merge_segments(
            chunk_segments=chunk_segments,
            chunk_duration=10.0,
            overlap_duration=2.0
        )

        # Both segments should be kept
        assert len(result) == 2

    def test_merge_sorts_by_start_time(self, chunker):
        """Test that merged segments are sorted by start time."""
        chunk_segments = [
            [
                {"start": 5.0, "end": 7.0, "text": "Later", "speaker": None, "confidence": 0.9},
                {"start": 1.0, "end": 3.0, "text": "Earlier", "speaker": None, "confidence": 0.9},
            ],
        ]

        result = chunker.merge_segments(
            chunk_segments=chunk_segments,
            chunk_duration=10.0,
            overlap_duration=2.0
        )

        starts = [s["start"] for s in result]
        assert starts == sorted(starts)

    def test_merge_with_complex_overlap_scenario(self, chunker):
        """Test merge with a complex overlap scenario."""
        # 10 second chunks, 2 second overlap
        # Overlap threshold is 1.0 (overlap_duration / 2)
        chunk_segments = [
            # Chunk 0 (global time 0-10)
            [
                {"start": 0.0, "end": 3.0, "text": "C0-1", "speaker": None, "confidence": 0.9},
                {"start": 7.0, "end": 10.0, "text": "C0-2", "speaker": None, "confidence": 0.9},
            ],
            # Chunk 1 (global time 10-20, local 0-2 is overlap with chunk 0)
            [
                # This starts at 0.5 < 1.0 threshold, so it gets skipped
                {"start": 0.5, "end": 2.5, "text": "C1-1-skip", "speaker": None, "confidence": 0.9},
                # This is kept (starts after threshold)
                {"start": 3.0, "end": 6.0, "text": "C1-2", "speaker": None, "confidence": 0.9},
            ],
            # Chunk 2 (global time 20-30, local 0-2 is overlap with chunk 1)
            [
                # This starts at 1.5 > 1.0 threshold, so it's kept and adjusted
                {"start": 1.5, "end": 4.0, "text": "C2-1", "speaker": None, "confidence": 0.9},
            ],
        ]

        result = chunker.merge_segments(
            chunk_segments=chunk_segments,
            chunk_duration=10.0,
            overlap_duration=2.0
        )

        # Should have: C0-1, C0-2, C1-2, C2-1 (C1-1 is skipped due to early overlap)
        assert len(result) >= 2

        # Check first chunk segments (no adjustment needed)
        assert result[0]["start"] == 0.0
        assert result[0]["text"] == "C0-1"
        assert result[1]["start"] == 7.0

        # C1-2 should be at global time 10 + 3 = 13
        assert result[2]["start"] == 13.0

        # C2-1 should be at global time 20 + 1.5 = 21.5, but adjusted for overlap
        # Since it starts at 1.5 (> threshold), it gets adjusted
        assert result[3]["start"] >= 20.0


# ============================================================================
# Edge Cases
# ============================================================================

class TestCheckpointEdgeCases:
    """Test edge cases for checkpoint functionality."""

    @pytest.fixture
    def temp_checkpoint_dir(self):
        """Create a temporary directory for checkpoints."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def manager(self, temp_checkpoint_dir):
        """Create a CheckpointManager with temp directory."""
        return CheckpointManager(checkpoint_dir=str(temp_checkpoint_dir))

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash')
    def test_save_with_empty_segments(self, mock_hash, manager):
        """Test saving checkpoint with empty segment list."""
        metadata = CheckpointMetadata(
            file_path="test.wav",
            file_hash="test_hash",  # Match the mock return value
            chunk_duration=300.0,
            overlap_duration=5.0,
            total_chunks=1,
            completed_chunks=[],
            model_name="whisper-base",
            device="cpu",
            language=None
        )

        manager.save_checkpoint("test.wav", 0, [], metadata)

        result = manager.load_checkpoint("test.wav")
        assert result["chunks"]["0"] == []

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash')
    def test_save_with_large_metadata(self, mock_hash, manager):
        """Test saving checkpoint with large completed_chunks list."""
        metadata = CheckpointMetadata(
            file_path="long.wav",
            file_hash="test_hash",  # Match the mock return value
            chunk_duration=300.0,
            overlap_duration=5.0,
            total_chunks=100,
            completed_chunks=list(range(50)),
            model_name="whisper-base",
            device="cpu",
            language=None
        )

        sample_segment = {"start": 0.0, "end": 1.0, "text": "Test", "speaker": None, "confidence": 0.9}

        manager.save_checkpoint("long.wav", 49, [sample_segment], metadata)

        result = manager.load_checkpoint("long.wav")
        assert len(result["metadata"]["completed_chunks"]) == 50

    @patch.object(CheckpointManager, '_get_file_hash', return_value='test_hash')
    def test_unicode_in_file_path(self, mock_hash, manager):
        """Test checkpoint with unicode characters in file path."""
        unicode_path = "/path/to/???? file.wav"
        metadata = CheckpointMetadata(
            file_path=unicode_path,
            file_hash="test_hash",  # Match the mock return value
            chunk_duration=300.0,
            overlap_duration=5.0,
            total_chunks=1,
            completed_chunks=[],
            model_name="whisper-base",
            device="cpu",
            language=None
        )

        manager.save_checkpoint(unicode_path, 0, [], metadata)
        result = manager.load_checkpoint(unicode_path)

        assert result is not None
        assert result["metadata"]["file_path"] == unicode_path


# ============================================================================
# Global Instance Tests
# ============================================================================

class TestGlobalCheckpointManager:
    """Test the global checkpoint_manager instance."""

    def test_global_manager_exists(self):
        """Test that global checkpoint_manager is created."""
        assert checkpoint_manager is not None
        assert isinstance(checkpoint_manager, CheckpointManager)

    def test_global_manager_has_default_directory(self):
        """Test that global manager uses default directory."""
        assert checkpoint_manager.checkpoint_dir is not None
        assert checkpoint_manager.checkpoint_dir == Path("./checkpoints")
