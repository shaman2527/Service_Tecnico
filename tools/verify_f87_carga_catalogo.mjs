// VERIFICACIÓN EN VIVO (CDP) de F87 — LA CARGA MASIVA, REDISEÑADA.
//
// Pedido del dueño (2026-10-04, con su archivo en la mano): «mejorame diseño de la carga CSV masiva, el modal sea más
// intuitivo para que sea más responsive y organizada» + «los errores/compatibilidades… agregarlo o mejorar eso por sus
// modelos».
//
// Qué comprueba, con SU archivo real (`tools/prueba-carga-catalogo.csv`, 83 filas de pantallas Infinix/Tecno):
//   1. El paso «Revisar» NO tiene scroll lateral (medido antes del rediseño: 2371 px en una caja de 1213).
//   2. Los avisos de compatibilidad NO son falsos positivos: la ficha cuya etiqueta lleva la VARIANTE pegada
//      («Infinix Gt 20 Pro INCELL» con modelo «Gt 20 Pro») NO se avisa, y la que de verdad es incoherente
//      («Tecno Spark 20 Pro ORIGINAL» con una lista de Spark 10 / Go 2023 / Pop 7…) SÍ se avisa.
//   3. Los CÓDIGOS del local (P-02xx, pegados al nombre en su columna «Producto») se recuperan: el backend los
//      devuelve en cada fila y el asistente lo dice.
//   4. Sigue intacto lo que ya funcionaba: el modo del stock, el resumen, el botón de aplicar y el aviso de
//      columnas descartadas/repetidas.
//   5. A ventana angosta la revisión se APILA y tampoco saca scroll lateral.
//
// SEGURIDAD DE DATOS: **solo LEE** (usa la vista previa; NO aplica la carga).
//
// Uso:  app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_f87_carga_catalogo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalx, clickCenter, keyNav, typeText, sleep, setViewport, resetViewport } from './cdp_driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = path.join(HERE, 'prueba-carga-catalogo.csv');
const CSV = fs.readFileSync(ARCHIVO, 'utf8');

/**
 * LOS CÓDIGOS QUE **ESTÁN** EN EL ARCHIVO, contados desde el archivo mismo (no un número escrito a
 * mano). OJO con el número: el archivo tiene **83 filas de datos pero sólo 71 traen código** — en 12
 * («Infinix Hot 11 Play», «Infinix Hot 11 2022»…, líneas sin `P-####` en ninguna columna) su Excel no
 * tiene código y no hay nada que rescatar: el asistente NO se lo puede inventar. Por eso la
 * comprobación no es «83 de 83» (imposible) sino la que sí prueba el arreglo: **todos los códigos que
 * el archivo trae se recuperan (71/71) y no aparece ninguno que el archivo no tenga** — un umbral
 * porcentual dejaría pasar códigos perdidos y códigos inventados a la vez.
 */
const CODIGOS_ESPERADOS = (() => {
  const lineas = CSV.split(/\r?\n/).slice(1).filter(l => l.trim() !== '');
  const porLinea = new Map();
  for (const l of lineas) {
    // El código del local va PEGADO al final del nombre en la columna «Producto» («…Hot 10 LiteP-0211»)
    // y su forma es la del local: `P-####` (medido: **71** filas del archivo terminan así, todas con
    // código distinto). NO se usa el patrón genérico `[A-Za-z]{1,3}-\d{3,6}` para armar la expectativa:
    // como el código está pegado, ese patrón se come las últimas letras del nombre y devuelve códigos
    // inventados («…LiteP-0211» → «teP-0211», «…ORIGINALP-0744» → «ALP-0744») — le pasó a la primera
    // versión de esta comprobación, que falló dos veces culpando a la app (2026-10-05). La regla de
    // separación de verdad vive en Rust (`csvload::separar_codigo`) y es la que se mide en el PREVIEW;
    // acá sólo se cuenta qué códigos trae el archivo para exigir que no se pierda ni se invente ninguno.
    const col2 = (l.split(';')[1] ?? '').trim();
    const m = col2.match(/(P-\d{3,6})$/);
    if (m) porLinea.set(m[1], col2.slice(0, m.index).trim());
  }
  return porLinea;
})();

/**
 * LOS AVISOS DE COMPATIBILIDAD QUE QUEDAN (y que son DE VERDAD). Medido con el archivo del dueño: con
 * la comparación vieja eran **25, casi todos falsos positivos**; con la regla de F87 quedan **4**, y
 * los 4 son fichas cuya lista no nombra a su propio modelo. Fijarlos por número de línea del archivo
 * convierte el AC en un contrato (el mismo que afirma el test de Rust `test_f87_archivo_real_del_dueno`).
 */
const AVISOS_ESPERADOS = [30, 61, 62, 81];

/** El ancho de la ventana con el que arranca la app (y los dos que pide el AC-4). */
const ANCHOS_AC4 = [[1366, 715], [1200, 749]];

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};

// ── 0) entrar a la app (la copia viene con PIN de pruebas 1234) ────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await sleep(400);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// ── 1) la vista previa del BACKEND con su archivo (la verdad de los datos) ─────────────────────
const previa = await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('preview_inventory_csv', { text: ${JSON.stringify(CSV)}, mode: 'sumar' });
  const filas = p.rows || [];
  const busca = (t) => filas.find(r => String(r.name || '').includes(t)) || null;
  return {
    total: p.total_rows, nuevas: p.new_count, existentes: p.exists_count,
    codigos_recuperados: p.codigos_recuperados ?? null,
    columnas_repetidas: p.columnas_repetidas ?? null,
    ignoradas: p.columnas_ignoradas ?? p.ignored ?? null,
    avisos: filas.filter(r => r.aviso_compat === true).length,
    gt20: (() => { const r = busca('Gt 20 Pro INCELL'); return r ? { nombre: r.name, modelo: r.model, variante: r.variant, aviso: r.aviso_compat, code: r.code ?? null } : null; })(),
    spark20: (() => { const r = busca('Spark 20 Pro ORIGINAL'); return r ? { nombre: r.name, modelo: r.model, variante: r.variant, aviso: r.aviso_compat, code: r.code ?? null } : null; })(),
    conCodigo: filas.filter(r => String(r.code || '').trim() !== '').length,
    codigos: filas.map(r => String(r.code || '').trim()).filter(c => c !== ''),
    lineasAviso: filas.filter(r => r.aviso_compat === true).map(r => r.line),
    muestraCodigos: filas.slice(0, 4).map(r => ({ nombre: String(r.name || '').slice(0, 34), code: r.code ?? null })),
  };
})()`);

console.log('── datos (vista previa del backend con SU archivo) ──');
console.log(`   ${previa?.total} filas · ${previa?.nuevas} nuevas · ${previa?.existentes} a actualizar`);
console.log(`   avisos de compatibilidad: ${previa?.avisos} (antes del arreglo eran 25, casi todos falsos)`);
console.log(`   códigos recuperados: ${previa?.codigos_recuperados} · filas con código: ${previa?.conCodigo}/${previa?.total}`);
console.log(`   columnas repetidas: ${JSON.stringify(previa?.columnas_repetidas)} · ignoradas: ${JSON.stringify(previa?.ignoradas)}`);
console.log(`   ejemplo: ${JSON.stringify(previa?.muestraCodigos?.[0])}`);

check('AC-2: los códigos del local (P-02xx) que el archivo trae se recuperan TODOS',
  (() => {
    const traidos = new Set(previa?.codigos ?? []);
    const esperados = [...CODIGOS_ESPERADOS.keys()];
    const perdidos = esperados.filter(c => !traidos.has(c));
    const inventados = [...traidos].filter(c => !CODIGOS_ESPERADOS.has(c));
    return esperados.length > 0 && perdidos.length === 0 && inventados.length === 0
      && Number(previa?.codigos_recuperados) === esperados.length
      && Number(previa?.conCodigo) === esperados.length;
  })(),
  (() => {
    const traidos = new Set(previa?.codigos ?? []);
    const esperados = [...CODIGOS_ESPERADOS.keys()];
    const perdidos = esperados.filter(c => !traidos.has(c));
    const inventados = [...traidos].filter(c => !CODIGOS_ESPERADOS.has(c));
    return `${traidos.size}/${esperados.length} códigos del archivo en el preview`
      + ` (${previa?.total} filas, ${Number(previa?.total) - esperados.length} sin código en el Excel)`
      + ` · codigos_recuperados=${previa?.codigos_recuperados}`
      + ` · perdidos=${perdidos.length ? perdidos.join(',') : 'ninguno'}`
      + ` · inventados=${inventados.length ? inventados.join(',') : 'ninguno'}`;
  })());
check('AC-1: la ficha con la VARIANTE pegada en la etiqueta NO se avisa (era un falso positivo)',
  previa?.gt20 != null && previa.gt20.aviso !== true, JSON.stringify(previa?.gt20));
check('AC-1b: la ficha que de verdad es incoherente SÍ se avisa',
  previa?.spark20 != null && previa.spark20.aviso === true, JSON.stringify(previa?.spark20));
check('AC-1c: los avisos que quedan son EXACTAMENTE los 4 de verdad (antes: 25, casi todos falsos)',
  JSON.stringify(previa?.lineasAviso) === JSON.stringify(AVISOS_ESPERADOS),
  `líneas con aviso: ${JSON.stringify(previa?.lineasAviso)} (esperadas ${JSON.stringify(AVISOS_ESPERADOS)})`);
check('AC-3: el asistente sabe qué columnas descartó por repetir campo',
  Array.isArray(previa?.columnas_repetidas) && previa.columnas_repetidas.length >= 1,
  JSON.stringify(previa?.columnas_repetidas));

// ── 2) el MODAL con su archivo: abrir el asistente y pegar ─────────────────────────────────────
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /Ajustes/.test(t.innerText))`);
await sleep(1200);
const abrio = await evalx(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Cargar inventario por CSV|^Cargar CSV$/i.test(x.innerText.trim()));
  if (b) { b.click(); return true; } return false;
})()`);
await sleep(1800);
const hayDialogo = await waitFor(`!!document.querySelector('[data-csv-dialog]')`, 12000);
check('el asistente de carga abre desde Inventario → Ajustes', abrio && hayDialogo, `boton=${abrio} dialogo=${hayDialogo}`);

const pegarYRevisar = async () => {
  await evalx(`(() => {
    const t = document.querySelector('[data-csv-dialog] textarea');
    if (!t) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    s.call(t, ${JSON.stringify(CSV)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(2000);
  // El botón del paso «Archivo» se llama «Revisar el archivo» (y lleva `data-action="csv-revisar"`):
  // el script buscaba `/^Revisar$/i` y por eso NO avanzaba de paso — el fallo era de la prueba, no de
  // la app (medido 2026-10-05 con la sonda `data-action`). Se apunta al gancho estable y el texto
  // queda como respaldo, nunca como contrato (REQ-9).
  const clic = await evalx(`(() => {
    const d = document.querySelector('[data-csv-dialog]');
    if (!d) return 'sin diálogo';
    const b = d.querySelector('[data-action="csv-revisar"]')
      || [...d.querySelectorAll('button')].find(x => /^Revisar( el archivo)?$/i.test(x.innerText.trim()));
    if (!b) return 'sin botón Revisar';
    b.click();
    return 'ok';
  })()`);
  await waitFor(`!!document.querySelector('[data-csv-dialog] [data-csv-row]')`, 15000);
  await sleep(800);
  return clic;
};
const clicRevisar = await pegarYRevisar();
check('el paso «Revisar» se abre con el archivo pegado', clicRevisar === 'ok' && await evalx(`!!document.querySelector('[data-csv-dialog] [data-csv-row]')`), `boton=${clicRevisar}`);

/** Mide la revisión: ¿entra sin scroll lateral? ¿los avisos se ven? ¿está apilada? */
const MEDIR_REVISION = `(() => {
  const d = document.querySelector('[data-csv-dialog]');
  if (!d) return null;
  const tablas = [...d.querySelectorAll('table')];
  const t = tablas[0] || null;
  const cont = t ? t.parentElement : null;
  const caja = cont ? { ancho: cont.clientWidth, contenido: t.scrollWidth } : null;
  const filas = [...d.querySelectorAll('[data-csv-row]')];
  const avisos = [...d.querySelectorAll('[data-aviso-compat]')];
  // ¿el aviso está DENTRO del área visible del contenedor (sin arrastrar)?
  const visibles = avisos.filter(a => {
    const r = a.getBoundingClientRect();
    const c = cont ? cont.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    return r.width > 0 && r.left >= c.left - 1 && r.right <= c.right + 1;
  }).length;
  // ── los códigos, fila por fila (el dato que se perdía en las 83 fichas) ──────────────────────
  const codigos = filas.map(f => {
    const i = f.querySelector('[data-field="csv-code"]');
    const v = i ? String(i.value || '').trim() : '';
    const n = (f.querySelector('[data-field="csv-name"]')?.value ?? '');
    return { nombre: String(n).slice(0, 40), code: v, conCodigoPegado: /[A-Za-z]{1,3}-\\d{3,6}/.test(String(n)) };
  });
  return {
    ventana: window.innerWidth + 'x' + window.innerHeight,
    caja, scrollLateral: caja ? caja.contenido - caja.ancho : null,
    filas: filas.length, avisos: avisos.length, avisosVisibles: visibles,
    // apilada = la tabla se dibuja como bloque y NO hay encabezado (REQ-7/F85)
    apilada: !!t && !d.querySelector('thead') && getComputedStyle(t).display === 'block',
    columnas: t ? [...t.querySelectorAll('thead th')].map(h => h.innerText.trim()).filter(Boolean) : [],
    modo: d.querySelector('[data-csv-modo-activo]')?.getAttribute('data-csv-modo-activo') ?? null,
    resumen: [...d.querySelectorAll('[data-csv-total]')].map(e => e.innerText.trim()).slice(0, 6),
    codigosRecuperados: d.querySelector('[data-csv-codigos-recuperados]')?.getAttribute('data-csv-codigos-recuperados') ?? null,
    diceDelCodigo: /código/i.test(d.querySelector('[data-csv-aviso="codigos"]')?.innerText ?? ''),
    diceDeLaColumna: /Producto/i.test(d.querySelector('[data-csv-aviso="codigos"]')?.innerText ?? ''),
    codigos,
  };
})()`;

// ── AC-4 a los DOS anchos que pide la spec: 1366×715 y 1200 ────────────────────────────────────
// OJO CON LAS DOS PESTAÑAS: el paso «Revisar» reparte el archivo en «Nuevos» y «Ya existen», y
// `revisar()` abre la pestaña que TIENE fichas del catálogo (medido: 69 acá). Las 83 filas del dueño
// son la SUMA de las dos, así que una comprobación que sólo mire la pestaña abierta diría «faltan 14
// filas» con la app perfecta (le pasó a la primera versión de esta prueba).
const irATab = async (cual) => {
  await evalx(`(() => {
    const t = document.querySelector('[data-csv-dialog] [data-csv-tab="${cual}"]')?.closest('button');
    if (t) { t.click(); return true; } return false;
  })()`);
  await sleep(1200);
  await waitFor(`!!document.querySelector('[data-csv-dialog] [data-csv-row]')`, 10000);
};

let medicion = null;             // la del ancho de trabajo (1200)
const porTab = {};               // { existen: {filas, codigos[]}, nuevos: {...} }

for (const [w, h] of ANCHOS_AC4) {
  await setViewport(w, h);
  await sleep(1200);
  const m = await evalx(MEDIR_REVISION);
  if (!m) {
    check(`AC-4: el paso «Revisar» mide algo a ${w}`, false, 'no hay tabla en el asistente');
    continue;
  }
  console.log(`\n── el modal a ${m.ventana} ──`);
  console.log(`   columnas (${m.columnas.length}): ${m.columnas.join(' | ')}`);
  console.log(`   caja ${m.caja?.ancho} vs contenido ${m.caja?.contenido} · filas ${m.filas} · avisos ${m.avisos} (visibles ${m.avisosVisibles})`);
  console.log(`   modo ${m.modo} · resumen ${m.resumen.join(' · ')}`);
  check(`AC-4: el paso «Revisar» NO tiene scroll lateral a ${w}×${h}`, (m.scrollLateral ?? 9) <= 1,
    `caja=${m.caja?.ancho} contenido=${m.caja?.contenido} desborde=${m.scrollLateral}`);
  if (w === ANCHOS_AC4[ANCHOS_AC4.length - 1][0]) medicion = m;
}

if (medicion) {
  // Las dos pestañas, con su propio conteo y sus propios códigos.
  porTab.existen = { filas: medicion.filas, avisos: medicion.avisos, visibles: medicion.avisosVisibles, codigos: medicion.codigos.filter(c => c.code !== '') };
  await irATab('nuevos');
  const nuevos = await evalx(MEDIR_REVISION);
  porTab.nuevos = nuevos
    ? { filas: nuevos.filas, avisos: nuevos.avisos, visibles: nuevos.avisosVisibles, codigos: nuevos.codigos.filter(c => c.code !== '') }
    : { filas: 0, avisos: 0, visibles: 0, codigos: [] };
  await irATab('existen');

  const totalFilas = porTab.existen.filas + porTab.nuevos.filas;
  const totalAvisos = porTab.existen.avisos + porTab.nuevos.avisos;
  const totalVisibles = porTab.existen.visibles + porTab.nuevos.visibles;
  const enPantalla = [...porTab.existen.codigos, ...porTab.nuevos.codigos];
  const esperados = [...CODIGOS_ESPERADOS.keys()];
  const faltan = esperados.filter(c => !enPantalla.some(r => r.code === c));
  const sobra = enPantalla.filter(r => !CODIGOS_ESPERADOS.has(r.code));

  console.log(`\n── las dos pestañas de la revisión (a ${medicion.ventana}) ──`);
  console.log(`   «Ya existen»: ${porTab.existen.filas} filas · «Nuevos»: ${porTab.nuevos.filas} filas → ${totalFilas} de 83`);
  console.log(`   códigos en pantalla: ${enPantalla.length} de ${esperados.length} del archivo`);

  check('AC-0: el paso «Revisar» trae las 83 filas del archivo del dueño (las dos pestañas)',
    totalFilas === 83, `${porTab.existen.filas} + ${porTab.nuevos.filas} = ${totalFilas}`);
  check('AC-5: los avisos de las filas se ven SIN arrastrar nada',
    totalAvisos === 0 || totalVisibles === totalAvisos,
    `${totalVisibles}/${totalAvisos} avisos dentro del área visible (los 4 de verdad)`);
  check('AC-6: el modo del stock y el resumen siguen ahí',
    !!medicion.modo && medicion.resumen.length > 0, `modo=${medicion.modo} · resumen=${medicion.resumen.join(' · ')}`);
  check('AC-2b: cada fila muestra SU código en el campo «Código» (el que el dueño busca)',
    faltan.length === 0 && sobra.length === 0,
    `${enPantalla.length}/${esperados.length} códigos en pantalla · faltan=${faltan.length ? faltan.join(',') : 'ninguno'}`
    + ` · de más=${sobra.length ? sobra.map(s => s.code).join(',') : 'ninguno'}`);
  check('AC-8 (REQ-8): el asistente DICE de dónde salieron los códigos y qué columna descartó',
    medicion.codigosRecuperados === String(esperados.length) && medicion.diceDelCodigo && medicion.diceDeLaColumna,
    `data-csv-codigos-recuperados=${medicion.codigosRecuperados} · dice «código»=${medicion.diceDelCodigo} · nombra «Producto»=${medicion.diceDeLaColumna}`);
}

// ── 3) ventana ANGOSTA: la revisión se APILA y tampoco arrastra (REQ-7/AC-7) ────────────────────
for (const w of [1099, 900]) {
  await setViewport(w, 720);
  await sleep(1200);
  const angosta = await evalx(MEDIR_REVISION);
  check(`AC-7: a ${w} px la revisión se APILA y sigue sin scroll lateral`,
    !!angosta && angosta.apilada === true && (angosta.scrollLateral ?? 9) <= 1,
    angosta ? `apilada=${angosta.apilada} caja=${angosta.caja?.ancho} contenido=${angosta.caja?.contenido} desborde=${angosta.scrollLateral} filas=${angosta.filas}` : 'sin medición');
}
await resetViewport();

await keyNav('Escape', 'Escape', 27);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación NO aplica la carga (solo mira la vista previa y el asistente).');
process.exit(failed.length ? 1 : 0);
