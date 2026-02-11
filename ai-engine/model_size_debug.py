#!/usr/bin/env python3
"""
Debug script to analyze model download size discrepancies
"""
import os
import json
import subprocess
from pathlib import Path

def get_model_size_mb(path: str) -> int:
    """Get the size of a model directory in MB."""
    total_size = 0
    file_count = 0
    print(f"\n=== Analyzing directory: {path} ===")

    if not os.path.exists(path):
        print("ERROR: Directory does not exist!")
        return 0

    print("\nFiles in directory:")
    for dirpath, dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            try:
                file_size = os.path.getsize(fp)
                total_size += file_size
                file_count += 1
                size_mb = file_size / (1024 * 1024)
                print(f"  {fp}")
                print(f"    Size: {size_mb:.2f} MB ({file_size} bytes)")
            except (OSError, IOError) as e:
                print(f"  ERROR reading {fp}: {e}")

    total_mb = total_size // (1024 * 1024)
    print(f"\n=== Summary ===")
    print(f"Total files: {file_count}")
    print(f"Total size: {total_mb} MB ({total_size} bytes)")
    print(f"Average file size: {total_size/file_count if file_count > 0 else 0:.2f} MB")

    return total_mb

def check_snapshot_download_repo():
    """Check the actual Systran/faster-whisper-base repository"""
    print("\n=== Checking Systran/faster-whisper-base repository ===")

    # Try to get repository info using huggingface_hub
    try:
        from huggingface_hub import HfApi
        api = HfApi()

        repo_id = "Systran/faster-whisper-base"
        print(f"Getting repository info for: {repo_id}")

        # Get repo info
        repo_info = api.repo_info(repo_id)
        print(f"Repository ID: {repo_info.id}")
        print(f"Repository type: {repo_info.type}")
        print(f"Downloads: {repo_info.downloads}")

        # Get model files
        files = api.list_repo_files(repo_id)
        print(f"\nRepository files ({len(files)} total):")

        total_size = 0
        for file in files[:20]:  # Show first 20 files
            try:
                # Get file info
                file_info = api.hf_file_metadata(
                    repo_id=repo_id,
                    filename=file
                )
                size_mb = file_info.size / (1024 * 1024) if file_info.size else 0
                print(f"  {file}: {size_mb:.2f} MB")
                total_size += file_info.size or 0
            except Exception as e:
                print(f"  {file}: Error getting info - {e}")

        print(f"\nExpected repository size: {total_size/(1024*1024):.2f} MB")

    except ImportError:
        print("huggingface_hub not available, checking alternative methods...")
    except Exception as e:
        print(f"Error checking repository: {e}")

def check_actual_downloaded_models():
    """Check if models were downloaded to common locations"""
    print("\n=== Checking common model download locations ===")

    common_paths = [
        "./models",
        "./ai-engine/models",
        "./ai-engine/.cache/huggingface",
        "./.cache/huggingface",
        "./HuggingFace",
        "./huggingface",
        "./ai-engine/venv/Lib/site-packages/faster_whisper"
    ]

    for path in common_paths:
        if os.path.exists(path):
            print(f"\nFound: {path}")
            size_mb = get_model_size_mb(path)
            if size_mb > 0:
                print(f"Size: {size_mb} MB")

                # Look for faster-whisper-base specifically
                if "faster-whisper-base" in path.lower():
                    print(" *** This looks like the target model! ***")
        else:
            print(f"Not found: {path}")

if __name__ == "__main__":
    print("Model Size Analysis Script")
    print("=" * 50)

    # Check if we have a specific path from command line
    import sys
    if len(sys.argv) > 1:
        model_path = sys.argv[1]
        print(f"Analyzing specific path: {model_path}")
        get_model_size_mb(model_path)
    else:
        # Check common locations
        check_actual_downloaded_models()

        # Check expected repository size
        check_snapshot_download_repo()

    print("\n=== Recommendations ===")
    print("1. If the model was downloaded, check the output above for the exact path")
    print("2. The expected size for faster-whisper-base should be around 140-150 MB")
    print("3. If files are missing, check if download was interrupted")
    print("4. Check if model files are in a subdirectory")