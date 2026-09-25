// Pruebas PURAS de las reglas de ANULACIÓN DE UNA VENTA (F70, `src/lib/void-sale.ts`).
//
// El bloqueante A3 de la auditoría de entrega: una venta mal tecleada quedaba en la caja para siempre
// y una pantalla devuelta no volvía al stock. El backend hace el reverso (probado en Rust); acá se fija
// lo que la PANTALLA tiene que decidir: motivo obligatorio, impacto con números, fila anulada visible y
// KPIs que no cuentan lo anulado.
//
// Uso:  node tools/void_sale_test.ts

import {
  impactoAnulacion, motivoOk, estadoFila, totalesVigentes, monedaDeVenta, montoDeVenta, diaDeVenta,
  type ImpactoAnulacion,
} from '../src/lib/void-sale.ts';

let ok = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) ok++; else { fail++; console.log(`FALLA · ${name}\n   esperado: ${w}\n   obtenido: ${g}`); }
};
const si = (name: string, cond: boolean, detalle = '') => {
  if (cond) ok++; else { fail++; console.log(`FALLA · ${name}${detalle ? `\n   ${detalle}` : ''}`); }
};

const venta = (p: Record<string, unknown> = {}) => ({
  date: '2026-09-23 10:15:00', total: 25, currency: 'USD', payment_method: 'Divisas (USD Cash)',
  product_id: 7, quantity: 1, voided_at: null, void_reason: null, product_name: 'Pantalla A15',
  ...p,
});

// ── 1. EL IMPACTO SE DICE CON NÚMEROS ──────────────────────────────────────────────────────────
{
  const i = impactoAnulacion(venta());
  eq('una venta normal se puede anular', i.puede, true);
  si('dice de qué CAJA sale la plata (el día)', i.texto.includes('2026-09-23'), i.texto);
  si('dice el MONTO en la moneda del cobro', i.texto.includes('$25.00'), i.texto);
  si('dice el MÉTODO', i.texto.includes('Divisas (USD Cash)'), i.texto);
  si('dice cuántas unidades vuelven al stock', i.texto.includes('Vuelven 1 unidad de «Pantalla A15» al stock'), i.texto);
  si('y avisa que la venta NO se borra', /NO se borra/i.test(i.texto), i.texto);

  // Una venta de 3 unidades lo dice en plural
  const tres = impactoAnulacion(venta({ quantity: 3 }));
  si('plural correcto con varias unidades', tres.texto.includes('Vuelven 3 unidades'), tres.texto);

  // Una venta sin producto del catálogo NO promete stock que no vuelve
  const sinProducto = impactoAnulacion(venta({ product_id: null, product_name: null }));
  si('sin producto del catálogo no promete stock', /no descontó stock/i.test(sinProducto.texto), sinProducto.texto);
  si('y no dice «Vuelven»', !/Vuelven/i.test(sinProducto.texto), sinProducto.texto);

  // En bolívares el monto se dice en bolívares
  const bs = impactoAnulacion(venta({ currency: 'VES', total: 21337, payment_method: 'Pago Móvil' }));
  si('una venta en Bs. se dice en Bs.', bs.texto.includes('Bs. 21.337,00'), bs.texto);
  si('y con su método', bs.texto.includes('Pago Móvil'), bs.texto);

  // Una venta ya anulada NO se puede volver a anular
  const ya = impactoAnulacion(venta({ voided_at: '2026-09-23 11:00:00', void_reason: 'mal tecleada' }));
  eq('una venta anulada no se puede anular otra vez', ya.puede, false);
  si('y lo dice', /ya está anulada/i.test(ya.motivo ?? ''), JSON.stringify(ya));

  // El tipo del impacto es el que la UI espera (puede/motivo/texto)
  const claves = Object.keys(i).sort();
  eq('el impacto trae puede + texto', claves.includes('puede') && claves.includes('texto'), true);
  const _tipo: ImpactoAnulacion = i;   // (chequeo de tipos en compilación)
  void _tipo;
}

// ── 2. EL MOTIVO ES OBLIGATORIO ───────────────────────────────────────────────────────────────
{
  eq('sin motivo no se puede', motivoOk('').ok, false);
  eq('con espacios tampoco', motivoOk('   ').ok, false);
  si('y el error dice qué escribir', /por qué se anula/i.test(motivoOk('').error ?? ''), String(motivoOk('').error));
  eq('con un motivo real sí', motivoOk('precio mal tecleado').ok, true);
}

// ── 3. LA FILA ANULADA SE VE COMO TAL (nunca desaparece) ──────────────────────────────────────
{
  eq('una venta normal no está anulada', estadoFila({ voided_at: null, void_reason: null }), { anulada: false, etiqueta: '', detalle: '' });
  const f = estadoFila({ voided_at: '2026-09-23 11:00:00', void_reason: 'precio mal tecleado' });
  eq('la anulada lleva su etiqueta', f.anulada, true);
  eq('y su motivo en el detalle', f.detalle, 'Anulada: precio mal tecleado');
  eq('sin motivo escrito igual se marca', estadoFila({ voided_at: '2026-09-23 11:00:00', void_reason: null }).detalle, 'Anulada');
}

// ── 4. LOS KPIs NO CUENTAN LO ANULADO ─────────────────────────────────────────────────────────
{
  const lista = [
    { total: 25, currency: 'USD', quantity: 1, voided_at: null },
    { total: 10, currency: 'USD', quantity: 2, voided_at: '2026-09-23 11:00:00' },
    { total: 21337, currency: 'VES', quantity: 1, voided_at: null },
  ];
  const t = totalesVigentes(lista);
  eq('cuenta sólo las vigentes', t.count, 2);
  eq('informa cuántas se anularon', t.anuladas, 1);
  eq('las unidades también son las vigentes', t.unidades, 2);
  eq('el total en $ no incluye la anulada', t.usd, 25);
  eq('y el de Bs. sí suma la vigente en Bs.', t.bs, 21337);

  // Todo anulado: la pantalla queda en cero (no en el monto anulado)
  const todo = totalesVigentes([{ total: 25, currency: 'USD', quantity: 1, voided_at: '2026-09-23 11:00:00' }]);
  eq('con todo anulado el total es 0 y se ve el conteo de anuladas', [todo.usd, todo.count, todo.anuladas], [0, 0, 1]);
}

// ── 5. MONEDA Y DÍA DE LA VENTA ───────────────────────────────────────────────────────────────
{
  eq('una venta sin moneda se trata en dólares', monedaDeVenta({ currency: null }), 'USD');
  eq('una venta en Bs.', monedaDeVenta({ currency: 'VES' }), 'VES');
  eq('el monto en Bs. usa el formato de bolívares', montoDeVenta({ total: 1500.5, currency: 'VES' }), 'Bs. 1.500,50');
  eq('el monto en $ usa dos decimales', montoDeVenta({ total: 25, currency: 'USD' }), '$25.00');
  eq('el día de la caja sale del timestamp', diaDeVenta({ date: '2026-09-23 10:15:00' }), '2026-09-23');
  eq('y con sólo la fecha también', diaDeVenta({ date: '2026-09-23' }), '2026-09-23');
  eq('una venta sin fecha no rompe', diaDeVenta({ date: null }), '');
}

console.log(`\n${ok}/${ok + fail} pruebas de la anulación de ventas`);
if (fail > 0) process.exit(1);
