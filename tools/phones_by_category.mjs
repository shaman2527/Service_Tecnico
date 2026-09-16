// ¿Cuántos teléfonos salen SOLO de la categoría Pantalla?
// Uso: node tools/phones_by_category.mjs [--db ruta]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--db');
const dbPath = path.resolve(ROOT, i >= 0 ? argv[i + 1] : 'backup/registro_pre_normalizacion_20260915.db');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const LINES = ['galaxy', 'moto', 'redmi', 'poco', 'mi', 'iphone', 'ipad'];
const keyOf = (entry) => {
  let t = norm(entry.replace(/\([^)]*\)?/g, ' '));
  const w = t.split(' ').filter(Boolean);
  const brand = w[0] || '';
  const rest = w.slice(1).filter(x => !LINES.includes(x));
  return `${brand}|${rest.join(' ')}`;
};

const db = new DatabaseSync(dbPath, { readOnly: true });
const cats = new Map(db.prepare('SELECT id, name FROM categories').all().map(c => [c.id, c.name]));
const sets = new Map(); // categoría -> Set(claves)
for (const p of db.prepare("SELECT category_id, brand, compatibility FROM products WHERE COALESCE(compatibility,'') NOT IN ('','[]')").all()) {
  const cat = cats.get(p.category_id) ?? '(sin categoría)';
  if (!sets.has(cat)) sets.set(cat, new Set());
  let list = [];
  try { const j = JSON.parse(p.compatibility); if (Array.isArray(j)) list = j.map(String); } catch { list = String(p.compatibility).split('/'); }
  for (const e of list) {
    const k = keyOf(String(e).trim());
    if (k.length > 3 && !/^[a-z]+\|$/.test(k)) sets.get(cat).add(k);
  }
}
console.log(`¿DE DÓNDE SALEN LOS TELÉFONOS?  (${path.basename(dbPath)})`);
const todas = new Set();
for (const [cat, s] of [...sets.entries()].sort((a, b) => b[1].size - a[1].size)) {
  console.log(`  ${cat.padEnd(16)} ${String(s.size).padStart(5)} teléfonos distintos`);
  for (const k of s) todas.add(k);
}
const pantalla = sets.get('Pantalla') ?? new Set();
console.log(`  ${'— TOTAL —'.padEnd(16)} ${String(todas.size).padStart(5)}`);
console.log(`  solo Pantalla: ${pantalla.size}  |  teléfonos que existen SOLO en otras categorías: ${todas.size - pantalla.size}`);
console.log(`  en el padrón actual: ${db.prepare('SELECT COUNT(*) c FROM phones').get().c}`);
db.close();
