// GATE DE RELEASE — valida la base que el instalador va a empaquetar como `registro.default.db`.
//
// POR QUÉ EXISTE: `tauri.conf.json` empaqueta `../registro.db` tal cual (un solo archivo) y el
// repo es PÚBLICO. Esa base es también la base de DESARROLLO: si alguien cierra la app (o corre una
// herramienta sin REGISTRO_DB), el WAL se vuelca al `.db` y la próxima release publicaría órdenes,
// pagos y DATOS DE CLIENTES REALES en un instalador que se descarga cualquiera. Y si la plantilla
// sale sin precios, una PC nueva no puede cobrar nada.
//
// Uso:
//   node tools/release_gate.mjs                  → valida registro.db (lo que se empaqueta)
//   node tools/release_gate.mjs --db otra.db     → valida otra base (p.ej. la candidata)
//   node tools/release_gate.mjs --json           → salida para máquinas
// Salida: exit 0 = LISTO, exit 1 = NO LISTO (no se debe empaquetar), exit 2 = error de lectura.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dbArg = args.includes('--db') ? args[args.indexOf('--db') + 1] : 'registro.db';
const asJson = args.includes('--json');
const DB = resolve(ROOT, dbArg);

const fallos = [];
const avisos = [];
const ok = [];
const fail = (t, d) => fallos.push({ t, d });
const warn = (t, d) => avisos.push({ t, d });
const pass = (t, d) => ok.push({ t, d });

if (!existsSync(DB)) {
  console.error(`No existe la base a validar: ${DB}`);
  process.exit(2);
}

// 1) El WAL NO puede tener datos pendientes: eso es justo lo que se filtra al empaquetar.
const wal = `${DB}-wal`;
const walBytes = existsSync(wal) ? statSync(wal).size : 0;
if (walBytes > 0) {
  fail('la base tiene un WAL con datos sin volcar (se empaquetaría el .db viejo y el WAL se perdería… o al revés)',
    `${basename(wal)} = ${walBytes} bytes. Antes de empaquetar: cerrar la app y/o copiar con «node tools/snapshot_db.mjs» (VACUUM INTO).`);
} else {
  pass('sin WAL pendiente', 'la base es un archivo autocontenido');
}

const db = new DatabaseSync(DB, { readOnly: true });
const q = (sql) => { try { return db.prepare(sql).get(); } catch (e) { return { error: e.message }; } };
const all = (sql) => { try { return db.prepare(sql).all(); } catch (e) { return [{ error: e.message }]; } };
const tabla = (n) => q(`SELECT COUNT(*) c FROM ${n}`);

// 2) Nada de datos transaccionales ni de personas: una instalación nueva arranca limpia.
const prohibidas = ['services', 'sales', 'service_payments', 'daily_closings', 'expenses',
  'purchase_orders', 'purchase_order_items', 'inventory_movements', 'clients'];
for (const t of prohibidas) {
  const r = tabla(t);
  if (r.error) { warn(`no pude leer ${t}`, r.error); continue; }
  if (r.c > 0) fail(`la plantilla trae ${r.c} fila(s) en «${t}»`,
    'una PC nueva arrancaría con datos de desarrollo/clientes reales. Vaciá esa tabla en la plantilla (ver tools/progress/specs/F32-*).');
}

// 3) Día abierto: nunca debe viajar (una PC nueva no puede quedar atrapada en un turno viejo).
const abierto = q('SELECT close_date, tasa_bcv FROM daily_closings WHERE is_closed=0');
if (abierto && !abierto.error) fail('la plantilla tiene un DÍA ABIERTO', `${abierto.close_date} · tasa ${abierto.tasa_bcv}`);
else pass('sin día abierto en la plantilla');

// 4) El catálogo tiene que poder VENDER: productos con precio.
const sinPrecio = q('SELECT COUNT(*) c FROM products WHERE price_sale IS NULL OR price_sale <= 0');
const sinCosto = q('SELECT COUNT(*) c FROM products WHERE price_cost IS NULL OR price_cost <= 0');
const total = tabla('products');
if (total.error) fail('no pude leer «products»', total.error);
else if (!total.c) fail('la plantilla NO tiene productos', 'una PC nueva arrancaría con el catálogo vacío');
else {
  if (sinPrecio.c > 0) fail(`${sinPrecio.c} de ${total.c} productos SIN precio de venta`,
    'no se podrían cobrar. Aplicá la lista del local: REGISTRO_PRICES_DB=<db> REGISTRO_PRICES_APPLY=1 cargo test --lib -- --ignored test_manual_restore_prices');
  else pass('todos los productos tienen precio de venta');
  if (sinCosto.c > 0) warn(`${sinCosto.c} productos sin precio de costo`, 'la utilidad del Dashboard quedaría inflada');
}

// 5) Duplicados y stock negativo: dos fichas del mismo modelo parten el stock y confunden al taller.
const dup = q(`SELECT COUNT(*) c FROM (SELECT name, COALESCE(brand,''), COALESCE(model,''), COALESCE(variant,'')
  FROM products GROUP BY 1,2,3,4 HAVING COUNT(*) > 1)`);
if (dup.c > 0) fail(`${dup.c} grupo(s) de productos DUPLICADOS`, 'fusioná con merge_products (Inventario → Revisar duplicados) antes de publicar');
else pass('sin productos duplicados');
const neg = q('SELECT COUNT(*) c FROM products WHERE stock < 0');
if (neg.c > 0) fail(`${neg.c} producto(s) con stock NEGATIVO`, 'ajustá el stock (queda como faltante de compra)');
else pass('sin stock negativo');

// 6) Integridad y accesos.
const integ = q('PRAGMA integrity_check');
if (integ && (integ.integrity_check === 'ok' || Object.values(integ)[0] === 'ok')) pass('integrity_check ok');
else fail('integrity_check falló', JSON.stringify(integ));
const fk = all('PRAGMA foreign_key_check');
if (Array.isArray(fk) && fk.length === 0) pass('foreign_key_check sin problemas');
else fail(`${fk.length} violación(es) de clave foránea`, JSON.stringify(fk.slice(0, 3)));
const pin = q("SELECT value FROM settings WHERE key='pin'");
if (pin && pin.value) pass('PIN configurado', 'la app pedirá PIN al abrir');
else warn('sin PIN configurado', 'la app abriría sin pedir PIN (el dueño debería configurarlo)');
const tech = tabla('technicians');
if (tech.c > 0) pass(`técnicos de la plantilla: ${tech.c}`, 'Aldri/William por defecto');

// 7) Avisos de configuración que dependen de la PC de la tienda.
const pw = q("SELECT value FROM settings WHERE key='printer_windows'");
if (pw && pw.value) warn(`la plantilla trae impresora de Windows «${pw.value}»`, 'en una PC nueva esa impresora puede no existir: el taller la cambia en Impresora');
const pl = q("SELECT value FROM settings WHERE key='printer_business_line'");
if (pl && pl.value) warn(`la plantilla trae un nombre de negocio: «${pl.value}»`, 'revisá que sea el correcto');

db.close();

// ─────────────────────────────────── salida ───────────────────────────────────
if (asJson) {
  console.log(JSON.stringify({ db: DB, listo: fallos.length === 0, fallos, avisos, ok }, null, 2));
} else {
  console.log(`GATE DE RELEASE — ${basename(DB)}`);
  console.log(`  ${ok.length} comprobaciones OK · ${avisos.length} aviso(s) · ${fallos.length} bloqueante(s)\n`);
  for (const f of fallos) console.log(`  ✗ ${f.t}\n     → ${f.d}`);
  for (const a of avisos) console.log(`  ! ${a.t}\n     → ${a.d}`);
  console.log(fallos.length === 0
    ? '\nLISTO para empaquetar: la plantilla es limpia, tiene precios y no trae datos de nadie.'
    : '\nNO LISTO: NO empaquetes/ publiques hasta resolver los bloqueantes de arriba.');
}
process.exit(fallos.length === 0 ? 0 : 1);
