// Pruebas PURAS de las fechas del día del local (bug de producción encontrado el 2026-09-16
// en la validación pre-producción).
//
// El bug: `new Date().toISOString().slice(0,10)` devuelve la fecha en UTC. En Venezuela (UTC−4)
// a partir de las 20:00 da el día SIGUIENTE, así que los listados de «hoy» (Ventas, Servicios,
// Libro Diario) quedaban VACÍOS con las ventas ya registradas del día.
//
// Uso:  node tools/node_modules/tsx/dist/cli.mjs tools/local_date_test.ts
//       (para ejercitar el desfase de UTC en cualquier PC:  $env:TZ="America/Caracas"  antes)

import { localDate, addDays, monthStart } from '../src/lib/utils.ts';

let checks = 0;
let failures = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  checks++;
  if (got !== want) { failures++; console.log(`  ✗ ${label}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); }
};

// El caso medido: 2026-09-16 22:08 en Caracas (UTC−4) = 2026-09-17T02:08Z
const nocheEnCaracas = new Date(2026, 8, 16, 22, 8, 20);
eq('22:08 sigue siendo el 16 (hora local)', localDate(nocheEnCaracas), '2026-09-16');
if (nocheEnCaracas.getTimezoneOffset() > 0) {
  eq('en este huso el mismo instante en UTC ya es el 17 (el bug que se corrigió)',
    nocheEnCaracas.toISOString().slice(0, 10), '2026-09-17');
} else {
  console.log('  (huso UTC o positivo: el desfase de toISOString() no se reproduce en esta PC;');
  console.log('   corré la prueba con $env:TZ="America/Caracas" para ejercitarlo)');
}

// Justo antes y después de la medianoche local
eq('23:59 del 16', localDate(new Date(2026, 8, 16, 23, 59, 59)), '2026-09-16');
eq('00:00 del 17', localDate(new Date(2026, 8, 17, 0, 0, 0)), '2026-09-17');
// Un dígito de mes/día va con cero delante (formato YYYY-MM-DD)
eq('mes y día con cero delante', localDate(new Date(2026, 0, 5, 9, 0, 0)), '2026-01-05');

// addDays: calendario LOCAL, sin pasar por UTC (y sin romperse en el cambio de mes/año)
eq('un día antes', addDays('2026-09-16', -1), '2026-09-15');
eq('un día después', addDays('2026-09-30', 1), '2026-10-01');
eq('cruce de año', addDays('2026-12-31', 1), '2027-01-01');
eq('cruce de año hacia atrás', addDays('2027-01-01', -1), '2026-12-31');
eq('29 de febrero bisiesto', addDays('2028-02-28', 1), '2028-02-29');
eq('ventana de 7 días del listado', addDays('2026-09-16', -6), '2026-09-10');
eq('fecha inválida se devuelve tal cual', addDays('', -1), '');
// Blindaje: una fecha con HORA (p. ej. `date_in` leído de la base) no debe degradar en silencio
eq('fecha con hora se devuelve tal cual (sin inventar un día)', addDays('2026-09-16 10:30', -1), '2026-09-16 10:30');
eq('texto suelto se devuelve tal cual', addDays('ayer', -1), 'ayer');

// monthStart: primer día del mes del período «Este mes»
eq('primer día del mes', monthStart('2026-09-16'), '2026-09-01');
eq('primer día en enero', monthStart('2027-01-31'), '2027-01-01');
eq('mes vacío → vacío (sin «-01» colgado)', monthStart(''), '');

console.log(`\nfechas locales: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallo(s)`);
if (failures > 0) process.exit(1);
