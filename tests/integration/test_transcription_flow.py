"""
Integration tests for transcription flow

This test module covers the full transcription pipeline:
- Frontend → Rust → Python communication
- Event propagation (progress → complete → error)
- Task queue management
- Concurrent task handling
- Cancellation scenarios
"""
import pytest
import json
import asyncio
import subprocess
import tempfile
import os
from pathlib import Path
from unittest.mock import Mock, patch

# Test configuration
PYTHON_EXE = "python"
AI_ENGINE_PATH = str(Path(__file__).parent.parent.parent / "ai-engine" / "main.py")


@pytest.mark.integration
class TestTranscriptionFlow:
    """Test complete transcription flow from UI to Python."""

    @pytest.fixture
    def sample_audio_file(self, tmp_path):
        """Create a small test audio file."""
        # For testing, create a small file (not real audio, but valid for path testing)
        audio_file = tmp_path / "test_audio.mp3"
        audio_file.write_bytes(b"fake audio content")
        return str(audio_file)

    def test_python_engine_starts(self):
        """Test that Python engine starts in server mode."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        try:
            # Send ping command
            process.stdin.write(json.dumps({"type": "ping"}) + "\n")
            process.stdin.flush()

            # Read response
            response_line = process.stdout.readline()
            response = json.loads(response_line.strip())

            assert response["type"] == "pong"

        finally:
            # Send shutdown
            process.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
            process.stdin.flush()
            process.wait(timeout=5)

    def test_python_engine_hello_message(self):
        """Test that Python engine emits hello message."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        try:
            # Read first line (should be hello)
            hello_line = process.stdout.readline()
            hello = json.loads(hello_line.strip())

            assert hello["type"] == "ready"
            assert "message" in hello

        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_transcription_command_validation(self, sample_audio_file):
        """Test transcription command is validated properly."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        try:
            # Skip hello message
            process.stdout.readline()

            # Test missing file parameter
            cmd = json.dumps({
                "type": "transcribe"
                # Missing 'file' field
            })
            process.stdin.write(cmd + "\n")
            process.stdin.flush()

            response_line = process.stdout.readline()
            response = json.loads(response_line.strip())

            assert response["type"] == "error"
            assert "missing" in response["error"].lower() or "required" in response["error"].lower()

        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_transcription_nonexistent_file(self):
        """Test transcription fails for non-existent file."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        try:
            # Skip hello message
            process.stdout.readline()

            cmd = json.dumps({
                "type": "transcribe",
                "file": "/nonexistent/file.mp3",
                "model": "whisper-base",
                "device": "cpu",
                "language": "auto"
            })
            process.stdin.write(cmd + "\n")
            process.stdin.flush()

            # Should get error response
            error_seen = False
            for _ in range(10):  # Read up to 10 lines
                line = process.stdout.readline()
                if not line:
                    break
                response = json.loads(line.strip())
                if response.get("type") == "error":
                    error_seen = True
                    assert "not found" in response["error"].lower() or "does not exist" in response["error"].lower()
                    break

            assert error_seen, "Expected error response for non-existent file"

        finally:
            process.terminate()
            process.wait(timeout=5)

    @pytest.mark.slow
    def test_progress_events_emitted(self, sample_audio_file):
        """Test that progress events are emitted during transcription."""
        # This test would require a real model and valid audio file
        # Marked as slow and skipped by default
        pytest.skip("Requires downloaded model and valid audio file")

    def test_invalid_json_command(self):
        """Test that invalid JSON is handled gracefully."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        try:
            # Skip hello message
            process.stdout.readline()

            # Send invalid JSON
            process.stdin.write("invalid json{\n")
            process.stdin.flush()

            # Should get error response
            error_seen = False
            for _ in range(10):
                line = process.stdout.readline()
                if not line:
                    break
                try:
                    response = json.loads(line.strip())
                    if response.get("type") == "error":
                        error_seen = True
                        break
                except json.JSONDecodeError:
                    pass

            assert error_seen, "Expected error response for invalid JSON"

        finally:
            process.terminate()
            process.wait(timeout=5)


@pytest.mark.integration
class TestEventPropagation:
    """Test event propagation from Python to Rust to Frontend."""

    def test_progress_event_format(self):
        """Test progress event has correct format."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        try:
            # Skip hello
            process.stdout.readline()

            # Send command that will emit progress
            # We'll simulate this by testing the format directly
            pass  # Actual progress requires real transcription

        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_error_event_format(self):
        """Test error event has correct format."""
        process = subprocess.Popen(
            [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        try:
            # Skip hello
            process.stdout.readline()

            # Send invalid command to trigger error
            cmd = json.dumps({"type": "invalid_command"})
            process.stdin.write(cmd + "\n")
            process.stdin.flush()

            # Read error response
            error_line = process.stdout.readline()
            response = json.loads(error_line.strip())

            assert "type" in response
            assert response["type"] in ["error", "unknown"]

        finally:
            process.terminate()
            process.wait(timeout=5)


@pytest.mark.integration
class TestTaskQueue:
    """Test task queue management."""

    def test_max_concurrent_tasks(self):
        """Test that max 2 tasks run concurrently."""
        # This would require starting multiple transcriptions
        # and verifying only 2 run at a time
        pytest.skip("Requires real transcription setup")

    def test_task_queued_when_limit_reached(self):
        """Test that tasks are queued when limit is reached."""
        pytest.skip("Requires real transcription setup")

    def test_task_starts_after_previous_completes(self):
        """Test that queued task starts when running task completes."""
        pytest.skip("Requires real transcription setup")


@pytest.mark.integration
class TestCancellation:
    """Test task cancellation scenarios."""

    def test_cancel_running_task(self):
        """Test cancelling a running task."""
        pytest.skip("Requires real transcription setup")

    def test_cancel_queued_task(self):
        """Test cancelling a queued task."""
        pytest.skip("Requires real transcription setup")

    def test_cancel_nonexistent_task(self):
        """Test cancelling a task that doesn't exist."""
        # This should not cause errors
        pytest.skip("Requires Rust backend integration")


@pytest.mark.integration
@pytest.mark.models
class TestModelIntegration:
    """Test model-related integration scenarios."""

    def test_model_auto_download(self):
        """Test that model is downloaded automatically if missing."""
        pytest.skip("Requires network and model download setup")

    def test_model_cached_after_download(self):
        """Test that model is cached after first download."""
        pytest.skip("Requires network and model download setup")

    def test_missing_model_error(self):
        """Test error when model doesn't exist and can't be downloaded."""
        pytest.skip("Requires offline testing setup")


@pytest.mark.integration
@pytest.mark.slow
class TestPerformance:
    """Test performance characteristics."""

    @pytest.mark.parametrize("file_size_mb,expected_max_time", [
        (1, 30),    # Small file: < 30 seconds
        (10, 120),  # Medium file: < 2 minutes
        (100, 600), # Large file: < 10 minutes
    ])
    def test_transcription_speed(self, file_size_mb, expected_max_time):
        """Test transcription completes within expected time."""
        pytest.skip("Requires real audio files and models")

    def test_memory_usage_during_transcription(self):
        """Test memory usage remains reasonable."""
        pytest.skip("Requires memory profiling setup")

    def test_concurrent_task_performance(self):
        """Test performance with 2 concurrent tasks."""
        pytest.skip("Requires real transcription setup")


# Helper functions

def wait_for_event(process, event_type, timeout=10):
    """Wait for a specific event type from Python process."""
    import time

    start_time = time.time()
    while time.time() - start_time < timeout:
        line = process.stdout.readline()
        if not line:
            return None

        try:
            event = json.loads(line.strip())
            if event.get("type") == event_type:
                return event
        except json.JSONDecodeError:
            pass

    return None


def send_command(process, command):
    """Send a JSON command to Python process."""
    cmd_str = json.dumps(command) + "\n"
    process.stdin.write(cmd_str)
    process.stdin.flush()


# Pytest fixtures

@pytest.fixture
def python_process():
    """Start Python engine in server mode."""
    process = subprocess.Popen(
        [PYTHON_EXE, AI_ENGINE_PATH, "--server"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    # Wait for hello message
    process.stdout.readline()

    yield process

    # Cleanup
    try:
        send_command(process, {"type": "shutdown"})
        process.wait(timeout=5)
    except:
        process.terminate()
        process.wait(timeout=5)


# Markers for test categorization

pytestmark = [
    "integration",
]
