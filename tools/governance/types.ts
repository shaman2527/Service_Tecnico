import type { PageConfig } from "../code-generator/types";

export type PatternKind = "placeholder" | "repetition" | "missing-template" | "missing-feature";

export interface PatternMatch {
  kind: PatternKind;
  confidence: number;
  description: string;
  files: string[];
  templateName?: string;
  suggestedAction: "run-engine" | "create-template" | "skip";
}

export interface GovernanceDecision {
  proposedPage?: PageConfig;
  createTemplate?: {
    name: string;
    kind: "component" | "api" | "astro" | "schema";
    groupCount: number;
  };
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface BuildResult {
  success: boolean;
  durationMs: number;
  errors: { file: string; message: string; line?: number }[];
  warnings: { file: string; message: string }[];
  rawOutput: string;
}

export interface SessionState {
  projectDir: string;
  totalPages: number;
  implementedPages: number;
  placeholderPages: number;
  generatedPages: number;
  handBuiltPages: number;
  patternsFound: PatternMatch[];
  decisions: GovernanceDecision[];
  lastBuild: BuildResult | null;
  hooksApplied: string[];
  skillsLoaded: string[];
}

export interface EngineAnalysis {
  templates: { name: string; type: "component" | "api" | "astro" | "schema"; generates: string }[];
  plans: PageConfig[];
  valid: boolean;
  issues: string[];
}

export type HookEventType =
  | "PRE_EXECUTE"
  | "POST_EXECUTE"
  | "ON_FAILURE"
  | "STATE_MUTATED"
  | "BEFORE_BUILD"
  | "AFTER_BUILD";

export interface HookPayload {
  event: HookEventType;
  sender: string;
  target: string;
  data: Record<string, unknown>;
  timestamp: number;
  cycleCount: number;
}

export type HookCallback = (payload: HookPayload) => Promise<void>;

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  hooks: HookEventType[];
  localPath: string;
  installed: boolean;
  source: string;
}

export interface GovernanceResult {
  buildPassed: boolean;
  placeholdersRemaining: number;
  generatedFiles: number;
  errors: { file: string; message: string; line?: number }[];
  durationMs: number;
  timestamp: string;
}

// === Learning Injector types ===
export interface LearningContext {
  patterns: LearningPattern[];
  errorsToAvoid: string[];
  activeConventions: string[];
  isFirstSession: boolean;
  sourceFiles: string[];
  timestamp: string;
}

export interface LearningPattern {
  kind: "recurring-error" | "convention" | "anti-pattern" | "optimization";
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  evidence: string[];
  suggestedFix?: string;
}

// === Context Guard types ===
export interface FeatureScope {
  featureId: number;
  featureTitle: string;
  allowedPaths: string[];
}

export interface ContextViolation {
  file: string;
  reason: string;
  severity: "error" | "warning";
}

export interface ContextGuardResult {
  passed: boolean;
  violations: ContextViolation[];
  activeFeature: FeatureScope | null;
  warnings: string[];
}

// === Reviewer types ===
export interface ReviewResult {
  featureId: number;
  featureTitle: string;
  reviewTimestamp: string;
  findings: ReviewFinding[];
  circuitBreaker: {
    attempt: number;
    maxAttempts: number;
    blocked: boolean;
  };
  passed: boolean;
}

export interface ReviewFinding {
  severity: "blocking" | "warning" | "info";
  category: "security" | "convention" | "quality" | "consistency" | "scope" | "test-quality" | "coverage" | "migration" | "typescript";
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

// === Feature Closer types ===
export interface CloseFeatureResult {
  featureId: number;
  featureTitle: string;
  status: "done" | "failed" | "blocked";
  deployReadinessPassed: boolean;
  testsPassed: boolean;
  buildPassed: boolean;
  truthPassed: boolean;
  timestamp: string;
  artifacts: string[];
}
