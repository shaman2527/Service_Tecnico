// VERIFICACIÓN EN VIVO (CDP) de **F62** — «+ Nueva categoría» desde el registro.
//
// Pedido del dueño (2026-09-21): «en las categorías o los types, donde sale Otro, cuando vas a hacer
// un registro poder registrar ahí mismo una nueva categoría con un +». Y lo que eso implica para que
// sirva de verdad:
//   · la categoría se GUARDA en la base (settings `work_types_extra`) y no se pierde al cerrar;
//   · queda ELEGIDA en la orden que se está registrando (no hay que buscarla después);
//   · en el selector de trabajos se muestra como categoría DEL TALLER, no dentro de «Anotados a mano»;
//   · si lo escrito es un sinónimo de un trabajo que ya existe, AVISA (tabla de F58) — así no volvemos
//     a fabricar los 33 sinónimos que F58 tuvo que unir;
//   · se puede QUITAR desde el mismo formulario (deshacer un error de tipeo), sin tocar las órdenes.
//
// Escribe de verdad (agrega y luego quita la categoría de prueba) y NO guarda ninguna orden.
//
// Uso:  $env:REGISTRO_DB="...\backup\f56_fixture.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       npx tauri dev      (y en otra consola)   node tools/verify_categoria_nueva.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB (esta prueba ESCRIBE la categoría en la base: usá una COPIA).');
  process.exit(2);
}
/** Lo que hay guardado en settings (verdad independiente de la pantalla). */
const guardadas = () => {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const v = db.prepare("SELECT value FROM settings WHERE key = 'work_types_extra'").get()?.value ?? '[]';
    db.close();
    const l = JSON.parse(v);
    return Array.isArray(l) ? l : [];
  } catch { return []; }
};

const CATEGORIA = `Cambio de tapa ${String(Date.now()).slice(-5)}`;
const antes = guardadas();
console.log(`· copia: ${dbPath}`);
console.log(`· categorías del local ANTES: ${antes.length ? antes.join(' · ') : '(ninguna)'}`);

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const escribir = (sel, texto) => evalx(`(() => {
  const i = ${sel};
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(texto)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

// ── PIN ────────────────────────────────────────────────────────────────────────────────────────
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
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Servicio Técnico'))`);
await sleep(1800);

// ── abrir el formulario y llegar al paso de EQUIPOS ───────────────────────────────────────────
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) ?? null`);
await waitFor(`!!document.querySelector('[role="dialog"]')`, 12000);
const pasoCliente = `document.querySelector('[role="dialog"] input[placeholder^="Buscar por nombre"]')`;
await clickCenter(`${pasoCliente} ?? null`);
await escribir(pasoCliente, 'Prueba F62');
await sleep(600);
await escribir(`document.querySelector('[role="dialog"] input[placeholder^="0412"]')`, '0414-1111111');
await escribir(`document.querySelector('[role="dialog"] input[placeholder^="V-"]')`, 'V-99999999');
await sleep(800);
const campo = `document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo"]')`;
for (let i = 0; i < 4 && !(await evalx(`!!${campo}`)); i++) {
  const puede = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test(x.innerText.trim())); return b ? !b.disabled : false; })()`);
  if (!puede) { await sleep(900); continue; }
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim())) || null)`).catch(() => {});
  await sleep(1500);
}
check('F62: se llegó al paso de equipos del formulario', await waitFor(`!!${campo}`, 10000));

// ── el «+» y el alta ──────────────────────────────────────────────────────────────────────────
check('F62: el formulario ofrece el botón «+ Nueva categoría»', await evalx(`!!document.querySelector('[data-nueva-categoria]')`));
await clickCenter(`document.querySelector('[data-nueva-categoria]')`);
check('F62: al abrirlo aparece el campo para escribir el nombre', await waitFor(`!!document.querySelector('[data-nueva-categoria-input]')`, 6000));
await escribir(`document.querySelector('[data-nueva-categoria-input]')`, CATEGORIA);
await sleep(700);
check('F62: un nombre NUEVO no dispara el aviso de sinónimo', (await evalx(`!!document.querySelector('[data-nueva-categoria-aviso]')`)) === false);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Agregar$/.test(b.innerText.trim())) ?? null`);
await sleep(1800);

const persistida = guardadas();
check('F62: la categoría quedó GUARDADA en la base (settings)', persistida.includes(CATEGORIA), `guardadas: ${persistida.join(' | ') || '(ninguna)'}`);
const elegida = await evalx(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.innerText.trim() === ${JSON.stringify(CATEGORIA)})`);
check('F62: y quedó ELEGIDA en la orden que se está registrando', elegida === true);

// ── se puede quitar (deshacer un error de tipeo) ──────────────────────────────────────────────
await clickCenter(`document.querySelector('[data-nueva-categoria]') ?? null`).catch(() => {});
await sleep(600);
const listada = await evalx(`!!document.querySelector('[data-categoria-local="${CATEGORIA}"]')`);
check('F62: la categoría del local aparece listada con su ✕ para quitarla', listada === true);

// ── el aviso de sinónimo (F58) ────────────────────────────────────────────────────────────────
await clickCenter(`document.querySelector('[data-nueva-categoria]') ?? null`).catch(() => {});
await sleep(500);
if (await evalx(`!!document.querySelector('[data-nueva-categoria-input]')`)) {
  await escribir(`document.querySelector('[data-nueva-categoria-input]')`, 'bateria');
  await sleep(700);
  const aviso = await evalx(`document.querySelector('[data-nueva-categoria-aviso]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
  check('F62/F58: escribir un sinónimo de un trabajo existente AVISA (no crea un duplicado)',
    !!aviso && /Cambio batería/.test(String(aviso)), String(aviso));
} else {
  check('F62/F58: no se pudo reabrir el campo para probar el aviso de sinónimo', false);
}

// ── cerrar sin guardar la orden ───────────────────────────────────────────────────────────────
await keyNav('Escape', 'Escape', 27);
await sleep(700);
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(700); }
check('F62: el formulario se cerró SIN guardar ninguna orden (la prueba no ensucia la lista)',
  (await evalx(`!!document.querySelector('[role="dialog"]')`)) === false);

// ── en el selector: la regla del conteo (solo trabajos CON equipos) y la clasificación ───────
// OJO (medido): una categoría recién creada todavía NO aparece en el selector porque no tiene ningún
// equipo — es la regla de siempre (el selector lista lo que se hizo, no el catálogo de opciones), y
// por eso este chequeo comprueba ESO en vez de exigir que aparezca. Que una categoría del local se
// clasifique como «del taller» (y no en «Anotados a mano») está fijado por la prueba pura
// (`tools/service_report_test.ts` §18, con filas que sí tienen equipos).
await clickCenter(`document.querySelector('[data-work-picker]')`);
await waitFor(`!!document.querySelector('[data-work-menu]')`, 8000);
const enSelector = await evalx(`[...document.querySelectorAll('[data-work-chip]')].some(b => b.innerText.includes(${JSON.stringify(CATEGORIA)}))`);
check('F62: el selector lista trabajos CON equipos (una categoría recién creada todavía no aparece) — la regla del conteo no cambia',
  enSelector === false, `¿aparece sin tener equipos? ${enSelector}`);
const sigueEnAjustes = guardadas().includes(CATEGORIA);
check('F62: …pero la categoría sigue guardada y disponible para las órdenes', sigueEnAjustes === true);
await keyNav('Escape', 'Escape', 27);
await sleep(500);

// ── limpieza: se quita la categoría de prueba ─────────────────────────────────────────────────
await evalx(`window.__TAURI_INTERNALS__.invoke('remove_work_type_extra', { name: ${JSON.stringify(CATEGORIA)} })`).catch(() => {});
await sleep(900);
const despues = guardadas();
check('F62: la prueba se limpió (la categoría de prueba ya no está guardada)',
  !despues.includes(CATEGORIA) && despues.length === antes.length,
  `antes ${antes.length} · después ${despues.length} (${despues.join(' | ') || 'ninguna'})`);

const fallas = out.filter(o => !o.ok).length;
console.log(`\nverify_categoria_nueva: ${out.length - fallas}/${out.length} OK${fallas ? ` — ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
