// F79 — COBRAR DENTRO DEL WIZARD (reglas PURAS, sin React y sin backend).
//
// Pedido del dueño (2026-09-26): «el botón de pago en servicio también que aparezca en el wizard,
// que en el mismo wizard podamos cobrar sin problema… hay un espacio al lado del color de equipo,
// meterlo ahí… pero si revisa arriba te sale método de pago también: esté todo bien ordenado,
// óptimo, no sea confuso».
//
// Este módulo dice QUÉ DICE el botón de cobro y EN QUÉ ESTADO está el dinero de esa orden. Es lo
// único que comparten los dos modos del wizard:
//
//   · CREAR  → el botón dice el monto de ESE equipo («Cobrar $30.00») porque la orden todavía no
//              existe: al tocarlo se guarda la orden y recién ahí se abre el cobro (ver Services.tsx).
//   · EDITAR → el botón dice «Cobrar / Abono» y abre el MISMO diálogo de la tarjeta (la opción de
//              siempre, tal cual está hoy).
//
// Invariantes (las mismas reglas de dinero que el resto del sistema):
//   (1) el estado se dice con NÚMEROS REALES — lo cobrado es `paid_amount`, no lo que se esperaba
//       cobrar, y el saldo es monto − cobrado (puede quedar a favor del cliente);
//   (2) una orden CANCELADA o DEVUELTA no admite cobros: se dice el motivo en la cara del operario
//       en vez de abrir un diálogo que el backend va a rechazar;
//   (3) una orden de $0 es legítima (garantía, cortesía, descuento del 100%): el texto lo dice, no
//       lo trata como error;
//   (4) NINGÚN texto inventa una equivalencia en Bs.: eso es del diálogo de cobro, que sí conoce la
//       tasa del turno abierto (F38).
//
// Pruebas: `node tools/wizard_cobro_test.ts`.

// Extensión explícita: este módulo también lo importa una prueba que corre en Node puro (sin
// resolución estilo bundler) — misma regla que `lib/reminders.ts` (ver AGENTS.md).
import { isFinalized } from './utils.ts';

/** Tolerancia de dinero del sistema (medio centavo): el mismo corte que usan saldo y cobros. */
export const TOL = 0.005;

export type CobroModo = 'crear' | 'editar';

export interface EstadoCobro {
  /** De qué se trata el texto (lo usa la UI para el color). */
  tono: 'sin-monto' | 'pendiente' | 'parcial' | 'cobrado' | 'a-favor' | 'cerrada';
  /** La línea que se lee debajo del botón (nunca miente ni estima). */
  texto: string;
  /** Por qué NO se puede cobrar (null = se puede). */
  motivo: string | null;
}

const money = (v: number) => `$${Math.abs(v).toFixed(2)}`;

/** Lo que dice el botón. En crear lleva el monto de ese equipo; en editar es la acción de siempre. */
export function etiquetaCobro(modo: CobroModo, total: number): string {
  if (modo === 'editar') return 'Cobrar / Abono';
  return Number.isFinite(total) && total > TOL ? `Cobrar ${money(total)}` : 'Cobrar';
}

/**
 * La ayuda corta del botón. Deja claro que NO es una segunda forma de cobrar: es el mismo diálogo
 * «Pago / Abono» de la tarjeta. En los DOS modos el botón GUARDA primero (en el alta porque la orden
 * todavía no existe; en la edición porque cobrar cierra el registro y, si no guardara antes, lo que
 * el operario acababa de corregir se perdería), así que la ayuda lo dice.
 */
export function ayudaCobro(modo: CobroModo): string {
  return modo === 'editar'
    ? 'Guarda los cambios de la orden y abre el mismo «Pago / Abono» de la tarjeta.'
    : 'Guarda la orden y abre el cobro de este equipo (el mismo «Pago / Abono» de la tarjeta).';
}

/**
 * El estado del dinero de la orden, en una línea. `total` es la deuda (monto guardado, ya con
 * descuento) y `pagado` lo REALMENTE cobrado.
 */
export function estadoCobro({ total, pagado, status }: {
  total: number;
  pagado: number;
  status?: string | null;
}): EstadoCobro {
  const totalOk = Number.isFinite(total) ? total : 0;
  const pagadoOk = Number.isFinite(pagado) ? pagado : 0;
  // (2) Una orden anulada o devuelta no admite cobros: el motivo se dice acá y el botón se apaga.
  if (isFinalized(status)) {
    const que = status === 'Devuelto' ? 'devuelta' : 'cancelada';
    const texto = `La orden está ${que}: no admite cobros.`;
    return { tono: 'cerrada', texto, motivo: texto };
  }
  const saldo = totalOk - pagadoOk;
  // (3) Orden de $0 sin cobros: es legítima (garantía / cortesía), no un error.
  if (totalOk <= TOL && pagadoOk <= TOL) {
    return { tono: 'sin-monto', texto: 'Sin cobros todavía (la orden está en $0.00).', motivo: null };
  }
  if (pagadoOk <= TOL) {
    return { tono: 'pendiente', texto: `Por cobrar ${money(totalOk)}.`, motivo: null };
  }
  if (saldo > TOL) {
    return { tono: 'parcial', texto: `Cobrado ${money(pagadoOk)} · saldo ${money(saldo)}.`, motivo: null };
  }
  if (saldo < -TOL) {
    return { tono: 'a-favor', texto: `Cobrado ${money(pagadoOk)} · a favor del cliente ${money(saldo)}.`, motivo: null };
  }
  return { tono: 'cobrado', texto: `Cobrado ${money(pagadoOk)} · sin saldo.`, motivo: null };
}

/**
 * El aviso de la orden que YA existe (la creó el propio botón de cobro). Existe para que nadie crea
 * que el guardado del último paso va a crear otra orden: dice el número y QUÉ hace ese guardado
 * (sin nombrar el botón, que solo existe en el último paso — en el paso 2 decir «Actualizar orden»
 * mandaría al operario a buscar un botón que no está en pantalla).
 */
export function avisoOrdenGuardada(base: string, equipos: number): string {
  const n = equipos > 1 ? ` (${equipos} equipos)` : '';
  return `Orden ${base} guardada${n}. Podés seguir con el registro: al guardar se ACTUALIZA esta orden, NO se crea otra.`;
}

/** Por qué no se pueden agregar ni quitar equipos una vez que la orden está guardada. */
export function avisoEquiposFijos(base: string): string {
  return `La orden ${base} ya está guardada: no se pueden agregar ni quitar equipos desde acá.`
    + ' Para otro teléfono usá «Nuevo Servicio»; para corregir este, seguí en el wizard.';
}

/**
 * El aviso de que el monto que se va a cobrar NO es el que está escrito en el formulario (hay
 * cambios sin guardar). En EDICIÓN el cobro trabaja sobre la orden GUARDADA (el botón no escribe
 * nada), así que se dice antes de que el operario cobre el número viejo — es un aviso, nunca un
 * bloqueo.
 */
export function avisoMontoSinGuardar(montoFormulario: number, montoGuardado: number): string | null {
  if (Math.abs(montoFormulario - montoGuardado) <= TOL) return null;
  return `Ojo: el cobro usa el monto GUARDADO (${money(montoGuardado)}), no el que escribiste`
    + ` (${money(montoFormulario)}). Guardá el cambio primero.`;
}

/**
 * El aviso del ALTA cuando la orden ya existe y el formulario tiene un monto distinto: el botón NO
 * cobra el monto guardado, **guarda el que el operario escribió y cobra ESE** — decir lo contrario
 * («se cobra el guardado») sería mentir y mandaría a apretar el guardado del último paso, que cierra
 * el wizard y abre el comprobante.
 */
export function avisoMontoPendiente(montoFormulario: number, montoGuardado: number): string | null {
  if (Math.abs(montoFormulario - montoGuardado) <= TOL) return null;
  return `Monto nuevo sin guardar: al tocar «Cobrar» se guarda ${money(montoFormulario)}`
    + ` (la orden dice ${money(montoGuardado)}) y se cobra ese monto.`;
}
