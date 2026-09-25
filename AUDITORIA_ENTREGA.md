# Auditoría de producto — ¿está listo para entregarlo al cliente final?

**Fecha:** 2026-09-23 · **Producto:** Registro · Sistema de Servicio Técnico (Tauri 2 + React 19 + SQLite, offline-first)
**Método:** lectura del código y del esquema real · `tools/release_gate.mjs` sobre la plantilla que empaqueta el instalador ·
**la base viva del local** en copia (`backup/revision_f67.db`) · **tres auditorías independientes por área**
(inventario/compras, caja/reportes, taller/operación) · y **verificación propia línea a línea de los hallazgos más caros**.
Lo que no se pudo verificar está marcado **«no verificado»**.

> Diagnóstico, no promesa de alcance. Las decisiones de negocio están marcadas como **pregunta al dueño**.

---

## 0. ESTADO AL CERRAR EL SPRINT A (2026-09-23)

**Los 3 BLOQUEANTES de la sección 3.A están cerrados, implementados y verificados EN VIVO** (sobre copias de la
base real, nunca contra ella). El veredicto de la sección 2 queda actualizado: **el producto es entregable.**

| Bloqueante | Se cerró en | Qué quedó | Verificación en vivo |
|---|---|---|---|
| **A1 — el arqueo mentía por diseño** | **F69** | El esperado del cajón suma el **fondo de caja** y resta los **gastos pagados del cajón** (leídos del libro de plata); cada línea del arqueo (divisas, efectivo Bs., Punto $/Bs., Zelle, Pago Móvil, Transferencia) **tiene que quedar confirmada por el operario** — nada entra «porque el sistema lo dice» — y el día **no se cierra** si falta contar algo. El cajón se cuenta **siempre en las dos monedas**. | `verify_arqueo_f69.mjs` **37/37** y **39/39** (dos copias, una con el turno de hoy y otra con un turno viejo) |
| **A2 — no había respaldo ni restauración** | **F71** | **«Respaldar ahora»** (carpeta elegible, USB incluido) con copia consistente (`VACUUM INTO`), **copia automática al cerrar el día** con retención de 14, lista de respaldos y **«Restaurar»** que valida, guarda una copia de lo actual y se aplica al reiniciar. Aparece en Ayuda → Respaldos. | `verify_respaldo.mjs` **17/17** + `verify_respaldo2.mjs` **7/7** (restauración real de punta a punta) |
| **A3 — una venta no se podía anular** | **F70** | **«Anular»** por fila (dueño) con **motivo obligatorio**: devuelve el stock con su movimiento de inventario, baja la deuda del cliente, deja el **contra-asiento** en el libro con autor y motivo, y el arqueo del día deja de contarla. La venta **no se borra**: queda tachada. | `verify_anular_venta.mjs` **36/36** |

**Además quedaron cerrados** (de la sección 3.B/3.C), por F68/F69/F70/F71:

* **B5 (control de quién hizo qué)** → **F68**: padrón de personas (`users`) + **libro de plata**
  (`cash_movements`) con el **autor copiado** en cada movimiento (ventas, abonos, devoluciones, gastos,
  aperturas, cierres, reaperturas, anulaciones y contra-asientos), sesión con vencimiento de 12 h y rol
  `master`/`caja` **autenticado con PIN propio** (ya no es un botón), y `require_owner` en las escrituras
  sensibles (con un test que fija la lista).
* **B16 (precio 0 = botón muerto)** → **F70**: el formulario **dice qué falta** (producto sin elegir o ficha
  sin precio, con la ruta para cargarlo) y el KPI **«Sin precio»** del Inventario **lista** esas fichas.
* **B19 (tres mentiras de la Ayuda)** → **F70/F71**: «corregir una venta» ahora dice la verdad (se anula) y
  «cómo respaldo» describe el botón real y la copia automática.
* **C3 (la cajera veía Pedidos y no podía crear uno)** → **F69**: la caja ve Pedidos sin costos de compra y
  puede marcar un pedido **Recibido**; crear/borrar pedidos, los costos y el resto de lo del dueño quedaron
  fuera de su alcance.
* **C5 (`export_data` sin gate, con el hash del PIN)** → **F69**: `export_data` pide dueño **y el respaldo ya
  no lleva el hash del PIN** (ni el estado del bloqueo por intentos); el respaldo completo de la base lo hace
  F71 con el archivo entero.

**Lo que sigue abierto (no bloquea la entrega):** el resto de la sección **3.B** (B1..B19, salvo los de arriba),
**3.C** (C1, C2, C4, C6..C11) y **3.D**. Las dos features que quedan del backlog son **F37** (tope de la
devolución en Bs. cuando la tasa cambió) y **F40** (libro único de movimientos para que el arqueo cuadre por
construcción + conciliación bancaria por referencia). El detalle de la entrega —qué se puede usar hoy, cómo se
verifica y cómo se publica la release— está en **`ENTREGA_SPRINT_A.md`**.

---

## 1. Qué es hoy el producto (verificado)

| Dato | Valor |
|---|---|
| Módulos | Dashboard · Ventas · Servicio Técnico · Inventario · Pedidos · Clientes · Libro Diario · Ayuda |
| Backend | **134 comandos** · **17 tablas** |
| Features cerradas | **66** (F1–F67; pendientes **F37** y **F40**) |
| Release | **0.4.4**, updater firmado con respaldo pre-update y rollback del exe |
| Gate de release | **LISTO**, 5 avisos (123 fichas con stock sin precio — excepción aceptada por el dueño —, 137 sin costo, nombre de negocio de la plantilla) |
| Pruebas | 146 tests Rust · ~10 suites de reglas puras · ~45 scripts de verificación en vivo por CDP |

**Lo que ya está y está bien:** venta con descuento de stock · órdenes con workflow, multi-trabajo, técnicos y multi-equipo ·
abonos y pagos parciales **por moneda** · devoluciones **por donde entró la plata** · turno con tasa BCV congelada ·
arqueo **por moneda** con dos diferencias · gastos con categorías · cuentas por cobrar con antigüedad · reposición y pedidos a
proveedor · Dashboard con 7 tarjetas · **utilidad bruta del período con rango libre** · impresión térmica ESC/POS **y** por
spooler de Windows con logo · carga de inventario desde la lista del local · padrón de modelos con pantalla de referencia ·
PIN con rol cajera y **~30 escrituras sensibles gateadas en el backend** (con un test que fija la lista) · actualización
automática con rollback · Centro de Ayuda de 15 secciones que **admite sus propias limitaciones** (`Help.tsx:542-561`).

---

## 2. Veredicto

**ACTUALIZADO 2026-09-23 (al cerrar el Sprint A): el producto ES ENTREGABLE.** Los 3 bloqueantes de la sección
3.A (el arqueo, el respaldo y la anulación de ventas) están cerrados, con pruebas puras, tests Rust y
**verificación en vivo** — ver la sección 0 para el mapa bloqueante → feature → evidencia. Lo que queda abierto
es la sección 3.B/3.C/3.D: mejoras que se pagan en la primera semana de uso, no agujeros que impidan entregar.

**Veredicto original (2026-09-23, antes del Sprint A):** *el producto es entregable, pero no hoy.* Fallaba en
el número más importante de un POS —**el arqueo**— por diseño, y tenía dos agujeros de riesgo (datos y
corrección de ventas) que un dueño descubre en la primera semana.

---

## 3. Huecos por severidad

### A. BLOQUEANTES para entregar — ✅ LOS TRES CERRADOS (F69 · F71 · F70)

> **Estado: cerrados y verificados en vivo.** La columna «Dónde se arregló» dice con qué feature quedó resuelto
> y cómo se comprobó (el detalle está en la sección 0 y en cada spec de `tools/progress/specs/`). El texto de
> «Qué pasa hoy» es el diagnóstico ORIGINAL, tal como se midió antes del Sprint A: se conserva porque explica
> por qué cada cosa se hizo así.

| # | Qué pasaba (evidencia verificada, antes del Sprint A) | Qué necesita el dueño | Dónde se arregló | Estado |
|---|---|---|---|---|
| **A1** | **EL ARQUEO MIENTE POR DISEÑO — el número central del POS.** (a) **Los gastos y los retiros del cajón NO bajan el efectivo esperado**: `compute_daily_totals` suma solo `sales` + `service_payments` + entregados sin pago — verificado: **0 menciones de `expenses`** en la función — y `close_day` espera `cash_usd + zelle + usd_cash` / `cash_bs + pago_movil + transfer_bs` (`db.rs:6186-6191`). La propia UI lo admite: *«Gastos del negocio registrados… **no afectan el arqueo de caja**»* (`DailyLedger.tsx:959`) — y la categoría **«Retiro del dueño»** existe. (b) **La apertura/fondo de caja tampoco entra** (`initial_cash` = 0 menciones) → si hay fondo, «sobran $X» todos los días. (c) **Los digitales se copian del esperado**: el cierre manda `actual_zelle/actual_pago_movil/actual_transfer_bs = esperado` (`DailyLedger.tsx:505-508`; el diálogo solo tiene casillas para Punto impreso, Divisas y Bs. contados) → **esas diferencias son siempre 0 y una transferencia que nunca llegó no la detecta nadie**. | Que el arqueo cuente **plata real**: que los gastos/retiros en efectivo **resten** del esperado, que el fondo de caja se declare, y que los cobros digitales se puedan **verificar** (marcar «no llegó» / conciliar por referencia) en vez de asumirlos. | Es exactamente el alcance de **F40**: `cash_movements` (libro único) + `compute_daily_totals`/`close_day` sumando **solo el libro** + casillas de verificación por método en `DailyLedger.tsx`. Parche acotado: campo «método del gasto» + restar gastos de cajón y sumar la apertura. | **CERRADO EN F69** (`verify_arqueo_f69.mjs` 37/37 y 39/39) |
| **A2** | **No hay respaldo ni restauración dentro de la app.** Los comandos están hechos y probados (`export_data`/`import_data`, `db.rs:6236`) pero **ninguna pantalla los llama** (`db.ts:448-449`). El respaldo automático **solo** existe antes de una actualización (`updates.rs:103`) o de una operación masiva; `rollback_update` restaura **el exe, no la base** (`updates.rs:215-224`). La app le dice al dueño *«copiá registro.db a un USB»* (`Help.tsx:440`). | **«Respaldar ahora»** + **copia automática diaria** al abrir/cerrar el día + **«Restaurar desde un respaldo»** con confirmación. Sin esto, un disco roto se lleva clientes, deudas por cobrar, inventario e historia. | Comandos `backup_database`/`restore_database` (patrón `updates::backup_before_update`) + pantalla en Ayuda/Ajustes + copia automática en `open_day`/`close_day` | **CERRADO EN F71** (`verify_respaldo.mjs` 17/17 + `verify_respaldo2.mjs` 7/7) |
| **A3** | **Una venta no se puede corregir ni anular** (no existe `update_sale`/`delete_sale` entre los 134 comandos ni `DELETE FROM sales`; lo admite el propio smoke del proyecto, `verify_smoke_integral.mjs:471-488`). Una cantidad o un precio mal tecleado **queda en la caja de ese día para siempre**; reabrir el día no lo saca. Y **una pantalla devuelta no vuelve al stock** (no hay borrado ni asiento de reverso). Peor: `Help.tsx` dice *«¿Puedo corregir una venta o servicio? Sí»* — verdad para servicios, **mentira para ventas**. | Anular con **motivo** + **asiento de reverso** (stock de vuelta, movimiento de inventario, ajuste del cliente) y/o corregir; y que la Ayuda diga la verdad. | `void_sale(id, reason)` transaccional en `commands.rs`/`db.rs` (`voided_at`/`void_reason` al final) · acción «Anular» por fila en `Sales.tsx` · corregir `Help.tsx` | **CERRADO EN F70** (`verify_anular_venta.mjs` 36/36) |

### B. ESENCIALES (arrancan el día 1 — o se pagan en la primera semana)

| # | Hueco (evidencia) | Esf. |
|---|---|---|
| **B1** | **El stock puede mentir en tres formas:** `add_sale` **no valida stock** (resta y deja negativo); el formulario de producto escribe `stock=?9` en `update_product` (`db.rs:2733`) **sin dejar movimiento** (verificado: esa función no toca `inventory_movements`); y `add_inventory_movement` **no lo llama ninguna pantalla** (el motivo «Ajuste» del desplegable nunca se escribe). | S-M |
| **B2** | **El equipo no se identifica:** `services` tiene 34 columnas y **ninguna es IMEI/serie/patrón** (grep = 0; la «clave/patrón» es un tilde Sí/No). Ya hay **2 órdenes del mismo cliente con el mismo modelo** en los datos. | M |
| **B3** | **La utilidad que muestra el sistema es falsa:** la recepción de un pedido **no actualiza `price_cost`** (`db.rs:3782-3786`) y el COGS se lee **en vivo** (`db.rs:4282`) → cambiar un costo **reescribe la utilidad de meses pasados**; las ventas sin `product_id` cuentan costo 0 (margen 100 %); y **los gastos no se descuentan** de la utilidad (no hay estado de resultados). | M |
| **B4** | **Reposición muerta con los datos reales:** `min_stock = 0` en **939 de 964** fichas → con 919 productos en cero el sistema sugiere comprar **7**. Y el mismo concepto da **dos números**: 5-7 (con guard) en Inventario y **924 filas** en el Dashboard. La UI de Pedidos **descarta uno de los tres cubos** de la fórmula. | M |
| **B5** | **Sin control de quién hizo qué:** no hay tabla de usuarios ni atribución en ninguna escritura (0 columnas `user/_by/who`); **`sync_log` existe y nunca se escribe**; borrar un abono es **un clic sin confirmación**, reabrir un día es **un clic que borra `closed_at`** (la evidencia), y mover la fecha de un pago —plata que cambia de caja— **no deja ni la fecha anterior**. El rol «cajera» **no se autentica: es un botón** y esa sesión puede **editar el monto de una orden**. | L (usuarios) · **M por el log de plata** |
| **B6** | **Un solo turno por día:** `daily_closings.close_date` es **UNIQUE** → dos cajeras imposibles; reabrir la misma fila y volver a cerrar **PISA el arqueo del primer turno** (se pierde la evidencia) y el cierre **no guarda quién lo hizo**. | M |
| **B7** | **Guard flojo de día abierto:** `require_open_day` solo comprueba `EXISTS(is_closed=0)` y las ventas **no escriben la fecha** → con un **turno añejo abierto**, las ventas de hoy caen en una fecha **sin fila de cierre** (sin tasa ni apertura, y cerrar ese día falla), y las ventas en Bs. se convierten **con la tasa del turno ajeno**. | S-M |
| **B8** | **No hay vuelto/cambio** (no existe campo «efectivo recibido» ni «vuelto», en Ventas ni en Cobros): es la operación más repetida del mostrador y hoy el cajón queda corto por el vuelto. | S |
| **B9** | **Nada se imprime de una venta** (`Sales.tsx` no tiene una línea de impresión): se puede vender una pantalla **sin dar papel**. Tampoco se imprime el **cierre de caja** ni etiquetas; el bloque de **condiciones del ticket nunca se pasa** (`terms` siempre `undefined`) → el cliente firma un papel sin condiciones; y la impresora «normal» solo funciona por RAW ESC/POS (**no hay camino A4/PDF**). | M |
| **B10** | **La app pide fotos y no guarda ninguna imagen:** `photo_in_at`/`photo_out_at` son **marcas de fecha**; el único input de imagen del producto es el **logo de la impresora** (base64 en `settings`) → el patrón técnico ya existe, falta aplicarlo al equipo. | M |
| **B11** | **No hay presupuesto ni autorización del cliente:** el «Presupuesto estimado» es el mismo `amount` (no obligatorio), nada impide pasar a «En reparación» sin autorización, y no existe cargo por diagnóstico. No se puede probar que el cliente aprobó el monto. | M |
| **B12** | **Garantía sin registro de reclamo:** el cálculo de 7 días es real y está testeado, pero el reclamo se maneja **reabriendo la misma orden** (limpia `date_out`, **pierde el histórico** de la reparación original y no deja constancia de que fue garantía); sin aviso de vencimiento ni costo de la garantía. | M |
| **B13** | **Las ventas no entran en la conciliación de pagos:** `search_payments` y el detalle diario hacen JOIN con `services` → **una venta por Zelle/Pago Móvil no se puede conciliar por referencia**; y el drill-down de una celda del Diario **no suma lo que muestra la celda** (el total incluye ventas, el detalle solo abonos). | S-M |
| **B14** | **Reportes torcidos (números que el dueño va a leer mal):** la columna **«Punto Neto» de Cierres mezcla Bs. y USD rotulada en dólares** (`db.rs:5162` vs `DailyLedger.tsx:855`: un día con $10 + Bs. 8.530 muestra ≈$8.540 en vez de ≈$20); el ranking de productos (`Sales.tsx`) hace `SUM(total)` **sin separar moneda** e imprime `$` en cada fila; en el Excel, **«Ventas USD/Bs» y «Total USD/Bs» son el mismo dato** (el dueño lee «vendí $X» cuando eso es «entró $X»); `actual_punto_usd` se guarda mezclado; y hay informes que **no existen** (por mes/año, por categoría con rango, por método separado de servicios, estado de resultados, cierre mensual, libro de ventas). | M |
| **B15** | **Excel dependiente de Python:** `export_daily_report_xlsx` corre `python`/`py -3` con `openpyxl`; si falta **cae a CSV en silencio** — y el CSV **no trae la hoja de Gastos**. En la PC del cliente Python no va a estar. | S-M |
| **B16** | **Precio 0 = botón muerto sin explicación** (`Sales.tsx:332` `if (price <= 0) return;`, botón `disabled` sin mensaje): hay **8 fichas con stock y sin precio** en la base viva. Tampoco hay lista de «fichas con stock sin precio». | S |
| **B17** | **Cobranza pasiva:** «Cuentas por cobrar» **trunca a 15 ítems sin avisar**, **no trae el teléfono** (no se puede avisar), **no se puede cobrar desde ahí**, y cuenta órdenes que **aún no salieron del taller** como deuda con antigüedad desde el ingreso. Y **no hay ningún canal de aviso al cliente** (grep `whatsapp`/`wa.me`/`sms`/`tel:` = 0): el aviso depende de la memoria del operario. | S-M |
| **B18** | **Si la base se corrompe, la app no abre y no dice nada:** `Database::new(..).expect(..)` + `windows_subsystem = "windows"` sin hook de pánico ni diálogo → el proceso muere y el operario ve que «no abre» (el health-check solo corre tras una actualización). | S-M |
| **B19** | **Tres mentiras de la documentación in-app** (baratas de arreglar, caras de desconfiar): «podés corregir una venta» (A3); «se pueden llevar los datos a otra PC con respaldo/importación manual» (`Help.tsx:558`, y esa importación **no tiene pantalla**); y `PricesTab.tsx:329-332` dice que la carga de precios **guarda respaldo** y `restore_prices` **no lo hace**. Además `Help.tsx:407` dice «6 hojas» del Excel cuando son 7. | S |

### C. IMPORTANTES (lo que separa «sistema del taller» de «POS del negocio»)

| # | Hueco | Comentario |
|---|---|---|
| **C1** | **Multiusuario en red / segundo mostrador:** sin sucursal, terminal ni sync; dos PCs = dos islas (cada una con su base, su PIN, su día abierto y su stock). Vender en el mostrador B **no baja el stock de A**. | **Pregunta al dueño** |
| **C2** | **Compras incompletas:** proveedor **texto libre y vacío en el 100 % de las fichas** (no hay tabla `suppliers`), **sin recepción parcial** (no hay `received_qty`), **sin cuentas por pagar ni pagos al proveedor**, sin devolución a proveedor, y **borrar un pedido recibido no revierte el stock**. | M-L |
| **C3** | **La cajera ve Pedidos y no puede crear uno** (`add_purchase_order` exige dueño) → callejón sin salida con el PIN de cajera. | S |
| **C4** | **Bombas latentes de catálogo:** `import_price_list` usa `INSERT OR IGNORE` **sin índice único en `products.name`** (verificado: los 4 índices no son únicos) → **invocarlo duplica el catálogo**; y no tiene UI. `merge_products` **suma el stock** sin deshacer. | M |
| **C5** | **`export_data` no pide dueño** y devuelve **todas las tablas incluida `settings` con el hash del PIN** (`commands.rs:423`; lista verificada) → un PIN de 4 dígitos se rompe offline en minutos. | S |
| **C6** | **Impuestos / facturación fiscal:** cero (IVA, correlativo fiscal, libro de ventas, RIF, retenciones, PDF). El contador del local no puede trabajar con esto. | **BLOQUEANTE si el local factura formalmente** · L |
| **C7** | **Tasas:** solo BCV (EUR se guarda y **no se usa**); **no se puede cobrar en Bs. a una tasa distinta de la del día** (si el local usa paralela, el operario teclea Bs. pero el equivalente en USD —saldo, utilidad, Total General— se sigue calculando a BCV). | **Pregunta al dueño** · M |
| **C8** | **Código de barras y etiquetas de precio:** el `code` (`P-0142`) sirve para buscar sin guiones, pero no hay lector ni etiquetas imprimibles. | M |
| **C9** | **Pago mixto en un solo acto** ($ + Bs. en la misma venta) no existe (sí se puede con dos abonos en un servicio). | S-M |
| **C10** | **Onboarding:** sin asistente de primeros pasos ni verificación de instalación (PIN cambiado / inventario cargado / impresora probada / día abierto). El Centro de Ayuda es de consulta. | S-M |
| **C11** | **Rendimiento con años de datos:** el N+1 de la lista de servicios (>120 filas) es el mismo **F40**. | Con F40 |

### D. DESEABLES (no antes de entregar)
Propinas · comisiones por técnico · fidelidad · portal/estado para el cliente · multi-sucursal con transferencias ·
balanza/lector · app móvil del técnico · integración con la máquina de Punto (hoy la comisión se registra a mano) ·
reposición predictiva por demanda.

---

## 4. Plan de entrega propuesto

**Sprint A — «entregable sin sustos» (≈1 semana).** A1 arqueo verdadero (gastos/retiros que restan, fondo de caja, casillas de
verificación digital) · A2 respaldo/restauración + copia diaria · A3 anular venta con asiento de reverso y devolución al stock ·
B16 aviso de ficha sin precio · B19 corregir las mentiras de la Ayuda · C5 gate del export.
→ Con esto **se entrega**.

**Sprint B — «las primeras dos semanas del cliente» (≈2 semanas).** B1 stock trazable (ajuste con motivo + aviso de venta sin
stock) · B2 IMEI/serie/patrón · B3 costo de compra → utilidad verdadera (congelar costo en la venta) · B4 reposición viva ·
B5 bitácora de plata · B6 turno por cajero · B7 guard de día abierto · B8 vuelto · B9 factura de venta + condiciones +
cierre impreso · B10 fotos reales · B11 presupuesto/autorización · B12 reclamos de garantía · B13 ventas en la conciliación ·
B14 arreglar los números torcidos de los reportes · B15 Excel sin Python · B17 cobranza con aviso al cliente · B18 mensaje
claro si la app no arranca · C3 permiso de Pedidos.

**Sprint C — «POS completo» (a decidir con el dueño).** Usuarios nominales con roles · el resto de F40 (conciliación bancaria
por referencia, pantalla de movimientos) · multi-PC · C6 facturación fiscal · C8 código de barras/etiquetas · C2 compras
completas · C4/C7/C9.

**Ventaja para no apurar:** la app **se actualiza sola con respaldo y rollback**, así que se puede **entregar con el Sprint A**
y seguir mejorando en producción sin reinstalar. No hay que esperar a tener todo; sí hay que entregar sin los riesgos de 3.A.

**Checklist del día de la instalación:** PIN propio del dueño (cambiar 1234) · nombre/línea/logo del negocio en Impresora ·
puerto COM y ancho de papel + ticket de prueba · abrir el día con la tasa BCV y el **fondo de caja** · cargar precios de las
fichas con stock sin precio · cargar costos · **primer respaldo** · capacitación de 30 min (recibir → reparar → cobrar →
entregar → cerrar el día) · **acordar con el dueño que hoy los gastos de cajón no bajan el esperado** (hasta el Sprint A).

---

## 5. Preguntas al dueño (cierran el alcance)

1. **¿Cuántas PC/mostradores y cuántas personas** lo usan? ¿Hay más de una cajera por día? (C1, B5, B6)
2. **¿Emitís factura fiscal** o alcanza el comprobante interno? (C6)
3. ¿Pagás **gastos desde el cajón** (mensajero, repuesto, retiro tuyo)? ¿Con qué frecuencia? (A1)
4. ¿Verificás **Zelle/Pago Móvil/Transferencia** contra el banco al cerrar? (A1)
5. ¿Querés **IMEI obligatorio** en la recepción? ¿y **fotos** de entrada/salida? (B2, B10)
6. ¿Presupuestás antes de reparar y registrás si el cliente aprobó? (B11)
7. ¿Te dejan **saldo** seguido? ¿Querés aviso por WhatsApp cuando el equipo está listo y recordatorio de deuda? (B17)
8. ¿Cobrás en **dos monedas en el mismo acto** o usás una tasa distinta de la BCV? (C9, C7)
9. ¿Tenés **código de barras** o etiquetás precios? (C8)
10. ¿Quién más toca la plata y querés que el técnico tenga su propio acceso? (B5)

---

## 6. Lo que NO haría (para no inflar el alcance)
- **Nube / móvil / portal del cliente** antes de cerrar arqueo, respaldo y auditoría.
- **Integrar la máquina de Punto**: el equipo es externo y la comisión ya se registra; es un proyecto aparte.
- **Multi-sucursal** mientras haya una sola PC: es arquitectura, no una pantalla.
- **Migrar a Postgres/Supabase**: SQLite con WAL y `synchronous=FULL` aguanta este volumen; el problema no es el motor.
- **Facturación fiscal "por las dudas"**: se hace si el dueño confirma que factura; si no, es la mitad del Sprint C tirada.

---

## 7. Fuentes y verificación cruzada

- **Verificado por mí (agente principal), línea a línea:** esquema real y comandos · gate de release · base viva ·
  `close_day`/`compute_daily_totals` **sin gastos ni apertura** (conteo de menciones = 0) · el cierre precargando los digitales
  con el esperado y la ausencia de casillas para verificarlos · ausencia de `update_sale`/`delete_sale` · recepción de pedido
  sin `price_cost` · `add_sale` sin validar stock · `update_product` escribiendo stock sin movimiento · `INSERT OR IGNORE` sin
  índice único · `export_data` sin gate con `settings` · receivables solo en la pestaña `salud` (owner) · `Help` contradiciendo
  la realidad · botón de venta muerto con precio 0.
- **Auditoría de inventario/compras:** pestañas reales del módulo · `loadlist.rs` (conteo solo en categorías de pantalla) ·
  fórmula y cubos de reposición · `restore_prices`/`import_price_list` · proveedor como texto · riesgos de stock negativo.
- **Auditoría de taller/operación:** identificación del equipo · presupuesto · garantía · fotos · roles y auditoría · respaldo ·
  impresión · multi-local · onboarding · arranque fallido.
- **Auditoría de caja/reportes:** turno único y `reopen_day` que pisa el arqueo · guard flojo de día abierto · vuelto ·
  conciliación de ventas · reportes mezclando monedas · impuestos · tasas · alcance real de F40.
- **No verificado (declarado):** las auditorías fueron de **solo lectura** (no se ejecutó la app ni los `verify_*.mjs`); no se
  probó hardware de impresión; **nada está medido con datos reales de producción** (la copia usada es un fixture casi vacío:
  0 ventas, 0 gastos, 1 abono, 2 órdenes); qué muestra Windows cuando el proceso muere por el `expect` de `lib.rs:18`;
  si el local usa tasa paralela; si debe facturar fiscalmente; si hay más de una cajera.
