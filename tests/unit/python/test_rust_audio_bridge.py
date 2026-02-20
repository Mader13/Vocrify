"""Unit tests for Rust audio bridge fallback behavior."""

import sys
import types
from pathlib import Path

import pytest

from utils.rust_audio_bridge import RustAudioBridge


@pytest.fixture(autouse=True)
def reset_download_state():
    """Override global fixture that assumes legacy main module globals."""
    yield


def test_convert_to_wav_includes_output_path_metadata(tmp_path, monkeypatch):
    """Fallback conversion returns the created WAV path in metadata."""
    input_path = tmp_path / "input.mp4"
    output_path = tmp_path / "output.wav"
    input_path.write_bytes(b"fake-audio")

    class FakeAudio:
        def __len__(self):
            return 1000

        def set_frame_rate(self, _rate):
            return self

        def set_channels(self, _channels):
            return self

        def export(self, path, format):
            assert format == "wav"
            Path(path).write_bytes(b"wav-data")

    class FakeAudioSegment:
        @staticmethod
        def from_file(_file_path):
            return FakeAudio()

    monkeypatch.setitem(
        sys.modules,
        "pydub",
        types.SimpleNamespace(AudioSegment=FakeAudioSegment),
    )

    bridge = RustAudioBridge()
    bridge.use_rust = False

    info = bridge.convert_to_wav(str(input_path), str(output_path))

    assert info["_output_path"] == str(output_path)
    assert output_path.exists()


def test_convert_to_wav_does_not_try_rust_by_default(tmp_path, monkeypatch):
    """Default bridge behavior skips Rust CLI invocation."""
    input_path = tmp_path / "input.mp4"
    output_path = tmp_path / "output.wav"
    input_path.write_bytes(b"fake-audio")

    class FakeAudio:
        def __len__(self):
            return 1000

        def set_frame_rate(self, _rate):
            return self

        def set_channels(self, _channels):
            return self

        def export(self, path, format):
            assert format == "wav"
            Path(path).write_bytes(b"wav-data")

    class FakeAudioSegment:
        @staticmethod
        def from_file(_file_path):
            return FakeAudio()

    rust_invocations = 0

    def fake_run(*_args, **_kwargs):
        nonlocal rust_invocations
        rust_invocations += 1
        raise AssertionError("Rust CLI should not be invoked")

    monkeypatch.setitem(
        sys.modules,
        "pydub",
        types.SimpleNamespace(AudioSegment=FakeAudioSegment),
    )
    monkeypatch.setattr("utils.rust_audio_bridge.subprocess.run", fake_run)

    bridge = RustAudioBridge()
    info = bridge.convert_to_wav(str(input_path), str(output_path))

    assert rust_invocations == 0
    assert info["_output_path"] == str(output_path)
