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

// --- Nombres de personas ---
// "roberth silva" → "Roberth Silva" (coincide con title_case del backend).
export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
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

// Ancho de la LETRA PEQUEÑA (font B ESC/POS, más estrecha): 58mm ≈ 42 chars, 80mm ≈ 64 chars.
export function printerSmallWidthChars(widthMm: number | null | undefined): number {
  return (widthMm ?? 58) >= 80 ? 64 : 42;
}

// Condiciones del servicio impresas en letra pequeña en la PRIMERA copia de la
// orden (antes del talón CORTA TIJERA) — resguardo legal del técnico: aceptación
// y conformidad al firmar/retirar el comprobante.
export const RECEIPT_TERMS_LINES: string[] = [
  'Estado inicial: Equipos que no encienden o presentan fallas de software/hardware se reciben bajo riesgo del cliente; fallas ocultas o posteriores no están cubiertas.',
  'Garantía: Se invalida si el equipo es manipulado por terceros o presenta sellos rotos.',
  'Abandono: Pasados 60 días sin retirar o pagar el saldo, el equipo pasa a disposición del taller para cubrir gastos operativos.',
  'Responsabilidad: No nos hacemos responsables por SIMs, memorias MicroSD o accesorios no anotados en este recibo, ni por pérdida de datos.',
  'La firma o retiro del comprobante implica la aceptación total de estos términos.',
];

/**
 * Construye el bloque de términos (letra pequeña) para la orden de servicio:
 * cabecera "ACEPTACIÓN DE CONDICIONES Y CONFORMIDAD" + párrafos envueltos al
 * ancho de la font B. Se imprime en el backend con ESC M 1 (font B) entre el
 * cuerpo (primera copia) y el talón CORTA TIJERA.
 */
export function buildReceiptTerms(width: number | null | undefined, lines: string[] = RECEIPT_TERMS_LINES): string {
  const w = printerSmallWidthChars(width);
  const wrapped = lines.map(l => wrapText(l, w).join('\n')).join('\n');
  return ['ACEPTACIÓN DE CONDICIONES Y CONFORMIDAD', '', wrapped].join('\n');
}

const fmtUsd = (n: number) => `$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
 * Construye la ORDEN DE SERVICIO como texto plano de ancho fijo (ticket térmico):
 * copia superior para el cliente + talón recortable ("CORTA TIJERA") con los
 * mismos datos para pegar detrás del teléfono. NO es factura fiscal (sin RIF).
 * Pura y sin IO: el frontend la previsualiza y el backend (ESC/POS + CP850) la imprime.
 */
/**
 * Construye la ORDEN DE SERVICIO como texto plano de ancho fijo (ticket térmico),
 * en DOS partes imprimibles en orden: `main` = PRIMERA copia (para el cliente) y
 * `stub` = talón recortable "CORTA TIJERA" (para pegar detrás del teléfono).
 * Entre `main` y `stub` el backend imprime los términos legales en letra pequeña
 * (font B) — así la copia del cliente lleva las condiciones ANTES del corte.
 * Pura y sin IO: el frontend la previsualiza y el backend (ESC/POS + CP850) la imprime.
 */
export function buildServiceReceiptParts(
  service: Service | null | undefined,
  _payments: ServicePayment[] = [],
  opts: { width?: number; tasaBcv?: number; businessName?: string; businessLine?: string } = {},
): { main: string; stub: string } {
  const empty = { main: '', stub: '' };
  if (!service) return empty;
  const w = printerWidthChars(opts.width);
  const dash = '-'.repeat(w);
  const lines: string[] = [];
  const tipos = parseServiceTypes(service);
  const logo = tipos.join(', ');

  // Cabecera
  lines.push(center(opts.businessName?.trim() || 'SERVICIO TECNICO', w));
  if (opts.businessLine?.trim()) lines.push(center(opts.businessLine.trim(), w));
  lines.push('='.repeat(w));
  lines.push(center('SERVICIO', w));
  lines.push(dash);

  // Orden y fechas
  for (const l of kv('ORDEN', service.order_num ?? '', w)) lines.push(l);
  for (const l of kv('FECHA', service.date_in?.slice(0, 10) ?? '', w)) lines.push(l);
  for (const l of kv('HORA', service.date_in?.slice(11, 16) ?? '', w)) lines.push(l);
  lines.push(dash);

  // Cliente
  if (service.client) for (const l of kv('CLIENTE', service.client, w)) lines.push(l);
  if (service.client_ci) for (const l of kv('CEDULA', service.client_ci, w)) lines.push(l);
  if (service.phone) for (const l of kv('TELEFONO', service.phone, w)) lines.push(l);
  if (service.client_address) for (const l of kv('DIRECCION', service.client_address, w)) lines.push(l);
  lines.push(dash);

  // Equipo y diagnóstico
  if (service.model) for (const l of kv('EQUIPO', service.model, w)) lines.push(l);
  if (service.color) for (const l of kv('COLOR', service.color, w)) lines.push(l);
  if (logo) for (const l of kv('SERVICIO', logo, w)) lines.push(l);
  if (service.technician) for (const l of kv('TECNICO', service.technician, w)) lines.push(l);
  if (service.observations) {
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
  lines.push('='.repeat(w));

  // Garantía (7 días desde la entrega)
  if (warrantyEnd(service.date_out)) {
    lines.push(center('GARANTIA 7 DIAS', w));
  }
  lines.push(center('Gracias por su preferencia', w));
  lines.push('');

  // === Talón recortable: los mismos datos, para pegar detrás del teléfono ===
  const stub: string[] = [dash, center('CORTA TIJERA', w), dash];
  for (const l of kv('ORDEN', service.order_num ?? '', w)) stub.push(l);
  if (service.client) for (const l of kv('CLIENTE', service.client, w)) stub.push(l);
  if (service.client_ci) for (const l of kv('CEDULA', service.client_ci, w)) stub.push(l);
  if (service.color) for (const l of kv('COLOR', service.color, w)) stub.push(l);
  if (service.model) for (const l of kv('MODELO', service.model, w)) stub.push(l);
  if (logo) for (const l of kv('SERVICIO', logo, w)) stub.push(l);
  stub.push(dash);
  stub.push('');
  stub.push(center('FIRMA SALIDA', w));

  return { main: lines.join('\n'), stub: stub.join('\n') };
}

/**
 * Versión completa del recibo (cuerpo + talón en UNA cadena) — compatibilidad:
 * previews/textos que no distinguen partes. Para IMPRIMIR usar buildServiceReceiptParts
 * (el backend inserta los términos en letra pequeña entre main y stub).
 */
export function buildServiceReceipt(
  service: Service | null | undefined,
  payments: ServicePayment[] = [],
  opts: { width?: number; tasaBcv?: number; businessName?: string; businessLine?: string } = {},
): string {
  const { main, stub } = buildServiceReceiptParts(service, payments, opts);
  return [main, stub].filter(Boolean).join('\n');
}

// ============================================================================
// Logo del ticket (bitmap monocromo ESC/POS)
// ============================================================================

function decodeImage(base64: string, widthPx: number, maxHeightPx: number): Promise<ImageData | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const h = Math.max(1, Math.min(maxHeightPx, Math.round((widthPx * img.height) / img.width)));
        const c = document.createElement('canvas');
        c.width = widthPx;
        c.height = h;
        const g = c.getContext('2d');
        if (!g) return resolve(null);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, widthPx, h);
        g.drawImage(img, 0, 0, widthPx, h);
        resolve(g.getImageData(0, 0, widthPx, h));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = base64;
  });
}

/** Convierte un logo (PNG data URL) a raster monocromo empaquetado a 1 bit
 *  (1 = negro, MSB primero por byte y por fila) listo para `GS v 0`.
 *  `widthPx`: 384 (58 mm) o 576 (80 mm). Null si la imagen no se pudo decodificar.
 */
export async function logoToRaster(base64Png: string, widthPx: number, maxHeightPx = 240): Promise<number[] | null> {
  if (!base64Png) return null;
  const data = await decodeImage(base64Png, widthPx, maxHeightPx);
  if (!data) return null;
  const bytesPerLine = Math.ceil(widthPx / 8);
  const raster: number[] = new Array(bytesPerLine * data.height).fill(0);
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2], a = data.data[i + 3];
      if (a < 128) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 128) raster[y * bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return raster;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Genera un logo de prueba (mano/teléfono con rayo + alas mecánicas en fondo
 *  circular negro) como PNG data URL de 384×220 — para imprimir y ver cómo
 *  queda antes de subir el logo definitivo. Blanco y negro puro.
 */
export function makeTestLogoPng(): string {
  const W = 384, H = 220;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return '';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;

  // Alas mecánicas (negro, detrás del círculo)
  g.fillStyle = '#000';
  const feather = (side: 1 | -1, y0: number, len: number, tilt: number) => {
    g.beginPath();
    g.moveTo(cx, y0);
    g.lineTo(cx + side * len, y0 - tilt);
    g.lineTo(cx + side * len * 0.45, y0 + 34 - tilt * 0.4);
    g.lineTo(cx, y0 + 26);
    g.closePath();
    g.fill();
  };
  feather(-1, cy - 44, 150, 26);
  feather(-1, cy - 6, 168, 6);
  feather(1, cy - 44, 150, 26);
  feather(1, cy - 6, 168, 6);
  g.beginPath();
  g.arc(cx, cy, 132, 0, Math.PI * 2);
  g.fill();

  // Anillo interior blanco
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(cx, cy, 120, 0, Math.PI * 2);
  g.stroke();

  // Teléfono blanco vertical con pantalla
  g.fillStyle = '#fff';
  roundRectPath(g, cx - 46, cy - 84, 92, 168, 16);
  g.fill();
  g.fillStyle = '#000';
  roundRectPath(g, cx - 32, cy - 64, 64, 128, 10);
  g.fill();

  // Rayo en la pantalla
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(cx + 10, cy - 56);
  g.lineTo(cx - 20, cy + 8);
  g.lineTo(cx - 2, cy + 8);
  g.lineTo(cx - 12, cy + 56);
  g.lineTo(cx + 22, cy - 12);
  g.lineTo(cx + 4, cy - 12);
  g.closePath();
  g.fill();

  return c.toDataURL('image/png');
}
