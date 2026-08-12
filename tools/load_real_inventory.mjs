// Carga el inventario REAL de pantallas (tools/inventario_real.txt) en registro.db.
// Reglas:
//  - Cada línea "<modelo> (N)" = una pantalla física, stock = N, precio $0.
//  - "/" separa modelos compatibles (ej. "A30/A50" -> compatible con Samsung A30 y Samsung A50).
//  - Fusiona con el catálogo existente (no borra): el producto que más coincide recibe el
//    stock N y la compatibilidad fusionada; los demás coincidentes quedan en stock 0.
//  - Al final: TODOS los precios del catálogo a $0 (price_sale y price_cost).
// Uso: node tools/load_real_inventory.mjs
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Depuración: si existe, el load se ejecuta sobre este archivo (sin tocar registro.db).
const DB_DEBUG = process.env.DB_DEBUG || null;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = DB_DEBUG ? path.resolve(DB_DEBUG) : path.join(root, 'registro.db');
const DATA = path.join(root, 'tools', 'inventario_real.txt');
const CAT_PANTALLA = 1;

const BRANDS = ['samsung', 'redmi', 'tecno', 'xiaomi', 'infinix', 'oppo', 'apple', 'motorola', 'huawei', 'vivo', 'realme', 'nokia', 'zte', 'honor', 'lg', 'itel', 'poco', 'alcatel', 'iphone', 'lifephone'];

function norm(s) {
  return String(s).toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseData() {
  const lines = readFileSync(DATA, 'utf8').split(/\r?\n/).map(l => l.trim());
  const items = [];
  let brand = null;
  for (const raw of lines) {
    if (!raw) continue;
    if (BRANDS.includes(raw.toLowerCase())) { brand = raw; continue; }
    if (!brand) continue;
    const m = raw.match(/^(.*?)\s*\((\d+)\)\s*$/);
    const modelRaw = m ? m[1] : raw;
    const stock = m ? parseInt(m[2], 10) : 0;
    const model = modelRaw.replace(/\s+/g, ' ').replace(/[.,]\s*$/, '').trim();
    if (!model) continue;
    items.push({ brand, model, stock });
  }
  return items;
}

// Dedupe por (brand, modelo normalizado): queda la última línea (artefactos de pega, ej. "Redmi 9" x2).
function dedupe(items) {
  const byKey = new Map();
  for (const it of items) {
    const key = `${norm(it.brand)}|${norm(it.model)}`;
    byKey.set(key, it);
  }
  return [...byKey.values()];
}

function partsOf(model) {
  return model.split('/').map(s => s.trim()).filter(s => s.length >= 2);
}

// Si la parte ya empieza con la marca (o alias), se conserva tal cual;
// si no, se le antepone la marca canónica de la sección ("Redmi 9" -> "Redmi 9",
// "Spark 10 Pro" (Tecno) -> "Tecno Spark 10 Pro", "11 Pro" (Iphone) -> "Apple 11 Pro").
function brandPart(brand, part) {
  const pw = words(norm(part));
  if (pw.length > 0 && brandAliases(brand).includes(pw[0])) return part;
  return `${canonicalBrand(brand)} ${part}`;
}

function compatEntries(brand, parts) {
  return parts.map(p => brandPart(brand, p).trim());
}

// ¿partWords es prefijo de entryWords comenzando en `start`?
function wordPrefixAt(partWords, entryWords, start) {
  if (partWords.length === 0 || start + partWords.length > entryWords.length) return false;
  for (let i = 0; i < partWords.length; i++) {
    if (entryWords[start + i] !== partWords[i]) return false;
  }
  return true;
}

function words(n) {
  return n ? n.split(' ') : [];
}

// Aliases de marca: Redmi/Poco/Mi son submarcas de Xiaomi; "Red Note" = Redmi Note.
// "Iphone" en el Excel consolida a "Apple" en el catálogo.
function brandAliases(brand) {
  const b = norm(brand);
  if (b === 'samsung') return ['samsung'];
  if (['xiaomi', 'redmi', 'poco', 'mi', 'red'].includes(b)) return ['xiaomi', 'redmi', 'poco', 'mi', 'red'];
  if (b === 'iphone') return ['iphone', 'apple'];
  return [b];
}

// Marca canónica para nombres/compat: la sección del Excel se escribe tal cual,
// excepto "Iphone" -> "Apple" (los productos del catálogo usan Apple).
function canonicalBrand(brand) {
  return norm(brand) === 'iphone' ? 'Apple' : brand;
}

// Un entry de compatibility ("Samsung A30 A305") matchea la parte "A30" de una línea
// Samsung si: la parte inicia el entry SIN marca (modelo desnudo) o el entry empieza
// con una marca compatible y la parte la sigue. Esto evita que "Samsung A11" matchee
// "Umidigi A11" o que "Samsung A35" matchee "Zte A35".
function entryMatches(entry, partWords, brand) {
  const ew = words(norm(entry));
  if (wordPrefixAt(partWords, ew, 0)) return true;
  if (ew.length > 1 && brandAliases(brand).includes(ew[0]) && wordPrefixAt(partWords, ew, 1)) return true;
  return false;
}

function matchScore(parts, product, brand) {
  let score = 0;
  // GATE: el producto debe ser de la misma marca (o marca afín) que la línea.
  // Entries sin marca ("A11" de Umidigi) NO matchean líneas Samsung.
  const productBrand = norm(product.brand);
  if (productBrand && !brandAliases(brand).includes(productBrand)) return 0;
  const entries = parseCompat(product.compatibility);
  for (const p of parts) {
    const pw = words(norm(p));
    if (entries.some(e => entryMatches(e, pw, brand))) {
      score++;
    } else if (entries.length === 0 && product.model &&
      wordPrefixAt(pw, words(norm(product.model)), 0)) {
      // Fallback modelo desnudo SOLO sin compat curada.
      score++;
    }
  }
  return score;
}

function parseCompat(c) {
  if (!c) return [];
  try {
    const l = JSON.parse(c);
    if (Array.isArray(l)) return l.filter(x => typeof x === 'string');
  } catch { /* texto plano */ }
  return String(c).split('/').map(s => s.trim()).filter(Boolean);
}

function unionCompat(existing, added) {
  const seen = new Set(existing.map(norm));
  const out = [...existing];
  for (const a of added) {
    if (!seen.has(norm(a))) { seen.add(norm(a)); out.push(a); }
  }
  return JSON.stringify(out);
}

function load(print = true) {
  if (!existsSync(SRC)) { console.error(`No existe ${SRC}`); process.exit(1); }

  // Backup antes de tocar nada
  const backupDir = path.join(root, 'backup');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backupPath = path.join(backupDir, `registro_backup_inventario_real_${stamp}.db`);

  let srcDb = null;
  try {
    srcDb = new DatabaseSync(SRC);
    srcDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    srcDb?.close();
  }
  copyFileSync(SRC, backupPath);

  const db = new DatabaseSync(SRC);
  db.exec('PRAGMA busy_timeout=5000');
  const items = dedupe(parseData());
  const products = db.prepare(
    'SELECT id, name, brand, model, variant, compatibility, stock FROM products WHERE category_id=? ORDER BY id'
  ).all(CAT_PANTALLA);

  const normModel = norm;
  const pantallaByNorm = new Map(); // norm(entry|model) -> product
  for (const p of products) {
    for (const n of [norm(p.model), ...parseCompat(p.compatibility).map(norm)]) {
      if (n && !pantallaByNorm.has(n)) pantallaByNorm.set(n, p);
    }
  }

  const insertStmt = db.prepare(
    'INSERT INTO products (name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock) VALUES (?,?,?,?,?,?,0,0,?,0)'
  );
  const updateStockStmt = db.prepare('UPDATE products SET stock=?, price_sale=0, price_cost=0, updated_at=datetime(\'now\',\'localtime\') WHERE id=?');
  const updateCompatStmt = db.prepare('UPDATE products SET compatibility=?, stock=?, price_sale=0, price_cost=0, updated_at=datetime(\'now\',\'localtime\') WHERE id=?');

  let created = 0, updated = 0, zeroed = 0, sweep = null, stockSweep = null;
  const touched = new Set();
  const claimed = new Set();
  const setByProduct = new Map();
  const dbLog = [];
  const landings = [];
  const report = [];
  db.exec('BEGIN');

  try {
    for (const it of items) {
      const parts = partsOf(it.model);
      const added = compatEntries(it.brand, parts);
      const scored = products
        .map(p => ({ p, s: matchScore(parts, p, it.brand) }))
        .filter(x => x.s > 0)
        .sort((a, b) =>
          b.s - a.s ||
          (a.p.variant === '' ? -1 : 1) - (b.p.variant === '' ? -1 : 1) ||
          a.p.id - b.p.id
        );
      if (scored.length === 0) {
        // Sin candidato en catálogo -> producto nuevo
        created++;
        insertStmt.run(
          `Pantalla ${brandPart(it.brand, parts.join('/'))}`, CAT_PANTALLA, canonicalBrand(it.brand), parts.join('/'), '',
          JSON.stringify(added), it.stock
        );
        const newId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
        touched.add(newId);
        report.push(`+ ${it.brand} ${it.model} (${it.stock})`);
        landings.push({ bin: newId, binName: '(nuevo)', line: `${it.brand} ${it.model}`, stock: it.stock });
      } else {
        // Mejor candidato AÚN NO reclamado -> recibe stock + compat fusionada.
        // Si todos los candidatos ya fueron reclamados (otra línea es del mismo tipo),
        // se CREA un producto propio para esta línea (cada línea = stock físico real).
        const primary = scored.find(x => !claimed.has(x.p.id)) || null;
        if (primary) {
          claimed.add(primary.p.id);
          const prev = setByProduct.get(primary.p.id);
          if (prev) {
            dbLog.push(`COLISION ${primary.p.name}: ${prev.line} (${prev.stock}) -> ${it.brand} ${it.model} (${it.stock})`);
          }
          setByProduct.set(primary.p.id, { line: `${it.brand} ${it.model}`, stock: it.stock });
          landings.push({ bin: primary.p.id, binName: primary.p.name, line: `${it.brand} ${it.model}`, stock: it.stock });
          updateCompatStmt.run(unionCompat(parseCompat(primary.p.compatibility), added), it.stock, primary.p.id);
          updated++;
          touched.add(primary.p.id);
          report.push(`~ ${it.brand} ${it.model} (${it.stock}) -> ${primary.p.name}`);
          for (const { p } of scored) {
            if (p.id === primary.p.id) continue;
            // Candidatos alternativos (variantes del mismo bin): stock 0,
            // pero NUNCA si otra línea ya lo reclamó como principal.
            if (claimed.has(p.id)) continue;
            updateStockStmt.run(0, p.id);
            zeroed++;
            touched.add(p.id);
          }
        } else {
          created++;
          dbLog.push(`COLISION SIN BIN: ${it.brand} ${it.model} (${it.stock}) -> producto propio (todos los candidatos reclamados)`);
          insertStmt.run(
            `Pantalla ${brandPart(it.brand, parts.join('/'))}`, CAT_PANTALLA, it.brand, parts.join('/'), '',
            JSON.stringify(added), it.stock
          );
          const newId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
          touched.add(newId);
          report.push(`+ ${it.brand} ${it.model} (${it.stock})`);
          landings.push({ bin: newId, binName: '(nuevo x colisión)', line: `${it.brand} ${it.model}`, stock: it.stock });
        }
      }
    }
    // TODOS los precios a cero (el usuario cobra en el mostrador)
    sweep = db.prepare('UPDATE products SET price_sale=0, price_cost=0, updated_at=datetime(\'now\',\'localtime\')').run();
    // Pantallas que NO están en la lista real -> stock 0 (sin borrar)
    const touchedSql = [...touched].join(',') || '0';
    stockSweep = db.prepare(
      `UPDATE products SET stock=0, updated_at=datetime('now','localtime') WHERE category_id=? AND id NOT IN (${touchedSql})`
    ).run(CAT_PANTALLA);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  if (print) {
    console.log(`Backup: ${backupPath}`);
    console.log(`Líneas parseadas: ${items.length} | Creadas: ${created} | Actualizadas: ${updated} | Coincidentes a stock 0: ${zeroed}`);
    console.log(`Precios puestos en 0: ${sweep.changes} productos | Pantallas fuera de la lista -> stock 0: ${stockSweep.changes}`);
    // Verificación: cada bin debe tener exactamente la suma de sus líneas
    const mismatches = [];
    const perBin = new Map();
    for (const l of landings) perBin.set(l.bin, (perBin.get(l.bin) || 0) + l.stock);
    for (const [id, expect] of perBin) {
      const row = db.prepare('SELECT name, stock FROM products WHERE id=?').get(id);
      if (!row || Math.abs(row.stock - expect) > 0.001) mismatches.push(`  ! ${row?.name || id}: esperado ${expect}, real ${row?.stock}`);
    }
    console.log(`Landings verificados: ${landings.length} líneas | Descuadres: ${mismatches.length}`);
    for (const mm of mismatches) console.log(mm);
    const sumStock = db.prepare('SELECT COALESCE(SUM(stock),0) s FROM products WHERE category_id=?').get(CAT_PANTALLA).s;
    console.log(`Stock total pantallas en DB: ${sumStock}`);
    for (const d of dbLog) console.log('  ' + d);
    const slice = process.env.DB_DEBUG_ALL ? report : report.slice(0, 60);
    for (const r of slice) console.log('  ' + r);
    if (!process.env.DB_DEBUG_ALL && report.length > 60) console.log(`  ... (+${report.length - 60} más)`);
  }

  const totals = db.prepare(
    'SELECT brand, COUNT(*) AS n, COALESCE(SUM(stock),0) AS stock FROM products WHERE category_id=? GROUP BY brand ORDER BY n DESC'
  ).all(CAT_PANTALLA);
  if (print) {
    console.log('Totales por marca (categoría Pantalla):');
    for (const t of totals) console.log(`  ${t.brand || '(sin marca)'}: ${t.n} productos, ${t.stock} unidades`);
    const zeroPriced = db.prepare('SELECT COUNT(*) AS c FROM products WHERE price_sale<>0 OR price_cost<>0').get();
    console.log(`Productos con precio != 0 restantes: ${zeroPriced.c}`);
  }
  db.close();
}

load();
