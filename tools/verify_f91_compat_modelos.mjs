// VERIFICACIÓN EN VIVO (CDP) de F91 — LA COMPATIBILIDAD SE EDITA CON LA LISTA DE MODELOS.
//
// Pedido del dueño (2026-10-05): «sustituí la compatibilidad de producto [el campo de texto] y agregá
// allí los MODELOS-FICHA… que pueda editar (agregar o eliminar los modelos compatibles, CREANDO LA
// SECCIÓN QUE FALTA). De este modo unificamos en un solo lugar las compatibilidades: dejá inactivo el
// campo compatibilidades y sustituilo por la lista de modelos compatibles.»
//
// Qué comprueba (sobre una COPIA; devuelve el estado al terminar):
//   1. En «Editar producto» YA NO hay campo de texto: hay un SELECTOR con un chip por teléfono.
//   2. Quitar un teléfono con su ✕ y guardar → desaparece de la ficha de ese teléfono (Modelos).
//   3. Agregar uno buscándolo en el padrón → aparece en su ficha.
//   4. Crear uno que NO existe → queda en el padrón con su ficha; quitarlo lo saca.
//
// Uso:  app abierta con CDP 9222 y REGISTRO_DB=<copia>
//       node tools/verify_f91_compat_modelos.mjs

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

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

await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(2500);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

const irAInventario = async (tab) => {
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => /Inventario/i.test(b.innerText))`).catch(() => {});
  await sleep(1200);
  await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => new RegExp(${JSON.stringify(tab)}, 'i').test(t.innerText))`);
  await sleep(1500);
};
const buscarEnLista = async (texto) => {
  await evalx(`(() => { const i = [...document.querySelectorAll('input')].find(x => /Buscar/i.test(x.placeholder ?? '')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(texto)}); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
  await sleep(2200);
};
const abrirEdicion = async () => {
  await irAInventario('Productos');
  await buscarEnLista('Hot 30i');
  const ok = await evalx(`(() => {
    const fila = [...document.querySelectorAll('tbody tr')].find(f => /hot 30i/i.test(f.innerText));
    const b = fila ? [...fila.querySelectorAll('button')].find(x => /editar/i.test(x.getAttribute('aria-label') ?? x.title ?? '')) : null;
    if (b) { b.click(); return true; } return false;
  })()`);
  return ok && await waitFor(`!!document.querySelector('[data-compat-picker]')`, 12000);
};
const guardar = async () => {
  const ok = await evalx(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop();
    const b = [...d.querySelectorAll('button')].find(x => /^(actualizar|guardar)$/i.test((x.innerText || '').trim()));
    if (!b || b.disabled) return false;
    b.click(); return true;
  })()`);
  if (!ok) return false;
  await waitFor(`![...document.querySelectorAll('[role="dialog"]')].some(d => /Editar:/.test(d.innerText))`, 15000);
  await sleep(1200);
  return true;
};
/** Cuenta los repuestos de la ficha de un teléfono (Modelos → buscar → Ficha → leer). */
const fichaDe = async (telefono) => {
  await irAInventario('Modelos');
  await buscarEnLista(telefono);
  await evalx(`(() => {
    const f = [...document.querySelectorAll('tbody tr')].find(x => new RegExp(${JSON.stringify(telefono)}, 'i').test(x.innerText));
    const b = f ? [...f.querySelectorAll('button')].find(x => /^ficha$/i.test((x.innerText || '').trim())) : null;
    if (b) { b.click(); return true; } return false;
  })()`);
  await waitFor(`!!document.querySelector('[role="dialog"] table')`, 12000);
  await sleep(700);
  const r = await evalx(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!d) return null;
    const filas = [...d.querySelectorAll('tbody tr')].map(f => f.innerText.replace(/\\s+/g, ' ').trim());
    const m = d.innerText.match(/(\\d+)\\s+repuesto/);
    return { repuestos: m ? Number(m[1]) : filas.length, tieneHot30i: filas.some(f => /hot 30i/i.test(f)) };
  })()`);
  await keyNav('Escape', 'Escape', 27);
  await sleep(800);
  return r;
};

/** Quita de la compatibilidad el chip que matchee `re` (por nombre: el backend le antepone la marca). */
const quitarChip = async (re) => {
  await abrirEdicion();
  const q = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-compat-quitar]')]
      .find(x => new RegExp(${JSON.stringify(re)}, 'i').test(x.getAttribute('data-compat-quitar') ?? ''));
    if (!b) return null;
    b.click();
    return b.getAttribute('data-compat-quitar');
  })()`);
  await sleep(500);
  return { q, g: q ? await guardar() : false };
};
/** Cuántos teléfonos del padrón matchean el texto (sin filtrar por repuestos). */
const enElPadron = async (texto) => evalx(`(async () => {
  const ps = await window.__TAURI_INTERNALS__.invoke('get_phones',
    { brand: null, search: ${JSON.stringify(texto)}, onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 10, offset: 0 });
  return (ps.items ?? []).map(p => p.name);
})()`);

// ── 1) el campo de texto se fue y está el selector ─────────────────────────────────────────────
const abrio = await abrirEdicion();
const ui = await evalx(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].pop() ?? document;
  return {
    haySelector: !!d.querySelector('[data-compat-picker]'),
    hayCampoTexto: !!d.querySelector('[data-field="prod-compat"]') || [...d.querySelectorAll('textarea')].some(t => /Redmi Note 11/i.test(t.placeholder ?? '')),
    cantidad: d.querySelector('[data-compat-picker]')?.getAttribute('data-compat-cantidad') ?? null,
    chips: [...d.querySelectorAll('[data-compat-chip]')].map(c => c.getAttribute('data-compat-chip')),
  };
})()`);
console.log('── el editor de producto ──');
console.log(`   selector: ${ui?.haySelector} · campo de texto viejo: ${ui?.hayCampoTexto} · chips: ${ui?.cantidad}`);
console.log(`   teléfonos: ${JSON.stringify(ui?.chips)}`);
check('AC-1: «Editar producto» ya no tiene el campo de texto: tiene el SELECTOR con un chip por teléfono',
  abrio && ui?.haySelector === true && ui?.hayCampoTexto === false && Number(ui?.cantidad) >= 5,
  `${ui?.cantidad} chips · campo de texto: ${ui?.hayCampoTexto}`);

// ── 2) QUITAR con el ✕ del chip y guardar ──────────────────────────────────────────────────────
const quitado = await evalx(`(() => {
  const b = document.querySelector('[data-compat-quitar="Tecno Spark 10C"]');
  if (!b) return false;
  b.click(); return true;
})()`);
await sleep(600);
const guardo1 = await guardar();
const fichaSin = await fichaDe('Spark 10C');
console.log(`\n── quitar «Tecno Spark 10C» con el ✕ (${quitado ? 'clic' : 'no lo encontré'}) y guardar (${guardo1 ? 'ok' : 'falló'}) ──`);
console.log(`   ficha de «Spark 10C»: ${fichaSin?.repuestos} repuestos · ¿tiene el Hot 30i? ${fichaSin?.tieneHot30i}`);
check('AC-2: el ✕ del chip quita el teléfono y la ficha de ese teléfono lo refleja',
  quitado && guardo1 && fichaSin != null && fichaSin.tieneHot30i === false,
  `${fichaSin?.repuestos} repuestos · ¿Hot 30i? ${fichaSin?.tieneHot30i}`);

// ── 3) AGREGAR buscándolo en el padrón ────────────────────────────────────────────────────────
await abrirEdicion();
const agrego = await evalx(`(async () => {
  const i = document.querySelector('[data-compat-buscar]');
  if (!i) return 'sin buscador';
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, 'Spark 10C');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2500));
  const op = document.querySelector('[data-compat-opcion]');
  if (!op) return 'sin opciones';
  op.click();
  return 'agregado';
})()`);
await sleep(700);
const guardo2 = await guardar();
const fichaVuelta = await fichaDe('Spark 10C');
console.log(`\n── agregar «Spark 10C» desde el buscador del padrón (${agrego}) y guardar (${guardo2 ? 'ok' : 'falló'}) ──`);
console.log(`   ficha de «Spark 10C»: ${fichaVuelta?.repuestos} repuestos · ¿tiene el Hot 30i? ${fichaVuelta?.tieneHot30i}`);
check('AC-3: agregar desde el buscador del padrón devuelve el repuesto a la ficha de ese teléfono',
  agrego === 'agregado' && guardo2 && fichaVuelta?.tieneHot30i === true,
  `${fichaVuelta?.repuestos} repuestos`);

// ── 4) CREAR un modelo que no existe ──────────────────────────────────────────────────────────
const NUEVO = 'Sonda F91 Nueva';
// Pre-condición: el botón «Crear» solo aparece si el teléfono NO está en el padrón. Si una corrida
// anterior se cortó a la mitad, el teléfono de prueba quedó en la copia: se limpia primero para que
// esta comprobación mida la CREACIÓN y no herede el estado de la corrida pasada.
const previos = await enElPadron('Sonda F91');
if ((previos ?? []).length > 0) {
  const r = await quitarChip('sonda f91');
  console.log(`\n── (limpieza previa: ${r.q ? `quitado «${r.q}»` : 'no estaba en la compatibilidad'} · ${r.g ? 'guardado' : 'sin cambio'}) ──`);
}
await abrirEdicion();
const sinPrevio = (await enElPadron('Sonda F91') ?? []).length === 0;
const creo = await evalx(`(async () => {
  const i = document.querySelector('[data-compat-buscar]');
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(NUEVO)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2500));
  const b = document.querySelector('[data-compat-crear]');
  if (!b) return 'sin botón crear';
  b.click();
  return 'creado';
})()`);
await sleep(700);
const guardo3 = await guardar();
const estado = await evalx(`(async () => {
  const I = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const ps = await I('get_phones', { brand: null, search: 'Sonda F91', onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 10, offset: 0 });
  const fila = (ps.items ?? [])[0];
  const det = fila ? await I('get_phone_detail', { phoneId: fila.id }) : null;
  const filas = [];
  for (const b of (det?.blocks ?? [])) for (const it of (b.items ?? [])) filas.push(it.name);
  return { telefono: fila ? { name: fila.name, brand: fila.brand, products: fila.products } : null, ficha: filas };
})()`);
console.log(`\n── crear «${NUEVO}» (${creo}) y guardar (${guardo3 ? 'ok' : 'falló'}) ──`);
console.log(`   el padrón lo tiene: ${JSON.stringify(estado?.telefono)} · su ficha: ${JSON.stringify(estado?.ficha)}`);
check('AC-4: crear un modelo que no existía lo deja en el padrón con su ficha (con el repuesto)',
  sinPrevio && creo === 'creado' && guardo3 && !!estado?.telefono && (estado?.ficha ?? []).some(f => /hot 30i/i.test(f)),
  `no existía antes: ${sinPrevio} · ${JSON.stringify(estado)}`);

// ── 5) quitarlo y dejar todo como estaba ──────────────────────────────────────────────────────
// OJO (medido): el backend canoniza la compatibilidad con la MARCA del producto («Sonda F91 Nueva»
// queda «Tecno Sonda F91 Nueva»), así que el ✕ se busca por el nombre, no por el texto exacto.
const limpieza = await quitarChip('sonda f91');
const quitoNuevo = limpieza.q;
const guardo4 = limpieza.g;
const final = await evalx(`(async () => {
  const I = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const p = (await I('get_products', { search: 'Hot 30i', categoryId: 1 })).find(x => /Hot 30i/.test(String(x.name)));
  const ps = await I('get_phones', { brand: null, search: 'Sonda F91', onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 10, offset: 0 });
  return { compat: JSON.parse(p?.compatibility ?? '[]'), quedan: (ps.items ?? []).length };
})()`);
const ESPERADO = ['Infinix Hot 30i', 'Infinix Smart 7', 'Tecno Pop 7', 'Tecno Spark 10', 'Tecno Spark 10C', 'Tecno Spark Go 2023'];
const igual = JSON.stringify([...(final?.compat ?? [])].sort()) === JSON.stringify([...ESPERADO].sort());
console.log(`\n── limpieza (${quitoNuevo ? `quitado «${quitoNuevo}»` : 'no estaba'} · ${guardo4 ? 'guardado' : 'falló'}) ──`);
console.log(`   compatibilidad: ${JSON.stringify(final?.compat)} · teléfonos de prueba que quedan: ${final?.quedan}`);
check('AC-5: la prueba no deja residuos (compatibilidad como estaba y sin teléfonos de prueba)',
  igual && Number(final?.quedan) === 0, `compat igual: ${igual} · quedan: ${final?.quedan}`);

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (y devuelve el estado). Corré sobre una COPIA.');
process.exit(failed.length ? 1 : 0);
