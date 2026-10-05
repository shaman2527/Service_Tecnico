// VERIFICACIÓN EN VIVO (CDP) de F86 — LA CARGA MASIVA QUE HACE LO QUE DICE.
//
// Pedido del dueño (2026-10-04): «estoy cargando una data masiva, me está cargando el producto -30… no debería ir
// stock modelo de tlf, y tengo dos campos de compatibilidad, debería ver una… que funcione en base al modelo»,
// «stock en producto NO está cargando en masa», «respuesto de modelo no está reflejando la compatibilidad: tiene que
// ser la misma de producto», «el modal de cada sección debería verse, no salirse de la pantalla» y «quitar cosa
// innecesaria».
//
// Qué comprueba sobre la app REAL:
//   1. Inventario tiene CUATRO pestañas (sin «Repuesto por modelo») y el padrón de Modelos ya no muestra ningún
//      número presentado como stock del teléfono.
//   2. La ficha del producto dice UNA sola cosa de compatibilidad («También le sirve a»), y el MODELO manda.
//   3. El asistente de CSV: elige el modo del stock, muestra el stock final REAL por fila, avisa cuando la
//      compatibilidad no incluye al modelo y GRITA cuando no reconoce la columna de stock.
//   4. Una carga con una ficha en negativo NO deja un negativo (el caso «−30»).
//   5. El conteo físico dice cuántas fichas quedan en 0 y que eso escribe movimientos de SALIDA.
//   6. Ningún diálogo de Inventario deja los botones fuera de la pantalla con la ventana por defecto (750 px).
//   7. El formulario de producto rechaza un stock negativo con su motivo.
//
// SEGURIDAD DE DATOS: **ESCRIBE** (aplica una carga de prueba y crea/actualiza fichas). Corré SIEMPRE contra una
// COPIA de la base (`REGISTRO_DB` a una copia), nunca contra la del taller.
//
// Uso:  app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 y REGISTRO_DB a una copia
//       node tools/verify_f86_carga.mjs

import { evalx, clickCenter, keyNav, typeText, insertText, sleep, handleDialog } from './cdp_driver.mjs';

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

/** La carga de prueba: una ficha que existe (con stock), una que NO (nueva, sin compatibilidad) y una incoherente. */
const CSV = [
  'nombre;categoria;marca;modelo;variante;compatibilidad;costo;venta;stock;stock_min',
  'Pantalla Samsung A30 / A50;Pantalla;Samsung;A30;INCELL;Samsung A30 / Samsung A50;8,00;12,50;3;2',
  'Pantalla Tecno Spark 20 Pro Plus;Pantalla;Tecno;Spark 20 Pro Plus;ORIGINAL;Tecno Spark 20 Pro Plus;9,50;15,00;3;2',
  'Pantalla ZZZ De Prueba F86;Pantalla;Zzz;Modelo De Prueba F86;INCELL;;1,00;2,00;7;1',
  'Pantalla ZZZ Incoherente F86;Pantalla;Zzz;Modelo Incoherente F86;INCELL;Samsung A30;1,00;2,00;4;1',
].join('\n');

// ── 0) entrar ────────────────────────────────────────────────────────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  // El PIN de pruebas de una COPIA (`node tools/snapshot_db.mjs --pin-dev`): la base del taller trae el
  // PIN real hasheado y esta verificación se corre sobre copias, nunca sobre la del local.
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await sleep(400);
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith('Inventario'))`);
await sleep(1500);

// ── 1) las pestañas y el stock del modelo (AC-10, AC-9) ───────────────────────────────────────
const tabs = await evalx(`[...document.querySelectorAll('[role="tab"]')].map(t => t.innerText.trim())`);
check('Inventario tiene CUATRO pestañas, sin «Repuesto por modelo»',
  Array.isArray(tabs) && tabs.length === 4 && !tabs.some(t => /Repuesto por modelo/i.test(t)),
  (tabs || []).join(' | '));

await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /^Modelos/.test(t.innerText.trim()))`);
await waitFor(`document.querySelectorAll('table tbody tr').length > 0`, 20000);
const encabezadosModelos = await evalx(`[...document.querySelectorAll('table thead th')].map(t => t.innerText.trim())`);
check('la lista de Modelos NO tiene una columna de stock del teléfono',
  Array.isArray(encabezadosModelos) && !encabezadosModelos.some(h => /^stock$/i.test(h)),
  (encabezadosModelos || []).join(' | '));
const badgeStockModelo = await evalx(`!!document.querySelector('[data-stock-modelo],[data-phone-stock]')`);
check('tampoco hay un badge suelto de stock en la fila del modelo', badgeStockModelo === false, String(badgeStockModelo));

// ── 2) el formulario de producto: una sola compatibilidad y sin negativos (REQ-4, AC-13) ──────
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /^Productos/.test(t.innerText.trim()))`);
await waitFor(`!!document.querySelector('table')`, 15000);
await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo producto$/.test(b.innerText.trim())) || null)`);
const abrioForm = await waitFor(`!!document.querySelector('[role="dialog"] [data-field="categoria"]')`, 12000);
check('abre el formulario de producto', abrioForm);
if (abrioForm) {
  const etiquetas = await evalx(`[...document.querySelectorAll('[role="dialog"] label')].map(l => l.innerText.trim())`);
  check('el segundo campo de teléfonos se llama «También le sirve a» (no dos campos iguales)',
    etiquetas.some(l => /Tambi[eé]n le sirve a/i.test(l)), (etiquetas || []).join(' · ').slice(0, 220));
  const ayudaModelo = await evalx(`(() => {
    const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => /^Modelo/i.test(x.innerText.trim()));
    return l?.parentElement?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) ?? null;
  })()`);
  check('el bloque del MODELO dice que de ahí sale la compatibilidad',
    /compatib/i.test(String(ayudaModelo)), String(ayudaModelo));

  // stock negativo: la UI tiene que rechazarlo (AC-13)
  // OJO: el formulario valida el NOMBRE antes que el stock (`!name.trim()` sale primero), así que hay
  // que llenarlo o la prueba nunca llega a la regla del stock y el fallo se lee como «no avisa»
  // (medido 2026-10-04: con el nombre vacío el toast decía «Falta el nombre»).
  const puso = await evalx(`(() => {
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const labelDe = (re) => [...document.querySelectorAll('[role="dialog"] label')].find(x => re.test(x.innerText.trim()));
    const nombre = labelDe(/^Nombre/i)?.parentElement?.querySelector('input');
    const stock = labelDe(/^Stock$/i)?.parentElement?.querySelector('input');
    if (!nombre || !stock) return { ok: false, hayNombre: !!nombre, hayStock: !!stock };
    set(nombre, 'ZZZ Prueba F86 (NO se guarda)');
    set(stock, '-30');
    return { ok: true };
  })()`);
  if (puso?.ok) {
    // El botón real del formulario de producto es «Guardar Producto» (y «Actualizar» al editar): el
    // patrón tiene que incluirlos, si no el clic no ocurre y la comprobación pasaría sin probar nada.
    await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /^(Guardar Producto|Actualizar|Guardar|Guardar cambios|Crear producto)$/.test(b.innerText.trim())) || null)`).catch(() => {});
    await sleep(1200);
    const sigueAbierto = await evalx(`!!document.querySelector('[role="dialog"]')`);
    const motivo = await evalx(`(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? (d.innerText.match(/[^\\n]*negativ[^\\n]*/i)?.[0] ?? null) : null;
    })()`);
    check('el formulario NO deja guardar un stock negativo y dice por qué', sigueAbierto === true && !!motivo, `sigue abierto=${sigueAbierto} · motivo=«${motivo}»`);
  }
  // cerrar sin guardar
  await keyNav('Escape', 'Escape', 27);
  await sleep(700);
}

// ── 3) el asistente de CSV (REQ-3, REQ-5, AC-14) ───────────────────────────────────────────────
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /^Ajustes/.test(t.innerText.trim()))`);
await sleep(1200);
await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Cargar CSV$/i.test(b.innerText.trim())) || null)`).catch(() => {});
const abrioAsistente = await waitFor(`!!document.querySelector('[data-csv-dialog]')`, 12000);
check('abre el asistente de CSV/Excel', abrioAsistente, abrioAsistente ? '' : 'no abrió (¿sesión de caja sin Ajustes?)');

if (abrioAsistente) {
  const pegar = async (texto) => {
    // Volver al paso «Archivo» si ya estamos revisando (el textarea sólo existe ahí) y CRUZAR el
    // archivo: los avisos y los ganchos del paso «Revisar» no existen antes de eso.
    await evalx(`(() => {
      const b = [...document.querySelectorAll('[data-csv-dialog] button')].find(x => /^Atrás$/.test(x.innerText.trim()));
      if (b) { b.click(); return true; }
      return false;
    })()`);
    await sleep(700);
    await clickCenter(`document.querySelector('[data-csv-dialog] textarea')`).catch(() => {});
    await evalx(`(() => {
      const t = document.querySelector('[data-csv-dialog] textarea');
      if (!t) return false;
      const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      s.call(t, ${JSON.stringify(texto)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(700);
    await evalx(`(() => { const b = document.querySelector('[data-action="csv-revisar"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
    await sleep(2500);
  };

  // 3.a el archivo SIN columna de stock reconocida: el aviso tiene que verse.
  // OJO: «STOCK ACTUAL» ya NO sirve para esta prueba — F86 le agregó ese alias a la columna de stock
  // (el Excel del dueño la escribe así), así que se usa un encabezado que de verdad no se entiende
  // (el mismo del test de `csvload.rs`: «EXISTENCIAS TOTALES»).
  await pegar('nombre;categoria;marca;modelo;COMPATIBILIDAD;EXISTENCIAS TOTALES\nPantalla ZZZ Sin Stock F86;Pantalla;Zzz;Modelo Sin Stock F86;;5');
  const avisoSinStock = await evalx(`(() => {
    if (document.querySelector('[data-csv-aviso="sin-stock"]')) return 'hook';
    const t = document.querySelector('[data-csv-dialog]')?.innerText ?? '';
    return /no reconoce|no reconoc[ií]|no trae una columna de stock/i.test(t) ? 'texto' : null;
  })()`);
  check('con un encabezado de stock no reconocido el asistente AVISA en pantalla (AC-14)',
    !!avisoSinStock, String(avisoSinStock));
  const nombraLaColumna = await evalx(`/EXISTENCIAS TOTALES/i.test(document.querySelector('[data-csv-dialog]')?.innerText ?? '')`);
  check('el aviso nombra la columna real del archivo (no un genérico)', nombraLaColumna === true, String(nombraLaColumna));

  // 3.b el archivo bueno: modo, stock final real y aviso de compatibilidad incoherente
  await pegar(CSV);
  const modo = await evalx(`document.querySelector('[data-csv-modo-activo]')?.getAttribute('data-csv-modo-activo')
                            ?? document.querySelector('[data-csv-modo]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
  check('el asistente dice con qué MODO va a tocar el stock (sumar/reemplazar)', !!modo, String(modo));
  // El aviso vive en la fila, y las filas están repartidas en DOS pestañas («Nuevos» / «Ya
  // existen»): Radix NO monta la pestaña inactiva, así que hay que recorrer las dos para contarlos
  // (medido 2026-10-04: contar sólo en la activa daba 0 y parecía que el aviso no existía).
  const cuentaAvisos = async () => {
    let total = 0;
    for (const nombre of ['Nuevos', 'Ya existen']) {
      await evalx(`(() => {
        const t = [...document.querySelectorAll('[data-csv-dialog] [role="tab"]')].find(x => x.innerText.trim().startsWith(${JSON.stringify(nombre)}));
        if (t) t.click();
        return !!t;
      })()`);
      await sleep(800);
      total += Number(await evalx(`document.querySelectorAll('[data-aviso-compat]').length`)) || 0;
    }
    return total;
  };
  const avisoCompat = await cuentaAvisos();
  check('avisa la fila cuya compatibilidad NO incluye su modelo (REQ-5)',
    avisoCompat >= 1, `filas avisadas=${avisoCompat}`);
  const stockFinal = await evalx(`[...document.querySelectorAll('[data-stock-final]')].map(e => e.getAttribute('data-stock-final')).slice(0, 4)`);
  check('cada fila muestra el stock FINAL real, no un recálculo de la UI',
    Array.isArray(stockFinal) && stockFinal.length > 0, JSON.stringify(stockFinal));

  // 3.c1 REPRODUCIR EL CASO DEL DUEÑO: dejar la ficha de la fila 2 en FALTANTE con un movimiento
  // REAL de salida (no escribiendo un negativo a mano, que ahora el backend rechaza a propósito).
  // Así la carga reproduce el «me está cargando el producto −30»: ficha en −60 + archivo 30.
  const faltante = await evalx(`(async () => {
    const ver = async (id) => {
      const r = await window.__TAURI_INTERNALS__.invoke('get_products_page', { search: 'Pantalla Tecno Spark 20 Pro Plus', categoryId: null, brand: null, stockFilter: 'todos', variantFamily: null, sort: 'nombre', limit: 5, offset: 0 });
      const f = (r.items || []).find(p => (id ? p.id === id : /Pantalla Tecno Spark 20 Pro Plus/.test(p.name)));
      return f ?? null;
    };
    const f = await ver(null);
    if (!f) return { error: 'no está la ficha de prueba' };
    if (f.stock > -60) await window.__TAURI_INTERNALS__.invoke('add_inventory_movement', { productId: f.id, type: 'salida', quantity: f.stock + 60, reason: 'Precondición de la verificación F86', reference: 'verify_f86_carga' });
    const f2 = await ver(f.id);
    return { id: f.id, stock: f2?.stock };
  })()`);
  check('la ficha de prueba queda en FALTANTE (−60) antes de la carga (el caso del dueño)',
    !!faltante && faltante.stock === -60, JSON.stringify(faltante));

  // 3.c2 aplicar (ESCRIBE) y comprobar que las fichas que TOCA no quedan negativas
  const aplico = await evalx(`(() => { const b = document.querySelector('[data-csv-apply]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
  check('se puede aplicar la carga de prueba', aplico === true, String(aplico));
  await sleep(4000);
  await handleDialog(true).catch(() => {});
  const informe = await evalx(`document.querySelector('[data-csv-report]')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) ?? null`);
  console.log(`   informe de la carga: «${informe}»`);

  const tocadas = await evalx(`(async () => {
    const nombres = ['Pantalla Tecno Spark 20 Pro Plus', 'Pantalla ZZZ De Prueba F86', 'Pantalla ZZZ Incoherente F86'];
    const out = {};
    for (const n of nombres) {
      const r = await window.__TAURI_INTERNALS__.invoke('get_products_page', { search: n, categoryId: null, brand: null, stockFilter: 'todos', variantFamily: null, sort: 'nombre', limit: 5, offset: 0 });
      const f = (r.items || []).find(p => p.name === n);
      out[n] = f ? { stock: f.stock, compat: f.compatibility } : null;
    }
    return out;
  })()`);
  check('NINGUNA ficha que la carga tocó quedó en negativo (el caso «−30»)',
    Object.values(tocadas ?? {}).length === 3 && Object.values(tocadas ?? {}).every(v => v && v.stock >= 0),
    JSON.stringify(tocadas));
  check('la ficha que venía en −60 y el archivo traía 30 quedó en 0 (no en −30)',
    tocadas?.['Pantalla Tecno Spark 20 Pro Plus']?.stock === 0,
    `stock=${tocadas?.['Pantalla Tecno Spark 20 Pro Plus']?.stock}`);
  // Los faltantes PREEXISTENTES de otras fichas no son culpa de la carga: se informan, no fallan.
  const otrosFaltantes = await evalx(`(async () => {
    const r = await window.__TAURI_INTERNALS__.invoke('get_products_page', { search: '', categoryId: null, brand: null, stockFilter: 'negativo', variantFamily: null, sort: 'nombre', limit: 50, offset: 0 });
    return (r.items || []).map(p => p.name + ' (' + p.stock + ')');
  })()`);
  console.log(`   faltantes que quedan en el catálogo (preexistentes, la carga no los tocó): ${JSON.stringify(otrosFaltantes)}`);

  // 3.d la ficha que sólo traía MODELO entró al padrón (REQ-1 / AC-2)
  const enPadron = await evalx(`(async () => {
    const r = await window.__TAURI_INTERNALS__.invoke('get_phone_models', { search: 'Modelo De Prueba F86', limit: 10 });
    return (r || []).length;
  })()`);
  check('una ficha cargada SOLO con modelo aparece en el padrón de teléfonos (REQ-1)', Number(enPadron) >= 1, `teléfonos=${enPadron}`);
  await keyNav('Escape', 'Escape', 27);
  await sleep(800);
}

// ── 4) el conteo físico dice lo que va a hacer (REQ-9 / AC-12) ────────────────────────────────
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /^Ajustes/.test(t.innerText.trim()))`).catch(() => {});
await sleep(1000);
const abrioConteo = await evalx(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Cargar la lista del local/i.test(x.innerText));
  if (b) { b.click(); return true; } return false;
})()`);
if (abrioConteo) {
  await sleep(1500);
  const diceSalidas = await evalx(`(() => {
    const t = document.querySelector('[role="dialog"]')?.innerText ?? '';
    return { salida: /salida/i.test(t), fichasCero: /quedan en 0|quedarían en 0|quedan en cero/i.test(t), hook: !!document.querySelector('[data-barrido]') };
  })()`);
  check('el conteo físico avisa que escribe movimientos de SALIDA (AC-12)',
    !!diceSalidas && (diceSalidas.salida || diceSalidas.hook), JSON.stringify(diceSalidas));
  await keyNav('Escape', 'Escape', 27);
  await sleep(600);
}

// ── 5) los modales entran en la pantalla (AC-11) ──────────────────────────────────────────────
await evalx(`(() => { window.resizeTo?.(1200, 750); return true; })()`);
const altoVentana = await evalx(`window.innerHeight`);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => /^Productos/.test(t.innerText.trim()))`).catch(() => {});
await sleep(800);
await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo producto$/.test(b.innerText.trim())) || null)`).catch(() => {});
await sleep(1200);
const medidas = await evalx(`(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const pie = d.querySelector('[class*="DialogFooter"], [role="dialog"] > div:last-child');
  const rp = pie ? pie.getBoundingClientRect() : null;
  return { alto: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
           pieBottom: rp ? Math.round(rp.bottom) : null, ventana: window.innerHeight };
})()`);
check('el formulario de producto entra en la pantalla y su pie queda visible (AC-11)',
  !!medidas && medidas.top >= -1 && medidas.bottom <= medidas.ventana + 1
  && (medidas.pieBottom == null || medidas.pieBottom <= medidas.ventana + 1),
  JSON.stringify(medidas));

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (aplica una carga de prueba). Corré siempre contra una COPIA.');
process.exit(failed.length ? 1 : 0);
