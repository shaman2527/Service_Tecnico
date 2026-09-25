// Pruebas PURAS de `src/lib/screen-price.ts` (Harness F67).
//
// Fija la regla del precio del repuesto que pidió el dueño: «cuando yo seleccione una pantalla [que]
// pueda tomar el precio de venta de ese producto, o se puede seguir usando también el que tengo al
// lado de modelos». Lo que se comprueba acá es LA CUENTA (que el Total sea el precio que se cobra de
// verdad) y quién manda cuando hay dos ofertas y cuando el operario ya escribió un monto.
//
// Uso:  node tools/screen_price_test.ts

import {
  partPrice, priceFields, groupPriceFields, pricePatch, amountTypedPatch, priceSource, sameMoney,
} from '../src/lib/screen-price.ts';

let checks = 0;
let failures = 0;

function eq(what: string, got: unknown, want: unknown) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FALLA · ${what}\n   esperado: ${JSON.stringify(want)}\n   obtenido: ${JSON.stringify(got)}`);
  }
}
function ok(what: string, cond: boolean) {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
}

const ficha = (price_sale: number, price_usd = 0) => ({ price_sale, price_usd });

// ── 1. El precio de UNA ficha: venta, y el contado solo en efectivo ─────────────────────────────
{
  eq('venta 12.50 sin contado (otro método) → 12.50', partPrice(ficha(12.5), false), 12.5);
  eq('venta 12.50 sin contado (efectivo) → 12.50 (no hay contado que cobrar)', partPrice(ficha(12.5), true), 12.5);
  eq('venta 28 con contado 25 (efectivo) → 25', partPrice(ficha(28, 25), true), 25);
  eq('venta 28 con contado 25 (Pago Móvil) → 28: el contado es SOLO del efectivo', partPrice(ficha(28, 25), false), 28);
  eq('sin precio de venta ni contado → null (no se inventa)', partPrice(ficha(0), false), null);
  eq('sin venta pero con contado 25 y efectivo → 25', partPrice(ficha(0, 25), true), 25);
  eq('sin venta pero con contado 25 y otro método → null (no se cobra el contado fuera del efectivo)',
    partPrice(ficha(0, 25), false), null);
}

// ── 2. Monto/Descuento: el Total tiene que ser el precio que se cobra ───────────────────────────
{
  // El caso que estaba mal (bug medido): lista 28, contado 25 → el cliente paga 25, no 22.
  const cash = priceFields(ficha(28, 25), true);
  eq('efectivo con contado: Monto = lista', cash?.amount, 28);
  eq('efectivo con contado: Descuento = lista − contado', cash?.discount, 3);
  eq('TOTAL (Monto − Descuento) = el precio contado, no 2·contado − lista',
    (cash?.amount ?? 0) - (cash?.discount ?? 0), 25);

  eq('sin contado cargado (hoy la realidad): Monto = venta, sin descuento inventado',
    priceFields(ficha(12.5), true), { amount: 12.5, discount: 0 });
  eq('otro método con contado cargado: el contado NO entra (Pago Móvil paga lista)',
    priceFields(ficha(28, 25), false), { amount: 28, discount: 0 });
  eq('contado MAYOR que la lista: descuento 0 (nunca una rebaja negativa que infle la cuenta)',
    priceFields(ficha(20, 25), true), { amount: 20, discount: 0 });
  eq('contado igual a la lista: descuento 0', priceFields(ficha(25, 25), true), { amount: 25, discount: 0 });
  eq('sin precio de venta pero con contado y efectivo: se cobra el contado sin descuento',
    priceFields(ficha(0, 25), true), { amount: 25, discount: 0 });
  eq('ficha sin ningún precio → null (el formulario no se toca)', priceFields(ficha(0), true), null);
  eq('precio negativo cargado a mano → null (no se cobra al revés)',
    priceFields(ficha(-5), true), null);
}

// ── 3. El precio del MODELO (el respaldo de siempre) ────────────────────────────────────────────
{
  eq('grupo sin fichas → null', groupPriceFields([], false), null);
  eq('todos los repuestos al mismo precio → ése es el precio del modelo',
    groupPriceFields([ficha(12.5), ficha(12.5), ficha(12.5)], false), { amount: 12.5, discount: 0 });
  eq('precios distintos y sin contado → null (no se adivina: el operario elige la pantalla)',
    groupPriceFields([ficha(12.5), ficha(15)], false), null);
  eq('efectivo con contados distintos → el contado MÁS BAJO del grupo, con SU lista',
    groupPriceFields([ficha(28, 25), ficha(30, 27)], true), { amount: 28, discount: 3 });
  eq('efectivo sin ningún contado cargado → cae al precio de venta único del grupo',
    groupPriceFields([ficha(12.5), ficha(12.5)], true), { amount: 12.5, discount: 0 });
  eq('una ficha sin precio NO bloquea al grupo (antes dejaba el monto vacío)',
    groupPriceFields([ficha(0), ficha(12.5), ficha(12.5)], false), { amount: 12.5, discount: 0 });
  eq('grupo con varias fichas sin precio → null', groupPriceFields([ficha(0), ficha(0)], false), null);
}

// ── 4. Lo que el operario escribió NO se pisa ───────────────────────────────────────────────────
{
  const fields = { amount: 28, discount: 3 };
  eq('sin tocar nada: se aplican los dos', pricePatch(fields, { amount: false, discount: false }), fields);
  // El descuento CALCULADO es parte de la oferta, no un descuento sobre cualquier número: si el
  // operario escribió su precio (99), aplicarle el 3 del catálogo le cobraría 96 por un precio de 99.
  eq('monto tocado a mano: NO se aplica nada (ni el monto ni el descuento calculado)',
    pricePatch(fields, { amount: true, discount: false }), {});
  eq('descuento tocado a mano (el suyo se respeta): se sugiere el monto',
    pricePatch(fields, { amount: false, discount: true }), { amount: 28 });
  eq('los dos tocados: NO se toca nada', pricePatch(fields, { amount: true, discount: true }), {});
  eq('sin precio en la ficha: no se toca nada (ni el monto ni el descuento)',
    pricePatch(null, { amount: false, discount: false }), {});
  eq('precio sin descuento (efectivo sin contado cargado) con el monto intacto',
    pricePatch({ amount: 12.5, discount: 0 }, { amount: false, discount: false }), { amount: 12.5, discount: 0 });
}

// ── 4b. El monto que TECLEA el operario se lleva el descuento calculado ─────────────────────────
{
  eq('teclear el monto con un descuento que puso la regla: el descuento se va (cobra lo que escribió)',
    amountTypedPatch(30, false), { amount: 30, discount: 0 });
  eq('teclear el monto con un descuento SUYO: se conserva (la rebaja la pidió él)',
    amountTypedPatch(30, true), { amount: 30 });
  // El caso medido por la revisión adversarial: lista 28 / contado 25, el operario teclea 30 →
  // con el descuento viejo quedaba Total 27; ahora el Total es 30, lo que él escribió.
  eq('Total = lo que escribió el operario (no 30 − 3)',
    (amountTypedPatch(30, false).amount ?? 0) - (amountTypedPatch(30, false).discount ?? 0), 30);
}

// ── 5. De dónde salió el monto (el rótulo que ve el operario) ───────────────────────────────────
{
  eq('sin monto → vacio', priceSource(0, 12.5, 15), 'vacio');
  eq('el monto es el de la pantalla elegida → pantalla', priceSource(12.5, 12.5, 15), 'pantalla');
  eq('pantalla sin precio: el monto es el del modelo → modelo', priceSource(15, null, 15), 'modelo');
  eq('un monto escrito a mano → manual', priceSource(99, 12.5, 15), 'manual');
  eq('la pantalla MANDA: si el monto es de los dos a la vez, se dice pantalla',
    priceSource(12.5, 12.5, 12.5), 'pantalla');
  eq('centavos: 12.50 es el mismo número que 12.5', priceSource(12.5, 12.50, null), 'pantalla');
  ok('12.50 no es 12.51', !sameMoney(12.5, 12.51));
  ok('12.5 sí es 12.5000001 (ruido de punto flotante)', sameMoney(12.5, 12.5000001));
}

// ── 6. La cuenta completa del mostrador (extremo a extremo con las tres reglas juntas) ─────────
{
  // El taller elige un modelo con dos pantallas compatibles y elige LA CARA: el precio es el de ESA
  // ficha, y el Total es lo que se le cobra al cliente.
  const elegida = priceFields(ficha(28, 25), true)!;
  const monto = pricePatch(elegida, { amount: false, discount: false });
  eq('pantalla elegida de lista 28 / contado 25 en efectivo → Monto 28', monto.amount, 28);
  eq('   …Descuento 3 → Total 25 (el precio contado de ESA ficha)',
    (monto.amount ?? 0) - (monto.discount ?? 0), partPrice(ficha(28, 25), true));
  eq('y el rótulo dice que el precio es el de la pantalla', priceSource(monto.amount ?? 0, 28, 30), 'pantalla');

  // La MISMA ficha pero cobrando por Pago Móvil: se cobra la lista (el contado es solo del efectivo).
  const movil = pricePatch(priceFields(ficha(28, 25), false), { amount: false, discount: false });
  eq('la misma ficha por Pago Móvil → Monto 28 sin descuento',
    { amount: movil.amount, discount: movil.discount }, { amount: 28, discount: 0 });
}

console.log(`\nscreen_price_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
