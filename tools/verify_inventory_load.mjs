// Verificación EN VIVO de F25 (asistente de carga de inventario) y F26 (regla «solo Pantalla»).
// Requisitos: app de dev con CDP 9222 y REGISTRO_DB apuntando a la copia de trabajo.
// Uso: node tools/verify_inventory_load.mjs
import { evalx, clickCenter, keyNav, typeText, insertText, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const ci = (l) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(l).toLowerCase())})`;
const clickButton = async (label) => { await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`); await sleep(700); };
// dentro del diálogo: el botón del asistente no se confunde con el de la tarjeta de atrás
const clickDialog = async (label) => {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(${ci(label)})`);
  await sleep(900);
};
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const dialogOpen = () => evalx(`!!document.querySelector('[role="dialog"]')`);
const tabActiva = () => evalx(`(() => document.querySelector('[role="tab"][data-state="active"]')?.innerText.trim() ?? null)()`);
const pegar = async (texto) => {
  await clickCenter(`document.querySelector('[role="dialog"] textarea')`);
  await evalx(`(() => { const t = document.querySelector('[role="dialog"] textarea'); t.focus(); t.select(); })()`);
  await insertText(texto);
  await sleep(500);
};
const totalPantallas = () => evalx(`(async () => {
  const all = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: 1 });
  return all.reduce((a, p) => a + p.stock, 0);
})()`);

// --- arranque limpio: la SPA se recarga y siempre empieza en la pantalla de PIN ---
// (si no, una corrida anterior deja la sesión en modo cajera y el Inventario no está en el menú)
const waitReady = async (timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) return true;
    } catch { /* el contexto se está recargando */ }
    await sleep(700);
  }
  return false;
};
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
await waitReady();

// --- sesión de dueño ---
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// --- F26: Inventario → Productos abre filtrado en Pantalla ---
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
// la pestaña Inventario recuerda en cuál estaba: se entra a Productos a propósito
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Productos')`);
await sleep(2500);
const catLabel = await evalx(`(() => document.querySelector('[role="combobox"]')?.innerText.trim() ?? null)()`);
const categorias = await evalx(`(() => [...document.querySelectorAll('table tbody tr')].map(r => r.querySelectorAll('td')[1]?.innerText.trim()).filter(Boolean).slice(0, 8))()`);
check('F26: el inventario abre filtrado en «Pantalla»',
  /pantalla/i.test(String(catLabel)) && categorias.length > 0 && categorias.every(c => /pantalla/i.test(c)),
  `filtro=${catLabel} · filas=${[...new Set(categorias)].join(', ')}`);
// y avisa que los KPI de arriba son de todo el catálogo (no del filtro)
const avisoKpi = await evalx(`(() => [...document.querySelectorAll('p')].map(p => p.innerText).find(t => /todo el catálogo/i.test(t)) ?? null)()`);
check('F26: avisa que los números de arriba son de todo el catálogo', /filtrada/i.test(String(avisoKpi)), String(avisoKpi).slice(0, 70));

// --- F25: Ajustes → asistente de carga ---
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Ajustes')`);
await sleep(1200);
const hayBoton = await evalx(`!!([...document.querySelectorAll('button')].find(${ci('Cargar la lista del local')}))`);
check('F25: el asistente está en Ajustes', hayBoton);
await clickButton('Cargar la lista del local');
await sleep(900);
let dlg = await dialogText();
check('F25: abre el paso 1 (pegar la lista)', /Pegar la lista/.test(dlg ?? '') && /Abrir un archivo/.test(dlg ?? ''), (dlg ?? '').split('\n')[0]);

// pegar una lista de prueba y cruzar ("ZZZ 999" no existe: tiene que avisar)
const lista = [
  'Samsung',
  'A06 4G (6)',
  'ZZZ 999 (0)',
  '',
  'Tecno',
  'Spark 8P (2)',
  '',
].join('\n');
await pegar(lista);
await clickButton('Revisar el cruce');
await sleep(2000);
dlg = await dialogText();
check('F25: el cruce muestra líneas, cruzadas y unidades',
  /líneas/.test(dlg ?? '') && /cruzadas/.test(dlg ?? '') && /unidades/.test(dlg ?? ''),
  (dlg ?? '').match(/\d+ líneas[\s\S]{0,60}/)?.[0]?.replace(/\n/g, ' '));
const filas = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] table tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim().slice(0, 40))))()`);
check('F25: una fila por línea de la lista, con la cantidad editable',
  filas.length === 3 && filas.every(f => f.length >= 6),
  filas.map(f => `${f[2]}=${f[3]}`).join(' | '));
check('F25: la línea sin catálogo avisa en vez de inventar un producto',
  filas.some(f => /no encuentro|sin coincidencia/i.test(f.join(' '))),
  filas.map(f => f[4]).join(' / ').slice(0, 120));
const bultos = await evalx(`[...document.querySelectorAll('[role="dialog"] input[inputmode="numeric"]')].length`);
check('F25: el operario puede corregir la cantidad de cada línea', bultos >= 3, `${bultos} campos de cantidad`);
const ariaQty = await evalx(`(() => document.querySelector('[role="dialog"] input[inputmode="numeric"]')?.getAttribute('aria-label') ?? null)()`);
check('F25: las cantidades tienen etiqueta accesible', /unidades/i.test(String(ariaQty)), String(ariaQty));

// cerrar sin aplicar (no debe escribir nada)
const stockAntes = await totalPantallas();
await clickDialog('Atrás');
await clickButton('Cancelar');
await sleep(700);
const stockDespues = await totalPantallas();
check('F25: cerrar el asistente no toca el stock', stockAntes === stockDespues, `${stockAntes} → ${stockDespues}`);

// el barrido se avisa ANTES de aplicar: una lista que no nombra las pantallas con stock
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Tecno\nSpark 8P (2)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const avisoBarrido = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] label span')].map(s => s.innerText.trim()).find(t => /quedar[íi]an en 0|quedan en 0|Ninguna otra pantalla/i.test(t)) ?? null)()`);
check('F25: avisa cuántas pantallas quedarían en 0 antes de aplicar',
  /quedan en 0\s*1\s*pantalla/i.test(String(avisoBarrido).replace(/\s+/g, ' ')),
  String(avisoBarrido).replace(/\s+/g, ' ').slice(-90));
await clickDialog('Atrás');
await clickButton('Cancelar');
await sleep(600);

// GATE DEL BARRIDO: una línea con unidades sin pantalla asignada no puede cargarse con el
// barrido marcado (dejaría en 0 mercancía que la lista SÍ menciona)
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Samsung\nA06 4G (6)\nZZZ 999 (5)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const avisoSinPantalla = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] span')].map(s => s.innerText).find(t => /que NO se cargan/i.test(t)) ?? null)()`);
check('F25: avisa las unidades que NO se van a cargar (línea sin pantalla)',
  /5 u\. que NO se cargan/i.test(String(avisoSinPantalla).replace(/\s+/g, ' ')),
  String(avisoSinPantalla).replace(/\s+/g, ' ').slice(0, 90));
const stockAntesGate = await totalPantallas();
await clickDialog('Cargar 1 pantalla');
await sleep(2500);
const errGate = await evalx(`(() => document.querySelector('[role="dialog"] [role="alert"], [role="dialog"] .text-destructive')?.innerText ?? null)()`);
check('F25: el barrido NO deja en 0 mercancía que la lista menciona (pide resolver la línea)',
  /sin pantalla asignada/i.test(String(errGate)) && (await totalPantallas()) === stockAntesGate,
  `${String(errGate).replace(/\s+/g, ' ').slice(0, 80)} · stock ${stockAntesGate} → ${await totalPantallas()}`);
await clickDialog('Atrás');
await clickButton('Cancelar');
await sleep(600);

// --- F25 E2E por la UI: cargar una lista que refleja lo que YA hay y VER el resumen ---
// (regresión de la revisión: al aplicar, la pestaña saltaba a Productos y el paso 3
//  —el resumen— nunca se veía porque el diálogo se desmontaba)
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Samsung\nGalaxy A06 4G (6)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const botonCargar = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Cargar \\d+ pantalla/i.test(t)) ?? null)()`);
check('F25: el botón dice cuántas PANTALLAS y unidades va a cargar', /^Cargar 1 pantalla/.test(String(botonCargar)), String(botonCargar));
await clickDialog('Cargar 1 pantalla');
await sleep(2500);
const repDlg = await dialogText();
check('F25: el paso 3 (resumen) SE VE después de cargar',
  /Inventario cargado/i.test(repDlg ?? '') && /respaldo de la base/i.test(repDlg ?? ''),
  (repDlg ?? '').split('\n').slice(0, 3).join(' · '));
check('F25: el resumen queda en el asistente (no salta de pestaña)',
  (await dialogOpen()) && (await tabActiva()) === 'Ajustes',
  `pestaña=${await tabActiva()}`);
const movs = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.match(/(\\d+) movimientos/)?.[1] ?? null)()`);
check('F25: el resumen dice cuántos movimientos se anotaron', movs !== null, `${movs} movimientos`);
const backup = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.match(/registro_pre_carga_[\\w.]*/)?.[0] ?? null)()`);
check('F25: el resumen muestra el respaldo que se guardó', /registro_pre_carga_/.test(String(backup)), String(backup));
await clickDialog('Listo');
await sleep(600);
const stockFinal = await totalPantallas();
check('F25: el stock quedó igual (la lista reflejaba lo que había)', stockFinal === stockDespues, `${stockDespues} → ${stockFinal}`);
check('F25: al cerrar el asistente no queda ningún diálogo abierto', !(await dialogOpen()));

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
