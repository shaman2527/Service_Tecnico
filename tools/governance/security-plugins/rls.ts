import * as fs from "fs";
import * as path from "path";

export function checkRlsPolicies(projectRoot: string, severity: "error" | "warning" = "error"): { code: string; severity: "error" | "warning"; file: string; message: string }[] {
  const supabaseDir = path.join(projectRoot, "supabase");
  const hasDir = fs.existsSync(supabaseDir);
  if (!hasDir) {
    return [];
  }
  const migrationsDir = path.join(supabaseDir, "migrations");
  const hasMigrations = fs.existsSync(migrationsDir);
  if (!hasMigrations) {
    return [{
      code: "RLS-001",
      severity,
      file: "supabase/",
      message: "Supabase directory found but no migrations",
    }];
  }
  return [];
}
