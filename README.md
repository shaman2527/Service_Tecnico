# Registro - Sistema de Servicio Técnico

Aplicación desktop **offline-first** para gestión de un servicio técnico de celulares:
inventario de pantallas y repuestos, ventas, órdenes de reparación, clientes con
historial, abonos/pagos parciales, pedidos a proveedores, **libro diario con tasa BCV**
y **factura en impresora térmica** (ESC/POS).

> 📄 Documento completo de producto (PRD): [PRD.md](PRD.md) — reglas de negocio,
> diagramas de flujo, modelo de datos y QA.
> 📋 Estado del proyecto (hecho + pendientes): [ESTADO.md](ESTADO.md)

## Repositorio

- **URL:** https://github.com/shaman2527/Service_Tecnico.git
- **Rama principal:** `main`

```bash
git clone https://github.com/shaman2527/Service_Tecnico.git
```

> **Nota:** la base de datos (`registro.db`), el binario (`Registro.exe`) y las planillas
> de datos están excluidos del repo (`.gitignore`) - son datos de negocio locales.

## Stack

- **Frontend:** React 19 + TypeScript + Vite + shadcn/ui + Tailwind CSS v4 + Lucide icons
- **Backend:** Tauri 2.0 (Rust) + rusqlite (SQLite)
- **DB:** SQLite local (offline-first) - respaldo = copiar `registro.db`
- **Impresora:** ESC/POS por puerto COM (CP850) - 58/80mm

## Funcionalidades

- **Ventas:** registro con descuento automático de stock, chips de compatibilidad y
  stock visible (rojo si agotado), métodos de pago (Punto $/Bs con comisión, Zelle con
  referencia, Divisas USD, Efectivo Bs, Pago Móvil, Transferencia Bs) y **conversión
  automática a bolívares** con la tasa BCV del día abierto. Filtros por periodo y fecha,
  búsqueda por producto/cliente/cédula.
- **Servicio Técnico:** órdenes de reparación con workflow (Recibido → … → Entregado),
  **multi-trabajo por orden** (pantalla + conector + …), checklist de blindaje 10 ítems
  Sí/No, cédula y dirección del cliente, **técnico responsable** (Aldri/William),
  garantía de 7 días desde la entrega.
- **Auto-Inventario:** al entregar un servicio se descuenta 1 de la pantalla compatible
  (auto-crea el producto si no existe; devuelve stock al reabrir o borrar).
- **Abonos y pagos parciales:** por orden con Total/Abonado/Saldo, historial de pagos con
  método/referencia/notas; moneda **siempre derivada del método**; abonos Bs convertidos
  con la tasa del día del pago; se permite entregar con saldo pendiente (deuda visible).
- **Clientes:** auto-creación sin duplicados, búsqueda tolerante de cédula, historial
  completo con pagos desglosados y saldos.
- **Libro Diario (turno de caja):** un solo día abierto a la vez; apertura con efectivo
  inicial y **tasa BCV congelada** (botón Auto BCV scrapea la página oficial con curl.exe,
  fallback manual); cierre con **arqueo real por método** y diferencia calculada;
  liquidación de Punto, reapertura y **exportación CSV** por rango.
- **Pedidos a proveedor:** sugerencias de reposición, recibir pedido → **suma stock**.
- **Impresora térmica:** `list_com_ports` + `print_receipt` (ESC/POS, CP850), settings
  persistidas (puerto/baudios/58-80mm), preview de factura antes de imprimir, botones
  "Impresora" y "Factura" en cada orden y en el dialog de pago.
- **PIN de acceso:** owner/cajera con gate **fail-closed** (nunca abre sin PIN).
- **Actualizaciones automáticas:** al arrancar revisa GitHub Releases (5s, sin molestar offline); aviso con changelog → **respaldo automático** (exe anterior + copia de la DB) → instalación pasiva → **chequeo de salud** (DB, órdenes, libro diario, BCV) → si falla, **vuelve sola a la versión anterior** (watchdog + rollback). Botón "Restaurar versión anterior" en Ayuda.
- **Dashboard:** KPIs (ventas hoy/7 días, equipos en taller, ingresos), diagrama de flujo
  del workflow, top modelos, stock bajo, indicador "Sincronizado".
- **Pantallas / Inventario:** catálogo con compatibilidad en chips, movimientos de stock.
- **Centro de Ayuda:** guía completa en-app.
- **Sidebar colapsable:** `w-64` ↔ `w-16`, persistido en localStorage.

## Diagramas de flujo

### Ciclo del día (Libro Diario)

```mermaid
flowchart TD
  A[Abrir día: apertura USD + tasa BCV congelada] --> B[Registrar ventas / servicios / abonos / pedidos]
  B --> C[Cerrar día: arqueo real por método]
  C --> D{Diferencia actual - esperado}
  D -->|≈ 0| E[Cuadrado ✓ - cierre guardado]
  D -->|≠ 0| F[Revisar arqueo / Liquidar Punto]
  F --> C
  E --> G[Reabrir si hay que corregir]
  B -->|Sin día abierto| H[Backend bloquea registro]
```

### Venta y conversión de moneda

```mermaid
flowchart TD
  S[Nueva Venta] --> D{Día abierto?}
  D -->|No| BLK[Bloqueado: abrir día en Libro Diario]
  D -->|Sí| PR[Producto + sugerencias con compatibilidad/stock]
  PR --> M{Método en Bs?}
  M -->|No| US[Total USD = cant x precio]
  M -->|Sí + tasa > 0| BS[Total Bs = cant x precio x tasa BCV del día]
  M -->|Sí + tasa = 0| BSB[Bloqueado: requiere tasa BCV]
  US --> SV[Guardar venta + stock -1 + movimiento]
  BS --> SV
  SV --> LD[Libro Diario: agrupa por método]
  LD --> G[grand_total = grand_usd + grand_bs / tasa del día]
```

### Workflow de la orden de servicio

```mermaid
flowchart LR
  R[Recibido] --> TR[En reparación]
  TR --> ER[Esperando repuesto]
  ER --> TR
  TR --> RP[Reparado / Pendiente Pago]
  RP --> PE[Por entregar]
  PE --> EN[Entregado]
  R --> CA[Cancelado]
  EN --> DE[Devuelto]
  PE -->|Con saldo| AL[Alerta: entregar con saldo pendiente]
  AL --> EN
  EN --> SK[Stock pantalla -1]
  EN --> GA[Garantía 7 días desde date_out]
```

### Abono / pago parcial

```mermaid
flowchart TD
  P[Pago / Abono] --> M{Método}
  M -->|Bs| C[currency=VES · paid_amount += monto / tasa del día del pago]
  M -->|USD| U[currency=USD · paid_amount += monto]
  C --> R[recalc_paid_amount en servicios]
  U --> R
  R --> S{Saldo = amount - paid_amount}
  S -->|> 0.005| PD[Pendiente - entregable con saldo]
  S -->|≈ 0| CZ[Cancelado]
  S -->|< -0.005| EX[Excedente]
```

### Impresión de factura

```mermaid
flowchart LR
  F[Card orden / dialog de pago] --> B[Factura]
  B --> PR[buildServiceReceipt - texto 32/48 chars]
  PR --> PV[Preview en pantalla]
  PV --> SE{Settings OK?}
  SE -->|No| CF[Configurar: detectar puerto COM, baudios, 58/80mm]
  CF --> PV
  SE -->|Sí| IM[print_receipt: ESC/POS + CP850 + corte]
```

## Cómo funcionan las conversiones (resumen)

1. **La moneda siempre la define el método de pago** (Bs: Pago Móvil, Efectivo Bs,
   Transferencia Bs, Punto Bs · USD: Divisas, Zelle, Punto $).
2. **Venta en Bs:** `total Bs = $ × tasa BCV del día abierto` (se guarda en Bs).
3. **Libro Diario:** separa `grand_usd` y `grand_bs` por método; el equivalente es
   `grand_usd + grand_bs / tasa` — usando la **tasa de cada día** (cierre del día →
   día abierto → último cierre), nunca se mezclan monedas crudas.
4. **Abonos:** `paid_amount` (USD) = pagos $ + pagos Bs / tasa del día del pago.
5. **Cierre:** la apertura no es venta; el arqueo compara `actual − esperado` por
   método y la diferencia combina `diff_usd + diff_bs/tasa`.

> Verificado E2E (QA 2026-08-04): venta $25 + venta Bs 7.487,90 + abonos $20 y
> Bs 22.463,70 → `grand_total = $85.00` exacto (45 + 29.951,60/748.79) y cierre
> con diferencia 0. Detalle en [PRD.md](PRD.md) §9.

## Estructura

```
registro/
├── src/                       # Frontend React
│   ├── App.tsx                # Layout + navegación + gate PIN (fail-closed)
│   ├── db.ts                  # Bridge Tauri invoke + mock browser mode
│   ├── types.ts               # Tipos compartidos
│   ├── lib/                   # reglas PURAS (sin React), con pruebas node en tools/*_test.ts
│   │   ├── utils.ts           # moneda, métodos, fechas locales, recibo (buildServiceReceiptParts)
│   │   ├── cash-closing.ts    # F39: diferencias del arqueo y del Punto (por moneda)
│   │   ├── order-balance.ts   # F38: saldo en la moneda del cobro
│   │   ├── refund-math.ts     # F36/F42: topes por moneda y MÉTODO de la devolución
│   │   ├── payment-math.ts / payment-methods.ts / queue.ts / service-update.ts / phoneOrder.ts
│   │   ├── service-report.ts  # F44: trabajos hechos (contadores por trabajo, alcance de la lista)
│   │   ├── product-categories.ts # F65: categorías de producto (plegado, problemas, bloqueo de borrado)
│   │   └── ficha.ts / reminders.ts / service-guide.ts / screen-rules.ts / update.ts
│   ├── components/
│   │   ├── Dashboard.tsx      # KPIs, diagrama de flujo, top modelos, stock bajo
│   │   ├── Sales.tsx          # Ventas: conversión Bs, filtros, stats
│   │   ├── Services.tsx       # Órdenes + abonos + devoluciones + checklist + técnicos + imprimir
│   │   │                      #   F44: abre en «Todos los estados», contadores de trabajos y alcance
│   │   ├── RefundDialog.tsx   # Devolución: vuelve POR DONDE ENTRÓ la plata (F42)
│   │   ├── PaymentDialog.tsx  # Pago/Abono reutilizable + imprimir factura
│   │   ├── PrintReceiptDialog.tsx / PrinterSettingsDialog.tsx
│   │   ├── Inventory.tsx      # MÓDULO ÚNICO: Productos | Modelos | Repuesto por modelo | Movimientos | Ajustes
│   │   ├── inventory/         # ProductsTab, ModelsTab, ByModelTab, MovementsTab, PricesTab, StockBadge, CompatChips
│   │   ├── ModelCombobox.tsx  # Selector de modelo (lista canónica del padrón)
│   │   ├── Clients.tsx        # Clientes con historial y saldos
│   │   ├── DailyLedger.tsx    # Libro Diario: turno, tasa BCV, arqueo por moneda, devoluciones, export
│   │   ├── Pedidos.tsx        # Pedidos a proveedor + reposición
│   │   ├── Help.tsx           # Centro de Ayuda
│   │   ├── ProductForm.tsx    # Form compartido producto
│   │   └── ui/                # 23 componentes shadcn
│   └── index.css              # Tailwind v4 + CSS variables
├── src-tauri/                 # Backend Rust
│   ├── src/
│   │   ├── main.rs            # Entrypoint (windows_subsystem)
│   │   ├── lib.rs             # Tauri builder + 115 comandos
│   │   ├── db.rs              # SQLite CRUD + turno + abonos/devoluciones + auto-inventario + arqueo
│   │   ├── cache.rs           # F41: memoria corta del catálogo (Inventario rápido)
│   │   ├── catalog.rs         # Reglas canónicas marca/modelo/compat + normalizar + precios
│   │   ├── updates.rs         # Updater: respaldo, rollback, health-check, watchdog
│   │   ├── printer.rs         # ESC/POS: list_com_ports, cp850, print_receipt
│   │   ├── bcv.rs             # Scraping tasa BCV con curl.exe (sin deps HTTP)
│   │   └── commands.rs        # Comandos Tauri
│   └── tauri.conf.json        # NSIS + resources registro.db + WebView2 embebido + updater
├── run.ps1                    # Script de ejecución
├── tools/                     # Scripts del proyecto + copia embebida del harness
│   ├── verify_*.mjs           # verificaciones EN VIVO por CDP (ver «Verificación en vivo»)
│   ├── *_test.ts              # pruebas de las reglas PURAS (moneda, arqueo, devoluciones, ficha…)
│   ├── bench_inventory_ui.mjs # F41: mide en vivo lo que tarda cada pestaña en mostrar datos
│   ├── audit_inventory.mjs / snapshot_db.mjs / seed_dev_db.mjs / canonical_brands.json
│   │                          # F55: el split de modelos se espeja acá y su paridad con Rust
│   │                          #   se fija con split_fixtures.json (--gen-split-fixtures)
│   ├── release.ps1            # Publicar versión: bump + build firmado + latest.json + gh release
│   └── progress/              # history.md (append-only) · specs/ (una spec por feature) · patterns.md
├── instaladores/              # Setup + guía para copiar a pendrive
├── PRD.md                     # Documento de producto (reglas, flujos, QA)
├── ESTADO.md                  # Estado del proyecto: hecho / pendiente / por feature
├── AGENTS.md                  # HARNESS: arquitectura, decisiones, Entropy Registry, F41/F42
└── README.md
```

## Ejecución

| Modo | Comando | Descripción |
|------|---------|-------------|
| Browser (dev) | `npm run dev` | Vite en localhost:5173. Sin backend Tauri. db.ts retorna mocks. |
| Ventana nativa (dev) | `.\run.ps1 -Dev` | Tauri dev + Vite. Backend real con SQLite. |
| Producción | `.\run.ps1 -Build` | Build release + copia a Registro.exe |
| Ejecutar release | `.\Registro.exe` o `.\run.ps1` | App standalone sin servidor |
| Instalador | `npx tauri build` | Setup NSIS con la plantilla sana (`backup/plantilla_candidata.db`) + WebView2 embebido (~4.7MB) |

### Instalación en la tienda

1. Copiar la carpeta `instaladores\` (setup + guía) a un pendrive.
2. Ejecutar `Registro Servicio Tecnico_0.4.0_x64-setup.exe` (SmartScreen → "Más información → Ejecutar de todos modos"). **WebView2 embebido**: no necesita drivers ni internet.
3. Instala en `%LOCALAPPDATA%\Registro Servicio Tecnico\` con `registro.db` junto al exe
   (el catálogo inicial viaja como plantilla `registro.default.db` y solo se copia en el primer arranque — reinstalar/actualizar **nunca** toca la DB existente, verificado).
4. PIN inicial `1234` → cambiarlo en Libro Diario → PIN.
5. Abrir el día (efectivo inicial + Auto BCV) y configurar la impresora (Servicio Técnico → Impresora → Detectar).

### Publicar una actualización

```powershell
gh auth login                                    # una sola vez
node tools/make_release_template.mjs --force     # plantilla sana desde la base real (NO toca registro.db)
node tools/release_gate.mjs --db backup/plantilla_candidata.db   # 0 bloqueantes o no se publica
node tools/verify_migracion_datos.mjs            # la migración NO toca la historia del local
.\tools\release.ps1 -Version 0.4.0 -Notes "Fix X, mejora Y"
```

El script corre tests, **vuelve a correr el gate de la plantilla**, sube la versión, hace el
build firmado, genera `latest.json` con la firma y crea la GitHub Release. La app de la tienda
avisa sola al arrancar (con respaldo automático y rollback si fallara algo).

**Lo que viaja dentro del instalador:** `backup/plantilla_candidata.db`, **nunca** `registro.db`
(la base de trabajo del taller tiene órdenes, abonos y clientes reales, y el repo es público).
El generador vacía las tablas transaccionales, resetea el PIN al inicial documentado y limpia la
configuración de la máquina; `tools/release_gate.mjs` es el que impide publicar una plantilla sucia,
sin precios o con stock negativo. Las excepciones que el dueño acepte se declaran **con motivo,
fecha y topes** en `tools/release_excepciones.json` (si la situación empeora, el gate vuelve a bloquear).

**Antes de publicar, la prueba que exige el dueño** («que la actualización no dañe la base ni las
ventas registradas»):

```powershell
node tools/verify_migracion_datos.mjs --db registro.db                       # 15/15, la base real
node tools/verify_migracion_datos.mjs --db backup/registro_backup_20260804_000039.db   # base vieja con ventas
```

Toma una **copia** (VACUUM INTO, la original no se escribe), corre la migración REAL de la app
(`Database::new` → `init()` sobre la copia) y compara la historia **columna por columna** antes y
después: ventas, servicios, abonos, clientes, gastos, el arqueo de cada cierre y el stock/precio de
cada ficha por id. Los nombres propios solo pueden cambiar si el valor nuevo es **exactamente** su
Title Case (migración documentada de 2026-08-07) y las columnas resumen (saldo abonado, esperado del
cierre) se informan una por una — nunca se dan por buenas en silencio.

## Verificación en vivo (CDP)

La app desktop usa WebView2 — se puede inspeccionar igual que Chrome:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
.\Registro.exe
# luego: http://localhost:9222/json → websocket del page → Runtime.evaluate
```

Ejemplo de chequeo del backend real (dentro de la app):

```js
await window.__TAURI_INTERNALS__.invoke('get_products', { search: '', categoryId: null })
```

> **Importante:** en Tauri 2 el global es `__TAURI_INTERNALS__` — `window.__TAURI__`
> NO existe (ver Entropy Registry en AGENTS.md, entrada 2026-08-01).

### Verificaciones del proyecto (con la app abierta)

| Script | Qué comprueba | Notas |
|---|---|---|
| `node tools/bench_inventory_ui.mjs` | **F41** — ms hasta VER LOS DATOS en cada pestaña del Inventario (medianas, en frío) | Mide, no afirma. Pide `REGISTRO_DB` a una **copia** |
| `node tools/verify_inventario_rapido.mjs` | **F41** — que la memoria del catálogo no muestre números viejos: compara la pantalla contra la **base leída aparte** con `node:sqlite` | Escribe una ficha de prueba y la borra; **aborta si falta `REGISTRO_DB`** |
| `node tools/verify_devolucion_metodo.mjs` | **F42** — la devolución vuelve por donde entró: el backend rechaza el método que no cobró y el diálogo propone el real | Crea un pedido de prueba y lo borra |
| `node tools/verify_trabajos_hechos.mjs` | **F44** — los contadores de trabajos cuentan lo que se ve (entregados incluidos): el chip == las tarjetas al hacerle clic == el KPI, el trabajo escrito a mano tiene chip y el alcance se dice en pantalla | Escribe 3 órdenes de prueba ($0) y las borra; **aborta si falta `REGISTRO_DB`** o el día abierto; comprueba que el stock vuelva |
| `node tools/verify_tecnico_sin_asignar.mjs` | **F45/F46/F48** — el wizard crea una orden **sin técnico** y **con color** (obligatorio), la ficha pide el color y lleva el foco al selector, la observación del teléfono no bloquea, el **modal de política** aparece al guardar y se pospone, y la **señal ámbar** aparece/desaparece al asignar | Crea la orden por la UI y la borra; **aborta si falta `REGISTRO_DB`** o el día abierto |
| `node tools/verify_pantalla_agotada.mjs` | **F47/F48** — pantalla **agotada**: aviso en rojo con el texto del inventario, confirmación marcada por defecto, «Actualizar Servicio» habilitado con el estado Entregado, y sin color el paso no avanza | **No guarda nada** (el stock no se mueve, verificado contra la base); **aborta si falta `REGISTRO_DB`** |
| `node tools/verify_descuento.mjs` | **F49** — la tarjeta con «Descuento» (y sin «Cerrar»), el diálogo que aplica el descuento desde el precio de lista, y **la factura con PRECIO / DESCUENTO / TOTAL** | Crea una orden de $30, le aplica y le quita el descuento, comprueba por IPC y **borra** la orden; **aborta si falta `REGISTRO_DB`** |
| `node tools/verify_models_tab.mjs` | Pestaña Modelos: KPIs, filtros, orden de 3 estados, ficha por categoría | `EXPECT_PHONES`/`EXPECT_REVIEW` son la expectativa independiente |
| `node tools/verify_orden_columnas.mjs` | **F51** — orden por columnas en Inventario → Productos: cada encabezado reordena de verdad, con ciclo asc→desc→sin orden y `aria-sort` | **Solo lectura**: compara el orden de la pantalla contra el **mismo orden calculado sobre la base** (`node:sqlite`) |
| `node tools/verify_uso_modelos.mjs` | **F50** — «lo que uso»: el check por producto y por modelo cambia SOLO `in_use` (stock/precio/compat intactos, contra la base), el código `P-…`/`M-…` se ve y se busca (con guion y sin guion), los filtros «Solo lo que uso» / «Lo que NO uso», y el formulario de servicio ofrece solo lo marcado (con «Ver todos» y el aviso «sin usar») | Escribe SOLO los checks y los **restaura**; **aborta si falta `REGISTRO_DB`**; compara siempre contra la base leída aparte |
| `node tools/verify_aviso_no_tapa.mjs` | **F54** — el aviso de política **no tapa la factura** ni se traga los clics: con el comprobante abierto no se dibuja (queda en la cola), el clic sobre la factura cae dentro de la factura, al cerrarla el aviso vuelve y **tocar el mensaje lo quita** (y la ✕ también) | Entrega UNA orden de prueba por la UI **sin cobrar** y la borra; **aborta si falta `REGISTRO_DB`** |
| `node tools/verify_screen_brand_gate.mjs` | Gate de marca de la pantalla en el servicio (OTRA marca nunca se auto-elige) | Solo lectura |
| `node tools/verify_tecnico_y_fecha_pago.mjs` | F34/F35/F36/F38/F39: técnico rápido, fecha del pago, saldo en Bs. y las dos columnas del arqueo | Aborta si no hay turno abierto |
| `node tools/verify_categorias_producto.mjs` | **F65** — las categorías de producto dejan de ser una lista cerrada: se crea una desde el formulario del producto (y queda elegida y **guardada en la base**), el filtro de Productos la ve al instante, un nombre que ya existe **no** crea una gemela (avisa y ofrece usarla), **Escape cierra el panel y no el formulario**, en Ajustes se ve el uso real, se **corrige** el nombre y se **elimina** la vacía — y las del padrón de teléfonos o con productos **no se pueden borrar** | Escribe en la tabla `categories` y limpia; **aborta si falta `REGISTRO_DB`**; compara siempre contra la base leída aparte |
| `node tools/verify_recordatorios.mjs` · `verify_servicio_cierre.mjs` · `verify_cola_entregas.mjs` · `verify_metodos_en_cobros.mjs` · `verify_wizard_metodos.mjs` | F30–F33: recordatorios, asistente de cierre, cola de entregas, métodos de pago | Escriben y limpian sus órdenes de prueba |

**Receta:** abrir la app con la copia (`$env:REGISTRO_DB="…\backup\perf_app.db"` + el puerto 9222), pasar el PIN, correr el script. Los scripts **esperan condiciones** (nunca duermen a ojo) y varios **abortan** si falta el día abierto o la variable de la copia.

## Pruebas

```bash
cd src-tauri && cargo test --release --lib     # 133/133 (+7 manuales ignorados)
npm run build                                  # TypeScript + Vite
npx tsc -b && npx oxlint src                   # 0 errores

# reglas PURAS (node, sin app abierta):
node tools/pos_cuadre_test.ts        # arqueo por moneda (F39)            66/66
node tools/refund_math_test.ts       # topes y MÉTODO de la devolución    45/45
node tools/payment_math_test.ts      # cuentas de los cobros             595/595
node tools/receipt_acuerdo_test.ts   # recibo (montos, descuento, anchos)   74/74
node tools/ficha_test.ts             # ficha de ingreso (F33/F48)           75/75
node tools/reminders_test.ts         # recordatorios (F32)                 38/38
node tools/service_guide_test.ts · queue_test.ts (npx tsx) · local_date_test.ts (npx tsx) · method_picker_test.ts (npx tsx)
node tools/service_report_test.ts    # trabajos hechos / contadores (F44)   68/68
node tools/policy_queue_test.ts      # cola del modal de política (F46)     13/13
node tools/discount_test.ts          # descuento del servicio (F49)         21/21
node tools/category_rules_test.ts    # categorías de producto (F65)         42/42
```

## Lecciones clave (resumen)

1. **Feature `custom-protocol` obligatoria** en Cargo.toml para que el frontend se
   embeba en el exe release. Sin ella, la app busca el dev server (ventana en blanco).
2. **Detección Tauri 2**: usar `window.__TAURI_INTERNALS__`, no `window.__TAURI__`.
3. **El build puede pasar y la app estar rota**: verificar en vivo (CDP) que la UI
   muestra filas reales y que los guardados persisten en el `.db`.
4. **La DB junto al exe** puede quedar vieja si el Copy-Item del deploy falla
   silenciosamente — verificar LastWriteTime y conteos.
5. **NO usar reqwest** en Cargo.toml (compilación eterna): el scraping BCV usa
   `curl.exe` (incluido en Windows 10+) vía `std::process::Command`.
6. **shadcn CLI roto** en este Windows (EPERM con "Configuración local"): instalar
   primitivos radix con npm y crear componentes a mano.
7. **Deadlocks de Mutex**: no llamar métodos que re-toman `self.conn.lock()` desde
   dentro de otro método que ya lo tiene (ej: `close_day` → `get_daily_totals`).
8. **`.optional()` no captura NULL de agregados** (`MAX` sobre tabla vacía devuelve
   NULL en una fila): usar `COALESCE(...,0)` (fix `next_order_num`, 2026-08-04).
9. **Gate de PIN fail-closed**: el primer invoke en arranque en frío puede fallar;
   el bridge debe reintentar y rechazar, nunca resolver como "sin PIN" (2026-08-04).
10. **PLATA — la devolución vuelve POR DONDE ENTRÓ (F42, 2026-09-17).** El método del
    FORMULARIO de una orden es *sólo lo que se esperaba cobrar*: proponerlo como método de
    una devolución metió la salida en un bucket que nunca cobró (Punto en **−Bs. 1.697**) y
    la plata que salió del cajón no aparecía en ninguna pantalla del arqueo. El método sale
    de los **movimientos**, el gate está también en el backend (fail-closed) y los métodos
    de cajón pueden pagar la devolución, con aviso.
11. **Un esperado ≠ 0 NUNCA se esconde (F42).** Las columnas/filas del Libro y del cierre se
    dibujaban con `> 0`: una devolución que deja un método en 0 o negativo **desaparecía**.
    La condición es `|x| > tolerancia`, y el día muestra aparte cuánto se **devuelto**.
12. **Medir antes de optimizar (F41).** En release y sobre una copia: el «problema» del
    Inventario no era la tabla (2-5 ms) sino cuatro cálculos derivados del catálogo repetidos
    en cada pestaña (118 + 140 + 113 + 240 ms) y un rebote de 200 ms en TODA consulta. El
    bench queda en `tools/bench_inventory_ui.mjs`.

Detalles y registro completo de problemas en [AGENTS.md](AGENTS.md).

#### F45–F48 (2026-09-20) — alta guiada y avisos que no bloquean
- **F45 — Técnico «Sin asignar» por defecto:** al crear una orden no se prellena ningún técnico (se quitó el `last_technician` de localStorage) y la orden se guarda sin él; la tarjeta en taller muestra el chip ámbar **«Falta asignar técnico»** (`data-needs-tech`) que abre el selector rápido. Regla pura `needsTechnician` (`lib/service-guide.ts`).
- **F46 — Recordatorio de política como MODAL CENTRADO** (`PolicyModal.tsx` + `policy-queue.ts`, reemplaza `PolicyToast.tsx`): velo suave, tarjeta con tinte por tono, acciones a un toque y **«Después»**; bloquea la pantalla, nunca los datos; dedupe por aviso+orden; Escape solo si no hay otro diálogo encima. Test puro `tools/policy_queue_test.ts`.
- **F47 — Pantalla AGOTADA: aviso en rojo, predeterminado y SIN bloquear** (`screenOk` ya no pide confirmación; `outOfStockChoice` detecta el caso; la confirmación arranca marcada; el asistente de cierre pasó el aviso a rojo). Sigue siendo obligatorio ELEGIR la pantalla cuando hay opciones.
- **F48 — Alta guiada:** el **color del equipo es obligatorio** (ficha en `falta`, paso del wizard, guardado), la ficha agrega **observaciones que no bloquean** («Falta el número de teléfono del cliente», sin técnico) con `data-ficha-nota`, y **«Ir al campo» lleva el FOCO** al control del dato (`data-ficha-target`). Colores nuevos: **Lila** y **Marrón**.
- **En vivo:** `node tools/verify_tecnico_sin_asignar.mjs` (F45+F46+F48, 30/30) · `node tools/verify_pantalla_agotada.mjs` (F47+F48, 16/16, no guarda nada: el stock no se mueve) · `verify_recordatorios` 65/65.

#### F49 (2026-09-20) — El «Cerrar» de la tarjeta es ahora «Descuento» (y sale en la factura)
- **La tarjeta:** se quitó el botón **«Cerrar»** y va **«Descuento»** (`data-discount="<id>"`). El asistente de cierre sigue a un toque desde **«Cerrar entrega»** de la barra (o F4 → elegir la orden).
- **Diálogo de descuento** (`DiscountDialog.tsx`): abre con el descuento actual, muestra PRECIO/DESCUENTO/TOTAL en vivo, chips $1/$2/$3/$5/$10 + «Sin descuento», avisa cómo queda el saldo si ya hay abonos, y guarda con `updateOrderKeepingFields` (no pisa nada más). **No toca la caja.**
- **Regla pura** `src/lib/discount.ts` (+ `tools/discount_test.ts` 21/21): el precio de lista es `amount + discount_amount` y el descuento nuevo se calcula desde ahí (nunca dos veces), acotado a `[0, precio]`.
- **La factura** imprime `PRECIO` / `DESCUENTO` / `TOTAL` (principal y talón) **solo cuando hay descuento**; sin descuento el papel queda idéntico.
- **En vivo:** `node tools/verify_descuento.mjs` (15/15) · `receipt_acuerdo_test.ts` 74/74 · regresiones actualizadas al botón nuevo: `verify_servicio_cierre` 18/18, `verify_recordatorios` 65/65, `verify_metodos_en_cobros` 16/16.

#### F51 (2026-09-20) — Inventario: orden por COLUMNAS en Productos
- Clic en el encabezado: **asc → desc → sin orden**, con flecha y `aria-sort`; la paginación vuelve a la página 1. Server-side, con las **dos claves** de cada columna (nombre, categoría, marca, modelo, variante, precio, costo, stock, mín) y las viejas del desplegable conservadas.
- **Dos defectos reales cazados al verificar:** faltaba la clave inversa de varias columnas (`costo_desc`…) → el segundo clic no hacía nada (ahora hay **test Rust** `test_product_sort_keys_are_valid` con las 23 claves); y las columnas de Precio/Costo **desaparecían según la página** (con su encabezado para ordenar) → ahora se muestran siempre, en columnas separadas.
- **En vivo:** `node tools/verify_orden_columnas.mjs` (12/12, solo lectura) comparando el orden de la pantalla **contra la base leída aparte**. `cargo test --lib` 134/134.

#### F50 (2026-09-20) — Inventario: «lo que uso» (el check) + códigos de referencia
- Pedido del dueño: «no lo usa todo; un check con su número de cada producto o modelo… ésos son los que le van a aparecer cuando registra un servicio, así la búsqueda es más rápida».
- **Dos columnas nuevas en cada tabla** (`products.in_use` / `products.code`, `phones.in_use` / `phones.code` / `phones.default_product_id`), **al final** del orden físico. La migración se hace **por tabla y por columna** (probando cada una): en una base nueva la tabla `phones` nace **después** del bloque de `products`, así que el `ALTER` de `phones` fallaba en silencio y la base quedaba a medias («no such column: code»).
- **Seed** una sola vez: queda **en uso lo que tiene stock** (es lo que el taller tiene en el cajón) y se apaga el resto; **códigos** `P-0001` / `M-0001` completados siempre, sin pisar los que ya están. La misma regla se aplica a los productos nuevos. El dueño prende/apaga a mano lo que quiera.
- **El check es ANGOSTO:** `set_product_in_use`, `set_phone_in_use`, `set_phone_use_all` (transaccional: el teléfono **y sus repuestos**, con la misma unión clave+alias del padrón), `set_product_code`, `set_phone_code`, `set_phone_default_product`. **Nunca** tocan stock, precios, movimientos ni compatibilidad.
- **Inventario → Productos:** columna «En uso» ordenable, filtros **«Solo lo que uso»** / **«Lo que NO uso (apagado)»**, y la búsqueda encuentra por **código** (con guion y sin guion). **Inventario → Modelos:** el código `M-…` y el check por fila.
- **Registro de servicio:** el selector de modelo ofrece **solo lo que está en uso**, con el interruptor **«Ver todos»** (persistido en `localStorage`) y el aviso **«sin usar»** en lo apagado. La lista de **pantallas** de un modelo **no** se filtra: apagar una ficha no puede dejar al taller sin poder elegir el repuesto que tiene que instalar (decisión revisada frente a la spec).
- **El inventario sigue descontando:** test `test_in_use_never_stops_the_inventory_deduction` (una pantalla apagada a mano que se elige y se entrega **se descuenta**, y al reabrir vuelve a la MISMA ficha).
- **En vivo:** `node tools/verify_uso_modelos.mjs` (35/35) · `cargo test --lib` **136/136** · regresiones: `verify_orden_columnas` 12/12, `verify_trabajos_hechos` 26/26, `verify_smoke_integral` 110 comprobaciones. `tsc -b` 0 · `oxlint` 0 errores · `harness_security` PASS · `harness_truth` PASS.

#### F54 (2026-09-20) — El aviso de política no tapa la factura (y se quita con un toque)
- Pedido del dueño: «al finalizar el mensaje que sale de tlf y otro mensaje **no me deja ver la factura la orden**; le doy clic al mensaje y **no se quita**».
- **Qué pasaba (medido en vivo):** al entregar con «Imprimir la orden al cerrar», el asistente de cierre encola los avisos de política **y** abre la factura en el mismo paso. El modal centrado (F46) traía un velo a `z-[100]`, **por encima** de los diálogos (`z-50`): tapaba la factura y el **primer clic** (el de «Cerrar entrega» o el de la factura) lo consumía el velo — había que tocar dos veces. Y en la tarjeta solo cerraban los botones, el velo o Escape (con un diálogo abierto, Escape se ignora a propósito).
- **Arreglo:** (1) **el aviso no se dibuja mientras hay un diálogo a la vista** — queda en la cola y sale apenas se cierra (no se pierde ninguno) — y el velo pasa a `z-40`, por debajo de los diálogos; (2) **un toque en cualquier parte de la tarjeta lo cierra** (equivale a «Después»: no anota nada) más una **✕** visible; los botones de acción siguen igual; (3) nada de plata ni stock: el trabajo ya estaba guardado.
- **En vivo:** `node tools/verify_aviso_no_tapa.mjs` (14/14, con una **entrega real** sin cobro y su limpieza) · regresión `verify_recordatorios.mjs` **67/67** (los dos chequeos que exigían la conducta vieja se reescribieron a la nueva).

#### F52 (2026-09-20) — Inventario: vista «Por modelo» (una fila por teléfono, con sus variantes adentro)
- **Conmutador de vista** en Productos: **«Lista (ficha por ficha)»** | **«Por modelo (una fila por teléfono)»** (`data-view` / `data-view-state`).
- **Una fila por TELÉFONO del padrón** (`ProductsByModel.tsx`): código `M-…`, nombre, marca, **chips de variante adentro** (no como modelos distintos), cantidad de repuestos, **stock total**, **rango de precios**, el check **«lo uso»** del modelo y su **pantalla de referencia**.
- **Se despliega**: sus repuestos con **código, variante, precio, costo, stock** y su propio check, más el botón para **fijar/quitar la pantalla de referencia** del modelo (lo que el registro de servicio va a auto-seleccionar).
- **La variante es COLUMNA** (ordenable) y **FILTRO por familia** en la lista plana: pedir «OLED» trae OLED y «OLED Con Marco» (161 fichas en el catálogo real).
- **Reglas canónicas** en `catalog.rs` (`variant_family`, `variant_rank`, `sort_variants`) y su gemela en SQL (`VARIANT_FAMILY_SQL`) con **test de paridad**; puras en `src/lib/variant.ts` (+ `tools/variant_test.ts` 22/22).
- **Bug real cazado en vivo:** el detalle del teléfono no traía `code`/`in_use` de cada repuesto (la lista de columnas del SELECT se había quedado corta y los `unwrap_or` lo tapaban) → el despliegue mostraba todo «en uso» y sin código. Arreglado y fijado por test.
- **En vivo:** `node tools/verify_por_modelo.mjs` (27/27, contra la base) · `cargo test --lib` **139/139** · regresiones: `verify_orden_columnas` 12/12, `verify_uso_modelos` 35/35, `verify_trabajos_hechos` 26/26, `verify_aviso_no_tapa` 14/14, `verify_smoke_integral` **110/110**.

#### F53 (2026-09-20) — Un solo nombre por modelo, pantalla de referencia y duplicados
- **Split del padrón:** `catalog::split_model_models` parte el texto cuando tiene **2+ códigos** («Samsung A70 A705» → **A70** + **A705**; «K20 Plus MP260» → «K20 Plus» + «MP260»); NO parte «Redmi Note 11», «A06 4G» ni «Galaxy S21 Ultra 5G». La pantalla queda **compatible con los dos** (no se reescribe la compatibilidad del repuesto).
- **Migración guiada con vista previa** en **Inventario → Ajustes**: `preview_phone_split` calcula el informe *ejecutando el rebuild en una transacción que se revierte* (real: 1135 → 1205 teléfonos, 201 aparecen, 131 nombres pegados desaparecen) y `apply_phone_split` respalda la base, saca del texto la variante que falte, numera los nuevos (`M-…`) y los marca «en uso». **Idempotente**, ~4 s.
- **La pantalla de referencia manda:** `autoScreen(options, referenciaId)` elige la del modelo (el operario puede cambiarla). Verificado en vivo: al elegir el modelo, «Pantalla a instalar» aparece **elegida sola**.
- **Asistente de modelos repetidos:** grupos según los **repuestos compartidos**, con **vista previa** («queda X · se le suman Y, Z como alias»), «No son el mismo» y fusión sin tocar stock.
- **En vivo:** `node tools/verify_modelos_f53.mjs` **20/20** (unidades/capital/movimientos/órdenes/ventas/pagos idénticos antes y después) · `cargo test --lib` **143/143** · `queue_test.ts` 72/72 · auditoría antes/después: unidades 703 = 703. El pendiente menor (espejar el split en `audit_inventory.mjs`) se cerró como feature **55**.

#### F55 (2026-09-20/21) — La auditoría cuenta los mismos teléfonos que el padrón (y su espejo queda fijado por test)
- **El defecto:** `node tools/audit_inventory.mjs` contaba los teléfonos con su **propia** extracción de compatibilidad, **sin partir las entradas compuestas**. Después del split de F53 el reporte decía **1267** teléfonos distintos (script) mientras el padrón de la app tenía otro número: dos cifras que se leían como si una estuviera mal, cuando la diferencia era que **una aplicaba la regla nueva y la otra no**.
- **Qué se hizo:** se espejó `catalog::split_model_models` en el script (`isModelCode` + `splitModelModels`: un código es un token con **letras Y dígitos**, sin `4G/5G/LTE` ni números puros; con 2+ códigos cada parte es `[familia] + [código] + [palabras hasta el próximo código]`) y el resumen ahora **dice cuál número es cuál**: «teléfonos distintos en el catálogo **(script)**» junto a «teléfonos en el **padrón (app)**», este último leído de la tabla `phones` cuando la copia auditada la tiene (el número que ve el local manda).
- **La paridad dejó de ser una promesa:** como el script tiene una **copia a mano** de la regla (no puede llamar a Rust), se agregó el fixture **`tools/split_fixtures.json`** (17 casos: los reales «A70 A705», «A13 4G A135 M13», «Y6 2019 8A»…, el mismo código dos veces, y los que **no** se parten) generado con `node tools/audit_inventory.mjs --gen-split-fixtures` y verificado por el test **`catalog::tests::test_split_model_models_match_node_fixtures`**, el mismo patrón de `canonical_fixtures.json`. Si alguien toca una de las dos copias, el test de Rust **falla a propósito** en vez de que el reporte empiece a contar otra cosa en silencio.
- **Residual documentado (no es un bug):** las dos cifras siguen **cerca pero no idénticas** (script 1267 · padrón 1135 en la base de trabajo, que todavía **no** tiene aplicado el split de F53) porque el script no aplica el filtro de familia/marca ni los «junk» del backend, y porque el padrón solo se actualiza cuando el dueño aplica la migración desde **Inventario → Ajustes**. El número de **negocio** coincide exacto: productos **1087**, unidades totales **703**.
- **Verificación:** `cargo test --lib` **144/144** (6 ignorados) · `node tools/audit_inventory.mjs` corre y muestra las dos cifras · `node tools/audit_inventory.mjs --gen-split-fixtures` regenera el fixture sin diffs inesperados · `tsc -b` 0 · `oxlint` 0 errores.
