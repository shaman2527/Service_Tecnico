// GATE DE RELEASE — valida la base que el instalador va a empaquetar como `registro.default.db`.
//
// POR QUÉ EXISTE: lo que viaja dentro del instalador es un archivo que se descarga cualquiera (el repo
// es PÚBLICO) y que una PC nueva usa como catálogo inicial. Si esa base trae órdenes, pagos y clientes
// reales, la release los publica; y si sale sin precios, una PC nueva no puede cobrar nada.
//
// QUÉ VALIDA: **el archivo que `tauri.conf.json` empaqueta de verdad** (se lee de `bundle.resources`),
// no un nombre fijo. Antes esto era `registro.db` hardcodeado y el 2026-09-18 se vio el problema:
// el instalador ya empaquetaba la plantilla sana y el gate seguía mirando la base de trabajo — o sea,
// podía dar verde sobre un archivo que no viajaba, o rojo por un archivo que nadie empaquetaba.
// UNA SOLA FUENTE DE VERDAD: el gate y el instalador no pueden discrepar.
//
// Uso:
//   node tools/release_gate.mjs                  → valida la plantilla declarada en tauri.conf.json
//   node tools/release_gate.mjs --db otra.db     → valida otra base (p.ej. una candidata)
//   node tools/release_gate.mjs --json           → salida para máquinas
// Salida: exit 0 = LISTO, exit 1 = NO LISTO (no se debe empaquetar), exit 2 = error de lectura.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dbArg = args.includes('--db') ? args[args.indexOf('--db') + 1] : null;
const asJson = args.includes('--json');
const TAURI_CONF = resolve(ROOT, 'src-tauri', 'tauri.conf.json');

/** El origen de `registro.default.db` según tauri.conf.json (rutas relativas a src-tauri). */
function plantillaDeclarada() {
  if (!existsSync(TAURI_CONF)) return null;
  try {
    const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf-8'));
    const res = conf?.bundle?.resources;
    if (!res || Array.isArray(res)) return null; // sin mapeo no hay forma de saber cuál es la plantilla
    for (const [origen, destino] of Object.entries(res)) {
      if (String(destino) === 'registro.default.db') return resolve(ROOT, 'src-tauri', origen);
    }
    return null;
  } catch {
    return null;
  }
}

const declarada = dbArg ? null : plantillaDeclarada();
const DB = dbArg ? resolve(ROOT, dbArg) : (declarada || resolve(ROOT, 'registro.db'));
const deDonde = dbArg
  ? '(indicada con --db)'
  : declarada
    ? '(la que tauri.conf.json empaqueta como registro.default.db)'
    : '(no pude leer bundle.resources de tauri.conf.json: uso registro.db por defecto)';

// EXCEPCIONES ACEPTADAS POR EL DUEÑO (tools/release_excepciones.json): un bloqueante que el
// responsable del local decide aceptar (con motivo y fecha) se vuelve AVISO — pero ACOTADO: el gate
// sigue bloqueando si la situación EMPEORA respecto de lo aceptado. Una excepción no puede crecer
// sola con el tiempo. Si el archivo no existe, el gate es estricto como siempre.
const RUTA_EXC = join(ROOT, 'tools', 'release_excepciones.json');
let excepciones = {};
if (existsSync(RUTA_EXC)) {
  try { excepciones = JSON.parse(readFileSync(RUTA_EXC, 'utf-8')).excepciones || {}; }
  catch (e) { console.error(`release_excepciones.json ilegible (${e.message}): el gate sigue estricto`); }
}

const fallos = [];
const avisos = [];
const ok = [];
const fail = (t, d) => fallos.push({ t, d });
const warn = (t, d) => avisos.push({ t, d });
const pass = (t, d) => ok.push({ t, d });

if (!existsSync(DB)) {
  console.error(`No existe la base a validar: ${DB}`);
  console.error('(si el instalador tiene que empaquetar otra, cambiala en bundle.resources de tauri.conf.json)');
  process.exit(2);
}

if (!asJson) console.log(`gate sobre: ${DB.replace(ROOT + '\\', '')} ${deDonde}\n`);

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

// 4) El catálogo tiene que poder VENDER: los productos CON STOCK necesitan precio, porque en el
//    mostrador una ficha con stock y sin precio no se puede cobrar (el botón queda apagado).
//    Los que no tienen stock y no tienen precio son aviso: no hay nada que vender de ellos.
const total = tabla('products');
const sinPrecioConStock = q('SELECT COUNT(*) n, COALESCE(SUM(stock),0) u FROM products WHERE (price_sale IS NULL OR price_sale <= 0) AND stock > 0');
const sinPrecioSinStock = q('SELECT COUNT(*) n FROM products WHERE (price_sale IS NULL OR price_sale <= 0) AND stock <= 0');
const conStock = q('SELECT COUNT(*) n, COALESCE(SUM(stock),0) u FROM products WHERE stock > 0');
const sinCosto = q('SELECT COUNT(*) c FROM products WHERE price_cost IS NULL OR price_cost <= 0');
if (total.error) fail('no pude leer «products»', total.error);
else if (!total.c) fail('la plantilla NO tiene productos', 'una PC nueva arrancaría con el catálogo vacío');
else {
  if (sinPrecioConStock.n > 0) {
    const exc = excepciones.sin_precio_con_stock;
    const dentro = exc && sinPrecioConStock.n <= exc.max_fichas && sinPrecioConStock.u <= exc.max_unidades;
    const detalle = `de ${conStock.n} fichas con stock: esas no se pueden cobrar en el mostrador. Cargá esos precios a mano o completá la lista, y volvé a correr la restauración de precios (REGISTRO_PRICES_DB/APPLY).`;
    if (dentro) {
      warn(
        `excepción ACEPTADA (${exc.aceptada_por}, ${exc.fecha}): ${sinPrecioConStock.n} productos con stock (${sinPrecioConStock.u} unidades) sin precio`,
        `motivo: ${exc.motivo} — TOPE aceptado: ${exc.max_fichas} fichas / ${exc.max_unidades} unidades. ${detalle}`);
    } else if (exc) {
      fail(`${sinPrecioConStock.n} productos CON STOCK (${sinPrecioConStock.u} unidades) SIN precio de venta — EMPEORÓ respecto de la excepción aceptada (${exc.max_fichas} fichas / ${exc.max_unidades} unidades)`,
        `la excepción del ${exc.fecha} ya no cubre la situación: revisala en tools/release_excepciones.json. ${detalle}`);
    } else {
      fail(`${sinPrecioConStock.n} productos CON STOCK (${sinPrecioConStock.u} unidades) SIN precio de venta`, detalle);
    }
  } else pass('todos los productos con stock tienen precio de venta');
  if (sinPrecioSinStock.n > 0) warn(`${sinPrecioSinStock.n} productos sin stock y sin precio`, 'no hay nada que vender de ellos; se pueden dejar así o cargarles precio después');
  if (sinCosto.c > 0) warn(`${sinCosto.c} productos sin precio de costo`, 'la utilidad del Dashboard y el capital de inventario quedarían en 0 para esos SKU');
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

// 8) HIGIENE DEL REPO — un archivo gigante versionado impide publicar: GitHub rechaza un push con un
//    archivo de más de 100 MB, y aunque pase, el repo público queda inflado para siempre.
//    Caso real (2026-09-18): `tools/progress/patterns.md` había llegado a 310 MB porque el
//    consolidador de aprendizajes del harness DUPLICABA el contenido en cada corrida (20 aprendizajes
//    únicos, uno repetido 524.288 veces = 2^19) y el `git add -A` de un release lo metió al historial.
//    Se arregla con `node tools/dedupe_patterns.mjs`; este chequeo evita que vuelva a pasar en silencio.
const MB = 1024 * 1024;
const LIMITE_FALLA = 100 * MB;   // límite duro de GitHub por archivo
const LIMITE_AVISO = 5 * MB;     // a partir de acá, algo se está desbocando
const IGNORAR = new Set(['node_modules', '.git', 'target', 'dist', 'backup', 'instaladores', '.vite']);
const grandes = [];
(function recorrer(dir, prof) {
  if (prof > 6) return;
  let entradas;
  try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) {
    if (e.isDirectory()) {
      if (!IGNORAR.has(e.name)) recorrer(join(dir, e.name), prof + 1);
      continue;
    }
    if (!e.isFile()) continue;
    const ruta = join(dir, e.name);
    try {
      const st = statSync(ruta);
      if (st.size > LIMITE_AVISO) grandes.push({ ruta: ruta.replace(ROOT + '\\', ''), mb: st.size / MB });
    } catch { /* archivo que se movió: no es asunto del gate */ }
  }
})(ROOT, 0);
grandes.sort((a, b) => b.mb - a.mb);
const exagerados = grandes.filter(g => g.mb * MB > LIMITE_FALLA);
const sospechosos = grandes.filter(g => g.mb * MB <= LIMITE_FALLA);
if (exagerados.length) {
  fail(`${exagerados.length} archivo(s) de más de 100 MB en el repo (el push a GitHub va a FALLAR)`,
    exagerados.slice(0, 3).map(g => `${g.ruta} (${g.mb.toFixed(0)} MB)`).join(' · ') + ' — deduplicá/borrá antes de publicar');
} else if (sospechosos.length) {
  warn(`${sospechosos.length} archivo(s) grandes en el repo`, sospechosos.slice(0, 3).map(g => `${g.ruta} (${g.mb.toFixed(1)} MB)`).join(' · '));
} else {
  pass('sin archivos desbocados en el repo', `ningún archivo de más de ${LIMITE_AVISO / MB} MB`);
}

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
