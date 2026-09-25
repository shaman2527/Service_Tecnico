// F68 — QUÉ PUEDE HACER Y QUÉ VE CADA SESIÓN DE CAJA (regla pura, sin React).
//
// Pedido del dueño (2026-09-23): «sería bueno la sesión de caja 1 pueda usar todo, ver su día de
// caja, pero no pueda ver cuánto factura la master; no tenga tanto acceso».
//
// Traducción a una regla que se pueda probar:
//   · MASTER (el dueño) ve y hace todo.
//   · CAJA (el operario del mostrador) **opera todo el día**: vende, recibe equipos, cobra, abona,
//     devuelve, entrega, abre el día, imprime, carga gastos de cajón, arma pedidos.
//   · CAJA **no ve los números del negocio** (facturación global, utilidad, gastos del negocio,
//     cierres de otras cajas, precios de costo) **ni toca lo que define el negocio** (catálogo,
//     precios, personas y accesos, respaldos, importaciones) **ni borra plata** (un cobro borrado o
//     un día reabierto borran evidencia: eso es del dueño).
//
// Es la ÚNICA implementación de la regla: la UI la usa para esconder/deshabilitar y las pruebas la
// comprueban sin navegador. El backend tiene su propio gate (`require_owner`) para las escrituras
// sensibles: la UI no es la seguridad.

export type Role = 'master' | 'caja';

/** Lo que la sesión PUEDE HACER (acciones del mostrador y del negocio). */
export interface SessionAbilities {
  // --- mostrador (los dos roles) ---
  sell: boolean;
  receiveService: boolean;
  editService: boolean;
  collect: boolean;
  refund: boolean;
  deliver: boolean;
  openDay: boolean;
  closeOwnCaja: boolean;
  print: boolean;
  clients: boolean;
  inventoryView: boolean;
  pedidos: boolean;
  cashExpense: boolean;
  // --- del negocio (sólo master) ---
  seeDashboard: boolean;
  seeBusinessNumbers: boolean;
  seeCost: boolean;
  seeOtherCajas: boolean;
  closeDay: boolean;
  reopenDay: boolean;
  deleteMoney: boolean;
  voidSale: boolean;
  manageCatalog: boolean;
  managePrices: boolean;
  manageUsers: boolean;
  manageBusinessExpenses: boolean;
  /** F69 — configuración de la APP: impresora, PIN, instalar/revertir una versión. */
  manageSettings: boolean;
  backup: boolean;
  exportData: boolean;
}

const MASTER: SessionAbilities = {
  sell: true, receiveService: true, editService: true, collect: true, refund: true, deliver: true,
  openDay: true, closeOwnCaja: true, print: true, clients: true, inventoryView: true, pedidos: true,
  cashExpense: true,
  seeDashboard: true, seeBusinessNumbers: true, seeCost: true, seeOtherCajas: true, closeDay: true,
  reopenDay: true, deleteMoney: true, voidSale: true, manageCatalog: true, managePrices: true,
  manageUsers: true, manageBusinessExpenses: true, manageSettings: true, backup: true, exportData: true,
};

const CAJA: SessionAbilities = {
  ...MASTER,
  // Lo que NO ve / NO toca la caja (todo lo demás sigue permitido: «pueda usar todo»)
  seeDashboard: false,
  seeBusinessNumbers: false,
  seeCost: false,
  seeOtherCajas: false,
  closeDay: false,
  reopenDay: false,
  deleteMoney: false,
  voidSale: false,
  manageCatalog: false,
  managePrices: false,
  manageUsers: false,
  manageBusinessExpenses: false,
  manageSettings: false,
  backup: false,
  exportData: false,
  // F69 (revisión adversarial) — DOS CAPACIDADES QUE DECÍAN OTRA COSA QUE EL PRODUCTO:
  //  · `closeOwnCaja`: en este sistema hay UN cajón por día y cerrarlo es `close_day`, que pide la
  //    sesión del dueño (el arqueo congela el día: un cierre no se recalcula solo). La caja trabaja el
  //    turno entero, pero no lo cierra.
  //  · `cashExpense`: anotar un gasto es `add_expense`, del dueño (los gastos del negocio son suyos y
  //    la pestaña está oculta). La caja igual cuenta ese gasto en su arqueo, porque el ajuste del
  //    cajón es un AGREGADO (`get_drawer_adjustments`).
  closeOwnCaja: false,
  cashExpense: false,
};

/** Las capacidades de un rol. Un rol desconocido cae en CAJA (fail-closed: no se gana acceso). */
export function abilities(role: Role | string | null | undefined): SessionAbilities {
  return role === 'master' ? MASTER : CAJA;
}

/** Nombre del rol para la pantalla. */
export const roleLabel = (role: Role | string | null | undefined) =>
  role === 'master' ? 'Master (dueño)' : 'Caja';

/**
 * ¿Esta sesión tiene una CAJA PROPIA? La caja (y el master, que también puede atender el mostrador)
 * abren y cierran SU caja; cuando no hay usuarios (instalación de un solo dueño) también es así.
 */
export const hasOwnCaja = (_role: Role | string | null | undefined) => true;
