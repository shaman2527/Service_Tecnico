import type { PageConfig } from "../types";

export function generateAdminDashboardComponent(page: PageConfig): string {
  const hasStats = page.statsFields && page.statsFields.length > 0;
  const statBlocks = (page.statsFields || []).map(s => {
    let valExpr: string;
    if (s.type === "count") valExpr = `items.length`;
    else if (s.type === "filter") valExpr = `items.filter((i) => (i as any)["${s.field}"] && (i as any)["${s.field}"] !== null).length`;
    else valExpr = `items.reduce((sum, i) => sum + ((i as any)["${s.field}"] ?? 0), 0)`;
    return `              <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center shadow-sm">
                <p className="text-3xl font-bold text-card">{${valExpr}}</p>
                <p className="text-sm text-gray-400 mt-1">${s.label}</p>
              </div>`;
  }).join("\n");

  return `import React, { useState, useEffect } from "react";
import { BarChart3, Loader } from "lucide-react";

interface DashboardItem {
  [key: string]: unknown;
}

export const ${page.componentName} = () => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DashboardItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/${page.apiEndpoint}");
        if (!res.ok) throw new Error("Error al cargar datos");
        const data = await res.json();
        if (Array.isArray(data)) setItems(data);
      } catch {
        setError("Error al cargar estadísticas");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader size={24} className="animate-spin mr-3" />
        Cargando dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <p className="text-red-500 text-sm bg-red-50 py-2.5 px-4 rounded-xl">{error}</p>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
${statBlocks}
      </div>

      {/* Placeholder for charts */}
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
        <BarChart3 size={48} className="mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-card mb-2">Dashboard de Estadísticas</h3>
        <p className="text-sm text-gray-400">Gráficos y análisis detallados próximamente.</p>
      </div>
    </div>
  );
};

export default ${page.componentName};
`;
}
