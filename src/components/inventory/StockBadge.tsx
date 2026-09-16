import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Estado del stock en un solo lugar (semántico, sin colores sueltos):
//   negativo  -> faltante (rojo)
//   0         -> agotado  (gris)
//   <= mínimo -> bajo mínimo (ámbar)
//   resto     -> disponible (verde)
export type StockState = 'faltante' | 'agotado' | 'bajo' | 'ok';

export function stockState(stock: number, minStock: number): StockState {
  if (stock < 0) return 'faltante';
  if (stock === 0) return 'agotado';
  if (minStock > 0 && stock <= minStock) return 'bajo';
  return 'ok';
}

export const STOCK_LABEL: Record<StockState, string> = {
  faltante: 'FALTANTE',
  agotado: 'AGOTADO',
  bajo: 'BAJO MÍNIMO',
  ok: 'DISPONIBLE',
};

export function StockBadge({ stock, minStock, className }: {
  stock: number;
  minStock: number;
  className?: string;
}) {
  const state = stockState(stock, minStock);
  const variant = state === 'faltante' || state === 'bajo' ? 'destructive' as const : state === 'ok' ? 'default' as const : 'outline' as const;
  return (
    <Badge
      variant={variant}
      className={cn(
        'tabular-nums font-semibold',
        state === 'bajo' && 'bg-warning text-white hover:bg-warning',
        state === 'ok' && 'bg-success text-white hover:bg-success',
        className,
      )}
      title={STOCK_LABEL[state]}
    >
      {stock}
    </Badge>
  );
}
