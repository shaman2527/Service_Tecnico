#!/usr/bin/env node
// ============================================================================
// Copia CONSISTENTE de una base SQLite (incluye lo que esté en el -wal).
// Usa VACUUM INTO (snapshot atómico) en vez de copiar archivos a mano: así no
// se arrastran -wal/-shm a medio escribir.
//
// Uso:
//   node tools/snapshot_db.mjs --src registro.db --out backup/registro_copia.db
//   node tools/snapshot_db.mjs --out backup/antes_de_normalizar.db --force
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const SRC = path.resolve(ROOT, arg('--src', path.join(ROOT, 'registro.db')));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const OUT = path.resolve(ROOT, arg('--out', path.join(ROOT, 'backup', `registro_snapshot_${stamp}.db`)));
const FORCE = argv.includes('--force');
/**
 * `--pin-dev` — deja la COPIA con el PIN de pruebas (1234) para poder entrar en las verificaciones EN
 * VIVO. Hace falta porque la copia trae el PIN REAL del dueño (hasheado, `pbkdf2$…`) y los scripts
 * entran tecleando 1234. Se escribe en TEXTO PLANO a propósito: es el camino que el propio backend ya
 * soporta y migra solo a hash en el primer desbloqueo (B4) — el mismo que usa la plantilla del
 * instalador. SOLO toca la copia recién creada: el origen nunca se abre para escribir.
 */
const PIN_DEV = argv.includes('--pin-dev');

if (!fs.existsSync(SRC)) {
  console.error(`No existe el origen: ${SRC}`);
  process.exit(1);
}
// Guarda de seguridad: el destino NO puede ser el origen. Más abajo el destino se BORRA antes de
// copiar (`VACUUM INTO`), así que un `--out` que apunte a la propia base la destruiría — y con
// `--pin-dev` además le escribiría un PIN de pruebas. (Hallazgo menor de la revisión adversarial.)
if (path.resolve(SRC) === path.resolve(OUT)) {
  console.error('El destino no puede ser el mismo archivo que el origen.');
  process.exit(1);
}
if (fs.existsSync(OUT) && !FORCE) {
  console.error(`Ya existe el destino: ${path.relative(ROOT, OUT)}  (usa --force para sobrescribir)`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (fs.existsSync(OUT)) fs.rmSync(OUT);

const src = new DatabaseSync(SRC, { readOnly: true });
const before = src.prepare('SELECT count(*) c FROM products').get().c;
const wal = fs.existsSync(`${SRC}-wal`) ? fs.statSync(`${SRC}-wal`).size : 0;
src.exec(`VACUUM INTO '${OUT.replace(/'/g, "''")}'`);
src.close();

const copy = new DatabaseSync(OUT, { readOnly: true });
const check = copy.prepare('PRAGMA quick_check').get().quick_check;
const after = copy.prepare('SELECT count(*) c FROM products').get().c;
copy.close();

if (PIN_DEV) {
  const w = new DatabaseSync(OUT);
  const hay = w.prepare("SELECT value FROM settings WHERE key='pin'").get();
  if (hay) w.prepare("UPDATE settings SET value='1234' WHERE key='pin'").run();
  else w.prepare("INSERT INTO settings (key, value) VALUES ('pin','1234')").run();
  // F68: cada PERSONA tiene su propio `users.pin_hash`. Va en texto plano por el mismo motivo (el
  // backend lo acepta y lo re-hashea al primer desbloqueo), y así las pruebas entran como Master.
  const cols = w.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (cols.includes('pin_hash')) w.prepare("UPDATE users SET pin_hash='1234'").run();
  // F69: el bloqueo por intentos fallidos SE PERSISTE — una copia con la cuenta bloqueada dejaría la
  // verificación en vivo sin poder entrar (ni con el PIN correcto) durante un minuto.
  w.prepare("DELETE FROM settings WHERE key IN ('pin_failures','pin_locked_until')").run();
  w.close();
  console.log('pin    : la COPIA queda con el PIN de pruebas 1234 para Master y caja (el origen no se toca)');
}

const kb = (p) => `${Math.round(fs.statSync(p).size / 1024)} KB`;
console.log(`origen : ${path.relative(ROOT, SRC)}  (${kb(SRC)}, wal ${Math.round(wal / 1024)} KB, ${before} productos)`);
console.log(`copia  : ${path.relative(ROOT, OUT)}  (${kb(OUT)}, ${after} productos, quick_check: ${check})`);
if (before !== after || check !== 'ok') {
  console.error('La copia NO es fiable: abortando.');
  process.exit(1);
}
