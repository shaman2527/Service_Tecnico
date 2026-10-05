// VERIFICACIÓN EN VIVO (CDP) de F90 — LA FICHA DEL TELÉFONO SE ACTUALIZA DESDE EL CAMPO DE
// COMPATIBILIDAD DEL PRODUCTO, por el camino REAL del formulario.
//
// Pedido del dueño (2026-10-05): «en la edición de producto, si yo le quito cualquiera de esto, en la
// vista de la ficha debe eliminarse; si yo agrego algo acá también debe actualizarse en la ficha…
// quiero centralizar las actualizaciones de ficha de compatibilidades en el campo de
// compatibilidades de producto». Se mide EXACTAMENTE eso: se edita el producto con el formulario
// (Inventario → Productos → lápiz), se guarda, y se mira la FICHA del teléfono (Inventario → Modelos).
//
// SEGURIDAD DE DATOS: ESCRIBE (edita la compatibilidad de un producto y la DEVUELVE). Sobre COPIA.
//
// Uso:  app abierta con CDP 9222 y REGISTRO_DB=<copia>
//       node tools/verify_f90_ficha_compatibilidad.mjs

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
const setValor = (sel, valor) => evalx(`(() => {
  const el = ${sel};
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const s = Object.getOwnPropertyDescriptor(proto, 'value').set;
  s.call(el, ${JSON.stringify(valor)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

await evalx(`location.reload(); 'ok'`).catch(() => {});
await sleep(2500);
if (await evalx(`!!document.querySelector('input[placeholder="PIN de 4 dígitos"]')`)) {
  await clickCenter(`document.querySelector('input[placeholder="PIN de 4 dígitos"]')`);
  await typeText('1234');
  await keyNav('Enter', 'Enter', 13);
  await sleep(2500);
}
if (await evalx(`!!document.querySelector('[role="dialog"]')`)) { await keyNav('Escape', 'Escape', 27); await sleep(600); }

const COMPAT_INICIAL = await evalx(`(async () => {
  const I = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const prod = (await I('get_products', { search: 'Hot 30i', categoryId: 1 })).find(p => /Hot 30i/.test(String(p.name)));
  return prod ? { id: prod.id, lista: JSON.parse(prod.compatibility ?? '[]') } : null;
})()`);
if (!COMPAT_INICIAL) { console.log('ABORTADO: no encontré el producto «Infinix Hot 30i».'); process.exit(2); }
console.log(`── punto de partida ──\n   producto #${COMPAT_INICIAL.id}: ${COMPAT_INICIAL.lista.join(' / ')}`);

const irAInventario = async (tab) => {
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => /Inventario/i.test(b.innerText))`).catch(() => {});
  await sleep(1200);
  await clickCenter(`[...document.querySelectorAll('[role="tab"]')].find(t => new RegExp(${JSON.stringify(tab)}, 'i').test(t.innerText))`);
  await sleep(1500);
};
const buscar = async (texto) => {
  await evalx(`(() => { const i = [...document.querySelectorAll('input')].find(x => /Buscar/i.test(x.placeholder ?? '')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(texto)}); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
  await sleep(2200);
};

/** Abre la FICHA del teléfono y devuelve {repuestos, filas}. */
const abrirFicha = async () => {
  await irAInventario('Modelos');
  await buscar('Pop 7');
  const ok = await evalx(`(() => {
    const fila = [...document.querySelectorAll('tbody tr')].find(f => /pop 7/i.test(f.innerText));
    if (!fila) return false;
    // la fila tiene DOS botones: «Ficha» y «Corregir» (hay que apuntar al de la ficha)
    const b = [...fila.querySelectorAll('button')].find(x => /^ficha$/i.test((x.innerText || '').trim()));
    if (!b) return false;
    b.click(); return true;
  })()`);
  await waitFor(`!!document.querySelector('[role="dialog"] table')`, 12000);
  await sleep(800);
  const ficha = await evalx(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!d) return null;
    const filas = [...d.querySelectorAll('tbody tr')].map(f => f.innerText.replace(/\\s+/g, ' ').trim());
    const m = d.innerText.match(/(\\d+)\\s+repuesto/);
    return { repuestos: m ? Number(m[1]) : filas.length, filas };
  })()`);
  await keyNav('Escape', 'Escape', 27);
  await sleep(900);
  return ok ? ficha : null;
};

/** Edita la compatibilidad del producto POR EL FORMULARIO — con la LISTA DE MODELOS de F91
 *  (Productos → lápiz → chips con ✕ y buscador → Actualizar). Deja la lista EXACTAMENTE como se pide:
 *  quita los chips que no van y agrega los que faltan eligiéndolos del padrón. */
const editarCompatibilidad = async (lista) => {
  await irAInventario('Productos');
  await buscar('Hot 30i');
  const abrio = await evalx(`(() => {
    const fila = [...document.querySelectorAll('tbody tr')].find(f => /hot 30i/i.test(f.innerText));
    if (!fila) return false;
    const b = [...fila.querySelectorAll('button')].find(x => /editar/i.test(x.getAttribute('aria-label') ?? x.title ?? ''));
    if (!b) return false;
    b.click(); return true;
  })()`);
  if (!abrio) return { ok: false, motivo: 'no encontré el lápiz de la fila' };
  // F91: el campo de texto se fue; el formulario ahora trae el selector de modelos
  const hayForm = await waitFor(`!!document.querySelector('[role="dialog"] [data-compat-picker]')`, 12000);
  if (!hayForm) return { ok: false, motivo: 'no abrió el formulario con el selector de modelos' };

  // 1) QUITAR los que sobran (el ✕ de cada chip)
  const quitados = await evalx(`(() => {
    const deseados = ${JSON.stringify(lista.map(s => s.toLowerCase()))};
    const fuera = [...document.querySelectorAll('[data-compat-quitar]')]
      .filter(b => !deseados.includes(String(b.getAttribute('data-compat-quitar') ?? '').toLowerCase()));
    fuera.forEach(b => b.click());
    return fuera.map(b => b.getAttribute('data-compat-quitar'));
  })()`);
  await sleep(500);

  // 2) AGREGAR los que faltan, uno por uno, eligiéndolos del padrón.
  //    OJO (medido): el buscador del padrón matchea por MODELO, así que «Tecno Pop 7» no devuelve
  //    «Tecno Pop 7» (devuelve parecidos y el primero era «Tecno Pop 5 Lite»): se busca por el modelo
  //    (sin la marca, que es la primera palabra de la etiqueta canónica).
  const agregados = [];
  for (const modelo of lista) {
    const falta = await evalx(`!([...document.querySelectorAll('[data-compat-chip]')]
      .some(c => String(c.getAttribute('data-compat-chip')).toLowerCase() === ${JSON.stringify(modelo.toLowerCase())}))`);
    if (!falta) continue;
    const sinMarca = modelo.split(/\s+/).slice(1).join(' ') || modelo;
    const opciones = [];
    for (const consulta of [sinMarca, modelo]) {
      await evalx(`(() => {
        const i = document.querySelector('[role="dialog"] [data-compat-buscar]');
        if (!i) return false;
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        s.call(i, ${JSON.stringify(consulta)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await sleep(2400);
      opciones.push(...await evalx(`[...document.querySelectorAll('[data-compat-opcion]')]
        .map(o => String(o.getAttribute('data-compat-opcion')))`) ?? []);
      if (opciones.some(o => o.toLowerCase() === modelo.toLowerCase())) break;
    }
    const quiero = modelo.toLowerCase();
    const elegido = await evalx(`(() => {
      const quiero = ${JSON.stringify(quiero)};
      const ops = [...document.querySelectorAll('[data-compat-opcion]')];
      const op = ops.find(o => String(o.getAttribute('data-compat-opcion')).toLowerCase() === quiero)
        ?? ops.find(o => String(o.getAttribute('data-compat-opcion')).toLowerCase().includes(quiero))
        ?? ops.find(o => quiero.includes(String(o.getAttribute('data-compat-opcion')).toLowerCase()))
        ?? ops[0];
      if (!op) return null;
      op.click();
      return op.getAttribute('data-compat-opcion');
    })()`);
    if (!elegido) return { ok: false, motivo: `«${modelo}» no se pudo agregar (opciones: ${JSON.stringify(opciones.slice(0, 3))})` };
    if (elegido.toLowerCase() !== quiero) {
      return { ok: false, motivo: `agregué «${elegido}» en vez de «${modelo}» (opciones: ${JSON.stringify(opciones.slice(0, 3))})` };
    }
    agregados.push(elegido);
    await sleep(400);
  }

  const guardo = await evalx(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop();
    const b = [...d.querySelectorAll('button')].find(x => /^(actualizar|guardar)$/i.test((x.innerText || '').trim()));
    if (!b || b.disabled) return false;
    b.click(); return true;
  })()`);
  if (!guardo) return { ok: false, motivo: 'no pude pulsar Actualizar' };
  await waitFor(`![...document.querySelectorAll('[role="dialog"]')].some(d => /Editar:/.test(d.innerText))`, 15000);
  await sleep(1200);
  console.log(`   formulario: quité ${JSON.stringify(quitados)} · agregué ${JSON.stringify(agregados)}`);
  return { ok: true };
};

// ── 1) la ficha ANTES ──────────────────────────────────────────────────────────────────────────
const fichaAntes = await abrirFicha();
console.log(`\n── la ficha del teléfono «Pop 7» ──\n   ${fichaAntes?.repuestos} repuestos · ¿lista el «Infinix Hot 30i»? ${(fichaAntes?.filas ?? []).some(f => /hot 30i/i.test(f))}`);
check('AC-1: la ficha lista el repuesto cuya compatibilidad nombra al teléfono',
  (fichaAntes?.filas ?? []).some(f => /hot 30i/i.test(f)), JSON.stringify(fichaAntes?.filas?.slice(0, 3)));

// ── 2) QUITAR «Tecno Pop 7» con el FORMULARIO y volver a mirar la ficha ────────────────────────
const sinPop7 = COMPAT_INICIAL.lista.filter(x => !/pop 7/i.test(x));
const edit1 = await editarCompatibilidad(sinPop7);
const fichaSin = edit1.ok ? await abrirFicha() : null;
console.log(`   quité «Tecno Pop 7» en el formulario (${edit1.ok ? 'guardado' : edit1.motivo}) → la ficha dice ${fichaSin?.repuestos} repuestos`);
// F93 — LA RED SE SINCRONIZA: al quitar un teléfono, TODAS las fichas de esa red se ajustan (la del
// que queda y la del que se retiró). Por eso el conteo baja mucho más que antes (la red entera deja de
// servirle al Pop 7), pero lo que la prueba mide es lo mismo: ESTE repuesto desaparece de su ficha.
check('AC-2: al QUITAR un teléfono en el producto, el repuesto DESAPARECE de la ficha',
  !!fichaSin && !(fichaSin.filas ?? []).some(f => /hot 30i/i.test(f))
  && Number(fichaSin.repuestos) < Number(fichaAntes?.repuestos),
  `${fichaAntes?.repuestos} → ${fichaSin?.repuestos} repuestos (la red completa se sincronizó: F93)`);

// ── 3) VOLVER A AGREGARLO con el formulario ────────────────────────────────────────────────────
const edit2 = await editarCompatibilidad(COMPAT_INICIAL.lista);
const fichaVuelta = edit2.ok ? await abrirFicha() : null;
console.log(`   volví a poner «Tecno Pop 7» (${edit2.ok ? 'guardado' : edit2.motivo}) → la ficha dice ${fichaVuelta?.repuestos} repuestos`);
check('AC-3: al AGREGAR un teléfono en el producto, el repuesto APARECE en la ficha (y la red se rearma)',
  !!fichaVuelta && (fichaVuelta.filas ?? []).some(f => /hot 30i/i.test(f))
  && Number(fichaVuelta.repuestos) === Number(fichaAntes?.repuestos),
  `${fichaSin?.repuestos} → ${fichaVuelta?.repuestos} repuestos`);

// ── 4) la compatibilidad quedó EXACTAMENTE como estaba (la prueba no deja residuos) ────────────
const final = await evalx(`(async () => {
  const I = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const prod = (await I('get_products', { search: 'Hot 30i', categoryId: 1 })).find(p => /Hot 30i/.test(String(p.name)));
  return prod ? JSON.parse(prod.compatibility ?? '[]') : null;
})()`);
const mismo = JSON.stringify([...(final ?? [])].sort()) === JSON.stringify([...COMPAT_INICIAL.lista].sort());
console.log(`\n── estado final ──\n   ${JSON.stringify(final)}`);
check('AC-4: la compatibilidad quedó como estaba (sin residuos de la prueba)', mismo,
  mismo ? 'igual' : `esperado ${JSON.stringify(COMPAT_INICIAL.lista)}`);

const failed = out.filter(x => !x.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
console.log('\nOJO: esta verificación ESCRIBE (y devuelve la compatibilidad). Corré sobre una COPIA.');
process.exit(failed.length ? 1 : 0);
