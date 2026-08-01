/**
 * tools/auto-fix/engine.ts
 *
 * Main auto-fix orchestrator. Takes ReviewFindings and tries to fix them automatically.
 *
 * Flow:
 * 1. Pre-flight checks (git clean, build green, tests green)
 * 2. For each finding in autoApproveTypes:
 *    a. Generate fix (mechanical or AI)
 *    b. Apply with rollback on failure
 *    c. Audit log
 * 3. Report summary
 *
 * SAFETY: This module auto-applies changes. Mitigations:
 * - Git checkpoint before each fix
 * - Build + tests validation after each fix
 * - Rollback if anything breaks
 * - Hard whitelist of fix types
 * - Kill switch via env var
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { runPreFlight, type PreFlightResult } from "./pre-flight";
import { applyFixSafely, type ApplyResult } from "./safe-apply";
import { logAudit, getAuditSummary, clearAudit } from "./audit";

export interface ProposedFix {
  type: string; // e.g. "console-log", "var-let", "class-to-className"
  file: string;
  description: string;
  apply: () => string; // returns new file content
  confidence: number; // 0-1
}

export interface AutoFixSummary {
  total: number;
  applied: number;
  skipped: number;
  rolledBack: number;
  failed: number;
  details: Array<{
    fix: ProposedFix;
    result: ApplyResult;
  }>;
  summary: string;
  preflight: PreFlightResult;
}

/**
 * Generate fixes mechanically (no AI needed for these types).
 */
export function generateMechanicalFixes(content: string, filePath: string): ProposedFix[] {
  const fixes: ProposedFix[] = [];

  // Fix 1: Remove console.log in tests
  if (/\.test\.|__tests__|\.spec\./.test(filePath)) {
    const withoutConsoleLog = content.replace(/^\s*console\.log\([^)]*\);?\s*\n?/gm, "");
    if (withoutConsoleLog !== content) {
      fixes.push({
        type: "console-log",
        file: filePath,
        description: "Remove console.log statements from test files",
        confidence: 0.95,
        apply: () => withoutConsoleLog,
      });
    }
  }

  // Fix 2: Remove debugger statements
  if (/\bdebugger\b/.test(content)) {
    const withoutDebugger = content.replace(/^\s*debugger;?\s*\n?/gm, "");
    if (withoutDebugger !== content) {
      fixes.push({
        type: "debugger",
        file: filePath,
        description: "Remove debugger statements",
        confidence: 0.99,
        apply: () => withoutDebugger,
      });
    }
  }

  // Fix 3: var → let/const (very mechanical)
  if (/\bvar\s+/.test(content)) {
    const withLet = content.replace(/\bvar\s+/g, "let ");
    if (withLet !== content) {
      fixes.push({
        type: "var-let",
        file: filePath,
        description: "Replace var with let",
        confidence: 0.9,
        apply: () => withLet,
      });
    }
  }

  // Fix 4: class= → className= in JSX/TSX
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
    const withClassName = content.replace(/\bclass=/g, "className=");
    if (withClassName !== content) {
      fixes.push({
        type: "class-to-className",
        file: filePath,
        description: "Replace class= with className= in JSX",
        confidence: 0.99,
        apply: () => withClassName,
      });
    }
  }

  return fixes;
}

/**
 * Generate fixes using AI for non-mechanical cases.
 * NOTE: Requires ANTHROPIC_API_KEY env var. Skipped if dryRun=true or key missing.
 */
export async function generateAIFixes(
  _content: string,
  _filePath: string,
  findingMessage: string,
): Promise<ProposedFix | null> {
  // AI integration is opt-in. If not configured, return null.
  if (!config.autoFix || config.autoFix.apiProvider === "none") return null;
  if (config.autoFix.dryRun) return null;
  if (config.autoFix.apiProvider === "claude" && !process.env.ANTHROPIC_API_KEY) return null;

  // AI fix generation would go here. Skipping for now to keep implementation safe.
  // Implementation would:
  // 1. Send content + findingMessage to Claude
  // 2. Parse response as diff
  // 3. Validate diff is small (< config.autoFix.maxDiffLines)
  // 4. Return ProposedFix with confidence from AI

  console.log(`      🤖 AI fix for: ${findingMessage.slice(0, 60)} (skipped — not yet implemented)`);
  return null;
}

/**
 * Main entry point. Takes findings, returns summary.
 */
export async function autoFixFindings(
  findings: Array<{
    severity: "blocking" | "warning" | "info";
    category: string;
    file: string;
    line?: number;
    message: string;
  }>,
  options: { clearPreviousAudit?: boolean } = {},
): Promise<AutoFixSummary> {
  if (options.clearPreviousAudit) clearAudit();

  console.log(`\n🤖 Auto-Fix Engine`);
  console.log(`   Findings to process: ${findings.length}`);

  // Step 1: Pre-flight checks
  const preflight = await runPreFlight();
  console.log(`\n   📋 Pre-flight checks:`);
  for (const c of preflight.checks) {
    console.log(`      ${c.passed ? "✅" : "❌"} ${c.name}: ${c.detail.slice(0, 80)}`);
  }

  if (!preflight.canProceed) {
    return {
      total: findings.length,
      applied: 0,
      skipped: findings.length,
      rolledBack: 0,
      failed: 0,
      details: [],
      summary: `❌ Pre-flight failed. Auto-fix skipped.\n${preflight.checks.filter(c => !c.passed).map(c => c.detail).join("\n")}`,
      preflight,
    };
  }

  // Step 2: Generate and apply fixes
  const autoApproveTypes = config.autoFix?.autoApproveTypes || [];
  const details: Array<{ fix: ProposedFix; result: ApplyResult }> = [];
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = config.autoFix?.stopOnFailure ? 3 : Infinity;

  const fileGroups = new Map<string, typeof findings>();
  for (const f of findings) {
    if (!fileGroups.has(f.file)) fileGroups.set(f.file, []);
    fileGroups.get(f.file)!.push(f);
  }

  for (const [file, fileFindings] of fileGroups) {
    if (!fs.existsSync(file)) continue;

    const content = fs.readFileSync(file, "utf-8");

    // Generate mechanical fixes
    const mechanicalFixes = generateMechanicalFixes(content, file);

    for (const fix of mechanicalFixes) {
      if (!autoApproveTypes.includes(fix.type)) {
        logAudit({
          timestamp: new Date().toISOString(),
          fixType: fix.type,
          file: fix.file,
          applied: false,
          reason: `Type "${fix.type}" not in autoApproveTypes whitelist`,
          confidence: fix.confidence,
        });
        continue;
      }

      if (fix.confidence < (config.autoFix?.confidenceThreshold ?? 0.8)) {
        logAudit({
          timestamp: new Date().toISOString(),
          fixType: fix.type,
          file: fix.file,
          applied: false,
          reason: `Confidence ${fix.confidence} < threshold ${config.autoFix?.confidenceThreshold ?? 0.8}`,
          confidence: fix.confidence,
        });
        continue;
      }

      const newContent = fix.apply();

      // Check max diff size
      const diffLines = Math.abs(newContent.split("\n").length - content.split("\n").length);
      if (diffLines > (config.autoFix?.maxDiffLines ?? 50)) {
        logAudit({
          timestamp: new Date().toISOString(),
          fixType: fix.type,
          file: fix.file,
          applied: false,
          reason: `Diff ${diffLines} lines > max ${config.autoFix?.maxDiffLines}`,
          confidence: fix.confidence,
        });
        continue;
      }

      console.log(`\n   🔧 Applying ${fix.type} to ${fix.file}...`);

      const result = await applyFixSafely(file, newContent, {
        fixName: `${fix.type}-${path.basename(file)}`,
        validateBuild: true,
        validateTests: true,
      });

      logAudit({
        timestamp: new Date().toISOString(),
        fixType: fix.type,
        file: fix.file,
        applied: result.applied,
        reason: result.reason,
        diffSize: result.diffSize,
        confidence: fix.confidence,
      });

      details.push({ fix, result });

      if (result.applied) {
        console.log(`      ✅ ${fix.type}: ${result.reason}`);
        consecutiveFailures = 0;
      } else if (result.reason.includes("Rolled back")) {
        console.log(`      ⚠️  ${fix.type}: ${result.reason}`);
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.log(`\n   🛑 ${maxConsecutiveFailures} consecutive failures. Stopping.`);
          break;
        }
      } else {
        console.log(`      ⏭️  ${fix.type}: ${result.reason}`);
      }
    }
  }

  const applied = details.filter(d => d.result.applied).length;
  const rolledBack = details.filter(d => d.result.reason.includes("Rolled back")).length;
  const failed = details.filter(d => !d.result.applied && !d.result.reason.includes("Rolled back")).length;
  const skipped = details.length - applied - rolledBack - failed;

  const summary = [
    `## Auto-Fix Summary`,
    ``,
    `- **Total processed:** ${details.length}`,
    `- **Applied:** ${applied}`,
    `- **Skipped (whitelist/confidence/diff):** ${skipped}`,
    `- **Rolled back (build/test broke):** ${rolledBack}`,
    `- **Failed (other):** ${failed}`,
    ``,
    applied > 0
      ? `✅ Auto-fix improved codebase. Re-run reviewer to validate.`
      : `ℹ️  No fixes applied. See audit log for details.`,
    ``,
    getAuditSummary(),
  ].join("\n");

  return {
    total: findings.length,
    applied,
    skipped,
    rolledBack,
    failed,
    details,
    summary,
    preflight,
  };
}