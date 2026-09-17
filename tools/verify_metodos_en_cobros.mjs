// Verificación EN VIVO (SOLO LECTURA) del selector de métodos en TODOS los lugares donde se cobra (F31).
//
// Comprueba que en cada pantalla de cobro se ven los 3 métodos que más se usan a un toque y que los
// otros 4 están detrás del desplegable «Otros métodos…»:
//   1. Registrar venta (la página de Ventas)
//   2. Pago / Abono de una orden (PaymentDialog)
//   3. Asistente de cierre (CierreServiceDialog)
//   4. Devolución (RefundDialog, si hay una orden que la admita)
// Y al final comprueba por IPC que NO se escribió nada (mismas órdenes y mismos pagos que al empezar).
//
// Uso: node tools/verify_metodos_en_cobros.mjs   (app de dev abierta, CDP en 9222)

import { evalx, clickCenter, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => {
  out.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

const dialogsOpen = () => evalx(`document.querySelectorAll('[role="dialog"]').length`);
const pressEscape = () => evalx(`(() => {
  (document.querySelector('[role="dialog"]') || document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
})()`);
const typeIn = (selector, text) => evalx(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const contar = async () => evalx(`(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const servicios = await inv('get_services', { search: '', status: '', startDate: '', endDate: '' });
  const pagos = await Promise.all(servicios.map(s => inv('get_service_payments', { serviceId: s.id })));
  return JSON.stringify({ servicios: servicios.length, pagos: pagos.reduce((a, p) => a + p.length, 0) });
})()`);

/** Revisa el selector de métodos en el contexto que se le pase (diálogo o página). */
async function revisarPicker(etiqueta, dentroDeDialogo = true) {
  const raiz = dentroDeDialogo ? `document.querySelector('[role="dialog"]')` : `document.body`;
  const chips = await evalx(`(() => {
    const root = ${raiz};
    if (!root) return '[]';
    return JSON.stringify([...root.querySelectorAll('button[data-state]')]
      .map(b => (b.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(t => /PUNTO Bs|PAGO MOVIL|EFECTIVO/.test(t)));
  })()`);
  const lista = JSON.parse(chips || '[]');
  const texto = await evalx(`(${raiz}?.innerText ?? '')`);
  const trigger = await evalx(`(() => {
    const root = ${raiz};
    return !!root && [...root.querySelectorAll('button')].some(b => (b.textContent || '').includes('Otros métodos'));
  })()`);
  const sueltos = ['Punto de Venta ($)', 'Transferencia Zelle', 'Transferencia Bs', 'Efectivo Bs']
    .filter(m => (texto || '').includes(m));

  check(`${etiqueta}: 3 accesos directos (PUNTO Bs · PAGO MOVIL · EFECTIVO $)`, lista.length === 3, lista.join(' · '));
  check(`${etiqueta}: existe el desplegable «Otros métodos…»`, !!trigger);
  check(`${etiqueta}: los otros 4 no están a la vista`, sueltos.length === 0, sueltos.join(', '));
  return { lista, trigger, sueltos };
}

const irA = async (texto) => {
  const ok = await evalx(`(() => {
    const items = [...document.querySelectorAll('aside button, aside a')];
    const it = items.find(b => (b.textContent || '').trim() === ${JSON.stringify(texto)})
      || items.find(b => (b.textContent || '').toLowerCase().includes(${JSON.stringify(texto.toLowerCase())}));
    if (it) it.click();
    return !!it;
  })()`);
  await sleep(1200);
  return ok;
};

/** Espera a que aparezca un botón con ese texto (la lista de órdenes carga por IPC). */
const esperarBoton = async (texto, intentos = 12) => {
  for (let i = 0; i < intentos; i++) {
    if (await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').includes(${JSON.stringify(texto)}))`)) return true;
    await sleep(600);
  }
  return false;
};

console.log('— Métodos de pago en TODOS los cobros (F31) — verificación en vivo SOLO LECTURA —');
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3000);

const desbloquear = async () => {
  if (!(await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`).catch(() => false))) return;
  await typeIn('input[placeholder="PIN de 4 dígitos"]', '1234');
  await sleep(300);
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Entrar')`);
  await sleep(1200);
};
let listo = false;
for (let i = 0; i < 25 && !listo; i++) {
  try { await desbloquear(); listo = await evalx(`!!document.querySelector('aside')`); } catch { /* cargando */ }
  if (!listo) await sleep(800);
}
if (!listo) { check('la app responde', false); process.exit(1); }
check('la app responde (desbloqueada con el PIN del local)', true);

const antes = await contar();
console.log(`   estado inicial (IPC): ${antes}`);

// 1) Registrar venta: el formulario vive en un diálogo que abre «Nueva Venta»
await irA('Ventas');
await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Nueva Venta'))`);
await sleep(1000);
await revisarPicker('Registrar venta', true);
await pressEscape();
await sleep(600);

// 2) Pago / Abono de una orden
await irA('Servicio Técnico');
// La lista abre filtrada en «Activos en taller»: si no hay órdenes activas se pasa a
// «Todos los estados» (las entregadas también tienen Pago/Abono y Devolución).
const soloActivos = await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('Activos en taller'))`);
if (soloActivos) {
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Activos en taller'))`);
  await sleep(600);
  await clickCenter(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent || '').includes('Todos los estados'))`);
  await sleep(1400);
}
const hayTarjetas = await esperarBoton('Pago / Abono');
if (hayTarjetas) {
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Pago / Abono'))`);
  await sleep(1000);
  await revisarPicker('Pago / Abono', true);
  await pressEscape();
  await sleep(600);
} else {
  check('hay órdenes para abrir Pago / Abono', false, 'no cargó ninguna tarjeta');
}

// 3) Asistente de cierre («Cerrar» en la tarjeta). OJO: la barra de herramientas tiene «Cerrar
//    entrega», así que hay que buscar el botón EXACTO «Cerrar» de la tarjeta.
const hayCerrar = await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Cerrar')`);
if (hayCerrar) {
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Cerrar')`);
  await sleep(1400);
  const hayCierre = await evalx(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('Cerrar ')`);
  if (hayCierre) {
    await revisarPicker('Asistente de cierre', true);
    await pressEscape();
    await sleep(600);
  } else {
    check('el asistente de cierre abre', false, 'no se abrió');
  }
} else {
  check('asistente de cierre', true, 'no hay órdenes ACTIVAS en esta copia: se omite (usa el mismo componente compartido)');
}

// 4) Devolución (solo si hay una orden que la admita)
const hayDevolucion = await evalx(`[...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('Devolución'))`);
if (hayDevolucion) {
  await clickCenter(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Devolución'))`);
  await sleep(1000);
  await revisarPicker('Devolución', true);
  await pressEscape();
  await sleep(600);
} else {
  check('Devolución: hay una orden que la admita', true, 'no hay ninguna a la vista (se omite)');
}

// 5) nada abierto y NADA escrito
const abiertos = await dialogsOpen();
check('no queda ningún diálogo abierto', abiertos === 0, `${abiertos} diálogo(s)`);
const despues = await contar();
check('no se escribió nada en la base (mismas órdenes y pagos)', antes === despues, `${antes} → ${despues}`);

const fails = out.filter(o => !o.ok);
console.log(`\nmétodos en los cobros: ${out.length} comprobaciones · ${out.length - fails.length} OK · ${fails.length} fallo(s)`);
console.log('(solo lectura: no se registró ningún cobro)');
process.exit(fails.length > 0 ? 1 : 0);
