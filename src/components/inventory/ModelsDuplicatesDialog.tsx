import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Merge, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/db';
import { toast } from 'sonner';
import type { PhoneDuplicateGroup } from '@/types';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// F53 — ASISTENTE DE MODELOS REPETIDOS (con vista previa, grupo por grupo).
//
// Pedido del dueño: «existen varios duplicados de modelos, y esos mismos modelos tienen que tener
// referencia: qué pantalla va a seleccionar para ese modelo» + la regla de la casa: los duplicados se
// limpian con un ASISTENTE CON VISTA PREVIA (nunca automático).
//
// La propuesta sale de los DATOS: dos teléfonos que se sirven con **exactamente los mismos
// repuestos** son, para el local, el mismo teléfono (le pone la misma pantalla). El dueño elige
// CUÁL nombre queda y ve, antes de tocar nada, qué nombres viejos se van a conservar como ALIAS
// (buscar «A705» sigue encontrando «A70») y cuántos repuestos/stock tiene cada ficha.
//
// LO QUE NUNCA SE TOCA: precios, stock, movimientos, ventas y órdenes. `merge_phones` solo junta
// alias y borra la ficha repetida (los repuestos se relacionan por compatibilidad, no se mueven).
// ────────────────────────────────────────────────────────────────────────────────────────────────

export function ModelsDuplicatesDialog({ open, onOpenChange, onMerged }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onMerged: () => void;
}) {
  const [grupos, setGrupos] = useState<PhoneDuplicateGroup[] | null>(null);
  /** teléfono elegido para QUEDARSE en cada grupo (índice → id) */
  const [quedan, setQuedan] = useState<Record<number, number>>({});
  /** grupos que el dueño decidió no juntar en esta pasada */
  const [ignorados, setIgnorados] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setGrupos(null);
    setQuedan({});
    setIgnorados({});
    api.getPhoneDuplicateGroups()
      .then(g => { if (alive) setGrupos(g); })
      .catch(e => { if (alive) { setGrupos([]); toast.error(`No se pudieron buscar repetidos: ${String(e)}`); } });
    return () => { alive = false; };
  }, [open]);

  const juntar = async (i: number, grupo: PhoneDuplicateGroup) => {
    const keep = quedan[i] ?? grupo.phones[0]?.id;
    const otros = grupo.phones.filter(p => p.id !== keep);
    if (!keep || otros.length === 0) return;
    setBusy(i);
    try {
      for (const p of otros) {
        await api.mergePhones(keep, p.id);
      }
      toast.success(`Juntados: ${grupo.phones.map(p => p.name).join(' + ')}`, {
        description: `Queda «${grupo.phones.find(p => p.id === keep)?.name}» y los otros nombres siguen buscándose como alias.`,
      });
      setGrupos(prev => (prev ?? []).filter((_, idx) => idx !== i));
      onMerged();
    } catch (e) {
      toast.error('No se pudieron juntar', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const visibles = (grupos ?? []).filter((_, i) => !ignorados[i]);
  const pendientes = visibles.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] flex flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Merge className="size-4 text-primary" /> Modelos repetidos
          </DialogTitle>
          <DialogDescription>
            Teléfonos del padrón que usan <strong>exactamente los mismos repuestos</strong>: para el taller son el
            mismo teléfono. Elegí con qué nombre se queda cada grupo y revisá la vista previa antes de juntarlos.
            <span className="block text-[11px] text-muted-foreground">
              No se toca ningún precio, stock, movimiento, venta ni orden: los nombres viejos quedan como
              <strong> alias</strong> (buscar «A705» sigue encontrando «A70»).
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {grupos === null && (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          )}

          {grupos !== null && pendientes === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-4 text-sm">
              <Check className="size-4 text-success" />
              No hay modelos repetidos por revisar.
            </div>
          )}

          {visibles.map((grupo) => {
            const i = (grupos ?? []).indexOf(grupo);
            const keep = quedan[i] ?? grupo.phones[0]?.id;
            const otros = grupo.phones.filter(p => p.id !== keep);
            const quedaNombre = grupo.phones.find(p => p.id === keep)?.name ?? '';
            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-dup-group={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Copy className="size-3" /> {grupo.phones.length} fichas con {grupo.phones[0]?.repuestos} repuestos
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">Elegí con qué nombre se queda:</span>
                </div>

                <div className="flex flex-col gap-1">
                  {grupo.phones.map(p => (
                    <label key={p.id}
                      data-dup-option={p.id}
                      className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
                        p.id === keep ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-accent')}>
                      <input type="radio" name={`dup-${i}`} checked={p.id === keep}
                        onChange={() => setQuedan(prev => ({ ...prev, [i]: p.id }))} />
                      <Smartphone className="size-3.5 text-muted-foreground" />
                      <span className="font-medium">{p.name}</span>
                      {p.code && <span className="font-mono text-[10px] text-muted-foreground">{p.code}</span>}
                      <span className="text-[11px] text-muted-foreground">
                        {p.brand} · {(p.in_use ?? 0) === 1 ? 'en uso' : 'apagado'}
                      </span>
                      {(p.aliases?.length ?? 0) > 0 && (
                        <span className="ml-auto truncate text-[10px] text-muted-foreground" title={p.aliases.join(' · ')}>
                          {p.aliases.length} escrito{p.aliases.length === 1 ? '' : 's'} distinto{p.aliases.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                {/* VISTA PREVIA: qué queda y qué se conserva como alias */}
                <div className="rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 text-[11px]" data-dup-preview={i}>
                  <span className="text-muted-foreground">Vista previa:</span> queda <strong>{quedaNombre}</strong>
                  {otros.length > 0 && (
                    <> · se le suman los nombres <strong>{otros.map(p => p.name).join(' · ')}</strong> como alias</>
                  )}
                  {otros.some(p => (p.in_use ?? 0) === 1) && (grupo.phones.find(p => p.id === keep)?.in_use ?? 0) !== 1 && (
                    <span className="ml-1 text-warning">
                      <AlertTriangle className="mr-1 inline size-3" />ojo: el que queda está apagado y otro del grupo está en uso
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setIgnorados(prev => ({ ...prev, [i]: true }))}
                    data-dup-skip={i}>
                    No son el mismo
                  </Button>
                  <Button size="sm" disabled={busy !== null || otros.length === 0}
                    onClick={() => void juntar(i, grupo)} data-dup-merge={i}>
                    {busy === i ? <Check data-icon="inline-start" /> : <Merge data-icon="inline-start" />}
                    Juntar en «{quedaNombre}»
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {pendientes === 0 ? 'Nada para revisar.' : `${pendientes} grupo(s) para revisar.`}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
