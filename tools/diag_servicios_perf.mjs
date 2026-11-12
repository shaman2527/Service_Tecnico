#!/usr/bin/env node
/**
 * DIAGNÓSTICO DE RENDIMIENTO — buscador de SERVICIO TÉCNICO (solo lectura).
 *
 * Mide sobre una COPIA de la base real cuánto cuesta:
 *   1. la consulta de la lista (`get_services`, tal cual la hace el backend),
 *   2. el patrón N+1 del mapa de pagos (`get_service_payments` × fila visible),
 *   3. la misma lectura de pagos en UNA sola consulta (el arreglo propuesto),
 *   4. cuántas filas quedan por término de búsqueda (para saber qué tan grande es el render).
 *
 * Uso:  node tools/diag_servicios_perf.mjs [ruta.db]
 * No escribe NADA en la base: trabaja sobre una copia temporal.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origen = process.argv[2] ?? 'registro.db';
if (!existsSync(origen)) {
  console.error(`No existe la base: ${origen}`);
  process.exit(2);
}

// Copia (con -wal/-shm si están) para no abrir la base del taller ni bloquearla.
const dir = mkdtempSync(join(tmpdir(), 'diag-serv-'));
const copia = join(dir, 'copia.db');
for (const sufijo of ['', '-wal', '-shm']) {
  if (existsSync(origen + sufijo)) copyFileSync(origen + sufijo, copia + sufijo);
}

const db = new DatabaseSync(copia);
const one = sql => db.prepare(sql).get();
const all = sql => db.prepare(sql).all();

const ms = fn => {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, out };
};
const medir = (fn, vueltas = 5) => {
  fn(); // calentar la caché de páginas
  const tiempos = [];
  let out;
  for (let i = 0; i < vueltas; i++) { const r = ms(fn); tiempos.push(r.ms); out = r.out; }
  tiempos.sort((a, b) => a - b);
  return { mediana: tiempos[Math.floor(tiempos.length / 2)], min: tiempos[0], out };
};

const COLUMNAS = `s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type,
  s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent,
  s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address,
  s.device_checklist, s.service_types, s.client_id, s.paid_amount, s.technician_id, s.technician,
  s.group_id, s.color, s.printed, s.screen_product_id, s.discount_amount, s.photo_in_at,
  s.photo_out_at, s.pay_intent, s.iva_rate, s.iva_mode`;

// La MISMA consulta que `Database::get_services` (db.rs), con y sin búsqueda.
const sqlLista = (conBusqueda) => `SELECT ${COLUMNAS} FROM services s WHERE 1=1` +
  (conBusqueda
    ? " AND (s.client LIKE ?1 OR s.model LIKE ?1 OR s.order_num LIKE ?1 OR s.phone LIKE ?1 OR s.client_ci LIKE ?1)"
    : '') +
  ' ORDER BY s.id DESC';

const nServicios = one('SELECT COUNT(*) c FROM services').c;
const nPagos = one('SELECT COUNT(*) c FROM service_payments').c;
const nProductos = one('SELECT COUNT(*) c FROM products').c;
const nClientes = one('SELECT COUNT(*) c FROM clients').c;

console.log('══════════════════════════════════════════════════════════════════');
console.log(' DIAGNÓSTICO — buscador de Servicio Técnico (solo lectura)');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`Base: ${origen}`);
console.log(`  services=${nServicios}  service_payments=${nPagos}  products=${nProductos}  clients=${nClientes}`);

// ── 1. Índices que existen ───────────────────────────────────────────────────
const indices = all("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND tbl_name IN ('services','service_payments')");
console.log(`\nÍndices en services/service_payments (${indices.length}):`);
for (const i of indices) console.log(`  · ${i.name} → ${i.tbl_name}`);

// ── 2. Tamaño de la lista completa ───────────────────────────────────────────
const base = medir(() => db.prepare(sqlLista(false)).all(), 3);
console.log(`\n[1] get_services SIN filtros (toda la base): ${base.out.length} filas → ${base.mediana.toFixed(2)} ms`);

// ── 3. Búsqueda: cuánto tarda y cuántas filas deja ──────────────────────────
const terminos = ['a', 'je', 'mar', 'perez', '0424', 'DEV', 'A70', 'zzzznoexiste'];
console.log('\n[2] get_services CON búsqueda (LIKE %q% en client/model/order_num/phone/client_ci):');
for (const t of terminos) {
  const r = medir(() => db.prepare(sqlLista(true)).all(`%${t}%`), 3);
  console.log(`  «${t}»\t${String(r.out.length).padStart(4)} filas\t${r.mediana.toFixed(2)} ms\t${(r.out.length * 100 / nServicios).toFixed(0)}% del total`);
}

// ── 4. El N+1 del mapa de pagos ─────────────────────────────────────────────
const ids = all('SELECT id FROM services ORDER BY id DESC LIMIT 120').map(r => r.id);
const sqlPago = 'SELECT id, service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, payment_date, notes FROM service_payments WHERE service_id = ?1 ORDER BY payment_date ASC, id ASC';
const n1 = medir(() => { for (const id of ids) db.prepare(sqlPago).all(id); }, 3);
console.log(`\n[3] mapa de pagos N+1 — ${ids.length} consultas sueltas (lo que hoy hace la UI): ${n1.mediana.toFixed(2)} ms de SQL`);
const todosPagos = medir(() => db.prepare('SELECT service_id FROM service_payments WHERE service_id IN (SELECT value FROM json_each(?1))').all(JSON.stringify(ids)), 3);
const batched = medir(() => db.prepare(`SELECT id, service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, payment_date, notes FROM service_payments WHERE service_id IN (SELECT value FROM json_each(?1)) ORDER BY payment_date ASC, id ASC`).all(JSON.stringify(ids)), 3);
console.log(`[4] mapa de pagos en 1 consulta (el arreglo): ${batched.mediana.toFixed(2)} ms de SQL para ${batched.out.length} pagos`);
console.log(`    → el SQL del N+1 es ${(n1.mediana / Math.max(batched.mediana, 0.001)).toFixed(1)}× el de una sola consulta`);

// ── 5. Coste de los "contextos" que la UI recarga en cada tecla ─────────────
console.log('\n[5] lecturas de contexto que hoy viajan en CADA tecla:');
for (const [nombre, sql] of [
  ['get_service_statuses', 'SELECT * FROM service_statuses'],
  ['get_technicians', 'SELECT * FROM technicians'],
  ['entregados de hoy', `${sqlLista(false).replace(' WHERE 1=1', " WHERE 1=1 AND s.status='Entregado' AND date(s.date_out) >= ?1 AND date(s.date_out) <= ?1")}`],
]) {
  try {
    const r = medir(() => db.prepare(sql).all(...(sql.includes('?1') ? [new Date().toISOString().slice(0, 10)] : [])), 3);
    console.log(`  · ${nombre}: ${r.out.length} filas → ${r.mediana.toFixed(2)} ms`);
  } catch (e) {
    console.log(`  · ${nombre}: no medible (${e.message})`);
  }
}

// ── 6. ¿Cuánto de la base tiene cada columna de búsqueda? ───────────────────
console.log('\n[6] filas con datos en las columnas que busca el filtro:');
const cols = all(`SELECT
  SUM(client <> '') c_client, SUM(COALESCE(phone,'') <> '') c_phone, SUM(COALESCE(client_ci,'') <> '') c_ci,
  SUM(COALESCE(model,'') <> '') c_model, SUM(COALESCE(order_num,'') <> '') c_orden FROM services`)[0];
console.log(`  client=${cols.c_client}  phone=${cols.c_phone}  client_ci=${cols.c_ci}  model=${cols.c_model}  order_num=${cols.c_orden}`);
console.log('\nFIN — nada se escribió en la base (se trabajó sobre una copia).');
db.close();
rmSync(dir, { recursive: true, force: true });
