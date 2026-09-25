// Pruebas PURAS del recibo de servicio (Harness F32).
//
// Lo que fija: la línea NUEVA del talón con el acuerdo de pago («ACORDADO: PAGA AHORA / PAGA AL
// RETIRAR») y —más importante— los invariantes que NO se tocan:
//   · el recibo PRINCIPAL (el que firma el cliente) no cambia: nunca dice ACORDADO ni inventa un
//     METODO que no exista;
//   · METODO sigue apareciendo SOLO con pagos REALES registrados;
//   · ninguna línea desborda el ancho del papel (32 chars en 58 mm · 48 en 80 mm).
//
// Uso:  node tools/receipt_acuerdo_test.ts

import { buildServiceReceiptParts } from '../src/lib/utils.ts';
import type { Service, ServicePayment } from '../src/types.ts';

let checks = 0;
let failures = 0;

function ok(what: string, cond: boolean, extra = '') {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}${extra ? `\n   ${extra}` : ''}`); }
}

function eq(what: string, got: unknown, want: unknown) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FALLA · ${what}\n   esperado: ${JSON.stringify(want)}\n   obtenido: ${JSON.stringify(got)}`);
  }
}

const svc = (patch: Partial<Service> = {}) => ({
  id: 1, order_num: 'DEV-0001', date_in: '2026-09-17 09:10', client: 'Ana Pérez', phone: '0412-1234567',
  model: 'Samsung A15', fault: 'Pantalla rota', service_type: 'Cambio pantalla',
  service_types: '["Cambio pantalla"]', amount: 30, payment_method: 'Pago Móvil',
  date_out: null, status: 'Recibido', observations: null, bank_fee_percent: 0, bank_fee_amount: 0,
  net_amount: 30, zelle_reference: null, currency: 'USD', client_ci: 'V-12345678', client_address: null,
  device_checklist: null, client_id: null, paid_amount: 0, technician_id: null, technician: 'Aldri',
  group_id: null, screen_product_id: null, color: 'Negro', printed: 0, discount_amount: 0,
  photo_in_at: null, photo_out_at: null, pay_intent: null, ...patch,
} as unknown as Service);

const pago = (amount: number, method = 'Pago Móvil', currency = 'VES'): ServicePayment => ({
  id: 9, service_id: 1, amount, payment_method: method, bank_fee_percent: 0, bank_fee_amount: 0,
  net_amount: amount, zelle_reference: null, currency, payment_date: '2026-09-17 11:00', notes: null,
});

function lineas(text: string): string[] {
  return text.split('\n').filter(l => l.length > 0);
}

function sinDesbordes(nombre: string, text: string, ancho: number) {
  const largas = lineas(text).filter(l => l.length > ancho);
  ok(`${nombre}: ninguna línea supera ${ancho} chars`, largas.length === 0, largas.join(' | '));
}

for (const width of [58, 80] as const) {
  const ancho = width === 58 ? 32 : 48;
  const etiqueta = `${width}mm`;

  // 1) Acuerdo «paga al retirar», sin pagos: sale SOLO en el talón
  const acordado = buildServiceReceiptParts(svc({ pay_intent: 'al_retirar' }), [], { width });
  ok(`${etiqueta} · el talón dice ACORDADO: PAGA AL RETIRAR`, acordado.stub.includes('ACORDADO: PAGA AL RETIRAR'));
  eq(`${etiqueta} · el recibo principal NO dice ACORDADO`, acordado.main.includes('ACORDADO'), false);
  eq(`${etiqueta} · el recibo principal NO inventa METODO`, acordado.main.includes('METODO'), false);
  sinDesbordes(`${etiqueta} · acuerdo al retirar`, acordado.stub, ancho);
  sinDesbordes(`${etiqueta} · principal`, acordado.main, ancho);

  // 2) Acuerdo «paga ahora»
  const ahora = buildServiceReceiptParts(svc({ pay_intent: 'ahora' }), [], { width });
  ok(`${etiqueta} · el talón dice ACORDADO: PAGA AHORA`, ahora.stub.includes('ACORDADO: PAGA AHORA'));
  eq(`${etiqueta} · sin preguntar el pago no hay línea ACORDADO`, acordado.main.includes('ACORDADO') || buildServiceReceiptParts(svc(), [], { width }).stub.includes('ACORDADO'), false);

  // 3) Con un pago REAL: METODO manda y el acuerdo desaparece (no se repite ni se contradice)
  const pagado = buildServiceReceiptParts(svc({ pay_intent: 'al_retirar', paid_amount: 30 }), [pago(30)], { width });
  ok(`${etiqueta} · con pago real aparece METODO`, pagado.stub.includes('METODO'));
  eq(`${etiqueta} · con pago real NO aparece ACORDADO`, pagado.stub.includes('ACORDADO'), false);
  sinDesbordes(`${etiqueta} · con pago real`, pagado.stub, ancho);

  // 4) Una orden finalizada (Devuelto/Cancelado) nunca anuncia un acuerdo de pago
  const finalizada = buildServiceReceiptParts(svc({ status: 'Devuelto', pay_intent: 'ahora' }), [], { width });
  eq(`${etiqueta} · orden devuelta sin ACORDADO`, finalizada.stub.includes('ACORDADO'), false);
  ok(`${etiqueta} · orden devuelta dice DEVUELTO`, finalizada.stub.includes('DEVUELTO'));

  // 5) El recibo principal sigue intacto en lo esencial
  const base = buildServiceReceiptParts(svc(), [], { width });
  ok(`${etiqueta} · el principal trae ORDEN/CLIENTE/EQUIPO/TOTAL`, ['ORDEN', 'CLIENTE', 'EQUIPO', 'TOTAL'].every(k => base.main.includes(k)));
  ok(`${etiqueta} · el talón trae FIRMA SALIDA`, base.stub.includes('FIRMA SALIDA'));
  sinDesbordes(`${etiqueta} · talón base`, base.stub, ancho);

  // 5b) F49 — EL DESCUENTO SE VE EN LA FACTURA (pedido del dueño: «que se refleje en la factura que
  // se le aplicó un descuento de X monto»). `amount` es lo que el cliente DEBE (ya descontado) y
  // `discount_amount` el descuento: el PRECIO de lista es la suma.
  eq(`${etiqueta} · sin descuento NO se imprime la línea DESCUENTO`, base.main.includes('DESCUENTO'), false);
  eq(`${etiqueta} · sin descuento tampoco se imprime PRECIO`, base.main.includes('PRECIO'), false);
  const conDesc = buildServiceReceiptParts(svc({ amount: 25, discount_amount: 5 }), [], { width });
  ok(`${etiqueta} · con descuento el recibo imprime PRECIO, DESCUENTO y TOTAL`,
    conDesc.main.includes('PRECIO') && conDesc.main.includes('DESCUENTO') && conDesc.main.includes('TOTAL'));
  ok(`${etiqueta} · el PRECIO de lista es el monto + el descuento`,
    conDesc.main.includes('$ 30.00') || conDesc.main.includes('$30.00'), conDesc.main.split('\n').filter(l => /PRECIO/.test(l)).join(''));
  ok(`${etiqueta} · el DESCUENTO va con su monto y en negativo`,
    /DESCUENTO:\s*-\$\s*5\.00/.test(conDesc.main), conDesc.main.split('\n').filter(l => /DESCUENTO/.test(l)).join(''));
  ok(`${etiqueta} · el TOTAL sigue siendo lo que el cliente paga (25)`,
    conDesc.main.split('\n').some(l => /TOTAL/.test(l) && /\$ ?25\.00/.test(l)), conDesc.main.split('\n').filter(l => /TOTAL/.test(l)).join(''));
  ok(`${etiqueta} · el talón también muestra el descuento`, conDesc.stub.includes('DESCUENTO'));
  sinDesbordes(`${etiqueta} · recibo con descuento`, conDesc.main, ancho);
  sinDesbordes(`${etiqueta} · talón con descuento`, conDesc.stub, ancho);
  // Descuento del 100% (cortesía): el cliente no paga nada y la factura lo dice
  const cortesia = buildServiceReceiptParts(svc({ amount: 0, discount_amount: 30 }), [], { width });
  ok(`${etiqueta} · cortesía: PRECIO 30 y TOTAL 0`, cortesia.main.includes('PRECIO') && cortesia.main.split('\n').some(l => /TOTAL/.test(l) && /\$ ?0\.00/.test(l)));
  sinDesbordes(`${etiqueta} · factura de cortesía`, cortesia.main, ancho);

  // 6) F38 — EL SALDO EN LA MONEDA DEL COBRO: si el cliente viene pagando en BOLÍVARES, el comprobante
  // dice lo que le falta EN Bs. (con la tasa del turno) además del $: es el número que el operario le
  // va a pedir en el mostrador. El $ sigue estando (es la deuda real y NO se revalúa).
  const enBs = buildServiceReceiptParts(svc({ amount: 30, paid_amount: 1.34, payment_method: 'Efectivo Bs' }),
    [pago(1000, 'Efectivo Bs', 'VES')], { width, tasaBcv: 748.79 });
  ok(`${etiqueta} · pago en Bs. → el comprobante dice FALTA en Bs.`, enBs.main.includes('FALTA Bs.'));
  // OJO: `includes('FALTA')` sería VACUO (la línea «FALTA Bs.» contiene «FALTA»): se exige el monto
  // EXACTO de la deuda en dólares (30 − 1,34 = 28,66), que es la línea que firma el cliente.
  ok(`${etiqueta} · …y sigue diciendo la deuda real en $ (monto exacto)`, enBs.main.includes('FALTA: $ 28.66'),
    (enBs.main.match(/FALTA:[^\n]*/) ?? [''])[0]);
  ok(`${etiqueta} · …y el talón también`, enBs.stub.includes('FALTA Bs.'));
  // El MONTO impreso tiene que ser EXACTO (redondeado al bolívar, igual que el que se cobra):
  // saldo $28,66 × 748,79 = Bs. 21.460 (no 21.460,32: no existen centavos de bolívar en el mostrador).
  ok(`${etiqueta} · el monto en Bs. es el exacto que se pide`, enBs.main.includes('FALTA Bs.: Bs. 21.460,00'),
    (enBs.main.match(/FALTA Bs\.[^\n]*/) ?? [''])[0]);
  sinDesbordes(`${etiqueta} · comprobante con saldo en Bs.`, enBs.main, ancho);
  sinDesbordes(`${etiqueta} · talón con saldo en Bs.`, enBs.stub, ancho);
  // Sin tasa cargada NO se inventa ninguna equivalencia en bolívares
  const sinTasa = buildServiceReceiptParts(svc({ amount: 30, paid_amount: 1.34, payment_method: 'Efectivo Bs' }),
    [pago(1000, 'Efectivo Bs', 'VES')], { width, tasaBcv: 0 });
  eq(`${etiqueta} · sin tasa NO se imprime FALTA Bs.`, sinTasa.main.includes('FALTA Bs.'), false);
  // Cobrado en dólares: el saldo se pide en $ (no se agrega la línea en Bs.)
  const enUsd = buildServiceReceiptParts(svc({ amount: 30, paid_amount: 10, payment_method: 'Divisas (USD Cash)' }),
    [pago(10, 'Divisas (USD Cash)', 'USD')], { width, tasaBcv: 748.79 });
  eq(`${etiqueta} · cobrado en $ → sin línea FALTA Bs.`, enUsd.main.includes('FALTA Bs.'), false);
  // ALINEACIÓN con la pantalla (`orderBalance`): manda el NETO por moneda, no el bruto. Un abono en
  // Bs. que fue DEVUELTO por completo deja el neto en Bs. en 0 → no se pide el saldo en bolívares
  // (el cliente no viene pagando en Bs.), igual que la tarjeta y el diálogo de abono.
  const devueltoBs = buildServiceReceiptParts(svc({ amount: 30, paid_amount: 0, payment_method: 'Efectivo Bs' }),
    [pago(1000, 'Efectivo Bs', 'VES'), pago(-1000, 'Efectivo Bs', 'VES')], { width, tasaBcv: 748.79 });
  eq(`${etiqueta} · abono en Bs. devuelto por completo → el recibo NO inventa FALTA Bs.`,
    devueltoBs.main.includes('FALTA Bs.'), false);
  ok(`${etiqueta} · …pero sigue diciendo la deuda real en $`, devueltoBs.main.includes('FALTA: $ 30.00'));
  // Y un cobro MIXTO (Bs. + $) tampoco: no hay una sola moneda de cobro (misma regla que la tarjeta)
  const mixto = buildServiceReceiptParts(svc({ amount: 30, paid_amount: 11.34 }),
    [pago(1000, 'Efectivo Bs', 'VES'), pago(10, 'Divisas (USD Cash)', 'USD')], { width, tasaBcv: 748.79 });
  eq(`${etiqueta} · cobros mixtos → sin línea FALTA Bs.`, mixto.main.includes('FALTA Bs.'), false);

  // ── F74 — EL IVA EN EL RECIBO ───────────────────────────────────────────────────────────────
  // Una orden cargada con IVA 16% «agregado»: el monto guardado (34,80) es el TOTAL cobrado, así que
  // la factura desglosa BASE 30,00 + IVA 4,80 = TOTAL 34,80 (y el talón dice lo mismo).
  const conIva = buildServiceReceiptParts(svc({ amount: 34.8, iva_rate: 16, iva_mode: 'agregado' }), [],
    { width, tasaBcv: 748.79 });
  ok(`${etiqueta} · el recibo desglosa la BASE`, conIva.main.includes('BASE: $ 30.00'),
    (conIva.main.match(/BASE[^\n]*/) ?? [''])[0]);
  ok(`${etiqueta} · el recibo dice el IVA con su alícuota`, conIva.main.includes('IVA 16%: $ 4.80'),
    (conIva.main.match(/IVA[^\n]*/) ?? [''])[0]);
  ok(`${etiqueta} · el TOTAL sigue siendo lo que paga el cliente`, conIva.main.includes('TOTAL: $ 34.80'),
    (conIva.main.match(/TOTAL[^\n]*/) ?? [''])[0]);
  ok(`${etiqueta} · el talón también desglosa el IVA`,
    conIva.stub.includes('BASE: $ 30.00') && conIva.stub.includes('IVA 16%: $ 4.80'));
  sinDesbordes(`${etiqueta} · comprobante con IVA`, conIva.main, ancho);
  sinDesbordes(`${etiqueta} · talón con IVA`, conIva.stub, ancho);
  // La suma impresa cierra al centavo (base + IVA = total).
  const baseL = Number((conIva.main.match(/BASE: \$ ([\d.,]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN);
  const ivaL = Number((conIva.main.match(/IVA 16%: \$ ([\d.,]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN);
  const totL = Number((conIva.main.match(/TOTAL: \$ ([\d.,]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN);
  ok(`${etiqueta} · base + IVA = total en el papel (${baseL} + ${ivaL} = ${totL})`,
    Math.abs(baseL + ivaL - totL) < 0.005);
  // Una orden SIN IVA (las viejas, y todas las que se cargan con el switch apagado) no cambia el
  // recibo: no aparece ninguna línea de IVA (nada de «IVA 0%» que confunda al cliente).
  const sinIva = buildServiceReceiptParts(svc({ amount: 30 }), [], { width, tasaBcv: 748.79 });
  eq(`${etiqueta} · sin IVA el recibo no cambia`, /BASE|IVA/.test(sinIva.main), false);
  // La alícuota de la ORDEN manda: una orden cargada al 8% se imprime al 8% aunque hoy sea 16%.
  const ocho = buildServiceReceiptParts(svc({ amount: 32.4, iva_rate: 8, iva_mode: 'agregado' }), [],
    { width, tasaBcv: 748.79 });
  ok(`${etiqueta} · una orden vieja al 8% se imprime al 8%`, ocho.main.includes('IVA 8%: $ 2.40'),
    (ocho.main.match(/IVA[^\n]*/) ?? [''])[0]);
}

console.log(`\nreceipt-acuerdo: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallas`);
if (failures > 0) process.exit(1);
