// VERIFICACIÓN EN VIVO (CDP) de F71 — PARTE 2: se corre DESPUÉS de reiniciar la app (la restauración
// se aplica al arrancar, cuando todavía no hay ninguna conexión abierta sobre el archivo).
//
// Comprueba: la base quedó como el respaldo (el cambio de prueba desapareció), el marcador se consumió,
// la copia de seguridad previa sigue en la carpeta, la app quedó usable (la base abre) y **la CAJA no
// puede respaldar ni restaurar** (el backend lo rechaza: es del dueño).
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f71_verif.db"
//       node tools/verify_respaldo2.mjs <marca-que-debe-desaparecer> <carpeta-de-respaldos>

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

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

const dbPath = process.env.REGISTRO_DB;
const marca = process.argv[2] ?? '';
const carpeta = process.argv[3] ?? '';
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB de la copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch (e) { return { err: String(e.message) }; } };
const cuenta = (sql, ...p) => Number(uno(sql, ...p).n ?? -1);

// ── 1) LA RESTAURACIÓN SE APLICÓ ──────────────────────────────────────────────────────────────
{
  check('F71: el marcador de restauración se consumió',
    !fs.existsSync(path.join(path.dirname(dbPath), 'restaurar_pendiente.txt')));
  if (marca) {
    check('F71: el cambio hecho DESPUÉS del respaldo desapareció (la base volvió al respaldo)',
      cuenta('SELECT COUNT(*) AS n FROM products WHERE name=?1', marca) === 0, `marca: ${marca}`);
  }
  check('F71: la base quedó sana después de la restauración', uno('PRAGMA quick_check').quick_check === 'ok');
  if (carpeta && fs.existsSync(carpeta)) {
    const seg = fs.readdirSync(carpeta).filter(f => f.startsWith('antes_de_restaurar_'));
    check('F71: la copia de seguridad previa a la restauración está en la carpeta (se puede volver atrás)',
      seg.length >= 1, `${seg.length} copia(s): ${seg.join(', ')}`);
  }
}

// ── 2) LA APP QUEDÓ USABLE Y LA CAJA NO PUEDE RESPALDAR NI RESTAURAR ─────────────────────────
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

{
  const entroCaja = await entrar('Caja 1', '2468');
  check('F71: la caja entra con SU PIN (la base restaurada sigue funcionando)', entroCaja);
  const errB = await invokeErr('backup_now', { dir: carpeta || null });
  const errR = await invokeErr('request_restore', { path: path.join(carpeta || '.', 'x.db') });
  check('F71: la CAJA no puede respaldar (gate del dueño)', !!errB && /due|Master/i.test(String(errB)), String(errB ?? '(¡PASÓ!)').slice(0, 80));
  check('F71: ni restaurar (gate del dueño)', !!errR && /due|Master/i.test(String(errR)), String(errR ?? '(¡PASÓ!)').slice(0, 80));

  // La pantalla sigue sin ofrecer lo que el backend rechaza: el botón vive en Ayuda, que la caja ve…
  // pero la sección de respaldos es del dueño (los comandos fallan) → se comprueba el rechazo del IPC,
  // que es la barrera real.
  const estado = await invoke('backup_status', { dir: carpeta || null }).catch(() => null);
  check('F71: el estado del respaldo se puede mirar (es informativo, no mueve plata)',
    !!estado && typeof estado.total === 'number', JSON.stringify(estado).slice(0, 120));
}

db.close();
const failed = out.filter(r => !r.ok);
console.log(`\nverify_respaldo (parte 2): ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
