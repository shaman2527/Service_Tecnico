// Verificación EN VIVO de F25 (asistente de carga de inventario) y F26 (regla «solo Pantalla»).
// Requisitos: app de dev con CDP 9222 y REGISTRO_DB apuntando a la copia de trabajo.
// Uso: node tools/verify_inventory_load.mjs
import { evalx, clickCenter, keyNav, typeText, insertText, sleep, handleDialog } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const ci = (l) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(l).toLowerCase())})`;
const clickButton = async (label) => { await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`); await sleep(700); };
// dentro del diálogo: el botón del asistente no se confunde con el de la tarjeta de atrás
const clickDialog = async (label) => {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(${ci(label)})`);
  await sleep(900);
};
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
const dialogOpen = () => evalx(`!!document.querySelector('[role="dialog"]')`);
// clic en un botón del diálogo SOLO si existe (las confirmaciones del asistente aparecen únicamente
// cuando hay algo que confirmar: barrido con lista parcial o volver con correcciones)
const clickDialogSi = async (label) => {
  const hay = await evalx(`!!([...document.querySelectorAll('[role="dialog"] button')].find(${ci(label)}))`);
  if (!hay) return false;
  await clickDialog(label);
  return true;
};
const tabActiva = () => evalx(`(() => document.querySelector('[role="tab"][data-state="active"]')?.innerText.trim() ?? null)()`);
const pegar = async (texto) => {
  await clickCenter(`document.querySelector('[role="dialog"] textarea')`);
  await evalx(`(() => { const t = document.querySelector('[role="dialog"] textarea'); t.focus(); t.select(); })()`);
  await insertText(texto);
  await sleep(500);
};
const totalPantallas = () => evalx(`(async () => {
  const all = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: 1 });
  return all.reduce((a, p) => a + p.stock, 0);
})()`);

// --- arranque limpio: la SPA se recarga y siempre empieza en la pantalla de PIN ---
// (si no, una corrida anterior deja la sesión en modo cajera y el Inventario no está en el menú)
const waitReady = async (timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) return true;
    } catch { /* el contexto se está recargando */ }
    await sleep(700);
  }
  return false;
};
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
await waitReady();

// --- sesión de dueño ---
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

// --- F26: Inventario → Productos abre filtrado en Pantalla ---
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
// la pestaña Inventario recuerda en cuál estaba: se entra a Productos a propósito
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Productos')`);
await sleep(2500);
const catLabel = await evalx(`(() => document.querySelector('[role="combobox"]')?.innerText.trim() ?? null)()`);
// OJO con el índice de la columna: F50 agregó la columna «En uso» como SEGUNDA (td[1]) y la
// categoría pasó a td[2]. Antes la prueba leía td[1] y comparaba «✓ Sí» contra «Pantalla» (fallaba
// por la columna, no por el filtro).
const categorias = await evalx(`(() => [...document.querySelectorAll('table tbody tr')].map(r => r.querySelectorAll('td')[2]?.innerText.trim()).filter(Boolean).slice(0, 8))()`);
check('F26: el inventario abre filtrado en «Pantalla»',
  /pantalla/i.test(String(catLabel)) && categorias.length > 0 && categorias.every(c => /pantalla/i.test(c)),
  `filtro=${catLabel} · filas=${[...new Set(categorias)].join(', ')}`);
// y avisa que los KPI de arriba son de todo el catálogo (no del filtro)
const avisoKpi = await evalx(`(() => [...document.querySelectorAll('p')].map(p => p.innerText).find(t => /todo el catálogo/i.test(t)) ?? null)()`);
check('F26: avisa que los números de arriba son de todo el catálogo', /filtrada/i.test(String(avisoKpi)), String(avisoKpi).slice(0, 70));

// --- F25: Ajustes → asistente de carga ---
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Ajustes')`);
await sleep(1200);
const hayBoton = await evalx(`!!([...document.querySelectorAll('button')].find(${ci('Cargar la lista del local')}))`);
check('F25: el asistente está en Ajustes', hayBoton);
await clickButton('Cargar la lista del local');
await sleep(900);
let dlg = await dialogText();
check('F25: abre el paso 1 (pegar la lista)', /Pegar la lista/.test(dlg ?? '') && /Abrir un archivo/.test(dlg ?? ''), (dlg ?? '').split('\n')[0]);

// pegar una lista de prueba y cruzar ("ZZZ 999" no existe: tiene que avisar)
const lista = [
  'Samsung',
  'A06 4G (6)',
  'ZZZ 999 (0)',
  '',
  'Tecno',
  'Spark 8P (2)',
  '',
].join('\n');
await pegar(lista);
await clickButton('Revisar el cruce');
await sleep(2000);
dlg = await dialogText();
check('F25: el cruce muestra líneas, cruzadas y unidades',
  /líneas/.test(dlg ?? '') && /cruzadas/.test(dlg ?? '') && /unidades/.test(dlg ?? ''),
  (dlg ?? '').match(/\d+ líneas[\s\S]{0,60}/)?.[0]?.replace(/\n/g, ' '));
const filas = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] table tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim().slice(0, 40))))()`);
check('F25: una fila por línea de la lista, con la cantidad editable',
  filas.length === 3 && filas.every(f => f.length >= 6),
  filas.map(f => `${f[2]}=${f[3]}`).join(' | '));
check('F25: la línea sin catálogo avisa en vez de inventar un producto',
  filas.some(f => /no encuentro|sin coincidencia/i.test(f.join(' '))),
  filas.map(f => f[4]).join(' / ').slice(0, 120));
const bultos = await evalx(`[...document.querySelectorAll('[role="dialog"] input[inputmode="numeric"]')].length`);
check('F25: el operario puede corregir la cantidad de cada línea', bultos >= 3, `${bultos} campos de cantidad`);
const ariaQty = await evalx(`(() => document.querySelector('[role="dialog"] input[inputmode="numeric"]')?.getAttribute('aria-label') ?? null)()`);
check('F25: las cantidades tienen etiqueta accesible', /unidades/i.test(String(ariaQty)), String(ariaQty));

// cerrar sin aplicar (no debe escribir nada)
const stockAntes = await totalPantallas();
await clickDialog('Atrás');
await clickButton('Cancelar');
await sleep(700);
const stockDespues = await totalPantallas();
check('F25: cerrar el asistente no toca el stock', stockAntes === stockDespues, `${stockAntes} → ${stockDespues}`);

// el barrido se avisa ANTES de aplicar: una lista que no nombra las pantallas con stock
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Tecno\nSpark 8P (2)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const avisoBarrido = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] label span')].map(s => s.innerText.trim()).find(t => /quedar[íi]an en 0|quedan en 0|Ninguna otra pantalla/i.test(t)) ?? null)()`);
check('F25: avisa cuántas pantallas quedarían en 0 antes de aplicar',
  /quedan en 0 \d+ pantalla/i.test(String(avisoBarrido).replace(/\s+/g, ' ')),
  String(avisoBarrido).replace(/\s+/g, ' ').slice(-90));
await clickDialog('Atrás');
await clickDialogSi('Sí, volver'); // si hubo correcciones, confirma volver (aviso dentro del asistente)
await clickButton('Cancelar');
await sleep(600);

// GATE DEL BARRIDO: una línea con unidades sin pantalla asignada no puede cargarse con el
// barrido marcado (dejaría en 0 mercancía que la lista SÍ menciona)
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Samsung\nA06 4G (6)\nZZZ 999 (5)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const avisoSinPantalla = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] span')].map(s => s.innerText).find(t => /que NO se cargan/i.test(t)) ?? null)()`);
check('F25: avisa las unidades que NO se van a cargar (línea sin pantalla)',
  /5 u\. que NO se cargan/i.test(String(avisoSinPantalla).replace(/\s+/g, ' ')),
  String(avisoSinPantalla).replace(/\s+/g, ' ').slice(0, 90));
const stockAntesGate = await totalPantallas();
await clickDialog('Cargar 1 pantalla');
await clickDialogSi('Sí, cargar igual'); // el aviso del barrido (lista parcial) pide confirmación primero
await sleep(2500);
const errGate = await evalx(`(() => document.querySelector('[role="dialog"] [role="alert"], [role="dialog"] .text-destructive')?.innerText ?? null)()`);
check('F25: el barrido NO deja en 0 mercancía que la lista menciona (pide resolver la línea)',
  /sin pantalla asignada/i.test(String(errGate)) && (await totalPantallas()) === stockAntesGate,
  `${String(errGate).replace(/\s+/g, ' ').slice(0, 80)} · stock ${stockAntesGate} → ${await totalPantallas()}`);
await clickDialog('Atrás');
await clickDialogSi('Sí, volver');
await clickButton('Cancelar');
await sleep(600);

// GUARDA DEL BARRIDO (lo que pasó de verdad en la tienda): con una lista PARCIAL y el barrido
// marcado, el asistente avisa antes de vaciar medio catálogo y el operario puede cancelar
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Tecno\nCamon 18 (10)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const stockAntesGuarda = await totalPantallas();
await clickDialog('Cargar 1 pantalla');
const huboAviso = await evalx(`!!([...document.querySelectorAll('[role="dialog"] button')].find(b => /^Sí, cargar igual$/i.test(b.innerText.trim())))`);
await clickDialog('Cancelar'); // CANCELAR el aviso
await sleep(1200);
const sigueEnPaso2 = await evalx(`!!document.querySelector('[role="dialog"] textarea, [role="dialog"] table')`);
check('GUARDA: con una lista parcial el barrido avisa antes de vaciar el catálogo (y se puede cancelar)',
  huboAviso && sigueEnPaso2 && (await totalPantallas()) === stockAntesGuarda,
  `aviso=${huboAviso} · stock ${stockAntesGuarda} → ${await totalPantallas()}`);
await clickDialog('Atrás');
await clickDialogSi('Sí, volver');
await clickButton('Cancelar');
await sleep(600);

// ASIGNAR A MANO (F28): la línea que el cruce no pudo resolver se busca y se asigna desde el
// asistente («6 c/m Accesorios» vs «Pantalla Redmi 6 c/m Acasonor»: el nombre no coincide)
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Samsung\nA06 4G (6)\nZZZ 999 (5)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const abrirBuscador = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Buscar la pantalla$/i.test(t)) ?? null)()`);
check('F28: una línea sin pantalla ofrece buscarla a mano', abrirBuscador !== null, String(abrirBuscador));
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /^Buscar la pantalla$/i.test(b.innerText.trim()))`);
await sleep(700);
await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar la pantalla"]')`);
await typeText('a06 4g');
await sleep(1800);
const hits = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button[data-load-hit]')].map(b => b.innerText.trim()).slice(0, 5))()`);
check('F28: el buscador encuentra la pantalla por nombre o modelo', hits.some(h => /A06 4G/i.test(h)), hits.join(' | '));
await clickCenter(`document.querySelector('[role="dialog"] button[data-load-hit]')`);
await sleep(900);
const asignada = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.includes('asignada a mano') ?? false)()`);
check('F28: la pantalla elegida queda asignada a la línea', asignada === true);
const botonAmano = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Cargar \\d+ pantalla/i.test(t)) ?? null)()`);
check('F28: la asignación a mano entra en el total (6 + 5 en la misma ficha)',
  /^Cargar 1 pantalla/.test(String(botonAmano)) && /11 u\./.test(String(botonAmano)), String(botonAmano));
const sinPantallaAhora = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] span')].map(s => s.innerText).find(t => /que NO se cargan/i.test(t)) ?? null)()`);
check('F28: ya no queda ninguna línea sin pantalla', sinPantallaAhora === null, String(sinPantallaAhora));
await clickDialog('Atrás');
await clickDialogSi('Sí, volver');
await clickButton('Cancelar');
await sleep(600);
const stockTrasAsignar = await totalPantallas();
check('F28: asignar a mano y salir no toca el stock', stockTrasAsignar === stockDespues, `${stockDespues} → ${stockTrasAsignar}`);
// --- F25 E2E por la UI: cargar una lista que refleja lo que YA hay y VER el resumen ---
// (regresión de la revisión: al aplicar, la pestaña saltaba a Productos y el paso 3
//  —el resumen— nunca se veía porque el diálogo se desmontaba)
// PROVEEDOR + carga real SIN barrido: se carga una lista que refleja lo que YA hay (el barrido
// queda desmarcado para que la prueba no vacíe el resto del catálogo de la copia)
await clickButton('Cargar la lista del local');
await sleep(800);
await pegar('Samsung\nGalaxy A06 4G (6)\n');
await clickDialog('Revisar el cruce');
await sleep(1800);
const botonCargar = await evalx(`(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Cargar \\d+ pantalla/i.test(t)) ?? null)()`);
check('F25: el botón dice cuántas PANTALLAS y unidades va a cargar', /^Cargar 1 pantalla/.test(String(botonCargar)), String(botonCargar));
// el proveedor que trajo la mercancía (general de la carga)
await clickCenter(`document.querySelector('#prov-carga')`);
await typeText('Prov Verificacion');
await sleep(600);
check('F29: el asistente pide el proveedor que trajo la mercancía',
  /Prov Verificacion/.test(String(await evalx(`document.querySelector('#prov-carga')?.value ?? ''`))),
  String(await evalx(`document.querySelector('#prov-carga')?.value ?? ''`)));
// desmarcar el barrido (es una lista de una sola línea: no es todo el inventario)
await clickCenter(`[...document.querySelectorAll('[role="dialog"] label')].find(l => /no están en la lista quedan en 0/.test(l.innerText))?.querySelector('input')`);
await sleep(500);
// la ficha de la línea, para comprobar que SOLO ella cambia (la lista dice 6 u.)
const a06Antes = Number(await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('get_products', { search: 'A06 4G', categoryId: 1 });
  return (p[0] && p[0].stock) ?? -1;
})()`));
await clickDialog('Cargar 1 pantalla');
await sleep(2500);
const repDlg = await dialogText();
check('F25: el paso 3 (resumen) SE VE después de cargar',
  /Inventario cargado/i.test(repDlg ?? '') && /respaldo de la base/i.test(repDlg ?? ''),
  (repDlg ?? '').split('\n').slice(0, 3).join(' · '));
check('F25: el resumen queda en el asistente (no salta de pestaña)',
  (await dialogOpen()) && (await tabActiva()) === 'Ajustes',
  `pestaña=${await tabActiva()}`);
const movs = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.match(/(\\d+) movimientos/)?.[1] ?? null)()`);
check('F25: el resumen dice cuántos movimientos se anotaron', movs !== null, `${movs} movimientos`);
const backup = await evalx(`(() => document.querySelector('[role="dialog"]')?.innerText.match(/registro_pre_carga_[\\w.]*/)?.[0] ?? null)()`);
check('F25: el resumen muestra el respaldo que se guardó', /registro_pre_carga_/.test(String(backup)), String(backup));
check('F29: el resumen dice que el proveedor quedó anotado',
  /proveedor anotado/i.test(repDlg ?? ''), (String(repDlg).match(/\d+ pantallas quedaron con su proveedor anotado/) ?? [''])[0]);
const provGuardado = await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('get_products', { search: 'A06 4G', categoryId: 1 });
  return (p[0] && p[0].supplier) ? p[0].supplier : '';
})()`);
check('F29: el proveedor quedó guardado en la pantalla cargada', /Prov Verificacion/.test(String(provGuardado)), String(provGuardado));
await clickDialog('Listo');
await sleep(600);
const stockFinal = await totalPantallas();
// sin barrido, SOLO cambia la ficha de la línea: la de A06 4G pasa de lo que tenía (a06Antes) a 6
const esperado = stockDespues - (a06Antes - 6);
check('F25: sin barrido solo cambia la ficha cargada (el resto del inventario queda igual)',
  stockFinal === esperado, `${stockDespues} → ${stockFinal} (A06 4G ${a06Antes} → 6, esperado ${esperado})`);
check('F25: al cerrar el asistente no queda ningún diálogo abierto', !(await dialogOpen()));

// limpieza: el proveedor de prueba no se queda en la copia
await evalx(`(async () => {
  const p = await window.__TAURI_INTERNALS__.invoke('get_products', { search: 'A06 4G', categoryId: 1 });
  for (const x of p) if (x.supplier) await window.__TAURI_INTERNALS__.invoke('set_product_supplier', { id: x.id, supplier: '' });
  return true;
})()`);

// --- el Centro de Ayuda explica el conteo (lo que el local lee para usarlo) ---
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Ayuda'))`);
await sleep(1500);
await clickCenter(`[...document.querySelectorAll('button, [role="button"]')].find(b => /Inventario \\(un solo módulo\\)/i.test(b.innerText))`);
await sleep(1200);
const ayuda = await evalx(`(() => document.body.innerText.replace(/\\s+/g, ' '))()`);
check('F25: la Ayuda explica cómo contar la mercancía (marca por línea, c/m, buscar a mano)',
  /Contar la mercancía/i.test(ayuda) && /con marco/i.test(ayuda) && /Buscar la pantalla/i.test(ayuda),
  (String(ayuda).match(/Contar la mercancía.{0, 90}/) ?? [''])[0]);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
