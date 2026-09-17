import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

let CONFIG: any = { paths: {}, security: { enabled: true, checks: [] } };
try {
  CONFIG = (await import("../config")).CONFIG;
} catch {}

const S = CONFIG.paths || { sourceDir: "src", apiDir: "src" };
const SEC = CONFIG.security || { enabled: true, checks: ["secrets", "debug-mode", "sql-injection", "auth"] };
const activeChecks = new Set(SEC.checks || []);

const SECRET_PATTERNS = [
  /(api[_-]?key|secret|token|password|private[_-]?key)/i,
];

const DEBUG_PATTERNS = [
  /\bconsole\.log\s*\(\s*[^)]*(key|secret|token|password)/i,
  /\bdebug\s*:\s*true\b/i,
];

const SQL_INJECTION_PATTERNS = [
  /\bfrom\s*\([\s'"]*[a-z_]+\s*\)\s*\.\s*select\b/i,
];

export interface ValidationIssue {
  file: string;
  line?: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface SecurityReport {
  passed: boolean;
  issues: ValidationIssue[];
  checks: Record<string, boolean>;
  /** Cuántos archivos se escanearon de verdad (0 = el scan no miró nada: NO es un PASS válido). */
  scanned?: number;
}

function scanFile(filePath: string): string {
  try {
    return fs.readFileSync(path.join(projectRoot, filePath), "utf-8");
  } catch {
    return "";
  }
}

/**
 * Chequeos que aplican a CUALQUIER archivo (frontend, backend Rust, SQL): secretos y modo debug.
 * Antes vivían solo en `validateApiEndpoint`, así que en un proyecto sin rutas `api/`/`routes/`
 * (un Tauri, por ejemplo) NINGÚN archivo pasaba por ellos y el gate daba un falso verde.
 */
function validateUniversal(content: string, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Regla simple y predecible: una clave/token/contraseña ASIGNADA a un literal largo.
  // (La regla vieja marcaba cualquier mención de la palabra «password», así que se ignoraba
  //  sola con la lista de excepciones y no encontraba nada real.)
  const SOSPECHOSA = /(api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'`][^"'`]{8,}["'`]/i;
  if (activeChecks.has("secrets") && SOSPECHOSA.test(content)) {
    issues.push({
      file: filePath, severity: "error", code: "SECRET-LEAK",
      message: "Posible secreto expuesto en el código (clave/token con valor literal)",
    });
  }

  if (activeChecks.has("debug-mode") && DEBUG_PATTERNS.some(p => p.test(content))) {
    issues.push({
      file: filePath, severity: "warning", code: "DEBUG-MODE",
      message: "Modo debug activo o log de datos sensibles",
    });
  }

  return issues;
}

function validateApiEndpoint(content: string, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = validateUniversal(content, filePath);

  if (activeChecks.has("sql-injection") && SQL_INJECTION_PATTERNS.some(p => p.test(content))) {
    issues.push({
      file: filePath, severity: "warning", code: "SQL-INJECTION",
      message: "Query sin validación de entrada visible",
    });
  }

  if (activeChecks.has("auth") && (content.includes("export const POST") || content.includes("export const PUT") || content.includes("export const DELETE"))) {
    const hasAuthCheck = content.includes("locals.user") || content.includes("getUser") || content.includes("auth.");
    if (!hasAuthCheck) {
      issues.push({
        file: filePath, severity: "error", code: "NO-AUTH",
        message: "Endpoint sin verificación de autenticación",
      });
    }
  }

  return issues;
}

function validateComponent(content: string, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (activeChecks.has("hardcoded-ids") && /\b(id|uuid|guid)\s*[=:]\s*["'][a-f0-9-]{36}["']/i.test(content)) {
    issues.push({
      file: filePath, severity: "warning", code: "HARDCODED-ID",
      message: "UUID hardcodeado en el componente",
    });
  }

  if (activeChecks.has("error-handling") && content.includes("fetch(") && !content.includes(".catch(") && !content.includes("try")) {
    issues.push({
      file: filePath, severity: "warning", code: "NO-ERROR-HANDLING",
      message: "fetch() sin try/catch ni .catch()",
    });
  }

  return issues;
}

export function validateFile(content: string, filePath: string, isApi: boolean): ValidationIssue[] {
  // Los chequeos universales (secretos / debug) corren SIEMPRE, sea API o componente.
  const universales = validateUniversal(content, filePath);
  return universales.concat(isApi ? validateApiEndpoint(content, filePath) : validateComponent(content, filePath));
}

export async function runFullSecurityScan(changedFiles?: string[]): Promise<SecurityReport> {
  const allIssues: ValidationIssue[] = [];
  /** Archivos realmente auditados (si queda en 0, el PASS no vale nada). */
  let scanned = 0;

  // Se auditan TANTO el frontend como el backend: la config del proyecto pone `apiDir` en
  // `src-tauri/src`, así que usar solo `apiDir || sourceDir` dejaba el frontend afuera (y
  // escaneaba el backend DOS veces).
  // Extensiones que se escanean. OJO: antes solo entraban `.ts/.tsx`, así que en un proyecto
  // Tauri (backend en Rust) el scan juntaba CERO archivos bajo `src-tauri/src` y devolvía un
  // PASS trivial ("falso verde"). Ahora entran también `.rs`, `.js/.jsx/.mjs` y `.sql`, y se
  // escanean TANTO el frontend (`src/`) como el backend (`src-tauri/src/`).
  const SCANNED_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".rs", ".sql"];
  const roots = [...new Set([S.sourceDir, S.apiDir].filter(Boolean).map((d: string) => path.join(projectRoot, d)))]
    .filter(d => fs.existsSync(d));
  for (const root of roots) {
    const files: string[] = [];
    function collect(dir: string) {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          // `target/` y `node_modules/` son artefactos de build: no se auditan
          if (e.name === "target" || e.name === "node_modules" || e.name === "dist") continue;
          collect(full);
        } else if (SCANNED_EXT.some(ext => e.name.endsWith(ext))) files.push(full);
      }
    }
    collect(root);
    for (const file of files) {
      const relative = path.relative(projectRoot, file).replace(/\\/g, "/");
      if (changedFiles && !new Set(changedFiles.map(f => f.replace(/\\/g, "/"))).has(relative)) continue;
      const content = fs.readFileSync(file, "utf-8");
      scanned++;
      allIssues.push(...validateFile(content, relative, relative.includes("api/") || relative.includes("routes/")));
    }
  }

  // Optional Supabase checks (only if enabled and project uses Supabase)
  if (activeChecks.has("rls-policies") && fs.existsSync(path.join(projectRoot, "supabase"))) {
    try {
      const { checkRlsPolicies } = await import("./security-plugins/rls");
      allIssues.push(...checkRlsPolicies(projectRoot, S));
    } catch {}
  }

  if (activeChecks.has("service-key-leak") && fs.existsSync(path.join(projectRoot, "supabase"))) {
    try {
      const { checkServiceKeyLeak } = await import("./security-plugins/service-key");
      allIssues.push(...checkServiceKeyLeak(projectRoot, S));
    } catch {}
  }

  // Un scan que no miró NINGÚN archivo NO puede pasar: antes eso era un PASS trivial.
  if (scanned === 0) {
    allIssues.push({
      file: "-", severity: "error", code: "NO-FILES-SCANNED",
      message: "El scan de seguridad no encontró archivos para auditar (revisar rutas/extensiones)",
    });
  }

  const errors = allIssues.filter(i => i.severity === "error");
  const checksRecord: Record<string, boolean> = {};
  for (const check of SEC.checks || ["secrets", "debug-mode", "sql-injection", "auth"]) {
    checksRecord[check] = !allIssues.some(i => i.code.toLowerCase().startsWith(check));
  }

  return { passed: errors.length === 0, issues: allIssues, checks: checksRecord, scanned };
}

export function printSecurityReport(report: SecurityReport): void {
  console.log(`\n  🛡️  Security Gate:`);
  const allPassed = Object.values(report.checks).every(Boolean);
  console.log(`     ${allPassed ? "✅ ALL CHECKS PASSED" : "❌ Some checks failed"}`);
  for (const [check, passed] of Object.entries(report.checks)) {
    const name = check.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
    console.log(`     ${passed ? "✅" : "❌"} ${name}`);
  }
  for (const issue of report.issues) {
    const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
    console.log(`     ${icon} [${issue.code}] ${issue.file}: ${issue.message}`);
  }
}
