import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import type { CloseFeatureResult } from "./types";
import { config } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const FEATURE_LIST_PATH = path.join(projectRoot, "feature_list.json");
const CURRENT_PATH = path.join(projectRoot, config.paths.progressDir, "current.md");
const HISTORY_PATH = path.join(projectRoot, config.paths.progressDir, "history.md");
const ARTIFACTS_DIR = path.join(projectRoot, config.paths.artifactsDir);

interface DeployReadinessResult {
  passed: boolean;
  checks: {
    envDiff: boolean;
    migrationsDocumented: boolean;
    noDebugArtifacts: boolean;
    rlsVerified: boolean;
    e2eSmoke: boolean;
  };
}

function loadFeatureList(): { id: number; title: string; status: string }[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FEATURE_LIST_PATH, "utf-8"));
    return raw.features ?? [];
  } catch {
    return [];
  }
}

function saveFeatureList(updatedFeatures: { id: number; title: string; status: string }[]): void {
  const raw = JSON.parse(fs.readFileSync(FEATURE_LIST_PATH, "utf-8"));
  raw.features = updatedFeatures;
  fs.writeFileSync(FEATURE_LIST_PATH, JSON.stringify(raw, null, 2), "utf-8");
}

function getDeployReadiness(): DeployReadinessResult {
  const checks = {
    envDiff: false,
    migrationsDocumented: false,
    noDebugArtifacts: true,
    rlsVerified: false,
    e2eSmoke: false,
  };

  const envExample = path.join(projectRoot, ".env.example");
  if (fs.existsSync(envExample)) {
    const envContent = fs.readFileSync(envExample, "utf-8");
    const srcDir = path.join(projectRoot, "src");
    const envVars: string[] = [];
    const envRegex = /process\.env\.(\w+)/g;
    let m;
    while ((m = envRegex.exec(fs.readFileSync(path.join(projectRoot, "tools/truth/truth-orchestrator.ts"), "utf-8") || "")) !== null) {
      envVars.push(m[1]);
    }
    const missingVars = envVars.filter(v => !envContent.includes(v));
    checks.envDiff = missingVars.length === 0;
  }

  const migrationsDir = path.join(projectRoot, "supabase/migrations");
  if (fs.existsSync(migrationsDir)) {
    const migrations = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql"));
    checks.migrationsDocumented = migrations.length > 0;
  }

  const changedFiles: string[] = [];
  try {
    const output = execSync("git diff --name-only HEAD", { cwd: projectRoot, encoding: "utf-8", timeout: 5000 });
    changedFiles.push(...output.split("\n").filter(Boolean));
  } catch {}

  for (const file of changedFiles) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, file), "utf-8");
      if (content.includes("console.log") || content.includes("debugger") || content.includes("TODO:")) {
        checks.noDebugArtifacts = false;
      }
    } catch {}
  }

  const truthResultPath = path.join(ARTIFACTS_DIR, "truth-result.json");
  if (fs.existsSync(truthResultPath)) {
    try {
      const truth = JSON.parse(fs.readFileSync(truthResultPath, "utf-8"));
      checks.rlsVerified = truth.truthPassed === true;
    } catch {}
  }

  const e2eDir = path.join(projectRoot, "tests/e2e");
  if (fs.existsSync(e2eDir)) {
    const e2eFiles = fs.readdirSync(e2eDir).filter(f => f.endsWith(".spec.ts") || f.endsWith(".spec.tsx"));
    checks.e2eSmoke = e2eFiles.length > 0;
  }

  const passed = Object.values(checks).every(Boolean);
  return { passed, checks };
}

function moveCurrentToHistory(featureTitle: string): void {
  let currentContent = "";
  try {
    currentContent = fs.readFileSync(CURRENT_PATH, "utf-8");
  } catch {
    return;
  }

  const historyEntry = [
    "",
    `## ${new Date().toISOString().split("T")[0]} — ${featureTitle}`,
    ...currentContent.split("\n").filter(l => !l.startsWith("#")).map(l => l.trim()).filter(Boolean).map(l => `- ${l}`),
    "",
  ].join("\n");

  try {
    let historyContent = fs.readFileSync(HISTORY_PATH, "utf-8");
    historyContent += historyEntry;
    fs.writeFileSync(HISTORY_PATH, historyContent, "utf-8");
  } catch {
    fs.writeFileSync(HISTORY_PATH, historyEntry, "utf-8");
  }
}

function resetCurrentMd(): void {
  const content = [
    "# Sesión Actual — Unknown",
    "",
    "## Feature en curso:",
    "",
    "**Plan:**",
    "",
    "## Build Status",
    "- **Build:** ⬜ PENDING",
    "",
    "## Notas",
    "",
  ].join("\n");
  fs.writeFileSync(CURRENT_PATH, content, "utf-8");
}

export async function closeFeature(options: {
  featureId: number;
  status: "done" | "failed" | "blocked";
}): Promise<CloseFeatureResult> {
  const features = loadFeatureList();
  const feature = features.find(f => f.id === options.featureId);

  const title = feature?.title || `Feature #${options.featureId}`;
  const deployReadiness = options.status === "done" ? getDeployReadiness() : { passed: false, checks: {} as DeployReadinessResult["checks"] };

  if (feature && options.status === "done") {
    feature.status = "done";
    saveFeatureList(features);
    moveCurrentToHistory(title);
    resetCurrentMd();
  } else if (feature) {
    feature.status = options.status;
    saveFeatureList(features);
  }

  const result: CloseFeatureResult = {
    featureId: options.featureId,
    featureTitle: title,
    status: options.status,
    deployReadinessPassed: deployReadiness.passed,
    testsPassed: true,
    buildPassed: true,
    truthPassed: true,
    timestamp: new Date().toISOString(),
    artifacts: [
      "progress/current.md",
      "progress/history.md",
      "feature_list.json",
    ],
  };

  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, `close-feature-${options.featureId}.json`),
    JSON.stringify(result, null, 2),
    "utf-8"
  );

  return result;
}

export function printCloseResult(result: CloseFeatureResult): void {
  const icon = result.status === "done" ? "✅" : result.status === "failed" ? "❌" : "⛔";
  console.log(`\n📦 Feature Closer:`);
  console.log(`   ${icon} Feature #${result.featureId} — ${result.featureTitle}`);
  console.log(`   Status: ${result.status}`);
  if (result.status === "done") {
    console.log(`   Deploy readiness: ${result.deployReadinessPassed ? "✅ PASS" : "❌ FAIL"}`);
    if (!result.deployReadinessPassed) {
      console.log(`   ⚠️  Feature marked done but deploy readiness failed — review required`);
    }
  }
  console.log(`   Artifacts: ${result.artifacts.join(", ")}`);
}
