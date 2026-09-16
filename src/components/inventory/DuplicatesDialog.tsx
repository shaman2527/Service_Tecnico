import { useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { api } from '@/db';
import type { DuplicateGroup } from '@/types';
import { toast } from 'sonner';

// Duplicados = el mismo teléfono/re puesto en dos fichas (la lista física lo
// cargó dos veces). NO se fusiona solo: el local elige cuál ficha se queda y el
// stock se SUMA. Los movimientos, ventas y servicios del borrado pasan al que queda.
export function DuplicatesDialog({ open, onClose, onChanged }: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api.getDuplicateGroups()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (open) load(); }, [open]);

  const merge = async (group: DuplicateGroup, keepId: number) => {
    const remove = group.items.filter(i => i.id !== keepId);
    const keep = group.items.find(i => i.id === keepId);
    if (!keep || remove.length === 0) return;
    const ok = confirm(
      `Fusionar «${group.label}»\n\nSe queda: #${keep.id} (stock ${keep.stock})\n` +
      `Se borra: ${remove.map(r => `#${r.id} (stock ${r.stock})`).join(', ')}\n\n` +
      `El stock queda en ${group.stock_total} y los movimientos pasan al que se queda.`,
    );
    if (!ok) return;
    setBusy(keepId);
    try {
      for (const r of remove) await api.mergeProducts(keepId, r.id);
      toast.success(`Fusionado: ${group.label}`);
      load();
      onChanged();
    } catch (e) {
      toast.error(`No se pudo fusionar: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] flex flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Copy className="size-4 text-warning" /> Productos repetidos
          </DialogTitle>
          <DialogDescription>
            Mismo teléfono y misma variante en más de una ficha. Fusiona eligiendo la ficha que se queda: el stock se suma
            y las ventas/servicios/movimientos del borrado pasan a la que queda.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {loading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          {!loading && groups.length === 0 && (
            <Empty>
              <EmptyMedia><Copy className="size-5" /></EmptyMedia>
              <EmptyTitle>No hay duplicados</EmptyTitle>
              <EmptyDescription>Todo el catálogo tiene una ficha por repuesto.</EmptyDescription>
            </Empty>
          )}
          {!loading && groups.map(g => (
            <div key={g.label + g.items.map(i => i.id).join('-')} className="rounded-lg border border-border p-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{g.label}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">stock total {g.stock_total}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{g.items.length} fichas</Badge>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {g.items.map(it => (
                  <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                    <span className="text-xs">
                      <span className="text-muted-foreground">#{it.id}</span> {it.name}
                      <span className="text-muted-foreground"> · stock {it.stock} · ${it.price_sale.toFixed(2)}</span>
                    </span>
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => merge(g, it.id)}>
                      {busy === it.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                      Dejar esta y fusionar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
