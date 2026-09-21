// VERIFICACIÓN EN VIVO (CDP) de **F60** — «el nombre del EQUIPO se lee» en el selector de modelo.
//
// Pedido del dueño (2026-09-21): «cuando vas a colocar un modelo en servicio no se diferencia bien
// qué modelo vas a elegir, no se puede leer; debería salir el nombre del equipo».
//
// El defecto, leído en el código: en cada fila del desplegable el nombre compartía UN renglón con la
// marca, el código (M-007), el cartel «sin usar» y el contador de repuestos/stock, y encima llevaba
// `truncate`. En el formulario el campo ocupa media pantalla, así que el nombre salía cortado.
//
// Qué comprueba sobre la app REAL (SIN escribir nada: solo abre el formulario y lo cierra):
//   1. cada opción tiene un elemento `data-model-name` con texto (el nombre del equipo);
//   2. **no está truncado** (`scrollWidth <= clientWidth`): es la prueba directa de «se puede leer»;
//   3. el nombre va en NEGRITA y con tamaño de lectura (≥13px, peso ≥600);
//   4. la marca/código/repuestos/«sin usar» están en OTRO renglón (`data-model-meta` debajo);
//   5. el desplegable es más ancho que el campo (≥320px) para que un nombre largo entre;
//   6. el texto del nombre es exactamente el modelo que se va a guardar (no un recorte ni un código).
//
// Uso:  $env:REGISTRO_DB="...\backup\f56_fixture.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       npx tauri dev      (y en otra consola)   node tools/verify_modelo_legible.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};

// desbloqueo del PIN (el gate es fail-closed)
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

// Servicio Técnico → Nuevo Servicio (el mismo camino del operario)
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Servicio Técnico'))`);
await sleep(1800);
// Nada abierto antes de empezar (si quedó un diálogo de una corrida anterior, molesta al selector).
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(700); }
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) ?? null`);
await sleep(1600);
const hayWizard = await waitFor(`!!document.querySelector('[role="dialog"]')`, 12000);
check('F60: el formulario de servicio abre', hayWizard);

// El wizard es por PASOS y el campo de modelo vive en el de EQUIPOS. El paso 1 (Cliente) no deja
// avanzar hasta tener nombre, TELÉFONO y CÉDULA (la ficha lo dice: «Falta el número de teléfono…»),
// así que se completan los tres como en el mostrador y después se pulsa «Siguiente».
const escribir = async (sel, texto) => evalx(`(() => {
  const i = ${sel};
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(texto)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const pasoCliente = `document.querySelector('[role="dialog"] input[placeholder^="Buscar por nombre"]')`;
const pasoTelefono = `document.querySelector('[role="dialog"] input[placeholder^="0412"]')`;
const pasoCedula = `document.querySelector('[role="dialog"] input[placeholder^="V-"]')`;
await clickCenter(`${pasoCliente} ?? null`);
await escribir(pasoCliente, 'Prueba F60');
await sleep(700);
await escribir(pasoTelefono, '0414-0000000');
await sleep(500);
await escribir(pasoCedula, 'V-12345678');
await sleep(900);
const campo = `document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo"]')`;
for (let i = 0; i < 4 && !(await evalx(`!!${campo}`)); i++) {
  const puede = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test(x.innerText.trim())); return b ? !b.disabled : false; })()`);
  if (!puede) { await sleep(900); continue; }
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim())) || null)`).catch(() => {});
  await sleep(1500);
}
const hayCampo = await waitFor(`!!${campo}`, 10000);
check('F60: se llega al paso de EQUIPOS y está el buscador de modelo', hayCampo);
if (!hayCampo) {
  console.log('\nverify_modelo_legible: no se pudo llegar al campo de modelo — ABORTADO');
  process.exit(1);
}
await clickCenter(`${campo} ?? null`);
await evalx(`(() => {
  const i = ${campo};
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, 'A06');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const hayOpciones = await waitFor(`document.querySelectorAll('[data-model-option]').length > 0`, 15000);
check('F60: el desplegable ofrece modelos del padrón', hayOpciones);
await sleep(800);

// ── las comprobaciones de LEGIBILIDAD ───────────────────────────────────────────────────────────
const datos = await evalx(`(() => {
  const opts = [...document.querySelectorAll('[data-model-option]')];
  const menu = document.querySelector('[data-work-menu]') || opts[0]?.closest('div[class*="absolute"]');
  return {
    total: opts.length,
    anchoMenu: menu ? Math.round(menu.getBoundingClientRect().width) : null,
    filas: opts.map(o => {
      const nombre = o.querySelector('[data-model-label]');
      const meta = o.querySelector('[data-model-detail]');
      const cs = nombre ? getComputedStyle(nombre) : null;
      const rn = nombre ? nombre.getBoundingClientRect() : null;
      const rm = meta ? meta.getBoundingClientRect() : null;
      return {
        etiqueta: o.getAttribute('data-model-option'),
        nombre: nombre ? nombre.innerText.trim() : null,
        meta: meta ? meta.innerText.trim() : null,
        truncado: nombre ? nombre.scrollWidth > nombre.clientWidth + 1 : null,
        peso: cs ? Number(cs.fontWeight) : null,
        tamano: cs ? parseFloat(cs.fontSize) : null,
        metaDebajo: (rn && rm) ? (rm.top >= rn.bottom - 2) : null,
      };
    }),
  };
})()`);

const filas = datos?.filas ?? [];
check('F60: se pudieron leer las filas del desplegable', filas.length > 0, `filas=${filas.length}`);
check('F60: CADA fila muestra el NOMBRE del equipo en su propio elemento',
  filas.length > 0 && filas.every(f => typeof f.nombre === 'string' && f.nombre.length > 0),
  JSON.stringify(filas.slice(0, 2).map(f => f.nombre)));
check('F60: el nombre NO está truncado (se lee entero)',
  filas.length > 0 && filas.every(f => f.truncado === false),
  JSON.stringify(filas.filter(f => f.truncado).map(f => f.nombre)));
check('F60: el nombre va en negrita y con tamaño de lectura',
  filas.length > 0 && filas.every(f => (f.peso ?? 0) >= 600 && (f.tamano ?? 0) >= 13),
  JSON.stringify(filas.slice(0, 2).map(f => `${f.nombre}:${f.peso}/${f.tamano}px`)));
check('F60: el nombre es EXACTAMENTE el modelo que se va a guardar',
  filas.length > 0 && filas.every(f => f.nombre === f.etiqueta),
  JSON.stringify(filas.slice(0, 2).map(f => `${f.nombre} == ${f.etiqueta}`)));
check('F60: marca/código/repuestos van en OTRO renglón (no compiten con el nombre)',
  filas.every(f => f.metaDebajo === true),
  JSON.stringify(filas.slice(0, 3).map(f => f.meta)));
check('F60: el desplegable es más ancho que el campo (los nombres largos entran)',
  (datos?.anchoMenu ?? 0) >= 320, `ancho=${datos?.anchoMenu}px`);
check('F60: la búsqueda trae el modelo pedido (A06)',
  filas.some(f => /A06/i.test(String(f.nombre))),
  JSON.stringify(filas.slice(0, 3).map(f => f.nombre)));

// ── F64 — TODO EN USO: un modelo que ANTES estaba apagado tiene que aparecer igual ──────────────
// Pedido del dueño (2026-09-21): «todos los modelos y todos los productos visibles con sus
// compatibilidades… que se cargue al release esté todo en SÍ; el cliente con el check decide qué
// dejar». El respaldo que deja `tools/enuso_todo.mjs` es la verdad independiente: de ahí sale un
// modelo con «en uso» = No, y acá se comprueba que el selector —con su alcance por DEFECTO, sin
// tocar «Ver todos»— igual lo ofrece.
const rutaDb = process.env.REGISTRO_DB;
let antesApagado = null;
if (rutaDb && fs.existsSync(path.dirname(rutaDb))) {
  const respaldos = fs.readdirSync(path.dirname(rutaDb)).filter(f => /_pre_enuso_.*\.db$/.test(f)).sort();
  if (respaldos.length) {
    try {
      const prev = new DatabaseSync(path.join(path.dirname(rutaDb), respaldos[respaldos.length - 1]), { readOnly: true });
      const vivas = new DatabaseSync(rutaDb, { readOnly: true });
      const apagados = prev.prepare('SELECT name FROM phones WHERE COALESCE(in_use,1) = 0 AND name IS NOT NULL').all().map(r => r.name);
      antesApagado = apagados.find(n => {
        const token = String(n).split(/\s+/)[0];
        return vivas.prepare('SELECT 1 FROM phones WHERE name = ?').get(n)
          && vivas.prepare('SELECT 1 FROM phones WHERE name LIKE ?').get(`%${token}%`);
      }) ?? null;
      prev.close(); vivas.close();
    } catch { antesApagado = null; }
  }
}
if (antesApagado) {
  const token = String(antesApagado).split(/\s+/)[0];
  await evalx(`(() => {
    const i = ${campo};
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(i, ${JSON.stringify(token)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('[data-model-option]').length > 0`, 12000);
  await sleep(900);
  const alcance = String(await evalx(`document.querySelector('[data-model-scope]')?.innerText ?? ''`));
  const ofrece = await evalx(`[...document.querySelectorAll('[data-model-option]')].some(o => (o.getAttribute('data-model-option') || '') === ${JSON.stringify(antesApagado)})`);
  check('F64: un modelo que estaba APAGADO en la base vieja aparece igual (todo viaja EN USO)',
    ofrece === true, `modelo=«${antesApagado}» · alcance=«${alcance}»`);
} else {
  check('F64: no se pudo identificar un modelo antes apagado (se saltea, no falla) — corré tools/enuso_todo.mjs para dejar el respaldo', true);
}

// cerrar sin guardar: esta verificación NO escribe nada en la base
await keyNav('Escape', 'Escape', 27);
await sleep(600);
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
check('F60: se cerró el formulario sin guardar (la base queda intacta)',
  (await evalx(`!!document.querySelector('[role="dialog"]')`)) === false);

const fallas = out.filter(o => !o.ok).length;
console.log(`\nverify_modelo_legible: ${out.length - fallas}/${out.length} OK${fallas ? ` — ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
