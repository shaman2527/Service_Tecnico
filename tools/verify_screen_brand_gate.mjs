// Verificación EN VIVO (SOLO LECTURA) del GATE DE MARCA de la pantalla a instalar (B2).
//
// Qué comprueba, sin escribir NADA en la base (nunca toca Guardar):
//   1. Los TRES casos reales medidos en el catálogo del local: la candidata de OTRA marca
//      queda marcada `brand_match: false` y NO va primera.
//        · «Honor 10 Lite»  → pantalla de «Infinix Hot 10 Lite»
//        · «A11» (Umidigi)  → pantalla de «Samsung A11»
//        · «Realme 11 5G»   → pantalla de «Xiaomi Redmi Note 11 5G»
//   2. Caso normal (sin regresión): un modelo con su pantalla de la misma marca la pone
//      PRIMERA y con stock.
//   3. En el formulario: cuando la única pantalla con stock es de OTRA marca, el campo NO se
//      auto-selecciona (antes se elegía sola y el descuento caía en el repuesto equivocado).
//   4. La opción de otra marca se avisa («otra marca») y al elegirla aparece el aviso.
//
// Uso: node tools/verify_screen_brand_gate.mjs   (app de dev abierta, CDP en 9222)

import { evalx, clickCenter, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => {
  out.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

const inv = async (cmd, args) => JSON.parse(await evalx(
  `(async () => JSON.stringify(await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})))()`));
const screens = (model) => inv('find_compatible_screens', { model, limit: 40 });
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const dialogsOpen = () => evalx(`document.querySelectorAll('[role="dialog"]').length`);
const typeIn = (selector, text) => evalx(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  return true;
})()`);
const pressEnter = () => evalx(`(() => {
  const el = document.activeElement;
  if (!el) return false;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
const pressEscape = () => evalx(`(() => {
  const el = document.querySelector('[role="dialog"]') || document;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
})()`);
/** Las opciones del desplegable «Pantalla a instalar»: texto, si es de otra marca y si está elegida. */
const opcionesPantalla = async () => JSON.parse(await evalx(`(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return '[]';
  const out = [...d.querySelectorAll('button')]
    .filter(b => /stock -?\\d+|agotada/.test(b.textContent || ''))
    .map(b => ({
      texto: (b.textContent || '').replace(/\\s+/g, ' ').trim(),
      otraMarca: /otra marca/.test(b.textContent || ''),
      elegida: /ring-primary/.test(b.className || ''),
    }));
  return JSON.stringify(out);
})()`));

console.log('— Gate de marca de la pantalla a instalar (B2) — verificación en vivo SOLO LECTURA —');
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3000);

const desbloquear = async () => {
  const hayPin = await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`).catch(() => false);
  if (!hayPin) return;
  await typeIn('input[placeholder="PIN de 4 dígitos"]', '1234');
  await sleep(300);
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Entrar')`);
  await sleep(1200);
};

let listo = false;
for (let i = 0; i < 25 && !listo; i++) {
  try {
    if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) await desbloquear();
    listo = await evalx(`!!document.querySelector('aside')`);
  } catch { /* cargando */ }
  if (!listo) await sleep(800);
}
if (!listo) { check('la app responde', false); process.exit(1); }
check('la app responde (desbloqueada con el PIN del local)', true);
if (await dialogsOpen() > 0) { console.log('\nABORTADO: hay un diálogo abierto (app en uso).'); process.exit(2); }

// ── 1. backend: los tres casos reales + el control ────────────────────────────────────
const primera = (c) => c[0] || null;
const buscar = (c, re) => c.find(x => re.test(x.product.name)) || null;

// «Realme 11 5G»: la pantalla del propio teléfono (Realme) va primera aunque esté agotada y
// la de Xiaomi (la que se elegía sola, con stock) queda marcada como de otra marca.
const realme = await screens('Realme 11 5G');
check('Realme 11 5G devuelve candidatas', realme.length > 0, `${realme.length}`);
const rmOtra = buscar(realme, /Redmi|Xiaomi/i);
check('Realme 11 5G: la pantalla de Xiaomi/Redmi queda como de OTRA marca',
  !!rmOtra && rmOtra.brand_match === false, rmOtra ? `${rmOtra.product.name} (brand_match=${rmOtra.brand_match})` : 'no está');
check('Realme 11 5G: la primera candidata es de la MISMA marca',
  !!primera(realme) && primera(realme).brand_match === true,
  primera(realme) ? `${primera(realme).product.name} (${primera(realme).match_quality}, stock ${primera(realme).product.stock})` : 'sin candidatas');
check('Realme 11 5G: la de otra marca NO va primera',
  !!primera(realme) && !/Redmi|Xiaomi/i.test(primera(realme).product.name),
  primera(realme)?.product.name || '');

// «Honor 10 Lite»: la ficha que se elegía sola era la de Infinix Hot 10 Lite
const honor = await screens('Honor 10 Lite');
check('Honor 10 Lite devuelve candidatas', honor.length > 0, `${honor.length}`);
const honorOtra = buscar(honor, /Infinix|Tecno/i);
check('Honor 10 Lite: la pantalla de Infinix/Tecno queda como de OTRA marca',
  !honorOtra || honorOtra.brand_match === false,
  honorOtra ? `${honorOtra.product.name} (brand_match=${honorOtra.brand_match})` : 'no está en el catálogo');
check('Honor 10 Lite: si hay candidata de la marca, va primera',
  honor.every(x => x.brand_match === false) || primera(honor).brand_match === true,
  primera(honor) ? `${primera(honor).product.name} (brand_match=${primera(honor).brand_match})` : '');

// «A11» es AMBIGUO en el padrón (Umidigi A11 y Samsung Galaxy A11, que es como la lista del
// local escribe la pantalla Samsung) → SIN CERTEZA: no se marca marca, no se avisa nada y el
// formulario NO auto-elige. Es el caso que el revisor adversarial marcó como riesgo de
// «invertir» el gate: mejor sin opinión que con la marca equivocada.
const padronA11 = await inv('get_phones', {
  brand: null, search: 'A11', onlyWithProducts: false, onlyStock: false, onlyReview: false,
  sort: 'name', dir: 'asc', limit: 20, offset: 0,
});
const filaA11 = (padronA11?.items || []).find(p => (p.name || '').trim() === 'A11');
check('el padrón tiene la ficha «A11» (marca del teléfono)', !!filaA11,
  filaA11 ? `${filaA11.brand} · ${filaA11.with_stock ?? '?'}/${filaA11.screens ?? '?'} con stock` : JSON.stringify(padronA11).slice(0, 120));
const a11 = await screens('A11');
check('A11 devuelve candidatas', a11.length > 0, `${a11.length}`);
check('A11 (texto ambiguo): NO se marca la marca de ninguna candidata',
  a11.every(x => x.brand_known === false && x.brand_match === false),
  a11.slice(0, 4).map(x => `${x.product.name} (known=${x.brand_known}, match=${x.brand_match})`).join(' | '));
const autoA11 = a11.filter(x => x.in_stock && x.brand_match);
check('A11 (texto ambiguo): nada se auto-elige (lo decide el operario)', autoA11.length === 0,
  autoA11.map(x => x.product.name).join(' | ') || 'ninguna');

// Escrito a mano CON marca, la marca SÍ se conoce y el gate vuelve a funcionar
const a11s = await screens('Samsung A11');
const samsung = buscar(a11s, /Samsung A11/i);
check('«Samsung A11» (con marca en el texto): la pantalla Samsung es de su marca',
  !!samsung && samsung.brand_match === true && samsung.brand_known === true,
  samsung ? `${samsung.product.name} (match=${samsung.brand_match}, known=${samsung.brand_known})` : 'no está');

// Control: un modelo con su pantalla de la misma marca sigue resolviéndose igual que antes
const control = await screens('Redmi Note 11');
const propiasConStock = control.filter(x => x.brand_match && x.in_stock);
check('control (Redmi Note 11): sigue habiendo pantalla de la marca CON stock', propiasConStock.length > 0,
  propiasConStock.slice(0, 2).map(x => `${x.product.name} (${x.product.stock})`).join(' | '));
check('control: la primera candidata es de la marca y con stock',
  !!primera(control) && primera(control).brand_match === true && primera(control).in_stock === true,
  primera(control) ? `${primera(control).product.name} (stock ${primera(control).product.stock})` : 'sin candidatas');

// ── 2. formulario: no se auto-selecciona una pantalla de otra marca ───────────────────
await evalx(`(() => {
  const it = [...document.querySelectorAll('aside a, aside button')].find(b => (b.textContent || '').toLowerCase().includes('servicio'));
  if (it) it.click();
  return !!it;
})()`);
await sleep(900);
await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Nuevo Servicio'))`);
await sleep(900);

const cliente = JSON.parse(await evalx(`(async () => {
  const lista = await window.__TAURI_INTERNALS__.invoke('get_clients', { search: '' });
  const c = (lista || []).find(x => x.phone && String(x.phone).replace(/\\D/g, '').length >= 7);
  return JSON.stringify(c ? { phone: c.phone, name: c.name } : null);
})()`));
if (cliente) {
  await typeIn('input[placeholder="0412-1234567"]', cliente.phone);
  await sleep(1000);
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => (b.textContent || '').includes(${JSON.stringify(cliente.name)}))`);
  await sleep(800);
}
await evalx(`(document.querySelector('input[placeholder="V-12345678"]') || document.activeElement)?.focus(); true`);
await pressEnter();
await sleep(900);
check('el wizard está en el paso Equipos', /Paso 2 de 4/.test((await dialogText()) || ''), (await dialogText() || '').match(/Paso \d+ de \d+[^\n]*/)?.[0] || '');

// UI: se usa un modelo NO ambiguo del padrón («Honor 10 Lite»: el padrón tiene UNA ficha Honor y
// el catálogo tiene la ficha de Infinix `Hot 10 Lite` que antes se elegía sola por coincidir el
// texto. Con «A11» el texto es ambiguo y —por diseño— no hay aviso ni auto-selección.)
const MODELO_UI = 'Honor 10 Lite';
await typeIn('input[placeholder^="Buscar el modelo del teléfono"]', MODELO_UI);
await sleep(1800);
let opciones = await opcionesPantalla();
check(`el desplegable de pantallas lista opciones para «${MODELO_UI}»`, opciones.length > 0,
  opciones.slice(0, 3).map(o => o.texto).join(' | '));
check('avisa cuáles son de OTRA marca', opciones.some(o => o.otraMarca),
  opciones.filter(o => o.otraMarca).map(o => o.texto).join(' | ') || 'ninguna marcada');
const autoElegida = opciones.find(o => o.elegida);
const unaSolaConStock = opciones.filter(o => /stock \d+/.test(o.texto) && !/stock 0$/.test(o.texto));
check('NO se auto-selecciona cuando la única con stock es de otra marca',
  !autoElegida, autoElegida ? `se eligió sola: ${autoElegida.texto}` : 'ninguna elegida (lo decide el operario)');
check('pide elegir la pantalla exacta', /Elige la pantalla exacta/.test((await dialogText()) || ''),
  `con stock: ${unaSolaConStock.length}`);

// elegir a mano la de otra marca → aviso visible (no bloquea: el operario puede confirmarlo)
const objetivo = opciones.find(o => o.otraMarca) || opciones[0];
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => (b.textContent || '').replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(objetivo.texto.slice(0, 40))}))`);
await sleep(900);
const txt = await dialogText();
check('al elegir una pantalla de otra marca avisa «OTRA marca»', /Ojo: es una pantalla de OTRA marca/i.test(txt || ''),
  txt ? (txt.match(/Ojo:[^\n]*/i) || [''])[0] : 'sin diálogo');
opciones = await opcionesPantalla();
check('la pantalla elegida queda marcada como elegida', !!opciones.find(o => o.elegida),
  opciones.find(o => o.elegida)?.texto || 'ninguna');

// cerrar sin guardar
await pressEscape();
await sleep(500);
await pressEscape();
await sleep(700);
const abiertos = await dialogsOpen();
check('se cierra sin dejar diálogos apilados (y sin guardar nada)', abiertos === 0, `${abiertos} diálogo(s)`);

const fails = out.filter(o => !o.ok);
console.log(`\ngate de marca de la pantalla: ${out.length} comprobaciones · ${out.length - fails.length} OK · ${fails.length} fallo(s)`);
console.log('(solo lectura: nunca se pulsó Guardar; no se escribió nada en la base)');
process.exit(fails.length > 0 ? 1 : 0);
