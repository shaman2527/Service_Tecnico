import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('dev_registro.db', { readOnly: true });
console.log('PAGOS:');
for (const p of db.prepare('SELECT service_id, amount, currency, payment_method, payment_date FROM service_payments ORDER BY service_id').all()) {
  console.log(`  svc=${p.service_id} ${p.amount} ${p.currency} ${p.payment_method} ${p.payment_date}`);
}
console.log('SERVICIOS (id, orden, status, amount, paid):');
for (const s of db.prepare('SELECT id, order_num, status, amount, paid_amount, date_in, date_out FROM services ORDER BY id').all()) {
  console.log(`  #${s.id} ${s.order_num} [${s.status}] amount=${s.amount} paid=${s.paid_amount.toFixed(4)} in=${s.date_in} out=${s.date_out}`);
}
db.close();
