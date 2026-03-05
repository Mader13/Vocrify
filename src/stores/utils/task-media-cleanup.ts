import type { TranscriptionTask } from "@/types";

function toValidPath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function pushUniquePath(target: string[], seen: Set<string>, path: string | undefined): void {
  const normalized = toValidPath(path);
  if (!normalized) {
    return;
  }

  const key = normalized.toLowerCase();
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push(normalized);
}

export function getStoredMediaPathsForDeletion(task: TranscriptionTask): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  pushUniquePath(paths, seen, task.managedCopyPath);

  if (!task.archived) {
    return paths;
  }

  if (task.archiveMode === "keep_all") {
    pushUniquePath(paths, seen, task.filePath);
  }

  if (task.archiveMode === "delete_video") {
    pushUniquePath(paths, seen, task.audioPath);
  }

  return paths;
}
