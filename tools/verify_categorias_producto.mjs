// VERIFICACIÓN EN VIVO (CDP) de **F65** — categorías de PRODUCTO: crear, corregir y borrar.
//
// Pedido del dueño (2026-09-23): «cuando en este inventario pueda registrar nuevas categorías, no
// esté limitado a crear categorías de productos». La categoría era una lista CERRADA (las 6 del
// arranque + lo que trajeran los catálogos importados): el repuesto que no entraba en ninguna no
// tenía dónde anotarse.
//
// Lo que se comprueba EN LA APP (no en el código):
//   · el formulario del producto ofrece «+ Nueva categoría» y con eso se crea SIN salir del form;
//   · queda GUARDADA en la tabla `categories` (verdad leída de la base, no de la pantalla);
//   · queda ELEGIDA en el producto que se está cargando;
//   · el filtro de la pestaña Productos ya la muestra (la caché de categorías se rompe al crear);
//   · un nombre que YA existe (mayúsculas/acentos no cuentan) NO crea una gemela: avisa y ofrece
//     USAR la que ya está;
//   · en Ajustes se ve el uso real («sin productos») y se puede CORREGIR el nombre y ELIMINARLA;
//   · una categoría CON productos y las del PADRÓN DE TELÉFONOS tienen el botón de eliminar apagado.
//
// Escribe de verdad contra la base que le indiques (REGISTRO_DB): usá una COPIA. Limpia lo suyo.
//
// Uso:  $env:REGISTRO_DB="...\backup\f65_fixture.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       npx tauri dev      (y en otra consola)   node tools/verify_categorias_producto.mjs

import { evalx, clickCenter, keyNav, escribirEn, handleDialog, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB (esta prueba ESCRIBE en la base: usá una COPIA).');
  process.exit(2);
}

/** Verdad independiente de la pantalla: lo que hay guardado en SQLite. */
const q = (sql, ...params) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
};
const categorias = () => q('SELECT id, name, description FROM categories ORDER BY name');
const porNombre = (n) => categorias().find(c => c.name === n) ?? null;
const totalCategorias = () => categorias().length;
const totalProductos = () => q('SELECT COUNT(*) AS n FROM products')[0].n;
const usos = (id) => q('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', id)[0].n;

// Nombres SIN acentos: las teclas se mandan por CDP y el plegado (acentos/mayúsculas) ya está fijado
// en la prueba pura `tools/category_rules_test.ts`.
const MARCA = String(Date.now()).slice(-5);
const NUEVA = `Categoria prueba ${MARCA}`;
const CORREGIDA = `Categoria corregida ${MARCA}`;
const antes = categorias();
const productosAntes = totalProductos();
console.log(`· copia: ${dbPath}`);
console.log(`· categorías ANTES: ${antes.length} (${antes.map(c => c.name).join(' · ')})`);

const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
/** Reintenta una lectura de la base hasta que se cumpla la condición (la UI es asíncrona). */
const waitDb = async (fn, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (fn()) return true; } catch { /* la base puede estar ocupada un instante */ }
    await sleep(400);
  }
  return false;
};
/** Botón por NOMBRE de categoría (los nombres pueden traer comillas: se compara el dataset). */
const boton = (accion, nombre) =>
  `[...document.querySelectorAll('[data-categoria-${accion}]')].find(b => b.dataset.categoria${accion[0].toUpperCase()}${accion.slice(1)} === ${JSON.stringify(nombre)}) ?? null`;
const limpiar = async () => {
  for (const n of [NUEVA, CORREGIDA]) {
    const c = porNombre(n);
    if (c) await evalx(`window.__TAURI_INTERNALS__.invoke('delete_category', { id: ${c.id} })`).catch(() => {});
  }
};

// ── PIN + entrar al inventario ────────────────────────────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
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
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario')) ?? null`);
await sleep(1800);
check('F65: se entró al módulo de Inventario',
  await waitFor(`[...document.querySelectorAll('h1')].some(h => h.innerText.trim() === 'Inventario')`, 12000));

// ── 1. CREAR la categoría desde el formulario del producto ────────────────────────────────────
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Nuevo producto$/.test(b.innerText.trim())) ?? null`);
check('F65: se abrió el formulario de producto', await waitFor(`!!document.querySelector('[role="dialog"]')`));
check('F65: el formulario ofrece «+ Nueva categoría» (la categoría ya no es una lista cerrada)',
  await evalx(`!!document.querySelector('[data-nueva-categoria]')`));

await clickCenter(`document.querySelector('[data-nueva-categoria]')`);
check('F65: al abrirlo aparece el campo para escribir el nombre',
  await waitFor(`!!document.querySelector('[data-nueva-categoria-input]')`, 8000));
check('F65: el nombre se escribió en el campo',
  await escribirEn(`document.querySelector('[data-nueva-categoria-input]')`, NUEVA));
await sleep(500);
check('F65: un nombre NUEVO no dispara el aviso de duplicado',
  (await evalx(`!!document.querySelector('[data-nueva-categoria-aviso]')`)) === false);
check('F65: el botón «Crear y usar» queda habilitado',
  (await evalx(`document.querySelector('[data-nueva-categoria-guardar]')?.disabled === false`)) === true);

await clickCenter(`document.querySelector('[data-nueva-categoria-guardar]')`);
const guardada = await waitDb(() => !!porNombre(NUEVA));
check('F65: la categoría quedó GUARDADA en la base (tabla `categories`)', guardada,
  `categorías: ${totalCategorias()} (antes ${antes.length})`);

const enForm = await evalx(`document.querySelector('[data-field="categoria"]')?.innerText.trim() ?? null`);
check('F65: y quedó ELEGIDA en el producto que se está cargando',
  String(enForm ?? '').includes(NUEVA), `el select muestra: ${enForm}`);

// El desplegable del formulario la lista también (sin cerrar el form: la lista local se actualiza).
await evalx(`(() => { document.querySelector('[data-field="categoria"]')?.click(); return true; })()`);
// Se ESPERA la opción (regla del proyecto: esperar la condición, no el reloj): con el desplegable
// lento, un `sleep` fijo hacía fallar el chequeo sin que hubiera ningún bug.
const opcionNueva = await waitFor(
  `[...document.querySelectorAll('[role="option"]')].some(o => o.innerText.trim() === ${JSON.stringify(NUEVA)})`,
  8000,
);
check('F65: la categoría nueva aparece en el desplegable de categorías del producto', opcionNueva === true);
await keyNav('Escape', 'Escape', 27);
await sleep(600);

// ── 2. Duplicado: NO se crea una gemela, se ofrece la que ya está ─────────────────────────────
const reabrir = async () => {
  if (!(await evalx(`!!document.querySelector('[data-nueva-categoria-input]')`))) {
    await clickCenter(`document.querySelector('[data-nueva-categoria]') ?? null`).catch(() => {});
    await sleep(700);
  }
};

await reabrir();
await escribirEn(`document.querySelector('[data-nueva-categoria-input]')`, 'pantalla');
await sleep(700);
const aviso = await evalx(`document.querySelector('[data-nueva-categoria-aviso]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
check('F65: escribir una categoría que YA existe (en minúsculas) AVISA', !!aviso && /Pantalla/.test(String(aviso)), String(aviso));
check('F65: y el botón de crear queda apagado (no se crea una categoría repetida)',
  (await evalx(`document.querySelector('[data-nueva-categoria-guardar]')?.disabled === true`)) === true);
check('F65: ofrece USAR la que ya está de un toque',
  (await evalx(`!!document.querySelector('[data-nueva-categoria-usar]')`)) === true);
const antesDeUsar = totalCategorias();
await clickCenter(`document.querySelector('[data-nueva-categoria-usar]')`);
await sleep(900);
check('F65: «Usar» la elige y NO crea nada nuevo',
  totalCategorias() === antesDeUsar &&
  String(await evalx(`document.querySelector('[data-field="categoria"]')?.innerText.trim() ?? ''`)).includes('Pantalla'),
  `categorías: ${totalCategorias()} (antes ${antesDeUsar})`);

// …y el aviso vale también para la categoría que se ACABA de crear (mismo nombre, otras mayúsculas).
await reabrir();
await escribirEn(`document.querySelector('[data-nueva-categoria-input]')`, NUEVA.toLowerCase());
await sleep(700);
const aviso2 = await evalx(`document.querySelector('[data-nueva-categoria-aviso]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
check('F65: el aviso de repetida también cubre la categoría recién creada', !!aviso2 && String(aviso2).includes(NUEVA), String(aviso2));
check('F65: no se creó ninguna gemela (la lista sigue igual)', totalCategorias() === antesDeUsar,
  `categorías: ${totalCategorias()}`);

// Escape cierra el PANEL, no el formulario. BLOQUEANTE de la 2ª vuelta adversarial (medido en vivo
// antes del arreglo): Radix escucha Escape en la captura de `document` y se cerraba el diálogo del
// producto entero, perdiendo los ~12 campos ya cargados. Lo intercepta `useEscapeGuard`.
await keyNav('Escape', 'Escape', 27);
await sleep(700);
check('F65: Escape con el panel abierto cierra SÓLO el panel (el formulario del producto sigue abierto)',
  (await evalx(`!!document.querySelector('[data-nueva-categoria-input]')`)) === false &&
  (await evalx(`!!document.querySelector('[role="dialog"]')`)) === true);

// ── 3. Cerrar SIN guardar (la prueba no ensucia el catálogo con un producto) ──────────────────
await keyNav('Escape', 'Escape', 27);
await sleep(700);
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(700); }
check('F65: el formulario se cerró sin guardar ningún producto',
  (await evalx(`!!document.querySelector('[role="dialog"]')`)) === false && totalProductos() === productosAntes,
  `productos: ${totalProductos()} (antes ${productosAntes})`);

// ── 4. El filtro de Productos ya la muestra (la caché de categorías se rompió al crear) ───────
await clickCenter(`document.querySelector('button[aria-label="Filtrar por categoría"]') ?? null`).catch(() => {});
check('F65: se abrió el filtro de categorías de la pestaña Productos',
  await waitFor(`!!document.querySelector('[role="option"], [role="listbox"]')`, 8000));
check('F65: la categoría nueva aparece en el FILTRO de Productos sin reiniciar la app',
  await waitFor(`[...document.querySelectorAll('[role="option"]')].some(o => o.innerText.trim() === ${JSON.stringify(NUEVA)})`, 8000) === true);
await keyNav('Escape', 'Escape', 27);
await sleep(600);

// ── 5. En Ajustes: uso real, corregir el nombre y eliminar ────────────────────────────────────
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Ajustes$/.test(b.innerText.trim())) ?? null`);
check('F65: se abrió la pestaña Ajustes (dueño)', await waitFor(`!!document.querySelector('[data-card="categorias"]')`, 12000));
check('F65: la tarjeta lista la categoría nueva con su uso real (sin productos)',
  await waitFor(`document.querySelector('[data-categoria-uso="${NUEVA}"]')?.innerText.trim() === 'sin productos'`, 10000),
  String(await evalx(`document.querySelector('[data-categoria-uso="${NUEVA}"]')?.innerText.trim() ?? null`)));

// Corregir el nombre (error de tipeo) sin tocar ningún producto.
await clickCenter(`document.querySelector('[data-categoria-editar="${NUEVA}"]') ?? null`);
check('F65: «Corregir» abre el campo del nombre',
  await waitFor(`!!document.querySelector('[data-categoria-nombre-input]')`, 8000));
await evalx(`(() => {
  const i = document.querySelector('[data-categoria-nombre-input]');
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, '');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await escribirEn(`document.querySelector('[data-categoria-nombre-input]')`, CORREGIDA);
await sleep(500);
await clickCenter(`document.querySelector('[data-categoria-guardar]') ?? null`);
const renombrada = await waitDb(() => !!porNombre(CORREGIDA) && !porNombre(NUEVA));
check('F65: el nombre corregido quedó GUARDADO en la base', renombrada,
  `ahora: ${porNombre(CORREGIDA)?.name ?? '(no está)'}`);
check('F65: la categoría corregida sigue sin productos (no se tocó ninguna ficha)',
  !!porNombre(CORREGIDA) && usos(porNombre(CORREGIDA).id) === 0);

// El padrón de teléfonos y las categorías CON productos no se pueden borrar.
check('F65: «Pantalla» está marcada como del padrón y su botón de eliminar está apagado',
  (await evalx(`!!document.querySelector('[data-categoria-padron]')`)) === true &&
  (await evalx(`document.querySelector(${JSON.stringify('[data-categoria-borrar="Pantalla"]')})?.disabled === true`)) === true);

// Bloqueo por PRODUCTOS: se busca una categoría que NO sea del padrón y tenga fichas. En la copia de
// trabajo las únicas con productos son las del padrón, así que en ese caso se le pone UNA ficha a la
// categoría de prueba con la API, se comprueba el bloqueo EN LA PANTALLA y se quita — es la única
// forma de probar el bloqueo real (y al final se verifica que no quedó ningún producto de más).
const PADRON = `('pantalla','tactil','tactiltablet')`;
const NO_PADRON = `lower(replace(replace(replace(c.name,'á','a'),'í','i'),' ','')) NOT IN ${PADRON}`;
let conProductos = q(`SELECT c.name AS name, COUNT(p.id) AS n
                      FROM categories c JOIN products p ON p.category_id = c.id
                      WHERE ${NO_PADRON} AND c.name <> ? GROUP BY c.id ORDER BY n DESC LIMIT 1`, CORREGIDA)[0];
let productoPrestado = null;
if (!conProductos) {
  const catPrueba = porNombre(CORREGIDA);
  const pid = await evalx(`window.__TAURI_INTERNALS__.invoke('add_product', {
    name: 'Ficha de prueba F65', categoryId: ${catPrueba.id}, brand: 'Generico', model: 'Prueba',
    variant: '', compatibility: '[]', priceCost: 1, priceSale: 2, stock: 1, minStock: 0, priceUsd: 0
  })`).catch(() => null);
  productoPrestado = pid;
  if (pid) {
    // volver a leer la tarjeta: se sale y se vuelve a la pestaña (el componente se vuelve a montar)
    await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Productos$/.test(b.innerText.trim())) ?? null`).catch(() => {});
    await sleep(800);
    await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Ajustes$/.test(b.innerText.trim())) ?? null`).catch(() => {});
    await waitFor(`!!document.querySelector('[data-categoria-uso="${CORREGIDA}"]')`, 12000);
    conProductos = { name: CORREGIDA, n: 1 };
  }
}
if (conProductos) {
  const sel = boton('borrar', conProductos.name);
  const bloqueado = await evalx(`(() => {
    const b = ${sel};
    return b ? { disabled: b.disabled === true, title: b.getAttribute('title') || '' } : null;
  })()`);
  check(`F65: una categoría CON productos («${conProductos.name}», ${conProductos.n}) no se puede borrar desde la pantalla`,
    !!bloqueado && bloqueado.disabled && /pasalos a otra categoría/.test(bloqueado.title),
    JSON.stringify(bloqueado));
  const uso = String(await evalx(`document.querySelector('[data-categoria-uso="${conProductos.name}"]')?.innerText.trim() ?? ''`));
  check('F65: y su uso real se ve en la lista', /producto/.test(uso), uso);
} else {
  check('F65: no se pudo preparar una categoría con productos para probar el bloqueo', false);
}
if (productoPrestado) {
  await evalx(`window.__TAURI_INTERNALS__.invoke('delete_product', { id: ${productoPrestado} })`).catch(() => {});
  await sleep(600);
  check('F65: la ficha prestada se quitó (no queda mercancía de prueba)',
    totalProductos() === productosAntes, `productos: ${totalProductos()} (antes ${productosAntes})`);
  // La tarjeta NO sabe que se quitó la ficha por detrás: se vuelve a montar (salir y entrar a la
  // pestaña) para que el uso real vuelva a «sin productos» — igual que hace el operario al volver.
  await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Productos$/.test(b.innerText.trim())) ?? null`).catch(() => {});
  await sleep(800);
  await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Ajustes$/.test(b.innerText.trim())) ?? null`).catch(() => {});
  await waitFor(`!!document.querySelector('[data-card="categorias"]')`, 12000);
  check('F65: al quedar vacía, la categoría vuelve a decir «sin productos» y se puede borrar',
    await waitFor(`document.querySelector('[data-categoria-uso="${CORREGIDA}"]')?.innerText.trim() === 'sin productos'`, 10000),
    String(await evalx(`document.querySelector('[data-categoria-uso="${CORREGIDA}"]')?.innerText.trim() ?? null`)));
}

// Eliminar la categoría de prueba (vacía) desde la pantalla, con su confirmación.
check('F65: el botón de eliminar de la categoría vacía está HABILITADO',
  (await evalx(`document.querySelector('[data-categoria-borrar="${CORREGIDA}"]')?.disabled === false`)) === true);
await clickCenter(`document.querySelector('[data-categoria-borrar="${CORREGIDA}"]') ?? null`);
await sleep(300);
// El `confirm()` de la app es un diálogo NATIVO: en WebView2 con CDP adjunto puede autocontestarse
// (medido), así que lo que se AFIRMA es el EFECTO REAL — la categoría se borra de la base — y se
// informa si el diálogo llegó a atenderse desde acá.
const dialogo = await handleDialog(true);
const borrada = await waitDb(() => !porNombre(CORREGIDA));
check('F65: Eliminar (con su confirmación) borra la categoría vacía de la base', borrada,
  `diálogo atendido: ${dialogo} · categorías: ${totalCategorias()}`);

// ── 6. Limpieza y estado final ────────────────────────────────────────────────────────────────
await limpiar();
await sleep(600);
const despues = categorias();
check('F65: la prueba se limpió (mismas categorías que al entrar)',
  despues.length === antes.length && !despues.some(c => [NUEVA, CORREGIDA].includes(c.name)),
  `antes ${antes.length} · después ${despues.length}`);
check('F65: y no quedó ningún producto de prueba', totalProductos() === productosAntes,
  `productos: ${totalProductos()} (antes ${productosAntes})`);
check('F65: las categorías que ya estaban siguen enteras (mismos id, nombre y descripción)',
  antes.every(a => {
    const d = despues.find(x => x.id === a.id);
    return !!d && d.name === a.name && (d.description ?? '') === (a.description ?? '');
  }),
  despues.map(c => c.name).join(' · '));

const fallas = out.filter(o => !o.ok).length;
console.log(`\nverify_categorias_producto: ${out.length - fallas}/${out.length} OK${fallas ? ` — ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
