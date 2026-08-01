import * as fs from "fs";
import * as path from "path";

export function checkServiceKeyLeak(projectRoot: string, severity: "error" | "warning" = "error"): { code: string; severity: "error" | "warning"; file: string; message: string }[] {
  const sensitiveFiles = [".env", ".env.local", ".env.production"];
  for (const file of sensitiveFiles) {
    const filePath = path.join(projectRoot, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.includes("service_key") || content.includes("SERVICE_KEY") || content.includes("anon") && content.includes("key")) {
        return [{
          code: "KEY-001",
          severity,
          file,
          message: `Potential service key in ${file}`,
        }];
      }
    }
  }
  return [];
}
