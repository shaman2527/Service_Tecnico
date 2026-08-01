import * as fs from "fs";
import * as path from "path";

export interface CycleEntry {
  cycle: number;
  phase: "red" | "green" | "refactor";
  file: string;
  action: string;
  success: boolean;
  timestamp: string;
}

const CYCLE_LOG_PATH = path.resolve(process.cwd(), "tools", "progress", "tdd-cycles.jsonl");

export function logCycle(entry: Omit<CycleEntry, "timestamp">): void {
  const dir = path.dirname(CYCLE_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const full: CycleEntry = { ...entry, timestamp: new Date().toISOString() };
  fs.appendFileSync(CYCLE_LOG_PATH, JSON.stringify(full) + "\n", "utf-8");
}

export function getCycleHistory(limit = 20): CycleEntry[] {
  if (!fs.existsSync(CYCLE_LOG_PATH)) return [];

  const lines = fs.readFileSync(CYCLE_LOG_PATH, "utf-8").split("\n").filter(Boolean);
  const entries: CycleEntry[] = lines.map(l => JSON.parse(l));
  return entries.slice(-limit);
}
