import { useEffect, useState } from 'react';
import { CircleAlert, Flag, Layers, Smartphone, Tag } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/db';
import type { PhoneDetail } from '@/types';
import { partLabel } from '@/lib/utils';

// Ficha del teléfono (SOLO LECTURA): qué repuestos del catálogo le sirven,
// agrupados por categoría y con el stock real. Es la vista que usa el taller
// para decidir si un teléfono está bien cargado antes de renombrarlo (F4).
export function PhoneDetailDialog({ phoneId, onClose, onByModel }: {
  phoneId: number | null;
  onClose: () => void;
  onByModel: (name: string) => void;
}) {
  const [detail, setDetail] = useState<PhoneDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phoneId == null) { setDetail(null); setError(null); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    api.getPhoneDetail(phoneId)
      .then(d => { if (alive) setDetail(d); })
      .catch((e: unknown) => {
        if (!alive) return;
        setDetail(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [phoneId]);

  const phone = detail?.phone;
  const blocks = detail?.blocks ?? [];
  const totalUnits = blocks.reduce((acc, b) => acc + b.items.reduce((a, i) => a + i.stock, 0), 0);

  return (
    <Dialog open={phoneId != null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] flex flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" />
            {loading ? 'Cargando ficha…' : (phone?.name ?? 'Teléfono')}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {phone && (
              <>
                <Badge variant="secondary" className="text-[10px]">{phone.brand}</Badge>
                {phone.line && <span className="text-xs">línea: {phone.line}</span>}
                <span className="text-xs">modelo: {phone.model || '—'}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}

          {!loading && phone && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                <Layers className="size-3" /> {phone.products} {phone.products === 1 ? 'repuesto' : 'repuestos'}
              </Badge>
              <Badge variant="outline" className="text-[10px] tabular-nums">{totalUnits} u. en stock</Badge>
              {phone.needs_review && (
                <Badge variant="outline" className="text-[10px] gap-1 text-warning border-warning/50">
                  <Flag className="size-3" /> por revisar (sin familia)
                </Badge>
              )}
              {phone.aliases.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  también escrito: {phone.aliases.join(' · ')}
                </span>
              )}
            </div>
          )}

          {!loading && error && (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>No se pudo abrir la ficha</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && phone && blocks.length === 0 && (
            <Empty>
              <EmptyMedia><CircleAlert className="size-5" /></EmptyMedia>
              <EmptyTitle>Sin repuestos para este teléfono</EmptyTitle>
              <EmptyDescription>
                Ningún producto del catálogo lo tiene en su compatibilidad. Puede que esté escrito distinto
                («Poco X3» vs «Redmi Poco X3») o que todavía no haya repuesto cargado.
              </EmptyDescription>
            </Empty>
          )}

          {!loading && !error && !phone && (
            <Empty>
              <EmptyMedia><CircleAlert className="size-5" /></EmptyMedia>
              <EmptyTitle>Ese teléfono ya no está en la lista</EmptyTitle>
              <EmptyDescription>Se borró o se fusionó con otro: cierra la ficha y vuelve a la tabla.</EmptyDescription>
            </Empty>
          )}

          {!loading && blocks.map(b => (
            <div key={b.category_id} className="flex flex-col gap-1.5 rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Tag className="size-3.5 text-muted-foreground" /> {b.category}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {b.items.length} {b.items.length === 1 ? 'ficha' : 'fichas'}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Repuesto</TableHead>
                    <TableHead className="w-20 text-center">Stock</TableHead>
                    <TableHead className="w-28 text-right">Venta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.items.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{partLabel(p)}</TableCell>
                      <TableCell className="text-center">
                        {p.stock > 0 ? (
                          <Badge className="bg-success text-white hover:bg-success tabular-nums">{p.stock}</Badge>
                        ) : (
                          <Badge variant="outline" className="tabular-nums text-muted-foreground">{p.stock}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {p.price_sale > 0 ? `$${p.price_sale.toFixed(2)}` : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          {phone && (
            <Button variant="outline" onClick={() => { onByModel(phone.name); onClose(); }}>
              <Layers data-icon="inline-start" /> Ver repuestos compatibles
            </Button>
          )}
          <Button onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
