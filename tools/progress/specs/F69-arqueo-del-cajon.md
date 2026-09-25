# F69 — Cada caja cuadra su día: el arqueo cuenta fondo, gastos y retiros, y los digitales se verifican

**Estado:** implementada y verificada (Sprint A de `AUDITORIA_ENTREGA.md`, bloqueante **A1**).
**Origen:** auditoría de entrega al cliente final (2026-09-23) + la revisión adversarial de F68.
**Regla madre (ya escrita en F38/F39):** *la caja cuadra por MONEDA y por MÉTODO; la tasa BCV solo sirve
para informar. Un descuadre nunca se esconde.*

---

## 1. El problema (medido, no supuesto)

Al abrir `compute_daily_totals` y el diálogo de cierre aparecieron tres hechos concretos:

1. **`compute_daily_totals` no menciona `expenses` ni `initial_cash` ni una sola vez.** El «esperado»
   del cajón era solamente *lo cobrado por método*. Consecuencia en el local: un día perfecto en el que
   el dueño pagó al mensajero **del cajón** cerraba «faltando» exactamente ese monto, y el fondo de
   caja declarado al abrir hacía que el cajón «sobrara» todos los días. El operario dejó de creerle.
2. **El diálogo de cierre precargaba los cobros digitales con el monto del sistema**
   (`actual_zelle = expected.zelle_total`, `actual_pago_movil = expected.pago_movil_total`,
   `actual_transfer_bs = expected.transfer_bs_total`), así que su diferencia daba **0 SIEMPRE** y el
   «verificalo en el banco» que decía el texto era decorativo. Lo mismo pasaba con el monto impreso del
   Punto: se mandaba el «cargado esperado» como si fuera un conteo.
3. **Nadie se enteraba de un gasto sin declarar**: la tabla `expenses` no tenía de dónde salió la plata,
   así que el cajón no podía descontarlo y el cierre no lo avisaba.

## 2. La regla que quedó (una sola implementación)

```
esperado del cajón ($) = efectivo cobrado en $ (ya neto de devoluciones) + fondo de caja
                                                                             − gastos pagados del cajón ($)
esperado del cajón (Bs) = efectivo cobrado en Bs. (ya neto de devoluciones)
                                                                             − gastos pagados del cajón (Bs.)
```

* `src/lib/drawer.ts` (**puro**, test `tools/arqueo_test.ts`): el desglose que se muestra antes de
  contar, las líneas que hay que confirmar, y la diferencia de cada línea en **su** moneda con **su**
  tolerancia (`TOL_USD`/`TOL_BS` de `cash-closing.ts`).
* `db.rs :: close_day` aplica exactamente la misma fórmula. Los gastos se leen del **libro de plata**
  (`cash_movements` del día, tipo `gasto`/`gasto_anulado`, método `Divisas (USD Cash)`/`Efectivo Bs`) —
  una sola fuente: si no está en el libro, no existe para la caja.
* **Las devoluciones NO se restan otra vez**: se guardan como un `service_payments` NEGATIVO con el
  método por el que salió la plata, así que el neto por método **ya viene con ellas**. Restarlas en el
  esperado descontaba la misma plata dos veces (lo cazó `test_refund_ledger_full`): una orden de $50
  devuelta entera daba un «faltante» de $50 con el cajón cuadrado.
* **Los digitales se concilian por banco**: no se tocan con el ajuste del cajón (eso ya lo decía F39).

## 3. «Un número sin contar no es un número»

Ningún campo del arqueo entra al cierre porque el sistema lo diga:

* **EL CAJÓN SE CUENTA SIEMPRE, EN LAS DOS MONEDAS** (divisas y bolívares), aunque el esperado sea 0:
  el arqueo empieza por contar el cajón con las manos, y si en el cajón hay Bs. 500 que el día no
  explica, la diferencia tiene que **verse** («sobran Bs. 500,00») en vez de quedar en un 0 asumido.
  Las líneas del Punto y de los bancos (Zelle, Pago Móvil, Transferencia Bs.) sí dependen del día: no
  se pide verificar un banco por el que no entró nada; se incluyen con `|monto| > 0.005`, **negativos
  incluidos** (un Punto en negativo por una devolución hay que confirmarlo: si no se dibujara, el
  cierre quedaría imposible — bloqueante de la 2ª vuelta de revisión).
* Cada línea nace **«Sin contar»** (`data-estado="sin_contar"`) y no muestra diferencia.
* El operario la confirma de dos maneras: escribiendo lo que contó/verificó, o pulsando **«Es el
  esperado»** (un acto humano explícito, no un default).
* Mientras falte alguna línea, el resumen **no dice «Cuadra»**: dice qué falta
  (`faltaConfirmar`: «Falta contar/verificar: Divisas contadas ($), Zelle verificado en el banco ($)…»)
  y el botón **Cerrar Día** rechaza con ese mismo texto. El día no se cierra (verificado en la base).
* Un conteo distinto del esperado baja el semáforo **de esa moneda** («faltan $85.00» / «faltan
  Bs. 1.000,00») y el número igual se guarda al cerrar: el descuadre se documenta, no se esconde.
* El diálogo **se abre con los datos ya leídos** (antes se abría primero y mostraba el desglose en
  `$0.00` durante la carga — el número que decide el arqueo aparecía mintiendo). Si el ajuste del cajón
  (fondo/gastos) NO se pudo leer, el cierre queda bloqueado con el motivo: cerrar ahí guardaría un
  esperado distinto del que el operario contó.
* **UN DÍA SIN MOVIMIENTOS EXISTE Y SE PUEDE CERRAR**: `getDailyTotals` sólo devuelve los días con
  ventas/abonos/entregas, así que un día en el que el taller únicamente recibió equipos (o un feriado)
  llega como lista vacía. Eso NO es un error de lectura: se cierra con ceros, igual que hace el backend
  (antes `expected = null` apagaba el botón con el aviso rojo y el turno quedaba abierto para siempre,
  sin poder abrir el día siguiente — bloqueante de la 2ª vuelta).
* Lo contado arranca en el **esperado de verdad** (con fondo y gastos), no en lo cobrado: con fondo $50
  y un gasto de $20, el campo del cajón dice $130 — el mismo número que el rótulo.

## 4. Lo que además se cerró del tronco de la revisión de F68 y de la 2ª vuelta

* **Contra-asiento con fecha**: `reverse_book_entry` copia la fecha del movimiento ORIGINAL. Con la
  fecha de hoy, borrar un gasto del 21 el 23 dejaba al 21 descontando ese gasto **para siempre** y le
  regalaba un «+monto» inventado al 23 (bug cazado en la segunda corrida en vivo, test
  `test_contra_asiento_va_al_dia_del_movimiento`).
* **`open_day` ya NO reabre un día cerrado** (bloqueante de la 2ª vuelta): el `ON CONFLICT … is_closed=0`
  volvía a abrir el día de hoy con el fondo y la tasa que mandara quien llamara (y borraba y re-anotaba
  la apertura del libro), así que se podían anotar ventas y abonos en un arqueo **ya firmado** — y un
  cierre guardado no se recalcula. Ahora se rechaza con el camino del remedio (↺, del dueño) y la UI
  dice lo mismo en vez de ofrecer el botón. Test `test_open_day_no_reabre_un_dia_cerrado`.
* **El fondo de caja tiene UNA fuente**: `close_day` calculaba el esperado con el fondo guardado y
  persistía el del parámetro (un llamador con 0 dejaba `initial_cash_usd=0` y un `drawer_adjust_usd=+30`:
  al reabrir con ↺ el fondo desaparecía y el recierre mostraba «sobran $50»).
* **`get_cash_movements` fail-closed**: sin sesión y con más de una persona, el libro **no** se muestra
  (antes el filtro vacío se convertía en «mostrame todo»). La sesión de caja además ve las filas del
  NEGOCIO (`user_id IS NULL`) para que su día no salga incompleto, y una fila ilegible ya no se descarta
  en silencio.
* **Lecturas de dinero del dueño detrás del gate**: `get_profit_summary`, `get_inventory_value`,
  `export_data` (que incluye `settings`), **`export_daily_report(_xlsx)`** (traen los arqueos),
  **`get_expenses`** (en qué se gastó el negocio), **`search_payments`/`get_payment_daily_detail`**
  (los cobros de todas las sesiones), **`get_dashboard_analytics`** (7 días de facturación y top de
  modelos) y **`get_purchase_orders`/`get_purchase_order_items`** (lo que costó cada repuesto). La caja
  conserva lo que necesita para trabajar: totales del día, servicios, ventas, clientes, cartera.
* **El costo del catálogo ya no viaja**: `get_products`, `get_products_page`, `get_low_stock_products`,
  `get_reorder_suggestions`, `suggest_products`, `get_inventory_stats`, **`find_compatible_screens`**,
  **`find_compatible_products`** y **`get_phone_detail`** llegan con `price_cost = 0` (`value_cost = 0`)
  para una sesión de caja, en el origen — y **fail-closed con la sesión vencida** (sin sesión y con más
  de una persona se asume el perfil más restrictivo). La pantalla ya escondía la columna; el número
  igual viajaba y se podía leer con un invoke directo.
* **PIN y sesión**: `verify_user_pin` usa el MISMO bloqueo por intentos que el PIN viejo y **el bloqueo
  se persiste** (`settings.pin_failures`/`pin_locked_until`: reiniciar la app ya no borra el castigo);
  `set_user_pin` valida 4 dígitos; un `master` **no** puede quedar sin PIN con más de una persona
  activa; `set_pin` cambia el PIN del dueño **en sesión** (no el de todos los masters) y sincroniza
  `settings.pin` sólo con el master «de la casa»; `remove_pin` borra también `users.pin_hash`;
  **borrar al master «de la casa» resincroniza `settings.pin`** (antes el PIN del master borrado seguía
  entrando y abría sesión como el vigente); **el respaldo ya no lleva el hash del PIN** (un PIN de 4
  dígitos se revierte offline en segundos y el respaldo es el archivo que se comparte);
  `ensure_master_user` no puede tumbar el arranque; `single_user_install` y `has_multiple_people`
  cuentan **las dos** sólo personas activas.
* **El padrón de personas y el estado de la app**: si `getUsers` falla en Tauri, la app **no** asume que
  quien está enfrente es el dueño (el error ya no se traga en `db.ts`) y la **sesión vencida se
  detecta** (re-consulta al volver a la ventana y cada minuto → vuelve a la pantalla de acceso, con el
  motivo: sin esto, después de las 12 h los movimientos de dinero se anotaban sin autor).
* **La UI dejó de ofrecer lo que el backend va a rechazar**: «Cerrar Día» es del dueño (la caja ve el
  camino), Gastos/Salud/Personas/Cerrar Día siguen la regla pura `abilities()` (`src/lib/session.ts`,
  que ahora sí se usa y dice la verdad: `closeOwnCaja` y `cashExpense` son `false`), el costo y la
  edición del catálogo, los pedidos (y su detalle) y la impresora/el padrón de técnicos/la impresora de
  la pantalla de Servicios se esconden para la caja.
* **`App.tsx`**: si no se pudo leer el padrón de personas, se pide el PIN de la instalación en vez de
  asumir dueño.
* **`closingDifference` y `sinContar`** aceptan/suman el ajuste guardado (`drawer_adjust_usd/_bs`):
  sin eso, la lista de Cierres mostraba un descuadre inventado en cualquier día con fondo o gasto del
  cajón — y `sinContar` acusaba «sin contar» a un cierre perfecto.
* **La fecha de un cobro ajeno** (`update_service_payment_date`) pide la sesión del dueño si el
  movimiento del libro es de otra persona: mover esa fecha mueve plata entre dos cajas.
* **Instalar/revertir una versión es del dueño** (`backup_before_update`, `rollback_update`): sin gate,
  desde la consola del WebView se podía volver a la build **anterior a F68**, donde no había sesiones
  por persona ni gate de caja. El flujo del updater no se rompe: `get_update_state`, `run_health_check`
  y `mark_update_ok/failed` siguen sin gate porque los usa el ARRANQUE antes de que alguien entre.
* **El desglose y los avisos dicen la verdad**: cada línea del desglose se imprime **en su moneda**
  (antes el gasto en Bs. salía con el formato del dólar), el aviso del gasto cambia según el método
  (cajón / banco / sin declarar) y la pestaña Gastos muestra de dónde salió cada uno, la lista de
  Cierres y el diálogo ya no prometen que los digitales entran «con el valor del sistema», y los gastos
  que se listan al cerrar son los **del día que se cierra** (no los de hoy).

## 5. Pruebas

| Tipo | Comando | Resultado |
|---|---|---|
| Puro (regla del cajón) | `node tools/arqueo_test.ts` | **49/49** |
| Puro (arqueo por moneda, F39) | `node tools/pos_cuadre_test.ts` | **66/66** |
| Puro (capacidades de sesión) | `node tools/session_test.ts` | **42/42** |
| Rust | `cd src-tauri && cargo test --lib` | **152/152** (8 ignorados) |
| En vivo (CDP) | `node tools/verify_arqueo_f69.mjs` | **37/37** y **39/39** (dos copias) |
| En vivo (regresión F68) | `node tools/verify_sesiones_caja.mjs` | **28/28** |
| En vivo (regresión F39/F38) | `node tools/verify_tecnico_y_fecha_pago.mjs` | **41/41** (copia con día cerrado) |
| En vivo (smoke integral) | `node tools/verify_smoke_integral.mjs` | OK (×2) |
| Gate de release | `node tools/release_gate.mjs` | LISTO (5 avisos aceptados) |

Tests Rust nuevos: `test_open_day_no_reabre_un_dia_cerrado`, `test_arqueo_del_cajon_con_fondo_y_gastos`,
`test_arqueo_no_resta_la_devolucion_dos_veces`, `test_contra_asiento_va_al_dia_del_movimiento`, más el
bloqueo de PIN persistente dentro de `test_pin_hash_owner_gate_and_lockout`, el rechazo de un método de
pago inventado en `test_expenses_crud` y la validación de 4 dígitos en `test_sesiones_master_y_caja`.

**Revisiones adversariales (3 subagentes: plata, seguridad/permisos, consistencia/veracidad): 4
BLOQUEANTES + 13 MAYORES + varios menores, todos arreglados.** Los bloqueantes: (1) un día sin
movimientos no se podía cerrar (la UI apagaba el botón mientras el backend sí sabe cerrarlo) y el turno
quedaba abierto para siempre; (2) un día con el Punto en negativo no se podía cerrar (la regla exigía
confirmar una línea que la pantalla no dibujaba); (3) `open_day` reabría un día ya cerrado sin gate,
reescribiendo fondo/tasa y borrando la apertura del libro (con botón en la UI); (4) `rollback_update` /
`backup_before_update` sin gate permitían volver a la build anterior a F68 (donde no hay roles).

## 6. Fuera de alcance (anotado, no oculto)

* La **conciliación bancaria por referencia** (cruzar cada Zelle/Pago Móvil con el banco) es F40/F71.
* **El fondo de caja sólo se declara en dólares** (no existe `initial_cash_bs`): una caja que arranca con
  Bs. 500 de vuelto no puede declararlos, así que ese sobrante aparecería como diferencia. Mitigación de
  F69: el cajón se cuenta SIEMPRE en las dos monedas, así que ese sobrante **se ve** («sobran Bs.
  500,00») en vez de quedar en un 0 asumido. Declarar el fondo en Bs. es trabajo pendiente (F71).
* **La caja no puede anotar el gasto que pagó del cajón** (`add_expense` es del dueño): lo anota el
  dueño, o la caja se lo pide. Un comando angosto («gasto del cajón» del mostrador con categoría fija)
  es candidato de F71; hoy el arqueo igual lo descuenta, porque el ajuste se lee del libro.
* Los **cierres viejos** (anteriores a F69) traen `drawer_adjust_*` en 0: se leen igual que antes, con la
  diferencia que el arqueo viejo no contaba. Se corrigen reabriendo el día (↺), contando y volviendo a
  cerrar — el camino que ya existe.
* El **test de gates** (`commands.rs`) es una clasificación curada a mano, no un escaneo exhaustivo:
  derivar la lista de los `generate_handler!` de `lib.rs` y exigir que cada comando esté clasificado
  (leyendo la llamada real, no una mención en un comentario) queda pendiente para F71.
* La caja sigue viendo el **total del día** (`get_daily_totals`) y los números operativos de sus
  pantallas (top de productos de Ventas, KPIs de Servicios, cartera de Clientes): son de día/producto,
  no el desglose por persona ni la utilidad. Lo que NO ve: utilidad, capital del inventario, costo de
  los productos, analíticas del Dashboard, gastos del negocio ni los cobros de otras sesiones.
