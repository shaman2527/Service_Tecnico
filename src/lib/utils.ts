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
  return c === 'VES' ? 'Bs. ' : '$';
}

// Un pago NEGATIVO en service_payments es un REEMBOLSO (devolución al cliente).
export function isRefund(p: { amount: number }): boolean {
  return p.amount < 0;
}

// Órdenes en estado FINAL: no esperan pago, entrega ni trabajo (nunca "pendiente").
export function isFinalized(status: string | null | undefined): boolean {
  return status === 'Devuelto' || status === 'Cancelado' || status === 'Cancelado / Devuelto';
}

// Etiqueta CORTA de un método de pago (58mm: cabe sin truncar). Fuente única:
// recibo, PAGOS del recibo y chips de la tarjeta de servicios.
export function shortMethodLabel(m: string | null | undefined): string {
  const s = (m ?? '').trim();
  if (!s) return 'PAGO';
  const map: Record<string, string> = {
    'Divisas (USD Cash)': 'EFECTIVO $',
    'Punto de Venta ($)': 'PUNTO $',
    'Punto de Venta (Bs)': 'PUNTO Bs',
    'Punto de Venta': 'PUNTO',
    'Pago Móvil': 'PAGO MOVIL',
    'Pago Movil': 'PAGO MOVIL',
    'Efectivo Bs': 'EFECTIVO Bs',
    'Transferencia Zelle': 'ZELLE',
    'Zelle': 'ZELLE',
    'Transferencia Bs': 'TRANSF Bs',
  };
  return map[s] ?? s.toUpperCase().slice(0, 12);
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

// --- Checklist de blindaje del equipo (10 ítems, cada uno con su punto de color) ---
export const CHECKLIST_ITEMS: { key: string; label: string; dot: string }[] = [
  { key: 'chip_sim', label: 'Chip (SIM) presente', dot: 'bg-sky-500' },
  { key: 'tapa_trasera', label: 'Tapa trasera en buen estado', dot: 'bg-violet-500' },
  { key: 'bandeja_sim', label: 'Bandeja SIM presente', dot: 'bg-amber-500' },
  { key: 'botones', label: 'Botones (volumen/encendido) funcionan', dot: 'bg-rose-500' },
  { key: 'boton_home', label: 'Botón home/navegación (si aplica)', dot: 'bg-emerald-500' },
  { key: 'camara', label: 'Cámara (lente) sin daños', dot: 'bg-indigo-500' },
  { key: 'puerto_carga', label: 'Puerto de carga funciona', dot: 'bg-orange-500' },
  { key: 'parlante', label: 'Parlante/micrófono funcionan', dot: 'bg-teal-500' },
  { key: 'contrasena', label: 'Contraseña/patrón entregada por el cliente', dot: 'bg-fuchsia-500' },
  { key: 'accesorios', label: 'Accesorios entregados (funda, protector)', dot: 'bg-lime-500' },
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
  'Cambio pantalla', 'Cambio batería', 'Cambio flex', 'Pin de Carga',
  'Reparación (placa)', 'Limpieza / Mantenimiento', 'Software / Formateo',
  'Cambio cámara', 'Cambio parlante / micrófono', 'Revisión', 'Otro',
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

const fmtUsd = (n: number) => `$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Monto en su moneda real ("$ 20.00" o "Bs. 2.246,00") — usada en el desglose de PAGOS del recibo
const fmtMoney = (n: number, currency: string | null | undefined): string => {
  const isBs = currency === 'VES' || currency === 'Bs';
  return isBs
    ? `Bs. ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : fmtUsd(n);
};

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

// Fecha de ticket en formato "19-08-2026 07:40" (dd-mm-aaaa hh:mm) — talón del recibo
function formatTicketDate(iso: string | null | undefined): string {
  const d = (iso ?? '').slice(0, 10);
  const t = (iso ?? '').slice(11, 16);
  if (d.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}${t ? ' ' + t : ''}`;
  }
  return (d + (t ? ' ' + t : '')).trim();
}

// Etiquetas cortas del blindaje para el ticket (caben 2 por línea)
const CHECKLIST_SHORT: Record<string, string> = {
  chip_sim: 'CHIP/SIM', tapa_trasera: 'TAPA', bandeja_sim: 'BANDEJA',
  botones: 'BOTONES', boton_home: 'HOME', camara: 'CAMARA',
  puerto_carga: 'PUERTO', parlante: 'PARLANTE', contrasena: 'CLAVE',
  accesorios: 'ACCESORIOS',
};

// Blindaje en DOS columnas ("CHIP/SIM:Si  BANDEJA:No") para aprovechar el ancho:
// 5 líneas en vez de 10 en un ticket de 58mm (13 chars/celda) u 80mm (19 chars/celda).
function checklistRows(marked: [string, string][], w: number): string[] {
  if (marked.length === 0) return [];
  const cellW = w >= 48 ? 19 : 13;
  const cells = marked.map(([key, v]) => {
    const label = (CHECKLIST_SHORT[key] ?? key.toUpperCase()).slice(0, cellW - 4);
    return label.padEnd(cellW - 3) + (v === 'si' ? 'Si' : 'No');
  });
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push('  ' + cells[i] + (cells[i + 1] ? '  ' + cells[i + 1] : ''));
  }
  return rows;
}

// Desglose de montos por moneda real: "$ 20.00 + Bs. 22.464,00" (omite monedas sin movimientos)
const fmtMix = (usd: number, bs: number): string => {
  const parts: string[] = [];
  if (usd > 0.005) parts.push(fmtUsd(usd));
  if (bs > 0.005) parts.push(`Bs. ${bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  return parts.join(' + ');
};

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
 * La lógica de pago siempre refleja la moneda real del método (Bs. con tasa BCV
 * si el método es en bolívares, $ en divisas) en MONTO, PAGO EN, ABONADO y SALDO.
 * Pura y sin IO: el frontend la previsualiza y el backend (ESC/POS + CP850) la imprime.
 */
export function buildServiceReceiptParts(
  service: Service | null | undefined,
  payments: ServicePayment[] = [],
  opts: { width?: number; tasaBcv?: number; businessName?: string; businessLine?: string; stubNote?: string } = {},
): { main: string; stub: string } {
  const empty = { main: '', stub: '' };
  if (!service) return empty;
  const w = printerWidthChars(opts.width);
  const dash = '-'.repeat(w);
  const lines: string[] = [];
  const tipos = parseServiceTypes(service);
  const logo = tipos.join(', ');
  // Moneda SIEMPRE derivada del método (harness): métodos Bs → bolívares

  // Cabecera
  lines.push(center(opts.businessName?.trim() || 'SERVICIO TECNICO', w));
  if (opts.businessLine?.trim()) lines.push(center(opts.businessLine.trim(), w));
  lines.push('='.repeat(w));
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

  // Blindaje del equipo (solo copia del cliente): ítems marcados Sí/No al recibir,
  // en DOS columnas para aprovechar el ancho del ticket.
  const checklist = parseChecklist(service.device_checklist);
  const marked = Object.entries(checklist).filter(([, v]) => v === 'si' || v === 'no');
  if (marked.length > 0) {
    lines.push('BLINDAJE (AL RECIBIR):');
    for (const row of checklistRows(marked, w)) lines.push(row);
    lines.push(dash);
  }

  // Finanzas — minimalista y entendible: TOTAL / PAGADO / FALTA / CANCELADO.
  // El descuento es INTERNO (se decide en el mostrador, no se imprime
  // PRECIO/DESCUENTO): TOTAL = lo que el cliente debe pagar.
  // PAGADO y METODO salen de los PAGOS REALES registrados (no del form).
  const finalized = isFinalized(service.status);
  const totalUsd = service.amount ?? 0;
  const abonadoUsd = payments.reduce((a, p) => a + (p.amount > 0 && p.currency !== 'VES' ? p.amount : 0), 0);
  const abonadoBs = payments.reduce((a, p) => a + (p.amount > 0 && p.currency === 'VES' ? p.amount : 0), 0);
  const abonado = service.paid_amount ?? 0;
  const saldo = totalUsd - abonado;
  const pagoLabel = payments.length > 0 ? fmtMix(abonadoUsd, abonadoBs) : (abonado > 0.005 ? fmtUsd(abonado) : '');
  for (const l of kv('TOTAL', fmtUsd(totalUsd), w)) lines.push(l);
  if (finalized) {
    lines.push(center(service.status === 'Devuelto' ? 'DEVUELTO' : 'CANCELADO', w));
  } else {
    if (pagoLabel) for (const l of kv('PAGADO', pagoLabel, w)) lines.push(l);
    if (saldo <= 0.005) {
      lines.push(center('CANCELADO', w));
    } else {
      for (const l of kv('FALTA', fmtUsd(saldo), w)) lines.push(l);
    }
  }
  const methods = payments.length > 0
    ? [...new Set(payments.map(p => p.payment_method ?? '').filter(Boolean))].map(shortMethodLabel)
    : [shortMethodLabel(service.payment_method)];
  for (const l of kv('METODO', methods.join(' + '), w)) lines.push(l);
  const ref = service.zelle_reference || payments.find(p => p.zelle_reference)?.zelle_reference;
  if (ref) for (const l of kv('REF', ref, w)) lines.push(l);

  // Pagos/abonos registrados. Con UN solo pago, METODO ya lo dice (no se repite);
  // con varios pagos o reembolsos se desglosa: MONTO a la izquierda, MÉTODO a la derecha.
  const showPayments = payments.length > 1 || payments.some(isRefund);
  if (showPayments) {
    lines.push('PAGOS:');
    for (const p of payments) {
      const money = fmtMoney(Math.abs(p.amount), p.currency);
      const methodLabel = isRefund(p) ? 'DEVOLUCION' : shortMethodLabel(p.payment_method ?? 'Pago');
      const pad = w - money.length - methodLabel.length;
      lines.push(pad >= 2 ? `${money}${' '.repeat(pad)}${methodLabel}` : `${methodLabel}: ${money}`);
    }
  }
  lines.push('='.repeat(w));

  // Garantía (7 días desde la entrega)
  if (warrantyEnd(service.date_out)) {
    lines.push(center('GARANTIA 7 DIAS', w));
  }
  lines.push(center('Gracias por su preferencia', w));
  lines.push('');

  // === Talón recortable: identificación compacta para pegar detrás del teléfono.
  // Orden lógico: QUIÉN (orden/fecha) → CLIENTE → QUÉ (equipo/servicio) → CUÁNTO (total/pago).
  const stub: string[] = [dash, center('CORTA TIJERA', w), dash];
  for (const l of kv('ORDEN', service.order_num ?? '', w)) stub.push(l);
  const stubDate = formatTicketDate(service.date_in);
  if (stubDate) for (const l of kv('FECHA', stubDate, w)) stub.push(l);
  if (service.client) for (const l of kv('CLIENTE', service.client, w)) stub.push(l);
  const stubContact = [service.client_ci, service.phone].filter(Boolean).join(' · ');
  if (stubContact) for (const l of kv('CONTACTO', stubContact, w)) stub.push(l);
  const stubModel = service.color ? `${service.model} (${service.color})` : service.model;
  if (stubModel) for (const l of kv('EQUIPO', stubModel, w)) stub.push(l);
  if (logo) for (const l of kv('SERVICIO', logo, w)) stub.push(l);
  // Pago para la salida del equipo: TOTAL / PAGADO / FALTA — mismo bloque minimalista.
  for (const l of kv('TOTAL', fmtUsd(totalUsd), w)) stub.push(l);
  if (finalized) {
    stub.push(center(service.status === 'Devuelto' ? 'DEVUELTO' : 'CANCELADO', w));
  } else {
    if (pagoLabel) for (const l of kv('PAGADO', pagoLabel, w)) stub.push(l);
    const stubSaldo = totalUsd - (service.paid_amount ?? 0);
    if (stubSaldo <= 0.005) {
      stub.push(center('CANCELADO', w));
    } else {
      for (const l of kv('FALTA', fmtUsd(stubSaldo), w)) stub.push(l);
    }
  }
  for (const l of kv('METODO', methods.join(' + '), w)) stub.push(l);
  const stubNote = opts.stubNote?.trim() || service.observations?.trim() || '';
  if (stubNote) for (const l of kv('NOTA', stubNote, w)) stub.push(l);
  stub.push(dash);
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
  opts: { width?: number; tasaBcv?: number; businessName?: string; businessLine?: string; stubNote?: string } = {},
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
