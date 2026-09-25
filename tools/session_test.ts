// Pruebas PURAS de `src/lib/session.ts` (Harness F68).
//
// Fija la regla que pidió el dueño: «la sesión de caja 1 pueda usar todo, ver su día de caja, pero no
// pueda ver cuánto factura la master; no tenga tanto acceso». Es la ÚNICA implementación de esa
// regla (la UI esconde con esto y el backend tiene su propio gate).
//
// Uso:  node tools/session_test.ts

import { abilities, roleLabel, hasOwnCaja } from '../src/lib/session.ts';

let checks = 0;
let failures = 0;

function ok(what: string, cond: boolean) {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}`); }
}

const master = abilities('master');
const caja = abilities('caja');

// ── 1. La CAJA puede USAR TODO el mostrador ────────────────────────────────────────────────────
{
  const mostrador: (keyof ReturnType<typeof abilities>)[] = [
    'sell', 'receiveService', 'editService', 'collect', 'refund', 'deliver',
    'clients', 'inventoryView', 'pedidos', 'print',
  ];
  for (const k of mostrador) {
    ok(`la caja puede ${k} (es su trabajo del mostrador)`, caja[k] === true);
  }
  ok('la caja puede abrir el día', caja.openDay === true);
  // F69: cerrar el turno y anotar un gasto son del dueño en el backend (`close_day` / `add_expense`),
  // así que la regla pura NO puede decir que la caja puede (diría algo que el producto niega).
  ok('la caja NO cierra el turno: lo cierra el dueño (F69)', caja.closeOwnCaja === false);
  ok('la caja NO anota gastos del negocio (F69)', caja.cashExpense === false);
}

// ── 2. La CAJA no ve los números del dueño ──────────────────────────────────────────────────────
{
  ok('la caja NO ve el Dashboard (facturación del negocio)', caja.seeDashboard === false);
  ok('la caja NO ve los números del negocio (utilidad/salud)', caja.seeBusinessNumbers === false);
  ok('la caja NO ve los precios de costo', caja.seeCost === false);
  ok('la caja NO ve las otras cajas (lo que factura la master)', caja.seeOtherCajas === false);
}

// ── 3. La CAJA no toca lo que define el negocio ni borra plata ──────────────────────────────────
{
  ok('la caja NO cierra el día del negocio', caja.closeDay === false);
  ok('la caja NO reabre un día (borraría evidencia)', caja.reopenDay === false);
  ok('la caja NO borra un cobro', caja.deleteMoney === false);
  ok('la caja NO anula ventas (F70: es del dueño)', caja.voidSale === false);
  ok('la caja NO toca el catálogo', caja.manageCatalog === false);
  ok('la caja NO toca los precios', caja.managePrices === false);
  ok('la caja NO crea personas ni cambia PINes', caja.manageUsers === false);
  ok('la caja NO carga gastos del negocio (alquiler/sueldo)', caja.manageBusinessExpenses === false);
  ok('la caja NO configura la app (impresora / PIN / actualizar la versión)', caja.manageSettings === false);
  ok('la caja NO respalda ni restaura la base', caja.backup === false);
  ok('la caja NO exporta los datos de la base', caja.exportData === false);
}

// ── 4. El MASTER puede todo ────────────────────────────────────────────────────────────────────
{
  const claves = Object.keys(master) as (keyof ReturnType<typeof abilities>)[];
  const faltan = claves.filter(k => master[k] !== true);
  ok(`el Master puede todo (faltan: ${faltan.join(', ') || 'ninguna'})`, faltan.length === 0);
  ok('el Master tiene todas las capacidades de la caja (no pierde nada)',
    claves.every(k => !caja[k] || master[k]));
}

// ── 5. Fail-closed: un rol desconocido es CAJA (nunca gana acceso) ──────────────────────────────
{
  for (const r of [null, undefined, '', 'admin', 'Master', 'dueno', 'cajera']) {
    const a = abilities(r as unknown as string);
    ok(`rol desconocido (${String(r)}) cae en el perfil de CAJA`, a.manageUsers === false && a.sell === true);
  }
  ok('el rol «master» exacto sí es el dueño', abilities('master').manageUsers === true);
}

// ── 6. Rótulos y caja propia ───────────────────────────────────────────────────────────────────
{
  ok('el rótulo del dueño lo dice', roleLabel('master').includes('dueño'));
  ok('el rótulo de la caja lo dice', roleLabel('caja') === 'Caja');
  ok('un rol raro se rotula como Caja', roleLabel('lo-que-sea') === 'Caja');
  ok('las dos sesiones tienen su propia caja', hasOwnCaja('master') && hasOwnCaja('caja'));
}

console.log(`\nsession_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
