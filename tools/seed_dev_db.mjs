// Seed de desarrollo: crea dev_registro.db con datos de prueba a partir de una
// copia de la DB real (nunca toca registro.db). Uso: node tools/seed_dev_db.mjs
// Luego lanzar: $env:REGISTRO_DB="...\dev_registro.db"; npx tauri dev
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'registro.db');
const dst = path.join(root, 'dev_registro.db');
const TASA = 748.79;

if (!existsSync(src)) {
  console.error(`No existe ${src}`);
  process.exit(1);
}

// 1) Checkpoint del WAL de la DB real para copiar el estado completo
let srcDb = null;
try {
  srcDb = new DatabaseSync(src);
  srcDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
} finally {
  srcDb?.close();
}

// 2) Copia aislada
for (const f of [dst, dst + '-wal', dst + '-shm']) {
  if (existsSync(f)) unlinkSync(f);
}
copyFileSync(src, dst);

const db = new DatabaseSync(dst);

// 3a) Asegurar esquema: la copia es una DB REAL más antigua; añade las columnas que
// faltan (el init() de la app hace lo mismo al abrir, pero aquí insertamos antes).
const tableCols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
const ensureCol = (t, c, ddl) => {
  const cols = tableCols(t);
  if (!cols.has(c)) {
    const sql = `ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`;
    try {
      db.exec(sql);
    } catch (e) {
      console.error(`FAIL ${sql} (c='${c}' has=${cols.has(c)} cols=[${[...cols].join(',')}])`);
      throw e;
    }
  }
};
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));

if (!tables.has('service_payments')) {
  db.exec(`CREATE TABLE IF NOT EXISTS service_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER REFERENCES services(id),
    amount REAL DEFAULT 0,
    payment_method TEXT,
    bank_fee_percent REAL DEFAULT 0,
    bank_fee_amount REAL DEFAULT 0,
    net_amount REAL DEFAULT 0,
    zelle_reference TEXT,
    currency TEXT DEFAULT 'USD',
    payment_date TEXT DEFAULT (datetime('now','localtime')),
    notes TEXT
  )`);
}
ensureCol('daily_closings', 'tasa_eur', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'opened_at', 'TEXT');
ensureCol('daily_closings', 'initial_cash_usd', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'total_usd', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'total_bs', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'pos_charged_usd', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'pos_fees_usd', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'pos_net_usd', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'pos_charged_bs', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'pos_fees_bs', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'pos_net_bs', 'REAL DEFAULT 0');
ensureCol('daily_closings', 'pos_settled_bs', 'REAL DEFAULT 0');
ensureCol('services', 'service_type', 'TEXT');
ensureCol('services', 'service_types', 'TEXT');
ensureCol('services', 'currency', "TEXT DEFAULT 'USD'");
ensureCol('services', 'client_id', 'INTEGER REFERENCES clients(id)');
ensureCol('services', 'client_ci', 'TEXT');
ensureCol('services', 'client_address', 'TEXT');
ensureCol('services', 'device_checklist', 'TEXT');
ensureCol('services', 'technician', 'TEXT');
ensureCol('services', 'technician_id', 'INTEGER');
ensureCol('services', 'paid_amount', 'REAL DEFAULT 0');
ensureCol('services', 'group_id', 'TEXT');
ensureCol('services', 'bank_fee_percent', 'REAL DEFAULT 0');
ensureCol('services', 'bank_fee_amount', 'REAL DEFAULT 0');
ensureCol('services', 'net_amount', 'REAL');
ensureCol('services', 'zelle_reference', 'TEXT');
ensureCol('sales', 'client_id', 'INTEGER REFERENCES clients(id)');
ensureCol('sales', 'bank_fee_percent', 'REAL DEFAULT 0');
ensureCol('sales', 'bank_fee_amount', 'REAL DEFAULT 0');
ensureCol('sales', 'net_amount', 'REAL');
ensureCol('sales', 'zelle_reference', 'TEXT');
ensureCol('sales', 'currency', "TEXT DEFAULT 'USD'");

// 3) Limpiar datos de negocio (se conserva catálogo, técnicos, PIN, settings)
db.exec('PRAGMA foreign_keys = OFF');
db.exec('DELETE FROM service_payments');
db.exec('DELETE FROM services');
db.exec('DELETE FROM sales');
db.exec('DELETE FROM inventory_movements');
db.exec('DELETE FROM daily_closings');
db.exec('DELETE FROM clients');

// 4) Fechas relativas a hoy
const now = new Date();
const today = now.toISOString().slice(0, 10);
const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
const tsToday = (h) => `${today} ${h}`;
const tsYday = (h) => `${yesterday} ${h}`;

const ins = (sql, ...params) => db.prepare(sql).run(...params);

// Clientes (en minúsculas a propósito: la migración title_case los corrige al abrir la app)
const cMaria = ins('INSERT INTO clients (name, phone, ci, address, email, notes) VALUES (?,?,?,?,?,?)',
  'maria fernandez', '0412-5551234', 'V-18000123', 'Urb. Las Acacias, Av. 2', 'maria@mail.com', 'Cliente recurrente').lastInsertRowid;
const cRob = ins('INSERT INTO clients (name, phone, ci, address) VALUES (?,?,?,?)',
  'roberth silva', '0412-5559999', 'V-24906999', 'Barrio San José').lastInsertRowid;
const cPedro = ins('INSERT INTO clients (name, phone, ci) VALUES (?,?,?)',
  'pedro martinez', '0414-7778888', 'V-11999999').lastInsertRowid;
const cCarlos = ins('INSERT INTO clients (name, phone, ci) VALUES (?,?,?)',
  'carlos gomez', '0426-1112233', 'V-22222222').lastInsertRowid;

// 5) Cierre de ayer + día abierto hoy
ins('INSERT INTO daily_closings (close_date, tasa_bcv, tasa_eur, opened_at, closed_at, is_closed, notes, initial_cash_usd, total_usd, total_bs, grand_total, cash_usd, pos_charged_usd, pos_fees_usd, pos_net_usd, pago_movil_total, actual_cash_usd, actual_punto_usd, actual_pago_movil) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  yesterday, TASA, 870.12, tsYday('08:00:00'), tsYday('19:00:00'), 'Cierre de prueba (seed)',
  40, 45, 7490, +(45 + 7490 / TASA).toFixed(2), 15, 30, 1.05, 28.95, 7490, 40, 28.95, 7490);
ins('INSERT INTO daily_closings (close_date, tasa_bcv, tasa_eur, opened_at, is_closed, initial_cash_usd) VALUES (?,?,?,?,0,?)',
  today, TASA, 870.12, tsToday('08:00:00'), 50);

// 6) Servicios
const CHECK = '{"chip_sim":"si","tapa_trasera":"si","bandeja_sim":"si","botones":"si","boton_home":"na","camara":"si","puerto_carga":"si","parlante":"si","contrasena":"no","accesorios":"no"}';
const svc = (order, dateIn, clientId, clientName, model, fault, types, amount, status, extra = {}) =>
  ins('INSERT INTO services (order_num, date_in, client, phone, model, fault, amount, payment_method, date_out, status, observations, service_type, service_types, currency, client_id, client_ci, client_address, device_checklist, technician, technician_id, paid_amount, group_id, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    order, dateIn, clientName, extra.phone ?? '', model, fault, amount, extra.method ?? 'Efectivo Bs',
    extra.dateOut ?? null, status, extra.obs ?? null,
    types[0], JSON.stringify(types), extra.currency ?? 'USD', clientId,
    extra.ci ?? null, extra.addr ?? null, extra.checklist ?? null,
    extra.tech ?? null, extra.techId ?? null, extra.paid ?? 0, extra.groupId ?? null,
    extra.feePct ?? 0, extra.feeAmt ?? 0, extra.net ?? 0, extra.ref ?? null).lastInsertRowid;

// DEV-0001: ayer, en taller, técnico Aldri
const s1 = svc('DEV-0001', tsYday('09:15:00'), cRob, 'roberth silva', 'Samsung A32', 'No enciende, se queda en logo',
  ['Cambio batería'], 30, 'En reparación', { phone: '0412-5559999', ci: 'V-24906999', addr: 'Barrio San José', tech: 'Aldri', techId: 1, checklist: CHECK, obs: 'Probable batería hinchada' });

// DEV-0002: ayer, por entregar, abono de $10 hoy
const s2 = svc('DEV-0002', tsYday('10:30:00'), cPedro, 'pedro martinez', 'Tecno SPARK 10 PRO', 'Pantalla rota en caída',
  ['Cambio pantalla'], 45, 'Por entregar', { phone: '0414-7778888', ci: 'V-11999999', method: 'Divisas (USD Cash)', paid: 10, obs: 'Pantalla pedida' });

// DEV-0003 + DEV-0003-A: orden multi-equipo de hoy (maria, 2 teléfonos)
const s3 = svc('DEV-0003', tsToday('08:45:00'), cMaria, 'maria fernandez', 'Xiaomi Redmi Note 11', 'No carga; conector flojo',
  ['Cambio conector / puerto', 'Cambio batería'], 25, 'Recibido', { phone: '0412-5551234', ci: 'V-18000123', addr: 'Urb. Las Acacias, Av. 2', checklist: CHECK, groupId: 'DEV-0003' });
const s3b = svc('DEV-0003-A', tsToday('08:45:00'), cMaria, 'maria fernandez', 'Samsung Galaxy A14', 'Se apaga sola con batería baja',
  ['Cambio batería'], 20, 'Recibido', { phone: '0412-5551234', ci: 'V-18000123', addr: 'Urb. Las Acacias, Av. 2', checklist: CHECK, groupId: 'DEV-0003' });

// DEV-0004: hoy, entregado y pagado completo
const s4 = svc('DEV-0004', tsToday('09:40:00'), cCarlos, 'carlos gomez', 'iPhone 11 PRO', 'Pantalla estrellada, táctil muerto',
  ['Cambio pantalla'], 60, 'Entregado', { phone: '0426-1112233', ci: 'V-22222222', method: 'Divisas (USD Cash)', dateOut: tsToday('12:30:00'), paid: 60, obs: 'Garantía 7 días' });

// DEV-0005: ayer, entregado con 2 pagos (Punto $ + Pago Móvil Bs)
const s5 = svc('DEV-0005', tsYday('11:00:00'), cRob, 'roberth silva', 'Motorola G52', 'No enciende',
  ['Cambio batería'], 40, 'Entregado', { phone: '0412-5559999', ci: 'V-24906999', dateOut: tsYday('17:30:00'), obs: 'Pagó en dos partes' });

// 7) Abonos
ins('INSERT INTO service_payments (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, payment_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
  s2, 10, 'Divisas (USD Cash)', 0, 0, 10, '', 'USD', tsToday('08:30:00'), 'Abono inicial');
ins('INSERT INTO service_payments (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, payment_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
  s4, 60, 'Divisas (USD Cash)', 0, 0, 60, '', 'USD', tsToday('12:30:00'), 'Pago completo');
ins('INSERT INTO service_payments (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, payment_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
  s5, 30, 'Punto de Venta ($)', 3.5, 1.05, 28.95, '', 'USD', tsYday('16:00:00'), 'Punto');
ins('INSERT INTO service_payments (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, payment_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
  s5, 7490, 'Pago Móvil', 0, 0, 7490, 'REF-PM-001', 'VES', tsYday('16:05:00'), 'Pago móvil del banco');

// 8) Ventas
ins('INSERT INTO sales (date, product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency) VALUES (?,NULL,?,?,?,?,?,?,?,?,0,0,?,?,?)',
  tsToday('09:00:00'), 'Funda Silicona Samsung A32', 1, 5, 5, 'Divisas (USD Cash)', 'roberth silva', cRob, 'Funda negra', 5, '', 'USD');
ins('INSERT INTO sales (date, product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency) VALUES (?,NULL,?,?,?,?,?,?,?,?,0,0,?,?,?)',
  tsToday('11:30:00'), 'Cargador Rápido 33W', 1, 10, 7487.9, 'Pago Móvil', 'maria fernandez', cMaria, '', 7487.9, 'REF-VENTA-01', 'VES');
ins('INSERT INTO sales (date, product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency) VALUES (?,NULL,?,?,?,?,?,?,?,?,0,0,?,?,?)',
  tsYday('17:00:00'), 'Audífonos Bluetooth', 1, 15, 15, 'Divisas (USD Cash)', 'pedro martinez', cPedro, '', 15, '', 'USD');

// 9) Verificación
const summary = {
  clients: db.prepare('SELECT COUNT(*) c FROM clients').get().c,
  services: db.prepare('SELECT COUNT(*) c FROM services').get().c,
  payments: db.prepare('SELECT COUNT(*) c FROM service_payments').get().c,
  sales: db.prepare('SELECT COUNT(*) c FROM sales').get().c,
  dayOpen: db.prepare("SELECT close_date FROM daily_closings WHERE is_closed=0").get()?.close_date,
  nextOrder: db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(order_num, INSTR(order_num,'-')+1) AS INTEGER)),0)+1 FROM services WHERE group_id IS NULL").get()['COALESCE(MAX(CAST(SUBSTR(order_num, INSTR(order_num,\'-\')+1) AS INTEGER)),0)+1'],
  orders: db.prepare('SELECT order_num, status FROM services ORDER BY order_num').all(),
};

db.close();
console.log('Seed OK →', dst);
console.log(JSON.stringify(summary, null, 2));
