// Copia CONSISTENTE de una base SQLite (incluye el WAL) para las verificaciones en vivo.
//
// Uso:  node tools/copy_db.mjs <origen.db> <destino.db>
//
// Por qué existe: copiar el .db con `Copy-Item` deja afuera lo que todavía vive en el WAL (una
// verificación podía medir una base vieja y culpar al producto). `VACUUM INTO` escribe un archivo
// nuevo y consistente, con el esquema y los datos ya consolidados.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const [origen, destino] = process.argv.slice(2);
if (!origen || !destino) {
  console.error('Uso: node tools/copy_db.mjs <origen.db> <destino.db>');
  process.exit(2);
}
if (!fs.existsSync(origen)) {
  console.error(`ABORTADO: no existe el origen ${origen}`);
  process.exit(2);
}
fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
if (fs.existsSync(destino)) fs.rmSync(destino, { force: true });

const db = new DatabaseSync(origen, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const copia = new DatabaseSync(destino, { readOnly: true });
const n = (sql) => copia.prepare(sql).get().n;
console.log(`copia lista: ${destino}`);
console.log(`  products: ${n('SELECT COUNT(*) n FROM products')} · services: ${n('SELECT COUNT(*) n FROM services')}`
  + ` · con precio: ${n('SELECT COUNT(*) n FROM products WHERE COALESCE(price_sale,0) > 0')}`
  + ` · quick_check: ${copia.prepare('PRAGMA quick_check').get().quick_check}`);
copia.close();
