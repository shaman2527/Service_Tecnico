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

// ── 2. Al GUARDAR la recepción (1 equipo): el PAGO primero, la foto al final ─────────────────
// Pedido del dueño (2026-09-21): «primero es el mensaje de cómo va a pagar, de último es la foto».
// El orden importa de verdad: los avisos se muestran de a UNO (cola de `PolicyModal`), así que la
// lista es literalmente el orden en que el operario los ve.
{
  const list = receiveReminders(svc(), { devices: 1, status: STATUS_RECIBIDO });
  eq('guardar · dos avisos', list.length, 2);
  eq('guardar · el PAGO se ve primero y la foto al final', tones(list), 'pago,entrada');
  eq('guardar · acciones del pago', list[0].actions.map(a => a.id), ['pago_ahora', 'pago_al_retirar']);
  eq('guardar · acciones de la foto', list[1].actions.map(a => a.id), ['foto_tomada', 'ok']);
  ok('guardar · el aviso de la foto dice que es política de la empresa', /política de la empresa/i.test(list[1].message));
  ok('guardar · ningún aviso exige nada (solo acciones)', list.every(r => r.actions.length > 0));
  // F77 — EL TÍTULO ES LA ORDEN CORTA Y GRANDE (es la línea más grande del modal, ver PolicyModal):
  // pedido del dueño, «algo más en grande que diga *Toma la foto al teléfono*».
  const fotoIn = list[1], pago = list[0];
  ok('F77 · el título de la foto dice TOMA LA FOTO AL TELÉFONO', /toma la foto al teléfono/i.test(fotoIn.title), fotoIn.title);
  ok('F77 · el título del pago dice PREGÚNTALE AL CLIENTE', /pregúntale al cliente/i.test(pago.title), pago.title);
  // Un cartel se lee de lejos: si el título crece a un párrafo, deja de ser un cartel (y desborda la
  // tarjeta). El detalle largo vive en el `message`.
  ok('F77 · los títulos son cortos (cartel, no párrafo)',
    [fotoIn, pago].every(r => r.title.length <= 28), list.map(r => `${r.title}(${r.title.length})`).join(' · '));
  ok('F77 · el título de la foto NO repite el del pago ni el mensaje',
    fotoIn.title !== pago.title && !/política de la empresa/i.test(fotoIn.title));
  // «PAGAR», no «cancelar»: en esta app «Cancelado» significa PAGADO, así que «¿va a cancelar?»
  // se leía como «¿va a anular la orden?».
  ok('guardar · la pregunta del pago dice PAGAR (no «cancelar»)', /pagar ahora o al retirar/i.test(list[0].message));
  ok('guardar · la pregunta del pago NO dice «cancelar»', !/cancelar/i.test(list[0].message));
}

// ── 3. Multi-equipo: el texto lo dice ───────────────────────────────────────────────────────
{
  const list = receiveReminders(svc(), { devices: 3, status: STATUS_RECIBIDO });
  ok('3 equipos · el aviso habla de los 3 teléfonos', /los 3 teléfonos/.test(list[1].message));
  const uno = receiveReminders(svc(), { devices: 1, status: STATUS_RECIBIDO });
  ok('1 equipo · el aviso habla en singular', /al teléfono/.test(uno[1].message));
  // F77: el título NO cambia con la cantidad (el plural vive en el mensaje): el cartel es el mismo.
  ok('F77 · con 3 equipos el título de la foto sigue siendo el mismo',
    list[1].title === uno[1].title && /toma la foto al teléfono/i.test(list[1].title));
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
  eq('imprimir en taller · pago primero, foto de entrada al final', tones(enTaller), 'pago,entrada');

  const entregado = printReminders(svc({ status: STATUS_ENTREGADO, date_out: '2026-09-17', photo_in_at: '2026-09-10 09:00' }));
  eq('imprimir entregado · pago + salida', tones(entregado), 'pago,salida');
  ok('imprimir entregado · el aviso de salida nombra la política de la empresa',
    /política de la empresa/i.test(entregado.find(r => r.tone === 'salida')!.message));
  // F77: el cartel de la SALIDA también dice qué hacer, en corto.
  ok('F77 · el título de la salida dice TOMA LA FOTO AL ENTREGAR',
    /toma la foto al entregar/i.test(entregado.find(r => r.tone === 'salida')!.title),
    entregado.find(r => r.tone === 'salida')!.title);
  ok('F77 · los dos títulos de foto son distintos (recibir ≠ entregar)',
    entregado.find(r => r.tone === 'salida')!.title !== enTaller.find(r => r.tone === 'entrada')!.title);

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
  eq('entregar · pago primero, foto de salida al final', tones(list), 'pago,salida');
  eq('entregar · acciones del pago', list[0].actions.map(a => a.id), ['pago_ahora', 'pago_al_retirar']);
  eq('entregar · acciones de la foto de salida', list[1].actions.map(a => a.id), ['foto_tomada', 'ok']);
  ok('entregar · el texto es el que pidió el usuario',
    list.find(r => r.tone === 'salida')!.message === '¿Le tomaste la foto al teléfono al entregarlo? Es política de la empresa.');

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
  eq('se descarta el de menor prioridad (queda salida + pago)', tones(conEscenarioCargado), 'pago,salida');
}

// ── 8. Crear la orden directamente ENTREGADO: no se pide foto de entrada ────────────────────
{
  const list = receiveReminders(svc(), { devices: 1, status: STATUS_ENTREGADO });
  eq('nace entregado · pago + salida (no entrada)', tones(list), 'pago,salida');
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
