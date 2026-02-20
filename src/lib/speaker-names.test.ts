import { describe, expect, it } from "vitest";

import type { TranscriptionResult } from "@/types";
import {
  applySpeakerNameMapToResult,
  collectSpeakerLabels,
  normalizeSpeakerNameMap,
} from "@/lib/speaker-names";

function createResult(): TranscriptionResult {
  return {
    language: "en",
    duration: 30,
    segments: [
      { start: 0, end: 3, text: "hello", speaker: "SPEAKER_00", confidence: 0.9 },
      { start: 3, end: 5, text: "world", speaker: "SPEAKER_01", confidence: 0.8 },
      { start: 5, end: 7, text: "none", speaker: null, confidence: 0.7 },
    ],
    speakerTurns: [
      { start: 0, end: 3, speaker: "SPEAKER_00" },
      { start: 3, end: 5, speaker: "SPEAKER_01" },
    ],
    speakerSegments: [
      { start: 0, end: 3, text: "hello", speaker: "SPEAKER_00", confidence: 0.9 },
      { start: 3, end: 5, text: "world", speaker: "SPEAKER_01", confidence: 0.8 },
    ],
  };
}

describe("normalizeSpeakerNameMap", () => {
  it("drops empty values and trims names", () => {
    const normalized = normalizeSpeakerNameMap({
      SPEAKER_00: "  Winnie  ",
      SPEAKER_01: "   ",
      SPEAKER_02: "",
    });

    expect(normalized).toEqual({ SPEAKER_00: "Winnie" });
  });
});

describe("collectSpeakerLabels", () => {
  it("collects unique speaker labels from all result fields", () => {
    const labels = collectSpeakerLabels(createResult());

    expect(labels).toEqual(["SPEAKER_00", "SPEAKER_01"]);
  });
});

describe("applySpeakerNameMapToResult", () => {
  it("applies renamed speakers to segments, speaker segments, and speaker turns", () => {
    const source = createResult();

    const mapped = applySpeakerNameMapToResult(source, {
      SPEAKER_00: "Winnie",
      SPEAKER_01: "Piglet",
    });

    expect(mapped.segments[0]?.speaker).toBe("Winnie");
    expect(mapped.segments[1]?.speaker).toBe("Piglet");
    expect(mapped.speakerSegments?.[0]?.speaker).toBe("Winnie");
    expect(mapped.speakerSegments?.[1]?.speaker).toBe("Piglet");
    expect(mapped.speakerTurns?.[0]?.speaker).toBe("Winnie");
    expect(mapped.speakerTurns?.[1]?.speaker).toBe("Piglet");
  });

  it("keeps unknown and null speakers unchanged", () => {
    const source = createResult();

    const mapped = applySpeakerNameMapToResult(source, {
      SPEAKER_00: "Winnie",
    });

    expect(mapped.segments[0]?.speaker).toBe("Winnie");
    expect(mapped.segments[1]?.speaker).toBe("SPEAKER_01");
    expect(mapped.segments[2]?.speaker).toBeNull();
  });

  it("returns a new object and does not mutate source", () => {
    const source = createResult();
    const originalSpeaker = source.segments[0]?.speaker;

    const mapped = applySpeakerNameMapToResult(source, {
      SPEAKER_00: "Winnie",
    });

    expect(mapped).not.toBe(source);
    expect(source.segments[0]?.speaker).toBe(originalSpeaker);
    expect(source.segments[0]?.speaker).toBe("SPEAKER_00");
    expect(mapped.segments[0]?.speaker).toBe("Winnie");
  });
});
