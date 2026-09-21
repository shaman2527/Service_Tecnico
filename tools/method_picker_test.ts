// Pruebas de las reglas del selector de métodos de pago (F31).
//
// Lo que se juega acá: que en el mostrador los 3 métodos que se usan todo el día estén a UN toque y
// que los demás sigan existiendo (detrás del desplegable). Si esto se rompe, el operario no encuentra
// cómo cobrar.
//
// Uso: node tools/node_modules/tsx/dist/cli.mjs tools/method_picker_test.ts

import { METODOS_FAVORITOS, splitMethods, simboloSiAporta } from '../src/lib/payment-methods.ts';
import { methodCurrency, shortMethodLabel } from '../src/lib/utils.ts';

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

// La MISMA lista que siembra el backend (db.rs, INSERT OR IGNORE INTO payment_methods)
const backend = [
  { id: 1, name: 'Divisas (USD Cash)' },
  { id: 2, name: 'Pago Móvil' },
  { id: 3, name: 'Punto de Venta ($)' },
  { id: 4, name: 'Punto de Venta (Bs)' },
  { id: 5, name: 'Transferencia Zelle' },
  { id: 6, name: 'Transferencia Bs' },
  { id: 7, name: 'Efectivo Bs' },
];

const { fav, resto } = splitMethods(backend);
eq('los 3 favoritos, en el orden pedido por el local', fav.map(m => m.name).join(' | '),
  'Punto de Venta (Bs) | Pago Móvil | Divisas (USD Cash)');
eq('el resto queda en el desplegable (4)', resto.map(m => m.name).join(' | '),
  'Punto de Venta ($) | Transferencia Zelle | Transferencia Bs | Efectivo Bs');
eq('ningún método se pierde entre los dos grupos', fav.length + resto.length, backend.length);
ok('ningún método se repite en los dos grupos',
  fav.every(f => !resto.some(r => r.name === f.name)));

// Etiquetas y moneda de los chips (lo que el operario lee y lo que se guarda)
eq('chip de Punto de Venta (Bs)', shortMethodLabel('Punto de Venta (Bs)'), 'PUNTO Bs');
eq('chip de Pago Móvil', shortMethodLabel('Pago Móvil'), 'PAGO MOVIL');
eq('chip de Divisas (USD Cash)', shortMethodLabel('Divisas (USD Cash)'), 'EFECTIVO $');
eq('Punto de Venta (Bs) es en BOLÍVARES', methodCurrency('Punto de Venta (Bs)'), 'VES');
eq('Pago Móvil es en BOLÍVARES', methodCurrency('Pago Móvil'), 'VES');
eq('Divisas (USD Cash) es en DÓLARES', methodCurrency('Divisas (USD Cash)'), 'USD');
eq('Punto de Venta ($) es en DÓLARES', methodCurrency('Punto de Venta ($)'), 'USD');
eq('Transferencia Zelle es en DÓLARES', methodCurrency('Transferencia Zelle'), 'USD');
eq('Efectivo Bs es en BOLÍVARES', methodCurrency('Efectivo Bs'), 'VES');

// Robustez: si el local renombra o borra un método, el selector NO muestra un chip muerto
const sinPagoMovil = backend.filter(m => m.name !== 'Pago Móvil');
const r2 = splitMethods(sinPagoMovil);
eq('un favorito que ya no existe no se muestra', r2.fav.map(m => m.name).join(' | '),
  'Punto de Venta (Bs) | Divisas (USD Cash)');
ok('el método borrado tampoco reaparece en el desplegable', !r2.resto.some(m => m.name === 'Pago Móvil'));

// Caso extremo: backend con NOMBRES DISTINTOS (renombrados por el local) → el componente cae al
// desplegable completo en vez de quedarse sin ninguna forma de elegir (y el test lo fija).
const renombrados = [{ id: 1, name: 'Efectivo $' }, { id: 2, name: 'PagoMovil' }];
const r3 = splitMethods(renombrados);
eq('sin favoritos configurados no hay chips', r3.fav.length, 0);
eq('…y todos los métodos quedan en el desplegable', r3.resto.length, 2);
eq('la constante de favoritos es la del local', METODOS_FAVORITOS.join(','), 'Punto de Venta (Bs),Pago Móvil,Divisas (USD Cash)');

// ── El símbolo de moneda del chip: NUNCA repetido ──────────────────────────────────────────────
// «PUNTO Bs» + «Bs.» = «PUNTO Bs Bs.» fue un defecto REAL que se escapó de la primera prueba.
eq('PUNTO Bs no lleva símbolo (ya dice Bs)', simboloSiAporta('PUNTO Bs', 'Punto de Venta (Bs)'), null);
eq('EFECTIVO $ no lleva símbolo (ya dice $)', simboloSiAporta('EFECTIVO $', 'Divisas (USD Cash)'), null);
eq('PAGO MOVIL sí lleva símbolo (es en Bs.)', simboloSiAporta('PAGO MOVIL', 'Pago Móvil'), 'Bs. ');
eq('ZELLE lleva $ (es en dólares)', simboloSiAporta('ZELLE', 'Transferencia Zelle'), '$');
eq('EFECTIVO Bs no lleva símbolo', simboloSiAporta('EFECTIVO Bs', 'Efectivo Bs'), null);
eq('TRANSFER Bs no lleva símbolo', simboloSiAporta('TRANSFER Bs', 'Transferencia Bs'), null);
// Ningún chip puede quedar con el símbolo dos veces
for (const name of ['Punto de Venta (Bs)', 'Pago Móvil', 'Divisas (USD Cash)', 'Efectivo Bs', 'Transferencia Bs', 'Punto de Venta ($)', 'Transferencia Zelle']) {
  const etiqueta = shortMethodLabel(name);
  const simbolo = simboloSiAporta(etiqueta, name);
  ok(`el chip de «${name}» no repite el símbolo`, !simbolo || !etiqueta.replace(/\s/g, '').includes(simbolo.replace(/[.\s]/g, '')),
    `«${etiqueta}${simbolo ?? ''}»`);
}

console.log(`\npayment-methods: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallo(s)`);
process.exit(failures > 0 ? 1 : 0);
