// F76 — LA APP SE ACTUALIZA SOLA (regla pura, sin React).
//
// Pedido del dueño (2026-09-25): «en la app de admin tengo que darle actualizar para lo que haga…
// de una vez rápido esté todo sincronizado». Traducción: **nada de apretar «Actualizar»**. Cuando se
// registra, cobra, edita, anula, cierra o carga algo, TODAS las pantallas tienen que quedar al día
// solas; y al volver a la app (o al cambiar de pantalla) los datos tienen que estar frescos.
//
// CÓMO FUNCIONA (una sola implementación para toda la app):
//   · `tauriInvoke` (src/db.ts) avisa acá DESPUÉS de cada comando de ESCRITURA que salió bien
//     (`bumpDataVersion`). Los comandos de LECTURA no avisan: si no, cada consulta dispararía un
//     refresco y se armaría un bucle.
//   · Las pantallas se suscriben (`onDataChanged` / el hook `useDataVersion`) y vuelven a leer lo suyo.
//   · El aviso se COALESCE: una ráfaga de escrituras (guardar una orden multi-equipo escribe N filas)
//     produce UN solo refresco, no N. Y como los comandos de lectura nunca avisan, un refresco no
//     puede provocar otro refresco (no hay bucle posible).
//   · Además se avisa al volver a la ventana (foco/visibilidad): si algo se cambió desde afuera
//     (otra sesión, un respaldo restaurado, la base tocada a mano), al volver ya está al día.
//
// Pruebas: `node tools/sync_test.ts` (puras, sin navegador).

/** Prefijos de los comandos que ESCRIBEN (todo lo demás se considera lectura). */
const PREFIJOS_ESCRITURA = [
  'add_', 'update_', 'set_', 'delete_', 'remove_', 'mark_', 'void_', 'reopen_', 'close_', 'open_',
  'import_', 'apply_', 'load_', 'restore_', 'backup_', 'merge_', 'rename_', 'normalize_',
  'split_', 'wipe_', 'rebuild_', 'recalc_', 'reset_', 'print_', 'create_', 'insert_', 'save_',
];

/**
 * Prefijos que NO escriben aunque empiecen como arriba (o que escriben sólo memoria/archivo y no
 * cambian lo que muestran las pantallas). Se revisan ANTES que los de escritura.
 */
const PREFIJOS_LECTURA = [
  'get_', 'list_', 'search_', 'suggest_', 'count_', 'check_', 'verify_', 'validate_', 'preview_',
  'export_', 'test_', 'health_', 'report_', 'print_preview', 'list_windows_printers',
];

/**
 * ¿Este comando CAMBIA datos (y por lo tanto hay que refrescar las pantallas cuando termina)?
 * Fail-closed al revés: ante la duda se considera LECTURA (no refresca) — un refresco de más es ruido,
 * pero un comando de escritura mal clasificado como lectura dejaría una pantalla vieja.
 */
export function comandoEscribe(cmd: string): boolean {
  const c = String(cmd || '').trim().toLowerCase();
  if (!c) return false;
  if (PREFIJOS_LECTURA.some(p => c.startsWith(p))) return false;
  return PREFIJOS_ESCRITURA.some(p => c.startsWith(p));
}

/** Versión de los datos: sube con cada cambio. Las pantallas la usan como dependencia de su carga. */
let version = 1;
/** Los que escuchan (las pantallas). */
const oyentes = new Set<(v: number, motivo: string) => void>();
/** Cuántos avisos están suspendidos (una pantalla que recarga en medio de una ráfaga). */
let suspendidos = 0;
let avisoProgramado: ReturnType<typeof setTimeout> | null = null;
/** El último motivo (para el rótulo «actualizado por: …» y para depurar). */
let ultimoMotivo = 'arranque';
let ultimoCuando = Date.now();

/** La versión actual (arranca en 1: `0` no es un estado válido para una dependencia de React). */
export const dataVersion = () => version;

/** Cuándo se avisó por última vez (para el indicador «actualizado hace un momento»). */
export const ultimoAviso = () => ({ motivo: ultimoMotivo, cuando: ultimoCuando });

/**
 * Escucha los cambios. Devuelve la función para dejar de escuchar (las pantallas la usan en el
 * cleanup del efecto: si no, cada montaje dejaría un oyente colgado).
 */
export function onDataChanged(fn: (v: number, motivo: string) => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}

/**
 * Avisa que los datos cambiaron. **Coalescido**: si llegan varios avisos seguidos (guardar una orden
 * multi-equipo, cargar un inventario, un cierre que escribe varias tablas) se manda UNO solo. Se
 * puede pedir `inmediato` para los casos en que la pantalla tiene que reaccionar ya (p. ej. el aviso
 * de la ventana que recupera el foco).
 */
export function bumpDataVersion(motivo = 'cambio', opts: { inmediato?: boolean } = {}): void {
  ultimoMotivo = motivo;
  ultimoCuando = Date.now();
  if (suspendidos > 0) return;
  if (opts.inmediato) {
    if (avisoProgramado) { clearTimeout(avisoProgramado); avisoProgramado = null; }
    version += 1;
    for (const fn of [...oyentes]) fn(version, motivo);
    return;
  }
  if (avisoProgramado) return; // ya hay uno programado: se junta con ese
  avisoProgramado = setTimeout(() => {
    avisoProgramado = null;
    version += 1;
    for (const fn of [...oyentes]) fn(version, motivo);
  }, COALESCE_MS);
}

/** Cuánto se espera para juntar una ráfaga de escrituras en un solo refresco (ms). */
export const COALESCE_MS = 120;

/**
 * Suspende los avisos mientras corre `fn` (lo usa una recarga que ella misma escribe algo, para no
 * dispararse a sí misma). Siempre reanuda, incluso si `fn` falla.
 */
export async function sinAvisar<T>(fn: () => Promise<T>): Promise<T> {
  suspendidos += 1;
  try {
    return await fn();
  } finally {
    suspendidos -= 1;
  }
}

/** Para las pruebas: deja el bus como recién arrancado. */
export function reiniciarSync(): void {
  if (avisoProgramado) { clearTimeout(avisoProgramado); avisoProgramado = null; }
  oyentes.clear();
  suspendidos = 0;
  version = 1;
  ultimoMotivo = 'arranque';
  ultimoCuando = Date.now();
}

/** «hace un momento» / «hace 3 min» — el rótulo del indicador de sincronización. */
export function haceCuanto(desde: number, ahora: number = Date.now()): string {
  const seg = Math.max(0, Math.round((ahora - desde) / 1000));
  if (seg < 10) return 'hace un momento';
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}
