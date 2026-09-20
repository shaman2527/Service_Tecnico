import type { ServicePayment } from '../types';
// Extensión explícita: los tests puros corren en Node (sin resolución estilo bundler).
import { netByCurrency } from './refund-math.ts';

// F38 — ¿EN QUÉ MONEDA SE DICE EL SALDO DE UNA ORDEN? (módulo PURO, sin React).
//
// Regla de POS en Venezuela: **la deuda se dice en la moneda en que se cobró, y se traduce solo para
// informar la otra**. Si el cliente pagó todo en bolívares, el mostrador y el recibo tienen que decir
// el saldo en Bs. (es lo que el cliente va a entregar), no un número en dólares que el operario tiene
// que convertir mentalmente con la tasa del día.
//
// El monto de la orden SIEMPRE es en dólares (la lista de precios del taller está en $): el saldo en $
// es `amount - paid_amount`. La equivalencia en Bs. se calcula con la **tasa del turno abierto** (la
// que se va a usar para cobrar HOY), nunca con una tasa histórica: lo que el cliente va a pagar es el
// equivalente de hoy.
//
// Nunca se "revalúa" la deuda: `paid_amount` ya está fijado con la tasa del día de cada cobro (F36),
// así que el saldo no cambia porque se mueva la tasa.

export type Currency = 'USD' | 'VES';

/** Tolerancia para considerar saldada una orden (misma que el resto de la app). */
export const SALDO_CERO = 0.005;

export interface OrderBalance {
  /** Saldo en dólares (la deuda real de la orden). */
  usd: number;
  /** Equivalencia en bolívares del MISMO saldo (negativa si hay excedente a favor del cliente),
   *  con la tasa del día abierto (null si no hay tasa).
   *  **Redondeada AL BOLÍVAR**, igual que el monto que se cobra (`payment-math.suggestAmount` y
   *  `finalAmount` redondean los Bs. a entero): el número que se muestra tiene que ser EXACTAMENTE el
   *  que el operario va a pedir, sin centavos de bolívar que no existen en la calle. */
  bs: number | null;
  /** Moneda en la que se COBRÓ (si todos los movimientos fueron de una sola moneda). */
  cobroEn: Currency | null;
  /** En qué moneda conviene DECIR el saldo (la del cobro; '$' si no hubo cobros). */
  principal: Currency;
  /** true = el cliente ya no debe nada. */
  saldado: boolean;
  /** true = se cobró más que el total (excedente a favor del cliente). */
  excedente: boolean;
}

/**
 * Saldo de una orden para MOSTRAR. `payments` son los movimientos reales (devoluciones negativas) y
 * `tasa` la del turno abierto (0 = sin tasa: no se inventa ninguna equivalencia).
 */
export function orderBalance(
  amount: number,
  paidUsd: number,
  payments: Pick<ServicePayment, 'amount' | 'currency'>[] | null | undefined,
  tasa: number,
): OrderBalance {
  // El saldo en $ se redondea a centavos para MOSTRARLO, pero la equivalencia en Bs. se calcula con el
  // saldo SIN redondear: `suggestAmount`/`saldoChipValue` (el monto que se cobra) parten del saldo
  // exacto, y redondear antes de multiplicar por la tasa movía el número en un bolívar (medido en
  // vivo: la pantalla decía Bs. 72.880,00 y el chip «Todo el saldo» cobraba 72.879).
  const usdRaw = (amount ?? 0) - (paidUsd ?? 0);
  const usd = Math.round(usdRaw * 100) / 100;
  const net = netByCurrency(payments);
  // La moneda del cobro: SOLO si hubo movimientos y todos son de la misma. Con cobros mixtos no hay
  // una moneda "del cobro" y el saldo se dice en $ (la moneda del monto de la orden).
  const huboMovimientos = (net.USD !== 0 || net.VES !== 0);
  const cobroEn: Currency | null = !huboMovimientos ? null
    : (net.VES !== 0 && net.USD === 0) ? 'VES'
      : (net.USD !== 0 && net.VES === 0) ? 'USD'
        : null;
  const saldado = Math.abs(usd) < SALDO_CERO;
  const excedente = usd < -SALDO_CERO;
  // Equivalencia del MISMO saldo (sin recortar en 0): si el saldo es negativo, los Bs. también lo son
  // (es la plata que hay que devolverle al cliente en bolívares, no un cero). Con la orden SALDADA no
  // hay nada que cobrar: 0 (así coincide con `suggestAmount`/`saldoChipValue`, que cortan en SALDO_CERO).
  const bs = saldado ? 0 : tasa > 0 ? Math.round(usdRaw * tasa) : null;
  return {
    usd,
    bs,
    cobroEn,
    principal: cobroEn ?? 'USD',
    saldado,
    excedente,
  };
}

/**
 * Texto del saldo para el mostrador y el recibo: la cifra PRINCIPAL en la moneda del cobro y la otra
 * entre paréntesis (o sola, si no hay tasa / no hubo cobro en Bs.).
 */
/**
 * Texto del saldo para el mostrador y el recibo. Regla: **siempre que haya tasa se muestran LAS DOS
 * monedas** (el operario necesita el número en Bs. para cobrar y el $ es la verdad contable); la
 * moneda del cobro decide cuál va primero y sin paréntesis.
 */
export function balanceLabel(b: OrderBalance): string {
  const fmtUsd = (v: number) => `$${v.toFixed(2)}`;
  const fmtBs = (v: number) => `Bs. ${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (b.saldado) return 'Sin saldo';
  // El excedente es plata que el local le debe AL CLIENTE: si el cobro vino en Bs., se dice en Bs.
  // (es lo que hay que devolverle) con el $ entre paréntesis, igual que el saldo.
  if (b.excedente) {
    if (b.bs !== null && b.principal === 'VES') return `A favor ${fmtBs(-b.bs)} (${fmtUsd(-b.usd)})`;
    return `A favor ${fmtUsd(-b.usd)}`;
  }
  if (b.bs === null) {
    // Sin tasa cargada no se inventa una equivalencia en bolívares.
    return b.principal === 'VES' ? `${fmtUsd(b.usd)} (falta la tasa BCV)` : fmtUsd(b.usd);
  }
  return b.principal === 'VES' ? `${fmtBs(b.bs)} (${fmtUsd(b.usd)})` : `${fmtUsd(b.usd)} (${fmtBs(b.bs)})`;
}
