// Verificación EN VIVO (SOLO LECTURA) del wizard de recepción y del selector de métodos (F31).
//
// Qué comprueba, sin escribir NADA en la base (nunca toca Guardar):
//   1. «Nuevo Servicio» abre el wizard y el FOCO cae en el campo Cliente.
//   2. Cuando falta algo, la pantalla lo dice («Falta: …»).
//   3. Enter en un campo AVANZA al paso siguiente cuando el paso está completo.
//   4. En el paso Equipos, el método de pago muestra SOLO los 3 favoritos como chips
//      (PUNTO Bs · PAGO MOVIL · EFECTIVO $) y los otros 4 están detrás de «Otros métodos…».
//   5. Elegir del desplegable deja el método elegido visible.
//   6. Escribir el TELÉFONO de un cliente conocido lo trae (nombre/cédula completados).
//
// Uso: node tools/verify_wizard_metodos.mjs   (app de dev abierta, CDP en 9222)

import { evalx, clickCenter, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => {
  out.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const dialogsOpen = () => evalx(`document.querySelectorAll('[role="dialog"]').length`);
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
const typeIn = (selector, text) => evalx(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  return true;
})()`);
// Botón por texto exacto/contenido, dentro del último diálogo abierto
const clickText = (txt) => evalx(`(() => {
  const root = document.querySelector('[role="dialog"]') || document;
  const el = [...root.querySelectorAll('button')].find(b => (b.textContent || '').trim().includes(${JSON.stringify(txt)}));
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  window.__clickAt = JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`);

console.log('— Wizard de recepción + métodos de pago (F31) — verificación en vivo SOLO LECTURA —');
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3000);

// La recarga vuelve a pedir el PIN (el gate es fail-closed): se entra como dueño con el PIN del
// local (1234) — es un desbloqueo de UI, no escribe nada en la base.
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

// Servicio Técnico → Nuevo Servicio
await evalx(`(() => {
  const it = [...document.querySelectorAll('aside a, aside button')].find(b => (b.textContent || '').toLowerCase().includes('servicio'));
  if (it) it.click();
  return !!it;
})()`);
await sleep(900);
await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Nuevo Servicio'))`);
await sleep(900);
let txt = await dialogText();
check('«Nuevo Servicio» abre el wizard', !!txt && txt.includes('Nuevo Servicio Técnico'), txt ? txt.split('\n')[0] : 'sin diálogo');

// 1) foco en Cliente
const foco = await evalx(`(() => {
  const a = document.activeElement;
  return a ? (a.getAttribute('placeholder') || a.tagName) : null;
})()`);
check('el foco arranca en el campo Cliente', (foco || '').includes('Buscar por nombre o cédula'), `foco: ${foco}`);

// 2) dice qué falta
check('avisa qué falta para poder avanzar', !!txt && /Falta:/.test(txt),
  txt ? (txt.match(/Falta:[^\n]*/) || [''])[0] : '');

// 3) el TELÉFONO trae al cliente conocido (se prueba ANTES de escribir el nombre: es el caso del
//    mostrador — el cliente dice su teléfono y la ficha se completa sola).
const tel = await evalx(`(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const lista = await inv('get_clients', { search: '' });
  const c = (lista || []).find(x => x.phone && String(x.phone).replace(/\\D/g, '').length >= 7);
  return c ? JSON.stringify({ phone: c.phone, name: c.name }) : null;
})()`);
const conocido = tel ? JSON.parse(tel) : null;
if (conocido) {
  await typeIn('input[placeholder="0412-1234567"]', conocido.phone);
  await sleep(1000);
  const conTel = await dialogText();
  check(`escribir el teléfono ${conocido.phone} trae al cliente conocido`,
    /Cliente conocido con ese teléfono/.test(conTel || ''),
    conTel ? (conTel.match(/Cliente conocido[^\n]*/) || [''])[0] : '');
  //  // el botón de la sugerencia lleva el NOMBRE del cliente (no el rótulo «Cliente conocido…»)
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => (b.textContent || '').includes(${JSON.stringify(conocido.name)}))`);
  await sleep(800);
  // OJO: los `value` de los <input> NO salen en `innerText` — hay que leerlos del DOM.
  const valores = await evalx(`(() => JSON.stringify({
    cliente: document.querySelector('input[placeholder^="Buscar por nombre"]')?.value ?? null,
    cedula: document.querySelector('input[placeholder="V-12345678"]')?.value ?? null,
  }))()`);
  const v = JSON.parse(valores || '{}');
  check('un toque completa el cliente (nombre y cédula)',
    (v.cliente || '').includes(conocido.name.split(' ')[0]) && !!v.cedula,
    `cliente: ${v.cliente} · cédula: ${v.cedula}`);
  check('ya no falta nada en el paso Cliente', !/Falta:/.test((await dialogText()) || ''));
} else {
  check('hay un cliente con teléfono para probar', false, 'no se encontró ninguno');
}

// 4) Enter avanza al paso siguiente (el operario sigue tipeando en un campo)
await evalx(`(document.querySelector('input[placeholder="V-12345678"]') || document.activeElement)?.focus(); true`);
await sleep(200);
const focoCampo = await evalx(`document.activeElement?.tagName === 'INPUT'`);
check('el foco está en un campo al apretar Enter', !!focoCampo);
await pressEnter();
await sleep(800);
txt = await dialogText();
// OJO: el stepper nombra TODOS los pasos, así que la única prueba honesta es «Paso N de M».
check('ENTER avanza al paso siguiente', /Paso 2 de 4/.test(txt || ''),
  txt ? (txt.match(/Paso \d+ de \d+[^\n]*/) || [''])[0] : '');

// 5) método de pago: 3 chips favoritos + el resto detrás del desplegable
const chips = await evalx(`(() => {
  const items = [...document.querySelectorAll('[role="dialog"] button[data-state]')]
    .map(b => (b.textContent || '').replace(/\\s+/g, ' ').trim())
    .filter(t => /PUNTO Bs|PAGO MOVIL|EFECTIVO/.test(t));
  return JSON.stringify(items);
})()`);
const listaChips = JSON.parse(chips || '[]');
check('los 3 métodos que más se usan están como acceso directo', listaChips.length === 3, listaChips.join(' · '));
// El TEXTO exacto del chip importa: «PUNTO Bs Bs.» (símbolo repetido) se escapó una vez porque la
// prueba solo contaba chips. Se exige que el símbolo no se repita.
check('el chip de Punto de Venta (Bs) no repite el símbolo', listaChips.some(c => c === 'PUNTO Bs'), listaChips.join(' · '));
check('el chip de Efectivo ($) no repite el símbolo', listaChips.some(c => c === 'EFECTIVO $'), listaChips.join(' · '));
check('el chip de Pago Móvil dice Bs. una sola vez',
  listaChips.some(c => c.startsWith('PAGO MOVIL') && (c.match(/Bs/g) || []).length === 1), listaChips.join(' · '));
const chevrons = await evalx(`(() => {
  const t = [...document.querySelectorAll('[role="dialog"] button, button')].find(b => (b.textContent || '').includes('Otros métodos'));
  return t ? t.querySelectorAll('svg').length : -1;
})()`);
check('el desplegable tiene UN solo chevron (no dos)', chevrons === 1, `svgs: ${chevrons}`);
const textoDialogo = await dialogText();
const otrosVisibles = ['Punto de Venta ($)', 'Transferencia Zelle', 'Transferencia Bs', 'Efectivo Bs']
  .filter(m => (textoDialogo || '').includes(m));
check('los demás NO están a la vista (van en el desplegable)', otrosVisibles.length === 0, otrosVisibles.join(', '));

// abrir el desplegable «Otros métodos…»
await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Otros métodos'))`);
await sleep(900);
const opciones = await evalx(`(() => {
  const ops = [...document.querySelectorAll('[role="option"]')].map(o => (o.textContent || '').replace(/\\s+/g, ' ').trim());
  return JSON.stringify(ops);
})()`);
const listaOps = JSON.parse(opciones || '[]');
check('el desplegable SÍ trae los otros métodos', listaOps.length >= 4, listaOps.join(' · '));

// 6) elegir uno del desplegable y ver que queda visible
await clickCenter(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent || '').includes('Transferencia Zelle'))`);
await sleep(800);
const trasElegir = await dialogText();
check('elegir del desplegable deja el método elegido visible', /ZELLE/.test(trasElegir || ''),
  trasElegir ? (trasElegir.match(/ZELLE[^\n]*/) || [''])[0] : '');

// cerrar sin guardar (dos Escape por si quedó algo abierto)
await pressEscape();
await sleep(500);
await pressEscape();
await sleep(700);
const abiertos = await dialogsOpen();
check('se cierra sin dejar diálogos apilados (y sin guardar nada)', abiertos === 0, `${abiertos} diálogo(s)`);

const fails = out.filter(o => !o.ok);
console.log(`\nwizard + métodos: ${out.length} comprobaciones · ${out.length - fails.length} OK · ${fails.length} fallo(s)`);
console.log('(solo lectura: nunca se pulsó Guardar; no se escribió nada en la base)');
process.exit(fails.length > 0 ? 1 : 0);
