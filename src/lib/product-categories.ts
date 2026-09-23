// F65 — REGLAS PURAS de las categorías de PRODUCTO (sin React, sin base de datos).
//
// Pedido del dueño (2026-09-23): «cuando en este inventario pueda registrar nuevas categorías, no
// esté limitado a crear categorías de productos». Antes la categoría era una lista CERRADA: si el
// repuesto que llegó no entraba en Pantalla/Teléfono/Accesorio/Repuesto/Batería/Flex, no había dónde
// anotarlo (y elegir «Otro» no existe acá: la categoría arma el nombre de la ficha).
//
// Acá vive lo que la PANTALLA necesita saber antes de llamar al backend (para no hacer esperar al
// operario con un error que se puede ver venir) y lo que hay que DECIR de cada categoría en la lista
// de Ajustes. La validación que MANDA es la del backend (`add_category`/`rename_category`/
// `delete_category` en db.rs): mismas reglas, un solo texto cada una.
//
// Se prueba en `node tools/category_rules_test.ts` (Node puro, sin bundler). Este módulo NO importa
// nada: el plegado de categorías replica `plegar_texto` del backend (ver abajo) y no usa
// `normPhoneModel` (que deja un espacio entre palabras por ser el de los modelos de teléfono).

/** Tope del nombre de una categoría (el mismo del backend: 40 caracteres). */
export const CATEGORY_NAME_MAX = 40;

/** Tope de la descripción (el backend recorta a 200). */
export const CATEGORY_DESC_MAX = 200;

/**
 * Plegado del nombre para comparar duplicados. Replica **exactamente** `plegar_texto` del backend
 * (db.rs): minúsculas, sin acentos y **solo alfanuméricos, sin espacios** («Tapa trasera» →
 * `tapatrasera`). NO se usa `normPhoneModel` acá a propósito: ese deja un espacio entre palabras
 * (sirve para comparar modelos teléfono por palabra) y con él la pantalla decía «no existe» un
 * nombre que el backend SÍ reconocía como repetido — o al revés, bloqueaba uno que aceptaba. Dos
 * implementaciones que tienen que dar lo mismo se prueban en `tools/category_rules_test.ts`.
 */
export const foldCategory = (name: string | null | undefined): string =>
  (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

export type CategoryProblemKind = 'vacia' | 'larga' | 'sin-letras' | 'duplicada';

export interface CategoryProblem {
  kind: CategoryProblemKind;
  /** Texto para mostrar al operario (mismo sentido que el error del backend). */
  message: string;
  /** Si es un duplicado, la categoría que ya existe (para poder elegirla de un toque). */
  existingId?: number;
}

/**
 * ¿Qué problema tiene este nombre de categoría? `null` = se puede guardar.
 *
 * `editingId` es la categoría que se está renombrando: consigo misma no hay duplicado (renombrar
 * «Cámaras» a «Cámaras» no es un error).
 */
export function categoryProblem(
  name: string,
  existing: { id: number; name: string }[],
  editingId: number | null = null,
): CategoryProblem | null {
  const limpio = name.trim();
  if (!limpio) return { kind: 'vacia', message: 'Escribí el nombre de la categoría.' };
  // El tope se cuenta en CARACTERES REALES (code points), igual que el backend (`chars().count()`):
  // con `.length` (unidades UTF-16) un nombre con emojis se rechazaba antes que allá.
  if ([...limpio].length > CATEGORY_NAME_MAX) {
    return { kind: 'larga', message: `El nombre es muy largo (máximo ${CATEGORY_NAME_MAX} caracteres).` };
  }
  const clave = foldCategory(limpio);
  // Un nombre SIN ninguna letra ni número («🔧», «...») plegaba a la clave vacía: DOS categorías
  // distintas quedaban como la misma y no se podía crear la segunda. Se rechaza de entrada.
  if (!clave) {
    return { kind: 'sin-letras', message: 'El nombre necesita al menos una letra o un número.' };
  }
  const repetida = existing.find(c => c.id !== editingId && foldCategory(c.name) === clave);
  if (repetida) {
    return {
      kind: 'duplicada',
      existingId: repetida.id,
      message: `Ya existe la categoría «${repetida.name}» — usá esa (no se crea una repetida).`,
    };
  }
  return null;
}

/** ¿Se puede guardar este nombre? (para el `disabled` del botón) */
export const categoryNameOk = (
  name: string,
  existing: { id: number; name: string }[],
  editingId: number | null = null,
): boolean => categoryProblem(name, existing, editingId) === null;

/**
 * F65 — POR QUÉ una categoría no se puede borrar (o `null` si sí se puede).
 *
 * Es la regla del backend escrita para la pantalla, así el dueño ve el motivo ANTES de intentarlo:
 *   · las del padrón de teléfonos son fijas (el buscador de modelos y el nombre de las fichas
 *     dependen de ellas);
 *   · una categoría CON productos no se borra: hay que pasarlos a otra (ninguna ficha se borra sola).
 */
export function categoryDeleteBlock(row: { products: number; phone_padron: boolean }): string | null {
  if (row.phone_padron) {
    return 'Es una de las categorías del padrón de teléfonos: queda fija.';
  }
  if (row.products > 0) {
    return `La están usando ${row.products} producto${row.products === 1 ? '' : 's'}: pasalos a otra categoría para poder borrarla.`;
  }
  return null;
}

/** Uso real de una categoría, en lenguaje de mostrador: «12 productos · 30 u.» (o «sin productos»). */
export function categoryUsageLabel(row: { products: number; units: number }): string {
  if (row.products === 0) return 'sin productos';
  const u = row.units === 1 ? '1 u.' : `${row.units} u.`;
  return `${row.products} producto${row.products === 1 ? '' : 's'} · ${u}`;
}

/**
 * Qué decir después de crear: si la categoría ya existía, el backend devuelve LA QUE ESTABA
 * (`created: false`) porque el operario escribió un nombre que ya estaba en la lista — hay que
 * decirlo, no dejar creer que se creó algo nuevo. Una sola implementación del texto.
 */
export const categoryOutcomeToast = (created: boolean, name: string): string =>
  created ? `Categoría «${name}» creada` : `«${name}» ya existía: quedó elegida`;
