import { useEffect, useState } from 'react';
import { Percent, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { cn, currencySymbol } from '@/lib/utils';
import { applyDiscount, discountLabel, discountProblem, grossOf, DISCOUNT_CHIPS } from '@/lib/discount';
import { updateOrderKeepingFields } from '@/lib/service-update';
import type { Service } from '../types';

// F49 — DESCUENTO rápido desde la tarjeta.
//
// Pedido del dueño (2026-09-20): «el cliente me pide que quite el botón de cerrar que sale en la card
// de servicios, y lo cambie por un botón de descuento para hacerle en ese servicio, y que se refleje
// en la factura que se le aplicó un descuento de X monto».
//
// Qué cuida:
//   · se guarda con la ÚNICA vía de actualización de órdenes (`updateOrderKeepingFields`), así que no
//     se pisa ningún otro campo (monto, pantalla exacta, técnico, fechas, observaciones);
//   · el cálculo sale del módulo PURO `lib/discount.ts`: el precio de lista es `amount + descuento`, y
//     el descuento nuevo se calcula DESDE ESE PRECIO (nunca sobre el total ya descontado);
//   · NO toca la caja: no crea ni borra pagos; si ya había abonos, el saldo se recalcula solo (y se
//     muestra acá en vivo para que nadie se lleve una sorpresa al cobrar);
//   · la factura imprime el PRECIO, el DESCUENTO y el TOTAL cuando hay descuento (ver
//     `buildServiceReceiptParts`).

export default function DiscountDialog({ service, open, onOpenChange, onSaved }: {
  service: Service | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bruto = service ? grossOf(service.amount ?? 0, service.discount_amount ?? 0) : 0;
  const actual = service?.discount_amount ?? 0;
  const abonado = service?.paid_amount ?? 0;

  // Al abrir se parte del descuento que YA tiene la orden (para verlo y ajustarlo, no para escribirlo
  // de nuevo). Se limpia al cerrar para no arrastrar el monto a la orden siguiente.
  useEffect(() => {
    if (open && service) { setValue(service.discount_amount ?? 0); setError(null); }
    if (!open) { setValue(0); setError(null); }
  }, [open, service]);

  if (!service) return null;

  const resultado = applyDiscount(service.amount ?? 0, actual, value);
  const aviso = discountProblem(value, bruto);
  const saldoDespues = resultado.amount - abonado;
  const cambia = Math.abs(resultado.amount - (service.amount ?? 0)) > 0.005;

  const aplicar = async () => {
    if (aviso) { setError(aviso); return; }
    if (!cambia) { onOpenChange(false); return; }
    setSaving(true);
    setError(null);
    try {
      await updateOrderKeepingFields(service, { amount: resultado.amount, discountAmount: resultado.discountAmount });
      toast.success(resultado.discountAmount > 0
        ? `${discountLabel(resultado.discountAmount)} · total $${resultado.amount.toFixed(2)}`
        : 'Descuento quitado', { id: `descuento-${service.id}` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md" data-discount-dialog>
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Percent className="size-4 text-violet-600" /> Descuento · {service.order_num}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {service.client} · {service.model}
          </p>

          {/* Resumen en vivo: precio de lista, descuento y total. Es lo que se va a imprimir. */}
          <div className="rounded-md bg-muted/50 px-3 py-2 flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Precio de lista</span>
              <span className="tabular-nums">{currencySymbol('USD')}{bruto.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Descuento</span>
              <span className="tabular-nums text-violet-700" data-field="descuento">−{currencySymbol('USD')}{resultado.discountAmount.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-1 font-semibold">
              <span>Total a pagar</span>
              <span className="tabular-nums" data-field="total-descuento">{currencySymbol('USD')}{resultado.amount.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Monto del descuento ({currencySymbol('USD')})</label>
            <Input type="number" step={0.01} min={0} inputMode="decimal" value={value} data-field="descuento-monto"
              onChange={e => { setValue(Number(e.target.value)); setError(null); }} />
            <div className="flex flex-wrap items-center gap-1.5">
              {DISCOUNT_CHIPS.map(c => (
                <Button key={c} type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs"
                  onClick={() => { setValue(c); setError(null); }}>
                  ${c}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground"
                onClick={() => { setValue(0); setError(null); }}>
                <Trash2 className="size-3" /> Sin descuento
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              El descuento sale del PRECIO de lista (${bruto.toFixed(2)}): el total del cliente queda en ${resultado.amount.toFixed(2)}
              {resultado.amount <= 0.005 && ' (cortesía: no se cobra nada)'}.
            </p>
          </div>

          {abonado > 0.005 && (
            <Alert className={cn('py-2', saldoDespues > 0.005 ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/40 bg-emerald-500/10')}>
              <AlertDescription className="text-xs">
                Ya hay <strong>{currencySymbol('USD')}{abonado.toFixed(2)}</strong> cobrado en esta orden:{' '}
                {saldoDespues > 0.005
                  ? <>va a quedar un saldo de <strong>{currencySymbol('USD')}{saldoDespues.toFixed(2)}</strong>.</>
                  : <>la orden queda <strong>saldada</strong> (o a favor del cliente, que se ve en la tarjeta).</>}
                {' '}Los pagos registrados no se tocan: solo cambia lo que falta cobrar.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" className="py-2" data-field="descuento-error">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={aplicar} disabled={saving || !!aviso}
            className="bg-violet-600 text-white hover:bg-violet-700">
            {saving ? 'Guardando...' : cambia ? 'Aplicar descuento' : 'Sin cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ¿La API del diálogo permite abrirlo? (una orden anulada no admite descuento: no hay nada que cobrar) */
export const canDiscount = (s: Service | null): boolean => !!s && !['Cancelado', 'Devuelto', 'Cancelado / Devuelto'].includes(s.status ?? '');
