// VERIFICACIÓN EN VIVO (CDP) de F75 — EL EXCEL DEL CONTADOR.
//
// Pedido del dueño (2026-09-25): «arreglá el Excel, todo ordenado y por método de pago; si todo son
// Pago Móvil tenga su monto y número de referencia; un Excel profesional que mi contador en Venezuela
// entienda».
//
// Lo que comprueba, contra la app REAL (Tauri 2 + React 19 + SQLite + Python/openpyxl):
//   1. El botón «Exportar Excel» del dueño funciona y dice DÓNDE quedó el archivo (y con qué formato).
//   2. El .xlsx existe, es reciente y pesa lo que tiene que pesar (no es un archivo vacío).
//   3. El contenido lo valida `tools/export_libro_diario_check.py` (hojas, orden por método, Pago Móvil
//      con referencia, IVA del período): esta verificación deja la ruta impresa para ese paso.
//
// SEGURIDAD DE DATOS: sólo LEE la base (una COPIA, siempre) y escribe el reporte en Documentos\Registro
// (la carpeta que la app usa para los reportes). No toca plata, stock ni órdenes.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f75_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       app de dev abierta  →  node tools/verify_export_excel.mjs

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
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) GATE: la copia ─────────────────────────────────────────────────────────────────────────
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
const ventas = Number(uno('SELECT COUNT(*) AS n FROM sales').n ?? 0);
const abonos = Number(uno("SELECT COUNT(*) AS n FROM service_payments WHERE amount > 0").n ?? 0);
const pmVentas = Number(uno("SELECT COUNT(*) AS n FROM sales WHERE payment_method LIKE '%Móvil%' AND voided_at IS NULL").n ?? 0);
const pmAbonos = Number(uno("SELECT COUNT(*) AS n FROM service_payments WHERE payment_method LIKE '%Móvil%'").n ?? 0);
console.log(`· copia: ${dbPath} · ${ventas} ventas · ${abonos} abonos · ${pmVentas + pmAbonos} pago(s) móvil`);

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

await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
check('F75: el Master entra (sobre la copia)', await entrar('Master', '1234'));
await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Libro Diario/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
check('F75: llega al Libro Diario', await waitFor(`!!document.querySelector('[data-nav-group]')`, 12000));
await sleep(1500);

check('F75: el dueño tiene el botón «Exportar Excel»',
  await evalx(`!!document.querySelector('[data-action="libro-exportar"]')`));

// Los días del rango que se va a exportar (el rango por defecto son los últimos 30 días).
const rango = JSON.parse(await evalx(`(() => {
  const inputs = [...document.querySelectorAll('main input[type="date"]')].map(i => i.value);
  return JSON.stringify({ desde: inputs[0] ?? null, hasta: inputs[1] ?? null });
})()`));
console.log(`· rango en pantalla: ${rango.desde} → ${rango.hasta}`);

const inicio = Date.now();
await clickCenter(`document.querySelector('[data-action="libro-exportar"]')`);
// OJO: esperar por «exportado» y no por «Excel» (el BOTÓN dice «Exportar Excel»: esperar por esa
// palabra daba un falso OK inmediato sin que el reporte estuviera hecho — lección de esta corrida).
const dijo = await waitFor(`/exportado \\(/i.test(document.querySelector('main')?.innerText || '')`, 90000);
check('F75: la app avisa que el reporte se exportó (y con qué formato)', dijo);

const mensaje = String(await evalx(`(() => {
  const p = [...document.querySelectorAll('main p')].find(x => /exportado \\(|exportado:/i.test(x.innerText || ''));
  return p ? p.innerText.trim() : '';
})()`));
console.log(`· mensaje: ${mensaje}`);

const ruta = (mensaje.match(/[A-Za-z]:\\[^"']+\.(xlsx|csv)/) ?? [])[0] ?? null;
check('F75: el mensaje dice DÓNDE quedó el archivo', !!ruta, String(ruta));
if (ruta) {
  check('F75: el archivo existe en disco', fs.existsSync(ruta), ruta);
  if (fs.existsSync(ruta)) {
    const st = fs.statSync(ruta);
    check('F75: el archivo es RECIÉN generado (no uno viejo)', st.mtimeMs >= inicio - 5000,
      `mtime ${new Date(st.mtimeMs).toISOString()} · export iniciado ${new Date(inicio).toISOString()}`);
    const kb = Math.round(st.size / 1024);
    check('F75: el archivo tiene contenido (no está vacío)', st.size > 8000, `${kb} KB`);
    check('F75: se generó un .xlsx de verdad (no el CSV de emergencia)',
      ruta.toLowerCase().endsWith('.xlsx'), ruta);
    console.log(`RUTA_XLSX=${ruta}`);
  }
}

console.log(`\nverify_export_excel: ${checks - fallos.length}/${checks} OK${fallos.length ? ` — ${fallos.length} FALLAN` : ''}`);
if (fallos.length) { console.log(fallos.map(f => `  · ${f}`).join('\n')); process.exit(1); }
process.exit(0);
