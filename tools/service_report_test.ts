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
  dayOf, inRange, rangeFor, sortByCount, topWorks, scopeSummary, summaryScopeLabel,
  type WorkRow,
} from '../src/lib/service-report.ts';
import { SERVICE_TYPES } from '../src/lib/utils.ts';
// F58/F59: la tabla de equivalencias vive en su propio módulo (`foldWork` se importa de
// service-report, que lo re-exporta: una sola regla de plegado).
import { WORK_ALIASES } from '../src/lib/work-aliases.ts';

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

// ── 15) F56 — el RESUMEN DEL DÍA: recibidos hoy, entregados hoy y qué trabajos se hicieron ────
// El pedido del dueño (2026-09-21): «quiero ver en mis servicios cuántas pantallas hice hoy, cuántos
// equipos recibí hoy, cuántos entregué hoy… se clasifique bien». Estas pruebas fijan (a) que los DOS
// EJES son independientes —recibido por `date_in`, entregado por `date_out`—, (b) que una fecha con
// HORA cuenta en su día (el defecto que hacía desaparecer «lo de hoy» cuando se comparaba el texto
// completo) y (c) que el desglose por trabajo sale de la MISMA función que el resto (`workCounts`).
{
  const HOY = '2026-09-21';
  eq('rango «hoy»', rangeFor('hoy', HOY), { start: HOY, end: HOY });
  eq('rango «7 días» incluye hoy y los 6 anteriores', rangeFor('7d', HOY), { start: '2026-09-15', end: HOY });
  eq('rango «este mes» va del día 1 a hoy', rangeFor('mes', HOY), { start: '2026-09-01', end: HOY });
  eq('sin fecha de hoy el rango es abierto (no inventa un día)', rangeFor('hoy', ''), { start: '', end: '' });

  // El DÍA de un sello con hora: el defecto que rompía «hoy».
  eq('saca el día de un sello con hora', dayOf('2026-09-21 09:30:00'), HOY);
  ok('una fecha con hora SÍ es «de hoy» (con `date_in === hoy` esto era SIEMPRE falso)',
    dayOf('2026-09-21 09:30:00') === HOY && '2026-09-21 09:30:00' !== HOY);
  eq('sin fecha no hay día', dayOf(null), '');
  ok('sin día no entra en ningún rango', inRange('', { start: HOY, end: HOY }) === false);
  ok('un día anterior al rango queda afuera', inRange('2026-09-20', { start: HOY, end: HOY }) === false);
  ok('un día posterior al rango queda afuera', inRange('2026-09-22', { start: HOY, end: HOY }) === false);
  ok('el rango abierto acepta cualquier día con fecha', inRange('2020-01-01', { start: '', end: '' }) === true);

  // Caso real del local: uno recibido HOY y todavía en taller, uno recibido AYER y entregado HOY
  // (el caso que el dueño destaca: «recibido la semana pasada, entregado hoy»), uno viejo entregado,
  // uno anulado sin trabajo y uno listo para entregar.
  const base: WorkRow[] = [
    row('Recibido', ['Cambio pantalla'], { date_in: `${HOY} 08:10:00`, amount: 20 }),
    row('Entregado', ['Cambio pantalla', 'Cambio batería'], { date_in: '2026-09-20 15:00:00', date_out: `${HOY} 10:05:00`, amount: 30 }),
    row('Entregado', ['Pin de Carga'], { date_in: '2026-08-22 11:00:00', date_out: '2026-09-01 11:00:00', amount: 10 }),
    row('Devuelto', [], { date_in: `${HOY} 12:00:00`, amount: 5 }),
    row('Por entregar', ['Revisión'], { date_in: '2026-09-16 09:00:00', amount: 15 }),
  ];
  const hoy = scopeSummary(base, rangeFor('hoy', HOY));
  eq('recibidos HOY por fecha de RECIBO', hoy.recibidos, 2);
  eq('entregados HOY por fecha de ENTREGA (el recibido ayer entra acá)', hoy.entregados, 1);
  eq('importe de lo recibido hoy', hoy.montoRecibido, 25);
  eq('importe de lo entregado hoy', hoy.montoEntregado, 30);
  eq('en taller ahora (no depende del rango)', hoy.taller, 2);
  eq('listos para entregar', hoy.listos, 1);
  eq('anulados', hoy.anulados, 1);
  eq('equipos del alcance', hoy.equipos, 5);
  eq('el desglose de lo recibido cuenta por trabajo', hoy.porTrabajoRecibidos.map(c => [c.label, c.total]), [['Cambio pantalla', 1]]);
  eq('y avisa el equipo sin trabajo anotado (para que los números cierren)', hoy.recibidosSinTrabajo, 1);
  eq('el desglose de lo entregado va por CANTIDAD y por nombre si empatan',
    hoy.porTrabajoEntregados.map(c => [c.label, c.total]), [['Cambio batería', 1], ['Cambio pantalla', 1]]);
  ok('un equipo con 2 trabajos cuenta en cada trabajo del desglose (lo dice la nota de pantalla)',
    hoy.porTrabajoEntregados.reduce((a, c) => a + c.total, 0) === 2 && hoy.entregados === 1);

  // El rango NO cambia el estado del taller, y «todo el historial» cuenta las dos fechas que existan.
  const todo = scopeSummary(base, { start: '', end: '' });
  eq('todo el historial: recibidos = los que tienen fecha de recibo', todo.recibidos, 5);
  eq('todo el historial: entregados = los que tienen fecha de entrega', todo.entregados, 2);
  eq('todo el historial: el taller sigue siendo el mismo número', todo.taller, 2);

  // Recibido y entregado el MISMO día: cuenta en los dos ejes (no es un error, es un servicio
  // de mostrador) — y es la única forma de que «recibí 18 y entregué 11» pueda compartir un equipo.
  const mismoDia = scopeSummary(
    [row('Entregado', ['Cambio pantalla'], { date_in: `${HOY} 09:00:00`, date_out: `${HOY} 17:00:00`, amount: 12 })],
    rangeFor('hoy', HOY),
  );
  eq('mismo día: cuenta como recibido', mismoDia.recibidos, 1);
  eq('mismo día: y como entregado', mismoDia.entregados, 1);

  // Destacados: los N trabajos más hechos (los que el cliente pregunta siempre).
  const muchos = workCounts([
    row('Entregado', ['Cambio pantalla']), row('Entregado', ['Cambio pantalla']),
    row('Entregado', ['Cambio pantalla']), row('Entregado', ['Pin de Carga']),
    row('Entregado', ['Pin de Carga']), row('Entregado', ['Revisión']),
  ]);
  eq('destacados: los 2 más hechos', topWorks(muchos, 2).map(c => [c.label, c.total]), [['Cambio pantalla', 3], ['Pin de Carga', 2]]);
  eq('destacados: pedir más de los que hay no inventa nada', topWorks(muchos, 99).length, muchos.length);
  eq('orden por cantidad, desempate por nombre',
    sortByCount([{ key: 'b', label: 'Batería', total: 1, entregados: 1, taller: 0, anulados: 0, custom: true },
      { key: 'a', label: 'Alarma', total: 1, entregados: 1, taller: 0, anulados: 0, custom: true }]).map(c => c.label),
    ['Alarma', 'Batería']);

  // La línea de alcance: sin esto el número no se puede defender frente al cliente.
  const l1 = summaryScopeLabel(rangeFor('hoy', HOY), HOY);
  ok('el alcance de hoy dice HOY y la fecha', /Hoy \(2026-09-21\)/.test(l1), l1);
  ok('y dice los DOS ejes', /recibidos por fecha de recibo/.test(l1) && /entregados por fecha de entrega/.test(l1), l1);
  const l2 = summaryScopeLabel({ start: '2026-09-01', end: '2026-09-20' }, HOY);
  ok('un rango se dice entero', /Del 2026-09-01 al 2026-09-20/.test(l2), l2);
  const l3 = summaryScopeLabel({ start: '', end: '' }, HOY);
  ok('sin rango se dice que es todo el historial', /Todo el historial/.test(l3), l3);
}

// ── 16) F58 — las EQUIVALENCIAS aprobadas: las etiquetas escritas a mano se unen a su trabajo ──
// El pedido del dueño (2026-09-21) es poder decir «cambié 30 baterías» sin sumar a mano: en su base
// real «Cambio batería» (27) + «bateria» (2) + «REPARACIÓN DE BATTERIA» (1) son EL MISMO trabajo.
// Y la regla que NO se negocia (decisión de F44): nada de parecidos automáticos — solo lo que está
// en la tabla explícita se une.
{
  const lista = [
    row('Entregado', ['Cambio batería']),
    row('Entregado', ['bateria']),
    row('Entregado', ['REPARACIÓN DE BATTERIA']),
  ];
  const c = workCounts(lista);
  eq('las tres formas de «batería» son UN solo trabajo', c.length, 1);
  eq('y el número es la suma, sin sumar a mano', c[0].total, 3);
  eq('con la etiqueta canónica del formulario', c[0].label, 'Cambio batería');
  eq('y ya no cuenta como etiqueta libre', c[0].custom, false);
  // El invariante de F44 sobrevive: el número del trabajo == las filas que devuelve el filtro.
  eq('el filtro devuelve EXACTAMENTE lo que el contador cuenta',
    lista.filter(r => matchesWorkFilter(r, c[0].key)).length, c[0].total);
  eq('la etiqueta vieja Y la nueva en el mismo equipo cuentan UNA vez',
    workKeys(row('Entregado', ['bateria', 'Cambio batería'])).length, 1);

  // NADA de parecidos: lo que no está aprobado sigue separado.
  eq('una etiqueta PARECIDA no aprobada no se fusiona', workCounts([
    row('Entregado', ['Cambio batería']), row('Entregado', ['bateria de iphone']),
  ]).length, 2);
  eq('el texto libre que no está en la tabla se conserva tal cual',
    workCounts([row('Entregado', ['Cambio de pin de carga'])])[0].label, 'Cambio de pin de carga');
  eq('«placa» + «sustitución de targeta logica» van a Reparación (placa)', workCounts([
    row('Entregado', ['placa']), row('Entregado', ['sustitución de targeta logica']),
  ]).map(x => [x.label, x.total]), [['Reparación (placa)', 2]]);

  // La tabla tiene que seguir siendo VÁLIDA y revisable: cada alias apunta a un trabajo real.
  const huerfanos = Object.entries(WORK_ALIASES).filter(([, destino]) => !SERVICE_TYPES.some(t => foldWork(t) === destino));
  ok('todos los alias apuntan a un trabajo de la lista canónica', huerfanos.length === 0, JSON.stringify(huerfanos));
  ok('la tabla de alias no está vacía (si se vacía, esto avisa)', Object.keys(WORK_ALIASES).length > 0);
  ok('las equivalencias viven en su propio módulo revisable', Object.keys(WORK_ALIASES).every(k => foldWork(k) === k),
    'las claves de la tabla van plegadas');
}

// ── 17) F59 — «garantía» y «VENTA» NO son trabajos hechos ─────────────────────────────────────
{
  const H = '2026-09-21';
  const lista = [
    row('Recibido', ['garantía'], { date_in: `${H} 09:00:00`, amount: 0 }),
    row('Recibido', ['VENTA'], { date_in: `${H} 10:00:00`, amount: 20 }),
    row('Recibido', ['Cambio pantalla'], { date_in: `${H} 11:00:00`, amount: 30 }),
  ];
  const r = scopeSummary(lista, rangeFor('hoy', H));
  eq('los tres equipos se cuentan como recibidos', r.recibidos, 3);
  eq('pero el desglose por trabajo no los cuenta como trabajos',
    r.porTrabajoRecibidos.map(c => c.label), ['Cambio pantalla']);
  eq('y se informan aparte (el operario ve por qué el desglose no suma el total)', r.recibidosNoTrabajo, 2);
  eq('lo entregado se informa igual', scopeSummary([
    row('Entregado', ['venta de pantalla'], { date_out: `${H} 12:00:00` }),
  ], rangeFor('hoy', H)).entregadosNoTrabajo, 1);
  // Un equipo que ADEMÁS tiene un trabajo real sigue contando como trabajo (no se pierde).
  eq('un equipo con trabajo real + venta cuenta como trabajo y como no-trabajo',
    scopeSummary([row('Recibido', ['Cambio pantalla', 'VENTA'], { date_in: `${H} 13:00:00` })], rangeFor('hoy', H))
      .porTrabajoRecibidos.map(c => c.label), ['Cambio pantalla']);
}

// ── 18) F62 — las categorías que AGREGA EL LOCAL cuentan como del taller ──────────────────────
// Pedido del dueño (2026-09-21): «en las categorías o los types, donde sale Otro, cuando vas a hacer
// un registro poder registrar ahí mismo una nueva categoría con un +». Una categoría propia NO puede
// caer en «Anotados a mano» (ese grupo es para el texto libre viejo): tiene que mostrarse y contarse
// como las del taller, y su número tiene que seguir siendo el de las tarjetas al filtrar.
{
  const H = '2026-09-21';
  const lista = [
    row('Entregado', ['Cambio de tapa'], { date_in: `${H} 09:00:00` }),
    row('Entregado', ['Cambio de tapa'], { date_in: `${H} 10:00:00` }),
    row('Entregado', ['Cambio de lente'], { date_in: `${H} 11:00:00` }),
    row('Entregado', ['etiqueta vieja del local'], { date_in: `${H} 12:00:00` }),
  ];
  const sin = workCounts(lista);
  eq('sin las categorías del local, la nueva se trata como etiqueta libre', sin.find(c => c.label === 'Cambio de tapa')?.custom, true);

  const con = workCounts(lista, ['Cambio de tapa', 'Cambio de lente']);
  eq('con la categoría del local, cuenta como trabajo del taller', con.find(c => c.label === 'Cambio de tapa')?.custom, false);
  eq('y su número es el real', con.find(c => c.label === 'Cambio de tapa')?.total, 2);
  const orden = con.map(c => c.label);
  ok('las categorías del local van ANTES de las libres', orden.indexOf('Cambio de tapa') < orden.indexOf('etiqueta vieja del local'), JSON.stringify(orden));
  eq('el filtro devuelve exactamente lo que cuenta (invariante de F44)',
    lista.filter(r => matchesWorkFilter(r, 'cambio de tapa')).length, 2);
  // El resumen del día también las conoce (misma puerta que el selector). OJO: el desglose del
  // resumen lista TODO lo que se hizo —incluido el texto libre viejo— porque es un dato real; lo que
  // cambia con las categorías del local es que se cuentan y se ordenan como trabajos del taller.
  const resumen = scopeSummary(lista, rangeFor('hoy', H), ['Cambio de tapa', 'Cambio de lente']);
  eq('el resumen del día las lista con su número, ordenadas por cantidad',
    resumen.porTrabajoRecibidos.map(c => [c.label, c.total]),
    [['Cambio de tapa', 2], ['Cambio de lente', 1], ['etiqueta vieja del local', 1]]);
  eq('y el reporte de la lista las marca del taller',
    serviceReport(lista, ['Cambio de tapa']).porTrabajo.find(c => c.label === 'Cambio de tapa')?.custom, false);
  // Sin categorías extra, todo sigue igual que antes (compatibilidad).
  eq('sin extras el resultado es el de siempre', serviceReport(lista).porTrabajo.filter(c => !c.custom).length, 0);
}

console.log(`\nservice_report_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
