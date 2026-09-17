import { normPhoneModel } from './utils';
import type { PhoneModelEntry } from './utils';
import type { ScreenCandidate } from '../types';

// Reglas PURAS de la pantalla que se instala (sin React): las comparten el formulario de
// servicio y el asistente de cierre, y `tools/queue_test.ts` las comprueba sin navegador.

/** Solo pantallas (categoría 1) para el descuento exacto de inventario. */
export const onlyScreens = (candidates: ScreenCandidate[]) =>
  candidates.filter(c => c.product.category_id === 1);

/** Adaptador a la forma que usa applyModelPrice (precio sugerido del modelo). */
export const asPhoneEntry = (label: string, candidates: ScreenCandidate[]): PhoneModelEntry => ({
  label,
  norm: normPhoneModel(label),
  products: candidates.map(c => c.product),
});

/**
 * La pantalla es obligatoria SOLO si el trabajo incluye "Cambio pantalla" Y hay opciones en
 * el catálogo. Al ENTREGAR una pantalla AGOTADA hay que confirmarlo (queda como faltante):
 * sin esto se podía entregar sin ningún aviso y el inventario bajaba en silencio.
 */
export const screenOk = (serviceTypes: string[], screenProductId: number | null,
                         options: ScreenCandidate[], confirmed = false, status = '') => {
  if (!serviceTypes.includes('Cambio pantalla') || options.length === 0) return true;
  if (screenProductId == null) return false;
  const chosen = options.find(o => o.product.id === screenProductId);
  if (!chosen) return true;
  if (status === 'Entregado' && !chosen.in_stock) return confirmed;
  return true;
};
