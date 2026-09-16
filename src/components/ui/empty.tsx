import * as React from 'react';
import { cn } from '@/lib/utils';

// Estado vacío estándar (equivalente a Empty de shadcn/ui). Se usa cuando una
// búsqueda o un filtro no devuelve nada, en vez de un texto suelto.

function Empty({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      {children}
    </div>
  );
}

function EmptyMedia({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground', className)}>
      {children}
    </div>
  );
}

function EmptyTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('text-sm font-medium text-foreground', className)}>{children}</p>;
}

function EmptyDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('max-w-md text-xs text-muted-foreground', className)}>{children}</p>;
}

export { Empty, EmptyMedia, EmptyTitle, EmptyDescription };
