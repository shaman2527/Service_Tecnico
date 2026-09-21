// F52 — VARIANTES de los repuestos: cómo se llaman, cómo se agrupan y cómo se muestra el rango.
//
// El local trabaja con 4 materiales y sus marcos. Los valores REALES del catálogo son:
//   INCELL · OLED · «OLED Con Marco» · ORIGINAL · «INCELL Con Marco» · «ORIGINAL Con Marco» ·
//   «ORIGINAL Sin Marco» … y 613 fichas SIN variante.
//
// REGLAS (una sola implementación de cada una):
//   · **La FAMILIA es el MATERIAL**: la primera palabra. Quien pide «una OLED» acepta «OLED» y
//     «OLED Con Marco». El filtro del inventario agrupa así (el backend escribe la MISMA regla en
//     SQL: `VARIANT_FAMILY_SQL`, con un test de paridad Rust↔SQL) y los chips muestran el texto real.
//   · **El orden es canónico** (INCELL → OLED → AM → ORIGINAL, pelado antes de sus marcos) para que
//     la lista se lea siempre igual; lo calcula el BACKEND (`catalog::variant_rank`) al armar la
//     respuesta — acá NO se reordena nada, para no tener dos órdenes distintos.
//   · **El rango de precios** ignora las fichas sin precio (0): si ninguna tiene, se dice «sin
//     precio» en vez de mostrar «$0.00», que se leería como un repuesto gratis.

/** ¿La ficha no tiene variante cargada? */
export function isNoVariant(variant: string | null | undefined): boolean {
  return !String(variant ?? '').trim();
}

/** Nombre para mostrar de una variante (`''` → «Sin variante», que es como lo lee el mostrador). */
export function variantLabel(variant: string | null | undefined): string {
  const v = String(variant ?? '').trim();
  return v === '' ? 'Sin variante' : v;
}

/** Nombre para mostrar de una FAMILIA de variante (`''` → «Sin variante»). */
export function variantFamilyLabel(family: string | null | undefined): string {
  const f = String(family ?? '').trim();
  if (f === '') return 'Sin variante';
  // El resto se muestra como lo escribe el taller (INCELL, OLED, ORIGINAL, AM): en mayúsculas.
  return f.toUpperCase();
}

/**
 * Texto del rango de precios de un modelo: un solo precio, un rango, o «sin precio».
 * Los montos van en dólares con 2 decimales (es el precio de venta del catálogo).
 */
export function priceRangeLabel(min: number, max: number): string {
  const a = Number(min) || 0;
  const b = Number(max) || 0;
  if (a <= 0 && b <= 0) return 'sin precio';
  if (a > 0 && b > 0 && Math.abs(a - b) > 0.004) return `$${a.toFixed(2)} – $${b.toFixed(2)}`;
  const solo = a > 0 ? a : b;
  return `$${solo.toFixed(2)}`;
}

/** Texto de la cantidad de repuestos de un modelo («1 pantalla» / «4 repuestos»). */
export function partsCountLabel(n: number): string {
  const total = Number(n) || 0;
  if (total === 1) return '1 repuesto';
  return `${total} repuestos`;
}
