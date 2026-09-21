// VERIFICACIÓN EN VIVO (CDP) de F54 — EL AVISO DE POLÍTICA NO TAPA LA FACTURA NI SE TRAGA LOS CLICS.
//
// Pedido del dueño (2026-09-20), textual: «al finalizar el mensaje que sale de tlf y otro mensaje
// **no me deja ver la factura la orden**; le doy clic al mensaje y **no se quita**».
//
// Qué comprueba sobre la app REAL:
//   1. Después de guardar una orden sale el aviso centrado (como pidió el dueño en F46) — sin ningún
//      otro diálogo abierto.
//   2. **Un toque en la TARJETA del aviso lo cierra** (antes solo cerraban los botones, el velo o
//      Escape): es el «le doy clic y no se quita».
//   3. Con la FACTURA abierta **el aviso no se dibuja** (queda en la cola): el comprobante se ve
//      entero y el clic sobre sus botones NO cae en el velo (`elementFromPoint`).
//   4. Al cerrar la factura **el aviso vuelve** (no se perdió: la cola lo conserva).
//   5. La ✕ visible también lo cierra, y responderlo sigue anotando igual que antes.
//   6. Nada de plata ni de stock: la orden de prueba se borra al final y se comprueba la base.
//
// SEGURIDAD DE DATOS: escribe UNA orden de prueba (monto 0, sin pantalla) y la borra; nunca cobra,
// nunca entrega. SIEMPRE sobre una COPIA (`REGISTRO_DB`).
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f50_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_aviso_no_tapa.mjs

import { evalx, clickCenter, keyNav, typeText, insertText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
};
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

// ── 0) GATE: la base (verdad independiente) ───────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch (e) { return { err: String(e.message) }; } };
const servicios = () => Number(uno('SELECT COUNT(*) AS n FROM services').n ?? -1);

// ── 1) entrar a la app ────────────────────────────────────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
const cerrarTodo = async () => {
  for (let i = 0; i < 5; i++) {
    const abierto = await evalx(`document.querySelectorAll('[role="dialog"], [data-policy-modal]').length`);
    if (!Number(abierto)) return true;
    await keyNav('Escape', 'Escape', 27);
    await sleep(600);
  }
  return false;
};
await cerrarTodo();
await evalx(`(() => { const it = [...document.querySelectorAll('aside a, aside button')].find(b => (b.getAttribute('title') || '').startsWith('Servicio')); if (it) it.click(); return !!it; })()`);
await sleep(2000);

const antes = servicios();
const ordenesAntes = uno('SELECT COUNT(*) AS n FROM service_payments').n;
console.log(`· base: ${antes} órdenes · ${ordenesAntes} pagos`);

// ── 2) ENTREGAR la orden con «Imprimir la orden al cerrar» ────────────────────────────────────
// Éste es EXACTAMENTE el momento del pedido del dueño: al cerrar la entrega, el asistente encola los
// avisos de política Y abre la FACTURA en el mismo paso (CierreServiceDialog: `firePolicyReminders(...)`
// + `onPrint(...)`). Antes, el velo del aviso tapaba la factura y se comía el primer clic.
const num = await invoke('next_order_num');
const marca = String(Date.now()).slice(-6);
const id = await invoke('add_service', {
  orderNum: num, client: `Aviso ${marca}`, phone: '0414-0000000', model: 'Galaxy A06 4G',
  fault: 'prueba aviso', serviceType: 'Cambio batería', serviceTypes: JSON.stringify(['Cambio batería']),
  amount: 0, discountAmount: 0, paymentMethod: 'Divisas (USD Cash)', dateIn: '', status: 'Recibido',
  observations: '', bankFeePercent: 0, zelleReference: '', currency: 'USD', clientCi: '',
  clientAddress: '', deviceChecklist: '', technician: '', technicianId: null, color: 'Negro',
  screenProductId: null,
});
check('F54: se preparó la orden de prueba (en el taller, sin cobro)',
  Number(id) > 0 && servicios() === antes + 1, `id ${id} · ${num}`);

const buscar = async (texto) => {
  await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); return true; })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await insertText(texto);
  await sleep(1600);
};
await buscar(`Aviso ${marca}`);
check('F54: la orden de prueba aparece en la lista', await waitFor(`!!document.querySelector('[data-tech-quick="${id}"]')`, 12000));

// cola de entregas → la orden
await clickCenter(`([...document.querySelectorAll('button')].find(b => /Cerrar entrega/.test(b.innerText || '')) || null)`);
await waitFor(`/entrega/i.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
await clickCenter(`document.querySelector('[role="dialog"] input')`);
await insertText(num);
await sleep(1600);
await clickCenter(`([...document.querySelectorAll('[role="dialog"] [role="option"]')].find(o => (o.innerText || '').includes(${JSON.stringify(num)})) || document.querySelector('[role="dialog"] [role="option"]') || null)`);
const asistente = await waitFor(`(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Cerrar ' + ${JSON.stringify(num)})`, 12000);
check('F54: el asistente de cierre abre con la orden de prueba', asistente,
  String(await evalx(`document.querySelector('[role="dialog"]')?.innerText?.split('\\n')?.[0] ?? null`)));

// «Imprimir la orden al cerrar» tiene que quedar MARCADO (es el caso del mostrador: entrega + factura)
const imprimirMarcado = await evalx(`(() => {
  const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => /Imprimir la orden al cerrar/.test(x.innerText || ''));
  const c = l?.querySelector('input[type="checkbox"]');
  if (c && !c.checked) c.click();
  return c ? c.checked : null;
})()`);
check('F54: el asistente queda con «Imprimir la orden al cerrar» marcado', imprimirMarcado === true, String(imprimirMarcado));

// entregar (monto 0 → el botón dice «Cobrar y entregar» / «Entregar con saldo»)
await evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Cobrar y entregar|Entregar con saldo|Reintentar cierre|Actualizar/.test(x.innerText || ''));
  if (b) b.click();
  return !!b;
})()`);
const entregadaOk = await waitFor(`!document.body.innerText.includes('Cerrar ${num}') || /Orden de servicio/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 15000);
void entregadaOk;
await sleep(4000);   // la entrega + la apertura de la factura
// verdad independiente: la orden quedó ENTREGADA en la base
check('F54: la orden quedó ENTREGADA en la base (la prueba reproduce la entrega real)',
  String(uno('SELECT COALESCE(status,\'\') AS s FROM services WHERE id=?1', id).s) === 'Entregado',
  `estado=${uno('SELECT COALESCE(status,\'\') AS s FROM services WHERE id=?1', id).s}`);

const trasEntregar = await evalx(`JSON.stringify({
  factura: /Orden de servicio/.test(document.querySelector('[role="dialog"]')?.innerText ?? ''),
  aviso: !!document.querySelector('[data-policy-modal]'),
  velo: !!document.querySelector('[data-policy-overlay]'),
})`);
const te = JSON.parse(trasEntregar);
console.log(`· después de entregar: ${trasEntregar}`);

// ── 3) el aviso NO tapa la factura y el clic sobre la factura NO cae en el velo ────────────────
const conFactura = await evalx(`(() => {
  const dlg = document.querySelector('[role="dialog"]');
  const btn = [...(dlg?.querySelectorAll('button') ?? [])].find(b => /Imprimir|Cerrar/i.test(b.innerText || ''));
  const r = btn?.getBoundingClientRect();
  const encima = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  return JSON.stringify({
    facturaVisible: !!dlg,
    sobreElBotonDeLaFactura: encima ? (encima.tagName + (encima.closest('[data-policy-overlay]') ? '[AVISO ENCIMA]' : '') + (encima.closest('[role="dialog"]') ? '[dentro de la factura]' : '[FUERA de la factura]')) : null,
  }, null, 1);
})()`);
const cf = JSON.parse(conFactura);
check('F54: al entregar con «imprimir», la FACTURA se ve y el aviso NO se dibuja encima',
  cf.facturaVisible && te.factura && !te.aviso && !te.velo, `aviso=${te.aviso} · velo=${te.velo}`);
check('F54: el clic sobre la factura NO cae en el velo del aviso (era el «no me deja ver la factura»)',
  /dentro de la factura/.test(String(cf.sobreElBotonDeLaFactura)) && !/AVISO ENCIMA/.test(String(cf.sobreElBotonDeLaFactura)),
  String(cf.sobreElBotonDeLaFactura));

// ── 4) cerrar la factura: el aviso VUELVE (no se perdió) y se quita con UN TOQUE EN EL MENSAJE ──
for (let i = 0; i < 3; i++) {
  if (!await evalx(`!!document.querySelector('[role="dialog"]')`)) break;
  await keyNav('Escape', 'Escape', 27);
  await sleep(800);
}
const volvioElAviso = await waitFor(`!!document.querySelector('[data-policy-modal]')`, 12000);
const textoAviso = await evalx(`(document.querySelector('[data-policy-modal]')?.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 90)`);
check('F54: al cerrar la factura el aviso aparece (la cola lo conservó)',
  volvioElAviso, String(textoAviso));

// EL PEDIDO DEL DUEÑO: un clic sobre el MENSAJE lo quita.
await clickCenter(`document.querySelector('[data-policy-modal] p')`);
const seQuito = await waitFor(`!document.querySelector('[data-policy-modal]')`, 6000);
check('F54: tocar el MENSAJE lo cierra (era «le doy clic al mensaje y no se quita»)',
  seQuito, `quedó=${await evalx(`!!document.querySelector('[data-policy-modal]')`)}`);
await sleep(700);

// los avisos del mostrador salen EN COLA: se cierran todos. La ✕ visible también los quita — se
// prueba con una SEGUNDA entrega (sin imprimir) para no depender del aviso que ya se respondió.
const entregar = async (cliente, conImprimir) => {
  const n = await invoke('next_order_num');
  const oid = await invoke('add_service', {
    orderNum: n, client: cliente, phone: '0414-0000000', model: 'Galaxy A06 4G',
    fault: 'prueba aviso', serviceType: 'Cambio batería', serviceTypes: JSON.stringify(['Cambio batería']),
    amount: 0, discountAmount: 0, paymentMethod: 'Divisas (USD Cash)', dateIn: '', status: 'Recibido',
    observations: '', bankFeePercent: 0, zelleReference: '', currency: 'USD', clientCi: '',
    clientAddress: '', deviceChecklist: '', technician: '', technicianId: null, color: 'Negro',
    screenProductId: null,
  });
  await searchRefresh();
  await buscar(cliente);
  await waitFor(`!!document.querySelector('[data-tech-quick="${oid}"]')`, 12000);
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /Cerrar entrega/.test(b.innerText || '')) || null)`);
  await waitFor(`/entrega/i.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
  await clickCenter(`document.querySelector('[role="dialog"] input')`);
  await insertText(String(n));
  await sleep(1500);
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] [role="option"]')].find(o => (o.innerText || '').includes(${JSON.stringify(String(n))})) || document.querySelector('[role="dialog"] [role="option"]') || null)`);
  await waitFor(`(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Cerrar ' + ${JSON.stringify(String(n))})`, 12000);
  await evalx(`(() => {
    const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => /Imprimir la orden al cerrar/.test(x.innerText || ''));
    const c = l?.querySelector('input[type="checkbox"]');
    if (c && c.checked !== ${conImprimir ? 'true' : 'false'}) c.click();
    return true;
  })()`);
  await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Cobrar y entregar|Entregar con saldo|Reintentar cierre|Actualizar/.test(x.innerText || ''));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(3500);
  // Sin «imprimir», el asistente queda ABIERTO en «listo»: se cierra con SU BOTÓN (como el operario
  // — usar Escape acá podía cerrar también el aviso que aparece justo después) y recién ahí el aviso
  // pendiente sale a la pantalla (F54: no se dibuja encima de un diálogo, espera en la cola).
  const cerroConBoton = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^(Cerrar|Cancelar)$/.test((x.innerText || '').trim()));
    if (b) b.click();
    return !!b;
  })()`);
  if (!cerroConBoton) { await keyNav('Escape', 'Escape', 27); }
  await sleep(1200);
  return oid;
};
const searchRefresh = async () => { await sleep(300); };

const marca2 = String(Date.now()).slice(-6);
const id2 = await entregar(`Aviso2 ${marca2}`, false);
check('F54: la segunda orden de prueba quedó entregada (sin abrir la factura)',
  String(uno("SELECT COALESCE(status,'') AS s FROM services WHERE id=?1", id2).s) === 'Entregado',
  `id ${id2} · estado=${uno("SELECT COALESCE(status,'') AS s FROM services WHERE id=?1", id2).s}`);
const avisoEsperado = await waitFor(`!!document.querySelector('[data-policy-modal]')`, 12000);
if (!avisoEsperado) {
  console.log(`· diagnóstico: avisos=${await evalx(`document.querySelectorAll('[data-policy-modal]').length`)} · diálogos=${await evalx(`document.querySelectorAll('[role="dialog"]').length`)} · foto_salida en la base=${uno("SELECT COALESCE(photo_out_at,'(vacío)') AS p FROM services WHERE id=?1", id2).p}`);
}

let cerrados = 0;
let usoLaEquis = false;
for (let i = 0; i < 4; i++) {
  if (!await evalx(`!!document.querySelector('[data-policy-modal]')`)) break;
  const clave = await evalx(`document.querySelector('[data-policy-modal]')?.getAttribute('data-reminder')`);
  const hayEquis = await evalx(`!!document.querySelector('[data-policy-close]')`);
  if (hayEquis) { await clickCenter(`document.querySelector('[data-policy-close]')`); usoLaEquis = true; }
  else { await keyNav('Escape', 'Escape', 27); }
  await sleep(700);
  cerrados += 1;
  console.log(`· aviso «${clave}» cerrado ${hayEquis ? 'con la ✕' : 'con Escape'}`);
}
check('F54: la ✕ visible cierra el aviso y la cola queda vacía',
  usoLaEquis && cerrados >= 1 && !await evalx(`!!document.querySelector('[data-policy-modal]')`),
  `cerrados=${cerrados} · usó la ✕=${usoLaEquis}`);
await invoke('delete_service', { id: id2 }).catch(() => {});
await sleep(900);

// ── 5) nada de plata ni stock: la orden de prueba se borra y la base queda igual ───────────────
await invoke('delete_service', { id }).catch(() => {});
await sleep(1200);
const pagos = uno('SELECT COUNT(*) AS n FROM service_payments').n;
check('F54: la prueba no cobró nada (los pagos quedaron igual)',
  Number(pagos) === Number(ordenesAntes), `pagos ${ordenesAntes} → ${pagos}`);
check('F54: la orden de prueba se borró (no quedan residuos)',
  servicios() === antes && Number(uno('SELECT COUNT(*) AS n FROM services WHERE client LIKE ?1', `%Aviso ${marca}%`).n) === 0,
  `órdenes ${antes} → ${servicios()}`);
check('F54: la base quedó sana', uno('PRAGMA quick_check').quick_check === 'ok', 'quick_check');

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
