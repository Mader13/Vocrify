import { describe, expect, it } from "vitest";

import { canArchiveTask } from "@/stores/utils/archive-eligibility";

describe("canArchiveTask", () => {
  it("returns false for cancelled tasks", () => {
    expect(canArchiveTask({ status: "cancelled", archived: false })).toBe(false);
  });

  it("returns true for completed tasks", () => {
    expect(canArchiveTask({ status: "completed", archived: false })).toBe(true);
  });
});
