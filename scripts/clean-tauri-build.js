import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const targetDir = path.resolve(repoRoot, "src-tauri", "target");
const relativeTarget = path.relative(repoRoot, targetDir);

if (
  !relativeTarget ||
  relativeTarget.startsWith("..") ||
  path.isAbsolute(relativeTarget)
) {
  throw new Error(`Ruta de limpieza fuera del proyecto: ${targetDir}`);
}

await rm(targetDir, {
  recursive: true,
  force: true,
});

console.log(`Tauri build limpio: eliminado ${relativeTarget}`);
