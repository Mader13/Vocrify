#!/usr/bin/env python3
"""
Test script to verify GGML .bin file detection logic
"""
import tempfile
import shutil
from pathlib import Path

def test_ggml_detection():
    """Test that GGML .bin files are detected correctly"""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        models_dir = temp_path / "models"
        models_dir.mkdir()

        # Create a fake GGML .bin file
        ggml_file = models_dir / "ggml-small.bin"
        ggml_file.write_bytes(b"0" * (1024 * 1024 * 100))  # 100 MB

        print("=== Test Setup ===")
        print(f"Models dir: {models_dir}")
        print(f"GGML file: {ggml_file}")
        print(f"GGML size: {ggml_file.stat().st_size / (1024*1024):.0f} MB")

        # Simulate the Rust logic
        models = []

        # Check for GGML .bin files
        for entry in models_dir.iterdir():
            if not entry.is_file():
                continue

            file_name = entry.name

            if file_name.startswith("ggml-") and file_name.endswith(".bin"):
                # Extract model size
                model_size = file_name.removeprefix("ggml-").removesuffix(".bin")
                size_mb = entry.stat().st_size / (1024 * 1024)

                models.append({
                    "name": f"whisper-{model_size}",
                    "size_mb": size_mb,
                    "model_type": "whisper",
                    "installed": True,
                    "path": str(entry),
                })

        print("\n=== Detected Models ===")
        for m in models:
            print(f"Name: {m['name']}")
            print(f"  Type: {m['model_type']}")
            print(f"  Size: {m['size_mb']:.0f} MB")
            print(f"  Path: {m['path']}")

        assert len(models) == 1, f"Expected 1 model, got {len(models)}"
        assert models[0]["name"] == "whisper-small"
        assert models[0]["model_type"] == "whisper"
        print("\n✅ Test PASSED!")

if __name__ == "__main__":
    test_ggml_detection()
