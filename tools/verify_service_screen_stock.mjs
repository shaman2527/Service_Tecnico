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

// avanzar el wizard hasta el paso del equipo (el modelo)
const modeloInput = `document.querySelector('[role="dialog"] input[placeholder*="odelo del teléfono" i]')`;
for (let i = 0; i < 3 && !(await evalx(`!!${modeloInput}`)); i++) {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/i.test(b.innerText.trim()))`);
  await sleep(1200);
}
check('SERVICIO: el formulario pide el modelo del equipo', await evalx(`!!${modeloInput}`));

// modelo del equipo (A06: en el catálogo está «Pantalla Samsung A06 4G / A06» con stock)
await clickCenter(modeloInput);
await typeText('A06');
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] [role="option"]')].find(o => /A06/i.test(o.innerText)) ?? null`);
await sleep(1500);

// el trabajo "Cambio pantalla" abre el selector de pantalla
const trabajo = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button')].some(b => /^Cambio pantalla$/i.test(b.innerText.trim())))()`);
if (trabajo) {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Cambio pantalla$/i.test(b.innerText.trim()))`);
  await sleep(2000);
}
dlg = String(await dialogText() ?? '');
const tieneSelector = /Pantalla a instalar/i.test(dlg);
check('SERVICIO: el selector «Pantalla a instalar» aparece con el trabajo de cambio de pantalla', tieneSelector, dlg.match(/Pantalla a instalar[^\n]*/)?.[0] ?? 'no aparece');
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
