// VERIFICACIÓN EN VIVO (CDP) de F44 — «TRABAJOS HECHOS»: los contadores de la lista cuentan lo que
// se está viendo (ENTREGADOS INCLUIDOS) y la pantalla dice SOBRE QUÉ está contando.
//
// El pedido del dueño (2026-09-20): «el cliente me pregunta cuántas pantallas hice hoy o un día en
// específico… cuando cambio el filtro debería darme los servicios que he hecho, cambio de pantalla
// por ejemplo o cambio de pin, y en entregado no me aparecen. El filtro predeterminado debería ser
// todos los estados; el que tengo actual es activos en taller, no debería ser ese».
//
// Qué comprueba sobre la app REAL:
//   1. La lista abre en el estado «Todos los estados» y **las órdenes entregadas ya se ven** sin
//      tocar ningún filtro (antes abría en «Activos en taller» → lista vacía con la base real).
//   2. Los chips de trabajos cuentan las ENTREGADAS (el defecto reportado: se contaban solo las
//      activas, así que al filtrar por entregado desaparecían todos los chips).
//   3. El trabajo escrito a mano («Cambio de pin de carga», el texto libre de «Otro») TIENE chip.
//   4. **El número del chip == las tarjetas que aparecen al hacerle clic == el KPI «Equipos en la
//      lista»** (el invariante que hace confiable el número).
//   5. La línea de alcance dice el estado, el eje de fecha y el rango.
//   6. «Entregados hoy» (eje de ENTREGA) sigue funcionando y ahí el chip de pantalla cuenta la
//      entregada: es la respuesta a «¿cuántas pantallas hice hoy?».
//   7. La combinación imposible (activos + fecha de entrega) se EXPLICA en vez de mostrar una lista
//      vacía muda.
//   8. «Limpiar filtros» quita todo de una vez.
//
// SEGURIDAD DE DATOS: escribe de verdad (es una prueba), así que:
//   · corre contra una COPIA (`REGISTRO_DB` es OBLIGATORIO: si falta, ABORTA — leeríamos otra base
//     que la de la app y los conteos no probarían nada);
//   · NO abre el día: si la copia no tiene turno abierto, ABORTA (no ensucia el turno del local);
//   · las 3 órdenes de prueba van con monto $0 (no mueven la caja: la rama que «presume» el cobro de
//     una orden entregada suma 0) y al final se BORRAN;
//   · la orden entregada con «Cambio pantalla» usa una pantalla REAL del catálogo y al final se
//     comprueba contra la BASE que el stock volvió al valor inicial (no se deja inventario movido).
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f44_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       (lanzar la app)  →  node tools/verify_trabajos_hechos.mjs

import { evalx, clickCenter, keyNav, insertText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

// ── 0) GATE DE DATOS: la copia es obligatoria (la verdad independiente sale de ahí) ──────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  console.error('  Ej.: node tools/snapshot_db.mjs --out backup/f44_verif.db   y arrancar con $env:REGISTRO_DB a esa copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const q1 = (sql, ...params) => { try { return db.prepare(sql).get(...params); } catch (e) { return { err: String(e.message) }; } };

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const irA = async (nombre) => {
  // La barra lateral se puede COLAPSAR (queda solo con íconos: `innerText` vacío) — lección de F51.
  // Se navega por el `title` («Servicio Técnico (Alt+3)»), que existe en los dos estados.
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('title') || '').startsWith(${JSON.stringify(nombre)}))`);
  await sleep(1800);
};
const equiposKpi = async () => Number(await evalx(`document.querySelector('[data-kpi="equipos"]')?.innerText.trim() ?? 'NaN'`));
const tarjetas = async () => Number(await evalx(`document.querySelectorAll('[data-tech-quick]').length`));
const alcance = () => evalx(`document.querySelector('[data-report-scope]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
const estadoFiltro = () => evalx(`document.querySelector('main [role="combobox"][aria-label="Filtrar por estado"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);

// ── F57: el filtro de trabajos es UN SELECTOR con buscador (ya no hay chips sueltos) ───────────
// Estos ayudantes hacen exactamente lo que hace el operario: abrir, buscar, leer y elegir. La clave
// (`data-work-chip`) y su cantidad (`data-work-count`) siguen siendo los mismos enganches de F44.
const abrirTrabajos = async () => {
  await clickCenter(`document.querySelector('[data-work-picker]')`);
  return waitFor(`!!document.querySelector('[data-work-menu]')`, 8000);
};
const cerrarTrabajos = async () => {
  if (await evalx(`!!document.querySelector('[data-work-menu]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(400); }
};
const buscarTrabajo = (texto) => evalx(`(() => {
  const i = document.querySelector('[data-work-search]');
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(texto)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
/** Lee la cantidad de un trabajo (abre el selector, busca si hace falta y lo cierra). */
const contarTrabajo = async (key, texto = '') => {
  if (!(await abrirTrabajos())) return null;
  if (texto) { await buscarTrabajo(texto); await sleep(500); }
  const v = await evalx(`(() => { const b = document.querySelector('[data-work-chip="${key}"]'); return b ? Number(b.getAttribute('data-work-count')) : null; })()`);
  await cerrarTrabajos();
  return v;
};
const textoOpcion = async (key, texto = '') => {
  if (!(await abrirTrabajos())) return null;
  if (texto) { await buscarTrabajo(texto); await sleep(500); }
  const t = await evalx(`document.querySelector('[data-work-chip="${key}"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
  await cerrarTrabajos();
  return t;
};
/** Elige un trabajo (vacío = «todos») como lo hace el operario: abre, busca y toca. */
const elegirTrabajo = async (key, texto = '') => {
  if (!(await abrirTrabajos())) return false;
  if (texto) { await buscarTrabajo(texto); await sleep(600); }
  await clickCenter(`document.querySelector('[data-work-chip="${key}"]')`);
  await sleep(1600);
  return true;
};
const totalTrabajos = () => evalx(`Number(document.querySelector('[data-work-picker]')?.getAttribute('data-work-total') ?? -1)`);
const filtroActivo = () => evalx(`document.querySelector('[data-work-picker]')?.getAttribute('data-work-filter') ?? null`);

/**
 * Elige una opción del Select de estado SIN depender de las coordenadas del portal de Radix (el
 * desplegable se posiciona pegado al ítem seleccionado y, con la ventana chica, una opción puede
 * caer fuera del área clickeable — falló una vez en vivo). Se abre con un click real y se navega
 * con el teclado LEYENDO el resaltado (`data-highlighted`) hasta que sea la opción pedida.
 */
const elegirEstado = async (label) => {
  await clickCenter(`document.querySelector('main [role="combobox"][aria-label="Filtrar por estado"]')`);
  await sleep(600);
  for (const [key, vk] of [['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40]]) {
    await keyNav(key, key, vk);
    await sleep(250);
    const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
    if (String(hi).includes(label)) {
      await keyNav('Enter', 'Enter', 13);
      await sleep(1800);
      return true;
    }
  }
  await keyNav('Escape', 'Escape', 27);
  await sleep(500);
  return false;
};

// desbloqueo del PIN (el gate es fail-closed y borrar órdenes exige sesión de DUEÑO)
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

// ── 1) GATE: sin día abierto NO se corre (la prueba no abre el turno del local) ─────────────────
const dia = await invoke('get_active_day').catch(() => null);
if (!dia) {
  console.log('ABORTADO: la copia no tiene día abierto. Abrilo en Libro Diario (o usá una copia que lo tenga) y volvé a correr.');
  process.exit(2);
}
console.log(`· copia: ${dbPath}`);
console.log(`· día abierto (${dia.close_date ?? 'hoy'}) · tasa ${dia.tasa_bcv}`);

// ── 2) preparación: una pantalla REAL con stock (para que entregar descuente de verdad) ────────
const pant = await evalx(`(async () => {
  const r = await window.__TAURI_INTERNALS__.invoke('find_compatible_products', { model: 'A06', categoryId: null, limit: 20 });
  const p = r.map(x => x.product).find(x => x.category_id === 1 && x.stock > 0);
  return p ? JSON.stringify({ id: p.id, nombre: p.name, stock: p.stock }) : null;
})()`).catch(() => null);
const pantalla = pant ? JSON.parse(pant) : null;
check('hay una pantalla con stock en el catálogo para la orden de prueba', !!pantalla, String(pant));
if (!pantalla) process.exit(1);
const stockAntes = q1('SELECT stock FROM products WHERE id = ?', pantalla.id)?.stock;
console.log(`· pantalla de prueba: ${pantalla.nombre} (id ${pantalla.id}, stock ${stockAntes})`);

const hoy = await evalx(`(() => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })()`);
const marca = String(Date.now()).slice(-6);
const PREFIJO = `Prueba Trabajos ${marca}`;

const dispositivo = (types, screenId) => ({
  model: 'Galaxy A06 4G', color: '', fault: `prueba F44 ${marca}`,
  service_type: types[0], service_types: JSON.stringify(types),
  amount: 0, discount_amount: 0, payment_method: 'Divisas (USD Cash)', observations: '',
  bank_fee_percent: 0, zelle_reference: '', currency: 'USD', device_checklist: '',
  screen_product_id: screenId, status: 'Recibido',
});

let idT1 = null;
let idT2 = null;
let idT3 = null;
try {
  // T1: «Cambio pantalla» que SE QUEDA EN EL TALLER (sin pantalla elegida: no mueve stock)
  const numT1 = await invoke('add_service_order', {
    client: `${PREFIJO} taller`, phone: '', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null, devices: [dispositivo(['Cambio pantalla'], null)],
  });
  // T2: «Cambio pantalla» entregada HOY con la pantalla real elegida (acá SÍ se descuenta stock)
  const numT2 = await invoke('add_service_order', {
    client: `${PREFIJO} entregada`, phone: '', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null, devices: [dispositivo(['Cambio pantalla'], pantalla.id)],
  });
  // T3: trabajo ESCRITO A MANO (texto libre de «Otro»), entregada HOY
  const numT3 = await invoke('add_service_order', {
    client: `${PREFIJO} pin`, phone: '', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null, devices: [dispositivo(['cambio de pin de carga'], null)],
  });
  const filas = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
  const porNum = (n) => filas.find(r => (r.order_num ?? '') === n);
  idT1 = porNum(numT1)?.id; idT2 = porNum(numT2)?.id; idT3 = porNum(numT3)?.id;
  check('se prepararon las 3 órdenes de prueba', !!(idT1 && idT2 && idT3), `ids=${idT1},${idT2},${idT3}`);
  if (!idT1 || !idT2 || !idT3) throw new Error('no se pudieron crear las órdenes de prueba');

  // Entregar T2 y T3 (fecha de entrega = HOY, que es lo que pone el backend con dateOut vacío).
  // `amount` 0 a propósito: no mueve la caja del día.
  for (const id of [idT2, idT3]) {
    const s = await invoke('get_service', { id });
    await invoke('update_service', {
      id, client: s.client, phone: s.phone ?? '', model: s.model ?? '', fault: s.fault ?? '',
      serviceType: s.service_type ?? '', serviceTypes: s.service_types ?? '[]', amount: s.amount ?? 0,
      paymentMethod: s.payment_method ?? '', dateOut: '', status: 'Entregado', observations: s.observations ?? '',
      bankFeePercent: 0, zelleReference: '', currency: s.currency ?? 'USD', clientCi: '', clientAddress: '',
      deviceChecklist: '', technician: '', technicianId: null, color: '',
      screenProductId: s.screen_product_id ?? null, discountAmount: 0,
    });
  }
  const entregadas = await invoke('get_services', { search: marca, status: 'Entregado', startDate: hoy, endDate: hoy, dateField: 'out' });
  check('las 2 órdenes quedaron ENTREGADAS con fecha de entrega de hoy',
    entregadas.length === 2 && entregadas.every(r => String(r.date_out ?? '').slice(0, 10) === hoy),
    `${entregadas.length} · ${entregadas.map(r => r.date_out).join(',')}`);

  // Verdad independiente (la BASE, no la pantalla): los conteos que la UI tiene que mostrar.
  const enBase = q1('SELECT COUNT(*) c FROM services WHERE client LIKE ?', `${PREFIJO}%`)?.c;
  const entBase = q1("SELECT COUNT(*) c FROM services WHERE client LIKE ? AND status='Entregado'", `${PREFIJO}%`)?.c;
  check('la base tiene las 3 órdenes (2 entregadas) — verdad independiente',
    enBase === 3 && entBase === 2, `total=${enBase} entregadas=${entBase}`);

  // ── 3) LA LISTA: abre en «Todos los estados» y lo ENTREGADO ya se ve ─────────────────────────
  await irA('Servicio Técnico');
  const filtroAlAbrir = await estadoFiltro();
  check('F44: el filtro de estado abre en «Todos los estados» (el default que pidió el dueño)',
    String(filtroAlAbrir).includes('Todos los estados'), String(filtroAlAbrir));
  const entregadaVisible = await evalx(`!!document.querySelector('[data-tech-quick="${idT2}"]')`);
  check('F44: una orden ENTREGADA aparece sin tocar ningún filtro (antes la lista abría vacía)',
    entregadaVisible === true, `id ${idT2}`);

  // Aislar las 3 órdenes de prueba con la búsqueda (el resto de la copia no participa del conteo).
  await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
  await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); return true; })()`);
  await keyNav('Backspace', 'Backspace', 8);
  await insertText(marca);
  await waitFor(`Number(document.querySelector('[data-work-picker]')?.getAttribute('data-work-total') ?? -1) === 3`, 12000);
  await sleep(600);

  const kpi = await equiposKpi();
  const tarj = await tarjetas();
  check('F44: los 3 equipos están en la lista (KPI y tarjetas)', kpi === 3 && tarj === 3, `kpi=${kpi} tarjetas=${tarj}`);

  // ── 3.b) F57: NO HAY MURO DE CHIPS — la pantalla no dibuja un botón por etiqueta ─────────────
  // El defecto que reportó el dueño: «no quiere tener todas las categorías, así se ve poco
  // profesional». Con el selector cerrado no puede quedar NI UN chip suelto en la pantalla.
  const chipsSueltos = await evalx(`document.querySelectorAll('[data-work-chip]').length`);
  check('F57: con el selector cerrado NO hay chips de trabajos en la pantalla (el muro se fue)',
    chipsSueltos === 0, `chips visibles=${chipsSueltos}`);
  check('F57: el filtro de trabajos es UN solo control', (await evalx(`document.querySelectorAll('[data-work-picker]').length`)) === 1);

  const totalTodos = await totalTrabajos();
  check('F57: el selector dice el total de la lista sin abrirse', totalTodos === 3, `data-work-total=${totalTodos}`);
  const abrio = await abrirTrabajos();
  check('F57: el selector se abre a un toque y trae buscador', abrio && await evalx(`!!document.querySelector('[data-work-search]')`));
  // OJO (revisión adversarial): `data-work-group` vive en el TÍTULO del grupo, no en las opciones, así
  // que contar opciones «sin ese atributo» no comprobaba nada. Lo que sí prueba el agrupamiento es la
  // POSICIÓN en el DOM: la etiqueta escrita a mano tiene que venir DESPUÉS del título de su grupo.
  const ordenGrupo = await evalx(`(() => {
    const g = document.querySelector('[data-work-group="libres"]');
    const op = document.querySelector('[data-work-chip="cambio de pin de carga"]');
    if (!g || !op) return null;
    return (g.compareDocumentPosition(op) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  })()`);
  const tituloLibres = await evalx(`document.querySelector('[data-work-group="libres"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
  check('F57: las etiquetas a mano van BAJO su propio grupo («Anotados a mano»), no entre los trabajos del taller',
    ordenGrupo === true, `grupo=«${tituloLibres}» · la opción va después: ${ordenGrupo}`);
  await buscarTrabajo('pin');
  await sleep(600);
  const opcionesPin = await evalx(`[...document.querySelectorAll('[data-work-chip]')].map(b => b.getAttribute('data-work-chip'))`);
  check('F57: el buscador encuentra por texto («pin» → el trabajo escrito a mano)',
    Array.isArray(opcionesPin) && opcionesPin.includes('cambio de pin de carga'), JSON.stringify(opcionesPin));
  await cerrarTrabajos();

  const chipTodos = await totalTrabajos();
  const chipPantalla = await contarTrabajo('cambio pantalla', 'pantalla');
  const chipPin = await contarTrabajo('cambio de pin de carga', 'pin');
  check('F44: el «Todos» del selector cuenta los equipos de la lista', chipTodos === 3, `total=${chipTodos}`);
  check('F44: «Cambio pantalla» cuenta la ENTREGADA y la que está en taller', chipPantalla === 2, `cantidad=${chipPantalla}`);
  check('F44: el trabajo ESCRITO A MANO tiene su propia entrada en el selector', chipPin === 1, `cantidad=${chipPin}`);
  const textoPin = await textoOpcion('cambio de pin de carga', 'pin');
  check('F44: ...y se muestra tal como se anotó', /pin de carga/i.test(String(textoPin)), String(textoPin));

  const lineaAlcance = await alcance();
  check('F44: la línea dice el estado, el eje de fecha y el rango',
    /todos los estados/.test(String(lineaAlcance)) && /fecha de RECIBO/.test(String(lineaAlcance)) && /todo el historial/.test(String(lineaAlcance)),
    String(lineaAlcance));
  check('F44: ...y avisa que un equipo con varios trabajos cuenta en cada uno',
    /varios trabajos/.test(String(lineaAlcance)), String(lineaAlcance));

  // ── 4) EL INVARIANTE: el trabajo elegido dice exactamente lo que aparece al filtrar ───────────
  await elegirTrabajo('cambio pantalla', 'pantalla');
  const tarjPantalla = await tarjetas();
  const kpiPantalla = await equiposKpi();
  check('F44: al filtrar por «Cambio pantalla» aparecen EXACTAMENTE las 2 tarjetas del selector',
    tarjPantalla === 2 && kpiPantalla === 2, `tarjetas=${tarjPantalla} kpi=${kpiPantalla} selector=2`);
  check('F57: el selector muestra cuál quedó elegido (sin abrirlo)',
    (await filtroActivo()) === 'cambio pantalla' && /Cambio pantalla/i.test(String(await evalx(`document.querySelector('[data-work-picker]')?.innerText ?? ''`))),
    `data-work-filter=${await filtroActivo()}`);
  await elegirTrabajo('todos');  // desfiltrar

  // ── 5) «ENTREGADOS HOY»: la respuesta a «¿cuántas pantallas hice hoy?» ───────────────────────
  // Acá está el defecto que reportó el dueño: con el eje de ENTREGA, los contadores de trabajos
  // contaban solo las órdenes activas → el de pantalla desaparecía aunque ya estuviera entregada.
  await clickCenter(`document.querySelector('[data-action="entregados-hoy"]')`);
  await sleep(2200);
  const chipPantallaHoy = await contarTrabajo('cambio pantalla', 'pantalla');
  const chipPinHoy = await contarTrabajo('cambio de pin de carga', 'pin');
  check('F44: con «Entregados hoy» la pantalla sigue contando (1 entregada hoy)',
    chipPantallaHoy === 1, `cantidad=${chipPantallaHoy}`);
  check('F44: y el trabajo escrito a mano también (1 entregado hoy)', chipPinHoy === 1, `cantidad=${chipPinHoy}`);
  const alcanceEntrega = await alcance();
  check('F44: el alcance ahora dice fecha de ENTREGA y el día',
    /fecha de ENTREGA/.test(String(alcanceEntrega)) && String(alcanceEntrega).includes(hoy), String(alcanceEntrega));
  const kpiHoy = await equiposKpi();
  check('F44: la lista entregada de hoy son 2 equipos', kpiHoy === 2, `kpi=${kpiHoy}`);

  // ── 6) la combinación IMPOSIBLE se explica (no queda muda) ───────────────────────────────────
  const eligio = await elegirEstado('Activos en taller');
  check('F44: se pudo elegir «Activos en taller» en el filtro de estado', eligio, `eligió=${eligio} · estado=${await estadoFiltro()}`);
  await sleep(1200);
  const vacio = await evalx(`document.querySelector('[data-empty="filtro"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
  check('F44: activos + fecha de ENTREGA se explica (no dice «sin servicios»)',
    !!vacio && /todavía no tiene fecha de entrega/.test(String(vacio)), String(vacio).slice(0, 140));
  const arreglo = await evalx(`[...document.querySelectorAll('[data-empty="filtro"] button')].map(b => b.innerText.trim())`);
  check('F44: ...y ofrece el arreglo a un toque', Array.isArray(arreglo) && arreglo.includes('Cambiar a Recibidos') && arreglo.includes('Ver todos los estados'), JSON.stringify(arreglo));

  // ── 7) «Limpiar filtros» quita todo de una vez ───────────────────────────────────────────────
  await clickCenter(`document.querySelector('[data-action="limpiar-filtros"]')`);
  await sleep(2200);
  const trasLimpiar = await evalx(`(() => ({
    estado: document.querySelector('main [role="combobox"][aria-label="Filtrar por estado"]')?.innerText.replace(/\\s+/g,' ').trim() ?? null,
    fechas: [...document.querySelectorAll('input[type="date"]')].map(i => i.value),
    busqueda: document.querySelector('input[placeholder*="Buscar" i]')?.value ?? null,
    limpiarVisible: !!document.querySelector('[data-action="limpiar-filtros"]'),
  }))()`);
  check('F44: «Limpiar filtros» deja el estado en «Todos los estados»',
    String(trasLimpiar?.estado).includes('Todos los estados'), String(trasLimpiar?.estado));
  check('F44: ...borra las fechas y la búsqueda, y el botón desaparece',
    (trasLimpiar?.fechas ?? ['x']).every(v => v === '') && trasLimpiar?.busqueda === '' && trasLimpiar?.limpiarVisible === false,
    JSON.stringify(trasLimpiar));
  const volvioTodo = await waitFor(`Number(document.querySelector('[data-work-picker]')?.getAttribute('data-work-total') ?? -1) > 3`, 12000);
  check('F44: ...y vuelve a contar todo el historial', volvioTodo, `total del selector=${await totalTrabajos()}`);
  check('F57: «Limpiar filtros» también saca el trabajo elegido',
    (await filtroActivo()) === '' && /Todos los trabajos/.test(String(await evalx(`document.querySelector('[data-work-picker]')?.innerText ?? ''`))),
    `data-work-filter=${await filtroActivo()} · dice=«${await evalx(`document.querySelector('[data-work-picker]')?.innerText.replace(/\\s+/g,' ').trim() ?? null`)}»`);
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}

// ── 8) LIMPIEZA: se borran las 3 órdenes y el stock vuelve a su valor ─────────────────────────
for (const id of [idT1, idT2, idT3]) {
  if (id) await invoke('delete_service', { id }).catch(e => check(`borrar la orden ${id}`, false, String(e)));
}
const restos = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => null);
check('las órdenes de prueba quedaron borradas (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);

// El stock se lee de la BASE (no de la pantalla): entregar descontó 1 y borrar la orden lo devuelve.
const stockDespues = q1('SELECT stock FROM products WHERE id = ?', pantalla.id)?.stock;
check('el stock de la pantalla volvió al valor inicial (inventario sin mover)',
  stockDespues === stockAntes, `${stockAntes} → ${stockDespues}`);

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
