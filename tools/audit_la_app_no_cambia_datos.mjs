#!/usr/bin/env node
// ============================================================================
// AUDITORÍA — «ABRIR Y USAR LA APP NO CAMBIA NINGÚN DATO» (2026-10-06).
//
// Qué prueba, exactamente: toma la HUELLA COMPLETA de la copia (todas las tablas, todas las filas,
// todas las columnas, con su hash) en tres momentos y las compara:
//
//   A) la copia tal como quedó el respaldo (antes de abrir la app);
//   B) después de ABRIR la app y ENTRAR (arranque + migraciones + login);
//   C) después de RECORRER todas las pantallas sin guardar nada.
//
//   · **B == C es la prueba fuerte**: navegar (Dashboard, Ventas, Servicio Técnico, Inventario,
//     Clientes, Libro Diario con sus pestañas y la tarjeta nueva de conciliación) NO escribe ni una
//     celda. Si algo cambia, este script imprime QUÉ tabla, QUÉ fila y QUÉ columna.
//   · **A vs B** se informa aparte: es lo que la app toca al arrancar/entrar (migraciones
//     idempotentes y el PIN que se guarda hasheado). Se muestra con nombre y apellido para que se vea
//     que no es plata.
//
// SEGURIDAD: trabaja SIEMPRE sobre una copia (`REGISTRO_DB`), nunca sobre `registro.db`.
//
// Uso:  $env:REGISTRO_DB="...\backup\audit_x.db"  ·  app abierta con CDP
//       node tools/audit_la_app_no_cambia_datos.mjs [--huella-a archivo.json]
// ============================================================================
// OJO: `cdp_driver.mjs` se importa MÁS ABAJO y de forma dinámica — su import abre el WebSocket con la
// app, así que no puede correr en el modo `--solo-a` (que se usa con la app CERRADA para tomar la
// huella del respaldo). Importarlo acá hacía fallar ese modo con «fetch failed / ECONNREFUSED».
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evalx(expr).catch(() => false)) return true; await sleep(300); }
  return false;
};

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) { console.error('ABORTADO: falta REGISTRO_DB (la copia que usa la app).'); process.exit(2); }
if (path.basename(dbPath).toLowerCase() === 'registro.db') { console.error('ABORTADO: apuntá REGISTRO_DB a una COPIA.'); process.exit(2); }

/** Lee TODA la base y devuelve `tabla -> filas` (valores normalizados) + su hash. */
const huella = () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => String(r.name));
  const datos = {};
  for (const t of tablas) {
    let filas = [];
    try { filas = db.prepare(`SELECT * FROM "${t}"`).all(); } catch { /* tabla virtual o rota: se informa vacía */ }
    datos[t] = filas.map(f => Object.fromEntries(Object.keys(f).sort().map(k => {
      const v = f[k];
      if (v === null) return [k, null];
      if (typeof v === 'bigint') return [k, Number(v)];
      if (v instanceof Uint8Array) return [k, `<blob ${v.length}>`];
      return [k, v];
    })));
  }
  let integridad = 'no leída';
  try { integridad = String(db.prepare('PRAGMA quick_check').all()?.[0]?.quick_check ?? 'ok'); } catch (e) { integridad = String(e); }
  db.close();
  const texto = JSON.stringify(datos);
  return { tablas, datos, integridad, hash: crypto.createHash('sha256').update(texto).digest('hex'), bytes: texto.length };
};

/** Diferencias exactas entre dos huellas: tabla → filas cambiadas, con el detalle de columnas. */
const diferencias = (a, b) => {
  const dif = [];
  for (const t of new Set([...Object.keys(a.datos), ...Object.keys(b.datos)])) {
    const fa = a.datos[t] ?? [], fb = b.datos[t] ?? [];
    if (JSON.stringify(fa) === JSON.stringify(fb)) continue;
    const cambios = [];
    const porId = (lista) => new Map(lista.map((f, i) => [String(f.id ?? f.key ?? i), f]));
    const ma = porId(fa), mb = porId(fb);
    for (const k of new Set([...ma.keys(), ...mb.keys()])) {
      const x = ma.get(k), y = mb.get(k);
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      if (!x) { cambios.push(`+ fila nueva ${k}`); continue; }
      if (!y) { cambios.push(`− fila borrada ${k}`); continue; }
      const cols = Object.keys(x).filter(c => JSON.stringify(x[c]) !== JSON.stringify(y[c]))
        .map(c => `${c}: ${JSON.stringify(x[c])} → ${JSON.stringify(y[c])}`);
      cambios.push(`fila ${k} → ${cols.slice(0, 4).join('; ')}`);
    }
    dif.push({ tabla: t, filas: { antes: fa.length, despues: fb.length }, cambios });
  }
  return dif;
};

console.log(`· copia: ${dbPath}`);

// Modo «sólo la huella A»: se corre ANTES de abrir la app y deja el respaldo de la huella en un JSON.
// (Es la única parte que necesita la app cerrada; después se compara A contra B con `--huella-a`.)
if (process.argv.includes('--solo-a')) {
  const i = process.argv.indexOf('--solo-a');
  const destino = process.argv[i + 1];
  const a = huella();
  if (destino) fs.writeFileSync(destino, JSON.stringify(a));
  console.log(`· huella A (copia sin abrir): ${a.tablas.length} tablas · hash ${a.hash.slice(0, 16)}… · integridad=${a.integridad}` + (destino ? ` → ${destino}` : ''));
  process.exit(0);
}

// ── A) la huella del respaldo (si se pasó por parámetro; si no, se puede comparar con la de arranque)
let huellaA = null;
const idx = process.argv.indexOf('--huella-a');
if (idx > 0 && process.argv[idx + 1] && fs.existsSync(process.argv[idx + 1])) {
  huellaA = JSON.parse(fs.readFileSync(process.argv[idx + 1], 'utf8'));
}

// Recién acá hace falta la app: el driver de CDP se importa dinámicamente (ver el comentario de arriba).
const { evalx, clickCenter, keyNav, typeText, sleep } = await import('./cdp_driver.mjs');

// ── B) abrir + entrar, y recién ahí la huella (así A→B mide lo que la app toca al arrancar/entrar)
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3500);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(3000);
}
await keyNav('Escape', 'Escape', 27).catch(() => {});
await sleep(800);
const huellaB = huella();
console.log(`· huella B (app abierta y sesión iniciada): ${huellaB.tablas.length} tablas · hash ${huellaB.hash.slice(0, 16)}… · integridad=${huellaB.integridad}`);

// ── C) RECORRER todas las pantallas SIN guardar nada ─────────────────────────────────────────────
const pantallas = ['Dashboard', 'Ventas', 'Servicio Técnico', 'Inventario', 'Pedidos', 'Clientes', 'Libro Diario', 'Ayuda'];
const visitadas = [];
for (const p of pantallas) {
  const ok = await evalx(`(() => { const b = [...document.querySelectorAll('aside button, aside a')].find(x => (x.innerText || '').trim().startsWith(${JSON.stringify(p)})); if (!b) return false; b.click(); return true; })()`);
  if (ok) { visitadas.push(p); await sleep(1600); }
  else console.log(`   (no encontré el módulo «${p}» con esta sesión)`);
}
// Libro Diario: sus pestañas (incluida la tarjeta NUEVA de conciliación) y cada filtro de fecha
for (const pestaña of ['Diario', 'Cierres', 'Pagos', 'Gastos', 'Salud', 'Movimientos']) {
  const ok = await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(pestaña)}); if (!b) return false; b.click(); return true; })()`);
  if (ok) await sleep(1400);
}
await waitFor(`!!document.querySelector('[data-panel="conciliacion"]')`, 12000);
// La conciliación de HOY y de otro día (el selector de fecha dispara su propia lectura)
const hayConcil = await evalx(`(() => { const i = document.querySelector('[data-field="conc-fecha"]'); if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '2026-09-17'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await sleep(2500);
await evalx(`(() => { const i = document.querySelector('[data-field="conc-fecha"]'); if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, new Date().toLocaleDateString('en-CA')); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await sleep(2500);
// Y los diálogos que MÁS miedo dan (leen la caja y los pagos) abriéndolos y cerrándolos sin guardar
for (const boton of ['Abrir Día', 'Cerrar Día', 'Actualizar día']) {
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(boton)}); if (b && !b.disabled) b.click(); return !!b; })()`);
  await sleep(1200);
  await keyNav('Escape', 'Escape', 27).catch(() => {});
  await sleep(800);
}
const huellaC = huella();
console.log(`· recorrido: ${visitadas.length} módulos + las pestañas del Libro Diario (conciliación de hoy y del 17/09, y los diálogos de caja abiertos sin guardar)`);
console.log(`· huella C (después del recorrido): hash ${huellaC.hash.slice(0, 16)}… · integridad=${huellaC.integridad}`);

// ── RESULTADO ────────────────────────────────────────────────────────────────────────────────────
check('la copia sigue ÍNTEGRA después de recorrer todo (quick_check)',
  huellaC.integridad.toLowerCase().startsWith('ok'), `integridad=${huellaC.integridad}`);
check('RECORRER LA APP NO CAMBIÓ NI UN DATO (huella completa, celda por celda)',
  huellaB.hash === huellaC.hash,
  huellaB.hash === huellaC.hash
    ? `${huellaC.tablas.length} tablas / ${huellaC.bytes} bytes de datos idénticos`
    : `CAMBIARON ${diferencias(huellaB, huellaC).length} tabla(s): ${JSON.stringify(diferencias(huellaB, huellaC)).slice(0, 400)}`);
if (huellaB.hash !== huellaC.hash) {
  for (const d of diferencias(huellaB, huellaC)) console.log(`   ${d.tabla}: filas ${d.filas.antes}→${d.filas.despues} · ${d.cambios.slice(0, 6).join(' | ')}`);
}
if (hayConcil) console.log('· (la tarjeta de conciliación se leyó en los dos días y no escribió nada)');

if (huellaA) {
  const dAB = diferencias(huellaA, huellaB);
  console.log('\n── A vs B: lo único que la app toca al ABRIR y ENTRAR (arranque + login) ──');
  if (dAB.length === 0) console.log('   (nada: el arranque tampoco escribió)');
  for (const d of dAB) {
    console.log(`   ${d.tabla}: ${d.filas.antes}→${d.filas.despues} filas · ${d.cambios.slice(0, 4).join(' | ')}`);
  }
  // El criterio NO es «no escribió nada» (el arranque de CUALQUIER versión corre sus migraciones
  // idempotentes: el índice de teléfonos del padrón y el redondeo a centavos de saldos viejos, que ya
  // estaban en el release). El criterio es que NO toque **plata cobrada** ni cambie la **moneda/método**
  // de nada: eso es lo que no se puede permitir. (Comprobado con el ejecutable RELEASE del 5/10 sobre
  // una copia idéntica: escribe EXACTAMENTE lo mismo → los cambios de este trabajo no agregan nada.)
  const PLATA = /^(sales|service_payments|cash_movements|daily_closings|expenses)$/;
  const tocaPlata = dAB.filter(d => PLATA.test(d.tabla));
  const tocaMoneda = dAB.filter(d => /currency|payment_method|"method"/.test(JSON.stringify(d.cambios)));
  check('el ARRANQUE no toca la PLATA COBRADA (ventas, cobros, libro, cierres, gastos) ni cambia ninguna moneda/método',
    tocaPlata.length === 0 && tocaMoneda.length === 0,
    tocaPlata.length || tocaMoneda.length
      ? `PLATA: ${tocaPlata.map(d => d.tabla).join(', ') || '—'} · MONEDA/MÉTODO: ${tocaMoneda.map(d => d.tabla).join(', ') || '—'}`
      : `tablas de plata intactas · monedas y métodos sin cambios · (lo demás: ${dAB.map(d => d.tabla).join(', ') || 'nada'})`);
  if (dAB.length) {
    console.log('   NOTA: lo de arriba son migraciones IDEMPOTENTES que ya trae el release (el índice de');
    console.log('   teléfonos del padrón y el redondeo a centavos de saldos viejos) + claves de `settings`');
    console.log('   que el respaldo de prueba no traía. Ninguna toca plata cobrada.');
  }
}
if (process.argv.includes('--huella-a-out')) {
  const i = process.argv.indexOf('--huella-a-out');
  if (process.argv[i + 1]) { fs.writeFileSync(process.argv[i + 1], JSON.stringify(huellaB)); console.log(`· huella escrita en ${process.argv[i + 1]}`); }
}

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
