// F70 — ANULAR UNA VENTA: las reglas de la PANTALLA (módulo PURO, sin React).
//
// El bloqueante A3 de la auditoría de entrega: una venta mal tecleada quedaba en la caja de ese día
// para siempre, y una pantalla vendida y devuelta no volvía al stock. El backend (`void_sale`) hace el
// trabajo de verdad (reverso de stock, contra-asiento en el libro con autor y motivo, `total_spent` del
// cliente); acá viven las tres cosas que la UI tiene que decidir ANTES de llamarlo, para que el
// operario sepa qué está por pasar:
//
//   1. **El motivo es obligatorio** (una anulación sin motivo no sirve para auditar nada).
//   2. **El impacto se dice con números**: de qué caja sale la plata (día + monto + método) y cuántas
//      unidades vuelven al stock. Anular mueve dinero y stock: no puede ser un botón mudo.
//   3. **Una venta ya anulada no se vuelve a anular** y su fila se muestra como tal (tachada), nunca
//      desaparece: la historia no se esconde.

import type { Sale } from '../types';

export interface ImpactoAnulacion {
  /** ¿Se puede anular desde acá? (motivo del «no» cuando no). */
  puede: boolean;
  /** Por qué NO se puede (texto para el operario). */
  motivo?: string;
  /** Qué va a pasar, con números (lo que el diálogo de confirmación muestra). */
  texto: string;
}

const fmtUsd = (n: number) => `$${(n ?? 0).toFixed(2)}`;
const fmtBs = (n: number) => {
  const v = n ?? 0;
  const signo = v < 0 ? '-' : '';
  return `${signo}Bs. ${Math.abs(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** La moneda del cobro: la del registro (VES) o USD por defecto. */
export const monedaDeVenta = (s: Pick<Sale, 'currency'>): 'USD' | 'VES' =>
  (s.currency ?? 'USD') === 'VES' ? 'VES' : 'USD';

/** El monto tal como se dice en pantalla (en la moneda del cobro). */
export function montoDeVenta(s: Pick<Sale, 'total' | 'currency'>): string {
  return monedaDeVenta(s) === 'VES' ? fmtBs(s.total) : fmtUsd(s.total);
}

/** El día de la caja al que pertenece la venta (`AAAA-MM-DD` de su fecha/hora). */
export function diaDeVenta(s: Pick<Sale, 'date'>): string {
  return (s.date ?? '').slice(0, 10);
}

/**
 * ¿Se puede anular esta venta, y qué va a pasar? El texto se arma con el día, el monto, el método y
 * las unidades que vuelven al stock (si la venta tenía un producto del catálogo).
 */
export function impactoAnulacion(s: Pick<Sale, 'date' | 'total' | 'currency' | 'payment_method' | 'product_id' | 'quantity' | 'voided_at' | 'product_name'>): ImpactoAnulacion {
  if (s.voided_at) {
    return {
      puede: false,
      motivo: 'Esta venta ya está anulada.',
      texto: 'Esta venta ya está anulada: no vuelve a salir de la caja ni a devolver stock.',
    };
  }
  const dia = diaDeVenta(s);
  const metodo = s.payment_method ?? 'sin método';
  const vuelveStock = s.product_id != null && s.quantity > 0;
  const unidades = `${s.quantity} unidad${s.quantity === 1 ? '' : 'es'}`;
  const partes = [
    `Sale de la caja del ${dia || 'día de la venta'}: ${montoDeVenta(s)} por «${metodo}».`,
    vuelveStock
      ? `Vuelven ${unidades} de «${s.product_name ?? 'el producto'}» al stock.`
      : 'Esta venta no descontó stock (no está ligada a un producto del catálogo).',
    'La venta NO se borra: queda en la lista tachada, con el motivo y el asiento de reverso en el libro.',
  ];
  return { puede: true, texto: partes.join(' ') };
}

/** ¿El motivo sirve? (vacío = no; se le pide al operario que escriba POR QUÉ). */
export function motivoOk(motivo: string): { ok: boolean; error?: string } {
  return (motivo ?? '').trim().length === 0
    ? { ok: false, error: 'Escribí por qué se anula (queda en el libro y en la auditoría).' }
    : { ok: true };
}

/** Cómo se muestra una fila: la anulada se tacha y lleva su motivo (nunca desaparece). */
export function estadoFila(s: Pick<Sale, 'voided_at' | 'void_reason'>): { anulada: boolean; etiqueta: string; detalle: string } {
  if (!s.voided_at) return { anulada: false, etiqueta: '', detalle: '' };
  return {
    anulada: true,
    etiqueta: 'Anulada',
    detalle: s.void_reason?.trim() ? `Anulada: ${s.void_reason.trim()}` : 'Anulada',
  };
}

/** Los totales de la pantalla NO cuentan las anuladas (si no, el KPI mentiría). */
export function totalesVigentes(sales: Pick<Sale, 'total' | 'currency' | 'quantity' | 'voided_at'>[]) {
  const vigentes = sales.filter(s => !s.voided_at);
  return {
    count: vigentes.length,
    anuladas: sales.length - vigentes.length,
    unidades: vigentes.reduce((a, s) => a + s.quantity, 0),
    usd: vigentes.reduce((a, s) => a + (monedaDeVenta(s) === 'VES' ? 0 : s.total), 0),
    bs: vigentes.reduce((a, s) => a + (monedaDeVenta(s) === 'VES' ? s.total : 0), 0),
  };
}
