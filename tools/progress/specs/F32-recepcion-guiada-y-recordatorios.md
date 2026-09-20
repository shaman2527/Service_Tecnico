# F32 — Recepción guiada por estado + recordatorios de política (fotos y pago) + entregados de hoy

- **Feature:** `feature_list.json` id **32** (priority high) · **MODO DEV** (sin release, sin push)
- **Origen:** pedido directo del usuario (2026-09-16/17):
  *«el cliente quiere que cuando hace un registro ellos poder ver los tlf entregado hoy en servicios»* ·
  *«un mensaje que salga de repente cada vez que vayas a registrar un servicio, no invasivo, colores, recordándole al
  operador recuerda tomarle la foto al tlf»* · *«si va imprimir preguntarle al cliente si va a pagar de una vez o al
  retirar, método de pago»* · *«si es entregado salga un mensaje: ¿le tomaste la foto al entregar? Es política de la
  empresa»* · *«en el wizard que lo lleve de la mano guiándolo qué más tiene que colocar en el proceso por estado
  cuando vaya a registrar un servicio, sea profesional»*.
- **Decisiones del usuario:** los avisos son **informativos** (no se guardan imágenes), **nunca bloquean**
  («avisan y se pueden cerrar») y el asistente debe ser **intuitivo y no agregar fricción** al registrar.
- **Skills aplicadas:** `harness-engineering` (flujo SDD + gates) · `harness-design-standards` (shadcn/Tailwind v4,
  steppers, un solo lenguaje visual) · `shadcn` (componer con lo instalado: `Alert`, `Badge`, `ToggleGroup`,
  `sonner` para avisos y no construir *markup* propio).
- **Estado:** ✅ CERRADA (2026-09-17).

## 1. Diagnóstico (leído y medido en el código, no supuesto)

| Hallazgo | Evidencia |
|---|---|
| «Entregados hoy» es **imposible** hoy: `get_services` filtra solo por `s.date_in` | `src-tauri/src/db.rs:2798-2807`; la UI rotula los inputs «Recibidos desde/hasta» (`Services.tsx:701-708`) |
| La orden nueva **no nace en `Recibido`**: el INSERT no escribe `status` → default de tabla `'Por entregar'` (el flujo del taller arranca en Recibido) | `db.rs` CREATE TABLE `status TEXT DEFAULT 'Por entregar'` + `insert_service_row` (`db.rs:2200`); datos reales en `dev_registro.db`: DEV-0009/0010/0011 = `Por entregar`, `printed=0` |
| `add_service_order` devuelve el **nº base** (`DEV-0001`) → se pueden resolver las filas creadas tras guardar | `db.rs` `add_service_order(...) -> Ok(base)` |
| Ya hay `Toaster` de sonner montado (`richColors`) → no hace falta infraestructura de avisos nueva | `App.tsx:8,14,329` |
| Ya existe una marca de política en la orden (`printed` → badge «Sin imprimir orden») y un banner de color verificado en vivo (`UnpaidBanner`) que sirven de patrón visual | `db.rs:1068-1070`, `Services.tsx:206-241,556-560` |
| `update_service` es un UPDATE de **25 parámetros posicionales** → las señales de política no deben entrar ahí | `db.rs:2287-2288` + lección InvalidColumnType (AGENTS.md) |
| `harness_review` está roto en este checkout (no existe `tools/reviewer/`) → la revisión adversarial se hace con subagentes | `tools/`; historial F30 |

## 2. Alcance

### A. Datos (3 columnas aditivas, idempotentes)

`services` += `photo_in_at TEXT`, `photo_out_at TEXT`, `pay_intent TEXT` (`'ahora'` | `'al_retirar'` | NULL).
Se **apenden al final** de las 4 listas SELECT explícitas y del struct `Service` (regla anti-InvalidColumnType).
`insert_service_row` y `update_service` **no se tocan**: las filas nuevas nacen NULL y editar una orden nunca pisa
las marcas.

### B. Comando angosto `set_service_policy(id, key, value)`

Whitelist fail-closed (`photo_in`, `photo_out`, `pay_intent`); la **hora la estampa el backend** con
`datetime('now','localtime')`; `pay_intent` solo acepta `''`, `'ahora'`, `'al_retirar'`; orden inexistente → error;
**no exige día abierto** (es una anotación, no dinero) y no toca montos, stock ni fechas.

### C. Filtro por fecha de ENTREGA

`get_services(..., date_field)` con whitelist `"out"` → `s.date_out`, resto → `s.date_in`.

### D. Estado inicial de la orden

`ServiceDeviceInput` gana `status` (al final) y el INSERT lo escribe; el wizard elige el estado con
**`Recibido` por defecto** (constante `DEFAULT_NEW_STATUS`, reversible).

### E. Módulos PUROS (una sola implementación de cada regla)

- `src/lib/service-guide.ts` — tabla de reglas **por estado**: bloqueantes / pendientes / siguiente sugerido.
- `src/lib/reminders.ts` — cuándo avisa cada recordatorio; devuelve `[]` si ya está resuelto (**no insiste dos
  veces por lo mismo**) y tope de **2 avisos por acción**.

### F. UI

`PolicyToast.tsx` (tarjeta de color no invasiva por sonner, sin robar foco y sin abrir diálogos sola) ·
`ServiceGuidePanel.tsx` (guía en el wizard con «Ir» al paso y barra X/Y) · `EntregadosHoy.tsx` (KPI + panel de los
teléfonos entregados hoy con foto / impresión / saldo) · chips «Sin foto de entrada/salida» y «Paga al retirar» en
las tarjetas de la lista.

### G. Ganchos

Botón «Entregar», asistente «Cerrar» y comprobante (impresión). Línea `ACORDADO: PAGA AHORA / AL RETIRAR` **solo en
el talón** (el recibo principal conserva el invariante «METODO solo con pagos REALES»).

## 3. Invariantes (lo que NO puede cambiar)

| Regla | Por qué |
|---|---|
| La moneda se deriva del MÉTODO (`payment-math`) y el backend sigue siendo la autoridad de dinero | regla de negocio ya verificada |
| El recibo PRINCIPAL no cambia (ni `METODO` sin pagos reales ni el bloque financiero) | es el documento que firma el cliente |
| Los recordatorios **no bloquean** ninguna acción | decisión explícita del usuario («no invasivo») |
| Ninguna marca de política altera montos, abonos, stock, fechas ni cierres | el taller ya está en producción |
| `update_service` e `insert_service_row` conservan sus columnas y su orden | lección InvalidColumnType |
| Cero imágenes guardadas | alcance acordado con el usuario |

## 4. Criterios de aceptación

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-1 | En Servicios hay KPI/botón «Entregados hoy (N)» y un panel que lista esas órdenes (orden, hora de salida, cliente, modelo, método/acuerdo, foto de salida, impresión, saldo) | EN VIVO por CDP |
| AC-2 | El filtro de fechas puede filtrar por recibido **o** por entregado (rótulos honestos) | EN VIVO + `cargo test` del comando |
| AC-3 | Al abrir/guardar una recepción aparecen los avisos de color (foto de ENTRADA + preguntar pago) con acciones; **nada se bloquea** | EN VIVO + `tools/reminders_test.ts` |
| AC-4 | Al imprimir aparece el aviso de foto de SALIDA (cuando corresponde) y el de preguntar el pago si no se preguntó | EN VIVO |
| AC-5 | Al entregar (botón y asistente) aparece el aviso de foto de salida y se confirma en un toque (`photo_out_at` queda escrito) | EN VIVO + lectura por IPC |
| AC-6 | El wizard muestra la guía por estado (✓ / pendientes / bloqueantes), el estado elegido al crear (default `Recibido`) y lleva al paso del dato que falta | EN VIVO + `tools/service_guide_test.ts` |
| AC-7 | Un aviso ya resuelto **no vuelve a aparecer** | `tools/reminders_test.ts` |
| AC-8 | `cargo test` verde · `npm run build` ✓ · `npx oxlint` 0 errores · pruebas puras nuevas verdes · scripts CDP previos sin regresión | scripts |
| AC-9 | El recibo principal no cambió y el talón sigue ≤ 32/48 chars | `node tools/receipt_acuerdo_test.ts` (30/30) |
| AC-10 | Crear una orden ya «Entregado»/«Devuelto» se rechaza (backend + UI) | `cargo test` (`test_new_order_status_from_wizard`) + `verify_recordatorios.mjs` (IPC) |

## 5. Fuera de alcance

- Guardar/adjuntar fotos (cámara, archivos, respaldo, tamaño de la base).
- Avisos al cliente por WhatsApp/SMS.
- Release/push (MODO DEV) y los pendientes ya anotados (F32 `close_service_delivery`, F33 vuelto/contador).

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Mapeo posicional roto (InvalidColumnType) | apendado **al final**, mismo orden en las 4 listas y en el struct; test que lee las 3 columnas |
| Fatiga de avisos (el operario los ignora) | tope de 2, auto-cierre, y **cero repetición** de lo ya confirmado |
| Cambio de comportamiento (estado inicial) | constante única `DEFAULT_NEW_STATUS` + documentado en Help/AGENTS |
| `Option<T>` de Tauri al omitir `date_field` | se prueba con y sin el argumento; si falla, pasa a obligatorio (los 4 llamadores se actualizan) |
| Escribir en la base real con los scripts de verificación | el script nuevo **aborta si no hay día abierto** (no lo abre) y borra sus datos de prueba |

## 7. Resultado de la implementación y evidencia

**Lo que quedó en el repo**

| Pieza | Archivo |
|---|---|
| Migración (3 columnas) + struct + 4 SELECTs + `es_estado_de_taller` + `set_service_policy` + `date_field` + `ServiceDeviceInput.status` | `src-tauri/src/db.rs`, `commands.rs`, `lib.rs` |
| Reglas puras de la guía por estado | `src/lib/service-guide.ts` (+ `tools/service_guide_test.ts`) |
| Reglas puras de los recordatorios | `src/lib/reminders.ts` (+ `tools/reminders_test.ts`) |
| Tarjeta de aviso + acciones que anotan | `src/components/PolicyToast.tsx`, `policy-actions.ts` |
| Guía en el wizard (compacta, con «Ir») | `src/components/ServiceGuidePanel.tsx` |
| Panel «Teléfonos entregados hoy» | `src/components/EntregadosHoy.tsx` |
| Wizard (fotos/pago/estado) + lista (KPI, filtro, chips) + entrega | `src/components/Services.tsx` |
| Recordatorio al entregar / al imprimir | `src/components/CierreServiceDialog.tsx`, `PrintReceiptDialog.tsx` |
| Línea `ACORDADO` del talón | `src/lib/utils.ts` (+ `tools/receipt_acuerdo_test.ts`) |
| Verificación EN VIVO | `tools/verify_recordatorios.mjs` (46/46) |
| Documentación | `src/components/Help.tsx`, `AGENTS.md` |

**Gates**

| Gate | Resultado |
|---|---|
| `cd src-tauri && cargo test --lib` | **124 passed / 0 failed / 6 ignored** (incluye los 4 tests de F32) |
| `npx tsc -b` | 0 errores |
| `npx oxlint` | 0 errores (91 warnings preexistentes) |
| `npm run build` | OK |
| `node tools/service_guide_test.ts` | **73/73** |
| `node tools/reminders_test.ts` | **38/38** |
| `node tools/receipt_acuerdo_test.ts` | **30/30** |
| `tools/verify_recordatorios.mjs` (CDP, en vivo) | **48/48** |
| Regresión: `verify_servicio_cierre` · `verify_cola_entregas` · `verify_metodos_en_cobros` · `verify_wizard_metodos` | 17/17 · 13/13 · 15/15 · 18/18 |
| `harness_security` / `harness_truth` | PASS / PASS |

**Revisión adversarial (2 subagentes, porque `harness_review` no existe en este checkout) y arreglos aplicados**

| # | Hallazgo | Estado |
|---|---|---|
| 1 | **BLOQUEANTE:** crear la orden ya en «Entregado» (el wizard lo ofrecía) la dejaba **sin `date_out`, sin descuento de stock, sin garantía, fuera de «Entregados hoy» y fuera del libro del día** — `insert_service_row` no escribe la fecha ni llama a `apply_service_stock` | ✅ **ARREGLADO**: al crear solo se ofrecen estados de TALLER (`isCreatableStatus`) y el **backend lo rechaza** (`es_estado_de_taller`); entregar se hace cambiando el estado, con el asistente «Cerrar» |
| 2 | **MAYOR:** la guía mostraba la foto de SALIDA como pendiente aunque ya estuviera tomada (le pasaba el centinela `'si'` a una regla que compara fechas) | ✅ **ARREGLADO**: se pasa el valor real + `photoOutJustConfirmed`; en estados finales cuenta por presencia |
| 3 | **MAYOR:** avisos DUPLICADOS al entregar con «Imprimir la orden al cerrar» (entrega + comprobante sobre la misma orden) | ✅ **ARREGLADO**: `id` estable de sonner (`policy-<clave>-<orden>`) |
| 4 | El chip «Sin foto de salida» usaba `!photo_out_at` (no detectaba la foto vieja de otra entrega) | ✅ `photoOutIsCurrent` |
| 5 | El «Monto a cobrar» de la guía era bloqueante y `save()` no lo exigía (Ctrl+Enter lo salteaba) | ✅ la guía lo muestra como **AVISO** (no bloquea) y `amountOk` marca el lado que el pie del paso también exige (monto por equipo) |
| 5b | **REGRESIÓN introducida por el arreglo anterior**: exigir el monto en `save()`/`disabled` dejaba **sin poder guardar** una orden de $0 (garantía/cortesía) — y hay órdenes reales así (DEV-0006) | ✅ **REVERTIDO**: el monto NO bloquea el guardado; el paso del wizard sigue pidiéndolo y la guía lo explica con un aviso |
| 6 | Se preguntaba el pago en órdenes YA COBRADAS al imprimir | ✅ `printReminders` exige saldo pendiente |
| 7 | «¿Va a **cancelar**…?» contra el vocabulario del local («Cancelado» = pagado) | ✅ «¿Va a **pagar**…?» (+ método), y «política de la empresa» en todos los textos |
| 8 | El panel mostraba el método del FORMULARIO como si se hubiera cobrado así | ✅ muestra el acuerdo o «Sin pago» |
| 9 | «Hora de salida» en el panel: `date_out` no tiene hora → salía `--:--` siempre | ✅ muestra la fecha de entrega |
| 10 | Confirmación falsa («Foto anotada») si no había filas donde escribir | ✅ no se dispara el aviso sin órdenes |
| 11 | Los «Ir» de la guía apuntaban a pasos equivocados (foto de salida al paso 2, monto al 3) y ofrecían «Ir» para lo que no vive en el wizard (imprimir) | ✅ pasos corregidos + `step: -1` sin botón |
| 12 | El aviso podía interceptar clics (tapa botones del pie del diálogo) | ✅ `pointer-events-none` + `auto` en los botones (verificado en vivo) |
| 13 | La guía ocupaba la pantalla (9 ítems fijos) y dejaba al wizard sin espacio | ✅ compacta (máx. 4 pendientes + «Ver todo») |
| 14 | El aviso le robaba el foco al primer campo (rompía «el foco arranca en Cliente») | ✅ sale 700 ms después y devuelve el foco |
| 15 | El blindaje figuraba ✓ desde que se abría el formulario (los 2 defaults de `checklistDefaults`) | ✅ se cuentan los ítems respondidos **más allá** de los defaults |
| 16 | Menores de copy, contraste (2:1 del ámbar), `aria-label` en los «Ir», doble región `aria-live`, código muerto (`GuidePendingBadge`, `statusLabel`) y doc desactualizada | ✅ todos aplicados |
| 17 | 2ª vuelta: el «Ir» del cobro apuntaba al paso 3 (el botón «Registrar Pago / Abono» vive en el 4) y en crear no hay control de cobro | ✅ `paid` → paso 4 en edición y `-1` (sin «Ir») al crear |
| 18 | 2ª vuelta: con más de 120 filas el `paymentsMap` se vaciaba y el panel decía «Sin pago» de órdenes cobradas | ✅ los entregados de hoy se piden siempre (son pocos) aparte del tope de la lista |
