import type { TddJudgeCheck, TddJudgeVerdict } from "./tdd-craftsman";

export interface JudgeCriteria {
  name: string;
  weight: number;
  check: () => { pass: boolean; detail: string };
}

export function createJudge(criteria: JudgeCriteria[]): TddJudgeVerdict {
  const checks: TddJudgeCheck[] = criteria.map(c => {
    const result = c.check();
    return { name: c.name, pass: result.pass, detail: result.detail };
  });

  const weightedScore = checks.reduce((score, c, i) => {
    return score + (c.pass ? criteria[i].weight : 0);
  }, 0);

  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const approved = totalWeight > 0 ? weightedScore / totalWeight >= 0.8 : false;

  return { approved, checks };
}
