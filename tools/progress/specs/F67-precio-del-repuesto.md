# Spec F67 — El precio del repuesto: al elegir la pantalla se toma SU precio de venta

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Pedido del dueño (2026-09-23), en la parte de **SERVICIOS**, con la app en la mano:

> «Quiero que en el servicio cuando yo seleccione una pantalla pueda tomar el precio de venta de ese
> producto, o se puede seguir usando también el que tengo al lado de modelos.»
> «Que se pueda tomar los precios del producto.»

---

## 1. El pedido, en una frase

Cuando el operario **elige la pantalla** que va a instalar, el **precio de venta de ESA ficha**
tiene que poder pasar al **Monto ($)** del servicio — sin perder el camino que ya existe (el precio
que sale de los repuestos del **modelo**).

## 2. Diagnóstico (medido en el código, no supuesto)

| # | Qué se midió |
|---|---|
| D1 | `ScreenSelect` **muestra** `price_sale` en cada fila (`ScreenPicker.tsx:158`), pero elegir una pantalla **no toca el monto**: `onChange` solo guarda `screenProductId`. El precio de la pantalla es un dato decorativo. |
| D2 | El único camino de precio es `applyModelPrice` (`Services.tsx:1619`), y corre dentro de `selectModel` con **`candidates` viejo**: `selectModel(label)` hace `setModel(label)` y **en la misma pasada** lee `candidates`, que todavía es la lista del modelo ANTERIOR (o vacía). Consecuencia: elegir un modelo casi nunca llena el monto y, al cambiar de modelo, aplica los precios del modelo que se acaba de dejar. |
| D3 | `applyModelPrice` en efectivo (`Divisas (USD Cash)`) hace `amount = price_usd` y `discount = price_sale − price_usd`. Como el formulario guarda `amount − discount` (`Services.tsx:2541/2557`), el Total queda **2·contado − lista**: con lista 28 y contado 25 el cliente paga **22** en vez de 25. Latente hoy (ningún producto tiene `price_usd > 0`: medido en `registro.db`, `dev_registro.db` y la plantilla), pero es plata mal cobrada el día que carguen el precio de contado. |
| D4 | En **EDICIÓN** el monto se carga de la orden (`amount + discount_amount`) y `amountTouched = true` (`Services.tsx:2357-2360`), así que el efecto de auto-precio no puede volver a aplicar nada — pero tampoco existe **ninguna** forma de tomar el precio de una ficha en una orden ya guardada (una orden de $0 se queda en $0 salvo que se teclee el número). |

## 3. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** Al elegir una pantalla, su **precio de venta** pasa al Monto del servicio (si el operario todavía no escribió un monto) | En vivo: elegir una ficha con `price_sale` P de la lista → el input del Monto dice P (comparado contra la BASE) |
| 2 | **[must]** Si el operario **ya escribió** un monto, NUNCA se le pisa: la pantalla ofrece un botón de un toque «Usar precio de la pantalla $P» | En vivo: monto 99 a mano → elegir pantalla → el monto sigue 99 y aparece el botón; un clic → 99 → P |
| 3 | **[must]** El precio del **modelo** sigue funcionando como respaldo (pantalla sin precio cargado) y como botón para volver | En vivo: ficha con `price_sale = 0` → el monto no se toca y se dice por qué; con precio de modelo disponible aparece «Usar precio del modelo $M» |
| 4 | **[must]** El precio sale del **producto correcto** (el bug D2): elegir el modelo A y después el B usa los repuestos de B, nunca los de A | En vivo: dos modelos con precios distintos → el monto detrás de cada uno es el de SU grupo de repuestos (contra la BASE) |
| 5 | **[must]** En efectivo el Total es el **precio contado** (no `2·contado − lista`): Monto = lista, Descuento = lista − contado, Total = contado | `screen_price_test.ts` (regla pura) + en vivo con una ficha que tenga `price_usd` |
| 6 | **[must]** La pantalla solo aporta precio si el trabajo incluye **«Cambio pantalla»**: con otro trabajo (p. ej. batería) la pantalla es informativa y no mueve el monto | `screen_price_test.ts` + en vivo: destildar «Cambio pantalla» con una pantalla elegida → el monto no cambia por eso |
| 7 | **[must]** Una orden **ya guardada** nunca cambia de monto sola: en edición solo se ofrecen los botones | En vivo: abrir una orden de $30 → elegir otra pantalla → el monto sigue 30; el botón lo cambia a mano |
| 8 | **[must]** La precedencia es pantalla > modelo > lo escrito a mano, y la pantalla se dice en la pantalla («Precio de «Pantalla X»» / «Precio del modelo») | En vivo: el rótulo `data-precio-fuente` dice de dónde salió el monto que está en el campo |
| 9 | **[must]** No bloquea nada: el guardado, los gates de F47 (pantalla agotada), el gate de pantalla elegida y el descuento quedan igual | `verify_pantalla_agotada`, `verify_compat_pantalla`, `verify_descuento`, `verify_wizard_metodos` |
| 10 | **[should]** La fila de la lista muestra el precio que **se va a tomar** (en efectivo, el precio contado, con la lista al lado) | En vivo: con método de efectivo y una ficha con `price_usd`, la fila muestra el contado |

## 4. Implementación

- **`src/lib/screen-price.ts` (NUEVO, puro — una sola regla para los dos caminos):**
  - `partPrice(p, isDivisas)` → el número que se cobra por una ficha (contado si está cargado y el
    método es efectivo; si no, venta; `null` si no hay precio).
  - `priceFields(p, isDivisas)` → `{ amount, discount }` del formulario: **Monto = precio lista,
    Descuento = descuento por pagar en efectivo, Total = Monto − Descuento = precio contado**.
  - `groupPriceFields(products, isDivisas)` → el precio del grupo de repuestos del modelo (el
    respaldo): el contado más bajo si hay, si no el único precio de venta positivo del grupo.
  - `pricePatch(fields, touched)` → lo que se puede aplicar sin pisar lo que el operario escribió.
  - `priceSource(amount, pantalla, modelo)` → de dónde salió el monto (`pantalla` · `modelo` ·
    `manual` · `vacio`) y `sameMoney` (comparación al centavo) para decidir si hay algo que ofrecer.
- **`Services.tsx` (los DOS formularios):**
  - `applyModelPrice` deja de existir: el precio del modelo sale de `groupPriceFields` sobre
    `candidates` YA cargados (arregla D2) y del precio de la **pantalla elegida** cuando el trabajo
    incluye «Cambio pantalla» (D1).
  - El monto se aplica en un **efecto** (no dentro de `selectModel`), solo si el operario no tocó el
    monto ni el descuento.
  - Debajo del campo Monto: el rótulo de la fuente y los botones de un toque (`data-usar-precio-pantalla`,
    `data-usar-precio-modelo`), y el aviso honesto cuando la ficha elegida no tiene precio cargado.
  - En **EDICIÓN** no hay auto-aplicación (una orden guardada no cambia de monto sola): solo botones.
- **`ScreenPicker.tsx`:** prop `efectivo` para que la fila muestre el precio que **se va a tomar**
  (contado) con la lista al lado cuando difieren.

## 5. Pruebas

| Prueba | Resultado |
|---|---|
| `node tools/screen_price_test.ts` (regla pura) | **45/45** |
| `node tools/verify_precio_pantalla.mjs` (EN VIVO, ×2 determinista) | **52/52** |
| Regresiones en vivo (F31/F32/F45/F47/F49/F63/F66) | wizard_metodos 18/18 · descuento 15/15 · compat_pantalla 12/12 · pantalla_agotada 16/16 · recordatorios 67/67 · servicio_cierre 18/18 · tecnico_y_fecha_pago 41/41 · uso_modelos 37/37 · smoke_integral **110/110** |
| `npm run build` · `tsc -b` · `oxlint` · `cargo test --lib` | ✓ · 0 · 0 errores · **146/146** (8 ignorados) |
| `harness_security` · `harness_truth` | PASS · PASS (`harness_review` no corre: falta `tools/reviewer/parallel-review.ts` en la copia embebida → revisión adversarial con subagentes, como en las features anteriores) |

La verificación en vivo **prepara su propio fixture** (le carga un `price_usd` a una ficha) y lo **devuelve pase lo que pase** (`process.on('exit')`), **rechaza correr contra `registro.db`** y limpia los restos de una corrida anterior. La comprobación 8 crea una orden de prueba por IPC ($0, sin pantalla), le toma el precio de una ficha con el botón, **la guarda** con «Actualizar Servicio» y lee la base (`amount` = precio contado, `discount_amount`, `screen_product_id`) — y después la borra.

## 6. Revisiones adversariales (2 subagentes) y arreglos

| # | Severidad | Qué pasaba | Arreglo |
|---|---|---|---|
| 1 | **BLOQUEANTE** | El descuento calculado del efectivo se aplicaba **sobre el precio que escribió el operario**: Monto 99 + ficha lista 28/contado 25 → Total **96** | El descuento calculado **viaja con el monto sugerido** (`pricePatch`); al teclear el monto, el descuento calculado **se va** (`amountTypedPatch`). El descuento **suyo** (tecleado o tomado con el botón) nunca se toca |
| 2 | MAYOR | Aserción vacua: el oráculo del «precio del modelo» se comparaba contra el grupo ya contaminado por el fixture | Se compara contra el grupo correcto y se **exige que NO haya chip** cuando el grupo no tiene un precio único |
| 3 | MAYOR | El chequeo del criterio 6 **no podía fallar** (tecleaba el monto antes: con el monto tocado ninguna rama escribe) | Se hace en un **equipo nuevo con el monto sin tocar** y se exige que elegir una ficha con precio distinto (12.5 vs grupo 8.75) **no lo mueva** |
| 4 | MAYOR | `divHints` era una **segunda** implementación del precio y podía contradecir el rótulo | **Eliminada**: el rótulo de `PrecioRepuesto` dice la verdad de lo que se escribió (contado incluido) |
| 5 | menores | aviso «sin precios» con `price_sale` crudo; pie de EDICIÓN con el monto lista como deuda; `asPhoneEntry` muerto; faltaba un gancho por equipo en el DOM | decidido con la regla de precio; Total/Saldo = monto − descuento; borrado; `data-device` |

**Aceptado y documentado (no es defecto):** cambiar el **método de pago** recalcula el descuento del efectivo (es el precio contado; la regla de «el descuento se conserva con cualquier método» sigue valiendo para el descuento **del operario**).

## 7. Invariantes (lo que NO se hace)

1. **Nunca se pisa lo que el operario escribió** (`amountTouched`/`discountTouched`).
2. **Una orden guardada no cambia de monto sola.**
3. **El precio sale del producto elegido** — y si no tiene precio, no se inventa nada: se dice.
4. **La pantalla solo aporta precio si el trabajo es «Cambio pantalla»** (y destildarlo no re-precía en silencio).
5. **El descuento calculado es parte de la oferta**, no un descuento sobre cualquier número.
6. **De la lista de candidatos de OTRO modelo no se saca plata** (`compatAlDia`).

## 8. Pendiente anotado (fuera de alcance)

Si se cambia de modelo y el nuevo **no tiene ningún precio** en el catálogo, un monto que había escrito la regla **queda como estaba** (ahora sale el aviso «Revisá el monto: este modelo no tiene un precio único»), y la **pantalla elegida de otro modelo sigue viajando en `screen_product_id`** (comportamiento viejo: `autoScreen` no la suelta al cambiar de modelo). Es una decisión de UX (¿se limpia el precio automático? ¿se suelta la pantalla elegida?) que merece su propia feature.

