// Pruebas PURAS de `src/lib/product-edit.ts` (Harness F80 — editar la ficha del repuesto desde el wizard).
//
// Fija las tres promesas que sostienen la feature:
//   · EDITAR EL PRECIO DESDE EL WIZARD NO PUEDE BORRAR EL RESTO DE LA FICHA (los 12 argumentos
//     posicionales de `update_product` se arman con la fila real; lo no tocado sale idéntico).
//   · LA COMPATIBILIDAD SE AGREGA SIN ROMPER NADA (sin duplicar, sin perder lo que ya había, leyendo
//     tanto el JSON guardado como el texto «A / B» de una ficha vieja).
//   · NADA SE INVENTA: un modelo vacío no agrega compatibilidad, y guardar sin cambios no se anuncia
//     como un cambio.
//
// Uso:  node tools/product_edit_test.ts

import {
  compatDesdeCrudo, compatTexto, tieneModelo, agregarModelo, nombreDePantallaNueva,
  argsUpdateProduct, patchTieneCambios, compatSiCambio, plegarNombre, fichaConNombre,
  MAX_COMPAT, type FichaProducto,
} from '../src/lib/product-edit.ts';

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

// ── 1. Leer la compatibilidad de la ficha (JSON guardado o texto «A / B») ────────────────────
{
  eq('JSON array → lista', compatDesdeCrudo('["Redmi Note 11","Redmi Note 11S"]'), ['Redmi Note 11', 'Redmi Note 11S']);
  eq('texto con barras → lista', compatDesdeCrudo('Honor X7 / Honor X8'), ['Honor X7', 'Honor X8']);
  eq('vacío → lista vacía', compatDesdeCrudo(''), []);
  eq('null → lista vacía', compatDesdeCrudo(null), []);
  eq('comillas y corchetes sueltos (JSON roto) no pierden la ficha',
    compatDesdeCrudo('[Samsung A06 4G'), ['Samsung A06 4G']);
  eq('saca vacíos y repetidos (normalizado)', compatDesdeCrudo('A06 4G /  / a06 4g / A06  4G'), ['A06 4G']);
  eq('respeta acentos y mayúsculas al mostrar', compatDesdeCrudo('["Moto G52","Moto G52"]'), ['Moto G52']);
  ok('tope de teléfonos por ficha', compatDesdeCrudo(JSON.stringify(Array.from({ length: MAX_COMPAT + 30 }, (_, i) => `T${i}`))).length === MAX_COMPAT);
  eq('texto para mostrar', compatTexto(['A06 4G', 'A06s']), 'A06 4G / A06s');
}

// ── 2. ¿Ese teléfono ya está? y AGREGARLO sin romper nada ────────────────────────────────────
{
  ok('modelo presente (misma caja)', tieneModelo(['Samsung A06 4G'], 'samsung a06 4g'));
  ok('modelo presente (sin acentos)', tieneModelo(['Moto G52'], 'MOTO G52'));
  ok('modelo ausente', !tieneModelo(['Honor X7'], 'Spark 10 Pro'));
  eq('modelo vacío no matchea nada', tieneModelo(['A'], ''), false);

  const r1 = agregarModelo(['Honor X7'], 'Spark 10 Pro');
  eq('agrega el modelo del equipo al final', r1.lista, ['Honor X7', 'Spark 10 Pro']);
  eq('y dice que agregó', r1.agregado, true);

  const r2 = agregarModelo(['Honor X7', 'Spark 10 Pro'], 'spark 10 pro');
  eq('no duplica (comparación normalizada)', r2.lista, ['Honor X7', 'Spark 10 Pro']);
  eq('y dice que NO agregó (no se miente)', r2.agregado, false);

  const r3 = agregarModelo(['Honor X7'], '   ');
  eq('modelo vacío no agrega', r3.lista, ['Honor X7']);
  eq('y lo dice', r3.agregado, false);

  const llena = Array.from({ length: MAX_COMPAT }, (_, i) => `T${i}`);
  eq('lista llena: no se pasa del tope', agregarModelo(llena, 'Nuevo').lista.length, MAX_COMPAT);
  eq('lista llena: y no dice que agregó', agregarModelo(llena, 'Nuevo').agregado, false);
}

// ── 3. El nombre de la pantalla que se registra desde el wizard ───────────────────────────────
{
  eq('nombre sugerido', nombreDePantallaNueva('Spark 10 Pro'), 'Pantalla Spark 10 Pro');
  eq('nombre sugerido sin espacios de sobra', nombreDePantallaNueva('  A06 4G  '), 'Pantalla A06 4G');
  eq('sin modelo → nombre genérico (no «Pantalla »)', nombreDePantallaNueva('   '), 'Pantalla nueva');
}

// ── 4. LOS 12 ARGUMENTOS: editar el precio NO puede tocar el resto de la ficha ───────────────
const filaBase: FichaProducto = {
  id: 42,
  name: 'Pantalla A06 4G (INCELL)',
  category_id: 1,
  brand: 'Samsung',
  model: 'A06 4G',
  variant: 'INCELL',
  compatibility: JSON.stringify(['Samsung A06 4G', 'Samsung A06s']),
  price_cost: 4.5,
  price_sale: 12,
  stock: 3,
  min_stock: 2,
  price_usd: 10,
};
{
  // Solo el precio de venta tocado: TODO lo demás sale idéntico a la fila (nombre, marca, modelo,
  // variante, compatibilidad cruda, costo, stock, stock mínimo, precio contado).
  const args = argsUpdateProduct(filaBase, { priceSale: 15 });
  eq('id', args[0], 42);
  eq('nombre intacto', args[1], 'Pantalla A06 4G (INCELL)');
  eq('categoría intacta', args[2], 1);
  eq('marca intacta', args[3], 'Samsung');
  eq('modelo intacto', args[4], 'A06 4G');
  eq('variante intacta', args[5], 'INCELL');
  eq('compatibilidad CRUDA intacta (no se reescribe sola)', args[6], filaBase.compatibility);
  eq('costo intacto', args[7], 4.5);
  eq('venta nueva', args[8], 15);
  eq('stock intacto', args[9], 3);
  eq('stock mínimo intacto', args[10], 2);
  eq('precio contado intacto', args[11], 10);
  eq('son 12 argumentos (la firma de update_product)', args.length, 12);

  // Compatibilidad editada: se guarda como JSON array (el formato que lee el backend) y con el
  // modelo del equipo agregado.
  const conModelo = agregarModelo(compatDesdeCrudo(filaBase.compatibility), 'Spark 10 Pro').lista;
  const args2 = argsUpdateProduct(filaBase, { compatibility: compatTexto(conModelo) });
  eq('compatibilidad editada → JSON array', args2[6], JSON.stringify(['Samsung A06 4G', 'Samsung A06s', 'Spark 10 Pro']));
  eq('y el precio de venta no se movió', args2[8], 12);
  eq('ni el stock', args2[9], 3);

  // Todo junto: precio + contado + stock + compatibilidad.
  const args3 = argsUpdateProduct(filaBase, { priceSale: 18, priceUsd: 16, stock: 8, compatibility: 'A06 4G' });
  eq('venta', args3[8], 18);
  eq('contado', args3[11], 16);
  eq('stock', args3[9], 8);
  eq('compat reemplazada por lo escrito', args3[6], JSON.stringify(['A06 4G']));
  eq('costo sigue intacto', args3[7], 4.5);
}

// ── 5. «¿Cambió algo?» — el Guardar no se ofrece de gusto ─────────────────────────────────────
{
  eq('sin patch → sin cambios', patchTieneCambios(filaBase, {}), false);
  eq('mismo precio → sin cambios', patchTieneCambios(filaBase, { priceSale: 12 }), false);
  eq('mismo stock → sin cambios', patchTieneCambios(filaBase, { stock: 3 }), false);
  eq('misma compatibilidad (otro orden) → sin cambios',
    patchTieneCambios(filaBase, { compatibility: 'Samsung A06s / Samsung A06 4G' }), false);
  eq('precio distinto → hay cambios', patchTieneCambios(filaBase, { priceSale: 12.5 }), true);
  eq('stock distinto → hay cambios', patchTieneCambios(filaBase, { stock: 0 }), true);
  eq('compatibilidad con un modelo más → hay cambios',
    patchTieneCambios(filaBase, { compatibility: 'Samsung A06 4G / Samsung A06s / Spark 10 Pro' }), true);
  eq('precio 0 es un cambio real (no se ignora)', patchTieneCambios(filaBase, { priceSale: 0 }), true);
  eq('stock 0 es un cambio real (no se ignora)', patchTieneCambios(filaBase, { stock: 0 }), true);
}

// ── 6. La compatibilidad solo viaja si CAMBIÓ (no se degrada una ficha con formato viejo) ─────
{
  // Ficha real del catálogo: el «/» de «(3 / 4)» ya está partido en dos entradas.
  const vieja: FichaProducto = { ...filaBase, compatibility: '["Alcatel 1B (3","Alcatel 4)"]' };
  eq('sin tocar la compatibilidad, el patch NO la manda (viaja la cruda tal cual)',
    compatSiCambio(vieja, 'Alcatel 1B (3 / Alcatel 4)'), undefined);
  // Y el argumento que sale es EXACTAMENTE la cadena guardada (no una re-serialización).
  eq('el argumento conserva la cadena original',
    argsUpdateProduct(vieja, { priceSale: 9, compatibility: compatSiCambio(vieja, 'Alcatel 1B (3 / Alcatel 4)') })[6],
    '["Alcatel 1B (3","Alcatel 4)"]');
  eq('y el precio sí viaja', argsUpdateProduct(vieja, { priceSale: 9 })[8], 9);

  // Si el operario AGREGA un teléfono, entonces sí se reescribe (con el formato del catálogo).
  eq('con un teléfono más, la compatibilidad sí viaja',
    compatSiCambio(vieja, 'Alcatel 1B (3 / Alcatel 4) / Spark 10 Pro'),
    'Alcatel 1B (3 / Alcatel 4) / Spark 10 Pro');
  eq('y se guarda como JSON array',
    argsUpdateProduct(vieja, { compatibility: compatSiCambio(vieja, 'Alcatel 1B (3 / Alcatel 4) / Spark 10 Pro') })[6],
    JSON.stringify(['Alcatel 1B (3', 'Alcatel 4)', 'Spark 10 Pro']));
  eq('reordenar los mismos teléfonos NO cuenta como cambio',
    compatSiCambio(vieja, 'Alcatel 4) / Alcatel 1B (3'), undefined);
}

// ── 7. No crear fichas GEMELAS desde el wizard (dos fichas parten el stock) ───────────────────
{
  const catalogo = [
    { id: 1, name: 'Pantalla Spark 10 Pro' },
    { id: 2, name: '  pantalla   SPARK 10 PRO (INCELL) ' },
    { id: 3, name: 'Batería A06' },
  ];
  eq('encuentra la ficha por nombre plegado (mayúsculas y espacios)',
    fichaConNombre(catalogo, 'Pantalla Spark 10 Pro')?.id, 1);
  eq('encuentra la que tiene variante en el nombre',
    fichaConNombre(catalogo, 'Pantalla SPARK 10 PRO (Incell)')?.id, 2);
  eq('otra categoría no matchea por accidente', fichaConNombre(catalogo, 'Batería A06')?.id, 3);
  eq('nombre nuevo → null (se puede crear)', fichaConNombre(catalogo, 'Pantalla Zzz 9'), null);
  eq('nombre vacío → null (no matchea todo)', fichaConNombre(catalogo, '   '), null);
  eq('plegado: saca acentos', plegarNombre('Pantalla Alcatel 1B (3 / 4)'), 'pantalla alcatel 1b (3 / 4)');
}

console.log(`\nproduct_edit: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallas`);
if (failures > 0) process.exit(1);
