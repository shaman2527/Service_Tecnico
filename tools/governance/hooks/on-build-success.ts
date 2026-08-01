import type { HookPayload } from "../types";

export async function onBuildSuccess(payload: HookPayload): Promise<void> {
  const { success, durationMs } = payload.data as { success: boolean; durationMs: number };
  if (!success) return;
  console.log(`   ✅ Build passed (${((durationMs || 0) / 1000).toFixed(1)}s)`);
}
