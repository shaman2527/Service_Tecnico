// VERIFICACIÓN EN VIVO (CDP) de F67 — EL PRECIO DEL REPUESTO.
//
// Pedido del dueño (2026-09-23), en la parte de SERVICIOS: «quiero que en el servicio cuando yo
// seleccione una pantalla pueda tomar el precio de venta de ese producto, o se puede seguir usando
// también el que tengo al lado de modelos» + «que se pueda tomar los precios del producto».
//
// Qué comprueba sobre la app REAL (contra la BASE leída aparte, nunca contra sí misma):
//   1. **La lista de pantallas muestra el precio que se va a tomar** (`data-precio-ficha`) y ese número
//      es el de ESA ficha en la base (por id de producto): en efectivo, el precio CONTADO con la lista
//      al lado (también cuando la ficha no tiene precio de venta pero sí contado).
//   2. **Elegir una pantalla TOMA su precio**: el Monto queda con el precio de la ficha elegida y el
//      formulario dice de dónde salió (`data-precio-fuente="pantalla"`).
//   3. **La cuenta del efectivo es la correcta**: Monto = lista, Descuento = lista − contado y el Total
//      es el precio contado (antes quedaba en 2·contado − lista).
//   4. **Lo que el operario escribió NO se pisa** — ni el monto ni el descuento: si él teclea el monto
//      (99), elegir una ficha NO le rebaja nada de arriba (el Total es 99, no 96), y si teclea un monto
//      con un descuento calculado encima, ese descuento se va con el número viejo.
//   5. **El precio del MODELO sigue funcionando** («el que tengo al lado de modelos»): con un modelo de
//      precio único se toma solo, con otro precio aparece su botón, y al CAMBIAR de modelo el monto es
//      el del modelo NUEVO (nunca el del anterior: el bug que F67 vino a arreglar).
//   6. **Una ficha sin precio cargado** no inventa nada: se avisa y el monto no se toca.
//   7. **Con otro trabajo (sin «Cambio pantalla») la pantalla no mueve el monto** (es informativa): se
//      comprueba en un equipo con el monto SIN TOCAR, que es la única forma de que la prueba pueda
//      fallar si el gate se rompe.
//   8. **La orden GUARDADA recibe ese precio**: se crea una orden de prueba por IPC ($0, sin pantalla),
//      se le toma el precio de una ficha con el botón, se guarda con «Actualizar Servicio» y se lee la
//      BASE (amount = lista − descuento, discount_amount y screen_product_id) — y después se borra.
//   9. **En EDICIÓN una orden guardada no cambia de monto sola**: cambiar de pantalla no toca el monto.
//
// FIXTURE (preparado y DEVUELTO por esta prueba, sobre la COPIA, pase lo que pase):
//   · se busca un modelo con DOS pantallas de precios distintos (y uno con una pantalla SIN precio);
//   · a la pantalla más barata se le carga un `price_usd` para comprobar la cuenta del efectivo.
//   El `process.on('exit')` devuelve las dos columnas aunque la prueba aborte en el medio.
//
// SEGURIDAD DE DATOS: la única orden que se escribe es la de la comprobación 8 (creada y borrada en la
// misma corrida). Todo lo demás es lectura. NUNCA correr contra la base real (`registro.db`): el script
// la rechaza por nombre.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f67_verif.db"      (COPIA de la base, nunca la real)
//       app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_precio_pantalla.mjs

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

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

// ── 0) GATE: la base (la verdad independiente) ─────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  process.exit(2);
}
if (path.basename(dbPath).toLowerCase() === 'registro.db') {
  console.error('ABORTADO: esta prueba ESCRIBE precios de fixture — nunca contra la base real. Apuntá REGISTRO_DB a una copia.');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const filas = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return [{ err: String(e.message) }]; } };
const uno = (sql, ...p) => filas(sql, ...p)[0] ?? {};
const cuenta = (sql, ...p) => Number(uno(sql, ...p).n ?? -1);
const producto = (id) => uno(
  `SELECT id, COALESCE(name,'') AS name, COALESCE(price_sale,0) AS price_sale,
          COALESCE(price_usd,0) AS price_usd, COALESCE(stock,0) AS stock
   FROM products WHERE id=?1`, id);

// El fixture se escribe con una conexión de ESCRITURA sobre la COPIA. Solo se tocan `price_usd` y
// `price_sale` (las dos del precio), con sentencias FIJAS (nada de SQL armado con texto) y se devuelven
// al terminar — incluso si la prueba aborta o se cae.
const dbW = new DatabaseSync(dbPath);
const fixtureEscrito = [];
const escribir = (id, col, valor) => {
  const previo = Number(producto(id)[col] ?? 0);
  if (col === 'price_usd') dbW.prepare('UPDATE products SET price_usd = ? WHERE id = ?').run(valor, id);
  else dbW.prepare('UPDATE products SET price_sale = ? WHERE id = ?').run(valor, id);
  fixtureEscrito.push({ id, col, previo });
  return previo;
};
const devolverFixture = () => {
  for (const f of fixtureEscrito) {
    if (f.col === 'price_usd') dbW.prepare('UPDATE products SET price_usd = ? WHERE id = ?').run(f.previo, f.id);
    else dbW.prepare('UPDATE products SET price_sale = ? WHERE id = ?').run(f.previo, f.id);
  }
  fixtureEscrito.length = 0;
};
process.on('exit', () => { try { devolverFixture(); dbW.close(); } catch { /* la copia ya no importa */ } });

const antes = {
  ordenes: cuenta('SELECT COUNT(*) AS n FROM services'),
  plata: uno('SELECT COALESCE(SUM(amount),0) AS s, COALESCE(SUM(discount_amount),0) AS d FROM services'),
  pantallas: cuenta('SELECT COUNT(*) AS n FROM products WHERE category_id=1'),
  stockPantallas: Number(uno('SELECT COALESCE(SUM(stock),0) AS s FROM products WHERE category_id=1').s ?? 0),
  plataCatalogo: Number(uno('SELECT COALESCE(SUM(COALESCE(price_sale,0) + COALESCE(price_usd,0) * 1000),0) AS s FROM products').s ?? 0),
};

// ── 1) entrar a la app (PIN si hace falta) e ir a Servicio Técnico ─────────────────────────────
await evalx(`location.reload(); 'recargando'`).catch(() => {});
await sleep(2500);
for (let i = 0; i < 12; i++) {
  if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
  await sleep(800);
}
const pin = `document.querySelector('input[placeholder="PIN de 4 dígitos"]')`;
if (await evalx(`!!${pin}`)) { await clickCenter(pin); await typeText('1234'); await keyNav('Enter', 'Enter', 13); await sleep(2500); }

const cerrarDialogos = async () => {
  for (let i = 0; i < 4; i++) {
    if (await evalx(`document.querySelectorAll('[role="dialog"]').length === 0`)) return true;
    await keyNav('Escape', 'Escape', 27);
    await sleep(700);
  }
  return await evalx(`document.querySelectorAll('[role="dialog"]').length === 0`);
};
await cerrarDialogos();
await clickCenter(`[...document.querySelectorAll('aside button')].find(b => /servicio t/i.test(b.getAttribute('title') || b.innerText || ''))`);
await waitFor(`[...document.querySelectorAll('button')].some(b => /Nuevo Servicio/.test(b.innerText || ''))`, 20000);

/** Llama a un comando del backend desde la página (la misma puerta que usa la app). */
const invoke = (m, a) => evalx(`(async () => {
  try { const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(m)}, ${JSON.stringify(a ?? {})}); return JSON.stringify({ ok: r }); }
  catch (e) { return JSON.stringify({ err: String(e) }); }
})()`).then(r => {
  const o = JSON.parse(String(r ?? '{}'));
  if (o.err) throw new Error(o.err);
  return o.ok;
});

// ── 1b) LIMPIEZA PREVIA: los restos de una corrida anterior (esta prueba es la única que crea órdenes
// con este nombre). Sin esto, un aborto en el medio deja la copia sucia y la comprobación final de
// «sin residuos» falla culpando al producto (pasó: la corrida que se cayó por un error del script dejó
// su orden y la siguiente la contó como resto de sí misma). ───────────────────────────────────────
const PREFIJO_ORDEN = 'Prueba Precio Orden';
{
  const sobrantes = await invoke('get_services', { search: PREFIJO_ORDEN, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
  if (Array.isArray(sobrantes) && sobrantes.length > 0) {
    for (const r of sobrantes) await invoke('delete_service', { id: r.id }).catch(() => {});
    console.log(`· limpieza previa: se borraron ${sobrantes.length} orden(es) de prueba de una corrida anterior`);
  }
}
console.log(`· base al empezar: ${antes.ordenes} órdenes · ${antes.pantallas} fichas de pantalla · stock ${antes.stockPantallas}`);

// ── 2) EL FIXTURE: leído del BACKEND (la misma fuente del formulario) ───────────────────────────
// Los oráculos de abajo se calculan ACÁ, aparte del producto: por eso valen como comprobación.
const montoDeFicha = (p, efectivo) => {
  const venta = Number(p.price_sale) || 0;
  const contado = Number(p.price_usd) || 0;
  if (venta > 0) return venta;
  if (efectivo && contado > 0) return contado;
  return null;
};
const precioDeFila = (p, efectivo) => {
  const venta = Number(p.price_sale) || 0;
  const contado = Number(p.price_usd) || 0;
  if (efectivo && contado > 0) return contado;
  if (venta > 0) return venta;
  return null;
};
const montoDelGrupo = (items, efectivo) => {
  if (!items.length) return null;
  if (efectivo) {
    const con = items.filter(x => Number(x.price_usd) > 0);
    if (con.length > 0) {
      const e = con.reduce((a, b) => (Number(b.price_usd) < Number(a.price_usd) ? b : a));
      return montoDeFicha(e, true);
    }
  }
  const ventas = [...new Set(items.map(x => Number(x.price_sale) || 0).filter(v => v > 0))];
  return ventas.length === 1 ? ventas[0] : null;
};

const modelosRaw = await evalx(`(async () => {
  const r = await window.__TAURI_INTERNALS__.invoke('get_phone_models_in_use', { search: '', limit: 0, inUseOnly: true });
  return JSON.stringify(r.filter(m => (m.label || '').trim().length >= 4 && m.screens > 0).map(m => m.label));
})()`);
const listaModelos = JSON.parse(String(modelosRaw ?? '[]'));
const TOPE_BARRIDO = 120;
console.log(`· modelos en uso con repuestos: ${listaModelos.length} (se miran los primeros ${TOPE_BARRIDO})`);
const compatiblesDe = async (modelo) => {
  const raw = await evalx(`(async () => {
    const r = await window.__TAURI_INTERNALS__.invoke('find_compatible_products', { model: ${JSON.stringify(modelo)}, categoryId: null, limit: 80 });
    return JSON.stringify(r.map(x => ({ id: x.product.id, name: x.product.name, category_id: x.product.category_id,
      price_sale: x.product.price_sale, price_usd: x.product.price_usd, stock: x.product.stock, in_stock: x.in_stock })));
  })()`).catch(() => null);
  return raw ? JSON.parse(String(raw)) : [];
};

let F1 = null, F1sinCero = null, F2 = null, F3 = null, Fzero = null;
for (const m of listaModelos.slice(0, TOPE_BARRIDO)) {
  const items = await compatiblesDe(m);
  if (items.length === 0) continue;
  const pantallas = items.filter(x => x.category_id === 1);
  const conPrecio = pantallas.filter(p => montoDeFicha(p, false) != null);
  const distintos = [...new Set(conPrecio.map(p => montoDeFicha(p, false)))];
  const sinPrecio = pantallas.filter(p => montoDeFicha(p, false) == null);
  if (conPrecio.length >= 2 && distintos.length >= 2) {
    const cand = { model: m, items, pantallas, conPrecio, distintos, sinPrecio };
    if (sinPrecio.length > 0 && !F1sinCero) F1sinCero = cand;
    if (!F1) F1 = cand;
  }
  if (conPrecio.length >= 1 && sinPrecio.length >= 1 && !Fzero) Fzero = { model: m, items, pantallas, conPrecio, sinPrecio };
  const grupo = montoDelGrupo(items, true);
  if (grupo != null && !F2 && m !== F1?.model) F2 = { model: m, items, grupo };
  if (grupo != null && F2 && !F3 && m !== F1?.model && m !== F2.model && Number(grupo) !== Number(F2.grupo)) F3 = { model: m, items, grupo };
  if (F1sinCero && F2 && F3 && Fzero) break;
}
if (F1sinCero) F1 = F1sinCero;
check('F67: hay un modelo con DOS pantallas de precios distintos (si no, la prueba no diría nada)',
  !!F1, F1 ? `«${F1.model}» → precios ${JSON.stringify(F1.distintos)}` : `ninguno entre los primeros ${TOPE_BARRIDO} modelos en uso`);
check('F67: hay un modelo con una pantalla con precio y otra SIN precio (el aviso honesto)', !!Fzero,
  Fzero ? `«${Fzero.model}» → ${Fzero.conPrecio.length} con precio · ${Fzero.sinPrecio.length} sin precio` : 'ninguno en esta copia');
check('F67: hay un SEGUNDO modelo con un precio de grupo único (el respaldo «del modelo»)', !!F2,
  F2 ? `«${F2.model}» → $${F2.grupo}` : 'ninguno en esta copia');
check('F67: y un TERCER modelo con OTRO precio de grupo (para el cambio de modelo)', !!F3,
  F3 ? `«${F3.model}» → $${F3.grupo}` : 'ninguno en esta copia');
if (!F1 || !Fzero || !F2 || !F3) {
  console.error('ABORTADO: esta copia no tiene los datos que la prueba necesita (no es una falla del producto: usá otra copia).');
  process.exit(2);
}

// fixture del EFECTIVO: a la pantalla más barata con precio se le carga un precio contado.
// OJO: el oráculo del grupo se calcula DESPUÉS de esta escritura (es lo que va a ver la app).
const barata = F1.conPrecio.reduce((a, b) => (a.price_sale <= b.price_sale ? a : b));
const contadoFake = Math.max(1, Number((barata.price_sale - 3).toFixed(2)));
escribir(barata.id, 'price_usd', contadoFake);
barata.price_usd = contadoFake;
const grupoF1 = montoDelGrupo(F1.items, true);
const otraF1 = F1.conPrecio.find(p => p.id !== barata.id && Number(p.price_usd) === 0);
console.log(`· fixture: «${barata.name}» (id ${barata.id}) pasa a lista $${barata.price_sale} · contado $${contadoFake} (se devuelve al final)`);
check('F67: hay una SEGUNDA pantalla con otro precio y sin contado (para el cambio de pantalla)', !!otraF1,
  otraF1 ? `«${otraF1.name}» → $${montoDeFicha(otraF1, true)}` : JSON.stringify(F1.conPrecio.map(p => ({ id: p.id, venta: p.price_sale, contado: p.price_usd }))));

/** Abre el wizard de servicio: cliente + cédula y «Siguiente» hasta el paso 2. */
const abrirWizard = async (nombre, ci) => {
  await evalx(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Nuevo Servicio/.test(x.innerText || '')); if (b) b.click(); return !!b; })()`);
  if (!await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 12000)) return false;
  const enfocar = async (sel, intentos = 6) => {
    for (let i = 0; i < intentos; i++) {
      await clickCenter(sel).catch(() => {});
      if (await evalx(`document.activeElement === (${sel})`).catch(() => false)) return true;
      await sleep(400);
    }
    return false;
  };
  const okCliente = await enfocar(`document.querySelector('[role="dialog"] input[placeholder^="Buscar por nombre"]')`);
  await typeText(nombre);
  const okCi = await enfocar(`document.querySelector('[role="dialog"] input[placeholder="V-12345678"]')`);
  await typeText(ci);
  await sleep(400);
  for (let i = 0; i < 4; i++) {
    if (/Paso 2 de 4/.test(String(await evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)))) return okCliente && okCi;
    await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim())); if (b && !b.disabled) b.click(); return !!b; })()`);
    if (await waitFor(`/Paso 2 de 4/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 3000)) return okCliente && okCi;
  }
  return false;
};

// ── 3) el paso de Equipos ─────────────────────────────────────────────────────────────────────
check('F67: «Nuevo Servicio» abre el wizard y se llega al paso de Equipos', await abrirWizard('Prueba Precio Pantalla', 'V-88888888'));

// ── utilidades de pantalla (POR EQUIPO: el wizard de alta tiene N) ────────────────────────────
const dev = (i) => `document.querySelector('[role="dialog"] [data-device="${i}"]')`;
const SEL_MONTO = (i) => `${dev(i)}.querySelector('input[aria-label="Monto ($) del servicio"]')`;
const SEL_DESC = (i) => `${dev(i)}.querySelector('input[aria-label="Descuento ($) del servicio"]')`;
const leerMonto = async (i) => Number(await evalx(`(${SEL_MONTO(i)})?.value ?? 'NaN'`));
const leerDesc = async (i) => Number(await evalx(`(${SEL_DESC(i)})?.value || 0`));
const leerFuente = async (i) => evalx(`(${dev(i)}.querySelector('[data-precio-repuesto]'))?.getAttribute('data-precio-fuente') ?? null`);
const leerElegida = async (i) => evalx(`(() => {
  const b = ${dev(i)}.querySelector('[data-screen-option][data-screen-elegida="1"]');
  return b ? Number(b.getAttribute('data-screen-option')) : null;
})()`);
const leerFilas = async (i) => evalx(`JSON.stringify([...${dev(i)}.querySelectorAll('[data-screen-option]')].map(b => ({
  id: Number(b.getAttribute('data-screen-option')),
  elegida: b.getAttribute('data-screen-elegida') === '1',
  precio: (() => { const s = b.querySelector('[data-precio-ficha]'); return s ? Number(s.getAttribute('data-precio-ficha')) : null; })(),
  texto: (b.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 70),
})))`);
const leerChipPantalla = async (i) => evalx(`(() => { const b = ${dev(i)}.querySelector('[data-usar-precio-pantalla]'); return b ? Number(b.getAttribute('data-usar-precio-pantalla')) : null; })()`);
const leerChipModelo = async (i) => evalx(`(() => { const b = ${dev(i)}.querySelector('[data-usar-precio-modelo]'); return b ? Number(b.getAttribute('data-usar-precio-modelo')) : null; })()`);
const clickPantalla = async (i, id) => { await clickCenter(`(${dev(i)}.querySelector('[data-screen-option="${id}"]'))`); await sleep(1000); };
const clickChip = async (i, sel) => { await clickCenter(`${dev(i)}.querySelector('${sel}')`); await sleep(900); };
const total = async (i) => Number(((await leerMonto(i)) - (await leerDesc(i))).toFixed(2));

// Las MISMAS lecturas para el formulario de EDICIÓN (una sola orden: no tiene `data-device`).
const SEL_EDIT_MONTO = `document.querySelector('[role="dialog"] input[aria-label="Monto ($) del servicio"]')`;
const SEL_EDIT_DESC = `document.querySelector('[role="dialog"] input[aria-label="Descuento ($) del servicio"]')`;
const totalEdit = async () => Number((
  Number(await evalx(`(${SEL_EDIT_MONTO})?.value ?? 'NaN'`)) - Number(await evalx(`(${SEL_EDIT_DESC})?.value || 0`))
).toFixed(2));

/** Limpia el campo y escribe el monto; se espera al valor (React vuelve a pintar el input). */
const escribirMonto = async (i, v) => {
  for (let intento = 0; intento < 5; intento++) {
    await clickCenter(SEL_MONTO(i)).catch(() => {});
    if (await evalx(`document.activeElement === (${SEL_MONTO(i)})`).catch(() => false)) {
      for (let k = 0; k < 2; k++) {
        await evalx(`(() => { const e = ${SEL_MONTO(i)}; e.select(); return true; })()`);
        await keyNav('Backspace', 'Backspace', 8);
      }
      await typeText(String(v));
      for (let w = 0; w < 10; w++) {
        if (Number(await evalx(`(${SEL_MONTO(i)})?.value ?? 'NaN'`)) === Number(v)) return true;
        await sleep(200);
      }
    }
    await sleep(300);
  }
  return false;
};

/** Agrega un equipo nuevo y devuelve su índice. */
const agregarEquipo = async () => {
  const n = Number(await evalx(`document.querySelectorAll('[role="dialog"] [data-device]').length`));
  const ok = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Agregar otro equipo/.test(x.innerText || ''));
    if (!b) return false;
    b.click(); return true;
  })()`);
  await sleep(1200);
  return ok ? n : -1;
};

/** Elige un modelo en el combobox del equipo `i` y espera su compatibilidad. */
const elegirModelo = async (i, label) => {
  const sel = `${dev(i)}.querySelector('input[placeholder^="Buscar el modelo del teléfono"]')`;
  await clickCenter(sel);
  await waitFor(`document.querySelector('[data-model-option]') !== null`, 10000);
  let hay = await evalx(`[...document.querySelectorAll('[data-model-option]')].some(b => b.getAttribute('data-model-option') === ${JSON.stringify(label)})`);
  if (!hay) {
    for (let k = 0; k < 5; k++) {
      await clickCenter(sel).catch(() => {});
      if (await evalx(`document.activeElement === (${sel})`).catch(() => false)) {
        await evalx(`(() => { const e = ${sel}; e.select(); return true; })()`);
        await keyNav('Backspace', 'Backspace', 8);
        await typeText(label);
        await sleep(1200);
        break;
      }
    }
    hay = await evalx(`[...document.querySelectorAll('[data-model-option]')].some(b => b.getAttribute('data-model-option') === ${JSON.stringify(label)})`);
    if (!hay) {
      await evalx(`(() => { const b = document.querySelector('[data-model-all]'); if (b) b.click(); return !!b; })()`);
      await sleep(1200);
    }
  }
  const ok = await evalx(`(() => {
    const b = [...document.querySelectorAll('[data-model-option]')].find(x => x.getAttribute('data-model-option') === ${JSON.stringify(label)});
    if (!b) return false;
    b.click(); return true;
  })()`);
  if (!ok) return false;
  return await waitFor(`(${dev(i)}.querySelector('[data-screen-options]')) !== null`, 15000);
};

/** Un toque en un botón del equipo `i` por su texto exacto. */
const clickBoton = async (i, texto) => {
  const ok = await evalx(`(() => {
    const b = [...${dev(i)}.querySelectorAll('button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(texto)});
    if (!b) return false;
    b.click(); return true;
  })()`);
  await sleep(1300);
  return ok;
};

// ── 4) la lista de pantallas con el precio que se va a tomar ───────────────────────────────────
const eligio = await elegirModelo(0, F1.model);
check('F67: al elegir el modelo aparece la lista de pantallas compatibles', eligio, `«${F1.model}»`);
if (!eligio) { console.error('Sin lista de pantallas no se puede seguir.'); process.exit(2); }
await sleep(1500);

const filas0 = JSON.parse(String(await leerFilas(0) ?? '[]'));
check('F67: la lista trae las pantallas compatibles del modelo (contra el backend)',
  filas0.length === F1.pantallas.length, `lista=${filas0.length} · backend=${F1.pantallas.length}`);
const malPrecio = filas0.filter(f => {
  const enBase = producto(f.id);
  const esperado = precioDeFila(enBase, true);   // el método por defecto del alta es efectivo
  return Number(f.precio) !== Number(esperado);
});
check('F67: cada precio de la lista es el de ESA ficha en la BASE (no el de otra)',
  malPrecio.length === 0 && filas0.some(f => f.precio != null),
  malPrecio.length ? JSON.stringify(malPrecio) : `${filas0.length} filas · ${JSON.stringify(filas0.map(f => f.precio))}`);
const filaContado = filas0.find(f => f.id === barata.id);
check('F67: en efectivo la fila muestra el precio CONTADO (con la lista al lado)',
  filaContado != null && Number(filaContado.precio) === Number(contadoFake)
  && String(filaContado.texto).includes(`lista $${Number(barata.price_sale).toFixed(2)}`),
  filaContado ? `fila=«${filaContado.texto}»` : 'no está en la lista');

// ── 5) nada se inventa si no hay de dónde tomarlo ─────────────────────────────────────────────
{
  const idAuto = await leerElegida(0);
  const montoAuto = await leerMonto(0);
  const fuente = await leerFuente(0);
  const pAuto = idAuto != null ? producto(idAuto) : null;
  const esperadoAuto = pAuto ? montoDeFicha({ price_sale: pAuto.price_sale, price_usd: pAuto.price_usd }, true) : null;
  if (esperadoAuto != null) {
    check('F67: si el modelo ya trae una pantalla elegida con precio, el monto es ESE precio',
      montoAuto === esperadoAuto && fuente === 'pantalla', `monto=${montoAuto} · ficha ${idAuto}=${esperadoAuto} · fuente=${fuente}`);
  } else {
    check('F67: sin una oferta que tomar, el monto NO se inventa', montoAuto === 0, `monto=${montoAuto} · elegida=${idAuto}`);
  }
  // El chip del modelo, si está, tiene que ser el precio CORRECTO del grupo (y si el grupo no tiene un
  // precio único, no puede haber chip): antes esta comparación se hacía con el grupo ya contaminado por
  // el fixture y el `||` la volvía vacua.
  const chip = await leerChipModelo(0);
  check('F67: el precio del modelo se ofrece solo si el grupo tiene UN precio, y es ese número',
    chip == null ? grupoF1 == null : Number(chip) === Number(grupoF1),
    `botón=${chip} · grupo=${grupoF1}`);
}

// ── 6) ELEGIR UNA PANTALLA TOMA SU PRECIO (y la cuenta del efectivo) ──────────────────────────
{
  await clickPantalla(0, barata.id);
  const monto = await leerMonto(0);
  const desc = await leerDesc(0);
  const fuente = await leerFuente(0);
  const rotulo = await evalx(`(${dev(0)}.querySelector('[data-precio-rotulo]'))?.innerText?.replace(/\\s+/g,' ').trim() ?? null`);
  check('F67: elegir la pantalla con precio contado escribe la LISTA en el monto',
    monto === Number(barata.price_sale), `monto=${monto} · lista=${barata.price_sale}`);
  check('F67: el descuento queda en lista − contado (Total = el precio contado, no 2·contado − lista)',
    Number(desc.toFixed(2)) === Number((barata.price_sale - contadoFake).toFixed(2)) && await total(0) === Number(contadoFake),
    `monto=${monto} · desc=${desc} · total=${await total(0)} · contado=${contadoFake}`);
  check('F67: el formulario dice que el precio es el de esa pantalla',
    fuente === 'pantalla' && !!rotulo && String(rotulo).includes(Number(barata.price_sale).toFixed(2)),
    `fuente=${fuente} · rótulo=«${rotulo}»`);

  if (otraF1) {
    await clickPantalla(0, otraF1.id);
    check('F67: cambiar de pantalla cambia el monto al precio de la NUEVA ficha',
      (await leerMonto(0)) === montoDeFicha(otraF1, true) && (await leerElegida(0)) === otraF1.id,
      `monto=${await leerMonto(0)} · esperado=${montoDeFicha(otraF1, true)} · elegida=${await leerElegida(0)}`);
    check('F67: y sin precio contado, el descuento vuelve a 0 (no arrastra el de la ficha anterior)',
      (await leerDesc(0)) === 0, `desc=${await leerDesc(0)}`);
  }
}

// ── 7) LO QUE ESCRIBIÓ EL OPERARIO NO SE PISA (ni el monto ni el descuento) ───────────────────
{
  const escribio = await escribirMonto(0, 99);
  check('F67: se escribe un monto a mano (99)', escribio, `campo=${await leerMonto(0)}`);
  await clickPantalla(0, barata.id);
  check('F67: cambiar de pantalla NO pisa el monto escrito a mano', (await leerMonto(0)) === 99, `monto=${await leerMonto(0)}`);
  // La revisión adversarial encontró acá el bloqueante: se aplicaba el descuento del catálogo SOBRE el
  // precio que escribió el operario (99 − 3 = 96). El descuento calculado viaja con el monto sugerido.
  check('F67: y NO le rebaja el descuento del catálogo a un precio que escribió él (Total = 99)',
    (await leerDesc(0)) === 0 && await total(0) === 99,
    `monto=${await leerMonto(0)} · desc=${await leerDesc(0)} · total=${await total(0)}`);

  const chip = await leerChipPantalla(0);
  check('F67: aparece «Usar precio de la pantalla» con el precio de la ficha elegida',
    chip != null && Number(chip) === Number(barata.price_sale), `botón=${chip} · ficha ${barata.id} lista=${barata.price_sale}`);
  await clickChip(0, '[data-usar-precio-pantalla]');
  check('F67: un clic escribe el precio de la pantalla y lo declara como tal',
    (await leerMonto(0)) === Number(barata.price_sale) && (await leerFuente(0)) === 'pantalla',
    `monto=${await leerMonto(0)} · fuente=${await leerFuente(0)}`);
  check('F67: y con ese clic el descuento del efectivo se aplica (Total = contado)',
    await total(0) === Number(contadoFake), `total=${await total(0)} · contado=${contadoFake}`);
}

// ── 8) TECLEAR EL MONTO con un descuento CALCULADO encima: el descuento se va ─────────────────
// OJO con la diferencia (la marcó la revisión adversarial): el descuento que puso la REGLA (nadie lo
// tocó) se va cuando el operario teclea su monto — no se le rebaja nada a un precio que él escribió.
// El que se puso con el BOTÓN es una decisión suya y se conserva (él pidió esa rebaja). Acá se prueba
// el caso de la REGLA: equipo nuevo, se elige la ficha de contado y NO se toca nada.
{
  const idx = await agregarEquipo();
  const okModelo = await elegirModelo(idx, F1.model);
  await sleep(1500);
  await clickPantalla(idx, barata.id);
  check('F67: la ficha de contado dejó puestos monto y descuento SIN que nadie los tocara',
    okModelo && (await leerMonto(idx)) === Number(barata.price_sale) && (await leerDesc(idx)) > 0,
    `monto=${await leerMonto(idx)} · desc=${await leerDesc(idx)}`);
  await escribirMonto(idx, 30);
  check('F67: teclear el monto limpia el descuento CALCULADO (el Total es lo que él escribió)',
    (await leerDesc(idx)) === 0 && await total(idx) === 30,
    `monto=${await leerMonto(idx)} · desc=${await leerDesc(idx)} · total=${await total(idx)}`);
}

// ── 9) UNA FICHA SIN PRECIO NO INVENTA NADA ───────────────────────────────────────────────────
{
  const idx = await agregarEquipo();
  check('F67: se puede agregar un equipo para probar el caso de la ficha sin precio', idx >= 0, `equipo=${idx}`);
  const okModelo = await elegirModelo(idx, Fzero.model);
  await sleep(1500);
  const sinPrecio = Fzero.sinPrecio.find(p => Number(p.price_usd) === 0) ?? Fzero.sinPrecio[0];
  await escribirMonto(idx, 77);
  await clickPantalla(idx, sinPrecio.id);
  const aviso = await evalx(`(${dev(idx)}.querySelector('[data-pantalla-sin-precio]'))?.innerText?.replace(/\\s+/g,' ').trim() ?? null`);
  check('F67: una pantalla SIN precio cargado se avisa con todas las letras',
    okModelo && !!aviso && /no tiene precio cargado/i.test(String(aviso)), String(aviso));
  check('F67: y no toca el monto (no lo deja en 0 ni lo vacía)', (await leerMonto(idx)) === 77, `monto=${await leerMonto(idx)}`);
}

// ── 10) CON OTRO TRABAJO LA PANTALLA NO MUEVE EL MONTO (con el monto SIN TOCAR) ───────────────
// Esta es la comprobación del criterio 6 y tiene que PODER FALLAR: el monto arranca intacto (0) y se
// elige una ficha CON precio que NO es el precio del modelo, así que si el gate `isScreenJob` se
// rompiera, el monto pasaría a ser el de la ficha y el chequeo fallaría.
{
  const idx = await agregarEquipo();
  const destildado = idx >= 0 && await clickBoton(idx, 'Cambio pantalla');
  await elegirModelo(idx, F1.model);
  await sleep(1500);
  const montoSinTrabajo = await leerMonto(idx);
  // Con otro trabajo la lista queda plegada detrás de «Compatibilidad de pantalla: N repuestos — ver»
  const hayBoton = await evalx(`!!${dev(idx)}.querySelector('[data-ver-compat]')`);
  if (hayBoton) await evalx(`(() => { ${dev(idx)}.querySelector('[data-ver-compat]').click(); return true; })()`);
  await waitFor(`(${dev(idx)}.querySelector('[data-screen-options]')) !== null`, 8000);
  await sleep(600);
  const objetivo = otraF1 && montoDeFicha(otraF1, true) !== grupoF1 ? otraF1 : F1.conPrecio.find(p => montoDeFicha(p, true) !== grupoF1);
  check('F67: con otro trabajo hay una ficha con precio distinto del de grupo para la prueba', !!objetivo,
    `ficha=${objetivo ? montoDeFicha(objetivo, true) : null} · grupo=${grupoF1}`);
  if (destildado && objetivo) {
    await clickPantalla(idx, objetivo.id);
    const monto = await leerMonto(idx);
    check('F67: con otro trabajo la pantalla elegida NO mueve el monto (es de referencia)',
      monto === montoSinTrabajo && monto !== montoDeFicha(objetivo, true),
      `monto=${monto} (antes ${montoSinTrabajo}) · precio de la ficha=${montoDeFicha(objetivo, true)} · fuente=${await leerFuente(idx)}`);
    check('F67: y no se ofrece tomar el precio de una pantalla que no se instala',
      (await leerChipPantalla(idx)) === null, `botón=${await leerChipPantalla(idx)}`);
  } else {
    check('F67: se pudo destildar «Cambio pantalla» en un equipo nuevo', false, `equipo=${idx}`);
  }
}

// ── 11) EL PRECIO DEL MODELO (y el cambio de modelo: el del modelo NUEVO, no el anterior) ─────
{
  const idx = await agregarEquipo();
  const ok2 = await elegirModelo(idx, F2.model);
  await sleep(1800);
  const montoF2 = await leerMonto(idx);
  check('F67: equipo nuevo, modelo con precio único → el monto se toma solo',
    ok2 && montoF2 === Number(F2.grupo), `«${F2.model}» → monto=${montoF2} · grupo=${F2.grupo}`);
  check('F67: y el formulario dice de dónde salió', (await leerFuente(idx)) === 'modelo', `fuente=${await leerFuente(idx)}`);

  const ok3 = await elegirModelo(idx, F3.model);
  await sleep(1800);
  const montoF3 = await leerMonto(idx);
  check('F67: al CAMBIAR de modelo el monto es el del modelo NUEVO (nunca el del anterior)',
    ok3 && montoF3 === Number(F3.grupo) && montoF3 !== montoF2,
    `«${F2.model}» $${F2.grupo} → «${F3.model}»: monto=${montoF3} · esperado=${F3.grupo} · fuente=${await leerFuente(idx)}`);

  // El botón «Precio del modelo» también sirve para VOLVER al del modelo después de tomar el de una ficha.
  const okPantalla = await elegirModelo(idx, F1.model);
  await sleep(1500);
  const elegida = await leerElegida(idx);
  if (okPantalla && elegida != null) {
    await clickPantalla(idx, elegida);
    const chipModelo = await leerChipModelo(idx);
    check('F67: el precio del MODELO se ofrece a un toque con su número',
      chipModelo == null ? grupoF1 == null : Number(chipModelo) === Number(grupoF1), `botón=${chipModelo} · grupo=${grupoF1}`);
    if (chipModelo != null) {
      await clickChip(idx, '[data-usar-precio-modelo]');
      check('F67: y el clic escribe el precio del modelo y lo declara como tal',
        (await leerMonto(idx)) === Number(chipModelo) && (await leerFuente(idx)) === 'modelo',
        `monto=${await leerMonto(idx)} · fuente=${await leerFuente(idx)}`);
    }
  }
}

// ── 12) salir del wizard sin guardar ─────────────────────────────────────────────────────────
await keyNav('Escape', 'Escape', 27);
await sleep(1000);
await cerrarDialogos();
check('F67: se sale del wizard sin guardar', await evalx(`document.querySelectorAll('[role="dialog"]').length === 0`) === true);
check('F67: la prueba del alta NO creó ninguna orden',
  cuenta(`SELECT COUNT(*) AS n FROM services WHERE client LIKE '%Prueba Precio Pantalla%'`) === 0);

// ── 13) LA ORDEN GUARDADA RECIBE EL PRECIO (ida y vuelta por la BASE) ────────────────────────
/** Abre una orden por su número en el formulario de edición. */
const abrirOrden = async (orderNum) => {
  const selBusqueda = `document.querySelector('input[placeholder^="Buscar cliente"]')`;
  for (let i = 0; i < 5; i++) {
    await clickCenter(selBusqueda).catch(() => {});
    if (await evalx(`document.activeElement === (${selBusqueda})`).catch(() => false)) {
      await evalx(`(() => { const e = ${selBusqueda}; e.select(); return true; })()`);
      await keyNav('Backspace', 'Backspace', 8);
      await typeText(String(orderNum));
      break;
    }
    await sleep(400);
  }
  await waitFor(`document.body.innerText.includes(${JSON.stringify(String(orderNum))})`, 12000);
  await sleep(1200);
  const abierto = await evalx(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === 'Editar');
    if (!b) return false;
    b.click(); return true;
  })()`);
  if (!abierto) return false;
  if (!await waitFor(`/Editar /.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 12000)) return false;
  for (let i = 0; i < 4; i++) {
    if (/Paso 2 de 5/.test(String(await evalx(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)))) break;
    await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim())); if (b && !b.disabled) b.click(); return !!b; })()`);
    await sleep(900);
  }
  return true;
};

let ordenPrueba = null;
{
  const marca = String(Date.now()).slice(-6);
  const dispositivo = {
    model: F1.model, fault: 'prueba de precio', service_type: 'Cambio pantalla',
    service_types: JSON.stringify(['Cambio pantalla']), amount: 0, discount_amount: 0,
    payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
    currency: 'USD', device_checklist: '', color: 'Negro', screen_product_id: null, status: 'Recibido',
  };
  const num = await invoke('add_service_order', {
    client: `Prueba Precio Orden ${marca}`, phone: '', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null, devices: [dispositivo],
  }).catch(e => { console.error('no se pudo crear la orden de prueba:', e.message); return null; });
  if (num) {
    const rows = await invoke('get_services', { search: `Prueba Precio Orden ${marca}`, status: '', startDate: '', endDate: '', dateField: 'in' });
    const fila = Array.isArray(rows) ? rows[0] : null;
    ordenPrueba = fila ? { id: fila.id, num: fila.order_num ?? num, amount: fila.amount, desc: fila.discount_amount } : null;
  }
  check('F67: se preparó una orden de prueba ($0, sin pantalla) para guardarle el precio', !!ordenPrueba,
    ordenPrueba ? `orden ${ordenPrueba.num} (id ${ordenPrueba.id})` : 'no se pudo crear');

  if (ordenPrueba) {
    const abierto = await abrirOrden(ordenPrueba.num);
    const SEL_M = `document.querySelector('[role="dialog"] input[aria-label="Monto ($) del servicio"]')`;
    const montoInicial = Number(await evalx(`(${SEL_M})?.value ?? 'NaN'`));
    check('F67: la orden de prueba abre en el formulario con su monto ($0)', abierto && montoInicial === 0, `monto=${montoInicial}`);
    const hayPantallas = await waitFor(`document.querySelector('[role="dialog"] [data-screen-options]') !== null`, 15000);
    check('F67: la edición muestra las pantallas compatibles del modelo de la orden', hayPantallas);
    if (hayPantallas) {
      await sleep(900);
      await clickCenter(`document.querySelector('[data-screen-option="${barata.id}"]')`);
      await sleep(1100);
      check('F67: en EDICIÓN cambiar de pantalla NO cambia el monto guardado',
        Number(await evalx(`(${SEL_M})?.value ?? 'NaN'`)) === 0, `monto=${await evalx(`(${SEL_M})?.value`)}`);
      const chip = await evalx(`(() => { const b = document.querySelector('[data-usar-precio-pantalla]'); return b ? Number(b.getAttribute('data-usar-precio-pantalla')) : null; })()`);
      check('F67: el botón ofrece el precio de la ficha elegida', Number(chip) === Number(barata.price_sale), `botón=${chip} · ficha ${barata.id}=${barata.price_sale}`);
      await clickCenter(`document.querySelector('[data-usar-precio-pantalla]')`);
      await sleep(900);
      const montoForm = Number(await evalx(`(${SEL_M})?.value ?? 'NaN'`));
      check('F67: el clic escribe el precio y su descuento de contado en el formulario',
        montoForm === Number(barata.price_sale) && await totalEdit() === Number(contadoFake),
        `monto=${montoForm} · total=${await totalEdit()} · contado=${contadoFake}`);

      // GUARDAR: el número tiene que llegar a la ORDEN (amount = lista − descuento). En EDICIÓN el
      // botón vive en el ÚLTIMO paso (5 de 5) del wizard: hay que llegar (F33: «el botón Guardar solo
      // se dibuja en el último paso»).
      for (let i = 0; i < 5; i++) {
        const hayGuardar = await evalx(`[...document.querySelectorAll('[role="dialog"] button')].some(x => /Actualizar (Servicio|e imprimir)/i.test(x.innerText || ''))`);
        if (hayGuardar) break;
        await evalx(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim())); if (b && !b.disabled) b.click(); return !!b; })()`);
        await sleep(1100);
      }
      // F77: el último paso trae el check «Imprimir la orden ahora» PREMARCADO (y el botón pasa a
      // «Actualizar e imprimir»). Esta prueba es del PRECIO, no de la impresión: se destilda para que
      // no se abra el comprobante encima (y de paso se comprueba que destildar devuelve el rótulo).
      await evalx(`(() => {
        const c = document.querySelector('[data-field="imprimir-al-guardar"]');
        if (c && c.checked) c.click();
        return c ? c.checked : null;
      })()`);
      await sleep(500);
      const pasoFinal = String(await evalx(`(document.querySelector('[role="dialog"]')?.innerText ?? '').split('\\n').find(l => /Paso \\d+ de \\d+/.test(l)) ?? null`));
      const guardado = await evalx(`(() => {
        const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /Actualizar (Servicio|e imprimir)/i.test(x.innerText || ''));
        if (!b || b.disabled) return false;
        b.click(); return true;
      })()`);
      await sleep(2800);
      await cerrarDialogos();
      const enBase = uno('SELECT COALESCE(amount,0) AS amount, COALESCE(discount_amount,0) AS d, COALESCE(screen_product_id,0) AS sp FROM services WHERE id=?1', ordenPrueba.id);
      // En la base, `services.amount` es el TOTAL que paga el cliente (lista − descuento) y
      // `discount_amount` es el descuento: con lista 8.75 y contado 5.75 → amount 5.75, descuento 3.
      check('F67: GUARDAR deja en la orden el TOTAL del precio de la pantalla (amount = el contado)',
        guardado && Number(enBase.amount) === Number(contadoFake),
        `guardado=${guardado} · ${pasoFinal} · base amount=${enBase.amount} · esperado=${contadoFake}`);
      check('F67: y el descuento del efectivo queda guardado como descuento de la orden',
        Number(enBase.d) === Number((barata.price_sale - contadoFake).toFixed(2)),
        `base discount_amount=${enBase.d} · esperado=${(barata.price_sale - contadoFake).toFixed(2)} (lista ${barata.price_sale} − contado ${contadoFake})`);
      check('F67: y la orden guarda la PANTALLA exacta (el inventario baja de esa ficha)',
        Number(enBase.sp) === Number(barata.id), `base screen_product_id=${enBase.sp} · ficha=${barata.id}`);
    }
    // LIMPIEZA: la orden de prueba se borra (y no queda nada suelto)
    await invoke('delete_service', { id: ordenPrueba.id }).catch(e => check('F67: borrar la orden de prueba', false, e.message));
    const restos = await invoke('get_services', { search: `Prueba Precio Orden ${marca}`, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
    check('F67: la orden de prueba quedó borrada (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);
    ordenPrueba = null;
  }
}

// ── 14) EN EDICIÓN una orden REAL no cambia de monto sola ────────────────────────────────────
{
  const candidatas = filas(`SELECT id, order_num, model, amount, discount_amount, screen_product_id
                             FROM services WHERE model <> '' AND model IS NOT NULL ORDER BY id DESC LIMIT 60`);
  let orden = null;
  for (const s of candidatas) {
    const items = await compatiblesDe(String(s.model));
    const pantallas = items.filter(x => x.category_id === 1);
    const actual = Number(s.amount) + Number(s.discount_amount ?? 0);
    const conOtra = pantallas.filter(p => montoDeFicha(p, true) != null && Number(montoDeFicha(p, true)) !== actual);
    if (pantallas.length > 0 && conOtra.length > 0) { orden = { ...s, actual, conOtra }; break; }
  }
  check('F67: hay una orden real para probar la edición (con otro precio disponible)', !!orden,
    orden ? `${orden.order_num} · monto lista ${orden.actual} · otra pantalla $${montoDeFicha(orden.conOtra[0], true)}` : 'ninguna en esta copia');

  if (orden) {
    const abierto = await abrirOrden(orden.order_num);
    const SEL_M = `document.querySelector('[role="dialog"] input[aria-label="Monto ($) del servicio"]')`;
    const montoForm = Number(await evalx(`(${SEL_M})?.value ?? 'NaN'`));
    check('F67: la edición abre con el monto de la ORDEN (amount + descuento)',
      abierto && montoForm === orden.actual, `formulario=${montoForm} · base=${orden.actual}`);
    await keyNav('Escape', 'Escape', 27);
    await sleep(1200);
    await cerrarDialogos();
    const despuesOrden = uno('SELECT COALESCE(amount,0) AS amount, COALESCE(discount_amount,0) AS d, COALESCE(screen_product_id,0) AS sp FROM services WHERE id=?1', orden.id);
    check('F67: al salir sin guardar, la orden real quedó EXACTAMENTE igual',
      Number(despuesOrden.amount) === Number(orden.amount) && Number(despuesOrden.d) === Number(orden.discount_amount ?? 0)
      && Number(despuesOrden.sp) === Number(orden.screen_product_id ?? 0),
      `amount=${despuesOrden.amount}/${orden.amount} · desc=${despuesOrden.d}/${orden.discount_amount} · pantalla=${despuesOrden.sp}/${orden.screen_product_id}`);
  }
}

// ── 15) la base quedó como estaba (y el fixture, devuelto) ───────────────────────────────────
devolverFixture();
dbW.close();
{
  const despues = {
    ordenes: cuenta('SELECT COUNT(*) AS n FROM services'),
    plata: uno('SELECT COALESCE(SUM(amount),0) AS s, COALESCE(SUM(discount_amount),0) AS d FROM services'),
    pantallas: cuenta('SELECT COUNT(*) AS n FROM products WHERE category_id=1'),
    stockPantallas: Number(uno('SELECT COALESCE(SUM(stock),0) AS s FROM products WHERE category_id=1').s ?? 0),
    plataCatalogo: Number(uno('SELECT COALESCE(SUM(COALESCE(price_sale,0) + COALESCE(price_usd,0) * 1000),0) AS s FROM products').s ?? 0),
  };
  check('F67: la prueba no dejó órdenes nuevas (la de prueba se borró) ni movió un dólar',
    despues.ordenes === antes.ordenes
    && Number(despues.plata.s) === Number(antes.plata.s) && Number(despues.plata.d) === Number(antes.plata.d),
    `órdenes ${antes.ordenes}→${despues.ordenes} · montos ${antes.plata.s}→${despues.plata.s} · descuentos ${antes.plata.d}→${despues.plata.d}`);
  check('F67: el catálogo de pantallas, su stock y sus precios quedaron como estaban (fixture devuelto)',
    despues.pantallas === antes.pantallas && despues.stockPantallas === antes.stockPantallas
    && despues.plataCatalogo === antes.plataCatalogo,
    `fichas ${antes.pantallas}→${despues.pantallas} · stock ${antes.stockPantallas}→${despues.stockPantallas} · precios ${antes.plataCatalogo}→${despues.plataCatalogo}`);
  check('F67: la base quedó sana', uno('PRAGMA quick_check').quick_check === 'ok');
}

db.close();
const failed = out.filter(r => !r.ok);
console.log(`\nverify_precio_pantalla: ${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
