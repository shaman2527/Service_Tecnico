import type { SortDir } from '../types';

// Orden de 3 ESTADOS de las tablas del inventario (pestaña Modelos):
//   sin orden  →  ascendente  →  descendente  →  sin orden
// La lógica vive aquí (pura y fuera del componente) para poder razonarla/probarla
// sin React, y para que el archivo del componente solo exporte componentes.

/** Columnas ordenables del padrón de teléfonos. */
export type PhoneSortKey = 'nombre' | 'marca' | 'repuestos' | 'stock' | 'revisar';

/** Orden activo: la columna y su sentido. */
export interface PhoneOrder {
  key: PhoneSortKey;
  dir: SortDir;
}

/** Orden por defecto del padrón (el mismo que usa el backend). */
export const DEFAULT_ORDER: PhoneOrder = { key: 'nombre', dir: 'asc' };

/** Ciclo del encabezado: click 1 = ascendente, click 2 = descendente, click 3 = sin orden. */
export function nextOrder(current: PhoneOrder | null, key: PhoneSortKey): PhoneOrder | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

/** Parámetros que espera `get_phones` (la UI no manda `null`: manda el orden por defecto). */
export function orderParams(order: PhoneOrder | null): { sort: string; dir: string } {
  return { sort: order?.key ?? DEFAULT_ORDER.key, dir: order?.dir ?? DEFAULT_ORDER.dir };
}

/** Estado de un encabezado: activo (con sentido) o libre. */
export function headerState(order: PhoneOrder | null, key: PhoneSortKey): { active: boolean; dir: SortDir | null } {
  const active = order?.key === key;
  return { active, dir: active ? order!.dir : null };
}
