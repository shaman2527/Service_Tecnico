#!/usr/bin/env node
// ============================================================================
// ESTADO DEL TURNO DE CAJA (herramienta de DEV, solo lectura).
//
// Para qué: F82 hace que el turno abierto tenga que ser el del DÍA de la operación. Antes de correr
// una prueba en vivo (o para entender por qué el mostrador no deja facturar) hace falta ver, en un
// pantallazo: qué día está abierto, si es el de hoy, y qué hay alrededor (cierres, ventas, servicios).
//
// Uso:
//   node tools/estado_turno.mjs                       # la base del proyecto (registro.db)
//   node tools/estado_turno.mjs --db backup/x.db      # cualquier copia
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--db');
const dbPath = path.resolve(ROOT, i >= 0 && argv[i + 1] ? argv[i + 1] : 'registro.db');
if (!fs.existsSync(dbPath)) {
  console.error(`No existe la base: ${dbPath}`);
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return [{ err: String(e.message) }]; } };

const hoy = q("SELECT date('now','localtime') AS d")[0].d;
const abiertos = q('SELECT id, close_date, is_closed, tasa_bcv, opened_at FROM daily_closings WHERE is_closed = 0 ORDER BY close_date DESC');
const cierres = q('SELECT close_date, is_closed, closed_at FROM daily_closings ORDER BY close_date DESC LIMIT 5');
const cuenta = (t) => q(`SELECT COUNT(*) AS n FROM ${t}`)[0].n;

console.log(`base   : ${path.relative(ROOT, dbPath)}`);
console.log(`hoy    : ${hoy}  (local)`);
if (abiertos.length === 0) {
  console.log('turno : NINGUNO ABIERTO  → el mostrador no puede registrar nada (Libro Diario → Abrir Día)');
} else {
  for (const a of abiertos) {
    const veredicto = a.close_date === hoy ? 'ES EL DE HOY ✓' : `ES DE OTRO DÍA (F82: bloquea facturar) ✗`;
    console.log(`turno : ${a.close_date}  abierto desde ${a.opened_at ?? '—'}  tasa ${a.tasa_bcv}  → ${veredicto}`);
  }
}
console.log('cierres:', cierres.map(c => `${c.close_date}${c.is_closed ? ' (cerrado)' : ' (ABIERTO)'}`).join(' · ') || '—');
console.log(`datos  : ${cuenta('sales')} ventas · ${cuenta('services')} servicios · ${cuenta('service_payments')} abonos · ${cuenta('expenses')} gastos`);
