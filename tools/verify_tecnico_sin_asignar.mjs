// VERIFICACIÓN EN VIVO (CDP) de F45 — «Sin asignar» por defecto al crear + la SEÑAL en la tarjeta.
//
// Pedido del dueño (2026-09-20): «al finalizar, la sección perfil asignar un técnico: cuando vas a
// crear nuevo servicio [el técnico] esté predeterminado como sin asignar, lo deje seguir registrando
// el servicio nuevo, y en la card aparezca una señal con un color: necesita agregar / asignar al
// técnico para ese trabajo».
//
// Qué comprueba sobre la app REAL:
//   1. Al abrir «Nuevo Servicio» el técnico arranca en **«Sin asignar»** — incluso con
//      `last_technician` en localStorage (el prefill viejo): el operario registra sin elegir técnico.
//   2. La ficha de ingreso lo marca **«Pendiente»** (aviso), NUNCA «Falta» (bloqueo): se puede
//      seguir registrando sin técnico.
//   3. La orden se GUARDA de verdad sin técnico (se crea por la UI, sin tocar ese campo) y queda con
//      `technician_id` NULL.
//   4. Su tarjeta muestra la señal ámbar **«Falta asignar técnico»** (`data-needs-tech`).
//   5. La señal es un BOTÓN: un clic abre el selector rápido, se asigna y la señal DESAPARECE.
//   6. Una orden ENTREGADA sin técnico **no** muestra la señal (el trabajo ya salió: no es ruido).
//
// SEGURIDAD DE DATOS: escribe de verdad (es una prueba), así que:
//   · `REGISTRO_DB` es OBLIGATORIO (si falta, ABORTA: no se prueba contra la base del local);
//   · NO abre el día: si la copia no tiene turno abierto, ABORTA;
//   · la orden de prueba va con «Cambio batería» (SIN pantalla del catálogo) para no mover stock, y
//     la entregada va con monto $0 y «Software / Formateo» (no toca caja ni inventario);
//   · al final BORRA sus órdenes y comprueba que no queden residuos.
//
// Uso:  $env:REGISTRO_DB="C:\...\backup\f45_verif.db"
//       $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//       (lanzar la app)  →  node tools/verify_tecnico_sin_asignar.mjs

import { evalx, clickCenter, keyNav, insertText, sleep } from './cdp_driver.mjs';
import fs from 'node:fs';

const out = [];
const check = (name, ok, detail) => { out.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`); };
const invoke = (cmd, args = {}) => evalx(`(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const dialogTxt = () => evalx(`(document.querySelector('[role="dialog"]')?.innerText) ?? null`);

const waitFor = async (expr, timeout = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalx(expr).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
/** Pone el valor de un input como lo haría el operario (setter nativo + evento input). */
const setValue = (sel, value) => evalx(`(() => {
  const i = document.querySelector(${JSON.stringify(sel)});
  if (!i) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
/** Botón del diálogo por texto exacto. */
const clickDialogExact = (label) => clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => (b.innerText || '').trim() === ${JSON.stringify(label)}) || null)`);

/**
 * F65b — Abre/cierra el DETALLE de la ficha de ingreso. Desde el pedido del dueño («ocupa demasiado
 * espacio del wizard»), la ficha es UNA línea y los 4 bloques, los obligatorios que faltan, los avisos
 * que no bloquean y la explicación del paso siguiente viven adentro de «Ver ficha». Las pruebas que
 * leen esos datos tienen que desplegarla, igual que el operario.
 */
const fichaAbierta = () => evalx(`!!document.querySelector('[data-ficha-detalle]')`);
const abrirFicha = async () => {
  if (await fichaAbierta()) return true;
  await evalx(`(() => { const b = [...document.querySelectorAll('[data-ficha] button')].find(x => /Ver ficha/i.test(x.innerText)); if (b) b.click(); return !!b; })()`);
  return waitFor(`!!document.querySelector('[data-ficha-detalle]')`, 6000);
};
const cerrarFicha = async () => {
  if (!(await fichaAbierta())) return true;
  await evalx(`(() => { const b = [...document.querySelectorAll('[data-ficha] button')].find(x => /Ocultar/i.test(x.innerText)); if (b) b.click(); return !!b; })()`);
  return waitFor(`!document.querySelector('[data-ficha-detalle]')`, 6000);
};

/** ¿Está activo el chip de un trabajo? (los chips de TRABAJOS no son toggles de Radix: se pintan
 *  con `bg-primary` cuando están activos — los de MÉTODO de pago sí llevan `data-state`). */
const chipOn = (label) => evalx(`(([...document.querySelectorAll('[role="dialog"] button')]
  .find(b => (b.innerText || '').trim() === ${JSON.stringify(label)})?.className || '') + '').includes('bg-primary')`);

/**
 * Deja un chip de trabajo como se pide y ESPERA a que el estado cambie (lección del proyecto: en las
 * pruebas CDP se espera la condición, no el reloj).
 *
 * Se intenta primero el **clic real** (el que hace el operario). Si el clic por coordenadas no cambia
 * nada (el chip queda debajo del área visible del diálogo cuando la ficha de ingreso está desplegada y
 * `elementFromPoint` devuelve el contenedor: el punto no es cliqueable), se cae a `element.click()`:
 * los chips de TRABAJOS son botones React comunes (a diferencia de los toggles de Radix, que sí
 * necesitan puntero real). Sin este fallback la prueba fallaba por la GEOMETRÍA, no por el producto.
 */
const clicSintetico = (label) => evalx(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(label)});
  if (!b) return false;
  b.click();
  return true;
})()`);

const setTrabajo = async (label, on) => {
  for (let i = 0; i < 4; i++) {
    if ((await chipOn(label)) === on) return true;
    await clickDialogExact(label).catch(() => {});
    await sleep(600);
    if ((await chipOn(label)) !== on) await clicSintetico(label);
    await sleep(600);
  }
  return (await chipOn(label)) === on;
};

/**
 * Elige una opción de un Select de Radix por TEXTO.
 *  · abre con clic real (reintenta si el primer clic no despliega la lista),
 *  · usa el TECLADO para navegar leyendo el resaltado real (el portal puede quedar fuera del área
 *    clickeable según el tamaño de la ventana),
 *  · **NUNCA pulsa Escape al fallar**: el Escape cerraría el wizard entero (lección medida: la
 *    corrida siguiente encontraba todo `null` porque el diálogo se había cerrado).
 */
const elegirOpcion = async (abrirExpr, label) => {
  const hayOpciones = () => evalx(`document.querySelectorAll('[role="option"]').length > 0`);
  for (let i = 0; i < 3; i++) {
    await clickCenter(abrirExpr).catch(() => {});
    await sleep(600);
    if (await hayOpciones()) break;
  }
  if (!(await hayOpciones())) return false;
  for (let i = 0; i < 14; i++) {
    const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
    if (String(hi).includes(label)) { await keyNav('Enter', 'Enter', 13); await sleep(900); return true; }
    await keyNav('ArrowDown', 'ArrowDown', 40);
    await sleep(220);
  }
  return false;
};

// ── 0) GATE DE DATOS ────────────────────────────────────────────────────────────────────────
const dbPath = process.env.REGISTRO_DB;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('ABORTADO: falta REGISTRO_DB apuntando a la MISMA copia de la base que usa la app.');
  console.error('  Ej.: node tools/snapshot_db.mjs --out backup/f45_verif.db   y arrancar con $env:REGISTRO_DB a esa copia.');
  process.exit(2);
}

// desbloqueo del PIN (borrar órdenes exige sesión de DUEÑO)
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

const dia = await invoke('get_active_day').catch(() => null);
if (!dia) {
  console.log('ABORTADO: la copia no tiene día abierto (esta prueba NO abre el turno del local).');
  process.exit(2);
}
console.log(`· copia: ${dbPath} · día abierto (${dia.close_date ?? 'hoy'})`);

// ── 1) hay técnicos en el padrón (para poder asignar) ───────────────────────────────────────
const tecnicos = await invoke('get_technicians').catch(() => []);
const tecnico = Array.isArray(tecnicos) ? tecnicos[0] : null;
check('hay al menos un técnico en el padrón para asignar', !!tecnico, tecnico ? `${tecnico.name} (id ${tecnico.id})` : 'sin técnicos');
if (!tecnico) process.exit(1);

const marca = String(Date.now()).slice(-6);
const PREFIJO = `Prueba SinTecnico ${marca}`;
let idCreada = null;
let idEntregada = null;

try {
  // ── 2) el ESTADO VIEJO simulado: last_technician apuntando a un técnico real ──────────────
  // Con el código anterior el wizard se prellenaba con ESTE técnico. Ahora tiene que ignorarlo.
  await evalx(`localStorage.setItem('last_technician', ${JSON.stringify(String(tecnico.id))}); 'ok'`);
  await clickCenter(`[...document.querySelectorAll('aside button')].find(b => b.innerText.trim().startsWith('Servicio'))`);
  await sleep(1800);
  await clickCenter(`([...document.querySelectorAll('button')].find(b => /^Nuevo Servicio$/.test(b.innerText.trim())) || null)`);
  const abrio = await waitFor(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`, 10000);
  check('el wizard de recepción abre', abrio, String(await dialogTxt()).split('\n')[0]);

  const combos = await evalx(`[...document.querySelectorAll('[role="dialog"] [role="combobox"]')].map(b => (b.innerText || '').replace(/\\s+/g, ' ').trim())`);
  check('F45: el técnico arranca en «Sin asignar» (aunque last_technician tenga un técnico guardado)',
    (combos ?? []).includes('Sin asignar'), JSON.stringify(combos));

  // La ficha lo trata como AVISO, no como bloqueo (F33: `falta` = bloquea, `pendiente` = se puede seguir)
  check('la ficha se despliega con «Ver ficha»', await abrirFicha(), 'data-ficha-detalle');
  const estadoTecnico = await evalx(`document.querySelector('[data-ficha-field="technician"]')?.getAttribute('data-state') ?? null`);
  check('F45: la ficha marca el técnico como «pendiente» (aviso), no como «falta» (bloqueo)',
    estadoTecnico !== 'falta' && estadoTecnico !== null, `data-state=${estadoTecnico}`);
  // Se vuelve a plegar la ficha: desplegada empuja los chips y el formulario queda largo de más.
  await cerrarFicha();

  // ── 3) registrar SIN técnico: cliente + cédula (#) y el equipo con «Cambio batería» ───────
  await setValue('[role="dialog"] input[placeholder^="Buscar por nombre o cédula"]', PREFIJO);
  await sleep(300);
  await setValue('[role="dialog"] input[placeholder="V-12345678"]', `V-9${marca}`);
  await sleep(600);
  await clickDialogExact('Siguiente');
  await sleep(1000);
  // El paso «Equipos» tiene que estar a la vista (con el foco del teclado y el layout cambiantes, un
  // clic por coordenadas puede caer al lado: se comprueba la condición, no se supone).
  check('el wizard avanza al paso «Equipos»', await evalx(`!!document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')`),
    (await evalx(`(document.querySelector('[role="dialog"]')?.innerText ?? '').match(/Paso \\d+ de \\d+[^\\n]*/)?.[0] ?? null`)));

  // modelo del padrón (uno cualquiera con ficha: la prueba no depende de una pantalla con stock)
  const modelos = await invoke('get_phone_models', { search: '', limit: 60 }).catch(() => []);
  const modelo = (modelos ?? []).find(m => (m.label ?? '').trim().length > 0)?.label;
  check('hay un modelo del padrón para el equipo de prueba', !!modelo, String(modelo));
  if (!modelo) throw new Error('sin modelos en el padrón');
  // El modelo se escribe con el setter nativo (como el resto de las pruebas en vivo): el tipeo por
  // teclado depende del foco y con el wizard cambiando de alto un clic puede no enfocar el input.
  const modeloPuesto = await evalx(`(() => {
    const i = document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]');
    if (!i) return false;
    i.focus();
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(i, ${JSON.stringify(modelo)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  check('se pudo escribir el modelo en el buscador del padrón', modeloPuesto === true, String(modelo));
  await waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => (b.innerText || '').replace(/\\s+/g,' ').trim().startsWith(${JSON.stringify(modelo)}) && !/^Pantalla /.test((b.innerText || '').trim()))`, 10000);
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => {
    const t = (b.innerText || '').replace(/\\s+/g, ' ').trim();
    return t.startsWith(${JSON.stringify(modelo)}) && !/^Pantalla /.test(t);
  }) || null)`).catch(async () => {
    // Plan B honesto: si el clic por coordenadas no llega, se elige con el clic del propio elemento.
    await evalx(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => {
        const t = (x.innerText || '').replace(/\\s+/g, ' ').trim();
        return t.startsWith(${JSON.stringify(modelo)}) && !/^Pantalla /.test(t);
      });
      if (b) b.click();
      return !!b;
    })()`);
  });
  await sleep(900);
  const modeloElegido = await evalx(`document.querySelector('[role="dialog"] input[placeholder^="Buscar el modelo del teléfono"]')?.value ?? null`);
  check('el modelo del padrón queda elegido en el equipo', String(modeloElegido) === String(modelo), String(modeloElegido));

  // «Cambio pantalla» viene preseleccionado y pediría la pantalla exacta del catálogo: se cambia por
  // «Cambio batería» (esta prueba es del TÉCNICO, no de la pantalla, y así no se toca el inventario).
  const bateriaOk = await setTrabajo('Cambio batería', true);
  await setTrabajo('Cambio pantalla', false);
  const pantallaOff = (await chipOn('Cambio pantalla')) === false;
  check('el equipo de prueba queda con «Cambio batería» y sin «Cambio pantalla» (no mueve stock)',
    bateriaOk && pantallaOff, `batería=${await chipOn('Cambio batería')} · pantalla=${await chipOn('Cambio pantalla')}`);
  // monto (no es obligatorio para guardar, pero la orden real lleva uno)
  await evalx(`(() => {
    const l = [...document.querySelectorAll('[role="dialog"] label')].find(x => (x.innerText || '').startsWith('Monto ($)'));
    const i = l?.parentElement?.querySelector('input[type="number"]');
    if (!i) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(i, '25');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(700);

  // ── F48: el COLOR es obligatorio, y la ficha te lleva al selector ───────────────────────────
  // (pedido del dueño: «en los colores que sea un campo requerido; si no selecciono un color lo
  // salte de una vez a que elija un color… se ayude con teclado enter, lo vaya llevando de la mano»).
  const fichaPide = await evalx(`document.querySelector('[data-ficha-next]')?.getAttribute('data-ficha-next') ?? null`);
  check('F48: con el modelo y el trabajo puestos, la ficha pide el COLOR', fichaPide === 'color', String(fichaPide));
  const siguienteBloqueado = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim()));
    return b ? b.disabled : null;
  })()`);
  check('F48: sin color, «Siguiente» queda bloqueado (el color es dato obligatorio)', siguienteBloqueado === true, `disabled=${siguienteBloqueado}`);
  // F65b — los avisos que NO bloquean ya no ocupan un renglón: viven adentro del detalle (la línea
  // compacta solo muestra su cuenta con el ⚠). Se despliega para leerlos, como haría el operario.
  check('la ficha se despliega para leer los avisos que no bloquean', await abrirFicha(), 'data-ficha-detalle');
  const notaTelefono = await evalx(`(() => { const n = document.querySelector('[data-ficha-nota="phone"]'); return n ? n.innerText.replace(/\\s+/g, ' ').trim() : null; })()`);
  check('F48: la ficha OBSERVA que falta el teléfono del cliente (sin bloquear)',
    /falta el n[uú]mero de tel[eé]fono/i.test(String(notaTelefono)), String(notaTelefono));
  await cerrarFicha();
  // «Ir al campo» deja el FOCO en el selector de color (el asistente lleva de la mano). El botón vive
  // en la línea compacta, así que está disponible con la ficha plegada.
  await clickCenter(`([...document.querySelectorAll('[role="dialog"] button')].find(b => /Ir al campo/i.test(b.innerText)) || null)`);
  await sleep(900);
  const foco = await evalx(`document.activeElement?.getAttribute('data-ficha-target') ?? document.activeElement?.tagName ?? null`);
  check('F48: «Ir al campo» deja el foco en el selector de color', foco === 'color', `foco=${foco}`);
  // El color se elige con el TECLADO (el trigger ya tiene el foco que dejó «Ir al campo»): Enter abre
  // la lista, las flechas navegan y se lee el resaltado real. Sin coordenadas ni Escape (que cerraría
  // el wizard entero).
  const eligioColor = await (async () => {
    await evalx(`(() => { const t = document.querySelector('[data-ficha-target="color"]'); if (t) t.focus(); return !!t; })()`);
    await keyNav('Enter', 'Enter', 13);
    await sleep(700);
    for (let i = 0; i < 14; i++) {
      const hi = await evalx(`document.querySelector('[role="option"][data-highlighted]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
      if (String(hi).includes('Azul')) { await keyNav('Enter', 'Enter', 13); await sleep(900); return true; }
      await keyNav('ArrowDown', 'ArrowDown', 40);
      await sleep(220);
    }
    return false;
  })();
  const colorPuesto = await evalx(`document.querySelector('[data-ficha-target="color"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
  check('F48: el color queda elegido en el equipo', eligioColor && String(colorPuesto).includes('Azul'), String(colorPuesto));
  const trasColor = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Siguiente$/.test((x.innerText || '').trim()));
    return b ? b.disabled : null;
  })()`);
  check('F48: con el color elegido, «Siguiente» se habilita en el acto', trasColor === false, `disabled=${trasColor}`);
  const pideAhora = await evalx(`document.querySelector('[data-ficha-next]')?.getAttribute('data-ficha-next') ?? null`);
  check('F48: la ficha deja de pedir el color y pasa al dato siguiente',
    pideAhora !== 'color', String(pideAhora));

  await clickDialogExact('Siguiente');   // Blindaje
  await sleep(900);
  await clickDialogExact('Siguiente');   // Revisar
  await sleep(900);
  const enRevisar = /Paso 4 de 4/.test(String(await dialogTxt()));
  check('el wizard llega al paso «Revisar» sin haber elegido técnico', enRevisar,
    (String(await dialogTxt()).match(/Paso \d+ de \d+[^\n]*/) || [''])[0]);
  const guardarOk = await evalx(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Guardar Servicio/.test((x.innerText || '').trim()));
    return b ? !b.disabled : null;
  })()`);
  check('F45: «Guardar Servicio» está HABILITADO sin técnico (no bloquea el registro)', guardarOk === true, `habilitado=${guardarOk}`);
  // F48: la observación del teléfono es solo eso — una observación. Con el teléfono VACÍO el guardado
  // sigue disponible (lo que bloquea es el color, que ya se eligió).
  check('F48: la observación del teléfono NO bloquea el guardado (se puede registrar igual)', guardarOk === true);
  const telVacio = await evalx(`(document.querySelector('[role="dialog"] input[placeholder="0412-1234567"]')?.value ?? '') === ''`);
  check('F48: (preparación) el teléfono quedó vacío y aun así se puede guardar', telVacio === true);

  // OJO: el backend guarda los nombres en Título (`title_case`), así que «Prueba SinTecnico 123» se
  // guarda «Prueba Sintecnico 123»: se busca por la MARCA (los dígitos), que es lo único estable.
  await clickDialogExact('Guardar Servicio').catch(() => {});
  await sleep(1500);
  if (await evalx(`/Nuevo Servicio Técnico/.test(document.querySelector('[role="dialog"]')?.innerText ?? '')`)) {
    // El pie del diálogo también puede quedar tapado por el scroll: mismo fallback que los chips.
    await evalx(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Guardar Servicio/.test((x.innerText || '').trim()));
      if (b) b.click();
      return !!b;
    })()`);
  }
  const cerro = await waitFor(`!((document.querySelector('[role="dialog"]')?.innerText ?? '').includes('Nuevo Servicio Técnico'))`, 12000);
  const filas = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
  const creada = (filas ?? []).find(r => (r.client ?? '').includes(marca));
  idCreada = creada?.id ?? null;
  check('F45: la orden se registró de verdad sin técnico (la dejó seguir registrando)',
    cerro && !!idCreada && creada?.technician_id == null && !(creada?.technician ?? ''),
    idCreada ? `${creada.order_num} · cliente=${creada.client} · technician_id=${creada.technician_id}` : 'no se creó');

  // F46: al guardar la recepción sale el MODAL de política (foto de entrada / pago acordado). Bloquea
  // la pantalla hasta responderlo o posponerlo, así que la prueba lo cierra con «Después» (no anota
  // nada) antes de seguir con la tarjeta.
  const modalTrasGuardar = await evalx(`document.querySelector('[data-policy-modal]')?.getAttribute('data-reminder') ?? null`);
  check('F46: al guardar la recepción aparece el modal de política (foto de entrada / pago)',
    modalTrasGuardar !== null, String(modalTrasGuardar));
  for (let i = 0; i < 4; i++) {
    const abierto = await evalx(`!!document.querySelector('[data-policy-modal]')`);
    if (!abierto) break;
    await clickCenter(`document.querySelector('[data-policy-later]')`).catch(async () => {
      await evalx(`(() => { const b = document.querySelector('[data-policy-later]'); if (b) b.click(); return !!b; })()`);
    });
    await sleep(800);
  }
  check('F46: los avisos se pueden posponer sin anotar nada (uno por vez)', (await evalx(`!!document.querySelector('[data-policy-modal]')`)) === false);

  // ── 4) la SEÑAL en la tarjeta ─────────────────────────────────────────────────────────────
  const senal = await evalx(`(() => {
    const b = document.querySelector('[data-needs-tech="${idCreada}"]');
    return b ? (b.innerText || '').replace(/\\s+/g, ' ').trim() : null;
  })()`);
  check('F45: la tarjeta muestra la señal «Falta asignar técnico» (data-needs-tech)',
    /Falta asignar t[eé]cnico/i.test(String(senal)), String(senal));
  const colorSenal = await evalx(`(() => {
    const b = document.querySelector('[data-needs-tech="${idCreada}"]');
    if (!b) return null;
    const st = getComputedStyle(b);
    // El texto secundario de la app (muted) sirve de referencia: la señal NO puede verse igual.
    const muted = getComputedStyle([...document.querySelectorAll('main .text-muted-foreground')][0] ?? document.body).color;
    return JSON.stringify({ color: st.color, muted, bg: st.backgroundColor, border: st.borderTopColor });
  })()`);
  const col = JSON.parse(String(colorSenal ?? 'null') ?? 'null');
  // Tailwind v4 pinta con oklch/oklab: se lee el MATIZ (tercer número, ≈49 = ámbar) o, si viniera en
  // rgb, que el rojo esté por encima del azul (naranja/ámbar). Y nunca el gris del texto secundario.
  const hue = Number((String(col?.color ?? '').match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/) ?? [])[3]);
  const rgb = (String(col?.color ?? '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) ?? []).slice(1).map(Number);
  const esAmbar = Number.isFinite(hue) ? hue > 20 && hue < 100 : (rgb.length === 3 ? rgb[0] > rgb[2] : false);
  check('F45: la señal tiene color propio (ámbar) y no el gris del texto secundario',
    esAmbar && col?.color !== col?.muted, String(colorSenal));

  // ── 5) la señal es el ATAJO para asignar: un clic → elegir técnico → desaparece ───────────
  await clickCenter(`document.querySelector('[data-needs-tech="${idCreada}"]')`);
  await sleep(900);
  const abrioSelector = await evalx(`!!document.querySelector('[data-quick-tech]')`);
  check('F45: el clic en la señal abre el selector rápido de técnicos', abrioSelector === true);
  await clickCenter(`document.querySelector('[data-tech-option="${tecnico.id}"]')`);
  await sleep(2000);
  const trasAsignar = await invoke('get_service', { id: idCreada });
  check('F45: el técnico queda GUARDADO en la orden',
    String(trasAsignar?.technician_id) === String(tecnico.id), `technician_id=${trasAsignar?.technician_id}`);
  const senalDespues = await evalx(`!!document.querySelector('[data-needs-tech="${idCreada}"]')`);
  check('F45: al asignarlo, la señal DESAPARECE de la tarjeta', senalDespues === false);

  // ── 6) una orden ENTREGADA sin técnico NO se reclama ──────────────────────────────────────
  const numEnt = await invoke('add_service_order', {
    client: `${PREFIJO} entregada`, phone: '', clientCi: '', clientAddress: '', clientId: null,
    technician: '', technicianId: null,
    devices: [{
      model: modelo, color: '', fault: `prueba F45 ${marca}`, service_type: 'Software / Formateo',
      service_types: JSON.stringify(['Software / Formateo']), amount: 0, discount_amount: 0,
      payment_method: 'Divisas (USD Cash)', observations: '', bank_fee_percent: 0, zelle_reference: '',
      currency: 'USD', device_checklist: '', screen_product_id: null, status: 'Recibido',
    }],
  });
  const filasEnt = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' });
  const ent = (filasEnt ?? []).find(r => (r.order_num ?? '') === numEnt);
  idEntregada = ent?.id ?? null;
  if (idEntregada) {
    await invoke('update_service', {
      id: idEntregada, client: ent.client, phone: '', model: ent.model ?? '', fault: ent.fault ?? '',
      serviceType: 'Software / Formateo', serviceTypes: JSON.stringify(['Software / Formateo']), amount: 0,
      paymentMethod: 'Divisas (USD Cash)', dateOut: '', status: 'Entregado', observations: '',
      bankFeePercent: 0, zelleReference: '', currency: 'USD', clientCi: '', clientAddress: '',
      deviceChecklist: '', technician: '', technicianId: null, color: '', screenProductId: null, discountAmount: 0,
    });
    await clickCenter(`document.querySelector('input[placeholder*="Buscar" i]')`);
    await evalx(`(() => { const i = document.querySelector('input[placeholder*="Buscar" i]'); i.select(); return true; })()`);
    await keyNav('Backspace', 'Backspace', 8);
    await insertText(marca);
    await waitFor(`!!document.querySelector('[data-tech-quick="${idEntregada}"]')`, 12000);
    await sleep(600);
    const senalEntregada = await evalx(`!!document.querySelector('[data-needs-tech="${idEntregada}"]')`);
    const esEntregada = await evalx(`(() => {
      const b = document.querySelector('[data-tech-quick="${idEntregada}"]');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : null;
    })()`);
    check('F45: una orden ENTREGADA sin técnico NO muestra la señal (el trabajo ya salió)',
      senalEntregada === false, `tarjeta="${esEntregada}"`);
  } else {
    check('F45: se pudo preparar la orden entregada sin técnico', false, 'no se creó');
  }
} catch (e) {
  check('la verificación corrió hasta el final sin excepciones', false, String(e?.message ?? e));
  if (await evalx(`!!document.querySelector('[role="dialog"]')`).catch(() => false)) { await keyNav('Escape', 'Escape', 27).catch(() => {}); }
}

// ── 7) LIMPIEZA ─────────────────────────────────────────────────────────────────────────────
// Se borran las órdenes creadas y, por las dudas, CUALQUIER residuo de la marca de esta corrida
// (si una corrida anterior falló a mitad, deja su orden: la prueba no puede dejar basura).
for (const id of [idCreada, idEntregada]) {
  if (id) await invoke('delete_service', { id }).catch(e => check(`borrar la orden ${id}`, false, String(e)));
}
for (let i = 0; i < 3; i++) {
  const sobran = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => []);
  if (!Array.isArray(sobran) || sobran.length === 0) break;
  for (const r of sobran) await invoke('delete_service', { id: r.id }).catch(() => {});
}
const restos = await invoke('get_services', { search: marca, status: '', startDate: '', endDate: '', dateField: 'in' }).catch(() => null);
check('las órdenes de prueba quedaron borradas (sin residuos)', Array.isArray(restos) && restos.length === 0, `quedan=${restos?.length}`);
// El «último técnico» que la prueba sembró en localStorage se limpia para no dejar rastro.
await evalx(`localStorage.removeItem('last_technician'); 'ok'`).catch(() => {});

const failed = out.filter(r => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} comprobaciones OK${failed.length ? ` — FALLAN: ${failed.map(f => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
