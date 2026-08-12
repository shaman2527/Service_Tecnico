// Verificación post-carga del inventario real de pantallas.
// Uso: node tools/verify_inventory.mjs
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(path.join(root, 'registro.db'), { readOnly: true });

const checks = [
  ['precios != 0', 'SELECT COUNT(*) c FROM products WHERE price_sale<>0 OR price_cost<>0'],
  ["pantallas sin marca", "SELECT COUNT(*) c FROM products WHERE category_id=1 AND (brand IS NULL OR brand='')"],
  ["compat con 'Samsung A11' (contaminación)", "SELECT COUNT(*) c FROM products WHERE category_id=1 AND compatibility LIKE '%Samsung A11%'"],
  ['compat con "Samsung A35" (contaminación)', "SELECT COUNT(*) c FROM products WHERE category_id=1 AND compatibility LIKE '%Samsung A35%'"],
  ['total productos', 'SELECT COUNT(*) c FROM products'],
  ['total pantallas', 'SELECT COUNT(*) c FROM products WHERE category_id=1'],
  ['stock total pantallas (esperado 281)', 'SELECT SUM(stock) s FROM products WHERE category_id=1'],
  ['Umidigi/Zte con stock (no debe haber)', "SELECT COUNT(*) c FROM products WHERE category_id=1 AND stock<>0 AND brand IN ('Umidigi','Zte')"],
];

for (const [label, sql] of checks) {
  const r = db.prepare(sql).get();
  console.log(`${label}: ${r.c ?? r.s}`);
}

console.log('--- Spot checks ---');
for (const [label, sql] of [
  ['SPARK 10 PRO', "SELECT stock, name FROM products WHERE name LIKE '%SPARK 10 PRO%' AND category_id=1"],
  ['Spark Go 2024', "SELECT stock, name FROM products WHERE name LIKE '%Spark Go 2024%' AND category_id=1"],
  ['A52 A525', "SELECT stock, name FROM products WHERE name LIKE '%A52 4G A525%' AND category_id=1"],
  ['REDMI 9', "SELECT stock, name FROM products WHERE name LIKE '%REDMI 9%' AND category_id=1 LIMIT 4"],
  ['A35', "SELECT stock, name FROM products WHERE name LIKE '%Samsung A35 5G%' AND category_id=1"],
]) {
  console.log(`-- ${label}`);
  for (const r of db.prepare(sql).all()) console.log(`   ${r.stock} | ${r.name}`);
}
