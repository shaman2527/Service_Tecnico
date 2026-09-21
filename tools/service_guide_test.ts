// Pruebas PURAS de `src/lib/service-guide.ts` (Harness F32, podado en F33).
//
// Acá quedan las reglas del FLUJO que varias pantallas comparten: los estados, con cuál nace una
// orden, cuáles sirven para crear, si la foto de salida es de la entrega vigente y cuál es el paso
// siguiente del proceso. (La ficha de ingreso —el asistente que pide un dato por vez— se prueba en
// `tools/ficha_test.ts`: antes este archivo probaba también un `buildServiceGuide` que ya no existe.)
//
// Uso:  node tools/service_guide_test.ts

import {
  photoOutIsCurrent, nextStep, isFinalStatus, isCreatableStatus, needsTechnician, DEFAULT_NEW_STATUS,
  STATUS_RECIBIDO, STATUS_REPARACION, STATUS_REPUESTO, STATUS_REPARADO, STATUS_POR_ENTREGAR,
  STATUS_ENTREGADO, STATUS_CANCELADO,
} from '../src/lib/service-guide.ts';

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

const paso = (status: string, patch: Partial<Parameters<typeof nextStep>[1]> = {}) =>
  nextStep(status, { technician: '', hasPaid: false, payIntent: null, needsScreen: true, screenChosen: true, ...patch });

// ── 1. Estados con los que se puede crear una orden ─────────────────────────────────────────
{
  eq('la orden nueva nace en Recibido', DEFAULT_NEW_STATUS, STATUS_RECIBIDO);
  for (const s of [STATUS_RECIBIDO, STATUS_REPARACION, STATUS_REPUESTO, STATUS_REPARADO, STATUS_POR_ENTREGAR]) {
    eq(`se puede crear en ${s}`, isCreatableStatus(s), true);
  }
  eq('NO se puede crear ya Entregado (entregar es un acto aparte)', isCreatableStatus(STATUS_ENTREGADO), false);
  eq('NO se puede crear en Cancelado / Devuelto', isCreatableStatus(STATUS_CANCELADO), false);
  eq('NO se puede crear en Devuelto', isCreatableStatus('Devuelto'), false);
  eq('NO se puede crear en Cancelado', isCreatableStatus('Cancelado'), false);
  eq('estado vacío = el de siempre (Recibido), no final', isCreatableStatus(''), true);
}

// ── 2. Estados finales ──────────────────────────────────────────────────────────────────────
{
  eq('Cancelado es final', isFinalStatus('Cancelado'), true);
  eq('Cancelado / Devuelto es final', isFinalStatus(STATUS_CANCELADO), true);
  eq('Devuelto es final', isFinalStatus('Devuelto'), true);
  eq('Entregado NO es «finalizado» (es entregado, no anulado)', isFinalStatus(STATUS_ENTREGADO), false);
  eq('Recibido no es final', isFinalStatus(STATUS_RECIBIDO), false);
  eq('vacío no es final', isFinalStatus(''), false);
}

// ── 3. Foto de salida: vale la de ESTA entrega ──────────────────────────────────────────────
{
  eq('misma fecha → vale', photoOutIsCurrent('2026-09-17 10:00', '2026-09-17'), true);
  eq('foto vieja de otra entrega → no vale', photoOutIsCurrent('2026-09-10 10:00', '2026-09-17'), false);
  eq('sin foto → no vale', photoOutIsCurrent(null, '2026-09-17'), false);
  eq('sin fecha de entrega → no vale', photoOutIsCurrent('2026-09-17 10:00', null), false);
  eq('sin nada → no vale', photoOutIsCurrent(null, null), false);
}

// ── 4. El paso siguiente del proceso, por estado ────────────────────────────────────────────
{
  eq('Recibido → En reparación', paso(STATUS_RECIBIDO)?.status, STATUS_REPARACION);
  ok('sin técnico lo dice', /Asigná el técnico/.test(paso(STATUS_RECIBIDO)?.why ?? ''));
  ok('con técnico cambia el mensaje (no repite «asigná el técnico»)',
    /ya está asignado/.test(paso(STATUS_RECIBIDO, { technician: 'Aldri' })?.why ?? ''));
  eq('En reparación → Reparado / Pendiente Pago', paso(STATUS_REPARACION)?.status, STATUS_REPARADO);
  eq('Esperando repuesto → Reparado / Pendiente Pago', paso(STATUS_REPUESTO)?.status, STATUS_REPARADO);
  eq('Reparado → Por entregar', paso(STATUS_REPARADO)?.status, STATUS_POR_ENTREGAR);
  ok('con pago hecho lo dice', /Cobrado/.test(paso(STATUS_REPARADO, { hasPaid: true })?.why ?? ''));
  ok('sin pago invita a cobrar', /Cobrá/.test(paso(STATUS_REPARADO)?.why ?? ''));
  eq('Por entregar → Entregado', paso(STATUS_POR_ENTREGAR)?.status, STATUS_ENTREGADO);
  ok('y recomienda el asistente de cierre', /Cerrar/.test(paso(STATUS_POR_ENTREGAR)?.why ?? ''));
  eq('Entregado no tiene paso siguiente', paso(STATUS_ENTREGADO), null);
  eq('Cancelado / Devuelto no tiene paso siguiente', paso(STATUS_CANCELADO), null);
  ok('todos los pasos explican el motivo', [STATUS_RECIBIDO, STATUS_REPARACION, STATUS_REPUESTO, STATUS_REPARADO, STATUS_POR_ENTREGAR]
    .every(s => (paso(s)?.why ?? '').length > 20));
}

// ── 5. F45 — la orden que TODAVÍA necesita técnico (la señal ámbar de la tarjeta) ────────────
{
  const enTaller = { status: STATUS_RECIBIDO };
  ok('orden en taller sin técnico → necesita', needsTechnician(enTaller) === true);
  ok('orden en taller sin técnico (id null y nombre vacío) → necesita',
    needsTechnician({ status: STATUS_POR_ENTREGAR, technician: '   ', technician_id: null }) === true);
  ok('con técnico asignado → no necesita',
    needsTechnician({ status: STATUS_RECIBIDO, technician: 'Aldri', technician_id: 2 }) === false);
  ok('con SOLO el id (nombre aún sin cargar) → no necesita',
    needsTechnician({ status: STATUS_RECIBIDO, technician_id: 2 }) === false);
  ok('con SOLO el nombre del snapshot (técnico borrado del padrón) → no necesita',
    needsTechnician({ status: STATUS_RECIBIDO, technician: 'William', technician_id: null }) === false);
  ok('ENTREGADA sin técnico → NO se reclama (el trabajo ya salió)',
    needsTechnician({ status: STATUS_ENTREGADO, technician_id: null }) === false);
  ok('Devuelta sin técnico → NO se reclama', needsTechnician({ status: 'Devuelto' }) === false);
  ok('Cancelada sin técnico → NO se reclama', needsTechnician({ status: STATUS_CANCELADO }) === false);
  ok('sin estado (dato viejo raro) sin técnico → se reclama igual',
    needsTechnician({ status: null }) === true);
}

console.log(`\nservice-guide: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallas`);
if (failures > 0) process.exit(1);
