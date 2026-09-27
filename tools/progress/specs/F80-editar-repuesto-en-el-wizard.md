# F80 — Editar la ficha del repuesto DESDE EL WIZARD (el lápiz al lado de cada pantalla)

**Pedido del dueño (2026-09-26), textual:**

> «el cliente me pide como él usa la master debería tener poco más flexibilidad de poder, cuando se hace
> un registro para elegir un producto desde wizar algo pequeño un icono por ejemplo de la pantalla poder
> editarla hay mismo en wizard es como decir para no ir inventario buscar el producto y hacer la
> modificacion que tenga esa flexibilidad desde hay poder editar ese producto cambirle precio etc. asi el
> registro lo va depurando va cargando el inventario.»

## Decisiones confirmadas con el dueño (antes de implementar)

1. **Editor = atajo corto + ficha completa**: un diálogo con **Venta ($)**, **Efectivo ($)**, **Stock** y
   **Compatibilidad**, más un botón **«Ficha completa»** que abre el formulario de Inventario
   (`ProductForm`) **con lo ya escrito aplicado** — un solo editor en el sistema, sin copias.
2. **La compatibilidad se edita ahí mismo** («que también pueda editar la compatibilidad, se refleje en
   el inventario la edición»), con un toque directo **«+ Agregar "<modelo del equipo>"»** cuando ese
   teléfono no figura en la ficha: es lo que hace que el registro **depure** el catálogo.
3. **También se registra la pantalla que falta** («que me sirva, carga también nuevos stock»): cuando el
   modelo no tiene repuestos en el catálogo, el mismo diálogo abre en modo alta con el nombre
   «Pantalla <modelo>», la categoría Pantalla y la compatibilidad de ese modelo ya puesta.
4. **El stock se escribe directo, sin movimiento de inventario** (igual que hoy desde Inventario): una
   sola verdad en los dos lados. Queda anotado como deuda declarada.

## Problema / oportunidad

Elegir la pantalla ya estaba resuelto (F63/F65c/F67) y la lista mostraba **precio y stock** de la ficha.
Lo que faltaba era **corregir esa ficha en el momento**: si el precio estaba mal (o en 0), si el stock
no coincidía con el cajón, o si el repuesto servía para ese teléfono y el catálogo no lo decía, el
operario tenía que **abandonar el registro**, ir a Inventario, buscar el producto, editarlo y volver. El
dueño pidió exactamente lo contrario: que el registro **vaya depurando el catálogo**.

## Alcance (UI + 1 regla pura + 1 comando de LECTURA en Rust + pruebas; CERO migraciones, CERO SQL nuevo)

### REQ-1 — El lápiz, en cada fila de la pantalla

- En `ScreenPicker.tsx` (`ScreenSelect`), **cada fila** de la lista de compatibilidad y **cada resultado
  del buscador libre** termina con un **lápiz** (`Pencil`, 12 px) con
  `data-editar-producto="<id>"`, `aria-label` y `title` que dicen qué hace.
- La fila dejó de ser **un** `<button>`: ahora es un `<div>` con **dos** botones hermanos (elegir la
  pantalla — que conserva `data-screen-option`, el gancho que usan el formulario y las pruebas — y
  editar la ficha). Son dos acciones distintas y se ven distintas.
- **Solo con la sesión master**: el lápiz se dibuja con `puedeEditarProducto` (que el padre pasa desde
  `ab.manageCatalog`, la misma llave de Técnicos/Categorías). A la caja no se le muestra un botón que el
  backend va a rechazar (`require_owner` en `add_product`/`update_product`).

### REQ-2 — El atajo corto (`EditarProductoDialog`)

- **Venta ($)** · **Efectivo ($)** · **Stock** · **Compatibilidad** (teléfonos separados por «/», con
  vista previa en chips) y **«Ficha completa»**.
- Si el modelo del equipo **no figura** en la compatibilidad, un botón lo agrega (sin duplicar, sin
  perder lo que ya había) y dice si realmente lo agregó. Si ya figura, lo dice.
- **Guardar está apagado si no hay cambios** (`patchTieneCambios`): nada de guardados vacíos.
- Los campos que el operario **no** toca viajan **idénticos** (`argsUpdateProduct` toma la fila real):
  editar el precio no puede borrar el nombre, la marca, la compatibilidad ni el stock. Es la lección de
  `update_service`/`lib/service-update.ts` aplicada a los productos.
- **LA FILA VIVA (hallazgo BLOQUEANTE de la 1ª vuelta adversarial, medido en vivo):** la copia que llega
  desde la lista puede estar **vieja**, y armar los 12 argumentos con ella **revierte en silencio** lo
  que otro camino acaba de guardar (se midió: subir el precio a $25, después corregir la compatibilidad
  y el segundo guardado devolvía el precio a $20). Por eso la ficha se **RELEE al abrir** y **otra vez
  antes de escribir** (comando nuevo **`get_product`**, solo lectura) — la misma regla que ya sigue el
  guardado de órdenes (`actualizarEquiposCreados`). Si la ficha se borró mientras tanto, se avisa y no
  se escribe nada.
- **Lo que no se toca viaja tal cual, incluida la compatibilidad cruda:** una ficha con formato viejo
  (comillas raras, listas rotas) **no se reescribe** por corregirle el precio (`compatSiCambio` decide
  con una huella **insensible al orden** — `"A / B"` y `"B / A"` son la MISMA compatibilidad).
- **«Ficha completa»** abre `ProductForm` **sembrado con lo escrito** (precio, contado, stock y
  compatibilidad), así cambiar de vista no pierde nada; su **Cancelar vuelve al atajo** con lo escrito
  intacto. Desde el wizard el formulario va con **`permiteEliminar={false}`**: borrar la pantalla
  elegida dejaría `screen_product_id` apuntando a la nada y **la entrega fallaría** por FK (lo midió la
  revisión). Para borrar está Inventario.
- Nunca mudo: si el backend rechaza (sesión sin permiso, dato inválido) sale un toast con el motivo.

### REQ-3 — Registrar la pantalla que falta (con su stock)

- Con el modelo sin repuestos en el catálogo, el bloque vacío (`data-screen-vacio`) ofrece **«Registrar
  esa pantalla (con su stock)»** (y el buscador libre ofrece el mismo camino), que abre el diálogo en
  modo **alta**: nombre sugerido `Pantalla <modelo>`, **categoría del padrón** (Pantalla),
  **compatibilidad = ese modelo**, **Venta / Efectivo / Stock** y categoría elegible. Se guarda con
  `add_product` (dueño) y al volver la pantalla **aparece en la lista** para elegirla.
- **LAS CATEGORÍAS PRIMERO (hallazgo BLOQUEANTE de la 2ª vuelta adversarial, medido en vivo):** el
  diálogo se montaba con la lista de categorías todavía vacía, así que la **primera** pantalla de una
  sesión nacía con `category_id = NULL` y — como el wizard filtra las pantallas por categoría 1 —
  **no aparecía en la lista** aunque el toast dijera «registrada». Ahora el hook que abre el diálogo
  **espera las categorías** (8 filas: milisegundos) y el diálogo las re-resuelve por si llegan después;
  sin categoría el alta no se puede guardar y lo explica.
- **NO se crean fichas GEMELAS:** si ya existe una ficha con ese nombre, se avisa (`data-producto-existente`)
  y el botón se apaga. Dos fichas con el mismo nombre **parten el stock en dos** y el descuento de la
  entrega cae en una sola (medido: el alta sin esta guarda creó las fichas 1179 y 1180).
- Lo que el alta NO pide (costo, proveedor, stock mínimo, marca/modelo) queda en los valores por
  defecto y se completa después en Inventario: el diálogo lo dice.

### REQ-4 — La lista y el inventario se ponen al día solos

- Al guardar, el wizard **vuelve a pedir la compatibilidad** (`reload()` del hook
  `useCompatibleProducts`): la fila muestra el **precio y el stock reales** (sin números viejos).
- **El BUSCADOR LIBRE también (hallazgo MAYOR de la 2ª vuelta):** sus resultados y la **copia de la
  pantalla elegida a mano** (`screenExtra`) no se refrescaban, así que después de editar el precio
  quedaba el número viejo en pantalla y **se cobraba el viejo**. Ahora las dos cosas siguen al **bus de
  sincronización (F76)** (`useDataVersion`) y el wizard relee por id la pantalla elegida
  (`PantallaViva`): refresca precio/stock, **suelta** la elección si la ficha se borró y marca
  «elegida a mano» (F65c) si el repuesto dejó de figurar en la compatibilidad del modelo.
- **Inventario se refresca solo**: los comandos `add_product`/`update_product` empiezan con `add_`/
  `update_`, así que el bus avisa y la pantalla de Inventario se recarga sin tocar nada — no hubo que
  programar nada para «que se refleje en el inventario».
- `update_product` corre `rebuild_phones` en el backend: la compatibilidad editada también se refleja en
  el padrón de Modelos.

### REQ-5 — Las reglas de dinero NO cambian

- **El monto de la orden en curso no se mueve solo**: sigue la regla F67 (se **ofrece** «Usar precio de
  la pantalla $X» con un toque). Verificado en vivo **con el monto sin tocar** (lo había escrito el
  precio de la pantalla) y **con el monto tecleado**.
- Guardar la ficha (editar o registrar) **marca el monto como «escrito por el operario»**: a partir de
  ahí el precio nuevo **se ofrece, no se escribe**. Es la decisión conservadora del invariante «un monto
  nunca se mueve solo»; registrar una ficha que no existía tampoco puede mover el monto de nadie.
- El descuento, el IVA, la impresión, los abonos, el cierre del día y el inventario al entregar no se
  tocan: la feature escribe **fichas de producto**, nunca órdenes.

## Invariantes

1. **Editar la ficha no puede borrar el resto** (12 argumentos posicionales armados con la fila **RELEÍDA**).
2. **El dinero de la orden no se mueve solo** (ni al editar el precio, ni al registrar la pantalla, ni al
   recargar la lista).
3. **Nada se inventa**: sin cambios no hay guardado; un modelo vacío no agrega compatibilidad; un «+
   agregar» con el tope alcanzado dice la verdad (no agrega); una pantalla fuera de la categoría del
   padrón no se puede registrar.
4. **El gate es el del backend**: `require_owner` para escribir productos, y el lápiz solo se dibuja con
   la llave del dueño.
5. **El catálogo no se degrada ni se duplica**: lo que no se toca viaja tal cual (incluida la
   compatibilidad cruda de una ficha con formato viejo) y no nacen fichas gemelas.

## Pruebas

- `node tools/product_edit_test.ts` — **66/66** (lectura de la compatibilidad desde JSON o texto, sin
  duplicados y con tope que **no miente**, «agregar el modelo», nombre de la pantalla nueva, **los 12
  argumentos** con todo lo no tocado idéntico, «¿cambió algo?» sin falsos positivos por el orden y
  `compatSiCambio` que solo reescribe cuando el operario tocó de verdad la compatibilidad).
- `node tools/verify_editar_producto_wizard.mjs` (**NUEVA**, EN VIVO por CDP) — **54/54** (×2 corridas):
  el lápiz en cada fila y el cableado de la llave del dueño por inspección de fuente; el atajo arranca
  con los valores reales y no deja guardar sin cambios; la edición de precio+stock queda en la base con
  **el resto de la ficha intacto**; la fila se recarga con el precio nuevo; el monto **sin tocar** y el
  monto **tecleado** no se mueven y el precio nuevo se ofrece; **el alta como PRIMER diálogo de la
  sesión** nace con categoría real (verificada en la base) y aparece en la lista; el **duplicado** se
  avisa y no se permite; el lápiz del **buscador libre** edita, agrega el modelo a la compatibilidad y
  refresca la fila del resultado **y** la de la pantalla elegida; «Ficha completa» abre el formulario de
  Inventario **sin Eliminar** y su Cancelar vuelve al atajo con lo escrito intacto **sin guardar nada**;
  y al terminar **recarga la app** (no deja diálogos abiertos) y **deja el catálogo como estaba**.
- Regresiones EN VIVO (el markup de la fila cambió): `verify_precio_pantalla` 55/55,
  `verify_compat_pantalla` 12/12, `verify_pantalla_agotada` 16/16, `verify_imprimir_en_wizard` 44/44,
  `verify_wizard_metodos` 18/18, `verify_cobro_en_wizard` 81/81, `verify_servicio_cierre` 18/18,
  `verify_smoke_integral` 110/110.
- `cd src-tauri && cargo test --lib` **182/182** (8 ignorados) · `npx tsc -b` 0 · `npx oxlint` 0 errores ·
  `npm run build` ✓ · `cargo build --release` ✓.

## Deuda declarada

- **El stock editado no deja movimiento** en el historial de inventario (igual que hoy desde
  Inventario). Hacerlo con trazabilidad necesita un comando nuevo en Rust (no entra en esta feature).
- La pantalla registrada desde el wizard **no queda elegida sola**: aparece en la lista y el operario la
  elige con un toque (evita que un alta mueva el monto sin que nadie lo pida).
- Una compatibilidad **vieja y degradada** (con «/» dentro de paréntesis) puede partirse mal al
  reescribirla: es una convención que ya traía `ProductForm`, y ahora **solo** se reescribe si el
  operario toca el campo.
- Si la pantalla elegida se borra desde el wizard (imposible por la UI: no hay Eliminar, pero sí desde
  Inventario con la orden abierta en el otro equipo), el wizard **suelta la elección** y el guardado
  vuelve a pedir pantalla: se dice, no se rompe la entrega.

## Revisiones adversariales (2 vueltas, 3 BLOQUEANTES + 5 MAYORES + 14 menores — todos arreglados)

- **1ª vuelta (datos):** **[B]** sin relectura antes de escribir (revertía en silencio lo recién
  guardado) → comando `get_product` + relectura al abrir y antes de escribir; **[MAYOR]** la
  compatibilidad se mandaba siempre (degradaba formatos viejos) → `compatSiCambio`; **[MAYOR]** «Ficha
  completa» ofrecía Eliminar (rompía la entrega por FK) → `permiteEliminar={false}` + `PantallaViva`;
  menores: aserción vacua del estado vacío, caso «monto sin tocar», buscador/`screenExtra` viejos, alta
  duplicada, respaldo de `categoryId`.
- **2ª vuelta (producto, reproducida en vivo):** **[B]** la primera alta de una sesión nacía **sin
  categoría** y no aparecía en la lista → el hook espera las categorías + el diálogo re-resuelve + sin
  categoría no se guarda; **[MAYOR]** las ediciones hechas desde el buscador libre no se reflejaban
  (quedaba el precio viejo en pantalla y se cobraba el viejo) → `useDataVersion` en el buscador y en la
  compatibilidad + `PantallaViva`; **[MAYOR]** se podían crear **fichas gemelas** (medido: 1179 y 1180)
  → guarda por nombre; **[MAYOR]** el texto «el monto NO cambia solo» era falso cuando el monto lo había
  puesto F67 → marcar `amountTouched` al guardar la ficha y decir la verdad; menores: «Ficha completa»
  perdía lo escrito al cancelar, el estado vacío nombraba al dueño en una sesión de caja, el alta se
  ofrecía con el modelo vacío, y la pantalla elegida se callaba si la sacaban de la compatibilidad.

## Lecciones de prueba (en vivo, para las próximas)

- **Un equipo NUEVO del wizard ya nace con el trabajo «Cambio pantalla» marcado**: clickear el chip para
  «activarlo» lo **APAGA** y el bloque de la pantalla desaparece (lo midió una sonda). Se comprueba el
  bloque, no el chip.
- **El alta marca el monto del equipo como escrito**: los casos de «el monto no se mueve» se miden en un
  **segundo equipo** (el real: dos teléfonos en una recepción), no en el que se registró la ficha.
- **Con dos diálogos apilados, `[role="dialog"]` es el WIZARD**: hay que usar el **último** de la pila
  (`[...querySelectorAll('[role="dialog"]')].pop()`), sobre todo para «Cancelar», que existe en los dos.
- Tras guardar la ficha, la lista queda unos instantes en **esqueleto de carga**: se **espera el precio
  en la fila** (`waitFor`), no un `sleep` fijo.
