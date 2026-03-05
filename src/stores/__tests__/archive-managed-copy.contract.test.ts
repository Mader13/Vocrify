import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("archive managed copy contract", () => {
  it("prefers managed copy as archive source when available", () => {
    const source = readFileSync(join(process.cwd(), "src", "stores", "_store.ts"), "utf8");

    expect(source).toContain("const sourcePath = task.managedCopyPath ?? task.filePath");
    expect(source).toContain("sourceWasManagedCopy");
  });

  it("transfers managed copy pointer to archived media path", () => {
    const source = readFileSync(join(process.cwd(), "src", "stores", "_store.ts"), "utf8");

    expect(source).toContain("managedCopyPath: sourceWasManagedCopy && audioPath ? audioPath : t.managedCopyPath");
    expect(source).toContain("deleteFile(task.managedCopyPath)");
  });
});
