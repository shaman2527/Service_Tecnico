// Pruebas PURAS de `src/lib/product-categories.ts` (Harness F65).
//
// Las categorías de PRODUCTO dejaron de ser una lista cerrada: se crean, se corrigen y se borran
// desde el inventario. Acá se fija lo que la PANTALLA decide antes de llamar al backend — el mismo
// criterio que valida `add_category`/`rename_category`/`delete_category` en db.rs:
//   · el nombre plegado (mayúsculas y acentos no cuentan) no se puede repetir;
//   · tope de largo y nada de nombres vacíos;
//   · una categoría con productos NO se borra, y las del padrón de teléfonos son fijas;
//   · los textos que ve el operario (uso, resultado de crear).
//
// Uso:  node tools/category_rules_test.ts

import {
  CATEGORY_NAME_MAX, foldCategory, categoryProblem, categoryNameOk, categoryDeleteBlock,
  categoryUsageLabel, categoryOutcomeToast,
} from '../src/lib/product-categories.ts';

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

const CATS = [
  { id: 1, name: 'Pantalla' },
  { id: 2, name: 'Batería' },
  { id: 7, name: 'Tapa trasera' },
];

// ── 1. Plegado: el MISMO criterio que el backend (`plegar_texto`) ────────────────────────────
{
  eq('mayúsculas no cambian el nombre', foldCategory('CAMARAS'), foldCategory('camaras'));
  eq('los acentos no cambian el nombre', foldCategory('Cámaras'), foldCategory('camaras'));
  eq('los espacios de más no cambian el nombre', foldCategory('  Tapa   trasera '), foldCategory('tapa trasera'));
  eq('un nombre vacío pliega a vacío', foldCategory('   '), '');
  eq('null/undefined no rompen el plegado', [foldCategory(null), foldCategory(undefined)], ['', '']);
  // F65 (2ª vuelta) — PARIDAD CON EL BACKEND: `plegar_texto` DESCARTA lo no alfanumérico (no lo
  // convierte en espacio). Con el plegado viejo (`normPhoneModel`) la pantalla decía «no existe» un
  // nombre que el backend reconocía como repetido.
  eq('el plegado descarta los espacios, como el backend', foldCategory('Tapa trasera'), 'tapatrasera');
  eq('y por eso «Tapatrasera» ES el mismo nombre que «Tapa trasera»',
    foldCategory('Tapatrasera'), foldCategory('Tapa trasera'));
  eq('los guiones y puntos tampoco separan', foldCategory('Tapa-trasera.'), foldCategory('Tapa trasera'));
}

// ── 2. El nombre se puede guardar o no ──────────────────────────────────────────────────────
{
  const vacia = categoryProblem('   ', CATS);
  eq('vacío → problema', vacia?.kind, 'vacia');
  ok('la vacía se explica en castellano', !!vacia && /Escribí el nombre/.test(vacia.message));

  const larga = categoryProblem('x'.repeat(CATEGORY_NAME_MAX + 1), CATS);
  eq(`más de ${CATEGORY_NAME_MAX} caracteres → problema`, larga?.kind, 'larga');
  ok('el borde exacto SÍ se acepta', categoryNameOk('x'.repeat(CATEGORY_NAME_MAX), CATS));

  const dup = categoryProblem('pantalla', CATS);
  eq('duplicado por mayúsculas → problema', dup?.kind, 'duplicada');
  eq('el duplicado apunta a la que ya existe', dup?.existingId, 1);
  ok('el aviso nombra la categoría existente', !!dup && dup.message.includes('«Pantalla»'));
  eq('duplicado por acentos → problema', categoryProblem('BATERIA', CATS)?.kind, 'duplicada');
  // F65 (2ª vuelta): el duplicado también se ve cuando lo único que cambia es el ESPACIO, porque el
  // backend lo ve igual (antes la pantalla habilitaba «Crear y usar» y el toast avisaba después).
  eq('duplicado sin el espacio → problema', categoryProblem('Tapatrasera', CATS)?.kind, 'duplicada');

  // Un nombre SIN ninguna letra ni número plegaba a la clave vacía: dos categorías distintas quedaban
  // como la misma y la segunda no se podía crear (colisión silenciosa).
  const sinLetras = categoryProblem('🔧🔧', CATS);
  eq('un nombre sin letras ni números → problema', sinLetras?.kind, 'sin-letras');
  ok('y se explica', !!sinLetras && /letra o un número/.test(sinLetras.message));

  // El tope se cuenta en CARACTERES REALES (code points), igual que `chars().count()` del backend:
  // con `.length` (unidades UTF-16) 20 emojis contaban 40 de más y la UI rechazaba antes que el backend.
  const conEmoji = 'a'.repeat(20) + '🔧'.repeat(20);
  eq('el caso de prueba tiene 40 caracteres reales y 60 unidades UTF-16',
    [[...conEmoji].length, conEmoji.length], [40, 60]);
  ok('el tope se cuenta en caracteres reales', categoryNameOk(conEmoji, CATS));
  eq('con 41 caracteres reales ya no', categoryProblem(`${conEmoji}b`, CATS)?.kind, 'larga');

  eq('un nombre nuevo no tiene problema', categoryProblem('Cámaras', CATS), null);
  ok('y se puede guardar', categoryNameOk('Cámaras', CATS));

  // Renombrar: consigo misma no hay duplicado (corregir «Tapa trasera» → «TAPA TRASERA» no es error)…
  eq('renombrar a su propio nombre no es duplicado', categoryProblem('TAPA TRASERA', CATS, 7), null);
  ok('y el botón queda habilitado', categoryNameOk('tapa   trasera', CATS, 7));
  // …y un nombre nuevo tampoco.
  eq('renombrar a un nombre nuevo se permite', categoryProblem('Cámaras', CATS, 7), null);
  // …pero sí lo es contra OTRA categoría.
  const contraOtra = categoryProblem('BATERIA', CATS, 7);
  eq('renombrar a una que ya existe → problema', contraOtra?.kind, 'duplicada');
  eq('y apunta a la otra categoría (no a la que se está editando)', contraOtra?.existingId, 2);
}

// ── 3. Borrar: con productos no, del padrón tampoco ─────────────────────────────────────────
{
  eq('categoría vacía → se puede borrar', categoryDeleteBlock({ products: 0, phone_padron: false }), null);

  const conUno = categoryDeleteBlock({ products: 1, phone_padron: false });
  ok('con 1 producto se bloquea', !!conUno && /1 producto\b/.test(conUno));
  const conDoce = categoryDeleteBlock({ products: 12, phone_padron: false });
  ok('con 12 dice «12 productos»', !!conDoce && /12 productos/.test(conDoce));
  ok('y dice el remedio', !!conDoce && /pasalos a otra categoría/.test(conDoce));

  const padron = categoryDeleteBlock({ products: 0, phone_padron: true });
  ok('del padrón de teléfonos se bloquea aunque esté vacía', !!padron && /padrón de teléfonos/.test(padron));
  const padronConProductos = categoryDeleteBlock({ products: 400, phone_padron: true });
  ok('y el motivo que manda es el del padrón', !!padronConProductos && /padrón de teléfonos/.test(padronConProductos));
}

// ── 4. Textos de uso y de resultado ─────────────────────────────────────────────────────────
{
  eq('sin productos', categoryUsageLabel({ products: 0, units: 0 }), 'sin productos');
  eq('un producto', categoryUsageLabel({ products: 1, units: 1 }), '1 producto · 1 u.');
  eq('varios', categoryUsageLabel({ products: 12, units: 30 }), '12 productos · 30 u.');
  eq('stock negativo también se dice', categoryUsageLabel({ products: 2, units: -3 }), '2 productos · -3 u.');

  eq('categoría nueva', categoryOutcomeToast(true, 'Tapa trasera'), 'Categoría «Tapa trasera» creada');
  eq('ya existía (no se creó una gemela)', categoryOutcomeToast(false, 'Pantalla'),
    '«Pantalla» ya existía: quedó elegida');
  ok('el aviso de «ya existía» NO dice «creada»',
    !categoryOutcomeToast(false, 'Pantalla').includes('creada'));
}

console.log(`\ncategory_rules_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
