// F32 — RECORDATORIOS de política del taller (módulo PURO, sin React).
//
// Qué es: las reglas que dicen CUÁNDO aparece cada aviso emergente y con qué acciones, sobre los
// tres momentos en que el operario puede olvidarse de algo (pedido del usuario):
//   · al REGISTRAR un servicio   → «recuerda tomarle la foto al teléfono» + «preguntá si va a
//                                   PAGAR ahora o al retirar y con qué método» (decir «cancelar»
//                                   confundía: en esta app «Cancelado» = pagado).
//   · al IMPRIMIR el comprobante → «recuerda tomarle la foto en la SALIDA al teléfono».
//   · al ENTREGAR el equipo      → «¿le tomaste la foto al entregar? Es política de la empresa».
//
// Dos invariantes que valen más que cualquier texto:
//   1. **Nunca bloquean**: son avisos cerrables, ninguna acción del flujo depende de responderlos
//      (decisión explícita del usuario: «no invasivo»).
//   2. **No insisten por lo ya resuelto**: si la foto ya se confirmó o el pago ya se preguntó, la
//      función devuelve menos avisos (o ninguno). Nunca dos veces por lo mismo.
//
// Máximo 2 avisos por acción (prioridad: entrada > salida > pago > política) para no inundar la
// pantalla del mostrador.

import type { Service } from '../types';
// Extensión explícita: este módulo lo cargan TAMBIÉN las pruebas puras con Node
// (`node tools/reminders_test.ts`), que no hace la resolución estilo bundler.
import { photoOutIsCurrent } from './service-guide.ts';

export type ReminderTone = 'entrada' | 'pago' | 'salida' | 'politica';

export type ReminderActionId = 'foto_tomada' | 'pago_ahora' | 'pago_al_retirar' | 'ok';

export interface ReminderAction {
  id: ReminderActionId;
  label: string;
}

export interface Reminder {
  /** clave estable (para no repetir el aviso dentro de la misma acción) */
  key: string;
  tone: ReminderTone;
  title: string;
  message: string;
  actions: ReminderAction[];
}

/** Tope de avisos simultáneos por acción (el resto se descarta, no se acumula). */
export const MAX_REMINDERS = 2;

// Prioridad de los avisos cuando hay más de los que se pueden mostrar: primero la foto que el
// operario puede tomar EN ESE MOMENTO (entrada al recibir, salida al entregar/imprimir la
// entrega), después la pregunta del pago y por último el aviso informativo.
const PRIORIDAD: Record<ReminderTone, number> = { entrada: 0, salida: 1, pago: 2, politica: 3 };

function limitar(list: Reminder[]): Reminder[] {
  return [...list].sort((a, b) => PRIORIDAD[a.tone] - PRIORIDAD[b.tone]).slice(0, MAX_REMINDERS);
}

export interface ReceiveContext {
  /** equipos de la orden que se acaba de guardar (para el texto de multi-equipo) */
  devices: number;
  /** estado con el que nació la orden */
  status: string;
}

const FOTO_ENTRADA: Reminder = {
  key: 'photo_in',
  tone: 'entrada',
  title: 'Foto de ENTRADA',
  message: 'Recuerda tomarle la foto al teléfono al recibirlo: es política de la empresa.',
  actions: [
    { id: 'foto_tomada', label: 'Ya le tomé la foto' },
    { id: 'ok', label: 'Entendido' },
  ],
};

function fotoEntrada(devices: number): Reminder {
  if (devices <= 1) return FOTO_ENTRADA;
  return { ...FOTO_ENTRADA, message: `Recuerda tomarle la foto a los ${devices} teléfonos de la orden: es política de la empresa.` };
}

const FOTO_SALIDA: Reminder = {
  key: 'photo_out',
  tone: 'salida',
  title: 'Foto de SALIDA',
  message: '¿Le tomaste la foto al teléfono al entregarlo? Es política de la empresa.',
  actions: [
    { id: 'foto_tomada', label: 'Ya le tomé la foto' },
    { id: 'ok', label: 'Después' },
  ],
};

// «PAGAR», no «cancelar»: en esta app «Cancelado» significa PAGADO (y «Cancelado / Devuelto» es
// una orden anulada), así que «¿va a cancelar?» se podía leer como «¿va a anular la orden?».
const PREGUNTA_PAGO: Reminder = {
  key: 'pay_intent',
  tone: 'pago',
  title: 'Pregúntale al cliente',
  message: '¿Va a pagar ahora o al retirar el equipo? Pregúntale también con qué método va a pagar.',
  actions: [
    { id: 'pago_ahora', label: 'Paga ahora' },
    { id: 'pago_al_retirar', label: 'Paga al retirar' },
  ],
};

/** Estado del equipo dentro del flujo del taller. */
export function isDelivered(status: string | null | undefined): boolean {
  return (status ?? '') === 'Entregado';
}

// OJO: acá vivía `receiveIntroReminder()` — el aviso que salía AL ABRIR una recepción. Se quitó en
// F33: el usuario lo sintió invasivo («no me deja ver lo que estoy registrando»). Ese recordatorio
// ahora está DENTRO del formulario, en la ficha de ingreso (foto de ENTRADA / pago acordado), y el
// aviso flotante solo aparece si se guarda sin haberlos marcado.

/**
 * Avisos al GUARDAR la recepción (la orden ya existe y se pueden anotar las respuestas).
 * Si la orden nació directamente ENTREGADO, la foto de entrada ya no sirve: se pide la de salida.
 */
export function receiveReminders(svc: Pick<Service, 'photo_in_at' | 'photo_out_at' | 'pay_intent' | 'date_out'>, ctx: ReceiveContext): Reminder[] {
  const list: Reminder[] = [];
  if (isDelivered(ctx.status)) {
    if (!photoOutIsCurrent(svc.photo_out_at, svc.date_out)) list.push(FOTO_SALIDA);
  } else if (!svc.photo_in_at) {
    list.push(fotoEntrada(ctx.devices));
  }
  if (!svc.pay_intent) list.push(PREGUNTA_PAGO);
  return limitar(list);
}

/**
 * Avisos al ABRIR el comprobante / IMPRIMIR: acá el operario tiene la orden a mano.
 *  · el pago se pregunta SOLO si queda saldo y nunca se preguntó (una orden ya cobrada no tiene
 *    nada que preguntar);
 *  · la foto de ENTRADA si nunca se tomó;
 *  · la foto de SALIDA cuando el equipo ya salió (o sale en este momento).
 */
export function printReminders(svc: Pick<Service, 'photo_in_at' | 'photo_out_at' | 'pay_intent' | 'date_out' | 'status' | 'amount' | 'paid_amount'>): Reminder[] {
  const list: Reminder[] = [];
  const entregado = isDelivered(svc.status);
  const saldo = (svc.amount ?? 0) - (svc.paid_amount ?? 0);
  if (!entregado && !svc.photo_in_at) list.push(FOTO_ENTRADA);
  if (!svc.pay_intent && saldo > 0.005) list.push(PREGUNTA_PAGO);
  if (entregado && !photoOutIsCurrent(svc.photo_out_at, svc.date_out)) list.push(FOTO_SALIDA);
  return limitar(list);
}

/** Avisos al ENTREGAR el equipo (después de que la entrega quedó guardada). */
export function deliverReminders(svc: Pick<Service, 'photo_out_at' | 'date_out' | 'pay_intent' | 'amount' | 'paid_amount'>): Reminder[] {
  const list: Reminder[] = [];
  if (!photoOutIsCurrent(svc.photo_out_at, svc.date_out)) list.push(FOTO_SALIDA);
  const saldo = (svc.amount ?? 0) - (svc.paid_amount ?? 0);
  if (!svc.pay_intent && saldo > 0.005) list.push(PREGUNTA_PAGO);
  return limitar(list);
}
/** Texto corto del acuerdo de pago (tarjetas, panel de entregados, talón). */
export function payIntentLabel(payIntent: string | null | undefined): string | null {
  if (payIntent === 'ahora') return 'Paga ahora';
  if (payIntent === 'al_retirar') return 'Paga al retirar';
  return null;
}
