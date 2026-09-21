// Prueba de las reglas PURAS de F52 (`src/lib/variant.ts`): cómo se llama una variante, cómo se
// llama su familia y cómo se escribe el rango de precios. Sin app, sin navegador: `node tools/variant_test.ts`.
//
// El ORDEN canónico NO se prueba acá porque vive en el backend (`catalog::variant_rank`, probado en
// `test_variant_order_is_canonical`): la app muestra las variantes en el orden en que se las mandan,
// justamente para no tener dos órdenes distintos.

import {
  isNoVariant, variantLabel, variantFamilyLabel, priceRangeLabel, partsCountLabel,
} from '../src/lib/variant.ts';

let ok = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { ok += 1; console.log(`PASS  ${name}${detail ? `  ->  ${detail}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? `  ->  ${detail}` : ''}`); }
};

// ── 1) «sin variante» se reconoce en todas sus formas ───────────────────────────────────────────
for (const v of ['', '   ', null, undefined]) {
  check(`isNoVariant(${JSON.stringify(v)})`, isNoVariant(v as string | null));
}
for (const v of ['INCELL', 'OLED', 'OLED Con Marco']) {
  check(`isNoVariant(${JSON.stringify(v)}) = false`, !isNoVariant(v));
}

// ── 2) etiquetas: nunca una celda vacía en el inventario ────────────────────────────────────────
check('la variante vacía se dice «Sin variante»', variantLabel('') === 'Sin variante', variantLabel(''));
check('la variante real se muestra tal cual (el taller la escribe en mayúscula)',
  variantLabel('OLED Con Marco') === 'OLED Con Marco', variantLabel('OLED Con Marco'));
check('la variante con espacios de más se recorta',
  variantLabel('  OLED  ') === 'OLED', `«${variantLabel('  OLED  ')}»`);
check('la familia vacía se dice «Sin variante»', variantFamilyLabel('') === 'Sin variante');
check('la familia se muestra en MAYÚSCULA (es lo que el local pide en el mostrador)',
  variantFamilyLabel('oled') === 'OLED' && variantFamilyLabel('incell') === 'INCELL',
  `${variantFamilyLabel('oled')} · ${variantFamilyLabel('incell')}`);

// ── 3) el rango de precios: un precio, un rango o «sin precio» ──────────────────────────────────
check('un solo precio (min = max) se dice una vez', priceRangeLabel(12.5, 12.5) === '$12.50', priceRangeLabel(12.5, 12.5));
check('un rango real se dice con las dos puntas', priceRangeLabel(10, 15) === '$10.00 – $15.00', priceRangeLabel(10, 15));
check('sin precios cargados NO dice $0.00 (se leería como gratis)', priceRangeLabel(0, 0) === 'sin precio', priceRangeLabel(0, 0));
check('solo la punta alta cargada se dice igual', priceRangeLabel(0, 8) === '$8.00', priceRangeLabel(0, 8));
check('solo la punta baja cargada se dice igual', priceRangeLabel(8, 0) === '$8.00', priceRangeLabel(8, 0));
check('una diferencia de centavos NO inventa un rango (redondeo del catálogo)',
  priceRangeLabel(10, 10.002) === '$10.00', priceRangeLabel(10, 10.002));
check('los valores raros (NaN / undefined) caen en «sin precio»',
  priceRangeLabel(NaN, NaN) === 'sin precio' && priceRangeLabel(undefined as unknown as number, 0) === 'sin precio');

// ── 4) la cantidad de repuestos ─────────────────────────────────────────────────────────────────
check('1 repuesto se dice en singular', partsCountLabel(1) === '1 repuesto', partsCountLabel(1));
check('4 repuestos se dicen en plural', partsCountLabel(4) === '4 repuestos', partsCountLabel(4));
check('0 repuestos no rompe', partsCountLabel(0) === '0 repuestos', partsCountLabel(0));

console.log(`\n${ok}/${ok + fail} comprobaciones OK${fail ? ` — FALLAN ${fail}` : ''}`);
process.exit(fail ? 1 : 0);
