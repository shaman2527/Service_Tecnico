// Pruebas de la FUENTE ÚNICA de la moneda de los métodos de pago (F37).
//
// Lo que se juega acá: los métodos de la app NO se pueden adivinar. Antes el frontend trataba como
// BOLÍVARES a todo método que no dijera «USD»/«Zelle»/«$», así que un método propio del local
// («Binance», «PayPal») se mostraba y se guardaba como Bs — y la caja lo contaba en bolívares, inflando
// el total del día en esa moneda. Ahora la moneda sale de `tools/payment_methods.json`, el MISMO archivo
// que lee el backend (`db.rs`, `include_str!`), y un método que no esté ahí no se puede cobrar.
//
// Uso: node tools/node_modules/tsx/dist/cli.mjs tools/payment_methods_test.ts

import { isBsMethod, methodCurrency, monedaDelMetodo, esMetodoConocido, nombresDeMetodos } from '../src/lib/utils.ts';
import metodos from './payment_methods.json' with { type: 'json' };

let checks = 0;
let failures = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) { failures++; console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ''}`); }
};
const eq = (label: string, got: unknown, want: unknown) => {
  checks++;
  if (got !== want) { failures++; console.log(`  ✗ ${label}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); }
};

// ── El archivo compartido: forma y contenido ────────────────────────────────────────────────────────
ok('el archivo declara una lista «metodos» con entradas', Array.isArray(metodos.metodos) && metodos.metodos.length > 0);
ok('todas las monedas son USD o VES (ni una cosa rara)',
  metodos.metodos.every(m => m.moneda === 'USD' || m.moneda === 'VES'),
  JSON.stringify([...new Set(metodos.metodos.map(m => m.moneda))]));
ok('ningún método se repite', new Set(metodos.metodos.map(m => m.nombre)).size === metodos.metodos.length);
ok('ningún nombre viene vacío', metodos.metodos.every(m => typeof m.nombre === 'string' && m.nombre.trim().length > 0));

// ── Los MISMOS 7 métodos que siembra el backend tienen que estar (si no, no se podrían cobrar) ─────
const SEMBRADOS = [
  'Divisas (USD Cash)', 'Pago Móvil', 'Punto de Venta ($)', 'Punto de Venta (Bs)',
  'Transferencia Zelle', 'Transferencia Bs', 'Efectivo Bs',
];
for (const nombre of SEMBRADOS) {
  ok(`el método que siembra la base está en la fuente única: ${nombre}`, esMetodoConocido(nombre));
}
ok('y la lista del sistema no pierde ninguno de los sembrados',
  SEMBRADOS.every(n => nombresDeMetodos().includes(n)));

// ── La moneda de los 7 (lo que el operario ve y lo que se guarda) ───────────────────────────────────
eq('Punto de Venta (Bs) → VES', methodCurrency('Punto de Venta (Bs)'), 'VES');
eq('Pago Móvil → VES', methodCurrency('Pago Móvil'), 'VES');
eq('Efectivo Bs → VES', methodCurrency('Efectivo Bs'), 'VES');
eq('Transferencia Bs → VES', methodCurrency('Transferencia Bs'), 'VES');
eq('Divisas (USD Cash) → USD', methodCurrency('Divisas (USD Cash)'), 'USD');
eq('Punto de Venta ($) → USD', methodCurrency('Punto de Venta ($)'), 'USD');
eq('Transferencia Zelle → USD', methodCurrency('Transferencia Zelle'), 'USD');
eq('isBsMethod y methodCurrency coinciden (una sola regla)', isBsMethod('Efectivo Bs'), methodCurrency('Efectivo Bs') === 'VES');

// ── Alias históricos que están escritos en la base de datos ────────────────────────────────────────
eq('«Pago Movil» (sin tilde, dato viejo) → VES', methodCurrency('Pago Movil'), 'VES');
eq('«Zelle» (alias) → USD', methodCurrency('Zelle'), 'USD');
// H2 (revisión adversarial): «Punto de Venta» A SECAS es AMBIGUO (el local lo usa para el de $ y para el
// de Bs) y su moneda alimentaba la migración de moneda histórica, que reescribe filas guardadas y
// recalcula cierres: adivinar ahí MUEVE plata de un bolsillo a otro. Por eso NO está en la fuente única.
ok('«Punto de Venta» a secas NO está en la lista (es ambiguo: están «($)» y «(Bs)»)',
  !esMetodoConocido('Punto de Venta') && monedaDelMetodo('Punto de Venta') === null);
eq('…y no se lo declara en bolívares por adivinanza', isBsMethod('Punto de Venta'), false);
ok('las dos versiones del Punto SÍ están, cada una con su moneda',
  monedaDelMetodo('Punto de Venta ($)') === 'USD' && monedaDelMetodo('Punto de Venta (Bs)') === 'VES');

// ── EL CORAZÓN DE F37: un método que NO está NO se adivina ─────────────────────────────────────────
for (const inventado of ['Binance', 'PayPal', 'Cripto', 'Gaveta', 'USD', 'Zelle Binance', 'efectivo bs']) {
  eq(`un método inventado no es Bs: ${inventado}`, isBsMethod(inventado), false);
  eq(`y no se lo declara conocido: ${inventado}`, esMetodoConocido(inventado), false);
  eq(`su moneda canónica es «no sé»: ${inventado}`, monedaDelMetodo(inventado), null);
  // La UI lo LEE como dólares (el fallback del backend), pero el backend RECHAZA el cobro: nunca se
  // guarda plata con una moneda inventada.
  eq(`se muestra en dólares, no en Bs: ${inventado}`, methodCurrency(inventado), 'USD');
}
ok('un método vacío/nulo no rompe nada', methodCurrency('') === 'USD' && methodCurrency(null) === 'USD'
  && !esMetodoConocido(' ') && !isBsMethod(undefined));
// El espaciado no cambia la interpretación (los datos viejos pueden traer espacios)
eq('con espacios alrededor igual se reconoce', methodCurrency('  Efectivo Bs  '), 'VES');
ok('y con espacios sigue siendo conocido', esMetodoConocido('  Pago Móvil '));

const failed = failures;
console.log(`${checks - failed}/${checks} comprobaciones OK${failed ? ` — FALLAN: ${failed}` : ''}`);
process.exit(failed ? 1 : 0);
