import { useState } from 'react';
import { Download, RefreshCw, ShieldCheck, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { rememberDownloaded, downloadedVersion, clearDownloaded } from '@/lib/update';
import type { Update } from '@tauri-apps/plugin-updater';

type Phase = 'idle' | 'backing-up' | 'downloading' | 'installing' | 'later' | 'error';

export default function UpdateDialog({ update, open, onOpenChange }: {
  update: Update | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const alreadyDownloaded = !!update && downloadedVersion() === update.version;

  const install = async () => {
    if (!update) return;
    setPhase('backing-up');
    setError(null);
    try {
      // 1. Respaldo previo: exe anterior + DB (checkpoint) + estado pending + watchdog
      const { getVersion } = await import('@tauri-apps/api/app');
      const current = await getVersion();
      await api.backupBeforeUpdate(update.version, current);

      // 2. Descarga e instalación (la app se cierra sola en Windows; el watchdog vela)
      setPhase('downloading');
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall(event => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        }
      });
      setPhase('installing');
      clearDownloaded(update.version);

      // 3. Relanzar la versión nueva (ejecuta el chequeo de salud al arrancar)
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // "Ver más tarde": descarga la actualización en segundo plano (sin instalar).
  // Al reiniciar la app, se le recuerda que ya está descargada y lista para instalar.
  const later = async () => {
    if (!update) return;
    setPhase('later');
    setError(null);
    try {
      let downloaded = 0;
      let contentLength = 0;
      await update.download(event => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        }
      });
      rememberDownloaded(update.version);
      setPhase('idle');
      onOpenChange(false);
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => {
      if (phase !== 'backing-up' && phase !== 'downloading' && phase !== 'installing' && phase !== 'later') onOpenChange(o);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-5 text-primary" />
            Nueva versión {update?.version ?? ''} disponible
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground space-y-3">
          {phase === 'error' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive">
              La actualización no se pudo completar. Tu app sigue funcionando con la versión
              actual y tus datos están a salvo.
              {error && <div className="mt-1 text-xs opacity-80">{error}</div>}
            </div>
          )}
          {alreadyDownloaded && phase === 'idle' && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-700">
              Ya descargaste esta actualización — está lista para instalar cuando quieras.
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {update?.body || 'Mejoras y correcciones.'}
          </div>
          <div className="flex items-start gap-2 text-xs">
            <ShieldCheck className="size-4 mt-0.5 shrink-0 text-emerald-600" />
            <span>
              Antes de instalar se hace un respaldo automático de la base de datos y de la
              versión actual. Si algo fallara, la app restaura la versión anterior sola.
            </span>
          </div>
          {phase === 'backing-up' && (
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="size-4" /> Haciendo respaldo de seguridad…
            </div>
          )}
          {phase === 'downloading' && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Descargando actualización…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {phase === 'later' && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Descargando en segundo plano… te avisaremos al reiniciar</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {phase === 'installing' && (
            <div className="flex items-center gap-2 text-primary">
              <Download className="size-4" /> Instalando… la app se cerrará y volverá a abrir sola.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {phase === 'idle' || phase === 'error' ? (
            <>
              <Button variant="outline" onClick={later}>
                <Clock className="size-4" /> Ver más tarde
              </Button>
              <Button onClick={install}>
                <Download className="size-4" /> Instalar ahora
              </Button>
            </>
          ) : (
            <Button disabled>
              <RefreshCw className="size-4 animate-spin" /> Actualizando…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
