#!/usr/bin/env node
// ============================================================================
// Auditoría READ-ONLY del catálogo/inventario de Registro.
// NO escribe en la base: solo lee, reporta anomalías y (opcional) guarda un
// snapshot JSON para comparar ANTES/DESPUÉS de la normalización.
//
// Uso:
//   node tools/audit_inventory.mjs
//   node tools/audit_inventory.mjs --db backup/copia.db
//   node tools/audit_inventory.mjs --snapshot tools/progress/artifacts/antes.json
//   node tools/audit_inventory.mjs --json > reporte.json
//   node tools/audit_inventory.mjs --gen-fixtures     (paridad con Rust)
//   node tools/audit_inventory.mjs --gen-split-fixtures (paridad del split, F55)
//
// Las reglas canónicas vienen de tools/canonical_brands.json (misma fuente que
// usa el backend Rust en catalog.rs). Este script REPORTA; quien ESCRIBE es
// Rust. Si los conteos de este reporte y el dry-run de Rust no coinciden, hay
// divergencia de reglas y se corrige antes de aplicar nada.
//
// OJO (F55): la regla del SPLIT de entradas compuestas está copiada a mano aquí
// (el script no puede llamar a Rust), así que su paridad se fija con el fixture
// tools/split_fixtures.json + el test `catalog::tests::test_split_model_models_match_node_fixtures`.
// Si se toca `splitModelModels` de este archivo, hay que regenerar el fixture o
// el test de Rust falla a propósito.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RULES = JSON.parse(fs.readFileSync(path.join(HERE, 'canonical_brands.json'), 'utf8'));

// ---------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const DB_PATH = path.resolve(ROOT, arg('--db', path.join(ROOT, 'registro.db')));
const SNAPSHOT = arg('--snapshot', null);
const AS_JSON = argv.includes('--json');
const MAX_SAMPLES = Number(arg('--samples', '6'));

// ------------------------------------------------------------------ reglas
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

// alias de marca -> marca canónica (el alias más largo gana: "google pixel" > "google")
const BRAND_ALIASES = [];
for (const [brand, aliases] of Object.entries(RULES.brands)) {
  for (const a of aliases) BRAND_ALIASES.push([norm(a), brand]);
}
BRAND_ALIASES.sort((a, b) => b[0].length - a[0].length);

// marca canónica -> sus alias normalizados (el más largo primero)
const BRAND_REVERSE = new Map();
for (const [brand, aliases] of Object.entries(RULES.brands)) {
  BRAND_REVERSE.set(brand, aliases.map(norm).sort((a, b) => b.length - a.length));
}

// alias de submarca -> marca padre ("red" -> "Xiaomi")
const SUB_ALIASES = [];
for (const [parent, subs] of Object.entries(RULES.subBrands ?? {})) {
  for (const alias of Object.keys(subs)) SUB_ALIASES.push([norm(alias), parent]);
}
SUB_ALIASES.sort((a, b) => b[0].length - a[0].length);

const ACRONYMS = new Set(RULES.acronyms.map((a) => a.toUpperCase()));
const LOWER_SUFFIX = new Set(RULES.lowerSuffixBrands);
const STYLED = new Map(Object.entries(RULES.styledTokens ?? {}).map(([k, v]) => [norm(k), v]));

// Marca canónica de la columna brand. "Redmi" no es marca: es la línea Redmi de
// Xiaomi (decisión del local), así que apunta a Xiaomi.
function canonicalBrand(raw) {
  const n = norm(raw);
  if (!n) return { brand: 'Genérico', changed: true, matched: false };
  for (const [alias, brand] of BRAND_ALIASES) {
    if (n === alias) return { brand, changed: brand !== String(raw).trim(), matched: true };
  }
  for (const [alias, parent] of SUB_ALIASES) {
    if (n === alias) return { brand: parent, changed: true, matched: true, sub: true };
  }
  for (const [alias, brand] of BRAND_ALIASES) {
    if (n.startsWith(`${alias} `)) return { brand, changed: true, matched: true, partial: true };
  }
  return { brand: String(raw).trim(), changed: false, matched: false };
}

// Marca explícita al inicio de un texto ("HONOR X7" -> "Honor"), o null.
function explicitBrandOf(text) {
  const n = norm(text);
  for (const [alias, brand] of BRAND_ALIASES) if (n.startsWith(`${alias} `)) return brand;
  for (const [alias, parent] of SUB_ALIASES) if (n === alias || n.startsWith(`${alias} `)) return parent;
  return null;
}

// Un modelo "bien escrito": guiones como espacio, Title Case por palabra,
// códigos alfanuméricos en mayúscula (A06, X7B, 13C), acrónimos en mayúscula
// (4G, 5G, AM, OLED), sufijo i/s minúscula en Infinix/Tecno ("Hot 40i"),
// grafía real de Apple ("iPhone") y submarca normalizada ("Red" -> "Redmi").
function canonicalModel(raw, brand) {
  const subs = Object.entries(RULES.subBrands?.[brand] ?? {})
    .map(([alias, canonical]) => [norm(alias), canonical])
    .sort((a, b) => b[0].length - a[0].length);

  const canonicalPart = (partRaw) => {
    let text = String(partRaw ?? '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const n = norm(text);
    for (const [alias, canonical] of subs) {
      if (n === alias || n.startsWith(`${alias} `)) {
        const rest = text.split(' ').slice(alias.split(' ').length).join(' ');
        text = rest ? `${canonical} ${rest}` : canonical;
        break;
      }
    }
    return text.split(' ').map((token) => {
      const t = token.trim();
      if (!t) return '';
      const key = norm(t);
      if (STYLED.has(key)) return STYLED.get(key);
      const upper = t.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      if (/\d/.test(t)) {
        // sufijo i/s en minúscula SOLO para Infinix/Tecno ("HOT 30I" -> "Hot 30i"),
        // pero "Spark 10C" y "Spark 8P" se quedan en mayúscula (así los escribe el local)
        if (/^\d+[iIsS]$/.test(t) && LOWER_SUFFIX.has(brand)) return t.slice(0, -1) + t.slice(-1).toLowerCase();
        return upper;
      }
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    }).filter(Boolean).join(' ');
  };

  return String(raw ?? '').split('/').map(canonicalPart).filter(Boolean).join(' / ');
}

function parseCompat(raw) {
  if (!raw) return [];
  try {
    const l = JSON.parse(raw);
    if (Array.isArray(l)) return l.map((x) => String(x).trim()).filter(Boolean);
  } catch { /* texto plano */ }
  return String(raw).split('/').map((s) => s.trim()).filter(Boolean);
}

// Quita la marca repetida al inicio del modelo ("Samsung A06 4G" con marca
// Samsung -> "A06 4G"; "AMAZON FIRE 7 HD" sin marca -> "Fire 7 HD").
// NUNCA quita sub-marcas: "iPhone 11" conserva el iPhone.
function stripBrandPrefix(model, brand) {
  const aliases = BRAND_REVERSE.get(brand) ?? [];
  const n = norm(model);
  for (const alias of aliases) {
    if (n.startsWith(`${alias} `)) {
      const rest = String(model).trim().split(/\s+/).slice(alias.split(' ').length).join(' ').trim();
      if (rest) return rest;
    }
  }
  return null;
}

// Etiqueta canónica de un teléfono: "Marca [Submarca] Modelo".
function canonicalPhone(entry, inheritedBrand) {
  const text = String(entry ?? '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const n = norm(text);
  for (const [alias, brand] of BRAND_ALIASES) {
    if (n.startsWith(`${alias} `)) {
      const rest = text.split(' ').slice(alias.split(' ').length).join(' ');
      const model = canonicalModel(rest, brand);
      return { brand, model, label: `${brand} ${model}`.trim() };
    }
  }
  // submarca (iPhone, Redmi, Poco…): la marca es la padre y el modelo conserva la submarca
  for (const [alias, parent] of SUB_ALIASES) {
    if (n === alias || n.startsWith(`${alias} `)) {
      const model = canonicalModel(text, parent);
      return { brand: parent, model, label: `${parent} ${model}`.trim() };
    }
  }
  const brand = inheritedBrand || 'Genérico';
  const model = canonicalModel(text, brand);
  return { brand, model, label: `${brand} ${model}`.trim() };
}

// F53 — PARTIR EL TEXTO DE UN MODELO EN TELÉFONOS REALES (espejo de `catalog::split_model_models`):
// un «código» es un token con LETRAS Y DÍGITOS (`A70`, `A705`, `MS350`), sin los sufijos de red
// (4G/5G/LTE) ni los números puros (11, 2019). Con 2+ códigos se parte: cada parte es
// [palabras de familia] + [código] + [palabras hasta el próximo código].
function isModelCode(token) {
  const t = norm(token);
  if (!t || ['2g', '3g', '4g', '5g', 'lte'].includes(t)) return false;
  return /[a-z]/.test(t) && /\d/.test(t);
}
function splitModelModels(model) {
  const texto = String(model ?? '').trim();
  if (!texto) return [''];
  const toks = texto.split(/\s+/);
  const codes = toks.map((t, i) => (isModelCode(t) ? i : -1)).filter((i) => i >= 0);
  if (codes.length < 2) return [texto];
  const prefijo = toks.slice(0, codes[0]);
  const partes = [];
  codes.forEach((ci, n) => {
    const end = n + 1 < codes.length ? codes[n + 1] : toks.length;
    const parte = [...prefijo, ...toks.slice(ci, end)].join(' ').trim();
    if (!parte || partes.some((p) => norm(p) === norm(parte))) return;
    partes.push(parte);
  });
  return partes.length >= 2 ? partes : [texto];
}

// El padrón REAL de la app (tabla `phones`), cuando la copia auditada ya la tiene: es el número que
// ve el local. El conteo del script (`teléfonos distintos… (script)`) es una aproximación propia.
function hasPhonesTable() {
  try { return all("SELECT name FROM sqlite_master WHERE type='table' AND name='phones'").length > 0; } catch { return false; }
}
function countPhones() {
  try { return all('SELECT COUNT(*) AS n FROM phones')[0]?.n ?? 0; } catch { return 0; }
}

// Clave de agrupación del teléfono: marca + modelo SIN las submarcas
// "strippables" (Xiaomi red/redmi). Así "Xiaomi Redmi Note 11S 4G" y
// "Xiaomi Note 11S 4G" son el MISMO teléfono, pero "Xiaomi Mi A2" y
// "Xiaomi Redmi A2" siguen siendo DOS.
function phoneKey(phone) {
  let m = norm(phone.model);
  for (const alias of RULES.subBrandKeyStrippable?.[phone.brand] ?? []) {
    const a = norm(alias);
    if (m === a) { m = ''; break; }
    if (m.startsWith(`${a} `)) { m = m.slice(a.length + 1); break; }
  }
  return `${norm(phone.brand)}|${m}`;
}

// Equivalente EXACTO de catalog.rs::normalize_fields (paridad verificada con
// tools/canonical_fixtures.json + test de Rust).
function normalizeFields(category, brandRaw, modelRaw, variantRaw, compatibilityRaw) {
  const brandIn = String(brandRaw ?? '').trim();
  const modelIn = String(modelRaw ?? '').trim();

  let brand = brandIn ? canonicalBrand(brandIn).brand
    : (explicitBrandOf(modelIn) ?? 'Genérico');
  if (!brand) brand = 'Genérico';

  // la marca repetida al inicio del modelo no se duplica en el nombre
  const modelClean = stripBrandPrefix(modelIn, brand) ?? modelIn;
  const cModelFull = canonicalModel(modelClean, brand);

  const entries = parseCompat(compatibilityRaw);
  let currentBrand = brand;
  const byKey = new Map();
  for (const entry of entries) {
    const explicit = explicitBrandOf(entry);
    if (explicit) currentBrand = explicit;
    // F53 — MISMA regla que `catalog::split_model_models` de la app: una entrada puede nombrar
    // VARIOS teléfonos («Samsung A70 A705» → A70 + A705). Sin esto, el reporte cuenta menos
    // teléfonos que el padrón de la app y los dos números no se pueden comparar.
    const base = canonicalPhone(entry, currentBrand);
    for (const parte of splitModelModels(base.model)) {
      const phone = canonicalPhone(`${base.brand} ${parte}`, currentBrand);
      const key = phoneKey(phone);
      const prev = byKey.get(key);
      if (!prev || phone.label.length > prev.length) byKey.set(key, phone.label);
    }
  }

  const primaryKey = phoneKey(canonicalPhone(cModelFull.split(' / ')[0] ?? cModelFull, brand));
  const labels = [...byKey.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'es'));
  const pos = labels.findIndex((l) => phoneKey(canonicalPhone(l, brand)) === primaryKey);
  if (pos > 0) labels.unshift(...labels.splice(pos, 1));

  const display = labels.length === 0
    ? [cModelFull]
    : labels.map((l) => (l.toLowerCase().startsWith(`${brand.toLowerCase()} `) ? l.slice(brand.length + 1) : l));

  const variant = canonicalModel(String(variantRaw ?? '').trim(), brand);
  const name = `${category} ${brand} ${display.join(' / ')}${variant ? ` (${variant})` : ''}`
    .replace(/\s+/g, ' ').trim();

  return {
    brand,
    model: cModelFull.split(' / ')[0] ?? cModelFull,
    modelFull: cModelFull,
    variant,
    compatibility: entries.length === 0 ? String(compatibilityRaw ?? '').trim() : JSON.stringify(labels),
    name,
    phones: labels,
  };
}

// ------------------------------------------------- fixtures de paridad (Rust)
// Casos de borde con datos de teléfonos (información pública, sin datos del
// negocio): los verifica tanto este script como el test de catalog.rs.
const FIXTURE_CASES = [
  { category: 'Pantalla', brand: 'Redmi', model: 'Red Note 11', variant: '', compatibility: '["Red Note 11","Note 11S 4G","Redmi Note 11","Redmi 11S 4g"]' },
  { category: 'Pantalla', brand: 'Xiaomi', model: 'REDMI 10 5g', variant: '', compatibility: '["Redmi 10 5g"]' },
  { category: 'Pantalla', brand: 'Blu', model: 'G73 / G73L / HONOR X7', variant: '', compatibility: '["G73","G73L","HONOR X7"]' },
  { category: 'Pantalla', brand: 'Huawei', model: 'HONOR 10 LITE  / 20i / 20 LITE', variant: '', compatibility: '["HONOR 10 LITE","20i","20 LITE"]' },
  { category: 'Pantalla', brand: 'Apple', model: 'iPhone 11', variant: 'INCELL', compatibility: '["iPhone 11"]' },
  { category: 'Pantalla', brand: 'Apple', model: '13 PRO MAX AM', variant: 'OLED', compatibility: '["Apple 13 PRO MAX","13 Pro Max AM"]' },
  { category: 'Pantalla', brand: 'Motorola', model: 'G51-5G', variant: '', compatibility: '["Motorola G51 5G","G51-5G"]' },
  { category: 'Pantalla', brand: 'Infinix', model: 'HOT 30I', variant: '', compatibility: '["Infinix Hot 30i"]' },
  { category: 'Pantalla', brand: 'Tecno', model: 'SPARK 9 PRO / 8P', variant: '', compatibility: '[]' },
  { category: 'Táctil Tablet', brand: '', model: 'AMAZON FIRE 7 HD 2019', variant: '', compatibility: '' },
  { category: 'Táctil Tablet', brand: '', model: '287 3G', variant: '', compatibility: '[]' },
  { category: 'Pantalla', brand: 'Xiaomi', model: 'Mi A2', variant: '', compatibility: '["Mi A2","Redmi A2"]' },
  { category: 'Pantalla', brand: 'Lg', model: 'K50S', variant: '', compatibility: '["LG K50S"]' },
  { category: 'Pantalla', brand: 'Zte', model: 'A34 / A54 / A50', variant: '', compatibility: '["ZTE A34","A54","A50"]' },
  { category: 'Pantalla', brand: 'Generico', model: 'A80 PLUS', variant: '', compatibility: '["A80 Plus"]' },
  { category: 'Pantalla', brand: 'Honor', model: 'MAGIC 5 LITE 5G  / X9A / X40', variant: 'ORIGINAL', compatibility: '["Honor MAGIC 5 LITE 5G","X9A","X40"]' },
  { category: 'Pantalla', brand: 'Samsung', model: 'A06 4G', variant: '', compatibility: '["Samsung A06 4G","Samsung A06"]' },
  { category: 'Pantalla', brand: 'Xiaomi', model: 'Redmi Poco x6 pro', variant: '', compatibility: '["Redmi Poco x6 pro"]' },
];

// F55 — casos de PARIDAD del split de modelos (F53): los mismos textos que verifica
// `catalog::tests::test_split_model_models_real_cases`. El script tiene su PROPIA copia de la regla
// (no puede llamar a Rust), así que este fixture es lo que impide que las dos se separen: se
// regenera con `node tools/audit_inventory.mjs --gen-split-fixtures` y el test de Rust falla si el
// script devuelve algo distinto.
const SPLIT_CASES = [
  // SÍ se parten (2+ códigos) — casos reales del catálogo del local
  'A70 A705',
  'Galaxy A70 A705',
  'A16 4G A165',
  'A13 4G A135 M13',
  'K20 Plus MP260',
  'A01 Core A013',
  'Y6 2019 8A',
  'K42 K52',
  // el mismo código dos veces: no hay 2 partes distintas → se devuelve tal cual
  'A70 A70',
  // NO se parten (un solo código, o ninguno)
  'Redmi Note 11',
  'A06 4G',
  'Galaxy S21 Ultra 5G',
  'Redmi 9A',
  'iPhone 11 Pro Max',
  '5001 1V 2019',
  'Note 20',
  '',
];

if (argv.includes('--gen-split-fixtures')) {
  const out = SPLIT_CASES.map((model) => ({ model, expect: splitModelModels(model) }));
  const target = path.join(HERE, 'split_fixtures.json');
  fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`fixtures -> ${path.relative(ROOT, target)} (${out.length} casos)`);
  process.exit(0);
}

if (argv.includes('--gen-fixtures')) {
  const out = FIXTURE_CASES.map((c) => {
    const n = normalizeFields(c.category, c.brand, c.model, c.variant, c.compatibility);
    return { ...c, expect: { brand: n.brand, model: n.model, variant: n.variant, compatibility: n.compatibility, name: n.name } };
  });
  const target = path.join(HERE, 'canonical_fixtures.json');
  fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`fixtures -> ${path.relative(ROOT, target)} (${out.length} casos)`);
  process.exit(0);
}

// ------------------------------------------------------------------- lectura
if (!fs.existsSync(DB_PATH)) {
  console.error(`No existe la base: ${DB_PATH}`);
  process.exit(1);
}
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (sql) => {
  try { return db.prepare(sql).all(); } catch (e) { return [{ ERR: e.message }]; }
};

const products = all(`SELECT id, name, category_id, brand, model, variant, compatibility,
                             price_cost, price_sale, price_usd, stock, min_stock, created_at
                      FROM products ORDER BY id`);
const categories = new Map(all('SELECT id, name FROM categories').map((c) => [c.id, c.name]));

// ------------------------------------------------------------------ análisis
const report = {
  db: DB_PATH,
  generated_at: new Date().toISOString(),
  counts: {},
  brands: { literal: [], unknown: [], changed: [] },
  models: { empty: [], multi: [], non_canonical: [] },
  names: { non_canonical: [] },
  compat: { empty: [], without_brand: [], label_collisions: [] },
  prices: { zero: 0, sale_below_cost: [], with_cash_price: 0 },
  stock: { zero: 0, negative: [], low: 0, units: 0, value_cost: 0, value_sale: 0 },
  duplicates: [],
  by_category: [],
  stock_by_id: {},
  stock_by_model: {},
};

const brandCount = new Map();
const phoneGroups = new Map();
const stockByModel = new Map();
const dupMap = new Map();

for (const p of products) {
  const rawBrand = String(p.brand ?? '').trim();
  const rawModel = String(p.model ?? '').trim();
  const category = categories.get(p.category_id) ?? '';
  const n = normalizeFields(category, rawBrand, rawModel, p.variant, p.compatibility);

  brandCount.set(rawBrand || '(vacía)', (brandCount.get(rawBrand || '(vacía)') || 0) + 1);
  const cb = canonicalBrand(rawBrand);
  if (!cb.matched && !(!rawBrand && n.brand !== 'Genérico')) {
    report.brands.unknown.push({ id: p.id, name: p.name, brand: rawBrand });
  } else if (rawBrand && n.brand !== rawBrand) {
    report.brands.changed.push({ id: p.id, de: rawBrand, a: n.brand });
  }

  if (!rawModel) report.models.empty.push({ id: p.id, name: p.name });
  if (rawModel.includes('/')) report.models.multi.push({ id: p.id, name: p.name, model: rawModel, canonico: n.modelFull });
  else if (rawModel !== n.model) report.models.non_canonical.push({ id: p.id, actual: rawModel, canonico: n.model });

  const entries = parseCompat(p.compatibility);
  if (entries.length === 0) report.compat.empty.push({ id: p.id, name: p.name });
  for (const entry of entries) {
    const phone = canonicalPhone(entry, n.brand);
    if (norm(entry) === norm(phone.model)) {
      report.compat.without_brand.push({ id: p.id, entrada: entry, canonico: phone.label });
    }
  }
  for (const label of n.phones) {
    const key = phoneKey(canonicalPhone(label, n.brand));
    if (!phoneGroups.has(key)) phoneGroups.set(key, new Set());
    phoneGroups.get(key).add(label);
  }

  if (n.name !== String(p.name ?? '').trim()) {
    report.names.non_canonical.push({ id: p.id, actual: p.name, canonico: n.name });
  }

  if (Number(p.price_cost) === 0 && Number(p.price_sale) === 0) report.prices.zero++;
  if (Number(p.price_sale) > 0 && Number(p.price_sale) < Number(p.price_cost)) {
    report.prices.sale_below_cost.push({ id: p.id, name: p.name, costo: p.price_cost, venta: p.price_sale });
  }
  if (Number(p.price_usd ?? 0) > 0) report.prices.with_cash_price++;

  const st = Number(p.stock);
  report.stock.units += st;
  report.stock.value_cost += st * Number(p.price_cost);
  report.stock.value_sale += st * Number(p.price_sale);
  if (st === 0) report.stock.zero++;
  if (st < 0) report.stock.negative.push({ id: p.id, name: p.name, stock: st });
  if (Number(p.min_stock) > 0 && st <= Number(p.min_stock)) report.stock.low++;
  report.stock_by_id[p.id] = st;
  const mk = `${norm(n.brand)}|${norm(n.model)}`;
  stockByModel.set(mk, (stockByModel.get(mk) ?? 0) + st);

  const dupK = `${norm(n.brand)}|${norm(n.model)}|${norm(n.variant)}`;
  if (!dupMap.has(dupK)) dupMap.set(dupK, []);
  dupMap.get(dupK).push({ id: p.id, name: p.name, stock: p.stock });
}

for (const [key, labels] of phoneGroups) {
  if (labels.size > 1) report.compat.label_collisions.push({ key, etiquetas: [...labels] });
}
for (const [key, list] of dupMap) {
  if (list.length > 1) {
    report.duplicates.push({
      key, ids: list.map((d) => d.id),
      stock_total: list.reduce((a, d) => a + Number(d.stock), 0),
      names: list.map((d) => d.name),
    });
  }
}

report.by_category = all(`SELECT c.name, count(*) sku, sum(p.stock) unidades
                          FROM products p LEFT JOIN categories c ON c.id = p.category_id
                          GROUP BY c.name ORDER BY sku DESC`).map((r) => ({
  categoria: r.name, sku: r.sku, unidades: r.unidades,
}));
report.brands.literal = [...brandCount.entries()].sort((a, b) => b[1] - a[1]).map(([marca, n]) => ({ marca, n }));
report.stock_by_model = Object.fromEntries([...stockByModel.entries()].sort());

const summary = {
  'productos': products.length,
  'marcas distintas': brandCount.size,
  'marcas fuera del mapa': report.brands.unknown.length,
  'marcas a normalizar (alias/mayúsculas)': report.brands.changed.length,
  'modelos vacíos': report.models.empty.length,
  'modelos con varios teléfonos (/)': report.models.multi.length,
  'modelos no canónicos (mayúsculas/formato)': report.models.non_canonical.length,
  'nombres no canónicos': report.names.non_canonical.length,
  'sin compatibilidad': report.compat.empty.length,
  'compatibilidad sin marca (se agrega)': report.compat.without_brand.length,
  'teléfonos con 2+ etiquetas (duplicado)': report.compat.label_collisions.length,
  'teléfonos distintos en el catálogo (script)': phoneGroups.size,
  // El número que MANDA es el del padrón de la app (`phones`): el script cuenta desde la
  // compatibilidad con su propia copia de las reglas, y con el split de F53 las dos cifras quedan
  // cerca pero NO son idénticas (el script no aplica el filtro de familia/marca ni los «junk»).
  ...(hasPhonesTable() ? { 'teléfonos en el padrón (app)': countPhones() } : {}),
  'productos sin precio': report.prices.zero,
  'grupos duplicados (marca+modelo+variante)': report.duplicates.length,
  'SKU en 0': report.stock.zero,
  'SKU negativos': report.stock.negative.length,
  'SKU en/bajo mínimo': report.stock.low,
  'unidades totales': report.stock.units,
  'valor a costo': report.stock.value_cost.toFixed(2),
  'valor a venta': report.stock.value_sale.toFixed(2),
};

if (AS_JSON) {
  console.log(JSON.stringify({ summary, report }, null, 2));
} else {
  const line = (s) => console.log(s);
  line('');
  line(`AUDITORÍA DE INVENTARIO  ·  ${path.relative(ROOT, DB_PATH)}`);
  line(`generado: ${report.generated_at}`);
  line('─'.repeat(74));
  for (const [k, v] of Object.entries(summary)) line(`  ${String(k).padEnd(44)} ${v}`);
  line('─'.repeat(74));

  const section = (title, items, fmt, max = MAX_SAMPLES) => {
    if (!items || items.length === 0) return;
    line('');
    line(`${title}  (${items.length})`);
    for (const it of items.slice(0, max)) line(`   ${fmt(it)}`);
    if (items.length > max) line(`   … y ${items.length - max} más`);
  };

  section('Por categoría', report.by_category, (r) => `${String(r.categoria).padEnd(16)} SKU ${String(r.sku).padStart(5)}   unidades ${r.unidades ?? 0}`);
  section('Marcas (literal en la base)', report.brands.literal, (r) => `[${r.marca}] ${r.n}`);
  section('MARCAS FUERA DEL MAPA CANÓNICO', report.brands.unknown, (r) => `id${r.id} ${r.brand ? `"${r.brand}"` : '(sin marca)'} · ${r.name}`);
  section('Marcas a normalizar (alias/mayúsculas)', report.brands.changed, (r) => `[${r.de}] -> [${r.a}]  (id${r.id})`);
  section('MODELOS CON VARIOS TELÉFONOS (hay que separar)', report.models.multi, (r) => `id${r.id} "${r.model}"  →  "${r.canonico}"`);
  section('MODELOS NO CANÓNICOS', report.models.non_canonical, (r) => `id${r.id} "${r.actual}"  →  "${r.canonico}"`);
  section('NOMBRES NO CANÓNICOS', report.names.non_canonical, (r) => `id${r.id}\n      actual:   ${r.actual}\n      canónico: ${r.canonico}`);
  section('SIN COMPATIBILIDAD', report.compat.empty, (r) => `id${r.id} ${r.name}`);
  section('COMPATIBILIDAD SIN MARCA (se le agrega)', report.compat.without_brand, (r) => `id${r.id} "${r.entrada}" → "${r.canonico}"`);
  section('MISMO TELÉFONO CON 2+ ETIQUETAS (duplica la lista)', report.compat.label_collisions, (r) => `${r.key}  →  ${r.etiquetas.join('  |  ')}`);
  section('STOCK NEGATIVO', report.stock.negative, (r) => `id${r.id} stock ${r.stock} · ${r.name}`);
  section('GRUPOS DUPLICADOS', report.duplicates, (r) => `ids ${r.ids.join(',')} (stock total ${r.stock_total})\n      ${r.names.join('\n      ')}`);

  line('');
  line(`  Precios: ${report.prices.zero} con costo y venta en 0 · ${report.prices.sale_below_cost.length} con venta < costo · ${report.prices.with_cash_price} con precio contado > 0`);
  line('');
}

if (SNAPSHOT) {
  const out = path.resolve(ROOT, SNAPSHOT);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    db: DB_PATH,
    generated_at: report.generated_at,
    products: products.length,
    units: report.stock.units,
    value_cost: report.stock.value_cost,
    stock_by_id: report.stock_by_id,
    stock_by_model: report.stock_by_model,
  }, null, 2));
  console.log(`snapshot -> ${path.relative(ROOT, out)}`);
}

db.close();
