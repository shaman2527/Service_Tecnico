#!/usr/bin/env node
// ============================================================================
// AUDITORÍA DE ETIQUETAS DE TRABAJO (F58, paso 0) — SOLO LECTURA.
//
// Para qué: el dueño quiere poder decir «cambié 30 baterías» sin sumar a mano. En su base real hay 49
// etiquetas distintas y varias son EL MISMO trabajo escrito distinto («bateria» + «REPARACIÓN DE
// BATTERIA» + «Cambio batería»). Este reporte mide su base y muestra:
//   · cuántas etiquetas hay, cuántas con UN solo equipo y qué % de los equipos cubren;
//   · cuáles son CANÓNICAS, cuáles ya se unen por la tabla de equivalencias (`src/lib/work-aliases.ts`),
//     cuáles son LIBRES, cuáles NO son un trabajo (garantía/venta) y cuáles quedaron A DECIDIR;
//   · el antes/después: cuántas categorías muestra la pantalla hoy y cuántas mostraría con las
//     equivalencias aplicadas.
//
// NO escribe nada: solo lee. Las equivalencias se aprueban editando `src/lib/work-aliases.ts`.
//
// Uso:
//   node tools/audit_work_labels.mjs                      (usa registro.db)
//   node tools/audit_work_labels.mjs --db backup/f56_fixture.db
//   node tools/audit_work_labels.mjs --db <copia del cliente> --json
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A_DECIDIR, WORK_ALIASES, canonicalWorkKey, esCanonica, esNoTrabajo, foldWork } from '../src/lib/work-aliases.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DB = path.resolve(ROOT, arg('--db', 'registro.db'));
const JSON_OUT = argv.includes('--json');

if (!fs.existsSync(DB)) { console.error(`No existe la base: ${DB}`); process.exit(1); }
const db = new DatabaseSync(DB, { readOnly: true });
const rows = db.prepare('SELECT status, service_type, service_types FROM services').all();
db.close();

const tipos = (r) => {
  let a = [];
  try { const p = JSON.parse(r.service_types ?? '[]'); if (Array.isArray(p)) a = p; } catch { /* fallback */ }
  if (!a.length && r.service_type) a = [r.service_type];
  return a.filter(t => typeof t === 'string' && t.trim() !== '');
};

// ── conteos ────────────────────────────────────────────────────────────────────────────────────
const crudas = new Map();   // etiqueta escrita tal cual → equipos
const plegadas = new Map(); // clave plegada SIN equivalencias (lo que la UI mostraba) → equipos
const unidas = new Map();   // clave CON equivalencias aplicadas (lo que la UI muestra ahora) → equipos
let sinTrabajo = 0;
for (const r of rows) {
  const lista = tipos(r);
  if (lista.length === 0) { sinTrabajo++; continue; }
  const vistas = new Set();
  const plegadasDeLaFila = new Set();
  for (const t of lista) {
    const cruda = t.trim();
    const plegada = foldWork(cruda);
    if (!plegada) continue;
    crudas.set(cruda, (crudas.get(cruda) ?? 0) + 1);
    plegadasDeLaFila.add(plegada);
    vistas.add(canonicalWorkKey(plegada));
  }
  for (const p of plegadasDeLaFila) plegadas.set(p, (plegadas.get(p) ?? 0) + 1);
  for (const u of vistas) unidas.set(u, (unidas.get(u) ?? 0) + 1);
}

// ── clasificación de cada etiqueta CRUDA ───────────────────────────────────────────────────────
const clasificar = (cruda) => {
  const clave = foldWork(cruda);
  if (clave in WORK_ALIASES) return { tipo: 'ALIAS', destino: WORK_ALIASES[clave] };
  if (esCanonica(clave)) return { tipo: 'CANÓNICA', destino: clave };
  if (esNoTrabajo(clave)) return { tipo: 'NO ES TRABAJO', destino: null };
  if (A_DECIDIR.includes(clave)) return { tipo: 'A DECIDIR', destino: null };
  return { tipo: 'LIBRE', destino: null };
};
const detalle = [...crudas.entries()]
  .map(([cruda, n]) => ({ cruda, equipos: n, clave: foldWork(cruda), ...clasificar(cruda) }))
  .sort((a, b) => (b.equipos - a.equipos) || a.cruda.localeCompare(b.cruda, 'es'));

const unaSola = [...plegadas.values()].filter(n => n === 1).length;
const equiposCubiertosPorUnaSola = [...crudas.entries()].filter(([c]) => (plegadas.get(foldWork(c)) ?? 0) === 1).reduce((a, [, n]) => a + n, 0);
const soloUnaEtiquetaEquipo = unaSola;
const resumen = {
  base: DB,
  ordenes: rows.length,
  equiposSinTrabajo: sinTrabajo,
  etiquetasCrudas: crudas.size,
  plegadas: plegadas.size,
  unidas: unidas.size,
  categoriasAntes: plegadas.size + (sinTrabajo > 0 ? 1 : 0),
  categoriasDespues: unidas.size + (sinTrabajo > 0 ? 1 : 0),
  etiquetasDeUnEquipo: soloUnaEtiquetaEquipo,
  equiposEnEtiquetasDeUnEquipo: equiposCubiertosPorUnaSola,
  aliasAplicados: detalle.filter(d => d.tipo === 'ALIAS').length,
  aDecidir: detalle.filter(d => d.tipo === 'A DECIDIR').map(d => ({ etiqueta: d.cruda, equipos: d.equipos })),
  noEsTrabajo: detalle.filter(d => d.tipo === 'NO ES TRABAJO').map(d => ({ etiqueta: d.cruda, equipos: d.equipos })),
};

if (JSON_OUT) { console.log(JSON.stringify({ resumen, detalle }, null, 2)); process.exit(0); }

console.log(`Auditoría de etiquetas de trabajo (SOLO LECTURA)\n  base: ${DB}\n`);
console.log(`  órdenes:                         ${resumen.ordenes}`);
console.log(`  equipos sin trabajo anotado:     ${resumen.equiposSinTrabajo}`);
console.log(`  etiquetas escritas (crudas):     ${resumen.etiquetasCrudas}`);
console.log(`  etiquetas plegadas:              ${resumen.plegadas}`);
console.log(`  …y con las EQUIVALENCIAS:        ${resumen.unidas}`);
console.log(`  categorías en pantalla:          ${resumen.categoriasAntes}  →  ${resumen.categoriasDespues} con las equivalencias`);
console.log(`  etiquetas de UN solo equipo:     ${resumen.etiquetasDeUnEquipo}  (cubren ${resumen.equiposEnEtiquetasDeUnEquipo} equipos)`);
console.log(`  equivalencias YA aplicadas:      ${resumen.aliasAplicados}`);

const muestra = (titulo, tipo) => {
  const lista = detalle.filter(d => d.tipo === tipo);
  if (!lista.length) return;
  console.log(`\n── ${titulo} (${lista.length}) ──`);
  for (const d of lista) {
    const destino = d.destino ? `  →  ${d.destino}` : '';
    console.log(`${String(d.equipos).padStart(5)}  ${d.cruda}${destino}`);
  }
};
muestra('EQUIVALENCIAS APLICADAS (la tabla de src/lib/work-aliases.ts)', 'ALIAS');
muestra('A DECIDIR — necesitan tu OK (NO se unen solas)', 'A DECIDIR');
muestra('NO ES UN TRABAJO (garantía / venta)', 'NO ES TRABAJO');
muestra('ETIQUETAS LIBRES (se mantienen tal cual)', 'LIBRE');
muestra('CANÓNICAS (la lista del formulario)', 'CANÓNICA');

if (resumen.aDecidir.length) {
  console.log('\nPara unir alguna de las «A DECIDIR», agregá una línea en src/lib/work-aliases.ts:');
  console.log(`  '${resumen.aDecidir[0].etiqueta.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()}': 'cambio pantalla',`);
  console.log('(el destino es la clave plegada de un trabajo canónico: el que corresponda)');
}
console.log('');
