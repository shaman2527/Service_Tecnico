// Verificación EN VIVO del ASISTENTE DE CIERRE (F30) por CDP.
//
// Crea dos órdenes de prueba por IPC y las cierra con el asistente:
//   A) una con «Cambio pantalla» y saldo: el asistente pide la PANTALLA y el COBRO, y en un solo
//      gesto cobra, entrega y descuenta stock.
//   B) otra que se lleva el equipo debiendo: exige MOTIVO y lo deja escrito en la orden.
// Al final comprueba en la base (por IPC) estado, abonado, stock descontado, movimiento y motivo.
// Uso: node tools/verify_servicio_cierre.mjs   (sobre una COPIA: escribe de verdad)
import { evalx, clickCenter, keyNav, typeText, insertText, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

const waitReady = async (timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) return true; } catch { /* recargando */ }
    await sleep(700);
  }
  return false;
};
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
await waitReady();

const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// --- preparación: día abierto (para poder cobrar) y dos órdenes de prueba ---
const dia = await invoke('get_active_day');
if (!dia) {
  await invoke('open_day', { initialCashUsd: 0, tasaBcv: 40, tasaEur: 45 });
  console.log('· día abierto para la prueba (tasa 40)');
}
const marca = String(Date.now()).slice(-6);
const pantalla = await evalx(`(async () => {
  const r = await window.__TAURI_INTERNALS__.invoke('find_compatible_products', { model: 'A06', categoryId: null, limit: 20 });
  const p = r.map(x => x.product).find(x => x.category_id === 1 && x.stock > 0);
  return JSON.stringify({ id: p && p.id, nombre: p && p.name, stock: p && p.stock });
})()`);
const pant = JSON.parse(pantalla);
console.log(`· pantalla de prueba: ${pant.nombre} (id ${pant.id}, stock ${pant.stock})`);

const crear = async (nombre) => {
  // el número de orden lo da el backend (igual que el formulario de la app)
  const num = await invoke('next_order_num');
  return invoke('add_service', {
    orderNum: num, client: `Prueba Cierre ${nombre}`, phone: '0414-0000000', model: 'Galaxy A06 4G',
    fault: 'pantalla rota', serviceType: 'Cambio pantalla', serviceTypes: JSON.stringify(['Cambio pantalla']),
    amount: 30, paymentMethod: 'Divisas (USD Cash)', dateIn: '', status: 'Recibido', observations: '',
    bankFeePercent: 0, zelleReference: '', currency: 'USD', clientCi: '', clientAddress: '',
    deviceChecklist: '', technician: '', technicianId: null, color: '', screenProductId: null, discountAmount: 0,
  });
};
const idA = await crear(`A${marca}`);
const idB = await crear(`B${marca}`);
check('F30: se prepararon las dos órdenes de prueba', Number(idA) > 0 && Number(idB) > 0, `ids ${idA} / ${idB}`);

// --- abrir Servicios y buscar la orden A ---
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
await sleep(1500);
const buscar = async (texto) => {
  await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await typeText(texto);
  await sleep(1500);
};
await buscar(`A${marca}`);
const hayCerrar = await evalx(`!!([...document.querySelectorAll('button')].find(b => /^Cerrar$/i.test(b.innerText.trim())))`);
check('F30: la tarjeta de la orden ofrece el botón «Cerrar» (asistente)', hayCerrar);
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Cerrar$/i.test(b.innerText.trim()))`);
await sleep(1500);

// --- A) el asistente pide pantalla + cobro ---
// El asistente consulta las pantallas compatibles al abrir; esa consulta se encola detrás de las que
// hace la lista de servicios (los movimientos de cada orden visible). Con una lista grande puede tardar
// un par de segundos, así que se ESPERA a que la sección aparezca en vez de dormir un rato fijo
// (medido: con `sleep(1500)` el chequeo fallaba 1 de cada 3 veces sin que nada estuviera mal).
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
await waitFor(`/¿Qué pantalla se instaló\\?/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`);
let dlg = String(await dialogText() ?? '');
check('F30: el asistente dice qué falta antes de cerrar',
  /Falta:/i.test(dlg) && /pantalla/i.test(dlg) && /cobrar el saldo/i.test(dlg),
  (dlg.match(/Falta:[^\n]*/) ?? [''])[0]);
check('F30: muestra la pantalla que se va a instalar con su stock', /¿Qué pantalla se instaló\?/i.test(dlg) && /stock \d+/i.test(dlg),
  (dlg.match(/stock \d+/) ?? [''])[0] || ('SIN SECCIÓN → ' + dlg.replace(/\n/g, ' | ').slice(0, 200)));

// elegir la primera pantalla con stock
await clickCenter(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /stock \\d+/i.test(x.innerText) && !/agotada/i.test(x.innerText)); return b; })()`);
await waitFor(`!!document.querySelector('[role="dialog"] button .lucide-check')`);

// cobrar el saldo completo
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Todo el saldo$/i.test(b.innerText.trim()))`);
await sleep(800);
dlg = String(await dialogText() ?? '');
check('F30: el cobro se precarga con el saldo y avisa que queda cancelada',
  /queda/i.test(dlg) && /cancelada/i.test(dlg), (dlg.match(/Se registra[^\n]*/) ?? [''])[0]);
check('F30: ofrece imprimir la orden al cerrar', /Imprimir la orden al cerrar/i.test(dlg));
// desmarcar la impresión para poder ver el resumen del cierre
await clickCenter(`[...document.querySelectorAll('[role="dialog"] label')].find(l => /Imprimir la orden al cerrar/.test(l.innerText))?.querySelector('input')`);
await sleep(500);

const stockAntes = Number(pant.stock);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^(Cobrar y entregar|Entregar con saldo)$/i.test(b.innerText.trim()))`);
await sleep(3500);
dlg = String(await dialogText() ?? '');
check('F30: al cerrar confirma que la orden quedó entregada', /Orden cerrada/i.test(dlg), (dlg.match(/Orden cerrada[^\n]*/) ?? [''])[0]);
await keyNav('Escape', 'Escape', 27);
await sleep(1000);

const a = await invoke('get_service', { id: Number(idA) });
check('F30: la orden quedó Entregado y cobrada',
  a && a.status === 'Entregado' && Math.abs((a.paid_amount ?? 0) - 30) < 0.01,
  `estado=${a && a.status} · abonado=${a && a.paid_amount} · salida=${a && a.date_out}`);
const pantDespues = await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: 1 });
  const x = p.find(z => z.id === ${Number(pant.id)});
  return x ? x.stock : -999;
})()`);
check('F30: la pantalla elegida y el stock descontado en 1', pantDespues === stockAntes - 1, `${stockAntes} → ${pantDespues}`);
const mov = await invoke('get_inventory_movements_page', { search: '', type: 'salida', limit: 5, offset: 0 });
const items = Array.isArray(mov) ? mov : (mov.items ?? []);
check('F30: quedó el movimiento «Servicio Entregado»',
  items.some(m => /Servicio Entregado/i.test(String(m.reason))), items.slice(0, 2).map(m => m.reason).join(' | '));

// --- B) entregar con saldo: exige motivo ---
await buscar(`B${marca}`);
await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Cerrar$/i.test(b.innerText.trim()))`);
await sleep(1500);
const botonSaldo = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Entregar con saldo$/i.test(t)) ?? null)()`);
check('F30: sin cobrar, el botón dice «Entregar con saldo»', botonSaldo !== null, String(botonSaldo));
const bloqueado = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Entregar con saldo$/i.test(x.innerText.trim())); return b ? b.disabled : null; })()`);
check('F30: sin motivo, entregar con saldo está BLOQUEADO', bloqueado === true, `disabled=${bloqueado}`);
// primero la pantalla (la orden es «Cambio pantalla»), después el motivo.
// Igual que en A: se ESPERA la sección de pantallas (la consulta se encola detrás de las de la lista)
// y se espera a que la elección quede marcada antes de seguir — sin esperas a ojo.
await waitFor(`/¿Qué pantalla se instaló\\?/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`);
await clickCenter(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /stock \\d+/i.test(x.innerText) && !/agotada/i.test(x.innerText)); return b; })()`);
await waitFor(`!!document.querySelector('[role="dialog"] button .lucide-check')`);
await clickCenter(`document.querySelector('[role="dialog"] input[aria-label="Motivo del saldo pendiente"]')`);
await insertText('cliente conocido, paga el viernes');
await sleep(700);
await waitFor(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Entregar con saldo$/i.test(x.innerText.trim())); return !!b && !b.disabled; })()`);
const yaPuede = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Entregar con saldo$/i.test(x.innerText.trim())); return b ? !b.disabled : null; })()`);
check('F30: con la pantalla y el motivo, ya se puede cerrar', yaPuede === true);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Entregar con saldo$/i.test(b.innerText.trim()))`);
await sleep(3000);
await keyNav('Escape', 'Escape', 27);
await sleep(800);
const b = await invoke('get_service', { id: Number(idB) });
check('F30: la orden B quedó Entregado con el MOTIVO escrito y sin cobrar',
  b && b.status === 'Entregado' && /paga el viernes/i.test(String(b.observations)) && (b.paid_amount ?? 0) < 0.01,
  `estado=${b && b.status} · observaciones="${String(b && b.observations).slice(0, 60)}" · abonado=${b && b.paid_amount}`);

// --- C) la COLA DE ENTREGAS (F4): buscar la orden por lo que dice el cliente ---
// (la cola lista las órdenes EN TALLER: se crea una tercera que queda activa)
const idC = await crear(`C${marca}`);
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
await sleep(1200);
await keyNav('F4', 'F4', 115);
await sleep(1500);
const cola = String(await dialogText() ?? '');
check('F30: la cola de entregas abre con F4', /entrega/i.test(cola) && /Cédula, teléfono/i.test(cola), cola.split('\n').slice(0, 2).join(' · '));
await clickCenter(`document.querySelector('[role="dialog"] input')`);
await typeText(`C${marca}`);
await sleep(1500);
const opciones = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] [role="option"]')].map(o => o.innerText.replace(/\\s+/g, ' ').slice(0, 60)))()`);
check('F30: la cola encuentra la orden por el nombre del cliente', opciones.some(o => o.includes(`C${marca}`)), opciones.slice(0, 3).join(' | '));
await clickCenter(`[...document.querySelectorAll('[role="dialog"] [role="option"]')].find(o => o.innerText.includes('Cierre'))`);
await sleep(1800);
const trasElegir = String(await dialogText() ?? '');
// El título del asistente es «Cerrar {order_num}» y los números reales son «DEV-0010» (no solo
// dígitos): la regex tiene que aceptar el prefijo DEV- (antes fallaba en falso).
check('F30: al elegir la orden se abre el asistente de cierre', /Cerrar\s+(DEV-)?-?\d+/i.test(trasElegir) && /cobro|Cobrar y entregar|Entregar con saldo/i.test(trasElegir),
  trasElegir.split(' ').slice(0, 5).join(' '));
await keyNav('Escape', 'Escape', 27);
await sleep(800);

// limpieza: se borran las tres órdenes de prueba
await invoke('delete_service', { id: Number(idC) });
await invoke('delete_service', { id: Number(idB) });
await invoke('delete_service', { id: Number(idA) });

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
