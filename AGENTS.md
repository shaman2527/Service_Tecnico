# Registro - Sistema de Servicio Técnico

## Stack
- **Frontend:** React 19 + TypeScript + Vite + shadcn/ui + Tailwind CSS v4 + Lucide icons
- **Backend:** Tauri 2.0 (Rust) + rusqlite (SQLite)
- **DB:** SQLite local (offline-first)
- **UI:** shadcn/ui + Tailwind v4 + CSS variables via `@theme` + `:root`

## Arquitectura

registro/
├── src/                       # Frontend React
│   ├── App.tsx                # Layout + navegación (sidebar w-64)
│   ├── App.css                # Estilos globales
│   ├── db.ts                  # Bridge Tauri invoke + mock browser mode
│   ├── types.ts               # Tipos compartidos
│   ├── lib/
│   │   └── utils.ts           # cn() helper (clsx + tailwind-merge)
│   ├── components/
│   │   ├── Dashboard.tsx      # Métricas, stats, stock bajo
│   │   ├── Help.tsx           # Centro de Ayuda (accordion guía completa)
│   │   ├── ui/                # 15 componentes shadcn (incl. accordion radix)
│   │   ├── Sales.tsx          # Registrar ventas, stats, top productos
│   │   ├── Services.tsx       # Órdenes de reparación, seguimiento
│   │   ├── Inventory.tsx      # Productos, compatibilidad, movimientos
│   │   ├── Clients.tsx        # Gestión de clientes
│   │   ├── Catalog.tsx        # Pantallas: catálogo + compatibilidad completa
│   │   ├── ProductForm.tsx    # Form compartido producto (Inventario + Pantallas)
│   │   └── ui/                # 15 componentes shadcn
│   └── index.css              # Tailwind v4 + CSS variables
├── src-tauri/                 # Backend Rust
│   ├── src/
│   │   ├── main.rs            # Entrypoint (windows_subsystem)
│   │   ├── lib.rs             # Tauri builder + 27 comandos
│   │   ├── db.rs              # SQLite CRUD + export/import
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
- UI: ServiceForm → ToggleGroup Sí/No por ítem (Sí=emerald, No=destructive), columna "Cédula" en tabla, icono ShieldCheck con Tooltip (resumen + detalle por ítem)
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
- **`services` columnas:** `client_id INTEGER REFERENCES clients(id)` (vínculo al registro cliente) + `paid_amount REAL DEFAULT 0` (suma de abonos, se recalcula en add/delete payment).
- **Comandos:** `add_service_payment(serviceId, amount, method, fee, zelle, currency, notes)` (requiere día abierto), `get_service_payments(serviceId)`, `delete_service_payment(id)` — todos recalcular paid_amount vía subquery SUM.
- **Libro Diario (get_daily_totals):** cuenta los PAGOS por `payment_date` (el dinero real del día), NO el amount del servicio. Fallback de compatibilidad: servicios Entregado SIN ningún pago registrado suman su amount en `date_out` (históricos).
- **Entrega con saldo:** permitido por diseño — el saldo pendiente queda visible (rojo) en la orden y en el historial del cliente.
- **Clientes:** ServiceForm sugiere clientes existentes (suggestClients) y autocompleta teléfono al seleccionar; al guardar usa `addOrFindClient` → client_id vinculado (nunca duplica). `get_client_services` busca por client_id primero, fallback por nombre.
- UI: panel "Pagos y Abonos" en ServiceForm (edición) con resumen Total/Abonado/Saldo + historial + dialog de registro con comisión Punto y referencia Zelle; columna "Abono" en tabla de servicios; Clients.tsx muestra Abonado/Saldo por servicio.

### Commands Tauri (Rust)
- 33 comandos registrados en lib.rs (+3: get_service_payments, add_service_payment, delete_service_payment)
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
- **Date:** 2026-08-01
- **Build: ✅ PASS (9.9s)**
- **Errors:** 0
- **Warnings:** 0
- **Inventario real:** 44 productos con stock (232 unidades pantallas, lista usuario 194+57 cargada)
- **Centro de Ayuda:** Help.tsx en sidebar (quick actions + accordion radix, 8 secciones + abonos + métodos de pago)
- **Abonos:** service_payments con historial, saldo por orden/cliente, Libro Diario por fecha de pago

