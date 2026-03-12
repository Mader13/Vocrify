import type { TranscriptionTask } from "@/types";

import { isVideoFile } from "@/lib/utils";

type MediaKind = "video" | "audio" | "none";
type MediaOrigin = "managed_copy" | "original_file" | "archive_file" | "archive_audio" | "none";

interface ResolvedTaskMediaSource {
  path?: string;
  mediaKind: MediaKind;
  origin: MediaOrigin;
  hasPlayableMedia: boolean;
}

function toPlayablePath(path: string | undefined): string | undefined {
  const normalized = path?.trim();
  return normalized ? normalized : undefined;
}

function detectMediaKind(path: string | undefined): MediaKind {
  if (!path) {
    return "none";
  }

  return isVideoFile(path) ? "video" : "audio";
}

function resolveActiveMediaSource(task: TranscriptionTask): ResolvedTaskMediaSource {
  const path = task.managedCopyStatus === "done"
    ? toPlayablePath(task.managedCopyPath) ?? toPlayablePath(task.filePath)
    : toPlayablePath(task.filePath);
  const origin: MediaOrigin = task.managedCopyStatus === "done" && toPlayablePath(task.managedCopyPath)
    ? "managed_copy"
    : path
      ? "original_file"
      : "none";

  return { path, mediaKind: detectMediaKind(path), origin, hasPlayableMedia: Boolean(path) };
}

function resolveArchivedMediaSource(task: TranscriptionTask): ResolvedTaskMediaSource {
  if (task.archiveMode === "keep_all") {
    const path = toPlayablePath(task.filePath);
    return { path, mediaKind: detectMediaKind(path), origin: path ? "archive_file" : "none", hasPlayableMedia: Boolean(path) };
  }

  if (task.archiveMode === "delete_video") {
    const path = toPlayablePath(task.audioPath);
    return { path, mediaKind: path ? "audio" : "none", origin: path ? "archive_audio" : "none", hasPlayableMedia: Boolean(path) };
  }

  return { mediaKind: "none", origin: "none", hasPlayableMedia: false };
}

export function resolveTaskMediaSource(task: TranscriptionTask): ResolvedTaskMediaSource {
  if (task.archived) {
    return resolveArchivedMediaSource(task);
  }

  return resolveActiveMediaSource(task);
}
