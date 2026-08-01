import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { GeneratedFile } from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

export type WriteMode = "overwrite" | "skip";

export function resolveFilePath(filePath: string): string {
  return path.resolve(projectRoot, filePath);
}

export function writeFile(file: GeneratedFile, mode: WriteMode = "overwrite"): boolean {
  const fullPath = resolveFilePath(file.path);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (mode === "skip" && fs.existsSync(fullPath)) {
    console.log(`  ⏭️  ${file.path} (exists, skipped)`);
    return false;
  }

  fs.writeFileSync(fullPath, file.content, "utf-8");
  console.log(`  ✅ ${file.path} (${file.content.length} bytes)`);
  return true;
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(resolveFilePath(filePath));
}
