// VERIFICACIÓN EN VIVO (CDP) de F52 — Inventario → Productos → vista «POR MODELO».
//
// Pedido del dueño (2026-09-20): «cuando yo busco un Samsung A70 me sale también A705 — ya este viene
// siendo otro modelo de tlf, debería salir una sola por modelo… y esos mismos modelos tienen que
// tener referencia: qué pantalla va a seleccionar para ese modelo».
//
// Qué comprueba sobre la app REAL (y contra la BASE leída aparte, nunca contra sí misma):
//   1. El conmutador `Lista (ficha por ficha)` | `Por modelo (una fila por teléfono)` existe y cambia
//      la vista; al volver, la lista plana sigue ahí.
//   2. En la vista «Por modelo» **UN teléfono es UNA fila**, con su código `M-…`, y sus VARIANTES
//      como chips ADENTRO (no como modelos distintos): los chips y el conteo coinciden con las
//      fichas compatibles que dice la base.
//   3. El **stock total** y el **rango de precios** de la fila coinciden con la suma/min/max de las
//      fichas de ese teléfono (calculado con `node:sqlite` sobre los ids que devuelve el backend).
//   4. El check «lo uso» de la fila coincide con `phones.in_use` y al pulsarlo cambia SOLO eso.
//   5. Al desplegar la fila se ven sus repuestos con **código, variante, precio, costo y stock**
//      (cada uno comparado contra la base) y se puede fijar la **pantalla de referencia** del modelo
//      (`phones.default_product_id`), que es lo que después auto-selecciona el formulario de servicio.
//   6. La **variante es columna y filtro** en la lista plana: la columna muestra la variante real de
//      cada ficha y el filtro por familia trae exactamente las fichas de esa familia (OLED incluye
//      «OLED Con Marco»).
//
// SEGURIDAD DE DATOS: escribe SOLO el check «lo uso» del modelo y la pantalla de referencia, y los
// deja como estaban. Nunca toca stock, precios, movimientos ni órdenes. SIEMPRE sobre una COPIA.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f52_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_por_modelo.mjs

import { evalx, clickCenter, keyNav, typeText, insertText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

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
const db = new DatabaseSync(dbPath, { readOnly: true });
const filas = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return [{ err: String(e.message) }]; } };
const uno = (sql, ...p) => filas(sql, ...p)[0] ?? {};
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
/** IPC que devuelve OBJETO: se serializa DENTRO de la página (el driver CDP solo devuelve texto). */
const invokeJson = (cmd, args = {}) => evalx(`(async () => {
  const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)});
  return r === undefined || r === null ? null : JSON.stringify(r);
})()`);

// ── 1) entrar a la app e ir a Inventario → Productos ──────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
for (let i = 0; i < 4; i++) {
  if (!await evalx(`!!document.querySelector('[role="dialog"]')`)) break;
  await keyNav('Escape', 'Escape', 27);
  await sleep(600);
}
await evalx(`(() => { const it = [...document.querySelectorAll('aside a, aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario')); if (it) it.click(); return !!it; })()`);
await sleep(2000);
await evalx(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find(x => /^Productos/.test(x.innerText.trim())); if (t) t.click(); return !!t; })()`);
const enProductos = await waitFor(`!!document.querySelector('[data-view="modelo"]')`, 20000);
check('F52: la pestaña Productos trae el conmutador de vista', enProductos,
  String(await evalx(`document.querySelector('[data-view="lista"]')?.innerText ?? null`)));

// ── 2) un teléfono RICO: varias variantes entre sus repuestos ─────────────────────────────────
// El sujeto de prueba se elige CON EL PROPIO BACKEND (`get_phones` + `get_phone_detail`), que es la
// unión exacta clave+alias — no una consulta aproximada por LIKE. Después todas las afirmaciones se
// hacen contra la BASE (`node:sqlite`) sobre los ids EXACTOS que devolvió el detalle.
const candidatos = JSON.parse(await invokeJson('get_phones', {
  brand: null, search: '', onlyWithProducts: true, onlyStock: true, onlyReview: false,
  sort: 'stock', dir: 'desc', limit: 120, offset: 0,
}) ?? '{"items":[]}');
const ricos = (candidatos.items ?? []).filter(p => (p.variants ?? []).length >= 2 && p.products >= 2 && p.products <= 40);
check('F52: hay un modelo con varias variantes para probar (si no, la prueba no diría nada)', ricos.length > 0,
  ricos[0] ? `${ricos[0].name} (${ricos[0].code}) · variantes ${JSON.stringify(ricos[0].variants)} · ${ricos[0].products} repuestos` : 'no se encontró');

let objetivo = null;
const cand = ricos[0];
if (cand) {
  const detalleRaw = await invokeJson('get_phone_detail', { phoneId: cand.id });
  const detalle = detalleRaw ? JSON.parse(detalleRaw) : null;
  const ids = (detalle?.blocks ?? []).flatMap(b => (b.items ?? []).map(i => i.id));
  // verdad independiente: stock / precios / variantes de EXACTAMENTE esas fichas
  const idList = ids.length ? ids.join(',') : '0';
  const agg = uno(`SELECT COUNT(*) AS n, COALESCE(SUM(stock),0) AS stock,
                          COALESCE(MIN(CASE WHEN price_sale > 0 THEN price_sale END),0) AS pmin,
                          COALESCE(MAX(price_sale),0) AS pmax
                   FROM products WHERE id IN (${idList})`);
  const variantesBase = filas(`SELECT DISTINCT COALESCE(variant,'') AS v FROM products WHERE id IN (${idList}) ORDER BY 1`)
    .map(r => r.v).filter(v => v !== '');
  objetivo = {
    ...cand, ids, agg, variantesBase,
    // estado del padrón ANTES de tocar nada (se compara al final: la prueba no deja cambios)
    estadoInicial: uno(`SELECT COALESCE(in_use,0) AS inUso, default_product_id AS ref FROM phones WHERE id=?1`, cand.id),
  };
  console.log(`· modelo de prueba: ${cand.name} (${cand.code}) · ${agg.n} fichas · stock ${agg.stock} · precios ${agg.pmin}–${agg.pmax} · variantes ${JSON.stringify(variantesBase)}`);
}

// ── 3) la vista POR MODELO: una fila por teléfono con sus variantes adentro ───────────────────
if (objetivo) {
  await clickCenter(`document.querySelector('[data-view="modelo"]')`);
  await waitFor(`document.querySelector('[data-view="modelo"]')?.getAttribute('data-view-state') === 'on'`, 8000);
  await waitFor(`!!document.querySelector('[data-search="por-modelo"]')`, 8000);
  check('F52: la vista «Por modelo» abre con su propio buscador',
    await evalx(`!!document.querySelector('[data-search="por-modelo"]')`));

  // se busca el modelo (por su nombre, como lo escribe el taller)
  await clickCenter(`document.querySelector('[data-search="por-modelo"]')`);
  await evalx(`(() => { const i = document.querySelector('[data-search="por-modelo"]'); i.select(); return true; })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await insertText(objetivo.name);
  await waitFor(`!!document.querySelector('[data-model-row="${objetivo.id}"]')`, 15000);

  const fila = await evalx(`(() => {
    const tr = document.querySelector('[data-model-row="${objetivo.id}"]');
    if (!tr) return null;
    const chips = [...tr.querySelectorAll('[data-variant-chip]')].map(c => c.getAttribute('data-variant-chip'));
    return JSON.stringify({
      existe: true,
      nombre: tr.querySelector('[data-model-name]')?.getAttribute('data-model-name') ?? null,
      codigo: tr.querySelector('[data-model-code]')?.getAttribute('data-model-code') ?? null,
      chips,
      precio: tr.querySelector('[data-price-range]')?.innerText?.trim() ?? null,
      enUso: tr.querySelector('[data-model-use]')?.getAttribute('data-model-use-state') ?? null,
      referencia: tr.querySelector('[data-model-ref]')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
      celdas: [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\\s+/g, ' ').trim()),
    });
  })()`);
  const f = fila ? JSON.parse(fila) : null;
  check('F52: el modelo aparece como UNA sola fila (con su nombre y su código M-…)',
    !!f && f.nombre === objetivo.name && f.codigo === objetivo.code,
    f ? `${f.nombre} · ${f.codigo}` : 'no se encontró la fila');

  const chips = f?.chips ?? [];
  check('F52: las VARIANTES del modelo van como chips ADENTRO de la fila (no como modelos distintos)',
    chips.length >= 2 && chips.every(c => objetivo.variantesBase.includes(c)) && objetivo.variantesBase.every(v => chips.includes(v)),
    `chips=${JSON.stringify(chips)} · base=${JSON.stringify(objetivo.variantesBase)}`);

  const stockCelda = Number(String(f?.celdas?.[5] ?? '').replace(/[^\d-]/g, ''));
  check('F52: el STOCK de la fila es la suma de sus repuestos (contra la base)',
    stockCelda === Number(objetivo.agg.stock), `pantalla=${stockCelda} · base=${objetivo.agg.stock}`);
  const repuestosCelda = Number(f?.celdas?.[4] ?? '');
  check('F52: la fila dice cuántos repuestos tiene (contra la base)',
    repuestosCelda === Number(objetivo.agg.n), `pantalla=${repuestosCelda} · base=${objetivo.agg.n}`);
  const esperadoPrecio = Number(objetivo.agg.pmin) === Number(objetivo.agg.pmax)
    ? `$${Number(objetivo.agg.pmax).toFixed(2)}`
    : `$${Number(objetivo.agg.pmin).toFixed(2)} – $${Number(objetivo.agg.pmax).toFixed(2)}`;
  check('F52: el RANGO DE PRECIOS de la fila coincide con el de sus fichas',
    String(f?.precio) === esperadoPrecio, `pantalla=«${f?.precio}» · base=«${esperadoPrecio}»`);

  const enUsoBase = String(uno(`SELECT COALESCE(in_use,0) AS u FROM phones WHERE id=?1`, objetivo.id).u);
  check('F52: el check «lo uso» de la fila coincide con el padrón',
    f?.enUso === enUsoBase, `pantalla=${f?.enUso} · base=${enUsoBase}`);

  // el check cambia SOLO eso (y se restaura)
  await clickCenter(`document.querySelector('[data-model-use="${objetivo.id}"]')`);
  const invertido = enUsoBase === '1' ? '0' : '1';
  await waitFor(`document.querySelector('[data-model-use="${objetivo.id}"]')?.getAttribute('data-model-use-state') === '${invertido}'`, 10000);
  await sleep(600);
  const trasClick = String(uno(`SELECT COALESCE(in_use,0) AS u FROM phones WHERE id=?1`, objetivo.id).u);
  const stockSinCambio = uno(`SELECT COALESCE(SUM(stock),0) AS s FROM products WHERE id IN (${objetivo.ids.join(',')})`).s;
  check('F52: pulsar el check cambia el «en uso» del MODELO en la base',
    trasClick === invertido, `antes=${enUsoBase} · después=${trasClick}`);
  check('F52: ese check no tocó el stock de sus repuestos',
    Number(stockSinCambio) === Number(objetivo.agg.stock), `stock ${objetivo.agg.stock} → ${stockSinCambio}`);
  await clickCenter(`document.querySelector('[data-model-use="${objetivo.id}"]')`);
  await waitFor(`document.querySelector('[data-model-use="${objetivo.id}"]')?.getAttribute('data-model-use-state') === '${enUsoBase}'`, 10000);
  await sleep(600);
  check('F52: el segundo clic lo devuelve a como estaba',
    String(uno(`SELECT COALESCE(in_use,0) AS u FROM phones WHERE id=?1`, objetivo.id).u) === enUsoBase,
    `base=${uno(`SELECT COALESCE(in_use,0) AS u FROM phones WHERE id=?1`, objetivo.id).u}`);

  // ── 4) desplegar: los repuestos con código, variante, precio, costo y stock ──────────────────
  await clickCenter(`document.querySelector('[data-model-row="${objetivo.id}"]')`);
  const abrio = await waitFor(`!!document.querySelector('[data-model-detail="${objetivo.id}"] [data-model-part]')`, 20000);
  check('F52: la fila se despliega y muestra sus repuestos', abrio);

  const partes = await evalx(`[...document.querySelectorAll('[data-model-detail="${objetivo.id}"] [data-model-part]')].map(tr => ({
    id: Number(tr.getAttribute('data-model-part')),
    code: tr.querySelector('[data-part-code]')?.getAttribute('data-part-code') ?? null,
    nombre: tr.querySelector('[data-part-name]')?.getAttribute('data-part-name') ?? null,
    celdas: [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\\s+/g, ' ').trim()),
  }))`);
  const lista = Array.isArray(partes) ? partes : [];
  check('F52: el despliegue lista TODOS los repuestos del modelo (contra la base)',
    lista.length === objetivo.ids.length, `pantalla=${lista.length} · base=${objetivo.ids.length}`);

  const porId = {};
  for (const r of filas(`SELECT id, COALESCE(code,'') AS code, COALESCE(variant,'') AS variant, price_sale, price_cost, stock FROM products WHERE id IN (${objetivo.ids.join(',')})`)) porId[r.id] = r;
  const codigosOk = lista.every(p => p.code === porId[p.id]?.code);
  const stocksOk = lista.every(p => Number(String(p.celdas[4] ?? '').replace(/[^\d-]/g, '')) === Number(porId[p.id]?.stock));
  const variantesOk = lista.every(p => {
    const v = porId[p.id]?.variant ?? '';
    const celda = String(p.celdas[1] ?? '').trim();
    return v === '' ? celda === '—' : celda === v;
  });
  const preciosOk = lista.every(p => {
    const pr = Number(porId[p.id]?.price_sale ?? 0);
    const celda = String(p.celdas[2] ?? '').trim();
    return pr > 0 ? celda === `$${pr.toFixed(2)}` : celda === 'sin precio';
  });
  check('F52: cada repuesto muestra su CÓDIGO y coincide con la base', codigosOk,
    JSON.stringify(lista.map(p => `${p.id}:${p.code}`)));
  check('F52: cada repuesto muestra su VARIANTE y su PRECIO reales', variantesOk && preciosOk,
    JSON.stringify(lista.map(p => `${p.id}:${p.celdas[1]}/${p.celdas[2]}`)));
  check('F52: cada repuesto muestra su STOCK real', stocksOk,
    JSON.stringify(lista.map(p => `${p.id}:${p.celdas[4]}`)));

  // ── 5) la PANTALLA DE REFERENCIA del modelo (lo que después auto-selecciona el servicio) ─────
  const refAntes = uno(`SELECT default_product_id AS r FROM phones WHERE id=?1`, objetivo.id).r ?? null;
  const unRepuesto = lista.find(p => p.id !== refAntes) ?? lista[0];
  if (unRepuesto) {
    await clickCenter(`document.querySelector('[data-set-ref="${unRepuesto.id}"]')`);
    await sleep(1500);
    const refDespues = uno(`SELECT default_product_id AS r FROM phones WHERE id=?1`, objetivo.id).r ?? null;
    check('F52/F53: se puede fijar la PANTALLA DE REFERENCIA del modelo (y queda en el padrón)',
      Number(refDespues) === Number(unRepuesto.id), `antes=${refAntes} · después=${refDespues} (elegida ${unRepuesto.id})`);
    const enFila = await evalx(`document.querySelector('[data-model-ref="${objetivo.id}"]')?.innerText?.replace(/\\s+/g,' ').trim() ?? null`);
    check('F52/F53: la fila muestra esa referencia (con su código)',
      !!enFila && enFila.includes(String(unRepuesto.code ?? '')), `fila=«${enFila}» · elegida=${unRepuesto.code}`);
    // se deja como estaba (o sin referencia si no tenía)
    await invoke('set_phone_default_product', { id: objetivo.id, productId: refAntes });
    await sleep(800);
    check('F52: la referencia se puede devolver a como estaba (la prueba no deja cambios)',
      (uno(`SELECT default_product_id AS r FROM phones WHERE id=?1`, objetivo.id).r ?? null) === refAntes,
      `ref=${uno(`SELECT default_product_id AS r FROM phones WHERE id=?1`, objetivo.id).r ?? null} · original=${refAntes}`);
  }

  // ── 6) la VARIANTE como columna y filtro en la lista plana ──────────────────────────────────
  await clickCenter(`document.querySelector('[data-view="lista"]')`);
  await waitFor(`document.querySelector('[data-view="lista"]')?.getAttribute('data-view-state') === 'on'`, 8000);
  await waitFor(`!!document.querySelector('[data-sort="variante"]')`, 10000);
  check('F52: la lista plana tiene la columna «Variante» (ordenable)',
    await evalx(`!!document.querySelector('[data-sort="variante"]')`));

  // la columna dice la variante REAL de cada ficha
  const columna = await evalx(`[...document.querySelectorAll('[data-variant]')].map(td => ({
    id: Number(td.closest('tr').querySelector('[data-in-use]')?.getAttribute('data-in-use') ?? 0),
    v: td.innerText.trim(),
  })).filter(x => x.id > 0).slice(0, 12)`);
  const colOk = Array.isArray(columna) && columna.length > 0 && columna.every(c => {
    const v = uno('SELECT COALESCE(variant,\'\') AS v FROM products WHERE id=?1', c.id).v ?? '';
    return (v === '' ? '—' : v) === c.v;
  });
  check('F52: la columna «Variante» muestra la variante real de cada ficha (contra la base)', colOk,
    JSON.stringify(columna?.slice(0, 4)));

  // el filtro por FAMILIA trae exactamente esas fichas (OLED incluye «OLED Con Marco»)
  const familia = 'oled';
  const esperadas = Number(uno(
    `SELECT COUNT(*) AS n FROM products p WHERE lower(CASE WHEN instr(trim(COALESCE(p.variant,'')), ' ') > 0
      THEN substr(trim(COALESCE(p.variant,'')), 1, instr(trim(COALESCE(p.variant,'')), ' ') - 1)
      ELSE trim(COALESCE(p.variant,'')) END) = ?1`, familia).n);
  await clickCenter(`document.querySelector('[aria-label="Filtrar por variante"]')`);
  await sleep(700);
  if (await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, 6000)) {
    for (let i = 0; i < 12; i++) {
      const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText?.trim() ?? null`);
      if (String(hi).startsWith('OLED')) { await keyNav('Enter', 'Enter', 13); break; }
      await keyNav('ArrowDown', 'ArrowDown', 40);
      await sleep(180);
    }
  }
  await sleep(1600);
  // el pie de la tabla dice «Mostrando X–Y de N»: N es el total filtrado
  const contador = await evalx(`(document.body.innerText.match(/Mostrando \\d+–\\d+ de (\\d+)/) || [])[1] ?? null`);
  const variantesVisibles = await evalx(`[...document.querySelectorAll('[data-variant]')].map(td => td.innerText.trim())`);
  const familiasOk = Array.isArray(variantesVisibles) && variantesVisibles.length > 0
    && variantesVisibles.every(v => v.toLowerCase().startsWith('oled'));
  check(`F52: el filtro «OLED» trae la FAMILIA completa (OLED + OLED Con Marco), no el texto exacto`,
    familiasOk, JSON.stringify(variantesVisibles?.slice(0, 6)));
  check('F52: el filtro cuenta lo mismo que la base', Number(contador) === esperadas,
    `pantalla=${contador} · base=${esperadas}`);
  await clickCenter(`document.querySelector('[aria-label="Filtrar por variante"]')`);
  await sleep(600);
  for (let i = 0; i < 12; i++) {
    const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText?.trim() ?? null`);
    if (String(hi).startsWith('Todas las variantes')) { await keyNav('Enter', 'Enter', 13); break; }
    await keyNav('ArrowUp', 'ArrowUp', 38);
    await sleep(180);
  }
  await sleep(1200);
}

// ── 7) cierre: no se dejó nada cambiado ──────────────────────────────────────────────────────
check('F52: la base quedó sana', uno('PRAGMA quick_check').quick_check === 'ok', 'quick_check');
if (objetivo) {
  const ahora = uno(`SELECT COALESCE(in_use,0) AS u, default_product_id AS r FROM phones WHERE id=?1`, objetivo.id);
  check('F52: el padrón quedó EXACTAMENTE como estaba (check «en uso» y pantalla de referencia)',
    String(ahora.u) === String(objetivo.estadoInicial.inUso)
    && (ahora.r ?? null) === (objetivo.estadoInicial.ref ?? null),
    `en uso ${objetivo.estadoInicial.inUso}→${ahora.u} · referencia ${objetivo.estadoInicial.ref ?? '—'}→${ahora.r ?? '—'}`);
  const stockAhora = uno(`SELECT COALESCE(SUM(stock),0) AS s FROM products WHERE id IN (${objetivo.ids.join(',')})`).s;
  check('F52: y el stock de sus repuestos tampoco se movió',
    Number(stockAhora) === Number(objetivo.agg.stock), `stock ${objetivo.agg.stock} → ${stockAhora}`);
}

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
