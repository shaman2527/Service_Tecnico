import * as fs from "node:fs";
import * as path from "node:path";

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

export interface PageConfig {
  route: string;
  role: string;
  title: string;
  singularTitle: string;
  activeSection: string;
  layout: "AdminLayout" | "PanelLayout";
  componentName: string;
  apiEndpoint: string;
  table: string;
  description: string;
  pageType: "crud" | "readonly" | "dashboard" | "operations" | "report";
  logToJunta: boolean;
  pkField: string;
  listFields: string[];
  formFields: string[];
  statsFields?: { label: string; field: string; type: "count" | "sum" | "filter"; filterValue?: string }[];
  searchFields: string[];
  filters?: { label: string; field: string; options: { value: string; label: string }[] }[];
  emptyMessage: string;
}

// Lightweight PagePlan for use in plans/*.ts files
export interface PagePlan {
  route: string;
  role: string;
  title: string;
  description: string;
  ui: "crud" | "dashboard" | "readonly" | "operations";
  apiEndpoint: string;
  apiMethods: string[];
  features: string[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface EngineState {
  pages: PageConfig[];
  generated: GeneratedFile[];
  errors: { page: string; error: string }[];
}

export function getTableSchema(tableName: string): TableSchema {
  // Try to read schema from project migrations
  const schema = detectSchemaFromMigrations(tableName);
  if (schema) return schema;

  console.warn(`  ⚠ Tabla "${tableName}" no encontrada en migraciones. Define sus columnas en mvp-pages.ts`);
  return { name: tableName, columns: [] };
}

function detectSchemaFromMigrations(tableName: string): TableSchema | null {
  const configPath = new URL("../config.ts", import.meta.url).pathname;
  try {
    const config = require(configPath)?.CONFIG;
    const migrationsDir = config?.paths?.migrationsDir || findMigrationsDir();
    if (!migrationsDir || !fs.existsSync(migrationsDir)) return null;

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const columns = parseCreateTable(content, tableName);
      if (columns) return { name: tableName, columns };
    }
    return null;
  } catch {
    return null;
  }
}

function findMigrationsDir(): string | null {
  const candidates = ["database/migrations", "migrations", "supabase/migrations", "prisma/migrations", "db/migrations"];
  const cwd = process.cwd();
  for (const dir of candidates) {
    const full = path.join(cwd, dir);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function parseCreateTable(sql: string, tableName: string): ColumnDef[] | null {
  const regex = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:\\w+\\.)?\\"?${tableName}\\"?(?:\\s*\\()([^;]+)\\)`, "ims");
  const match = sql.match(regex);
  if (!match) return null;

  const columns: ColumnDef[] = [];
  const lines = match[1].split(",");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|INDEX|CHECK|CREATE|\))"/i.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const name = parts[0].replace(/["`]/g, "");
    const rawType = parts[1].toUpperCase();
    const isPrimary = /PRIMARY/i.test(trimmed);
    const nullable = !/NOT\s+NULL/i.test(trimmed) && !isPrimary;
    const isEnum = rawType === "TEXT" && /CHECK\s*\(.*\bIN\b/i.test(trimmed);
    const isForeignKey = /REFERENCES/i.test(trimmed);

    let type = "string";
    if (/INT|INTEGER|BIGINT|SMALLINT/.test(rawType)) type = "number";
    else if (/REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/.test(rawType)) type = "number";
    else if (/BOOL|BOOLEAN/.test(rawType)) type = "boolean";

    if (isPrimary && (name === "id" || name.endsWith("_id"))) type = "string";

    columns.push({ name, type, nullable, isPrimary, isForeignKey });
  }

  return columns.length > 0 ? columns : null;
}
