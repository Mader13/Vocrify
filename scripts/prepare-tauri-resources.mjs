#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir =
  typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourceDir = path.join(repoRoot, "ai-engine");
const resourcesDir = path.join(repoRoot, "src-tauri", "resources");
const targetDir = path.join(resourcesDir, "ai-engine");

const excludedDirs = new Set([
  "venv",
  ".venv",
  "venv_parakeet",
  "__pycache__",
  "models_cache",
  "test_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
]);

const excludedFilePatterns = [
  /\.pyc$/i,
  /\.pyo$/i,
  /\.backup$/i,
  /\.md$/i,
  /^test_.*\.py$/i,
  /\.bat$/i,
  /\.sh$/i,
  /^=/,
  /^requirements-.*\.txt$/i,
];

function shouldInclude(sourcePath) {
  const relative = path.relative(sourceDir, sourcePath);
  if (!relative || relative === ".") {
    return true;
  }

  const parts = relative.split(path.sep);
  if (parts.some((part) => excludedDirs.has(part))) {
    return false;
  }

  const name = path.basename(sourcePath);
  if (name === "nul") {
    return false;
  }

  return !excludedFilePatterns.some((pattern) => pattern.test(name));
}

function main() {
  if (!existsSync(sourceDir)) {
    throw new Error(`ai-engine directory not found: ${sourceDir}`);
  }

  mkdirSync(resourcesDir, { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });

  cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: shouldInclude,
    force: true,
    errorOnExist: false,
  });

  console.log(`[prepare-tauri-resources] Copied ai-engine to ${targetDir}`);
}

main();
