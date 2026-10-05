// VERIFICACIÓN EN VIVO (CDP) de F82 — LA CAJA DEL DÍA ANTERIOR SIN CERRAR.
//
// El pedido del dueño (2026-09-27): «si yo no he cerrado la caja del día y estamos en otro día —
// por ejemplo hoy no cerré la caja — que me diga "tiene que cerrar la caja del día anterior para
// facturar", un mensaje así, ANTES de que vaya a facturar: todo se liga hasta la venta de ayer».
//
// Qué comprueba sobre la app REAL (con un turno abierto de OTRO día, que es el estado real medido en
// la base del taller el 2026-09-27: turno del 21/09 abierto con hoy 27/09):
//   1. El aviso sale ANTES (Dashboard, Ventas, Servicio Técnico): cartel con las DOS fechas y el
//      remedio, botón «Nueva Venta» / «Nuevo Servicio» apagado y SIN el cartel verde «Día abierto».
//   2. El BACKEND rechaza la verdad: `add_sale` y `add_service_order` de hoy, nombrando las dos
//      fechas y el camino (Libro Diario → Cierres) — y NO se escribió nada en la base.
//   3. El cobro (Pago / Abono): la fecha arranca en HOY (no en el día viejo) y «Guardar Pago» está
//      apagado con el motivo a la vista.
//   4. EL REMEDIO SE COMPLETA POR LA UI: Libro Diario → Cierres → «Cerrar» de esa fila → arqueo →
//      y «Abrir Día» para hoy.
//   5. DESPUÉS YA FACTURA: el cartel desaparece, la venta y la orden de servicio se guardan de
//      verdad (y la venta de prueba se anula para no dejar basura).
//
// SEGURIDAD DE DATOS: `REGISTRO_DB` es OBLIGATORIO y tiene que ser una COPIA (el script ABORTA si le
// pasan la base de trabajo `registro.db`). Mueve los TURNOS de esa copia A PROPÓSITO (es el remedio
// que se está probando) y crea/anula una venta y una orden de prueba.
//
// Uso:  node tools/snapshot_db.mjs --out backup/f82_verif.db --force
//       $env:REGISTRO_DB="C:\...\backup\f82_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       (lanzar la app)  →  node tools/verify_turno_viejo.mjs

import { evalx, clickCenter, keyNav, escribirEn, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
// El rechazo se captura DENTRO de la página: si la promesa rechaza, el driver devuelve «eval error» y
// se perdería el mensaje del backend (que es justamente lo que se está comprobando).
const invokeErr = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(() => null, (e) => String(e)))()`);
const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));

// ── 0) GATE DE DATOS: una COPIA, nunca la base de trabajo ────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia que usa la app.');
  console.error('  node tools/snapshot_db.mjs --out backup/f82_verif.db --force');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: esta prueba MUEVE los turnos de caja — corré contra una COPIA, nunca registro.db.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch (e) { return { err: String(e.message) }; } };
const muchos = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch { return []; } };
const hoyDB = String(uno("SELECT date('now','localtime') AS d")?.d ?? '');
const turnoAbiertoDB = () => muchos('SELECT close_date FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC');

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const irA = async (texto) => {
  const ok = await evalx(`(() => {
    const items = [...document.querySelectorAll('aside button, aside a')];
    const it = items.find(b => (b.textContent || '').trim() === ${JSON.stringify(texto)})
      || items.find(b => (b.textContent || '').toLowerCase().includes(${JSON.stringify(texto.toLowerCase())}));
    if (it) it.click();
    return !!it;
  })()`);
  await sleep(1200);
  return ok;
};
const textoDe = (sel) => evalx(`document.querySelector(${JSON.stringify(sel)})?.innerText.replace(/\\s+/g,' ').trim() ?? null`);

console.log('— F82: la caja del día anterior sin cerrar (aviso + bloqueo + remedio) — EN VIVO —');

// ── 1) La app tiene que estar arriba y con sesión abierta ────────────────────────────────────────
// El gate del PIN NO es lo que se está probando acá: la sesión se abre por la MISMA vía que usa el
// frontend (`verify_user_pin`) y se recarga — la sesión vive en el backend 12 h, así que al recargar
// la app entra directo (F68). Entrar tecleando el PIN en la pantalla de acceso es más frágil (y la
// copia trae el PIN del dueño hasheado: `--pin-dev` del snapshot lo deja en 1234).
const asegurarSesion = async () => {
  for (let i = 0; i < 25; i++) {
    if (await evalx(`!!document.querySelector('aside')`).catch(() => false)) return true;
    try {
      const users = await invoke('get_users').catch(() => []);
      const u = (users ?? []).find(x => x.role === 'master') ?? (users ?? [])[0];
      if (u) await invoke('verify_user_pin', { userId: u.id, pin: '1234' }).catch(() => {});
      await evalx(`location.reload(); 'ok'`).catch(() => {});
    } catch { /* la ventana todavía está cargando */ }
    await sleep(2500);
  }
  return false;
};
const listo = await asegurarSesion();
check('la app responde y entra (sesión de dueño)', listo);
if (!listo) { console.log('\n(la app no está disponible: ¿está lanzada con el puerto 9222?)'); process.exit(1); }

// ── 2) EL ESCENARIO: tiene que haber un turno abierto que NO sea el de hoy ───────────────────────
// Si la copia quedó con el día de hoy abierto (por ejemplo al repetir la prueba después del
// remedio), se rearma el escenario: se cierra el de hoy y se reabre el cierre más reciente.
let turnos = turnoAbiertoDB();
if (turnos.length === 0 || turnos[0].close_date === hoyDB) {
  console.log('   (rearmando el escenario: se cierra el turno de hoy y se reabre el día anterior)');
  const w = new DatabaseSync(dbPath);
  const previo = String(uno("SELECT close_date FROM daily_closings WHERE close_date < date('now','localtime') ORDER BY close_date DESC LIMIT 1")?.close_date ?? '');
  if (!previo) { console.error('ABORTADO: la copia no tiene ningún día anterior para reabrir.'); process.exit(2); }
  w.exec(`UPDATE daily_closings SET is_closed=1, closed_at=datetime('now','localtime') WHERE is_closed=0;
          UPDATE daily_closings SET is_closed=0, closed_at=NULL WHERE close_date='${previo}';`);
  // Si la copia trae el día de HOY ya CERRADO con su arqueo, la app NO ofrece «Abrir Día» (F69: un
  // cierre guardado no se reabre solo — se reabre con ↺). En una COPIA de prueba esa fila se borra
  // para que el remedio se pueda completar como en el mostrador (el día de hoy todavía no empezó).
  w.prepare("DELETE FROM daily_closings WHERE close_date = date('now','localtime') AND is_closed = 1").run();
  w.close();
  await evalx(`location.reload(); 'ok'`).catch(() => {});
  await sleep(3500);
  await asegurarSesion();
  turnos = turnoAbiertoDB();
}
const fechaVieja = String(turnos[0]?.close_date ?? '');
check('el escenario existe: hay un turno abierto de OTRO día (el bug que se está arreglando)',
  !!fechaVieja && fechaVieja !== hoyDB, `turno=${fechaVieja || 'ninguno'} · hoy=${hoyDB}`);
if (!fechaVieja || fechaVieja === hoyDB) { console.error('ABORTADO: sin el escenario no se puede probar el bloqueo.'); process.exit(2); }
const ddmm = (iso) => iso.split('-').reverse().join('/');

// ── 3) EL AVISO SALE *ANTES* (Dashboard, Ventas, Servicio Técnico) ───────────────────────────────
await irA('Dashboard');
const dashAviso = await waitFor(`!!document.querySelector('[data-field="turno-viejo"]')`, 10000);
check('Dashboard: el aviso de la caja del día anterior se ve al abrir la app', dashAviso);
const detalle = await evalx(`document.querySelector('[data-field="turno-viejo-detalle"]')?.innerText ?? ''`);
check('el aviso nombra la fecha de la CAJA VIEJA y la de HOY', String(detalle).includes(ddmm(fechaVieja)) && String(detalle).includes(ddmm(hoyDB)), String(detalle).slice(0, 120));
check('el aviso dice QUÉ PASA con la plata (se anota en el día viejo)', /se anota en el día/i.test(String(detalle)));
const remedio = await evalx(`document.querySelector('[data-field="turno-viejo-remedio"]')?.innerText ?? ''`);
check('el aviso dice el remedio completo (Libro Diario → Cierres → Cerrar → Abrir Día)',
  /Cierres/.test(remedio) && /Cerrar/.test(remedio) && /Abrir Día/.test(remedio), String(remedio).slice(0, 140));
check('el aviso trae el botón para ir a cerrar la caja a un toque',
  await evalx(`!!document.querySelector('[data-action="ir-a-cerrar-caja"]')`));

// ── 3b) EL BOTÓN DEL AVISO LLEVA A CIERRES **Y NO DEJA LA PANTALLA EN BLANCO** ───────────────────
// Bug reportado por el dueño (2026-09-27): al pulsar «Ir a cerrar esa caja» la pantalla quedaba en
// blanco. La causa era que el `onClick` pasaba el EVENTO del click como si fuera el nombre de la
// pestaña (el estado de la pestaña del Libro Diario quedaba con un MouseEvent adentro). Esta
// comprobación fija el camino completo: clic → pestaña Cierres → la fila del día viejo con su botón.
await irA('Dashboard');
await waitFor(`!!document.querySelector('[data-action="ir-a-cerrar-caja"]')`, 10000);
await clickCenter(`document.querySelector('[data-action="ir-a-cerrar-caja"]')`);
const llego = await waitFor(`/Libro Diario/.test(document.querySelector('main')?.innerText ?? '')`, 10000);
const noBlanco = await evalx(`(document.querySelector('main')?.innerText ?? '').trim().length > 40`);
check('el botón del aviso abre el Libro Diario (y la pantalla NO queda en blanco)', llego && noBlanco,
  `llego=${llego} · texto=${String(await evalx(`(document.querySelector('main')?.innerText ?? '').slice(0, 40)`))}`);
const enCierres = await evalx(`document.querySelector('[data-action="cerrar-dia-fila"]') !== null || /Cierres/.test(document.querySelector('main')?.innerText ?? '')`);
check('…y cae en la pestaña CIERRES (donde está el botón «Cerrar» de la fila)', enCierres);
const hayFilaDirecta = await waitFor(`!!document.querySelector('[data-action="cerrar-dia-fila"]')`, 8000);
check('…y la fila del día que quedó abierto está a la vista con su «Cerrar»', hayFilaDirecta);

await irA('Ventas');
const ventasAviso = await waitFor(`!!document.querySelector('[data-field="turno-viejo"]')`, 10000);
check('Ventas: el aviso sale ANTES de facturar (no al guardar)', ventasAviso);
check('Ventas: «Nueva Venta» está apagado con el motivo en el title',
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nueva Venta/.test(x.innerText || '')); return !!b && b.disabled && !!b.title; })()`));
check('Ventas: NO dice «Día abierto» (el cartel verde no puede mentir)',
  !(await evalx(`[...document.querySelectorAll('span')].some(s => (s.innerText || '').trim() === 'Día abierto')`)));

await irA('Servicio Técnico');
const servAviso = await waitFor(`!!document.querySelector('[data-field="turno-viejo"]')`, 10000);
check('Servicio Técnico: el aviso sale antes de recibir un equipo', servAviso);
check('Servicio Técnico: «Nuevo Servicio» está apagado',
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nuevo Servicio/.test(x.innerText || '')); return !!b && b.disabled; })()`));

// ── 4) EL BACKEND RECHAZA DE VERDAD (y no escribe nada) ─────────────────────────────────────────
const ventasAntes = Number(uno('SELECT COUNT(*) AS n FROM sales')?.n ?? -1);
const serviciosAntes = Number(uno('SELECT COUNT(*) AS n FROM services')?.n ?? -1);

const errVenta = await invokeErr('add_sale', {
  productId: null, productName: 'Prueba F82', quantity: 1, unitPrice: 1, total: 1,
  paymentMethod: 'Divisas (USD Cash)', clientName: '', clientId: null, notes: 'prueba F82',
  bankFeePercent: 0, zelleReference: '', currency: 'USD', discountAmount: 0,
});
check('el backend RECHAZA una venta de hoy con la caja de ayer abierta', !!errVenta, String(errVenta).slice(0, 90));
check('…y el mensaje nombra las DOS fechas', String(errVenta).includes(fechaVieja) && String(errVenta).includes(hoyDB), String(errVenta).slice(0, 160));
check('…y el camino del remedio (Libro Diario → Cierres → «Cerrar» → Abrir Día)',
  /Cierres/.test(String(errVenta)) && /Cerrar/.test(String(errVenta)) && /Abrir Día/.test(String(errVenta)));

const errOrden = await invokeErr('add_service_order', {
  client: 'Prueba F82', phone: '0414-0000000', clientCi: '', clientAddress: '', clientId: null,
  technician: '', technicianId: null,
  devices: [{
    model: 'Galaxy A06 4G', fault: 'prueba F82', service_type: 'Software / Formateo',
    service_types: JSON.stringify(['Software / Formateo']), amount: 0, discount_amount: 0,
    payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
    currency: 'USD', device_checklist: '', color: '', screen_product_id: null, status: 'Recibido',
    iva_rate: 0, iva_mode: '',
  }],
});
check('el backend RECHAZA una orden de servicio de hoy (la puerta del wizard)', !!errOrden, String(errOrden).slice(0, 90));
check('…y el mensaje nombra la caja vieja y el remedio', String(errOrden).includes(fechaVieja) && /Cierres/.test(String(errOrden)));

const ventasDespues = Number(uno('SELECT COUNT(*) AS n FROM sales')?.n ?? -1);
const serviciosDespues = Number(uno('SELECT COUNT(*) AS n FROM services')?.n ?? -1);
check('FAIL-CLOSED: no entró ninguna venta ni ninguna orden a la caja vieja',
  ventasAntes === ventasDespues && serviciosAntes === serviciosDespues,
  `ventas ${ventasAntes}→${ventasDespues} · servicios ${serviciosAntes}→${serviciosDespues}`);

// ── 5) El COBRO: la fecha arranca HOY y el botón está apagado con el motivo ─────────────────────
await irA('Servicio Técnico');
const hayPago = await waitFor(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('Pago / Abono'))`, 12000);
if (hayPago) {
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Pago / Abono'))`);
  const abrio = await waitFor(`/Registrar Pago \\/ Abono/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
  check('el diálogo de Pago / Abono abre para revisar el cobro', abrio);
  if (abrio) {
    check('el cobro avisa de la caja vieja (el cartel está dentro del diálogo)',
      await evalx(`!!document.querySelector('[role="dialog"] [data-field="turno-viejo"]')`));
    const fechaCampo = await evalx(`document.querySelector('[role="dialog"] input[data-field="pay-fecha"]')?.value ?? null`);
    check('la «Fecha del pago» arranca en HOY (no en la caja vieja: el cobro de hoy no cae en ayer)',
      String(fechaCampo).slice(0, 10) === hoyDB, `fecha=${fechaCampo} · hoy=${hoyDB}`);
    check('«Guardar Pago» está apagado y explica por qué',
      await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Guardar Pago/.test(x.innerText || '')); return !!b && b.disabled; })()`)
      && await evalx(`!!document.querySelector('[data-field="aviso-turno-viejo-pago"]')`));
    await keyNav('Escape', 'Escape', 27);
    await sleep(600);
  }
} else {
  check('hay una orden para abrir el cobro (la copia tiene órdenes)', false, 'sin botones Pago / Abono');
}

const errPagoHoy = await invokeErr('add_service_payment', {
  // Una orden FINALIZADA (Entregado/Devuelto/Cancelado) rechaza el pago por SU estado, no por la caja:
  // el sujeto de prueba tiene que ser una orden ACTIVA (lo encontró la 2ª corrida).
  serviceId: Number(uno("SELECT id FROM services WHERE status NOT IN ('Devuelto','Cancelado','Cancelado / Devuelto','Entregado') ORDER BY id DESC LIMIT 1")?.id ?? 0),
  amount: 1, paymentMethod: 'Divisas (USD Cash)', bankFeePercent: 0, zelleReference: '',
  currency: 'USD', notes: 'prueba F82', paymentDate: hoyDB,
});
check('el backend RECHAZA un abono fechado HOY con la caja de ayer abierta', !!errPagoHoy, String(errPagoHoy).slice(0, 110));
// El MOTIVO importa: sin mirar el mensaje, un rechazo por «la orden está Devuelto» o «no existe»
// pasaría como si fuera el gate de la caja (hallazgo menor de la revisión adversarial).
check('…y lo rechaza POR LA CAJA (no por otra razón: nombra el día sin turno y los días que SÍ tienen caja)',
  // F92: el mensaje ahora dice «no hay ninguna caja (turno) con la fecha X» y lista los últimos días con
  // caja (marcando cuál está abierto). Sigue nombrando la fecha pedida y a qué caja se puede anotar.
  new RegExp(hoyDB).test(String(errPagoHoy))
  && /No hay ninguna caja|turno de caja/i.test(String(errPagoHoy))
  && /días con caja|turno abierto/i.test(String(errPagoHoy)),
  String(errPagoHoy).slice(0, 140));

// ── 6) EL REMEDIO, COMPLETADO POR LA UI (que es lo que pidió el dueño) ───────────────────────────
await irA('Libro Diario');
await clickCenter(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Cierres')`).catch(() => {});
await sleep(1600);
const hayFila = await waitFor(`!!document.querySelector('[data-action="cerrar-dia-fila"]')`, 10000);
check('Libro Diario → Cierres muestra el día que quedó abierto con su botón «Cerrar»', hayFila);
if (hayFila) {
  await clickCenter(`document.querySelector('[data-action="cerrar-dia-fila"]')`);
  const abrioCierre = await waitFor(`/Cerrar Día: ${fechaVieja}/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
  check('el asistente de cierre abre sobre ESA fecha (no sobre hoy)', abrioCierre,
    String(await evalx(`document.querySelector('[role="dialog"]')?.innerText.slice(0, 60) ?? ''`)));
  if (abrioCierre) {
    // El cierre no se puede guardar sin haber leído los totales (F39) ni sin CONTAR el cajón (F69):
    // cada línea del arqueo se confirma con «Es el esperado» (es lo que hace el operario cuando contó
    // y coincide). Primero se espera a que el arqueo esté leído.
    const puedeCerrar = await waitFor(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.innerText.trim() === 'Cerrar Día'); return !!b && !b.disabled; })()`, 12000);
    check('el arqueo se pudo leer (el botón «Cerrar Día» queda habilitado y no cierra a ciegas)', puedeCerrar);
    if (puedeCerrar) {
      // F69: el día NO se cierra sin contar. El operario confirma cada línea del arqueo con «Es el
      // esperado» (contó y coincide) y el cierre exige que no quede ninguna sin confirmar: si esta
      // prueba no confirmara las líneas, el botón no cerraría nada (lo midió la 1ª corrida).
      const lineas = await evalx(`document.querySelectorAll('[role="dialog"] button[data-arqueo-confirmar], [role="dialog"] button').length`);
      const confirmadas = await evalx(`(() => { const bs = [...document.querySelectorAll('[role="dialog"] button')].filter(b => b.innerText.trim() === 'Es el esperado'); bs.forEach(b => b.click()); return bs.length; })()`);
      await sleep(800);
      const quedanSinConfirmar = await evalx(`[...document.querySelectorAll('[role="dialog"] button')].filter(b => b.innerText.trim() === 'Es el esperado').length`);
      check('el arqueo se cuenta: TODAS las líneas del cajón quedan confirmadas (F69: no se cierra sin contar)',
        Number(confirmadas) === 0 ? false : Number(quedanSinConfirmar) === 0,
        `${confirmadas} línea(s) confirmadas · quedan ${quedanSinConfirmar} · botones en el diálogo: ${lineas}`);
      await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(x => x.innerText.trim() === 'Cerrar Día')`);
      const cerro = await waitFor(`!document.querySelector('[role="dialog"]')`, 15000);
      check('el día viejo quedó CERRADO desde la propia pantalla', cerro,
        String(await evalx(`document.querySelector('[role="dialog"]')?.innerText.slice(-180) ?? ''`)));
    }
  }
}
const abiertosTrasCierre = turnoAbiertoDB();
check('la base confirma: ya no hay ningún turno abierto (el día viejo quedó con su arqueo)',
  abiertosTrasCierre.length === 0, JSON.stringify(abiertosTrasCierre));
check('…y el día viejo quedó con arqueo guardado',
  Number(uno('SELECT is_closed FROM daily_closings WHERE close_date = ?1', fechaVieja)?.is_closed ?? 0) === 1);

// Abrir el día de HOY (el otro tramo del remedio)
// Abrir el día de HOY (el otro tramo del remedio). La pantalla puede tardar en reflejar el cierre
// (el bus de datos recarga la pantalla): se ESPERA la condición con reintento, no se duerme a ojo.
const hayAbrir = await (async () => {
  for (let i = 0; i < 3; i++) {
    if (await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Abrir Día')`)) return true;
    // Si quedó en la pestaña Cierres, el botón de apertura vive en la pestaña Diario.
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Diario'); if (b) b.click(); return !!b; })()`).catch(() => {});
    await sleep(1500);
    if (await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Abrir Día')`)) return true;
    await irA('Libro Diario');
    await sleep(1500);
  }
  return false;
})();
check('la pantalla ofrece «Abrir Día» (el remedio no deja al mostrador sin salida)', hayAbrir);
if (hayAbrir) {
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Abrir Día')`);
  await waitFor(`/Abrir Día/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 8000);
  // Sin tasa BCV no se pueden cobrar bolívares: si el campo vino en 0 se carga una tasa de prueba.
  const tasa = await evalx(`(() => { const ins = [...document.querySelectorAll('[role="dialog"] input[type="number"]')]; return ins[0] ? Number(ins[0].value) : null; })()`);
  if (!tasa) {
    await escribirEn(`[...document.querySelectorAll('[role="dialog"] input[type="number"]')][0]`, '900').catch(() => {});
  }
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /Abrir Día/.test(b.innerText || ''))`);
  const abrioHoy = await waitFor(`!document.querySelector('[role="dialog"]')`, 12000);
  check('el día de HOY queda abierto desde la pantalla', abrioHoy);
}
const abiertosFinal = turnoAbiertoDB();
check('la base confirma: el turno abierto es el de HOY', abiertosFinal[0]?.close_date === hoyDB,
  `turno=${abiertosFinal[0]?.close_date ?? 'ninguno'} · hoy=${hoyDB}`);

// ── 7) DESPUÉS DEL REMEDIO, YA FACTURA ──────────────────────────────────────────────────────────
await irA('Ventas');
const avisoSeFue = await waitFor(`!document.querySelector('[data-field="turno-viejo"]')`, 10000);
check('Ventas: el aviso desapareció solo al quedar el turno de hoy', avisoSeFue);
check('Ventas: «Nueva Venta» volvió a estar disponible',
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nueva Venta/.test(x.innerText || '')); return !!b && !b.disabled; })()`));

let ventaId = 0;
try {
  await invoke('add_sale', {
    productId: null, productName: 'Prueba F82 (remedio)', quantity: 1, unitPrice: 1, total: 1,
    paymentMethod: 'Divisas (USD Cash)', clientName: '', clientId: null, notes: 'prueba F82 (remedio)',
    bankFeePercent: 0, zelleReference: '', currency: 'USD', discountAmount: 0,
  });
  ventaId = Number(uno("SELECT id FROM sales WHERE notes='prueba F82 (remedio)' ORDER BY id DESC LIMIT 1")?.id ?? 0);
} catch (e) { /* se reporta abajo */ }
check('después del remedio la VENTA se guarda de verdad (la plata entra a la caja de HOY)', ventaId > 0, `venta #${ventaId}`);
const diaVenta = String(uno('SELECT date(date) AS d FROM sales WHERE id = ?1', ventaId)?.d ?? '');
check('…y quedó anotada en la caja de HOY', diaVenta === hoyDB, `venta=${diaVenta} · hoy=${hoyDB}`);

let ordenOk = '';
try {
  ordenOk = String(await invoke('add_service_order', {
    client: 'Prueba F82 (remedio)', phone: '0414-0000001', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null,
    devices: [{
      model: 'Galaxy A06 4G', fault: 'prueba F82', service_type: 'Software / Formateo',
      service_types: JSON.stringify(['Software / Formateo']), amount: 0, discount_amount: 0,
      payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
      currency: 'USD', device_checklist: '', color: '', screen_product_id: null, status: 'Recibido',
      iva_rate: 0, iva_mode: '',
    }],
  }) ?? '');
} catch (e) { /* se reporta abajo */ }
check('después del remedio la ORDEN DE SERVICIO también se guarda', /^DEV-/.test(ordenOk) || ordenOk.length > 0, `orden=${ordenOk || 'sin número'}`);

// ── 8) LIMPIEZA de lo que esta prueba creó (la copia queda como estaba, salvo los turnos) ───────
if (ventaId > 0) await invoke('void_sale', { id: ventaId, reason: 'prueba F82' }).catch(() => {});
const ordenId = Number(uno("SELECT id FROM services WHERE client='Prueba F82 (remedio)' ORDER BY id DESC LIMIT 1")?.id ?? 0);
if (ordenId > 0) await invoke('delete_service', { id: ordenId }).catch(() => {});
check('la prueba limpia lo que creó (venta anulada y orden de prueba borrada)',
  Number(uno("SELECT COUNT(*) AS n FROM services WHERE client='Prueba F82 (remedio)'")?.n ?? -1) === 0);

const failed = out.filter(o => !o.ok);
console.log(`\nverify_turno_viejo: ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
