// TRABAJOS HECHOS (F44): cuántos equipos y QUÉ TRABAJOS se hicieron en lo que se está viendo.
//
// Pedido del dueño (2026-09-20): «el cliente me pregunta cuántas pantallas hice hoy o un día en
// específico… cuando cambio el filtro debería darme los servicios que he hecho, cambio de pantalla
// por ejemplo o cambio de pin, y en entregado no me aparecen… quiero saber qué servicios hago, que
// todo salga bien reflejado».
//
// El defecto que arregla este módulo: los contadores de la lista de Servicios se calculaban sobre las
// órdenes ACTIVAS (`enTaller`), así que al filtrar por «Entregado» —justo cuando el dueño quiere
// contar lo que ya salió— TODOS los chips desaparecían; y el texto libre de «Otro» (el formulario
// sugiere «Cambio de pin de carga») no tenía contador porque los chips solo salían de SERVICE_TYPES.
//
// Dos invariantes que sostienen la confianza en el número (y que la prueba pura fija):
//   1. **el chip cuenta lo mismo que las tarjetas que aparecen al hacerle clic** — el conteo y el
//      filtro usan la MISMA función (`workKeys` / `matchesWorkFilter`);
//   2. **los números cierran**: todo equipo cae en algún trabajo o en «Sin trabajo anotado», y
//      `entregados + taller + anulados === equipos`.
//
// Reglas de agrupación: se pliega la etiqueta como se pliegan los modelos (`normPhoneModel`:
// minúsculas, sin acentos, sin puntuación), así «pin de carga» cuenta junto a «Pin de Carga». NO hay
// fusión difusa: «Cambio de pantalla» y «Cambio pantalla» son dos trabajos distintos porque son dos
// textos distintos (adivinar sería peor que mostrar de más).
//
// Módulo PURO (sin React): se prueba sin navegador en `tools/service_report_test.ts`.

import { SERVICE_TYPES, normPhoneModel, parseServiceTypes } from './utils.ts';
import { isFinalStatus, STATUS_ENTREGADO } from './service-guide.ts';

/**
 * Fila mínima que necesita el reporte: sirve tanto para `Service` (lista de Servicios) como para las
 * filas de historial del cliente. Solo se leen el estado y los trabajos.
 */
export interface WorkRow {
  status?: string | null;
  service_type?: string | null;
  service_types?: string | null;
}

/**
 * «Solo lo que está en taller»: el identificador que entiende el backend (`get_services`) y que la
 * cola de entregas usa como `ACTIVE_QUEUE` (`src/lib/queue.ts`). Se repite acá como literal a
 * propósito: `queue.ts` importa `./utils` SIN extensión, así que importarlo rompería la prueba pura
 * de Node. La prueba fija el literal (contrato con el backend).
 */
export const ACTIVE_SENTINEL = '__activos__';

/** Filtro del chip «Sin trabajo anotado» (no es una etiqueta, es la AUSENCIA de trabajos). */
export const NO_WORK_FILTER = '__sin_trabajo__';

/** Se dice en pantalla para que los números no se lean mal (un equipo con 2 trabajos suma en 2). */
export const WORK_COUNT_NOTE = 'un equipo con varios trabajos cuenta en cada uno';

/**
 * Clave de agrupación de un trabajo: la MISMA normalización que usan los modelos de teléfono
 * (`normPhoneModel`), para no tener dos reglas de plegado en el proyecto.
 */
export const foldWork = (label: string | null | undefined): string => normPhoneModel(label ?? '');

/** Claves de trabajo de una fila: plegadas, sin vacíos y sin repetir (una por trabajo). */
export function workKeys(row: WorkRow): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of parseServiceTypes(row)) {
    const key = foldWork(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * ¿Esta fila entra en el filtro de trabajos? `''` = todos · `NO_WORK_FILTER` = los que no tienen
 * ningún trabajo anotado · cualquier otra cosa = la clave plegada de un trabajo.
 *
 * Es la ÚNICA regla de pertenencia: la usan el filtro de la lista y el conteo de cada chip, así el
 * número del chip no puede mentir.
 */
export function matchesWorkFilter(row: WorkRow, filter: string): boolean {
  if (!filter) return true;
  const keys = workKeys(row);
  if (filter === NO_WORK_FILTER) return keys.length === 0;
  return keys.includes(filter);
}

export type WorkBucket = 'entregado' | 'anulado' | 'taller';

/**
 * En qué grupo cae una orden según su estado. Es el MISMO criterio del backend para «Activos en
 * taller» (`status NOT IN ('Entregado','Cancelado','Devuelto','Cancelado / Devuelto')`), así el
 * «en taller» del reporte coincide con lo que muestra ese filtro; y como los tres grupos son
 * excluyentes y exhaustivos, `entregados + taller + anulados === equipos` siempre.
 */
export function workBucket(status: string | null | undefined): WorkBucket {
  const s = status ?? '';
  if (s === STATUS_ENTREGADO) return 'entregado';
  if (isFinalStatus(s)) return 'anulado';
  return 'taller';
}

export interface WorkCount {
  /** Clave plegada (es también el valor del filtro: el chip y el filtro hablan el mismo idioma). */
  key: string;
  /** Etiqueta que se muestra: la canónica de `SERVICE_TYPES`, o la grafía con que se anotó. */
  label: string;
  total: number;
  entregados: number;
  taller: number;
  anulados: number;
  /** true = etiqueta libre (escrita a mano en «Otro»), no está en la lista canónica. */
  custom: boolean;
}

/** Orden canónico de los trabajos (posición estable en la barra de chips: siempre el mismo lugar). */
const CANONICAL_ORDER: string[] = SERVICE_TYPES
  .map(t => foldWork(t))
  .filter((k, i, all) => k !== '' && all.indexOf(k) === i);

/**
 * Contadores por trabajo de las filas recibidas (la lista que se está viendo, sea cual sea el
 * estado: ENTREGADOS INCLUIDOS). Solo se devuelven los trabajos con al menos un equipo, en el orden
 * canónico de `SERVICE_TYPES` y después las etiquetas libres por cantidad (y por nombre para que el
 * orden sea estable entre recargas).
 */
export function workCounts(rows: WorkRow[]): WorkCount[] {
  const labels = new Map<string, string>();
  for (const t of SERVICE_TYPES) {
    const key = foldWork(t);
    if (key && !labels.has(key)) labels.set(key, t);
  }
  const counts = new Map<string, WorkCount>();

  for (const row of rows) {
    const bucket = workBucket(row.status);
    const seen = new Set<string>();
    for (const raw of parseServiceTypes(row)) {
      const key = foldWork(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!labels.has(key)) labels.set(key, raw.trim());
      let c = counts.get(key);
      if (!c) {
        c = { key, label: labels.get(key) as string, total: 0, entregados: 0, taller: 0, anulados: 0, custom: false };
        c.custom = !CANONICAL_ORDER.includes(key);
        counts.set(key, c);
      }
      c.total++;
      if (bucket === 'entregado') c.entregados++;
      else if (bucket === 'anulado') c.anulados++;
      else c.taller++;
    }
  }

  const canon = CANONICAL_ORDER
    .map(k => counts.get(k))
    .filter((c): c is WorkCount => !!c && c.total > 0);
  const custom = [...counts.values()]
    .filter(c => c.custom && c.total > 0)
    .sort((a, b) => (b.total - a.total) || a.label.localeCompare(b.label, 'es'));
  return [...canon, ...custom];
}

export interface ServiceReport {
  /** Equipos (filas) en la lista: en multi-equipo cada teléfono cuenta uno. */
  equipos: number;
  entregados: number;
  taller: number;
  anulados: number;
  sinTrabajo: number;
  porTrabajo: WorkCount[];
}

/** Todo el reporte de «Trabajos hechos» de la lista visible, en una sola pasada conceptual. */
export function serviceReport(rows: WorkRow[]): ServiceReport {
  let entregados = 0;
  let taller = 0;
  let anulados = 0;
  let sinTrabajo = 0;
  for (const row of rows) {
    const bucket = workBucket(row.status);
    if (bucket === 'entregado') entregados++;
    else if (bucket === 'anulado') anulados++;
    else taller++;
    if (workKeys(row).length === 0) sinTrabajo++;
  }
  return {
    equipos: rows.length,
    entregados,
    taller,
    anulados,
    sinTrabajo,
    porTrabajo: workCounts(rows),
  };
}

export interface ScopeInput {
  /** Estado elegido en el filtro: `''` = todos · `ACTIVE_SENTINEL` = activos · o el nombre exacto. */
  status: string;
  dateField: 'in' | 'out';
  start: string;
  end: string;
}

/**
 * La línea que dice SOBRE QUÉ se está contando (estado, eje de fecha y rango). Sin esto el número no
 * se puede defender frente al cliente: «4 pantallas» no significa nada si no se sabe de qué día y de
 * qué estados.
 */
export function scopeLabel(o: ScopeInput): string {
  const estado = !o.status
    ? 'todos los estados'
    : o.status === ACTIVE_SENTINEL
      ? 'solo los activos en taller (sin entregados ni anulados)'
      : `estado «${o.status}»`;
  const eje = o.dateField === 'out' ? 'por fecha de ENTREGA' : 'por fecha de RECIBO';
  const rango = o.start && o.end
    ? (o.start === o.end ? `del ${o.start}` : `del ${o.start} al ${o.end}`)
    : o.start ? `desde el ${o.start}`
      : o.end ? `hasta el ${o.end}`
        : 'todo el historial';
  return `Contando: ${estado} · ${eje} · ${rango} · ${WORK_COUNT_NOTE}`;
}

/**
 * Combinaciones que NO PUEDEN dar resultados (y que por eso hay que EXPLICAR en vez de mostrar una
 * lista vacía muda): una orden sigue en taller justamente porque todavía no tiene fecha de entrega,
 * así que «Activos en taller» + rango por fecha de ENTREGA es vacío por definición.
 */
export function scopeProblem(o: { status: string; dateField: 'in' | 'out' }): 'activos-sin-entrega' | null {
  return o.status === ACTIVE_SENTINEL && o.dateField === 'out' ? 'activos-sin-entrega' : null;
}
