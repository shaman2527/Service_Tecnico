// VERIFICACIÓN EN VIVO (CDP) de F80 — EDITAR LA FICHA DEL REPUESTO **DESDE EL WIZARD** (2026-09-26).
//
// Pedido del dueño: «el cliente me pide, como él usa la master, debería tener un poco más de
// flexibilidad: cuando se hace un registro, para elegir un producto desde el wizard, algo pequeño — un
// icono — poder editarla ahí mismo en el wizard… para no ir a Inventario, buscar el producto y hacer la
// modificación. Poder editar ese producto, cambiarle el precio, etc. Así el registro va depurando, va
// cargando el inventario.» Confirmado: «que también pueda editar la compatibilidad, se refleje en el
// inventario la edición» + «que me sirva, carga también nuevos stock».
//
// Qué comprueba sobre la app REAL (cada caso responde a un hallazgo MEDIDO; los tres primeros los
// encontró la revisión adversarial midiendo en vivo):
//   A. EL ALTA COMO PRIMER DIÁLOGO de la sesión: la pantalla nueva nace en la categoría del padrón
//      (Pantalla) y **aparece en la lista** — la primera versión nacía SIN categoría y no aparecía.
//   F. El alta avisa si ya existe una ficha con ese nombre (medido: creaba fichas gemelas, ids 1179/1180).
//   B. Con el MONTO SIN TOCAR (lo escribió el precio de la pantalla elegida), editar la ficha NO mueve
//      la orden: el precio nuevo se OFRECE con un toque (regla F67). OJO: se mide en un SEGUNDO equipo
//      — el alta del equipo 1 marca el monto como «escrito por el operario» (a propósito: registrar una
//      ficha no puede mover el monto de nadie), así que el equipo 1 ya no sirve para este caso.
//   C. Con el MONTO TECLEADO, tampoco se mueve.
//   D. El lápiz del BUSCADOR LIBRE: editar el precio llega a la fila del resultado Y a la fila de la
//      pantalla ELEGIDA (antes quedaban con el precio viejo y se cobraba el número viejo), y el
//      «+ agregar el modelo» deja la ficha compatible (y la lista la muestra).
//   E. «Ficha completa» NO ofrece Eliminar desde el wizard (borrar la pantalla elegida rompería la
//      entrega) y su Cancelar VUELVE al atajo con lo escrito intacto.
//
// SEGURIDAD DE DATOS: escribe de verdad (es una prueba), así que:
//   · `REGISTRO_DB` es OBLIGATORIO (si falta, ABORTA: nunca se prueba contra la base del local);
//   · NO abre el día y NO guarda ninguna orden: solo toca FICHAS (que restaura) y crea pantallas de
//     prueba (que borra);
//   · al final RECARGA la app (no deja diálogos abiertos, que ensucian la corrida siguiente) y deja el
//     catálogo exactamente como estaba.
//
// Uso:  $env:REGISTRO_DB="C:\...\dev_registro.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_editar_producto_wizard.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const nDialogos = () => evalx(`document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length`);
/** El diálogo de ARRIBA de la pila (con dos abiertos, `[role="dialog"]` a secas devuelve el WIZARD). */
const ULTIMO = `[...document.querySelectorAll('[role="dialog"]')].pop()`;
const ultimoTxt = () => evalx(`(${ULTIMO}?.innerText) ?? null`);
/** La tarjeta de UN equipo del wizard (`data-device="N"`): todo se scopea ahí (multi-equipo real). */
const dev = (n) => `[data-device="${n}"]`;
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};
const setValue = (sel, value) => evalx(`(() => {
  const i = document.querySelector(${JSON.stringify(sel)});
  if (!i) return false;
  const proto = i.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(i, ${JSON.stringify(String(value))});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const clickEn = async (expr) => evalx(`(() => { const b = ${expr}; if (b) b.click(); return !!b; })()`);
/** El botón del diálogo DE ARRIBA con ese texto exacto (el wizard también tiene «Cancelar»). */
const clickDialogExact = async (label) => {
  const ok = await clickEn(`[...(${ULTIMO}?.querySelectorAll('button') ?? [])].find(b => (b.innerText || '').trim() === ${JSON.stringify(label)}) || null`);
  await sleep(700);
  return ok;
};
const clickDialogContiene = async (frag) => {
  const ok = await clickEn(`[...(${ULTIMO}?.querySelectorAll('button') ?? [])].find(b => (b.innerText || '').includes(${JSON.stringify(frag)})) || null`);
  await sleep(700);
  return ok;
};
/** El botón del atajo (Registrar pantalla / Guardar ficha) con su estado. */
const botonAtajo = () => evalx(`(() => {
  const b = document.querySelector('[data-action="prod-guardar"]');
  return b ? { label: (b.innerText || '').trim(), disabled: b.disabled } : null;
})()`);
/** Lo que muestra la fila de una pantalla del equipo N: el precio que se va a TOMAR y su texto. */
const filaDe = (n, id, buscada = false) => evalx(`(() => {
  const b = document.querySelector('${dev(n)} [data-${buscada ? 'screen-buscada' : 'screen-option'}="${id}"]');
  const row = b?.parentElement;
  return b ? { precio: Number(row.querySelector('[data-precio-ficha]')?.getAttribute('data-precio-ficha') ?? NaN), texto: (row.innerText || '').replace(/\\s+/g, ' ').trim() } : null;
})()`);
/** Espera a que la fila del equipo N muestre ese precio (la lista se recarga sola tras editar la ficha). */
const esperarPrecioDeLaFila = (n, id, precio, buscada = false) => waitFor(
  `Number(document.querySelector('${dev(n)} [data-${buscada ? 'screen-buscada' : 'screen-option'}="${id}"]')?.parentElement?.querySelector('[data-precio-ficha]')?.getAttribute('data-precio-ficha') ?? NaN) === ${precio}`, 12000);
const montoActual = (n) => evalx(`(() => { const i = document.querySelector('${dev(n)} input[aria-label^="Monto ($)"]'); return i ? Number(i.value) : null; })()`);
const ofertaPantalla = (n) => evalx(`(() => { const b = document.querySelector('${dev(n)} [data-usar-precio-pantalla]'); return b ? Number(b.getAttribute('data-usar-precio-pantalla')) : null; })()`);
const esperarOferta = (n, precio) => waitFor(`Number(document.querySelector('${dev(n)} [data-usar-precio-pantalla]')?.getAttribute('data-usar-precio-pantalla') ?? NaN) === ${precio}`, 12000);

// ── 0) GATES: copia obligatoria + el cableado de la llave del dueño ──────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  console.error('  Ej.: node tools/seed_dev_db.mjs  y arrancar la app con $env:REGISTRO_DB a esa copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch (e) { return { err: String(e.message) }; } };
const COLUMNAS = 'id, name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock, price_usd';
const ficha = (id) => uno(`SELECT ${COLUMNAS} FROM products WHERE id = ?1`, id);
const productos = () => Number(uno('SELECT COUNT(*) AS n FROM products').n ?? -1);
const antesProductos = productos();
console.log(`· copia: ${dbPath} · ${antesProductos} fichas`);

// El gate real vive en el backend (`require_owner`), así que el cableado de la UI se fija por
// inspección de fuente — el mismo patrón de las pruebas del proyecto.
try {
  const fuente = fs.readFileSync(new URL('../src/components/Services.tsx', import.meta.url), 'utf8');
  check('F80: el wizard dibuja el lápiz SOLO con la llave del dueño (`puedeEditarProducto={ab.manageCatalog}`)',
    /puedeEditarProducto=\{ab\.manageCatalog\}/.test(fuente));
  check('F80: y la llave llega hasta la tarjeta del equipo (no se pierde en el camino)',
    /puedeEditarProducto=\{puedeEditarProducto\}/.test(fuente) && /puedeEditarProducto\?: boolean/.test(fuente));
  const sesion = fs.readFileSync(new URL('../src/lib/session.ts', import.meta.url), 'utf8');
  const caja = sesion.slice(sesion.indexOf('const CAJA'), sesion.indexOf('const CAJA') + 900);
  check('F80: la sesión de CAJA no tiene la llave (no ve el lápiz)', /manageCatalog:\s*false/.test(caja));
} catch (e) {
  check('F80: se pudieron leer las fuentes para el cableado de la llave', false, String(e?.message ?? e));
}

await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 14; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  for (const ch of '1234') {
    await evalx(`(() => {
      const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]');
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, i.value + '${ch}');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await sleep(500);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
await waitFor(`!!document.querySelector('aside button')`, 30000);
await sleep(1000);

const MODELOS = ((await invoke('get_phone_models', { search: '', limit: 60 }).catch(() => [])) ?? []).map(m => m.label).filter(Boolean);
check('hay modelos del padrón para la prueba', MODELOS.length > 0, `${MODELOS.length} modelos`);
if (MODELOS.length === 0) process.exit(1);

const marca = String(Date.now()).slice(-6);
const modeloFantasma = `Zzz Prueba ${marca}`;
let MODELO = null, idEditado = null, original = null, idCreado = null, idBuscada = null, originalBuscada = null;
const tocadas = [];
const recordar = (f) => { if (f?.id && !tocadas.some(t => t.id === f.id)) tocadas.push({ id: f.id, original: f }); };
const EQUIPO_F = 0;   // el equipo del ALTA (la ficha se registra desde acá)
const EQUIPO_P = 1;   // el equipo de la PLATA (monto sin tocar: el alta no lo marcó)
const irAlPasoEquipos = async () => {
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
  await sleep(1500);
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) || null)`);
  if (!(await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000))) return false;
  await setValue('[role="dialog"] input[placeholder^="Buscar por nombre o cédula"]', `Prueba F80 ${marca}`);
  await sleep(300);
  await setValue('[role="dialog"] input[placeholder="V-12345678"]', `V-80${marca}`);
  await sleep(500);
  await clickDialogExact('Siguiente');
  if (!(await waitFor(`!!document.querySelector('${dev(EQUIPO_F)} input[placeholder^="Buscar el modelo del teléfono"]')`, 10000))) return false;
  // F80: el bloque de la pantalla (y su lápiz) vive en el trabajo «Cambio pantalla» — el caso real del
  // mostrador y el único en el que el precio de la ficha mueve el monto (regla F67). OJO: un equipo
  // NUEVO ya nace con ese trabajo marcado (lo midió la sonda: clickearlo lo APAGA), así que solo se
  // toca si el bloque no está.
  if (!(await evalx(`!!document.querySelector('${dev(EQUIPO_F)} [data-screen-buscar-caja]')`))) {
    await clickEn(`(() => {
      const card = document.querySelector('${dev(EQUIPO_F)}');
      return [...(card?.querySelectorAll('button') ?? [])].find(b => (b.innerText || '').trim() === 'Cambio pantalla') || null;
    })()`);
  }
  return waitFor(`!!document.querySelector('${dev(EQUIPO_F)} [data-screen-buscar-caja]')`, 8000);
};

const escribirModelo = async (n, modelo) => {
  await setValue(`${dev(n)} input[placeholder^="Buscar el modelo del teléfono"]`, modelo);
  await sleep(1000);
  const como = await evalx(`(() => {
    const o = document.querySelector('${dev(n)} [data-model-option=${JSON.stringify(modelo)}]');
    if (o) { o.click(); return 'padron'; }
    const libre = [...(${ULTIMO}?.querySelectorAll('button') ?? [])].find(x => /^Usar «/.test((x.innerText || '').trim()));
    if (libre) { libre.click(); return 'fuera-del-padron'; }
    return null;
  })()`);
  await sleep(1500);
  return como;
};

try {
  check('F80: el wizard abre en el paso del EQUIPO con el bloque «Pantalla a instalar» a la vista', await irAlPasoEquipos());

  // ── A) EL ALTA COMO PRIMER DIÁLOGO DE LA SESIÓN (nacía sin categoría y no aparecía) ──────────
  const comoModelo = await escribirModelo(EQUIPO_F, modeloFantasma);
  check('F80: un modelo fuera del padrón queda escrito tal cual (es el caso «no está la pantalla»)', !!comoModelo, String(comoModelo));
  const estadoVacio = await waitFor(`!!document.querySelector('${dev(EQUIPO_F)} [data-screen-vacio]')`, 12000);
  const opcionesVacias = await evalx(`document.querySelectorAll('${dev(EQUIPO_F)} [data-screen-option]').length`);
  check('F80: un modelo sin pantallas muestra el ESTADO VACÍO real (0 opciones) y ofrece registrarla',
    estadoVacio && opcionesVacias === 0, `vacío=${estadoVacio} · opciones=${opcionesVacias}`);
  await clickEn(`document.querySelector('${dev(EQUIPO_F)} [data-screen-vacio] [data-action="registrar-pantalla"]')`);
  const abrioAlta = await waitFor(`document.querySelector('[data-editar-producto-corta]')?.getAttribute('data-editar-producto-corta') === 'alta'`, 10000);
  const alta = await evalx(`(() => {
    const n = document.querySelector('[data-field="prod-nombre"]');
    const c = document.querySelector('[data-field="prod-compat"]');
    return n && c ? { nombre: n.value, compat: c.value, categoria: (document.querySelector('[data-field="prod-categoria"]')?.innerText ?? '').trim(), faltaCategoria: !!document.querySelector('[data-falta-categoria]') } : null;
  })()`);
  check('F80: el alta abre como PRIMER diálogo de la sesión, con nombre y compatibilidad del modelo',
    abrioAlta && /^Pantalla /.test(String(alta?.nombre))
    && String(alta?.compat).toLowerCase().includes(modeloFantasma.toLowerCase()),
    JSON.stringify(alta));
  check('F80: y con la categoría del padrón ya elegida (sin el aviso «elegí una categoría»)',
    alta?.faltaCategoria === false, `trigger=«${alta?.categoria}»`);
  const VENTA_ALTA = 20, STOCK_ALTA = 4;
  await setValue('[data-field="prod-venta"]', VENTA_ALTA);
  await setValue('[data-field="prod-stock"]', STOCK_ALTA);
  await sleep(700);
  check('F80: el atajo del alta se habilita con el nombre y la categoría puestos', (await botonAtajo())?.disabled === false);
  await clickDialogExact('Registrar pantalla');
  await waitFor(`!document.querySelector('[data-editar-producto-corta]')`, 12000);
  await sleep(1800);
  const creada = uno('SELECT id, name, model, compatibility, price_sale, stock, category_id FROM products WHERE model = ?1 AND name LIKE ?2', modeloFantasma, `Pantalla ${modeloFantasma}%`);
  idCreado = creada?.id ?? null;
  const catCreada = uno('SELECT name FROM categories WHERE id = ?1', creada?.category_id);
  check('F80: la pantalla nueva nace en la categoría del padrón (NO sin categoría)',
    !!idCreado && /^pantalla$/i.test(String(catCreada?.name)), `category_id=${creada?.category_id} (${catCreada?.name})`);
  check('F80: con su stock, su precio y su compatibilidad',
    Number(creada?.stock) === STOCK_ALTA && Number(creada?.price_sale) === VENTA_ALTA
    && String(creada?.compatibility ?? '').toLowerCase().includes(modeloFantasma.toLowerCase()),
    `${creada?.name} · stock ${creada?.stock} · $${creada?.price_sale}`);
  check('F80: y APARECE en la lista para elegirla (el inventario quedó cargado de verdad)',
    await waitFor(`!!document.querySelector('${dev(EQUIPO_F)} [data-screen-option="${idCreado}"]')`, 12000));
  const filaCreada = await filaDe(EQUIPO_F, idCreado);
  check('F80: la fila muestra el precio y el stock que se acaban de registrar',
    Number(filaCreada?.precio) === VENTA_ALTA && new RegExp(`stock ${STOCK_ALTA}\\b`).test(String(filaCreada?.texto)),
    `$${filaCreada?.precio} · ${String(filaCreada?.texto).slice(0, 70)}`);

  // F) el alta avisa si ya existe una ficha con ese nombre (dos fichas parten el stock)
  await clickEn(`document.querySelector('${dev(EQUIPO_F)} [data-screen-buscar-caja] [data-action="registrar-pantalla"]')`);
  if (await waitFor(`document.querySelector('[data-editar-producto-corta]')?.getAttribute('data-editar-producto-corta') === 'alta'`, 10000)) {
    const aviso = await waitFor(`!!document.querySelector('[data-producto-existente]')`, 8000);
    const boton = await botonAtajo();
    check('F80: registrar la MISMA pantalla avisa y no deja duplicar la ficha',
      aviso && boton?.disabled === true, `aviso=${aviso} · botón=${JSON.stringify(boton)}`);
    await clickDialogExact('Cancelar');
    await waitFor(`!document.querySelector('[data-editar-producto-corta]')`, 8000);
  } else {
    check('F80: registrar la MISMA pantalla avisa y no deja duplicar la ficha', false, 'no abrió el alta desde el buscador');
  }

  // ── SEGUNDO EQUIPO: acá se mide la PLATA (su monto nunca lo tocó nadie) ──────────────────────
  await clickDialogExact('Agregar otro equipo');
  check('F80: el wizard agrega un segundo equipo (el del alta ya marcó su monto)', await waitFor(`!!document.querySelector('${dev(EQUIPO_P)}')`, 10000));

  // ── B) EL LÁPIZ EN LA LISTA DE COMPATIBILIDAD + EL MONTO QUE NO SE MUEVE SOLO ────────────────
  // El modelo se busca en la app hasta encontrar uno cuya compatibilidad traiga una pantalla CON
  // precio: sin precio no habría «monto que lo escribió la regla» y el caso B sería vacuo.
  let filaElegidaId = null;
  for (const cand of MODELOS.slice(0, 8)) {
    await escribirModelo(EQUIPO_P, cand);
    if (!(await waitFor(`document.querySelectorAll('${dev(EQUIPO_P)} [data-screen-option]').length > 0`, 8000))) continue;
    const filas = JSON.parse(String(await evalx(`JSON.stringify([...document.querySelectorAll('${dev(EQUIPO_P)} [data-screen-option]')].map(b => ({
      id: Number(b.getAttribute('data-screen-option')),
      precio: Number(b.parentElement.querySelector('[data-precio-ficha]')?.getAttribute('data-precio-ficha') ?? NaN),
    })))`) ?? '[]'));
    const conPrecio = filas.find(f => Number.isFinite(f.precio) && f.precio > 0);
    MODELO = cand;
    if (conPrecio) { filaElegidaId = conPrecio.id; break; }
  }
  check('F80: la lista de pantallas compatibles del modelo está a la vista (con precio en la ficha)',
    !!filaElegidaId, `modelo=«${MODELO}» · pantalla=${filaElegidaId}`);
  idEditado = filaElegidaId;
  check('F80: hay una pantalla para editar', !!idEditado, `id=${idEditado}`);
  check('F80: cada fila trae el LÁPIZ (sesión master)',
    (await evalx(`!!document.querySelector('${dev(EQUIPO_P)} [data-editar-producto="${idEditado}"]')`)) === true);
  check('F80: y el lápiz NO es el botón de elegir (son dos acciones distintas)',
    (await evalx(`(() => {
      const b = document.querySelector('${dev(EQUIPO_P)} [data-editar-producto="${idEditado}"]');
      return !!b && b.getAttribute('data-screen-option') === null;
    })()`)) === true);

  original = ficha(idEditado);
  recordar(original);
  check('F80: la ficha de prueba se leyó de la base', !!original?.id, `${original?.name} · venta $${original?.price_sale} · contado $${original?.price_usd} · stock ${original?.stock}`);
  if (!original?.id) throw new Error('no se encontró una pantalla con precio para editar');

  // B) MONTO SIN TOCAR: el operario todavía no escribió nada (lo puso la regla al elegir la pantalla).
  await clickEn(`document.querySelector('${dev(EQUIPO_P)} [data-screen-option="${idEditado}"]')`);
  await sleep(1200);
  const filaAntes = await filaDe(EQUIPO_P, idEditado);
  const montoSinTocar = await montoActual(EQUIPO_P);
  check('F80: al elegir la pantalla, el MONTO lo escribe su precio (regla F67: la fila y el monto coinciden)',
    filaAntes?.precio != null && Number(montoSinTocar) === Number(filaAntes.precio) && Number(montoSinTocar) > 0,
    `fila=$${filaAntes?.precio} · monto=$${montoSinTocar}`);
  // La fila muestra el precio que se TOMA (con efectivo puede ser el de contado): se edita ESE campo.
  const campo = Number(filaAntes?.precio) === Number(original.price_sale) ? 'prod-venta' : 'prod-efectivo';
  const ventaB = Number(filaAntes?.precio) + 3;
  await clickEn(`document.querySelector('${dev(EQUIPO_P)} [data-editar-producto="${idEditado}"]')`);
  await waitFor(`!!document.querySelector('[data-editar-producto-corta]')`, 10000);
  const valores = await evalx(`(() => {
    const v = document.querySelector('[data-field="prod-venta"]');
    const s = document.querySelector('[data-field="prod-stock"]');
    const c = document.querySelector('[data-field="prod-compat"]');
    return v && s && c ? { venta: Number(v.value), stock: Number(s.value), compat: c.value } : null;
  })()`);
  check('F80: el atajo arranca con los valores REALES de la ficha',
    Number(valores?.venta) === Number(original?.price_sale) && Number(valores?.stock) === Number(original?.stock), JSON.stringify(valores));
  check('F80: sin tocar nada, el botón de guardar está apagado (no hay cambios)',
    (await botonAtajo())?.disabled === true);
  const stockB = Number(original.stock) + 4;
  await setValue(`[data-field="${campo}"]`, ventaB);
  await setValue('[data-field="prod-stock"]', stockB);
  await sleep(500);
  check('F80: con cambios, el guardar se habilita', (await botonAtajo())?.disabled === false);
  await clickDialogExact('Guardar ficha');
  await waitFor(`!document.querySelector('[data-editar-producto-corta]')`, 12000);
  await sleep(1500);
  const trasB = ficha(idEditado);
  check('F80: la edición se guardó en la BASE',
    (campo === 'prod-venta' ? Number(trasB?.price_sale) === ventaB : Number(trasB?.price_usd) === ventaB) && Number(trasB?.stock) === stockB,
    `venta $${trasB?.price_sale} · contado $${trasB?.price_usd} · stock ${trasB?.stock}`);
  check('F80: y NO se borró nada del resto (nombre, marca, modelo, variante, compatibilidad, costo, stock mín, categoría)',
    trasB?.name === original.name && trasB?.brand === original.brand && trasB?.model === original.model
    && trasB?.variant === original.variant && trasB?.compatibility === original.compatibility
    && Number(trasB?.price_cost) === Number(original.price_cost) && Number(trasB?.min_stock) === Number(original.min_stock)
    && trasB?.category_id === original.category_id,
    `${trasB?.name} · ${String(trasB?.compatibility).slice(0, 40)}`);
  const filaRefrescada = await esperarPrecioDeLaFila(EQUIPO_P, idEditado, ventaB);
  const filaB = await filaDe(EQUIPO_P, idEditado);
  check('F80: la fila de la lista muestra el PRECIO NUEVO (no queda el viejo)', filaRefrescada,
    `$${filaB?.precio} · ${String(filaB?.texto).slice(0, 70)}`);
  check('F80: y el stock nuevo', new RegExp(`stock ${stockB}\\b`).test(String(filaB?.texto)), String(filaB?.texto).slice(0, 70));
  const montoTrasB = await montoActual(EQUIPO_P);
  check('F80: con el monto SIN TOCAR, la orden no se movió sola',
    Number(montoTrasB) === Number(montoSinTocar), `antes=$${montoSinTocar} · ahora=$${montoTrasB}`);
  const ofertaB = await esperarOferta(EQUIPO_P, ventaB);
  check('F80: y el precio nuevo se OFRECE con un toque (regla F67)', ofertaB,
    `oferta=$${await ofertaPantalla(EQUIPO_P)} · fila=$${filaB?.precio}`);

  // C) MONTO TECLEADO: tampoco se mueve
  const MONTO = 30;
  await setValue(`${dev(EQUIPO_P)} input[aria-label^="Monto ($)"]`, MONTO);
  await sleep(700);
  check('F80: el monto tecleado es el que queda', Number(await montoActual(EQUIPO_P)) === MONTO, `monto=$${await montoActual(EQUIPO_P)}`);
  const ventaC = ventaB + 2;
  await clickEn(`document.querySelector('${dev(EQUIPO_P)} [data-editar-producto="${idEditado}"]')`);
  await waitFor(`!!document.querySelector('[data-editar-producto-corta]')`, 10000);
  await setValue(`[data-field="${campo}"]`, ventaC);
  await sleep(500);
  await clickDialogExact('Guardar ficha');
  await waitFor(`!document.querySelector('[data-editar-producto-corta]')`, 12000);
  await sleep(1500);
  const montoC = await montoActual(EQUIPO_P);
  check('F80: con el monto TECLEADO, la orden tampoco se movió', Number(montoC) === MONTO, `monto=$${montoC}`);
  check('F80: y sigue ofreciendo el precio corregido de la ficha', await esperarOferta(EQUIPO_P, ventaC),
    `oferta=$${await ofertaPantalla(EQUIPO_P)} · fila=$${(await filaDe(EQUIPO_P, idEditado))?.precio}`);

  // ── D) EL LÁPIZ DEL BUSCADOR LIBRE (la lista que quedaba vieja) ──────────────────────────────
  // La pantalla se elige ANTES desde la base (una pantalla real, con precio, que NO tenga este modelo
  // en su compatibilidad): así el caso es el del mostrador — «la que tengo en el cajón» — y no depende
  // de qué devuelva el buscador con un texto cualquiera.
  originalBuscada = uno(`SELECT ${COLUMNAS} FROM products
    WHERE category_id = 1 AND price_sale > 0 AND id <> ?1 AND id <> ?3 AND name LIKE '%Pantalla%'
      AND lower(COALESCE(compatibility,'')) NOT LIKE ?2
    ORDER BY stock DESC, id DESC LIMIT 1`, idEditado, `%${String(MODELO).toLowerCase()}%`, idCreado ?? -1);
  idBuscada = originalBuscada?.id ?? null;
  check('F80: hay una pantalla del catálogo que NO tenía este modelo en su compatibilidad', !!idBuscada,
    `id=${idBuscada} · ${originalBuscada?.name} · ${String(originalBuscada?.compatibility).slice(0, 50)}`);
  if (idBuscada) {
    recordar(originalBuscada);
    await setValue(`${dev(EQUIPO_P)} input[data-screen-buscar]`, String(originalBuscada.name));
    check('F80: el buscador libre encuentra esa pantalla',
      await waitFor(`!!document.querySelector('${dev(EQUIPO_P)} [data-screen-buscada="${idBuscada}"]')`, 12000));
    // Se ELIGE desde el buscador (así el wizard guarda su copia en `screenExtra`: el caso que quedaba viejo).
    await clickEn(`document.querySelector('${dev(EQUIPO_P)} [data-screen-buscada="${idBuscada}"]')`);
    await sleep(1200);
    check('F80: el lápiz también está en los resultados del buscador',
      await waitFor(`!!document.querySelector('${dev(EQUIPO_P)} [data-editar-producto="${idBuscada}"]')`, 8000));
    // El precio que se TOMA en esa fila (con efectivo puede ser el de contado): se edita ESE campo.
    const filaBuscadaAntes = await filaDe(EQUIPO_P, idBuscada, true);
    check('F80: la fila del resultado muestra el precio que se va a tomar', Number(filaBuscadaAntes?.precio) > 0,
      `$${filaBuscadaAntes?.precio} · ${String(filaBuscadaAntes?.texto).slice(0, 60)}`);
    await clickEn(`document.querySelector('${dev(EQUIPO_P)} [data-editar-producto="${idBuscada}"]')`);
    await waitFor(`!!document.querySelector('[data-editar-producto-corta]')`, 10000);
    check('F80: avisa que este modelo NO figura en la compatibilidad y ofrece agregarlo',
      (await evalx(`!!document.querySelector('[data-action="prod-agregar-modelo"]')`)) === true
      && (await evalx(`!!document.querySelector('[data-compat-ok]')`)) === false);
    await clickEn(`document.querySelector('[data-action="prod-agregar-modelo"]')`);
    await sleep(800);
    const compatTexto = await evalx(`document.querySelector('[data-field="prod-compat"]')?.value ?? ''`);
    check('F80: el «+ agregar» escribe el modelo en la compatibilidad',
      String(compatTexto).toLowerCase().includes(String(MODELO).toLowerCase()), String(compatTexto).slice(0, 120));
    const campoD = Number(filaBuscadaAntes?.precio) === Number(originalBuscada.price_sale) ? 'prod-venta' : 'prod-efectivo';
    const ventaD = Number(filaBuscadaAntes?.precio) + 4;
    await setValue(`[data-field="${campoD}"]`, ventaD);
    await sleep(500);
    await clickDialogExact('Guardar ficha');
    await waitFor(`!document.querySelector('[data-editar-producto-corta]')`, 12000);
    await sleep(1800);
    const guardada = uno('SELECT compatibility, price_sale, price_usd FROM products WHERE id = ?1', idBuscada);
    check('F80: la compatibilidad y el precio quedaron GUARDADOS en la base',
      String(guardada?.compatibility ?? '').toLowerCase().includes(String(MODELO).toLowerCase())
      && (campoD === 'prod-venta' ? Number(guardada?.price_sale) === ventaD : Number(guardada?.price_usd) === ventaD),
      String(guardada?.compatibility).slice(0, 90));
    const filaBuscada = await esperarPrecioDeLaFila(EQUIPO_P, idBuscada, ventaD, true);
    check('F80: la FILA DEL RESULTADO del buscador se refresca sola (precio nuevo)', filaBuscada,
      `fila=$${(await filaDe(EQUIPO_P, idBuscada, true))?.precio} · esperado=$${ventaD}`);
    const filaElegida = await esperarPrecioDeLaFila(EQUIPO_P, idBuscada, ventaD);
    check('F80: y la fila de la pantalla ELEGIDA (la copia del wizard) también', filaElegida,
      `fila=$${(await filaDe(EQUIPO_P, idBuscada))?.precio} · esperado=$${ventaD}`);
  }

  // ── E) «FICHA COMPLETA»: sin Eliminar y su Cancelar vuelve al atajo ──────────────────────────
  const idE = idBuscada ?? idEditado;
  const antesE = ficha(idE);
  const stockTecleado = Number(antesE?.stock ?? 0) + 11;
  await clickEn(`document.querySelector('${dev(EQUIPO_P)} [data-editar-producto="${idE}"]')`);
  await waitFor(`!!document.querySelector('[data-editar-producto-corta]')`, 10000);
  await setValue('[data-field="prod-stock"]', stockTecleado);
  await sleep(600);
  check('F80: «Ficha completa» está disponible en la ficha de una pantalla existente',
    (await clickDialogContiene('Ficha completa')) === true);
  const abrioCompleta = await waitFor(`/Editar:/.test(${ULTIMO}?.innerText ?? '')`, 10000);
  const textoCompleta = String(await ultimoTxt() ?? '');
  check('F80: «Ficha completa» abre el formulario de Inventario', abrioCompleta,
    textoCompleta.split('\n').slice(0, 3).join(' | '));
  check('F80: es el MISMO formulario de Inventario (nombre, categoría, marca, modelo, costo, stock mín, proveedor)',
    ['Nombre', 'Categoría', 'Marca', 'Modelo', 'Variante', 'Costo ($)', 'Stock Mín', 'Proveedor'].every(l => textoCompleta.includes(l)));
  check('F80: y desde el wizard NO ofrece Eliminar (borrar la pantalla elegida rompería la entrega)',
    !/^Eliminar$/m.test(textoCompleta), textoCompleta.split('\n').filter(l => /Eliminar/.test(l)).join('|') || 'sin Eliminar');
  await clickDialogExact('Cancelar');
  const volvioAlAtajo = await waitFor(`!!document.querySelector('[data-editar-producto-corta]')`, 8000);
  const stockConservado = await evalx(`Number(document.querySelector('[data-field="prod-stock"]')?.value ?? -1)`);
  check('F80: el Cancelar de la ficha completa VUELVE al atajo con lo escrito intacto',
    volvioAlAtajo && Number(stockConservado) === stockTecleado, `stock=${stockConservado}`);
  const sinGuardar = uno('SELECT stock FROM products WHERE id = ?1', idE);
  check('F80: y no se guardó nada por el camino (la base sigue con el stock de antes)',
    Number(sinGuardar?.stock) === Number(antesE?.stock), `base=${sinGuardar?.stock} · antes=${antesE?.stock} · tecleado=${stockTecleado}`);
  await clickDialogExact('Cancelar');
  await waitFor(`!document.querySelector('[data-editar-producto-corta]')`, 8000);
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
}

// ── LIMPIEZA: el catálogo queda exactamente como estaba y la app sin diálogos ────────────────
try {
  if (idCreado) await invoke('delete_product', { id: idCreado }).catch(() => {});
  for (const t of tocadas) {
    if (!t?.id || !t?.original?.id) continue;
    await invoke('update_product', {
      id: t.id, name: t.original.name, categoryId: t.original.category_id, brand: t.original.brand,
      model: t.original.model, variant: t.original.variant, compatibility: t.original.compatibility,
      priceCost: t.original.price_cost, priceSale: t.original.price_sale, stock: t.original.stock,
      minStock: t.original.min_stock, priceUsd: t.original.price_usd,
    }).catch(() => {});
  }
  check('la pantalla creada de prueba quedó borrada', !idCreado || !ficha(idCreado)?.id, `id=${idCreado}`);
  check('el catálogo quedó con la misma cantidad de fichas que al empezar', productos() === antesProductos, `${antesProductos} → ${productos()}`);
  for (const t of tocadas) {
    const r = ficha(t.id);
    check(`la ficha ${t.id} quedó con sus valores originales`,
      Number(r?.price_sale) === Number(t.original.price_sale) && Number(r?.price_usd) === Number(t.original.price_usd)
      && Number(r?.stock) === Number(t.original.stock) && r?.compatibility === t.original.compatibility,
      `${r?.name} · venta $${r?.price_sale} · stock ${r?.stock}`);
  }
} catch (e) {
  check('la limpieza terminó sin excepciones', false, String(e?.message ?? e));
}
// RECARGA final: no se deja ningún diálogo abierto (una prueba que deja el wizard abierto ensucia la
// corrida siguiente — le pasó al smoke integral).
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3000);
check('la app queda sin diálogos abiertos para la corrida siguiente', (await nDialogos()) === 0, `diálogos=${await nDialogos()}`);
db.close();

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
