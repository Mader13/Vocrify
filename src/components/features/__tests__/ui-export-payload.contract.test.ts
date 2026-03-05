import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("UI-export payload contract", () => {
  it("maps speaker names in CompletedView before rendering segments", () => {
    const completedViewSource = readFileSync(
      join(process.cwd(), "src", "components", "features", "CompletedView.tsx"),
      "utf8",
    );

    expect(completedViewSource).toContain("applySpeakerNameMapToResult(");
    expect(completedViewSource).toContain("task.result,");
    expect(completedViewSource).toContain("task.speakerNameMap");
    expect(completedViewSource).toContain("sanitizeSegments(mappedResult?.segments)");
  });

  it("maps speaker names in ExportMenu and exports the mapped result", () => {
    const exportMenuSource = readFileSync(
      join(process.cwd(), "src", "components", "features", "ExportMenu.tsx"),
      "utf8",
    );

    expect(exportMenuSource).toContain("applySpeakerNameMapToResult(");
    expect(exportMenuSource).toContain("task.result,");
    expect(exportMenuSource).toContain("task.speakerNameMap");
    expect(exportMenuSource).toContain("const resultToExport = applySpeakerNameMapToResult(");
    expect(exportMenuSource).toContain("exportTranscription(");
    expect(exportMenuSource).toContain("resultToExport,");
  });
});
