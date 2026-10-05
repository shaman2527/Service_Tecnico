// El ancho de la VENTANA como estado de React (`matchMedia`), para que una pantalla ancha se
// pueda enseñar de una forma y una angosta de otra.
//
// ¿Por qué se mide la ventana y no se duplica el marcado? Porque las verificaciones en vivo
// (`tools/verify_*.mjs`) buscan los controles DENTRO de su fila (`closest('tr')`), cuentan los
// `[data-in-use]` y leen `td[2].innerText`: si la tabla y una lista de tarjetas vivieran a la vez
// en el DOM, contarían el doble y harían clic en un elemento oculto (0×0). Por eso el inventario
// tiene UN solo marcado y lo que cambia es cómo se presenta.
//
// OJO (dicho aquí para que nadie pierda una tarde): por debajo de 1024 px la tabla de Productos se
// APILA, y las verificaciones en vivo están escritas para la ventana con la que arranca la app
// (1200 × 750). Si se corren con la ventana encogida, lo que falla es la prueba, no la app.

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * ¿La ventana cumple la consulta de medios? Se suscribe a los cambios (girar la pantalla, mover la
 * barra lateral, encoger la ventana) sin `useEffect` ni parpadeo: `useSyncExternalStore` lee el
 * valor en el mismo render.
 */
export function useMediaQuery(query: string): boolean {
  const mql = useMemo(() => window.matchMedia(query), [query]);
  const suscribir = useCallback((avisar: () => void) => {
    mql.addEventListener('change', avisar);
    return () => mql.removeEventListener('change', avisar);
  }, [mql]);
  const leer = useCallback(() => mql.matches, [mql]);
  return useSyncExternalStore(suscribir, leer, () => false);
}

/**
 * ¿La ventana es ANGOSTA? Por defecto por debajo de 1024 px: la barra lateral ocupa 256 px y el
 * contenido lleva 80 px de margen, así que ahí abajo la tabla de 12 columnas ya no se lee de
 * frente y conviene apilarla.
 */
export function useVentanaAngosta(maxPx = 1023): boolean {
  return useMediaQuery(`(max-width: ${maxPx}px)`);
}
