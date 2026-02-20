import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  MAX_VIDEO_ASPECT_RATIO,
  MIN_VIDEO_ASPECT_RATIO,
  SPLIT_LAYOUT_MIN_WIDTH,
  SPLIT_LAYOUT_SIDEBAR_EXPANDED_OFFSET,
  getCompletedViewLayoutMode,
  normalizeVideoAspectRatio,
} from "@/components/features/completed-view-layout";

describe("normalizeVideoAspectRatio", () => {
  it("returns default ratio when metadata is invalid", () => {
    expect(normalizeVideoAspectRatio(0, 0)).toBe(DEFAULT_VIDEO_ASPECT_RATIO);
    expect(normalizeVideoAspectRatio(-320, 180)).toBe(DEFAULT_VIDEO_ASPECT_RATIO);
    expect(normalizeVideoAspectRatio(1920, -1080)).toBe(DEFAULT_VIDEO_ASPECT_RATIO);
  });

  it("clamps very tall videos to minimum ratio", () => {
    expect(normalizeVideoAspectRatio(720, 2560)).toBe(MIN_VIDEO_ASPECT_RATIO);
  });

  it("clamps very wide videos to maximum ratio", () => {
    expect(normalizeVideoAspectRatio(3840, 900)).toBe(MAX_VIDEO_ASPECT_RATIO);
  });

  it("keeps common aspect ratios unchanged", () => {
    expect(normalizeVideoAspectRatio(1920, 1080)).toBeCloseTo(16 / 9, 6);
    expect(normalizeVideoAspectRatio(1080, 1920)).toBeCloseTo(9 / 16, 6);
    expect(normalizeVideoAspectRatio(1080, 1080)).toBe(1);
  });
});

describe("getCompletedViewLayoutMode", () => {
  it("uses stacked mode for invalid widths", () => {
    expect(getCompletedViewLayoutMode(0)).toBe("stacked");
    expect(getCompletedViewLayoutMode(-200)).toBe("stacked");
    expect(getCompletedViewLayoutMode(Number.NaN)).toBe("stacked");
  });

  it("uses stacked mode below split threshold", () => {
    expect(getCompletedViewLayoutMode(SPLIT_LAYOUT_MIN_WIDTH - 1)).toBe("stacked");
  });

  it("uses split mode on and above threshold", () => {
    expect(getCompletedViewLayoutMode(SPLIT_LAYOUT_MIN_WIDTH, { sidebarCollapsed: true })).toBe("split");
    expect(getCompletedViewLayoutMode(SPLIT_LAYOUT_MIN_WIDTH + 240, { sidebarCollapsed: true })).toBe("split");
  });

  it("requires wider container when sidebar is expanded", () => {
    const expandedThreshold = SPLIT_LAYOUT_MIN_WIDTH + SPLIT_LAYOUT_SIDEBAR_EXPANDED_OFFSET;
    expect(getCompletedViewLayoutMode(expandedThreshold - 1, { sidebarCollapsed: false })).toBe("stacked");
    expect(getCompletedViewLayoutMode(expandedThreshold, { sidebarCollapsed: false })).toBe("split");
  });
});
