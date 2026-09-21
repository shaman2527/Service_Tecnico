// VERIFICACIÓN EN VIVO (CDP) de F56 — «RESUMEN DEL DÍA».
//
// Pedido del dueño (2026-09-21, con captura de la pantalla): «el cliente me pregunta quiero ver en
// mis servicios cuántas pantallas hice hoy, o cuántos equipos recibí hoy, cuántos entregué hoy… se
// clasifique bien pero no así como la foto, que se ve abrumador con ese poco de types». El problema
// de fondo: los contadores de la pantalla miraban TODO EL HISTORIAL (603 equipos en su captura) y
// responder al cliente exigía armar los filtros a mano.
//
// Qué comprueba sobre la app REAL (con la verdad independiente leída de la BASE, no de la UI):
//   1. El panel «Resumen del día» existe y dice SIEMPRE su alcance (estado de fecha y rango).
//   2. Recibidos / Entregados / En taller / Listos coinciden con lo que dice la base — contando
//      «recibido» por fecha de RECIBO y «entregado» por fecha de ENTREGA (los dos ejes).
//   3. El número del resumen NO se mueve cuando el operario filtra la lista: es su propio alcance.
//   4. El desglose por trabajo dice cuántas PANTALLAS (y cualquier otro trabajo) se hicieron hoy.
//   5. Tocar un trabajo del desglose trae ESAS tarjetas a la lista, con el mismo número (el
//      invariante de F44: el número del chip == las tarjetas == el KPI).
//   6. Los atajos de alcance (Hoy / 7 días / Este mes / Los filtros) cambian el rango y los números.
//   7. Un alcance sin equipos lo DICE (no muestra un 0 mudo por todos lados).
//   8. El resumen no es un muro de chips: a lo sumo 5 trabajos por eje.
//
// SEGURIDAD DE DATOS: es de SOLO LECTURA sobre la base (no crea ni borra órdenes). Al final deja la
// lista limpia (sin filtros) para no ensuciar el estado del operario.
//
// Uso:
//   $env:REGISTRO_DB="C:\...\registro\backup\f56_fixture.db"
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//   npx tauri dev
//   (en otra consola)  node tools/verify_resumen_dia.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

// ── 0) GATE DE DATOS: la copia es obligatoria (la verdad independiente sale de ahí) ──────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  console.error('  Ej.: node tools/seed_work_labels_fixture.mjs --force  y arrancar con $env:REGISTRO_DB a esa copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare('SELECT status, date_in, date_out, service_type, service_types, amount FROM services').all();

// Mismas reglas que `src/lib/service-report.ts` (copiadas a mano y FIJADAS por las comprobaciones:
// si divergen, esta prueba falla — es el gate de que la pantalla y la base hablan del mismo día).
// OJO con el plegado: `normPhoneModel` reemplaza lo no-alfanumérico por UN ESPACIO (no lo borra),
// así que la clave de «Cambio pantalla» es `cambio pantalla`, con espacio — igual que el literal
// que usan los chips (`data-work-chip="cambio pantalla"`).
const dia = (v) => (v ? String(v).slice(0, 10) : '');
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const CLAVE_PANTALLA = 'cambio pantalla';
const tipos = (r) => {
  let a = [];
  try { const p = JSON.parse(r.service_types ?? '[]'); if (Array.isArray(p)) a = p; } catch { /* fallback */ }
  if (!a.length && r.service_type) a = [r.service_type];
  return [...new Set(a.map(fold).filter(Boolean))];
};
const now = new Date();
const hoy = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const FINALES = ['Entregado', 'Devuelto', 'Cancelado', 'Cancelado / Devuelto'];
const enRango = (v, a, b) => { const d = dia(v); return !!d && (!a || d >= a) && (!b || d <= b); };
const cuenta = (a, b) => ({
  recibidos: rows.filter(r => enRango(r.date_in, a, b)).length,
  entregados: rows.filter(r => enRango(r.date_out, a, b)).length,
});
const trabajoEnRango = (eje, key, a, b) => rows.filter(r => enRango(eje === 'in' ? r.date_in : r.date_out, a, b) && tipos(r).includes(key)).length;

const base = {
  recibidosHoy: cuenta(hoy, hoy).recibidos,
  entregadosHoy: cuenta(hoy, hoy).entregados,
  taller: rows.filter(r => !FINALES.includes(String(r.status))).length,
  listos: rows.filter(r => r.status === 'Por entregar').length,
  pantallasRecibidasHoy: trabajoEnRango('in', CLAVE_PANTALLA, hoy, hoy),
  pantallasEntregadasHoy: trabajoEnRango('out', CLAVE_PANTALLA, hoy, hoy),
};
const r7 = cuenta(addDays(hoy, -6), hoy);
const rMes = cuenta(`${hoy.slice(0, 7)}-01`, hoy);
console.log(`· copia: ${dbPath}`);
console.log(`· base (verdad independiente): ${rows.length} órdenes · hoy ${hoy} → ${base.recibidosHoy} recibidos · ${base.entregadosHoy} entregados · taller ${base.taller} · listos ${base.listos}`);
console.log(`· pantallas de hoy: ${base.pantallasRecibidasHoy} recibidas · ${base.pantallasEntregadasHoy} entregadas`);

// ── helpers de UI ───────────────────────────────────────────────────────────────────────────────
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const irA = async (nombre) => {
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith(${JSON.stringify(nombre)}))`);
  await sleep(1800);
};
const tile = (id) => evalx(`(() => { const e = document.querySelector('[data-resumen="${id}"]'); return e ? Number(e.getAttribute('data-resumen-count')) : null; })()`);
const desglose = (eje, key) => evalx(`(() => { const e = document.querySelector('[data-resumen-desglose="${eje}"] [data-resumen-work="${key}"]'); return e ? Number(e.getAttribute('data-resumen-work-count')) : null; })()`);
const alcanceResumen = () => evalx(`document.querySelector('[data-resumen-scope]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
const equiposKpi = async () => Number(await evalx(`document.querySelector('[data-kpi="equipos"]')?.innerText.trim() ?? 'NaN'`));
// F57: el filtro de trabajos es un SELECTOR con buscador — para leer la cantidad de un trabajo hay
// que abrirlo (y buscar), igual que lo hace el operario.
const abrirTrabajos = async () => {
  await clickCenter(`document.querySelector('[data-work-picker]')`);
  return waitFor(`!!document.querySelector('[data-work-menu]')`, 8000);
};
const cerrarTrabajos = async () => {
  if (await evalx(`!!document.querySelector('[data-work-menu]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(400); }
};
const contarTrabajo = async (key, texto = '') => {
  if (!(await abrirTrabajos())) return null;
  if (texto) {
    await evalx(`(() => {
      const i = document.querySelector('[data-work-search]');
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(i, ${JSON.stringify(texto)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
  }
  const v = await evalx(`(() => { const b = document.querySelector('[data-work-chip="${key}"]'); return b ? Number(b.getAttribute('data-work-count')) : null; })()`);
  await cerrarTrabajos();
  return v;
};
const fechas = () => evalx(`[...document.querySelectorAll('input[type="date"]')].map(i => i.value)`);
const ejes = () => evalx(`[...document.querySelectorAll('button')].filter(b => /^(Recibidos|Entregados)$/.test(b.innerText.trim())).map(b => ({ t: b.innerText.trim(), on: b.getAttribute('data-state') }))`);
const setFecha = async (i, valor) => evalx(`(() => {
  const inp = [...document.querySelectorAll('input[type="date"]')][${i}];
  if (!inp) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, ${JSON.stringify(valor)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
const alcance = async (kind) => { await clickCenter(`document.querySelector('[data-resumen-kind="${kind}"]')`); await sleep(1200); };

// ── desbloqueo del PIN (el gate es fail-closed) ────────────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  for (const ch of '1234') {
    await evalx(`(() => {
      const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]');
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, i.value + '${ch}');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await sleep(500);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

await irA('Servicio Técnico');
const hayPanel = await waitFor(`!!document.querySelector('[data-panel="resumen-dia"]')`, 15000);
check('F56: la pantalla de Servicios tiene el panel «Resumen del día»', hayPanel);
if (!hayPanel) { console.error('Sin panel no se puede seguir.'); process.exit(1); }
await sleep(1200);

// ── 1) el alcance se dice SIEMPRE (sin eso el número no se puede defender) ─────────────────────
const l1 = String(await alcanceResumen() ?? '');
check('F56: el resumen dice su alcance con la fecha de HOY', l1.includes(`Hoy (${hoy})`), l1);
check('F56: y dice los DOS ejes (recibo y entrega), no uno solo',
  /recibidos por fecha de recibo/.test(l1) && /entregados por fecha de entrega/.test(l1), l1);

// ── 2) los cuatro números contra la BASE ──────────────────────────────────────────────────────
check('F56: «Recibidos» cuenta los equipos recibidos hoy (por fecha de recibo)', await tile('recibidos') === base.recibidosHoy,
  `pantalla ${await tile('recibidos')} · base ${base.recibidosHoy}`);
check('F56: «Entregados» cuenta los entregados hoy (por fecha de ENTREGA, no de recibo)', await tile('entregados') === base.entregadosHoy,
  `pantalla ${await tile('entregados')} · base ${base.entregadosHoy}`);
check('F56: «En taller» cuenta todo el taller abierto', await tile('taller') === base.taller, `pantalla ${await tile('taller')} · base ${base.taller}`);
check('F56: «Listos para entregar» cuenta los que están en «Por entregar»', await tile('listos') === base.listos, `pantalla ${await tile('listos')} · base ${base.listos}`);
check('F56: el KPI «Entregados hoy» es UNO solo (el del resumen) y dice el número del día',
  await evalx(`document.querySelectorAll('[data-kpi="entregados-hoy"]').length`) === 1);

// ── 3) el desglose por trabajo: «¿cuántas pantallas hice hoy?» ─────────────────────────────────
const pantRec = await desglose('in', CLAVE_PANTALLA);
const pantEnt = await desglose('out', CLAVE_PANTALLA);
check('F56: el desglose dice cuántas PANTALLAS se recibieron hoy', pantRec === base.pantallasRecibidasHoy,
  `pantalla ${pantRec} · base ${base.pantallasRecibidasHoy}`);
check('F56: y cuántas se ENTREGARON hoy', pantEnt === base.pantallasEntregadasHoy,
  `pantalla ${pantEnt} · base ${base.pantallasEntregadasHoy}`);
check('F56: el resumen NO es un muro de chips (a lo sumo 5 trabajos por eje)',
  Number(await evalx(`document.querySelectorAll('[data-resumen-work]').length`)) <= 10,
  `trabajos listados: ${await evalx(`document.querySelectorAll('[data-resumen-work]').length`)}`);

// ── 4) un toque y las tarjetas de esas pantallas aparecen en la lista ───────────────────────────
await clickCenter(`document.querySelector('[data-resumen-desglose="in"] [data-resumen-work="${CLAVE_PANTALLA}"]')`);
await sleep(2600);
check('F56: al tocar «pantallas recibidas hoy» la lista queda en el rango de HOY',
  JSON.stringify(await fechas()) === JSON.stringify([hoy, hoy]), JSON.stringify(await fechas()));
check('F56: y en el eje de RECIBO', (await ejes()).some(e => e.t === 'Recibidos' && e.on === 'on'));
const kpiTras = await equiposKpi();
const selectorTras = await contarTrabajo(CLAVE_PANTALLA, 'pantalla');
check('F56: la lista muestra exactamente esas pantallas (el número del desglose == las tarjetas == el KPI == el selector)',
  kpiTras === base.pantallasRecibidasHoy && selectorTras === base.pantallasRecibidasHoy,
  `KPI ${kpiTras} · selector ${selectorTras} · desglose ${base.pantallasRecibidasHoy}`);

// ── 5) el resumen tiene su PROPIO alcance: los filtros de la lista no lo mueven ────────────────
await setFecha(0, '2020-01-01');
await setFecha(1, '2020-01-02');
await sleep(2600);
const filtradaVacia = await equiposKpi();
check('F56: con la lista filtrada a un rango sin equipos, el resumen sigue diciendo HOY',
  filtradaVacia === 0 && await tile('recibidos') === base.recibidosHoy,
  `lista ${filtradaVacia} · recibidos del resumen ${await tile('recibidos')} (base ${base.recibidosHoy})`);

// ── 6) «Los filtros»: el resumen adopta el rango de la lista y EXPLICA el vacío ────────────────
await alcance('filtros');
const lVacio = String(await alcanceResumen() ?? '');
check('F56: con «Los filtros» el alcance dice el rango de la lista', /Del 2020-01-01 al 2020-01-02/.test(lVacio), lVacio);
check('F56: un alcance sin equipos lo DICE en vez de mostrar ceros mudos',
  await tile('recibidos') === 0 && /Todavía no se recibió ningún equipo hoy|Sin equipos en este alcance/.test(
    String(await evalx(`document.querySelector('[data-resumen-vacio="in"]')?.innerText ?? ''`))),
  String(await evalx(`document.querySelector('[data-resumen-vacio="in"]')?.innerText ?? null`)));

// ── 7) los atajos de alcance cambian el rango y los números ───────────────────────────────────
await evalx(`(() => { const b = document.querySelector('[data-action="limpiar-filtros"]'); if (b) b.click(); return true; })()`);
await sleep(2400);
await alcance('7d');
const l7 = String(await alcanceResumen() ?? '');
check('F56: «7 días» incluye hoy y los 6 anteriores', l7.includes(`Del ${addDays(hoy, -6)} al ${hoy}`), l7);
check('F56: y el número de recibidos es el de esos 7 días', await tile('recibidos') === r7.recibidos,
  `pantalla ${await tile('recibidos')} · base ${r7.recibidos}`);
check('F56: y el de entregados, por su propio eje', await tile('entregados') === r7.entregados,
  `pantalla ${await tile('entregados')} · base ${r7.entregados}`);
await alcance('mes');
check('F56: «Este mes» va del día 1 a hoy', await tile('recibidos') === rMes.recibidos && await tile('entregados') === rMes.entregados,
  `pantalla ${await tile('recibidos')}/${await tile('entregados')} · base ${rMes.recibidos}/${rMes.entregados}`);
await alcance('hoy');
check('F56: volver a «Hoy» deja los números del día', await tile('recibidos') === base.recibidosHoy && await tile('entregados') === base.entregadosHoy);

// ── 8) el tile de entregados lleva a la lista de entregados de hoy ─────────────────────────────
await clickCenter(`document.querySelector('[data-resumen="entregados"]')`);
await sleep(2600);
check('F56: tocar «Entregados» deja la lista en el eje de ENTREGA de hoy',
  (await ejes()).some(e => e.t === 'Entregados' && e.on === 'on') && JSON.stringify(await fechas()) === JSON.stringify([hoy, hoy]),
  JSON.stringify(await fechas()));
const tileEntrega = await tile('entregados');
check('F56: y el resumen sigue diciendo el número del día (no el que quedó filtrado en la lista)',
  tileEntrega === base.entregadosHoy, `pantalla ${tileEntrega} · base ${base.entregadosHoy}`);

// limpieza: estado neutro para el operario
await evalx(`(() => { const b = document.querySelector('[data-action="limpiar-filtros"]'); if (b) b.click(); return true; })()`);
await sleep(1500);

const fallas = out.filter(o => !o.ok).length;
console.log(`\nverify_resumen_dia: ${out.length - fallas}/${out.length} OK${fallas ? ` — ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
