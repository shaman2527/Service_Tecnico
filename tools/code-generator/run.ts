import { generateAll } from "./engine";
import type { GenerateOptions } from "./engine";
import { config } from "../config";

async function main() {
  let allPages: any[];
  try {
    allPages = (await import("./plans/mvp-pages")).allPages;
  } catch {
    console.log("   ⚠️  No page plans found (tools/code-generator/plans/mvp-pages.ts)");
    console.log("   Create a plans file or set codeGen.enabled=false in tools/config.ts");
    allPages = [];
  }

  const args = process.argv.slice(2);
  const flags: GenerateOptions & { help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--skip":
      case "-s":
        flags.writeMode = "skip";
        break;
      case "--dry-run":
      case "-d":
        flags.dryRun = true;
        break;
      case "--page":
      case "-p":
        flags.filterPages = (args[++i] || "").split(",").map(s => s.trim());
        break;
      case "--incremental":
      case "-i":
        flags.incremental = true;
        break;
      case "--verbose":
      case "-v":
        flags.verbose = true;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
    }
  }

  if (flags.help) {
    console.log(`
Usage: npx tsx tools/code-generator/run.ts [options]

Options:
  --skip, -s         Skip files that already exist
  --incremental, -i  Skip files whose content hasn't changed (hash-based)
  --dry-run, -d      Preview files without writing
  --page, -p <name>  Generate specific page(s) (comma-separated: route or component name)
  --verbose, -v      Detailed output per file
  --help, -h         Show this help
`);
    process.exit(0);
  }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   $P Engine — Code Generator                 ║");
  console.log("╚══════════════════════════════════════════════╝");

  const mode = flags.writeMode === "skip" ? " (skip existing)" : "";
  const target = flags.filterPages ? ` [target: ${flags.filterPages.join(", ")}]` : "";
  const dryRunLabel = flags.dryRun ? " [DRY RUN — no files written]" : "";
  const incLabel = flags.incremental ? " [incremental]" : "";

  console.log(`\nPages to generate: ${(flags.filterPages || allPages).length}${mode}${target}${dryRunLabel}${incLabel}`);

  const state = generateAll(allPages, flags);

  console.log("\n═══════════════════════════════════════════════");
  console.log(`Generated: ${state.generated.length} files`);
  console.log(`Errors:    ${state.errors.length}`);

  if (state.errors.length > 0) {
    console.log("\nErrors:");
    for (const err of state.errors) {
      console.log(`  ❌ ${err.page}: ${err.error}`);
    }
  }

  console.log("\nDone.");
  process.exit(state.errors.length > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
