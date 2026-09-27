// VERIFICACIÓN EN VIVO (CDP) de F79 — COBRAR DENTRO DEL WIZARD (2026-09-26).
//
// Pedido del dueño, textual: «El botón de pago en servicio también que aparezca en el wizard, que en
// el mismo wizard podamos cobrar sin problema. Lo está viendo en la parte número 2 del wizard, en
// Equipo. Logró meter el botón profesionalmente en el flujo cuando se está creando el servicio al
// cliente: hay un espacio al lado del color de equipo, meterlo ahí. Pero si revisa arriba te sale
// método de pago también: esté todo bien ordenado, óptimo, no sea confuso. Para poder cobrar al
// cliente, seguir el proceso del wizard. Y dejamos la misma opción como la tenemos actualmente.»
//
// Qué comprueba sobre la app REAL:
//   1. El botón de cobro VIVE EN EL PASO 2, en el bloque del COLOR del equipo (no en otro lado y no
//      duplicando la pregunta del método de pago, que sigue arriba en `data-device-pay`).
//   2. En el ALTA el botón dice el monto de ESE equipo («Cobrar $30.00») y antes de la orden no
//      inventa ningún estado de dinero.
//   3. Al tocarlo SIN los datos → avisa qué falta y NO guarda nada (0 órdenes nuevas en la base).
//   4. Con los datos → GUARDA la orden (en la base, con su número) y abre EL MISMO diálogo
//      «Pago / Abono» de la tarjeta, con el método que se eligió en el equipo.
//   5. El registro SIGUE: el wizard no se cierra, aparece el aviso con el número real, el pie dice
//      «Cerrar» (no «Cancelar») y el estado junto al botón cuenta el saldo real.
//   6. Se cobra $1 de verdad desde ese diálogo: el pago queda en la BASE, el wizard sigue y el paso 2
//      muestra «Cobrado $1.00 · saldo $29.00».
//   7. Se sigue el proceso del wizard (Blindaje → Revisar) y el «Guardar» final (que ahora dice
//      «Actualizar orden») **NO duplica** la orden: sigue habiendo UNA sola fila, con lo que se
//      corrigió después del cobro (monto 30 → 40) y el abono intacto.
//   8. EN EDICIÓN el mismo botón aparece al lado del color, dice «Cobrar / Abono», muestra el saldo
//      guardado y abre el mismo diálogo sin guardar nada.
//   9. La opción de SIEMPRE sigue igual: la tarjeta conserva su botón «Pago / Abono».
//
// SEGURIDAD DE DATOS: escribe de verdad (es una prueba), así que:
//   · `REGISTRO_DB` es OBLIGATORIO (si falta, ABORTA: nunca se prueba contra la base del local);
//   · NO abre el día ni toca la tasa: si la copia no tiene turno abierto, ABORTA;
//   · el equipo de prueba va con «Cambio batería» (SIN pantalla del catálogo → no mueve stock);
//   · el cobro de prueba es de $1 (queda en la caja de la COPIA) y al final BORRA sus órdenes (con
//     sus pagos y su contra-asiento) y el cliente de prueba.
//
// Uso:  $env:REGISTRO_DB="C:\...\dev_registro.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   (app abierta)
//       node tools/verify_cobro_en_wizard.mjs

import { evalx, clickCenter, keyNav, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const dialogTxt = () => evalx(`(document.querySelector('[role="dialog"]')?.innerText) ?? null`);
/** Texto del ÚLTIMO diálogo abierto: el de cobro se apila SOBRE el wizard (dos [role="dialog"]). */
const txtPago = () => evalx(`(([...document.querySelectorAll('[role="dialog"]')].pop())?.innerText) ?? null`);
const nDialogos = () => evalx(`document.querySelectorAll('[role="dialog"]').length`);
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const setValue = (sel, value) => evalx(`(() => {
  const i = document.querySelector(${JSON.stringify(sel)});
  if (!i) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(String(value))});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const clickDialogExact = async (label) => {
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').trim() === ${JSON.stringify(label)}) || null)`).catch(async () => {
    await evalx(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(label)});
      if (b) b.click();
      return !!b;
    })()`);
  });
};
/** El botón de cobro de F79: etiqueta, modo, estado del dinero y aviso. */
const cobro = () => evalx(`(() => {
  const b = document.querySelector('[role="dialog"] [data-action="cobrar-equipo"]');
  if (!b) return null;
  const caja = b.closest('[data-cobro-wizard]');
  const est = caja?.querySelector('[data-cobro-estado]');
  const avi = caja?.querySelector('[data-cobro-aviso]');
  return {
    modo: caja?.getAttribute('data-cobro-wizard') ?? null,
    label: (b.innerText || '').replace(/\\s+/g, ' ').trim(),
    disabled: b.disabled,
    estado: est ? (est.innerText || '').replace(/\\s+/g, ' ').trim() : null,
    tono: est?.getAttribute('data-cobro-estado') ?? null,
    aviso: avi ? (avi.innerText || '').replace(/\\s+/g, ' ').trim() : null,
    // «no confuso»: la caja de cobro NO tiene selector de método ni chips (eso vive arriba).
    controles: caja ? caja.querySelectorAll('button, [role="combobox"], select').length : -1,
    enTarjetaDelEquipo: !!b.closest('[data-device]'),
  };
})()`);
/** ¿El botón está en el MISMO bloque que el select de color (el espacio que pidió el dueño)? */
const juntoAlColor = () => evalx(`(() => {
  const dev = document.querySelector('[role="dialog"] [data-device="0"]') || document.querySelector('[role="dialog"]');
  const caja = dev?.querySelector('[data-cobro-wizard]');
  const color = dev?.querySelector('[data-ficha-target="color"]');
  if (!caja || !color) return { hayCaja: !!caja, hayColor: !!color };
  const r1 = caja.getBoundingClientRect(), r2 = color.getBoundingClientRect();
  return {
    hayCaja: true, hayColor: true,
    mismoBloque: caja.parentElement === color.parentElement,
    debajoDelColor: r1.top >= r2.bottom - 6,
    metodoArriba: !!dev.querySelector('[data-device-pay]'),
    metodoAntesDeLaCaja: (dev.querySelector('[data-device-pay]')?.getBoundingClientRect().top ?? 1e9) < r1.top,
  };
})()`);
/** El método elegido en la tarjeta del equipo (chip encendido del selector de F31). */
const metodoDelEquipo = () => evalx(`(() => {
  const on = document.querySelector('[role="dialog"] [data-device-pay] [data-state="on"]');
  return on ? (on.innerText || '').replace(/\\s+/g, ' ').trim() : null;
})()`);
/** El método con el que abrió el diálogo de cobro (el chip encendido DE SU bloque «Método de Pago»). */
const metodoDelPago = () => evalx(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
  const label = [...(dlg?.querySelectorAll('label') ?? [])].find(l => /^método de pago$/i.test((l.innerText || '').trim()));
  const on = label?.parentElement?.querySelector('[data-state="on"]');
  return on ? (on.innerText || '').replace(/\\s+/g, ' ').trim() : null;
})()`);
const hayDialogoDePago = () => evalx(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
  return /Registrar Pago \\/ Abono/.test(dlg?.innerText ?? '') && !!dlg?.querySelector('[data-field="saldo"]');
})()`);
/** Escribe el monto DENTRO del diálogo de cobro (el único input de dinero con min=0.01). */
const escribirMontoDelPago = (n) => evalx(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
  const i = [...dlg.querySelectorAll('input[type="number"]')].find(x => x.getAttribute('min') === '0.01');
  if (!i) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(String(n))});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const botonGuardar = () => evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^(Guardar|Actualizar)( |$)/.test((x.innerText || '').trim()));
  return b ? { label: (b.innerText || '').replace(/\\s+/g, ' ').trim(), disabled: b.disabled } : null;
})()`);
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
const irAlPaso = async (nombre) => {
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.title || '') === ${JSON.stringify('Ir a: ' + nombre)}) || null)`).catch(async () => {
    await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => (x.title || '') === ${JSON.stringify('Ir a: ' + nombre)}); if (b) b.click(); return !!b; })()`);
  });
  await sleep(900);
};
const posponerAviso = async () => {
  if (!(await evalx(`!!document.querySelector('[data-policy-modal]')`))) return false;
  await clickCenter(`document.querySelector('[data-policy-later]')`).catch(async () => {
    await evalx(`(() => { const b = document.querySelector('[data-policy-later]'); if (b) b.click(); return !!b; })()`);
  });
  return waitFor(`!document.querySelector('[data-policy-modal]')`, 6000);
};
const limpiarAvisos = async () => { for (let i = 0; i < 4; i++) { if (!(await posponerAviso())) break; } };

// ── 0) GATE DE DATOS: copia obligatoria + día abierto ────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  console.error('  Ej.: node tools/seed_dev_db.mjs  y arrancar la app con $env:REGISTRO_DB a esa copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch (e) { return { err: String(e.message) }; } };
const servicios = () => Number(uno('SELECT COUNT(*) AS n FROM services').n ?? -1);
const porMarca = () => uno('SELECT id, order_num, client, model, amount, discount_amount, status, payment_method, paid_amount, color FROM services WHERE client LIKE ?1', `%${marca}%`);
const filasDeLaOrden = (orderNum) => uno('SELECT COUNT(*) AS n FROM services WHERE order_num = ?1 OR order_num LIKE ?1 || \'-%\'', orderNum);
const pagosDe = (id) => uno('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM service_payments WHERE service_id = ?1', id);
const antes = servicios();
console.log(`· copia: ${dbPath} · ${antes} órdenes`);

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
// Arranque en frío: la ventana puede estar pintada y el backend todavía no. Se ESPERA la barra
// lateral antes de empezar (con el primer clic a ciegas, la corrida entera se caía en el paso 1).
await waitFor(`!!document.querySelector('aside button')`, 30000);
await sleep(1200);

const dia = await invoke('get_active_day').catch(() => null);
if (!dia) {
  console.log('ABORTADO: la copia no tiene día abierto (esta prueba NO abre el turno del local).');
  process.exit(2);
}
console.log(`· día abierto (${dia.close_date ?? 'hoy'}) · tasa ${dia.tasa_bcv}`);

const MODELO = (await invoke('get_phone_models', { search: '', limit: 60 }).catch(() => []))?.[0]?.label ?? null;
check('hay un modelo del padrón para el equipo de prueba', !!MODELO, String(MODELO));
if (!MODELO) process.exit(1);

const marca = String(Date.now()).slice(-6);
const CLIENTE = `Prueba F79 ${marca}`;
let idA = null, ordenNum = null;

/** Equipo N del wizard de alta (las tarjetas llevan `data-device="<índice>"`). */
const devSel = (n) => `[role="dialog"] [data-device="${n}"]`;

/** Abre el wizard y lo deja en el PASO 2 (Equipos) con un cliente nuevo y sin equipo cargado. */
const abrirEnPaso2 = async () => {
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
  await sleep(1800);
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) || null)`);
  if (!(await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000))) return false;
  await setValue('[role="dialog"] input[placeholder^="Buscar por nombre o cédula"]', CLIENTE);
  await sleep(300);
  await setValue('[role="dialog"] input[placeholder="V-12345678"]', `V-79${marca.slice(0, 6)}`);
  await sleep(600);
  await clickDialogExact('Siguiente');
  await sleep(1000);
  return waitFor(`!!document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')`, 10000);
};

/** Carga el equipo de prueba: modelo, trabajo SIN pantalla, color, monto y método (favorito). */
const cargarEquipo = async (monto) => {
  await setValue('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]', MODELO);
  await waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => (b.innerText || '').replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(MODELO)}) && !/^Pantalla /.test((b.innerText || '').trim()))`, 10000);
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
  check(`F79: el equipo de prueba queda con color`, await elegirColor('Azul'));
  await setValue('[role="dialog"] input[aria-label^="Monto ($)"]', monto);
  await sleep(500);
};

/**
 * Carga el equipo N del alta con TODO scopeado a SU tarjeta (`data-device="N"`): es lo que permite
 * probar el multi-equipo de verdad — modelo, trabajo, color y monto de CADA teléfono por separado.
 */
const cargarEquipoN = async (n, monto, color) => {
  const dev = devSel(n);
  await setValue(`${dev} input[placeholder^="Buscar el modelo del teléfono"]`, MODELO);
  await waitFor(`(() => { const d = document.querySelector(${JSON.stringify(dev)}); return !!d && [...d.querySelectorAll('button')].some(b => (b.innerText || '').replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(MODELO)}) && !/^Pantalla /.test((b.innerText || '').trim())); })()`, 10000);
  await evalx(`(() => {
    const d = document.querySelector(${JSON.stringify(dev)});
    const b = d ? [...d.querySelectorAll('button')].find(x => (x.innerText || '').replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(MODELO)}) && !/^Pantalla /.test((x.innerText || '').trim())) : null;
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(700);
  // Trabajos del equipo N (scoped) + color + monto
  const chip = (label) => evalx(`(([...document.querySelectorAll(${JSON.stringify(dev)} + ' button')].find(b => (b.innerText || '').trim() === ${JSON.stringify(label)})?.className || '') + '').includes('bg-primary')`);
  for (const [label, on] of [['Cambio batería', true], ['Cambio pantalla', false]]) {
    for (let i = 0; i < 4 && (await chip(label)) !== on; i++) {
      await evalx(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(dev)} + ' button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
      await sleep(500);
    }
  }
  await evalx(`(() => { const t = document.querySelector(${JSON.stringify(dev)} + ' [data-ficha-target="color"]'); if (t) t.focus(); return !!t; })()`);
  await keyNav('Enter', 'Enter', 13);
  await sleep(600);
  let okColor = false;
  for (let i = 0; i < 14; i++) {
    const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
    if (String(hi).includes(color)) { await keyNav('Enter', 'Enter', 13); await sleep(700); okColor = true; break; }
    await keyNav('ArrowDown', 'ArrowDown', 40);
    await sleep(180);
  }
  await setValue(`${dev} input[aria-label^="Monto ($)"]`, monto);
  await sleep(500);
  return okColor;
};

try {
  // ── 1) EL BOTÓN, EN EL PASO 2 Y AL LADO DEL COLOR ───────────────────────────────────────────
  check('F79: el wizard abre en el paso del EQUIPO', await abrirEnPaso2());
  const sinDatos = await cobro();
  check('F79: el botón de cobro existe en el paso 2 («Equipo»)', !!sinDatos, JSON.stringify(sinDatos));
  check('F79: el botón vive DENTRO de la tarjeta del equipo', sinDatos?.enTarjetaDelEquipo === true);
  const ubicacion = await juntoAlColor();
  check('F79: el botón está en el MISMO bloque que el COLOR del equipo', ubicacion?.mismoBloque === true, JSON.stringify(ubicacion));
  check('F79: y queda justo debajo del selector de color (el espacio que señaló el dueño)',
    ubicacion?.debajoDelColor === true, JSON.stringify(ubicacion));
  check('F79: el MÉTODO DE PAGO sigue arriba, en su bloque de siempre (nada duplicado)',
    ubicacion?.metodoArriba === true && ubicacion?.metodoAntesDeLaCaja === true, JSON.stringify(ubicacion));
  check('F79: la caja de cobro NO repite el selector de método (un solo control: el botón)',
    sinDatos?.controles === 1, `controles=${sinDatos?.controles}`);
  check('F79: sin monto el botón dice «Cobrar» (no inventa una cifra)', sinDatos?.label === 'Cobrar', String(sinDatos?.label));
  check('F79: antes de guardar NO hay estado de dinero inventado', sinDatos?.estado === null, String(sinDatos?.estado));

  // Clic sin datos: tiene que DECIR qué falta (nunca un botón mudo) y no guardar nada.
  await clickCenter(`document.querySelector('[role="dialog"] [data-action="cobrar-equipo"]')`).catch(() => {});
  await sleep(1200);
  const trasFallo = await cobro();
  check('F79: tocar «Cobrar» sin los datos avisa qué falta (no un clic mudo)',
    /No se guardó — falta:/.test(String(trasFallo?.aviso)) && /modelo/i.test(String(trasFallo?.aviso)),
    String(trasFallo?.aviso));
  check('F79: y NO abrió ningún diálogo de cobro', (await nDialogos()) === 1, `diálogos=${await nDialogos()}`);
  check('F79: y NO se guardó ninguna orden', servicios() === antes, `${antes} → ${servicios()}`);

  // ── 2) CON LOS DATOS: GUARDA LA ORDEN Y ABRE EL MISMO DIÁLOGO DE COBRO ──────────────────────
  await cargarEquipo(30);
  const conDatos = await cobro();
  check('F79: con el monto cargado el botón dice lo que se va a cobrar', conDatos?.label === 'Cobrar $30.00', String(conDatos?.label));
  const metodoEquipo = await metodoDelEquipo();
  check('F79: el equipo tiene su método de pago elegido arriba', !!metodoEquipo, String(metodoEquipo));
  // TRIPLE CLIC EN LA MISMA TAREA: es la forma exacta en que la revisión adversarial reprodujo el
  // bloqueante (tres `click()` seguidos creaban TRES órdenes — `saving` es estado de React y todavía
  // valía `false` en los tres). Ahora el candado de reentrada deja pasar UNA sola.
  await evalx(`(() => { const b = document.querySelector('[role="dialog"] [data-action="cobrar-equipo"]'); if (b) { b.click(); b.click(); b.click(); } return !!b; })()`);
  const abrioPago = await waitFor(`(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); return /Registrar Pago \\/ Abono/.test(d?.innerText ?? ''); })()`, 15000);
  check('F79: al tocar «Cobrar» se abre el MISMO diálogo «Pago / Abono» de la tarjeta', abrioPago && (await hayDialogoDePago()) === true);
  const creada = porMarca();
  idA = creada?.id ?? null;
  ordenNum = creada?.order_num ?? null;
  check('F79: la orden quedó GUARDADA de verdad, con su número', !!idA && /^DEV-/.test(String(ordenNum)), `${ordenNum} · $${creada?.amount} · ${creada?.payment_method}`);
  // El conteo GLOBAL es la única prueba de que no se creó una SEGUNDA orden con otro número (contar
  // las filas de `ordenNum` no lo cazaría: un duplicado nace como DEV-00xx+1).
  check('F79: y el alta creó UNA sola orden (ni una de más)', servicios() === antes + 1, `${antes} → ${servicios()}`);
  check('F79: TRES clics en la misma tarea crean UNA sola orden (candado de reentrada, bloqueante de la revisión)',
    servicios() === antes + 1 && Number(filasDeLaOrden(ordenNum)?.n ?? -1) === 1,
    `órdenes=${servicios()} (antes=${antes}) · filas=${filasDeLaOrden(ordenNum)?.n}`);
  check('F79: con el monto y el color del formulario', Number(creada?.amount) === 30 && String(creada?.color) === 'Azul',
    `$${creada?.amount} · ${creada?.color}`);
  const metodoPago = await metodoDelPago();
  // La cadena que se prueba: chip del EQUIPO (formulario) → fila guardada en la base → chip del
  // diálogo de cobro. Con `!!a && !!b` este chequeo pasaba con CUALQUIER método (revisión adversarial).
  const metodoDeLaFila = String(creada?.payment_method ?? '') === 'Divisas (USD Cash)' ? 'EFECTIVO $' : String(creada?.payment_method ?? '');
  check('F79: y el diálogo de cobro abre con el método del EQUIPO, el mismo que quedó en la orden',
    !!metodoPago && metodoPago === metodoEquipo && metodoPago === metodoDeLaFila,
    `equipo=${metodoEquipo} · cobro=${metodoPago} · fila=${creada?.payment_method}`);
  check('F79: el saldo del diálogo es el de ESA orden (por cobrar $30.00)',
    /Por pagar:/.test(String(await txtPago())) && /30\.00/.test(String(await txtPago())),
    String((await txtPago() ?? '').match(/Por pagar[^\n]*/) ?? ''));
  check('F79: el WIZARD sigue abierto (el registro no se cerró al cobrar)', (await nDialogos()) === 2, `diálogos=${await nDialogos()}`);

  const strip = await evalx(`(() => {
    const el = document.querySelector('[data-orden-guardada]');
    return el ? { base: el.getAttribute('data-orden-guardada'), texto: (el.innerText || '').replace(/\\s+/g, ' ').trim() } : null;
  })()`);
  check('F79: el aviso verde dice el número REAL de la orden', strip?.base === ordenNum, JSON.stringify(strip?.base));
  check('F79: y avisa que el paso final ACTUALIZA (no crea otra orden)', /NO se crea otra/.test(String(strip?.texto)), String(strip?.texto));
  // El pie del WIZARD (primer diálogo): el de cobro tiene su propio «Cancelar» y no cuenta.
  const pieBtns = await evalx(`(() => {
    const wizard = document.querySelectorAll('[role="dialog"]')[0];
    return [...wizard.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
  })()`);
  check('F79: el pie del wizard cambia «Cancelar» por «Cerrar» (la orden ya existe)',
    Array.isArray(pieBtns) && pieBtns.includes('Cerrar') && !pieBtns.includes('Cancelar'), JSON.stringify(pieBtns));
  const estadoPendiente = await cobro();
  check('F79: junto al botón se ve el saldo REAL de la orden', estadoPendiente?.tono === 'pendiente' && /Por cobrar \$30\.00/.test(String(estadoPendiente?.estado)),
    `${estadoPendiente?.tono}: ${estadoPendiente?.estado}`);

  // ── 3) COBRAR $1 DE VERDAD DESDE ESE DIÁLOGO ────────────────────────────────────────────────
  check('F79: se puede escribir el monto a cobrar en el diálogo', (await escribirMontoDelPago(1)) === true);
  await sleep(500);
  await clickDialogExact('Guardar Pago');
  const cerroPago = await waitFor(`document.querySelectorAll('[role="dialog"]').length === 1`, 15000);
  check('F79: al guardar el pago el diálogo se cierra y el WIZARD sigue ahí', cerroPago);
  const trasPago = porMarca();
  const pagos = idA ? pagosDe(idA) : {};
  check('F79: el abono quedó en la BASE (el dinero entró de verdad)',
    Number(trasPago?.paid_amount ?? 0) === 1 && Number(pagos?.n ?? 0) === 1 && Number(pagos?.total ?? 0) === 1,
    `paid_amount=${trasPago?.paid_amount} · pagos=${pagos?.n} ($${pagos?.total})`);
  const estadoParcial = await cobro();
  check('F79: el paso 2 muestra el cobro al instante («Cobrado $1.00 · saldo $29.00»)',
    estadoParcial?.tono === 'parcial' && /Cobrado \$1\.00 · saldo \$29\.00/.test(String(estadoParcial?.estado)),
    `${estadoParcial?.tono}: ${estadoParcial?.estado}`);

  // ── 4) SEGUIR EL PROCESO DEL WIZARD SIN DUPLICAR LA ORDEN ───────────────────────────────────
  await clickDialogExact('Siguiente');   // Blindaje
  await sleep(900);
  await clickDialogExact('Siguiente');   // Revisar
  await sleep(1200);
  const resumen = await evalx(`document.querySelector('[data-cobro-resumen="1"]')?.innerText ?? null`);
  check('F79: en «Revisar» el resumen del equipo muestra lo cobrado', /Cobrado \$1\.00/.test(String(resumen)), String(resumen));

  // Se corrige el monto DESPUÉS de haber cobrado (30 → 40): el guardado final tiene que ACTUALIZAR
  // la orden (no crear otra) y conservar el abono.
  await irAlPaso('Equipos');
  await sleep(600);
  await setValue('[role="dialog"] input[aria-label^="Monto ($)"]', 40);
  await sleep(700);
  await clickCenter(`document.querySelector('[role="dialog"] [data-action="cobrar-equipo"]')`).catch(() => {});
  const abrioPago2 = await waitFor(`(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); return /Registrar Pago \\/ Abono/.test(d?.innerText ?? ''); })()`, 15000);
  check('F79: volver a tocar «Cobrar» actualiza la orden y reabre el cobro con el saldo NUEVO',
    abrioPago2 && /39\.00/.test(String(await txtPago())), String((await txtPago() ?? '').match(/Saldo pendiente[^\n]*/) ?? ''));
  await keyNav('Escape', 'Escape', 27);
  await sleep(700);
  check('F79: y la orden sigue siendo UNA sola (no se duplicó al volver a cobrar)', Number(filasDeLaOrden(ordenNum)?.n ?? -1) === 1,
    `filas=${filasDeLaOrden(ordenNum)?.n}`);
  check('F79: ni apareció una orden nueva con otro número', servicios() === antes + 1, `${antes} → ${servicios()}`);

  // OJO: el stepper solo deja VOLVER hacia atrás (se estuvo en «Equipos»): para llegar al último paso
  // se avanza con «Siguiente», ESPERANDO el paso (nunca contando clics a ojo).
  const pasoActual = async () => Number(String(await dialogTxt() ?? '').match(/Paso (\d+) de (\d+)/)?.[1] ?? 0);
  for (let i = 0; i < 4 && (await pasoActual()) < 4; i++) {
    await clickDialogExact('Siguiente');
    await sleep(1000);
  }
  check('F79: se llega al último paso del proceso («Revisar») después de cobrar', (await pasoActual()) === 4, `paso=${await pasoActual()}`);
  await evalx(`(() => { const c = document.querySelector('[data-field="imprimir-al-guardar"]'); if (c && c.checked) c.click(); return true; })()`);
  await sleep(500);
  const boton = await botonGuardar();
  check('F79: el botón del último paso dice «Actualizar orden» (no «Guardar Servicio»)',
    boton?.label === 'Actualizar orden', String(boton?.label));
  await clickDialogExact('Actualizar orden');
  const cerro = await waitFor(`!((document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Servicio Técnico'))`, 15000);
  check('F79: el registro se cierra con el guardado final', cerro);
  const final = porMarca();
  check('F79: la orden NO se duplicó (una sola fila, mismo número)',
    Number(filasDeLaOrden(ordenNum)?.n ?? -1) === 1 && final?.id === idA, `filas=${filasDeLaOrden(ordenNum)?.n} · id=${final?.id} (era ${idA})`);
  check('F79: el guardado final tampoco creó una orden nueva', servicios() === antes + 1, `${antes} → ${servicios()}`);
  check('F79: la corrección posterior al cobro QUEDÓ guardada (monto $40)',
    Number(final?.amount) === 40, `$${final?.amount}`);
  check('F79: y el abono sigue intacto (no lo pisó el guardado)', Number(final?.paid_amount ?? 0) === 1, `paid_amount=${final?.paid_amount}`);
  // Los recordatorios de la recepción siguen saliendo — al CERRAR el registro (no al cobrar).
  const aviso = await waitFor(`!!document.querySelector('[data-policy-modal]')`, 8000);
  check('F79: al cerrar el registro siguen saliendo los recordatorios de la recepción', aviso);
  await limpiarAvisos();
  check('F79: la tarjeta conserva el botón «Pago / Abono» de siempre (la opción actual no cambió)',
    (await evalx(`(() => {
      // Scoped a LA TARJETA de la orden (por su botón de técnico): buscar «Pago / Abono» en todo el
      // documento también matcheaba el «Registrar Pago / Abono» del wizard y la aserción era vacua.
      let el = document.querySelector('[data-tech-quick="${idA}"]');
      while (el) {
        const b = [...el.querySelectorAll('button')].find(x => (x.innerText || '').trim() === 'Pago / Abono');
        if (b) return true;
        el = el.parentElement;
      }
      return false;
    })()`)) === true);

  // ── 5) EN EDICIÓN: el mismo botón al lado del color, sin guardar nada ───────────────────────
  // El wizard tiene que estar CERRADO (si quedó abierto, sus clics no llegan a la tarjeta: el velo
  // se los come y la prueba se cree en edición cuando en realidad sigue en el alta).
  for (let i = 0; i < 4; i++) {
    if ((await nDialogos()) === 0) break;
    await keyNav('Escape', 'Escape', 27).catch(() => {});
    await sleep(700);
  }
  check('F79: antes de editar, el wizard quedó cerrado', (await nDialogos()) === 0, `diálogos=${await nDialogos()}`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(CLIENTE)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(2200);
  // Se espera LA TARJETA de la orden de prueba (por su botón de técnico, que lleva el id real): así
  // el clic no depende de que el filtro haya terminado ni de qué tarjeta quedó primera en la lista.
  const miCarta = await waitFor(`!!document.querySelector('[data-tech-quick="${idA}"]')`, 12000);
  check('F79: la lista muestra la tarjeta de la orden de prueba para editarla', miCarta);
  const btnEditar = `(() => {
    let el = document.querySelector('[data-tech-quick="${idA}"]');
    while (el) { const b = [...el.querySelectorAll('button')].find(x => (x.innerText || '').trim() === 'Editar'); if (b) return b; el = el.parentElement; }
    return null;
  })()`;
  const abrioDialogoEd = async (ms) => waitFor(`/^Editar/m.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, ms);
  await clickCenter(`(${btnEditar})`).catch(async () => { await evalx(`(() => { const b = ${btnEditar}; if (b) b.click(); return !!b; })()`); });
  let abrioEd = await abrioDialogoEd(6000);
  if (!abrioEd) {
    // Plan B (el clic por coordenadas puede caer durante una animación del aviso de política): se usa
    // el clic del propio elemento, que es la acción que el operario dispara igual.
    await evalx(`(() => { const b = ${btnEditar}; if (b) b.click(); return !!b; })()`);
    abrioEd = await abrioDialogoEd(8000);
  }
  const diagEd = await evalx(`JSON.stringify({ dialogos: document.querySelectorAll('[role="dialog"]').length, alertas: document.querySelectorAll('[role="alertdialog"]').length, velo: !!document.querySelector('[data-policy-overlay]'), editar: [...document.querySelectorAll('button')].filter(b => (b.innerText || '').trim() === 'Editar').length, cartas: document.querySelectorAll('[data-tech-quick]').length })`);
  check('F79: la orden se puede abrir en EDICIÓN', abrioEd, String(diagEd));
  // El avance de paso se ESPERA por condición (el primer clic puede caer durante la animación de
  // entrada del diálogo — la misma lección que F77): nunca se cuenta un clic a ojo.
  const pasoDeEd = async () => Number(String(await dialogTxt() ?? '').match(/Paso (\d+) de (\d+)/)?.[1] ?? 0);
  for (let i = 0; i < 5 && (await pasoDeEd()) < 2; i++) {
    await clickDialogExact('Siguiente');
    await sleep(1200);
  }
  const enPasoEquipo = await waitFor(`!!document.querySelector('[role="dialog"] [data-ficha-target="color"]')`, 10000);
  check('F79: el paso del EQUIPO de la edición está a la vista', enPasoEquipo, `paso=${await pasoDeEd()}`);
  const cobroEd = await cobro();
  check('F79: en EDICIÓN el botón de cobro también está, en el paso del equipo', cobroEd?.modo === 'editar', JSON.stringify(cobroEd));
  check('F79: y dice «Cobrar / Abono» (la acción de siempre)', cobroEd?.label === 'Cobrar / Abono', String(cobroEd?.label));
  check('F79: con el saldo REAL de la orden guardada', /Cobrado \$1\.00 · saldo \$39\.00/.test(String(cobroEd?.estado)),
    `${cobroEd?.tono}: ${cobroEd?.estado}`);
  const ubicEd = await juntoAlColor();
  check('F79: y está al lado del color, como en el alta', ubicEd?.mismoBloque === true && ubicEd?.debajoDelColor === true, JSON.stringify(ubicEd));
  const antesEd = uno('SELECT id, amount, status, COALESCE(date_out,\'\') AS date_out, COALESCE(paid_amount,0) AS paid, COALESCE(payment_method,\'\') AS metodo FROM services WHERE id = ?1', idA);
  const ordenesAntesEd = servicios();
  // En EDICIÓN «Cobrar / Abono» NO escribe nada (spec REQ-4): se prueba de verdad — se cambia el
  // MÉTODO en el formulario y se comprueba que la fila queda igual y que el diálogo sigue cobrando
  // con el método GUARDADO (no con el del formulario). Un chequeo que solo contara órdenes pasaba
  // aunque el botón guardara el formulario entero (hallazgo de la revisión adversarial).
  await evalx(`(() => {
    const box = document.querySelector('[data-device-pay="edit"]');
    const b = box ? [...box.querySelectorAll('button')].find(x => /PUNTO Bs/i.test((x.innerText || '').replace(/\\s+/g, ' '))) : null;
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(700);
  await clickCenter(`document.querySelector('[role="dialog"] [data-action="cobrar-equipo"]')`).catch(() => {});
  const abrioEd2 = await waitFor(`(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); return /Registrar Pago \\/ Abono/.test(d?.innerText ?? ''); })()`, 15000);
  check('F79 (edición): abre el mismo diálogo de cobro', abrioEd2 && (await hayDialogoDePago()) === true);
  check('F79 (edición): el diálogo cobra con el método GUARDADO, no con el que se acaba de elegir en el formulario',
    (await metodoDelPago()) === (String(antesEd?.metodo) === 'Divisas (USD Cash)' ? 'EFECTIVO $' : String(antesEd?.metodo)),
    `diálogo=${await metodoDelPago()} · fila=${antesEd?.metodo}`);
  check('F79 (edición): el diálogo dice el saldo guardado (no lo cambia nada)',
    /39\.00/.test(String(await txtPago())), String((await txtPago() ?? '').match(/Saldo pendiente[^\n]*/) ?? ''));
  await keyNav('Escape', 'Escape', 27);
  await sleep(700);
  const despuesEd = uno('SELECT id, amount, status, COALESCE(date_out,\'\') AS date_out, COALESCE(paid_amount,0) AS paid, COALESCE(payment_method,\'\') AS metodo FROM services WHERE id = ?1', idA);
  check('F79 (edición): cobrar desde el paso 2 NO escribió NADA en la orden (monto, estado, fecha, método y abono intactos)',
    JSON.stringify(antesEd) === JSON.stringify(despuesEd) && servicios() === ordenesAntesEd,
    `${JSON.stringify(antesEd)} → ${JSON.stringify(despuesEd)}`);
  check('F79 (edición): y no se creó ninguna orden', servicios() === antes + 1, `${antes} → ${servicios()}`);

  // ── 6) CERRAR EL REGISTRO CON IMPRESIÓN después de haber cobrado (F79 × F77): el comprobante sale
  //        de la orden GUARDADA y el guardado sigue siendo un UPDATE (nunca una segunda orden).
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Editar$/.test((b.innerText || '').trim())) || null)`).catch(() => {});
  await abrioDialogoEd(10000);
  check('F79: se puede volver a abrir la orden para cerrar el registro', (await pasoDeEd()) >= 1, `paso=${await pasoDeEd()}`);
  for (let i = 0; i < 6 && (await pasoDeEd()) < 5; i++) {
    await clickDialogExact('Siguiente');
    await sleep(1200);
  }
  check('F79: la edición llega a su último paso («Cierre»)', (await pasoDeEd()) === 5, `paso=${await pasoDeEd()}`);
  const botonEd = await botonGuardar();
  check('F79: con el check de imprimir marcado el botón dice «Actualizar e imprimir»',
    botonEd?.label === 'Actualizar e imprimir', String(botonEd?.label));
  await clickDialogExact(botonEd?.label ?? 'Actualizar e imprimir');
  const factura = await waitFor(`/Orden de servicio/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 15000);
  const textoFactura = String(await dialogTxt());
  check('F79: al cerrar el registro se abre el COMPROBANTE de la orden que se cobró',
    factura && textoFactura.includes(String(ordenNum)), String(textoFactura.match(/Orden de servicio[^\n]*/) ?? ''));
  await keyNav('Escape', 'Escape', 27);
  await sleep(800);
  const finalEd = porMarca();
  check('F79: la orden sigue siendo UNA sola y conserva el abono',
    Number(filasDeLaOrden(ordenNum)?.n ?? -1) === 1 && Number(finalEd?.paid_amount ?? 0) === 1,
    `filas=${filasDeLaOrden(ordenNum)?.n} · paid=${finalEd?.paid_amount}`);
  check('F79: y el cierre en edición tampoco creó órdenes nuevas', servicios() === antes + 1, `${antes} → ${servicios()}`);
  await limpiarAvisos();

  // ── 7) MULTI-EQUIPO (el caso normal del local: un cliente con DOS teléfonos): se cobra el SEGUNDO
  //        y se comprueba que la orden se numera base / base-A, que el cobro abre en la fila de ESE
  //        equipo (con SU monto) y que el guardado final actualiza las dos filas sin duplicar.
  for (let i = 0; i < 3; i++) {
    if ((await nDialogos()) === 0) break;
    await keyNav('Escape', 'Escape', 27).catch(() => {});
    await sleep(700);
  }
  await clickCenter(`([...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio')) || null)`).catch(() => {});
  await sleep(1200);
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) || null)`);
  const abrioMulti = await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
  check('F79 (multi): el wizard abre para el cliente de los dos teléfonos', abrioMulti);
  const CLIENTE_B = `Prueba F79B ${marca}`;
  await setValue('[role="dialog"] input[placeholder^="Buscar por nombre o cédula"]', CLIENTE_B);
  await sleep(300);
  await setValue('[role="dialog"] input[placeholder="V-12345678"]', `V-78${marca.slice(0, 6)}`);
  await sleep(600);
  await clickDialogExact('Siguiente');
  await sleep(1200);
  const colorUno = await cargarEquipoN(0, 20, 'Azul');
  await clickDialogExact('Agregar otro equipo');
  await sleep(1200);
  const hayDos = await evalx(`!!document.querySelector(${JSON.stringify(devSel(1))})`);
  check('F79 (multi): el segundo equipo se agrega al formulario', hayDos === true, `equipo1 con color=${colorUno}`);
  const colorDos = await cargarEquipoN(1, 15, 'Rojo');
  check('F79 (multi): los dos equipos quedan cargados (modelo, trabajo, color y monto)', colorDos);
  const botonDos = await evalx(`(() => {
    const b = document.querySelector(${JSON.stringify(devSel(1))} + ' [data-action="cobrar-equipo"]');
    return b ? { label: (b.innerText || '').replace(/\\s+/g, ' ').trim(), modo: b.getAttribute('data-cobro-modo') } : null;
  })()`);
  check('F79 (multi): el botón del equipo 2 dice SU monto', botonDos?.label === 'Cobrar $15.00', JSON.stringify(botonDos));

  await clickCenter(`document.querySelector(${JSON.stringify(devSel(1))} + ' [data-action="cobrar-equipo"]')`).catch(() => {});
  const abrioPagoMulti = await waitFor(`(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); return /Registrar Pago \\/ Abono/.test(d?.innerText ?? ''); })()`, 15000);
  const stripMulti = await evalx(`(() => {
    const el = document.querySelector('[data-orden-guardada]');
    return el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : null;
  })()`);
  const baseMulti = String(stripMulti ?? '').match(/Orden (DEV-\d+)/)?.[1] ?? '';
  // Las filas se cuentan por el NÚMERO de la orden (el cliente no sirve de filtro: el guardado pasa el
  // nombre por Title Case y el sufijo de marca lo comparten las dos órdenes de la corrida).
  const filasMulti = filasDeLaOrden(baseMulti);
  check('F79 (multi): la orden multi-equipo queda con DOS filas (base + base-A)', Number(filasMulti?.n ?? -1) === 2, `filas=${filasMulti?.n} (base=${baseMulti})`);
  check('F79 (multi): se abre el cobro del EQUIPO 2 (el suyo, $15.00, no el del equipo 1)',
    abrioPagoMulti && /Por pagar:/.test(String(await txtPago())) && /15\.00/.test(String(await txtPago())),
    String((await txtPago() ?? '').match(/Por pagar[^\n]*/) ?? ''));
  check('F79 (multi): el aviso verde lista los DOS equipos con su estado',
    /Equipo 1: Por cobrar \$20\.00/.test(String(stripMulti)) && /Equipo 2: Por cobrar \$15\.00/.test(String(stripMulti)),
    String(stripMulti));
  const agregarBloqueado = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Agregar otro equipo$/.test((x.innerText || '').trim()));
    return b ? { disabled: b.disabled, title: b.getAttribute('title') } : null;
  })()`);
  check('F79 (multi): con la orden guardada NO se pueden agregar equipos (y se dice por qué)',
    agregarBloqueado?.disabled === true && /ya está guardada/.test(String(agregarBloqueado?.title)), JSON.stringify(agregarBloqueado));

  // Se cobra $5 del equipo 2 y se cierra el registro (sin imprimir): la orden tiene que seguir siendo
  // DOS filas, con los montos de cada equipo y el abono SOLO en el equipo 2.
  await escribirMontoDelPago(5);
  await sleep(500);
  await clickDialogExact('Guardar Pago');
  const cerroPagoMulti = await waitFor(`document.querySelectorAll('[role="dialog"]').length === 1`, 15000);
  const estadoEquipo2 = await evalx(`document.querySelector('[data-cobro-equipo="2"]')?.innerText ?? null`);
  const estadoEquipo1 = await evalx(`document.querySelector('[data-cobro-equipo="1"]')?.innerText ?? null`);
  check('F79 (multi): el abono se guarda y el equipo 1 sigue sin cobros',
    cerroPagoMulti && /Por cobrar \$20\.00/.test(String(estadoEquipo1)),
    `equipo1=${String(estadoEquipo1)}`);
  check('F79 (multi): la línea del equipo 2 dice lo cobrado y su saldo',
    /Cobrado \$5\.00 · saldo \$10\.00/.test(String(estadoEquipo2)), String(estadoEquipo2));
  const pasoMulti = async () => Number(String(await dialogTxt() ?? '').match(/Paso (\d+) de (\d+)/)?.[1] ?? 0);
  for (let i = 0; i < 4 && (await pasoMulti()) < 4; i++) { await clickDialogExact('Siguiente'); await sleep(1000); }
  await evalx(`(() => { const c = document.querySelector('[data-field="imprimir-al-guardar"]'); if (c && c.checked) c.click(); return true; })()`);
  await sleep(400);
  await clickDialogExact('Actualizar orden');
  const cerroMulti = await waitFor(`!((document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Servicio Técnico'))`, 15000);
  await limpiarAvisos();
  const filasFinal = filasDeLaOrden(baseMulti ?? '');
  const porEquipo = uno(`SELECT COALESCE(SUM(CASE WHEN order_num = ?1 THEN 1 ELSE 0 END),0) AS base,
                                COALESCE(SUM(CASE WHEN order_num = ?1 || '-A' THEN 1 ELSE 0 END),0) AS segundo,
                                COALESCE(SUM(CASE WHEN order_num = ?1 THEN amount ELSE 0 END),0) AS monto1,
                                COALESCE(SUM(CASE WHEN order_num = ?1 || '-A' THEN amount ELSE 0 END),0) AS monto2,
                                COALESCE(SUM(CASE WHEN order_num = ?1 || '-A' THEN paid_amount ELSE 0 END),0) AS pagado2
                         FROM services WHERE order_num = ?1 OR order_num = ?1 || '-A'`, baseMulti);
  check('F79 (multi): el cierre del registro actualiza las DOS filas sin duplicar',
    cerroMulti && Number(filasFinal?.n ?? -1) === 2, `filas=${filasFinal?.n} (base=${porEquipo?.base}, base-A=${porEquipo?.segundo})`);
  check('F79 (multi): cada equipo conserva SU monto (20 el 1º, 15 el 2º)',
    Number(porEquipo?.monto1 ?? -1) === 20 && Number(porEquipo?.monto2 ?? -1) === 15,
    `$${porEquipo?.monto1} / $${porEquipo?.monto2}`);
  check('F79 (multi): el abono quedó SOLO en el equipo 2 ($5)', Number(porEquipo?.pagado2 ?? -1) === 5, `pagado base-A=$${porEquipo?.pagado2}`);
  // El conteo GLOBAL: 1 fila de la orden de la sección 1 + las 2 filas de la orden multi-equipo.
  check('F79 (multi): el conteo global refleja exactamente las órdenes creadas (1 + 2 filas)',
    servicios() === antes + 3, `${antes} → ${servicios()}`);
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  for (let i = 0; i < 3; i++) {
    if (!(await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false))) break;
    await keyNav('Escape', 'Escape', 27).catch(() => {});
    await sleep(600);
  }
}

// ── 6) LIMPIEZA (la orden se borra con sus pagos y su contra-asiento) ────────────────────────
for (let i = 0; i < 3; i++) {
  const mias = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' })
    .then(rs => (rs ?? []).filter(r => String(r.client ?? '').includes(marca))).catch(() => []);
  if (!Array.isArray(mias) || mias.length === 0) break;
  for (const r of mias) await invoke('delete_service', { id: r.id }).catch(() => {});
}
const restos = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' })
  .then(rs => (rs ?? []).filter(r => String(r.client ?? '').includes(marca))).catch(() => null);
check('las órdenes de prueba quedaron borradas (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);
const despues = servicios();
check('la base queda con las mismas órdenes que al empezar', despues === antes, `${antes} → ${despues}`);
db.close();
// El CLIENTE de prueba (no hay comando para borrarlo): se saca con una conexión de escritura aparte,
// solo si quedó sin órdenes. Se COMPRUEBA el borrado (una aserción `true` fija no prueba nada — la
// revisión adversarial la marcó como vacua, con 5 clientes de pruebas viejas como evidencia).
try {
  const w = new DatabaseSync(dbPath);
  const usados = w.prepare('SELECT COUNT(*) AS n FROM services WHERE client LIKE ?1').get(`%${marca}%`);
  if (Number(usados?.n ?? 0) === 0) w.prepare('DELETE FROM clients WHERE name LIKE ?1').run(`%${marca}%`);
  const quedan = w.prepare('SELECT COUNT(*) AS n FROM clients WHERE name LIKE ?1').get(`%${marca}%`);
  w.close();
  check('el cliente de prueba quedó borrado', Number(quedan?.n ?? -1) === 0, `quedan=${quedan?.n}`);
} catch (e) {
  check('el cliente de prueba quedó borrado', false, String(e?.message ?? e));
}

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
