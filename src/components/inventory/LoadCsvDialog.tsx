import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, Download, FileSpreadsheet, FileUp, Loader2, PackagePlus,
  Plus, Search, Upload, X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, isTauri } from '@/db';
import type { Category, CsvPreview, CsvReport, CsvRow, Product } from '@/types';
import { useVentanaAngosta } from '@/lib/use-media';
import { toast } from 'sonner';
import { WizardSteps } from './WizardSteps';
import { ProductForm } from '../ProductForm';
import { CsvRevisionTable, type ModoCarga } from './CsvRevisionTable';

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
//     ORDENADO COMO UNA LISTA DE DECISIONES (F87): primero la decisión que más plata mueve (el modo
//     del stock), después «qué va a pasar» (el resumen), después lo que el archivo trae raro y
//     recién ahí la lista. Las filas viven en `CsvRevisionTable`.
//   · El MODO DEL STOCK se elige en el paso «Revisar»: SUMAR (compras: hoy + archivo, lo de siempre)
//     o REEMPLAZAR (conteo: el archivo es el inventario real). El stock se ve siempre como
//     «hoy → queda» y el «queda» es el número que manda el backend (nunca negativo).
//
// La lógica (parseo, cruce, validación y escritura) vive en Rust (`src-tauri/src/csvload.rs`) con sus
// pruebas; acá está la pantalla.

const PASOS = ['Archivo', 'Revisar', 'Listo'] as const;
/** El mismo tope del backend (8 MB): se avisa ANTES de leer el archivo elegido por error. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * F87 (REQ-4) — POR DEBAJO DE 1100 px LA REVISIÓN SE APILA. El reparto de columnas del paso
 * «Revisar» se pensó para la ventana de la app (1200×750 y la de 1366×715 que midió el dueño): con
 * menos de eso las columnas se aprietan y conviene una ficha por fila, como ya hace el inventario
 * (`ProductsTab` usa el mismo hook). Se mide la VENTANA y no la caja a propósito: es el mismo umbral
 * con el que se probó el paso.
 */
const ANCHO_APILADO = 1099;

/**
 * F86 (REQ-3) — los dos modos del stock, con lo que pasa dicho para el mostrador (no para el
 * programador). Viven ACÁ (y no en la tabla de la revisión) porque son texto de la pantalla que los
 * ofrece; la tabla sólo recibe el `title` del que está elegido.
 */
const MODOS: { id: ModoCarga; label: string; title: string; consecuencia: string }[] = [
  {
    id: 'sumar',
    label: 'Sumar al stock que ya hay (compras)',
    title: 'El archivo trae lo que LLEGÓ: cada ficha queda con lo que tenía MÁS lo del archivo',
    consecuencia: 'Cada ficha del archivo queda con lo que ya tenía MÁS lo del archivo (hoy + archivo). Es lo de una compra: el archivo es la mercancía que entró.',
  },
  {
    id: 'reemplazar',
    label: 'Reemplazar: el archivo es el inventario real (conteo)',
    title: 'El archivo ES la verdad: cada ficha queda con el número exacto del archivo',
    consecuencia: 'Cada ficha del archivo queda con el número EXACTO que trae el archivo (lo que no venga en el archivo no se toca). Es lo de un conteo: contaste el cajón y ese es el número.',
  },
];

/** Los números de la pantalla, con el separador de miles de acá. */
const n = (v: number) => v.toLocaleString('es-VE');

/**
 * F86 (REQ-2/AC-4) — EL NÚMERO QUE SE VA A ESCRIBIR, con un pedido EXPLÍCITO del archivo (el operario
 * acaba de escribir la celda) y el modo activo. Es la misma regla del backend: celda vacía = no tocar,
 * y nunca por debajo de 0.
 *
 * Vive fuera del componente a propósito: dentro, la cuenta del resumen tendría que depender de una
 * función que se rehace en cada render (y el linter lo marca como dependencia faltante).
 */
const stockConModo = (row: CsvRow, pedido: number | null, modo: ModoCarga): number => {
  const hoy = row.current?.stock ?? 0;
  if (row.product_id == null) return Math.max(0, pedido ?? 0); // ficha nueva: no hay «hoy» que sumar
  if (row.action === 'dejar' || row.action === 'eliminar') return hoy;
  if (pedido == null) return hoy;
  return modo === 'reemplazar' ? Math.max(0, pedido) : Math.max(0, hoy + pedido);
};

/**
 * F86 (REQ-2/AC-4) — el stock con el que la ficha QUEDA, que es lo que hay que mostrar por fila.
 * LO MANDA EL BACKEND (`stock_final`, ya con el modo aplicado y nunca negativo): antes la pantalla lo
 * calculaba por su cuenta y su `clamp(0)` tapaba el problema, así que con una ficha en NEGATIVO la
 * vista previa mostraba un número lindo y la carga escribía −30 (lo que el dueño reportó: «me carga
 * el producto −30»).
 *
 * El número del backend se usa mientras siga valiendo: si el operario cambia el MODO después de
 * revisar, ese número se calculó con el modo viejo y ya no sirve — y volver a cruzar el archivo en ese
 * momento borraría lo que haya corregido a mano. En ese caso se recalcula acá con la MISMA regla del
 * backend (`csvload::stock_final_de`: `max(0, hoy + archivo)` al sumar, `max(0, archivo)` al
 * reemplazar). Lo mismo vale para una celda editada, que ya se guarda recalculada en `stock_final`.
 *
 * Es la ÚNICA regla del stock en la pantalla y la usan los dos lados: el resumen de arriba y el
 * «hoy → queda» de cada fila (que la recibe ya calculada) — así lo que se muestra y lo que se escribe
 * no pueden separarse.
 */
const stockFinalDe = (row: CsvRow, modo: ModoCarga, modoDelPreview: string | undefined): number => {
  if (modo === modoDelPreview && row.stock_final != null) return row.stock_final;
  return stockConModo(row, row.stock, modo);
};

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
  /**
   * F86 (REQ-3/AC-5) — QUÉ HACE LA CARGA CON EL STOCK. Antes era una sola cosa (sumar) y el dueño no
   * tenía cómo decir «esto es un conteo, el archivo es la verdad». Arranca en «sumar» porque es lo de
   * siempre (y lo que el backend asume si no llega el modo), así que quien no lo toque no cambia nada.
   */
  const [modo, setModo] = useState<ModoCarga>('sumar');
  const [tab, setTab] = useState<'nuevos' | 'existen'>('nuevos');
  const [pagina, setPagina] = useState(0);
  // «Revisar a mano»: abre la ficha del producto (el mismo formulario del inventario)
  const [aMano, setAMano] = useState<Product | null>(null);
  // filtros rápidos de la revisión: lo que se escribe y si se ven SÓLO las filas con aviso (F87:
  // con 83 filas y 20 avisos, «mostrame las que tienen algo que leer» es la pregunta más útil).
  const [q, setQ] = useState('');
  const [soloAvisos, setSoloAvisos] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  /** F87 (REQ-4): la MISMA tabla se pinta apilada o en columnas — nunca las dos. */
  const angosta = useVentanaAngosta(ANCHO_APILADO);

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
      // F86 (REQ-3): el modo va en la vista previa — el `stock_final` por fila se calcula con él.
      const p = await api.previewInventoryCsv(text, modo);
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
      // Con el modo activo: el `stock_final` de cada fila depende de él (F86, REQ-3).
      const p = await api.previewInventoryCsv(textRef.current, modo);
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
    let crear = 0, actualizar = 0, dejar = 0, eliminar = 0, unidades = 0, antes = 0, salen = 0, enCero = 0;
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
      // F86 (REQ-2): las unidades que entran son la DIFERENCIA contra lo que hay hoy, no el número
      // del archivo, porque en modo «reemplazar» una ficha puede BAJAR (el conteo encontró menos).
      const hoy = r.current?.stock ?? 0;
      const queda = stockFinalDe(r, modo, preview?.mode);
      if (r.current && hoy < 0 && queda === 0) enCero++;
      unidades += queda - hoy;
      if (r.current && !vistos.has(r.current.id)) { vistos.add(r.current.id); antes += hoy; }
    }
    // OJO: `antes` incluye lo que hay en las fichas que se ELIMINAN, así que esas unidades RESTAN
    // (antes se sumaban: el «queda» del resumen contaba dos veces la mercancía que se borra).
    return { crear, actualizar, dejar, eliminar, unidades, antes, salen, despues: antes + unidades - salen, enCero };
  }, [rows, modo, preview?.mode]);
  /** Fichas que YA existen y a las que el archivo les va a SUMAR stock: es el pie de la trampa
   *  «exporté el catálogo y lo volví a cargar sin tocar nada» (el stock se duplicaría). */
  const sumaAExistentes = rows.filter(r => !r.excluded && r.action === 'actualizar' && (r.stock ?? 0) > 0).length;

  const nuevos = rows.filter(r => r.product_id == null);
  const existen = rows.filter(r => r.product_id != null);

  /**
   * F86 — «no me carga el stock en masa»: si el Excel dice «EXISTENCIAS TOTALES» (o cualquier
   * encabezado que el lector no entienda), ninguna columna mapea a stock y la carga actualiza los
   * datos SIN tocar las unidades. Antes eso se perdía en un badge con el detalle escondido en un
   * `title`; ahora se dice con los encabezados REALES del archivo.
   * `sin_columna_stock` y `columnas_ignoradas` los manda el backend; el `??` es sólo la red por si
   * una versión vieja del backend no los trae (se deduce del mapa de columnas y de la lista vieja).
   */
  const ignoradas = preview?.columnas_ignoradas ?? preview?.ignored ?? [];
  const sinColumnaStock = preview ? (preview.sin_columna_stock ?? preview.columns.stock === false) : false;

  /**
   * F87 (REQ-6/REQ-8) — LOS DOS DATOS NUEVOS DEL BACKEND, leídos DE FORMA DEFENSIVA: si la app corre
   * contra un backend viejo (sin estos campos) la pantalla simplemente no dice la línea; nada se
   * rompe. El contrato ya está fijado en `csvload.rs` (`codigos_recuperados`, `columnas_repetidas`)
   * y no se toca `types.ts` desde acá: el tipo se declara local a propósito.
   */
  const extra = (preview ?? {}) as { codigos_recuperados?: number; columnas_repetidas?: string[] };
  const codigosRecuperados = typeof extra.codigos_recuperados === 'number' ? extra.codigos_recuperados : 0;
  const columnasRepetidas = Array.isArray(extra.columnas_repetidas) ? extra.columnas_repetidas : [];

  /** ¿Esta fila tiene algo que el dueño tenga que leer antes de apretar? (F87: es el filtro útil). */
  const conAviso = (r: CsvRow) => r.issues.length > 0 || r.notes.length > 0 || r.aviso_compat === true;
  const avisadas = activas.filter(conAviso).length;

  const filtrar = (list: CsvRow[]) => {
    const base = soloAvisos ? list.filter(conAviso) : list;
    const t = q.trim().toLowerCase();
    if (!t) return base;
    return base.filter(r => `${r.name} ${r.category} ${r.brand} ${r.model} ${r.code}`.toLowerCase().includes(t));
  };
  const listaNuevos = filtrar(nuevos);
  const listaExisten = filtrar(existen);
  /** F87: cuando no hay ninguna fila que mostrar, se dice POR QUÉ (búsqueda, filtro o el archivo). */
  const vacioDe = (esNuevo: boolean) => {
    if (q.trim() !== '') return 'Ninguna fila coincide con la búsqueda';
    if (soloAvisos) return 'Ninguna fila de esta pestaña trae un aviso';
    return esNuevo ? 'No hay productos nuevos en el archivo' : 'Ninguna fila coincide con un producto que ya exista';
  };

  const setRow = (line: number, patch: Partial<CsvRow>) => {
    setRows(rs => rs.map(r => (r.line === line ? { ...r, ...patch } : r)));
  };

  /**
   * F86 (REQ-2/AC-4) — EL STOCK ESCRITO A MANO. La tabla de la revisión sólo avisa qué número se
   * escribió; acá se recalcula con la MISMA regla que el backend (`stockConModo`: nunca por debajo de
   * 0 y con el modo aplicado) y se reescribe el `stock_final` de la fila para que el «hoy → queda» y
   * el resumen de arriba digan lo mismo que se va a guardar. Al escribir a mano, el `stock_final` que
   * había mandado el backend ya no vale (se calculó con el archivo tal cual vino).
   */
  const editarStock = (row: CsvRow, valor: number | null) => {
    setRow(row.line, {
      stock: valor,
      stock_final: stockConModo(row, valor, modo),
      stock_after: (row.current?.stock ?? 0) + (valor ?? 0),
    });
  };

  /** Con cuánto QUEDA una ficha: es lo que cada fila muestra y lo que suma el resumen (una sola regla). */
  const quedaDe = (row: CsvRow) => stockFinalDe(row, modo, preview?.mode);

  /** «Revisar a mano»: abre la ficha de siempre con los datos de HOY del producto (y al cerrar se
   *  vuelve a cruzar el archivo). La fila sólo dice CUÁL ficha es; el formulario es del inventario. */
  const abrirAMano = (row: CsvRow) => {
    const p = row.current;
    if (!p) return;
    setAMano({
      id: p.id, name: p.name, category_id: p.category_id, brand: p.brand, model: p.model,
      variant: p.variant, compatibility: p.compatibility, price_cost: p.price_cost,
      price_sale: p.price_sale, price_usd: p.price_usd, stock: p.stock, min_stock: p.min_stock,
      created_at: null, updated_at: null, category_name: p.category, supplier: p.supplier,
      in_use: p.in_use, code: p.code,
    });
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
        // F86 (REQ-3/AC-5): el modo viaja SIEMPRE explícito. Si el operario nunca lo tocó, es «sumar»,
        // que es lo que el backend asume cuando falta (F86/AC-6: compatibilidad con lo ya cargado).
        mode: modo,
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

  // Al cambiar de pestaña, de búsqueda o del filtro de avisos la lista vuelve a la primera página (el
  // buscador de una lista no aplica a la otra).
  useEffect(() => { setPagina(0); }, [tab, q, soloAvisos]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[min(96vw,80rem)] max-h-[92vh] flex flex-col overflow-hidden" data-csv-dialog>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-primary" /> Cargar/actualizar el catálogo (CSV/Excel)
          </DialogTitle>
          {/* F86: los dos asistentes de carga se leían como el mismo (éste y el del conteo físico, que
              viven uno al lado del otro en Ajustes). Acá se dice qué hace CADA UNO y qué NO toca. */}
          <p className="text-[11px] text-muted-foreground">
            Crea y actualiza fichas del catálogo con lo que traiga el archivo —todas las categorías— y
            toca el stock según el modo que elijas en «Revisar» (sumar o reemplazar).{' '}
            <strong>No borra ni vacía nada</strong> que no esté en el archivo, salvo que una fila diga
            «Eliminar el producto». Para contar el mostrador está «Contar la mercancía (lista del local)».
          </p>
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

              {/* F87: la explicación de lo que hace la carga, en una tarjeta con su título (antes era
                  un bloque de párrafos suelto y se leía como una advertencia legal). */}
              <Card data-csv-archivo="que-trae">
                <CardHeader className="gap-1 p-4 pb-2">
                  <CardTitle className="text-sm">Qué trae el archivo y qué hace la carga</CardTitle>
                  <CardDescription className="text-[11px]">
                    Se guarda igual que cuando cargás un producto a mano.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 p-4 pt-0 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Qué trae el archivo:</span> nombre, categoría (o una
                    nueva), marca, modelo, variante, compatibilidad, costo, venta, efectivo, stock, stock mínimo,
                    proveedor, código y «lo uso».
                  </p>
                  <p>
                    <span className="font-medium text-foreground">El stock</span> de cada ficha se toca según el modo que
                    elijas en el paso «Revisar»: en modo <span className="font-medium text-foreground">sumar</span> (compras)
                    el archivo <span className="font-medium text-foreground">se suma</span> a lo que ya hay; en modo
                    <span className="font-medium text-foreground"> reemplazar</span> (conteo) cada ficha queda con el número
                    exacto del archivo. Y si el producto no existe, <span className="font-medium text-foreground">se crea</span> con
                    todo lo que diga la fila. Los que ya existen se muestran con el diff y podés actualizarlos,
                    dejarlos o eliminarlos. <span className="font-medium">Cada nombre es único</span>: si se repite, la app te lo pide.
                  </p>
                  <p>
                    ¿No sabés cómo armarlo? <span className="font-medium text-foreground">Descargá la plantilla</span> (ya trae los
                    ejemplos de batería, flex y pin de carga) o <span className="font-medium text-foreground">exportá el catálogo actual</span> y
                    editá el archivo en Excel: <span className="font-medium text-foreground">una celda vacía no toca ese dato</span>.
                    Ojo con la columna <code>stock</code>: la app entiende sus nombres de siempre
                    (<code>stock</code>, <code>cantidad</code>, <code>unidades</code>, <code>qty</code>, «stock actual»,
                    «cant. física»…). Si tu planilla la llama de otra forma, <span className="font-medium text-foreground">el
                    asistente te lo avisa antes de cargar</span> y no se toca ninguna unidad. Y si volvés a cargar lo
                    exportado sin tocar esa columna, en modo «sumar» las unidades se duplican (vaciala para actualizar
                    solo los datos).
                  </p>
                </CardContent>
              </Card>

              <div className="flex flex-col gap-1">
                <label htmlFor="csv-pegar" className="text-sm font-medium">…o pegá el contenido del CSV (primera fila = encabezado)</label>
                <Textarea id="csv-pegar" value={text} onChange={e => { setText(e.target.value); setFileName(''); }}
                  rows={10} className="font-mono text-[11px]"
                  placeholder={'nombre;categoria;marca;modelo;costo;venta;stock\nPin de carga Redmi 9A;Pin de carga;Xiaomi;Redmi 9A;0,80;3,00;5'} />
              </div>
            </>
          )}

          {step === 1 && preview && (
            <>
              {/* ── DECISIÓN 1 (F86, REQ-3/AC-5) — ¿QUÉ HACE LA CARGA CON EL STOCK? ────────────────
                  Es la primera decisión de este paso y estaba escondida: el asistente siempre sumaba y
                  el dueño no tenía cómo decir «esto es un conteo». Va primera, con lo que va a pasar
                  escrito, y viaja en el payload (`mode`) — el backend asume «sumar» si falta, que es
                  exactamente lo que dice la opción por defecto. F87: las dos opciones son un grupo de
                  botones (no dos botones pintados a mano) para que se lea CUÁL está elegida. */}
              <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
                data-csv-modo={modo} data-csv-modo-activo={modo}>
                <span className="text-sm font-medium">¿Qué hace el stock del archivo?</span>
                <ToggleGroup type="single" value={modo} aria-label="Qué hace el stock del archivo"
                  onValueChange={v => { if (v) setModo(v as ModoCarga); }}
                  className="flex-wrap justify-start gap-2">
                  {MODOS.map(m => (
                    <ToggleGroupItem key={m.id} value={m.id} variant="outline" size="sm"
                      title={m.title} aria-pressed={modo === m.id} data-csv-modo-opcion={m.id}
                      className="h-auto whitespace-normal px-3 py-1.5 text-left text-xs data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-xs text-muted-foreground" data-csv-modo-consecuencia>
                  {MODOS.find(m => m.id === modo)!.consecuencia}
                </p>
              </div>

              {/* ── DECISIÓN 2: QUÉ VA A PASAR (resumen vivo) ─────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs" data-csv-total="resumen">
                <span className="text-[11px] font-medium">Qué va a pasar:</span>
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10" data-csv-total="nuevos">
                  {n(resumen.crear)} por crear
                </Badge>
                <Badge variant="outline" data-csv-total="existentes">{n(resumen.actualizar)} a actualizar</Badge>
                {resumen.dejar > 0 && <Badge variant="outline">{n(resumen.dejar)} sin tocar</Badge>}
                {resumen.eliminar > 0 && <Badge variant="destructive">{n(resumen.eliminar)} a eliminar</Badge>}
                {resumen.enCero > 0 && (
                  <Badge variant="outline" className="text-warning" data-csv-clamped={resumen.enCero}
                    title="Esa ficha venía en faltante (stock negativo) y la carga la deja en 0: no arrastra un negativo">
                    {n(resumen.enCero)} en negativo → 0
                  </Badge>
                )}
                <Badge variant="outline" data-csv-total="unidades">
                  {n(resumen.antes)} → {n(resumen.despues)} unidades ({resumen.unidades >= 0 ? 'se suman' : 'se quitan'} {n(Math.abs(resumen.unidades))}{resumen.salen > 0 ? `, salen ${n(resumen.salen)}` : ''})
                </Badge>
                {bloqueadas.length > 0 && (
                  <Badge variant="destructive" data-csv-total="bloqueadas">{n(bloqueadas.length)} fila(s) por corregir</Badge>
                )}
              </div>

              {/* ── LO QUE EL ARCHIVO TRAE RARO (y se dice, no se esconde) ────────────────────────── */}

              {sinColumnaStock && (
                <Alert variant="destructive" data-csv-aviso="sin-stock">
                  <AlertTriangle className="size-4" />
                  <AlertTitle className="text-xs">Tu archivo no trae una columna de stock reconocida</AlertTitle>
                  <AlertDescription className="text-xs">
                    Vimos estos encabezados: <strong>{ignoradas.length > 0 ? ignoradas.join(', ') : 'ninguno conocido'}</strong>.
                    Así <strong>NO se va a tocar el stock</strong>: se actualizan los datos y las unidades quedan como están.
                    Renombrá la columna a <code>stock</code> (o a <code>cantidad</code>) y volvé a revisar el archivo.
                  </AlertDescription>
                </Alert>
              )}

              {/* Las columnas que no se entendieron, A LA VISTA (el detalle estaba sólo en un `title`,
                  así que en la práctica nadie se enteraba de que su dato no se iba a cargar). */}
              {ignoradas.length > 0 && (
                <Alert className="border-warning/40 bg-warning/10" data-csv-ignoradas={ignoradas.length} title={ignoradas.join(', ')}>
                  <AlertTriangle className="size-4 text-warning" />
                  <AlertTitle className="text-xs text-warning">Estas columnas no las entendí y las ignoré (no se cargan)</AlertTitle>
                  <AlertDescription className="text-xs">
                    <strong>{ignoradas.join(', ')}</strong>. Si alguna tenía que cargarse, renombrala como en la plantilla.
                  </AlertDescription>
                </Alert>
              )}

              {/* F87 (REQ-6/REQ-8) — DE DÓNDE SALIERON LOS CÓDIGOS Y QUÉ COLUMNA REPETIDA SE DESCRITÓ.
                  El Excel del dueño traía «Producto» con el código PEGADO al nombre
                  («Infinix Gt 20 Pro (INCELL)P-0207») y esa columna se descartaba en silencio: 83 de 83
                  fichas se guardaban sin código, que es con el que él busca sus productos. */}
              {(codigosRecuperados > 0 || columnasRepetidas.length > 0) && (
                <Alert className="border-primary/30 bg-primary/5" data-csv-aviso="codigos" data-csv-codigos-recuperados={codigosRecuperados}>
                  <FileSpreadsheet className="size-4" />
                  <AlertTitle className="text-xs">Cómo leí los nombres y los códigos del archivo</AlertTitle>
                  <AlertDescription className="text-xs">
                    {columnasRepetidas.length > 0 && (
                      <>Descarté la columna {columnasRepetidas.map(c => `«${c}»`).join(', ')} porque repetía un dato que ya traía
                        la primera columna que sirve como nombre. </>
                    )}
                    {codigosRecuperados > 0 && (
                      <>De la columna del nombre saqué <strong>{n(codigosRecuperados)} código(s) pegados</strong> (como
                        «P-0207»){columnasRepetidas.length > 0 ? ' —estaban ahí, en esa columna que se descartaba—' : ''}: cada uno
                        está en el campo «Código» de su fila, que es con el que buscás tus productos.</>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {preview.issues.length > 0 && (
                <Alert className="border-warning/40 bg-warning/10">
                  <AlertTriangle className="size-4 text-warning" />
                  <AlertTitle className="text-xs">Ojo con el archivo</AlertTitle>
                  <AlertDescription className="text-xs">{preview.issues.join(' · ')}</AlertDescription>
                </Alert>
              )}

              {/* La trampa del stock que SUMA: si el archivo trae el stock de fichas que ya existen
                  (el caso típico es exportar el catálogo y volver a cargarlo sin tocar nada), esas
                  unidades se SUMAN a las que ya hay. Se dice con el número, no se esconde.
                  F86: en modo «reemplazar» este aviso es MENTIRA (el archivo pisa, no suma), así que
                  sólo sale cuando el modo activo suma de verdad. */}
              {modo === 'sumar' && sumaAExistentes > 0 && (
                <Alert className="border-warning/40 bg-warning/10" data-csv-warn="stock-suma">
                  <AlertTriangle className="size-4 text-warning" />
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
                  <span className="text-[11px] text-muted-foreground">
                    Se crean <strong>sólo</strong> las que dejes tildadas; las demás filas quedan sin categoría.
                  </span>
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

              <Separator />

              {/* ── LA LISTA: filtros y filas ─────────────────────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="csv-proveedor" className="text-xs font-medium">Proveedor de la carga</label>
                  <Input id="csv-proveedor" className="h-8 w-56" value={proveedor} onChange={e => setProveedor(e.target.value)}
                    placeholder="Ej. Cell World (se anota en las fichas)" data-field="csv-proveedor"
                    title="A quién le compraste esta mercancía: se anota en cada ficha que carga" />
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
                  <Input className="h-8 w-56 pl-7" value={q} onChange={e => setQ(e.target.value)}
                    aria-label="Buscar en el archivo" data-csv-buscar
                    placeholder="Buscar en el archivo…" title="Busca por nombre, categoría, marca, modelo o código" />
                </div>
                {/* F87: con 83 filas y 20 avisos, «mostrame las que tienen algo que leer» es la pregunta
                    más útil del mostrador y antes había que recorrer la lista entera a ojo. */}
                {avisadas > 0 && (
                  <Button variant={soloAvisos ? 'default' : 'outline'} size="sm" className="h-8 text-xs"
                    data-csv-filtro="avisos" data-csv-filtro-activo={soloAvisos ? 'si' : undefined}
                    aria-pressed={soloAvisos}
                    title="Ver sólo las filas que traen un aviso (compatibilidad que no incluye su modelo, nombre o código repetido…)"
                    onClick={() => setSoloAvisos(v => !v)}>
                    <AlertTriangle data-icon="inline-start" />
                    {soloAvisos ? `Ver todas las filas` : `Sólo las ${n(avisadas)} con aviso`}
                  </Button>
                )}
                {bloqueadas.length > 0 && (
                  <Button variant="outline" size="sm" className="h-8 text-xs" data-csv-action="quitar-bloqueadas"
                    title="Saca del archivo (no se cargan) todas las filas marcadas en rojo"
                    onClick={() => setRows(rs => rs.map(r => (r.issues.length > 0 ? { ...r, excluded: true } : r)))}>
                    <X className="size-3" /> Quitar las {n(bloqueadas.length)} filas con problemas
                  </Button>
                )}
                {porClash.length > 0 && (
                  <span className="text-[11px] text-warning">
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
                  <CsvRevisionTable rows={listaNuevos} esNuevo modo={modo} stockTitulo={MODOS.find(m => m.id === modo)!.title}
                    quedaDe={quedaDe} onStock={editarStock}
                    columns={preview.columns} categories={categories} angosta={angosta} pagina={pagina}
                    onPagina={setPagina} onSetRow={setRow} onRevisarAMano={abrirAMano} vacio={vacioDe(true)} />
                </TabsContent>
                <TabsContent value="existen" className="flex flex-col gap-3 pt-3">
                  <p className="text-[11px] text-muted-foreground">
                    Estos ya están en el catálogo. La app muestra <span className="font-medium text-foreground">lo que hay hoy</span> debajo
                    de cada dato y podés <span className="font-medium text-foreground">actualizar</span> (
                    {modo === 'sumar' ? 'el stock se suma al que hay' : 'el stock queda con el número del archivo'}),
                    <span className="font-medium text-foreground"> dejarlo como está</span>, revisarlo a mano o eliminarlo. Con
                    «Ver ficha» se despliegan la marca, el modelo, la variante y la compatibilidad del archivo.
                  </p>
                  <CsvRevisionTable rows={listaExisten} esNuevo={false} modo={modo} stockTitulo={MODOS.find(m => m.id === modo)!.title}
                    quedaDe={quedaDe} onStock={editarStock}
                    columns={preview.columns} categories={categories} angosta={angosta} pagina={pagina}
                    onPagina={setPagina} onSetRow={setRow} onRevisarAMano={abrirAMano} vacio={vacioDe(false)} />
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
                  {/* F86 (REQ-3): el informe dice CON QUÉ MODO se cargó y cuántas fichas venían en
                      negativo (que la carga dejó en 0 en vez de arrastrarlas), no sólo cuántas subieron. */}
                  <span data-csv-modo-report={report.mode ?? modo}>
                    Se cargó en modo <strong>{((report.mode ?? modo) === 'reemplazar')
                      ? '«Reemplazar» (el archivo era el inventario real)' : '«Sumar» (compra: se sumó a lo que había)'}</strong>.
                  </span>
                  <span><strong>{n(report.created)}</strong> productos creados.</span>
                  <span>
                    <strong>{n(report.updated)}</strong> fichas actualizadas
                    {report.units_added !== 0
                      ? ` (el inventario ${report.units_added > 0 ? 'subió' : 'bajó'} ${n(Math.abs(report.units_added))} unidades)`
                      : ''}.
                  </span>
                  {report.kept > 0 && <span><strong>{n(report.kept)}</strong> quedaron como estaban.</span>}
                  {report.deleted > 0 && <span><strong>{n(report.deleted)}</strong> productos eliminados.</span>}
                  {(report.clamped_to_zero ?? 0) > 0 && (
                    <span className="text-warning" data-csv-clamped={report.clamped_to_zero}>
                      <strong>{n(report.clamped_to_zero!)}</strong> ficha(s) venían en <strong>negativo</strong> y quedaron en <strong>0</strong>:
                      la carga no arrastra un stock negativo.
                    </span>
                  )}
                  {/* F86: si el archivo no traía una columna de stock reconocida, el informe tiene que
                      decirlo — es la respuesta al «no me cargó el stock en masa». */}
                  {report.sin_columna_stock === true && (
                    <span className="text-warning" data-csv-aviso="reporte-sin-stock">
                      El archivo <strong>no traía una columna de stock reconocida</strong>: se actualizaron los datos
                      y el stock <strong>NO se tocó</strong> (renombrá la columna a <code>stock</code> y volvé a cargar).
                    </span>
                  )}
                  {report.categories_new.length > 0 && (
                    <span><strong>{n(report.categories_new.length)}</strong> categorías nuevas: {report.categories_new.join(', ')}.</span>
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
            /* F86 (REQ-3) — EL BOTÓN DICE TODO LO QUE VA A PASAR, no sólo «crear y actualizar»:
               el dueño apretaba sin saber que el archivo también iba a DEJAR fichas, ELIMINAR otras
               o cambiar el stock en un sentido que no esperaba. El modo va en el texto porque es la
               decisión que más plata mueve. */
            <Button onClick={aplicar} disabled={busy || activas.length === 0 || bloqueadas.length > 0} data-csv-apply
              title={MODOS.find(m => m.id === modo)!.consecuencia}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <PackagePlus data-icon="inline-start" />}
              {modo === 'sumar' ? 'Sumar' : 'Reemplazar con'} el archivo: {n(resumen.crear)} nuevos, {n(resumen.actualizar)} actualizados
              {resumen.dejar > 0 ? `, ${n(resumen.dejar)} sin tocar` : ''}
              {resumen.eliminar > 0 ? `, ${n(resumen.eliminar)} eliminados` : ''}
              {' '}({resumen.unidades >= 0 ? '+' : '−'}{n(Math.abs(resumen.unidades))} u.
              {resumen.enCero > 0 ? `, ${n(resumen.enCero)} en negativo → 0` : ''})
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
