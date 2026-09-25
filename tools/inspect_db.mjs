// Mira el ESQUEMA y los datos de una copia de la base sin abrir la app (útil para las verificaciones
// y para comparar una copia con la base real: tablas, columnas, filas y el contenido de `settings`).
//
// Uso:  node tools/inspect_db.mjs [copia.db]        (por defecto backup/revision_f67.db)
//
// Sólo LEE (`readOnly`). Si querés datos de la base real, copiala antes con `tools/copy_db.mjs`.
import { DatabaseSync } from 'node:sqlite';

const ruta = process.argv[2] ?? 'backup/revision_f67.db';
const db = new DatabaseSync(ruta, { readOnly: true });

console.log(`BASE: ${ruta}`);
const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log(`\nTABLAS (${t.length}):`);
for (const x of t) {
  const cols = db.prepare(`PRAGMA table_info("${x.name}")`).all();
  const n = db.prepare(`SELECT COUNT(*) c FROM "${x.name}"`).get().c;
  console.log(`  ${x.name.padEnd(22)} filas=${String(n).padStart(6)}  ·  ${cols.map(c => c.name).join(', ')}`);
}

console.log('\nSETTINGS (los valores sensibles recortados):');
for (const s of db.prepare("SELECT key, substr(COALESCE(value,''),1,40) v FROM settings ORDER BY key").all()) {
  console.log(`  ${s.key} = ${s.v}`);
}

console.log('\nÍNDICES:', db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index'").get().n);
db.close();
