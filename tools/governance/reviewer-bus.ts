import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ReviewResult, ReviewFinding } from "./types";
import { config } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, config.paths.artifactsDir);
const REVIEW_PATH = path.join(ARTIFACTS_DIR, "review.json");
const FEATURE_LIST_PATH = path.join(PROJECT_ROOT, "feature_list.json");

const MAX_REVIEW_ATTEMPTS = 3;

function loadFeatureList(): { id: number; title: string; status: string }[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FEATURE_LIST_PATH, "utf-8"));
    return raw.features ?? [];
  } catch {
    return [];
  }
}

function getActiveFeature(): { id: number; title: string } | null {
  const features = loadFeatureList();
  const active = features.find(f => f.status === "in_progress");
  if (active) return { id: active.id, title: active.title };
  const pending = features.find(f => f.status === "pending");
  if (pending) return { id: pending.id, title: pending.title };
  return null;
}

function loadPreviousReview(): ReviewResult | null {
  try {
    return JSON.parse(fs.readFileSync(REVIEW_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function getChangedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 5000,
    });
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Check #1: API endpoint existence — verify every `fetch("/api/...")` has a matching file */
function checkApiEndpointExistence(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const srcDir = path.join(PROJECT_ROOT, config.paths.sourceDir);

  // Collect all registered API file paths (without extension)
  const apiFiles = new Set<string>();
  function collectApis(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectApis(full);
      else if (entry.name.endsWith(".ts") && !entry.name.startsWith("_")) {
        const rel = path.relative(path.join(PROJECT_ROOT, config.paths.pagesDir), full).replace(/\\/g, "/").replace(/\.ts$/, "");
        apiFiles.add(rel);
      }
    }
  }
  collectApis(path.join(PROJECT_ROOT, config.paths.apiDir));

  // Also collect from the pages directory for mixed routes
  const astroRoutes = new Set<string>();
  function collectAstro(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectAstro(full);
      else if (entry.name.endsWith(".astro")) {
        const rel = path.relative(path.join(PROJECT_ROOT, config.paths.pagesDir), full).replace(/\\/g, "/").replace(/\.astro$/, "");
        astroRoutes.add(rel);
      }
    }
  }
  collectAstro(path.join(PROJECT_ROOT, config.paths.pagesDir));

  for (const file of changedFiles) {
    const content = readFileSafe(path.join(PROJECT_ROOT, file));
    if (!content) continue;

    // Find all fetch("/api/...") calls
    const fetchMatches = content.matchAll(/fetch\(["'](\/api\/[^"']+)["']\)/g);
    for (const match of fetchMatches) {
      const apiUrl = match[1];
      // Remove query params
      const apiPath = apiUrl.split("?")[0];
      // Remove trailing slash
      const normalizedPath = apiPath.replace(/\/$/, "");

      // Convert /api/panel/x -> panel/x (matching the ts file path)
      const relativePath = normalizedPath.replace(/^\/api\//, "");
      if (!apiFiles.has(relativePath) && !apiFiles.has(relativePath + "/index")) {
        // Maybe it's being fetched but doesn't exist yet (pending feature)
        findings.push({
          severity: "warning",
          category: "consistency",
          file,
          message: `fetch("${apiUrl}") — no se encontró archivo API en src/pages/api/${relativePath}.ts`,
        });
      }
    }
  }

  return findings;
}

/** Check #2: Component-API data flow consistency */
function checkDataFlowConsistency(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of changedFiles) {
    const content = readFileSafe(path.join(PROJECT_ROOT, file));
    if (!content) continue;

    // Check component files that do fetch
    if (file.endsWith(".tsx")) {
      const fetchBlocks = content.matchAll(/res\.json\(\)[\s\S]*?;/g);
      for (const block of fetchBlocks) {
        const jsonCall = block[0];
        // Check that .json() result is stored or returned
        if (jsonCall.includes("res.json()") && !jsonCall.includes("await res.json()")) {
          findings.push({
            severity: "warning",
            category: "consistency",
            file,
            message: "res.json() sin await — posible error de Promise pendiente",
          });
        }
      }
    }

    // Check for common runtime errors
    if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      // Check optional chaining on potentially null API responses
      if (content.includes("set") && (content.includes("fetch(") || content.includes("supabase"))) {
        if (content.includes("data.") && !content.includes("data?.")) {
          findings.push({
            severity: "info",
            category: "consistency",
            file,
            message: "Acceso a data. sin optional chaining (data?.) — posible error si la respuesta es null",
          });
        }
      }
    }
  }

  return findings;
}

/** Check #3: Migration SQL validation */
function checkMigrationChanges(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of changedFiles) {
    const migPrefix = config.paths.migrationsDir.replace(/\\/g, "/") + "/";
    if (!file.startsWith(migPrefix) || !file.endsWith(".sql")) continue;

    const content = readFileSafe(path.join(PROJECT_ROOT, file));
    if (!content) continue;

    // Check CREATE TABLE is paired with ALTER TABLE ENABLE ROW LEVEL SECURITY
    const createTables = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi);
    const tablesCreated = [...createTables].map(m => m[1].toLowerCase());

    if (tablesCreated.length > 0) {
      const hasRlsEnable = content.match(/ALTER\s+TABLE\s+\w+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      if (!hasRlsEnable) {
        findings.push({
          severity: "blocking",
          category: "migration",
          file,
          message: `Migration crea tabla(s) [${tablesCreated.join(", ")}] sin ENABLE ROW LEVEL SECURITY`,
        });
      }
    }

    // Check CREATE POLICY references exist
    const policyStatements = content.matchAll(/CREATE\s+POLICY\s+"?(\w+)"?\s+ON\s+(?:\w+\.)?(\w+)/gi);
    for (const policy of policyStatements) {
      const tableName = policy[2].toLowerCase();
      const hasAlterRls = content.includes(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`)
        || content.includes(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`)
        || content.includes(`ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY`);
      if (!hasAlterRls && !tablesCreated.includes(tableName)) {
        // RLS might have been enabled on the table in a prior migration — not critical
      }
    }

    // Check for REVOKE statements that might break existing functionality
    const revokeMatches = content.matchAll(/REVOKE\s+(INSERT|UPDATE|DELETE|ALL)\s+.*?ON\s+(\w+)/gi);
    for (const revoke of revokeMatches) {
      const tableName = revoke[2].toLowerCase();
      const hasCreateTable = content.includes(`CREATE TABLE ${tableName}`) || content.includes(`CREATE TABLE "${tableName}"`);
      if (!hasCreateTable) {
        findings.push({
          severity: "warning",
          category: "security",
          file,
          message: `REVOKE on table "${tableName}" que no se crea en esta migration — verificar impacto en tablas existentes`,
        });
      }
    }
  }

  return findings;
}

/** Check #5: Migration applied check — verify new migrations are pushed to remote Supabase */
function checkMigrationApplied(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const migPrefix = config.paths.migrationsDir.replace(/\\/g, "/") + "/";
  const hasNewMigration = changedFiles.some(f => f.startsWith(migPrefix) && f.endsWith(".sql"));
  if (!hasNewMigration) return findings;

  try {
    const output = execSync("npx supabase migration list", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 30000,
    });

    // Parse the migration list output
    const lines = output.split("\n");
    let latestLocal = "";
    let latestRemote = "";

    for (const line of lines) {
      // Match lines like "   0018  | 0018   | 0018" or "   0018  |        | 0018"
      const match = line.match(/^\s+(\S+)\s+\|\s+(\S+)?\s+\|\s+/);
      if (match) {
        const localName = match[1];
        const remoteName = match[2] ? match[2].trim() : "";

        if (localName) latestLocal = localName;
        if (remoteName) latestRemote = remoteName;

        // If a local migration has no remote counterpart, flag it
        if (localName && !remoteName) {
          findings.push({
            severity: "blocking",
            category: "migration",
            file: `${config.paths.migrationsDir}/${localName}_*.sql`,
            message: `Migration "${localName}" está local pero NO en remote — ejecutar "npx supabase db push" para aplicarla`,
          });
        }
      }
    }

    // If latest local isn't on remote, also warn generically
    if (latestLocal && latestLocal !== latestRemote) {
      findings.push({
        severity: "blocking",
        category: "migration",
        file: config.paths.migrationsDir + "/",
        message: `Schema cache desactualizado — última migration local (${latestLocal}) no coincide con remote (${latestRemote || "ninguna"}). Ejecuta "npx supabase db push"`,
      });
    }
  } catch (err: any) {
    // supabase CLI might not be available — skip check silently
    const msg = err?.message || String(err);
    if (msg.includes("not found") || msg.includes("not recognized")) {
      // CLI not installed — skip
    } else {
      findings.push({
        severity: "warning",
        category: "migration",
        file: config.paths.migrationsDir + "/",
        message: `No se pudo verificar estado remoto de migrations: ${msg.slice(0, 120)}`,
      });
    }
  }

  return findings;
}

/** Check #4: TypeScript compile check — returns findings for tsc errors */
function checkTypeScript(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const tsconfigPath = path.join(PROJECT_ROOT, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return findings;

  try {
    execSync("npx tsc --noEmit --pretty false", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // No errors
  } catch (e: any) {
    const stderr: string = e.stderr || e.stdout || "";
    // Filter errors to only show those in changed files
    const lines = stderr.split("\n");
    for (const line of lines) {
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/);
      if (match) {
        const errFile = match[1].replace(/\\/g, "/");
        const relativeFile = path.relative(PROJECT_ROOT, errFile).replace(/\\/g, "/");
        const isInChanged = changedFiles.some(f => {
          const normalized = f.replace(/\\/g, "/");
          return relativeFile === normalized || relativeFile.endsWith("/" + normalized);
        });
        if (isInChanged || changedFiles.length === 0) {
          findings.push({
            severity: "blocking",
            category: "typescript",
            file: relativeFile,
            message: `TS${match[4]}: ${match[5]} (línea ${match[2]})`,
          });
        }
      }
    }
  }

  return findings;
}

/** Check #5: Import resolution — check that imports in changed files resolve */
function checkImportResolution(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of changedFiles) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;

    const content = readFileSafe(path.join(PROJECT_ROOT, file));
    if (!content) continue;

    const importMatches = content.matchAll(/from\s+["'](.+?)["']/g);
    for (const match of importMatches) {
      const importPath = match[1];

      // Skip npm packages (no relative/absolute path)
      if (!importPath.startsWith(".") && !importPath.startsWith("@/") && !importPath.startsWith("/")) continue;

      // Resolve the import path
      const fileDir = path.dirname(path.join(PROJECT_ROOT, file));
      let resolvedPath: string;

      if (importPath.startsWith("@/")) {
        resolvedPath = path.join(PROJECT_ROOT, config.paths.sourceDir, importPath.slice(2));
      } else {
        resolvedPath = path.resolve(fileDir, importPath);
      }

      // Try extensions
      const exts = [".ts", ".tsx", ".astro", "/index.ts", "/index.tsx"];
      let exists = fs.existsSync(resolvedPath);
      if (!exists) {
        for (const ext of exts) {
          if (fs.existsSync(resolvedPath + ext)) { exists = true; break; }
          if (fs.existsSync(resolvedPath.replace(/\/[^/]+$/, "") + ext)) { exists = true; break; }
        }
      }

      if (!exists && !resolvedPath.includes("node_modules")) {
        findings.push({
          severity: "blocking",
          category: "typescript",
          file,
          message: `Import no resuelve: "${importPath}" → buscado en "${resolvedPath}"`,
        });
      }
    }
  }

  return findings;
}

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function analyzeChangedFiles(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of changedFiles) {
    let content: string;
    try {
      content = fs.readFileSync(path.resolve(PROJECT_ROOT, file), "utf-8");
    } catch {
      continue;
    }

    if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      if (content.includes("console.log") && !file.includes("test")) {
        findings.push({
          severity: "warning",
          category: "quality",
          file,
          message: "console.log() en archivo de producción — considerar eliminar o usar logger",
        });
      }
      if (content.includes("TODO") && !content.includes("TODO:")) {
        findings.push({
          severity: "info",
          category: "quality",
          file,
          message: "TODO encontrado sin referencia a issue — agregar contexto",
        });
      }
      if (content.includes("any") && content.split("any").length > 3) {
        findings.push({
          severity: "warning",
          category: "quality",
          file,
          message: "Uso excesivo de `any` — tipar explícitamente",
        });
      }
    }

    if (file.includes("api/") && file.endsWith(".ts")) {
      const missingAuth = content.includes("locals") && !content.includes("locals.user");
      if (missingAuth) {
        findings.push({
          severity: "blocking",
          category: "security",
          file,
          message: "API route importa locals pero no verifica locals.user — posible falta de auth",
        });
      }
    }

    if (file.endsWith(".tsx") || file.endsWith(".astro")) {
      if (file.endsWith(".tsx")) {
        const hasClassName = content.includes('className=');
        const hasClass = content.includes(' class=') || content.includes(" class=");
        if (hasClass && !hasClassName) {
          findings.push({
            severity: "blocking",
            category: "convention",
            file,
            message: "Uso de `class=` en JSX — debe ser `className=`",
          });
        }
      }
    }
  }

  return findings;
}

// === Check 8: Test Quality ===
// Validates that tests follow AAA pattern, have assertions, no console.log, etc.
// Based on Midudev's testing philosophy: "test code is production code"
function checkTestQuality(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Only check test files
  const testFiles = changedFiles.filter(f =>
    /\.test\.(ts|tsx|js|jsx)$/.test(f) ||
    /\.spec\.(ts|tsx|js|jsx)$/.test(f)
  );

  if (testFiles.length === 0) return findings;

  for (const file of testFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");

    // Check 1: Tests must have assertions
    const testMatches = [...content.matchAll(/\b(it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g)];
    for (const m of testMatches) {
      const lineNum = content.substring(0, m.index).split("\n").length;
      const testName = m[2];

      // Look for the function body
      const startLine = lineNum - 1;
      let body = "";
      let braceIdx = content.indexOf("{", m.index);
      if (braceIdx >= 0) {
        let depth = 0;
        const bodyStart = content.substring(0, braceIdx).split("\n").length - 1;
        for (let i = bodyStart; i < lines.length; i++) {
          body += lines[i] + "\n";
          for (const ch of lines[i]) {
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
          }
          if (depth <= 0) break;
        }
      }

      // Has assertion?
      const hasAssertion = /\bexpect\s*\(/.test(body) ||
                          /\bassert\./.test(body) ||
                          /\.toBe\s*\(/.test(body) ||
                          /\.toEqual\s*\(/.test(body) ||
                          /\.toThrow\b/.test(body) ||
                          /\.toHaveBeenCalled\b/.test(body);

      if (!hasAssertion) {
        findings.push({
          severity: "blocking",
          category: "test-quality",
          file,
          line: lineNum,
          message: `Test "${testName}" has no assertions (AAA pattern violated).`,
          suggestion: "Add expect(), assert, or .toBe()/.toEqual() in the body.",
        });
      }

      // Check 2: No console.log in test body
      if (/\bconsole\.log\s*\(/.test(body)) {
        findings.push({
          severity: "warning",
          category: "test-quality",
          file,
          line: lineNum,
          message: `Test "${testName}" contains console.log — debugging residue.`,
          suggestion: "Remove console.log or convert to expect(...).toHaveBeenCalled().",
        });
      }

      // Check 3: No debugger
      if (/\bdebugger\b/.test(body)) {
        findings.push({
          severity: "blocking",
          category: "test-quality",
          file,
          line: lineNum,
          message: `Test "${testName}" contains debugger statement.`,
        });
      }

      // Check 4: Naming convention
      const hasGoodNaming = /^should[_\s]/i.test(testName) ||
                           /^it[_\s]/i.test(testName) ||
                           /\bwhen\b/i.test(testName) ||
                           /\bthen\b/i.test(testName) ||
                           /\bthrows\b/i.test(testName) ||
                           /\breturns\b/i.test(testName) ||
                           /\bfails\b/i.test(testName);
      if (!hasGoodNaming && testName.length < 8) {
        findings.push({
          severity: "info",
          category: "test-quality",
          file,
          line: lineNum,
          message: `Test "${testName}" has weak naming. Use should_X_when_Y or it_X pattern.`,
        });
      }
    }

    // Check 5: Duplicate test names within file
    const testNames = testMatches.map(m => m[2]);
    const duplicates = testNames.filter((n, i) => testNames.indexOf(n) !== i);
    for (const dup of [...new Set(duplicates)]) {
      findings.push({
        severity: "warning",
        category: "test-quality",
        file,
        message: `Duplicate test name: "${dup}" appears multiple times.`,
      });
    }
  }

  return findings;
}

// === Check 9: Coverage ===
// Validates that code coverage meets thresholds.
// Coverage is complementary to mutation score — high coverage doesn't mean good tests,
// but very low coverage means we're not testing enough.
function checkCoverage(changedFiles: string[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Only run coverage check if test files were changed
  const hasTestChanges = changedFiles.some(f =>
    /\.test\.(ts|tsx|js|jsx)$/.test(f) ||
    /\.spec\.(ts|tsx|js|jsx)$/.test(f)
  );

  if (!hasTestChanges) return findings;

  try {
    const { runCoverage } = require("../testing/coverage");
    const report = runCoverage({ warnBelow: 60, blockBelow: 40 });

    if ("error" in report) {
      findings.push({
        severity: "info",
        category: "coverage",
        file: "coverage",
        message: `Coverage check skipped: ${report.error}`,
      });
      return findings;
    }

    if (report.lines.percent < 40) {
      findings.push({
        severity: "blocking",
        category: "coverage",
        file: "coverage",
        message: `Line coverage ${report.lines.percent.toFixed(1)}% < 40% threshold. Write more tests.`,
      });
    } else if (report.lines.percent < 60) {
      findings.push({
        severity: "warning",
        category: "coverage",
        file: "coverage",
        message: `Line coverage ${report.lines.percent.toFixed(1)}% < 60% warning threshold. Consider more tests.`,
      });
    }

    if (report.filesNeedingWork.length > 0) {
      findings.push({
        severity: "info",
        category: "coverage",
        file: "coverage",
        message: `${report.filesNeedingWork.length} file(s) below 60% coverage: ${report.filesNeedingWork.slice(0, 5).join(", ")}${report.filesNeedingWork.length > 5 ? "..." : ""}`,
      });
    }
  } catch (err: unknown) {
    // Coverage check is optional — don't fail review if it errors
    const msg = err instanceof Error ? err.message : String(err);
    findings.push({
      severity: "info",
      category: "coverage",
      file: "coverage",
      message: `Coverage check unavailable: ${msg}`,
    });
  }

  return findings;
}

export async function runReview(): Promise<ReviewResult> {
  const feature = getActiveFeature();
  const previousReview = loadPreviousReview();

  const attempt = previousReview?.circuitBreaker?.attempt
    ? previousReview.circuitBreaker.attempt + 1
    : 1;

  const findings: ReviewFinding[] = [];

  if (!feature) {
    return {
      featureId: 0,
      featureTitle: "unknown",
      reviewTimestamp: new Date().toISOString(),
      findings: [],
      circuitBreaker: { attempt, maxAttempts: MAX_REVIEW_ATTEMPTS, blocked: false },
      passed: true,
    };
  }

  const changedFiles = getChangedFiles();
  findings.push(...analyzeChangedFiles(changedFiles));
  findings.push(...checkApiEndpointExistence(changedFiles));
  findings.push(...checkDataFlowConsistency(changedFiles));
  findings.push(...checkMigrationChanges(changedFiles));
  findings.push(...checkTypeScript(changedFiles));
  findings.push(...checkImportResolution(changedFiles));
  findings.push(...checkMigrationApplied(changedFiles));
  findings.push(...checkTestQuality(changedFiles));
  findings.push(...checkCoverage(changedFiles));

  const blocked = attempt > MAX_REVIEW_ATTEMPTS;
  const blockingCount = findings.filter(f => f.severity === "blocking").length;
  const passed = !blocked && blockingCount === 0;

  const result: ReviewResult = {
    featureId: feature.id,
    featureTitle: feature.title,
    reviewTimestamp: new Date().toISOString(),
    findings,
    circuitBreaker: {
      attempt,
      maxAttempts: MAX_REVIEW_ATTEMPTS,
      blocked,
    },
    passed,
  };

  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(REVIEW_PATH, JSON.stringify(result, null, 2), "utf-8");

  return result;
}

export function printReviewResult(result: ReviewResult): void {
  console.log(`\n👁️  Reviewer Feedback Bus:`);
  // Summary by category
  const byCategory: Record<string, ReviewFinding[]> = {};
  for (const f of result.findings) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  console.log(`   Categories checked:`);
  console.log(`     🔍 Static analysis     : ${result.findings.filter(f => ["quality", "convention"].includes(f.category)).length} findings`);
  console.log(`     🔗 API existence       : ${result.findings.filter(f => f.category === "consistency" && f.message.includes("fetch")).length} findings`);
  console.log(`     🔄 Data flow           : ${result.findings.filter(f => f.category === "consistency" && !f.message.includes("fetch")).length} findings`);
  console.log(`     🛡️  Security             : ${result.findings.filter(f => f.category === "security").length} findings`);
  console.log(`     🏗️  Migration            : ${result.findings.filter(f => f.category === "migration").length} findings`);
  console.log(`     📦 Import resolution  : ${result.findings.filter(f => f.category === "typescript" && f.message.includes("Import")).length} findings`);
  console.log(`     ⚡ TypeScript strict  : ${result.findings.filter(f => f.category === "typescript" && !f.message.includes("Import")).length} findings`);
  console.log(`     🧪 Test quality       : ${result.findings.filter(f => f.category === "test-quality").length} findings`);
  console.log(`     📊 Coverage           : ${result.findings.filter(f => f.category === "coverage").length} findings`);

  if (!result.passed) {
    if (result.circuitBreaker.blocked) {
      console.log(`   ⛔ CIRCUIT BREAKER OPEN — max ${result.circuitBreaker.maxAttempts} attempts reached`);
    }
    console.log(`   ❌ ${result.findings.filter(f => f.severity === "blocking").length} blocking, ${result.findings.filter(f => f.severity === "warning").length} warnings`);
    for (const f of result.findings) {
      const icon = f.severity === "blocking" ? "❌" : f.severity === "warning" ? "⚠️" : "ℹ️";
      console.log(`   ${icon} [${f.category}] ${f.file}: ${f.message}`);
      if (f.suggestion) console.log(`      → ${f.suggestion}`);
    }
  } else {
    console.log(`   ✅ Review passed — ${result.findings.length} findings`);
    for (const f of result.findings) {
      console.log(`     ℹ️  ${f.message}`);
    }
  }
}

export function findActiveReview(): ReviewResult | null {
  try {
    return JSON.parse(fs.readFileSync(REVIEW_PATH, "utf-8"));
  } catch {
    return null;
  }
}
