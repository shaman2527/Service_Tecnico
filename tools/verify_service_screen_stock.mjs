// Verificación EN VIVO de que el formulario de SERVICIO muestra el STOCK de la pantalla que se va
// a instalar (lo que el taller mira al recibir un equipo). Es la misma fuente que el inventario
// (find_compatible_products → products.stock), así que si la carga dejó stock, acá tiene que verse.
// Uso: node tools/verify_service_screen_stock.mjs
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);

const waitReady = async (timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) return true; } catch { /* recargando */ }
    await sleep(700);
  }
  return false;
};
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
await waitReady();

const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// cuánto stock hay hoy en el catálogo (para saber si el selector DEBE mostrar números)
const conStock = await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: 1 });
  return p.filter(x => x.stock > 0).length;
})()`);
console.log(`· pantallas con stock en el catálogo: ${conStock}`);

await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
await sleep(1500);
await clickCenter(`[...document.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('Nuevo Servicio'))`);
await sleep(1500);
let dlg = String(await dialogText() ?? '');
check('SERVICIO: abre el formulario de una orden nueva', /Nuevo Servicio Técnico/i.test(dlg), dlg.split('\n')[0]);

// paso 1 (Cliente) → paso 2 (Equipos). El cliente es OBLIGATORIO para avanzar (F33/F48), así que
// primero se escribe y después se pulsa «Siguiente»: sin eso el botón está `disabled`, el clic no
// hace nada y el formulario nunca llega al modelo (por eso este script quedó viejo y fallaba).
// `typeText` manda las teclas al elemento ENFOCADO → se comprueba el foco tras cada clic.
const enfocar = async (sel, intentos = 6) => {
  for (let i = 0; i < intentos; i++) {
    await clickCenter(sel).catch(() => {});
    if (await evalx(`document.activeElement === (${sel})`).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
await enfocar(`document.querySelector('[role="dialog"] input[placeholder^="Buscar por nombre"]')`);
await typeText('Prueba Pantalla Stock');
await enfocar(`document.querySelector('[role="dialog"] input[placeholder="V-12345678"]')`);
await typeText('V-88888888');
await sleep(400);

// avanzar el wizard hasta el paso del equipo (el modelo)
const modeloInput = `document.querySelector('[role="dialog"] input[placeholder*="odelo del teléfono" i]')`;
for (let i = 0; i < 4 && !(await evalx(`!!${modeloInput}`)); i++) {
  await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/i.test((x.innerText||'').trim())); if (b && !b.disabled) b.click(); return !!b; })()`);
  await sleep(1200);
}
check('SERVICIO: el formulario pide el modelo del equipo', await evalx(`!!${modeloInput}`),
  String(await evalx(`(document.querySelector('[role="dialog"]')?.innerText ?? '').split('\\n').find(l => /Paso \\d+ de \\d+/.test(l)) ?? 'sin paso'`)));

// modelo del equipo (A06: en el catálogo está «Pantalla Samsung A06 4G / A06» con stock)
// Otra vez el foco: si el clic no deja el cursor en el campo, «A06» no llega al desplegable y no hay
// ninguna opción que elegir (la prueba fallaba con «click target no encontrado», culpando a la app).
await enfocar(modeloInput);
// ESPERAR a que el desplegable esté MONTADO antes de teclear: si se escribe con el popover todavía
// cerrado, el texto entra al campo pero la lista no se pinta y no hay ninguna opción que elegir
// (medido 2026-09-21: campo="A06" y opciones=[] con el backend devolviendo 3 modelos para «A06»).
for (let i = 0; i < 12; i++) { if (await evalx(`document.querySelector('[data-model-scope]') !== null`).catch(() => false)) break; await sleep(400); }
await typeText('A06');
const modeloEscrito = String(await evalx(`(${modeloInput})?.value ?? ''`));
await sleep(1400);
const opcionesA06 = await evalx(`[...document.querySelectorAll('[data-model-option]')].map(o => (o.innerText||'').replace(/\\s+/g,' ').trim())`);
check('SERVICIO: el desplegable ofrece el modelo escrito (sale del catálogo real)',
  /A06/i.test(modeloEscrito) && Array.isArray(opcionesA06) && opcionesA06.some(o => /A06/i.test(o)),
  `campo="${modeloEscrito}" · opciones=${JSON.stringify((opcionesA06 ?? []).slice(0, 3))}`);
// OJO: las opciones del selector de MODELO llevan `data-model-option` (atributo propio, con el que se
// prueban F50/F52). NO llevan `role="option"`: este script las buscaba así (versión vieja del
// componente) y por eso no encontraba ninguna y se caía culpando a la app (medido 2026-09-21).
await clickCenter(`[...document.querySelectorAll('[data-model-option]')].find(o => /A06/i.test(o.innerText)) ?? null`);
await sleep(1800);

// El trabajo «Cambio pantalla» es el que abre el selector de pantalla. OJO: al CREAR una orden ese
// trabajo ya viene ELEGIDO por defecto (`emptyDevice.serviceTypes = ['Cambio pantalla']`), así que
// este script se lo APAGABA al pulsarlo y después exigía ver el selector: fallaba con la app
// perfecta (medido 2026-09-21). Se lee el estado del toggle y solo se enciende si estaba apagado.
const estadoTrabajo = await evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Cambio pantalla$/i.test((x.innerText || '').trim()));
  return b ? (b.getAttribute('data-state') ?? 'sin-estado') : null;
})()`);
if (estadoTrabajo === 'off') {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Cambio pantalla$/i.test(b.innerText.trim()))`);
  await sleep(2000);
}
dlg = String(await dialogText() ?? '');
const tieneSelector = /Pantalla a instalar/i.test(dlg);
check('SERVICIO: el selector «Pantalla a instalar» aparece con el trabajo de cambio de pantalla',
  tieneSelector, `trabajo=${estadoTrabajo} · ${dlg.match(/Pantalla a instalar[^\n]*/)?.[0] ?? 'no aparece'}`);
const stocks = String(dlg).match(/stock\s+\d+/g) ?? [];
const agotadas = (String(dlg).match(/agotada/g) ?? []).length;
check('SERVICIO: el selector muestra el STOCK de cada pantalla (lo que no se veía)',
  stocks.length > 0 && /stock\s+[1-9]/.test(String(dlg)),
  stocks.length ? `${stocks.join(' · ')}${agotadas ? ` · ${agotadas} agotada(s)` : ''}` : 'sin números de stock');
check('SERVICIO: hay pantallas con stock en el catálogo (la carga quedó aplicada)', conStock > 0, `${conStock} fichas con stock`);

// cerrar sin guardar
await keyNav('Escape', 'Escape', 27);
await sleep(800);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
