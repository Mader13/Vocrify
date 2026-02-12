"""
Base class for speaker diarization providers.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple


@dataclass
class SpeakerTurn:
    """A speaker turn with start/end times."""

    speaker: str
    start: float
    end: float


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
    ) -> Tuple[List[Dict], List[SpeakerTurn]]:
        """
        Add speaker labels to transcription segments.

        Args:
            segments: List of transcription segments with 'start', 'end', 'text' keys
            file_path: Path to the original media file

        Returns:
            Tuple of (segments with 'speaker' field populated, list of speaker turns)
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the diarizer name."""
        pass

    def _segments_to_turns(self, segments: List[Dict]) -> List[SpeakerTurn]:
        """
        Convert segments with speaker labels to speaker turns.
        Helper for diarizers that need to reconstruct turns from segments.

        Args:
            segments: Segments with 'speaker' field

        Returns:
            List of speaker turns
        """
        if not segments:
            return []

        turns = []
        i = 0
        while i < len(segments):
            speaker = segments[i].get("speaker")
            if not speaker:
                i += 1
                continue

            start = segments[i]["start"]
            end = segments[i]["end"]

            # Merge consecutive same-speaker segments
            j = i + 1
            while j < len(segments) and segments[j].get("speaker") == speaker:
                end = segments[j]["end"]
                j += 1

            turns.append(SpeakerTurn(speaker=speaker, start=start, end=end))
            i = j

        return turns
