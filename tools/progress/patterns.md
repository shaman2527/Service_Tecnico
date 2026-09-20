# Codebase Patterns

> Auto-consolidated learnings from loop iterations.
> Last updated: 2026-09-20T17:13:10.156Z
>
> NOTA (2026-09-18): este archivo había llegado a 310 MB porque el consolidador DUPLICABA el
> contenido en cada corrida (20 aprendizajes únicos, uno repetido 524.288 veces). Se deduplicó con
> `node tools/dedupe_patterns.mjs` conservando TODOS los aprendizajes únicos. Si vuelve a crecer,
> correr ese script otra vez y arreglar la consolidación (no borrar aprendizajes a mano).

---

### Errores Recurrentes (CRITICAL)

- `[CRITICAL]` «Hoy» con new Date().toISOString().slice(0,10) es la fecha UTC: en Venezuela (UTC−4) a partir de las 20:00 devuelve el día SIGUIENTE y los listados de «hoy» (Ventas, Servicios, Libro Diario, perfil de técnico) quedan VACÍOS con las ventas ya registradas (medido 2026-09-16 22:08: la venta del día no aparecía). En el backend, date('now','-N days') sin localtime también pierde un día en las ventanas. (1)
  - src/components/Sales.tsx (period hoy/mes)
  - src/components/Services.tsx (rango de días)
  - src/components/DailyLedger.tsx (today + startDate/endDate)
  - src/components/TechnicianProfile.tsx (iso)
  - src-tauri/src/db.rs (date('now','-N days'))

- `[CRITICAL]` Comandos angostos de actualización (updateOrderKeepingFields, update_service_payment_date) y el patrón ??  con null: en TypeScript, patch.x ?? valorViejo NO permite BORRAR un dato (null cae al valor viejo) — para campos que pueden quedar vacíos a propósito (desasignar un técnico, limpiar una pantalla) hay que usar patch.x !== undefined ? patch.x : valorViejo. Y del lado del backend, un parámetro vacío suele tener un SIGNIFICADO (en update_service, date_out = '' significa «estampá hoy» cuando el estado es Entregado): un helper de actualización angosta debe CONSERVAR el valor actual del campo que no está cambiando, nunca mandar vacío «por defecto» — mandar '' al cambiar el técnico de una orden entregada le movía la fecha de entrega a hoy y con ella el monto de la caja de ese día a la de hoy. (1)
  - src/lib/service-update.ts (patch.dateOut ?? s.date_out y patch.technicianId !== undefined)
  - src-tauri/src/db.rs update_service: date_out vacío + status Entregado = hoy
  - tools/verify_tecnico_y_fecha_pago.mjs (orden entregada el 2026-01-05 conserva su date_out)
  - AGENTS.md F34/F35 2ª vuelta adversarial

- `[CRITICAL]` Invalidar una memoria/derivado con SELECT total_changes() de SQLite NO alcanza: es un contador POR CONEXIÓN. Con dos ventanas de la app abiertas (no hay guard de instancia única) o con una herramienta de tools/ escribiendo mientras la app está abierta, la escritura ajena no mueve el contador y la memoria sirve números viejos indefinidamente (medido: con la app abierta, un INSERT de otro proceso dejaba el KPI del padrón en el valor anterior). La señal correcta es el PAR (SELECT total_changes(), PRAGMA data_version): data_version sube en cada commit AJENO y no cambia con las escrituras propias. (1)
  - src-tauri/src/cache.rs (version_of)
  - src-tauri/src/db.rs test_catalog_cache_sees_writes_from_another_connection
  - tools/verify_inventario_rapido.mjs
  - medición en vivo: app 1137 vs base 1136 antes del arreglo

- `[CRITICAL]` PLATA: nunca proponer un método de pago sacándolo del FORMULARIO de la orden. En este proyecto services.payment_method es sólo «lo que se esperaba cobrar», NO lo que entró; proponerlo como método de una DEVOLUCIÓN metió la salida en un bucket que nunca cobró (Punto de Venta (Bs) quedó en −Bs. 1.697 — una máquina que devuelve plata no existe) y, como las filas/columnas del Libro y del cierre se dibujaban sólo con esperado > 0, la plata que salió del cajón no aparecía en NINGUNA pantalla del arqueo. Regla del local: la devolución vuelve POR DONDE ENTRÓ (el método con más ingreso neto en esa moneda); el gate va también en el backend (fail-closed), no sólo en la UI, y los métodos de cajón pueden pagar del cajón con aviso. (1)
  - src/components/RefundDialog.tsx (propuesta del método)
  - src-tauri/src/db.rs add_service_refund (gate por método)
  - src/lib/refund-math.ts (reglas puras)
  - src/components/DailyLedger.tsx (has*/drill-down con > 0.005)
  - caso real 2026-09-17: Punto −Bs. 1.697 y devolución invisible
  - Fix: Derivar el método de los MOVIMIENTOS (ingresos por método), bloquear en el backend los métodos que no cobraron en esa moneda (salvo cajón, con aviso) y usar |x| > tolerancia —nunca x > 0— para decidir si una columna/fila de dinero se muestra.

- `[CRITICAL]` Riesgo de COBRO DUPLICADO en el asistente de cierre: si add_service_payment ya guardó el cobro y luego falla update_service (el cierre), el error se muestra pero el botón vuelve a habilitarse; el operario reintenta y el pago se registra OTRA VEZ sobre la misma orden. El estado busy solo protege del doble click inmediato, no del reintento tras un fallo parcial. (1)
  - src/components/CierreServiceDialog.tsx → cerrar(): await api.addServicePayment(...) seguido de await api.updateService(...) en el mismo try; el catch solo hace setError(...)
  - El patrón correcto ya está planificado: close_service_delivery transaccional (F32 del spec)
  - tools/progress/specs/F30-asistente-cierre.md §4, salvaguarda «Cierre a medias»

- `[CRITICAL]` Una regla de dinero debe tener UNA sola implementación, y las MIGRACIONES DE ARRANQUE son parte de ella: en este proyecto db.rs::init() tenía su propio UPDATE de paid_amount con la fórmula vieja y, como init() corre en cada arranque, revertía la regla nueva cada vez que se abría la app (el mismo saldo valía distinto según cuál fue la última acción). Al cambiar una fórmula de dinero hay que buscar TODAS las copias de la fórmula (incluidas las migraciones y los UPDATE inline en init()), y dejar un test que simule el REINICIO (cerrar y reabrir la base) — no solo el camino de la app. Además, en un invariante de dinero («X nunca puede ser negativo») hay que enumerar los caminos que lo rompen y cubrir cada uno: borrar un movimiento después de devolver, la tolerancia de redondeo aplicada repetidamente con el saldo en 0, y un monto con signo contrario que saltea el tope. (1)
  - src-tauri/src/db.rs (init() recorre y llama recalc_paid_amount)
  - test_migration_keeps_f36_net_rule (fail con la fórmula vieja: 190 en vez de 211.11)
  - test_refund_by_currency_net pasos 9-11 (deriva por tolerancia, monto negativo, borrar cobro ya devuelto)
  - tools/audit_paid_amount_f36.mjs (medición sobre copia de la base real)

### HIGH

- `[HIGH]` Agregar un bloqueo nuevo sin buscar antes un caso legítimo que lo viole: F32 puso el «monto > 0» como gate del guardado (para que la guía no mintiera) y dejó sin poder guardar una orden de $0 (garantía/cortesía) — había una orden REAL así en la base (DEV-0006). El bloqueo se revirtió y la guía pasó a mostrarlo como AVISO. (1)
  - src-tauri/src/db.rs (services amount 0 en dev_registro.db: DEV-0006)
  - src/components/Services.tsx (save() / disabled del botón)
  - src/lib/service-guide.ts (item 'amount' con required:false)

- `[HIGH]` Al verificar la UI por CDP: los chips de TRABAJOS del service form (Cambio pantalla, Cambio batería…) NO son toggles de Radix — no llevan data-state ni aria-pressed; el activo se pinta con bg-primary. Los chips de MÉTODO DE PAGO sí llevan data-state="on". Confundirlos hace que la prueba «vea apagado» un chip activo y que un click lo APAGUE (el paso queda sin trabajos y el wizard no avanza).

- `[HIGH]` Al verificar la UI por CDP: los chips de TRABAJOS del service form (Cambio pantalla, Cambio batería…) NO son toggles de Radix — no llevan data-state ni aria-pressed; el activo se pinta con bg-primary. Los chips de MÉTODO DE PAGO sí llevan data-state="on". Confundirlos hace que la prueba «vea apagado» un chip activo y que un click lo APAGUE (el paso queda sin trabajos y el wizard no avanza). (1)
  - src/components/Services.tsx: emptyDevice() arranca con serviceTypes: ['Cambio pantalla']
  - tools/verify_smoke_integral.mjs: chipTrabajoOn() por className vs toggled() por data-state

- `[HIGH]` En las pruebas CDP, si el script asume que al hacer clic en el menú o en una pestaña la vista se vuelve a montar y vuelve a consultar, puede leer NÚMEROS VIEJOS que parecen un bug del producto y son del script: si la app ya estaba en esa pantalla/pestaña, el clic no cambia el estado de React, no hay remount y no hay consulta nueva. verify_models_tab.mjs reportaba «KPI Teléfonos» con el valor de la corrida anterior por esto. Arreglo: recargar la SPA al empezar (location.reload() + re-login con el PIN) y/o esperar una condición con waitFor en vez de dormir. (1)
  - tools/verify_models_tab.mjs (arranque con location.reload)
  - tools/verify_inventario_rapido.mjs (waitFor + comparación contra la base)

- `[HIGH]` En React los EFECTOS corren DESPUÉS del render: si un efecto decide algo a partir de un estado que se resetea en OTRO efecto del mismo commit, lee el valor VIEJO. Caso real: al abrir el diálogo de abono de otra orden, el efecto que elige la moneda del campo (F38) todavía veía el array de pagos de la orden anterior (el setPayments([]) del efecto de inicialización se aplica en el siguiente render) y pisaba la moneda correcta → una orden cobrada por Pago Móvil abría el campo en dólares y 5000 tecleados se guardaban como Bs. 3.743.950. Fix: validar la PERTENENCIA de los datos (payments[0].service_id === service.id) antes de usarlos, además de limpiarlos al cerrar. (1)
  - src/components/PaymentDialog.tsx (pagosDeEstaOrden)
  - src/components/CierreServiceDialog.tsx (setMovimientos([]) + curTouched)

- `[HIGH]` La ventana de Tauri sirve el frontend EMBEBIDO en el binario: tras npm run build hay que recompilar (cargo build, que re-embebe dist/) y relanzar la app, si no la verificación en vivo prueba el frontend VIEJO. En F32 un script CDP falló («el talón no imprime ACORDADO») solo porque el binario tenía el bundle previo al cambio. (1)
  - tools/verify_recordatorios.mjs (fallo del ACORDADO con el bundle viejo)
  - src-tauri/src/lib.rs (comentario de «force rebuild»)
  - AGENTS.md (lección de entorno F28)

- `[HIGH]` NUNCA redondear un monto antes de multiplicarlo por la tasa: el número que la pantalla muestra debe ser EXACTAMENTE el que se cobra. orderBalance calculaba bs = round(round2(saldo) * tasa) mientras el chip «Todo el saldo» usaba el saldo sin redondear → la pantalla decía Bs. 72.880,00 y el cobro era 72.879 (1 bolívar de diferencia en cada cobro, medido en vivo). Regla: el saldo se redondea SOLO para mostrarlo en su moneda; la equivalencia se calcula con el valor sin redondear, y se fija con una prueba de paridad contra la función que cobra (suggestAmount/saldoChipValue), no contra un número escrito a mano. (1)
  - src/lib/order-balance.ts (bs = Math.round(usdRaw * tasa))
  - tools/pos_cuadre_test.ts (paridad con saldo no redondo: paid_amount = 2000/748.79 = $2,6711)
  - tools/verify_tecnico_y_fecha_pago.mjs: saldo=72879 · cobro=72879

- `[HIGH]` Optimizar «a ojo» lleva a arreglar lo que no molesta: medir PRIMERO (test manual en RELEASE sobre una copia + un script CDP que mide lo que ve el operario, de la pestaña con datos) mostró que Productos ya costaba 2-5 ms y que el problema eran 4 cálculos derivados del catálogo repetidos en cada pestaña (índice de teléfonos 118 ms, totales 140 ms, KPIs 113 ms, compatibilidad parseada 240 ms). Medir en debug o mirar «cuántas consultas hace» habría llevado a optimizar lo barato. El bench queda como herramienta (test_manual_inventory_bench, tools/bench_inventory_ui.mjs) para no volver a discutir con impresiones. (1)
  - src-tauri/src/db.rs test_manual_inventory_bench
  - tools/bench_inventory_ui.mjs
  - AGENTS.md sección F41 (tabla antes/después)

- `[HIGH]` Prueba que CUENTA elementos en vez de verificar su TEXTO: la verificación en vivo de la cola/picker contaba «3 chips» con una regex laxa (/PUNTO Bs|PAGO MOVIL|EFECTIVO/) y por eso NO detectó que el chip del método más usado se pintaba «PUNTO Bs Bs.» (currencySymbol('VES') devuelve 'Bs. ' CON espacio final y el helper no lo recortaba). Lo cazó la revisión adversarial, no la prueba. (1)
  - src/lib/payment-methods.ts → simboloSiAporta (antes en PaymentMethodPicker.tsx, sin test)
  - src/lib/utils.ts → currencySymbol('VES') = 'Bs. ' (espacio final)
  - tools/verify_wizard_metodos.mjs (la aserción vieja solo contaba chips)

- `[HIGH]` Publicitar un atajo de teclado sin cerrar sus puertas: F31 mostró «Ctrl+Enter guarda» en el pie del wizard y el atajo llamaba a save() SIN los gates que sí tenía el botón (cédula obligatoria del cliente nuevo, día abierto, guardado en curso) → se podía guardar un cliente sin cédula (el dato que va impreso en el recibo) o con el día cerrado y sin mensaje. (1)
  - src/components/Services.tsx → save() (los gates vivían SOLO en el disabled del botón)
  - src/components/Services.tsx → onKeyDown del DialogContent (Ctrl+Enter → save())

- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno.

- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno. (1)
  - CierreServiceDialog.tsx cambió a las 19:15, 19:24 y 19:31 durante esta sesión; Services.tsx a las 19:16 y 19:19
  - tools/verify_servicio_cierre.mjs (script de la otra sesión) se editó a las 19:37 con la app Tauri viva (pid registro 11168)
  - AGENTS.md → sección «Asistente de Cierre de Servicio (F30)» → lección CRÍTICA de coordinación

- `[HIGH]` Un HUECO en los datos NUNCA se esconde: se muestra el número y se marca la duda. La primera versión de F39 ocultaba la diferencia de un cierre con el arqueo en 0 («sin arqueo») para no inventar un descuadre en datos migrados — y con eso tapaba un faltante REAL (cerrar el día con las dos casillas en 0, o abrir el diálogo cuando falla la lectura de totales, guarda un cierre que dice que el cajón está vacío). Lo correcto: mostrar SIEMPRE el cálculo y agregar una marca («sin contar») con el remedio en el title; y bloquear la acción que produce el dato malo (no cerrar el día sin haber leído los totales).

- `[HIGH]` Un HUECO en los datos NUNCA se esconde: se muestra el número y se marca la duda. La primera versión de F39 ocultaba la diferencia de un cierre con el arqueo en 0 («sin arqueo») para no inventar un descuadre en datos migrados — y con eso tapaba un faltante REAL (cerrar el día con las dos casillas en 0, o abrir el diálogo cuando falla la lectura de totales, guarda un cierre que dice que el cajón está vacío). Lo correcto: mostrar SIEMPRE el cálculo y agregar una marca («sin contar») con el remedio en el title; y bloquear la acción que produce el dato malo (no cerrar el día sin haber leído los totales). (1)
  - src/lib/cash-closing.ts (sinContar)
  - src/components/DailyLedger.tsx (data-sin-contar + disabled={!expected})
  - tools/pos_cuadre_test.ts (la diferencia se muestra igual)

- `[HIGH]` UX del wizard de recepción (F33): la guía va DENTRO del flujo, nunca flotando encima. Un aviso que aparece mientras el operario está cargando datos es indistinguible de un aviso que le tapa la pantalla y le roba el foco (el usuario lo reportó como «me siento muy invadido… no me deja ver lo que estoy registrando»). Reglas: (1) ningún aviso emergente durante la carga — los recordatorios de política solo en los 3 cierres de acción (guardar la recepción, imprimir, entregar); (2) UN dato por vez con su nombre técnico + guía corta + botón «Ir al campo»; (3) la ficha completa se CONSULTA («Ver ficha»), no se impone, y tocar un dato lleva a su paso SIN borrar el resto (el «corregir [campo]»); (4) el progreso se muestra como «X/16 datos» en una línea, no como barra que ocupe lugar; (5) al abrir un diálogo, fijar el foco explícitamente con onOpenAutoFocus (Radix enfoca el contenedor DESPUÉS del useEffect, así que el focus programático del componente se pierde).

- `[HIGH]` UX del wizard de recepción (F33): la guía va DENTRO del flujo, nunca flotando encima. Un aviso que aparece mientras el operario está cargando datos es indistinguible de un aviso que le tapa la pantalla y le roba el foco (el usuario lo reportó como «me siento muy invadido… no me deja ver lo que estoy registrando»). Reglas: (1) ningún aviso emergente durante la carga — los recordatorios de política solo en los 3 cierres de acción (guardar la recepción, imprimir, entregar); (2) UN dato por vez con su nombre técnico + guía corta + botón «Ir al campo»; (3) la ficha completa se CONSULTA («Ver ficha»), no se impone, y tocar un dato lleva a su paso SIN borrar el resto (el «corregir [campo]»); (4) el progreso se muestra como «X/16 datos» en una línea, no como barra que ocupe lugar; (5) al abrir un diálogo, fijar el foco explícitamente con onOpenAutoFocus (Radix enfoca el contenedor DESPUÉS del useEffect, así que el focus programático del componente se pierde). (1)
  - src/components/FichaIngreso.tsx
  - src/lib/ficha.ts
  - src/components/Services.tsx (onOpenAutoFocus)
  - tools/verify_recordatorios.mjs: «al abrir una recepción NO hay avisos flotantes» avisos=0; «el asistente no le roba el foco al primer campo (arranca en Cliente)»
  - AGENTS.md: sección «Recordatorios de política + ficha de ingreso»

### MEDIUM

- `[MEDIUM]` Avisos flotantes con acciones (sonner) en este proyecto: la tarjeta va con pointer-events-none y solo sus botones con pointer-events-auto (si no, se come los clics que van a los botones del formulario/diálogo de abajo), y cada aviso se muestra con un id ESTABLE (policy-<clave>-<orden>) para que el mismo recordatorio pedido dos veces en el mismo gesto (entregar + imprimir) no se apile en dos tarjetas iguales.

- `[MEDIUM]` Avisos flotantes con acciones (sonner) en este proyecto: la tarjeta va con pointer-events-none y solo sus botones con pointer-events-auto (si no, se come los clics que van a los botones del formulario/diálogo de abajo), y cada aviso se muestra con un id ESTABLE (policy-<clave>-<orden>) para que el mismo recordatorio pedido dos veces en el mismo gesto (entregar + imprimir) no se apile en dos tarjetas iguales. (1)
  - src/components/PolicyToast.tsx
  - src/components/policy-actions.ts
  - tools/verify_recordatorios.mjs (comprueba pointer-events y el dedupe)

- `[MEDIUM]` En las pruebas EN VIVO por CDP hay que ESPERAR LA CONDICIÓN, no el reloj. verify_servicio_cierre.mjs esperaba 1500 ms fijos tras abrir el asistente y fallaba 1 de cada 3 veces: la consulta de pantallas compatibles se encola detrás de las que dispara la lista de servicios (hasta 120 llamadas IPC de movimientos) y a veces tardaba más. Un helper waitFor(expr, timeout) que sondea el DOM (por ejemplo, hasta que aparezca la sección o la elección quede marcada) hizo la prueba determinista (17/17 tres veces seguidas). Corolario: una prueba que falla «a veces» no es un producto flojo, es una prueba mal escrita — y arreglarla es parte del trabajo.

- `[MEDIUM]` En las pruebas EN VIVO por CDP hay que ESPERAR LA CONDICIÓN, no el reloj. verify_servicio_cierre.mjs esperaba 1500 ms fijos tras abrir el asistente y fallaba 1 de cada 3 veces: la consulta de pantallas compatibles se encola detrás de las que dispara la lista de servicios (hasta 120 llamadas IPC de movimientos) y a veces tardaba más. Un helper waitFor(expr, timeout) que sondea el DOM (por ejemplo, hasta que aparezca la sección o la elección quede marcada) hizo la prueba determinista (17/17 tres veces seguidas). Corolario: una prueba que falla «a veces» no es un producto flojo, es una prueba mal escrita — y arreglarla es parte del trabajo. (1)
  - tools/verify_servicio_cierre.mjs (waitFor + .lucide-check)
  - tools/verify_recordatorios.mjs (slice(0,120) recortaba el chip: fallaba por el recorte, no por el producto)
