#!/usr/bin/env node
/**
 * BANCO DE PRUEBAS DEL BUSCADOR DE SERVICIO TÉCNICO — llena una COPIA con N órdenes sintéticas.
 *
 * Para poder medir el buscador con el volumen que preocupa al dueño («tiene 1400 registros, no sé si
 * se pone lenta por eso») hace falta una base con ese volumen. Esta herramienta la arma: toma una
 * copia (nunca la base del taller) y le agrega órdenes de servicio con nombres, modelos, teléfonos y
 * cédulas realistas, más algunos abonos.
 *
 * SEGURIDAD DE DATOS: se niega a escribir si el destino se llama `registro.db`, si no está dentro de
 * `backup/` o si no existe (una copia se hace con `node tools/snapshot_db.mjs`).
 *
 * Uso:  node tools/mk_servicios_bench.mjs --db backup/bench_buscador.db [--n 1400] [--limpiar]
 *   --limpiar  borra las órdenes sintéticas (las que empiezan con cliente «Bench ») antes de generar.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const ROOT = process.cwd();
const dbPath = arg('--db', null);
const n = Number(arg('--n', '1400'));
const limpiar = argv.includes('--limpiar');

if (!dbPath) {
  console.error('Falta --db <copia dentro de backup/>.  Hacé la copia con: node tools/snapshot_db.mjs');
  process.exit(2);
}
const abs = path.resolve(ROOT, dbPath);
const base = path.basename(abs).toLowerCase();
if (!fs.existsSync(abs)) { console.error(`No existe la copia: ${abs}`); process.exit(2); }
if (base === 'registro.db') { console.error('ABORTADO: nunca sobre registro.db — usá una COPIA.'); process.exit(2); }
if (!abs.includes(`${path.sep}backup${path.sep}`)) {
  console.error('ABORTADO: el destino tiene que estar dentro de backup/ (es un banco de pruebas).');
  process.exit(2);
}
if (!Number.isFinite(n) || n < 0 || n > 20000) { console.error('--n fuera de rango (0..20000)'); process.exit(2); }

const db = new DatabaseSync(abs);
const MARCA = 'Bench ';
const antes = db.prepare(`SELECT COUNT(*) c FROM services WHERE client LIKE '${MARCA}%'`).get().c;
if (limpiar && antes > 0) {
  db.prepare(`DELETE FROM service_payments WHERE service_id IN (SELECT id FROM services WHERE client LIKE '${MARCA}%')`).run();
  db.prepare(`DELETE FROM services WHERE client LIKE '${MARCA}%'`).run();
  console.log(`Limpieza: ${antes} órdenes sintéticas borradas.`);
}

const NOMBRES = ['Pérez', 'María', 'González', 'Rodríguez', 'José', 'Muñoz', 'Ramírez', 'Ana', 'Blanco', 'Güell'];
const MODELOS = [
  'Samsung A70', 'Samsung A15', 'Xiaomi Redmi 9A', 'Xiaomi Redmi Note 11', 'iPhone 11', 'iPhone 14 Pro',
  'Honor X7', 'Tecno Spark 10 Pro', 'Motorola G22', 'Alcatel 1S', 'ZTE Blade A31', 'Realme C25',
];
const FALLAS = ['Pantalla rota', 'No enciende', 'Batería inflada', 'No carga', 'Táctil loco', 'Cámara borrosa'];
const ESTADOS = ['Recibido', 'Por entregar', 'Entregado', 'Devuelto'];
const METODOS = ['Divisas (USD Cash)', 'Pago Móvil', 'Zelle', 'Efectivo Bs'];
const TRABAJOS = ['["Cambio pantalla"]', '["Cambio batería"]', '["Cambio pantalla","Limpieza"]', '[]'];

const insServicio = db.prepare(`INSERT INTO services
  (order_num, date_in, client, phone, model, fault, service_type, service_types, amount, payment_method,
   currency, status, date_out, client_ci, observations)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, '')`);
const insPago = db.prepare(`INSERT INTO service_payments
  (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, currency, payment_date, notes)
  VALUES (?1, ?2, ?3, 0, 0, ?2, ?4, ?5, 'bench')`);

const dia = (offset) => {
  const d = new Date(Date.UTC(2026, 7, 1));
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

db.exec('BEGIN');
try {
  let pagos = 0;
  for (let i = 0; i < n; i++) {
    const nombre = NOMBRES[i % NOMBRES.length];
    const cliente = `${MARCA}${nombre} ${String(i + 1).padStart(4, '0')}`;
    const modelo = MODELOS[i % MODELOS.length];
    const estado = ESTADOS[i % ESTADOS.length];
    const fechaIn = dia(i % 68);
    const fechaOut = estado === 'Entregado' || estado === 'Devuelto' ? dia((i % 68) + 2) : '';
    const monto = 10 + (i % 40);
    const metodo = METODOS[i % METODOS.length];
    insServicio.run(
      `DEV-${3000 + i}`, fechaIn, cliente, `0414${String(1000000 + i).slice(1)}`, modelo,
      FALLAS[i % FALLAS.length], 'Cambio pantalla', TRABAJOS[i % TRABAJOS.length], monto, metodo,
      metodo.includes('Bs') || metodo.includes('Móvil') ? 'VES' : 'USD', estado, fechaOut,
      `V-${10000000 + i}`,
    );
    const id = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    // Un abono cada tres órdenes (y dos en algunas): ejercita el mapa de abonos de las tarjetas.
    if (i % 3 === 0) {
      insPago.run(id, monto / 2, metodo, metodo.includes('Bs') || metodo.includes('Móvil') ? 'VES' : 'USD', fechaIn);
      pagos++;
      if (i % 6 === 0) { insPago.run(id, monto / 4, 'Divisas (USD Cash)', 'USD', fechaIn); pagos++; }
    }
  }
  db.exec('COMMIT');
  console.log(`Banco listo en ${abs}: +${n} órdenes sintéticas, ${pagos} abonos.`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ERROR, no se escribió nada:', e.message);
  process.exitCode = 1;
}

const total = db.prepare('SELECT COUNT(*) c FROM services').get().c;
const marcadas = db.prepare(`SELECT COUNT(*) c FROM services WHERE client LIKE '${MARCA}%'`).get().c;
console.log(`  services totales: ${total} (sintéticas: ${marcadas})`);
db.close();
