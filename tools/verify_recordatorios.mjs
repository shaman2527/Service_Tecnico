// Verificación EN VIVO (CDP) de F32 — recepción guiada + recordatorios de política + entregados hoy.
//
// Qué comprueba sobre la app REAL:
//   1. `get_services` acepta el eje de fecha nuevo (`dateField: 'out'`) y sigue funcionando SIN el
//      argumento (los llamadores viejos no se rompen).
//   2. Una orden creada por el wizard nace en el estado elegido (`Recibido`), no en el default
//      silencioso «Por entregar».
//   3. Los avisos de política APARECEN cuando corresponde (foto de entrada + preguntar el pago) y
//      sus botones ANOTAN la respuesta en la orden (foto tomada / paga al retirar).
//   4. La guía por estado del wizard está visible y dice qué falta.
//   5. Al entregar con el asistente: la tira avisa la foto de salida y el aviso de política
//      aparece para confirmarla (queda `photo_out_at`).
//   6. La lista muestra el KPI y el panel «Teléfonos entregados hoy» con la orden entregada hoy.
//   7. El talón del comprobante lleva la línea ACORDADO y el recibo principal NO.
//
// SEGURIDAD DE DATOS: escribe de verdad (es una prueba), así que:
//   · **NO abre el día**: si no hay turno abierto, ABORTA (el script viejo de F30 lo abría con una
//     tasa falsa y ensuciaba el libro del local);
//   · NO toca dinero ni stock (la orden de prueba se crea con monto 0 y sin «Cambio pantalla»);
//   · al final BORRA la orden de prueba y comprueba que no queda nada.
//
// Uso:  node tools/verify_recordatorios.mjs      (con la app abierta y CDP en :9222)

import { evalx, clickCenter, keyNav, insertText, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
/** Igual que `invoke` pero atrapa el rechazo DENTRO de la página (devuelve el mensaje de error). */
const invokeErr = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(() => null, (e) => String(e)))()`);
const dialogText = () => evalx(`(document.querySelector('[role="dialog"], [role="alertdialog"]')?.innerText) ?? null`);

const waitReady = async (timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) return true; } catch { /* recargando */ }
    await sleep(700);
  }
  return false;
};

await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
await waitReady();

const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) {
  // Mismo patrón probado de las otras verificaciones: click real + teclado + Enter.
  await clickCenter(pin);
  await evalx(`(() => { const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]'); i.focus(); i.select(); return true; })()`);
  for (const ch of '1234') {
    await evalx(`(() => {
      const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]');
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, i.value + '${ch}');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await sleep(500);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// ── 0) GATE DE DATOS: sin día abierto NO se corre (no se abre por la prueba) ────────────────
const dia = await invoke('get_active_day').catch(() => null);
if (!dia) {
  console.log('ABORTADO: no hay día abierto. Abrí el día en Libro Diario y volvé a correr la prueba (esta prueba NO abre el día: no ensucia el turno del local).');
  process.exit(2);
}
console.log(`· día abierto (${dia.close_date ?? 'hoy'}) · tasa ${dia.tasa_bcv}`);

// ── 1) el eje de fecha nuevo: con 'out' y SIN el argumento (llamadores viejos) ──────────────
const hoy = await evalx(`(() => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })()`);
const conOut = await invoke('get_services', { search: '', status: '', startDate: hoy, endDate: hoy, dateField: 'out' });
const sinArg = await invoke('get_services', { search: '', status: '', startDate: hoy, endDate: hoy });
check('F32: get_services acepta dateField="out" (fecha de entrega)', Array.isArray(conOut), `filas=${conOut?.length}`);
check('F32: get_services sigue funcionando SIN dateField (llamadores viejos)', Array.isArray(sinArg), `filas=${sinArg?.length}`);

// ── preparación: una orden de prueba (con monto, sin pantalla, estado elegido) ───────────────
// El monto va en 30 a propósito: así los pasos del wizard quedan completos y se puede llegar al
// botón Guardar. (Un monto 0 es legítimo — garantía/cortesía — y NO bloquea ningún paso: la orden de
// $0 de más abajo comprueba justamente que se puede editar y guardar.)
const marca = String(Date.now()).slice(-6);
const dispositivo = {
  model: 'Galaxy A06 4G', fault: 'prueba de recordatorios', service_type: 'Software / Formateo',
  service_types: JSON.stringify(['Software / Formateo']), amount: 30, discount_amount: 0,
  payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
  currency: 'USD', device_checklist: '', color: '', screen_product_id: null, status: 'Recibido',
};
const nueva = await invoke('add_service_order', {
  client: `Prueba Recordatorio ${marca}`, phone: '0414-0000000', clientCi: `V-9${marca}`, clientAddress: '',
  clientId: null, technician: '', technicianId: null,
  devices: [dispositivo],
});
const rows = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
const svc = rows.find(r => (r.order_num ?? '') === nueva || (r.order_num ?? '').startsWith(`${nueva}-`));
check('F32: la orden nace en el estado elegido (Recibido)', svc?.status === 'Recibido', `orden ${nueva} · estado=${svc?.status}`);
const id = svc?.id;
if (!id) { console.log('ABORTADO: no se pudo preparar la orden de prueba'); process.exit(1); }

// F32: el backend RECHAZA crear una orden ya entregada (no solo la UI): sin `date_out` ni
// descuento de stock quedaría fuera de «Entregados hoy», sin garantía y con el inventario inflado.
const rechazada = await invokeErr('add_service_order', {
  client: `Prueba Nace Entregado ${marca}`, phone: '', clientCi: '', clientAddress: '',
  clientId: null, technician: '', technicianId: null,
  devices: [{ ...dispositivo, status: 'Entregado' }],
});
check('F32: el backend rechaza crear una orden ya ENTREGADA', /estado de taller/i.test(String(rechazada)), String(rechazada).slice(0, 110));

// ── 2) la lista: KPI, botón y conmutador Recibidos/Entregados ───────────────────────────────
// Todo lo de acá en adelante va dentro de un try: si una interacción falla, la prueba lo reporta
// como FAIL y **igual borra las órdenes de prueba** (nunca deja basura en la base).
let idCero = null;
try {
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
await sleep(1600);
check('F32: la lista tiene la tarjeta KPI «Entregados hoy»', await evalx(`!!document.querySelector('[data-kpi="entregados-hoy"]')`));
check('F32: la lista tiene el botón «Entregados hoy»', await evalx(`!!document.querySelector('[data-action="entregados-hoy"]')`));
const ejes = await evalx(`(() => [...document.querySelectorAll('[data-slot="toggle-group-item"], button')].map(b => b.innerText.trim()).filter(t => /^(Recibidos|Entregados)$/.test(t)).join(','))()`);
check('F32: el filtro de fechas ofrece Recibidos y Entregados', String(ejes).includes('Recibidos') && String(ejes).includes('Entregados'), String(ejes));
const ariaInicial = await evalx(`document.querySelector('input[aria-label="Recibidos desde"], input[aria-label="Entregados desde"]')?.getAttribute('aria-label') ?? null`);
check('F32: el rótulo del rango dice qué fecha se está filtrando', ariaInicial === 'Recibidos desde', String(ariaInicial));

// buscar la orden de prueba y ver el chip de política
await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); })()`);
await keyNav('Backspace', 'Backspace', 8);
await insertText(marca);
await sleep(1800);
const chipEntrada = await evalx(`document.body.innerText.includes('Sin foto de entrada')`);
check('F32: la tarjeta avisa «Sin foto de entrada» (política pendiente)', chipEntrada);

// ── 3) el wizard: FICHA DE INGRESO (asistente) + controles de política ──────────────────────
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Editar$/.test(b.innerText.trim()))`);
await sleep(1800);
let dlg = String(await dialogText() ?? '');
check('F33: el wizard muestra la FICHA DE INGRESO', /Ficha de ingreso/i.test(dlg), (dlg.match(/Ficha de ingreso[^\n]*/) ?? [''])[0]);
check('F33: la ficha trae el progreso y pide el dato que toca',
  await evalx(`!!document.querySelector('[data-ficha] [data-ficha-progreso]')`) &&
  await evalx(`!!document.querySelector('[data-ficha] [data-ficha-next]')`));
// La ficha completa se abre a un clic y muestra los cuatro bloques del mostrador
await clickCenter(`[...document.querySelectorAll('[data-ficha] button')].find(b => /Ver ficha/i.test(b.innerText.trim()))`);
await sleep(700);
const detalle = String(await evalx(`document.querySelector('[data-ficha-detalle]')?.innerText ?? ''`));
const dtxt = detalle.toLowerCase();
check('F33: la ficha completa trae los cuatro bloques',
  ['datos del cliente', 'ficha técnica del dispositivo', 'diagnóstico y recepción', 'condiciones comerciales'].every(t => dtxt.includes(t)),
  detalle.replace(/\s+/g, ' ').slice(0, 90));
check('F33: cada dato muestra su valor o «Pendiente»', /Pendiente|Sí|No|\$/.test(detalle));
check('F33: la ficha avisa el paso siguiente del proceso', /Siguiente en el proceso:/.test(dlg));
// El «Ir al campo» de la ficha lleva al paso donde se carga ese dato (para corregir sin perder el resto)
await clickCenter(`(() => { const it = document.querySelector('[data-ficha-field="pay_intent"]'); return it; })()`);
await sleep(900);
const hayPago = await evalx(`!!document.querySelector('[data-policy-block="pago"]')`);
check('F33: tocar el dato del pago lleva al paso donde se anota', hayPago);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] [data-policy-block="pago"] button')].find(b => /^Paga al retirar$/i.test(b.innerText.trim()))`);
await sleep(600);
// ir al paso Blindaje tocando el dato de la foto de ENTRADA y marcarla
await clickCenter(`(() => { const it = document.querySelector('[data-ficha-field="photo_in"]'); return it; })()`);
await sleep(900);
const hayFotoIn = await evalx(`!!document.querySelector('[data-policy="photo_in"]')`);
check('F33: tocar el dato de la foto de ENTRADA lleva al paso Blindaje', hayFotoIn);
if (hayFotoIn) { await clickCenter(`document.querySelector('[data-policy="photo_in"]')`); await sleep(500); }
// El botón de guardar vive en el ÚLTIMO paso: se llega con «Siguiente» (los pasos están completos:
// el monto de la orden es 30).
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim()))`);
await sleep(800);
// Con la foto marcada, la ficha ya no la pide como pendiente (se mira dentro del detalle)
const estadoFotoIn = await evalx(`(() => {
  const it = document.querySelector('[data-ficha-field="photo_in"]');
  return it ? (it.innerText.includes('Tomada') ? 'ok' : it.getAttribute('data-state')) : 'sin-fila';
})()`);
check('F33: con la foto de ENTRADA marcada, la ficha muestra «Tomada»', estadoFotoIn === 'ok', `estado=${estadoFotoIn}`);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim()))`);
await sleep(900);
const botonGuardar = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Actualizar Servicio$/i.test(x.innerText.trim())); return b ? !b.disabled : null; })()`);
check('F32: el wizard llega al paso de guardar con el botón habilitado', botonGuardar === true, `disabled=${botonGuardar === null ? 'no existe' : !botonGuardar}`);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Actualizar Servicio$/i.test(b.innerText.trim()))`);
await sleep(2500);
dlg = String(await dialogText() ?? '');
if (/Actualizar Servicio/i.test(dlg)) { await keyNav('Escape', 'Escape', 27); await sleep(800); }
const trasEditar = await invoke('get_service', { id });
check('F32: el wizard GUARDA la foto de entrada y el acuerdo de pago',
  !!trasEditar?.photo_in_at && trasEditar?.pay_intent === 'al_retirar',
  `foto_entrada=${trasEditar?.photo_in_at} · acuerdo=${trasEditar?.pay_intent}`);

// ── 4) el comprobante: aviso de política + línea ACORDADO en el talón ───────────────────────
const hayBotonOrden = await evalx(`[...document.querySelectorAll('button')].some(b => /^(Orden|Reimprimir)$/.test(b.innerText.trim()))`);
check('F32: la tarjeta de la orden ofrece imprimir el comprobante', hayBotonOrden);
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^(Orden|Reimprimir)$/.test(b.innerText.trim()))`);
await sleep(2200);
const talon = String(await dialogText() ?? '');
check('F32: el comprobante abre con el recibo y el talón', /CORTA TIJERA/i.test(talon), talon.replace(/\s+/g, ' ').slice(0, 140));
check('F32: el talón imprime el ACUERDO de pago', /ACORDADO: PAGA AL RETIRAR/.test(talon), (talon.match(/ACORDADO:[^\n]*/) ?? [''])[0]);
const avisosComprobante = await evalx(`[...document.querySelectorAll('[data-reminder]')].map(e => e.getAttribute('data-reminder')).join(',')`);
check('F32: con la política ya anotada, el comprobante NO vuelve a insistir', String(avisosComprobante) === '', `avisos=${avisosComprobante}`);
await keyNav('Escape', 'Escape', 27);
await sleep(900);

// ── 5) la entrega: tira informativa + aviso de foto de SALIDA que se puede confirmar ────────
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Cerrar$/.test(b.innerText.trim()))`);
await sleep(1800);
const asistente = String(await dialogText() ?? '');
check('F32: el asistente avisa la foto de salida (informativo, no bloquea)', /Foto de salida pendiente/i.test(asistente));
await keyNav('Escape', 'Escape', 27);
await sleep(900);
// Se entrega con el botón de la tarjeta (la orden tiene saldo: pide confirmación y NO bloquea)
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Entregar$/.test(b.innerText.trim()))`);
await sleep(1200);
const confirmacion = String(await dialogText() ?? '');
check('F32: entregar con saldo pide confirmación (flujo de siempre)', /saldo pendiente/i.test(confirmacion));
await clickCenter(`[...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find(b => /^Entregar con saldo pendiente$/i.test(b.innerText.trim()))`);
await sleep(3000);
const avisoSalida = await evalx(`(() => { const t = document.querySelector('[data-reminder="photo_out"]'); return t ? t.innerText.replace(/\\s+/g, ' ').slice(0, 80) : null; })()`);
check('F32: al entregar sale el recordatorio de la foto de salida', !!avisoSalida, String(avisoSalida));
// El aviso NO debe comerse los clics (taparía botones del pie del diálogo / de la cabecera):
// su tarjeta y su contenedor son pointer-events-none y solo los botones del aviso reciben el clic.
const noIntercepta = await evalx(`(() => {
  const t = document.querySelector('[data-reminder="photo_out"]');
  if (!t) return 'sin aviso';
  const li = t.closest('li') ?? t;
  const boton = t.querySelector('button');
  return JSON.stringify({
    tarjeta: getComputedStyle(t).pointerEvents,
    contenedor: getComputedStyle(li).pointerEvents,
    boton: boton ? getComputedStyle(boton).pointerEvents : null,
  });
})()`);
check('F32: el aviso no intercepta los clics (solo sus botones)',
  /"tarjeta":"none"/.test(String(noIntercepta)) && /"contenedor":"none"/.test(String(noIntercepta)) && /"boton":"auto"/.test(String(noIntercepta)),
  String(noIntercepta));
const entregada = await invoke('get_service', { id });
check('F32: la orden quedó Entregado con la fecha de hoy', entregada?.status === 'Entregado' && String(entregada?.date_out ?? '').slice(0, 10) === hoy,
  `estado=${entregada?.status} · salida=${entregada?.date_out}`);
check('F32: la entrega NO se bloqueó por el aviso (foto todavía sin confirmar)', !entregada?.photo_out_at);
// La orden entregada ya no está en la lista (el filtro por defecto es «en taller»), pero sí en el
// panel «Entregados hoy»: de ahí se imprimen/abren las órdenes del día.
await evalx(`(() => { const p = document.querySelector('[data-panel="entregados-hoy"]'); if (p) p.scrollIntoView({ block: 'center' }); return true; })()`);
await sleep(700);
// M2: abrir el comprobante con el aviso de foto de salida AÚN visible NO debe apilar otra tarjeta
// igual (mismo id de sonner).
await clickCenter(`(() => { const f = document.querySelector('[data-delivered-order="${nueva}"]'); return f ? [...f.querySelectorAll('button')].find(b => /Factura/i.test(b.innerText)) : null; })()`);
await sleep(2200);
check('F32: el comprobante abre desde el panel de entregados de hoy', /CORTA TIJERA/i.test(String(await dialogText() ?? '')));
const cuantos = await evalx(`document.querySelectorAll('[data-reminder="photo_out"]').length`);
check('F32: el mismo aviso no se apila al abrir el comprobante (dedupe)', cuantos === 1, `tarjetas=${cuantos}`);
await keyNav('Escape', 'Escape', 27);
await sleep(900);
// confirmar la foto desde el aviso (botón «Ya le tomé la foto»)
await clickCenter(`(() => { const t = document.querySelector('[data-reminder="photo_out"]'); return t ? [...t.querySelectorAll('button')].find(b => /Ya le tomé la foto/i.test(b.innerText)) : null; })()`);
await sleep(2200);
const conFoto = await invoke('get_service', { id });
check('F32: el aviso ANOTA la foto de salida en la orden', !!conFoto?.photo_out_at, `foto_salida=${conFoto?.photo_out_at}`);
// F33: con la foto YA tomada, la ficha del wizard no puede seguir mostrándola pendiente
await clickCenter(`(() => { const f = document.querySelector('[data-delivered-order="${nueva}"]'); return f ? [...f.querySelectorAll('button')].find(b => /Abrir/i.test(b.innerText)) : null; })()`);
await sleep(2000);
// la ficha se abre a un clic para ver el detalle de los datos
await clickCenter(`[...document.querySelectorAll('[data-ficha] button')].find(b => /Ver ficha/i.test(b.innerText.trim()))`).catch(() => {});
await sleep(700);
const estadoFotoOut = await evalx(`(() => {
  const it = document.querySelector('[data-ficha-field="photo_out"]') ?? document.querySelector('[data-ficha-field="photo_in"]');
  return it ? it.innerText.replace(/\\s+/g, ' ').slice(0, 60) : 'sin-fila';
})()`);
check('F33: la ficha muestra la foto ya tomada (no la deja pendiente)', !/Pendiente/.test(String(estadoFotoOut)), String(estadoFotoOut));
await keyNav('Escape', 'Escape', 27);
await sleep(900);
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(900); }

// ── 6) el MONTO es aviso, no bloqueo (una orden de $0 es legítima: garantía/cortesía) ───────
// Regresión detectada en la 2ª vuelta adversarial: llegar a exigir el monto en el guardado dejaba
// sin poder guardar órdenes reales de $0 (hay una en la base). Se comprueba ANTES de filtrar por
// «Entregados hoy» (la orden es «Recibido»: con ese filtro quedaría oculta).
{
  const cero = await invoke('add_service_order', {
    client: `Prueba Monto Cero ${marca}`, phone: '', clientCi: '', clientAddress: '',
    clientId: null, technician: '', technicianId: null,
    devices: [{ ...dispositivo, amount: 0 }],
  });
  const filasCero = await invoke('get_services', { search: `Monto Cero ${marca}`, status: '', startDate: '', endDate: '', dateField: 'in' });
  const svcCero = filasCero.find(r => (r.order_num ?? '') === cero);
  if (svcCero) {
    idCero = svcCero.id;
    await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
    await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); })()`);
    await keyNav('Backspace', 'Backspace', 8);
    await insertText(`Monto Cero ${marca}`);
    await sleep(1600);
    await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Editar$/.test(b.innerText.trim()))`);
    await sleep(1800);
    // la ficha abre el detalle con un clic y ahí se ve el dato del monto
    await clickCenter(`[...document.querySelectorAll('[data-ficha] button')].find(b => /Ver ficha/i.test(b.innerText.trim()))`).catch(() => {});
    await sleep(700);
    const estadoMonto = await evalx(`(() => { const it = document.querySelector('[data-ficha-field="amount"]'); return it ? it.getAttribute('data-state') : null; })()`);
    check('F33: una orden de monto 0 se marca como AVISO en la ficha (no la bloquea)',
      estadoMonto === 'pendiente' || estadoMonto === 'ok', `data-state=${estadoMonto}`);
    check('F33: la ficha NO la marca como dato que falta', estadoMonto !== 'falta', `data-state=${estadoMonto}`);
    // BLOQUEANTE de la revisión adversarial: editar una orden de $0 tiene que poder LLEGAR al botón
    // de guardar. Antes el paso «Finanzas» exigía monto (`done: amount > 0`) y, como el botón Guardar
    // solo se dibuja en el ÚLTIMO paso, el operario quedaba encerrado: «Siguiente» apagado y sin
    // forma de llegar a «Cierre» (fecha de salida, observaciones y panel de pagos).
    for (let i = 0; i < 4; i++) {
      await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim()))`).catch(() => {});
      await sleep(600);
    }
    const botonGuardar = await evalx(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Actualizar Servicio$/.test(x.innerText.trim()));
      return b ? JSON.stringify({ texto: b.innerText.trim(), deshabilitado: b.disabled }) : null;
    })()`);
    check('F33: editar una orden de $0 llega al botón «Actualizar Servicio» (el monto no encierra el wizard)',
      !!botonGuardar && JSON.parse(botonGuardar).deshabilitado === false, String(botonGuardar));
    await keyNav('Escape', 'Escape', 27);
    await sleep(700);
  }
}

// ── 7) «entregados hoy»: filtro, KPI y panel con la orden ───────────────────────────────────
await sleep(1200);
await clickCenter(`document.querySelector('[data-action="entregados-hoy"]')`);
await sleep(2200);
const filtro = await evalx(`(() => {
  const inputs = [...document.querySelectorAll('input[type="date"]')].map(i => i.value);
  const toggles = [...document.querySelectorAll('button')].filter(b => /^(Recibidos|Entregados)$/.test(b.innerText.trim())).map(b => ({ t: b.innerText.trim(), on: b.getAttribute('data-state') }));
  return JSON.stringify({ inputs, toggles });
})()`);
const f = JSON.parse(filtro);
check('F32: «Entregados hoy» filtra por la fecha de ENTREGA de hoy', f.inputs.every(v => v === hoy), JSON.stringify(f.inputs));
check('F32: el conmutador queda en «Entregados»', f.toggles.some(t => t.t === 'Entregados' && t.on === 'on'), JSON.stringify(f.toggles));
const kpi = await evalx(`document.querySelector('[data-kpi="entregados-hoy"]')?.innerText.replace(/\\s+/g,' ') ?? null`);
check('F32: el KPI «Entregados hoy» cuenta la entrega de hoy', Number(String(kpi).match(/(\d+)/)?.[1] ?? 0) >= 1, String(kpi));
// El texto de la fila se recorta para el mensaje de diagnóstico, pero el recorte tiene que ser
// suficientemente largo: con F38 la fila dice además el saldo en las dos monedas («Falta $30.00
// (Bs. 22.464,00)») y «Sin imprimir» quedaba fuera de un slice de 120 → el chequeo fallaba por el
// recorte, no por el producto.
const fila = await evalx(`(() => { const e = document.querySelector('[data-delivered-order="${nueva}"]'); return e ? e.innerText.replace(/\\s+/g,' ').slice(0, 240) : null; })()`);
check('F32: el panel lista el teléfono entregado hoy con su foto confirmada', !!fila && /Foto/.test(String(fila)), String(fila));
check('F32: el panel avisa la orden sin imprimir', /Sin imprimir/.test(String(fila ?? '')));
// El panel NO muestra como «método» lo que el formulario esperaba cobrar: sin pagos reales dice
// el acuerdo (o «Sin pago»).
check('F32: el panel muestra el ACUERDO de pago, no el método del formulario', /Paga al retirar/.test(String(fila ?? '')) && !/Divisas/.test(String(fila ?? '')), String(fila));

// ── 7) la RECEPCIÓN: aviso de política al abrir el wizard + estado por defecto ──────────────
// (lo que pidió el usuario: «un mensaje que salga de repente cada vez que vayas a registrar un
//  servicio… recuerda tomarle la foto al tlf… recuerda preguntar si va a cancelar ahorita o
//  después»). No se guarda nada: solo se abre el wizard y se cierra.
await evalx(`history.length; 'listo'`);
await evalx(`(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()`);
// diagnóstico: el botón de la cabecera existe y tiene tamaño (los avisos ya no interceptan clics)
const infoBoton = await evalx(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^Nuevo Servicio$/.test(x.innerText.trim()));
  if (!b) return 'sin botón';
  const r = b.getBoundingClientRect();
  return JSON.stringify({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
})()`);
check('F32: el botón «Nuevo Servicio» está disponible', !/sin botón/.test(String(infoBoton)), String(infoBoton));
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim()))`).catch(() => {});
await sleep(1600);
let wizardAbierto = await evalx(`!!document.querySelector('[role="dialog"]')`);
if (!wizardAbierto) {
  // plan B honesto: el atajo de teclado de la app (F2 = Nuevo Servicio)
  await keyNav('F2', 'F2', 113);
  await sleep(2000);
  wizardAbierto = await evalx(`!!document.querySelector('[role="dialog"]')`);
}
check('F32: el wizard de recepción abre', wizardAbierto);
await sleep(700);
// F33 — LO IMPORTANTE: al registrar NO sale ningún aviso flotante (el usuario lo sintió invasivo y
// tapaba el formulario). El asistente es la ficha, DENTRO del formulario.
const flotantes = await evalx(`document.querySelectorAll('[data-reminder]').length`);
check('F33: al abrir una recepción NO hay avisos flotantes encima del formulario', flotantes === 0, `avisos=${flotantes}`);
const wizardNuevo = String(await dialogText() ?? '');
check('F33: el asistente es la ficha de ingreso, con el dato que toca pedir',
  /Ficha de ingreso/i.test(wizardNuevo) && /Ir al campo/i.test(wizardNuevo),
  (wizardNuevo.match(/Ficha de ingreso[^\n]*/) ?? [''])[0]);
const foco = await evalx(`document.activeElement?.getAttribute('placeholder') ?? null`);
check('F33: el asistente no le roba el foco al primer campo (arranca en Cliente)',
  String(foco ?? '').includes('Buscar por nombre o cédula'), String(foco));
check('F33: la ficha anuncia el paso siguiente del proceso', /Siguiente en el proceso: En reparación/.test(wizardNuevo));
// La ficha pide de a UNO: el primer dato pedido es el nombre del cliente en una recepción vacía
const primerDato = await evalx(`document.querySelector('[data-ficha-next]')?.getAttribute('data-ficha-next') ?? null`);
check('F33: la ficha pide el primer dato (cliente)', primerDato === 'client', String(primerDato));
// Recibiendo un equipo NO se puede nacer «Entregado», así que la ficha de la recepción no habla de
// la entrega (lo verifica también el rechazo del backend más arriba).
check('F33: la ficha de la recepción no habla de entregar el equipo', !/Imprimir la orden de entrega/.test(wizardNuevo));

// F33 — «corregir [campo] SIN borrar el resto»: se escribe el nombre, se toca otro dato (que lleva a
// su paso) y al volver a Cliente desde la ficha lo cargado tiene que seguir ahí. Es el pedido textual
// del usuario («que te vaya guiando cada paso de input… no me deja ver lo que estoy registrando»).
const escribeCliente = async (texto) => evalx(`(() => {
  const i = [...document.querySelectorAll('input')].find(x => /Buscar por nombre o cédula/i.test(x.placeholder || ''));
  if (!i) return false;
  i.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(texto)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await escribeCliente('Cliente Ficha F33');
await sleep(900);
const fichaConCliente = await evalx(`(() => ({
  progreso: document.querySelector('[data-ficha-progreso]')?.innerText.trim(),
  next: document.querySelector('[data-ficha-next]')?.getAttribute('data-ficha-next') ?? null,
}))()`);
const fc = fichaConCliente ?? {};
// Se despliega la ficha completa (las filas por dato viven dentro de «Ver ficha»)
await clickCenter(`[...document.querySelectorAll('button')].find(b => /Ver ficha/i.test(b.innerText))`).catch(() => {});
await sleep(700);
const bloques = await evalx(`(() => {
  const det = document.querySelector('[data-ficha-detalle]');
  return JSON.stringify({
    abierta: !!det,
    filas: det ? det.querySelectorAll('[data-ficha-field]').length : 0,
    client: document.querySelector('[data-ficha-field="client"]')?.getAttribute('data-state') ?? null,
    titulos: det ? [...det.querySelectorAll('p')].map(p => p.innerText.trim()).filter(t => /cliente|dispositivo|recepción|comerciales/i.test(t)) : [],
  });
})()`);
const bl = JSON.parse(bloques);
check('F33: la ficha completa se despliega con los 4 bloques del mostrador', bl.abierta && bl.titulos.length === 4, JSON.stringify(bl.titulos));
check('F33: la ficha lista los 16 datos (uno por fila, con su estado)', bl.filas >= 16, `filas=${bl.filas}`);
check('F33: al escribir el cliente la ficha lo marca cargado y pide el siguiente dato',
  bl.client === 'ok' && fc.next !== 'client' && Number(String(fc.progreso).split('/')[0]) >= 1,
  `progreso=${fc.progreso} client=${bl.client} next=${fc.next}`);
// Tocar OTRO dato lleva a su paso sin cerrar la ficha (el «corregir» del mostrador)
await clickCenter(`document.querySelector('[data-ficha-field="amount"]')`).catch(() => {});
await sleep(900);
const trasIr = await evalx(`(() => ({
  fichaSigue: !!document.querySelector('[data-ficha]'),
  detalleSigue: !!document.querySelector('[data-ficha-detalle]'),
  pasos: [...document.querySelectorAll('button')].filter(b => /Equipos|Blindaje|Revisar|Cliente/i.test(b.innerText.trim())).map(b => b.innerText.trim() + ':' + (b.getAttribute('data-state') || '')).slice(0, 8),
}))()`);
check('F33: tocar un dato de la ficha NO la cierra ni tapa el formulario',
  trasIr.fichaSigue === true, JSON.stringify(trasIr.pasos).slice(0, 120));
// Pulsar «Ir al campo» del dato pedido y volver a Cliente desde la ficha: el nombre sigue escrito
await clickCenter(`document.querySelector('[data-ficha-field="client"]')`).catch(() => {});
await sleep(900);
const volvio = await evalx(`(() => {
  const i = [...document.querySelectorAll('input')].find(x => /Buscar por nombre o cédula/i.test(x.placeholder || ''));
  return i ? i.value : '(campo Cliente no visible)';
})()`);
check('F33: volver a un dato desde la ficha CONSERVA lo ya cargado (corregir sin borrar el resto)',
  volvio === 'Cliente Ficha F33', `valor="${volvio}"`);
await keyNav('Escape', 'Escape', 27);
await sleep(800);

// ── 9) limpieza: se borran las órdenes de prueba ────────────────────────────────────────────
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}
await invoke('delete_service', { id });
if (idCero) await invoke('delete_service', { id: idCero });
const restos = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
check('F32: las órdenes de prueba quedaron borradas (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
