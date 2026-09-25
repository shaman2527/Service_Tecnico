// VERIFICACIÓN EN VIVO (CDP) de F69 — EL ARQUEO DEL CAJÓN (fondo, gastos del cajón y verificación
// del banco) + los accesos que el dueño pidió cerrar.
//
// Es el hallazgo A1 de `AUDITORIA_ENTREGA.md`, el bloqueante de la entrega: el cierre del día pedía
// contar el cajón contra un «esperado» que **no incluía el fondo de caja ni los gastos pagados del
// cajón** (un día perfecto «faltaba» lo que se pagó del cajón y «sobraba» el fondo), y precargaba los
// cobros digitales con el monto del sistema, así que su diferencia daba 0 SIEMPRE y nadie verificaba
// el banco.
//
// Qué comprueba sobre la app REAL (contra la BASE leída aparte, nunca contra sí misma):
//   1. **El desglose del cajón** que el cierre muestra antes de pedir un conteo: cobrado + fondo −
//      gastos pagados del cajón = esperado, con el gasto del cajón declarado por el operario.
//   2. **Nada entra «porque el sistema lo dice»**: todas las líneas nacen «sin contar», cerrar sin
//      contar se RECHAZA con el nombre de lo que falta y el día sigue abierto en la base.
//   3. **Un conteo distinto se ve**: escribir un número distinto del esperado baja el semáforo de esa
//      moneda (la diferencia más el texto en la moneda real).
//   4. **El diálogo de gastos pregunta de dónde salió la plata** (es lo que ajusta el cajón).
//   5. **Cerrar el día es del dueño**: la sesión de caja NO tiene el botón (el backend ya lo exigía) y
//      sí tiene su camino explicado.
//   6. **Los números del dueño quedan detrás del gate**: utilidad, capital del inventario, respaldo y
//      el costo del catálogo no llegan a una sesión de caja (ni por IPC directo).
//
// FIXTURE (todo sobre la COPIA y se deshace al terminar): fondo de caja $50 en el día abierto + un
// gasto de $20 pagado del cajón (Divisas USD Cash). Al final se borra el gasto (con su contra-asiento)
// y se devuelve el fondo a 0.
//
// SEGURIDAD DE DATOS: SIEMPRE sobre una COPIA (`REGISTRO_DB`); rechaza correr contra `registro.db`.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f69_verif.db"
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_arqueo_f69.mjs

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) GATE: la base (la verdad independiente) ────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: esta prueba ESCRIBE en la base — nunca contra la real. Apuntá REGISTRO_DB a una copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const filas = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return [{ err: String(e.message) }]; } };
const uno = (sql, ...p) => filas(sql, ...p)[0] ?? {};
const cuenta = (sql, ...p) => Number(uno(sql, ...p).n ?? -1);

const abierto = uno('SELECT * FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1');
if (!abierto?.close_date) {
  console.error('ABORTADO: no hay día abierto en la copia — el arqueo se prueba sobre un turno abierto.');
  process.exit(2);
}
const DIA = abierto.close_date;
const FONDO_PRUEBA = 50;
const GASTO_PRUEBA = 20;
/** Gastos del cajón que el día YA tenía antes de la prueba (la copia puede traer historia): todas las
 *  comprobaciones se miden contra esa base, así la verificación corre sobre cualquier copia. */
let gastosBase = 0;
/** Si la copia no traía persona de caja, la crea la verificación y la borra al terminar. */
let personaCajaCreada = 0;
console.log(`· base: ${DIA} abierto · fondo actual $${abierto.initial_cash_usd} · tasa ${abierto.tasa_bcv}`
  + ` · ${cuenta('SELECT COUNT(*) AS n FROM cash_movements')} movimientos de plata`);

/** Deja el fondo de caja de prueba en el día abierto (escritura directa en la COPIA). */
const ponerFondo = (valor) => {
  const w = new DatabaseSync(dbPath);
  try { w.prepare('UPDATE daily_closings SET initial_cash_usd=?1 WHERE is_closed=0').run(valor); }
  finally { w.close(); }
};

// ── helpers de IPC y de la pantalla de acceso (mismos que verify_sesiones_caja) ───────────────
const invoke = (m, a) => evalx(`(async () => {
  try { const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(m)}, ${JSON.stringify(a ?? {})}); return JSON.stringify({ ok: r }); }
  catch (e) { return JSON.stringify({ err: String(e) }); }
})()`).then(r => {
  const o = JSON.parse(String(r ?? '{}'));
  if (o.err) throw new Error(o.err);
  return o.ok;
});
const invokeErr = async (m, a) => {
  try { await invoke(m, a); return null; } catch (e) { return e.message; }
};

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

/** Abre Libro Diario (la pantalla del arqueo). Espera un botón PROPIO del módulo: el texto «Libro
 *  Diario» también está en la barra lateral, así que esperar por él devolvía antes de que el módulo
 *  (carga diferida) estuviera montado y la consulta siguiente no encontraba nada. */
const irAlLibro = async () => {
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Libro Diario/i.test(x.innerText || x.getAttribute('title') || '')); if (b) b.click(); return !!b; })()`);
  return await waitFor(`[...document.querySelectorAll('button')].some(b => /^Diario$/.test((b.innerText || '').trim()))`, 12000);
};

// ── 1) FIXTURE: fondo de caja de $50 en el turno abierto + la app queda en el acceso ──────────
{
  ponerFondo(FONDO_PRUEBA);
  await evalx(`location.reload(); 'recargando'`).catch(() => {});
  await sleep(2500);
  const ok = await entrar('Master', '1234');
  check('F69: el Master entra para el arqueo (sobre la copia)', ok);
  const fondoVisto = await invoke('get_drawer_adjustments', { date: DIA }).catch(() => null);
  check('F69: el backend informa el fondo de caja del día (lo que ajusta el cajón)',
    Number(fondoVisto?.fondo_usd) === FONDO_PRUEBA, JSON.stringify(fondoVisto));
  // Base del día ANTES de la prueba: los gastos del cajón que ya tenía la copia.
  gastosBase = Number(fondoVisto?.gastos_usd ?? 0);
  console.log(`· gastos del cajón que el día YA tenía: $${gastosBase}`);
}

// ── 2) un GASTO pagado del cajón (con su método declarado) ───────────────────────────────────
{
  // Por IPC: el número se prepara sin depender de la pantalla (que se verifica aparte, más abajo).
  const id = await invoke('add_expense', {
    expenseDate: DIA, category: 'Compra de repuestos', amount: GASTO_PRUEBA, currency: 'USD',
    notes: 'prueba F69 del cajón', method: 'Divisas (USD Cash)',
  }).catch(e => { check('F69: se pudo anotar el gasto de prueba', false, e.message); return null; });
  const mov = uno("SELECT * FROM cash_movements WHERE expense_id=?1 AND type='gasto'", id ?? -1);
  check('F69: el gasto pagado del cajón queda en el LIBRO con su método',
    Number(mov?.amount) === GASTO_PRUEBA && mov?.method === 'Divisas (USD Cash)' && Number(mov?.sign) === -1,
    JSON.stringify(mov));
  const adj = await invoke('get_drawer_adjustments', { date: DIA }).catch(() => null);
  check('F69: el ajuste del cajón informa el gasto (lo que va a bajar el esperado)',
    Number(adj?.gastos_usd) === gastosBase + GASTO_PRUEBA, JSON.stringify(adj));
}

// ── 3) el diálogo de GASTOS pregunta de dónde salió la plata ─────────────────────────────────
{
  await irAlLibro();
  // La pestaña Gastos aparece cuando el módulo termina de montar: se ESPERA el botón.
  const hayGastos = await waitFor(`[...document.querySelectorAll('button')].some(x => /^Gastos$/.test((x.innerText || '').trim()))`, 12000);
  if (!hayGastos) check('F69: el dueño tiene la pestaña Gastos', false, 'no apareció el botón «Gastos»');
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Gastos$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
  const abrio = await waitFor(`[...document.querySelectorAll('button')].some(b => /Registrar gasto/i.test(b.innerText || ''))`, 12000);
  if (abrio) {
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Registrar gasto/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
    const hay = await waitFor(`!!document.querySelector('[data-field="exp-metodo"]')`, 6000);
    const opciones = await evalx(`[...(document.querySelector('[data-field="exp-metodo"]')?.options ?? [])].map(o => o.value)`);
    check('F69: el diálogo de gastos pregunta «¿De dónde salió la plata?»',
      hay && Array.isArray(opciones) && opciones.includes('Divisas (USD Cash)') && opciones.includes('Efectivo Bs'),
      `opciones: ${JSON.stringify(opciones)}`);
    // El aviso tiene que cambiar SEGÚN el método: antes decía «sale del cajón» para cualquiera.
    const elegir = (valor) => evalx(`(() => {
      const s = document.querySelector('[data-field="exp-metodo"]');
      if (!s) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(s, ${JSON.stringify(valor)});
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await elegir('Divisas (USD Cash)');
    await sleep(400);
    const avisoCajon = String(await evalx(`document.querySelector('[data-field="exp-metodo-aviso"]')?.innerText ?? ''`));
    await elegir('Transferencia Zelle');
    await sleep(400);
    const avisoBanco = String(await evalx(`document.querySelector('[data-field="exp-metodo-aviso"]')?.innerText ?? ''`));
    await elegir('');
    await sleep(300);
    const avisoSin = String(await evalx(`document.querySelector('[data-field="exp-metodo-aviso"]')?.innerText ?? ''`));
    check('F69: el aviso dice la verdad de cada método (cajón / banco / sin declarar)',
      /cajón/i.test(avisoCajon) && /no toca el cajón/i.test(avisoBanco) && /Sin declarar/i.test(avisoSin),
      `cajón=«${avisoCajon}» · banco=«${avisoBanco}» · sin declarar=«${avisoSin}»`);
    await keyNav('Escape', 'Escape', 27);
    await sleep(700);
  } else {
    check('F69: el diálogo de gastos se abre (pestaña Gastos)', false, 'no apareció el botón «Registrar gasto»');
  }
}

// ── 4) el ARQUEO: desglose, nada dado por hecho, y el cierre rechazado sin contar ────────────
{
  await irAlLibro();
  const abrioCierre = await evalx(`(() => { const b = document.querySelector('[data-action="cerrar-dia"]'); if (b) b.click(); return !!b; })()`);
  check('F69: el dueño tiene el botón «Cerrar Día» en el turno abierto', abrioCierre);
  // El diálogo se abre con los datos leídos; se ESPERA el número real (fondo de la prueba) en vez de
  // leer el panel a medio cargar (la primera corrida midió $0.00 y parecía un bug del producto).
  const dialogo = await waitFor(`!!document.querySelector('[data-panel="desglose-cajon"]')`, 12000);
  check('F69: el cierre muestra el DESGLOSE del cajón antes de pedir un conteo', dialogo);
  const cargado = await waitFor(`/Fondo de caja\\s*\\$${FONDO_PRUEBA}\\.00/.test(document.querySelector('[data-panel="desglose-cajon"]')?.innerText || '')`, 10000);
  check('F69: el desglose llega con los datos del día (no se abre en $0.00)', cargado);

  if (dialogo) {
    const texto = String(await evalx(`document.querySelector('[data-panel="desglose-cajon"]').innerText.replace(/\\s+/g,' ')`));
    check('F69: el desglose dice el fondo de caja declarado al abrir',
      /Fondo de caja/i.test(texto) && texto.includes(`$${FONDO_PRUEBA}.00`), texto.slice(0, 180));
    check('F69: el desglose RESTA los gastos pagados del cajón (el hallazgo A1)',
      /Gastos pagados del cajón/i.test(texto) && texto.includes(`− $${(gastosBase + GASTO_PRUEBA).toFixed(2)}`), texto.slice(0, 260));
    const esperadoTxt = String(await evalx(`document.querySelector('[data-field="esperado-cajon"]')?.innerText ?? ''`));
    check('F69: dice EXPLÍCITAMENTE cuánto tiene que haber en el cajón', /\$/.test(esperadoTxt), esperadoTxt);

    // El esperado de la pantalla tiene que ser el MISMO que calcula el backend: cobrado + fondo − gasto.
    // El «cobrado» incluye lo que `compute_daily_totals` PRESUME: una orden ENTREGADA sin ningún pago
    // (el cliente pagó en el mostrador y nadie lo anotó) suma por el método del formulario.
    const t = uno(`SELECT
        COALESCE((SELECT SUM(total) FROM sales WHERE date(date)=?1 AND payment_method='Divisas (USD Cash)' AND voided_at IS NULL),0)
      + COALESCE((SELECT SUM(amount) FROM service_payments WHERE date(payment_date)=?1 AND payment_method='Divisas (USD Cash)'),0)
      + COALESCE((SELECT SUM(amount) FROM services WHERE status='Entregado' AND date(date_out)=?1
                    AND payment_method='Divisas (USD Cash)'
                    AND NOT EXISTS (SELECT 1 FROM service_payments sp WHERE sp.service_id = services.id)),0) AS cobrado`, DIA);
    const esperadoDb = Number(t?.cobrado ?? 0) + FONDO_PRUEBA - (gastosBase + GASTO_PRUEBA);
    const esperadoUi = Number((esperadoTxt.match(/\$([\d.,]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN);
    check('F69: el esperado del cajón en pantalla es cobrado + fondo − gastos del cajón (mismo número que el backend)',
      Number.isFinite(esperadoUi) && Math.abs(esperadoUi - esperadoDb) < 0.02,
      `pantalla ${esperadoTxt} vs backend $${esperadoDb.toFixed(2)} (cobrado $${Number(t?.cobrado ?? 0).toFixed(2)})`);

    // NINGUNA línea entra por el sistema: todas nacen «sin contar» y no se muestra un «Cuadra».
    const estados = await evalx(`[...document.querySelectorAll('[data-arqueo]')].map(e => e.getAttribute('data-arqueo') + ':' + e.getAttribute('data-estado'))`);
    check('F69: TODAS las líneas del arqueo nacen «sin contar» (nada se da por hecho)',
      Array.isArray(estados) && estados.length > 0 && estados.every(e => e.endsWith('sin_contar')), JSON.stringify(estados));
    check('F69: mientras falte contar NO se muestra una diferencia que diga «cuadra»',
      !(await evalx(`!!document.querySelector('[data-field="dif-usd"]')`))
      && /Falta contar\/verificar/i.test(String(await evalx(`document.querySelector('[data-field="faltan-confirmar"]')?.innerText ?? ''`))));
    // Las líneas se afirman POR CLAVE contra una re-derivación de la regla hecha en el script: antes
    // se comparaba el array consigo mismo (una aserción que pasaba por construcción).
    // OJO con la precedencia: `await invoke(x)?.[0]` se parsea como `await (invoke(x)?.[0])` — el
    // promise no tiene índice 0 y devolvía `undefined` (los totales llegaban vacíos y la expectativa
    // se calculaba con ceros). El await va primero.
    const totalesDia = await invoke('get_daily_totals', { startDate: DIA, endDate: DIA });
    const t0 = (Array.isArray(totalesDia) ? totalesDia[0] : null) ?? {};
    const adjAhora = await invoke('get_drawer_adjustments', { date: DIA }).catch(() => ({}));
    const esperadas = ['usd', 'bs'];   // el cajón se cuenta SIEMPRE en las dos monedas (regla F69)
    if (Math.abs(t0.pos_charged_usd ?? 0) > 0.005) esperadas.push('pos_usd');
    if (Math.abs(t0.pos_charged_bs ?? 0) > 0.005) esperadas.push('pos_bs');
    if (Math.abs(t0.zelle_total ?? 0) > 0.005) esperadas.push('zelle');
    if (Math.abs(t0.pago_movil_total ?? 0) > 0.005) esperadas.push('pago_movil');
    if (Math.abs(t0.transfer_bs_total ?? 0) > 0.005) esperadas.push('trans_bs');
    const claves = (estados ?? []).map(e => String(e).split(':')[0]).sort();
    check('F69: el arqueo pide EXACTAMENTE las líneas que la regla exige (cajón, Punto y banco)',
      JSON.stringify(claves) === JSON.stringify(esperadas.slice().sort()),
      `pantalla=${JSON.stringify(claves)} · regla=${JSON.stringify(esperadas.slice().sort())}`
      + ` · totales=${JSON.stringify({ pos_bs: t0.pos_charged_bs, usd: t0.usd_cash_total, bs: t0.cash_bs, adj: adjAhora.gastos_bs })}`);

    // Cerrar SIN contar se rechaza y el día sigue abierto en la base (la verdad es la base).
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Cerrar Día$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    await sleep(1200);
    const errorTxt = String(await evalx(`(document.body.innerText || '').replace(/\\s+/g,' ')`));
    check('F69: cerrar sin contar se RECHAZA diciendo qué falta',
      /Falta contar\/verificar/i.test(errorTxt));
    check('F69: el día NO se cerró (sigue abierto en la base)',
      Number(uno('SELECT COUNT(*) AS n FROM daily_closings WHERE is_closed=0').n) === 1,
      'días abiertos: ' + cuenta('SELECT COUNT(*) AS n FROM daily_closings WHERE is_closed=0'));

    // Un conteo DISTINTO del esperado tiene que verse (la diferencia por moneda, en su moneda).
    // OJO CON LA MÁSCARA DE DINERO: `MoneyInput` (es-VE) toma los dígitos SIN separador como CENTAVOS
    // cuando pasan de dos («145» → «1,45»), así que el valor se manda YA FORMATEADO («145,00»). El
    // script mandaba el número crudo y con un esperado de 3 cifras ($145) escribía $1,45: las tres
    // comprobaciones del conteo fallaban por el formato, no por el arqueo (medido con `_probe_arqueo`).
    await evalx(`(() => {
      const inp = document.querySelector('[data-arqueo="usd"] input');
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '5,00');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(900);
    const difUsd = await evalx(`(() => { const e = document.querySelector('[data-field="dif-linea-usd"]'); return e ? { txt: e.innerText, ok: e.getAttribute('data-ok') } : null; })()`);
    check('F69: un conteo distinto del esperado baja el semáforo de ESA moneda',
      difUsd && difUsd.ok === 'false' && /faltan|sobran/i.test(String(difUsd.txt)),
      JSON.stringify(difUsd));

    // El operario escribe el número que contó (es el flujo real): acá el esperado de divisas.
    const esperadoUsdTxt = String(await evalx(`document.querySelector('[data-arqueo="usd"]')?.innerText ?? ''`));
    const esperadoUsd = Number((esperadoUsdTxt.match(/Esperado:\s*\$([\d.,]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN);
    await evalx(`(() => {
      const inp = document.querySelector('[data-arqueo="usd"] input');
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${JSON.stringify(esperadoUsd.toFixed(2).replace('.', ','))});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(700);
    check('F69: al escribir el conteo real la diferencia de esa moneda vuelve a cuadrar',
      (await evalx(`document.querySelector('[data-field="dif-linea-usd"]')?.getAttribute('data-ok')`)) === 'true',
      `esperado leído de la pantalla: $${esperadoUsd}`);

    // «Es el esperado» confirma el resto de las líneas (una acción humana, no un default).
    for (let i = 0; i < 12; i++) {
      const quedo = await evalx(`(() => { const b = document.querySelector('[data-arqueo] [data-action="usar-esperado"]'); if (!b) return false; b.click(); return true; })()`);
      if (!quedo) break;
      await sleep(450);
    }
    const estados2 = await evalx(`[...document.querySelectorAll('[data-arqueo]')].map(e => e.getAttribute('data-arqueo') + ':' + e.getAttribute('data-estado'))`);
    check('F69: al confirmar cada línea el arqueo queda contado (todas «cuadrado»)',
      Array.isArray(estados2) && estados2.length > 0 && estados2.every(e => e.endsWith('cuadrado')), JSON.stringify(estados2));
    const difOk = await evalx(`(() => { const u = document.querySelector('[data-field="dif-usd"]'); const b = document.querySelector('[data-field="dif-bs"]'); return { usd: u?.getAttribute('data-ok') ?? null, bs: b?.getAttribute('data-ok') ?? null }; })()`);
    check('F69: con el cajón contado las dos monedas cuadran (fondo y gastos incluidos)',
      difOk.usd === 'true' && difOk.bs === 'true', JSON.stringify(difOk));

    // NO se cierra el día: la verificación mide el diálogo, no cambia el turno de la copia.
    await keyNav('Escape', 'Escape', 27);
    await sleep(800);
    check('F69: la verificación NO cerró el turno real de la copia',
      Number(uno('SELECT COUNT(*) AS n FROM daily_closings WHERE is_closed=0').n) === 1);
  }
}

// ── 5) la sesión de CAJA: su día, sin el cierre ni los números del dueño ─────────────────────
{
  // FIXTURE de la persona de caja: si la copia no la tiene, se crea (y se borra al final). Así la
  // verificación corre sobre cualquier copia (una base vieja migrada tiene sólo al Master).
  let cajaId = Number(uno("SELECT id FROM users WHERE role='caja' AND active=1 ORDER BY id LIMIT 1")?.id ?? 0);
  if (!cajaId) {
    const creada = await invoke('add_user', { name: 'Caja 1', role: 'caja', pin: '2468', color: '#22c55e' }).catch(() => null);
    cajaId = Number(creada ?? 0);
    personaCajaCreada = cajaId;
    check('F69: se creó la persona de caja para probar los accesos (fixture)', cajaId > 0, `id=${cajaId}`);
  }
  const entro = await entrar('Caja 1', '2468');
  check('F69: la caja entra con SU PIN', entro);
  await irAlLibro();
  const sinCerrar = !(await evalx(`!!document.querySelector('[data-action="cerrar-dia"]')`));
  const explicado = await evalx(`!!document.querySelector('[data-field="cierre-solo-dueno"]')`);
  check('F69: la caja NO tiene el botón «Cerrar Día» (es del dueño) y se le dice el camino',
    sinCerrar && explicado, `sinBoton=${sinCerrar} explicado=${explicado}`);
  const botones = await evalx(`[...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean)`);
  const txt = JSON.stringify(botones);
  check('F69: la caja no ve Gastos, Salud ni Personas (lo del dueño)',
    !/"Gastos"/.test(txt) && !/"Salud"/.test(txt) && !/"Personas"/.test(txt), txt.slice(0, 240));
  check('F69: la caja SÍ tiene su libro de movimientos',
    /"Movimientos"/.test(txt), txt.slice(0, 240));

  // El gate real (backend): utilidad, capital, respaldo y el costo del catálogo no llegan a la caja.
  const casos = [
    ['ver la utilidad del negocio', 'get_profit_summary', { startDate: '', endDate: '' }],
    ['ver el capital del inventario', 'get_inventory_value', {}],
    ['exportar toda la base', 'export_data', {}],
  ];
  for (const [que, cmd, args] of casos) {
    const err = await invokeErr(cmd, args);
    check(`F69: la caja NO puede ${que} (gate del backend)`, !!err && /due|Master/i.test(String(err)), String(err ?? '(¡PASÓ!)').slice(0, 80));
  }
  // El costo del catálogo tampoco: el precio de VENTA sí (lo necesita para cobrar).
  const prods = await invoke('get_products', { search: '', categoryId: null }).catch(() => null);
  const conVenta = (prods ?? []).filter(p => Number(p.price_sale) > 0);
  check('F69: el catálogo de la caja llega SIN costo (y con el precio de venta intacto)',
    Array.isArray(prods) && conVenta.length > 0 && conVenta.every(p => Number(p.price_cost) === 0),
    `productos con venta: ${conVenta.length} · con costo > 0: ${conVenta.filter(p => Number(p.price_cost) > 0).length}`);
  const stats = await invoke('get_inventory_stats', {}).catch(() => null);
  check('F69: los KPIs del inventario de la caja no traen el capital a costo',
    stats && Number(stats.value_cost) === 0, JSON.stringify({ value_cost: stats?.value_cost, value_sale: stats?.value_sale }));
}

// ── 6) limpieza: se borra el gasto de prueba (con su contra-asiento) y se devuelve el fondo ──
{
  const entro = await entrar('Master', '1234');
  check('F69: el Master vuelve a entrar para limpiar', entro);
  const gasto = uno("SELECT id FROM expenses WHERE notes='prueba F69 del cajón' ORDER BY id DESC LIMIT 1");
  if (gasto?.id) {
    await invoke('delete_expense', { id: gasto.id }).catch(() => {});
    const contra = uno("SELECT * FROM cash_movements WHERE expense_id=?1 ORDER BY id DESC LIMIT 1", gasto.id);
    check('F69: borrar el gasto deja su CONTRA-ASIENTO en el libro (el rastro no se pierde)',
      contra?.type === 'gasto_anulado' && Number(contra?.amount) === GASTO_PRUEBA, JSON.stringify(contra));
    const adj = await invoke('get_drawer_adjustments', { date: DIA }).catch(() => null);
    check('F69: el ajuste del cajón vuelve a la base del día cuando el gasto se borra (no queda bajando el esperado)',
      Number(adj?.gastos_usd) === gastosBase, `${JSON.stringify(adj)} (base del día: $${gastosBase})`);
  }
  ponerFondo(Number(abierto.initial_cash_usd));
  check('F69: el fondo de caja de la copia queda como estaba',
    Number(uno('SELECT initial_cash_usd v FROM daily_closings WHERE is_closed=0').v) === Number(abierto.initial_cash_usd));
  // La persona de caja que creó la verificación se saca: la copia queda como estaba.
  if (personaCajaCreada) {
    await invoke('delete_user', { id: personaCajaCreada }).catch(() => {});
    check('F69: la persona de caja que creó la verificación se borró de la copia',
      Number(uno('SELECT COUNT(*) n FROM users WHERE id=?1', personaCajaCreada).n) === 0);
  }
  check('F69: la base quedó sana', uno('PRAGMA quick_check').quick_check === 'ok');
}

db.close();
const failed = out.filter(r => !r.ok);
console.log(`\nverify_arqueo_f69: ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
