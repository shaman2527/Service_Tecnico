import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Interruptor SÍ/NO del sistema.
 *
 * Nace de un pedido del dueño: la casilla del «en uso» del inventario era un texto «✓ Sí» / «—» y
 * no se leía como un estado. Es un `<button role="switch">` con su `aria-checked`, así que el
 * lector de pantalla dice «activado / desactivado» y también se maneja con el teclado.
 *
 * Sin dependencias nuevas a propósito: el proyecto no tiene `@radix-ui/react-switch` y esto no
 * justifica una instalación (la app se instala en PCs de tienda y se actualiza sin internet).
 *
 * Detalles que se notan sin verse:
 *   · el recorrido del botón es de 150 ms con una curva `ease-out` fuerte (la de fábrica arranca
 *     lento y hace que el interruptor se sienta pesado);
 *   · al mantener pulsado el botón se encoge un 10 %, que es la respuesta que confirma el toque;
 *   · el `after` es el ÁREA TÁCTIL (36 × 36) y no el dibujo: el interruptor sigue siendo chico.
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "checked" | "onChange" | "role"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group/switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent",
        "transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        "after:absolute after:-inset-1.5 after:content-['']",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-success" : "bg-muted-foreground/25",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-sm",
          "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          "group-active/switch:scale-90",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  )
)
Switch.displayName = "Switch"

export { Switch }
