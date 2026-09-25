// VERIFICACIÓN EN VIVO (CDP) de F73 — LA MÁSCARA DE DINERO: los céntimos exactos.
//
// El bug (medido el 2026-09-25): escribir «145» en un campo de dinero dejaba **1,45** (la máscara
// tomaba los dígitos sin separador como centavos) — cargar $145 exigía teclear «14500». Esta
// verificación escribe EN LA APP REAL (Tauri 2 + React 19 + SQLite), con teclado de verdad, y
// comprueba que el número que queda vale lo que se escribió.
//
// Dos pruebas, la segunda es la que prueba el VALOR (no sólo el texto):
//   1. El campo de MONTO del diálogo de gasto: «145» se muestra «145» y al salir «145,00»;
//      «145,5» se muestra «145,5»; «1.234» se muestra «1.234» (no 1,23); «0,05» queda «0,05».
//   2. La línea de DIVISAS del arqueo: el campo viene precargado con el esperado; se borra y se
//      escribe «145» y la DIFERENCIA que informa la pantalla tiene que ser exactamente
//      esperado − 145 (si la máscara volviera a comerse los dígitos diría otra cosa). Se salta si
//      la copia no tiene turno abierto.
//
// SEGURIDAD DE DATOS: NO escribe nada (no guarda el gasto ni cierra el día). Igual corre contra una
// COPIA (`REGISTRO_DB`), como el resto de las verificaciones del proyecto.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f71_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       app de dev abierta  →  node tools/verify_money_input.mjs

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

let checks = 0;
const fallos = [];
const check = (que, cond, detalle = '') => {
  checks++;
  console.log(`${cond ? 'OK  ' : 'FALLA'} · ${que}${detalle ? ` — ${detalle}` : ''}`);
  if (!cond) fallos.push(que);
};

const waitFor = async (expr, timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) GATE: la copia de la base ───────────────────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: apuntá REGISTRO_DB a una COPIA, nunca a la base real del local.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql) => { try { return db.prepare(sql).get() ?? {}; } catch (e) { return { err: String(e.message) }; } };
const diaAbierto = uno("SELECT close_date FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1").close_date ?? null;
console.log(`· copia: ${dbPath} · turno abierto: ${diaAbierto ?? 'ninguno'}`);

/**
 * Lee un monto de la pantalla. OJO: la app muestra los DÓLARES con punto decimal y dos decimales
 * (`fmtUsd` → «$145.00») y los BOLÍVARES en es-VE (`fmtBs` → «Bs. 34.140,00»): el mismo punto es
 * separador de MILES en un caso y DECIMAL en el otro, así que se distinguen por la forma del número.
 * (Leer «145.00» como 14.500 fue el bug del primer intento de esta verificación.)
 */
const aNumero = (texto) => {
  const t = String(texto ?? '').replace(/[^0-9.,]/g, '');
  if (!t) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d+(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  return Number(t);
};

// ── helpers de sesión ─────────────────────────────────────────────────────────────────────────
const irALaLista = async () => {
  for (let i = 0; i < 5; i++) {
    if (await evalx(`!!document.querySelector('[data-user-picker]')`)) return true;
    await evalx(`(() => { const b = document.querySelector('[data-action="bloquear-sesion"]'); if (b) b.click(); return !!b; })()`);
    await sleep(900);
    await evalx(`(() => { const b = document.querySelector('[data-action="cambiar-persona"]'); if (b) b.click(); return !!b; })()`);
    await sleep(700);
  }
  return await waitFor(`!!document.querySelector('[data-user-picker]')`, 8000);
};

const entrar = async (name, pin) => {
  await irALaLista();
  const id = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-user-option]')].find(x => (x.innerText || '').includes(${JSON.stringify(name)}));
    return b ? Number(b.getAttribute('data-user-option')) : null;
  })()`);
  if (id == null) return false;
  await clickCenter(`document.querySelector('[data-user-option="${id}"]')`);
  await sleep(700);
  if (!await waitFor(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`, 6000)) return false;
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText(pin);
  await keyNav('Enter', 'Enter', 13);
  return await waitFor(`!!document.querySelector('aside')`, 15000);
};

const irAlLibro = async () => {
  await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Libro Diario/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  return await waitFor(`!!document.querySelector('[data-nav-group]')`, 12000);
};

/** Escribe como un operario: enfoca, selecciona todo, borra y teclea tecla por tecla. */
const escribir = async (selector, texto) => {
  await clickCenter(selector);
  await evalx(`(() => { const i = (${selector}); if (!i) return false; i.focus(); i.select(); return true; })()`);
  await keyNav('Delete', 'Delete', 46);
  if (texto) await typeText(texto);
  await sleep(600);
  return await evalx(`(${selector})?.value ?? null`);
};

// ── 1) LA APP: entrar y abrir el Libro Diario ──────────────────────────────────────────────────
check('F73: el Master entra (sobre la copia)', await entrar('Master', '1234'));
check('F73: llega al Libro Diario', await irAlLibro());
await sleep(1500);

// ── 2) EL CAMPO DE MONTO (diálogo de gasto): lo que se escribe es lo que se muestra ────────────
{
  // «Registrar gasto» vive en la pestaña GASTOS del libro (la nav agrupada de F72).
  await evalx(`(() => { const b = document.querySelector('[data-tab="gastos"]'); if (b) b.click(); return !!b; })()`);
  await sleep(1500);
  const hayBoton = await waitFor(`[...document.querySelectorAll('button')].some(b => /^Registrar gasto$/.test((b.innerText || '').trim()))`, 12000);
  check('F73: la pestaña Gastos ofrece «Registrar gasto»', hayBoton);
  if (hayBoton) {
    await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Registrar gasto$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    await sleep(1200);
  }
  const hayMonto = await waitFor(`!!document.querySelector('[role="dialog"] input[inputmode="decimal"]')`, 8000);
  check('F73: el diálogo de gasto abre con su campo de monto', hayMonto);
  if (hayMonto) {
    const SEL = `document.querySelector('[role="dialog"] input[inputmode="decimal"]')`;
    const casos = [
      // tecleado, lo que tiene que mostrar el campo mientras se escribe
      ['145', '145'],
      ['1450', '1.450'],
      ['145,5', '145,5'],
      ['0,05', '0,05'],
      ['1.234', '1.234'],
      ['7', '7'],
    ];
    for (const [tecleado, esperado] of casos) {
      const visto = await escribir(SEL, tecleado);
      check(`F73: escribir «${tecleado}» deja «${esperado}» en el campo`, visto === esperado, `quedó «${visto}»`);
    }
    // Al salir del campo se muestra el monto guardado con sus dos decimales (145,5 → 145,50).
    await escribir(SEL, '145,5');
    await clickCenter(`document.querySelector('[role="dialog"] h2, [role="dialog"] [data-slot="dialog-title"], [role="dialog"]')`);
    await sleep(500);
    const alSalir = await evalx(`document.querySelector('[role="dialog"] input[inputmode="decimal"]')?.value ?? null`);
    check('F73: al salir del campo el monto queda con dos decimales (145,5 → 145,50)', alSalir === '145,50', `quedó «${alSalir}»`);
    // Un monto de céntimos no se pierde al salir (0,05 sigue siendo 0,05).
    await escribir(SEL, '0,05');
    await clickCenter(`document.querySelector('[role="dialog"] h2, [role="dialog"] [data-slot="dialog-title"], [role="dialog"]')`);
    await sleep(500);
    const centimos = await evalx(`document.querySelector('[role="dialog"] input[inputmode="decimal"]')?.value ?? null`);
    check('F73: los céntimos sobreviven al salir del campo (0,05 → 0,05)', centimos === '0,05', `quedó «${centimos}»`);
    // Cerrar sin guardar (Escape): la verificación NO escribe en la base.
    await keyNav('Escape', 'Escape', 27);
    await sleep(800);
    const sigueAbierto = await evalx(`!!document.querySelector('[role="dialog"] input[inputmode="decimal"]')`);
    check('F73: la verificación cerró el diálogo sin guardar el gasto', sigueAbierto === false);
  }
}

// ── 3) LA LÍNEA DE DIVISAS DEL ARQUEO: el VALOR que toma la cuenta de la caja ──────────────────
if (!diaAbierto) {
  check('F73: la copia tiene un turno abierto para medir el VALOR del monto (se omite)', true, 'sin turno abierto');
} else {
  const abrio = await evalx(`(() => { const b = document.querySelector('[data-action="cerrar-dia"]'); if (b) b.click(); return !!b; })()`);
  check('F73: abre el arqueo del cierre', abrio === true && await waitFor(`!!document.querySelector('[data-arqueo="usd"]')`, 8000));
  const SEL = `document.querySelector('[data-arqueo="usd"] input')`;
  const esperadoTexto = String(await evalx(`document.querySelector('[data-arqueo="usd"]')?.innerText ?? ''`));
  const esperado = aNumero((esperadoTexto.match(/Esperado:\s*\$([\d.,]+)/) ?? [])[1]);
  check('F73: la línea de divisas informa su esperado', Number.isFinite(esperado), `esperado = $${esperado}`);

  /** La diferencia que informa la pantalla, en dólares (con su signo). Cuadrado = 0. */
  const diferencia = async () => {
    const txt = String(await evalx(`document.querySelector('[data-field="dif-linea-usd"]')?.innerText ?? ''`));
    if (/cuadrado/i.test(txt)) return 0;
    const m = txt.match(/(faltan|sobran)\s*\$([\d.,]+)/);
    if (!m) return null;
    const n = aNumero(m[2]);
    return Number.isFinite(n) ? (m[1] === 'faltan' ? -n : n) : null;
  };

  for (const [tecleado, muestra, valor] of [['145', '145', 145], ['145,50', '145,50', 145.5], ['1.234', '1.234', 1234]]) {
    const visto = await escribir(SEL, tecleado);
    await sleep(700);
    const cuenta = await diferencia();
    // Lo que informa la pantalla es (lo que se escribió − el esperado): si la máscara volviera a
    // comerse los dígitos («145» → 1,45) la cuenta daría otra cosa.
    const esperadaCuenta = Number(((valor - esperado) * 100).toFixed(0)) / 100;
    check(`F73: escribir «${tecleado}» cuenta como $${valor} en el arqueo (diferencia ${esperadaCuenta})`,
      visto === muestra && cuenta !== null && Math.abs(cuenta - esperadaCuenta) < 0.011,
      `campo «${visto}» · pantalla ${cuenta} · esperado ${esperadaCuenta}`);
  }
  await keyNav('Escape', 'Escape', 27);
  await sleep(700);
  check('F73: la verificación NO cerró el turno real de la copia',
    Number(uno('SELECT COUNT(*) AS n FROM daily_closings WHERE is_closed=0').n) === 1);
}

// Dejar la pantalla como estaba (turno de la copia intacto, sesión del dueño en el Diario).
await irAlLibro();

console.log(`\nverify_money_input: ${checks - fallos.length}/${checks} OK${fallos.length ? ` — ${fallos.length} FALLAN` : ''}`);
if (fallos.length) { console.log(fallos.map(f => `  · ${f}`).join('\n')); process.exit(1); }
process.exit(0);
