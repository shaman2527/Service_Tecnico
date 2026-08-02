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
