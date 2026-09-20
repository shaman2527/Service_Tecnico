// Pruebas PURAS de `src/lib/reminders.ts` (Harness F32; en F33 se quitó el aviso de apertura).
//
// Fija las dos promesas del usuario sobre los avisos emergentes:
//   · NUNCA bloquean (son recordatorios con acciones, no gates) → acá se comprueba que las
//     funciones devuelven avisos y no exigen nada.
//   · NO insisten por lo ya resuelto → confirmado lo confirmado, el aviso desaparece.
// Además: el tope de 2 avisos, el texto de multi-equipo y que la entrega nueva vuelve a pedir
// la foto de salida. (El recordatorio de la RECEPCIÓN ya no es un aviso flotante: vive en la ficha
// de ingreso dentro del formulario — ver `tools/ficha_test.ts`.)
//
// Uso:  node tools/reminders_test.ts

import {
  receiveReminders, printReminders, deliverReminders,
  payIntentLabel, MAX_REMINDERS,
} from '../src/lib/reminders.ts';
import { STATUS_ENTREGADO, STATUS_RECIBIDO } from '../src/lib/service-guide.ts';

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

const tones = (list: { tone: string }[]) => list.map(r => r.tone).join(',');
const ids = (list: { actions: { id: string }[] }[]) => list.map(r => r.actions.map(a => a.id).join('|')).join(' · ');

/** Orden base: sin señales de política (el peor caso: todo pendiente). */
const svc = (patch: Record<string, unknown> = {}) => ({
  photo_in_at: null, photo_out_at: null, pay_intent: null, date_out: null,
  status: STATUS_RECIBIDO, amount: 30, paid_amount: 0, ...patch,
} as never);

// ── 1. Al ABRIR una recepción NO hay aviso flotante (F33: el asistente es la ficha) ─────────
{
  // El único aviso informativo que quedaba era el de la apertura. Se comprueba de verdad: el módulo
  // ya NO exporta nada que se dispare al abrir (si alguien lo reintroduce, esta prueba falla), y los
  // tres ganchos que quedan son de CIERRE de acción (guardar / imprimir / entregar), no de apertura.
  const mod = await import('../src/lib/reminders.ts');
  eq('el módulo ya no exporta un aviso de apertura',
    'receiveIntroReminder' in mod, false);
  eq('los ganchos que quedan son de cierre de acción',
    ['receiveReminders', 'printReminders', 'deliverReminders'].every(k => k in mod), true);
  // Una orden ya resuelta (foto de salida de HOY, pago acordado y cobrada) no insiste por nada al
  // entregar: es la invariante «no insiste por lo ya resuelto».
  const hoy = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const resuelta = svc({
    photo_in_at: `${hoy} 10:00:00`, photo_out_at: `${hoy} 12:00:00`, date_out: hoy,
    pay_intent: 'ahora', amount: 30, paid_amount: 30,
  });
  eq('una orden resuelta no pide nada al entregar', deliverReminders(resuelta).length, 0);
  // Y si la foto de salida es de una entrega ANTERIOR, la pide otra vez (el equipo se reabrió).
  const reabierta = svc({ photo_out_at: '2026-01-01 12:00:00', date_out: hoy, pay_intent: 'ahora', paid_amount: 30 });
  eq('foto de salida vieja (equipo reabierto) se vuelve a pedir',
    deliverReminders(reabierta).map(r => r.key).join(','), 'photo_out');
}

// ── 2. Al GUARDAR la recepción (1 equipo): foto de entrada + pregunta del pago ──────────────
{
  const list = receiveReminders(svc(), { devices: 1, status: STATUS_RECIBIDO });
  eq('guardar · dos avisos', list.length, 2);
  eq('guardar · entrada primero (prioridad)', tones(list), 'entrada,pago');
  eq('guardar · acciones de la foto', list[0].actions.map(a => a.id), ['foto_tomada', 'ok']);
  eq('guardar · acciones del pago', list[1].actions.map(a => a.id), ['pago_ahora', 'pago_al_retirar']);
  ok('guardar · el aviso de la foto dice que es política de la empresa', /política de la empresa/i.test(list[0].message));
  ok('guardar · ningún aviso exige nada (solo acciones)', list.every(r => r.actions.length > 0));
  // «PAGAR», no «cancelar»: en esta app «Cancelado» significa PAGADO, así que «¿va a cancelar?»
  // se leía como «¿va a anular la orden?».
  ok('guardar · la pregunta del pago dice PAGAR (no «cancelar»)', /pagar ahora o al retirar/i.test(list[1].message));
  ok('guardar · la pregunta del pago NO dice «cancelar»', !/cancelar/i.test(list[1].message));
}

// ── 3. Multi-equipo: el texto lo dice ───────────────────────────────────────────────────────
{
  const list = receiveReminders(svc(), { devices: 3, status: STATUS_RECIBIDO });
  ok('3 equipos · el aviso habla de los 3 teléfonos', /los 3 teléfonos/.test(list[0].message));
  const uno = receiveReminders(svc(), { devices: 1, status: STATUS_RECIBIDO });
  ok('1 equipo · el aviso habla en singular', /al teléfono/.test(uno[0].message));
}

// ── 4. Ya resuelto → NO insiste ─────────────────────────────────────────────────────────────
{
  eq('con foto y acuerdo anotados → ningún aviso',
    receiveReminders(svc({ photo_in_at: '2026-09-17 09:00', pay_intent: 'ahora' }), { devices: 1, status: STATUS_RECIBIDO }).length, 0);
  const soloFoto = receiveReminders(svc({ photo_in_at: '2026-09-17 09:00' }), { devices: 1, status: STATUS_RECIBIDO });
  eq('con foto pero sin acuerdo → solo el del pago', tones(soloFoto), 'pago');

  const printResuelto = printReminders(svc({ photo_in_at: '2026-09-17 09:00', pay_intent: 'al_retirar', status: STATUS_RECIBIDO }));
  eq('imprimir con todo resuelto (equipo en taller) → ningún aviso', printResuelto.length, 0);

  const deliverResuelto = deliverReminders(svc({ photo_out_at: '2026-09-17 12:00', date_out: '2026-09-17', pay_intent: 'ahora' }));
  eq('entregar con foto de hoy y acuerdo → ningún aviso', deliverResuelto.length, 0);
}

// ── 5. Al IMPRIMIR: el eje es la foto de SALIDA cuando el equipo ya salió ───────────────────
{
  const enTaller = printReminders(svc({ status: STATUS_RECIBIDO }));
  eq('imprimir en taller · entrada + pago (sin salida)', tones(enTaller), 'entrada,pago');

  const entregado = printReminders(svc({ status: STATUS_ENTREGADO, date_out: '2026-09-17', photo_in_at: '2026-09-10 09:00' }));
  eq('imprimir entregado · salida + pago', tones(entregado), 'salida,pago');
  ok('imprimir entregado · el aviso de salida nombra la política de la empresa',
    /política de la empresa/i.test(entregado.find(r => r.tone === 'salida')!.message));

  const entregadoConPago = printReminders(svc({ status: STATUS_ENTREGADO, date_out: '2026-09-17', photo_in_at: '2026-09-10 09:00', pay_intent: 'al_retirar' }));
  eq('imprimir entregado con acuerdo anotado · solo la salida', tones(entregadoConPago), 'salida');

  // Una orden YA COBRADA no tiene nada que preguntar sobre el pago (antes se preguntaba igual)
  const yaCobrada = printReminders(svc({ amount: 30, paid_amount: 30, photo_in_at: '2026-09-17 09:00' }));
  eq('imprimir una orden ya cobrada · ningún aviso de pago', yaCobrada.filter(r => r.tone === 'pago').length, 0);
  const conSaldo = printReminders(svc({ amount: 30, paid_amount: 10, photo_in_at: '2026-09-17 09:00' }));
  eq('imprimir con saldo pendiente · sí pregunta el pago', tones(conSaldo), 'pago');
  const sinMonto = printReminders(svc({ amount: 0, paid_amount: 0, photo_in_at: '2026-09-17 09:00' }));
  eq('imprimir una orden de monto 0 · no pregunta el pago', sinMonto.filter(r => r.tone === 'pago').length, 0);
}

// ── 6. Al ENTREGAR: la foto de salida es la política ────────────────────────────────────────
{
  const list = deliverReminders(svc({ date_out: '2026-09-17' }));
  eq('entregar · salida + pago (hay saldo y no se preguntó)', tones(list), 'salida,pago');
  eq('entregar · acciones de la foto de salida', list[0].actions.map(a => a.id), ['foto_tomada', 'ok']);
  ok('entregar · el texto es el que pidió el usuario',
    list[0].message === '¿Le tomaste la foto al teléfono al entregarlo? Es política de la empresa.');

  const pagada = deliverReminders(svc({ date_out: '2026-09-17', amount: 30, paid_amount: 30 }));
  eq('entregar ya pagada · solo la foto de salida', tones(pagada), 'salida');

  const fotoVieja = deliverReminders(svc({ date_out: '2026-09-17', photo_out_at: '2026-09-10 09:00', amount: 30, paid_amount: 30 }));
  eq('equipo reabierto y entregado de nuevo · se vuelve a pedir la foto', tones(fotoVieja), 'salida');
}

// ── 7. Tope de 2 avisos y prioridad estable ─────────────────────────────────────────────────
{
  eq('tope declarado', MAX_REMINDERS, 2);
  const conEscenarioCargado = printReminders(svc({ status: STATUS_ENTREGADO, date_out: '2026-09-17' }));
  ok('nunca más de 2 avisos', conEscenarioCargado.length <= MAX_REMINDERS);
  eq('se descarta el de menor prioridad (queda salida + pago)', tones(conEscenarioCargado), 'salida,pago');
}

// ── 8. Crear la orden directamente ENTREGADO: no se pide foto de entrada ────────────────────
{
  const list = receiveReminders(svc(), { devices: 1, status: STATUS_ENTREGADO });
  eq('nace entregado · salida + pago (no entrada)', tones(list), 'salida,pago');
}

// ── 9. Etiqueta del acuerdo (tarjetas, panel y talón) ──────────────────────────────────────
{
  eq("'ahora' → Paga ahora", payIntentLabel('ahora'), 'Paga ahora');
  eq("'al_retirar' → Paga al retirar", payIntentLabel('al_retirar'), 'Paga al retirar');
  eq('sin acuerdo → null (no se inventa nada)', payIntentLabel(null), null);
  eq('valor desconocido → null', payIntentLabel('mañana'), null);
}

console.log(`\nreminders: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallas`);
if (failures > 0) process.exit(1);
