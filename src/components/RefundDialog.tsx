import { useCallback, useEffect, useRef, useState } from 'react';
import { Undo2, AlertTriangle, CheckCircle2, CircleX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
// F31: selector de método de pago compartido (3 favoritos a un toque + el resto en un desplegable)
import { PaymentMethodPicker } from './PaymentMethodPicker';
import { methodCurrency, currencySymbol, isFinalized } from '@/lib/utils';
// F36: el tope de la devolución es POR MONEDA (lo que netamente entró en ella), sin tasas.
// F42: además, la devolución vuelve POR EL MÉTODO POR EL QUE ENTRÓ la plata (el del formulario no
// sirve: es sólo lo que se esperaba cobrar).
import {
  refundable, refundSuggestion, canRefund, refundCapLabel,
  refundMethodDefault, refundMethodProblem, incomeSummary, isCashMethod, methodHasIncome,
} from '@/lib/refund-math';
import type { Service, ServicePayment } from '../types';

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
  const [confirmNoMoney, setConfirmNoMoney] = useState(false);
  const amountTouched = useRef(false);
  /** F42: si el operario ya eligió el método a mano, no se le pisa al llegar los pagos */
  const methodTouched = useRef(false);

  const refundIsBs = refundCurrency === 'VES';
  const refundIsPagoMovil = refundMethod.includes('Móvil') || refundMethod.includes('Movil');

  // F36: el tope es POR MONEDA — lo que netamente entró en esa moneda (Bs con Bs, $ con $), sin
  // tasas. Ver `src/lib/refund-math.ts` y el test de paridad con el backend.
  const [pagos, setPagos] = useState<ServicePayment[]>([]);
  const disponible = refundable(pagos, refundCurrency);
  const capLabel = refundCapLabel(pagos, refundCurrency);

  const abonadoUsd = service?.paid_amount ?? 0;
  // Entregado sin que el cliente haya pagado: devolución SIN dinero (solo estado Devuelto)
  const noMoney = disponible <= 0.005 && (service?.paid_amount ?? 0) <= 0.005 && !isFinalized(service?.status);

  useEffect(() => {
    api.getPaymentMethods().then(setMethods).catch(() => {});
  }, []);

  // Monto sugerido = TODO lo que queda disponible DE ESA MONEDA (ya no se convierte con la tasa:
  // es el número que entró, tal cual).
  const suggestAmount = useCallback(() => refundSuggestion(pagos, refundCurrency), [pagos, refundCurrency]);

  useEffect(() => {
    if (!open || !service) return;
    let alive = true;
    // F42: los movimientos son los que dicen por dónde entró la plata (y en qué moneda)
    api.getServicePayments(service.id).then(p => { if (alive) setPagos(p); }).catch(() => { if (alive) setPagos([]); });
    // El método del FORMULARIO sólo queda como respaldo hasta que lleguen los pagos: en cuanto se
    // sabe por dónde entró la plata, el diálogo PROPONE ese método (`refundMethodDefault`).
    setRefundMethod(service.payment_method ?? 'Divisas (USD Cash)');
    setRefundCurrency(methodCurrency(service.payment_method));
    setRefundZelle('');
    setRefundNotes('');
    setRefundError(null);
    // F36: `confirmNoMoney` también se resetea. El componente queda montado entre órdenes, así que sin
    // esto el «Devolver sin reembolso» marcado en una orden SIN pago se filtraba a la siguiente: el
    // botón del pie decía «sin reembolso» y un clic marcaba Devuelto una orden PAGADA **sin devolver
    // la plata** (y después la UI ya no ofrecía devolverla).
    setConfirmNoMoney(false);
    amountTouched.current = false;
    methodTouched.current = false;
    return () => { alive = false; };
  }, [open, service]);

  // F42 — el método (y la moneda) que el diálogo PROPONE salen de lo que ENTRÓ, no del formulario.
  // Se recalcula cuando llegan los movimientos; nunca pisa una elección del operario (`methodTouched`).
  useEffect(() => {
    if (!open || !service || methodTouched.current) return;
    const formCur = methodCurrency(service.payment_method) as 'USD' | 'VES';
    const cur: 'USD' | 'VES' = refundable(pagos, formCur) > 0.005
      ? formCur
      : (refundable(pagos, 'VES') > 0.005 ? 'VES' : (refundable(pagos, 'USD') > 0.005 ? 'USD' : formCur));
    const propuesto = refundMethodDefault(pagos, cur, service.payment_method);
    setRefundMethod(prev => (methodTouched.current ? prev : propuesto));
    setRefundCurrency(prev => {
      if (methodTouched.current || prev === cur) return prev;
      amountTouched.current = false;
      return cur;
    });
  }, [open, service, pagos]);

  useEffect(() => {
    if (open && !amountTouched.current) setRefundAmount(suggestAmount());
  }, [open, service, refundMethod, refundCurrency, pagos, suggestAmount]);

  const doRefund = async () => {
    if (!service) return;
    setRefundError(null);
    if (!confirmNoMoney) {
      if (refundAmount <= 0) return;
      // F42 — el método tiene que ser por donde ENTRÓ la plata: un canal que no cobró nada (Pago Móvil,
      // Transferencia, Zelle, Punto) no puede "devolver" (la máquina/el banco no devuelven solos). Los
      // métodos de cajón sí pueden pagar la devolución aunque la plata haya entrado por transferencia.
      const problemaMetodo = refundMethodProblem(pagos, refundMethod, refundCurrency);
      if (problemaMetodo) { setRefundError(problemaMetodo); return; }
      // Validación POR MONEDA (la misma regla que el backend): no más bolívares de los que entraron,
      // ni más dólares de los que entraron.
      if (!canRefund(pagos, refundCurrency, refundAmount)) {
        setRefundError(disponible > 0
          ? `Solo puedes devolver hasta ${capLabel} (lo que entró ${refundIsBs ? 'en bolívares' : 'en dólares'}).`
          : `No entraron ${refundIsBs ? 'bolívares' : 'dólares'} en esta orden: no hay nada que devolver con este método.`);
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
            {/* F36: el tope en la MONEDA de la devolución (sin «≈ $», que era justo lo que confundía) */}
            <p>
              Disponible para devolver {refundIsBs ? 'en Bs.' : 'en $'}: <strong data-field="refund-cap">{capLabel}</strong>
            </p>
            {/* F42: de dónde salió la plata — el operario tiene que poder elegir con la verdad delante */}
            {incomeSummary(pagos, refundCurrency) && (
              <p className="text-xs text-muted-foreground" data-field="refund-entro">
                Entró por: <strong>{incomeSummary(pagos, refundCurrency)}</strong>
              </p>
            )}
            {service?.status === 'Entregado' && (
              <p className="text-xs text-amber-600">El equipo fue entregado: al devolver el dinero, el estado pasará a Devuelto y se devuelve el inventario descontado.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Monto a devolver ({refundIsBs ? 'Bs.' : '$'})</label>
            <Input type="number" step={refundIsBs ? 1 : 0.01} min={0.01} value={refundAmount}
              onChange={e => { amountTouched.current = true; setRefundAmount(Number(e.target.value)); }} />
            {refundIsBs && disponible > 0 && (
              <p className="text-xs text-muted-foreground">
                Se devuelven <strong>{capLabel}</strong> como máximo: es lo que entró en bolívares.
                Devolver todo lo cobrado deja la orden <strong>saldada</strong>. La tasa BCV del día del
                cobro es la que ya está aplicada al abonado (no se revalúa con la de hoy).
              </p>
            )}
            {!refundIsBs && disponible > 0 && (
              <p className="text-xs text-muted-foreground">
                Se devuelven <strong>{capLabel}</strong> como máximo: son los dólares que entraron.
              </p>
            )}
            {disponible <= 0.005 && !confirmNoMoney && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800">
                  No entraron {refundIsBs ? 'bolívares' : 'dólares'} en esta orden: con este método no hay nada que devolver.
                  Elegí el método en el que se cobró (o usá <strong>Devolver sin reembolso</strong> si el dinero no vuelve).
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Método de devolución</label>
            {/* F31: los 3 métodos que más se usan a un toque; el resto en «Otros métodos…» */}
            <PaymentMethodPicker
              methods={methods}
              value={refundMethod}
              onChange={v => {
                methodTouched.current = true;
                const mismaMoneda = methodCurrency(v) === refundCurrency;
                setRefundMethod(v);
                setRefundCurrency(methodCurrency(v));
                // F36: al cambiar de moneda el monto se vuelve a PROPONER (el disponible de esa
                // moneda), nunca se deja el número anterior con otro rótulo: escribir 100 en $ y pasar
                // a «Pago Móvil» habría devuelto Bs. 100 (≈ $0,13) marcando la orden como Devuelta.
                if (!mismaMoneda) { amountTouched.current = false; setRefundAmount(0); }
              }}
            />
            {/* F42: si el método elegido no cobró nada en esa moneda, se dice por dónde entró y se
                ofrece el correcto a un toque (los de cajón pueden seguir: la plata sale del cajón). */}
            {refundMethodProblem(pagos, refundMethod, refundCurrency) ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800" data-field="refund-metodo-aviso">
                {refundMethodProblem(pagos, refundMethod, refundCurrency)}
              </div>
            ) : isCashMethod(refundMethod) && !methodHasIncome(pagos, refundMethod, refundCurrency) && disponible > 0.005 ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800" data-field="refund-metodo-aviso">
                Ojo: por «{refundMethod}» no entró plata en esta orden — la devolución sale del CAJÓN.
                Entró por: {incomeSummary(pagos, refundCurrency) || '—'}.
              </div>
            ) : null}
            {refundMethodDefault(pagos, refundCurrency, '') !== refundMethod && refundable(pagos, refundCurrency) > 0.005 && (
              <Button variant="outline" size="sm" className="w-fit" data-action="usar-metodo-real"
                onClick={() => {
                  methodTouched.current = false;
                  setRefundMethod(refundMethodDefault(pagos, refundCurrency, refundMethod));
                  amountTouched.current = false;
                }}>
                Usar «{refundMethodDefault(pagos, refundCurrency, refundMethod)}» (por donde entró)
              </Button>
            )}
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
            // F36: una devolución en Bs ya NO depende de la tasa de HOY (el tope es por moneda y el
            // valor de los bolívares se fija con la tasa del día en que entraron).
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
