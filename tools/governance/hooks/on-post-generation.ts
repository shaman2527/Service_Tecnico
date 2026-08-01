import type { HookPayload } from "../types";
import { validateFile } from "../security-validator";

export async function onPostGeneration(payload: HookPayload): Promise<void> {
  const isApi = payload.target.includes("api");
  const filePath = payload.data.filePath as string | undefined;
  const content = payload.data.content as string | undefined;
  if (!content || !filePath) return;

  const issues = validateFile(content, filePath, isApi);
  for (const issue of issues) {
    const tag = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
    console.log(`   ${tag} [${issue.code}] ${issue.message}`);
  }
}
