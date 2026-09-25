// Pruebas PURAS de `src/lib/ledger-nav.ts` (Harness F72).
//
// Fija el pedido del dueño (2026-09-23): «arregla toda esta pestaña… está muy larga» — el encabezado
// del Libro Diario tenía 9 botones iguales en una fila. Ahora: ACCIONES arriba (exportar/PIN/personas)
// y SECCIONES abajo agrupadas en subcategorías.
//
// Lo que estas pruebas protegen, además del agrupado:
//   1. Los RÓTULOS EXACTOS de las pestañas: las pruebas en vivo (`verify_smoke_integral`,
//      `verify_arqueo_f69`) buscan los botones por su texto («Diario», «Cierres», «Pagos», «Gastos»,
//      «Salud», «Movimientos»). Un rótulo con un contador («Pagos 3») rompería esas verificaciones.
//   2. Lo que ve la CAJA: Diario y Movimientos — y NADA del dueño.
//   3. Que no se pueda abrir una sección sin permiso (fail-closed), ni siquiera forzando el estado.
//
// Uso:  node tools/ledger_nav_test.ts

import {
  LEDGER_NAV, LEDGER_TABS, LEDGER_ACTIONS,
  ledgerNav, ledgerActions, ledgerTabVisible, ledgerTabLabel, ledgerTabGroup, isLedgerTab,
} from '../src/lib/ledger-nav.ts';
import { abilities } from '../src/lib/session.ts';

let checks = 0;
let failures = 0;

function ok(what: string, cond: boolean, detalle = '') {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}${detalle ? ` — ${detalle}` : ''}`); }
}

const master = abilities('master');
const caja = abilities('caja');

const navMaster = ledgerNav(master);
const navCaja = ledgerNav(caja);
const itemsMaster = navMaster.flatMap(g => g.items);
const itemsCaja = navCaja.flatMap(g => g.items);

// ── 1. Las SECCIONES son las 6 de siempre, con los rótulos que las pruebas en vivo buscan ───────
{
  const esperadas = ['diario', 'cierres', 'pagos', 'gastos', 'movimientos', 'salud'];
  ok('las secciones del libro son las 6 (en orden de pantalla)',
    LEDGER_TABS.join(' | ') === esperadas.join(' | '), LEDGER_TABS.join(' | '));

  const labels = itemsMaster.map(i => i.label);
  ok('los rótulos son los que las pruebas EN VIVO buscan por texto',
    labels.join(' | ') === 'Diario | Cierres | Pagos | Gastos | Movimientos | Salud', labels.join(' | '));
  // Un contador o un emoji dentro del botón cambia el `innerText` y rompe `clickButton('Pagos')`.
  ok('ningún rótulo trae números, paréntesis ni adornos (el innerText manda)',
    labels.every(l => /^[A-Za-zÁÉÍÓÚáéíóúñÑ ]+$/.test(l)), labels.join(' | '));
  ok('ningún rótulo se repite (dos botones con el mismo texto confunden al clic)',
    new Set(labels).size === labels.length, labels.join(' | '));
  ok('cada sección tiene su explicación (title) y no repite el rótulo',
    itemsMaster.every(i => i.hint.trim().length > 20 && i.hint !== i.label));
  ok('cada sección se puede nombrar por su rótulo',
    LEDGER_TABS.every(t => ledgerTabLabel(t) !== t));
}

// ── 2. El AGRUPADO en subcategorías: 3 grupos de 2, en el orden en que se usa el día ────────────
{
  ok('el dueño ve 3 subcategorías', navMaster.length === 3, navMaster.map(g => g.label).join(' | '));
  ok('la nav del dueño ES la definición completa (no se le esconde nada)',
    JSON.stringify(navMaster) === JSON.stringify(LEDGER_NAV));
  ok('las subcategorías se identifican por id estable (caja | plata | control)',
    LEDGER_NAV.map(g => g.id).join(' | ') === 'caja | plata | control',
    LEDGER_NAV.map(g => g.id).join(' | '));
  ok('las subcategorías son «Caja del día», «Plata» y «Control»',
    navMaster.map(g => g.label).join(' | ') === 'Caja del día | Plata | Control',
    navMaster.map(g => g.label).join(' | '));
  ok('cada subcategoría es un grupito de 2 pestañas',
    navMaster.every(g => g.items.length === 2), navMaster.map(g => `${g.label}:${g.items.length}`).join(' · '));
  ok('ninguna subcategoría se queda sin rótulo',
    navMaster.every(g => g.label.trim().length > 2));
  ok('la primera subcategoría es la CAJA DEL DÍA (es lo que se mira primero)',
    navMaster[0].items.map(i => i.tab).join('|') === 'diario|cierres');
  ok('cada sección sabe a qué subcategoría pertenece',
    ledgerTabGroup('diario') === 'Caja del día' && ledgerTabGroup('gastos') === 'Plata'
    && ledgerTabGroup('salud') === 'Control');
}

// ── 3. Lo que ve el DUEÑO y lo que ve la CAJA (la regla es la de `session.ts`) ──────────────────
{
  ok('el dueño ve las 6 pestañas', itemsMaster.length === 6);
  ok('el dueño ve las 4 acciones (Exportar Excel · PIN · IVA · Personas)',
    ledgerActions(master).map(a => a.label).join(' | ') === 'Exportar Excel | PIN | IVA | Personas',
    ledgerActions(master).map(a => a.label).join(' | '));

  ok('la caja ve 2 pestañas: Diario y Movimientos',
    itemsCaja.map(i => i.tab).join(' | ') === 'diario | movimientos',
    itemsCaja.map(i => i.tab).join(' | '));
  // F69 — invariante que ya tenía prueba en vivo: la caja TIENE su libro de movimientos…
  ok('la caja SÍ tiene su libro de movimientos (F69)',
    itemsCaja.some(i => i.tab === 'movimientos'));
  // …y NO ve nada del dueño (ni el rótulo de la pestaña, ni la subcategoría, ni la acción).
  const todoCaja = JSON.stringify(navCaja);
  ok('la caja NO ve Gastos', !/"Gastos"/.test(todoCaja));
  ok('la caja NO ve Salud', !/"Salud"/.test(todoCaja));
  ok('la caja NO ve Cierres (el arqueo lo cierra el dueño)', !/"Cierres"/.test(todoCaja));
  ok('la caja NO ve Pagos (reconciliación del negocio)', !/"Pagos"/.test(todoCaja));
  ok('la caja NO ve Personas (no hay acción suya)',
    ledgerActions(caja).length === 0, JSON.stringify(ledgerActions(caja)));
  ok('a la caja no le queda ninguna subcategoría vacía con rótulo huérfano',
    navCaja.every(g => g.items.length > 0), JSON.stringify(navCaja.map(g => g.label)));
}

// ── 4. Fail-closed: una sección sin permiso no se abre, y una que no existe tampoco ─────────────
{
  ok('la caja NO puede abrir Cierres / Pagos / Gastos / Salud',
    (['cierres', 'pagos', 'gastos', 'salud'] as const).every(t => !ledgerTabVisible(caja, t)));
  ok('la caja SÍ puede abrir Diario y Movimientos',
    ledgerTabVisible(caja, 'diario') && ledgerTabVisible(caja, 'movimientos'));
  ok('el dueño puede abrir las 6', LEDGER_TABS.every(t => ledgerTabVisible(master, t)));

  ok('un valor raro NO es una sección del libro',
    !isLedgerTab('') && !isLedgerTab('admin') && !isLedgerTab('Diario') && !isLedgerTab('movimiento'));
  ok('las 6 secciones sí lo son', LEDGER_TABS.every(t => isLedgerTab(t)));

  // Un rol desconocido cae en CAJA (`abilities` es fail-closed): tampoco ve lo del dueño.
  const raro = abilities('lo-que-sea');
  ok('un rol desconocido ve lo mismo que la caja (no gana acceso)',
    ledgerNav(raro).flatMap(g => g.items).length === 2
    && ledgerActions(raro).length === 0);
}

// ── 5. Las ACCIONES no son secciones (no cambian lo que se ve abajo) ────────────────────────────
{
  ok('las acciones son 4 y tienen su explicación (F74 sumó el IVA)',
    LEDGER_ACTIONS.length === 4 && LEDGER_ACTIONS.every(a => a.hint.trim().length > 15));
  ok('ninguna acción se llama como una sección',
    LEDGER_ACTIONS.every(a => !(LEDGER_TABS as readonly string[]).includes(a.label.toLowerCase())));
  ok('los ids de las acciones son los que la pantalla usa',
    LEDGER_ACTIONS.map(a => a.id).join('|') === 'exportar|pin|iva|personas');
  ok('la acción «IVA» existe y explica las dos formas de cobro (F74)',
    LEDGER_ACTIONS.find(a => a.id === 'iva')?.label === 'IVA'
    && /alícuota/i.test(LEDGER_ACTIONS.find(a => a.id === 'iva')?.hint ?? ''));
  ok('la acción «Personas» conserva el gancho que usan las pruebas en vivo (id = personas)',
    LEDGER_ACTIONS.find(a => a.id === 'personas')?.label === 'Personas');
}

console.log(`\nledger_nav_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
