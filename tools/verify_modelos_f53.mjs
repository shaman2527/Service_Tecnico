// VERIFICACIÓN EN VIVO (CDP) de F53 — UN SOLO NOMBRE POR MODELO, REFERENCIA Y DUPLICADOS.
//
// Pedido del dueño (2026-09-20): «cuando yo busco un Samsung A70 me sale también A705 — ya este viene
// siendo otro modelo de tlf; debería salir una sola por modelo… si no existe ese modelo se agrega como
// un registro nuevo, modelo con su variante y compatibilidades» + «esos mismos modelos tienen que
// tener referencia: qué pantalla va a seleccionar para ese modelo» + «existen varios duplicados».
//
// Qué comprueba sobre la app REAL (y contra la BASE leída aparte, nunca contra sí misma):
//   1. **Vista previa** en Inventario → Ajustes: dice cuántos teléfonos aparecen y cuáles se separan…
//      y **no escribe nada** (la base sigue con los nombres pegados).
//   2. **Aplicar**: el nombre pegado («Samsung A70 A705») desaparece, aparecen los modelos reales
//      numerados (`M-…`) y marcados «en uso», y **la pantalla queda compatible con LOS DOS**.
//   3. **Nada de plata ni de stock**: unidades, capital, movimientos, ventas y órdenes quedan
//      EXACTAMENTE igual (comparado contra `node:sqlite` antes/después).
//   4. **La pantalla de referencia del modelo** se auto-selecciona al registrar el servicio
//      (el operario la ve elegida sola en «Pantalla a instalar»).
//   5. **El asistente de modelos repetidos**: propone grupos con VISTA PREVIA (qué nombre queda y qué
//      nombres se conservan como alias) y al juntar uno el teléfono repetido desaparece, el que queda
//      se lleva los alias viejos y el stock/precio NO se mueven.
//
// SEGURIDAD DE DATOS: trabaja SIEMPRE sobre una COPIA (`REGISTRO_DB`) y deja respaldo propio de la app
// antes de escribir. No toca la base del local.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f53_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_modelos_f53.mjs

import { evalx, clickCenter, keyNav, typeText, insertText, sleep, handleDialog, escribirEn } from './cdp_driver.mjs';
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

// ── 0) GATE y FOTO DE LA BASE (la verdad independiente) ───────────────────────────────────────
// OJO (lección de esta prueba): la conexión se ABRE Y SE CIERRA en cada consulta. Una conexión
// `node:sqlite` de larga vida sobre una base en WAL puede quedar leyendo una foto vieja y hacer
// creer que la app no escribió nada (o que escribió a medias) cuando en realidad ya terminó.
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
const filas = (sql, ...p) => {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  try { return d.prepare(sql).all(...p); } catch (e) { return [{ err: String(e.message) }]; } finally { d.close(); }
};
const uno = (sql, ...p) => filas(sql, ...p)[0] ?? {};
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const invokeJson = (cmd, args = {}) => evalx(`(async () => {
  const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)});
  return r === undefined || r === null ? null : JSON.stringify(r);
})()`);

/** Foto de lo que NO se puede mover (plata, stock, movimientos, órdenes). */
const foto = () => ({
  phones: Number(uno('SELECT COUNT(*) AS n FROM phones').n),
  maxId: Number(uno('SELECT COALESCE(MAX(id),0) AS n FROM phones').n),
  pegados: filas(`SELECT name FROM phones`).filter(r => {
    const palabras = String(r.name).split(/\s+/).filter(Boolean);
    const codigos = palabras.filter(w => /[a-z]/i.test(w) && /\d/.test(w) && !/^[2-5]g$/i.test(w));
    return codigos.length >= 2;
  }).length,
  unidades: Number(uno('SELECT COALESCE(SUM(stock),0) AS n FROM products').n),
  aCosto: Number(uno('SELECT COALESCE(SUM(stock * COALESCE(price_cost,0)),0) AS n FROM products').n),
  aVenta: Number(uno('SELECT COALESCE(SUM(stock * COALESCE(price_sale,0)),0) AS n FROM products').n),
  precios: Number(uno('SELECT COALESCE(SUM(COALESCE(price_sale,0)),0) AS n FROM products').n),
  movimientos: Number(uno('SELECT COUNT(*) AS n FROM inventory_movements').n),
  sinCodigo: Number(uno("SELECT COUNT(*) AS n FROM phones WHERE code IS NULL OR code=''").n),
  ordenes: Number(uno('SELECT COUNT(*) AS n FROM services').n),
  ventas: Number(uno('SELECT COUNT(*) AS n FROM sales').n),
  pagos: Number(uno('SELECT COUNT(*) AS n FROM service_payments').n),
});
const antes = foto();
console.log(`· antes: ${antes.phones} teléfonos (${antes.pegados} con nombres pegados) · ${antes.unidades} unidades · ${antes.movimientos} movimientos · ${antes.ordenes} órdenes`);

// ── 1) abrir la app e ir a Inventario → Ajustes ───────────────────────────────────────────────
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
await evalx(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find(x => /^Ajustes/.test(x.innerText.trim())); if (t) t.click(); return !!t; })()`);
const enAjustes = await waitFor(`!!document.querySelector('[data-action="revisar-modelos"]')`, 20000);
check('F53: en Ajustes está la tarjeta «Modelos de teléfono (uno por teléfono real)»', enAjustes);

// ── 2) VISTA PREVIA: dice qué cambia y NO escribe nada ───────────────────────────────────────
await clickCenter(`document.querySelector('[data-action="revisar-modelos"]')`);
const hayInforme = await waitFor(`!!document.querySelector('[data-split-report]')`, 25000);
const informe = await evalx(`(() => {
  const r = document.querySelector('[data-split-report]');
  return r ? JSON.stringify({
    creados: Number(r.getAttribute('data-split-report')),
    texto: r.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
    removidos: [...document.querySelectorAll('[data-split-removed] span')].map(s => s.innerText.trim()).slice(1, 6),
  }) : null;
})()`);
const inf = informe ? JSON.parse(informe) : null;
check('F53: la vista previa dice cuántos teléfonos aparecen', hayInforme && (inf?.creados ?? 0) > 0,
  inf ? `${inf.creados} nuevos · ${JSON.stringify(inf.removidos)}` : 'sin informe');
check('F53: la vista previa muestra los NOMBRES pegados que se van a separar',
  (inf?.removidos?.length ?? 0) > 0 && inf.removidos.some(n => /A\d{2,}.*A\d{2,}/i.test(n)),
  JSON.stringify(inf?.removidos));
const sinCambios = foto();
check('F53: la vista previa NO escribió nada en la base (mismo padrón que antes)',
  sinCambios.phones === antes.phones && sinCambios.pegados === antes.pegados,
  `${antes.phones}→${sinCambios.phones} teléfonos · pegados ${antes.pegados}→${sinCambios.pegados}`);

// ── 3) APLICAR: separar los modelos ──────────────────────────────────────────────────────────
await evalx(`(() => { const b = document.querySelector('[data-action="aplicar-modelos"]'); if (b) b.click(); return !!b; })()`);
await sleep(1500);
await handleDialog(true);   // el confirm() del diálogo de la app
// EL FIN SE ESPERA POR EL ESTADO DE LA BASE, no por el conteo ni por el texto: la operación
// reconstruye el padrón (medido: ~4 s con 201 teléfonos nuevos) y SQLite deja ver las filas a
// medida que se insertan. Esperar «cambió el número de teléfonos» hacía medir a MITAD de camino
// (y parecía que la app había dejado el trabajo por la mitad). Se espera el estado FINAL:
// sin nombres pegados, sin filas sin código y con el padrón más grande.
let aplicado = false;
for (let i = 0; i < 90 && !aplicado; i++) {
  await sleep(1000);
  if (i === 0 || i % 5 === 0) await handleDialog(true);
  const f = foto();
  if (f.pegados === 0 && f.sinCodigo === 0 && f.phones > antes.phones) aplicado = true;
}
await sleep(1500);
const informeAplicado = await evalx(`document.querySelector('[data-split-report]')?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? null`);
const despues = foto();
console.log(`· después: ${despues.phones} teléfonos (${despues.pegados} pegados · ${despues.sinCodigo} sin código) · informe: «${informeAplicado}»`);
check('F53: aplicar la separación deja el padrón SIN nombres pegados y con TODOS los modelos numerados',
  aplicado && despues.pegados === 0 && despues.sinCodigo === 0 && despues.phones > antes.phones,
  `${antes.phones} → ${despues.phones} teléfonos · pegados ${antes.pegados} → ${despues.pegados} · sin código ${despues.sinCodigo}`);
// Al terminar, la app refresca y VUELVE a la pestaña Productos (es lo que hace `onChanged`): el informe
// de Ajustes ya no está a la vista, así que lo que se comprueba es que la app quedó usable y en Productos.
const volvioAProductos = await waitFor(`!!document.querySelector('[data-view="lista"]')`, 15000);
check('F53: al terminar, la app refresca y deja el inventario listo en Productos',
  volvioAProductos, `informe visible: ${informeAplicado !== null}`);
check('F53: NO se movió nada de plata ni de stock (unidades, capital, movimientos, órdenes, ventas, pagos)',
  despues.unidades === antes.unidades && despues.aCosto === antes.aCosto
  && despues.aVenta === antes.aVenta && despues.precios === antes.precios
  && despues.movimientos === antes.movimientos && despues.ordenes === antes.ordenes
  && despues.ventas === antes.ventas && despues.pagos === antes.pagos,
  `unidades ${antes.unidades}→${despues.unidades} · costo ${antes.aCosto}→${despues.aCosto} · movs ${antes.movimientos}→${despues.movimientos}`);

// los teléfonos nuevos: numerados, en uso y con la pantalla compatible con LOS DOS
const nuevos = filas(`SELECT id, name, COALESCE(code,'') AS code, COALESCE(in_use,0) AS in_use FROM phones WHERE id > ?1 ORDER BY id`, antes.maxId);
check('F53: los teléfonos nuevos quedan numerados (M-…) y EN USO (su repuesto está en uso y con stock)',
  nuevos.length > 0 && nuevos.every(p => /^M-\d+/.test(p.code)) && nuevos.some(p => p.in_use === 1),
  `${nuevos.length} nuevos · ${JSON.stringify(nuevos.slice(0, 3))}`);

// el caso del dueño: un nombre pegado conocido y sus dos modelos reales, cada uno con la pantalla
const par = filas(`SELECT id, name FROM phones WHERE name LIKE '%A70%' OR name LIKE '%A705%' ORDER BY name`);
const parInfo = await invokeJson('get_phone_detail', { phoneId: par[0]?.id ?? 0 });
check('F53: «Samsung A70 A705» se convirtió en DOS teléfonos reales, cada uno con sus repuestos',
  par.length >= 2 && !!parInfo && JSON.parse(parInfo).blocks.flatMap(b => b.items).length > 0,
  par.map(p => `${p.id}:${p.name}`).join(' · '));

// ── 4) LA PANTALLA DE REFERENCIA se auto-selecciona al registrar ─────────────────────────────
// Se elige un modelo EN USO con varias pantallas compatibles y stock, se fija una referencia distinta
// de la que elegiría la regla vieja, y se comprueba que el formulario la elige SOLA.
const candidato = JSON.parse(await invokeJson('get_phones', {
  brand: null, search: '', onlyWithProducts: true, onlyStock: true, onlyReview: false,
  sort: 'stock', dir: 'desc', limit: 120, offset: 0,
}) ?? '{"items":[]}');
let elegido = null;
for (const m of (candidato.items ?? [])) {
  // OJO: `get_phones` devuelve las filas del PADRÓN (`name`, `products`), no las del selector
  // (`label`, `screens`): pedir los campos equivocados hacía pasar el filtro por accidente
  // (`undefined < 2` es false) y después el nombre quedaba `undefined` en pantalla.
  if (m.in_use !== 1 || Number(m.products) < 2) continue;
  const det = JSON.parse(await invokeJson('get_phone_detail', { phoneId: m.id }) ?? 'null');
  const pantallas = (det?.blocks ?? []).flatMap(b => b.items).filter(p => p.category_id === 1 && p.stock > 0);
  if (pantallas.length >= 2) { elegido = { m, pantallas, label: m.name }; break; }
}
check('F53: hay un modelo en uso con 2+ pantallas para probar la referencia', !!elegido,
  elegido ? `${elegido.label} (${elegido.m.code}) con ${elegido.pantallas.length} pantallas` : 'no se encontró');

if (elegido) {
  // la referencia = la ÚLTIMA de la lista (no la que elegiría la regla «una sola con stock»)
  const ref = elegido.pantallas[elegido.pantallas.length - 1];
  await invoke('set_phone_default_product', { id: elegido.m.id, productId: ref.id });
  await sleep(800);
  const guardada = uno('SELECT default_product_id AS r FROM phones WHERE id=?1', elegido.m.id).r;
  check('F53: la pantalla de referencia queda guardada en el padrón',
    Number(guardada) === Number(ref.id), `referencia=${guardada} (elegida ${ref.id} · ${ref.name})`);

  await evalx(`(() => { const it = [...document.querySelectorAll('aside a, aside button')].find(b => (b.getAttribute('title') || '').startsWith('Servicio')); if (it) it.click(); return !!it; })()`);
  await sleep(1500);
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nuevo Servicio/.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 12000);
  // El cliente es obligatorio para avanzar el wizard (F33/F48) y el texto solo entra si el campo
  // quedó ENFOCADO (ver `escribirEn`): sin esto el paso 1 no avanza, el campo del modelo no existe y
  // la prueba se caía con «click target no encontrado» teniendo la app perfecta (medido 2026-09-21).
  const campoCliente53 = `document.querySelector('[role="dialog"] input[placeholder^="Buscar por nombre"]')`;
  const campoCi53 = `document.querySelector('[role="dialog"] input[placeholder="V-12345678"]')`;
  await escribirEn(campoCliente53, 'Prueba Referencia');
  await escribirEn(campoCi53, 'V-88888888');
  for (let i = 0; i < 4; i++) {
    if (/Paso 2 de 4/.test(String(await evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)))) break;
    await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim())); if (b && !b.disabled) b.click(); return !!b; })()`);
    await waitFor(`/Paso 2 de 4/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 3000);
  }
  await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')`);
  await insertText(elegido.label);
  await waitFor(`[...document.querySelectorAll('[data-model-option]')].some(b => b.getAttribute('data-model-option') === ${JSON.stringify(elegido.label)})`, 15000);
  await clickCenter(`([...document.querySelectorAll('[data-model-option]')].find(b => b.getAttribute('data-model-option') === ${JSON.stringify(elegido.label)}) || null)`);
  // «Cambio pantalla» viene activo en un equipo nuevo; la pantalla se auto-selecciona sola
  const eligioSola = await waitFor(`/Al entregar se descuenta del inventario/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 20000);
  const textoPantalla = await evalx(`(() => {
    const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => /Pantalla a instalar/.test(x.innerText || ''));
    const cont = l?.parentElement;
    const activa = cont?.querySelector('div.overflow-y-auto button.bg-primary\\\\/10') ?? null;
    return JSON.stringify({ activa: activa ? activa.innerText.replace(/\\s+/g, ' ').trim() : null, seccion: /Al entregar se descuenta del inventario/.test(document.querySelector('[role="dialog"]')?.innerText ?? '') });
  })()`);
  const tp = JSON.parse(textoPantalla ?? '{}');
  check('F53: al elegir el modelo, el formulario elige SOLA la pantalla de referencia',
    eligioSola && !!tp.activa && String(tp.activa).includes(String(ref.name).replace(/^Pantalla\s+/i, '').split('/')[0].trim()),
    `elegida en pantalla: «${tp.activa}» · referencia: «${ref.name}»`);
  await keyNav('Escape', 'Escape', 27);
  await sleep(800);
  for (let i = 0; i < 3; i++) {
    if (!await evalx(`!!document.querySelector('[role="dialog"]')`)) break;
    await keyNav('Escape', 'Escape', 27);
    await sleep(600);
  }
  const creada = Number(uno("SELECT COUNT(*) AS n FROM services WHERE client LIKE '%Prueba Referencia%'").n);
  check('F53: la prueba de la referencia no guardó ninguna orden', creada === 0, `${creada} órdenes`);
}

// ── 5) EL ASISTENTE DE MODELOS REPETIDOS (propuesta con vista previa) ────────────────────────
// OJO: después de la prueba del servicio la app quedó en Servicio Técnico: hay que VOLVER al
// Inventario por la barra lateral (buscar la pestaña «Productos» sin haber entrado no hace nada).
await evalx(`(() => { const it = [...document.querySelectorAll('aside a, aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario')); if (it) it.click(); return !!it; })()`);
await sleep(2000);
await evalx(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find(x => /^Productos/.test(x.innerText.trim())); if (t) t.click(); return !!t; })()`);
await waitFor(`!!document.querySelector('[data-view="modelo"]')`, 20000);
for (let i = 0; i < 4; i++) {
  const estado = await evalx(`document.querySelector('[data-view="modelo"]')?.getAttribute('data-view-state')`);
  if (estado === 'on') break;
  await evalx(`(() => { const b = document.querySelector('[data-view="modelo"]'); if (b) b.click(); return !!b; })()`);
  await sleep(1200);
}
const hayBoton = await waitFor(`!!document.querySelector('[data-action="modelos-repetidos"]')`, 25000);
check('F53: la vista «Por modelo» ofrece el asistente de repetidos', hayBoton);
await clickCenter(`document.querySelector('[data-action="modelos-repetidos"]')`);
const hayGrupos = await waitFor(`!!document.querySelector('[data-dup-group]')`, 25000);
const g0 = await evalx(`(() => {
  const g = document.querySelector('[data-dup-group]');
  const p = document.querySelector('[data-dup-preview]');
  return JSON.stringify({
    hay: !!g,
    opciones: g ? [...g.querySelectorAll('[data-dup-option]')].length : 0,
    texto: g ? g.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) : null,
    preview: p ? p.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) : null,
  });
})()`);
const gr = JSON.parse(g0 ?? '{}');
console.log(`· primer grupo: ${g0}`);
check('F53: el asistente propone grupos de modelos repetidos con sus fichas', hayGrupos && (gr.opciones ?? 0) >= 2, `${gr.opciones} fichas`);
check('F53: cada grupo muestra la VISTA PREVIA (qué nombre queda y qué nombres se suman como alias)',
  /Vista previa:/.test(String(gr.preview)) && /queda/.test(String(gr.preview)) && /alias/.test(String(gr.preview)),
  String(gr.preview));

// se juntan las fichas del primer grupo (con respaldo: es una copia) y se comprueba el invariante
const mergeDatos = await evalx(`(() => {
  const g = document.querySelector('[data-dup-group]');
  if (!g) return null;
  const ids = [...g.querySelectorAll('[data-dup-option]')].map(x => Number(x.getAttribute('data-dup-option')));
  return JSON.stringify({ ids });
})()`);
const md = JSON.parse(mergeDatos ?? '{}');
const phonesAntesMerge = Number(uno('SELECT COUNT(*) AS n FROM phones').n);
const stockAntesMerge = Number(uno('SELECT COALESCE(SUM(stock),0) AS n FROM products').n);
const movsAntesMerge = Number(uno('SELECT COUNT(*) AS n FROM inventory_movements').n);
await clickCenter(`document.querySelector('[data-dup-merge="0"]')`);
await sleep(3000);
const phonesTrasMerge = Number(uno('SELECT COUNT(*) AS n FROM phones').n);
const stockTrasMerge = Number(uno('SELECT COALESCE(SUM(stock),0) AS n FROM products').n);
const movsTrasMerge = Number(uno('SELECT COUNT(*) AS n FROM inventory_movements').n);
const idsJuntados = md.ids ?? [];
const quedanIds = idsJuntados.filter(id => Number(uno('SELECT COUNT(*) AS n FROM phones WHERE id=?1', id).n) === 1);
check('F53: al juntar un grupo, las fichas repetidas desaparecen y queda UNA',
  idsJuntados.length >= 2 && quedanIds.length === 1 && phonesTrasMerge === phonesAntesMerge - (idsJuntados.length - 1),
  `${idsJuntados.length} fichas → ${quedanIds.length} · padrón ${phonesAntesMerge} → ${phonesTrasMerge}`);
check('F53: la fusión NO movió stock ni creó movimientos de inventario',
  stockTrasMerge === stockAntesMerge && movsTrasMerge === movsAntesMerge,
  `stock ${stockAntesMerge}→${stockTrasMerge} · movimientos ${movsAntesMerge}→${movsTrasMerge}`);
await keyNav('Escape', 'Escape', 27);
await sleep(800);
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// ── 6) cierre ────────────────────────────────────────────────────────────────────────────────
const final = foto();
check('F53: la base quedó sana', uno('PRAGMA quick_check').quick_check === 'ok', 'quick_check');
check('F53: el saldo de la prueba fue SOLO el padrón (la plata, el stock y las órdenes siguen igual)',
  final.unidades === antes.unidades && final.aCosto === antes.aCosto && final.aVenta === antes.aVenta
  && final.precios === antes.precios && final.ordenes === antes.ordenes && final.ventas === antes.ventas
  && final.pagos === antes.pagos && final.movimientos === antes.movimientos,
  `unidades ${antes.unidades}→${final.unidades} · órdenes ${antes.ordenes}→${final.ordenes} · ventas ${antes.ventas}→${final.ventas}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
