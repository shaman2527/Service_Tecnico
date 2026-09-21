// GENERADOR DE LA PLANTILLA DE PRODUCCIÓN (`registro.default.db`).
//
// POR QUÉ EXISTE: `tauri.conf.json` empaqueta `../registro.db` como plantilla del instalador, y ese
// mismo archivo es la base de DESARROLLO (con su WAL): órdenes, pagos, un día abierto y clientes
// reales. El repo es PÚBLICO → hay que publicar una base SANA: sin datos de nadie, con precios y sin
// duplicados. Este script arma esa plantilla en un archivo NUEVO (nunca toca `registro.db`).
//
// Uso:
//   node tools/make_release_template.mjs                       → backup/plantilla_candidata.db
//   node tools/make_release_template.mjs --from registro.db --out backup/otra.db
//   node tools/make_release_template.mjs --keep-techs          → no resetea los técnicos al seed
//
// Después de generarla hay que APLICAR LOS PRECIOS con el hook de Rust (la lista del local la sabe
// cruzar el backend, no este script — una sola implementación) y validar con el gate:
//   $env:REGISTRO_PRICES_DB="<ruta del .db>"; $env:REGISTRO_PRICES_APPLY="1"
//   cargo test --lib -- --ignored test_manual_restore_prices --nocapture
//   node tools/release_gate.mjs --db <ruta del .db>
//
// Cuando el gate diga LISTO, se promueve a mano: copiar el candidato sobre `registro.db` (y borrar
// el `registro.db-wal` viejo) o cambiar `tauri.conf.json` para empaquetar el candidato.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, def) => (args.includes(n) ? args[args.indexOf(n) + 1] : def);
const FROM = resolve(ROOT, opt('--from', 'registro.db'));
const OUT = resolve(ROOT, opt('--out', 'backup/plantilla_candidata.db'));
const KEEP_TECHS = args.includes('--keep-techs');

const SEED_TECHS = ['Aldri', 'William'];
// Tablas transaccionales / de personas: una instalación nueva arranca SIN nada de esto.
const VACIAR = ['service_payments', 'services', 'sales', 'expenses', 'purchase_order_items',
  'purchase_orders', 'inventory_movements', 'daily_closings', 'clients'];
// Settings que dependen de la PC: no deben viajar (el taller los configura en su máquina).
const SETTINGS_MAQUINA = ['printer_port', 'printer_baud', 'printer_width', 'printer_windows'];

if (!existsSync(FROM)) { console.error(`No existe la base de origen: ${FROM}`); process.exit(2); }
const MERGE_ONLY = args.includes('--merge-only');
if (MERGE_ONLY && !existsSync(OUT)) { console.error(`--merge-only necesita que exista ${OUT}`); process.exit(2); }
if (!MERGE_ONLY && existsSync(OUT) && !args.includes('--force')) {
  console.error(`Ya existe ${OUT}. Usá --force para sobrescribirla (nunca se toca ${basename(FROM)}).`);
  process.exit(2);
}

console.log(`Plantilla de producción a partir de ${basename(FROM)}`);
console.log(`  origen: ${FROM}${existsSync(`${FROM}-wal`) ? ` (+ WAL ${(statSync(`${FROM}-wal`).size / 1024).toFixed(0)} KB: se incluye vía VACUUM INTO)` : ''}`);
console.log(`  destino: ${OUT}\n`);

// 0) Copia CONSISTENTE (VACUUM INTO incluye el WAL y deja un archivo autocontenido).
//    Con --merge-only NO se recopia: se trabaja sobre el candidato ya canonizado (paso 2 del ciclo).
if (!MERGE_ONLY) {
  if (existsSync(OUT)) rmSync(OUT, { force: true });
  for (const suf of ['-wal', '-shm']) if (existsSync(`${OUT}${suf}`)) rmSync(`${OUT}${suf}`, { force: true });
  const src = new DatabaseSync(FROM, { readOnly: true });
  src.exec(`VACUUM INTO '${OUT.replace(/'/g, "''")}'`);
  src.close();
  console.log(`✓ copia consistente creada (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
} else {
  console.log('✓ modo --merge-only: se trabajan los duplicados sobre el candidato YA canonizado');
}

// 1) Limpieza sobre la COPIA.
const db = new DatabaseSync(OUT);
const q = (s) => db.prepare(s).get();
const reporte = {};

db.exec('BEGIN');
for (const t of VACIAR) {
  const antes = q(`SELECT COUNT(*) c FROM ${t}`).c;
  if (antes > 0) {
    db.prepare(`DELETE FROM ${t}`).run();
    reporte[t] = antes;
  }
  // Que una instalación nueva empiece en 1: sin esto los ids arrancan en el número de dev.
  db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(t);
}
// 2) Técnicos: se vuelve al seed de la app (Aldri/William) salvo --keep-techs.
if (!KEEP_TECHS) {
  const otros = db.prepare(`SELECT name FROM technicians WHERE name NOT IN (${SEED_TECHS.map(() => '?').join(',')})`).all(...SEED_TECHS);
  if (otros.length > 0) {
    db.prepare(`DELETE FROM technicians WHERE name NOT IN (${SEED_TECHS.map(() => '?').join(',')})`).run(...SEED_TECHS);
    reporte.technicians_borrados = otros.map(o => o.name);
  }
}
// 3) Settings de la máquina + PIN al valor documentado.
for (const k of SETTINGS_MAQUINA) db.prepare('DELETE FROM settings WHERE key = ?').run(k);
reporte.settings_maquina_limpiados = SETTINGS_MAQUINA;
// El PIN de la plantilla es SIEMPRE el inicial documentado (`INSTALACION.md`: «el inicial es 1234»).
// ANTES esto solo lo creaba si faltaba: desde que el PIN se guarda HASHEADO (B4) y la base de origen
// es la del taller, la plantilla viajaba con el PIN REAL del dueño — en un instalador que se descarga
// cualquiera desde un repo público. Un PIN propio es de la persona, no del catálogo: se resetea.
const PIN_INICIAL = '1234';
const pin = db.prepare("SELECT value FROM settings WHERE key='pin'").get();
if (pin) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'pin'").run(PIN_INICIAL);
  // NO se imprime el valor viejo: en una base anterior a B4 el PIN está en TEXTO PLANO, así que
  // imprimirlo sería escribirlo en la consola/CI. Basta con saber que se reseteó.
  reporte.pin_reseteado = `(valor anterior oculto: puede ser el PIN de una persona) → ${PIN_INICIAL}`;
} else {
  db.prepare("INSERT INTO settings (key, value) VALUES ('pin', ?)").run(PIN_INICIAL);
  reporte.pin_creado = PIN_INICIAL;
}
// 4) Duplicados: en la plantilla las tablas transaccionales están VACÍAS, así que fusionar es
//    quedarse con la fila de menor id y sumarle el stock de las demás (mismo criterio que
//    `merge_products`, sin tener que repuntar ventas/servicios/pedidos porque no hay ninguno).
//    El criterio es el MISMO que usa la auditoría del catálogo: marca + modelo + variante
//    (el nombre puede diferir en un sufijo cosmético). Después de canonizar puede haber grupos
//    nuevos que antes no se veían: para eso está la pasada `--merge-only`.
const grupos = db.prepare(`SELECT COALESCE(brand,'') b, COALESCE(model,'') m, COALESCE(variant,'') v,
  COUNT(*) n, SUM(stock) stock, MIN(id) keep FROM products GROUP BY 1,2,3 HAVING COUNT(*) > 1`).all();
const fusionados = [];
for (const g of grupos) {
  const filas = db.prepare(`SELECT id, name, stock, COALESCE(price_sale,0) ps, COALESCE(price_cost,0) pc
    FROM products WHERE COALESCE(brand,'') = ? AND COALESCE(model,'') = ? AND COALESCE(variant,'') = ? ORDER BY id`)
    .all(g.b, g.m, g.v);
  const base = filas.find(f => f.id === g.keep);
  const precio = filas.map(f => f.ps).find(p => p > 0) ?? base.ps;
  const costo = filas.map(f => f.pc).find(p => p > 0) ?? base.pc;
  // el stock se suma (es la suma física real de las dos fichas)
  db.prepare('UPDATE products SET stock = ?, price_sale = ?, price_cost = ? WHERE id = ?')
    .run(g.stock, precio, costo, g.keep);
  for (const f of filas) if (f.id !== g.keep) db.prepare('DELETE FROM products WHERE id = ?').run(f.id);
  fusionados.push(`[${g.b} ${g.m}${g.v ? ' ' + g.v : ''}] ${g.n} → 1 (stock ${g.stock})`);
}
if (fusionados.length) reporte.duplicados_fusionados = fusionados;
// 5) Stock negativo: en una instalación nueva no hay historial que lo explique → 0.
const negativos = db.prepare('SELECT id, name, stock FROM products WHERE stock < 0').all();
if (negativos.length) {
  db.prepare('UPDATE products SET stock = 0 WHERE stock < 0').run();
  reporte.negativos_a_cero = negativos.map(n => `${n.name} (${n.stock})`);
}
// 5.b) F64 — TODO EN USO (pedido del dueño, 2026-09-21): «todos los modelos y todos los productos
//      visibles con sus compatibilidades… que cuando se cargue al release esté todo en SÍ, y el
//      cliente con el check decida qué dejar o no lo que va a usar». Antes la plantilla heredaba lo
//      APAGADO del local (los productos sin stock quedaban con «en uso» = No, y los modelos traían
//      el seed de «lo uso» del taller), así que una instalación nueva arrancaba con modelos y
//      repuestos que NO aparecían en el buscador del servicio. El cliente destilda lo que no usa
//      (Inventario → Modelos y la ficha del producto), no al revés.
const prodApagados = db.prepare('SELECT COUNT(*) c FROM products WHERE COALESCE(in_use,1) = 0').get().c;
const telApagados = db.prepare('SELECT COUNT(*) c FROM phones WHERE COALESCE(in_use,1) = 0').get().c;
db.prepare('UPDATE products SET in_use = 1').run();
db.prepare('UPDATE phones SET in_use = 1').run();
reporte.todo_en_uso = { productos_encendidos: prodApagados, modelos_encendidos: telApagados };
db.exec('COMMIT');

// 6) Autocontenida: sin WAL pendiente y sin huecos.
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.exec('VACUUM');
const resumen = {
  productos: q('SELECT COUNT(*) c FROM products').c,
  unidades: q('SELECT COALESCE(SUM(stock),0) u FROM products').u,
  con_precio: q('SELECT COUNT(*) c FROM products WHERE price_sale > 0').c,
  categorias: q('SELECT COUNT(*) c FROM categories').c,
  tecnicos: q('SELECT COUNT(*) c FROM technicians').c,
  dia_abierto: q('SELECT COUNT(*) c FROM daily_closings WHERE is_closed = 0').c,
  integridad: Object.values(q('PRAGMA integrity_check'))[0],
};
db.close();
for (const suf of ['-wal', '-shm']) if (existsSync(`${OUT}${suf}`)) rmSync(`${OUT}${suf}`, { force: true });

console.log('✓ limpieza aplicada:');
for (const [k, v] of Object.entries(reporte)) {
  console.log(`   · ${k}: ${Array.isArray(v) ? (v.length ? v.slice(0, 4).join(' | ') + (v.length > 4 ? ` … (+${v.length - 4})` : '') : 'nada') : v}`);
}
console.log(`\nPlantilla candidata: ${OUT}`);
console.log(`   productos ${resumen.productos} · unidades ${resumen.unidades} · con precio ${resumen.con_precio} · categorías ${resumen.categorias} · técnicos ${resumen.tecnicos} · días abiertos ${resumen.dia_abierto} · integrity ${resumen.integridad}`);
console.log(`\nFALTA APLICAR LOS PRECIOS (los cruza el backend con la lista del local) y validar:`);
console.log(`   $env:REGISTRO_PRICES_DB="${OUT}"; $env:REGISTRO_PRICES_APPLY="1"`);
console.log(`   cd src-tauri; cargo test --lib -- --ignored test_manual_restore_prices --nocapture`);
console.log(`   node tools/release_gate.mjs --db ${OUT.replace(ROOT + '\\', '')}`);
console.log(`\nOJO: este script NUNCA escribió en ${basename(FROM)}. Para publicar hay que promover la candidata a mano (con el gate en verde).`);
