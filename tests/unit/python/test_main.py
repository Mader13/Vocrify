"""
Unit tests for ai-engine/main.py

This test module covers:
- JSON validation and security
- Path traversal prevention
- Model name validation
- Language validation
- URL validation
- Safe file extraction
- Cache directory validation
- Command-line argument parsing
"""
import json
import os
import pytest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import sys

# Add ai-engine to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "ai-engine"))

from main import (
    safe_json_loads,
    check_json_depth,
    validate_model_name,
    validate_language,
    validate_url,
    safe_extract,
    safe_join,
    validate_cache_dir,
    emit_progress,
    emit_result,
    emit_error,
    get_model_size_mb,
    parse_args,
    SUPPORTED_LANGUAGES,
    VALID_MODEL_NAME,
    ALLOWED_HOSTS,
    MAX_JSON_SIZE,
    MAX_JSON_DEPTH,
)


class TestJSONValidation:
    """Test JSON security and validation."""

    def test_valid_json_transcribe_command(self):
        """Test parsing valid transcribe command."""
        valid_json = json.dumps({
            "type": "transcribe",
            "file": "/path/to/audio.mp3",
            "model": "whisper-base",
            "device": "cpu",
            "language": "en",
            "taskId": "test-123"
        })
        result = safe_json_loads(valid_json)
        assert result["type"] == "transcribe"
        assert result["file"] == "/path/to/audio.mp3"

    def test_valid_json_ping_command(self):
        """Test parsing valid ping command."""
        valid_json = json.dumps({"type": "ping"})
        result = safe_json_loads(valid_json)
        assert result["type"] == "ping"

    def test_json_size_limit_enforcement(self):
        """Test that oversized JSON is rejected."""
        # Create JSON larger than MAX_JSON_SIZE (10MB)
        oversized = json.dumps({
            "type": "transcribe",
            "file": "/path/to/audio.mp3",
            "data": "x" * (11 * 1024 * 1024)  # 11MB
        })
        with pytest.raises(ValueError, match="payload size.*exceeds maximum"):
            safe_json_loads(oversized)

    def test_json_depth_limit_enforcement(self):
        """Test that deeply nested JSON is rejected."""
        # Create JSON deeper than MAX_JSON_DEPTH (100)
        deep_json = {"type": "transcribe", "file": "/path/to/audio.mp3"}
        current = deep_json
        for _ in range(150):  # Exceed limit
            current["nested"] = {}
            current = current["nested"]

        json_str = json.dumps(deep_json)
        with pytest.raises(ValueError, match="nesting depth exceeds maximum"):
            safe_json_loads(json_str)

    def test_json_missing_required_field(self):
        """Test rejection when required field is missing."""
        invalid_json = json.dumps({
            "type": "transcribe"
            # Missing 'file' field
        })
        with pytest.raises(ValueError, match="missing required field"):
            safe_json_loads(invalid_json)

    def test_json_invalid_type_field(self):
        """Test rejection of invalid command type."""
        invalid_json = json.dumps({
            "type": "malicious_command",
            "file": "/path/to/audio.mp3"
        })
        with pytest.raises(ValueError, match="Unknown command type"):
            safe_json_loads(invalid_json)

    def test_json_wrong_field_type(self):
        """Test rejection when field has wrong type."""
        invalid_json = json.dumps({
            "type": "transcribe",
            "file": "/path/to/audio.mp3",
            "diarization": "true"  # Should be boolean
        })
        with pytest.raises(ValueError, match="must be of type bool"):
            safe_json_loads(invalid_json)

    def test_json_malformed_syntax(self):
        """Test rejection of malformed JSON."""
        malformed = '{"type": "transcribe", "file": /path/to/audio.mp3}'
        with pytest.raises(ValueError, match="Invalid JSON format"):
            safe_json_loads(malformed)


class TestPathSecurity:
    """Test path traversal and security validation."""

    def test_safe_join_within_directory(self, tmp_path):
        """Test safe_join with valid path."""
        base = tmp_path / "base"
        base.mkdir()
        result = safe_join(base, "subdir", "file.txt")
        assert str(result).startswith(str(base))

    def test_safe_join_prevents_path_traversal(self, tmp_path):
        """Test that safe_join blocks path traversal attacks."""
        base = tmp_path / "base"
        base.mkdir()

        # Test various traversal attempts
        traversal_attempts = [
            "../../etc/passwd",
            "..\\..\\..\\windows\\system32",
            "subdir/../../../etc/passwd",
            "./subdir/../../etc/passwd",
        ]

        for attempt in traversal_attempts:
            with pytest.raises(ValueError, match="Path traversal detected"):
                safe_join(base, attempt)

    def test_safe_join_normalizes_paths(self, tmp_path):
        """Test that safe_join normalizes paths correctly."""
        base = tmp_path / "base"
        base.mkdir()
        result = safe_join(base, "subdir", "..", "subdir", "file.txt")
        # Should resolve to base/subdir/file.txt
        assert "subdir" in str(result)
        assert str(result).startswith(str(base))

    def test_validate_model_name_valid(self):
        """Test validation of valid model names."""
        valid_names = [
            "whisper-tiny",
            "whisper-base",
            "whisper-large-v3",
            "sherpa-onnx-diarization",
            "sherpa-onnx-segmentation"
        ]
        for name in valid_names:
            result = validate_model_name(name)
            assert result == name

    def test_validate_model_name_invalid_characters(self):
        """Test rejection of model names with invalid characters."""
        invalid_names = [
            "whisper tiny",  # Space
            "whisper/tiny",  # Slash
            "whisper..tiny",  # Double dot
            "whisper/tiny@hack",  # Special chars
            "../../../etc/passwd",  # Path traversal
            "whisper-tiny; rm -rf /",  # Command injection
            "${malicious}",  # Variable expansion
        ]
        for name in invalid_names:
            with pytest.raises(ValueError, match="Invalid model name"):
                validate_model_name(name)

    def test_validate_url_valid_https(self):
        """Test acceptance of valid HTTPS URLs."""
        valid_urls = [
            "https://huggingface.co/model/repo",
            "https://github.com/user/repo/releases/download/v1/model.bin",
            "https://cdn-lfs.huggingface.co/repo/model.bin",
        ]
        for url in valid_urls:
            # Should not raise
            validate_url(url)

    def test_validate_url_blocks_http(self):
        """Test rejection of HTTP (non-HTTPS) URLs."""
        with pytest.raises(ValueError, match="scheme must be HTTPS"):
            validate_url("http://malicious.com/model.bin")

    def test_validate_url_blocks_untrusted_hosts(self):
        """Test rejection of URLs from untrusted hosts."""
        untrusted_urls = [
            "https://evil.com/model.bin",
            "https://suspicious-site.org/download",
            "https://192.168.1.1/malware.bin",
        ]
        for url in untrusted_urls:
            with pytest.raises(ValueError, match="not in the allowed list"):
                validate_url(url)

    def test_validate_url_detects_path_traversal(self):
        """Test detection of path traversal in URLs."""
        traversal_urls = [
            "https://github.com/../../../etc/passwd",
            "https://huggingface.co/..%2F..%2F..%2Fetc/passwd",
            "https://cdn-lfs.huggingface.co/../../sensitive/data",
        ]
        for url in traversal_urls:
            with pytest.raises(ValueError, match="Path traversal detected"):
                validate_url(url)

    def test_validate_url_detects_null_bytes(self):
        """Test detection of null byte injection."""
        null_byte_urls = [
            "https://github.com/model.bin%00.exe",
            "https://huggingface.co/repo\0x00/malicious",
        ]
        for url in null_byte_urls:
            with pytest.raises(ValueError, match="Null byte detected"):
                validate_url(url)


class TestSafeExtraction:
    """Test safe tar archive extraction."""

    def test_safe_extraction_prevents_traversal(self, tmp_path):
        """Test that safe extraction blocks path traversal in archives."""
        import tarfile
        import io

        # Create a malicious tar with path traversal
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            # Create a file with traversal attempt
            malicious = io.BytesIO(b"malicious content")
            info = tarfile.TarInfo(name="../../../etc/passwd")
            info.size = len(malicious.getvalue())
            tar.addfile(info, fileobj=malicious)

        buffer.seek(0)
        with tarfile.open(fileobj=buffer, mode="r") as tar:
            target_dir = str(tmp_path / "extract")
            with pytest.raises(ValueError, match="Path traversal detected"):
                safe_extract(tar, target_dir)

    def test_safe_extraction_rejects_symlinks(self, tmp_path):
        """Test that safe extraction rejects symlinks."""
        import tarfile
        import io

        # Create a tar with symlink
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            # Create a symlink outside target dir
            info = tarfile.TarInfo(name="safe_link")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            tar.addfile(info)

        buffer.seek(0)
        with tarfile.open(fileobj=buffer, mode="r") as tar:
            target_dir = str(tmp_path / "extract")
            with pytest.raises(ValueError, match="Symlinks are not allowed"):
                safe_extract(tar, target_dir)

    def test_safe_extraction_valid_archive(self, tmp_path):
        """Test that safe extraction works for valid archives."""
        import tarfile
        import io

        # Create a valid tar
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            content = io.BytesIO(b"safe content")
            info = tarfile.TarInfo(name="safe_file.txt")
            info.size = len(content.getvalue())
            tar.addfile(info, fileobj=content)

        buffer.seek(0)
        with tarfile.open(fileobj=buffer, mode="r") as tar:
            target_dir = str(tmp_path / "extract")
            os.makedirs(target_dir, exist_ok=True)
            safe_extract(tar, target_dir)

            # Verify file was extracted
            extracted_path = os.path.join(target_dir, "safe_file.txt")
            assert os.path.exists(extracted_path)
            with open(extracted_path, "rb") as f:
                assert f.read() == b"safe content"


class TestLanguageValidation:
    """Test language code validation."""

    def test_valid_language_codes(self):
        """Test acceptance of valid language codes."""
        valid_languages = ["en", "es", "fr", "de", "auto", "ru", "zh", "ja"]
        for lang in valid_languages:
            result = validate_language(lang)
            assert result == lang

    def test_auto_language(self):
        """Test that 'auto' is accepted for auto-detection."""
        result = validate_language("auto")
        assert result == "auto"

    def test_numeric_language_id(self):
        """Test that numeric language IDs are accepted."""
        result = validate_language("0")
        assert result == "0"

    def test_invalid_language_code(self):
        """Test rejection of unsupported language codes."""
        invalid_languages = ["xx", "zz", "klingon", "12345"]
        for lang in invalid_languages:
            with pytest.raises(ValueError, match="Unsupported language"):
                validate_language(lang)


class TestCacheValidation:
    """Test cache directory validation."""

    def test_cache_dir_creates_if_missing(self, tmp_path):
        """Test that cache directory is created if it doesn't exist."""
        cache_dir = str(tmp_path / "new_cache")
        assert not os.path.exists(cache_dir)
        result = validate_cache_dir(cache_dir)
        assert result is True
        assert os.path.exists(cache_dir)

    def test_cache_dir_writable(self, tmp_path):
        """Test that cache directory must be writable."""
        cache_dir = str(tmp_path / "writable_cache")
        os.makedirs(cache_dir)
        result = validate_cache_dir(cache_dir)
        assert result is True

    def test_cache_dir_not_writable(self, tmp_path):
        """Test failure when cache directory is not writable."""
        cache_dir = str(tmp_path / "readonly_cache")
        os.makedirs(cache_dir)
        # Make directory read-only (Unix)
        original_mode = os.stat(cache_dir).st_mode
        try:
            os.chmod(cache_dir, 0o444)
            result = validate_cache_dir(cache_dir)
            assert result is False
        finally:
            # Restore permissions for cleanup
            os.chmod(cache_dir, original_mode)

    def test_cache_dir_invalid_path(self):
        """Test failure when cache directory path is invalid."""
        # Try to use a path inside a file
        with tempfile.NamedTemporaryFile() as f:
            invalid_dir = os.path.join(f.name, "subdir")
            result = validate_cache_dir(invalid_dir)
            assert result is False


class TestEmissionFunctions:
    """Test stdout emission functions."""

    def test_emit_progress_format(self, capsys):
        """Test that emit_progress outputs correct JSON format."""
        emit_progress("loading", 50, "Loading model...")
        captured = capsys.readouterr()
        output = json.loads(captured.out.strip())

        assert output["type"] == "progress"
        assert output["data"]["stage"] == "loading"
        assert output["data"]["progress"] == 50
        assert output["data"]["message"] == "Loading model..."

    def test_emit_result_format(self, capsys):
        """Test that emit_result outputs correct JSON format."""
        segments = [
            {"start": 0.0, "end": 2.5, "text": "Hello world", "speaker": "SPEAKER_00"}
        ]
        emit_result(segments)
        captured = capsys.readouterr()
        output = json.loads(captured.out.strip())

        assert output["type"] == "result"
        assert len(output["segments"]) == 1
        assert output["segments"][0]["text"] == "Hello world"

    def test_emit_error_format(self, capsys):
        """Test that emit_error outputs correct JSON format."""
        emit_error("Test error message")
        captured = capsys.readouterr()
        output = json.loads(captured.out.strip())

        assert output["type"] == "error"
        assert output["error"] == "Test error message"


class TestModelSizeCalculation:
    """Test model size calculation."""

    def test_get_model_size_empty_directory(self, tmp_path):
        """Test size calculation for empty directory."""
        size = get_model_size_mb(str(tmp_path))
        assert size == 0

    def test_get_model_size_with_files(self, tmp_path):
        """Test size calculation with actual files."""
        # Create test files
        (tmp_path / "file1.bin").write_bytes(b"x" * (1024 * 1024))  # 1MB
        (tmp_path / "file2.bin").write_bytes(b"x" * (2 * 1024 * 1024))  # 2MB
        (tmp_path / "file3.bin").write_bytes(b"x" * (500 * 1024))  # 500KB

        size = get_model_size_mb(str(tmp_path))
        # Should be ~3MB (1 + 2 + 0.5), rounded down
        assert size >= 3
        assert size < 4


class TestArgumentParsing:
    """Test command-line argument parsing."""

    def test_parse_args_default_values(self):
        """Test parsing with default values."""
        with patch.object(sys, 'argv', ['main.py', '--file', 'test.mp3']):
            args = parse_args()
            assert args.file == 'test.mp3'
            assert args.model == 'whisper-base'
            assert args.device == 'cpu'
            assert args.language == 'auto'
            assert args.diarization is False

    def test_parse_args_with_all_options(self):
        """Test parsing with all options specified."""
        with patch.object(sys, 'argv', [
            'main.py',
            '--file', 'test.mp3',
            '--model', 'whisper-large-v3',
            '--device', 'cuda',
            '--language', 'en',
            '--diarization',
            '--diarization-provider', 'sherpa-onnx',
            '--num-speakers', '2'
        ]):
            args = parse_args()
            assert args.model == 'whisper-large-v3'
            assert args.device == 'cuda'
            assert args.language == 'en'
            assert args.diarization is True
            assert args.diarization_provider == 'sherpa-onnx'
            assert args.num_speakers == 2

    def test_parse_args_download_mode(self):
        """Test parsing for download mode."""
        with patch.object(sys, 'argv', [
            'main.py',
            '--download-model', 'whisper-base',
            '--cache-dir', '/tmp/models',
            '--model-type', 'whisper'
        ]):
            args = parse_args()
            assert args.download_model == 'whisper-base'
            assert args.cache_dir == '/tmp/models'
            assert args.model_type == 'whisper'

    def test_parse_args_server_mode(self):
        """Test parsing for server mode."""
        with patch.object(sys, 'argv', ['main.py', '--server']):
            args = parse_args()
            assert args.server is True

    def test_parse_args_test_mode(self):
        """Test parsing for test mode."""
        with patch.object(sys, 'argv', ['main.py', '--test']):
            args = parse_args()
            assert args.test is True


@pytest.mark.parametrize("model_name,should_be_valid", [
    ("whisper-tiny", True),
    ("whisper-base", True),
    ("whisper-small", True),
    ("whisper-medium", True),
    ("whisper-large-v3", True),
    ("sherpa-onnx-diarization", True),
    ("sherpa-onnx-segmentation", True),
    ("whisper tiny", False),  # Space not allowed
    ("whisper/tiny", False),  # Slash not allowed
    ("../../../etc/passwd", False),  # Path traversal
])
def test_model_name_validation_parametrized(model_name, should_be_valid):
    """Parametrized test for model name validation."""
    if should_be_valid:
        result = validate_model_name(model_name)
        assert result == model_name
    else:
        with pytest.raises(ValueError):
            validate_model_name(model_name)


@pytest.mark.parametrize("json_input,should_be_valid,error_match", [
    ('{"type": "ping"}', True, None),
    ('{"type": "transcribe", "file": "test.mp3"}', True, None),
    ('{"type": "unknown"}', False, "Unknown command type"),
    ('{"file": "test.mp3"}', False, "missing required field"),
    ('not json at all', False, "Invalid JSON format"),
])
def test_json_validation_parametrized(json_input, should_be_valid, error_match):
    """Parametrized test for JSON validation."""
    if should_be_valid:
        result = safe_json_loads(json_input)
        assert isinstance(result, dict)
    else:
        with pytest.raises(ValueError, match=error_match):
            safe_json_loads(json_input)
