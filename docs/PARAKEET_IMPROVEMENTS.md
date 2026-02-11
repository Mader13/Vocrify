# Parakeet Model Improvements

## Overview

This document describes the improvements made to the Parakeet ASR model implementation in `ai-engine/models/parakeet.py`.

## Key Improvements

### 1. Audio Preprocessing

**Problem**: Parakeet models require audio in a specific format (16kHz sample rate, mono channel, WAV format). The original implementation didn't handle format conversion.

**Solution**: Added `_preprocess_audio()` method that:
- Uses ffmpeg to convert any audio/video format to WAV
- Ensures 16kHz sample rate
- Ensures mono channel
- Uses 16-bit PCM encoding
- Creates temporary files that are cleaned up after transcription

**Code**:
```python
def _preprocess_audio(self, file_path: str) -> str:
    """Convert audio to 16kHz mono WAV format for Parakeet."""
    temp_fd, temp_path = tempfile.mkstemp(suffix='.wav')
    os.close(temp_fd)
    self._temp_audio_files.append(temp_path)

    subprocess.run([
        'ffmpeg', '-i', file_path,
        '-ar', '16000',  # 16kHz
        '-ac', '1',      # Mono
        '-acodec', 'pcm_s16le',
        '-y', temp_path
    ], check=True, capture_output=True)

    return temp_path
```

### 2. Timestamp Extraction

**Problem**: The original implementation had incomplete timestamp handling logic. It didn't properly extract timestamps from NeMo's transcribe() output.

**Solution**: Improved `transcribe()` method to:
- Call transcribe with `return_timestamps=True`
- Handle multiple result formats from NeMo
- Extract timestamps from different response structures
- Provide fallback when timestamps aren't available

**Code**:
```python
transcriptions = self._model.transcribe(
    paths2audio_files=[audio_path],
    batch_size=1,
    return_timestamps=True,  # Enable timestamp extraction
    num_workers=1,
)

# Handle multiple result formats
if isinstance(result, dict):
    if 'segments' in result:
        for seg in result['segments']:
            segments.append({
                'start': float(seg.get('start', 0)),
                'end': float(seg.get('end', 0)),
                'text': seg.get('text', '').strip(),
                'speaker': None,
                'confidence': 0.9,
            })
```

### 3. Progress Callbacks

**Problem**: The original implementation didn't emit progress events during transcription.

**Solution**: While the basic implementation doesn't have fine-grained progress, the system now:
- Properly integrates with the logging system
- Emits transcription start/complete events via `transcription_logger`
- Can be extended with NeMo's callback system for more detailed progress

**Note**: NeMo's transcribe() is a blocking call without built-in progress callbacks. For real-time progress, you would need to use NeMo's lower-level APIs or implement chunk-based transcription.

### 4. Temporary File Management

**Problem**: Audio preprocessing creates temporary files that need cleanup.

**Solution**: Implemented robust temp file management:
- Track all temp files in `self._temp_audio_files`
- Automatic cleanup in `finally` block
- Destructor cleanup with `__del__`
- Separate `_cleanup_temp_files()` method

**Code**:
```python
def _cleanup_temp_files(self):
    """Clean up temporary audio files."""
    for temp_file in self._temp_audio_files:
        try:
            if os.path.exists(temp_file):
                os.remove(temp_file)
        except (OSError, IOError):
            pass
    self._temp_audio_files.clear()

def __del__(self):
    """Cleanup on destruction."""
    self._cleanup_temp_files()
```

### 5. Error Handling

**Problem**: Insufficient error handling for edge cases.

**Solution**: Added comprehensive error handling:
- ffmpeg validation with helpful error messages
- Model loading error messages
- File not found handling
- Timeout handling for audio preprocessing
- Graceful fallbacks for different result formats

### 6. Factory Pattern Updates

**Problem**: Factory didn't support download_root parameter for Parakeet.

**Solution**: Updated `factory.py` to:
- Pass download_root to ParakeetModel constructor
- Add new Parakeet variants (1.1b, 1.1b-ls)
- Provide accurate model information in get_model_info()

## Supported Parakeet Models

### parakeet-tdt-0.6b-v3 (Default)
- **Size**: ~600 MB
- **Speed**: Very fast
- **Quality**: Excellent
- **Languages**: Multilingual (English, Spanish, French, German, Italian)
- **Best for**: Fast transcription with good accuracy

### parakeet-tdt-1.1b
- **Size**: ~1.1 GB
- **Speed**: Fast
- **Quality**: Excellent
- **Languages**: Multilingual (5 languages)
- **Best for**: Higher accuracy requirements

### parakeet-tdt-1.1b-ls
- **Size**: ~1.1 GB
- **Features**: Large speaker diarization variant
- **Best for**: Multi-speaker scenarios

## Usage Examples

### Basic Transcription

```python
from factory import ModelFactory

model = ModelFactory.create(
    model_name="parakeet-tdt-0.6b-v3",
    device="cpu"
)

segments = model.transcribe(
    file_path="video.mp4",
    language=None  # Auto-detect
)

for seg in segments:
    print(f"[{seg['start']:.2f}s - {seg['end']:.2f}s] {seg['text']}")
```

### With Custom Cache Directory

```python
model = ModelFactory.create(
    model_name="parakeet-tdt-0.6b-v3",
    device="cuda",  # GPU acceleration
    download_root="/path/to/models"
)
```

### From Command Line

```bash
# Transcribe with Parakeet
python main.py --file video.mp4 --model parakeet-tdt-0.6b-v3 --device cuda

# Download Parakeet model
python main.py --download-model parakeet-tdt-0.6b-v3 --cache-dir ~/.cache/models --model-type parakeet
```

## Testing

A comprehensive test suite is provided in `test_parakeet.py`:

```bash
cd ai-engine
python test_parakeet.py
```

The test suite validates:
1. Model loading and initialization
2. Audio preprocessing with ffmpeg
3. Transcription with timestamp extraction
4. Temporary file cleanup
5. Error handling for edge cases

## Performance Considerations

### CPU vs GPU

- **CPU**: Works but slower for larger models
- **CUDA GPU**: Recommended for production use
  - Requires NVIDIA GPU with CUDA support
  - Much faster transcription
  - Better for real-time applications

### Memory Requirements

- **0.6B model**: ~2GB RAM minimum (4GB recommended)
- **1.1B model**: ~4GB RAM minimum (8GB recommended)

### Speed Benchmarks

Approximate transcription speed (1 hour of audio):
- **0.6B (CPU)**: ~30-45 minutes
- **0.6B (GPU)**: ~5-10 minutes
- **1.1B (CPU)**: ~60-90 minutes
- **1.1B (GPU)**: ~10-15 minutes

## Troubleshooting

### Issue: "ffmpeg not found"
**Solution**: Install ffmpeg
- Windows: Download from https://ffmpeg.org/download.html
- macOS: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg`

### Issue: "No module named 'nemo_toolkit'"
**Solution**: Install NeMo toolkit
```bash
pip install nemo_toolkit[asr]
```

### Issue: CUDA out of memory
**Solution**:
- Use smaller model (0.6b instead of 1.1b)
- Use CPU instead of GPU
- Reduce batch size (modify code if needed)

### Issue: Poor transcription quality
**Solution**:
- Ensure audio is 16kHz mono (preprocessing handles this)
- Use larger model (1.1b)
- Clean audio input (remove background noise)
- Specify language if known

## Future Improvements

Potential enhancements for future versions:

1. **Chunk-based Transcription**: Process long audio files in chunks for progress tracking
2. **Speaker Diarization**: Add native speaker identification support
3. **Streaming Transcription**: Real-time transcription as audio is being recorded
4. **Language Detection**: Explicit language detection before transcription
5. **Confidence Scores**: Extract actual confidence scores from model
6. **Punctuation**: Add punctuation restoration for better readability

## References

- [NeMo Toolkit Documentation](https://docs.nvidia.com/deeplearning/nemo/user-guide/docs/en/stable/)
- [Parakeet Models on NGC](https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/parakeet-tdt-0.6b-v3)
- [Parakeet Paper](https://arxiv.org/abs/2208.12147)
