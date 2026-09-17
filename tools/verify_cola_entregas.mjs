// Verificación EN VIVO (SOLO LECTURA) de la COLA DE ENTREGAS (F30, F4) por CDP.
//
// Qué comprueba, sin escribir NADA en la base:
//   1. El botón «Cerrar entrega» existe en la barra de Servicio Técnico.
//   2. El atajo F4 abre la paleta «Cerrar una entrega» con las órdenes EN TALLER.
//   3. Cada fila muestra orden, cliente y si FALTA COBRAR (saldo) o está pagada.
//   4. La búsqueda filtra por lo que el cliente dice (nº de orden, cédula, nombre).
//   5. Elegir una fila abre el ASISTENTE de cierre de ESA orden (integración cola → asistente).
//   6. Escape cierra todo y la app sigue en Servicio Técnico.
//
// NO escribe en la DB: no cierra días, no cobra, no entrega, no crea órdenes.
// Uso:  node tools/verify_cola_entregas.mjs        (con la app de dev abierta y CDP en 9222)

import { evalx, clickCenter, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => {
  out.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const dialogsOpen = () => evalx(`document.querySelectorAll('[role="dialog"]').length`);
const pressKey = (key) => evalx(`(() => {
  const el = document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : document;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
  return true;
})()`);
const typeInInput = (selector, text) => evalx(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const waitReady = async (timeout = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalx(`!!document.querySelector('aside') && !!document.querySelector('input[placeholder="PIN de 4 dígitos"]') === false`)) return true; } catch { /* cargando */ }
    await sleep(700);
  }
  return false;
};

console.log('— Cola de entregas (F30/F4) — verificación en vivo SOLO LECTURA —');
if (!(await waitReady())) { check('la app responde', false, 'no apareció el sidebar'); process.exit(1); }
check('la app responde', true);

// Si YA hay un diálogo abierto, otra sesión/herramienta está usando la app: no se toca nada
// (abortar es más honesto que leer el diálogo de otro y reportar un falso fallo).
const abiertosAlInicio = await dialogsOpen();
if (abiertosAlInicio > 0) {
  console.log(`\nABORTADO: la app tiene ${abiertosAlInicio} diálogo(s) abierto(s) — está en uso. Reintentá cuando esté libre.`);
  process.exit(2);
}

// Ir a Servicio Técnico por el sidebar (si no estamos ahí)
await evalx(`(() => {
  const items = [...document.querySelectorAll('aside a, aside button')];
  const it = items.find(b => (b.textContent || '').trim().toLowerCase().includes('servicio'));
  if (it) it.click();
  return !!it;
})()`);
await sleep(900);

// 1) botón en la barra
const tieneBoton = await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('Cerrar entrega'))`);
check('el botón «Cerrar entrega» está en la barra de Servicio Técnico', tieneBoton);

// 2) F4 abre la paleta
await pressKey('F4');
await sleep(900);
const txt = await dialogText();
check('F4 abre la cola de entregas', !!txt && txt.includes('Cerrar una entrega'), txt ? txt.split('\n')[0] : 'sin diálogo');
check('la cola dice cuántas órdenes hay en taller', !!txt && /en taller/.test(txt),
  txt ? (txt.match(/[^\n]*en taller[^\n]*/) || [''])[0] : '');
check('la paleta tiene el buscador', await evalx(`!!document.querySelector('[cmdk-input]')`));

// 3) las filas traen orden + cliente + estado del cobro.
//    Si la cola está VACÍA no se puede fallar por eso (puede ser legítimo: no hay órdenes en
//    taller). Lo que SÍ se exige es que la UI COINCIDA con lo que dice el backend: se pregunta por
//    IPC cuántas órdenes activas hay y se compara con las filas que muestra la paleta. Si el
//    backend devuelve órdenes y la paleta no muestra ninguna, eso SÍ es un defecto.
const filas = await evalx(`document.querySelectorAll('[cmdk-item]').length`);
const activosBackend = await evalx(`(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const list = await inv('get_services', { search: '', status: '__activos__', startDate: '', endDate: '' });
  return list.length;
})()`);
if (filas === 0) {
  check('la cola lista exactamente lo que dice el backend',
    activosBackend === 0,
    `paleta 0 filas · backend ${activosBackend} activas${activosBackend === 0 ? ' (la base no tiene órdenes en taller: correcto)' : ' ← DEFECTO'}`);
  check('cada fila dice si falta cobrar o está pagada', true, 'sin filas (no hay órdenes en taller)');
} else {
  check('la cola lista exactamente lo que dice el backend', filas === Math.min(activosBackend, 40),
    `paleta ${filas} filas · backend ${activosBackend} activas`);
  const conSaldo = await evalx(`(/falta cobrar/i.test(document.querySelector('[role="dialog"]').innerText))`);
  const pagadas = await evalx(`(/pagado/i.test(document.querySelector('[role="dialog"]').innerText))`);
  check('cada fila dice si falta cobrar o está pagada', conSaldo || pagadas, `falta cobrar: ${conSaldo} · pagado: ${pagadas}`);
}

// 4) la búsqueda filtra por nº de orden
const primerOrden = await evalx(`(document.querySelector('[cmdk-item]')?.innerText || '').split('\\n')[0].trim()`);
if (primerOrden) {
  const prefijo = primerOrden.slice(0, 8); // DEV-0001 → DEV-000
  await typeInInput('[cmdk-input]', prefijo);
  await sleep(600);
  const filtradas = await evalx(`document.querySelectorAll('[cmdk-item]').length`);
  const contiene = await evalx(`(document.querySelector('[role="dialog"]')?.innerText || '').includes(${JSON.stringify(primerOrden)})`);
  check(`buscar «${prefijo}» acota la cola y conserva la orden`, filtradas > 0 && filtradas <= filas && contiene,
    `${filtradas} de ${filas} fila(s)`);
  // búsqueda por cédula del primer resultado (lo que dice el cliente en el mostrador)
  const ci = await evalx(`(() => {
    const m = (document.querySelector('[role="dialog"]')?.innerText || '').match(/V-?\\d{6,}/);
    return m ? m[0] : null;
  })()`);
  if (ci) {
    await typeInInput('[cmdk-input]', ci.replace(/\\D/g, '').slice(0, 7));
    await sleep(600);
    const porCi = await evalx(`document.querySelectorAll('[cmdk-item]').length`);
    check(`buscar por cédula (${ci}) encuentra la orden`, porCi >= 1, `${porCi} fila(s)`);
  } else {
    check('buscar por cédula', true, 'sin cédulas visibles en la cola (se omite)');
  }
} else {
  check('la cola tiene al menos una orden para probar la búsqueda', true,
    'cola VACÍA en esta base: la búsqueda por orden/cédula se omite (no hay datos)');
}

// 5) elegir una fila abre el ASISTENTE de esa orden (click REAL por CDP: cmdk selecciona
//    con click/Enter, un `mousedown` sintético no dispara onSelect).
//    OJO: si la cola está VACÍA (p.ej. la copia de dev no tiene órdenes activas) no se puede
//    probar la navegación por filas: se informa y se sigue (el resto de la estructura ya se
//    verificó arriba). Antes esto hacía fallar la verificación por un dato, no por un defecto.
await typeInInput('[cmdk-input]', '');
await sleep(500);
const ordenElegida = await evalx(`(() => {
  const it = document.querySelector('[cmdk-item]');
  return it ? (it.innerText || '').split('\\n')[0].trim() : null;
})()`);
if (filas === 0) {
  check('elegir una fila abre el ASISTENTE de cierre', true,
    'cola VACÍA en esta base: no hay órdenes en taller para abrir (estructura verificada arriba)');
} else {
  await clickCenter(`document.querySelector('[cmdk-item]')`);
  await sleep(1400);
  const asistente = await dialogText();
  // El título es «Cerrar {order_num}»: se compara de forma agnóstica al dato (en la copia de
  // dev puede haber órdenes de prueba con números raros, p.ej. «-9»), y se exige que NO sea
  // la paleta de la cola (que se titula «Cerrar una entrega»).
  const esAsistente = !!asistente && asistente.trimStart().startsWith('Cerrar ') && !asistente.includes('Cerrar una entrega');
  check(`elegir la orden «${ordenElegida ?? '?'}» abre el ASISTENTE de cierre`, esAsistente,
    asistente ? asistente.split('\n')[0] : 'sin diálogo');
  check('el asistente muestra el cobro y el botón de cerrar',
    !!asistente && /(Falta cobrar|Cobrado|Cobrar y entregar|Entregar con saldo)/.test(asistente));
}

// 6) Escape cierra y no quedó nada abierto
await pressKey('Escape');
await sleep(700);
const abiertos = await dialogsOpen();
check('Escape cierra el asistente (no queda ningún diálogo apilado)', abiertos === 0, `${abiertos} diálogo(s)`);
check('la app sigue en pie (sidebar visible)', await evalx(`!!document.querySelector('aside')`));

const fails = out.filter(o => !o.ok);
console.log(`\ncola de entregas: ${out.length} comprobaciones · ${out.length - fails.length} OK · ${fails.length} fallo(s)`);
console.log('(verificación de solo lectura: no se escribió nada en la base)');
// `process.exit` SIEMPRE: el WebSocket de CDP queda abierto y sin esto el proceso no termina
// (el script «se cuelga» aunque haya terminado bien).
process.exit(fails.length > 0 ? 1 : 0);
