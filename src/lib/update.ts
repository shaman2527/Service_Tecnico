// update.ts — Lógica única del sistema de actualizaciones.
// Usado por: App.tsx (check al arranque + chequeo de salud post-update),
// Help.tsx (botón "Revisar actualizaciones") y UpdateDialog.tsx.
// Sin internet o sin Tauri: falla silenciosa (la app offline-first nunca se bloquea).

import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../db';

/** Última versión que el usuario pidió descargar con "Ver más tarde" — se le recuerda al reiniciar. */
const DOWNLOADED_KEY = 'update_downloaded_v';

export function downloadedVersion(): string {
  return localStorage.getItem(DOWNLOADED_KEY) ?? '';
}

export function rememberDownloaded(version: string) {
  try { localStorage.setItem(DOWNLOADED_KEY, version); } catch { /* sin storage */ }
}

export function clearDownloaded(version: string) {
  if (downloadedVersion() === version) {
    try { localStorage.removeItem(DOWNLOADED_KEY); } catch { /* sin storage */ }
  }
}

/** Busca actualización (5s máximo). Devuelve null si no hay, hay internet o hay error. */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 5000 });
    return update ?? null;
  } catch {
    // Sin internet / endpoint caído: silencio total (offline-first)
    return null;
  }
}

export function versionKey(update: Update): string {
  return update.version;
}
