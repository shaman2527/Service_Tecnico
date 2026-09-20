// MIDE EN VIVO lo que tarda el módulo Inventario en MOSTRAR DATOS, pestaña por pestaña.
//
// Es la medición que le importa al dueño («que sea rápida cuando entra inventario, cada
// pestaña/sección»): no cuánto tarda una consulta suelta, sino cuánto tarda el operario en
// ver la tabla con datos desde que hace clic.
//
// Requisitos:
//   1) la app RELEASE (producción, no dev) con la copia de trabajo:
//      $env:REGISTRO_DB="C:\Users\ROBER\registro\backup\perf_app.db"
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//      Start-Process .\Registro.exe
//   2) node tools/bench_inventory_ui.mjs
//
// Mide, por ronda (la 1ª se descarta: es el arranque en frío de la app):
//   entrada      → clic en «Inventario» del menú hasta ver la tabla de Productos con datos
//   productos    → clic en la pestaña Productos
//   modelos      → clic en la pestaña Modelos (la más cara: KPIs + lista del padrón)
//   modelo       → clic en «Repuesto por modelo» hasta ver el buscador
//   consulta     → escribir un modelo hasta ver las sugerencias del buscador
//   resultado    → elegir el modelo hasta ver la tabla de repuestos compatibles
//   movimientos  → clic en la pestaña Movimientos
//   ajustes      → clic en la pestaña Ajustes
//   volver       → clic en Productos OTRA VEZ en la misma sesión (2ª visita)
// Cada ronda SALE del módulo (Dashboard) antes de volver a entrar, para que la visita sea
// «en frío» como la del operario que llega al inventario desde otra pantalla.
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 4);
const TIMEOUT_FRAMES = 900; // ~15 s a 60 fps

const SIDEBAR = (name) => `[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith(${JSON.stringify(name)}))`;
const TAB = (name) => `[...document.querySelectorAll('[role="tab"]')].find(b => b.innerText.trim().startsWith(${JSON.stringify(name)}))`;

// «listo» = ya hay datos de verdad: filas en la tabla, sin esqueletos de carga y con la
// franja de números pintada. Si sólo se mira «hay filas», una tabla vieja da un falso rápido.
// OJO con las mayúsculas: `innerText` devuelve el texto RENDERIZADO y los rótulos de los KPI
// llevan `text-transform: uppercase`, así que se compara todo en minúsculas.
const READY = {
  productos: `(() => {
    const t = document.body.innerText.toLowerCase();
    const rows = document.querySelectorAll('table tbody tr').length;
    const busy = document.querySelectorAll('table tbody [class*="animate-pulse"]').length + document.querySelectorAll('[data-refreshing]').length;
    return rows > 0 && busy === 0 && t.includes('capital a costo');
  })()`,
  modelos: `(() => {
    const t = document.body.innerText.toLowerCase();
    const rows = document.querySelectorAll('table tbody tr').length;
    const busy = document.querySelectorAll('table tbody [class*="animate-pulse"]').length + document.querySelectorAll('[data-refreshing]').length;
    return rows > 0 && busy === 0 && t.includes('por revisar');
  })()`,
  movimientos: `(() => {
    const t = document.body.innerText.toLowerCase();
    const busy = document.querySelectorAll('table tbody [class*="animate-pulse"]').length + document.querySelectorAll('[data-refreshing]').length;
    const done = /mostrando \\d+–\\d+ de \\d+|sin resultados|\\d+ movimientos/.test(t);
    return busy === 0 && done;
  })()`,
  buscador: `document.body.innerText.toLowerCase().includes('buscar repuesto por modelo de teléfono')`,
  sugerencias: `document.querySelectorAll('div.max-h-72 button').length > 0`,
  compatibles: `(() => {
    const t = document.body.innerText.toLowerCase();
    const busy = document.querySelectorAll('table tbody [class*="animate-pulse"]').length + document.querySelectorAll('[data-refreshing]').length;
    const rows = document.querySelectorAll('table tbody tr').length;
    return rows > 0 && busy === 0 && /repuestos compatibles/.test(t);
  })()`,
  ajustes: `document.body.innerText.toLowerCase().includes('precios de costo y venta')`,
};

/** Hace clic y espera a que el contenido CAMBIE y cumpla la condición de «listo». */
const measure = async (clickExpr, readyExpr) => {
  const r = await evalx(`(async () => {
    // Firma del texto de la pantalla: los primeros 300 caracteres son el menú y el título del
    // módulo (IGUALES en todas las pestañas), así que hay que mirar TODO el texto para saber
    // que la pestaña cambió de verdad.
    const sig = () => { const t = document.body.innerText; let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h + ':' + t.length; };
    const before = sig();
    const el = ${clickExpr};
    if (!el) return { err: 'no se encontró el objetivo del clic' };
    const t0 = performance.now();
    el.click();
    const ready = () => (${readyExpr});
    for (let i = 0; i < ${TIMEOUT_FRAMES}; i++) {
      if (ready() && sig() !== before) {
        return { ms: performance.now() - t0 };
      }
      await new Promise(res => requestAnimationFrame(res));
    }
    return { err: 'no llegaron los datos (timeout)' };
  })()`);
  if (!r || r.err) throw new Error(r?.err ?? 'eval sin resultado');
  return r.ms;
};

/** Escribe un texto en un input de React como lo haría el operario (setter nativo). */
const typeInto = (sel, text) => evalx(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const samples = {};
const add = (k, v) => { (samples[k] ??= []).push(v); console.log(`   ${k.padEnd(12)} ${v.toFixed(0)} ms`); };

const inInventory = () => evalx(`document.body.innerText.includes('Catálogo, compatibilidad por teléfono')`);

// --- arranque: la SPA siempre empieza pidiendo el PIN (sesión de DUEÑO, PIN de la copia dev:
// 1234). Sin esto el menú no tiene «Inventario» y la medición no arranca.
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 20; i++) {
  try {
    if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) break;
  } catch { /* recargando */ }
  await sleep(700);
}
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
if (!(await evalx(`!!${SIDEBAR('Inventario')}`))) {
  console.error('No hay «Inventario» en el menú: ¿la sesión quedó como cajera en vez de dueño?');
  process.exit(1);
}

console.log(`Midiendo el Inventario en vivo · ${ROUNDS} rondas (se descarta la 1ª)\n`);

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`— ronda ${round}`);
  // Se SALE del módulo para que la entrada sea en frío (como el operario que llega desde otra pantalla)
  await evalx(`(() => { const b = ${SIDEBAR('Dashboard')}; if (b) b.click(); return true; })()`);
  await sleep(900);

  add('entrada', await measure(SIDEBAR('Inventario'), READY.productos));
  add('modelos', await measure(TAB('Modelos'), READY.modelos));
  add('modelo', await measure(TAB('Repuesto por modelo'), READY.buscador));
  // El buscador de modelo: escribir → sugerencias (consulta el padrón) → elegir → repuestos
  await typeInto('input[placeholder^="Ej: Redmi"]', 'Redmi Note 11');
  add('consulta', await measure(`document.querySelector('input[placeholder^="Ej: Redmi"]')`, READY.sugerencias));
  add('resultado', await measure(`document.querySelector('div.max-h-72 button')`, READY.compatibles));
  add('movimientos', await measure(TAB('Movimientos'), READY.movimientos));
  add('ajustes', await measure(TAB('Ajustes'), READY.ajustes));
  // 2ª visita a Productos EN LA MISMA sesión (con el módulo ya abierto)
  add('volver', await measure(TAB('Productos'), READY.productos));

  if (!(await inInventory())) console.log('   (aviso: no se reconoció el módulo Inventario)');
}

console.log('\n================ MEDIANAS (sin la 1ª ronda) ================');
const out = {};
for (const [k, xs] of Object.entries(samples)) {
  const use = xs.length > 1 ? xs.slice(1) : xs;
  out[k] = Math.round(median(use));
  console.log(`${k.padEnd(12)} ${String(out[k]).padStart(6)} ms   (${use.map(v => Math.round(v)).join(', ')})`);
}
console.log(`\nMEDIANAS_JSON ${JSON.stringify(out)}`);
process.exit(0);
