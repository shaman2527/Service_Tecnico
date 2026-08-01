import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ContextGuardResult, ContextViolation, FeatureScope } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const FEATURE_LIST_PATH = path.join(projectRoot, "feature_list.json");

function loadFeatureList(): { id: number; title: string; status: string; scope: { allowedPaths: string[]; allowedTables: string[] } }[] {
  try {
    const raw = fs.readFileSync(FEATURE_LIST_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.features ?? [];
  } catch {
    return [];
  }
}

function findActiveFeature(): FeatureScope | null {
  const features = loadFeatureList();
  const active = features.find(f => f.status === "in_progress");
  if (!active) {
    const pending = features.find(f => f.status === "pending");
    if (!pending) return null;
    return {
      featureId: pending.id,
      featureTitle: pending.title,
      allowedPaths: pending.scope?.allowedPaths || [],
    };
  }
  return {
    featureId: active.id,
    featureTitle: active.title,
      allowedPaths: active.scope?.allowedPaths || [],
  };
}

function getChangedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 5000,
    });
    const staged = execSync("git diff --name-only --cached", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 5000,
    });
    const files = [
      ...output.split("\n").filter(Boolean),
      ...staged.split("\n").filter(Boolean),
    ];
    return [...new Set(files)];
  } catch {
    return [];
  }
}

function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const allowed of allowedPaths) {
    const a = allowed.replace(/\\/g, "/");
    if (a.endsWith("*")) {
      const prefix = a.slice(0, -1);
      if (normalized.startsWith(prefix)) return true;
    } else if (normalized === a) {
      return true;
    }
  }
  return false;
}

export async function runContextGuard(): Promise<ContextGuardResult> {
  const activeFeature = findActiveFeature();
  const violations: ContextViolation[] = [];
  const warnings: string[] = [];

  if (!activeFeature) {
    warnings.push("No active or pending feature found — operating in permissive mode");
    return {
      passed: true,
      violations: [],
      activeFeature: null,
      warnings,
    };
  }

  if (activeFeature.allowedPaths.length === 0) {
    warnings.push(`Feature #${activeFeature.featureId} has no scope defined — operating in permissive mode`);
    return {
      passed: true,
      violations: [],
      activeFeature,
      warnings,
    };
  }

  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    warnings.push("No uncommitted changes detected — scope check skipped");
    return {
      passed: true,
      violations: [],
      activeFeature,
      warnings,
    };
  }

  for (const file of changedFiles) {
    // Only check src/ files — tooling, config, and docs are infrastructure
    if (!file.startsWith("src/")) continue;

    if (!isPathAllowed(file, activeFeature.allowedPaths)) {
      violations.push({
        file,
        reason: `File is not in the allowed scope for feature #${activeFeature.featureId}`,
        severity: "error",
      });
    }
  }

  const passed = violations.length === 0;

  return { passed, violations, activeFeature, warnings };
}

export function printContextGuardResult(result: ContextGuardResult): void {
  console.log(`\n🔒 Context Guard:`);
  if (result.activeFeature) {
    console.log(`   Feature: #${result.activeFeature.featureId} — ${result.activeFeature.featureTitle}`);
    if (result.activeFeature.allowedPaths.length > 0) {
      console.log(`   Scope: ${result.activeFeature.allowedPaths.join(", ")}`);
    } else {
      console.log(`   ⚠️  No scope defined`);
    }
  } else {
    console.log(`   ⚠️  No active feature — permissive mode`);
  }

  if (result.violations.length > 0) {
    console.log(`   ❌ ${result.violations.length} violation(s) detected:`);
    for (const v of result.violations) {
      console.log(`     - ${v.file}: ${v.reason}`);
    }
  } else {
    console.log(`   ✅ Scope clean — no violations`);
  }

  for (const w of result.warnings) {
    console.log(`   ⚠️  ${w}`);
  }
}
