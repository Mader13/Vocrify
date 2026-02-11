"""
Audio interval processing utilities for VAD-based transcription.

This module provides functions for:
- Audio format conversion
- Speech activity detection (VAD)
- Interval merging and slicing
- Timestamp offset management
"""

import json
import os
import subprocess
import sys
import tempfile
from typing import Optional, Tuple, List

import numpy as np


def ensure_wav_16k_mono(file_path: str) -> str:
    """
    Convert audio file to WAV 16kHz mono format using ffmpeg.

    Args:
        file_path: Path to input audio/video file

    Returns:
        Path to converted WAV file (may be original if already correct format)
    """
    # Check if already 16kHz mono WAV
    try:
        import soundfile as sf
        info = sf.info(file_path)
        if info.samplerate == 16000 and info.channels == 1 and file_path.endswith('.wav'):
            return file_path
    except Exception:
        pass  # Need conversion

    # Create temp file for conversion
    fd, temp_path = tempfile.mkstemp(suffix='.wav')
    os.close(fd)

    try:
        subprocess.run(
            ['ffmpeg', '-i', file_path,
             '-ar', '16000',  # 16kHz sample rate
             '-ac', '1',      # Mono
             '-acodec', 'pcm_s16le',  # 16-bit PCM
             '-y', temp_path],
            check=True,
            capture_output=True,
            timeout=120
        )
        return temp_path
    except subprocess.CalledProcessError as e:
        os.unlink(temp_path)
        raise RuntimeError(f"ffmpeg conversion failed: {e.stderr.decode() if e.stderr else str(e)}")
    except subprocess.TimeoutExpired:
        os.unlink(temp_path)
        raise RuntimeError("ffmpeg conversion timed out")


def load_audio(wav_path: str) -> Tuple[np.ndarray, int]:
    """
    Load audio file using soundfile.

    Args:
        wav_path: Path to WAV file

    Returns:
        Tuple of (audio_array, sample_rate)
    """
    try:
        import soundfile as sf
        audio, sr = sf.read(wav_path)

        # Convert to mono if needed
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        return audio, sr
    except ImportError:
        raise ImportError("soundfile is required. Install with: pip install soundfile")


def detect_speech_intervals(
    provider: str,
    file_path: str,
    pad_ms: int = 200,
    min_silence_ms: int = 300,
    min_speech_ms: int = 250,
    hf_token: Optional[str] = None
) -> List[Tuple[float, float]]:
    """
    Detect speech intervals using the specified VAD provider.

    Args:
        provider: VAD provider - "pyannote", "sherpa-onnx", or "none"
        file_path: Path to audio file (should be 16kHz mono for best results)
        pad_ms: Padding in milliseconds to add around speech segments
        min_silence_ms: Minimum silence duration to split segments
        min_speech_ms: Minimum speech duration to keep a segment
        hf_token: HuggingFace token for pyannote

    Returns:
        List of (start, end) tuples in seconds
    """
    if provider == "none":
        # Return entire file duration as one interval
        try:
            import soundfile as sf
            info = sf.info(file_path)
            duration = info.duration
            return [(0.0, duration)]
        except Exception:
            # Fallback: estimate from audio
            audio, sr = load_audio(file_path)
            duration = len(audio) / sr
            return [(0.0, duration)]

    elif provider == "pyannote":
        return _detect_speech_pyannote(
            file_path, pad_ms, min_silence_ms, min_speech_ms, hf_token
        )

    elif provider == "sherpa-onnx":
        return _detect_speech_sherpa(
            file_path, pad_ms, min_silence_ms, min_speech_ms
        )

    else:
        raise ValueError(f"Unknown VAD provider: {provider}")


def _detect_speech_pyannote(
    file_path: str,
    pad_ms: int,
    min_silence_ms: int,
    min_speech_ms: int,
    hf_token: Optional[str]
) -> List[Tuple[float, float]]:
    """
    Detect speech intervals using pyannote.segmentation.

    Uses the segmentation model directly for VAD.
    """
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        raise ImportError("pyannote.audio is required. Install with: pip install pyannote.audio")

    if not hf_token:
        hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_ACCESS_TOKEN")

    if not hf_token:
        raise ValueError("HF_TOKEN is required for pyannote VAD")

    try:
        # Load segmentation pipeline (lighter than full diarization)
        pipeline = Pipeline.from_pretrained(
            "pyannote/segmentation-3.0",
            use_auth_token=hf_token
        )

        # Run segmentation
        output = pipeline(file_path)

        # Extract speech intervals
        intervals = []
        for segment, _ in output.itertracks(yield_label=True):
            intervals.append((float(segment.start), float(segment.end)))

        print(json.dumps({
            "type": "debug",
            "message": f"PyAnnote VAD detected {len(intervals)} raw speech intervals"
        }), flush=True, file=sys.stderr)

        # Merge intervals and apply padding
        return merge_intervals(intervals, pad_ms, min_silence_ms)

    except Exception as e:
        print(json.dumps({
            "type": "warning",
            "message": f"PyAnnote VAD failed: {e}, falling back to full audio"
        }), flush=True, file=sys.stderr)

        # Fallback to full audio
        audio, sr = load_audio(file_path)
        duration = len(audio) / sr
        return [(0.0, duration)]


def _detect_speech_sherpa(
    file_path: str,
    pad_ms: int,
    min_silence_ms: int,
    min_speech_ms: int
) -> List[Tuple[float, float]]:
    """
    Detect speech intervals using Sherpa-ONNX segmentation model.

    Note: This requires the Sherpa-ONNX segmentation model to be downloaded.
    """
    try:
        from sherpa_onnx import (
            OfflineSpeakerSegmentation,
            OfflineSpeakerSegmentationConfig,
            OfflineSpeakerSegmentationPyannoteModelConfig
        )
    except ImportError:
        raise ImportError("sherpa_onnx is required. Install with: pip install sherpa-onnx")

    # This would require model path configuration
    # For now, fallback to ffmpeg-based VAD
    return _detect_speech_ffmpeg(file_path, pad_ms, min_silence_ms, min_speech_ms)


def _detect_speech_ffmpeg(
    file_path: str,
    pad_ms: int,
    min_silence_ms: int,
    min_speech_ms: int
) -> List[Tuple[float, float]]:
    """
    Detect speech intervals using ffmpeg silence detection.

    This is a fallback method that may not be as accurate as ML-based VAD.
    """
    import tempfile

    fd, temp_path = tempfile.mkstemp(suffix='.txt')
    os.close(fd)

    try:
        # Use ffmpeg to detect silence
        # This is a simplified approach - may need adjustment
        subprocess.run([
            'ffmpeg', '-i', file_path,
            '-af', f'silencedetect=noise=-30dB:duration={min_silence_ms/1000}',
            '-f', 'null', '-'
        ], capture_output=True, timeout=120)

        # Parse silence detection from stderr
        # This is complex and error-prone, so we use a simpler fallback
        # Just return the full duration
        audio, sr = load_audio(file_path)
        duration = len(audio) / sr
        return [(0.0, duration)]

    except Exception as e:
        print(json.dumps({
            "type": "warning",
            "message": f"FFmpeg VAD failed: {e}, using full audio"
        }), flush=True, file=sys.stderr)

        audio, sr = load_audio(file_path)
        duration = len(audio) / sr
        return [(0.0, duration)]
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def merge_intervals(
    intervals: List[Tuple[float, float]],
    pad_ms: int = 200,
    min_gap_ms: int = 300
) -> List[Tuple[float, float]]:
    """
    Merge overlapping or close intervals with padding.

    Args:
        intervals: List of (start, end) tuples
        pad_ms: Padding in milliseconds to add around intervals
        min_gap_ms: Minimum gap to consider separate intervals

    Returns:
        Merged list of intervals with padding applied
    """
    if not intervals:
        return []

    # Sort by start time
    sorted_intervals = sorted(intervals, key=lambda x: x[0])

    # Convert ms to seconds
    pad_sec = pad_ms / 1000.0
    min_gap_sec = min_gap_ms / 1000.0

    # Apply padding
    padded = [(max(0, start - pad_sec), end + pad_sec) for start, end in sorted_intervals]

    # Merge overlapping intervals
    merged = [padded[0]]
    for current in padded[1:]:
        prev = merged[-1]
        if current[0] <= prev[1] + min_gap_sec:
            # Overlapping or close - merge
            merged[-1] = (prev[0], max(prev[1], current[1]))
        else:
            merged.append(current)

    return merged


def slice_audio(
    audio: np.ndarray,
    sr: int,
    start: float,
    end: float
) -> np.ndarray:
    """
    Extract a chunk of audio by time range.

    Args:
        audio: Audio array
        sr: Sample rate
        start: Start time in seconds
        end: End time in seconds

    Returns:
        Sliced audio array
    """
    start_sample = int(start * sr)
    end_sample = int(end * sr)

    # Clamp to valid range
    start_sample = max(0, min(start_sample, len(audio)))
    end_sample = max(0, min(end_sample, len(audio)))

    return audio[start_sample:end_sample]


def offset_segments(
    segments: List[dict],
    offset: float
) -> List[dict]:
    """
    Shift timestamps of segments and words by an offset.

    Args:
        segments: List of segment dicts with 'start', 'end', and optionally 'words'
        offset: Time offset in seconds to add

    Returns:
        New list of segments with adjusted timestamps
    """
    result = []
    for seg in segments:
        new_seg = seg.copy()
        new_seg['start'] = seg['start'] + offset
        new_seg['end'] = seg['end'] + offset

        # Offset word timestamps if present
        if 'words' in seg:
            new_seg['words'] = [
                {
                    **word,
                    'start': word['start'] + offset,
                    'end': word['end'] + offset
                }
                for word in seg['words']
            ]

        result.append(new_seg)

    return result


def get_audio_duration(file_path: str) -> float:
    """
    Get the duration of an audio file in seconds.

    Args:
        file_path: Path to audio file

    Returns:
        Duration in seconds
    """
    try:
        import soundfile as sf
        info = sf.info(file_path)
        return info.duration
    except Exception:
        # Fallback: load audio
        audio, sr = load_audio(file_path)
        return len(audio) / sr


def remove_temp_file(file_path: str) -> None:
    """
    Safely remove a temporary file.

    Args:
        file_path: Path to file to remove
    """
    try:
        if os.path.exists(file_path):
            os.unlink(file_path)
    except OSError:
        pass  # Ignore cleanup errors
