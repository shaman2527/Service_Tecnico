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

// ── helpers del MODAL de política (F46: el aviso ya no es una tarjeta flotante de sonner, es un
//    modal CENTRADO que hay que responder) ───────────────────────────────────────────────────
const modalAbierto = () => evalx(`!!document.querySelector('[data-policy-modal]')`);
/** Cierra el modal de política si está abierto, SIN anotar nada (botón «Después»). */
const posponerModal = async () => {
  const hay = await modalAbierto();
  if (hay) {
    await clickCenter(`document.querySelector('[data-policy-later]')`);
    await sleep(900);
  }
  return hay;
};

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

/** Clic que VERIFICA el efecto y reintenta: clic real y, si el efecto no aparece, el clic del propio
 *  elemento (los tilde de política viven al borde inferior del diálogo y un clic por coordenadas puede
 *  caer al lado). Se ESPERA el efecto, no se supone. */
const clicSeguro = async (expr, verificar, intentos = 4) => {
  for (let i = 0; i < intentos; i++) {
    if (await evalx(verificar).catch(() => false)) return true;
    await clickCenter(expr).catch(() => {});
    await sleep(300);
    if (await evalx(verificar).catch(() => false)) return true;
    await evalx(`(() => { const el = (${expr}); if (el && el.click) el.click(); return !!el; })()`).catch(() => {});
    await sleep(450);
  }
  return await evalx(verificar).catch(() => false);
};

// ── helper F47/F48: elegir el COLOR del equipo con el teclado (el dato es obligatorio desde F48, y
//    las órdenes que crea esta prueba nacen por IPC sin color). Se abre el paso «Equipo» si hace
//    falta y se elige «Azul»: foco en el selector → Enter abre → flechas → Enter confirma.
const elegirColor = async (label = 'Azul') => {
  if (!(await evalx(`!!document.querySelector('[data-ficha-target="color"]')`))) {
    // La ficha ES la que lleva al campo (F48): se despliega el detalle y se toca el dato «Color /
    // acabado» → el wizard salta al paso del equipo y deja el foco en el selector.
    if (!(await evalx(`!!document.querySelector('[data-ficha-detalle]')`))) {
      await clickCenter(`([...document.querySelectorAll('[data-ficha] button')].find(b => /Ver ficha/i.test(b.innerText.trim())) || null)`).catch(() => {});
      await sleep(700);
    }
    await clickCenter(`([...document.querySelectorAll('[data-ficha-field="color"]')].find(e => e.closest('[role="dialog"]')) || null)`).catch(async () => {
      await evalx(`(() => { const e = [...document.querySelectorAll('[data-ficha-field="color"]')].find(x => x.closest('[role="dialog"]')); if (e) e.click(); return !!e; })()`);
    });
    await sleep(1000);
  }
  if (!(await evalx(`!!document.querySelector('[data-ficha-target="color"]')`))) return false;
  await evalx(`(() => { const t = document.querySelector('[data-ficha-target="color"]'); if (t) t.focus(); return !!t; })()`);
  await keyNav('Enter', 'Enter', 13);
  await sleep(700);
  for (let i = 0; i < 14; i++) {
    const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
    if (String(hi).includes(label)) { await keyNav('Enter', 'Enter', 13); await sleep(900); return true; }
    await keyNav('ArrowDown', 'ArrowDown', 40);
    await sleep(220);
  }
  return false;
};

// ── 3) el wizard: FICHA DE INGRESO (asistente) + controles de política ──────────────────────
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Editar$/.test(b.innerText.trim()))`);
await sleep(1800);
let dlg = String(await dialogText() ?? '');
check('F33: el wizard muestra la FICHA DE INGRESO', /Ficha de ingreso/i.test(dlg), (dlg.match(/Ficha de ingreso[^\n]*/) ?? [''])[0]);
check('F33: la ficha trae el progreso y pide el dato que toca',
  await evalx(`!!document.querySelector('[data-ficha] [data-ficha-progreso]')`) &&
  await evalx(`!!document.querySelector('[data-ficha] [data-ficha-next]')`));
check('F48 (preparación): el color del equipo se elige en el wizard',
  await elegirColor(), `color=${await evalx(`document.querySelector('[data-ficha-target="color"]')?.innerText.trim() ?? null`)}`);
// La ficha completa se abre a un clic y muestra los cuatro bloques del mostrador.
// (El botón alterna «Ver ficha»/«Ocultar ficha»: si el detalle ya quedó abierto al elegir el color,
// no hay nada que clickear.)
if (!(await evalx(`!!document.querySelector('[data-ficha-detalle]')`))) {
  await clickCenter(`([...document.querySelectorAll('[data-ficha] button')].find(b => /Ver ficha/i.test(b.innerText.trim())) || null)`).catch(() => {});
}
await sleep(600);
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
const pagoOk = await clicSeguro(
  `([...document.querySelectorAll('[role="dialog"] [data-policy-block="pago"] button')].find(b => /^Paga al retirar$/i.test(b.innerText.trim())) || null)`,
  `(() => { const b = [...document.querySelectorAll('[role="dialog"] [data-policy-block="pago"] button')].find(x => /^Paga al retirar$/i.test(x.innerText.trim())); return b?.getAttribute('data-state') === 'on'; })()`,
);
check('F32: el acuerdo «Paga al retirar» queda marcado', pagoOk);
await sleep(500);
// ir al paso Blindaje tocando el dato de la foto de ENTRADA y marcarla
await clickCenter(`(() => { const it = document.querySelector('[data-ficha-field="photo_in"]'); return it; })()`);
await sleep(900);
const hayFotoIn = await evalx(`!!document.querySelector('[data-policy="photo_in"]')`);
check('F33: tocar el dato de la foto de ENTRADA lleva al paso Blindaje', hayFotoIn);
if (hayFotoIn) {
  const fotoOk = await clicSeguro(`document.querySelector('[data-policy="photo_in"]')`,
    `document.querySelector('[data-policy="photo_in"]')?.checked === true`);
  check('F32: el tilde «Ya le tomé la foto de ENTRADA» queda marcado', fotoOk);
}
// El botón de guardar vive en el ÚLTIMO paso y la foto se anota en «Blindaje»: se avanza con
// «Siguiente» hasta que aparezca el botón (con el color obligatorio de F48 el camino puede tener un
// paso más, así que se ESPERA la condición en vez de contar clics).
const irAlUltimoPaso = async () => {
  for (let i = 0; i < 6; i++) {
    if (await evalx(`[...document.querySelectorAll('[role="dialog"] button')].some(b => /^Actualizar (Servicio|e imprimir)$/.test(b.innerText.trim()))`)) return true;
    await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim())) || null)`).catch(async () => {
      await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test(x.innerText.trim())); if (b) b.click(); return !!b; })()`);
    });
    await sleep(800);
  }
  return await evalx(`[...document.querySelectorAll('[role="dialog"] button')].some(b => /^Actualizar (Servicio|e imprimir)$/.test(b.innerText.trim()))`);
};
/**
 * F77: el último paso del wizard trae el check «Imprimir la orden ahora» PREMARCADO y entonces el
 * botón dice «Guardar e imprimir» (al guardar se abre el comprobante). Esta verificación es de los
 * RECORDATORIOS, y su flujo sigue igual si el comprobante no se abre: se destilda —que es una forma
 * legítima de usar la pantalla, y de paso comprueba que destildar devuelve el rótulo de siempre.
 */
const destildarImprimir = async () => {
  await evalx(`(() => {
    const c = document.querySelector('[data-field="imprimir-al-guardar"]');
    if (c && c.checked) c.click();
    return c ? c.checked : null;
  })()`);
  await sleep(500);
};
await irAlUltimoPaso();
// Con la foto marcada, la ficha ya no la pide como pendiente (se mira dentro del detalle)
if (!(await evalx(`!!document.querySelector('[data-ficha-detalle]')`))) {
  await evalx(`(() => { const b = [...document.querySelectorAll('[data-ficha] button')].find(x => /Ver ficha/i.test(x.innerText)); if (b) b.click(); return !!b; })()`);
  await sleep(600);
}
const estadoFotoIn = await evalx(`(() => {
  const it = document.querySelector('[data-ficha-field="photo_in"]');
  return it ? (it.innerText.includes('Tomada') ? 'ok' : it.getAttribute('data-state')) : 'sin-fila';
})()`);
check('F33: con la foto de ENTRADA marcada, la ficha muestra «Tomada»', estadoFotoIn === 'ok', `estado=${estadoFotoIn}`);
await irAlUltimoPaso();
await destildarImprimir();   // F77: sin comprobante encima (esta prueba es de los recordatorios)
const botonGuardar = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Actualizar (Servicio|e imprimir)$/i.test(x.innerText.trim())); return b ? !b.disabled : null; })()`);
check('F32: el wizard llega al paso de guardar con el botón habilitado', botonGuardar === true, `disabled=${botonGuardar === null ? 'no existe' : !botonGuardar}`);
check('F77: destildado el check, el botón vuelve a «Actualizar Servicio» (no miente)',
  (await evalx(`[...document.querySelectorAll('[role="dialog"] button')].some(x => /^Actualizar Servicio$/.test((x.innerText || '').trim()))`)) === true);
await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Actualizar (Servicio|e imprimir)$/i.test(b.innerText.trim())) || null)`).catch(async () => {
  await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Actualizar (Servicio|e imprimir)$/i.test(x.innerText.trim())); if (b) b.click(); return !!b; })()`);
});
await sleep(2500);
dlg = String(await dialogText() ?? '');
if (/Actualizar (Servicio|e imprimir)/i.test(dlg)) { await keyNav('Escape', 'Escape', 27); await sleep(800); }
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
// F49: el botón «Cerrar» de la tarjeta se reemplazó por «Descuento» → el asistente de cierre se abre
// por la cola de entregas (botón «Cerrar entrega»), que es el camino del mostrador.
await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Cerrar entrega'))`);
await sleep(1400);
await clickCenter(`document.querySelector('[role="dialog"] input')`).catch(() => {});
await keyNav('Backspace', 'Backspace', 8);
await insertText(`Recordatorio ${marca}`);
await sleep(1600);
await clickCenter(`([...document.querySelectorAll('[role="dialog"] [role="option"]')].find(o => (o.innerText || '').includes(${JSON.stringify(String(nueva))})) || document.querySelector('[role="dialog"] [role="option"]') || null)`).catch(() => {});
await sleep(1800);
const asistente = String(await dialogText() ?? '');
check('F32: el asistente avisa la foto de salida (informativo, no bloquea)', /Foto de salida pendiente/i.test(asistente), asistente.split('\n')[0]);
await keyNav('Escape', 'Escape', 27);
await sleep(900);
// Se entrega con el botón de la tarjeta (la orden tiene saldo: pide confirmación y NO bloquea)
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Entregar$/.test(b.innerText.trim()))`);
await sleep(1200);
const confirmacion = String(await dialogText() ?? '');
check('F32: entregar con saldo pide confirmación (flujo de siempre)', /saldo pendiente/i.test(confirmacion));
await clickCenter(`[...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find(b => /^Entregar con saldo pendiente$/i.test(b.innerText.trim()))`);
await sleep(3000);
const avisoSalida = await evalx(`(() => { const t = document.querySelector('[data-reminder="photo_out"]'); return t ? t.innerText.replace(/\\s+/g, ' ').slice(0, 120) : null; })()`);
check('F32/F46: al entregar sale el recordatorio de la foto de salida (modal centrado)', !!avisoSalida, String(avisoSalida));
// F46 (pedido del dueño: «que sea centro de la pantalla… estilo modal bloqueante, colores suaves»):
// el aviso es un MODAL centrado con velo detrás — bloquea la pantalla (hay que responderlo) y no
// bloquea el DATO (la orden ya quedó entregada antes de que aparezca).
const centrado = await evalx(`(() => {
  const card = document.querySelector('[data-policy-modal]');
  const velo = document.querySelector('[data-policy-overlay]');
  if (!card || !velo) return JSON.stringify({ hayCard: !!card, hayVelo: !!velo });
  const r = card.getBoundingClientRect();
  const centroCard = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const fondo = getComputedStyle(card).backgroundColor;
  return JSON.stringify({
    hayCard: true,
    hayVelo: true,
    desvioX: Math.round(Math.abs(centroCard.x - window.innerWidth / 2)),
    desvioY: Math.round(Math.abs(centroCard.y - window.innerHeight / 2)),
    role: card.getAttribute('role'),
    ariaModal: card.getAttribute('aria-modal'),
    veloEventos: getComputedStyle(velo).pointerEvents,
    fondo,
    tono: card.getAttribute('data-tone'),
  });
})()`);
const ce = JSON.parse(String(centrado));
check('F46: el aviso está CENTRADO en la pantalla (≤40px de desvío)', ce.desvioX <= 40 && ce.desvioY <= 40, String(centrado));
check('F46: es un modal bloqueante (velo que intercepta clics + role alertdialog aria-modal)',
  ce.hayVelo && ce.veloEventos === 'auto' && ce.role === 'alertdialog' && ce.ariaModal === 'true', String(centrado));
// «Colores suaves»: el fondo NO es el gris del sistema ni un color saturado, es un tinte claro.
const rgbFondo = (String(ce.fondo).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) ?? []).slice(1).map(Number);
check('F46: colores suaves (tinte claro, no saturado ni gris del sistema)',
  rgbFondo.length === 3 ? (Math.min(...rgbFondo) >= 200 && Math.max(...rgbFondo) - Math.min(...rgbFondo) <= 60) : /oklch/.test(String(ce.fondo)),
  `fondo=${ce.fondo}`);
const entregada = await invoke('get_service', { id });
check('F32: la orden quedó Entregado con la fecha de hoy', entregada?.status === 'Entregado' && String(entregada?.date_out ?? '').slice(0, 10) === hoy,
  `estado=${entregada?.status} · salida=${entregada?.date_out}`);
check('F32: la entrega NO se bloqueó por el aviso (foto todavía sin confirmar)', !entregada?.photo_out_at);
// El modal bloquea la pantalla pero NO los datos: posponerlo con «Después» cierra el aviso y deja la
// foto SIN anotar (no se inventa una respuesta que el operario no dio).
await posponerModal();
const trasPosponer = await invoke('get_service', { id });
check('F46: «Después» cierra el aviso sin anotar nada (la foto sigue pendiente)', !trasPosponer?.photo_out_at);
check('F46: después de cerrarlo no queda ningún aviso abierto', (await modalAbierto()) === false);
// Al abrir el comprobante el aviso VUELVE (la política sigue pendiente) y con UN solo aviso (dedupe).
await evalx(`(() => { const p = document.querySelector('[data-panel="entregados-hoy"]'); if (p) p.scrollIntoView({ block: 'center' }); return true; })()`);
await sleep(700);
await clickCenter(`(() => { const f = document.querySelector('[data-delivered-order="${nueva}"]'); return f ? [...f.querySelectorAll('button')].find(b => /Factura/i.test(b.innerText)) : null; })()`);
await sleep(2400);
// OJO: con el modal de política abierto (role="alertdialog"), `dialogText()` devuelve EL MODAL (vive
// dentro del árbol de la pantalla y va antes que el portal de Radix). El comprobante se lee del
// último `[role="dialog"]`, que es el que Radix acaba de abrir.
const comprobanteTxt = String(await evalx(`(() => { const ds = [...document.querySelectorAll('[role="dialog"]')]; const d = ds[ds.length - 1]; return d ? d.innerText : null; })()`) ?? '');
check('F32: el comprobante abre desde el panel de entregados de hoy', /CORTA TIJERA/i.test(comprobanteTxt),
  comprobanteTxt.replace(/\s+/g, ' ').slice(0, 100));
// F54 (2026-09-20, pedido del dueño): «no me deja ver la factura la orden». Ahora el aviso **no se
// dibuja encima de un diálogo**: queda en la cola y sale apenas el comprobante se cierra. Antes el
// velo tapaba la factura y el primer clic lo comía el velo (había que tocar dos veces).
const cuantos = await evalx(`document.querySelectorAll('[data-reminder="photo_out"]').length`);
check('F54: con el comprobante abierto el aviso NO se dibuja encima (la factura se ve entera)',
  cuantos === 0, `avisos dibujados=${cuantos}`);
const clicEnElComprobante = await evalx(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].pop();
  const b = [...(d?.querySelectorAll('button') ?? [])].find(x => /Imprimir|Cerrar/i.test(x.innerText || ''));
  const r = b?.getBoundingClientRect();
  const el = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  if (!el) return null;
  return (el.closest('[data-policy-overlay]') ? 'VELO' : '') + (el.closest('[role="dialog"]') ? 'COMPROBANTE' : 'FUERA');
})()`);
check('F54: el clic sobre el comprobante NO cae en el velo del aviso', clicEnElComprobante === 'COMPROBANTE',
  String(clicEnElComprobante));
await keyNav('Escape', 'Escape', 27);
await sleep(1200);
// …y al cerrarlo el aviso VUELVE (la cola lo conservó) y con UN solo modal para la misma orden.
let volvioElAviso = false;
for (let i = 0; i < 20 && !volvioElAviso; i++) {
  volvioElAviso = (await evalx(`document.querySelectorAll('[data-reminder="photo_out"]').length`)) === 1;
  if (!volvioElAviso) await sleep(400);
}
check('F32/F46: al cerrar el comprobante el aviso vuelve y NO se apila (un solo modal para la misma orden)',
  volvioElAviso, `modales=${await evalx(`document.querySelectorAll('[data-reminder="photo_out"]').length`)}`);// El aviso queda POR DEBAJO de los diálogos de la app (z-40 < z-50): red de seguridad para que nunca
// pueda tapar la factura aunque las dos cosas coincidan en el mismo cuadro.
const zOverlay = await evalx(`(() => {
  const v = document.querySelector('[data-policy-overlay]');
  return v ? Number(getComputedStyle(v).zIndex) : null;
})()`);
check('F46/F54: el aviso queda POR DEBAJO de los diálogos (nunca tapa la factura)',
  zOverlay !== null && zOverlay < 50, `z=${zOverlay} (los diálogos son z-50)`);
// ...y el aviso sigue ahí después del Escape del comprobante: se confirma la foto desde el MODAL
await evalx(`(() => { const c = document.querySelector('[data-policy-modal]'); if (c) c.scrollIntoView({ block: 'center' }); return true; })()`);
await clickCenter(`(() => { const t = document.querySelector('[data-reminder="photo_out"]'); return t ? [...t.querySelectorAll('button')].find(b => /Ya le tomé la foto/i.test(b.innerText)) : null; })()`);
await sleep(2400);
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
    // F48: el color es obligatorio — esta orden también nació por IPC sin color, así que se elige
    // antes de comprobar el botón (el punto de esta sección es el MONTO, no el color).
    check('F48 (preparación): la orden de $0 recibe su color', await elegirColor(), String(await evalx(`document.querySelector('[data-ficha-target="color"]')?.innerText.trim() ?? null`)));
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
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Actualizar (Servicio|e imprimir)$/.test(x.innerText.trim()));
      return b ? JSON.stringify({ texto: b.innerText.trim(), deshabilitado: b.disabled, imprimir: document.querySelector('[data-field="imprimir-al-guardar"]')?.checked ?? null }) : null;
    })()`);
    check('F33: editar una orden de $0 llega al botón «Actualizar Servicio» (el monto no encierra el wizard)',
      !!botonGuardar && JSON.parse(botonGuardar).deshabilitado === false, String(botonGuardar));
    // F77: el check de impresión nace MARCADO también al editar (y por eso el botón dice «Actualizar e
    // imprimir» hasta que se destilda) — el rótulo viejo se recupera al destildar, no es un bloqueo.
    check('F77: en edición el check de imprimir arranca marcado y el botón lo dice',
      !!botonGuardar && JSON.parse(botonGuardar).imprimir === true && /^Actualizar e imprimir$/.test(JSON.parse(botonGuardar).texto),
      String(botonGuardar));
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
// Se despliega la ficha completa (las filas por dato viven dentro de «Ver ficha»).
// OJO: antes se dormía 700 ms a ojo y la corrida fallaba 1 de cada 3 (los 3 chequeos de la ficha
// salían con `abierta:false`: el detalle todavía no estaba dibujado). Se ESPERA la condición.
await clickCenter(`[...document.querySelectorAll('button')].find(b => /Ver ficha/i.test(b.innerText))`).catch(() => {});
for (let i = 0; i < 15; i++) {
  if (await evalx(`!!document.querySelector('[data-ficha-detalle]')`).catch(() => false)) break;
  await sleep(400);
}
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
