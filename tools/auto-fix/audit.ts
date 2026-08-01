/**
 * tools/auto-fix/audit.ts
 *
 * Log all auto-fix decisions to a JSON file for transparency.
 */

import * as fs from "fs";
import * as path from "path";

export interface AuditEntry {
  timestamp: string;
  fixType: string;
  file: string;
  applied: boolean;
  reason: string;
  diffSize?: number;
  confidence?: number;
}

const AUDIT_LOG = "progress/artifacts/auto-fix-audit.json";

export function logAudit(entry: AuditEntry): void {
  const entries = loadAudit();
  entries.push(entry);
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.writeFileSync(AUDIT_LOG, JSON.stringify(entries, null, 2), "utf-8");
}

export function loadAudit(): AuditEntry[] {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  try {
    return JSON.parse(fs.readFileSync(AUDIT_LOG, "utf-8"));
  } catch {
    return [];
  }
}

export function clearAudit(): void {
  if (fs.existsSync(AUDIT_LOG)) {
    fs.unlinkSync(AUDIT_LOG);
  }
}

export function getAuditSummary(): string {
  const entries = loadAudit();
  const applied = entries.filter(e => e.applied).length;
  const skipped = entries.length - applied;

  const byType: Record<string, { applied: number; skipped: number }> = {};
  for (const e of entries) {
    if (!byType[e.fixType]) byType[e.fixType] = { applied: 0, skipped: 0 };
    if (e.applied) byType[e.fixType].applied++;
    else byType[e.fixType].skipped++;
  }

  return [
    `## Auto-Fix Audit`,
    ``,
    `- **Total decisions:** ${entries.length}`,
    `- **Applied:** ${applied}`,
    `- **Skipped/rolled-back:** ${skipped}`,
    ``,
    `### By type`,
    ...Object.entries(byType).map(([type, counts]) =>
      `- \`${type}\`: ${counts.applied} applied, ${counts.skipped} skipped`,
    ),
  ].join("\n");
}