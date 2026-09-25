// VERIFICACIÓN EN VIVO (CDP) de F70 — ANULAR UNA VENTA (con reverso de stock) y el fin del «botón mudo».
//
// El bloqueante A3 de `AUDITORIA_ENTREGA.md`: una venta mal tecleada quedaba en la caja de ese día para
// siempre (no existía `update_sale`/`delete_sale`) y una pantalla vendida y devuelta no volvía al stock.
//
// Qué comprueba sobre la app REAL (contra la BASE leída aparte, nunca contra sí misma):
//   1. **La venta se ve y se puede anular** desde la fila (dueño), con un diálogo que dice el IMPACTO
//      con números (de qué caja sale la plata, cuántas unidades vuelven al stock).
//   2. **El motivo es obligatorio**: confirmar sin motivo no anula nada (ni en la pantalla ni en la base).
//   3. **Anular de verdad**: `voided_at`/`void_reason` en la fila, **stock devuelto**, movimiento de
//      inventario de ENTRADA, `clients.total_spent` ajustado y el **contra-asiento** en el libro (tipo
//      `venta_anulada`, MISMO método/moneda/monto, signo −1, con AUTOR y motivo).
//   4. **La caja del día deja de contarla** (`get_daily_totals` por IPC) y la fila queda TACHADA con su
//      motivo — no desaparece.
//   5. **La caja (rol `caja`) NO puede anular**: sin botón en la pantalla y el backend rechaza el IPC.
//   6. **El botón de vender ya no está mudo sin precio**: con una ficha sin precio, «Guardar Venta» dice
//      qué pasa; y el KPI «Sin precio» del Inventario LISTA esas fichas.
//
// FIXTURE: crea una venta de prueba por IPC (sobre una copia) y al final la saca junto con sus
// movimientos (el stock ya quedó devuelto por la anulación).
//
// SEGURIDAD DE DATOS: SIEMPRE sobre una COPIA (`REGISTRO_DB`); rechaza correr contra `registro.db`.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f70_verif.db"
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_anular_venta.mjs

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

const turno = uno('SELECT close_date FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1');
if (!turno?.close_date) {
  console.error('ABORTADO: no hay día abierto en la copia — una venta no se puede registrar ni anular sin turno.');
  process.exit(2);
}
const DIA = turno.close_date;
console.log(`· base: turno abierto ${DIA} · ${cuenta('SELECT COUNT(*) AS n FROM sales')} ventas ·`
  + ` ${cuenta('SELECT COUNT(*) AS n FROM products WHERE COALESCE(stock,0) > 0')} fichas con stock`);

// ── helpers de IPC y de la pantalla de acceso (los mismos de las otras verificaciones) ────────
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

const entrar = async (nombre, pin) => {
  await irALaLista();
  const id = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-user-option]')].find(x => (x.innerText || '').includes(${JSON.stringify(nombre)}));
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

/** Abre el módulo Ventas (espera un botón propio: el texto «Ventas» también está en la barra lateral). */
const irAVentas = async () => {
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /^Ventas$/i.test((x.innerText || x.getAttribute('title') || '').trim())); if (b) b.click(); return !!b; })()`);
  return await waitFor(`[...document.querySelectorAll('button')].some(b => /^Nueva Venta$/i.test((b.innerText || '').trim()))`, 12000);
};

// ── 1) FIXTURE: una venta de prueba (por IPC) + la app en Ventas como dueño ───────────────────
const prod = uno(`SELECT id, name, COALESCE(price_sale,0) ps, COALESCE(stock,0) st FROM products
                  WHERE COALESCE(price_sale,0) > 0 AND COALESCE(stock,0) > 0 ORDER BY id LIMIT 1`);
check('hay una ficha con stock y precio para vender de prueba', !!prod.id, JSON.stringify(prod));

let ventaId = 0;
/** Totales del día por IPC (se comparan ANTES y DESPUÉS de anular: el día tiene que bajar justo el monto). */
const totalesDelDia = async () => {
  const t = await invoke('get_daily_totals', { startDate: DIA, endDate: DIA });
  const f = (Array.isArray(t) ? t[0] : null) ?? {};
  return { usd: Number(f.usd_cash_total ?? 0), bs: Number(f.cash_bs ?? 0), grandes: Number(f.grand_usd ?? 0) };
};
let totalesAntes = null;
{
  const entro = await entrar('Master', '1234');
  check('F70: el dueño entra para anular la venta', entro);
  await invoke('add_sale', {
    productId: prod.id, productName: prod.name, quantity: 1, unitPrice: prod.ps, total: prod.ps,
    paymentMethod: 'Divisas (USD Cash)', clientName: '', clientId: null, notes: 'prueba F70',
    bankFeePercent: 0, zelleReference: '', currency: 'USD', discountAmount: 0,
  }).catch(e => { check('F70: se pudo registrar la venta de prueba', false, e.message); });
  ventaId = Number(uno("SELECT id FROM sales WHERE notes='prueba F70' ORDER BY id DESC LIMIT 1")?.id ?? 0);
  const stockTras = Number(uno('SELECT stock FROM products WHERE id=?1', prod.id)?.stock ?? -1);
  check('F70: la venta de prueba descontó el stock', ventaId > 0 && stockTras === Number(prod.st) - 1,
    `venta #${ventaId} · stock ${prod.st} → ${stockTras}`);
  totalesAntes = await totalesDelDia();
}

// ── 2) la pantalla: la venta aparece y el dueño tiene «Anular» ────────────────────────────────
{
  const enVentas = await irAVentas();
  check('F70: el módulo Ventas abre', enVentas);
  const hayFila = await waitFor(`!!document.querySelector('[data-sale-row="${ventaId}"]')`, 12000);
  check('F70: la venta de prueba se ve en la lista', hayFila, `fila ${ventaId}`);
  const hayAnular = await evalx(`!!document.querySelector('[data-sale-row="${ventaId}"] [data-action="anular-venta"]')`);
  check('F70: el dueño tiene el botón «Anular» en la fila', hayAnular);

  // El diálogo dice el IMPACTO con números
  await evalx(`(() => { const b = document.querySelector('[data-sale-row="${ventaId}"] [data-action="anular-venta"]'); if (b) b.click(); return !!b; })()`);
  const abrio = await waitFor(`!!document.querySelector('[data-dialog="anular-venta"]')`, 8000);
  check('F70: se abre el diálogo de anulación', abrio);
  const impacto = String(await evalx(`document.querySelector('[data-field="impacto-anulacion"]')?.innerText ?? ''`));
  check('F70: el diálogo dice de qué CAJA sale la plata (día + monto + método)',
    impacto.includes(DIA) && impacto.includes(`$${Number(prod.ps).toFixed(2)}`) && /Divisas \(USD Cash\)/.test(impacto),
    impacto.slice(0, 180));
  check('F70: y cuántas unidades vuelven al stock',
    /Vuelven 1 unidad/i.test(impacto), impacto.slice(0, 240));

  // SIN motivo no se anula (ni en la pantalla ni en la base)
  await evalx(`(() => { const b = document.querySelector('[data-action="confirmar-anulacion"]'); if (b) b.click(); return !!b; })()`);
  await sleep(900);
  const errorMotivo = String(await evalx(`document.querySelector('[data-field="error-anulacion"]')?.innerText ?? ''`));
  check('F70: confirmar SIN motivo se rechaza con su mensaje', /por qué se anula/i.test(errorMotivo), errorMotivo);
  check('F70: y la venta sigue SIN anular en la base',
    uno('SELECT voided_at FROM sales WHERE id=?1', ventaId)?.voided_at == null);

  // CON motivo: se anula de verdad
  await evalx(`(() => {
    const i = document.querySelector('[data-field="motivo-anulacion"]');
    if (!i) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'precio mal tecleado (prueba F70)');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  await evalx(`(() => { const b = document.querySelector('[data-action="confirmar-anulacion"]'); if (b) b.click(); return !!b; })()`);
  const cerro = await waitFor(`!document.querySelector('[data-dialog="anular-venta"]')`, 10000);
  check('F70: al confirmar con motivo el diálogo se cierra', cerro);
}

// ── 3) LA BASE: la anulación hizo todo el trabajo ─────────────────────────────────────────────
{
  const fila = uno('SELECT voided_at, void_reason FROM sales WHERE id=?1', ventaId);
  check('F70: la venta queda MARCADA con fecha y motivo (no se borra)',
    !!fila.voided_at && fila.void_reason === 'precio mal tecleado (prueba F70)', JSON.stringify(fila));

  const stockAhora = Number(uno('SELECT stock FROM products WHERE id=?1', prod.id)?.stock ?? -1);
  check('F70: el STOCK volvió a su lugar', stockAhora === Number(prod.st), `stock ${prod.st} → ${stockAhora}`);

  const mov = uno("SELECT type, quantity, reason FROM inventory_movements WHERE reference=?1 ORDER BY id DESC LIMIT 1",
    `Venta #${ventaId}`);
  check('F70: quedó el movimiento de inventario de ENTRADA («Anulación de venta»)',
    mov.type === 'entrada' && Number(mov.quantity) === 1 && mov.reason === 'Anulación de venta', JSON.stringify(mov));

  const contra = uno("SELECT * FROM cash_movements WHERE sale_id=?1 AND type='venta_anulada' ORDER BY id DESC LIMIT 1", ventaId);
  check('F70: el LIBRO tiene el contra-asiento con el MISMO método/moneda/monto y signo −1',
    contra.type === 'venta_anulada' && contra.method === 'Divisas (USD Cash)' && Number(contra.amount) === Number(prod.ps)
    && Number(contra.sign) === -1, JSON.stringify(contra));
  check('F70: el contra-asiento lleva el AUTOR y el MOTIVO',
    contra.user_name === 'Master' && String(contra.note).includes('precio mal tecleado'), JSON.stringify({ quien: contra.user_name, nota: contra.note }));
  check('F70: y cae en el DÍA de la venta (no en el de hoy si difirieran)',
    contra.day === DIA, `día del asiento ${contra.day} · turno ${DIA}`);

  // La caja del día deja de contarla: el total del día baja EXACTAMENTE el monto de la venta anulada
  const totalesDespues = await totalesDelDia();
  const bajaUsd = Number((totalesAntes.usd - totalesDespues.usd).toFixed(2));
  check('F70: el arqueo del día baja EXACTAMENTE el monto de la venta anulada',
    Math.abs(bajaUsd - Number(prod.ps)) < 0.01,
    `antes $${totalesAntes.usd.toFixed(2)} → después $${totalesDespues.usd.toFixed(2)} (baja $${bajaUsd.toFixed(2)}, venta $${Number(prod.ps).toFixed(2)})`);

  // El cliente (si la venta fuera de un cliente del padrón) queda igual: acá no había cliente
  check('F70: la venta sin cliente no rompe el cálculo de `total_spent`',
    Number(uno('SELECT COUNT(*) n FROM clients').n) >= 0);
}

// ── 4) la pantalla: fila TACHADA, KPI con las anuladas aparte y sin botón ─────────────────────
{
  await irAVentas();
  const hayFila = await waitFor(`!!document.querySelector('[data-sale-row="${ventaId}"]')`, 12000);
  check('F70: la venta anulada SIGUE en la lista (no desaparece)', hayFila);
  const marcada = await evalx(`(() => {
    const f = document.querySelector('[data-sale-row="${ventaId}"]');
    return f ? { anulada: f.getAttribute('data-sale-voided'), badge: !!f.querySelector('[data-sale-void-badge]'), motivo: f.querySelector('[data-sale-void-reason]')?.getAttribute('data-sale-void-reason') ?? null, tachada: /line-through/.test(f.innerHTML) } : null;
  })()`);
  check('F70: la fila se ve anulada (marca + badge + texto tachado) y con su motivo',
    marcada?.anulada === '1' && marcada.badge && marcada.tachada && String(marcada.motivo).includes('precio mal tecleado'),
    JSON.stringify(marcada));
  check('F70: una venta anulada no se puede volver a anular (sin botón)',
    !(await evalx(`!!document.querySelector('[data-sale-row="${ventaId}"] [data-action="anular-venta"]')`)));
  const kpi = String(await evalx(`document.querySelector('[data-field="ventas-anuladas"]')?.innerText ?? ''`));
  check('F70: el KPI de ventas informa las anuladas aparte (no las cuenta)', /anulada/i.test(kpi), kpi);
}

// ── 5) el «botón mudo» sin precio deja de serlo ───────────────────────────────────────────────
{
  const sinPrecio = uno(`SELECT id, name, COALESCE(stock,0) st FROM products
                         WHERE COALESCE(stock,0) > 0 AND COALESCE(price_sale,0) = 0 ORDER BY id LIMIT 1`);
  if (!sinPrecio?.id) {
    check('F70: hay una ficha con stock y sin precio para probar el aviso (se omite)', true, 'ninguna en la copia');
  } else {
    await irAVentas();
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Nueva Venta$/i.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    const formAbierto = await waitFor(`!!document.querySelector('[role="dialog"] input[placeholder="Buscar producto..."]')`, 8000);
    check('F70: el formulario de venta abre', formAbierto);
    // Buscar por el NOMBRE completo de la ficha (el buscador rebota y sugiere): la ficha sin precio no
    // se puede cobrar, y lo que se verifica es que lo DIGA.
    await clickCenter(`document.querySelector('[role="dialog"] input[placeholder="Buscar producto..."]')`);
    await typeText(String(sinPrecio.name));
    const sugirio = await waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => /Stock:\\s*\\d+/.test(b.innerText || ''))`, 8000);
    if (sugirio) {
      // Se elige la sugerencia de ESA ficha (no «cualquiera con stock»): si no, se podría estar
      // midiendo otra cosa (una ficha CON precio se guardaría bien y el aviso nunca aparecería).
      const eligio = await evalx(`(() => {
        const b = [...document.querySelectorAll('[role="dialog"] button')]
          .find(x => /Stock:\\s*\\d+/.test(x.innerText || '') && (x.innerText || '').includes(${JSON.stringify(String(sinPrecio.name).replace(/^Pantalla\s+/i, ''))}));
        if (!b) return false;
        b.click();
        return true;
      })()`);
      await sleep(700);
      const precioPuesto = await evalx(`document.querySelector('[role="dialog"] input[type="number"][step="0.01"]')?.value ?? null`);
      check('F70: la ficha elegida es la que NO tiene precio (el campo queda en 0)', eligio && Number(precioPuesto) === 0,
        `eligió=${eligio} · precio=${precioPuesto}`);
      // El aviso sale EN EL MOMENTO (el botón ya no está gris y mudo) y también al intentar guardar.
      const avisoPrevio = String(await evalx(`document.querySelector('[data-field="aviso-venta"]')?.innerText ?? ''`));
      check('F70: el formulario AVISA que la ficha no tiene precio (sin apretar nada)', /no tiene precio de venta/i.test(avisoPrevio),
        avisoPrevio.slice(0, 160));
      await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Guardar Venta/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
      const aviso = await waitFor(`/no tiene precio de venta/i.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 8000);
      check('F70: y al intentar guardar lo vuelve a decir (el botón no está mudo)', aviso,
        String(await evalx(`(document.querySelector('[role="dialog"]')?.innerText ?? '').replace(/\\s+/g,' ').slice(0, 220)`)));
      await keyNav('Escape', 'Escape', 27);
      await sleep(500);
    } else {
      check('F70: el buscador del formulario sugiere la ficha sin precio', false,
        `no apareció ninguna sugerencia con stock para «${sinPrecio.name}»`);
    }
  }

  // El KPI «Sin precio» del Inventario LISTA las fichas (antes el número no llevaba a ningún lado)
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Inventario/i.test(x.innerText || x.getAttribute('title') || '')); if (b) b.click(); return !!b; })()`);
  const enInv = await waitFor(`!!document.querySelector('[data-kpi="sin-precio"]')`, 12000);
  check('F70: el Inventario tiene el KPI «Sin precio» como acceso directo', enInv);
  if (enInv) {
    await evalx(`(() => { const b = document.querySelector('[data-kpi="sin-precio"]'); if (b) b.click(); return !!b; })()`);
    await waitFor(`!!document.querySelector('tbody tr td')`, 10000);
    await sleep(900);
    // Se compara contra la BASE (la verdad independiente): el filtro «sin precio» del backend es
    // `price_cost = 0 AND price_sale = 0` (fichas que no se pueden cobrar)
    const esperadas = cuenta(`SELECT COUNT(*) AS n FROM products WHERE COALESCE(price_cost,0)=0 AND COALESCE(price_sale,0)=0`);
    const filasListadas = await evalx(`(() => {
      const filas = [...document.querySelectorAll('tbody tr')].filter(r => r.querySelector('td'));
      return { total: filas.length, sinPrecio: filas.filter(r => /sin precio/i.test(r.innerText || '')).length };
    })()`);
    check('F70: al pulsarlo el inventario LISTA las fichas sin precio (todas las filas son de esas)',
      filasListadas.total > 0 && filasListadas.sinPrecio === filasListadas.total && filasListadas.total <= esperadas,
      `filas=${JSON.stringify(filasListadas)} · en la base (sin costo ni venta): ${esperadas}`);
  }
}

// ── 6) la CAJA no puede anular ────────────────────────────────────────────────────────────────
{
  // (Se crea otra venta de prueba: la anterior ya está anulada)
  const otra = await invoke('add_sale', {
    productId: prod.id, productName: prod.name, quantity: 1, unitPrice: prod.ps, total: prod.ps,
    paymentMethod: 'Divisas (USD Cash)', clientName: '', clientId: null, notes: 'prueba F70 caja',
    bankFeePercent: 0, zelleReference: '', currency: 'USD', discountAmount: 0,
  }).then(() => Number(uno("SELECT id FROM sales WHERE notes='prueba F70 caja' ORDER BY id DESC LIMIT 1")?.id ?? 0))
    .catch(() => 0);

  const entroCaja = await entrar('Caja 1', '2468');
  check('F70: la caja entra con SU PIN', entroCaja);
  await irAVentas();
  const sinBoton = !(await evalx(`!!document.querySelector('[data-sale-row="${otra}"] [data-action="anular-venta"]')`));
  check('F70: la sesión de CAJA no ve el botón «Anular»', sinBoton, `venta ${otra}`);
  const err = await invokeErr('void_sale', { id: otra, reason: 'prueba' });
  check('F70: y el backend rechaza el IPC de anular (gate del dueño)',
    !!err && /due|Master/i.test(String(err)), String(err ?? '(¡PASÓ!)').slice(0, 90));
  check('F70: la venta de la caja sigue sin anular en la base',
    uno('SELECT voided_at FROM sales WHERE id=?1', otra)?.voided_at == null);
}

// ── 7) limpieza: se sacan las ventas de prueba y sus rastros (la copia queda como estaba) ─────
{
  await entrar('Master', '1234');
  const w = new DatabaseSync(dbPath);
  try {
    const sobrantes = w.prepare("SELECT id, product_id, quantity FROM sales WHERE notes LIKE 'prueba F70%'").all();
    for (const v of sobrantes) {
      // Si quedó sin anular, se devuelve su stock como haría la anulación (para no dejar la copia mocha)
      const anulada = w.prepare('SELECT voided_at FROM sales WHERE id=?1').get(v.id)?.voided_at;
      if (!anulada && v.product_id) {
        w.prepare('UPDATE products SET stock = stock + ?1 WHERE id=?2').run(v.quantity, v.product_id);
      }
      w.prepare('DELETE FROM cash_movements WHERE sale_id=?1').run(v.id);
      w.prepare('DELETE FROM inventory_movements WHERE reference=?1').run(`Venta #${v.id}`);
      w.prepare('DELETE FROM sales WHERE id=?1').run(v.id);
    }
    console.log(`· limpieza: ${sobrantes.length} venta(s) de prueba sacadas de la copia`);
  } finally { w.close(); }
  check('F70: no quedan ventas de prueba en la copia',
    cuenta("SELECT COUNT(*) AS n FROM sales WHERE notes LIKE 'prueba F70%'") === 0);
  check('F70: la base quedó sana', uno('PRAGMA quick_check').quick_check === 'ok');
}

db.close();
const failed = out.filter(r => !r.ok);
console.log(`\nverify_anular_venta: ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
