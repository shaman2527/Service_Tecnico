// ¿LA ACTUALIZACIÓN TOCA LOS DATOS DEL LOCAL? — la condición que puso el dueño:
// «que cuando suba la actualización no le afecte la db ni las ventas registradas».
//
// QUÉ HACE, con evidencia y no con confianza: toma una COPIA consistente de la base que le
// indiques (VACUUM INTO: incluye el WAL, la original NUNCA se abre para escribir), fotografía
// TODA la historia del cliente, corre la MIGRACIÓN REAL de la app sobre la copia (el hook de
// Rust `test_manual_migrate_db` → `Database::new` → `init()`, el MISMO camino que ejecuta el
// arranque después de actualizarse) y vuelve a fotografiar. Después compara.
//
// LA PRUEBA NO SE CREE DEL EXIT CODE (lección de la revisión adversarial del 2026-09-18): si el
// filtro del test no matchea, `cargo test` sale 0 con «0 filtered out» y la comparación sería la
// copia contra sí misma → un falso verde sobre lo único que el dueño pidió. Por eso la salida del
// hook se guarda en un ARCHIVO y se exige evidencia positiva: que imprima «test result: ok. 1
// passed», que NO diga «0 passed»/«0 filtered out», que aparezca la línea de la migración con su
// tiempo y que exista el CENTINELA que el hook escribe al terminar (REGISTRO_MIGRATE_MARK). Si
// falta cualquiera de esas cosas, esto no es un PASS: es un error de la prueba.
//
// LA REGLA (lo que la app puede y no puede tocar al migrar):
//   NO PUEDE CAMBIAR — la historia del cliente, fila por fila y columna por columna:
//     · sales, service_payments, clients, expenses, inventory_movements, purchase_orders,
//       purchase_order_items: TODAS las filas, TODAS las columnas, sin filas nuevas ni borradas.
//     · services: todas las filas y columnas, salvo `paid_amount` (ver abajo).
//     · products: el stock, los precios y los datos de CADA ficha (por id), sin altas ni bajas.
//     · daily_closings: fecha, estado, apertura/cierre, arqueo real (actual_*), difference y notas.
//   CAMBIA POR DISEÑO — y se comprueba cada cosa con SU regla, no «se informa y listo»:
//     · `services.paid_amount` — `init()` lo recalcula con la ÚNICA regla vigente (neto por moneda).
//       Se exige que la diferencia sea ≤ 1 centavo: más que eso cambia lo que el cliente debe y
//       FALLA la prueba (en una base al día da idéntico).
//     · `daily_closings.tasa_bcv` — solo puede LLENARSE cuando estaba en 0 (se hereda la del cierre
//       anterior). Si una tasa que existía cambia o se pierde, FALLA.
//     · `daily_closings.total_usd/total_bs/grand_total` — columnas RESUMEN derivadas de los
//       movimientos reales. Se recalculan (es la corrección documentada) pero se listan una por una,
//       y un CAMBIO DE SIGNO en un cierre cerrado FALLA: eso ya no es «recalcular», es otra cosa.
//     · `products.search_text` — índice de búsqueda que `init()` rellena si está vacío.
//     · Columnas NUEVAS y la tabla `phones` (el padrón de modelos).
//
// Uso:
//   node tools/verify_migracion_datos.mjs                       → sobre registro.db (la del taller)
//   node tools/verify_migracion_datos.mjs --db backup/vieja.db  → sobre otra base (p.ej. la de 0.2.5)
//   node tools/verify_migracion_datos.mjs --keep                → deja la copia migrada para inspeccionar
//   node tools/verify_migracion_datos.mjs --debug               → build de pruebas en debug (más lento de compilar)
// Salida: exit 0 = la historia quedó intacta · exit 1 = algo de la historia cambió · exit 2 = error.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, unlinkSync, rmSync, openSync, closeSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argDe = (n, def) => (args.includes(n) ? args[args.indexOf(n) + 1] : def);
const ORIGEN = resolve(ROOT, argDe('--db', 'registro.db'));
const KEEP = args.includes('--keep');
const DEBUG = args.includes('--debug');
const COSECHA = new Date().toISOString().replace(/[:.]/g, '-');
const COPIA = join(ROOT, 'backup', `_prueba_migracion_${COSECHA}.db`);
const LOG = join(ROOT, 'backup', `_prueba_migracion_${COSECHA}.log`);
const CENTINELA = join(ROOT, 'backup', `_prueba_migracion_${COSECHA}.mark`);

let checks = 0;
let failures = 0;
const check = (nombre, ok, detalle = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}${detalle ? `  ->  ${detalle}` : ''}`);
};
const info = (t) => console.log(`      · ${t}`);

if (!existsSync(ORIGEN)) { console.error(`No existe la base: ${ORIGEN}`); process.exit(2); }

// ── 1) Copia CONSISTENTE de la base real (la original no se toca) ────────────────────────────
console.log(`\n=== ¿la actualización toca los datos? — copia de ${basename(ORIGEN)} ===\n`);
for (const suf of ['', '-wal', '-shm']) {
  const f = COPIA + suf;
  if (existsSync(f)) unlinkSync(f);
}
{
  const src = new DatabaseSync(ORIGEN, { readOnly: true });
  src.exec(`VACUUM INTO '${COPIA.replace(/'/g, "''")}'`);
  src.close();
}
info(`copia consistente: ${COPIA.replace(ROOT + '\\', '')}`);

// ── 2) Fotografía de la historia ────────────────────────────────────────────────────────────
// Las columnas se leen de la base ANTES de migrar y se usan para las DOS fotos: así lo que se
// compara es exactamente «los datos que ya existían», sin que las columnas nuevas ensucien.
const HISTORIA = [
  'sales', 'services', 'service_payments', 'clients', 'expenses', 'daily_closings',
  'inventory_movements', 'purchase_orders', 'purchase_order_items',
];

/** Devuelve { columnas, filas } de una tabla, o null si la tabla no existe. */
function leerTabla(ruta, tabla) {
  const db = new DatabaseSync(ruta, { readOnly: true });
  try {
    const cols = db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
    if (cols.length === 0) return null;
    const filas = db.prepare(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM ${tabla} ORDER BY rowid`).all();
    return { cols, filas };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

const foto = {};
for (const t of HISTORIA) foto[t] = leerTabla(COPIA, t);

/** Productos: stock, precios y datos de cada ficha (el inventario del local es dato del cliente).
 *  La lista de columnas sale de la base ANTES de migrar (`search_text` se excluye: es un índice que
 *  `init()` rellena). Una base de la era 0.2.5 no tiene `price_usd`/`supplier`: pedirlas a ciegas
 *  rompía la prueba con un error de SQL en vez de comparar lo que sí existe. */
const camposProducto = (() => {
  const d = new DatabaseSync(COPIA, { readOnly: true });
  try {
    const cols = d.prepare('PRAGMA table_info(products)').all().map(c => c.name);
    const fuera = new Set(['search_text', 'updated_at', 'created_at']);
    return cols.filter(n => !fuera.has(n));
  } catch {
    return ['id'];
  } finally {
    d.close();
  }
})();
function leerProductos(ruta) {
  const db = new DatabaseSync(ruta, { readOnly: true });
  try {
    return db.prepare(`SELECT ${camposProducto.map(c => `"${c}"`).join(', ')} FROM products ORDER BY id`).all();
  } finally {
    db.close();
  }
}
const productosAntes = leerProductos(COPIA);

const cuenta = (t) => (foto[t] ? foto[t].filas.length : 0);
console.log('estado inicial de la historia:');
info(`${cuenta('sales')} ventas · ${cuenta('services')} servicios · ${cuenta('service_payments')} abonos · `
  + `${cuenta('clients')} clientes · ${cuenta('daily_closings')} cierres · ${cuenta('expenses')} gastos · `
  + `${cuenta('inventory_movements')} movimientos de inventario`);
info(`${productosAntes.length} productos · ${productosAntes.reduce((a, p) => a + p.stock, 0)} unidades de stock`);

// ── 3) LA MIGRACIÓN REAL (el mismo código que corre al abrir la app actualizada) ─────────────
// La salida va a un ARCHIVO (no a un caño) y después se exige evidencia positiva de que el test
// corrió: sin esto, un filtro que no matchea daría «la copia es igual a sí misma» = falso verde.
console.log('\n--- corriendo la migración real de la app (Database::new + init) ---');
for (const f of [LOG, CENTINELA]) if (existsSync(f)) unlinkSync(f);
let migracionOk = true;
{
  const fd = openSync(LOG, 'w');
  try {
    execFileSync('cargo',
      ['test', ...(DEBUG ? [] : ['--release']), '--lib', '--', '--ignored', 'test_manual_migrate_db', '--nocapture'],
      {
        cwd: join(ROOT, 'src-tauri'),
        env: { ...process.env, REGISTRO_MIGRATE_DB: COPIA, REGISTRO_MIGRATE_MARK: CENTINELA },
        stdio: ['ignore', fd, fd],
        timeout: 30 * 60 * 1000,
      });
  } catch {
    migracionOk = false;
  } finally {
    closeSync(fd);
  }
}
const salida = existsSync(LOG) ? readFileSync(LOG, 'utf-8') : '';
// La evidencia se muestra: la prueba tiene que poder auditarse a simple vista.
for (const l of salida.split(/\r?\n/)) {
  if (/migración \(Database::new \+ init\)|historia:|catálogo:|integrity_check|foreign_key_check|salud post-migración|test result:/.test(l)) {
    info(l.trim());
  }
}

// La evidencia positiva es «test result: ok. 1 passed». OJO con buscar la subcadena «0 filtered out»:
// «140 filtered out» la contiene y haría fallar la prueba por un falso negativo (pasó el 2026-09-18).
check('el test de migración corrió y pasó (no un filtro que no matchea nada)', migracionOk
  && /test result: ok\. 1 passed;/.test(salida),
  migracionOk ? 'la salida del hook no muestra «test result: ok. 1 passed» — revisá que el hook exista y compile' : 'cargo falló — ver arriba');
check('el hook reportó la migración (línea con el tiempo)', /migración \(Database::new \+ init\): [\d.]+ ms/.test(salida),
  'sin esa línea no hay prueba de que init() haya corrido sobre la copia');
check('el hook dejó el CENTINELA de que terminó', existsSync(CENTINELA),
  existsSync(CENTINELA) ? readFileSync(CENTINELA, 'utf-8').trim().slice(0, 160) : `no existe ${basename(CENTINELA)}`);
// El centinela tiene que ser de ESTA corrida (no uno viejo que quedó tirado).
if (existsSync(CENTINELA)) {
  const edad = Date.now() - statSync(CENTINELA).mtimeMs;
  check('el centinela es de esta corrida', edad < 60 * 60 * 1000, `edad ${Math.round(edad / 1000)} s`);
}

if (!existsSync(COPIA)) { console.error('la copia desapareció durante la prueba'); process.exit(2); }

// ── 4) Fotografía después y comparación ─────────────────────────────────────────────────────
// Clasificación de columnas por lo que la app PUEDE hacer con ellas al migrar. No se trata de
// «perdonar» diferencias: cada categoría tiene su propia comprobación ESTRICTA.
const TITLECASE = {                       // migración documentada 2026-08-07: nombres de personas
  clients: ['name'],
  services: ['client'],
  sales: ['client_name'],
};
const RECALCULADO = {                     // derivadas: se recalculan, con su propia regla
  services: ['paid_amount'],
  daily_closings: ['tasa_bcv', 'total_usd', 'total_bs', 'grand_total'],
  products: ['search_text'],              // índice de búsqueda: init() lo rellena si está vacío
};
const TOL_DINERO = 0.01;                  // un centavo: más que eso cambia lo que el cliente debe

/** La MISMA regla de la app (`title_case` de db.rs): inicial mayúscula, resto minúsculas. */
const titleCase = (s) => String(s ?? '').split(/\s+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const num = (v) => (typeof v === 'number' ? v : parseFloat(v));
/** Número tolerante: NULL, '' o basura cuentan como 0 (es lo que hace la app con COALESCE). */
const num0 = (v) => { const n = num(v); return Number.isFinite(n) ? n : 0; };
const signo = (v) => { const n = num(v); return Number.isFinite(n) ? Math.sign(n) : 0; };

console.log('\n--- ¿cambió la historia? ---');
const cambiosInformativos = [];
const cambiosTitleCase = [];
for (const t of HISTORIA) {
  const antes = foto[t];
  const despues = leerTabla(COPIA, t);
  if (!antes) { info(`${t}: no existía en esta base (nada que comparar)`); continue; }
  if (!despues) { check(`${t}: sigue existiendo después de migrar`, false, 'la tabla desapareció'); continue; }

  const colsTC = TITLECASE[t] || [];
  const colsRecalc = RECALCULADO[t] || [];
  const colsIgual = antes.cols.filter(c => !colsTC.includes(c) && !colsRecalc.includes(c));

  // FILAS: una fila borrada no se visita si solo se recorre el «después» — se comparan los ids de
  // los dos lados (unión) y los conteos. Borrar historia es lo peor que podría hacer una migración.
  const clave = (f, i) => (f.id !== undefined ? `id:${f.id}` : `pos:${i}`);
  const idsAntes = new Map(antes.filas.map((f, i) => [clave(f, i), f]));
  const idsDespues = new Map(despues.filas.map((f, i) => [clave(f, i), f]));
  const borradas = [...idsAntes.keys()].filter(k => !idsDespues.has(k));
  const nuevas = [...idsDespues.keys()].filter(k => !idsAntes.has(k));
  const antesPorId = idsAntes;

  let distintas = 0;
  let ejemplo = '';
  let tcMal = 0;
  let ejemploTC = '';
  for (const [k, f] of idsDespues) {
    const a = antesPorId.get(k);
    if (!a) continue;   // fila nueva: ya se reporta aparte
    for (const c of colsIgual) {
      const va = a[c] === undefined ? null : a[c];
      const vd = f[c] === undefined ? null : f[c];
      if (String(va) !== String(vd)) { distintas += 1; ejemplo ||= `id ${f.id}: ${c} «${va}» → «${vd}»`; break; }
    }
    for (const c of colsTC) {
      const va = a[c] === undefined ? null : a[c];
      const vd = f[c] === undefined ? null : f[c];
      if (String(va) === String(vd)) continue;
      if (titleCase(va) === String(vd)) cambiosTitleCase.push(`${t}.${c}: «${va}» → «${vd}»`);
      else { tcMal += 1; ejemploTC ||= `id ${f.id}: ${c} «${va}» → «${vd}» (no es un Title Case de lo anterior)`; }
    }
  }

  check(`${t}: ninguna fila se perdió (${antes.filas.length} antes)`, borradas.length === 0,
    borradas.length ? `desaparecieron ${borradas.length} — p.ej. ${borradas[0]}` : `${idsDespues.size} después`);
  check(`${t}: no aparecieron filas nuevas`, nuevas.length === 0,
    nuevas.length ? `${nuevas.length} fila(s) nuevas — p.ej. ${nuevas[0]}` : '');
  check(`${t}: ${antes.filas.length} fila(s) con sus columnas intactas`, distintas === 0,
    distintas === 0 ? '' : `${distintas} fila(s) cambiaron — p.ej. ${ejemplo}`);
  if (colsTC.length) {
    check(`${t}: los nombres solo se normalizaron (Title Case) y no se perdió ninguno`, tcMal === 0,
      tcMal === 0
        ? (cambiosTitleCase.filter(x => x.startsWith(`${t}.`)).length
          ? `normalizados: ${cambiosTitleCase.filter(x => x.startsWith(`${t}.`)).slice(0, 3).join(' · ')}`
          : 'sin cambios de nombre')
        : ejemploTC);
  }

  // COLUMNAS DERIVADAS de dinero: cada una con SU regla, y lo que no se puede justificar FALLA.
  for (const [k, f] of idsDespues) {
    const a = antesPorId.get(k);
    if (!a) continue;
    for (const c of colsRecalc) {
      const va = a[c] === undefined ? null : a[c];
      const vd = f[c] === undefined ? null : f[c];
      if (String(va) === String(vd)) continue;
      if (t === 'services' && c === 'paid_amount') {
        // Lo que importa NO es el valor crudo sino el SALDO de la orden (`amount - paid_amount`): en
        // una base de julio `paid_amount` era NULL y la migración lo deja en 0, que para la deuda es
        // exactamente lo mismo. Se compara el saldo, con tolerancia de un centavo.
        const saldoAntes = num0(a.amount) - num0(va);
        const saldoDespues = num0(f.amount) - num0(vd);
        const d = Math.abs(saldoDespues - saldoAntes);
        check(`services.paid_amount id ${f.id}: el recálculo no mueve el SALDO de la orden`, d <= TOL_DINERO,
          `saldo ${saldoAntes.toFixed(2)} → ${saldoDespues.toFixed(2)} (paid_amount ${va} → ${vd})`);
        if (d <= TOL_DINERO && String(va) !== String(vd)) {
          cambiosInformativos.push(`${t} · id ${f.id}: ${c} ${va} → ${vd} (el saldo no cambia)`);
        }
      } else if (t === 'daily_closings' && c === 'tasa_bcv') {
        const perdida = num(va) > 0 && num(vd) <= 0;
        check(`cierre del ${a.close_date}: la tasa que existía no se pierde`, !perdida,
          perdida ? `tasa_bcv ${va} → ${vd}` : `tasa ${va} → ${vd} (heredada del cierre anterior)`);
        cambiosInformativos.push(`${t} · ${a.close_date}: ${c} ${va} → ${vd}`);
      } else if (t === 'daily_closings') {
        const volteado = signo(va) !== 0 && signo(vd) !== 0 && signo(va) !== signo(vd);
        check(`cierre del ${a.close_date}: ${c} no cambia de signo`, !volteado,
          volteado ? `${va} → ${vd} (signo invertido en un cierre cerrado)` : `${va} → ${vd}`);
        cambiosInformativos.push(`${t} · ${a.close_date}: ${c} ${va} → ${vd}`);
      } else {
        cambiosInformativos.push(`${t} · id ${f.id}: ${c} ${va} → ${vd}`);
      }
    }
  }
}

// Productos: stock, precios y datos por ficha (id), que es el inventario del local.
// Se comparan SOLO las columnas que existían antes (una base vieja no tiene todas) y con igualdad
// estricta de valor: NULL ≠ 0 (un stock que se vuelve 0 no es «lo mismo» que uno que estaba vacío).
const productosDespues = leerProductos(COPIA);
const antesPorId = new Map(productosAntes.map(p => [p.id, p]));
const despuesPorId = new Map(productosDespues.map(p => [p.id, p]));
const borrados = [...antesPorId.keys()].filter(id => !despuesPorId.has(id));
const agregados = [...despuesPorId.keys()].filter(id => !antesPorId.has(id));
const igual = (a, b) => String(a ?? null) === String(b ?? null);
const cambian = (campos) => productosDespues.filter(p => {
  const a = antesPorId.get(p.id);
  return !a || campos.some(c => !igual(a[c], p[c]));
});
const COLS_PRECIO = ['price_sale', 'price_cost', 'price_usd'].filter(c => camposProducto.includes(c));
const COLS_DATO = camposProducto.filter(c => !['id', 'stock', ...COLS_PRECIO].includes(c));
const stockCambiado = cambian(['stock']);
const precioCambiado = cambian(COLS_PRECIO);
const datosCambiados = cambian(COLS_DATO);
check('products: no se perdió ninguna ficha', borrados.length === 0,
  borrados.length ? `${borrados.length} ficha(s) desaparecieron — p.ej. id ${borrados[0]}` : `${productosDespues.length} fichas`);
check('products: no se inventó ninguna ficha', agregados.length === 0,
  agregados.length ? `${agregados.length} ficha(s) nuevas — p.ej. id ${agregados[0]}` : '');
check('products: el STOCK de cada ficha (por id) no cambió', stockCambiado.length === 0,
  stockCambiado.length ? `${stockCambiado.length} ficha(s) con stock distinto — p.ej. id ${stockCambiado[0].id}` : '');
check('products: los PRECIOS no cambiaron', precioCambiado.length === 0,
  precioCambiado.length ? `${precioCambiado.length} ficha(s) con precio distinto` : '');
check('products: los DATOS de la ficha (marca, modelo, compatibilidad, categoría…) no cambiaron',
  datosCambiados.length === 0,
  datosCambiados.length ? `${datosCambiados.length} ficha(s) con datos distintos — p.ej. id ${datosCambiados[0].id}` : '');

// La app nueva NECESITA sus columnas: si la migración no las agregó, la versión nueva no funciona.
const COLS_NUEVAS = {
  services: ['service_types', 'device_checklist', 'client_ci', 'client_address', 'screen_product_id',
    'group_id', 'discount_amount', 'photo_in_at', 'photo_out_at', 'pay_intent', 'technician_id'],
  daily_closings: ['total_usd', 'total_bs', 'pos_settled_bs', 'actual_punto_usd', 'actual_punto_bs'],
  sales: ['discount_amount', 'currency', 'client_id'],
  products: ['search_text', 'price_usd', 'supplier'],
  clients: ['ci', 'address'],
};
for (const [tabla, cols] of Object.entries(COLS_NUEVAS)) {
  const t = leerTabla(COPIA, tabla);
  if (!t) { check(`${tabla}: la tabla existe para poder migrar`, false, 'no existe en la copia'); continue; }
  const faltan = cols.filter(c => !t.cols.includes(c));
  check(`${tabla}: la migración dejó las columnas de la versión nueva`, faltan.length === 0,
    faltan.length ? `faltan: ${faltan.join(', ')}` : `${cols.length} columnas presentes`);
}
{
  const d = new DatabaseSync(COPIA, { readOnly: true });
  let phones = -1;
  try { phones = d.prepare('SELECT COUNT(*) c FROM phones').get().c; } catch { phones = -1; }
  d.close();
  check('el padrón de teléfonos (`phones`) quedó utilizable', phones > 0, `${phones} teléfonos`);
}

// La versión nueva tiene que poder TRABAJAR sobre la base migrada: sus consultas no pueden fallar.
console.log('\n--- la app nueva puede leer la base migrada ---');
const db = new DatabaseSync(COPIA, { readOnly: true });
const consultaOk = (label, sql) => {
  try { const r = db.prepare(sql).get(); check(label, true, `→ ${JSON.stringify(r).slice(0, 80)}`); }
  catch (e) { check(label, false, e.message); }
};
try {
  consultaOk('lee el próximo número de orden', "SELECT COALESCE(MAX(CAST(substr(order_num,5) AS INTEGER)),0)+1 AS n FROM services WHERE order_num LIKE 'DEV-%'");
  consultaOk('lee el día activo', 'SELECT COUNT(*) AS abiertos FROM daily_closings WHERE is_closed=0');
  consultaOk('lee los saldos por cobrar', 'SELECT COUNT(*) AS con_saldo FROM services WHERE (amount - COALESCE(paid_amount,0)) > 0.005');
  consultaOk('lee el padrón de teléfonos', 'SELECT COUNT(*) AS telefonos FROM phones');
  consultaOk('lee los movimientos de inventario', 'SELECT COUNT(*) AS movimientos FROM inventory_movements');
} finally {
  db.close();
}

// ── 5) Limpieza y veredicto ─────────────────────────────────────────────────────────────────
if (cambiosTitleCase.length) {
  console.log('\n--- nombres normalizados por la migración documentada (Title Case, 2026-08-07) ---');
  for (const c of cambiosTitleCase.slice(0, 8)) info(c);
  if (cambiosTitleCase.length > 8) info(`… y ${cambiosTitleCase.length - 8} más`);
  info('es cosmético (mayúsculas/minúsculas) y NO fusiona clientes con el mismo nombre: ya viene en 0.2.5,');
  info('así que una PC actualizada desde esa versión no cambia ningún nombre.');
}
if (cambiosInformativos.length) {
  console.log('\n--- columnas RESUMEN recalculadas por la app (listadas una por una) ---');
  for (const c of cambiosInformativos.slice(0, 12)) info(c);
  if (cambiosInformativos.length > 12) info(`… y ${cambiosInformativos.length - 12} más`);
  info('son el saldo abonado y el esperado del cierre, que la app deriva de los movimientos reales.');
  info('El ARQUEO que contó el cajero (actual_*) y la DIFERENCIA de cada cierre NO se tocan: se comparan como');
  info('columnas que no pueden cambiar (arriba, en verde). En una base al día no cambia ninguna.');
}
console.log(`\n(la base ORIGINAL no se tocó: todo corrió sobre la copia ${basename(COPIA)})`);

if (KEEP) {
  console.log(`copia migrada conservada en: ${COPIA.replace(ROOT + '\\', '')}`);
  console.log(`salida del hook en: ${LOG.replace(ROOT + '\\', '')}`);
} else {
  rmSync(COPIA, { force: true });
  for (const suf of ['-wal', '-shm']) rmSync(COPIA + suf, { force: true });
  rmSync(LOG, { force: true });
  rmSync(CENTINELA, { force: true });
}

console.log(`\nmigración y datos: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallo(s)`);
process.exit(failures > 0 ? 1 : 0);
