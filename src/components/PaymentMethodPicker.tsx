import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn, currencySymbol, methodCurrency, shortMethodLabel } from '@/lib/utils';
// Las reglas puras (favoritos + cómo se parte la lista) viven en un módulo sin React para poder
// probarlas sin navegador (`tools/method_picker_test.ts`).
import { splitMethods, simboloSiAporta, type PaymentMethod } from '@/lib/payment-methods';

// F31 — SELECTOR DE MÉTODO DE PAGO con ACCESO DIRECTO a los que más se usan.
//
// Pedido del local: «tener como predeterminado lo que más se usa — Punto de Venta (Bs), Pago Móvil,
// Efectivo $ — y las demás dejarlas en un desplegable». Antes CADA pantalla que cobra mostraba los 7
// métodos en un `<Select>` plano (y la lista estaba copiada en 6 archivos).
//
// Una sola implementación para: crear servicio, editar servicio, Pago/Abono, Ventas, Devolución y el
// asistente de cierre. La MONEDA no se decide acá: se sigue derivando del método con `methodCurrency`
// (regla del harness), así que este componente solo elige el NOMBRE del método.

export function PaymentMethodPicker({ methods, value, onChange, size = 'md', disabled = false, className }: {
  methods: PaymentMethod[];
  value: string;
  onChange: (name: string) => void;
  /** `sm` = filas compactas del wizard · `md` = dialogs de cobro (área de toque grande) */
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  const { fav, resto } = useMemo(() => splitMethods(methods), [methods]);
  const esFavorito = fav.some(m => m.name === value);
  const esDelResto = !esFavorito && !!value && resto.some(m => m.name === value);

  // Sin favoritos configurados (o backend con otros nombres) el componente no se queda mudo:
  // cae al desplegable completo para no perder ningún método.
  const soloDesplegable = fav.length === 0;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {!soloDesplegable && (
        <ToggleGroup
          type="single"
          value={esFavorito ? value : ''}
          disabled={disabled}
          onValueChange={v => { if (v) onChange(v); }}
          className="flex flex-wrap justify-start gap-1.5"
        >
          {fav.map(m => {
            const etiqueta = shortMethodLabel(m.name);
            const simbolo = simboloSiAporta(etiqueta, m.name);
            return (
              <ToggleGroupItem
                key={m.id}
                value={m.name}
                title={`${m.name} · ${methodCurrency(m.name) === 'VES' ? 'bolívares' : 'dólares'}`}
                className={cn(
                  'gap-1 rounded-lg border font-semibold transition-colors',
                  'data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground',
                  size === 'sm' ? 'h-9 px-2.5 text-[11px]' : 'h-11 px-3 text-sm',
                )}
              >
                {etiqueta}
                {simbolo && <span className="font-normal text-muted-foreground">{simbolo}</span>}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={esDelResto ? value : ''}
          disabled={disabled}
          onValueChange={v => { if (v) onChange(v); }}
        >
          <SelectTrigger
            className={cn('w-auto min-w-40', size === 'sm' ? 'h-9 text-[11px]' : 'h-10 text-xs')}
            aria-label="Otros métodos de pago"
          >
            {/* El chevron lo pone `ui/select.tsx`: no se agrega otro acá. */}
            <SelectValue placeholder="Otros métodos…" />
          </SelectTrigger>
          <SelectContent>
            {resto.map(m => {
              const simbolo = simboloSiAporta(m.name, m.name);
              return (
                <SelectItem key={m.id} value={m.name}>
                  {m.name}
                  {simbolo && <span className="ml-2 text-[10px] text-muted-foreground">{simbolo}</span>}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* El método vigente SIEMPRE visible: si es del desplegable (o ya no está en la lista del
            backend, p.ej. un nombre viejo), se muestra acá para que nunca quede invisible. */}
        {value && !esFavorito && (
          <Badge variant="secondary" className="gap-1 font-semibold">
            {esDelResto ? shortMethodLabel(value) : value}
            <span className="font-normal text-muted-foreground">{currencySymbol(methodCurrency(value))}</span>
          </Badge>
        )}
      </div>
    </div>
  );
}
