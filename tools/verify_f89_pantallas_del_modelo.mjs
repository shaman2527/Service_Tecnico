// VERIFICACIÓN EN VIVO (CDP) de F89 — EL SERVICIO OFRECE LAS PANTALLAS DE ESE MODELO, Y DE NINGÚN OTRO.
//
// Pedido del dueño (2026-10-05), con su archivo en la mano: «cada modelo comparte la misma
// compatibilidad… tienes que reflejar eso también» + «si yo selecciono un modelo que te di, toda
// comparte una red de compatibilidades reflejado en esa compatibilidad» + «no puede darme de otro
// modelo que no es».
//
// Qué comprueba (SOLO LEE: no escribe nada):
//   1. LA RED, REFLEJADA: si una pantalla dice servir a «Infinix Hot 30i / Tecno Spark Go 2023 / …»,
//      CADA uno de esos teléfonos tiene que recibir ESA pantalla al pedir la compatibilidad.
//   2. NINGUNA DE OTRO MODELO: toda pantalla que el servicio ofrece para un modelo tiene que NOMBRARLO
//      en su compatibilidad. Antes entraban por coincidencia parcial («Google 7 Pro» para «Spark 7 Pro»).
//   3. EL CASO MEDIDO: para «Spark 7 Pro» ya no aparecen Google 7 Pro / Realme 7 Pro / Redmi Note 7.
//   4. LA PANTALLA DEL MODELO CON SU STOCK: la lista llega al desplegable del wizard (mismos datos).
//
// Uso:  app abierta con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//       node tools/verify_f89_pantallas_del_modelo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalx, clickCenter, keyNav, typeText, sleep } from './cdp_driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

// ── 0) entrar (la copia viene con PIN de pruebas 1234) ─────────────────────────────────────────
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

// ── 1) + 2) + 3) la regla, medida en el backend con el catálogo REAL ─────────────────────────────
const r = await evalx(`(async () => {
  const exactas = (m) => window.__TAURI_INTERNALS__.invoke('find_compatible_screens_exactas', { model: m, limit: 80 });
  const parecidas = (m) => window.__TAURI_INTERNALS__.invoke('find_compatible_products', { model: m, categoryId: 1, limit: 80 });
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const MARCAS = ['infinix','tecno','samsung','xiaomi','redmi','motorola','huawei','honor','apple','oppo','realme','vivo','zte','alcatel','tcl','blu','itel','umidigi','google','nokia','lifephone','krip','yezz','blackview','hyundai','lg'];
  const modeloPelado = (s) => { const n = norm(s); for (const b of MARCAS) if (n.startsWith(b)) return n.slice(b.length); return n; };
  /** ¿la pantalla NOMBRA al modelo? Se aceptan sus ALIAS del padrón (es lo mismo que hace el backend:
   *  «A30» es alias de «Samsung A30 A305» y «Note 11» de «Xiaomi Redmi Note 11»). */
  const nombra = (compat, modelo, alias) => {
    let lista = [];
    try { lista = JSON.parse(compat ?? '[]'); } catch { lista = []; }
    const objetivos = new Set([modeloPelado(modelo), ...(alias ?? []).map(modeloPelado)]);
    return lista.some(x => objetivos.has(modeloPelado(x)));
  };

  // (1) LA RED: una pantalla con varios teléfonos en su lista → cada uno la recibe
  const todas = await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: 1 });
  const conLista = todas
    .map(p => { let l = []; try { l = JSON.parse(p.compatibility ?? '[]'); } catch { l = []; } return { p, l }; })
    .filter(x => x.l.length >= 4)
    .sort((a, b) => b.l.length - a.l.length);
  const elegida = conLista[0] ?? null;
  const red = [];
  if (elegida) {
    for (const telefono of elegida.l) {
      const ofrecidas = await exactas(telefono);
      red.push({ telefono, laTiene: ofrecidas.some(c => c.product.id === elegida.p.id), cuantas: ofrecidas.length });
    }
  }

  // (1b) LA MISMA RED PARA CUALQUIER MODELO QUE TOQUES. La red son las pantallas que nombran al
  // modelo elegido; los teléfonos que TODAS esas pantallas nombran (la intersección) tienen que
  // devolver EXACTAMENTE ese mismo conjunto. (Un teléfono puede aparecer en UNA lista y no en las
  // otras —el archivo del dueño tiene un caso así con «Infinix Hot 40»—: eso es su dato, y ahí la
  // oferta correcta es la que su lista dice, no la de la mayoría.)
  const grupoPantallas = elegida ? await exactas(elegida.l[0]) : [];
  const listasDelGrupo = grupoPantallas.map(c => {
    let l = []; try { l = JSON.parse(c.product?.compatibility ?? '[]'); } catch { l = []; }
    return l.map(modeloPelado);
  });
  const compartidos = elegida
    ? elegida.l.filter(t => listasDelGrupo.length > 0 && listasDelGrupo.every(l => l.includes(modeloPelado(t))))
    : [];
  const conjuntos = [];
  for (const telefono of compartidos) {
    const ids = (await exactas(telefono)).map(c => c.product.id).sort((a, b) => a - b);
    conjuntos.push({ telefono, ids: ids.join(',') });
  }
  const redUnica = conjuntos.length > 1 && new Set(conjuntos.map(c => c.ids)).size === 1;

  // (2) NINGUNA DE OTRO MODELO: la consulta ESTRICTA no puede traer ninguna pantalla que la consulta
  // CON PARECIDOS marca como «prefijo» o «parcial» — o sea, ninguna que solo entre por parecerse.
  // (Se mide con la MISMA clasificación del backend, match_quality: antes acá había una segunda
  // implementación de la regla en JavaScript, que es justo lo que el proyecto prohíbe.)
  const ajenas = [];
  for (const modelo of ['Spark 7 Pro', 'Camon 17', 'Hot 30i', 'A30', 'Smart 8', 'Note 11', 'Pop 7']) {
    const exactasIds = new Set((await exactas(modelo)).map(c => c.product?.id));
    const conParecidos = await parecidas(modelo);
    for (const c of conParecidos) {
      if (c.match_quality !== 'exacta' && exactasIds.has(c.product?.id)) {
        ajenas.push({ modelo, pantalla: c.product?.name, calidad: c.match_quality });
      }
    }
  }

  // (3) el caso medido: la consulta CON parecidos traía la de otro modelo y la ESTRICTA no
  const sparkExactas = (await exactas('Spark 7 Pro')).map(c => c.product?.name ?? '');
  const sparkParecidas = (await parecidas('Spark 7 Pro')).map(c => c.product?.name ?? '');

  return {
    elegida: elegida ? { id: elegida.p.id, name: elegida.p.name, lista: elegida.l } : null,
    red, conjuntos, redUnica, ajenas, sparkExactas, sparkParecidas,
    conjuntoEjemplo: conjuntos[0]?.ids ?? '',
  };
})()`);

console.log('── la RED de compatibilidades, reflejada ──');
if (r?.elegida) {
  console.log(`   pantalla: ${r.elegida.name}`);
  console.log(`   su lista: ${r.elegida.lista.join(' / ')}`);
  for (const x of r.red) console.log(`   ${x.laTiene ? '✓' : '✗'} ${x.telefono} → ${x.cuantas} pantalla(s), ${x.laTiene ? 'incluye LA SUYA' : 'NO la incluye'}`);
}
check('AC-1: cada teléfono de la lista recibe ESA pantalla (la red compartida se refleja)',
  !!r?.red?.length && r.red.every(x => x.laTiene),
  `${r?.red?.filter(x => x.laTiene).length}/${r?.red?.length} teléfonos de la lista`);

console.log('\n── ¿la MISMA red para cualquier modelo que toques? ──');
console.log(`   (teléfonos que TODAS las pantallas de la red nombran: ${r?.conjuntos?.length})`);
for (const c of r?.conjuntos ?? []) console.log(`   ${c.telefono} → pantallas [${c.ids}]`);
check('AC-1b: tocar CUALQUIER modelo de esa red devuelve EL MISMO conjunto de pantallas',
  r?.redUnica === true,
  `${new Set((r?.conjuntos ?? []).map(c => c.ids)).size} conjunto(s) distinto(s) entre ${r?.conjuntos?.length} teléfonos`);

console.log('\n── ¿alguna ofrecida que solo entre por PARECERSE? ──');
for (const a of r?.ajenas ?? []) console.log(`   ✗ para «${a.modelo}» ofreció ${a.pantalla} [${a.calidad}]`);
check('AC-2: la lista estricta no trae NINGUNA pantalla que solo entre por prefijo/parcial (otro teléfono)',
  (r?.ajenas ?? []).length === 0, `${r?.ajenas?.length ?? '?'} ajenas`);

console.log('\n── el caso medido: «Spark 7 Pro» ──');
console.log(`   ESTRICTA (la del servicio): ${r?.sparkExactas?.length} → ${JSON.stringify(r?.sparkExactas)}`);
console.log(`   con parecidos (la vieja):    ${r?.sparkParecidas?.length} → ${JSON.stringify(r?.sparkParecidas)}`);
const ajenasSpark = ['Google 7 Pro', 'Realme 7 Pro', 'Redmi Note 7'];
check('AC-3: para «Spark 7 Pro» ya no viene la pantalla de otro modelo',
  (r?.sparkExactas ?? []).some(n => /Spark 7 Pro/i.test(n)) && ajenasSpark.every(a => !(r?.sparkExactas ?? []).some(n => n.includes(a))),
  `la suya sí, y ninguna de ${ajenasSpark.join(' / ')}`);
check('AC-4: y la consulta con parecidos SÍ las traía (el defecto era real, no un supuesto)',
  ajenasSpark.some(a => (r?.sparkParecidas ?? []).some(n => n.includes(a))),
  JSON.stringify(r?.sparkParecidas));

// ── 4) la UI que se envía usa el comando ESTRICTO (el desplegable del servicio y el asistente de cierre) ──
// Se comprueba sobre el BUNDLE que lleva el binario (es el artefacto que usa el dueño): la búsqueda del
// modelo tiene que pedir `find_compatible_screens_exactas`, no la consulta con parecidos. El camino
// visual del wizard (4 pasos, con cliente) se cubre en las verificaciones del servicio ya existentes.
const bundle = (() => {
  try {
    const dir = path.join(HERE, '..', 'dist', 'assets');
    return fs.readdirSync(dir).filter(f => f.endsWith('.js'))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  } catch { return ''; }
})();
check('AC-5: la UI envía el desplegable del modelo por el comando ESTRICTO',
  bundle.includes('find_compatible_screens_exactas'),
  bundle ? 'el bundle la llama' : 'no se pudo leer dist/assets');

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación NO escribe nada (solo consulta y mira la pantalla).');
process.exit(failed.length ? 1 : 0);
