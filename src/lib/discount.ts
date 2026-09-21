// F49 — DESCUENTO de un servicio (módulo PURO, sin React).
//
// Pedido del dueño (2026-09-20): «el cliente me pide que quite el botón de cerrar que sale en la card
// de servicios, y lo cambie por un botón de descuento para hacerle en ese servicio, y que se refleje
// en la factura que se le aplicó un descuento de X monto».
//
// Cómo se guarda un descuento en este proyecto (importante para no corromper la plata):
//   · `services.amount`  = lo que el cliente DEBE pagar (ya con el descuento aplicado);
//   · `services.discount_amount` = el descuento del mostrador.
//   → el PRECIO de lista es la suma: `amount + discount_amount`. Ese es el único invariante y por eso
//     el descuento se calcula SIEMPRE desde el precio de lista (`applyDiscount`), no restando sobre el
//     total ya descontado (que se descontaría dos veces).
//
// La caja NO se toca: el descuento no mueve un solo pago registrado, solo cambia lo que queda por
// cobrar (si ya había abonos, el saldo se recalcula solo con `orderBalance`).

/** Precio de lista del servicio (lo que costaba antes del descuento). */
export const grossOf = (amount: number, discount: number): number =>
  Math.max(0, (amount ?? 0) + (discount ?? 0));

export interface DiscountResult {
  /** monto FINAL que el cliente debe pagar (lo que se guarda en `amount`) */
  amount: number;
  /** descuento aplicado (lo que se guarda en `discount_amount`) */
  discountAmount: number;
}

/**
 * Aplica un descuento NUEVO sobre un servicio. `amount`/`currentDiscount` son los valores guardados
 * (o sea: el precio de lista se reconstruye sumándolos) y `newDiscount` es lo que el operario escribió.
 * Se acota a `[0, precio]`: un descuento negativo no existe y uno mayor que el precio dejaría el total
 * en negativo (plata inventada).
 */
export function applyDiscount(amount: number, currentDiscount: number, newDiscount: number): DiscountResult {
  const bruto = grossOf(amount, currentDiscount);
  const d = Math.min(Math.max(0, Number.isFinite(newDiscount) ? newDiscount : 0), bruto);
  return { amount: Math.round((bruto - d) * 100) / 100, discountAmount: Math.round(d * 100) / 100 };
}

/** ¿Hay algo que avisar de lo que se escribió? (`null` = se puede aplicar). No bloquea: avisa. */
export function discountProblem(newDiscount: number, gross: number): string | null {
  if (!Number.isFinite(newDiscount)) return 'Escribí un monto';
  if (newDiscount < 0) return 'Un descuento no puede ser negativo';
  if (newDiscount > gross + 0.005) return `El descuento no puede pasar el precio ($${gross.toFixed(2)})`;
  return null;
}

/** Texto del descuento para la tarjeta y la factura: «Descuento $5.00». */
export const discountLabel = (discount: number): string => `Descuento $${(discount ?? 0).toFixed(2)}`;

/** Descuentos rápidos del mostrador (los mismos montos que se usan para redondear el cobro). */
export const DISCOUNT_CHIPS = [1, 2, 3, 5, 10];

/** ¿El cambio de descuento deja el total en 0? (cortesía / garantía del 100%). */
export const isFullDiscount = (result: DiscountResult): boolean => result.amount <= 0.005;
