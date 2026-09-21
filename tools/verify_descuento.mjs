// VERIFICACIÓN EN VIVO (CDP) de F49 — Botón «Descuento» en la tarjeta + el descuento en la FACTURA.
//
// Pedido del dueño (2026-09-20): «el cliente me pide que quite el botón de cerrar que sale en la card
// de servicios, y lo cambie por un botón de descuento para hacerle en ese servicio, y que se refleje
// en la factura que se le aplicó un descuento de X monto».
//
// Qué comprueba sobre la app REAL:
//   1. La tarjeta ya **NO** tiene «Cerrar» y **SÍ** tiene «Descuento».
//   2. El diálogo de descuento abre con el descuento ACTUAL de la orden y muestra el precio de lista,
//      el descuento y el total en vivo.
//   3. Aplicar un descuento guarda `discount_amount` y deja `amount` = precio − descuento (se verifica
//      contra la BASE por IPC, no contra la pantalla).
//   4. La tarjeta lo refleja con el chip del descuento y el monto nuevo.
//   5. **La factura imprime PRECIO, DESCUENTO y TOTAL** con los montos exactos (se abre el comprobante
//      en pantalla, que es el mismo builder que imprime la impresora térmica).
//   6. Quitar el descuento devuelve el total al precio de lista.
//
// SEGURIDAD DE DATOS: escribe de verdad, así que `REGISTRO_DB` es OBLIGATORIO (aborta si falta); la
// orden de prueba se crea con monto $30 y **se borra al final** (no mueve caja: no hay pagos).
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f49_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       (lanzar la app)  →  node tools/verify_descuento.mjs

import { evalx, clickCenter, keyNav, insertText, sleep } from './cdp_driver.mjs';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const dialogTxt = () => evalx(`(document.querySelector('[role="dialog"]')?.innerText) ?? null`);
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};

// ── 0) GATE DE DATOS ────────────────────────────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]'); i.focus(); i.select(); return true; })()`);
  for (const ch of '1234') {
    await evalx(`(() => {
      const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]');
      if (!i) return false;
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(i, i.value + '${ch}');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await sleep(500);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

const dia = await invoke('get_active_day').catch(() => null);
if (!dia) { console.log('ABORTADO: la copia no tiene día abierto (esta prueba NO abre el turno del local).'); process.exit(2); }
console.log(`· copia: ${dbPath} · día abierto (${dia.close_date ?? 'hoy'})`);

const marca = String(Date.now()).slice(-6);
const PREFIJO = `Prueba Descuento ${marca}`;
let id = null;
try {
  const num = await invoke('add_service_order', {
    client: PREFIJO, phone: '', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null,
    devices: [{
      model: 'Galaxy A06 4G', color: 'Negro', fault: `prueba F49 ${marca}`, service_type: 'Software / Formateo',
      service_types: JSON.stringify(['Software / Formateo']), amount: 30, discount_amount: 0,
      payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
      currency: 'USD', device_checklist: '', screen_product_id: null, status: 'Recibido',
    }],
  });
  const filas = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
  id = (filas ?? []).find(r => (r.order_num ?? '') === num)?.id ?? null;
  check('se preparó la orden de prueba (precio $30, sin descuento)', !!id, `orden ${num} · id ${id}`);
  if (!id) throw new Error('no se creó la orden de prueba');

  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
  await sleep(1800);
  await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); return true; })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await insertText(marca);
  await waitFor(`!!document.querySelector('[data-tech-quick="${id}"]')`, 12000);
  await sleep(600);

  // ── 1) la tarjeta: sin «Cerrar», con «Descuento» ──────────────────────────────────────────
  const botones = await evalx(`JSON.stringify({
    descuento: [...document.querySelectorAll('main button')].some(b => (b.innerText || '').trim() === 'Descuento'),
    cerrar: [...document.querySelectorAll('main button')].some(b => (b.innerText || '').trim() === 'Cerrar'),
    cerrarEntrega: [...document.querySelectorAll('main button')].some(b => (b.innerText || '').includes('Cerrar entrega')),
  })`);
  const bt = JSON.parse(botones);
  check('F49: la tarjeta ofrece el botón «Descuento»', bt.descuento === true, botones);
  check('F49: la tarjeta ya NO ofrece «Cerrar»', bt.cerrar === false, botones);
  check('F49: el asistente de cierre sigue disponible («Cerrar entrega» en la barra)', bt.cerrarEntrega === true, botones);

  // ── 2) el diálogo de descuento ────────────────────────────────────────────────────────────
  await clickCenter(`document.querySelector('[data-discount="${id}"]')`);
  const abrio = await waitFor(`!!document.querySelector('[data-discount-dialog]')`, 8000);
  check('F49: el botón abre el diálogo de descuento', abrio, String(await dialogTxt()).split('\n')[0]);
  const inicial = await evalx(`JSON.stringify({
    monto: document.querySelector('[data-field="descuento-monto"]')?.value ?? null,
    descuento: document.querySelector('[data-field="descuento"]')?.innerText.trim() ?? null,
    total: document.querySelector('[data-field="total-descuento"]')?.innerText.trim() ?? null,
  })`);
  const ini = JSON.parse(inicial);
  check('F49: el diálogo abre con el descuento ACTUAL (0) y el precio como total',
    Number(ini.monto) === 0 && /\$30\.00|30\.00/.test(String(ini.total)), inicial);

  // aplicar $5 (chip rápido) y comprobar el resumen en vivo
  await clickCenter(`([...document.querySelectorAll('[data-discount-dialog] button')].find(b => (b.innerText || '').trim() === '$5') || null)`);
  await sleep(600);
  const tras5 = await evalx(`JSON.stringify({
    descuento: document.querySelector('[data-field="descuento"]')?.innerText.trim() ?? null,
    total: document.querySelector('[data-field="total-descuento"]')?.innerText.trim() ?? null,
  })`);
  const t5 = JSON.parse(tras5);
  check('F49: el resumen dice DESCUENTO $5.00 y TOTAL $25.00 en vivo',
    /5\.00/.test(String(t5.descuento)) && /25\.00/.test(String(t5.total)), tras5);

  await clickCenter(`([...document.querySelectorAll('[data-discount-dialog] button')].find(b => /^Aplicar descuento$/.test((b.innerText || '').trim())) || null)`);
  await sleep(2200);
  const guardada = await invoke('get_service', { id });
  check('F49: el descuento queda GUARDADO en la orden (amount 25 · descuento 5)',
    Math.abs(Number(guardada?.amount) - 25) < 0.005 && Math.abs(Number(guardada?.discount_amount) - 5) < 0.005,
    `amount=${guardada?.amount} · discount_amount=${guardada?.discount_amount} · abonado=${guardada?.paid_amount}`);

  // ── 3) la tarjeta lo refleja ──────────────────────────────────────────────────────────────
  await sleep(800);
  const tarjeta = await evalx(`(() => {
    const card = document.querySelector('[data-tech-quick="${id}"]')?.closest('.overflow-hidden') ?? document.body;
    return (card.innerText || '').replace(/\\s+/g, ' ');
  })()`);
  check('F49: la tarjeta muestra el chip del descuento y el total nuevo',
    /Descuento \$5\.00/.test(String(tarjeta)) && /\$25\.00/.test(String(tarjeta)), String(tarjeta).slice(0, 160));

  // ── 4) LA FACTURA: PRECIO / DESCUENTO / TOTAL ─────────────────────────────────────────────
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^(Orden|Reimprimir)$/.test(b.innerText.trim())) || null)`);
  const recibo = await waitFor(`/CORTA TIJERA/i.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 12000);
  const txt = String(await dialogTxt() ?? '');
  check('F49: el comprobante abre', recibo, txt.split('\n')[0]);
  const lineaPrecio = (txt.match(/PRECIO[^\n]*/) ?? [''])[0];
  const lineaDesc = (txt.match(/DESCUENTO[^\n]*/) ?? [''])[0];
  const lineaTotal = (txt.match(/TOTAL[^\n]*/) ?? [''])[0];
  check('F49: la factura imprime el PRECIO de lista ($30)', /30\.00/.test(lineaPrecio), lineaPrecio);
  check('F49: la factura imprime el DESCUENTO aplicado ($5, en negativo)', /-\s*\$?\s*5\.00/.test(lineaDesc), lineaDesc);
  check('F49: la factura imprime el TOTAL que paga el cliente ($25)', /\$?\s*25\.00/.test(lineaTotal), lineaTotal);
  await keyNav('Escape', 'Escape', 27);
  await sleep(800);
  // F46: al abrir el comprobante puede salir el MODAL de política (acá: preguntar el pago, porque la
  // orden no tiene pagos). Bloquea la pantalla hasta responderlo o posponerlo → se pospone.
  for (let i = 0; i < 3; i++) {
    if (!(await evalx(`!!document.querySelector('[data-policy-modal]')`))) break;
    await clickCenter(`document.querySelector('[data-policy-later]')`).catch(async () => {
      await evalx(`(() => { const b = document.querySelector('[data-policy-later]'); if (b) b.click(); return !!b; })()`);
    });
    await sleep(700);
  }

  // ── 5) quitar el descuento devuelve el precio de lista ────────────────────────────────────
  await clickCenter(`document.querySelector('[data-discount="${id}"]')`);
  await waitFor(`!!document.querySelector('[data-discount-dialog]')`, 8000);
  await clickCenter(`([...document.querySelectorAll('[data-discount-dialog] button')].find(b => /Sin descuento/i.test(b.innerText)) || null)`);
  await sleep(600);
  await clickCenter(`([...document.querySelectorAll('[data-discount-dialog] button')].find(b => /^Aplicar descuento$/.test((b.innerText || '').trim())) || null)`);
  await sleep(2200);
  const sinDesc = await invoke('get_service', { id });
  check('F49: quitar el descuento devuelve el total al precio de lista ($30)',
    Math.abs(Number(sinDesc?.amount) - 30) < 0.005 && Math.abs(Number(sinDesc?.discount_amount)) < 0.005,
    `amount=${sinDesc?.amount} · discount_amount=${sinDesc?.discount_amount}`);
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}

// ── 6) LIMPIEZA ─────────────────────────────────────────────────────────────────────────────
if (id) await invoke('delete_service', { id }).catch(e => check(`borrar la orden ${id}`, false, String(e)));
for (let i = 0; i < 3; i++) {
  const sobran = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
  if (!Array.isArray(sobran) || sobran.length === 0) break;
  for (const r of sobran) await invoke('delete_service', { id: r.id }).catch(() => {});
}
const restos = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => null);
check('las órdenes de prueba quedaron borradas (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
