// Reglas de dinero de los cobros de servicio — FUENTE ÚNICA (Harness F30).
//
// Antes vivían SOLO dentro de `PaymentDialog.tsx`; el asistente de cierre necesita
// exactamente las mismas cuentas (moneda del método vs moneda del campo, "todo el
// saldo", comisión del Punto), así que se extrajeron aquí como funciones PURAS.
// `PaymentDialog` las consume desde F30 y `tools/payment_math_test.ts` fija su
// paridad numérica con los valores que producía el diálogo antes del cambio.
//
// REGLA DE NEGOCIO (no romper): la moneda que se GUARDA es SIEMPRE la del MÉTODO
// (`methodCurrency` en lib/utils). El toggle $ / Bs. del campo solo cambia cómo
// escribe el operario el monto, nunca lo que se registra.

export type PayCur = 'USD' | 'VES';

/**
 * F92 — EL DINERO SON 2 DECIMALES: redondeo a centavos, SIMÉTRICO (una devolución de −0,005 va a
 * −0,01, igual que `round2` del backend — `Math.round(-0.5)` da `-0`, y esa asimetría dejaba
 * diferencias de un centavo entre lo que muestra la UI y lo que guarda la base).
 */
export function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.sign(v) * Math.round(Math.abs(v) * 100) / 100;
}

/**
 * Conversión de la moneda del CAMPO cuando el operario cambia el toggle o el método.
 * **Las dos monedas se manejan con 2 decimales** (F92): los Bs. también tienen centavos, y
 * redondearlos a entero perdía hasta 0,99 Bs. por cobro — plata que después no cuadraba en la caja.
 * Sin tasa (≤ 0) NO hay conversión segura: devuelve el valor sin cambios (la UI ya muestra el aviso ámbar).
 */
export function convertAmount(value: number, from: PayCur, to: PayCur, tasa: number): number {
  if (tasa <= 0 || to === from) return value;
  return to === 'VES' ? round2(value * tasa) : round2(value / tasa);
}

/**
 * Monto FINAL a guardar: SIEMPRE en la moneda del MÉTODO, con 2 decimales (F92).
 * campo Bs. + método Bs. → tal cual · campo $ + método Bs. → × tasa ·
 * campo Bs. + método $ → ÷ tasa (tasa 0 → 0, el guardado queda bloqueado).
 */
export function finalAmount(amountInField: number, fieldCur: PayCur, methodCur: PayCur, tasa: number): number {
  if (methodCur === 'VES') {
    return fieldCur === 'VES' ? round2(amountInField) : tasa > 0 ? round2(amountInField * tasa) : 0;
  }
  return fieldCur === 'USD' ? round2(amountInField) : tasa > 0 ? round2(amountInField / tasa) : 0;
}

/**
 * Monto sugerido para "todo el saldo" en la moneda del CAMPO.
 * Nunca sugiere más que el monto del servicio (saldo negativo → 0).
 */
export function suggestAmount(saldoUsd: number, amountUsd: number, fieldCur: PayCur, tasa: number): number {
  if (saldoUsd <= 0.005) return 0;
  const bruto = Math.min(saldoUsd, amountUsd);
  if (fieldCur === 'VES') return tasa > 0 ? round2(bruto * tasa) : 0;
  return round2(bruto);
}

/** Valor del chip "Todo el saldo" en la moneda del CAMPO (saldo nunca negativo).
 *  Corte en 0,005 —el MISMO que `suggestAmount` y que `order-balance.SALDO_CERO`—: con un saldo de
 *  centavos el chip ofrecía bolívares mientras el campo se autocompletaba en 0 y el texto decía
 *  «Sin saldo» (revisión adversarial F39: tres respuestas para el mismo saldo). */
export function saldoChipValue(saldoUsd: number, fieldCur: PayCur, tasa: number): number {
  if (saldoUsd <= 0.005) return 0;
  if (fieldCur === 'VES') return tasa > 0 ? round2(Math.max(0, saldoUsd) * tasa) : 0;
  return round2(Math.max(0, saldoUsd));
}

/** Chips de cobro rápido en la moneda del campo ("5 mil", "10 mil" — lo que dice el cliente). */
export const QUICK_USD = [5, 10, 15, 20];
export const QUICK_VES = [5000, 10000, 15000, 20000];

export function quickAmounts(cur: PayCur): number[] {
  return cur === 'VES' ? QUICK_VES : QUICK_USD;
}

/** Comisión del Punto de Venta y su neto. F92: los dos se redondean a centavos, y el neto se calcula
 *  sobre el monto YA redondeado — así `neto + comisión = monto` exacto (la misma cuenta que hace el
 *  backend, que guarda `bank_fee_amount` y `net_amount` con 2 decimales). */
export function puntoCommission(amountFinal: number, feePercent: number): { commission: number; net: number } {
  const bruto = round2(amountFinal);
  const commission = round2((bruto * feePercent) / 100);
  return { commission, net: round2(bruto - commission) };
}

/** Tasa por defecto de la comisión del Punto (la misma del harness). */
export const DEFAULT_PUNTO_FEE = 3.5;
