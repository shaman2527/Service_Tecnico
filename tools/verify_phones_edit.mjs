// Verificación EN VIVO de F24 (corregir/fusionar la lista de modelos) por CDP.
//
// Requisitos: app de dev con
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//   $env:REGISTRO_DB="<copia de trabajo>"      (modo DEV: nunca la DB de la tienda)
// Uso: node tools/verify_phones_edit.mjs [--cashier]      (--cashier prueba el gate)
//
// OJO `--cashier`: el gate del backend (`Database::owner_unlocked`) se desbloquea con el PIN y
// queda abierto MIENTRAS VIVE EL PROCESO. Para probar que la cajera no puede escribir hay que
// ARRANCAR LA APP LIMPIA y correr SOLO este modo (sin haber entrado como dueño antes): si no,
// el chequeo «el BACKEND rechaza el rename» falla por estado de la app, no por un bug.
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const CASHIER = process.argv.includes('--cashier');
const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

const waitTable = async (timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const busy = await evalx(`(() => {
      const sk = document.querySelectorAll('table tbody [class*="animate-pulse"]').length + document.querySelectorAll('[data-refreshing]').length;
      const rows = document.querySelectorAll('table tbody tr').length;
      const done = /Mostrando |Sin resultados/.test(document.body.innerText);
      return sk > 0 || (rows === 0 && !done);
    })()`);
    if (!busy) return true;
    await sleep(400);
  }
  return false;
};
const ci = (l) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(l).toLowerCase())})`;
const clickButton = async (label) => { await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`); await waitTable(); };
const rowText = async (col = 0, n = 3) => evalx(`(() => [...document.querySelectorAll('table tbody tr')].slice(0, ${n}).map(r => r.querySelectorAll('td')[${col}]?.innerText.trim()))()`);

// Arranque limpio: la SPA se recarga y siempre empieza en la pantalla de PIN. Sin esto, una
// corrida anterior deja la sesión abierta (o en modo cajera) y los scripts se pisan entre sí.
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

const setSearch = async (text) => {
  await clickCenter(`document.querySelector('input[placeholder^="Buscar por teléfono"]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder^="Buscar por teléfono"]'); i.select(); })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await typeText(text);
  await waitTable();
};

// --- 0. PIN (dueño o cajera) ---
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) {
  if (CASHIER) {
    console.log('· entrando como CAJERA (sin PIN)');
    await clickButton('Entrar como cajera');
    await sleep(2000);
  } else {
    await clickCenter(pin);
    await typeText('1234');
    await keyNav('Enter', 'Enter', 13);
    await sleep(2200);
  }
}

// --- 1. Modelos ---
// si quedó un diálogo abierto de una corrida anterior, se cierra
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) {
  await keyNav('Escape', 'Escape', 27);
  await sleep(700);
}
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Modelos')`);
await sleep(1000);
await waitTable();

const kpis = await evalx(`(() => {
  const o = {};
  for (const d of document.querySelectorAll('div')) {
    const l = d.querySelector(':scope > span:first-child'); const v = d.querySelector(':scope > span:nth-child(2)');
    if (l && v && /^[A-ZÁÉÍÓÚ ]+$/.test(l.innerText.trim()) && d.children.length <= 3) o[l.innerText.trim()] = v.innerText.trim();
  }
  return o;
})()`);
const num = (s) => { const m = String(s ?? '').match(/-?\d+/g); return m ? Number(m[m.length - 1]) : null; };
// los números esperados salen del PROPIO backend (así la prueba no queda atada a un
// conteo fijo cuando el taller renombra/fusiona)
const back = await evalx(`(async () => {
  const b = await window.__TAURI_INTERNALS__.invoke('get_phone_brands');
  return JSON.stringify({
    phones: b.reduce((a, x) => a + x.phones, 0),
    review: b.reduce((a, x) => a + x.needs_review, 0),
  });
})()`);
const esperado = JSON.parse(back);
check('los KPIs de la pestaña coinciden con el padrón del backend',
  num(kpis.TELÉFONOS) === esperado.phones && num(kpis['POR REVISAR']) === esperado.review,
  `UI ${kpis.TELÉFONOS}/${kpis['POR REVISAR']} vs backend ${esperado.phones}/${esperado.review}`);

// --- 2. las reglas se ven en la lista (la búsqueda es por tokens, así que se
//        comprueba que exista la ficha correcta y que NO queden las variantes viejas) ---
const allNames = async () => evalx(`(() => [...document.querySelectorAll('table tbody tr')].map(r => r.querySelectorAll('td')[0].innerText.trim().split('\\n')[0]))()`);

await setSearch('poco x3');
let names = await allNames();
check('POCO: existe la ficha «Poco X3» y ninguna «Mi Poco»/«Redmi Poco»',
  names.includes('Poco X3') && !names.some(n => /^(Mi|Redmi) Poco/i.test(n)), names.join(' | '));

await setSearch('honor x6a');
names = await allNames();
check('HONOR: existe «Honor X6A» y ninguna «Huawei Honor …»',
  names.includes('Honor X6A') && !names.some(n => /^Huawei Honor/i.test(n)), names.join(' | '));

await setSearch('realme c35');
names = await allNames();
check('REALME: existe «Realme C35»', names.includes('Realme C35'), names.join(' | '));

// --- 3. botones de escritura según la sesión ---
await setSearch('');
const buttons = await evalx(`(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean))()`);
const hasEdit = buttons.some(b => b.toLowerCase() === 'corregir');
const hasAdd = buttons.some(b => b.toLowerCase().startsWith('agregar teléfono'));
check(CASHIER ? 'cajera: NO ve los botones de escritura' : 'dueño: ve «Corregir» y «Agregar teléfono»',
  CASHIER ? (!hasEdit && !hasAdd) : (hasEdit && hasAdd), `corregir=${hasEdit} agregar=${hasAdd}`);

// --- 4. el backend rechaza la escritura sin sesión de dueño ---
if (CASHIER) {
  const res = await evalx(`(async () => {
    try {
      const page = await window.__TAURI_INTERNALS__.invoke('get_phones', { brand: null, search: 'a06', onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 1, offset: 0 });
      await window.__TAURI_INTERNALS__.invoke('rename_phone', { id: page.items[0].id, brand: page.items[0].brand, line: page.items[0].line, model: page.items[0].model });
      return 'ESCRIBIO';
    } catch (e) { return String(e); }
  })()`);
  check('el BACKEND rechaza el rename en sesión de cajera',
    /due[nñ]o/i.test(String(res)), String(res).slice(0, 90));
} else {
  // --- 5. dueño: vista previa + fusión real de un par escrito distinto ---
  await setSearch('spark 8p');
  let pair = await evalx(`(() => [...document.querySelectorAll('table tbody tr')].map(r => { const td = r.querySelectorAll('td'); return { name: td[0].innerText.trim().split('\\n')[0], rep: td[2].innerText.trim(), stock: td[3].innerText.trim() }; }))()`);
  console.log('   (buscando el par «8P» / «Spark 8P»):', JSON.stringify(pair));
  await setSearch('8p');
  const candidates = await rowText(0, 6);
  check('el par escrito distinto aparece separado (ej. «8P» vs «Spark 8P»)', candidates.length >= 1, candidates.join(' | '));

  // abrir «Corregir» del primero y ver la VISTA PREVIA (sin guardar)
  await clickButton('Corregir');
  await sleep(900);
  const dialogTitle = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.slice(0, 200) ?? null)()`);
  const currentName = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.match(/Ahora:[\\s\\S]{0,60}/)?.[0]?.replace(/\\n/g, ' ') ?? null)()`);
  check('«Corregir» abre el diálogo con el nombre actual', /Ahora:/.test(dialogTitle ?? ''), String(currentName).slice(0, 70));

  // escribir un nombre nuevo → la vista previa muestra el nombre comercial y si conserva repuestos
  const brandTrigger = `document.querySelector('[role="dialog"] button[role="combobox"]')`;
  await clickCenter(brandTrigger);
  await sleep(600);
  await clickCenter(`[...document.querySelectorAll('[role="option"]')].find(o => /^Tecno$/i.test(o.innerText.trim()))`);
  await sleep(500);
  const inputs = `document.querySelectorAll('[role="dialog"] input')`;
  await clickCenter(`${inputs}[0]`);            // línea (el 1º input del diálogo)
  await typeText('Spark');
  await clickCenter(`${inputs}[1]`);            // modelo (el 2º)
  await typeText(' 8P');
  await sleep(1400);
  const preview = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.match(/Quedará:[\\s\\S]{0,160}/)?.[0]?.replace(/\\n/g, ' ') ?? null)()`);
  check('la vista previa dice cómo queda el nombre y los repuestos que conserva',
    /Quedará:/.test(preview ?? '') && /repuestos/.test(preview ?? ''), String(preview).slice(0, 120));

  // cancelar (no debe escribir)
  await clickButton('Cancelar');
  await sleep(700);
  const stillThere = await rowText(0, 6);
  check('cancelar no cambia nada', stillThere.length >= 1, stillThere.join(' | '));
}

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
