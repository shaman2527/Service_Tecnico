// Pruebas PURAS de `src/lib/service-report.ts` (Harness F44).
//
// Fija lo que el dueño pidió el 2026-09-20: «el cliente me pregunta cuántas pantallas hice hoy o un
// día en específico… cuando cambio el filtro debería darme los servicios que he hecho, cambio de
// pantalla por ejemplo o cambio de pin, y en entregado no me aparecen». Los contadores de la lista
// contaban SOLO las órdenes activas, así que al filtrar por lo entregado desaparecían todos; y los
// trabajos escritos a mano («Otro» → «Cambio de pin de carga») no tenían contador.
//
// Los dos invariantes que estas pruebas sostienen:
//   · el número del chip == las filas que devuelve `matchesWorkFilter` (el chip no puede mentir);
//   · `entregados + taller + anulados === equipos` y todo equipo está en un trabajo o en «Sin trabajo».
//
// Uso:  node tools/service_report_test.ts

import {
  ACTIVE_SENTINEL, NO_WORK_FILTER, WORK_COUNT_NOTE,
  foldWork, workKeys, matchesWorkFilter, workBucket, workCounts, serviceReport, scopeLabel, scopeProblem,
  type WorkRow,
} from '../src/lib/service-report.ts';
import { SERVICE_TYPES } from '../src/lib/utils.ts';

let checks = 0;
let failures = 0;

function eq(what: string, got: unknown, want: unknown) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FALLA · ${what}\n   esperado: ${JSON.stringify(want)}\n   obtenido: ${JSON.stringify(got)}`);
  }
}

function ok(what: string, cond: boolean, detail?: string) {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}${detail ? `\n   ${detail}` : ''}`); }
}

/** Fila de servicio con lo mínimo que lee el reporte (una cosa por prueba). */
function row(status: string, types: string[], extra: Partial<WorkRow> = {}): WorkRow {
  return {
    status,
    service_types: types.length ? JSON.stringify(types) : null,
    service_type: types[0] ?? null,
    ...extra,
  };
}

// ── 1) contrato con el backend (los identificadores literales) ─────────────────────────────────
eq('identificador «solo en taller» (contrato con get_services y con queue.ts)', ACTIVE_SENTINEL, '__activos__');
eq('identificador del chip «Sin trabajo anotado»', NO_WORK_FILTER, '__sin_trabajo__');
ok('la nota de multi-trabajo se dice en pantalla', /varios trabajos/.test(WORK_COUNT_NOTE), WORK_COUNT_NOTE);

// ── 2) EL DEFECTO REPORTADO: lo ENTREGADO cuenta ──────────────────────────────────────────────
{
  const lista = [
    row('Entregado', ['Cambio pantalla']),
    row('Recibido', ['Cambio pantalla']),
    row('Entregado', ['Pin de Carga']),
  ];
  const r = serviceReport(lista);
  eq('equipos = filas de la lista (sin importar el estado)', r.equipos, 3);
  eq('entregados', r.entregados, 2);
  eq('en taller', r.taller, 1);
  const pantalla = r.porTrabajo.find(c => c.key === foldWork('Cambio pantalla'));
  eq('chip «Cambio pantalla»: cuenta la entregada Y la que está en taller', pantalla?.total, 2);
  eq('...y dice cuántas de esas ya salieron', pantalla?.entregados, 1);
  eq('...y cuántas siguen en el taller', pantalla?.taller, 1);
  const pin = r.porTrabajo.find(c => c.key === foldWork('Pin de Carga'));
  eq('chip «Pin de Carga»: la entregada también cuenta', pin?.total, 1);
  eq('...marcada como entregada', pin?.entregados, 1);

  // Control negativo: con la regla VIEJA (solo órdenes activas) estos dos chips daban 0 y por eso
  // desaparecían de la pantalla. Si alguien vuelve a contar sobre las activas, esta prueba lo caza.
  const ACTIVOS = ['Recibido', 'En reparación', 'Esperando repuesto', 'Reparado / Pendiente Pago', 'Por entregar'];
  const viejo = SERVICE_TYPES
    .map(t => ({ t, n: lista.filter(s => ACTIVOS.includes(s.status ?? '') && JSON.parse(s.service_types ?? '[]').includes(t)).length }))
    .filter(x => x.n > 0);
  eq('control negativo: la regla vieja se quedaba sin el trabajo que solo salió entregado', viejo.map(x => x.t), ['Cambio pantalla']);
  eq('control negativo: y el chip de pantalla bajaba de 2 (real) a 1 (solo activas)', viejo.find(x => x.t === 'Cambio pantalla')?.n, 1);
}

// ── 3) multi-trabajo: cuenta en cada chip y UNA sola vez en equipos ───────────────────────────
{
  const lista = [
    row('Entregado', ['Cambio pantalla', 'Cambio batería']),
    row('Devuelto', ['Cambio pantalla']),
  ];
  const r = serviceReport(lista);
  eq('un equipo con 2 trabajos = 1 equipo', r.equipos, 2);
  eq('...y suma en sus 2 chips', r.porTrabajo.map(c => [c.label, c.total]), [['Cambio pantalla', 2], ['Cambio batería', 1]]);
  eq('el anulado se cuenta como anulado (no como entregado)', r.anulados, 1);
}

// ── 4) la MISMA etiqueta repetida en una fila no se cuenta dos veces ──────────────────────────
eq('etiqueta repetida (distinta caja) en la misma fila = 1 trabajo',
  workKeys(row('Recibido', ['Cambio pantalla', 'cambio pantalla'])), ['cambio pantalla']);

// ── 5) plegado: mayúsculas, acentos y puntuación NO crean trabajos distintos ──────────────────
eq('«Pin de Carga» y «pin de carga» son el mismo trabajo', foldWork('Pin de Carga'), foldWork('pin de carga'));
eq('acentos: «Reparación (placa)» = «reparacion placa»', foldWork('Reparación (placa)'), foldWork('reparacion placa'));
eq('espacios de sobra', foldWork('  Cambio   pantalla '), foldWork('Cambio pantalla'));
eq('vacío → clave vacía', foldWork('   '), '');
{
  const r = serviceReport([row('Entregado', ['Pin de Carga']), row('Entregado', ['pin de carga'])]);
  eq('las dos grafías se agrupan en un solo chip', r.porTrabajo.length, 1);
  eq('...con la etiqueta canónica', r.porTrabajo[0].label, 'Pin de Carga');
  eq('...y la cantidad sumada', r.porTrabajo[0].total, 2);
}
// Y NO se fusiona lo que es distinto: adivinar sería peor que mostrar de más.
ok('«Cambio de pantalla» NO se fusiona con «Cambio pantalla»',
  foldWork('Cambio de pantalla') !== foldWork('Cambio pantalla'));

// ── 6) etiquetas LIBRES («Otro» escrito a mano) tienen su propio chip ─────────────────────────
{
  const lista = [
    row('Entregado', ['cambio de pin de carga']),
    row('Recibido', ['Cambio De Pin De Carga']),
    row('Recibido', ['Cambio pantalla']),
  ];
  const r = serviceReport(lista);
  const libre = r.porTrabajo.find(c => c.key === foldWork('cambio de pin de carga'));
  ok('el trabajo escrito a mano tiene contador', !!libre, JSON.stringify(r.porTrabajo.map(c => c.label)));
  eq('...cuenta las dos grafías', libre?.total, 2);
  eq('...está marcado como libre (no canónico)', libre?.custom, true);
  eq('...conserva la primera grafía anotada', libre?.label, 'cambio de pin de carga');
  eq('los canónicos van PRIMERO (posición estable)', r.porTrabajo[0].label, 'Cambio pantalla');
}

// ── 7) orden canónico estable + libres por cantidad ──────────────────────────────────────────
{
  // «Cambio batería» tiene más equipos que «Cambio pantalla», y aun así va después: la posición de
  // cada chip no cambia entre recargas (memoria del mostrador).
  const lista = [
    row('Entregado', ['Cambio batería']), row('Entregado', ['Cambio batería']), row('Entregado', ['Cambio batería']),
    row('Entregado', ['Cambio pantalla']),
    row('Entregado', ['Zzz libre']), row('Entregado', ['Aaa libre']), row('Entregado', ['Aaa libre']),
  ];
  eq('canónicos en el orden de SERVICE_TYPES y libres por cantidad',
    serviceReport(lista).porTrabajo.map(c => c.label),
    ['Cambio pantalla', 'Cambio batería', 'Aaa libre', 'Zzz libre']);
}

// ── 8) «Sin trabajo anotado»: los números CIERRAN ────────────────────────────────────────────
{
  const lista = [
    row('Entregado', ['Cambio pantalla']),
    { status: 'Entregado', service_type: null, service_types: null },
    { status: 'Recibido', service_type: '   ', service_types: '[]' },
  ];
  const r = serviceReport(lista);
  eq('los equipos sin trabajo se cuentan aparte', r.sinTrabajo, 2);
  ok('toda fila cae en un trabajo o en «Sin trabajo anotado»',
    r.porTrabajo.reduce((a, c) => a + c.total, 0) + r.sinTrabajo >= r.equipos,
    `chips=${r.porTrabajo.reduce((a, c) => a + c.total, 0)} sinTrabajo=${r.sinTrabajo} equipos=${r.equipos}`);
  eq('el chip «Sin trabajo anotado» filtra exactamente esas filas',
    lista.filter(s => matchesWorkFilter(s, NO_WORK_FILTER)).length, 2);
}

// ── 9) EL INVARIANTE: el chip dice lo mismo que las tarjetas que aparecen al hacerle clic ─────
{
  const lista: WorkRow[] = [
    row('Entregado', ['Cambio pantalla']),
    row('Recibido', ['Cambio pantalla', 'Cambio flex']),
    row('Por entregar', ['Pin de Carga']),
    row('Devuelto', ['Limpieza / Mantenimiento']),
    row('Entregado', ['Cambio De Pin De Carga']),
    { status: 'Recibido', service_type: null, service_types: null },
  ];
  const r = serviceReport(lista);
  for (const c of r.porTrabajo) {
    eq(`el chip «${c.label}» no miente (${c.total})`,
      lista.filter(s => matchesWorkFilter(s, c.key)).length, c.total);
  }
  eq('y el chip «Sin trabajo anotado» tampoco',
    lista.filter(s => matchesWorkFilter(s, NO_WORK_FILTER)).length, r.sinTrabajo);
  eq('sin filtro entran todas', lista.filter(s => matchesWorkFilter(s, '')).length, lista.length);
  eq('los 3 grupos cierran contra los equipos', r.entregados + r.taller + r.anulados, r.equipos);
}

// ── 10) grupos por estado (mismo criterio que el sentinel del backend) ────────────────────────
eq('Entregado → entregado', workBucket('Entregado'), 'entregado');
eq('Recibido → taller', workBucket('Recibido'), 'taller');
eq('Por entregar → taller', workBucket('Por entregar'), 'taller');
eq('Devuelto → anulado', workBucket('Devuelto'), 'anulado');
eq('Cancelado → anulado', workBucket('Cancelado'), 'anulado');
eq('Cancelado / Devuelto → anulado', workBucket('Cancelado / Devuelto'), 'anulado');
eq('un estado propio del local → taller (como el sentinel del backend)', workBucket('En pruebas'), 'taller');
eq('sin estado → taller', workBucket(null), 'taller');

// ── 11) lista vacía: ceros y sin NaN ─────────────────────────────────────────────────────────
{
  const r = serviceReport([]);
  eq('lista vacía', [r.equipos, r.entregados, r.taller, r.anulados, r.sinTrabajo, r.porTrabajo.length], [0, 0, 0, 0, 0, 0]);
  eq('sin trabajos no hay chips', workCounts([]), []);
}

// ── 12) la línea de alcance dice SOBRE QUÉ se cuenta ─────────────────────────────────────────
{
  const base = { status: '', dateField: 'in' as const, start: '', end: '' };
  const t1 = scopeLabel(base);
  ok('todos los estados + recibo + historial', /todos los estados/.test(t1) && /fecha de RECIBO/.test(t1) && /todo el historial/.test(t1), t1);
  ok('...y avisa que un equipo con varios trabajos cuenta en cada uno', /varios trabajos/.test(t1), t1);
  const t2 = scopeLabel({ ...base, dateField: 'out', start: '2026-09-20', end: '2026-09-20' });
  ok('un día por fecha de ENTREGA', /fecha de ENTREGA/.test(t2) && /del 2026-09-20/.test(t2) && !/al 2026/.test(t2), t2);
  const t3 = scopeLabel({ ...base, start: '2026-09-01', end: '2026-09-20' });
  ok('rango con dos fechas', /del 2026-09-01 al 2026-09-20/.test(t3), t3);
  const t4 = scopeLabel({ ...base, status: ACTIVE_SENTINEL });
  ok('activos en taller se dice entero', /solo los activos en taller/.test(t4), t4);
  const t5 = scopeLabel({ ...base, status: 'Entregado' });
  ok('un estado concreto se nombra', /estado «Entregado»/.test(t5), t5);
  const t6 = scopeLabel({ ...base, start: '2026-09-01' });
  ok('solo fecha inicial', /desde el 2026-09-01/.test(t6), t6);
  const t7 = scopeLabel({ ...base, end: '2026-09-20' });
  ok('solo fecha final', /hasta el 2026-09-20/.test(t7), t7);
}

// ── 13) la combinación IMPOSIBLE se detecta (para explicarla, no para mostrar lista vacía) ────
eq('activos en taller + fecha de ENTREGA = imposible por definición',
  scopeProblem({ status: ACTIVE_SENTINEL, dateField: 'out' }), 'activos-sin-entrega');
eq('activos + fecha de recibo es válido', scopeProblem({ status: ACTIVE_SENTINEL, dateField: 'in' }), null);
eq('todos los estados + entrega es válido', scopeProblem({ status: '', dateField: 'out' }), null);
eq('un estado entregado + entrega es válido', scopeProblem({ status: 'Entregado', dateField: 'out' }), null);

// ── 14) los trabajos canónicos son la única lista de chips posibles + libres ──────────────────
{
  const todas = SERVICE_TYPES.map(t => row('Entregado', [t]));
  eq('un chip por cada trabajo canónico', workCounts(todas).length, SERVICE_TYPES.length);
  eq('y ninguno marcado como libre', workCounts(todas).filter(c => c.custom).length, 0);
  ok('las filas viejas (solo service_type, sin service_types) siguen contando',
    serviceReport([{ status: 'Entregado', service_type: 'Cambio pantalla' }]).porTrabajo[0]?.total === 1);
  ok('un service_types roto (JSON inválido) cae al service_type y no rompe nada',
    serviceReport([{ status: 'Entregado', service_type: 'Cambio batería', service_types: '{roto' }]).porTrabajo[0]?.label === 'Cambio batería');
}

console.log(`\nservice_report_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
