import type { DailyClosing } from '../types';

// F39 — EL ARQUEO CUADRA POR MONEDA (módulo PURO, sin React).
//
// Regla de POS en Venezuela: **la caja se cuenta y se compara en CADA moneda por separado.** El
// "faltan Bs. 5.000" y el "sobran $2" son dos hechos distintos y se informan por separado.
//
// Por qué importa: `daily_closings.difference` guarda UN número en dólares equivalente
// (`falta_$ + falta_Bs / tasa`). Sirve como resumen informativo, pero **como semáforo miente**: con la
// tasa moviéndose, un descuadre de Bs. parece enorme en $, y un faltante real de $0,40 se diluye (o al
// revés). El semáforo tiene que juzgar cada moneda con SU tolerancia.
//
// Los esperados NO se recalculan: salen de las columnas guardadas en el cierre (que se escribieron al
// cerrar el día), así que un cierre viejo se sigue leyendo igual aunque después cambie algo.

/** Tolerancia del conteo: medio dólar y medio bolívar (lo que se redondea al contar el cajón). */
export const TOL_USD = 0.5;
export const TOL_BS = 0.5;

export interface ClosingDifference {
  /** Sobrante (+) o faltante (−) en dólares, contra el esperado del sistema. */
  usd: number;
  /** Sobrante (+) o faltante (−) en bolívares. */
  bs: number;
  /** true = las DOS monedas cuadran dentro de su tolerancia. */
  cuadrado: boolean;
  /** Cuál(es) moneda(s) no cuadran: para el texto del semáforo. */
  fallaEn: ('USD' | 'VES')[];
}

/** Redondeo a 2 decimales (el conteo se hace con centavos/bolívares). */
const r2 = (v: number) => Math.round((v ?? 0) * 100) / 100;

/**
 * Diferencias del cierre por MONEDA: `esperado` = lo que el sistema dice que debía haber en cada
 * moneda (ventas + abonos del día, por su método), `actual` = lo que se contó.
 */
export function closingDifference(c: Pick<DailyClosing,
  'cash_usd' | 'zelle_total' | 'usd_cash_total' | 'cash_bs' | 'pago_movil_total' | 'transfer_bs_total' |
  'actual_cash_usd' | 'actual_zelle' | 'actual_cash_bs' | 'actual_pago_movil' | 'actual_transfer_bs'
>): ClosingDifference {
  const esperadoUsd = (c.cash_usd ?? 0) + (c.zelle_total ?? 0) + (c.usd_cash_total ?? 0);
  const actualUsd = (c.actual_cash_usd ?? 0) + (c.actual_zelle ?? 0);
  const esperadoBs = (c.cash_bs ?? 0) + (c.pago_movil_total ?? 0) + (c.transfer_bs_total ?? 0);
  const actualBs = (c.actual_cash_bs ?? 0) + (c.actual_pago_movil ?? 0) + (c.actual_transfer_bs ?? 0);
  const usd = r2(actualUsd - esperadoUsd);
  const bs = r2(actualBs - esperadoBs);
  const fallaEn: ('USD' | 'VES')[] = [];
  if (Math.abs(usd) >= TOL_USD) fallaEn.push('USD');
  if (Math.abs(bs) >= TOL_BS) fallaEn.push('VES');
  return { usd, bs, cuadrado: fallaEn.length === 0, fallaEn };
}

/** Texto del semáforo: «Cuadra» o qué moneda falla y por cuánto. */
export function closingLabel(d: ClosingDifference): string {
  if (d.cuadrado) return 'Cuadra';
  const partes: string[] = [];
  if (d.fallaEn.includes('USD')) partes.push(`${d.usd >= 0 ? 'sobran' : 'faltan'} $${Math.abs(d.usd).toFixed(2)}`);
  if (d.fallaEn.includes('VES')) partes.push(`${d.bs >= 0 ? 'sobran' : 'faltan'} Bs. ${Math.abs(d.bs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  return partes.join(' · ');
}

/**
 * ¿NADIE CONTÓ EL CAJÓN? (revisión adversarial F39): `actual_*` en 0 con un esperado que no lo está.
 *
 * Se usa SOLO como marca informativa («sin contar»), **nunca para esconder la diferencia**. La primera
 * versión ocultaba el número y eso tapaba un descuadre real: cerrar el día con las dos casillas en 0
 * (o abrir el diálogo cuando `getDailyTotals` falló) guarda un cierre que dice que no hay nada en el
 * cajón, y mostrarlo como «sin arqueo» hacía invisible que faltaba **todo** el efectivo del día. Ahora
 * la diferencia se muestra SIEMPRE y esta marca avisa por qué puede ser un número raro (un cierre
 * anterior al arqueo real se reabre con ↺, se cuenta y se vuelve a cerrar).
 * Un día con esperado 0 y contado 0 SÍ está cuadrado (no hay nada que contar): eso no es «sin contar».
 */
export function sinContar(c: Pick<DailyClosing,
  'cash_usd' | 'zelle_total' | 'usd_cash_total' | 'cash_bs' | 'pago_movil_total' | 'transfer_bs_total' |
  'actual_cash_usd' | 'actual_zelle' | 'actual_cash_bs' | 'actual_pago_movil' | 'actual_transfer_bs'
>): boolean {
  const contado = (c.actual_cash_usd ?? 0) + (c.actual_zelle ?? 0) + (c.actual_cash_bs ?? 0)
    + (c.actual_pago_movil ?? 0) + (c.actual_transfer_bs ?? 0);
  const esperado = (c.cash_usd ?? 0) + (c.zelle_total ?? 0) + (c.usd_cash_total ?? 0)
    + (c.cash_bs ?? 0) + (c.pago_movil_total ?? 0) + (c.transfer_bs_total ?? 0);
  return contado === 0 && esperado > 0;
}

/** ¿El Punto cuadra? Se liquida aparte (el monto impreso vs. lo cobrado por el punto). */
export function puntoDifference(posChargedUsd: number, posSettledUsd: number, posChargedBs: number, posSettledBs: number): ClosingDifference {
  const usd = r2(posSettledUsd - posChargedUsd);
  const bs = r2(posSettledBs - posChargedBs);
  const fallaEn: ('USD' | 'VES')[] = [];
  if (Math.abs(usd) >= TOL_USD) fallaEn.push('USD');
  if (Math.abs(bs) >= TOL_BS) fallaEn.push('VES');
  return { usd, bs, cuadrado: fallaEn.length === 0, fallaEn };
}
