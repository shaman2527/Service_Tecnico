// F76 — los ganchos de React del bus de sincronización (`src/lib/sync.ts` es la regla, sin React).
//
// Uso en una pantalla:
//   const version = useDataVersion();
//   useEffect(() => { cargar(); }, [version, ...]);
// y listo: cualquier escritura de la app (o volver a la ventana) vuelve a cargar sus datos.

import { useEffect, useState } from 'react';
import { dataVersion, onDataChanged, ultimoAviso, haceCuanto } from './sync';

/** La versión de los datos: cambia con cada escritura. Se usa como dependencia de la carga. */
export function useDataVersion(): number {
  const [v, setV] = useState(dataVersion);
  useEffect(() => onDataChanged(nv => setV(nv)), []);
  return v;
}

/** El rótulo del indicador («hace un momento», «hace 3 min») que se refresca solo cada 20 s. */
export function useSyncLabel(): { texto: string; motivo: string; version: number } {
  const version = useDataVersion();
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);
  const { motivo, cuando } = ultimoAviso();
  return { texto: haceCuanto(cuando, ahora), motivo, version };
}
