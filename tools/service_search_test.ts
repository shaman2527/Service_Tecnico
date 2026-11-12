// Pruebas PURAS de `src/lib/service-search.ts` (Harness F96 — buscador instantáneo de Servicio Técnico).
//
// Lo que se fija acá es la regla que hace que la búsqueda pueda resolverse en memoria sin cambiar el
// resultado que ve el operario:
//   1. la consulta busca en LOS MISMOS campos que el backend (`client`, `model`, `order_num`, `phone`,
//      `client_ci`) y en ningún otro,
//   2. pliega acentos y mayúsculas (mejora: «perez» encuentra «Pérez»),
//   3. acepta varias palabras en cualquier orden (mejora),
//   4. y —la prueba que de verdad importa— **nunca es más restrictiva** que el `LIKE` del backend:
//      toda fila que el backend devolvería para esa consulta también la devuelve esta regla. Si esa
//      prueba falla, la optimización estaría escondiendo órdenes.
//
// Uso:  node tools/service_search_test.ts

import {
  SERVICE_SEARCH_FIELDS, foldSearch, searchTokens, searchHaystack, matchesServiceSearch,
  filterServicesBySearch, type SearchableService,
} from '../src/lib/service-search.ts';

let checks = 0;
let failures = 0;

function ok(what: string, cond: boolean, detalle = '') {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}${detalle ? ` — ${detalle}` : ''}`); }
}

/** Fila de servicio con lo que mira el buscador (el resto de las columnas no entra). */
const fila = (p: Partial<SearchableService>): SearchableService => ({
  client: '', model: '', order_num: '', phone: '', client_ci: '', ...p,
});

// ── 1. Plegado: mayúsculas, acentos y espacios ───────────────────────────────────────────────────
{
  ok('foldSearch baja a minúsculas', foldSearch('MARÍA') === 'maria');
  ok('foldSearch saca los acentos', foldSearch('Pérez') === 'perez');
  ok('foldSearch saca la diéresis y la ñ sin perder la letra', foldSearch('Muñoz Güell') === 'munoz guell');
  ok('foldSearch colapsa espacios de más', foldSearch('  juan   perez  ') === 'juan perez');
  ok('foldSearch aguanta null/undefined (una orden vieja sin cédula)', foldSearch(null) === '' && foldSearch(undefined) === '');
  ok('searchTokens parte por palabras', JSON.stringify(searchTokens(' Ana  PÉREZ ')) === '["ana","perez"]');
  ok('searchTokens de vacío no da palabras', searchTokens('   ').length === 0 && searchTokens('').length === 0);
}

// ── 2. Los campos: los mismos del backend, y ninguno escondido ────────────────────────────────────
{
  ok('los 5 campos son los del LIKE del backend',
    JSON.stringify([...SERVICE_SEARCH_FIELDS]) === '["client","model","order_num","phone","client_ci"]');
  ok('el pajar tiene los cinco campos (no se olvidó ninguno)',
    searchHaystack(fila({ client: 'c', model: 'm', order_num: 'o', phone: 'p', client_ci: 'i' })) === 'c\u0000m\u0000o\u0000p\u0000i');
  ok('una fila vacía no tiene pajar', searchHaystack(fila({})) === '');

  const buscables: [string, SearchableService, string][] = [
    ['cliente', fila({ client: 'María Pérez' }), 'perez'],
    ['modelo', fila({ model: 'Samsung A70' }), 'a70'],
    ['número de orden', fila({ order_num: 'DEV-0007' }), 'dev-0007'],
    ['teléfono', fila({ phone: '0412-1234567' }), '1234567'],
    ['cédula', fila({ client_ci: 'V-12345678' }), '12345678'],
  ];
  for (const [nombre, f, q] of buscables) ok(`encuentra por ${nombre}`, matchesServiceSearch(f, q));
  ok('NO busca en la falla (igual que el backend: ahí no se busca)',
    matchesServiceSearch(fila({ client: 'Ana' }), 'no enciende') === false);
}

// ── 3. Las dos mejoras (acentos y varias palabras) ───────────────────────────────────────────────
{
  ok('«perez» encuentra «Pérez»', matchesServiceSearch(fila({ client: 'Pérez, Juan' }), 'perez'));
  ok('«PÉREZ» encuentra «perez»', matchesServiceSearch(fila({ client: 'juan perez' }), 'PÉREZ'));
  ok('«munoz» encuentra «Muñoz»', matchesServiceSearch(fila({ client: 'Ana Muñoz' }), 'munoz'));
  ok('varias palabras en cualquier orden: «perez maria» encuentra «María Pérez»',
    matchesServiceSearch(fila({ client: 'María Pérez' }), 'perez maria'));
  ok('varias palabras pueden caer en campos distintos («juan a70»: cliente + modelo)',
    matchesServiceSearch(fila({ client: 'Juan Pérez', model: 'Samsung A70' }), 'juan a70'));
  ok('si falta una palabra, no entra', matchesServiceSearch(fila({ client: 'María Pérez' }), 'perez pedro') === false);
  ok('una palabra no se «cose» entre dos campos distintos',
    matchesServiceSearch(fila({ client: 'Ana', model: 'Lopez' }), 'analopez') === false);
}

// ── 4. Sin consulta: la lista entra ENTERA y sin copiarse ─────────────────────────────────────────
{
  const rows = [fila({ client: 'Ana' }), fila({ client: 'Beto' })];
  ok('sin consulta entran todas', filterServicesBySearch(rows, '').length === 2);
  ok('sin consulta devuelve LA MISMA lista (no una copia: el render no se ensucia)',
    filterServicesBySearch(rows, '') === rows);
  ok('solo espacios cuenta como sin consulta', filterServicesBySearch(rows, '   ') === rows);
  ok('con consulta sí devuelve una lista nueva y filtrada',
    filterServicesBySearch(rows, 'ana').length === 1 && filterServicesBySearch(rows, 'ana') !== rows);
  ok('una consulta sin resultados da lista vacía (el estado vacío de la pantalla)',
    filterServicesBySearch(rows, 'zzz').length === 0);

  // Los COMODINES del LIKE (`%`, `_`) no se interpretan ni esconden la lista: en el backend son
  // comodines (`%q%` sin escapar) y una consulta hecha sólo de ellos NO filtra; tomados literalmente
  // acá esconderían casi todo, que es justo lo que la regla no puede hacer.
  ok('una consulta de sólo «%» no filtra (igual que el LIKE del backend)', filterServicesBySearch(rows, '%') === rows);
  ok('una consulta de sólo «_» no filtra', filterServicesBySearch(rows, '_') === rows);
  ok('«%_%» tampoco filtra', filterServicesBySearch(rows, '%_%') === rows);
  ok('«ana%» busca «ana» (el comodín se descarta, no se busca literal)',
    filterServicesBySearch(rows, 'ana%').length === 1);
  ok('searchTokens limpia los comodines', JSON.stringify(searchTokens('ana% _')) === '["ana"]');
}

// ── 5. LA PRUEBA QUE MANDA: nunca es MÁS RESTRICTIVO que el LIKE del backend ─────────────────────
// Reimplementación fiel del `LIMPIAR ... LIKE %q%` de SQLite: la comparación de LIKE pliega SOLO
// ASCII (A-Z), así que 'Pérez' NO matchea 'PÉREZ' en el backend. Si nuestra regla devuelve toda fila
// que el LIKE devolvería, el operario no puede perder una orden por este cambio.
const likeBackend = (row: SearchableService, q: string): boolean => {
  const pliegaAscii = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase());
  const aguja = pliegaAscii(q);
  if (!aguja) return true;
  return SERVICE_SEARCH_FIELDS.some(c => pliegaAscii(String(row[c] ?? '')).includes(aguja));
};

{
  const base: SearchableService[] = [
    fila({ client: 'María Pérez', model: 'Samsung A70', order_num: 'DEV-0001', phone: '0412-1112233', client_ci: 'V-11112222' }),
    fila({ client: 'PEREZ MARIA', model: 'Xiaomi Redmi 9A', order_num: 'DEV-0002', phone: '0424-9998877', client_ci: 'V-99998888' }),
    fila({ client: 'José Ángel', model: 'Honor X7', order_num: 'DEV-0003', phone: '', client_ci: '' }),
    fila({ client: 'Ana', model: 'iPhone 11', order_num: 'DEV-0004', phone: '0416-5556677', client_ci: 'E-12345678' }),
    fila({ client: '', model: '', order_num: 'DEV-0005', phone: '', client_ci: '' }),
  ];
  const consultas = [
    'perez', 'PEREZ', 'Pérez', 'PÉREZ', 'mar', 'MARIA', 'a70', 'A70', 'DEV-0002', 'dev-0002',
    '0001', '0412', 'V-11', 'e-1234', 'jose', 'José', 'angel', 'x7', 'X7', 'redmi 9a', 'iphone',
    'perez maria', 'ana a70', 'zzz', '77', '-', '',
  ];
  let comprobaciones = 0;
  for (const q of consultas) {
    const delBackend = base.filter(r => likeBackend(r, q));
    const nuestras = filterServicesBySearch(base, q);
    const faltan = delBackend.filter(r => !nuestras.includes(r));
    ok(`la búsqueda «${q}» no pierde NINGUNA fila que traería el backend`, faltan.length === 0,
      faltan.map(r => r.client || r.order_num).join(', '));
    comprobaciones++;
  }
  ok('la prueba de equivalencia cubrió una batería real de consultas', comprobaciones === consultas.length);

  // Y la contracara: cuando el backend SÍ encuentra algo, nosotros también (mismo conjunto o más).
  ok('«Pérez» encuentra las dos grafías (el backend solo una): es MEJORA, no pérdida',
    filterServicesBySearch(base, 'Pérez').length === 2 && base.filter(r => likeBackend(r, 'Pérez')).length === 1);
}

// ── 6. Rendimiento: filtrar la lista completa es despreciable (por eso se puede hacer por tecla) ──
{
  const grande: SearchableService[] = [];
  for (let i = 0; i < 2000; i++) {
    grande.push(fila({
      client: `Cliente ${i} Pérez`, model: `Modelo ${i % 97}`, order_num: `DEV-${String(i).padStart(4, '0')}`,
      phone: `0414-${String(1000000 + i)}`, client_ci: `V-${10000000 + i}`,
    }));
  }
  const medir = (q: string) => {
    const t0 = process.hrtime.bigint();
    let n = 0;
    for (let i = 0; i < 20; i++) n += filterServicesBySearch(grande, q).length;
    const t1 = process.hrtime.bigint();
    return { ms: Number(t1 - t0) / 1e6 / 20, n };
  };
  const primera = medir('cliente 1');   // en frío: pliega los campos de las 2000 filas
  const segunda = medir('perez 19');    // tibia: el plegado ya está memorizado
  const tercera = medir('zzz');
  console.log(`   sonda de rendimiento (2000 filas): 1ª tecla ${primera.ms.toFixed(2)} ms · 2ª ${segunda.ms.toFixed(2)} ms · 3ª ${tercera.ms.toFixed(2)} ms`);
  ok(`la PRIMERA tecla sobre 2000 filas es despreciable (medido: ${primera.ms.toFixed(2)} ms)`, primera.ms < 25);
  ok(`las siguientes son prácticamente gratis (medido: ${segunda.ms.toFixed(2)} / ${tercera.ms.toFixed(2)} ms)`,
    segunda.ms < 5 && tercera.ms < 5);
  ok('y devuelve resultados (la medición no mide la nada)', primera.n > 0 && segunda.n > 0);
  // Con la lista real del taller (10 órdenes hoy, 1400 el día que crezca) el margen es enorme.
  const real = grande.slice(0, 1400);
  const t0 = process.hrtime.bigint();
  const hits = filterServicesBySearch(real, 'perez').length;
  const t1 = process.hrtime.bigint();
  ok(`con 1400 órdenes una tecla cuesta ${(Number(t1 - t0) / 1e6).toFixed(2)} ms (< 15 ms) y devuelve ${hits}`,
    Number(t1 - t0) / 1e6 < 15 && hits === 1400);
}

console.log(`\nservice_search_test: ${checks - failures}/${checks} comprobaciones OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
