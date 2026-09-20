import { useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, ClipboardList, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Ficha, FichaField } from '@/lib/ficha';

// F33 — ASISTENTE DE FICHA DE INGRESO (reemplaza al panel de guía que tapaba el formulario).
//
// Pedido del usuario: al registrar un servicio el aviso flotante «se siente invasivo… no me deja ver
// lo que estoy registrando». Ahora el asistente vive DENTRO del formulario y es discreto:
//
//   · Línea 1: «Ficha de ingreso · 6/16» + «Revisá: …» si algún dato quedó con formato dudoso.
//   · Línea 2: el DATO QUE TOCA AHORA, con su nombre técnico y una guía de una línea + «Ir al campo».
//     Se actualiza solo: al completar un dato, pasa al siguiente.
//   · «Ver ficha»: despliega la ficha completa (los 4 bloques del mostrador) con cada dato en su
//     valor o «Pendiente». Tocar cualquier dato lleva a su paso para CORREGIRLO sin perder el resto.
//
// Compacto por defecto (dos líneas) y sin nada flotando encima del formulario: el operario ve
// siempre lo que está escribiendo.

function DatoFila({ field, onGo }: { field: FichaField; onGo?: (step: number) => void }) {
  const puedeIr = !!onGo && field.step >= 0;
  const contenido = (
    <div className="flex items-start gap-2 py-1" data-ficha-field={field.key} data-state={field.state}>
      <span className="mt-0.5 shrink-0">
        {field.state === 'falta'
          ? <AlertTriangle className="size-3.5 text-danger" />
          : field.state === 'pendiente'
            ? <span className="block size-3.5 rounded-full border border-muted-foreground/50" />
            : <ListChecks className="size-3.5 text-success" />}
      </span>
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{field.label}</span>
        <span className={cn('shrink-0 text-right text-xs font-medium',
          field.state === 'ok' ? 'text-foreground' : field.state === 'falta' ? 'text-danger' : 'text-muted-foreground/80')}>
          {field.value ?? 'Pendiente'}
          {field.state === 'falta' && ' *'}
        </span>
      </div>
      {field.warn && (
        <span className="w-full pl-5 text-[11px] text-amber-700">{field.warn}</span>
      )}
    </div>
  );
  if (!puedeIr) return contenido;
  return (
    <button type="button" className="-mx-1 w-full rounded px-1 text-left transition-colors hover:bg-accent/60"
      title={`Ir a corregir «${field.label}»`} onClick={() => onGo!(field.step)}>
      {contenido}
    </button>
  );
}

export function FichaIngreso({ ficha, nextProcess, onGoToStep, className }: {
  ficha: Ficha;
  /** el paso siguiente del PROCESO (por estado): «En reparación — asigná el técnico…» */
  nextProcess?: { status: string; why: string } | null;
  onGoToStep?: (step: number) => void;
  className?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const next = ficha.next;

  return (
    <div
      data-ficha
      className={cn('flex flex-col gap-1.5 rounded-lg border px-3 py-2',
        ficha.completa ? 'border-border bg-muted/30' : 'border-primary/25 bg-primary/5', className)}
    >
      {/* Línea 1 — estado de la ficha (siempre visible y sin tapar nada) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <ClipboardList className="size-3.5 text-primary" /> Ficha de ingreso
        </span>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-bold text-primary ring-1 ring-primary/20"
          data-ficha-progreso>
          {ficha.done}/{ficha.total}
        </span>
        {ficha.completa ? (
          <span className="text-[11px] font-medium text-success">Lista para guardar</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Faltan {ficha.groups.flatMap(g => g.fields).filter(f => f.state === 'falta').length} dato(s) obligatorio(s)
          </span>
        )}
        {ficha.warns.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700" data-ficha-warns>
            <AlertTriangle className="size-3" /> Revisá: {ficha.warns.map(w => w.label.split(' (')[0]).join(' · ')}
          </span>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 shrink-0 px-1.5 text-[11px]"
          onClick={() => setAbierta(v => !v)}>
          {abierta
            ? <><ChevronDown className="size-3" /> Ocultar ficha</>
            : <><ChevronRight className="size-3" /> Ver ficha</>}
        </Button>
      </div>

      {/* Línea 2 — el dato que toca AHORA, con su guía (el asistente «pide de a uno») */}
      {next ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-ficha-next={next.key}>
          <span className="text-xs font-semibold text-foreground">
            {next.label}
            {next.required && <span className="text-danger"> *</span>}
          </span>
          <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">— {next.guide}</span>
          {onGoToStep && next.step >= 0 && (
            <Button type="button" size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]"
              aria-label={`Ir al campo ${next.label}`}
              onClick={() => onGoToStep(next.step)}>
              Ir al campo <ArrowRight className="size-3" />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-success" data-ficha-next="completa">
          Todos los datos de la ficha están cargados — podés guardar (Ctrl+Enter).
        </p>
      )}

      {/* Ficha completa (a un clic): los 4 bloques del mostrador, dato por dato */}
      {abierta && (
        <div className="grid gap-x-4 gap-y-2 border-t border-border/60 pt-2 sm:grid-cols-2" data-ficha-detalle>
          {ficha.groups.map(g => (
            <div key={g.title} className="flex flex-col">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{g.title}</p>
              <div className="flex flex-col divide-y divide-border/40">
                {g.fields.map(f => <DatoFila key={f.key} field={f} onGo={onGoToStep} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Siguiente paso del PROCESO por estado (una línea, informativa) */}
      {nextProcess && (
        <p className="flex items-start gap-1.5 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground" data-ficha-paso>
          <ArrowRight className="mt-0.5 size-3 shrink-0" />
          <span>
            <strong className="font-semibold text-foreground">Siguiente en el proceso: {nextProcess.status}</strong> — {nextProcess.why}
          </span>
        </p>
      )}
    </div>
  );
}
