// F71 — RESPALDO Y RESTAURACIÓN: las reglas de la PANTALLA (módulo PURO, sin React).
//
// El bloqueante A2 de la auditoría de entrega: los comandos de respaldo existían pero **ninguna pantalla
// los llamaba**, y lo único que la app le decía al dueño era «copiá registro.db a un USB» (la Ayuda).
// El backend (`backups.rs`) hace la copia consistente, la retención y la restauración diferida; acá
// viven las tres cosas que la pantalla tiene que decir ANTES de tocar nada:
//
//   1. **Cómo está el respaldo hoy**: cuándo fue el último, si falló alguno (un respaldo que nunca se
//      hizo es la diferencia entre perder un día y perder el negocio), y qué carpeta se está usando.
//   2. **Qué va a pasar al restaurar**: qué archivo se aplica, de qué fecha es, que **primero se guarda
//      una copia de lo que hay ahora** y que la app se reinicia para aplicarlo.
//   3. **Qué NO se puede restaurar**: un archivo que no es de la app, o uno de una versión con más
//      datos que la actual (avisar, no adivinar).

/** Un respaldo tal como lo devuelve el backend (`backups::BackupInfo`). */
export interface Respaldo {
  name: string;
  path: string;
  size_bytes: number;
  created_at: string;
  automatico: boolean;
  seguridad: boolean;
}

/** El estado que muestra la pantalla (`backups::BackupStatus`). */
export interface EstadoRespaldo {
  dir: string;
  total: number;
  ultimo: Respaldo | null;
  error: string | null;
  retencion: number;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Tamaño legible (lo mismo que hace el backend, para que no haya dos formatos). */
export function tamanoLegible(bytes: number): string {
  const b = bytes ?? 0;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/** `AAAA-MM-DD HH:MM:SS` → «23/09/2026 18:15». Sin fecha → «—» (nunca se inventa). */
export function fechaLegible(created_at: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(created_at ?? '');
  if (!m) return '—';
  const [, a, mes, d, h, min] = m;
  return `${d}/${mes}/${a} ${h}:${min}`;
}

/** Días completos transcurridos entre dos fechas locales (`AAAA-MM-DD`). */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00`);
  const b = Date.parse(`${hasta}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000);
}

export interface SaludRespaldo {
  /** `sin_respaldo` = nunca se hizo · `al_dia` = hoy · `atrasado` = 1-2 días · `viejo` = 3+ días. */
  estado: 'sin_respaldo' | 'al_dia' | 'atrasado' | 'viejo';
  /** Qué decir en pantalla (nunca un número solo). */
  texto: string;
  /** ¿Hay que preocuparse? (color ámbar/rojo en la pantalla). */
  alerta: boolean;
}

/**
 * ¿El respaldo está al día? Un respaldo de HOY es lo esperado (el cierre del día lo deja solo); 1-2
 * días atrás es un aviso; 3+ días es un problema que el dueño tiene que ver.
 */
export function saludRespaldo(estado: Pick<EstadoRespaldo, 'ultimo' | 'error'>, hoy: string): SaludRespaldo {
  if (estado.error?.trim()) {
    return { estado: 'viejo', texto: `El último respaldo FALLÓ: ${estado.error.trim()}`, alerta: true };
  }
  const ultimo = estado.ultimo;
  if (!ultimo) {
    return {
      estado: 'sin_respaldo',
      texto: 'Todavía no hay ningún respaldo: si esta PC se rompe, se pierde todo el negocio. Hacé uno ahora.',
      alerta: true,
    };
  }
  const dia = (ultimo.created_at ?? '').slice(0, 10);
  const dias = diasEntre(dia, hoy);
  if (dias <= 0) return { estado: 'al_dia', texto: `Respaldo de hoy (${fechaLegible(ultimo.created_at)}). Todo al día.`, alerta: false };
  if (dias <= 2) return { estado: 'atrasado', texto: `El último respaldo es de hace ${dias} día${dias === 1 ? '' : 's'} (${fechaLegible(ultimo.created_at)}).`, alerta: true };
  return { estado: 'viejo', texto: `El último respaldo es de hace ${dias} días (${fechaLegible(ultimo.created_at)}): hacé uno nuevo.`, alerta: true };
}

/** Etiqueta corta de cada respaldo en la lista. */
export function etiquetaRespaldo(r: Pick<Respaldo, 'automatico' | 'seguridad' | 'created_at'>): string {
  if (r.seguridad) return 'Copia previa a una restauración';
  if (r.automatico) return 'Automático (al cerrar el día)';
  return 'Lo pediste vos';
}

/** ¿Se puede restaurar este archivo? (la pantalla no ofrece lo que el backend va a rechazar) */
export function puedeRestaurar(path: string): { ok: boolean; motivo?: string } {
  const p = (path ?? '').trim();
  if (!p) return { ok: false, motivo: 'Elegí un respaldo de la lista.' };
  if (!/\.db$/i.test(p)) return { ok: false, motivo: 'Tiene que ser un archivo .db de un respaldo.' };
  return { ok: true };
}

/**
 * El texto de confirmación que el dueño tiene que leer ANTES de restaurar: qué archivo, de cuándo, que
 * se guarda una copia de lo actual y que la app se reinicia. Sin esto, restaurar es un botón que
 * asusta (y con razón: pisa todo el negocio).
 */
export function textoRestauracion(r: Pick<Respaldo, 'name' | 'created_at' | 'size_bytes'>, totalActual: number): string {
  return [
    `Se va a reemplazar la base actual por «${r.name}» (del ${fechaLegible(r.created_at)}, ${tamanoLegible(r.size_bytes)}).`,
    `Antes se guarda una copia de lo que hay ahora (${totalActual} respaldo${totalActual === 1 ? '' : 's'} en la carpeta), así que se puede volver atrás.`,
    'La app se reinicia para aplicar el cambio. Todo lo cargado DESPUÉS de ese respaldo se pierde.',
  ].join(' ');
}

/** Texto del día de la semana para el nombre del respaldo (lo muestra el botón de respaldar). */
export function diaSemana(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DIAS[d.getDay()];
}
