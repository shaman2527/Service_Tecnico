// VERIFICACIÓN EN VIVO (CDP) de las features F85/F86 — EL INVENTARIO SIN SCROLL LATERAL.
//
// Pedido del dueño (2026-10-04): «necesito que responsive se vea todo la parte de inventario… no
// quiero que tenga que scrollear a los lados para poder visualizar todo de frente, sea más
// profesional y bonita» (y, de la casilla de estado: «que sea más profesional»).
//
// Qué comprueba sobre la app REAL, cambiando el ANCHO DE LA VENTANA de verdad:
//   1. A 1200 (la ventana con la que arranca la app), 1366 y 1920: la tabla NO saca barra
//      horizontal (el ancho de la tabla = el ancho de su caja) y los 11 rótulos de columna se leen
//      enteros (ninguno se corta).
//   2. Debajo de 1024 px la MISMA tabla se APILA (una ficha por repuesto, cada celda con su
//      rótulo) y tampoco saca barra horizontal.
//   3. Los CONTRATOS de las otras verificaciones siguen en pie: `td[2]` es la categoría,
//      `[data-variant]` está dentro de la fila con la variante EXACTA, los 10 encabezados
//      ordenables existen y el «en uso» es un `role="switch"` con `aria-checked` y sus
//      `data-in-use`/`data-in-use-state` (lo que leen verify_uso_modelos y verify_por_modelo).
//
// SEGURIDAD DE DATOS: no escribe nada (solo mira el DOM y cambia el tamaño de la ventana).
//
// Uso:  app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_inventario_responsive.mjs

import { evalx, clickCenter, keyNav, sleep, setViewport, resetViewport } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 1) entrar al Inventario → Productos ─────────────────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Productos')`);
const hayFilas = await waitFor(`document.querySelectorAll('table tbody tr').length > 0`, 20000);
check('la tabla del inventario está en pantalla', hayFilas,
  `filas=${await evalx(`document.querySelectorAll('table tbody tr').length`)}`);

// Sin fichas no hay nada que medir: la fila del estado vacío también es un `tr`, y sin esta guarda
// las comprobaciones de abajo fallarían culpando a la tabla (medido al correr esto en modo
// navegador, donde el mock del catálogo viene vacío: 7 FAIL que en realidad eran «no hay datos»).
if (!(await evalx(`document.querySelectorAll('[data-in-use]').length > 0`))) {
  console.error('\nABORTADO: el inventario no tiene NINGUNA ficha cargada.');
  console.error('Esta verificación mide la tabla con filas: corré la app con su base (o cargá fichas) y repetí.');
  process.exit(2);
}

/** Todo lo que se mide de la tabla, en una sola expresión (para no mirar el DOM a medias). */
const MEDIR = `(() => {
  const tabla = document.querySelector('table');
  if (!tabla) return null;
  const wrap = tabla.parentElement;
  const ths = [...tabla.querySelectorAll('thead th')];
  const rotulos = ths.map(th => {
    const s = th.querySelector('span.truncate') || th;
    return { texto: (s.textContent || '').trim(), corta: s.scrollWidth > s.getBoundingClientRect().width + 1 };
  });
  const filas = [...tabla.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td'));
  const primera = filas[0];
  return {
    anchoCaja: wrap.clientWidth,
    anchoTabla: tabla.scrollWidth,
    desborde: tabla.scrollWidth - wrap.clientWidth,
    display: getComputedStyle(tabla).display,
    layout: getComputedStyle(tabla).tableLayout,
    thVisibles: ths.filter(th => th.getBoundingClientRect().width > 0).length,
    rotulos: rotulos.map(r => r.texto),
    rotulosCortados: rotulos.filter(r => r.corta).map(r => r.texto),
    celdasCortadas: [...tabla.querySelectorAll('td')].filter(c => c.scrollWidth - c.clientWidth > 1).length,
    tds: primera ? [...primera.querySelectorAll('td')].map(td => (td.innerText || '').replace(/\\s+/g, ' ').trim()) : [],
    etiquetasApiladas: primera ? [...primera.querySelectorAll('td')].map(td => ((td.innerText || '').split('\\n')[0] || '').trim()) : [],
    variante: primera ? (primera.querySelector('[data-variant]')?.innerText || '').trim() : null,
    varianteEnCelda: primera ? !!primera.querySelector('td [data-variant]') : false,
    categoriaEnTercera: primera ? (primera.querySelectorAll('td')[2]?.innerText || '').trim() : null,
    categoriaConRotulo: primera ? primera.querySelectorAll('td')[2]?.hasAttribute('data-label') : null,
    switches: document.querySelectorAll('[role="switch"]').length,
    switchesConEstado: [...document.querySelectorAll('[data-in-use]')].filter(b =>
      b.getAttribute('role') === 'switch' && /^(true|false)$/.test(b.getAttribute('aria-checked') || '')
      && /^[01]$/.test(b.getAttribute('data-in-use-state') || '')).length,
    sortHeads: [...document.querySelectorAll('[data-sort]')].map(b => b.getAttribute('data-sort')),
    cabecerasConAria: ths.filter(th => ['ascending', 'descending', 'none'].includes(th.getAttribute('aria-sort') || '')).length,
    altoFila: primera ? Math.round(primera.getBoundingClientRect().height) : 0,
  };
})()`;

const ROTULOS = ['Producto', 'En uso', 'Categoría', 'Marca', 'Modelo', 'Variante', 'Modelos compatibles', 'Precio', 'Costo', 'Stock', 'Mín'];
const ORDENABLES = ['nombre', 'uso', 'categoria', 'marca', 'modelo', 'variante', 'precio', 'costo', 'stock', 'minimo'];
/** La sesión de CAJA no ve la columna «Costo» (F68): la verificación vale en las dos. */
const esperadas = (m) => (m.rotulos.includes('Costo') ? ROTULOS : ROTULOS.filter(r => r !== 'Costo'));
const ordenablesEsperados = (m) => (m.rotulos.includes('Costo') ? ORDENABLES : ORDENABLES.filter(c => c !== 'costo'));

// ── 2) ANCHA: el pedido del dueño es «todo de frente, sin moverse a los lados» ──────────────
let primeraAncha = null;
for (const [ancho, alto, etiqueta] of [[1200, 750, 'la ventana con la que arranca la app'], [1366, 768, 'una laptop'], [1920, 1080, 'maximizada']]) {
  await setViewport(ancho, alto);
  const m = await evalx(MEDIR);
  if (!m) { check(`a ${ancho} px la tabla del inventario está`, false, 'no hay tabla'); continue; }
  if (ancho === 1200) primeraAncha = m;
  const cols = esperadas(m);
  check(`a ${ancho} px (${etiqueta}) la tabla NO saca barra horizontal`, m.desborde <= 1,
    `caja=${m.anchoCaja} · tabla=${m.anchoTabla} · desborde=${m.desborde}`);
  // +1: la última columna (las dos acciones en icono) no lleva rótulo.
  check(`a ${ancho} px los rótulos de columna se leen enteros`, m.rotulosCortados.length === 0 && m.thVisibles === cols.length + 1,
    `visibles=${m.thVisibles} (esperadas ${cols.length + 1}) · cortados=${m.rotulosCortados.join(', ') || 'ninguno'}`);
  check(`a ${ancho} px están todas las columnas del pedido`, cols.every(r => m.rotulos.includes(r)), m.rotulos.filter(Boolean).join(' | '));
}

// ── 3) los contratos que leen las OTRAS verificaciones ──────────────────────────────────────
// El de `[data-variant]` NO se mide sobre la PRIMERA fila: con datos reales puede ser una ficha SIN
// variante (que se pinta «—») y la comprobación fallaría sin que nada esté mal (medido 2026-10-04).
// La propiedad que importa es la que usa `verify_por_modelo`: el elemento que lleva el atributo
// tiene en su TEXTO la variante y nada más (sin el rótulo de la vista apilada).
const variante = await evalx(`(() => {
  const els = [...document.querySelectorAll('[data-variant]')].slice(0, 20);
  if (!els.length) return { hay: false, malos: [] };
  const malos = els.map(e => ({ esperado: e.getAttribute('data-variant'), texto: (e.innerText || '').trim() }))
    .filter(x => (x.esperado ? !x.texto.includes(x.esperado) : x.texto !== '—'));
  return { hay: true, total: els.length, malos };
})()`);

if (primeraAncha) {
  const m = primeraAncha;
  check('la 3ª celda sigue siendo la CATEGORÍA (verify_inventory_load lee td[2])',
    !!m.categoriaEnTercera && !/^\d/.test(m.categoriaEnTercera), `td[2]=«${m.categoriaEnTercera}»`);
  check('en la tabla normal la celda NO agrega rótulos al texto (td.innerText limpio)',
    m.categoriaConRotulo === false, `data-label=${m.categoriaConRotulo}`);
  check('[data-variant] lleva la variante EXACTA en su propio texto (verify_por_modelo lo compara)',
    variante.hay && variante.malos.length === 0, JSON.stringify(variante));
  check('el «en uso» es un interruptor con rol, aria-checked y su estado (verify_uso_modelos)',
    m.switches > 0 && m.switchesConEstado === m.switches, `switches=${m.switches} · completos=${m.switchesConEstado}`);
  check('los encabezados ordenables siguen ahí (verify_orden_columnas)',
    ordenablesEsperados(m).every(c => m.sortHeads.includes(c)), m.sortHeads.join(', '));
  check('cada encabezado ordenable dice su estado con aria-sort (verify_orden_columnas)',
    m.cabecerasConAria >= ordenablesEsperados(m).length, `th con aria-sort=${m.cabecerasConAria}`);
  check('la tabla usa table-fixed: por eso no puede desbordar', m.layout === 'fixed', m.layout);
  console.log(`   a 1200 px: alto de fila ${m.altoFila} px · celdas con texto recortado ${m.celdasCortadas} (se leen enteras en el title)`);
  console.log(`   fila 1: ${m.tds.map((t, i) => `${ROTULOS[i] ?? '·'}="${t}"`).join(' | ')}`);
}

// ── 4) ANGOSTA (el mínimo de la app): la tabla se APILA ─────────────────────────────────────
await setViewport(900, 900);
const a = await evalx(MEDIR);
check('a 900 px la tabla se APILA (display block)', a?.display === 'block', String(a?.display));
check('a 900 px los encabezados se esconden', a?.thVisibles === 0, `th visibles=${a?.thVisibles}`);
check('a 900 px tampoco hay barra horizontal', (a?.desborde ?? 9) <= 1, `desborde=${a?.desborde}`);
const conRotulo = (a?.etiquetasApiladas ?? []).filter(t => /^(En uso|Categoría|Marca|Modelo|Variante|Modelos compatibles|Precio|Costo|Stock|Mín)$/.test(t));
check('a 900 px cada celda dice su rótulo (En uso, Categoría, Marca…)', conRotulo.length >= 10, conRotulo.join(', '));
check('a 900 px sigue habiendo un interruptor por fila', (a?.switches ?? 0) > 0 && a?.switchesConEstado === a?.switches,
  `switches=${a?.switches} · completos=${a?.switchesConEstado}`);
check('a 900 px la categoría sigue estando en la 3ª celda', /^Categoría/.test(String(a?.categoriaEnTercera)), `td[2]=«${a?.categoriaEnTercera}»`);
console.log(`   a 900 px: alto de ficha ${a?.altoFila} px (dos datos por renglón, cada uno con su rótulo)`);

// ── 5) VUELVE SOLA: el cambio tiene que ser EN VIVO, sin recargar ────────────────────────────
await setViewport(1200, 750);
const v = await evalx(MEDIR);
check('al ensanchar vuelve sola a la tabla normal (sin recargar)', v?.display === 'table' && v?.thVisibles === esperadas(v).length + 1,
  `${v?.display} · th=${v?.thVisibles}`);
check('y sigue sin barra horizontal', (v?.desborde ?? 9) <= 1, `desborde=${v?.desborde}`);

await resetViewport();

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
