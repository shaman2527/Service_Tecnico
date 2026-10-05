// Pruebas de `src/lib/payment-math.ts` — LAS REGLAS DE DINERO DE LOS COBROS (Harness F30 + F92).
//
// Historia de estas pruebas:
//  · F30 extrajo las cuentas del diálogo de pago a un módulo puro y fijó una prueba de PARIDAD con el
//    código viejo (que el refactor no cambiara ni un centavo de lo que se guarda).
//  · F92 cambia la regla a propósito: **EL DINERO SON 2 DECIMALES EN LAS DOS MONEDAS** (pedido del
//    dueño: «cuando pagan deja 2 decimales… se acepta solo 2 decimales»; antes un monto en Bs. se
//    redondeaba a bolívares ENTEROS en el cobro y hasta 0,99 Bs. por cobro se perdían, y el abonado se
//    guardaba con 4 decimales dejando un centavo fantasma en la orden).
//
// Por eso la prueba de paridad se conserva SOLO como documentación de lo que se arregló: las funciones
// `viejo*` de abajo son el código de antes y la sección 2 MIDE la diferencia que F92 elimina. La matriz
// completa (sección 1) compara contra la regla NUEVA, que es la que rige.
//
// Uso:  node tools/payment_math_test.ts      (Node ≥ 22.6; Node 26 ejecuta TS nativo)

import {
  convertAmount, finalAmount, suggestAmount, saldoChipValue, quickAmounts,
  puntoCommission, round2, QUICK_USD, QUICK_VES,
} from '../src/lib/payment-math.ts';

type Cur = 'USD' | 'VES';

// ───────────────────── el código VIEJO (pre-F92): lo que se redondeaba mal ─────────────────────
function viejoRedondeoBs(v: number): number { return Math.round(v); }            // Bs. a entero
function viejoConvertTo(value: number, to: Cur, payCur: Cur, tasaBcv: number): number {
  if (tasaBcv <= 0 || to === payCur) return value;
  if (to === 'VES') return viejoRedondeoBs(value * tasaBcv);
  return Math.round((value / tasaBcv) * 100) / 100;
}
function viejoPayAmountFinal(payAmount: number, payCur: Cur, payCurrency: Cur, tasaBcv: number): number {
  return payCurrency === 'VES'
    ? (payCur === 'VES' ? viejoRedondeoBs(payAmount) : tasaBcv > 0 ? viejoRedondeoBs(payAmount * tasaBcv) : 0)
    : (payCur === 'USD' ? Math.round(payAmount * 100) / 100 : tasaBcv > 0 ? Math.round((payAmount / tasaBcv) * 100) / 100 : 0);
}
function viejoSuggestAmount(saldo: number, amount: number, payCur: Cur, tasaBcv: number): number {
  if (saldo <= 0.005) return 0;
  const bruto = Math.min(saldo, amount);
  if (payCur === 'VES') return tasaBcv > 0 ? viejoRedondeoBs(bruto * tasaBcv) : 0;
  return Math.round(bruto * 100) / 100;
}
function viejoSaldoChip(saldoUsd: number, payCur: Cur, tasaBcv: number): number {
  return payCur === 'VES'
    ? (tasaBcv > 0 ? viejoRedondeoBs(Math.max(0, saldoUsd) * tasaBcv) : 0)
    : Math.round(Math.max(0, saldoUsd) * 100) / 100;
}

// ─────────────────────────────────── arnés de prueba ───────────────────────────────────
let checks = 0;
let failures = 0;

function eq(label: string, got: number, want: number) {
  checks++;
  if (got !== want) {
    failures++;
    console.log(`  ✗ ${label}: obtuvo ${got}, esperaba ${want}`);
  }
}
function ok(label: string, cond: boolean) {
  checks++;
  if (!cond) { failures++; console.log(`  ✗ ${label}`); }
}

const TASAS = [0, 40, 748.66, 3035.5];
const MONEDAS: Cur[] = ['USD', 'VES'];
const MONTOS = [0, 0.01, 5, 9.35, 20, 7000, 46659, 100000, 1234567.89];

/** La regla F92, escrita aparte: TODO monto final es un número con 2 decimales. */
const dosDecimales = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * 100) / 100;

// 1) La regla vigente: el monto final SIEMPRE tiene 2 decimales (nunca más, nunca menos de los que da
//    la cuenta) y la conversión de moneda es simétrica en los dos sentidos.
for (const tasa of TASAS) {
  for (const campo of MONEDAS) {
    for (const metodo of MONEDAS) {
      for (const monto of MONTOS) {
        const final = finalAmount(monto, campo, metodo, tasa);
        eq(`final(${monto}, campo ${campo}, método ${metodo}, tasa ${tasa}) = 2 decimales`,
          final, dosDecimales(final));
        // el monto del método en Bs. coincide con la conversión del campo Bs.
        if (metodo === 'VES' && tasa > 0) {
          eq(`final vs convert en Bs. (${monto}, campo ${campo}, tasa ${tasa})`,
            final, dosDecimales(convertAmount(monto, campo, 'VES', tasa)));
        }
      }
      eq(`suggest(${campo}, tasa ${tasa}) = 2 decimales`, suggestAmount(37.777, 60, campo, tasa),
        dosDecimales(suggestAmount(37.777, 60, campo, tasa)));
    }
    eq(`chip saldo(${campo}, tasa ${tasa}) = 2 decimales`, saldoChipValue(37.777, campo, tasa),
      dosDecimales(saldoChipValue(37.777, campo, tasa)));
    for (const destino of MONEDAS) {
      for (const monto of MONTOS) {
        const c = convertAmount(monto, campo, destino, tasa);
        eq(`convert(${monto}, ${campo}→${destino}, tasa ${tasa}) = 2 decimales`, c, dosDecimales(c));
      }
    }
  }
}

// 2) LO QUE F92 ARREGLA (medido contra el código viejo): los bolívares YA NO se redondean a entero.
//    $20 a 748,66 Bs./$ son 14.973,20 Bs.: el código viejo guardaba 14.973 y el cliente perdía 0,20.
eq('F92 · $20 en Bs. conserva los centavos (14.973,20)', finalAmount(20, 'USD', 'VES', 748.66), 14973.2);
eq('F92 · el código viejo los perdía (14.973)', viejoPayAmountFinal(20, 'USD', 'VES', 748.66), 14973);
ok('F92 · y la diferencia era real (0,20 Bs. por cobro)',
  14973.2 - viejoPayAmountFinal(20, 'USD', 'VES', 748.66) > 0.19);
eq('F92 · un monto en Bs. con centavos se guarda tal cual', finalAmount(12345.67, 'VES', 'VES', 748.66), 12345.67);
eq('F92 · el código viejo lo subía a 12.346', viejoPayAmountFinal(12345.67, 'VES', 'VES', 748.66), 12346);
eq('F92 · convertir $ → Bs. conserva centavos', convertAmount(9.35, 'USD', 'VES', 748.66), 6999.97);
eq('F92 · el código viejo daba 7.000', viejoConvertTo(9.35, 'VES', 'USD', 748.66), 7000);
eq('F92 · el chip de saldo en Bs. también', saldoChipValue(9.35, 'VES', 748.66), 6999.97);
eq('F92 · el sugerido en Bs. también', suggestAmount(30, 60, 'VES', 748.66), 22459.8);

// 3) El redondeo es SIMÉTRICO (una devolución de −0,005 va a −0,01, como en el backend):
//    `Math.round(-0.5)` da `-0` y esa asimetría dejaba diferencias de un centavo entre UI y base.
eq('round2 simétrico: 0,005 → 0,01', round2(0.005), 0.01);
eq('round2 simétrico: −0,005 → −0,01', round2(-0.005), -0.01);
eq('round2: 2,345 → 2,35', round2(2.345), 2.35);
eq('round2: −2,345 → −2,35', round2(-2.345), -2.35);
eq('round2: 1,004 → 1,00', round2(1.004), 1);
eq('round2 no toca lo que ya son centavos', round2(13.25), 13.25);
eq('round2 de un valor no finito → 0', round2(Number.POSITIVE_INFINITY), 0);

// 4) Reglas de negocio fijadas a mano (las que documenta AGENTS.md)
const T = 748.66;
eq('Punto Bs. · campo Bs. 7000 → se guardan Bs. 7000', finalAmount(7000, 'VES', 'VES', T), 7000);
eq('Punto Bs. · campo Bs. 7000 → ≈ $9.35', round2(7000 / T), 9.35);
eq('campo $20 · método Bs. → Bs. 14.973,20', finalAmount(20, 'USD', 'VES', T), 14973.2);
eq('campo Bs. 7000 · método $ → $9.35', finalAmount(7000, 'VES', 'USD', T), 9.35);
eq('método $ · campo $ 20 → $20', finalAmount(20, 'USD', 'USD', T), 20);
eq('campo Bs. sin tasa (método $) → 0 (guardado bloqueado)', finalAmount(7000, 'VES', 'USD', 0), 0);
eq('campo $ sin tasa (método Bs.) → 0 (guardado bloqueado)', finalAmount(20, 'USD', 'VES', 0), 0);
eq('sin tasa la conversión NO cambia el valor', convertAmount(7000, 'VES', 'USD', 0), 7000);
eq('todo el saldo: saldo 30 de un total 60 en $', suggestAmount(30, 60, 'USD', T), 30);
eq('todo el saldo: saldo 30 en Bs. (× tasa)', suggestAmount(30, 60, 'VES', T), round2(30 * T));
eq('todo el saldo nunca supera el monto del servicio', suggestAmount(90, 60, 'USD', T), 60);
eq('saldo negativo (excedente) → 0', suggestAmount(-5, 60, 'USD', T), 0);
eq('chip de saldo con excedente → 0', saldoChipValue(-5, 'USD', T), 0);
eq('chip de saldo en Bs. sin tasa → 0', saldoChipValue(30, 'VES', 0), 0);
eq('comisión Punto 3.5% de $100', puntoCommission(100, 3.5).commission, 3.5);
eq('neto del Punto de $100', puntoCommission(100, 3.5).net, 96.5);
eq('comisión 0 → neto = monto', puntoCommission(7000, 0).net, 7000);
// F92: la comisión se redondea a centavos y el neto sale del monto YA redondeado, así
// `neto + comisión = monto` exacto (lo mismo que guarda el backend).
eq('comisión 3,5% de $33,33 = $1,17', puntoCommission(33.33, 3.5).commission, 1.17);
eq('neto + comisión = monto exacto', puntoCommission(33.33, 3.5).net + puntoCommission(33.33, 3.5).commission, 33.33);
ok('comisión y neto siempre con 2 decimales',
  [7.77, 12.34, 33.33, 99.99, 1234.56].every(v => {
    const p = puntoCommission(v, 3.5);
    return p.commission === dosDecimales(p.commission) && p.net === dosDecimales(p.net);
  }));
eq('chips en $ = [5,10,15,20]', quickAmounts('USD').join(','), QUICK_USD.join(','));
eq('chips en Bs. = [5000,10000,15000,20000]', quickAmounts('VES').join(','), QUICK_VES.join(','));

console.log(`\npayment-math: ${checks} comprobaciones · ${checks - failures} OK · ${failures} diferencias`);
if (failures > 0) process.exit(1);
