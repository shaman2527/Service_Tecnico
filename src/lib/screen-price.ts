// EL PRECIO DEL REPUESTO → MONTO DEL SERVICIO (regla pura, sin React).
//
// F67 — pedido del dueño (2026-09-23): «en el servicio, cuando yo seleccione una pantalla [que] pueda
// tomar el precio de venta de ese producto, o se puede seguir usando también el que tengo al lado de
// modelos». O sea: el precio de la ficha ELEGIDA manda, y el del grupo de repuestos del MODELO sigue
// siendo el respaldo. Las dos cosas salen de acá: UNA sola implementación del precio.
//
// LA SEMÁNTICA DEL FORMULARIO DE SERVICIO (la que ya usan la factura, el descuento y el arqueo):
//
//     Monto ($)      = PRECIO LISTA de la ficha
//     Descuento ($)  = lo que se rebaja  (en efectivo: lista − contado)
//     Total          = Monto − Descuento  = LO QUE PAGA EL CLIENTE
//
// De ahí sale la regla del efectivo, que es la que estaba mal en `applyModelPrice` (medido 2026-09-23:
// ponía `amount = price_usd` con `discount = price_sale − price_usd`, así que una ficha de lista 28 y
// contado 25 se cobraba a 2·25 − 28 = **22**). Acá el contado entra por el DESCUENTO: 28 − 3 = 25.
//
// Consecuencia buscada: **el Total que muestra el formulario es exactamente el precio contado** de la
// ficha que se instala, igual que en Ventas («el cliente paga $X en efectivo»).
//
// Nota de compatibilidad: `price_usd` es «Efectivo ($) / precio contado / descuento» (`ProductForm`).
// Si una ficha no lo tiene cargado (hoy TODAS: medido en `registro.db` y en la plantilla), el precio
// del efectivo es el de venta y no hay descuento que inventar.

/** Los dos precios de una ficha del catálogo. */
export interface PriceParts {
  /** Precio de venta (el de la lista). */
  price_sale: number;
  /** Precio contado en efectivo (`Divisas (USD Cash)`). 0 = no está cargado. */
  price_usd: number;
}

/** Los dos campos de plata del formulario de servicio. */
export interface PriceFields {
  amount: number;
  discount: number;
}

/** ¿Los dos números son la misma plata? (centavos, para no comparar 12.500000001 con 12.5) */
export const sameMoney = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * El precio que se cobra por una ficha: el **contado** si el método es efectivo y está cargado; si no,
 * el de **venta**. `null` = esa ficha no tiene ningún precio cargado (no se inventa nada).
 */
export function partPrice(p: PriceParts, isDivisas: boolean): number | null {
  const venta = num(p.price_sale);
  const contado = num(p.price_usd);
  if (isDivisas && contado > 0) return contado;
  return venta > 0 ? venta : null;
}

/**
 * Monto y descuento de UNA ficha. `null` = sin precio cargado (el formulario no se toca y se avisa).
 *
 * - Efectivo con contado cargado: Monto = lista, Descuento = lista − contado (Total = contado).
 *   Si el contado es MAYOR que la lista (dato raro pero posible: un precio de efectivo mal cargado),
 *   el descuento es 0 y el Total es la lista — nunca un descuento negativo que infle la cuenta.
 * - Cualquier otro caso: Monto = precio de venta, sin descuento.
 */
export function priceFields(p: PriceParts, isDivisas: boolean): PriceFields | null {
  const venta = num(p.price_sale);
  const contado = num(p.price_usd);
  if (venta > 0) {
    const descuento = isDivisas && contado > 0 ? Math.max(0, venta - contado) : 0;
    return { amount: venta, discount: descuento };
  }
  // Sin precio de lista pero con contado cargado: se puede cobrar el contado sin descuento.
  if (isDivisas && contado > 0) return { amount: contado, discount: 0 };
  return null;
}

/**
 * El precio del **grupo de repuestos del modelo** (el respaldo de siempre, «el que está al lado de
 * modelos»): en efectivo, el contado más bajo del grupo; si no hay ninguno, el único precio de venta
 * positivo del grupo (si todos los repuestos que sirven valen lo mismo, ése es el precio del modelo).
 *
 * Con precios distintos entre repuestos **no se adivina**: `null` — es el operario el que elige la
 * pantalla y ahí sí hay un precio exacto. (Antes esto vivía en `applyModelPrice` y contaba los ceros
 * como si fueran otro precio: dos fichas sin precio y una con precio dejaban el monto vacío.)
 */
export function groupPriceFields(products: PriceParts[], isDivisas: boolean): PriceFields | null {
  if (products.length === 0) return null;
  if (isDivisas) {
    const conContado = products.filter(p => num(p.price_usd) > 0);
    if (conContado.length > 0) {
      const elegido = conContado.reduce((a, b) => (num(b.price_usd) < num(a.price_usd) ? b : a));
      return priceFields(elegido, true);
    }
  }
  const ventas = [...new Set(products.map(p => num(p.price_sale)).filter(v => v > 0))];
  return ventas.length === 1 ? { amount: ventas[0], discount: 0 } : null;
}

/**
 * Lo que se puede escribir en el formulario sin pisar al operario.
 *
 * **El precio sugerido es todo o nada con su monto**: el descuento calculado del efectivo (lista −
 * contado) es parte de LA OFERTA, no un descuento sobre cualquier número. Si el operario ya escribió
 * su propio monto (p. ej. 99), aplicarle el descuento del catálogo sería cobrarle menos de lo que él
 * pidió (quedaba Total 96 por un monto de 99) — así que con el monto tocado NO se toca el descuento.
 * Si lo que tocó fue el descuento, el monto sugerido sí se escribe (la rebaja es suya y se respeta).
 */
export function pricePatch(
  fields: PriceFields | null,
  touched: { amount: boolean; discount: boolean },
): Partial<PriceFields> {
  if (!fields) return {};
  const patch: Partial<PriceFields> = {};
  if (!touched.amount) patch.amount = fields.amount;
  if (!touched.discount && !touched.amount) patch.discount = fields.discount;
  return patch;
}

/**
 * Lo que se escribe cuando el operario TECLEA el monto: el monto es suyo, y el descuento CALCULADO
 * (el que puso la regla, que él no escribió) se va con el número viejo — nadie cobra una rebaja que el
 * operario no pidió sobre un precio que él escribió (con lista 28 / contado 25, teclear 30 dejaba
 * Total 27). Un descuento SUYO se conserva: `discountTouched` lo protege.
 */
export function amountTypedPatch(value: number, discountTouched: boolean): Partial<PriceFields> {
  return discountTouched ? { amount: value } : { amount: value, discount: 0 };
}

/** De dónde salió el monto que hay hoy en el campo (para poder decirlo en la pantalla). */
export type PriceSource = 'pantalla' | 'modelo' | 'manual' | 'vacio';

/**
 * La fuente del monto. `vacio` = todavía no hay monto (una orden de $0 es legítima: garantía,
 * cortesía); `manual` = es un número que no es ni el de la pantalla ni el del modelo (lo escribió el
 * operario, o es el precio que ya traía la orden).
 */
export function priceSource(amount: number, pantalla: number | null, modelo: number | null): PriceSource {
  const actual = num(amount);
  if (actual <= 0) return 'vacio';
  if (pantalla != null && sameMoney(actual, pantalla)) return 'pantalla';
  if (modelo != null && sameMoney(actual, modelo)) return 'modelo';
  return 'manual';
}
