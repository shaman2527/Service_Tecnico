import { api } from '../db';
import type { Service } from '../types';

// Actualizar una orden existente conservando TODOS sus campos actuales.
//
// `update_service` recibe la fila COMPLETA (23 parámetros posicionales): mandar '' en un campo que
// sí tenía dato lo PISA. Este helper es la única forma de actualizar una orden desde la UI (lo usa
// el botón «Entregar» de la lista) para que los caminos no se separen y no se olvide ningún campo
// (el descuento del mostrador, la pantalla exacta, el técnico…).
//
// `dateOut: ''` significa «el backend pone la fecha de HOY» (es lo que hace al entregar).
export interface OrderPatch {
  status?: string;
  /** '' = hoy (entregar) · una fecha = forzarla */
  dateOut?: string;
  /** pantalla EXACTA instalada (descuenta esa y solo esa del inventario) */
  screenProductId?: number | null;
  /** monto FINAL que debe pagar el cliente */
  amount?: number;
  discountAmount?: number;
  observations?: string;
  paymentMethod?: string;
  serviceTypes?: string;
  serviceType?: string;
  technician?: string;
  technicianId?: number | null;
  currency?: string;
}

export async function updateOrderKeepingFields(s: Service, patch: OrderPatch = {}): Promise<void> {
  await api.updateService(
    s.id,
    s.client ?? '',
    s.phone ?? '',
    s.model ?? '',
    s.fault ?? '',
    patch.serviceType ?? s.service_type ?? 'Cambio pantalla',
    patch.serviceTypes ?? s.service_types ?? '',
    patch.amount ?? s.amount,
    patch.paymentMethod ?? s.payment_method ?? 'Divisas (USD Cash)',
    // OJO (F34): `dateOut: undefined` conserva la fecha de entrega que YA tiene la orden. Mandar
    // '' NO es inocente: el backend lo interpreta como «entregá hoy» cuando el estado es Entregado
    // (`update_service`), así que un update angosto (p. ej. cambiar el técnico) sobre una orden
    // entregada el 10/09 le ponía `date_out = hoy`: movía su monto de la caja de ese día a la de hoy
    // (descuadrando el cierre viejo, que no se recalcula), reiniciaba la garantía de 7 días y la
    // metía en «Entregados hoy». Solo el camino «Entregar» pasa `dateOut: ''` a propósito.
    patch.dateOut ?? (s.date_out ?? '').slice(0, 10),
    patch.status ?? s.status ?? 'Recibido',
    patch.observations ?? s.observations ?? '',
    s.bank_fee_percent ?? 0,
    s.zelle_reference ?? '',
    patch.currency ?? s.currency ?? 'USD',
    s.client_ci ?? '',
    s.client_address ?? '',
    s.device_checklist ?? '',
    patch.technician ?? s.technician ?? '',
    // Mismo cuidado con el técnico: `?? ` no alcanza porque `null` es un valor VÁLIDO (desasignar).
    // Con `patch.technicianId ?? s.technician_id` el id viejo sobrevivía a «Sin asignar» y la orden
    // quedaba con technician NULL + technician_id apuntando al anterior (la tarjeta no cambiaba).
    patch.technicianId !== undefined ? patch.technicianId : (s.technician_id ?? null),
    s.color ?? '',
    patch.screenProductId !== undefined ? patch.screenProductId : s.screen_product_id ?? null,
    patch.discountAmount ?? s.discount_amount ?? 0,
  );
}
