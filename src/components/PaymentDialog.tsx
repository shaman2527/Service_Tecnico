import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Printer, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { methodCurrency, currencySymbol, isRefund, isFinalized } from '@/lib/utils';
import PrintReceiptDialog from './PrintReceiptDialog';
import type { Service, ServicePayment } from '../types';

export default function PaymentDialog({ service, open, onOpenChange, onSaved, dayOpen }: {
  service: Service | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
  dayOpen?: boolean | null;
}) {
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('Divisas (USD Cash)');
  // Moneda del CAMPO (toggle $ / Bs.): el operario escribe en la moneda que dice el
  // cliente ("pago 7000 Bs.", "abono $20"). Por defecto sigue al método, pero se
  // puede cambiar — la moneda que se GUARDA es siempre la del método.
  const [payCur, setPayCur] = useState<'USD' | 'VES'>('USD');
  const [payFee, setPayFee] = useState(0);
  const [payZelle, setPayZelle] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [savingPay, setSavingPay] = useState(false);
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [tasaBcv, setTasaBcv] = useState(0);
  // Si el usuario tecleó el monto a mano, no se re-sugiere
  const payTouched = useRef(false);
  const [printOpen, setPrintOpen] = useState(false);

  const payCurrency = methodCurrency(payMethod); // moneda del MÉTODO (lo que se guarda)
  const payIsBs = payCurrency === 'VES';
  const payIsPagoMovil = payMethod.includes('Móvil') || payMethod.includes('Movil');

  // Conversión de moneda del CAMPO (toggle): Bs entero, $ 2 decimales. Sin tasa no
  // hay conversión segura → devuelve el valor sin cambios (el Alert ámbar lo avisa).
  const convertTo = (value: number, to: 'USD' | 'VES'): number => {
    if (tasaBcv <= 0 || to === payCur) return value;
    if (to === 'VES') return Math.round(value * tasaBcv);
    return Math.round((value / tasaBcv) * 100) / 100;
  };

  // Cambiar la moneda del campo convierte el valor SIN cambiar su significado:
  // $5 → Bs. 3.744 al pasar a Bs.; Bs. 5.000 → $6.68 al pasar a $.
  const switchCur = (next: 'USD' | 'VES') => {
    if (next === payCur) return;
    setPayAmount(convertTo(payAmount, next));
    setPayCur(next);
  };

  // Monto FINAL a guardar: SIEMPRE en la moneda del MÉTODO (el campo puede estar en $ o Bs.).
  const payAmountFinal = payCurrency === 'VES'
    ? (payCur === 'VES' ? Math.round(payAmount) : tasaBcv > 0 ? Math.round(payAmount * tasaBcv) : 0)
    : (payCur === 'USD' ? Math.round(payAmount * 100) / 100 : tasaBcv > 0 ? Math.round((payAmount / tasaBcv) * 100) / 100 : 0);

  // Chips de abono rápido en la moneda del CAMPO: $5/$10/$15/$20 o Bs. 5.000/10.000/15.000/20.000
  // ("5 mil", "10 mil" — lo que dice el cliente).
  const QUICK_USD = [5, 10, 15, 20];
  const QUICK_VES = [5000, 10000, 15000, 20000];

  useEffect(() => {
    api.getPaymentMethods().then(setMethods).catch(() => {});
  }, []);

  // Monto sugerido (Todo el saldo) en la moneda del CAMPO: Bs → saldo × tasa BCV.
  const suggestAmount = useCallback(() => {
    if (!service) return 0;
    const saldo = service.amount - (service.paid_amount ?? 0);
    if (saldo <= 0.005) return 0;
    const bruto = Math.min(saldo, service.amount);
    if (payCur === 'VES') return tasaBcv > 0 ? Math.round(bruto * tasaBcv) : 0;
    return Math.round(bruto * 100) / 100;
  }, [service, payCur, tasaBcv]);

  // Cargar pagos + tasa al abrir con un servicio
  useEffect(() => {
    if (!open || !service) return;
    let alive = true;
    api.getServicePayments(service.id).then(p => { if (alive) setPayments(p); }).catch(() => {});
    api.getActiveDay().then(d => { if (alive) setTasaBcv(d?.tasa_bcv ?? 0); }).catch(() => {});
    // Inicializar el form con el método del servicio (el toggle sigue la moneda del método)
    setPayMethod(service.payment_method ?? 'Divisas (USD Cash)');
    setPayCur(methodCurrency(service.payment_method));
    setPayFee(service.payment_method?.includes('Punto') ? 3.5 : 0);
    setPayZelle('');
    setPayNotes('');
    setPayError(null);
    payTouched.current = false;
    return () => { alive = false; };
  }, [open, service]);

  // Re-sugerir el monto cuando cambia el método, la moneda del campo, la tasa o se abre (solo si no se tocó a mano)
  useEffect(() => {
    if (open && !payTouched.current) setPayAmount(suggestAmount());
  }, [open, service, payMethod, payCur, tasaBcv, suggestAmount]);

  const refresh = async () => {
    if (!service) return;
    const p = await api.getServicePayments(service.id);
    setPayments(p);
    onSaved?.();
  };

  const doAddPayment = async () => {
    if (!service || payAmount <= 0 || payAmountFinal <= 0) return;
    setSavingPay(true);
    setPayError(null);
    try {
      await api.addServicePayment(service.id, payAmountFinal, payMethod, payFee, payZelle, payCurrency, payNotes);
      await refresh();
      onOpenChange(false);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPay(false);
    }
  };

  const doDeletePayment = async (pid: number) => {
    if (!service) return;
    await api.deleteServicePayment(pid);
    await refresh();
  };

  // Saldo honesto usando los datos frescos del servicio (amount vs paid_amount)
  const abonadoUsd = service?.paid_amount ?? 0;
  const saldoUsd = (service?.amount ?? 0) - abonadoUsd;
  const excedenteUsd = -Math.min(0, saldoUsd);
  const totalAbonadoBs = payments.reduce((a, p) => a + (p.currency === 'VES' ? p.amount : 0), 0);

  // Valor del chip "Todo el saldo" en la moneda del CAMPO (Bs → saldo × tasa BCV)
  const saldoChip = payCur === 'VES'
    ? (tasaBcv > 0 ? Math.round(Math.max(0, saldoUsd) * tasaBcv) : 0)
    : Math.round(Math.max(0, saldoUsd) * 100) / 100;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[88vh] flex flex-col overflow-hidden"
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doAddPayment();
        }}>
        <DialogHeader className="shrink-0">
          <DialogTitle>Registrar Pago / Abono {service ? `· ${service.order_num}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
          <div className="text-sm flex flex-col gap-1 rounded-md bg-muted/60 px-3 py-2">
            <p>Total: <strong>${(service?.amount ?? 0).toFixed(2)}</strong></p>
            {isFinalized(service?.status) ? (
              <p className="text-muted-foreground">Orden {service?.status === 'Devuelto' ? 'devuelta' : 'cancelada'} — no acepta más pagos.</p>
            ) : saldoUsd < -0.005 ? (
              <p>Excedente: <strong className="text-warning">${excedenteUsd.toFixed(2)}</strong> (se cobró más que el monto del servicio)</p>
            ) : payments.length === 0 ? (
              <p>Por pagar: <strong className="text-amber-600">${saldoUsd.toFixed(2)}</strong></p>
            ) : saldoUsd > 0.005 ? (
              <p>Saldo pendiente: <strong className="text-danger">${saldoUsd.toFixed(2)}</strong></p>
            ) : (
              <p>Saldo: <strong className="text-success">Cancelado</strong></p>
            )}
            {abonadoUsd > 0 && (
              <p className="text-xs text-muted-foreground">
                Abonado: ${abonadoUsd.toFixed(2)}{totalAbonadoBs > 0 && <span> + Bs. {totalAbonadoBs.toFixed(2)}</span>}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Monto ({payCur === 'VES' ? 'Bs.' : '$'})</label>
              <ToggleGroup type="single" value={payCur} onValueChange={v => { if (v) switchCur(v as 'USD' | 'VES'); }}>
                <ToggleGroupItem value="USD" className="h-7 px-2.5 text-xs">$</ToggleGroupItem>
                <ToggleGroupItem value="VES" className="h-7 px-2.5 text-xs">Bs.</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(payCur === 'VES' ? QUICK_VES : QUICK_USD).map(v => (
                <Button key={v} type="button" size="sm"
                  variant={Math.abs(payAmount - v) < 0.5 ? 'default' : 'outline'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => { payTouched.current = true; setPayAmount(v); }}>
                  {payCur === 'VES' ? `Bs. ${v.toLocaleString('es-VE')}` : `$${v}`}
                </Button>
              ))}
              <Button type="button" size="sm"
                variant={Math.abs(payAmount - saldoChip) < 0.5 ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => { payTouched.current = true; setPayAmount(saldoChip); }}>
                Todo el saldo
              </Button>
            </div>
            <Input type="number" step={payCur === 'VES' ? 1 : 0.01} min={0.01} value={payAmount}
              onChange={e => { payTouched.current = true; setPayAmount(Number(e.target.value)); }} />
            {tasaBcv <= 0 && (payIsBs || payCur === 'VES') && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800">
                  El día no tiene tasa BCV (está en 0) — las conversiones Bs/$ dan 0. Actualiza la tasa en
                  <strong> Libro Diario → banner verde "Día ABIERTO" → Actualizar día</strong> para
                  poder cobrar en bolívares.
                </AlertDescription>
              </Alert>
            )}
            {payCur === 'VES' && tasaBcv > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ ${(payAmount / tasaBcv).toFixed(2)} (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
            {payCur === 'USD' && tasaBcv > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ Bs. {Math.round(payAmount * tasaBcv).toLocaleString('es-VE')} (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
            {payIsBs && payCur === 'USD' && tasaBcv > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Se abonarán <strong>Bs. {payAmountFinal.toLocaleString('es-VE')}</strong> (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
            {!payIsBs && payCur === 'VES' && tasaBcv > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Se abonarán <strong>${payAmountFinal.toFixed(2)}</strong> (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
            {payIsBs && saldoUsd > 0.005 && tasaBcv > 0 && (
              <p className="text-xs text-muted-foreground">
                Saldo pendiente ≈ <strong>Bs. {Math.round(saldoUsd * tasaBcv).toLocaleString('es-VE')}</strong> (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Método de Pago</label>
            <Select value={payMethod} onValueChange={v => {
              const nextCur = methodCurrency(v);
              setPayMethod(v);
              setPayFee(v.includes('Punto') ? 3.5 : 0);
              // El toggle sigue al método y el valor se CONVIERTE sin cambiar de
              // significado (7000 Bs → $9.35 si cambias a un método en dólares).
              if (nextCur !== payCur) {
                setPayAmount(convertTo(payAmount, nextCur));
                setPayCur(nextCur);
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {methods.map(m => (
                  <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {payIsBs && (
              <p className="text-xs text-amber-600">
                Este método es en bolívares: el abono se registra en Bs. y se convierte a $ con la tasa BCV del día al calcular el saldo.
              </p>
            )}
          </div>
          {payMethod.includes('Punto') && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Comisión Punto (%)</label>
              <Input type="number" step={0.1} min={0} max={100} value={payFee}
                onChange={e => setPayFee(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">
                Comisión: {currencySymbol(payCurrency)}{((payAmountFinal * payFee) / 100).toFixed(2)} · Neto: {currencySymbol(payCurrency)}{(payAmountFinal - (payAmountFinal * payFee) / 100).toFixed(2)}
              </p>
            </div>
          )}
          {(payMethod.includes('Zelle') || payIsPagoMovil) && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Referencia</label>
              <Input value={payZelle} onChange={e => setPayZelle(e.target.value)}
                placeholder="Número de referencia (últimos 4 dígitos)..." />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Notas (opcional)</label>
            <Input value={payNotes} onChange={e => setPayNotes(e.target.value)}
              placeholder="Ej: Abono inicial / Saldo al entregar..." />
          </div>
          {payments.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Pagos registrados</p>
              <div className="max-h-40 overflow-y-auto overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead className="w-9"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">{p.payment_date ? p.payment_date.slice(0, 16) : '-'}</TableCell>
                        <TableCell className="text-right font-medium">
                          {isRefund(p) ? (
                            <span className="text-danger">-{currencySymbol(p.currency)}{Math.abs(p.amount).toFixed(2)}</span>
                          ) : (
                            <>{currencySymbol(p.currency)}{p.amount.toFixed(2)}</>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {isRefund(p) ? <span className="font-medium text-danger">Devolución</span> : (p.payment_method ?? '-')}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                            onClick={() => doDeletePayment(p.id)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {payError && <p className="text-sm text-danger">{payError}</p>}
        </div>
        <DialogFooter className="shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {service && (
            <Button variant="outline" onClick={() => setPrintOpen(true)} title="Imprimir orden de servicio del equipo">
              <Printer className="size-4" /> Imprimir orden
            </Button>
          )}
          <Button onClick={doAddPayment} title="Ctrl+Enter" disabled={savingPay || payAmount <= 0 || payAmountFinal <= 0 || dayOpen === false || (payIsBs && tasaBcv <= 0)}>
            {savingPay ? 'Guardando...' : 'Guardar Pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <PrintReceiptDialog
      serviceId={service?.id ?? null}
      open={printOpen}
      onOpenChange={setPrintOpen}
    />
    </>
  );
}
