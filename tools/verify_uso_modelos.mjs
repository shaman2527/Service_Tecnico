// VERIFICACIÓN EN VIVO (CDP) de F50 — «LO QUE USO» (el check) + CÓDIGOS de referencia.
//
// Pedido del dueño (2026-09-20): «él no lo usa todo; aplicar un check con su número de cada producto
// o modelo que él pueda seleccionar — esos son los productos o modelos que le van a aparecer cuando
// está haciendo un registro de un nuevo servicio… así es más rápida la búsqueda».
//
// Qué comprueba sobre la app REAL (y contra la BASE leída aparte, nunca contra sí misma):
//   1. **Productos:** el check por fila existe, dice lo mismo que la base, y al pulsarlo cambia
//      `products.in_use` y **NADA MÁS** (stock, precio y compatibilidad intactos: se comparan los
//      tres antes/después contra la base).
//   2. **El código** (`P-0142`) se ve en la fila, coincide con la base y **se puede buscar** por él
//      (con guion y sin guion).
//   3. **Los filtros** «Solo lo que uso» / «Lo que NO uso» traen exactamente los que dice la base.
//   4. **Modelos:** el check por modelo cambia el teléfono **y sus repuestos** (la acción
//      «usar/apagar todo el modelo», transaccional) y se restaura.
//   5. **El registro de servicio:** con el padrón por defecto el combobox ofrece **solo modelos en
//      uso** (cada uno con su código), «Ver todos» trae el catálogo completo (incluidos apagados) y
//      se puede volver atrás. Ése es el objetivo del dueño: la búsqueda más corta.
//   6. **El invariante de F50:** la lista de PANTALLAS de un modelo **no** se filtra por «en uso»
//      (solo el modelo se filtra): se compara contra `find_compatible_products` del backend. Así el
//      taller nunca se queda sin poder elegir la pantalla que tiene que instalar.
//   7. Nada de dinero: **no se crea ninguna orden** y todo lo que se marca se restaura.
//
// SEGURIDAD DE DATOS: escribe SOLO los checks (`in_use`) y los restaura al terminar; nunca toca
// stock, precios, movimientos ni órdenes. SIEMPRE sobre una COPIA (`REGISTRO_DB`).
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f50_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_uso_modelos.mjs

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

/**
 * F66b — LA PRUEBA PREPARA SU FIXTURE. F50 necesita que haya **algo apagado** («lo uso» = No) para
 * demostrar que el filtro lo esconde y que «Ver todos» lo trae: productos para el filtro del
 * inventario y MODELOS del padrón (con pantallas) para el buscador del servicio. Desde F64 el
 * catálogo viaja **todo encendido** (`tools/enuso_todo.mjs`), así que en cualquier copia actual no
 * hay ni un apagado y la prueba fallaba 6 comprobaciones por falta de datos (no por el producto).
 * Acá se apagan UNA ficha y DOS modelos al empezar —antes de la foto «antes»— y se devuelven como
 * estaban al terminar, así la afirmación «la base quedó como estaba» sigue siendo cierta.
 */
const prepararFixture = () => {
  const w = new DatabaseSync(dbPath);
  try {
    const apagadas = w.prepare('SELECT COUNT(*) n FROM products WHERE in_use = 0').get().n;
    const apagados = w.prepare('SELECT COUNT(*) n FROM phones WHERE in_use = 0').get().n;
    const fichas = apagadas === 0 ? [Number(w.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get()?.id ?? 0)].filter(Boolean) : [];
    const modelos = apagados === 0
      ? w.prepare(`SELECT ph.id FROM phones ph WHERE ph.in_use = 1
                   ORDER BY (SELECT COUNT(*) FROM products pr WHERE pr.category_id = 1 AND pr.compatibility LIKE '%' || ph.name || '%') DESC
                   LIMIT 2`).all().map(r => r.id)
      : [];
    for (const id of fichas) w.prepare('UPDATE products SET in_use = 0 WHERE id = ?').run(id);
    for (const id of modelos) w.prepare('UPDATE phones SET in_use = 0 WHERE id = ?').run(id);
    return { fichas, modelos };
  } finally { w.close(); }
};
const devolverFixture = ({ fichas, modelos }) => {
  if (fichas.length === 0 && modelos.length === 0) return;
  const w = new DatabaseSync(dbPath);
  try {
    for (const id of fichas) w.prepare('UPDATE products SET in_use = 1 WHERE id = ?').run(id);
    for (const id of modelos) w.prepare('UPDATE phones SET in_use = 1 WHERE id = ?').run(id);
  } finally { w.close(); }
};
const fixtureTocado = prepararFixture();
if (fixtureTocado.fichas.length || fixtureTocado.modelos.length) {
  console.log(`· fixture: se apagaron para la prueba ${fixtureTocado.fichas.length} ficha(s) y ${fixtureTocado.modelos.length} modelo(s) (se devuelven al final)`);
}

const filas = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return [{ err: String(e.message) }]; } };
const uno = (sql, ...p) => filas(sql, ...p)[0] ?? {};
const producto = (id) => uno(
  `SELECT id, COALESCE(name,'') AS name, COALESCE(code,'') AS code, COALESCE(in_use,1) AS in_use,
          COALESCE(stock,0) AS stock, COALESCE(price_sale,0) AS price_sale,
          COALESCE(price_cost,0) AS price_cost, COALESCE(compatibility,'') AS compatibility
   FROM products WHERE id=?1`, id);
const cuenta = (sql, ...p) => Number(uno(sql, ...p).n ?? -1);

// ── 1) entrar a la app (PIN si hace falta) e ir a Inventario → Productos ──────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }

// La preferencia «Ver todos» del selector de modelo SE RECUERDA entre sesiones (`localStorage`), y
// es una decisión de producto: el operario que trabaja con todo el catálogo no tiene que pelearse con
// el filtro cada vez. Para la PRUEBA, en cambio, es una trampa: si quedó encendida de una corrida
// anterior (o de la sonda de turno), el arranque ya no es «solo lo que uso» y las comprobaciones de
// abajo fallan culpando a la app (medido 2026-09-21). Se fuerza el default para la corrida y se
// DEVUELVE como estaba al terminar: la verificación no le cambia la preferencia al local.
const preferenciaOriginal = await evalx(`localStorage.getItem('modelos_ver_todos')`);
await evalx(`localStorage.setItem('modelos_ver_todos','0'); 'ok'`);
const restaurarPreferencia = async () => {
  await evalx(preferenciaOriginal === null
    ? `localStorage.removeItem('modelos_ver_todos'); 'ok'`
    : `localStorage.setItem('modelos_ver_todos', ${JSON.stringify(String(preferenciaOriginal))}); 'ok'`).catch(() => {});
};
/** Cierra cualquier diálogo abierto: un modal (por ejemplo el comprobante) tapa la pantalla y
 *  los clics por coordenadas caen en el velo — la prueba fallaría por el estado, no por el código. */
const cerrarDialogos = async () => {
  for (let i = 0; i < 4; i++) {
    if (await evalx(`document.querySelectorAll('[role="dialog"]').length === 0`)) return true;
    await keyNav('Escape', 'Escape', 27);
    await sleep(700);
  }
  return await evalx(`document.querySelectorAll('[role="dialog"]').length === 0`);
};
await cerrarDialogos();

// La barra lateral puede estar COLAPSADA (sin texto): se navega por el `title`.
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario'))`);
await waitFor(`!!document.querySelector('[data-in-use]')`, 20000);

/** Elige una opción de un `Select` de Radix por TECLADO (los clics por coordenadas son frágiles). */
const elegirSelect = async (ariaLabel, texto) => {
  await clickCenter(`document.querySelector('[aria-label="${ariaLabel}"]')`);
  await sleep(700);
  if (!await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, 6000)) return false;
  for (let i = 0; i < 14; i++) {
    const actual = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText?.trim() ?? null`);
    if (actual === texto) { await keyNav('Enter', 'Enter', 13); await sleep(1000); return true; }
    await keyNav('ArrowDown', 'ArrowDown', 40);
    await sleep(180);
  }
  await keyNav('Escape', 'Escape', 27);
  return false;
};

// ── 2) PRODUCTOS: el check por fila ───────────────────────────────────────────────────────────
const filaVisible = await evalx(`(() => {
  const b = document.querySelector('[data-in-use]');
  return b ? JSON.stringify({ id: Number(b.getAttribute('data-in-use')), estado: b.getAttribute('data-in-use-state'), codigo: b.closest('tr')?.querySelector('[data-product-code]')?.getAttribute('data-product-code') ?? null }) : null;
})()`);
check('F50: la tabla de Productos trae el check «en uso» por fila', !!filaVisible, String(filaVisible));
const fila = filaVisible ? JSON.parse(filaVisible) : null;

if (fila) {
  const enBase = producto(fila.id);
  check('F50: el check de la pantalla dice lo mismo que la base',
    String(enBase.in_use) === fila.estado, `pantalla=${fila.estado} · base=${enBase.in_use} (id ${fila.id})`);
  check('F50: la fila muestra el CÓDIGO del producto y coincide con la base',
    !!fila.codigo && fila.codigo === enBase.code && /^P-\d+/.test(String(fila.codigo)),
    `pantalla=${fila.codigo} · base=${enBase.code}`);

  const antes = producto(fila.id);
  await clickCenter(`document.querySelector('[data-in-use="${fila.id}"]')`);
  const alReves = antes.in_use === 1 ? '0' : '1';
  await waitFor(`document.querySelector('[data-in-use="${fila.id}"]')?.getAttribute('data-in-use-state') === '${alReves}'`, 10000);
  await sleep(700);
  const despues = producto(fila.id);
  check('F50: pulsar el check cambia el «en uso» en la BASE',
    despues.in_use === Number(alReves), `antes=${antes.in_use} · después=${despues.in_use}`);
  check('F50: el check NO toca stock, precio ni compatibilidad',
    despues.stock === antes.stock && despues.price_sale === antes.price_sale
    && despues.price_cost === antes.price_cost && despues.compatibility === antes.compatibility,
    `stock ${antes.stock}→${despues.stock} · venta ${antes.price_sale}→${despues.price_sale} · costo ${antes.price_cost}→${despues.price_cost}`);
  await clickCenter(`document.querySelector('[data-in-use="${fila.id}"]')`);
  await waitFor(`document.querySelector('[data-in-use="${fila.id}"]')?.getAttribute('data-in-use-state') === '${antes.in_use === 1 ? '1' : '0'}'`, 10000);
  await sleep(700);
  check('F50: el segundo clic lo devuelve a como estaba',
    producto(fila.id).in_use === antes.in_use, `base=${producto(fila.id).in_use} · original=${antes.in_use}`);
}

// ── 3) buscar por CÓDIGO ─────────────────────────────────────────────────────────────────────
const escribirBusqueda = async (selector, texto) => {
  await clickCenter(`document.querySelector('${selector}')`);
  await evalx(`(() => { const i = document.querySelector('${selector}'); i.select(); return true; })()`);
  await keyNav('Backspace', 'Backspace', 8);
  if (texto) await insertText(texto);
  await sleep(1400);
};
if (fila?.codigo) {
  const inputProductos = 'input[placeholder^="Buscar por producto"]';
  await escribirBusqueda(inputProductos, fila.codigo);
  const hallado = await evalx(`[...document.querySelectorAll('[data-in-use]')].map(b => Number(b.getAttribute('data-in-use')))`);
  check(`F50: el producto se encuentra escribiendo su código «${fila.codigo}»`,
    Array.isArray(hallado) && hallado.includes(fila.id), JSON.stringify(hallado));
  await escribirBusqueda(inputProductos, fila.codigo.replace('-', ''));
  const hallado2 = await evalx(`[...document.querySelectorAll('[data-in-use]')].map(b => Number(b.getAttribute('data-in-use')))`);
  check('F50: y también sin el guion (como se teclea rápido)',
    Array.isArray(hallado2) && hallado2.includes(fila.id), JSON.stringify(hallado2));
  await escribirBusqueda(inputProductos, '');
}

// ── 4) los FILTROS «lo que uso» / «lo que NO uso» ─────────────────────────────────────────────
const totalUso = cuenta(`SELECT COUNT(*) AS n FROM products WHERE COALESCE(in_use,1)=1`);
const totalApagado = cuenta(`SELECT COUNT(*) AS n FROM products WHERE COALESCE(in_use,1)=0`);
const totalPhones = cuenta(`SELECT COUNT(*) AS n FROM phones`);
console.log(`· base: ${totalUso} productos en uso · ${totalApagado} apagados · ${totalPhones} teléfonos en el padrón`);
check('F50: hay productos apagados que esconder (si no, la prueba no diría nada)',
  totalApagado > 0 && totalUso > 0, `uso=${totalUso} · apagados=${totalApagado}`);

const filtro = await elegirSelect('Filtrar por stock', 'Solo lo que uso');
check('F50: el filtro «Solo lo que uso» está en el desplegable de Stock', filtro);
if (filtro) {
  const visibles = await evalx(`[...document.querySelectorAll('[data-in-use-state]')].map(b => b.getAttribute('data-in-use-state'))`);
  check('F50: con ese filtro TODAS las filas están en uso',
    Array.isArray(visibles) && visibles.length > 0 && visibles.every(v => v === '1'), JSON.stringify(visibles));
}
await elegirSelect('Filtrar por stock', 'Lo que NO uso (apagado)');
const visiblesOff = await evalx(`[...document.querySelectorAll('[data-in-use-state]')].map(b => b.getAttribute('data-in-use-state'))`);
check('F50: el filtro inverso trae solo los apagados',
  Array.isArray(visiblesOff) && visiblesOff.length > 0 && visiblesOff.every(v => v === '0'), JSON.stringify(visiblesOff));
await elegirSelect('Filtrar por stock', 'Todo el catálogo');

// ── 5) MODELOS (el padrón): el check por modelo apaga/prende sus repuestos ────────────────────
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /^Modelos/.test(t.innerText.trim()))`);
await waitFor(`!!document.querySelector('[data-phone-in-use]')`, 25000);

// un modelo APAGADO (para prender y devolverlo a como estaba) que tenga repuestos
const objetivo = uno(`SELECT id, name, COALESCE(code,'') AS code, COALESCE(in_use,0) AS in_use
                      FROM phones WHERE COALESCE(in_use,0)=0 ORDER BY id LIMIT 1`);
check('F50: hay un modelo apagado en el padrón para probar el check', !!objetivo.id,
  objetivo.id ? `${objetivo.name} (${objetivo.code})` : 'no se encontró');

if (objetivo.id) {
  await escribirBusqueda('input[placeholder^="Buscar por teléfono"]', objetivo.name);
  await waitFor(`!!document.querySelector('[data-phone-in-use="${objetivo.id}"]')`, 15000);

  const codigoModelo = await evalx(`document.querySelector('[data-phone="${objetivo.id}"] [data-phone-code]')?.getAttribute('data-phone-code') ?? null`);
  check('F50: el padrón muestra el CÓDIGO del modelo y coincide con la base',
    !!codigoModelo && codigoModelo === objetivo.code, `pantalla=${codigoModelo} · base=${objetivo.code}`);
  const estadoBtn = await evalx(`document.querySelector('[data-phone-in-use="${objetivo.id}"]')?.getAttribute('data-phone-in-use-state')`);
  check('F50: el check del modelo refleja la base (apagado)',
    String(objetivo.in_use) === estadoBtn, `pantalla=${estadoBtn} · base=${objetivo.in_use}`);

  // Los repuestos del modelo salen del BACKEND (misma unión clave + alias que el padrón): así la
  // comprobación no depende de un LIKE parecido pero distinto.
  const detalle = await evalx(`(async () => {
    const d = await window.__TAURI_INTERNALS__.invoke('get_phone_detail', { phoneId: ${objetivo.id} });
    return d ? JSON.stringify((d.blocks || []).flatMap(b => (b.items || []).map(i => i.id))) : null;
  })()`);
  const idsRep = detalle ? JSON.parse(detalle) : [];
  const enUsoAhora = () => cuenta(`SELECT COUNT(*) AS n FROM products WHERE id IN (${idsRep.join(',') || '0'}) AND COALESCE(in_use,1)=1`);

  await clickCenter(`document.querySelector('[data-phone-in-use="${objetivo.id}"]')`);
  await waitFor(`document.querySelector('[data-phone-in-use="${objetivo.id}"]')?.getAttribute('data-phone-in-use-state') === '1'`, 15000);
  await sleep(900);
  const trasPrender = uno(`SELECT COALESCE(in_use,0) AS in_use FROM phones WHERE id=?1`, objetivo.id).in_use;
  check('F50: «usar todo el modelo» prende el teléfono Y sus repuestos (una sola acción)',
    trasPrender === 1 && idsRep.length > 0 && enUsoAhora() === idsRep.length,
    `teléfono=${trasPrender} · repuestos en uso=${enUsoAhora()}/${idsRep.length}`);

  await clickCenter(`document.querySelector('[data-phone-in-use="${objetivo.id}"]')`);
  await waitFor(`document.querySelector('[data-phone-in-use="${objetivo.id}"]')?.getAttribute('data-phone-in-use-state') === '0'`, 15000);
  await sleep(900);
  const trasApagar = uno(`SELECT COALESCE(in_use,0) AS in_use FROM phones WHERE id=?1`, objetivo.id).in_use;
  check('F50: y apagarlo deja el teléfono y sus repuestos como estaban (nada a medias)',
    trasApagar === 0 && enUsoAhora() === 0,
    `teléfono=${trasApagar} · repuestos en uso=${enUsoAhora()}/${idsRep.length}`);
}

// ── 6) EL REGISTRO DE SERVICIO: solo lo que uso (y «ver todos») ───────────────────────────────
await evalx(`(() => {
  const it = [...document.querySelectorAll('aside a, aside button')].find(b => /servicio/i.test(b.textContent || ''));
  if (it) it.click();
  return !!it;
})()`);
await sleep(1500);
await cerrarDialogos();
const hayNuevo = await waitFor(`[...document.querySelectorAll('button')].some(b => /Nuevo Servicio/.test(b.innerText || ''))`, 15000);
check('F50: la pantalla de Servicio Técnico ofrece «Nuevo Servicio»', hayNuevo,
  String(await evalx(`document.querySelector('main h1')?.innerText ?? document.body.innerText.slice(0, 60)`)));
// clic por DOM (no por coordenadas): no depende de que no haya nada encima del botón
await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nuevo Servicio/.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
const abrio = await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 12000);
check('F50: «Nuevo Servicio» abre el wizard (para probar el selector de modelo)', abrio);

// paso 1 → paso 2 (Equipos): cliente + cédula y «Siguiente»
// OJO (medido 2026-09-21): `typeText` manda las TECLAS AL ELEMENTO ENFOCADO. Si el clic al campo cae
// mientras el diálogo de Radix todavía se está abriendo (animación), el campo NO queda enfocado, el
// texto se pierde en el vacío y el paso 1 nunca se completa: la prueba fallaba diciendo «no se llega
// a Equipos» con la app perfecta. Por eso se comprueba el FOCO y el VALOR, y se dice cuál falló.
const enfocar = async (sel, intentos = 6) => {
  for (let i = 0; i < intentos; i++) {
    await clickCenter(sel).catch(() => {});
    if (await evalx(`document.activeElement === (${sel})`).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const campoCliente = `document.querySelector('[role="dialog"] input[placeholder^="Buscar por nombre"]')`;
const campoCi = `document.querySelector('[role="dialog"] input[placeholder="V-12345678"]')`;
const focoCliente = await enfocar(campoCliente);
await typeText('Prueba Uso Modelos');
const focoCi = await enfocar(campoCi);
await typeText('V-99999999');
await sleep(400);
const escritos = await evalx(`JSON.stringify({ cliente: (${campoCliente})?.value ?? null, ci: (${campoCi})?.value ?? null })`);
const esc = JSON.parse(String(escritos ?? '{}'));
check('F50: el cliente y la cédula quedaron escritos en el paso 1 (si no, el paso no avanza)',
  focoCliente && focoCi && /Prueba Uso Modelos/.test(String(esc.cliente)) && /99999999/.test(String(esc.ci)),
  `foco=${focoCliente}/${focoCi} · campos=${escritos}`);
// clic por DOM (no por coordenadas): el pie del wizard se MUEVE cuando desaparece la línea «Falta: …»
// al completar el cliente, y un clic por coordenadas cae al lado (lección de las pruebas CDP).
// Además se ESPERA la transición y se reintenta: un clic puede perderse mientras React procesa lo
// que se acaba de teclear (el botón queda `disabled` un instante y `click()` no hace nada, sin error).
const irAEquipos = async () => {
  for (let i = 0; i < 4; i++) {
    if (/Paso 2 de 4/.test(String(await evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)))) return true;
    await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim())); if (b && !b.disabled) b.click(); return !!b; })()`);
    if (await waitFor(`/Paso 2 de 4/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 3000)) return true;
  }
  return false;
};
const enEquipos = await irAEquipos();
check('F50: se llega al paso de Equipos (donde vive el selector de modelo)', enEquipos,
  String(await evalx(`(document.querySelector('[role="dialog"]')?.innerText ?? '').split('\\n').find(l => /Paso \\d+ de \\d+/.test(l)) ?? null`)));

/** Lee las pantallas que el formulario ofrece para el modelo elegido. */
const pantallasOfrecidas = () => evalx(`(() => {
  const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => /Pantalla a instalar/.test(x.innerText || ''));
  const cont = l?.parentElement?.querySelector('div.overflow-y-auto');
  return cont ? cont.querySelectorAll('button').length : -1;
})()`);
const pantallasDelBackend = (modelo) => evalx(`(async () => {
  const r = await window.__TAURI_INTERNALS__.invoke('find_compatible_products', { model: ${JSON.stringify(modelo)}, categoryId: null, limit: 80 });
  return r.filter(x => x.product.category_id === 1).length;
})()`);

if (enEquipos) {
  await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')`);
  await waitFor(`document.querySelector('[data-model-scope]') !== null`, 10000);
  const alcance = await evalx(`document.querySelector('[data-model-scope]')?.innerText?.trim() ?? null`);
  const botonTodos = await evalx(`document.querySelector('[data-model-all]')?.getAttribute('data-model-all')`);
  const opciones = await evalx(`[...document.querySelectorAll('[data-model-option]')].map(b => ({ l: b.getAttribute('data-model-option'), u: b.getAttribute('data-model-in-use') }))`);
  const listaUso = Array.isArray(opciones) ? opciones : [];
  console.log(`· alcance: «${alcance}» · opciones ofrecidas: ${listaUso.length}`);
  check('F50: el selector arranca en «solo los modelos que usás» y lo dice',
    botonTodos === '0' && /solo los modelos que us/i.test(String(alcance)), `alcance=«${alcance}» · data-model-all=${botonTodos}`);
  check('F50: TODAS las opciones ofrecidas están en uso en la base',
    listaUso.length > 0 && listaUso.every(o => o.u === '1'), JSON.stringify(listaUso.filter(o => o.u !== '1').slice(0, 5)));
  check('F50: la lista corta es de verdad más corta que el padrón completo',
    listaUso.length > 0 && listaUso.length < totalPhones,
    `${listaUso.length} ofrecidas vs ${totalPhones} teléfonos en el padrón`);
  const conCodigo = await evalx(`[...document.querySelectorAll('[data-model-option]')].filter(b => /M-\\d+/.test(b.innerText)).length`);
  check('F50: cada modelo del selector muestra su CÓDIGO (M-…)',
    Number(conCodigo) === listaUso.length && listaUso.length > 0, `${conCodigo}/${listaUso.length} con código`);

  // ── «Ver todos» con una BÚSQUEDA: el modelo apagado de una reparación puntual ───────────────
  // OJO: con el campo vacío las dos listas traen 60 (el tope del selector, y los que están en uso
  // van primero), así que comparar dos listas vacías no diría NADA. La prueba honesta es buscar un
  // modelo APAGADO concreto: con «solo lo que uso» no está, con «ver todos» sí (con su aviso).
  const campoModelo = 'input[placeholder^="Buscar el modelo del teléfono"]';
  const apagadoConPantallas = uno(
    `SELECT ph.id, ph.name, COALESCE(ph.code,'') AS code FROM phones ph
      WHERE COALESCE(ph.in_use,0)=0 AND length(ph.name) BETWEEN 3 AND 14
        AND EXISTS (SELECT 1 FROM products p WHERE p.category_id=1
                     AND COALESCE(p.compatibility,'') LIKE '%'||ph.model||'%')
      ORDER BY ph.id LIMIT 1`);
  check('F50: hay un modelo apagado con pantallas para la reparación puntual',
    !!apagadoConPantallas.id, `${apagadoConPantallas.name} (${apagadoConPantallas.code})`);

  if (apagadoConPantallas.id) {
    await escribirBusqueda(campoModelo, apagadoConPantallas.name);
    await waitFor(`[...document.querySelectorAll('[data-model-option]')].length >= 0 && document.querySelector('[data-model-scope]') !== null`, 8000);
    await sleep(900);
    const soloUso = await evalx(`[...document.querySelectorAll('[data-model-option]')].map(b => b.getAttribute('data-model-option'))`);
    check('F50: con «solo lo que uso» el modelo APAGADO no se ofrece (no ensucia la búsqueda)',
      Array.isArray(soloUso) && !soloUso.includes(apagadoConPantallas.name),
      `«${apagadoConPantallas.name}» entre ${JSON.stringify(soloUso)}`);

    // Clic por DOM, no por coordenadas: el interruptor vive dentro de un popover de Radix y un clic
    // por coordenadas puede caer al lado (o el popover se reposiciona) → el toggle no cambiaba y las
    // dos comprobaciones de abajo fallaban culpando a la app (medido 2026-09-21). Y se EXIGE el
    // cambio: si el toggle no responde, se dice acá y no tres comprobaciones más tarde.
    await evalx(`(() => { const b = document.querySelector('[data-model-all]'); if (b) b.click(); return !!b; })()`);
    const cambioToggle = await waitFor(`document.querySelector('[data-model-all]')?.getAttribute('data-model-all') === '1'`, 8000);
    check('F50: el interruptor «Ver todos» cambia de estado al pulsarlo', cambioToggle,
      `data-model-all=${await evalx(`document.querySelector('[data-model-all]')?.getAttribute('data-model-all') ?? null`)}`);
    const aparecio = await waitFor(
      `[...document.querySelectorAll('[data-model-option]')].some(b => b.getAttribute('data-model-option') === ${JSON.stringify(apagadoConPantallas.name)})`, 15000);
    const infoApagado = await evalx(`(() => {
      const b = [...document.querySelectorAll('[data-model-option]')].find(x => x.getAttribute('data-model-option') === ${JSON.stringify(apagadoConPantallas.name)});
      return b ? JSON.stringify({ u: b.getAttribute('data-model-in-use'), txt: b.innerText.replace(/\\s+/g,' ').trim() }) : null;
    })()`);
    const ap = infoApagado ? JSON.parse(infoApagado) : null;
    check('F50: «Ver todos» SÍ lo trae (la reparación puntual sigue siendo posible)',
      aparecio && ap?.u === '0', `opción=${infoApagado}`);
    check('F50: y lo anuncia como «sin usar» (no aparece por sorpresa)',
      !!ap && /sin usar/i.test(ap.txt) && /M-\d+/.test(ap.txt), String(ap?.txt));

    // Se elige ese modelo APAGADO y se comprueba que su lista de PANTALLAS no se filtra por «en uso».
    await clickCenter(`([...document.querySelectorAll('[data-model-option]')].find(b => b.getAttribute('data-model-option') === ${JSON.stringify(apagadoConPantallas.name)}) || null)`);
    await sleep(1800);
    let enPantalla = await pantallasOfrecidas();
    if (enPantalla === -1) {
      // «Cambio pantalla» no estaba activo en el equipo: se activa (es el trabajo del local)
      await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Cambio pantalla$/.test(b.innerText.trim())) || null)`);
      await sleep(1500);
      enPantalla = await pantallasOfrecidas();
    }
    const delBackend = Number(await pantallasDelBackend(apagadoConPantallas.name));
    check('F50: la lista de PANTALLAS del modelo NO se filtra por «en uso» (se sigue pudiendo elegir la que hay que instalar)',
      delBackend > 0 && Number(enPantalla) === delBackend,
      `modelo «${apagadoConPantallas.name}» (apagado) → pantalla=${enPantalla} · backend=${delBackend}`);
  }

  // volver a «solo lo que uso» (con el campo vacío, como trabaja el taller)
  //
  // F66b — ELEGIR UN MODELO AHORA CIERRA EL DESPLEGABLE (antes quedaba abierto por un bug: el
  // `focus()` posterior al elegir disparaba `onFocus → setOpen(true)` y había que clickear dos veces
  // para cerrarlo). Esta prueba seguía clickeando DENTRO de la lista después de elegir, o sea que
  // dependía del bug: ahora hay que volver a abrirla (foco en el campo) antes de tocar el interruptor.
  await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')`);
  await waitFor(`document.querySelector('[data-model-all]') !== null`, 8000);
  // Por DOM y no por coordenadas, por lo mismo que dice el bloque de arriba: el interruptor vive en
  // un popover y el clic por coordenadas puede caer en el overlay (y cerrar el wizard entero).
  await evalx(`(() => { const b = document.querySelector('[data-model-all]'); if (b) b.click(); return !!b; })()`);
  await waitFor(`document.querySelector('[data-model-all]')?.getAttribute('data-model-all') === '0'`, 8000);
  await escribirBusqueda(campoModelo, '');
  await waitFor(`[...document.querySelectorAll('[data-model-option]')].length > 0`, 12000);
  await sleep(900);
  const volvio = await evalx(`[...document.querySelectorAll('[data-model-option]')].map(b => b.getAttribute('data-model-in-use'))`);
  check('F50: volver a «Ver solo lo que uso» deja otra vez solo lo marcado',
    Array.isArray(volvio) && volvio.length > 0 && volvio.every(v => v === '1'), JSON.stringify(volvio?.slice(0, 6)));
  const alcance2 = await evalx(`document.querySelector('[data-model-scope]')?.innerText?.trim() ?? null`);
  check('F50: el rótulo del alcance acompaña al interruptor',
    /solo los modelos que us/i.test(String(alcance2)), `alcance=«${alcance2}»`);
  const persistido = await evalx(`localStorage.getItem('modelos_ver_todos')`);
  check('F50: el alcance elegido se recuerda (no hay que pelear con el filtro cada vez)',
    persistido === '0', `localStorage modelos_ver_todos=${persistido}`);
}

// ── 7) cerrar sin guardar: esta prueba NO crea órdenes ────────────────────────────────────────
await keyNav('Escape', 'Escape', 27);
await sleep(900);
const dialogos = await evalx(`document.querySelectorAll('[role="dialog"]').length`);
check('F50: se cierra el wizard sin guardar (no se creó ninguna orden)', Number(dialogos) === 0, `${dialogos} diálogo(s)`);
const ordenesPrueba = cuenta(`SELECT COUNT(*) AS n FROM services WHERE client LIKE '%Prueba Uso Modelos%'`);
check('F50: la base no quedó con órdenes de prueba', ordenesPrueba === 0, `${ordenesPrueba} órdenes`);
const usoFinal = cuenta(`SELECT COUNT(*) AS n FROM products WHERE COALESCE(in_use,1)=1`);
const apagadoFinal = cuenta(`SELECT COUNT(*) AS n FROM products WHERE COALESCE(in_use,1)=0`);
check('F50: la base quedó sana (quick_check) y con los checks como estaban',
  uno('PRAGMA quick_check').quick_check === 'ok' && usoFinal === totalUso && apagadoFinal === totalApagado,
  `en uso=${usoFinal}/${totalUso} · apagados=${apagadoFinal}/${totalApagado}`);

const failed = out.filter(r => !r.ok);
await restaurarPreferencia();
// Se devuelven las fichas/modelos que la PRUEBA apagó para tener qué probar (F66b): la copia queda
// como estaba antes de correr, incluido lo que el local tenía apagado a propósito.
devolverFixture(fixtureTocado);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
