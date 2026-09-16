import { useState } from 'react';
import { BadgeDollarSign, Check, Loader2, PackagePlus, Tags, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { api } from '@/db';
import type { CatalogReport, PriceRestoreReport } from '@/types';
import { toast } from 'sonner';
import { LoadInventoryDialog } from './LoadInventoryDialog';

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
export function PricesTab({ onChanged, onRefresh }: { onChanged: () => void; onRefresh: () => void }) {
  const [priceCheck, setPriceCheck] = useState<PriceRestoreReport | null>(null);
  const [catalogCheck, setCatalogCheck] = useState<CatalogReport | null>(null);
  const [busy, setBusy] = useState<'precios' | 'nombres' | null>(null);
  const [showLoad, setShowLoad] = useState(false);

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
          <div>
            <Button onClick={() => setShowLoad(true)}>
              <PackagePlus data-icon="inline-start" /> Cargar la lista del local
            </Button>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Lo que dice la lista manda: si una pantalla no está en la lista queda en <strong>0</strong> y todo movimiento
            queda anotado en «Movimientos» con el motivo <em>Carga de inventario</em>. No se tocan precios ni compatibilidad.
          </span>
        </CardContent>
      </Card>

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
