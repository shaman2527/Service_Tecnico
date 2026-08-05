import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Product, Service, ServicePayment } from '../types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Iniciales de un nombre ("Luis Felipe" → "LF"); fallback cuando no hay nombre.
 *  Fuente única: usado por Services.tsx, Clients.tsx y Dashboard (stats por técnico). */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

// Métodos de pago en bolívares: Efectivo Bs, Pago Móvil, Transferencia Bs, Punto de Venta (Bs)
export function isBsMethod(m: string | null | undefined): boolean {
  if (!m) return false;
  if (m.includes('USD') || m.includes('Zelle') || m.includes('$')) return false;
  return true;
}

export function methodCurrency(m: string | null | undefined): 'USD' | 'VES' {
  return isBsMethod(m) ? 'VES' : 'USD';
}

export function currencySymbol(c: string | null | undefined): string {
  return c === 'VES' || c === 'Bs' ? 'Bs.' : '$';
}

// --- Garantía: 7 días corridos desde la fecha de entrega ---
export const WARRANTY_DAYS = 7;

const fmtYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Fecha límite de garantía (entrega + 7 días) o null si no hay fecha de salida
export function warrantyEnd(dateOut: string | null | undefined, days = WARRANTY_DAYS): string | null {
  if (!dateOut) return null;
  const d = new Date(`${dateOut.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return fmtYmd(d);
}

// 'sin' (no entregado/sin fecha) | 'activa' (hoy ≤ vencimiento) | 'vencida'
export function warrantyStatus(dateOut: string | null | undefined, days = WARRANTY_DAYS): 'sin' | 'activa' | 'vencida' {
  const end = warrantyEnd(dateOut, days);
  if (!end) return 'sin';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return new Date(`${end}T00:00:00`).getTime() >= today ? 'activa' : 'vencida';
}

// --- Checklist de blindaje del equipo (10 ítems) ---
export const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: 'chip_sim', label: 'Chip (SIM) presente' },
  { key: 'tapa_trasera', label: 'Tapa trasera en buen estado' },
  { key: 'bandeja_sim', label: 'Bandeja SIM presente' },
  { key: 'botones', label: 'Botones (volumen/encendido) funcionan' },
  { key: 'boton_home', label: 'Botón home/navegación (si aplica)' },
  { key: 'camara', label: 'Cámara (lente) sin daños' },
  { key: 'puerto_carga', label: 'Puerto de carga funciona' },
  { key: 'parlante', label: 'Parlante/micrófono funcionan' },
  { key: 'contrasena', label: 'Contraseña/patrón entregada por el cliente' },
  { key: 'accesorios', label: 'Accesorios entregados (funda, protector)' },
];

export function parseChecklist(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function checklistSummary(json: string | null | undefined): string {
  const parsed = parseChecklist(json);
  const total = Object.keys(parsed).length;
  if (total === 0) return 'Sin revisión registrada';
  return `${total} de ${CHECKLIST_ITEMS.length} ítems revisados`;
}

// --- Tipos de trabajo / fallas (múltiples por servicio) ---
export const SERVICE_TYPES = [
  'Cambio pantalla', 'Cambio batería', 'Cambio flex', 'Cambio conector / puerto',
  'Reparación (placa)', 'Limpieza / Mantenimiento', 'Software / Formateo',
  'Cambio cámara', 'Cambio parlante / micrófono', 'Otro',
];

// Lista de TODOS los trabajos/fallas de un servicio.
// service_types es un JSON array; las filas viejas solo tienen service_type (primario).
export function parseServiceTypes(sv: { service_type?: string | null; service_types?: string | null }): string[] {
  if (sv.service_types) {
    try {
      const parsed = JSON.parse(sv.service_types);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
      }
    } catch { /* fallback a service_type */ }
  }
  if (sv.service_type && sv.service_type.trim()) return [sv.service_type.trim()];
  return [];
}

// --- Modelos de teléfono (lista maestra derivada del catálogo) ---
// Normaliza: minúsculas, sin acentos, solo letras/números (consistente con norm_model del backend).
export function normPhoneModel(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface PhoneModelEntry {
  label: string;
  norm: string;
  products: Product[];
}

function parseCompatList(compat: string | null | undefined): string[] {
  if (!compat) return [];
  try {
    const l = JSON.parse(compat);
    if (Array.isArray(l)) return l.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean);
  } catch { /* plain text */ }
  return compat.split('/').map(s => s.trim()).filter(Boolean);
}

// Nombre corto de un repuesto: sin el prefijo de categoría (Pantalla / Táctil).
export function partLabel(p: Product): string {
  const base = p.name.replace(/^(Pantalla|Táctil Tablet|Táctil)\s+/i, '').split('/')[0].trim() || p.name;
  if (p.variant && !base.toLowerCase().includes(p.variant.toLowerCase())) {
    return `${base} (${p.variant})`;
  }
  return base;
}

// Lista maestra de modelos de teléfono: derivada de compatibility (lista curada por
// producto). model/name NO se usan como fuente: duplican el teléfono sin marca
// (compat "Tecno SPARK 10 PRO" + model "SPARK 10 PRO" -> 2 teléfonos) o con la
// variante del repuesto (ej. "(INCELL)"). Fallback: compat vacía -> model -> nombre.
export function buildPhoneModels(catalog: Product[]): PhoneModelEntry[] {
  const byNorm = new Map<string, PhoneModelEntry>();
  const pushCandidate = (raw: string, product: Product) => {
    const parts = raw.split('/');
    const cands = parts.length > 1
      ? [raw.trim(), ...parts.map(s => s.trim()).filter(Boolean)]
      : [raw.trim()];
    for (const cand of cands) {
      if (!cand) continue;
      const norm = normPhoneModel(cand);
      if (!norm) continue;
      let entry = byNorm.get(norm);
      if (!entry) {
        entry = { label: cand, norm, products: [] };
        byNorm.set(norm, entry);
      } else if (cand.length > entry.label.length) {
        // label canónico = la forma más completa (normalmente con marca)
        entry.label = cand;
      }
      if (!entry.products.some(p => p.id === product.id)) {
        entry.products.push(product);
      }
    }
  };
  for (const p of catalog) {
    const compat = parseCompatList(p.compatibility);
    if (compat.length > 0) {
      for (const m of compat) pushCandidate(m, p);
    } else if (p.model) {
      pushCandidate(p.model, p);
    } else {
      pushCandidate(p.name.replace(/^(Pantalla|Táctil Tablet|Táctil)\s+/i, ''), p);
    }
  }
  return [...byNorm.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// --- Factura térmica (impresora COM / ESC/POS) ---

// Ancho de caracteres del ticket: 58mm ≈ 32 chars, 80mm ≈ 48 chars.
export function printerWidthChars(widthMm: number | null | undefined): number {
  return (widthMm ?? 58) >= 80 ? 48 : 32;
}

const fmtUsd = (n: number) => `$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBs = (n: number) => `Bs. ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtMoney = (n: number, cur: string | null | undefined) => (cur === 'VES' ? fmtBs(n) : fmtUsd(n));

// Recorta a caracteres sin cortar el texto por la mitad de una manera fea (wrap limpio)
function wrapText(text: string, w: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= w) return clean ? [clean] : [''];
  const words = clean.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if ((cur + ' ' + word).trim().length > w) {
      if (cur) lines.push(cur.trim());
      if (word.length > w) {
        // palabra larga: cortar por chunk
        let rest = word;
        while (rest.length > w) {
          lines.push(rest.slice(0, w));
          rest = rest.slice(w);
        }
        cur = rest;
      } else {
        cur = word;
      }
    } else {
      cur = (cur + ' ' + word).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function center(text: string, w: number): string {
  if (text.length >= w) return text.slice(0, w);
  const left = Math.floor((w - text.length) / 2);
  return ' '.repeat(left) + text;
}

function kv(label: string, value: string, w: number): string[] {
  const lines = wrapText(value, w - label.length - 2);
  const out: string[] = [];
  out.push(`${label}: ${lines[0] ?? ''}`.slice(0, w));
  for (const rest of lines.slice(1)) out.push(' '.repeat(label.length + 2) + rest);
  return out;
}

/**
 * Construye la factura del servicio como texto plano de ancho fijo (ticket térmico).
 * Pura y sin IO: el frontend la previsualiza y el backend (ESC/POS + CP850) la imprime.
 */
export function buildServiceReceipt(
  service: Service | null | undefined,
  payments: ServicePayment[] = [],
  opts: { width?: number; tasaBcv?: number } = {},
): string {
  if (!service) return '';
  const w = printerWidthChars(opts.width);
  const dash = '-'.repeat(w);
  const lines: string[] = [];

  lines.push(center('REGISTRO', w));
  lines.push(center('SERVICIO TECNICO', w));
  lines.push('='.repeat(w));
  lines.push(center('FACTURA DE SERVICIO', w));
  lines.push(dash);

  // Orden y fechas
  for (const l of kv('ORDEN', service.order_num ?? '', w)) lines.push(l);
  for (const l of kv('FECHA', service.date_in?.slice(0, 16) ?? '', w)) lines.push(l);
  for (const l of kv('ESTADO', service.status ?? '', w)) lines.push(l);
  lines.push(dash);

  // Cliente
  if (service.client) for (const l of kv('CLIENTE', service.client, w)) lines.push(l);
  if (service.client_ci) for (const l of kv('CEDULA', service.client_ci, w)) lines.push(l);
  if (service.phone) for (const l of kv('TELEFONO', service.phone, w)) lines.push(l);
  if (service.client_address) for (const l of kv('DIRECCION', service.client_address, w)) lines.push(l);
  lines.push(dash);

  // Equipo y diagnóstico
  if (service.model) for (const l of kv('EQUIPO', service.model, w)) lines.push(l);
  const tipos = parseServiceTypes(service);
  for (const t of tipos) for (const l of kv('TRABAJO', t, w)) lines.push(l);
  if (service.technician) for (const l of kv('TECNICO', service.technician, w)) lines.push(l);
  if (service.fault) {
    lines.push('FALLA:');
    for (const l of wrapText(service.fault, w - 2)) lines.push(' ' + l);
  }
  if (service.observations) {
    lines.push(dash);
    for (const l of kv('NOTAS', service.observations, w)) lines.push(l);
  }
  lines.push(dash);

  // Finanzas
  for (const l of kv('MONTO', fmtUsd(service.amount), w)) lines.push(l);
  const abonado = service.paid_amount ?? 0;
  const saldo = service.amount - abonado;
  if (abonado > 0.005) for (const l of kv('ABONADO', fmtUsd(abonado), w)) lines.push(l);
  if (saldo <= 0.005) {
    lines.push(center('CANCELADO', w));
  } else {
    for (const l of kv('SALDO', fmtUsd(saldo), w)) lines.push(l);
  }
  if (service.payment_method) for (const l of kv('METODO', service.payment_method, w)) lines.push(l);
  if (service.zelle_reference) for (const l of kv('REF', service.zelle_reference, w)) lines.push(l);

  // Abonos detallados (si hay más de uno se muestran con su moneda y método)
  if (payments.length > 0) {
    lines.push(dash);
    for (const p of payments) {
      const line = `${fmtMoney(p.amount, p.currency)} ${p.payment_method ?? ''}`.trim();
      for (const l of wrapText(line, w - 2)) lines.push('  ' + l);
    }
  }

  // Garantía (7 días desde la entrega)
  const gar = warrantyEnd(service.date_out);
  if (gar) {
    lines.push(dash);
    for (const l of kv('GARANTIA', `hasta ${gar}`, w)) lines.push(l);
  }

  lines.push('='.repeat(w));
  lines.push(center('Gracias por su preferencia', w));
  return lines.join('\n');
}
