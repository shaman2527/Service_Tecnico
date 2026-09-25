import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, Copy, Layers, Pencil, Search, Smartphone, Star, Target,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/db';
import { toast } from 'sonner';
import type { PhoneDetail, PhoneListRow, Product } from '@/types';
import { cn, partLabel } from '@/lib/utils';
import { partsCountLabel, priceRangeLabel } from '@/lib/variant';
import { StockBadge } from './StockBadge';
import { ModelsDuplicatesDialog } from './ModelsDuplicatesDialog';

const PAGE_SIZE = 50;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// F52 — «POR MODELO»: UNA FILA POR TELÉFONO, con las variantes y las pantallas ADENTRO.
//
// Pedido del dueño (2026-09-20): «cuando yo busco un Samsung A70 me sale también A705 — ya este viene
// siendo otro modelo de tlf; debería salir una sola por modelo… si no existe ese modelo se agrega
// como un registro nuevo, modelo con su variante y compatibilidades».
//
// La diferencia con la lista plana (que se conserva, para trabajar ficha por ficha) es la UNIDAD de
// la fila: acá la fila es el TELÉFONO del padrón (`phones`, con su código M-007) y sus variantes son
// CHIPS, no modelos distintos. Buscar «a70» devuelve un modelo con sus 4 variantes adentro.
//
// Lo que muestra cada fila: código · nombre del teléfono · marca · chips de variante · cantidad de
// repuestos · stock total · rango de precios · el check «lo uso» (el MISMO del padrón: decide qué se
// ofrece al registrar un servicio) · la pantalla de REFERENCIA (la que el local instala siempre).
// Al desplegarla se ven sus repuestos con código, variante, precio, costo, stock y su propio check,
// y un botón para fijar/cambiar la pantalla de referencia del modelo.
//
// NADA de plata: el check «lo uso» y la referencia son dos columnas del padrón; no tocan stock,
// precios, movimientos ni compatibilidad (comandos angostos).
// ────────────────────────────────────────────────────────────────────────────────────────────────

export function ProductsByModel({ refreshKey, initialSearch = '', onEdit, verCosto = true, canEdit = true }: {
  refreshKey: number;
  /** lo que se escribió en el buscador de Productos: acá se busca el MODELO, no la ficha */
  initialSearch?: string;
  onEdit: (p: Product) => void;
  /** F69 — el COSTO es del dueño (la caja cobra, no negocia el capital del negocio). */
  verCosto?: boolean;
  /** F69 — editar la ficha del producto (precios/costo) también es del dueño. */
  canEdit?: boolean;
}) {
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [rows, setRows] = useState<PhoneListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** teléfono desplegado (uno por vez: es una consulta al backend) y su ficha */
  const [abierto, setAbierto] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<PhoneDetail | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [savingUse, setSavingUse] = useState<number | null>(null);
  const [guardandoRef, setGuardandoRef] = useState<number | null>(null);
  /** sube al marcar/apagar o al fijar la referencia, para volver a consultar */
  const [bump, setBump] = useState(0);
  /** F53 — asistente de modelos repetidos (propuesta con vista previa + fusión grupo por grupo). */
  const [showDups, setShowDups] = useState(false);

  useEffect(() => { setSearchInput(initialSearch); setSearch(initialSearch); }, [initialSearch]);

  // rebote SÓLO de lo que se escribe (misma regla que la lista plana)
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 220);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  useEffect(() => {
    let alive = true;
    if (rows.length > 0) setRefreshing(true); else setLoading(true);
    api.getPhones(null, search, false, false, false, 'nombre', 'asc', PAGE_SIZE, page * PAGE_SIZE)
      .then(r => { if (!alive) return; setRows(r.items); setTotal(r.total); })
      .catch(() => { if (alive) { setRows([]); setTotal(0); } })
      .finally(() => { if (alive) { setLoading(false); setRefreshing(false); } });
    return () => { alive = false; };
  }, [search, page, refreshKey, bump]);

  /** La ficha del teléfono desplegado (sus repuestos con código/variante/precio/stock). */
  useEffect(() => {
    if (abierto == null) { setDetalle(null); return; }
    let alive = true;
    setCargandoDetalle(true);
    api.getPhoneDetail(abierto)
      .then(d => { if (alive) setDetalle(d); })
      .catch(() => { if (alive) setDetalle(null); })
      .finally(() => { if (alive) setCargandoDetalle(false); });
    return () => { alive = false; };
  }, [abierto, bump]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  /** F50 — el check «lo uso» del MODELO (mismo comando angosto que la pestaña Modelos). */
  const toggleUso = async (p: PhoneListRow, inUse: boolean) => {
    if (savingUse != null) return;
    setSavingUse(p.id);
    try {
      await api.setPhoneInUse(p.id, inUse);
      setRows(prev => prev.map(x => x.id === p.id ? { ...x, in_use: inUse ? 1 : 0 } : x));
      toast.success(inUse ? `«${p.name}» aparece al registrar un servicio` : `«${p.name}» apagado`, { id: `uso-modelo-${p.id}` });
      setBump(b => b + 1);
    } catch (e) {
      toast.error('No se pudo cambiar el «en uso» del modelo', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSavingUse(null);
    }
  };

  /** F53 — la PANTALLA DE REFERENCIA del modelo: la que se auto-selecciona al registrar el servicio. */
  const fijarReferencia = async (phoneId: number, p: Product) => {
    if (guardandoRef != null) return;
    setGuardandoRef(phoneId);
    try {
      const yaEs = detalle?.phone.default_product_id === p.id;
      await api.setPhoneDefaultProduct(phoneId, yaEs ? null : p.id);
      toast.success(yaEs ? 'Sin pantalla de referencia' : `Referencia: ${partLabel(p)}`, { id: `ref-${phoneId}` });
      setBump(b => b + 1);
    } catch (e) {
      toast.error('No se pudo fijar la pantalla de referencia', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setGuardandoRef(null);
    }
  };

  const abrirFila = (id: number) => setAbierto(prev => (prev === id ? null : id));

  /** Los repuestos del teléfono desplegado, en una sola lista (Pantalla primero, como el backend). */
  const repuestos = useMemo(() => (detalle?.blocks ?? []).flatMap(b => b.items), [detalle]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar el MODELO del teléfono (ej: a70)…"
            className="pl-9"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            data-search="por-modelo"
          />
        </div>
        <span className="text-xs text-muted-foreground" data-model-count={total}>
          {total === 0 ? 'Sin modelos' : `${total} ${total === 1 ? 'modelo' : 'modelos'}`}
          {refreshing && <span data-refreshing="1" className="ml-2 opacity-70">· actualizando…</span>}
        </span>
        {/* F53 — el asistente de repetidos: propone los teléfonos que usan los MISMOS repuestos y el
            dueño decide, con vista previa, con qué nombre se queda cada uno. */}
        <Button variant="outline" size="sm" onClick={() => setShowDups(true)} data-action="modelos-repetidos">
          <Copy data-icon="inline-start" /> Modelos repetidos
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Una fila por <strong>teléfono</strong>: sus variantes van adentro (no son modelos distintos).
        Tocá la fila para ver sus repuestos, con el código y el stock de cada uno.
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead className="w-24">Marca</TableHead>
                <TableHead>Variantes</TableHead>
                <TableHead className="w-24 text-center">Repuestos</TableHead>
                <TableHead className="w-20 text-center">Stock</TableHead>
                <TableHead className="w-32 text-right">Precios</TableHead>
                <TableHead className="w-24 text-center">En uso</TableHead>
                <TableHead className="w-56">Pantalla de referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`sk-${i}`}><TableCell colSpan={9}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8">
                    <Empty>
                      <EmptyMedia><Smartphone className="size-5" /></EmptyMedia>
                      <EmptyTitle>Ningún modelo con ese nombre</EmptyTitle>
                      <EmptyDescription>
                        Se busca en el padrón de teléfonos (el mismo nombre que aparece al registrar un
                        servicio). Probá con la marca («Samsung A70») o revisá la pestaña Modelos.
                      </EmptyDescription>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.map(p => {
                const variantes = p.variants ?? [];
                const estaAbierto = abierto === p.id;
                return (
                  <Fragment key={p.id}>
                    <TableRow
                      data-model-row={p.id}
                      onClick={() => abrirFila(p.id)}
                      className={cn('cursor-pointer', estaAbierto && 'bg-accent/40')}
                    >
                      <TableCell className="text-muted-foreground">
                        {estaAbierto ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span data-model-name={p.name}>{p.name}</span>
                          {p.code && (
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground" data-model-code={p.code}>{p.code}</span>
                          )}
                          {p.needs_review && (
                            <Badge variant="outline" className="text-[10px] text-warning border-warning/50">por revisar</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{p.brand || '—'}</TableCell>
                      <TableCell>
                        {variantes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">sin variante</span>
                        ) : (
                          <div className="flex flex-wrap gap-1" data-variant-chips={p.id}>
                            {variantes.map(v => (
                              <Badge key={v} variant="secondary" className="text-[10px]" data-variant-chip={v}>{v}</Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{p.products}</TableCell>
                      <TableCell className="text-center"><StockBadge stock={p.stock} minStock={0} /></TableCell>
                      <TableCell className="text-right text-xs tabular-nums" data-price-range={p.id}>
                        {priceRangeLabel(p.price_min ?? 0, p.price_max ?? 0)}
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          type="button"
                          data-model-use={p.id}
                          data-model-use-state={(p.in_use ?? 0) === 1 ? '1' : '0'}
                          title={(p.in_use ?? 0) === 1
                            ? 'Lo usás: aparece al registrar un servicio. Clic para apagarlo'
                            : 'Apagado: NO aparece al registrar. Clic para usarlo'}
                          disabled={savingUse === p.id}
                          onClick={e => { e.stopPropagation(); void toggleUso(p, (p.in_use ?? 0) !== 1); }}
                          className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors',
                            (p.in_use ?? 0) === 1
                              ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
                              : 'text-muted-foreground hover:bg-accent')}
                        >
                          {(p.in_use ?? 0) === 1 ? '✓ Lo uso' : 'No lo uso'}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.default_product_id ? (
                          <span className="flex items-center gap-1.5" data-model-ref={p.id}>
                            <Target className="size-3.5 shrink-0 text-primary" />
                            <span className="truncate" title={p.default_product_name}>{p.default_product_name || '—'}</span>
                            {p.default_product_code && (
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{p.default_product_code}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">— sin referencia</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {estaAbierto && (
                      <TableRow data-model-detail={p.id}>
                        <TableCell colSpan={9} className="bg-muted/30 p-0">
                          {cargandoDetalle && (
                            <div className="flex flex-col gap-2 p-4">
                              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
                            </div>
                          )}
                          {!cargandoDetalle && repuestos.length === 0 && (
                            <p className="p-4 text-xs text-muted-foreground">
                              Este modelo no tiene repuestos en el catálogo todavía.
                            </p>
                          )}
                          {!cargandoDetalle && repuestos.length > 0 && (
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2 px-4 pt-3 text-xs text-muted-foreground">
                                <Layers className="size-3.5" />
                                {partsCountLabel(repuestos.length)}
                                {detalle?.phone.categories ? ` · ${detalle.phone.categories}` : ''}
                              </div>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Repuesto</TableHead>
                                    <TableHead className="w-28">Variante</TableHead>
                                    <TableHead className="w-24 text-right">Venta</TableHead>
                                    {verCosto && <TableHead className="w-24 text-right">Costo</TableHead>}
                                    <TableHead className="w-20 text-center">Stock</TableHead>
                                    <TableHead className="w-24 text-center">En uso</TableHead>
                                    <TableHead className="w-40"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {repuestos.map(r => (
                                    <TableRow key={r.id} data-model-part={r.id}>
                                      <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                          <span data-part-name={r.name}>{partLabel(r)}</span>
                                          {r.code && (
                                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground" data-part-code={r.code}>{r.code}</span>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-xs">
                                        {r.variant ? <Badge variant="secondary" className="text-[10px]">{r.variant}</Badge> : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm">
                                        {r.price_sale > 0 ? `$${r.price_sale.toFixed(2)}` : <span className="text-xs text-muted-foreground">sin precio</span>}
                                      </TableCell>
                                      {verCosto && (
                                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                                          {r.price_cost > 0 ? `$${r.price_cost.toFixed(2)}` : '—'}
                                        </TableCell>
                                      )}
                                      <TableCell className="text-center"><StockBadge stock={r.stock} minStock={r.min_stock} /></TableCell>
                                      <TableCell className="text-center">
                                        <span className={cn('text-[11px] font-semibold',
                                          (r.in_use ?? 1) === 1 ? 'text-emerald-700' : 'text-muted-foreground')}
                                          data-part-use={r.id}>
                                          {(r.in_use ?? 1) === 1 ? '✓ Sí' : '—'}
                                        </span>
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex justify-end gap-1">
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant={detalle?.phone.default_product_id === r.id ? 'default' : 'outline'}
                                                size="sm"
                                                data-set-ref={r.id}
                                                disabled={guardandoRef === p.id}
                                                onClick={e => { e.stopPropagation(); void fijarReferencia(p.id, r); }}
                                              >
                                                <Star data-icon="inline-start" />
                                                {detalle?.phone.default_product_id === r.id ? 'Referencia' : 'Usar'}
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <span className="text-xs">
                                                {detalle?.phone.default_product_id === r.id
                                                  ? 'Es la pantalla de referencia: se auto-selecciona al registrar el servicio. Clic para quitarla.'
                                                  : 'Fijar como pantalla de referencia del modelo (se auto-selecciona al registrar).'}
                                              </span>
                                            </TooltipContent>
                                          </Tooltip>
                                          {canEdit && (
                                            <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); onEdit(r); }}>
                                              <Pencil data-icon="inline-start" /> Editar
                                            </Button>
                                          )}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
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
            <ChevronRight data-icon="inline-start" className="rotate-180" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>
            Siguiente <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <ModelsDuplicatesDialog
        open={showDups}
        onOpenChange={setShowDups}
        onMerged={() => setBump(b => b + 1)}
      />
    </div>
  );
}
