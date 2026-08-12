// Fusiona el inventario anterior (tools/inventario_anterior.txt — lista física previa)
// con el actual (tools/inventario_real.txt — del Excel), sin perder stocks previos.
// Regla: coincidencia exacta normalizada -> max(cantidad anterior, nueva);
//        línea anterior sin coincidencia -> se conserva con SU cantidad (nunca a 0);
//        líneas anteriores con stock 0 sin coincidencia exacta -> se descartan.
// Uso: node tools/merge_inventarios.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = path.join(root, 'tools', 'inventario_anterior.txt');
const CUR = path.join(root, 'tools', 'inventario_real.txt');

function norm(s) {
  return String(s).toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parse(file) {
  const lines = readFileSync(file, 'utf8').replace(/[\u200e\u200f]/g, '').split(/\r?\n/).map(l => l.trim());
  const sections = {};
  const order = [];
  let brand = null;
  for (const raw of lines) {
    if (!raw) continue;
    if (/^[A-Za-z][A-Za-z0-9 ]*$/.test(raw) && raw.toLowerCase() !== 'c/m)') {
      if (!sections[raw]) { sections[raw] = []; order.push(raw); }
      brand = raw;
      continue;
    }
    if (!brand) continue;
    const m = raw.match(/^(.*?)\s*\((\d+)\)\s*$/);
    const model = (m ? m[1] : raw).replace(/\s+/g, ' ').replace(/[.,]\s*$/, '').trim();
    const qty = m ? parseInt(m[2], 10) : 0;
    if (!model) continue;
    sections[brand].push({ model, qty, norm: norm(model) });
  }
  return { sections, order };
}

const oldList = parse(OLD);
const cur = parse(CUR);

let merged = 0, kept = 0, dropped = 0, changed = 0;
const changes = [];
const keptLines = [];

for (const brand of oldList.order) {
  if (!cur.sections[brand]) cur.sections[brand] = [];
  const curByNorm = new Map(cur.sections[brand].map(l => [l.norm, l]));
  for (const it of oldList.sections[brand]) {
    const existing = curByNorm.get(it.norm);
    if (existing) {
      if (existing.qty !== it.qty) {
        changes.push(`  ${brand} ${it.model}: ${it.qty} -> ${Math.max(existing.qty, it.qty)}`);
      }
      existing.qty = Math.max(existing.qty, it.qty);
      merged++;
    } else if (it.qty === 0) {
      dropped++;
    } else {
      cur.sections[brand].push(it);
      kept++;
      keptLines.push(`  ${brand} ${it.model} (${it.qty})`);
    }
    curByNorm.set(it.norm, cur.sections[brand].find(l => l.norm === it.norm) || cur.sections[brand][cur.sections[brand].length - 1]);
  }
}

for (const brand of cur.order) cur.sections[brand] = cur.sections[brand].filter(l => l.model);
const out = [];
for (const brand of cur.order) {
  out.push(brand, '');
  for (const l of cur.sections[brand]) out.push(`${l.model} (${l.qty})`);
  out.push('');
}
writeFileSync(CUR, out.join('\n'), 'utf8');

console.log(`Coincidencias exactas (max qty): ${merged}`);
console.log(`Viejas sin coincidencia conservadas: ${kept}`);
console.log(`Viejas qty 0 descartadas: ${dropped}`);
if (changes.length) { console.log('Cambios de cantidad en coincidencias:'); console.log(changes.join('\n')); }
if (keptLines.length) { console.log('Líneas anteriores conservadas:'); console.log(keptLines.join('\n')); }