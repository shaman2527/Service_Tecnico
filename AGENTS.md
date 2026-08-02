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
- **Build: ✅ PASS (3m 37s release)**
- **Errors:** 0
- **Warnings:** 0
- **Tests:** 6/6 (incl. test_sales_legacy_physical_order, test_dashboard_analytics, moneda por método en test_all_operations)
- **Moneda por método:** abonos y ventas SIEMPRE en la moneda del método de pago (Bs para Pago Móvil/Efectivo Bs/Transf Bs, $ para Divisas/Zelle/Punto $); paid_amount en $ equivalente con conversión por tasa BCV del día del pago; ventas convierten total_usd × tasa; migración automática de pagos viejos
- **Dashboard analítico:** sincronización (indicador verde/rojo + última actividad), KPI (hoy/7 días/equipos/ingresos), ventas por categoría con barras, top modelos, diagrama de flujo de 6 etapas, stock bajo
- **Cierre por método:** "Cobros del día por método" (Divisas $, Efectivo Bs, Punto $+Bs con comisión→neto, Zelle $, Pago Móvil Bs con refs, Transf Bs, Total General)
- **Flujo cliente por cédula:** Services.tsx búsqueda por ci (V-XXXXX) con banner cliente nuevo/existente, cédula obligatoria para nuevo, historial máx 6, autocompletado de teléfono/ci/address editable (addOrFindClient 4 params)
- **Referencias pago móvil:** campo "Número de referencia (últimos 4 dígitos)" en ventas/servicios/abonos, mostrado en tablas; Libro Diario lista cada referencia+monto
- **Cierre rediseñado:** solo cuenta Efectivo Bs (cashCounted es-VE cents-first), diferencia en Bs y "Cuadrado ✅", métodos digitales bloqueados (se ajustan con Liquidar después)
- **Roles PIN:** sin PIN = cajera (sin Dashboard/export/cierre/históricos), PIN 4 dígitos = dueño; pantalla de bloqueo al iniciar, botones en Libro Diario
- **Export Excel:** export_daily_report → CSV (BOM + `;` + coma decimal es-VE) en %USERPROFILE%\Documents\Registro\, abre con Excel
- **Inventario real:** 44 productos con stock (232 unidades pantallas, lista usuario 194+57 cargada)
- **Centro de Ayuda:** Help.tsx en sidebar (v0.4) — quick actions (6) + accordion radix con 11 secciones que cubren TODO el sistema: primeros pasos, Dashboard, ventas (con moneda por método), servicio técnico (cédula + checklist), abonos (conversión Bs→$), inventario/pantallas, pedidos a proveedor, clientes, Libro Diario (abrir/cerrar/exportar), PIN y roles, FAQ
- **Abonos:** service_payments con historial, saldo por orden/cliente, Libro Diario por fecha de pago
- **Pedidos:** purchase_orders + sugerencias de reposición (get_reorder_suggestions), recibir suma stock

