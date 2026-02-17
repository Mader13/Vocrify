import type { TranscriptionTask, TranscriptionOptions, TranscriptionResult, TranscriptionSegment, ProgressStage, ProgressMetrics } from "@/types";
import { logger } from "@/lib/logger";

export function upsertTaskPure(tasks: TranscriptionTask[], task: TranscriptionTask): TranscriptionTask[] {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index === -1) {
    return [...tasks, task];
  }
  return tasks.map((t, i) => (i === index ? task : t));
}

export function updateTaskProgressPure(
  tasks: TranscriptionTask[],
  taskId: string,
  progress: number,
  stage?: ProgressStage,
  metrics?: ProgressMetrics
): TranscriptionTask[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, progress, lastProgressUpdate: Date.now(), ...(stage && { stage }), ...(metrics && { metrics }) } : task
  );
}

export function updateTaskStatusPure(
  tasks: TranscriptionTask[],
  taskId: string,
  status: TranscriptionTask["status"],
  result?: TranscriptionResult,
  error?: string | null
): TranscriptionTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    return {
      ...task,
      status,
      progress: status === "completed" ? 100 : task.progress,
      stage: status === "completed" ? undefined : task.stage,
      ...(result && { result }),
      ...(error !== undefined && { error }),
    };
  });
}

function ensureTaskResult(task: TranscriptionTask): TranscriptionTask {
  if (!task.result) {
    return {
      ...task,
      result: {
        segments: [],
        language: "",
        duration: 0,
      },
    };
  }
  return task;
}

export function appendTaskSegmentPure(
  tasks: TranscriptionTask[],
  taskId: string,
  segment: TranscriptionSegment,
  index: number,
  _totalSegments: number | null
): TranscriptionTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;

    const taskWithResult = ensureTaskResult(task);
    const existingSegments = taskWithResult.result?.segments || [];
    const newSegments = [...existingSegments];

    if (index < newSegments.length) {
      newSegments[index] = segment;
    } else if (index === newSegments.length) {
      newSegments.push(segment);
    } else {
      while (newSegments.length < index) {
        newSegments.push({ start: 0, end: 0, text: "...", speaker: null, confidence: 0 });
      }
      newSegments.push(segment);
    }

    return {
      ...taskWithResult,
      result: {
        ...taskWithResult.result!,
        segments: newSegments,
        duration: Math.max(taskWithResult.result!.duration || 0, segment.end),
      },
    };
  });
}

export function appendStreamingSegmentPure(
  tasks: TranscriptionTask[],
  taskId: string,
  segment: TranscriptionSegment
): TranscriptionTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    const streamingSegments = task.streamingSegments || [];
    return {
      ...task,
      streamingSegments: [...streamingSegments, segment].slice(-5),
    };
  });
}

export function finalizeTaskResultPure(
  tasks: TranscriptionTask[],
  taskId: string,
  segments: TranscriptionSegment[],
  language: string,
  duration: number
): TranscriptionTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }
    return {
      ...task,
      result: {
        segments,
        language,
        duration,
      },
    };
  });
}

export function setSpeakerSegmentsPure(
  tasks: TranscriptionTask[],
  taskId: string,
  speakerSegments: TranscriptionSegment[],
  speakerTurns: TranscriptionTask["result"] extends { speakerTurns: infer T } ? T : never
): TranscriptionTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    if (!task.result) return task;
    return {
      ...task,
      result: {
        ...task.result,
        speakerSegments,
        speakerTurns,
      },
    };
  });
}

export function removeTaskPure(tasks: TranscriptionTask[], taskId: string): TranscriptionTask[] {
  return tasks.filter((t) => t.id !== taskId);
}

export function validateDiarizationConfiguration(
  options: TranscriptionOptions,
  fileName: string
): void {
  if (options.enableDiarization) {
    if (!options.diarizationProvider || options.diarizationProvider === "none") {
      logger.transcriptionError("Invalid diarization configuration", {
        fileName,
        enableDiarization: options.enableDiarization,
        diarizationProvider: options.diarizationProvider,
      });
      throw new Error(
        "Diarization is enabled but no provider is selected. Please install a diarization model (pyannote or sherpa-onnx) first."
      );
    }
  }
}

export function createTask(
  path: string,
  name: string,
  size: number,
  options: TranscriptionOptions,
  validatedOptions?: TranscriptionOptions
): TranscriptionTask {
  const finalOptions = validatedOptions ?? options;
  const id = crypto.randomUUID();
  return {
    id,
    fileName: name,
    filePath: path,
    fileSize: size,
    status: "queued",
    progress: 0,
    options: finalOptions,
    result: null,
    error: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
}
