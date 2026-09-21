// Pruebas PURAS del descuento de un servicio (F49).
//
// El invariante que cuidan: `amount` es lo que el cliente DEBE y `discount_amount` el descuento del
// mostrador → el PRECIO de lista es `amount + discount_amount`. Aplicar un descuento NUEVO se calcula
// desde ese precio (no sobre el total ya descontado, que se descontaría dos veces) y nunca puede dejar
// el total en negativo.
//
// Uso:  node tools/discount_test.ts

import {
  grossOf, applyDiscount, discountProblem, discountLabel, DISCOUNT_CHIPS, isFullDiscount,
} from '../src/lib/discount.ts';

let checks = 0;
let failures = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FALLA · ${what}\n   esperado: ${JSON.stringify(want)}\n   obtenido: ${JSON.stringify(got)}`);
  }
};
const ok = (what: string, cond: boolean) => {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
};

// ── 1) precio de lista y aplicación ──────────────────────────────────────────────────────────
eq('precio de lista = amount + descuento', grossOf(25, 5), 30);
eq('sin descuento el precio es el total', grossOf(30, 0), 30);
eq('un total en 0 con descuento sigue diciendo el precio', grossOf(0, 30), 30);
eq('aplicar un descuento nuevo recalcula desde el PRECIO (no sobre el total descontado)',
  applyDiscount(25, 5, 10), { amount: 20, discountAmount: 10 });
eq('cambiar el descuento a 0 devuelve el precio completo', applyDiscount(25, 5, 0), { amount: 30, discountAmount: 0 });
eq('poner el mismo descuento no cambia nada', applyDiscount(25, 5, 5), { amount: 25, discountAmount: 5 });
eq('porcentaje del 100%: total en 0 (cortesía)', applyDiscount(30, 0, 30), { amount: 0, discountAmount: 30 });
ok('...y se detecta como descuento total', isFullDiscount(applyDiscount(30, 0, 30)));
ok('un descuento parcial NO es total', !isFullDiscount(applyDiscount(30, 0, 5)));

// ── 2) acotado (nunca plata inventada) ──────────────────────────────────────────────────────
eq('un descuento negativo se acota a 0', applyDiscount(30, 0, -5), { amount: 30, discountAmount: 0 });
eq('un descuento mayor que el precio se acota al precio', applyDiscount(30, 0, 50), { amount: 0, discountAmount: 30 });
eq('NaN no rompe: se trata como 0', applyDiscount(30, 0, NaN), { amount: 30, discountAmount: 0 });
eq('centavos: 30 con 5.5 → total 24.5', applyDiscount(24.5, 5.5, 5.5), { amount: 24.5, discountAmount: 5.5 });

// ── 3) avisos (avisan, no bloquean) ────────────────────────────────────────────────────────
eq('descuento normal → sin aviso', discountProblem(5, 30), null);
eq('descuento igual al precio → sin aviso (cortesía)', discountProblem(30, 30), null);
ok('negativo → avisa', /negativo/.test(String(discountProblem(-1, 30))));
ok('mayor que el precio → avisa y dice el precio', /no puede pasar el precio \(\$30\.00\)/.test(String(discountProblem(31, 30))));
ok('sin número → avisa', discountProblem(NaN, 30) !== null);

// ── 4) etiqueta y chips ────────────────────────────────────────────────────────────────────
eq('etiqueta con dos decimales', discountLabel(5), 'Descuento $5.00');
eq('etiqueta de 0', discountLabel(0), 'Descuento $0.00');
ok('los chips son montos chicos y ordenados', DISCOUNT_CHIPS.every((c, i) => c > 0 && (i === 0 || c > DISCOUNT_CHIPS[i - 1])));

console.log(`\ndiscount_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
