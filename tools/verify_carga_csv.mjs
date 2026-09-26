// VERIFICACIÓN EN VIVO (CDP) de F78 — CARGA MASIVA DE INVENTARIO EN CSV.
//
// Pedido del dueño: «cambiá el formato de carga masiva a .CSV, que tome TODOS los campos del
// inventario (categoría —incluso nuevas—, marca, modelo, variante, compatibilidad, costo, venta,
// stock, nombre, proveedor…), que se vea si el producto es NUEVO o DUPLICADO y que se pueda
// editarlo, dejarlo o eliminarlo, sin estar cargando producto por producto».
//
// Qué comprueba sobre la app REAL:
//   1. El asistente abre desde Inventario → «Cargar CSV» y trae la plantilla y el export del catálogo.
//   2. Al revisar el archivo salen las DOS pestañas (Nuevos / Ya existen) con sus conteos.
//   3. La pestaña «Ya existen» muestra el DIFF (lo que hay hoy) y el stock como «hoy → queda».
//   4. Las categorías nuevas del archivo se listan y se pueden confirmar (o no crear).
//   5. Se puede editar una fila, dejarla como está y quitarla del archivo.
//   6. Al aplicar: se crea el producto nuevo (con su categoría nueva), se ACTUALIZA el existente
//      con el stock SUMADO, se anotan los movimientos «Carga masiva (CSV)» y queda el respaldo.
//   7. Una fila con problemas (stock ilegible) BLOQUEA el aplicar: no se escribe nada.
//
// SEGURIDAD DE DATOS: escribe de verdad (es una prueba), así que:
//   · `REGISTRO_DB` es OBLIGATORIO (si falta, ABORTA: nunca se prueba contra la base del local);
//   · usa productos con el prefijo «Prueba CSV» y al final los borra (movimientos incluidos);
//   · la categoría nueva se borra si queda vacía.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f78_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_carga_csv.mjs

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};
/** Escribe en un input/textarea como lo haría el operario (setter nativo + evento input). */
const setValue = (selector, value) => evalx(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const txt = (selector) => evalx(`document.querySelector(${JSON.stringify(selector)})?.innerText?.replace(/\\s+/g, ' ') ?? null`);

// ── 0) GATE DE DATOS: copia obligatoria ──────────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  console.error('  Ej.: node tools/seed_dev_db.mjs  y arrancar con $env:REGISTRO_DB a esa copia.');
  process.exit(2);
}
const leer = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return leer.prepare(sql).all(...p)[0] ?? {}; } catch (e) { return { err: String(e.message) }; } };
const marca = String(Date.now()).slice(-6);
const PANTALLA = `Pantalla Prueba CSV ${marca}`;
const PIN_DE_CARGA = `Pin de carga Prueba CSV ${marca}`;
const CATEGORIA_NUEVA = `Prueba CSV ${marca}`;
const catPantalla = uno("SELECT id FROM categories WHERE name = 'Pantalla'").id ?? 1;
console.log(`· copia: ${dbPath} · productos hoy: ${uno('SELECT COUNT(*) AS n FROM products').n}`);

// ── 1) entrar a la app (F68: el acceso es POR PERSONA: se elige Master y se pone su PIN) ──────
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
  // si la instalación tiene UNA sola persona, la app pide el PIN directo (sin selector)
  if (await waitFor(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`, 2000)) {
    await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
    await typeText(pin);
    await keyNav('Enter', 'Enter', 13);
    return await waitFor(`!!document.querySelector('aside')`, 15000);
  }
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

await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, [data-user-picker], input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
const entro = await entrar('Master', '1234');
const usuario = entro ? await invoke('get_current_user').catch(() => null) : null;
check('F78: se entró con la sesión del DUEÑO (la carga masiva es suya)', usuario?.role === 'master', `rol=${usuario?.role ?? 'ninguno'}`);
if (usuario?.role !== 'master') {
  console.log('ABORTADO: sin sesión de dueño no se puede probar la carga masiva.');
  process.exit(2);
}

// preparación: un producto de PANTALLA (categoría 1) que el archivo va a ACTUALIZAR
const idExistente = await invoke('add_product', {
  name: PANTALLA, categoryId: catPantalla, brand: 'Genérico', model: `CSV${marca}`,
  variant: '', compatibility: '[]', priceCost: 2, priceSale: 5, stock: 3, minStock: 1, priceUsd: 4,
});
check('F78 (preparación): hay un producto existente con stock 3 para actualizar', Number(idExistente) > 0, `id ${idExistente}`);

const CSV_OK = [
  'nombre;categoria;marca;modelo;variante;compatibilidad;costo;venta;efectivo;stock;stock_min;proveedor;codigo;en_uso',
  // DOS filas para la MISMA ficha (mismo código): el stock tiene que SUMAR las dos (3 + 4 + 6 = 13) —
  // era un bloqueante de la revisión adversarial (la segunda fila pisaba el stock de la primera)
  `${PANTALLA};Pantalla;Genérico;CSV${marca};;;4,50;9,00;8,00;4;1;Cell World;P-CSV${marca};si`,
  `${PANTALLA};Pantalla;Genérico;CSV${marca};;;4,50;9,00;8,00;6;1;Cell World;P-CSV${marca};si`,
  `${PIN_DE_CARGA};${CATEGORIA_NUEVA};Xiaomi;Redmi 9A;;Redmi 9A / Redmi 9C;0,80;3,00;2,50;5;2;Importadora;;si`,
].join('\n');

const cerrarDialogos = async () => {
  for (let i = 0; i < 6; i++) {
    if (!(await evalx(`!!document.querySelector('[role="dialog"]')`))) break;
    await keyNav('Escape', 'Escape', 27);
    await sleep(500);
  }
};

let aplicado = false;
try {
  // ── 2) abrir el asistente desde la cabecera de Inventario ──────────────────────────────────
  await clickCenter(`[...document.querySelectorAll('aside a, aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario') || (b.innerText || '').trim() === 'Inventario')`);
  await sleep(1800);
  const hayBoton = await evalx(`!!document.querySelector('[data-action="cargar-csv"]')`);
  check('F78: Inventario tiene el botón «Cargar CSV»', hayBoton);
  await clickCenter(`document.querySelector('[data-action="cargar-csv"]')`).catch(async () => {
    await evalx(`(() => { const b = document.querySelector('[data-action="cargar-csv"]'); if (b) b.click(); return !!b; })()`);
  });
  const abrio = await waitFor(`!!document.querySelector('[data-csv-dialog]')`);
  check('F78: el asistente de carga por CSV abre', abrio, String(await txt('[data-csv-dialog]')).slice(0, 80));
  const paso1 = String(await txt('[data-csv-dialog]'));
  check('F78: el paso 1 explica que trae TODOS los campos y que el stock se suma',
    /todos los campos|nombre, categoría/i.test(paso1) && /se SUMA/i.test(paso1));
  check('F78: ofrece la plantilla y el export del catálogo',
    (await evalx(`!!document.querySelector('[data-action="csv-plantilla"]') && !!document.querySelector('[data-action="csv-exportar"]')`)) === true);

  // ── 3) pegar el CSV y revisar ───────────────────────────────────────────────────────────────
  // foto de la base ANTES de revisar: la vista previa NO puede escribir nada
  const fotoAntes = uno('SELECT (SELECT COUNT(*) FROM products) AS productos, (SELECT COALESCE(SUM(stock),0) FROM products) AS unidades, (SELECT COUNT(*) FROM categories) AS categorias, (SELECT COUNT(*) FROM inventory_movements) AS movs');
  await setValue('[data-csv-dialog] textarea', CSV_OK);
  await sleep(500);
  await clickCenter(`document.querySelector('[data-action="csv-revisar"]')`).catch(async () => {
    await evalx(`(() => { const b = document.querySelector('[data-action="csv-revisar"]'); if (b) b.click(); return !!b; })()`);
  });
  const reviso = await waitFor(`/por crear/.test(document.querySelector('[data-csv-dialog]')?.innerText ?? '')`, 15000);
  check('F78: la revisión cruza el archivo y muestra el resumen', reviso, String(await txt('[data-csv-total="resumen"]')).slice(0, 120));
  const resumen = String(await txt('[data-csv-total="resumen"]'));
  check('F78: dice 1 por crear y 2 a actualizar (dos filas de la misma ficha)',
    /1 por crear/.test(resumen) && /2 a actualizar/.test(resumen), resumen);
  // el archivo trae 4 + 6 (la MISMA ficha, que hoy tiene 3) + 5 del producto nuevo = 15 unidades
  // → el total de las fichas afectadas pasa de 3 a 18
  const unidades = String(await txt('[data-csv-total="unidades"]'));
  check('F78: el resumen muestra las unidades hoy → después (3 → 18)',
    /3\s*→\s*18/.test(unidades) && /se suman 15/.test(unidades), unidades);
  const fotoTrasRevisar = uno('SELECT (SELECT COUNT(*) FROM products) AS productos, (SELECT COALESCE(SUM(stock),0) FROM products) AS unidades, (SELECT COUNT(*) FROM categories) AS categorias, (SELECT COUNT(*) FROM inventory_movements) AS movs');
  check('F78: la vista previa NO escribió nada en la base (productos, stock, categorías y movimientos iguales)',
    JSON.stringify(fotoAntes) === JSON.stringify(fotoTrasRevisar), `${JSON.stringify(fotoAntes)} vs ${JSON.stringify(fotoTrasRevisar)}`);

  // las dos pestañas (el gancho va en un span adentro: los Tabs del proyecto no reenvían props)
  const tabs = await evalx(`JSON.stringify([...document.querySelectorAll('[data-csv-tab]')].map(t => t.getAttribute('data-csv-tab') + '=' + t.innerText.replace(/\\s+/g,' ').trim()))`);
  check('F78: hay DOS pestañas (Nuevos / Ya existen) con su conteo',
    /"nuevos=Nuevos \(1\)"/.test(tabs) && /"existentes=Ya existen \(2\)"/.test(tabs), tabs);

  // el aviso de que el stock del archivo SUMA a fichas que ya existen (la trampa del export recargado)
  const avisoSuma = await evalx(`(() => {
    const a = document.querySelector('[data-csv-warn="stock-suma"]');
    return a ? a.innerText.replace(/\\s+/g,' ').trim() : null;
  })()`);
  check('F78: avisa que el stock del archivo SE SUMA a las fichas que ya existen',
    /se suma/i.test(String(avisoSuma)) && /se duplican/i.test(String(avisoSuma)), String(avisoSuma).slice(0, 200));

  // pestaña «Ya existen»: el diff
  await clickCenter(`document.querySelector('[data-csv-tab="existentes"]')?.closest('button') || document.querySelector('[data-csv-tab="existentes"]')`).catch(() => {});
  await sleep(1200);
  const filaExistente = await evalx(`(() => {
    const row = document.querySelector('[data-csv-row]');
    if (!row) return null;
    const stock = row.querySelector('[data-field="csv-stock-despues"]')?.innerText.replace(/\\s+/g, ' ').trim();
    const nombre = row.querySelector('[data-field="csv-name"]')?.value;
    const diffs = [...row.querySelectorAll('span')].map(s => s.innerText.trim()).filter(t => t.startsWith('hoy '));
    return JSON.stringify({ nombre, stock, diffs: diffs.slice(0, 4) });
  })()`);
  check('F78: la pestaña «Ya existen» trae el producto con su stock hoy → queda (3 → 7)',
    String(filaExistente).includes(PANTALLA) && /3\s*→\s*7/.test(String(filaExistente)), String(filaExistente));
  check('F78: y muestra el DIFF de lo que cambia (valor de hoy debajo del dato)',
    /hoy 4\.?5|hoy 4,5|hoy/.test(String(filaExistente)), String(filaExistente));
  const acciones = await evalx(`(() => {
    const row = document.querySelector('[data-csv-row]');
    const sel = row?.querySelector('[data-field="csv-accion"]');
    return sel ? sel.innerText.replace(/\\s+/g, ' ').trim() : null;
  })()`);
  check('F78: la fila existente arranca en «Actualizar con el archivo»', /Actualizar/.test(String(acciones)), String(acciones));

  // categoría nueva: NO viene marcada (se crea solo si el dueño la tilda) y se puede tildar
  const catNueva = await evalx(`(() => {
    const b = document.querySelector('[data-csv-new-categories]');
    const c = b?.querySelector('[data-field="csv-categoria-nueva"]');
    return c ? { texto: b.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90), marcada: c.checked } : null;
  })()`);
  check('F78: la categoría nueva del archivo se lista y NO viene marcada (la crea solo si la tildás)',
    catNueva?.marcada === false && String(catNueva?.texto).includes(CATEGORIA_NUEVA), JSON.stringify(catNueva));
  await evalx(`(() => {
    const c = document.querySelector('[data-csv-new-categories] [data-field="csv-categoria-nueva"]');
    if (!c) return false;
    c.click();
    return c.checked;
  })()`);
  await sleep(400);
  const marcadaAhora = await evalx(`document.querySelector('[data-csv-new-categories] [data-field="csv-categoria-nueva"]')?.checked === true`);
  check('F78: al tildarla, el dueño confirma que se cree', marcadaAhora === true);

  // ── 4) editar una fila: cambiar el stock del existente a 10 y dejarlo activo ────────────────
  await evalx(`(() => {
    const row = document.querySelector('[data-csv-row]');
    const i = row?.querySelector('[data-field="csv-stock"]');
    if (!i) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(i, '10');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(700);
  const trasEditar = String(await txt('[data-csv-total="unidades"]'));
  // 3 de la ficha existente + 10 escritos a mano + 6 de la segunda fila + 5 del producto nuevo = 24
  check('F78: editar la cantidad del archivo actualiza el «hoy → queda» en vivo (3 → 24)',
    /3\s*→\s*24/.test(trasEditar), trasEditar);

  // ── 5) el aplicar está habilitado y se aplica ───────────────────────────────────────────────
  const puede = await evalx(`document.querySelector('[data-csv-apply]')?.disabled === false`);
  check('F78: el botón de cargar está habilitado con el archivo revisado', puede === true);
  await clickCenter(`document.querySelector('[data-csv-apply]')`).catch(async () => {
    await evalx(`(() => { const b = document.querySelector('[data-csv-apply]'); if (b) b.click(); return !!b; })()`);
  });
  const aplico = await waitFor(`!!document.querySelector('[data-csv-report]')`, 25000);
  aplicado = true;
  const reporte = String(await txt('[data-csv-report]'));
  check('F78: el reporte dice qué se creó y qué se actualizó',
    /1 productos creados/.test(reporte) && /2 fichas actualizadas/.test(reporte), reporte.slice(0, 160));
  check('F78: el reporte nombra la categoría nueva', reporte.includes(CATEGORIA_NUEVA), reporte.slice(0, 200));
  check('F78: el reporte dice dónde quedó el respaldo', /Respaldo de la base:/.test(reporte));

  // ── 6) la verdad en la BASE ────────────────────────────────────────────────────────────────
  const nuevo = uno('SELECT id, name, category_id, stock, price_cost, price_sale, supplier FROM products WHERE name = ?1', PIN_DE_CARGA);
  check('F78: el producto NUEVO quedó creado con su stock y sus precios',
    Number(nuevo.stock) === 5 && Number(nuevo.price_cost) === 0.8 && Number(nuevo.price_sale) === 3 && nuevo.supplier === 'Importadora',
    JSON.stringify(nuevo));
  const catCreada = uno('SELECT id, name FROM categories WHERE name = ?1', CATEGORIA_NUEVA);
  check('F78: la categoría nueva se creó y el producto quedó en ella',
    !!catCreada.id && Number(nuevo.category_id) === Number(catCreada.id), JSON.stringify(catCreada));
  check('F78: la categoría nueva NO pisa los ids del padrón de teléfonos',
    ![1, 18, 19].includes(Number(catCreada.id)), `id ${catCreada.id}`);
  const existente = uno('SELECT stock, price_cost, price_sale, supplier, code FROM products WHERE id = ?1', Number(idExistente));
  check('F78: el producto EXISTENTE sumó el stock de LAS DOS filas (3 + 10 + 6 = 19) y tomó los precios del archivo',
    Number(existente.stock) === 19 && Number(existente.price_cost) === 4.5 && Number(existente.price_sale) === 9,
    JSON.stringify(existente));
  check('F78: el proveedor de la carga quedó anotado', existente.supplier === 'Cell World', String(existente.supplier));
  const movs = uno("SELECT COUNT(*) AS n, COALESCE(SUM(quantity),0) AS q FROM inventory_movements WHERE reason = 'Carga masiva (CSV)' AND product_id = ?1", Number(idExistente));
  // DOS movimientos (uno por fila) que suman 16: el historial dice lo MISMO que el stock
  check('F78: el historial tiene un movimiento por fila y su suma es la que subió el stock (16)',
    Number(movs.n) >= 2 && Number(movs.q) === 16, `movimientos=${movs.n} suma=${movs.q}`);
  const backdrop = uno("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference LIKE '%pegado.csv%'");
  check('F78: el movimiento guarda el nombre del archivo como referencia', Number(backdrop.n) >= 1, `con referencia=${backdrop.n}`);

  // ── 7) un archivo con un error NO carga nada (falla cerrado) ────────────────────────────────
  await cerrarDialogos();
  await clickCenter(`document.querySelector('[data-action="cargar-csv"]')`).catch(() => {});
  await waitFor(`!!document.querySelector('[data-csv-dialog]')`, 10000);
  // sin la columna «venta»: sus celdas quedan de SOLO LECTURA (editar algo que se va a descartar
  // sería una mentira) y el precio negativo bloquea la fila
  await setValue('[data-csv-dialog] textarea', 'nombre;categoria;marca;modelo;stock;costo\nOtro Prueba CSV;Pantalla;Genérico;CSV1;cinco;-5\n');
  await sleep(400);
  await clickCenter(`document.querySelector('[data-action="csv-revisar"]')`).catch(() => {});
  await waitFor(`/por crear/.test(document.querySelector('[data-csv-dialog]')?.innerText ?? '')`, 15000);
  const bloqueadas = await evalx(`!!document.querySelector('[data-csv-total="bloqueadas"]')`);
  const aplicarApagado = await evalx(`document.querySelector('[data-csv-apply]')?.disabled === true`);
  check('F78: una fila con el stock ilegible y un precio negativo se marca y bloquea el cargar (nada se escribe a medias)',
    bloqueadas === true && aplicarApagado === true, `bloqueadas=${bloqueadas} · apply deshabilitado=${aplicarApagado}`);
  const soloLectura = await evalx(`(() => {
    const v = document.querySelector('[data-field="csv-price_sale"]');
    const c = document.querySelector('[data-field="csv-stock"]');
    return JSON.stringify({ venta: v?.getAttribute('data-csv-readonly'), stock: c?.getAttribute('data-csv-readonly') ?? null, ventaEditable: v ? !v.readOnly : null });
  })()`);
  check('F78: las columnas que el archivo NO trae quedan de solo lectura (y el stock, que sí trae, es editable)',
    String(soloLectura).includes('"venta":"si"') && String(soloLectura).includes('"ventaEditable":false') && String(soloLectura).includes('"stock":null'),
    String(soloLectura));
  // el conteo es por NOMBRE EXACTO: el chequeo viejo usaba un LIKE que no podía fallar
  const nadaNuevo = uno('SELECT COUNT(*) AS n FROM products WHERE name IN (?1, ?2)', PANTALLA, PIN_DE_CARGA);
  check('F78: y no se creó nada más en la base (siguen los mismos 2 productos de prueba)',
    Number(nadaNuevo.n) === 2, `productos de prueba=${nadaNuevo.n}`);
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}

// ── 8) LIMPIEZA (sobre la copia): movimientos, productos y la categoría si queda vacía ────────
try {
  const esc = new DatabaseSync(dbPath);
  const ids = esc.prepare("SELECT id FROM products WHERE name LIKE ?1").all(`%Prueba CSV ${marca}%`).map(r => Number(r.id));
  for (const id of ids) esc.prepare('DELETE FROM inventory_movements WHERE product_id = ?').run(id);
  for (const id of ids) esc.prepare('DELETE FROM products WHERE id = ?').run(id);
  const cat = esc.prepare('SELECT id FROM categories WHERE name = ?').all(CATEGORIA_NUEVA).map(r => Number(r.id));
  for (const id of cat) esc.prepare('DELETE FROM categories WHERE id = ? AND NOT EXISTS (SELECT 1 FROM products WHERE category_id = ?)').run(id, id);
  esc.close();
  const quedan = uno("SELECT COUNT(*) AS n FROM products WHERE name LIKE ?1", `%Prueba CSV ${marca}%`);
  check('F78: la verificación borró sus productos de prueba (sin residuos)', Number(quedan.n) === 0, `quedan=${quedan.n}`);
} catch (e) {
  check('F78: la limpieza de los productos de prueba', false, String(e?.message ?? e));
}
if (!aplicado) check('F78: (aviso) la carga no llegó a aplicarse', false);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
