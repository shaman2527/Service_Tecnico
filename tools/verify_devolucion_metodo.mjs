// VERIFICACIÓN EN VIVO F42 — el bug exacto, reproducido en un pedido de PRUEBA y borrado al final.
//
// Caso: orden con el FORMULARIO en «Punto de Venta (Bs)» pero cobrada por **Pago Móvil**.
//   (1) el diálogo de devolución tiene que PROPONER «Pago Móvil» (no el del formulario);
//   (2) elegir «Punto de Venta (Bs)» tiene que estar BLOQUEADO con el mensaje que dice por dónde entró.
// Uso: node tools/verify_devolucion_metodo.mjs   (app abierta con CDP 9222, día abierto)
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
const waitFor = async (expr, timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evalx(expr).catch(() => false)) return true; await sleep(150); }
  return false;
};

// --- sesión de dueño (si la app arrancó en frío) ---
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }

const dia = await invoke('get_active_day');
if (!dia) { console.error('No hay día abierto: no se toca nada.'); process.exit(2); }
console.log('día abierto:', dia.close_date);

// --- pedido de PRUEBA (se borra al final) ---
let sid = null;
try {
  sid = await invoke('add_service_order', {
    client: 'ZZ Prueba F42', phone: '000-0000000', clientCi: '', clientAddress: '',
    clientId: null, technician: '', technicianId: null,
    devices: [{
      model: 'ZZ Prueba F42', fault: 'prueba', service_type: 'Otro', service_types: '["Otro"]',
      amount: 5, payment_method: 'Punto de Venta (Bs)', observations: '', bank_fee_percent: 0,
      zelle_reference: '', currency: 'VES', device_checklist: '', color: '',
      screen_product_id: null, discount_amount: 0, status: 'Recibido',
    }],
  });
  const svc = (await invoke('get_services', { search: 'ZZ Prueba F42', status: '', startDate: '', endDate: '', dateField: 'in' }))[0];
  const id = svc.id;
  // cobro REAL por Pago Móvil (Bs. 4.243 = $5 a la tasa del día)
  const tasa = dia.tasa_bcv;
  const bs = Math.round(5 * tasa);
  await invoke('add_service_payment', { serviceId: id, amount: bs, paymentMethod: 'Pago Móvil', bankFeePercent: 0, zelleReference: '', currency: 'VES', notes: 'prueba F42', paymentDate: '' });
  check('pedido de prueba cobrado por Pago Móvil', bs > 0, `Bs. ${bs} (tasa ${tasa})`);

  // --- el BACKEND rechaza devolver por el Punto (que no cobró nada) ---
  const err = await evalx(`(async () => { try { await window.__TAURI_INTERNALS__.invoke('add_service_refund', { serviceId: ${id}, amount: 100, paymentMethod: 'Punto de Venta (Bs)', zelleReference: '', currency: 'VES', notes: 'prueba' }); return 'SIN ERROR'; } catch (e) { return String(e); } })()`);
  check('el backend rechaza devolver por un método que no cobró', err.includes('no entró plata'), err.slice(0, 120));
  check('el mensaje dice por dónde ENTRÓ', err.includes('Pago Móvil'), err.slice(0, 160));

  // --- el DIÁLOGO propone el método real (y no avisa de nada raro) ---
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio Técnico'))`);
  await waitFor(`document.body.innerText.includes('ZZ Prueba F42')`, 15000);
  const abierto = await evalx(`(() => {
    const cards = [...document.querySelectorAll('div')].filter(d => d.innerText && d.innerText.includes('ZZ Prueba F42') && d.querySelector('button'));
    const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return 'sin tarjeta';
    const b = [...card.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('Devolución'));
    if (!b) return 'sin botón de Devolución';
    b.click(); return 'ok';
  })()`);
  check('se abrió el diálogo de devolución desde la tarjeta', abierto === 'ok', String(abierto));
  await sleep(1500);
  const entro = await evalx(`(() => { const el = document.querySelector('[data-field="refund-entro"]'); return el ? el.innerText.split(String.fromCharCode(10)).join(' ') : null; })()`);
  check('el diálogo dice de dónde entró la plata', !!entro && /Pago M/i.test(entro ?? ''), entro ?? '(no está)');
  // Si el método propuesto YA es el real, no hay aviso ni botón «Usar el real»: eso prueba el default
  const aviso = await evalx(`(() => { const el = document.querySelector('[data-field="refund-metodo-aviso"]'); return el ? el.innerText.slice(0, 90) : null; })()`);
  const atajo = await evalx(`!!document.querySelector('[data-action="usar-metodo-real"]')`);
  check('el método propuesto ES el real (sin aviso ni atajo)', !aviso && !atajo, aviso ?? 'sin aviso');
  const tope = await evalx(`(() => { const el = document.querySelector('[data-field="refund-cap"]'); return el ? el.innerText : null; })()`);
  check('el tope se dice en Bs. (la moneda del cobro)', /^Bs\./.test(tope ?? ''), tope ?? '(no está)');
  await keyNav('Escape', 'Escape', 27);
  await sleep(600);
} finally {
  // --- limpieza: borrar el pedido de prueba y sus movimientos ---
  if (sid) {
    const svc = (await invoke('get_services', { search: 'ZZ Prueba F42', status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []))[0];
    if (svc) {
      const pagos = await invoke('get_service_payments', { serviceId: svc.id }).catch(() => []);
      for (const p of pagos) await invoke('delete_service_payment', { id: p.id }).catch(() => {});
      await invoke('delete_service', { id: svc.id }).catch(() => {});
      const quedan = await invoke('get_services', { search: 'ZZ Prueba F42', status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
      console.log(quedan.length === 0 ? 'limpieza: pedido de prueba borrado' : `AVISO: quedó el pedido ${svc.id}`);
    }
  }
}

const fallos = results.filter(r => !r.ok);
console.log(`\n${results.length - fallos.length}/${results.length} ${fallos.length ? 'CON FALLOS' : 'OK'}`);
process.exit(fallos.length ? 1 : 0);
