import { cn } from '@/lib/utils';

// Franja de KPIs del inventario (una sola línea, lenguaje de tienda).
// Vive aquí para que Productos y Modelos muestren los números igual.
export function Kpi({ label, value, tone, hint }: {
  label: string;
  value: string | number;
  tone?: 'danger' | 'warning' | 'success';
  hint?: string;
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-foreground';
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={hint}>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', toneClass)}>{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Contenedor de la franja de KPIs. */
export function KpiStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
      {children}
    </div>
  );
}
