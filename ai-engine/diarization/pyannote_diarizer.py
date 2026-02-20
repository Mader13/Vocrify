"""
PyAnnote.audio speaker diarization provider.

Uses pretrained PyAnnote models with offline mode support.
"""

import os
import tempfile
from pathlib import Path
from typing import List, Dict, Optional, Tuple

from .base import BaseDiarizer, SpeakerTurn
from model_registry import ModelRegistry


class PyAnnoteDiarizer(BaseDiarizer):
    """
    PyAnnote.audio based speaker diarization.

    Uses pretrained neural models for state-of-the-art speaker diarization.
    Supports offline mode with HF_HUB_OFFLINE=1.
    """

    def __init__(
        self,
        device: str = "cpu",
        download_root: Optional[str] = None,
        num_speakers: Optional[int] = None,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
    ):
        """
        Initialize PyAnnote diarizer.

        Args:
            device: Device ('cpu' or 'cuda')
            download_root: Model cache directory
            num_speakers: Exact number of speakers (optional)
            min_speakers: Minimum number of speakers (optional)
            max_speakers: Maximum number of speakers (optional)
        """
        super().__init__(device=device)

        self.download_root = download_root or "./models_cache"
        self.num_speakers = num_speakers
        self.min_speakers = min_speakers
        self.max_speakers = max_speakers

        # Initialize model registry
        self.registry = ModelRegistry(cache_dir=self.download_root)

        # Load pipeline
        self._load_pipeline()

    def _load_pipeline(self):
        """Load PyAnnote pipeline with offline mode support."""
        try:
            from pyannote.audio import Pipeline

            # Get model paths from registry
            model_paths = self.registry.get_pyannote_diarization_paths()

            # get_pyannote_diarization_paths() returns dict with model_type -> (path, repo_id)
            # Extract the speaker-diarization path tuple
            path_tuple = model_paths.get("speaker-diarization", (None, None))
            pipeline_path, pipeline_repo_id = path_tuple

            # Check if models are cached locally
            if pipeline_path:
                # Enable offline mode for PyAnnote
                print(f"Loading PyAnnote pipeline from cache: {pipeline_path}")
                os.environ["HF_HUB_OFFLINE"] = "1"
                os.environ["TRANSFORMERS_OFFLINE"] = "1"

                # Load from local cache
                self.pipeline = Pipeline.from_pretrained(
                    str(pipeline_path),
                    cache_dir=str(self.registry.hf_cache),
                )
            else:
                # Download on first use (requires HuggingFace token for private models)
                print(
                    f"PyAnnote pipeline not cached, will download from {pipeline_repo_id}"
                )
                print(
                    "Note: You may need to accept PyAnnote model conditions on HuggingFace"
                )

                # Ensure offline mode is disabled for download
                os.environ.pop("HF_HUB_OFFLINE", None)
                os.environ.pop("TRANSFORMERS_OFFLINE", None)

                self.pipeline = Pipeline.from_pretrained(
                    pipeline_repo_id,
                    cache_dir=str(self.registry.hf_cache),
                )

            # Move to device
            if self.device == "cuda":
                self.pipeline.to(device="cuda")

        except ImportError:
            raise RuntimeError(
                "pyannote.audio not installed. Install with: pip install pyannote.audio"
            )
        except Exception as e:
            raise RuntimeError(f"Failed to load PyAnnote pipeline: {e}") from e

    def diarize(
        self,
        segments: List[Dict],
        file_path: str,
    ) -> Tuple[List[Dict], List[SpeakerTurn]]:
        """
        Add speaker labels using PyAnnote.

        Args:
            segments: Transcription segments
            file_path: Path to audio file

        Returns:
            Tuple of (segments with speaker labels, list of speaker turns)
        """
        if not segments:
            return segments, []

        temp_wav = None
        try:
            # Convert to WAV using Rust audio module (with Python fallback)
            from utils.rust_audio_bridge import convert_to_wav
            
            temp_wav_info = convert_to_wav(file_path)
            temp_wav = temp_wav_info.get('_output_path', temp_wav)
            
            # If rust_audio_bridge returned a path, use it
            # Otherwise, it may have created the file in-place
            if not os.path.exists(temp_wav):
                # Fallback: create temp WAV manually
                temp_wav = self._convert_to_wav(file_path)

            # Prepare diarization parameters
            diarization_params = {}
            if self.num_speakers is not None:
                diarization_params["num_speakers"] = self.num_speakers
            elif self.min_speakers is not None or self.max_speakers is not None:
                if self.min_speakers:
                    diarization_params["min_speakers"] = self.min_speakers
                if self.max_speakers:
                    diarization_params["max_speakers"] = self.max_speakers

            # Run diarization
            diarization = self.pipeline(temp_wav, **diarization_params)

            if not diarization:
                print("Warning: PyAnnote returned no speaker segments")
                return segments, []

            # Build speaker turns from PyAnnote diarization
            speaker_turns = []
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                speaker_turn = SpeakerTurn(
                    speaker=speaker, start=turn.start, end=turn.end
                )
                speaker_turns.append(speaker_turn)

            # Map speakers to transcription segments
            for seg in segments:
                start = seg["start"]
                end = seg["end"]

                # Find overlapping speaker segment
                speaker = self._find_speaker_at_time(diarization, start, end)
                seg["speaker"] = speaker if speaker else None

            return segments, speaker_turns

        except Exception as e:
            print(f"PyAnnote diarization error: {e}")
            return segments, []
        finally:
            if temp_wav and os.path.exists(temp_wav):
                try:
                    os.unlink(temp_wav)
                except:
                    pass

    def _find_speaker_at_time(self, diarization, start, end):
        """
        Find the speaker with maximum overlap in the time range.

        Args:
            diarization: PyAnnote diarization result
            start: Start time in seconds
            end: End time in seconds

        Returns:
            Speaker label or None
        """
        max_overlap = 0
        best_speaker = None

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            seg_start = turn.start
            seg_end = turn.end

            # Calculate overlap
            overlap_start = max(start, seg_start)
            overlap_end = min(end, seg_end)
            overlap = max(0, overlap_end - overlap_start)

            if overlap > max_overlap:
                max_overlap = overlap
                best_speaker = speaker

        return best_speaker

    def _convert_to_wav(self, file_path: str) -> str:
        """Convert audio to 16kHz mono WAV using pydub (fallback)."""
        temp_fd, temp_path = tempfile.mkstemp(suffix=".wav")
        os.close(temp_fd)

        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_file(file_path)
            audio = audio.set_frame_rate(16000).set_channels(1)
            audio.export(temp_path, format="wav")
            return temp_path
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise RuntimeError(f"Failed to convert audio: {e}") from e

    @property
    def name(self) -> str:
        """Return diarizer name."""
        return "pyannote"
