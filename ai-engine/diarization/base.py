"""
Base class for speaker diarization providers.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Optional


class BaseDiarizer(ABC):
    """
    Abstract base class for speaker diarization.

    All diarization providers must implement the diarize() method.
    """

    def __init__(self, device: str = "cpu"):
        """
        Initialize diarizer.

        Args:
            device: Device to run on ('cpu' or 'cuda')
        """
        self.device = device

    @abstractmethod
    def diarize(
        self,
        segments: List[Dict],
        file_path: str,
    ) -> List[Dict]:
        """
        Add speaker labels to transcription segments.

        Args:
            segments: List of transcription segments with 'start', 'end', 'text' keys
            file_path: Path to the original media file

        Returns:
            Segments with 'speaker' field populated
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the diarizer name."""
        pass
