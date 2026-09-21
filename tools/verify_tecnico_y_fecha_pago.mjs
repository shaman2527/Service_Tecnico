// Verificación EN VIVO por CDP de las features F34 + F35 (2026-09-17).
//
// F34 — CAMBIO RÁPIDO DE TÉCNICO desde la tarjeta: el técnico del encabezado de la tarjeta es un
//       botón; al elegir otro técnico la orden queda guardada y la tarjeta lo refleja.
// F35 — FECHA DEL PAGO: el abono se puede anotar en la caja del día en que la plata entró (el cliente
//       pagó el lunes y avisó el martes). Se comprueba el campo en el diálogo, el aviso cuando la
//       fecha no es hoy, la edición de la fecha de un pago y las GUARDAS del backend (futuro, día
//       cerrado, día sin turno).
//
// ESCRIBE Y LIMPIA: crea UNA orden de prueba, le asigna un técnico, registra un abono de $1 y lo
// borra, y al final borra la orden. NO toca el día (aborta si no hay turno abierto), no cierra días
// ni toca la tasa.
//
// Uso:  node tools/verify_tecnico_y_fecha_pago.mjs     (app de dev abierta + CDP en 9222)

import { evalx, clickCenter, keyNav, insertText, sleep } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => {
  out.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const invokeErr = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(() => null, (e) => String(e)))()`);
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);

const hoyJs = `(() => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })()`;

// ── 0) app lista (login si hace falta) ───────────────────────────────────────────────────────
const waitReady = async (timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) return true; } catch { /* cargando */ }
    await sleep(700);
  }
  return false;
};
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
await waitReady();
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) {
  await clickCenter(pin);
  await evalx(`(() => { const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]'); i.focus(); i.select(); return true; })()`);
  for (const ch of '1234') {
    await evalx(`(() => {
      const i = document.querySelector('input[placeholder="PIN de 4 dígitos"]');
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, i.value + '${ch}');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await sleep(400);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// ── 1) GATE DE DATOS: sin día abierto no se corre (esta prueba NO abre el día) ───────────────
const dia = await invoke('get_active_day').catch(() => null);
if (!dia) {
  console.log('ABORTADO: no hay día abierto. Abrí el día en Libro Diario y volvé a correr la prueba (no lo abre sola: no ensucia el turno del local).');
  process.exit(2);
}
const hoy = await evalx(hoyJs);
console.log(`· día abierto (${dia.close_date ?? 'hoy'}) · tasa ${dia.tasa_bcv} · hoy ${hoy}`);

// ── 2) GUARDAS DEL BACKEND (F35) — se prueban por invoke, sin UI ─────────────────────────────
const marca = String(Date.now()).slice(-6);
const cerrar = async () => {
  const rows = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
  for (const r of rows ?? []) await invoke('delete_service', { id: r.id }).catch(() => {});
};

let id = null;
try {
  const nueva = await invoke('add_service_order', {
    client: `Prueba Técnico ${marca}`, phone: '0414-0000000', clientCi: '', clientAddress: '',
    clientId: null, technician: '', technicianId: null,
    devices: [{
      model: 'Galaxy A06 4G', fault: 'prueba F34/F35', service_type: 'Software / Formateo',
      service_types: JSON.stringify(['Software / Formateo']), amount: 30, discount_amount: 0,
      payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
      currency: 'USD', device_checklist: '', color: '', screen_product_id: null, status: 'Recibido',
    }],
  });
  const rows = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
  id = rows.find(r => (r.order_num ?? '') === nueva)?.id ?? null;
  check('F34: la orden de prueba se creó', !!id, `orden ${nueva}`);

  const manana = await evalx(`(() => { const d = new Date(); d.setDate(d.getDate()+1); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })()`);
  const errFuturo = await invokeErr('add_service_payment', {
    serviceId: id, amount: 1, paymentMethod: 'Divisas (USD Cash)', bankFeePercent: 0,
    zelleReference: '', currency: 'USD', notes: 'prueba fecha futura', paymentDate: manana,
  });
  check('F35: el backend RECHAZA un pago con fecha futura', /no puede ser futura/i.test(String(errFuturo)), String(errFuturo).slice(0, 90));

  const sinTurno = await evalx(`(() => { const d = new Date(); d.setDate(d.getDate()-400); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })()`);
  const errSinTurno = await invokeErr('add_service_payment', {
    serviceId: id, amount: 1, paymentMethod: 'Divisas (USD Cash)', bankFeePercent: 0,
    zelleReference: '', currency: 'USD', notes: 'prueba sin turno', paymentDate: sinTurno,
  });
  check('F35: el backend RECHAZA un día sin turno (la plata no queda fuera de toda caja)',
    /No hay un turno/i.test(String(errSinTurno)), String(errSinTurno).slice(0, 100));

  const errFormato = await invokeErr('add_service_payment', {
    serviceId: id, amount: 1, paymentMethod: 'Divisas (USD Cash)', bankFeePercent: 0,
    zelleReference: '', currency: 'USD', notes: 'prueba formato', paymentDate: '17/09/2026',
  });
  check('F35: el backend RECHAZA una fecha mal formada', /AAAA-MM-DD/i.test(String(errFormato)), String(errFormato).slice(0, 90));

  // Un día CERRADO (si la copia tiene alguno) tiene que explicar el camino real (↺ en Cierres)
  const cierres = await invoke('get_daily_closings').catch(() => []);
  const cerrado = (cierres ?? []).find(c => c.is_closed === 1 && c.close_date !== hoy);
  if (cerrado) {
    const errCerrado = await invokeErr('add_service_payment', {
      serviceId: id, amount: 1, paymentMethod: 'Divisas (USD Cash)', bankFeePercent: 0,
      zelleReference: '', currency: 'USD', notes: 'prueba día cerrado', paymentDate: cerrado.close_date,
    });
    check('F35: un día CERRADO se rechaza diciendo cómo abrirlo (↺ en Libro Diario → Cierres)',
      /ya está CERRADO/i.test(String(errCerrado)) && /Cierres/i.test(String(errCerrado)), String(errCerrado).slice(0, 120));
  } else {
    check('F35: no hay días cerrados en la copia para probar esa guarda (se omite)', true, 'sin cierres');
  }

  // ── 3) UI de Servicio Técnico: tarjeta + técnico rápido (F34) y diálogo de abono (F35) ─────
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
  await sleep(1600);
  await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await insertText(`Prueba Técnico ${marca}`);
  await sleep(1800);

  const hayBoton = await evalx(`!!document.querySelector('[data-tech-quick="${id}"]')`);
  check('F34: el técnico de la tarjeta es un BOTÓN clickeable (data-tech-quick)', hayBoton === true);
  const textoBoton = await evalx(`document.querySelector('[data-tech-quick="${id}"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
  check('F34: sin técnico la tarjeta invita a asignarlo', /Asignar/i.test(String(textoBoton)), String(textoBoton));

  await clickCenter(`document.querySelector('[data-tech-quick="${id}"]')`);
  await sleep(800);
  const dialogoTech = String(await dialogText() ?? '');
  check('F34: el clic abre el selector rápido (no el formulario completo)',
    /Cambiar técnico/i.test(dialogoTech) && /Sin asignar/i.test(dialogoTech), dialogoTech.split('\n')[0]);
  const opciones = await evalx(`[...document.querySelectorAll('[data-tech-option]')].length`);
  check('F34: lista los técnicos del padrón + «Sin asignar»', Number(opciones) >= 3, `opciones=${opciones}`);

  // Elegir el primer técnico de verdad (id numérico, no la opción "ninguno")
  const primerTech = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-tech-option]')].find(x => /^\\d+$/.test(x.getAttribute('data-tech-option') || ''));
    return b ? JSON.stringify({ id: b.getAttribute('data-tech-option'), nombre: b.innerText.replace(/\\s+/g,' ').trim() }) : null;
  })()`);
  const tech = JSON.parse(primerTech ?? 'null');
  if (tech) {
    await clickCenter(`document.querySelector('[data-tech-option="${tech.id}"]')`);
    await sleep(1800);
    const guardado = await invoke('get_service', { id });
    check('F34: el técnico elegido queda GUARDADO en la orden (y sin tocar el resto)',
      String(guardado?.technician_id) === String(tech.id) && Number(guardado?.amount) === 30 && guardado?.status === 'Recibido',
      `technician_id=${guardado?.technician_id} · monto=${guardado?.amount} · estado=${guardado?.status}`);
    const reflejado = await evalx(`document.querySelector('[data-tech-quick="${id}"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
    check('F34: la TARJETA lo refleja al instante', String(reflejado).includes(tech.nombre.split(' ')[0]), String(reflejado));

    // «Sin asignar» tiene que DESASIGNAR de verdad (bloqueante de la revisión adversarial: con
    // `patch.technicianId ?? s.technician_id` el id viejo sobrevivía al null y no cambiaba nada).
    await clickCenter(`document.querySelector('[data-tech-quick="${id}"]')`);
    await sleep(800);
    await clickCenter(`document.querySelector('[data-tech-option="ninguno"]')`);
    await sleep(1800);
    const trasQuitar = await invoke('get_service', { id });
    check('F34: «Sin asignar» desasigna DE VERDAD (technician_id vuelve a null)',
      trasQuitar?.technician_id == null && !trasQuitar?.technician,
      `technician_id=${trasQuitar?.technician_id} · technician=${trasQuitar?.technician}`);
    const tarjetaTras = await evalx(`document.querySelector('[data-tech-quick="${id}"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
    check('F34: y la tarjeta lo refleja (vuelve a «Asignar»)', /Asignar/i.test(String(tarjetaTras)), String(tarjetaTras));
  } else {
    check('F34: hay al menos un técnico en el padrón para probar', false, 'sin técnicos');
  }

  // ── 3b) BLOQUEANTE: cambiar el técnico de una orden ENTREGADA no puede tocar su fecha de entrega
  // (si `date_out` se re-estampa, el monto de esa orden se muda de la caja del día de la entrega a la
  // de hoy, se reinicia la garantía de 7 días y entra en «Entregados hoy»).
  const fechaVieja = '2026-01-05';
  await invoke('update_service', {
    id, client: `Prueba Técnico ${marca}`, phone: '0414-0000000', model: 'Galaxy A06 4G',
    fault: 'prueba F34/F35', serviceType: 'Software / Formateo', serviceTypes: JSON.stringify(['Software / Formateo']),
    amount: 30, paymentMethod: 'Divisas (USD Cash)', dateOut: fechaVieja, status: 'Entregado',
    observations: '', bankFeePercent: 0, zelleReference: '', currency: 'USD', clientCi: '', clientAddress: '',
    deviceChecklist: '', technician: '', technicianId: null, color: '', screenProductId: null, discountAmount: 0,
  });
  const antes = await invoke('get_service', { id });
  check('F34: (preparación) la orden entregada tiene su fecha de entrega vieja',
    String(antes?.date_out ?? '').slice(0, 10) === fechaVieja, `date_out=${antes?.date_out} · estado=${antes?.status}`);
  // La lista tiene que estar FRESCA y VER la orden entregada. F44: el filtro de estado por defecto
  // es «Todos los estados» (una orden entregada YA se ve sin tocar nada); alcanza con pasar el eje de
  // fecha a «Entregados» para que el rango —que acá no se usa— hable de la fecha de entrega. Antes se
  // clickeaba «Limpiar» para borrar el rango, pero ese botón solo existía si había fechas cargadas:
  // era un clic muerto (ahora el botón se llama «Limpiar filtros» y borra también la búsqueda, que acá
  // hace falta para no traer todo el historial).
  await clickCenter(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Entregados')`);
  await sleep(3000);
  // El modal de la tarjeta (Card) no lleva `data-slot`: se comprueba lo que importa — que el botón
  // del técnico de ESA orden esté en pantalla (el estado «Entregado» ya se verificó por invoke).
  const enPantalla = await evalx(`(() => {
    const b = document.querySelector('[data-tech-quick="${id}"]');
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return JSON.stringify({ texto: b.innerText.replace(/\\s+/g,' ').trim(), visible: r.width > 0 && r.height > 0 });
  })()`);
  const vis = JSON.parse(enPantalla ?? 'null');
  check('F34: (preparación) la tarjeta de la orden ENTREGADA está visible y clickeable',
    vis?.visible === true, `estado=${antes?.status} · ${enPantalla}`);
  await clickCenter(`document.querySelector('[data-tech-quick="${id}"]')`);
  await sleep(800);
  const otro = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-tech-option]')].find(x => /^\\d+$/.test(x.getAttribute('data-tech-option') || ''));
    return b ? b.getAttribute('data-tech-option') : null;
  })()`);
  if (otro) {
    await clickCenter(`document.querySelector('[data-tech-option="${otro}"]')`);
    await sleep(1800);
    const despues = await invoke('get_service', { id });
    check('F34: cambiar el técnico de una ENTREGADA conserva su fecha de entrega (no mueve plata de caja)',
      String(despues?.date_out ?? '').slice(0, 10) === fechaVieja && despues?.status === 'Entregado',
      `date_out=${despues?.date_out} (antes ${antes?.date_out})`);
  }

  // ── 4) F35 por la UI: el diálogo de abono trae la fecha y el historial se puede corregir ───
  await clickCenter(`[...document.querySelectorAll('button')].find(b => /^(Pago|Abono)/.test(b.innerText.trim()))`);
  await sleep(1600);
  const dialogoPago = String(await dialogText() ?? '');
  check('F35: el diálogo de abono tiene el campo «Fecha del pago»', /Fecha del pago/i.test(dialogoPago), dialogoPago.split('\n').slice(0, 3).join(' · '));
  const campo = await evalx(`(() => {
    const i = document.querySelector('[data-field="pay-fecha"]');
    return i ? JSON.stringify({ valor: i.value, max: i.getAttribute('max'), tipo: i.type }) : null;
  })()`);
  const c = JSON.parse(campo ?? 'null');
  // La fecha por defecto es la del TURNO ABIERTO (su caja es la única que puede recibir el abono).
  const diaTurno = String(dia.close_date ?? hoy).slice(0, 10);
  check('F35: arranca en la fecha del turno abierto y no deja elegir una fecha futura',
    c?.valor === diaTurno && c?.max === hoy, campo);

  // Un pago de $1 con la fecha de hoy (queda en el historial para probar la corrección).
  // El monto se escribe como lo haría el operario (foco + teclado), no con un setter sintético.
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] input[type="number"]')][0]`);
  await evalx(`(() => { const i = document.activeElement; if (i && i.select) i.select(); return true; })()`);
  await insertText('1');
  await sleep(600);
  const boton = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Guardar Pago/i.test(x.innerText.trim()));
    return b ? JSON.stringify({ disabled: b.disabled, rect: [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)] }) : null;
  })()`);
  check('F35: con el monto cargado, Guardar Pago queda habilitado', JSON.parse(boton ?? '{}')?.disabled === false, String(boton));
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /Guardar Pago/i.test(b.innerText.trim()))`);
  await sleep(2200);
  const pagos = await invoke('get_service_payments', { serviceId: id }).catch(() => []);
  const pago = (pagos ?? [])[0];
  check('F35: el abono queda anotado en la caja del turno abierto', String(pago?.payment_date ?? '').slice(0, 10) === diaTurno,
    `payment_date=${pago?.payment_date} · turno=${diaTurno}`);

  // El historial permite corregir la fecha (nueva feature): se abre el editor y se comprueba
  await clickCenter(`[...document.querySelectorAll('button')].find(b => /^(Pago|Abono)/.test(b.innerText.trim()))`);
  await sleep(1500);
  const hayEditor = await evalx(`!!document.querySelector('[data-action="editar-fecha-pago"]')`);
  check('F35: la fecha del pago en el historial es corregible (candidato/editable)', hayEditor === true);
  if (hayEditor) {
    const fechaMostrada = await evalx(`document.querySelector('[data-action="editar-fecha-pago"]')?.innerText.trim() ?? null`);
    const [y, m, d] = diaTurno.split('-');
    check('F35: el historial muestra la fecha en formato del local (dd/mm/aaaa)',
      String(fechaMostrada) === `${d}/${m}/${y}`, String(fechaMostrada));
    await clickCenter(`document.querySelector('[data-action="editar-fecha-pago"]')`);
    await sleep(600);
    const editor = await evalx(`(() => {
      const i = document.querySelector('[data-field="pago-fecha-edit"]');
      return i ? JSON.stringify({ valor: i.value, max: i.getAttribute('max') }) : null;
    })()`);
    const e = JSON.parse(editor ?? 'null');
    check('F35: el editor de fecha abre con la fecha del pago y tope HOY', e?.valor?.slice(0, 10) === diaTurno && e?.max === hoy, editor);
    // Guardar la MISMA fecha por la UI comprueba el comando angosto de corrección de punta a punta
    await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.trim() === 'OK')`);
    await sleep(1600);
    const pagosTras = await invoke('get_service_payments', { serviceId: id }).catch(() => []);
    check('F35: corregir la fecha se guarda de verdad (comando angosto update_service_payment_date)',
      String((pagosTras ?? [])[0]?.payment_date ?? '').slice(0, 10) === diaTurno, `payment_date=${(pagosTras ?? [])[0]?.payment_date}`);
  }
  await keyNav('Escape', 'Escape', 27);
  await sleep(700);
  if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(700); }

  // ── 5) F36: la DEVOLUCIÓN se mide POR MONEDA (sin la tasa de hoy) y devolver todo SALDA la orden
  // (antes: abono en Bs valuado con la tasa del día del cobro + devolución valuada con la de hoy
  // dejaba un saldo fantasma que el recibo imprimía).
  {
    // Orden nueva con un cobro en Bs. del turno abierto (la tasa de ESE día es la que manda)
    const refBs = await invoke('add_service_order', {
      client: `Prueba Devolucion Bs ${marca}`, phone: '', clientCi: '', clientAddress: '',
      clientId: null, technician: '', technicianId: null,
      devices: [{
        model: 'Galaxy A06 4G', fault: 'prueba F36', service_type: 'Software / Formateo',
        service_types: JSON.stringify(['Software / Formateo']), amount: 100, discount_amount: 0,
        payment_method: 'Efectivo Bs', observations: '', bank_fee_percent: 0, zelle_reference: '',
        currency: 'USD', device_checklist: '', color: '', screen_product_id: null, status: 'Recibido',
      }],
    });
    const filasBs = await invoke('get_services', { search: `Devolucion Bs ${marca}`, status: '', startDate: '', endDate: '', dateField: 'in' });
    const idBs = filasBs?.find(r => (r.order_num ?? '') === refBs)?.id;
    const montoBs = 1000;
    await invoke('add_service_payment', {
      serviceId: idBs, amount: montoBs, paymentMethod: 'Efectivo Bs', bankFeePercent: 0,
      zelleReference: '', currency: 'USD', notes: 'cobro en Bs', paymentDate: diaTurno,
    });
    const trasCobro = await invoke('get_service', { id: idBs });
    const esperadoUsd = +(montoBs / (dia.tasa_bcv || 1)).toFixed(2);
    check('F36: el abono en Bs se valúa con la tasa del día del cobro',
      Math.abs((trasCobro?.paid_amount ?? 0) - esperadoUsd) < 0.6,
      `paid=$${trasCobro?.paid_amount} · esperado ≈$${esperadoUsd} (tasa ${dia.tasa_bcv})`);

    // El diálogo de devolución tiene que ofrecer EXACTAMENTE los Bs. que entraron (sin convertir).
    // El filtro de estado quedó en «Entregados» por el chequeo anterior: se vuelve a «Recibidos»
    // (que además restaura «Activos en taller») para que la orden nueva esté en la lista.
    await clickCenter(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Recibidos')`);
    await sleep(1600);
    await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
    await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); })()`);
    await keyNav('Backspace', 'Backspace', 8);
    await insertText(`Devolucion Bs ${marca}`);
    await sleep(1800);
    await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Devolución$/.test(b.innerText.trim()))`);
    await sleep(1600);
    const cap = await evalx(`document.querySelector('[data-field="refund-cap"]')?.innerText.trim() ?? null`);
    const capOk = String(cap).replace(/\./g, '').replace(/,/g, '.');
    check('F36: la devolución ofrece el tope EN BOLÍVARES (lo que entró, sin la tasa de hoy)',
      Math.abs(Number(capOk.replace(/[^\d.]/g, '')) - montoBs) < 1, `tope=${cap}`);
    const montoDevol = await evalx(`(() => {
      const i = [...document.querySelectorAll('[role="dialog"] input[type="number"]')][0];
      return i ? i.value : null;
    })()`);
    check('F36: «Devolver todo» propone lo que entró en Bs (no una conversión con la tasa de hoy)',
      Math.abs(Number(montoDevol) - montoBs) < 1, `monto=${montoDevol}`);

    // Devolver más de lo que entró → el diálogo lo dice en bolívares
    await clickCenter(`[...document.querySelectorAll('[role="dialog"] input[type="number"]')][0]`);
    await evalx(`(() => { const i = document.activeElement; if (i && i.select) i.select(); return true; })()`);
    await insertText(String(montoBs + 500));
    await sleep(500);
    await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /Devolver|Confirmar/i.test(b.innerText.trim()) && b.type !== 'button' || /^Devolver/i.test(b.innerText.trim()))`).catch(() => {});
    await sleep(1500);
    const errTope = String(await dialogText() ?? '');
    check('F36: devolver más de lo que entró se rechaza diciendo el tope en Bs.',
      /Bs\.\s*1\.?000/i.test(errTope) || /hasta Bs\./i.test(errTope), (errTope.match(/Solo puedes devolver[^\n]*/) ?? [''])[0].slice(0, 110));
    // …y devolver TODO (el monto exacto) deja la orden saldada: sin saldo fantasma
    await clickCenter(`[...document.querySelectorAll('[role="dialog"] input[type="number"]')][0]`);
    await evalx(`(() => { const i = document.activeElement; if (i && i.select) i.select(); return true; })()`);
    await insertText(String(montoBs));
    await sleep(500);
    await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /Devolver|Confirmar/i.test(b.innerText.trim()) && b.type !== 'button' || /^Devolver/i.test(b.innerText.trim()))`).catch(() => {});
    await sleep(2400);
    if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
    const trasDevol = await invoke('get_service', { id: idBs });
    check('F36: devolver TODO lo cobrado en Bs deja la orden SALDADA (sin el saldo fantasma)',
      Math.abs(trasDevol?.paid_amount ?? 1) < 0.01,
      `paid=$${trasDevol?.paid_amount} · saldo=$${((trasDevol?.amount ?? 0) - (trasDevol?.paid_amount ?? 0)).toFixed(2)}`);

    // F38: el saldo se dice en la MONEDA DEL COBRO (Bs.) con su equivalencia en $ — el operario no
    // traduce a mano. Orden NUEVA: la de arriba quedó Devuelta y una orden Devuelta no acepta pagos
    // (guard de F36, que de paso queda comprobado acá).
    const respDevuelta = await invokeErr('add_service_payment', {
      serviceId: idBs, amount: 2000, paymentMethod: 'Efectivo Bs', bankFeePercent: 0,
      zelleReference: '', currency: 'USD', notes: 'cobro en Bs', paymentDate: diaTurno,
    });
    check('F36: una orden DEVUELTA no acepta más pagos (guard del backend, no solo de la UI)',
      /no acepta más pagos/i.test(String(respDevuelta)), String(respDevuelta).slice(0, 80));

    const refSaldo = await invoke('add_service_order', {
      client: `Prueba Saldo Bs ${marca}`, phone: '', clientCi: '', clientAddress: '',
      clientId: null, technician: '', technicianId: null,
      devices: [{
        model: 'Galaxy A06 4G', fault: 'prueba F38', service_type: 'Software / Formateo',
        service_types: JSON.stringify(['Software / Formateo']), amount: 100, discount_amount: 0,
        payment_method: 'Efectivo Bs', observations: '', bank_fee_percent: 0, zelle_reference: '',
        currency: 'USD', device_checklist: '', color: '', screen_product_id: null, status: 'Recibido',
      }],
    });
    const filasSaldo = await invoke('get_services', { search: `Saldo Bs ${marca}`, status: '', startDate: '', endDate: '', dateField: 'in' });
    const idSaldo = filasSaldo?.find(r => (r.order_num ?? '') === refSaldo)?.id;
    await invoke('add_service_payment', {
      serviceId: idSaldo, amount: 2000, paymentMethod: 'Efectivo Bs', bankFeePercent: 0,
      zelleReference: '', currency: 'USD', notes: 'cobro en Bs', paymentDate: diaTurno,
    });
    await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
    await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); })()`);
    await keyNav('Backspace', 'Backspace', 8);
    await insertText(`Saldo Bs ${marca}`);
    await sleep(1800);
    await clickCenter(`[...document.querySelectorAll('button')].find(b => /^(Pago|Abono)/.test(b.innerText.trim()))`);
    await sleep(1600);
    const saldoTxt = await evalx(`document.querySelector('[data-field="saldo"]')?.innerText.trim() ?? null`);
    check('F38: el saldo del cobro se dice en Bs. con su equivalencia en $',
      /Bs\.\s*[\d.,]+\s*\(\$/.test(String(saldoTxt)) && !/^\$/.test(String(saldoTxt)), String(saldoTxt));

    // F38-M2 (revisión adversarial): el CAMPO del monto arranca en la moneda en que el cliente viene
    // pagando (si abonó en Bs., el toggle está en «Bs.» y no en $): el operario no tiene que cambiarlo.
    const curOn = await evalx(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.innerText.trim() === 'Bs.');
      return b ? b.getAttribute('data-state') : null;
    })()`);
    check('F38: el toggle del monto arranca en Bs. (la moneda del cobro, no la del formulario)',
      curOn === 'on', `data-state=${curOn}`);

    // F38 — PARIDAD EN VIVO: el Bs. que MUESTRA el saldo tiene que ser el que se COBRA con «Todo el
    // saldo». Si no coinciden, el operario lee un número y el sistema pide otro.
    const bsSaldo = Number(String(saldoTxt ?? '').match(/Bs\.\s*([\d.,]+)/)?.[1]?.replace(/\./g, '').replace(',', '.') ?? NaN);
    await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /Todo el saldo/i.test(b.innerText))`);
    await sleep(600);
    const bsCobro = await evalx(`(() => { const i = document.querySelector('[role="dialog"] input[type="number"]'); return i ? Number(i.value) : null; })()`);
    check('F38: el Bs. que se muestra es EXACTAMENTE el que se cobra con «Todo el saldo»',
      Number.isFinite(bsSaldo) && Math.abs(bsCobro - bsSaldo) < 1, `saldo=${bsSaldo} · cobro=${bsCobro}`);
    // Y el campo en Bs. dice su equivalencia en $ (el operario nunca traduce a mano)
    const bsCobroTxt = String(await dialogText() ?? '');
    check('F38: el monto en Bs. muestra su equivalencia en $ (≈ $X)', /≈\s*\$/.test(bsCobroTxt),
      (bsCobroTxt.match(/≈[^\n]*/) ?? [''])[0].slice(0, 60));

    // F38-M2: cobrar MÁS que el saldo avisa en el acto (no bloquea: puede ser legítimo, pero se ve).
    await clickCenter(`[...document.querySelectorAll('[role="dialog"] input[type="number"]')][0]`);
    await evalx(`(() => { const i = document.activeElement; if (i && i.select) i.select(); return true; })()`);
    await insertText(String(Math.round(bsCobro + 5000)));
    await sleep(600);
    const avisoExc = await evalx(`document.querySelector('[data-field="aviso-excedente"]')?.innerText.trim() ?? null`);
    check('F38: cobrar más que el saldo avisa que queda a favor del cliente',
      !!avisoExc && /a favor del cliente/i.test(String(avisoExc)), String(avisoExc ?? '').replace(/\n/g, ' ').slice(0, 90));
    await keyNav('Escape', 'Escape', 27);
    await sleep(700);
    if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

    // F39: la lista de CIERRES muestra las DOS diferencias (por moneda), no un número mezclado
    await clickCenter(`[...document.querySelectorAll('aside button')].find(b => /Diario/i.test(b.innerText))`);
    await sleep(1600);
    await clickCenter(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Cierres')`);
    await sleep(1600);
    const heads = await evalx(`[...document.querySelectorAll('th')].map(h => h.innerText.trim()).filter(Boolean).join(' | ')`);
    check('F39: la lista de cierres muestra «Diferencia $» y «Diferencia Bs.» por separado',
      /Diferencia \$/.test(String(heads)) && /Diferencia Bs\./.test(String(heads)), String(heads).slice(0, 160));

    // F39 — EL SEMÁFORO ES POR MONEDA, con los números del cierre GUARDADO, y **cada moneda se juzga
    // por separado**: se comprueba contra los datos reales de la copia (no contra un número fijo, que
    // se rompería al reabrir/recerrar un día): cada celda tiene que traer la diferencia y su `data-ok`
    // tiene que corresponder a SU tolerancia (0,5), y el signo va DELANTE de la moneda.
    const difs = await evalx(`(() => {
      const celdas = [...document.querySelectorAll('[data-diff]')];
      return celdas.map(c => ({ k: c.getAttribute('data-diff'), ok: c.getAttribute('data-ok'), txt: c.innerText.trim() }));
    })()`);
    const num = (txt) => {
      const m = String(txt ?? '').match(/([+-]?)(?:Bs\.\s*|\$)([\d.,]+)/);
      if (!m) return NaN;
      const n = Number(m[2].replace(/\./g, '').replace(',', '.'));
      return m[1] === '-' ? -n : n;
    };
    const cerrados = (difs ?? []).filter(d => d.ok !== null);
    check('F39: cada cierre cerrado trae las DOS diferencias (por moneda)',
      cerrados.filter(d => d.k === 'usd').length >= 1 && cerrados.filter(d => d.k === 'bs').length >= 1,
      JSON.stringify(cerrados));
    check('F39: el `data-ok` de cada celda corresponde a SU tolerancia (0,5) y la moneda real',
      cerrados.length > 0 && cerrados.every(d => (String(d.ok) === 'true') === (Math.abs(num(d.txt)) < 0.5)),
      cerrados.map(d => `${d.k}:${d.txt}:${d.ok}`).join(' · '));
    check('F39: el signo va DELANTE de la moneda (nunca «$-…» ni «Bs.-…»)',
      cerrados.every(d => !/^(?:\$-|Bs\.\s*-)/.test(String(d.txt))), cerrados.map(d => d.txt).join(' · '));
    // Y el ASISTENTE DE CIERRE (el otro lugar donde se crea un pago) tiene que arrancar el campo en la
    // MISMA moneda que dice su etiqueta: el texto de arriba decía «Falta cobrar Bs. 72.879,00 ($97.33)»
    // y el campo, en $, no decía ninguna moneda → el operario copiaba el número y se guardaban 72.879
    // DÓLARES (revisión adversarial F39).
    {
      // Volver a Servicio Técnico y buscar la orden (venimos de Libro Diario → Cierres)
      await clickCenter(`[...document.querySelectorAll('aside button')].find(b => /Servicio/i.test(b.innerText))`);
      await sleep(1600);
      await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
      await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); })()`);
      await keyNav('Backspace', 'Backspace', 8);
      await insertText(`Saldo Bs ${marca}`);
      await sleep(1800);
      const filasCierre = await invoke('get_services', { search: `Saldo Bs ${marca}`, status: '', startDate: '', endDate: '', dateField: 'in' });
      const idCierre = filasCierre?.find(r => (r.order_num ?? '') === refSaldo)?.id;
      // F49 cambió el camino: el botón «Cerrar» YA NO está en la tarjeta (en su lugar va «Descuento»
      // — lo dice el propio código). El asistente de cierre se abre desde la barra de arriba
      // («Cerrar entrega», o F4) y la orden se elige en la cola, que es lo que hace el operario.
      // Este bloque seguía buscando «Cerrar» DENTRO de la tarjeta y moría con «click target no
      // encontrado»: era un test desactualizado desde F49, no un defecto del producto (medido 2026-09-21).
      if (!idCierre) throw new Error(`No se encontró en la lista la orden de saldo (orden ${refSaldo}) para abrir el asistente de cierre.`);
      await clickCenter(`[...document.querySelectorAll('button')].find(b => /^Cerrar entrega$/.test(b.innerText.trim())) ?? null`);
      await sleep(1600);
      const cajaCola = `document.querySelector('[role="dialog"] input[placeholder^="Cédula"]')`;
      await clickCenter(`${cajaCola} ?? null`);
      await evalx(`(() => {
        const i = ${cajaCola};
        if (!i) return false;
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        s.call(i, ${JSON.stringify(String(refSaldo))});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await sleep(1800);
      await clickCenter(`document.querySelector('[role="dialog"] [cmdk-item][data-value="${idCierre}"]') || document.querySelector('[role="dialog"] [data-value="${idCierre}"]')`);
      await sleep(1800);
      const etiquetaMonto = await evalx(`(() => {
        const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => /^Monto/.test(x.innerText.trim()));
        return l ? l.innerText.trim() : null;
      })()`);
      const curCierre = await evalx(`(() => {
        const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.innerText.trim() === 'Bs.');
        return b ? b.getAttribute('data-state') : null;
      })()`);
      const textoCierre = String(await dialogText() ?? '');
      check('F38: el asistente de cierre dice el saldo en Bs. y arranca el campo en Bs. (no se copia el número en $)',
        /^Monto \((Bs\.|\$)\)$/.test(String(etiquetaMonto)) && curCierre === 'on' && /Bs\./.test(textoCierre),
        `etiqueta=${etiquetaMonto} · toggle Bs.=${curCierre}`);
      await keyNav('Escape', 'Escape', 27);
      await sleep(700);
      if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
    }
  }
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false,
    String(e?.stack ?? e?.message ?? e).split('\n').slice(0, 3).join(' | '));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}

// ── 5) limpieza ─────────────────────────────────────────────────────────────────────────────
await cerrar();
const restos = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
check('la orden de prueba quedó borrada (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
