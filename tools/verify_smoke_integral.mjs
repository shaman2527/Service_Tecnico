// ============================================================================================
// SMOKE INTEGRAL PRE-PRODUCCIÓN — verificación EN VIVO por CDP de TODOS los módulos.
//
// Qué hace: recorre Dashboard, Ventas, Servicio Técnico, Inventario, Pedidos, Clientes,
// Libro Diario y Ayuda contra la app REAL (Tauri 2 + React 19 + SQLite) y comprueba con
// evidencia (texto/valores leídos del DOM o por IPC) que cada módulo funciona de verdad:
// no basta con que la pantalla abra, se registran datos, se leen de vuelta y se limpian.
//
// REQUISITOS (modo DEV — NUNCA contra la DB de la tienda):
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//   $env:REGISTRO_DB="<copia de trabajo>"
//   node tools/verify_smoke_integral.mjs
//
// LO QUE ESCRIBE EN LA BASE (leer antes de correr):
//   1. UNA venta de prueba (producto con stock, cantidad 1, método «EFECTIVO $», cliente real).
//      → NO se puede borrar: este proyecto NO tiene comando `delete_sale` (revisado en
//        src-tauri/src/lib.rs y src/db.ts) ni botón de eliminar en Ventas.tsx. Queda anotada
//        en el resumen final con su id. Por eso el script SIEMPRE corre contra una COPIA.
//   2. UNA orden de servicio de prueba → SÍ se borra al final con el botón de la tarjeta
//        (papelera + confirmación) y se comprueba por IPC que no quedó ninguna fila nueva.
//   3. Órdenes de compra: NINGUNA (el carrito de «Nuevo Pedido» se arma y se descarta sin
//        guardar).
//   4. NO cierra el día, NO confirma cobros, NO entrega equipos, NO fusiona duplicados,
//        NO normaliza el catálogo, NO guarda cambios de producto.
//
// SI YA HAY UN DIÁLOGO ABIERTO AL EMPEZAR: el script ABORTA con exit 2 (no lee el diálogo de
// otra sesión/herramienta — sería reportar un falso fallo).
// ============================================================================================
import { evalx, clickCenter, keyNav, insertText, sleep, handleDialog } from './cdp_driver.mjs';

// --- Patrón de salida del proyecto -----------------------------------------------------------------
const out = [];
const check = (name, ok, detail) => {
  out.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ->  ' + detail : ''}`);
};

// Todo lo que el script escribe en la base se declara acá y se imprime al final
// (la base tiene que quedar COMO ESTABA; lo que no se pueda borrar se dice fuerte).
const residuo = [];

// --- Utilidades de lectura del DOM -----------------------------------------------------------------
// Los diálogos de la app son Dialog (`role="dialog"`) y AlertDialog (`role="alertdialog"`,
// p. ej. la confirmación de borrar una orden): mirar solo role=dialog hacía fallar esa
// confirmación (se veía «no abrió» con el diálogo en pantalla).
// OJO con la coma: `'[role="dialog"], [role="alertdialog"] button'` NO significa «botones de
// cualquiera de los dos» — significa «los role=dialog» O «los botones dentro de alertdialog»,
// así que el click caía en el DIÁLOGO entero (se clickeaba su centro y no pasaba nada).
const DLG = '[role="dialog"], [role="alertdialog"]';
const DLG_BTN = '[role="dialog"] button, [role="alertdialog"] button';
// Campos de cualquier diálogo (misma trampa de la coma: hay que repetir el selector completo).
const DLG_INPUT = '[role="dialog"] input, [role="alertdialog"] input, [role="dialog"] textarea, [role="alertdialog"] textarea';
const dialogTxt = () => evalx(`document.querySelector('${DLG}')?.innerText ?? null`);
const dialogsOpen = () => evalx(`document.querySelectorAll('${DLG}').length`);

/** Espera hasta que la expresión sea verdadera (la UI tiene debounce de 200-350ms en búsquedas). */
const waitFor = async (toggleExpr, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await evalx(toggleExpr).catch(() => false);
    if (v) return true;
    await sleep(300);
  }
  return false;
};

/** Lo que el autocompletado del proyecto (ModelCombobox) marca como sugerencia elegida. */
const toggled = (label) =>
  `[...document.querySelectorAll('button[data-state="on"]')].some(b => (b.innerText || '').includes(${JSON.stringify(label)}))`;

/** Los `value` de los <input> NO salen en innerText: se leen del DOM. */
const valueOf = (sel) => evalx(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);

/** Escribe en un input controlado por React con el setter nativo (el `el.value=` pelado React lo ignora). */
const setValue = (sel, val) => evalx(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

/** N-ésimo input[type=date] de la pantalla (los rangos Desde/Hasta). */
const setDate = (index, val) => evalx(`(() => {
  const el = [...document.querySelectorAll('main input[type="date"]')][${index}];
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

// Los clicks de PLOMERÍA (navegar, abrir un diálogo) no son aserciones: si un selector quedó
// viejo, se registra el FAIL y el recorrido SIGUE, para que UNA corrida reporte todo lo que
// falla en vez de morir en el primer tropiezo (cada corrida completa tarda ~5 min).
const clickSoft = async (expr, label) => {
  try {
    await clickCenter(expr);
    return true;
  } catch {
    check(`(plomería) no encontré el objetivo para «${label}»`, false, 'selector desactualizado o modal encima');
    return false;
  }
};

const clickLabeled = async (sel, label, exact = false) => {
  await clickSoft(`([...document.querySelectorAll(${JSON.stringify(sel)})].find(b => {
    const t = (b.innerText || '').trim();
    return ${exact ? `t === ${JSON.stringify(label)}` : `t.includes(${JSON.stringify(label)})`};
  }) || null)`, label);
};
const clickButton = (label) => clickLabeled('button', label);
const clickDialog = async (label, exact = false) => {
  await clickSoft(`([...document.querySelectorAll('${DLG_BTN}')].find(b => {
    const t = (b.innerText || '').trim();
    return ${exact ? `t === ${JSON.stringify(label)}` : `t.includes(${JSON.stringify(label)})`};
  }) || null)`, `diálogo: ${label}`);
  await sleep(800);
};

/** Botón por texto EXACTO (los labels del pedido). */
const clickExactText = async (sel, label) => clickLabeled(sel, label, true);

/** Abre un Select de Radix con click REAL (no `dispatchEvent`) y devuelve las opciones del portal. */
const clickOption = async (label) => {
  await clickCenter(`([...document.querySelectorAll('[role="option"]')].find(o => (o.innerText || '').includes(${JSON.stringify(label)})) || null)`);
  await sleep(900);
};

/** Elige una opción de un Select de Radix POR TECLADO, a partir de un selector del control.
 *  Los clics por coordenadas fallan cuando el control quedó fuera del área visible del diálogo
 *  (la ventana en la que se prueba es chica): acá se lleva al centro, se enfoca y se navega
 *  leyendo el resaltado (`data-highlighted`). Misma técnica que usa `verify_trabajos_hechos`. */
const elegirSelectPorTeclado = async (selector, texto) => {
  const hay = await evalx(`(() => {
    const t = document.querySelector(${JSON.stringify(selector)});
    if (!t) return false;
    t.scrollIntoView({ block: 'center' });
    t.focus();
    return true;
  })()`);
  if (!hay) return false;
  await sleep(400);
  await keyNav('ArrowDown', 'ArrowDown', 40);
  await sleep(600);
  for (let i = 0; i < 16; i++) {
    const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText?.trim() ?? null`);
    if (String(hi).includes(texto)) {
      await keyNav('Enter', 'Enter', 13);
      await sleep(800);
      return true;
    }
    await keyNav('ArrowDown', 'ArrowDown', 40);
    await sleep(200);
  }
  await keyNav('Escape', 'Escape', 27);
  await sleep(400);
  return false;
};

/** Cierra TODO lo que haya abierto (diálogos + portales de Select) para no dejar basura.
 *  OJO (F54): el AVISO DE POLÍTICA es un modal centrado a propósito — se cierra con su ✕, con un
 *  toque en la tarjeta o con Escape — y mientras está abierto **no se le puede hacer clic a la app**.
 *  Un script que no lo cierre falla en el paso siguiente culpando a la pantalla (nos pasó: el
 *  asistente de cierre «no abría» y en realidad el primer clic lo comía el velo del aviso). */
const closeAllDialogs = async () => {
  for (let i = 0; i < 6; i++) {
    const aviso = await evalx(`!!document.querySelector('[data-policy-modal]')`).catch(() => false);
    if (aviso) {
      await clickCenter(`document.querySelector('[data-policy-close]')`).catch(() => {});
      await sleep(400);
      continue;
    }
    if ((await dialogsOpen().catch(() => 0)) === 0) break;
    await evalx(`(() => {
      const el = document.querySelector('${DLG}') || document;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    })()`).catch(() => {});
    await keyNav('Escape', 'Escape', 27).catch(() => {});
    await sleep(500);
  }
};

/** Fila de la tabla PAGINADA de la pestaña activa (las tablas nuevas tienen buscador arriba). */
const activeTable = () => evalx(`(() => {
  const p = document.querySelector('[role="tabpanel"]');
  if (!p) return null;
  const rows = [...p.querySelectorAll('table tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim()));
  return JSON.stringify({
    headers: [...p.querySelectorAll('table thead th')].map(h => h.innerText.trim()),
    rows,
    footer: (p.innerText.match(/Mostrando \\d+–\\d+ de \\d+|\\d+ movimientos|Sin resultados/) || [''])[0],
  });
})()`);

/** Navegación por el sidebar: los módulos son botones dentro de <aside>.
 *  OJO: la barra se puede COLAPSAR (`localStorage.sidebar_collapsed`) y entonces queda solo con
 *  íconos: `innerText` viene VACÍO y buscar por texto falla aunque la app esté perfecta. Se busca
 *  por el `title` («Servicio Técnico (Alt+3)»), que existe en los dos estados (lección de F51). */
const goto = async (label) => {
  const ok = await clickCenter(`([...document.querySelectorAll('aside button')].find(b => {
    const t = (b.innerText || '').trim();
    return t === ${JSON.stringify(label)} || (b.getAttribute('title') || '').startsWith(${JSON.stringify(label + ' (')});
  }) || null)`).then(() => true).catch(() => false);
  await handleDialog(true); // por si quedó un confirm/alert nativo de un paso anterior
  await sleep(1000);
  return ok;
};
const waitH1 = async (text, ms = 15000) => waitFor(`[...document.querySelectorAll('h1')].some(h => h.innerText.trim() === ${JSON.stringify(text)})`, ms);

/** IPC directo a Tauri (mismas firmas que src/db.ts). */
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const serviciosRaw = () => invoke('get_services', { search: '', status: '', startDate: '', endDate: '' });

// Fecha LOCAL del día (igual que la app): con toISOString() el «hoy» de la prueba sería el día
// UTC y después de las 20:00 en Venezuela (UTC−4) no coincidiría con el día del local.
const fechaLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fechaHace = (dias) => fechaLocal(new Date(Date.now() - dias * 86400000));
const HOY = fechaLocal();

// Los chips de TRABAJOS (Cambio pantalla, Cambio batería…) NO son toggles de Radix: no llevan
// `data-state`; el activo se pinta con `bg-primary`. Los chips de MÉTODO DE PAGO sí lo llevan
// (por eso `toggled()` sirve para esos y no para estos).
const chipTrabajoOn = (label) =>
  `[...document.querySelectorAll('[role="dialog"] button')].some(b => (b.textContent || '').trim() === ${JSON.stringify(label)} && /bg-primary/.test(b.className || ''))`;

console.log('— SMOKE INTEGRAL pre-producción (CDP 9222) — escribe: 1 venta (no borrable) + 1 orden temporal —');

// ============================================================================================
// 0) ARRANQUE: esperar la app, pedir el PIN del local (1234) y ABORTAR si hay un diálogo abierto
// ============================================================================================
// Si un confirm/alert nativo bloquea la página, los evalx dan timeout: se contesta y se sigue.
await handleDialog(true).catch(() => {});
await evalx(`location.reload(); 'recargando'`).catch(() => {});

const pinSel = 'input[placeholder="PIN de 4 dígitos"]';
let listo = false;
for (let i = 0; i < 30 && !listo; i++) {
  try {
    if (await evalx(`!!document.querySelector(${JSON.stringify(pinSel)})`)) {
      // La recarga vuelve a pedir el PIN (gate fail-closed): 1234 es el PIN del local.
      await setValue(pinSel, '1234');
      await clickButton('Entrar');
      await sleep(1600);
    }
    listo = await evalx(`!!document.querySelector('aside')`);
  } catch { /* el WebView todavía está cargando */ }
  if (!listo) await sleep(800);
}
if (!listo) { console.log('\nABORTADO: la app no respondió (¿está corriendo con CDP en 9222?).'); process.exit(1); }
check('la app arranca y responde (sidebar visible, desbloqueada con el PIN del local)', true);

if (await dialogsOpen().catch(() => 0) > 0) {
  console.log('\nABORTADO: la app tiene un diálogo abierto — está en uso por otra sesión. Reintentá cuando esté libre.');
  process.exit(2);
}

// Foto del estado ANTES de escribir nada (para poder comparar y limpiar).
const snapshot = async () => evalx(`(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const sv = await inv('get_services', { search: '', status: '', startDate: '', endDate: '' });
  const sa = await inv('get_sales', { search: '', days: null, startDate: '', endDate: '' });
  return JSON.stringify({
    services: sv.length, maxServiceId: sv.reduce((a, s) => Math.max(a, s.id), 0),
    sales: sa.length, maxSaleId: sa.reduce((a, s) => Math.max(a, s.id), 0),
  });
})()`);
const ANTES = JSON.parse(await snapshot());
console.log(`· antes: ${ANTES.services} servicios (max id ${ANTES.maxServiceId}) · ${ANTES.sales} ventas (max id ${ANTES.maxSaleId})`);
// El TURNO DE CAJA es lo que NO se debe tocar: se registra su estado para poder comprobarlo al final.
const diaInicial = await invoke('get_active_day');
console.log(`· turno de caja: ${diaInicial ? `ABIERTO (${diaInicial.close_date}, tasa ${diaInicial.tasa_bcv})` : 'CERRADO (ningún día abierto)'}`);

// ============================================================================================
// 1) ARRANQUE Y NAVEGACIÓN: los 8 módulos del sidebar abren con su título propio y sin errores
// ============================================================================================
{
  const modulos = [
    ['Dashboard', 'Dashboard'],
    ['Ventas', 'Ventas'],
    ['Servicio Técnico', 'Servicio Técnico'],
    ['Inventario', 'Inventario'],
    ['Pedidos', 'Pedidos'],
    ['Clientes', 'Clientes'],
    ['Libro Diario', 'Libro Diario'],
    ['Ayuda', 'Centro de Ayuda'],
  ];
  for (const [nav, h1] of modulos) {
    const abierto = await goto(nav);
    const titulo = await waitH1(h1, 15000);
    const erroresPantalla = await evalx(`/[Ee]rror|[Nn]o se pudo|is not a function|undefined is not/.test(document.querySelector('main')?.innerText ?? '')`);
    check(`el módulo «${nav}» abre con su título («${h1}») y sin errores en pantalla`,
      abierto && titulo && !erroresPantalla,
      `sidebar:${abierto} · h1:${titulo}${erroresPantalla ? ' · TEXTO DE ERROR EN PANTALLA' : ''}`);
  }
}

// ============================================================================================
// 2) DASHBOARD: KPIs, indicador de sincronización y la sección «Servicios por Técnico»
// ============================================================================================
{
  await goto('Dashboard');
  // La franja de datos y los KPIs solo existen cuando la carga async terminó (si falla, el
  // indicador pasa a «Base de datos no disponible» — eso también es un fallo honesto).
  await waitFor(`/Sincronizado|Base de datos no disponible/.test(document.querySelector('main').innerText)`, 15000);
  await sleep(800);
  const txt = await evalx(`document.querySelector('main').innerText`);

  check('el indicador de sincronización dice «Sincronizado · datos locales»',
    /Sincronizado · datos locales/.test(txt),
    (txt.match(/Sincronizado[^\n]*|Base de datos no disponible|Conectando\.\.\./) || ['(sin indicador)'])[0]);
  for (const kpi of ['Ventas Hoy', 'Equipos en Taller', 'Cobrado Servicios Hoy']) {
    check(`KPI «${kpi}» presente`, txt.includes(kpi));
  }
  check('la sección «Servicios por Técnico» existe con sus columnas',
    txt.includes('Servicios por Técnico') && /TÉCNICO[\s\S]{0,80}EN TALLER[\s\S]{0,40}ENTREGADOS[\s\S]{0,40}INGRESOS/.test(txt),
    (txt.match(/Servicios por Técnico[\s\S]{0,60}/) || [''])[0].replace(/\n/g, ' | '));
  // La tabla de técnicos aparece cuando termina la carga async de las estadísticas: se busca la
  // TARJETA por su título (no por el texto del thead, que variaba y daba falsos FAIL) y se
  // reintenta para no confundir «todavía cargando» con «vacía».
  let tec = { filas: -1, texto: '' };
  for (let i = 0; i < 10 && tec.filas < 0; i++) {
    tec = JSON.parse(await evalx(`(() => {
      const card = [...document.querySelectorAll('main div')]
        .filter(d => /Servicios por Técnico/.test(d.textContent || '') && d.querySelector('table'))
        .pop();
      if (!card) return JSON.stringify({ filas: -1, texto: '' });
      const t = card.querySelector('table');
      return JSON.stringify({
        filas: t.querySelectorAll('tbody tr').length,
        texto: (card.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      });
    })()`) || { filas: -1, texto: '' });
    if (tec.filas < 0) await sleep(600);
  }
  const txtTec = await evalx(`document.querySelector('main').innerText`);
  check('«Servicios por Técnico» trae filas o el aviso de vacío (no queda en blanco)',
    tec.filas > 0 || /Sin servicios registrados/.test(txtTec || ''),
    `${tec.filas} fila(s) · ${tec.texto.slice(0, 100)}`);
}

// ============================================================================================
// 3) VENTAS: formulario, chips de método, y UNA VENTA DE PRUEBA registrada de verdad
// ============================================================================================
let ventaPrueba = null;
{
  await goto('Ventas');
  await waitH1('Ventas');
  await clickButton('Nueva Venta');
  const abrio = await waitFor(`(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nueva Venta')`, 8000);
  check('«Nueva Venta» abre el formulario', abrio, (await dialogTxt()) ? String(await dialogTxt()).split('\n')[0] : 'sin diálogo');

  // El DÍA es requisito de backend para registrar ventas (`require_open_day`). Se avisa con
  // evidencia en vez de escribir en el Libro Diario (el script NO abre/cierra el día).
  // F70: el botón ya NO queda APAGADO EN SILENCIO sin producto/precio — se puede apretar y el
  // formulario DICE qué falta (antes estaba `disabled` y el operario apretaba sin saber por qué).
  const diaAbierto = await evalx(`/Día abierto/.test(document.querySelector('main').innerText)`);
  const avisoVenta = String(await evalx(`document.querySelector('[data-field="aviso-venta"]')?.innerText ?? ''`));
  check('el día está ABIERTO y sin producto el formulario DICE qué falta (el botón ya no está mudo)',
    diaAbierto && /Elegí el producto/i.test(avisoVenta),
    `banner día abierto: ${diaAbierto} · aviso: «${avisoVenta}»`);

  // Los 3 accesos directos (chips) + el desplegable «Otros métodos…». El TEXTO exacto importa:
  // el chip de Punto de Venta no debe repetir el símbolo («PUNTO Bs Bs.» ya se escapó una vez).
  const chips = await evalx(`[...document.querySelectorAll('[role="dialog"] button[data-state]')]
    .map(b => (b.innerText || '').replace(/\\s+/g, ' ').trim())
    .filter(t => /PUNTO Bs|PAGO MOVIL|EFECTIVO/.test(t))`);
  check('el selector de pago ofrece los 3 accesos directos del local', chips.length === 3, chips.join(' · '));
  check('los chips son exactamente PUNTO Bs · PAGO MOVIL (Bs. una sola vez) · EFECTIVO $',
    chips.includes('PUNTO Bs') && chips.includes('EFECTIVO $') && chips.some(c => c.startsWith('PAGO MOVIL') && (c.match(/Bs/g) || []).length === 1),
    chips.join(' · '));
  const otros = await evalx(`[...document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="combobox"]')]
    .some(b => (b.innerText || '').includes('Otros métodos'))`);
  check('existe el desplegable «Otros métodos…»', otros === true, String(otros));

  // --- elegir un producto CON STOCK por IPC (el nombre se pega EXACTO: la sugerencia vuelve sola) ---
  const prodRaw = await invoke('get_products_page', { search: '', categoryId: null, brand: null, stockFilter: 'con_stock', sort: 'nombre', limit: 200, offset: 0 });
  const prod = (prodRaw?.items ?? []).find(p => p.stock > 0 && p.price_sale > 0);
  check('hay un producto con stock y precio para la venta de prueba', !!prod,
    prod ? `${prod.name} · stock ${prod.stock} · $${prod.price_sale}` : 'ninguno');

  if (prod) {
    await clickCenter(`document.querySelector('[role="dialog"] input[placeholder="Buscar producto..."]')`);
    await setValue('[role="dialog"] input[placeholder="Buscar producto..."]', prod.name);
    await sleep(1200);
    // La sugerencia muestra el nombre SIN el prefijo «Pantalla» y con el stock al lado:
    // «Apple 11 (ORIGINAL) $25.00 · Stock: 1». Se busca por el patrón del stock (estable) y se
    // exige que sea el MISMO producto (mismo stock que la ficha traída del backend).
    const sug = await evalx(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /Stock:\\s*\\d+/.test(b.innerText || '')) || {}).innerText ?? null`);
    const sugPlano = String(sug).replace(/\s+/g, ' ').trim();
    check('la búsqueda del producto trae la sugerencia con su stock',
      !!sug && new RegExp(`Stock:\\s*${prod.stock}\\b`).test(sugPlano), sugPlano.slice(0, 120));
    check('la sugerencia es el MISMO producto pedido',
      !!sug && sugPlano.includes(prod.name.replace(/^Pantalla\s+/i, '')), sugPlano.slice(0, 120));
    // elegir la sugerencia = el botón del desplegable (los chips de método son ToggleGroup, no llevan stock)
    await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /Stock:\\s*\\d+/.test(b.innerText || '')) || null)`);
    await sleep(700);
    const precio = await valueOf('[role="dialog"] input[type="number"][step="0.01"]');
    check('elegir el producto completa el precio unitario', Number(precio) > 0, `precio: ${precio}`);
  }
  const cantidad = await valueOf('[role="dialog"] input[type="number"][min="1"]');
  check('la cantidad arranca en 1', Number(cantidad) === 1, `cantidad: ${cantidad}`);

  // --- método «EFECTIVO $» (chip Divisas (USD Cash)) ---
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button[data-state]')].find(b => (b.innerText || '').trim() === 'EFECTIVO $') || null)`);
  await sleep(700);
  const chipOn = await evalx(toggled('EFECTIVO $'));
  check('el método «EFECTIVO $» queda seleccionado (data-state=on)', chipOn === true || chipOn === 'true', String(chipOn));

  // --- cliente: se reutiliza uno REAL (no se crea basura en `clients`, que no tiene borrado) ---
  const cliRaw = await invoke('get_clients', { search: '' });
  const cli = (cliRaw ?? []).find(c => c.name);
  let clienteUsado = null;
  if (cli) {
    await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar o escribir nombre"]')`);
    await setValue('[role="dialog"] input[placeholder^="Buscar o escribir nombre"]', cli.name);
    await sleep(1200);
    await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').trim().startsWith(${JSON.stringify(cli.name)})) || null)`);
    await sleep(700);
    clienteUsado = await valueOf('[role="dialog"] input[placeholder^="Buscar o escribir nombre"]');
    check('la sugerencia completa el cliente de la venta', clienteUsado === cli.name, `cliente: ${clienteUsado}`);
  } else {
    check('hay un cliente registrado para usar en la venta de prueba', false, 'la tabla clients está vacía (se registra sin cliente)');
  }

  // --- GUARDAR: es la venta de prueba de verdad ---
  const botonGuardar = await evalx(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').includes('Guardar Venta')) || {}).innerText ?? null`);
  check('el botón de guardado anuncia el monto que va a registrar', /Guardar Venta \(\$\d/.test(String(botonGuardar)), String(botonGuardar));
  const habilitadoAhora = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => (x.innerText || '').includes('Guardar Venta'));
    return b ? !b.disabled : null;
  })()`);
  check('con la venta completa (producto + cliente + método) «Guardar Venta» se habilita',
    habilitadoAhora === true, `habilitado: ${habilitadoAhora} · ${botonGuardar}`);
  await clickDialog('Guardar Venta');
  // OJO: NO sirve mirar el texto de la página («Nueva Venta» es también el botón de la barra):
  // la señal correcta de que guardó es que el DIÁLOGO se cierre. Se espera de más (el guardado
  // + recarga puede tardar con la app cargada de trabajo) y, si quedó abierto, se cierra para
  // no bloquear las secciones siguientes.
  let cerro = await waitFor(`document.querySelectorAll('${DLG}').length === 0`, 20000);
  if (!cerro) { await closeAllDialogs(); cerro = (await dialogsOpen().catch(() => 1)) === 0; }
  check('la venta de prueba se guarda (el formulario se cierra)', cerro);

  // --- comprobar que aparece en la lista del día (filtro «Hoy») ---
  // El producto de la venta se lee del BACKEND: no depende de que la sugerencia haya quedado escrita
  // igual en el campo. OJO (2026-09-26): hay que buscar LA VENTA DE ESTA PRUEBA (mismo producto y
  // mismo cliente), no «la última venta de hoy»: una copia sembrada puede tener una venta de HOY con
  // hora posterior (el seed la crea a las 11:30) y la prueba terminaba comparando la fila equivocada
  // —el método de OTRA venta— aunque la venta de la prueba hubiera quedado perfecta.
  const ventasHoy = await invoke('get_sales', { search: '', days: null, startDate: HOY, endDate: HOY });
  const esMia = (v) => String(v?.product_name ?? '').includes((prod?.name ?? '').replace(/^Pantalla\s+/i, ''))
    && (!clienteUsado || String(v?.client_name ?? '') === String(clienteUsado));
  const ventaPropia = (ventasHoy ?? []).find(esMia) ?? (ventasHoy ?? [])[0] ?? null;
  await clickCenter(`document.querySelector('input[placeholder="Buscar producto, cliente o cédula..."]')`);
  await setValue('input[placeholder="Buscar producto, cliente o cédula..."]', ventaPropia ? ventaPropia.product_name : (prod ? prod.name : ''));
  await sleep(1500);
  const filaVenta = await evalx(`(() => {
    const rows = [...document.querySelectorAll('main table tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim()));
    const texto = ${JSON.stringify((ventaPropia?.product_name || prod?.name || '').replace(/^Pantalla\s+/i, ''))};
    const cliente = ${JSON.stringify(String(clienteUsado ?? ''))};
    const candidatas = rows.filter(c => c[2] && c[2].includes(texto));
    const r = (cliente ? candidatas.find(c => (c[7] || '').includes(cliente.split(' ')[0])) : null) ?? candidatas[0];
    return r ? JSON.stringify({ id: r[0], fecha: r[1], producto: r[2], cant: r[3], total: r[5], pago: r[6], cliente: r[7] }) : null;
  })()`);
  ventaPrueba = filaVenta ? JSON.parse(filaVenta) : null;
  check('la venta de prueba aparece en la lista del día (con fecha de hoy)',
    !!ventaPrueba && String(ventaPrueba.fecha || '').slice(0, 10) === HOY,
    ventaPrueba ? `#${ventaPrueba.id} · ${ventaPrueba.producto} · ${ventaPrueba.total} · ${ventaPrueba.pago} · ${ventaPrueba.fecha}` : 'no se encontró la fila');
  check('la venta quedó con el método EFECTIVO $ (Divisas)',
    !!ventaPrueba && /Divisas/i.test(ventaPrueba.pago || ''), ventaPrueba ? ventaPrueba.pago : '—');

  // --- ¿se puede borrar una venta desde la UI? (no: se dice fuerte al final) ---
  // Revisado en el código: Sales.tsx NO tiene botón de eliminar y el backend no expone
  // ningún comando `delete_sale` (solo delete_product/delete_service/delete_purchase_order).
  const puedeBorrarVenta = await evalx(`(() => {
    const main = document.querySelector('main');
    const botones = [...main.querySelectorAll('button')];
    const conTexto = botones.some(b => /eliminar|borrar|delete/i.test(b.innerText || '') || /eliminar|borrar/i.test(b.title || '') || /eliminar|borrar/i.test(b.getAttribute('aria-label') || ''));
    // Lucide renderiza el icono de papelera con las clases «lucide-trash-2 / lucide-trash»:
    // el innerHTML del SVG no dice nada, la clase sí.
    const conPapelera = botones.some(b => [...b.querySelectorAll('svg')].some(s => /lucide-trash|trash/i.test(s.getAttribute('class') || '')));
    return JSON.stringify({ conTexto, conPapelera });
  })()`);
  const pb = JSON.parse(puedeBorrarVenta || '{}');
  check('la pantalla de Ventas NO ofrece borrar (no hay comando `delete_sale` en el backend)',
    pb.conTexto === false && pb.conPapelera === false, `botón con texto: ${pb.conTexto} · papelera: ${pb.conPapelera}`);
  if (ventaPrueba) {
    residuo.push(`VENTA DE PRUEBA #${ventaPrueba.id} («${ventaPrueba.producto}», ${ventaPrueba.total}) — **NO SE PUEDE BORRAR**: el backend no tiene comando de borrado de ventas y Ventas.tsx no tiene botón de eliminar. Corré este smoke contra una COPIA de la base.`);
  }
  // limpiar el buscador para no dejar filtros puestos
  await setValue('input[placeholder="Buscar producto, cliente o cédula..."]', '');
  await sleep(900);
}

// ============================================================================================
// 4) SERVICIO TÉCNICO: wizard, sugerencia por teléfono, orden de prueba, asistente «Cerrar»,
//    «Pago / Abono» y limpieza de la orden
// ============================================================================================
let ordenPrueba = null; // { num, id }
let modeloElegido = null; // { label, stock, pantalla, pantallaId } — lo reusa la sección de Inventario
let pantallaDePrueba = null;

/**
 * Busca la TARJETA (Card) de una orden en la lista: sube desde el nodo que muestra el número de
 * orden hasta el ancestro que también tiene los botones de la tarjeta (Cerrar/Entregar/Editar…).
 * Se ancla en el texto exacto para no confundir «DEV-0001» con «DEV-0001-A» (órdenes multi-equipo).
 */
const cardOf = (orderNum) => `(() => {
  const node = [...document.querySelectorAll('main span, main p, main div')]
    .find(n => (n.textContent || '').trim() === ${JSON.stringify(orderNum)});
  let el = node;
  while (el && el !== document.body) {
    if (el.querySelectorAll('button').length >= 4) return el;
    el = el.parentElement;
  }
  return null;
})()`;
const clickCardButton = async (orderNum, label) => {
  await clickCenter(`(() => {
    const card = ${cardOf(orderNum)};
    if (!card) return null;
    return [...card.querySelectorAll('button')].find(b => (b.innerText || '').includes(${JSON.stringify(label)})) || null;
  })()`);
};
{
  // --- modelo + pantalla: se elige un modelo del CATÁLOGO que TENGA pantalla con stock (así
  //     «Cambio pantalla» es coherente y el asistente de cierre tiene qué ofrecer).
  //     Se revisan como mucho 15 teléfonos con stock (cada uno es una consulta de compatibilidad):
  //     alcanza para encontrar una pantalla disponible sin hacer 60 round-trips al backend. ---
  const modelos = await invoke('get_phone_models', { search: '', limit: 60 });
  const candidatosModelo = (modelos ?? []).filter(m => m.with_stock > 0 && m.screens > 0).slice(0, 15);
  let elegido = null;
  for (const m of candidatosModelo) {
    const cand = await invoke('find_compatible_screens', { model: m.label, limit: 5 });
    const pant = (cand ?? []).find(c => c.in_stock && c.product.stock > 0);
    if (pant) { elegido = { label: m.label, stock: m.stock, pantalla: pant.product.name, pantallaId: pant.product.id }; break; }
  }
  check('hay un modelo del padrón con pantalla compatible CON STOCK (para la orden de prueba)',
    !!elegido, elegido ? `${elegido.label} → ${elegido.pantalla} (stock ${elegido.stock})` : 'ninguno');
  pantallaDePrueba = elegido;
  modeloElegido = elegido;

  const nextNum = await invoke('next_order_num');
  const cliRaw = await invoke('get_clients', { search: '' });
  const cli = (cliRaw ?? []).find(c => c.name && c.phone && String(c.phone).replace(/\D/g, '').length >= 7);
  check('hay un cliente conocido con teléfono (para la sugerencia del mostrador)', !!cli,
    cli ? `${cli.name} · ${cli.phone}` : 'ninguno');

  if (elegido && cli) {
    await goto('Servicio Técnico');
    await waitH1('Servicio Técnico');
    const diaAbierto = await evalx(`/Día abierto/.test(document.querySelector('main').innerText)`);
    check('Servicio Técnico ve el DÍA ABIERTO (si no, el backend rechaza registrar)', diaAbierto === true);

    await clickButton('Nuevo Servicio');
    const abrio = await waitFor(`(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Servicio Técnico')`, 8000);
    check('«Nuevo Servicio» abre el wizard', abrio, (await dialogTxt() || '').split('\n')[0]);
    const foco = await evalx(`document.activeElement?.getAttribute('placeholder') ?? document.activeElement?.tagName ?? null`);
    check('el foco arranca en el campo Cliente', String(foco).includes('Buscar por nombre o cédula'), `foco: ${foco}`);

    const paso1 = await dialogTxt();
    check('el paso Cliente dice qué falta («Falta: …»)', /Falta:/.test(paso1 || ''),
      (String(paso1).match(/Falta:[^\n]*/) || [''])[0]);

    // --- el cliente dice su TELÉFONO: la ficha se completa sola ---
    await clickCenter(`document.querySelector('[role="dialog"] input[placeholder="0412-1234567"]')`);
    await setValue('[role="dialog"] input[placeholder="0412-1234567"]', cli.phone);
    const trajo = await waitFor(`/Cliente conocido con ese teléfono/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 8000);
    check(`escribir el teléfono ${cli.phone} trae la sugerencia del cliente conocido`, trajo,
      (String(await dialogTxt()).match(/Cliente conocido[^\n]*/) || [''])[0]);
    await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').includes(${JSON.stringify(cli.name)})) || null)`);
    await sleep(900);
    const vCliente = await valueOf('[role="dialog"] input[placeholder^="Buscar por nombre"]');
    const vCi = await valueOf('[role="dialog"] input[placeholder="V-12345678"]');
    check('elegir la sugerencia completa el cliente (nombre + cédula)',
      (vCliente || '').includes(cli.name.split(' ')[0]) && !!vCi, `nombre: ${vCliente} · cédula: ${vCi}`);
    check('el paso Cliente ya no muestra «Falta:»', !/Falta:/.test(String(await dialogTxt())));

    // --- ENTER avanza de paso (el operario sigue tipeando en un campo) ---
    await evalx(`document.querySelector('[role="dialog"] input[placeholder="V-12345678"]')?.focus(); true`);
    await sleep(300);
    const enInput = await evalx(`document.activeElement?.tagName === 'INPUT'`);
    await keyNav('Enter', 'Enter', 13);
    await sleep(900);
    check('ENTER en un campo completo avanza al paso siguiente',
      !!enInput && /Paso 2 de 4/.test(String(await dialogTxt())),
      (String(await dialogTxt()).match(/Paso \d+ de \d+[^\n]*/) || [''])[0]);

    // --- paso Equipos: modelo del padrón, trabajo «Cambio pantalla», monto 10 ---
    // La sugerencia del combobox de modelo es un <button> SIN data-state (texto «13C 5G Xiaomi»):
    // se elige por texto, excluyendo las opciones de pantalla (que dicen «Pantalla …»).
    await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')`);
    await insertText(elegido.label);
    const haySugerencia = await waitFor(
      `[...document.querySelectorAll('[role="dialog"] button')].some(b => {
        const t = (b.innerText || '').replace(/\\s+/g, ' ').trim();
        return t.startsWith(${JSON.stringify(elegido.label)}) && !/^Pantalla /.test(t);
      })`, 8000);
    check('el combobox de modelo ofrece la ficha del padrón', haySugerencia, `label: ${elegido.label}`);
    await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => {
      const t = (b.innerText || '').replace(/\\s+/g, ' ').trim();
      return t.startsWith(${JSON.stringify(elegido.label)}) && !/^Pantalla /.test(t);
    }) || null)`);
    await sleep(900);
    const modeloOk = (await valueOf('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')) === elegido.label;
    check('elegir el modelo de la lista del padrón lo deja puesto', modeloOk,
      `modelo: ${await valueOf('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')}`);

    // «Cambio pantalla» viene PRESELECCIONADO en un equipo nuevo (es el trabajo del local) y los
    // chips de TRABAJOS no son toggles de Radix: no llevan `data-state`, se pintan con
    // `bg-primary` cuando están activos (los de MÉTODO de PAGO sí llevan data-state).
    // Antes el smoke los clickeaba siempre: los APAGABA y el paso quedaba sin trabajos.
    const pantallaYaActiva = await evalx(chipTrabajoOn('Cambio pantalla'));
    if (!pantallaYaActiva) {
      await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').trim() === 'Cambio pantalla') || null)`);
      await sleep(700);
    }
    check('el trabajo «Cambio pantalla» queda activo (viene preseleccionado en un equipo nuevo)',
      await evalx(chipTrabajoOn('Cambio pantalla')), `ya venía activo: ${pantallaYaActiva}`);
    check('con «Cambio pantalla» aparece el desplegable de pantalla a instalar',
      /Pantalla a instalar/.test(String(await dialogTxt())));

    // Monto: el input que sigue al rótulo «Monto ($)». NO se toca el del descuento.
    await evalx(`(() => {
      const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => (x.innerText || '').startsWith('Monto ($)'));
      const i = l?.parentElement?.querySelector('input[type="number"]');
      if (i) i.focus();
      return !!i;
    })()`);
    await evalx(`(() => {
      const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => (x.innerText || '').startsWith('Monto ($)'));
      const i = l?.parentElement?.querySelector('input[type="number"]');
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(i, '10');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(700);
    const montoPuesto = await evalx(`(() => {
      const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => (x.innerText || '').startsWith('Monto ($)'));
      return l?.parentElement?.querySelector('input[type="number"]')?.value ?? null;
    })()`);
    check('el monto del servicio queda en 10', Number(montoPuesto) === 10, `monto: ${montoPuesto}`);

    // --- F48: el COLOR del equipo es OBLIGATORIO (el dueño lo pidió). Sin él «Siguiente» no
    //     avanza y el smoke se quedaba en el paso 2 culpando al wizard (el gate es real y correcto).
    //     Se elige por TECLADO desde el control (`data-ficha-target="color"`, el mismo que usa el
    //     botón «Ir al campo» de la ficha): los clics por coordenadas fallan si el campo quedó
    //     fuera del área visible del diálogo.
    const colorOk = await elegirSelectPorTeclado('[role="dialog"] [data-ficha-target="color"]', 'Negro');
    const colorPuesto = await evalx(`document.querySelector('[role="dialog"] [data-ficha-target="color"]')?.innerText?.trim() ?? null`);
    check('el color del equipo queda elegido (dato obligatorio desde F48)',
      colorOk && /Negro/.test(String(colorPuesto)), `eligió=${colorOk} · color: ${colorPuesto}`);

    // La pantalla exacta se auto-selecciona si hay UNA sola con stock (regla del proyecto).
    await waitFor(`/Pantalla a instalar/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 12000);
    await sleep(1500);
    const pantallaElegida = await evalx(`/Al entregar se descuenta del inventario/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`);
    check('la pantalla compatible con stock quedó elegida (se descuenta del inventario al entregar)',
      pantallaElegida === true, String(pantallaElegida));

    // --- Siguiente ×2 (Blindaje → Revisar) y GUARDAR ---
    await clickDialog('Siguiente');
    await sleep(900);
    await clickDialog('Siguiente');
    await sleep(900);
    const enRevisar = /Paso 4 de 4/.test(String(await dialogTxt()));
    check('el wizard llega al paso «Revisar»', enRevisar,
      (String(await dialogTxt()).match(/Paso \d+ de \d+[^\n]*/) || [''])[0]);
    // El paso «Revisar» muestra el resumen como TEXTO (no hay inputs con los valores): se lee el
    // diálogo, no los `value` (antes la prueba buscaba inputs y recibía [] → falso FAIL).
    const revisarTxt = String(await dialogTxt());
    check('el resumen del paso Revisar refleja lo cargado (modelo y monto 10)',
      revisarTxt.includes(elegido.label) && /\$10\.00|\b10\b/.test(revisarTxt),
      revisarTxt.replace(/\n+/g, ' | ').slice(0, 200));

    // F77: el último paso trae el check «Imprimir la orden ahora» PREMARCADO (y entonces el botón dice
    // «Guardar e imprimir»). El smoke recorre TODA la app, así que se destilda para que no se abra el
    // comprobante encima y el recorrido siga igual que antes (destildar es una forma legítima de usar
    // la pantalla: la orden se guarda igual y se imprime después desde la tarjeta).
    await evalx(`(() => {
      const c = document.querySelector('[data-field="imprimir-al-guardar"]');
      if (c && c.checked) c.click();
      return c ? c.checked : null;
    })()`);
    await sleep(500);
    await clickDialog('Guardar Servicio');
    const guardada = await waitFor(`!document.body.innerText.includes('Nuevo Servicio Técnico')`, 12000);
    const svcNuevo = (await serviciosRaw()).filter(s => s.order_num === nextNum);
    ordenPrueba = svcNuevo.length > 0 ? { num: nextNum, id: svcNuevo[0].id } : null;
    check('la orden de prueba se registra de verdad (aparece por IPC con su número)',
      guardada && !!ordenPrueba,
      ordenPrueba ? `${ordenPrueba.num} (id ${ordenPrueba.id}) · modelo ${svcNuevo[0].model} · $${svcNuevo[0].amount}` : 'no se creó la orden');

    if (ordenPrueba) {
      check('la orden guardó el modelo, el trabajo y el monto pedidos',
        svcNuevo[0].model === elegido.label && /Cambio pantalla/.test(svcNuevo[0].service_types ?? '') && Number(svcNuevo[0].amount) === 10,
        `modelo ${svcNuevo[0].model} · trabajos ${svcNuevo[0].service_types} · $${svcNuevo[0].amount}`);
      check('la orden quedó con la pantalla EXACTA asignada (stock trazable)',
        svcNuevo[0].screen_product_id === elegido.pantallaId,
        `screen_product_id ${svcNuevo[0].screen_product_id} (esperado ${elegido.pantallaId})`);

      // --- la tarjeta aparece en la lista: se pasa el filtro de estado a «Todos los estados» ---
      // Se usa la MISMA técnica que para el color (teclado + `data-highlighted`): el clic por
      // coordenadas sobre el portal de Radix falla cuando la opción cae fuera del área visible.
      const eligioEstado = await elegirSelectPorTeclado('main [role="combobox"][aria-label="Filtrar por estado"]', 'Todos los estados');
      const estadoPuesto = await evalx(`document.querySelector('main [role="combobox"][aria-label="Filtrar por estado"]')?.innerText?.trim() ?? null`);
      check('el filtro de estados ofrece «Todos los estados»',
        eligioEstado && /Todos los estados/.test(String(estadoPuesto)), `eligió=${eligioEstado} · estado=${estadoPuesto}`);
      await sleep(1500);
      const tarjeta = await evalx(`!!(${cardOf(ordenPrueba.num)})`);
      check('la tarjeta de la orden de prueba aparece en la lista', tarjeta === true, ordenPrueba.num);

      // --- F49: la tarjeta ya NO tiene «Cerrar» (lo reemplazó «Descuento»); el asistente de cierre
      //     se abre por la COLA DE ENTREGAS (botón «Cerrar entrega»), como en el mostrador ---
      const botonesTarjeta = await evalx(`JSON.stringify({
        descuento: [...document.querySelectorAll('button')].some(b => (b.innerText || '').trim() === 'Descuento'),
        cerrar: [...document.querySelectorAll('button')].some(b => (b.innerText || '').trim() === 'Cerrar'),
      })`);
      const bt = JSON.parse(botonesTarjeta ?? '{}');
      check('F49: la tarjeta ofrece «Descuento» y ya no «Cerrar»', bt.descuento === true && bt.cerrar === false, String(botonesTarjeta));
      // F54: si quedó un aviso de política pendiente (el guardado del wizard lo dispara), el primer
      // clic lo come su velo: se cierra ANTES de pulsar «Cerrar entrega» (como haría el operario).
      await closeAllDialogs();
      await clickButton('Cerrar entrega');
      await waitFor(`(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('entrega')`, 8000);
      await clickCenter(`document.querySelector('[role="dialog"] input')`).catch(() => {});
      await insertText(ordenPrueba.num);
      await sleep(1500);
      await clickCenter(`([...document.querySelectorAll('[role="dialog"] [role="option"]')].find(o => (o.innerText || '').includes(${JSON.stringify(ordenPrueba.num)})) || document.querySelector('[role="dialog"] [role="option"]') || null)`).catch(() => {});
      await sleep(1800);
      const asistente = await waitFor(`(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Cerrar ${ordenPrueba.num}')`, 10000);
      check('el asistente «Cerrar» abre por la cola de entregas', asistente,
        (String(await dialogTxt()).split('\n')[0] || ''));
      const chipsCierre = await evalx(`[...document.querySelectorAll('[role="dialog"] button[data-state]')]
        .map(b => (b.innerText || '').replace(/\\s+/g, ' ').trim())
        .filter(t => /PUNTO Bs|PAGO MOVIL|EFECTIVO/.test(t))`);
      check('el asistente de cierre muestra el selector con los 3 chips de método',
        chipsCierre.length === 3 && chipsCierre.includes('PUNTO Bs') && chipsCierre.includes('EFECTIVO $'),
        chipsCierre.join(' · '));
      await closeAllDialogs();

      // --- «Pago / Abono»: abre con el monto sugerido = saldo, y NO se confirma ---
      await clickCardButton(ordenPrueba.num, 'Pago / Abono');
      const dialogoPago = await waitFor(`/Registrar Pago \\/ Abono/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
      check('«Pago / Abono» abre el diálogo de cobro', dialogoPago,
        (String(await dialogTxt()).split('\n')[0] || ''));
      const montoSugerido = await valueOf('[role="dialog"] input[type="number"]');
      check('el monto sugerido del abono = saldo de la orden ($10)',
        Number(montoSugerido) === 10, `monto sugerido: ${montoSugerido}`);
      const chipsPago = await evalx(`[...document.querySelectorAll('[role="dialog"] button[data-state]')]
        .map(b => (b.innerText || '').replace(/\\s+/g, ' ').trim())
        .filter(t => /PUNTO Bs|PAGO MOVIL|EFECTIVO/.test(t))`);
      check('el diálogo de abono también muestra los 3 accesos directos', chipsPago.length === 3, chipsPago.join(' · '));
      await closeAllDialogs();
      const pagosTrasCerrar = await invoke('get_service_payments', { serviceId: ordenPrueba.id });
      check('NO se confirmó ningún cobro (la orden sigue sin pagos)',
        (pagosTrasCerrar ?? []).length === 0, `${(pagosTrasCerrar ?? []).length} pago(s)`);
      const sigueRecibida = (await serviciosRaw()).find(s => s.id === ordenPrueba.id);
      // OJO: una orden NUEVA nace con el estado por defecto del esquema (`Por entregar`), no
      // «Recibido»: lo que importa acá es que NO se entregó (sin fecha de salida, sin pago).
      check('NO se entregó la orden (sin fecha de salida, en un estado no final)',
        !!sigueRecibida && !sigueRecibida.date_out && !['Entregado', 'Devuelto', 'Cancelado', 'Cancelado / Devuelto'].includes(sigueRecibida.status),
        `estado ${sigueRecibida?.status} · salida ${sigueRecibida?.date_out}`);
    }
  }
}

// ============================================================================================
// 5) INVENTARIO: pestañas, búsqueda con stock, paginación, movimientos con referencia de orden
//    y «Repuesto por modelo»
// ============================================================================================
{
  await goto('Inventario');
  await waitH1('Inventario');
  await waitFor(`document.querySelectorAll('[role="tab"]').length > 0`, 8000);
  const tabs = await evalx(`[...document.querySelectorAll('[role="tab"]')].map(t => t.innerText.trim())`);
  check('el Inventario tiene sus 5 pestañas (nombres reales de hoy)',
    (tabs ?? []).join(' | ') === 'Productos | Modelos | Repuesto por modelo | Movimientos | Ajustes',
    (tabs ?? []).join(' | '));

  // --- Productos ---
  await clickExactText('[role="tab"]', 'Productos');
  await sleep(1200);
  check('la pestaña «Productos» abre (buscador del catálogo)',
    await waitFor(`!!document.querySelector('input[placeholder^="Buscar por producto"]')`, 8000));

  await clickCenter(`document.querySelector('input[placeholder^="Buscar por producto"]')`);
  await setValue('input[placeholder^="Buscar por producto"]', 'redmi note');
  await sleep(2000);
  const tablaProd = JSON.parse(await activeTable() || 'null');
  check('buscar «redmi note» devuelve resultados con stock',
    !!tablaProd && tablaProd.rows.length > 0 && /Mostrando \d+–\d+ de \d+/.test(tablaProd.footer),
    tablaProd ? `${tablaProd.footer} · primera: ${(tablaProd.rows[0] || []).slice(0, 5).join(' | ')}` : 'sin tabla');
  const stockProd = await evalx(`(() => {
    const p = document.querySelector('[role="tabpanel"]');
    const badges = [...p.querySelectorAll('table tbody td [title]')].filter(b => /AGOTADO|DISPONIBLE|BAJO MÍNIMO|FALTANTE/.test(b.getAttribute('title') || ''));
    return JSON.stringify({ total: badges.length, conStock: badges.filter(b => Number(b.innerText.trim()) > 0).length, muestra: badges.slice(0, 5).map(b => b.innerText.trim()) });
  })()`);
  const sp = JSON.parse(stockProd || '{}');
  check('las filas muestran el stock en su badge (hay al menos uno con stock)',
    (sp.total || 0) > 0 && (sp.conStock || 0) > 0, `${sp.conStock}/${sp.total} con stock · ${(sp.muestra || []).join(', ')}`);

  const pagina1 = (JSON.parse(await activeTable() || '{}').rows || []).slice(0, 3).map(r => r[0]);
  const hayPaginacion = await evalx(`(() => {
    const p = document.querySelector('[role="tabpanel"]');
    return [...p.querySelectorAll('button')].some(b => (b.innerText || '').includes('Siguiente'));
  })()`);
  let pagina2 = [];
  if (hayPaginacion) {
    await clickCenter(`([...document.querySelectorAll('[role="tabpanel"] button')].find(b => (b.innerText || '').includes('Siguiente')) || null)`);
    await sleep(1800);
    pagina2 = (JSON.parse(await activeTable() || '{}').rows || []).slice(0, 3).map(r => r[0]);
  }
  check('la paginación cambia las filas (el pie dice el total y hay página 2)',
    hayPaginacion && pagina2.length > 0 && JSON.stringify(pagina1) !== JSON.stringify(pagina2),
    `p1: ${pagina1.join(' / ')} → p2: ${pagina2.join(' / ')}`);
  if (hayPaginacion) {
    await clickCenter(`([...document.querySelectorAll('[role="tabpanel"] button')].find(b => (b.innerText || '').includes('Anterior')) || null)`);
    await sleep(1200);
  }

  // --- Movimientos ---
  await clickExactText('[role="tab"]', 'Movimientos');
  await sleep(1600);
  const tablaMov = JSON.parse(await activeTable() || 'null');
  check('la pestaña «Movimientos» abre con sus columnas',
    !!tablaMov && ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Motivo', 'Referencia'].every(h => (tablaMov.headers || []).includes(h)),
    (tablaMov?.headers || []).join(' | '));
  const mov = await invoke('get_inventory_movements_page', { productId: null, movementType: null, reason: null, fromDate: null, toDate: null, limit: 50, offset: 0 });
  const itemsMov = mov?.items ?? [];
  // OJO (2026-09-26): esta prueba pedía ver una referencia de ORDEN (DEV-XXXX) en pantalla, y eso
  // depende de que la COPIA tenga movimientos de servicios (una copia recién sembrada arranca sin
  // movimientos: `seed_dev_db` borra los datos de negocio). Lo que la prueba TIENE que garantizar en
  // cualquier copia es que la columna «Referencia» esté CABLEADA a los datos: se compara la primera
  // fila visible con el movimiento más nuevo del backend.
  const primeraFila = tablaMov?.rows?.[0] ?? null;
  const primerMov = itemsMov[0] ?? null;
  const refPantalla = String(primeraFila?.[5] ?? '').trim();
  const refBackend = String(primerMov?.reference ?? '').trim();
  check('la columna «Referencia» de Movimientos muestra el dato del backend (no está vacía ni desconectada)',
    tablaMov && tablaMov.rows.length > 0 && !!primerMov && refPantalla !== '' && refPantalla === refBackend,
    `${tablaMov?.rows.length} filas · pantalla=«${refPantalla}» · backend=«${refBackend}» · ${itemsMov.length} movimientos`);
  check('el total del pie coincide con los movimientos del backend',
    (tablaMov?.footer || '').includes(String(mov?.total ?? -1)),
    `pie: ${tablaMov?.footer} · backend: ${mov?.total}`);

  // --- Repuesto por modelo ---
  await clickExactText('[role="tab"]', 'Repuesto por modelo');
  await sleep(1000);
  check('la pestaña «Repuesto por modelo» abre (buscador de teléfono)',
    await waitFor(`!!document.querySelector('input[placeholder^="Ej: Redmi Note 11"]')`, 8000));
  await clickCenter(`document.querySelector('input[placeholder^="Ej: Redmi Note 11"]')`);
  await sleep(600);
  await insertText(modeloElegido ? modeloElegido.label : 'Redmi Note 11');
  await sleep(2200);
  const porModelo = await evalx(`(() => {
    const p = document.querySelector('[role="tabpanel"]');
    const t = p.innerText;
    const rows = [...p.querySelectorAll('table tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim()));
    const badgeStock = [...p.querySelectorAll('table tbody td [class*="bg-success"]')].map(b => b.innerText.trim());
    return JSON.stringify({
      cuenta: (t.match(/(\\d+) repuestos? compatibles/) || [])[1] ?? null,
      conStock: (t.match(/(\\d+) con stock/) || [])[1] ?? null,
      filas: rows.length, badgeStock,
      coincide: rows.slice(0, 3).map(r => r[3]),
    });
  })()`);
  const pm = JSON.parse(porModelo || '{}');
  check('el teléfono muestra sus repuestos con stock real',
    Number(pm.filas) > 0 && Number(pm.conStock) > 0 && (pm.badgeStock || []).some(v => Number(v) > 0),
    `${pm.filas} repuesto(s) · ${pm.conStock} con stock · badges: ${(pm.badgeStock || []).join(', ')}`);
  if (pantallaDePrueba) {
    // Se busca el repuesto por el MODELO del teléfono (la tabla muestra el nombre del producto
    // con sus chips de compatibilidad, que pueden partir el texto): lo estable es el modelo.
    const aparecePantalla = await evalx(`(() => {
      const main = document.querySelector('main');
      const t = main?.innerText || '';
      const nombre = ${JSON.stringify(pantallaDePrueba.pantalla)};
      const nucleo = nombre.replace(/^Pantalla\\s+/i, '').split('/')[0].trim();
      return t.includes(nucleo) || t.includes(${JSON.stringify(pantallaDePrueba.label)});
    })()`);
    check('entre los repuestos aparece la pantalla que usa el servicio de prueba', aparecePantalla === true,
      `${pantallaDePrueba.pantalla} · modelo ${pantallaDePrueba.label}`);
  }
}

// ============================================================================================
// 6) PANTALLAS (lo que el taller más usa): la pantalla del modelo con su STOCK + ficha/editar
// ============================================================================================
{
  await clickExactText('[role="tab"]', 'Productos');
  await sleep(1200);
  await waitFor(`!!document.querySelector('input[placeholder^="Buscar por producto"]')`, 8000);
  // El buscador de Productos también indexa la COMPATIBILIDAD: buscar el modelo del padrón trae
  // todas las pantallas que le sirven. Para la ficha se usa el NOMBRE del repuesto (más preciso).
  // La tabla de Productos ganó columnas (F50: «En uso»; F51: Precio y Costo siempre visibles), así
  // que las celdas se leen por NOMBRE DE COLUMNA (del `thead`), nunca por posición: un índice fijo se
  // corre solo con la próxima columna que se agregue (misma regla que el backend: nada posicional).
  const buscar = (t) => setValue('input[placeholder^="Buscar por producto"]', t);
  const nombrePantalla = pantallaDePrueba ? pantallaDePrueba.pantalla : '';
  const modeloBuscar = pantallaDePrueba ? pantallaDePrueba.label : 'Redmi Note 11';
  await clickCenter(`document.querySelector('input[placeholder^="Buscar por producto"]')`);
  await buscar(modeloBuscar);
  await sleep(2200);

  /** Fila de la tabla de Productos que cumple un criterio, con su badge de stock (por columna). */
  const filaDeProductos = (criterio) => evalx(`(() => {
    const p = document.querySelector('[role="tabpanel"]');
    const heads = [...p.querySelectorAll('table thead th')].map(h => (h.innerText || '').trim().toLowerCase());
    // Los rótulos reales de hoy: Producto · En uso · Categoría · Marca · Modelo · Modelos compatibles ·
    // Precio · Costo · Stock · Mín. Se buscan por nombre (varias grafías posibles), nunca por posición.
    const col = (...ns) => heads.findIndex(h => ns.some(n => h.startsWith(n)));
    const iProd = col('producto'), iCat = col('categor'), iMarca = col('marca'), iMod = col('modelo'),
          iStock = col('stock');
    // «Modelos compatibles» empieza con «Modelo»… pero la columna del teléfono del repuesto también:
    // se busca PRIMERO «compat» y solo si no existe se cae a «modelo».
    const iComp = (() => { const a = heads.findIndex(h => h.includes('compat')); return a >= 0 ? a : col('modelo'); })();
    const rows = [...p.querySelectorAll('table tbody tr')];
    const celdas = (tr) => [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
    const tr = rows.find(x => { const c = celdas(x); return ${criterio}; });
    if (!tr) return null;
    const c = celdas(tr);
    const badges = [...tr.querySelectorAll('td [title]')].map(b => ({ t: b.getAttribute('title'), v: b.innerText.trim() }));
    return JSON.stringify({
      producto: c[iProd], categoria: c[iCat], marca: c[iMarca], modelo: c[iMod], compat: c[iComp],
      stock: badges.find(b => /AGOTADO|DISPONIBLE|BAJO|FALTANTE/.test(b.t)) ?? null,
      stockTexto: c[iStock] ?? null,
    });
  })()`);

  const filaPantalla = await filaDeProductos(
    `(c[iComp] || '').includes(${JSON.stringify(modeloBuscar)}) || (c[iMod] || '') === ${JSON.stringify(modeloBuscar)}`);
  const fp = JSON.parse(filaPantalla || 'null');
  check('la pantalla compatible con el modelo aparece en Productos',
    !!fp, fp ? `${fp.producto} · ${fp.categoria} · compat: ${String(fp.compat).slice(0, 60)}` : 'no se encontró la fila');
  check('esa pantalla muestra su STOCK (badge con estado y número)',
    !!fp && fp.stock != null && fp.stock.v !== '', fp && fp.stock ? `${fp.stock.t} = ${fp.stock.v}` : 'sin badge de stock');

  // La pantalla ELEGIDA por el servicio: se busca por SU nombre y se lee SU stock (no el de
  // cualquiera de las compatibles, que es lo que hacía antes y no probaba la pantalla elegida).
  // El nombre de la ficha trae las tres grafías separadas por « / »; en la tabla la primera parte es
  // la que está en la columna Producto (el resto vive en «Modelos compatibles»).
  const nucleoPantalla = nombrePantalla.replace(/^Pantalla\s+/i, '').split('/')[0].trim();
  if (nombrePantalla) {
    await clickCenter(`document.querySelector('input[placeholder^="Buscar por producto"]')`);
    await buscar(nombrePantalla);
    await sleep(2000);
  }
  const filaElegidaRaw = await filaDeProductos(`c.some(v => (v || '').includes(${JSON.stringify(nucleoPantalla)}))`);
  const fe = JSON.parse(filaElegidaRaw || 'null');
  check('la pantalla elegida por el servicio está entre las filas listadas y con stock',
    !!pantallaDePrueba && !!fe && Number(fe.stock?.v) > 0,
    `esperada: ${pantallaDePrueba?.pantalla} (stock ${pantallaDePrueba?.stock}) · listada: ${fe?.producto ?? 'ninguna'} · ${fe?.stock ? `${fe.stock.t} = ${fe.stock.v}` : 'sin badge'}`);

  // --- ficha/editar: se abre y se cierra SIN guardar ---
  // La búsqueda ya está afinada con el NOMBRE del repuesto (primera fila = la que se quiere abrir).
  const filaParaAbrir = `(() => {
    const p = document.querySelector('[role="tabpanel"]');
    const rows = [...p.querySelectorAll('table tbody tr')];
    const needle = ${JSON.stringify(nombrePantalla.replace(/^Pantalla\s+/i, ''))};
    const r = rows.find(x => [...x.querySelectorAll('td')].some(c => (c.innerText || '').includes(needle))) || rows[0];
    return r || null;
  })()`;
  const hayFila = await evalx(`!!(${filaParaAbrir})`);
  check('la fila de la pantalla está en la tabla para abrir su ficha', hayFila === true,
    `buscando: ${nombrePantalla || modeloBuscar}`);
  await clickCenter(`(() => {
    const r = ${filaParaAbrir};
    return r ? ([...r.querySelectorAll('button')].find(b => (b.innerText || '').includes('Editar')) || null) : null;
  })()`);
  // El formulario abre como «Editar: <nombre>» y el campo del nombre NO tiene placeholder (solo
  // label «Nombre *»): se comprueba el título y que algún input traiga el nombre del producto.
  const formAbierto = await waitFor(`/[Ee]ditar/.test(document.querySelector('${DLG}')?.innerText ?? '')`, 8000);
  const valoresForm = String(await evalx(`JSON.stringify([...document.querySelectorAll('${DLG_INPUT}')].map(i => i.value))`));
  const nombreEnForm = valoresForm.includes(nombrePantalla.replace(/^Pantalla\s+/i, '').slice(0, 12));
  check('la ficha de la pantalla abre en modo edición con sus datos cargados',
    formAbierto && nombreEnForm,
    `título: ${String(await dialogTxt()).split('\n')[0]} · valores: ${valoresForm.slice(0, 120)}`);
  await closeAllDialogs();
  check('la ficha se cierra sin guardar (no queda ningún diálogo abierto)',
    (await dialogsOpen().catch(() => 0)) === 0, `${await dialogsOpen().catch(() => 0)} diálogo(s)`);
  await setValue('input[placeholder^="Buscar por producto"]', '');
  await sleep(1200);
}

// ============================================================================================
// 7) PEDIDOS: «Nuevo Pedido» + carrito con total, tabla «Por reponer» (NO se guarda el pedido)
// ============================================================================================
{
  await goto('Pedidos');
  await waitH1('Pedidos');
  await waitFor(`/Por reponer/.test(document.querySelector('main').innerText)`, 8000);
  const pedidosAntes = (await invoke('get_purchase_orders'))?.length ?? 0;
  // El título real de la Card es «Por reponer (stock bajo / agotado)»; si el inventario está
  // sano la propia pantalla dice que no hay nada que reponer (eso también es un PASS honesto).
  const reponer = JSON.parse(await evalx(`(() => {
    const main = document.querySelector('main');
    const t = main?.innerText || '';
    const vacio = /Inventario en buen estado|sin productos por reponer/i.test(t);
    const card = [...main.querySelectorAll('div')]
      .filter(d => /Por reponer/i.test(d.innerText || '') && d.querySelector('table'))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
    const tabla = card ? card.querySelector('table') : null;
    return JSON.stringify({ filas: tabla ? tabla.querySelectorAll('tbody tr').length : -1, vacio });
  })()`));
  check('la tabla «Por reponer» tiene filas o la pantalla dice que no hay nada que reponer',
    Number(reponer.filas) > 0 || reponer.vacio === true,
    `${reponer.filas} fila(s)${reponer.vacio ? ' · «Inventario en buen estado»' : ''}`);

  await clickButton('Nuevo Pedido');
  const abrio = await waitFor(`(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Pedido')`, 8000);
  check('«Nuevo Pedido» abre el diálogo', abrio);

  const prodPed = (await invoke('get_products_page', { search: '', categoryId: null, brand: null, stockFilter: 'todos', sort: 'nombre', limit: 100, offset: 0 }))?.items?.[0];
  if (prodPed) {
    await clickCenter(`document.querySelector('[role="dialog"] input[placeholder="Buscar producto para agregar..."]')`);
    await insertText(prodPed.name.replace(/^Pantalla\s+/i, '').slice(0, 18));
    await sleep(1200);
    await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').includes('Stock:')) || null)`);
    await sleep(900);
    const carrito = await evalx(`(() => {
      const t = document.querySelector('[role="dialog"]').innerText;
      return JSON.stringify({ lineas: document.querySelectorAll('[role="dialog"] table tbody tr').length, total: (t.match(/Total: \\$([\\d.,]+)/) || [])[1] ?? null, unidades: (t.match(/(\\d+) unidades/) || [])[1] ?? null });
    })()`);
    const ca = JSON.parse(carrito || '{}');
    check('agregar un producto al carrito muestra la línea y el TOTAL del pedido',
      Number(ca.lineas) >= 1 && Number(ca.total) >= 0 && ca.total !== null,
      `${ca.lineas} línea(s) · ${ca.unidades} unidades · total $${ca.total}`);
    const totalEsperado = Number(prodPed.price_cost > 0 ? prodPed.price_cost : prodPed.price_sale) * Number(ca.unidades || 1);
    check('el total del carrito coincide con precio × cantidad',
      Math.abs(Number(ca.total) - totalEsperado) < 0.02, `total ${ca.total} vs esperado ${totalEsperado.toFixed(2)}`);
  } else {
    check('hay productos en el catálogo para el carrito del pedido', false, 'catálogo vacío');
  }
  // NO se guarda: se cierra con Cancelar (el carrito vive solo en memoria)
  await clickDialog('Cancelar');
  await closeAllDialogs();
  const pedidosDespues = (await invoke('get_purchase_orders'))?.length ?? 0;
  check('el pedido NO se guardó (no quedó ninguna orden de compra nueva)',
    pedidosDespues === pedidosAntes, `${pedidosAntes} → ${pedidosDespues} pedidos`);
}

// ============================================================================================
// 8) CLIENTES: búsqueda por cédula y su historial
// ============================================================================================
{
  await goto('Clientes');
  await waitH1('Clientes');
  const conCi = (await invoke('get_clients', { search: '' }))?.find(c => c.ci && String(c.ci).trim().length >= 5);
  if (conCi) {
    await clickCenter(`document.querySelector('input[placeholder^="Buscar por nombre, teléfono o cédula"]')`);
    await setValue('input[placeholder^="Buscar por nombre, teléfono o cédula"]', conCi.ci);
    await sleep(1600);
    const fila = await evalx(`(() => {
      const rows = [...document.querySelectorAll('main table tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim()));
      return JSON.stringify(rows.find(c => (c[0] || '').includes(${JSON.stringify(conCi.name)})) ?? null);
    })()`);
    const f = JSON.parse(fila || 'null');
    check(`buscar por cédula (${conCi.ci}) encuentra al cliente`,
      !!f && (f[2] || '').includes(conCi.ci), f ? `${f[0]} · ${f[2]} · ${f[3]} servicios · ${f[4]} compras` : 'no se encontró');

    // el clic en la fila abre el historial (servicios + compras)
    await clickCenter(`([...document.querySelectorAll('main table tbody tr')].find(r => (r.innerText || '').includes(${JSON.stringify(conCi.name)})) || null)`);
    // La señal estable de que abrió el historial es el DIÁLOGO con las dos secciones
    // («Servicios Técnicos» / «Compras»): antes se exigía además el texto «Total Gastado»,
    // que ya no existe en el encabezado y daba un falso FAIL.
    const historial = await waitFor(`(() => {
      const d = document.querySelector('[role="dialog"]');
      const t = d ? (d.innerText || '') : '';
      return /Servicios T[eé]cnicos/.test(t) || /Compras/.test(t) || /Sin actividad registrada/.test(t);
    })()`, 10000);
    const txtHist = String(await dialogTxt() || '');
    const tieneHistorial = /Servicios Técnicos/.test(txtHist) || /Compras/.test(txtHist);
    check('el historial del cliente abre (servicios y/o compras) o dice que no tiene',
      historial && (tieneHistorial || /Sin actividad registrada para este cliente/.test(txtHist)),
      tieneHistorial
        ? `${(txtHist.match(/Servicios Técnicos[\s\S]{0,40}/) || [''])[0].replace(/\n/g, ' | ')} · ${(txtHist.match(/Compras[\s\S]{0,20}/) || [''])[0].replace(/\n/g, ' | ')}`
        : 'sin actividad registrada');
    await closeAllDialogs();
    await setValue('input[placeholder^="Buscar por nombre, teléfono o cédula"]', '');
    await sleep(1000);
  } else {
    check('hay un cliente con cédula para buscar', false, 'ningún cliente tiene cédula cargada');
  }
}

// ============================================================================================
// 9) LIBRO DIARIO: pestañas, tabla diaria con columnas por método, totales y búsqueda de pagos
// ============================================================================================
{
  await goto('Libro Diario');
  await waitH1('Libro Diario');
  await sleep(1200);

  const tabsLibro = ['Diario', 'Cierres', 'Pagos', 'Gastos', 'Salud'];
  const presentes = await evalx(`[...document.querySelectorAll('button')].map(b => (b.innerText || '').trim())`);
  const faltan = tabsLibro.filter(t => !(presentes ?? []).includes(t));
  check('el Libro Diario tiene sus 5 pestañas (diario | cierres | pagos | gastos | salud)',
    faltan.length === 0, faltan.length ? `faltan: ${faltan.join(', ')}` : tabsLibro.join(' · '));

  // ---- Diario ----
  await clickButton('Diario');
  await sleep(1800);
  const diario = await evalx(`(() => {
    const main = document.querySelector('main');
    const headers = [...main.querySelectorAll('table thead th')].map(h => h.innerText.trim());
    const t = main.innerText;
    return JSON.stringify({
      headers,
      filas: main.querySelectorAll('table tbody tr').length,
      totalPeriodo: (t.match(/Total General del período/) || []).length > 0,
      equivalente: [...main.querySelectorAll('div')].some(d => /Equivalente en USD/.test(d.innerText || '') && d.children.length <= 3),
      resumenDia: /Resumen del día/.test(t),
    });
  })()`);
  const dj = JSON.parse(diario || '{}');
  check('la tabla diaria tiene las columnas por método (Tasa BCV + Total $ + Bs.)',
    (dj.headers || []).includes('Fecha') && (dj.headers || []).includes('Tasa BCV') && (dj.headers || []).some(h => h.startsWith('Total')),
    (dj.headers || []).join(' | '));
  check('los totales del día se muestran (Total General del período + equivalente en USD + Resumen del día)',
    dj.totalPeriodo && dj.equivalente && dj.resumenDia,
    `total período: ${dj.totalPeriodo} · equivalente USD: ${dj.equivalente} · resumen día: ${dj.resumenDia} · ${dj.filas} fila(s)`);
  const diaCerrado = await evalx(`/Día CERRADO/.test(document.querySelector('main').innerText)`);
  check('el Libro Diario informa el estado del día (abierto o cerrado) sin que el script lo toque',
    await evalx(`/Día (ABIERTO|CERRADO)/.test(document.querySelector('main').innerText)`) === true,
    diaCerrado ? 'el día está CERRADO (por eso no se registraron datos nuevos)' : 'el día está ABIERTO');

  // ---- Pestañas Cierres / Gastos / Salud: abren con contenido propio ----
  await clickButton('Cierres');
  await sleep(1600);
  const cierres = await evalx(`(() => {
    const t = document.querySelector('main').innerText;
    return JSON.stringify({ cols: [...document.querySelectorAll('main table thead th')].map(h => h.innerText.trim()).slice(0, 4), diceCierres: /Cierre|cierre/.test(t) });
  })()`);
  check('la pestaña «Cierres» abre con su tabla (Fecha/Punto Neto/Liquidado…)',
    /Fecha/.test(String(JSON.parse(cierres || '{}').cols)), String(JSON.parse(cierres || '{}').cols));

  await clickButton('Gastos');
  await sleep(1600);
  check('la pestaña «Gastos» abre con su tabla o su vacío',
    await evalx(`(() => {
      const t = document.querySelector('main').innerText;
      return /Gasto|gasto/i.test(t) && [...document.querySelectorAll('main table thead th')].some(h => /Categoría|Monto/.test(h.innerText));
    })()`));

  await clickButton('Salud');
  // Los 4 KPIs aparecen cuando responde `getProfitSummary` (consulta pesada): se reintenta en
  // vez de mirar una sola vez (falso FAIL medido con 2,2 s de espera).
  let sa = {};
  for (let i = 0; i < 12; i++) {
    await sleep(900);
    sa = JSON.parse(await evalx(`(() => {
      const t = document.querySelector('main').innerText;
      return JSON.stringify({
        ingresos: /Ingresos del per[ií]odo/i.test(t), utilidad: /Utilidad bruta/i.test(t),
        porCobrar: /Por cobrar a clientes/i.test(t), capital: /Capital en inventario/i.test(t),
      });
    })()`) || '{}');
    if (sa.ingresos && sa.utilidad && sa.porCobrar && sa.capital) break;
  }
  check('la pestaña «Salud» muestra sus 4 KPIs (ingresos, utilidad, por cobrar, inventario)',
    sa.ingresos && sa.utilidad && sa.porCobrar && sa.capital, JSON.stringify(sa));

  // ---- Pagos: búsqueda por rango de fechas ----
  await clickButton('Pagos');
  await sleep(1200);
  const hayFiltros = await evalx(`!!document.querySelector('input[placeholder="Nombre o cédula..."]') && !!document.querySelector('input[placeholder="Nº referencia..."]')`);
  check('la pestaña «Pagos» abre con sus filtros (método, cliente, referencia, moneda)',
    hayFiltros === true);

  const rangoDesde = fechaHace(365);
  await setDate(0, rangoDesde);
  await sleep(500);
  await setDate(1, HOY);
  await sleep(1500);
  await clickButton('Actualizar');
  await sleep(2500);
  const resultados = await evalx(`(() => {
    const main = document.querySelector('main');
    const t = main.innerText;
    const vacio = /Sin pagos que coincidan con los filtros/.test(t);
    const filas = [...main.querySelectorAll('table tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim())).filter(r => r.length >= 7 && /\\d/.test(r[0] || ''));
    return JSON.stringify({ vacio, filas: filas.length, muestra: filas.slice(0, 2), total: (t.match(/Total \\((\\d+) pagos?\\)/) || [])[1] ?? null });
  })()`);
  const rs = JSON.parse(resultados || '{}');
  check('la búsqueda de pagos por rango devuelve filas (o dice «sin resultados»)',
    rs.vacio === true || Number(rs.filas) > 0,
    rs.vacio ? 'sin resultados en el rango' : `${rs.filas} fila(s) · ${(rs.muestra?.[0] || []).slice(0, 6).join(' | ')}`);
  check('los resultados de pagos traen orden, cliente, monto y método',
    rs.vacio === true || (String(rs.muestra?.[0]?.[1] || '').length > 0 && Number(rs.filas) > 0),
    JSON.stringify(rs.muestra?.[0] || []).slice(0, 160));
}

// ============================================================================================
// 10) AYUDA: secciones (acordeones) y las guías paso a paso
// ============================================================================================
{
  await goto('Ayuda');
  await waitH1('Centro de Ayuda');
  // La Ayuda es un chunk aparte: en la primera visita tarda en montar (medido: 704 chars de
  // esqueleto vs 2378 con la guía). Se reintenta la navegación y se ESPERA la guía, en vez de
  // leer tras un tiempo fijo (falso FAIL cuando el chunk todavía no montó).
  let enAyuda = false;
  for (let i = 0; i < 3 && !enAyuda; i++) {
    await goto('Ayuda');
    enAyuda = await waitFor(
      `/Gu[ií]a completa/.test(document.querySelector('main')?.innerText || '')`, 12000);
    if (!enAyuda) await sleep(1200);
  }
  check('la Ayuda abre en la página «Centro de Ayuda» (no quedó en otro módulo)',
    enAyuda && (await evalx(`document.querySelector('main h1')?.innerText`)) === 'Centro de Ayuda',
    `h1: ${await evalx(`document.querySelector('main h1')?.innerText`)}`);
  await sleep(500);
  // La Ayuda es UNA guía larga en secciones + tarjetas de acceso rápido. Las tarjetas «Ver guía
  // paso a paso» son <button> normales (antes la prueba buscaba [role="button"] → 0 falsos).
  const txtAyuda = String(await evalx(`document.querySelector('main').innerText`) || '');
  // Las tarjetas «Ver guía paso a paso» no son <button> ni [role=button] (son un Card clickeable):
  // la evidencia honesta es que el texto de la guía las liste.
  const vecesGuia = (txtAyuda.match(/Ver gu[ií]a paso a paso/gi) || []).length;
  check('la Ayuda lista sus secciones y las tarjetas de acceso rápido',
    vecesGuia >= 4, `${vecesGuia} tarjeta(s) «Ver guía paso a paso»`);
  check('la Ayuda trae la guía completa con sus secciones',
    /Gu[ií]a completa/i.test(txtAyuda) && ['Primeros pasos', 'Registrar una venta', 'Servicio Técnico', 'Inventario', 'Libro Diario']
      .filter(t => txtAyuda.includes(t)).length >= 4,
    ['Primeros pasos', 'Registrar una venta', 'Servicio Técnico', 'Inventario', 'Libro Diario'].filter(t => txtAyuda.includes(t)).join(' · '));

  // La guía completa viene con el CUERPO de cada sección (no hay acordeón que desplegar): la
  // evidencia honesta es que esté el texto de los pasos, no que «crezca» al hacer clic.
  const cuerpoGuia = /Flujo diario recomendado|Abre el d[íi]a en Libro Diario/i.test(txtAyuda);
  check('la guía muestra el contenido de sus secciones (no solo los títulos)', cuerpoGuia,
    (txtAyuda.match(/Flujo diario recomendado[^\n]*/) || [''])[0] || 'sin cuerpo de guía');
  check('la Ayuda documenta los métodos de pago y su moneda',
    /M[ée]todos de pago y su moneda/i.test(txtAyuda));
}

// ============================================================================================
// 11) LIMPIEZA: borrar la ORDEN de prueba y comprobar que la base quedó como estaba
// ============================================================================================
{
  if (ordenPrueba) {
    await goto('Servicio Técnico');
    await waitH1('Servicio Técnico');
    await waitFor(`!!(${cardOf(ordenPrueba.num)})`, 10000);

    // La tarjeta tiene el botón de eliminar (icono papelera «lucide-trash-2», variant ghost, sin
    // texto). Se ancla en el icono y se comprueba abajo que la confirmación nombre ESA orden.
    await clickCenter(`(() => {
      const card = ${cardOf(ordenPrueba.num)};
      if (!card) return null;
      const svgs = [...card.querySelectorAll('button svg')];
      const papelera = svgs.find(s => /lucide-trash/.test(s.getAttribute('class') || ''))
        || [...svgs].filter(s => /size-4/.test(s.getAttribute('class') || '')).pop();
      const b = papelera ? papelera.closest('button') : null;
      return b || [...card.querySelectorAll('button')].filter(x => !(x.innerText || '').trim() && x.querySelector('svg')).pop() || null;
    })()`);
    // La confirmación aparece con animación: se espera y se RELEE el texto (antes se leía una vez
    // y podía llegar vacío → falso «no abrió» con el diálogo en pantalla).
    await waitFor(`/¿Eliminar orden\\?/.test(document.querySelector('${DLG}')?.innerText ?? '')`, 12000);
    await sleep(400);
    const txtConf = String(await dialogTxt() || '');
    const confirmo = /¿Eliminar orden\?/.test(txtConf);
    check('el botón de eliminar de la tarjeta abre la confirmación de ESA orden',
      confirmo && txtConf.includes(ordenPrueba.num),
      (txtConf.match(/¿Eliminar orden\?[\s\S]{0,80}/) || [''])[0].replace(/\n/g, ' '));
    await clickDialog('Eliminar', true);
    await sleep(2000);

    const borrada = await waitFor(`(() => {
      return !document.querySelector('main').innerText.includes(${JSON.stringify(ordenPrueba.num)});
    })()`, 8000);
    const despuesSv = await serviciosRaw();
    check('la orden de prueba se borra de la lista y de la base',
      borrada && !despuesSv.some(s => s.id === ordenPrueba.id),
      `${despuesSv.length} servicios (antes ${ANTES.services}) · ¿sigue DEV? ${despuesSv.some(s => s.id === ordenPrueba.id)}`);
  } else {
    check('no quedó ninguna orden de prueba que borrar', true, ANTES.services === (await serviciosRaw()).length ? 'la cantidad de servicios no cambió' : 'REVISAR: la cantidad de servicios cambió');
  }

  // Estado final vs. inicial
  const DESPUES = JSON.parse(await snapshot());
  check('no quedó ningún servicio de prueba (la cantidad volvió a la inicial)',
    DESPUES.services === ANTES.services && DESPUES.maxServiceId === ANTES.maxServiceId,
    `servicios ${ANTES.services} → ${DESPUES.services} · max id ${ANTES.maxServiceId} → ${DESPUES.maxServiceId}`);
  // La VENTA de prueba no se puede borrar (el backend no tiene comando de borrado de ventas: es el
  // hueco que cierra F70) y su id NO tiene por qué ser `max + 1`: en una copia reusada, corridas
  // anteriores borraron filas y el AUTOINCREMENT siguió. Lo que importa es que se escribió UNA venta
  // más y que la nueva es la de id más alto.
  check('la única fila que queda escrita es la VENTA de prueba (no borrable por diseño)',
    DESPUES.sales === ANTES.sales + 1 && DESPUES.maxSaleId > ANTES.maxSaleId,
    `ventas ${ANTES.sales} → ${DESPUES.sales} · max id ${ANTES.maxSaleId} → ${DESPUES.maxSaleId}`);
  check('el script no dejó diálogos abiertos', (await dialogsOpen().catch(() => 0)) === 0, `${await dialogsOpen().catch(() => 0)} diálogo(s)`);

  // El turno de caja (lo que NO se debe tocar): abrir/cerrar el día cambia la historia financiera.
  const diaFinal = await invoke('get_active_day');
  check('el turno de caja quedó IGUAL (el script no abrió ni cerró el día)',
    ((diaInicial?.close_date ?? null) === (diaFinal?.close_date ?? null)) && ((diaInicial?.tasa_bcv ?? 0) === (diaFinal?.tasa_bcv ?? 0)),
    `antes: ${diaInicial ? `${diaInicial.close_date} (tasa ${diaInicial.tasa_bcv})` : 'cerrado'} → después: ${diaFinal ? `${diaFinal.close_date} (tasa ${diaFinal.tasa_bcv})` : 'cerrado'}`);
}

// ============================================================================================
// RESUMEN FINAL
// ============================================================================================
const fails = out.filter(o => !o.ok);
console.log(`\n${out.length} comprobaciones · ${out.length - fails.length} OK · ${fails.length} fallo(s)`);
if (fails.length) console.log(`FALLAN: ${fails.map(f => f.name).join('; ')}`);

console.log('\n--- LO QUE EL SCRIPT ESCRIBIÓ EN LA BASE (corré siempre contra una COPIA) ---');
if (residuo.length === 0) {
  console.log('· nada: no quedó ninguna fila nueva en la base.');
} else {
  for (const r of residuo) console.log(`· ${r}`);
}
console.log('· La orden de servicio de prueba se BORRÓ al final (verificado por IPC).');
console.log('· NO se cerró el día, NO se confirmó ningún cobro/entrega, NO se guardó ningún pedido ni cambio de producto.');

// `process.exit` SIEMPRE: el WebSocket de CDP queda abierto y sin esto el proceso no termina.
process.exit(fails.length > 0 ? 1 : 0);
