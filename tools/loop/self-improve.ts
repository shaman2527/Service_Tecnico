/**
 * tools/loop/self-improve.ts
 *
 * Self-improvement module for the $P Engine.
 *
 * Scans tools/, detects gaps vs roadmap, reports areas for improvement.
 * Used by the "self-improve" goal.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { detectProject, type DetectedProject } from "../detector";

const TOOLS_DIR = path.resolve(process.cwd(), "tools");
const ARTIFACTS_DIR = path.resolve(process.cwd(), config.paths.artifactsDir);

export interface ModuleInfo {
  file: string;
  relativePath: string;
  type: "ts-source" | "test" | "md-doc" | "config" | "agent";
  hasTests: boolean;
  hasDocs: boolean;
  inLoop: boolean;
  errorHandling: boolean;
  usesConfig: boolean;
  lines: number;
}

export interface GapInfo {
  title: string;
  description: string;
  effort: "low" | "medium" | "high";
  impact: "high" | "medium" | "low";
  recommendation: "do-now" | "plan" | "note";
  filesAffected: string[];
  status: "open" | "in-progress" | "done";
}

export interface SelfImproveReport {
  scanned: ModuleInfo[];
  totalFiles: number;
  modulesWithTests: number;
  modulesWithDocs: number;
  modulesInLoop: number;
  coverage: number;
  gaps: GapInfo[];
  gapsFound: number;
  summary: string;
}

const LOOP_FILES = [
  "loop/goal-definitions", "loop/loop-engine", "loop/run",
  "governance/security-validator", "governance/reviewer-bus",
  "governance/build-validator", "governance/context-guard",
  "governance/pattern-detector", "governance/feature-closer",
  "spec/spec-partner", "spec/hard-spec",
  "tdd/tdd-craftsman", "tdd/judge", "tdd/cycle-log",
  "mutation/mutate", "mutation/mutation-tester", "mutation/survivors",
  "testing/test-quality", "testing/coverage",
  "truth/truth-orchestrator", "truth/runtime-smoke",
  "auto-fix/engine", "auto-fix/pre-flight", "auto-fix/safe-apply",
  "code-generator/engine",
  "engine/index",
];

const KNOWN_GAPS: GapInfo[] = [
  {
    title: "AI Fix Generation",
    description: "Auto-fix usa Claude API para generar fixes de naming y tipos. Requiere @anthropic-ai/sdk + ANTHROPIC_API_KEY.",
    effort: "high",
    impact: "high",
    recommendation: "plan",
    filesAffected: ["tools/auto-fix/ai-fixer.ts", "tools/auto-fix/engine.ts", "tools/config.ts"],
    status: "open",
  },
  {
    title: "Parallel Mutation Runner",
    description: "Mutation testing en paralelo con Workers. Reduce tiempo de 5min a <1min.",
    effort: "medium",
    impact: "medium",
    recommendation: "plan",
    filesAffected: ["tools/mutation/parallel-runner.ts"],
    status: "open",
  },
  {
    title: "Snapshot Drift Detection",
    description: "Verificar snapshots desactualizados en el reviewer. Comparar outputs actuales con snapshots guardados.",
    effort: "low",
    impact: "medium",
    recommendation: "do-now",
    filesAffected: ["tools/governance/reviewer-bus.ts", "tools/testing/snapshot-helper.ts"],
    status: "open",
  },
  {
    title: "Coverage Trend",
    description: "Histórico de coverage (líneas, branches, funciones) en el tiempo. Gráfico de evolución.",
    effort: "low",
    impact: "low",
    recommendation: "note",
    filesAffected: ["tools/testing/coverage.ts", "progress/metrics/coverage-history.json"],
    status: "open",
  },
  {
    title: "Playwright E2E Setup",
    description: "Tests E2E reales con navegador. Login + flujos críticos como usuario real.",
    effort: "high",
    impact: "medium",
    recommendation: "note",
    filesAffected: ["tests/e2e/", ".github/workflows/tools-loop.yml"],
    status: "open",
  },
  {
    title: "Code Gen Build Validation",
    description: "Después de generate(), correr build automáticamente. Si falla, no hacer commit.",
    effort: "low",
    impact: "high",
    recommendation: "do-now",
    filesAffected: ["tools/code-generator/engine.ts"],
    status: "open",
  },
  {
    title: "Dependabot / Renovate",
    description: "Auto-update de dependencias npm. Abrir PR automáticos para updates de seguridad.",
    effort: "low",
    impact: "low",
    recommendation: "note",
    filesAffected: [".github/dependabot.yml"],
    status: "open",
  },
];

function hasTestFile(moduleName: string): boolean {
  const base = path.join(TOOLS_DIR, moduleName);
  if (fs.existsSync(path.dirname(base)) && fs.readdirSync(path.dirname(base)).some(f => /\.(test|spec)\./.test(f))) {
    return true;
  }
  // Check broader
  const testDir = path.join(TOOLS_DIR, "..", "tests");
  return fs.existsSync(testDir) && fs.readdirSync(testDir, { recursive: true }).some(f =>
    typeof f === "string" && f.includes(moduleName.split("/").pop() || "")
  );
}

function hasDoc(moduleName: string): boolean {
  const readme = path.join(TOOLS_DIR, "README.md");
  if (fs.existsSync(readme)) {
    const content = fs.readFileSync(readme, "utf-8");
    if (content.includes(moduleName.split("/").pop() || "")) return true;
  }
  const docsDir = path.join(process.cwd(), "docs");
  return fs.existsSync(docsDir) && fs.readdirSync(docsDir).some(f => f.includes(moduleName.split("/").pop() || ""));
}

function isInLoop(moduleName: string): boolean {
  return LOOP_FILES.some(lf => moduleName.includes(lf.replace("loop/", "")));
}

function hasErrorHandling(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return /\btry\b/.test(content) && /\bcatch\b/.test(content);
}

function usesConfig(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return content.includes('from "../config"') || content.includes('from "../config"');
}

export function scanModules(): ModuleInfo[] {
  const modules: ModuleInfo[] = [];

  function walk(dir: string, depth: number = 0): void {
    if (depth > 4 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(TOOLS_DIR, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".spec.ts")) {
        const moduleName = relPath.replace(/\.ts$/, "");
        const testExists = hasTestFile(moduleName);
        const docExists = hasDoc(moduleName);
        const inLoop = isInLoop(moduleName);
        const errorHandling = hasErrorHandling(fullPath);
        const usesConfigFile = usesConfig(fullPath);
        const lines = fs.readFileSync(fullPath, "utf-8").split("\n").length;

        modules.push({
          file: fullPath,
          relativePath: relPath,
          type: "ts-source",
          hasTests: testExists,
          hasDocs: docExists,
          inLoop,
          errorHandling,
          usesConfig: usesConfigFile,
          lines,
        });
      }
    }
  }

  walk(TOOLS_DIR);
  return modules;
}

export function detectGaps(modules: ModuleInfo[], dashboardGaps?: GapInfo[]): GapInfo[] {
  const gaps: GapInfo[] = dashboardGaps ? [...dashboardGaps] : [...KNOWN_GAPS];

  // Find modules without tests
  const noTests = modules.filter(m => !m.hasTests && m.relativePath !== "config");
  for (const m of noTests.slice(0, 5)) {
    if (!gaps.find(g => g.filesAffected.includes(m.relativePath))) {
      gaps.push({
        title: `Missing tests for ${m.relativePath}`,
        description: `${m.relativePath} has no corresponding .test.ts or .spec.ts file.`,
        effort: "medium",
        impact: "medium",
        recommendation: "plan",
        filesAffected: [m.relativePath],
        status: "open",
      });
    }
  }

  // Find modules without docs
  const noDocs = modules.filter(m => !m.hasDocs && m.relativePath !== "config");
  for (const m of noDocs.slice(0, 3)) {
    if (!gaps.find(g => g.filesAffected.includes(m.relativePath))) {
      gaps.push({
        title: `Documentation for ${m.relativePath}`,
        description: `${m.relativePath} is not referenced in tools/README.md or docs/.`,
        effort: "low",
        impact: "low",
        recommendation: "do-now",
        filesAffected: [m.relativePath, "tools/README.md"],
        status: "open",
      });
    }
  }

  // Find modules without error handling
  const noErrorHandling = modules.filter(m => !m.errorHandling && m.lines > 30);
  for (const m of noErrorHandling.slice(0, 3)) {
    if (!gaps.find(g => g.filesAffected.includes(m.relativePath))) {
      gaps.push({
        title: `Add error handling to ${m.relativePath}`,
        description: `${m.relativePath} has ${m.lines} lines but no try/catch blocks.`,
        effort: "low",
        impact: "high",
        recommendation: "do-now",
        filesAffected: [m.relativePath],
        status: "open",
      });
    }
  }

  return gaps;
}

function generateAutoFixes(gaps: GapInfo[]): string[] {
  const fixes: string[] = [];
  for (const gap of gaps) {
    if (gap.recommendation !== "do-now") continue;
    switch (gap.title) {
      case "Code Gen Build Validation":
        fixes.push("Add `if !buildResult.success { process.exit(1) }` after code-generator/engine.ts generate() call");
        break;
      case "Snapshot Drift Detection":
        fixes.push("Add snapshot comparison in reviewer-bus.ts: `const snapPath = path.join(ARTIFACTS_DIR, 'snapshots', file);`");
        break;
      case "Coverage Trend":
        fixes.push("Create progress/metrics/ dir and append coverage data as JSON after each test run");
        break;
      default:
        if (gap.title.startsWith("Missing tests")) {
          const file = gap.filesAffected[0].replace(/\.ts$/, ".test.ts");
          fixes.push(`Create ${file} with basic test structure for ${gap.filesAffected[0]}`);
        } else if (gap.title.startsWith("Documentation")) {
          fixes.push(`Add section for ${gap.filesAffected[0]} in tools/README.md`);
        } else if (gap.title.startsWith("Add error handling")) {
          fixes.push(`Add try/catch blocks to ${gap.filesAffected[0]}`);
        }
    }
  }
  return fixes;
}

export function runSelfImprove(options: { verbose?: boolean } = {}): SelfImproveReport {
  const { verbose = false } = options;
  const project = detectProject();

  console.log("\n🔍 Self-Improve Analysis");
  console.log("   Scanning tools/ modules...\n");

  const modules = scanModules();
  const gaps = detectGaps(modules);

  const autoFixes = generateAutoFixes(gaps);

  // Priority scoring: impact × effort matrix
  const impactScore: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const effortMultiplier: Record<string, number> = { low: 1.0, medium: 0.5, high: 0.25 };
  for (const gap of gaps) {
    (gap as GapInfo & { priorityScore?: number }).priorityScore =
      (impactScore[gap.impact] || 1) * (effortMultiplier[gap.effort] || 0.5);
  }
  gaps.sort((a, b) => ((b as any).priorityScore || 0) - ((a as any).priorityScore || 0));

  const totalFiles = modules.length;
  const modulesWithTests = modules.filter(m => m.hasTests).length;
  const modulesWithDocs = modules.filter(m => m.hasDocs).length;
  const modulesInLoop = modules.filter(m => m.inLoop).length;
  const coverage = totalFiles > 0 ? (modulesWithTests / totalFiles) * 100 : 0;

  const doNow = gaps.filter(g => g.recommendation === "do-now").length;
  const plan = gaps.filter(g => g.recommendation === "plan").length;
  const note = gaps.filter(g => g.recommendation === "note").length;

  const summary = [
    `## Self-Improve Report`,
    ``,
    `### Project: ${project.name}`,
    `- **Language:** ${project.language} ${project.framework ? `(${project.framework})` : ""}`,
    `- **Database:** ${project.database ?? "none"}`,
    `- **Tests:** ${project.testFramework ?? "none"}`,
    ``,
    `### Scan Results`,
    `- **Total source files:** ${totalFiles}`,
    `- **With tests:** ${modulesWithTests} (${coverage.toFixed(0)}%)`,
    `- **With docs:** ${modulesWithDocs} (${totalFiles > 0 ? (modulesWithDocs / totalFiles * 100).toFixed(0) : 0}%)`,
    `- **In loop:** ${modulesInLoop} (${totalFiles > 0 ? (modulesInLoop / totalFiles * 100).toFixed(0) : 0}%)`,
    `- **With error handling:** ${modules.filter(m => m.errorHandling).length}`,
    `- **Using config.ts:** ${modules.filter(m => m.usesConfig).length}`,
    ``,
    `### Gaps Detected`,
    `- **Total gaps:** ${gaps.length}`,
    `- **Do now:** ${doNow}`,
    `- **Plan:** ${plan}`,
    `- **Note:** ${note}`,
    ``,
    `### By recommendation`,
    doNow > 0 ? `#### Do now (${doNow})` : "",
    ...gaps.filter(g => g.recommendation === "do-now").map(g =>
      `- [ ] **${g.title}** (${g.effort} effort, ${g.impact} impact)\n  ${g.description.slice(0, 100)}`),
    ``,
    plan > 0 ? `#### Plan (${plan})` : "",
    ...gaps.filter(g => g.recommendation === "plan").map(g =>
      `- [ ] **${g.title}** (${g.effort} effort, ${g.impact} impact)\n  ${g.description.slice(0, 100)}`),
    ``,
    note > 0 ? `#### Note (${note})` : "",
    ...gaps.filter(g => g.recommendation === "note").map(g =>
      `- [ ] **${g.title}** (${g.effort} effort, ${g.impact} impact)\n  ${g.description.slice(0, 100)}`),
    ``,
    `### Detailed module list`,
    ...modules.slice(0, 10).map(m =>
      `- ${m.relativePath} (${m.lines} lines) ${m.hasTests ? "✅ test" : "❌ no test"} ${m.hasDocs ? "✅ doc" : "❌ no doc"} ${m.inLoop ? "✅ loop" : "❌ not in loop"}`),
    modules.length > 10 ? `  ... and ${modules.length - 10} more modules` : "",
    ``,
    autoFixes.length > 0 ? `### Auto-Fix Suggestions (${autoFixes.length})` : "",
    ...autoFixes.map((f, i) => `${i + 1}. ${f}`),
  ].filter(Boolean).join("\n");

  // Save report
  const reportPath = path.join(ARTIFACTS_DIR, "self-improve-report.md");
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(reportPath, summary, "utf-8");

  if (verbose) console.log(summary);

  return {
    scanned: modules,
    totalFiles,
    modulesWithTests,
    modulesWithDocs,
    modulesInLoop,
    coverage,
    gaps,
    gapsFound: gaps.length,
    summary,
  };
}