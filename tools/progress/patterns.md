# Patterns — Registro (Updated 2026-08-01)

## Errors to avoid
1. NO usar `@plugin "tailwindcss-animate"` en Tailwind v4 — rompe utility classes
2. NO usar `@theme inline` — no genera CSS variables para shadcn
3. NO usar `space-y-*` — usar `flex flex-col gap-*`
4. NO usar `mr-*` en iconos dentro de Button — Button ya tiene `gap-2`
5. NO usar "$P" como label en UI — "$P" es jerga interna del harness, no del sistema
6. NO olvidar actualizar tests cuando cambian firmas de funciones Rust
7. NO olvidar registrar nuevos comandos en lib.rs después de commands.rs
8. NO asumir orden físico de columnas con `SELECT s.*` — columnas migradas con ALTER TABLE quedan al FINAL de la tabla; usar lista explícita de columnas en el SELECT y mapeo por índice consistente (lesson: InvalidColumnType en get_services)
9. NO borrar `target/` — fuerza rebuild completo; si `crate 'brotli' required to be available in rlib format`, borrar solo `target/*/deps/*brotli*`
10. NO usar animaciones/transforms de popper (`data-[state=open]:animate-in`, `data-[side=*]:translate-*`) en SelectContent/DropdownMenu para Tauri — WebView2 no renderiza el contenido del dropdown (queda blanco). Mantener popper mínimo: `bg-popover + shadow` (lesson: shadcn issue #7433)
11. NO usar `position: absolute` para dropdowns de sugerencias dentro de DialogContent (tiene transform + animaciones → WebView2 no renderiza el overlay). Usar lista inline (en flujo normal, debajo del input) con `border bg-popover shadow-md max-h-* overflow-y-auto`
12. NO hacer round-trip a la DB por cada tecla en buscadores/sugerencias. Precargar el catálogo completo en memoria (`api.getProducts('', null)` una vez al montar) y filtrar client-side (name + brand + model + compatibility, case-insensitive)
13. SI el exe no contiene el frontend nuevo tras build: verificar PRIMERO que `tauri = { version = "2", features = ["custom-protocol"] }` en Cargo.toml. SIN esa feature, `generate_context!` corre en modo dev (cfg!(not(feature = "custom-protocol"))) y genera assets VACÍOS — la app release intenta cargar devUrl (localhost:5173) y la ventana sale en blanco si no hay dev server. Los assets se cachean en `OUT_DIR/tauri-codegen-assets/{sha256}.{ext}` (brotli q9 en release) y se embeben vía include_bytes. Verificación: `cargo build --release` debe recompilar tauri+macros al agregar la feature; el exe debe crecer ~+114KB; `target/release/build/registro-*/out/tauri-codegen-assets/` debe existir con un .js de ~105KB. Tocar un .rs (ej. `Add-Content src-tauri/src/lib.rs "// force rebuild"`) fuerza re-ejecución del macro (recompila lib.rs), pero si la feature falta, los assets siguen vacíos. Verificar el exe desplegado con Get-FileHash (debe coincidir con el de target/release)
14. **NO usar `window.__TAURI__` para detectar Tauri en Tauri 2 — NO existe.** Tauri 2 expone `window.__TAURI_INTERNALS__` (el invoke real está en `__TAURI_INTERNALS__.invoke`, no enumerable; solo `plugins` es enumerable). Detectar solo con `__TAURI__` deja isTauri=false → getProducts rechaza → Inventario/Pantallas vacíos y Dashboard con mocks, aunque el backend responda (lesson 2026-08-01: la app NUNCA conectó la DB en la app real). Usar `window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined` (fallback Tauri 1)
15. **NO confiar en que la UI funciona solo porque el build pasa.** La app puede cargar el frontend correcto y aún no conectar la DB (ver #14). Verificación en vivo requerida: lanzar con `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"`, luego CDP `Runtime.evaluate` sobre `ws://localhost:9222/devtools/page/*` para: (a) contar filas en tbody de Inventario/Pantallas, (b) llamar `window.__TAURI_INTERNALS__.invoke('get_products', {search:'', categoryId:null})` y verificar count, (c) prueba de guardado end-to-end y verificar persistencia en el .db real (sqlite3)
16. NO asumir que la DB junto al exe es la misma que se probó: `get_db_path()` prioriza la DB junto al exe → `target/release/registro.db` puede quedar VIEJA si el Copy-Item del deploy falla silenciosamente (verificar LastWriteTime y conteos de filas; comparar con registro.db de la raíz)

## Conventions
1. CSS: `@theme` para tokens, `:root` para variables cortas, `@utility` para animaciones
2. Componentes: `flex flex-col gap-*` para layouts verticales, `gap-*` para grids
3. Iconos en botones: sin clases de margin, Button maneja spacing via gap-2
4. db.ts: detectar Tauri 2 con `window.__TAURI_INTERNALS__` (fallback `window.__TAURI__` Tauri 1); mock fallback en browser
5. Nuevos comandos Tauri: agregar a commands.rs + lib.rs + db.ts + types.ts
6. Pagos: Punto de Venta → bank_fee_percent default 3.5%, Zelle → zelle_reference required
7. Servicios: tipo de servicio (service_type) obligatorio en formulario — "Cambio pantalla" default
8. Scripts one-off de DB (python): respaldar DB en backup/ antes de mutar; commit solo si se verifica

## Stack
- React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui (base-nova)
- Tauri 2.0 + rusqlite (SQLite) + serde_json
- Lucide icons, class-variance-authority, clsx, tailwind-merge

## Payment Methods & Ledger
| Método | Tabla | Campos adicionales |
|--------|-------|-------------------|
| Punto de Venta ($) | sales/services | bank_fee_percent, bank_fee_amount, net_amount |
| Punto de Venta (Bs) | sales/services | bank_fee_percent, bank_fee_amount, net_amount |
| Transferencia Zelle | sales/services | zelle_reference |
| Divisas (USD Cash) | sales/services | currency='USD' |
| Efectivo Bs | sales/services | currency='VES' |
| Pago Móvil | sales/services | currency='VES' |
| Transferencia Bs | sales/services | currency='VES' |

## Daily Closing Logic
- `daily_closings` table stores end-of-day reconciliation
- POS net = charged - fees
- Grand total = pos_net + cash_usd + cash_bs + zelle + pago_movil + transfer_bs + usd_cash
- pos_settled = actual bank settlement (user enters)
- diff = pos_settled - pos_net (should be near zero)

## Service Types
Opciones en el formulario de servicios (Services.tsx):
Cambio pantalla, Cambio batería, Cambio flex, Cambio conector / puerto,
Reparación (placa), Limpieza / Mantenimiento, Software / Formateo,
Cambio cámara, Cambio parlante / micrófono, Otro
- Columna `service_type TEXT` en tabla services (migración ALTER TABLE → queda al final)
- Backfill heurístico: fault LIKE '%pantalla%'→Cambio pantalla, etc.
- En UI: columna "Tipo" con Badge outline en la tabla de servicios

## Build commands
- Dev: `npm run dev` (browser) o `.\run.ps1 -Dev` (Tauri)
- Build: `.\run.ps1 -Build`
- Run: `.\Registro.exe` o `.\run.ps1`
- Test Rust: `cd src-tauri && cargo test`
- Harness governance: `npx tsx tools/governance/run.ts --build-only`

## Modo DEV obligatorio durante el módulo de inventario (2026-09-15)
Regla del usuario (vigente hasta que él lo levante): **todo en modo dev**.
- NO publicar release (`tools/release.ps1` queda prohibido), NO push a producción.
- La limpieza/normalización del catálogo se corre SIEMPRE sobre una copia
  (`node tools/snapshot_db.mjs`) o sobre la base de dev (`REGISTRO_DB=dev_registro.db`).
- NUNCA sobre la plantilla `registro.db` ni sobre la base instalada de la tienda
  sin pedido explícito.

## Limpieza del catálogo (marcas/modelos/nombres) — 2026-09-15
- Reglas en UN solo archivo: `tools/canonical_brands.json`. Lo leen el backend Rust
  (`catalog.rs`, `include_str!`) y la auditoría node (`tools/audit_inventory.mjs`).
- Paridad node <-> Rust verificada con `tools/canonical_fixtures.json`
  (`node tools/audit_inventory.mjs --gen-fixtures` + test
  `catalog::tests::test_canonical_rules_match_node_fixtures`). Si divergen, el test falla.
- Auditoría (solo lectura): `node tools/audit_inventory.mjs --db <ruta> [--json] [--snapshot <out>]`
  → marcas fuera del mapa, modelos multi-teléfono ("A / B / C"), nombres no canónicos,
  duplicados, stock negativo y snapshot de stock por id (invariante antes/después).
- Aplicar: comando Tauri `normalize_catalog(dry_run)` desde la UI, o el hook manual
  `REGISTRO_NORMALIZE_DB=<ruta> [REGISTRO_NORMALIZE_APPLY=1] cargo test -- --ignored
  test_manual_normalize_db --nocapture` (hace respaldo en `backup/` antes de escribir).
- Invariante obligatorio: `stock` por id y unidades totales NO cambian (verificado 702/702).
- `products.search_text` (columna nueva) = nombre+marca+modelo+variante+compatibilidad
  normalizados; la búsqueda exige TODOS los tokens escritos, así "red note" sigue
  encontrando "Xiaomi Redmi Note 11" después de canonicalizar el catálogo.

## Harness en este proyecto
`harness_*` (learn/review/security/truth) NO detectan la copia de `tools/`: el detector
exige `spec/ + governance/ + config/` y aquí la config es `tools/config.ts` (archivo).
Alternativa mientras siga así: escribir a mano en `tools/progress/patterns.md` y usar
`npx tsx tools/governance/run.ts --build-only` / `--security` para los gates.

## Lecciones 2026-09-15 (inventario: padrón de teléfonos y limpieza)
- **`conn.last_insert_rowid()` se captura ANTES de cualquier otra escritura**: poner `rebuild_phones` dentro de
  `add_product` devolvía el rowid de `phones`, y el FK de `sales` fallaba (`test_all_operations` lo detectó).
- **`tauri dev` mantiene bloqueados los archivos de `src-tauri`** mientras recompila (ReplaceFileW EIO / Win32 32/1175):
  detener la app + `cargo` ANTES de editar Rust y relanzar después.
- **Los hooks manuales abren la base sin `init()`** → cada función que escribe debe crear su tabla/columna si falta
  (autosuficiente), o falla con “no such column” (pasó con `search_text` y con `needs_review`).
- **Análisis de texto por marca**: comprobar el ORDEN de las reglas —`canonical_phone` re-detecta la marca del texto y
  pisaba la familia; la solución fue una variante `canonical_phone_forced` + quitar la marca inicial solo cuando es marca real
  (no la línea Redmi/Poco, que debe conservarse).
- **La familia comercial manda sobre la marca escrita** (`Infinix Spark 10C` y `ZTE Spark 10C` = **Tecno Spark 10C**): mapa
  `familyBrands` en `tools/canonical_brands.json`.
- **INCELL es la genérica del taller** → cuenta igual que “sin variante” al agrupar (`variant_key`); OLED/AM/ORIGINAL siguen
  siendo repuestos distintos.
- **Refresco de UI**: una pestaña que carga sus datos en un `useEffect` NO se entera de un guardado hecho en otra →
  patrón `refreshKey` (contador que sube al guardar y va en las dependencias del efecto).
- **Verificación de UI en vivo sin imágenes**: `Add-Type UIAutomationClient` + `EnumWindows`/`FindAll` leen el texto real de la
  ventana (sidebar, KPIs, campos); la accesibilidad de Chromium se habilita tras la primera consulta (repetir el dump si sale corto).
- **`Input` del proyecto acepta `ref`** (React 19) → se puede devolver el foco al campo después de elegir en una lista.
