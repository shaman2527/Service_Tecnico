export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const LABEL_MAP: Record<string, string> = {
  titulo: "Título",
  categoria: "Categoría",
  contenido: "Contenido",
  imagen_url: "URL de Imagen",
  fijo: "Fijo",
  visible: "Visible",
  fecha_publicacion: "Fecha de Publicación",
  fecha_expiracion: "Fecha de Expiración",
  nombre: "Nombre",
  telefono: "Teléfono",
  orden: "Orden",
  clave: "Clave",
  valor: "Valor",
  accion: "Acción",
  descripcion: "Descripción",
  contexto: "Contexto",
  realizado_por_nombre: "Realizado Por",
  ip_origen: "IP Origen",
  created_at: "Creado",
  updated_at: "Actualizado",
  periodo: "Período",
  concepto: "Concepto",
  monto: "Monto",
  fecha_emision: "Emisión",
  fecha_vencimiento: "Vencimiento",
  estado: "Estado",
  referencia_pago: "Referencia",
  pdf_url: "PDF",
  tabla_afectada: "Tabla",
  campo_modificado: "Campo",
  motivo: "Motivo",
  valor_anterior: "Valor Anterior",
  valor_nuevo: "Valor Nuevo",
  modificado_por_nombre: "Modificado Por",
  id: "ID",
  nombre_completo: "Nombre",
  cedula: "Cédula",
  referencia: "Referencia",
  metodo: "Método",
};

export function fieldLabel(name: string): string {
  return LABEL_MAP[name] || name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export function tsType(type: string, nullable: boolean): string {
  const t = type === "boolean" ? "boolean" : type === "number" ? "number" : "string";
  return nullable ? `${t} | null` : t;
}
