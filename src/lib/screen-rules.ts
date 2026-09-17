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

/**
 * Auto-selección de la pantalla a instalar. SOLO se elige sola cuando hay UNA única
 * candidata con stock, DE LA MISMA MARCA del teléfono (`brand_match`) y con coincidencia
 * exacta o por prefijo.
 *
 * Antes se elegía la única con stock aunque fuera de otra marca. Medido con el informe
 * `cargo test -- --ignored test_manual_brand_gate_report` sobre el catálogo real (1136 fichas
 * del padrón, snapshot `node tools/snapshot_db.mjs`): de 263 teléfonos que se auto-elegían, 36
 * elegían solos la pantalla de OTRA marca («7 Pro» → Tecno, «A11 Pro» → Samsung A11, «G50» →
 * Motorola, «Galaxy Note 10 AM» → Infinix) y el descuento caía en el repuesto equivocado. Con
 * la regla nueva son 279 auto-selecciones seguras (misma marca, exacta/prefijo) y 0 cruzadas.
 * Si no hay certeza, la elige el operario a mano.
 */
export const autoScreen = (options: ScreenCandidate[]): ScreenCandidate | null => {
  const own = options.filter(o => o.in_stock && o.brand_match && o.match_quality !== 'parcial');
  return own.length === 1 ? own[0] : null;
};

/** ¿La pantalla elegida es de OTRA marca que el teléfono? Solo cuando la marca del teléfono
 *  se CONOCE (`brand_known`): si no hay certeza no se avisa nada (avisar de más entrena al
 *  operario a ignorar el aviso). No bloquea: el operario puede confirmarla a mano. */
export const isCrossBrand = (candidate: ScreenCandidate | null | undefined) =>
  !!candidate && candidate.brand_known !== false && candidate.brand_match === false;

/** ¿Hay que avisar que esta candidata es de otra marca? (misma regla, sobre la opción). */
export const warnsCrossBrand = (candidate: ScreenCandidate) =>
  candidate.brand_known !== false && !candidate.brand_match;
