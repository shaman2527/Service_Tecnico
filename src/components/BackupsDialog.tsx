// F71 — RESPALDOS (bloqueante A2 de la auditoría de entrega): «Respaldar ahora» y «Restaurar desde un
// respaldo», con el estado del último respaldo a la vista. Vive en Ayuda porque es donde el dueño lo
// busca («¿cómo respaldo mi información?») y hasta F71 la respuesta era «copiá registro.db a un USB».
//
// Es del DUEÑO: los comandos del backend lo exigen igual (`backup_now`/`request_restore` →
// `require_owner`), y la caja no necesita respaldar: trabaja el turno.
//
// La RESTAURACIÓN es diferida a propósito (lo explica el propio diálogo): con la base abierta no se
// puede pisar el archivo sin arriesgar corrupción, así que se valida, se guarda una copia de lo que hay
// AHORA y la app se reinicia para aplicar el cambio.

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseBackup, FolderOpen, HardDriveDownload, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api } from '../db';
import { localDate } from '@/lib/utils';
import {
  saludRespaldo, etiquetaRespaldo, fechaLegible, tamanoLegible, textoRestauracion, puedeRestaurar,
  type Respaldo, type EstadoRespaldo,
} from '@/lib/backup';

export default function BackupsDialog({ onClose }: { onClose: () => void }) {
  const [estado, setEstado] = useState<EstadoRespaldo | null>(null);
  const [lista, setLista] = useState<Respaldo[]>([]);
  const [carpeta, setCarpeta] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [respaldando, setRespaldando] = useState(false);
  const [aRestaurar, setARestaurar] = useState<Respaldo | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  // F71: elegir la carpeta (USB incluido) — el diálogo nativo de Tauri; si el plugin no está, se escribe a mano
  const [elegirCarpeta, setElegirCarpeta] = useState(false);
  const [carpetaManual, setCarpetaManual] = useState('');

  const cargar = async () => {
    const st = await api.backupStatus(carpeta || undefined);
    setEstado(st);
    setLista(await api.listBackups(carpeta || undefined));
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [carpeta]);

  const salud = saludRespaldo(estado ?? { ultimo: null, error: null }, localDate());

  const respaldarAhora = async () => {
    setRespaldando(true);
    setMsg(null);
    setError(null);
    try {
      const info = await api.backupNow(carpeta || undefined);
      setMsg({ ok: true, texto: `Respaldo hecho: ${info.name} (${tamanoLegible(info.size_bytes)}) en ${info.path}` });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRespaldando(false);
    }
  };

  const elegirOtraCarpeta = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, title: '¿Dónde guardo los respaldos? (podés elegir un USB)' });
      if (typeof dir === 'string' && dir.trim()) {
        setCarpeta(dir);
        setElegirCarpeta(false);
      }
    } catch {
      setElegirCarpeta(true);
    }
  };

  const confirmarRestauracion = async () => {
    if (!aRestaurar) return;
    const puede = puedeRestaurar(aRestaurar.path);
    if (!puede.ok) { setError(puede.motivo ?? null); return; }
    setRestaurando(true);
    setError(null);
    try {
      const plan = await api.requestRestore(aRestaurar.path);
      setMsg({ ok: true, texto: `Listo: ${plan.resumen}` });
      setARestaurar(null);
      // La restauración se aplica al reiniciar (con la base abierta no se puede pisar el archivo)
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setARestaurandoFalso();
    } finally {
      setRestaurando(false);
    }
  };
  const setARestaurandoFalso = () => setRestaurando(false);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" data-dialog="respaldos">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-4" /> Respaldos de la base
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {/* ESTADO: lo primero que el dueño tiene que ver (un respaldo que nunca se hizo es la
              diferencia entre perder un día y perder el negocio). */}
          <div className={`rounded-md border px-3 py-2.5 text-sm ${salud.alerta ? 'border-warning/50 bg-warning/10 text-warning' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'}`}
            data-field="estado-respaldo" data-estado={salud.estado}>
            <span className="flex items-center gap-2 font-medium">
              {salud.alerta ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
              {salud.texto}
            </span>
            <p className="text-xs mt-1 opacity-80" data-field="carpeta-respaldos">
              Carpeta: <span className="font-mono">{estado?.dir || '—'}</span> · se conservan los últimos {estado?.retencion ?? 14} automáticos
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={respaldarAhora} disabled={respaldando} data-action="respaldar-ahora">
              <HardDriveDownload className="size-4" /> {respaldando ? 'Respaldando…' : 'Respaldar ahora'}
            </Button>
            <Button variant="outline" onClick={elegirOtraCarpeta} data-action="elegir-carpeta">
              <FolderOpen className="size-4" /> Elegir carpeta (USB)
            </Button>
            <Button variant="outline" onClick={cargar} data-action="refrescar-respaldos">
              <RefreshCw className="size-4" /> Actualizar
            </Button>
            {carpeta && (
              <Button variant="ghost" onClick={() => setCarpeta('')} data-action="carpeta-por-defecto">
                Volver a la carpeta por defecto
              </Button>
            )}
          </div>

          {elegirCarpeta && (
            <div className="flex items-end gap-2" data-field="carpeta-manual">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs font-medium">Ruta de la carpeta de respaldos</label>
                <Input value={carpetaManual} onChange={e => setCarpetaManual(e.target.value)}
                  placeholder="Ej: E:\respaldos" />
              </div>
              <Button variant="outline" onClick={() => { if (carpetaManual.trim()) { setCarpeta(carpetaManual.trim()); setElegirCarpeta(false); } }}>
                Usar esta carpeta
              </Button>
            </div>
          )}

          {msg && <p className="text-sm text-success" data-field="msg-respaldo">{msg.texto}</p>}
          {error && <p className="text-sm text-danger" data-field="error-respaldo">{error}</p>}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Respaldos en la carpeta ({lista.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Archivo</TableHead>
                    <TableHead className="text-right">Tamaño</TableHead>
                    <TableHead>Qué es</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lista.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        Todavía no hay respaldos en esta carpeta
                      </TableCell>
                    </TableRow>
                  ) : lista.map(r => (
                    <TableRow key={r.path} data-backup-row={r.name}>
                      <TableCell className="whitespace-nowrap">{fechaLegible(r.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[260px] truncate">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{tamanoLegible(r.size_bytes)}</TableCell>
                      <TableCell>
                        <Badge variant={r.seguridad ? 'destructive' : r.automatico ? 'secondary' : 'outline'} className="text-[10px]">
                          {etiquetaRespaldo(r)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" data-action="restaurar-respaldo" data-backup={r.name}
                          onClick={() => { setARestaurar(r); setError(null); setMsg(null); }}>
                          <RotateCcw className="size-3.5" /> Restaurar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            El respaldo es la <span className="font-medium">base entera</span> (productos, ventas, órdenes,
            turnos y personas), no un resumen: con ese archivo se vuelve exactamente a ese momento. Al cerrar
            el día se guarda uno automático; los automáticos viejos se borran solos y las copias previas a una
            restauración <span className="font-medium">no se borran nunca</span>.
          </p>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>

        {/* CONFIRMACIÓN: qué se pisa, de cuándo es y que primero se guarda lo actual */}
        <AlertDialog open={!!aRestaurar} onOpenChange={() => setARestaurar(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Restaurar este respaldo?</AlertDialogTitle>
              <AlertDialogDescription data-field="texto-restauracion">
                {aRestaurar ? textoRestauracion(aRestaurar, lista.length) : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmarRestauracion} disabled={restaurando}
                data-action="confirmar-restauracion">
                {restaurando ? 'Preparando…' : 'Restaurar y reiniciar'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
