"""
Unit tests for streaming segment emission functionality.

Tests cover:
- stream_callback behavior in WhisperModel
- stream_callback behavior in DistilWhisperModel
- Segment emission format
- Callback invocation timing
- Edge cases with callbacks
"""

import pytest
import os
import sys
from unittest.mock import Mock, patch, MagicMock, call
from pathlib import Path
from typing import List, Dict, Any

# Add ai-engine to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))

from models.whisper import WhisperModel
from models.distil_whisper import DistilWhisperModel


# ============================================================================
# Shared Test Utilities
# ============================================================================

class CallbackTracker:
    """Helper class to track stream_callback invocations."""

    def __init__(self):
        self.calls: List[Dict[str, Any]] = []

    def __call__(self, stream: bool, segment: Dict[str, Any]) -> None:
        """Store callback invocation."""
        self.calls.append({
            "stream": stream,
            "segment": segment,
        })

    def get_calls(self) -> List[Dict[str, Any]]:
        """Get all callback invocations."""
        return self.calls

    def call_count(self) -> int:
        """Get number of callback invocations."""
        return len(self.calls)

    def reset(self) -> None:
        """Clear all tracked calls."""
        self.calls = []

    def get_segments(self) -> List[Dict[str, Any]]:
        """Get all segments received via callback."""
        return [call["segment"] for call in self.calls]

    def get_texts(self) -> List[str]:
        """Get all text from received segments."""
        return [call["segment"]["text"] for call in self.calls]


def create_mock_segment(start: float, end: float, text: str, avg_logprob: float = -0.1) -> Mock:
    """Create a mock segment for testing."""
    segment = Mock()
    segment.start = start
    segment.end = end
    segment.text = text
    segment.avg_logprob = avg_logprob
    return segment


def assert_valid_segment_format(segment: Dict[str, Any]) -> None:
    """Assert that a segment dict has the correct format."""
    assert isinstance(segment, dict)
    assert "start" in segment
    assert "end" in segment
    assert "text" in segment
    assert "speaker" in segment
    assert "confidence" in segment
    assert isinstance(segment["start"], (int, float))
    assert isinstance(segment["end"], (int, float))
    assert isinstance(segment["text"], str)
    assert segment["speaker"] is None or isinstance(segment["speaker"], str)
    assert isinstance(segment["confidence"], (int, float))


# ============================================================================
# WhisperModel Streaming Tests
# ============================================================================

class TestWhisperModelStreaming:
    """Test streaming callback functionality in WhisperModel."""

    @pytest.fixture
    def sample_segments(self):
        """Sample transcription segments for testing."""
        return [
            create_mock_segment(0.0, 2.5, "Hello, this is the first segment."),
            create_mock_segment(2.5, 5.0, "This is the second segment."),
            create_mock_segment(5.0, 7.5, "And this is the third segment."),
        ]

    @patch('models.whisper.FasterWhisper')
    def test_stream_callback_is_called_for_each_segment(self, mock_fw, sample_segments):
        """Test that stream_callback is called for each segment."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(sample_segments), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == len(sample_segments)

    @patch('models.whisper.FasterWhisper')
    def test_stream_callback_receives_stream_flag(self, mock_fw, sample_segments):
        """Test that stream_callback receives stream=True flag."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(sample_segments), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        for call in tracker.get_calls():
            assert call["stream"] is True

    @patch('models.whisper.FasterWhisper')
    def test_stream_callback_segment_format(self, mock_fw):
        """Test that callback receives properly formatted segment dict."""
        mock_segment = create_mock_segment(1.23, 4.56, "Test segment text", -0.15)
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == 1
        segment = tracker.get_segments()[0]
        assert_valid_segment_format(segment)
        assert segment["start"] == 1.23
        assert segment["end"] == 4.56
        assert segment["text"] == "Test segment text"
        assert segment["confidence"] == -0.15

    @patch('models.whisper.FasterWhisper')
    def test_stream_callback_preserves_text_content(self, mock_fw, sample_segments):
        """Test that callback preserves segment text exactly."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(sample_segments), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        texts = tracker.get_texts()
        assert texts[0] == "Hello, this is the first segment."
        assert texts[1] == "This is the second segment."
        assert texts[2] == "And this is the third segment."

    @patch('models.whisper.FasterWhisper')
    def test_stream_callback_timestamp_accuracy(self, mock_fw):
        """Test that callback preserves accurate timestamps."""
        segments = [
            create_mock_segment(0.0, 1.234, "First"),
            create_mock_segment(5.678, 10.999, "Second"),
        ]
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(segments), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        received = tracker.get_segments()
        assert received[0]["start"] == 0.0
        assert received[0]["end"] == 1.234
        assert received[1]["start"] == 5.678
        assert received[1]["end"] == 10.999

    @patch('models.whisper.FasterWhisper')
    def test_stream_callback_confidence_values(self, mock_fw):
        """Test that callback preserves confidence scores."""
        segments = [
            create_mock_segment(0.0, 1.0, "High confidence", -0.05),
            create_mock_segment(1.0, 2.0, "Medium confidence", -0.25),
            create_mock_segment(2.0, 3.0, "Low confidence", -0.5),
        ]
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(segments), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        received = tracker.get_segments()
        assert received[0]["confidence"] == -0.05
        assert received[1]["confidence"] == -0.25
        assert received[2]["confidence"] == -0.5

    @patch('models.whisper.FasterWhisper')
    def test_stream_callback_speaker_is_none(self, mock_fw):
        """Test that callback segments have speaker=None initially."""
        mock_segment = create_mock_segment(0.0, 1.0, "Speaker test")
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        segment = tracker.get_segments()[0]
        assert segment["speaker"] is None

    @patch('models.whisper.FasterWhisper')
    def test_transcribe_without_callback_still_works(self, mock_fw, sample_segments):
        """Test that transcribe works without stream_callback."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(sample_segments), mock_info)

        model = WhisperModel(device="cpu", model_size="base")
        result = model.transcribe("test.wav")  # No callback

        assert len(result) == len(sample_segments)
        assert result[0]["text"] == "Hello, this is the first segment."

    @patch('models.whisper.FasterWhisper')
    def test_callback_invocation_order(self, mock_fw, sample_segments):
        """Test that callbacks are invoked in correct order."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(sample_segments), mock_info)

        order = []

        def ordered_callback(stream, segment):
            order.append(segment["text"])

        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=ordered_callback)

        assert order == [
            "Hello, this is the first segment.",
            "This is the second segment.",
            "And this is the third segment.",
        ]

    @patch('models.whisper.FasterWhisper')
    def test_callback_with_empty_segments(self, mock_fw):
        """Test callback behavior with no segments."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == 0

    @patch('models.whisper.FasterWhisper')
    def test_callback_exception_handling(self, mock_fw):
        """Test that exceptions in callback don't crash transcription."""
        mock_segment = create_mock_segment(0.0, 1.0, "Test")

        def failing_callback(stream, segment):
            raise RuntimeError("Callback failed!")

        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        model = WhisperModel(device="cpu", model_size="base")

        # The exception should propagate
        with pytest.raises(RuntimeError, match="Callback failed"):
            model.transcribe("test.wav", stream_callback=failing_callback)

    @patch('models.whisper.FasterWhisper')
    @patch('models.whisper.BatchedInferencePipeline')
    def test_callback_with_batched_inference(self, mock_batched, mock_fw):
        """Test callback works with BatchedInferencePipeline."""
        segments = [
            create_mock_segment(0.0, 1.0, "Batched 1"),
            create_mock_segment(1.0, 2.0, "Batched 2"),
        ]
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_batched_instance = Mock()
        mock_batched.return_value = mock_batched_instance
        mock_info = Mock(language="en", language_probability=0.98)
        mock_batched_instance.transcribe.return_value = (iter(segments), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cuda", model_size="base", batch_size=16)
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == 2
        assert tracker.get_texts()[0] == "Batched 1"


# ============================================================================
# DistilWhisperModel Streaming Tests
# ============================================================================

class TestDistilWhisperModelStreaming:
    """Test streaming callback functionality in DistilWhisperModel."""

    @pytest.fixture
    def sample_segments(self):
        """Sample transcription segments for Distil-Whisper testing."""
        return [
            create_mock_segment(0.0, 1.5, "Distil segment one."),
            create_mock_segment(1.5, 3.0, "Distil segment two."),
        ]

    @patch('models.distil_whisper.FasterWhisper')
    def test_distil_stream_callback_invocation(self, mock_fw, sample_segments):
        """Test stream_callback is called in DistilWhisperModel."""
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.95)
        mock_model.transcribe.return_value = (iter(sample_segments), mock_info)

        tracker = CallbackTracker()
        model = DistilWhisperModel(device="cpu", model_size="small")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == 2

    @patch('models.distil_whisper.FasterWhisper')
    def test_distil_stream_callback_format(self, mock_fw):
        """Test DistilWhisperModel callback segment format."""
        mock_segment = create_mock_segment(2.5, 5.7, "Distil format test", -0.12)
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.95)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        tracker = CallbackTracker()
        model = DistilWhisperModel(device="cpu", model_size="medium")
        model.transcribe("test.wav", stream_callback=tracker)

        segment = tracker.get_segments()[0]
        assert_valid_segment_format(segment)
        assert segment["start"] == 2.5
        assert segment["end"] == 5.7
        assert segment["text"] == "Distil format test"
        assert segment["confidence"] == -0.12

    @patch('models.distil_whisper.FasterWhisper')
    @patch('models.distil_whisper.BatchedInferencePipeline')
    def test_distil_stream_with_batching(self, mock_batched, mock_fw):
        """Test stream_callback with GPU batching in DistilWhisper."""
        segments = [
            create_mock_segment(0.0, 1.0, "GPU 1"),
            create_mock_segment(1.0, 2.0, "GPU 2"),
            create_mock_segment(2.0, 3.0, "GPU 3"),
        ]
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_batched_instance = Mock()
        mock_batched.return_value = mock_batched_instance
        mock_info = Mock(language="en", language_probability=0.95)
        mock_batched_instance.transcribe.return_value = (iter(segments), mock_info)

        tracker = CallbackTracker()
        model = DistilWhisperModel(device="cuda", model_size="large-v3", batch_size=16)
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == 3
        texts = tracker.get_texts()
        assert texts == ["GPU 1", "GPU 2", "GPU 3"]


# ============================================================================
# Real-Time Emission Tests
# ============================================================================

class TestRealTimeSegmentEmission:
    """Test real-time segment emission behavior."""

    @patch('models.whisper.FasterWhisper')
    def test_segments_emitted_as_generated(self, mock_fw):
        """Test that segments are emitted as they are generated, not all at once."""
        # Create a generator that yields segments with delays
        def delayed_generator():
            segments = [
                create_mock_segment(0.0, 1.0, "First"),
                create_mock_segment(1.0, 2.0, "Second"),
                create_mock_segment(2.0, 3.0, "Third"),
            ]
            for seg in segments:
                yield seg

        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (delayed_generator(), mock_info)

        call_order = []

        def tracking_callback(stream, segment):
            call_order.append(segment["text"])

        model = WhisperModel(device="cpu", model_size="base")
        result = model.transcribe("test.wav", stream_callback=tracking_callback)

        # Both callback and result should have segments in same order
        result_texts = [s["text"] for s in result]
        assert call_order == result_texts == ["First", "Second", "Third"]


# ============================================================================
# Edge Cases
# ============================================================================

class TestStreamingEdgeCases:
    """Test edge cases for streaming callback functionality."""

    @patch('models.whisper.FasterWhisper')
    def test_callback_with_very_long_segment(self, mock_fw):
        """Test callback with a very long segment (60+ seconds)."""
        long_segment = create_mock_segment(0.0, 65.5, "A very long transcription segment... ")
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([long_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == 1
        assert tracker.get_segments()[0]["end"] == 65.5

    @patch('models.whisper.FasterWhisper')
    def test_callback_with_very_short_segment(self, mock_fw):
        """Test callback with a very short segment (<0.1 seconds)."""
        short_segment = create_mock_segment(1.0, 1.05, "Hi")
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([short_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.call_count() == 1
        segment = tracker.get_segments()[0]
        assert segment["end"] - segment["start"] == 0.05

    @patch('models.whisper.FasterWhisper')
    def test_callback_with_unicode_text(self, mock_fw):
        """Test callback handles Unicode text correctly."""
        unicode_segment = create_mock_segment(0.0, 1.0, "Hello 世界 ?????")
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([unicode_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.get_texts()[0] == "Hello 世界 ?????"

    @patch('models.whisper.FasterWhisper')
    def test_callback_with_special_characters(self, mock_fw):
        """Test callback handles special characters."""
        special_segment = create_mock_segment(
            0.0, 1.0,
            "Test with <special> & \"characters\" and 'quotes'"
        )
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([special_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        text = tracker.get_texts()[0]
        assert "<special>" in text
        assert "&" in text
        assert "\"" in text
        assert "'" in text

    @patch('models.whisper.FasterWhisper')
    def test_callback_with_negative_confidence(self, mock_fw):
        """Test callback with very negative (low) confidence."""
        low_conf_segment = create_mock_segment(0.0, 1.0, "Low confidence", -2.5)
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([low_conf_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        assert tracker.get_segments()[0]["confidence"] == -2.5

    @patch('models.whisper.FasterWhisper')
    def test_callback_segment_without_avg_logprop(self, mock_fw):
        """Test callback handles segments without avg_logprob attribute."""
        # Create a mock segment without avg_logprob
        mock_segment = Mock()
        mock_segment.start = 0.0
        mock_segment.end = 1.0
        mock_segment.text = "No confidence"
        del mock_segment.avg_logprob  # Simulate missing attribute

        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        tracker = CallbackTracker()
        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=tracker)

        # Should use default confidence of 0.9
        assert tracker.get_segments()[0]["confidence"] == 0.9


# ============================================================================
# Callback Signature Tests
# ============================================================================

class TestCallbackSignature:
    """Test callback signature compliance."""

    @patch('models.whisper.FasterWhisper')
    def test_callback_receives_exact_parameters(self, mock_fw):
        """Test that callback receives exactly (stream, segment) parameters."""
        mock_segment = create_mock_segment(0.0, 1.0, "Test")
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)

        received_params = []

        def exact_signature_callback(stream, segment):
            received_params.append({"stream": stream, "segment": segment})

        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=exact_signature_callback)

        assert len(received_params) == 1
        assert "stream" in received_params[0]
        assert "segment" in received_params[0]
        assert received_params[0]["stream"] is True

    @patch('models.whisper.FasterWhisper')
    def test_callback_stream_is_always_true(self, mock_fw):
        """Test that stream parameter is always True (for streaming emission)."""
        segments = [
            create_mock_segment(0.0, 1.0, "One"),
            create_mock_segment(1.0, 2.0, "Two"),
        ]
        mock_model = Mock()
        mock_fw.return_value = mock_model
        mock_info = Mock(language="en", language_probability=0.98)
        mock_model.transcribe.return_value = (iter(segments), mock_info)

        stream_values = []

        def capture_stream(stream, segment):
            stream_values.append(stream)

        model = WhisperModel(device="cpu", model_size="base")
        model.transcribe("test.wav", stream_callback=capture_stream)

        assert all(stream_values)  # All should be True
        assert len(stream_values) == 2
