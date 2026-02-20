import type { TranscriptionResult } from "@/types";

export type SpeakerNameMap = Record<string, string>;

function mapSpeakerLabel(
  speaker: string | null | undefined,
  speakerNameMap?: SpeakerNameMap,
): string | null {
  if (!speaker) {
    return null;
  }

  const mapped = speakerNameMap?.[speaker];
  if (!mapped) {
    return speaker;
  }

  return mapped;
}

export function normalizeSpeakerNameMap(
  speakerNameMap: Record<string, string | null | undefined>,
): SpeakerNameMap {
  return Object.entries(speakerNameMap).reduce<SpeakerNameMap>((acc, [speaker, name]) => {
    if (!name) {
      return acc;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      return acc;
    }

    acc[speaker] = trimmed;
    return acc;
  }, {});
}

export function collectSpeakerLabels(result?: TranscriptionResult | null): string[] {
  if (!result) {
    return [];
  }

  const labels = new Set<string>();

  result.segments.forEach((segment) => {
    if (segment.speaker) {
      labels.add(segment.speaker);
    }
  });

  result.speakerSegments?.forEach((segment) => {
    if (segment.speaker) {
      labels.add(segment.speaker);
    }
  });

  result.speakerTurns?.forEach((turn) => {
    if (turn.speaker) {
      labels.add(turn.speaker);
    }
  });

  return Array.from(labels).sort((a, b) => a.localeCompare(b));
}

export function applySpeakerNameMapToResult(
  result: TranscriptionResult,
  speakerNameMap?: SpeakerNameMap,
): TranscriptionResult {
  if (!speakerNameMap || Object.keys(speakerNameMap).length === 0) {
    return {
      ...result,
      segments: result.segments.map((segment) => ({ ...segment })),
      speakerSegments: result.speakerSegments?.map((segment) => ({ ...segment })),
      speakerTurns: result.speakerTurns?.map((turn) => ({ ...turn })),
    };
  }

  return {
    ...result,
    segments: result.segments.map((segment) => ({
      ...segment,
      speaker: mapSpeakerLabel(segment.speaker, speakerNameMap),
    })),
    speakerSegments: result.speakerSegments?.map((segment) => ({
      ...segment,
      speaker: mapSpeakerLabel(segment.speaker, speakerNameMap),
    })),
    speakerTurns: result.speakerTurns?.map((turn) => ({
      ...turn,
      speaker: mapSpeakerLabel(turn.speaker, speakerNameMap) ?? turn.speaker,
    })),
  };
}
