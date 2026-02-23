"""
Base model interface for transcription engines.

All transcription models should inherit from BaseModel and implement
the required methods.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from diarization.base import BaseDiarizer


@dataclass
class TranscriptionSegment:
    """A single transcription segment."""

    start: float
    end: float
    text: str
    speaker: Optional[str] = None
    confidence: float = 1.0

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "text": self.text.strip(),
            "speaker": self.speaker,
            "confidence": round(self.confidence, 3),
        }


class DiarizationMixin:
    """
    Mixin class to add diarization capabilities to transcription models.

    Reduces code duplication by providing common diarization logic.
    Models inherit this alongside BaseModel.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._diarizer: Optional["BaseDiarizer"] = None
        self._diarization_provider: str = "none"
        self.download_root: Optional[str] = None

    def _init_diarizer(self, provider: str, device: str = "cpu"):
        """
        Initialize a diarization provider.

        Args:
            provider: Diarization provider ('sherpa', 'sherpa-onnx', or 'none')
            device: Device to run on ('cpu' or 'cuda')
        """
        if provider == "none" or not provider:
            self._diarizer = None
            self._diarization_provider = "none"
            return

        # Import here to avoid circular dependency
        from diarization import get_diarizer

        try:
            print(f"[INFO] Initializing diarization provider: {provider}")
            # Pass download_root to diarizer if available
            diarizer_kwargs = {"device": device}
            if self.download_root:
                diarizer_kwargs["download_root"] = self.download_root
            self._diarizer = get_diarizer(provider, **diarizer_kwargs)
            self._diarization_provider = provider
            print(f"[INFO] Diarization provider '{provider}' initialized successfully")
        except Exception as e:
            print(f"[ERROR] Failed to initialize {provider} diarizer: {e}")
            print("[WARN] Continuing without diarization")
            self._diarizer = None
            self._diarization_provider = "none"

    def diarize(
        self,
        segments: list[dict],
        file_path: str,
    ) -> tuple[list[dict], list]:
        """
        Add speaker labels to transcription segments using the configured diarizer.

        Args:
            segments: List of transcription segments
            file_path: Path to the original media file

        Returns:
            Tuple of (segments with speaker labels, list of speaker turns)
        """
        if not self._diarizer:
            print(
                f"[WARN] Diarization skipped: no diarizer initialized (provider={self._diarization_provider})"
            )
            return segments, []

        try:
            print(
                f"[INFO] Running diarization with {self._diarization_provider} on {len(segments)} segments..."
            )
            result = self._diarizer.diarize(segments, file_path)
            print(f"[INFO] Diarization complete: {len(result[1])} speaker turns found")
            return result
        except Exception as e:
            print(f"[ERROR] Diarization failed: {e}")
            import traceback

            traceback.print_exc()
            return segments, []

    @property
    def supports_diarization(self) -> bool:
        """Whether this model has diarization enabled."""
        return self._diarizer is not None


class BaseModel(ABC, DiarizationMixin):
    """
    Abstract base class for transcription models.

    All models must implement transcribe().
    Diarization support is provided via DiarizationMixin.
    """

    def __init__(self, device: str = "cpu", diarization_provider: str = "none", download_root: Optional[str] = None):
        """
        Initialize the model.

        Args:
            device: Device to run inference on ('cpu' or 'cuda')
            diarization_provider: Diarization provider ('sherpa', 'sherpa-onnx', or 'none')
            download_root: Directory for model downloads (for diarization models)
        """
        super().__init__()
        self.device = device
        self.download_root = download_root
        self._init_diarizer(diarization_provider, device)

    @abstractmethod
    def transcribe(
        self,
        file_path: str,
        language: Optional[str] = None,
    ) -> list[dict]:
        """
        Transcribe an audio/video file.

        Args:
            file_path: Path to the media file
            language: Language code (e.g., 'en', 'ru') or None for auto-detection

        Returns:
            List of segment dictionaries with keys:
                - start: float (seconds)
                - end: float (seconds)
                - text: str
                - speaker: str or None
                - confidence: float (0-1)
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the model name."""
        pass
