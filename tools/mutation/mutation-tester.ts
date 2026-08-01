import { config } from "../config";
import {
  findMutations,
  applyMutation,
  restoreFile,
  collectSourceFiles,
  MUTATION_OPS,
  type Mutant,
} from "./mutate";
import {
  analyzeSurvivors,
  type SurvivorReport,
} from "./survivors";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const REPORT_DIR = "progress/artifacts/mutation-report";

export interface MutationTestResult {
  report: SurvivorReport;
  durationMs: number;
  error?: string;
}

export function runMutationTests(
  maxMutations: number = 20,
  dryRun: boolean = false,
): MutationTestResult {
  const start = Date.now();

  const includePaths = config.mutation?.include || ["src/"];
  const excludePaths = config.mutation?.exclude || ["**/*.test.*", "**/*.spec.*"];
  const files = collectSourceFiles(includePaths, excludePaths);

  if (files.length === 0) {
    return {
      report: analyzeSurvivors([], []),
      durationMs: Date.now() - start,
      error: "No source files found to mutate",
    };
  }

  const allMutants: Mutant[] = [];
  const testResults: { file: string; passed: boolean; testName?: string }[] = [];

  for (const file of files) {
    const mutants = findMutations(file);
    if (mutants.length > 0) {
      allMutants.push(...mutants);
    }
  }

  if (allMutants.length === 0) {
    return {
      report: analyzeSurvivors([], testResults),
      durationMs: Date.now() - start,
    };
  }

  // Limit mutations for performance
  const mutantsToTest = allMutants.slice(0, maxMutations);

  if (dryRun) {
    const report = analyzeSurvivors(mutantsToTest, testResults);
    const durationMs = Date.now() - start;
    return { report, durationMs };
  }

  // Save original content for each file we'll mutate
  const originals = new Map<string, string>();
  const mutatedFiles = new Set(mutantsToTest.map(m => m.file));
  for (const file of mutatedFiles) {
    originals.set(file, fs.readFileSync(file, "utf-8"));
  }

  try {
    for (const mutant of mutantsToTest) {
      applyMutation(mutant.file, mutant);

      try {
        const testCmd = config.commands.test;
        if (testCmd) {
          execSync(testCmd, { timeout: 30000, stdio: "pipe" });
        }
        testResults.push({ file: mutant.file, passed: true, testName: `mutant:${mutant.op}` });
      } catch {
        testResults.push({ file: mutant.file, passed: false, testName: `mutant:${mutant.op}` });
      }

      // Restore original
      const orig = originals.get(mutant.file);
      if (orig) restoreFile(mutant.file, orig);
    }
  } catch (err) {
    // Restore all originals on error
    for (const [file, content] of originals) {
      restoreFile(file, content);
    }
    return {
      report: analyzeSurvivors(mutantsToTest, testResults),
      durationMs: Date.now() - start,
      error: `Mutation interrupted: ${err}`,
    };
  }

  // Save report
  const report = analyzeSurvivors(mutantsToTest, testResults);
  const reportPath = path.join(REPORT_DIR, `mutation-report-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  return { report, durationMs: Date.now() - start };
}
