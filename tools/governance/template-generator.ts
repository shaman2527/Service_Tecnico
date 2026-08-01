import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { PatternMatch } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesDir = path.resolve(__dirname, "../code-generator/templates");
const engineFile = path.resolve(__dirname, "../code-generator/engine.ts");

export function generatePanelComponentTemplate(): string {
  return `import type { PageConfig, ColumnDef } from "../types";
import { getTableSchema } from "../types";
import { capitalize, fieldLabel } from "../lib/template-helpers";

export function generatePanelComponent(page: PageConfig): string {
  const schema = getTableSchema(page.table);
  const pk = page.pkField;

  const listCols = schema.columns.filter(c => page.listFields.includes(c.name) && c.name !== pk);

  const interfaceFields = listCols.map(c => {
    const tsType = c.type === "boolean" ? "boolean" : c.type === "number" ? "number" : "string";
    return \`  \${c.name}: \${tsType}\${c.nullable ? " | null" : ""};\`;
  }).join("\\n");

  const tableHeaders = listCols.map(c =>
    \`                <th class="text-left py-3 px-3 font-medium text-gray-500 text-xs">\${fieldLabel(c.name)}</th>\`
  ).join("\\n");

  const tableCells = listCols.map(c => {
    const name = c.name;
    if (c.name === "created_at" || c.name === "fecha_emision") {
      return \`                <td class="py-2.5 px-3 text-gray-500 text-xs">
                  {item.\${name} ? new Date(item.\${name}).toLocaleDateString("es-VE") : "—"}
                </td>\`;
    }
    if (c.type === "number" && (name.includes("monto") || name.includes("saldo"))) {
      return \`                <td class="py-2.5 px-3">
                  <span class="text-gray-700 font-mono tabular-nums">{"\$"}{(item.\${name} ?? 0).toFixed(2)}</span>
                </td>\`;
    }
    if (c.isEnum) {
      return \`                <td class="py-2.5 px-3">
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    {item.\${name}}
                  </span>
                </td>\`;
    }
    return \`                <td class="py-2.5 px-3 text-gray-700">{item.\${name}}</td>\`;
  }).join("\\n");

  return \`import React, { useState, useEffect, useCallback } from "react";
import { Search, Loader } from "lucide-react";

interface \${capitalize(page.table)}Item {
  \${pk}: string;
\${interfaceFields}
}

export const \${page.componentName} = () => {
  const [items, setItems] = useState<\${capitalize(page.table)}Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(\`/api/\${page.apiEndpoint}\`);
      if (!res.ok) throw new Error("Error al cargar");
      const data: \${capitalize(page.table)}Item[] = await res.json();
      setItems(data);
    } catch {
      setError("Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  if (loading) {
    return (
      <div class="flex items-center justify-center py-20 text-gray-400">
        <Loader size={24} class="animate-spin mr-3" />
        Cargando...
      </div>
    );
  }

  return (
    <div class="space-y-6">
      {error && <p class="text-red-500 text-sm bg-red-50 py-2.5 px-4 rounded-xl">{error}</p>}
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="border-b border-gray-100 bg-white">
            <tr>
\${tableHeaders}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.\${pk}} class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
\${tableCells}
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={\${listCols.length}} class="py-12 text-center text-gray-400">
                  \${page.emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default \${page.componentName};
\`;
}
`;
}

export function writeTemplateFile(name: string, content: string): boolean {
  const filePath = path.join(templatesDir, name);
  if (fs.existsSync(filePath)) {
    console.log(`  ⏭️  Template ${name} already exists, skipping`);
    return false;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  ✅ Created template: ${name}`);
  return true;
}
