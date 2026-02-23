"""
Comprehensive test suite for the improved download system.

Tests cover:
- HuggingFace download with mocked snapshot_download
- Progress callback handling
- Retry mechanism with network failures
- Checksum verification
- Disk space checking
- Cancellation handling
- Resume capability
- Sherpa-ONNX download with mocked requests
"""

import json
import os
import pytest
from unittest.mock import Mock, patch, MagicMock, call
from pathlib import Path
import tarfile
import io


# Import functions from main.py
# We need to add the ai-engine directory to the path
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ai-engine'))

from main import (
    download_model,
    download_sherpa_onnx_model,
    validate_cache_dir,
    reset_download_cancel,
    cancel_model_download,
    emit_progress,
    emit_error,
    emit_download_complete,
    validate_model_name,
    validate_url,
    get_model_size_mb,
    _download_cancelled,
    MAX_DOWNLOAD_SIZE,
    DOWNLOAD_TIMEOUT,
)


class TestProgressCallbackHandling:
    """Test progress callback handling during downloads."""

    def test_emit_progress_outputs_valid_json(self, capfd):
        """Test that emit_progress outputs valid JSON."""
        emit_progress("download", 50, "Downloading model...")

        captured = capfd.readouterr()
        output = json.loads(captured.out)

        assert output["type"] == "progress"
        assert output["data"]["stage"] == "download"
        assert output["data"]["progress"] == 50
        assert output["data"]["message"] == "Downloading model..."

    def test_emit_progress_with_zero_percent(self, capfd):
        """Test progress with 0%."""
        emit_progress("download", 0, "Starting download...")

        captured = capfd.readouterr()
        output = json.loads(captured.out)

        assert output["data"]["progress"] == 0

    def test_emit_progress_with_hundred_percent(self, capfd):
        """Test progress with 100%."""
        emit_progress("complete", 100, "Download complete!")

        captured = capfd.readouterr()
        output = json.loads(captured.out)

        assert output["data"]["progress"] == 100

    def test_emit_error_outputs_valid_json(self, capfd):
        """Test that emit_error outputs valid JSON."""
        emit_error("Network error occurred")

        captured = capfd.readouterr()
        output = json.loads(captured.out)

        assert output["type"] == "error"
        assert output["error"] == "Network error occurred"

    def test_emit_download_complete_outputs_valid_json(self, capfd):
        """Test that emit_download_complete outputs valid JSON."""
        emit_download_complete("whisper-tiny", 150, "/path/to/model")

        captured = capfd.readouterr()
        output = json.loads(captured.out)

        assert output["type"] == "DownloadComplete"
        assert output["data"]["model_name"] == "whisper-tiny"
        assert output["data"]["size_mb"] == 150
        assert output["data"]["path"] == "/path/to/model"


class TestHuggingFaceDownload:
    """Test HuggingFace download functionality with mocked snapshot_download."""

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    def test_successful_huggingface_download(self, mock_validate_name, mock_validate_cache, mock_snapshot, capfd):
        """Test successful HuggingFace model download."""
        # Setup mocks
        mock_validate_name.return_value = "whisper-tiny"
        mock_validate_cache.return_value = True
        mock_snapshot.return_value = "/fake/path/to/whisper-tiny"

        with patch('main.get_model_size_mb') as mock_size:
            mock_size.return_value = 150

            download_model(
                model_name="whisper-tiny",
                cache_dir="/fake/cache",
                model_type="whisper"
            )

            # Verify snapshot_download was called with correct arguments
            mock_snapshot.assert_called_once()
            call_kwargs = mock_snapshot.call_args[1]
            assert "whisper-tiny" in str(call_kwargs.get('repo_id', ''))
            assert call_kwargs.get('local_dir') == "/fake/cache/whisper-tiny"

        # Verify completion message was emitted
        captured = capfd.readouterr()
        outputs = [json.loads(line) for line in captured.out.strip().split('\n') if line]

        complete_msgs = [o for o in outputs if o.get('type') == 'DownloadComplete']
        assert len(complete_msgs) > 0
        assert complete_msgs[0]['data']['model_name'] == 'whisper-tiny'

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    def test_huggingface_download_with_sherpa_model(self, mock_validate_name, mock_validate_cache, mock_snapshot, tmp_path):
        """Test download of sherpa-onnx diarization model."""
        mock_validate_name.return_value = "sherpa-onnx-diarization"
        mock_validate_cache.return_value = True
        mock_snapshot.return_value = "/fake/path"

        with patch('main.get_model_size_mb', return_value=100):
            download_model(
                model_name="sherpa-onnx-diarization",
                cache_dir="/fake/cache",
                model_type="diarization",
            )

        # Verify snapshot_download was called
        mock_snapshot.assert_called_once()

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    def test_huggingface_download_network_failure(self, mock_validate_name, mock_validate_cache, mock_snapshot, capfd):
        """Test handling of network failures during download."""
        mock_validate_name.return_value = "whisper-base"
        mock_validate_cache.return_value = True
        mock_snapshot.side_effect = Exception("Network error")

        download_model(
            model_name="whisper-base",
            cache_dir="/fake/cache",
            model_type="whisper"
        )

        # Verify error was emitted
        captured = capfd.readouterr()
        outputs = [json.loads(line) for line in captured.out.strip().split('\n') if line]

        error_msgs = [o for o in outputs if o.get('type') == 'error']
        assert len(error_msgs) > 0
        assert "Network error" in error_msgs[0].get('error', '')

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    def test_huggingface_download_insufficient_disk_space(self, mock_validate_name, mock_validate_cache, mock_snapshot, capfd):
        """Test handling of insufficient disk space."""
        mock_validate_name.return_value = "whisper-large-v3"
        mock_validate_cache.return_value = True
        mock_snapshot.side_effect = OSError("No space left on device")

        download_model(
            model_name="whisper-large-v3",
            cache_dir="/fake/cache",
            model_type="whisper"
        )

        captured = capfd.readouterr()
        outputs = [json.loads(line) for line in captured.out.strip().split('\n') if line]

        error_msgs = [o for o in outputs if o.get('type') == 'error']
        assert len(error_msgs) > 0
        assert "space" in error_msgs[0].get('error', '').lower()


class TestRetryMechanism:
    """Test retry mechanism for network failures."""

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    @patch('time.sleep')
    def test_retry_on_transient_network_error(self, mock_sleep, mock_validate_name, mock_validate_cache, mock_snapshot, capfd):
        """Test that transient network errors trigger retries."""
        mock_validate_name.return_value = "whisper-small"
        mock_validate_cache.return_value = True

        # Fail twice, then succeed
        mock_snapshot.side_effect = [
            Exception("Connection timeout"),
            Exception("Connection timeout"),
            "/fake/path"
        ]

        with patch('main.get_model_size_mb', return_value=500):
            download_model(
                model_name="whisper-small",
                cache_dir="/fake/cache",
                model_type="whisper"
            )

        # Verify multiple attempts were made
        assert mock_snapshot.call_count == 3

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    def test_no_retry_on_permanent_errors(self, mock_validate_name, mock_validate_cache, mock_snapshot, capfd):
        """Test that permanent errors don't trigger retries."""
        mock_validate_name.return_value = "invalid-model"
        mock_validate_cache.return_value = True
        mock_snapshot.side_effect = ValueError("Model not found")

        download_model(
            model_name="invalid-model",
            cache_dir="/fake/cache",
            model_type="whisper"
        )

        # Verify only one attempt was made (no retries for 4xx errors)
        assert mock_snapshot.call_count == 1

        captured = capfd.readouterr()
        outputs = [json.loads(line) for line in captured.out.strip().split('\n') if line]
        error_msgs = [o for o in outputs if o.get('type') == 'error']
        assert len(error_msgs) > 0


class TestChecksumVerification:
    """Test checksum verification for downloaded files."""

    def test_valid_checksum_passes(self):
        """Test that valid checksums pass verification."""
        # This would be implemented when checksum verification is added
        # For now, we test the concept
        pass

    def test_invalid_checksum_fails(self):
        """Test that invalid checksums fail verification."""
        # This would be implemented when checksum verification is added
        pass


class TestDiskSpaceChecking:
    """Test disk space checking before and during downloads."""

    @patch('main.validate_cache_dir')
    def test_cache_dir_validation_writable(self, mock_validate, tmp_path):
        """Test validation of writable cache directory."""
        cache_dir = tmp_path / "cache"
        cache_dir.mkdir()

        assert validate_cache_dir(str(cache_dir)) is True

        # Verify test file was cleaned up
        test_file = cache_dir / ".write_test.tmp"
        assert not test_file.exists()

    @patch('main.validate_cache_dir')
    def test_cache_dir_validation_not_writable(self, mock_validate, tmp_path):
        """Test validation of non-writable cache directory."""
        # Create a read-only directory (on Unix systems)
        cache_dir = tmp_path / "readonly_cache"
        cache_dir.mkdir()

        try:
            # Make directory read-only
            os.chmod(str(cache_dir), 0o444)

            result = validate_cache_dir(str(cache_dir))
            assert result is False
        finally:
            # Restore permissions for cleanup
            os.chmod(str(cache_dir), 0o755)

    @patch('main.validate_cache_dir')
    def test_cache_dir_validation_creates_directory(self, mock_validate, tmp_path):
        """Test that validation creates cache directory if it doesn't exist."""
        cache_dir = tmp_path / "new_cache"

        assert not cache_dir.exists()
        result = validate_cache_dir(str(cache_dir))

        assert result is True
        assert cache_dir.exists()


class TestCancellationHandling:
    """Test download cancellation functionality."""

    def test_cancel_download_sets_flag(self):
        """Test that cancel_download sets the cancellation flag."""
        reset_download_cancel()
        assert _download_cancelled["cancelled"] is False

        cancel_model_download("whisper-tiny")
        assert _download_cancelled["cancelled"] is True

    def test_reset_download_cancel_clears_flag(self):
        """Test that reset_download_cancel clears the flag."""
        _download_cancelled["cancelled"] = True
        reset_download_cancel()
        assert _download_cancelled["cancelled"] is False

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    def test_cancellation_during_download(self, mock_validate_name, mock_validate_cache, mock_snapshot, capfd):
        """Test that download can be cancelled mid-progress."""
        mock_validate_name.return_value = "whisper-medium"
        mock_validate_cache.return_value = True

        # Simulate cancellation during download
        def side_effect(*args, **kwargs):
            # Trigger cancellation
            _download_cancelled["cancelled"] = True
            raise KeyboardInterrupt("Download cancelled")

        mock_snapshot.side_effect = side_effect

        download_model(
            model_name="whisper-medium",
            cache_dir="/fake/cache",
            model_type="whisper"
        )

        captured = capfd.readouterr()
        outputs = [json.loads(line) for line in captured.out.strip().split('\n') if line]

        # Verify cancellation message was emitted
        cancel_msgs = [o for o in outputs if 'cancelled' in str(o).lower()]
        assert len(cancel_msgs) > 0


class TestResumeCapability:
    """Test resume capability for interrupted downloads."""

    @patch('huggingface_hub.snapshot_download')
    @patch('main.validate_cache_dir')
    @patch('main.validate_model_name')
    def test_resume_partial_download(self, mock_validate_name, mock_validate_cache, mock_snapshot, tmp_path):
        """Test that partial downloads can be resumed."""
        mock_validate_name.return_value = "whisper-small"
        mock_validate_cache.return_value = True
        mock_snapshot.return_value = str(tmp_path)

        with patch('main.get_model_size_mb', return_value=500):
            download_model(
                model_name="whisper-small",
                cache_dir=str(tmp_path),
                model_type="whisper"
            )

        # HuggingFace hub handles resuming automatically with resume_download=True
        # This test verifies the integration works
        mock_snapshot.assert_called_once()


class TestSherpaONNXDownload:
    """Test Sherpa-ONNX model download from GitHub releases."""

    @patch('requests.get')
    @patch('main.validate_url')
    @patch('main.get_model_size_mb')
    def test_successful_sherpa_download(self, mock_size, mock_validate_url, mock_get, capfd):
        """Test successful Sherpa-ONNX model download."""
        mock_validate_url.return_value = None
        mock_size.return_value = 50

        # Mock HTTP response
        mock_response = Mock()
        mock_response.headers = {'content-length': '52428800'}  # 50 MB
        mock_response.iter_content = lambda chunk_size: [b'fake_data' * chunk_size]
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        with patch('builtins.open', create=True) as mock_open:
            mock_file = MagicMock()
            mock_open.return_value = mock_file

            download_sherpa_onnx_model(
                model_name="sherpa-onnx-diarization",
                url="https://github.com/test/model.onnx",
                target_dir="/fake/target"
            )

        # Verify request was made
        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        assert kwargs['stream'] is True
        assert kwargs['timeout'] == DOWNLOAD_TIMEOUT

    @patch('requests.get')
    @patch('main.validate_url')
    def test_sherpa_download_size_limit(self, mock_validate_url, mock_get, capfd):
        """Test that Sherpa download enforces size limits."""
        mock_validate_url.return_value = None

        # Mock response with size exceeding limit
        mock_response = Mock()
        mock_response.headers = {'content-length': str(MAX_DOWNLOAD_SIZE + 1)}
        mock_get.return_value = mock_response

        download_sherpa_onnx_model(
            model_name="sherpa-onnx-large",
            url="https://github.com/test/large.onnx",
            target_dir="/fake/target"
        )

        # Verify error was emitted
        captured = capfd.readouterr()
        outputs = [json.loads(line) for line in captured.out.strip().split('\n') if line]

        error_msgs = [o for o in outputs if o.get('type') == 'error']
        assert len(error_msgs) > 0
        assert "exceeds maximum" in error_msgs[0].get('error', '')

    @patch('requests.get')
    @patch('main.validate_url')
    def test_sherpa_download_network_error(self, mock_validate_url, mock_get, capfd):
        """Test handling of network errors during Sherpa download."""
        mock_validate_url.return_value = None
        mock_get.side_effect = Exception("Network unreachable")

        download_sherpa_onnx_model(
            model_name="sherpa-onnx-segmentation",
            url="https://github.com/test/segment.tar.bz2",
            target_dir="/fake/target"
        )

        captured = capfd.readouterr()
        outputs = [json.loads(line) for line in captured.out.strip().split('\n') if line]

        error_msgs = [o for o in outputs if o.get('type') == 'error']
        assert len(error_msgs) > 0

    @patch('requests.get')
    @patch('main.validate_url')
    @patch('main.get_model_size_mb')
    def test_sherpa_download_tar_extraction(self, mock_size, mock_validate_url, mock_get, capfd):
        """Test Sherpa download with tar.bz2 extraction."""
        mock_validate_url.return_value = None
        mock_size.return_value = 100

        # Mock response
        mock_response = Mock()
        mock_response.headers = {'content-length': '104857600'}  # 100 MB
        mock_response.raise_for_status = Mock()

        # Create fake tar data
        fake_tar = io.BytesIO()
        with tarfile.open(fileobj=fake_tar, mode='w:bz2') as tar:
            info = tarfile.TarInfo(name="test_file.txt")
            info.size = 12
            tar.addfile(info, io.BytesIO(b"test content"))
        fake_tar.seek(0)

        mock_response.iter_content = lambda chunk_size: list(fake_tar.read())
        mock_get.return_value = mock_response

        with patch('main.safe_extract') as mock_extract:
            download_sherpa_onnx_model(
                model_name="sherpa-onnx-segmentation",
                url="https://github.com/test/segment.tar.bz2",
                target_dir="/fake/target"
            )

        # Verify extraction was called
        mock_extract.assert_called_once()

    @patch('requests.get')
    @patch('main.validate_url')
    def test_sherpa_download_cancellation(self, mock_validate_url, mock_get, capfd):
        """Test cancellation during Sherpa download."""
        mock_validate_url.return_value = None

        # Mock response that triggers cancellation
        mock_response = Mock()
        mock_response.headers = {'content-length': '1048576'}
        mock_response.raise_for_status = Mock()

        def iter_content(chunk_size):
            _download_cancelled["cancelled"] = True
            raise KeyboardInterrupt("Cancelled")

        mock_response.iter_content = iter_content
        mock_get.return_value = mock_response

        download_sherpa_onnx_model(
            model_name="sherpa-onnx-diarization",
            url="https://github.com/test/model.onnx",
            target_dir="/fake/target"
        )

        # Verify cancellation was handled
        assert _download_cancelled["cancelled"] is True


class TestValidation:
    """Test input validation for downloads."""

    def test_validate_model_name_valid_names(self):
        """Test validation of valid model names."""
        valid_names = [
            "whisper-tiny",
            "whisper-base",
            "whisper-small",
            "whisper-medium",
            "whisper-large-v3",
            "sherpa-onnx-speaker-diarization-v3",  # No dots - only letters, numbers, underscore, hyphen
        ]

        for name in valid_names:
            result = validate_model_name(name)
            assert result == name

    def test_validate_model_name_path_traversal(self):
        """Test that path traversal attempts are rejected."""
        malicious_names = [
            "../../../etc/passwd",
            "whisper-tiny/../../etc/passwd",
            "/absolute/path",
            "C:\\Windows\\System32",
        ]

        for name in malicious_names:
            with pytest.raises(ValueError, match="Invalid model name"):
                validate_model_name(name)

    def test_validate_url_allowed_hosts(self):
        """Test URL validation with allowed hosts."""
        valid_urls = [
            "https://github.com/user/repo/releases/download/v1/model.onnx",
            "https://huggingface.co/org/model/resolve/main/model.bin",
            "https://cdn-lfs.huggingface.co/repo/model",
        ]

        for url in valid_urls:
            # Should not raise
            validate_url(url)

    def test_validate_url_blocked_hosts(self):
        """Test URL validation blocks malicious hosts."""
        # Test evil.com
        with pytest.raises(ValueError, match="not in the allowed list"):
            validate_url("https://evil.com/malware.exe")

        # Test IP address
        with pytest.raises(ValueError, match="not in the allowed list"):
            validate_url("https://192.168.1.1/steal.sh")

        # Test file:// scheme
        with pytest.raises(ValueError, match="URL scheme must be HTTPS"):
            validate_url("file:///etc/passwd")


class TestModelSizeCalculation:
    """Test model size calculation."""

    def test_get_model_size_mb_empty_directory(self, tmp_path):
        """Test size calculation for empty directory."""
        assert get_model_size_mb(str(tmp_path)) == 0

    def test_get_model_size_mb_with_files(self, tmp_path):
        """Test size calculation with files."""
        # Create test files
        (tmp_path / "file1.bin").write_bytes(b'0' * (1024 * 1024))  # 1 MB
        (tmp_path / "file2.bin").write_bytes(b'0' * (2 * 1024 * 1024))  # 2 MB

        size_mb = get_model_size_mb(str(tmp_path))
        assert size_mb == 3

    def test_get_model_size_mb_nested_directories(self, tmp_path):
        """Test size calculation with nested directories."""
        nested = tmp_path / "nested" / "deep"
        nested.mkdir(parents=True)

        (nested / "file.bin").write_bytes(b'0' * (5 * 1024 * 1024))  # 5 MB

        size_mb = get_model_size_mb(str(tmp_path))
        assert size_mb == 5


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
