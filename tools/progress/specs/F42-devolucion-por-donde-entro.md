# Spec F42 — La devolución vuelve POR DONDE ENTRÓ la plata (y el Libro la muestra)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Reporte del dueño (2026-09-17), con la app en la mano: **«devolví 2 dólares en Bs, pero en el Libro al
cerrar obviamente se ve reflejado… y cuando voy a cerrar caja me sale 43 dólares efectivo. Revisá esa
lógica»**, y después: **«lo que quiero es que en el Libro se vea el monto que devolví, para cuando yo
quiera ver mi venta del día saber cuánto llevo, datos reales; al igual cuando cierro debería ser así»**.

---

## 1. Diagnóstico (con los datos reales del día, sobre una copia)

| Dato | Valor |
|---|---|
| DEV-0001 (Roberth · Spark 10 Pro · **$5** · estado **Devuelto**) | formulario: `Punto de Venta (Bs)` |
| Cobro real 1 | **Divisas (USD Cash) $3** |
| Cobro real 2 | **Pago Móvil Bs. 1.697** (tasa del día 848,5458 → **exactamente $2**) |
| Devolución anotada | **Bs. 1.697** con método **«Punto de Venta (Bs)»** |
| DEV-0002 (iPhone 13 Pro · $40 · Entregado) | cobro **Divisas $40** |

**Los $43 son correctos:** son los dos cobros en efectivo dólares ($40 + $3). La devolución fue *en
bolívares*, así que no puede tocar el cajón de dólares.

**El defecto:** el diálogo de devolución propone el método del **formulario de la orden**
(`RefundDialog` → `service.payment_method`), que en este proyecto es **sólo lo que se esperaba cobrar**,
nunca el método real. El operario aceptó lo propuesto y la devolución quedó en el **Punto**, con dos
consecuencias medidas en el cierre de esa tarde:

1. `Punto de Venta (Bs)` esperado = **−Bs. 1.697** — una máquina que devuelve plata no existe.
2. Como la fila del Punto sólo se dibuja con esperado **> 0** (`DailyLedger.tsx:1475`), la devolución
   **desaparecía de la pantalla del cierre**; y el cajón esperaba **0** por la plata que sí salió.

La regla del local (dicha por el dueño): **«se devolvió la misma manera que el cliente me pagó»**.

## 2. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** El diálogo de devolución **propone el método por el que ENTRÓ la plata** (el de mayor neto en la moneda que se devuelve), nunca el del formulario | `refund_math_test.ts` (`refundMethodDefault`) + EN VIVO |
| 2 | **[must]** Un método que **no cobró nada** en esa moneda **no puede** registrar la devolución (fail-closed en el BACKEND, no sólo en la UI), salvo los de **cajón** (Efectivo Bs / Divisas), que sí pueden pagar del cajón | test Rust `test_refund_goes_back_by_the_method_that_collected` + `refundMethodProblem` |
| 3 | **[must]** El mensaje del bloqueo dice **por dónde entró** y sugiere el método correcto (y el cajón cuando corresponde) | test Rust (el error nombra `Pago Móvil`) + EN VIVO |
| 4 | **[must]** El Libro Diario y el cierre **nunca esconden un esperado ≠ 0**: la fila del Punto y las columnas por método se muestran también con neto **negativo**, y las celdas negativas vuelven a ser clickeables (abren el detalle) | EN VIVO (celda roja + drill-down) |
| 5 | **[must]** El operario **ve cuánto devolvió**: chip «Devuelto …» en la fila del día, KPI «Devuelto» y línea en el diálogo de cierre que explica que ya está restado del método por el que salió | EN VIVO |
| 6 | **[must]** Ningún número cambia para los días ya cerrados (`refund_*` son campos nuevos al final; los cierres guardados se leen igual) | `cargo test` (los tests de cierre siguen verdes) |
| 7 | **[should]** Si la devolución sale del **cajón** aunque la plata haya entrado por transferencia, se **avisa** (no se bloquea) | `refundMethodProblem` + aviso `data-field="refund-metodo-aviso"` |

## 3. Implementación

**Reglas puras (`src/lib/refund-math.ts`)** — una sola implementación para la UI y para las pruebas:
`incomeByMethod(pagos, moneda)` (lo que entró por cada método, ordenado), `methodHasIncome`, `isCashMethod`,
`refundMethodDefault(pagos, moneda, fallback)` (el de mayor ingreso; si no entró nada, el del formulario
para no dejar el campo vacío), `refundMethodProblem(...)` (texto del bloqueo, vacío = permitido) e
`incomeSummary(...)` (el «Entró por: …» del diálogo).

**Backend (`db.rs::add_service_refund`)** — el gate de verdad (fail-closed): si el método no es de cajón y
no tiene cobros en esa moneda, se rechaza con el mensaje que dice por dónde entró. El frontend bloquea
antes para que el operario no llegue al error.

**Diálogo (`RefundDialog.tsx`)** — propone método y moneda de lo que entró (`methodTouched` respeta la
elección del operario), muestra «Entró por: …», ofrece **«Usar «<método real>» (por donde entró)»** a un
toque, avisa en ámbar cuando la devolución sale del cajón y bloquea el guardado cuando el método no cobró.

**Libro Diario y cierre (`DailyLedger.tsx`)** — `hay(x) = |x| > 0.005` en lugar de `x > 0.005` para las
columnas condicionales y los handlers del detalle; chip de lo devuelto en la fila del día (`refund-dia`),
KPI «Devuelto» y línea `cierre-devoluciones` en el diálogo de cierre.

**`DailyTotals`** (Rust + `src/types.ts`) gana `refund_usd` / `refund_bs` **al final**, en positivo, como
dato **informativo**: los buckets por método ya vienen netos (la devolución es un movimiento negativo con
el método por el que salió la plata).

## 4. Datos de hoy (corrección aplicada)

Respaldo: `backup/registro_pre_fix_devolucion_20260917.db`. Se corrigió **por los comandos de la propia
app** (no por SQL a mano): se borró el movimiento mal anotado (`id 4`, −Bs. 1.697 por «Punto de Venta (Bs)»)
y se reanotó la devolución por **Pago Móvil** (el método con el que pagó el cliente).

| Cierre de hoy | Antes | Después |
|---|---|---|
| Divisas ($) | 43 | **43** (correcto) |
| Efectivo Bs. | 0 | 0 |
| Pago Móvil | 1.697 | **0** (entró y salió por el mismo canal) |
| Punto (Bs.) | **−1.697** (y la fila no se veía) | **0** |
| DEV-0001 | $5 · abonado $3 · Devuelto | igual (los movimientos ahora son Pago Móvil +1.697 / −1.697) |

## 5. Fuera de alcance (a propósito)

- **Editar el método de un pago ya anotado**: sigue siendo borrar y volver a anotar (documentado desde
  F35). Es lo que se hizo para corregir el día.
- **Reembolsos con tasa de otro día**: los refunds siguen con la fecha del turno abierto (F35/F36).

## 6. Pruebas

- `cd src-tauri && cargo test --release --lib` → **133/133** (test nuevo
  `test_refund_goes_back_by_the_method_that_collected`).
- `node tools/refund_math_test.ts` → **45/45** (13 comprobaciones nuevas: ingresos por método, default,
  bloqueo, cajón, resúmenes de moneda).
- EN VIVO: verificación del diálogo (propone Pago Móvil, bloquea el Punto) y del Libro (chip «Devuelto»,
  celda negativa visible y clickeable, línea en el cierre).
