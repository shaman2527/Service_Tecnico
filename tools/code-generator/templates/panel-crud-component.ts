import type { PageConfig, ColumnDef } from "../types";
import { getTableSchema } from "../types";
import { fieldLabel } from "../lib/template-helpers";

function fieldType(col: ColumnDef): string {
  if (col.isEnum) return "select";
  if (col.type === "boolean") return "checkbox";
  if (col.name === "contenido" || col.name === "descripcion") return "textarea";
  if (col.type === "number") return "number";
  return "text";
}

function tableCell(col: ColumnDef, pkField: string): string {
  const name = col.name;
  const pk = pkField;
  const start = '                <td className="py-2.5 px-3">';
  const end = "                </td>";

  if (col.isEnum) {
    return start + `
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    {item.${name}}
                  </span>
` + end;
  }

  if (col.type === "boolean") {
    return start + `
                  <span className={item.${name} ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1"}>
                    {item.${name} ? "Sí" : "No"}
                  </span>
` + end;
  }

  if (col.name === "created_at" || col.name === "fecha_publicacion" || col.name === "fecha_emision" || col.name === "fecha_vencimiento" || col.name === "fecha_apertura" || col.name === "fecha_cierre") {
    return start + `
                  {item.${name} ? new Date(item.${name}).toLocaleDateString("es-VE") : "—"}
` + end;
  }

  if (col.type === "number" && (col.name.includes("monto") || col.name.includes("saldo"))) {
    return start + `
                  <span className="text-gray-500 font-mono tabular-nums">{"$"}{(item.${name} ?? 0).toFixed(2)}</span>
` + end;
  }

  if (name === "contenido" || name === "descripcion") {
    return start + `
                  {item.${name}?.substring(0, 100)}{item.${name}?.length > 100 ? "..." : ""}
` + end;
  }

  return start + `
                  {item.${name}}
` + end;
}

function formField(col: ColumnDef): string {
  const name = col.name;
  const label = fieldLabel(name);

  if (col.isEnum) {
    return `            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">${label}</label>
              <select
                value={form.${name}}
                onChange={(e) => setForm({ ...form, ${name}: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white"
              >
                <option value="">Seleccionar...</option>
                ${col.isEnum!.map(v => `                <option value="${v}">${v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ")}</option>`).join("\n")}
              </select>
            </div>`;
  }

  if (col.type === "boolean") {
    return `            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.${name} ?? false}
                onChange={(e) => setForm({ ...form, ${name}: e.target.checked })}
                className="rounded border-gray-300 text-primary focus:ring-primary/40"
              />
              <span className="text-sm text-gray-700">${label}</span>
            </label>`;
  }

  if (name === "contenido" || name === "descripcion") {
    return `            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">${label}</label>
              <textarea
                value={form.${name}}
                onChange={(e) => setForm({ ...form, ${name}: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                required
              />
            </div>`;
  }

  if (col.type === "number") {
    return `            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">${label}</label>
              <input
                type="number"
                value={form.${name}}
                onChange={(e) => setForm({ ...form, ${name}: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>`;
  }

  return `            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">${label}</label>
              <input
                type="${fieldType(col)}"
                value={form.${name} ?? ""}
                onChange={(e) => setForm({ ...form, ${name}: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                ${!col.nullable && name !== "imagen_url" ? "required" : ""}
              />
            </div>`;
}

function tableCellInlineEdit(col: ColumnDef, pkField: string): string {
  const name = col.name;
  const pk = pkField;
  const start = '                <td className="py-2.5 px-3">';
  const end = "                </td>";

  if (col.isEnum) {
    const opts = col.isEnum.map(v => `                        <option value="${v}">${v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ")}</option>`).join("\n");
    const editField = `                      <select
                        value={edit.${name} ?? ""}
                        onChange={(e) => setEdit({ ...edit, ${name}: e.target.value })}
                        className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white"
                      >
                        <option value="">—</option>
${opts}
                      </select>`;
    return start + `
                  <div className="flex items-center gap-2">
                    {edit?.${pk} === item.${pk} ? (
${editField}
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {item.${name}}
                      </span>
                    )}
                  </div>
` + end;
  }

  if (col.type === "boolean") {
    return start + `
                  <div className="flex items-center gap-2">
                    {edit?.${pk} === item.${pk} ? (
                      <input
                        type="checkbox"
                        checked={edit.${name} ?? false}
                        onChange={(e) => setEdit({ ...edit, ${name}: e.target.checked })}
                        className="rounded border-gray-300 text-primary focus:ring-primary/40"
                      />
                    ) : (
                      <span className={item.${name} ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full text-xs font-medium"}>
                        {item.${name} ? "Sí" : "No"}
                      </span>
                    )}
                  </div>
` + end;
  }

  if (col.nullable || true) {
    let editField: string;
    if (col.type === "number") {
      editField = `                      <input
                        type="number"
                        value={edit.${name} ?? ""}
                        onChange={(e) => setEdit({ ...edit, ${name}: e.target.value ? Number(e.target.value) : null })}
                        className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />`;
    } else if (name === "contenido" || name === "descripcion") {
      editField = `                      <textarea
                        value={edit.${name} ?? ""}
                        onChange={(e) => setEdit({ ...edit, ${name}: e.target.value })}
                        rows={2}
                        className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                      />`;
    } else {
      editField = `                      <input
                        type="text"
                        value={edit.${name} ?? ""}
                        onChange={(e) => setEdit({ ...edit, ${name}: e.target.value })}
                        className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />`;
    }
    return start + `
                  <div className="flex items-center gap-2">
                    {edit?.${pk} === item.${pk} ? (
${editField}
                    ) : (
                      <span>{item.${name} || "—"}</span>
                    )}
                  </div>
` + end;
  }

  return start + `{item.${name}}` + end;
}

export function generatePanelCrudComponent(page: PageConfig): string {
  const schema = getTableSchema(page.table);
  const tableName = page.table;
  const pk = page.pkField;
  const singular = page.singularTitle;
  const isReadonly = page.pageType === "readonly";

  const listCols = schema.columns.filter(c => page.listFields.includes(c.name) && c.name !== "apartamento_id");
  const formCols = schema.columns.filter(c => page.formFields.includes(c.name) && c.name !== page.pkField && c.name !== "apartamento_id");

  const interfaceFields = schema.columns
    .filter(c => c.name !== page.pkField && (page.listFields.includes(c.name) || page.formFields.includes(c.name)))
    .map(c => {
      if (c.name === "apartamento_id") return "";
      const tsType = c.type === "boolean" ? "boolean" : c.type === "number" ? "number" : "string";
      return `  ${c.name}: ${tsType}${c.nullable ? " | null" : ""};`;
    })
    .filter(Boolean)
    .join("\n");

  const formStateFields = formCols
    .map(c => {
      const tsType = c.type === "boolean" ? "boolean" : c.type === "number" ? "number" : "string";
      return `  ${c.name}: ${tsType}${c.nullable ? " | null" : ""};`;
    })
    .join("\n");

  const formDefaults = formCols
    .map(c => `  ${c.name}: ${c.nullable || c.type === "boolean" ? (c.type === "boolean" ? "false" : "null") : (c.isEnum ? '""' : '""')},`)
    .join("\n");

  const formFieldRenders = formCols.map(c => formField(c)).join("\n\n");
  const tableHeaders = listCols.map(c => `                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">${fieldLabel(c.name)}</th>`).join("\n");
  const tableCells = listCols.map((c, i) => {
    if (isReadonly) return tableCell(c, pk);
    return tableCellInlineEdit(c, pk);
  }).join("\n");

  const requiredFields = formCols.filter(c => !c.nullable && c.type === "string" && c.name !== page.pkField && c.name !== "contenido" && c.name !== "descripcion");
  const validationChecks = requiredFields.length > 0
    ? requiredFields.map(f => `      if (!form.${f.name}) { setError("${fieldLabel(f.name)} es requerido"); return; }`).join("\n")
    : `      // No required string fields to validate`;

  const statBlocks = (page.statsFields || []).map(s => {
    let valExpr: string;
    if (s.type === "count") valExpr = `items.length`;
    else if (s.type === "filter") valExpr = `items.filter((i) => i.${s.field} ${s.filterValue === "true" ? "=== true" : "!== true"}).length`;
    else valExpr = `items.reduce((sum, i) => sum + (i.${s.field} ?? 0), 0)`;
    return `        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-card">${valExpr}</p>
          <p className="text-xs text-gray-400">${s.label}</p>
        </div>`;
  }).join("\n");

  const tableHeaderCount = listCols.length + (isReadonly ? 0 : 1);

  if (isReadonly) {
    return `import React, { useState, useEffect, useCallback } from "react";
import { Search, Loader } from "lucide-react";

interface ${page.componentName.replace("Panel", "")}Item {
  ${pk}: string;
${interfaceFields}
}

export const ${page.componentName} = () => {
  const [items, setItems] = useState<${page.componentName.replace("Panel", "")}Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const res = await fetch(\`/api/${page.apiEndpoint}?\${params}\`);
      if (!res.ok) throw new Error("Error al cargar");
      const data: ${page.componentName.replace("Panel", "")}Item[] = await res.json();
      setItems(data);
    } catch {
      setError("Error al cargar ${singular.toLowerCase()}");
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
        Cargando ${singular.toLowerCase()}...
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
                  <td colSpan={${tableHeaderCount}} className="py-12 text-center text-gray-400">
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

  return `import React, { useState, useEffect, useCallback } from "react";
import { Search, Plus, Pencil, Check, X, Loader } from "lucide-react";

interface ${page.componentName.replace("Panel", "")}Item {
  ${pk}: string;
${interfaceFields}
}

interface FormState {
${formStateFields}
}

export const ${page.componentName} = () => {
  const [items, setItems] = useState<${page.componentName.replace("Panel", "")}Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState>({
${formDefaults}
  });

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const res = await fetch(\`/api/${page.apiEndpoint}?\${params}\`);
      if (!res.ok) throw new Error("Error al cargar");
      const data: ${page.componentName.replace("Panel", "")}Item[] = await res.json();
      setItems(data);
    } catch {
      setError("Error al cargar ${singular.toLowerCase()}");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
${validationChecks}
    setSavingId("new");
    setError("");
    try {
      const res = await fetch("/api/${page.apiEndpoint}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error al crear");
      }
      setSuccessMsg("${singular} creado exitosamente");
      setShowForm(false);
      setForm({${formDefaults.replace(/\n/g, "\n      ")}
      });
      fetchItems();
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear");
    } finally {
      setSavingId(null);
    }
  };

  const startEdit = (item: ${page.componentName.replace("Panel", "")}Item) => {
    setEdit({
      ${pk}: item.${pk} ?? "",
${formCols.filter(c => c.name !== page.pkField).map(c => `      ${c.name}: item.${c.name} ?? ${c.type === "boolean" ? "false" : c.type === "number" ? "0" : '""'},`).join("\n")}
    });
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSavingId("edit");
    setError("");
    try {
      const res = await fetch("/api/${page.apiEndpoint}", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error al actualizar");
      }
      setItems((prev) =>
        prev.map((i) =>
          i.${pk} === edit.${pk} ? { ...i, ...edit } : i
        )
      );
      setEdit(null);
      setSuccessMsg("${singular} actualizado");
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setSavingId(null);
    }
  };

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    return ${page.searchFields.map(f => `(item.${f} && item.${f}.toLowerCase().includes(q))`).join(" || ")};
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader size={24} className="animate-spin mr-3" />
        Cargando ${singular.toLowerCase()}...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="bg-emerald-50 text-emerald-700 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
          <Check size={16} /> {successMsg}
        </div>
      )}

${page.statsFields && page.statsFields.length > 0 ? `      {/* Stats */}
      <div className="grid grid-cols-${Math.min(page.statsFields.length, 4)} gap-4">
${statBlocks}
      </div>
` : ""}
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} />
          Nuevo ${singular}
        </button>
      </div>

      {error && (
        <p className="text-red-500 text-sm bg-red-50 py-2.5 px-4 rounded-xl">{error}</p>
      )}

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-card">Nuevo ${singular}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
${formFieldRenders}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={savingId === "new"}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {savingId === "new" ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-white">
              <tr>
${tableHeaders}
                <th className="text-center py-3 px-3 font-medium text-gray-500 text-xs">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.${pk}} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
${tableCells}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center justify-center gap-1">
                      {edit?.${pk} === item.${pk} ? (
                        <>
                          <button
                            onClick={saveEdit}
                            disabled={savingId === "edit"}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title="Guardar"
                          >
                            {savingId === "edit" ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                          </button>
                          <button
                            onClick={() => setEdit(null)}
                            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                            title="Cancelar"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(item)}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={${tableHeaderCount}} className="py-12 text-center text-gray-400">
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
