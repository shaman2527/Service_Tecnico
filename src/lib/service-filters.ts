/**
 * F81 — LOS FILTROS DE LA LISTA DE SERVICIOS Y SU «PREDETERMINADO».
 *
 * Pedido del dueño (2026-09-27): «cuando escribo en el filtro, en servicio, y cuando vaya a registrar
 * un servicio nuevo el filtro automáticamente se ponga sin filtro predeterminado, se borre la
 * búsqueda, porque a veces cuando creo un servicio y tiene un filtro activado me confunde la card:
 * debería aparecerme el servicio que acabe de registrar».
 *
 * POR QUÉ ESTE MÓDULO (y no seis `useState('')` sueltos en la pantalla): el «predeterminado» es una
 * REGLA DE NEGOCIO, no un detalle de UI. El estado en el que una orden recién RECIBIDA se ve es
 * exactamente éste: `''` = Todos los estados (F44), sin búsqueda, eje «Recibidos» (F32) y sin rango
 * de fechas. Una orden nueva NO tiene `date_out`, así que con el eje «Entregados» —o con el botón
 * «Entregados hoy», que deja estado=Entregado + eje=out + hoy— la tarjeta recién creada es
 * INVISIBLE por definición. Ese es el caso que confundía al operario.
 *
 * Es una regla PURA (sin React) y tiene pruebas: `node tools/service_filters_test.ts`.
 */

/** Los seis filtros de la lista, con los MISMOS nombres y tipos que el estado de `Services.tsx`. */
export interface ServiceFilters {
  /** Búsqueda de texto libre (cliente, cédula, modelo, número de orden) */
  search: string;
  /** Estado de la orden; `''` = TODOS LOS ESTADOS (F44). Se llama igual que el estado del componente
   *  (`statusFilter`) para que el objeto se pueda pasar y devolver tal cual, sin traducciones. */
  statusFilter: string;
  /** Chip de trabajo (client-side); `''` = todos los trabajos */
  typeFilter: string;
  /** Eje del rango de fechas: `'in'` recibidos · `'out'` entregados (F32) */
  dateField: 'in' | 'out';
  /** Desde (AAAA-MM-DD); `''` = sin límite */
  dateStart: string;
  /** Hasta (AAAA-MM-DD); `''` = sin límite */
  dateEnd: string;
}

/**
 * EL PREDETERMINADO — el estado en el que la lista muestra TODA la base (y por lo tanto la orden que
 * se acaba de registrar). Cualquier cambio acá cambia lo que ve el operario al ir a registrar.
 */
export const DEFAULT_SERVICE_FILTERS: Readonly<ServiceFilters> = Object.freeze({
  search: '',
  statusFilter: '',
  typeFilter: '',
  dateField: 'in' as const,
  dateStart: '',
  dateEnd: '',
});

/** Copia FRESCA del predeterminado (nunca el objeto compartido: el estado de React es mutable por
 *  quien lo reciba). */
export function defaultServiceFilters(): ServiceFilters {
  return { ...DEFAULT_SERVICE_FILTERS };
}

/** ¿Los filtros están EXACTAMENTE en el predeterminado? (sirve para no recargar la lista de gusto) */
export function isDefaultServiceFilters(f: Partial<ServiceFilters> | null | undefined): boolean {
  if (!f) return false;
  return f.search === DEFAULT_SERVICE_FILTERS.search
    && f.statusFilter === DEFAULT_SERVICE_FILTERS.statusFilter
    && f.typeFilter === DEFAULT_SERVICE_FILTERS.typeFilter
    && f.dateField === DEFAULT_SERVICE_FILTERS.dateField
    && f.dateStart === DEFAULT_SERVICE_FILTERS.dateStart
    && f.dateEnd === DEFAULT_SERVICE_FILTERS.dateEnd;
}

/**
 * EL BOTÓN «Limpiar filtros» (el del operario, a mano): quita búsqueda, estado, rango de fechas y el
 * chip de trabajo. **CONSERVA EL EJE** (Recibidos/Entregados) a propósito — decisión de F44: sin
 * rango de fechas el eje no filtra nada, y cambiarlo solo porque alguien limpió la búsqueda sería
 * moverle la pantalla sin que lo haya pedido. El eje SÍ vuelve a «Recibidos» en el reset del alta
 * (`defaultServiceFilters`), que es una regla distinta y con otro motivo.
 */
export function clearServiceFilters(f: ServiceFilters): ServiceFilters {
  return { ...f, search: '', statusFilter: '', typeFilter: '', dateStart: '', dateEnd: '' };
}

/**
 * F81 — EL RESET DEL ALTA: los filtros que la lista tiene que mostrar cuando el operario va a
 * registrar (o cuando acaba de registrar). Es el predeterminado COMPLETO, eje incluido.
 * Existe como función con nombre (y no como `defaultServiceFilters()` suelto en la pantalla) para
 * que el día que cambie el predeterminado cambie en un solo lugar.
 */
export function resetFiltersForNewOrder(): ServiceFilters {
  return defaultServiceFilters();
}
