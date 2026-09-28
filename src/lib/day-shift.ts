/**
 * F82 — LA CAJA DEL DÍA ANTERIOR SIN CERRAR.
 *
 * Pedido del dueño (2026-09-27): «si yo no he cerrado la caja del día y estamos en otro día — por
 * ejemplo hoy no cerré la caja — que me diga "tiene que cerrar la caja del día anterior para
 * facturar", un mensaje así, ANTES de que vaya a facturar: todo se liga hasta la venta de ayer».
 *
 * POR QUÉ ESTE MÓDULO: la app tiene UN solo turno abierto a la vez (`daily_closings.is_closed=0`) y
 * `get_active_day` devuelve el más reciente **sin compararlo con hoy**. El backend ya rechaza (F82,
 * `require_open_day_para`) una venta o una orden de servicio de hoy cuando el turno abierto es de
 * otro día, pero un rechazo al GUARDAR es tarde: el operario ya cargó toda la ficha. Esta es la
 * mitad que faltaba — el aviso ANTES, con las dos fechas y el remedio exacto, en UNA sola
 * implementación para todas las pantallas (Ventas, Servicio Técnico, Pedidos, el cobro y el
 * asistente de cierre).
 *
 * Es una regla PURA (sin React): `node tools/day_shift_test.ts`.
 */

/** El estado del turno frente al día de hoy. */
export interface TurnoViejo {
  /** ¿El turno abierto es de OTRO día? (entonces no se puede facturar hasta cerrarlo) */
  stale: boolean;
  /** Fecha del turno abierto (AAAA-MM-DD) o `null` si no hay ninguno abierto */
  fechaTurno: string | null;
  /** El día de HOY (AAAA-MM-DD, local) con el que se comparó */
  hoy: string;
  /** El mensaje para el operario (vacío cuando no hay nada que avisar) */
  message: string;
  /** El camino del remedio, en una línea (banner, `title` y Centro de Ayuda) */
  remedy: string;
}

/** El camino del remedio — el mismo texto en todas las pantallas (y el mismo que nombra el backend). */
export const REMEDIO_TURNO_VIEJO =
  'Cerrá esa caja en Libro Diario → Cierres (botón «Cerrar» de esa fila, contá el cajón) y después abrí el día de hoy (Libro Diario → «Abrir Día»).';

/** El aviso corto cuando el turno abierto NO es el de hoy (el que dispara el bloqueo). */
export const AVISO_TURNO_VIEJO =
  'Tenés que cerrar la caja del día anterior antes de facturar.';

/**
 * `AAAA-MM-DD` → `dd/mm/aaaa` SIN pasar por `Date` (una fecha `YYYY-MM-DD` la interpreta el motor
 * como UTC y en Venezuela —UTC-4— las fechas se corren un día: la lección ya está documentada en
 * este proyecto). Si el texto no tiene la forma esperada, se devuelve tal cual (nunca se inventa).
 */
export function fechaLegible(iso: string | null | undefined): string {
  const t = (iso ?? '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return t;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Solo la parte de fecha de un `close_date`/`payment_date` que puede venir con hora. */
export function soloFecha(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().slice(0, 10);
  return t.length === 10 ? t : null;
}

/**
 * LA REGLA: ¿el turno abierto es el de hoy?
 *
 *   · sin turno abierto (`fechaTurno` null/''): NO es «turno viejo» — ese caso lo cubre el gate de
 *     siempre («Día cerrado — abrí el día en Libro Diario») y decir «cerrá la caja de ayer» cuando
 *     no hay ninguna caja abierta sería mentir.
 *   · turno abierto de HOY: todo normal.
 *   · turno abierto de OTRO día: `stale` con el mensaje y el remedio.
 */
export function shiftPending(fechaTurno: string | null | undefined, hoy: string): TurnoViejo {
  const turno = soloFecha(fechaTurno);
  const dia = soloFecha(hoy) ?? '';
  if (!turno) {
    return { stale: false, fechaTurno: null, hoy: dia, message: '', remedy: '' };
  }
  if (turno === dia) {
    return { stale: false, fechaTurno: turno, hoy: dia, message: '', remedy: '' };
  }
  return {
    stale: true,
    fechaTurno: turno,
    hoy: dia,
    // El mensaje dice las DOS fechas y QUÉ VA A PASAR con la plata: es lo que el dueño pidió
    // («que me diga tiene que cerrar la caja del día anterior para facturar»).
    message: `La caja del ${fechaLegible(turno)} sigue ABIERTA y hoy es ${fechaLegible(dia)}. Si registrás esto ahora, la plata se anota en el día ${fechaLegible(turno)} y ese arqueo queda descuadrado.`,
    remedy: REMEDIO_TURNO_VIEJO,
  };
}

/** El texto completo (mensaje + remedio) para el `title`/ayuda y para el Centro de Ayuda. */
export function turnoViejoTexto(t: TurnoViejo): string {
  return t.stale ? `${t.message} ${t.remedy}` : '';
}
