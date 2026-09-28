// Pruebas PURAS de `src/lib/day-shift.ts` (Harness F82).
//
// Fija la regla del dueño: «si no cerré la caja del día anterior, que me diga que tengo que
// cerrarla antes de facturar». Lo que se prueba acá es el AVISO (la mitad visible de la regla): que
// no invente un problema cuando no lo hay, que nombre las dos fechas, que el remedio sea el camino
// real de la app y que las fechas se muestren SIN correrse un día (la trampa de `new Date('2026-09-16')`
// en UTC-4, que ya mordió a este proyecto).
//
// Uso:  node tools/day_shift_test.ts

import {
  shiftPending, fechaLegible, soloFecha, turnoViejoTexto,
  AVISO_TURNO_VIEJO, REMEDIO_TURNO_VIEJO,
} from '../src/lib/day-shift.ts';

let checks = 0;
let failures = 0;

function ok(what: string, cond: boolean) {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
}

const HOY = '2026-09-27';

// ── 1. Sin turno abierto NO es «turno viejo» (ese caso tiene su propio aviso) ────────────────────
{
  for (const v of [null, undefined, '', '   ']) {
    const t = shiftPending(v as string | null, HOY);
    ok(`sin turno abierto (${JSON.stringify(v)}) no se avisa de un turno viejo`, t.stale === false);
    ok(`  y no hay mensaje ni remedio (no se inventa nada)`, t.message === '' && t.remedy === '');
    ok(`  y la fecha del turno queda en null`, t.fechaTurno === null);
  }
}

// ── 2. Turno abierto de HOY: todo normal ────────────────────────────────────────────────────────
{
  const t = shiftPending(HOY, HOY);
  ok('el turno de hoy no dispara nada', t.stale === false && t.message === '');
  ok('y la fecha del turno se conserva', t.fechaTurno === HOY && t.hoy === HOY);
  // El backend puede devolver el close_date con hora en algún camino: se compara solo el DÍA.
  ok('un close_date con hora del MISMO día no dispara nada', shiftPending(`${HOY} 10:30:00`, HOY).stale === false);
}

// ── 3. Turno abierto de OTRO día: el aviso del dueño ─────────────────────────────────────────────
{
  const t = shiftPending('2026-09-16', HOY);
  ok('un turno de ayer SÍ es turno viejo', t.stale === true);
  ok('el mensaje nombra la fecha de la caja vieja en dd/mm/aaaa', t.message.includes('16/09/2026'));
  ok('el mensaje nombra el día de HOY en dd/mm/aaaa', t.message.includes('27/09/2026'));
  ok('el mensaje dice QUE LA CAJA SIGUE ABIERTA (el hecho, no una opinión)', /sigue ABIERTA/.test(t.message));
  ok('el mensaje dice a QUÉ DÍA se iría la plata', /se anota en el día 16\/09\/2026/.test(t.message));
  ok('el remedio nombra el camino real: Libro Diario → Cierres', /Cierres/.test(t.remedy));
  ok('el remedio nombra el botón «Cerrar» de esa fila', /Cerrar/.test(t.remedy));
  ok('el remedio dice que después hay que abrir el día de hoy', /Abrir Día/.test(t.remedy));
  ok('el remedio del aviso es EXACTAMENTE la constante compartida (un solo texto en toda la app)',
    t.remedy === REMEDIO_TURNO_VIEJO);
  ok('el texto completo (mensaje + remedio) junta las dos partes', turnoViejoTexto(t).includes(t.message) && turnoViejoTexto(t).includes(t.remedy));
  ok('el aviso corto dice lo que pidió el dueño', /cerrar la caja del día anterior/i.test(AVISO_TURNO_VIEJO));
  ok('el turno es viejo también cuando faltan varios días (12 días)', shiftPending('2026-09-15', HOY).stale === true);
}

// ── 4. Fechas SIN corrimiento de día (la trampa de UTC) ──────────────────────────────────────────
{
  ok('el 01/01 no se corre a 31/12 del año anterior', fechaLegible('2026-01-01') === '01/01/2026');
  ok('el 31/12 no se corre a 01/01 del año siguiente', fechaLegible('2026-12-31') === '31/12/2026');
  ok('el primer día del mes se muestra tal cual', fechaLegible('2026-03-01') === '01/03/2026');
  ok('una fecha con hora se muestra por su día', fechaLegible('2026-09-27 23:59:59') === '27/09/2026');
  ok('un texto que no es fecha se devuelve tal cual (nunca se inventa)', fechaLegible('sin-fecha') === 'sin-fecha');
  ok('null/undefined no rompen el formateo', fechaLegible(null) === '' && fechaLegible(undefined) === '');
  ok('soloFecha acepta la fecha limpia y la que trae hora', soloFecha('2026-09-27') === '2026-09-27' && soloFecha('2026-09-27 08:00:00') === '2026-09-27');
  ok('soloFecha devuelve null con basura o vacío', soloFecha('') === null && soloFecha('ayer') === null && soloFecha(null) === null);
}

// ── 5. Coherencia con el backend: el mismo día no es problema, otro día sí (una sola verdad) ─────
{
  // El backend rechaza cuando NO hay un turno abierto de la fecha efectiva. El aviso tiene que
  // coincidir EXACTAMENTE con esa condición: hoy abierto → nada que avisar; otro día → avisar.
  const casos: [string | null, boolean][] = [
    [HOY, false], ['2026-09-26', true], ['2026-09-28', true], [null, false],
  ];
  for (const [fecha, esperado] of casos) {
    ok(`coherencia con la regla del backend para turno=${fecha}`, shiftPending(fecha, HOY).stale === esperado);
  }
  ok('el mensaje NO aparece cuando no hay problema (nunca un banner vacío)', shiftPending(HOY, HOY).message === '');
  ok('y turnoViejoTexto de un turno normal es vacío', turnoViejoTexto(shiftPending(HOY, HOY)) === '');
}

console.log(`\nday_shift_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
