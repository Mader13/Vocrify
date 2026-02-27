import type { TranscriptionSegment } from "@/types";

export function sanitizeSegments(
  segments?: TranscriptionSegment[],
): TranscriptionSegment[] {
  if (!segments || segments.length === 0) return [];

  const valid = segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => ({
      ...s,
      start: Math.max(0, s.start),
      end: Math.max(0, s.end),
    }))
    .sort((a, b) => (a.start - b.start) || (a.end - b.end));

  if (valid.length <= 1) return valid;

  const epsilon = 0.05;
  const minStart = Math.min(...valid.map((s) => s.start));
  const maxEnd = Math.max(...valid.map((s) => s.end));

  const removeIndexes = new Set<number>();

  valid.forEach((candidate, idx) => {
    const isFullRange = candidate.start <= minStart + epsilon && candidate.end >= maxEnd - epsilon;
    if (!isFullRange) return;

    const nestedCount = valid.filter((s, i) => {
      if (i === idx) return false;
      return s.start >= candidate.start - epsilon && s.end <= candidate.end + epsilon;
    }).length;

    if (nestedCount >= 2) {
      removeIndexes.add(idx);
    }
  });

  if (removeIndexes.size === 0) return valid;
  return valid.filter((_, idx) => !removeIndexes.has(idx));
}
