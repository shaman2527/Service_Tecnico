import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const MEMORY_DIR = path.join(projectRoot, config.paths.progressDir, "memory");

export interface ErrorRecord {
  message: string;
  module: string;
  severity: "low" | "medium" | "high" | "critical";
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolvedAt?: string;
  fixHash?: string;
}

export interface ConventionRecord {
  description: string;
  module: string;
  establishedAt: string;
  lastReinforced: string;
  violations: number;
}

export interface LoopMemory {
  errors: Record<string, ErrorRecord>;
  conventions: ConventionRecord[];
  sessionCount: number;
  lastLoopResult: string;
  lastLoopDurationMs: number;
  totalPhasesPassed: number;
  totalPhasesFailed: number;
  createdAt: string;
  updatedAt: string;
}

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function memPath(): string {
  ensureDir();
  return path.join(MEMORY_DIR, "loop-memory.json");
}

export function loadMemory(): LoopMemory {
  try {
    const raw = fs.readFileSync(memPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      errors: {},
      conventions: [],
      sessionCount: 0,
      lastLoopResult: "unknown",
      lastLoopDurationMs: 0,
      totalPhasesPassed: 0,
      totalPhasesFailed: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

export function saveMemory(mem: LoopMemory): void {
  ensureDir();
  mem.updatedAt = new Date().toISOString();
  fs.writeFileSync(memPath(), JSON.stringify(mem, null, 2), "utf-8");
}

export function recordError(module: string, message: string, severity: ErrorRecord["severity"] = "high"): void {
  const mem = loadMemory();
  const key = `${module}::${message.length > 120 ? message.slice(0, 120) : message}`;
  if (mem.errors[key]) {
    mem.errors[key].count += 1;
    mem.errors[key].lastSeen = new Date().toISOString();
    if (mem.errors[key].count >= 3 && mem.errors[key].severity !== "critical") {
      mem.errors[key].severity = "critical";
    }
  } else {
    mem.errors[key] = {
      message,
      module,
      severity,
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
  }
  saveMemory(mem);
}

export function resolveError(module: string, message: string, fixHash?: string): void {
  const mem = loadMemory();
  const key = `${module}::${message.length > 120 ? message.slice(0, 120) : message}`;
  if (mem.errors[key]) {
    mem.errors[key].resolvedAt = new Date().toISOString();
    if (fixHash) mem.errors[key].fixHash = fixHash;
  }
  saveMemory(mem);
}

export function addConvention(description: string, module: string): void {
  const mem = loadMemory();
  const existing = mem.conventions.find(c => c.description === description);
  if (existing) {
    existing.lastReinforced = new Date().toISOString();
  } else {
    mem.conventions.push({
      description,
      module,
      establishedAt: new Date().toISOString(),
      lastReinforced: new Date().toISOString(),
      violations: 0,
    });
  }
  saveMemory(mem);
}

export function recordLoopResult(passed: boolean, durationMs: number, phasesPassed: number, phasesFailed: number): void {
  const mem = loadMemory();
  mem.sessionCount += 1;
  mem.lastLoopResult = passed ? "pass" : "fail";
  mem.lastLoopDurationMs = durationMs;
  mem.totalPhasesPassed += phasesPassed;
  mem.totalPhasesFailed += phasesFailed;
  saveMemory(mem);
}

export function getUnresolvedErrors(minCount = 2): ErrorRecord[] {
  const mem = loadMemory();
  return Object.values(mem.errors)
    .filter(e => !e.resolvedAt && e.count >= minCount)
    .sort((a, b) => b.count - a.count);
}

export function getTopConventions(limit = 5): ConventionRecord[] {
  const mem = loadMemory();
  return mem.conventions
    .slice()
    .sort((a, b) => a.violations - b.violations)
    .slice(0, limit);
}

export function clearMemory(): void {
  const path_ = memPath();
  if (fs.existsSync(path_)) fs.unlinkSync(path_);
}
