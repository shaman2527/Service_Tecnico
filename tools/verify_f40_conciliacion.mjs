#!/usr/bin/env node
// ============================================================================
// F40 — LA CONCILIACIÓN DEL DÍA (verificación EN VIVO, 2026-10-06).
//
// QUÉ COMPRUEBA, por el camino real de la UI (Libro Diario → Movimientos):
//   A1 el día, ANTES de la prueba, ya cuadra (se mide contra la copia, no se supone);
//   A2 con una venta y un abono REALES (hechos por los write-points de verdad) el libro y las
//      ventas/abonos dicen LO MISMO: la tarjeta dice «Cuadra» y la línea no tiene diferencia;
//   A3 los movimientos de la prueba se ven contados en su método (libro == origen, sin diferencia);
//   B1 con una fila de plata SIN asiento en el libro (una base vieja o un write-point que se olvidó
//      de anotar) el estado pasa a **Con diferencias**, la línea muestra la diferencia y sale el aviso
//      que NOMBRA el método y las dos cifras — es el detector, la razón de ser de F40;
//   C  la prueba no deja residuos: el día vuelve a cuadrar y sus filas quedan anuladas/borradas.
//
// SEGURIDAD DE DATOS: ESCRIBE. `REGISTRO_DB` es OBLIGATORIO y tiene que ser una COPIA (aborta con
// registro.db). Necesita el día de HOY ABIERTO (es la caja del local): si la copia tiene un turno
// viejo, corré primero `node tools/verify_turno_viejo.mjs` (que ejecuta el remedio de F82).
//
// Uso:  $env:REGISTRO_DB="...\backup\f40_verif.db"
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 (+ REGISTRO_CDP_PORT)
//       node tools/verify_f40_conciliacion.mjs
// ============================================================================
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evalx(expr).catch(() => false)) return true; await sleep(300); }
  return false;
};
const inv = (cmd, args = {}) => evalx(`(async () => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
/** «$20.00» / «Bs. 1.234,56» / «-Bs. 10,00» / «2(8)» → número (es-VE: punto de miles, coma decimal).
 *  OJO: primero hay que sacar la ETIQUETA de la moneda («Bs.») — su punto, si queda, convierte el
 *  número en NaN y la comprobación pasa a mentir (pasó en la 1ª corrida: «Bs. 10,00» → NaN) — y hay
 *  que quedarse con el PRIMER número, porque la celda de movimientos puede traer «2(8)»
 *  (2 cobros con 8 asientos en el libro) y `Number('2(8)')` también es NaN. */
const num = (txt) => {
  const s = String(txt ?? '').replace(/Bs\./g, '').replace(/\$/g, '').trim();
  const m = s.match(/-?\d[\d.,]*/);
  if (!m) return NaN;
  const t = m[0].replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia que usa la app (esta prueba ESCRIBE).');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: esta prueba ESCRIBE — corré contra una COPIA, nunca registro.db.');
  process.exit(2);
}
const ro = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return ro.prepare(sql).all(...p)[0] ?? {}; } catch { return {}; } };
const todos = (sql, ...p) => { try { return ro.prepare(sql).all(...p); } catch { return []; } };
const hoy = String(uno("SELECT date('now','localtime') d").d ?? '');
console.log(`· copia: ${dbPath}\n· hoy ${hoy} · turnos abiertos: ${todos('SELECT close_date FROM daily_closings WHERE is_closed=0').map(a => a.close_date).join(', ') || 'NINGUNO'}`);

// ── 0) EL ESTADO DE PARTIDA, medido contra la copia (libro vs origen), NO supuesto ──────────────
// OJO: la lista de TIPOS tiene que ser la MISMA que la de `conciliacion_del_dia` en db.rs — los cuatro
// movimientos de cobro (`venta`, `abono`, `devolucion` = pago NEGATIVO) **y sus cuatro espejos**
// (`*_anulado`). Olvidar `devolucion_anulado` hacía que este chequeo midiera de menos (la 1ª corrida
// abortó con «Efectivo Bs: libro −1000 vs origen 0» cuando el producto ya estaba bien): una prueba que
// copia la regla que verifica puede quedar desincronizada de ella.
const TIPOS_DE_COBRO = "'venta','venta_anulada','abono','abono_anulado','devolucion','devolucion_anulado'";
const cuadreEnLaBase = () => {
  const libro = new Map();
  for (const f of todos(`SELECT COALESCE(method,'') m, COALESCE(currency,'USD') c, COALESCE(SUM(amount*sign),0) n
                          FROM cash_movements
                          WHERE day = ?1 AND type IN (${TIPOS_DE_COBRO})
                          GROUP BY 1,2`, hoy)) libro.set(`${f.m}|${f.c}`, Number(f.n));
  const origen = new Map();
  for (const f of todos(`SELECT COALESCE(payment_method,'') m, COALESCE(currency,'USD') c,
                                COALESCE(SUM(CAST(COALESCE(net_amount,total) AS REAL)),0) n
                         FROM sales WHERE date(date)=?1 AND voided_at IS NULL GROUP BY 1,2
                         UNION ALL
                         SELECT COALESCE(payment_method,'') m, COALESCE(currency,'USD') c,
                                COALESCE(SUM(CAST(COALESCE(net_amount,amount) AS REAL)),0) n
                         FROM service_payments WHERE date(payment_date)=?1 GROUP BY 1,2`, hoy)) {
    const k = `${f.m}|${f.c}`;
    origen.set(k, (origen.get(k) ?? 0) + Number(f.n));
  }
  const claves = [...new Set([...libro.keys(), ...origen.keys()])].sort();
  return claves.map(k => {
    const [m, c] = k.split('|');
    const l = libro.get(k) ?? 0, o = origen.get(k) ?? 0;
    return { metodo: m || '(sin método)', moneda: c, libro: Math.round(l * 100) / 100, origen: Math.round(o * 100) / 100, diferencia: Math.round((l - o) * 100) / 100 };
  });
};
const partida = cuadreEnLaBase();
const descuadresDePartida = partida.filter(l => Math.abs(l.diferencia) > 0.005);
console.log(`· libro vs origen del ${hoy} antes de la prueba: ${partida.length} línea(s)` +
  (partida.length ? ` → ${partida.map(l => `${l.metodo} ${l.moneda} libro ${l.libro} / origen ${l.origen}`).join(' · ')}` : ' (día vacío)'));
if (descuadresDePartida.length) {
  console.log('ABORTADO: el día YA tiene diferencias en la copia (la prueba no puede distinguir si el detector funciona).');
  console.log(`   ${descuadresDePartida.map(l => `${l.metodo} ${l.moneda}: libro ${l.libro} vs origen ${l.origen} (−${l.diferencia})`).join(' · ')}`);
  process.exit(2);
}
const abiertos = todos('SELECT close_date FROM daily_closings WHERE is_closed=0');
if (!abiertos.some(a => String(a.close_date) === hoy)) {
  console.log(`ABORTADO: el ${hoy} no tiene turno abierto (abiertos: ${abiertos.map(a => a.close_date).join(', ') || 'ninguno'}).`);
  console.log('   Corré primero `node tools/verify_turno_viejo.mjs` (cierra la caja vieja y abre la de hoy) y volvé a correr esta prueba.');
  process.exit(2);
}

// ── 1) entrar (la sesión del dueño, por la vía del frontend) ─────────────────────────────────────
const entrar = async () => {
  await evalx(`location.reload(); 'ok'`).catch(() => {});
  await sleep(3500);
  if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
    await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
    await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(3000);
  }
  await keyNav('Escape', 'Escape', 27).catch(() => {});
  await sleep(600);
};
/** Abre Libro Diario → Movimientos y devuelve lo que dice la tarjeta de conciliación. */
const verConciliacion = async () => {
  await entrar();
  await clickCenter(`[...document.querySelectorAll('aside button, aside a')].find(b => /Libro Diario/i.test(b.innerText))`).catch(() => {});
  await sleep(2200);
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Movimientos')`).catch(() => {});
  await waitFor(`!!document.querySelector('[data-panel="conciliacion"]')`, 12000);
  return await evalx(`(() => {
    const panel = document.querySelector('[data-panel="conciliacion"]');
    if (!panel) return null;
    const estado = panel.querySelector('[data-field="conciliacion-estado"]');
    const lineas = [...panel.querySelectorAll('[data-conc-linea]')].map(tr => ({
      metodo: tr.getAttribute('data-conc-linea'),
      celdas: [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim()),
    }));
    return {
      estado: estado ? estado.innerText.trim() : null,
      lineas,
      avisos: [...panel.querySelectorAll('[data-field="conc-aviso"]')].map(p => p.innerText.replace(/\\s+/g,' ').trim()),
      presunciones: panel.querySelector('[data-field="conc-presunciones"]')?.innerText?.replace(/\\s+/g,' ').trim() ?? null,
      vacio: !!panel.querySelector('[data-field="conc-vacio"]'),
      error: panel.querySelector('[data-field="conc-error"]')?.innerText ?? null,
    };
  })()`);
};
/** Una línea de la tarjeta, por método. `celdas` = [método+moneda, libro, origen, diferencia, mov]. */
const linea = (vista, metodo) => vista?.lineas?.find(l => l.metodo === metodo) ?? null;

await entrar();

// ── 2) UN DÍA NORMAL: una venta y un abono REALES por el mismo método ────────────────────────────
const METODO = 'Divisas (USD Cash)';
const montoVenta = 12, montoAbono = 5;
const orden = uno(`SELECT id, order_num, client, amount, COALESCE(paid_amount,0) paid FROM services
                   WHERE status NOT IN ('Entregado','Devuelto','Cancelado','Cancelado / Devuelto')
                     AND (amount - COALESCE(paid_amount,0)) > ${montoAbono + 1}
                   ORDER BY id DESC LIMIT 1`);
const sid = Number(orden.id ?? 0);
if (!sid) { console.log('ABORTADO: la copia no tiene ninguna orden activa con saldo para colgarle un abono.'); process.exit(2); }
console.log(`· orden de prueba: #${sid} ${orden.order_num} (${orden.client}) — se le abonan $${montoAbono}`);

const errVenta = await inv('add_sale', {
  productId: null, productName: 'Prueba F40', quantity: 1, unitPrice: montoVenta, total: montoVenta,
  paymentMethod: METODO, clientName: 'Prueba F40', clientId: null, notes: 'prueba F40 conciliacion',
  bankFeePercent: 0, zelleReference: '', currency: 'USD', discountAmount: 0,
}).then(() => null, e => String(e));
const ventaId = Number(uno("SELECT id FROM sales WHERE notes='prueba F40 conciliacion' ORDER BY id DESC LIMIT 1").id ?? 0);
const pagoId = await inv('add_service_payment', {
  serviceId: sid, amount: montoAbono, paymentMethod: METODO, bankFeePercent: 0, zelleReference: '',
  currency: 'USD', notes: 'prueba F40 conciliacion', paymentDate: hoy,
}).then(r => Number(r ?? 0), e => { console.log(`   (el abono falló: ${e})`); return 0; });
console.log(`· movimientos de la prueba: venta #${ventaId} $${montoVenta}${errVenta ? ` (ERROR: ${errVenta})` : ''} · abono #${pagoId} $${montoAbono} en la orden #${sid}`);

const A = await verConciliacion();
const lineaA = linea(A, METODO);
const libroA = num(lineaA?.celdas?.[1]), origenA = num(lineaA?.celdas?.[2]);
console.log(`\n── A) el día con la venta y el abono de la prueba ──\n   estado=«${A?.estado}» · error=${A?.error ?? 'ninguno'}${A?.vacio ? ' · (la tarjeta dice: día sin cobros)' : ''}`);
for (const l of A?.lineas ?? []) console.log(`   ${l.metodo.padEnd(22)} libro ${String(l.celdas[1]).padStart(12)} · ventas/abonos ${String(l.celdas[2]).padStart(12)} · dif ${String(l.celdas[3]).padStart(10)} · mov ${l.celdas[4]}`);
check('A1: la tarjeta «Conciliación del día» está en Movimientos y el día cuadra (es el estado real, medido antes)',
  !!A && !A.error && A.estado === 'Cuadra',
  `estado=«${A?.estado}» · partida: ${partida.length} línea(s) sin diferencia · error=${A?.error ?? 'ninguno'}`);
check('A2: la línea del método compara las DOS fuentes y no tiene diferencia',
  !!lineaA && lineaA.celdas.length >= 5 && lineaA.celdas[3] === '—' && libroA === origenA,
  `libro=${lineaA?.celdas?.[1]} · origen=${lineaA?.celdas?.[2]} · dif=${lineaA?.celdas?.[3]}`);
check('A3: la venta y el abono de la prueba están contados en su método (subió $17 y las dos partes coinciden)',
  !!lineaA && libroA >= montoVenta + montoAbono && Math.abs(origenA - libroA) < 0.005 && num(lineaA.celdas[4]) >= 2,
  `libro=${libroA} · origen=${origenA} · cobros=${lineaA?.celdas?.[4]}`);

// ── 3) EL DETECTOR: plata cobrada SIN asiento en el libro ───────────────────────────────────────
{
  const w = new DatabaseSync(dbPath);
  w.prepare(`INSERT INTO sales (product_name, quantity, unit_price, total, payment_method, currency, date, notes)
             VALUES ('Prueba F40 fantasma', 1, 10, 10, 'Transferencia Bs', 'VES', ?1, 'prueba F40 fantasma')`).run(`${hoy} 12:00:00`);
  w.close();
}
const B = await verConciliacion();
const lineaB = linea(B, 'Transferencia Bs');
console.log(`\n── B) una venta de Bs. 10 SIN asiento en el libro (el detector) ──\n   estado=«${B?.estado}»`);
if (lineaB) console.log(`   línea: libro ${lineaB.celdas[1]} · ventas/abonos ${lineaB.celdas[2]} · dif ${lineaB.celdas[3]}`);
for (const a of B?.avisos ?? []) console.log(`   aviso: «${a}»`);
check('B1: el estado pasa a «Con diferencias» y la línea muestra la diferencia (el detector funciona)',
  B?.estado === 'Con diferencias' && !!lineaB && num(lineaB.celdas[2]) - num(lineaB.celdas[1]) >= 9.99,
  `estado=«${B?.estado}» · origen=${lineaB?.celdas?.[2]} · libro=${lineaB?.celdas?.[1]} · dif=${lineaB?.celdas?.[3]}`);
check('B2: el aviso NOMBRA el método y dice las dos cifras (sirve para arreglarlo, no sólo avisa)',
  (B?.avisos ?? []).some(a => /Transferencia Bs/.test(a) && /libro dice/i.test(a) && /origen dice/i.test(a)),
  String(B?.avisos?.[0] ?? '(ninguno)').slice(0, 160));

// ── 4) LIMPIEZA (y de paso: el día tiene que VOLVER a cuadrar) ──────────────────────────────────
// La fantasma se borra por SQL: `void_sale` escribiría su contra-asiento y dejaría el libro en −10
// (la venta nunca tuvo asiento): la fila es un artefacto de la prueba, no una venta del local.
{
  const w = new DatabaseSync(dbPath);
  w.prepare("DELETE FROM sales WHERE notes='prueba F40 fantasma'").run();
  w.close();
}
if (ventaId) await inv('void_sale', { id: ventaId, reason: 'prueba F40' }).catch(e => console.log(`   (no se pudo anular la venta #${ventaId}: ${e})`));
if (pagoId) await inv('delete_service_payment', { id: pagoId }).catch(e => console.log(`   (no se pudo borrar el abono #${pagoId}: ${e})`));
await sleep(1200);
const C = await verConciliacion();
const restos = Number(uno(`SELECT COUNT(*) n FROM sales WHERE (notes LIKE 'prueba F40%' OR product_name LIKE 'Prueba F40%') AND voided_at IS NULL`).n ?? -1);
const restosPago = Number(uno(`SELECT COUNT(*) n FROM service_payments WHERE notes='prueba F40 conciliacion'`).n ?? -1);
const finalBase = cuadreEnLaBase();
console.log(`\n── C) limpieza ──\n   ventas de prueba sin anular: ${restos} · abonos de prueba: ${restosPago} · estado de la tarjeta=«${C?.estado}»`);
console.log(`   libro vs origen del ${hoy} al final: ${finalBase.length ? finalBase.map(l => `${l.metodo} ${l.moneda} ${l.libro}/${l.origen}`).join(' · ') : '(día vacío)'}`);
check('C: la prueba no deja residuos y el día vuelve a cuadrar (mismo estado que al empezar)',
  restos === 0 && restosPago === 0 && C?.estado === 'Cuadra' && !finalBase.some(l => Math.abs(l.diferencia) > 0.005),
  `restos=${restos} · abonos=${restosPago} · estado=«${C?.estado}» · diferencias finales=${finalBase.filter(l => Math.abs(l.diferencia) > 0.005).length}`);

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (y limpia lo que crea). Corré sobre una COPIA.');
process.exit(failed.length ? 1 : 0);
