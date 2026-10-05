import { useState, type ReactNode } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet, Link2, Plus, Search, Trash2, Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CompatModelPicker } from '@/components/CompatModelPicker';
import type { Category, CsvColumns, CsvRow } from '@/types';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// F87 — LA REVISIÓN DEL ARCHIVO, EN COLUMNAS QUE SE LEEN DE FRENTE.
//
// Pedido del dueño (2026-10-04): «mejorame diseño de la carga CSV masiva, el modal sea más intuitivo
// para que sea más responsive y organizada».
//
// Lo que se MIDIÓ con su archivo real (83 filas): la tabla de este paso tenía 18 columnas y medía
// 2.371 px dentro de una caja de 1.213 px, así que «Avisos» y «Qué hacer» —justo lo que hay que
// leer— quedaban FUERA de la pantalla y había que arrastrar la barra horizontal. El dueño ya había
// pedido eso mismo para el inventario («no quiero tener que scrollear a los lados») y `ProductsTab`
// lo resolvió con `table-fixed` + `colgroup` + truncado con `title`: ese es el criterio que se reusa
// acá, no una invención nueva.
//
// Una fila = UNA DECISIÓN (y no una planilla de 18 columnas):
//   1. Cargar (con el número de línea del archivo, que es como el dueño lo busca en su Excel).
//   2. PRODUCTO: el nombre, su código —la llave con la que el dueño busca sus productos (F87)—, la
//      marca · modelo · variante en un renglón y, PEGADOS AL NOMBRE, los avisos de la fila. Antes los
//      avisos eran la última de 18 columnas: el problema estaba fuera de la pantalla.
//   3. Lo que se decide: categoría, costo, venta, efectivo, stock («hoy → queda») y qué hacer.
//   4. «Ver ficha»: el detalle secundario (marca, modelo, variante, compatibilidad, mínimo, «lo uso»
//      y proveedor) se despliega POR FILA — el mismo patrón con el que `ProductsByModel` muestra los
//      repuestos dentro de la fila del teléfono. Son datos que se corrigen de vez en cuando; tenerlos
//      como columnas era lo que empujaba la tabla fuera de la pantalla.
//
// Angosta (ventana por debajo de 1100 px): la MISMA tabla se APILA (una ficha por fila), cada celda
// dice su rótulo y el ancho es el de la caja. Se decide en JS y NO con dos marcados a la vez: las
// verificaciones en vivo buscan los controles DENTRO de su fila (`closest('[data-csv-row]')`) y con
// dos juegos contarían el doble (la misma razón por la que existe `src/lib/use-media.ts`).
//
// Este archivo es SÓLO la fila y su detalle: la pantalla (los tres pasos, el modo del stock, el
// resumen, el aplicar) vive en `LoadCsvDialog.tsx`. La REGLA DEL STOCK también vive allá —la pantalla
// es la dueña del número que se va a escribir— y acá se recibe ya calculada (`quedaDe`) o se avisa lo
// que el operario escribió (`onStock`): así lo que se muestra y lo que se guarda no pueden separarse
// (es el defecto que el dueño reportó como «me carga el producto −30»).
//
// Los `data-*` y los `aria-label` que usan las verificaciones en vivo NO se renombran (F87/REQ-9): el
// gancho viaja con el dato aunque el dato cambie de sitio.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Qué hace la carga con el stock (F86/REQ-3). Acá va SÓLO el tipo: los textos de cada modo —que son
 * texto para el mostrador— viven en la pantalla, que es la que los ofrece.
 */
export type ModoCarga = 'sumar' | 'reemplazar';

/**
 * Los números de la pantalla, con el separador de miles de acá. Se repite en el archivo de la pantalla
 * a propósito (y en ningún otro lado): es una línea de formato, no una regla del negocio, y el linter
 * del proyecto no deja exportar helpers desde un archivo de componentes.
 */
const n = (v: number) => v.toLocaleString('es-VE');

/** Filas por tanda: 83 filas entran de una sola vez; 1.000 no. */
const PAGINA = 100;

/** Lo que hace cada acción, dicho para el mostrador. */
const ACCIONES: { id: 'actualizar' | 'dejar' | 'eliminar'; label: string; title: string }[] = [
  { id: 'actualizar', label: 'Actualizar con el archivo', title: 'Se escriben los datos del archivo y el stock sigue el modo de arriba' },
  { id: 'dejar', label: 'Dejar como está', title: 'No se toca nada de esta ficha' },
  { id: 'eliminar', label: 'Eliminar el producto', title: 'Se borra la ficha (no se puede si está en uso)' },
];

/** Los campos editables de una fila (los MISMOS del formulario de producto). */
type CampoEditable =
  | 'name' | 'brand' | 'model' | 'variant' | 'compatibility' | 'supplier' | 'code' | 'in_use'
  | 'price_cost' | 'price_sale' | 'price_usd' | 'stock' | 'min_stock';

/** Los campos del detalle que se despliegan por fila (todo lo que NO se decide en cada carga). */
const CAMPOS_DETALLE: CampoEditable[] = ['brand', 'model', 'variant', 'compatibility', 'supplier', 'min_stock', 'in_use'];

/** El nombre del campo en pantalla NO es el del mapa de columnas del backend (`cost`/`sale`/`cash`). */
const COLUMNA_DE: Record<CampoEditable, keyof CsvColumns> = {
  name: 'name', brand: 'brand', model: 'model', variant: 'variant', compatibility: 'compatibility',
  supplier: 'supplier', code: 'code', in_use: 'in_use', stock: 'stock', min_stock: 'min_stock',
  price_cost: 'cost', price_sale: 'sale', price_usd: 'cash',
};

/**
 * ¿La columna de este campo venía en el archivo? Si no, el campo NO se toca al aplicar (y por eso la
 * celda se muestra pero no se deja editar: editar algo que se va a descartar sería una mentira).
 */
const columnaDel = (columns: CsvColumns | undefined, campo: CampoEditable): boolean =>
  columns ? columns[COLUMNA_DE[campo]] !== false : true;

/** El valor de HOY de un campo, como se compara en el diff (la compatibilidad se lee como la lee una
 *  persona: el JSON crudo marcaba TODAS las filas como «cambió»). */
const valorDeHoy = (row: CsvRow, campo: CampoEditable): string | number | null => {
  if (!row.current) return null;
  return campo === 'compatibility' ? (row.current.compatibility_text ?? '') : (row.current[campo] as string | number);
};

const NUMEROS: CampoEditable[] = ['price_cost', 'price_sale', 'price_usd', 'stock', 'min_stock'];

/** ¿Este campo CAMBIA contra la ficha de hoy? Es lo que pinta la celda y lo que cuenta el detalle. */
const cambioEn = (row: CsvRow, campo: CampoEditable, columns: CsvColumns | undefined): boolean => {
  if (!row.current || !columnaDel(columns, campo)) return false;
  const valor = row[campo];
  const actual = valorDeHoy(row, campo);
  return NUMEROS.includes(campo)
    ? (valor != null && actual != null && Number(valor) !== Number(actual))
    : (valor != null && String(valor).trim() !== '' && String(valor) !== String(actual ?? ''));
};

/**
 * El reparto del ancho, en porcentajes que suman 100 (uno por columna, en el MISMO orden en que se
 * pintan). Con `table-fixed` la tabla NUNCA se sale de su caja: si falta sitio las columnas se
 * aprietan y el texto se corta con `truncate` + `title`.
 *
 * Las 18 columnas de antes no caben de ninguna manera legible en 1.100 px, así que el detalle
 * secundario se fue al desplegable por fila y quedaron NUEVE columnas: las que se leen y se deciden de
 * frente, con los avisos pegados al nombre. Medido a 1200 px de ventana la caja de la tabla son
 * ~1.085 px y la tabla mide exactamente eso (antes: 2.371 px adentro de 1.213 px).
 *
 * El reparto a mano (en 1.085 px): Producto 271 px · Categoría 108 · Costo/Venta/Efectivo 70/70/76 ·
 * Stock 141 · Qué hacer 184 · Ficha 119. El nombre (271 px) y «Qué hacer» (184 px) son los dos que más
 * necesitan, porque el nombre es lo que se busca y la acción es lo que se decide.
 */
const ANCHOS = ['4%', '25%', '10%', '6.5%', '6.5%', '7%', '13%', '17%', '11%'];
const COLS = ANCHOS.length;

/**
 * Una celda de la revisión. `overflow-hidden` es la pieza que impide que un dato largo ensanche la
 * tabla (sin él, un nombre sin espacios empujaba y volvía la barra horizontal): la misma regla de
 * `ProductsTab`.
 */
const CELDA = 'overflow-hidden px-1.5 py-2 align-top';
/** La misma celda cuando la tabla está APILADA: rótulo arriba, dato abajo, todo el ancho. */
const CELDA_APILADA = 'flex flex-col gap-1 px-0 py-0.5';

/** El rótulo de una celda apilada (en la tabla ancha el rótulo es el encabezado). */
function Rotulo({ children }: { children: ReactNode }) {
  return <span className="text-[11px] text-muted-foreground">{children}</span>;
}

/**
 * El dato editable de una fila. Muestra el valor de HOY debajo cuando cambia (el diff) y avisa cuando
 * la columna no venía en el archivo (queda de sólo lectura).
 */
function Campo({ row, campo, tipo = 'text', columns, onSetRow, onStock, className, contenedor, titulo }: {
  row: CsvRow;
  campo: CampoEditable;
  tipo?: 'text' | 'number';
  columns: CsvColumns | undefined;
  onSetRow: (line: number, patch: Partial<CsvRow>) => void;
  /** el STOCK no se escribe acá: se avisa y la pantalla lo recalcula con la regla del backend */
  onStock: (row: CsvRow, valor: number | null) => void;
  /** clases del input (ancho, tipografía) */
  className?: string;
  /** clases del contenedor (es lo que reparte el ancho dentro de la celda) */
  contenedor?: string;
  /** reemplaza el `title` por defecto (que explica la columna o el valor de hoy) */
  titulo?: string;
}) {
  const valor = row[campo];
  const actual = valorDeHoy(row, campo);
  const esNumero = tipo === 'number';
  const habilitada = columnaDel(columns, campo);
  const cambio = cambioEn(row, campo, columns);
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', contenedor)}>
      <Input
        className={cn('h-8 min-w-0 px-1.5 text-[11px]', className,
          cambio && 'border-primary/60 bg-primary/5',
          !habilitada && 'bg-muted/40 text-muted-foreground')}
        inputMode={esNumero ? 'decimal' : undefined}
        data-field={`csv-${campo}`}
        data-csv-readonly={habilitada ? undefined : 'si'}
        readOnly={!habilitada}
        value={valor == null ? '' : String(valor)}
        placeholder={actual != null && String(actual) !== '' ? String(actual) : '—'}
        title={titulo ?? (!habilitada
          ? 'Esta columna no venía en el archivo: este dato no se toca'
          : (actual != null ? `Hoy: ${String(actual)}` : 'No existe todavía'))}
        onChange={e => {
          const raw = e.target.value;
          if (!esNumero) { onSetRow(row.line, { [campo]: raw } as Partial<CsvRow>); return; }
          // Vacío = ese número no se toca (es la regla del archivo); lo ilegible también queda sin valor.
          const bruto = raw.trim() === '' ? NaN : Number(raw.replace(',', '.'));
          const numero = Number.isFinite(bruto) ? bruto : null;
          // El STOCK se va a la pantalla, que es la dueña de la regla (nunca por debajo de 0 y con el
          // modo aplicado): acá sólo se dice QUÉ número se escribió. Así el «hoy → queda» de la fila y
          // las unidades del resumen no pueden separarse del número que se va a guardar.
          if (campo === 'stock') { onStock(row, numero); return; }
          onSetRow(row.line, { [campo]: numero } as Partial<CsvRow>);
        }}
      />
      {cambio && actual != null && String(actual) !== '' && (
        // El diff de la ficha que ya existe: el dato del archivo arriba, el de hoy abajo.
        <span className="truncate text-[10px] text-muted-foreground" title={`Hoy la ficha tiene «${String(actual)}»`}>hoy {String(actual)}</span>
      )}
    </div>
  );
}

/** Un dato del detalle por fila (rótulo + control). */
function Dato({ etiqueta, children, ayuda, className }: {
  etiqueta: string;
  children: ReactNode;
  ayuda?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[10px] font-medium text-muted-foreground" title={ayuda}>{etiqueta}</span>
      {children}
    </div>
  );
}

/**
 * F87 (REQ-2/AC-5) — LOS AVISOS DE LA FILA, PEGADOS AL NOMBRE.
 *
 * Es el dato que el dueño tiene que leer antes de apretar el botón y era el que quedaba fuera de la
 * pantalla (última columna de una tabla de 2.371 px): ahora vive en la segunda columna, en la parte
 * visible de la fila. Rojo = bloquea la carga; ámbar = informa.
 */
function Avisos({ row }: { row: CsvRow }) {
  if (row.issues.length === 0 && row.notes.length === 0 && row.aviso_compat !== true && row.shared === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-start gap-1">
      {row.issues.map((i, k) => (
        <Badge key={`i${k}`} variant="destructive"
          className="max-w-full items-start gap-1 whitespace-normal text-left text-[10px] font-medium" title={i}>
          <AlertTriangle className="size-3 shrink-0" /> <span>{i}</span>
        </Badge>
      ))}
      {/* F86 (REQ-5/AC-8) — la lista de compatibilidad del archivo no nombra al modelo de la ficha:
          una pantalla que dice servir a un teléfono cuya lista no lo incluye. No bloquea (el archivo
          manda), pero se ve: es un dato incoherente que después ensucia el padrón de Modelos. El dato
          lo calcula el backend (`aviso_compat`) con la misma regla de la compatibilidad. */}
      {row.aviso_compat === true && (
        <Badge variant="outline" data-aviso-compat="1"
          className="max-w-full items-start gap-1 whitespace-normal border-warning/50 text-left text-[10px] font-medium text-warning"
          title={`El modelo de la ficha es «${row.model}» y la compatibilidad del archivo («${row.compatibility}») no lo nombra: revisá cuál de los dos está mal antes de cargar.`}>
          <AlertTriangle className="size-3 shrink-0" /> <span>la compatibilidad no incluye su modelo</span>
        </Badge>
      )}
      {row.notes.map((i, k) => (
        <Badge key={`n${k}`} variant="outline"
          className="max-w-full items-start gap-1 whitespace-normal border-warning/40 text-left text-[10px] font-normal text-warning" title={i}>
          <AlertTriangle className="size-3 shrink-0" /> <span>{i}</span>
        </Badge>
      ))}
      {row.shared > 0 && (
        <span className="text-[10px] text-muted-foreground"
          title="Otra fila del mismo archivo es la misma ficha: el stock de las dos se junta en una sola ficha">
          Otra fila del archivo es la misma ficha
        </span>
      )}
    </div>
  );
}

/**
 * F88 — LA COMPATIBILIDAD DE LA FILA, A LA VISTA: los TELÉFONOS donde entra esta pantalla.
 *
 * Pedido del dueño (2026-10-05): «la compatibilidad así es necesaria para cada modelo tiene que
 * aparecer». Y tiene razón: es el dato que decide si la pantalla queda asociada a sus teléfonos en el
 * padrón de Modelos (de ahí sale «este repuesto sirve para estos modelos»). Antes esta lista vivía
 * SOLO dentro de «Ver ficha» —o sea, había que desplegar 83 filas para ver qué se estaba cargando—.
 *
 * Qué se muestra y por qué así:
 *  - la LISTA (los teléfonos separados por «/»), en un renglón que se corta con `truncate` y lleva la
 *    lista COMPLETA en el `title` (el mismo criterio que el nombre y la identidad de la fila: el ancho
 *    de la columna no se negocia, que es lo que sostiene el «sin scroll lateral» de F87);
 *  - cuántos son (chip con el número): en un vistazo se sabe si la pantalla sirve a 1 teléfono o a 8;
 *  - «del modelo» cuando el archivo NO traía compatibilidad y la lista la armó su PROPIO MODELO
 *    (`compat_del_modelo`, REQ-1/F86): ahí el dueño ve exactamente qué se va a guardar y por qué;
 *  - si no queda ninguno, se dice en ámbar y con el motivo: esa ficha NO entra al padrón de Modelos
 *    (es lo que el dueño reportó en F86 como «no debería ir stock modelo de tlf» / «no aparece»).
 *
 * La lista la calcula el BACKEND (`compatibility_final`, con la misma `finales()` que aplica la carga),
 * no la pantalla: una sola implementación de la regla, y lo que se ve es lo que se guarda. Si el campo
 * no viene (backend viejo), cae al texto del archivo — defensivo, como el resto de los ganchos.
 */
function Compatibilidad({ row }: { row: CsvRow }) {
  const lista = String(row.compatibility_final ?? row.compatibility ?? '').trim();
  const telefonos = lista === '' ? [] : lista.split(/\s*\/\s*/).map(t => t.trim()).filter(Boolean);
  const vacia = telefonos.length === 0;
  return (
    <div className="flex min-w-0 items-center gap-1" data-csv-compat={lista} data-csv-compat-telefonos={telefonos.length}>
      <Link2 className={cn('size-3 shrink-0', vacia ? 'text-warning' : 'text-muted-foreground')} />
      <span
        className={cn('min-w-0 flex-1 truncate text-[10px]', vacia ? 'text-warning' : 'text-foreground/80')}
        title={vacia
          ? 'Esta ficha no queda asociada a ningún teléfono: no la vas a encontrar en Modelos. Escribile el modelo (o la lista) en «Ver ficha».'
          : `Va a quedar asociada a ${telefonos.length} teléfono(s): ${telefonos.join(' · ')}`}
      >
        {vacia ? 'sin compatibilidad: no entra al padrón de Modelos' : lista}
      </span>
      {!vacia && (
        <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-medium tabular-nums text-muted-foreground"
          data-csv-compat-conteo={telefonos.length}
          title={`${telefonos.length} teléfono(s) donde entra esta pantalla`}>
          {telefonos.length}
        </span>
      )}
      {row.compat_del_modelo === true && (
        <span className="shrink-0 rounded border border-primary/40 px-1 text-[9px] font-medium text-primary"
          data-csv-compat-del-modelo="1"
          title="El archivo no traía compatibilidad para esta fila: la lista se armó con su MODELO (si el modelo es «A30 / A50», son dos teléfonos). Si le sirve a más, agregalos en «Ver ficha».">
          del modelo
        </span>
      )}
    </div>
  );
}

/** Una fila de la revisión: el producto (con sus avisos), lo que se decide y el detalle desplegable. */
function FilaCsv({ row, esNuevo, modo, quedaDe, onStock, columns, categories, angosta, abierta, onToggleDetalle, onSetRow, onRevisarAMano }: {
  row: CsvRow;
  esNuevo: boolean;
  modo: ModoCarga;
  /** con cuánto QUEDA la ficha (lo calcula la pantalla con la regla del backend, F86) */
  quedaDe: (row: CsvRow) => number;
  onStock: (row: CsvRow, valor: number | null) => void;
  columns: CsvColumns | undefined;
  categories: Category[];
  angosta: boolean;
  abierta: boolean;
  onToggleDetalle: (line: number) => void;
  onSetRow: (line: number, patch: Partial<CsvRow>) => void;
  onRevisarAMano: (row: CsvRow) => void;
}) {
  const queda = quedaDe(row);
  const bloquea = row.issues.length > 0;
  const identidad = [row.brand, row.model, row.variant].map(v => String(v ?? '').trim()).filter(Boolean).join(' · ');
  /** Cuántos datos del detalle cambian contra la ficha de hoy: se dice en el botón, así el dueño sabe
   *  si hay algo que mirar sin abrir todas las filas una por una. */
  const cambiosDetalle = CAMPOS_DETALLE.filter(c => cambioEn(row, c, columns)).length;
  const habilitadoUso = columnaDel(columns, 'in_use');

  /** La categoría de la fila: existente, nueva (se crea al aplicar) o sin categoría. */
  const valorCategoria = row.category_id != null ? String(row.category_id) : (row.category_new ? `nueva:${row.category}` : 'nueva');

  return (
    <>
      <TableRow
        data-csv-row={row.line}
        className={cn(angosta ? 'grid grid-cols-1 gap-2 px-3 py-3' : 'align-top',
          row.excluded && 'opacity-50',
          !row.excluded && bloquea && 'bg-destructive/5',
          abierta && !angosta && 'bg-accent/30')}
      >
        {/* ── Cargar (y la línea del archivo: es como el dueño la busca en su Excel) ───────────── */}
        <TableCell className={cn(CELDA, 'px-1', angosta && 'flex flex-row items-center justify-between gap-3 px-0 py-0.5')}>
          {angosta && <Rotulo>Cargar esta fila</Rotulo>}
          <span className="flex flex-col items-center gap-0.5">
            <input type="checkbox" className="size-3.5" aria-label={`Cargar la línea ${row.line}`}
              data-field="csv-cargar" checked={!row.excluded}
              onChange={e => onSetRow(row.line, { excluded: !e.target.checked })} />
            <span className="text-[10px] text-muted-foreground tabular-nums" title={`Fila ${row.line} del archivo`}>{row.line}</span>
          </span>
        </TableCell>

        {/* ── Producto: nombre · código · marca/modelo/variante · LOS AVISOS ───────────────────── */}
        <TableCell className={cn(CELDA, 'px-2', angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Producto</Rotulo>}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-start gap-1.5">
              <Campo row={row} campo="name" columns={columns} onSetRow={onSetRow} onStock={onStock}
                contenedor="min-w-0 flex-1" className="font-medium"
                titulo={row.current && String(row.current.name) !== row.name
                  ? `En el archivo: «${row.name}» · Hoy la ficha se llama «${row.current.name}»`
                  : row.name} />
              {/* F87 (REQ-6) — el CÓDIGO es la llave con la que el dueño busca sus productos. Cuando el
                  archivo lo trae pegado al nombre (`… (INCELL)P-0207`), el backend lo rescata y lo pone
                  acá: sin esto, las 83 filas se guardaban sin código. */}
              <Campo row={row} campo="code" columns={columns} onSetRow={onSetRow} onStock={onStock}
                contenedor="w-[4.75rem] shrink-0" className="font-mono"
                titulo={row.code
                  ? `Código de la ficha: ${row.code} (es con el que la buscás)`
                  : 'El archivo no traía código para esta fila: podés escribirlo acá'} />
            </div>
            <span className="truncate text-[10px] text-muted-foreground" title={identidad || 'El archivo no trae marca, modelo ni variante'}>
              {identidad || 'sin marca, modelo ni variante'}
            </span>
            <Compatibilidad row={row} />
            <Avisos row={row} />
          </div>
        </TableCell>

        {/* ── Categoría ────────────────────────────────────────────────────────────────────────── */}
        <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Categoría</Rotulo>}
          <Select
            value={valorCategoria}
            onValueChange={v => {
              if (v === 'nueva') { onSetRow(row.line, { category: '', category_new: true, category_id: null }); return; }
              if (v.startsWith('nueva:')) return; // la que el propio archivo propone: se queda como está
              const cid = Number(v);
              const cat = categories.find(c => c.id === cid);
              onSetRow(row.line, { category_id: cid, category: cat?.name ?? row.category, category_new: false });
            }}
          >
            <SelectTrigger className="h-8 w-full px-2 text-[11px]" aria-label={`Categoría de ${row.name}`} data-field="csv-categoria">
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
        </TableCell>

        {/* ── Precios: los tres números que mueven plata ───────────────────────────────────────── */}
        <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Costo</Rotulo>}
          <Campo row={row} campo="price_cost" tipo="number" columns={columns} onSetRow={onSetRow} onStock={onStock} />
        </TableCell>
        <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Venta</Rotulo>}
          <Campo row={row} campo="price_sale" tipo="number" columns={columns} onSetRow={onSetRow} onStock={onStock} />
        </TableCell>
        <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Efectivo</Rotulo>}
          <Campo row={row} campo="price_usd" tipo="number" columns={columns} onSetRow={onSetRow} onStock={onStock} />
        </TableCell>

        {/* ── Stock: lo que trae el archivo y con cuánto QUEDA la ficha ────────────────────────── */}
        <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Stock {modo === 'sumar' ? '(se suma)' : '(el del archivo)'}</Rotulo>}
          <div className="flex min-w-0 flex-col gap-0.5">
            <Campo row={row} campo="stock" tipo="number" columns={columns} onSetRow={onSetRow} onStock={onStock} />
            {row.action !== 'eliminar' && row.action !== 'dejar' && (
              /* F86 (REQ-2/AC-4) — el «queda» es el número del BACKEND (`stock_final`): es el que se va a
                 escribir. Antes lo calculaba la pantalla y su `clamp(0)` escondía el negativo que la
                 carga sí escribía. `data-stock-final` deja medirlo en vivo. */
              <span className="truncate text-[10px] font-medium text-foreground tabular-nums"
                data-field="csv-stock-despues" data-stock-final={queda}
                title={modo === 'reemplazar'
                  ? 'El archivo es el inventario real: la ficha queda con este número'
                  : 'Hoy + lo que trae el archivo'}>
                {n(row.current?.stock ?? 0)} → {n(queda)}
              </span>
            )}
          </div>
        </TableCell>

        {/* ── Qué hacer con la ficha (la decisión) ─────────────────────────────────────────────── */}
        <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Qué hacer con esta ficha</Rotulo>}
          <div className="flex min-w-0 flex-col gap-1">
            {esNuevo ? (
              <Badge variant="outline" className="w-fit border-primary/40 text-[10px] font-medium text-primary"
                title="No está en el catálogo: la carga la crea con los datos de la fila y su stock">
                Se crea
              </Badge>
            ) : (
              <Select value={row.action} onValueChange={v => onSetRow(row.line, { action: v as CsvRow['action'] })}
                disabled={row.action === 'crear'}>
                <SelectTrigger className="h-8 w-full px-2 text-[11px]" aria-label={`Qué hacer con ${row.name}`} data-field="csv-accion">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCIONES.map(a => (
                    <SelectItem key={a.id} value={a.id} title={a.title}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {row.action === 'crear' && (row.name_clash || row.code_clash) && (
              <>
                <label className="flex cursor-pointer items-start gap-1 text-[10px] leading-tight">
                  <input type="checkbox" className="mt-0.5 size-3.5" checked={row.create_anyway}
                    data-field="csv-crear-igual"
                    onChange={e => onSetRow(row.line, { create_anyway: e.target.checked })} />
                  <span>Crear igual (otra variante)</span>
                </label>
                {row.clash_product_id != null && (
                  <Button type="button" variant="outline" size="sm" className="h-6 w-fit px-1.5 text-[10px]"
                    data-csv-action="actualizar-clash"
                    title="Esa ficha ya existe: actualizarla con los datos de esta fila"
                    onClick={() => onSetRow(row.line, { action: 'actualizar', product_id: row.clash_product_id })}>
                    <Wand2 data-icon="inline-start" /> Actualizar esa ficha
                  </Button>
                )}
              </>
            )}
            {/* Las dos acciones van en ICONO (con texto no entran en la columna sin volver a empujar el
                ancho): cada una dice lo que hace en su `title` y en su `aria-label`. */}
            <div className="flex flex-wrap items-center gap-1">
              {!esNuevo && (
                <Button type="button" variant="ghost" size="sm" className="size-7 p-0"
                  data-csv-action="revisar-mano" aria-label={`Revisar a mano la ficha de ${row.name}`}
                  title="Abrir la ficha del producto para corregirla a mano"
                  onClick={() => onRevisarAMano(row)}>
                  <Search />
                </Button>
              )}
              {/* «Quitar» = sacar esta fila del archivo (no se carga nada de ella). Es distinto de
                  «Eliminar el producto», que borra la ficha del catálogo. */}
              <Button type="button" variant="ghost" size="sm"
                className={cn('size-7 p-0', !row.excluded && 'text-muted-foreground hover:text-danger')}
                data-csv-action={row.excluded ? 'reponer' : 'quitar'}
                aria-label={row.excluded ? `Volver a poner la línea ${row.line}` : `Quitar la línea ${row.line} del archivo`}
                title={row.excluded ? 'Volver a poner esta fila: se carga como las demás' : 'Quitar esta fila del archivo: no se carga nada de ella'}
                onClick={() => onSetRow(row.line, { excluded: !row.excluded })}>
                {row.excluded ? <Plus /> : <Trash2 />}
              </Button>
            </div>
          </div>
        </TableCell>

        {/* ── El detalle, por fila (como ProductsByModel con los repuestos) ────────────────────── */}
        <TableCell className={cn(CELDA, angosta && CELDA_APILADA)}>
          {angosta && <Rotulo>Ficha completa</Rotulo>}
          <Button type="button" variant="outline" size="sm" className="h-8 w-full justify-start px-2 text-[11px]"
            data-csv-action="detalle" data-csv-ficha-abierta={abierta ? 'si' : undefined}
            aria-expanded={abierta} title="Marca, modelo, variante, compatibilidad, mínimo, «lo uso» y proveedor"
            onClick={() => onToggleDetalle(row.line)}>
            {abierta ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
            <span className="truncate">
              {abierta ? 'Ocultar' : 'Ver ficha'}{!abierta && cambiosDetalle > 0 ? ` (${n(cambiosDetalle)})` : ''}
            </span>
          </Button>
        </TableCell>
      </TableRow>

      {abierta && (
        <TableRow data-csv-detalle-fila={row.line} className={cn('hover:bg-transparent', angosta && 'grid grid-cols-1')}>
          <TableCell colSpan={COLS} className="overflow-hidden border-t bg-muted/20 px-3 py-3">
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium">Ficha completa y compatibilidad</span>
              <p className="text-[10px] text-muted-foreground">
                El nombre, el código, la categoría, los precios y el stock están arriba, en la fila.
                {cambiosDetalle > 0 ? ` Acá hay ${n(cambiosDetalle)} dato(s) que cambian contra la ficha de hoy (se ven debajo de cada uno).` : ''}
              </p>
              <Separator />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Dato etiqueta="Marca">
                  <Campo row={row} campo="brand" columns={columns} onSetRow={onSetRow} onStock={onStock} />
                </Dato>
                <Dato etiqueta="Modelo" ayuda="El teléfono al que le sirve esta pieza (de acá sale la compatibilidad de la ficha)">
                  <Campo row={row} campo="model" columns={columns} onSetRow={onSetRow} onStock={onStock} />
                </Dato>
                <Dato etiqueta="Variante" ayuda="INCELL / OLED / ORIGINAL y sus marcos">
                  <Campo row={row} campo="variant" columns={columns} onSetRow={onSetRow} onStock={onStock} />
                </Dato>
                {/* F91 — acá estaba el campo de TEXTO de la compatibilidad («separados por /»): ahora es el
                    MISMO selector de modelos del formulario de producto (chips con ✕ + buscador del padrón),
                    para que no quede en la app ningún lugar donde la compatibilidad se escriba a mano. Lo que
                    se guarda es idéntico (el archivo manda; esto es para corregirlo antes de cargar). */}
                <Dato etiqueta="Modelos compatibles (los teléfonos donde entra)"
                  ayuda="Cada teléfono que nombra la lista queda ordenado en el padrón de Modelos: se eligen de ahí, con su ✕ para quitarlos"
                  className="sm:col-span-2 lg:col-span-3">
                  <CompatModelPicker compacto value={String(row.compatibility ?? '')}
                    disabled={!columnaDel(columns, 'compatibility')}
                    onChange={texto => onSetRow(row.line, { compatibility: texto })} />
                  {!columnaDel(columns, 'compatibility') && (
                    <span className="text-[10px] text-muted-foreground">
                      Esta columna no venía en el archivo: este dato no se toca.
                    </span>
                  )}
                  {cambioEn(row, 'compatibility', columns) && row.current && (
                    <span className="truncate text-[10px] text-muted-foreground"
                      title={`Hoy la ficha tiene «${String(row.current.compatibility_text ?? '')}»`}>
                      hoy {String(row.current.compatibility_text ?? '')}
                    </span>
                  )}
                </Dato>
                <Dato etiqueta="Stock mínimo" ayuda="Debajo de este número la ficha se marca «bajo mínimo»">
                  <Campo row={row} campo="min_stock" tipo="number" columns={columns} onSetRow={onSetRow} onStock={onStock} />
                </Dato>
                {/* F86 — «LO USO» (columna `en_uso` del archivo). La plantilla la traía y el parser la
                    aceptaba, pero la revisión NO la mostraba: el dato viajaba al guardado sin que el
                    dueño pudiera verlo ni corregirlo. Si la columna no vino, queda de sólo lectura. */}
                <Dato etiqueta="Lo uso" ayuda="Si esta ficha aparece al registrar un servicio">
                  <Select value={row.in_use == null ? 'auto' : String(row.in_use)} disabled={!habilitadoUso}
                    onValueChange={v => onSetRow(row.line, { in_use: v === 'auto' ? null : Number(v) })}>
                    <SelectTrigger className="h-8 w-full px-2 text-[11px]" aria-label={`Lo uso de ${row.name}`} data-field="csv-en-uso"
                      data-csv-readonly={habilitadoUso ? undefined : 'si'}
                      title={habilitadoUso
                        ? 'Si esta ficha aparece al registrar un servicio'
                        : 'Esta columna no venía en el archivo: este dato no se toca'}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">— Normal</SelectItem>
                      <SelectItem value="1">Sí, lo uso</SelectItem>
                      <SelectItem value="0">No lo uso</SelectItem>
                    </SelectContent>
                  </Select>
                </Dato>
                <Dato etiqueta="Proveedor de la ficha" ayuda="A quién le compraste esta mercancía (distinto del proveedor de toda la carga, que va arriba)">
                  <Campo row={row} campo="supplier" columns={columns} onSetRow={onSetRow} onStock={onStock} />
                </Dato>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * La revisión: el encabezado de los grupos, las filas y la paginación.
 *
 * `angosta` lo decide la pantalla (`useVentanaAngosta`): acá sólo se elige CÓMO se pinta la MISMA
 * fila, nunca se pinta dos veces.
 */
export function CsvRevisionTable({ rows, esNuevo, modo, stockTitulo, quedaDe, onStock, columns, categories, angosta, pagina, onPagina, onSetRow, onRevisarAMano, vacio }: {
  /** las filas ya filtradas de la pestaña activa (sin paginar) */
  rows: CsvRow[];
  esNuevo: boolean;
  modo: ModoCarga;
  /** lo que el modo elegido le hace al stock, para el `title` del encabezado (F86: el encabezado dice
   *  QUÉ HACE el stock, no sólo «Stock») */
  stockTitulo: string;
  /** con cuánto QUEDA cada ficha (la regla la tiene la pantalla: acá no se recalcula stock) */
  quedaDe: (row: CsvRow) => number;
  /** el operario escribió un número en la celda del stock de esa fila */
  onStock: (row: CsvRow, valor: number | null) => void;
  columns: CsvColumns | undefined;
  categories: Category[];
  angosta: boolean;
  pagina: number;
  onPagina: (p: number) => void;
  onSetRow: (line: number, patch: Partial<CsvRow>) => void;
  onRevisarAMano: (row: CsvRow) => void;
  /** lo que se dice cuando no hay ninguna fila que mostrar (búsqueda, filtro o archivo) */
  vacio: string;
}) {
  /** Qué filas tienen el detalle desplegado (se pueden mirar varias a la vez). */
  const [abiertas, setAbiertas] = useState<number[]>([]);
  const alternarDetalle = (line: number) =>
    setAbiertas(prev => (prev.includes(line) ? prev.filter(l => l !== line) : [...prev, line]));

  const visibles = rows.slice(pagina * PAGINA, pagina * PAGINA + PAGINA);
  const restantes = rows.length - (pagina + 1) * PAGINA;

  return (
    <div className="flex flex-col gap-3">
      {/* `table-fixed` + el reparto de `colgroup`: la tabla mide EXACTAMENTE lo que mide su caja, así
          que la barra de scroll horizontal no puede aparecer (el criterio de `ProductsTab`). */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table className={cn('text-[12px]', angosta ? 'block' : 'table-fixed')}>
            {!angosta && (
              <colgroup>
                {ANCHOS.map((ancho, i) => <col key={i} style={{ width: ancho }} />)}
              </colgroup>
            )}
            {!angosta && (
              <TableHeader>
                <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 px-1 text-[10px] font-semibold" title="Destildá una fila para NO cargarla: no se toca nada de ella">Cargar</TableHead>
                  <TableHead className="h-9 px-2 text-[10px] font-semibold" title="El nombre y el código de la ficha, con sus avisos debajo">Producto</TableHead>
                  <TableHead className="h-9 px-1.5 text-[10px] font-semibold" title="La categoría de la ficha (o la nueva que trae el archivo)">Categoría</TableHead>
                  <TableHead className="h-9 px-1.5 text-[10px] font-semibold" title="Precio de costo: lo que pagaste por la pieza">Costo</TableHead>
                  <TableHead className="h-9 px-1.5 text-[10px] font-semibold" title="Precio de venta al público">Venta</TableHead>
                  <TableHead className="h-9 px-1.5 text-[10px] font-semibold" title="Precio de contado en efectivo (divisas)">Efectivo</TableHead>
                  {/* F86 (REQ-3) — el encabezado dice QUÉ HACE el stock con el modo elegido: «Stock» a
                      secas no alcanzaba para saber si el número se suma o se pisa. Y debajo del número
                      de cada fila se lee «hoy → queda». */}
                  <TableHead className="h-9 px-1.5 text-[10px] font-semibold" title={stockTitulo}>
                    Stock {modo === 'sumar' ? '(se suma)' : '(el del archivo)'}
                    <span className="block text-[9px] font-normal text-muted-foreground">hoy → queda</span>
                  </TableHead>
                  <TableHead className="h-9 px-1.5 text-[10px] font-semibold" title="Qué va a pasar con esta ficha: actualizar, dejarla como está o eliminarla">Qué hacer</TableHead>
                  <TableHead className="h-9 px-1.5 text-[10px] font-semibold" title="Marca, modelo, variante, compatibilidad, mínimo, «lo uso» y proveedor: se despliegan por fila">Ficha</TableHead>
                </TableRow>
              </TableHeader>
            )}
            <TableBody className={cn(angosta && 'block')}>
              {visibles.map(row => (
                <FilaCsv key={`${row.line}-${row.name}`} row={row} esNuevo={esNuevo} modo={modo} quedaDe={quedaDe}
                  onStock={onStock} columns={columns} categories={categories} angosta={angosta}
                  abierta={abiertas.includes(row.line)} onToggleDetalle={alternarDetalle}
                  onSetRow={onSetRow} onRevisarAMano={onRevisarAMano} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {restantes > 0 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" data-csv-ver-mas onClick={() => onPagina(pagina + 1)}>
            Ver {n(Math.min(PAGINA, restantes))} más ({n(restantes)} restantes)
          </Button>
        </div>
      )}

      {rows.length === 0 && (
        <Empty>
          <EmptyMedia><FileSpreadsheet className="size-5" /></EmptyMedia>
          <EmptyTitle>{vacio}</EmptyTitle>
          <EmptyDescription>
            Podés mirar la otra pestaña, borrar la búsqueda o volver al paso «Archivo».
          </EmptyDescription>
        </Empty>
      )}
    </div>
  );
}
