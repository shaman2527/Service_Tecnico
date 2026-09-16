import { cn } from '@/lib/utils';

// Placeholder de carga (equivalente a Skeleton de shadcn/ui): se usa mientras
// llegan los datos de una consulta, en vez de una tabla vacía.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
