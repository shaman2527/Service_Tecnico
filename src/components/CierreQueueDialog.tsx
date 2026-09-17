import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Printer, Smartphone, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/db';
import { cn, isFinalized, shortMethodLabel } from '@/lib/utils';
import { ACTIVE_QUEUE, queueFlags, rankQueue } from '@/lib/queue';
import type { Service } from '../types';

// F30 — COLA DE ENTREGAS (el portero del asistente de cierre).
//
// Con mucho cliente en el mostrador, el cuello de botella es ENCONTRAR la orden. Acá se listan
// SOLO las órdenes en taller y se busca por lo que el cliente dice en voz alta: su cédula, su
// teléfono, su nombre, el número de orden o el modelo del equipo. Se abre con F4.
//
// Decisión de rendimiento: la búsqueda es LOCAL (sin IPC ni debounce) sobre la cola ya cargada
// en UNA sola consulta — instantánea incluso en hora pico (antes cada búsqueda de la lista
// disparaba hasta 120 `getServicePayments`). El ranking y los faltantes viven en `lib/queue.ts`
// (puros, probados con `tools/queue_test.ts`).
export default function CierreQueueDialog({ open, onOpenChange, onPick }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** el operario eligió la orden: Services.tsx abre el asistente de cierre con ella */
  onPick: (s: Service) => void;
}) {
  const [cola, setCola] = useState<Service[]>([]);
  const [q, setQ] = useState('');
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // UNA consulta por apertura: la cola completa de órdenes en taller.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCargando(true);
    setQ('');
    api.getServices('', ACTIVE_QUEUE)
      .then(list => { if (alive) setCola(list.filter(s => !isFinalized(s.status))); })
      .catch(() => { if (alive) setCola([]); })
      .finally(() => { if (alive) setCargando(false); });
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const resultados = useMemo(() => rankQueue(cola, q).slice(0, 40), [cola, q]);
  const conSaldo = cola.filter(s => queueFlags(s).debe).length;

  const elegir = (s: Service) => {
    onOpenChange(false);
    onPick(s);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-4 pt-4">
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-amber-500" /> Cerrar una entrega
          </DialogTitle>
          <DialogDescription className="text-xs">
            Buscá por cédula, teléfono, nombre, modelo o número de orden. {cola.length} en taller
            {conSaldo > 0 && <> · <span className="text-destructive font-medium">{conSaldo} con saldo</span></>}
            {' '}· <kbd className="rounded border px-1">↑↓</kbd> elegir · <kbd className="rounded border px-1">Enter</kbd> abrir
          </DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false} className="min-h-0 flex-1">
          <CommandInput
            ref={inputRef}
            value={q}
            onValueChange={setQ}
            placeholder="Cédula, teléfono, nombre, modelo o DEV-0001…"
          />
          <CommandList className="max-h-[55vh]">
            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
              {cargando ? 'Cargando la cola…' : 'Ninguna orden en taller coincide.'}
            </CommandEmpty>
            {resultados.map(s => {
              const { pantallaPendiente, saldo, debe, imprimible } = queueFlags(s);
              return (
                <CommandItem
                  key={s.id}
                  value={String(s.id)}
                  onSelect={() => elegir(s)}
                  className="items-start gap-3 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{s.order_num ?? `#${s.id}`}</span>
                      <span className="truncate font-medium">{s.client ?? 'Sin cliente'}</span>
                      {s.phone && <span className="shrink-0 text-[11px] text-muted-foreground">{s.phone}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="truncate">{s.model ?? 'sin modelo'}{s.color ? ` · ${s.color}` : ''}</span>
                      <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                      {pantallaPendiente && (
                        <Badge variant="outline" className="gap-1 text-[10px] text-warning border-warning/50">
                          <Smartphone className="size-2.5" /> sin pantalla
                        </Badge>
                      )}
                      {imprimible && (
                        <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                          <Printer className="size-2.5" /> sin imprimir
                        </Badge>
                      )}
                      {debe && s.payment_method && <span>{shortMethodLabel(s.payment_method)}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {debe ? (
                      <span className="text-sm font-bold text-destructive">
                        {/* El SALDO siempre es en dólares (`services.amount` es $; `currency` es la
                            moneda del método de pago, no la del saldo) — la tarjeta vieja usa «$». */}
                        ${saldo.toFixed(2)}
                        <span className="block text-[10px] font-normal text-muted-foreground">falta cobrar</span>
                      </span>
                    ) : (
                      <span className={cn('flex items-center gap-1 text-xs font-medium text-emerald-600')}>
                        <CheckCircle2 className="size-3.5" /> pagado
                      </span>
                    )}
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
