/**
 * F96 — LA BÚSQUEDA DE LA LISTA DE SERVICIOS, EN MEMORIA (la que hace que escribir se sienta
 * instantáneo).
 *
 * POR QUÉ EXISTE ESTE MÓDULO. Antes, cada tecla del buscador esperaba 350 ms, viajaba al backend por
 * IPC (`get_services`), traía **toda** la lista filtrada (36 columnas por fila) y volvía a pedir el
 * mapa de pagos orden por orden. Con la lista ya cargada en memoria eso es trabajo repetido: la
 * búsqueda puede resolverse acá, sin red y sin espera, y el resultado es EXACTAMENTE el mismo
 * conjunto (ver «POR QUÉ NO CAMBIA EL RESULTADO»).
 *
 * POR QUÉ NO CAMBIA EL RESULTADO. El backend busca con
 *   `s.client LIKE %q% OR s.model LIKE %q% OR s.order_num LIKE %q% OR s.phone LIKE %q% OR s.client_ci LIKE %q%`
 * sobre las filas que ya pasaron los filtros de servidor (estado + rango de fechas). La lista que la
 * pantalla tiene cargada es exactamente ese conjunto, así que filtrarlo acá por los MISMOS cinco
 * campos devuelve el mismo conjunto que pediría el backend — sin el viaje.
 *
 * LAS DOS DIFERENCIAS, las dos a favor del operario (y ninguna quita resultados):
 *   1. SE PLIEGAN LOS ACENTOS Y LAS MAYÚSCULAS: «perez» encuentra «Pérez» y «PEREZ» (el LIKE de
 *      SQLite solo pliega ASCII: con la ñ/á/é no matcheaba).
 *   2. VARIAS PALABRAS: cada palabra tiene que aparecer en algún campo, en cualquier orden
 *      («perez maria» encuentra «María Pérez»). Con una sola palabra el resultado es idéntico al de
 *      antes, letra por letra.
 * NUNCA es más restrictivo, con UNA excepción que se resuelve acá: `%` y `_` son COMODINES en el
 * `LIKE` del backend (`format!("%{}%", search)`, sin escapar) y caracteres literales en JavaScript.
 * Para que escribir un `_` no esconda media lista, los comodines NO se interpretan ni se buscan: se
 * descartan de la consulta (una consulta hecha SÓLO de comodines no filtra, igual que en el backend).
 *
 * Es una regla PURA (sin React, sin backend) y tiene pruebas: `node tools/service_search_test.ts`.
 */

/** Lo mínimo que necesita una fila para poder buscarla (los campos que busca el backend). */
export interface SearchableService {
  client?: string | null;
  model?: string | null;
  order_num?: string | null;
  phone?: string | null;
  client_ci?: string | null;
}

/**
 * Los campos que entra en la búsqueda. Es la MISMA lista que el `LIKE` de `Database::get_services`
 * (db.rs): si algún día el backend busca en otra columna, hay que sumarla acá (y el test lo recuerda).
 * A propósito NO se busca en `fault`/`observations`: el operario escribe el cliente o el modelo.
 */
export const SERVICE_SEARCH_FIELDS = ['client', 'model', 'order_num', 'phone', 'client_ci'] as const;

/**
 * Plegado de texto para comparar: mayúsculas → minúsculas, acentos fuera, espacios colapsados.
 * (El mismo criterio que usan `work-aliases.ts`/`variant.ts` para el resto de la app: una sola idea
 * de «el mismo texto» en todo el producto.)
 */
export function foldSearch(text: string | null | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    // Marcas diacríticas sueltas que deja NFD (á → a + U+0301).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Las palabras de la consulta, ya plegadas (vacío = sin búsqueda).
 *
 * `%` y `_` se DESCARTAN: en el backend son comodines del `LIKE` (y una consulta hecha sólo de ellos
 * no filtra); acá, tomados literalmente, esconderían casi toda la lista — justo lo que la regla no
 * puede hacer. Se descartan de la CONSULTA, no del texto de las filas (un cliente «PEREZ_1» sigue
 * apareciendo por «perez»).
 */
export function searchTokens(query: string | null | undefined): string[] {
  const q = foldSearch(query).replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim();
  return q ? q.split(' ') : [];
}

/**
 * Todo el texto buscable de una fila, plegado y en un solo string. Los campos se unen con un
 * separador que no puede aparecer en una consulta (`\u0000`) para que una palabra no se pueda
 * «coser» entre dos campos.
 */
export function searchHaystack(row: SearchableService): string {
  const partes: string[] = [];
  for (const campo of SERVICE_SEARCH_FIELDS) {
    const v = foldSearch(row[campo] as string | null | undefined);
    if (v) partes.push(v);
  }
  return partes.join('\u0000');
}

/**
 * MEMORIA CORTA DEL TEXTO BUSCABLE (lo que hace que la tecla N sea gratis).
 *
 * Plegar acentos cuesta (normalizar 5 campos por fila y por tecla: con 2000 órdenes son ~10 ms). Las
 * filas son OBJETOS ESTABLES que vienen del backend y no se mutan, así que el plegado se calcula UNA
 * vez por fila y se recuerda en una `WeakMap`: la primera tecla paga el plegado, las siguientes
 * comparan texto ya listo. La `WeakMap` no retiene filas: cuando la lista vieja se reemplaza, su
 * entrada se va sola (no es una fuga de memoria).
 */
const pajarCache = new WeakMap<object, string>();

/** El texto buscable de una fila, cacheado por identidad de la fila. */
export function cachedHaystack(row: SearchableService): string {
  const cacheado = pajarCache.get(row as object);
  if (cacheado !== undefined) return cacheado;
  const calculado = searchHaystack(row);
  pajarCache.set(row as object, calculado);
  return calculado;
}

/**
 * ¿Esta fila entra en la búsqueda? Sin consulta entra siempre; si hay, TODAS sus palabras tienen que
 * aparecer en el texto buscable de la fila.
 */
export function matchesServiceSearch(row: SearchableService, query: string | null | undefined): boolean {
  return matchesTokens(row, searchTokens(query));
}

/** El corazón: ¿la fila contiene TODAS las palabras (ya plegadas)? `[]` = sin búsqueda. */
function matchesTokens(row: SearchableService, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const pajar = cachedHaystack(row);
  for (const t of tokens) if (!pajar.includes(t)) return false;
  return true;
}

/**
 * Filtra una lista de filas por la consulta. Sin consulta devuelve LA MISMA lista (ni una copia:
 * la lista cargada se reusa tal cual, que es lo que evita re-renders inútiles).
 *
 * La consulta se pliega UNA sola vez (no una vez por fila): con 2000 órdenes ese detalle es la
 * diferencia entre una tecla gratis y una tecla que se nota.
 */
export function filterServicesBySearch<T extends SearchableService>(rows: T[], query: string | null | undefined): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return rows;
  return rows.filter(r => matchesTokens(r, tokens));
}
