import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { LearningContext, LearningPattern } from "./types";
import { config } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const P = config.paths;
const PATTERNS_PATH = path.join(projectRoot, P.progressDir, "patterns.md");
const HISTORY_PATH = path.join(projectRoot, P.progressDir, "history.md");

function loadFile(p: string): string {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function parsePatternsFromMd(content: string): LearningPattern[] {
  const patterns: LearningPattern[] = [];
  if (!content) return patterns;

  const lines = content.split("\n");
  let currentKind: LearningPattern["kind"] = "convention";
  let current: Partial<LearningPattern> | null = null;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (current && current.description) {
        patterns.push(current as LearningPattern);
      }
      const sectionName = line.replace("### ", "").trim().toLowerCase();
      if (sectionName.includes("error")) currentKind = "recurring-error";
      else if (sectionName.includes("convention")) currentKind = "convention";
      else if (sectionName.includes("anti")) currentKind = "anti-pattern";
      else currentKind = "optimization";
      current = null;
    } else if (line.trim().startsWith("- `[")) {
      const match = line.match(/^- `\[(\w+)]`\s+(.+?)(?:\s+\((\d+)\))?\s*$/);
      if (match) {
        const severity = match[1].toLowerCase() as LearningPattern["severity"];
        if (current && current.description) {
          patterns.push(current as LearningPattern);
        }
        current = {
          kind: currentKind,
          description: match[2].trim(),
          severity,
          occurrences: parseInt(match[3] || "1", 10),
          firstSeen: new Date().toISOString().split("T")[0],
          lastSeen: new Date().toISOString().split("T")[0],
          evidence: [],
        };
      }
    } else if (current && line.trim().startsWith("- `")) {
      current.evidence = [...(current.evidence || []), line.trim()];
    }
  }
  if (current && current.description) {
    patterns.push(current as LearningPattern);
  }

  return patterns;
}

function extractErrorsFromHistory(content: string): LearningPattern[] {
  const patterns: LearningPattern[] = [];
  if (!content) return patterns;

  const errorCounts = new Map<string, number>();
  const errorDates = new Map<string, string[]>();

  const lines = content.split("\n");
  for (const line of lines) {
    const errorMatch = line.match(/- (Error|Fix|Bug|Root cause):\s*(.+)/i);
    if (errorMatch) {
      const msg = errorMatch[2].trim();
      const key = msg.length > 80 ? msg.slice(0, 80) : msg;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      const date = line.startsWith("##") ? line.replace("##", "").trim() : "unknown";
      const dates = errorDates.get(key) || [];
      dates.push(date);
      errorDates.set(key, dates);
    }
  }

  for (const [key, count] of errorCounts.entries()) {
    if (count >= 2) {
      patterns.push({
        kind: "recurring-error",
        description: key,
        severity: count >= 3 ? "critical" : "high",
        occurrences: count,
        firstSeen: "unknown",
        lastSeen: new Date().toISOString(),
        evidence: errorDates.get(key) || [],
        suggestedFix: undefined,
      });
    }
  }

  return patterns;
}

export function loadLearningContext(): LearningContext {
  const patternsMd = loadFile(PATTERNS_PATH);
  const historyMd = loadFile(HISTORY_PATH);

  const patterns: LearningPattern[] = [
    ...parsePatternsFromMd(patternsMd),
    ...extractErrorsFromHistory(historyMd),
  ];

  const errorsToAvoid = patterns
    .filter(p => p.kind === "recurring-error" && (p.severity === "critical" || p.severity === "high"))
    .map(p => p.description);

  const activeConventions = patterns
    .filter(p => p.kind === "convention")
    .map(p => p.description);

  const sourceFiles: string[] = [];
  if (patternsMd) sourceFiles.push("progress/patterns.md");
  if (historyMd) sourceFiles.push("progress/history.md");

  return {
    patterns,
    errorsToAvoid,
    activeConventions,
    isFirstSession: patterns.length === 0,
    sourceFiles,
    timestamp: new Date().toISOString(),
  };
}

export function savePatternLearning(newPattern: Omit<LearningPattern, "firstSeen" | "lastSeen" | "occurrences">): void {
  const content = loadFile(PATTERNS_PATH);
  const existing = parsePatternsFromMd(content);

  const existingIdx = existing.findIndex(
    p => p.description === newPattern.description && p.kind === newPattern.kind
  );

  if (existingIdx >= 0) {
    existing[existingIdx].occurrences += 1;
    existing[existingIdx].lastSeen = new Date().toISOString();
    existing[existingIdx].severity = existing[existingIdx].occurrences >= 3 ? "critical" : existing[existingIdx].severity;
  } else {
    existing.push({
      ...newPattern,
      occurrences: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
  }

  const sections: Record<string, LearningPattern[]> = {
    "Errores Recurrentes": existing.filter(p => p.kind === "recurring-error"),
    "Conventions": existing.filter(p => p.kind === "convention"),
    "Anti-Patterns": existing.filter(p => p.kind === "anti-pattern"),
    "Optimizaciones": existing.filter(p => p.kind === "optimization"),
  };

  const lines = [
    "# Codebase Patterns",
    "",
    "> Auto-consolidated learnings from loop iterations.",
    `> Last updated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ];

  for (const [section, items] of Object.entries(sections)) {
    if (items.length > 0) {
      lines.push(`### ${section}`);
      lines.push("");
      for (const p of items) {
        lines.push(`- \`[${p.severity.toUpperCase()}]\` ${p.description} (${p.occurrences})`);
        for (const ev of p.evidence) {
          lines.push(`  - \`${ev}\``);
        }
        if (p.suggestedFix) {
          lines.push(`  - Fix: ${p.suggestedFix}`);
        }
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  lines.push("### Conventions");
  lines.push("");
  const convs = existing.filter(p => p.kind === "convention");
  if (convs.length === 0) {
    lines.push("*(ninguno por ahora)*");
  } else {
    for (const c of convs) {
      lines.push(`- \`[${c.severity.toUpperCase()}]\` ${c.description}`);
    }
  }

  fs.writeFileSync(PATTERNS_PATH, lines.join("\n"), "utf-8");
}

export function printLearningContext(ctx: LearningContext): void {
  console.log(`\n📖 Learning Context:`);
  console.log(`   Patterns: ${ctx.patterns.length} (${ctx.errorsToAvoid.length} errors to avoid, ${ctx.activeConventions.length} conventions)`);
  if (ctx.isFirstSession) console.log(`   ⚠️  First session — no prior learnings`);
  if (ctx.errorsToAvoid.length > 0) {
    console.log(`   ⛔ Errors to avoid:`);
    for (const e of ctx.errorsToAvoid) {
      console.log(`     - ${e.slice(0, 100)}`);
    }
  }
  if (ctx.activeConventions.length > 0) {
    console.log(`   📐 Active conventions:`);
    for (const c of ctx.activeConventions) {
      console.log(`     - ${c.slice(0, 100)}`);
    }
  }
}
