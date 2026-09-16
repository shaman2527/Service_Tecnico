import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Copy, Layers, MoveHorizontal, PackageSearch,
  Pencil, Search, TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/db';
import type { Category, InventoryStats, Product } from '@/types';
import { partLabel } from '@/lib/utils';
import { StockBadge } from './StockBadge';
import { CompatChips } from './CompatChips';

const PAGE_SIZE = 50;

const STOCK_FILTERS = [
  { value: 'todos', label: 'Todo el catálogo' },
  { value: 'con_stock', label: 'Con stock' },
  { value: 'agotado', label: 'Agotados' },
  { value: 'bajo_minimo', label: 'Bajo mínimo' },
  { value: 'negativo', label: 'Faltantes (negativos)' },
  { value: 'sin_precio', label: 'Sin precio' },
  { value: 'sin_compat', label: 'Sin compatibilidad' },
];

function Kpi({ label, value, tone, hint }: {
  label: string;
  value: string | number;
  tone?: 'danger' | 'warning' | 'success';
  hint?: string;
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-foreground';
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={hint}>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function ProductsTab({ refreshKey, categories, onEdit, stats, onReviewDuplicates, onByModel }: {
  categories: Category[];
  onEdit: (p: Product) => void;
  stats: InventoryStats | null;
  onReviewDuplicates: () => void;
  onByModel: (model: string) => void;
  /** sube cuando se guarda/fusiona algo → la tabla vuelve a consultar sola */
  refreshKey: number;
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('todas');
  const [stockFilter, setStockFilter] = useState('todos');
  const [sort, setSort] = useState('nombre');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const dupSet = useMemo(() => new Set(stats?.duplicate_ids ?? []), [stats]);

  useEffect(() => { setPage(0); }, [search, catFilter, stockFilter, sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.getProductsPage(
        search,
        catFilter === 'todas' ? null : Number(catFilter),
        null,
        stockFilter,
        sort,
        PAGE_SIZE,
        page * PAGE_SIZE,
      ).then(r => {
        if (!alive) return;
        setItems(r.items);
        setTotal(r.total);
      }).finally(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [search, catFilter, stockFilter, sort, page, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const anyPrice = useMemo(() => items.some(p => p.price_sale > 0 || p.price_cost > 0), [items]);
  const cols = anyPrice ? 9 : 8;

  return (
    <div className="flex flex-col gap-4">
      {stats && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <Kpi label="Productos" value={stats.sku} hint={`${stats.brands} marcas`} />
          <Kpi label="Con stock" value={stats.with_stock} tone="success" hint={stats.with_stock > 0 ? `${stats.units} u.` : undefined} />
          <Kpi label="Agotados" value={stats.out_of_stock} tone={stats.out_of_stock > 0 ? 'warning' : undefined} />
          {stats.negative > 0 && <Kpi label="Faltantes" value={stats.negative} tone="danger" />}
          {stats.low_stock > 0 && <Kpi label="Bajo mínimo" value={stats.low_stock} tone="warning" />}
          {stats.no_price > 0 && <Kpi label="Sin precio" value={stats.no_price} tone="warning" />}
          <Kpi label="Capital a costo" value={`$${stats.value_cost.toFixed(2)}`} hint={`venta $${stats.value_sale.toFixed(2)}`} />
        </div>
      )}

      {stats && stats.duplicate_groups > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <span className="flex items-center gap-2 text-xs">
            <Copy className="size-3.5 text-warning" />
            Hay <strong>{stats.duplicate_groups}</strong> productos repetidos (mismo teléfono en dos fichas).
          </span>
          <Button variant="outline" size="sm" onClick={onReviewDuplicates}>Revisar duplicados</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por producto, marca, modelo o teléfono compatible…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {categories.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STOCK_FILTERS.map(f => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nombre">Nombre (A-Z)</SelectItem>
            <SelectItem value="stock">Más stock primero</SelectItem>
            <SelectItem value="stock_asc">Menos stock primero</SelectItem>
            <SelectItem value="marca">Marca y modelo</SelectItem>
            <SelectItem value="reciente">Editados recientemente</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="w-28">Categoría</TableHead>
                <TableHead className="w-28">Marca</TableHead>
                <TableHead className="w-40">Modelo</TableHead>
                <TableHead>Modelos compatibles</TableHead>
                {anyPrice && <TableHead className="w-32 text-right">Precio</TableHead>}
                <TableHead className="w-24 text-center">Stock</TableHead>
                <TableHead className="w-16 text-right">Mín</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  <TableCell colSpan={cols}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={cols} className="py-8">
                    <Empty>
                      <EmptyMedia><PackageSearch className="size-5" /></EmptyMedia>
                      <EmptyTitle>Sin productos con esos filtros</EmptyTitle>
                      <EmptyDescription>
                        Prueba otra búsqueda, quita el filtro de stock o revisa la categoría.
                      </EmptyDescription>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{partLabel(p)}</span>
                      {p.variant && <Badge variant="secondary" className="text-[10px]">{p.variant}</Badge>}
                      {dupSet.has(p.id) && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-warning border-warning/50">
                          <Copy className="size-3" /> repetido
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.category_name ?? '—'}</TableCell>
                  <TableCell>{p.brand ?? '—'}</TableCell>
                  <TableCell className="text-sm">{p.model ?? '—'}</TableCell>
                  <TableCell className="max-w-[320px]">
                    <CompatChips compatibility={p.compatibility} />
                  </TableCell>
                  {anyPrice && (
                    <TableCell className="text-right tabular-nums">
                      {p.price_sale > 0 ? (
                        <div className="flex flex-col items-end">
                          <span className="font-medium">${p.price_sale.toFixed(2)}</span>
                          {p.price_cost > 0 && (
                            <span className="text-[11px] text-muted-foreground">costo ${p.price_cost.toFixed(2)}</span>
                          )}
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-warning border-warning/50">sin precio</Badge>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <StockBadge stock={p.stock} minStock={p.min_stock} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{p.min_stock}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {p.model && (
                        <Button variant="ghost" size="sm" title="Ver qué repuestos le sirven a este modelo"
                          onClick={() => onByModel(p.model ?? '')}>
                          <Layers data-icon="inline-start" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => onEdit(p)}>
                        <Pencil data-icon="inline-start" /> Editar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {total === 0 ? 'Sin resultados' : `Mostrando ${from}–${to} de ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            <ChevronLeft data-icon="inline-start" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>
            Siguiente <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <Separator />
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <TriangleAlert className="size-3.5 text-warning" />
          «Faltante» es stock negativo: salió más mercancía de la registrada (revisa Movimientos).
        </span>
        <span className="flex items-center gap-1.5">
          <MoveHorizontal className="size-3.5" /> «Repetido» es el mismo teléfono en dos fichas: se fusionan desde el aviso de arriba.
        </span>
      </div>
    </div>
  );
}
