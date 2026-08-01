import * as fs from "node:fs";
import * as path from "node:path";

export type PageType = "crud" | "readonly" | "dashboard" | "operations" | "placeholder";

export type WriteMode = "overwrite" | "skip";

export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  isEnum?: string[];
  isPrimary?: boolean;
  isForeignKey?: boolean;
  referenceTable?: string;
  referenceColumn?: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnDef[];
}

export interface PagePlan {
  route: string;
  title: string;
  singularTitle: string;
  componentName: string;
  apiEndpoint: string;
  pageType: PageType;
  table: string;
  pkField: string;
  listFields: string[];
  formFields: string[];
  statsFields?: { label: string; field: string; type: "count" | "sum" | "filter"; filterValue?: string }[];
  searchFields: string[];
  filters?: { label: string; field: string; options: { value: string; label: string }[] }[];
  emptyMessage: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface EngineState {
  generated: GeneratedFile[];
  errors: { page: string; error: string }[];
}

export interface BuildResult {
  success: boolean;
  durationMs: number;
  errors: { file: string; message: string; line?: number }[];
  warnings: { file: string; message: string }[];
  rawOutput: string;
}

export interface TestResult {
  success: boolean;
  durationMs: number;
  errors: string[];
}

export interface GenerateOptions {
  writeMode?: WriteMode;
  dryRun?: boolean;
  filterPages?: string[];
  verbose?: boolean;
  incremental?: boolean;
}

export interface Stack {
  id: string;
  name: string;
  description: string;
  build: (timeoutMs?: number) => BuildResult;
  test?: (timeoutMs?: number) => TestResult;
  generate: (plans: PagePlan[], options?: GenerateOptions) => EngineState;
}

export interface FullCycleOptions {
  skipServer?: boolean;
  verbose?: boolean;
  runTests?: boolean;
  authCookie?: string;
}

export interface FullCycleResult {
  buildResult: BuildResult;
  testResult?: TestResult;
  truthPassed: boolean;
  durationMs: number;
}

export interface PEngineConfig {
  stack: Stack;
  plans: PagePlan[];
  progressDir?: string;
}

export function getTableSchema(tableName: string): TableSchema {
  // Dynamic: parse from project migrations
  const candidates = ["database/migrations", "migrations", "supabase/migrations", "db/migrations"];
  for (const dir of candidates) {
    const full = path.join(process.cwd(), dir);
    if (!fs.existsSync(full)) continue;
    const files = fs.readdirSync(full).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const content = fs.readFileSync(path.join(full, file), "utf-8");
      const regex = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:\\w+\\.)?\\"?${tableName}\\"?(?:\\s*\\()([^;]+)\\)`, "ims");
      const match = content.match(regex);
      if (!match) continue;
      const columns: ColumnDef[] = [];
      for (const line of match[1].split(",")) {
        const t = line.trim();
        if (!t || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|INDEX|CHECK|CREATE|\))/i.test(t)) continue;
        const p = t.split(/\s+/);
        if (p.length < 2) continue;
        const name = p[0].replace(/["`]/g, "");
        const rawType = p[1].toUpperCase();
        let type = "string";
        if (/INT|REAL|FLOAT|DOUBLE|DECIMAL/.test(rawType)) type = "number";
        else if (/BOOL/.test(rawType)) type = "boolean";
        columns.push({
          name, type,
          nullable: !/NOT\s+NULL/i.test(t) && !/PRIMARY/i.test(t),
          isPrimary: /PRIMARY/i.test(t),
          isForeignKey: /REFERENCES/i.test(t),
        });
      }
      return columns.length > 0 ? { name: tableName, columns } : { name: tableName, columns: [] };
    }
  }
  console.warn(`  ⚠ Tabla "${tableName}" no encontrada en migraciones. Define sus columnas en mvp-pages.ts`);
  return { name: tableName, columns: [] };
}
