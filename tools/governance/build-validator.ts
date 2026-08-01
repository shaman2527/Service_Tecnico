import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
import type { BuildResult } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

export function runBuild(cmd = "npm", args: string[] = ["run", "build"], timeoutMs = 120000): BuildResult {
  const start = Date.now();
  try {
    const output = execSync(`${cmd} ${args.join(" ")} 2>&1`, {
      cwd: projectRoot,
      timeout: timeoutMs,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const duration = Date.now() - start;

    const errors: { file: string; message: string; line?: number }[] = [];
    const warnings: { file: string; message: string }[] = [];

    const errorRegex = /(.+\.(?:ts|tsx|astro)):(\d+):(\d+) - error (TS\d+): (.+)/g;
    let match;
    while ((match = errorRegex.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        message: `[${match[4]}] ${match[5]}`,
      });
    }

    const warningRegex = /(.+\.(?:ts|tsx|astro)):(\d+):(\d+) - warning (TS\d+): (.+)/g;
    while ((match = warningRegex.exec(output)) !== null) {
      warnings.push({
        file: match[1],
        message: `[${match[4]}] ${match[5]}`,
      });
    }

    const success = !output.includes("error") || errors.length === 0;

    return {
      success,
      durationMs: duration,
      errors,
      warnings,
      rawOutput: output.slice(0, 5000),
    };
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const output = err instanceof Error && "stdout" in err
      ? String((err as { stdout: string }).stdout)
      : err instanceof Error ? err.message : String(err);

    return {
      success: false,
      durationMs: duration,
      errors: [{ file: "build", message: output.slice(0, 2000) }],
      warnings: [],
      rawOutput: output.slice(0, 5000),
    };
  }
}

export function parseBuildErrors(output: string): string[] {
  const lines = output.split("\n");
  const errors: string[] = [];
  let inError = false;

  for (const line of lines) {
    if (line.includes("error") && (line.includes(".ts:") || line.includes(".tsx:") || line.includes(".astro:"))) {
      errors.push(line.trim());
      inError = true;
    } else if (inError && line.trim() && !line.includes("watch")) {
      errors[errors.length - 1] += " " + line.trim();
      inError = false;
    }
  }

  return errors;
}
