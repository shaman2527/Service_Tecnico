import { useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Smartphone } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { api } from '../db';
import { cn, partLabel } from '@/lib/utils';
import type { ScreenCandidate } from '../types';

// Elección de la PANTALLA EXACTA que se instala: el hook que consulta la compatibilidad y el
// componente de selección. Las REGLAS puras (onlyScreens / asPhoneEntry / screenOk) viven en
// `lib/screen-rules.ts` para poder probarlas sin navegador; acá queda solo React.
//
// Compatibilidad del modelo: la resuelve el BACKEND (find_compatible_products), la MISMA
// fuente que usa el módulo de inventario. Devuelve los repuestos del catálogo que sirven a
// ese teléfono, rankeados (coincidencia exacta primero y, dentro del nivel, con stock antes
// de agotados). Antes esto se calculaba en el frontend sobre las 1126 filas del catálogo.
export function useCompatibleProducts(model: string, enabled = true) {
  const [candidates, setCandidates] = useState<ScreenCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = model.trim();
    if (!enabled || q.length < 3) { setCandidates([]); return; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.findCompatibleProducts(q, null, 80)
        .then(r => { if (alive) setCandidates(r); })
        .catch(() => { if (alive) setCandidates([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [model, enabled]);
  return { candidates, loading };
}

// Lista de pantallas compatibles con su stock: se elige la EXACTA que se instala (al entregar
// se descuenta esa y solo esa) y las agotadas se marcan aparte con confirmación obligatoria.
export function ScreenSelect({ screenProductId, screenOptions, loading, confirmed, onChange, onConfirm }: {
  screenProductId: number | null;
  screenOptions: ScreenCandidate[];
  loading: boolean;
  confirmed: boolean;
  onChange: (id: number | null) => void;
  onConfirm: (v: boolean) => void;
}) {
  const chosen = screenOptions.find(o => o.product.id === screenProductId) ?? null;
  const chosenOut = chosen != null && !chosen.in_stock;
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium flex items-center gap-1.5">
        <Smartphone className="size-3.5 text-muted-foreground" /> Pantalla a instalar
        <span className="font-normal text-muted-foreground text-xs">(descuenta del inventario al entregar)</span>
      </label>

      {loading && (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map(i => <div key={i} className="h-9 rounded-md bg-muted animate-pulse" />)}
        </div>
      )}

      {!loading && screenOptions.length === 0 && (
        <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
          Modelo sin pantallas en el catálogo — el inventario no se descuenta automáticamente.
          Revisa cómo está escrito el modelo o registra la pantalla en Inventario.
        </p>
      )}

      {!loading && screenOptions.length > 0 && (
        <div className="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-md border border-border p-1">
          {screenOptions.map(({ product: p, in_stock, match_quality }) => {
            const active = p.id === screenProductId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); if (in_stock) onConfirm(false); }}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  active ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-accent',
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Check className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-transparent')} />
                  <span className="truncate">
                    {partLabel(p)}
                    {p.variant && <Badge variant="secondary" className="ml-2 text-[10px]">{p.variant}</Badge>}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {match_quality !== 'exacta' && (
                    <Badge variant="outline" className="text-[10px]">{match_quality}</Badge>
                  )}
                  {p.price_sale > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">${p.price_sale.toFixed(2)}</span>
                  )}
                  <Badge
                    variant={in_stock ? 'default' : 'outline'}
                    className={cn('text-[10px] tabular-nums', in_stock ? 'bg-success text-white hover:bg-success' : 'text-warning border-warning/50')}
                  >
                    {in_stock ? `stock ${p.stock}` : 'agotada'}
                  </Badge>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!loading && screenOptions.length > 0 && screenProductId == null && (
        <p className="text-xs text-amber-600">Elige la pantalla exacta que se va a instalar</p>
      )}

      {!loading && chosen && !chosenOut && (
        <p className="text-xs text-emerald-600 flex items-center gap-1">
          <CheckCircle2 className="size-3" /> Al entregar se descuenta del inventario (stock actual {chosen.product.stock})
        </p>
      )}

      {!loading && chosenOut && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs">Esa pantalla no tiene stock</AlertTitle>
          <AlertDescription className="text-xs flex flex-col gap-2">
            <span>
              Si se entrega igual, el inventario de «{partLabel(chosen!.product)}» queda en{' '}
              <strong>{chosen!.product.stock - 1}</strong> y el movimiento se marca como <strong>faltante</strong>.
            </span>
            <button
              type="button"
              onClick={() => onConfirm(!confirmed)}
              className={cn(
                'self-start rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                confirmed ? 'border-destructive bg-destructive text-white' : 'border-border bg-background hover:bg-muted',
              )}
            >
              {confirmed ? '✓ Confirmado: se entregó sin stock registrado' : 'Confirmo que se entregó sin stock registrado'}
            </button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
