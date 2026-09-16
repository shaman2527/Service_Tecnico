// Verificación EN VIVO con la LISTA REAL del local (tools/inventario_real.txt, 261 líneas / 713 u.):
// comprueba que el asistente cruza todo y que la única línea que el cruce no puede resolver
// («6 c/m Accesorios» vs «Pantalla Redmi 6 c/m Acasonor») se asigna A MANO desde el asistente.
// NO aplica nada: sale con «Atrás» → «Cancelar» y verifica que el stock no cambió.
// Uso: node tools/verify_inventory_load_real.mjs
import { readFileSync } from 'node:fs';
import { evalx, clickCenter, keyNav, typeText, insertText, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const ci = (l) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(l).toLowerCase())})`;
const clickButton = async (label) => { await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`); await sleep(700); };
const clickDialog = async (label) => {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(${ci(label)})`);
  await sleep(900);
};
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const totalPantallas = () => evalx(`(async () => {
  const all = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: 1 });
  return all.reduce((a, p) => a + p.stock, 0);
})()`);
const texto = readFileSync('tools/inventario_real.txt', 'utf8');
const lineas = texto.split('\n').filter(l => l.trim()).length;

// arranque limpio (la SPA siempre empieza en la pantalla de PIN)
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

await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Ajustes')`);
await sleep(1200);
await clickButton('Cargar la lista del local');
await sleep(900);

const stockAntes = await totalPantallas();
await clickCenter(`document.querySelector('[role="dialog"] textarea')`);
await evalx(`(() => { const t = document.querySelector('[role="dialog"] textarea'); t.focus(); t.select(); })()`);
await insertText(texto);
await sleep(800);
await clickDialog('Revisar el cruce');
// 261 líneas tardan en cruzarse y renderizar: se espera al botón de aplicar
const waitFor = async (expr, timeout = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await evalx(expr);
    if (v) return v;
    await sleep(600);
  }
  return null;
};
const botonCargar = `(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Cargar [0-9]+ pantalla/i.test(t)) ?? null)()`;
const botonAntes = await waitFor(botonCargar);
const tira = String(await dialogText() ?? '').replace(/\s+/g, ' ');
const nLineas = Number((tira.match(/(\d+) líneas/) ?? [])[1] ?? 0);
check('REAL: el cruce lee toda la lista del local',
  nLineas >= 200 && /cruzadas/.test(tira),
  `${nLineas} líneas leídas de ${lineas} renglones del archivo · ${(tira.match(/\d+ cruzadas/) ?? [''])[0]}`);
check('REAL: queda UNA sola línea sin pantalla (de 261)',
  /1 línea sin pantalla \(1 u\. que NO se cargan\)/.test(tira),
  (tira.match(/\d+ líneas.{0,130}/) ?? [''])[0]);
check('REAL: sin resolver esa línea el total queda corto (712 de 713 u.)',
  /712 u\./.test(String(botonAntes)), String(botonAntes));

// CARGA RÁPIDA (F29): con el barrido marcado y esa línea sin resolver, el asistente ofrece
// excluirla de un clic y cargar el resto (antes había que elegir entre no cargar nada o
// asignarle una ficha equivocada)
const atajo = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Excluir esas líneas y cargar el resto$/i.test(t)) ?? null)()`);
check('REAL: ofrece la carga rápida (excluir las líneas sin pantalla y seguir)', atajo !== null, String(atajo));
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Excluir esas líneas y cargar el resto$/i.test(b.innerText.trim()))`);
await sleep(1200);
const tiraRapida = String(await dialogText() ?? '').replace(/\s+/g, ' ');
check('REAL: la línea excluida sale del conteo y ya no bloquea',
  /1 línea excluida \(1 u\.\)/.test(tiraRapida) && !/sin pantalla/i.test(tiraRapida),
  (tiraRapida.match(/\d+ líneas.{0,150}/) ?? [''])[0]);
const botonRapido = await evalx(botonCargar);
check('REAL: con la exclusión el total baja solo esa unidad (712 u.)',
  /712 u\./.test(String(botonRapido)), String(botonRapido));

// volver a incluirla (la fila excluida se ve atenuada) y asignarla a mano
await clickCenter(`(() => { const tr = [...document.querySelectorAll('[role="dialog"] tbody tr')].find(r => (r.className || '').includes('opacity-50')); return tr ? tr.querySelector('input[type="checkbox"]') : null; })()`);
await sleep(900);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Buscar la pantalla$/i.test(b.innerText.trim()))`);
await sleep(700);
await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar la pantalla"]')`);
await typeText('acasonor');
await sleep(2000);
const hits = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button[data-load-hit]')].map(b => b.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 4))()`);
check('REAL: el buscador encuentra la ficha del catálogo (nombre distinto al de la lista)',
  hits.some(h => /Acasonor/i.test(h)), hits.join(' | '));
await clickCenter(`document.querySelector('[role="dialog"] button[data-load-hit]')`);
await sleep(1000);

const tiraFinal = String(await dialogText() ?? '').replace(/\s+/g, ' ');
check('REAL: ya NO queda ninguna línea sin pantalla',
  !/sin pantalla/i.test(tiraFinal), (tiraFinal.match(/\d+ líneas.{0,120}/) ?? [''])[0]);
const botonDespues = await evalx(botonCargar);
// con la línea resuelta a mano entran las 713 unidades de la lista (antes quedaban 712)
check('REAL: con la línea asignada a mano se cargarían las 713 unidades',
  /713 u\./.test(String(botonDespues)), String(botonDespues));
const aMano = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.includes('asignada a mano') ?? false)()`);
check('REAL: la fila queda marcada como asignada a mano', aMano === true);
const barrido = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] label span')].map(s => s.innerText.replace(/\\s+/g, ' ').trim()).find(t => /quedar[íi]an en 0|quedan en 0|Ninguna otra pantalla/i.test(t)) ?? null)()`);
check('REAL: el barrido avisa cuántas pantallas quedarían en 0',
  /quedan en 0/i.test(String(barrido)), String(barrido).slice(-80));

// NO se aplica: se sale sin tocar nada
await clickDialog('Atrás');
await clickButton('Cancelar');
await sleep(800);
const stockDespues = await totalPantallas();
check('REAL: salir sin aplicar no toca el stock', stockAntes === stockDespues, `${stockAntes} → ${stockDespues}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
