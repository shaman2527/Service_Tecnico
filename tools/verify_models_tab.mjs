// Verificación EN VIVO de la pestaña «Modelos» (feature F3) por CDP.
//
// Requisitos: la app de dev corriendo con
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//   $env:REGISTRO_DB="<copia de trabajo>"      (modo DEV: nunca la DB de la tienda)
//
// Uso: node tools/verify_models_tab.mjs
//
// Comprueba: KPIs del padrón, columna/filtro de marca, orden de 3 estados por
// columna (con aria-sort), vista «Por revisar», paginación y ficha por categoría.
//
// Los conteos del padrón son la EXPECTATIVA independiente de la corrida: al cambiar los datos
// (reglas de F24, regla «solo Pantalla» de F26, renombrados del taller) hay que actualizarlos aquí
// a mano — así el script detecta cualquier cambio que nadie pidió. También se pueden pisar por
// entorno: `$env:EXPECT_PHONES=1079; $env:EXPECT_REVIEW=142`.
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const EXPECT = {
  phones: Number(process.env.EXPECT_PHONES ?? 1079),
  review: Number(process.env.EXPECT_REVIEW ?? 142),
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

const txt = (sel) => evalx(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText.trim() : null; })()`);
const num = (s) => { const m = String(s ?? '').match(/-?\d+(?:[.,]\d+)?/g); return m ? Number(m[m.length - 1].replace(/\./g, '').replace(',', '.')) : null; };

/** Los KPIs de la franja: label -> valor (la franja está arriba de la tabla). */
const kpis = () => evalx(`(() => {
  const out = {};
  for (const d of document.querySelectorAll('div[title], div')) {
    const label = d.querySelector(':scope > span:first-child');
    const value = d.querySelector(':scope > span:nth-child(2)');
    if (label && value && /^[A-ZÁÉÍÓÚ ]+$/.test(label.innerText.trim()) && d.children.length <= 3) {
      out[label.innerText.trim()] = value.innerText.trim();
    }
  }
  return out;
})()`);

/** Estado de la tabla: filas + primer valor de una columna. */
const table = (colIndex = 0, limit = 5) => evalx(`(() => {
  const rows = [...document.querySelectorAll('table tbody tr')];
  const cells = rows.map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim()));
  return { rows: rows.length, sample: cells.slice(0, ${limit}).map(c => c[${colIndex}]), total: document.body.innerText.match(/Mostrando [\\d]+–[\\d]+ de (\\d+)/)?.[1] ?? null };
})()`);

/** Espera a que la tabla termine de cargar (la UI muestra filas esqueleto al consultar). */
const waitTable = async (timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const busy = await evalx(`(() => {
      const skeletons = document.querySelectorAll('table tbody [class*="animate-pulse"]').length;
      const rows = document.querySelectorAll('table tbody tr').length;
      const done = /Mostrando |Sin resultados/.test(document.body.innerText);
      return skeletons > 0 || (rows === 0 && !done);
    })()`);
    if (!busy) return true;
    await sleep(400);
  }
  return false;
};

/** Encabezados: label + aria-sort (los de la tabla del padrón). */
const headers = () => evalx(`(() => [...document.querySelectorAll('table thead th')].map(th => ({
  label: th.innerText.trim(), sort: th.getAttribute('aria-sort'),
})))()`);

/** Estado de un encabezado por nombre (sin importar mayúsculas). */
const headOf = (hs, label) => hs.find(h => h.label.toLowerCase().startsWith(label.toLowerCase()));

/** Compara etiquetas sin importar mayúsculas (la UI aplica `uppercase` en los encabezados). */
const ci = (label) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(label).toLowerCase())})`;

const clickHeader = async (label) => {
  await clickCenter(`[...document.querySelectorAll('table thead th button')].find(${ci(label)})`);
  await waitTable();
};

const clickButton = async (label) => {
  await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`);
  await waitTable();
};

const setSearch = async (text) => {
  await clickCenter(`document.querySelector('input[placeholder^="Buscar por teléfono"]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder^="Buscar por teléfono"]'); i.select(); })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await typeText(text);
  await waitTable();
};

/** Deja la pestaña sin filtros ni orden (por si la corrida anterior dejó estado). */
const resetFilters = async () => {
  const hasClean = await evalx(`!!([...document.querySelectorAll('button')].find(${ci('Limpiar')}))`);
  if (hasClean) { await clickButton('Limpiar'); }
  const value = await evalx(`(() => { const i = document.querySelector('input[placeholder^="Buscar por teléfono"]'); return i ? i.value : null; })()`);
  if (value) {
    await clickCenter(`document.querySelector('input[placeholder^="Buscar por teléfono"]')`);
    await evalx(`(() => { document.querySelector('input[placeholder^="Buscar por teléfono"]').select(); })()`);
    await keyNav('Backspace', 'Backspace', 8);
    await sleep(600);
  }
  await waitTable();
};

// --- 0. desbloqueo del PIN (si la app arrancó en frío) ---
const pinField = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pinField}`)) {
  console.log('· pantalla de PIN: entrando con 1234');
  await clickCenter(pinField);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
check('app desbloqueada (sidebar visible)', await evalx(`!!document.querySelector('aside')`));

// --- 1. Inventario → pestaña Modelos ---
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
const tabOk = await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Modelos')`).then(() => true).catch(() => false);
check('pestaña «Modelos» abre', tabOk && await evalx(`!!document.querySelector('input[placeholder^="Buscar por teléfono"]')`));
check('las pestañas usan el nombre nuevo', await evalx(`[...document.querySelectorAll('[role="tab"]')].map(t => t.innerText.trim()).join(' | ')`) ===
  'Productos | Modelos | Repuesto por modelo | Movimientos | Ajustes',
  await evalx(`[...document.querySelectorAll('[role="tab"]')].map(t => t.innerText.trim()).join(' | ')`));
await sleep(1200);
await resetFilters();

// --- 2. KPIs del padrón ---
const k = await kpis();
check('KPI Teléfonos = padrón completo', num(k.TELÉFONOS) === EXPECT.phones, `${k.TELÉFONOS} (esperado ${EXPECT.phones})`);
check('KPI Por revisar = sin familia', num(k['POR REVISAR']) === EXPECT.review, `${k['POR REVISAR']} (esperado ${EXPECT.review})`);
check('KPI Con repuestos y Con stock presentes', k['CON REPUESTOS'] != null && k['CON STOCK'] != null, `${k['CON REPUESTOS']} / ${k['CON STOCK']}`);

// --- 3. tabla + paginación ---
const t0 = await table(0);
check('tabla paginada a 50 filas', t0.rows === 50, `${t0.rows} filas`);
check('total del padrón en el pie', num(t0.total) === EXPECT.phones, `de ${t0.total}`);
const marcas = await evalx(`(() => [...document.querySelectorAll('table tbody tr')].map(r => r.querySelectorAll('td')[1]?.innerText.trim()))()`);
check('columna Marca con datos', marcas.filter(Boolean).length === 50, `${[...new Set(marcas)].slice(0, 5).join(', ')}…`);

// --- 4. orden de 3 estados ---
const h0 = await headers();
const sortables = h0.filter(h => h.sort).map(h => h.label.toUpperCase());
check('las 5 columnas ordenables exponen aria-sort', sortables.length === 5 && sortables.includes('MARCA'),
  h0.map(h => `${h.label}:${h.sort ?? '—'}`).join(' '));

await clickHeader('Repuestos'); await sleep(900);
const asc = await table(2);
const hAsc = headOf(await headers(), 'Repuestos');
await clickHeader('Repuestos'); await sleep(900);
const desc = await table(2);
const hDesc = headOf(await headers(), 'Repuestos');
await clickHeader('Repuestos'); await sleep(900);
const none = await table(0);
const hNone = headOf(await headers(), 'Repuestos');
const maxOf = (arr) => Math.max(...arr.map(v => Number(v) || 0));
const minOf = (arr) => Math.min(...arr.map(v => Number(v) || 0));
check('click 1 → ascendente (aria-sort=ascending)', hAsc?.sort === 'ascending', `${hAsc?.sort} · muestra ${asc.sample.join(',')}`);
check('click 2 → descendente (aria-sort=descending)', hDesc?.sort === 'descending', `${hDesc?.sort} · muestra ${desc.sample.join(',')}`);
check('click 3 → sin orden (aria-sort=none)', hNone?.sort === 'none', `${hNone?.sort}`);
check('el orden cambia el contenido (asc ≤ desc)',
  minOf(asc.sample) <= maxOf(desc.sample) && Number(desc.sample[0] || 0) >= Number(asc.sample[0] || 0),
  `asc[0]=${asc.sample[0]} desc[0]=${desc.sample[0]}`);

// orden por Marca (columna que antes ignoraba el sentido)
await clickHeader('Marca'); await sleep(900);
const marcaAsc = (await table(1, 3)).sample;
await clickHeader('Marca'); await sleep(900);
const marcaDesc = (await table(1, 3)).sample;
check('Marca ordena en los dos sentidos',
  marcaAsc[0].toLowerCase() <= marcaDesc[0].toLowerCase() && marcaAsc[0] !== marcaDesc[0],
  `asc=${marcaAsc.join(',')} · desc=${marcaDesc.join(',')}`);
await clickHeader('Marca'); await sleep(700); // vuelve a sin orden (nombre)

// --- 5. vista «Por revisar» (los sin familia) ---
await clickButton('Ver los');
await sleep(1200);
await waitTable();
const rev = await table(5, 50);
check('vista Por revisar devuelve filas', rev.rows > 0, `${rev.rows} filas · ${rev.total} en total`);
const revFlags = await evalx(`(() => [...document.querySelectorAll('table tbody tr')].map(r => r.querySelectorAll('td')[5]?.innerText.trim().toLowerCase()))()`);
check('todas las filas marcadas «Por revisar»', revFlags.every(f => f === 'por revisar'), `${new Set(revFlags).size} valores distintos`);
check('el total de la vista = KPI Por revisar', num(rev.total) === EXPECT.review, `${rev.total} vs ${EXPECT.review}`);

// --- 6. búsqueda + ficha ---
await clickButton('Limpiar');
await sleep(1000);
await setSearch('samsung a06');
const found = await table(0, 3);
check('búsqueda por teléfono devuelve la ficha', found.rows > 0 && found.sample.some(s => /A06/i.test(s)), found.sample.join(' | '));

await clickButton('Ficha');
await sleep(1500);
const dialog = await txt('[role="dialog"]');
check('la ficha abre con el teléfono y su marca', !!dialog && /A06/i.test(dialog), (dialog ?? '').split('\n').slice(0, 3).join(' / '));
check('la ficha agrupa por categoría (Pantalla primero)', /Pantalla/.test(dialog ?? '') && (dialog ?? '').indexOf('Pantalla') < ((dialog ?? '').indexOf('Táctil') === -1 ? 9999 : (dialog ?? '').indexOf('Táctil')),
  (dialog ?? '').split('\n').filter(l => /Pantalla|Táctil|Batería|Flex/.test(l)).slice(0, 3).join(' | '));
const fichaRows = await evalx(`document.querySelectorAll('[role="dialog"] table tbody tr').length`);
check('la ficha lista repuestos', fichaRows > 0, `${fichaRows} filas`);
await keyNav('Escape', 'Escape', 27);
await sleep(600);

// --- 7. nada escribió en el padrón ---
const after = await kpis();
check('el padrón no cambió al usar la pestaña', num(after.TELÉFONOS) === EXPECT.phones && num(after['POR REVISAR']) === EXPECT.review,
  `${after.TELÉFONOS} / ${after['POR REVISAR']}`);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
