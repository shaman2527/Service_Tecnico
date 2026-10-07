# Spec F37 — La moneda de cada método de pago sale de UNA fuente única (y un método inventado no se cobra)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Hallazgo **menor** de la revisión adversarial de F36 (2026-09-17), pendiente desde entonces:
`isBsMethod()` era **heurístico** — todo método que no trajera «USD»/«Zelle»/`$` se daba por bolívares.

---

## 1. Diagnóstico (con el código y los datos reales, sobre una copia)

| Pieza | Antes |
|---|---|
| `src/lib/utils.ts` → `isBsMethod` | `if (m.includes('USD') \|\| m.includes('Zelle') \|\| m.includes('$')) return false; return true;` — **todo lo demás es Bs** |
| `src-tauri/src/db.rs` → `normalize_payment_currency` | los 5 métodos en Bs y los 3 en USD eran listas literales; **cualquier otro método conservaba la moneda que le mandara la UI** (`if currency.is_empty() { "USD" } else { currency }`) |
| `db.rs` → `add_sale_tax` | guardaba el `currency` recibido **tal cual**; la única red era la **migración de arranque** (una venta nueva con la moneda cruzada quedaba mal hasta el próximo reinicio) |
| `db.rs` → `add_expense` | validaba el método contra la tabla `payment_methods`, que guarda **sólo el nombre** (sin moneda) |
| Base del taller (medida, 2026-10-06) | `payment_methods` = los 7 del sistema; ningún método propio (**hoy no hay dato en riesgo**) |

**El agujero:** un método propio del local («Binance», «PayPal», «Gripto») se mostraría en el selector
como **bolívares** (heurística del frontend) y el backend lo guardaría con la moneda que viniera, así que
la caja lo contaría **en bolívares**: el total del día en Bs se infla y se le aplica la conversión a un
método que no es en Bs. Es la misma clase de bug que F36 y F39 vinieron a cerrar (plata contada en la
moneda equivocada), pero por la puerta de la ADIVINANZA.

## 2. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** La moneda de cada método vive en **un solo archivo** (`tools/payment_methods.json`) que leen el backend (`include_str!`) y el frontend (import) | `payment_methods_test.ts` (54) + `test_f37_los_metodos_sembrados_estan_en_la_fuente_unica` |
| 2 | **[must]** El frontend **no adivina**: un método que no está en el archivo **no** es Bs (`methodCurrency` → `USD`, que es el fallback documentado del backend) | `payment_methods_test.ts` (BINANCE/PAYPAL/Gaveta…) |
| 3 | **[must]** Los 7 métodos que siembra la base están en el archivo (si no, la UI ofrecería algo que el backend rechaza) | test Rust sobre `payment_methods` sembrada |
| 4 | **[must]** El backend **RECHAZA** un método desconocido en las CUATRO puertas de plata (venta, abono, devolución, gasto) y **no escribe nada** (fail-closed) | `test_f37_metodo_desconocido_no_se_cobra` (con conteos de filas) |
| 5 | **[must]** La moneda **se deriva del método** también en las VENTAS (manda el método, no lo que mande la UI) — antes dependía de una migración al reiniciar | mismo test (venta «Pago Móvil» con `currency="USD"` → guardada `VES`; abono «Zelle» con `VES` → `USD`) |
| 6 | **[must]** El gasto **sin declarar** sigue permitido (`''`), y los alias de datos viejos («Pago Movil», «Zelle», «Punto de Venta») siguen reconociéndose | mismo test + `payment_methods_test.ts` |
| 7 | **[must]** Nada de lo verificado antes se rompe: el dinero sigue cuadrando | suite `cargo test --lib` 216/216 y las verificaciones EN VIVO (abajo) |
| 8 | **[should]** Los archivos de reglas puras (`payment-methods.ts`, `payment-math.ts`) siguen verdes | `method_picker_test.ts` 31/31 · `payment_math_test.ts` 404/404 |

## 3. Diseño

* **`tools/payment_methods.json`** (fuente única, con `_comment` que explica la regla): 10 entradas
  `{nombre, moneda}` — los 7 del sistema + 3 alias históricos («Pago Movil», «Punto de Venta», «Zelle»).
* **Rust** (`db.rs`): `metodos_canonicos()` (OnceLock + serde, con `assert!` de que la moneda sea USD/VES),
  `moneda_del_metodo(&str) -> Option<&'static str>`, `metodos_en_bs()` (la usa la migración de moneda
  histórica) y `validar_metodo_de_pago()` (**fail-closed**: método desconocido y no vacío → error con la
  lista de los válidos). `normalize_payment_currency` ahora se apoya en el mapa; para un método
  desconocido **conserva la moneda guardada** (datos viejos: reescribirla sería inventar).
* **Puntos de validación**: `add_sale_tax`, `add_service_payment`, `add_service_refund`, `add_expense`
  (este último reemplaza la consulta a `payment_methods`, que no tenía moneda).
* **Ventas**: `add_sale_tax` normaliza la moneda antes del INSERT (misma regla que abonos y devoluciones).
* **Frontend** (`src/lib/utils.ts`): `MONEDA_POR_METODO` desde el JSON importado; `esMetodoConocido`,
  `monedaDelMetodo`, `nombresDeMetodos`; `isBsMethod`/`methodCurrency` derivados (desconocido → `USD`).
  `tsconfig.app.json` gana `resolveJsonModule` (el bundler ya resolvía JSON; ahora TypeScript también).

## 4. Verificación (todo medido, sobre una COPIA con el PIN de pruebas)

* `cargo test --lib` **216/216** (8 ignorados) — 2 tests nuevos, **comprobado que muerden** (con
  `validar_metodo_de_pago` neutralizado, el test de F37 falla).
* `node tools/payment_methods_test.ts` **54/54** (nuevo) · `method_picker_test.ts` **31/31** ·
  `payment_math_test.ts` **404/404**.
* `tsc -b` 0 · `oxlint` 0 errores · `npm run build` ✓ · `cargo build` ✓.
* EN VIVO (copia de la base del taller, app de dev por CDP 9223): `verify_metodos_en_cobros` **16/16** ·
  `verify_wizard_metodos` **18/18** · `verify_devolucion_metodo` **7/7** · `verify_arqueo_f69` **39/39** ·
  `verify_f92_fecha_pago_cierre` **11/11** · `verify_tecnico_y_fecha_pago` **41/41** ·
  `verify_f94_abono_retroactivo` **19/19** · `verify_turno_viejo` **42/42** · `verify_smoke_integral` **110/110**.

## 5. Fuera de alcance (anotado)

* **Un método con moneda elegible desde la UI**: si el local quiere «Binance», hoy hay que agregarlo al
  archivo JSON con su moneda. La UI no tiene pantalla de métodos de pago (la tabla se siembra), así que
  el paso siguiente natural —si algún día la tiene— es guardar la moneda en `payment_methods` y derivar
  de ahí. Se deja anotado para no inventar una feature que nadie pidió.

## 6. Revisión adversarial (subagente, solo lectura) — 0 bloqueantes, 2 mayores + 4 menores, TODOS arreglados

El revisor midió además los métodos/monedas reales de `registro.db`, `dev_registro.db` y los 60+ `.db`
de `backup/` con `node:sqlite` en readOnly: **hoy no hay ningún dato en riesgo** (solo los 7 nombres
canónicos) y ningún camino vivo se rompe con el fail-closed (verificó el orden validar→escribir en las
4 puertas y que los pedidos a proveedor no llevan método).

| # | Hallazgo | Arreglo |
|---|---|---|
| **H1** (MAYOR) | `add_expense` validaba el método contra la fuente única pero **la moneda seguía viniendo de la UI** (desplegable independiente del método), y el ajuste del cajón decide el **bolsillo** por la moneda del libro: «Monto 5.000 + Moneda $ + Salió de: Efectivo Bs» bajaba 5.000 **dólares** del esperado y NO descontaba los bolívares que salieron del cajón | la moneda del gasto **se deriva del método** (`normalize_payment_currency`); «sin declarar» conserva la elegida. El desplegable de la UI **se sincroniza** con el método. Test: `test_f37_la_moneda_sale_del_metodo_en_todas_las_puertas` (los dos sentidos + el bolsillo que baja) |
| **H2** (MAYOR, latente) | el alias «Punto de Venta» a secas → VES entraba en `metodos_en_bs()`, que alimenta las **migraciones que reescriben datos en cada arranque** (`service_payments`/`sales`/`services` a VES + recálculo de todos los cierres): adivinar el Punto ($ o Bs) **mueve plata de un bolsillo a otro** | el alias ambiguo **salió** de la fuente única (quedan «($)» y «(Bs)»); el `_comment` del JSON explica por qué y el test lo fija (Rust + `payment_methods_test.ts`) |
| **H3** (MENOR) | el método **vacío** era el único «desconocido» que se cobraba y su moneda la decidía la UI: `?? ''` no atrapa `''`, así que una orden vieja sin método dejaba el selector vacío y el guardado habilitado | los tres diálogos caen al método del local cuando viene vacío (`PaymentDialog`, `CierreServiceDialog`, `Sales`); el backend sigue aceptando `''` para los datos históricos |
| **H4** (MENOR) | la UI podía **ofrecer** un método que el backend rechaza (la lista sale de la tabla, que un respaldo importado puede ensuciar) y la guarda solo miraba la base recién creada | `PaymentMethodPicker` filtra los desconocidos (sin esconder nunca el valor ya elegido) + **chequeo nuevo en `tools/release_gate.mjs`**: la plantilla que se empaqueta no puede ofrecer métodos fuera de la fuente única |
| **H5** (MENOR) | un archivo mal editado **no rompe el build**: la app se cierra al arrancar (panic, release sin consola) y una entrada sin `moneda` la descartaba Rust en silencio mientras el frontend la daba por USD | el parseo **valida entero y falla con mensaje claro** (nada de `filter_map` silencioso) + el gate de release valida el JSON (monedas USD/VES, sin repetidos, los 7 sembrados presentes) |
| **H6** (MENOR) | se validaba con el nombre **recortado** pero se guardaba el **crudo**: « Pago Móvil » pasaba y después no sumaba al bolsillo del Pago Móvil (caía en el efectivo) | las tres puertas guardan el nombre recortado (el gasto ya lo hacía). Test con «  Pago Móvil  » y « Efectivo Bs » |

Suite tras los arreglos: `cargo test --lib` **217/217** (8 ignorados) · `payment_methods_test.ts`
**56/56** · `day_shift_test.ts` **54/54** · gate de release **LISTO** (con los dos chequeos nuevos) y la
red EN VIVO completa verde (los números del bloque de verificación de arriba).

**Lección del cierre (dos pruebas que medían de menos, no el producto):** `verify_f94_abono_retroactivo`
comprobaba montos en DÓLARES (`total_usd`, `usd_cash_total`) mientras el diálogo arranca con el método
de la ORDEN (en esta copia «Pago Móvil», en bolívares): ahora **elige «EFECTIVO $» explícitamente**
antes de guardar, así que mide la regla de F94 y no el método del formulario. Y `verify_devolucion_metodo`
leía la tarjeta recién creada **sin recargar**: escribir por `__TAURI_INTERNALS__.invoke` saltea el bus de
datos (lección F90), así que la lista no se enteraba y la prueba fallaba con el producto perfecto.
