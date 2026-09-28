// Pruebas PURAS de `src/lib/service-filters.ts` (Harness F81).
//
// Fija la regla que pidió el dueño: al ir a registrar un servicio, el filtro vuelve al predeterminado
// y la orden que se acaba de registrar SE VE. Lo que se prueba acá es lo que hace que eso sea cierto:
// que el predeterminado sea el estado en el que una orden recién recibida es visible, que el reset
// funcione desde CUALQUIER combinación de filtros, y que el botón manual «Limpiar filtros» siga
// conservando el eje (decisión de F44) sin pisar la regla nueva.
//
// Uso:  node tools/service_filters_test.ts

import {
  DEFAULT_SERVICE_FILTERS, defaultServiceFilters, isDefaultServiceFilters,
  clearServiceFilters, resetFiltersForNewOrder, type ServiceFilters,
} from '../src/lib/service-filters.ts';

let checks = 0;
let failures = 0;

function ok(what: string, cond: boolean) {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
}

/** ¿Con estos filtros, una orden RECIÉN RECIBIDA (status Recibido, sin date_out) se vería? */
function veriaLaOrdenNueva(f: ServiceFilters): boolean {
  if (f.search.trim()) return false;                 // el buscador puede no matchear el nombre nuevo
  if (f.statusFilter && f.statusFilter !== 'Recibido') return false; // «Entregado»/«__activos__» la esconde
  if (f.typeFilter) return false;                    // el chip de trabajo puede no incluir el trabajo nuevo
  // El eje + el rango: una orden nueva tiene date_in = HOY y date_out vacío.
  if (!f.dateStart && !f.dateEnd) return true;       // sin rango, el eje no filtra
  if (f.dateField === 'out') return false;           // eje de ENTREGA: no tiene date_out todavía
  const hoy = '2026-09-27';
  if (f.dateStart && hoy < f.dateStart) return false;
  if (f.dateEnd && hoy > f.dateEnd) return false;
  return true;
}

// ── 1. El predeterminado es EXACTAMENTE el estado en el que la orden nueva se ve ─────────────────
{
  ok('el predeterminado no tiene búsqueda', DEFAULT_SERVICE_FILTERS.search === '');
  ok('el predeterminado es «Todos los estados» (F44: \'\' = todos)', DEFAULT_SERVICE_FILTERS.statusFilter === '');
  ok('el predeterminado no tiene chip de trabajo', DEFAULT_SERVICE_FILTERS.typeFilter === '');
  ok('el predeterminado es el eje «Recibidos» (F32)', DEFAULT_SERVICE_FILTERS.dateField === 'in');
  ok('el predeterminado no tiene rango de fechas (todo el historial)',
    DEFAULT_SERVICE_FILTERS.dateStart === '' && DEFAULT_SERVICE_FILTERS.dateEnd === '');
  ok('con el predeterminado, la orden recién recibida SE VE', veriaLaOrdenNueva(defaultServiceFilters()));
}

// ── 2. El reset del alta lleva al predeterminado desde CUALQUIER combinación ─────────────────────
{
  // `esconde` = con ESA combinación la orden recién recibida no se ve (el motivo por el que el
  // operario se confunde). OJO: un filtro puede NO ser el predeterminado y aun así mostrar la orden
  // (combinación 4: un rango que arranca antes de hoy) — lo que el reset garantiza es el
  // predeterminado EXACTO, no «cualquier cosa que muestre la orden».
  const combinaciones: { f: ServiceFilters; esconde: boolean }[] = [
    // el caso que confunde al dueño: «Entregados hoy» pulsado
    { f: { search: '', statusFilter: 'Entregado', typeFilter: '', dateField: 'out', dateStart: '2026-09-27', dateEnd: '2026-09-27' }, esconde: true },
    // búsqueda escrita + activos en taller
    { f: { search: 'Juan', statusFilter: '__activos__', typeFilter: 'Cambio pantalla', dateField: 'in', dateStart: '', dateEnd: '' }, esconde: true },
    // rango viejo con eje de entrega
    { f: { search: '0414', statusFilter: 'Por entregar', typeFilter: 'Otro', dateField: 'out', dateStart: '2026-08-01', dateEnd: '2026-08-31' }, esconde: true },
    // un solo extremo del rango, amplio: NO esconde la orden, pero tampoco es el predeterminado
    { f: { search: '', statusFilter: '', typeFilter: '', dateField: 'in', dateStart: '2026-01-01', dateEnd: '' }, esconde: false },
    // un solo extremo del rango con eje de ENTREGA: esconde (la orden no tiene date_out)
    { f: { search: '', statusFilter: '', typeFilter: '', dateField: 'out', dateStart: '', dateEnd: '2026-12-31' }, esconde: true },
    // ya estaba en el predeterminado
    { f: defaultServiceFilters(), esconde: false, yaEsDefault: true },
  ];
  for (const [i, { f: antes, esconde, yaEsDefault }] of combinaciones.entries()) {
    ok(`la combinación ${i + 1} ${esconde ? 'ESCONDE' : 'no esconde'} la orden nueva (el caso está bien armado)`,
      veriaLaOrdenNueva(antes) === !esconde);
    ok(`la combinación ${i + 1} ${yaEsDefault ? 'YA es' : 'no es'} el predeterminado`,
      isDefaultServiceFilters(antes) === !!yaEsDefault);
    const despues = resetFiltersForNewOrder();
    ok(`el reset de la combinación ${i + 1} deja el predeterminado exacto`, isDefaultServiceFilters(despues));
    ok(`y después del reset la orden nueva YA se ve (combinación ${i + 1})`, veriaLaOrdenNueva(despues));
  }
  ok('el reset NO cambia el objeto que le pasan (devuelve uno nuevo)',
    (() => { const antes = combinaciones[1].f; const copia = { ...antes }; resetFiltersForNewOrder(); return JSON.stringify(antes) === JSON.stringify(copia); })());
}

// ── 3. Idempotencia y copias frescas ─────────────────────────────────────────────────────────────
{
  ok('resetear dos veces da lo mismo', JSON.stringify(resetFiltersForNewOrder()) === JSON.stringify(resetFiltersForNewOrder()));
  ok('el predeterminado aplicado a sí mismo sigue siendo el predeterminado', isDefaultServiceFilters(DEFAULT_SERVICE_FILTERS));
  const a = defaultServiceFilters();
  a.search = 'lo que sea';
  a.dateField = 'out';
  ok('mutar la copia NO contamina el predeterminado (ni la siguiente copia)',
    DEFAULT_SERVICE_FILTERS.search === '' && DEFAULT_SERVICE_FILTERS.dateField === 'in'
    && defaultServiceFilters().search === '' && defaultServiceFilters().dateField === 'in');
  ok('el objeto exportado está congelado (nadie lo puede pisar por accidente)',
    Object.isFrozen(DEFAULT_SERVICE_FILTERS));
}

// ── 4. El botón manual «Limpiar filtros» CONSERVA el eje (decisión de F44, no se toca) ───────────
{
  const antes: ServiceFilters = { search: 'Ana', statusFilter: 'Entregado', typeFilter: 'Cambio batería', dateField: 'out', dateStart: '2026-09-01', dateEnd: '2026-09-27' };
  const despues = clearServiceFilters(antes);
  ok('«Limpiar filtros» borra la búsqueda', despues.search === '');
  ok('«Limpiar filtros» vuelve a «Todos los estados»', despues.statusFilter === '');
  ok('«Limpiar filtros» borra el chip de trabajo', despues.typeFilter === '');
  ok('«Limpiar filtros» borra las dos fechas', despues.dateStart === '' && despues.dateEnd === '');
  ok('«Limpiar filtros» CONSERVA el eje (F44: sin rango el eje no filtra)', despues.dateField === 'out');
  ok('«Limpiar filtros» no muta el objeto de entrada', antes.search === 'Ana' && antes.dateField === 'out');
  ok('«Limpiar filtros» es idempotente', JSON.stringify(clearServiceFilters(despues)) === JSON.stringify(despues));
}

// ── 5. El detector del predeterminado no miente ──────────────────────────────────────────────────
{
  ok('todo vacío pero con eje de ENTREGA NO es el predeterminado',
    !isDefaultServiceFilters({ search: '', statusFilter: '', typeFilter: '', dateField: 'out', dateStart: '', dateEnd: '' }));
  ok('un estado puesto NO es el predeterminado',
    !isDefaultServiceFilters({ ...DEFAULT_SERVICE_FILTERS, statusFilter: 'Entregado' }));
  ok('un solo extremo del rango NO es el predeterminado',
    !isDefaultServiceFilters({ ...DEFAULT_SERVICE_FILTERS, dateEnd: '2026-09-27' }));
  ok('null/undefined no son el predeterminado (fail-closed)', !isDefaultServiceFilters(null) && !isDefaultServiceFilters(undefined));
  ok('un objeto vacío (campos undefined) NO se toma por el predeterminado', !isDefaultServiceFilters({}));
}

console.log(`\nservice_filters_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
