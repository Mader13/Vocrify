export const DEFAULT_VIDEO_ASPECT_RATIO = 16 / 9;
export const MIN_VIDEO_ASPECT_RATIO = 9 / 16;
export const MAX_VIDEO_ASPECT_RATIO = 21 / 9;
export const SPLIT_LAYOUT_MIN_WIDTH = 980;
export const SPLIT_LAYOUT_SIDEBAR_EXPANDED_OFFSET = 180;
export const SPLIT_LAYOUT_MIN_HEIGHT = 560;
export const COMPLETED_VIEW_COMPACT_WIDTH = 720;
export const COMPLETED_VIEW_MICRO_WIDTH = 560;
export const COMPLETED_VIEW_COMPACT_HEIGHT = 700;
export const COMPLETED_VIEW_MICRO_HEIGHT = 620;
export const VIDEO_OVERLAY_COMPACT_WIDTH = 560;
export const VIDEO_OVERLAY_MICRO_WIDTH = 460;

export type CompletedViewLayoutMode = "stacked" | "split";
export type CompletedViewDensity = "regular" | "compact" | "micro";

export function normalizeVideoAspectRatio(videoWidth: number, videoHeight: number): number {
  if (videoWidth <= 0 || videoHeight <= 0) {
    return DEFAULT_VIDEO_ASPECT_RATIO;
  }

  const rawRatio = videoWidth / videoHeight;
  if (!Number.isFinite(rawRatio)) {
    return DEFAULT_VIDEO_ASPECT_RATIO;
  }

  return Math.min(Math.max(rawRatio, MIN_VIDEO_ASPECT_RATIO), MAX_VIDEO_ASPECT_RATIO);
}

interface CompletedViewLayoutOptions {
  sidebarCollapsed?: boolean;
}

export function getCompletedViewSplitThreshold(options?: CompletedViewLayoutOptions): number {
  return options?.sidebarCollapsed
    ? SPLIT_LAYOUT_MIN_WIDTH
    : SPLIT_LAYOUT_MIN_WIDTH + SPLIT_LAYOUT_SIDEBAR_EXPANDED_OFFSET;
}

export function getCompletedViewLayoutMode(
  containerWidth: number,
  containerHeight?: number,
  options?: CompletedViewLayoutOptions,
): CompletedViewLayoutMode {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return "stacked";
  }

  const splitThreshold = getCompletedViewSplitThreshold(options);

  if (Number.isFinite(containerHeight) && containerHeight !== undefined) {
    if (containerHeight <= 0 || containerHeight < SPLIT_LAYOUT_MIN_HEIGHT) {
      return "stacked";
    }
  }

  return containerWidth >= splitThreshold ? "split" : "stacked";
}

function getDensityFromValue(value: number, compactThreshold: number, microThreshold: number): CompletedViewDensity {
  if (!Number.isFinite(value) || value <= 0) {
    return "regular";
  }

  if (value <= microThreshold) {
    return "micro";
  }

  if (value <= compactThreshold) {
    return "compact";
  }

  return "regular";
}

export function getCompletedViewLayoutDensity(
  containerWidth: number,
  containerHeight: number,
): CompletedViewDensity {
  const widthDensity = getDensityFromValue(
    containerWidth,
    COMPLETED_VIEW_COMPACT_WIDTH,
    COMPLETED_VIEW_MICRO_WIDTH,
  );
  const heightDensity = getDensityFromValue(
    containerHeight,
    COMPLETED_VIEW_COMPACT_HEIGHT,
    COMPLETED_VIEW_MICRO_HEIGHT,
  );

  const densityRank: Record<CompletedViewDensity, number> = {
    regular: 0,
    compact: 1,
    micro: 2,
  };

  return densityRank[widthDensity] >= densityRank[heightDensity]
    ? widthDensity
    : heightDensity;
}
