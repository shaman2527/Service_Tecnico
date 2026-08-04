import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { methodCurrency, currencySymbol } from '@/lib/utils';
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
  const [payCurrency, setPayCurrency] = useState<'USD' | 'VES'>('USD');
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

  const payIsBs = payCurrency === 'VES';
  const payIsPagoMovil = payMethod.includes('Móvil') || payMethod.includes('Movil');

  useEffect(() => {
    api.getPaymentMethods().then(setMethods).catch(() => {});
  }, []);

  // Monto sugerido en la MONEDA del método: si es Bs, convierte el saldo USD × tasa BCV
  // (nunca sugerir el valor USD crudo como si fueran bolívares)
  const suggestAmount = useCallback(() => {
    if (!service) return 0;
    const saldo = service.amount - (service.paid_amount ?? 0);
    if (saldo <= 0.005) return 0;
    const bruto = Math.min(saldo, service.amount);
    if (methodCurrency(payMethod) === 'VES') {
      if (tasaBcv <= 0) return 0; // sin tasa no hay conversión segura
      return Math.round(bruto * tasaBcv); // Bs: entero
    }
    return Math.round(bruto * 100) / 100; // USD: 2 decimales
  }, [service, payMethod, tasaBcv]);

  // Cargar pagos + tasa al abrir con un servicio
  useEffect(() => {
    if (!open || !service) return;
    let alive = true;
    api.getServicePayments(service.id).then(p => { if (alive) setPayments(p); }).catch(() => {});
    api.getActiveDay().then(d => { if (alive) setTasaBcv(d?.tasa_bcv ?? 0); }).catch(() => {});
    // Inicializar el form con el método del servicio
    setPayMethod(service.payment_method ?? 'Divisas (USD Cash)');
    setPayCurrency(methodCurrency(service.payment_method));
    setPayFee(service.payment_method?.includes('Punto') ? 3.5 : 0);
    setPayZelle('');
    setPayNotes('');
    setPayError(null);
    payTouched.current = false;
    return () => { alive = false; };
  }, [open, service]);

  // Re-sugerir el monto cuando cambia el método, la tasa o se abre (solo si no se tocó a mano)
  useEffect(() => {
    if (open && !payTouched.current) setPayAmount(suggestAmount());
  }, [open, service, payMethod, tasaBcv, suggestAmount]);

  const refresh = async () => {
    if (!service) return;
    const p = await api.getServicePayments(service.id);
    setPayments(p);
    onSaved?.();
  };

  const doAddPayment = async () => {
    if (!service || payAmount <= 0) return;
    setSavingPay(true);
    setPayError(null);
    try {
      await api.addServicePayment(service.id, payAmount, payMethod, payFee, payZelle, payCurrency, payNotes);
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar Pago / Abono {service ? `· ${service.order_num}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="text-sm flex flex-col gap-1 rounded-md bg-muted/60 px-3 py-2">
            <p>Total: <strong>${(service?.amount ?? 0).toFixed(2)}</strong></p>
            {saldoUsd > 0.005 ? (
              <p>Saldo pendiente: <strong className="text-danger">${saldoUsd.toFixed(2)}</strong></p>
            ) : saldoUsd < -0.005 ? (
              <p>Excedente: <strong className="text-warning">${excedenteUsd.toFixed(2)}</strong> (se cobró más que el monto del servicio)</p>
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
            <label className="text-sm font-medium">{payIsBs ? 'Monto (Bs.)' : 'Monto ($)'}</label>
            <Input type="number" step={payIsBs ? 1 : 0.01} min={0.01} value={payAmount}
              onChange={e => { payTouched.current = true; setPayAmount(Number(e.target.value)); }} />
            {payIsBs && saldoUsd > 0.005 && tasaBcv > 0 && (
              <p className="text-xs text-muted-foreground">
                Saldo pendiente ≈ <strong>Bs. {Math.round(saldoUsd * tasaBcv).toLocaleString('es-VE')}</strong> (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
            {payIsBs && tasaBcv > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ ${(payAmount / tasaBcv).toFixed(2)} (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
            {!payIsBs && payAmount > 0 && tasaBcv > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ Bs. {(payAmount * tasaBcv).toFixed(2)} (tasa BCV {tasaBcv.toFixed(2)})
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Método de Pago</label>
            <Select value={payMethod} onValueChange={v => {
              setPayMethod(v);
              setPayCurrency(methodCurrency(v));
              if (v.includes('Punto')) setPayFee(3.5);
              else setPayFee(0);
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
                Comisión: {currencySymbol(payCurrency)}{((payAmount * payFee) / 100).toFixed(2)} · Neto: {currencySymbol(payCurrency)}{(payAmount - (payAmount * payFee) / 100).toFixed(2)}
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
              <div className="max-h-40 overflow-y-auto rounded-md border">
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
                          {currencySymbol(p.currency)}{p.amount.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs">{p.payment_method ?? '-'}</TableCell>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {service && (
            <Button variant="outline" onClick={() => setPrintOpen(true)} title="Imprimir factura del servicio">
              <Printer className="size-4" /> Imprimir factura
            </Button>
          )}
          <Button onClick={doAddPayment} disabled={savingPay || payAmount <= 0 || dayOpen === false}>
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
