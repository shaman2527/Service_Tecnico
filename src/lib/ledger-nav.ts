// F72 — LA NAVEGACIÓN DEL LIBRO DIARIO EN SUBCATEGORÍAS (regla pura, sin React).
//
// Pedido del dueño (2026-09-23): «arregla toda esta pestaña… está muy larga». El encabezado tenía
// NUEVE botones iguales en una sola fila, al lado del título:
//     Exportar Excel · PIN · Diario · Cierres · Pagos · Gastos · Salud · Movimientos · Personas
// y no se entendía qué era una PESTAÑA (cambia lo que se ve abajo) y qué una ACCIÓN (abre un diálogo
// o descarga un archivo). Acá vive la ÚNICA definición de las dos cosas:
//
//   · SECCIONES (`LEDGER_NAV`): las pestañas, agrupadas en SUBCATEGORÍAS con su rótulo y en el orden
//     en que se usa el día (primero la caja del día, después la plata que la compone, después el
//     control del negocio). El orden de los grupos ES el orden de la pantalla.
//   · ACCIONES (`LEDGER_ACTIONS`): exportar, PIN y personas. NO cambian de sección: van arriba, a la
//     derecha del título, donde no compiten con las pestañas.
//
// La regla de QUIÉN VE QUÉ no se reimplementa: sale de `src/lib/session.ts` (F68/F69), la misma que
// usa el resto de la pantalla. Un ítem sin permiso NO se dibuja y un grupo que se queda sin ítems
// tampoco (así la caja ve «Caja del día → Diario» y «Control → Movimientos», y nada del dueño).
//
// Pruebas: `node tools/ledger_nav_test.ts` (puras, sin navegador).

// Extensión explícita (igual que `reminders.ts`): así el módulo se puede cargar en Node puro
// (`node tools/ledger_nav_test.ts`) sin resolución estilo bundler.
import type { SessionAbilities } from './session.ts';

export type LedgerTab = 'diario' | 'cierres' | 'pagos' | 'gastos' | 'salud' | 'movimientos';

export type LedgerActionId = 'exportar' | 'pin' | 'iva' | 'personas';

export interface LedgerNavItem {
  tab: LedgerTab;
  /** Rótulo EXACTO del botón. Las pruebas EN VIVO buscan los botones por este texto
   *  (`verify_smoke_integral`, `verify_arqueo_f69`): cambiarlo obliga a actualizarlas. */
  label: string;
  /** Una línea que dice qué hay adentro (va en el `title` del botón — el rótulo corto no alcanza). */
  hint: string;
  visible: (ab: SessionAbilities) => boolean;
}

export interface LedgerNavGroup {
  id: string;
  /** Rótulo de la SUBCATEGORÍA (10 px, mayúsculas): dice para qué sirve el grupito de pestañas. */
  label: string;
  items: LedgerNavItem[];
}

export interface LedgerAction {
  id: LedgerActionId;
  label: string;
  hint: string;
  visible: (ab: SessionAbilities) => boolean;
}

/** Lo que ven las dos sesiones (el mostrador trabaja con esto todo el día). */
const TODOS = () => true;
/** Lo del dueño: los números del negocio y las llaves de la plata (mismo gate que el backend). */
const SOLO_DUENO = (ab: SessionAbilities) => ab.seeBusinessNumbers;

export const LEDGER_NAV: LedgerNavGroup[] = [
  {
    id: 'caja',
    label: 'Caja del día',
    items: [
      {
        tab: 'diario', label: 'Diario', visible: TODOS,
        hint: 'El libro del día: totales por método, ventas, servicios y el resumen de la jornada',
      },
      {
        tab: 'cierres', label: 'Cierres', visible: ab => ab.closeDay,
        hint: 'Cada turno con su arqueo: las dos diferencias ($ y Bs.), liquidar el Punto y reabrir un día (↺)',
      },
    ],
  },
  {
    id: 'plata',
    label: 'Plata',
    items: [
      {
        tab: 'pagos', label: 'Pagos', visible: SOLO_DUENO,
        hint: 'Buscar cobros y abonos por método, cliente, referencia o moneda (para cuadrar sobrantes y faltantes)',
      },
      {
        tab: 'gastos', label: 'Gastos', visible: ab => ab.manageBusinessExpenses,
        hint: 'Gastos del negocio: los que salieron del cajón bajan el efectivo esperado al cerrar',
      },
    ],
  },
  {
    id: 'control',
    label: 'Control',
    items: [
      {
        tab: 'movimientos', label: 'Movimientos', visible: TODOS,
        hint: 'Quién hizo cada movimiento de plata del período (el libro de auditoría)',
      },
      {
        tab: 'salud', label: 'Salud', visible: SOLO_DUENO,
        hint: 'Los números del negocio: ingresos, utilidad, por cobrar y capital en inventario',
      },
    ],
  },
];

export const LEDGER_ACTIONS: LedgerAction[] = [
  {
    id: 'exportar', label: 'Exportar Excel', visible: ab => ab.exportData,
    hint: 'Exporta el rango de fechas visible a un Excel (.xlsx) en Documentos\\Registro',
  },
  {
    id: 'pin', label: 'PIN', visible: ab => ab.manageSettings,
    hint: 'Cambiar el PIN de acceso del negocio',
  },
  {
    id: 'iva', label: 'IVA', visible: ab => ab.manageSettings,
    hint: 'IVA: prenderlo o apagarlo, la alícuota (16% por defecto) y si viene en el precio o se suma al cobrar',
  },
  {
    id: 'personas', label: 'Personas', visible: ab => ab.manageUsers,
    hint: 'Personas y accesos: quién entra, con qué rol y con qué PIN',
  },
];

/** Los grupos que esta sesión VE (sin ítems escondidos y sin grupos vacíos: nada de rótulos sueltos). */
export function ledgerNav(ab: SessionAbilities): LedgerNavGroup[] {
  return LEDGER_NAV
    .map(g => ({ ...g, items: g.items.filter(i => i.visible(ab)) }))
    .filter(g => g.items.length > 0);
}

/** Las acciones que esta sesión VE (arriba, a la derecha del título). */
export function ledgerActions(ab: SessionAbilities): LedgerAction[] {
  return LEDGER_ACTIONS.filter(a => a.visible(ab));
}

/** Todas las secciones, en orden de pantalla (lo que el estado de la pestaña puede valer de verdad). */
export const LEDGER_TABS: readonly LedgerTab[] =
  LEDGER_NAV.flatMap(g => g.items.map(i => i.tab));

/** Fail-closed: una sección que no existe en la nav NO se puede abrir. */
export function isLedgerTab(v: string): v is LedgerTab {
  return (LEDGER_TABS as readonly string[]).includes(v);
}

/** ¿Esta sesión puede abrir esta sección? (el gate de la UI; el backend tiene el suyo). */
export function ledgerTabVisible(ab: SessionAbilities, tab: LedgerTab): boolean {
  return ledgerNav(ab).some(g => g.items.some(i => i.tab === tab));
}

/** El rótulo de una sección (lo usa la pantalla para nombrar dónde está parada). */
export function ledgerTabLabel(tab: LedgerTab): string {
  for (const g of LEDGER_NAV) for (const i of g.items) if (i.tab === tab) return i.label;
  return tab;
}

/** La subcategoría a la que pertenece una sección (para el rótulo del grupo activo). */
export function ledgerTabGroup(tab: LedgerTab): string {
  for (const g of LEDGER_NAV) if (g.items.some(i => i.tab === tab)) return g.label;
  return '';
}
