"""
Batch Processor for Multiple File Transcription

Processes multiple audio/video files in parallel for better throughput.
Supports both Whisper and Parakeet models with native batch processing.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class BatchProcessor:
    """
    Process multiple files in optimized batches.

    Features:
    - Parallel processing with ThreadPoolExecutor
    - Native batch processing for Parakeet models
    - Progress tracking
    - Error handling per file
    - Configurable worker count
    """

    def __init__(
        self,
        max_workers: int = 4,
        model_pool: Optional[Any] = None,
    ):
        """
        Initialize batch processor.

        Args:
            max_workers: Maximum number of parallel workers
            model_pool: Optional ModelPool instance for model reuse
        """
        self.max_workers = max_workers
        self.model_pool = model_pool

        # Lazy import of model_pool to avoid circular dependency
        if model_pool is None:
            from model_pool import model_pool as default_pool

            self.model_pool = default_pool

    def transcribe_batch(
        self, files: List[str], model_name: str, device: str = "cpu", **options
    ) -> List[Dict[str, Any]]:
        """
        Transcribe multiple files in parallel.

        Args:
            files: List of file paths to transcribe
            model_name: Name of the model to use
            device: Device to run on ('cpu' or 'cuda')
            **options: Additional options (language, enable_diarization, etc.)

        Returns:
            List of results with 'file' and 'result' or 'error' keys
        """
        if not files:
            return []

        # Check if model supports native batching (Parakeet)
        if model_name.startswith("parakeet"):
            return self._transcribe_batch_native(files, model_name, device, **options)
        else:
            return self._transcribe_batch_parallel(files, model_name, device, **options)

    def _transcribe_batch_parallel(
        self, files: List[str], model_name: str, device: str = "cpu", **options
    ) -> List[Dict[str, Any]]:
        """
        Transcribe multiple files in parallel using ThreadPoolExecutor.

        This is used for models that don't support native batching (like Whisper).
        """
        # Get model once from pool
        try:
            model = self.model_pool.get_model(model_name, device=device, **options)
        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            return [{"file": file, "error": str(e)} for file in files]

        # Submit all tasks
        results = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Create futures for all files
            future_to_file = {}
            for file_path in files:
                future = executor.submit(
                    self._transcribe_single, model, file_path, **options
                )
                future_to_file[future] = file_path

            # Collect results as they complete
            for future in as_completed(future_to_file):
                file_path = future_to_file[future]

                try:
                    result = future.result(timeout=3600)  # 1 hour timeout per file
                    results.append(
                        {
                            "file": file_path,
                            "result": result,
                        }
                    )
                    logger.info(f"Successfully transcribed: {file_path}")

                except Exception as e:
                    error_msg = str(e)
                    results.append(
                        {
                            "file": file_path,
                            "error": error_msg,
                        }
                    )
                    logger.error(f"Failed to transcribe {file_path}: {error_msg}")

        return results

    def _transcribe_batch_native(
        self, files: List[str], model_name: str, device: str = "cpu", **options
    ) -> List[Dict[str, Any]]:
        """
        Transcribe multiple files using native batch processing.

        This is used for Parakeet models that support native batching.
        Falls back to parallel processing if native batching fails.
        """
        try:
            # Try native batch processing first
            model = self.model_pool.get_model(model_name, device=device, **options)

            # Check if model supports batch processing
            if hasattr(model, "transcribe_batch"):
                # Use native batch processing
                try:
                    results_batch = model.transcribe_batch(files, **options)

                    # Convert batch results to standard format
                    results = [
                        {"file": file, "result": result}
                        for file, result in zip(files, results_batch)
                    ]

                    logger.info(
                        f"Native batch processing completed for {len(files)} files"
                    )
                    return results

                except Exception as e:
                    logger.warning(
                        f"Native batch processing failed: {e}. Falling back to parallel processing."
                    )
                    # Fall through to parallel processing

        except Exception as e:
            logger.warning(
                f"Failed to load model for native batching: {e}. Using parallel processing."
            )

        # Fallback to parallel processing
        return self._transcribe_batch_parallel(files, model_name, device, **options)

    def _transcribe_single(self, model: Any, file_path: str, **options) -> List[Dict]:
        """
        Transcribe a single file.

        Args:
            model: Model instance to use
            file_path: Path to the file
            **options: Additional options

        Returns:
            List of transcription segments
        """
        language = options.get("language")
        enable_diarization = options.get("enable_diarization", False)

        # Transcribe
        segments = model.transcribe(
            file_path=file_path,
            language=language if language != "auto" else None,
        )

        # Diarization if requested
        if enable_diarization and hasattr(model, "diarize"):
            segments, _speaker_turns = model.diarize(segments, file_path)

        return segments

    async def transcribe_batch_async(
        self, files: List[str], model_name: str, device: str = "cpu", **options
    ) -> List[Dict[str, Any]]:
        """
        Transcribe multiple files asynchronously.

        This provides better integration with async/await code.
        Useful for web servers and async applications.

        Args:
            files: List of file paths to transcribe
            model_name: Name of the model to use
            device: Device to run on ('cpu' or 'cuda')
            **options: Additional options

        Returns:
            List of results with 'file' and 'result' or 'error' keys
        """
        loop = asyncio.get_event_loop()

        # Run in thread pool to avoid blocking event loop
        return await loop.run_in_executor(
            None, self.transcribe_batch, files, model_name, device, **options
        )


# Convenience function for quick batch processing
def transcribe_multiple_files(
    files: List[str],
    model_name: str = "whisper-base",
    device: str = "cpu",
    max_workers: int = 4,
    **options,
) -> List[Dict[str, Any]]:
    """
    Convenience function to transcribe multiple files.

    Args:
        files: List of file paths
        model_name: Model to use
        device: Device to run on
        max_workers: Max parallel workers
        **options: Additional transcription options

    Returns:
        List of transcription results

    Example:
        >>> results = transcribe_multiple_files(
        ...     ["file1.wav", "file2.wav"],
        ...     model_name="whisper-base",
        ...     device="cpu",
        ...     language="en"
        ... )
        >>> for result in results:
        ...     if "error" in result:
        ...         print(f"Error: {result['error']}")
        ...     else:
        ...         print(f"Success: {len(result['result'])} segments")
    """
    processor = BatchProcessor(max_workers=max_workers)
    return processor.transcribe_batch(files, model_name, device, **options)
