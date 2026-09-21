import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, CircleAlert, Eye, Flag,
  Info, Layers, Merge, Pencil, Plus, Search, Smartphone,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/db';
import type { PhoneBrandRow, PhoneListRow } from '@/types';
import { cn } from '@/lib/utils';
import { headerState, nextOrder, orderParams, type PhoneOrder, type PhoneSortKey } from '@/lib/phoneOrder';
import { toast } from 'sonner';
import { Kpi, KpiStrip } from './Kpi';
import { PhoneDetailDialog } from './PhoneDetailDialog';
import { PhoneEditDialog, PhoneMergeDialog } from './PhoneEditDialog';

const PAGE_SIZE = 50;

const VISTAS = [
  { value: 'todos', label: 'Todos los teléfonos' },
  { value: 'con_repuestos', label: 'Con repuestos' },
  { value: 'con_stock', label: 'Con stock' },
  { value: 'por_revisar', label: 'Por revisar' },
] as const;

function SortHead({ label, sortKey, order, onToggle, className, align = 'left' }: {
  label: string;
  sortKey: PhoneSortKey;
  order: PhoneOrder | null;
  onToggle: (k: PhoneSortKey) => void;
  className?: string;
  align?: 'left' | 'center';
}) {
  const { active, dir } = headerState(order, sortKey);
  const Icon = dir === 'asc' ? ChevronUp : dir === 'desc' ? ChevronDown : ChevronsUpDown;
  return (
    <TableHead
      className={className}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        title="Clic: ascendente → descendente → sin orden"
        className={cn(
          'flex items-center gap-1 rounded-sm text-xs font-medium uppercase tracking-wide transition-colors hover:text-foreground',
          align === 'center' && 'mx-auto',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        <Icon className={cn('size-3.5', active ? 'text-foreground' : 'text-muted-foreground/60')} />
      </button>
    </TableHead>
  );
}

// F3 — PADRÓN DE TELÉFONOS del taller (tabla `phones`, reconstruida desde la
// compatibilidad del catálogo). Solo LECTURA: renombrar/fusionar es la feature
// siguiente. Marca como columna y como filtro, orden de 3 estados por columna.
export function ModelsTab({ refreshKey, canEdit, onByModel }: {
  refreshKey: number;
  /** el dueño puede corregir la lista (el backend lo exige igual) */
  canEdit: boolean;
  onByModel: (name: string) => void;
}) {
  // `searchInput` es lo escrito y `search` lo que se consulta: el rebote es SÓLO al escribir
  // (feature 41). Antes la pestaña —la más cara del módulo— esperaba 200 ms antes de su
  // PRIMERA consulta, y ésos 200 ms se sumaban a los ~550 ms de cálculo del backend.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('todas');
  const [vista, setVista] = useState<string>('todos');
  const [order, setOrder] = useState<PhoneOrder | null>(null);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<PhoneListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [brands, setBrands] = useState<PhoneBrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  // ya hay tabla en pantalla → la recarga no se tapa con esqueleto (se avisa «actualizando»)
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editPhone, setEditPhone] = useState<PhoneListRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [mergePhone, setMergePhone] = useState<PhoneListRow | null>(null);
  // el rol dice «dueño», pero manda el BACKEND: si la sesión no está desbloqueada con el
  // PIN del dueño, los botones de escritura no se muestran (y el invoke fallaría igual)
  const [canWrite, setCanWrite] = useState(canEdit);

  useEffect(() => {
    if (!canEdit) { setCanWrite(false); return; }
    let alive = true;
    api.canEditPhones()
      .then(ok => { if (alive) setCanWrite(ok); })
      .catch(() => { if (alive) setCanWrite(false); });
    return () => { alive = false; };
  }, [canEdit, refreshKey]);

  // Los cambios de filtro/orden vuelven a la PRIMERA página en el mismo handler: si se hiciera en
  // un efecto aparte, la consulta saldría con el offset viejo (una llamada desperdiciada al
  // endpoint más caro del módulo). OJO con la BÚSQUEDA: acá sólo se guarda lo escrito; la página
  // la resetea el rebote, en el mismo paso en que se consulta (si se resetea acá, escribir en la
  // página 3 lanzaba una consulta tirada con el texto viejo — hallazgo de la revisión).
  const toggleOrder = (k: PhoneSortKey) => { setOrder(o => nextOrder(o, k)); setPage(0); };
  const changeSearch = (v: string) => { setSearchInput(v); };
  const changeBrand = (v: string) => { setBrand(v); setPage(0); };
  const changeVista = (v: string) => { setVista(v); setPage(0); };

  // Rebote SÓLO de lo que se escribe (ver comentario de `searchInput`).
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 200);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  /**
   * F50 — el check «lo uso» del MODELO. Usa el comando `set_phone_use_all` (el teléfono y sus
   * repuestos en UNA transacción) para que el padrón y el inventario no queden en estados distintos,
   * y recarga para que se vean los contadores nuevos.
   */
  const [savingUse, setSavingUse] = useState<number | null>(null);
  const toggleUsoModelo = async (p: PhoneListRow, inUse: boolean) => {
    if (savingUse != null) return;
    setSavingUse(p.id);
    try {
      const n = await api.setPhoneUseAll(p.id, inUse);
      toast.success(inUse
        ? `«${p.name}» en uso${n > 0 ? ` · ${n} repuesto${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'}` : ''}`
        : `«${p.name}» apagado: no aparece al registrar`, { id: `uso-modelo-${p.id}` });
      setReloadKey(k => k + 1);
    } catch (e) {
      toast.error('No se pudo cambiar el «en uso» del modelo', { description: e instanceof Error ? e.message : String(e), id: `uso-modelo-${p.id}` });
    } finally {
      setSavingUse(null);
    }
  };

  useEffect(() => {
    let alive = true;
    api.getPhoneBrands()
      .then(b => { if (alive) setBrands(b); })
      .catch(() => { if (alive) setBrands([]); });
    return () => { alive = false; };
  }, [refreshKey, reloadKey]);

  useEffect(() => {
    let alive = true;
    if (loaded.current) setRefreshing(true); else setLoading(true);
    const { sort, dir } = orderParams(order);
    api.getPhones(
      brand === 'todas' ? null : brand,
      search,
      vista === 'con_repuestos',
      vista === 'con_stock',
      vista === 'por_revisar',
      sort,
      dir,
      PAGE_SIZE,
      page * PAGE_SIZE,
    ).then(r => {
      if (!alive) return;
      loaded.current = true;
      setError(null);
      setItems(r.items);
      setTotal(r.total);
      // Si el total bajó (p. ej. se editó un producto) y la página actual quedó
      // fuera de rango, se vuelve a la última página real.
      const last = Math.max(0, Math.ceil(r.total / PAGE_SIZE) - 1);
      if (page > last) setPage(last);
    }).catch((e: unknown) => {
      if (!alive) return;
      setItems([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (!alive) return;
      setLoading(false);
      setRefreshing(false);
    });
    return () => { alive = false; };
  }, [search, brand, vista, order, page, refreshKey, reloadKey]);

  const kpis = useMemo(() => ({
    phones: brands.reduce((a, b) => a + b.phones, 0),
    brands: brands.length,
    withProducts: brands.reduce((a, b) => a + b.with_products, 0),
    withStock: brands.reduce((a, b) => a + b.with_stock, 0),
    review: brands.reduce((a, b) => a + b.needs_review, 0),
    brandList: brands.map(b => b.brand),
  }), [brands]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // «actualizando» también mientras el rebote espera: el operario (y las pruebas en vivo) tienen
  // que poder saber que la tabla va a cambiar, no quedarse mirando filas viejas creyendo que son
  // el resultado de lo que acaba de escribir.
  const updating = refreshing || searchInput !== search;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const filtering = search.trim() !== '' || brand !== 'todas' || vista !== 'todos';

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip>
        <Kpi label="Teléfonos" value={kpis.phones} hint={`${kpis.brands} marcas`} />
        <Kpi label="Con repuestos" value={kpis.withProducts} tone="success" />
        <Kpi label="Con stock" value={kpis.withStock} tone={kpis.withStock > 0 ? 'success' : undefined} />
        <Kpi label="Por revisar" value={kpis.review} tone={kpis.review > 0 ? 'warning' : undefined} hint="sin familia comercial" />
        {filtering && <Kpi label="Resultados" value={total} />}
      </KpiStrip>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por teléfono, marca, modelo o como esté escrito en el inventario…"
            className="pl-9"
            value={searchInput}
            onChange={e => changeSearch(e.target.value)}
          />
        </div>
        <Select value={brand} onValueChange={changeBrand}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las marcas ({kpis.phones})</SelectItem>
            {brands.map(b => (
              <SelectItem key={b.brand} value={b.brand}>
                {b.brand} ({b.phones}){b.needs_review > 0 ? ` · ${b.needs_review} por revisar` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={vista} onValueChange={changeVista}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VISTAS.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {kpis.review > 0 && vista !== 'por_revisar' && (
          <Button variant="outline" size="sm" onClick={() => { changeVista('por_revisar'); changeBrand('todas'); }}>
            <Flag data-icon="inline-start" />
            {kpis.review === 1 ? 'Ver el que falta revisar' : `Ver los ${kpis.review} por revisar`}
          </Button>
        )}
        {(order || filtering) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setOrder(null); changeSearch(''); changeBrand('todas'); changeVista('todos'); }}
          >
            Limpiar
          </Button>
        )}
        {canWrite && (
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            <Plus data-icon="inline-start" /> Agregar teléfono
          </Button>
        )}
      </div>

      {canWrite && kpis.review > 0 && vista === 'por_revisar' && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <Flag className="size-3.5 text-warning" />
          <span>
            Corregí el nombre de estos teléfonos con <strong>Corregir</strong> (la línea y el modelo):
            al guardar, el nombre deja de estar «por revisar» y la lista de modelos del servicio se actualiza sola.
          </span>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>No se pudo leer la lista de teléfonos</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => setReloadKey(k => k + 1)}>Reintentar</Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Teléfono" sortKey="nombre" order={order} onToggle={toggleOrder} />
                <SortHead label="Marca" sortKey="marca" order={order} onToggle={toggleOrder} className="w-32" />
                <SortHead label="Repuestos" sortKey="repuestos" order={order} onToggle={toggleOrder} className="w-32" align="center" />
                <SortHead label="Stock" sortKey="stock" order={order} onToggle={toggleOrder} className="w-24" align="center" />
                <TableHead className="w-48">Categorías</TableHead>
                <SortHead label="Estado" sortKey="revisar" order={order} onToggle={toggleOrder} className="w-40" />
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  <TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))}
              {!loading && !error && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8">
                    <Empty>
                      <EmptyMedia><Smartphone className="size-5" /></EmptyMedia>
                      <EmptyTitle>Ningún teléfono con esos filtros</EmptyTitle>
                      <EmptyDescription>
                        {vista !== 'todos'
                          ? `Prueba otra búsqueda, cambia la marca o quita la vista «${VISTAS.find(v => v.value === vista)?.label}».`
                          : 'Prueba otra búsqueda o cambia la marca.'}
                        {' '}La lista se arma sola desde la compatibilidad del catálogo (Inventario → Productos → Editar).
                      </EmptyDescription>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.map(p => (
                <TableRow key={p.id} data-phone={p.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{p.name}</span>
                      {/* F50: el código del modelo (el local lo dicta: M-007) */}
                      {p.code && <span className="font-mono text-[10px] text-muted-foreground" data-phone-code={p.code}>{p.code}</span>}
                      {p.line && <Badge variant="secondary" className="text-[10px]">{p.line}</Badge>}
                      {p.aliases.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                              <Info className="size-3" /> {p.aliases.length} escrito{p.aliases.length === 1 ? '' : 's'} distinto{p.aliases.length === 1 ? '' : 's'}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <span className="text-xs">En el inventario aparece como: {p.aliases.join(' · ')}</span>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{p.brand}</TableCell>
                  <TableCell className="text-center">
                    {p.products > 0 ? (
                      <span className="tabular-nums font-medium">{p.products}</span>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">sin repuestos</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.stock > 0 ? (
                      <Badge className="bg-success text-white hover:bg-success tabular-nums">{p.stock}</Badge>
                    ) : (
                      <Badge variant="outline" className="tabular-nums text-muted-foreground">0</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={p.categories}>
                    {p.categories || '—'}
                  </TableCell>
                  <TableCell>
                    {p.needs_review ? (
                      <Badge variant="outline" className="text-[10px] gap-1 text-warning border-warning/50">
                        <Flag className="size-3" /> Por revisar
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Con familia</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {/* F50: el check «lo uso» POR MODELO + «usar/apagar todo el modelo» (prende el
                          teléfono y sus repuestos en una transacción). Es lo que decide si este
                          modelo aparece al registrar un servicio. */}
                      <button
                        type="button"
                        data-phone-in-use={p.id}
                        data-phone-in-use-state={(p.in_use ?? 0) === 1 ? '1' : '0'}
                        disabled={savingUse === p.id}
                        title={(p.in_use ?? 0) === 1
                          ? 'Lo usás: aparece al registrar un servicio. Clic para apagarlo'
                          : 'Apagado: NO aparece al registrar. Clic para usarlo'}
                        onClick={() => toggleUsoModelo(p, (p.in_use ?? 0) !== 1)}
                        className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors',
                          (p.in_use ?? 0) === 1
                            ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
                            : 'text-muted-foreground hover:bg-accent')}
                      >
                        {(p.in_use ?? 0) === 1 ? '✓ Lo uso' : 'No lo uso'}
                      </button>
                      <Button variant="outline" size="sm" onClick={() => setDetailId(p.id)}>
                        <Eye data-icon="inline-start" /> Ficha
                      </Button>
                      {canWrite && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            title="Corregir el nombre de este teléfono"
                            onClick={() => setEditPhone(p)}
                          >
                            <Pencil data-icon="inline-start" /> Corregir
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Es el mismo teléfono escrito distinto: juntar las dos fichas"
                            aria-label={`Juntar «${p.name}» con otro teléfono`}
                            onClick={() => setMergePhone(p)}
                          >
                            <Merge />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Ver qué repuestos le sirven"
                        aria-label={`Ver los repuestos compatibles con ${p.name}`}
                        disabled={p.products === 0}
                        onClick={() => onByModel(p.name)}
                      >
                        <Layers />
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
          {error
            ? 'No se pudo leer la lista de teléfonos'
            : total === 0 ? 'Sin resultados' : `Mostrando ${from}–${to} de ${total}`}
          {updating && <span data-refreshing="1" className="ml-2 opacity-70">· actualizando…</span>}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0 || !!error} onClick={() => setPage(p => Math.max(0, p - 1))}>
            <ChevronLeft data-icon="inline-start" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages || !!error} onClick={() => setPage(p => p + 1)}>
            Siguiente <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <Separator />
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ChevronsUpDown className="size-3.5" />
          Clic en un encabezado: ascendente → descendente → sin orden.
        </span>
        <span className="flex items-center gap-1.5">
          <Flag className="size-3.5 text-warning" />
          «Por revisar» = el nombre no dice su familia comercial (ej. «8P», «11T Pro»): se corrige con «Corregir».
        </span>
        <span className="flex items-center gap-1.5">
          <Layers className="size-3.5" />
          Los repuestos de cada teléfono salen de la compatibilidad del catálogo; esta lista no cambia stock.
        </span>
        {canWrite && (
          <span className="flex items-center gap-1.5">
            <Pencil className="size-3.5" />
            «Corregir» cambia el nombre (mirá la vista previa); «juntar» fusiona dos fichas del mismo teléfono.
          </span>
        )}
      </div>

      <PhoneDetailDialog phoneId={detailId} onClose={() => setDetailId(null)} onByModel={onByModel} />

      {editPhone && (
        <PhoneEditDialog
          phone={editPhone}
          brands={kpis.brandList}
          onClose={() => setEditPhone(null)}
          onSaved={msg => { toast.success(msg); setReloadKey(k => k + 1); }}
          onMerge={p => { setEditPhone(null); setMergePhone(p); }}
        />
      )}

      {showAdd && (
        <PhoneEditDialog
          phone={null}
          brands={kpis.brandList}
          onClose={() => setShowAdd(false)}
          onSaved={msg => { toast.success(msg); setReloadKey(k => k + 1); }}
          onMerge={() => { /* en alta no hay fusión */ }}
        />
      )}

      {mergePhone && (
        <PhoneMergeDialog
          keep={mergePhone}
          onClose={() => setMergePhone(null)}
          onMerged={msg => { toast.success(msg); setReloadKey(k => k + 1); }}
        />
      )}
    </div>
  );
}
