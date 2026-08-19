import { useCallback, useEffect, useRef, useState } from 'react';
import { Undo2, AlertTriangle, CheckCircle2, CircleX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { methodCurrency, currencySymbol, isFinalized } from '@/lib/utils';
import type { Service } from '../types';

export default function RefundDialog({ service, open, onOpenChange, onSaved, dayOpen }: {
  service: Service | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
  dayOpen?: boolean | null;
}) {
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundMethod, setRefundMethod] = useState('Divisas (USD Cash)');
  const [refundCurrency, setRefundCurrency] = useState<'USD' | 'VES'>('USD');
  const [refundZelle, setRefundZelle] = useState('');
  const [refundNotes, setRefundNotes] = useState('');
  const [refundError, setRefundError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [tasaBcv, setTasaBcv] = useState(0);
  const [confirmNoMoney, setConfirmNoMoney] = useState(false);
  const amountTouched = useRef(false);

  const refundIsBs = refundCurrency === 'VES';
  const refundIsPagoMovil = refundMethod.includes('Móvil') || refundMethod.includes('Movil');

  const abonadoUsd = service?.paid_amount ?? 0;
  const maxUsd = abonadoUsd;
  // Entregado sin que el cliente haya pagado: devolución SIN dinero (solo estado Devuelto)
  const noMoney = maxUsd <= 0.005 && !isFinalized(service?.status);

  useEffect(() => {
    api.getPaymentMethods().then(setMethods).catch(() => {});
  }, []);

  // Monto sugerido = TODO lo abonado, en la moneda del método (Bs → × tasa BCV)
  const suggestAmount = useCallback(() => {
    if (maxUsd <= 0.005) return 0;
    if (methodCurrency(refundMethod) === 'VES') {
      if (tasaBcv <= 0) return 0;
      return Math.round(maxUsd * tasaBcv);
    }
    return Math.round(maxUsd * 100) / 100;
  }, [maxUsd, refundMethod, tasaBcv]);

  useEffect(() => {
    if (!open || !service) return;
    let alive = true;
    api.getActiveDay().then(d => { if (alive) setTasaBcv(d?.tasa_bcv ?? 0); }).catch(() => {});
    setRefundMethod(service.payment_method ?? 'Divisas (USD Cash)');
    setRefundCurrency(methodCurrency(service.payment_method));
    setRefundZelle('');
    setRefundNotes('');
    setRefundError(null);
    amountTouched.current = false;
    return () => { alive = false; };
  }, [open, service]);

  useEffect(() => {
    if (open && !amountTouched.current) setRefundAmount(suggestAmount());
  }, [open, service, refundMethod, tasaBcv, suggestAmount]);

  const doRefund = async () => {
    if (!service) return;
    setRefundError(null);
    if (!confirmNoMoney) {
      if (refundAmount <= 0) return;
      // Validación: no se puede devolver más de lo abonado (en USD equivalente)
      const equivUsd = refundIsBs
        ? (tasaBcv > 0 ? refundAmount / tasaBcv : refundAmount)
        : refundAmount;
      if (equivUsd > maxUsd + 0.01) {
        setRefundError(`Solo puedes devolver hasta lo abonado: ${currencySymbol(refundCurrency)}${maxUsd.toFixed(2)} ${refundIsBs ? `(≈ Bs. ${Math.round(maxUsd * tasaBcv)})` : ''}`);
        return;
      }
    }
    setSaving(true);
    try {
      if (!confirmNoMoney) {
        await api.addServiceRefund(service.id, refundAmount, refundMethod, refundZelle, refundCurrency, refundNotes);
      }
      // El equipo se devuelve al cliente: estado → Devuelto (reabre stock si estaba entregado)
      if (service.status !== 'Devuelto' && service.status !== 'Cancelado') {
        await api.updateService(
          service.id, service.client ?? '', service.phone ?? '', service.model ?? '', service.fault ?? '',
          service.service_type ?? '', service.service_types ?? '', service.amount, service.payment_method ?? '',
          service.date_out ?? '', 'Devuelto', service.observations ?? '',
          service.bank_fee_percent ?? 0, service.zelle_reference ?? '', service.currency ?? 'USD',
          service.client_ci ?? '', service.client_address ?? '', service.device_checklist ?? '',
          service.technician ?? '', service.technician_id ?? null, service.color ?? '',
          service.screen_product_id ?? null, service.discount_amount ?? 0,
        );
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[88vh] flex flex-col overflow-hidden"
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doRefund();
        }}>
        <DialogHeader className="shrink-0">
          <DialogTitle>Devolución {service ? `· ${service.order_num}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
          <div className="text-sm flex flex-col gap-1 rounded-md bg-muted/60 px-3 py-2">
            <p>Cliente: <strong>{service?.client ?? '-'}</strong> {service?.model ? `· ${service.model}` : ''}</p>
            <p>Total: <strong>${(service?.amount ?? 0).toFixed(2)}</strong></p>
            <p>Abonado: <strong className="text-success">${abonadoUsd.toFixed(2)}</strong></p>
            {service?.status === 'Entregado' && (
              <p className="text-xs text-amber-600">El equipo fue entregado: al devolver el dinero, el estado pasará a Devuelto y se devuelve el inventario descontado.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Monto a devolver ({refundIsBs ? 'Bs.' : '$'})</label>
            <Input type="number" step={refundIsBs ? 1 : 0.01} min={0.01} value={refundAmount}
              onChange={e => { amountTouched.current = true; setRefundAmount(Number(e.target.value)); }} />
            {refundIsBs && maxUsd > 0 && tasaBcv > 0 && (
              <p className="text-xs text-muted-foreground">
                Abonado ≈ <strong>Bs. {Math.round(maxUsd * tasaBcv).toLocaleString('es-VE')}</strong> (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
            {refundIsBs && tasaBcv > 0 && refundAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ ${(refundAmount / tasaBcv).toFixed(2)} (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Método de devolución</label>
            <Select value={refundMethod} onValueChange={v => {
              setRefundMethod(v);
              setRefundCurrency(methodCurrency(v));
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {methods.map(m => (
                  <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {refundIsBs && (
              <p className="text-xs text-amber-600">
                Este método es en bolívares: la devolución se registra en Bs. y se resta con la tasa BCV del día.
              </p>
            )}
          </div>
          {(refundMethod.includes('Zelle') || refundIsPagoMovil) && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Referencia</label>
              <Input value={refundZelle} onChange={e => setRefundZelle(e.target.value)}
                placeholder="Número de referencia (últimos 4 dígitos)..." />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Notas (opcional)</label>
            <Input value={refundNotes} onChange={e => setRefundNotes(e.target.value)}
              placeholder="Ej: Cliente no quiso la reparación..." />
          </div>
          <p className="text-xs text-muted-foreground">
            El reembolso se resta del Libro Diario del día (método elegido) y del abonado de la orden.
          </p>
          {noMoney && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1.5">
                <p className="text-xs">
                  Este equipo se entregó <span className="font-semibold">sin que el cliente haya pagado</span>:
                  no hay dinero que devolver.
                </p>
                <Button variant="outline" size="sm" className="w-fit border-amber-500/50 text-warning hover:bg-amber-500/10"
                  onClick={() => setConfirmNoMoney(c => !c)}>
                  {confirmNoMoney ? (
                    <><CheckCircle2 className="size-3.5" /> Confirmado: devolver sin reembolso</>
                  ) : (
                    <><CircleX className="size-3.5" /> Marcar como Devuelto sin reembolso</>
                  )}
                </Button>
              </div>
            </div>
          )}
          {refundError && <p className="text-sm text-danger">{refundError}</p>}
        </div>
        <DialogFooter className="shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={doRefund}
            title="Ctrl+Enter"
            disabled={saving || (dayOpen === false && !confirmNoMoney) || (refundAmount <= 0 && !confirmNoMoney)}>
            <Undo2 className="size-4" />
            {saving ? 'Procesando...' : confirmNoMoney
              ? 'Devolver sin reembolso (marcar Devuelto)'
              : `Devolver ${currencySymbol(refundCurrency)}${refundAmount.toFixed(2)} y marcar Devuelto`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
