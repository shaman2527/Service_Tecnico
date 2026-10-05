// VERIFICACIÓN EN VIVO (CDP) de F93 — LA RED DE COMPATIBILIDAD SE SINCRONIZA Y LAS VARIANTES NO PARTEN
// EL TELÉFONO.
//
// Pedido del dueño (2026-10-05), textual: «si yo selecciono en Producto **Infinix Hot 10 Play** los
// modelos compatibles son Infinix Hot 10 Play; Infinix Hot 11 Play. En módulo-fichas debe verse también
// los dos. Pero cuando en Producto le quito Infinix Hot 11 Play quedando solo Hot 10 Play, **los cambios
// no surten efecto en módulo-fichas sobre Infinix Hot 10 Play sino en el otro que se retiró** (Hot 11
// Play). Es importante que **se sincronice en toda la red completa**, es el deber ser. Punto importante:
// **las variantes permitir que entren en la compatibilidad**.»
//
// Qué comprueba (sobre una COPIA; devuelve el estado al terminar):
//   1. El caso del dueño: quitar un teléfono de una pantalla **cambia las DOS fichas** (la del que queda
//      y la del que se retiró), no una sola.
//   2. Al volver a agregarlo, la red se rearma en las dos direcciones.
//   3. Un producto que sirve a OTROS teléfonos no se toca.
//   4. Las variantes: las pantallas cuya compatibilidad nombra al modelo con la variante pegada
//      («Infinix Gt 20 Pro INCELL») cuentan para el teléfono — UNA ficha por teléfono, sus repuestos
//      dentro, y el desplegable ESTRICTO del servicio las ofrece (antes: 0 pantallas).
//
// Uso:  app abierta con CDP (REGISTRO_CDP_PORT si es una segunda instancia) y REGISTRO_DB=<copia>
//       node tools/verify_f93_red_compat.mjs

import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const inv = (cmd, args) => evalx(`(async () => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const j = (x) => JSON.stringify(x);

const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) { console.error('ABORTADO: falta REGISTRO_DB apuntando a la copia.'); process.exit(2); }
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => { try { return db.prepare(sql).all(...p)[0] ?? {}; } catch { return {}; } };

// ── 0) sesión del dueño (update_product la exige) ─────────────────────────────────────────────
await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(3000);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(3000);
}
await keyNav('Escape', 'Escape', 27).catch(() => {});
await sleep(500);
const usuario = await evalx(`(async () => (await window.__TAURI_INTERNALS__.invoke('get_current_user'))?.name ?? null)()`);
console.log(`· sesión: ${usuario} · copia: ${dbPath}`);

const producto = async (id) => (await inv('get_product', { id })) ?? null;
const fichas = async (telefono) => {
  const ps = await inv('get_phones', { brand: null, search: telefono, onlyWithProducts: false, onlyStock: false, onlyReview: false, sort: 'nombre', dir: 'asc', limit: 12, offset: 0 });
  const fila = (ps.items ?? []).find(x => new RegExp(`^${telefono}$`, 'i').test(String(x.name)));
  if (!fila) return { telefono, error: 'sin ficha' };
  const det = await inv('get_phone_detail', { phoneId: fila.id });
  const repuestos = [];
  for (const b of (det?.blocks ?? [])) for (const it of (b.items ?? [])) repuestos.push(`${it.name} (#${it.id})`);
  return { telefono, phoneId: fila.id, products: fila.products, repuestos };
};
const ids = (f) => (f.repuestos ?? []).map(x => Number((x.match(/#(\d+)/) ?? [])[1])).sort((a, b) => a - b);

// ── 1) LOS DOS PRODUCTOS DE LA RED (el caso del dueño, buscado en la copia) ────────────────────
const todos = await inv('get_products', { search: 'Infinix Hot 1', categoryId: 1 }) ?? [];
const A = todos.find(p => /^Infinix Hot 10 Play$/i.test(String(p.name)));
const B = todos.find(p => /^Infinix Hot 11 Play$/i.test(String(p.name)));
if (!A || !B) { console.log(`ABORTADO: no encontré las dos pantallas del caso (A=${j(A?.name)} B=${j(B?.name)}).`); process.exit(2); }
const listaA0 = A.compatibility, listaB0 = B.compatibility;
const otro = (await inv('get_products', { search: 'Infinix Hot 30i', categoryId: 1 }) ?? []).find(p => /^Infinix Hot 30i$/i.test(String(p.name)));
console.log(`· red de prueba: #${A.id} «${A.name}» ${listaA0} · #${B.id} «${B.name}» ${listaB0}`);
console.log(`· control (no se toca): #${otro?.id} «${otro?.name}» ${otro?.compatibility}`);

const ficha10antes = await fichas('Hot 10 Play');
const ficha11antes = await fichas('Hot 11 Play');
console.log(`\n── ANTES ──\n   Hot 10 Play: ${j(ids(ficha10antes))} · Hot 11 Play: ${j(ids(ficha11antes))}`);

// ── 2) QUITAR «Infinix Hot 11 Play» de la pantalla del Hot 10 Play ────────────────────────────
const r1 = await inv('update_product', {
  id: A.id, name: A.name, categoryId: A.category_id, brand: A.brand, model: A.model, variant: A.variant ?? '',
  compatibility: j(['Infinix Hot 10 Play']), priceCost: A.price_cost, priceSale: A.price_sale,
  stock: A.stock, minStock: A.min_stock, priceUsd: A.price_usd,
}).catch(e => ({ error: String(e) }));
await sleep(900);
const aDespues = await producto(A.id);
const bDespues = await producto(B.id);
const ficha10 = await fichas('Hot 10 Play');
const ficha11 = await fichas('Hot 11 Play');
console.log(`\n── quité «Infinix Hot 11 Play» de #${A.id} ──`);
console.log(`   el backend informó: ${j(Array.isArray(r1) ? r1.map(c => `${c.name}: ${c.antes} → ${c.despues}`) : r1)}`);
console.log(`   #${A.id}: ${aDespues?.compatibility} · #${B.id}: ${bDespues?.compatibility}`);
console.log(`   Hot 10 Play: ${j(ids(ficha10))} · Hot 11 Play: ${j(ids(ficha11))}`);
check('AC-1: quitar un teléfono cambia la ficha del que QUEDA (el reclamo del dueño)',
  ids(ficha10).length === 1 && ids(ficha10)[0] === A.id,
  `ficha del Hot 10 Play: ${j(ids(ficha10))} (antes ${j(ids(ficha10antes))})`);
check('AC-2: y también la del que se RETIRÓ (la red se parte en las dos direcciones)',
  ids(ficha11).length === 1 && ids(ficha11)[0] === B.id,
  `ficha del Hot 11 Play: ${j(ids(ficha11))} (antes ${j(ids(ficha11antes))})`);
check('AC-3: el producto hermano quedó solo con su propio teléfono (la red se sincronizó)',
  JSON.parse(bDespues?.compatibility ?? '[]').length === 1
  && /Hot 11 Play/i.test(JSON.parse(bDespues?.compatibility ?? '[]')[0] ?? ''),
  `#${B.id}: ${bDespues?.compatibility}`);
check('AC-4: la respuesta del backend dice QUÉ ficha hermana se ajustó (para poder avisarlo)',
  Array.isArray(r1) && r1.length === 1 && r1[0].id === B.id && r1[0].antes !== r1[0].despues,
  j(Array.isArray(r1) ? r1 : r1));
if (otro) {
  const otroDespues = await producto(otro.id);
  check('AC-5: un producto de OTRA red no se toca', otroDespues?.compatibility === otro.compatibility,
    `${otroDespues?.compatibility}`);
}

// ── 3) VOLVER A AGREGARLO: la red se rearma ──────────────────────────────────────────────────
const r2 = await inv('update_product', {
  id: A.id, name: A.name, categoryId: A.category_id, brand: A.brand, model: A.model, variant: A.variant ?? '',
  compatibility: listaA0, priceCost: A.price_cost, priceSale: A.price_sale,
  stock: A.stock, minStock: A.min_stock, priceUsd: A.price_usd,
}).catch(e => ({ error: String(e) }));
await sleep(900);
const aVuelta = await producto(A.id);
const bVuelta = await producto(B.id);
const ficha10v = await fichas('Hot 10 Play');
const ficha11v = await fichas('Hot 11 Play');
console.log(`\n── volví a agregarlo ──\n   #${A.id}: ${aVuelta?.compatibility} · #${B.id}: ${bVuelta?.compatibility}`);
check('AC-6: al agregarlo de nuevo, las DOS fichas vuelven a tener las dos pantallas',
  ids(ficha10v).length === 2 && ids(ficha11v).length === 2,
  `Hot 10 Play: ${j(ids(ficha10v))} · Hot 11 Play: ${j(ids(ficha11v))}`);

// El estado queda EXACTAMENTE como estaba (la copia se devuelve)
console.log('\n── el estado quedó restaurado ──');
check('AC-7: la compatibilidad de los dos productos quedó como al empezar (sin residuos)',
  aVuelta?.compatibility === listaA0 && bVuelta?.compatibility === listaB0,
  `A: ${aVuelta?.compatibility === listaA0} · B: ${bVuelta?.compatibility === listaB0}`);

// ── 4) LAS VARIANTES: el teléfono es UNO, con sus repuestos ───────────────────────────────────
const filasVariante = uno(`SELECT COUNT(*) n FROM phones WHERE name LIKE '%INCELL%' OR name LIKE '%OLED%' OR name LIKE '%ORIGINAL%' OR name LIKE '%MARCO%'`).n;
const gt = uno("SELECT id, name, key, aliases FROM phones WHERE key = 'infinix|gt 20 pro'");
const fichaGt = await fichas('Gt 20 Pro');
const gtIncell = (await inv('get_products', { search: 'Gt 20 Pro', categoryId: 1 }) ?? []).filter(p => /Gt 20 Pro/i.test(String(p.name)));
const exactas = await inv('find_compatible_screens_exactas', { model: 'Gt 20 Pro', limit: 20 }) ?? [];
const buscado = await inv('get_phone_models_in_use', { search: 'Gt 20 Pro INCELL', limit: 8, inUseOnly: false }) ?? [];
console.log(`\n── variantes ──\n   teléfonos del padrón con la variante en el nombre: ${filasVariante}`);
console.log(`   «Gt 20 Pro»: ${j(gt)} → ficha ${j(ids(fichaGt))}`);
console.log(`   pantallas del producto: ${j(gtIncell.map(p => `#${p.id} ${p.name} [${p.variant}]`))}`);
console.log(`   desplegable estricto del servicio: ${exactas.length} · buscando «Gt 20 Pro INCELL» el padrón devuelve ${j((buscado ?? []).map(x => x.label))}`);
check('AC-8: NINGÚN teléfono del padrón lleva la variante en el nombre (es del repuesto, no del teléfono)',
  Number(filasVariante) === 0, `${filasVariante} filas`);
check('AC-9: las pantallas de ese teléfono están en SU ficha (una sola, con sus variantes adentro)',
  !!gt.id && ids(fichaGt).length >= 2 && gtIncell.every(p => ids(fichaGt).includes(p.id)),
  `ficha ${j(ids(fichaGt))} · productos ${j(gtIncell.map(p => p.id))}`);
check('AC-10: el desplegable «Pantalla a instalar» del servicio las OFRECE (antes: 0 para estos modelos)',
  exactas.length > 0 && gtIncell.every(p => exactas.some(c => c.product.id === p.id)),
  `${exactas.length} pantallas · ${j(exactas.map(c => `#${c.product.id}`))}`);
check('AC-11: buscar el modelo COMO LO ESCRIBE EL LOCAL («Gt 20 Pro INCELL») encuentra el teléfono',
  (buscado ?? []).some(x => /^Gt 20 Pro$/i.test(String(x.label))),
  j((buscado ?? []).map(x => x.label)));

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (y devuelve el estado). Corré sobre una COPIA.');
process.exit(failed.length ? 1 : 0);
