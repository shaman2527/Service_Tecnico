// VERIFICACIÓN EN VIVO (CDP) de F81 — EL FILTRO VUELVE AL PREDETERMINADO AL IR A REGISTRAR.
//
// El pedido del dueño (2026-09-27): «cuando escribo en el filtro, en servicio, y cuando vaya a
// registrar un servicio nuevo el filtro automáticamente se ponga sin filtro predeterminado, se borre
// la búsqueda, porque a veces cuando creo un servicio y tiene un filtro activado me confunde la card:
// debería aparecerme el servicio que acabe de registrar».
//
// Qué comprueba sobre la app REAL:
//   1. Con la lista FILTRADA (búsqueda + «Entregado» + eje «Entregados» + período «Hoy»), al pulsar
//      «Nuevo Servicio» la barra queda en el PREDETERMINADO **antes de guardar**: búsqueda vacía,
//      «Todos los estados», sin fechas, eje «Recibidos», sin chip de trabajo.
//   2. El atajo N/F2 hace lo mismo; y si se CANCELA sin registrar, los filtros VUELVEN (un N apretado
//      sin querer no le borra la búsqueda al operario).
//   3. Al GUARDAR, la tarjeta de la orden nueva está en la lista, marcada con `data-nueva`, y la
//      pantalla bajó hasta ella (la tarjeta quedó dentro de la ventana).
//   4. El resaltado se apaga solo cuando el operario toca un filtro (no queda mintiendo).
//   5. EDITAR una orden NO toca los filtros (si estaba corrigiendo una orden dentro de su lista
//      filtrada, no se lo tira a otra vista).
//
// SEGURIDAD DE DATOS: `REGISTRO_DB` OBLIGATORIO y tiene que ser una COPIA (aborta con registro.db);
// exige el turno de HOY abierto (no lo abre) y BORRA la orden de prueba que crea.
//
// Uso:  node tools/snapshot_db.mjs --out backup/f81_verif.db --force
//       $env:REGISTRO_DB="C:\...\backup\f81_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       (lanzar la app)  →  node tools/verify_alta_limpia_filtros.mjs

import { evalx, clickCenter, keyNav, escribirEn, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

// ── 0) GATE DE DATOS: copia + turno de HOY abierto ───────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath) || path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a una COPIA de la base (nunca registro.db).');
  console.error('  node tools/snapshot_db.mjs --out backup/f81_verif.db --force');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).get(...p) ?? {}; } catch (e) { return { err: String(e.message) }; } };
const hoy = String(uno("SELECT date('now','localtime') AS d").d ?? '');
const turno = uno('SELECT close_date FROM daily_closings WHERE is_closed=0')?.close_date ?? null;
if (turno !== hoy) {
  console.error(`ABORTADO: el turno abierto es ${turno ?? 'ninguno'} y hoy es ${hoy}.`);
  console.error('  Esta prueba CREA una orden de hoy: cerrá el día viejo y abrí el de hoy en la copia');
  console.error('  (o corré primero: node tools/verify_turno_viejo.mjs, que hace justamente ese remedio).');
  process.exit(2);
}

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const dialogTxt = () => evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`);
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
const buscarInput = `document.querySelector('main input[placeholder^="Buscar cliente"]')`;
const estadoSel = `document.querySelector('main [role="combobox"][aria-label="Filtrar por estado"]')`;
const fechas = `JSON.stringify([...document.querySelectorAll('main input[type="date"]')].map(i => i.value))`;
const ejeOn = (t) => evalx(`(() => [...document.querySelectorAll('main button')].filter(b => b.innerText.trim() === ${JSON.stringify(t)}).map(b => b.getAttribute('data-state'))[0] ?? null)()`);

console.log('— F81: el filtro vuelve al predeterminado al ir a registrar — EN VIVO —');

// ── 1) App arriba y con sesión abierta ───────────────────────────────────────────────────────────
// El gate del PIN no es lo que se prueba: la sesión se abre por la misma vía del frontend
// (`verify_user_pin`) y se recarga (la sesión vive en el backend 12 h → la app entra directo, F68).
const asegurarSesion = async () => {
  for (let i = 0; i < 25; i++) {
    if (await evalx(`!!document.querySelector('aside')`).catch(() => false)) return true;
    try {
      const users = await invoke('get_users').catch(() => []);
      const u = (users ?? []).find(x => x.role === 'master') ?? (users ?? [])[0];
      if (u) await invoke('verify_user_pin', { userId: u.id, pin: '1234' }).catch(() => {});
      await evalx(`location.reload(); 'ok'`).catch(() => {});
    } catch { /* cargando */ }
    await sleep(2500);
  }
  return false;
};
const listo = await asegurarSesion();
check('la app responde y entra (sesión de dueño)', listo);
if (!listo) process.exit(1);
/**
 * Cierra lo que pueda estar tapando la pantalla: el aviso de política (F46/F77) y cualquier diálogo.
 * Lección documentada del proyecto: el velo de un modal se come el primer clic y la prueba siguiente
 * culpa a la pantalla.
 */
const cerrarAvisos = async () => {
  for (let i = 0; i < 4; i++) {
    if (!(await evalx(`!!document.querySelector('[data-policy-modal]')`).catch(() => false))) break;
    await evalx(`(() => { const b = document.querySelector('[data-policy-later]'); if (b) b.click(); return !!b; })()`).catch(() => {});
    await sleep(700);
  }
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27); await sleep(800); }
};
await cerrarAvisos();

await evalx(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.trim().startsWith('Servicio')); if (b) b.click(); return !!b; })()`);
await sleep(1800);
check('estamos en Servicio Técnico', await waitFor(`${buscarInput} !== null`, 8000));

// ── 2) ARMAR EL FILTRO QUE ESCONDE LA ORDEN NUEVA (el caso que confunde al dueño) ────────────────
const ponerFiltros = async () => {
  // OJO: se REEMPLAZA el valor (setter nativo), no se teclea encima: `escribirEn` agrega al final y
  // la búsqueda quedaba con el texto dos veces (lo midió la primera corrida).
  await setValue('main input[placeholder^="Buscar cliente"]', 'zzz-no-existe');
  await sleep(1000);
  await clickCenter(estadoSel);
  await sleep(700);
  await clickCenter(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent || '').includes('Entregado'))`);
  await sleep(1200);
  await clickCenter(`[...document.querySelectorAll('main button')].find(b => b.innerText.trim() === 'Entregados')`);
  await sleep(400);
  await clickCenter(`[...document.querySelectorAll('main button')].find(b => b.innerText.trim() === 'Hoy')`);
  await sleep(1400);
};
const filtrosSucios = async () => ({
  search: String(await evalx(`${buscarInput}?.value ?? ''`)),
  estado: String(await evalx(`${estadoSel}?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)),
  fechas: String(await evalx(fechas)),
  eje: String(await ejeOn('Entregados')),
  limpiar: await evalx(`!!document.querySelector('[data-action="limpiar-filtros"]')`),
});
await ponerFiltros();
const sucio = await filtrosSucios();
check('el filtro quedó puesto (búsqueda + Entregado + eje Entregados + Hoy)',
  sucio.search === 'zzz-no-existe' && /Entregado/.test(sucio.estado) && sucio.eje === 'on' && sucio.limpiar,
  JSON.stringify(sucio));

// ── 3) EL ATAJO N/F2: limpia al abrir y DEVUELVE los filtros si se cancela sin registrar ────────
await evalx(`document.activeElement?.blur?.(); true`);
await keyNav('n', 'KeyN', 78);
const abrioAtajo = await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 8000);
check('el atajo N abre el alta', abrioAtajo);
const enAtajo = await evalx(`${buscarInput}?.value ?? null`);
check('F81: con el atajo N la búsqueda también quedó vacía (misma puerta de entrada)', enAtajo === '', `valor=${JSON.stringify(enAtajo)}`);
await keyNav('Escape', 'Escape', 27);
const cerroAtajo = await waitFor(`!document.querySelector('[role="dialog"]')`, 8000);
await sleep(1200);
const trasCancelar = await evalx(`${buscarInput}?.value ?? null`);
check('F81: al CANCELAR sin registrar, los filtros del operario VUELVEN (no se los borra un N sin querer)',
  cerroAtajo && trasCancelar === 'zzz-no-existe', `valor=${JSON.stringify(trasCancelar)}`);

// ── 4) EL CAMINO DEL BOTÓN: al abrir el alta la barra queda en el PREDETERMINADO ─────────────────
await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) || null)`);
const abrio = await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
check('«Nuevo Servicio» abre el wizard', abrio);
const limpio = await filtrosSucios();
check('F81: la BÚSQUEDA se borró sola al ir a registrar', limpio.search === '', `búsqueda=${JSON.stringify(limpio.search)}`);
check('F81: el estado volvió a «Todos los estados»', /Todos los estados/.test(limpio.estado), limpio.estado);
check('F81: el rango de fechas (y el período «Hoy») quedó vacío', limpio.fechas === '["",""]', limpio.fechas);
check('F81: el eje volvió a «Recibidos»', String(await ejeOn('Recibidos')) === 'on', `Entregados=${await ejeOn('Entregados')}`);
check('F81: el chip de trabajo quedó sin elegir y no hay «Limpiar filtros»', limpio.limpiar === false);

// ── 5) GUARDAR UNA ORDEN REAL POR EL WIZARD ─────────────────────────────────────────────────────
const MODELO = (await invoke('get_phone_models', { search: '', limit: 60 }).catch(() => []))?.[0]?.label ?? null;
check('hay un modelo del padrón para el equipo de prueba', !!MODELO, String(MODELO));
if (!MODELO) process.exit(1);
const marca = String(Date.now()).slice(-6);
const CLIENTE = `Prueba F81 ${marca}`;

// Se llena con la MISMA receta probada de `verify_imprimir_en_wizard.mjs` (paso Cliente → Equipo).
await setValue('[role="dialog"] input[placeholder^="Buscar por nombre o cédula"]', CLIENTE);
await sleep(400);
await setValue('[role="dialog"] input[placeholder="V-12345678"]', `V-9${marca}`);
await sleep(700);
await clickDialogExact('Siguiente');
await sleep(1400);
await setValue('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]', MODELO);
const haySugerencia = await waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => (b.innerText || '').replace(/\\s+/g,' ').trim().startsWith(${JSON.stringify(MODELO)}) && !/^Pantalla /.test((b.innerText || '').trim()))`, 10000);
await evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => {
    const t = (x.innerText || '').replace(/\\s+/g, ' ').trim();
    return t.startsWith(${JSON.stringify(MODELO)}) && !/^Pantalla /.test(t);
  });
  if (b) b.click();
  return !!b;
})()`);
await sleep(1000);
check('el modelo del equipo se eligió de la lista', haySugerencia, String(MODELO));
// Trabajos: se enciende «Cambio batería» y se apaga «Cambio pantalla» (así no exige elegir pantalla).
const chipOn = (label) => evalx(`(([...document.querySelectorAll('[role="dialog"] button')]
  .find(b => (b.innerText || '').trim() === ${JSON.stringify(label)})?.className || '') + '').includes('bg-primary')`);
const setTrabajo = async (label, on) => {
  for (let i = 0; i < 4; i++) {
    if ((await chipOn(label)) === on) return true;
    await clickDialogExact(label).catch(() => {});
    await sleep(600);
    if ((await chipOn(label)) === on) return true;
  }
  return (await chipOn(label)) === on;
};
check('el equipo quedó con el trabajo «Cambio batería» (sin pantalla, no mueve stock)', await setTrabajo('Cambio batería', true));
check('y sin «Cambio pantalla» (no exige elegir repuesto)', await setTrabajo('Cambio pantalla', false));
// Color (obligatorio): se elige con el teclado desde su campo.
await evalx(`(() => { const t = document.querySelector('[data-ficha-target="color"]'); if (t) t.focus(); return !!t; })()`);
await keyNav('Enter', 'Enter', 13);
await sleep(700);
let colorOk = false;
for (let i = 0; i < 14 && !colorOk; i++) {
  const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
  if (String(hi).includes('Azul')) { await keyNav('Enter', 'Enter', 13); await sleep(700); colorOk = true; break; }
  await keyNav('ArrowDown', 'ArrowDown', 40);
  await sleep(200);
}
check('el equipo quedó con color (obligatorio para guardar)', colorOk);
await clickDialogExact('Siguiente');   // Blindaje
await sleep(900);
await clickDialogExact('Siguiente');   // Revisar
await sleep(1000);
// Se intenta destildar «Imprimir la orden ahora» para que el comprobante no tape la lista. El rótulo
// del botón es la fuente que no depende del interior del bloque (F77): si el bloque ya viene destildado
// o no aparece, se sigue igual — lo que se está probando acá es el ALTA, no la impresión.
const hayCheck = await waitFor(`!!document.querySelector('[data-field="imprimir-al-guardar"]')`, 3000);
if (hayCheck) await evalx(`(() => { const c = document.querySelector('[data-field="imprimir-al-guardar"]'); if (c && c.checked) c.click(); return c?.checked ?? null; })()`);
await sleep(600);
const botonGuardar = await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^(Guardar|Actualizar)/.test((x.innerText || '').trim())); return b ? { label: b.innerText.trim(), disabled: b.disabled } : null; })()`);
check('el registro llega al último paso (el botón que guarda está disponible)', botonGuardar && !botonGuardar.disabled, JSON.stringify(botonGuardar));
console.log(`   (check de imprimir: ${hayCheck ? 'presente y destildado' : 'no presente'} · botón: ${botonGuardar?.label})`);
await clickCenter(`[...document.querySelectorAll('[role="dialog"] button')].find(x => /^(Guardar|Actualizar)/.test((x.innerText || '').trim()))`);
const cerro = await waitFor(`!((document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Servicio Técnico'))`, 15000);
check('la orden se guardó y el wizard se cerró', cerro);
const fila = uno("SELECT id, order_num, client, status FROM services WHERE client = ?1 ORDER BY id DESC LIMIT 1", CLIENTE);
check('la orden existe en la base (verdad independiente)', !!fila?.id, JSON.stringify(fila));

// ── 6) LA TARJETA NUEVA SE VE: resaltada, en la lista, y la pantalla bajó hasta ella ─────────────
const enLista = await waitFor(`!!document.querySelector('[data-nueva]')`, 12000);
check('F81: la tarjeta recién creada está en la lista y marcada (data-nueva)', enLista);
const marcada = await evalx(`(() => { const c = document.querySelector('[data-nueva]'); if (!c) return null; const r = c.getBoundingClientRect(); return { orden: c.getAttribute('data-nueva'), texto: (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 60), enVentana: r.top >= -40 && r.bottom <= window.innerHeight + 40 }; })()`);
check('F81: la marca corresponde a la orden nueva', String(marcada?.orden ?? '') === String(fila?.order_num ?? ''), `marcada=${marcada?.orden} · orden=${fila?.order_num}`);
check('F81: la lista BAJÓ hasta la tarjeta (quedó dentro de la ventana)', marcada?.enVentana === true, JSON.stringify(marcada));
check('F81: la tarjeta es la de la orden nueva (dice el cliente)', String(marcada?.texto ?? '').includes(CLIENTE), String(marcada?.texto));
const trasGuardar = await filtrosSucios();
check('F81: después de guardar, los filtros siguen en el predeterminado',
  trasGuardar.search === '' && /Todos los estados/.test(trasGuardar.estado) && trasGuardar.fechas === '["",""]');

// ── 7) El resaltado se apaga cuando el operario toca un filtro ───────────────────────────────────
await cerrarAvisos();   // el guardado deja su aviso de política: hay que cerrarlo antes de seguir
await setValue('main input[placeholder^="Buscar cliente"]', CLIENTE);
await sleep(1600);
check('F81: al escribir en el buscador el resaltado se apaga (no queda mintiendo)',
  !(await evalx(`!!document.querySelector('[data-nueva]')`)));
// SONDA (para diagnosticar la edición): qué quedó en el buscador y cuántas tarjetas hay a la vista.
const trasBuscar = await evalx(`JSON.stringify({ busqueda: ${buscarInput}?.value ?? null, editar: [...document.querySelectorAll('main button')].filter(b => (b.innerText || '').trim() === 'Editar').length })`);
console.log(`   sonda tras buscar al cliente: ${trasBuscar}`);

// ── 8) EDITAR NO TOCA LOS FILTROS DEL OPERARIO ───────────────────────────────────────────────────
const tarjetaEdit = await waitFor(`[...document.querySelectorAll('main button')].some(b => (b.innerText || '').trim() === 'Editar')`, 10000);
if (tarjetaEdit) {
  // El comprobante (F77) y el aviso de política dejan su velo: se cierran antes de pulsar «Editar»,
  // porque el primer clic se lo come el modal (lección documentada del proyecto).
  await cerrarAvisos();
  let abrioEdit = false;
  for (let intento = 0; intento < 3 && !abrioEdit; intento++) {
    await clickCenter(`[...document.querySelectorAll('main button')].find(b => (b.innerText || '').trim() === 'Editar')`).catch(() => {});
    abrioEdit = await waitFor(`/^Editar /m.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 8000);
    if (!abrioEdit) await cerrarAvisos();
  }
  const busquedaEnEdicion = await evalx(`${buscarInput}?.value ?? null`);
  check('F81: al EDITAR una orden la búsqueda queda intacta (los filtros son del operario)',
    abrioEdit && busquedaEnEdicion === CLIENTE, `abrió=${abrioEdit} · valor=${JSON.stringify(busquedaEnEdicion)}`);
  await keyNav('Escape', 'Escape', 27);
  await sleep(900);
  await cerrarAvisos();
  check('F81: al cerrar la edición la búsqueda sigue ahí', String(await evalx(`${buscarInput}?.value ?? ''`)) === CLIENTE);
} else {
  check('hay una tarjeta para probar la edición', false, 'sin botón Editar');
}

// ── 9) LIMPIEZA: se borra la orden de prueba (la copia queda como estaba) ────────────────────────
if (fila?.id) await invoke('delete_service', { id: fila.id }).catch(() => {});
check('la prueba borra su orden (no deja basura en la copia)',
  Number(uno('SELECT COUNT(*) AS n FROM services WHERE client = ?1', CLIENTE)?.n ?? -1) === 0);

const failed = out.filter(o => !o.ok);
console.log(`\nverify_alta_limpia_filtros: ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
