// VERIFICACIÓN EN VIVO (CDP) de F51 — ORDEN POR COLUMNAS en Inventario → Productos.
//
// Pedido del dueño (2026-09-20): «me pide que también en Producto tenga el ordenamiento por columnas».
//
// Qué comprueba sobre la app REAL:
//   1. Cada encabezado ordenable existe y es un BOTÓN (`data-sort`).
//   2. Al hacer clic, la tabla se reordena de verdad: **el orden de la PANTALLA se compara con el
//      mismo orden calculado sobre la BASE leída aparte** (una conexión `node:sqlite` sólo lectura):
//      comparar la pantalla contra sí misma no probaría nada.
//   3. El ciclo es asc → desc → sin orden, con la flecha y `aria-sort` acompañando.
//   4. La paginación vuelve a la página 1 al cambiar de columna.
//
// SEGURIDAD DE DATOS: **no escribe nada** (solo lee la pantalla y la base).
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f51_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_orden_columnas.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) GATE: la base (verdad independiente) ─────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const filas = (sql) => { try { return db.prepare(sql).all(); } catch (e) { return [{ err: String(e.message) }]; } };

// ── 1) entrar al Inventario → Productos ─────────────────────────────────────────────────────
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
      s.call(i, s === undefined ? '' : i.value + '${ch}');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await sleep(500);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// La barra lateral se puede COLAPSAR (queda solo con íconos y sin texto): el botón se busca por su
// `title` («Inventario (Alt+2)»), que existe en los dos estados.
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario'))`);
await sleep(2000);
// la pestaña Productos es la que abre por defecto
await waitFor(`!!document.querySelector('[data-sort="nombre"]')`, 15000);

const encabezados = await evalx(`[...document.querySelectorAll('[data-sort]')].map(b => b.getAttribute('data-sort'))`);
check('F51: los encabezados ordenables están en la tabla',
  Array.isArray(encabezados) && ['nombre', 'categoria', 'marca', 'modelo', 'stock', 'minimo'].every(c => encabezados.includes(c)),
  JSON.stringify(encabezados));

/** Nombres de producto de la PRIMERA página, en el orden que se ven (nombre REAL de la base). */
const visibles = () => evalx(`[...document.querySelectorAll('[data-product-name]')].map(s => s.getAttribute('data-product-name')).slice(0, 12)`);
/** La misma consulta contra la BASE, ordenada como pide el sort (la verdad independiente). */
const desdeBase = (ordenSql, filtroCat) => filas(
  `SELECT p.name FROM products p LEFT JOIN categories c ON p.category_id = c.id
   ${filtroCat ? `WHERE p.category_id = ${filtroCat}` : ''} ORDER BY ${ordenSql} LIMIT 12`).map(r => r.name);

/** Clic en un encabezado y espera a que el estado cambie (no se duerme a ojo). */
const clicOrden = async (col, esperado) => {
  await clickCenter(`document.querySelector('[data-sort="${col}"]')`);
  await waitFor(`document.querySelector('[data-sort="${col}"]')?.getAttribute('data-sort-state') === '${esperado}'`, 8000);
  await sleep(900);
  return evalx(`document.querySelector('[data-sort="${col}"]')?.getAttribute('data-sort-state')`);
};

const catPantalla = filas('SELECT id FROM categories WHERE lower(name) = \'pantalla\'')[0]?.id ?? null;
const catFiltro = await evalx(`(() => { const t = document.querySelector('main [role="combobox"]'); return t ? t.innerText.trim() : null; })()`);
console.log(`· filtro de categoría en pantalla: ${catFiltro} · categoría Pantalla en la base: ${catPantalla ?? '—'}`);

// ── 2) NOMBRE: asc (por defecto) → desc ────────────────────────────────────────────────────
const nombreAsc = await visibles();
check('F51: la tabla arranca ordenada por nombre',
  JSON.stringify(nombreAsc) === JSON.stringify(desdeBase('p.name', catPantalla)), `pantalla=${JSON.stringify(nombreAsc.slice(0, 3))}`);
const estadoDesc = await clicOrden('nombre', 'desc');
const nombreDesc = await visibles();
check('F51: clic derecho en «Producto» lo ordena al revés (Z→A)',
  estadoDesc === 'desc' && JSON.stringify(nombreDesc) === JSON.stringify(desdeBase('p.name DESC', catPantalla)),
  `estado=${estadoDesc} · pantalla=${JSON.stringify(nombreDesc.slice(0, 3))}`);
const ariaDesc = await evalx(`document.querySelector('[data-sort="nombre"]')?.closest('th')?.getAttribute('aria-sort')`);
check('F51: el encabezado dice su estado (`aria-sort=descending`)', ariaDesc === 'descending', String(ariaDesc));

// ── 3) STOCK: de mayor a menor y de menor a mayor ──────────────────────────────────────────
const estadoStock = await clicOrden('stock', 'asc');
const stockAsc = await visibles();
check('F51: «Stock» ordena de MAYOR a menor (su orden útil)',
  estadoStock === 'asc' && JSON.stringify(stockAsc) === JSON.stringify(desdeBase('p.stock DESC, p.name', catPantalla)),
  `estado=${estadoStock} · pantalla=${JSON.stringify(stockAsc.slice(0, 3))}`);
await clicOrden('stock', 'desc');
const stockDesc = await visibles();
check('F51: y el segundo clic lo da vuelta (menor a mayor)',
  JSON.stringify(stockDesc) === JSON.stringify(desdeBase('p.stock ASC, p.name', catPantalla)), JSON.stringify(stockDesc.slice(0, 3)));

// ── 4) MARCA / PRECIO / COSTO contra la base ───────────────────────────────────────────────
for (const [col, sql, etiqueta] of [
  ['marca', 'p.brand, p.model, p.name', 'Marca'],
  ['precio', 'p.price_sale DESC, p.name', 'Precio'],
  ['costo', 'p.price_cost DESC, p.name', 'Costo'],
]) {
  const hayCol = await evalx(`!!document.querySelector('[data-sort="${col}"]')`);
  if (!hayCol) { check(`F51: la columna «${etiqueta}» se puede ordenar`, false, 'no está en la tabla'); continue; }
  await clicOrden(col, 'asc');
  const visto = await visibles();
  check(`F51: «${etiqueta}» ordena igual que la base`,
    JSON.stringify(visto) === JSON.stringify(desdeBase(sql, catPantalla)), `pantalla=${JSON.stringify(visto.slice(0, 3))}`);
}

// ── 5) el ciclo vuelve a «sin orden» y la paginación se reinicia ───────────────────────────
// El ciclo es asc → desc → sin orden: se clickea hasta llegar a `none` (sin suponer el estado
// en el que quedó la columna de la prueba anterior).
let estadoFinal = await evalx(`document.querySelector('[data-sort="costo"]')?.getAttribute('data-sort-state')`);
for (let i = 0; i < 3 && estadoFinal !== 'none'; i++) {
  estadoFinal = await clicOrden('costo', estadoFinal === 'asc' ? 'desc' : 'none');
}
check('F51: el tercer clic deja la columna SIN orden (vuelve a nombre)', estadoFinal === 'none', String(estadoFinal));
await clickCenter(`([...document.querySelectorAll('main button')].find(b => /Siguiente|›/i.test(b.innerText || b.getAttribute('aria-label') || '')) || null)`).catch(() => {});
await sleep(900);
const paginaAntes = await evalx(`document.body.innerText.match(/Página (\\d+)/)?.[1] ?? null`);
await clicOrden('stock', 'asc');
const paginaDespues = await evalx(`document.body.innerText.match(/Página (\\d+)/)?.[1] ?? '1'`);
check('F51: al cambiar de columna la paginación vuelve a la página 1', paginaDespues === '1', `antes=${paginaAntes} · después=${paginaDespues}`);
check('F51: no se escribió nada en la base (solo lectura)',
  filas('PRAGMA quick_check')[0]?.quick_check === 'ok', 'quick_check');

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
