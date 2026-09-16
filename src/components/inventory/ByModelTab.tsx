import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Layers, Pencil, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ModelCombobox } from '@/components/ModelCombobox';
import { api } from '@/db';
import type { Product, ScreenCandidate } from '@/types';
import { partLabel } from '@/lib/utils';
import { CompatChips } from './CompatChips';

const QUALITY_LABEL: Record<ScreenCandidate['match_quality'], string> = {
  exacta: 'Exacta',
  prefijo: 'Coincidencia',
  parcial: 'Parecida',
};

// "¿Qué repuesto le sirve a este teléfono?" — el buscador que antes era la
// pantalla "Pantallas" (una tabla más del mismo inventario). Ahora es una
// herramienta de consulta con stock primero y enlace a la ficha del producto.
export function ByModelTab({ refreshKey, initialModel, onEdit }: {
  refreshKey: number;
  initialModel: string;
  onEdit: (p: Product) => void;
}) {
  const [model, setModel] = useState(initialModel);
  const [rows, setRows] = useState<ScreenCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyStock, setOnlyStock] = useState(false);

  useEffect(() => { setModel(initialModel); }, [initialModel]);

  useEffect(() => {
    if (!model.trim()) { setRows([]); return; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.findCompatibleScreens(model, 100)
        .then(r => { if (alive) setRows(r); })
        .catch(() => { if (alive) setRows([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [model, refreshKey]);

  const shown = useMemo(() => (onlyStock ? rows.filter(r => r.in_stock) : rows), [rows, onlyStock]);
  const withStock = rows.filter(r => r.in_stock).length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar repuesto por modelo de teléfono</CardTitle>
          <CardDescription>
            Elige el teléfono y mira qué pantallas/repuestos del catálogo le sirven, con el stock real.
            Es la misma compatibilidad que usa el formulario de servicio.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ModelCombobox value={model} onChange={(m) => setModel(m)} placeholder="Ej: Redmi Note 11, Samsung A32, iPhone 13…" />
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Layers className="size-3.5" /> {rows.length} {rows.length === 1 ? 'repuesto' : 'repuestos'} compatibles
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-success" /> {withStock} con stock
              </span>
              <Button variant={onlyStock ? 'default' : 'outline'} size="sm" onClick={() => setOnlyStock(v => !v)}>
                Solo con stock
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loading && (
        <Card><CardContent className="flex flex-col gap-2 py-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent></Card>
      )}

      {!loading && model.trim() && shown.length === 0 && (
        <Empty>
          <EmptyMedia><Smartphone className="size-5" /></EmptyMedia>
          <EmptyTitle>Sin repuestos para «{model}»</EmptyTitle>
          <EmptyDescription>
            {rows.length > 0
              ? 'Ninguno tiene stock ahora mismo: quita el filtro «Solo con stock» para verlos.'
              : 'Revisa cómo está escrito el modelo o regístralo en la compatibilidad del producto (Inventario → Editar).'}
          </EmptyDescription>
        </Empty>
      )}

      {!loading && shown.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repuesto</TableHead>
                  <TableHead className="w-24">Marca</TableHead>
                  <TableHead className="w-32">Modelo</TableHead>
                  <TableHead className="w-24">Coincide</TableHead>
                  <TableHead className="w-24 text-center">Stock</TableHead>
                  <TableHead className="w-24 text-right">Venta</TableHead>
                  <TableHead>También le sirve a</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ product: p, match_quality, in_stock }) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{partLabel(p)}</span>
                        {p.variant && <Badge variant="secondary" className="text-[10px]">{p.variant}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{p.brand ?? '—'}</TableCell>
                    <TableCell className="text-sm">{p.model ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={match_quality === 'exacta' ? 'default' : 'outline'} className="text-[10px]">
                        {QUALITY_LABEL[match_quality]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {in_stock ? (
                        <Badge className="bg-success text-white hover:bg-success tabular-nums">{p.stock}</Badge>
                      ) : (
                        <Badge variant="outline" className="tabular-nums gap-1 text-warning border-warning/50">
                          <CircleAlert className="size-3" /> {p.stock}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.price_sale > 0 ? `$${p.price_sale.toFixed(2)}` : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <CompatChips compatibility={p.compatibility} max={2} />
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => onEdit(p)}>
                        <Pencil data-icon="inline-start" /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
