// Verificación post-limpieza: stock/precios en 0, sin duplicados y compatibilidad unida.
// Uso: node tools/verify_clean_inventory.mjs [--db ruta]
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

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const LINES = ['galaxy', 'moto', 'redmi', 'poco', 'mi', 'iphone', 'ipad'];
const keyOf = (brand, model, variant) => {
  const b = norm(brand);
  const w = norm(model).split(' ').filter(Boolean).filter(x => !LINES.includes(x));
  return `${b}|${w.join(' ')}|${norm(variant)}`;
};

console.log(`VERIFICACIÓN · ${path.relative(ROOT, dbPath)}`);
console.log(`  productos: ${one('select count(*) c from products')}`);
console.log(`  con stock ≠ 0: ${one('select count(*) c from products where stock<>0')}`);
console.log(`  con precio ≠ 0 (costo/venta/efectivo): ${one('select count(*) c from products where coalesce(price_cost,0)<>0 or coalesce(price_sale,0)<>0 or coalesce(price_usd,0)<>0')}`);
console.log(`  unidades totales: ${one('select coalesce(sum(stock),0) c from products')}`);

const groups = new Map();
for (const p of db.prepare('select brand, model, variant, name, compatibility from products').all()) {
  const k = keyOf(p.brand, p.model, p.variant);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}
const dups = [...groups.values()].filter(g => g.length > 1);
console.log(`  grupos de productos duplicados: ${dups.length}`);
for (const g of dups.slice(0, 5)) console.log(`    ! ${g.map(x => x.name).join(' + ')}`);

console.log(`  teléfonos en el padrón: ${one('select count(*) c from phones')}`);
console.log(`  claves de teléfono repetidas: ${one('select count(*) c from (select key from phones group by key having count(*)>1)')}`);
console.log(`  movimientos de inventario conservados: ${one('select count(*) c from inventory_movements')}`);
console.log(`  ventas: ${one('select count(*) c from sales')} | servicios: ${one('select count(*) c from services')}`);

// muestra: un producto que se fusionó (el de mayor compatibilidad)
console.log('\n  ejemplos de fichas con más compatibilidad (top 5):');
for (const p of db.prepare("select name, json_array_length(compatibility) n from products where compatibility like '[%' order by n desc limit 5").all()) {
  console.log(`    ${String(p.n).padStart(2)} teléfonos · ${p.name}`);
}
db.close();
