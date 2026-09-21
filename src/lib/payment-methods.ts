// Métodos de pago: qué se muestra SIEMPRE y qué queda detrás del desplegable (F31).
// Puro (sin React) para poder probarlo sin navegador en `tools/method_picker_test.ts`.

import { currencySymbol, methodCurrency } from './utils.ts';

export interface PaymentMethod {
  id: number;
  name: string;
}

/**
 * Los métodos que se usan todo el día en el mostrador, en el orden en que se tocan.
 * (Decisión del local: «Punto de Venta (Bs), Pago Móvil, Efectivo $»; el resto en el desplegable.)
 */
export const METODOS_FAVORITOS = ['Punto de Venta (Bs)', 'Pago Móvil', 'Divisas (USD Cash)'] as const;

/**
 * Parte la lista del backend en favoritos (en el ORDEN de `favoritos`, no en el que devuelve el
 * backend) y el resto. Un favorito que no exista en la base simplemente no aparece: la lista del
 * backend manda (si el local renombra un método, no se muestra un chip muerto).
 */
export function splitMethods(methods: PaymentMethod[], favoritos: readonly string[] = METODOS_FAVORITOS) {
  const porNombre = new Map(methods.map(m => [m.name, m]));
  const fav = favoritos.map(n => porNombre.get(n)).filter((m): m is PaymentMethod => !!m);
  const resto = methods.filter(m => !favoritos.includes(m.name));
  return { fav, resto };
}

/**
 * Símbolo de moneda para un chip SOLO si la etiqueta corta no lo dice ya («PUNTO Bs» + «Bs.» sobra).
 * OJO: `currencySymbol('VES')` devuelve **'Bs. '** (¡con espacio final!): si no se recorta, el chip
 * del método más usado se ve «PUNTO Bs Bs.» — pasó de verdad y estuvo a punto de cerrarse la feature
 * así (por eso ahora hay test: `tools/method_picker_test.ts`).
 */
export function simboloSiAporta(etiqueta: string, nombreMetodo: string): string | null {
  const simbolo = currencySymbol(methodCurrency(nombreMetodo));
  const comparable = simbolo.replace(/[.\s]/g, '');
  if (!comparable) return null;
  return etiqueta.replace(/\s/g, '').includes(comparable) ? null : simbolo;
}
