import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("store actions contract", () => {
  it("keeps task and settings actions in a single store source of truth", () => {
    const storeSource = readFileSync(join(process.cwd(), "src", "stores", "index.ts"), "utf8");

    expect(storeSource).toContain("updateTaskStatus");
    expect(storeSource).toContain("updateSettings");
    expect(storeSource).toContain("archiveTask");
  });

  it("removes duplicate pure action helper files", () => {
    const duplicates = [
      join(process.cwd(), "src", "stores", "actions", "task-actions.ts"),
      join(process.cwd(), "src", "stores", "actions", "settings-actions.ts"),
      join(process.cwd(), "src", "stores", "actions", "archive-actions.ts"),
    ];

    for (const filePath of duplicates) {
      expect(existsSync(filePath)).toBe(false);
    }
  });
});
