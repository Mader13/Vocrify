import { describe, expect, it } from "vitest";

import {
  getSmoothedPointerVelocity,
  getSnapDurationMs,
  getThrowTargetCorner,
} from "@/components/features/miniplayer-physics";

describe("getThrowTargetCorner", () => {
  it("uses release point when there is no throw velocity", () => {
    expect(
      getThrowTargetCorner({
        releaseX: 200,
        releaseY: 700,
        velocityX: 0,
        velocityY: 0,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toBe("bottom-left");
  });

  it("sends the player to top-left when flicked in that direction", () => {
    expect(
      getThrowTargetCorner({
        releaseX: 700,
        releaseY: 550,
        velocityX: -2.4,
        velocityY: -2.1,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toBe("top-left");
  });

  it("sends the player to top-right when flicked in that direction", () => {
    expect(
      getThrowTargetCorner({
        releaseX: 500,
        releaseY: 500,
        velocityX: 2.8,
        velocityY: -2.4,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toBe("top-right");
  });

  it("uses vertical throw intent even if release is still in bottom half", () => {
    expect(
      getThrowTargetCorner({
        releaseX: 180,
        releaseY: 760,
        velocityX: -0.25,
        velocityY: -0.95,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toBe("top-left");
  });
});

describe("getSnapDurationMs", () => {
  it("returns longer animations for faster flicks", () => {
    expect(getSnapDurationMs(0)).toBe(220);
    expect(getSnapDurationMs(1.5)).toBeGreaterThan(220);
    expect(getSnapDurationMs(10)).toBe(520);
  });
});

describe("getSmoothedPointerVelocity", () => {
  it("still computes throw velocity on high-polling pointer updates", () => {
    const velocity = getSmoothedPointerVelocity(
      { x: 100, y: 400, time: 1000 },
      { x: 96, y: 392, time: 1008 },
      { x: 0, y: 0 }
    );

    expect(velocity.x).toBeLessThan(0);
    expect(velocity.y).toBeLessThan(0);
  });
});
