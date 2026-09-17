// Parity test de `src/lib/payment-math.ts` (Harness F30, AC-5).
//
// Las funciones de referencia de abajo son COPIADAS VERBATIM de `PaymentDialog.tsx`
// tal como estaban ANTES de F30 (líneas 46-63, 75-82, 141-143 y 269). El test exige
// que el módulo compartido devuelva EXACTAMENTE lo mismo en toda la matriz, para que
// extraer las reglas de dinero no cambie ni un centavo de lo que se guarda.
//
// Uso:  node tools/payment_math_test.ts      (Node ≥ 22.6; Node 26 ejecuta TS nativo)

import {
  convertAmount, finalAmount, suggestAmount, saldoChipValue, quickAmounts,
  puntoCommission, round2, QUICK_USD, QUICK_VES,
} from '../src/lib/payment-math.ts';

type Cur = 'USD' | 'VES';

// ───────────────────────── referencia (código VIEJO de PaymentDialog) ─────────────────────────
function oldConvertTo(value: number, to: Cur, payCur: Cur, tasaBcv: number): number {
  if (tasaBcv <= 0 || to === payCur) return value;
  if (to === 'VES') return Math.round(value * tasaBcv);
  return Math.round((value / tasaBcv) * 100) / 100;
}

function oldPayAmountFinal(payAmount: number, payCur: Cur, payCurrency: Cur, tasaBcv: number): number {
  return payCurrency === 'VES'
    ? (payCur === 'VES' ? Math.round(payAmount) : tasaBcv > 0 ? Math.round(payAmount * tasaBcv) : 0)
    : (payCur === 'USD' ? Math.round(payAmount * 100) / 100 : tasaBcv > 0 ? Math.round((payAmount / tasaBcv) * 100) / 100 : 0);
}

function oldSuggestAmount(saldo: number, amount: number, payCur: Cur, tasaBcv: number): number {
  if (saldo <= 0.005) return 0;
  const bruto = Math.min(saldo, amount);
  if (payCur === 'VES') return tasaBcv > 0 ? Math.round(bruto * tasaBcv) : 0;
  return Math.round(bruto * 100) / 100;
}

function oldSaldoChip(saldoUsd: number, payCur: Cur, tasaBcv: number): number {
  return payCur === 'VES'
    ? (tasaBcv > 0 ? Math.round(Math.max(0, saldoUsd) * tasaBcv) : 0)
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

const TASAS = [0, 40, 748.66, 3035.5];
const MONEDAS: Cur[] = ['USD', 'VES'];
const MONTOS = [0, 0.01, 5, 9.35, 20, 7000, 46659, 100000, 1234567.89];

// 1) Paridad exacta con el código viejo, en toda la matriz
for (const tasa of TASAS) {
  for (const campo of MONEDAS) {
    for (const metodo of MONEDAS) {
      for (const monto of MONTOS) {
        eq(`final(${monto}, campo ${campo}, método ${metodo}, tasa ${tasa})`,
          finalAmount(monto, campo, metodo, tasa),
          oldPayAmountFinal(monto, campo, metodo, tasa));
        eq(`suggest(${monto}, campo ${campo}, tasa ${tasa})`,
          suggestAmount(monto, 60, campo, tasa),
          oldSuggestAmount(monto, 60, campo, tasa));
      }
      for (const monto of MONTOS) {
        eq(`chip saldo(${monto}, campo ${campo}, tasa ${tasa})`,
          saldoChipValue(monto, campo, tasa),
          oldSaldoChip(monto, campo, tasa));
      }
    }
    for (const destino of MONEDAS) {
      for (const monto of MONTOS) {
        eq(`convert(${monto}, ${campo}→${destino}, tasa ${tasa})`,
          convertAmount(monto, campo, destino, tasa),
          oldConvertTo(monto, destino, campo, tasa));
      }
    }
  }
}

// 2) Reglas de negocio fijadas a mano (las que documenta AGENTS.md)
const T = 748.66;
eq('Punto Bs. · campo Bs. 7000 → se guardan Bs. 7000', finalAmount(7000, 'VES', 'VES', T), 7000);
eq('Punto Bs. · campo Bs. 7000 → ≈ $9.35', round2(7000 / T), 9.35);
eq('campo $20 · método Bs. → Bs. 14.973', finalAmount(20, 'USD', 'VES', T), 14973);
eq('campo Bs. 7000 · método $ → $9.35', finalAmount(7000, 'VES', 'USD', T), 9.35);
eq('método $ · campo $ 20 → $20', finalAmount(20, 'USD', 'USD', T), 20);
eq('campo Bs. sin tasa (método $) → 0 (guardado bloqueado)', finalAmount(7000, 'VES', 'USD', 0), 0);
eq('campo $ sin tasa (método Bs.) → 0 (guardado bloqueado)', finalAmount(20, 'USD', 'VES', 0), 0);
eq('sin tasa la conversión NO cambia el valor', convertAmount(7000, 'VES', 'USD', 0), 7000);
eq('todo el saldo: saldo 30 de un total 60 en $', suggestAmount(30, 60, 'USD', T), 30);
eq('todo el saldo: saldo 30 en Bs. (× tasa)', suggestAmount(30, 60, 'VES', T), Math.round(30 * T));
eq('todo el saldo nunca supera el monto del servicio', suggestAmount(90, 60, 'USD', T), 60);
eq('saldo negativo (excedente) → 0', suggestAmount(-5, 60, 'USD', T), 0);
eq('chip de saldo con excedente → 0', saldoChipValue(-5, 'USD', T), 0);
eq('chip de saldo en Bs. sin tasa → 0', saldoChipValue(30, 'VES', 0), 0);
eq('comisión Punto 3.5% de $100', puntoCommission(100, 3.5).commission, 3.5);
eq('neto del Punto de $100', puntoCommission(100, 3.5).net, 96.5);
eq('comisión 0 → neto = monto', puntoCommission(7000, 0).net, 7000);
eq('chips en $ = [5,10,15,20]', quickAmounts('USD').join(','), QUICK_USD.join(','));
eq('chips en Bs. = [5000,10000,15000,20000]', quickAmounts('VES').join(','), QUICK_VES.join(','));

console.log(`\npayment-math: ${checks} comprobaciones · ${checks - failures} OK · ${failures} diferencias`);
if (failures > 0) process.exit(1);
