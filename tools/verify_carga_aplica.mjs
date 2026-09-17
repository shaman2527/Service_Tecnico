// Verificación EN VIVO de que una carga APLICADA aterriza en el inventario real:
//  1) pega tools/inventario_real.txt en el asistente (Inventario → Ajustes → «Cargar la lista del local»),
//  2) asigna a mano la línea que el cruce no resuelve, anota el PROVEEDOR y pulsa Cargar (escribe de verdad),
//  3) comprueba el reporte, el stock total, los movimientos y que las pantallas del padrón muestren el stock nuevo.
//
// OJO: esto ESCRIBE en la base que esté usando la app. Corrélo con REGISTRO_DB apuntando a una COPIA.
// Uso: node tools/verify_carga_aplica.mjs
import { readFileSync } from 'node:fs';
import { evalx, clickCenter, keyNav, typeText, insertText, sleep, handleDialog } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const ci = (l) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(l).toLowerCase())})`;
const clickButton = async (label) => { await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`); await sleep(700); };
const clickDialog = async (label) => {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(${ci(label)})`);
  await sleep(900);
};
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const totalUnidades = () => evalx(`(async () => {
  const all = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: null });
  return all.reduce((a, p) => a + p.stock, 0);
})()`);
const movimientosCarga = () => evalx(`(async () => {
  const m = await window.__TAURI_INTERNALS__.invoke('get_inventory_movements_page', { search: 'Carga de inventario', type: '', limit: 200, offset: 0 });
  const items = Array.isArray(m) ? m : (m.items ?? []);
  return items.filter(x => /carga de inventario/i.test(String(x.reason ?? ''))).length;
})()`);

const texto = readFileSync('tools/inventario_real.txt', 'utf8');

// arranque limpio
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

const unidadesAntes = await totalUnidades();
console.log(`· unidades antes de la carga: ${unidadesAntes}`);

await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Ajustes')`);
await sleep(1200);
await clickButton('Cargar la lista del local');
await sleep(900);

await clickCenter(`document.querySelector('[role="dialog"] textarea')`);
await evalx(`(() => { const t = document.querySelector('[role="dialog"] textarea'); t.focus(); t.select(); })()`);
await insertText(texto);
await sleep(800);
await clickDialog('Revisar el cruce');

// 261 líneas tardan: se espera al botón de aplicar
const botonCargar = `(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Cargar [0-9]+ pantalla/i.test(t)) ?? null)()`;
let boton = null;
for (let i = 0; i < 25 && !boton; i++) { boton = await evalx(botonCargar); if (!boton) await sleep(600); }
check('CARGA: el cruce está listo para aplicar', boton !== null, String(boton));

// la línea que el cruce no resuelve, a mano
const sinPantalla = String(await dialogText() ?? '').includes('que NO se cargan');
if (sinPantalla) {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Buscar la pantalla$/i.test(b.innerText.trim()))`);
  await sleep(700);
  await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar la pantalla"]')`);
  await typeText('acasonor');
  await sleep(2000);
  await clickCenter(`document.querySelector('[role="dialog"] button[data-load-hit]')`);
  await sleep(900);
}
const sinPantallaDespues = String(await dialogText() ?? '').includes('que NO se cargan');
check('CARGA: no queda ninguna línea sin pantalla antes de aplicar', !sinPantallaDespues);

// proveedor general de la carga
await clickCenter(`document.querySelector('#prov-carga')`);
await typeText('Prov Carga Real');
await sleep(500);
boton = await evalx(botonCargar);
check('CARGA: el botón dice las pantallas y unidades que va a escribir', /Cargar \d+ pantallas \(\d+ u\.\)/.test(String(boton)), String(boton));

await clickDialog('Cargar');
await handleDialog(true); // por si el barrido pide confirmación (lista parcial)
await sleep(4000);

const rep = String(await dialogText() ?? '').replace(/\s+/g, ' ');
const num = (re) => Number((rep.match(re) ?? [])[1] ?? -1);
const actualizadas = num(/(\d+) pantallas actualizadas/);
const unidadesRep = num(/\((\d+) unidades\)/);
const proveedorAnotado = num(/(\d+) pantallas quedaron con su proveedor anotado/);
check('CARGA: el reporte dice cuántas pantallas y unidades escribió',
  actualizadas > 100 && unidadesRep > 500, `${actualizadas} pantallas · ${unidadesRep} unidades · proveedor en ${proveedorAnotado}`);
check('CARGA: el reporte muestra el respaldo que se hizo antes de escribir',
  /registro_pre_carga_/.test(rep), (rep.match(/registro_pre_carga_[\w.]*/) ?? [''])[0]);

// --- lo que quedó REALMENTE en la base (por IPC y por las pantallas) ---
const unidadesDespues = await totalUnidades();
check('CARGA: el stock del inventario cambió de verdad',
  unidadesDespues === unidadesRep && unidadesDespues > unidadesAntes,
  `${unidadesAntes} → ${unidadesDespues} u.`);
const movs = await movimientosCarga();
check('CARGA: quedaron los movimientos «Carga de inventario» en el historial', movs > 100, `${movs} movimientos`);

// la pantalla que se asignó a mano tiene su unidad
const a06 = await invoke('get_products', { search: 'Acasonor', categoryId: null });
check('CARGA: la pantalla asignada a mano quedó con la unidad de la lista',
  Array.isArray(a06) && a06.length > 0 && a06.every(p => p.stock >= 0) && a06.some(p => p.stock === 1),
  (a06 ?? []).map(p => `${p.name}=${p.stock}`).join(' | '));
const conProv = (a06 ?? []).filter(p => /Prov Carga Real/.test(String(p.supplier)));
check('CARGA: el proveedor quedó guardado en la ficha', conProv.length > 0, `${conProv.length} fichas con proveedor`);

// el padrón de teléfonos muestra el stock nuevo (Modelos)
const modelos = await evalx(`(async () => {
  const m = await window.__TAURI_INTERNALS__.invoke('get_phone_models', { search: 'A06', limit: 10, offset: 0 });
  const items = Array.isArray(m) ? m : (m.items ?? []);
  return JSON.stringify(items.slice(0, 3).map(x => ({ label: x.label, stock: x.stock })));
})()`);
check('CARGA: el padrón de Modelos refleja el stock cargado', /"stock":\s*[1-9]/.test(String(modelos)), String(modelos));

await clickDialog('Listo');
await sleep(600);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
