import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { readAgentsMd } from "./docs-sync";
import { detectPatterns, findAllAstroPages } from "./pattern-detector";
import { runBuild } from "./build-validator";
import { runFullSecurityScan, printSecurityReport } from "./security-validator";
import { updateAgentsMd, generateSessionReport } from "./docs-sync";
import type { SessionState, PatternMatch, GovernanceDecision, GovernanceResult } from "./types";
import { config } from "../config";
import type { GenerateOptions } from "../code-generator/engine";
import { trigger as hookTrigger, resetCycle } from "./hook-broker";
import { registerAllHooks } from "./hooks/index";

// Lazy-load code generator — only if codeGen is enabled
async function loadCodeGen() {
  if (!config.codeGen.enabled) return null;
  try {
    const { allPages } = await import("../code-generator/plans/mvp-pages");
    const { generateAll } = await import("../code-generator/engine");
    return { allPages, generateAll };
  } catch {
    console.log("   ⚠️  Code generator plans not found — skipping generation");
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROGRESS_DIR = path.resolve(__dirname, "../progress/artifacts");
const RESULT_PATH = path.join(PROGRESS_DIR, "gov-result.json");

const args = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--skip": case "-s": flags.skip = true; break;
    case "--dry-run": case "-d": flags.dryRun = true; break;
    case "--verbose": case "-v": flags.verbose = true; break;
    case "--help": case "-h": flags.help = true; break;
    case "--build-only": flags.buildOnly = true; break;
    case "--detect-only": flags.detectOnly = true; break;
    case "--security": flags.runSecurity = true; break;
    case "--learning": flags.runLearning = true; break;
    case "--context-guard": flags.runContextGuard = true; break;
  }
}

if (flags.help) {
  console.log(`
Usage: npx tsx tools/governance/run.ts [options]

Governance meta-engine — analyzes state, detects patterns, generates code, validates build, runs security checks.

Options:
  --skip, -s             Skip existing files during code generation
  --dry-run, -d          Preview without writing files
  --verbose, -v          Detailed output
  --build-only           Only run build validation
  --detect-only          Only detect patterns, no generation
  --security             Run full security scan (RLS, service key, tenant isolation, admin guards)
  --learning             Run learning injector (read patterns.md + history.md for constraints)
  --context-guard        Run context guard (check git diff vs feature scope)
  --help, -h             Show this help
`);
  process.exit(0);
}

async function main() {
  const govTitle = `${config.projectName} — Governance Meta-Engine`;
  const pad = "═".repeat(Math.max(40, govTitle.length + 4));
  console.log(`╔${pad}╗`);
  console.log(`║  ${govTitle}  ║`);
  console.log(`╚${pad}╝`);

  // === OPTIONAL: Learning Injector ===
  if (flags.runLearning) {
    console.log(`\n📖 Running Learning Injector...`);
    const { loadLearningContext, printLearningContext } = await import("./learning-injector");
    const ctx = loadLearningContext();
    printLearningContext(ctx);
    if (ctx.errorsToAvoid.length > 0) {
      console.log(`   ⛔ ${ctx.errorsToAvoid.length} recurring errors to avoid`);
    }
  }

  // === OPTIONAL: Context Guard ===
  if (flags.runContextGuard) {
    console.log(`\n🔒 Running Context Guard...`);
    const { runContextGuard, printContextGuardResult } = await import("./context-guard");
    const guardResult = await runContextGuard();
    printContextGuardResult(guardResult);
    if (!guardResult.passed) {
      console.log(`\n❌ Context Guard blocked — exiting.`);
      process.exit(1);
    }
  }

  // === HOOKS: Register event listeners ===
  resetCycle();
  registerAllHooks();
  console.log("   🔌 Hooks system initialized");

  // === STATE: Read current project state ===
  const astroPages = findAllAstroPages();

  const totalPages = astroPages.length;
  const placeholderPages = astroPages.filter(p => p.isPlaceholder);
  const implementedPages = totalPages - placeholderPages.length;

  const state: SessionState = {
    projectDir: process.cwd(),
    totalPages,
    implementedPages,
    placeholderPages: placeholderPages.length,
    generatedPages: 0,
    handBuiltPages: 0,
    patternsFound: [],
    decisions: [],
    lastBuild: null,
    hooksApplied: [],
    skillsLoaded: [],
  };

  console.log(`\n📊 Project State:`);
  console.log(`   Pages: ${totalPages} total, ${implementedPages} implemented, ${placeholderPages.length} placeholders`);

  // === PRE_EXECUTE: Validate state before acting ===
  await hookTrigger("PRE_EXECUTE", {
    sender: "governance",
    target: "run-engine",
    data: { placeholderCount: placeholderPages.length, totalPages },
  });

  // Load code generator (lazy — may not have plans)
  const codeGen = await loadCodeGen();

  // === REASON: Detect patterns ===
  console.log(`\n🔍 Detecting patterns...`);
  const plans = codeGen?.allPages ?? [];
  state.patternsFound = detectPatterns(plans);

  if (state.patternsFound.length === 0) {
    console.log(`   No patterns found — project is up to date.`);
  } else {
    for (const p of state.patternsFound) {
      const tag = p.confidence > 0.8 ? "HIGH" : "MEDIUM";
      console.log(`   [${tag}] ${p.description} → ${p.suggestedAction}`);
    }
  }

  if (flags.detectOnly) {
    console.log("\n✅ Detection complete. Use --dry-run to preview or run without flags to execute.");
    process.exit(0);
  }

  // === ACT: Run code generator or create templates ===
  const highPriorityPatterns = state.patternsFound.filter(p => p.confidence > 0.8);

  for (const pattern of highPriorityPatterns) {
    if (pattern.suggestedAction === "create-template") {
      console.log(`\n🔧 Creating template for: ${pattern.description}`);
      if (pattern.templateName === "panel-component") {
        const { generatePanelComponentTemplate, writeTemplateFile } = await import("./template-generator");
        const templateContent = generatePanelComponentTemplate();
        writeTemplateFile("panel-component.ts", templateContent);
        console.log(`   ⚠️  Engine.ts update required: add case "PanelLayout" → generatePanelComponent(page)`);
      }
    }
  }

  const hasCrudPlaceholders = state.patternsFound.some(
    p => p.kind === "placeholder" && p.suggestedAction === "run-engine"
  );

  if (hasCrudPlaceholders && !flags.buildOnly) {
    console.log(`\n⚙️  Running code generator...`);
    const codeGen = await loadCodeGen();
    if (!codeGen) {
      console.log(`   ⚠️  Code generation skipped — no page plans found`);
      console.log(`   To enable: set codeGen.enabled=true and create ${config.codeGen.plansFile}`);
    } else {
      const genOptions: any = {};
      if (flags.skip) genOptions.writeMode = "skip";
      if (flags.dryRun) genOptions.dryRun = true;
      if (flags.verbose) genOptions.verbose = true;

      const result = codeGen.generateAll(codeGen.allPages, genOptions);
      state.generatedPages = result.generated.length;

      console.log(`   Generated: ${result.generated.length} files`);
      if (result.errors.length > 0) {
        console.log(`   Errors: ${result.errors.length}`);
        for (const e of result.errors) {
          console.log(`     ❌ ${e.page}: ${e.error}`);
        }
      }
    }
  }

  // === OPTIONAL: Security Gate ===
  if (flags.runSecurity) {
    console.log(`\n🛡️  Running Security Gate...`);
    const report = await runFullSecurityScan();
    printSecurityReport(report);
    if (!report.passed) {
      console.log(`\n⚠️  Security issues found — review above.`);
    }
    if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });
    fs.writeFileSync(path.join(PROGRESS_DIR, "security-report.json"), JSON.stringify(report, null, 2), "utf-8");
  }

  // === OBSERVE: Run build validation ===
  await hookTrigger("BEFORE_BUILD", {
    sender: "governance",
    target: "build",
    data: {},
  });

  console.log(`\n🔨 Running build validation...`);
  const buildResult = runBuild("npm", ["run", "build"], 180000);
  state.lastBuild = buildResult;

  if (buildResult.success) {
    console.log(`   ✅ Build PASSED (${(buildResult.durationMs / 1000).toFixed(1)}s)`);
    await hookTrigger("AFTER_BUILD", {
      sender: "governance",
      target: "build",
      data: { success: true, durationMs: buildResult.durationMs },
    });
  } else {
    console.log(`   ❌ Build FAILED (${(buildResult.durationMs / 1000).toFixed(1)}s)`);
    console.log(`   Errors: ${buildResult.errors.length}`);
    for (const e of buildResult.errors.slice(0, 5)) {
      console.log(`     - ${e.file}:${e.line || "?"} ${e.message.slice(0, 120)}`);
    }

    await hookTrigger("ON_FAILURE", {
      sender: "governance",
      target: "build",
      data: { errors: buildResult.errors, rawOutput: buildResult.rawOutput },
    });
  }

  // === REFLECT: Update documentation ===
  console.log(`\n📝 Updating documentation...`);

  await hookTrigger("STATE_MUTATED", {
    sender: "governance",
    target: "docs",
    data: { buildResult: { success: buildResult.success, errors: buildResult.errors.length } },
  });

  updateAgentsMd(buildResult);
  const report = generateSessionReport(state);
  console.log(report);

  // Write structured JSON result
  const govResult: GovernanceResult = {
    buildPassed: buildResult.success,
    placeholdersRemaining: placeholderPages.length,
    generatedFiles: state.generatedPages,
    errors: buildResult.errors,
    durationMs: buildResult.durationMs,
    timestamp: new Date().toISOString(),
  };
  if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  fs.writeFileSync(RESULT_PATH, JSON.stringify(govResult, null, 2), "utf-8");

  console.log("═══════════════════════════════════════════════");
  console.log(`Build: ${buildResult.success ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Generated: ${state.generatedPages} files`);
  if (!buildResult.success) {
    console.log(`\n❌ Build failed with ${buildResult.errors.length} error(s). Review above.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
