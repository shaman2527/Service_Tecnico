# Registro - Sistema de Servicio Técnico

## Stack
- **Frontend:** React 19 + TypeScript + Vite + shadcn/ui + Tailwind CSS v4 + Lucide icons
- **Backend:** Tauri 2.0 (Rust) + rusqlite (SQLite)
- **DB:** SQLite local (offline-first)
- **UI:** shadcn/ui + Tailwind v4 + CSS variables via `@theme` + `:root`

## Arquitectura

registro/
├── src/                       # Frontend React
│   ├── App.tsx                # Layout + navegación (sidebar colapsable w-64↔w-16)
│   ├── App.css                # Estilos globales
│   ├── db.ts                  # Bridge Tauri invoke + mock browser mode
│   ├── types.ts               # Tipos compartidos
│   ├── lib/
│   │   └── utils.ts           # cn() helper (clsx + tailwind-merge)
│   ├── components/
│   │   ├── Dashboard.tsx      # Métricas, stats, stock bajo
│   │   ├── Help.tsx           # Centro de Ayuda (quick actions + accordion radix)
│   │   ├── Sales.tsx          # Registrar ventas, stats, top productos
│   │   ├── Services.tsx       # Órdenes de reparación + abonos/pagos + checklist
│   │   ├── Inventory.tsx      # Productos, compatibilidad, movimientos
│   │   ├── Clients.tsx        # Clientes con historial y saldos por servicio
│   │   ├── DailyLedger.tsx    # Libro Diario: turno de caja, tasa BCV, arqueo
│   │   ├── Catalog.tsx        # Pantallas: catálogo + compatibilidad completa
│   │   ├── ProductForm.tsx    # Form compartido producto (Inventario + Pantallas)
│   │   └── ui/                # 15 componentes shadcn (incl. accordion radix)
│   └── index.css              # Tailwind v4 + CSS variables
├── src-tauri/                 # Backend Rust
│   ├── src/
│   │   ├── main.rs            # Entrypoint (windows_subsystem)
│   │   ├── lib.rs             # Tauri builder + 33 comandos
│   │   ├── db.rs              # SQLite CRUD + turno de caja + abonos + auto-inventario
│   │   ├── bcv.rs             # Scraping tasa BCV con curl.exe (sin deps HTTP)
│   │   └── commands.rs        # Comandos Tauri
│   └── tauri.conf.json        # frontendDist: ../dist, devUrl: localhost:5173
├── run.ps1                    # Script de ejecución
├── migrate_data.py            # Migración desde Excel
└── AGENTS.md                  # ← HARNESS: sistema de registro

## Modos de Ejecución

| Modo | Comando | Descripción |
|------|---------|-------------|
| Browser (dev) | `npm run dev` | Vite en localhost:5173. Sin backend Tauri. db.ts retorna mocks. |
| Ventana nativa (dev) | `.\run.ps1 -Dev` | Tauri dev + Vite. Backend real con SQLite. |
| Producción | `.\run.ps1 -Build` | Build release + copia a Registro.exe |
| Ejecutar release | `.\Registro.exe` o `.\run.ps1` | App standalone sin servidor |

## Decisiones Técnicas (Harness Constraints)

### CSS / Theming
- **Regla:** `@theme` genera variables `--color-*` para utilidades Tailwind.
  `:root {}` define variables cortas `--background` para `var()` directo.
- **NO** usar `@theme inline` → no genera CSS variables, solo hardcodea valores.
- Los archivos shadcn/ui usan clases Tailwind (`.bg-background`), NO `var()` directo.

### DB Bridge (src/db.ts)
- **Regla:** `invoke()` de Tauri SOLO funciona dentro del runtime Tauri.
- **Detección de entorno:** `window.__TAURI_INTERNALS__ !== undefined` (Tauri 2) con fallback a `window.__TAURI__` (Tauri 1). `__TAURI_INTERNALS__` tiene solo `plugins` enumerable; el invoke real vive en `__TAURI_INTERNALS__.invoke` (no enumerable).
- En browser (npm run dev) ninguno existe → isTauri=false → mocks.
- **Lesson (2026-08-01):** `window.__TAURI__` NO existe en Tauri 2 — detectar solo con `__TAURI__` deja la app en modo browser silenciosamente (Inventario vacío, Dashboard con mocks) aunque el backend responda.

### Componentes UI
- 15 componentes shadcn/ui en `src/components/ui/` (button, card, dialog, table, badge, accordion, etc.)
- Estilos via `cn()` helper → clsx + tailwind-merge
- NO editar los archivos de ui/ directamente → regenerar con `npx shadcn add`

### Sistema de Libro Diario (Daily Ledger)
- `daily_closings` tabla SQLite para cierres diarios
- `sales` y `services` tienen columnas: bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency
- Comisión Punto: default 3.5%, net_amount = total - (total * fee%)
- Liquidación: pos_settled vs pos_net → diferencia debe ser ~0
- DailyLedger.tsx: vista diaria y de cierres, botón cerrar día, liquidar Punto

### Turno de Caja Diario (Venta Diaria)
- **Concepto:** solo hay UN día abierto a la vez (`daily_closings WHERE is_closed=0`). Sin día abierto, `add_sale`/`add_service` fallan en backend con "Debe abrir el día (Libro Diario) antes de registrar ventas o servicios." (gate enforced en db.rs `require_open_day`).
- **Abrir día:** `open_day(initial_cash_usd, tasa_bcv, tasa_eur)` crea fila de hoy con `is_closed=0`, `opened_at` y la **tasa BCV congelada** (nunca se consulta en vivo al cobrar). Rechaza si ya hay un día abierto.
- **Cerrar día:** `close_day(...)` recalcula los totales esperados (sales+services), guarda el **arqueo real** por método (actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs, actual_zelle, actual_pago_movil, actual_transfer_bs), calcula `difference` (USD + Bs/tasa) y pone `is_closed=1`.
- **Tasa BCV:** `get_bcv_rate` scrapea `https://www.bcv.org.ve/glosario/cambio-oficial` con **curl.exe** (incluido en Windows 10+, `-k -s --max-time 15`) + parse manual de `<strong class="strong-tb">` — SIN dependencias HTTP en Cargo.toml (reqwest tarda minutos en compilar). Fallback: entrada manual en UI (offline-first).
- UI: banner verde/ámbar en DailyLedger + botón "Auto BCV" en dialog de apertura, arqueo precargado con esperados en dialog de cierre, diferencia en vivo.
- Gates UI: Sales.tsx y Services.tsx consultan `getActiveDay()` y deshabilitan guardar + muestran banner si el día está cerrado (el backend es el respaldo real).
- Sidebar colapsable: `w-64` ↔ `w-16`, persistido en `localStorage('sidebar_collapsed')`.

### Métodos de Pago
- **Punto de Venta ($)**: USD, comisión tracker
- **Punto de Venta (Bs)**: VES, comisión tracker
- **Transferencia Zelle**: USD, reference number
- **Divisas (USD Cash)**: USD físico
- **Efectivo Bs**: Bolívares efectivo
- **Pago Móvil**: Bolívares
- **Transferencia Bs**: Bolívares

### Status de Servicio (Workflow)
Recibido → En reparación → Esperando repuesto → Reparado/Pendiente Pago → Por entregar → Entregado / Cancelado / Devuelto

### Tipo de Servicio (service_type)
- Columna `service_type TEXT` en tabla services — registra qué se le hizo al equipo
- Opciones: Cambio pantalla, Cambio batería, Cambio flex, Cambio conector / puerto, Reparación (placa), Limpieza / Mantenimiento, Software / Formateo, Cambio cámara, Cambio parlante / micrófono, Otro
- **Regla:** la migración usa ALTER TABLE → `service_type` queda al FINAL del orden físico de columnas. NUNCA usar `SELECT s.*` con mapping posicional; usar lista de columnas explícita (lesson: InvalidColumnType).
- UI: selector en ServiceForm (default "Cambio pantalla"), columna "Tipo" con Badge outline en la tabla

### Blindaje del Servicio (client_ci, client_address, device_checklist)
- Columnas en `services`: `client_ci TEXT`, `client_address TEXT`, `device_checklist TEXT` (JSON `{"key":"si"|"no"}`)
- Checklist 10 ítems (keys): chip_sim, tapa_trasera, bandeja_sim, botones, boton_home, camara, puerto_carga, parlante, contrasena, accesorios
- UI: ServiceForm → ToggleGroup Sí/No por ítem (Sí=emerald, No=destructive), tarjeta con teléfono·cédula juntos, icono ShieldCheck con Tooltip (resumen + detalle por ítem)
- Modelo: sugerencias listan CADA modelo individual del array de compatibility (dedupe Set, max 12) — al seleccionar setea model = modelo individual + price del producto
- Utilidades exportadas: `parseChecklist(json)`, `checklistSummary(json)` en Services.tsx
- **Regla CDP:** al verificar UI en vivo, esperar la transición y usar `data-state="on"` (no aria-pressed) para toggles radix

### Auto-Inventario en Servicios (descuento al entregar)
- **Regla:** `update_service` en db.rs compara status previo vs nuevo. Si pasa a "Entregado" → descuenta 1 del producto que matchea el modelo (`apply_service_stock(conn, model, -1)`). Si SALE de "Entregado" (reabierto) → devuelve 1. `delete_service` de un servicio entregado → devuelve stock.
- **Matching de modelo → producto:** `norm_model()` (minúsculas, sin acentos, sin puntuación) contra compatibility JSON (match exacto por modelo individual), luego name exacto o split por "/", luego fallback LIKE en model/name. Solo categoría 1 (Pantalla).
- **Auto-create:** si el modelo no existe en catálogo, `apply_service_stock` crea el producto "Pantalla X" (compatibilidad `[X]`, precio 0, stock 0) y descuenta → stock queda negativo (visible como faltante).
- Movimiento de inventario registrado: type salida/entrada, reason "Servicio Entregado"/"Servicio Reabierto", reference 'Servicio'.
- UI: sugerencias de modelo en ServiceForm y de producto en SaleForm muestran chips de compatibilidad + stock (rojo si ≤0). Catalog/Inventory muestran compatibilidad en chips (Badge) no texto pegado.

### Abonos y Pagos Parciales (service_payments)
- **Tabla `service_payments`:** id, service_id (FK), amount, payment_method, bank_fee_percent/amount, net_amount, zelle_reference, currency, payment_date (fecha del pago), notes.
- **`services` columnas:** `client_id INTEGER REFERENCES clients(id)` (vínculo al registro cliente) + `paid_amount REAL DEFAULT 0` (suma de abonos en USD equivalente, se recalcula en add/delete payment).
- **Comandos:** `add_service_payment(serviceId, amount, method, fee, zelle, currency, notes)` (requiere día abierto), `get_service_payments(serviceId)`, `delete_service_payment(id)` — todos recalcular paid_amount vía subquery.
- **Moneda SIEMPRE derivada del método (regla de negocio):** métodos Bs (`BS_METHODS` en db.rs: "Efectivo Bs", "Pago Móvil", "Pago Movil", "Transferencia Bs", "Punto de Venta (Bs)") → currency='VES' aunque el frontend mande 'USD'; "Divisas (USD Cash)"/"Transferencia Zelle"/"Punto de Venta ($)" → 'USD'. `normalize_payment_currency(method, currency)` en db.rs. En frontend, helpers en `src/lib/utils.ts`: `isBsMethod()`, `methodCurrency()`, `currencySymbol()`.
- **Conversión Bs→USD en `paid_amount`:** `recalc_paid_amount` (db.rs) convierte pagos VES con la tasa BCV del cierre del día del pago (`daily_closings.close_date = date(payment_date)`), fallback al día abierto actual, fallback 1. Pagos USD se suman directo. `amount` del servicio SIEMPRE es $ (el monto del form es "Monto ($)").
- **Migración init():** corrige pagos históricos con método Bs guardados como 'USD' → 'VES' y recalcula paid_amount de TODOS los servicios (idempotente).
- **Dialog de abono (Services.tsx):** `payCurrency` se deriva del método seleccionado (`methodCurrency(v)`), etiqueta dinámica "Monto (Bs.)"/"Monto ($)", hint "≈ $X (tasa BCV Y)" con la tasa del día abierto (`getActiveDay`), aviso "Este método es en bolívares...". Panel resumen: "Abonado $X + Bs. Y" (desglose por moneda) y "Saldo $X pendiente" / "Cancelado" (usando `svc.paid_amount` refrescado con `api.getService(id)` tras add/delete payment).
- **Ventas (Sales.tsx):** mismo principio — `saleCurrency = methodCurrency(method)`; si el método es Bs, `addSale` guarda total en Bs (total_usd × tasa BCV del día) con currency='VES' (bloquea si tasa=0 con aviso). Tabla de ventas y tarjeta Total muestran `currencySymbol(s.currency)` y desglose "$ + Bs.". Botón guardar muestra el monto final en la moneda del método.
- **Libro Diario (get_daily_totals):** agrupa por MÉTODO (no por currency): Pago Móvil/Efectivo Bs/Transf Bs → totales Bs; Divisas/Zelle/Punto ($) → USD. Por eso el `total` guardado debe estar en la moneda del método (los abonos se ingresan tal cual; las ventas convierten en el frontend).
- **Entrega con saldo:** permitido por diseño — el saldo pendiente queda visible (rojo) en la orden y en el historial del cliente.
- **Clientes:** ServiceForm sugiere clientes existentes (suggestClients) y autocompleta teléfono al seleccionar; al guardar usa `addOrFindClient` → client_id vinculado (nunca duplica). `get_client_services` busca por client_id primero, fallback por nombre.
- UI: panel "Pagos y Abonos" en ServiceForm (edición) con resumen Total/Abonado/Saldo + historial + dialog de registro con comisión Punto y referencia Zelle; en la lista de servicios se muestra abonado/saldo en la tarjeta (badge "Cancelado" o "$X pendiente" — en USD equivalente); Clients.tsx muestra Abonado/Saldo por servicio.

### Lista de Servicios (vista de tarjetas)
- **NO es tabla** — grid de tarjetas responsive (`grid-cols-1 lg:2 2xl:3`): cada orden es un Card con header (orden + fecha + badge estado), cliente (nombre + teléfono·cédula juntos), equipo (modelo + falla completa sin truncar), finanzas (monto + badge saldo/Cancelado + método + abonado), footer (badge tipo + fecha salida + acciones Editar/Eliminar/Shield).
- Iconos: User (cliente), Smartphone (equipo), CalendarDays (salida), ShieldCheck (checklist con tooltip), Trash2 (eliminar).
- Regla: la falla NO se trunca en tarjetas (line-clamp-2); la información completa siempre visible — evita tablas de 13 columnas que aprietan.

### Pedidos a Proveedor (purchase_orders)
- **Tablas:** `purchase_orders` (id, order_date, supplier, status 'Pendiente'|'Recibido', notes) + `purchase_order_items` (order_id FK, product_id FK, product_name, quantity, unit_price).
- **Comandos:** `add_purchase_order(supplier, notes, items_json)` (items = JSON array `[{productId, productName, quantity, unitPrice}]`, requiere día abierto), `get_purchase_orders` (con item_count/total_quantity/total_cost via LEFT JOIN), `get_purchase_order_items(orderId)`, `mark_purchase_order_received(orderId)` → **suma stock + movimiento entrada "Pedido Recibido"** (query inline, sin deadlock; rechaza recibir dos veces), `delete_purchase_order`.
- **Sugerencias de reposición:** `get_reorder_suggestions` — productos con stock < 0, o min_stock > 0 y stock ≤ min_stock, o con salidas en inventory_movements y stock ≤ 0 (NO todo el catálogo: evita 944 filas de productos nunca vendidos).
- UI: Pedidos.tsx en sidebar (icono ShoppingBag) — cards agotados/stock bajo/pendientes, tabla "Por reponer" con botón "Pedir N" (sugerido = min*2 - stock), dialog Nuevo Pedido con buscador del catálogo completo + carrito editable, lista de pedidos con "Ver" (detalle) + "Recibido" + eliminar.
- Regla deadlock: `mark_purchase_order_received` NO llama `get_purchase_order_items` con el lock tomado — query inline (patrón Entropy Registry).

### Dashboard Analítico (analytics)
- **Comando:** `get_dashboard_analytics` → struct `DashboardAnalytics` (db.rs): today_usd/today_bs (ventas del día por moneda), week_* (7 días: USD, Bs, unidades, count), `category_stats` (por categoría vía JOIN products→categories, ordenado por USD+Bs DESC), `top_models` (top 6 por producto/modelo/marca), counts (productos/ventas/servicios/clientes) + last_sale/last_service/last_movement/last_activity (para indicador de sincronización).
- **Moneda:** `COALESCE(s.currency,'USD') = 'USD'` → suma USD; != 'USD' → suma Bs. Nunca mezclar tasas en backend.
- **UI Dashboard.tsx:** indicador "Sincronizado · datos locales" (verde pulsante / rojo si falla la API), barra con counts + última actividad + hora de refresco, KPI (Ventas Hoy, Ventas 7 Días, Equipos en Taller, Ingresos Servicios), barras por categoría (CSS puro, width % relativo a max unidades — sin librería de charts), Top Modelos, **diagrama de flujo** (6 etapas ordenadas Recibido→Entregado + terminales Cancelado/Devuelto en rojo, nodos con count, opacidad 40% si count=0), tablas de métodos/estados/stock bajo.
- Test: `test_dashboard_analytics`.

### Cierre de Caja — Resumen por Método
- Dialog de cierre (DailyLedger.tsx) muestra "Cobros del día por método" con `MethodRow` (icono + label + detalle + monto): Divisas (USD Cash) $, Efectivo Bs, Punto de Venta ($+Bs) con detalle "Cobrado $X · Comisión -$Y → Neto $Z", Transferencia Zelle $, Pago Móvil Bs (+conteo de pagos por referencia), Transferencia Bs, y fila destacada "Total General del día".
- Los montos vienen de `expected` (get_daily_totals del día activo); si el día no tiene movimientos → expected=null y se muestra todo en 0 (sin "Cuadrado ✅").
- Métodos digitales siempre con valores esperados del sistema (locked, se ajustan con Liquidar Punto después).

### Commands Tauri (Rust)
- 39 comandos registrados en lib.rs (+1: get_dashboard_analytics)
- DB path: 1) junto al exe, 2) project root (dev), 3) %APPDATA%
- Tests: `cd src-tauri && cargo test`

## Constraint Checks (Pre-Push / CI)

Antes de hacer commit:
1. `npm run build` → TypeScript + Vite build exitoso
2. Verificar que `dist/assets/index-*.css` contenga `--background:` y `--color-background`
3. `cd src-tauri && cargo test` → Rust compila + tests pasan
4. `npx tsx tools/governance/run.ts --build-only` → harness governance

## Modos de Ejecución

| Modo | Comando | Descripción |
|------|---------|-------------|
| Browser (dev) | `npm run dev` | Vite en localhost:5173. Sin backend Tauri. db.ts retorna mocks. |
| Ventana nativa (dev) | `.\run.ps1 -Dev` | Tauri dev + Vite. Backend real con SQLite. |
| Producción | `.\run.ps1 -Build` | Build release + copia a Registro.exe |
| Ejecutar release | `.\Registro.exe` o `.\run.ps1` | App standalone sin servidor |

## Problemas Conocidos (Entropy Registry)

| Fecha | Problema | Fix |
|-------|----------|-----|
| 2026-07-30 | CSS variables no se emitían en build. body usaba `var(--background)` pero @theme inline no genera variables. | Cambiar `@theme inline` → `@theme`. Agregar `:root {}` con variables cortas. |
| 2026-07-30 | ERR_CONNECTION_REFUSED al abrir localhost en browser. App es desktop (Tauri), no web server. | Documentar modos de ejecución. No fix necesario — es expected behavior. |
| 2026-07-30 | `TypeError: Cannot read properties of undefined (reading 'invoke')` en browser mode. | Agregar mock automático en db.ts cuando `__TAURI__` no está disponible. |
| 2026-07-30 | `@plugin "tailwindcss-animate"` rompe utility classes en dev mode. Plugin v3 incompatible con v4. | Reemplazar por `@utility` nativas v4 en index.css + animaciones en `@theme`. |
| 2026-07-31 | `InvalidColumnType(8, "payment_method", Text)` en get_services. Migración ALTER TABLE agregó service_type al final de la tabla, rompiendo mapping posicional de `SELECT s.*`. | Usar SELECT con lista de columnas explícita en get_services y get_client_services. |
| 2026-07-31 | `crate 'brotli' required to be available in rlib format` tras interrumpir build y borrar target/. | Borrar solo `target/*/deps/*brotli*` y rebuild (no todo target/). |
| 2026-07-31 | Dropdowns (Select) en blanco al abrirlos en Tauri/WebView2. Animaciones de popper (`data-[state=open]:animate-in`, `data-[side=*]:translate-*`) no renderizan el contenido. | Quitar animaciones/transforms del popper en SelectContent (bg-popover + shadow mínimo). Ver shadcn issue #7433. |
| 2026-07-31 | Sugerencias (modelo/producto) invisibles al escribir en ServiceForm/SaleForm. Dropdowns `position:absolute` dentro de DialogContent (que tiene transform) no renderizan en WebView2. | Listas inline en flujo normal (border bg-popover shadow-md) + catálogo precargado en memoria con filtro client-side (sin round-trip por tecla). |
| 2026-07-31 | **Ventana en blanco en producción — CAUSA RAIZ:** `tauri = { version = "2", features = [] }` SIN `custom-protocol` → `generate_context!` corre en modo dev (`cfg!(not(feature = "custom-protocol"))` en tauri-macros) y genera assets VACÍOS. La app release intentaba cargar devUrl (localhost:5173) — funcionaba solo si había `npm run dev` corriendo (por eso el caché WebView2 tenía módulos de /node_modules/.vite/deps/), y en blanco sin él. El exe NUNCA embebió el frontend (mismo tamaño, brotli no encontraba assets). | Agregar `features = ["custom-protocol"]` a tauri en Cargo.toml. Rebuild (recompila tauri+macros). Verificar `target/release/build/registro-*/out/tauri-codegen-assets/` (brotli q9, JS ~105KB) y que el exe crezca ~+114KB. Tocar .rs SIEMPRE será insuficiente si falta la feature. |
| 2026-07-31 | Cambios de frontend NO llegaban a la app desplegada. cargo no recompila si solo cambió `dist/` (frontendDist no es input rastreado): build termina en ~2s y el exe conserva el frontend VIEJO embebido. | Tocar un .rs (Add-Content lib.rs "// force rebuild") y verificar que aparezca "Compiling registro" + build >30s. Verificar hash del exe desplegado vs target/release. (Requisito previo: feature custom-protocol activa, ver entrada anterior.) |
| 2026-07-31 | Duplicados de productos: mismos (brand, model) como "Pantalla X" (cat 1) y "Táctil X" (cat 18) con precios distintos. | Verificar con GROUP BY brand+model+variant HAVING COUNT>1; conservar el de categoría Pantalla, eliminar Táctil si stock 0 y sin movimientos. |
| 2026-08-01 | **DB NUNCA conectada en la app real — CAUSA RAIZ:** db.ts detectaba Tauri con `window.__TAURI__ !== undefined`, pero Tauri 2 NO expone `window.__TAURI__` (solo `__TAURI_INTERNALS__`, que además solo tiene `plugins` enumerable; el invoke real está en `__TAURI_INTERNALS__.invoke`). Resultado: isTauri=false → getProducts rechazaba → Inventario/Pantallas mostraban "Sin productos registrados" y el Dashboard usaba mocks (0s), aunque el backend respondía 970 productos (verificado vía CDP: `__TAURI_INTERNALS__.invoke('get_products')` → count=970). | Fix en src/db.ts: detectar `window.__TAURI_INTERNALS__ !== undefined` (con fallback a `__TAURI__` para Tauri 1). Verificación en vivo: `npm run build` → rebuild release → lanzar con `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` → CDP `Runtime.evaluate` para ver filas reales en tbody (970 en Inventario, 921 en Pantallas con 921 botones Editar) y prueba de guardado end-to-end (update via UI → persistió en registro.db real en disco). |
| 2026-08-01 | `shadcn CLI` falla en este Windows con `EPERM: operation not permitted, scandir 'C:\Users\ROBER\Configuración local'` (con latest y 4.15.0, incluso con HOME/USERPROFILE redirigido). | No usar `npx shadcn add`. Instalar el primitivo radix con npm (`npm install @radix-ui/react-toggle @radix-ui/react-toggle-group`) y crear el componente a mano siguiendo el estilo radix clásico del proyecto. Verificar que el resto del proyecto usa radix, no base-ui. |
| 2026-08-01 | **reqwest en Cargo.toml → compilación eterna** (hyper/tokio/rustls, >10 min y parece colgada; `cargo test` con timeout de 10-30 min sin terminar). | NO usar reqwest. Para el scraping BCV usar `curl.exe` (viene con Windows 10+) vía `std::process::Command` con `-k -s --max-time 15` + parse manual de `strong-tb`. Compilación del crate en ~25s. |
| 2026-08-01 | **Deadlock en db.rs**: `close_day`/`open_day` tomaban `self.conn.lock()` y luego llamaban `get_active_day`/`get_daily_totals` (que vuelven a tomar el lock). Mutex no reentrante → test colgado ("running for over 60 seconds"). | Calcular totals con `get_daily_totals` ANTES de tomar el lock, o hacer el query EXISTS inline con el mismo conn en `open_day`/`require_open_day`. |
| 2026-08-01 | **`rusqlite::ffi::Error::new`**: la firma es `new(result_code: c_int)` — NO acepta mensaje. `rusqlite::Error::SqliteFailure(ffi::Error::new(ErrorCode::CannotOpen as i32), Some(msg))` para errores de negocio con mensaje al frontend. | Usar ese patrón en `day_shift_error()` (db.rs). |
| 2026-08-01 | **Tasa BCV real en vivo**: scrape de `bcv.org.ve/glosario/cambio-oficial` devuelve ~129KB HTML (200 OK); parsea USD=Bs 748.79 y EUR=Bs 861.19 (agosto 2026). El parse con `find("USD")` → `find("strong-tb")` → primer `<` funciona; PowerShell `-match '(?s)...'` engaña (array de líneas). | Verificado via CDP: botón Auto BCV rellenó el form con tasas reales. |
| 2026-08-01 | `InvalidColumnType(9, "notes", Text)` en get_sales/get_client_sales en la app real: `sales.client_id` se agregó por ALTER TABLE (db.rs:415) sobre DB existente → queda físicamente DESPUÉS de notes, pero `SELECT s.*` + mapping posicional asumía client_id en índice 9. Tests pasaban porque la DB en memoria se crea con schema actual (orden correcto). Resultado: Nueva Venta mostraba trigger de método vacío y 0 ventas. | Usar lista de columnas explícita `SELECT s.id, s.date, ... s.notes, s.client_id, ...` en get_sales y get_client_sales (mismo patrón que get_services). Test de regresión `test_sales_legacy_physical_order`: recrea la tabla sales con el orden físico legacy (notes antes que client_id) y verifica ambos queries. Verificado en vivo via CDP: get_sales → "OK 1", trigger "Divisas (USD Cash)" + 7 opciones + campo "Número de referencia" al elegir Pago Móvil. |
| 2026-08-02 | **Abonos/ventas en Bs registrados como USD**: dialog de abono pasaba el `currency` del SERVICIO (default 'USD') en vez de derivarlo del método → abono de 2000 en Pago Móvil se guardaba como $2000 (servicio de $50 mostraba "Abonado $2010 / Cancelado"). Además `paid_amount` sumaba montos crudos mezclando monedas y Sales.tsx hardcodeaba 'USD' en addSale. | Moneda SIEMPRE del método (`normalize_payment_currency` en db.rs + `methodCurrency()` en utils.ts); `recalc_paid_amount` convierte pagos VES→USD con tasa BCV del día del pago (cierre del día, fallback día abierto); migración init() corrige pagos Bs guardados 'USD' y recalcula todos los paid_amount; dialog de abono con etiqueta/hint dinámicos por moneda; Sales.tsx convierte total_usd × tasa cuando el método es Bs. Tests 6/6 (test_all_operations actualizado: 10 Bs → 10/40.5 USD). Verificado en vivo via CDP: migración aplicada (3 pagos VES, paid_amount 2.68 para 2010 Bs @748.79), panel "Abonado $2.68 + Bs. 2010.00 · Saldo $47.32 pendiente", venta con Pago Móvil → "≈ Bs. 74879.00". |
| 2026-08-02 | **Inyección SQL en import_data** (CRÍTICO): nombres de columna interpolados directo del JSON del backup sin validar (db.rs ~2140-2190). Un backup malicioso/dañado podía ejecutar SQL arbitrario. | Fix: whitelist de columnas vía `PRAGMA table_info(table)` en HashMap `valid_columns` + filtro `valid.iter().any(|v| v == *k)`; todo dentro de `unchecked_transaction`; tabla `service_payments` añadida al listado (faltaba); orden de importación respeta FKs (service_payments antes de inventory_movements/daily_closings/purchase_orders). |
| 2026-08-02 | **`next_order_num` reutilizaba números**: usaba COUNT(*) → borrar un servicio hacía que el siguiente reutilizara su número (ORD-1001 dos veces). | `SELECT MAX(CAST(SUBSTR(order_num,5) AS INTEGER)) ... WHERE order_num LIKE 'ORD-%'` + 1 (monótono, no reutiliza). |
| 2026-08-02 | **`get_service` filtraba en memoria**: commands.rs cargaba TODOS los servicios (`get_services("","")`) y buscaba por id — O(n) con payload completo por consulta. | Nuevo `get_service_by_id(id)` en db.rs con query directo `WHERE s.id=?1` (+ `.optional()`). |
| 2026-08-02 | **add_sale / mark_purchase_order_received sin transacción**: si fallaba el UPDATE de stock tras el INSERT, quedaba venta sin descuento (o viceversa). | `conn.unchecked_transaction()` para ambos; `drop(stmt)` antes de `tx.commit()` (E0505: Statement mantiene borrow de tx); validación cantidad/precio positivos en add_sale. |
| 2026-08-02 | **open_day/close_day usaban INSERT OR REPLACE**: borraba la fila del día (id nuevo, referencias rotas) al reabrir/cerrar un día existente. | `INSERT ... ON CONFLICT(close_date) DO UPDATE` en open_day (conserva id); `UPDATE ... WHERE close_date=?1 AND is_closed=0` + error si changes==0 en close_day (flujo real: solo hay un día abierto). |
| 2026-08-02 | **delete_product sin mensaje**: fallaba con ConstraintViolation genérico si el producto tenía ventas/movimientos. | Mapear `ErrorCode::ConstraintViolation` → "Producto en uso (ventas, servicios o movimientos) — no se puede eliminar." |
| 2026-08-02 | **Sin índices en queries frecuentes**: dashboard (date), abonos (service_id), movimientos (product_id), listados (status/client_id). | Índices en init(): idx_sales_date, idx_service_payments_service, idx_inventory_movements_product, idx_services_status, idx_services_client, idx_daily_closings_closed + PRAGMA busy_timeout=5000, synchronous=NORMAL, journal_mode=WAL. |
| 2026-08-02 | **Bundle único 501.8KB** (sin code-splitting): App.tsx importaba los 9 componentes estáticos → arranque lento en PCs de bajos recursos; además navegación desmontaba/remontaba pantallas con refetch total. | React.lazy + Suspense en App.tsx (fallback "Cargando…") → bundle principal 242KB + chunks por pantalla (Services 48KB, Help 30KB, DailyLedger 24KB...). Verificado en vivo: navegación + form OK con la nueva build. |
| 2026-08-02 | **Llamadas duplicadas getPaymentMethods/getServiceStatuses/getCategories** (cada carga y cada dialog). | Cache estática módulo en db.ts (`cachedMethods/cachedStatuses/cachedCategories`); invoca una vez y reusa. |
| 2026-08-02 | **Refetch por keystroke** en buscadores (Sales/Services) + estado muerto `setProducts` en Sales + filtrado de 980 productos sin memo en Catalog. | Debounce 350ms en los search effects; eliminada la llamada getProducts inútil en Sales.load; `useMemo` en Catalog (filtered/shown/withCompat). |
| 2026-08-02 | **ServiceForm plano sin secciones**: ~25 campos seguidos, "1." sin "2.", checklist 1 columna, default status 'Por entregar', borrado de pedidos sin confirmación. | Form en 5 secciones numeradas (1 Cliente, 2 Equipo y diagnóstico, 3 Blindaje, 4 Finanzas y estado, 5 Cierre de la orden en edición) con `SectionTitle` (círculo numerado + línea); checklist en grid 2 columnas + botón "Marcar todo Sí" (10 toggles on verificado vía CDP); default status "Recibido"; AlertDialog de confirmación en Pedidos (aviso especial si el pedido ya fue recibido). |
| 2026-08-02 | **Libro Diario sumaba Bs como USD — "$2076" falsos**: `grand_total = pos_net + cash_usd + cash_bs + zelle_total + ...` (db.rs) sumaba montos Bs (Pago Móvil 1056, Efectivo Bs 1000, Transf Bs 20) al total en USD → Total General $2076.25 cuando lo real era ~$2.77. Además 2 ventas históricas (Tecno SPARK 56.25 PM, Apple 11 PRO 20 Transf Bs) quedaron con currency='USD' por bug del frontend viejo, y la UI mostraba columnas Comisión/Cash/Zelle que el usuario no usa. | Backend: `compute_daily_totals` extraído (helper conn-level reutilizable, sin re-lock); moneda SIEMPRE derivada del método vía `normalize_payment_currency` en el query; nuevos campos `grand_usd`/`grand_bs`/`tasa_bcv` en DailyTotals; `grand_total = grand_usd + grand_bs/tasa` (tasa del cierre del día, fallback día abierto); `close_day` guarda `total_usd`/`total_bs` (ALTER TABLE) + grand_total correcto; migración init() corrige sales/services Bs→VES y RECALCULA todos los cierres históricos con su propia tasa (idempotente); CSV exporta "Total General USD/Bs/equiv". Test `test_daily_totals_currency` (7/7). Frontend: KPIs por método (Neto Punto, Pago Móvil, Efectivo Bs, Divisas $), Total General con desglose "$X + Bs. Y" + equivalente, tabla diaria `Fecha | Punto Cargado/Comisión/Neto | Pago Móvil | Efectivo Bs | Divisas $ | [Zelle] | [Transf Bs] | Tasa BCV | Total ($ + Bs.)` con Zelle/Transf SOLO si hay movimientos + fila de TOTALES al pie; cierres con Punto Neto/Liquidado/PM/Efectivo Bs/Divisas/Tasa/Total desglose/Diferencia; dialog de cierre sin columnas innecesarias. Verificado en vivo vía CDP: 01-08 → "Bs.2.076,25" (PM 1.056,25 + Efectivo 1.000 + Transf 20), Total "Bs.2.086,25", grand_total 2.77, cierre id5 total_bs=2076.25, ventas corregidas VES. |

| 2026-08-02 | **Modal de cerrar día fuera de pantalla**: DialogContent sin max-h → el contenido (métodos + PM + notas + botones) crecía sin límite y los botones Cerrar Día/Cancelar quedaban fuera del viewport (no se podía cerrar). | DialogContent `sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden`; DialogHeader + DialogFooter `shrink-0` (footer fijo con border-t, botones siempre visibles); cuerpo `min-h-0 flex-1 overflow-y-auto` (scroll interno); métodos en grid 2 columnas (Total General col-span-2); tabla Pago Móvil con `max-h-44 overflow-y-auto`. Verificado vía CDP: dialog 45–704px dentro de viewport 749px, botones en 643–679px visibles. |
| 2026-08-02 | **Editar servicio pisaba el monto con $0**: `selectModel` hacía `setAmount(product.price_sale)` al elegir el modelo del catálogo; si el producto no tiene precio (0) el monto real (ej. $499.99) se borraba → el form mostraba "Monto $0 / Total $0 / Saldo Cancelado" (falso: $323.28 pendiente) y al guardar se sobreescribía amount=0 en la DB. | Ref `amountTouched`: el auto-precio del catálogo solo aplica si el usuario NO tocó el monto; en edición `amountTouched.current=true` al cargar (nunca pisa el monto real). Verificado vía CDP: editar ORD-1032 → Monto $499.99, panel "Saldo $323.28 pendiente". |
| 2026-08-02 | **Saldo con `Math.max(0, ...)` ocultaba sobrepagos**: cualquier cobro > monto mostraba "Cancelado" verde; un servicio con monto 0 y abonos mostraba "Cancelado" en vez de excedente. | Saldo honesto en ServiceForm y Clients.tsx: `saldoUsd = amount - paid` → >0.005 "pendiente" rojo, <-0.005 "Excedente $X" ámbar (+hint en dialog de pago), |saldo|≤0.005 "Cancelado" verde. |
| 2026-08-02 | **Campo "Moneda" editable contradecía al método**: con "Punto de Venta (Bs)" el Select podía mostrar/guardar "USD $" (harness: moneda SIEMPRE del método; backend normaliza pero la UI mentía). | Select eliminado → etiqueta informativa `Moneda: Bs. — Bolívares (según método)` derivada de `methodCurrency(payment)`; `useEffect` auto-sincroniza el estado interno (reemplaza el hack del caso Zelle). |
| 2026-08-02 | **Buscar cédula no encontraba al cliente**: `find_client_by_ci` usaba match EXACTO (`c.ci = ?1`) — "V-24906999" vs "24906999" (o espacios) = no encontrado → el usuario veía "Cliente nuevo" y nada de historial. Además el historial solo se mostraba si había servicios (sin aviso de vacío) y en edición incluía el propio servicio (parecía duplicado). | Backend: búsqueda tolerante a formato con variantes (crudo, solo dígitos vía `norm_ci_digits`, "V-"+dígitos, "E-"+dígitos). Frontend: `normCi()` al buscar; aviso "Sin historial previo de servicios" cuando clientId existe sin servicios; historial excluye el servicio en edición (`filter(s => s.id !== service?.id)`). Verificado vía CDP: findClientByCi con "V-24906999"/"24906999"/"v 24906999" → mismo cliente; nuevo servicio con cédula V- → historial completo. |
| 2026-08-02 | **Entregados no se distinguían en pantalla + sin base para garantía**: las cards eran todas iguales (solo badge de estado) y `date_out` era manual — al entregar sin poner fecha no existía la fecha de entrega. | Cards: `status='Entregado'` → `border-emerald-500/40 bg-emerald-500/5` (verde clarito) + `CheckCircle2` verde + badge `bg-success`. Garantía 7 días corridos desde `date_out`: backend `update_service` auto-setea `date_out=hoy` al entregar sin fecha y lo LIMPIA al reabrir (la nueva entrega reinicia la garantía); helpers `warrantyEnd`/`warrantyStatus` en utils.ts; badge "Garantía hasta {+7d}" (verde) o "Garantía vencida" (gris) en la card; banner al editar un entregado ("En garantía — vence el X" ámbar / "Garantía vencida" gris). Test `test_service_warranty_dates` (8/8). Verificado vía CDP: ORD-1003 (entregado 01-08) → card verde + "Garantía hasta 2026-08-08" + banner en edición. |
| 2026-08-02 | **Sin distinción de "Por entregar" ni filtro por tipo de trabajo**: el técnico no podía responder "¿cuántas pantallas tengo por hacer?" — el filtro solo era por estado. | Cards `status='Por entregar'` → `border-amber-500/40 bg-amber-500/5` (amarillo claro) + icono `Clock` ámbar (verde=entregado, amarillo=por entregar, sin color=en taller). Chips contadores por `service_type` (`SERVICE_TYPES` + `ACTIVE_STATUSES` en Services.tsx): "Todos N" + un chip por tipo con conteo de equipos en taller (Recibido→Por entregar, excluye Entregado/Cancelado); click filtra la lista client-side (`visibleServices`, combinable con búsqueda y Select de estado), chip activo resaltado. Verificado vía CDP: chips "Todos 3 · Cambio batería 1 · Cambio conector / puerto 1 · Software / Formateo 1"; click en "Cambio conector / puerto" → 1 card (ORD-1033). |
| 2026-08-02 | **Card "Total General del período" genérico** (Libro Diario): 3 textos planos (USD/Bs/Equivalente) sin jerarquía visual. | Rediseño split-card con componentes existentes (sin tocar ui/): header con `CardTitle`+`CardDescription` y `Badge` del equivalente (≈ $X USD); cuerpo grid 3 celdas con divisores (`divide-x/y`), cada una con chip de icono semántico (DollarSign emerald / Banknote ámbar / ArrowRightLeft primary) + número `text-2xl tabular-nums`; footer `Separator` + "N día(s) con movimientos" + tasa BCV del día abierto. Verificado vía CDP: Dólares $150.00 · Bolívares Bs.36.386,25 · Equivalente $198.59 · Tasa BCV 748.79. |
| 2026-08-02 | **Columna Punto de la tabla diaria sin moneda — "$35000" confuso**: `pos_charged/pos_fees/pos_net` suman el punto crudo (Bs y USD mezclados) y la UI los mostraba con símbolo $ fijo → un cobro de Punto (Bs) de Bs 35.000 aparecía como "$35.000,00". | Backend: `DailyTotals` gana `pos_charged_usd/bs` + `pos_net_usd/bs` (clasificación por moneda derivada del método en `compute_daily_totals`); helper `fmtMix(usd, bs)` en DailyLedger ("$X + Bs. Y" omitiendo ceros). Tabla rediseñada: columnas "Punto Cargado/Comisión/Neto Punto" → UNA columna "Punto de Venta" con el neto en su moneda real + detalle debajo ("Cargado Bs.35.000,00 · Comisión -Bs.700,00"); KPI Neto Punto y dialog de cierre con desglose por moneda. Test `test_daily_totals_currency` verifica punto Bs 35.000 (neto Bs 34.300) + punto USD 100. Verificado vía CDP: fila 02-08 → "Bs.34.300,00 | Cargado Bs.35.000,00 · Comisión -Bs.700,00 | Total $150.00 + Bs.34.310,00". |
| 2026-08-02 | **Comisión y ceros confusos en la tabla diaria**: el detalle "Cargado X · Comisión -Y" no se entendía y las celdas sin movimiento mostraban "$0.00"/"Bs.0,00" que "no decían nada". | Quitado el subdetalle de comisión (celda Punto y dialog de cierre muestran SOLO el neto en su moneda — la comisión sigue calculándose internamente en backend para el cierre); celdas sin movimiento → "—" (helper `dash`); KPI "Neto Punto" → "Punto de Venta"; columna Punto condicional (`hasPos`). Verificado vía CDP: 01-08 → "Punto — · Divisas —", 02-08 → "Punto Bs.34.300,00", la palabra "Comisión" ya no aparece en el Libro Diario. |

## Feedback Loops

1. **Build → Verify:** Tras cada build release, verificar que CSS variables estén en el output.
2. **Runtime Error → Harness Fix:** Si un error se repite, el harness (AGENTS.md, db.ts) debe prevenir la recurrencia.
3. **UI Review:** El humano revisa la UI y reporta desvíos → se documenta en Entropy Registry.

## No-Functional Requirements
- Sin conexión a internet (offline-first)
- Arranque rápido
- DB liviana (SQLite)
- Sincronización manual via JSON
- Fácil de respaldar (solo copiar registro.db)

## Build Status
- **Date:** 2026-08-02
- **Build: ✅ PASS (npm 2.61s / release 3m56s)**
- **Registro.exe MD5:** 9DFA1AD3D7EF02C8D0208E938C270AE2
- **Tests:** 8/8 (incl. test_service_warranty_dates, test_daily_totals_currency)
- **Errors:** 0
- **Warnings:** 0

