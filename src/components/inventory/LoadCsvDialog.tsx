import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, Download, FileSpreadsheet, FileUp, Loader2, PackagePlus,
  Plus, Search, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, isTauri } from '@/db';
import type { Category, CsvPreview, CsvReport, CsvRow, Product } from '@/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { WizardSteps } from './WizardSteps';
import { ProductForm } from '../ProductForm';

// F78 — CARGA MASIVA DE INVENTARIO EN CSV (pedido del dueño: «cambiá el formato de carga masiva a
// .CSV, que tome TODOS los campos del inventario, que se vea si el producto es nuevo o duplicado y
// que se pueda editarlo, dejarlo o eliminarlo, con la categoría (o una nueva), sin cargar producto
// por producto»).
//
// Tres pasos: Archivo → Revisar → Listo.
//   · Paso 1: abrís el .csv de la PC (o lo pegás), con plantilla descargable y export del catálogo.
//   · Paso 2: DOS pestañas — «Nuevos» y «Ya existen» — con el diff campo por campo, acciones por
//     fila (actualizar / dejar / revisar a mano / eliminar / quitar), las categorías nuevas que el
//     archivo necesita (se crean solo si las confirmás) y el resumen de lo que va a pasar.
//   · El STOCK SE SUMA a lo que ya hay (El archivo parcial nunca baja mercancía) y el stock se ve
//     siempre como «hoy → queda».
//
// La lógica (parseo, cruce, validación y escritura) vive en Rust (`src-tauri/src/csvload.rs`) con sus
// pruebas; acá está la pantalla.

const PASOS = ['Archivo', 'Revisar', 'Listo'] as const;
const PAGINA = 100;
/** El mismo tope del backend (8 MB): se avisa ANTES de leer el archivo elegido por error. */
const MAX_BYTES = 8 * 1024 * 1024;

/** Lo que hace cada acción, dicho para el mostrador. */
const ACCIONES: { id: 'actualizar' | 'dejar' | 'eliminar'; label: string; title: string }[] = [
  { id: 'actualizar', label: 'Actualizar con el archivo', title: 'Se escriben los datos del archivo y el stock se SUMA' },
  { id: 'dejar', label: 'Dejar como está', title: 'No se toca nada de esta ficha' },
  { id: 'eliminar', label: 'Eliminar el producto', title: 'Se borra la ficha (no se puede si está en uso)' },
];

const n = (v: number) => v.toLocaleString('es-VE');

export function LoadCsvDialog({ categories, onClose, onApplied }: {
  categories: Category[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [nuevas, setNuevas] = useState<string[]>([]);
  const [proveedor, setProveedor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CsvReport | null>(null);
  const [tab, setTab] = useState<'nuevos' | 'existen'>('nuevos');
  const [pagina, setPagina] = useState(0);
  // «Revisar a mano»: abre la ficha del producto (el mismo formulario del inventario)
  const [aMano, setAMano] = useState<Product | null>(null);
  // filtro rápido dentro de cada pestaña
  const [q, setQ] = useState('');
  const textRef = useRef(text);
  textRef.current = text;

  const abrirArchivo = async () => {
    setError(null);
    if (!isTauri) { setError('Abrir un archivo solo funciona en la app (no en el navegador): pegá el contenido abajo.'); return; }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await open({ multiple: false, filters: [{ name: 'Planilla CSV', extensions: ['csv', 'txt'] }] });
      if (!path || typeof path !== 'string') return;
      const content = await readTextFile(path);
      // El tope de tamaño se avisa ACÁ también (el backend lo rechaza igual, pero así el operario no
      // espera a que se lea un archivo de 300 MB elegido por error en el diálogo).
      if (content.length > MAX_BYTES) {
        setError(`El archivo pesa ${(content.length / (1024 * 1024)).toFixed(1)} MB y el máximo es 8 MB: ¿elegiste el archivo correcto?`);
        return;
      }
      setText(content);
      setFileName(path.split(/[\\/]/).pop() ?? 'inventario.csv');
    } catch (e) {
      setError(`No se pudo abrir el archivo (${e instanceof Error ? e.message : String(e)}). Pegá el contenido abajo.`);
    }
  };

  /** Guarda un texto en el archivo que elija el operario (plantilla o export del catálogo). */
  const guardarArchivo = async (sugerido: string, contenido: string) => {
    setError(null);
    if (!isTauri) { setError('Descargar un archivo solo funciona en la app.'); return; }
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await save({ defaultPath: sugerido, filters: [{ name: 'Planilla CSV', extensions: ['csv'] }] });
      if (!path) return;
      await writeTextFile(path, contenido);
      toast.success(`Guardado: ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      setError(`No se pudo guardar (${e instanceof Error ? e.message : String(e)}).`);
    }
  };

  /** La plantilla la arma el BACKEND: es el mismo módulo que después la lee (una sola verdad). */
  const plantilla = async () => {
    setError(null);
    try {
      const cuerpo = await api.plantillaInventoryCsv();
      await guardarArchivo('plantilla_inventario.csv', cuerpo);
    } catch (e) {
      setError(`No se pudo armar la plantilla (${e instanceof Error ? e.message : String(e)}).`);
    }
  };

  const exportar = async () => {
    setError(null);
    try {
      const csv = await api.exportInventoryCsv(null);
      await guardarArchivo('inventario_actual.csv', csv);
    } catch (e) {
      setError(`No se pudo exportar el catálogo (${e instanceof Error ? e.message : String(e)}).`);
    }
  };

  const revisar = async () => {
    setError(null);
    setBusy(true);
    try {
      const p = await api.previewInventoryCsv(text);
      if (p.fatal) { setError(p.fatal); setPreview(null); return; }
      setPreview(p);
      setRows(p.rows);
      // OJO: las categorías nuevas NO vienen tildadas. La decisión con el dueño es que una categoría
      // que no existe se crea SOLO si él la marca (acá se ve, con su nombre, en «categorías nuevas»).
      setNuevas([]);
      setTab(p.rows.some(r => r.product_id != null) ? 'existen' : 'nuevos');
      setPagina(0);
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Vuelve a cruzar el archivo (después de editar a mano una ficha en el inventario). */
  const refrescar = async () => {
    try {
      const p = await api.previewInventoryCsv(textRef.current);
      if (p.fatal) return;
      const acciones = new Map(rows.map(r => [r.line, { action: r.action, excluded: r.excluded, create_anyway: r.create_anyway }]));
      setPreview(p);
      setRows(p.rows.map(r => ({ ...r, ...(acciones.get(r.line) ?? {}) })));
      setNuevas(prev => prev.filter(nombre => p.new_categories.some(c => c.name === nombre)));
    } catch { /* si falla, se queda lo que ya estaba en pantalla */ }
  };

  const activas = rows.filter(r => !r.excluded);
  const bloqueadas = activas.filter(r => r.issues.length > 0);
  const porClash = activas.filter(r => r.action === 'crear' && (r.name_clash || r.code_clash) && !r.create_anyway);
  // resumen VIVO (se recalcula con lo que el operario va tocando, no con lo que dijo el archivo).
  // OJO: las filas «Dejar como está» NO suman unidades (antes inflaban el resumen: decía que entraban
  // unidades de fichas que no se iban a tocar) y las «Eliminar» RESTAN lo que sale del catálogo.
  const resumen = useMemo(() => {
    let crear = 0, actualizar = 0, dejar = 0, eliminar = 0, unidades = 0, antes = 0, salen = 0;
    const vistos = new Set<number>();
    for (const r of rows) {
      if (r.excluded) continue;
      if (r.action === 'crear') crear++;
      else if (r.action === 'actualizar') actualizar++;
      else if (r.action === 'eliminar') eliminar++;
      else dejar++;
      if (r.action === 'dejar') continue;
      if (r.action === 'eliminar') {
        salen += r.current?.stock ?? 0;
        if (r.current && !vistos.has(r.current.id)) { vistos.add(r.current.id); antes += r.current.stock; }
        continue;
      }
      unidades += r.stock ?? 0;
      if (r.current && !vistos.has(r.current.id)) { vistos.add(r.current.id); antes += r.current.stock; }
    }
    return { crear, actualizar, dejar, eliminar, unidades, antes, salen, despues: antes + unidades + salen };
  }, [rows]);
  /** Fichas que YA existen y a las que el archivo les va a SUMAR stock: es el pie de la trampa
   *  «exporté el catálogo y lo volví a cargar sin tocar nada» (el stock se duplicaría). */
  const sumaAExistentes = rows.filter(r => !r.excluded && r.action === 'actualizar' && (r.stock ?? 0) > 0).length;

  const nuevos = rows.filter(r => r.product_id == null);
  const existen = rows.filter(r => r.product_id != null);
  const filtrar = (list: CsvRow[]) => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(r => `${r.name} ${r.category} ${r.brand} ${r.model} ${r.code}`.toLowerCase().includes(t));
  };
  const listaNuevos = filtrar(nuevos);
  const listaExisten = filtrar(existen);

  const setRow = (line: number, patch: Partial<CsvRow>) => {
    setRows(rs => rs.map(r => (r.line === line ? { ...r, ...patch } : r)));
  };

  const aplicar = async () => {
    setError(null);
    if (busy) return; // doble clic: la carga no puede aplicarse dos veces
    if (bloqueadas.length > 0) {
      setError(`Hay ${bloqueadas.length} fila(s) con algo por corregir (están marcadas en rojo): arreglalas o quitalas del archivo.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.applyInventoryCsv({
        rows,
        columns: preview!.columns,
        supplier: proveedor.trim(),
        file_name: fileName || 'pegado.csv',
        new_categories: nuevas,
      });
      setReport(r);
      setStep(2);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Al cambiar de pestaña o de búsqueda la tabla vuelve a la primera página (el buscador de una lista
  // no aplica a la otra).
  useEffect(() => { setPagina(0); }, [tab, q]);

  /** ¿La columna de este campo venía en el archivo? Si no, el campo NO se toca al aplicar (y por eso
   *  la celda se muestra pero no se deja editar: editar algo que se va a descartar sería una mentira). */
  const columnaDel = (campo: string): boolean => {
    const c = preview?.columns as unknown as Record<string, boolean> | undefined;
    if (!c) return true;
    if (campo === 'min_stock') return c.min_stock;
    if (campo === 'price_cost') return c.cost;
    if (campo === 'price_sale') return c.sale;
    if (campo === 'price_usd') return c.cash;
    return c[campo] !== false;
  };

  /** La celda de un dato editable: en «Ya existen» muestra el valor de HOY al lado (el diff). */
  const Celda = ({ row, campo, ancho = 'w-28', tipo = 'text' }: {
    row: CsvRow; campo: 'name' | 'brand' | 'model' | 'variant' | 'compatibility' | 'supplier' | 'code' | 'price_cost' | 'price_sale' | 'price_usd' | 'stock' | 'min_stock';
    ancho?: string; tipo?: 'text' | 'number';
  }) => {
    const valor = row[campo];
    // la compatibilidad se compara como la lee una persona (el JSON crudo marcaba TODAS las filas como
    // «cambió» y mostraba `["Samsung A06 4G"]` en pantalla)
    const actual = row.current
      ? (campo === 'compatibility' ? (row.current.compatibility_text ?? '') : (row.current[campo] as string | number))
      : null;
    const esNumero = tipo === 'number';
    const habilitada = columnaDel(campo);
    const cambio = !habilitada ? false : esNumero
      ? (valor != null && actual != null && Number(valor) !== Number(actual))
      : (valor != null && String(valor).trim() !== '' && String(valor) !== String(actual ?? ''));
    return (
      <div className="flex flex-col gap-0.5">
        <Input
          className={cn('h-8', ancho, cambio && 'border-primary/60 bg-primary/5', !habilitada && 'bg-muted/40 text-muted-foreground')}
          inputMode={esNumero ? 'decimal' : undefined}
          data-field={`csv-${campo}`}
          data-csv-readonly={habilitada ? undefined : 'si'}
          readOnly={!habilitada}
          value={valor == null ? '' : String(valor)}
          placeholder={actual != null && String(actual) !== '' ? String(actual) : '—'}
          title={!habilitada
            ? 'Esta columna no venía en el archivo: este dato no se toca'
            : (actual != null ? `Hoy: ${String(actual)}` : 'No existe todavía')}
          onChange={e => {
            const raw = e.target.value;
            if (esNumero) {
              if (raw.trim() === '') {
                // el stock, además, recalcula el «hoy → queda» de al lado (antes quedaba viejo y la
                // pantalla se contradecía con el resumen del encabezado)
                setRow(row.line, campo === 'stock'
                  ? { stock: null, stock_after: row.current?.stock ?? 0 }
                  : { [campo]: null } as Partial<CsvRow>);
                return;
              }
              const v = Number(raw.replace(',', '.'));
              setRow(row.line, campo === 'stock'
                ? { stock: Number.isFinite(v) ? v : null, stock_after: (row.current?.stock ?? 0) + (Number.isFinite(v) ? v : 0) }
                : { [campo]: Number.isFinite(v) ? v : null } as Partial<CsvRow>);
            } else {
              setRow(row.line, { [campo]: raw } as Partial<CsvRow>);
            }
          }}
        />
        {cambio && actual != null && String(actual) !== '' && (
          <span className="text-[10px] text-muted-foreground">hoy {String(actual)}</span>
        )}
      </div>
    );
  };

  /** El selector de categoría de una fila: existente, nueva (se crea al aplicar) o sin categoría. */
  const Categoria = ({ row }: { row: CsvRow }) => {
    const valor = row.category_id != null ? String(row.category_id) : (row.category_new ? `nueva:${row.category}` : 'nueva');
    return (
      <Select
        value={valor}
        onValueChange={v => {
          if (v === 'nueva') { setRow(row.line, { category: '', category_new: true, category_id: null }); return; }
          if (v.startsWith('nueva:')) return; // la que el propio archivo propone: se queda como está
          const cid = Number(v);
          const cat = categories.find(c => c.id === cid);
          setRow(row.line, { category_id: cid, category: cat?.name ?? row.category, category_new: false });
        }}
      >
        <SelectTrigger className="h-8 w-40" aria-label={`Categoría de ${row.name}`} data-field="csv-categoria">
          <SelectValue placeholder="Elegí" />
        </SelectTrigger>
        <SelectContent>
          {row.category_new && row.category.trim() !== '' && (
            <SelectItem value={`nueva:${row.category}`}>➕ Nueva: {row.category}</SelectItem>
          )}
          {row.category_id == null && row.category.trim() === '' && <SelectItem value="nueva">— Elegí una categoría —</SelectItem>}
          {categories.map(c => (
            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  /** Los avisos de una fila (rojo = bloquea; ámbar = solo informa) + el «crear igual». */
  const Avisos = ({ row }: { row: CsvRow }) => (
    <div className="flex flex-col gap-1">
      {row.issues.map((i, k) => (
        <span key={k} className="flex items-start gap-1 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {i}
        </span>
      ))}
      {row.notes.map((i, k) => (
        <span key={k} className="text-[11px] text-amber-700">{i}</span>
      ))}
      {row.action === 'crear' && (row.name_clash || row.code_clash) && (
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex cursor-pointer items-center gap-1 text-[11px]">
            <input type="checkbox" className="size-3.5" checked={row.create_anyway}
              data-field="csv-crear-igual"
              onChange={e => setRow(row.line, { create_anyway: e.target.checked })} />
            Crear igual (otra variante)
          </label>
          {row.clash_product_id != null && (
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]"
              data-csv-action="actualizar-clash"
              onClick={() => setRow(row.line, { action: 'actualizar', product_id: row.clash_product_id })}>
              <Wand2 className="size-3" /> Actualizar esa ficha
            </Button>
          )}
        </div>
      )}
      {row.shared > 0 && (
        <span className="text-[11px] text-muted-foreground">Otra fila del archivo es la misma ficha</span>
      )}
    </div>
  );

  /** La tabla de una pestaña. Las columnas son los MISMOS campos del formulario de producto. */
  const Tabla = ({ lista, esNuevo }: { lista: CsvRow[]; esNuevo: boolean }) => (
    <>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Cargar</TableHead>
              <TableHead className="w-12">Línea</TableHead>
              <TableHead className="min-w-52">Nombre *</TableHead>
              <TableHead className="min-w-44">Categoría</TableHead>
              <TableHead className="w-28">Marca</TableHead>
              <TableHead className="w-28">Modelo</TableHead>
              <TableHead className="w-24">Variante</TableHead>
              <TableHead className="min-w-44">Compatibilidad</TableHead>
              <TableHead className="w-24">Costo</TableHead>
              <TableHead className="w-24">Venta</TableHead>
              <TableHead className="w-24">Efectivo</TableHead>
              <TableHead className="w-28">Stock</TableHead>
              <TableHead className="w-20">Mín</TableHead>
              <TableHead className="w-28">Proveedor</TableHead>
              <TableHead className="w-24">Código</TableHead>
              <TableHead className="w-48">Qué hacer</TableHead>
              <TableHead className="min-w-48">Avisos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map(row => (
              <TableRow key={`${row.line}-${row.name}`} data-csv-row={row.line}
                className={cn(row.excluded && 'opacity-40', !row.excluded && row.issues.length > 0 && 'bg-destructive/5')}>
                <TableCell>
                  <input type="checkbox" className="size-3.5" aria-label={`Cargar la línea ${row.line}`}
                    data-field="csv-cargar" checked={!row.excluded}
                    onChange={e => setRow(row.line, { excluded: !e.target.checked })} />
                </TableCell>
                <TableCell className="text-[11px] text-muted-foreground tabular-nums">{row.line}</TableCell>
                <TableCell><Celda row={row} campo="name" ancho="w-full min-w-48" /></TableCell>
                <TableCell><Categoria row={row} /></TableCell>
                <TableCell><Celda row={row} campo="brand" /></TableCell>
                <TableCell><Celda row={row} campo="model" /></TableCell>
                <TableCell><Celda row={row} campo="variant" ancho="w-20" /></TableCell>
                <TableCell><Celda row={row} campo="compatibility" ancho="w-full min-w-40" /></TableCell>
                <TableCell><Celda row={row} campo="price_cost" tipo="number" ancho="w-20" /></TableCell>
                <TableCell><Celda row={row} campo="price_sale" tipo="number" ancho="w-20" /></TableCell>
                <TableCell><Celda row={row} campo="price_usd" tipo="number" ancho="w-20" /></TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <Celda row={row} campo="stock" tipo="number" ancho="w-20" />
                    {row.action !== 'eliminar' && row.action !== 'dejar' && (
                      <span className="text-[10px] font-medium text-foreground tabular-nums" data-field="csv-stock-despues">
                        {(row.current?.stock ?? 0)} → {row.stock_after ?? (row.stock ?? 0)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell><Celda row={row} campo="min_stock" tipo="number" ancho="w-16" /></TableCell>
                <TableCell><Celda row={row} campo="supplier" /></TableCell>
                <TableCell><Celda row={row} campo="code" ancho="w-24" /></TableCell>
                <TableCell>
                  {esNuevo ? (
                    <span className="text-[11px] text-muted-foreground">Se crea</span>
                  ) : (
                    <Select value={row.action} onValueChange={v => setRow(row.line, { action: v as CsvRow['action'] })}
                      disabled={row.action === 'crear'}>
                      <SelectTrigger className="h-8 w-44" aria-label={`Qué hacer con ${row.name}`} data-field="csv-accion">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCIONES.map(a => (
                          <SelectItem key={a.id} value={a.id} title={a.title}>{a.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {!esNuevo && (
                    <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 px-2 text-[11px]"
                      data-csv-action="revisar-mano"
                      title="Abrir la ficha del producto para corregirla a mano"
                      onClick={() => {
                        const p = row.current;
                        if (!p) return;
                        setAMano({
                          id: p.id, name: p.name, category_id: p.category_id, brand: p.brand, model: p.model,
                          variant: p.variant, compatibility: p.compatibility, price_cost: p.price_cost,
                          price_sale: p.price_sale, price_usd: p.price_usd, stock: p.stock, min_stock: p.min_stock,
                          created_at: null, updated_at: null, category_name: p.category, supplier: p.supplier,
                          in_use: p.in_use, code: p.code,
                        });
                      }}>
                      <Search className="size-3" /> Revisar a mano
                    </Button>
                  )}
                  {/* «Quitar» = sacar esta fila del archivo (no se carga nada de ella). Es distinto de
                      «Eliminar el producto», que borra la ficha del catálogo. */}
                  <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 px-2 text-[11px] text-muted-foreground hover:text-danger"
                    data-csv-action={row.excluded ? 'reponer' : 'quitar'}
                    onClick={() => setRow(row.line, { excluded: !row.excluded })}>
                    {row.excluded ? <><Plus className="size-3" /> Volver a poner</> : <><Trash2 className="size-3" /> Quitar</>}
                  </Button>
                </TableCell>
                <TableCell><Avisos row={row} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {lista.length > (pagina + 1) * PAGINA && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPagina(p => p + 1)}>
            Ver {Math.min(PAGINA, lista.length - (pagina + 1) * PAGINA)} más ({n(lista.length - (pagina + 1) * PAGINA)} restantes)
          </Button>
        </div>
      )}
      {lista.length === 0 && (
        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {q ? 'Ninguna fila coincide con la búsqueda.' : (esNuevo ? 'No hay productos nuevos en el archivo.' : 'Ninguna fila del archivo coincide con un producto que ya exista.')}
        </p>
      )}
    </>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[min(96vw,80rem)] max-h-[92vh] flex flex-col overflow-hidden" data-csv-dialog>
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-primary" /> Cargar inventario por CSV
          </DialogTitle>
          <div className="pt-1"><WizardSteps steps={PASOS} current={step} /></div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>No se pudo seguir</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {step === 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={abrirArchivo} data-action="csv-abrir">
                  <FileUp data-icon="inline-start" /> Abrir el archivo .csv
                </Button>
                <Button variant="outline" onClick={plantilla} data-action="csv-plantilla">
                  <Download data-icon="inline-start" /> Descargar plantilla
                </Button>
                <Button variant="outline" onClick={exportar} data-action="csv-exportar">
                  <Upload data-icon="inline-start" /> Exportar el catálogo actual
                </Button>
                {fileName && <Badge variant="outline" className="text-[11px]">{fileName}</Badge>}
              </div>

              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Qué trae el archivo:</span> nombre, categoría (o una
                  nueva), marca, modelo, variante, compatibilidad, costo, venta, efectivo, stock, stock mínimo,
                  proveedor, código y «lo uso». Se guarda igual que cuando cargás un producto a mano.
                </p>
                <p className="mt-1">
                  <span className="font-medium text-foreground">El stock se SUMA</span> a lo que ya hay (el archivo nunca
                  deja mercancía en 0) y, si el producto no existe, <span className="font-medium text-foreground">se crea</span> con
                  todo lo que diga la fila. Los productos que ya existen se muestran con el diff y podés actualizarlos,
                  dejarlos o eliminarlos. <span className="font-medium">Cada nombre es único</span>: si se repite, la app te lo pide.
                </p>
                <p className="mt-1">
                  ¿No sabés cómo armarlo? <span className="font-medium text-foreground">Descargá la plantilla</span> (ya trae los
                  ejemplos de batería, flex y pin de carga) o <span className="font-medium text-foreground">exportá el catálogo actual</span> y
                  editá el archivo en Excel: <span className="font-medium text-foreground">una celda vacía no toca ese dato</span>.
                  Ojo con la columna <code>stock</code>: el stock del archivo <span className="font-medium text-foreground">se suma</span> al
                  que ya hay, así que si volvés a cargar lo exportado sin tocar esa columna, las unidades se duplican
                  (vaciala para actualizar solo los datos).
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">…o pegá el contenido del CSV (primera fila = encabezado)</label>
                <Textarea value={text} onChange={e => { setText(e.target.value); setFileName(''); }}
                  rows={10} className="font-mono text-[11px]"
                  placeholder={'nombre;categoria;marca;modelo;costo;venta;stock\nPin de carga Redmi 9A;Pin de carga;Xiaomi;Redmi 9A;0,80;3,00;5'} />
              </div>
            </>
          )}

          {step === 1 && preview && (
            <>
              {/* Resumen vivo de lo que va a pasar */}
              <div className="flex flex-wrap items-center gap-2 text-xs" data-csv-total="resumen">
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10" data-csv-total="nuevos">
                  {n(resumen.crear)} por crear
                </Badge>
                <Badge variant="outline" data-csv-total="existentes">{n(resumen.actualizar)} a actualizar</Badge>
                {resumen.dejar > 0 && <Badge variant="outline">{n(resumen.dejar)} sin tocar</Badge>}
                {resumen.eliminar > 0 && <Badge variant="destructive">{n(resumen.eliminar)} a eliminar</Badge>}
                <Badge variant="outline" data-csv-total="unidades">
                  {n(resumen.antes)} → {n(resumen.despues)} unidades (se suman {n(resumen.unidades)}{resumen.salen > 0 ? `, salen ${n(resumen.salen)}` : ''})
                </Badge>
                {preview.ignored.length > 0 && (
                  <Badge variant="outline" className="text-amber-700" title={preview.ignored.join(', ')}>
                    {preview.ignored.length} columna(s) ignorada(s)
                  </Badge>
                )}
                {bloqueadas.length > 0 && (
                  <Badge variant="destructive" data-csv-total="bloqueadas">{n(bloqueadas.length)} fila(s) por corregir</Badge>
                )}
              </div>

              {preview.issues.length > 0 && (
                <Alert className="border-amber-500/40 bg-amber-500/10">
                  <AlertTriangle className="size-4" />
                  <AlertTitle className="text-xs">Ojo con el archivo</AlertTitle>
                  <AlertDescription className="text-xs">{preview.issues.join(' · ')}</AlertDescription>
                </Alert>
              )}

              {/* La trampa del stock que SUMA: si el archivo trae el stock de fichas que ya existen
                  (el caso típico es exportar el catálogo y volver a cargarlo sin tocar nada), esas
                  unidades se SUMAN a las que ya hay. Se dice con el número, no se esconde. */}
              {sumaAExistentes > 0 && (
                <Alert className="border-amber-500/40 bg-amber-500/10" data-csv-warn="stock-suma">
                  <AlertTriangle className="size-4" />
                  <AlertTitle className="text-xs">
                    El archivo le suma stock a {n(sumaAExistentes)} ficha(s) que ya existen
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    El stock del archivo <strong>se suma</strong> al que ya hay: si exportaste el catálogo y lo
                    volvés a cargar sin cambiar la columna <code>stock</code>, esas unidades se duplican.
                    Si querés actualizar solo los datos, vaciá la columna <code>stock</code> (una celda vacía
                    no toca el stock) o poné esa fila en «Dejar como está».
                  </AlertDescription>
                </Alert>
              )}

              {/* Categorías nuevas: se crean SOLO si el operario las deja marcadas */}
              {preview.new_categories.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2" data-csv-new-categories>
                  <span className="text-sm font-medium">Categorías nuevas que trae el archivo</span>
                  <div className="flex flex-wrap gap-3">
                    {preview.new_categories.map(c => (
                      <label key={c.name} className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input type="checkbox" className="size-3.5" data-field="csv-categoria-nueva"
                          checked={nuevas.includes(c.name)}
                          onChange={e => setNuevas(prev => e.target.checked ? [...prev, c.name] : prev.filter(x => x !== c.name))} />
                        Crear «{c.name}» <span className="text-muted-foreground">({n(c.rows)} fila{c.rows === 1 ? '' : 's'})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium">Proveedor de la carga</label>
                  <Input className="h-8 w-64" value={proveedor} onChange={e => setProveedor(e.target.value)}
                    placeholder="Ej. Cell World (se anota en las fichas)" data-field="csv-proveedor" />
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
                  <Input className="h-8 w-56 pl-7" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en el archivo…" />
                </div>
                {bloqueadas.length > 0 && (
                  <Button variant="outline" size="sm" className="h-8 text-xs" data-csv-action="quitar-bloqueadas"
                    onClick={() => setRows(rs => rs.map(r => (r.issues.length > 0 ? { ...r, excluded: true } : r)))}>
                    <X className="size-3" /> Quitar las {n(bloqueadas.length)} filas con problemas
                  </Button>
                )}
                {porClash.length > 0 && (
                  <span className="text-[11px] text-amber-700">
                    {n(porClash.length)} fila(s) con el nombre o el código repetido: elegí actualizar, cambiar el dato o «crear igual».
                  </span>
                )}
              </div>

              <Tabs value={tab} onValueChange={v => setTab(v as 'nuevos' | 'existen')}>
                <TabsList>
                  {/* Los `data-csv-*` van en un <span> adentro: los Tabs del proyecto (ui/tabs.tsx) no
                      reenvían props, así que el gancho de las pruebas tiene que ir en el contenido. */}
                  <TabsTrigger value="nuevos">
                    <span data-csv-tab="nuevos"><Plus data-icon="inline-start" /> Nuevos ({n(nuevos.length)})</span>
                  </TabsTrigger>
                  <TabsTrigger value="existen">
                    <span data-csv-tab="existentes"><FileSpreadsheet data-icon="inline-start" /> Ya existen ({n(existen.length)})</span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="nuevos" className="flex flex-col gap-3 pt-3">
                  <p className="text-[11px] text-muted-foreground">
                    Estos productos no están en el catálogo: se van a <span className="font-medium text-foreground">crear</span> con
                    los datos de la fila (y su stock). Si el nombre ya existe en otra categoría, la fila te pide decidir.
                  </p>
                  <Tabla lista={listaNuevos} esNuevo />
                </TabsContent>
                <TabsContent value="existen" className="flex flex-col gap-3 pt-3">
                  <p className="text-[11px] text-muted-foreground">
                    Estos ya están en el catálogo. La app muestra <span className="font-medium text-foreground">lo que hay hoy</span> debajo
                    de cada dato y podés <span className="font-medium text-foreground">actualizar</span> (el stock se suma),
                    <span className="font-medium text-foreground"> dejarlo como está</span>, revisarlo a mano o eliminarlo.
                  </p>
                  <Tabla lista={listaExisten} esNuevo={false} />
                </TabsContent>
              </Tabs>
            </>
          )}

          {step === 2 && report && (
            <div className="flex flex-col gap-3">
              <Alert>
                <Check className="size-4" />
                <AlertTitle>Inventario cargado</AlertTitle>
                <AlertDescription className="flex flex-col gap-1 text-xs" data-csv-report>
                  <span><strong>{n(report.created)}</strong> productos creados.</span>
                  <span>
                    <strong>{n(report.updated)}</strong> fichas actualizadas
                    {report.units_added !== 0
                      ? ` (el inventario ${report.units_added > 0 ? 'subió' : 'bajó'} ${n(Math.abs(report.units_added))} unidades)`
                      : ''}.
                  </span>
                  {report.kept > 0 && <span><strong>{n(report.kept)}</strong> quedaron como estaban.</span>}
                  {report.deleted > 0 && <span><strong>{n(report.deleted)}</strong> productos eliminados.</span>}
                  {report.categories_new.length > 0 && (
                    <span><strong>{report.categories_new.length}</strong> categorías nuevas: {report.categories_new.join(', ')}.</span>
                  )}
                  {report.suppliered > 0 && <span><strong>{n(report.suppliered)}</strong> fichas quedaron con su proveedor anotado.</span>}
                  {report.skipped > 0 && <span className="text-muted-foreground"><strong>{n(report.skipped)}</strong> filas las quitaste vos: no se tocaron.</span>}
                  <span><strong>{n(report.movements)}</strong> movimientos anotados en el historial (motivo «Carga masiva (CSV)», con el nombre del archivo).</span>
                  <span className="text-muted-foreground">Respaldo de la base: {report.backup}</span>
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          {step === 1 && (
            <Button variant="outline" onClick={() => setStep(0)} disabled={busy}>
              <ChevronLeft data-icon="inline-start" /> Atrás
            </Button>
          )}
          {step === 0 && (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={revisar} disabled={busy || text.trim().length === 0} data-action="csv-revisar">
                {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Search data-icon="inline-start" />}
                Revisar el archivo
              </Button>
            </>
          )}
          {step === 1 && (
            <Button onClick={aplicar} disabled={busy || activas.length === 0 || bloqueadas.length > 0} data-csv-apply>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <PackagePlus data-icon="inline-start" />}
              Cargar {n(resumen.crear)} nuevos y actualizar {n(resumen.actualizar)}
            </Button>
          )}
          {step === 2 && <Button onClick={onClose}>Listo</Button>}
        </DialogFooter>
      </DialogContent>

      {/* «Revisar a mano»: la ficha de siempre; al cerrar se vuelve a cruzar el archivo */}
      {aMano && (
        <ProductForm
          product={aMano}
          categories={categories}
          onClose={() => { setAMano(null); void refrescar(); }}
          onSaved={() => { setAMano(null); void refrescar(); }}
        />
      )}
    </Dialog>
  );
}
