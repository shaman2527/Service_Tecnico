// EL RESPALDO PREVIO A UNA ACTUALIZACIÓN NO PUEDE FALLAR EN SILENCIO.
//
// Por qué existe: hasta la 0.4.0, `api.backupBeforeUpdate` terminaba en `.catch(() => mock(undefined))`
// (desde F8), así que si el respaldo previo fallaba —permisos, antivirus, disco lleno, PowerShell
// bloqueado— la actualización SEGUÍA IGUAL y sin avisar: sin copia de la base, sin el exe anterior y
// sin el vigilante que restaura la versión vieja, o sea sin red de seguridad y sin que nadie se
// enterara. Se encontró el 2026-09-18 auditando el release 0.4.0 (mientras el dueño preguntaba,
// justamente, «¿se me puede dañar la app si actualizo?»). En esta misma PC quedó la huella del
// problema: `update-state.json` en «pending» y SIN la carpeta `prev/`.
//
// Este test es la red anti-regresión: lee los archivos reales, como hace
// `commands::tests::test_b3_todos_los_comandos_de_escritura_tienen_el_gate`. No prueba el
// comportamiento en runtime (eso necesita la app), prueba que la ESTRUCTURA que lo hace posible
// siga en su lugar: si alguien vuelve a tragarse el error o a no avisar del vigilante, esto FALLA.
//
// Uso: node tools/update_backup_test.ts

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (rel) => readFileSync(resolve(ROOT, rel), 'utf-8');

let checks = 0;
let fallas = 0;
const ok = (nombre, cond, detalle = '') => {
  checks += 1;
  if (!cond) fallas += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${nombre}${detalle ? `  ->  ${detalle}` : ''}`);
};

/** Cuerpo de una propiedad/comando, desde su nombre hasta el cierre de la declaración. */
const cuerpo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) return null;
  const j = fuente.indexOf(hasta, i + desde.length);
  return j < 0 ? fuente.slice(i) : fuente.slice(i, j);
};

// ── 1) El frontend NO puede tragarse el error del respaldo ──────────────────────────────────
const db = leer('src/db.ts');
const backup = cuerpo(db, 'backupBeforeUpdate:', 'runHealthCheck:');
ok('db.ts: backupBeforeUpdate existe', backup !== null);
ok('db.ts: el respaldo ya NO se traga el error (sin .catch que devuelva un mock)',
  backup !== null && !/\.catch\(/.test(backup),
  backup && /\.catch\(/.test(backup) ? 'volvió el .catch: un respaldo fallido pasaría desapercibido' : 'fail-closed');
ok('db.ts: el respaldo devuelve el detalle (UpdateBackup), no un void vacío',
  backup !== null && /UpdateBackup/.test(backup));
ok('db.ts: en modo browser sigue devolviendo un mock (no rompe npm run dev)',
  backup !== null && /if \(!isTauri\) return mock/.test(backup));

// ── 2) El diálogo tiene que FRENAR la instalación si el respaldo falló ──────────────────────
const dlg = leer('src/components/UpdateDialog.tsx');
const install = cuerpo(dlg, 'const install = async () => {', '// "Ver más tarde"');
ok('UpdateDialog: la instalación espera el respaldo antes de descargar',
  install !== null && install.indexOf('backupBeforeUpdate') > -1
  && install.indexOf('backupBeforeUpdate') < install.indexOf('downloadAndInstall'));
ok('UpdateDialog: si falla el respaldo, el mensaje dice que NO se instaló nada',
  install !== null && /No se pudo hacer el respaldo previo/.test(install) && /NO se instaló nada/.test(install));
ok('UpdateDialog: distingue la etapa por una variable LOCAL, no por el estado de React',
  install !== null && /let etapa: 'respaldo' \| 'instalando'/.test(install),
  'el estado de React no cambia dentro del mismo closure: usarlo daría el mensaje equivocado');
ok('UpdateDialog: avisa si el vigilante no se pudo lanzar',
  dlg.includes('watchdog === false') && /setAviso\(/.test(dlg));
ok('UpdateDialog: el texto le dice al usuario que sin respaldo no se instala',
  /no se instala<\/b>|no se instala/.test(dlg));

// ── 3) El backend devuelve las rutas y si el vigilante arrancó ──────────────────────────────
const cmd = leer('src-tauri/src/commands.rs');
const cmdBackup = cuerpo(cmd, 'pub struct UpdateBackup', 'pub fn run_health_check');
ok('commands.rs: la respuesta del respaldo trae las rutas y el estado del vigilante',
  cmdBackup !== null && /pub db_backup: String/.test(cmdBackup) && /pub prev_exe: String/.test(cmdBackup)
  && /pub watchdog: bool/.test(cmdBackup));
ok('commands.rs: el comando devuelve ese detalle (no un Result<(), _>)',
  /pub fn backup_before_update\([^)]*\) -> Result<UpdateBackup, String>/.test(cmd));
ok('commands.rs: el respaldo se hace ANTES de lanzar el vigilante',
  cmdBackup !== null && cmdBackup.indexOf('updates::backup_before_update') < cmdBackup.indexOf('spawn_watchdog'));

const upd = leer('src-tauri/src/updates.rs');
ok('updates.rs: spawn_watchdog informa si pudo lanzar (devuelve bool)',
  /pub fn spawn_watchdog\(install_dir: &Path\) -> bool/.test(upd));
ok('updates.rs: no se ignora el resultado del spawn (`let _ = ...spawn()`)',
  !/let _ = std::process::Command::new/.test(upd));

// ── 4) El tipo compartido ───────────────────────────────────────────────────────────────────
const types = leer('src/types.ts');
const t = cuerpo(types, 'export interface UpdateBackup', 'export interface HealthReport');
ok('types.ts: UpdateBackup declara db_backup, prev_exe y watchdog',
  t !== null && /db_backup: string/.test(t) && /prev_exe: string/.test(t) && /watchdog: boolean/.test(t));

// ── 5) El rollback sigue existiendo y avisa si no hay versión anterior ──────────────────────
ok('updates.rs: rollback_update sigue restaurando el exe anterior',
  /pub fn rollback_update/.test(upd) && /prev_exe_path/.test(upd));
ok('updates.rs: sin versión anterior guardada el error es explícito',
  /No hay versión anterior guardada/.test(upd));

console.log(`\nrespaldo de actualización: ${checks} comprobaciones · ${checks - fallas} OK · ${fallas} fallo(s)`);
process.exit(fallas > 0 ? 1 : 0);
