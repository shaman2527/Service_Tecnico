// Verificación EN VIVO de las ESCRITURAS de F24 (fusionar, agregar, renombrar) por CDP.
// Deja el padrón con cambios REALES (se corre sobre la copia de trabajo, con respaldo previo).
// Uso: node tools/verify_phones_write.mjs
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

const waitTable = async (timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const busy = await evalx(`(() => {
      const sk = document.querySelectorAll('table tbody [class*="animate-pulse"]').length + document.querySelectorAll('[data-refreshing]').length;
      const rows = document.querySelectorAll('table tbody tr').length;
      return sk > 0 || (rows === 0 && !/Mostrando |Sin resultados/.test(document.body.innerText));
    })()`);
    if (!busy) return true;
    await sleep(400);
  }
  return false;
};
const ci = (l) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(l).toLowerCase())})`;
const clickButton = async (label) => { await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`); await sleep(600); };
/** botón DENTRO del diálogo (el modal bloquea los de la tabla de atrás) */
const clickInDialog = async (exactLabel) => {
  await clickCenter(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    return [...dlg.querySelectorAll('button')].find(b => b.innerText.trim().toLowerCase() === ${JSON.stringify(String(exactLabel).toLowerCase())}) ?? null;
  })()`);
  await sleep(600);
};
const setSearch = async (text) => {
  await clickCenter(`document.querySelector('input[placeholder^="Buscar por teléfono"]')`);
  await evalx(`(() => { document.querySelector('input[placeholder^="Buscar por teléfono"]').select(); })()`);
  await keyNav('Backspace', 'Backspace', 8);
  if (text) await typeText(text);
  await waitTable();
  await sleep(400);
};
/** filas de la tabla: nombre, repuestos, stock, alias (chips) */
const rows = () => evalx(`(() => [...document.querySelectorAll('table tbody tr')].map(r => {
  const td = r.querySelectorAll('td');
  const chips = [...td[0].querySelectorAll('span')].map(s => s.innerText.trim()).filter(t => /escrito/.test(t));
  return { name: td[0].innerText.trim().split('\\n')[0], rep: td[2].innerText.trim(), stock: td[3].innerText.trim(), alias: chips[0] ?? '' };
}))()`);

// --- sesión de dueño ---
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2200); }
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Modelos')`);
await sleep(1000);
await waitTable();

const before = await evalx(`(async () => (await window.__TAURI_INTERNALS__.invoke('get_phones', { brand: null, search: '', onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 0, offset: 0 })).total)()`);
console.log(`· teléfonos al empezar: ${before}`);

// ============ 1. FUSIONAR: «Spark 8P» se queda con «8P» ============
// (la búsqueda es por tokens: "spark 8p" solo encontraría una; con "8p" salen las dos)
await setSearch('8p');
const pre = await rows();
const spark = pre.find(r => r.name === 'Spark 8P');
const eight = pre.find(r => r.name === '8P');
check('antes de fusionar están las dos fichas', !!spark && !!eight, pre.map(r => `${r.name}(${r.rep})`).join(' | '));

if (spark && eight) {
  // abrir «juntar» (botón de icono) en la fila de Spark 8P
  await clickCenter(`(() => {
    const tr = [...document.querySelectorAll('table tbody tr')].find(r => r.querySelector('td')?.innerText.trim().startsWith('Spark 8P'));
    if (!tr) return null;
    return [...tr.querySelectorAll('button')].find(b => b.title && /mismo teléfono/i.test(b.title)) ?? null;
  })()`);
  await sleep(1200);
  const mergeTitle = await evalx(`document.querySelector('[role="dialog"]')?.innerText.slice(0, 120).replace(/\\n/g, ' ') ?? null`);
  check('abre el diálogo de fusión con la ficha que se queda', /Fusionar «Spark 8P»/.test(mergeTitle ?? ''), String(mergeTitle).slice(0, 80));

  // buscar «8P» en el diálogo y juntar la fila que NO es Spark 8P
  await clickCenter(`document.querySelector('[role="dialog"] input')`);
  await typeText('8p');
  await sleep(1400);
  const candIdx = await evalx(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const btns = [...dlg.querySelectorAll('button')].filter(b => /juntar esta/i.test(b.innerText));
    return btns.findIndex(b => /^8P\\b/.test(b.parentElement.innerText.trim()));
  })()`);
  check('el diálogo encuentra el otro escrito («8P»)', candIdx >= 0, `índice ${candIdx}`);
  await clickCenter(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const btns = [...dlg.querySelectorAll('button')].filter(b => /juntar esta/i.test(b.innerText));
    return btns[${candIdx}] ?? null;
  })()`);
  await sleep(2200);

  const afterMerge = await evalx(`(async () => (await window.__TAURI_INTERNALS__.invoke('get_phones', { brand: null, search: '', onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 0, offset: 0 })).total)()`);
  check('la fusión deja UN teléfono menos', afterMerge === before - 1, `${before} → ${afterMerge}`);
  await setSearch('spark 8p');
  const post = await rows();
  check('queda una sola ficha «Spark 8P» (el otro escrito pasó a alias)',
    post.some(r => r.name === 'Spark 8P') && !post.some(r => r.name === '8P'),
    post.map(r => `${r.name} ${r.alias}`).join(' | '));
} else {
  console.log('· la fusión ya se había hecho en una corrida anterior: se salta ese paso');
}

// ============ 2. AGREGAR + RENOMBRAR (ficha de prueba, se limpia después) ============
await setSearch('');
await clickButton('Agregar teléfono');
await sleep(900);
await clickCenter(`document.querySelector('[role="dialog"] button[role="combobox"]')`);
await sleep(600);
await clickCenter(`[...document.querySelectorAll('[role="option"]')].find(o => /^Genérico$/i.test(o.innerText.trim()))`);
await sleep(500);
const inputs = `document.querySelector('[role="dialog"]').querySelectorAll('input')`;
await clickCenter(`(() => { const i = (${inputs})[0]; return i ?? null; })()`);
await typeText('Prueba');
await clickCenter(`(() => { const i = (${inputs})[1]; return i ?? null; })()`);
await typeText('F24');
await sleep(700);
await clickInDialog('Agregar');
await sleep(2200);
const dialogGone = !(await evalx(`!!document.querySelector('[role="dialog"]')`));
check('el diálogo de alta se cierra al guardar', dialogGone, `dialogo=${!dialogGone}`);
await setSearch('prueba f24');
let added = await rows();
check('«Agregar teléfono» crea la ficha', added.some(r => /Prueba F24/.test(r.name)), added.map(r => r.name).slice(0, 3).join(' | '));
const createdId = await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('get_phones', { brand: null, search: 'prueba f24', onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 5, offset: 0 });
  return p.items[0] ? p.items[0].id : null;
})()`);
console.log(`· ficha de prueba creada: id=${createdId}`);

// renombrar esa ficha (línea Test + modelo F24 → «Test F24»)
await clickInDialog('Cancelar').catch(() => {});
await clickButton('Corregir');
await sleep(900);
await clickCenter(`document.querySelector('[role="dialog"] button[role="combobox"]')`);
await sleep(600);
await clickCenter(`[...document.querySelectorAll('[role="option"]')].find(o => /^Genérico$/i.test(o.innerText.trim()))`);
await sleep(400);
await clickCenter(`(() => { const i = (${inputs})[0]; return i ?? null; })()`);
await evalx(`(() => { (${inputs})[0].select(); })()`);
await keyNav('Backspace', 'Backspace', 8);
await typeText('Test');
await clickCenter(`(() => { const i = (${inputs})[1]; return i ?? null; })()`);
await evalx(`(() => { (${inputs})[1].select(); })()`);
await keyNav('Backspace', 'Backspace', 8);
await typeText('F24');
await sleep(1400);
const pv = await evalx(`document.querySelector('[role="dialog"]')?.innerText.match(/Quedará:[\\s\\S]{0,60}/)?.[0]?.replace(/\\n/g, ' ') ?? null`);
check('la vista previa muestra el nombre nuevo', /Quedará: Test F24/.test(pv ?? ''), String(pv).slice(0, 70));
await clickInDialog('Guardar nombre');
await sleep(2200);
await setSearch('test f24');
const renamed = await rows();
check('el renombrado se guarda (nombre comercial con línea)', renamed.some(r => /Test F24/.test(r.name)), renamed.map(r => r.name).slice(0, 3).join(' | '));

console.log(`\nFICHA_DE_PRUEBA_ID=${createdId}`);
const failed = out.filter(r => !r.ok);
console.log(`${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
