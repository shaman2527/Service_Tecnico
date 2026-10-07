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

/**
 * F83 — A QUÉ CAJA VA UNA DEVOLUCIÓN (y decirlo ANTES de hacerla).
 *
 * La devolución es la ÚNICA escritura de dinero que no elige fecha: se anota en la caja del **turno
 * abierto** (`add_service_refund`), porque la plata sale del cajón que se está trabajando (invariante
 * de F36/F69). Con la caja del 21/09 abierta y hoy 27/09, una devolución hecha HOY entra al arqueo del
 * 21/09 — y hasta F83 el operario no tenía forma de saberlo: `RefundDialog` no consultaba el turno, no
 * mostraba el cartel de F82 y no había ningún campo de fecha.
 *
 * Decisión (la opción (a) del backlog): **informar, no bloquear**. La devolución sigue saliendo del
 * cajón abierto —es la regla del local— pero el mostrador lo VE antes de confirmar, con el remedio si
 * lo que quiere es que salga de la caja de hoy.
 *
 * Regla PURA (sin React): `node tools/day_shift_test.ts`.
 */
export interface CajaDeLaDevolucion {
  /** Fecha de la caja que va a recibir la devolución (`''` = no hay ninguna caja abierta). */
  fecha: string;
  /** ¿Es la caja de HOY? */
  esHoy: boolean;
  /** true = hay que avisar fuerte (no hay caja, o la caja no es la de hoy). */
  aviso: boolean;
  /** La línea para el operario, con las fechas en formato del local. */
  texto: string;
}

/** ¿La sesión actual puede CERRAR el día? Cerrar es del DUEÑO (`close_day` → `require_owner`) y la
 *  pestaña Cierres ni existe para la caja: el remedio tiene que decir la verdad de QUIÉN lo hace. */
export interface OpcionesCajaDeLaDevolucion {
  /** `false` = la sesión no puede cerrar el día (rol caja): el remedio se pide, no se ordena. */
  puedeCerrar?: boolean;
}

export function cajaDeLaDevolucion(
  fechaTurno: string | null | undefined,
  hoy: string,
  opciones: OpcionesCajaDeLaDevolucion = {},
): CajaDeLaDevolucion {
  const puedeCerrar = opciones.puedeCerrar !== false;
  const turno = soloFecha(fechaTurno);
  const dia = soloFecha(hoy) ?? '';
  if (!turno) {
    return {
      fecha: '', esHoy: false, aviso: true,
      texto: 'No hay ninguna caja abierta: la devolución sale del cajón, así que hay que abrir el día (Libro Diario → «Abrir Día») antes de devolver plata.',
    };
  }
  if (turno === dia) {
    return {
      fecha: turno, esHoy: true, aviso: false,
      texto: `Esta devolución se anota en la CAJA DE HOY (${fechaLegible(turno)}): es la plata que sale del cajón y baja el efectivo esperado de ese día.`,
    };
  }
  // REVISIÓN ADVERSARIAL (MAYOR, 2026-10-06): acá se le decía «Cerrá esa caja en Libro Diario →
  // Cierres» a CUALQUIER sesión, y el rol `caja` NO puede cerrar (close_day exige dueño y la pestaña
  // Cierres no se le dibuja): el mismo diálogo le daba dos órdenes contradictorias —el cartel de arriba
  // «pedile al dueño» y este bloque «cerrala vos»— y la mandaba a una acción imposible. Es el M1 de F82
  // reintroducido. Ahora el texto depende de si la sesión puede cerrar.
  const remedio = puedeCerrar
    ? `Si querés que salga de la caja de hoy, ${REMEDIO_TURNO_VIEJO}`
    : `Cerrar esa caja es del DUEÑO: pedile que la cierre (es la del ${fechaLegible(turno)}) y después abra el día de hoy. La devolución se anota igual en esa caja.`;
  return {
    fecha: turno, esHoy: false, aviso: true,
    texto: `OJO: esta devolución se va a anotar en la caja del ${fechaLegible(turno)}, que es la que está ABIERTA — NO en la de hoy (${fechaLegible(dia)}). ${remedio}`,
  };
}
