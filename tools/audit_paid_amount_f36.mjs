// F36 — MEDICIÓN DEL IMPACTO de la nueva regla de `paid_amount` (neto por moneda) sobre la base REAL.
// Solo LEE: trabaja sobre una COPIA consistente (node tools/snapshot_db.mjs --out backup/...).
//
// Compara, orden por orden:
//   ANTES (regla vieja): sumar cada movimiento convertido con la tasa de SU día.
//   AHORA (regla F36):   neto_USD + neto_VES / tasa del día del PRIMER ingreso en Bs.
// e informa cuántas órdenes cambian, cuánto y en qué dirección (y cuáles tienen devoluciones).
//
// Uso:  node tools/audit_paid_amount_f36.mjs --db backup/verif_f36.db
import { DatabaseSync } from 'node:sqlite';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DB = arg('--db', 'backup/verif_f36.db');
const db = new DatabaseSync(DB, { readOnly: true });

const tasaDeDia = (db, dia) => {
  const r = db.prepare(`SELECT tasa_bcv FROM daily_closings WHERE close_date = ?1 AND tasa_bcv > 0 ORDER BY id DESC LIMIT 1`).get(dia);
  if (r) return r.tasa_bcv;
  const abierto = db.prepare(`SELECT tasa_bcv FROM daily_closings WHERE is_closed = 0 AND tasa_bcv > 0 LIMIT 1`).get();
  return abierto ? abierto.tasa_bcv : 1;
};

const servicios = db.prepare(`SELECT id, order_num, client, amount, paid_amount FROM services ORDER BY id`).all();
const pagosDe = db.prepare(`SELECT amount, currency, payment_date FROM service_payments WHERE service_id = ?1 ORDER BY payment_date ASC, id ASC`);

let cambian = 0, conRefund = 0, suben = 0, bajan = 0;
const filas = [];
for (const s of servicios) {
  const pagos = pagosDe.all(s.id);
  if (pagos.length === 0) continue;
  if (pagos.some(p => p.amount < 0)) conRefund++;

  // ANTES
  let antes = 0;
  for (const p of pagos) {
    const cur = p.currency === 'VES' ? 'VES' : 'USD';
    antes += cur === 'USD' ? p.amount : p.amount / tasaDeDia(db, String(p.payment_date).slice(0, 10));
  }
  antes = Math.round(antes * 10000) / 10000;

  // AHORA
  const netUsd = pagos.filter(p => p.currency !== 'VES').reduce((a, p) => a + p.amount, 0);
  const netVes = pagos.filter(p => p.currency === 'VES').reduce((a, p) => a + p.amount, 0);
  let ahora = netUsd;
  if (Math.abs(netVes) > 1e-9) {
    const primerIngreso = pagos.find(p => p.currency === 'VES' && p.amount > 0);
    const tasa = primerIngreso ? tasaDeDia(db, String(primerIngreso.payment_date).slice(0, 10)) : 1;
    ahora += netVes / tasa;
  }
  ahora = Math.round(ahora * 10000) / 10000;

  if (Math.abs(ahora - antes) > 0.005) {
    cambian++;
    if (ahora > antes) suben++; else bajan++;
    filas.push({
      orden: s.order_num, cliente: s.client, amount: s.amount,
      guardado: s.paid_amount, antes, ahora, delta: Math.round((ahora - antes) * 100) / 100,
      devoluciones: pagos.filter(p => p.amount < 0).length,
      saldoAntes: Math.round((s.amount - antes) * 100) / 100,
      saldoAhora: Math.round((s.amount - ahora) * 100) / 100,
    });
  }
}

console.log(`\n· base: ${DB}`);
console.log(`· órdenes con movimientos: ${servicios.filter(s => pagosDe.all(s.id).length > 0).length}`);
console.log(`· órdenes con DEVOLUCIONES: ${conRefund}`);
console.log(`· órdenes cuyo paid_amount CAMBIA: ${cambian} (suben ${suben} · bajan ${bajan})\n`);
if (filas.length) {
  console.table(filas);
  console.log('· Casos donde la orden queda SALDADA con la regla nueva (saldo 0 y antes no):');
  for (const f of filas.filter(f => Math.abs(f.saldoAhora) < 0.01 && Math.abs(f.saldoAntes) >= 0.01)) {
    console.log(`   ${f.orden} ${f.cliente}: saldo $${f.saldoAntes} → $${f.saldoAhora} (devoluciones: ${f.devoluciones})`);
  }
} else {
  console.log('· Ninguna orden real cambia de paid_amount: la regla nueva coincide con la vieja en los datos de esta base.');
}
db.close();
