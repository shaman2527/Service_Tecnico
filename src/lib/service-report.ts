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

import { SERVICE_TYPES, addDays, monthStart, parseServiceTypes } from './utils.ts';
import { isFinalStatus, STATUS_ENTREGADO, STATUS_POR_ENTREGAR } from './service-guide.ts';
// F58: las equivalencias de etiquetas («bateria» = «Cambio batería») viven en su propio módulo, con
// la tabla revisable. El plegado (`foldWork`) también sale de ahí para que haya UNA sola regla.
import { canonicalWorkKey, esNoTrabajo, foldWork } from './work-aliases.ts';
export { foldWork };

/**
 * Fila mínima que necesita el reporte: sirve tanto para `Service` (lista de Servicios) como para las
 * filas de historial del cliente. Se leen el estado, los trabajos y —desde F56— las fechas y el
 * importe (el resumen del día cuenta por fecha de RECIBO y por fecha de ENTREGA, y suma importes).
 * Todo opcional: las filas de historial del cliente no traen `date_out` y siguen funcionando.
 */
export interface WorkRow {
  status?: string | null;
  service_type?: string | null;
  service_types?: string | null;
  date_in?: string | null;
  date_out?: string | null;
  amount?: number | null;
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
 * Clave de agrupación de un trabajo: el plegado vive en `./work-aliases.ts` (`foldWork`, la MISMA
 * normalización que usan los modelos de teléfono) y se re-exporta desde acá para no tener dos reglas.
 */

/**
 * Claves de trabajo de una fila: plegadas, **canonicalizadas por la tabla de alias de F58**, sin
 * vacíos y sin repetir (una por trabajo). Es la ÚNICA puerta de entrada del conteo y del filtro, así
 * que un sinónimo aprobado («bateria») cuenta y filtra como su trabajo canónico («Cambio batería»), y
 * un equipo con la etiqueta vieja y la nueva cuenta UNA sola vez.
 */
export function workKeys(row: WorkRow): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of parseServiceTypes(row)) {
    const key = canonicalWorkKey(foldWork(label));
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
 * canónico de `SERVICE_TYPES` (más las categorías del local) y después las etiquetas libres por
 * cantidad (y por nombre para que el orden sea estable entre recargas).
 *
 * F62: `extras` son las categorías que AGREGA EL LOCAL (settings `work_types_extra`). Viajan como
 * parámetro —y no como constante importada— porque son datos de la base, no del producto: así este
 * módulo sigue siendo PURO y probable. Con ellas, una categoría propia se muestra y se ordena como
 * las del taller (`custom: false`) en vez de caer en «Anotados a mano».
 */
export function workCounts(rows: WorkRow[], extras: string[] = []): WorkCount[] {
  const etiquetasExtra = extras.map(e => (e ?? '').trim()).filter(Boolean);
  const clavesExtra = etiquetasExtra.map(foldWork);
  // Las del local van DESPUÉS de las canónicas y en el orden en que se agregaron (estable).
  const delTaller = [...CANONICAL_ORDER, ...clavesExtra.filter(k => k && !CANONICAL_ORDER.includes(k))];
  const labels = new Map<string, string>();
  for (const t of [...SERVICE_TYPES, ...etiquetasExtra]) {
    const key = foldWork(t);
    if (key && !labels.has(key)) labels.set(key, t);
  }
  const counts = new Map<string, WorkCount>();

  for (const row of rows) {
    const bucket = workBucket(row.status);
    const seen = new Set<string>();
    for (const raw of parseServiceTypes(row)) {
      // MISMA canonicalización que `workKeys` (F58): si acá se plegara sin la tabla de alias, el
      // contador mostraría «bateria» y «Cambio batería» como dos trabajos distintos y el número del
      // trabajo dejaría de ser el de las tarjetas filtradas. Es UNA puerta, no dos.
      const key = canonicalWorkKey(foldWork(raw));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!labels.has(key)) labels.set(key, raw.trim());
      let c = counts.get(key);
      if (!c) {
        c = { key, label: labels.get(key) as string, total: 0, entregados: 0, taller: 0, anulados: 0, custom: false };
        c.custom = !delTaller.includes(key);
        counts.set(key, c);
      }
      c.total++;
      if (bucket === 'entregado') c.entregados++;
      else if (bucket === 'anulado') c.anulados++;
      else c.taller++;
    }
  }

  const canon = delTaller
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
  /** Desglose REAL de los equipos sin trabajo anotado (no se inventa: sale de sus estados). */
  sinTrabajoEntregados: number;
  sinTrabajoTaller: number;
  sinTrabajoAnulados: number;
  porTrabajo: WorkCount[];
}

/** Todo el reporte de «Trabajos hechos» de la lista visible, en una sola pasada conceptual. */
export function serviceReport(rows: WorkRow[], extras: string[] = []): ServiceReport {
  let entregados = 0;
  let taller = 0;
  let anulados = 0;
  let sinTrabajo = 0;
  let sinTrabajoEntregados = 0;
  let sinTrabajoTaller = 0;
  let sinTrabajoAnulados = 0;
  for (const row of rows) {
    const bucket = workBucket(row.status);
    if (bucket === 'entregado') entregados++;
    else if (bucket === 'anulado') anulados++;
    else taller++;
    if (workKeys(row).length === 0) {
      sinTrabajo++;
      if (bucket === 'entregado') sinTrabajoEntregados++;
      else if (bucket === 'anulado') sinTrabajoAnulados++;
      else sinTrabajoTaller++;
    }
  }
  return {
    equipos: rows.length,
    entregados,
    taller,
    anulados,
    sinTrabajo,
    sinTrabajoEntregados,
    sinTrabajoTaller,
    sinTrabajoAnulados,
    porTrabajo: workCounts(rows, extras),
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

// ── F56 — RESUMEN DEL DÍA (recibidos hoy · entregados hoy · qué trabajos se hicieron) ──────────
//
// Pedido del dueño (2026-09-21, con captura de la pantalla): «el cliente me pregunta quiero ver en
// mis servicios cuántas pantallas hice hoy, o cuántos equipos recibí hoy, cuántos entregué hoy… se
// clasifique bien pero no así como la foto, que se ve abrumador con ese poco de types».
//
// El resumen tiene SU PROPIO alcance (por defecto HOY) y NO se calcula sobre la lista filtrada: si
// el operario dejó la lista en «Entregado + agosto», el número del día tiene que seguir diciendo la
// verdad del día. Por eso la pantalla le pasa TODAS las órdenes (una sola consulta) y acá se recorta.
//
// DOS EJES, UNA SOLA CUENTA: lo RECIBIDO se cuenta por fecha de RECIBO (`date_in`) y lo ENTREGADO
// por fecha de ENTREGA (`date_out`) — el mismo alcance aplicado a cada eje, que es exactamente lo
// que pregunta el cliente («de hoy: recibí 18 y entregué 11»). En cambio «en taller», «listos para
// entregar» y los anulados NO dependen del rango: son el estado del taller AHORA, y la pantalla lo
// dice con todas las letras para que nadie sume peras con manzanas.

export interface DateRange {
  /** Primera fecha del rango (YYYY-MM-DD, local). Vacío = sin límite. */
  start: string;
  /** Última fecha del rango (YYYY-MM-DD, local). Vacío = sin límite. */
  end: string;
}

/** El DÍA de un sello de fecha/hora. Es el mismo criterio que `service-guide.photoOutIsCurrent`:
 *  las fechas del backend vienen como «YYYY-MM-DD HH:MM:SS» y se comparan por día, nunca por texto
 *  completo (por eso `date_in === hoy` daba SIEMPRE falso y hacía desaparecer lo de hoy). */
export const dayOf = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

/** ¿Ese día cae dentro del rango? Sin fecha NO se puede ubicar en el tiempo (queda afuera). */
export function inRange(dia: string, range: DateRange): boolean {
  if (!dia) return false;
  if (range.start && dia < range.start) return false;
  if (range.end && dia > range.end) return false;
  return true;
}

export type ScopeKind = 'hoy' | '7d' | 'mes';

/**
 * Rango de fechas de un atajo del resumen, en fechas LOCALES del local (`localDate`/`addDays`/
 * `monthStart` de utils: nunca `toISOString`, que en Venezuela da el día siguiente después de las
 * 20:00). «7 días» incluye HOY (hoy + los 6 anteriores). Sin fecha de hoy → rango abierto.
 */
export function rangeFor(kind: ScopeKind, hoy: string): DateRange {
  if (!hoy) return { start: '', end: '' };
  if (kind === 'hoy') return { start: hoy, end: hoy };
  if (kind === '7d') return { start: addDays(hoy, -6), end: hoy };
  return { start: monthStart(hoy), end: hoy };
}

/** Orden por CANTIDAD: los trabajos más hechos primero (y por nombre para que sea estable). */
export function sortByCount(counts: WorkCount[]): WorkCount[] {
  return [...counts].sort((a, b) => (b.total - a.total) || a.label.localeCompare(b.label, 'es'));
}

/** Los N trabajos más hechos: los «destacados» del resumen (los que el cliente pregunta siempre). */
export function topWorks(counts: WorkCount[], n = 4): WorkCount[] {
  return sortByCount(counts).slice(0, Math.max(0, n));
}

export interface ScopeSummary {
  range: DateRange;
  /** Equipos del alcance que se RECIBIERON en el rango (por fecha de recibo). */
  recibidos: number;
  /** Equipos del alcance que se ENTREGARON en el rango (por fecha de entrega). */
  entregados: number;
  /** Importe de lo recibido / de lo entregado en el rango (lo que el taller se comprometió y lo
   *  que salió). NO es «cobrado»: la caja la cuenta el Libro Diario con los pagos reales. */
  montoRecibido: number;
  montoEntregado: number;
  /** Estado del taller AHORA (no depende del rango): abiertos, listos y anulados. */
  taller: number;
  listos: number;
  anulados: number;
  /** Equipos totales del alcance (lo que hay en la base que se pasó). */
  equipos: number;
  /** Desglose por trabajo, ordenado por cantidad (el «cuántas pantallas» de la pregunta). */
  porTrabajoRecibidos: WorkCount[];
  porTrabajoEntregados: WorkCount[];
  /** Equipos del rango sin ningún trabajo anotado (para que los números cierren). */
  recibidosSinTrabajo: number;
  entregadosSinTrabajo: number;
  /** F59: equipos del rango que tienen anotada garantía o venta (aunque además tengan un trabajo
   *  real). Se cuentan acá y NO se listan como trabajos del taller en el desglose (no se puede decir
   *  «hice 8 garantías»), así el operario entiende por qué el desglose no suma el total del día. */
  recibidosNoTrabajo: number;
  entregadosNoTrabajo: number;
}

/**
 * El resumen del alcance: cuántos equipos se recibieron y se entregaron, por cuánto, y QUÉ TRABAJOS
 * se hicieron — con el mismo `workCounts`/`workBucket` del resto del módulo, así el número del
 * resumen no puede separarse del número de la lista.
 */
export function scopeSummary(rows: WorkRow[], range: DateRange, extras: string[] = []): ScopeSummary {
  const recibidos: WorkRow[] = [];
  const entregados: WorkRow[] = [];
  let taller = 0;
  let listos = 0;
  let anulados = 0;
  for (const row of rows) {
    const bucket = workBucket(row.status);
    if (bucket === 'entregado') { /* ya no está en el taller */ }
    else if (bucket === 'anulado') anulados++;
    else {
      taller++;
      if ((row.status ?? '') === STATUS_POR_ENTREGAR) listos++;
    }
    if (inRange(dayOf(row.date_in), range)) recibidos.push(row);
    if (inRange(dayOf(row.date_out), range)) entregados.push(row);
  }
  const suma = (rs: WorkRow[]) => rs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const sinTrabajo = (rs: WorkRow[]) => rs.filter(r => workKeys(r).length === 0).length;
  // F59: «garantía» y «VENTA» están anotadas como etiqueta pero NO son trabajos hechos: no se cuentan
  // en el desglose por trabajo (sería mentir: «hice 8 garantías» no es un trabajo) y se informan aparte.
  const noTrabajo = (rs: WorkRow[]) => rs.filter(r => workKeys(r).some(esNoTrabajo)).length;
  return {
    range,
    recibidos: recibidos.length,
    entregados: entregados.length,
    montoRecibido: suma(recibidos),
    montoEntregado: suma(entregados),
    taller,
    listos,
    anulados,
    equipos: rows.length,
    porTrabajoRecibidos: sortByCount(workCounts(recibidos, extras).filter(c => !esNoTrabajo(c.key))),
    porTrabajoEntregados: sortByCount(workCounts(entregados, extras).filter(c => !esNoTrabajo(c.key))),
    recibidosSinTrabajo: sinTrabajo(recibidos),
    entregadosSinTrabajo: sinTrabajo(entregados),
    recibidosNoTrabajo: noTrabajo(recibidos),
    entregadosNoTrabajo: noTrabajo(entregados),
  };
}

/**
 * La línea que dice SOBRE QUÉ se está contando en el resumen. El alcance se dice SIEMPRE: un número
 * sin su alcance no se puede defender frente al cliente.
 */
export function summaryScopeLabel(range: DateRange, hoy: string): string {
  const eje = 'recibidos por fecha de recibo · entregados por fecha de entrega';
  if (!range.start && !range.end) return `Todo el historial · ${eje}`;
  if (range.start === range.end) {
    return `${range.start === hoy ? `Hoy (${range.start})` : range.start} · ${eje}`;
  }
  if (!range.start) return `Hasta el ${range.end} · ${eje}`;
  if (!range.end) return `Desde el ${range.start} · ${eje}`;
  return `Del ${range.start} al ${range.end} · ${eje}`;
}
