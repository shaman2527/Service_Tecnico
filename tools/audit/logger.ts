import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  traceId?: string;
  phase?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

const LOG_DIR = path.resolve(process.cwd(), "tools", "progress", "logs");
const MAX_LOG_FILES = 10;
const MAX_LOG_FILE_SIZE = 1024 * 1024; // 1MB

function ensureDir(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getCurrentLogPath(): string {
  return path.join(LOG_DIR, "harness.log");
}

function rotateIfNeeded(): void {
  const logPath = getCurrentLogPath();
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size < MAX_LOG_FILE_SIZE) return;

  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith("harness") && f.endsWith(".log"))
    .sort();

  if (files.length >= MAX_LOG_FILES) {
    const toRemove = files.slice(0, files.length - MAX_LOG_FILES + 1);
    for (const f of toRemove) {
      try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch {}
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.renameSync(logPath, path.join(LOG_DIR, `harness-${timestamp}.log`));
}

export function log(entry: Omit<LogEntry, "timestamp">): void {
  ensureDir();
  rotateIfNeeded();

  const full: LogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  const line = JSON.stringify(full) + "\n";
  fs.appendFileSync(getCurrentLogPath(), line, "utf-8");

  // Console output for dev visibility
  const icon = entry.level === "error" ? "✖" : entry.level === "warn" ? "⚠" : entry.level === "info" ? "●" : "·";
  const phase = entry.phase ? `[${entry.phase}] ` : "";
  const dur = entry.durationMs != null ? ` (${entry.durationMs}ms)` : "";
  console.log(`  ${icon} ${phase}${entry.message}${dur}`);
}

export function debug(module: string, message: string, data?: Record<string, unknown>): void {
  log({ level: "debug", module, message, data });
}

export function info(module: string, message: string, data?: { phase?: string; durationMs?: number } & Record<string, unknown>): void {
  log({ level: "info", module, message, ...data });
}

export function warn(module: string, message: string, data?: Record<string, unknown>): void {
  log({ level: "warn", module, message, data });
}

export function error(module: string, message: string, data?: Record<string, unknown>): void {
  log({ level: "error", module, message, data });
}

export function query(options: { level?: LogLevel; module?: string; since?: string; limit?: number } = {}): LogEntry[] {
  ensureDir();
  const logPath = getCurrentLogPath();
  if (!fs.existsSync(logPath)) return [];

  const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  const entries: LogEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (options.level && entry.level !== options.level) continue;
      if (options.module && entry.module !== options.module) continue;
      if (options.since && entry.timestamp < options.since) continue;
      entries.push(entry);
    } catch {}
  }

  const sorted = entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

export function getRecentErrors(limit = 10): LogEntry[] {
  return query({ level: "error", limit });
}

export function getModuleStats(): Record<string, { total: number; errors: number; warnings: number }> {
  ensureDir();
  const logPath = getCurrentLogPath();
  if (!fs.existsSync(logPath)) return {};

  const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  const stats: Record<string, { total: number; errors: number; warnings: number }> = {};

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (!stats[entry.module]) stats[entry.module] = { total: 0, errors: 0, warnings: 0 };
      stats[entry.module].total++;
      if (entry.level === "error") stats[entry.module].errors++;
      if (entry.level === "warn") stats[entry.module].warnings++;
    } catch {}
  }

  return stats;
}
