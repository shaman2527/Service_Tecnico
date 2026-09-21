import { toast } from 'sonner';
import { api } from '../db';
import { queuePolicyModal } from './policy-queue';
import type { Reminder, ReminderActionId } from '@/lib/reminders';

// F32/F46 — ACCIONES de los recordatorios (un solo lugar donde se anota la respuesta del operario).
//
// Los avisos de política salen de reglas puras (`lib/reminders.ts`) y se muestran en el MODAL
// CENTRADO de `PolicyModal.tsx` (F46: pedido del dueño, «estilo modal bloqueante, colores suaves»).
// Acá vive lo único que ESCRIBE: anotar en la orden que se tomó la foto o que el cliente dijo cuándo
// paga. Se usa desde las tres pantallas que avisan (recepción, entrega y comprobante) para que no
// haya tres copias del mismo `setServicePolicy`.
//
// Reglas:
//   · la escritura va al BACKEND (`set_service_policy`, comando angosto con whitelist);
//   · si falla, se avisa con un toast de error y NO se miente diciendo que quedó anotado;
//   · **la pantalla se bloquea, los datos no**: el aviso sale con el trabajo YA guardado, así que
//     responderlo (o posponerlo con «Después») no cambia nada de lo que se registró.

/** Texto de confirmación de cada acción (null = la acción no escribe nada). */
export function policyActionMessage(action: ReminderActionId, equipos: number): string | null {
  const varios = equipos > 1 ? ` (${equipos} equipos)` : '';
  switch (action) {
    case 'foto_tomada': return `Foto anotada${varios}`;
    case 'pago_ahora': return `Anotado: paga ahora${varios}`;
    case 'pago_al_retirar': return `Anotado: paga al retirar${varios}`;
    default: return null;
  }
}

/**
 * Muestra los recordatorios (modal centrado) y conecta sus botones con la escritura en la orden.
 * La clave de la foto sale del PROPIO aviso (`photo_in` al recibir, `photo_out` al entregar): un
 * mismo botón «Ya le tomé la foto» sirve para las dos, el contexto lo pone el recordatorio.
 */
export function firePolicyReminders(
  reminders: Reminder[],
  ids: number[],
  onDone?: () => void,
): void {
  // Sin órdenes donde anotar no hay recordatorio que valga: mostrarlo y confirmar «Foto anotada»
  // sin haber escrito nada sería mentirle al operario.
  if (ids.length === 0) return;
  for (const r of reminders) {
    const fotoKey: 'photo_in' | 'photo_out' = r.key === 'photo_out' ? 'photo_out' : 'photo_in';
    // `id` estable: el mismo aviso para la misma orden no se apila dos veces (entregar + imprimir).
    queuePolicyModal(`policy-${r.key}-${ids[0]}`, r, async (action) => {
      if (action === 'ok') return;
      try {
        for (const id of ids) {
          if (action === 'foto_tomada') await api.setServicePolicy(id, fotoKey, 'si');
          else if (action === 'pago_ahora') await api.setServicePolicy(id, 'pay_intent', 'ahora');
          else if (action === 'pago_al_retirar') await api.setServicePolicy(id, 'pay_intent', 'al_retirar');
        }
        const mensaje = policyActionMessage(action, ids.length);
        // La confirmación es un aviso CHICO (sonner): lo que se pide de verdad ya se respondió y no
        // tiene sentido volver a tapar la pantalla para decir «listo».
        if (mensaje) toast.success(mensaje);
        onDone?.();
      } catch (e) {
        toast.error(`No se pudo anotar: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }
}
