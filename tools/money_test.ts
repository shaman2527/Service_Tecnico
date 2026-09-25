// Pruebas PURAS de `src/lib/money.ts` (F73) — la máscara de dinero.
//
// Lo que fijan, en orden de importancia:
//   1. ESCRIBIR «145» VALE 145 (no 1,45). Era el bug: la máscara vieja tomaba los dígitos sin
//      separador como centavos y el operario cargaba $1,45 queriendo cargar $145.
//   2. Lo que se muestra es lo que vale: `parse(format(x)) === parse(x)` (ida y vuelta estable).
//   3. Los céntimos no se inventan ni se pierden: «145,5» → 145,50; «145,67» → 145,67; «145,678» → 145,67.
//   4. Pegar «1.234» es MIL DOSCIENTOS TREINTA Y CUATRO (separador de miles), no 1,23 (error de 1000×).
//   5. Un texto vacío o basura vale 0, nunca NaN (un monto en NaN rompe toda la cuenta de la caja).
//
// Uso:  node tools/money_test.ts

import {
  formatMoneyInput, parseMoneyInput, formatMoneyDisplay,
  redondearCentavos, redondearBolivar, MONEY_DECIMALS,
} from '../src/lib/money.ts';

let checks = 0;
let failures = 0;

function ok(what: string, cond: boolean) {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
}

/** El caso completo: lo que se escribe → lo que muestra el campo → lo que vale. */
function caso(tecleado: string, muestra: string, valor: number) {
  const m = formatMoneyInput(tecleado);
  ok(`«${tecleado}» se muestra «${muestra}» (dio «${m}»)`, m === muestra);
  const v = parseMoneyInput(m);
  ok(`«${tecleado}» vale ${valor} (dio ${v})`, v === valor);
}

// ── 1. El bug: tipear un monto de 3+ cifras vale ese monto ─────────────────────────────────────
{
  caso('145', '145', 145);
  caso('1450', '1.450', 1450);
  caso('14500', '14.500', 14500);
  caso('5', '5', 5);
  caso('50', '50', 50);
  caso('500', '500', 500);
  caso('1234567', '1.234.567', 1234567);
  ok('los ceros a la izquierda no se acumulan', formatMoneyInput('007') === '7'
    && formatMoneyInput('0') === '0');
  ok('teclear «0» no borra el campo (se puede escribir 0,50)', formatMoneyInput('0') === '0');
}

// ── 2. Céntimos exactos ─────────────────────────────────────────────────────────────────────────
{
  caso('145,5', '145,5', 145.5);
  caso('145,50', '145,50', 145.5);
  caso('0,05', '0,05', 0.05);
  caso('0,5', '0,5', 0.5);
  caso('145,', '145,', 145);
  caso('145,678', '145,67', 145.67);
  caso('0,005', '0,00', 0); // dos decimales es el máximo: 0,005 no es un monto en $
  caso('1,99', '1,99', 1.99);
  caso('99,99', '99,99', 99.99);
  caso('1.234,56', '1.234,56', 1234.56);
  // El separador que se MUESTRA es siempre la coma, aunque se teclee punto.
  caso('145.5', '145,5', 145.5);
}

// ── 3. Pegar con separador de miles (el error de 1000×) ────────────────────────────────────────
{
  caso('1.234', '1.234', 1234);
  caso('12.345', '12.345', 12345);
  caso('1.234.567', '1.234.567', 1234567);
  ok('«1.234» NO se lee como 1,23 (error de 1000×)', parseMoneyInput(formatMoneyInput('1.234')) === 1234);
  ok('un punto con 1-2 dígitos SÍ es decimal («1.5» → 1,5)', parseMoneyInput(formatMoneyInput('1.5')) === 1.5);
  ok('un punto con 3 dígitos y coma después NO es miles («1.234,5» → 1234,5)',
    parseMoneyInput(formatMoneyInput('1.234,5')) === 1234.5);
}

// ── 4. Ida y vuelta estable (lo que se ve es lo que vale) ──────────────────────────────────────
{
  const muestras = ['0', '5', '145', '1.450', '145,5', '145,50', '1.234,56', '0,05', '99.999,99', '145,'];
  for (const s of muestras) {
    const f = formatMoneyInput(s);
    ok(`«${s}» es estable al reformatear (${f} → ${formatMoneyInput(f)})`, formatMoneyInput(f) === f);
    ok(`«${s}» vale lo mismo al releerlo (${parseMoneyInput(f)})`, parseMoneyInput(formatMoneyInput(f)) === parseMoneyInput(f));
  }
  // El valor que devuelve el campo tiene que sobrevivir al viaje de ida y vuelta del display.
  for (const n of [0, 0.05, 1, 5, 145, 145.5, 1234.56, 99999.99]) {
    const vuelta = parseMoneyInput(formatMoneyInput(formatMoneyDisplay(n)));
    ok(`${n} sobrevive el viaje de ida y vuelta (${formatMoneyDisplay(n)} → ${vuelta})`, vuelta === n);
  }
}

// ── 5. Entradas raras: nunca NaN, nunca un monto inventado ─────────────────────────────────────
{
  for (const basura of ['', '   ', 'abc', '$', ',', '.', ',,', 'a,b', null, undefined, 'NaN', '-5', '+3']) {
    const v = parseMoneyInput(basura as string);
    ok(`basura «${String(basura)}» vale un número (${v})`, Number.isFinite(v));
  }
  ok('el texto vacío vale 0', parseMoneyInput('') === 0);
  ok('«abc» vale 0', parseMoneyInput('abc') === 0);
  ok('sólo la coma vale 0', parseMoneyInput(',') === 0);
  ok('un monto negativo no se cuela por el signo (los campos son ≥ 0)',
    parseMoneyInput('-5') === 5 && parseMoneyInput(formatMoneyInput('-5')) === 5);
  ok('formatMoneyDisplay de un número roto da 0,00', formatMoneyDisplay(NaN) === '0,00');
  ok('parseMoneyInput de un número roto da 0', parseMoneyInput(undefined as unknown as string) === 0);
}

// ── 6. El display de un valor guardado (lo que se pinta al abrir el campo) ─────────────────────
{
  ok('145 se muestra «145,00»', formatMoneyDisplay(145) === '145,00');
  ok('145,5 se muestra «145,50»', formatMoneyDisplay(145.5) === '145,50');
  ok('0 se muestra «0,00»', formatMoneyDisplay(0) === '0,00');
  ok('1234,56 se muestra con miles «1.234,56»', formatMoneyDisplay(1234.56) === '1.234,56');
  ok('el display usa dos decimales fijos', MONEY_DECIMALS === 2);
}

// ── 7. Redondeos (los usa el IVA y todo monto que se guarda) ───────────────────────────────────
{
  ok('centavos: 4,135 → 4,14', redondearCentavos(4.135) === 4.14);
  ok('centavos: 4,134 → 4,13', redondearCentavos(4.134) === 4.13);
  ok('centavos: un entero no cambia', redondearCentavos(145) === 145);
  ok('centavos: NaN → 0', redondearCentavos(NaN) === 0);
  ok('bolívar entero: 4.314,49 → 4.314', redondearBolivar(4314.49) === 4314);
  ok('bolívar entero: 4.314,50 → 4.315', redondearBolivar(4314.5) === 4315);
  ok('bolívar entero: 0 → 0', redondearBolivar(0) === 0);
  // El invariante que sostiene la caja: el monto que se muestra y el que se guarda son el MISMO.
  ok('lo que se muestra y lo que se guarda coinciden al centavo',
    redondearCentavos(parseMoneyInput(formatMoneyInput('145,55'))) === 145.55);
}

console.log(`\nmoney_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
