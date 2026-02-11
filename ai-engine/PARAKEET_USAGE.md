# Parakeet Model - Quick Usage Guide

## Installation

First, ensure you have the required dependencies:

```bash
# Install NeMo toolkit
pip install nemo_toolkit[asr]

# Install ffmpeg (required for audio preprocessing)
# Windows: Download from https://ffmpeg.org/download.html
# macOS: brew install ffmpeg
# Linux: sudo apt install ffmpeg
```

## Basic Usage

### Python API

```python
from factory import ModelFactory

# Create model
model = ModelFactory.create(
    model_name="parakeet-tdt-0.6b-v3",
    device="cpu"  # or "cuda" for GPU
)

# Transcribe audio/video file
segments = model.transcribe(
    file_path="path/to/video.mp4",
    language=None  # Auto-detect language
)

# Access results
for seg in segments:
    print(f"[{seg['start']:.2f}s - {seg['end']:.2f}s] {seg['text']}")
```

### Command Line

```bash
# Basic transcription
python main.py --file video.mp4 --model parakeet-tdt-0.6b-v3

# Use GPU for faster transcription
python main.py --file video.mp4 --model parakeet-tdt-0.6b-v3 --device cuda

# Specify language
python main.py --file video.mp4 --model parakeet-tdt-0.6b-v3 --language en
```

## Model Comparison

| Model | Size | Speed | Quality | Languages | Best For |
|-------|------|-------|---------|-----------|----------|
| parakeet-tdt-0.6b-v3 | 600MB | Very Fast | Excellent | 5 languages | General use |
| parakeet-tdt-1.1b | 1.1GB | Fast | Excellent | 5 languages | Higher accuracy |
| parakeet-tdt-1.1b-ls | 1.1GB | Fast | Excellent | 5 languages | Multi-speaker |

## Supported Languages

- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Italian (it)

## Output Format

The transcribe() method returns a list of segment dictionaries:

```python
[
    {
        "start": 0.0,      # Start time in seconds
        "end": 2.5,        # End time in seconds
        "text": "Hello world",  # Transcribed text
        "speaker": None,   # Speaker label (None for now)
        "confidence": 0.9  # Confidence score (0-1)
    },
    # ... more segments
]
```

## Key Features

### ✓ Audio Preprocessing
Automatically converts any audio/video format to 16kHz mono WAV:
- MP3, MP4, WAV, FLAC, OGG, etc.
- Handles different sample rates
- Handles multi-channel audio

### ✓ Timestamp Extraction
Extracts accurate word and segment timestamps:
- Start time for each segment
- End time for each segment
- Useful for subtitles and video editing

### ✓ Automatic Cleanup
Cleans up temporary audio files automatically:
- No manual cleanup required
- Handles edge cases gracefully
- Prevents disk space issues

### ✓ Error Handling
Comprehensive error messages for common issues:
- Missing ffmpeg
- Invalid file paths
- Model loading failures
- Audio format issues

## Performance Tips

1. **Use GPU when possible**: 3-5x faster transcription
2. **Choose appropriate model size**: Balance speed vs accuracy
3. **Ensure audio quality**: Clean audio = better transcription
4. **Specify language**: Improves accuracy for known languages

## Troubleshooting

### "ffmpeg not found"
Install ffmpeg from https://ffmpeg.org/download.html

### "CUDA out of memory"
- Use CPU instead: `device="cpu"`
- Use smaller model: `parakeet-tdt-0.6b-v3`
- Close other GPU applications

### Poor transcription quality
- Ensure audio is 16kHz (automatic with preprocessing)
- Use larger model: `parakeet-tdt-1.1b`
- Specify language if known
- Remove background noise

## Examples

### Transcribe with progress tracking
```python
from logger import transcription_logger
from factory import ModelFactory

model = ModelFactory.create("parakeet-tdt-0.6b-v3", device="cuda")
transcription_logger.set_context(task_id="task-123", file_name="video.mp4")

transcription_logger.transcription_start("video.mp4", language="en")
segments = model.transcribe("video.mp4")
transcription_logger.transcription_complete(0, len(segments))
```

### Batch processing multiple files
```python
import os
from factory import ModelFactory

model = ModelFactory.create("parakeet-tdt-0.6b-v3", device="cuda")

for video_file in os.listdir("videos/"):
    if video_file.endswith((".mp4", ".wav", ".mp3")):
        print(f"Transcribing {video_file}...")
        segments = model.transcribe(f"videos/{video_file}")
        print(f"  Got {len(segments)} segments")
```

### Save to SRT format
```python
from factory import ModelFactory

model = ModelFactory.create("parakeet-tdt-0.6b-v3")
segments = model.transcribe("video.mp4")

with open("subtitles.srt", "w") as f:
    for i, seg in enumerate(segments, 1):
        start_time = format_srt_time(seg['start'])
        end_time = format_srt_time(seg['end'])
        f.write(f"{i}\n{start_time} --> {end_time}\n{seg['text']}\n\n")

def format_srt_time(seconds):
    """Convert seconds to SRT time format (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
```

## Testing

Run the test suite to verify your installation:

```bash
cd ai-engine
python test_parakeet.py
```

This will test:
- Model loading
- Audio preprocessing
- Transcription with timestamps
- Temporary file cleanup
- Error handling

## Support

For issues or questions:
1. Check the main documentation: `docs/PARAKEET_IMPROVEMENTS.md`
2. Run the test suite: `python test_parakeet.py`
3. Check NeMo documentation: https://docs.nvidia.com/deeplearning/nemo/
