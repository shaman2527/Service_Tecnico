import type { PageConfig } from "../types";
import { getTableSchema } from "../types";
import { capitalize, fieldLabel } from "../lib/template-helpers";

export function generateAdminReadonlyComponent(page: PageConfig): string {
  const schema = getTableSchema(page.table);
  const tableName = page.table;
  const pk = page.pkField;

  const listCols = schema.columns.filter(c => page.listFields.includes(c.name));

  const interfaceFields = listCols
    .filter(c => c.name !== pk)
    .map(c => {
      const tsType = c.type === "boolean" ? "boolean" : c.type === "number" ? "number" : "string";
      return `  ${c.name}: ${tsType}${c.nullable ? " | null" : ""};`;
    })
    .join("\n");

  const tableHeaders = listCols
    .filter(c => c.name !== pk)
    .map(c => `                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">${fieldLabel(c.name)}</th>`)
    .join("\n");

  const tableCells = listCols
    .filter(c => c.name !== pk)
    .map((c, i) => {
      const name = c.name;
      if (c.name === "created_at" || c.name === "fecha_publicacion") {
        return `                <td className="py-2.5 px-3 text-gray-500 text-xs">
                  {item.${name} ? new Date(item.${name}).toLocaleDateString("es-VE") : "—"}
                </td>`;
      }
      if (name === "descripcion") {
        return `                <td className="py-2.5 px-3 text-gray-700">
                  <span className="text-sm leading-relaxed">{item.${name}}</span>
                </td>`;
      }
      if (c.isEnum) {
        return `                <td className="py-2.5 px-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    {item.${name}}
                  </span>
                </td>`;
      }
      return `                <td className="py-2.5 px-3 text-gray-700">{item.${name}}</td>`;
    })
    .join("\n");

  return `import React, { useState, useEffect, useCallback } from "react";
import { Search, Loader } from "lucide-react";

interface ${capitalize(tableName)}Item {
  ${pk}: string;
${interfaceFields}
}

export const ${page.componentName} = () => {
  const [items, setItems] = useState<${capitalize(tableName)}Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const res = await fetch(\`/api/${page.apiEndpoint}?\${params}\`);
      if (!res.ok) throw new Error("Error al cargar");
      const data: ${capitalize(tableName)}Item[] = await res.json();
      setItems(data);
    } catch {
      setError("Error al cargar ${page.title.toLowerCase()}");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    return ${page.searchFields.map(f => `(item.${f} && item.${f}.toLowerCase().includes(q))`).join(" || ")};
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader size={24} className="animate-spin mr-3" />
        Cargando ${page.title.toLowerCase()}...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-red-500 text-sm bg-red-50 py-2.5 px-4 rounded-xl">{error}</p>
      )}

      {/* Search */}
      <div className="relative max-w-xs">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-gray-100">
              <tr>
${tableHeaders}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.${pk}} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
${tableCells}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={${listCols.length}} className="py-12 text-center text-gray-400">
                    ${page.emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ${page.componentName};
`;
}
