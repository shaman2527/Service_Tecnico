import { useMemo, useState } from 'react';
import { Camera, CheckCircle2, ChevronDown, ChevronRight, ImageOff, Printer, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, currencySymbol, shortMethodLabel } from '@/lib/utils';
import { payIntentLabel } from '@/lib/reminders';
import { photoOutIsCurrent } from '@/lib/service-guide';
// F38: el saldo se dice en la moneda del cobro (+ equivalencia del día): el panel también es mostrador.
import { orderBalance, balanceLabel } from '@/lib/order-balance';
import type { Service, ServicePayment } from '../types';

// F32 — «ENTREGADOS HOY»: la lista de los teléfonos que salieron HOY del taller.
//
// Pedido del usuario: *«cuando hace un registro ellos poder ver los tlf entregado hoy en servicios»*.
// Antes era imposible: el filtro de fechas iba por fecha de RECIBIDO, así que un equipo recibido la
// semana pasada y entregado hoy no aparecía en ningún lado. Acá se listan por fecha de ENTREGA
// (`date_out`), con lo que el dueño necesita mirar de un vistazo:
//   · la fecha en que salió (el backend guarda la fecha de entrega, no la hora), para quién y qué equipo,//   · cómo se pagó (o si quedó «paga al retirar»),
//   · si le tomaron la foto de SALIDA (política del local) y si se imprimió la orden,
//   · si quedó saldo pendiente.
//
// Es de SOLO LECTURA: abrir la orden o imprimir el comprobante se delega al padre.

export function EntregadosHoy({ services, paymentsMap, tasaDia = 0, onOpen, onPrint, onSeeAll, className }: {
  /** órdenes con fecha de entrega = HOY (las carga el padre: una sola consulta) */
  services: Service[];
  paymentsMap: Record<number, ServicePayment[]>;
  /** tasa del turno abierto: con ella se muestra la equivalencia en Bs. del saldo (F38) */
  tasaDia?: number;
  onOpen: (s: Service) => void;
  onPrint: (s: Service) => void;
  /** aplica el filtro «Entregados hoy» en la lista de abajo */
  onSeeAll: () => void;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(true);

  const resumen = useMemo(() => {
    const sinFoto = services.filter(s => !photoOutIsCurrent(s.photo_out_at, s.date_out)).length;
    const conSaldo = services.filter(s => (s.amount ?? 0) - (s.paid_amount ?? 0) > 0.005).length;
    const porCobrar = services.reduce((a, s) => a + Math.max(0, (s.amount ?? 0) - (s.paid_amount ?? 0)), 0);
    return { sinFoto, conSaldo, porCobrar };
  }, [services]);

  if (services.length === 0) return null;

  return (
    <Card className={cn('border-emerald-500/30 bg-emerald-500/5', className)} data-panel="entregados-hoy">
      <CardHeader className="px-4 pb-2 pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Teléfonos entregados hoy
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">{services.length}</span>
          </CardTitle>
          {resumen.sinFoto > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
              <ImageOff className="size-3.5" /> {resumen.sinFoto} sin foto de salida
            </span>
          )}
          {resumen.conSaldo > 0 && (
            <span className="text-[11px] font-medium text-danger">
              {resumen.conSaldo} con saldo · ${resumen.porCobrar.toFixed(2)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onSeeAll}>
              Ver en la lista
            </Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label={abierto ? 'Ocultar entregados de hoy' : 'Ver entregados de hoy'}
              onClick={() => setAbierto(v => !v)}>
              {abierto ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {abierto && (
        <CardContent className="px-4 pb-3 pt-0">
          <div className="flex flex-col divide-y divide-border/60">
            {services.map(s => {
              const saldo = (s.amount ?? 0) - (s.paid_amount ?? 0);
              const metodos = [...new Set((paymentsMap[s.id] ?? []).map(p => p.payment_method).filter(Boolean))]
                .map(m => shortMethodLabel(m as string));
              const acuerdo = payIntentLabel(s.pay_intent);
              const fotoOk = photoOutIsCurrent(s.photo_out_at, s.date_out);
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs" data-delivered-order={s.order_num}>
                  {/* `date_out` se guarda como FECHA (aaaa-mm-dd), sin hora: mostrar la hora daba
                      «--:--» siempre. Si algún día trae hora, se muestra; si no, la fecha corta. */}
                  <span className="w-14 shrink-0 font-mono font-bold tabular-nums text-muted-foreground">
                    {s.date_out ? (s.date_out.length > 10 ? s.date_out.slice(11, 16) : s.date_out.slice(5)) : '—'}
                  </span>
                  <span className="font-mono font-semibold">{s.order_num}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{s.client ?? '-'}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.model ?? '-'}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {/* `payment_method` del formulario es lo que se ESPERABA cobrar; si no hay
                        pagos reales, el panel NO lo muestra como si se hubiera cobrado así. */}
                    {metodos.length > 0 ? metodos.join(' + ') : (acuerdo ?? 'Sin pago')}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{currencySymbol('USD')}{(s.amount ?? 0).toFixed(2)}</span>
                  {saldo > 0.005 && (
                    <Badge variant="outline" className="shrink-0 border-danger/40 text-[10px] text-danger">
                      {/* F38: el saldo en la moneda del cobro (+ equivalencia), igual que la tarjeta. */}
                      Falta {balanceLabel(orderBalance(s.amount ?? 0, s.paid_amount ?? 0, paymentsMap[s.id], tasaDia))}
                    </Badge>
                  )}
                  <span className={cn('flex shrink-0 items-center gap-1', fotoOk ? 'text-success' : 'text-amber-600')}
                    title={fotoOk ? 'Foto de salida confirmada' : 'Falta la foto de salida (política del local)'}>
                    {fotoOk ? <Camera className="size-3.5" /> : <ImageOff className="size-3.5" />}
                    {fotoOk ? 'Foto' : 'Sin foto'}
                  </span>
                  <span className={cn('flex shrink-0 items-center gap-1', s.printed ? 'text-muted-foreground' : 'text-amber-600')}
                    title={s.printed ? 'Orden impresa' : 'Orden sin imprimir'}>
                    <Printer className="size-3.5" /> {s.printed ? 'Impresa' : 'Sin imprimir'}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => onOpen(s)}>Abrir</Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => onPrint(s)}>
                      <Receipt className="size-3" /> Factura
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="pt-2 text-[11px] text-muted-foreground">
            Por fecha de <strong>entrega</strong> de hoy. Las órdenes sin «foto» son las que quedaron sin la
            foto de salida: la política de la empresa es tomarle foto al teléfono cuando se entrega.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
