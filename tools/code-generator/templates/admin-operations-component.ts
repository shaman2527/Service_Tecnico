import type { PageConfig } from "../types";

export function generateAdminOperationsComponent(page: PageConfig): string {
  return `import React, { useState } from "react";
import { Upload, FileSpreadsheet, Check, Loader, AlertCircle } from "lucide-react";

export const ${page.componentName} = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/${page.apiEndpoint}", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setResult({ success: true, message: data.message || "Archivo procesado exitosamente" });
        setFile(null);
      } else {
        setResult({ success: false, message: data.error || "Error al procesar archivo" });
      }
    } catch {
      setResult({ success: false, message: "Error de conexión al servidor" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <FileSpreadsheet size={48} className="mx-auto text-primary mb-4" />
        <h2 className="text-lg font-semibold text-card mb-2">${page.title}</h2>
        <p className="text-sm text-gray-400 mb-6">${page.description}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => document.getElementById("file-upload")?.click()}
          >
            <input
              id="file-upload"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="space-y-2">
                <Check size={24} className="mx-auto text-emerald-500" />
                <p className="text-sm font-medium text-card">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload size={24} className="mx-auto text-gray-400" />
                <p className="text-sm text-gray-500">Haz clic para seleccionar un archivo CSV o Excel</p>
                <p className="text-xs text-gray-400">Formatos: .csv, .xlsx, .xls</p>
              </div>
            )}
          </div>

          {file && (
            <button
              type="submit"
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <><Loader size={16} className="animate-spin" /> Procesando...</>
              ) : (
                <><Upload size={16} /> Subir y procesar</>
              )}
            </button>
          )}
        </form>

        {result && (
          <div className={"mt-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm " + (result.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
            {result.success ? <Check size={16} /> : <AlertCircle size={16} />}
            {result.message}
          </div>
        )}
      </div>

      <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4">
        <h4 className="text-sm font-medium text-amber-800 mb-2">Instrucciones</h4>
        <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
          <li>El archivo debe tener una fila de encabezados</li>
          <li>Las columnas deben coincidir con los campos de la tabla</li>
          <li>Máximo 500 registros por carga</li>
          <li>Los datos se validarán antes de insertar</li>
        </ul>
      </div>
    </div>
  );
};

export default ${page.componentName};
`;
}
