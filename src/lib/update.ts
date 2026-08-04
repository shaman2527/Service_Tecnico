// update.ts — Lógica única del sistema de actualizaciones.
// Usado por: App.tsx (check al arranque + chequeo de salud post-update),
// Help.tsx (botón "Revisar actualizaciones") y UpdateDialog.tsx.
// Sin internet o sin Tauri: falla silenciosa (la app offline-first nunca se bloquea).

import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../db';

/** Versión descartada por el usuario ("Recordar después") — no volver a preguntar por ella. */
const DISMISS_KEY = 'update_dismissed_v';

export function dismissedVersion(): string {
  return localStorage.getItem(DISMISS_KEY) ?? '';
}

export function rememberDismissed(version: string) {
  try { localStorage.setItem(DISMISS_KEY, version); } catch { /* sin storage */ }
}

export function clearDismissed(version: string) {
  if (dismissedVersion() === version) {
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* sin storage */ }
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
