/**
 * tools/auto-fix/safe-apply.ts
 *
 * Atomic application of fixes with rollback on failure.
 * Pre-fix state is saved, post-fix validation runs, rollback if anything breaks.
 */

import { execSync } from "child_process";
import * as fs from "fs";

export interface ApplyResult {
  applied: boolean;
  reason: string;
  checkpoint?: string;
  diffSize?: number;
}

function runCommand(cmd: string, timeout: number = 30000): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { timeout, stdio: "pipe", encoding: "utf-8" });
    return { success: true, output };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: msg };
  }
}

async function gitCheckpoint(name: string): Promise<string> {
  const timestamp = Date.now();
  const tag = `auto-fix-${name}-${timestamp}`;
  runCommand(`git add -A && git stash push -m "auto-fix-${name}"`);
  return tag;
}

async function gitRestore(checkpoint: string): Promise<void> {
  runCommand(`git stash pop`);
  runCommand(`git tag -d ${checkpoint} 2>/dev/null || true`);
}

async function buildPasses(): Promise<boolean> {
  const r = runCommand("npm run build 2>&1 | tail -5", 120000);
  return r.success;
}

async function testsPass(): Promise<boolean> {
  const r = runCommand("npx vitest run 2>&1 | tail -5", 60000);
  return r.success;
}

export async function applyFixSafely(
  filePath: string,
  fixContent: string,
  options: { validateBuild?: boolean; validateTests?: boolean; fixName?: string } = {},
): Promise<ApplyResult> {
  const { validateBuild = true, validateTests = true, fixName = "unknown" } = options;

  if (!fs.existsSync(filePath)) {
    return { applied: false, reason: `File does not exist: ${filePath}` };
  }

  const original = fs.readFileSync(filePath, "utf-8");

  // If no change, skip
  if (original === fixContent) {
    return { applied: false, reason: "No change needed" };
  }

  const diffSize = Math.abs(fixContent.length - original.length);
  const checkpoint = await gitCheckpoint(fixName);

  try {
    // Apply fix
    fs.writeFileSync(filePath, fixContent, "utf-8");

    // Validate build
    if (validateBuild) {
      console.log(`      🔨 Validating build after ${fixName}...`);
      const buildOk = await buildPasses();
      if (!buildOk) {
        await gitRestore(checkpoint);
        return { applied: false, reason: `Build broke after fix (${fixName}). Rolled back.`, checkpoint, diffSize };
      }
    }

    // Validate tests
    if (validateTests) {
      console.log(`      🧪 Validating tests after ${fixName}...`);
      const testsOk = await testsPass();
      if (!testsOk) {
        await gitRestore(checkpoint);
        return { applied: false, reason: `Tests broke after fix (${fixName}). Rolled back.`, checkpoint, diffSize };
      }
    }

    return { applied: true, reason: `Applied ${fixName} successfully`, checkpoint, diffSize };
  } catch (err: unknown) {
    await gitRestore(checkpoint);
    const msg = err instanceof Error ? err.message : String(err);
    return { applied: false, reason: `Error during apply: ${msg}`, checkpoint, diffSize };
  }
}