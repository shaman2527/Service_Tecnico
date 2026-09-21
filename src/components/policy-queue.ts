import type { Reminder, ReminderActionId } from '@/lib/reminders';

// F46 — COLA de los recordatorios de política que se muestran centrados.
//
// Vive en su propio módulo (y no dentro de `PolicyModal.tsx`) por una razón práctica: el modal se
// monta UNA vez y cualquier pantalla puede encolar un aviso; tener la cola separada deja el archivo
// del componente con un solo export (el host) y evita el aviso de React Refresh de «mezcla de
// componentes y funciones» que rompe el recambio en caliente.

export interface PendingPolicy {
  /** Estable por aviso+orden: el mismo aviso pedido dos veces se muestra UNA sola vez. */
  id: string;
  reminder: Reminder;
  onAction: (action: ReminderActionId) => void;
}

let cola: PendingPolicy[] = [];
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(f => f());

/** Encola un recordatorio para mostrarlo centrado (si ya está el mismo, no se apila). */
export function queuePolicyModal(id: string, reminder: Reminder, onAction: (action: ReminderActionId) => void): void {
  if (cola.some(p => p.id === id)) return;
  cola = [...cola, { id, reminder, onAction }];
  avisar();
}

/** Cierra un aviso (respondido por el operario o pospuesto con «Después»). */
export function closePolicyModal(id: string): void {
  cola = cola.filter(p => p.id !== id);
  avisar();
}

export const policyModalQueue = (): readonly PendingPolicy[] => cola;

/** Suscripción del host (devuelve la baja). */
export function subscribePolicyModal(f: () => void): () => void {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}
