// VERIFICACIÓN EN VIVO (CDP) de F72 — EL ENCABEZADO DEL LIBRO DIARIO EN SUBCATEGORÍAS.
//
// Pedido del dueño (2026-09-23): «arregla toda esta pestaña… está muy larga». El encabezado tenía
// NUEVE botones iguales en una sola fila (Exportar Excel · PIN · Diario · Cierres · Pagos · Gastos ·
// Salud · Movimientos · Personas) y no se distinguía una PESTAÑA de una ACCIÓN.
//
// Lo que comprueba esta verificación, contra la app REAL (Tauri 2 + React 19 + SQLite):
//   1. El encabezado quedó en DOS niveles: acciones arriba (junto al título) y secciones abajo.
//   2. Las SECCIONES están agrupadas en 3 SUBCATEGORÍAS rotuladas (Caja del día · Plata · Control),
//      con las 6 pestañas de siempre y sus rótulos EXACTOS.
//   3. YA NO SE DESBORDA: ningún botón del encabezado sale del ancho de la ventana y el documento no
//      tiene scroll horizontal (era la queja literal: «está muy larga»).
//   4. Cada pestaña ABRE SU CONTENIDO y el encabezado dice dónde estás («Caja del día → Diario»).
//   5. La CAJA ve DOS pestañas (Diario y Movimientos) y nada del dueño: ni Gastos, ni Salud, ni
//      Cierres, ni Pagos, ni Personas, ni Exportar Excel, ni grupos vacíos con rótulo huérfano.
//
// SEGURIDAD DE DATOS: no escribe NADA (sólo navega y lee la pantalla), pero corre SIEMPRE contra una
// COPIA (`REGISTRO_DB`) como el resto de las verificaciones del proyecto.
//
// Uso:  $env:REGISTRO_DB="C:\Users\ROBER\registro\backup\f71_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       app de dev abierta  →  node tools/verify_libro_diario_nav.mjs

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

let checks = 0;
const fallos = [];
const check = (que, cond, detalle = '') => {
  checks++;
  console.log(`${cond ? 'OK  ' : 'FALLA'} · ${que}${detalle ? ` — ${detalle}` : ''}`);
  if (!cond) fallos.push(que);
};

const waitFor = async (expr, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) GATE: la copia de la base (la verdad independiente) ─────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: apuntá REGISTRO_DB a una COPIA, nunca a la base real del local.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql) => { try { return db.prepare(sql).get() ?? {}; } catch (e) { return { err: String(e.message) }; } };
const users = (() => { try { return db.prepare('SELECT name, role FROM users').all(); } catch { return []; } })();
const hayCaja = users.some(u => u.role === 'caja');
console.log(`· copia: ${dbPath}`);
console.log(`· personas: ${users.map(u => `${u.name} (${u.role})`).join(' · ') || 'sin tabla de personas'}`);

// ── helpers de sesión y de navegación (mismos que verify_arqueo_f69 / verify_sesiones_caja) ────
const irALaLista = async () => {
  for (let i = 0; i < 5; i++) {
    if (await evalx(`!!document.querySelector('[data-user-picker]')`)) return true;
    await evalx(`(() => { const b = document.querySelector('[data-action="bloquear-sesion"]'); if (b) b.click(); return !!b; })()`);
    await sleep(900);
    await evalx(`(() => { const b = document.querySelector('[data-action="cambiar-persona"]'); if (b) b.click(); return !!b; })()`);
    await sleep(700);
  }
  return await waitFor(`!!document.querySelector('[data-user-picker]')`, 8000);
};

const entrar = async (name, pin) => {
  await irALaLista();
  const id = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-user-option]')].find(x => (x.innerText || '').includes(${JSON.stringify(name)}));
    return b ? Number(b.getAttribute('data-user-option')) : null;
  })()`);
  if (id == null) return false;
  await clickCenter(`document.querySelector('[data-user-option="${id}"]')`);
  await sleep(700);
  if (!await waitFor(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`, 6000)) return false;
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText(pin);
  await keyNav('Enter', 'Enter', 13);
  return await waitFor(`!!document.querySelector('aside')`, 15000);
};

/** Abre Libro Diario. Espera una pestaña PROPIA del módulo («Diario» también está en la barra
 *  lateral, así que esperar por el texto devolvía antes de que el módulo (carga diferida) montara). */
const irAlLibro = async () => {
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Libro Diario/i.test(x.innerText || x.getAttribute('title') || '')); if (b) b.click(); return !!b; })()`);
  return await waitFor(`!!document.querySelector('[data-nav-group]')`, 12000);
};

/** Lo que el encabezado pinta: los grupos con su rótulo y sus pestañas, las acciones y las medidas. */
const leerEncabezado = async () => JSON.parse(await evalx(`(() => {
  const grupos = [...document.querySelectorAll('[data-nav-group]')].map(g => ({
    id: g.getAttribute('data-nav-group'),
    label: (g.querySelector('span[title^="Subcategoría"]') || {}).innerText?.trim() ?? null,
    tabs: [...g.querySelectorAll('button')].map(b => ({
      label: (b.innerText || '').trim(),
      tab: b.getAttribute('data-tab'),
      title: b.getAttribute('title'),
      activa: b.getAttribute('aria-current') === 'page',
      rect: (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left), h: Math.round(r.height) }; })(),
    })),
  }));
  const acciones = [...document.querySelectorAll('[data-actions="libro-diario"] button')].map(b => ({
    label: (b.innerText || '').trim(),
    action: b.getAttribute('data-action'),
    title: b.getAttribute('title'),
    rect: (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), h: Math.round(r.height) }; })(),
  }));
  const nav = document.querySelector('nav[aria-label="Secciones del Libro Diario"]');
  const h1 = document.querySelector('main h1');
  const sub = h1 ? h1.parentElement.querySelector('p') : null;
  const rNav = nav ? nav.getBoundingClientRect() : null;
  return JSON.stringify({
    grupos, acciones,
    h1: (h1 || {}).innerText ?? null,
    subtitulo: sub ? sub.innerText.replace(/\\s+/g, ' ').trim() : null,
    navRect: rNav ? { y: Math.round(rNav.y), h: Math.round(rNav.height), w: Math.round(rNav.width), right: Math.round(rNav.right) } : null,
    accionesY: acciones.length ? acciones[0].rect.y : null,
    ancho: window.innerWidth, alto: window.innerHeight,
    scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    mainScrollX: (() => { const m = document.querySelector('main'); return m ? m.scrollWidth > m.clientWidth + 1 : false; })(),
  });
})()`));

/** Un clic en una pestaña y la espera de SU contenido (nunca un sleep a ojo). */
const abrirPestana = async (tab, esperando, timeout = 12000) => {
  const hay = await evalx(`!!document.querySelector('[data-tab="${tab}"]')`);
  if (!hay) return false;
  await clickCenter(`document.querySelector('[data-tab="${tab}"]')`);
  return await waitFor(esperando, timeout);
};

/** El contenido característico de cada sección (lo que el smoke integral ya distingue). */
const CONTENIDO = {
  diario: `(() => { const m = document.querySelector('main'); return /Resumen del día/.test(m.innerText) || [...m.querySelectorAll('table thead th')].some(h => /Tasa BCV/.test(h.innerText)); })()`,
  cierres: `[...document.querySelectorAll('main table thead th')].some(h => /Diferencia Bs\\./.test(h.innerText))`,
  pagos: `!!document.querySelector('input[placeholder="Nº referencia..."]')`,
  gastos: `[...document.querySelectorAll('button')].some(b => (b.innerText || '').trim() === 'Registrar gasto')`,
  // OJO con las mayúsculas: varias etiquetas se pintan con la clase CSS `uppercase` (los Kpi de
  // «Salud» y los rótulos de subcategoría), así que el `innerText` devuelve «UTILIDAD BRUTA». Los
  // regex van con `/i` (el smoke integral usa `/Ingresos del per[ií]odo/i` por lo mismo).
  salud: `(() => { const t = document.querySelector('main').innerText; return /Utilidad bruta/i.test(t) && /Por cobrar a clientes/i.test(t); })()`,
  movimientos: `(() => { const m = document.querySelector('main'); return /Movimientos \\(\\d+\\)/.test(m.innerText) && [...m.querySelectorAll('table thead th')].some(h => /Quién/.test(h.innerText)); })()`,
};

// ── 1) EL DUEÑO: encabezado en dos niveles, subcategorías y rótulos ────────────────────────────
const ESPERADAS = ['Diario', 'Cierres', 'Pagos', 'Gastos', 'Movimientos', 'Salud'];
const GRUPOS = ['Caja del día', 'Plata', 'Control'];
/** Los rótulos de subcategoría se pintan en MAYÚSCULAS por CSS (`uppercase`), así que el `innerText`
 *  devuelve «CAJA DEL DÍA» aunque en el código diga «Caja del día»: se comparan sin distinguir caja. */
const igual = (a, b) => String(a ?? '').toLocaleLowerCase('es') === String(b ?? '').toLocaleLowerCase('es');

{
  await evalx(`location.reload(); 'recargando'`).catch(() => {});
  await sleep(2500);
  check('F72: el Master entra (sobre la copia)', await entrar('Master', '1234'));
  check('F72: abre el Libro Diario', await irAlLibro());
  await sleep(1500);

  const e = await leerEncabezado();
  check('F72: la pantalla sigue siendo el Libro Diario', e.h1 === 'Libro Diario', String(e.h1));

  // 1) dos niveles: acciones arriba, secciones abajo
  check('F72: las ACCIONES del dueño están (Exportar Excel · PIN · IVA · Personas)',
    e.acciones.map(a => a.label).join(' | ') === 'Exportar Excel | PIN | IVA | Personas',
    e.acciones.map(a => a.label).join(' | '));
  check('F72: las acciones NO comparten fila con las pestañas (el encabezado tiene 2 niveles)',
    e.accionesY != null && e.navRect != null && e.accionesY < e.navRect.y,
    `acciones y=${e.accionesY} · nav y=${e.navRect?.y}`);
  check('F72: «Personas» conserva su gancho (data-action="personas")',
    e.acciones.some(a => a.action === 'personas'));

  // 2) subcategorías con su rótulo, en orden
  check('F72: las 3 SUBCATEGORÍAS con su rótulo y en orden',
    e.grupos.length === GRUPOS.length && e.grupos.every((g, i) => igual(g.label, GRUPOS[i])),
    e.grupos.map(g => g.label).join(' | '));
  check('F72: cada subcategoría tiene su grupito de 2 pestañas',
    e.grupos.every(g => g.tabs.length === 2), e.grupos.map(g => `${g.label}:${g.tabs.length}`).join(' · '));
  check('F72: las 6 pestañas de siempre, con sus rótulos EXACTOS',
    e.grupos.flatMap(g => g.tabs.map(t => t.label)).join(' | ') === ESPERADAS.join(' | '),
    e.grupos.flatMap(g => g.tabs.map(t => t.label)).join(' | '));
  check('F72: cada pestaña lleva su data-tab y su explicación (title)',
    e.grupos.flatMap(g => g.tabs).every(t => t.tab && (t.title || '').length > 20),
    JSON.stringify(e.grupos.flatMap(g => g.tabs).filter(t => !t.tab || (t.title || '').length <= 20).map(t => t.label)));

  // 3) YA NO SE DESBORRA (la queja literal del dueño)
  const tabsTodas = e.grupos.flatMap(g => g.tabs);
  const fueraVentana = [...e.acciones, ...tabsTodas].filter(b => b.rect.right > e.ancho + 1 || b.rect.left < -1);
  const fueraNav = tabsTodas.filter(t => t.rect.right > e.navRect.right + 1);
  check('F72: ningún botón del encabezado se sale del ancho de la ventana',
    fueraVentana.length === 0, `ancho=${e.ancho} · fuera: ${fueraVentana.map(b => b.label).join(', ')}`);
  check('F72: ninguna pestaña se sale de la barra de secciones',
    fueraNav.length === 0, fueraNav.map(t => t.label).join(', '));
  check('F72: el documento NO tiene scroll horizontal (el encabezado ya no estira la pantalla)',
    e.scrollX === false, `scrollX=${e.scrollX}`);
  check('F72: la lista de pestañas no estira su contenedor',
    e.mainScrollX === false, `mainScrollX=${e.mainScrollX}`);
  check('F72: las pestañas entran en UNA fila (no se apilan una por línea)',
    new Set(tabsTodas.map(t => t.rect.y)).size === 1,
    [...new Set(tabsTodas.map(t => t.rect.y))].join(' / '));
  const anchoPestanas = Math.max(...tabsTodas.map(t => t.rect.right)) - Math.min(...tabsTodas.map(t => t.rect.left));
  check('F72: las 6 pestañas + 3 rótulos entran con aire en el ancho de la pantalla',
    anchoPestanas < e.ancho * 0.92, `${anchoPestanas} px de ${e.ancho} px`);
  console.log(`· medidas: ventana ${e.ancho}×${e.alto} · fila de pestañas ${anchoPestanas} px · nav ${e.navRect?.w} px · alto nav ${e.navRect?.h} px`);

  // 5) que se VEA bien, no sólo que exista: etiquetas enteras, separadores entre subcategorías y la
  //    pestaña activa pintada distinto (esto reemplaza al «mirá la captura»: se mide en el DOM).
  const pintura = JSON.parse(await evalx(`(() => {
    const nav = document.querySelector('nav[aria-label="Secciones del Libro Diario"]');
    const botones = [...nav.querySelectorAll('button')];
    const activo = botones.find(b => b.getAttribute('aria-current') === 'page');
    const inactivo = botones.find(b => b.getAttribute('aria-current') !== 'page');
    const rotulos = [...nav.querySelectorAll('span[title^="Subcategoría"]')];
    return JSON.stringify({
      cortados: botones.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => (b.innerText || '').trim()),
      rotulosCortados: rotulos.filter(s => s.scrollWidth > s.clientWidth + 1).map(s => (s.innerText || '').trim()),
      separadores: nav.querySelectorAll('span[aria-hidden]').length,
      altoPestana: activo ? Math.round(activo.getBoundingClientRect().height) : null,
      activoBg: activo ? getComputedStyle(activo).backgroundColor : null,
      inactivoBg: inactivo ? getComputedStyle(inactivo).backgroundColor : null,
      contenedorBg: getComputedStyle(nav).backgroundColor,
    });
  })()`));
  check('F72: ningún rótulo se corta (las etiquetas entran enteras)',
    pintura.cortados.length === 0 && pintura.rotulosCortados.length === 0,
    [...pintura.cortados, ...pintura.rotulosCortados].join(', '));
  check('F72: hay un separador entre cada par de subcategorías (3 grupos → 2 separadores)',
    pintura.separadores === e.grupos.length - 1, `${pintura.separadores} separadores · ${e.grupos.length} grupos`);
  check('F72: la pestaña activa se pinta distinto de las inactivas',
    pintura.activoBg && pintura.inactivoBg && pintura.activoBg !== pintura.inactivoBg,
    `activa=${pintura.activoBg} · inactiva=${pintura.inactivoBg} · barra=${pintura.contenedorBg}`);
  check('F72: la barra de secciones queda compacta (una sola fila de 46 px de alto)',
    (e.navRect?.h ?? 0) <= 56, `${e.navRect?.h} px`);

  // 4) cada pestaña abre SU contenido y el encabezado dice dónde estás
  for (const tab of ['diario', 'cierres', 'pagos', 'gastos', 'salud', 'movimientos']) {
    // «Salud» consulta la utilidad del período (`getProfitSummary`, pesada): se le da más aire.
    const abrio = await abrirPestana(tab, CONTENIDO[tab], tab === 'salud' ? 30000 : 12000);
    const estado = await leerEncabezado();
    const activas = estado.grupos.flatMap(g => g.tabs).filter(t => t.activa);
    const grupoDeTab = estado.grupos.find(g => g.tabs.some(t => t.tab === tab));
    check(`F72: la pestaña «${tab}» abre su contenido`, abrio);
    check(`F72: «${tab}» queda marcada como la activa (y sólo esa)`,
      activas.length === 1 && activas[0].tab === tab, activas.map(t => t.tab).join(', '));
    check(`F72: el subtítulo dice dónde estás (${grupoDeTab?.label} → ${activas[0]?.label ?? ''})`,
      igual(estado.subtitulo, `Control financiero y cierre diario · estás en ${grupoDeTab?.label} → ${activas[0]?.label ?? ''}`),
      String(estado.subtitulo));
  }
  await abrirPestana('diario', CONTENIDO.diario);
}

// ── 2) LA CAJA: dos pestañas, nada del dueño, sin rótulos huérfanos ────────────────────────────
{
  if (!hayCaja) {
    check('F72: la copia trae una persona de CAJA para probar sus accesos (se omite)', true, 'sin persona de caja');
  } else {
    const entro = await entrar('Caja 1', '2468');
    check('F72: la caja entra con SU PIN', entro);
    check('F72: la caja llega al Libro Diario', await irAlLibro());
    await sleep(1200);

    const c = await leerEncabezado();
    const tabs = c.grupos.flatMap(g => g.tabs.map(t => t.label));
    check('F72: la caja ve 2 pestañas: Diario y Movimientos',
      tabs.join(' | ') === 'Diario | Movimientos', tabs.join(' | '));
    check('F72: la caja NO ve Cierres, Pagos, Gastos ni Salud',
      !['Cierres', 'Pagos', 'Gastos', 'Salud'].some(t => tabs.includes(t)), tabs.join(' | '));
    check('F72: la caja NO ve ninguna acción del dueño (ni Exportar Excel, ni PIN, ni Personas)',
      c.acciones.length === 0, JSON.stringify(c.acciones.map(a => a.label)));
    check('F72: la caja no ve el gancho de Personas en el encabezado',
      !(await evalx(`!!document.querySelector('[data-actions="libro-diario"] [data-action="personas"]')`)));
    // Sin rótulos huérfanos: cada subcategoría que se dibuja tiene sus pestañas.
    check('F72: a la caja no le quedan subcategorías vacías (rótulo sin pestañas)',
      c.grupos.length > 0 && c.grupos.every(g => g.label && g.tabs.length > 0),
      c.grupos.map(g => `${g.label}:${g.tabs.length}`).join(' · '));
    check('F72: las pestañas de la caja también entran en el ancho de la ventana',
      c.grupos.flatMap(g => g.tabs).every(t => t.rect.right <= c.ancho + 1 && t.rect.left >= -1),
      `ancho=${c.ancho}`);
    check('F72: la caja SÍ puede abrir su libro de movimientos',
      await abrirPestana('movimientos', CONTENIDO.movimientos));
    check('F72: el subtítulo de la caja dice dónde está',
      ((await leerEncabezado()).subtitulo || '').includes('→ Movimientos'),
      String((await leerEncabezado()).subtitulo));
  }

  // Dejar la app como estaba: sesión del dueño en el Diario.
  await entrar('Master', '1234');
  await irAlLibro();
  await abrirPestana('diario', CONTENIDO.diario);
}

console.log(`\nverify_libro_diario_nav: ${checks - fallos.length}/${checks} OK${fallos.length ? ` — ${fallos.length} FALLAN` : ''}`);
if (fallos.length) { console.log(fallos.map(f => `  · ${f}`).join('\n')); process.exit(1); }
