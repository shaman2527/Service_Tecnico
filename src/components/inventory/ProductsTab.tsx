import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Copy, Layers, MoveHorizontal,
  PackageSearch, Pencil, Search, TriangleAlert, Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/db';
import { toast } from 'sonner';
import type { Category, InventoryStats, Product, VariantFamily } from '@/types';
import { cn, partLabel } from '@/lib/utils';
import { useVentanaAngosta } from '@/lib/use-media';
import { variantFamilyLabel, variantLabel } from '@/lib/variant';
import { StockBadge } from './StockBadge';
import { CompatChips } from './CompatChips';
import { ProductsByModel } from './ProductsByModel';
import { Kpi, KpiStrip } from './Kpi';

const PAGE_SIZE = 50;

/**
 * F51 — ENCABEZADO QUE ORDENA (pedido del dueño: «en Producto tenga el ordenamiento por columnas»).
 * Clic: `<col>` (su orden útil) → `<col>_desc` → sin orden (nombre). La flecha y `aria-sort` dicen
 * en qué estado está, y el `title` explica qué hace (nada de iconos mudos).
 *
 * La FLECHA se ve siempre que la columna manda y al pasar por encima (o al enfocar con el teclado).
 * Antes estaba fija en las once columnas: a 1024 px de ventana el hueco de la flecha hacía que
 * rótulos como «Variante» o «Categoría» se cortaran, que es lo que se veía sucio.
 */
function SortHead({ col, label, estado, onClick, className, title, align = 'left' }: {
  col: string;
  label: string;
  estado: 'asc' | 'desc' | null;
  onClick: (col: string) => void;
  className?: string;
  title?: string;
  align?: 'left' | 'center' | 'right';
}) {
  const Icono = estado === 'desc' ? ChevronDown : estado === 'asc' ? ChevronUp : ChevronsUpDown;
  return (
    <TableHead className={className} aria-sort={estado === 'asc' ? 'ascending' : estado === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        data-sort={col}
        data-sort-state={estado ?? 'none'}
        onClick={() => onClick(col)}
        title={title ?? `Ordenar por ${label.toLowerCase()} (clic: asc → desc → sin orden)`}
        className={cn(
          'group/orden flex w-full items-center rounded transition-colors hover:bg-accent',
          align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start',
          estado && 'font-semibold text-foreground',
        )}
      >
        <span className="truncate">{label}</span>
        <Icono className={cn('size-3 shrink-0 transition-opacity duration-150 motion-reduce:transition-none',
          estado ? 'text-primary opacity-100' : 'text-muted-foreground/50 opacity-0 group-hover/orden:opacity-100 group-focus-visible/orden:opacity-100')} />
      </button>
    </TableHead>
  );
}

/**
 * El reparto del ancho de la tabla, en porcentajes que suman 100 % (uno por columna, en el MISMO
 * orden en que se pintan). Con `table-fixed` la tabla NUNCA se sale de la tarjeta: si falta sitio
 * las columnas se aprietan y el texto se corta con `truncate` + `title`.
 *
 * Antes la tabla pedía ~1.500 px (anchos fijos de `w-24`/`w-32` y `p-3` por celda), así que en
 * cualquier ventana normal aparecía la barra de scroll horizontal y había que moverse a los lados
 * para ver el stock — justo lo que el dueño pidió quitar.
 *
 * Van dos repartos porque la columna «Costo» solo existe en la sesión del dueño (F68): si el
 * porcentaje de esa columna se quedara en la lista, la tabla se estiraría de menos y no llenaría.
 */
const ANCHOS_CON_COSTO = ['19.2%', '6.5%', '8.2%', '6.2%', '7.2%', '7.4%', '10.6%', '9%', '6%', '5.8%', '4.8%', '9.1%'];
const ANCHOS_SIN_COSTO = ['25.2%', '6.5%', '8.2%', '6.2%', '7.2%', '7.4%', '10.6%', '9%', '5.8%', '4.8%', '9.1%'];

/**
 * Una celda del inventario. `overflow-hidden` es la pieza que impide que un dato largo ensanche la
 * tabla (sin él, un nombre sin espacios empujaba y volvía la barra horizontal).
 */
const CELDA = 'overflow-hidden px-1.5 py-2 align-middle';
/** La misma celda cuando la tabla está APILADA: rótulo a la izquierda, dato a la derecha. */
const CELDA_APILADA = 'flex items-center justify-between gap-3 px-0 py-1';

/** El rótulo de una celda apilada (en la tabla normal el rótulo es el encabezado). */
function Rotulo({ children }: { children: string }) {
  return <span className="shrink-0 text-[11px] text-muted-foreground">{children}</span>;
}

const STOCK_FILTERS = [
  { value: 'todos', label: 'Todo el catálogo' },
  { value: 'con_stock', label: 'Con stock' },
  { value: 'agotado', label: 'Agotados' },
  { value: 'bajo_minimo', label: 'Bajo mínimo' },
  { value: 'negativo', label: 'Faltantes (negativos)' },
  { value: 'sin_precio', label: 'Sin precio' },
  { value: 'sin_compat', label: 'Sin compatibilidad' },
  // F50: el check «lo uso» — es lo que aparece al registrar un servicio.
  { value: 'solo_uso', label: 'Solo lo que uso' },
  { value: 'sin_uso', label: 'Lo que NO uso (apagado)' },
];

export function ProductsTab({ refreshKey, categories, onEdit, stats, onReviewDuplicates, onByModel, onCategoryFilter, verCosto = true, canEdit = true }: {
  categories: Category[];
  onEdit: (p: Product) => void;
  stats: InventoryStats | null;
  onReviewDuplicates: () => void;
  onByModel: (model: string) => void;
  /** sube cuando se guarda/fusiona algo → la tabla vuelve a consultar sola */
  refreshKey: number;
  /**
   * F65 (2ª vuelta) — informa al inventario cuál es la categoría filtrada (o `null` = «Todas»), para
   * que un producto NUEVO nazca en la categoría que el operario está mirando.
   */
  onCategoryFilter?: (categoryId: number | null) => void;
  /**
   * F68 — ¿esta sesión ve el precio de COSTO? El costo (y el capital a costo) son números del dueño:
   * la sesión de caja ve el catálogo —lo necesita para vender— sin los costos.
   */
  verCosto?: boolean;
  /**
   * F69 — ¿esta sesión puede EDITAR la ficha del producto? Editar abre el formulario con el costo y
   * los precios, y `update_product` es del dueño en el backend: acá se esconde el botón para que la
   * caja no llegue a un formulario que le va a rebotar al guardar.
   */
  canEdit?: boolean;
}) {
  // `searchInput` es lo que se escribe y `search` lo que se consulta: el rebote es SÓLO para
  // escribir (feature 41). Antes la pestaña esperaba 200 ms antes de la PRIMERA consulta (y en
  // cada cambio de filtro o de página), así que abrir el inventario costaba 200 ms de esqueleto
  // gratis. Los filtros y la paginación ahora salen en el acto.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Regla del local: el taller trabaja PANTALLAS → el inventario abre filtrado en esa
  // categoría (se puede cambiar el filtro para ver el resto del catálogo).
  const [catFilter, setCatFilter] = useState<string>('todas');
  const [stockFilter, setStockFilter] = useState('todos');
  /** F52 — filtro por FAMILIA de variante (`''` = las fichas sin variante). */
  const [variantFilter, setVariantFilter] = useState<string>('todas');
  const [sort, setSort] = useState('nombre');
  /**
   * F52 — VISTA: la lista plana (una fila por ficha) o «Por modelo» (una fila por teléfono, con sus
   * variantes adentro). El dueño pidió las dos: la plana para trabajar ficha por ficha y la de modelo
   * para buscar como habla el cliente («un A70»), sin que le salgan 4 variantes como 4 teléfonos.
   */
  const [vista, setVista] = useState<'lista' | 'modelo'>('lista');
  /** F52 — familias de variante que hay en el catálogo (para el desplegable del filtro).
   *  Se recargan cuando se guarda/edita algo (`refreshKey`), no en cada tecla. */
  const [familias, setFamilias] = useState<VariantFamily[]>([]);
  useEffect(() => {
    let alive = true;
    api.getVariantFamilies().then(f => { if (alive) setFamilias(f); }).catch(() => { if (alive) setFamilias([]); });
    return () => { alive = false; };
  }, [refreshKey]);

  /**
   * F51 — orden por columnas: clic en el encabezado. Ciclo `<col>` (su orden útil) → `<col>_desc`
   * → `nombre` (sin orden propio). Se recuerda la última orden elegida y la paginación vuelve a la
   * primera página (si no, quedarías en una página que ya no existe).
   */
  const ordenarPor = (col: string) => {
    setSort(prev => (prev === col ? `${col}_desc` : prev === `${col}_desc` ? 'nombre' : col));
    setPage(0);
  };
  /** Estado del encabezado: 'asc' | 'desc' | null (para la flecha y `aria-sort`). */
  const estadoOrden = (col: string): 'asc' | 'desc' | null =>
    sort === col ? 'asc' : sort === `${col}_desc` ? 'desc' : null;

  /**
   * F50 — el check «lo uso» de un producto. Guarda con el comando ANGOSTO (`set_product_in_use`:
   * una sola columna, no puede tocar precios/stock/compatibilidad), marca la fila mientras guarda y
   * recarga la página para que los contadores y el filtro sigan diciendo la verdad.
   */
  const [savingUse, setSavingUse] = useState<number | null>(null);
  /** F50: sube al cambiar un check «lo uso» para que la tabla (y los KPIs) vuelvan a consultar. */
  const [usoBump, setUsoBump] = useState(0);
  const toggleUso = async (p: Product) => {
    if (savingUse != null) return;
    setSavingUse(p.id);
    try {
      const nuevo = (p.in_use ?? 1) === 1 ? false : true;
      await api.setProductInUse(p.id, nuevo);
      setItems(prev => prev.map(x => x.id === p.id ? { ...x, in_use: nuevo ? 1 : 0 } : x));
      toast.success(nuevo ? 'Marcado: aparece al registrar un servicio' : 'Apagado: no aparece al registrar', { id: `uso-${p.id}` });
      setUsoBump(k => k + 1);
    } catch (e) {
      toast.error('No se pudo cambiar el «en uso»', { description: e instanceof Error ? e.message : String(e), id: `uso-${p.id}` });
    } finally {
      setSavingUse(null);
    }
  };
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  // `loading` = todavía no hay NADA que mostrar (esqueleto); `refreshing` = ya hay tabla en
  // pantalla y están llegando los datos nuevos (no se tapa lo que el operario está mirando).
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useRef(false);
  const [catDefaultApplied, setCatDefaultApplied] = useState(false);

  const dupSet = useMemo(() => new Set(stats?.duplicate_ids ?? []), [stats]);

  // primera vez que llegan las categorías: si existe «Pantalla», se filtra por ella
  useEffect(() => {
    if (catDefaultApplied || categories.length === 0) return;
    const pantalla = categories.find(c => c.name.trim().toLowerCase() === 'pantalla');
    setCatDefaultApplied(true);
    if (pantalla) setCatFilter(String(pantalla.id));
  }, [categories, catDefaultApplied]);

  // F65 (2ª vuelta): el filtro activo se informa al inventario (categoría por defecto del producto
  // nuevo). Va en su propio efecto para no depender del filtro por defecto ni del orden de los otros.
  useEffect(() => {
    onCategoryFilter?.(catFilter === 'todas' ? null : Number(catFilter));
  }, [catFilter, onCategoryFilter]);

  // Rebote SÓLO de lo que se escribe; el cambio de página va en el mismo paso para no
  // consultar dos veces (una con la página vieja y otra con la nueva).
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 200);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  useEffect(() => {
    let alive = true;
    if (loaded.current) setRefreshing(true); else setLoading(true);
    api.getProductsPage(
      search,
      catFilter === 'todas' ? null : Number(catFilter),
      null,
      stockFilter,
      variantFilter === 'todas' ? null : variantFilter,
      sort,
      PAGE_SIZE,
      page * PAGE_SIZE,
    ).then(r => {
      if (!alive) return;
      loaded.current = true;
      setItems(r.items);
      setTotal(r.total);
    }).finally(() => {
      if (!alive) return;
      setLoading(false);
      setRefreshing(false);
    });
    return () => { alive = false; };
  }, [search, catFilter, stockFilter, variantFilter, sort, page, refreshKey, usoBump]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  // F51: Precio y Costo se muestran SIEMPRE. Antes se ocultaban si ningún resultado de la PÁGINA
  // tenía precio (`anyPrice` sobre `items`), así que las columnas aparecían y desaparecían al
  // cambiar de filtro, de página ¡o de orden! — y encima desaparecía el encabezado para ordenar por
  // precio. Un producto sin precio se dice con su chip («sin precio») y el costo va en «—».
  // F52: se sumó la columna «Variante» (la variante ya no va pegada al nombre).
  //
  // RESPONSIVE (pedido del dueño: «que se vea todo el inventario sin scrollear a los lados»):
  //   · ancho: la tabla es `table-fixed` con su reparto de porcentajes → nunca sale la barra
  //     horizontal, el contenido se aprieta y se corta con `title`.
  //   · angosto (ventana < 1024 px): la MISMA tabla se APILA — cada celda dice su rótulo a la
  //     izquierda y su dato a la derecha, como una ficha. Se decide en JS (no con dos marcados)
  //     para que las verificaciones en vivo, que cuentan `[data-in-use]` y leen `td[2]`, sigan
  //     viendo exactamente lo mismo.
  const angosta = useVentanaAngosta();
  const anchos = verCosto ? ANCHOS_CON_COSTO : ANCHOS_SIN_COSTO;
  const cols = anchos.length;
  // los KPI son de todo el catálogo: se avisa cuando la tabla está filtrada
  const filterActive = catFilter !== 'todas' || stockFilter !== 'todos' || variantFilter !== 'todas' || search.trim() !== '';

  return (
    <div className="flex flex-col gap-4">
      {stats && (
        <KpiStrip>
          <Kpi label="Productos" value={stats.sku} hint={`${stats.brands} marcas`} />
          <Kpi label="Con stock" value={stats.with_stock} tone="success" hint={stats.with_stock > 0 ? `${stats.units} u.` : undefined} />
          <Kpi label="Agotados" value={stats.out_of_stock} tone={stats.out_of_stock > 0 ? 'warning' : undefined} />
          {stats.negative > 0 && <Kpi label="Faltantes" value={stats.negative} tone="danger" />}
          {stats.low_stock > 0 && <Kpi label="Bajo mínimo" value={stats.low_stock} tone="warning" />}
          {/* F70: el KPI «Sin precio» es un ACCESO DIRECTO — el dueño tiene que poder LISTAR las fichas
              que no se pueden cobrar (antes el número estaba y no había forma de llegar a ellas). */}
          {stats.no_price > 0 && (
            <button type="button" data-kpi="sin-precio" onClick={() => { setStockFilter('sin_precio'); setPage(0); }}
              className="text-left transition-opacity hover:opacity-80"
              title="Ver las fichas con stock y sin precio (no se pueden cobrar)">
              <Kpi label="Sin precio" value={stats.no_price} tone="warning" hint="clic para verlas" />
            </button>
          )}
          {/* F68: el capital a costo es un número del dueño (la caja no ve costos) */}
          {verCosto && <Kpi label="Capital a costo" value={`$${stats.value_cost.toFixed(2)}`} hint={`venta $${stats.value_sale.toFixed(2)}`} />}
        </KpiStrip>
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

      {/* F52 — VISTA: la lista plana (una fila por ficha) o «Por modelo» (una fila por teléfono, con
          sus variantes adentro). El conmutador va arriba de todo para que se vea apenas se entra. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Vista del inventario">
          <button
            type="button"
            data-view="lista"
            data-view-state={vista === 'lista' ? 'on' : 'off'}
            onClick={() => setVista('lista')}
            className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors',
              vista === 'lista' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
          >
            Lista (ficha por ficha)
          </button>
          <button
            type="button"
            data-view="modelo"
            data-view-state={vista === 'modelo' ? 'on' : 'off'}
            onClick={() => setVista('modelo')}
            className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors',
              vista === 'modelo' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
          >
            Por modelo (una fila por teléfono)
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {vista === 'lista'
            ? 'Cada fila es una ficha del catálogo (una pantalla concreta, con su código).'
            : 'Cada fila es un TELÉFONO: sus variantes van adentro, no como modelos distintos.'}
        </span>
      </div>

      {vista === 'modelo' ? (
        <ProductsByModel refreshKey={refreshKey + usoBump} initialSearch={search} onEdit={onEdit}
          verCosto={verCosto} canEdit={canEdit} />
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por producto, marca, modelo, código (P-0142) o teléfono compatible…"
            className="pl-9"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </div>
        <Select value={catFilter} onValueChange={v => { setCatFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full min-w-[9rem] flex-1 sm:w-44 sm:flex-none" aria-label="Filtrar por categoría"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {categories.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={v => { setStockFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full min-w-[10rem] flex-1 sm:w-48 sm:flex-none" aria-label="Filtrar por stock"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STOCK_FILTERS.map(f => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* F52 — filtro por FAMILIA de variante: pedir «OLED» trae OLED y OLED Con Marco (el filtro
            agrupa por material, que es como lo pide el mostrador). */}
        <Select value={variantFilter} onValueChange={v => { setVariantFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full min-w-[9rem] flex-1 sm:w-44 sm:flex-none" aria-label="Filtrar por variante"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las variantes</SelectItem>
            {familias.map(f => (
              <SelectItem key={f.family || 'sin'} value={f.family}>
                {variantFamilyLabel(f.family)} ({f.products})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={v => { setSort(v); setPage(0); }}>
          <SelectTrigger className="w-full min-w-[9rem] flex-1 sm:w-44 sm:flex-none" aria-label="Ordenar la tabla"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nombre">Nombre (A-Z)</SelectItem>
            <SelectItem value="stock">Más stock primero</SelectItem>
            <SelectItem value="stock_asc">Menos stock primero</SelectItem>
            <SelectItem value="marca">Marca y modelo</SelectItem>
            <SelectItem value="reciente">Editados recientemente</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* F51 — se puede ordenar haciendo CLIC en el encabezado de la columna (asc → desc → nombre).
          El desplegable de arriba sigue existiendo para «recientes»; los dos escriben lo mismo. */}
      <p className="text-[11px] text-muted-foreground">
        {angosta
          ? 'Cada repuesto va en su ficha (la ventana está angosta): se ve todo de frente, sin moverse a los lados.'
          : 'Clic en el encabezado de una columna para ordenar (otra vez para el orden inverso).'}
      </p>

      {filterActive && (
        <p className="text-[11px] text-muted-foreground">
          Los números de arriba son de <strong>todo el catálogo</strong>; la tabla de abajo está filtrada
          ({total} {total === 1 ? 'producto' : 'productos'}).
        </p>
      )}

      {/* `@container`: la tarjeta se mide a sí misma, no a la ventana. Sirve para los detalles que
          solo tienen sitio cuando el inventario ocupa una pantalla ancha (el proveedor de la fila). */}
      <Card className="@container overflow-hidden">
        <CardContent className="p-0">
          {/* `table-fixed` + el reparto de `colgroup`: la tabla mide EXACTAMENTE lo que mide la
              tarjeta, así que la barra de scroll horizontal no puede aparecer. */}
          <Table className={cn('w-full text-[13px]', angosta ? 'block' : 'table-fixed')}>
            {!angosta && (
              <colgroup>
                {anchos.map((ancho, i) => <col key={i} style={{ width: ancho }} />)}
              </colgroup>
            )}
            <TableHeader className={cn(angosta && 'hidden')}>
              <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                <SortHead col="nombre" label="Producto" className="h-10 px-3 text-[11px] font-semibold"
                  estado={estadoOrden('nombre')} onClick={ordenarPor} />
                {/* F50: el check «lo uso» — columna propia, ordenable, y es lo que se ofrece al
                    registrar un servicio. Va por fila, sin abrir el producto. */}
                <SortHead col="uso" label="En uso" align="center" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('uso')} onClick={ordenarPor}
                  title="Marcá lo que usás: en el registro de servicio solo aparece lo marcado" />
                <SortHead col="categoria" label="Categoría" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('categoria')} onClick={ordenarPor} />
                <SortHead col="marca" label="Marca" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('marca')} onClick={ordenarPor} />
                <SortHead col="modelo" label="Modelo" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('modelo')} onClick={ordenarPor} />
                {/* F52: la VARIANTE tiene su propia columna (antes iba pegada al nombre) y se ordena. */}
                <SortHead col="variante" label="Variante" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('variante')} onClick={ordenarPor}
                  title="INCELL / OLED / ORIGINAL y sus marcos. Clic para ordenar por variante" />
                <TableHead className="h-10 px-1 text-[11px] font-semibold leading-tight">Modelos compatibles</TableHead>
                <SortHead col="precio" label="Precio" align="right" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('precio')} onClick={ordenarPor} />
                {/* F68: la columna de COSTO es del dueño (la caja vende, no administra el margen).
                    Va en el encabezado Y en el cuerpo: antes el cuerpo pintaba la celda igual, así
                    que la sesión de caja veía doce celdas contra once encabezados y las columnas se
                    corrían una posición. */}
                {verCosto && (
                  <SortHead col="costo" label="Costo" align="right" className="h-10 px-1 text-[11px] font-semibold"
                    estado={estadoOrden('costo')} onClick={ordenarPor} />
                )}
                <SortHead col="stock" label="Stock" align="center" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('stock')} onClick={ordenarPor} />
                <SortHead col="minimo" label="Mín" align="right" className="h-10 px-1 text-[11px] font-semibold"
                  estado={estadoOrden('minimo')} onClick={ordenarPor} />
                <TableHead className="h-10 px-2" />
              </TableRow>
            </TableHeader>
            <TableBody className={cn(angosta && 'block')}>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  <TableCell colSpan={cols} className="px-3"><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={cols} className="px-3 py-8">
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
                <TableRow key={p.id} className={cn('align-middle', angosta && 'grid grid-cols-2 gap-x-4 px-3 py-2')}>
                  {/* ── Producto (el nombre de la ficha; en la vista apilada encabeza la tarjeta).
                      Dos renglones: el NOMBRE arriba (es lo que se busca) y el código + los avisos
                      abajo. Antes todo iba en un renglón y con dos avisos el nombre quedaba en
                      «PANTALLA OLED S…» — el nombre es el dato, los avisos son el adorno. ── */}
                  <TableCell className={cn('px-3 py-1.5', angosta && 'col-span-2 flex flex-col items-start gap-1 px-0 py-0.5')}>
                    <div className="flex w-full min-w-0 flex-col gap-0.5">
                      {/* F51: `data-product-name` expone el NOMBRE tal como está en la base (el rótulo
                          bonito de `partLabel` no sirve para comparar contra la base en las pruebas). */}
                      <span className="min-w-0 truncate font-medium" data-product-name={p.name} title={partLabel(p)}>{partLabel(p)}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                        {p.code && (
                          <span className="shrink-0 font-mono" data-product-code={p.code}>{p.code}</span>
                        )}
                        {/* F52: la variante se fue a su propia columna (acá quedaba pegada al nombre). */}
                        {dupSet.has(p.id) && (
                          <span className="flex shrink-0 items-center gap-0.5 text-warning" title="Repetido: el mismo teléfono está en dos fichas (se fusionan desde el aviso de arriba)">
                            <Copy className="size-3" /> repetido
                          </span>
                        )}
                        {/* El proveedor solo cabe cuando el inventario ocupa una pantalla ancha. */}
                        {p.supplier && (
                          <span className="hidden min-w-0 items-center gap-1 truncate @4xl:flex"
                            title={`Proveedor que trajo esta mercancía: ${p.supplier}`}>
                            <Truck className="size-3 shrink-0" /> <span className="truncate">{p.supplier}</span>
                          </span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  {/* ── En uso (F50): un interruptor de verdad, no un texto «✓ Sí» ── */}
                  <TableCell className={cn(CELDA, 'text-center', angosta && CELDA_APILADA)}>
                    {angosta && <Rotulo>En uso</Rotulo>}
                    <Switch
                      checked={(p.in_use ?? 1) === 1}
                      onCheckedChange={() => toggleUso(p)}
                      disabled={savingUse === p.id}
                      data-in-use={p.id}
                      data-in-use-state={(p.in_use ?? 1) === 1 ? '1' : '0'}
                      aria-label={`${partLabel(p)}: usarlo al registrar un servicio`}
                      title={(p.in_use ?? 1) === 1
                        ? 'Lo usás: aparece al registrar un servicio. Clic para apagarlo'
                        : 'Apagado: NO aparece al registrar un servicio. Clic para usarlo'}
                    />
                  </TableCell>
                  {/* ── Categoría (td[2]: las pruebas leen esta celda por posición) ── */}
                  <TableCell className={cn(CELDA, 'truncate text-xs text-muted-foreground', angosta && CELDA_APILADA)}
                    title={p.category_name ?? undefined}>
                    {angosta && <Rotulo>Categoría</Rotulo>}
                    <span className="truncate">{p.category_name ?? '—'}</span>
                  </TableCell>
                  <TableCell className={cn(CELDA, 'text-xs', angosta && CELDA_APILADA)} title={p.brand ?? undefined}>
                    {angosta && <Rotulo>Marca</Rotulo>}
                    <span className="truncate">{p.brand ?? '—'}</span>
                  </TableCell>
                  <TableCell className={cn(CELDA, 'text-xs', angosta && CELDA_APILADA)} title={p.model ?? undefined}>
                    {angosta && <Rotulo>Modelo</Rotulo>}
                    <span className="truncate font-medium tabular-nums">{p.model ?? '—'}</span>
                  </TableCell>
                  {/* F52: la VARIANTE con su nombre real (o «—» cuando la ficha no la tiene).
                      `data-variant` va en el ELEMENTO DEL VALOR y no en la celda: así su `innerText`
                      es exactamente la variante (la prueba la compara contra la base) y el rótulo de
                      la vista apilada no lo ensucia. */}
                  <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
                    {angosta && <Rotulo>Variante</Rotulo>}
                    {p.variant
                      ? (
                        <span data-variant={p.variant} className="min-w-0">
                          <Badge variant="secondary" className="max-w-full truncate px-1.5 text-[10px] font-medium">{variantLabel(p.variant)}</Badge>
                        </span>
                      )
                      : <span data-variant="" className="truncate text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  {/* ── Modelos compatibles (los chips: dentro de la tabla uno solo + el «+N») ── */}
                  <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
                    {angosta && <Rotulo>Modelos compatibles</Rotulo>}
                    <CompatChips
                      compatibility={p.compatibility}
                      max={angosta ? 6 : 1}
                      /* Los chips NO se encogen (`shrink-0`): si falta sitio se recorta el «+N» del
                         final y no el nombre del teléfono, que es el dato. Sin esto el chip se
                         apretaba y el modelo salía partido en dos renglones. */
                      className={cn('min-w-0', angosta ? 'justify-end' : 'flex-nowrap overflow-hidden [&>div]:shrink-0')}
                    />
                  </TableCell>
                  {/* F51: precio y costo SIEMPRE visibles, en columnas separadas (cada una ordena) */}
                  <TableCell className={cn(CELDA, 'text-right', angosta && CELDA_APILADA)}>
                    {angosta && <Rotulo>Precio</Rotulo>}
                    {p.price_sale > 0
                      ? <span className="font-medium tabular-nums" data-field="precio">${p.price_sale.toFixed(2)}</span>
                      : <Badge variant="outline" className="whitespace-nowrap border-warning/50 px-1.5 text-[10px] text-warning">sin precio</Badge>}
                  </TableCell>
                  {verCosto && (
                    <TableCell className={cn(CELDA, 'text-right text-[11px] text-muted-foreground', angosta && CELDA_APILADA)}>
                      {angosta && <Rotulo>Costo</Rotulo>}
                      <span className="tabular-nums" data-field="costo">{p.price_cost > 0 ? `$${p.price_cost.toFixed(2)}` : '—'}</span>
                    </TableCell>
                  )}
                  <TableCell className={cn(CELDA, 'text-center', angosta && CELDA_APILADA)}>
                    {angosta && <Rotulo>Stock</Rotulo>}
                    <StockBadge stock={p.stock} minStock={p.min_stock} />
                  </TableCell>
                  <TableCell className={cn(CELDA, 'text-right tabular-nums text-muted-foreground', angosta && CELDA_APILADA)}>
                    {angosta && <Rotulo>Mín</Rotulo>}
                    <span>{p.min_stock}</span>
                  </TableCell>
                  {/* Las dos acciones van en ICONO: con texto («Editar») no caben en una tabla de
                      once columnas sin volver a empujar el ancho. Cada una dice lo que hace en su
                      `title`, y el botón de editar es el mismo que abre la ficha completa. */}
                  <TableCell className={cn('overflow-hidden px-2 py-2', angosta && 'col-span-2 flex items-center justify-end px-0 py-1')}>
                    <div className="flex justify-end gap-1">
                      {p.model && (
                        <Button variant="ghost" size="sm" className="size-8 px-0"
                          title="Ver qué repuestos le sirven a este modelo"
                          aria-label={`Ver los repuestos del modelo ${p.model}`}
                          onClick={() => onByModel(p.model ?? '')}>
                          <Layers />
                        </Button>
                      )}
                      {canEdit && (
                        <Button variant="outline" size="sm" className="size-8 px-0"
                          title="Editar esta ficha (nombre, categoría, precios, stock)"
                          aria-label={`Editar ${partLabel(p)}`}
                          onClick={() => onEdit(p)}>
                          <Pencil />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {total === 0 ? 'Sin resultados' : `Mostrando ${from}–${to} de ${total}`}
          {/* hay tabla en pantalla y están llegando datos nuevos (o el rebote todavía espera):
              se avisa, no se tapa */}
          {(refreshing || searchInput !== search) && <span data-refreshing="1" className="ml-2 opacity-70">· actualizando…</span>}
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
      </>
      )}
    </div>
  );
}
