// VERIFICACIÓN EN VIVO (CDP) de F92 — LA FECHA DEL PAGO YA NO SE BLOQUEA POR EL CIERRE, Y EL DINERO
// SON 2 DECIMALES.
//
// Pedido del dueño (2026-10-05): «quiero que quites el bloqueo que le tienes a la edición de la fecha
// de cualquier pago cuando mandan un pago cancelado después del cierre. Hay clientes que pagan y envían
// el pago días anteriores y cuando uno quiere editar la fecha no deja editarla porque dice que ya se
// hizo el cierre. HAY QUE ACTUALIZAR EL CIERRE DE ESOS DÍAS. Si agrego el pago hoy siendo otro día no
// refleja la realidad. Y además cuando pagan deja 2 decimales… se acepta solo 2 decimales.»
//
// Qué comprueba (sobre una COPIA; borra lo que crea):
//   1. Con un día YA CERRADO: el diálogo de pago dice «ese día está cerrado: su cierre se actualiza»
//      (antes decía que había que abrirlo en Libro Diario) y NO bloquea el guardado.
//   2. Un cobro fechado en ese día cerrado ENTRA: queda en la caja del día y el cierre de ese día se
//      recalcula — el esperado sube por el monto y la diferencia cambia (el arqueo contado NO).
//   3. Corregir la fecha de un pago DESDE un día cerrado también se permite, y los dos cierres quedan
//      explicando el día.
//   4. El dinero se guarda con 2 decimales: un monto en Bs. con centavos se conserva tal cual y el
//      «abonado» no arrastra centavos fantasma.
//
// Uso:  app abierta con CDP (REGISTRO_CDP_PORT si es una segunda instancia) y REGISTRO_DB=<copia>
//       node tools/verify_f92_fecha_pago_cierre.mjs

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
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
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia que usa la app.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch { return {}; } };
const hoy = uno("SELECT date('now','localtime') d").d;
/** Un día CERRADO de la copia (cualquiera): es el escenario del dueño. */
const diaCerrado = uno("SELECT close_date FROM daily_closings WHERE is_closed=1 AND tasa_bcv>0 ORDER BY close_date DESC LIMIT 1").close_date;
console.log(`· copia: ${dbPath} · hoy ${hoy} · día cerrado de prueba: ${diaCerrado}`);
if (!diaCerrado) { console.log('ABORTADO: la copia no tiene ningún día cerrado con tasa.'); process.exit(2); }

// ── 0) entrar a la app ────────────────────────────────────────────────────────────────────────
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

// ── 1) una orden de prueba con saldo, por el BACKEND (el camino de la UI se mide después) ─────
// `ServiceDeviceInput` usa snake_case (es el contrato del backend); los nombres están copiados de
// `Services.tsx` para no inventar un camino que la UI no use.
const creada = await inv('add_service_order', {
  client: 'Prueba F92 Cierre', phone: '0414-0000000', clientCi: 'V-1', clientAddress: 'x',
  clientId: null, technician: '', technicianId: null,
  devices: [{
    model: 'Hot 30i', color: 'Gris', fault: 'prueba F92',
    service_type: 'Cambio pantalla', service_types: '["Cambio pantalla"]',
    amount: 40, discount_amount: 0, iva_rate: 0, iva_mode: '',
    payment_method: 'Divisas (USD Cash)', observations: '',
    bank_fee_percent: 0, zelle_reference: '', currency: 'USD',
    device_checklist: '{}', screen_product_id: null, status: 'Recibido',
  }],
}).catch(e => ({ error: String(e) }));
let sid = Number(uno("SELECT id FROM services WHERE client = 'Prueba F92 Cierre' ORDER BY id DESC LIMIT 1").id ?? 0);
if (!sid) {
  console.log(`ABORTADO: no pude crear la orden de prueba (${JSON.stringify(creada)}).`);
  process.exit(2);
}
console.log(`· orden de prueba #${sid} ($${40}) creada · informe del backend: ${JSON.stringify(creada).slice(0, 80)}`);

/** Estado del cierre de un día, leído de la base (esperado por moneda + diferencia + arqueo). */
const cierreDe = (fecha) => uno(
  `SELECT COALESCE(cash_usd,0) cash_usd, COALESCE(cash_bs,0) cash_bs, COALESCE(zelle_total,0) zelle_total,
          COALESCE(pago_movil_total,0) pago_movil, COALESCE(transfer_bs_total,0) transfer_bs,
          COALESCE(usd_cash_total,0) usd_cash, COALESCE(drawer_adjust_usd,0) ajuste_usd, COALESCE(drawer_adjust_bs,0) ajuste_bs,
          COALESCE(actual_cash_usd,0) actual_cash_usd, COALESCE(actual_cash_bs,0) actual_cash_bs,
          COALESCE(actual_zelle,0) actual_zelle, COALESCE(actual_pago_movil,0) actual_pago_movil,
          COALESCE(actual_transfer_bs,0) actual_transfer_bs, COALESCE(difference,0) difference, is_closed
   FROM daily_closings WHERE close_date = ?1`, fecha);
const esperadoUsd = (c) => c.cash_usd + c.zelle_total + c.usd_cash + c.ajuste_usd;
const esperadoBs = (c) => c.cash_bs + c.pago_movil + c.transfer_bs + c.ajuste_bs;
const difUsd = (c) => Math.round(((c.actual_cash_usd + c.actual_zelle) - esperadoUsd(c)) * 100) / 100;
const difBs = (c) => Math.round(((c.actual_cash_bs + c.actual_pago_movil + c.actual_transfer_bs) - esperadoBs(c)) * 100) / 100;

const antesCerrado = cierreDe(diaCerrado);
const antesHoy = cierreDe(hoy);
console.log(`· cierre del ${diaCerrado}: esperado $${esperadoUsd(antesCerrado).toFixed(2)} · diferencia $${difUsd(antesCerrado).toFixed(2)} (cerrado=${antesCerrado.is_closed})`);

// ── 2) EL DIÁLOGO: el día cerrado ya no dice «abrilo» y NO bloquea el guardado ───────────────
const abrirPago = async () => {
  await clickCenter(`[...document.querySelectorAll('aside button, aside a')].find(b => /Servicio/i.test(b.innerText))`).catch(() => {});
  await sleep(1500);
  await evalx(`(() => { const i = [...document.querySelectorAll('input')].find(x => /Buscar/i.test(x.placeholder ?? '')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, 'Prueba F92 Cierre'); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
  await sleep(2500);
  // La tarjeta tiene el botón «Pago / Abono» (el mismo «Registrar Pago / Abono» del pie del wizard).
  const ok = await evalx(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Pago \\/ Abono/i.test(x.innerText ?? ''));
    if (!b) return false;
    b.click(); return true;
  })()`);
  return ok && await waitFor(`!!document.querySelector('[data-field="pay-fecha"]')`, 12000);
};
const abrio = await abrirPago();
if (!abrio) {
  console.log('ABORTADO: no pude abrir el diálogo de pago de la orden de prueba.');
  await inv('delete_service', { id: sid }).catch(() => {});
  process.exit(2);
}
// El diálogo carga el turno de forma async: se espera a que el estado del día esté resuelto ANTES de
// tocar la fecha (si no, la respuesta tardía pisaba la fecha elegida — que es justo el bug que F92
// arregla con `dateTouched`; la prueba no puede depender del orden de dos promesas).
await waitFor(`['cerrado','abierto','sin-caja'].includes(document.querySelector('[data-field="pay-fecha"]')?.getAttribute('data-estado-dia') ?? '')`, 12000);
// elegir el día CERRADO en el campo de fecha
const puesto = await evalx(`(() => {
  const i = document.querySelector('[data-field="pay-fecha"]');
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(diaCerrado)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(2500);
// …y que la fecha QUEDE puesta (si el campo se revierte, la prueba tiene que verlo, no medir otra cosa)
const quedo = await evalx(`document.querySelector('[data-field="pay-fecha"]')?.value ?? null`);
const vista = await evalx(`(() => {
  const aviso = document.querySelector('[data-field="aviso-dia-cerrado"]');
  const sinCaja = document.querySelector('[data-field="aviso-dia-sin-caja"]');
  const boton = [...document.querySelectorAll('[role="dialog"] button')].find(b => /Guardar Pago/i.test(b.innerText ?? ''));
  return {
    estado: document.querySelector('[data-field="pay-fecha"]')?.getAttribute('data-estado-dia') ?? null,
    avisoCerrado: aviso ? aviso.innerText.replace(/\\s+/g, ' ').slice(0, 160) : null,
    avisoSinCaja: sinCaja ? sinCaja.innerText.replace(/\\s+/g, ' ').slice(0, 120) : null,
    guardarApagado: boton ? boton.disabled : null,
    error: document.querySelector('[role="dialog"] .text-danger')?.innerText ?? null,
  };
})()`);
console.log(`\n── el día ${diaCerrado} elegido en el diálogo ──`);
console.log(`   el campo quedó en ${quedo} · estado=${vista?.estado} · botón Guardar apagado=${vista?.guardarApagado}`);
console.log(`   aviso: «${vista?.avisoCerrado ?? '(ninguno)'}»`);
check('AC-1: el diálogo dice que ese día está CERRADO y que su cierre se actualiza (ya no manda a abrirlo)',
  puesto && quedo === diaCerrado && vista?.estado === 'cerrado'
  && /cerrado/i.test(String(vista?.avisoCerrado)) && /se actualiza/i.test(String(vista?.avisoCerrado))
  && !/abrilo|Libro Diario → Cierres/i.test(String(vista?.avisoCerrado)),
  `campo=${quedo} · estado=${vista?.estado} · aviso=${String(vista?.avisoCerrado).slice(0, 80)}`);
check('AC-2: con el día cerrado el guardado está HABILITADO (antes se rechazaba)',
  vista?.guardarApagado === false && !vista?.error, `apagado=${vista?.guardarApagado} · error=${vista?.error}`);

// ── 3) GUARDAR el cobro en el día cerrado: entra y el cierre se recalcula ────────────────────
await evalx(`(() => { const i = document.querySelector('[role="dialog"] [data-field="pay-monto"]'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, '15.5'); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
await sleep(600);
const guardo = await evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Guardar Pago/i.test(x.innerText ?? ''));
  if (!b || b.disabled) return false;
  b.click(); return true;
})()`);
await waitFor(`!document.querySelector('[data-field="pay-fecha"]')`, 15000);
await sleep(2500);

const pagos = await inv('get_service_payments', { serviceId: sid }).catch(() => []);
const pagoNuevo = (pagos ?? []).find(p => Math.abs(Number(p.amount) - 15.5) < 0.001 && String(p.payment_date ?? '').startsWith(diaCerrado));
const despuesCerrado = cierreDe(diaCerrado);
const servicio = await inv('get_service', { id: sid }).catch(() => null);
console.log(`\n── el cobro de $15,50 fechado el ${diaCerrado} (guardado=${guardo}) ──`);
console.log(`   el pago quedó: ${pagoNuevo ? `#${pagoNuevo.id} $${pagoNuevo.amount} del ${pagoNuevo.payment_date}` : 'NO'}`);
console.log(`   cierre: esperado $${esperadoUsd(antesCerrado).toFixed(2)} → $${esperadoUsd(despuesCerrado).toFixed(2)} · diferencia $${difUsd(antesCerrado).toFixed(2)} → $${difUsd(despuesCerrado).toFixed(2)} · abonado de la orden $${Number(servicio?.paid_amount ?? 0).toFixed(2)}`);
check('AC-3: el cobro fechado en un día CERRADO entra en la caja de ese día',
  !!pagoNuevo, pagoNuevo ? `pago #${pagoNuevo.id} del ${pagoNuevo.payment_date}` : 'no quedó');
check('AC-4: y el cierre de ese día se ACTUALIZA (el esperado sube por el monto y la diferencia cambia)',
  Math.abs(esperadoUsd(despuesCerrado) - (esperadoUsd(antesCerrado) + 15.5)) < 0.011
  && Math.abs(difUsd(despuesCerrado) - (difUsd(antesCerrado) - 15.5)) < 0.011,
  `esperado ${esperadoUsd(antesCerrado).toFixed(2)}→${esperadoUsd(despuesCerrado).toFixed(2)} · dif ${difUsd(antesCerrado).toFixed(2)}→${difUsd(despuesCerrado).toFixed(2)}`);
check('AC-5: el ARQUEO contado del día cerrado NO se toca (el conteo es un hecho, no un cálculo)',
  Math.abs(despuesCerrado.actual_cash_usd - antesCerrado.actual_cash_usd) < 1e-9
  && Math.abs(despuesCerrado.actual_zelle - antesCerrado.actual_zelle) < 1e-9
  && Math.abs(despuesCerrado.actual_cash_bs - antesCerrado.actual_cash_bs) < 1e-9,
  `actual_cash_usd ${antesCerrado.actual_cash_usd} → ${despuesCerrado.actual_cash_usd}`);
check('AC-6: el día SIGUE cerrado (no se reabrió solo) y el abonado de la orden sumó el cobro',
  despuesCerrado.is_closed === 1 && Math.abs(Number(servicio?.paid_amount ?? 0) - 15.5) < 0.011,
  `is_closed=${despuesCerrado.is_closed} · abonado=${servicio?.paid_amount}`);

// ── 4) CORREGIR LA FECHA del pago DESDE el día cerrado (el caso textual del dueño) ──────────
const abrio2 = await abrirPago();
await waitFor(`!!document.querySelector('[data-action="editar-fecha-pago"]')`, 10000);
const caja = await evalx(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].pop();
  return {
    abierto: !!d,
    titulo: (d?.innerText.match(/Registrar Pago[^\\n]*/) ?? [''])[0],
    filas: [...(d?.querySelectorAll('tbody tr') ?? [])].map(t => t.innerText.replace(/\\s+/g, ' ').trim()),
    accionesFecha: [...(d?.querySelectorAll('[data-action="editar-fecha-pago"]') ?? [])].length,
  };
})()`);
console.log(`\n── el diálogo para corregir la fecha (abrió=${abrio2}) ──\n   ${caja?.titulo} · pagos listados: ${JSON.stringify(caja?.filas)}`);
const edito = await evalx(`(() => {
  const b = document.querySelector('[data-action="editar-fecha-pago"]');
  if (!b) return false;
  b.click(); return true;
})()`);
await sleep(900);
const puestoHoy = await evalx(`(() => {
  const i = document.querySelector('[data-field="pago-fecha-edit"]');
  if (!i) return 'sin campo';
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(hoy)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await sleep(600);
const aplico = await evalx(`(() => {
  const i = document.querySelector('[data-field="pago-fecha-edit"]');
  const cont = i?.closest('div');
  const b = cont ? [...cont.querySelectorAll('button')].find(x => (x.innerText ?? '').trim() === 'OK') : null;
  if (!b) return false;
  b.click(); return true;
})()`);
await sleep(3000);
const pagos2 = await inv('get_service_payments', { serviceId: sid }).catch(() => []);
const movido = (pagos2 ?? []).find(p => Math.abs(Number(p.amount) - 15.5) < 0.001 && String(p.payment_date ?? '').startsWith(hoy));
const cerradoFinal = cierreDe(diaCerrado);
const hoyFinal = cierreDe(hoy);
console.log(`\n── corregir la fecha: del ${diaCerrado} al ${hoy} (editar=${edito ? puestoHoy : 'sin botón'} · OK=${aplico}) ──`);
console.log(`   el pago quedó: ${movido ? `del ${movido.payment_date}` : 'NO'} · cierre del ${diaCerrado}: esperado $${esperadoUsd(cerradoFinal).toFixed(2)} (volvió a ${esperadoUsd(antesCerrado).toFixed(2)}?) · diferencia $${difUsd(cerradoFinal).toFixed(2)}`);
check('AC-7: se puede corregir la fecha de un pago que está en un día CERRADO (antes el sistema lo bloqueaba)',
  edito && aplico === true && !!movido, `editar=${edito} · ok=${aplico} · movido=${!!movido}`);
check('AC-8: el cierre del día cerrado volvió a explicar el día (esperado y diferencia de vuelta al valor de partida)',
  Math.abs(esperadoUsd(cerradoFinal) - esperadoUsd(antesCerrado)) < 0.011
  && Math.abs(difUsd(cerradoFinal) - difUsd(antesCerrado)) < 0.011,
  `esperado ${esperadoUsd(cerradoFinal).toFixed(2)} vs ${esperadoUsd(antesCerrado).toFixed(2)} · dif ${difUsd(cerradoFinal).toFixed(2)} vs ${difUsd(antesCerrado).toFixed(2)}`);

// ── 5) EL DINERO SON 2 DECIMALES (el monto en Bs. conserva sus centavos) ─────────────────────
const bs = await inv('add_service_payment', {
  serviceId: sid, amount: 12345.67, paymentMethod: 'Efectivo Bs', bankFeePercent: 0,
  zelleReference: '', currency: 'VES', notes: 'prueba F92 decimales', paymentDate: hoy,
}).catch(e => ({ error: String(e) }));
const pagoBs = Number.isFinite(Number(bs)) ? (await inv('get_service_payments', { serviceId: sid }) ?? []).find(p => Math.abs(Number(p.amount) - 12345.67) < 0.0001) : null;
const svcFinal = await inv('get_service', { id: sid }).catch(() => null);
const abonado = Number(svcFinal?.paid_amount ?? 0);
console.log(`\n── decimales: cobro de Bs. 12.345,67 (guardado=${typeof bs === 'number' ? '#' + bs : JSON.stringify(bs)}) ──`);
console.log(`   el pago quedó en ${pagoBs?.amount ?? 'NO'} Bs. · el abonado de la orden es $${abonado.toFixed(4)}`);
check('AC-9: un monto en bolívares con centavos se guarda TAL CUAL (antes se redondeaba a entero)',
  !!pagoBs && Math.abs(Number(pagoBs.amount) - 12345.67) < 0.0001, `guardado ${pagoBs?.amount}`);
check('AC-10: el «abonado» se guarda con 2 decimales (sin centavos fantasma ni 4 decimales)',
  Math.abs(abonado * 100 - Math.round(abonado * 100)) < 1e-6, `abonado=${abonado}`);

// ── 6) limpieza: borrar la orden de prueba (y con ella sus pagos) y devolver los cierres ─────
await inv('delete_service_payment', { id: pagoBs?.id }).catch(() => {});
for (const p of pagos2 ?? []) await inv('delete_service_payment', { id: p.id }).catch(() => {});
const borrada = await inv('delete_service', { id: sid }).catch(e => ({ error: String(e) }));
await sleep(1200);
const quedan = uno("SELECT COUNT(*) n FROM services WHERE client = 'Prueba F92 Cierre'").n;
const cerradoLimpio = cierreDe(diaCerrado);
const hoyLimpio = cierreDe(hoy);
console.log(`\n── limpieza ──\n   orden borrada: ${JSON.stringify(borrada) === 'null' || borrada === undefined ? 'sí' : JSON.stringify(borrada)} · quedan ${quedan} de prueba`);
console.log(`   cierre del ${diaCerrado}: esperado $${esperadoUsd(cerradoLimpio).toFixed(2)} · dif $${difUsd(cerradoLimpio).toFixed(2)} (partida: $${esperadoUsd(antesCerrado).toFixed(2)} / $${difUsd(antesCerrado).toFixed(2)})`);
check('AC-11: la prueba no deja residuos (orden de prueba borrada y el cierre del día cerrado como estaba)',
  quedan === 0 && Math.abs(esperadoUsd(cerradoLimpio) - esperadoUsd(antesCerrado)) < 0.011,
  `quedan=${quedan} · esperado ${esperadoUsd(cerradoLimpio).toFixed(2)} vs ${esperadoUsd(antesCerrado).toFixed(2)}`);

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (y limpia lo que crea). Corré sobre una COPIA.');
process.exit(failed.length ? 1 : 0);
