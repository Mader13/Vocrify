export const DEFAULT_VIDEO_ASPECT_RATIO = 16 / 9;
export const MIN_VIDEO_ASPECT_RATIO = 9 / 16;
export const MAX_VIDEO_ASPECT_RATIO = 21 / 9;
export const SPLIT_LAYOUT_MIN_WIDTH = 910;
export const SPLIT_LAYOUT_SIDEBAR_EXPANDED_OFFSET = 180;

export type CompletedViewLayoutMode = "stacked" | "split";

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
  options?: CompletedViewLayoutOptions,
): CompletedViewLayoutMode {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return "stacked";
  }

  const splitThreshold = getCompletedViewSplitThreshold(options);

  return containerWidth >= splitThreshold ? "split" : "stacked";
}
