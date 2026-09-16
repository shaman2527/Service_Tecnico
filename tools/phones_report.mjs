// Diagnóstico del padrón de teléfonos: duplicados de nombre y ubicación de familias.
// Uso: node tools/phones_report.mjs [--db ruta]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--db');
const dbPath = path.resolve(ROOT, i >= 0 ? argv[i + 1] : 'backup/registro_pre_normalizacion_20260915.db');

const db = new DatabaseSync(dbPath, { readOnly: true });
const one = (sql, p = []) => db.prepare(sql).get(...p).c;
const all = (sql, p = []) => db.prepare(sql).all(...p);

console.log(`PADRÓN DE TELÉFONOS · ${path.relative(ROOT, dbPath)}`);
console.log(`  teléfonos: ${one('select count(*) c from phones')}`);
console.log(`  claves repetidas: ${one('select count(*) c from (select key from phones group by key having count(*)>1)')}`);
console.log(`  NOMBRES repetidos: ${one("select count(*) c from (select name from phones group by lower(name) having count(*)>1)")}`);
console.log(`  por revisar (sin familia): ${one('select count(*) c from phones where needs_review=1')}`);
console.log(`  marcas: ${one('select count(distinct brand) c from phones')}`);

console.log('\n-- nombres repetidos --');
for (const r of all("select name, group_concat(key, ' | ') keys, group_concat(distinct brand) brands, count(*) c from phones group by lower(name) having c>1 order by c desc limit 10")) {
  console.log(`  ${r.name}  [${r.brands}]  ->  ${r.keys}`);
}

console.log('\n-- familias que deberían fijar la marca (Camon/Spark= Tecno, Hot/Smart= Infinix) --');
for (const r of all("select brand, name, key from phones where lower(name) like '%camon%' or lower(name) like '%spark%' or lower(name) like '%hot %' order by brand, name limit 12")) {
  console.log(`  ${r.brand} | ${r.name} | ${r.key}`);
}

console.log('\n-- ejemplos por marca --');
for (const b of ['Samsung', 'Motorola', 'Apple', 'Xiaomi', 'Tecno', 'Infinix', 'Honor', 'Huawei', 'ZTE', 'Alcatel', 'Blu', 'Oppo']) {
  const n = one('select count(*) c from phones where brand=?', [b]);
  const ej = all('select name from phones where brand=? order by name limit 3', [b]).map(r => r.name).join(' | ');
  console.log(`  ${b.padEnd(9)}${String(n).padStart(5)}  ${ej}`);
}
db.close();
