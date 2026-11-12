#!/usr/bin/env node
/**
 * BANCO DE PRUEBAS EN VIVO — «escribo en el buscador de Servicio y la búsqueda aparece al rato».
 *
 * Mide, sobre una COPIA de la base con volumen realista (`tools/mk_servicios_bench.mjs`), lo que el
 * operario SIENTE —no lo que tarda una consulta suelta—:
 *
 *   1. MONTAJE  — clic en «Servicio Técnico» → la lista ya muestra sus números.
 *   2. TECLA    — cuánto tarda la lista en seguir a CADA letra.
 *   3. PEGADO   — pegar la búsqueda entera de una vez (lo que pasa cuando se escribe rápido).
 *   4. REPOSO   — desde la última tecla hasta que la pantalla deja de trabajar (termina de pintar,
 *                 de traer lo que falte, de re-renderizar). Es la métrica que castiga el camino
 *                 completo de la búsqueda — el N+1 de abonos incluido — sin depender de instrumentar
 *                 el puente.
 *   5. EQUIVALENCIA — el número de tarjetas de la pantalla tiene que ser el que dice la regla de
 *                 búsqueda, y NO puede ser menor que el que devolvería el `LIKE` del backend: si
 *                 alguien esconde órdenes, esto falla.
 *
 * NOTA (para no repetir el intento): instrumentar el puente NO se puede — en Tauri 2
 * `window.__TAURI_INTERNALS__.invoke` es una propiedad no escribible y no configurable (medido), y el
 * WebView no manda el IPC por `window.chrome.webview.postMessage`. Por eso el coste de los viajes se
 * mide por su EFECTO (reposo de la pantalla) y en SQL con `tools/diag_servicios_perf.mjs`.
 *
 * Uso (con la app RELEASE lanzada apuntando a la copia y el puerto de depuración abierto):
 *   node tools/snapshot_db.mjs --out backup/bench_buscador.db --force --pin-dev
 *   node tools/mk_servicios_bench.mjs --db backup/bench_buscador.db --n 1400 --limpiar
 *   $env:REGISTRO_DB="C:\...\backup\bench_buscador.db"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   (lanzar Registro.exe)  →  node tools/bench_buscador_servicios.mjs
 *
 * Variables: BENCH_ROUNDS (3) · BENCH_QUERIES · BENCH_GAP (80 ms) · BENCH_LIMITE (6000 ms)
 */
import { evalx, clickCenter, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { filterServicesBySearch, foldSearch } from '../src/lib/service-search.ts';

const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 3);
const QUERIES = String(process.env.BENCH_QUERIES ?? 'perez,a70,DEV-3150,maria a70').split(',').map(s => s.trim()).filter(Boolean);
const GAP_MS = Number(process.env.BENCH_GAP ?? 80);        // ritmo de tecleo humano
const LIMITE_MS = Number(process.env.BENCH_LIMITE ?? 6000); // lo máximo que se le da a la lista
/**
 * Contra QUÉ se compara lo que pinta la pantalla:
 *   · `local` (por defecto) — la regla de `src/lib/service-search.ts`, la que usa la pantalla DESDE
 *     F96. Con esto el banco es una PRUEBA: falla si la pantalla no muestra esas tarjetas.
 *   · `sql`   — el `LIKE` del backend, que es lo que prometía el código VIEJO. Sirve para medir una
 *     build anterior sin que el banco «falle» por una mejora (la búsqueda vieja no encontraba
 *     «Pérez» escribiendo «perez»: eso es justo lo que F96 arregla).
 */
const REGLA = String(process.env.BENCH_REGLA ?? 'local').toLowerCase() === 'sql' ? 'sql' : 'local';

// ── 0) GATE DE DATOS: siempre una copia ──────────────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath) || path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a una COPIA (nunca registro.db).');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const filas = db.prepare('SELECT client, model, order_num, phone, client_ci FROM services').all();
const total = filas.length;
if (total < 200) {
  console.error(`ABORTADO: la copia tiene ${total} órdenes. Armá el banco con tools/mk_servicios_bench.mjs.`);
  process.exit(2);
}
/** Cuántas tarjetas TIENE que mostrar la pantalla con esta búsqueda (la regla de la pantalla). */
const esperadasLocal = (q) => filterServicesBySearch(filas, q).length;
/**
 * Cuántas devolvería el `LIKE` del backend. Se prueban las dos grafías (la que se escribe y su forma
 * sin acentos) y se toma la mayor: el `LIKE` de SQLite solo pliega ASCII, así que «perez» no matchea
 * «Pérez» en el backend — y la pantalla sí (esa es una de las mejoras, no una pérdida).
 */
const contarLike = (q) => {
  if (!q.trim()) return total;
  const sql = `SELECT COUNT(*) c FROM services WHERE client LIKE ?1 OR model LIKE ?1 OR order_num LIKE ?1 OR phone LIKE ?1 OR client_ci LIKE ?1`;
  const uno = (t) => Number(db.prepare(sql).get(`%${t.replace(/[%_]/g, '')}%`).c);
  return Math.max(uno(q), uno(foldSearch(q)));
};
/** Lo que se le exige a la pantalla, según contra qué build se esté midiendo (ver `REGLA`). */
const esperadas = (q) => REGLA === 'sql' ? contarLike(q) : esperadasLocal(q);

// ── 1) Sondas del DOM ────────────────────────────────────────────────────────────────────────────
const KPI = `(() => {
  const el = document.querySelector('[data-kpi="equipos"]');
  if (!el) return -1;
  const n = Number((el.textContent || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : -1;
})()`;
const BUSCADOR = `document.querySelector('main input[placeholder^="Buscar cliente"]')`;
/** Pone el texto en el buscador como lo haría el operario (setter nativo + evento input). */
const teclear = (texto) => evalx(`(() => {
  const i = ${BUSCADOR};
  if (!i) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(texto)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const kpi = async () => Number(await evalx(KPI).catch(() => -1));

/** Espera a que la lista muestre EXACTAMENTE n tarjetas. Devuelve los ms, o -1 si no llegó. */
const esperarKpi = async (n, limite = LIMITE_MS) => {
  const t0 = Date.now();
  for (;;) {
    if (await kpi() === n) return Date.now() - t0;
    if (Date.now() - t0 > limite) return -1;
    await sleep(25);
  }
};

// «Reposo»: la pantalla dejó de mutar (terminó de pintar y de traer lo que faltaba).
const armarReposo = () => evalx(`(() => {
  if (window.__reposo) window.__reposo.obs.disconnect();
  const est = { ultima: Date.now(), n: 0 };
  const obs = new MutationObserver(() => { est.ultima = Date.now(); est.n++; });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  window.__reposo = { obs, est };
  return true;
})()`);
const leerReposo = async (quieto = 400, limite = LIMITE_MS) => {
  const t0 = Date.now();
  for (;;) {
    const est = JSON.parse(await evalx(`JSON.stringify({ ultima: window.__reposo?.est?.ultima ?? 0, n: window.__reposo?.est?.n ?? 0 })`).catch(() => '{}'));
    if (est.ultima && Date.now() - est.ultima >= quieto) return Date.now() - t0;
    if (Date.now() - t0 > limite) return -1;
    await sleep(50);
  }
};

// ── 2) Sesión y navegación ──────────────────────────────────────────────────────────────────────
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const waitFor = async (expr, timeout = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};
const clicMenu = async (nombre) => {
  const expr = `(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.innerText || '').trim().startsWith(${JSON.stringify(nombre)})); if (b) { b.click(); return true; } return false; })()`;
  const ok = await evalx(expr).catch(() => false);
  if (!ok) await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.innerText || '').trim().startsWith(${JSON.stringify(nombre)}))`).catch(() => {});
  return ok;
};

// La sesión se abre por la MISMA vía del frontend (`verify_user_pin`) y se recarga (la sesión vive en
// el backend 12 h → la app entra directo, F68). Se reintenta: al arrancar los comandos no contestan.
const asegurarSesion = async () => {
  for (let i = 0; i < 25; i++) {
    // La app entra al Dashboard: lo que dice «hay sesión» es el menú lateral (aside).
    if (await evalx(`!!document.querySelector('aside')`).catch(() => false)) return true;
    try {
      const users = await invoke('get_users').catch(() => []);
      const u = (users ?? []).find(x => x.role === 'master') ?? (users ?? [])[0];
      if (u) await invoke('verify_user_pin', { userId: u.id, pin: '1234' }).catch(() => {});
      await evalx(`location.reload(); 'ok'`).catch(() => {});
    } catch { /* todavía cargando */ }
    await sleep(2500);
  }
  return false;
};

// ── 3) Mediciones ──────────────────────────────────────────────────────────────────────────────
const mediana = (xs) => {
  const v = xs.filter(x => x >= 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : -1;
};
const fmt = (ms) => ms < 0 ? 'NO LLEGÓ' : `${ms} ms`;
const out = { montaje: [], lista: [], reposo: [], teclas: [] };
const fallos = [];
const check = (name, ok, detalle = '') => {
  if (!ok) fallos.push(`${name}${detalle ? ` (${detalle})` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detalle ? `  →  ${detalle}` : ''}`);
};

console.log('══════════════════════════════════════════════════════════════════');
console.log(' BANCO DEL BUSCADOR DE SERVICIO — en vivo');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`Base: ${dbPath}`);
console.log(`Órdenes: ${total} · rondas: ${ROUNDS} · tecleo cada ${GAP_MS} ms`);

if (!await asegurarSesion()) {
  console.error('No se pudo entrar a la app (¿está lanzada con el puerto 9222 y el PIN de pruebas?).');
  process.exit(2);
}

// Entrada al módulo en frío: se sale al Dashboard y se vuelve a entrar, como el operario.
const montar = async () => {
  await clicMenu('Dashboard');
  await waitFor(`!${BUSCADOR}`, 20000);
  await sleep(600);
  const t0 = Date.now();
  await clicMenu('Servicio');
  if (!await waitFor(`${BUSCADOR} !== null`, 20000)) return -1;
  const ms = await esperarKpi(total, 30000);
  return ms < 0 ? -1 : ms;
};

for (let r = 0; r < ROUNDS; r++) {
  console.log(`\n── Ronda ${r + 1}/${ROUNDS} ──────────────────────────────────────────────────`);
  const montaje = await montar();
  if (montaje < 0) { console.log('  (no se pudo medir el montaje — ¿la app quedó en otra pantalla?)'); continue; }
  out.montaje.push(montaje);
  console.log(`  MONTAJE   la lista muestra ${total} tarjetas en ${fmt(montaje)}`);

  for (const q of QUERIES) {
    // Volver a la lista completa antes de cada consulta.
    await teclear('');
    await esperarKpi(total, 20000);
    await sleep(200);
    await armarReposo();

    // (a) PEGADO: la consulta entera de una vez (escribir rápido / pegar).
    const quiero = esperadas(q);
    const t0 = Date.now();
    await teclear(q);
    const eco = Date.now() - t0;
    const msLista = await esperarKpi(quiero, LIMITE_MS);
    const msReposo = await leerReposo(400, LIMITE_MS);
    const enPantalla = await kpi();
    out.lista.push(msLista);
    out.reposo.push(msReposo);
    console.log(`  PEGADO    «${q}» → ${enPantalla} tarjetas · lista en ${fmt(msLista)} · en reposo a los ${fmt(msReposo)} (eco del campo ${eco} ms)`);
    if (REGLA === 'local') {
      // Con la regla nueva estas dos son REQUISITOS. Midiendo una build vieja (BENCH_REGLA=sql) se
      // informan nada más: la búsqueda vieja no encontraba «Pérez» escribiendo «perez» y eso es
      // precisamente lo que F96 viene a arreglar, no un fallo de la medición.
      check(`«${q}»: la pantalla muestra ${quiero} tarjetas (la regla)`, enPantalla === quiero, `pantalla ${enPantalla}`);
      check(`«${q}»: no muestra MENOS de las que traería el backend`, enPantalla >= contarLike(q), `pantalla ${enPantalla} · LIKE ${contarLike(q)}`);
    } else {
      console.log(`            (sonda) la regla nueva daría ${esperadasLocal(q)} · el LIKE del backend da ${contarLike(q)} · pantalla ${enPantalla}`);
    }

    // (b) TECLA A TECLA: cuánto tarda la lista en seguir CADA letra.
    await teclear('');
    await esperarKpi(total, 20000);
    await sleep(200);
    const porTecla = [];
    for (let i = 1; i <= q.length; i++) {
      const prefijo = q.slice(0, i);
      const n = esperadas(prefijo);
      await teclear(prefijo);
      const ms = await esperarKpi(n, LIMITE_MS);
      porTecla.push(ms);
      await sleep(GAP_MS);
    }
    out.teclas.push(...porTecla);
    console.log(`  TECLAS    «${q}»: ${q.split('').map((c, i) => `${c}=${porTecla[i] < 0 ? 'NO' : porTecla[i]}`).join(' ')}`);
    // Aviso de la app (si el mapa de abonos no se pudo cargar, lo dice en pantalla).
    if (await evalx(`!!document.querySelector('[data-note="pagos-no-cargados"]')`).catch(() => false)) {
      console.log('            (la pantalla avisa que la lista es muy larga para el chip de método)');
    }
  }
}

// ── 4) Resumen ─────────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' RESUMEN (medianas)');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  montaje del módulo ................ ${fmt(mediana(out.montaje))}`);
console.log(`  pegar la búsqueda (lista) ......... ${fmt(mediana(out.lista))}`);
console.log(`  pegar la búsqueda (reposo) ........ ${fmt(mediana(out.reposo))}`);
console.log(`  seguir CADA tecla ................. ${fmt(mediana(out.teclas))}   (peor: ${fmt(Math.max(...out.teclas))})`);
const lentas = out.teclas.filter(x => x < 0 || x > 150).length;
console.log(`  teclas que siguieron en <150 ms ... ${out.teclas.length - lentas}/${out.teclas.length}`);
if (fallos.length) {
  console.log(`\n  FALLAN ${fallos.length} comprobaciones:`);
  for (const f of fallos) console.log(`   · ${f}`);
}
console.log(`\nbench_buscador_servicios: ${fallos.length ? 'CON FALLOS' : 'OK'}`);
db.close();
process.exit(fallos.length ? 1 : 0);
