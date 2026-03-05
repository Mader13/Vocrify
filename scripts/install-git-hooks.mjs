import { copyFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function installHooks() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..");
  const sourceHook = path.join(rootDir, ".githooks", "pre-push");
  const hooksDir = path.join(rootDir, ".git", "hooks");
  const targetHook = path.join(hooksDir, "pre-push");

  await mkdir(hooksDir, { recursive: true });
  await copyFile(sourceHook, targetHook);
  await chmod(targetHook, 0o755);

  console.log("Installed Git hook:", targetHook);
}

installHooks().catch((error) => {
  console.error("Failed to install Git hooks", error);
  process.exitCode = 1;
});
