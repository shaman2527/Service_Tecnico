// VERIFICACIÓN EN VIVO (CDP) de F77 — IMPRIMIR AL CERRAR EL REGISTRO + EL AVISO DE POLÍTICA EN GRANDE.
//
// Pedido del dueño (2026-09-25), textual: «quiero que en el wizard dejando las card con sus botones
// como están, pero cuando esté haciendo un registro tenga la opción de imprimir directamente en el
// proceso; si le doy clic a imprimir salga el mensaje que tenemos, o algo más en grande que diga
// *Toma la foto al teléfono*; y el mensaje del modal que pregunta si va a pagar ahora o al retirar que
// sea más grande; al final salga para imprimir con un check predeterminado que pregunte si va a
// imprimir o después — la idea es aprovechar el mismo proceso de wizard para cerrar el registro
// completo».
//
// Qué comprueba sobre la app REAL:
//   1. El bloque de imprimir vive SOLO en el último paso del wizard (no aparece en los pasos del medio).
//   2. El check «Imprimir la orden ahora» arranca MARCADO y el botón del paso dice «Guardar e imprimir».
//   3. Al guardar con el check marcado: la orden queda en la BASE **y se abre el comprobante** de ESA
//      orden (mismo número), por la misma vía que usan la tarjeta y el asistente de cierre.
//   4. Con el comprobante abierto el aviso de política NO se dibuja (regla de F54 intacta) y el clic
//      sobre el comprobante no cae en ningún velo.
//   5. Al cerrarlo aparece el aviso, con el TÍTULO grande (≥18 px, «Pregúntale al cliente» / «Toma la
//      foto al teléfono») y el MENSAJE grande (≥16 px) — el pedido «que sea más grande ese mensaje».
//   6. Sin el check (destildado): el botón vuelve a «Guardar Servicio», la orden se guarda igual y NO
//      se abre ningún comprobante.
//   7. La tarjeta conserva su botón de imprimir («Orden» / «Reimprimir»): las cards quedan como están.
//
// SEGURIDAD DE DATOS: escribe de verdad (es una prueba), así que:
//   · `REGISTRO_DB` es OBLIGATORIO (si falta, ABORTA: nunca se prueba contra la base del local);
//   · NO abre el día: si la copia no tiene turno abierto, ABORTA;
//   · las órdenes de prueba van con «Cambio batería» (SIN pantalla del catálogo → no mueve stock) y
//     con monto $0 (no toca la caja): esta prueba es de la IMPRESIÓN, no del cobro;
//   · al final BORRA sus órdenes y comprueba que no queden residuos.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f77_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_imprimir_en_wizard.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
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
/** Pone el valor de un input como lo haría el operario (setter nativo + evento input). */
const setValue = (sel, value) => evalx(`(() => {
  const i = document.querySelector(${JSON.stringify(sel)});
  if (!i) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
/** Botón del diálogo por texto exacto (con plan B: el clic del propio elemento). */
const clickDialogExact = async (label) => {
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').trim() === ${JSON.stringify(label)}) || null)`).catch(async () => {
    await evalx(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(label)});
      if (b) b.click();
      return !!b;
    })()`);
  });
};
/** Texto del botón principal del pie del wizard (el que guarda). */
const botonGuardar = () => evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^(Guardar|Actualizar)( |$)/.test((x.innerText || '').trim()));
  return b ? { label: (b.innerText || '').replace(/\\s+/g, ' ').trim(), disabled: b.disabled } : null;
})()`);
/** El check de F77 dentro del wizard. */
const checkImprimir = () => evalx(`(() => {
  const c = document.querySelector('[data-field="imprimir-al-guardar"]');
  return c ? { checked: !!c.checked, block: !!document.querySelector('[data-print-block="guardar"]') } : null;
})()`);
/** Tamaño computado + texto del cartel de política (F77: «más en grande»). */
const cartel = () => evalx(`(() => {
  const t = document.querySelector('[data-policy-title]');
  const m = document.querySelector('[data-policy-message]');
  const card = document.querySelector('[data-policy-modal]');
  if (!t || !m || !card) return null;
  const st = getComputedStyle(t);
  return {
    key: card.getAttribute('data-reminder'),
    title: t.innerText.replace(/\\s+/g, ' ').trim(),
    message: m.innerText.replace(/\\s+/g, ' ').trim(),
    titlePx: parseFloat(st.fontSize),
    messagePx: parseFloat(getComputedStyle(m).fontSize),
    weight: st.fontWeight,
    ancho: card.getBoundingClientRect().width,
  };
})()`);
/** Cierra el aviso de política con «Después» (no anota nada), como el operario apurado. */
const posponerAviso = async () => {
  if (!(await evalx(`!!document.querySelector('[data-policy-modal]')`))) return false;
  await clickCenter(`document.querySelector('[data-policy-later]')`).catch(async () => {
    await evalx(`(() => { const b = document.querySelector('[data-policy-later]'); if (b) b.click(); return !!b; })()`);
  });
  return waitFor(`!document.querySelector('[data-policy-modal]')`, 6000);
};
/** Cierra TODOS los avisos pendientes (deja la pantalla limpia para el paso siguiente). */
const limpiarAvisos = async () => { for (let i = 0; i < 4; i++) { if (!(await posponerAviso())) break; } };

// ── 0) GATE DE DATOS: copia obligatoria + día abierto ────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  console.error('  Ej.: node tools/copy_db.mjs registro.db backup/f77_verif.db  y arrancar con $env:REGISTRO_DB a esa copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch (e) { return { err: String(e.message) }; } };
const enBase = (marca) => uno('SELECT id, order_num, client, model, amount, status, photo_in_at, pay_intent FROM services WHERE client LIKE ?1', `%${marca}%`);
const servicios = () => Number(uno('SELECT COUNT(*) AS n FROM services').n ?? -1);
const ordenesAntes = servicios();
console.log(`· copia: ${dbPath} · ${ordenesAntes} órdenes`);

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
if (!dia) {
  console.log('ABORTADO: la copia no tiene día abierto (esta prueba NO abre el turno del local).');
  process.exit(2);
}
console.log(`· día abierto (${dia.close_date ?? 'hoy'})`);

const MODELO = (await invoke('get_phone_models', { search: '', limit: 60 }).catch(() => []))?.[0]?.label ?? null;
check('hay un modelo del padrón para el equipo de prueba', !!MODELO, String(MODELO));
if (!MODELO) process.exit(1);

const marca = String(Date.now()).slice(-6);
const marcaB = String(Number(marca) + 7).slice(-6);
const PREFIJO = `Prueba F77 ${marca}`;
const PREFIJO_B = `Prueba F77B ${marcaB}`;
let idA = null, idB = null;

/** Elige el color del equipo con el TECLADO (el color es obligatorio; nunca Escape: cerraría el wizard). */
const elegirColor = async (nombre) => {
  await evalx(`(() => { const t = document.querySelector('[data-ficha-target="color"]'); if (t) t.focus(); return !!t; })()`);
  await keyNav('Enter', 'Enter', 13);
  await sleep(700);
  for (let i = 0; i < 14; i++) {
    const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
    if (String(hi).includes(nombre)) { await keyNav('Enter', 'Enter', 13); await sleep(800); return true; }
    await keyNav('ArrowDown', 'ArrowDown', 40);
    await sleep(200);
  }
  return false;
};

/** Chip de trabajo: se deja como se pide (SÍ/NO) con clic real y, si la geometría no ayuda, sintético. */
const chipOn = (label) => evalx(`(([...document.querySelectorAll('[role="dialog"] button')]
  .find(b => (b.innerText || '').trim() === ${JSON.stringify(label)})?.className || '') + '').includes('bg-primary')`);
const setTrabajo = async (label, on) => {
  for (let i = 0; i < 4; i++) {
    if ((await chipOn(label)) === on) return true;
    await clickDialogExact(label).catch(() => {});
    await sleep(600);
    if ((await chipOn(label)) !== on) {
      await evalx(`(() => {
        const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(label)});
        if (b) b.click();
        return !!b;
      })()`);
    }
    await sleep(600);
    if ((await chipOn(label)) === on) return true;
  }
  return (await chipOn(label)) === on;
};

/** Abre el wizard desde Servicio Técnico y lo llena hasta el ÚLTIMO paso (sin guardar). */
const prepararRecepcion = async (nombre, ci) => {
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
  await sleep(1800);
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) || null)`);
  const abrio = await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
  if (!abrio) return false;
  // El bloque de imprimir NO está en el primer paso (vive al FINAL del wizard).
  const enPrimero = await evalx(`!!document.querySelector('[data-print-block="guardar"]')`);
  check(`F77: el bloque de imprimir NO está en el paso Cliente (${nombre})`, enPrimero === false);
  await setValue('[role="dialog"] input[placeholder^="Buscar por nombre o cédula"]', nombre);
  await sleep(300);
  await setValue('[role="dialog"] input[placeholder="V-12345678"]', `V-9${ci}`);
  await sleep(600);
  await clickDialogExact('Siguiente');
  await sleep(1000);
  // ── F77b — EL PAGO SE PREGUNTA ANTES DEL MODELO (pedido del dueño: «el método de pago, el mensaje
  //    debería preguntarlo antes, en el paso 2 «Equipo», antes de colocar el modelo de teléfono, así le
  //    avisa para colocar el monto o un producto en ese momento»).
  const orden = await evalx(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const pago = dlg?.querySelector('[data-policy-block="pago"]');
    const metodo = dlg?.querySelector('[data-device-pay]');
    const modelo = dlg?.querySelector('input[placeholder^="Buscar el modelo del teléfono"]');
    if (!pago || !metodo || !modelo) return { hayPago: !!pago, hayMetodo: !!metodo, hayModelo: !!modelo };
    const top = (e) => e.getBoundingClientRect().top;
    return {
      hayPago: true, hayMetodo: true, hayModelo: true,
      pagoAntesDelModelo: top(pago) < top(modelo),
      metodoAntesDelModelo: top(metodo) < top(modelo),
      avisoMonto: !!dlg.querySelector('[data-pay-early-hint]'),
    };
  })()`);
  check(`F77b: en el paso «Equipos» está la pregunta del pago (${nombre})`, orden?.hayPago === true, JSON.stringify(orden));
  check(`F77b: la pregunta del pago va ANTES del modelo del teléfono (${nombre})`,
    orden?.pagoAntesDelModelo === true, `top pago<modelo: ${orden?.pagoAntesDelModelo}`);
  check(`F77b: el MÉTODO DE PAGO del equipo también va antes del modelo (${nombre})`,
    orden?.metodoAntesDelModelo === true, `top método<modelo: ${orden?.metodoAntesDelModelo}`);
  check(`F77b: el aviso dice que el monto y el producto se cargan en ese momento (${nombre})`,
    orden?.avisoMonto === true);
  // Equipo: modelo del padrón, trabajo «Cambio batería» (sin pantalla del catálogo → no mueve stock)
  await setValue('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]', MODELO);
  await waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => (b.innerText || '').replace(/\\s+/g,' ').trim().startsWith(${JSON.stringify(MODELO)}) && !/^Pantalla /.test((b.innerText || '').trim()))`, 10000);
  await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => {
      const t = (x.innerText || '').replace(/\\s+/g, ' ').trim();
      return t.startsWith(${JSON.stringify(MODELO)}) && !/^Pantalla /.test(t);
    });
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(800);
  await setTrabajo('Cambio batería', true);
  await setTrabajo('Cambio pantalla', false);
  await sleep(400);
  const colorOk = await elegirColor('Azul');
  check(`F77: el equipo de prueba queda con color (${nombre})`, colorOk);
  await clickDialogExact('Siguiente');   // Blindaje
  await sleep(900);
  await clickDialogExact('Siguiente');   // último paso (Revisar)
  await sleep(1000);
  // F77b: la pregunta del pago NO se repite en el último paso (se hace una sola vez, en «Equipos»).
  const repetido = await evalx(`!!document.querySelector('[role="dialog"] [data-policy-block="pago"]')`);
  check(`F77b: el último paso NO vuelve a preguntar el pago (${nombre})`, repetido === false, `repetido=${repetido}`);
  return /Paso 4 de 4/.test(String(await dialogTxt()));
};

try {
  // ── 1) CASO A: el check viene MARCADO → guardar e imprimir ─────────────────────────────────
  check('F77: el wizard llega al último paso con la recepción armada', await prepararRecepcion(PREFIJO, marca));
  const bloque = await checkImprimir();
  check('F77: el último paso trae el bloque «Imprimir la orden ahora»', !!bloque?.block, JSON.stringify(bloque));
  check('F77: el check arranca PREDETERMINADO (marcado)', bloque?.checked === true, `checked=${bloque?.checked}`);
  const botonA = await botonGuardar();
  check('F77: con el check marcado el botón dice «Guardar e imprimir»',
    /^Guardar e imprimir/.test(String(botonA?.label)), String(botonA?.label));
  check('F77: el botón está HABILITADO (el check no bloquea nada)', botonA?.disabled === false);

  await clickDialogExact('Guardar e imprimir');
  const cerroA = await waitFor(`!((document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Servicio Técnico'))`, 15000);
  const fila = enBase(marca);
  idA = fila?.id ?? null;
  check('F77: la orden se guardó de verdad al cerrar el registro', !!idA && Number(fila?.amount ?? -1) === 0,
    idA ? `${fila.order_num} · ${fila.client} · $${fila.amount}` : `no se creó (cerró=${cerroA})`);

  // El COMPROBANTE se abre solo (vista previa: el papel sale con su botón «Imprimir»).
  const factura = await waitFor(`/Orden de servicio/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 15000);
  const textoFactura = String(await dialogTxt());
  check('F77: al guardar se abre el COMPROBANTE de la orden (mismo número de orden)', factura && textoFactura.includes(String(fila?.order_num)),
    factura ? (textoFactura.match(/Orden de servicio[^\n]*/) ?? [''])[0] : 'no se abrió');

  // F54 sigue intacto: con el comprobante abierto el aviso NO se dibuja (y no hay velo que coma clics).
  await sleep(1200);
  const avisoTapando = await evalx(`JSON.stringify({
    modal: !!document.querySelector('[data-policy-modal]'),
    velo: !!document.querySelector('[data-policy-overlay]'),
  })`);
  check('F54: con el comprobante abierto el aviso NO se dibuja (espera en la cola)', avisoTapando === JSON.stringify({ modal: false, velo: false }), String(avisoTapando));

  // Al cerrar el comprobante aparece el aviso: primero la PREGUNTA DEL PAGO (orden del mostrador).
  await keyNav('Escape', 'Escape', 27);
  const aparecio = await waitFor(`!!document.querySelector('[data-policy-modal]')`, 10000);
  const primero = await cartel();
  check('F77: al cerrar el comprobante sale el aviso de política', aparecio, JSON.stringify(primero));
  if (primero) {
    check('F77: el primer aviso es la pregunta del PAGO, con su mensaje de siempre',
      primero.key === 'pay_intent' && /pagar ahora o al retirar/i.test(primero.message), `${primero.key}: ${primero.message}`);
    check('F77: el TÍTULO del aviso se lee de lejos (≥18 px y negrita)',
      primero.titlePx >= 18 && Number(primero.weight) >= 700, `${primero.titlePx}px · peso ${primero.weight}`);
    check('F77: el MENSAJE del aviso también es grande (≥16 px)',
      primero.messagePx >= 16, `${primero.messagePx}px`);
    check('F77: la tarjeta es más ancha (cartel, ≥ 400 px)', primero.ancho >= 400, `${Math.round(primero.ancho)}px`);
  }
  await posponerAviso();
  const segundo = await cartel();
  check('F77: después sale el aviso de la FOTO, con el título «Toma la foto al teléfono»',
    segundo?.key === 'photo_in' && /toma la foto al tel[eé]fono/i.test(String(segundo?.title)), JSON.stringify(segundo));
  check('F77: el cartel de la foto también es grande (≥18/≥16 px)',
    (segundo?.titlePx ?? 0) >= 18 && (segundo?.messagePx ?? 0) >= 16,
    `${segundo?.titlePx}px / ${segundo?.messagePx}px`);
  await limpiarAvisos();
  const limpio = await evalx(`!document.querySelector('[data-policy-modal]')`);
  check('F77: los avisos se cierran sin anotar nada (y no se apilan)', limpio);

  // ── 2) CASO B: el check DESTILDADO → guardar sin comprobante ───────────────────────────────
  check('F77: el wizard vuelve a abrir para el segundo registro', await prepararRecepcion(PREFIJO_B, marcaB));
  const bloqueB = await checkImprimir();
  check('F77: el check vuelve a nacer marcado en cada recepción (no se recuerda el destilde)',
    bloqueB?.checked === true, `checked=${bloqueB?.checked}`);
  await evalx(`(() => {
    const c = document.querySelector('[data-field="imprimir-al-guardar"]');
    if (c && c.checked) c.click();
    return c ? c.checked : null;
  })()`);
  await sleep(500);
  const destildado = await checkImprimir();
  check('F77: el check se puede destildar (imprimir después)', destildado?.checked === false, `checked=${destildado?.checked}`);
  const botonB = await botonGuardar();
  check('F77: destildado, el botón vuelve a «Guardar Servicio» (no miente)',
    /^Guardar Servicio/.test(String(botonB?.label)), String(botonB?.label));

  await clickDialogExact(botonB?.label ?? 'Guardar Servicio');
  const cerroB = await waitFor(`!((document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Servicio Técnico'))`, 15000);
  await sleep(2000);
  const filaB = enBase(marcaB);
  idB = filaB?.id ?? null;
  check('F77: sin el check la orden se guarda igual (nada la bloquea)', !!idB, idB ? `${filaB.order_num} · ${filaB.client}` : `no se creó (cerró=${cerroB})`);
  const sinFactura = await evalx(`!/Orden de servicio/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`);
  check('F77: sin el check NO se abre ningún comprobante (imprime después desde la tarjeta)',
    sinFactura, String(await evalx(`document.querySelector('[role="dialog"]')?.innerText?.split('\\n')?.[0] ?? null`)));
  await limpiarAvisos();

  // ── 3) LAS CARDS QUEDAN COMO ESTÁN: la tarjeta conserva su botón de imprimir ────────────────
  await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); return true; })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await evalx(`(() => {
    const i = document.querySelector('input[placeholder*="Buscar" i]');
    if (!i) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, ${JSON.stringify(marcaB)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(2000);
  const botonTarjeta = await evalx(`[...document.querySelectorAll('button')].some(b => /^(Orden|Reimprimir)$/.test((b.innerText || '').trim()))`);
  check('F77: la tarjeta conserva su botón de imprimir («Orden» / «Reimprimir»)', botonTarjeta === true);

  // ── 4) EN EDICIÓN el mismo orden (F77b vale para el alta Y para la edición) ──────────────────
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Editar$/.test((b.innerText || '').trim())) || null)`).catch(async () => {
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Editar$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
  });
  // OJO: en EDICIÓN el diálogo se titula «Editar <orden>» (no «Nuevo Servicio Técnico»).
  const abrioEdicion = await waitFor(`/^(Editar|Nuevo Servicio Técnico)/m.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 12000);
  check('F77: la orden se puede abrir en EDICIÓN para revisar el mismo orden del pago', abrioEdicion);
  if (abrioEdicion) {
    await clickDialogExact('Siguiente');   // del paso Cliente al paso del EQUIPO
    await sleep(1000);
    const enEquipo = await waitFor(`!!document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')`, 10000);
    const ordenEdit = await evalx(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const pago = dlg?.querySelector('[data-policy-block="pago"]');
      const metodo = dlg?.querySelector('[data-device-pay="edit"]');
      const modelo = dlg?.querySelector('input[placeholder^="Buscar el modelo del teléfono"]');
      if (!pago || !metodo || !modelo) return { hayPago: !!pago, hayMetodo: !!metodo, hayModelo: !!modelo };
      const top = (e) => e.getBoundingClientRect().top;
      return { hayPago: true, hayMetodo: true, hayModelo: true, pagoAntesDelModelo: top(pago) < top(modelo), metodoAntesDelModelo: top(metodo) < top(modelo) };
    })()`);
    check('F77b (edición): el paso del equipo trae la pregunta del pago y el MÉTODO DE PAGO', enEquipo && ordenEdit?.hayPago === true && ordenEdit?.hayMetodo === true, JSON.stringify(ordenEdit));
    check('F77b (edición): los dos van ANTES del modelo del teléfono',
      ordenEdit?.pagoAntesDelModelo === true && ordenEdit?.metodoAntesDelModelo === true,
      `pago<modelo=${ordenEdit?.pagoAntesDelModelo} · método<modelo=${ordenEdit?.metodoAntesDelModelo}`);
    // El paso «Finanzas» ya NO tiene el método de pago (se mudó al paso del equipo) pero SÍ el estado.
    // Se avanza ESPERANDO LA CONDICIÓN (el número de paso del stepper), no contando clics a ojo.
    const pasoActual = async () => Number(String(await dialogTxt() ?? '').match(/Paso (\d+) de (\d+)/)?.[1] ?? 0);
    for (let i = 0; i < 5 && (await pasoActual()) < 4; i++) {
      await clickDialogExact('Siguiente');
      await sleep(1000);
    }
    const finanzas = await evalx(`(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const txt = dlg?.innerText ?? '';
      return {
        paso: (txt.match(/Paso \\d+ de \\d+/) ?? [''])[0],
        titulo: /finanzas y estado/i.test(txt),
        metodo: !!dlg?.querySelector('[data-device-pay="edit"]'),
        estado: [...(dlg?.querySelectorAll('label') ?? [])].some(l => /^estado$/i.test((l.innerText || '').trim())),
      };
    })()`);
    check('F77b (edición): «Finanzas» queda con el ESTADO y sin el método de pago (no está duplicado)',
      finanzas?.titulo === true && finanzas?.estado === true && finanzas?.metodo === false, JSON.stringify(finanzas));
    await keyNav('Escape', 'Escape', 27);
    await sleep(800);
    if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
  }
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}

// ── 4) LIMPIEZA ─────────────────────────────────────────────────────────────────────────────
for (const id of [idA, idB]) {
  if (id) await invoke('delete_service', { id }).catch(e => check(`borrar la orden ${id}`, false, String(e)));
}
for (let i = 0; i < 3; i++) {
  const sobran = await invoke('get_services', { search: '', status: '', startDate: '', endDate: '', dateField: 'in' })
    .then(rs => (rs ?? []).filter(r => /Prueba F77/i.test(r.client ?? ''))).catch(() => []);
  if (!Array.isArray(sobran) || sobran.length === 0) break;
  for (const r of sobran) await invoke('delete_service', { id: r.id }).catch(() => {});
}
const restos = await invoke('get_services', { search: '', status: '', startDate: '', endDate: '', dateField: 'in' })
  .then(rs => (rs ?? []).filter(r => /Prueba F77/i.test(r.client ?? ''))).catch(() => null);
check('las órdenes de prueba quedaron borradas (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);
const ordenesDespues = servicios();
check('la base queda con las mismas órdenes que al empezar', ordenesDespues === ordenesAntes, `${ordenesAntes} → ${ordenesDespues}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
