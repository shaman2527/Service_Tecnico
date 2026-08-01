#!/usr/bin/env node
/**
 * Harness ENGINEERING CLI
 *
 * Usage:
 *   tsx cli/index.ts init          — detect project, create config
 *   tsx cli/index.ts detect        — print project detection
 *   tsx cli/index.ts loop [goal]   — run the engineering loop
 *   tsx cli/index.ts self-improve  — run self-improve analysis
 *   tsx cli/index.ts generate      — run code generator
 *   tsx cli/index.ts governance    — run governance cycle
 *   tsx cli/index.ts truth         — run truth verification
 */

import * as fs from "fs";
import * as path from "path";
import { detectProject, printDetectedProject } from "../detector";
import { config } from "../config";

const args = process.argv.slice(2);
const command = args[0] || "help";

async function main() {
  switch (command) {
    case "init": {
      console.log("\n🔧 Harness ENGINEERING — Init\n");
      const project = detectProject();
      printDetectedProject(project);

      const configPath = path.resolve(process.cwd(), "tools", "config.ts");
      if (fs.existsSync(configPath)) {
        console.log("\n  config.ts already exists. Edit it manually to match your project.");
      } else {
        console.log("\n  No config.ts found. Copy config.example.ts to config.ts and customize.");
      }
      break;
    }

    case "detect": {
      printDetectedProject(detectProject());
      break;
    }

    case "loop": {
      const { executeLoop, printLoopSummary } = await import("../loop/loop-engine");
      const { GOALS } = await import("../loop/goal-definitions");
      const goalId = args[1] || "build-pass";
      const goal = GOALS.find(g => g.id === goalId);
      if (!goal) {
        console.error(`Unknown goal: ${goalId}. Available: ${GOALS.map(g => g.id).join(", ")}`);
        process.exit(1);
      }
      const verbose = args.includes("--verbose") || args.includes("-v");
      const resume = args.includes("--resume") || args.includes("-r");
      const runTests = args.includes("--tests") || args.includes("-t");
      console.log(`\n▶ Goal: ${goal.id} (${goal.description})`);
      const result = await executeLoop(goal, { verbose, resume, runTests });
      printLoopSummary(result);
      break;
    }

    case "self-improve": {
      const { runSelfImprove } = await import("../loop/self-improve");
      const report = runSelfImprove({ verbose: args.includes("--verbose") });
      console.log(`\n${report.gapsFound} gaps found (${report.scanned.length} modules scanned)`);
      break;
    }

    case "generate": {
      const { generateAll } = await import("../code-generator/engine");
      const plansPath = path.resolve(process.cwd(), "tools", "code-generator", "plans", "mvp-pages.ts");
      let plans: any[] = [];
      try {
        const mod = await import(plansPath);
        plans = mod.plans || [];
      } catch {
        console.warn("  No mvp-pages.ts found. Using example-plans.");
        const example = await import("../code-generator/plans/example-plans");
        plans = example.plans || [];
      }
      const dryRun = args.includes("--dry-run");
      const result = generateAll(plans, { dryRun });
      console.log(`\n  Generated: ${result.generated.length} files`);
      for (const f of result.generated) console.log(`    ${f.path}`);
      for (const e of result.errors) console.log(`    ✖ ${e.page}: ${e.error}`);
      break;
    }

    case "governance": {
      const { execSync } = await import("child_process");
      const runner = path.resolve(process.cwd(), "tools", "governance", "run.ts");
      execSync(`npx tsx "${runner}" ${args.slice(1).join(" ")}`, { stdio: "inherit", cwd: process.cwd() });
      break;
    }

    case "truth": {
      const { execSync } = await import("child_process");
      const runner = path.resolve(process.cwd(), "tools", "truth", "run.ts");
      execSync(`npx tsx "${runner}" ${args.slice(1).join(" ")}`, { stdio: "inherit", cwd: process.cwd() });
      break;
    }

    case "help":
    default: {
      console.log(`
Harness ENGINEERING CLI
=======================
  init                 Detect project & show init guide
  detect               Print project detection info
  loop <goal>          Run engineering loop (default: build-pass)
  self-improve         Scan tools/ for gaps
  generate [--dry-run] Run code generator
  governance [flags]   Run governance cycle
  truth [flags]        Run truth verification

Goals: build-pass, truth-pass, mvp-complete, full-cycle,
       spec-pass, tdd-pass, mutation-pass, test-quality, deploy-ready

Flags for loop:
  --verbose, -v        Detailed output
  --resume, -r         Resume from saved state
  --tests, -t          Run tests in truth phase
`);
      break;
    }
  }
}

main().catch(err => {
  console.error("CLI Error:", err.message);
  process.exit(1);
});
