import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { parseCompatList } from '@/lib/utils';
import { cn } from '@/lib/utils';

// Teléfonos compatibles de un producto en chips. Con más de 3 se muestran los
// primeros y un "+N" que lista el resto en un tooltip (antes eran 13 columnas
// apretadas o texto pegado sin orden).
export function CompatChips({ compatibility, max = 3, className }: {
  compatibility: string | null;
  max?: number;
  className?: string;
}) {
  const list = parseCompatList(compatibility);
  if (list.length === 0) {
    return <span className="text-xs text-muted-foreground">Sin compatibilidad</span>;
  }
  const shown = list.slice(0, max);
  const rest = list.slice(max);
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map(m => (
        <Badge key={m} variant="outline" className="text-[11px] font-normal">
          {m}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-[11px] font-medium cursor-help">
              +{rest.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="flex flex-col gap-0.5">
              {rest.map(m => <span key={m}>{m}</span>)}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
