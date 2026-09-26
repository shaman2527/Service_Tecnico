// VERIFICACIÓN EN VIVO (CDP) de F47 — pantalla AGOTADA: aviso en ROJO, predeterminado y SIN bloquear.
//
// Pedido del dueño (2026-09-20): «esto también dejarlo predeterminado, que no te bloquee pero sí deje
// el mensaje en rojo: *Esa pantalla no tiene stock* / *Si se entrega igual, el inventario de «Apple
// 5G» queda en -1 y el movimiento se marca como faltante*».
//
// Qué comprueba sobre la app REAL:
//   1. Al elegir una pantalla AGOTADA aparece el aviso **en rojo** con esa explicación (stock que
//      queda y movimiento marcado como faltante).
//   2. La confirmación «se entregó sin stock registrado» viene **MARCADA por defecto** (el operario
//      no tiene que tocar nada).
//   3. **No bloquea**: con la orden en «Entregado» y esa pantalla agotada, el botón de guardar está
//      HABILITADO (antes había que confirmar para poder guardar).
//   4. El gate que SÍ sigue: sin elegir pantalla (habiendo opciones en el catálogo) el guardar queda
//      bloqueado — el inventario no puede bajar del repuesto equivocado.
//
// SEGURIDAD DE DATOS: **no se guarda nada** (solo se lee el estado del botón), así que el inventario
// no se mueve; la orden de prueba se crea con monto $0 y se BORRA al final. Requiere `REGISTRO_DB`
// apuntando a una copia y un día abierto (no lo abre).
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f47_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       (lanzar la app)  →  node tools/verify_pantalla_agotada.mjs

import { evalx, clickCenter, keyNav, insertText, sleep } from './cdp_driver.mjs';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const dialogTxt = () => evalx(`(document.querySelector('[role="dialog"]')?.innerText) ?? null`);

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};

// ── 0) GATES ────────────────────────────────────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
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
  await sleep(500);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

const dia = await invoke('get_active_day').catch(() => null);
if (!dia) { console.log('ABORTADO: la copia no tiene día abierto (esta prueba NO abre el turno del local).'); process.exit(2); }
console.log(`· copia: ${dbPath} · día abierto (${dia.close_date ?? 'hoy'})`);

// ── 1) buscar un modelo con una pantalla AGOTADA compatible ─────────────────────────────────
const modelos = await invoke('get_phone_models', { search: '', limit: 60 }).catch(() => []);
let elegido = null;
for (const m of (modelos ?? []).slice(0, 40)) {
  const cands = await invoke('find_compatible_screens', { model: m.label, limit: 25 }).catch(() => null);
  const agotada = (cands ?? []).find(c => !c.in_stock && c.brand_match !== false);
  if (agotada) { elegido = { modelo: m.label, pantalla: agotada }; break; }
}
check('hay un modelo con una pantalla AGOTADA compatible (para probar el aviso)',
  !!elegido, elegido ? `${elegido.modelo} → ${elegido.pantalla.product.name} (stock ${elegido.pantalla.product.stock})` : 'ninguno en esta copia');
if (!elegido) { console.error('Sin pantalla agotada no se puede probar esta regla: probá con otra copia.'); process.exit(2); }

const marca = String(Date.now()).slice(-6);
let id = null;
try {
  const num = await invoke('add_service_order', {
    client: `Prueba Agotada ${marca}`, phone: '', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null,
    devices: [{
      model: elegido.modelo, color: '', fault: `prueba F47 ${marca}`, service_type: 'Cambio pantalla',
      service_types: JSON.stringify(['Cambio pantalla']), amount: 0, discount_amount: 0,
      payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
      currency: 'USD', device_checklist: '', screen_product_id: elegido.pantalla.product.id, status: 'Recibido',
    }],
  });
  const filas = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
  id = (filas ?? []).find(r => (r.order_num ?? '') === num)?.id ?? null;
  check('se preparó la orden de prueba con la pantalla agotada', !!id, `orden ${num} · id ${id}`);
  if (!id) throw new Error('no se creó la orden de prueba');

  // ── 2) el formulario (edición): el aviso rojo vive en el paso «Equipo» ──────────────────────
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
  await sleep(1800);
  await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); return true; })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await insertText(marca);
  await waitFor(`!!document.querySelector('[data-tech-quick="${id}"]')`, 12000);
  await sleep(600);
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Editar$/.test(b.innerText.trim())) || null)`);
  await sleep(2200);

  const irAPaso = async (nombre) => {
    for (let i = 0; i < 5; i++) {
      const paso = await evalx(`(document.querySelector('[role="dialog"]')?.innerText ?? '').match(/Paso \\d+ de \\d+ · ([^\\n·]+)/)?.[1]?.trim() ?? null`);
      if (String(paso).includes(nombre)) return true;
      await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Siguiente$/.test(b.innerText.trim())) || null)`).catch(() => {});
      await sleep(1000);
    }
    return false;
  };
  check('el wizard de edición llega al paso «Equipo»', await irAPaso('Equipo'),
    (String(await dialogTxt()).match(/Paso \d+ de \d+[^\n]*/) || [''])[0]);

  // El aviso ROJO (pedido textual del dueño) con lo que va a pasar con el inventario
  const avisoRojo = await evalx(`(() => {
    const el = [...document.querySelectorAll('[role="dialog"] .text-destructive')].find(e => /no tiene stock/i.test(e.innerText || ''));
    return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
  })()`);
  check('F47: el aviso de la pantalla agotada se ve con el texto del inventario',
    /Esa pantalla no tiene stock/i.test(String(avisoRojo)) && /queda en -?\d+/.test(String(avisoRojo)) && /faltante/i.test(String(avisoRojo)),
    String(avisoRojo).slice(0, 170));
  const esRojo = await evalx(`(() => {
    const el = [...document.querySelectorAll('[role="dialog"] .text-destructive')].find(e => /no tiene stock/i.test(e.innerText || ''));
    return el ? getComputedStyle(el).color : null;
  })()`);
  check('F47: el aviso está pintado en ROJO (clase destructive del sistema)', /oklch|rgb/.test(String(esRojo)), String(esRojo));

  const confirmacion = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /entregó sin stock/i.test(x.innerText || ''));
    return b ? b.innerText.replace(/\\s+/g, ' ').trim() : null;
  })()`);
  check('F47: la confirmación viene MARCADA por defecto (✓ Confirmado…)',
    /✓\s*Confirmado/i.test(String(confirmacion)), String(confirmacion));

  // F48 (en datos viejos): esta orden nació sin color, así que el paso «Equipo» queda bloqueado hasta
  // elegirlo — el color es obligatorio también al editar. El aviso de la pantalla agotada, en cambio,
  // NO bloquea: se ve y se sigue.
  const siguienteBloq = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim()));
    return b ? b.disabled : null;
  })()`);
  check('F48: una orden sin color no avanza hasta elegirlo (requerido también al editar)', siguienteBloq === true, `disabled=${siguienteBloq}`);
  const eligioColor = await (async () => {
    await clickCenter(`document.querySelector('[data-ficha-target="color"]')`);
    await sleep(600);
    for (let i = 0; i < 16; i++) {
      const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
      if (String(hi).includes('Azul')) { await keyNav('Enter', 'Enter', 13); await sleep(900); return true; }
      await keyNav('ArrowDown', 'ArrowDown', 40);
      await sleep(220);
    }
    await keyNav('Escape', 'Escape', 27);
    return false;
  })();
  const siguienteOk = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim()));
    return b ? !b.disabled : null;
  })()`);
  check('F48: al elegir el color el paso se habilita', eligioColor && siguienteOk === true, `color=${eligioColor} · habilitado=${siguienteOk}`);

  // ── 3) NO bloquea: con la orden en «Entregado» y la pantalla agotada, se puede guardar ──────
  check('el wizard llega al paso «Finanzas» (ahí está el estado de la orden)', await irAPaso('Finanzas'), String(await dialogTxt()).slice(0, 60));
  const eligioEstado = await (async () => {
    await clickCenter(`(() => {
      const sel = [...document.querySelectorAll('[role="dialog"] [role="combobox"]')].find(b => /Recibido|Entregado|Por entregar|En reparación|Reparado|Esperando/.test(b.innerText || ''));
      return sel;
    })()`);
    await sleep(700);
    for (const [key, vk] of [['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40]]) {
      await keyNav(key, key, vk);
      await sleep(250);
      const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
      if (/^Entregado$/.test(String(hi))) { await keyNav('Enter', 'Enter', 13); await sleep(1200); return true; }
    }
    await keyNav('Escape', 'Escape', 27);
    return false;
  })();
  check('la orden queda en estado «Entregado» en el formulario (el caso que antes bloqueaba)', eligioEstado);

  check('el wizard llega al paso «Cierre»', await irAPaso('Cierre'), String(await dialogTxt()).slice(0, 60));
  // F77: el rótulo del botón del último paso ahora depende del check «Imprimir la orden ahora»
  // («Actualizar Servicio» / «Actualizar e imprimir»): se aceptan los dos (esta prueba NO guarda).
  const guardar = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Actualizar (Servicio|e imprimir)$/.test((x.innerText || '').trim()));
    return b ? !b.disabled : null;
  })()`);
  check('F47: «Actualizar Servicio» está HABILITADO con la pantalla agotada (el aviso NO bloquea)',
    guardar === true, `habilitado=${guardar}`);
  const diceFalta = await evalx(`/Falta:[^\\n]*pantalla/i.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`);
  check('F47: el resumen del paso NO pide confirmar la pantalla agotada', diceFalta === false, `pide=${diceFalta}`);

  const conPantalla = await invoke('get_service', { id });
  check('F47: la orden de prueba guardó la pantalla exacta (su inventario es trazable)',
    String(conPantalla?.screen_product_id) === String(elegido.pantalla.product.id),
    `screen_product_id=${conPantalla?.screen_product_id}`);
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}

// ── 4) LIMPIEZA (no se guardó nada: el inventario no se movió) ───────────────────────────────
if (id) await invoke('delete_service', { id }).catch(e => check(`borrar la orden ${id}`, false, String(e)));
for (let i = 0; i < 3; i++) {
  const sobran = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
  if (!Array.isArray(sobran) || sobran.length === 0) break;
  for (const r of sobran) await invoke('delete_service', { id: r.id }).catch(() => {});
}
const restos = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => null);
check('las órdenes de prueba quedaron borradas (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);
const stockAhora = (await invoke('get_products', { search: elegido.pantalla.product.name, categoryId: 1 }).catch(() => []))
  ?.find(p => p.id === elegido.pantalla.product.id)?.stock;
check('el stock de la pantalla agotada NO se movió (la prueba no guarda la entrega)',
  Number(stockAhora) === Number(elegido.pantalla.product.stock), `${elegido.pantalla.product.stock} → ${stockAhora}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
