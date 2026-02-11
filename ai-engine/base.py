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

    def _init_diarizer(self, provider: str, device: str = "cpu"):
        """
        Initialize a diarization provider.

        Args:
            provider: Diarization provider ('sherpa', 'pyannote', 'none')
            device: Device to run on ('cpu' or 'cuda')
        """
        if provider == "none" or not provider:
            self._diarizer = None
            self._diarization_provider = "none"
            return

        # Import here to avoid circular dependency
        from diarization import get_diarizer

        try:
            self._diarizer = get_diarizer(provider, device=device)
            self._diarization_provider = provider
        except Exception as e:
            print(f"Warning: Failed to initialize {provider} diarizer: {e}")
            print("Continuing without diarization")
            self._diarizer = None
            self._diarization_provider = "none"

    def diarize(
        self,
        segments: list[dict],
        file_path: str,
    ) -> list[dict]:
        """
        Add speaker labels to transcription segments using the configured diarizer.

        Args:
            segments: List of transcription segments
            file_path: Path to the original media file

        Returns:
            Segments with speaker labels added (or unchanged if no diarizer)
        """
        if not self._diarizer:
            return segments

        try:
            return self._diarizer.diarize(segments, file_path)
        except Exception as e:
            print(f"Warning: Diarization failed: {e}")
            return segments

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

    def __init__(self, device: str = "cpu", diarization_provider: str = "none"):
        """
        Initialize the model.

        Args:
            device: Device to run inference on ('cpu' or 'cuda')
            diarization_provider: Diarization provider ('sherpa', 'pyannote', 'none')
        """
        super().__init__()
        self.device = device
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
