import * as React from 'react';
import { cn } from '@/lib/utils';

// Tabs propios (sin radix nuevo: el proyecto no tiene el paquete tabs instalado y
// no hay red para agregarlo). Misma API que shadcn/ui para poder migrar después:
// <Tabs value onValueChange><TabsList><TabsTrigger/></TabsList><TabsContent/></Tabs>

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}
const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(component: string) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error(`${component} debe usarse dentro de <Tabs>`);
  return ctx;
}

function Tabs({ value, onValueChange, className, children }: {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div className={cn('flex flex-col gap-4', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}

function TabsTrigger({ value, className, children }: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: current, setValue } = useTabs('TabsTrigger');
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? 'active' : 'inactive'}
      onClick={() => setValue(value)}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

function TabsContent({ value, className, children }: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: current } = useTabs('TabsContent');
  if (current !== value) return null;
  return (
    <div role="tabpanel" data-state="active" className={cn('flex flex-col gap-4', className)}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
