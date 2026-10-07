#!/usr/bin/env node
// ============================================================================
// F94 — EL ABONO DE DÍAS ANTERIORES SE PUEDE COLOCAR (verificación EN VIVO, 2026-10-06).
//
// PEDIDO DEL DUEÑO: «cuando vas a colocar un pago, un abono que se hizo unos días anteriores, déjalo
// colocar». MEDIDO en su base: los únicos turnos eran el del 21/09 (abierto hacía 15 días) y el del
// 17/09, así que CUALQUIER otro día caía en «No hay ninguna caja (turno) con la fecha X» y el
// mostrador no podía anotar la plata del día en que de verdad entró.
//
// QUÉ COMPRUEBA (por el camino REAL de la UI, no por el backend):
//   AC-1 el diálogo, con un día pasado sin caja, AVISA en ámbar que se le va a crear la caja (antes era
//        un rojo «Elegí un día con caja»: el muro que el dueño veía);
//   AC-2 «Guardar Pago» está HABILITADO (antes el guardado chocaba con el rechazo del backend);
//   AC-3 el cobro se guarda y queda fechado en ESE día;
//   AC-4 el día recibe su caja: CERRADA, arqueo 0 (nadie contó ese cajón) y con su tasa heredada;
//   AC-5 el cierre dice la verdad: esperado = lo cobrado, diferencia = «faltan» ese monto;
//   AC-6 el asiento del libro queda en el día del pago;
//   AC-7 y en Libro Diario → Cierres ese día se ve con la marca «sin contar» (el remedio, a la vista);
//   AC-8 la prueba no deja residuos (borra su pago y la caja que la propia regla creó; la orden de
//        prueba es una orden REAL de la copia y queda como estaba).
//
// PARTE B — EL ABONO DE **HOY** SIN CAJA ABIERTA (F94-b), el caso del taller cuando la caja quedó
// vieja: B1 el diálogo de hoy no se bloquea y avisa que se le crea la caja · B2 el cobro entra y la caja
// de hoy nace cerrada/sin abrir/sin contar · B3 el cierre dice la verdad · B4 **facturar sigue gateado**
// (F82 intacto) · B5 la pantalla sigue ofreciendo «Abrir Día» (una caja del sistema no es un cierre del
// operario) · B6 «Abrir Día» ABRE esa caja y el cobro sigue en su día · B7 sin residuos.
//
// PARTE C — EL COBRO AL ENTREGAR sin caja abierta: C1 el asistente avisa a qué caja va · C2 el bloqueo
// viejo («abrí el día para cobrar») ya no existe · C3 si el botón está apagado es por otro motivo del
// asistente (pantalla/saldo), no por la caja · C4 la prueba NO entrega (no toca stock ni estados).
// Deja el escenario que espera `verify_turno_viejo.mjs`: corré este script ANTES de aquél.
//
// SEGURIDAD DE DATOS: ESCRIBE. `REGISTRO_DB` es OBLIGATORIO y tiene que ser una COPIA (aborta si
// falta). La caja que crea la regla bajo prueba se borra al final (es un artefacto del test).
//
// Uso:  $env:REGISTRO_DB="...\backup\f94_verif.db"
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 (+ REGISTRO_CDP_PORT)
//       node tools/verify_f94_abono_retroactivo.mjs
// ============================================================================
import { evalx, clickCenter, keyNav, typeText, escribirEn, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evalx(expr).catch(() => false)) return true; await sleep(300); }
  return false;
};
const inv = (cmd, args = {}) => evalx(`(async () => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia que usa la app (esta prueba ESCRIBE).');
  process.exit(2);
}
if (/registro\.db$/i.test(dbPath)) {
  console.error('ABORTADO: esta prueba ESCRIBE — apuntá REGISTRO_DB a una COPIA, nunca a la base del local.');
  process.exit(2);
}
const ro = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return ro.prepare(sql).all(...p)[0] ?? {}; } catch { return {}; } };

const hoy = uno("SELECT date('now','localtime') d").d;
/** El día del caso: uno PASADO sin ninguna fila en `daily_closings` (el estado real de su base). */
let diaSinCaja = null;
for (let n = 1; n <= 20 && !diaSinCaja; n++) {
  const d = uno(`SELECT date('now','localtime','-${n} day') d`).d;
  if (!uno('SELECT 1 x FROM daily_closings WHERE close_date = ?1', d).x) diaSinCaja = d;
}
console.log(`· copia: ${dbPath}\n· hoy ${hoy} · día pasado SIN caja para la prueba: ${diaSinCaja ?? 'NINGUNO'}`);
if (!diaSinCaja) { console.log('ABORTADO: la copia tiene caja en todos los días de los últimos 20.'); process.exit(2); }
const abiertos = ro.prepare('SELECT close_date FROM daily_closings WHERE is_closed = 0').all();
console.log(`· turnos abiertos: ${abiertos.map(a => a.close_date).join(', ') || 'NINGUNO'}`);

// ── 0) entrar a la app ───────────────────────────────────────────────────────────────────────
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3000);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(3000);
}
await keyNav('Escape', 'Escape', 27).catch(() => {});
await sleep(600);

// ── 1) una ORDEN ACTIVA de la copia (no se crea ninguna: con la caja vieja abierta, F82 no deja
//      crear órdenes nuevas — y el caso del dueño es justamente ése: la caja quedó vieja) ────────
const orden = uno(`SELECT id, order_num, client, amount, COALESCE(paid_amount,0) paid
                   FROM services
                   WHERE status NOT IN ('Entregado','Devuelto','Cancelado','Cancelado / Devuelto')
                     AND (amount - COALESCE(paid_amount,0)) > 1
                   ORDER BY id DESC LIMIT 1`);
const sid = Number(orden.id ?? 0);
const marca = String(orden.order_num ?? '');
if (!sid || !marca) {
  console.log('ABORTADO: la copia no tiene ninguna orden activa con saldo para cobrarle un abono.');
  process.exit(2);
}
console.log(`· orden de prueba: #${sid} ${marca} · ${orden.client} · $${Number(orden.amount).toFixed(2)} (abonado $${Number(orden.paid).toFixed(2)})`);
const montoPrueba = 3.33;
const notaPrueba = 'prueba F94 retroactivo';

// ── 2) EL DIÁLOGO con la fecha de un día pasado sin caja ─────────────────────────────────────
const abrirPago = async () => {
  await clickCenter(`[...document.querySelectorAll('aside button, aside a')].find(b => /Servicio/i.test(b.innerText))`).catch(() => {});
  await sleep(1500);
  await evalx(`(() => { const i = [...document.querySelectorAll('input')].find(x => /Buscar/i.test(x.placeholder ?? '')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(marca)}); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
  await sleep(2500);
  const ok = await evalx(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Pago \\/ Abono/i.test(x.innerText ?? ''));
    if (!b) return false;
    b.click(); return true;
  })()`);
  return ok && await waitFor(`!!document.querySelector('[data-field="pay-fecha"]')`, 12000);
};
if (!(await abrirPago())) {
  console.log('ABORTADO: no pude abrir el diálogo de pago de la orden de prueba.');
  process.exit(2);
}
// El diálogo tiene que ser el de ESTA orden (la búsqueda puede traer más de una tarjeta).
const titulo = await evalx(`document.querySelector('[role="dialog"]')?.innerText?.split('\\n')[0] ?? ''`);
if (!String(titulo).includes(marca)) {
  console.log(`ABORTADO: el diálogo abierto no es el de ${marca} («${titulo}»).`);
  process.exit(2);
}
/**
 * Elige el método DIVISAS (USD) en el diálogo. Hace falta porque los montos que se comprueban abajo son
 * en DÓLARES (`total_usd`, `usd_cash_total`) y el diálogo arranca con el método de la ORDEN (en esta
 * copia es «Pago Móvil», en bolívares): sin esto el abono entra en el bolsillo de Bs y las cuentas en
 * dólares dan 0 — la prueba estaría midiendo el método del formulario, no la regla de F94.
 */
const elegirDivisasUsd = async () => {
  const ok = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /EFECTIVO \\$/i.test((x.innerText ?? '').trim()));
    if (!b) return false;
    b.click(); return true;
  })()`);
  await sleep(700);
  return ok;
};

// El turno llega async: esperar a que el estado del día esté resuelto ANTES de tocar la fecha.
await waitFor(`['cerrado','abierto','sin-caja'].includes(document.querySelector('[data-field="pay-fecha"]')?.getAttribute('data-estado-dia') ?? '')`, 12000);
await elegirDivisasUsd();
const puesto = await evalx(`(() => {
  const i = document.querySelector('[data-field="pay-fecha"]');
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(diaSinCaja)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(2500);
const quedo = await evalx(`document.querySelector('[data-field="pay-fecha"]')?.value ?? null`);
const vista = await evalx(`(() => {
  const aviso = document.querySelector('[data-field="aviso-dia-sin-caja"]');
  const avisoHoy = document.querySelector('[data-field="aviso-dia-sin-caja-hoy"]');
  const boton = [...document.querySelectorAll('[role="dialog"] button')].find(b => /Guardar Pago/i.test(b.innerText ?? ''));
  return {
    estado: document.querySelector('[data-field="pay-fecha"]')?.getAttribute('data-estado-dia') ?? null,
    aviso: aviso ? aviso.innerText.replace(/\\s+/g, ' ').slice(0, 240) : null,
    avisoEsRojo: aviso ? /border-destructive|text-destructive/.test(aviso.className + ' ' + (aviso.closest('[class*="border"]')?.className ?? '')) : null,
    avisoHoy: avisoHoy ? avisoHoy.innerText.replace(/\\s+/g, ' ').slice(0, 120) : null,
    guardarApagado: boton ? boton.disabled : null,
    error: document.querySelector('[role="dialog"] .text-danger')?.innerText ?? null,
  };
})()`);
console.log(`\n── el día ${diaSinCaja} (pasado, sin caja) elegido en el diálogo ──`);
console.log(`   campo=${quedo} · estado=${vista?.estado} · Guardar apagado=${vista?.guardarApagado}`);
console.log(`   aviso: «${vista?.aviso ?? '(ninguno)'}»`);
check('AC-1: el diálogo AVISA en ámbar que a ese día se le crea su caja (ya no es el muro rojo «Elegí un día con caja»)',
  puesto && quedo === diaSinCaja && vista?.estado === 'sin-caja' && !!vista?.aviso
  && /se le crea su caja|crea su caja/i.test(String(vista.aviso))
  && !/Elegí un día con caja/i.test(String(vista.aviso)) && vista.avisoEsRojo === false
  && !vista?.avisoHoy,
  `campo=${quedo} · estado=${vista?.estado} · rojo=${vista?.avisoEsRojo} · aviso=${String(vista?.aviso).slice(0, 90)}`);
check('AC-2: «Guardar Pago» está HABILITADO con esa fecha (antes el guardado chocaba con el rechazo del backend)',
  vista?.guardarApagado === false && !vista?.error, `apagado=${vista?.guardarApagado} · error=${vista?.error}`);

// ── 3) GUARDAR el abono de ese día ───────────────────────────────────────────────────────────
await evalx(`(() => { const i = document.querySelector('[role="dialog"] [data-field="pay-monto"]'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, '${montoPrueba}'); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
await sleep(600);
await evalx(`(() => { const i = [...document.querySelectorAll('[role="dialog"] input')].find(x => /Detalle del gasto|Abono inicial/i.test(x.placeholder ?? '')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, '${notaPrueba}'); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
await sleep(400);
const guardo = await evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Guardar Pago/i.test(x.innerText ?? ''));
  if (!b || b.disabled) return false;
  b.click(); return true;
})()`);
await waitFor(`!document.querySelector('[data-field="pay-fecha"]')`, 15000);
await sleep(2500);

const caja = uno(`SELECT is_closed, COALESCE(actual_cash_usd,0) actual, COALESCE(tasa_bcv,0) tasa, COALESCE(notes,'') notas,
                         COALESCE(total_usd,0) total_usd, COALESCE(difference,0) difference
                  FROM daily_closings WHERE close_date = ?1`, diaSinCaja);
const pagos = await inv('get_service_payments', { serviceId: sid }).catch(() => []);
const pago = (pagos ?? []).find(p => Math.abs(Number(p.amount) - montoPrueba) < 0.001 && String(p.payment_date ?? '').startsWith(diaSinCaja));
const svc = await inv('get_service', { id: sid }).catch(() => null);
const mov = pago ? uno("SELECT day FROM cash_movements WHERE payment_id = ?1 ORDER BY id DESC LIMIT 1", pago.id) : {};
console.log(`\n── el abono de $${montoPrueba} fechado el ${diaSinCaja} (guardado=${guardo}) ──`);
console.log(`   el pago quedó: ${pago ? `#${pago.id} $${pago.amount} del ${pago.payment_date}` : 'NO'} · abonado de la orden $${Number(svc?.paid_amount ?? 0).toFixed(2)}`);
console.log(`   caja creada: cerrada=${caja.is_closed} contado=$${Number(caja.actual ?? 0).toFixed(2)} tasa=${caja.tasa} esperado=$${Number(caja.total_usd ?? 0).toFixed(2)} diferencia=$${Number(caja.difference ?? 0).toFixed(2)}`);
check('AC-3: el cobro de un día pasado SIN caja se guarda, fechado en ESE día',
  guardo === true && !!pago, pago ? `pago #${pago.id} del ${pago.payment_date}` : 'no quedó');
check('AC-4: el día recibe su caja: CERRADA, arqueo 0 (nadie contó ese cajón) y con su tasa heredada',
  caja && Number(caja.is_closed) === 1 && Math.abs(Number(caja.actual ?? -1)) < 1e-9 && Number(caja.tasa ?? 0) > 0
  && /Caja creada automáticamente/i.test(String(caja.notas ?? '')),
  `cerrada=${caja?.is_closed} contado=${caja?.actual} tasa=${caja?.tasa} notas=«${String(caja?.notas ?? '').slice(0, 40)}…»`);
check('AC-5: el cierre de ese día dice la verdad (esperado = lo cobrado, diferencia = «faltan» ese monto)',
  Math.abs(Number(caja.total_usd ?? 0) - montoPrueba) < 0.011 && Math.abs(Number(caja.difference ?? 0) + montoPrueba) < 0.011,
  `esperado=$${Number(caja?.total_usd ?? 0).toFixed(2)} · diferencia=$${Number(caja?.difference ?? 0).toFixed(2)}`);
check('AC-6: el asiento del libro queda en el día del pago (una sola fuente para el arqueo)',
  String(mov.day ?? '') === diaSinCaja, `día del libro=${mov.day ?? 'NO'}`);

// ── 4) EL REMEDIO A LA VISTA: el día aparece en Cierres con «sin contar» ─────────────────────
await clickCenter(`[...document.querySelectorAll('aside button, aside a')].find(b => /Libro Diario/i.test(b.innerText))`).catch(() => {});
await sleep(1800);
await clickCenter(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Cierres')`).catch(() => {});
await sleep(2000);
const fila = await evalx(`(() => {
  const fecha = ${JSON.stringify(diaSinCaja)};
  const [y, m, d] = fecha.split('-');
  const filas = [...document.querySelectorAll('tbody tr')];
  const f = filas.find(t => t.innerText.includes(fecha) || t.innerText.includes(d + '/' + m + '/' + y));
  if (!f) return null;
  const dif = f.querySelector('[data-diff="usd"]');
  return {
    texto: f.innerText.replace(/\\s+/g, ' ').slice(0, 200),
    sinContar: dif?.getAttribute('data-sin-contar') ?? null,
    dif: dif?.innerText ?? null,
    // La tabla muestra el NÚMERO con signo; la palabra («faltan $3.33») va en el title de la celda.
    titulo: dif?.closest('td')?.getAttribute('title') ?? dif?.getAttribute('title') ?? '',
  };
})()`);
console.log(`\n── Libro Diario → Cierres: la fila del ${diaSinCaja} ──\n   ${fila ? fila.texto : 'NO APARECE'}\n   diferencia=«${fila?.dif ?? '—'}» · title=«${String(fila?.titulo ?? '').slice(0, 80)}»`);
const difNum = Number(String(fila?.dif ?? '').replace(/[^0-9.,-]/g, '').replace(',', '.'));
// OJO con el `title`: cuando el arqueo está en 0 con un esperado que no lo está, la tabla NO dice
// «faltan $X» sino el motivo real («Nadie contó el cajón (arqueo en 0)…» + el remedio). Las dos cosas
// son la misma verdad; la comprobación acepta las dos y exige el número con su signo.
check('AC-7: el día se ve en Cierres con la marca «sin contar» y su diferencia (el remedio, a la vista)',
  !!fila && fila.sinContar !== null && /sin contar/i.test(fila.texto)
  && Math.abs(difNum + montoPrueba) < 0.011
  && /(faltan|Nadie contó el cajón)/i.test(String(fila.titulo)),
  fila ? `sin-contar=${fila.sinContar} · dif=${fila.dif} · title=«${String(fila.titulo).slice(0, 60)}»` : 'no encontré la fila');

// ── 5) limpieza: SOLO el pago que creó esta prueba y la caja que creó la regla bajo prueba ───
const limpiados = [];
for (const p of pagos ?? []) {
  if (String(p.notes ?? '').includes(notaPrueba) || (Math.abs(Number(p.amount) - montoPrueba) < 0.001 && String(p.payment_date ?? '').startsWith(diaSinCaja))) {
    await inv('delete_service_payment', { id: p.id }).catch(() => {});
    limpiados.push(p.id);
  }
}
await sleep(1200);
let cajaBorrada = 'no';
try {
  const rw = new DatabaseSync(dbPath);
  rw.prepare('DELETE FROM daily_closings WHERE close_date = ?1').run(diaSinCaja);
  rw.close();
  cajaBorrada = 'sí';
} catch (e) { cajaBorrada = `no (${String(e).slice(0, 40)})`; }
const siguen = (await inv('get_service_payments', { serviceId: sid }).catch(() => [])) ?? [];
const quedanMios = siguen.filter(p => Math.abs(Number(p.amount) - montoPrueba) < 0.001).length;
const cajaFinal = uno('SELECT 1 x FROM daily_closings WHERE close_date = ?1', diaSinCaja).x;
const ordenFinal = await inv('get_service', { id: sid }).catch(() => null);
console.log(`\n── limpieza ──\n   pagos borrados: ${limpiados.join(', ') || 'ninguno'} · la orden sigue (no es mía): #${sid} ${marca} abonado $${Number(ordenFinal?.paid_amount ?? 0).toFixed(2)} · caja de prueba borrada=${cajaBorrada}`);
check('AC-8: la prueba no deja residuos (borra su pago y la caja que creó la regla; la orden queda como estaba)',
  quedanMios === 0 && !cajaFinal && Math.abs(Number(ordenFinal?.paid_amount ?? -1) - Number(orden.paid)) < 0.011,
  `pagos míos=${quedanMios} · caja=${cajaFinal ? 'SIGUE' : 'borrada'} · abonado ${orden.paid} → ${ordenFinal?.paid_amount}`);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PARTE B — EL ABONO DE **HOY** SIN CAJA ABIERTA (F94-b)
//
// El caso es el del taller: el único turno abierto es de OTRO día, así que HOY no tiene caja. Antes el
// cobro de hoy se rechazaba («No hay ninguna caja (turno) con la fecha X») y la pantalla apagaba el
// botón. Ahora entra en la caja de HOY, que el sistema crea cerrada y sin contar, y **«Abrir Día» la
// completa** (por eso la caja que crea el sistema nace con `opened_at` NULL: el ritual del día no se
// pierde). Este tramo TAMBIÉN comprueba que F82 sigue vivo para facturar.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// El escenario se ARMA acá: un turno VIEJO abierto y HOY sin caja (una copia de prueba; la
// manipulación está documentada y es la que hace determinista la comprobación).
const previo = String(uno("SELECT close_date FROM daily_closings WHERE close_date < date('now','localtime') ORDER BY close_date DESC LIMIT 1").close_date ?? '');
if (!previo) { console.log('\nABORTADO (parte B): la copia no tiene ningún día anterior para dejar abierto.'); process.exit(2); }
{
  const w = new DatabaseSync(dbPath);
  w.exec("UPDATE daily_closings SET is_closed=1, closed_at=datetime('now','localtime') WHERE is_closed=0");
  w.prepare("DELETE FROM daily_closings WHERE close_date = date('now','localtime')").run();
  w.prepare("UPDATE daily_closings SET is_closed=0, closed_at=NULL WHERE close_date = ?1").run(previo);
  w.close();
}
console.log(`\n· PARTE B · escenario: turno abierto el ${previo} (viejo) y HOY (${hoy}) sin caja`);
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3500);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(3000);
}
await keyNav('Escape', 'Escape', 27).catch(() => {});
await sleep(600);

const montoHoy = 2.22;
const notaHoy = 'prueba F94 cobro de hoy';
if (!(await abrirPago())) { console.log('ABORTADO (parte B): no pude abrir el diálogo de pago.'); process.exit(2); }
await waitFor(`['cerrado','abierto','sin-caja'].includes(document.querySelector('[data-field="pay-fecha"]')?.getAttribute('data-estado-dia') ?? '')`, 12000);
await elegirDivisasUsd();   // el mismo motivo que en la parte A: las cuentas de abajo son en dólares
const vistaHoy = await evalx(`(() => {
  const i = document.querySelector('[data-field="pay-fecha"]');
  const aviso = document.querySelector('[data-field="aviso-dia-sin-caja"]');
  const boton = [...document.querySelectorAll('[role="dialog"] button')].find(b => /Guardar Pago/i.test(b.innerText ?? ''));
  return { fecha: i?.value ?? null, estado: i?.getAttribute('data-estado-dia') ?? null,
           aviso: aviso ? aviso.innerText.replace(/\\s+/g,' ').slice(0,220) : null,
           guardarApagado: boton ? boton.disabled : null };
})()`);
console.log(`\n── el diálogo con HOY (${hoy}) sin caja ──\n   campo=${vistaHoy?.fecha} · estado=${vistaHoy?.estado} · Guardar apagado=${vistaHoy?.guardarApagado}\n   aviso: «${String(vistaHoy?.aviso).slice(0, 150)}»`);
check('B1: el abono de HOY no se bloquea y el aviso dice que se le crea su caja',
  vistaHoy?.fecha === hoy && vistaHoy?.estado === 'sin-caja' && vistaHoy?.guardarApagado === false
  && /no tiene caja abierta/i.test(String(vistaHoy?.aviso)) && /se le crea su caja/i.test(String(vistaHoy?.aviso)),
  `campo=${vistaHoy?.fecha} · estado=${vistaHoy?.estado} · apagado=${vistaHoy?.guardarApagado}`);

await evalx(`(() => { const i = document.querySelector('[role="dialog"] [data-field="pay-monto"]'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, '${montoHoy}'); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
await sleep(700);
// La NOTA es la que permite que la limpieza borre SU pago y no otro (un pago sin nota de la corrida
// anterior se queda y ensucia la comprobación: montos que se suman, totales que no cuadran).
await evalx(`(() => { const i = [...document.querySelectorAll('[role="dialog"] input')].find(x => /Abono inicial|Saldo al entregar/i.test(x.placeholder ?? '')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, '${notaHoy}'); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
await sleep(500);
const guardoHoy = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Guardar Pago/i.test(x.innerText ?? '')); if (!b || b.disabled) return false; b.click(); return true; })()`);
await waitFor(`!document.querySelector('[data-field="pay-fecha"]')`, 15000);
await sleep(2500);
const cajaHoy = uno(`SELECT is_closed, (opened_at IS NULL) sin_abrir, COALESCE(actual_cash_usd,0) contado, COALESCE(tasa_bcv,0) tasa,
                            COALESCE(notes,'') notas, COALESCE(difference,0) diferencia, COALESCE(total_usd,0) total
                     FROM daily_closings WHERE close_date = ?1`, hoy);
const pagosHoy = await inv('get_service_payments', { serviceId: sid }).catch(() => []);
const pagoHoy = (pagosHoy ?? []).find(p => Math.abs(Number(p.amount) - montoHoy) < 0.001 && String(p.payment_date ?? '').startsWith(hoy));
console.log(`   el cobro quedó: ${pagoHoy ? `#${pagoHoy.id} $${pagoHoy.amount} del ${pagoHoy.payment_date}` : 'NO'} · caja de hoy: cerrada=${cajaHoy.is_closed} sin_abrir=${cajaHoy.sin_abrir} contado=${cajaHoy.contado} dif=${cajaHoy.diferencia}`);
check('B2: el cobro de HOY se guarda y la caja de hoy la crea el sistema (cerrada, sin abrir, sin contar)',
  guardoHoy === true && !!pagoHoy && Number(cajaHoy.is_closed) === 1 && Number(cajaHoy.sin_abrir) === 1
  && Math.abs(Number(cajaHoy.contado ?? -1)) < 1e-9 && /Caja creada automáticamente/i.test(String(cajaHoy.notas)),
  `pago=${pagoHoy?.id} · caja=${JSON.stringify({ ...cajaHoy, notas: String(cajaHoy.notas).slice(0, 28) })}`);
check('B3: y el cierre de hoy dice la verdad (esperado = lo cobrado, diferencia = «faltan» ese monto)',
  Math.abs(Number(cajaHoy.total ?? 0) - montoHoy) < 0.011 && Math.abs(Number(cajaHoy.diferencia ?? 0) + montoHoy) < 0.011,
  `total=${cajaHoy.total} · diferencia=${cajaHoy.diferencia}`);

// F82 SIGUE VIVO PARA FACTURAR: una venta de hoy con la caja vieja abierta se rechaza.
const errVenta = await evalx(`(() => window.__TAURI_INTERNALS__.invoke('add_sale', { productId: null, productName: 'Prueba F94 venta', quantity: 1, unitPrice: 1, total: 1, paymentMethod: 'Divisas (USD Cash)', clientName: 'Prueba', clientId: null, notes: 'prueba F94', bankFeePercent: 0, zelleReference: '', currency: 'USD', discountAmount: 0 }).then(() => null, (e) => String(e)))()`);
check('B4: facturar sigue gateado (F82 intacto): una venta de hoy con la caja vieja abierta se rechaza',
  /sigue ABIERTA|Debe abrir el día/i.test(String(errVenta)), String(errVenta).slice(0, 110));

// EL REMEDIO: se cierra la caja vieja (el camino que el cartel indica) y «Abrir Día» abre ESA caja.
await inv('close_day', {
  closeDate: previo, notes: 'cierre de prueba F94 (parte B)', initialCashUsd: 0, tasaBcv: 900, tasaEur: 950,
  actualCashUsd: 0, actualCashBs: 0, actualPuntoUsd: 0, actualPuntoBs: 0, actualZelle: 0,
  actualPagoMovil: 0, actualTransferBs: 0, posSettled: 0, posSettledBs: 0,
}).catch(e => console.log(`   (aviso: close_day devolvió ${String(e).slice(0, 60)})`));
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3500);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(3000);
}
await clickCenter(`[...document.querySelectorAll('aside button, aside a')].find(b => /Libro Diario/i.test(b.innerText))`).catch(() => {});
await sleep(2000);
const hayAbrir = await (async () => {
  for (let i = 0; i < 3; i++) {
    if (await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Abrir Día')`)) return true;
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Diario'); if (b) b.click(); return !!b; })()`).catch(() => {});
    await sleep(1500);
  }
  return false;
})();
const avisoSistema = await evalx(`document.querySelector('[data-field="caja-del-sistema-hoy"]')?.innerText ?? null`);
check('B5: la pantalla OFRECE «Abrir Día» (una caja del sistema no cuenta como el cierre del operario)',
  hayAbrir, `botón=${hayAbrir} · aviso=«${String(avisoSistema).slice(0, 70)}»`);
if (hayAbrir) {
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Abrir Día')`);
  await waitFor(`/Abrir Día/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 8000);
  const tasaAbierta = await evalx(`(() => { const ins = [...document.querySelectorAll('[role="dialog"] input[type="number"]')]; return ins[0] ? Number(ins[0].value) : null; })()`);
  if (!tasaAbierta) await escribirEn(`[...document.querySelectorAll('[role="dialog"] input[type="number"]')][0]`, '900').catch(() => {});
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /Abrir Día/.test(b.innerText || ''))`);
  await waitFor(`!document.querySelector('[role="dialog"]')`, 12000);
  await sleep(2500);
}
const cajaHoy2 = uno("SELECT is_closed, (opened_at IS NULL) sin_abrir, COALESCE(initial_cash_usd,0) fondo FROM daily_closings WHERE close_date = ?1", hoy);
const totalHoy2 = await inv('get_daily_totals', { startDate: hoy, endDate: hoy }).catch(() => []);
check('B6: «Abrir Día» ABRE esa caja y el cobro ya anotado sigue en su día',
  Number(cajaHoy2.is_closed) === 0 && Number(cajaHoy2.sin_abrir) === 0
  && Math.abs(Number(totalHoy2?.[0]?.usd_cash_total ?? 0) - montoHoy) < 0.011,
  `caja=${JSON.stringify(cajaHoy2)} · cobrado hoy=${totalHoy2?.[0]?.usd_cash_total}`);

// Limpieza de la parte B: se borra su cobro (la caja de hoy queda ABIERTA, que es un estado sano; los
// demás scripts de verificación rearman su escenario solos).
const pagosFin = (await inv('get_service_payments', { serviceId: sid }).catch(() => [])) ?? [];
for (const p of pagosFin) if (String(p.notes ?? '').includes(notaHoy)) await inv('delete_service_payment', { id: p.id }).catch(() => {});
await sleep(1200);
const quedanB = ((await inv('get_service_payments', { serviceId: sid }).catch(() => [])) ?? []).filter(p => String(p.notes ?? '').includes(notaHoy)).length;
check('B7: la parte B no deja residuos (su cobro se borra)', quedanB === 0, `pagos de la prueba=${quedanB}`);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PARTE C — EL COBRO AL ENTREGAR SIN CAJA ABIERTA (asistente de cierre)
//
// F82 bloqueaba el cobro del asistente cuando el día estaba cerrado o la caja vieja abierta («El día
// está cerrado: para cobrar abrí el día en Libro Diario»), y el operario quedaba sin poder cobrar ni
// entregar. Con F94 el cobro del asistente es de HOY y entra en la caja de hoy (se le crea si no la
// tiene): lo que se comprueba acá es que la PANTALLA ya no frena y que lo dice.
// La entrega NO se ejecuta (no se toca el stock ni el estado de una orden real): se cierra el diálogo.
// El estado que deja esta parte es el que espera `verify_turno_viejo.mjs` (caja vieja abierta, hoy sin
// caja), así que conviene correr este script ANTES de aquél.
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  const w = new DatabaseSync(dbPath);
  w.exec("UPDATE daily_closings SET is_closed=1, closed_at=datetime('now','localtime') WHERE is_closed=0");
  w.prepare("DELETE FROM daily_closings WHERE close_date = date('now','localtime')").run();
  w.prepare("UPDATE daily_closings SET is_closed=0, closed_at=NULL WHERE close_date = ?1").run(previo);
  w.close();
}
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3500);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(3000);
}
await clickCenter(`[...document.querySelectorAll('aside button, aside a')].find(b => /Servicio/i.test(b.innerText))`).catch(() => {});
await sleep(1800);
const abrioCola = await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Cerrar entrega|Cerrar una entrega/i.test(x.innerText ?? '')); if (!b) return false; b.click(); return true; })()`);
await waitFor(`!!document.querySelector('input[placeholder*="DEV-0001"]')`, 10000);
await evalx(`(() => { const i = [...document.querySelectorAll('input')].find(x => /DEV-0001/.test(x.placeholder ?? '')); if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(marca)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(1500);
const eligio = await evalx(`(() => { const it = document.querySelector('[role="option"], [cmdk-item]'); if (!it) return false; it.click(); return true; })()`);
await waitFor(`/Cobrar y entregar|Entregar con saldo|Reintentar cierre/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
const asistente = await evalx(`(() => {
  const d = document.querySelector('[role="dialog"]');
  const nota = d?.querySelector('[data-field="aviso-cobro-sin-caja"]');
  return { abierto: /Cobrar y entregar|Entregar con saldo/.test(d?.innerText ?? ''),
           nota: nota ? nota.innerText.replace(/\\s+/g,' ').slice(0, 220) : null };
})()`);
console.log(`\n── el asistente de cierre (cola abierta=${abrioCola} · orden elegida=${eligio}) ──\n   nota: «${String(asistente?.nota).slice(0, 150)}»`);
check('C1: el asistente dice a qué caja va el cobro (ya no manda a abrir el día)',
  !!asistente?.nota && (/se le crea su caja|entra en la caja de hoy|entra en la caja de HOY/i.test(String(asistente.nota))),
  `nota=«${String(asistente?.nota).slice(0, 110)}»`);
// Con un monto escrito, el asistente NO puede frenarse por la CAJA. Ojo: el botón «Cobrar y entregar»
// tiene OTROS gates legítimos (elegir/confirmar la pantalla instalada cuando el trabajo es «Cambio
// pantalla», el motivo si queda saldo, el monto final en 0) y en esta copia la orden de prueba es
// justamente un cambio de pantalla sin elegir → el botón puede estar apagado POR ESO, no por la caja.
// Lo que se comprueba es lo que cambió F94: que el mensaje viejo («abrí el día en Libro Diario para
// cobrar») YA NO EXISTA y que el aviso diga a qué caja va el cobro.
await evalx(`(() => { const i = document.querySelector('[role="dialog"] input[aria-label="Monto a cobrar"]'); if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, '1'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(900);
const textoAsistente = await evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`);
const bCobrar = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Cobrar y entregar|Entregar con saldo/i.test(x.innerText ?? '')); return b ? { hay: true, apagado: b.disabled, title: b.title, texto: (b.innerText || '').trim() } : { hay: false }; })()`);
console.log(`   botón: ${JSON.stringify(bCobrar)}`);
check('C2: el asistente YA NO manda a abrir el día para cobrar (el motivo del bloqueo viejo desapareció)',
  !/abrí el día en Libro Diario/i.test(String(textoAsistente))
  && !/El día está cerrado: para cobrar/i.test(String(textoAsistente)),
  `texto del asistente menciona «abrí el día»: ${/abrí el día/i.test(String(textoAsistente))}`);
check('C3: …y si el botón está apagado es por OTRO motivo del asistente (pantalla/saldo), no por la caja',
  bCobrar?.hay === true && (bCobrar.apagado === false || !/caja/i.test(String(bCobrar.title))),
  `apagado=${bCobrar?.apagado} · title=«${String(bCobrar?.title).slice(0, 70)}»`);
await keyNav('Escape', 'Escape', 27);
await sleep(800);
check('C4: la entrega NO se ejecutó (la prueba no toca el stock ni el estado de la orden)',
  (await inv('get_service', { id: sid }).catch(() => null))?.status !== 'Entregado',
  `status=${(await inv('get_service', { id: sid }).catch(() => null))?.status}`);

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (y limpia lo que crea). Corré sobre una COPIA.');
process.exit(failed.length ? 1 : 0);