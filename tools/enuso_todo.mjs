// F64 — «TODO EN USO»: el cliente destilda lo que no usa (pedido del dueño, 2026-09-21).
//
// Qué hace: pone `in_use = 1` en TODOS los productos y TODOS los modelos de las bases que se le
// pasen, con RESPALDO previo (`backup/<nombre>_pre_enuso_<fecha>.db`). Es idempotente y solo toca esa
// columna: no cambia stock, precios, códigos ni compatibilidades.
//
// Uso:
//   node tools/enuso_todo.mjs registro.db backup/f56_fixture.db
//   node tools/enuso_todo.mjs --check registro.db        (solo informa, no escribe)
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const bases = args.filter(a => !a.startsWith('--'));
if (!bases.length) { console.error('Uso: node tools/enuso_todo.mjs [--check] <base.db> [otra.db …]'); process.exit(1); }

const hoy = new Date();
const sello = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;

for (const b of bases) {
  if (!existsSync(b)) { console.error(`· ${b}: no existe (salteada)`); continue; }
  if (!CHECK) {
    const respaldo = path.join(path.dirname(b), `${path.basename(b, '.db')}_pre_enuso_${sello}.db`);
    copyFileSync(b, respaldo);
    console.log(`· ${b}: respaldo en ${respaldo}`);
  }
  const db = new DatabaseSync(b, { readOnly: CHECK });
  const cuenta = (t) => {
    try {
      return db.prepare(`SELECT COUNT(*) t, SUM(CASE WHEN COALESCE(in_use,1) = 0 THEN 1 ELSE 0 END) apagados FROM ${t}`).get();
    } catch { return null; }
  };
  const antes = { products: cuenta('products'), phones: cuenta('phones') };
  if (!CHECK) {
    db.exec('BEGIN');
    db.prepare('UPDATE products SET in_use = 1').run();
    db.prepare('UPDATE phones SET in_use = 1').run();
    db.exec('COMMIT');
  }
  const despues = { products: cuenta('products'), phones: cuenta('phones') };
  const f = (r) => r ? `${r.t} filas, ${r.apagados ?? 0} apagadas` : 'sin tabla';
  console.log(`  productos: ${f(antes.products)}${CHECK ? '' : ` → ${f(despues.products)}`}`);
  console.log(`  modelos:   ${f(antes.phones)}${CHECK ? '' : ` → ${f(despues.phones)}`}`);
  db.close();
}
