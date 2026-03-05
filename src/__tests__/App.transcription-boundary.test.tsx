import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app transcription boundary", () => {
  it("keeps transport event wiring out of App component", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

    expect(appSource).not.toContain("onProgressUpdate");
    expect(appSource).not.toContain("onTranscriptionError");
    expect(appSource).not.toContain("onSegmentUpdate");
    expect(appSource).toContain("subscribeToTranscriptionRuntime");
  });
});
