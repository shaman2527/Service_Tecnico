import type { HookEventType, HookPayload, HookCallback } from "./types";

const MAX_CYCLES = 500;

const listeners = new Map<HookEventType, HookCallback[]>();
const cycleHistory = new Map<string, number>();
let appliedHooks: string[] = [];

export function subscribe(event: HookEventType, callback: HookCallback): void {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event)!.push(callback);
}

export async function trigger(event: HookEventType, payload: Omit<HookPayload, "event" | "cycleCount" | "timestamp">): Promise<void> {
  const key = `${event}::${payload.sender}`;
  const count = (cycleHistory.get(key) ?? 0) + 1;
  if (count > MAX_CYCLES) {
    console.warn(`   ⚠️ Circuit breaker: ${key} repetido ${count} veces`);
    return;
  }
  cycleHistory.set(key, count);

  const fullPayload: HookPayload = {
    ...payload,
    event,
    timestamp: Date.now(),
    cycleCount: count,
  };

  const callbacks = listeners.get(event) ?? [];
  if (callbacks.length === 0) return;

  await Promise.all(
    callbacks.map(cb =>
      cb(fullPayload).catch(err => {
        console.error(`   ❌ Hook [${event}] error: ${err instanceof Error ? err.message : String(err)}`);
      })
    )
  );
}

export function resetCycle(): void {
  cycleHistory.clear();
  appliedHooks = [];
}

export function getAppliedHooks(): string[] {
  return [...appliedHooks];
}

export function recordApplied(name: string): void {
  appliedHooks.push(name);
}
