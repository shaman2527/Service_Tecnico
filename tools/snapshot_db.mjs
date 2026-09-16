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

if (!fs.existsSync(SRC)) {
  console.error(`No existe el origen: ${SRC}`);
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

const kb = (p) => `${Math.round(fs.statSync(p).size / 1024)} KB`;
console.log(`origen : ${path.relative(ROOT, SRC)}  (${kb(SRC)}, wal ${Math.round(wal / 1024)} KB, ${before} productos)`);
console.log(`copia  : ${path.relative(ROOT, OUT)}  (${kb(OUT)}, ${after} productos, quick_check: ${check})`);
if (before !== after || check !== 'ok') {
  console.error('La copia NO es fiable: abortando.');
  process.exit(1);
}
