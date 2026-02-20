import type { MiniPlayerPosition } from '@/stores/playbackStore';

const THROW_LOOKAHEAD_MS = 220;
const BASE_SNAP_DURATION_MS = 220;
const MAX_SNAP_DURATION_MS = 520;
const DURATION_SPEED_MULTIPLIER = 140;
const AXIS_INTENT_THRESHOLD = 0.55;

type ThrowTargetInput = {
  releaseX: number;
  releaseY: number;
  velocityX: number;
  velocityY: number;
  viewportWidth: number;
  viewportHeight: number;
};

type PointerSample = {
  x: number;
  y: number;
  time: number;
};

type PointerVelocity = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveAxisByThrow(
  projectedCoord: number,
  velocity: number,
  midpoint: number,
  negativeDirectionWhenThrown: boolean
): boolean {
  if (Math.abs(velocity) >= AXIS_INTENT_THRESHOLD) {
    return negativeDirectionWhenThrown ? velocity < 0 : velocity > 0;
  }

  return projectedCoord < midpoint;
}

export function getThrowTargetCorner(input: ThrowTargetInput): MiniPlayerPosition {
  const projectedX = input.releaseX + input.velocityX * THROW_LOOKAHEAD_MS;
  const projectedY = input.releaseY + input.velocityY * THROW_LOOKAHEAD_MS;

  const clampedX = clamp(projectedX, 0, input.viewportWidth);
  const clampedY = clamp(projectedY, 0, input.viewportHeight);

  const isLeft = resolveAxisByThrow(clampedX, input.velocityX, input.viewportWidth / 2, true);
  const isTop = resolveAxisByThrow(clampedY, input.velocityY, input.viewportHeight / 2, true);

  if (isTop && isLeft) return 'top-left';
  if (isTop && !isLeft) return 'top-right';
  if (!isTop && isLeft) return 'bottom-left';
  return 'bottom-right';
}

export function getSmoothedPointerVelocity(
  previous: PointerSample,
  next: PointerSample,
  previousVelocity: PointerVelocity
): PointerVelocity {
  const deltaTime = Math.max(next.time - previous.time, 1);
  const nextVelocityX = (next.x - previous.x) / deltaTime;
  const nextVelocityY = (next.y - previous.y) / deltaTime;

  return {
    x: previousVelocity.x * 0.35 + nextVelocityX * 0.65,
    y: previousVelocity.y * 0.35 + nextVelocityY * 0.65,
  };
}

export function getSnapDurationMs(speedPxPerMs: number): number {
  const duration = BASE_SNAP_DURATION_MS + speedPxPerMs * DURATION_SPEED_MULTIPLIER;
  return clamp(duration, BASE_SNAP_DURATION_MS, MAX_SNAP_DURATION_MS);
}
