"""
Rust Audio Module Bridge

Provides Python interface to Rust-native audio processing via Tauri IPC.
Replaces pydub and soundfile with Rust-based audio processing.

Usage:
    from rust_audio_bridge import convert_to_wav, get_duration

    # Convert audio to WAV
    info = convert_to_wav("input.mp4", "output.wav")

    # Get duration
    duration = get_duration("audio.wav")
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any


class RustAudioBridge:
    """
    Bridge to Rust audio processing module via Tauri IPC.

    Falls back to Python (pydub/soundfile) if Tauri is not available.
    """

    def __init__(self):
        # Rust CLI helper is optional in bundled/runtime environments.
        self.use_rust = os.getenv("TRANSCRIBE_USE_RUST_AUDIO_BRIDGE", "0") == "1"
        self._fallback_reason = None

    def _invoke_rust(self, command: str, **kwargs) -> Any:
        """
        Invoke Rust Tauri command.

        Args:
            command: Tauri command name
            **kwargs: Command arguments

        Returns:
            Command result

        Raises:
            RuntimeError: If Rust command fails
        """
        try:
            # Use tauri invoke via subprocess to CLI
            # This assumes the app provides a CLI interface
            import json

            cmd_args = [
                sys.executable,
                "-c",
                f"import sys; sys.path.insert(0, '.'); from rust_audio_cli import invoke; invoke('{command}', {json.dumps(kwargs)})",
            ]

            result = subprocess.run(
                cmd_args, capture_output=True, text=True, timeout=60
            )

            if result.returncode != 0:
                raise RuntimeError(f"Rust command failed: {result.stderr}")

            return json.loads(result.stdout) if result.stdout else None

        except (
            subprocess.TimeoutExpired,
            FileNotFoundError,
            json.JSONDecodeError,
        ) as e:
            # Fall back to Python implementation
            self.use_rust = False
            self._fallback_reason = str(e)
            return None

    def convert_to_wav(
        self, input_path: str, output_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Convert audio file to 16kHz mono WAV.

        Args:
            input_path: Path to input audio file
            output_path: Path to output WAV file (optional, creates temp file if not provided)

        Returns:
            Dict with audio info: {sample_rate, channels, duration, format}
        """
        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

        if self.use_rust:
            try:
                result = self._invoke_rust(
                    "convert_audio_to_wav",
                    input_path=input_path,
                    output_path=output_path,
                )
                if result:
                    if isinstance(result, dict):
                        result["_output_path"] = output_path
                    return result
            except Exception as e:
                print(
                    f"[RustAudioBridge] Rust convert failed: {e}, falling back to Python",
                    file=sys.stderr,
                )

        # Fallback to pydub
        return self._convert_to_wav_python(input_path, output_path)

    def _convert_to_wav_python(
        self, input_path: str, output_path: str
    ) -> Dict[str, Any]:
        """Python fallback for WAV conversion using pydub."""
        try:
            from pydub import AudioSegment

            audio = AudioSegment.from_file(input_path)
            audio = audio.set_frame_rate(16000).set_channels(1)
            audio.export(output_path, format="wav")

            return {
                "sample_rate": 16000,
                "channels": 1,
                "duration": len(audio) / 1000.0,
                "format": "wav",
                "_output_path": output_path,
            }
        except ImportError:
            raise RuntimeError("pydub not available. Install with: pip install pydub")

    def get_duration(self, file_path: str) -> float:
        """
        Get audio file duration in seconds.

        Args:
            file_path: Path to audio file

        Returns:
            Duration in seconds
        """
        if self.use_rust:
            try:
                result = self._invoke_rust("get_audio_duration", file_path=file_path)
                if result is not None:
                    return float(result)
            except Exception as e:
                print(
                    f"[RustAudioBridge] Rust duration failed: {e}, falling back to Python",
                    file=sys.stderr,
                )

        # Fallback to soundfile
        return self._get_duration_python(file_path)

    def _get_duration_python(self, file_path: str) -> float:
        """Python fallback for duration using soundfile."""
        try:
            import soundfile as sf

            info = sf.info(file_path)
            return info.duration
        except ImportError:
            # Fallback to pydub
            from pydub import AudioSegment

            audio = AudioSegment.from_file(file_path)
            return len(audio) / 1000.0

    def slice_audio(
        self,
        file_path: str,
        start_ms: int,
        end_ms: int,
        output_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Extract audio segment and save as WAV.

        Args:
            file_path: Path to input audio file
            start_ms: Start time in milliseconds
            end_ms: End time in milliseconds
            output_path: Path to output WAV file (optional)

        Returns:
            Dict with audio info of sliced segment
        """
        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

        if self.use_rust:
            try:
                result = self._invoke_rust(
                    "extract_audio_segment",
                    file_path=file_path,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    output_path=output_path,
                )
                if result:
                    return result
            except Exception as e:
                print(
                    f"[RustAudioBridge] Rust slice failed: {e}, falling back to Python",
                    file=sys.stderr,
                )

        # Fallback to pydub
        return self._slice_audio_python(file_path, start_ms, end_ms, output_path)

    def _slice_audio_python(
        self, file_path: str, start_ms: int, end_ms: int, output_path: str
    ) -> Dict[str, Any]:
        """Python fallback for audio slicing using pydub."""
        try:
            from pydub import AudioSegment

            audio = AudioSegment.from_file(file_path)
            segment = audio[start_ms:end_ms]
            segment = segment.set_frame_rate(16000).set_channels(1)
            segment.export(output_path, format="wav")

            return {
                "sample_rate": 16000,
                "channels": 1,
                "duration": len(segment) / 1000.0,
                "format": "wav",
            }
        except ImportError:
            raise RuntimeError("pydub not available. Install with: pip install pydub")


# Global bridge instance
_audio_bridge = None


def get_audio_bridge() -> RustAudioBridge:
    """Get or create global audio bridge instance."""
    global _audio_bridge
    if _audio_bridge is None:
        _audio_bridge = RustAudioBridge()
    return _audio_bridge


# Convenience functions
def convert_to_wav(
    input_path: str, output_path: Optional[str] = None
) -> Dict[str, Any]:
    """Convert audio file to 16kHz mono WAV."""
    return get_audio_bridge().convert_to_wav(input_path, output_path)


def get_duration(file_path: str) -> float:
    """Get audio file duration in seconds."""
    return get_audio_bridge().get_duration(file_path)


def slice_audio(
    file_path: str, start_ms: int, end_ms: int, output_path: Optional[str] = None
) -> Dict[str, Any]:
    """Extract audio segment and save as WAV."""
    return get_audio_bridge().slice_audio(file_path, start_ms, end_ms, output_path)
