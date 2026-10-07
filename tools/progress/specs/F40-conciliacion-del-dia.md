# Spec F40 — Libro único de movimientos de caja + pantalla de conciliación (FASE 1)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Feature **paraguas** del estándar POS, elegida para después por el dueño (2026-09-17). Esta spec cubre la
**FASE 1** (la red de seguridad y la pantalla). La FASE 2 (que el arqueo lea SÓLO el libro) queda
explícitamente abierta, con su motivo y su prerrequisito escritos acá.

---

## 1. Qué pedía F40 y qué ya estaba hecho

| Pieza del pedido | Estado al empezar esta fase |
|---|---|
| (A) tabla `cash_movements` escrita por CADA write point de caja, en la misma transacción, con migración de lo existente | **HECHA antes** (F68/F69): `book_movement` + `reverse_book_entry` la escriben desde ventas, cobros, devoluciones, gastos, anulaciones y borrados, con `type`, `method`, `currency`, `amount` (NETO), `sign`, `day`, `date`, referencia y autor |
| (B) `compute_daily_totals` y el arqueo suman SÓLO el libro | **PENDIENTE (FASE 2)** |
| (C) log de auditoría consultable (quién borró un abono, quién movió una fecha, quién reabrió) | **parcial**: el libro guarda autor y motivo por movimiento; no hay pantalla propia |
| (D) pantalla de conciliación: por día y método, ver los movimientos que componen cada total | **ESTA FASE (FASE 1)** |

**El riesgo que F40 nombra** («cada movimiento nuevo hay que acordarse de sumarlo en
`compute_daily_totals`») es el que ya produjo dos bugs de plata. Mientras (B) no se haga, la forma de
saber que las dos fuentes siguen de acuerdo es **compararlas**: eso es exactamente lo que se construyó.

## 2. Decisión

**FASE 1 = LA CONCILIACIÓN COMO RED.** Se agrega una lectura PURA del backend,
`Database::conciliacion_del_dia(fecha)`, que contesta la única pregunta que importa antes de tocar el
núcleo: **¿el libro dice lo mismo que las tablas que produjeron la plata?** Ventas + abonos − anulaciones
− devoluciones, **por método y moneda**, **NETAS de comisión** (que es lo que de verdad entró), leídas de
las dos partes y comparadas una por una.

- **Libro**: `cash_movements` del día, tipos `venta`, `venta_anulada`, `abono`, `abono_anulado`,
  `devolucion`, sumando `amount * sign`.
- **Origen**: `sales` (no anuladas, `COALESCE(net_amount,total)`) + `service_payments`
  (`COALESCE(net_amount,amount)`), incluida la devolución (que se guarda como pago negativo).
- **Una línea por método/moneda que aparezca en CUALQUIERA de las dos partes** (`full outer join` a mano):
  si un movimiento no se anotó en el libro, la línea aparece con su diferencia en vez de desaparecer.
- **Presunciones aparte**: las entregas del día **sin ningún cobro** (lo que la «caja presume»). No son
  una diferencia —la plata no está en ninguna de las dos partes—, así que **no** entran en `cuadra`: se
  informan con su monto para que el dueño sepa qué plata el sistema espera y no tiene asiento.

**NO se toca ningún write point, ninguna migración, ningún total.** Esta fase es **sólo lectura** (más la
pantalla): el día que se haga la FASE 2, esta comparación es el test que dice si el cambio quedó bien.

## 3. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** `conciliacion_del_dia(fecha)` devuelve, por método y moneda, el libro, el origen, la diferencia y cuántos movimientos | `cargo test --lib test_f40_conciliacion_del_dia` |
| 2 | **[must]** Un día con ventas + abonos + una devolución **cuadra** (las dos partes coinciden al centavo) | ídem, tramo 1 |
| 3 | **[must]** Una fila de plata SIN asiento en el libro aparece como diferencia con su método y su monto (el detector) | ídem, tramo 2 |
| 4 | **[must]** Una entrega sin cobro NO ensucia el cuadre: sale como **presunción** con su monto, en la **moneda del método** y **convertida por la tasa del día** | ídem, tramo 1 (dos presumidas: una en $ y una en Bs. con la moneda de la fila cruzada a propósito) |
| 5 | **[must]** El comando está registrado en Tauri y el frontend lo llama por el bridge (`api.conciliacionDelDia`), que **lanza** en vez de devolver vacío si el IPC falla | `tsc -b` + el bridge (`src/db.ts`) |
| 6 | **[must]** La pantalla vive en **Libro Diario → Movimientos**, es del DUEÑO, y dice el estado en una palabra («Cuadra» / «Con diferencias») con el detalle por método y el aviso que nombra las dos cifras | EN VIVO `verify_f40_conciliacion.mjs` A1/A2/A3 y B1/B2 |
| 7 | **[must]** La tarjeta es de **sólo lectura** y deja elegir el día a conciliar (no sólo hoy) | UI (`data-field="conc-fecha"`) |
| 8 | **[must]** Un día **sin cobros** lo dice («no hay nada que conciliar») y **no** muestra el badge verde: un «Cuadra» sin haber comparado nada es un verde vacío | ídem, `cuadra` sólo con líneas + UI (`data-field="conc-vacio"`) |
| 9 | **[must]** Una fecha inválida (`''`, `06/10/2026`, con hora) se **rechaza con error** en vez de devolver «Cuadra» con 0 líneas | ídem, tramo 4 |
| 10 | **[must]** El conteo de la línea dice **cobros** (`movimientos`), no el mayor entre cobros y asientos (`asientos` es aparte) | ídem, tramo 1 |
| 11 | **[must]** Nada verificado antes se rompe | `cargo test --lib` 218/218 · EN VIVO `verify_turno_viejo` 42/42, `verify_arqueo_f69` 39/39, `verify_smoke_integral` 110/110 |

## 4. Verificación

* **Rust** `cd src-tauri && cargo test --lib test_f40` → `test_f40_conciliacion_del_dia` **1 passed**
  (4 tramos: cuadra con venta + abono + devolución; la fila sin asiento da diferencia con su método; la
  entrega sin cobro sale como presunción y **no** rompe `cuadra`; y **borrar la devolución deja el día
  cuadrado** — ver 4.1).
* **EN VIVO** `node tools/verify_f40_conciliacion.mjs` sobre una COPIA con el PIN de pruebas: mide el
  estado de partida **contra la base** (aborta si el día ya venía descuadrado, para no dar por bueno un
  detector que no distingue), hace una venta y un abono REALES por los write points de verdad, lee la
  tarjeta por la UI y exige «Cuadra» con libro == origen; después inyecta por SQL una venta de Bs. 10
  **sin asiento** (el caso «base vieja») y exige «Con diferencias» con la línea y el aviso que nombra el
  método y las dos cifras; al final limpia (borra su fantasma, anula su venta y borra su abono) y exige
  que el día **vuelva a cuadrar igual que al empezar**.

### 4.1 Lo que encontró la CORRIDA EN VIVO (y no la revisión de escritorio)

1. **FALTABA `devolucion_anulado` EN LA LISTA DE TIPOS DEL LIBRO — un falso «Con diferencias».** Cuando se
   borra una devolución (o se borra la orden que la tenía), `reverse_book_entry` escribe el espejo
   `devolucion_anulado` (+monto) y el ORIGEN simplemente pierde su fila negativa; si el libro no cuenta
   ese espejo, se queda con el −Bs. 1.000 de la devolución y la pantalla acusa **una diferencia que no
   existe**. Lo encontró **la propia prueba**: se abortó al medir el estado de partida de la copia
   («Efectivo Bs: libro −1000 vs origen 0») DESPUÉS de que las otras verificaciones borraran sus
   devoluciones — o sea, el aborto defensivo sirvió para lo que estaba puesto. Arreglado en la lista de
   tipos (los cuatro movimientos de cobro **y sus cuatro espejos**), con el tramo nuevo del test y
   **comprobado que muerde** (sin `devolucion_anulado` el test falla con `libro 3000 / origen 4000`), y
   confirmado en vivo sobre la MISMA copia que antes abortaba: pasó de «libro −1000 vs origen 0» a
   **«Cuadra»** con las tres líneas.
2. **`fmt_monto`: el aviso ponía `$` a las cifras en bolívares** («el libro dice $0.00 y el origen dice
   $10.00») mientras la tabla decía «Bs. 10,00» — dos números iguales con el signo equivocado es lo que
   hace desconfiar del dato. Ahora el formato es el de la pantalla, con el **signo antes de la moneda**
   (`-$10.00` / `-Bs. 10,00`), y el test lo fija (comprobado que muerde).
3. **Un parser mentiroso en la prueba**: `num()` se comía el punto de la etiqueta «Bs.» y devolvía
   **NaN**, así que la comprobación del detector **pasaba por la rama vacía** (misma clase de falla que la
   lección de F94: una aserción que no falla ruidosamente). Ahora saca la etiqueta antes de parsear.
4. **La prueba copiaba la regla que verifica**: su chequeo de partida repetía la lista de tipos del
   backend. Al arreglar `db.rs` quedó desincronizado y siguió midiendo el bug viejo. Queda documentado en
   el propio script (`TIPOS_DE_COBRO`): si la lista cambia en `db.rs`, cambia acá también.

### 4.2 Revisión adversarial (subagente, sólo lectura) — 1 BLOQUEANTE (ya cerrado) + 5 MENORES, todos arreglados

El revisor leyó el código y midió **SQL read-only** sobre copias de `backup/` (no corrió `cargo`/`npm`/`verify_*.mjs`).
Veredicto: **F40 fase 1 no bloquea el cierre**. Hallazgos y arreglos:

| # | Sev. | Hallazgo | Arreglo |
|---|---|---|---|
| B | **BLOQUEANTE** (ya cerrado antes del informe, y él lo verificó) | faltaba `devolucion_anulado` en la lista de tipos del libro → **diferencia inexistente y permanente** en el día perfecto (reproducido en `backup/f83_verif.db`: «Efectivo Bs −1000 vs origen 0») | los **4 originales + sus 4 espejos** + el tramo del test que muerde + confirmación en vivo sobre la misma copia (§4.1) |
| 1 | MENOR | sin validar `fecha`: con `''` (se puede borrar el `<input type=date>`) devolvía **`cuadra:true` con 0 líneas** → badge verde con el cuerpo diciendo «no hay nada que conciliar» | formato `AAAA-MM-DD` validado (error explícito) + `cuadra` sólo con líneas + el badge no se dibuja sin líneas + tramo 4 del test |
| 2 | MENOR | `movimientos: max(libro, origen)` no era ni cobros ni asientos: la pantalla decía «Mov. 11» para **1 venta** | `movimientos` = **cobros** reales y `asientos` = filas del libro (el detalle va en el `title` y en un `(N)` al lado cuando difieren) + asserts |
| 3 | MENOR | la presunción usaba el `currency` **crudo** de la fila y **sin** la conversión por tasa que sí hace el total del día (regla F39): una entrega de $20 por «Efectivo Bs» se informaba «Bs. 20,00» cuando la caja presume Bs. 20 × tasa | moneda **derivada del método** y monto convertido por la **tasa del día** + tramo con la moneda cruzada a propósito (20 × 50 = 1.000) |
| 4 | MENOR | al cambiar la fecha no se limpiaba el estado: la tarjeta seguía mostrando el día anterior (badge incluido) hasta que llegaba el IPC | `setConciliacion(null)` al empezar el efecto (la rama «Leyendo el día…» ya existía) |
| 5 | MENOR | `drawer_adjustments_conn` **tampoco** contaba `devolucion_anulado`: «Devuelto hoy del cajón» seguía mostrando una devolución borrada (no movía el esperado; era el número informativo) | mismo barrido: cada original con su espejo |

**Lo que el revisor verificó y está bien** (resumen): simetría libro↔origen completa en las dos listas de tipos del proyecto, contra-asientos bien fechados (copian `date`/`day` del original) y `update_service_payment_date` moviendo el asiento con el pago (sin asientos huérfanos), método y moneda del libro idénticos a los de la fila de origen (no hay líneas partidas por moneda), formato del dinero igual al de la UI, la pantalla **es** de sólo lectura, y el redondeo no puede esconder diferencias alcanzables (todo se escribe con `round2` en las dos partes).
**Debilidades declaradas (no defectos alcanzables hoy):** `cuadra` no ve gastos ni ajustes de cajón (por diseño) y **no puede detectar un error de DÍA compartido por las dos partes** (la devolución fechada en el turno viejo da «Cuadra» en el 21/09: es la regla del local, F83 la informa); si algún write point futuro guardara sub-centavos, `round2(l − o)` podría ocultar menos de ½ centavo.

## 5. FASE 2 — lo que queda abierto (y por qué no se hizo acá)

`compute_daily_totals` y el arqueo **todavía NO** leen sólo el libro: siguen sumando `sales` +
`service_payments` + `expenses`. Para que puedan leer sólo `cash_movements` hace falta que el libro
**alcance para las dos cuentas que hoy se derivan de las tablas**:

1. **Bruto y comisión por movimiento.** El arqueo espera el **bruto** en los métodos de cajón (lo que
   entró al cajón) y el **neto** en Punto de Venta (lo que liquida el banco). El libro guarda hoy un solo
   `amount` (el neto): hacen falta columnas `gross`/`fee` (o dos movimientos) para poder derivar las dos
   cifras sin volver a las tablas.
2. **Asiento para las entregas presumidas.** El «total del día» incluye los equipos entregados sin cobro
   (`entregados sin pago`). Si el libro pasa a ser la única fuente, esas entregas tienen que tener su
   asiento (o el total del día deja de incluirlas — es una **decisión de negocio del dueño**, no técnica).
3. **Migración medida antes/después** (patrón `tools/audit_paid_amount_f36.mjs`): los totales por día y
   método **no pueden cambiar** con el cambio de fuente, y eso se comprueba sobre una copia de la base real.

Hasta que eso esté, **la conciliación de esta fase es el instrumento con el que se hará**: cualquier
write point que se olvide de anotar sale en rojo el mismo día, en la pantalla del dueño.
