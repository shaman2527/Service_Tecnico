/**
 * tools/auto-fix/pre-flight.ts
 *
 * Validates that auto-fix is safe to run BEFORE applying any changes.
 * Returns a list of checks that must all pass.
 */

import { execSync } from "child_process";
import { config } from "../config";

export interface PreFlightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PreFlightResult {
  canProceed: boolean;
  checks: PreFlightCheck[];
}

function runCommand(cmd: string, timeout: number = 10000): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { timeout, stdio: "pipe", encoding: "utf-8" });
    return { success: true, output };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: msg };
  }
}

export async function runPreFlight(): Promise<PreFlightResult> {
  const checks: PreFlightCheck[] = [];

  // Check 0: Master switch
  if (process.env.TOOLS_AUTO_FIX === "off") {
    return {
      canProceed: false,
      checks: [{ name: "Master switch", passed: false, detail: "TOOLS_AUTO_FIX=off. Auto-fix disabled." }],
    };
  }

  if (!config.autoFix?.enabled) {
    return {
      canProceed: false,
      checks: [{ name: "Enabled in config", passed: false, detail: "autoFix.enabled=false in tools/config.ts" }],
    };
  }

  // Check 1: Git status (if required)
  if (config.autoFix.requireCleanGit) {
    const r = runCommand("git status --porcelain");
    checks.push({
      name: "Git clean",
      passed: r.success && r.output.trim() === "",
      detail: r.output.trim() === ""
        ? "Working tree clean"
        : `Uncommitted changes detected. Commit or stash first.\n${r.output.split("\n").slice(0, 5).join("\n")}`,
    });
  }

  // Check 2: Build passes (if required)
  if (config.autoFix.requireGreenBuild) {
    console.log("   🔨 Pre-flight build check...");
    const r = runCommand(config.commands.build + " 2>&1 | tail -3", 120000);
    checks.push({
      name: "Build green",
      passed: r.success,
      detail: r.success
        ? "Build passes before auto-fix"
        : `Build failing before auto-fix. Fix existing issues first.\n${r.output.slice(-200)}`,
    });
  }

  // Check 3: Tests pass (if required)
  if (config.autoFix.requireGreenTests) {
    console.log("   🧪 Pre-flight tests check...");
    const r = runCommand(config.commands.test + " 2>&1 | tail -3", 60000);
    checks.push({
      name: "Tests green",
      passed: r.success,
      detail: r.success
        ? "Tests pass before auto-fix"
        : `Tests failing before auto-fix.\n${r.output.slice(-200)}`,
    });
  }

  // Check 4: API key available (if not dryRun and apiProvider !== "none")
  if (!config.autoFix.dryRun && config.autoFix.apiProvider !== "none") {
    const envVarName = config.autoFix.apiKeyEnv;
    const apiKey = process.env[envVarName];
    checks.push({
      name: `API key (${envVarName})`,
      passed: !!apiKey && apiKey.length > 10,
      detail: apiKey
        ? `API key set (${apiKey.length} chars)`
        : `${envVarName} env var not set. Set it or use autoFix.dryRun=true`,
    });
  }

  const canProceed = checks.every(c => c.passed);

  return { canProceed, checks };
}