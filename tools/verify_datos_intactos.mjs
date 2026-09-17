// ¿La CARGA DE INVENTARIO (y la limpieza canónica) toca los datos viejos del cliente?
//
// Responde con evidencia, no con confianza: toma una COPIA de la base, "fotografia" las tablas
// de HISTORIA (ventas, servicios, abonos, clientes, cierres de caja), corre la carga de
// inventario y la limpieza canónica SOBRE LA COPIA y vuelve a fotografiar. La base original
// NUNCA se toca (solo se copia).
//
// Uso:  node tools/verify_datos_intactos.mjs [--db <ruta>] [--con-normalize]
//       (por defecto usa backup/registro_pre_normalizacion_20260915.db)

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const argDe = (n, def) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const ORIGEN = argDe('--db', 'backup/registro_pre_normalizacion_20260915.db');
const CON_NORMALIZE = args.includes('--con-normalize');

let checks = 0, failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

// Tablas de HISTORIA del cliente: lo que NUNCA debe cambiar por cargar inventario.
const TABLAS = {
  sales: "SELECT id, date, product_id, product_name, quantity, unit_price, total, payment_method, client_name, currency FROM sales ORDER BY id",
  services: "SELECT id, order_num, date_in, client, model, status, amount, paid_amount, screen_product_id, technician FROM services ORDER BY id",
  service_payments: "SELECT id, service_id, amount, payment_method, currency, payment_date FROM service_payments ORDER BY id",
  clients: "SELECT id, name, phone FROM clients ORDER BY id",
  daily_closings: "SELECT id, close_date, is_closed, tasa_bcv, total_sales_usd, total_services_usd, difference FROM daily_closings ORDER BY id",
  expenses: "SELECT id, expense_date, category, amount, currency FROM expenses ORDER BY id",
};

function foto(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const out = {};
  for (const [tabla, sql] of Object.entries(TABLAS)) {
    try { out[tabla] = JSON.stringify(db.prepare(sql).all()); }
    catch { out[tabla] = null; }   // la tabla no existe en esta base
  }
  try { out.__productos = String(db.prepare("SELECT COUNT(*) c FROM products").get().c); } catch { out.__productos = '?'; }
  try { out.__stock_total = String(db.prepare("SELECT COALESCE(SUM(stock),0) s FROM products").get().s); } catch { out.__stock_total = '?'; }
  db.close();
  return out;
}

/** Filas de una tabla de la foto (0 si la tabla no existe). */
const filas = (fotoObj, tabla) => (fotoObj[tabla] ? JSON.parse(fotoObj[tabla]) : []);

function diff(a, b) {
  const cambios = [];
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) cambios.push(k);
  }
  return cambios;
}

const tmp = path.join('backup', '_prueba_datos_intactos.db');
if (!fs.existsSync(ORIGEN)) { console.error(`no existe ${ORIGEN}`); process.exit(2); }
fs.copyFileSync(ORIGEN, tmp);
// el WAL de la copia vieja no aplica: se parte de una copia consistente del archivo
for (const suf of ['-wal', '-shm']) { const f = tmp + suf; if (fs.existsSync(f)) fs.unlinkSync(f); }

console.log(`— ¿la carga de inventario toca la historia del cliente? — copia de ${ORIGEN} —\n`);

const antes = foto(tmp);
console.log(`estado inicial: ${antes.__productos} productos · ${antes.__stock_total} unidades · `
  + `${filas(antes, "sales").length} ventas · ${filas(antes, "services").length} servicios · `
  + `${filas(antes, "service_payments").length} abonos · ${filas(antes, "daily_closings").length} cierres\n`);

// 1) CARGA DE INVENTARIO (el camino que usa el local: lista física → products/inventory_movements)
try {
  execFileSync('node', ['tools/load_real_inventory.mjs'], {
    env: { ...process.env, DB_DEBUG: path.resolve(tmp) },
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  console.log('carga de inventario: ejecutada sobre la copia');
} catch (e) {
  console.log('carga de inventario: FALLÓ ->', String(e.stdout || e.message).split('\n').slice(-3).join(' | '));
}

const trasCarga = foto(tmp);
const cambiosCarga = diff(antes, trasCarga);
check('la carga de inventario NO toca ventas', antes.sales === trasCarga.sales,
  cambiosCarga.includes('sales') ? 'CAMBIARON las ventas' : 'idénticas');
check('la carga de inventario NO toca servicios', antes.services === trasCarga.services,
  cambiosCarga.includes('services') ? 'CAMBIARON los servicios' : 'idénticos');
check('la carga de inventario NO toca abonos', antes.service_payments === trasCarga.service_payments);
check('la carga de inventario NO toca clientes', antes.clients === trasCarga.clients);
check('la carga de inventario NO toca cierres de caja', antes.daily_closings === trasCarga.daily_closings);
check('la carga de inventario NO toca gastos', antes.expenses === trasCarga.expenses);
check('la carga de inventario SÍ actualiza el inventario (products)',
  String(antes.__stock_total) !== String(trasCarga.__stock_total),
  `${antes.__productos} → ${trasCarga.__productos} productos · unidades ${antes.__stock_total} → ${trasCarga.__stock_total}`);

// 2) LIMPIEZA CANÓNICA (normalize_catalog): esta SÍ puede repuntar product_id de ventas viejas
//    cuando fusiona fichas duplicadas. Se mide para saberlo con certeza.
if (CON_NORMALIZE) {
  console.log('\n— limpieza canónica (normalize_catalog) —');
  try {
    execFileSync('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--ignored',
      'test_manual_normalize_db', '--nocapture'], {
      env: { ...process.env, REGISTRO_NORMALIZE_DB: path.resolve(tmp), REGISTRO_NORMALIZE_APPLY: '1' },
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    console.log('normalize_catalog: ejecutada sobre la copia');
  } catch (e) {
    console.log('normalize_catalog: FALLÓ ->', String(e.stdout || e.message).split('\n').slice(-3).join(' | '));
  }
  const trasNorm = foto(tmp);
  const cambiosNorm = diff(trasCarga, trasNorm);
  check('la limpieza canónica NO cambia los MONTOS ni las filas de ventas',
    filas(trasCarga, "sales").length === filas(trasNorm, "sales").length
    && filas(trasCarga, "sales").every((v, i) => v.total === filas(trasNorm, "sales")[i].total
      && v.date === filas(trasNorm, "sales")[i].date
      && v.product_name === filas(trasNorm, "sales")[i].product_name),
    'misma cantidad, misma fecha, mismo nombre y mismo total');
  const repuntados = filas(trasCarga, "sales").filter((v, i) => v.product_id !== filas(trasNorm, "sales")[i].product_id);
  check('la limpieza canónica NO repunta ventas si no hay duplicados que fusionar',
    repuntados.length === 0,
    repuntados.length ? `${repuntados.length} venta(s) repuntadas a otra ficha (duplicados fusionados)` : 'ninguna repuntada');
  check('la limpieza canónica no toca servicios/abonos/clientes/cierres',
    !cambiosNorm.includes('services') && !cambiosNorm.includes('service_payments')
    && !cambiosNorm.includes('clients') && !cambiosNorm.includes('daily_closings'),
    cambiosNorm.length ? `cambiaron: ${cambiosNorm.join(', ')}` : 'idénticos');
  check('la limpieza canónica conserva el STOCK total (invariante)',
    trasCarga.__stock_total === trasNorm.__stock_total,
    `${trasCarga.__stock_total} → ${trasNorm.__stock_total}`);
}

fs.unlinkSync(tmp);
for (const suf of ['-wal', '-shm']) { const f = tmp + suf; if (fs.existsSync(f)) fs.unlinkSync(f); }

console.log(`\ndatos intactos: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallo(s)`);
console.log('(la base original NO se tocó: todo corrió sobre una copia que se borra al final)');
process.exit(failures > 0 ? 1 : 0);
