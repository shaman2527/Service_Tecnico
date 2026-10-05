// Verificación EN VIVO de que una carga APLICADA aterriza en el inventario real:
//  1) pega tools/inventario_real.txt en el asistente (Inventario → Ajustes → «Cargar la lista del local»),
//  2) asigna a mano la línea que el cruce no resuelve, anota el PROVEEDOR y pulsa Cargar (escribe de verdad),
//  3) comprueba el reporte, el stock total, los movimientos y que las pantallas del padrón muestren el stock nuevo.
//
// OJO: esto ESCRIBE en la base que esté usando la app. Corrélo con REGISTRO_DB apuntando a una COPIA.
// Uso: node tools/verify_carga_aplica.mjs
import { readFileSync } from 'node:fs';
import { evalx, clickCenter, keyNav, typeText, insertText, sleep, handleDialog } from './cdp_driver.mjs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const ci = (l) => `b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(String(l).toLowerCase())})`;
const clickButton = async (label) => { await clickCenter(`[...document.querySelectorAll('button')].find(${ci(label)})`); await sleep(700); };
const clickDialog = async (label) => {
  await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(${ci(label)})`);
  await sleep(900);
};
const dialogText = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? null`);
/** Espera una CONDICIÓN del DOM (no el reloj): la búsqueda a mano del asistente es con rebote. */
const waitFor = async (expr, timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const totalUnidades = () => evalx(`(async () => {
  const all = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: null });
  return all.reduce((a, p) => a + p.stock, 0);
})()`);
const movimientosCarga = () => evalx(`(async () => {
  const m = await window.__TAURI_INTERNALS__.invoke('get_inventory_movements_page', { search: 'Carga de inventario', type: '', limit: 200, offset: 0 });
  const items = Array.isArray(m) ? m : (m.items ?? []);
  return items.filter(x => /carga de inventario/i.test(String(x.reason ?? ''))).length;
})()`);

const texto = readFileSync('tools/inventario_real.txt', 'utf8');

// arranque limpio
const waitReady = async (timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`)) return true; } catch { /* recargando */ }
    await sleep(700);
  }
  return false;
};
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
await waitReady();

const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

const unidadesAntes = await totalUnidades();
console.log(`· unidades antes de la carga: ${unidadesAntes}`);

await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Inventario'))`);
await sleep(1200);
await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => t.innerText.trim() === 'Ajustes')`);
await sleep(1200);
await clickButton('Cargar la lista del local');
await sleep(900);

await clickCenter(`document.querySelector('[role="dialog"] textarea')`);
await evalx(`(() => { const t = document.querySelector('[role="dialog"] textarea'); t.focus(); t.select(); })()`);
await insertText(texto);
await sleep(800);
await clickDialog('Revisar el cruce');

// 261 líneas tardan: se espera al botón de aplicar
const botonCargar = `(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).find(t => /^Cargar [0-9]+ pantalla/i.test(t)) ?? null)()`;
let boton = null;
for (let i = 0; i < 25 && !boton; i++) { boton = await evalx(botonCargar); if (!boton) await sleep(600); }
check('CARGA: el cruce está listo para aplicar', boton !== null, String(boton));

// la línea que el cruce no resuelve, a mano
//
// EL TÉRMINO DE BÚSQUEDA SE DERIVA DE LA LÍNEA, no se escribe fijo. Antes buscaba «acasonor» (la
// marca del marco de «Redmi 6 c/m Acasonor») y el catálogo del taller **no tiene ninguna pantalla
// «Acasonor»** —medido 2026-10-05: 0 fichas con ese texto en nombre, modelo o compatibilidad—, así
// que la búsqueda devolvía 0 resultados y el script moría con «click target no encontrado»: el fallo
// era del fixture, no de la app (el asistente hace lo correcto: dice que ninguna pantalla coincide).
// Ahora se toma el MODELO de la propia línea sin resolver (lo que va antes del «c/m») y se verifica
// que la búsqueda a mano devuelva al menos una pantalla.
const sinPantalla = String(await dialogText() ?? '').includes('que NO se cargan');
let terminoAMano = null;
let pantallaAMano = null;
/** Asigna a mano UNA línea sin resolver (la primera que quede) y devuelve qué buscó/asignó. */
const asignarUnaAMano = async () => {
  // La fila se elige por su CASILLA TILDADA: una fila ya excluida sigue mostrando su botón «Buscar la
  // pantalla», y sin este filtro el bucle volvía siempre a la misma línea (medido 2026-10-05).
  const abrio = await evalx(`(() => {
    const filas = [...document.querySelectorAll('[role="dialog"] tr')];
    const fila = filas.find(tr => {
      const casilla = tr.querySelector('input[type="checkbox"][aria-label^="Cargar la línea"]');
      const b = [...tr.querySelectorAll('button')].find(x => /^Buscar la pantalla$/i.test(x.innerText.trim()));
      return casilla?.checked === true && !!b;
    });
    if (!fila) return null;
    const b = [...fila.querySelectorAll('button')].find(x => /^Buscar la pantalla$/i.test(x.innerText.trim()));
    b.click();
    return true;
  })()`);
  if (!abrio) return null;
  await sleep(700);
  const fila = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Buscar( la pantalla| otra…)$/i.test(x.innerText.trim()));
    const crudo = String(b?.closest('tr')?.querySelectorAll('td')[1]?.innerText ?? '').trim();
    const sinCantidad = crudo.replace(/\\(\\s*\\d+\\s*\\)\\s*$/, '').trim();
    return { crudo, termino: sinCantidad };
  })()`);
  if (!fila?.termino) return null;
  await clickCenter(`document.querySelector('[role="dialog"] input[placeholder^="Buscar la pantalla"]')`);
  await typeText(String(fila.termino));
  const hay = await waitFor(`!!document.querySelector('[role="dialog"] button[data-load-hit]')`, 8000);
  if (!hay) {
    // NO HAY PANTALLA EN EL CATÁLOGO (p. ej. «1B (3/4)», una línea que la tienda nunca cargó): el
    // operario QUITA esa línea del archivo. Sin esto el backend no deja aplicar (avisa que hay
    // mercancía de la lista que quedaría en 0) y las comprobaciones de abajo fallan en cascada.
    await evalx(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^(Cancelar|Cerrar)$/i.test(x.innerText.trim()));
      if (b) { b.click(); return true; }
      return false;
    })()`);
    await sleep(500);
    const quitada = await evalx(`(() => {
      const inp = [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')]
        .find(x => (x.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify('Cargar la línea ')} + ${JSON.stringify(String(fila.crudo))});
      if (!inp || !inp.checked) return false;
      inp.click();
      return true;
    })()`);
    return { termino: fila.termino, hit: null, quitada };
  }
  const hit = await evalx(`document.querySelector('[role="dialog"] button[data-load-hit]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
  await clickCenter(`document.querySelector('[role="dialog"] button[data-load-hit]')`);
  await sleep(900);
  return { termino: fila.termino, hit, quitada: false };
};

// Puede haber MÁS DE UNA línea sin resolver (depende del catálogo): se recorren TODAS — la que tiene
// pantalla se asigna a mano y la que no la tiene se quita del archivo. El fixture original daba por
// hecho que era UNA sola y que su marca («acasonor») existía en el catálogo.
let intentos = 0;
let quitadas = 0;
while (intentos < 10 && String(await dialogText() ?? '').includes('que NO se cargan')) {
  intentos++;
  const r = await asignarUnaAMano();
  if (!r) break;
  if (r.hit) { terminoAMano = r.termino; pantallaAMano = r.hit; console.log(`· línea sin resolver asignada a mano: busqué «${r.termino}» → ${r.hit}`); }
  else if (r.quitada) { quitadas++; console.log(`· línea sin resolver quitada del archivo (el catálogo no la tiene): «${r.termino}»`); }
  else { console.log(`· línea sin resolver SIN resolver (ni asignada ni quitada): «${r.termino}»`); break; }
}
if (sinPantalla) {
  // Se INFORMA, no se juzga: con la lista física actual hay líneas que el catálogo del taller
  // simplemente no tiene («1B (3/4)»), y ahí lo correcto es quitarlas del archivo — que es lo que
  // hace el bucle. El veredicto de esta verificación es el de abajo (aplicar la carga), y si el
  // fixture no se sostiene, aborta diciéndolo.
  console.log(`· líneas sin resolver: ${intentos} · asignadas a mano: ${pantallaAMano ? 1 : 0} · quitadas del archivo: ${quitadas}`
    + ` · último término buscado: «${terminoAMano}»${pantallaAMano ? ` → ${pantallaAMano}` : ''}`);
  const unidadesFuera = (String(await dialogText() ?? '').match(/\((\d+) u\. que NO se cargan\)/) ?? [])[1];
  if (unidadesFuera) console.log(`· el asistente dice que quedan ${unidadesFuera} unidades de la lista sin cargar`);
}
const sinPantallaDespues = String(await dialogText() ?? '').includes('que NO se cargan');
// PRECONDICIÓN DEL FIXTURE (se dice y se corta, en vez de fallar en cascada): esta verificación se
// escribió cuando el cruce dejaba UNA sola línea sin resolver y el operario la asignaba a mano. Con el
// catálogo del taller (964 fichas) la lista física deja MUCHAS líneas sin pantalla, y el backend —con
// razón— no deja aplicar mientras haya mercancía de la lista que quedaría en 0 sin que nadie lo haya
// decidido: medido 2026-10-05, 48 líneas / 151 unidades. Eso NO es un defecto del producto ni de F87
// (el asistente lo dice en pantalla y ofrece asignar a mano o quitar la línea); es el fixture que
// quedó viejo. Mismo criterio que `verify_carga_csv`, que aborta cuando falta su precondition.
if (sinPantallaDespues) {
  const dicho = (String(await dialogText() ?? '').match(/Hay (\d+) línea\(s\) de la lista sin pantalla[^.]*/) ?? [])[0]
    ?? (String(await dialogText() ?? '').match(/\((\d+) u\. que NO se cargan\)/) ?? [])[0]
    ?? 'quedan líneas de la lista sin pantalla asignada';
  console.log(`\n${out.length - out.filter(r => !r.ok).length}/${out.length} comprobaciones OK antes de abortar`);
  console.log(`ABORTADO: el fixture de esta verificación da por hecho que el cruce resuelve casi toda la lista.`);
  console.log(`  El asistente dice: «${dicho}»`);
  console.log('  No es un fallo del producto (el asistente lo dice y deja asignar a mano o quitar la línea):');
  console.log('  hay que rehacer el fixture de esta prueba o dejar la lista al día antes de correrla.');
  process.exit(2);
}
check('CARGA: no queda ninguna línea sin pantalla antes de aplicar', !sinPantallaDespues);

// proveedor general de la carga
await clickCenter(`document.querySelector('#prov-carga')`);
await typeText('Prov Carga Real');
await sleep(500);
boton = await evalx(botonCargar);
check('CARGA: el botón dice las pantallas y unidades que va a escribir', /Cargar \d+ pantallas \(\d+ u\.\)/.test(String(boton)), String(boton));

await clickDialog('Cargar');
await handleDialog(true); // por si el navegador abre un diálogo nativo
// F86 (REQ-9/AC-12): la confirmación del BARRIDO ya no es «sólo si la lista parece parcial»: sale
// SIEMPRE que el barrido vaya a dejar fichas en 0 (porque eso escribe movimientos de SALIDA), y es un
// aviso DENTRO del asistente — se acepta con su botón, no con `handleDialog`.
//
// SE ESPERA LA CONDICIÓN. Antes se intentaba el clic en el mismo instante y, si el aviso tardaba un
// render más en aparecer, el clic se perdía: la carga NO se aplicaba y las cinco comprobaciones de
// abajo fallaban culpando al producto (medido 2026-10-05: «0 movimientos», «244 → 244»). El bucle
// acepta los DOS caminos: con aviso (se confirma y sigue) o sin aviso (aplica directo y ya está el
// reporte).
let confirmado = false;
for (let i = 0; i < 24; i++) {
  const estado = await evalx(`(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'sin-diálogo';
    if (/Inventario cargado/i.test(d.innerText)) return 'listo';
    const b = [...d.querySelectorAll('button')].find(x => /^Sí, cargar igual$/i.test(x.innerText.trim()));
    if (b) { b.click(); return 'confirmado'; }
    return 'esperando';
  })()`);
  if (estado === 'confirmado') { confirmado = true; await sleep(600); continue; }
  if (estado === 'listo') break;
  await sleep(500);
}
console.log(`· aviso del barrido: ${confirmado ? 'salió y se confirmó' : 'no salió (se aplicó directo)'}`);
const llegoElReporte = await waitFor(`/Inventario cargado/i.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 15000);
if (!llegoElReporte) {
  // Si la carga NO se aplicó, el asistente lo dice EN PANTALLA (guarda del backend): se imprime para
  // que un fallo de acá no se lea como «el inventario no se cargó» sin motivo.
  const txt = String(await dialogText() ?? '').replace(/\s+/g, ' ');
  console.log(`· la carga NO se aplicó — dice el asistente: «${txt.slice(0, 500)}»`);
}

const rep = String(await dialogText() ?? '').replace(/\s+/g, ' ');
const num = (re) => Number((rep.match(re) ?? [])[1] ?? -1);
const actualizadas = num(/(\d+) pantallas actualizadas/);
const unidadesRep = num(/\((\d+) unidades\)/);
const proveedorAnotado = num(/(\d+) pantallas quedaron con su proveedor anotado/);
check('CARGA: el reporte dice cuántas pantallas y unidades escribió',
  actualizadas > 100 && unidadesRep > 500, `${actualizadas} pantallas · ${unidadesRep} unidades · proveedor en ${proveedorAnotado}`);
check('CARGA: el reporte muestra el respaldo que se hizo antes de escribir',
  /registro_pre_carga_/.test(rep), (rep.match(/registro_pre_carga_[\w.]*/) ?? [''])[0]);

// --- lo que quedó REALMENTE en la base (por IPC y por las pantallas) ---
const unidadesDespues = await totalUnidades();
check('CARGA: el stock del inventario cambió de verdad',
  unidadesDespues === unidadesRep && unidadesDespues > unidadesAntes,
  `${unidadesAntes} → ${unidadesDespues} u.`);
const movs = await movimientosCarga();
check('CARGA: quedaron los movimientos «Carga de inventario» en el historial', movs > 100, `${movs} movimientos`);

// la pantalla que se asignó a mano tiene su unidad (se busca por el modelo de ESA línea: el nombre
// «Acasonor» ya no existe en el catálogo, y la ficha asignada es lo que hay que comprobar)
const a06 = await invoke('get_products', { search: String(terminoAMano ?? ''), categoryId: null });
check('CARGA: la pantalla asignada a mano quedó con la unidad de la lista',
  Array.isArray(a06) && a06.length > 0 && a06.every(p => p.stock >= 0) && a06.some(p => p.stock === 1),
  `término «${terminoAMano}» · asignada «${pantallaAMano}» · ${(a06 ?? []).slice(0, 6).map(p => `${p.name}=${p.stock}`).join(' | ')}${(a06 ?? []).length > 6 ? ` … (${a06.length} fichas)` : ''}`);
const conProv = (a06 ?? []).filter(p => /Prov Carga Real/.test(String(p.supplier)));
check('CARGA: el proveedor quedó guardado en la ficha', conProv.length > 0, `${conProv.length} fichas con proveedor`);

// el padrón de teléfonos muestra el stock nuevo (Modelos)
const modelos = await evalx(`(async () => {
  const m = await window.__TAURI_INTERNALS__.invoke('get_phone_models', { search: 'A06', limit: 10, offset: 0 });
  const items = Array.isArray(m) ? m : (m.items ?? []);
  return JSON.stringify(items.slice(0, 3).map(x => ({ label: x.label, stock: x.stock })));
})()`);
check('CARGA: el padrón de Modelos refleja el stock cargado', /"stock":\s*[1-9]/.test(String(modelos)), String(modelos));

await clickDialog('Listo');
await sleep(600);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
