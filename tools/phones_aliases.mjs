// Muestra el texto CRUDO (alias) con el que entró cada teléfono: sirve para ver
// de dónde salió un nombre raro. Uso: node tools/phones_aliases.mjs <texto>
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const needle = (process.argv[2] ?? 'spark').toLowerCase();
const db = new DatabaseSync(path.join(ROOT, 'backup/registro_pre_normalizacion_20260915.db'), { readOnly: true });
const rows = db.prepare("SELECT brand, name, model, line, key, aliases FROM phones WHERE lower(name) LIKE ? ORDER BY brand").all(`%${needle}%`);
console.log(`coincidencias de "${needle}": ${rows.length}`);
for (const r of rows) {
  console.log(`  ${r.brand} | ${r.name} | línea="${r.line}" modelo="${r.model}" | key=${r.key}`);
  console.log(`     alias: ${r.aliases}`);
}
db.close();
