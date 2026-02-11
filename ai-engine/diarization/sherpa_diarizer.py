"""
Sherpa-ONNX speaker diarization provider.

Uses offline ONNX models for fast CPU/CUDA speaker segmentation and embedding.
"""

import os
import tempfile
from pathlib import Path
from typing import List, Dict, Optional

from pydub import AudioSegment

from .base import BaseDiarizer
from model_registry import ModelRegistry


class SherpaDiarizer(BaseDiarizer):
    """
    Sherpa-ONNX based speaker diarization.

    Uses offline ONNX models:
    - Segmentation: PyAnnote segmentation-3.0 (ONNX, ~1.5MB)
    - Embedding: 3D-Speaker ResNet34 (ONNX, ~26MB)
    """

    def __init__(
        self,
        device: str = "cpu",
        download_root: Optional[str] = None,
        num_clusters: int = -1,
        threshold: float = 0.5,
    ):
        """
        Initialize Sherpa-ONNX diarizer.

        Args:
            device: Device ('cpu' or 'cuda')
            download_root: Model cache directory
            num_clusters: Number of speakers (-1 for auto-detection)
            threshold: Clustering threshold
        """
        super().__init__(device=device)

        self.download_root = download_root or "./models_cache"
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
            emb_dir = emb_path.parent
            emb_config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(emb_dir / "model.onnx"),
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
    ) -> List[Dict]:
        """
        Add speaker labels using Sherpa-ONNX.

        Args:
            segments: Transcription segments
            file_path: Path to audio file

        Returns:
            Segments with speaker labels
        """
        if not segments:
            return segments

        temp_wav = None
        try:
            # Convert to WAV for Sherpa-ONNX
            temp_wav = self._convert_to_wav(file_path)

            # Run diarization
            result = self.diarizer_impl.process(temp_wav)

            if not result or not result.segments:
                print("Warning: Sherpa-ONNX returned no speaker segments")
                return segments

            # Map speakers to segments
            for seg in segments:
                start = seg["start"]
                end = seg["end"]

                # Find overlapping speaker segment
                speaker = self._find_speaker_at_time(result.segments, start, end)
                seg["speaker"] = speaker if speaker else None

            return segments

        except Exception as e:
            print(f"Sherpa-ONNX diarization error: {e}")
            return segments
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
            speaker_segments: List of speaker segments from Sherpa
            start: Start time
            end: End time

        Returns:
            Speaker label or None
        """
        max_overlap = 0
        best_speaker = None

        for spk_seg in speaker_segments:
            seg_start = spk_seg.start / 1000.0  # Convert ms to seconds
            seg_end = spk_seg.end / 1000.0

            # Calculate overlap
            overlap_start = max(start, seg_start)
            overlap_end = min(end, seg_end)
            overlap = max(0, overlap_end - overlap_start)

            if overlap > max_overlap:
                max_overlap = overlap
                best_speaker = f"SPEAKER_{spk_seg.speaker:02d}"

        return best_speaker

    def _convert_to_wav(self, file_path: str) -> str:
        """Convert audio to 16kHz mono WAV."""
        temp_fd, temp_path = tempfile.mkstemp(suffix=".wav")
        os.close(temp_fd)

        try:
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
