export interface GoalCondition {
  type: "build" | "truth" | "placeholders" | "endpoints_all_ok" | "custom" | "tests_pass" | "deploy_ready" | "spec_pass" | "tdd_pass" | "mutation_pass";
  description: string;
  customCheck?: (state: LoopState) => boolean;
}

export interface GoalConfig {
  id: string;
  description: string;
  conditions: GoalCondition[];
  maxIterations: number;
  intervalMs: number;
}

export interface PhaseResult {
  phase: string;
  passed: boolean;
  durationMs: number;
  errors: string[];
  warnings: string[];
}

export interface IterationRecord {
  iteration: number;
  timestamp: string;
  buildPassed: boolean;
  truthPassed: boolean;
  testsPassed: boolean;
  reviewPassed: boolean;
  securityPassed: boolean;
  contextGuardPassed: boolean;
  placeholdersRemaining: number;
  endpointFailCount: number;
  durationMs: number;
  errors: string[];
  phases: PhaseResult[];
}

export interface LoopState {
  goalId: string;
  description: string;
  iterations: number;
  totalElapsedMs: number;
  maxIterations: number;
  lastBuildResult: boolean;
  lastTruthResult: boolean;
  lastTestResult: boolean;
  lastReviewResult: boolean;
  lastSecurityResult: boolean;
  lastContextGuardResult: boolean;
  lastDeployReadinessResult: boolean;
  lastSpecResult: boolean;
  lastTddResult: boolean;
  lastMutationResult: boolean;
  mutationScore: number;
  history: IterationRecord[];
  goalMet: boolean;
  memoryFile: string;
}

export interface LoopResult {
  goalMet: boolean;
  iterations: number;
  totalElapsedMs: number;
  summary: string;
  state: LoopState;
}
