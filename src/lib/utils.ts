import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
