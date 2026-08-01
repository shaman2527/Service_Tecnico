import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { TruthState, EndpointResult, TruthReport, SmokeTestOptions } from "./types";
import type { PageConfig } from "../code-generator/types";
import { runWithServer, runUnitTests } from "./runtime-smoke";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROGRESS_DIR = path.resolve(__dirname, "../progress");
const ARTIFACTS_DIR = path.join(PROGRESS_DIR, "artifacts");
const AGENT_MD_PATH = path.join(PROGRESS_DIR, "agent.md");

function loadAgentMd(): string {
  try {
    return fs.readFileSync(AGENT_MD_PATH, "utf-8");
  } catch {
    return "";
  }
}

function generateMarkdown(state: TruthState): string {
  const buildIcon = state.buildStatus === "pass" ? "✅" : state.buildStatus === "fail" ? "❌" : "⬜";

  let endpointRows = "";
  if (state.endpointResults.length === 0) {
    endpointRows = "| *(pendiente)* | | | | |\n";
  } else {
    for (const ep of state.endpointResults) {
      const icon = ep.status === "pass" ? "✅" : ep.status === "fail" ? "❌" : "⏭️";
      endpointRows += `| \`${ep.endpoint}\` | ${ep.method} | ${ep.expectedStatus} | ${ep.actualStatus} | ${icon} |\n`;
    }
  }

  const passCount = state.endpointResults.filter(e => e.status === "pass").length;
  const failCount = state.endpointResults.filter(e => e.status === "fail").length;

  let unitTestsSection = "";
  if (state.unitTests) {
    const uIcon = state.unitTests.passed ? "✅" : "❌";
    unitTestsSection = `
## Tests Unitarios

| Métrica | Valor |
|---|---|
| Estado | ${uIcon} |
| Total | ${state.unitTests.totalTests} |
| Pasados | ${state.unitTests.passedTests} |
| Fallidos | ${state.unitTests.failedTests} |
| Duración | ${(state.unitTests.durationMs / 1000).toFixed(1)}s |
${state.unitTests.errors.length > 0 ? `\n### Errores\n${state.unitTests.errors.map(e => `- ❌ ${e}`).join("\n")}\n` : ""}
`;
  }

  return `# agent.md — Sistema de la Verdad

> Fuente de verdad viva del proyecto. Se actualiza automáticamente
> después de cada ciclo de gobernanza o sesión del agente.
> **Última actualización:** ${state.lastUpdated}

## Estado del Proyecto

| Métrica | Valor |
|---|---|
| Build | ${buildIcon} ${state.buildStatus.toUpperCase()} |
| Duración build | ${(state.buildDurationMs / 1000).toFixed(1)}s |
| Endpoints totales | ${state.totalEndpoints} |
| Endpoints OK | ${passCount} |
| Endpoints fallidos | ${failCount} |
| Endpoints saltados | ${state.skippedEndpoints} |
| Alineación MVP | ${(state.alignmentScore * 100).toFixed(0)}% |
${state.unitTests ? `| Tests unitarios | ${state.unitTests.passedTests}/${state.unitTests.totalTests} ✅ |` : ""}

${state.errors.length > 0 ? `### Errores Detectados\n${state.errors.map(e => `- ❌ ${e}`).join("\n")}\n` : ""}
${state.warnings.length > 0 ? `### Advertencias\n${state.warnings.map(w => `- ⚠️ ${w}`).join("\n")}\n` : ""}

## Endpoints Verificados

| Endpoint | Método | Esperado | Real | Estado |
|---|---|---|---|---|
${endpointRows}
## Contratos Verificados

*(pendiente — se agregarán validaciones de schema entre API y componente)*
${unitTestsSection}
## Métricas de Alineación

| Métrica | Valor | Límite | Estado |
|---|---|---|---|
| Líneas MVP / Líneas totales | ${(state.mvpLinesRatio * 100).toFixed(0)}% | ≥ 50% | ${state.mvpLinesRatio >= 0.5 ? "✅" : "❌"} |
| Feature creep detectado | ${state.warnings.filter(w => w.includes("feature creep")).length} | 0 | ${state.warnings.filter(w => w.includes("feature creep")).length === 0 ? "✅" : "❌"} |
| Endpoints caídos | ${failCount} | 0 | ${failCount === 0 ? "✅" : "❌"} |

## Historial de Cambios

| Fecha | Evento | Resultado |
|---|---|---|
| ${state.lastUpdated} | Truth cycle | ${state.buildStatus === "pass" ? "✅ PASS" : "❌ FAIL"} |
`;
}

function updateAgentMd(state: TruthState): void {
  const markdown = generateMarkdown(state);
  fs.writeFileSync(AGENT_MD_PATH, markdown, "utf-8");
}

export function calculateAlignmentScore(totalLines: number, mvpLines: number): number {
  if (totalLines === 0) return 1;
  return mvpLines / totalLines;
}

/**
 * Count actual lines in src/ to compute real alignment score
 */
function countSourceLines(): { totalLines: number; mvpLines: number } {
  const srcDir = path.resolve(__dirname, "../../src");
  let totalLines = 0;
  let mvpLines = 0;

  function countInDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "node_modules") {
        countInDir(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".astro")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n").length;
          totalLines += lines;

          const relativePath = path.relative(srcDir, fullPath).replace(/\\/g, "/");
          const isMvpPage = /^pages\/(admin|panel)\//.test(relativePath);
          if (isMvpPage) mvpLines += lines;
        } catch {}
      }
    }
  }

  countInDir(srcDir);
  return { totalLines, mvpLines };
}

export interface OrchestratorOptions {
  skipServer?: boolean;
  verbose?: boolean;
  authCookie?: string;
  runTests?: boolean;
}

export interface OrchestratorResult {
  state: TruthState;
  summary: string;
  passed: boolean;
  agentMdUpdated: boolean;
}

export async function runTruthCycle(
  pages: PageConfig[],
  buildResult: { success: boolean; durationMs: number; errors: { file: string; message: string }[] },
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  const { skipServer = false, verbose = false, authCookie, runTests = false } = options;

  if (verbose) console.log(`\n🧪 Truth System — Verifying ${pages.length} pages...`);

  let endpointResults: EndpointResult[] = [];

  if (!skipServer) {
    try {
      const smokeOptions: SmokeTestOptions = {};
      if (authCookie) smokeOptions.authCookie = authCookie;
      if (verbose) smokeOptions.strict = true;

      const smoke = await runWithServer(pages, smokeOptions);
      endpointResults = smoke.results;

      if (verbose) {
        const pass = smoke.results.filter(r => r.status === "pass").length;
        const fail = smoke.results.filter(r => r.status === "fail").length;
        console.log(`   Smoke: ${pass} pass, ${fail} fail`);
        for (const r of smoke.results) {
          if (r.status === "fail") {
            console.log(`     ❌ ${r.endpoint} (${r.method}): ${r.actualStatus} — ${r.error || "unexpected status"}`);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ Smoke test error: ${msg}`);
    }
  } else {
    if (verbose) console.log(`   ⏭️  Server smoke tests skipped`);
  }

  // Run unit tests if requested
  let unitTestsResult = undefined;
  if (runTests) {
    console.log(`\n🧪 Running unit tests...`);
    unitTestsResult = await runUnitTests();
    if (verbose) {
      console.log(`   ${unitTestsResult.passed ? "✅" : "❌"} ${unitTestsResult.passedTests}/${unitTestsResult.totalTests} passed (${(unitTestsResult.durationMs / 1000).toFixed(1)}s)`);
    }

    // Run integration tests if DB available
    try {
      const { runIntegrationTests } = await import("../testing/integration-runner");
      const intResult = await runIntegrationTests({ dryRun: false });
      if (verbose) {
        console.log(`   🧪 Integration: ${intResult.passed}/${intResult.totalTests} passed (${(intResult.durationMs / 1000).toFixed(1)}s)`);
      }
      (unitTestsResult as any).integrationTests = intResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (verbose) console.log(`   ⚠️  Integration tests skipped: ${msg.slice(0, 80)}`);
    }
  }

  const passCount = endpointResults.filter(r => r.status === "pass").length;
  const failCount = endpointResults.filter(r => r.status === "fail").length;
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check for failed endpoints
  const failedEndpoints = endpointResults.filter(r => r.status === "fail");
  for (const fe of failedEndpoints) {
    if (fe.error === "timeout") {
      warnings.push(`Endpoint ${fe.endpoint} timed out (slow) — consider optimizing`);
    } else if (fe.actualStatus === 404) {
      errors.push(`Endpoint ${fe.endpoint} returned 404 — file may be missing`);
    } else {
      errors.push(`Endpoint ${fe.endpoint} returned ${fe.actualStatus} (expected ${fe.expectedStatus}) — ${fe.error || "unknown"}`);
    }
  }

  // Check build errors
  for (const be of buildResult.errors) {
    errors.push(`Build error: ${be.file}: ${be.message}`);
  }

  // Check unit test errors
  if (unitTestsResult && !unitTestsResult.passed) {
    for (const te of unitTestsResult.errors) {
      errors.push(`Test error: ${te}`);
    }
  }

  // Calculate real alignment score
  const { totalLines, mvpLines } = countSourceLines();
  const alignmentScore = calculateAlignmentScore(totalLines, mvpLines);
  const mvpLinesRatio = totalLines > 0 ? mvpLines / totalLines : 1.0;

  const state: TruthState = {
    lastUpdated: new Date().toISOString(),
    buildStatus: buildResult.success && failCount === 0 && (!unitTestsResult || unitTestsResult.passed) ? "pass" : "fail",
    buildDurationMs: buildResult.durationMs,
    totalEndpoints: pages.filter(p => p.apiEndpoint).length,
    testedEndpoints: endpointResults.length,
    passedEndpoints: passCount,
    failedEndpoints: failCount,
    skippedEndpoints: endpointResults.filter(r => r.status === "skip").length,
    endpointResults,
    alignmentScore,
    mvpLinesRatio,
    warnings,
    errors,
    unitTests: unitTestsResult,
  };

  // Update agent.md
  updateAgentMd(state);

  const hasErrors = errors.length > 0;
  const passed = state.buildStatus === "pass" && !hasErrors;
  const summary = passed
    ? `✅ Truth: ${passCount}/${endpointResults.length} endpoints OK, build PASS${unitTestsResult ? `, tests ${unitTestsResult.passedTests}/${unitTestsResult.totalTests}` : ""}`
    : `❌ Truth: ${failCount} failed (${errors.length} errors, ${warnings.length} warnings)`;

  return { state, summary, passed, agentMdUpdated: true };
}

export function readCurrentStateFromMd(): Partial<TruthState> {
  const content = loadAgentMd();
  if (!content) return {};

  const buildMatch = content.match(/Build.*?([✅❌⬜])\s+(\w+)/);
  const endpointsMatch = content.match(/Endpoints OK\s*\|?\s*(\d+)/);

  return {
    buildStatus: buildMatch?.[2]?.toLowerCase() as TruthState["buildStatus"] || "unknown",
    passedEndpoints: endpointsMatch ? parseInt(endpointsMatch[1], 10) : 0,
  };
}
