#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir =
  typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const resourcesDir = path.join(repoRoot, "src-tauri", "resources");
const targetDir = path.join(resourcesDir, "ai-engine");
const ortDir = path.join(resourcesDir, "ort");
const ortDllName = "onnxruntime.dll";
const vadDir = path.join(resourcesDir, "vad");
const sileroVadModelName = "silero_vad.onnx";

function main() {
  // Python ai-engine is no longer required at runtime.
  // Ensure old bundled copies are removed from resources.
  mkdirSync(resourcesDir, { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });
  console.log("[prepare-tauri-resources] Removed legacy ai-engine resources");
}

function listDirectories(directoryPath) {
  if (!existsSync(directoryPath)) {
    return [];
  }

  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(directoryPath, entry.name),
    }));
}

function hasOrtDll(directoryPath) {
  if (!existsSync(directoryPath)) {
    return false;
  }

  return readdirSync(directoryPath).some(
    (name) => name.toLowerCase() === ortDllName
  );
}

function parseOnnxruntimeNodeVersion(dirName) {
  const match = /^onnxruntime-node@(\d+)\.(\d+)\.(\d+)/.exec(dirName);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersionsPreferred(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return right.patch - left.patch;
}

function findOrtFromPykeCache() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }

  const ortPykeRoot = path.join(
    localAppData,
    "ort.pyke.io",
    "dfbin",
    "x86_64-pc-windows-msvc"
  );

  if (!existsSync(ortPykeRoot)) {
    return null;
  }

  const hashes = listDirectories(ortPykeRoot);
  for (const hashDir of hashes) {
    const candidates = [
      hashDir.fullPath,
      path.join(hashDir.fullPath, "onnxruntime", "lib"),
    ];

    for (const candidate of candidates) {
      if (hasOrtDll(candidate)) {
        return {
          source: "ort.pyke.io cache",
          directory: candidate,
        };
      }
    }
  }

  return null;
}

function findOrtFromBunCache(homeDir) {
  const bunCacheRoot = path.join(homeDir, ".bun", "install", "cache");
  if (!existsSync(bunCacheRoot)) {
    return null;
  }

  const versionedDirs = listDirectories(bunCacheRoot)
    .map((entry) => ({
      ...entry,
      version: parseOnnxruntimeNodeVersion(entry.name),
    }))
    .filter((entry) => entry.version)
    .filter(
      (entry) =>
        entry.version.major > 1 ||
        (entry.version.major === 1 && entry.version.minor >= 22)
    )
    .sort((left, right) => compareVersionsPreferred(left.version, right.version));

  for (const entry of versionedDirs) {
    const binDir = path.join(entry.fullPath, "bin");
    const napiDirs = listDirectories(binDir);
    for (const napiDir of napiDirs) {
      const winX64Dir = path.join(napiDir.fullPath, "win32", "x64");
      if (hasOrtDll(winX64Dir)) {
        return {
          source: `bun cache (${entry.name})`,
          directory: winX64Dir,
        };
      }
    }
  }

  return null;
}

function findOrtFromLegacyCargoCache(homeDir) {
  const legacyCacheDir = path.join(homeDir, ".cargo", "ort", "x86_64-pc-windows-msvc");
  if (!hasOrtDll(legacyCacheDir)) {
    return null;
  }

  return {
    source: "legacy .cargo/ort cache",
    directory: legacyCacheDir,
  };
}

function findOrtDllSource(homeDir) {
  const overrideDir = process.env.ORT_DLL_SOURCE_DIR;
  if (overrideDir && hasOrtDll(overrideDir)) {
    return {
      source: "ORT_DLL_SOURCE_DIR",
      directory: overrideDir,
    };
  }

  return (
    findOrtFromPykeCache() ||
    findOrtFromBunCache(homeDir) ||
    findOrtFromLegacyCargoCache(homeDir)
  );
}

function copyOrtDlls() {
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (!homeDir) {
    console.log("[prepare-tauri-resources] Could not determine home directory for ONNX Runtime");
    return;
  }

  const source = findOrtDllSource(homeDir);
  if (!source) {
    console.log("[prepare-tauri-resources] ONNX Runtime DLL source not found");
    console.log(
      "[prepare-tauri-resources] Checked: ORT_DLL_SOURCE_DIR, %LOCALAPPDATA%/ort.pyke.io, bun cache, and .cargo/ort"
    );
    return;
  }

  rmSync(ortDir, { recursive: true, force: true });
  mkdirSync(ortDir, { recursive: true });

  const files = readdirSync(source.directory);
  let copiedCount = 0;
  let foundOrtDll = false;

  for (const file of files) {
    const srcPath = path.join(source.directory, file);
    const destPath = path.join(ortDir, file);
    
    if (!statSync(srcPath).isFile()) {
      continue;
    }

    if (file.toLowerCase() === ortDllName) {
      foundOrtDll = true;
    }

    if (file.toLowerCase().endsWith(".dll") || file.toLowerCase().endsWith(".pdb")) {
      cpSync(srcPath, destPath, { force: true });
      console.log(`[prepare-tauri-resources] Copied ${file} to ${ortDir}`);
      copiedCount += 1;
    }
  }

  if (!foundOrtDll) {
    console.log(
      `[prepare-tauri-resources] Source directory does not contain ${ortDllName}: ${source.directory}`
    );
    return;
  }

  if (copiedCount > 0) {
    console.log(
      `[prepare-tauri-resources] ONNX Runtime runtime files copied from ${source.source}: ${source.directory}`
    );
  } else {
    console.log(`[prepare-tauri-resources] No DLL/PDB files copied from ${source.directory}`);
  }
}

function parseSileroVadVersion(dirName) {
  const match = /^silero-vad-rust-(\d+)\.(\d+)\.(\d+)/.exec(dirName);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemverDesc(left, right) {
  if (left.major !== right.major) {
    return right.major - left.major;
  }
  if (left.minor !== right.minor) {
    return right.minor - left.minor;
  }
  return right.patch - left.patch;
}

function findSileroVadModelSource() {
  const explicit = process.env.SILERO_VAD_MODEL_SOURCE;
  if (explicit && existsSync(explicit)) {
    return {
      source: "SILERO_VAD_MODEL_SOURCE",
      filePath: explicit,
    };
  }

  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (!homeDir) {
    return null;
  }

  const registryRoot = path.join(homeDir, ".cargo", "registry", "src");
  if (!existsSync(registryRoot)) {
    return null;
  }

  const registryDirs = listDirectories(registryRoot);
  for (const registryDir of registryDirs) {
    const candidates = listDirectories(registryDir.fullPath)
      .map((entry) => ({
        ...entry,
        version: parseSileroVadVersion(entry.name),
      }))
      .filter((entry) => entry.version)
      .sort((left, right) => compareSemverDesc(left.version, right.version));

    for (const candidate of candidates) {
      const modelPath = path.join(
        candidate.fullPath,
        "src",
        "silero_vad",
        "data",
        sileroVadModelName
      );

      if (existsSync(modelPath)) {
        return {
          source: `cargo registry (${candidate.name})`,
          filePath: modelPath,
        };
      }
    }
  }

  return null;
}

function copySileroVadModel() {
  const source = findSileroVadModelSource();
  if (!source) {
    console.log(
      "[prepare-tauri-resources] Silero VAD model source not found. Set SILERO_VAD_MODEL_SOURCE or run cargo fetch/build first."
    );
    return;
  }

  mkdirSync(vadDir, { recursive: true });
  const destination = path.join(vadDir, sileroVadModelName);
  cpSync(source.filePath, destination, { force: true });

  console.log(
    `[prepare-tauri-resources] Copied ${sileroVadModelName} from ${source.source} to ${destination}`
  );
}

copyOrtDlls();
copySileroVadModel();
main();
