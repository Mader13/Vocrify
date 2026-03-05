import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import type { CommandResult } from "@/services/tauri/core";
import type { TaskStatus, TranscriptionTask } from "@/types";

const FALLBACK_TASKS_STORAGE_KEY = "vocrify-task-snapshots";
const LEGACY_PERSIST_STORAGE_KEY = "vocrify-tasks";

const TASK_STATUSES: TaskStatus[] = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

type SerializedTask = Omit<
  TranscriptionTask,
  "createdAt" | "startedAt" | "completedAt" | "archivedAt" | "managedCopyCreatedAt"
> & {
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  archivedAt?: string;
  managedCopyCreatedAt?: string;
};

interface RustTaskMetadata {
  id?: unknown;
  fileName?: unknown;
  file_name?: unknown;
  filePath?: unknown;
  file_path?: unknown;
  status?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  completedAt?: unknown;
  completed_at?: unknown;
  duration?: unknown;
  segmentCount?: unknown;
  segment_count?: unknown;
  hasResult?: unknown;
  has_result?: unknown;
  fileSizeBytes?: unknown;
  file_size_bytes?: unknown;
}

/**
 * Task metadata returned from list_transcriptions
 */
export interface TaskMetadata {
  id: string;
  fileName: string;
  filePath: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  duration: number | null;
  segmentCount: number | null;
  hasResult: boolean;
  fileSizeBytes: number;
}

/**
 * Storage information returned from get_storage_info
 */
export interface StorageInfo {
  directory: string;
  taskCount: number;
  totalSizeBytes: number;
}

export interface StorageLocation {
  directory: string;
  isDefault: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function normalizeStatus(value: unknown): TaskStatus {
  if (typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus)) {
    return value as TaskStatus;
  }
  return "queued";
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function toIsoString(value: unknown): string | null {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
}

function normalizeOptions(value: unknown): TranscriptionTask["options"] {
  const options = isRecord(value) ? value : {};
  const diarizationProvider = options.diarizationProvider ?? options.diarization_provider;
  const audioProfile = options.audioProfile ?? options.audio_profile;

  return {
    model:
      typeof options.model === "string"
        ? (options.model as TranscriptionTask["options"]["model"])
        : "whisper-base",
    device:
      typeof options.device === "string"
        ? (options.device as TranscriptionTask["options"]["device"])
        : "auto",
    language:
      typeof options.language === "string"
        ? (options.language as TranscriptionTask["options"]["language"])
        : "auto",
    enableDiarization: Boolean(options.enableDiarization ?? options.enable_diarization),
    diarizationProvider:
      typeof diarizationProvider === "string"
        ? (diarizationProvider as TranscriptionTask["options"]["diarizationProvider"])
        : "none",
    numSpeakers: toNumber(options.numSpeakers ?? options.num_speakers, 2),
    audioProfile:
      typeof audioProfile === "string"
        ? (audioProfile as TranscriptionTask["options"]["audioProfile"])
        : "standard",
  };
}

function normalizeArchiveMode(value: unknown): TranscriptionTask["archiveMode"] {
  if (value === "keep_all" || value === "delete_video" || value === "text_only") {
    return value;
  }
  return undefined;
}

function normalizeSpeakerNameMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const speakerNameMap: Record<string, string> = {};
  for (const [speaker, name] of Object.entries(value)) {
    if (typeof name === "string") {
      speakerNameMap[speaker] = name;
    }
  }

  return Object.keys(speakerNameMap).length > 0 ? speakerNameMap : undefined;
}

function normalizeTask(rawTask: unknown): TranscriptionTask | null {
  if (!isRecord(rawTask)) {
    return null;
  }

  const id = toOptionalString(rawTask.id);
  const fileName =
    toOptionalString(rawTask.fileName) ?? toOptionalString(rawTask.file_name);

  if (!id || !fileName) {
    return null;
  }

  const status = normalizeStatus(rawTask.status);
  const filePath =
    toOptionalString(rawTask.filePath) ?? toOptionalString(rawTask.file_path);
  const createdAt =
    parseDate(rawTask.createdAt ?? rawTask.created_at) ?? new Date();
  const startedAt = parseDate(rawTask.startedAt ?? rawTask.started_at);
  const completedAt = parseDate(rawTask.completedAt ?? rawTask.completed_at);
  const archivedAt = parseDate(rawTask.archivedAt ?? rawTask.archived_at);
  const managedCopyCreatedAt = parseDate(
    rawTask.managedCopyCreatedAt ?? rawTask.managed_copy_created_at,
  );
  const archiveMode = normalizeArchiveMode(rawTask.archiveMode ?? rawTask.archive_mode);
  const result =
    rawTask.result === null || rawTask.result === undefined
      ? null
      : (rawTask.result as TranscriptionTask["result"]);
  const fileSize = toNumber(rawTask.fileSize ?? rawTask.file_size, 0);
  const rawProgress = toOptionalNumber(rawTask.progress);
  const progress =
    status === "completed"
      ? Math.max(rawProgress ?? 0, 100)
      : rawProgress ?? 0;
  const stage = toOptionalString(rawTask.stage) as TranscriptionTask["stage"];
  const metrics = isRecord(rawTask.metrics)
    ? (rawTask.metrics as TranscriptionTask["metrics"])
    : undefined;
  const streamingSegments = Array.isArray(rawTask.streamingSegments ?? rawTask.streaming_segments)
    ? ((rawTask.streamingSegments ?? rawTask.streaming_segments) as TranscriptionTask["streamingSegments"])
    : undefined;

  return {
    id,
    filePath,
    fileName,
    fileSize,
    status,
    progress,
    stage,
    options: normalizeOptions(rawTask.options),
    result,
    error: toNullableString(rawTask.error),
    createdAt,
    startedAt,
    completedAt,
    metrics,
    streamingSegments,
    archived: rawTask.archived === true,
    archivedAt: archivedAt ?? undefined,
    archiveMode,
    audioPath: toOptionalString(rawTask.audioPath ?? rawTask.audio_path),
    archiveSize: toOptionalNumber(rawTask.archiveSize ?? rawTask.archive_size),
    managedCopyPath: toOptionalString(rawTask.managedCopyPath ?? rawTask.managed_copy_path),
    managedCopySize: toOptionalNumber(rawTask.managedCopySize ?? rawTask.managed_copy_size),
    managedCopyStatus:
      rawTask.managedCopyStatus === "pending" ||
      rawTask.managedCopyStatus === "done" ||
      rawTask.managedCopyStatus === "failed"
        ? rawTask.managedCopyStatus
        : rawTask.managed_copy_status === "pending" ||
            rawTask.managed_copy_status === "done" ||
            rawTask.managed_copy_status === "failed"
          ? rawTask.managed_copy_status
          : undefined,
    managedCopyError:
      toOptionalString(rawTask.managedCopyError) ??
      toOptionalString(rawTask.managed_copy_error),
    managedCopyCreatedAt: managedCopyCreatedAt ?? undefined,
    videoDeleted:
      typeof rawTask.videoDeleted === "boolean"
        ? rawTask.videoDeleted
        : typeof rawTask.video_deleted === "boolean"
          ? rawTask.video_deleted
          : undefined,
    lastProgressUpdate: toOptionalNumber(
      rawTask.lastProgressUpdate ?? rawTask.last_progress_update,
    ),
    speakerNameMap: normalizeSpeakerNameMap(
      rawTask.speakerNameMap ?? rawTask.speaker_name_map,
    ),
  };
}

function serializeTask(task: TranscriptionTask): SerializedTask {
  const { createdAt, startedAt, completedAt, archivedAt, ...taskWithoutDates } = task;

  return {
    ...taskWithoutDates,
    createdAt: toIsoString(createdAt) ?? new Date().toISOString(),
    startedAt: toIsoString(startedAt),
    completedAt: toIsoString(completedAt),
    archivedAt: toIsoString(archivedAt) ?? undefined,
    managedCopyCreatedAt: toIsoString(task.managedCopyCreatedAt) ?? undefined,
  };
}

function readFallbackTasksMap(): Record<string, SerializedTask> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(FALLBACK_TASKS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    return parsed as Record<string, SerializedTask>;
  } catch {
    return {};
  }
}

function writeFallbackTasksMap(tasksById: Record<string, SerializedTask>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      FALLBACK_TASKS_STORAGE_KEY,
      JSON.stringify(tasksById),
    );
  } catch {
    logger.warn("Failed to write fallback task snapshots");
  }
}

function saveTaskToFallback(task: TranscriptionTask): void {
  const tasksById = readFallbackTasksMap();
  tasksById[task.id] = serializeTask(task);
  writeFallbackTasksMap(tasksById);
}

function deleteTaskFromFallback(taskId: string): void {
  const tasksById = readFallbackTasksMap();
  if (!tasksById[taskId]) {
    return;
  }
  delete tasksById[taskId];
  writeFallbackTasksMap(tasksById);
}

function getFallbackTasks(): TranscriptionTask[] {
  const tasksById = readFallbackTasksMap();
  return Object.values(tasksById)
    .map((rawTask) => normalizeTask(rawTask))
    .filter((task): task is TranscriptionTask => task !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function buildMetadataFromTask(task: TranscriptionTask): TaskMetadata {
  return {
    id: task.id,
    fileName: task.fileName,
    filePath: task.filePath ?? "",
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    duration: task.result?.duration ?? null,
    segmentCount: task.result?.segments.length ?? null,
    hasResult: task.result !== null,
    fileSizeBytes: task.fileSize,
  };
}

function normalizeMetadata(rawMetadata: unknown): TaskMetadata | null {
  if (!isRecord(rawMetadata)) {
    return null;
  }

  const metadata = rawMetadata as RustTaskMetadata;
  const id = toOptionalString(metadata.id);
  const fileName =
    toOptionalString(metadata.fileName) ?? toOptionalString(metadata.file_name);
  const filePath =
    toOptionalString(metadata.filePath) ?? toOptionalString(metadata.file_path);
  const createdAt =
    toOptionalString(metadata.createdAt) ?? toOptionalString(metadata.created_at);

  if (!id || !fileName || !createdAt) {
    return null;
  }

  return {
    id,
    fileName,
    filePath: filePath ?? "",
    status: toStringValue(metadata.status),
    createdAt,
    completedAt:
      toNullableString(metadata.completedAt) ??
      toNullableString(metadata.completed_at),
    duration:
      typeof metadata.duration === "number" ? metadata.duration : null,
    segmentCount:
      typeof metadata.segmentCount === "number"
        ? metadata.segmentCount
        : typeof metadata.segment_count === "number"
          ? metadata.segment_count
          : null,
    hasResult:
      typeof metadata.hasResult === "boolean"
        ? metadata.hasResult
        : metadata.has_result === true,
    fileSizeBytes:
      typeof metadata.fileSizeBytes === "number"
        ? metadata.fileSizeBytes
        : typeof metadata.file_size_bytes === "number"
          ? metadata.file_size_bytes
          : 0,
  };
}

/**
 * Get the transcription storage directory
 * Calls Rust get_transcription_dir command
 */
export async function getTranscriptionDir(): Promise<CommandResult<string>> {
  if (isTauriEnvironment()) {
    try {
      const result = await invoke<string>("get_transcription_dir");
      if (typeof result !== "string" || result.length === 0) {
        return { success: false, error: "Invalid transcription directory" };
      }
      logger.info("Retrieved transcription directory", { directory: result });
      return { success: true, data: result };
    } catch (error) {
      logger.error("Failed to get transcription directory", { error: String(error) });
      return { success: false, error: String(error) };
    }
  }

  return { success: false, error: "Transcription directory is available only in Tauri runtime" };
}

/**
 * Save a transcription task to persistent storage
 * Calls Rust save_transcription command with the full task object
 */
export async function saveTranscription(
  task: TranscriptionTask,
): Promise<CommandResult<void>> {
  logger.info("Saving transcription", {
    taskId: task.id,
    fileName: task.fileName,
    status: task.status,
  });

  if (isTauriEnvironment()) {
    try {
      await invoke("save_transcription", { task: serializeTask(task) });
      saveTaskToFallback(task);
      logger.info("Transcription saved successfully", { taskId: task.id });
      return { success: true };
    } catch (error) {
      logger.error("Failed to save transcription", {
        taskId: task.id,
        error: String(error),
      });
      saveTaskToFallback(task);
      return { success: false, error: String(error) };
    }
  }

  saveTaskToFallback(task);
  return { success: true };
}

/**
 * Load a transcription task from storage by ID
 * Calls Rust load_transcription command
 */
export async function loadTranscription(
  taskId: string,
): Promise<CommandResult<TranscriptionTask>> {
  logger.info("Loading transcription", { taskId });

  if (isTauriEnvironment()) {
    try {
      const result = await invoke<unknown>("load_transcription", { taskId });
      const task = normalizeTask(result);
      if (!task) {
        return { success: false, error: "Stored task has invalid shape" };
      }
      return { success: true, data: task };
    } catch (error) {
      logger.error("Failed to load transcription from backend", {
        taskId,
        error: String(error),
      });
    }
  }

  const fallbackTask = getFallbackTasks().find((task) => task.id === taskId);
  if (!fallbackTask) {
    return { success: false, error: `Transcription task not found: ${taskId}` };
  }

  return { success: true, data: fallbackTask };
}

/**
 * Delete a transcription task from storage
 * Calls Rust delete_transcription command
 */
export async function deleteTranscription(
  taskId: string,
): Promise<CommandResult<void>> {
  logger.info("Deleting transcription", { taskId });

  if (isTauriEnvironment()) {
    try {
      await invoke("delete_transcription", { taskId });
      deleteTaskFromFallback(taskId);
      return { success: true };
    } catch (error) {
      logger.error("Failed to delete transcription", {
        taskId,
        error: String(error),
      });
      deleteTaskFromFallback(taskId);
      return { success: false, error: String(error) };
    }
  }

  deleteTaskFromFallback(taskId);
  return { success: true };
}

/**
 * List all transcription tasks with metadata
 * Calls Rust list_transcriptions command
 */
export async function listTranscriptions(): Promise<
  CommandResult<TaskMetadata[]>
> {
  logger.info("Listing transcriptions");

  if (isTauriEnvironment()) {
    try {
      const rawResult = await invoke<unknown>("list_transcriptions");
      if (!Array.isArray(rawResult)) {
        return { success: false, error: "Invalid list_transcriptions response" };
      }

      const metadata = rawResult
        .map((item) => normalizeMetadata(item))
        .filter((item): item is TaskMetadata => item !== null)
        .sort((a, b) => {
          const aTime = parseDate(a.createdAt)?.getTime() ?? 0;
          const bTime = parseDate(b.createdAt)?.getTime() ?? 0;
          return bTime - aTime;
        });

      return { success: true, data: metadata };
    } catch (error) {
      logger.error("Failed to list transcriptions", {
        error: String(error),
      });
      const fallbackMetadata = getFallbackTasks().map(buildMetadataFromTask);
      if (fallbackMetadata.length > 0) {
        return { success: true, data: fallbackMetadata };
      }
      return { success: false, error: String(error) };
    }
  }

  return { success: true, data: getFallbackTasks().map(buildMetadataFromTask) };
}

/**
 * Load all tasks from persistent storage.
 */
export async function loadAllTranscriptions(): Promise<
  CommandResult<TranscriptionTask[]>
> {
  const listed = await listTranscriptions();
  if (!listed.success || !listed.data) {
    return {
      success: false,
      error: listed.error ?? "Failed to list stored transcription tasks",
    };
  }

  const loaded = await Promise.all(
    listed.data.map(async (taskMetadata) => {
      const taskResult = await loadTranscription(taskMetadata.id);
      return taskResult.success ? taskResult.data ?? null : null;
    }),
  );

  const tasks = loaded
    .filter((task): task is TranscriptionTask => task !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return { success: true, data: tasks };
}

/**
 * Read legacy tasks persisted by Zustand under the old `vocrify-tasks` key.
 */
export function loadLegacyPersistedTasks(): TranscriptionTask[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_PERSIST_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.state)) {
      return [];
    }

    const tasks = Array.isArray(parsed.state.tasks) ? parsed.state.tasks : [];
    return tasks
      .map((task) => normalizeTask(task))
      .filter((task): task is TranscriptionTask => task !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch {
    return [];
  }
}

/**
 * Remove legacy tasks from old Zustand persistence while preserving settings.
 */
export function clearLegacyPersistedTasks(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_PERSIST_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.state)) {
      return;
    }

    parsed.state = {
      ...parsed.state,
      tasks: [],
    };

    window.localStorage.setItem(LEGACY_PERSIST_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    logger.warn("Failed to clear legacy persisted tasks");
  }
}

/**
 * Get storage directory information
 * Calls Rust get_storage_info command
 */
export async function getStorageInfo(): Promise<CommandResult<StorageInfo>> {
  if (isTauriEnvironment()) {
    try {
      const rawResult = await invoke<unknown>("get_storage_info");
      if (!isRecord(rawResult)) {
        return { success: false, error: "Invalid get_storage_info response" };
      }

      const taskCount = toNumber(rawResult.taskCount ?? rawResult.task_count, 0);
      const totalSizeBytes = toNumber(
        rawResult.totalSizeBytes ?? rawResult.total_size_bytes,
        0,
      );
      const directory = toStringValue(rawResult.directory);

      return {
        success: true,
        data: {
          directory,
          taskCount,
          totalSizeBytes,
        },
      };
    } catch (error) {
      logger.error("Failed to get storage info", { error: String(error) });
      return { success: false, error: String(error) };
    }
  }

  const fallbackTasks = getFallbackTasks();
  const totalSizeBytes = fallbackTasks.reduce((sum, task) => sum + task.fileSize, 0);

  return {
    success: true,
    data: {
      directory: "localStorage",
      taskCount: fallbackTasks.length,
      totalSizeBytes,
    },
  };
}

export async function getManagedCopyStorageDirectory(): Promise<CommandResult<string>> {
  try {
    const location = await invoke<unknown>("get_storage_location");
    if (!isRecord(location)) {
      return { success: false, error: "Invalid get_storage_location response" };
    }

    const directory = toStringValue(location.directory);
    if (!directory) {
      return { success: false, error: "Storage directory is empty" };
    }

    return { success: true, data: directory };
  } catch (error) {
    logger.warn("Failed to get managed storage directory via get_storage_location, falling back", {
      error: String(error),
    });

    try {
      const fallbackDir = await invoke<string>("get_transcription_dir");
      if (typeof fallbackDir === "string" && fallbackDir.length > 0) {
        return { success: true, data: fallbackDir };
      }
      return { success: false, error: "Failed to resolve fallback transcription directory" };
    } catch (fallbackError) {
      logger.error("Failed to get managed storage directory", {
        error: String(error),
        fallbackError: String(fallbackError),
      });
      return { success: false, error: String(fallbackError) };
    }
  }
}

export async function setManagedCopyStorageDirectory(directory: string): Promise<CommandResult<string>> {
  try {
    const location = await invoke<unknown>("set_storage_location", { directory });
    if (!isRecord(location)) {
      return { success: false, error: "Invalid set_storage_location response" };
    }

    const normalizedDirectory = toStringValue(location.directory);
    if (!normalizedDirectory) {
      return { success: false, error: "Storage directory is empty" };
    }

    return { success: true, data: normalizedDirectory };
  } catch (error) {
    logger.error("Failed to set managed storage directory", { directory, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function openManagedCopyStorageDirectory(): Promise<CommandResult<void>> {
  try {
    await invoke("open_storage_location_command");
    return { success: true };
  } catch (error) {
    logger.error("Failed to open managed storage directory", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
