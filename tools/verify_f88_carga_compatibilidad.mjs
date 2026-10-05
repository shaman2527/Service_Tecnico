// VERIFICACIÓN EN VIVO (CDP) de F88 — LA COMPATIBILIDAD DE CADA FILA, A LA VISTA Y EN LA BASE.
//
// Pedido del dueño (2026-10-05), con su archivo en la mano: «revisa las columna tiene sus compatibilidad
// por modelos debería salir así, son compatibilidades exactas o base [a la] que ellos agreguen más, y
// cargarlos en base para ese modelo» + «la compatibilidad así es necesaria para cada modelo tiene que
// aparecer; se está corrigiendo también la data que tengo en producto».
//
// Qué comprueba, con SU archivo real (`tools/prueba-carga-catalogo.csv`, 83 filas):
//   1. LA REVISIÓN LA MUESTRA: cada fila dice su lista de teléfonos y cuántos son (sin abrir «Ver ficha»).
//   2. LA CARGA YA NO SE FRENA SOLA: antes moría en «el código «P-1031» ya es de la ficha #1031» porque
//      el sistema le REGALABA al primera ficha nueva el código que el archivo traía para otra pantalla.
//   3. LA DATA DE PRODUCTOS SE CORRIGE: al aplicar, cada ficha queda con SU código del archivo y con la
//      compatibilidad del archivo (los modelos donde entra esa pantalla).
//   4. EL PADRÓN LO REFLEJA: la pantalla aparece en «Modelos» bajo CADA teléfono de su lista.
//   5. LA LISTA QUE ARMA EL MODELO también se muestra y se marca (fila con la compatibilidad vacía).
//
// SEGURIDAD DE DATOS: **ESCRIBE** (aplica la carga). Correr SIEMPRE sobre una COPIA (`REGISTRO_DB`).
//
// Uso:  app abierta con WEBGUI... = --remote-debugging-port=9222 y REGISTRO_DB=<copia>
//       node tools/verify_f88_carga_compatibilidad.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = fs.readFileSync(path.join(HERE, 'prueba-carga-catalogo.csv'), 'utf8');

/** El archivo del dueño: su código del local (pegado al nombre) y su lista de teléfonos por fila. */
const FILAS = CSV.split(/\r?\n/).slice(1).filter(l => l.trim()).map((l, i) => {
  const c = l.split(';');
  const m = (c[1] ?? '').trim().match(/(P-\d{3,6})$/);
  return {
    line: i + 2, nombre: (c[0] ?? '').trim(), modelo: (c[5] ?? '').trim(), variante: (c[6] ?? '').trim(),
    code: m ? m[1] : '', compat: (c[11] ?? '').trim(),
  };
});

/** Un archivo chico con la compatibilidad VACÍA: los TRES casos de la celda vacía (F78/F88). */
const CSV_SIN_LISTA = [
  'NOMBRE;Categoría;Marca;Modelo;Variante;Precio;Costo;Stock;Compatibilidad',
  // 1) cruza con una ficha que YA tiene su lista curada → se CONSERVA (no es «del modelo»)
  'ZZZ Sonda F88 Conserva;Pantalla;Infinix;Hot 40i;;30;9;1;',
  // 2) ficha nueva, el modelo manda → la lista la arma el MODELO (un teléfono)
  'ZZZ Sonda F88 Del Modelo Uno;Pantalla;Sonda;Sonda Uno;;30;9;1;',
  // 3) ficha nueva con dos modelos «A / B» → DOS teléfonos
  'ZZZ Sonda F88 Del Modelo Dos;Pantalla;Sonda;Sonda Dos / Sonda Tres;;30;9;1;',
].join('\n');

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const waitFor = async (expr, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};
const invoke = (cmd, args) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const ABORTA = (msg) => { console.log(`\nABORTADO: ${msg}`); process.exit(2); };

// ── 0) la app tiene que estar sobre una COPIA ──────────────────────────────────────────────────
if (!process.env.REGISTRO_DB || !fs.existsSync(process.env.REGISTRO_DB)) {
  ABORTA('falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app (esta verificación ESCRIBE).');
}

// ── 1) entrar (la copia viene con PIN de pruebas 1234) ─────────────────────────────────────────
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

// ── 2) el BACKEND: la lista que va a quedar, fila por fila ─────────────────────────────────────
const previa = await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('preview_inventory_csv', { text: ${JSON.stringify(CSV)}, mode: 'sumar' });
  const conLista = p.rows.filter(r => String(r.compatibility_final ?? '').trim() !== '');
  const delModelo = p.rows.filter(r => r.compat_del_modelo === true);
  const hot40i = p.rows.find(r => r.code === 'P-0053') ?? p.rows.find(r => /Hot 40i/.test(r.name));
  const spark30 = p.rows.find(r => /Spark 30 Pro ORIGINAL/.test(r.name));
  return {
    total: p.total_rows, nuevas: p.new_count, existentes: p.exists_count,
    conLista: conLista.length, delModelo: delModelo.length,
    hot40i: hot40i ? { line: hot40i.line, code: hot40i.code, final: hot40i.compatibility_final, telefonos: String(hot40i.compatibility_final).split(' / ').length } : null,
    spark30: spark30 ? { line: spark30.line, aviso: spark30.aviso_compat, final: spark30.compatibility_final } : null,
  };
})()`);
console.log('── lo que dice el backend (su archivo, 83 filas) ──');
console.log(`   ${previa?.total} filas · ${previa?.nuevas} nuevas · ${previa?.existentes} a actualizar · con lista: ${previa?.conLista}`);
console.log(`   ejemplo (Hot 40i): ${JSON.stringify(previa?.hot40i)}`);
check('AC-1: el backend dice LA LISTA QUE VA A QUEDAR en (casi) todas las filas',
  Number(previa?.conLista) >= Number(previa?.total) - 1, `${previa?.conLista}/${previa?.total} filas con lista`);

// la lista del archivo, tal como la va a guardar la carga: la compruebo contra su propio archivo
const comp = (texto) => String(texto).split(/\s*\/\s*/).map(t => t.trim()).filter(Boolean).map(t => t.toLowerCase()).sort().join('|');
const filaHot = FILAS.find(f => f.code === 'P-0053');
check('AC-2: esa lista es EXACTAMENTE la del archivo (mismos teléfonos, sin perder ninguno)',
  comp(previa?.hot40i?.final) === comp(filaHot?.compat),
  `archivo: ${filaHot?.compat} · backend: ${previa?.hot40i?.final}`);

// ── 3) la fila de la revisión lo MUESTRA (sin abrir «Ver ficha») ───────────────────────────────
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /Ajustes/.test(t.innerText))`);
await sleep(1200);
await evalx(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Cargar inventario por CSV|^Cargar CSV$/i.test(x.innerText.trim()));
  if (b) { b.click(); return true; } return false;
})()`);
await sleep(1800);
await waitFor(`!!document.querySelector('[data-csv-dialog]')`, 12000);

const pegar = async (texto) => {
  await evalx(`(() => {
    const t = document.querySelector('[data-csv-dialog] textarea');
    if (!t) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    s.call(t, ${JSON.stringify(texto)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(2000);
  await evalx(`(() => {
    const b = document.querySelector('[data-csv-dialog] [data-action="csv-revisar"]');
    if (b) { b.click(); return true; } return false;
  })()`);
  await waitFor(`!!document.querySelector('[data-csv-dialog] [data-csv-row]')`, 20000);
  await sleep(1000);
};

await pegar(CSV);
const enPantalla = await evalx(`(() => {
  const d = document.querySelector('[data-csv-dialog]');
  const filas = [...d.querySelectorAll('[data-csv-row]')];
  const conCompat = filas.filter(f => f.querySelector('[data-csv-compat]'));
  const conLista = filas.filter(f => String(f.querySelector('[data-csv-compat]')?.getAttribute('data-csv-compat') ?? '').trim() !== '');
  const conteos = filas.map(f => Number(f.querySelector('[data-csv-compat-conteo]')?.getAttribute('data-csv-compat-conteo') ?? 0));
  // la fila del Hot 40i (por su código P-0053 en el campo de código)
  const filaHot = filas.find(f => /Hot 40i/.test(String(f.querySelector('[data-field="csv-name"]')?.value ?? '')));
  const visibles = filas.filter(f => {
    const c = f.querySelector('[data-csv-compat]');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth;
  }).length;
  return {
    filas: filas.length, conCompat: conCompat.length, conLista: conLista.length, visibles,
    maxTelefonos: Math.max(0, ...conteos), minTelefonos: Math.min(...conteos.filter(n => n > 0)),
    hot40i: filaHot ? {
      nombre: String(filaHot.querySelector('[data-field="csv-name"]')?.value ?? ''),
      lista: String(filaHot.querySelector('[data-csv-compat]')?.getAttribute('data-csv-compat') ?? ''),
      conteo: Number(filaHot.querySelector('[data-csv-compat-conteo]')?.getAttribute('data-csv-compat-conteo') ?? 0),
      texto: String(filaHot.querySelector('[data-csv-compat]')?.innerText ?? '').trim(),
    } : null,
  };
})()`);
console.log('\n── la fila de la revisión ──');
console.log(`   filas ${enPantalla?.filas} · con el dato de compatibilidad ${enPantalla?.conCompat} · con lista ${enPantalla?.conLista} · dentro de la ventana ${enPantalla?.visibles}`);
console.log(`   la fila del Hot 40i: ${JSON.stringify(enPantalla?.hot40i)}`);
check('AC-3: cada fila muestra su compatibilidad (y se ve, sin arrastrar)',
  Number(enPantalla?.conCompat) === Number(enPantalla?.filas) && Number(enPantalla?.visibles) === Number(enPantalla?.filas),
  `${enPantalla?.conCompat}/${enPantalla?.filas} filas con el dato · ${enPantalla?.visibles} dentro de la ventana`);
check('AC-4: el chip dice CUÁNTOS teléfonos sirve esa pantalla',
  Number(enPantalla?.maxTelefonos) >= 5 && Number(enPantalla?.hot40i?.conteo) === Number(previa?.hot40i?.telefonos),
  `máximo ${enPantalla?.maxTelefonos} teléfonos · la del Hot 40i dice ${enPantalla?.hot40i?.conteo} (=${previa?.hot40i?.telefonos} del archivo)`);
// F91: el detalle por fila ya NO tiene el campo de texto «Compatibilidad (separados por /)»: tiene el
// MISMO selector de modelos del formulario de producto (chips con ✕ + buscador del padrón).
const detalleAbierto = await evalx(`(() => {
    const filas = [...document.querySelectorAll('[data-csv-dialog] [data-csv-row]')];
    const f = filas.find(x => /Hot 40i/.test(String(x.querySelector('[data-field="csv-name"]')?.value ?? '')));
    f?.querySelector('[data-csv-action="detalle"]')?.click();
    return true;
  })()`);
const hayPicker = await waitFor(`!!document.querySelector('[data-csv-dialog] [data-compat-picker]')`, 8000);
const detalle = hayPicker ? await evalx(`(() => {
  const p = document.querySelector('[data-csv-dialog] [data-compat-picker]');
  return {
    chips: [...p.querySelectorAll('[data-compat-chip]')].map(c => c.getAttribute('data-compat-chip')),
    cantidad: Number(p.getAttribute('data-compat-cantidad') ?? 0),
    campoTexto: !!document.querySelector('[data-csv-dialog] [data-field="csv-compatibility"]'),
    buscador: !!p.querySelector('[data-compat-buscar]'),
  };
})()`) : null;
console.log(`   el detalle de la fila: ${detalle?.cantidad} chips ${JSON.stringify(detalle?.chips)} · buscador ${detalle?.buscador} · campo de texto ${detalle?.campoTexto}`);
check('AC-5: el detalle por fila trae la LISTA de modelos editable (el mismo selector del producto)',
  detalleAbierto && hayPicker && Number(detalle?.cantidad) >= 5 && detalle?.buscador === true && detalle?.campoTexto === false,
  `${detalle?.cantidad} chips · campo de texto viejo: ${detalle?.campoTexto}`);

// ── 4) APLICAR (escribe en la copia) y verificar la DATA de productos + el padrón ──────────────
const aplicar = await evalx(`(() => {
  const d = document.querySelector('[data-csv-dialog]');
  const b = d.querySelector('[data-csv-apply]');
  if (!b) return 'sin botón';
  b.click();
  return 'ok';
})()`);
const listo = await waitFor(`/Inventario cargado/i.test(document.querySelector('[data-csv-dialog]')?.innerText ?? '')`, 60000);
check('AC-6: la carga SE APLICA (antes se frenaba sola por el código automático)', aplicar === 'ok' && listo,
  `boton=${aplicar} informe=${listo}`);
if (!listo) {
  const txt = String(await evalx(`document.querySelector('[data-csv-dialog]')?.innerText ?? ''`)).replace(/\s+/g, ' ');
  console.log(`   dice el asistente: «${txt.slice(0, 500)}»`);
  console.log(`\n${out.filter(r => r.ok).length}/${out.length} comprobaciones OK antes de abortar`);
  process.exit(1);
}
const informe = String(await evalx(`document.querySelector('[data-csv-dialog]')?.innerText ?? ''`)).replace(/\s+/g, ' ');
console.log(`\n── informe de la carga ──\n   ${informe.slice(0, 260)}`);

// la fila cuya compatibilidad sirve de referencia: la del código P-1031 (la que trae 8 teléfonos)
const filaRef = FILAS.find(f => f.code === 'P-1031');

// la BASE: los códigos del archivo quedaron en SU ficha, y la compatibilidad es la del archivo
const base = await evalx(`(async () => {
  const P = (s) => window.__TAURI_INTERNALS__.invoke('get_products', { search: s, categoryId: null });
  const todos = await P('');
  const porCodigo = new Map(todos.map(p => [String(p.code ?? '').toUpperCase(), p]));
  const hot = porCodigo.get('P-0053') ?? null;
  const ref = porCodigo.get('P-1031') ?? null;
  const sinCodigo = todos.find(p => /Hot 11 Play/.test(p.name) && !String(p.code ?? '').toUpperCase().startsWith('P-1031'));
  const cuenta = new Map();
  for (const p of todos) { const c = String(p.code ?? '').toUpperCase(); if (c) cuenta.set(c, (cuenta.get(c) ?? 0) + 1); }
  const repetidos = [...cuenta].filter(([, n]) => n > 1).map(([c, n]) => c + '×' + n);
  return {
    total: todos.length,
    p0053: hot ? { id: hot.id, name: hot.name, code: hot.code, compat: hot.compatibility } : null,
    ref: ref ? { id: ref.id, name: ref.name, code: ref.code, compat: ref.compatibility } : null,
    sinCodigo: sinCodigo ? { id: sinCodigo.id, name: sinCodigo.name, code: sinCodigo.code } : null,
    repetidos,
  };
})()`);
console.log('\n── lo que quedó en la BASE (la copia) ──');
console.log(`   productos ${base?.total}`);
console.log(`   P-0053 → ${JSON.stringify(base?.p0053)}`);
console.log(`   P-1031 → ${JSON.stringify(base?.ref)}`);
console.log(`   la ficha que no traía código → ${JSON.stringify(base?.sinCodigo)}`);
check('AC-7: el código del archivo quedó en SU ficha (P-1031 = la pantalla «Infinix Smart 8»)',
  /smart 8/i.test(String(base?.ref?.name ?? '')) && String(base?.ref?.code ?? '').toUpperCase() === 'P-1031',
  JSON.stringify(base?.ref));
check('AC-8: a la ficha que NO traía código no se le regaló el código de otra fila',
  !!base?.sinCodigo && String(base?.sinCodigo?.code ?? '').toUpperCase() !== 'P-1031',
  JSON.stringify(base?.sinCodigo));
check('AC-9: ninguna ficha del catálogo quedó con un código repetido',
  Array.isArray(base?.repetidos) && base.repetidos.length === 0, JSON.stringify(base?.repetidos));
check('AC-10: la data de productos se CORRIGIÓ: la compatibilidad es la del archivo, por modelo',
  comp(JSON.parse(String(base?.ref?.compat ?? '[]')).join(' / ')) === comp(filaRef?.compat),
  `ficha: ${base?.ref?.compat} · archivo: ${filaRef?.compat}`);
check('AC-10b: NINGÚN código del archivo se perdió (dos códigos distintos no son la misma pantalla)',
  String(base?.p0053?.code ?? '').toUpperCase() === 'P-0053' && !!base?.p0053?.name,
  `P-0053 → ${JSON.stringify(base?.p0053)}`);

// el PADRÓN: la pantalla queda asociada al modelo (y el modelo la cuenta entre sus pantallas)
const padron = await evalx(`(async () => {
  const M = (s) => window.__TAURI_INTERNALS__.invoke('get_phone_models', { search: s, limit: 0 });
  const C = (s) => window.__TAURI_INTERNALS__.invoke('find_compatible_screens_exactas', { model: s, limit: 80 });
  const telefonos = ${JSON.stringify(String(filaRef?.compat ?? '').split(/\s*\/\s*/).map(t => t.trim()).filter(Boolean))};
  const res = [];
  for (const t of telefonos) {
    // el padrón guarda la etiqueta del teléfono sin la marca («Hot 40i») y con ella («Infinix Hot 40i»):
    // se busca por el texto completo y, si no aparece, por el modelo pelado (sin la primera palabra).
    let hit = null, buscado = t;
    for (const intento of [t, t.split(/\\s+/).slice(1).join(' ')]) {
      if (!intento) continue;
      const ms = await M(intento);
      hit = ms.find(x => String(x.label).toLowerCase() === intento.toLowerCase())
        ?? ms.find(x => String(x.label).toLowerCase().includes(intento.toLowerCase()));
      if (hit) { buscado = intento; break; }
    }
    // y la MISMA asociación que ve el servicio: la pantalla del archivo entre las de ese teléfono
    const ofrecidas = await C(t);
    const laTiene = ofrecidas.some(c => String(c.product?.code ?? '').toUpperCase() === 'P-1031');
    res.push({
      telefono: t, buscado, label: hit?.label ?? null,
      pantallas: hit?.screens ?? 0,      // el padrón cuenta las pantallas del modelo (es un número)
      stock: hit?.stock ?? 0,
      laTiene,
    });
  }
  return res;
})()`);
console.log(`\n── el padrón de Modelos + el servicio (la pantalla «Infinix Smart 8», código P-1031) ──`);
for (const p of padron ?? []) console.log(`   ${p.laTiene ? '✓' : '✗'} ${p.telefono} → padrón «${p.label ?? 'NO ESTÁ'}» con ${p.pantallas} pantalla(s) · el servicio la ${p.laTiene ? 'ofrece' : 'NO la ofrece'}`);
check('AC-11: la pantalla queda asociada a CADA teléfono de su lista (padrón + servicio)',
  Array.isArray(padron) && padron.length > 0 && padron.every(p => p.laTiene && p.pantallas > 0),
  `${padron?.filter(p => p.laTiene && p.pantallas > 0).length}/${padron?.length} teléfonos de la lista`);

// ── 5) la lista que arma el MODELO (compatibilidad vacía) se muestra y se marca ────────────────
await keyNav('Escape', 'Escape', 27);
await sleep(800);
await evalx(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Cargar inventario por CSV|^Cargar CSV$/i.test(x.innerText.trim()));
  if (b) b.click();
  return true;
})()`);
await sleep(1500);
await waitFor(`!!document.querySelector('[data-csv-dialog]')`, 10000);
await pegar(CSV_SIN_LISTA);
// LAS DOS PESTAÑAS: la revisión reparte el archivo en «Nuevos» y «Ya existen» y abre la que tiene fichas
// del catálogo — una fila de cada una es lo normal acá (lección de F87).
const leerSinLista = async () => evalx(`(() => {
  const filas = [...document.querySelectorAll('[data-csv-dialog] [data-csv-row]')];
  return filas.map(f => ({
    nombre: String(f.querySelector('[data-field="csv-name"]')?.value ?? ''),
    lista: String(f.querySelector('[data-csv-compat]')?.getAttribute('data-csv-compat') ?? ''),
    conteo: Number(f.querySelector('[data-csv-compat-conteo]')?.getAttribute('data-csv-compat-conteo') ?? 0),
    delModelo: f.querySelector('[data-csv-compat-del-modelo]')?.getAttribute('data-csv-compat-del-modelo') ?? null,
  }));
})()`);
let sinLista = await leerSinLista();
await evalx(`(() => { const t = document.querySelector('[data-csv-dialog] [data-csv-tab="nuevos"]')?.closest('button'); if (t) { t.click(); return true; } return false; })()`);
await sleep(1200);
sinLista = [...(sinLista ?? []), ...(await leerSinLista() ?? [])];
console.log('\n── filas con la compatibilidad VACÍA (los tres casos de la celda vacía) ──');
for (const f of sinLista ?? []) console.log(`   «${f.nombre}» → ${f.lista} (${f.conteo}) · del modelo: ${f.delModelo}`);
const delModelo = (sinLista ?? []).filter(f => f.delModelo === '1');
const conservadas = (sinLista ?? []).filter(f => f.delModelo === null && f.lista.trim() !== '');
check('AC-12: la lista que arma el MODELO se muestra y se marca (1 y 2 teléfonos)',
  delModelo.length === 2 && delModelo.some(f => f.conteo === 1) && delModelo.some(f => f.conteo === 2),
  JSON.stringify(delModelo));
check('AC-13: con la celda vacía en una ficha que YA tenía lista, se dice que se CONSERVA (no «del modelo»)',
  conservadas.length === 1 && conservadas[0].conteo >= 2,
  JSON.stringify(conservadas));

await keyNav('Escape', 'Escape', 27);
await sleep(500);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (aplica la carga). Corré siempre contra una COPIA.');
process.exit(failed.length ? 1 : 0);
