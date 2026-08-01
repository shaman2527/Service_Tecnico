import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { runTruthCycle, readCurrentStateFromMd } from "./truth-orchestrator";
import { config } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROGRESS_DIR = path.resolve(__dirname, "..", config.paths.artifactsDir.replace(/^tools\//, ""));
const TRUTH_RESULT_PATH = path.join(PROGRESS_DIR, "truth-result.json");

let allPages: any[];
try {
  allPages = (await import("../code-generator/plans/mvp-pages")).allPages;
} catch {
  allPages = [];
}

const args = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--skip-server": case "-s": flags.skipServer = true; break;
    case "--verbose": case "-v": flags.verbose = true; break;
    case "--status": case "-t": flags.statusOnly = true; break;
    case "--cookie": case "-c": flags.authCookie = args[++i] || ""; break;
    case "--tests": case "-u": flags.runTests = true; break;
    case "--strict": flags.strict = true; break;
    case "--help": case "-h": flags.help = true; break;
  }
}

if (flags.help) {
  console.log(`
Usage: npx tsx tools/truth/run.ts [options]

Truth System — verifies endpoints, runs unit tests, updates agent.md.

Options:
  --skip-server, -s   Skip server smoke tests (just update agent.md)
  --verbose, -v       Detailed output per endpoint
  --status, -t        Show current truth status without running tests
  --cookie, -c <val>  Auth cookie for authenticated endpoint tests
  --tests, -u         Run unit tests (vitest) as part of truth cycle
  --strict            Strict status code matching (fail on unexpected codes)
  --help, -h          Show this help
`);
  process.exit(0);
}

async function main() {
  const title = `${config.projectName} — Truth System`;
  const pad = "═".repeat(Math.max(40, title.length + 4));
  console.log(`╔${pad}╗`);
  console.log(`║  ${title}  ║`);
  console.log(`╚${pad}╝`);

  if (flags.statusOnly) {
    const state = readCurrentStateFromMd();
    console.log(`\n📊 Current Truth State:`);
    console.log(`   Build: ${state.buildStatus || "unknown"}`);
    console.log(`   Endpoints OK: ${state.passedEndpoints ?? "?"}`);
    process.exit(0);
  }

  const mockBuild = { success: true, durationMs: 0, errors: [] as { file: string; message: string }[] };
  const result = await runTruthCycle(allPages, mockBuild, {
    skipServer: !!flags.skipServer,
    verbose: !!flags.verbose,
    authCookie: flags.authCookie as string | undefined,
    runTests: !!flags.runTests,
  });

  console.log(`\n📝 ${result.summary}`);
  console.log(`   agent.md: ${result.agentMdUpdated ? "✅ updated" : "❌ not updated"}`);

  // Write structured JSON result for loop-engine
  if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  fs.writeFileSync(TRUTH_RESULT_PATH, JSON.stringify({
    truthPassed: result.passed,
    endpointFailCount: result.state.failedEndpoints,
    unitTests: result.state.unitTests ? {
      passed: result.state.unitTests.passed,
      totalTests: result.state.unitTests.totalTests,
      passedTests: result.state.unitTests.passedTests,
      failedTests: result.state.unitTests.failedTests,
    } : undefined,
    errors: result.state.errors,
    timestamp: new Date().toISOString(),
  }, null, 2), "utf-8");

  process.exit(result.passed ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
