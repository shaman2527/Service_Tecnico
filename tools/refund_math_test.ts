// Pruebas de las REGLAS DE LA DEVOLUCIÓN (F36) — módulo puro `src/lib/refund-math.ts`.
// Los MISMOS casos están en el test Rust `test_refund_by_currency_net`: la regla tiene que dar el
// mismo número en los dos lados (el backend es el que manda, la UI solo avisa antes).
//
// Uso:  node tools/refund_math_test.ts

import {
  netByCurrency, refundable, refundSuggestion, canRefund, refundCapLabel,
  isCashMethod, incomeByMethod, methodHasIncome, refundMethodDefault, refundMethodProblem, incomeSummary,
} from '../src/lib/refund-math.ts';

let ok = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; } else { fail++; console.log(`FALLA · ${name}\n   esperado: ${w}\n   obtenido: ${g}`); }
};
const ok_ = (name: string, cond: boolean) => eq(name, !!cond, true);

// Movimientos del caso medido: el cliente pagó Bs. 4.050 el día que la tasa estaba en 40,50
// (= $100) y se devolvieron los MISMOS Bs. 4.050 otro día con la tasa en 50.
const pagoBs = { amount: 4050, currency: 'VES' };
const devBs = { amount: -4050, currency: 'VES' };

// ── 1. Neto por moneda ──────────────────────────────────────────────────────────────────────
{
  eq('sin movimientos no hay nada', netByCurrency([]), { USD: 0, VES: 0 });
  eq('null se trata como vacío', netByCurrency(null), { USD: 0, VES: 0 });
  eq('un abono en Bs queda en Bs', netByCurrency([pagoBs]), { USD: 0, VES: 4050 });
  eq('moneda vacía se cuenta como USD', netByCurrency([{ amount: 30, currency: null }]), { USD: 30, VES: 0 });
  eq('Bs y $ no se mezclan', netByCurrency([pagoBs, { amount: 30, currency: 'USD' }]), { USD: 30, VES: 4050 });
  eq('la devolución en Bs resta en Bs', netByCurrency([pagoBs, devBs]), { USD: 0, VES: 0 });
}

// ── 2. Disponible para devolver, POR MONEDA (la regla que reemplaza a la tasa de hoy) ───────
{
  eq('disponible en Bs = lo que entró', refundable([pagoBs], 'VES'), 4050);
  eq('disponible en $ cuando pagó en Bs: NADA (no entraron dólares)', refundable([pagoBs], 'USD'), 0);
  eq('tras devolver todo, disponible 0 (no se devuelve dos veces)', refundable([pagoBs, devBs], 'VES'), 0);
  eq('una devolución PARCIAL deja el resto disponible', refundable([pagoBs, { amount: -1000, currency: 'VES' }], 'VES'), 3050);
  // Nunca negativo: si por datos viejos devolvió de más, el disponible es 0 (no un número raro)
  eq('neto negativo → disponible 0', refundable([{ amount: -100, currency: 'VES' }], 'VES'), 0);
  // Mixto: cada moneda con lo suyo
  const mixto = [{ amount: 60, currency: 'USD' }, { amount: -40, currency: 'USD' }, pagoBs];
  eq('mixto: disponible en $', refundable(mixto, 'USD'), 20);
  eq('mixto: disponible en Bs', refundable(mixto, 'VES'), 4050);
}

// ── 3. «Devolver todo» y validación (tolerancia 0.5 como el backend) ────────────────────────
{
  eq('sugerencia en Bs (entero, como se cobra)', refundSuggestion([pagoBs], 'VES'), 4050);
  eq('sugerencia en $ (2 decimales)', refundSuggestion([{ amount: 30.456, currency: 'USD' }], 'USD'), 30.46);
  eq('sin nada cobrado, sugiere 0', refundSuggestion([], 'VES'), 0);
  ok_('se puede devolver exactamente lo disponible', canRefund([pagoBs], 'VES', 4050));
  ok_('con la tolerancia de 0.5 (redondeo del mostrador)', canRefund([pagoBs], 'VES', 4050.4));
  ok_('un bolívar más se rechaza', !canRefund([pagoBs], 'VES', 4051));
  ok_('no se pueden devolver dólares si no entraron', !canRefund([pagoBs], 'USD', 1));
  ok_('monto 0 no es una devolución', !canRefund([pagoBs], 'VES', 0));
  ok_('tras devolver todo ya no se puede devolver nada', !canRefund([pagoBs, devBs], 'VES', 1));
  eq('el tope se dice en la moneda real (Bs)', refundCapLabel([pagoBs], 'VES'), 'Bs. 4.050,00');
  eq('el tope se dice en la moneda real ($)', refundCapLabel([{ amount: 30, currency: 'USD' }], 'USD'), '$30.00');
}

// ── 4. F42 — ¿POR QUÉ MÉTODO VUELVE LA PLATA? (el bug real de la tienda) ────────────────────
// Caso medido el 2026-09-17: orden de $5 con el formulario en «Punto de Venta (Bs)», cobrada
// $3 en efectivo + Bs. 1.697 por Pago Móvil. El diálogo proponía el del FORMULARIO y la devolución
// quedó en el Punto → el cierre mostraba Punto −Bs. 1.697 y la plata que salió no se veía.
{
  const delCaso = [
    { amount: 3, currency: 'USD', payment_method: 'Divisas (USD Cash)' },
    { amount: 1697, currency: 'VES', payment_method: 'Pago Móvil' },
  ];
  eq('plata por método en Bs: sólo Pago Móvil', incomeByMethod(delCaso, 'VES'), [{ method: 'Pago Móvil', amount: 1697 }]);
  eq('plata por método en $: sólo Divisas', incomeByMethod(delCaso, 'USD'), [{ method: 'Divisas (USD Cash)', amount: 3 }]);
  eq('los métodos con plata se ordenan por monto', incomeByMethod([
    { amount: 100, currency: 'VES', payment_method: 'Efectivo Bs' },
    { amount: 900, currency: 'VES', payment_method: 'Pago Móvil' },
  ], 'VES').map(m => m.method), ['Pago Móvil', 'Efectivo Bs']);
  eq('una devolución NO cuenta como ingreso por ese método', incomeByMethod([...delCaso, { amount: -1697, currency: 'VES', payment_method: 'Pago Móvil' }], 'VES'), []);
  ok_('Pago Móvil sí cobró', methodHasIncome(delCaso, 'Pago Móvil', 'VES'));
  ok_('el Punto NO cobró nada', !methodHasIncome(delCaso, 'Punto de Venta (Bs)', 'VES'));
  ok_('los métodos de cajón se reconocen', isCashMethod('Efectivo Bs') && isCashMethod('Divisas (USD Cash)'));
  ok_('Pago Móvil NO es de cajón', !isCashMethod('Pago Móvil'));

  // El default propone POR DONDE ENTRÓ, no el del formulario
  eq('en Bs propone Pago Móvil (no el Punto del formulario)', refundMethodDefault(delCaso, 'VES', 'Punto de Venta (Bs)'), 'Pago Móvil');
  eq('en $ propone Divisas', refundMethodDefault(delCaso, 'USD', 'Punto de Venta (Bs)'), 'Divisas (USD Cash)');
  eq('sin plata en esa moneda cae al del formulario (no deja el campo vacío)', refundMethodDefault([], 'VES', 'Punto de Venta (Bs)'), 'Punto de Venta (Bs)');
  eq('sin nada y sin fallback usa Divisas', refundMethodDefault([], 'VES', ''), 'Divisas (USD Cash)');

  // Bloqueo: sólo los métodos que no son de cajón y no cobraron
  const problema = refundMethodProblem(delCaso, 'Punto de Venta (Bs)', 'VES');
  ok_('el Punto se bloquea y el mensaje dice por dónde entró', problema.includes('no entró plata') && problema.includes('Pago Móvil'));
  ok_('se sugiere el cajón cuando el método está mal', problema.includes('Efectivo Bs'));
  eq('Pago Móvil (por donde entró) no tiene problema', refundMethodProblem(delCaso, 'Pago Móvil', 'VES'), '');
  eq('el cajón puede pagar la devolución (aviso, no bloqueo)', refundMethodProblem(delCaso, 'Efectivo Bs', 'VES'), '');
  eq('Divisas en $ tampoco se bloquea', refundMethodProblem(delCaso, 'Divisas (USD Cash)', 'USD'), '');
  ok_('Zelle sin cobros en $ se bloquea', refundMethodProblem(delCaso, 'Transferencia Zelle', 'USD').includes('no entró plata'));
  eq('el resumen dice lo que entró, en su moneda', incomeSummary(delCaso, 'VES'), 'Pago Móvil Bs. 1.697,00');
  eq('el resumen en $ también', incomeSummary(delCaso, 'USD'), 'Divisas (USD Cash) $3.00');
  eq('sin ingresos no hay resumen', incomeSummary([], 'VES'), '');
}

console.log(`\nrefund-math: ${ok + fail} comprobaciones · ${ok} OK · ${fail} fallas`);
process.exit(fail ? 1 : 0);
