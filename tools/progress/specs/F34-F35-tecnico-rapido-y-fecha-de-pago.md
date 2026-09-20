# Spec F34 + F35 — Técnico rápido en la tarjeta · Fecha del pago

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Pedidos textuales del dueño (2026-09-17) al inicio de cada bloque.

---

## F34 — Cambio rápido de técnico desde la tarjeta

> «cuando en las tarjetas de servicios sea rápido, de manera que le dé clic al nombre del técnico o a
> la letra como tal que tiene la tarjeta, me dé la opción cambiar técnico rápido. Se refleje
> obviamente.»

### Criterios de aceptación
1. **[must]** En la lista de Servicio Técnico, el círculo de iniciales del técnico de cada tarjeta es
   **clickeable** (`data-tech-quick`, con `aria-label` y `title` «Cambiar técnico») y también lo es el
   nombre del técnico cuando la tarjeta lo muestra.
2. **[must]** Al hacer clic se abre un selector **rápido** (no el formulario completo) con la lista de
   técnicos del local (iniciales + color + nombre) y la opción **«Sin asignar»**.
3. **[must]** Al elegir, la orden queda guardada con ese técnico y **la tarjeta lo refleja** al
   instante (nombre + iniciales en el color del técnico). Se guarda por la **única vía** de
   actualización de órdenes (`updateOrderKeepingFields` con `technician`/`technicianId`): ningún otro
   campo de la orden se toca.
4. **[must]** Funciona en **cualquier estado** (asignar técnico no mueve stock, dinero ni fechas) y en
   **multi-equipo es por equipo** (cada renglón tiene su propio técnico).
5. **[must]** Si el técnico asignado fue borrado del padrón, el círculo gris con las iniciales del
   snapshot también permite reasignar.
6. **[should]** Escape cierra sin cambiar nada; el ítem elegido se marca como activo.

---

## F35 — Fecha del pago (que el abono caiga en la caja del día correcto)

> «ha estado pasando [que] cliente[s] dejan el tlf a reparar pero pagan ese mismo día y no lo
> notifican; entonces [cuando] dice que pagaron, [que] de alguna manera pueda editar o agregar la
> fecha de ese pago — ese mismo día, no el día anterior — porque a veces tiende [a] faltar dinero o
> sobrar al cerrar esa caja.»

**Problema medido:** `add_service_payment` **no recibe fecha**; la columna `payment_date` usa el
default `datetime('now','localtime')`. Un pago cobrado el 16 y anotado el 17 entra en la caja del 17:
el 16 cierra con **falta** y el 17 con **sobra**.

### Criterios de aceptación
1. **[must]** El diálogo de abono tiene **«Fecha del pago»** (input `date`, con tope **hoy**: no se puede anotar un pago futuro). **La fecha por defecto es la del TURNO ABIERTO** (`getActiveDay().close_date`), no «hoy» a ciegas — *corregido tras medir en vivo*: el turno abierto no siempre es de hoy y un abono fechado en un día sin turno no entra en ninguna caja. En el uso normal coincide con hoy.
2. **[must]** `add_service_payment` recibe esa fecha; vacía = hoy (comportamiento histórico intacto
   para los llamadores viejos).
3. **[must]** Existe `update_service_payment_date(id, date)` — comando **angosto** (una columna) para
   **corregir** la fecha de un pago ya anotado, y **recalcula `paid_amount`** (la tasa BCV del día
   cambia la conversión Bs→USD).
4. **[must]** **Guarda de día cerrado (la clave del pedido):** un pago solo puede anotarse/moverse a un
   día que tenga un turno (`daily_closings`) **abierto** (`is_closed = 0`). Si el día está cerrado, el
   error dice el camino real: *Libro Diario → Cierres → ↺ abrir ese día → anotar el pago → volver a
   cerrarlo*. Así el **arqueo guardado nunca queda mintiendo** (nada de totales que cambian después
   del cierre). Si el día no existe → error («no hay turno con esa fecha»).
5. **[must]** La fecha **no puede ser futura** (backend y UI).
6. **[must]** Un pago en **Bs** usa la tasa BCV **del día del pago** (no la de hoy) para su
   equivalencia en `paid_amount`; sin tasa para ese día el pago en Bs se **rechaza** con el aviso de
   siempre (actualizar la tasa de ese día).
7. **[must]** La **edición** de la fecha solo se permite cuando **el día de origen y el de destino**
   están abiertos: mover un pago fuera de un día ya cerrado también dejaría ese cierre mintiendo.
8. **[should]** El diálogo avisa en ámbar cuando la fecha **no es hoy** («este abono entra en la caja
   del …»), y el historial de pagos permite **editar la fecha** de cada renglón.
9. **[must]** El historial del diálogo, el panel de pagos del formulario y la pestaña **Pagos** del
   Libro Diario muestran la fecha real de cada pago (hoy ya la muestran: no debe romperse).
10. **[should]** Los **refunds** se quedan como están (la plata sale el día en que se devuelve; ya está
    documentado) — fuera de alcance a propósito.

### Riesgos y no-objetivos
- **No** se re-abre ni se re-cierra un día automáticamente: el operario lo hace desde el Libro Diario
  (un cierre recalculado en silencio sería peor que el descuadre).
- **No** se permite editar el monto ni el método de un pago ya anotado (para eso está borrar y volver
  a anotar): esta feature es SOLO la fecha.
- Compatibilidad: el frontend viejo que no manda fecha sigue funcionando; los pagos históricos no se
  tocan.

### Evidencia de verificación
- `cargo test --lib` **126/126** con el test nuevo `test_payment_date_lands_on_the_right_day`: fecha vacía = hoy; un pago de ayer entra en la caja de ayer y **no** en la de hoy; corregir la fecha mueve la plata entre cajas conservando `paid_amount`; **conversión en Bs con la tasa DEL DÍA del pago** (Bs 4.050 a tasa 40,5 = $100, no $81); el pago del día **conserva la hora** y el retroactivo se guarda solo con la fecha; y rechazos con su mensaje para futuro / día cerrado / día sin turno / formato inválido / fecha inexistente (`2026-02-31`) / pago inexistente / Bs sin tasa de ESE día.
- **`node tools/verify_tecnico_y_fecha_pago.mjs` 25/25 EN VIVO**: campo de fecha con la del turno, aviso de caja, abono guardado en el turno abierto, corrección de fecha por la UI, **«Sin asignar» desasigna de verdad** (technician_id → null) y **cambiar el técnico de una orden ENTREGADA conserva su `date_out`** (los dos bloqueantes).

---

## 2ª vuelta — revisión adversarial (2026-09-17) y lo que se arregló

**BLOQUEANTES**
1. **Cambiar el técnico de una orden ENTREGADA reescribía `date_out` = HOY.** `updateOrderKeepingFields`
   mandaba `dateOut: ''` y el backend interpreta «vacío» como *estampá hoy* cuando el estado es
   Entregado: el monto de esa orden se mudaba de la caja del día de la entrega (ya cerrada, con arqueo
   guardado que no se recalcula) a la de hoy — el descuadre que reporta el dueño—, reiniciaba la
   garantía de 7 días y la metía en «Entregados hoy». Fix: el helper conserva la fecha que ya tiene la
   orden (`patch.dateOut ?? s.date_out`) y **solo el camino «Entregar» pasa `''` a propósito**.
2. **«Sin asignar» no desasignaba** (`patch.technicianId ?? s.technician_id`: `null` caía al id viejo →
   `technician` NULL con `technician_id` del anterior, la tarjeta no cambiaba y el toast mentía). Fix:
   `patch.technicianId !== undefined ? … : …`.

**MAYORES**
3. **Todos los pagos nuevos perdían la HORA** (el detalle de pagos del Libro Diario tiene columna Hora):
   ahora el pago **del día** guarda fecha y hora, y el **retroactivo** solo la fecha (la hora real del
   cobro de ese día es desconocida) — la columna muestra «—» en vez de un «00:00» inventado.
4. **Tope de la devolución vs. tasa del pago:** con tasas distintas entre días, devolver los mismos Bs.
   deja un saldo fantasma. **No se cambió el modelo de dinero en caliente**: queda como **feature 36
   (pendiente)**, con el caso medido y la decisión de negocio que falta.
5. **El remedio del error («↺ abrí ese día → anotá → volvé a cerrarlo») no se podía completar:** con dos
   turnos abiertos, el único «Cerrar Día» apuntaba al más reciente. Fix: botón **«Cerrar» por fila** en
   Libro Diario → Cierres, para cualquier día que esté abierto (`close_day` ya aceptaba cualquier fecha).
6. **Regresión en el asistente de cierre (F30):** mandaba `''` = hoy; si el turno abierto era de otro
   día, el cobro se rechazaba y el operario **no podía cobrar ni entregar**. Fix: usa la fecha del turno
   abierto, igual que el diálogo de abono.
7. **Doble abono:** Ctrl+Enter no miraba `savingPay` y el `refresh()` fallido dejaba el diálogo abierto
   con el monto cargado (reintentar = segundo pago idéntico). Fix: corte por `savingPay`, cierre del
   diálogo apenas el pago se guarda y aviso aparte si falla el refresco.

**MENORES arreglados:** fecha inexistente (`2026-02-31`) se rechaza por calendario (antes moría en «no
hay un turno con esa fecha»), los renglones de **devolución** ya no ofrecen corregir fecha (mover una
devolución cambiaría dos cajas), `cambiarTecnico` corta si ya está guardando, `aria-current` en la
opción activa del selector.

**Verificado OK por la revisión:** formato/futuro en `payment_date_ok`; guardas de día cerrado en los
dos sentidos; conversión Bs por día del pago en `recalc_paid_amount`; que el cambio de técnico no toca
stock ni las señales de política; y que el botón del técnico no anida botones ni rompe el foco.
