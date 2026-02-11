#!/usr/bin/env python3
"""
Simple integration test for Parakeet via main.py.

This script tests the complete transcription pipeline through main.py
and validates JSON output format.

Usage:
    python test_integration.py

Requirements:
    - ffmpeg must be installed and in PATH
    - Test video file at E:\Dev\Transcribe-video\123.mp4
"""

import json
import subprocess
import sys
from pathlib import Path


def run_transcription_test():
    """Run transcription test via main.py and validate output."""

    print("="*70)
    print("PARAKEET INTEGRATION TEST via main.py")
    print("="*70)

    test_file = r"E:\Dev\Transcribe-video\123.mp4"

    # Check if file exists
    if not Path(test_file).exists():
        print(f"\n✗ FAILED: Test file not found: {test_file}")
        return False

    print(f"\n✓ Test file found: {test_file}")
    print(f"  Size: {Path(test_file).stat().st_size / (1024*1024):.2f} MB")

    # Check if ffmpeg is available
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            print("\n✓ ffmpeg is available")
        else:
            print("\n✗ FAILED: ffmpeg not found in PATH")
            print("  Install from: https://ffmpeg.org/download.html")
            return False
    except FileNotFoundError:
        print("\n✗ FAILED: ffmpeg not found in PATH")
        print("  Install from: https://ffmpeg.org/download.html")
        return False
    except Exception as e:
        print(f"\n✗ FAILED: Error checking ffmpeg: {e}")
        return False

    # Run transcription via main.py
    print("\n" + "="*70)
    print("Starting transcription via main.py...")
    print("="*70)
    print("\nCommand:")
    print(f'  python main.py --file "{test_file}" --model parakeet-tdt-0.6b-v3 --device cpu')
    print("\nThis may take several minutes...\n")

    try:
        result = subprocess.run(
            [
                sys.executable,  # venv/Scripts/python.exe
                'main.py',
                '--file', test_file,
                '--model', 'parakeet-tdt-0.6b-v3',
                '--device', 'cpu'
            ],
            capture_output=True,
            text=True,
            timeout=600,  # 10 minutes max
            cwd=Path(__file__).parent
        )

        print("STDOUT:")
        print(result.stdout)

        if result.stderr:
            print("\nSTDERR:")
            print(result.stderr)

        # Parse output for JSON events
        print("\n" + "="*70)
        print("Parsing JSON events...")
        print("="*70)

        events = []
        for line in result.stdout.split('\n'):
            line = line.strip()
            if line:
                try:
                    event = json.loads(line)
                    events.append(event)
                    print(f"\n✓ Valid JSON: {event.get('type', 'unknown')}")
                    if event.get('type') == 'progress':
                        print(f"  Stage: {event.get('stage')}")
                        print(f"  Progress: {event.get('progress')}%")
                        print(f"  Message: {event.get('message')}")
                    elif event.get('type') == 'result':
                        segments = event.get('segments', [])
                        print(f"  Segments: {len(segments)}")
                        if segments:
                            print(f"\n  First segment:")
                            print(f"    Start: {segments[0].get('start')}s")
                            print(f"    End: {segments[0].get('end')}s")
                            print(f"    Text: {segments[0].get('text', '')[:100]}...")
                    elif event.get('type') == 'error':
                        print(f"  ✗ Error: {event.get('error')}")
                except json.JSONDecodeError:
                    # Not a JSON line, ignore
                    pass

        # Validate events
        print("\n" + "="*70)
        print("Validation Results")
        print("="*70)

        has_progress = any(e.get('type') == 'progress' for e in events)
        has_result = any(e.get('type') == 'result' for e in events)
        has_error = any(e.get('type') == 'error' for e in events)

        if has_error:
            error_events = [e for e in events if e.get('type') == 'error']
            print(f"\n✗ FAILED: Errors detected")
            for e in error_events:
                print(f"  {e.get('error')}")
            return False

        if not has_result:
            print(f"\n✗ FAILED: No result event received")
            print(f"  Events received: {len(events)}")
            print(f"  Event types: {[e.get('type') for e in events]}")
            return False

        if has_progress:
            print(f"\n✓ Progress events received")
        else:
            print(f"\n⚠ No progress events (may be okay)")

        if has_result:
            result_events = [e for e in events if e.get('type') == 'result']
            segments = result_events[0].get('segments', [])

            if segments:
                print(f"\n✓ Result event with {len(segments)} segments")

                # Validate segment format
                valid_segments = 0
                for seg in segments:
                    if all(k in seg for k in ['start', 'end', 'text']):
                        valid_segments += 1

                if valid_segments == len(segments):
                    print(f"✓ All segments have valid format")
                else:
                    print(f"⚠ {len(segments) - valid_segments} segments have missing fields")
            else:
                print(f"\n⚠ Result event has no segments")
        else:
            print(f"\n✗ FAILED: No result event")

        print("\n" + "="*70)
        print("INTEGRATION TEST PASSED")
        print("="*70)
        return True

    except subprocess.TimeoutExpired:
        print("\n✗ FAILED: Transcription timed out after 10 minutes")
        return False
    except Exception as e:
        print(f"\n✗ FAILED: Exception: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run integration test."""
    print("\n" + "="*70)
    print("PARAKEET INTEGRATION TEST")
    print("="*70)
    print("\nThis test will:")
    print("  1. Check if ffmpeg is installed")
    print("  2. Run transcription via main.py")
    print("  3. Validate JSON output format")
    print("  4. Report results")

    success = run_transcription_test()

    print("\n" + "="*70)
    if success:
        print("ALL TESTS PASSED")
        print("="*70)
        return 0
    else:
        print("TESTS FAILED")
        print("="*70)
        return 1


if __name__ == "__main__":
    sys.exit(main())
