import { Banknote, Camera, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Reminder, ReminderActionId } from '@/lib/reminders';

// F32 — TARJETA DE RECORDATORIO (aviso emergente NO invasivo).
//
// Cómo se comporta (pedido del usuario: «un mensaje que salga de repente… no invasivo, colores,
// recordándole al operador»):
//   · sale como aviso flotante en una esquina (sonner ya está montado en la app: UNA sola
//     infraestructura de avisos, no un sistema nuevo),
//   · NO tapa nada ni roba el foco, NO abre diálogos y **nunca bloquea**: se puede cerrar con la ✕
//     o dejarlo pasar, y el operario sigue trabajando igual;
//   · cada tono tiene su color: entrada = azul, salida = verde, pago = ámbar, política = naranja;
//   · las acciones anotan la respuesta (foto tomada / paga ahora / paga al retirar) en un toque.
//
// La lógica de CUÁNDO aparece cada aviso vive en `src/lib/reminders.ts` (módulo puro, con pruebas);
// acá está solo cómo se ve y cómo se conecta con sonner.

const TONOS = {
  entrada: {
    icon: Camera,
    borde: 'border-l-primary',
    fondo: 'bg-primary/5',
    circulo: 'bg-primary',
    // tonos OSCUROS para el rótulo: el mismo criterio del resto de la app (text-amber-700 sobre
    // tintes /10) — `text-warning` (#f59e0b) sobre un tinte al 5% da ~2:1 y no se lee.
    texto: 'text-primary',
  },
  salida: {
    icon: Camera,
    borde: 'border-l-success',
    fondo: 'bg-success/5',
    circulo: 'bg-success',
    texto: 'text-emerald-700',
  },
  pago: {
    icon: Banknote,
    borde: 'border-l-warning',
    fondo: 'bg-warning/5',
    circulo: 'bg-warning',
    texto: 'text-amber-700',
  },
  politica: {
    icon: ShieldCheck,
    borde: 'border-l-orange-500',
    fondo: 'bg-orange-500/5',
    circulo: 'bg-orange-500',
    texto: 'text-orange-700',
  },
} as const;

export function ReminderCard({ reminder, onAction, onDismiss, className }: {
  reminder: Reminder;
  onAction: (id: ReminderActionId) => void;
  onDismiss: () => void;
  className?: string;
}) {
  const tono = TONOS[reminder.tone];
  const Icono = tono.icon;
  return (
    <div
      // NO se repite `role="status"`/`aria-live` acá: el contenedor de sonner YA es una región
      // `aria-live="polite"` y el aviso se anunciaría dos veces.
      data-reminder={reminder.key}
      data-tone={reminder.tone}
      className={cn(
        // pointer-events-none + pointer-events-auto en los controles: el aviso NO se come los
        // clics. Un recordatorio que tapa un botón del formulario (el pie del asistente de cierre,
        // la cabecera…) haría que el operario apriete y no pase nada — lo contrario de «no
        // invasivo». Solo los botones del aviso reciben el clic; el resto pasa al fondo.
        'pointer-events-none flex w-[min(92vw,23rem)] items-start gap-3 rounded-lg border border-l-4 shadow-lg',
        'bg-background p-3', tono.borde, tono.fondo, className,
      )}
    >
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm', tono.circulo)}>
        <Icono className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className={cn('text-[10px] font-bold uppercase tracking-widest', tono.texto)}>{reminder.title}</span>
          <button
            type="button"
            aria-label="Cerrar recordatorio"
            onClick={onDismiss}
            className="pointer-events-auto -mr-1 -mt-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="text-sm leading-snug text-foreground">{reminder.message}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {reminder.actions.map((a, i) => (
            <Button
              key={a.id}
              size="sm"
              variant={i === 0 ? 'default' : 'outline'}
              className="pointer-events-auto h-7 px-2.5 text-[11px]"
              onClick={() => onAction(a.id)}
            >
              {a.label}
            </Button>
          ))}
          <span className="text-[10px] text-muted-foreground">No bloquea nada</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Muestra un recordatorio. `id` es ESTABLE por aviso+orden: sonner deduplica por id, así que el
 * mismo aviso pedido dos veces (por ejemplo al entregar y al abrir el comprobante en el mismo
 * gesto) se muestra UNA sola vez en lugar de apilar dos tarjetas iguales. Devuelve el id.
 * Los que tienen acciones duran más (el operario tiene que poder tocarlos); los informativos se
 * van solos a los 7 segundos. 8 s en los que piden algo: tiempo de leer, sin quedarse tapando.
 */
export function showPolicyReminder(reminder: Reminder, onAction: (id: ReminderActionId) => void, id?: string): string | number {
  const conAcciones = reminder.actions.some(a => a.id !== 'ok');
  return toast.custom((t) => (
    <ReminderCard
      reminder={reminder}
      onAction={(a) => { toast.dismiss(t); onAction(a); }}
      onDismiss={() => toast.dismiss(t)}
    />
  ), {
    id,
    duration: conAcciones ? 8000 : 7000,
    position: 'bottom-right',
    // El contenedor del propio aviso tampoco intercepta clics: solo sus botones (ver ReminderCard).
    className: 'pointer-events-none',
  });
}
