import type { ScreenCandidate } from '../types';

// Reglas PURAS de la pantalla que se instala (sin React): las comparten el formulario de
// servicio y el asistente de cierre, y `tools/queue_test.ts` las comprueba sin navegador.

/** Solo pantallas (categoría 1) para el descuento exacto de inventario. */
export const onlyScreens = (candidates: ScreenCandidate[]) =>
  candidates.filter(c => c.product.category_id === 1);

// (F67: acá vivía `asPhoneEntry`, que solo existía para armarle el «grupo de repuestos» a
// `applyModelPrice`. Ese camino se borró — el precio es UNA regla y vive en `lib/screen-price.ts` —
// así que la función quedó sin llamadores y se fue con él: código muerto que invitaba a un segundo
// camino de precio.)

/**
 * La pantalla es obligatoria SOLO si el trabajo incluye "Cambio pantalla" Y hay opciones en el
 * catálogo: sin elegirla el descuento de inventario caería en OTRO repuesto (o no caería).
 *
 * F47 (pedido del dueño, 2026-09-20): una pantalla **agotada NO bloquea**. Antes había que confirmar
 * «se entregó sin stock» para poder guardar; ahora el aviso queda **en rojo y bien visible** pero el
 * operario sigue trabajando (el inventario baja y el movimiento queda como faltante, que es lo que el
 * local quiere ver en el inventario). Ojo: no se relaja el gate de ELEGIR la pantalla — ese sí sigue.
 */
export const screenOk = (serviceTypes: string[], screenProductId: number | null,
                         options: ScreenCandidate[]) => {
  if (!serviceTypes.includes('Cambio pantalla') || options.length === 0) return true;
  if (screenProductId == null) return false;
  return true;
};

/**
 * La pantalla elegida está AGOTADA: se avisa (y se puede entregar igual, dejando el stock en
 * negativo). Regla pura para que el aviso no dependa de la pantalla: `null` = no hay nada que avisar.
 */
export const outOfStockChoice = (options: ScreenCandidate[], screenProductId: number | null): ScreenCandidate | null =>
  options.find(o => o.product.id === screenProductId && !o.in_stock) ?? null;

/**
 * Auto-selección de la pantalla a instalar.
 *
 * **F53 — la pantalla de REFERENCIA del modelo manda** (pedido del dueño: «esos mismos modelos tienen
 * que tener referencia: qué pantalla va a seleccionar para ese modelo»). Si el modelo del padrón tiene
 * una pantalla de referencia y esa pantalla está entre las compatibles, se elige ESA — es la que el
 * taller instala siempre en ese modelo, y el operario la cambia a mano si ese día pone otra. Los
 * avisos siguen valiendo igual: si la referencia está agotada, sale el aviso rojo (F47) y el
 * inventario baja como faltante.
 *
 * Sin referencia, se mantiene la regla conservadora de siempre: SOLO se elige sola cuando hay UNA
 * única candidata con stock, DE LA MISMA MARCA del teléfono (`brand_match`) y con coincidencia
 * exacta o por prefijo.
 *
 * Antes se elegía la única con stock aunque fuera de otra marca. Medido con el informe
 * `cargo test -- --ignored test_manual_brand_gate_report` sobre el catálogo real (1136 fichas
 * del padrón, snapshot `node tools/snapshot_db.mjs`): de 263 teléfonos que se auto-elegían, 36
 * elegían solos la pantalla de OTRA marca («7 Pro» → Tecno, «A11 Pro» → Samsung A11, «G50» →
 * Motorola, «Galaxy Note 10 AM» → Infinix) y el descuento caía en el repuesto equivocado. Con
 * la regla nueva son 279 auto-selecciones seguras (misma marca, exacta/prefijo) y 0 cruzadas.
 */
export const autoScreen = (options: ScreenCandidate[], referenciaId?: number | null): ScreenCandidate | null => {
  if (referenciaId != null) {
    const referencia = options.find(o => o.product.id === referenciaId);
    if (referencia) return referencia;
  }
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
