# Registro - Sistema de Servicio Técnico

Aplicación desktop offline-first para gestión de un servicio técnico de celulares:
inventario de pantallas y repuestos, ventas, órdenes de reparación, clientes con historial,
abonos/pagos parciales y libro diario con tasa BCV.

## Repositorio

- **URL:** https://github.com/shaman2527/Service_Tecnico.git
- **Rama principal:** `main`

```bash
git clone https://github.com/shaman2527/Service_Tecnico.git
```

> **Nota:** la base de datos (`registro.db`), el binario (`Registro.exe`) y las planillas
> de datos están excluidos del repo (`.gitignore`) - son datos de negocio locales.
> Al clonar, seguir los pasos de [Ejecución](#ejecución).

## Stack

- **Frontend:** React 19 + TypeScript + Vite + shadcn/ui + Tailwind CSS v4 + Lucide icons
- **Backend:** Tauri 2.0 (Rust) + rusqlite (SQLite)
- **DB:** SQLite local (offline-first) - respaldo = copiar `registro.db`

## Funcionalidades

- **Ventas:** registro de ventas por producto con descuento automático de stock, chips de compatibilidad y stock visible (rojo si agotado), métodos de pago (Punto $/Bs con comisión, Zelle con referencia, Divisas USD, Efectivo Bs, Pago Móvil, Transferencia Bs).
- **Servicio Técnico:** órdenes de reparación con workflow de estados, checklist de blindaje del equipo al recibir (10 ítems Sí/No con cédula y dirección del cliente), sugerencias de modelo por compatibilidad.
- **Auto-Inventario:** al marcar un servicio como **Entregado** se descuenta 1 de la pantalla correspondiente (auto-crea el producto si el modelo no existe; devuelve stock al reabrir o borrar).
- **Abonos y pagos parciales:** panel por orden con Total/Abonado/Saldo, historial de pagos con método y notas; cada abono cuenta en el Libro Diario el día que se recibe; se permite entregar con saldo pendiente (deuda visible).
- **Clientes:** se crean automáticamente la primera vez (nunca se duplican); el form sugiere clientes existentes y autocompleta sus datos; historial completo de servicios con montos abonados y saldos.
- **Libro Diario (Venta Diaria):** turno de caja con un solo día abierto a la vez; apertura con efectivo inicial y **tasa BCV** (botón Auto BCV scrapea la página oficial con curl.exe, fallback manual); cierre con arqueo real por método y diferencia calculada; liquidación de Punto y reapertura.
- **Inventario / Pantallas:** catálogo con compatibilidad en chips, stock y movimientos.
- **Dashboard:** métricas, stock bajo y estadísticas.
- **Centro de Ayuda:** guía completa en la app (accesos rápidos + accordion por módulo + métodos de pago).
- **Sidebar colapsable:** `w-64` ↔ `w-16` (iconos), persistido en localStorage.

## Estructura

```
registro/
├── src/                       # Frontend React
│   ├── App.tsx                # Layout + navegación (sidebar colapsable)
│   ├── db.ts                  # Bridge Tauri invoke + mock browser mode
│   ├── types.ts               # Tipos compartidos
│   ├── components/
│   │   ├── Dashboard.tsx      # Métricas, stats, stock bajo
│   │   ├── Sales.tsx          # Registrar ventas, stats, top productos
│   │   ├── Services.tsx       # Órdenes de reparación + abonos/pagos + checklist
│   │   ├── Inventory.tsx      # Productos, compatibilidad, movimientos
│   │   ├── Clients.tsx        # Clientes con historial de servicios y saldos
│   │   ├── Catalog.tsx        # Pantallas: catálogo + compatibilidad
│   │   ├── DailyLedger.tsx    # Libro Diario: turno de caja, tasa BCV, arqueo
│   │   ├── Help.tsx           # Centro de Ayuda (accordion radix)
│   │   ├── ProductForm.tsx    # Form compartido producto
│   │   └── ui/                # 15 componentes shadcn
│   └── index.css              # Tailwind v4 + CSS variables
├── src-tauri/                 # Backend Rust
│   ├── src/
│   │   ├── main.rs            # Entrypoint (windows_subsystem)
│   │   ├── lib.rs             # Tauri builder + 33 comandos
│   │   ├── db.rs              # SQLite CRUD + turno de caja + abonos + auto-inventario
│   │   ├── bcv.rs             # Scraping tasa BCV con curl.exe (sin deps HTTP)
│   │   └── commands.rs        # Comandos Tauri
│   └── tauri.conf.json
├── run.ps1                    # Script de ejecución
├── AGENTS.md                  # HARNESS: sistema de registro + Entropy Registry
└── README.md
```

## Ejecución

| Modo | Comando | Descripción |
|------|---------|-------------|
| Browser (dev) | `npm run dev` | Vite en localhost:5173. Sin backend Tauri. db.ts retorna mocks. |
| Ventana nativa (dev) | `.\run.ps1 -Dev` | Tauri dev + Vite. Backend real con SQLite. |
| Producción | `.\run.ps1 -Build` | Build release + copia a Registro.exe |
| Ejecutar release | `.\Registro.exe` o `.\run.ps1` | App standalone sin servidor |

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

## Lecciones clave (resumen)

1. **Feature `custom-protocol` obligatoria** en Cargo.toml para que el frontend se
   embeba en el exe release. Sin ella, la app busca el dev server (ventana en blanco).
2. **Detección Tauri 2**: usar `window.__TAURI_INTERNALS__`, no `window.__TAURI__`.
3. **El build puede pasar y la app estar rota**: verificar en vivo (CDP) que la UI
   muestra filas reales y que los guardados persisten en el `.db`.
4. **La DB junto al exe** (`target/release/registro.db`) puede quedar vieja si el
   Copy-Item del deploy falla silenciosamente — verificar LastWriteTime y conteos.
5. **NO usar reqwest** en Cargo.toml (compilación eterna): el scraping BCV usa
   `curl.exe` (incluido en Windows 10+) vía `std::process::Command`.
6. **shadcn CLI roto** en este Windows (EPERM con "Configuración local"): instalar
   primitivos radix con npm y crear componentes a mano.
7. **Deadlocks de Mutex**: no llamar métodos que re-toman `self.conn.lock()` desde
   dentro de otro método que ya lo tiene (ej: `close_day` → `get_daily_totals`).

Detalles y registro completo de problemas en [AGENTS.md](AGENTS.md).
