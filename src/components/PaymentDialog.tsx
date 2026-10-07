import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Printer, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { toast } from 'sonner';
import { methodCurrency, currencySymbol, isRefund, isFinalized, localDate } from '@/lib/utils';
// Reglas de dinero compartidas con el asistente de cierre (Harness F30): una sola
// implementación de la moneda del método vs la del campo, "todo el saldo" y Punto.
import {
  convertAmount, finalAmount, suggestAmount as suggestPaymentAmount,
  saldoChipValue, quickAmounts, puntoCommission, round2, DEFAULT_PUNTO_FEE,
} from '@/lib/payment-math';
import PrintReceiptDialog from './PrintReceiptDialog';
// F31: selector de método de pago compartido (3 favoritos a un toque + el resto en un desplegable)
import { PaymentMethodPicker } from './PaymentMethodPicker';
// F38: el saldo se muestra en la moneda en que se cobró + su equivalencia del día.
import { orderBalance, balanceLabel } from '@/lib/order-balance';
// F82 — la caja del día anterior sin cerrar: la regla pura decide si el abono se puede guardar hoy.
import { shiftPending, turnoViejoTexto, fechaLegible } from '@/lib/day-shift';
import type { AjusteCierre, EstadoDelDia, Service, ServicePayment } from '../types';

export default function PaymentDialog({ service, open, onOpenChange, onSaved }: {
  service: Service | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
  /** F94 — `dayOpen` y `puedeCerrarCaja` ya NO se usan acá: el abono no se bloquea por la caja (se le
   *  crea la del día elegido si no la tiene). Se conservan en la firma para no tocar a los llamadores
   *  —Services.tsx y el asistente de cierre siguen pasándolos— y porque el cartel de la caja vieja los
   *  sigue usando en sus pantallas. */
  dayOpen?: boolean | null;
  puedeCerrarCaja?: boolean;
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
  // F35: FECHA DEL PAGO. El cliente que dejó el equipo y pagó el LUNES avisa el martes: si el abono
  // se anota con la fecha de hoy, la caja del lunes cierra con FALTA y la del martes con SOBRA.
  // Por defecto hoy (el caso normal); se puede retroceder a un día con turno ABIERTO.
  const [payDate, setPayDate] = useState(() => localDate());
  const [editDateId, setEditDateId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [savingPay, setSavingPay] = useState(false);
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [tasaBcv, setTasaBcv] = useState(0);
  // Fecha del TURNO ABIERTO: es la caja que puede recibir plata, así que es la fecha por defecto
  // del abono (en el uso normal coincide con hoy; si el turno quedó abierto de otro día, el abono
  // va a ESA caja, que es la única que el backend acepta).
  const [diaTurno, setDiaTurno] = useState('');
  /** F82: la fecha del turno abierto, para saber si es el de HOY (el abono de hoy se bloquea). */
  const [fechaTurno, setFechaTurno] = useState<string | null>(null);
  /**
   * F92 — EL ESTADO DE LA CAJA DEL DÍA ELEGIDO (por `estado_del_dia`). Antes, si ese día ya estaba
   * cerrado, el guardado se rechazaba y había que reabrirlo con ↺, anotar el cobro y volver a cerrarlo;
   * el dueño pidió lo contrario («hay que actualizar el cierre de esos días»). Ahora se avisa ANTES:
   * «ese día está cerrado y su cierre se va a actualizar», y el backend lo recalcula contra el mismo
   * arqueo contado.
   */
  const [estadoDia, setEstadoDia] = useState<EstadoDelDia | null>(null);
  const turnoViejo = shiftPending(fechaTurno, localDate());
  /**
   * F94 — UN ABONO NO SE BLOQUEA POR LA CAJA (el pedido del dueño fue «un abono que se hizo unos días
   * anteriores, déjalo colocar» + «no tenga bloqueante»).
   *
   * La plata entra en la caja del **DÍA QUE SE ELIGE** y, si ese día no tiene caja, el sistema **se la
   * crea** (cerrada, con el arqueo en 0) — hoy incluido. Antes había dos bloqueos acá: `dayOpen ===
   * false` («Debe abrir el día…») y la caja vieja abierta con la fecha de hoy (F82), y los dos dejaban
   * al mostrador sin poder anotar un cobro que existió de verdad.
   *
   * Lo que SÍ sigue bloqueando: monto ≤ 0, una orden finalizada (Devuelto/Cancelado) y un abono en Bs
   * **sin ninguna tasa conocida** (se convertiría 1:1 y corrompería el saldo de la orden).
   */
  const esFechaDeHoy = payDate.slice(0, 10) === localDate();
  const diaSinCaja = !!estadoDia && !estadoDia.existe;
  /** El turno abierto es de OTRO día: este abono de hoy NO entra ahí (entra en la caja de hoy). */
  const cajaViejaAbierta = turnoViejo.stale && esFechaDeHoy;
  /**
   * F94 — LA TASA DEL DÍA DEL PAGO (no la de hoy). El backend valúa un abono con la tasa de SU día
   * (`recalc_paid_amount` + `has_bcv_rate_for_date`), así que el diálogo tiene que convertir con la
   * misma: si no, el «se va a guardar Bs. X» y el abono acreditado no coincidirían. Para un día sin
   * caja, `estado_del_dia` ya devuelve la tasa con la que nacerá esa caja.
   */
  const tasaDelPago = estadoDia ? estadoDia.tasa_bcv : tasaBcv;
  // Si el usuario tecleó el monto a mano, no se re-sugiere
  const payTouched = useRef(false);
  // Si el usuario cambió el toggle $/Bs. a mano, no se le pisa la elección (F38)
  const curTouched = useRef(false);
  /**
   * F92 — Si el operario ya eligió una FECHA, la carga del turno (que llega async, un instante después
   * de abrir el diálogo) NO se la puede pisar. Es el mismo patrón que `payTouched`/`curTouched` (F38) y
   * arregla un error real de plata: el mostrador elige «el cliente pagó ayer», la respuesta del turno
   * llega después y devolvía el campo a HOY — el cobro entraba en la caja equivocada sin que nadie lo
   * viera (y con F92 encima podía tocar un cierre).
   */
  const dateTouched = useRef(false);
  const [printOpen, setPrintOpen] = useState(false);

  const payCurrency = methodCurrency(payMethod); // moneda del MÉTODO (lo que se guarda)
  const payIsBs = payCurrency === 'VES';
  const payIsPagoMovil = payMethod.includes('Móvil') || payMethod.includes('Movil');

  // Conversión de moneda del CAMPO (toggle): Bs entero, $ 2 decimales. Sin tasa no
  // hay conversión segura → devuelve el valor sin cambios (el Alert ámbar lo avisa).
  const convertTo = (value: number, to: 'USD' | 'VES'): number => convertAmount(value, payCur, to, tasaDelPago);

  // Cambiar la moneda del campo convierte el valor SIN cambiar su significado:
  // $5 → Bs. 3.744 al pasar a Bs.; Bs. 5.000 → $6.68 al pasar a $.
  const switchCur = (next: 'USD' | 'VES') => {
    if (next === payCur) return;
    curTouched.current = true;
    setPayAmount(convertTo(payAmount, next));
    setPayCur(next);
  };

  // Monto FINAL a guardar: SIEMPRE en la moneda del MÉTODO (el campo puede estar en $ o Bs.).
  const payAmountFinal = finalAmount(payAmount, payCur, payCurrency, tasaDelPago);

  // Chips de abono rápido en la moneda del CAMPO: $5/$10/$15/$20 o Bs. 5.000/10.000/15.000/20.000
  // ("5 mil", "10 mil" — lo que dice el cliente).
  const QUICK = quickAmounts(payCur);

  useEffect(() => {
    api.getPaymentMethods().then(setMethods).catch(() => {});
  }, []);

  // Monto sugerido (Todo el saldo) en la moneda del CAMPO: Bs → saldo × tasa BCV.
  const suggestAmount = useCallback(() => {
    if (!service) return 0;
    const saldo = service.amount - (service.paid_amount ?? 0);
    return suggestPaymentAmount(saldo, service.amount, payCur, tasaDelPago);
  }, [service, payCur, tasaDelPago]);

  // Cargar pagos + tasa al abrir con un servicio
  useEffect(() => {
    if (!open) {
      // Al CERRAR también se limpia: si queda el historial de la orden anterior, el efecto de F38 que
      // decide la moneda del campo lo leería en el primer render de la orden siguiente.
      setPayments([]);
      return;
    }
    if (!service) return;
    let alive = true;
    // Estado por orden: al abrir OTRA orden no puede quedar nada de la anterior (el historial
    // viejo se veía un instante y el saldo del banner mentía con los pagos de la orden previa).
    setPayments([]);
    api.getServicePayments(service.id).then(p => { if (alive) setPayments(p); }).catch(() => {});
    api.getActiveDay().then(d => {
      if (!alive) return;
      setTasaBcv(d?.tasa_bcv ?? 0);
      // F35: la fecha del abono arranca en la del TURNO ABIERTO (su caja es la que lo va a contar).
      setDiaTurno(d?.close_date ?? '');
      // F82 — PERO SI ESE TURNO ES DE OTRO DÍA, el default pasa a HOY: el cobro de hoy no puede
      // caer en la caja de ayer sin que el operario lo note. Con el default en hoy el guardado choca
      // con el portón y el aviso de arriba dice qué cerrar; el camino RETROACTIVO sigue existiendo
      // (elegir a propósito la fecha del turno abierto, con su aviso ámbar de a qué caja va).
      setFechaTurno(d?.close_date ?? null);
      const turno = shiftPending(d?.close_date ?? null, localDate());
      // …pero NUNCA le pisa la fecha que el operario ya eligió a mano (F92).
      if (!dateTouched.current) setPayDate(turno.stale ? localDate() : (d?.close_date ?? localDate()));
    }).catch(() => {});
    // Inicializar el form con el método del servicio (el toggle sigue la moneda del método)
    // F37 (revisión adversarial, H3): ?? '' NO atrapa el string vacío y una orden vieja con el método en blanco dejaba el selector SIN método (y el guardado habilitado): la fila nacía con método '' y la moneda que eligiera la UI. Se cae al método por defecto del local.
    setPayMethod(service.payment_method?.trim() || 'Divisas (USD Cash)');
    setPayCur(methodCurrency(service.payment_method));
    setPayFee(service.payment_method?.includes('Punto') ? DEFAULT_PUNTO_FEE : 0);
    setPayZelle('');
    setPayNotes('');
    setPayDate(localDate());
    setEditDateId(null);
    setPayError(null);
    payTouched.current = false;
    curTouched.current = false;
    dateTouched.current = false;
    return () => { alive = false; };
  }, [open, service]);

  // F38: el campo del monto arranca en la MONEDA EN QUE EL CLIENTE VIENE PAGANDO (si abonó en Bs.,
  // se le cobra en Bs. y el campo ya está en Bs.), no en la del formulario. Necesita el historial de
  // pagos (llega async), así que se corrige cuando llega — nunca pisa una elección manual del operario.
  //
  // OJO (revisión adversarial): el array `payments` NO puede ser el de otra orden. Los efectos corren
  // DESPUÉS del render, así que al abrir la orden B este efecto todavía veía el `payments` de la orden A
  // (el reset a [] ocurre en el mismo commit) y pisaba la moneda que acababa de dejar el efecto de
  // inicialización: la orden B, cobrada siempre por Pago Móvil, abría el campo en «$» — y el operario
  // escribía 5000 creyendo bolívares. Por eso se exige que los movimientos sean DE ESTA orden.
  const pagosDeEstaOrden = !!service && payments.length > 0 && payments[0].service_id === service.id;
  const cobroEn = pagosDeEstaOrden
    ? orderBalance(service?.amount ?? 0, service?.paid_amount ?? 0, payments, tasaBcv).cobroEn
    : null;
  useEffect(() => {
    if (!open || curTouched.current) return;
    if (!cobroEn) return; // sin cobros de ESTA orden no hay moneda de cobro: manda el método
    setPayCur(cobroEn);
  }, [open, cobroEn]);

  // Re-sugerir el monto cuando cambia el método, la moneda del campo, la tasa o se abre (solo si no se tocó a mano)
  useEffect(() => {
    if (open && !payTouched.current) setPayAmount(suggestAmount());
  }, [open, service, payMethod, payCur, tasaDelPago, suggestAmount]);

  // F92 — el estado de la caja del día ELEGIDO: se consulta al abrir y cada vez que cambia la fecha.
  useEffect(() => {
    if (!open) { setEstadoDia(null); return; }
    const fecha = payDate.slice(0, 10);
    if (!fecha) return;
    let alive = true;
    api.estadoDelDia(fecha).then(e => { if (alive) setEstadoDia(e); }).catch(() => { if (alive) setEstadoDia(null); });
    return () => { alive = false; };
  }, [open, payDate]);

  /** F92 — el texto que explica qué le va a pasar a la caja de ese día (lo lee el operario ANTES). */
  const textoDeCierre = (ajustes: AjusteCierre[]): string => ajustes.length === 0
    ? ''
    : ' · ' + ajustes.map(a => {
      const usd = a.diferencia_usd !== a.diferencia_usd_antes
        ? ` (Diferencia $: ${a.diferencia_usd_antes.toFixed(2)} → ${a.diferencia_usd.toFixed(2)})`
        : '';
      const bs = Math.abs(a.diferencia_bs - a.diferencia_bs_antes) > 0.005
        ? ` (Diferencia Bs.: ${a.diferencia_bs_antes.toFixed(2)} → ${a.diferencia_bs.toFixed(2)})`
        : '';
      return `El cierre del ${fechaLegible(a.fecha)} se actualizó${usd}${bs}`;
    }).join(' · ');

  const refresh = async () => {
    if (!service) return;
    const p = await api.getServicePayments(service.id);
    setPayments(p);
    onSaved?.();
  };

  const doAddPayment = async () => {
    // Anti doble-cobro: el atajo Ctrl+Enter no mira el `disabled` del botón, así que dos pulsaciones
    // rápidas (o un reintento después de un error de refresco) registraban DOS abonos iguales en la
    // caja. Con este corte, el segundo intento no hace nada.
    if (savingPay || !service || payAmount <= 0 || payAmountFinal <= 0) return;
    setSavingPay(true);
    setPayError(null);
    let ok = false;
    try {
      await api.addServicePayment(service.id, payAmountFinal, payMethod, payFee, payZelle, payCurrency, payNotes, payDate);
      ok = true;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPay(false);
    }
    if (!ok) return;
    // F92 — si el cobro cayó en un día ya CERRADO, su cierre se acaba de recalcular: se dice (el
    // operario tiene que saber que el arqueo de ESE día cambió, aunque el día esté cerrado).
    // F94 — y si ese día NO tenía caja, se le acaba de crear: se dice también, con el remedio para
    // contar el cajón de ese día (si no, la fila nueva aparecería en Cierres sin explicación).
    if (diaSinCaja && !esFechaDeHoy) {
      toast.success(`Cobro anotado en el ${fechaLegible(payDate.slice(0, 10))}: ese día no tenía caja y se le creó con el arqueo en 0 (sin contar). Reabrilo con ↺ en Libro Diario → Cierres para contarlo.`);
    } else if (estadoDia?.cerrado) {
      toast.success(`Cobro anotado en la caja del ${fechaLegible(estadoDia.fecha)} (ese día estaba cerrado: su cierre se actualizó con este cobro).`);
    }
    // El pago YA se guardó: si el refresco falla, el diálogo se cierra igual (antes quedaba abierto
    // con el monto cargado y el operario lo volvía a guardar «porque dio error»).
    onOpenChange(false);
    try {
      await refresh();
    } catch {
      toast.warning('El abono quedó guardado, pero no se pudo refrescar la lista. Actualizá la pantalla.');
    }
  };

  // F35/F92: corregir la fecha de un pago ya anotado. El día de destino puede estar ABIERTO o CERRADO:
  // si está cerrado, su cierre (y el del día de donde salió) se recalcula y se dice en el aviso.
  const doSaveDate = async (pid: number) => {
    if (!service || !editDate) return;
    setPayError(null);
    try {
      const ajustes = await api.updateServicePaymentDate(pid, editDate);
      setEditDateId(null);
      toast.success(`Pago movido al ${fechaLegible(editDate)}${textoDeCierre(ajustes ?? [])}`);
      await refresh();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : String(e));
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
  const totalAbonadoBs = payments.reduce((a, p) => a + (p.currency === 'VES' ? p.amount : 0), 0);
  // F38: el saldo se dice en la moneda en que se cobró y con su equivalencia del día (lo que el
  // cliente va a entregar). El $ sigue siendo la verdad contable y NO se revalúa.
  const saldoTexto = balanceLabel(orderBalance(service?.amount ?? 0, abonadoUsd, payments, tasaBcv));

  // Valor del chip "Todo el saldo" en la moneda del CAMPO (Bs → saldo × tasa BCV del día del pago)
  const saldoChip = saldoChipValue(saldoUsd, payCur, tasaDelPago);

  // Comisión del Punto de Venta (las mismas cuentas que usa el asistente de cierre)
  const punto = puntoCommission(payAmountFinal, payFee);

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
        {/* F94 — acá YA NO va el cartel bloqueante de la caja vieja (F82): el abono entra en la caja del
            día elegido y, si no la tiene, el sistema se la crea. El aviso ámbar del campo de fecha lo
            explica sin frenar el guardado; el cartel de la caja vieja sigue en Dashboard/Ventas/Servicio
            Técnico, que es donde bloquea FACTURAR (ventas y órdenes). */}
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
          <div className="text-sm flex flex-col gap-1 rounded-md bg-muted/60 px-3 py-2">
            <p>Total: <strong>${(service?.amount ?? 0).toFixed(2)}</strong></p>
            {isFinalized(service?.status) ? (
              <p className="text-muted-foreground" data-field="saldo">Orden {service?.status === 'Devuelto' ? 'devuelta' : 'cancelada'} — no acepta más pagos.</p>
            ) : saldoUsd < -0.005 ? (
              <p data-field="saldo">Excedente: <strong className="text-warning">{balanceLabel(orderBalance(service?.amount ?? 0, abonadoUsd, payments, tasaBcv))}</strong> (se cobró más que el monto del servicio)</p>
            ) : payments.length === 0 ? (
              <p data-field="saldo">Por pagar: <strong className="text-amber-600">{saldoTexto}</strong></p>
            ) : saldoUsd > 0.005 ? (
              <p data-field="saldo">Saldo pendiente: <strong className="text-danger">{saldoTexto}</strong></p>
            ) : (
              <p data-field="saldo">Saldo: <strong className="text-success">Cancelado</strong></p>
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
              {(QUICK).map(v => (
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
            {/* F92 — SE ACEPTAN 2 DECIMALES EN LAS DOS MONEDAS: antes el campo en Bs. usaba `step=1` y
                el monto se redondeaba a bolívares enteros (hasta 0,99 Bs. por cobro que después no
                cuadraban en la caja). El monto que se guarda es el de la MONEDA DEL MÉTODO, con centavos. */}
            <Input type="number" step={0.01} min={0.01} value={payAmount} data-field="pay-monto"
              onChange={e => { payTouched.current = true; setPayAmount(round2(Number(e.target.value))); }} />
            {payAmount > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Se va a guardar <strong data-field="pay-final">{payIsBs
                  ? `Bs. ${payAmountFinal.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `$${payAmountFinal.toFixed(2)}`}</strong> ({payIsBs ? 'bolívares' : 'dólares'}, moneda del método).
              </p>
            )}
            {tasaDelPago <= 0 && (payIsBs || payCur === 'VES') && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800">
                  El día no tiene tasa BCV (está en 0) — las conversiones Bs/$ dan 0. Actualiza la tasa en
                  <strong> Libro Diario → banner verde "Día ABIERTO" → Actualizar día</strong> para
                  poder cobrar en bolívares.
                </AlertDescription>
              </Alert>
            )}
            {payCur === 'VES' && tasaDelPago > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ ${(payAmount / tasaDelPago).toFixed(2)} (tasa BCV {tasaDelPago.toFixed(2)})
              </p>
            )}
            {payCur === 'USD' && tasaDelPago > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ Bs. {round2(payAmount * tasaDelPago).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (tasa BCV {tasaDelPago.toFixed(2)})
              </p>
            )}
            {payIsBs && payCur === 'USD' && tasaDelPago > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Se abonarán <strong>Bs. {payAmountFinal.toLocaleString('es-VE')}</strong> (tasa BCV {tasaDelPago.toFixed(2)})
              </p>
            )}
            {!payIsBs && payCur === 'VES' && tasaDelPago > 0 && payAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Se abonarán <strong>${payAmountFinal.toFixed(2)}</strong> (tasa BCV {tasaDelPago.toFixed(2)})
              </p>
            )}
            {payIsBs && saldoUsd > 0.005 && tasaDelPago > 0 && (
              <p className="text-xs text-muted-foreground">
                Saldo pendiente ≈ <strong>Bs. {round2(saldoUsd * tasaDelPago).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (tasa BCV {tasaDelPago.toFixed(2)})
              </p>
            )}
            {/* F38: cobrar MÁS que el saldo deja un excedente a favor del cliente. No se bloquea (puede
                ser legítimo: el cliente redondea o adelanta plata), pero el operario tiene que verlo.
                Cubre también la orden YA SALDADA (saldo ≤ 0): ahí cualquier monto es excedente, y antes
                no avisaba nada — se registraba un cobro de más sin que nadie lo viera. */}
            {!isFinalized(service?.status) && payAmount > 0
              && convertAmount(payAmount, payCur, 'USD', tasaDelPago) > saldoUsd + 0.005 && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning" data-field="aviso-excedente">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800">
                  {saldoUsd > 0.005
                    ? <>Se está cobrando más que el saldo: quedaría a favor del cliente{' '}</>
                    : <>Esta orden ya está cancelada: todo lo que cobres queda a favor del cliente{' '}</>}
                  <strong>${(convertAmount(payAmount, payCur, 'USD', tasaDelPago) - Math.max(0, saldoUsd)).toFixed(2)}</strong>.
                  Revisá el monto si fue un error de tipeo.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Método de Pago</label>
            {/* F31: los 3 métodos que más se usan a un toque; el resto en «Otros métodos…» */}
            <PaymentMethodPicker
              methods={methods}
              value={payMethod}
              onChange={v => {
                const nextCur = methodCurrency(v);
                setPayMethod(v);
                setPayFee(v.includes('Punto') ? DEFAULT_PUNTO_FEE : 0);
                // El toggle sigue al método y el valor se CONVIERTE sin cambiar de
                // significado (7000 Bs → $9.35 si cambias a un método en dólares).
                // SIN TASA no hay conversión posible: se deja el campo como está (no se borra lo
                // tecleado ni se le cambia el rótulo) y Guardar queda bloqueado porque el monto
                // final en la moneda del método da 0.
                if (nextCur !== payCur && tasaDelPago > 0) {
                  setPayAmount(convertTo(payAmount, nextCur));
                  setPayCur(nextCur);
                }
              }}
            />
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
                Comisión: {currencySymbol(payCurrency)}{punto.commission.toFixed(2)} · Neto: {currencySymbol(payCurrency)}{punto.net.toFixed(2)}
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
          {/* F35 — FECHA DEL PAGO: en qué caja entra esta plata. F92: un día CERRADO ya no bloquea —
              su cierre se actualiza y acá se dice ANTES de guardar. */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Fecha del pago</label>
            <Input type="date" value={payDate} max={localDate()} data-field="pay-fecha"
              data-estado-dia={estadoDia ? (estadoDia.existe ? (estadoDia.cerrado ? 'cerrado' : 'abierto') : 'sin-caja') : ''}
              onChange={e => { dateTouched.current = true; setPayDate(e.target.value); }} />
            {diaTurno && payDate === diaTurno && diaTurno !== localDate() && (
              <p className="text-[11px] text-muted-foreground">
                El turno abierto es el <strong>{diaTurno.split('-').reverse().join('/')}</strong>: el abono entra en esa caja.
              </p>
            )}
            {diaSinCaja && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800" data-field="aviso-dia-sin-caja">
                  {esFechaDeHoy ? 'Hoy' : `El ${fechaLegible(payDate.slice(0, 10))}`} no tiene caja abierta en el
                  sistema: al guardar, el abono entra en <strong>{esFechaDeHoy ? 'el día de hoy' : 'ese día'}</strong> y
                  se le crea su caja. El cajón de ese día queda <strong>sin contar</strong> (arqueo en 0), así que en
                  Libro Diario → Cierres vas a verlo con su diferencia: reabrilo con ↺ para contar y volver a cerrarlo.
                </AlertDescription>
              </Alert>
            )}
            {cajaViejaAbierta && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800" data-field="aviso-turno-viejo-pago">
                  La caja del <strong>{fechaLegible(turnoViejo.fechaTurno ?? '')}</strong> sigue ABIERTA: este abono es
                  de HOY y <strong>NO entra ahí</strong> (entra en la caja de hoy). El cartel de la caja vieja sigue
                  valiendo para <strong>facturar ventas y órdenes</strong>, no para anotar un cobro.
                </AlertDescription>
              </Alert>
            )}
            {estadoDia?.cerrado && payDate !== diaTurno && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800" data-field="aviso-dia-cerrado">
                  El <strong>{fechaLegible(payDate.slice(0, 10))}</strong> ya está <strong>cerrado</strong>: el cobro entra en
                  esa caja y su <strong>cierre se actualiza</strong> (el arqueo que contaste no se toca; solo cambia lo que el
                  sistema esperaba). Es lo que se usa cuando el cliente avisa que pagó ese día.
                </AlertDescription>
              </Alert>
            )}
            {payDate !== (diaTurno || localDate()) && !estadoDia?.cerrado && estadoDia?.existe && !cajaViejaAbierta && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800">
                  Este abono entra en la <strong>caja del {payDate.split('-').reverse().join('/')}</strong>, no en la de hoy
                  (para eso se usa cuando el cliente pagó ese día y lo avisó después).
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Notas (opcional)</label>
            <Input value={payNotes} onChange={e => setPayNotes(e.target.value)}
              placeholder="Ej: Abono inicial / Saldo al entregar..." />
          </div>
          {payments.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Pagos registrados</p>
              <p className="text-[11px] text-muted-foreground">
                Tocá la fecha de un pago para corregirla (si el cliente pagó otro día).
              </p>
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
                        <TableCell className="text-xs">
                          {/* Una DEVOLUCIÓN no ofrece corregir fecha: mover una devolución cambiaría
                              la caja de DOS días (donde salió la plata y donde se anotó). */}
                          {editDateId === p.id ? (
                            <div className="flex items-center gap-1">
                              <Input type="date" className="h-7 w-32 text-xs" value={editDate} max={localDate()}
                                data-field="pago-fecha-edit" onChange={e => setEditDate(e.target.value)} />
                              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => doSaveDate(p.id)}>OK</Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                                onClick={() => setEditDateId(null)}>×</Button>
                            </div>
                          ) : isRefund(p) ? (
                            <span>{p.payment_date ? p.payment_date.slice(0, 10).split('-').reverse().join('/') : '-'}</span>
                          ) : (
                            <button type="button" className="text-left underline-offset-2 hover:underline"
                              title="Corregir la fecha de este pago (¿lo pagó otro día?)"
                              data-action="editar-fecha-pago"
                              onClick={() => { setEditDateId(p.id); setEditDate((p.payment_date ?? '').slice(0, 10) || localDate()); }}>
                              {p.payment_date ? p.payment_date.slice(0, 10).split('-').reverse().join('/') : '-'}
                            </button>
                          )}
                        </TableCell>
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
          {/* F94 — el aviso de la caja vieja ya no explica un botón apagado (no hay botón apagado):
              dice a dónde va la plata y qué sigue bloqueando de verdad (facturar ventas y órdenes). */}
          {cajaViejaAbierta && (
            <p className="text-xs text-amber-700" data-field="aviso-turno-viejo-pago">
              La caja del <strong>{fechaLegible(turnoViejo.fechaTurno)}</strong> sigue abierta, pero este cobro de hoy
              entra en la <strong>caja de hoy</strong> (no en la vieja). Para <strong>facturar</strong> ventas y órdenes
              sí hay que cerrar esa caja: {turnoViejoTexto(turnoViejo)}
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {service && (
            <Button variant="outline" onClick={() => setPrintOpen(true)} title="Imprimir orden de servicio del equipo">
              <Printer className="size-4" /> Imprimir orden
            </Button>
          )}
          <Button onClick={doAddPayment} title="Ctrl+Enter" disabled={savingPay || payAmount <= 0 || payAmountFinal <= 0 || (payIsBs && tasaDelPago <= 0) || isFinalized(service?.status)}>
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
