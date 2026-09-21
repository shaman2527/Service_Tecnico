// Estados y reglas del FLUJO de una orden de servicio (módulo PURO, sin React).
//
// Acá vive lo que comparten varias pantallas:
//   · los nombres de los estados y cuál es el estado con el que NACE una orden (Recibido);
//   · qué estados sirven para CREAR (`isCreatableStatus`) y cuáles son finales (`isFinalStatus`);
//   · si la foto de SALIDA corresponde a la entrega vigente (`photoOutIsCurrent`);
//   · el paso siguiente del PROCESO según el estado (`nextStep`), que la ficha de ingreso muestra
//     en una línea informativa al pie.
//
// La FICHA DE INGRESO (el asistente que pide un dato por vez) vive en `src/lib/ficha.ts`. Antes acá
// había un `buildServiceGuide` que dibujaba un panel con todos los ítems del estado: se retiró en
// F33 — cuando el asistente pasó a ser la ficha — para no tener DOS reglas distintas diciendo qué
// falta (y porque ese panel, con 9 ítems fijos, le comía la pantalla al formulario).

/** Estados del flujo (los mismos que siembra el backend en `service_statuses`). */
export const STATUS_RECIBIDO = 'Recibido';
export const STATUS_REPARACION = 'En reparación';
export const STATUS_REPUESTO = 'Esperando repuesto';
export const STATUS_REPARADO = 'Reparado / Pendiente Pago';
export const STATUS_POR_ENTREGAR = 'Por entregar';
export const STATUS_ENTREGADO = 'Entregado';
export const STATUS_CANCELADO = 'Cancelado / Devuelto';

/** Estado con el que NACE una orden nueva (antes caía en el default silencioso `Por entregar`). */
export const DEFAULT_NEW_STATUS = STATUS_RECIBIDO;

const FINALIZADOS = ['Cancelado', STATUS_CANCELADO, 'Devuelto'];

export function isFinalStatus(status: string | null | undefined): boolean {
  return FINALIZADOS.includes(status ?? '');
}

/**
 * ¿Con este estado se puede CREAR una orden? Solo con los de TALLER: entregar (o anular) es un
 * ACTO aparte — se hace cambiando el estado, y ahí el backend descuenta el stock, escribe la fecha
 * de entrega y arranca la garantía de 7 días. Nacer «Entregado» dejaba la orden sin fecha (fuera de
 * «Entregados hoy», sin garantía) y con el inventario sin descontar. El backend aplica la MISMA
 * regla (`es_estado_de_taller` en db.rs), así que un invoke a mano tampoco la saltea.
 */
export function isCreatableStatus(status: string | null | undefined): boolean {
  return !isFinalStatus(status) && (status ?? '') !== STATUS_ENTREGADO;
}

/**
 * ¿La foto de SALIDA confirmada corresponde a la entrega ACTUAL? Si el equipo se reabrió y se
 * volvió a entregar, la foto vieja no vale: hay que pedirla otra vez.
 */
export function photoOutIsCurrent(photoOutAt: string | null, dateOut: string | null): boolean {
  if (!photoOutAt) return false;
  const dia = (v: string | null) => (v ? v.slice(0, 10) : '');
  return dia(photoOutAt) === dia(dateOut);
}

/**
 * F45 — ¿la orden TODAVÍA necesita que le asignen un técnico?
 *
 * Pedido del dueño (2026-09-20): «cuando vas a crear un nuevo servicio [el técnico] esté
 * predeterminado como sin asignar, que me deje seguir registrando el servicio nuevo y en la tarjeta
 * aparezca una señal con un color: necesita asignar al técnico para ese trabajo».
 *
 * Reglas:
 *  · una orden en TALLER sin técnico → **sí** (la señal se ve en la tarjeta: falta quién lo repare);
 *  · ya ENTREGADA o anulada (Devuelto/Cancelado) → **no**: el trabajo salió (o se anuló), reclamar el
 *    técnico después sería ruido permanente en la lista;
 *  · con `technician_id` o con el nombre del snapshot (`technician`) → no: ya tiene responsable
 *    (el snapshot cubre el caso del técnico borrado del padrón, donde la orden conserva su nombre).
 */
export function needsTechnician(sv: {
  status?: string | null;
  technician?: string | null;
  technician_id?: number | null;
}): boolean {
  const status = sv.status ?? '';
  if (status === STATUS_ENTREGADO || isFinalStatus(status)) return false;
  return sv.technician_id == null && !(sv.technician ?? '').trim();
}

export interface NextStepInput {  technician: string;
  hasPaid: boolean;
  payIntent: string | null;
  needsScreen: boolean;
  screenChosen: boolean;
}

/** El paso siguiente del proceso, dicho con el motivo (la ficha lo muestra en una línea). */
export function nextStep(status: string, i: NextStepInput): { status: string; why: string } | null {
  switch (status) {
    case STATUS_RECIBIDO:
      return {
        status: STATUS_REPARACION,
        why: i.technician.trim()
          ? `Empezá el diagnóstico (el técnico ${i.technician.trim()} ya está asignado).`
          : 'Asigná el técnico responsable y empezá el diagnóstico.',
      };
    case STATUS_REPARACION:
      return { status: STATUS_REPARADO, why: 'Cuando el equipo quede listo, marcalo reparado y avisá al cliente.' };
    case STATUS_REPUESTO:
      return { status: STATUS_REPARADO, why: 'Cuando llegue el repuesto y se instale, marcalo reparado.' };
    case STATUS_REPARADO:
      return { status: STATUS_POR_ENTREGAR, why: i.hasPaid ? 'Cobrado: avisá al cliente que puede retirarlo.' : 'Cobrá o avisá al cliente que está listo para retirar.' };
    case STATUS_POR_ENTREGAR:
      return { status: STATUS_ENTREGADO, why: 'Usá «Cerrar» (o «Entregar»): cobra, entrega, descuenta el stock y deja la garantía de 7 días.' };
    default:
      return null;
  }
}
