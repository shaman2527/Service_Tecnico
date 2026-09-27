# F79 — Cobrar dentro del wizard: el botón de pago en el paso 2, al lado del color del equipo

**Pedido del dueño (2026-09-26), textual:**

> «El botón de pago en servicio también que aparezca en el wizard, que en el mismo wizard podamos
> cobrar sin problema. Lo está viendo en la parte número 2 del wizard, en Equipo. Logró meter el botón
> profesionalmente en el flujo cuando se está creando el servicio al cliente: hay un espacio al lado
> del color de equipo, meterlo ahí. Pero si revisa arriba te sale método de pago también: esté todo
> bien ordenado, óptimo, no sea confuso. Para poder cobrar al cliente, seguir el proceso del wizard.
> Y dejamos la misma opción como la tenemos actualmente.»

## Decisiones confirmadas con el dueño (antes de implementar)

1. **Mecanismo = «Guardar y cobrar».** El botón del paso 2 **crea la orden** con lo cargado y abre **el
   mismo diálogo «Pago / Abono» de la tarjeta**; el registro **sigue** (paso 3 Blindaje y paso final) y
   ese «Guardar» **actualiza** la orden creada, **sin duplicarla**.
2. **La opción de siempre no cambia**: la tarjeta conserva su botón «Pago / Abono» y el paso «Cierre»
   de la edición su «Registrar Pago / Abono», tal cual están hoy.

## Problema / oportunidad

El cobro existía **solo con la orden ya guardada** (el diálogo de abono necesita `service.id`), así que
en el mostrador el operario tenía que: cargar el equipo, llegar al final del wizard, guardar, buscar la
orden en la lista y recién ahí cobrar. El método de pago, en cambio, ya se elegía **al principio del
paso del equipo** (F77b) — se acordaba cómo pagaba y no se podía cobrar hasta el final.

## Alcance (UI + regla pura + pruebas; CERO Rust, CERO SQL, CERO migraciones)

### REQ-1 — El botón, en el paso 2 y al lado del color

- Componente nuevo `CobroEnWizard` (`src/components/Services.tsx`) con ganchos
  `data-cobro-wizard="crear|editar"`, `data-action="cobrar-equipo"`, `data-cobro-estado="<tono>"`,
  `data-cobro-aviso`.
- **ALTA:** dentro de la **tarjeta de cada equipo**, en el **mismo bloque del «Color del equipo»**,
  debajo del selector de color (`[data-device]` → el bloque del color). La etiqueta lleva **el monto de
  ESE equipo**: `Cobrar $30.00` (con `totalACobrar`, la misma cuenta que se guarda: monto − descuento
  + IVA si corresponde).
- **EDICIÓN:** en el **mismo lugar** del paso «Equipo»; etiqueta `Cobrar / Abono`.
- **ORDEN, no confusión:** el botón **no repite** nada de lo que ya está arriba — el **método de pago**
  sigue en su bloque (`data-device-pay`, dentro de la tarjeta, arriba del modelo) y el **acuerdo**
  («paga ahora / al retirar») en su bloque de política. La caja de cobro tiene **un solo control** (el
  botón): nada de un segundo selector de método ni de un segundo diálogo de pago.
- El aviso ámbar del paso ahora explica el flujo completo: método → monto → color → **«Cobrar»**.

### REQ-2 — «Guardar y cobrar» (alta)

- `guardarOrden({ cobrarEquipo })` es la **única** función de guardado: la usan el botón del último
  paso, **Ctrl+Enter** y el botón de cobro. La validación vive en `bloqueosDeGuardado()` (una sola
  lista; antes estaba embebida en `save()` y el botón nuevo habría tenido que repetirla).
- Al tocar «Cobrar»: se valida (misma lista que el guardado), se **crea la orden** con `addServiceOrder`
  (transaccional, como siempre), se abre **el mismo `PaymentDialog`** sobre la fila de **ese** equipo
  (`setSvc(fila)` + `setShowPayDialog(true)`) y **el wizard NO se cierra**.
- Si falta algo, el clic **no es mudo**: el pie dice `No se guardó — falta: …` **y** el aviso aparece
  al lado del botón (regla F31: decir qué falta en vez de un botón apagado sin explicación). Tampoco se
  crea ninguna orden.
- **Re-cobro / segundo equipo:** si la orden ya existe, primero se **actualiza** con lo que el
  operario haya cambiado y **después** se abre el cobro — nunca se cobra un monto viejo.

### REQ-3 — No duplicar la orden (los equipos ya guardados se ACTUALIZAN)

- Estado nuevo `ordenCreada = { base, rows }` (`rows` **en orden de equipo**: base, base-A, base-B…,
  el orden con el que el backend numera) con helper puro-local `filasEnOrdenDeEquipo`.
- Con la orden creada, el guardado del último paso entra por la rama **nueva** `else if (ordenCreada)`
  → `actualizarEquiposCreados`: **una actualización por fila** con `updateOrderKeepingFields`
  (`lib/service-update.ts`), la **única vía permitida** para actualizar una orden desde la UI.
  - `OrderPatch` se **extiende** (todo opcional, `undefined` = conservar): `client`, `phone`,
    `clientCi`, `clientAddress`, `model`, `fault`, `color`, `deviceChecklist`, `bankFeePercent`,
    `zelleReference`.
  - Se **relee la fila** antes de escribir (no pisa lo que cambió otra pantalla) y el patch **no
    manda** `date_out` ni `observations`: la fecha de entrega y las observaciones de la orden se
    conservan.
  - **El dinero ya cobrado no se toca**: `update_service` no escribe `paid_amount` ni los pagos.
- **Con la orden guardada no se agregan ni se quitan equipos** desde el wizard (el mapeo fila ↔ equipo
  no se puede romper): los botones quedan apagados y se dice por qué, con el camino real («Nuevo
  Servicio» / la tarjeta).
- Toda la UI lo dice sin ambigüedad: **aviso verde** con el **número real** de la orden y las líneas
  por equipo (`data-orden-guardada`, `data-cobro-equipo`), el pie cambia **«Cancelar» → «Cerrar»**
  («cerrar no la borra») y el botón del último paso pasa a **«Actualizar orden»** / «Actualizar e
  imprimir». El número que se ve en el paso Cliente pasa a ser el **real** (antes era el «próximo»).

### REQ-4 — El cobro se ve en el wizard (y no se inventa nada)

- Junto al botón aparece el **estado del dinero** (regla pura `lib/wizard-cobro.ts`):
  `Por cobrar $30.00` → `Cobrado $1.00 · saldo $29.00` → `Cobrado $30.00 · sin saldo` →
  `a favor del cliente $5.00`, y `La orden está devuelta/cancelada: no admite cobros.` (con el botón
  apagado, en vez de abrir un diálogo que el backend va a rechazar).
- **Antes de que la orden exista NO se muestra ningún estado** (no hay nada que contar: el botón lleva
  el monto y listo). Una orden de **$0** no es un error (garantía/cortesía) y el texto lo dice.
- Tras cobrar, el paso 2 y el resumen del último paso muestran lo cobrado **al instante** (la fila se
  refresca cuando el diálogo avisa que guardó).
- En **edición**, si el monto escrito no es el guardado, un **aviso** lo dice antes de cobrar (el cobro
  trabaja sobre la orden guardada): aviso, nunca bloqueo.
- **En edición el cobro NO guarda nada** (idéntico al «Registrar Pago / Abono» del último paso).

### REQ-5 — Lo que NO cambia

- `PaymentDialog` **sin tocar** (mismo diálogo, misma matemática de moneda/tasa/Punto, misma fecha del
  pago, mismo gate de día abierto).
- La tarjeta, sus botones, la cola de avisos, la impresión al guardar y el backend: intactos.
- Los **recordatorios de política** siguen saliendo **al cerrar el registro** (no al cobrar): el set se
  calcula fresco en el guardado final, así no se pide la foto de entrada que el operario acaba de
  marcar en el paso Blindaje.
- En **edición** se conserva el comportamiento de siempre: guardar un abono desde el wizard cierra el
  registro (igual que hoy con el botón del último paso).

## Invariantes

1. **Una sola forma de cobrar**: el diálogo de siempre. El botón nuevo no es un segundo sistema.
2. **El wizard no duplica órdenes**: una vez guardada, todo guardado posterior es un UPDATE.
3. **Nada estimado**: el estado del dinero sale de la fila (`amount`, `paid_amount`), jamás de lo que
   se esperaba cobrar; sin orden guardada no se muestra estado.
4. **El dinero ya cobrado es intocable** desde el wizard (ni `paid_amount` ni los pagos ni la fecha de
   entrega ni las observaciones).
5. **El mapeo fila ↔ equipo no se puede romper**: con la orden guardada no se agregan/quitan equipos.
6. **Los avisos no bloquean** (F31/F32): falta algo → se dice y no se guarda; se puede seguir.

### REQ-6 — Lo que agregó la revisión adversarial (2ª vuelta)

- **Candado de reentrada (BLOQUEANTE):** `guardarOrden` corta con un **`useRef`** (`guardandoRef`) además
  del estado `saving`, porque dentro de la MISMA tarea tres clics ven `saving = false` y creaban **tres
  órdenes** por el mismo registro (reproducido en vivo). El botón también queda `disabled` mientras hay un
  guardado en curso.
- **En EDICIÓN el cobro NO guarda nada** (REQ-4 se cumple literal): se había intentado «guardar y cobrar»
  también ahí y el revisor mostró el efecto de dinero que eso habilita (un formulario en «Entregado»
  descontaba stock y estampaba la fecha de entrega aunque después se cancelara el pago). El problema de
  fondo —no perder lo escrito cuando el pago cierra el registro— se resolvió con **`cobroDesdePaso2`**: el
  pago abierto desde el paso 2 **no cierra** el wizard; el botón del último paso conserva su
  comportamiento de siempre.
- **Aviso de monto según el modo:** `avisoMontoPendiente` (alta: se guarda y se cobra lo escrito) y
  `avisoMontoSinGuardar` (edición: se cobra lo guardado). Un solo texto para los dos habría mentido en uno.
- **Aviso por equipo:** `cobroAvisoEn` dibuja el fallo **solo bajo el botón del equipo que se tocó**; el
  texto de «equipos fijos» aparece **una vez** en el paso (no una por equipo).
- **Recordatorios al cobrar:** la recepción ya quedó guardada al cobrar, así que los avisos de política
  (foto de entrada + acuerdo de pago) salen también ahí, no solo al cerrar el registro.
- **Cobertura MULTI-EQUIPO en vivo** (el caso normal del local): se cobra el equipo 2 de una orden de dos
  teléfonos y se comprueba el mapeo `base` / `base-A`, que el cobro abre la fila de ESE equipo con SU
  monto, que el abono queda en un solo equipo, el bloqueo de agregar/quitar equipos y que el cierre
  actualiza las dos filas sin duplicar.
- **Aserciones vacuAS eliminadas** de la prueba en vivo (método comparado por igualdad y contra la fila,
  «Pago / Abono» buscado dentro de la tarjeta, borrado del cliente comprobado, «no guarda» comparando la
  fila) y **triple clic en la misma tarea** como regresión del candado.
- **Deuda técnica declarada:** `update_service` no verifica filas afectadas (una orden borrada desde otra
  pantalla daría «actualizado» sin escribir; el cobro posterior sí falla, así que no hay riesgo de plata).

## Pruebas

- `node tools/wizard_cobro_test.ts` — **60/60** (etiquetas, estado del dinero con números reales,
  estados finales, aviso de la orden guardada, equipos fijos, monto sin guardar, y que ningún texto
  invente bolívares).
- `node tools/verify_cobro_en_wizard.mjs` (**NUEVA**, EN VIVO por CDP) **81/81** — el flujo completo: el botón en
  el bloque del color y el método arriba, el clic sin datos que avisa y no guarda, la orden creada con
  su número + el diálogo de cobro con el método del equipo, el abono de $1 real en la base, el estado
  «Cobrado $1.00 · saldo $29.00», el paso final que **actualiza** (monto 30 → 40 con el abono intacto),
  los recordatorios al cerrar, y la edición con el mismo botón sin guardar nada.
- Regresiones: `verify_imprimir_en_wizard`, `verify_wizard_metodos`, `verify_recordatorios`,
  `verify_tecnico_sin_asignar`, `verify_precio_pantalla`, `verify_smoke_integral`, `tsc -b`,
  `oxlint`, `npm run build`.
