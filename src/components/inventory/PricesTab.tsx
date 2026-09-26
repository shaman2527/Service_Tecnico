import { useState } from 'react';
import { BadgeDollarSign, Check, FileSpreadsheet, Loader2, PackagePlus, Smartphone, Tags, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { api } from '@/db';
import type { CatalogReport, Category, PhoneSplitPreview, PriceRestoreReport } from '@/types';
import { toast } from 'sonner';
import { LoadInventoryDialog } from './LoadInventoryDialog';
import { LoadCsvDialog } from './LoadCsvDialog';
import { CategoriesCard } from './CategoriesCard';

// AJUSTES del inventario, en lenguaje de tienda (sin tecnicismos):
//   1) Traer los precios de la lista de la tienda.
//   2) Dejar los nombres de marca y modelo parejos.
//   3) Cargar el inventario físico (asistente: pegar la lista → cruce → aplicar).
// Cada acción se REVISA antes de aplicar y todo se respalda solo.

function Fila({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * `onChanged` refresca los datos y salta a la pestaña Productos (precios/nombres).
 * `onRefresh` solo refresca: lo usa el asistente de carga, que tiene que quedarse abierto
 * para mostrar su resumen (antes saltaba de pestaña y el resumen nunca se veía).
 */
export function PricesTab({ categories = [], onChanged, onRefresh, refreshKey = 0 }: {
  /** F78: las categorías del catálogo (la carga CSV las usa para elegir/crear la de cada fila) */
  categories?: Category[];
  onChanged: () => void;
  onRefresh: () => void;
  /** F65: sube cuando el inventario cambió (p. ej. al cargar la lista del local mueve el stock) */
  refreshKey?: number;
}) {
  const [priceCheck, setPriceCheck] = useState<PriceRestoreReport | null>(null);
  const [catalogCheck, setCatalogCheck] = useState<CatalogReport | null>(null);
  /** F53 — «separar los modelos»: vista previa y resultado (es el MISMO informe). */
  const [splitCheck, setSplitCheck] = useState<PhoneSplitPreview | null>(null);
  const [busy, setBusy] = useState<'precios' | 'nombres' | 'modelos' | null>(null);
  const [showLoad, setShowLoad] = useState(false);
  /** F78: el asistente de carga masiva por CSV (el camino principal). */
  const [showCsv, setShowCsv] = useState(false);

  const revisarModelos = async () => {
    setBusy('modelos');
    try {
      setSplitCheck(await api.previewPhoneSplit());
    } catch (e) {
      toast.error(`No se pudo revisar los modelos: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const aplicarModelos = async () => {
    const n = splitCheck?.created.length ?? 0;
    const ok = confirm(
      `Se van a separar los modelos que hoy están pegados en una sola ficha, por ejemplo «Samsung A70 A705» → «Samsung A70» y «Samsung A705» (la pantalla queda compatible con los dos).` +
      `\n\nAparecen ${n} modelos nuevos, numerados y marcados según lo que usás.` +
      `\nNo se toca ningún stock, precio, venta ni orden, y antes se guarda una copia de seguridad.` +
      `\n\n¿Continuar?`);
    if (!ok) return;
    setBusy('modelos');
    try {
      const r = await api.applyPhoneSplit();
      toast.success(`${r.created.length} modelos separados`);
      setSplitCheck({ ...r, dry_run: false });
      onChanged();
    } catch (e) {
      toast.error(`No se pudo separar: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const revisarPrecios = async () => {
    setBusy('precios');
    try {
      setPriceCheck(await api.restorePrices(null, true, true));
    } catch (e) {
      toast.error(`No se pudo leer la lista de precios: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const aplicarPrecios = async () => {
    setBusy('precios');
    try {
      const r = await api.restorePrices(null, true, false);
      toast.success(`Precios cargados en ${r.updated} productos`);
      setPriceCheck(r);
      onChanged();
    } catch (e) {
      toast.error(`No se pudo aplicar: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const revisarNombres = async () => {
    setBusy('nombres');
    try {
      setCatalogCheck(await api.normalizeCatalog(true));
    } catch (e) {
      toast.error(`No se pudo revisar el inventario: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const aplicarNombres = async () => {
    const ok = confirm('Se van a ordenar los nombres de marca y modelo de todo el inventario.\n\nAntes se guarda una copia de seguridad. ¿Continuar?');
    if (!ok) return;
    setBusy('nombres');
    try {
      const r = await api.normalizeCatalog(false);
      toast.success('Nombres ordenados');
      setCatalogCheck(r);
      onChanged();
    } catch (e) {
      toast.error(`No se pudo ordenar: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const precioPendiente = (priceCheck?.updated ?? 0) > 0;
  const nombrePendiente =
    (catalogCheck?.brands_fixed ?? 0) + (catalogCheck?.models_fixed ?? 0) + (catalogCheck?.names_fixed ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BadgeDollarSign className="size-4 text-primary" /> Precios de costo y venta
          </CardTitle>
          <CardDescription>
            Toma los precios de la lista de la tienda y los carga en el inventario cruzando marca y modelo.
            No crea productos nuevos y <strong>no cambia</strong> los precios que ya escribiste a mano.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={revisarPrecios} disabled={busy !== null}>
              {busy === 'precios'
                ? <Loader2 data-icon="inline-start" className="animate-spin" />
                : <Check data-icon="inline-start" />}
              1. Revisar qué cambiaría
            </Button>
            <Button onClick={aplicarPrecios} disabled={busy !== null || !precioPendiente}>
              <BadgeDollarSign data-icon="inline-start" /> 2. Cargar los precios
            </Button>
          </div>

          {priceCheck && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <span className="text-sm font-medium">
                {priceCheck.updated === 0
                  ? 'Todo al día: no hay precios que cargar.'
                  : `Se van a cargar los precios de ${priceCheck.updated} productos.`}
              </span>
              <div className="flex flex-col">
                <Fila label="Productos de la lista que se encontraron" value={`${priceCheck.matched} de ${priceCheck.items}`} />
                {priceCheck.already_priced > 0 && <Fila label="Ya tenían precio (no se tocan)" value={priceCheck.already_priced} />}
                {priceCheck.unmatched > 0 && <Fila label="No están en el inventario" value={priceCheck.unmatched} />}
              </div>
              <span className={priceCheck.dry_run ? 'text-muted-foreground' : 'text-success'}>
                {priceCheck.dry_run ? 'Esto es solo la revisión: todavía no se cambió nada.' : 'Listo, ya quedó cargado.'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tags className="size-4 text-primary" /> Nombres de marca y modelo
          </CardTitle>
          <CardDescription>
            Deja todo escrito igual: la marca como el fabricante (<em>Redmi</em> pasa a <em>Xiaomi</em>), el modelo con su
            nombre real (<em>Hot 40i</em>, <em>13 Pro Max</em>, <em>iPhone 11</em>) y un solo teléfono principal por ficha.
            Se guarda copia de seguridad antes de aplicar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={revisarNombres} disabled={busy !== null}>
              {busy === 'nombres'
                ? <Loader2 data-icon="inline-start" className="animate-spin" />
                : <Check data-icon="inline-start" />}
              1. Revisar qué cambiaría
            </Button>
            <Button onClick={aplicarNombres} disabled={busy !== null || !nombrePendiente}>
              <Wand2 data-icon="inline-start" /> 2. Ordenar los nombres
            </Button>
          </div>

          {catalogCheck && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <span className="text-sm font-medium">
                {nombrePendiente
                  ? `Hay ${catalogCheck.brands_fixed + catalogCheck.models_fixed + catalogCheck.names_fixed} fichas con el nombre por ordenar.`
                  : 'Todo al día: los nombres ya están ordenados.'}
              </span>
              <div className="flex flex-col">
                <Fila label="Marcas a corregir" value={catalogCheck.brands_fixed} />
                <Fila label="Modelos a corregir" value={catalogCheck.models_fixed} />
                <Fila label="Nombres a reescribir" value={catalogCheck.names_fixed} />
                <Fila label="Fichas repetidas del mismo teléfono" value={catalogCheck.duplicate_groups} />
              </div>
              <span className={catalogCheck.dry_run ? 'text-muted-foreground' : 'text-success'}>
                {catalogCheck.dry_run
                  ? 'Esto es solo la revisión: todavía no se cambió nada.'
                  : `Listo${catalogCheck.backup ? ' (se guardó copia de seguridad)' : ''}.`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* F65 — crear, corregir y borrar las categorías con las que se organiza el inventario.
          `onRefresh` (y NO `onChanged`): renombrar o borrar una categoría NO puede sacar al dueño de
          la pestaña Ajustes — `onChanged` refresca y salta a Productos, que es lo correcto al
          aplicar precios/nombres pero no acá. */}
      <CategoriesCard onChanged={onRefresh} refreshKey={refreshKey} />

      <Card data-card="modelos-separados">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="size-4 text-primary" /> Modelos de teléfono (uno por teléfono real)
          </CardTitle>
          <CardDescription>
            Hoy hay fichas con <strong>dos teléfonos pegados en el nombre</strong> (por ejemplo «Samsung A70 A705»):
            al buscar «A70» aparece esa ficha confusa. Esta limpieza los <strong>separa en modelos reales</strong>
            —«Samsung A70» y «Samsung A705»— y la pantalla queda <strong>compatible con los dos</strong>. Los modelos
            nuevos se numeran (<em>M-…</em>) y se marcan según lo que usás. Se guarda copia de seguridad antes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={revisarModelos} disabled={busy !== null} data-action="revisar-modelos">
              {busy === 'modelos'
                ? <Loader2 data-icon="inline-start" className="animate-spin" />
                : <Check data-icon="inline-start" />}
              1. Revisar qué cambiaría
            </Button>
            <Button onClick={aplicarModelos} disabled={busy !== null || (splitCheck?.created.length ?? 0) === 0}
              data-action="aplicar-modelos">
              <Smartphone data-icon="inline-start" /> 2. Separar los modelos
            </Button>
          </div>

          {splitCheck && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"
              data-split-report={splitCheck.created.length}>
              <span className="text-sm font-medium">
                {splitCheck.created.length === 0
                  ? 'Todo al día: no hay modelos pegados que separar.'
                  : `Se van a separar ${splitCheck.created.length} teléfonos.`}
              </span>
              <div className="flex flex-col">
                <Fila label="Teléfonos en el padrón" value={`${splitCheck.phones_before} → ${splitCheck.phones_after}`} />
                <Fila label="Aparecen" value={splitCheck.created.length} />
                <Fila label="Dejan de existir (nombres pegados)" value={splitCheck.removed.length} />
                <Fila label="Variantes que se sacan del texto" value={splitCheck.variants_extracted} />
              </div>
              {splitCheck.removed.length > 0 && (
                <div className="flex flex-col gap-0.5" data-split-removed>
                  <span className="text-muted-foreground">Nombres que se van a separar:</span>
                  {splitCheck.removed.slice(0, 8).map(n => <span key={n} className="font-mono text-[11px]">{n}</span>)}
                  {splitCheck.removed.length > 8 && <span className="text-muted-foreground">…y {splitCheck.removed.length - 8} más</span>}
                </div>
              )}
              {splitCheck.created.length > 0 && (
                <div className="flex flex-col gap-0.5" data-split-created>
                  <span className="text-muted-foreground">Modelos nuevos:</span>
                  {splitCheck.created.slice(0, 8).map(n => <span key={n} className="font-mono text-[11px]">{n}</span>)}
                  {splitCheck.created.length > 8 && <span className="text-muted-foreground">…y {splitCheck.created.length - 8} más</span>}
                </div>
              )}
              {splitCheck.backup && (
                <span className="text-success">Copia de seguridad: {splitCheck.backup.split('\\').pop()}</span>
              )}
              <span className={splitCheck.dry_run ? 'text-muted-foreground' : 'text-success'}>
                {splitCheck.dry_run ? 'Esto es solo la revisión: todavía no se cambió nada.' : 'Listo, los modelos ya quedaron separados.'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PackagePlus className="size-4 text-primary" /> Inventario del local (contar la mercancía)
          </CardTitle>
          <CardDescription>
            Para cuando contás lo que hay en el mostrador: pegás (o abrís) la lista tal como la tenés escrita —una marca por
            línea y debajo sus modelos, con la cantidad entre paréntesis: <em>A30/A50 (2)</em> — y la app la cruza contra el
            catálogo. <span className="font-medium text-foreground">Antes de aplicar ves y corregís</span> qué pantalla
            recibe cada cantidad, y se guarda copia de seguridad.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setShowCsv(true)} data-action="cargar-csv">
              <FileSpreadsheet data-icon="inline-start" /> Cargar inventario por CSV
            </Button>
            <Button variant="outline" onClick={() => setShowLoad(true)}>
              <PackagePlus data-icon="inline-start" /> Cargar la lista del local (conteo físico)
            </Button>
          </div>
          <span className="text-[11px] text-muted-foreground">
            <strong>CSV (recomendado):</strong> trae TODOS los campos del producto (categoría —incluso nuevas—,
            marca, modelo, variante, compatibilidad, costo, venta, efectivo, stock, mínimo, proveedor, código) y
            el stock <strong>se suma</strong> a lo que ya hay; antes de aplicar ves en dos pestañas qué es nuevo y qué
            ya existe, con el diff y las acciones por fila.
          </span>
          <span className="text-[11px] text-muted-foreground">
            <strong>Conteo físico:</strong> pegás la lista como la tenés escrita (marca/modelo y la cantidad entre
            paréntesis: <em>A30/A50 (2)</em>) y lo que no está en la lista queda en <strong>0</strong>. Todo movimiento queda
            anotado en «Movimientos» con el motivo <em>Carga de inventario</em>.
          </span>
        </CardContent>
      </Card>

      {showCsv && (
        <LoadCsvDialog
          categories={categories}
          onClose={() => setShowCsv(false)}
          onApplied={() => { toast.success('Inventario cargado desde el CSV'); onRefresh(); }}
        />
      )}

      {showLoad && (
        <LoadInventoryDialog
          onClose={() => setShowLoad(false)}
          onApplied={() => { toast.success('Inventario cargado'); onRefresh(); }}
        />
      )}

      <Separator />
      <p className="text-[11px] text-muted-foreground">
        Ninguna de estas acciones borra productos. Si algo saliera mal, la copia de seguridad queda guardada en la carpeta{' '}
        <span className="font-medium text-foreground">backup</span> junto a la base de datos.
      </p>
    </div>
  );
}
