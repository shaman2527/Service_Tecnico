import { useEffect, useRef } from 'react';

/**
 * F65 — Escape cierra SÓLO el panel que lo pide, no el diálogo grande que lo contiene.
 *
 * MEDIDO en vivo (2026-09-23): el `onKeyDown` de un input NO alcanza para esto. Radix
 * (`DismissableLayer`) escucha Escape en la fase de **CAPTURA sobre `document`** y su listener quedó
 * registrado cuando se montó el diálogo, así que corre ANTES que el del input: apretar Escape con el
 * panel «+ Nueva categoría» abierto **cerraba el formulario del producto entero** y se perdía todo lo
 * tipeado (~12 campos, sin confirmación ni borrador).
 *
 * La salida es interceptarlo en la captura de **`window`**: en el camino de captura el orden es
 * `window → document → … → target`, así que este listener corre primero, `preventDefault()` hace que
 * Radix no lo vea y `stopPropagation()` corta el camino (el input tampoco lo ve: ya está atendido).
 *
 * Es la misma familia de problema que el buscador de `LoadInventoryDialog` (ahí se resolvió con el
 * `onEscapeKeyDown` del contenido, porque el buscador vive DENTRO del mismo diálogo); acá el hook
 * sirve para cualquier panel que tenga que comerse su propio Escape, sin tener que subir el estado
 * hasta el diálogo de arriba.
 */
export function useEscapeGuard(abierto: boolean, onEscape: () => void) {
  // El callback se guarda en un ref: el listener se registra UNA vez por apertura (el `onEscape`
  // cambia en cada render porque suele ser una función inline).
  const cb = useRef(onEscape);
  useEffect(() => { cb.current = onEscape; });

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cb.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [abierto]);
}
