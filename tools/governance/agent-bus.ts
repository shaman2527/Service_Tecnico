import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

export type AgentId =
  | "leader"
  | "implementer"
  | "reviewer"
  | "spec-partner"
  | "tdd-craftsman"
  | "mutation-tester"
  | "judge"
  | "improver";

export type MessagePriority = "high" | "normal" | "low";

export type MessageKind =
  | "phase-result"
  | "review-request"
  | "review-response"
  | "spec-request"
  | "spec-response"
  | "fix-request"
  | "fix-applied"
  | "build-failure"
  | "build-success"
  | "goal-met"
  | "goal-failed"
  | "error"
  | "log";

export interface AgentMessage {
  id: string;
  from: AgentId;
  to: AgentId;
  kind: MessageKind;
  priority: MessagePriority;
  payload: Record<string, unknown>;
  timestamp: string;
  correlationId?: string;
  replyTo?: string;
}

const AGENTS_DIR = path.resolve(process.cwd(), config.paths.artifactsDir, "messages");

function ensureDir(): void {
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

function messageFilename(msg: AgentMessage): string {
  return `${msg.timestamp.replace(/[:.]/g, "-")}__${msg.from}__${msg.to}__${msg.kind}.json`;
}

export function publish(msg: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
  ensureDir();
  const full: AgentMessage = {
    ...msg,
    id: `${msg.from}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };
  const filePath = path.join(AGENTS_DIR, messageFilename(full));
  fs.writeFileSync(filePath, JSON.stringify(full, null, 2), "utf-8");
  return full;
}

export function subscribe(agent: AgentId, options?: { kind?: MessageKind; since?: string }): AgentMessage[] {
  ensureDir();
  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".json"));
  const messages: AgentMessage[] = [];

  for (const file of files) {
    try {
      const msg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), "utf-8")) as AgentMessage;
      if (msg.to !== agent) continue;
      if (options?.kind && msg.kind !== options.kind) continue;
      if (options?.since && msg.timestamp < options.since) continue;
      messages.push(msg);
    } catch {}
  }

  return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function consume(agent: AgentId, options?: { kind?: MessageKind; since?: string }): AgentMessage[] {
  const messages = subscribe(agent, options);
  for (const msg of messages) {
    const filePath = path.join(AGENTS_DIR, messageFilename(msg));
    try { fs.unlinkSync(filePath); } catch {}
  }
  return messages;
}

export function route(msg: Omit<AgentMessage, "id" | "timestamp">): AgentMessage | null {
  const agentDir = path.join(process.cwd(), "tools", "agents", `${msg.to}.md`);
  if (!fs.existsSync(agentDir)) {
    console.error(`[agent-bus] Target agent "${msg.to}" has no definition file at tools/agents/${msg.to}.md`);
    return null;
  }
  return publish(msg);
}

export function buildFailure(from: AgentId, details: { phase: string; errors: string[]; file?: string }): void {
  publish({
    from,
    to: "improver",
    kind: "build-failure",
    priority: "high",
    payload: details,
    correlationId: `${from}-${Date.now()}`,
  });
}

export function reviewRequest(from: AgentId, file: string): void {
  publish({
    from,
    to: "reviewer",
    kind: "review-request",
    priority: "normal",
    payload: { file, requester: from },
  });
}

export function getMetrics(): { total: number; byKind: Record<string, number>; byAgent: Record<string, number> } {
  ensureDir();
  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".json"));
  const byKind: Record<string, number> = {};
  const byAgent: Record<string, number> = {};

  for (const file of files) {
    try {
      const msg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), "utf-8")) as AgentMessage;
      byKind[msg.kind] = (byKind[msg.kind] || 0) + 1;
      byAgent[msg.from] = (byAgent[msg.from] || 0) + 1;
    } catch {}
  }

  return { total: files.length, byKind, byAgent };
}
