#!/usr/bin/env python3
"""
Quick validation script for Parakeet model improvements.
Checks syntax, imports, and basic functionality.
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

def validate_syntax():
    """Validate Python syntax of all modified files."""
    print("="*60)
    print("VALIDATING SYNTAX")
    print("="*60)

    files_to_check = [
        'models/parakeet.py',
        'factory.py',
        'main.py',
        'test_parakeet.py'
    ]

    all_valid = True
    for file_path in files_to_check:
        full_path = Path(__file__).parent / file_path
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                code = f.read()
                compile(code, str(full_path), 'exec')
            print(f"✓ {file_path}: Syntax OK")
        except SyntaxError as e:
            print(f"✗ {file_path}: SYNTAX ERROR")
            print(f"  Line {e.lineno}: {e.msg}")
            all_valid = False
        except Exception as e:
            print(f"⚠ {file_path}: {str(e)}")
            all_valid = False

    return all_valid


def validate_imports():
    """Validate that all modules can be imported."""
    print("\n" + "="*60)
    print("VALIDATING IMPORTS")
    print("="*60)

    try:
        print("Importing base module...")
        from base import BaseModel, TranscriptionSegment
        print("✓ base module")

        print("Importing factory module...")
        from factory import ModelFactory
        print("✓ factory module")

        print("Importing parakeet model...")
        from models.parakeet import ParakeetModel
        print("✓ parakeet model")

        print("\nImporting logger module...")
        from logger import logger, transcription_logger
        print("✓ logger module")

        return True

    except ImportError as e:
        print(f"\n✗ Import error: {str(e)}")
        print("\nNote: Some dependencies may not be installed.")
        print("This is OK if you haven't installed nemo_toolkit yet.")
        return False
    except Exception as e:
        print(f"\n✗ Unexpected error: {str(e)}")
        return False


def validate_model_creation():
    """Validate that model can be created (without loading)."""
    print("\n" + "="*60)
    print("VALIDATING MODEL CREATION")
    print("="*60)

    try:
        from factory import ModelFactory

        print("Creating Parakeet model (CPU)...")
        model = ModelFactory.create(
            model_name="parakeet-tdt-0.6b-v3",
            device="cpu"
        )
        print(f"✓ Model created: {model.name}")
        print(f"  Device: {model.device}")
        print(f"  Supports diarization: {model.supports_diarization}")

        # Check for new methods
        print("\nChecking for new methods...")
        methods = [
            '_preprocess_audio',
            '_cleanup_temp_files',
            'transcribe'
        ]

        for method in methods:
            if hasattr(model, method):
                print(f"✓ Method exists: {method}")
            else:
                print(f"✗ Method missing: {method}")
                return False

        return True

    except ImportError as e:
        print(f"⚠ Cannot validate model creation: {str(e)}")
        print("  (This is expected if nemo_toolkit is not installed)")
        return None
    except Exception as e:
        print(f"✗ Model creation failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


def validate_documentation():
    """Check that documentation files exist."""
    print("\n" + "="*60)
    print("VALIDATING DOCUMENTATION")
    print("="*60)

    docs = [
        'PARAKEET_USAGE.md',
        '../docs/PARAKEET_IMPROVEMENTS.md',
        '../docs/PARAKEET_CHANGES.md'
    ]

    all_exist = True
    for doc_path in docs:
        full_path = Path(__file__).parent / doc_path
        if full_path.exists():
            size_kb = full_path.stat().st_size / 1024
            print(f"✓ {doc_path} ({size_kb:.1f} KB)")
        else:
            print(f"✗ {doc_path} NOT FOUND")
            all_exist = False

    return all_exist


def main():
    """Run all validations."""
    print("\n" + "="*60)
    print("PARAKEET MODEL VALIDATION")
    print("="*60)
    print("\nThis script validates the Parakeet model improvements.")
    print("It checks syntax, imports, and basic functionality.\n")

    results = {
        'syntax': validate_syntax(),
        'imports': validate_imports(),
        'model_creation': validate_model_creation(),
        'documentation': validate_documentation()
    }

    # Summary
    print("\n" + "="*60)
    print("VALIDATION SUMMARY")
    print("="*60)

    all_passed = True
    for test_name, result in results.items():
        if result is True:
            status = "PASSED ✓"
        elif result is False:
            status = "FAILED ✗"
            all_passed = False
        else:
            status = "SKIPPED ⚠"

        print(f"{test_name.replace('_', ' ').title()}: {status}")

    if all_passed:
        print("\n🎉 All validations passed!")
        print("\nYou can now use the improved Parakeet model:")
        print("  python main.py --file video.mp4 --model parakeet-tdt-0.6b-v3")
        return 0
    else:
        print("\n⚠ Some validations failed or were skipped.")
        print("\nIf imports failed, install required dependencies:")
        print("  pip install nemo_toolkit[asr]")
        print("\nIf ffmpeg is missing, install it:")
        print("  Windows: https://ffmpeg.org/download.html")
        print("  macOS: brew install ffmpeg")
        print("  Linux: sudo apt install ffmpeg")
        return 1


if __name__ == "__main__":
    sys.exit(main())
