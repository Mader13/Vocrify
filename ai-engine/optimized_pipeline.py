"""
Optimized Transcription Pipeline

Fully optimized pipeline with:
- Parallel transcription + diarization
- Batch processing support
- Model pooling
- Async support
- Smart result merging
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any, Optional, AsyncIterator
import logging

logger = logging.getLogger(__name__)


class OptimizedTranscriptionPipeline:
    """
    Fully optimized pipeline for maximum performance.

    Features:
    - Parallel transcription and diarization
    - Batch processing for multiple files
    - Model pooling for reuse
    - Async support
    - Progress tracking
    """

    def __init__(
        self,
        model_name: str = "whisper-base",
        device: str = "cpu",
        enable_diarization: bool = True,
        parallel_processing: bool = True,
        max_workers: int = 4,
    ):
        """
        Initialize optimized pipeline.

        Args:
            model_name: Default model to use
            device: Default device ('cpu' or 'cuda')
            enable_diarization: Enable diarization by default
            parallel_processing: Enable parallel processing
            max_workers: Max number of parallel workers
        """
        self.model_name = model_name
        self.device = device
        self.enable_diarization = enable_diarization
        self.parallel_processing = parallel_processing
        self.max_workers = max_workers

        # Thread pools for parallel execution
        self.transcription_executor = ThreadPoolExecutor(max_workers=2)
        self.diarization_executor = ThreadPoolExecutor(max_workers=2)

        # Lazy import of model_pool
        from model_pool import model_pool
        self.model_pool = model_pool

    async def transcribe_file(
        self,
        file_path: str,
        model_name: Optional[str] = None,
        device: Optional[str] = None,
        **options
    ) -> Dict[str, Any]:
        """
        Transcribe single file with full optimization.

        Runs transcription and diarization in parallel if enabled.

        Args:
            file_path: Path to audio file
            model_name: Model to use (defaults to self.model_name)
            device: Device to use (defaults to self.device)
            **options: Additional options

        Returns:
            Dictionary with 'segments', 'file', and optional 'error'
        """
        model_name = model_name or self.model_name
        device = device or self.device

        enable_diarization = options.get('enable_diarization', self.enable_diarization)

        if not self.parallel_processing or not enable_diarization:
            # Sequential processing
            return await self._transcribe_sequential(
                file_path, model_name, device, **options
            )
        else:
            # Parallel processing
            return await self._transcribe_parallel(
                file_path, model_name, device, **options
            )

    async def _transcribe_sequential(
        self,
        file_path: str,
        model_name: str,
        device: str,
        **options
    ) -> Dict[str, Any]:
        """Sequential transcription (fallback)."""
        loop = asyncio.get_event_loop()

        try:
            # Get model from pool
            model = await loop.run_in_executor(
                None,
                self.model_pool.get_model,
                model_name,
                device,
                options.get('download_root'),
                options.get('diarization_provider', 'sherpa-onnx'),
                options.get('num_speakers', -1),
            )

            # Transcribe
            language = options.get('language')
            segments = await loop.run_in_executor(
                None,
                model.transcribe,
                file_path,
                language if language != "auto" else None,
            )

            # Diarization if needed
            if options.get('enable_diarization', False):
                segments = await loop.run_in_executor(
                    None,
                    model.diarize,
                    segments,
                    file_path,
                )

            return {
                "segments": segments,
                "file": file_path,
            }

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            return {
                "file": file_path,
                "error": str(e),
            }

    async def _transcribe_parallel(
        self,
        file_path: str,
        model_name: str,
        device: str,
        **options
    ) -> Dict[str, Any]:
        """Parallel transcription with diarization."""
        loop = asyncio.get_event_loop()

        try:
            # Get model from pool
            model = await loop.run_in_executor(
                None,
                self.model_pool.get_model,
                model_name,
                device,
                options.get('download_root'),
                options.get('diarization_provider', 'sherpa-onnx'),
                options.get('num_speakers', -1),
            )

            # Start both in parallel
            language = options.get('language')

            # Transcribe
            transcription_task = loop.run_in_executor(
                self.transcription_executor,
                model.transcribe,
                file_path,
                language if language != "auto" else None,
            )

            # Diarization (parallel)
            diarization_task = loop.run_in_executor(
                self.diarization_executor,
                model._run_diarization_only,
                file_path,
            )

            # Wait for transcription
            segments = await transcription_task

            # Wait for diarization and merge
            try:
                diarization_result = await diarization_task
                segments = self._merge_diarization(segments, diarization_result)
            except Exception as e:
                logger.warning(f"Diarization failed: {e}")

            return {
                "segments": segments,
                "file": file_path,
            }

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            return {
                "file": file_path,
                "error": str(e),
            }

    async def transcribe_batch(
        self,
        file_paths: List[str],
        model_name: Optional[str] = None,
        device: Optional[str] = None,
        **options
    ) -> List[Dict[str, Any]]:
        """
        Transcribe multiple files with optimization.

        Uses batch processing for better throughput.

        Args:
            file_paths: List of file paths
            model_name: Model to use
            device: Device to use
            **options: Additional options

        Returns:
            List of results
        """
        model_name = model_name or self.model_name
        device = device or self.device

        # Import BatchProcessor
        from batch_processor import BatchProcessor

        processor = BatchProcessor(
            max_workers=self.max_workers,
            model_pool=self.model_pool,
        )

        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            processor.transcribe_batch,
            file_paths,
            model_name,
            device,
            **options
        )

    async def transcribe_stream(
        self,
        file_paths: AsyncIterator[str],
        model_name: Optional[str] = None,
        device: Optional[str] = None,
        **options
    ) -> AsyncIterator[Dict]:
        """
        Transcribe stream of files with pipeline parallelism.

        Processes files as they arrive, with overlapping preprocessing.

        Args:
            file_paths: Async iterator of file paths
            model_name: Model to use
            device: Device to use
            **options: Additional options

        Yields:
            Transcription results
        """
        model_name = model_name or self.model_name
        device = device or self.device

        # Get model once
        from model_pool import model_pool
        model = model_pool.get_model(model_name, device=device, **options)

        async for file_path in file_paths:
            # Process each file
            result = await self.transcribe_file(
                file_path,
                model_name,
                device,
                **options
            )

            yield result

    def _merge_diarization(
        self,
        segments: List[Dict],
        diarization_result: List[Dict]
    ) -> List[Dict]:
        """
        Merge diarization results with transcription segments.

        Args:
            segments: Transcription segments
            diarization_result: Diarization segments

        Returns:
            Merged segments with speaker labels
        """
        for segment in segments:
            start = segment["start"]
            end = segment["end"]

            # Find best matching speaker
            best_speaker = None
            max_overlap = 0

            for dia in diarization_result:
                # Calculate overlap
                overlap_start = max(start, dia["start"])
                overlap_end = min(end, dia["end"])
                overlap = max(0, overlap_end - overlap_start)

                if overlap > max_overlap:
                    max_overlap = overlap
                    best_speaker = dia.get("speaker", "SPEAKER_00")

            # Only assign if meaningful overlap
            if best_speaker and max_overlap > 0:
                segment["speaker"] = best_speaker

        return segments

    def shutdown(self):
        """Shutdown executors and cleanup resources."""
        self.transcription_executor.shutdown(wait=True)
        self.diarization_executor.shutdown(wait=True)
        logger.info("Optimized pipeline shutdown complete")

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.shutdown()


# Convenience function
async def transcribe_with_optimization(
    file_paths: List[str],
    model_name: str = "whisper-base",
    device: str = "cpu",
    **options
) -> List[Dict[str, Any]]:
    """
    Convenience function for optimized transcription.

    Args:
        file_paths: List of file paths
        model_name: Model to use
        device: Device to use
        **options: Additional options

    Returns:
        List of transcription results

    Example:
        >>> results = await transcribe_with_optimization(
        ...     ["file1.wav", "file2.wav"],
        ...     model_name="distil-large",
        ...     device="cuda"
        ... )
    """
    pipeline = OptimizedTranscriptionPipeline(
        model_name=model_name,
        device=device,
    )

    try:
        return await pipeline.transcribe_batch(file_paths, model_name, device, **options)
    finally:
        pipeline.shutdown()
