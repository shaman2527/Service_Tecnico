#!/usr/bin/env node
// ============================================================================
// F83 — LA DEVOLUCIÓN DICE A QUÉ CAJA VA (verificación EN VIVO, 2026-10-06).
//
// El hallazgo (revisión adversarial de F82): la devolución es la ÚNICA escritura de dinero que no elige
// fecha — se anota en la caja del TURNO ABIERTO (invariante F36/F69: la plata sale del cajón que se está
// trabajando) — y `RefundDialog` no lo decía en ninguna parte. Con la caja del 21/09 abierta y hoy 27/09,
// una devolución hecha HOY entraba al arqueo del 21/09 **en silencio**.
//
// QUÉ COMPRUEBA (por el camino REAL de la UI):
//   A1 con la caja de HOY: el diálogo lo dice («CAJA DE HOY» + la fecha) y NO hay cartel de turno viejo;
//   A2 con la caja de HOY: el guardado queda habilitado (es información, no un gate nuevo);
//   B1 con la caja de OTRO día: avisa fuerte, nombra las DOS fechas y dice que NO es la de hoy;
//   B2 con la caja de OTRO día: aparece el cartel de F82 (con el botón del remedio) — informar, no bloquear;
//   B3 con la caja de OTRO día: el guardado SIGUE habilitado (opción (a) del backlog: avisar, no bloquear);
//   C  la prueba no deja residuos (borra su orden y devuelve el turno como estaba).
//
// SEGURIDAD DE DATOS: ESCRIBE (crea una orden de prueba, la cobra y arma el escenario del turno con SQL).
// `REGISTRO_DB` es OBLIGATORIO y tiene que ser una COPIA (aborta con registro.db).
//
// Uso:  $env:REGISTRO_DB="...\backup\f83_verif.db"
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 (+ REGISTRO_CDP_PORT)
//       node tools/verify_f83_devolucion_caja.mjs
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

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia que usa la app (esta prueba ESCRIBE).');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: esta prueba ESCRIBE y MUEVE los turnos de caja — corré contra una COPIA, nunca registro.db.');
  process.exit(2);
}
const ro = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return ro.prepare(sql).all(...p)[0] ?? {}; } catch { return {}; } };

const hoy = String(uno("SELECT date('now','localtime') d").d ?? '');
const ddmm = (iso) => String(iso ?? '').split('-').reverse().join('/');
/** El turno abierto inicial (para devolverlo como estaba al final). */
const turnoInicial = String(uno('SELECT close_date FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1').close_date ?? '');
/** Un día PASADO con fila (para el escenario «caja vieja abierta»). */
const diaViejo = String(uno("SELECT close_date FROM daily_closings WHERE close_date < date('now','localtime') ORDER BY close_date DESC LIMIT 1").close_date ?? '');
const tasa = Number(uno("SELECT COALESCE(tasa_bcv,0) t FROM daily_closings WHERE tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1").t ?? 0);
console.log(`· copia: ${dbPath}\n· hoy ${hoy} · turno abierto inicial: ${turnoInicial || 'ninguno'} · día viejo: ${diaViejo || 'ninguno'} · tasa conocida ${tasa}`);
if (!diaViejo) { console.log('ABORTADO: la copia no tiene ningún día anterior para el escenario.'); process.exit(2); }

// ── 0) entrar a la app ───────────────────────────────────────────────────────────────────────
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
await entrar();

// ── 1) ESCENARIO BASE: la caja de HOY abierta (con SQL: es una copia y así es determinista) ────
const abrirDiaConSql = (fecha) => {
  const w = new DatabaseSync(dbPath);
  w.exec("UPDATE daily_closings SET is_closed=1, closed_at=datetime('now','localtime') WHERE is_closed=0");
  const fila = w.prepare('SELECT id FROM daily_closings WHERE close_date = ?1').get(fecha);
  if (fila) {
    w.prepare("UPDATE daily_closings SET is_closed=0, closed_at=NULL, opened_at=COALESCE(opened_at, datetime('now','localtime')) WHERE close_date = ?1").run(fecha);
  } else {
    w.prepare("INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, tasa_eur, opened_at, is_closed) VALUES (?1, 0, ?2, 0, datetime('now','localtime'), 0)").run(fecha, tasa);
  }
  w.close();
};
abrirDiaConSql(hoy);
console.log(`· escenario: turno abierto = ${hoy} (la caja de hoy)`);
await entrar();

// ── 2) orden de prueba + un cobro REAL en Bs (Pago Móvil) para poder devolver ────────────────────
// OJO: el backend le aplica TITLE CASE al cliente («ZZ…» → «Zz…»), así que la marca tiene que ser ya
// la forma final: si no, las comprobaciones por texto (sensibles a mayúsculas) no encuentran la tarjeta.
const marca = 'Prueba F83';
const creada = await inv('add_service_order', {
  client: marca, phone: '000-0000000', clientCi: '', clientAddress: '', clientId: null, technician: '', technicianId: null,
  devices: [{
    model: marca, fault: 'prueba', service_type: 'Otro', service_types: '["Otro"]', amount: 5,
    payment_method: 'Pago Móvil', observations: '', bank_fee_percent: 0, zelle_reference: '', currency: 'VES',
    device_checklist: '', color: '', screen_product_id: null, discount_amount: 0, status: 'Recibido',
  }],
}).catch(e => ({ error: String(e) }));
// OJO: `add_service_order` devuelve el NÚMERO de orden (p.ej. «DEV-0007»), no un objeto con `id`, y
// además el backend le aplica Title Case al nombre del cliente («ZZ Prueba F83» → «Zz Prueba F83»): el
// id se resuelve por la API con el mismo término de búsqueda, sin comparar el nombre exacto.
const filasOrden = await inv('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
const sid = Number((filasOrden ?? [])[0]?.id ?? 0);
if (!sid) { console.log(`ABORTADO: no pude crear la orden de prueba (${JSON.stringify(creada)}).`); process.exit(2); }
console.log(`· orden de prueba #${sid} (${filasOrden?.[0]?.client ?? marca}) creada: ${JSON.stringify(creada)}`);
const bs = Math.max(1, Math.round(5 * (tasa || 1)));
await inv('add_service_payment', { serviceId: sid, amount: bs, paymentMethod: 'Pago Móvil', bankFeePercent: 0, zelleReference: '', currency: 'VES', notes: 'prueba F83', paymentDate: '' }).catch(() => {});
console.log(`· orden de prueba #${sid} (${marca}) cobrada Bs. ${bs} por Pago Móvil`);

/** Abre la devolución de la orden de prueba desde la tarjeta y devuelve lo que dice el diálogo. */
const abrirDevolucion = async () => {
  await entrar(); // recarga: escribir por IPC saltea el bus de datos (F90) y la tarjeta no aparecería
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio Técnico'))`).catch(() => {});
  const hayTarjeta = await waitFor(`document.body.innerText.includes('${marca}')`, 15000);
  const abierto = await evalx(`(() => {
    const cards = [...document.querySelectorAll('div')].filter(d => d.innerText && d.innerText.includes('${marca}') && d.querySelector('button'));
    const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return 'sin tarjeta';
    const b = [...card.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('Devolución'));
    if (!b) return 'sin botón de Devolución';
    b.click(); return 'ok';
  })()`);
  await sleep(1800);
  const visto = await evalx(`(() => {
    const caja = document.querySelector('[data-field="refund-caja"]');
    const banner = document.querySelector('[role="dialog"] [data-field="turno-viejo"]');
    return {
      cajaTexto: caja ? caja.innerText.replace(/\\s+/g, ' ') : null,
      esHoy: caja ? caja.getAttribute('data-es-hoy') : null,
      fecha: caja ? caja.getAttribute('data-caja') : null,
      banner: banner ? { fecha: banner.getAttribute('data-turno-viejo'), remedio: banner.querySelector('[data-field="turno-viejo-remedio"]')?.innerText ?? '', boton: !!banner.querySelector('[data-action="ir-a-cerrar-caja"]') } : null,
    };
  })()`);
  return { hayTarjeta, abierto, ...visto };
};

/** Escribe un monto y dice si el botón del pie queda habilitado. */
const guardadoHabilitado = async (monto) => {
  await evalx(`(() => { const i = [...document.querySelectorAll('[role="dialog"] input[type="number"]')][0]; if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, '${monto}'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(800);
  return await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].filter(x => /Devolver|Confirmar/i.test(x.innerText ?? '')).pop(); return b ? !b.disabled : null; })()`);
};

// ── CASO A: la caja abierta es la de HOY ────────────────────────────────────────────────────────
const A = await abrirDevolucion();
console.log(`\n── A) caja de hoy ──\n   estado=${A.abierto} · es_hoy=${A.esHoy} · caja=${A.fecha}\n   texto: «${String(A.cajaTexto).slice(0, 160)}»`);
check('A1: el diálogo dice que la devolución va a la CAJA DE HOY (y no hay cartel de caja vieja)',
  A.abierto === 'ok' && A.esHoy === 'si' && A.fecha === hoy && !A.banner
  && /CAJA DE HOY/i.test(String(A.cajaTexto)) && String(A.cajaTexto).includes(ddmm(hoy)),
  `es_hoy=${A.esHoy} · caja=${A.fecha} · banner=${A.banner ? 'SÍ' : 'no'}`);
const habA = await guardadoHabilitado(1);
check('A2: con la caja de hoy el guardado está habilitado (es información, no un gate nuevo)', habA === true, `habilitado=${habA}`);
await keyNav('Escape', 'Escape', 27);
await sleep(800);

// ── CASO B: la caja abierta es de OTRO día (el escenario del hallazgo) ───────────────────────────
abrirDiaConSql(diaViejo);
console.log(`\n· escenario: turno abierto = ${diaViejo} (viejo) con hoy ${hoy}`);
const B = await abrirDevolucion();
console.log(`── B) caja vieja ──\n   estado=${B.abierto} · es_hoy=${B.esHoy} · caja=${B.fecha}\n   texto: «${String(B.cajaTexto).slice(0, 200)}»\n   cartel: ${B.banner ? `fecha=${B.banner.fecha} · botón=${B.banner.boton}` : 'NO'}`);
check('B1: avisa que la devolución se anota en la caja del DÍA VIEJO y NO en la de hoy',
  B.abierto === 'ok' && B.esHoy === 'no' && B.fecha === diaViejo
  && String(B.cajaTexto).includes(ddmm(diaViejo)) && String(B.cajaTexto).includes(ddmm(hoy))
  && /NO en la de hoy/i.test(String(B.cajaTexto)) && /Cierres/i.test(String(B.cajaTexto)),
  `es_hoy=${B.esHoy} · caja=${B.fecha}`);
check('B2: aparece el cartel de F82 con el remedio a un toque (informar, no bloquear)',
  !!B.banner && B.banner.fecha === diaViejo && B.banner.boton === true && /Cierres/i.test(String(B.banner.remedio)),
  `banner=${B.banner ? JSON.stringify(B.banner).slice(0, 90) : 'no'}`);
const habB = await guardadoHabilitado(1);
check('B3: y el guardado SIGUE habilitado (la opción (a) del backlog: avisar, no bloquear)', habB === true, `habilitado=${habB}`);
await keyNav('Escape', 'Escape', 27);
await sleep(800);

// ── C) limpieza: la orden de prueba, sus pagos y el turno como estaba ────────────────────────────
for (const p of (await inv('get_service_payments', { serviceId: sid }).catch(() => [])) ?? []) {
  await inv('delete_service_payment', { id: p.id }).catch(() => {});
}
await inv('delete_service', { id: sid }).catch(() => {});
await sleep(1000);
{
  const w = new DatabaseSync(dbPath);
  w.exec("UPDATE daily_closings SET is_closed=1, closed_at=datetime('now','localtime') WHERE is_closed=0");
  if (turnoInicial) w.prepare('UPDATE daily_closings SET is_closed=0, closed_at=NULL WHERE close_date = ?1').run(turnoInicial);
  w.close();
}
const quedan = uno('SELECT COUNT(*) n FROM services WHERE client = ?1', marca).n;
const abiertoFinal = String(uno('SELECT close_date FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1').close_date ?? '');
console.log(`\n── limpieza ──\n   órdenes de prueba que quedan: ${quedan} · turno abierto restaurado: ${abiertoFinal || 'ninguno'} (era ${turnoInicial || 'ninguno'})`);
check('C: la prueba no deja residuos y devuelve el turno como estaba',
  Number(quedan) === 0 && abiertoFinal === turnoInicial,
  `quedan=${quedan} · turno=${abiertoFinal} vs ${turnoInicial}`);

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (y limpia lo que crea). Corré sobre una COPIA.');
process.exit(failed.length ? 1 : 0);
