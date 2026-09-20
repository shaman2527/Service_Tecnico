// ¿LA ACTUALIZACIÓN TOCA LOS DATOS DEL LOCAL? — la condición que puso el dueño:
// «que cuando suba la actualización no le afecte la db ni las ventas registradas».
//
// QUÉ HACE, con evidencia y no con confianza: toma una COPIA consistente de la base que le
// indiques (VACUUM INTO: incluye el WAL, la original NUNCA se abre para escribir), fotografía
// TODA la historia del cliente, corre la MIGRACIÓN REAL de la app sobre la copia (el hook de
// Rust `test_manual_migrate_db` → `Database::new` → `init()`, el MISMO camino que ejecuta el
// arranque después de actualizarse) y vuelve a fotografiar. Después compara.
//
// LA REGLA (lo que la app puede y no puede tocar al migrar):
//   NO PUEDE CAMBIAR — la historia del cliente, dato por dato:
//     · sales, service_payments, clients, expenses: TODAS las filas, TODAS las columnas.
//     · services: todas las filas y columnas, salvo `paid_amount` (ver abajo).
//     · products: el stock y los precios de CADA ficha (por id).
//     · daily_closings: fecha, estado, apertura/cierre, arqueo real y notas.
//   CAMBIA POR DISEÑO (y se informa, no se esconde):
//     · `services.paid_amount` — `init()` lo recalcula con la ÚNICA regla vigente (neto por moneda).
//       En una base al día da IDÉNTICO (idempotencia); si difiere, se muestra el antes/después para
//       revisarlo (puede ser una mejora de una base vieja, o un problema: por eso se ve).
//     · `daily_closings.tasa_bcv` (solo cuando estaba en 0: se hereda la del cierre anterior),
//       `total_usd`/`total_bs`/`grand_total` (se recalculan de los movimientos reales).
//     · Columnas NUEVAS y la tabla `phones` (el padrón de modelos).
//
// Uso:
//   node tools/verify_migracion_datos.mjs                       → sobre registro.db (la del taller)
//   node tools/verify_migracion_datos.mjs --db backup/vieja.db  → sobre otra base (p.ej. la de 0.2.5)
//   node tools/verify_migracion_datos.mjs --keep                → deja la copia migrada para inspeccionar
// Salida: exit 0 = la historia quedó intacta · exit 1 = algo de la historia cambió · exit 2 = error.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, copyFileSync, unlinkSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argDe = (n, def) => (args.includes(n) ? args[args.indexOf(n) + 1] : def);
const ORIGEN = resolve(ROOT, argDe('--db', 'registro.db'));
const KEEP = args.includes('--keep');
const COSECHA = new Date().toISOString().replace(/[:.]/g, '-');
const COPIA = join(ROOT, 'backup', `_prueba_migracion_${COSECHA}.db`);

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
const HISTORIA = ['sales', 'services', 'service_payments', 'clients', 'expenses', 'daily_closings'];

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

/** Productos: stock y precios por id (el stock del taller es dato del cliente). */
function leerProductos(ruta) {
  const db = new DatabaseSync(ruta, { readOnly: true });
  try {
    const filas = db.prepare('SELECT id, COALESCE(stock,0) stock, COALESCE(price_sale,0) ps, COALESCE(price_cost,0) pc FROM products ORDER BY id').all();
    return filas;
  } finally {
    db.close();
  }
}
const productosAntes = leerProductos(COPIA);

const cuenta = (t) => (foto[t] ? foto[t].filas.length : 0);
console.log('estado inicial de la historia:');
info(`${cuenta('sales')} ventas · ${cuenta('services')} servicios · ${cuenta('service_payments')} abonos · `
  + `${cuenta('clients')} clientes · ${cuenta('daily_closings')} cierres · ${cuenta('expenses')} gastos`);
info(`${productosAntes.length} productos · ${productosAntes.reduce((a, p) => a + p.stock, 0)} unidades de stock`);

// ── 3) LA MIGRACIÓN REAL (el mismo código que corre al abrir la app actualizada) ─────────────
// OJO: stdio 'inherit' a propósito. El hook imprime lo que importa (tiempo, conteos, integrity,
// salud) y capturarlo por caño es justo lo que el entorno puede bloquear; que se vea en pantalla
// además hace la prueba auditable a simple vista.
console.log('\n--- corriendo la migración real de la app (Database::new + init) ---');
let migracionOk = true;
try {
  execFileSync('cargo',
    ['test', '--release', '--lib', '--', '--ignored', 'test_manual_migrate_db', '--nocapture'],
    {
      cwd: join(ROOT, 'src-tauri'),
      env: { ...process.env, REGISTRO_MIGRATE_DB: COPIA },
      stdio: 'inherit',
      timeout: 20 * 60 * 1000,
    });
} catch {
  migracionOk = false;
}
check('la migración corre sin fallar (la app abre la base del taller)', migracionOk,
  migracionOk ? '' : 'el hook de migración falló — ver salida arriba');

if (!existsSync(COPIA)) { console.error('la copia desapareció durante la prueba'); process.exit(2); }

// ── 4) Fotografía después y comparación ─────────────────────────────────────────────────────
// Clasificación de columnas por lo que la app PUEDE hacer con ellas al migrar. No se trata de
// «perdonar» diferencias: cada categoría tiene su propia comprobación ESTRICTA.
//   · IGUAL: tiene que quedar idéntica (la historia del cliente, el arqueo, el stock, los precios).
//   · TITLECASE: migración documentada del 2026-08-07 (nombres propios de personas). No se acepta
//     «parecido»: el valor nuevo tiene que ser EXACTAMENTE `titleCase(viejo)`. Si no, es un fallo.
//   · RECALCULADO: la app recalcula columnas RESUMEN (saldo abonado y esperado del cierre). Se
//     informan una por una para que se vean; el arqueo contado y la diferencia NO entran acá.
const TITLECASE = {
  clients: ['name'],
  services: ['client'],
  sales: ['client_name'],
};
const RECALCULADO = {
  services: ['paid_amount'],
  daily_closings: ['tasa_bcv', 'total_usd', 'total_bs', 'grand_total'],
};

/** La MISMA regla de la app (`title_case` de db.rs): inicial mayúscula, resto minúsculas. */
const titleCase = (s) => String(s ?? '').split(/\s+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

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
  const antesPorId = new Map(antes.filas.map((f, i) => [f.id ?? i, f]));

  let distintas = 0;
  let ejemplo = '';
  let tcMal = 0;
  let ejemploTC = '';
  for (const [i, f] of despues.filas.entries()) {
    const a = antesPorId.get(f.id ?? i);
    if (!a) { distintas += 1; ejemplo ||= 'fila nueva'; continue; }
    // 1) lo que NO puede cambiar
    for (const c of colsIgual) {
      const va = a[c] === undefined ? null : a[c];
      const vd = f[c] === undefined ? null : f[c];
      if (String(va) !== String(vd)) { distintas += 1; ejemplo ||= `id ${f.id}: ${c} «${va}» → «${vd}»`; break; }
    }
    // 2) Title Case: el nuevo TIENE que ser exactamente titleCase(viejo)
    for (const c of colsTC) {
      const va = a[c] === undefined ? null : a[c];
      const vd = f[c] === undefined ? null : f[c];
      if (String(va) === String(vd)) continue;
      if (titleCase(va) === String(vd)) { cambiosTitleCase.push(`${t}.${c}: «${va}» → «${vd}»`); }
      else { tcMal += 1; ejemploTC ||= `id ${f.id}: ${c} «${va}» → «${vd}» (no es un Title Case de lo anterior)`; }
    }
  }
  check(`${t}: ${antes.filas.length} fila(s) intactas, columna por columna`, distintas === 0,
    distintas === 0 ? '' : `${distintas} fila(s) cambiaron — p.ej. ${ejemplo}`);
  if (colsTC.length) {
    check(`${t}: los nombres solo se normalizaron (Title Case) y no se perdió ninguno`, tcMal === 0,
      tcMal === 0
        ? (cambiosTitleCase.filter(x => x.startsWith(`${t}.`)).length
          ? `normalizados: ${cambiosTitleCase.filter(x => x.startsWith(`${t}.`)).slice(0, 3).join(' · ')}`
          : 'sin cambios de nombre')
        : ejemploTC);
  }

  // 3) Lo que la app recalcula se INFORMA (no se esconde ni se disfraza de fallo).
  if (colsRecalc.length && antes.filas.length) {
    for (const [i, f] of despues.filas.entries()) {
      const a = antesPorId.get(f.id ?? i);
      if (!a) continue;
      for (const c of colsRecalc) {
        const va = a[c] === undefined ? null : a[c];
        const vd = f[c] === undefined ? null : f[c];
        if (String(va) !== String(vd)) cambiosInformativos.push(`${t} · id ${f.id}: ${c} ${va} → ${vd}`);
      }
    }
  }
}

// Productos: stock y precios por ficha (id), que es el inventario del local.
const productosDespues = leerProductos(COPIA);
const antesPorId = new Map(productosAntes.map(p => [p.id, p]));
const stockCambiado = productosDespues.filter(p => {
  const a = antesPorId.get(p.id);
  return !a || a.stock !== p.stock;
});
const precioCambiado = productosDespues.filter(p => {
  const a = antesPorId.get(p.id);
  return !a || a.ps !== p.ps || a.pc !== p.pc;
});
check('products: el STOCK de cada ficha (por id) no cambió', stockCambiado.length === 0,
  stockCambiado.length ? `${stockCambiado.length} ficha(s) con stock distinto — p.ej. id ${stockCambiado[0].id}` : '');
check('products: los PRECIOS no cambiaron', precioCambiado.length === 0,
  precioCambiado.length ? `${precioCambiado.length} ficha(s) con precio distinto` : '');
check('products: la cantidad de fichas no cambió', productosAntes.length === productosDespues.length,
  `${productosAntes.length} → ${productosDespues.length}`);

// La app nueva NECESITA sus columnas: si la migración no las agregó, la versión nueva no funciona.
const COLS_NUEVAS = {
  services: ['service_types', 'device_checklist', 'client_ci', 'client_address', 'screen_product_id',
    'group_id', 'discount_amount', 'photo_in_at', 'photo_out_at', 'pay_intent', 'technician_id'],
};
for (const [tabla, cols] of Object.entries(COLS_NUEVAS)) {
  const t = leerTabla(COPIA, tabla);
  const faltan = cols.filter(c => !t.cols.includes(c));
  check(`${tabla}: la migración dejó las columnas de la versión nueva`, faltan.length === 0,
    faltan.length ? `faltan: ${faltan.join(', ')}` : `${cols.length} columnas presentes`);
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
  console.log('\n--- columnas RESUMEN recalculadas por la app (informado, no oculto) ---');
  for (const c of cambiosInformativos.slice(0, 12)) info(c);
  if (cambiosInformativos.length > 12) info(`… y ${cambiosInformativos.length - 12} más`);
  info('son el saldo abonado y el esperado del cierre, que la app deriva de los movimientos reales.');
  info('El ARQUEO que contó el cajero (actual_*) y la DIFERENCIA de cada cierre NO se tocan: se comparan como');
  info('columnas que no pueden cambiar (arriba, en verde). En una base al día no cambia ninguna.');
}
console.log(`\n(la base ORIGINAL no se tocó: todo corrió sobre la copia ${basename(COPIA)})`);

if (KEEP) {
  console.log(`copia migrada conservada en: ${COPIA.replace(ROOT + '\\', '')}`);
} else {
  rmSync(COPIA, { force: true });
  for (const suf of ['-wal', '-shm']) rmSync(COPIA + suf, { force: true });
}

console.log(`\nmigración y datos: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallo(s)`);
process.exit(failures > 0 ? 1 : 0);
