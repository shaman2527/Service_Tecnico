// VERIFICACIÓN EN VIVO (feature 41) de la MEMORIA DEL CATÁLOGO del Inventario.
//
// Lo que se prueba NO es la velocidad (eso lo mide `bench_inventory_ui.mjs`): es que la memoria
// no MIENTA. El riesgo de memorizar el catálogo es mostrar un número viejo, así que acá se
// escribe de verdad en la base (una ficha de prueba) y se comprueba que los números de la
// pantalla se mueven — y que coinciden con la BASE leída aparte (la única fuente independiente:
// comparar la pantalla contra sí misma no probaría nada).
//
// Requisitos: la app RELEASE abierta contra una COPIA de la base:
//   $env:REGISTRO_DB="C:\...\backup\perf_app.db"
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//   Start-Process .\Registro.exe
// Uso: node tools/verify_inventario_rapido.mjs
// NO toca la base de la tienda; escribe y borra su propia ficha de prueba en la copia.
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

// --- la verdad independiente: la BASE, leída por otra conexión en sólo lectura -------------
// Se EXIGE la variable: si no está, leeríamos otro archivo que el de la app y todos los
// conteos fallarían con un mensaje que no explica nada (lección de `verify_tecnico_y_fecha_pago`).
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Falta REGISTRO_DB apuntando a la MISMA copia que usa la app.');
  console.error('  $env:REGISTRO_DB="C:\\...\\backup\\perf_app.db"  y relanzá la app con esa variable.');
  process.exit(2);
}
const contar = (tabla) => {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  const c = d.prepare(`SELECT COUNT(*) c FROM ${tabla}`).get().c;
  d.close();
  return c;
};

/** Espera una CONDICIÓN (nunca un reloj fijo: la lección de F38/F39). */
const waitFor = async (expr, timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(150);
  }
  return false;
};

/** Franja de KPIs: rótulo (en mayúsculas por CSS) → valor. */
const kpis = () => evalx(`(() => {
  const out = {};
  for (const d of document.querySelectorAll('div')) {
    const label = d.querySelector(':scope > span:first-child');
    const value = d.querySelector(':scope > span:nth-child(2)');
    if (label && value && d.children.length <= 3 && /^[A-ZÁÉÍÓÚÑ ]+$/.test(label.innerText.trim())) {
      out[label.innerText.trim()] = value.innerText.trim();
    }
  }
  return out;
})()`);
const num = (s) => { const m = String(s ?? '').replace(/\./g, '').match(/-?\d+/); return m ? Number(m[0]) : null; };
const kpi = async (label) => num((await kpis())[label]);

const SIDEBAR = (name) => `[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith(${JSON.stringify(name)}))`;
const TAB = (name) => `[...document.querySelectorAll('[role="tab"]')].find(b => b.innerText.trim().startsWith(${JSON.stringify(name)}))`;

const abrirModulo = async () => {
  await clickCenter(SIDEBAR('Inventario'));
  await waitFor(`!!document.querySelector('[role="tab"]')`);
  await waitFor(`document.querySelectorAll('[data-refreshing]').length === 0`);
};
const abrirTab = async (nombre) => {
  await clickCenter(TAB(nombre));
  await waitFor(`(() => {
    const t = document.querySelector('[role="tab"][data-state="active"]');
    return !!t && t.innerText.trim().startsWith(${JSON.stringify(nombre)});
  })()`);
  await waitFor(`document.querySelectorAll('[data-refreshing]').length === 0`);
};
const invocar = (cmd, args) => evalx(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);

// --- arranque + sesión de dueño (la copia de dev usa PIN 1234) ---
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await waitFor(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`, 20000);
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) {
  await clickCenter(pin);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await waitFor(`!!document.querySelector('aside')`, 15000);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

let nuevoId = null;
try {
  // --- los números de la pantalla, y los de la base ---
  await abrirModulo();
  await abrirTab('Productos');
  const productosAntes = await kpi('PRODUCTOS');
  check('Productos: la franja de números se pinta y coincide con la base',
    productosAntes !== null && productosAntes === contar('products'),
    `pantalla=${productosAntes} base=${contar('products')}`);

  await abrirTab('Modelos');
  const telefonosAntes = await kpi('TELÉFONOS');
  check('Modelos: la franja del padrón se pinta y coincide con la base',
    telefonosAntes !== null && telefonosAntes === contar('phones'),
    `pantalla=${telefonosAntes} base=${contar('phones')}`);

  // volver a la pestaña no puede mover el número (memoria caliente), y sigue coincidiendo
  await abrirTab('Productos');
  await abrirTab('Modelos');
  const telefonosOtraVez = await kpi('TELÉFONOS');
  check('Modelos: volver a la pestaña da el MISMO número y sigue coincidiendo con la base',
    telefonosOtraVez === telefonosAntes && telefonosOtraVez === contar('phones'),
    `${telefonosAntes} -> ${telefonosOtraVez} (base=${contar('phones')})`);

  // --- ESCRITURA REAL: la memoria tiene que enterarse ---
  nuevoId = await invocar('add_product', {
    name: 'ZZ Prueba Rapida F41', categoryId: 1, brand: 'Prueba', model: 'ZZ1', variant: '',
    compatibility: '["Prueba ZZ1"]', priceCost: 1, priceSale: 2, stock: 1, minStock: 0, priceUsd: 0,
  });
  check('se pudo escribir una ficha de prueba', Number(nuevoId) > 0, `id=${nuevoId}`);

  await clickCenter(SIDEBAR('Dashboard'));
  await abrirModulo();
  await abrirTab('Productos');
  const productosDespues = await kpi('PRODUCTOS');
  check('Productos: el alta se ve en los KPIs (la memoria se invalidó)',
    productosDespues === productosAntes + 1 && productosDespues === contar('products'),
    `${productosAntes} -> ${productosDespues} (base=${contar('products')})`);

  await abrirTab('Modelos');
  const telefonosDespues = await kpi('TELÉFONOS');
  // OJO: el padrón es idempotente por CLAVE de teléfono (INSERT OR IGNORE), así que si una corrida
  // anterior ya dejó la ficha «Prueba ZZ1» la fila NO se duplica: lo que se exige es que la
  // pantalla diga lo mismo que la base (que es lo que la memoria podría romper), no un +1.
  check('Modelos: el padrón de la pantalla coincide con la base tras el alta',
    telefonosDespues === contar('phones') && telefonosDespues >= telefonosAntes,
    `${telefonosAntes} -> ${telefonosDespues} (base=${contar('phones')})`);
} finally {
  // LIMPIEZA: la ficha de prueba se borra SIEMPRE (aunque un chequeo haya fallado antes).
  if (nuevoId) {
    const borrado = await invocar('delete_product', { id: Number(nuevoId) }).then(() => true).catch(() => false);
    if (!borrado) console.log('AVISO: no se pudo borrar la ficha de prueba (id=' + nuevoId + ')');
  }
}

// --- después de borrar: los números vuelven a la verdad de la base ---
await clickCenter(SIDEBAR('Dashboard'));
await abrirModulo();
await abrirTab('Productos');
const productosFinal = await kpi('PRODUCTOS');
check('Productos: al borrar la ficha el número vuelve al de la base',
  productosFinal === contar('products'), `pantalla=${productosFinal} base=${contar('products')}`);
await abrirTab('Modelos');
const telefonosFinal = await kpi('TELÉFONOS');
check('Modelos: el padrón coincide con la base (no quedó un número viejo)',
  telefonosFinal === contar('phones'), `pantalla=${telefonosFinal} base=${contar('phones')}`);

// La ficha de prueba deja su teléfono en el padrón: `delete_product` NO reconstruye `phones`
// (comportamiento viejo del padrón, no de esta feature). Se avisa para que se vea, no se esconde.
const restos = contar('phones') - 1136;
if (restos > 0) console.log(`NOTA: el padrón de esta copia tiene ${restos} ficha(s) de teléfono de productos borrados (el rebuild del padrón no las limpia: hallazgo aparte, no de esta feature)`);

// --- el buscador de repuestos sigue respondiendo con datos ---
await abrirTab('Repuesto por modelo');
await waitFor(`!!document.querySelector('input[placeholder^="Ej: Redmi"]')`);
await evalx(`(() => {
  const el = document.querySelector('input[placeholder^="Ej: Redmi"]');
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'Redmi Note 11');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const hayOpciones = await waitFor(`document.querySelectorAll('div.max-h-72 button').length > 0`, 12000);
const opciones = await evalx(`document.querySelectorAll('div.max-h-72 button').length`);
check('Repuesto por modelo: el buscador ofrece modelos del padrón', hayOpciones && opciones > 0, `${opciones} sugerencias`);
if (hayOpciones) {
  await clickCenter(`document.querySelector('div.max-h-72 button')`);
  const hayTabla = await waitFor(
    `document.querySelectorAll('table tbody tr').length > 0 && /repuestos compatibles/.test(document.body.innerText)`, 12000);
  const filas = await evalx(`document.querySelectorAll('table tbody tr').length`);
  check('Repuesto por modelo: aparecen los repuestos compatibles', hayTabla && filas > 0, `filas=${filas}`);
}

const fallos = results.filter(r => !r.ok);
console.log(`\n${results.length - fallos.length}/${results.length} ${fallos.length ? 'CON FALLOS' : 'OK'}`);
process.exit(fallos.length ? 1 : 0);
