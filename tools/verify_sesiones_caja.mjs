// VERIFICACIÓN EN VIVO (CDP) de F68 — SESIONES DE CAJA (Master / Caja 1).
//
// Pedido del dueño (2026-09-23): «sería bueno la sesión de caja 1 pueda usar todo, ver su día de caja,
// pero no pueda ver cuánto factura la master; no tenga tanto acceso».
//
// Qué comprueba sobre la app REAL (contra la BASE leída aparte, nunca contra sí misma):
//   1. **El acceso es por persona**: la pantalla muestra a las personas (Master + Caja) y cada una
//      entra con SU PIN; un PIN equivocado no entra.
//   2. **La CAJA usa todo el mostrador**: ve los módulos (Ventas, Servicios, Inventario, Clientes,
//      Pedidos, Libro Diario, Ayuda) y puede registrar una VENTA.
//   3. **La CAJA no ve los números del dueño**: no tiene el Dashboard y el backend NO le devuelve los
//      movimientos de otras sesiones (es la comprobación central del pedido).
//   4. **El libro de plata anota el AUTOR**: la venta de la caja queda con su nombre (verificado en la
//      BASE, no en la pantalla) y el Master ve los movimientos de las dos sesiones.
//   5. **La CAJA no puede lo del dueño**: el backend rechaza lo sensible aunque se invoque por IPC.
//   6. **El Master ve todo** (movimientos de las dos sesiones, resumen por persona, alta de personas y
//      la pestaña Movimientos con el autor).
//
// LECCIONES DE LAS CORRIDAS ANTERIORES (por qué el script está así):
//   · Las sondas del gate NO pueden mutar nada si pasan: la primera versión usaba `set_pin` y, en la
//     corrida donde la sesión era la del dueño, le CAMBIÓ EL PIN al Master.
//   · La sesión vive en el BACKEND 12 h: al recargar la página la app la RETOMA, así que hay que
//     bloquearla con el botón para ver la pantalla de acceso — y esa pantalla puede quedar en «persona
//     elegida» con un error, así que siempre se vuelve a la LISTA antes de elegir.
//   · `add_sale` devuelve `()`, o sea que el IPC llega como `null`: el éxito se comprueba por la FILA
//     en la base, no por el valor de retorno.
//
// FIXTURE: crea la persona «Caja 1» (PIN 2468) si no existe, limpia las personas y ventas que haya
// dejado una corrida anterior y borra sus ventas de prueba al terminar.
//
// SEGURIDAD DE DATOS: SIEMPRE sobre una COPIA (`REGISTRO_DB`); rechaza correr contra `registro.db`.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f68_verif.db"
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_sesiones_caja.mjs

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

const antes = {
  ventas: cuenta('SELECT COUNT(*) AS n FROM sales'),
  servicios: cuenta('SELECT COUNT(*) AS n FROM services'),
  movimientos: cuenta('SELECT COUNT(*) AS n FROM cash_movements'),
  personas: cuenta('SELECT COUNT(*) AS n FROM users'),
  tablas: cuenta("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('users','cash_movements')"),
};
console.log(`· base: ${antes.ventas} ventas · ${antes.movimientos} movimientos de plata · ${antes.personas} personas · tablas F68: ${antes.tablas}/2`);

// ── helpers de IPC y de la pantalla de acceso ─────────────────────────────────────────────────
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

/** Deja la pantalla de acceso en la LISTA de personas (sin nadie elegido), desde cualquier estado. */
const irALaLista = async () => {
  for (let i = 0; i < 5; i++) {
    if (await evalx(`!!document.querySelector('[data-user-picker]')`)) return true;
    // sesión abierta → se bloquea (vuelve al acceso)
    await evalx(`(() => { const b = document.querySelector('[data-action="bloquear-sesion"]'); if (b) b.click(); return !!b; })()`);
    await sleep(900);
    // hay una persona elegida pero no entramos → «cambiar» vuelve a la lista
    await evalx(`(() => { const b = document.querySelector('[data-action="cambiar-persona"]'); if (b) b.click(); return !!b; })()`);
    await sleep(700);
  }
  return await waitFor(`!!document.querySelector('[data-user-picker]')`, 8000);
};

/** Entra como la persona `name` con su PIN, desde cualquier estado de la pantalla de acceso. */
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

// ── 1) la app arranca y pide acceso POR PERSONA ───────────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 14; i++) {
  if (await evalx(`!!document.querySelector('aside, [data-user-picker], input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
// Si la app RETOMÓ una sesión abierta (la sesión vive en el backend 12 h), primero se bloquea.
const enLista = await irALaLista();
check('F68: la pantalla de acceso muestra a las PERSONAS (no un PIN suelto ni el botón «Entrar como cajera»)',
  enLista, `picker=${await evalx(`!!document.querySelector('[data-user-picker]')`)}`);
check('F68: ya NO existe el botón «Entrar como cajera» (entrar es con PIN por persona)',
  !(await evalx(`[...document.querySelectorAll('button')].some(b => /Entrar como cajera/i.test(b.innerText || ''))`)));

check('F68: la base tiene las tablas `users` y `cash_movements` (migración aplicada)',
  antes.tablas === 2, `encontradas ${antes.tablas}/2`);
check('F68: al migrar nació el Master (con el PIN que ya tenía la instalación)',
  cuenta("SELECT COUNT(*) AS n FROM users WHERE role='master'") >= 1,
  JSON.stringify(filas("SELECT id, name, role, CASE WHEN COALESCE(pin_hash,'')<>'' THEN 'con PIN' ELSE 'sin PIN' END AS pin FROM users")));

// El Master ya existe; la CAJA 1 se crea si no está (fixture), limpiando lo que dejó otra corrida.
let cajaId = Number(uno("SELECT id FROM users WHERE name='Caja 1'")?.id ?? 0);
if (!cajaId) {
  const masterOk = await entrar('Master', '1234');
  check('F68: el Master entra con SU PIN', masterOk);
  if (masterOk) {
    for (const u of filas("SELECT id FROM users WHERE name LIKE 'Intruso%' OR name LIKE 'Zzz%'")) {
      await invoke('delete_user', { id: u.id }).catch(() => {});
    }
    const creada = await evalx(`(async () => {
      try { const r = await window.__TAURI_INTERNALS__.invoke('add_user', { name: 'Caja 1', role: 'caja', pin: '2468', color: '#22c55e' }); return JSON.stringify({ ok: r }); }
      catch (e) { return JSON.stringify({ err: String(e) }); }
    })()`);
    const o = JSON.parse(String(creada ?? '{}'));
    check('F68: se creó la persona «Caja 1» (rol caja, PIN propio)', !!o.ok, o.err ?? `id=${o.ok}`);
    cajaId = Number(o.ok ?? 0);
  }
}
check('F68: hay una persona con rol CAJA para probar', cajaId > 0, `Caja 1 id=${cajaId}`);

// ── 2) la CAJA entra con SU PIN, y un PIN equivocado no entra ────────────────────────────────
{
  await irALaLista();
  const entroMal = await (async () => {
    const id = await evalx(`(() => { const b = [...document.querySelectorAll('[data-user-option]')].find(x => (x.innerText || '').includes('Caja 1')); return b ? Number(b.getAttribute('data-user-option')) : null; })()`);
    if (id == null) return null;
    await clickCenter(`document.querySelector('[data-user-option="${id}"]')`);
    await sleep(600);
    await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
    await typeText('1111');
    await keyNav('Enter', 'Enter', 13);
    await sleep(1200);
    const sigueEnAcceso = await evalx(`!!document.querySelector('[data-user-picker], input[placeholder="PIN de 4 dígitos"]')`);
    const error = await evalx(`[...document.querySelectorAll('p')].some(p => /PIN incorrecto/i.test(p.innerText || ''))`);
    return { sigueEnAcceso, error };
  })();
  check('F68: un PIN equivocado NO entra (y lo dice)',
    entroMal && entroMal.sigueEnAcceso && entroMal.error, JSON.stringify(entroMal));

  const entroCaja = await entrar('Caja 1', '2468');
  check('F68: la CAJA entra con SU PIN', entroCaja);
  check('F68: la barra lateral dice QUIÉN está usando la caja (Caja 1)',
    await evalx(`/Caja 1/.test(document.querySelector('aside')?.innerText ?? '')`),
    String(await evalx(`(document.querySelector('aside')?.innerText ?? '').replace(/\\s+/g,' ').slice(0, 90)`)));
}

// ── 3) la CAJA usa el mostrador pero no ve los números del dueño ─────────────────────────────
{
  const nav = await evalx(`[...document.querySelectorAll('aside button')].map(b => (b.innerText || b.getAttribute('title') || '').trim()).filter(Boolean)`);
  const navTxt = JSON.stringify(nav);
  check('F68: la caja ve TODO el mostrador (Ventas, Servicio, Inventario, Pedidos, Clientes, Libro, Ayuda)',
    ['Ventas', 'Servicio', 'Inventario', 'Pedidos', 'Clientes', 'Libro', 'Ayuda'].every(t => navTxt.includes(t)), navTxt);
  check('F68: la caja NO tiene el Dashboard (la facturación del negocio)',
    !navTxt.includes('Dashboard'), navTxt);

  const movsCaja = await invoke('get_cash_movements', { startDate: '', endDate: '', limit: 200 });
  const nombres = [...new Set((movsCaja ?? []).map(m => m.user_name || '(sin asignar)'))];
  check('F68: el backend NO le devuelve a la caja los movimientos de otras sesiones',
    Array.isArray(movsCaja) && nombres.every(n => n === 'Caja 1' || n === '(sin asignar)'),
    `autores que ve la caja: ${JSON.stringify(nombres)}`);
}

// ── 4) la CAJA no puede lo del dueño (el gate real del backend) ──────────────────────────────
// Las sondas NO mutan nada ni cuando el gate falla ni cuando pasa: si el gate se rompiera, estos
// comandos no rompen la base ni el acceso (lección: `set_pin` sí le cambiaba el PIN al Master).
{
  const casos = [
    ['reabrir un día', 'reopen_day', { closeDate: '2020-01-01' }],
    ['borrar un cobro inexistente', 'delete_service_payment', { id: 999999 }],
    ['cargar una lista de precios', 'import_price_list', { itemsJson: '[]' }],
    ['crear personas', 'add_user', { name: 'Intruso F68', role: 'admin', pin: '1111', color: '' }],
    ['ver el resumen de plata por persona', 'get_cash_movements_by_user', { startDate: '', endDate: '' }],
  ];
  for (const [que, cmd, args] of casos) {
    const err = await invokeErr(cmd, args);
    check(`F68: la caja NO puede ${que}`, !!err && /due|Master/i.test(String(err)), String(err ?? '(¡PASÓ!)').slice(0, 90));
  }
}

// ── 5) la CAJA vende y la venta queda con SU nombre en el libro ─────────────────────────────
{
  const prod = uno("SELECT id, name, COALESCE(price_sale,0) ps FROM products WHERE COALESCE(price_sale,0)>0 AND COALESCE(stock,0)>0 ORDER BY id LIMIT 1");
  check('F68: hay un producto con stock y precio para vender de prueba', !!prod.id, JSON.stringify(prod));
  if (prod.id) {
    const r = await invoke('add_sale', {
      productId: prod.id, productName: prod.name, quantity: 1, unitPrice: prod.ps, total: prod.ps,
      paymentMethod: 'Divisas (USD Cash)', clientName: '', clientId: null, notes: 'prueba F68',
      bankFeePercent: 0, zelleReference: '', currency: 'USD', discountAmount: 0,
    }).catch(e => { check('F68: la caja puede VENDER', false, e.message); return undefined; });
    const ventaCajaId = Number(uno("SELECT id FROM sales WHERE notes='prueba F68' ORDER BY id DESC LIMIT 1")?.id ?? 0);
    check('F68: la caja PUEDE vender (es su trabajo)', r !== undefined && ventaCajaId > 0, `venta id=${ventaCajaId}`);
    if (ventaCajaId) {
      const mov = uno("SELECT * FROM cash_movements WHERE sale_id=?1 ORDER BY id DESC LIMIT 1", ventaCajaId);
      check('F68: la venta de la caja queda en el LIBRO con SU NOMBRE (autor)',
        mov?.user_name === 'Caja 1' && mov?.type === 'venta' && Number(mov?.amount) === Number(prod.ps),
        JSON.stringify(mov));
    }
  }
}

// ── 6) el Master ve todo (movimientos de las dos sesiones, resumen por persona y la pantalla) ─
{
  const entroMaster = await entrar('Master', '1234');
  check('F68: el Master entra con SU PIN', entroMaster);
  const movs = await invoke('get_cash_movements', { startDate: '', endDate: '', limit: 200 });
  const nombres = [...new Set((movs ?? []).map(m => m.user_name || '(sin asignar)'))];
  check('F68: el Master SÍ ve los movimientos de las dos sesiones (incluida la caja)',
    nombres.includes('Caja 1'), JSON.stringify(nombres));
  // El resumen lista a quien TUVIENE movimientos: en esta corrida la venta es de la Caja (el Master no
  // movió plata hoy), así que se exige que esté la Caja — que es el dato que el dueño quiere ver.
  const resumen = await invoke('get_cash_movements_by_user', { startDate: '', endDate: '' }).catch(() => null);
  check('F68: el Master tiene el resumen por persona (cuánto movió cada una)',
    Array.isArray(resumen) && resumen.some(p => p.name === 'Caja 1'), JSON.stringify(resumen));

  // La pantalla: el Master tiene el botón «Personas» y la pestaña «Movimientos» con el autor
  await evalx(`(() => { const it = [...document.querySelectorAll('aside button')].find(b => /Libro Diario/i.test(b.innerText || b.getAttribute('title') || '')); if (it) it.click(); return !!it; })()`);
  await sleep(1500);
  const hayPersonas = await evalx(`!!document.querySelector('[data-action="personas"]')`);
  check('F68: el Master tiene el botón «Personas» (solo el dueño)', hayPersonas);

  // Se abre la pestaña y se ESPERA al panel (con reintento del clic: la pestaña se repinta al montar)
  let abierto = false;
  for (let i = 0; i < 3 && !abierto; i++) {
    await evalx(`(() => { const b = document.querySelector('[data-tab="movimientos"]'); if (b) b.click(); return !!b; })()`);
    abierto = await waitFor(`/Todos los movimientos de plata|Tus movimientos de hoy/i.test(document.body.innerText || '')`, 6000);
    if (!abierto) await sleep(1000);
  }
  const hayFila = abierto && await waitFor(`!!document.querySelector('[data-movement]')`, 12000);
  // El autor está en su propia celda DENTRO de la fila (`data-movement` es la fila, `data-movement-user`
  // la celda «Quién»): leerlo de la fila devolvía null y parecía un fallo del producto.
  const autor = await evalx(`document.querySelector('[data-movement] [data-movement-user]')?.getAttribute('data-movement-user') ?? null`);
  check('F68: la pantalla de Movimientos muestra el AUTOR de cada movimiento',
    hayFila && autor != null,
    hayFila ? `autor de la primera fila: ${autor}`
      : `panel=${abierto} · filas=${await evalx(`document.querySelectorAll('[data-movement]').length`)} · cola=«${String(await evalx(`(document.body.innerText||'').replace(/\\s+/g,' ').slice(-140)`))}»`);

  if (hayPersonas) {
    await evalx(`(() => { const b = document.querySelector('[data-action="personas"]'); if (b) b.click(); return !!b; })()`);
    await sleep(1200);
    const filasUi = await evalx(`[...document.querySelectorAll('[data-user-row]')].map(r => ({ id: r.getAttribute('data-user-row'), rol: r.querySelector('[data-user-role]')?.getAttribute('data-user-role') }))`);
    check('F68: el diálogo de Personas lista al Master y a la Caja con su rol',
      Array.isArray(filasUi) && filasUi.some(u => u.rol === 'master') && filasUi.some(u => u.rol === 'caja'),
      JSON.stringify(filasUi));
    await keyNav('Escape', 'Escape', 27);
    await sleep(800);
  }
}

// ── 7) limpieza: las ventas de prueba se sacan de la copia y se restaura el stock ────────────
{
  const sobrantes = filas("SELECT id, product_id, quantity FROM sales WHERE notes='prueba F68'");
  if (sobrantes.length > 0) {
    const w = new DatabaseSync(dbPath);
    try {
      for (const v of sobrantes) {
        w.prepare('DELETE FROM cash_movements WHERE sale_id=?1').run(v.id);
        w.prepare('DELETE FROM inventory_movements WHERE reference=?1').run(`Venta #${v.id}`);
        w.prepare('DELETE FROM sales WHERE id=?1').run(v.id);
        if (v.product_id) w.prepare('UPDATE products SET stock = stock + ?1 WHERE id=?2').run(v.quantity, v.product_id);
      }
    } finally { w.close(); }
  }
  const cajaFinal = uno("SELECT id, name, role FROM users WHERE id=?1", cajaId);
  check('F68: la persona «Caja 1» queda creada en la copia (es el fixture de la prueba)',
    cajaFinal?.name === 'Caja 1' && cajaFinal?.role === 'caja', JSON.stringify(cajaFinal));
  check('F68: las ventas de prueba se sacaron de la copia (también las de una corrida anterior)',
    cuenta("SELECT COUNT(*) AS n FROM sales WHERE notes='prueba F68'") === 0,
    `restantes: ${cuenta("SELECT COUNT(*) AS n FROM sales WHERE notes='prueba F68'")} (se borraron ${sobrantes.length})`);
  check('F68: la base quedó sana', uno('PRAGMA quick_check').quick_check === 'ok');
}

db.close();
const failed = out.filter(r => !r.ok);
console.log(`\nverify_sesiones_caja: ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
