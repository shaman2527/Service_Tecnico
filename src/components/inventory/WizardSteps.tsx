import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * F78 — El stepper de los asistentes de carga de inventario (el del conteo y el del CSV).
 *
 * Antes vivía dentro de `LoadInventoryDialog`; se extrajo para que los dos asistentes muestren los
 * pasos EXACTAMENTE igual (una sola implementación, como el `FormStepper` del wizard de servicios).
 */
export function WizardSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <div className="flex items-center gap-2" data-wizard-steps>
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
              i < current ? 'bg-success text-white' : i === current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {i < current ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn('text-xs', i === current ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
          {i < steps.length - 1 && <span className="text-muted-foreground/40">·</span>}
        </div>
      ))}
    </div>
  );
}
