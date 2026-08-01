import { executeLoop, printLoopSummary } from "./loop-engine";
import { getGoal, listGoals, GOALS } from "./goal-definitions";
import { config } from "../config";

const args = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
let goalId = "mvp-complete";

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--goal": case "-g": goalId = args[++i] || goalId; break;
    case "--resume": case "-r": flags.resume = true; break;
    case "--verbose": case "-v": flags.verbose = true; break;
    case "--tests": case "-u": flags.runTests = true; break;
    case "--list": case "-l": flags.list = true; break;
    case "--help": case "-h": flags.help = true; break;
    case "--branch": flags.branch = args[++i] || ""; break;
    case "--archive": flags.archive = true; break;
  }
}

if (flags.help) {
  console.log(`
Usage: npx tsx tools/loop/run.ts [options]

Loop Engineering v3 — persistent goal-driven 9-phase agent loop.

Runs: LearningInjector → ContextGuard → Governance → SecurityGate → Build → Reviewer → Truth → DeployReadiness → CloseFeature

Options:
  --goal, -g <id>     Goal definition to run (default: mvp-complete)
  --resume, -r        Resume from last saved state
  --verbose, -v       Detailed output per iteration
  --tests, -u         Run unit tests as part of truth phase
  --list, -l          List available goal definitions
  --branch <name>     Branch isolation for this run
  --archive           Archive completed branch changes
  --help, -h          Show this help

Examples:
  npx tsx tools/loop/run.ts --goal mvp-complete
  npx tsx tools/loop/run.ts --goal build-pass --resume
  npx tsx tools/loop/run.ts --goal full-cycle --tests
  npx tsx tools/loop/run.ts --list
`);
  process.exit(0);
}

if (flags.list) {
  console.log("\nAvailable goals:\n");
  for (const goal of GOALS) {
    console.log(`  ${goal.id}:`);
    console.log(`    ${goal.description}`);
    console.log(`    Max iterations: ${goal.maxIterations}, Interval: ${(goal.intervalMs / 1000).toFixed(0)}s`);
    for (const c of goal.conditions) {
      console.log(`    - [${c.type}] ${c.description}`);
    }
    console.log();
  }
  process.exit(0);
}

async function main() {
  const loopTitle = `${config.projectName} — Loop Engineering v3`;
  const pad = "═".repeat(Math.max(46, loopTitle.length + 4));
  console.log(`╔${pad}╗`);
  console.log(`║  ${loopTitle}  ║`);
  console.log(`║   9 phases: Learn → Guard → Gen → Secure →   ║`);
  console.log(`║            Build → Review → Truth → Deploy →  ║`);
  console.log(`║            Close                              ║`);
  console.log(`╚${pad}╝`);

  const goal = getGoal(goalId);
  if (!goal) {
    console.error(`❌ Goal "${goalId}" not found. Use --list to see available goals.`);
    process.exit(1);
  }

  const result = await executeLoop(goal, {
    verbose: !!flags.verbose,
    resume: !!flags.resume,
    runTests: !!flags.runTests,
  });

  printLoopSummary(result);
  process.exit(result.goalMet ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
