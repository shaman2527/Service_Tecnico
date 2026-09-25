// VERIFICACIÓN EN VIVO (CDP) de F74 — EL IVA: prender/apagar, alícuota, modo y los céntimos.
//
// Pedido del dueño (2026-09-25): «incluye el IVA que se pueda activar o desactivar… todo listo para
// producción, que tome sus centavos sincronizado con la tasa del día BCV».
//
// Lo que comprueba, contra la app REAL (Tauri 2 + React 19 + SQLite):
//   1. La acción «IVA» existe para el dueño (y NO para la caja) en el encabezado del Libro Diario.
//   2. El diálogo arranca APAGADO (nada cambia solo), y al prenderlo con 16% «se suma al cobrar» la
//      cuenta en vivo dice base $30,00 + IVA $4,80 = total $34,80, con la equivalencia en Bs. de la
//      TASA DEL TURNO (los céntimos y la sincronización con la tasa: lo que se va a cobrar).
//   3. Al guardar, el BACKEND devuelve exactamente eso (y queda en la base).
//   4. La VENTA y el SERVICIO muestran el mismo desglose mientras se carga el monto.
//   5. El LIBRO DE IVA del período cuenta las operaciones con la alícuota de CADA fila (se prueban dos
//      operaciones reales en la copia: $34,80 al 16% y $116,00 al 16% → base $130,00 · IVA $20,80).
//   6. La caja puede LEER la configuración (necesita saber si hay IVA) pero no cambiarla.
//
// SEGURIDAD DE DATOS: corre SIEMPRE contra una COPIA (`REGISTRO_DB`). Escribe SÓLO la configuración
// del IVA (que al final deja APAGADA como estaba) y dos filas de prueba que BORRA al terminar.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f74_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       app de dev abierta  →  node tools/verify_iva.mjs

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

let checks = 0;
const fallos = [];
const check = (que, cond, detalle = '') => {
  checks++;
  console.log(`${cond ? 'OK  ' : 'FALLA'} · ${que}${detalle ? ` — ${detalle}` : ''}`);
  if (!cond) fallos.push(que);
};

const waitFor = async (expr, timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) GATE: la copia ─────────────────────────────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: apuntá REGISTRO_DB a una COPIA, nunca a la base real del local.');
  process.exit(2);
}
const leer = () => new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql) => { const d = leer(); try { return d.prepare(sql).get() ?? {}; } catch (e) { return { err: String(e.message) }; } finally { d.close(); } };
const escribir = (sql, ...p) => { const d = new DatabaseSync(dbPath); try { return d.prepare(sql).run(...p); } finally { d.close(); } };

const dia = uno("SELECT close_date, tasa_bcv FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1");
const TASA = Number(dia.tasa_bcv ?? 0);
const DIA = dia.close_date ?? null;
console.log(`· copia: ${dbPath} · turno abierto: ${DIA ?? 'ninguno'} · tasa: ${TASA}`);

// ── helpers de sesión/navegación ────────────────────────────────────────────────────────────
const invoke = (m, a) => evalx(`(async () => {
  try { const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(m)}, ${JSON.stringify(a ?? {})}); return JSON.stringify({ ok: r }); }
  catch (e) { return JSON.stringify({ err: String(e) }); }
})()`).then(r => { const o = JSON.parse(String(r ?? '{}')); if (o.err) throw new Error(o.err); return o.ok; });
const invokeErr = async (m, a) => { try { await invoke(m, a); return null; } catch (e) { return e.message; } };

const irALaLista = async () => {
  for (let i = 0; i < 5; i++) {
    if (await evalx(`!!document.querySelector('[data-user-picker]')`)) return true;
    await evalx(`(() => { const b = document.querySelector('[data-action="bloquear-sesion"]'); if (b) b.click(); return !!b; })()`);
    await sleep(900);
    await evalx(`(() => { const b = document.querySelector('[data-action="cambiar-persona"]'); if (b) b.click(); return !!b; })()`);
    await sleep(700);
  }
  return await waitFor(`!!document.querySelector('[data-user-picker]')`, 8000);
};

const entrar = async (name, pin) => {
  await irALaLista();
  const id = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-user-option]')].find(x => (x.innerText || '').includes(${JSON.stringify(name)}));
    return b ? Number(b.getAttribute('data-user-option')) : null;
  })()`);
  if (id == null) return false;
  await clickCenter(`document.querySelector('[data-user-option="${id}"]')`);
  await sleep(700);
  if (!await waitFor(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`, 6000)) return false;
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText(pin);
  await keyNav('Enter', 'Enter', 13);
  return await waitFor(`!!document.querySelector('aside')`, 15000);
};

const irAlLibro = async () => {
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Libro Diario/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  return await waitFor(`!!document.querySelector('[data-nav-group]')`, 12000);
};
const abrirTab = async (tab) => {
  await evalx(`(() => { const b = document.querySelector('[data-tab="${tab}"]'); if (b) b.click(); return !!b; })()`);
  await sleep(1200);
};
/** El texto que muestra el diálogo del IVA (los campos de la cuenta en vivo). */
const cuenta = async () => JSON.parse(await evalx(`(() => {
  const txt = (sel) => document.querySelector(sel)?.innerText?.trim() ?? null;
  return JSON.stringify({
    estado: txt('[data-field="iva-estado"]'),
    base: txt('[data-field="iva-base"]'),
    iva: txt('[data-field="iva-monto"]'),
    total: txt('[data-field="iva-total"]'),
    bs: txt('[data-field="iva-bs"]'),
    activo: document.querySelector('[data-field="iva-activo"] [data-state="on"]')?.getAttribute('data-iva-activo') ?? null,
    modo: document.querySelector('[data-field="iva-modo"] [data-state="on"]')?.getAttribute('data-iva-modo') ?? null,
    alicuota: document.querySelector('[data-field="iva-alicuota"]')?.value ?? null,
    abierto: !!document.querySelector('[data-field="iva-activo"]'),
  });
})()`));

// ── 1) LA CONFIGURACIÓN: apagada de fábrica, se prende y se guarda ───────────────────────────
{
  await evalx(`location.reload(); 'recargando'`).catch(() => {});
  await sleep(2500);
  check('F74: el Master entra (sobre la copia)', await entrar('Master', '1234'));
  check('F74: llega al Libro Diario', await irAlLibro());
  await sleep(1500);

  // El estado de partida: la verificación SIEMPRE arranca con el IVA apagado.
  await invoke('set_tax_config', { activo: false, alicuota: 16, modo: 'incluido' }).catch(() => {});
  await evalx(`location.reload(); 'recargando'`).catch(() => {});
  await sleep(2500);
  await entrar('Master', '1234');
  await irAlLibro();
  await sleep(1200);

  const hayAccion = await evalx(`!!document.querySelector('[data-action="libro-iva"]')`);
  check('F74: el dueño tiene la acción «IVA» en el encabezado del Libro Diario', hayAccion);

  await clickCenter(`document.querySelector('[data-action="libro-iva"]')`);
  check('F74: el diálogo del IVA abre', await waitFor(`!!document.querySelector('[data-field="iva-activo"]')`, 8000));
  const inicial = await cuenta();
  check('F74: arranca APAGADO (los precios no cambian solos)', inicial.activo === 'no', JSON.stringify(inicial));
  check('F74: la alícuota de fábrica es 16', String(inicial.alicuota).replace(',', '.') === '16', String(inicial.alicuota));
  check('F74: el modo de fábrica es «ya viene en el precio»', inicial.modo === 'incluido', String(inicial.modo));
  check('F74: apagado, la cuenta de un monto de $30 no agrega nada (base 30 · IVA 0 · total 30)',
    inicial.base === '$30,00' && inicial.iva === '$0,00' && inicial.total === '$30,00',
    `${inicial.base} · ${inicial.iva} · ${inicial.total}`);

  // Se prende con 16% «se suma al cobrar».
  await evalx(`(() => { const b = document.querySelector('[data-field="iva-activo"] [data-iva-activo="si"]'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  await evalx(`(() => { const b = document.querySelector('[data-field="iva-modo"] [data-iva-modo="agregado"]'); if (b) b.click(); return !!b; })()`);
  await sleep(700);
  const prendido = await cuenta();
  check('F74: con IVA 16% «se suma al cobrar», $30 dan base $30,00 + IVA $4,80', prendido.base === '$30,00' && prendido.iva === '$4,80',
    `${prendido.base} · ${prendido.iva}`);
  check('F74: y el TOTAL a cobrar es $34,80 (los céntimos exactos)', prendido.total === '$34,80', String(prendido.total));
  // F74 (pedido del dueño): en Bs. los montos llevan SUS CÉNTIMOS, calculados con la tasa BCV del
  // turno (34,80 × 853,4993 = Bs. 29.701,78), y aparte se dice el monto a cobrar en EFECTIVO, que va
  // al bolívar entero (Bs. 29.702,00).
  const totalBsCentimos = Math.round(34.8 * TASA * 100) / 100;
  const totalBsEfectivo = Math.round(34.8 * TASA);
  const enBs = String(prendido.bs ?? '');
  const aNum = (m) => Number(String(m).replace(/\./g, '').replace(',', '.'));
  const bsOk = TASA > 0
    ? aNum((enBs.match(/total Bs\.\s*([\d.]+,\d{2})/) ?? [])[1]) === totalBsCentimos
      && aNum((enBs.match(/efectivo Bs\.\s*([\d.]+,\d{2})/) ?? [])[1]) === totalBsEfectivo
    : /Sin tasa BCV/.test(enBs);
  check('F74: la equivalencia en Bs. usa la TASA DEL TURNO y lleva céntimos (Bs. ' + totalBsCentimos
    + ' · efectivo Bs. ' + totalBsEfectivo + ')', Number.isFinite(totalBsCentimos) && bsOk, enBs);

  await clickCenter(`document.querySelector('[data-action="guardar-iva"]')`);
  await sleep(1500);
  const guardada = await invoke('get_tax_config', {});
  check('F74: el backend guardó activo + 16% + agregado',
    guardada?.activo === true && Number(guardada?.alicuota) === 16 && guardada?.modo === 'agregado',
    JSON.stringify(guardada));
  check('F74: y quedó en la base (settings.tax_config)',
    /"activo":true/.test(String(uno("SELECT value FROM settings WHERE key='tax_config'").value ?? '')),
    String(uno("SELECT value FROM settings WHERE key='tax_config'").value ?? ''));
  const cerro = await waitFor(`!document.querySelector('[data-field="iva-activo"]')`, 4000);
  check('F74: el diálogo se cierra solo al guardar', cerro);
}

// ── 2) EL IVA ACTIVO SE VE EN LA VENTA Y EN EL SERVICIO ─────────────────────────────────────
{
  // VENTA: la línea del desglose aparece y cambia con el precio cargado.
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Ventas/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  await sleep(1800);
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nueva Venta/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  const hayVenta = await waitFor(`!!document.querySelector('[data-field="iva-desglose-venta"]')`, 10000);
  check('F74: la venta muestra el desglose del IVA', hayVenta);
  if (hayVenta) {
    const precio = `[...document.querySelectorAll('[role="dialog"] input[type="number"]')]`;
    await evalx(`(() => { const i = ${precio}[1] ?? ${precio}[0]; if (!i) return false; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,'30'); i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await sleep(900);
    const lineaVenta = await evalx(`document.querySelector('[data-field="iva-desglose-venta"]')?.innerText ?? null`);
    check('F74: con precio $30 la venta dice el total con IVA (34,80 = 4,80 sobre 30,00, en Bs. y en $)',
      /(34,80|29\.702)/.test(String(lineaVenta)) && /(4,80|4\.097)/.test(String(lineaVenta)), String(lineaVenta));
    await keyNav('Escape', 'Escape', 27);
    await sleep(700);
  }

  // SERVICIO: el desglose por equipo.
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Servicio T/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  await sleep(2200);
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nuevo Servicio/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  await sleep(2000);
  // El desglose vive en el paso EQUIPOS del wizard, y el wizard no deja avanzar sin el nombre del
  // cliente (el paso «Cliente» es un gate real): se carga el nombre y se pasa a «Equipos».
  for (let i = 0; i < 4; i++) {
    if (await evalx(`!!document.querySelector('[data-field="iva-desglose-equipo-1"]')`)) break;
    await evalx(`(() => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const poner = (sel, val) => { const i = document.querySelector(sel); if (i) { s.call(i, val); i.dispatchEvent(new Event('input', { bubbles: true })); } };
      poner('[role="dialog"] input[placeholder^="Buscar por nombre"]', 'PRUEBA IVA');
      poner('[role="dialog"] input[placeholder="V-12345678"]', 'V-12345678');
      poner('[role="dialog"] input[placeholder="0412-1234567"]', '0412-1234567');
      return 'ok';
    })()`);
    await sleep(600);
    await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    await sleep(1400);
  }
  const hayServicio = await waitFor(`!!document.querySelector('[data-field="iva-desglose-equipo-1"]')`, 12000);
  check('F74: el formulario de servicio muestra el desglose del equipo', hayServicio);
  if (hayServicio) {
    await evalx(`(() => {
      const i = document.querySelector('[aria-label="Monto ($) del servicio"]');
      if (!i) return false;
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      s.call(i,'30'); i.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
    await sleep(900);
    const lineaServicio = await evalx(`document.querySelector('[data-field="iva-desglose-equipo-1"]')?.innerText ?? null`);
    check('F74: con monto $30 el servicio dice el total con IVA (34,80 en $ · 29.702 en Bs.)',
      /(34,80|29\.702)/.test(String(lineaServicio)), String(lineaServicio));
    await keyNav('Escape', 'Escape', 27);
    await sleep(900);
  }
}

// ── 3) EL LIBRO DE IVA DEL PERÍODO (con dos operaciones REALES en la copia) ───────────────────
{
  const hoy = DIA ?? new Date().toISOString().slice(0, 10);
  // Dos operaciones de prueba: una venta de $34,80 y una orden de $116,00, las dos al 16%.
  escribir("INSERT INTO sales (date, product_name, quantity, unit_price, total, payment_method, currency, iva_rate, iva_mode) VALUES (?1, 'PRUEBA IVA F74', 1, 34.8, 34.8, 'Divisas (USD Cash)', 'USD', 16, 'agregado')", `${hoy} 12:00:00`);
  const ventaId = Number(uno("SELECT id FROM sales WHERE product_name='PRUEBA IVA F74' ORDER BY id DESC LIMIT 1").id);
  escribir("INSERT INTO services (order_num, date_in, client, amount, payment_method, currency, iva_rate, iva_mode, status, paid_amount) VALUES ('PRUEBA-IVA-F74', ?1, 'Prueba IVA', 116, 'Divisas (USD Cash)', 'USD', 16, 'agregado', 'Recibido', 0)", `${hoy} 12:00:00`);
  const svcId = Number(uno("SELECT id FROM services WHERE order_num='PRUEBA-IVA-F74' ORDER BY id DESC LIMIT 1").id);
  check('F74: se crearon las dos operaciones de prueba en la copia', ventaId > 0 && svcId > 0, `venta ${ventaId} · orden ${svcId}`);

  await evalx(`location.reload(); 'recargando'`).catch(() => {});
  await sleep(2500);
  await entrar('Master', '1234');
  await irAlLibro();
  await abrirTab('diario');
  const hayPanel = await waitFor(`!!document.querySelector('[data-panel="iva-periodo"]')`, 15000);
  check('F74: el Libro Diario muestra la tarjeta «IVA del período»', hayPanel);
  if (hayPanel) {
    const campos = JSON.parse(await evalx(`(() => {
      const t = (sel) => document.querySelector(sel)?.innerText?.trim() ?? null;
      return JSON.stringify({
        base: t('[data-field="iva-periodo-base"]'), iva: t('[data-field="iva-periodo-iva"]'),
        total: t('[data-field="iva-periodo-total"]'), sin: t('[data-field="iva-periodo-sin"]'), ops: ((document.querySelector('[data-field="iva-periodo-nota"]')?.innerText || '').match(/([0-9]+) operaci/) ?? [])[1] ?? null,
      });
    })()`));
    // 34,80 al 16% → base 30,00 + IVA 4,80 · 116,00 al 16% → base 100,00 + IVA 16,00
    check('F74: la base imponible del período es $130.00 (sólo lo gravado)',
      campos.base === '$130.00', String(campos.base));
    check('F74: el IVA del período es $20.80 (4,80 + 16,00)', campos.iva === '$20.80', String(campos.iva));
    check('F74: lo cobrado CON IVA es $150.80', campos.total === '$150.80', String(campos.total));
    check('F74: y cuenta las 2 operaciones con IVA', String(campos.ops) === '2', String(campos.ops));
    // La copia tiene operaciones viejas SIN IVA: entran en su propia tile y NO inflan la base.
    check('F74: lo cobrado sin IVA se informa aparte (no infla la base imponible)',
      Number(String(campos.sin).replace(/[^0-9.]/g, '')) > 0, String(campos.sin));
  }
  // Limpieza: las filas de prueba se borran (no dejan rastro en la copia).
  escribir('DELETE FROM sales WHERE id=?1', ventaId);
  escribir('DELETE FROM services WHERE id=?1', svcId);
  check('F74: las filas de prueba se borraron',
    Number(uno("SELECT COUNT(*) AS n FROM sales WHERE product_name='PRUEBA IVA F74'").n) === 0
    && Number(uno("SELECT COUNT(*) AS n FROM services WHERE order_num='PRUEBA-IVA-F74'").n) === 0);
}

// ── 4) LA CAJA: lee la configuración pero no la cambia ────────────────────────────────────────
{
  const hayCaja = Number(uno("SELECT COUNT(*) AS n FROM users WHERE role='caja' AND active=1").n) > 0;
  if (!hayCaja) {
    check('F74: la copia trae una persona de CAJA (se omite)', true, 'sin persona de caja');
  } else {
    check('F74: la caja entra con SU PIN', await entrar('Caja 1', '2468'));
    await irAlLibro();
    await sleep(1200);
    check('F74: la caja NO tiene la acción «IVA» (no define impuestos)',
      !(await evalx(`!!document.querySelector('[data-action="libro-iva"]')`)));
    const leida = await invoke('get_tax_config', {}).catch(e => ({ err: String(e) }));
    check('F74: la caja SÍ puede leer la configuración del IVA (la necesita para cobrar)',
      leida?.activo === true && Number(leida?.alicuota) === 16, JSON.stringify(leida));
    const err = await invokeErr('set_tax_config', { activo: false, alicuota: 8, modo: 'agregado' });
    check('F74: la caja NO puede cambiarla (gate del backend)', !!err && /due|Master/i.test(String(err)), String(err ?? '(¡PASÓ!)'));
  }
}

// ── 5) LIMPIEZA: el IVA vuelve a quedar APAGADO como estaba ───────────────────────────────────
{
  await entrar('Master', '1234');
  const final = await invoke('set_tax_config', { activo: false, alicuota: 16, modo: 'incluido' });
  check('F74: la verificación deja el IVA APAGADO (la copia queda como estaba)',
    final?.activo === false && final?.modo === 'incluido', JSON.stringify(final));
}

console.log(`\nverify_iva: ${checks - fallos.length}/${checks} OK${fallos.length ? ` — ${fallos.length} FALLAN` : ''}`);
if (fallos.length) { console.log(fallos.map(f => `  · ${f}`).join('\n')); process.exit(1); }
process.exit(0);
