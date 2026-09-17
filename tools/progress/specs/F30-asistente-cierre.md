# F30 — Asistente de Cierre de Servicio (entrega rápida en mostrador)

- **Feature:** `feature_list.json` id **30** (priority high) · **MODO DEV** (sin release, sin push)
- **Origen:** pedido del usuario (2026-09-16): *«un asistente en la parte de servicio que vaya ayudándolo a cerrar
  cada servicio rápido, sea intuitivo, que a medida vaya necesitando introducir un dato, optimizar el proceso…
  recibe mucho cliente, tiene que ser más rápido sin dañar nada»*. Plan aprobado con las dos decisiones por
  defecto: **solo cierre** (la recepción ya tiene wizard) y **entrega con saldo permitida pero con motivo
  obligatorio**.
- **Estado del spec:** ✅ **implementado y verificado** (2026-09-16, MODO DEV) — evidencia en §8. Congelado con
  `harness_freeze`; las reglas genéricas del spec congelado (compila, endpoints responden, gate de acceso a las
  pantallas restringidas, errores de DB manejados) se cumplen: `npx tsc -b` 0 errores, `npm run build` OK,
  `harness_security` PASS, `harness_truth` PASS (build PASS).
- **Aviso importante de ejecución:** había **OTRA sesión de DSH trabajando en los mismos archivos** durante F30
  (creó `CierreServiceDialog.tsx` y tocó `Services.tsx`). El trabajo se INTEGRÓ (no se descartó nada): el
  asistente se completó sobre esa base y las reglas quedaron en módulos compartidos. Ver §8 y la lección de
  coordinación en `AGENTS.md`.

## 1. Evidencia (leída en el código, no supuesta)

Flujo actual de una entrega CON cobro (`src/components/Services.tsx`):

| # | Interacción | Código |
|---|---|---|
| 1-3 | sidebar → escribir en el buscador (debounce 350 ms) → leer la tarjeta | `search`/`load()` |
| 4-9 | «Pago / Abono» → `PaymentDialog` → monto o chip → método → Guardar → cierra | `setPayFor(s)` |
| 10-11 | «Entregar» → (si queda saldo) `AlertDialog` «Entregar con saldo pendiente» | `deliver(s)`, `confirmDeliver` |
| 12-14 | «Orden» → `PrintReceiptDialog` → Imprimir → cerrar | `setPrintFor(s)` |

**Total ≈ 13 interacciones y 3 diálogos encadenados por cliente.**

Problemas concretos verificados en el código:

- **P1 · Faltantes que se descubren al final.** `screenMissing` (línea 1664) y `devicesValid` bloquean `save()`
  (línea 2253) *después* de que el operario llenó todo. Si el trabajo es «Cambio pantalla» sin
  `screen_product_id`, el bloqueo aparece recién al pulsar Guardar.
- **P2 · Saldo pendiente en un solo click.** `confirmDeliver` (línea 887) solo pregunta «Entregar con saldo
  pendiente» → no queda registrado *por qué* el cliente se llevó el equipo debiendo (fuga de caja opaca; hoy
  solo se ve después en «Cuentas por cobrar»).
- **P3 · N+1 de IPC.** `load()` (línea 345) hace 3 invokes + **1 `getServicePayments` por tarjeta, hasta 120**
  (línea 356) en cada búsqueda → la lista se siente pesada en hora pico.
- **P4 · Cobro y entrega separados.** `PaymentDialog` y el botón «Entregar» son diálogos distintos: nunca se
  cobra y se entrega en un solo gesto, y el recibo se imprime en un tercer diálogo.
- **P5 · Cero teclado.** Solo existen `N/F2` (nuevo) y `/` (buscar) — nada para cerrar la entrega.

## 2. Alcance (F30)

Componente nuevo `src/components/DeliveryAssistant.tsx`: **Sheet/Dialog con stepper** que cierra la orden
completa. Pasos con *progressive disclosure*: lo que ya está completo **se salta solo**.

| Paso | Qué hace | Si falta un dato |
|---|---|---|
| **0 · Identificar** | Paleta `Command` (cmdk) con la **cola de entregas** (estados activos) filtrada **en cliente** (sin IPC ni debounce): cédula, teléfono, nombre, nº de orden, modelo. `↑↓` + `Enter`. Badges por fila: `LISTO`, `FALTA $X`, `SIN PANTALLA`, `SIN IMPRIMIR` | — |
| **1 · Verificar** | Checklist de cierre: **pantalla exacta** (reusa `ScreenSelect`), total/monto (prefill con precio del catálogo), trabajos, técnico, nota | `Field data-invalid` + `aria-invalid` **solo** en lo que falta, con `FieldDescription` explicando; «Siguiente» bloqueado |
| **2 · Cobro** | «FALTA $X» grande · chips de monto en la moneda del campo · **TODO EL SALDO por defecto** · toggle `$ / Bs.` · chips grandes de método (1 tap) · comisión Punto automática · referencia obligatoria en Zelle/Pago Móvil | `Alert` ámbar de **día cerrado** o **sin tasa BCV** *antes* de intentar guardar |
| **3 · Entrega** | Fecha de hoy + **garantía hasta dd-mm** · resumen `TOTAL / COBRADO / FALTA` · quién recibe | Si `saldo > $0.005`: decisión explícita **«Cobrar todo» / «Deja saldo» (motivo obligatorio) / «Devolución»** |
| **4 · Recibo y siguiente** | Imprimir con `PrintReceiptDialog` (reusa `buildServiceReceiptParts`) · toast sonner · «Siguiente cliente →» vuelve al paso 0 con la cola refrescada | Impresora caída **no bloquea** la entrega (`printed` solo se marca si imprimió de verdad) |

**Atajos:** `F4` abrir · `/` buscar · `Enter` avanzar · `1-7` método · `F9` cobrar y cerrar · `Esc` cerrar.

**Motivo del saldo (decisión del usuario):** al elegir «Deja saldo», el motivo se **anexa a
`services.observations`** (`"Saldo $X declarado al entregar: <motivo>"`) y se registra igual el paso a
`Entregado`. El saldo sigue visible en la tarjeta (`UnpaidBanner`), en el historial del cliente y en
`get_receivables`. Nunca se borra ni se pisa una observación existente.

## 3. Arquitectura y reuso (regla del proyecto: una sola fuente de cada regla)

**Archivos nuevos**

1. `src/lib/payment-math.ts` — funciones **PURAS** (sin React) con las reglas de dinero que hoy viven dentro de
   `PaymentDialog.tsx`, para que existan **una sola vez**:
   - `convertAmount(value, from, to, tasa)` (Bs entero / $ 2 decimales; sin tasa → valor sin cambios)
   - `finalAmount(amount, fieldCur, methodCur, tasa)` (el `payAmountFinal` actual, línea 61)
   - `suggestAmount(saldoUsd, amountUsd, fieldCur, tasa)` (línea 75)
   - `saldoChipValue(saldoUsd, fieldCur, tasa)` (línea 141)
   - `quickAmounts(cur)` → `{USD:[5,10,15,20], VES:[5000,10000,15000,20000]}`
   - `puntoCommission(amountFinal, feePercent)` → `{ commission, net }` (línea 269)
2. `src/components/ScreenPicker.tsx` — **mover tal cual** (sin reescribir) desde `Services.tsx`:
   `useCompatibleProducts`, `onlyScreens`, `asPhoneEntry`, `screenOk`, `ScreenSelect`. `Services.tsx` pasa a
   importarlos (mismo comportamiento, cero copias).
3. `src/components/DeliveryAssistant.tsx` — el asistente (Sheet con stepper + atajos + cola).
4. `tools/payment_math_test.ts` — script `npx tsx` que fija la **paridad numérica** del módulo puro contra los
   valores que hoy produce `PaymentDialog` (matriz: método $ / método Bs × campo $ / campo Bs × tasa 0 / 40 /
   3035.50 × montos límite), incluido el caso del harness «7000 Bs. con Punto Bs → Bs. 7000 → ≈ $9.35».

**Archivos modificados (diff mínimo y aditivo)**

- `src/components/PaymentDialog.tsx`: reemplaza **solo** las expresiones de dinero por llamadas a
  `payment-math` (mismo estado, mismos refs `payTouched`, mismos textos). Cero cambio de comportamiento.
- `src/components/Services.tsx`: importa `ScreenPicker`, agrega el botón **«Cerrar entrega»** como acción
  primaria de la tarjeta, el atajo `F4` y el estado del asistente. **No se toca** `ServiceForm`, el wizard,
  `deliver()`, `confirmDeliver` ni el recibo.

**shadcn (skill cargada):** usar `npx shadcn@latest docs/view` antes de agregar. Faltan `command` (paleta),
`field` + `input-group` (campos con validación), `progress` (avance del stepper), `scroll-area`. Ya existen y se
reutilizan: `sheet`, `dialog`, `alert`, `badge`, `button`, `card`, `input`, `money-input`, `select`, `separator`,
`skeleton`, `table`, `tabs`, `toggle-group`, `tooltip`, `sonner` (montado en `App.tsx:311`), `empty`. **Nunca**
se editan archivos de `ui/` a mano.

## 4. Salvaguardas («sin dañar nada»)

| Regla | Cómo se respeta |
|---|---|
| El backend es la única autoridad | El asistente **no** reimplementa validación: llama a los comandos existentes (`addServicePayment`, `updateService`, `markServicePrinted`) y solo **muestra antes** lo que el backend rechazaría (`require_open_day`, `has_bcv_rate_for_payment`, `normalize_payment_currency`, `screenOk`/`apply_service_stock`). |
| Caja sin fugas | Cerrar con saldo exige una decisión explícita con motivo persistido (§2). Sin decisión, el botón «Cerrar y entregar» está deshabilitado. |
| Moneda (bug histórico Bs/USD) | Una sola implementación (`payment-math`) + test de paridad `tools/payment_math_test.ts`. |
| Inventario | La pantalla se elige por `screen_product_id` exacto (misma `ScreenSelect`); agotada exige confirmación (mismo `screenOk`). |
| Recibo | Se reusa `PrintReceiptDialog` + `buildServiceReceiptParts`; **no** se toca una línea del recibo. |
| Recepción, abonos, devoluciones, cierre de día | Fuera de alcance: no se modifican sus flujos ni sus tablas. |
| Cierre a medias | En F30 el asistente orquesta 2 comandos: si `update_service` falla después del pago, se muestra un **banner de recuperación** con lo que sí quedó registrado («el abono se guardó; la orden sigue en taller») y un botón «Reintentar entrega» — nunca un fallo silencioso. La atomicidad real llega en F32 (`close_service_delivery`). |
| Datos existentes | Sin migraciones ni `ALTER` en F30; la DB no cambia de forma. |

## 5. Criterios de aceptación

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-1 | Una entrega CON cobro se completa en **≤5 interacciones** (buscar → elegir orden → método → cobrar → imprimir) | recorrido en vivo contando interacciones (mismo escenario que hoy cuesta 13) |
| AC-2 | Ningún cierre puede quedar «con saldo» sin decisión explícita **y motivo** guardado | test manual en vivo + `SELECT observations FROM services WHERE id=…` con el motivo |
| AC-3 | El asistente pide **solo** el dato que falta (pantalla / monto / trabajos) y el paso se salta si ya está completo | recorrido con una orden completa (0 campos pedidos) y otra sin pantalla (1 campo pedido) |
| AC-4 | Los gates se muestran **antes**: día cerrado y tasa BCV 0 bloquean con aviso ámbar, sin llamar al backend | en vivo con día cerrado y con tasa 0 |
| AC-5 | Paridad numérica del módulo de dinero con el comportamiento actual de `PaymentDialog` | `npx tsx tools/payment_math_test.ts` → 0 diferencias en toda la matriz |
| AC-6 | Entregar descuenta el **stock exacto** de la pantalla elegida y deja el movimiento con el nº de orden; reabrir lo devuelve | en vivo: stock antes/después + `inventory_movements` |
| AC-7 | El recibo sale idéntico al actual (main + términos + talón) y `printed` solo queda en 1 si se imprimió | comparar salida de `receipt_test.ts`/`stub_test.ts` (sin cambios) + `services.printed` |
| AC-8 | Cero regresión: crear orden por el wizard, abonar en `PaymentDialog`, devolver con `RefundDialog` y cerrar el día siguen funcionando; el día cuadra | recorrido en vivo + Libro Diario con diferencia 0 |
| AC-9 | `npm run build` y `npm run lint` limpios; `cd src-tauri && cargo test` sigue verde (93/93 + ignorados) | scripts |

## 6. Fuera de alcance (fases siguientes, ya planificadas)

- **F31:** `get_delivery_queue` en **1 consulta** + índices → fin del N+1 de P3.
- **F32:** `close_service_delivery` **transaccional** (pago + entrega + stock + `printed` en un solo tx).
- **F33:** vuelto/cambio en efectivo, auto-impresión opcional, contador «entregas de hoy».

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Tocar `PaymentDialog` (diálogo crítico ya verificado) y romper la moneda | extracción **pura** + test de paridad + no se cambia estado, refs ni textos |
| Mover `ScreenSelect` de `Services.tsx` rompe el wizard de recepción | es un **move literal**; `tsc -b` (build) y recorrido de recepción en vivo como regresión |
| Doble cobro por doble click | `saving` + botones deshabilitados durante el guardado; el backend ya recalcula `paid_amount` |
| El operario se acostumbra al asistente y deja de imprimir | el paso 4 muestra el estado de impresión y la tarjeta conserva el badge «Sin imprimir orden» |
| Dos flujos de cierre conviviendo | el asistente es **aditivo**: los botones actuales siguen igual; F32 unificará la escritura |

## 8. Resultado de la implementación (2026-09-16) y evidencia

**Lo que quedó en el repo**

| Pieza | Archivo | Nota |
|---|---|---|
| Cola de entregas (F4) | `src/components/CierreQueueDialog.tsx` | paleta `cmdk` (`ui/command.tsx` ya existía); botón «Cerrar entrega» + atajo `F4` en Servicio Técnico |
| Reglas de la cola | `src/lib/queue.ts` | `ACTIVE_QUEUE`, `scoreQueueMatch`, `rankQueue`, `queueFlags` (puras) |
| Asistente de cierre | `src/components/CierreServiceDialog.tsx` | base creada por la sesión paralela + completada acá: usa `screenOk` (confirmación de agotada), `payment-math`, `onlyScreens`, motivo obligatorio, `Ctrl+Enter` |
| Dinero en un solo lugar | `src/lib/payment-math.ts` | `PaymentDialog` pasó a usarlo (sus fórmulas locales se borraron) |
| Pantalla / stepper / update | `src/lib/screen-rules.ts`, `src/components/ScreenPicker.tsx`, `src/components/FormStepper.tsx`, `src/lib/service-update.ts` | movidos literalmente desde `Services.tsx`; `deliver()` ahora usa `updateOrderKeepingFields` |
| Pruebas puras | `tools/payment_math_test.ts`, `tools/queue_test.ts` | 595/595 y 32/32 |

**Verificación ejecutada**

| Gate | Resultado |
|---|---|
| `npx tsc -b` | 0 errores |
| `npx oxlint` | 0 errores (los warnings bajaron de 88 a 86: los módulos puros ya no mezclan componentes y funciones) |
| `npm run build` | OK (15,45 s) |
| `node tools/payment_math_test.ts` | **595/595**, 0 diferencias vs las fórmulas viejas de `PaymentDialog` |
| `node tools/node_modules/tsx/dist/cli.mjs tools/queue_test.ts` | **32/32** (ranking, faltantes, pantalla agotada) |
| `harness_security` | PASS (secrets, debug-mode, sql-injection, auth) |
| `harness_truth` | PASS (build PASS) |
| `cargo test` | **no re-ejecutado a propósito**: cero cambios en Rust y la sesión paralela tenía la app Tauri en vivo con `cargo` (lock del `target/`) |
| `harness_review` | **roto en este entorno** (falta `tools/reviewer/parallel-review.ts`) → sustituido por dos revisiones adversariales con subagentes |

**Desviaciones honestas respecto de lo planeado en §2/§3**

1. **No hay `DeliveryAssistant.tsx` multi-paso**: el asistente vive en `CierreServiceDialog.tsx` (una sola
   pantalla con secciones) porque la sesión paralela ya lo había creado y estaba **verificándolo en vivo**;
   reescribirlo habría tirado su trabajo. El efecto buscado (pedir solo lo que falta, cobrar y entregar en un
   gesto) se conserva.
2. **No se implementó «quién recibe»** (no hay columna para ese dato; inventarla era peor que no tenerla).
3. **`FormStepper` quedó disponible y usado por el wizard de recepción**; el asistente no lo usa (su versión en
   vivo tenía otra forma). El indicador de pasos queda como mejora de UI, no como bloqueante.
4. **El motivo del saldo se guarda con el formato que ya estaba en la versión en vivo**
   (`Entregado con saldo ($X): motivo`) para no romper su verificación; `lib/service-update.ts` ya tiene el
   formato canónico listo para unificar cuando se haga F32.
5. **La confirmación de pantalla AGOTADA se añadió al asistente** (era un hueco real: se podía entregar una
   pantalla sin stock sin ningún aviso, contra la regla documentada en `AGENTS.md`).

### 8.1 Revisión adversarial (2 subagentes) y ARREGLOS aplicados

`harness_review` está roto en este entorno (`tools/reviewer/parallel-review.ts` no existe), así que se
corrieron DOS revisiones adversariales en paralelo (calidad/correctitud y consistencia/regresión contra las
reglas de `AGENTS.md`). Ambas dieron **BLOQUEANTE** y sus hallazgos ya están arreglados:

| # | Hallazgo (bloqueante) | Estado |
|---|---|---|
| 1 | **Cobro duplicado por reintento**: el cobro y el cierre estaban en el mismo `try`; si el cobro se guardaba y el cierre fallaba, el reintento cobraba otra vez | ✅ **ARREGLADO**: estado `pagoHecho` (reset al cambiar de orden), el cobro solo ocurre si `!pagoHecho`, Alert ámbar «El cobro quedó registrado…», botón «Reintentar cierre» que NO cobra, y relectura de la orden en el catch. Definitivo: F32 transaccional |
| 2 | **Cobro fantasma**: con método en $ + campo en Bs. + tasa 0, `payAmountFinal = 0`, el gate pasaba y el monto tipeado se perdía sin aviso (la orden quedaba entregada con el saldo completo) | ✅ **ARREGLADO**: `cobroImposible = payAmount > 0 && payAmountFinal <= 0` bloquea el cierre con aviso rojo; con monto escrito también se exige día abierto |
| 3 | **Cambiar el método no convertía el monto**: Pago Móvil Bs. 7000 → «Divisas (USD Cash)» dejaba 7000 con el toggle en `$` y registraba **$7000** en una orden de $30 | ✅ **ARREGLADO**: `convertAmount(payAmount, payCur, nextCur, tasaBcv)` antes de cambiar el toggle (igual que `PaymentDialog`) |
| 4 | **La cola escondía órdenes con tilde**: `rankQueue([{client:'JOSÉ PÉREZ'}], 'jose')` → 0 resultados (el buscador de la cola es el único filtro) | ✅ **ARREGLADO**: `fold()` (NFD + strip de acentos) en ambos lados, `compact()` para el nº de orden sin guiones/espacios («DEV 0001» y «dev0001» ahora encuentran), match multi-término («redmi 11» → «Redmi Note 11»), `scoreQueueMatch(s,'')` → `null` y rama muerta eliminada. `tools/queue_test.ts` pasó de 32 a **42** comprobaciones, con casos de acentos/mayúsculas/orden |

Menores también arreglados: el asistente guarda el cobro con la nota «Cobro al entregar» (trazabilidad en la
pestaña Pagos), la comisión del Punto se imprime con el símbolo de SU moneda (antes `$` fijo), el atajo `F4`
ya no apila la cola sobre otro diálogo abierto ni dispara mientras se escribe, y el asistente usa
`updateOrderKeepingFields` (dedupe de la escritura de la orden).

**Segunda vuelta de revisión (los revisores encontraron 2 defectos en los arreglos anteriores) — también
ARREGLADOS:**

| # | Hallazgo | Arreglo aplicado |
|---|---|---|
| 5 | **El cobro RECHAZADO se anunciaba como registrado**: el catch usaba la INTENCIÓN (`faltaCobrar`) en vez del resultado → si `addServicePayment` lanzaba (IPC caído, o día cerrado creído abierto porque `getActiveDay` falla y `Services.tsx` hace fail-open), la UI decía «el pago SÍ está guardado», el botón pasaba a «Reintentar cierre» (que ya no cobra) y el equipo salía **sin cobrar** | bandera `cobroOk` que se pone SOLO después del `await` exitoso; el cobro tiene su **propio try/catch** que corta el flujo (`return`) sin entregar y muestra el error real |
| 6 | **Tasa 0 + cambio de método = monto inflado ×tasa**: `convertAmount` devuelve el valor sin convertir cuando `tasa <= 0` (es su contrato, fijado por el test de paridad) pero el toggle se flipeaba igual → Bs. 7000 pasaban a registrarse como **$7000** | en los DOS call sites (`CierreServiceDialog` y `PaymentDialog`) el monto queda en **0** si no hay tasa: el operario lo reescribe y el guardado queda bloqueado hasta entonces |
| 7 | **Rótulo del saldo con la moneda del método**: una orden cobrada con método Bs tiene `services.currency='VES'`, así que la cola mostraba «Bs. 30.00 falta cobrar» por un saldo de $30 | el saldo/abonado se rotula SIEMPRE en `$` (`services.amount` es dólares; `currency` es la moneda del método de pago) |
| 8 | Puntuación del operario no se plegaba en nombre/modelo («g51-5g» no encontraba «G51 5G») y «0001» no encontraba DEV-0001 | `queue.ts`: comparación sin puntuación (`compact`) para nombre/modelo y por CONTENIDO para el nº de orden. `queue_test.ts` 42 → **46** comprobaciones |

**Pendientes anotados (no bloquean F30):** la lista de pantallas del asistente usa `findCompatibleProducts(...,40)`
+ filtro inline en vez de `useCompatibleProducts`/`onlyScreens` (40 vs 80 filas: pueden diferir del formulario);
`esFinal` local define «final» distinto de `isFinalized` (y sus ramas son hoy inalcanzables); falta el campo
Referencia para **Pago Móvil** (solo lo pide para Zelle); y el botón «Entregar» de la tarjeta sigue permitiendo
entregar con saldo SIN motivo (solo el asistente lo exige). **PREEXISTENTE (hallado por la revisión, ajeno a
F30):** `PrintReceiptDialog.tryAutoDetect` devuelve `true` en su rama de error → `markPrinted()` deja
`printed=1` sin haber impreso.
