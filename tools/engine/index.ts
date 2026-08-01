/**
 * Harness ENGINEERING — Main Engine Index
 *
 * Central orchestrator that coordinates all sub-systems:
 *   detector → loop → governance → code-gen → truth → self-improve
 */

import { detectProject, type DetectedProject } from "../detector";
import { config } from "../config";

export interface EngineConfig {
  project: DetectedProject;
  verbose: boolean;
  runTests: boolean;
}

export function createEngine(options: Partial<EngineConfig> = {}): EngineConfig {
  return {
    project: detectProject(),
    verbose: options.verbose ?? false,
    runTests: options.runTests ?? false,
  };
}

export async function runFullCycle(engine: EngineConfig): Promise<{ success: boolean; summary: string }> {
  if (engine.verbose) {
    const { printDetectedProject } = await import("../detector");
    printDetectedProject(engine.project);
  }

  const { GOALS } = await import("../loop/goal-definitions");
  const { executeLoop, printLoopSummary } = await import("../loop/loop-engine");

  const goal = GOALS.find(g => g.id === "full-cycle");
  if (!goal) return { success: false, summary: "full-cycle goal not found" };

  const result = await executeLoop(goal, { verbose: engine.verbose, runTests: engine.runTests });
  printLoopSummary(result);

  return { success: result.goalMet, summary: result.summary };
}
