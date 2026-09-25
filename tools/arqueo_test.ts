// Pruebas PURAS del ARQUEO DEL CAJÓN (F69, `src/lib/drawer.ts`) — el hallazgo A1 de la auditoría de
// entrega: el cierre pedía contar el cajón contra un «esperado» que no incluía el fondo de caja ni los
// gastos pagados del cajón, y precargaba los cobros digitales con el esperado (su diferencia daba 0
// SIEMPRE). Acá se fijan las tres reglas: el desglose, la devolución que NO se resta dos veces y el
// conteo que nadie puede dar por hecho.
//
// Uso:  node tools/arqueo_test.ts

import {
  desgloseCajon, lineasDelArqueo, lineasSinConfirmar, faltaConfirmar, diferenciaLinea,
  valorParaCerrar, formatoMoneda, esDeCajon, AJUSTE_CERO,
  type EsperadoDelDia, type AjusteCajon, type LineaArqueo,
} from '../src/lib/drawer.ts';
// El arqueo del CIERRE GUARDADO (lista de Cierres) tiene que llevar el mismo ajuste del cajón.
import { closingDifference } from '../src/lib/cash-closing.ts';

let ok = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) ok++; else { fail++; console.log(`FALLA · ${name}\n   esperado: ${w}\n   obtenido: ${g}`); }
};

const dia = (p: Partial<EsperadoDelDia> = {}): EsperadoDelDia => ({
  cash_usd: 0, usd_cash_total: 0, cash_bs: 0, zelle_total: 0, pago_movil_total: 0,
  transfer_bs_total: 0, pos_charged_usd: 0, pos_charged_bs: 0, ...p,
});

const ajuste = (p: Partial<AjusteCajon> = {}): AjusteCajon => ({ ...AJUSTE_CERO, ...p });

// ══ 1. EL DESGLOSE DEL CAJÓN (fondo y gastos) ═══════════════════════════════════════════════════
{
  // Día con $200 cobrados en divisas, $50 de fondo, un gasto de $30 pagado DEL cajón y Bs. 4.000 de
  // gastos pagados del cajón. Lo que tiene que haber: 200 + 50 − 30 = $220, y Bs. (lo cobrado) − 4.000.
  const d = desgloseCajon(dia({ cash_usd: 120, usd_cash_total: 80, cash_bs: 5000 }),
    ajuste({ fondo_usd: 50, gastos_usd: 30, gastos_bs: 4000 }));
  eq('el esperado en divisas suma el fondo y resta los gastos del cajón', d.esperado_usd, 220);
  eq('el esperado en bolívares resta los gastos pagados del cajón', d.esperado_bs, 1000);
  eq('el desglose dice las líneas en orden de lectura (cobrado, fondo, gastos)',
    d.lineas.map(l => [l.etiqueta, l.monto]), [
      ['Cobrado en efectivo ($)', 200], ['Fondo de caja', 50],
      ['Gastos pagados del cajón ($)', -30], ['Gastos pagados del cajón (Bs.)', -4000],
    ]);
  // Un día sin gastos en Bs. no dibuja esa línea (no se muestran ceros que nadie contó)
  eq('sin gastos en bolívares la línea no se dibuja',
    desgloseCajon(dia({ cash_usd: 10 }), ajuste({ gastos_usd: 1 })).lineas.length, 3);
  eq('un día sin fondo y sin gastos espera EXACTAMENTE lo cobrado', desgloseCajon(dia({ cash_usd: 200 }), AJUSTE_CERO).esperado_usd, 200);

  // El fondo de caja es lo que hacía «sobrar» todos los días si no se sumaba
  eq('sin el fondo la caja sobraría: por eso se suma', desgloseCajon(dia({ cash_usd: 0 }), ajuste({ fondo_usd: 100 })).esperado_usd, 100);

  // …y el gasto sin método declarado NO se descuenta (nunca se inventa de qué cajón salió): el desglose
  // no lo resta y el aviso vive en `sin_metodo`
  const sinMetodo = desgloseCajon(dia({ cash_usd: 100 }), ajuste({ sin_metodo: 2 }));
  eq('un gasto sin método declarado no baja el esperado', sinMetodo.esperado_usd, 100);
  eq('…pero el desglose no inventa ninguna línea por él', sinMetodo.lineas.length, 3);
}

// ══ 2. LA DEVOLUCIÓN NO SE RESTA DOS VECES (el bug que cazó el test Rust) ════════════════════════
{
  // El caso exacto: una orden de $50 cobrada en divisas y devuelta entera del cajón. El neto por método
  // YA viene en 0 (`cash_usd + usd_cash_total = 0`), así que el esperado del cajón es 0. Si además se
  // restaran las devoluciones daría −50 y un día perfecto cerraría «faltando $50».
  const d = desgloseCajon(dia({ cash_usd: 0, usd_cash_total: 0 }), ajuste({ devoluciones_usd: 50 }));
  eq('una devolución total deja el cajón esperando 0, no −50', d.esperado_usd, 0);
  eq('lo devuelto se INFORMA aparte (para que el operario entienda por qué cobró y no hay plata)', d.devuelto_usd, 50);

  // Devolución en bolívares: el neto del día también la trae adentro
  const db = desgloseCajon(dia({ cash_bs: 0 }), ajuste({ devoluciones_bs: 810 }));
  eq('devolución en Bs. total: el cajón espera Bs. 0', db.esperado_bs, 0);
  eq('y se informa lo devuelto en Bs.', db.devuelto_bs, 810);
}

// ══ 3. QUÉ LÍNEAS PIDE EL ARQUEO ════════════════════════════════════════════════════════════════
{
  // Día con TODO: pide las 7 líneas (2 del cajón + Punto $/Bs + Zelle + Pago Móvil + Transf Bs)
  const completo = lineasDelArqueo(dia({
    cash_usd: 100, cash_bs: 4000, pos_charged_usd: 20, pos_charged_bs: 8000,
    zelle_total: 40, pago_movil_total: 3000, transfer_bs_total: 1500,
  }), desgloseCajon(dia({ cash_usd: 100, cash_bs: 4000 }), AJUSTE_CERO));
  eq('un día con todos los métodos pide las 7 líneas', completo.length, 7);
  eq('las del cajón se marcan como «en cajón» y las demás no',
    completo.filter(l => l.enCajon).map(l => l.clave), ['usd', 'bs']);
  eq('cada línea trae su moneda (el semáforo tiene que juzgar en la suya)',
    completo.map(l => `${l.clave}:${l.moneda}`),
    ['usd:USD', 'bs:VES', 'pos_usd:USD', 'pos_bs:VES', 'zelle:USD', 'pago_movil:VES', 'trans_bs:VES']);

  // Un día que sólo cobró en efectivo NO pide verificar bancos (no se pide lo que no hay)…
  const soloEfectivo = lineasDelArqueo(dia({ cash_usd: 30, cash_bs: 100 }), desgloseCajon(dia({ cash_usd: 30, cash_bs: 100 }), AJUSTE_CERO));
  eq('un día sólo de efectivo pide 2 líneas', soloEfectivo.map(l => l.clave), ['usd', 'bs']);

  // …pero el CAJÓN se cuenta SIEMPRE, en las dos monedas, aunque el esperado sea 0: si en el cajón
  // hay plata que el día no explica, la diferencia tiene que verse (y el fondo de Bs. no se declara).
  const vacio = lineasDelArqueo(dia(), desgloseCajon(dia(), AJUSTE_CERO));
  eq('un día sin movimientos igual pide contar el cajón en las dos monedas', vacio.map(l => l.clave), ['usd', 'bs']);
  eq('y las dos líneas esperan 0 (el operario pone lo que ve)', vacio.map(l => l.monto), [0, 0]);

  // El fondo de caja hace que haya que contar aunque no se haya cobrado nada (la plata está en el cajón)
  const conFondo = lineasDelArqueo(dia(), desgloseCajon(dia(), ajuste({ fondo_usd: 50 })));
  eq('con fondo de caja el esperado son los $50 del fondo', conFondo[0].monto, 50);

  // F69 (bloqueante de la revisión): un PUNTO EN NEGATIVO (una devolución anotada por Punto) también
  // es una línea que hay que confirmar — si no se dibujara, el cierre quedaría imposible.
  const puntoNegativo = lineasDelArqueo(dia({ pos_charged_bs: -1697 }), desgloseCajon(dia(), AJUSTE_CERO));
  eq('un Punto negativo pide su confirmación (no se esconde)', puntoNegativo.map(l => l.clave), ['usd', 'bs', 'pos_bs']);
  eq('y el esperado es el número negativo real', puntoNegativo[2].monto, -1697);
}

// ══ 4. NADIE DA UN NÚMERO POR HECHO (la segunda mitad del hallazgo A1) ═══════════════════════════
{
  const esperado = dia({ zelle_total: 40, pago_movil_total: 3000, cash_usd: 100 });
  const lineas = lineasDelArqueo(esperado, desgloseCajon(esperado, AJUSTE_CERO));
  eq('sin confirmar nada, falta todo (incluido el cajón en las dos monedas)',
    lineasSinConfirmar(lineas, {}).map(l => l.clave), ['usd', 'bs', 'zelle', 'pago_movil']);
  eq('el mensaje nombra lo que falta, uno por uno', faltaConfirmar(lineasSinConfirmar(lineas, {})),
    'Falta contar/verificar: Divisas contadas ($), Efectivo en bolívares contado (Bs.), Zelle verificado en el banco ($) y Pago Móvil verificado (Bs.).');

  // Al confirmar el cajón pero no el banco, sigue faltando el banco: el cierre NO se puede guardar con
  // los digitales «porque el sistema lo dice» (era el bug: su diferencia daba 0 siempre)
  eq('confirmar el cajón no confirma el banco',
    lineasSinConfirmar(lineas, { usd: true, bs: true }).map(l => l.clave), ['zelle', 'pago_movil']);
  eq('con todo confirmado no falta nada',
    lineasSinConfirmar(lineas, { usd: true, bs: true, zelle: true, pago_movil: true }).length, 0);
  eq('sin nada que falta no hay mensaje', faltaConfirmar([]), '');
  eq('un solo faltante se dice en singular', faltaConfirmar([lineas[0]]), 'Falta contar/verificar: Divisas contadas ($).');
}

// ══ 5. LA DIFERENCIA DE CADA LÍNEA, EN SU MONEDA Y CON SU TOLERANCIA ════════════════════════════
{
  const lineaUsd: LineaArqueo = { clave: 'usd', etiqueta: 'x', detalle: '', monto: 100, moneda: 'USD', enCajon: true };
  const lineaBs: LineaArqueo = { clave: 'bs', etiqueta: 'x', detalle: '', monto: 4000, moneda: 'VES', enCajon: true };

  eq('contado igual al esperado → cuadrado', diferenciaLinea(lineaUsd, 100).estado, 'cuadrado');
  eq('medio dólar de redondeo al contar NO es descuadre', diferenciaLinea(lineaUsd, 100.4).ok, true);
  eq('$0,60 de más → sobra', diferenciaLinea(lineaUsd, 100.6), { dif: 0.6, ok: false, estado: 'sobra', texto: 'sobran $0.60' });
  eq('$5 de menos → falta', diferenciaLinea(lineaUsd, 95), { dif: -5, ok: false, estado: 'falta', texto: 'faltan $5.00' });
  eq('en bolívares la tolerancia es del bolívar, no del dólar', diferenciaLinea(lineaBs, 4000.4).ok, true);
  eq('y el texto va en bolívares con miles', diferenciaLinea(lineaBs, 3000).texto, 'faltan Bs. 1.000,00');

  // SIN CONTAR no es 0: un campo vacío no puede leerse como «no hay nada en el cajón» (eso era lo que
  // hacía que un cierre sin arqueo pareciera «faltó todo el cajón»)
  eq('sin contar la línea no se inventa un número', diferenciaLinea(lineaUsd, null), { dif: 0, ok: false, estado: 'sin_contar', texto: 'Sin contar' });
  eq('y sin contar NO se puede cerrar (no está «cuadrado»)', diferenciaLinea(lineaUsd, null).ok, false);

  // Lo que se manda al backend: lo contado. Nunca el esperado «porque sí».
  eq('se manda lo que se contó', valorParaCerrar(lineaUsd, 95), 95);
  eq('una línea sin nada que contar manda 0 (la verdad: no había nada)', valorParaCerrar({ ...lineaUsd, monto: 0 }, null), 0);
  eq('una línea con esperado y sin contar manda 0, no el esperado (así el descuadre SE VE)', valorParaCerrar(lineaUsd, null), 0);

  eq('el signo va antes de la moneda', formatoMoneda(-1000, 'VES'), '-Bs. 1.000,00');
  eq('en dólares', formatoMoneda(-2, 'USD'), '-$2.00');
}

// ══ 6. PARIDAD CON EL BACKEND (el MISMO fixture del test Rust) ══════════════════════════════════
{
  // Estos números son el escenario del test Rust `test_arqueo_del_cajon_con_fondo_y_gastos` (db.rs):
  // fondo de caja $50, $100 cobrados en divisas y Bs. 4.000 en efectivo, un gasto de $20 y otro de
  // Bs. 500 pagados DEL cajón, y un cierre con $130 / Bs. 3.500 que tiene que dar diferencia 0.
  // No es una tautología: el fixture viene del OTRO lenguaje; si la fórmula de `close_day` cambia, el
  // cierre de acá deja de cuadrar (y la prueba en vivo compara además pantalla contra backend).
  const e = dia({ cash_usd: 0, usd_cash_total: 100, cash_bs: 4000 });
  const a = ajuste({ fondo_usd: 50, gastos_usd: 20, gastos_bs: 500 });
  const d = desgloseCajon(e, a);
  eq('fixture del backend: el cajón espera $130 en divisas (100 + 50 − 20)', d.esperado_usd, 130);
  eq('fixture del backend: el cajón espera Bs. 3.500 (4.000 − 500)', d.esperado_bs, 3500);
  // El AJUSTE que el cierre guarda en `drawer_adjust_usd/_bs` = las líneas del desglose menos lo
  // cobrado del día (USD: fondo − gastos; Bs: − gastos del cajón).
  const cobrado = d.lineas.find(l => l.etiqueta === 'Cobrado en efectivo ($)');
  const ajusteUsd = d.lineas.filter(l => l.moneda === 'USD' && l !== cobrado).reduce((s, l) => s + l.monto, 0);
  const ajusteBs = d.lineas.filter(l => l.moneda === 'VES').reduce((s, l) => s + l.monto, 0);
  eq('fixture del backend: el ajuste guardado es fondo − gastos = $30 y −Bs. 500', [ajusteUsd, ajusteBs], [30, -500]);
  const cierre = closingDifference({
    cash_usd: 0, usd_cash_total: 100, cash_bs: 4000, zelle_total: 0, pago_movil_total: 0,
    transfer_bs_total: 0, actual_cash_usd: 130, actual_zelle: 0, actual_cash_bs: 3500,
    actual_pago_movil: 0, actual_transfer_bs: 0, drawer_adjust_usd: 30, drawer_adjust_bs: -500,
  });
  eq('y con esos conteos el cierre cuadra en las dos monedas', [cierre.usd, cierre.bs], [0, 0]);
  eq('un esperado con centavos se redondea (es plata que se cuenta)',
    desgloseCajon(dia({ cash_usd: 0.1, usd_cash_total: 0.2 }), AJUSTE_CERO).esperado_usd, 0.3);
}

// ══ 7. LA LISTA DE CIERRES GUARDADOS TAMBIÉN LLEVA EL AJUSTE ════════════════════════════════════
{
  // Un cierre guardado compara el efectivo CONTADO contra las columnas del día. Si el día tuvo fondo
  // de caja o un gasto pagado del cajón, ese ajuste vive en `drawer_adjust_usd/_bs`: sin sumarlo, la
  // lista mostraba un descuadre inventado en un día que se había cerrado perfecto.
  const base = {
    cash_usd: 100, usd_cash_total: 0, cash_bs: 4000, zelle_total: 0, pago_movil_total: 0,
    transfer_bs_total: 0, actual_cash_usd: 140, actual_zelle: 0, actual_cash_bs: 3500,
    actual_pago_movil: 0, actual_transfer_bs: 0,
  };
  // Fondo $50 y gasto de $10 del cajón → se esperaban $140; Bs. 4.000 − 500 de gasto = 3.500
  const conAjuste = closingDifference({ ...base, drawer_adjust_usd: 40, drawer_adjust_bs: -500 });
  eq('el cierre guardado con fondo/gastos cuadra (no inventa descuadre)', conAjuste.cuadrado, true);
  eq('y las dos monedas dan 0', [conAjuste.usd, conAjuste.bs], [0, 0]);

  // Sin el ajuste (como leía la lista antes de F69) el MISMO día perfecto muestra un descuadre
  // inventado: es el bug que este campo cierra.
  const sinAjuste = closingDifference(base);
  eq('sin el ajuste, el mismo cierre perfecto mostraba descuadre en las dos monedas',
    [sinAjuste.usd, sinAjuste.bs, sinAjuste.cuadrado], [40, -500, false]);

  eq('sólo los métodos de cajón pueden bajar el efectivo esperado', [esDeCajon('Divisas (USD Cash)'), esDeCajon('Efectivo Bs'), esDeCajon('Pago Móvil'), esDeCajon('Transferencia Zelle'), esDeCajon('')],
    [true, true, false, false, false]);
}

console.log(`\n${ok}/${ok + fail} pruebas del arqueo del cajón`);
if (fail > 0) process.exit(1);
