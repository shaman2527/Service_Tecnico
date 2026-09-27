// Pruebas PURAS de `src/lib/wizard-cobro.ts` (Harness F79 — cobrar dentro del wizard).
//
// Fija las promesas del dueño sobre el botón de cobro del paso 2:
//   · el botón DICE lo que va a pasar (en crear, el monto de ese equipo; en editar, que es el mismo
//     «Pago / Abono» de la tarjeta);
//   · el estado del dinero se cuenta con NÚMEROS REALES (lo cobrado, el saldo, el excedente a favor);
//   · una orden CANCELADA o DEVUELTA no admite cobros y lo dice el motivo (no se abre un diálogo que
//     el backend va a rechazar) — y una orden de $0 NO es un error;
//   · el aviso de la orden ya guardada dice el número y que «Actualizar orden» NO crea otra;
//   · avisar cuando el monto escrito no es el que se va a cobrar (en editar se cobra el GUARDADO).
//
// Uso:  node tools/wizard_cobro_test.ts

import {
  etiquetaCobro, ayudaCobro, estadoCobro, avisoOrdenGuardada, avisoEquiposFijos,
  avisoMontoSinGuardar, avisoMontoPendiente, TOL,
} from '../src/lib/wizard-cobro.ts';

let checks = 0;
let failures = 0;

function eq(what: string, got: unknown, want: unknown) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FALLA · ${what}\n   esperado: ${JSON.stringify(want)}\n   obtenido: ${JSON.stringify(got)}`);
  }
}

function ok(what: string, cond: boolean) {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
}

// ── 1. Lo que dice el botón ─────────────────────────────────────────────────────────────────
{
  eq('crear con monto → el monto de ESE equipo', etiquetaCobro('crear', 30), 'Cobrar $30.00');
  eq('crear con centavos', etiquetaCobro('crear', 25.5), 'Cobrar $25.50');
  eq('crear en $0 → sin número inventado', etiquetaCobro('crear', 0), 'Cobrar');
  eq('crear con un monto no finito → sin número', etiquetaCobro('crear', NaN), 'Cobrar');
  eq('editar → la acción de siempre', etiquetaCobro('editar', 30), 'Cobrar / Abono');
  eq('editar con $0 → igual (la orden manda)', etiquetaCobro('editar', 0), 'Cobrar / Abono');
}

// ── 2. La ayuda dice que es el MISMO cobro de la tarjeta (y que guarda antes de cobrar) ──────
{
  ok('crear avisa que guarda la orden', ayudaCobro('crear').includes('Guarda la orden'));
  ok('crear nombra el diálogo de la tarjeta', ayudaCobro('crear').includes('Pago / Abono'));
  // F79 (2ª vuelta de la revisión): en EDICIÓN el botón TAMBIÉN guarda antes de cobrar — cobrar
  // cierra el registro, así que sin guardar primero se perdería lo que el operario acababa de
  // corregir en el paso donde estaba trabajando. La ayuda tiene que decirlo.
  ok('editar avisa que guarda los cambios', ayudaCobro('editar').includes('Guarda los cambios'));
  ok('editar nombra el diálogo de la tarjeta', ayudaCobro('editar').includes('Pago / Abono'));
}

// ── 3. El estado del dinero, con números reales ─────────────────────────────────────────────
{
  const pendiente = estadoCobro({ total: 30, pagado: 0, status: 'Recibido' });
  eq('sin cobros → tono pendiente', pendiente.tono, 'pendiente');
  eq('sin cobros → dice cuánto falta', pendiente.texto, 'Por cobrar $30.00.');
  eq('sin cobros → no hay motivo para no cobrar', pendiente.motivo, null);

  const parcial = estadoCobro({ total: 30, pagado: 10, status: 'En reparación' });
  eq('abono parcial → tono parcial', parcial.tono, 'parcial');
  eq('abono parcial → cobrado y saldo', parcial.texto, 'Cobrado $10.00 · saldo $20.00.');

  const cobrado = estadoCobro({ total: 30, pagado: 30, status: 'Entregado' });
  eq('cobrado exacto → tono cobrado', cobrado.tono, 'cobrado');
  eq('cobrado exacto → sin saldo', cobrado.texto, 'Cobrado $30.00 · sin saldo.');

  // La deuda NO se revalúa y un centavo de redondeo no inventa un saldo.
  const centavo = estadoCobro({ total: 30, pagado: 30 - TOL / 2, status: 'Entregado' });
  eq('medio centavo de diferencia → sin saldo', centavo.tono, 'cobrado');

  const favor = estadoCobro({ total: 30, pagado: 35, status: 'Entregado' });
  eq('cobró de más → a favor', favor.tono, 'a-favor');
  eq('cobró de más → se dice a favor del cliente', favor.texto, 'Cobrado $35.00 · a favor del cliente $5.00.');

  // Una orden de $0 es legítima (garantía/cortesía): se dice, no se trata como error.
  const cero = estadoCobro({ total: 0, pagado: 0, status: 'Recibido' });
  eq('orden de $0 → tono sin-monto', cero.tono, 'sin-monto');
  ok('orden de $0 → el texto lo dice', cero.texto.includes('$0.00'));
  eq('orden de $0 → se puede cobrar igual (no hay motivo)', cero.motivo, null);

  // Estados finales: no admiten cobros y el motivo lo dice la propia función.
  for (const st of ['Devuelto', 'Cancelado', 'Cancelado / Devuelto']) {
    const fin = estadoCobro({ total: 30, pagado: 10, status: st });
    eq(`${st} → tono cerrada`, fin.tono, 'cerrada');
    ok(`${st} → motivo presente`, !!fin.motivo);
    eq(`${st} → el texto y el motivo coinciden`, fin.texto, fin.motivo);
  }
  ok('Devuelto dice «devuelta»', estadoCobro({ total: 30, pagado: 0, status: 'Devuelto' }).texto.includes('devuelta'));
  ok('Cancelado dice «cancelada»', estadoCobro({ total: 30, pagado: 0, status: 'Cancelado' }).texto.includes('cancelada'));
  eq('sin estado → se comporta como pendiente', estadoCobro({ total: 30, pagado: 0 }).tono, 'pendiente');
  eq('números inválidos → no rompe ($0)', estadoCobro({ total: NaN, pagado: NaN }).tono, 'sin-monto');

  // NINGÚN texto estima bolívares: la equivalencia es del diálogo de cobro, que conoce la tasa (F38).
  const todos = [
    estadoCobro({ total: 30, pagado: 0 }), estadoCobro({ total: 30, pagado: 10 }),
    estadoCobro({ total: 30, pagado: 30 }), estadoCobro({ total: 30, pagado: 35 }),
    estadoCobro({ total: 0, pagado: 0 }), estadoCobro({ total: 30, pagado: 0, status: 'Devuelto' }),
  ];
  ok('ninguna línea inventa Bs.', todos.every(e => !/Bs\./.test(e.texto)));
}

// ── 4. El aviso de la orden ya guardada (que nadie espere otra orden) ───────────────────────
{
  const uno = avisoOrdenGuardada('DEV-0042', 1);
  ok('dice el número de orden', uno.includes('DEV-0042'));
  ok('dice que actualizar NO crea otra', uno.includes('NO se crea otra'));
  ok('un equipo → sin plural', !uno.includes('equipos'));
  // El aviso NO nombra el botón «Actualizar orden»: ese botón solo existe en el último paso y el
  // aviso se ve desde el paso 2 (mandaría a buscar un botón que no está en pantalla).
  ok('no manda a buscar un botón que no está en pantalla', !uno.includes('Actualizar orden'));
  const tres = avisoOrdenGuardada('DEV-0042', 3);
  ok('multi-equipo → cuenta los equipos', tres.includes('(3 equipos)'));
  ok('multi-equipo → mismo número de orden', tres.includes('DEV-0042'));

  ok('equipos fijos: nombra la orden', avisoEquiposFijos('DEV-0042').includes('DEV-0042'));
  ok('equipos fijos: dice que no se agregan ni quitan', /no se pueden agregar ni quitar equipos/.test(avisoEquiposFijos('DEV-0042')));
  ok('equipos fijos: ofrece el camino real', avisoEquiposFijos('DEV-0042').includes('Nuevo Servicio'));
}

// ── 5. Cobrar con cambios sin guardar (en editar se cobra lo GUARDADO; en el alta lo escrito) ─────
{
  eq('mismo monto → sin aviso', avisoMontoSinGuardar(30, 30), null);
  eq('diferencia de centavos → sin aviso (no se molesta)', avisoMontoSinGuardar(30, 30 - TOL / 2), null);
  const aviso = avisoMontoSinGuardar(50, 30);
  ok('monto distinto → avisa', !!aviso);
  ok('el aviso dice el monto que se va a cobrar', !!aviso && aviso.includes('$30.00'));
  ok('el aviso dice lo que escribió el operario', !!aviso && aviso.includes('$50.00'));
  ok('el aviso manda a guardar primero', !!aviso && aviso.includes('Guardá'));
  ok('el aviso es un AVISO, no un bloqueo (devuelve texto, no lanza)',
    typeof avisoMontoSinGuardar(50, 30) === 'string');

  // F79 (2ª vuelta adversarial): en el ALTA el botón GUARDA lo escrito y cobra ESO, así que el aviso
  // de «se cobra el guardado» mentiría. Son dos textos distintos para dos comportamientos distintos.
  eq('alta: mismo monto → sin aviso', avisoMontoPendiente(30, 30), null);
  const pend = avisoMontoPendiente(40, 30);
  ok('alta: monto distinto → avisa', !!pend);
  ok('alta: dice que se GUARDA el monto escrito', !!pend && pend.includes('se guarda $40.00'));
  ok('alta: y que se cobra ESE monto', !!pend && /se cobra ese monto/.test(pend));
  ok('alta: nombra el monto viejo de la orden', !!pend && pend.includes('$30.00'));
  ok('alta: NO manda a guardar primero (lo hace el propio botón)',
    !!pend && !/Guardá el cambio/.test(pend));
  ok('los dos avisos son distintos (no se puede confundir el modo)',
    avisoMontoSinGuardar(40, 30) !== avisoMontoPendiente(40, 30));
}

console.log(`\nwizard_cobro: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallas`);
if (failures > 0) process.exit(1);
