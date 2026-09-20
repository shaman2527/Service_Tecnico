import type { ServicePayment } from '../types';

// F36 — REGLAS DE LA DEVOLUCIÓN (módulo PURO, sin React).
//
// Por qué existe: el tope de una devolución se comparaba en dólares usando la tasa BCV de HOY,
// mientras `paid_amount` valuaba cada abono con la tasa de SU día. Con la tasa en movimiento eso
// dejaba saldos fantasma: abono de Bs. 4.050 a 40,50 (= $100) + devolución de los MISMOS Bs. 4.050
// a 50 (= $81) → la orden seguía debiendo $19 aunque el cliente ya estaba saldado en bolívares.
//
// La regla correcta —y la más simple— es POR MONEDA, sin tasas de por medio:
//   · se devuelve, como máximo, lo que NETAMENTE entró en ESA moneda (Bs con Bs, $ con $);
//   · devolver todo lo cobrado deja el neto de esa moneda en 0 → la orden queda SALDADA.
// El backend aplica exactamente esta misma regla (db.rs `refundable_in`); acá está para que la UI
// muestre el número correcto y avise ANTES de guardar. `tools/refund_math_test.ts` comprueba los
// mismos casos que el test Rust `test_refund_by_currency_net`.

export type Currency = 'USD' | 'VES';

/** Neto por moneda de los movimientos de una orden (las devoluciones ya vienen en negativo). */
export function netByCurrency(payments: Pick<ServicePayment, 'amount' | 'currency'>[] | null | undefined): { USD: number; VES: number } {
  const net = { USD: 0, VES: 0 };
  for (const p of payments ?? []) {
    const cur: Currency = p.currency === 'VES' ? 'VES' : 'USD';
    net[cur] += p.amount ?? 0;
  }
  return net;
}

/** Cuánto se puede devolver en esa moneda: lo que netamente entró (nunca negativo). */
export function refundable(payments: Pick<ServicePayment, 'amount' | 'currency'>[] | null | undefined, currency: Currency): number {
  const net = netByCurrency(payments)[currency];
  return net > 0 ? net : 0;
}

/** Monto sugerido para «Devolver todo»: todo lo disponible, redondeado como se cobra (Bs entero). */
export function refundSuggestion(payments: Pick<ServicePayment, 'amount' | 'currency'>[] | null | undefined, currency: Currency): number {
  const disponible = refundable(payments, currency);
  return currency === 'VES' ? Math.round(disponible) : Math.round(disponible * 100) / 100;
}

/** Se puede devolver ese monto en esa moneda? (tolerancia 0.5 como el backend) */
export function canRefund(payments: Pick<ServicePayment, 'amount' | 'currency'>[] | null | undefined, currency: Currency, amount: number): boolean {
  if (!(amount > 0)) return false;
  return amount <= refundable(payments, currency) + 0.5;
}

/** Texto del tope, en la moneda real del movimiento. */
export function refundCapLabel(payments: Pick<ServicePayment, 'amount' | 'currency'>[] | null | undefined, currency: Currency): string {
  const disponible = refundable(payments, currency);
  return currency === 'VES'
    ? `Bs. ${disponible.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${disponible.toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// F42 — ¿POR QUÉ MÉTODO VUELVE LA PLATA? (bug real medido en la tienda, 2026-09-17)
//
// El diálogo de devolución proponía el método del FORMULARIO de la orden (`service.payment_method`),
// que en este proyecto es **sólo lo que se esperaba cobrar**, nunca el método real. Caso real:
// una orden de $5 con el formulario en «Punto de Venta (Bs)» que se cobró $3 en efectivo + Bs. 1.697
// por **Pago Móvil**; al devolver los Bs. 1.697 el operario aceptó el método propuesto y la devolución
// quedó anotada como **Punto de Venta (Bs)**. Efectos en el cierre de esa tarde: el Punto quedó en
// **−Bs. 1.697** (la máquina nunca devuelve plata), el cajón esperaba **0** por la plata que SÍ salió
// y la fila del Punto (que sólo se dibuja con esperado > 0) **desapareció de la pantalla**: la
// devolución no se veía en ninguna parte del arqueo.
//
// LA REGLA (la del local, dicha por el dueño: «se devolvió la misma manera que el cliente me pagó»):
//   la devolución vuelve **por el método por el que ENTRÓ la plata**.
// Si el operario elige un método que no cobró nada en esa moneda:
//   · los métodos de CAJÓN (Efectivo Bs / Divisas $) sí pueden pagar la devolución —la plata puede
//     salir del cajón aunque haya entrado por transferencia—: se AVISA y se deja pasar;
//   · cualquier otro (Pago Móvil, Transferencia, Zelle, Punto) sería registrar una salida por un canal
//     que no recibió nada: se BLOQUEA y se dice por dónde entró.
// Todo esto vive acá (puro, con tests) para que la UI y el test en vivo usen la MISMA regla.

/** ¿Es un método de cajón? (la plata puede salir físicamente del cajón) */
export function isCashMethod(method: string | null | undefined): boolean {
  const m = method ?? '';
  return m === 'Efectivo Bs' || m === 'Divisas (USD Cash)';
}

/** Lo que NETAMENTE entró por cada método, en la moneda pedida (sólo montos positivos). */
export function incomeByMethod(
  payments: Pick<ServicePayment, 'amount' | 'currency' | 'payment_method'>[] | null | undefined,
  currency: Currency,
): { method: string; amount: number }[] {
  const acc = new Map<string, number>();
  for (const p of payments ?? []) {
    const cur: Currency = p.currency === 'VES' ? 'VES' : 'USD';
    if (cur !== currency) continue;
    const m = (p.payment_method ?? '').trim();
    if (!m) continue;
    acc.set(m, (acc.get(m) ?? 0) + (p.amount ?? 0));
  }
  return [...acc.entries()]
    .filter(([, v]) => v > 0.005)
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method));
}

/** ¿Por este método entró plata en esa moneda? */
export function methodHasIncome(
  payments: Pick<ServicePayment, 'amount' | 'currency' | 'payment_method'>[] | null | undefined,
  method: string,
  currency: Currency,
): boolean {
  return incomeByMethod(payments, currency).some(m => m.method === (method ?? '').trim());
}

/**
 * Método que el diálogo debe PROPONER: el que MÁS plata trajo en esa moneda (empate: el primero por
 * nombre). Si no entró nada en esa moneda, se cae al `fallback` (el método del formulario, que es lo
 * que había antes) para no dejar el campo vacío.
 */
export function refundMethodDefault(
  payments: Pick<ServicePayment, 'amount' | 'currency' | 'payment_method'>[] | null | undefined,
  currency: Currency,
  fallback: string | null | undefined,
): string {
  const conPlata = incomeByMethod(payments, currency);
  if (conPlata.length > 0) return conPlata[0].method;
  return (fallback ?? '').trim() || 'Divisas (USD Cash)';
}

/**
 * ¿Se puede registrar la devolución con ese método? Devuelve el motivo cuando NO se puede (string
 * vacío = se puede). Bloquea sólo los métodos que no son de cajón y no cobraron nada en esa moneda.
 */
export function refundMethodProblem(
  payments: Pick<ServicePayment, 'amount' | 'currency' | 'payment_method'>[] | null | undefined,
  method: string,
  currency: Currency,
): string {
  if (methodHasIncome(payments, method, currency)) return '';
  if (isCashMethod(method)) return ''; // aviso, no bloqueo (lo maneja la UI)
  const entro = incomeByMethod(payments, currency);
  const donde = entro.length > 0
    ? `En esta orden entraron ${currency === 'VES' ? 'bolívares' : 'dólares'} por ${entro.map(e => e.method).join(', ')}.`
    : `En esta orden no entraron ${currency === 'VES' ? 'bolívares' : 'dólares'}.`;
  return `Por «${method}» no entró plata: la devolución tiene que salir por donde entró (${donde} Si le devolvés del cajón, elegí «${currency === 'VES' ? 'Efectivo Bs' : 'Divisas (USD Cash)'}»).`;
}

/** Texto corto con lo que entró por cada método («Pago Móvil Bs. 1.697,00») para el diálogo. */
export function incomeSummary(
  payments: Pick<ServicePayment, 'amount' | 'currency' | 'payment_method'>[] | null | undefined,
  currency: Currency,
): string {
  const entro = incomeByMethod(payments, currency);
  if (entro.length === 0) return '';
  return entro
    .map(e => (currency === 'VES'
      ? `${e.method} Bs. ${e.amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${e.method} $${e.amount.toFixed(2)}`))
    .join(' · ');
}
