#!/usr/bin/env python3
"""
Comprehensive unit tests for the improved downloader module.

Tests cover all major functionality:
- DownloadProgress data class
- DownloadConfig configuration
- ModelMetadata handling
- Custom exceptions
- ModelDownloader class methods
- HuggingFace Hub integration
- URL downloads with resume
- Checksum verification
- Disk space checking
- Retry mechanism with exponential backoff
- Progress tracking and callbacks
- Cancellation handling
- Safe tar extraction

Run with: pytest tests/unit/python/test_downloader_new.py -v
"""

import hashlib
import json
import os
import shutil
import tempfile
import threading
import time
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock, call
from urllib.parse import urlparse

import pytest


# Add ai-engine to path for imports
import sys
ai_engine_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../ai-engine'))
if ai_engine_path not in sys.path:
    sys.path.insert(0, ai_engine_path)

from downloader import (
    DownloadStage,
    DownloadProgress,
    ModelMetadata,
    DownloadConfig,
    DownloadCancelledException,
    DownloadFailedException,
    InsufficientDiskSpaceException,
    ChecksumVerificationException,
    ModelDownloader,
    download_model,
    download_from_url,
)


class TestDownloadProgress:
    """Tests for DownloadProgress data class."""

    def test_progress_to_dict(self):
        """Test conversion to dictionary for JSON serialization."""
        progress = DownloadProgress(
            stage=DownloadStage.DOWNLOADING,
            progress_percent=50.0,
            downloaded_bytes=104857600,  # 100MB
            total_bytes=209715200,  # 200MB
            speed_bytes_per_sec=5242880,  # 5MB/s
            eta_seconds=20.0,
            current_file="model.bin",
            message="Downloading..."
        )

        result = progress.to_dict()

        assert result["stage"] == "downloading"
        assert result["progress"] == 50.0
        assert result["downloaded"] == 104857600
        assert result["total"] == 209715200
        assert result["speed"] == 5242880
        assert result["eta"] == 20.0
        assert result["file"] == "model.bin"
        assert result["message"] == "Downloading..."

    def test_progress_all_stages(self):
        """Test progress for all download stages."""
        stages = [
            DownloadStage.INITIALIZING,
            DownloadStage.VALIDATING,
            DownloadStage.CHECKING_DISK,
            DownloadStage.DOWNLOADING,
            DownloadStage.VERIFYING,
            DownloadStage.EXTRACTING,
            DownloadStage.COMPLETE,
            DownloadStage.FAILED,
            DownloadStage.CANCELLED,
        ]

        for stage in stages:
            progress = DownloadProgress(
                stage=stage,
                progress_percent=0,
                downloaded_bytes=0,
                total_bytes=0,
                speed_bytes_per_sec=0,
                eta_seconds=0,
                current_file="",
                message=f"{stage.value} stage"
            )

            assert progress.stage == stage


class TestDownloadConfig:
    """Tests for DownloadConfig data class."""

    def test_default_config(self):
        """Test default configuration values."""
        config = DownloadConfig()

        assert config.max_retries == 3
        assert config.retry_delay_base == 1.0
        assert config.retry_delay_max == 60.0
        assert config.chunk_size == 8192
        assert config.timeout == 300
        assert config.max_download_size == 10 * 1024**3  # 10GB
        assert config.resume_enabled is True
        assert config.verify_checksum is True
        assert config.check_disk_space is True
        assert config.disk_space_buffer == 1.5

    def test_custom_config(self):
        """Test custom configuration values."""
        config = DownloadConfig(
            max_retries=5,
            retry_delay_base=2.0,
            chunk_size=16384,
            timeout=600,
            max_download_size=5 * 1024**3,
            resume_enabled=False,
            verify_checksum=False,
            check_disk_space=False,
            disk_space_buffer=2.0
        )

        assert config.max_retries == 5
        assert config.retry_delay_base == 2.0
        assert config.chunk_size == 16384
        assert config.timeout == 600
        assert config.max_download_size == 5 * 1024**3
        assert config.resume_enabled is False
        assert config.verify_checksum is False
        assert config.check_disk_space is False
        assert config.disk_space_buffer == 2.0


class TestModelMetadata:
    """Tests for ModelMetadata class."""

    def test_metadata_creation(self):
        """Test creating metadata manually."""
        metadata = ModelMetadata(
            name="test-model",
            repo_id="org/test-model",
            total_size_bytes=524288000,  # 500MB
            sha256_checksum="abc123def456",
            files=["model.bin", "config.json"],
            requires_token=True
        )

        assert metadata.name == "test-model"
        assert metadata.repo_id == "org/test-model"
        assert metadata.total_size_bytes == 524288000
        assert metadata.sha256_checksum == "abc123def456"
        assert metadata.files == ["model.bin", "config.json"]
        assert metadata.requires_token is True

    @patch('downloader.HfApi')
    def test_metadata_from_hf_api(self, mock_hf_api_class):
        """Test fetching metadata from HuggingFace Hub API."""
        # Mock the API response
        mock_api = Mock()
        mock_repo_info = Mock()
        mock_sibling1 = Mock()
        mock_sibling1.rfilename = "model.bin"
        mock_sibling1.size = 1000000000
        mock_sibling2 = Mock()
        mock_sibling2.rfilename = "config.json"
        mock_sibling2.size = 1000
        mock_repo_info.siblings = [mock_sibling1, mock_sibling2]
        mock_repo_info.private = False
        mock_repo_info.gated = False

        mock_api.repo_info.return_value = mock_repo_info
        mock_hf_api_class.return_value = mock_api

        metadata = ModelMetadata.from_hf_api("org/test-model", None)

        assert metadata.name == "org/test-model"
        assert metadata.repo_id == "org/test-model"
        assert metadata.total_size_bytes == 1000001000
        assert metadata.files == ["model.bin", "config.json"]
        assert metadata.requires_token is False

    @patch('downloader.HfApi')
    def test_metadata_from_hf_api_with_token(self, mock_hf_api_class):
        """Test fetching metadata with authentication token."""
        mock_api = Mock()
        mock_repo_info = Mock()
        mock_repo_info.siblings = []
        mock_repo_info.private = False
        mock_repo_info.gated = True  # Gated model

        mock_api.repo_info.return_value = mock_repo_info
        mock_hf_api_class.return_value = mock_api

        metadata = ModelMetadata.from_hf_api("org/gated-model", "test_token")

        assert metadata.requires_token is True
        mock_api.repo_info.assert_called_once_with(repo_id="org/gated-model", files_metadata=True)


class TestDownloadExceptions:
    """Tests for custom exceptions."""

    def test_download_cancelled_exception(self):
        """Test DownloadCancelledException."""
        exc = DownloadCancelledException("User cancelled")

        assert str(exc) == "User cancelled"
        assert isinstance(exc, Exception)

    def test_download_failed_exception(self):
        """Test DownloadFailedException."""
        inner_error = ValueError("Network error")
        exc = DownloadFailedException(
            "Download failed after 3 attempts",
            retry_count=3,
            last_error=inner_error
        )

        assert exc.retry_count == 3
        assert exc.last_error == inner_error
        assert "3 attempts" in str(exc)
        assert isinstance(exc, Exception)

    def test_insufficient_disk_space_exception(self):
        """Test InsufficientDiskSpaceException."""
        exc = InsufficientDiskSpaceException(
            required_bytes=10*1024**3,
            available_bytes=5*1024**3
        )

        assert exc.required_bytes == 10*1024**3
        assert exc.available_bytes == 5*1024**3
        assert "10.00GB" in str(exc)
        assert "5.00GB" in str(exc)
        assert isinstance(exc, Exception)

    def test_checksum_verification_exception(self):
        """Test ChecksumVerificationException."""
        exc = ChecksumVerificationException(
            file_path="/path/to/file.bin",
            expected="abc123",
            actual="def456"
        )

        assert exc.file_path == "/path/to/file.bin"
        assert exc.expected_checksum == "abc123"
        assert exc.actual_checksum == "def456"
        assert "abc123" in str(exc)
        assert "def456" in str(exc)
        assert isinstance(exc, Exception)


class TestModelDownloader:
    """Tests for ModelDownloader class."""

    def setup_method(self):
        """Setup test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.progress_updates = []
        self.cancel_event = threading.Event()

        def progress_callback(progress: DownloadProgress):
            self.progress_updates.append(progress)

        self.downloader = ModelDownloader(
            progress_callback=progress_callback,
            cancel_event=self.cancel_event,
        )

    def teardown_method(self):
        """Cleanup test fixtures."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def test_initialization(self):
        """Test downloader initialization."""
        assert self.downloader.progress_callback is not None
        assert self.downloader.cancel_event is not None
        assert self.downloader.config is not None
        assert isinstance(self.downloader.config, DownloadConfig)

    def test_emit_progress(self):
        """Test progress emission."""
        progress = DownloadProgress(
            stage=DownloadStage.DOWNLOADING,
            progress_percent=50.0,
            downloaded_bytes=100,
            total_bytes=200,
            speed_bytes_per_sec=10,
            eta_seconds=10,
            current_file="test.bin",
            message="Testing..."
        )

        self.downloader._emit_progress(progress)

        assert len(self.progress_updates) == 1
        assert self.progress_updates[0].stage == DownloadStage.DOWNLOADING

    def test_check_cancelled_not_cancelled(self):
        """Test check_cancelled when not cancelled."""
        # Should not raise
        self.downloader._check_cancelled()

    def test_check_cancelled_when_cancelled(self):
        """Test check_cancelled when cancelled."""
        self.cancel_event.set()

        with pytest.raises(DownloadCancelledException):
            self.downloader._check_cancelled()

    def test_check_disk_space_sufficient(self):
        """Test disk space check with sufficient space."""
        # Use a small requirement that should fit
        required_bytes = 1024 * 1024  # 1MB

        # Should not raise
        result = self.downloader._check_disk_space(required_bytes, self.temp_dir)
        assert result is True

    def test_check_disk_space_disabled(self):
        """Test disk space check when disabled."""
        self.downloader.config.check_disk_space = False

        # Should pass even with unrealistic size
        result = self.downloader._check_disk_space(
            1024**4,  # 1TB
            self.temp_dir
        )
        assert result is True

    def test_calculate_sha256(self):
        """Test SHA256 checksum calculation."""
        # Create test file with known content
        test_file = os.path.join(self.temp_dir, "test.bin")
        test_content = b"Hello, World! This is a test file for checksum verification."

        with open(test_file, "wb") as f:
            f.write(test_content)

        # Calculate expected checksum
        expected_hash = hashlib.sha256(test_content).hexdigest()

        # Test the method
        actual_hash = self.downloader._calculate_sha256(test_file)

        assert actual_hash == expected_hash

    def test_verify_checksum_valid(self):
        """Test checksum verification with valid checksum."""
        test_file = os.path.join(self.temp_dir, "test.bin")
        test_content = b"Test content for checksum verification"

        with open(test_file, "wb") as f:
            f.write(test_content)

        expected_checksum = hashlib.sha256(test_content).hexdigest()

        # Should not raise
        self.downloader._verify_checksum(test_file, expected_checksum)

    def test_verify_checksum_invalid(self):
        """Test checksum verification with invalid checksum."""
        test_file = os.path.join(self.temp_dir, "test.bin")
        with open(test_file, "wb") as f:
            f.write(b"Test content")

        with pytest.raises(ChecksumVerificationException):
            self.downloader._verify_checksum(test_file, "invalid_checksum_123456")

    def test_verify_checksum_disabled(self):
        """Test checksum verification when disabled."""
        self.downloader.config.verify_checksum = False

        test_file = os.path.join(self.temp_dir, "test.bin")
        with open(test_file, "wb") as f:
            f.write(b"Test content")

        # Should not raise even with invalid checksum
        self.downloader._verify_checksum(test_file, "invalid_checksum")

    def test_verify_checksum_no_expected(self):
        """Test checksum verification with no expected checksum."""
        test_file = os.path.join(self.temp_dir, "test.bin")
        with open(test_file, "wb") as f:
            f.write(b"Test content")

        # Should not raise when no checksum provided
        self.downloader._verify_checksum(test_file, None)

    def test_calculate_speed_and_eta(self):
        """Test speed and ETA calculation."""
        self.downloader._download_start_time = time.time()

        # Simulate some progress
        downloaded = 52428800  # 50MB
        total = 104857600  # 100MB

        # Wait a bit to get non-zero elapsed time
        time.sleep(0.1)

        speed, eta = self.downloader._calculate_speed_and_eta(downloaded, total)

        assert speed > 0
        assert eta > 0
        assert eta < total  # ETA should be reasonable

    def test_calculate_speed_and_eta_no_start_time(self):
        """Test speed calculation without start time."""
        self.downloader._download_start_time = None

        speed, eta = self.downloader._calculate_speed_and_eta(1024, 2048)

        assert speed == 0.0
        assert eta == 0.0

    def test_retry_with_backoff_success(self):
        """Test retry mechanism with immediate success."""
        def always_succeed():
            return "success"

        result = self.downloader._retry_with_backoff(always_succeed)

        assert result == "success"

    def test_retry_with_backoff_failure_then_success(self):
        """Test retry mechanism with failure then success."""
        attempt_count = [0]

        def fail_then_succeed():
            attempt_count[0] += 1
            if attempt_count[0] < 2:
                raise ValueError("Temporary failure")
            return "success"

        result = self.downloader._retry_with_backoff(fail_then_succeed)

        assert result == "success"
        assert attempt_count[0] == 2

    def test_retry_with_backoff_all_failures(self):
        """Test retry mechanism when all attempts fail."""
        def always_fail():
            raise ValueError("Permanent failure")

        with pytest.raises(DownloadFailedException) as exc_info:
            self.downloader._retry_with_backoff(always_fail)

        assert exc_info.value.retry_count == 3  # Default max_retries
        assert isinstance(exc_info.value.last_error, ValueError)

    def test_retry_with_backoff_cancellation(self):
        """Test retry mechanism respects cancellation."""
        self.cancel_event.set()

        def should_not_run():
            raise RuntimeError("Should not be called")

        with pytest.raises(DownloadCancelledException):
            self.downloader._retry_with_backoff(should_not_run)

    def test_safe_extract_tar_valid(self):
        """Test safe tar extraction with valid archive."""
        # Create a test tar file
        tar_path = os.path.join(self.temp_dir, "test.tar")
        test_file = os.path.join(self.temp_dir, "inner.txt")

        with open(test_file, "w") as f:
            f.write("Test content")

        with tarfile.open(tar_path, "w") as tar:
            tar.add(test_file, arcname="inner.txt")

        # Extract
        extract_dir = os.path.join(self.temp_dir, "extract")
        os.makedirs(extract_dir)

        with tarfile.open(tar_path, "r") as tar:
            self.downloader._safe_extract_tar(tar, extract_dir)

        # Verify extraction
        extracted_file = os.path.join(extract_dir, "inner.txt")
        assert os.path.exists(extracted_file)
        with open(extracted_file) as f:
            assert f.read() == "Test content"

    def test_safe_extract_tar_path_traversal(self):
        """Test safe tar extraction rejects path traversal attempts."""
        tar_path = os.path.join(self.temp_dir, "malicious.tar")

        # Create a tar file with path traversal
        with tarfile.open(tar_path, "w") as tar:
            # Add a file with absolute path (path traversal attempt)
            content = b"Malicious content"
            info = tarfile.TarInfo(name="../../../etc/passwd")
            info.size = len(content)
            tar.addfile(info, BytesIO(content))

        # Try to extract
        extract_dir = os.path.join(self.temp_dir, "extract")
        os.makedirs(extract_dir)

        with tarfile.open(tar_path, "r") as tar:
            with pytest.raises(ValueError, match="Path traversal"):
                self.downloader._safe_extract_tar(tar, extract_dir)

    def test_safe_extract_tar_skips_symlinks(self):
        """Test safe tar extraction skips symbolic links."""
        tar_path = os.path.join(self.temp_dir, "symlink.tar")

        # Create tar with symlink
        with tarfile.open(tar_path, "w") as tar:
            info = tarfile.TarInfo(name="link")
            info.type = tarfile.SYMTYPE
            info.linkname = "../../../etc/passwd"
            tar.addfile(info)

        extract_dir = os.path.join(self.temp_dir, "extract")
        os.makedirs(extract_dir)

        # Should not raise, just skip
        with tarfile.open(tar_path, "r") as tar:
            self.downloader._safe_extract_tar(tar, extract_dir)

        # Link should not exist
        assert not os.path.exists(os.path.join(extract_dir, "link"))


class TestDownloadFromURL:
    """Tests for URL download functionality."""

    def setup_method(self):
        """Setup test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.progress_updates = []
        self.cancel_event = threading.Event()

        def progress_callback(progress: DownloadProgress):
            self.progress_updates.append(progress)

        self.downloader = ModelDownloader(
            progress_callback=progress_callback,
            cancel_event=self.cancel_event,
        )

    def teardown_method(self):
        """Cleanup test fixtures."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    @patch('downloader.requests.get')
    def test_download_file_success(self, mock_get):
        """Test successful file download."""
        # Mock response
        mock_response = Mock()
        mock_response.headers = {
            'Content-Length': '100',
            'Content-Range': None
        }
        mock_response.raise_for_status = Mock()
        mock_response.iter_content = lambda chunk_size: [b'a' * 50, b'b' * 50]
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_get.return_value = mock_response

        target_path = os.path.join(self.temp_dir, "test.bin")

        result = self.downloader._download_file_with_resume(
            "https://github.com/test/file.bin",
            target_path,
            expected_size=100
        )

        assert result == 100
        assert os.path.exists(target_path)
        assert os.path.getsize(target_path) == 100

    @patch('downloader.requests.get')
    def test_download_file_with_resume(self, mock_get):
        """Test file download resume capability."""
        # Create partial file
        partial_path = os.path.join(self.temp_dir, "partial.bin")
        with open(partial_path, "wb") as f:
            f.write(b'a' * 50)  # 50 bytes already downloaded

        # Mock response with range request support
        mock_response = Mock()
        mock_response.headers = {
            'Content-Length': '50',  # Remaining bytes
            'Content-Range': 'bytes 50-99/100'  # 50-99, total 100
        }
        mock_response.raise_for_status = Mock()
        mock_response.iter_content = lambda chunk_size: [b'b' * 50]
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_get.return_value = mock_response

        # Download with resume
        result = self.downloader._download_file_with_resume(
            "https://github.com/test/file.bin",
            partial_path,
            expected_size=100
        )

        assert result == 100
        assert os.path.exists(partial_path)
        assert os.path.getsize(partial_path) == 100

        # Verify range header was used
        assert mock_get.call_count == 1
        call_kwargs = mock_get.call_args[1]
        assert 'Range' in call_kwargs['headers']
        assert call_kwargs['headers']['Range'] == 'bytes=50-'

    def test_download_url_invalid_host(self):
        """Test URL validation rejects non-whitelisted hosts."""
        with pytest.raises(ValueError, match="not in whitelist"):
            self.downloader.download_from_url(
                "https://malicious.com/file.bin",
                self.temp_dir
            )

    @patch('downloader.ModelDownloader._download_file_with_resume')
    def test_download_from_url_simple(self, mock_download):
        """Test simple URL download."""
        mock_download.return_value = 1024

        result = self.downloader.download_from_url(
            "https://github.com/test/file.bin",
            self.temp_dir
        )

        assert result.endswith("file.bin")
        mock_download.assert_called_once()

    @patch('downloader.ModelDownloader._download_file_with_resume')
    def test_download_from_url_with_checksum(self, mock_download):
        """Test download with checksum verification."""
        mock_download.return_value = 1024

        # Create a test file
        test_file = os.path.join(self.temp_dir, "test.bin")
        with open(test_file, "wb") as f:
            f.write(b"x" * 1024)

        checksum = hashlib.sha256(b"x" * 1024).hexdigest()

        result = self.downloader.download_from_url(
            "https://github.com/test/file.bin",
            self.temp_dir,
            checksum=checksum
        )

        # Should succeed with valid checksum
        mock_download.assert_called_once()

    @patch('downloader.ModelDownloader._download_file_with_resume')
    def test_download_from_url_invalid_checksum(self, mock_download):
        """Test download with invalid checksum fails."""
        mock_download.return_value = 1024

        # Create a test file
        test_file = os.path.join(self.temp_dir, "test.bin")
        with open(test_file, "wb") as f:
            f.write(b"x" * 1024)

        with pytest.raises(ChecksumVerificationException):
            self.downloader.download_from_url(
                "https://github.com/test/file.bin",
                self.temp_dir,
                checksum="invalid_checksum"
            )


class TestDownloadFromHuggingFace:
    """Tests for HuggingFace Hub download functionality."""

    def setup_method(self):
        """Setup test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.progress_updates = []
        self.cancel_event = threading.Event()

        def progress_callback(progress: DownloadProgress):
            self.progress_updates.append(progress)

        self.downloader = ModelDownloader(
            progress_callback=progress_callback,
            cancel_event=self.cancel_event,
        )

    def teardown_method(self):
        """Cleanup test fixtures."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    @patch('downloader.snapshot_download')
    @patch('downloader.ModelMetadata')
    def test_download_from_huggingface_success(self, mock_metadata_class, mock_snapshot):
        """Test successful HuggingFace download."""
        # Mock metadata
        mock_metadata = Mock()
        mock_metadata.total_size_bytes = 104857600  # 100MB
        mock_metadata.requires_token = False

        # Mock snapshot_download
        mock_snapshot.return_value = self.temp_dir

        with patch('downloader.ModelMetadata.from_hf_api', return_value=mock_metadata):
            result = self.downloader.download_from_huggingface(
                repo_id="org/model",
                target_dir=self.temp_dir,
                model_name="test-model"
            )

        assert result == self.temp_dir
        mock_snapshot.assert_called_once()

    def test_download_from_huggingface_cancelled(self):
        """Test HuggingFace download cancellation."""
        self.cancel_event.set()

        with pytest.raises(DownloadCancelledException):
            self.downloader.download_from_huggingface(
                repo_id="org/model",
                target_dir=self.temp_dir
            )


class TestConvenienceFunctions:
    """Tests for convenience functions."""

    def setup_method(self):
        """Setup test fixtures."""
        self.temp_dir = tempfile.mkdtemp()

    def teardown_method(self):
        """Cleanup test fixtures."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    @patch('downloader.ModelDownloader.download_from_huggingface')
    def test_download_model_convenience(self, mock_download):
        """Test download_model convenience function."""
        mock_download.return_value = self.temp_dir

        result = download_model(
            repo_id="org/model",
            target_dir=self.temp_dir
        )

        assert result == self.temp_dir
        mock_download.assert_called_once()

    @patch('downloader.ModelDownloader.download_from_url')
    def test_download_from_url_convenience(self, mock_download):
        """Test download_from_url convenience function."""
        mock_download.return_value = self.temp_dir

        result = download_from_url(
            url="https://github.com/test/file.bin",
            target_dir=self.temp_dir
        )

        assert result == self.temp_dir
        mock_download.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
