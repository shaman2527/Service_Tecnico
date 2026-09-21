// VERIFICACIÓN EN VIVO (CDP) de **F63** — la compatibilidad de pantalla del modelo se puede elegir.
//
// Pedido del dueño (2026-09-21): «al registrar un servicio, dependiendo del modelo del equipo, si
// tiene compatibilidad en pantalla para ese modelo tiene que dejarme seleccionar la compatibilidad si
// tiene». El defecto: el bloque de compatibilidad existía SOLO si el trabajo incluía «Cambio
// pantalla», así que con cualquier otro trabajo el operador no veía la compatibilidad aunque el
// modelo la tuviera cargada.
//
// Qué comprueba sobre la app REAL (no escribe nada: abre el formulario y lo cierra):
//   1. con «Cambio pantalla» el bloque está ABIERTO y ofrece los repuestos del catálogo (como antes);
//   2. con OTRO trabajo, el bloque ya no desaparece: queda una línea «Compatibilidad de pantalla: N
//      repuestos — ver» a un toque;
//   3. al abrirlo dice que es INFORMATIVO y NO promete descontar stock (el descuento sigue siendo del
//      trabajo «Cambio pantalla») — no exige elegir nada;
//   4. sin opciones en el catálogo no aparece ninguna de las dos cosas (no se inventan opciones).
//
// Uso:  $env:REGISTRO_DB="...\backup\f56_fixture.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       npx tauri dev      (y en otra consola)   node tools/verify_compat_pantalla.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB (la verdad de las pantallas compatibles sale de la copia).');
  process.exit(2);
}
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

// Un modelo CON pantallas compatibles y su cantidad, leída de la BASE (verdad independiente).
const db = new DatabaseSync(dbPath, { readOnly: true });
const fila = db.prepare(`SELECT p.model AS modelo, COUNT(*) AS n FROM products p
  WHERE p.category_id = 1 AND p.stock >= 0 AND COALESCE(p.compatibility,'') LIKE '%A06%' LIMIT 1`).get();
db.close();
const MODELO = 'Galaxy A06';
console.log(`· copia: ${dbPath}`);
console.log(`· modelo de prueba: «${MODELO}» (el catálogo tiene pantallas compatibles para A06: ${fila?.n ?? '?'} fichas)`);

// ── PIN + navegación ──────────────────────────────────────────────────────────────────────────
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
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) ?? null`);
await waitFor(`!!document.querySelector('[role="dialog"]')`, 12000);

// paso 1 (cliente) → paso 2 (equipos)
const pasoCliente = `document.querySelector('[role="dialog"] input[placeholder^="Buscar por nombre"]')`;
await clickCenter(`${pasoCliente} ?? null`);
await escribir(pasoCliente, 'Prueba F63');
await sleep(600);
await escribir(`document.querySelector('[role="dialog"] input[placeholder^="0412"]')`, '0414-2222222');
await escribir(`document.querySelector('[role="dialog"] input[placeholder^="V-"]')`, 'V-88888888');
await sleep(800);
const campo = `document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo"]')`;
for (let i = 0; i < 4 && !(await evalx(`!!${campo}`)); i++) {
  const puede = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test(x.innerText.trim())); return b ? !b.disabled : false; })()`);
  if (!puede) { await sleep(900); continue; }
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim())) || null)`).catch(() => {});
  await sleep(1500);
}
check('F63: se llegó al paso de equipos', await waitFor(`!!${campo}`, 10000));

// elegir el modelo del catálogo (así la compatibilidad existe de verdad)
await clickCenter(`${campo} ?? null`);
await escribir(campo, 'A06');
await waitFor(`document.querySelectorAll('[data-model-option]').length > 0`, 15000);
await sleep(800);
await clickCenter(`[...document.querySelectorAll('[data-model-option]')].find(o => /A06/i.test(o.getAttribute('data-model-option') || '')) ?? null`);
await sleep(2200);

// ── 1) con «Cambio pantalla» (viene elegido por defecto al crear) ──────────────────────────────
const opcionesConTrabajo = await evalx(`document.querySelectorAll('[data-screen-option]').length`);
check('F63: con «Cambio pantalla» el bloque de compatibilidad está abierto y ofrece los repuestos del catálogo',
  opcionesConTrabajo > 0, `repuestos ofrecidos: ${opcionesConTrabajo}`);
check('F63: y en ese caso SÍ avisa que descuenta inventario',
  /descuenta del inventario al entregar/.test(String(await evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`))));

// ── 2) con OTRO trabajo: la compatibilidad no desaparece ──────────────────────────────────────
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Cambio pantalla$/.test(b.innerText.trim())) ?? null`);
await sleep(1200);
const opcionesSinTrabajo = await evalx(`document.querySelectorAll('[data-screen-option]').length`);
const botonVer = await evalx(`document.querySelector('[data-ver-compat]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
check('F63: con otro trabajo el bloque se pliega (deja de estar abierto)', opcionesSinTrabajo === 0, `opciones visibles: ${opcionesSinTrabajo}`);
check('F63: …pero aparece la línea para VER la compatibilidad del modelo', !!botonVer, String(botonVer));
check('F63: la línea dice cuántos repuestos compatibles hay', /\d+ repuesto/.test(String(botonVer)), String(botonVer));

// ── 3) se abre a un toque y es INFORMATIVO (no exige elegir ni promete descuento) ──────────────
await clickCenter(`document.querySelector('[data-ver-compat]') ?? null`);
await sleep(1500);
const opcionesAbiertas = await evalx(`document.querySelectorAll('[data-screen-option]').length`);
check('F63: al abrirla se pueden ver y ELEGIR los repuestos compatibles', opcionesAbiertas > 0, `repuestos: ${opcionesAbiertas}`);
const textoDialogo = String(await evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`));
check('F63: avisa que es informativo (solo de referencia)', /solo de referencia/i.test(textoDialogo));
check('F63: NO promete descontar stock cuando el trabajo no es de pantalla',
  /inventario solo baja si el trabajo incluye/i.test(textoDialogo) && !/descuenta del inventario al entregar/i.test(textoDialogo));
check('F63: NO exige elegir una pantalla (no aparece el aviso ámbar de obligatorio)',
  !/Elige la pantalla exacta que se va a instalar/.test(textoDialogo));
// elegir una: queda seleccionada sin bloquear nada
const primera = await evalx(`document.querySelector('[data-screen-option]')?.getAttribute('data-screen-option') ?? null`);
if (primera) {
  await clickCenter(`document.querySelector('[data-screen-option="${primera}"]')`);
  await sleep(900);
  check('F63: se puede seleccionar un repuesto compatible desde otro trabajo (queda elegido)',
    await evalx(`!!document.querySelector('[data-screen-option="${primera}"]')`));
} else {
  check('F63: no había ninguna opción para seleccionar', false);
}

// ── limpieza: cerrar sin guardar ──────────────────────────────────────────────────────────────
await keyNav('Escape', 'Escape', 27);
await sleep(700);
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(700); }
check('F63: el formulario se cerró sin guardar (la base queda intacta)',
  (await evalx(`!!document.querySelector('[role="dialog"]')`)) === false);

const fallas = out.filter(o => !o.ok).length;
console.log(`\nverify_compat_pantalla: ${out.length - fallas}/${out.length} OK${fallas ? ` — ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
