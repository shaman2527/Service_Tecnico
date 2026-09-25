// VERIFICACIÓN EN VIVO (CDP) de F76 — LA APP SE ACTUALIZA SOLA.
//
// Pedido del dueño (2026-09-25): «en la app de admin tengo que darle actualizar para lo que haga…
// de una vez rápido esté todo sincronizado». Lo que comprueba, contra la app REAL:
//
//   1. El indicador de sincronización existe y dice que está al día.
//   2. UNA ESCRITURA DE LA APP (registrar un gasto desde la UI) sube la versión de datos → las
//      pantallas quedan avisadas sin que nadie apriete nada.
//   3. UN CAMBIO DE AFUERA + VOLVER A LA APP: se inserta un pago directamente en la base (como si lo
//      hubiera hecho otra sesión o una restauración), se le da foco a la ventana —NADA MÁS, ningún
//      botón— y la lista VISIBLE se actualiza sola con ese pago adentro.
//
// SEGURIDAD DE DATOS: corre SIEMPRE contra una COPIA (`REGISTRO_DB`) y borra las filas de prueba.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f76_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       app de dev abierta  →  node tools/verify_auto_refresh.mjs

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
const waitFor = async (expr, timeout = 12000) => {
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
const escribir = (sql, ...p) => { const d = new DatabaseSync(dbPath); try { return d.prepare(sql).run(...p); } finally { d.close(); } };
// OJO: recibe los parámetros (la primera versión los ignoraba: un ?1 sin ligar vale NULL y el
// chequeo pasaba vacío — el bug clásico de un test que no puede fallar).
const uno = (sql, ...p) => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare(sql).get(...p) ?? {}; } finally { d.close(); } };
const dia = uno("SELECT close_date FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1").close_date ?? null;
console.log(`· copia: ${dbPath} · turno abierto: ${dia ?? 'ninguno'}`);

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
/** La versión de datos que muestra el indicador del sidebar. */
const versionSync = async () => Number(await evalx(`document.querySelector('[data-sync-indicator]')?.getAttribute('data-sync-indicator') ?? 0`));
/** El texto de la pantalla (para buscar el pago de prueba). */
const textoMain = async () => String(await evalx(`document.querySelector('main')?.innerText ?? ''`));

// ── 1) Entrar y ver el indicador ──────────────────────────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
check('F76: el Master entra (sobre la copia)', await entrar('Master', '1234'));
check('F76: el sidebar muestra el indicador de sincronización',
  await evalx(`!!document.querySelector('[data-sync-indicator]')`));
const vInicial = await versionSync();
check('F76: el indicador arranca con una versión de datos', vInicial > 0, String(vInicial));

// ── 2) Una escritura de la APP sube la versión (sin apretar nada) ─────────────────────────────
{
  check('F76: llega al Libro Diario', await irAlLibro());
  await sleep(1500);
  await evalx(`(() => { const b = document.querySelector('[data-tab="gastos"]'); if (b) b.click(); return !!b; })()`);
  await sleep(1500);
  const hay = await waitFor(`[...document.querySelectorAll('button')].some(b => /^Registrar gasto$/.test((b.innerText || '').trim()))`, 12000);
  check('F76: la pestaña Gastos abre con su botón', hay);
  if (hay) {
    const antes = await versionSync();
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Registrar gasto$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    await sleep(1200);
    // Monto 1 y categoría por defecto; se guarda y después se borra (la fila se limpia al final).
    await evalx(`(() => {
      const inp = document.querySelector('[role="dialog"] input[inputmode="decimal"]');
      if (!inp) return false;
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(inp, '1,00'); inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
    await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^(Guardar|Registrar|Agregar)/i.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    await sleep(2500);
    const despues = await versionSync();
    check('F76: guardar desde la UI sube la versión de datos (las pantallas quedan avisadas)',
      despues > antes, `${antes} → ${despues}`);
    // Y la lista de gastos se ve con el gasto nuevo (se recargó sola).
    const txt = await textoMain();
    check('F76: el gasto recién registrado ya está en la lista visible', /1[.,]00/.test(txt), txt.slice(0, 160).replace(/\n+/g, ' | '));
  }
}

// ── 3) Un cambio DE AFUERA + volver a la app = la pantalla se pone al día sola ────────────────
{
  // Se deja la pantalla en la pestaña PAGOS (lista visible de cobros) y se inserta un pago en la base
  // como lo haría otra sesión / una restauración: la app NO se enteró de nada.
  await evalx(`(() => { const b = document.querySelector('[data-tab="pagos"]'); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Buscar$|^Actualizar$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(1500);

  // OJO: la tabla de Pagos muestra la referencia truncada («····CO-F76»), así que la de prueba es corta:)n  // si no, la comprobación falla aunque la pantalla esté bien (lección de esta corrida).
  const REF = 'F76REF';
  check('F76: el cobro de prueba NO está todavía en la pantalla', !(await textoMain()).includes(REF));

  const svc = Number(uno('SELECT id FROM services ORDER BY id LIMIT 1').id ?? 0);
  const fecha = `${dia ?? new Date().toISOString().slice(0, 10)} 12:00:00`;
  escribir(`INSERT INTO service_payments (service_id, amount, payment_method, net_amount, zelle_reference, currency, payment_date)
            VALUES (?, 3, 'Transferencia Zelle', 3, ?, 'USD', ?)`, svc, REF, fecha);
  const filaPrueba = uno('SELECT id, amount FROM service_payments WHERE zelle_reference = ? ORDER BY id DESC LIMIT 1', REF);
  const idPago = Number(filaPrueba.id ?? 0);
  check('F76: el pago de prueba entró en la base (desde AFUERA de la app)', idPago > 0,
    `id ${idPago} · svc ${svc} · fecha ${fecha} · leído ${JSON.stringify(filaPrueba)} · total filas ${JSON.stringify(uno('SELECT COUNT(*) AS n FROM service_payments'))}`);

  const vAntes = await versionSync();
  // LO ÚNICO que se hace: avisar que la ventana volvió a estar activa (como cuando el operario vuelve
  // a la app después de mirar otra cosa). NINGÚN botón.
  await evalx(`window.dispatchEvent(new Event('focus')); true`);
  await sleep(2500);
  const vDespues = await versionSync();
  check('F76: volver a la app sube la versión de datos sola', vDespues > vAntes, `${vAntes} → ${vDespues}`);
  const txt = await textoMain();
  check('F76: la lista VISIBLE se actualizó sola con el cobro que se hizo afuera', txt.includes(REF),
    txt.includes(REF) ? '' : txt.slice(0, 200).replace(/\n+/g, ' | '));

  // Limpieza: el pago de prueba se borra de la copia.
  escribir('DELETE FROM service_payments WHERE id=?', idPago);
  check('F76: el pago de prueba se borró de la copia',
    Number(uno('SELECT COUNT(*) AS n FROM service_payments WHERE zelle_reference = ?', REF).n ?? 0) === 0);
}

// Limpieza del gasto de prueba (el de $1).
{
  const gasto = uno("SELECT id FROM expenses WHERE amount = 1 ORDER BY id DESC LIMIT 1");
  if (gasto?.id) escribir('DELETE FROM expenses WHERE id=?', Number(gasto.id));
  check('F76: el gasto de prueba se borró (la copia queda como estaba)',
    Number(uno('SELECT COUNT(*) AS n FROM expenses WHERE amount = 1').n ?? 0) === 0);
}

console.log(`\nverify_auto_refresh: ${checks - fallos.length}/${checks} OK${fallos.length ? ` — ${fallos.length} FALLAN` : ''}`);
if (fallos.length) { console.log(fallos.map(f => `  · ${f}`).join('\n')); process.exit(1); }
process.exit(0);
