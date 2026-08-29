import { Worker } from "worker_threads";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Task<T = unknown> {
  name: string;
  fn: () => Promise<T>;
}

export interface TaskResult<T = unknown> {
  name: string;
  success: boolean;
  result?: T;
  error?: string;
  durationMs: number;
}

export async function runParallel<T extends Record<string, unknown>>(
  tasks: Task[],
  maxConcurrency = 2
): Promise<Record<string, TaskResult>> {
  const results: Record<string, TaskResult> = {};
  const queue = [...tasks];
  const running: Promise<void>[] = [];

  async function runTask(task: Task): Promise<void> {
    const start = Date.now();
    try {
      const result = await task.fn();
      results[task.name] = { name: task.name, success: true, result, durationMs: Date.now() - start };
    } catch (err: unknown) {
      results[task.name] = {
        name: task.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  while (queue.length > 0) {
    while (running.length < maxConcurrency && queue.length > 0) {
      const task = queue.shift()!;
      const p = runTask(task).then(() => {
        const idx = running.indexOf(p);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(p);
    }
    if (running.length > 0) {
      await Promise.race(running);
    }
  }

  await Promise.all(running);
  return results;
}

export interface PhaseWorkerConfig {
  phase: string;
  fn: () => Promise<{ passed: boolean; errors: string[]; warnings: string[] }>;
}

export async function runPhasesParallel(
  phases: PhaseWorkerConfig[],
  maxConcurrency = 2
): Promise<Record<string, { passed: boolean; errors: string[]; warnings: string[]; durationMs: number }>> {
  const tasks: Task[] = phases.map(p => ({
    name: p.phase,
    fn: p.fn,
  }));
  const raw = await runParallel(tasks, maxConcurrency);
  const result: Record<string, any> = {};
  for (const [name, r] of Object.entries(raw)) {
    result[name] = {
      passed: r.success && (r.result as any)?.passed !== false,
      errors: (r.result as any)?.errors || (r.error ? [r.error] : []),
      warnings: (r.result as any)?.warnings || [],
      durationMs: r.durationMs,
    };
  }
  return result;
}
