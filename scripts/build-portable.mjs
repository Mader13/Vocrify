#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir =
  typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriDir = path.join(repoRoot, "src-tauri");
const tauriConfigPath = path.join(tauriDir, "tauri.conf.json");
const defaultReleaseDir = path.join(tauriDir, "target", "release");

function parseCliOptions(args) {
  const options = {
    releaseDir: null,
    exeName: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--release-dir") {
      options.releaseDir = args[index + 1] ?? null;
      index += 1;
    }

    if (args[index] === "--exe-name") {
      options.exeName = args[index + 1] ?? null;
      index += 1;
    }
  }

  return options;
}

function resolveFromRepoRoot(inputPath, fallbackPath) {
  if (!inputPath) {
    return fallbackPath;
  }

  return path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(repoRoot, inputPath);
}

function readTauriConfig() {
  const raw = readFileSync(tauriConfigPath, "utf8");
  return JSON.parse(raw);
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

function collectRuntimeDlls(releaseDir) {
  return readdirSync(releaseDir).filter((fileName) => {
    const lower = fileName.toLowerCase();
    return lower.endsWith(".dll");
  });
}

function ensureFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function createPortableReadme(productName, appExeName) {
  return [
    `${productName} Portable`,
    "",
    "How to run:",
    "1. Extract this folder to any location.",
    `2. Run ${appExeName}.`,
    "",
    "Notes:",
    "- Keep all files and the resources directory together.",
    "- This build is unsigned. Some Windows security features may block launch.",
    "",
  ].join("\n");
}

function buildZip(archivePath, sourceFolderName, bundleDir) {
  // Используем PowerShell Compress-Archive вместо tar для надёжности на Windows
  const sourcePath = path.join(bundleDir, sourceFolderName);
  const psArgs = [
    "-Command",
    `Compress-Archive -Path "${sourcePath}" -DestinationPath "${archivePath}" -Force`,
  ];
  execFileSync("powershell", psArgs, { stdio: "inherit" });
}

function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const config = readTauriConfig();
  const version = config.version ?? "0.0.0";
  const productName = config.productName ?? "App";
  const safeProductName = sanitizeName(productName);
  const releaseDir = resolveFromRepoRoot(options.releaseDir ?? process.env.TAURI_RELEASE_DIR, defaultReleaseDir);
  const resourcesDir = path.join(releaseDir, "resources");
  const bundleDir = path.join(releaseDir, "bundle", "portable");

  const appExeName = options.exeName ?? process.env.TAURI_EXE_NAME ?? `${productName}.exe`;
  const appExePath = path.join(releaseDir, appExeName);
  ensureFile(appExePath, "Main executable");
  ensureFile(resourcesDir, "Resources directory");

  const portableFolderName = `${safeProductName}-portable`;
  const portableAppDir = path.join(bundleDir, portableFolderName);
  const archiveName = `${safeProductName}_${version}_x64_portable.zip`;
  const archivePath = path.join(bundleDir, archiveName);

  rmSync(portableAppDir, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  mkdirSync(portableAppDir, { recursive: true });

  cpSync(appExePath, path.join(portableAppDir, appExeName), { force: true });

  const runtimeDlls = collectRuntimeDlls(releaseDir);
  for (const dllName of runtimeDlls) {
    cpSync(path.join(releaseDir, dllName), path.join(portableAppDir, dllName), {
      force: true,
    });
  }

  cpSync(resourcesDir, path.join(portableAppDir, "resources"), { recursive: true, force: true });

  writeFileSync(
    path.join(portableAppDir, "README-PORTABLE.txt"),
    createPortableReadme(productName, appExeName),
    "utf8"
  );

  buildZip(archivePath, portableFolderName, bundleDir);

  console.log(`[portable] Created: ${portableAppDir}`);
  console.log(`[portable] Archive: ${archivePath}`);
}

main();
