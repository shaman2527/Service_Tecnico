import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Banknote, Check, CheckCircle2, Loader2, Printer, Smartphone, Zap,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '@/db';
import type { ScreenCandidate, Service } from '@/types';
import { cn, currencySymbol, methodCurrency, parseServiceTypes, shortMethodLabel } from '@/lib/utils';
// Regla del proyecto (AGENTS.md): entregar una pantalla AGOTADA exige confirmación explícita
// — `screenOk` es la MISMA función que usa el formulario de servicio, no una copia.
import { screenOk } from '@/lib/screen-rules';
import {
  convertAmount, finalAmount, quickAmounts, saldoChipValue, puntoCommission, DEFAULT_PUNTO_FEE, type PayCur,
} from '@/lib/payment-math';
// Actualizar la orden conservando TODOS sus campos (una sola forma de hacerlo en la UI).
import { updateOrderKeepingFields } from '@/lib/service-update';
// F31: selector de método de pago compartido (3 favoritos a un toque + el resto en un desplegable)
import { PaymentMethodPicker } from './PaymentMethodPicker';

// F30 — ASISTENTE DE CIERRE: entregar un equipo rápido y sin pensar.
//
// El taller NO recorre el formulario completo para cerrar una orden. El asistente mira la orden,
// dice qué falta y pide SOLO eso:
//   1. ¿Qué pantalla se instaló?      → lista con el STOCK de cada una (solo si el trabajo la pide)
//   2. Cobro                          → campo con $ / Bs., chips rápidos y «Todo el saldo»
//   3. Cerrar y entregar              → UN botón: registra el cobro y pasa a Entregado (descuenta stock)
// Si el cliente se lleva el equipo debiendo, el motivo es OBLIGATORIO (queda escrito en la orden).
// Toda la aritmética del dinero viene de `lib/payment-math` (la misma que usa Pago / Abono).
// Ctrl+Enter cierra, Escape sale.

const esFinal = (status?: string | null) =>
  ['Entregado', 'Cancelado', 'Devuelto', 'Cancelado / Devuelto'].includes(status ?? '');

export default function CierreServiceDialog({ service, open, onOpenChange, onSaved, onPrint, dayOpen }: {
  service: Service | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  /** abre el recibo de esa orden (lo maneja Services.tsx) */
  onPrint?: (s: Service) => void;
  dayOpen?: boolean | null;
}) {
  const [svc, setSvc] = useState<Service | null>(service);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El cobro YA quedó registrado y falló el cierre: un reintento NO debe cobrar otra vez.
  const [pagoHecho, setPagoHecho] = useState(false);
  const [listo, setListo] = useState(false);
  const [candidatos, setCandidatos] = useState<ScreenCandidate[]>([]);
  const [cargandoPantallas, setCargandoPantallas] = useState(false);
  const [errorPantallas, setErrorPantallas] = useState<string | null>(null);
  const [screenId, setScreenId] = useState<number | null>(null);
  const [screenConfirm, setScreenConfirm] = useState(false);
  const [imprimir, setImprimir] = useState(true);

  // cobro
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [tasaBcv, setTasaBcv] = useState(0);
  const [payMethod, setPayMethod] = useState('Divisas (USD Cash)');
  const [payAmount, setPayAmount] = useState(0);
  const [payCur, setPayCur] = useState<PayCur>('USD');
  const [payFee, setPayFee] = useState(0);
  const [payZelle, setPayZelle] = useState('');
  const [motivoSaldo, setMotivoSaldo] = useState('');

  useEffect(() => {
    setSvc(service);
    setScreenId(service?.screen_product_id ?? null);
    setScreenConfirm(false);
    setPayMethod(service?.payment_method ?? 'Divisas (USD Cash)');
    setPayCur(methodCurrency(service?.payment_method ?? 'Divisas (USD Cash)'));
    setPayAmount(0);
    // Si la orden ya venía con un método del Punto, la comisión arranca en el valor por defecto
    // (antes quedaba en 0 y el neto del Punto salía sin comisión → descuadre al liquidar)
    setPayFee((service?.payment_method ?? '').includes('Punto') ? DEFAULT_PUNTO_FEE : 0);
    setPayZelle('');
    setMotivoSaldo('');
    setListo(false);
    setError(null);
    setPagoHecho(false);
    setImprimir(true);
  }, [service]);

  // datos frescos de la orden (el saldo puede haber cambiado con un abono) + métodos + tasa
  useEffect(() => {
    if (!open || !service) return;
    let alive = true;
    api.getService(service.id).then(s => { if (alive && s) setSvc(s); }).catch(() => {});
    api.getPaymentMethods().then(m => { if (alive) setMethods(m); }).catch(() => {});
    api.getActiveDay().then(d => { if (alive) setTasaBcv(d?.tasa_bcv ?? 0); }).catch(() => {});
    return () => { alive = false; };
  }, [open, service]);

  const trabajos = useMemo(() => parseServiceTypes(svc ?? ({} as Service)), [svc]);
  const necesitaPantalla = trabajos.includes('Cambio pantalla');
  const yaFinal = esFinal(svc?.status);
  const saldo = Math.max(0, (svc?.amount ?? 0) - (svc?.paid_amount ?? 0));
  const tieneSaldo = saldo > 0.005;

  useEffect(() => {
    if (!open || !necesitaPantalla || !svc?.model) { setCandidatos([]); return; }
    let alive = true;
    setCargandoPantallas(true);
    setErrorPantallas(null);
    api.findCompatibleProducts(svc.model, null, 40)
      .then(r => { if (alive) setCandidatos(r.filter(c => c.product.category_id === 1)); })
      .catch(e => {
        // NO se traga el error: si la consulta falla, el asistente no puede fingir que el modelo
        // no necesita pantalla (cerraría con screen_product_id null y el stock iría a otro bin)
        if (alive) { setCandidatos([]); setErrorPantallas(e instanceof Error ? e.message : String(e)); }
      })
      .finally(() => { if (alive) setCargandoPantallas(false); });
    return () => { alive = false; };
  }, [open, necesitaPantalla, svc?.model]);

  // ---- dinero (mismas cuentas que Pago / Abono, de lib/payment-math) ----
  const payCurrency = methodCurrency(payMethod);       // lo que se GUARDA
  const payIsBs = payCurrency === 'VES';
  const payIsPunto = payMethod.includes('Punto');
  const payIsZelle = payMethod.includes('Zelle');
  const payAmountFinal = finalAmount(payAmount, payCur, payCurrency, tasaBcv);
  const pagoUsd = payIsBs ? (tasaBcv > 0 ? payAmountFinal / tasaBcv : 0) : payAmountFinal;
  const saldoDespues = Math.max(0, saldo - pagoUsd);
  const quedaSaldo = saldoDespues > 0.005;
  const chips = quickAmounts(payCur);
  const saldoChip = saldoChipValue(saldo, payCur, tasaBcv);
  const punto = puntoCommission(payAmountFinal, payFee);

  const cambiarMoneda = (next: PayCur) => {
    if (next === payCur) return;
    setPayAmount(convertAmount(payAmount, payCur, next, tasaBcv));
    setPayCur(next);
  };

  const elegida = candidatos.find(c => c.product.id === screenId) ?? null;
  const pantallaPendiente = necesitaPantalla && candidatos.length > 0 && screenId == null;
  const elegidaAgotada = elegida != null && !elegida.in_stock;
  // La pantalla agotada no bloquea, pero exige confirmación (el inventario queda como faltante).
  const pantallaOk = screenOk(trabajos, screenId, candidatos, screenConfirm, 'Entregado');
  const faltaConfirmarAgotada = !pantallaOk && elegidaAgotada;
  const faltaMotivo = tieneSaldo && saldoDespues > 0.005 && motivoSaldo.trim().length < 3;
  // GATES (los mismos que Pago / Abono, no una copia simplificada):
  //  · con un monto escrito, el monto FINAL tiene que ser > 0 — si no, el cobro se perdería
  //    en silencio (p.ej. campo en Bs. con un método en $ y la tasa del día en 0);
  //  · con el día CERRADO no se puede cobrar (el backend lo rechaza igual, pero no se avisa
  //    después de apretar el botón);
  //  · un método en bolívares exige tasa BCV.
  const cobroImposible = payAmount > 0 && payAmountFinal <= 0;
  // «Sin candidatas» NO es lo mismo que «no hace falta pantalla»: mientras carga, o si la consulta
  // falló, o si el modelo realmente no tiene pantallas, el cierre con screen null se iría al
  // matching legacy del backend y descontaría OTRO bin. Se avisa y no se cierra solo por eso.
  const sinPantallas = necesitaPantalla && !cargandoPantallas && candidatos.length === 0 && screenId == null;
  const puedeCerrar = pantallaOk && !faltaMotivo && !cobroImposible && !cargandoPantallas
    && (payAmount <= 0 || dayOpen !== false)
    && (tasaBcv > 0 || !payIsBs || payAmount <= 0);

  const faltantes: string[] = [];
  if (pantallaPendiente) faltantes.push('elegir la pantalla instalada');
  else if (faltaConfirmarAgotada) faltantes.push('confirmar que la pantalla agotada se entregó igual');
  if (sinPantallas) faltantes.push('revisar la pantalla (el modelo no tiene pantallas en el catálogo)');
  if (tieneSaldo) faltantes.push(`cobrar el saldo (${currencySymbol('USD')}${saldo.toFixed(2)})`);

  const cerrar = async () => {
    if (!svc) return;
    setError(null);
    setBusy(true);
    // Si un intento anterior ya cobró y falló el cierre, NO se vuelve a cobrar:
    // el reintento solo cierra la orden (si no, el cliente pagaría dos veces).
    const faltaCobrar = payAmountFinal > 0 && !yaFinal && !pagoHecho;
    // OJO: `pagoHecho` se marca SOLO si el cobro se guardó DE VERDAD. Antes se marcaba con la
    // INTENCIÓN (`faltaCobrar`): si `addServicePayment` era rechazado (IPC caído, día cerrado
    // creído abierto por el fail-open de `getActiveDay`), el diálogo anunciaba «el cobro quedó
    // registrado», el botón pasaba a «Reintentar cierre» —que ya no cobra— y el equipo salía
    // SIN COBRAR con la UI afirmando lo contrario.
    let cobroOk = false;
    try {
      // 1) el cobro (si el operario puso un monto) — misma cuenta que Pago / Abono.
      //    Tiene su PROPIO catch: si el cobro falla, no se entrega y se dice la verdad.
      if (faltaCobrar) {
        try {
          await api.addServicePayment(svc.id, payAmountFinal, payMethod, payFee, payZelle, payCurrency, 'Cobro al entregar');
          cobroOk = true;
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
        setPagoHecho(true);
      }
      // 2) la entrega: estado Entregado (el backend pone la fecha y descuenta el stock).
      //    Pasa por el helper compartido para no repetir a mano los 23 campos de la orden.
      //    El motivo del saldo SOLO se anexa si de verdad quedó saldo y hay motivo escrito
      //    (antes, en la rama «ya entregada», se anexaba un motivo vacío y se repetía en cada cierre).
      const anexo = quedaSaldo && motivoSaldo.trim().length >= 3
        ? `Entregado con saldo (${currencySymbol('USD')}${saldoDespues.toFixed(2)}): ${motivoSaldo.trim()}`
        : '';
      const yaAnotado = anexo !== '' && (svc.observations ?? '').includes(anexo);
      const observaciones = anexo && !yaAnotado
        ? `${svc.observations ? svc.observations.trim() + ' · ' : ''}${anexo}`
        : (svc.observations ?? '');
      await updateOrderKeepingFields(svc, {
        status: 'Entregado',
        screenProductId: screenId ?? svc.screen_product_id ?? null,
        observations: observaciones,
        ...(faltaCobrar ? { paymentMethod: payMethod, currency: payCurrency } : {}),
      });
      setPagoHecho(false);
      setListo(true);
      onSaved();
      if (imprimir && onPrint) {
        const actual = await api.getService(svc.id).catch(() => null);
        if (actual) { onOpenChange(false); onPrint(actual); }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (cobroOk) {
        // El cobro quedó: se relee la orden para que el saldo mostrado sea el real.
        setPagoHecho(true);
        api.getService(svc.id).then(s => { if (s) setSvc(s); }).catch(() => {});
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!service || !svc) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] flex flex-col overflow-hidden sm:max-w-2xl"
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && puedeCerrar && !busy && !listo) void cerrar(); }}
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-amber-500" /> Cerrar {svc.order_num}
            <span className="text-sm font-normal text-muted-foreground">({yaFinal ? 'ya entregada' : 'entrega y cobro en un paso'})</span>
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{svc.client ?? 'Sin cliente'}</span>
            <span>·</span>
            <span>{svc.model ?? 'sin modelo'}</span>
            <span>·</span>
            <span>{trabajos.length > 0 ? trabajos.join(' + ') : svc.service_type ?? ''}</span>
            {svc.technician && <span>· {svc.technician}</span>}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {/* qué está y qué falta (P1: los faltantes se ven ANTES, no al guardar) */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-600"><Check className="size-3.5" /> Datos de la orden</span>
            <span className={cn('flex items-center gap-1.5', pantallaPendiente || sinPantallas ? 'text-warning' : 'text-emerald-600')}>
              {pantallaPendiente || sinPantallas ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />} Pantalla
            </span>
            <span className={cn('flex items-center gap-1.5', tieneSaldo ? 'text-warning' : 'text-emerald-600')}>
              {tieneSaldo ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />} Cobro
            </span>
            {faltantes.length > 0 && <span className="text-muted-foreground">Falta: {faltantes.join(' y ')}</span>}
            <span className="ml-auto text-muted-foreground">Total {currencySymbol('USD')}{(svc.amount ?? 0).toFixed(2)} · abonado {currencySymbol('USD')}{(svc.paid_amount ?? 0).toFixed(2)}</span>
          </div>

          {error && (
            <Alert variant={pagoHecho ? 'default' : 'destructive'}
              className={pagoHecho ? 'border-amber-500/40 bg-amber-500/10' : undefined}>
              <AlertTriangle className="size-4" />
              <AlertTitle>
                {pagoHecho ? 'El cobro quedó registrado, pero la orden no se cerró' : 'No se pudo cerrar'}
              </AlertTitle>
              <AlertDescription className="text-xs">
                {error}
                {pagoHecho && <> El pago SÍ está guardado en el libro del día: tocá <strong>Reintentar cierre</strong> (no se cobra dos veces).</>}
              </AlertDescription>
            </Alert>
          )}

          {listo && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Orden cerrada</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
                <span>{svc.order_num} quedó <strong>Entregado</strong> con la fecha de hoy y el stock descontado.</span>
                {onPrint && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]"
                    onClick={async () => {
                      const actual = await api.getService(svc.id).catch(() => null);
                      onOpenChange(false);
                      if (actual) onPrint(actual);
                    }}>
                    <Printer data-icon="inline-start" className="size-3" /> Imprimir la orden
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* si el modelo no tiene pantallas (o la consulta falló), se AVISA: cerrar así dejaría que
              el backend descuente por su cuenta (matching legacy) otra ficha en silencio */}
          {!listo && sinPantallas && !errorPantallas && (
            <Alert className="border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs">Este modelo no tiene pantallas en el catálogo</AlertTitle>
              <AlertDescription className="text-xs">
                Al cerrar, el descuento de stock va por el nombre del modelo (puede caer en otra ficha).
                Revisá cómo está escrito el modelo o cargá la pantalla en Inventario → Productos.
              </AlertDescription>
            </Alert>
          )}
          {!listo && errorPantallas && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs">No se pudieron buscar las pantallas del modelo</AlertTitle>
              <AlertDescription className="text-xs">
                {errorPantallas} — probá de nuevo antes de cerrar (o revisá el catálogo).
              </AlertDescription>
            </Alert>
          )}

          {/* 1) la pantalla que se instaló */}
          {!listo && necesitaPantalla && candidatos.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Smartphone className="size-3.5 text-muted-foreground" /> ¿Qué pantalla se instaló?
              </span>
              {cargandoPantallas ? (
                <div className="flex flex-col gap-1.5">
                  {[0, 1, 2].map(i => <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />)}
                </div>
              ) : (
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {candidatos.map(({ product: p, in_stock, match_quality }) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setScreenId(p.id)}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs',
                        p.id === screenId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {p.id === screenId && <Check className="size-3.5 text-primary" />}
                        {p.name} <span className="text-muted-foreground">({match_quality})</span>
                      </span>
                      <Badge variant={in_stock ? 'default' : 'outline'}
                        className={cn('text-[10px] tabular-nums', in_stock ? 'bg-success text-white' : 'text-warning border-warning/50')}>
                        {in_stock ? `stock ${p.stock}` : 'agotada'}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
              {elegidaAgotada && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] text-warning">
                    <AlertTriangle className="size-3" /> Esa pantalla no tiene stock: al entregar el stock queda en negativo (faltante).
                  </span>
                  <button
                    type="button"
                    onClick={() => setScreenConfirm(v => !v)}
                    className={cn(
                      'self-start rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                      screenConfirm
                        ? 'border-destructive bg-destructive text-white'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    {screenConfirm ? '✓ Confirmado: se entregó sin stock registrado' : 'Confirmo que se entregó sin stock registrado'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 2) el cobro (mismas cuentas que Pago / Abono) */}
          {!listo && !yaFinal && (
            <div className={cn('flex flex-col gap-2 rounded-lg border p-3', tieneSaldo ? 'border-warning/40 bg-warning/5' : 'border-border')}>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Banknote className={cn('size-3.5', tieneSaldo ? 'text-warning' : 'text-muted-foreground')} />
                {tieneSaldo
                  ? <>Falta cobrar <strong>{currencySymbol('USD')}{saldo.toFixed(2)}</strong></>
                  : <>Cobrado ({shortMethodLabel(svc.payment_method)}) — podés registrar otro cobro si hace falta</>}
              </span>

              {dayOpen === false && (
                <span className="text-[11px] text-destructive">
                  El día está cerrado: para cobrar abrí el día en Libro Diario (podés entregar con saldo y motivo).
                </span>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-muted-foreground">Monto</label>
                  <div className="flex items-center gap-2">
                    <ToggleGroup type="single" value={payCur} onValueChange={v => v && cambiarMoneda(v as PayCur)} className="h-8">
                      <ToggleGroupItem value="USD" className="h-7 px-2.5 text-xs">$</ToggleGroupItem>
                      <ToggleGroupItem value="VES" className="h-7 px-2.5 text-xs">Bs.</ToggleGroupItem>
                    </ToggleGroup>
                    <Input
                      className="h-8 w-32 tabular-nums"
                      inputMode="decimal"
                      aria-label="Monto a cobrar"
                      value={payAmount === 0 ? '' : String(payAmount)}
                      placeholder="0"
                      onChange={e => setPayAmount(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                    />
                    {tieneSaldo && (
                      <Button type="button" size="sm" variant="outline" className="h-8 text-[11px]"
                        onClick={() => setPayAmount(saldoChip)}>
                        Todo el saldo
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {chips.map(v => (
                      <Button key={v} type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px] tabular-nums"
                        onClick={() => setPayAmount(v)}>
                        {payCur === 'VES' ? `Bs. ${v.toLocaleString('es-VE')}` : `$${v}`}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-muted-foreground">Método</label>
                  {/* F31: los 3 métodos que más se usan a un toque; el resto en «Otros métodos…» */}
                  <PaymentMethodPicker
                    methods={methods}
                    value={payMethod}
                    size="sm"
                    onChange={v => {
                      const nextCur = methodCurrency(v);
                      setPayMethod(v);
                      // Cambiar de método CONVIERTE el monto (no cambia su significado): campo en
                      // Bs. 7000 → método en dólares = $9.35. SIN TASA no hay conversión posible:
                      // se deja el campo COMO ESTÁ (ni se borra lo tecleado ni se le cambia el
                      // rótulo, que haría que Bs. 7000 se registraran como $7000) y el gate
                      // `cobroImposible` bloquea con la explicación.
                      if (nextCur !== payCur && tasaBcv > 0) {
                        setPayAmount(convertAmount(payAmount, payCur, nextCur, tasaBcv));
                        setPayCur(nextCur);
                      }
                      setPayFee(v.includes('Punto') ? DEFAULT_PUNTO_FEE : 0);
                    }}
                  />
                </div>

                {payIsPunto && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Comisión %</label>
                    <Input className="h-8 w-20 tabular-nums" inputMode="decimal" value={payFee}
                      aria-label="Comisión del Punto"
                      onChange={e => setPayFee(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
                  </div>
                )}

                {payIsZelle && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Referencia Zelle</label>
                    <Input className="h-8 w-40" value={payZelle} aria-label="Referencia Zelle"
                      onChange={e => setPayZelle(e.target.value)} />
                  </div>
                )}
              </div>

              {payAmountFinal > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  Se registra {payIsBs ? `Bs. ${payAmountFinal.toLocaleString('es-VE')}` : `$${payAmountFinal.toFixed(2)}`}
                  {payIsBs && tasaBcv > 0 && <> (≈ ${pagoUsd.toFixed(2)} a tasa {tasaBcv.toFixed(2)})</>}
                  {payIsPunto && <> · comisión {currencySymbol(payCurrency)}{punto.commission.toFixed(2)} → neto {currencySymbol(payCurrency)}{punto.net.toFixed(2)}</>}
                  {quedaSaldo ? <> · queda un saldo de ${saldoDespues.toFixed(2)}</> : <> · queda <strong>cancelada</strong></>}
                </span>
              )}
              {payIsBs && tasaBcv <= 0 && payAmount > 0 && (
                <span className="text-[11px] text-destructive">
                  No hay tasa BCV del día: para cobrar en Bs. abrí/actualizá el día en Libro Diario.
                </span>
              )}

              {cobroImposible && (
                <span className="text-[11px] text-destructive">
                  {tasaBcv <= 0
                    ? <>El día no tiene tasa BCV: no se puede convertir Bs. ↔ $. Actualizala en <strong>Libro Diario → «Día ABIERTO» → Actualizar día</strong>, o escribí el monto en {payCurrency === 'VES' ? 'bolívares' : 'dólares'} (que es la moneda del método elegido).</>
                    : <>El monto escrito ({payCur === 'VES' ? `Bs. ${payAmount.toLocaleString('es-VE')}` : `$${payAmount}`}) no se puede convertir a {payCurrency === 'VES' ? 'bolívares' : 'dólares'} con la tasa de hoy: revisá el monto o elegí {payCur === 'VES' ? 'un método en bolívares' : 'un método en dólares'}.</>}
                </span>
              )}

              {quedaSaldo && (
                <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
                  <label className="text-[11px] font-medium text-foreground">
                    Motivo por el que se lleva el equipo debiendo (obligatorio)
                  </label>
                  <Input
                    className="h-8"
                    placeholder="Ej. cliente conocido, deja el vuelto para mañana, acordó pagar el viernes…"
                    aria-label="Motivo del saldo pendiente"
                    value={motivoSaldo}
                    onChange={e => setMotivoSaldo(e.target.value)}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Queda escrito en la orden: así el saldo no aparece «de la nada» en Cuentas por cobrar.
                  </span>
                </div>
              )}
            </div>
          )}

          {!listo && !tieneSaldo && !pantallaPendiente && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Todo listo para cerrar</AlertTitle>
              <AlertDescription className="text-xs">
                Está cobrada{necesitaPantalla && screenId != null ? ' y con la pantalla elegida' : ''}. Al cerrar queda
                <strong> Entregado</strong> con la fecha de hoy y se descuenta el stock.
              </AlertDescription>
            </Alert>
          )}

          {!listo && (
            <label className="flex items-center gap-2 px-1 text-xs">
              <input type="checkbox" className="size-3.5" checked={imprimir} onChange={e => setImprimir(e.target.checked)} />
              <span className="text-muted-foreground">Imprimir la orden al cerrar</span>
            </label>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <span className="mr-auto hidden text-[11px] text-muted-foreground sm:block">
            {pagoHecho ? 'El cobro ya quedó registrado: reintentar NO vuelve a cobrar' : 'Ctrl+Enter cierra · Escape sale'}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {listo ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!listo && !yaFinal && (
            <Button onClick={cerrar} disabled={busy || !puedeCerrar}
              title={!puedeCerrar ? 'Falta resolver lo que pide el asistente' : 'Registra el cobro, entrega y descuenta el stock'}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Zap data-icon="inline-start" />}
              {pagoHecho ? 'Reintentar cierre'
                : quedaSaldo && pagoUsd <= 0 ? 'Entregar con saldo'
                  : 'Cobrar y entregar'}
            </Button>
          )}
          {!listo && yaFinal && (
            <Button onClick={cerrar} disabled={busy || !puedeCerrar}
              title={!puedeCerrar ? 'Falta elegir/confirmar la pantalla' : 'Actualiza la pantalla de una orden ya entregada'}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Zap data-icon="inline-start" />}
              Actualizar pantalla
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
