// Pruebas PURAS de `src/lib/ficha.ts` (Harness F33).
//
// Fija el asistente de recepción que pidió el usuario: la ficha muestra SIEMPRE los cuatro bloques
// del mostrador con cada dato en «valor» o «Pendiente», pide UN dato por vez (el primero que
// bloquea y, si no hay, el primero recomendado), avisa de FORMATOS dudosos sin bloquear y lleva a
// cada dato con su paso del formulario (para corregir sin perder lo demás).
//
// Uso:  node tools/ficha_test.ts

import {
  buildFicha, onlyDigits, ciWarn, phoneWarn, amountWarn, inspeccionCount, type FichaInput,
} from '../src/lib/ficha.ts';

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

/** Ficha de una recepción típica ya completa (para variar una cosa por vez). */
function base(patch: Partial<FichaInput> = {}): FichaInput {
  return {
    mode: 'crear',
    client: 'Ana Pérez',
    clientCi: 'V-12345678',
    needCi: true,
    phone: '0412-1234567',
    clientAddress: 'Av. Principal',
    model: 'Samsung Galaxy A15',
    color: 'Negro',
    checklist: { chip_sim: 'no', accesorios: 'no', tapa_trasera: 'si', camara: 'si', contrasena: 'si' },
    serviceTypes: ['Cambio pantalla'],
    fault: 'Pantalla rota',
    amount: 30,
    payIntent: 'al_retirar',
    status: 'Recibido',
    technician: 'Aldri',
    photoInAt: '2026-09-17 10:00',
    needsScreen: true,
    hasScreenOptions: true,
    screenChosen: true,
    ...patch,
  };
}

const claves = (f: ReturnType<typeof buildFicha>) => f.groups.flatMap(g => g.fields.map(x => x.key));

// ── 1. La ficha tiene los cuatro bloques del mostrador, en orden ────────────────────────────
{
  const f = buildFicha(base());
  eq('bloques', f.groups.map(g => g.title),
    ['Datos del cliente', 'Ficha técnica del dispositivo', 'Diagnóstico y recepción', 'Condiciones comerciales']);
  ok('el bloque del cliente trae nombre, documento, teléfono y dirección',
    ['client', 'client_ci', 'phone', 'client_address'].every(k => claves(f).includes(k)));
  ok('la ficha técnica trae modelo, color, clave y accesorios',
    ['model', 'color', 'contrasena', 'accesorios'].every(k => claves(f).includes(k)));
  ok('el diagnóstico trae trabajos, falla, inspección y foto de entrada',
    ['service_types', 'fault', 'inspeccion', 'photo_in'].every(k => claves(f).includes(k)));
  ok('lo comercial trae monto, pago acordado, estado y técnico',
    ['amount', 'pay_intent', 'status', 'technician'].every(k => claves(f).includes(k)));
  eq('con todo cargado no queda nada por pedir', f.next, null);
  eq('y la ficha está completa', f.completa, true);
  eq('el contador cuadra', f.done, f.total);
}

// ── 2. «Valor o Pendiente»: cada dato dice lo que tiene ─────────────────────────────────────
{
  const f = buildFicha(base({ client: '', clientCi: '', phone: '', color: '', fault: '', technician: '', photoInAt: null, payIntent: null }));
  const byKey = (k: string) => f.groups.flatMap(g => g.fields).find(x => x.key === k)!;
  eq('sin nombre → Pendiente (y como falta)', [byKey('client').value, byKey('client').state], [null, 'falta']);
  eq('sin cédula → falta (cliente nuevo)', byKey('client_ci').state, 'falta');
  eq('sin teléfono → pendiente (no bloquea)', byKey('phone').state, 'pendiente');
  // F48 (pedido del dueño): el COLOR pasó a ser obligatorio (antes era opcional y «pendiente»).
  eq('sin color → falta (es obligatorio desde F48)', byKey('color').state, 'falta');
  eq('sin foto de entrada → pendiente (la política nunca bloquea)', byKey('photo_in').state, 'pendiente');
  eq('sin pago acordado → pendiente', byKey('pay_intent').state, 'pendiente');
  eq('con valor → ok', byKey('model').value, 'Samsung Galaxy A15');
}

// ── 3. El asistente pide UN dato por vez: primero lo que bloquea, después lo recomendado ────
{
  const vacia = buildFicha(base({ client: '', clientCi: '', phone: '', model: '', serviceTypes: [], amount: 0, fault: '', color: '', photoInAt: null, payIntent: null, technician: '' }));
  eq('pide el nombre primero', vacia.next?.key, 'client');
  ok('y lo pide con su guía', (vacia.next?.guide ?? '').length > 10);

  const sinCi = buildFicha(base({ clientCi: '' }));
  eq('con el nombre puesto, pide el documento', sinCi.next?.key, 'client_ci');

  const sinModelo = buildFicha(base({ model: '' }));
  eq('sin modelo pide el modelo', sinModelo.next?.key, 'model');

  const sinTrabajos = buildFicha(base({ serviceTypes: [] }));
  eq('sin trabajos pide el tipo de servicio', sinTrabajos.next?.key, 'service_types');
}

// ── 4. Si no falta nada que bloquee, pide lo recomendado; el COLOR ya es obligatorio (F48) ───
{
  const f = buildFicha(base({ color: '', technician: '', photoInAt: null }));
  // F48: el color BLOQUEA, así que es el dato que el asistente pide ahora (y con eso el operario
  // llega al selector en un toque: «si no selecciono un color lo salte de una vez a que elija uno»).
  eq('pide el color del equipo (dato obligatorio desde F48)', f.next?.key, 'color');
  eq('y la ficha NO está lista para guardar sin color', f.completa, false);
  eq('el técnico sigue sin bloquear (F45)', f.groups.flatMap(g => g.fields).find(x => x.key === 'technician')?.state, 'pendiente');
  // Con el color puesto, el asistente pasa a lo no bloqueante (el técnico, la foto…).
  const conColor = buildFicha(base({ technician: '', photoInAt: null }));
  eq('con el color elegido la ficha ya se puede guardar', conColor.completa, true);
  ok('y entonces pide lo recomendado (técnico o política)',
    ['technician', 'photo_in', 'pay_intent'].includes(String(conColor.next?.key)), String(conColor.next?.key));
}

// ── 4b. F48 — OBSERVACIONES que NO bloquean (el teléfono del cliente, el técnico) ────────────
{
  const sinTelefono = buildFicha(base({ phone: '' }));
  eq('el teléfono que falta queda como OBSERVACIÓN con el texto del dueño',
    sinTelefono.notas.find(n => n.key === 'phone')?.texto, 'Falta el número de teléfono del cliente');
  ok('...y la observación explica para qué sirve', /avis/i.test(sinTelefono.notas.find(n => n.key === 'phone')?.guia ?? ''));
  ok('...y NO entra en los datos que bloquean (la orden se guarda igual)',
    sinTelefono.completa === true && sinTelefono.groups.flatMap(g => g.fields).find(x => x.key === 'phone')?.state === 'pendiente');
  eq('...y lleva al paso del teléfono (paso 0)', sinTelefono.notas.find(n => n.key === 'phone')?.step, 0);

  const sinTecnico = buildFicha(base({ technician: '' }));
  eq('el técnico sin asignar también es una observación (no bloquea)',
    sinTecnico.notas.find(n => n.key === 'technician')?.texto, 'El equipo todavía no tiene técnico asignado');
  ok('...y avisa que se puede asignar después', /despu[eé]s/i.test(sinTecnico.notas.find(n => n.key === 'technician')?.guia ?? ''));

  const completa = buildFicha(base());
  eq('con el teléfono y el técnico cargados no hay observaciones', completa.notas, []);
}

// ── 5. Cédula de cliente YA registrado: no bloquea ──────────────────────────────────────────
{
  const f = buildFicha(base({ needCi: false, clientCi: '' }));
  const ci = f.groups.flatMap(g => g.fields).find(x => x.key === 'client_ci')!;
  eq('cliente conocido sin cédula → pendiente', ci.state, 'pendiente');
  eq('no aparece como lo que falta', f.completa, true);
}

// ── 6. Reglas de formato (avisos, no bloqueos) ──────────────────────────────────────────────
{
  eq('solo dígitos', onlyDigits('V-12.345.678'), '12345678');
  eq('cédula corta avisa', typeof ciWarn('V-123'), 'string');
  eq('cédula vacía no avisa (está pendiente)', ciWarn(''), undefined);
  eq('cédula correcta no avisa', ciWarn('V-12345678'), undefined);
  eq('teléfono corto avisa', typeof phoneWarn('0412'), 'string');
  eq('teléfono correcto no avisa', phoneWarn('0412-1234567'), undefined);
  // El monto en 0 NO es un problema de formato (orden sin cobro o monto aún sin escribir):
  // solo se avisa cuando hay varios equipos y a uno le falta el monto.
  eq('monto 0 no avisa (queda pendiente, no es error)', amountWarn(0, false), undefined);
  eq('monto parcial en multi-equipo sí avisa', typeof amountWarn(30, false), 'string');
  eq('monto puesto no avisa', amountWarn(30, true), undefined);
  const conAviso = buildFicha(base({ clientCi: 'V-12', phone: '041' }));
  eq('los avisos de formato llegan a la ficha', conAviso.warns.map(w => w.key), ['client_ci', 'phone']);
  eq('y el dato con formato dudoso sigue contando como cargado',
    conAviso.groups.flatMap(g => g.fields).find(x => x.key === 'client_ci')?.state, 'ok');
}

// ── 7. Blindaje: clave, accesorios e inspección salen del checklist ─────────────────────────
{
  const f = buildFicha(base());
  const byKey = (k: string) => f.groups.flatMap(g => g.fields).find(x => x.key === k)!;
  eq('la clave entregada se muestra', byKey('contrasena').value, 'Sí');
  ok('los accesorios listan lo marcado', /Chip: No/.test(String(byKey('accesorios').value)) && /Forro: No/.test(String(byKey('accesorios').value)));
  // El contador dice los ítems REALES del blindaje del local (10), no los que ya tienen valor: con el
  // denominador viejo una orden recién abierta mostraba «2 de 2 ítems revisados» y parecía completa.
  eq('la inspección cuenta sobre el TOTAL de ítems del checklist', byKey('inspeccion').value, '5 de 10 ítems revisados');
  const totalPropio = buildFicha(base({ checklistTotal: 12 }));
  eq('el total lo fija la UI (CHECKLIST_ITEMS.length)', totalPropio.groups.flatMap(g => g.fields).find(x => x.key === 'inspeccion')?.value, '5 de 12 ítems revisados');
  // Multi-equipo: los datos POR EQUIPO se dicen como del equipo 1 (no como si fueran de la orden).
  const multi = buildFicha(base({ equipos: 3 }));
  eq('multi-equipo: la inspección aclara de qué equipo es',
    multi.groups.flatMap(g => g.fields).find(x => x.key === 'inspeccion')?.value, '5 de 10 ítems revisados (equipo 1)');
  ok('multi-equipo: la clave avisa que es la del equipo 1',
    /equipo 1 de 3/.test(String(multi.groups.flatMap(g => g.fields).find(x => x.key === 'contrasena')?.guide)));

  const vacia = buildFicha(base({ checklist: {} }));
  const vb = (k: string) => vacia.groups.flatMap(g => g.fields).find(x => x.key === k)!;
  eq('sin blindaje la clave queda pendiente', vb('contrasena').value, null);
  eq('sin blindaje los accesorios quedan pendientes', vb('accesorios').value, null);
  eq('sin blindaje la inspección queda pendiente', vb('inspeccion').value, null);
  // El blindaje NO bloquea (la política del local se avisa, no se impone)
  eq('el blindaje no bloquea la ficha', vacia.completa, true);
}

// ── 8. La pantalla exacta aparece solo cuando el trabajo la pide ────────────────────────────
{
  const sinTrabajo = buildFicha(base({ needsScreen: false }));
  eq('sin «Cambio pantalla» no se pide pantalla', claves(sinTrabajo).includes('screen'), false);
  const sinCatalogo = buildFicha(base({ hasScreenOptions: false }));
  eq('modelo sin pantallas en catálogo: no se pide', claves(sinCatalogo).includes('screen'), false);
  const sinElegir = buildFicha(base({ screenChosen: false }));
  const sp = sinElegir.groups.flatMap(g => g.fields).find(x => x.key === 'screen')!;
  // La pantalla exacta SÍ bloquea el guardado (sin ella el inventario no baja, o baja del repuesto
  // equivocado; `devicesValid`/`screenMissing` la exigen): por eso la ficha la marca como falta —
  // antes decía «pendiente» y la ficha anunciaba «Lista para guardar» con el botón apagado.
  eq('con catálogo y sin elegir queda en FALTA (es gate del guardado)', [sp.value, sp.state], [null, 'falta']);
  eq('y la ficha NO se da por completa', sinElegir.completa, false);
  eq('y apunta al paso donde se elige', sp.step, 1);
}

// ── 9. Cada dato sabe a qué paso ir para corregirlo (sin perder el resto) ───────────────────
{
  const f = buildFicha(base());
  const paso = (k: string) => f.groups.flatMap(g => g.fields).find(x => x.key === k)!.step;
  eq('cliente → paso 0', paso('client'), 0);
  eq('cédula → paso 0', paso('client_ci'), 0);
  eq('modelo → paso 1', paso('model'), 1);
  eq('clave / accesorios / inspección / foto → paso 2 (Blindaje)', [paso('contrasena'), paso('accesorios'), paso('inspeccion'), paso('photo_in')], [2, 2, 2, 2]);
  eq('monto → paso 1 (donde se escribe)', paso('amount'), 1);
  eq('pago acordado → paso 3', paso('pay_intent'), 3);
  eq('técnico → paso 0', paso('technician'), 0);
}

// ── 10. Multi-equipo: el monto se evalúa por equipo, no por la suma ─────────────────────────
{
  const unEquipoSinMonto = buildFicha(base({ amount: 30, amountOk: false }));
  const am = unEquipoSinMonto.groups.flatMap(g => g.fields).find(x => x.key === 'amount')!;
  ok('avisa que falta el monto de un equipo', /algún equipo/.test(String(am.warn)));
  eq('y no bloquea (el monto nunca bloquea)', unEquipoSinMonto.completa, true);
  const sinMonto = buildFicha(base({ amount: 0 }));
  const am0 = sinMonto.groups.flatMap(g => g.fields).find(x => x.key === 'amount')!;
  eq('monto 0 queda como pendiente', [am0.value, am0.state], [null, 'pendiente']);
  eq('y NO se marca como «a revisar» (no es un error de formato)', am0.warn, undefined);
  ok('una ficha recién abierta no tiene nada «a revisar» de arranque',
    buildFicha(base({ client: '', clientCi: '', phone: '', model: '', color: '', serviceTypes: [], fault: '', amount: 0, payIntent: null, technician: '', photoInAt: null })).warns.length === 0);
}

// ── 11. Inspección: cuenta solo lo que va MÁS ALLÁ de los defaults ──────────────────────────
{
  eq('los dos defaults no cuentan como inspección', inspeccionCount({ chip_sim: 'no', accesorios: 'no' }, { chip_sim: 'no', accesorios: 'no' }), 0);
  eq('marcar un ítem nuevo cuenta', inspeccionCount({ chip_sim: 'no', accesorios: 'no', camara: 'si' }, { chip_sim: 'no', accesorios: 'no' }), 1);
  eq('cambiar un default cuenta', inspeccionCount({ chip_sim: 'si' }, { chip_sim: 'no', accesorios: 'no' }), 1);
}

console.log(`\nficha: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallas`);
if (failures > 0) process.exit(1);
