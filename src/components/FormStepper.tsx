import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Stepper del wizard (movido literal desde Services.tsx en F30 para que el asistente
// de cierre use EXACTAMENTE el mismo indicador de pasos, sin una segunda copia).
// `done` marca el paso cumplido y `onNavigate` permite volver SOLO hacia atrás.
export function FormStepper({ steps, current, onNavigate }: {
  steps: { label: string; done: boolean }[];
  current: number;
  onNavigate?: (i: number) => void;
}) {
  const doneCount = steps.filter(s => s.done).length;
  const pct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
  return (
    <div className="shrink-0 space-y-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => {
          const lineDone = i > 0 && steps[i - 1].done;
          const navigable = !!onNavigate && i !== current && i < current;
          const stepEl = (
            <div className="flex flex-col items-center gap-1">
              <span className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors',
                s.done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : i === current
                    ? 'border-primary text-primary'
                    : 'border-border bg-background text-muted-foreground'
              )}>
                {s.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('text-[10px] font-medium leading-none', i === current ? 'text-foreground' : 'text-muted-foreground')}>
                {s.label}
              </span>
            </div>
          );
          return (
            <Fragment key={s.label}>
              {i > 0 && (
                <div className={cn('h-0.5 min-w-2 flex-1 rounded-full transition-colors', lineDone ? 'bg-primary' : 'bg-border')} />
              )}
              {navigable ? (
                <button type="button" className="rounded-md px-1 py-0.5 hover:bg-accent/60 transition-colors cursor-pointer"
                  onClick={() => onNavigate!(i)} title={`Ir a: ${s.label}`}>
                  {stepEl}
                </button>
              ) : stepEl}
            </Fragment>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
          {current >= steps.length
            ? `¡Listo! ${pct}%`
            : `Paso ${current + 1} de ${steps.length} · ${steps[current].label} · ${pct}%`}
        </span>
      </div>
    </div>
  );
}
