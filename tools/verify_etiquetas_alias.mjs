// VERIFICACIÓN EN VIVO (CDP) de **F58 y F59** — etiquetas limpias.
//
// F58 (pedido del dueño, 2026-09-21): «se clasifique bien». En su base real «Cambio batería» (27) +
// «bateria» (2) + «REPARACIÓN DE BATTERIA» (1) son EL MISMO trabajo: sin unirlos, el dueño no puede
// decirle al cliente «cambié 30 baterías» sin sumar a mano. La tabla de equivalencias es EXPLÍCITA
// (`src/lib/work-aliases.ts`) y se aplica al contar Y al filtrar — nunca por parecido.
//
// F59: «garantía» (8) y «VENTA» (3) no son trabajos hechos: se ven y se pueden filtrar, pero no
// cuentan como trabajo del taller ni entran en el desglose del resumen.
//
// Qué comprueba sobre la app REAL (la verdad de los números sale de la BASE, no de la pantalla):
//   1. el trabajo canónico cuenta TODAS sus formas (canónica + sinónimos aprobados);
//   2. las etiquetas viejas YA NO aparecen como categorías sueltas en el selector;
//   3. filtrar por el trabajo canónico devuelve exactamente ese número (el invariante de F44);
//   4. lo que NO está aprobado sigue SEPARADO («flex power» no se une a «Cambio flex»);
//   5. garantía/venta viven en su propio grupo («No es un trabajo») y el resumen los informa aparte;
//   6. el resumen NO los cuenta como trabajos hechos.
//
// SOLO LECTURA sobre la base (no crea ni borra órdenes).
//
// Uso:  $env:REGISTRO_DB="...\backup\f56_fixture.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       npx tauri dev      (y en otra consola)   node tools/verify_etiquetas_alias.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { WORK_ALIASES, foldWork, NO_ES_TRABAJO } from '../src/lib/work-aliases.ts';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare('SELECT status, date_in, service_type, service_types FROM services').all();
const tipos = (r) => {
  let a = [];
  try { const p = JSON.parse(r.service_types ?? '[]'); if (Array.isArray(p)) a = p; } catch { /* fallback */ }
  if (!a.length && r.service_type) a = [r.service_type];
  return [...new Set(a.map(foldWork).filter(Boolean))];
};
// Clave CANÓNICA con la MISMA tabla que usa la app (importada, no copiada: si divergiera, la prueba
// estaría midiendo otra cosa).
const canon = (k) => WORK_ALIASES[k] ?? k;
const equiposCon = (clave) => rows.filter(r => tipos(r).map(canon).includes(clave)).length;
const equiposNoTrabajo = rows.filter(r => tipos(r).some(k => NO_ES_TRABAJO.includes(k))).length;

const CLAVE_BATERIA = 'cambio bateria';
const CLAVE_FLEX = 'cambio flex';
const base = {
  bateria: equiposCon(CLAVE_BATERIA),
  flex: equiposCon(CLAVE_FLEX),
  soloCanonica: rows.filter(r => tipos(r).includes(CLAVE_BATERIA)).length,
  noTrabajo: equiposNoTrabajo,
};
console.log(`· base: ${dbPath}`);
console.log(`· «Cambio batería» en la base: ${base.bateria} equipos (de los cuales ${base.bateria - base.soloCanonica} vienen de sinónimos aprobados)`);
console.log(`· «Cambio flex»: ${base.flex} · «flex power» NO se une (sigue aparte) · no-trabajo (garantía/venta): ${base.noTrabajo}`);
check('F58: en esta base hay de verdad sinónimos que unir (si no, la prueba no probaría nada)',
  base.bateria > base.soloCanonica, `total=${base.bateria} · solo canónica=${base.soloCanonica}`);

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const abrirTrabajos = async () => {
  await clickCenter(`document.querySelector('[data-work-picker]')`);
  return waitFor(`!!document.querySelector('[data-work-menu]')`, 8000);
};
const cerrarTrabajos = async () => {
  if (await evalx(`!!document.querySelector('[data-work-menu]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(400); }
};
const buscar = async (texto) => {
  await evalx(`(() => {
    const i = document.querySelector('[data-work-search]');
    if (!i) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(i, ${JSON.stringify(texto)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
};
const cuentaDe = async (key, texto) => {
  if (!(await abrirTrabajos())) return null;
  if (texto) await buscar(texto);
  const v = await evalx(`(() => { const b = document.querySelector('[data-work-chip="${key}"]'); return b ? Number(b.getAttribute('data-work-count')) : null; })()`);
  await cerrarTrabajos();
  return v;
};
const todasLasClaves = async (texto = '') => {
  if (!(await abrirTrabajos())) return [];
  if (texto) await buscar(texto);
  const keys = await evalx(`[...document.querySelectorAll('[data-work-chip]')].map(b => b.getAttribute('data-work-chip'))`);
  await cerrarTrabajos();
  return keys ?? [];
};
const enMenu = async (expr) => {
  if (!(await abrirTrabajos())) return null;
  await sleep(400);
  const v = await evalx(expr);
  await cerrarTrabajos();
  return v;
};
const equiposKpi = async () => Number(await evalx(`document.querySelector('[data-kpi="equipos"]')?.innerText.trim() ?? 'NaN'`));
const tarjetas = async () => Number(await evalx(`document.querySelectorAll('[data-tech-quick]').length`));

// desbloqueo del PIN
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
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(i, i.value + '${ch}');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await sleep(500);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Servicio Técnico'))`);
await sleep(1800);
await waitFor(`!!document.querySelector('[data-work-picker]')`, 15000);
await sleep(1200);

// ── 1) el trabajo canónico cuenta TODAS sus formas ─────────────────────────────────────────────
const cuentaBateria = await cuentaDe(CLAVE_BATERIA, 'bateria');
check('F58: «Cambio batería» cuenta la etiqueta canónica + los sinónimos aprobados',
  cuentaBateria === base.bateria, `selector=${cuentaBateria} · base=${base.bateria}`);

// ── 2) las etiquetas viejas ya no son categorías sueltas ───────────────────────────────────────
const clavesBateria = await todasLasClaves('bateria');
check('F58: «bateria» y «REPARACIÓN DE BATTERIA» YA NO aparecen como categorías sueltas',
  Array.isArray(clavesBateria) && !clavesBateria.includes('bateria') && !clavesBateria.includes('reparacion de batteria'),
  JSON.stringify(clavesBateria));
check('F58: la búsqueda «bateria» encuentra el trabajo canónico',
  Array.isArray(clavesBateria) && clavesBateria.includes(CLAVE_BATERIA), JSON.stringify(clavesBateria));

// ── 3) el invariante de F44 sigue: el número == las tarjetas que aparecen al filtrar ───────────
await abrirTrabajos();
await buscar('bateria');
await clickCenter(`document.querySelector('[data-work-chip="${CLAVE_BATERIA}"]')`);
await sleep(2600);
const kpiBateria = await equiposKpi();
const tarjBateria = await tarjetas();
check('F58: al filtrar por «Cambio batería» aparecen EXACTAMENTE los que cuenta (sigue el invariante de F44)',
  kpiBateria === base.bateria && tarjBateria === base.bateria,
  `kpi=${kpiBateria} tarjetas=${tarjBateria} selector=${cuentaBateria} base=${base.bateria}`);

// ── 4) lo que NO está aprobado sigue separado (nada de parecidos) ──────────────────────────────
await evalx(`(() => { const b = document.querySelector('[data-action="limpiar-filtros"]'); if (b) b.click(); return true; })()`);
await sleep(2400);
const cuentaFlex = await cuentaDe(CLAVE_FLEX, 'flex');
const clavesFlex = await todasLasClaves('flex');
check('F58: «flex power» (parecido, NO aprobado) sigue siendo una categoría aparte',
  cuentaFlex === base.flex && Array.isArray(clavesFlex) && clavesFlex.includes('flex power') && clavesFlex.includes(CLAVE_FLEX),
  `cambio flex=${cuentaFlex} (base ${base.flex}) · claves=${JSON.stringify(clavesFlex)}`);

// ── 5) F59: garantía/venta no son trabajos ────────────────────────────────────────────────────
// OJO: el grupo y la posición de las opciones SOLO existen con el menú abierto (el defecto de la
// primera versión de este guion era consultar el DOM después de cerrarlo: daba `null` y acusaba al
// producto de algo que no pasaba).
const grupo = await enMenu(`document.querySelector('[data-work-group="no-trabajo"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
check('F59: garantía/venta tienen su propio grupo en el selector («No es un trabajo»)',
  !!grupo, String(grupo));
const clavesTodas = await todasLasClaves('');
check('F59: y NO están mezcladas entre los trabajos del taller',
  Array.isArray(clavesTodas) && clavesTodas.includes('garantia') && clavesTodas.includes('venta'),
  `¿están? ${JSON.stringify((clavesTodas ?? []).filter(k => k === 'garantia' || k === 'venta'))}`);
check('F59: garantía/venta van DESPUÉS del título de su grupo (fuera del de los trabajos del taller)',
  (await enMenu(`(() => {
    const g = document.querySelector('[data-work-group="no-trabajo"]');
    const op = document.querySelector('[data-work-chip="venta"]');
    if (!g || !op) return false;
    // La opción de venta viene DESPUÉS del título «No es un trabajo» (y por lo tanto fuera del grupo
    // de los trabajos del taller, que está antes).
    return (g.compareDocumentPosition(op) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  })()`)) === true,
  `grupo=«${grupo}»`);

const notaResumen = await evalx(`document.querySelector('[data-resumen-no-trabajo="in"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
check('F59: el resumen dice aparte cuántos son garantía/venta (el desglose no los cuenta como trabajo)',
  !!notaResumen && /garantía\/venta/.test(String(notaResumen)), String(notaResumen));

const desgloseHoy = await evalx(`[...document.querySelectorAll('[data-resumen-desglose="in"] [data-resumen-work]')].map(b => b.getAttribute('data-resumen-work'))`);
check('F59: el desglose del día NO lista garantía ni venta como trabajos',
  Array.isArray(desgloseHoy) && !desgloseHoy.includes('garantia') && !desgloseHoy.includes('venta'),
  JSON.stringify(desgloseHoy));

// limpieza de estado para el operario
await evalx(`(() => { const b = document.querySelector('[data-action="limpiar-filtros"]'); if (b) b.click(); return true; })()`);
await sleep(1200);

const fallas = out.filter(o => !o.ok).length;
console.log(`\nverify_etiquetas_alias: ${out.length - fallas}/${out.length} OK${fallas ? ` — ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
