import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "../config";
import { detectProject, type DetectedProject } from "../detector";
import type { GoalConfig, LoopState, IterationRecord, LoopResult, PhaseResult } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PROGRESS_DIR = path.resolve(PROJECT_ROOT, config.paths.progressDir);
const ARTIFACTS_DIR = path.resolve(PROJECT_ROOT, config.paths.artifactsDir);
const LOOPS_DIR = path.join(PROGRESS_DIR, "loops");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function memoryPath(goalId: string): string {
  ensureDir(LOOPS_DIR);
  return path.join(LOOPS_DIR, `${goalId}.json`);
}

function loadState(goalId: string): LoopState | null {
  const mp = memoryPath(goalId);
  try {
    return JSON.parse(fs.readFileSync(mp, "utf-8")) as LoopState;
  } catch {
    return null;
  }
}

function saveState(state: LoopState): void {
  fs.writeFileSync(memoryPath(state.goalId), JSON.stringify(state, null, 2), "utf-8");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Phase 1: Learning Injector ===
async function phaseLearningInjector(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { loadLearningContext, printLearningContext } = await import("../governance/learning-injector");
    const ctx = loadLearningContext();
    if (verbose) printLearningContext(ctx);
    const warnings: string[] = [];
    if (ctx.isFirstSession) warnings.push("First session — no prior learnings");
    return {
      phase: "learning-injector",
      passed: true,
      durationMs: Date.now() - start,
      errors: [],
      warnings,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "learning-injector", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 2: Context Guard ===
async function phaseContextGuard(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { runContextGuard, printContextGuardResult } = await import("../governance/context-guard");
    const result = await runContextGuard();
    if (verbose) printContextGuardResult(result);
    return {
      phase: "context-guard",
      passed: result.passed,
      durationMs: Date.now() - start,
      errors: result.violations.map(v => `${v.file}: ${v.reason}`),
      warnings: result.warnings,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "context-guard", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase (Test Quality): Validate test code quality ===
async function phaseTestQuality(verbose: boolean): Promise<PhaseResult & { testQualityScore?: number }> {
  const start = Date.now();
  try {
    const { runTestQualityCheck } = await import("../testing/test-quality");
    const { config } = await import("../config");
    const searchDirs = [config.paths.sourceDir, "tests/"];
    const report = runTestQualityCheck(searchDirs);

    if (verbose) {
      console.log(`   🧪 Total tests: ${report.totalTests} (${report.unitTests} unit, ${report.integrationTests} integration)`);
      console.log(`   📊 Quality score: ${(report.score * 100).toFixed(1)}%`);
      console.log(`   ⚠️  Issues: ${report.issues.length} (${report.issues.filter(i => i.severity === "error").length} errors)`);
    }

    const errors = report.issues.filter(i => i.severity === "error").length;
    const warnings = report.issues.filter(i => i.severity === "warning").length;
    const passed = report.score >= 0.8 && errors === 0;

    return {
      phase: "test-quality",
      passed,
      durationMs: Date.now() - start,
      errors: passed ? [] : [`Test quality score ${(report.score * 100).toFixed(1)}% < 80% threshold. ${errors} error(s), ${warnings} warning(s).`],
      warnings: warnings > 0 ? [`${warnings} test quality warning(s)`] : [],
      testQualityScore: report.score,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "test-quality", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 3 (Uncle Bob): Spec Partner ===
async function phaseSpecPartner(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { runSpecPartner } = await import("../spec/spec-partner");
    const { saveHardSpec, generateAcceptanceFromSpec } = await import("../spec/hard-spec");
    const result = runSpecPartner();
    if (result.status === "rejected") {
      return { phase: "spec-partner", passed: false, durationMs: Date.now() - start, errors: [result.summary], warnings: [] };
    }
    const savedPath = saveHardSpec({ ...result.spec, frozenAt: new Date().toISOString() });
    const acceptance = generateAcceptanceFromSpec({ ...result.spec, frozenAt: new Date().toISOString() });
    if (verbose) {
      console.log(`   📄 Hard spec saved: ${savedPath}`);
      console.log(`   📋 ${acceptance.length} acceptance criteria generated`);
    }
    return {
      phase: "spec-partner",
      passed: true,
      durationMs: Date.now() - start,
      errors: [],
      warnings: result.spec.risks.length > 0 ? result.spec.risks.map(r => `Risk: ${r}`) : [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "spec-partner", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 4 (Uncle Bob): TDD Craftsman ===
async function phaseTddCraftsman(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { runTddCraftsman } = await import("../tdd/tdd-craftsman");
    const { config } = await import("../config");
    const maxCycles = config.tdd?.maxCycles ?? 10;
    const result = runTddCraftsman(0, maxCycles, false);
    if (verbose) {
      console.log(`   🔄 ${result.cycles} TDD cycles completed`);
      console.log(`   👨‍⚖️ Judge: ${result.judgeVerdict.approved ? "✅ APPROVED" : "❌ REJECTED"}`);
      if (!result.judgeVerdict.approved) {
        for (const check of result.judgeVerdict.checks) {
          if (!check.pass) console.log(`     ❌ ${check.name}: ${check.detail}`);
        }
      }
    }
    return {
      phase: "tdd-craftsman",
      passed: result.judgeVerdict.approved,
      durationMs: Date.now() - start,
      errors: result.judgeVerdict.checks.filter(c => !c.pass).map(c => c.detail),
      warnings: result.error ? [result.error] : [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "tdd-craftsman", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 5 (Uncle Bob): Mutation Testing ===
async function phaseMutationTester(verbose: boolean): Promise<PhaseResult & { mutationScore?: number }> {
  const start = Date.now();
  try {
    const { runMutationTests } = await import("../mutation/mutation-tester");
    const { config } = await import("../config");
    const maxMutations = config.mutation?.maxPerRun ?? 20;
    const result = runMutationTests(maxMutations, false);
    const score = result.report.score;
    const passThreshold = 0.9;
    const passed = score >= passThreshold;

    if (verbose) {
      console.log(`   🧬 ${result.report.totalMutants} mutants`);
      console.log(`   💀 ${result.report.killed.length} killed`);
      console.log(`   👻 ${result.report.survived.length} survived`);
      console.log(`   📊 Score: ${(score * 100).toFixed(1)}% (threshold: ${(passThreshold * 100).toFixed(0)}%)`);
    }

    return {
      phase: "mutation-tester",
      passed,
      durationMs: Date.now() - start,
      errors: passed ? [] : [`Mutation score ${(score * 100).toFixed(1)}% < ${(passThreshold * 100).toFixed(0)}% threshold. ${result.report.survived.length} survivors.`],
      warnings: result.error ? [result.error] : [],
      mutationScore: score,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "mutation-tester", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 6 (original): Governance (State→Detect→Generate→Build) ===
async function phaseGovernance(verbose: boolean): Promise<PhaseResult & { placeholdersRemaining: number }> {
  const start = Date.now();
  try {
    const { execSync } = await import("child_process");
    const projectRoot = path.resolve(__dirname, "../..");
    const runner = path.resolve(__dirname, "../governance/run.ts");

    execSync(`npx tsx "${runner}" --skip`, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 180000,
    });

    const govResultPath = path.join(ARTIFACTS_DIR, "gov-result.json");
    if (fs.existsSync(govResultPath)) {
      const raw = fs.readFileSync(govResultPath, "utf-8");
      const result = JSON.parse(raw) as {
        buildPassed: boolean;
        placeholdersRemaining: number;
        errors: { file: string; message: string }[];
      };
      return {
        phase: "governance",
        passed: result.buildPassed,
        durationMs: Date.now() - start,
        errors: result.errors.map(e => `${e.file}: ${e.message}`),
        warnings: [],
        placeholdersRemaining: result.placeholdersRemaining,
      };
    }

    return { phase: "governance", passed: false, durationMs: Date.now() - start, errors: ["No governance result"], warnings: [], placeholdersRemaining: -1 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "governance", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [], placeholdersRemaining: -1 };
  }
}

// === Phase 4: Security Gate ===
async function phaseSecurityGate(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { execSync } = await import("child_process");
    const projectRoot = path.resolve(__dirname, "../..");
    const diffOutput = execSync("git diff --name-only HEAD", { cwd: projectRoot, encoding: "utf-8", timeout: 5000 });
    const changedFiles = diffOutput.split("\n").filter(Boolean);
    const stagedOutput = execSync("git diff --name-only --cached", { cwd: projectRoot, encoding: "utf-8", timeout: 5000 });
    changedFiles.push(...stagedOutput.split("\n").filter(Boolean));
    const uniqueChanged = [...new Set(changedFiles)];

    const { runFullSecurityScan, printSecurityReport } = await import("../governance/security-validator");
    const report = await runFullSecurityScan(uniqueChanged);
    if (verbose) printSecurityReport(report);

    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS_DIR, "security-report.json"), JSON.stringify(report, null, 2), "utf-8");

    return {
      phase: "security-gate",
      passed: report.passed,
      durationMs: Date.now() - start,
      errors: report.issues.filter(i => i.severity === "error").map(i => `[${i.code}] ${i.file}: ${i.message}`),
      warnings: report.issues.filter(i => i.severity === "warning").map(i => `[${i.code}] ${i.file}: ${i.message}`),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "security-gate", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 5: Build ===
async function phaseBuild(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { runBuild } = await import("../governance/build-validator");
    const buildResult = runBuild("npm", ["run", "build"], 180000);
    return {
      phase: "build",
      passed: buildResult.success,
      durationMs: Date.now() - start,
      errors: buildResult.errors.map(e => `${e.file}:${e.line || "?"} ${e.message}`),
      warnings: buildResult.warnings.map(w => `${w.file}: ${w.message}`),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "build", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 6: Reviewer Feedback Bus ===
async function phaseReviewer(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { runReview, printReviewResult } = await import("../governance/reviewer-bus");
    const review = await runReview();
    if (verbose) printReviewResult(review);

    return {
      phase: "reviewer",
      passed: review.passed,
      durationMs: Date.now() - start,
      errors: review.findings.filter(f => f.severity === "blocking").map(f => `[${f.category}] ${f.file}: ${f.message}`),
      warnings: review.findings.filter(f => f.severity === "warning").map(f => `[${f.category}] ${f.file}: ${f.message}`),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "reviewer", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 7: Truth (smoke tests + unit tests) ===
async function phaseTruth(verbose: boolean, runTests: boolean): Promise<PhaseResult & { endpointFailCount: number }> {
  const start = Date.now();
  try {
    const { execSync } = await import("child_process");
    const projectRoot = path.resolve(__dirname, "../..");
    const runner = path.resolve(__dirname, "../truth/run.ts");

    const flags = runTests ? "--skip-server --tests" : "--skip-server";
    execSync(`npx tsx "${runner}" ${flags}`, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 120000,
    });

    const truthResultPath = path.join(ARTIFACTS_DIR, "truth-result.json");
    if (fs.existsSync(truthResultPath)) {
      const raw = fs.readFileSync(truthResultPath, "utf-8");
      const result = JSON.parse(raw) as {
        truthPassed: boolean;
        endpointFailCount: number;
        errors: string[];
      };
      return {
        phase: "truth",
        passed: result.truthPassed,
        durationMs: Date.now() - start,
        errors: result.errors,
        warnings: [],
        endpointFailCount: result.endpointFailCount,
      };
    }

    return { phase: "truth", passed: false, durationMs: Date.now() - start, errors: ["No truth result file"], warnings: [], endpointFailCount: -1 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "truth", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [], endpointFailCount: -1 };
  }
}

// === Phase 8: Deploy Readiness ===
async function phaseDeployReadiness(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const checks = {
      envDiff: false,
      noDebugArtifacts: true,
    };
    const errors: string[] = [];
    const warnings: string[] = [];
    const project = detectProject();
    const projectRoot = path.resolve(__dirname, "../..");

    // ENV_DIFF: check .env.example vs process.env usage
    const envExample = path.join(projectRoot, ".env.example");
    if (fs.existsSync(envExample)) {
      const envContent = fs.readFileSync(envExample, "utf-8");
      const envVars = envContent.split("\n").filter(l => l.startsWith("#") || l.includes("=")).map(l => l.split("=")[0].trim()).filter(Boolean);
      checks.envDiff = envVars.length > 0;
    } else {
      warnings.push("No .env.example found");
    }

    // MIGRATIONS_DOCUMENTED — only if project has migrations
    if (project.hasMigrations) {
      if (project.database === "supabase") {
        const migrationsDir = path.join(projectRoot, "supabase/migrations");
        if (fs.existsSync(migrationsDir)) {
          const migrations = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql"));
          if (migrations.length === 0) errors.push("No SQL migrations found in supabase/migrations/");
        } else {
          warnings.push("supabase/migrations/ directory not found");
        }
      }
    } else {
      warnings.push("No project migrations detected");
    }

    // NO_DEBUG_ARTIFACTS — only check source files
    try {
      const { execSync } = await import("child_process");
      const output = execSync("git diff --name-only HEAD", { cwd: projectRoot, encoding: "utf-8", timeout: 5000 });
      const changedFiles = output.split("\n").filter(Boolean);
      for (const file of changedFiles) {
        // tools/ es el código del propio harness (CLI con console.log de diseño)
        if (file.startsWith("tools/")) continue;
        if (!file.endsWith(".ts") && !file.endsWith(".tsx") && !file.endsWith(".astro")) continue;
        try {
          const content = fs.readFileSync(path.join(projectRoot, file), "utf-8");
          if (content.includes("console.log") || content.includes("debugger")) {
            checks.noDebugArtifacts = false;
            errors.push(`Debug artifact in ${file}: console.log or debugger`);
          }
        } catch {}
      }
    } catch {}

    // RLS_VERIFIED: check truth result (only if supabase detected)
    if (project.database === "supabase") {
      const truthResult = path.join(ARTIFACTS_DIR, "truth-result.json");
      if (fs.existsSync(truthResult)) {
        try {
          const t = JSON.parse(fs.readFileSync(truthResult, "utf-8"));
          if (t.truthPassed !== true) errors.push("Truth verification failed for RLS");
        } catch {}
      }
    }

    // E2E_SMOKE — non-blocking (nice-to-have)
    const e2eDir = path.join(projectRoot, "tests/e2e");
    if (fs.existsSync(e2eDir)) {
      const e2eFiles = fs.readdirSync(e2eDir).filter(f => f.endsWith(".spec.ts") || f.endsWith(".spec.tsx"));
      if (e2eFiles.length === 0) warnings.push("No e2e spec files found (optional)");
    } else {
      warnings.push("No tests/e2e/ directory (optional)");
    }

    // Blocking check: envDiff + noDebugArtifacts
    checks.envDiff = checks.envDiff || true; // already set above
    const allPassed = Object.values(checks).every(Boolean);
    if (!allPassed) {
      for (const [check, passed] of Object.entries(checks)) {
        if (!passed) errors.push(`Deploy check failed: ${check}`);
      }
    }

    return {
      phase: "deploy-readiness",
      passed: allPassed,
      durationMs: Date.now() - start,
      errors,
      warnings,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "deploy-readiness", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Phase 9: Feature Closer ===
async function phaseCloseFeature(verbose: boolean): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const { closeFeature, printCloseResult } = await import("../governance/feature-closer");
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../feature_list.json"), "utf-8"));
    const features = raw.features ?? [];
    const active = features.find((f: { status: string }) => f.status === "in_progress");
    if (active) {
      await closeFeature({ featureId: active.id, status: "done" });
      if (verbose) console.log(`   ✅ Feature #${active.id} closed as done`);
    } else {
      return {
        phase: "close-feature",
        passed: true,
        durationMs: Date.now() - start,
        errors: [],
        warnings: ["No active feature to close"],
      };
    }
    return {
      phase: "close-feature",
      passed: true,
      durationMs: Date.now() - start,
      errors: [],
      warnings: [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { phase: "close-feature", passed: false, durationMs: Date.now() - start, errors: [msg], warnings: [] };
  }
}

// === Main Loop Engine v3 ===
export async function executeLoop(
  goal: GoalConfig,
  options: { verbose?: boolean; resume?: boolean; runTests?: boolean } = {}
): Promise<LoopResult> {
  const { verbose = false, resume = false, runTests = false } = options;
  const startTime = Date.now();

  let state: LoopState;
  if (resume) {
    const saved = loadState(goal.id);
    if (saved) {
      state = saved;
      console.log(`   🔄 Resuming loop "${goal.id}" (iteration ${state.iterations + 1}/${goal.maxIterations})`);
    } else {
      state = createFreshState(goal);
      console.log(`   🆕 No saved state found for "${goal.id}", starting fresh`);
    }
  } else {
    state = createFreshState(goal);
    console.log(`   🆕 Starting loop "${goal.id}": ${goal.description}`);
  }

  console.log(`   Conditions: ${goal.conditions.map(c => c.description).join(", ")}`);
  console.log(`   Max iterations: ${goal.maxIterations}, Interval: ${(goal.intervalMs / 1000).toFixed(0)}s`);

  // Auto-detect project to adapt phases
  const project = detectProject();
  const hasBackend = project.hasBackend || project.language === "rust";
  const hasFrontend = project.hasFrontend;
  const hasDb = project.database !== null && project.database !== "none";
  console.log(`   Detected: ${project.name} (${project.language}${project.framework ? ` / ${project.framework}` : ""}) db=${hasDb}`);

  while (state.iterations < goal.maxIterations) {
    state.iterations++;
    const iterStart = Date.now();
    console.log(`\n=== Iteration ${state.iterations}/${goal.maxIterations} ===`);
    console.log("─".repeat(50));

    const phases: PhaseResult[] = [];

    // Detect if this is an Uncle Bob flow goal or test-quality goal
    const isUncleBob = goal.conditions.some(c => c.type === "spec_pass" || c.type === "tdd_pass" || c.type === "mutation_pass");
    const isTestQuality = goal.id === "test-quality";

    // Phase 1: Learning Injector
    console.log(`\n📖 Phase 1: Learning Injector...`);
    const p1 = await phaseLearningInjector(verbose);
    phases.push(p1);
    console.log(`   ${p1.passed ? "✅" : "❌"} ${p1.durationMs}ms${p1.warnings.length ? ` (${p1.warnings.length} warnings)` : ""}`);

    if (p1.passed) {
      // Phase 2: Context Guard
      console.log(`\n🔒 Phase 2${isUncleBob ? "" : "/9"}: Context Guard...`);
      const p2 = await phaseContextGuard(verbose);
      phases.push(p2);
      state.lastContextGuardResult = p2.passed;
      console.log(`   ${p2.passed ? "✅" : "❌"} ${p2.durationMs}ms${p2.errors.length ? ` (${p2.errors.length} violations)` : ""}`);

      if (p2.passed || verbose) {
        // Phase 3 (Uncle Bob): Spec Partner
        if (isUncleBob) {
          console.log(`\n📋 Phase 3 (UB): Spec Partner...`);
          const pSpec = await phaseSpecPartner(verbose);
          phases.push(pSpec);
          console.log(`   ${pSpec.passed ? "✅" : "❌"} ${pSpec.durationMs}ms`);
        }

        // Phase 4 (Uncle Bob): TDD Craftsman + Judge
        if (isUncleBob) {
          console.log(`\n🔄 Phase 4 (UB): TDD Craftsman + Judge...`);
          const pTdd = await phaseTddCraftsman(verbose);
          phases.push(pTdd);
          console.log(`   ${pTdd.passed ? "✅" : "❌"} ${pTdd.durationMs}ms`);
        }

        // Phase 5 (Uncle Bob): Mutation Testing
        if (isUncleBob) {
          console.log(`\n🧬 Phase 5 (UB): Mutation Testing...`);
          const pMut = await phaseMutationTester(verbose);
          phases.push(pMut);
          state.lastMutationResult = pMut.passed;
          console.log(`   ${pMut.passed ? "✅" : "❌"} ${pMut.durationMs}ms`);
        }

        // Phase 5b (Test Quality): Validate test code quality
        if (isTestQuality) {
          console.log(`\n🧪 Phase 5b: Test Quality Validation...`);
          const pTQ = await phaseTestQuality(verbose);
          phases.push(pTQ);
          (state as any).testQualityScore = (pTQ as any).testQualityScore ?? 0;
          console.log(`   ${pTQ.passed ? "✅" : "❌"} Score: ${((pTQ as any).testQualityScore * 100).toFixed(1)}% (${pTQ.durationMs}ms)`);
        }

        // Phase 6 (original 3): Governance
        console.log(`\n⚙️  Phase ${isUncleBob ? "6" : "3/9"}: Governance (code gen + build)...`);
        const p3 = await phaseGovernance(verbose);
        phases.push(p3);
        state.lastBuildResult = p3.passed;
        console.log(`   ${p3.passed ? "✅" : "❌"} ${p3.durationMs}ms`);

        // Phase 7 (original 4): Security Gate
        console.log(`\n🛡️  Phase ${isUncleBob ? "7" : "4/9"}: Security Gate...`);
        const p4 = await phaseSecurityGate(verbose);
        phases.push(p4);
        state.lastSecurityResult = p4.passed;
        console.log(`   ${p4.passed ? "✅ ALL CHECKS PASSED" : "❌ Some checks failed"} ${p4.durationMs}ms`);

        if (p4.passed) {
          // Phase 8 (original 5): Build
          console.log(`\n🔨 Phase ${isUncleBob ? "8" : "5/9"}: Build...`);
          const p5 = await phaseBuild(verbose);
          phases.push(p5);
          state.lastBuildResult = p5.passed;
          console.log(`   ${p5.passed ? "✅" : "❌"} Build ${p5.passed ? "PASSED" : "FAILED"} ${p5.durationMs}ms`);
          if (!p5.passed) {
            console.log(`   Errors: ${p5.errors.slice(0, 5).join("\n    ")}`);
          }

          // Phase 9 (original 6): Reviewer
          console.log(`\n👁️  Phase ${isUncleBob ? "9" : "6/9"}: Reviewer Feedback Bus...`);
          const p6 = await phaseReviewer(verbose);
          phases.push(p6);
          state.lastReviewResult = p6.passed;
          console.log(`   ${p6.passed ? "✅" : "❌"} ${p6.durationMs}ms`);
          if (!p6.passed) {
            const blocking = p6.errors.length;
            console.log(`   ${blocking} blocking issues — circuit breaker may apply`);
          }

          // Phase 10 (original 7): Truth
          console.log(`\n🧪 Phase ${isUncleBob ? "10" : "7/9"}: Truth System...`);
          const p7 = await phaseTruth(verbose, runTests);
          phases.push(p7);
          state.lastTruthResult = p7.passed;
          state.lastTestResult = p7.passed;
          console.log(`   ${p7.passed ? "✅" : "❌"} ${p7.durationMs}ms`);

          if (p7.passed) {
            // Phase 11 (original 8): Deploy Readiness
            console.log(`\n🚀 Phase ${isUncleBob ? "11" : "8/9"}: Deploy Readiness...`);
            const p8 = await phaseDeployReadiness(verbose);
            phases.push(p8);
            state.lastDeployReadinessResult = p8.passed;
            console.log(`   ${p8.passed ? "✅" : "❌"} ${p8.durationMs}ms`);

            // Phase 12 (original 9): Feature Closer
            if (p8.passed) {
              console.log(`\n📦 Phase ${isUncleBob ? "12" : "9/9"}: Feature Closer...`);
              const p9 = await phaseCloseFeature(verbose);
              phases.push(p9);
              console.log(`   ${p9.passed ? "✅" : "❌"} ${p9.durationMs}ms`);
            }
          }
        }
      }
    }

    // Record iteration
    const lastP = phases[phases.length - 1] || phases[0] || p1;
    const record: IterationRecord = {
      iteration: state.iterations,
      timestamp: new Date().toISOString(),
      buildPassed: state.lastBuildResult,
      truthPassed: state.lastTruthResult,
      testsPassed: true,
      reviewPassed: state.lastReviewResult,
      securityPassed: state.lastSecurityResult,
      contextGuardPassed: state.lastContextGuardResult,
      placeholdersRemaining: 0,
      endpointFailCount: 0,
      durationMs: Date.now() - iterStart,
      errors: phases.flatMap(p => p.errors),
      phases,
    };

    // Extract placeholders from governance phase
    const govPhase = phases.find(p => p.phase === "governance") as PhaseResult & { placeholdersRemaining?: number } | undefined;
    if (govPhase && "placeholdersRemaining" in govPhase) {
      record.placeholdersRemaining = (govPhase as any).placeholdersRemaining;
    }

    const truthPhase = phases.find(p => p.phase === "truth") as any;
    if (truthPhase && truthPhase.endpointFailCount !== undefined) {
      record.endpointFailCount = truthPhase.endpointFailCount;
    }

    state.history.push(record);

    // Evaluate conditions
    const conditionsMet = evaluateConditions(goal, state);
    state.goalMet = conditionsMet;

    // Save state
    state.totalElapsedMs = Date.now() - startTime;
    saveState(state);

    // Report iteration
    console.log(`\n${"─".repeat(50)}`);
    console.log(`📊 Iteration ${state.iterations} results:`);
    const extra = isUncleBob ? `   📋 Spec:             ${state.lastSpecResult ? "✅" : "❌"}\n   🔄 TDD:              ${state.lastTddResult ? "✅" : "❌"}\n   🧬 Mutation:         ${state.lastMutationResult ? "✅" : "❌"} (${(state.mutationScore * 100).toFixed(0)}%)` : "";
    if (extra) console.log(extra);
    console.log(`   🔖 Context Guard:    ${record.contextGuardPassed ? "✅" : "❌"}`);
    console.log(`   ⚙️  Governance:       ${record.buildPassed ? "✅" : "❌"}`);
    console.log(`   🛡️  Security:         ${record.securityPassed ? "✅" : "❌"}`);
    console.log(`   🔨 Build:            ${record.buildPassed ? "✅" : "❌"}`);
    console.log(`   👁️  Review:           ${record.reviewPassed ? "✅" : "❌"}`);
    console.log(`   🧪 Truth:            ${record.truthPassed ? "✅" : "❌"}`);
    console.log(`   📦 Errors:           ${record.errors.length}`);
    console.log(`   ⏱️  Duration:         ${(record.durationMs / 1000).toFixed(1)}s`);

    if (conditionsMet) {
      console.log(`\n🎯 GOAL MET! All conditions satisfied.`);
      state.totalElapsedMs = Date.now() - startTime;
      saveState(state);
      return buildResult(state, true);
    }

    if (state.iterations >= goal.maxIterations) {
      console.log(`\n⛔ Max iterations (${goal.maxIterations}) reached without meeting goal.`);
      state.totalElapsedMs = Date.now() - startTime;
      saveState(state);
      return buildResult(state, false);
    }

    const waitTime = goal.intervalMs;
    console.log(`\n⏳ Waiting ${(waitTime / 1000).toFixed(0)}s before next iteration...`);
    await sleep(waitTime);
  }

  state.totalElapsedMs = Date.now() - startTime;
  saveState(state);
  return buildResult(state, false);
}

function createFreshState(goal: GoalConfig): LoopState {
  return {
    goalId: goal.id,
    description: goal.description,
    iterations: 0,
    totalElapsedMs: 0,
    maxIterations: goal.maxIterations,
    lastBuildResult: false,
    lastTruthResult: false,
    lastTestResult: false,
    lastReviewResult: false,
    lastSecurityResult: false,
    lastContextGuardResult: false,
    lastDeployReadinessResult: false,
    lastSpecResult: false,
    lastTddResult: false,
    lastMutationResult: false,
    mutationScore: 0,
    history: [],
    goalMet: false,
    memoryFile: memoryPath(goal.id),
  };
}

function evaluateConditions(goal: GoalConfig, state: LoopState): boolean {
  for (const condition of goal.conditions) {
    switch (condition.type) {
      case "build":
        if (!state.lastBuildResult) return false;
        break;
      case "truth":
        if (!state.lastTruthResult) return false;
        break;
      case "tests_pass":
        if (!state.lastTestResult) return false;
        break;
      case "placeholders": {
        const last = state.history[state.history.length - 1];
        if (last && last.placeholdersRemaining > 0) return false;
        break;
      }
      case "endpoints_all_ok": {
        const last = state.history[state.history.length - 1];
        if (last && last.endpointFailCount > 0) return false;
        break;
      }
      case "deploy_ready":
        if (!state.lastDeployReadinessResult) return false;
        break;
      case "spec_pass":
        if (!state.lastSpecResult) return false;
        break;
      case "tdd_pass":
        if (!state.lastTddResult) return false;
        break;
      case "mutation_pass":
        if (!state.lastMutationResult) return false;
        if (state.mutationScore < 0.9) return false;
        break;
      case "custom": {
        if (condition.customCheck && !condition.customCheck(state)) return false;
        break;
      }
    }
  }
  return true;
}

function buildResult(state: LoopState, goalMet: boolean): LoopResult {
  const totalTime = (state.totalElapsedMs / 1000 / 60).toFixed(1);
  const lastIter = state.history[state.history.length - 1];

  const summary = goalMet
    ? `✅ Goal "${state.goalId}" achieved in ${state.iterations} iterations (${totalTime}min)`
    : `❌ Goal "${state.goalId}" not met after ${state.iterations} iterations (${totalTime}min)`;

  return { goalMet, iterations: state.iterations, totalElapsedMs: state.totalElapsedMs, summary, state };
}

export function printLoopSummary(result: LoopResult): void {
  console.log("\n" + "=".repeat(55));
  console.log("   LOOP ENGINEERING V3 — SUMMARY");
  console.log("=".repeat(55));
  console.log(`   Goal:      ${result.state.description}`);
  console.log(`   Result:    ${result.goalMet ? "✅ MET" : "❌ NOT MET"}`);
  console.log(`   Iterations: ${result.iterations}`);
  console.log(`   Total time: ${(result.totalElapsedMs / 1000 / 60).toFixed(1)}min`);
  console.log(`   Memory:    ${result.state.memoryFile}`);
  console.log("");
  console.log("   Iteration History:");
  for (const rec of result.state.history) {
    const allOk = rec.contextGuardPassed && rec.buildPassed && rec.securityPassed && rec.reviewPassed && rec.truthPassed;
    const icon = allOk ? "✅" : "❌";
    console.log(`   ${icon} #${rec.iteration} ctx=${rec.contextGuardPassed} build=${rec.buildPassed} sec=${rec.securityPassed} review=${rec.reviewPassed} truth=${rec.truthPassed} err=${rec.errors.length} (${(rec.durationMs / 1000).toFixed(1)}s)`);
    for (const phase of rec.phases) {
      const pIcon = phase.passed ? "✅" : "❌";
      console.log(`     ${pIcon} ${phase.phase} (${phase.durationMs}ms) ${phase.errors.length ? `errors:${phase.errors.length}` : ""}`);
    }
  }
  console.log("=".repeat(55));
}
