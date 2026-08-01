import * as fs from "fs";
import * as path from "path";

export interface TddJudgeCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface TddJudgeVerdict {
  approved: boolean;
  checks: TddJudgeCheck[];
}

export interface TddCraftsmanResult {
  cycles: number;
  judgeVerdict: TddJudgeVerdict;
  error?: string;
}

function findTestFiles(): string[] {
  const dirs = ["src", "tests"];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { recursive: true });
      for (const e of entries) {
        if (typeof e === "string" && (e.endsWith(".test.ts") || e.endsWith(".spec.ts"))) {
          files.push(path.join(dir, e));
        }
      }
    } catch {}
  }
  return files;
}

function findSourceFiles(): string[] {
  const dirs = ["src"];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { recursive: true });
      for (const e of entries) {
        if (typeof e === "string" && e.endsWith(".ts") && !e.endsWith(".test.ts") && !e.endsWith(".spec.ts")) {
          files.push(path.join(dir, e));
        }
      }
    } catch {}
  }
  return files;
}

export function runTddCraftsman(
  currentCycle: number,
  maxCycles: number,
  verbose: boolean = false
): TddCraftsmanResult {
  const testFiles = findTestFiles();
  const sourceFiles = findSourceFiles();

  const checks: TddJudgeCheck[] = [
    {
      name: "tests-exist",
      pass: testFiles.length > 0,
      detail: testFiles.length > 0
        ? `${testFiles.length} test files found`
        : "No test files found. Write tests before implementation.",
    },
    {
      name: "source-exists",
      pass: sourceFiles.length > 0,
      detail: sourceFiles.length > 0
        ? `${sourceFiles.length} source files found`
        : "No source files found.",
    },
    {
      name: "red-green-cycle",
      pass: testFiles.length >= sourceFiles.length * 0.5,
      detail: `${testFiles.length} test files vs ${sourceFiles.length} source files (target: 50% test coverage)`,
    },
  ];

  // Check for .only() which would skip other tests
  const onlyFound: string[] = [];
  for (const f of testFiles) {
    try {
      const content = fs.readFileSync(f, "utf-8");
      if (content.includes(".only(")) onlyFound.push(f);
    } catch {}
  }

  if (onlyFound.length > 0) {
    checks.push({
      name: "no-only",
      pass: false,
      detail: `.only() found in: ${onlyFound.join(", ")}`,
    });
  }

  const allPassed = checks.every(c => c.pass);
  const approved = allPassed && currentCycle >= 1;

  return {
    cycles: currentCycle,
    judgeVerdict: { approved, checks },
    error: !allPassed ? "TDD checks failed" : undefined,
  };
}
