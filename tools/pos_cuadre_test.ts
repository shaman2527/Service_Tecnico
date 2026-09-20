// Pruebas PURAS de las dos reglas nuevas del POS (F38/F39):
//   · el SALDO de una orden se dice en la moneda en que se cobró   (`src/lib/order-balance.ts`)
//   · el ARQUEO cuadra por MONEDA, no por un número mezclado en $  (`src/lib/cash-closing.ts`)
//
// Uso:  node tools/pos_cuadre_test.ts

import { orderBalance, balanceLabel, SALDO_CERO } from '../src/lib/order-balance.ts';
import { closingDifference, closingLabel, sinContar, puntoDifference, TOL_USD, TOL_BS } from '../src/lib/cash-closing.ts';
// Paridad con el COBRO: el saldo en Bs. que se muestra tiene que ser el que se sugiere cobrar.
import { suggestAmount, saldoChipValue } from '../src/lib/payment-math.ts';

let ok = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) ok++; else { fail++; console.log(`FALLA · ${name}\n   esperado: ${w}\n   obtenido: ${g}`); }
};

const pagoBs = { amount: 1000, currency: 'VES' };
const pagoUsd = { amount: 30, currency: 'USD' };
const devBs = { amount: -1000, currency: 'VES' };

// ══ 1. SALDO POR MONEDA (F38) ═══════════════════════════════════════════════════════════════════
{
  // Orden de $100 pagada en Bs. (Bs. 1.000 al cambio del día = $20 en el abonado que guarda F36).
  // El saldo real es $80 → en Bs. son 80 × 40 = Bs. 3.200 con la tasa del turno.
  const b = orderBalance(100, 20, [pagoBs], 40);
  eq('el saldo en $ es el de la orden (la deuda real)', b.usd, 80);
  eq('la equivalencia usa la tasa del día (lo que va a pagar hoy)', b.bs, 3200);
  eq('cobrado en Bs → el saldo se dice en Bs.', b.principal, 'VES');
  eq('y el texto muestra las DOS monedas', balanceLabel(b), 'Bs. 3.200,00 ($80.00)');

  // Cobrado en dólares: se dice en dólares y no se inventa una equivalencia en el texto
  const bu = orderBalance(100, 30, [pagoUsd], 40);
  eq('cobrado en $ → principal $', bu.principal, 'USD');
  eq('cobrado en $: primero el $, y la equivalencia en Bs. igual (el operario cobra en Bs.)', balanceLabel(bu), '$70.00 (Bs. 2.800,00)');

  // Cobros MIXTOS (Bs. y $): no hay una moneda "del cobro" → se dice en $ (la moneda de la orden)
  const bm = orderBalance(100, 40, [pagoBs, pagoUsd], 40);
  eq('cobros mixtos → principal $', bm.principal, 'USD');
  eq('mixto: primero el $ (no hay una sola moneda de cobro)', balanceLabel(bm), '$60.00 (Bs. 2.400,00)');

  // Sin ningún cobro: saldo = total, en $
  const bs = orderBalance(100, 0, [], 40);
  eq('sin cobros no hay moneda de cobro', bs.cobroEn, null);
  eq('sin cobros: principal $', bs.principal, 'USD');
  eq('sin cobros: el total, en $ y su equivalente', balanceLabel(bs), '$100.00 (Bs. 4.000,00)');

  // Sin tasa: NO se inventa equivalencia
  const bst = orderBalance(100, 20, [pagoBs], 0);
  eq('sin tasa no hay equivalencia', bst.bs, null);
  eq('sin tasa: se avisa', balanceLabel(bst), '$80.00 (falta la tasa BCV)');

  // Saldado / a favor
  eq('saldado: sin saldo', balanceLabel(orderBalance(100, 100, [pagoUsd], 40)), 'Sin saldo');
  eq('saldado por centavos (tolerancia)', orderBalance(100, 100 + SALDO_CERO / 2, [pagoUsd], 40).saldado, true);
  eq('excedente a favor del cliente', balanceLabel(orderBalance(100, 120, [pagoUsd], 40)), 'A favor $20.00');
  eq('excedente marcado', orderBalance(100, 120, [pagoUsd], 40).excedente, true);
  // Cobrado en Bs.: lo que hay que devolverle al cliente se dice en Bs. (con el $ entre paréntesis)
  eq('excedente de un cobro en Bs. se dice en Bs.', balanceLabel(orderBalance(100, 120, [pagoBs], 40)), 'A favor Bs. 800,00 ($20.00)');
  eq('excedente sin tasa: solo el $ (no se inventa equivalencia)', balanceLabel(orderBalance(100, 120, [pagoBs], 0)), 'A favor $20.00');

  // LA DEUDA NO SE REVALÚA: el saldo en $ NO cambia si la tasa se mueve (solo la equivalencia en Bs.)
  const conTasa40 = orderBalance(100, 20, [pagoBs], 40);
  const conTasa60 = orderBalance(100, 20, [pagoBs], 60);
  eq('el saldo en $ no cambia con la tasa', [conTasa40.usd, conTasa60.usd], [80, 80]);
  eq('la equivalencia en Bs. sí (es lo que se cobra hoy)', [conTasa40.bs, conTasa60.bs], [3200, 4800]);

  // Una orden totalmente devuelta en Bs. queda sin saldo del abonado (F36) y el saldo es el total
  const devuelta = orderBalance(100, 0, [pagoBs, devBs], 40);
  eq('devolución total: el saldo vuelve a ser el total', devuelta.usd, 100);
  eq('devolución total: sin plata en la mano el saldo se dice en $ (con su equivalente en Bs.)', [devuelta.principal, balanceLabel(devuelta)], ['USD', '$100.00 (Bs. 4.000,00)']);

  // **PARIDAD CON EL COBRO**: el Bs. que se MUESTRA tiene que ser el que se SUGIERE cobrar
  // (`payment-math.suggestAmount`, que redondea los bolívares a entero). Si no coinciden, el operario
  // lee un número y el sistema cobra otro.
  for (const [saldo, total, tasa] of [[80, 100, 40], [97.33, 100, 748.79], [0.5, 100, 36.5], [33.33, 50, 52.7], [12, 12, 100.4]] as const) {
    const b = orderBalance(total, total - saldo, [pagoBs], tasa);
    eq(`paridad con el cobro (saldo $${saldo} · tasa ${tasa})`, b.bs, suggestAmount(saldo, total, 'VES', tasa));
  }
  // El caso REAL medido en vivo: `paid_amount` viene de convertir Bs. a dólares y NO es redondo
  // ($2,6711 sobre una orden de $100). Si la equivalencia se calcula con el saldo ya redondeado a
  // centavos, la pantalla dice Bs. 72.880,00 y el chip «Todo el saldo» cobra 72.879 → desfase de 1 Bs.
  {
    const paid = 2000 / 748.79;             // lo que el backend guarda al cobrar Bs. 2.000
    const b = orderBalance(100, paid, [pagoBs], 748.79);
    eq('paridad con el saldo NO redondo (el caso real del mostrador)',
      b.bs, suggestAmount(100 - paid, 100, 'VES', 748.79));
    eq('y el chip de «Todo el saldo» da el mismo número', b.bs, saldoChipValue(100 - paid, 'VES', 748.79));
    eq('el saldo en $ que se muestra sigue redondeado a centavos', b.usd, 97.33);
  }
  // Y sin tasa, los dos coinciden en «no hay nada que cobrar en Bs.» (0)
  const sinTasaParidad = orderBalance(100, 80, [pagoBs], 0);
  eq('sin tasa: el saldo no inventa Bs. y el cobro en Bs. tampoco', [sinTasaParidad.bs, suggestAmount(20, 100, 'VES', 0)], [null, 0]);

  // UN SOLO CRITERIO DE «SALDADO» (revisión adversarial F39): con un saldo de centavos (paid_amount se
  // guarda con 4 decimales) el campo se autocompletaba en 0, el chip «Todo el saldo» ofrecía bolívares
  // y el texto decía «Sin saldo»: tres respuestas para el mismo saldo.
  {
    const b = orderBalance(10, 9.996, [pagoBs], 748.79);
    eq('saldo de $0,004: la orden está saldada', b.saldado, true);
    eq('…y el texto lo dice', balanceLabel(b), 'Sin saldo');
    eq('…y no hay Bs. que cobrar (0, igual que suggestAmount)', [b.bs, suggestAmount(0.004, 10, 'VES', 748.79)], [0, 0]);
    eq('…y el chip «Todo el saldo» tampoco ofrece nada', saldoChipValue(0.004, 'VES', 748.79), 0);
    // Un saldo de verdad (por encima de la tolerancia) sigue dando su equivalencia
    const b2 = orderBalance(10, 9.99, [pagoBs], 748.79);
    eq('saldo de $0,01: NO está saldado y la paridad se mantiene',
      [b2.saldado, b2.bs], [false, suggestAmount(0.01, 10, 'VES', 748.79)]);
  }
}

// ══ 2. ARQUEO POR MONEDA (F39) ══════════════════════════════════════════════════════════════════
{
  const base = {
    cash_usd: 0, zelle_total: 0, usd_cash_total: 0, cash_bs: 0, pago_movil_total: 0, transfer_bs_total: 0,
    actual_cash_usd: 0, actual_zelle: 0, actual_cash_bs: 0, actual_pago_movil: 0, actual_transfer_bs: 0,
  };
  // El día esperaba $40 (Divisas) y Bs. 10.000 (Pago Móvil). El cajón tiene exactamente eso.
  const dia = { ...base, usd_cash_total: 40, pago_movil_total: 10000, actual_cash_usd: 40, actual_pago_movil: 10000 };
  const d0 = closingDifference(dia);
  eq('el día cuadrado da 0 en las dos monedas', [d0.usd, d0.bs], [0, 0]);
  eq('y el semáforo dice que cuadra', [d0.cuadrado, closingLabel(d0)], [true, 'Cuadra']);

  // Falta un bolívar en el Pago Móvil → FALLA en Bs. (aunque en $ sea un centavo)
  const faltaBs = { ...dia, actual_pago_movil: 9999 };
  const d1 = closingDifference(faltaBs);
  eq('un bolívar de menos: la diferencia en Bs. es −1', d1.bs, -1);
  eq('NO cuadra', d1.cuadrado, false);
  eq('y dice qué moneda falla y por cuánto', closingLabel(d1), 'faltan Bs. 1,00');
  eq('la diferencia en $ sigue en 0 (el semáforo viejo la habría escondido en la tasa)', d1.usd, 0);

  // Sobran $2 (y los Bs. cuadran) → falla SOLO en dólares
  const sobraUsd = { ...dia, actual_cash_usd: 42 };
  const d2 = closingDifference(sobraUsd);
  eq('sobran $2: diferencia en $', d2.usd, 2);
  eq('los Bs. siguen cuadrando', d2.bs, 0);
  eq('el texto lo dice en dólares', closingLabel(d2), 'sobran $2.00');

  // Las dos monedas fallan a la vez → se informan las DOS (antes el número mezclado las confundía)
  const dos = { ...sobraUsd, actual_pago_movil: 9000 };
  const d3 = closingDifference(dos);
  eq('fallan las dos monedas', d3.fallaEn, ['USD', 'VES']);
  eq('el texto dice las dos', closingLabel(d3), 'sobran $2.00 · faltan Bs. 1.000,00');
  eq('no cuadra', d3.cuadrado, false);

  // Tolerancias: medio dólar y medio bolívar cuadran (lo que se redondea al contar)
  eq('$0,40 de diferencia no ensucia el semáforo', closingDifference({ ...dia, actual_cash_usd: 40.4 }).cuadrado, true);
  eq('$0,60 sí', closingDifference({ ...dia, actual_cash_usd: 40.6 }).cuadrado, false);
  eq('Bs. 0,40 no ensucia el semáforo', closingDifference({ ...dia, actual_pago_movil: 10000.4 }).cuadrado, true);
  eq('las tolerancias son 0,5 en las dos monedas', [TOL_USD, TOL_BS], [0.5, 0.5]);

  // Los esperados salen de las columnas GUARDADAS del cierre: un cierre viejo se lee igual
  const guardado = { ...dia, cash_usd: 10, cash_bs: 500, zelle_total: 30, usd_cash_total: 0, transfer_bs_total: 9500, actual_cash_usd: 10, actual_zelle: 30, actual_cash_bs: 500, actual_transfer_bs: 9500 };
  const d4 = closingDifference(guardado);
  eq('esperados por método del cierre guardado', [d4.usd, d4.bs], [0, 0]);

  // Punto: se liquida aparte y también por moneda
  const p = puntoDifference(100, 96.5, 5000, 5000);
  eq('Punto $: cobró 100 y liquidó 96,50 (comisión 3,5%) → −3,50', p.usd, -3.5);
  eq('Punto Bs. cuadrado', p.bs, 0);
  eq('el punto del día cuadra en Bs. y falla en $ por la comisión no liquidada', [p.cuadrado, p.fallaEn], [false, ['USD']]);
  // El mismo número que calcula el diálogo de liquidación (una sola implementación de la regla)
  eq('la liquidación del Punto da el mismo número que el diálogo', puntoDifference(0, 210, 0, 39500).bs, 39500);
  eq('una liquidación en la moneda que no se cobró igual se juzga por moneda',
    puntoDifference(0, 0, 5000, 4999).fallaEn, ['VES']);

  // NADIE CONTÓ EL CAJÓN (revisión adversarial F39): `actual_*` en 0 con un esperado que no lo está.
  // La primera versión ESCONDÍA la diferencia («sin arqueo») y eso tapaba un descuadre real: cerrar el
  // día con las dos casillas en 0 (o con los totales sin poder leerse) guardaba un cierre que dice que
  // no hay nada en el cajón. Ahora la diferencia se muestra SIEMPRE y esto solo AGREGA la marca.
  const sinContarCaso = { ...base, usd_cash_total: 40, pago_movil_total: 10000 };
  eq('un cierre con el arqueo en 0 y un esperado grande está «sin contar»', sinContar(sinContarCaso), true);
  eq('y su diferencia se muestra igual (falta todo el cajón: no se esconde)',
    [closingDifference(sinContarCaso).usd, closingDifference(sinContarCaso).bs], [-40, -10000]);
  eq('un cierre con arqueo NO está «sin contar»', sinContar(dia), false);
  eq('un día vacío (esperado 0 y contado 0) está cuadrado, no «sin contar»', sinContar(base), false);
  eq('y da diferencia 0 en las dos monedas', [closingDifference(base).usd, closingDifference(base).bs], [0, 0]);
  eq('contar solo una moneda ya es arqueo (no está «sin contar»)', sinContar({ ...sinContarCaso, actual_cash_usd: 40 }), false);
  eq('un día que esperaba solo Bs. y se cerró en 0 también queda «sin contar»', sinContar({ ...base, cash_bs: 500 }), true);
}

console.log(`\npos-cuadre: ${ok + fail} comprobaciones · ${ok} OK · ${fail} fallas`);
process.exit(fail ? 1 : 0);
