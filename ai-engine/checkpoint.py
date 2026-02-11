"""
Checkpoint/Resume functionality for long audio transcription.

Allows transcription to be resumed from checkpoints for very long audio files.
If transcription is interrupted, it can be resumed from the last completed chunk.

Features:
- Audio chunking with overlap for context preservation
- Checkpoint save/load functionality
- Segment merging for combining chunks
- Progress tracking across chunks
"""

import json
import os
import hashlib
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict


@dataclass
class CheckpointMetadata:
    """Metadata for a transcription checkpoint."""
    file_path: str
    file_hash: str  # MD5 of file path for change detection
    chunk_duration: float
    overlap_duration: float
    total_chunks: int
    completed_chunks: List[int]
    model_name: str
    device: str
    language: Optional[str]

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'CheckpointMetadata':
        return cls(**data)


class CheckpointManager:
    """
    Manages transcription checkpoints for long audio files.

    Saves progress after each chunk, allowing resume if interrupted.
    """

    def __init__(self, checkpoint_dir: str = "./checkpoints"):
        """
        Initialize checkpoint manager.

        Args:
            checkpoint_dir: Directory to store checkpoint files
        """
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

    def _get_checkpoint_path(self, file_path: str) -> Path:
        """Get the checkpoint file path for a given audio file."""
        # Create a safe filename from the audio file path
        file_hash = hashlib.md5(file_path.encode()).hexdigest()[:8]
        return self.checkpoint_dir / f"checkpoint_{file_hash}.json"

    def _get_file_hash(self, file_path: str) -> str:
        """Get a hash of the file for change detection."""
        # Use file path + size + mtime as hash
        stat = os.stat(file_path)
        hash_input = f"{file_path}_{stat.st_size}_{stat.st_mtime}"
        return hashlib.md5(hash_input.encode()).hexdigest()

    def save_checkpoint(
        self,
        file_path: str,
        chunk_index: int,
        segments: List[dict],
        metadata: CheckpointMetadata
    ) -> None:
        """
        Save a completed chunk checkpoint.

        Args:
            file_path: Original audio file path
            chunk_index: Index of the completed chunk
            segments: Transcription segments for this chunk
            metadata: Checkpoint metadata
        """
        checkpoint_path = self._get_checkpoint_path(file_path)

        # Update completed chunks
        if chunk_index not in metadata.completed_chunks:
            metadata.completed_chunks.append(chunk_index)

        # Load existing checkpoint data
        checkpoint_data = {
            "metadata": metadata.to_dict(),
            "chunks": {}
        }

        if checkpoint_path.exists():
            with open(checkpoint_path, 'r') as f:
                checkpoint_data = json.load(f)

        # Save this chunk's segments
        checkpoint_data["chunks"][str(chunk_index)] = segments
        checkpoint_data["metadata"] = metadata.to_dict()

        # Write atomically
        temp_path = checkpoint_path.with_suffix('.tmp')
        with open(temp_path, 'w') as f:
            json.dump(checkpoint_data, f, indent=2)

        temp_path.replace(checkpoint_path)

    def load_checkpoint(self, file_path: str) -> Optional[Dict[str, Any]]:
        """
        Load checkpoint data for a file if it exists.

        Args:
            file_path: Original audio file path

        Returns:
            Checkpoint data dict with 'metadata' and 'chunks' keys, or None
        """
        checkpoint_path = self._get_checkpoint_path(file_path)

        if not checkpoint_path.exists():
            return None

        with open(checkpoint_path, 'r') as f:
            data = json.load(f)

        # Verify file hasn't changed
        current_hash = self._get_file_hash(file_path)
        if data["metadata"]["file_hash"] != current_hash:
            print(json.dumps({
                "type": "warning",
                "message": "File has changed since last checkpoint, starting fresh"
            }), flush=True)
            return None

        return data

    def delete_checkpoint(self, file_path: str) -> None:
        """Delete checkpoint for a file."""
        checkpoint_path = self._get_checkpoint_path(file_path)
        if checkpoint_path.exists():
            checkpoint_path.unlink()

    def get_completed_chunks(self, file_path: str) -> List[int]:
        """Get list of completed chunk indices for a file."""
        data = self.load_checkpoint(file_path)
        if data:
            return data["metadata"]["completed_chunks"]
        return []

    def get_chunk_segments(self, file_path: str, chunk_index: int) -> Optional[List[dict]]:
        """Get segments for a specific chunk."""
        data = self.load_checkpoint(file_path)
        if data and str(chunk_index) in data["chunks"]:
            return data["chunks"][str(chunk_index)]
        return None


class AudioChunker:
    """
    Splits audio files into chunks for processing with overlap.

    Overlap ensures context is preserved at chunk boundaries.
    """

    def __init__(
        self,
        chunk_duration: float = 300.0,  # 5 minutes
        overlap_duration: float = 5.0,   # 5 seconds overlap
    ):
        """
        Initialize audio chunker.

        Args:
            chunk_duration: Duration of each chunk in seconds
            overlap_duration: Overlap between chunks in seconds
        """
        self.chunk_duration = chunk_duration
        self.overlap_duration = overlap_duration

    def get_chunk_count(self, file_path: str) -> int:
        """
        Get the number of chunks for a file.

        Args:
            file_path: Path to audio file

        Returns:
            Number of chunks
        """
        duration = self._get_audio_duration(file_path)
        effective_chunk = self.chunk_duration - self.overlap_duration
        return int((duration + self.chunk_duration - 1) / self.chunk_duration)

    def _get_audio_duration(self, file_path: str) -> float:
        """Get audio duration in seconds using ffprobe."""
        try:
            result = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries',
                 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
                 file_path],
                capture_output=True,
                text=True,
                timeout=10
            )
            return float(result.stdout.strip())
        except Exception:
            # Fallback: estimate from file size (rough estimate)
            return 0.0

    def split_audio(
        self,
        file_path: str,
        chunk_index: int,
        output_dir: str
    ) -> Optional[str]:
        """
        Split audio and extract a specific chunk.

        Args:
            file_path: Path to original audio file
            chunk_index: Index of the chunk to extract
            output_dir: Directory to save chunk

        Returns:
            Path to the extracted chunk file, or None if index is out of range
        """
        os.makedirs(output_dir, exist_ok=True)

        start_time = chunk_index * self.chunk_duration
        duration = self.chunk_duration + self.overlap_duration

        # Add overlap to last chunk
        if chunk_index == self.get_chunk_count(file_path) - 1:
            duration = self.chunk_duration + self.overlap_duration

        output_path = os.path.join(
            output_dir,
            f"chunk_{chunk_index:04d}_{Path(file_path).stem}.wav"
        )

        try:
            subprocess.run([
                'ffmpeg',
                '-i', file_path,
                '-ss', str(start_time),
                '-t', str(duration),
                '-acodec', 'pcm_s16le',  # WAV format
                '-ar', '16000',  # 16kHz (Whisper sample rate)
                '-ac', '1',      # Mono
                '-y',
                output_path
            ], check=True, capture_output=True, timeout=60)
            return output_path
        except subprocess.CalledProcessError:
            return None

    def merge_segments(
        self,
        chunk_segments: List[List[dict]],
        chunk_duration: float,
        overlap_duration: float
    ) -> List[dict]:
        """
        Merge segments from multiple chunks, removing duplicates from overlap regions.

        Args:
            chunk_segments: List of segment lists, one per chunk
            chunk_duration: Duration of each chunk
            overlap_duration: Overlap between chunks

        Returns:
            Merged list of segments
        """
        merged = []
        overlap_threshold = overlap_duration / 2  # Midpoint of overlap

        for i, segments in enumerate(chunk_segments):
            chunk_start = i * chunk_duration

            for segment in segments:
                seg_start = segment["start"]
                seg_end = segment["end"]

                # Adjust segment times to global timeline
                global_start = seg_start + chunk_start
                global_end = seg_end + chunk_start

                # Check if segment is in overlap region
                if i > 0 and seg_start < overlap_duration:
                    # In overlap at chunk start
                    if seg_start < overlap_threshold:
                        # Too close to previous chunk boundary, skip
                        continue
                    else:
                        # Adjust start to remove overlap
                        global_start = chunk_start + overlap_threshold

                # Check if segment extends beyond current chunk
                chunk_end = chunk_start + chunk_duration + overlap_duration
                if global_end > chunk_end and i < len(chunk_segments) - 1:
                    # In overlap at chunk end, will be handled by next chunk
                    continue

                segment["start"] = global_start
                segment["end"] = global_end
                merged.append(segment)

        # Sort by start time
        merged.sort(key=lambda s: s["start"])

        return merged


# Global checkpoint manager instance
checkpoint_manager = CheckpointManager()
