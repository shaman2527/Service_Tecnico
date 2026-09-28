/**
 * F82 — EL AVISO DE LA CAJA DEL DÍA ANTERIOR SIN CERRAR.
 *
 * Se muestra cuando el turno abierto (`daily_closings.is_closed=0`) es de OTRO día: el mostrador no
 * puede facturar hasta cerrarlo (el backend lo rechaza: `require_open_day_para`) y este cartel lo dice
 * ANTES — con las dos fechas, lo que le pasaría a la plata y el camino exacto del remedio, con el
 * botón que lleva al Libro Diario en un toque.
 *
 * La regla y el texto viven en `src/lib/day-shift.ts` (módulo puro con pruebas): acá solo se dibuja.
 */
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AVISO_TURNO_VIEJO, turnoViejoTexto, type TurnoViejo } from '@/lib/day-shift';

export function TurnoViejoBanner({ turno, onGoToLedger, puedeCerrar = true, className }: {
  turno: TurnoViejo;
  /** Lleva al Libro Diario → Cierres (donde está el botón «Cerrar» de esa fila). */
  onGoToLedger?: () => void;
  /**
   * F82 (hallazgo MAYOR de la revisión adversarial): cerrar el día es del DUEÑO (`close_day` pide su
   * sesión) y la pestaña Cierres no existe para la caja. Ofrecerle a la caja un botón que la lleva a
   * una pestaña que no ve —y decirle «contá el cajón»— la dejaba en un callejón sin salida: el
   * mostrador no puede facturar NI cerrar NI abrir el día. Con `puedeCerrar === false` el cartel dice
   * la verdad: hay que pedirle al dueño que cierre esa caja.
   */
  puedeCerrar?: boolean;
  className?: string;
}) {
  if (!turno.stale) return null;
  return (
    <div
      data-field="turno-viejo"
      data-turno-viejo={turno.fechaTurno ?? ''}
      data-puede-cerrar={puedeCerrar ? 'si' : 'no'}
      title={turnoViejoTexto(turno)}
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-destructive/50',
        'bg-destructive/5 px-3 py-2 text-destructive',
        className,
      )}>
      <AlertTriangle className="size-4 shrink-0" />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold" data-field="turno-viejo-titulo">{AVISO_TURNO_VIEJO}</span>
        <span className="text-xs" data-field="turno-viejo-detalle">{turno.message}</span>
        <span className="text-[11px] opacity-80" data-field="turno-viejo-remedio">{turno.remedy}</span>
        {!puedeCerrar && (
          <span className="text-[11px] font-medium" data-field="turno-viejo-pedir-dueno">
            El cierre de la caja lo hace el dueño: pedile que cierre la del {turno.fechaTurno} desde Libro Diario → Cierres
            (así el arqueo de ese día queda cuadrado) y que abra el día de hoy. Mientras tanto la caja no puede facturar.
          </span>
        )}
      </div>
      {onGoToLedger && puedeCerrar && (
        <Button size="sm" variant="outline" className="ml-auto shrink-0 border-destructive/40"
          onClick={onGoToLedger} data-action="ir-a-cerrar-caja"
          title="Abrir el Libro Diario en la pestaña Cierres (ahí está el botón «Cerrar» de esa fila)">
          Ir a cerrar esa caja
        </Button>
      )}
      {onGoToLedger && !puedeCerrar && (
        <Button size="sm" variant="outline" className="ml-auto shrink-0 border-destructive/40"
          onClick={onGoToLedger} data-action="ir-al-libro-diario"
          title="Abrir el Libro Diario (la pestaña Cierres y el cierre del día son del dueño)">
          Ver el Libro Diario
        </Button>
      )}
    </div>
  );
}
