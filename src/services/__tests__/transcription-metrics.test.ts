import { describe, expect, it } from "vitest";

import { formatPerformanceMetrics } from "@/lib/logger";
import type { ProgressMetrics, TranscriptionResult } from "@/types";

describe("transcription metrics contract", () => {
  it("supports stage-level metrics in ProgressMetrics and result payload", () => {
    const metrics: ProgressMetrics = {
      modelLoadMs: 100,
      decodeMs: 200,
      inferenceMs: 1500,
      diarizationMs: 400,
      totalMs: 2200,
    };

    const result: TranscriptionResult = {
      segments: [],
      language: "en",
      duration: 0,
      metrics,
    };

    expect(result.metrics?.totalMs).toBe(2200);
    expect(formatPerformanceMetrics(metrics)).toContain("total=2200ms");
  });
});
