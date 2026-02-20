import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { shouldUseRustEngine } from "@/services/transcription";

describe("transcription legacy compatibility guard", () => {
  it("does not advertise unsupported sensevoice path in rust routing", () => {
    expect(shouldUseRustEngine("sensevoice-small")).toBe(false);
  });

  it("removes deprecated rust-whisper Cargo feature", () => {
    const cargoToml = readFileSync(
      join(process.cwd(), "src-tauri", "Cargo.toml"),
      "utf8",
    );
    expect(cargoToml).not.toContain("rust-whisper");
  });

  it("does not re-export whisper legacy engine surface", () => {
    const libRs = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    expect(libRs).not.toContain("pub use whisper_engine");
  });
});
