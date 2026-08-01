import type { Mutant as BaseMutant } from "./mutate";

export interface SurvivorMutant extends BaseMutant {
  coveringTest?: string;
}

export interface SurvivorReport {
  totalMutants: number;
  killed: BaseMutant[];
  survived: SurvivorMutant[];
  untested: BaseMutant[];
  score: number;
  summary: string;
}

export function analyzeSurvivors(
  mutants: BaseMutant[],
  testResults: { file: string; passed: boolean; testName?: string }[],
): SurvivorReport {
  const killed: BaseMutant[] = [];
  const survived: SurvivorMutant[] = [];
  const untested: BaseMutant[] = [];

  for (const mutant of mutants) {
    const relatedTests = testResults.filter(r => {
      const testFile = r.file.replace(/\\/g, "/");
      const mutantFile = mutant.file.replace(/\\/g, "/");
      const mutantDir = mutantFile.split("/").slice(0, -1).join("/");
      return testFile.includes(mutantDir) || testFile.includes(mutantFile.replace(".ts", ""));
    });

    if (relatedTests.length === 0) {
      untested.push(mutant);
    } else if (relatedTests.some(r => !r.passed)) {
      killed.push(mutant);
    } else {
      survived.push({ ...mutant, coveringTest: relatedTests[0]?.testName });
    }
  }

  const totalTestable = killed.length + survived.length;
  const score = totalTestable > 0 ? killed.length / totalTestable : 0;

  const summary = [
    `## Mutation Test Report`,
    ``,
    `- **Total mutants:** ${mutants.length}`,
    `- **Killed:** ${killed.length}`,
    `- **Survived:** ${survived.length}`,
    `- **Untested (no covering test):** ${untested.length}`,
    `- **Mutation score:** ${(score * 100).toFixed(1)}%`,
    score >= 0.9
      ? `- **Strong test suite**`
      : score >= 0.7
        ? `- **Moderate test coverage** — review survivors`
        : `- **Weak test suite** — add tests for survivors`,
    ``,
    `### Survivors`,
    ...survived.map(m => `- ${m.file}:${m.line} — \`${m.original}\` → \`${m.mutated}\` (${m.op})`),
    ``,
    `### Untested`,
    ...untested.map(m => `- ${m.file}:${m.line} — \`${m.original}\` → \`${m.mutated}\` (${m.op})`),
  ].join("\n");

  return { totalMutants: mutants.length, killed, survived, untested, score, summary };
}
