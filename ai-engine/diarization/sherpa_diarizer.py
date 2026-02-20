"""
Sherpa-ONNX speaker diarization provider.

Uses offline ONNX models for fast CPU/CUDA speaker segmentation and embedding.
"""

import os
import tempfile
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import numpy as np

from .base import BaseDiarizer, SpeakerTurn
from model_registry import ModelRegistry


class SherpaDiarizer(BaseDiarizer):
    """
    Sherpa-ONNX based speaker diarization.

    Uses offline ONNX models:
    - Segmentation: PyAnnote segmentation-3.0 (ONNX, ~1.5MB)
    - Embedding: 3D-Speaker ResNet34 (ONNX, ~26MB)

    Note: Default threshold is 0.8 (not 0.5) for better speaker separation.
    Higher threshold = fewer clusters (more conservative).
    Lower threshold = more clusters (more aggressive).
    """

    def __init__(
        self,
        device: str = "cpu",
        download_root: Optional[str] = None,
        num_clusters: int = -1,
        threshold: float = 0.8,  # Increased from 0.5 to 0.8 for better clustering
        num_speakers: Optional[int] = None,
    ):
        """
        Initialize Sherpa-ONNX diarizer.

        Args:
            device: Device ('cpu' or 'cuda')
            download_root: Model cache directory
            num_clusters: Number of speakers (-1 for auto-detection)
            threshold: Clustering threshold (default 0.8 for better speaker separation)
            num_speakers: Number of speakers (alias for num_clusters)
        """
        super().__init__(device=device)

        self.download_root = download_root or "./models_cache"
        # Support both num_clusters and num_speakers parameters
        if num_speakers is not None:
            self.num_clusters = num_speakers
        else:
            self.num_clusters = num_clusters
        self.threshold = threshold

        # Initialize model registry
        self.registry = ModelRegistry(cache_dir=self.download_root)

        # Load models
        self._load_models()

    def _load_models(self):
        """Load Sherpa-ONNX diarization models."""
        try:
            import sherpa_onnx

            # Get model paths from registry
            model_paths = self.registry.get_sherpa_diarization_paths()

            seg_path = model_paths.get("segmentation")
            emb_path = model_paths.get("embedding")

            if not seg_path or not emb_path:
                raise RuntimeError(
                    "Sherpa-ONNX models not found. "
                    "Run downloader to fetch segmentation and embedding models."
                )

            # Determine ONNX provider
            if self.device == "cuda":
                provider = "cuda"
            else:
                provider = "cpu"

            # Create segmentation config
            seg_config = sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                    model=str(seg_path)
                )
            )

            # Create embedding config
            # emb_path is the direct path to the .onnx file (not in a subdirectory)
            emb_config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(emb_path),
                provider=provider,
            )

            # Create diarization config
            diarization_config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
                segmentation=seg_config,
                embedding=emb_config,
                clustering=sherpa_onnx.FastClusteringConfig(
                    num_clusters=self.num_clusters,
                    threshold=self.threshold,
                ),
            )

            # Create diarization instance
            self.diarizer_impl = sherpa_onnx.OfflineSpeakerDiarization(
                diarization_config
            )

        except ImportError:
            raise RuntimeError(
                "sherpa-onnx not installed. Install with: pip install sherpa-onnx"
            )
        except Exception as e:
            raise RuntimeError(f"Failed to load Sherpa-ONNX models: {e}") from e

    def diarize(
        self,
        segments: List[Dict],
        file_path: str,
    ) -> Tuple[List[Dict], List[SpeakerTurn]]:
        """
        Add speaker labels using Sherpa-ONNX.

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
            import soundfile as sf
            
            temp_wav_info = convert_to_wav(file_path)
            temp_wav = temp_wav_info.get('_output_path', temp_wav)
            
            # If rust_audio_bridge returned a path, use it
            # Otherwise, it may have created the file in-place
            if not os.path.exists(temp_wav):
                # Fallback: create temp WAV manually
                temp_wav = self._convert_to_wav(file_path)

            # Load audio samples using soundfile (sherpa-onnx expects float samples)
            samples, sr = sf.read(temp_wav, dtype=np.float32)

            # Run diarization with samples
            result = self.diarizer_impl.process(samples)

            # Sherpa-ONNX: result must be sorted before iteration
            sorted_result = result.sort_by_start_time()

            # Convert to list for easier access
            speaker_segments = list(sorted_result)

            if not speaker_segments:
                print("Warning: Sherpa-ONNX returned no speaker segments")
                return segments, []

            # Build speaker turns from Sherpa segments
            speaker_turns = []
            for spk_seg in speaker_segments:
                turn = SpeakerTurn(
                    speaker=f"SPEAKER_{spk_seg.speaker:02d}",
                    start=spk_seg.start,  # Sherpa-ONNX returns seconds
                    end=spk_seg.end,
                )
                speaker_turns.append(turn)

            # Map speakers to transcription segments
            for seg in segments:
                start = seg["start"]
                end = seg["end"]

                # Find overlapping speaker segment
                speaker = self._find_speaker_at_time(speaker_segments, start, end)
                seg["speaker"] = speaker if speaker else None

            return segments, speaker_turns

        except Exception as e:
            print(f"Sherpa-ONNX diarization error: {e}")
            return segments, []
        finally:
            if temp_wav and os.path.exists(temp_wav):
                try:
                    os.unlink(temp_wav)
                except:
                    pass

    def _find_speaker_at_time(self, speaker_segments, start, end):
        """
        Find the speaker with maximum overlap in the time range.

        Args:
            speaker_segments: List of speaker segments from Sherpa (timestamps in seconds)
            start: Start time in seconds
            end: End time in seconds

        Returns:
            Speaker label or None
        """
        max_overlap = 0
        best_speaker = None

        for spk_seg in speaker_segments:
            seg_start = spk_seg.start  # Sherpa-ONNX returns seconds
            seg_end = spk_seg.end

            # Calculate overlap
            overlap_start = max(start, seg_start)
            overlap_end = min(end, seg_end)
            overlap = max(0, overlap_end - overlap_start)

            if overlap > max_overlap:
                max_overlap = overlap
                best_speaker = f"SPEAKER_{spk_seg.speaker:02d}"

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
        return "sherpa-onnx"
