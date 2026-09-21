// Pruebas PURAS de la COLA de recordatorios de política (F46).
//
// Fija el contrato del modal centrado: **un aviso a la vez**, en orden de llegada, y **el mismo aviso
// (aviso + orden) no se apila** — el pedido doble ocurre de verdad cuando se entrega con «imprimir al
// cerrar» (el de la entrega y el del comprobante salen en el mismo gesto) y antes se veían dos
// tarjetas iguales.
//
// Uso:  node tools/policy_queue_test.ts

import { queuePolicyModal, closePolicyModal, policyModalQueue, subscribePolicyModal } from '../src/components/policy-queue.ts';

let checks = 0;
let failures = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FALLA · ${what}\n   esperado: ${JSON.stringify(want)}\n   obtenido: ${JSON.stringify(got)}`);
  }
};
const ok = (what: string, cond: boolean) => {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
};

const aviso = (key: string) => ({ key, tone: 'salida', title: key, message: `mensaje ${key}`, actions: [{ id: 'foto_tomada', label: 'Ya le tomé la foto' }] });
const limpiar = () => { for (const p of [...policyModalQueue()]) closePolicyModal(p.id); };
const accion = () => {};

limpiar();
eq('arranca vacía', policyModalQueue().length, 0);

// ── 1) uno a la vez, en orden de llegada (el host muestra el primero) ────────────────────────
queuePolicyModal('policy-photo_out-1', aviso('photo_out'), accion);
queuePolicyModal('policy-pay_intent-1', aviso('pay_intent'), accion);
eq('se encolan en orden', policyModalQueue().map(p => p.id), ['policy-photo_out-1', 'policy-pay_intent-1']);
eq('el host muestra el PRIMERO (FIFO)', policyModalQueue()[0]?.reminder.key, 'photo_out');

// ── 2) el mismo aviso NO se apila (entregar + imprimir en el mismo gesto) ────────────────────
queuePolicyModal('policy-photo_out-1', aviso('photo_out'), accion);
eq('el mismo aviso pedido dos veces queda UNA sola vez', policyModalQueue().length, 2);
queuePolicyModal('policy-photo_out-1', aviso('photo_out'), accion);
eq('...y sigue siendo el mismo (no se reordena ni se duplica)', policyModalQueue().map(p => p.id),
  ['policy-photo_out-1', 'policy-pay_intent-1']);

// ── 3) el mismo TIPO de aviso para OTRA orden SÍ es otro aviso ───────────────────────────────
queuePolicyModal('policy-photo_out-2', aviso('photo_out'), accion);
eq('otra orden con el mismo aviso sí entra', policyModalQueue().map(p => p.id),
  ['policy-photo_out-1', 'policy-pay_intent-1', 'policy-photo_out-2']);

// ── 4) cerrar quita SOLO ese aviso y el siguiente pasa a ser el primero ──────────────────────
closePolicyModal('policy-photo_out-1');
eq('cerrar el primero deja el resto en orden', policyModalQueue().map(p => p.id),
  ['policy-pay_intent-1', 'policy-photo_out-2']);
closePolicyModal('policy-no-existe');
eq('cerrar algo que no está no rompe nada', policyModalQueue().length, 2);

// ── 5) los oyentes se enteran (es lo que hace que el modal aparezca y desaparezca) ───────────
let avisos = 0;
const baja = subscribePolicyModal(() => { avisos++; });
queuePolicyModal('policy-pago-9', aviso('pago'), accion);
ok('encolar avisa a los oyentes', avisos >= 1);
const trasEncolar = avisos;
closePolicyModal('policy-pago-9');
ok('cerrar avisa a los oyentes', avisos > trasEncolar);
baja();
const trasBaja = avisos;
queuePolicyModal('policy-pago-10', aviso('pago'), accion);
eq('después de darse de baja no recibe más avisos', avisos, trasBaja);

// ── 6) la cola se lee como FOTO (no se muta por atrás) ───────────────────────────────────────
const foto = [...policyModalQueue()];
queuePolicyModal('policy-extra-11', aviso('extra'), accion);
eq('la lectura anterior no cambia al encolar', foto.length, policyModalQueue().length - 1);

limpiar();
eq('queda vacía al limpiar', policyModalQueue().length, 0);

console.log(`\npolicy_queue_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
