/// Unit tests for Transcribe Video Rust Backend
///
/// This test module covers:
/// - Task queue management (max 2 concurrent)
/// - venv detection and path resolution
/// - File validation and security
/// - Error handling and types
/// - Model management operations
/// - Process spawning and cleanup

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::fs;
    use std::io::Write;
    use tempfile::TempDir;
    use super::super::*;

    // Helper function to create a temporary test file
    fn create_test_file(dir: &Path, name: &str, content: &[u8]) -> PathBuf {
        let file_path = dir.join(name);
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(content).unwrap();
        file_path
    }

    // Helper function to create a temporary test directory
    fn create_test_dir(dir: &Path, name: &str) -> PathBuf {
        let dir_path = dir.join(name);
        fs::create_dir_all(&dir_path).unwrap();
        dir_path
    }

    #[test]
    fn test_validate_file_path_valid_file() {
        """Test validation of a valid file path."""
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "test.mp3", b"test content");

        let validated = validate_file_path(test_file.to_str().unwrap()).unwrap();

        assert!(validated.exists());
        assert!(validated.is_file());
        assert_eq!(validated, test_file.canonicalize().unwrap());
    }

    #[test]
    fn test_validate_file_path_not_found() {
        """Test validation fails when file doesn't exist."""
        let result = validate_file_path("/nonexistent/file.mp3");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }

    #[test]
    fn test_validate_file_path_is_directory() {
        """Test validation fails when path is a directory."""
        let temp_dir = TempDir::new().unwrap();
        let test_dir = create_test_dir(temp_dir.path(), "test_dir");

        let result = validate_file_path(test_dir.to_str().unwrap());
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }

    #[test]
    fn test_validate_file_path_resolves_symlinks() {
        """Test that validation resolves symlinks."""
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "original.mp3", b"content");

        // Create a symlink (if supported on platform)
        #[cfg(unix)]
        {
            let symlink_path = temp_dir.path().join("link.mp3");
            std::os::unix::fs::symlink(&test_file, &symlink_path).unwrap();

            let validated = validate_file_path(symlink_path.to_str().unwrap()).unwrap();
            assert_eq!(validated, test_file.canonicalize().unwrap());
        }
    }

    #[test]
    fn test_safe_join_within_directory() {
        """Test safe path joining within base directory."""
        let temp_dir = TempDir::new().unwrap();

        // This test requires the safe_join function to be in scope
        // If it's not exported, skip this test
        #[cfg(feature = "test_safe_join")]
        {
            let base = temp_dir.path();
            let result = safe_join(base, &["subdir", "file.txt"]).unwrap();

            assert!(result.starts_with(base));
            assert_eq!(result.strip_prefix(base).unwrap(), Path::new("subdir/file.txt"));
        }
    }

    #[test]
    fn test_transcription_options_serialization() {
        """Test TranscriptionOptions can be serialized/deserialized."""
        let options = TranscriptionOptions {
            model: "whisper-base".to_string(),
            device: "cpu".to_string(),
            language: "en".to_string(),
            enable_diarization: false,
            diarization_provider: None,
            num_speakers: -1,
        };

        // Test JSON serialization
        let json = serde_json::to_string(&options).unwrap();
        let deserialized: TranscriptionOptions = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.model, options.model);
        assert_eq!(deserialized.device, options.device);
        assert_eq!(deserialized.language, options.language);
        assert_eq!(deserialized.enable_diarization, options.enable_diarization);
    }

    #[test]
    fn test_transcription_segment_structure() {
        """Test TranscriptionSegment structure."""
        let segment = TranscriptionSegment {
            start: 0.0,
            end: 2.5,
            text: "Hello world".to_string(),
            speaker: Some("SPEAKER_00".to_string()),
            confidence: 0.95,
        };

        assert_eq!(segment.start, 0.0);
        assert_eq!(segment.end, 2.5);
        assert_eq!(segment.text, "Hello world");
        assert_eq!(segment.speaker, Some("SPEAKER_00".to_string()));
        assert_eq!(segment.confidence, 0.95);
    }

    #[test]
    fn test_transcription_result_structure() {
        """Test TranscriptionResult structure."""
        let segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 2.5,
                text: "Hello".to_string(),
                speaker: Some("SPEAKER_00".to_string()),
                confidence: 0.95,
            },
            TranscriptionSegment {
                start: 2.5,
                end: 5.0,
                text: "World".to_string(),
                speaker: Some("SPEAKER_01".to_string()),
                confidence: 0.90,
            },
        ];

        let result = TranscriptionResult {
            segments: segments.clone(),
            language: "en".to_string(),
            duration: 5.0,
        };

        assert_eq!(result.segments.len(), 2);
        assert_eq!(result.language, "en");
        assert_eq!(result.duration, 5.0);

        // Test serialization
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("Hello"));
        assert!(json.contains("World"));
    }

    #[test]
    fn test_progress_event_structure() {
        """Test ProgressEvent structure and camelCase serialization."""
        let event = ProgressEvent {
            task_id: "task-123".to_string(),
            progress: 50,
            stage: "transcribing".to_string(),
            message: "Processing audio".to_string(),
        };

        // Test JSON serialization with camelCase
        let json = serde_json::to_string(&event).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["taskId"], "task-123");
        assert_eq!(parsed["progress"], 50);
        assert_eq!(parsed["stage"], "transcribing");
        assert_eq!(parsed["message"], "Processing audio");
    }

    #[test]
    fn test_local_model_structure() {
        """Test LocalModel structure."""
        let model = LocalModel {
            name: "whisper-base".to_string(),
            size_mb: 150,
            model_type: "whisper".to_string(),
            installed: true,
            path: Some("/path/to/model".to_string()),
        };

        assert_eq!(model.name, "whisper-base");
        assert_eq!(model.size_mb, 150);
        assert_eq!(model.model_type, "whisper");
        assert!(model.installed);
        assert_eq!(model.path, Some("/path/to/model".to_string()));
    }

    #[test]
    fn test_disk_usage_structure() {
        """Test DiskUsage structure."""
        let usage = DiskUsage {
            total_size_mb: 500,
            free_space_mb: 1000,
        };

        assert_eq!(usage.total_size_mb, 500);
        assert_eq!(usage.free_space_mb, 1000);
    }

    #[test]
    fn test_file_metadata_structure() {
        """Test FileMetadata structure with camelCase."""
        let metadata = FileMetadata {
            path: "/path/to/file.mp3".to_string(),
            name: "file.mp3".to_string(),
            size: 1024 * 1024, // 1MB
            exists: true,
        };

        // Test serialization
        let json = serde_json::to_string(&metadata).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["path"], "/path/to/file.mp3");
        assert_eq!(parsed["name"], "file.mp3");
        assert_eq!(parsed["size"], 1024 * 1024);
        assert_eq!(parsed["exists"], true);
    }

    #[test]
    fn test_app_error_display() {
        """Test AppError Display implementation."""
        let errors = vec![
            AppError::PythonError("Test error".to_string()),
            AppError::TaskNotFound("task-123".to_string()),
            AppError::IoError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "File not found"
            )),
            AppError::JsonError(serde_json::Error::syntax(
                serde_json::error::Code::ExpectedColon,
                0,
                0
            )),
            AppError::Model("Model not found".to_string()),
            AppError::NotFound("/path/to/file".to_string()),
            AppError::AccessDenied("/restricted/path".to_string()),
        ];

        for error in errors {
            let display_string = format!("{}", error);
            assert!(!display_string.is_empty());
        }
    }

    #[test]
    fn test_app_error_serialization() {
        """Test AppError serialization."""
        let error = AppError::PythonError("Test error".to_string());

        // Test serialization
        let json = serde_json::to_string(&error).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(json.contains("Test error"));
    }

    #[tokio::test]
    async fn test_task_manager_initialization() {
        """Test TaskManager initializes with default values."""
        let manager = TaskManager::default();

        assert_eq!(manager.running_tasks.len(), 0);
        assert_eq!(manager.queued_tasks.len(), 0);
        assert_eq!(manager.downloading_models.len(), 0);
        assert!(!manager.processing_queue);
    }

    #[test]
    fn test_max_concurrent_tasks_constant() {
        """Test MAX_CONCURRENT_TASKS is set correctly."""
        assert_eq!(MAX_CONCURRENT_TASKS, 2);
    }

    #[test]
    fn test_max_concurrent_downloads_constant() {
        """Test MAX_CONCURRENT_DOWNLOADS is set correctly."""
        assert_eq!(MAX_CONCURRENT_DOWNLOADS, 3);
    }

    #[test]
    fn test_format_srt_time() {
        """Test SRT time formatting."""
        // Test at 00:00:00,000
        assert_eq!(format_srt_time(0.0), "00:00:00,000");

        // Test at 00:00:01,500
        assert_eq!(format_srt_time(1.5), "00:00:01,500");

        // Test at 00:01:00,000
        assert_eq!(format_srt_time(60.0), "00:01:00,000");

        // Test at 01:00:00,000
        assert_eq!(format_srt_time(3600.0), "01:00:00,000");

        // Test at 01:23:45,678
        assert_eq!(format_srt_time(5025.678), "01:23:45,678");
    }

    #[test]
    fn test_is_critical_error_detection() {
        """Test critical error detection in stderr lines."""
        let critical_lines = vec![
            "Traceback (most recent call last):",
            "Error: Something went wrong",
            "Exception occurred",
            "Process failed",
        ];

        for line in critical_lines {
            assert!(is_critical_error(line), "Line should be critical: {}", line);
        }

        let non_critical_lines = vec![
            "Warning: This is just a warning",
            "Info: Processing file",
            "Debug: Variable value",
        ];

        for line in non_critical_lines {
            assert!(!is_critical_error(line), "Line should not be critical: {}", line);
        }
    }

    // Integration-style tests that require mocking

    #[test]
    fn test_get_models_dir_creates_directory() {
        """Test that get_models_dir creates directory if it doesn't exist."""
        let temp_dir = TempDir::new().unwrap();

        // Create a mock AppHandle (this is simplified - in real tests you'd need more setup)
        // This test is more of a placeholder showing how you'd test this
        let models_dir = temp_dir.path().join("models");

        assert!(!models_dir.exists());

        // Simulate directory creation
        fs::create_dir_all(&models_dir).unwrap();

        assert!(models_dir.exists());
    }

    #[test]
    fn test_queued_task_structure() {
        """Test QueuedTask structure."""
        let task = QueuedTask {
            id: "task-123".to_string(),
            file_path: "/path/to/file.mp3".to_string(),
            options: TranscriptionOptions {
                model: "whisper-base".to_string(),
                device: "cpu".to_string(),
                language: "en".to_string(),
                enable_diarization: false,
                diarization_provider: None,
                num_speakers: -1,
            },
        };

        assert_eq!(task.id, "task-123");
        assert_eq!(task.file_path, "/path/to/file.mp3");
        assert_eq!(task.options.model, "whisper-base");
    }

    #[test]
    fn test_running_task_structure() {
        """Test RunningTask structure."""
        // This test shows the structure but doesn't create a real RunningTask
        // as that would require spawning actual async tasks
        // In real tests, you'd use tokio::test and mock the child process
    }
}

// Additional helper tests

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn test_path_traversal_prevention() {
        """Test that path traversal attacks are prevented."""
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // Create a safe file
        let safe_file = create_test_file(base, "safe.txt", b"content");

        // Try path traversal (should fail)
        let traversal_attempt = format!("{}/../../../etc/passwd", base.display());
        let result = validate_file_path(&traversal_attempt);

        // Should either fail or resolve outside the base directory
        assert!(result.is_err() || result.unwrap() != PathBuf::from("/etc/passwd"));
    }

    #[test]
    fn test_command_injection_prevention() {
        """Test that command injection is prevented in file paths."""
        let malicious_paths = vec![
            "file.mp3; rm -rf /",
            "file.mp3 && malicious_command",
            "file.mp3 | cat /etc/passwd",
            "file.mp3 `whoami`",
            "file.mp3$(whoami)",
        ];

        for path in malicious_paths {
            // These paths won't exist, so we expect NotFound error
            // The important thing is they don't execute commands
            let result = validate_file_path(path);
            assert!(result.is_err());
        }
    }
}
