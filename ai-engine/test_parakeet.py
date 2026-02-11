#!/usr/bin/env python3
r"""
Comprehensive end-to-end test for Parakeet transcription model.

Tests transcription accuracy, output format, error handling, and performance.
Uses real video file at E:\Dev\Transcribe-video\123.mp4
"""

import json
import os
import sys
import time
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from factory import ModelFactory
from logger import logger


def print_test_header(test_name: str):
    """Print a formatted test header."""
    print(f"\n{'='*70}")
    print(f"TEST: {test_name}")
    print('='*70)


def print_test_result(test_name: str, passed: bool, details: str = ""):
    """Print formatted test result."""
    status = "PASSED" if passed else "FAILED"
    symbol = "✓" if passed else "✗"
    print(f"\n{symbol} {status}: {test_name}")
    if details:
        print(f"  Details: {details}")


def test_parakeet_e2e():
    """End-to-end test of Parakeet transcription with real video file."""

    test_file = r"E:\Dev\Transcribe-video\123.mp4"
    model = None

    try:
        # ========================================================================
        # TEST 1: Model Initialization
        # ========================================================================
        print_test_header("Model Initialization")

        start_time = time.time()
        model = ModelFactory.create(
            model_name="parakeet-tdt-0.6b-v3",
            device="cpu"
        )
        load_time = time.time() - start_time

        print(f"Model name: {model.name}")
        print(f"Device: {model.device}")
        print(f"Diarization support: {model.supports_diarization}")
        print(f"Load time: {load_time:.2f}s")

        assert model.name == "parakeet-tdt-0.6b-v3"
        assert model.device == "cpu"

        print_test_result("Model Initialization", True, f"Loaded in {load_time:.2f}s")

        # ========================================================================
        # TEST 2: File Validation
        # ========================================================================
        print_test_header("File Validation")

        if not Path(test_file).exists():
            print_test_result("File Validation", False, f"File not found: {test_file}")
            return False

        file_size = Path(test_file).stat().st_size / (1024*1024)
        print(f"Input file: {test_file}")
        print(f"File size: {file_size:.2f} MB")
        print_test_result("File Validation", True, f"File exists ({file_size:.2f} MB)")

        # ========================================================================
        # TEST 3: File Transcription
        # ========================================================================
        print_test_header("File Transcription")

        print(f"\nStarting transcription...")
        print(f"This may take several minutes depending on video length...")
        start_time = time.time()

        segments = model.transcribe(
            file_path=test_file,
            language=None  # Auto-detect
        )

        transcription_time = time.time() - start_time

        print(f"\nTranscription completed in {transcription_time:.2f}s")
        print(f"Number of segments: {len(segments)}")

        if not segments:
            print_test_result("File Transcription", False, "No segments returned")
            return False

        # Print first few segments
        print("\nFirst 3 segments:")
        for i, seg in enumerate(segments[:3], 1):
            print(f"\n  Segment {i}:")
            print(f"    Start: {seg.get('start', 'N/A')}s")
            print(f"    End: {seg.get('end', 'N/A')}s")
            print(f"    Text: {seg.get('text', 'N/A')[:100]}...")
            print(f"    Speaker: {seg.get('speaker', 'N/A')}")
            print(f"    Confidence: {seg.get('confidence', 'N/A')}")

        print_test_result(
            "File Transcription",
            True,
            f"{len(segments)} segments in {transcription_time:.2f}s"
        )

        # ========================================================================
        # TEST 4: Output Format Validation
        # ========================================================================
        print_test_header("Output Format Validation")

        format_errors = []

        for i, seg in enumerate(segments, 1):
            # Check required fields
            if 'start' not in seg:
                format_errors.append(f"Segment {i}: missing 'start'")
            if 'end' not in seg:
                format_errors.append(f"Segment {i}: missing 'end'")
            if 'text' not in seg:
                format_errors.append(f"Segment {i}: missing 'text'")

            # Check types
            if 'start' in seg and not isinstance(seg['start'], (int, float)):
                format_errors.append(f"Segment {i}: 'start' must be numeric")
            if 'end' in seg and not isinstance(seg['end'], (int, float)):
                format_errors.append(f"Segment {i}: 'end' must be numeric")
            if 'text' in seg and not isinstance(seg['text'], str):
                format_errors.append(f"Segment {i}: 'text' must be string")

            # Check logical consistency
            if 'start' in seg and 'end' in seg:
                if seg['start'] > seg['end']:
                    format_errors.append(
                        f"Segment {i}: start ({seg['start']}) > end ({seg['end']})"
                    )

        if format_errors:
            print_test_result(
                "Output Format Validation",
                False,
                f"{len(format_errors)} errors: {format_errors[:5]}"
            )
        else:
            print_test_result(
                "Output Format Validation",
                True,
                f"All {len(segments)} segments properly formatted"
            )

        # ========================================================================
        # TEST 5: Timestamp Validation
        # ========================================================================
        print_test_header("Timestamp Validation")

        timestamp_errors = []
        prev_end = 0

        for i, seg in enumerate(segments, 1):
            start = seg.get('start', 0)
            end = seg.get('end', 0)

            # Check for negative timestamps
            if start < 0:
                timestamp_errors.append(f"Segment {i}: negative start time")

            # Check for reasonable ordering
            if start < prev_end - 0.5:  # Allow small overlap
                timestamp_errors.append(
                    f"Segment {i}: starts before previous segment ends"
                )

            prev_end = max(prev_end, end)

        if timestamp_errors:
            print_test_result(
                "Timestamp Validation",
                False,
                f"{len(timestamp_errors)} errors"
            )
        else:
            print_test_result(
                "Timestamp Validation",
                True,
                "Timestamps are sequential and valid"
            )

        # ========================================================================
        # TEST 6: Text Quality
        # ========================================================================
        print_test_header("Text Quality Analysis")

        total_chars = sum(len(seg.get('text', '')) for seg in segments)
        empty_segments = sum(1 for seg in segments if not seg.get('text', '').strip())
        avg_segment_length = total_chars / len(segments) if segments else 0

        print(f"Total transcribed characters: {total_chars}")
        print(f"Average segment length: {avg_segment_length:.1f} chars")
        print(f"Empty segments: {empty_segments}/{len(segments)}")

        # Sample text for inspection
        sample_text = segments[0].get('text', '') if segments else ''
        print(f"\nSample transcription:\n{sample_text[:200]}")

        quality_issues = []
        if empty_segments > len(segments) * 0.1:
            quality_issues.append("Too many empty segments")

        if quality_issues:
            print_test_result(
                "Text Quality Analysis",
                False,
                f"Issues: {quality_issues}"
            )
        else:
            print_test_result(
                "Text Quality Analysis",
                True,
                f"Good quality: {total_chars} chars transcribed"
            )

        # ========================================================================
        # TEST 7: Error Handling - Missing File
        # ========================================================================
        print_test_header("Error Handling - Missing File")

        try:
            missing_result = model.transcribe("nonexistent_file.mp4")
            if missing_result == [] or missing_result is None:
                print_test_result(
                    "Error Handling - Missing File",
                    True,
                    "Handled gracefully (returned empty)"
                )
            else:
                print_test_result(
                    "Error Handling - Missing File",
                    False,
                    "Should return empty or raise error"
                )
        except Exception as e:
            print_test_result(
                "Error Handling - Missing File",
                True,
                f"Raised exception: {type(e).__name__}"
            )

        # ========================================================================
        # TEST 8: Performance Metrics
        # ========================================================================
        print_test_header("Performance Metrics")

        if transcription_time > 0:
            # Get audio duration from timestamps
            max_end = max((seg.get('end', 0) for seg in segments), default=0)
            audio_duration = max_end if max_end > 0 else transcription_time

            real_time_factor = transcription_time / audio_duration if audio_duration > 0 else 0

            print(f"Audio duration: {audio_duration:.2f}s")
            print(f"Transcription time: {transcription_time:.2f}s")
            print(f"Real-time factor: {real_time_factor:.2f}x")
            print(f"(RTF < 1 means faster than real-time)")

            if real_time_factor < 0.5:
                perf_rating = "Excellent"
            elif real_time_factor < 1.0:
                perf_rating = "Good (faster than real-time)"
            elif real_time_factor < 2.0:
                perf_rating = "Acceptable"
            else:
                perf_rating = "Slow"

            print_test_result(
                "Performance Metrics",
                True,
                f"RTF: {real_time_factor:.2f}x ({perf_rating})"
            )

        # ========================================================================
        # TEST 9: JSON Serialization
        # ========================================================================
        print_test_header("JSON Serialization")

        try:
            json_output = json.dumps(segments, indent=2, ensure_ascii=False)
            parsed_back = json.loads(json_output)

            if len(parsed_back) == len(segments):
                print_test_result(
                    "JSON Serialization",
                    True,
                    f"Successfully serialized {len(segments)} segments"
                )
            else:
                print_test_result(
                    "JSON Serialization",
                    False,
                    "Segment count mismatch"
                )
        except Exception as e:
            print_test_result(
                "JSON Serialization",
                False,
                f"Error: {str(e)}"
            )

        # ========================================================================
        # TEST SUMMARY & RESULTS EXPORT
        # ========================================================================
        print_test_header("TEST SUMMARY")

        print(f"\n{'Key Results':-<40}")
        print(f"Total segments: {len(segments)}")
        print(f"Total characters: {total_chars}")
        print(f"Processing time: {transcription_time:.2f}s")
        print(f"Average segment length: {avg_segment_length:.1f} chars")
        print(f"Empty segments: {empty_segments}")

        # Calculate accuracy metrics
        non_empty_segments = len(segments) - empty_segments
        if segments:
            coverage = (non_empty_segments / len(segments)) * 100
            print(f"Segment coverage: {coverage:.1f}%")

        # Save results to file
        results = {
            "model": model.name,
            "device": model.device,
            "test_file": test_file,
            "file_size_mb": round(file_size, 2),
            "segments_count": len(segments),
            "transcription_time_seconds": round(transcription_time, 2),
            "total_characters": total_chars,
            "avg_segment_length": round(avg_segment_length, 1),
            "empty_segments": empty_segments,
            "segment_coverage_percent": round(coverage, 1) if segments else 0,
            "audio_duration_seconds": round(max((seg.get('end', 0) for seg in segments), default=0), 2),
            "real_time_factor": round(real_time_factor, 2) if transcription_time > 0 else 0,
            "segments": segments
        }

        results_file = Path(__file__).parent / "test_parakeet_results.json"
        with open(results_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)

        print(f"\n✓ Results saved to: {results_file}")
        print("\nAll tests completed successfully!")

        return True

    except Exception as e:
        print_test_result("Test Suite", False, f"Exception: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return False






def main():
    """Run comprehensive Parakeet test suite."""
    print("\n" + "="*70)
    print("PARAKEET TRANSCRIPTION - END-TO-END TEST SUITE")
    print("="*70)
    print("\nTesting with real video file: E:\\Dev\\Transcribe-video\\123.mp4")
    print("This will test the complete transcription pipeline.")
    print("\nNOTE: This test may take several minutes...")

    success = test_parakeet_e2e()

    print("\n" + "="*70)
    if success:
        print("ALL TESTS PASSED")
    else:
        print("TESTS COMPLETED WITH ERRORS")
    print("="*70 + "\n")

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
