import { useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, ClipboardList, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Ficha, FichaField } from '@/lib/ficha';

// F33/F65b — ASISTENTE DE FICHA DE INGRESO, ahora en UNA SOLA LÍNEA.
//
// Historia: (F33) el aviso flotante «se siente invasivo… no me deja ver lo que estoy registrando» →
// el asistente se mudó ADENTRO del formulario, en dos líneas. (Pedido del dueño, 2026-09-23): «cuando
// vas a crear un servicio esta información ocupa demasiado espacio del wizard, no debería estar ahí,
// está muy grande» — con 4 renglones (título + progreso + «faltan N» + el dato pedido + «para
// completar» + «siguiente en el proceso») se comía el alto del formulario en cada paso.
//
// QUÉ QUEDA VISIBLE (una línea, se acomoda con `flex-wrap` en pantallas angostas):
//   «📋 Ficha de ingreso · 6/16 · Falta: Marca y modelo exacto * [Ir al campo] · → Siguiente en el
//    proceso: En reparación [Ver ficha]»
// La GUÍA del dato y el detalle del paso siguiente van en el `title` (tooltip), así no ocupan alto.
//
// DENTRO DE «Ver ficha» (a un clic, y se acuerda el operario de que está ahí): los 4 bloques del
// mostrador dato por dato —tocar cualquiera lleva a su paso para corregirlo sin perder el resto—, el
// contador de obligatorios que faltan, los avisos que NO bloquean (F48) y la explicación completa del
// paso siguiente. NADA se perdió: se movió a donde no estorba mientras se escribe.

function DatoFila({ field, onGo }: { field: FichaField; onGo?: (step: number, key?: string) => void }) {
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
      title={`Ir a corregir «${field.label}»`} onClick={() => onGo!(field.step, field.key)}>
      {contenido}
    </button>
  );
}

export function FichaIngreso({ ficha, nextProcess, onGoToStep, className }: {
  ficha: Ficha;
  /** el paso siguiente del PROCESO (por estado): «En reparación — asigná el técnico…» */
  nextProcess?: { status: string; why: string } | null;
  /**
   * F48: lleva al PASO del dato y le dice CUÁL es, para que el formulario además le dé el foco
   * (el «te va llevando de la mano» del dueño: un toque y el cursor queda en el campo que falta).
   */
  onGoToStep?: (step: number, key?: string) => void;
  className?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const next = ficha.next;
  const faltan = ficha.groups.flatMap(g => g.fields).filter(f => f.state === 'falta').length;

  return (
    <div
      data-ficha
      className={cn('flex flex-col gap-1.5 rounded-lg border px-3 py-1.5',
        ficha.completa ? 'border-border bg-muted/30' : 'border-primary/25 bg-primary/5', className)}
    >
      {/* ── LA ÚNICA LÍNEA: progreso + el dato que toca AHORA + el paso del proceso + acciones ── */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <ClipboardList className="size-3.5 text-primary" /> Ficha de ingreso
        </span>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-bold text-primary ring-1 ring-primary/20"
          data-ficha-progreso
          title={`${ficha.done} de ${ficha.total} datos de la ficha${faltan > 0 ? ` · faltan ${faltan} obligatorio(s)` : ''}`}>
          {ficha.done}/{ficha.total}
        </span>

        {next ? (
          <span className="flex min-w-0 items-center gap-1" data-ficha-next={next.key} title={`${next.label} — ${next.guide}`}>
            {/* «Siguiente dato», NO «Falta:»: el pie de cada paso del wizard usa «Falta: …» para decir
                qué le falta a ESE paso, y esta línea habla de la FICHA COMPLETA (que abarca todos los
                pasos). Con la misma palabra, en el paso Cliente parecía que faltaba algo del paso. */}
            <span className="truncate text-xs text-muted-foreground">Siguiente dato:</span>
            <span className="truncate text-xs font-semibold text-foreground">
              {next.label}{next.required && <span className="text-danger"> *</span>}
            </span>
          </span>
        ) : (
          <span className="text-[11px] font-medium text-success" data-ficha-next="completa">
            Lista para guardar — todos los datos están cargados
          </span>
        )}

        {ficha.warns.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700" data-ficha-warns>
            <AlertTriangle className="size-3" /> Revisá: {ficha.warns.map(w => w.label.split(' (')[0]).join(' · ')}
          </span>
        )}

        {/* El paso siguiente del PROCESO, en la misma línea y sólo con el estado: la explicación
            («asigná el técnico responsable y empezá el diagnóstico») va en el tooltip y completa
            adentro de «Ver ficha». */}
        {nextProcess && (
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
            data-ficha-paso title={nextProcess.why}>
            <ArrowRight className="size-3 shrink-0" />
            <span className="truncate">
              Siguiente en el proceso: <strong className="font-semibold text-foreground">{nextProcess.status}</strong>
            </span>
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Los avisos que NO bloquean (F48) se anuncian acá con su cuenta y se abren con un toque:
              así el operario sabe que hay algo para completar sin que le ocupe un renglón. */}
          {ficha.notas.length > 0 && (
            <button type="button" data-ficha-notas-hay
              title={ficha.notas.map(n => n.texto).join(' · ')}
              className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-500/20"
              onClick={() => setAbierta(true)}>
              <AlertTriangle className="size-3" /> {ficha.notas.length}
            </button>
          )}
          {onGoToStep && next && next.step >= 0 && (
            <Button type="button" size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]"
              aria-label={`Ir al campo ${next.label}`} title={next.guide}
              onClick={() => onGoToStep(next.step, next.key)}>
              Ir al campo <ArrowRight className="size-3" />
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-[11px]"
            data-ficha-ver onClick={() => setAbierta(v => !v)}>
            {abierta
              ? <><ChevronDown className="size-3" /> Ocultar</>
              : <><ChevronRight className="size-3" /> Ver ficha</>}
          </Button>
        </div>
      </div>

      {/* ── DETALLE (a un clic): la ficha completa, los obligatorios que faltan, los avisos que no
             bloquean y la explicación del paso siguiente ── */}
      {abierta && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-2" data-ficha-detalle>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {ficha.groups.map(g => (
              <div key={g.title} className="flex flex-col">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{g.title}</p>
                <div className="flex flex-col divide-y divide-border/40">
                  {g.fields.map(f => <DatoFila key={f.key} field={f} onGo={onGoToStep} />)}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground" data-ficha-faltan>
            {ficha.completa
              ? 'Todos los datos de la ficha están cargados — podés guardar (Ctrl+Enter).'
              : `Faltan ${faltan} dato(s) obligatorio(s): ${ficha.groups.flatMap(g => g.fields)
                .filter(f => f.state === 'falta').map(f => f.label).join(' · ')}`}
          </p>

          {ficha.notas.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-ficha-notas>
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
                <AlertTriangle className="size-3" /> Para completar (no bloquea):
              </span>
              {ficha.notas.map(n => (
                <button key={n.key} type="button" data-ficha-nota={n.key} title={n.guia}
                  onClick={() => onGoToStep?.(n.step, n.key)}
                  className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-500/20">
                  {n.texto}
                </button>
              ))}
            </div>
          )}

          {nextProcess && (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground" data-ficha-paso-detalle>
              <ArrowRight className="mt-0.5 size-3 shrink-0" />
              <span>
                <strong className="font-semibold text-foreground">Siguiente en el proceso: {nextProcess.status}</strong> — {nextProcess.why}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
