// VERIFICACIÓN EN VIVO (CDP) de F71 — RESPALDO Y RESTAURACIÓN desde la app (bloqueante A2 de la auditoría).
//
// Antes: los comandos de respaldo existían y **ninguna pantalla los llamaba**; la Ayuda decía «copiá
// registro.db a un USB». Ahora hay un botón, una carpeta elegible (USB), una copia automática al cerrar
// el día y una restauración con copia de seguridad previa.
//
// Qué comprueba sobre la app REAL (contra el disco y la BASE leída aparte):
//   1. **La pantalla existe y dice cómo está el respaldo** (estado + carpeta + retención).
//   2. **«Respaldar ahora» escribe un archivo REAL y consistente**: existe en disco, es SQLite válido
//      (`quick_check`) y trae las MISMAS filas que la base viva (productos/ventas/órdenes) — o sea que
//      se llevó lo que estaba en el WAL.
//   3. **La lista lo muestra** con su fecha, tamaño y de qué tipo es, y el estado pasa a «al día».
//   4. **Restaurar exige confirmación y guarda una copia de lo actual**: se pide restaurar un respaldo
//      HECHO ANTES de un cambio, la app escribe la copia de seguridad, deja la restauración pendiente y
//      reinicia; al volver, la base quedó como el respaldo (el cambio de prueba desapareció) y el
//      marcador se consumió.
//   5. **La CAJA no puede respaldar ni restaurar** (el backend lo rechaza: es del dueño).
//
// SEGURIDAD DE DATOS: SIEMPRE sobre una COPIA (`REGISTRO_DB`); rechaza correr contra `registro.db`.
// El respaldo se escribe en una carpeta temporal propia de la prueba.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f71_verif.db"
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_respaldo.mjs

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) GATE: la base (la verdad independiente) + la carpeta de respaldos de la prueba ─────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: esta prueba ESCRIBE (respaldos y una restauración) — nunca contra la real.');
  process.exit(2);
}
// La carpeta POR DEFECTO (respaldos/ al lado de la base): es la que usa la pantalla sin tocar nada,
// y el diálogo de carpeta del sistema no se puede manejar por CDP.
const carpeta = path.join(path.dirname(path.resolve(dbPath)), 'respaldos');
fs.rmSync(carpeta, { recursive: true, force: true });   // se limpia la carpeta de respaldos de la COPIA
fs.mkdirSync(carpeta, { recursive: true });

const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch (e) { return { err: String(e.message) }; } };
const cuenta = (sql, ...p) => Number(uno(sql, ...p).n ?? -1);
const vivo = {
  productos: cuenta('SELECT COUNT(*) AS n FROM products'),
  ventas: cuenta('SELECT COUNT(*) AS n FROM sales'),
  servicios: cuenta('SELECT COUNT(*) AS n FROM services'),
};
console.log(`· base: ${vivo.productos} productos · ${vivo.ventas} ventas · ${vivo.servicios} órdenes`);
console.log(`· carpeta de respaldos de la prueba: ${carpeta}`);

// ── helpers de IPC y de la pantalla de acceso ─────────────────────────────────────────────────
const invoke = (m, a) => evalx(`(async () => {
  try { const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(m)}, ${JSON.stringify(a ?? {})}); return JSON.stringify({ ok: r }); }
  catch (e) { return JSON.stringify({ err: String(e) }); }
})()`).then(r => {
  const o = JSON.parse(String(r ?? '{}'));
  if (o.err) throw new Error(o.err);
  return o.ok;
});
const invokeErr = async (m, a) => {
  try { await invoke(m, a); return null; } catch (e) { return e.message; }
};
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
const entrar = async (nombre, pin) => {
  await irALaLista();
  const id = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-user-option]')].find(x => (x.innerText || '').includes(${JSON.stringify(nombre)}));
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
const irAAyuda = async () => {
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Ayuda/i.test(x.innerText || x.getAttribute('title') || '')); if (b) b.click(); return !!b; })()`);
  return await waitFor(`/Centro de Ayuda/.test(document.body.innerText || '')`, 12000);
};

// ── 1) un respaldo REAL por IPC, en la carpeta de la prueba ───────────────────────────────────
let primerRespaldo = null;
{
  const entro = await entrar('Master', '1234');
  check('F71: el dueño entra', entro);
  const info = await invoke('backup_now', { dir: carpeta }).catch(e => { check('F71: se pudo respaldar', false, e.message); return null; });
  check('F71: «Respaldar ahora» devuelve el archivo creado', !!info?.path && fs.existsSync(info.path), JSON.stringify(info));
  primerRespaldo = info;

  if (info?.path) {
    // El respaldo es una BASE VÁLIDA con los mismos datos que la viva (se llevó el WAL)
    const b = new DatabaseSync(info.path, { readOnly: true });
    const quick = b.prepare('PRAGMA quick_check').get().quick_check;
    const copia = {
      productos: b.prepare('SELECT COUNT(*) n FROM products').get().n,
      ventas: b.prepare('SELECT COUNT(*) n FROM sales').get().n,
      servicios: b.prepare('SELECT COUNT(*) n FROM services').get().n,
    };
    b.close();
    check('F71: el respaldo es una base SQLite sana (quick_check ok)', quick === 'ok', String(quick));
    check('F71: y trae las MISMAS filas que la base viva (productos/ventas/órdenes)',
      copia.productos === vivo.productos && copia.ventas === vivo.ventas && copia.servicios === vivo.servicios,
      `respaldo ${JSON.stringify(copia)} vs vivo ${JSON.stringify(vivo)}`);
    check('F71: el archivo pesa lo que dice (no un archivo vacío)',
      Number(info.size_bytes) > 0 && Number(info.size_bytes) === fs.statSync(info.path).size,
      `${info.size_bytes} bytes`);
  }
}

// ── 2) la pantalla: estado, carpeta, lista y respaldar desde el botón ────────────────────────
{
  await irAAyuda();
  const hayBoton = await waitFor(`!!document.querySelector('[data-action="respaldos"]')`, 8000);
  check('F71: Ayuda tiene el botón «Respaldos»', hayBoton);
  await evalx(`(() => { const b = document.querySelector('[data-action="respaldos"]'); if (b) b.click(); return !!b; })()`);
  const abrio = await waitFor(`!!document.querySelector('[data-dialog="respaldos"]')`, 8000);
  check('F71: abre la pantalla de respaldos', abrio);

  // La carpeta ya es la POR DEFECTO (la que muestra la pantalla): no hay que elegir nada. El botón
  // «Elegir carpeta (USB)» abre el diálogo NATIVO del sistema, que no se puede manejar por CDP, así
  // que acá sólo se comprueba que exista (y que el estado diga qué carpeta se usa).
  const hayElegir = await evalx(`!!document.querySelector('[data-action="elegir-carpeta"]')`);
  check('F71: la pantalla ofrece elegir otra carpeta (USB)', hayElegir);

  const estadoTxt = String(await evalx(`document.querySelector('[data-field="estado-respaldo"]')?.innerText ?? ''`));
  const dirTxt = String(await evalx(`document.querySelector('[data-field="carpeta-respaldos"]')?.innerText ?? ''`));
  check('F71: la pantalla dice CÓMO está el respaldo (con su estado)', /Respaldo de hoy|hace \\d+ día|Todavía no hay/i.test(estadoTxt), estadoTxt.slice(0, 140));
  check('F71: y muestra la carpeta que se está usando y la retención',
    dirTxt.includes(carpeta) && /retenci|conservan/i.test(dirTxt), dirTxt.slice(0, 160));

  const filas = await evalx(`[...document.querySelectorAll('[data-backup-row]')].map(r => r.getAttribute('data-backup-row'))`);
  check('F71: el respaldo hecho aparece LISTADO en la pantalla',
    Array.isArray(filas) && filas.some(n => String(n).includes('registro_')), JSON.stringify(filas));

  // «Respaldar ahora» desde el BOTÓN (no por IPC): tiene que crear OTRO archivo
  const antes = fs.readdirSync(carpeta).filter(f => f.endsWith('.db')).length;
  await evalx(`(() => { const b = document.querySelector('[data-action="respaldar-ahora"]'); if (b) b.click(); return !!b; })()`);
  const msgOk = await waitFor(`/Respaldo hecho/i.test(document.querySelector('[data-field="msg-respaldo"]')?.innerText ?? '')`, 20000);
  const despues = fs.readdirSync(carpeta).filter(f => f.endsWith('.db')).length;
  check('F71: el botón «Respaldar ahora» crea otro respaldo y lo dice', msgOk && despues > antes,
    `archivos ${antes} → ${despues} · msg=${msgOk}`);
}

// ── 3) RESTAURAR: se cambia la base, se restaura el respaldo y se aplica al reiniciar ────────
{
  // Un cambio DESPUÉS del respaldo (así la restauración se puede medir: desaparece)
  const w = new DatabaseSync(dbPath);
  const marca = `PRUEBA-F71-${Date.now()}`;
  w.prepare("INSERT INTO products (name, category_id, stock, price_sale) VALUES (?1, 1, 0, 0)").run(marca);
  w.close();
  check('F71: el cambio de prueba quedó en la base viva',
    cuenta('SELECT COUNT(*) AS n FROM products WHERE name=?1', marca) === 1, marca);

  const plan = await invokeErr('request_restore', { path: primerRespaldo.path });
  check('F71: la restauración se rechaza si el archivo no es un respaldo válido',
    await (async () => {
      const basura = path.join(carpeta, 'basura.db');
      fs.writeFileSync(basura, 'no es sqlite');
      const err = await invokeErr('request_restore', { path: basura });
      return !!err;
    })(), 'archivo inválido rechazado');

  const ok = await invoke('request_restore', { path: primerRespaldo.path }).catch(e => { check('F71: se pudo pedir la restauración', false, e.message); return null; });
  check('F71: la restauración válida queda PENDIENTE con su copia de seguridad',
    !!ok?.copia_seguridad && fs.existsSync(ok.copia_seguridad) && /Al reiniciar/.test(String(ok.resumen)),
    JSON.stringify(ok));

  const marcador = path.join(path.dirname(dbPath), 'restaurar_pendiente.txt');
  check('F71: queda el marcador para el próximo arranque', fs.existsSync(marcador), marcador);
  check('F71: y la base TODAVÍA no cambió (se aplica al reiniciar, no con la app abierta)',
    cuenta('SELECT COUNT(*) AS n FROM products WHERE name=?1', marca) === 1);

  // Reiniciar la app = relanzar el proceso con el MISMO REGISTRO_DB (lo hace la prueba, no el script)
  console.log('· REINICIO: cerrá y volvé a abrir la app con el mismo REGISTRO_DB para aplicar la restauración');
}

db.close();
const failed = out.filter(r => !r.ok);
console.log(`\nverify_respaldo (parte 1): ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log(`· carpeta de respaldos de la prueba: ${carpeta}`);
console.log(`· respaldo usado para restaurar: ${primerRespaldo?.path ?? '(ninguno)'}`);
process.exit(failed.length ? 1 : 0);
