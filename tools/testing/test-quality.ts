import * as fs from "fs";
import * as path from "path";

export interface TestInfo {
  file: string;
  type: "unit" | "integration" | "e2e";
  testCount: number;
  assertCount: number;
  hasDescribe: boolean;
  hasIt: boolean;
  lines: number;
}

export interface TestQualityReport {
  totalTests: number;
  unitTests: number;
  integrationTests: number;
  e2eTests: number;
  score: number;
  issues: { file: string; severity: "error" | "warning"; message: string }[];
}

function classifyTestFile(filePath: string, content: string): TestInfo["type"] {
  if (content.includes("integration") || content.includes("Integration")) return "integration";
  if (content.includes("e2e") || content.includes("E2E") || content.includes("playwright")) return "e2e";
  return "unit";
}

function countAsserts(content: string): number {
  const assertPatterns = [
    /\bexpect\(/g, /\bassert\./g, /\bassert\(/g,
    /\btoHaveText\b/g, /\btoContainText\b/g, /\btoBeVisible\b/g,
  ];
  return assertPatterns.reduce((sum, re) => {
    const matches = content.match(re);
    return sum + (matches ? matches.length : 0);
  }, 0);
}

export function runTestQualityCheck(searchDirs: string[]): TestQualityReport {
  const testFiles: TestInfo[] = [];
  const issues: TestQualityReport["issues"] = [];

  for (const dir of searchDirs) {
    const dirPath = path.resolve(dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath, { recursive: true })
      .filter((f): f is string => typeof f === "string")
      .filter(f => f.endsWith(".test.ts") || f.endsWith(".spec.ts") || f.endsWith(".test.tsx"));

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const testMatches = content.match(/\b(test|it)\s*\(/g);
        const testCount = testMatches ? testMatches.length : 0;
        const type = classifyTestFile(filePath, content);

        testFiles.push({
          file,
          type,
          testCount,
          assertCount: countAsserts(content),
          hasDescribe: /describe\s*\(/.test(content),
          hasIt: /\b(it|test)\s*\(/.test(content),
          lines: content.split("\n").length,
        });

        // Quality checks
        if (testCount > 0 && countAsserts(content) === 0) {
          issues.push({ file, severity: "warning", message: "Tests found but no assertions detected" });
        }
        if (!/describe\s*\(/.test(content) && testCount > 1) {
          issues.push({ file, severity: "warning", message: "Multiple tests without describe block" });
        }
        if (content.includes(".only(")) {
          issues.push({ file, severity: "error", message: "Test has .only() — will skip other tests" });
        }
        if (content.includes("console.log")) {
          issues.push({ file, severity: "warning", message: "console.log in test file" });
        }
      } catch {}
    }
  }

  const totalTests = testFiles.reduce((s, t) => s + t.testCount, 0);
  const unitTests = testFiles.filter(t => t.type === "unit").length;
  const integrationTests = testFiles.filter(t => t.type === "integration").length;
  const e2eTests = testFiles.filter(t => t.type === "e2e").length;

  // Score: 1.0 - weighted issues
  let score = 1.0;
  const errorCount = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  score -= errorCount * 0.1;
  score -= warningCount * 0.05;

  // Bonus for good practices
  const filesWithAsserts = testFiles.filter(t => t.assertCount > 0).length;
  if (totalTests > 0 && filesWithAsserts / Math.max(testFiles.length, 1) > 0.8) score += 0.1;

  return {
    totalTests,
    unitTests,
    integrationTests,
    e2eTests,
    score: Math.max(0, Math.min(1, score)),
    issues,
  };
}
