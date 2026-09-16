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

## Lecciones 2026-09-15/16 (noche) — F3 pestaña «Modelos» (padrón de teléfonos)
- **Un solo sentido por columna, con desempate estable**: `get_phones` aplicaba `dir` solo a `repuestos|stock|revisar` y
  hacía `items.reverse()`, que además invertía el desempate por nombre. Ahora `dir` manda sobre la CLAVE de TODAS las
  columnas y el nombre queda siempre como desempate ascendente (`dir_ord(...).then(by_name)`), con las claves de orden
  precalculadas una vez por fila con `catalog::norm` (ignora acentos: Ñ/É ordenan con N/E).
- **UN solo origen de verdad por dato derivado**: la ficha del teléfono sacaba las CATEGORÍAS de la clave canónica y los
  REPUESTOS/STOCK de la unión clave+alias → tras renombrar (la clave cambia, los alias del inventario quedan) la ficha
  salía vacía y a la vez decía «N u. en stock» (bloqueante detectado en revisión adversarial). Regla: si un cálculo une
  alias, TODO lo que dependa de él (repuestos, stock, categorías, contadores por marca) sale del MISMO resultado
  (`merged_stats`). Lo cubre el test `test_phone_detail_and_brands_survive_rename`.
- **CDP: `innerText` devuelve el texto RENDERIZADO**, así que un encabezado con la clase `uppercase` se lee
  «REPUESTOS», no «Repuestos». Al verificar por CDP, comparar etiquetas en minúsculas (`toLowerCase()`), nunca con
  `startsWith('Repuestos')` (falla en silencio y devuelve `undefined`).
- **CDP: esperar a que la tabla termine de cargar** antes de leerla. Las tablas muestran filas esqueleto
  (`animate-pulse`) mientras consultan: un helper `waitTable()` que sondea hasta que no haya esqueletos y exista
  «Mostrando …» evita leer filas fantasma y totales viejos (falso FAIL).
- **CDP: `Runtime.evaluate` necesita `awaitPromise: true`** para evaluar expresiones async (`invoke(...).then(...)`,
  `(async () => {…})()`); sin él Chrome devuelve el objeto `Promise` serializado como `{}` y el script «falla» mudo.
  `tools/cdp_driver.mjs` ya lo envía.
- **La pestaña conserva su estado entre corridas de verificación** (React no se remonta): el script de verificación
  debe limpiar filtros/búsqueda al empezar (`Limpiar` + borrar el buscador) o los checks leen el filtro anterior.
- **`aria-sort` va en el `<th>`, no en el botón**: el botón interno lleva el clic y el icono; el `th` expone
  `ascending|descending|none` — así el orden de 3 estados es verificable sin leer el DOM a ciegas.
- **Las pruebas de Rust del padrón deben crear sus propios `needs_review`**: el flag lo calcula `rebuild_phones`
  (línea vacía + nombre que empieza con dígito o ≤ 4 caracteres, ej. ZTE `A3`). Un «Tecno Spark 20» o un teléfono
  agregado con `add_phone` NO quedan por revisar: asumirlo hace fallar el test.
- **Los fixtures de test no pueden usar nombres de archivo FIJOS** en el directorio del paquete: dos `cargo test` en
  paralelo comparten el nombre, se pisan y reportan fallos falsos. Usar `std::env::temp_dir()` + `std::process::id()`.
- **`SELECT p.*, c.name` con mapeo posicional vuelve a morder**: `products.search_text` quedó en cid 14 por un
  ALTER TABLE → `category_name: r.get(14)` lee el texto de búsqueda (bug visible en la columna «Categoría» de Productos,
  registrado como feature 27). En `phones.rs` quedó corregido con lista EXPLÍCITA de columnas.
- **`vite dev` MUERE con `EBUSY: resource busy or locked` si se edita un `.tsx` mientras `tauri dev` está corriendo**: el
  editor/agente guarda en `src/components/**/.<archivo>.<pid>.<hash>.tmpdir/<archivo>.tmp` y el watcher de Vite intenta
  vigilar ese temporal → `FSWatcher` emite `error` y el proceso termina (con él `tauri dev` y la app: «beforeDevCommand
  terminated with a non-zero status code»). Fix en `vite.config.ts`: `server.watch.ignored` incluye
  `'**/.*.tmpdir/**'`, `'**/*.tmp'`, `'**/.*.tmp'`. Aun así, la regla práctica: **editar el frontend antes de lanzar la
  app, o relanzarla después**.
- **Si `tauri dev` no puede reemplazar `target\debug\registro.exe` («Acceso denegado», os error 5)** es que quedó una
  instancia ANTERIOR viva (los hijos de un `tauri dev` matado sobreviven): matar `registro.exe` + los dos `cargo run`
  antes de relanzar; si no, se verifica en vivo contra el binario VIEJO sin darse cuenta.
- **`harness_*` necesita `tools/config/` como DIRECTORIO** (además de `spec/` y `governance/`): con la config en
  `tools/config.ts` el detector responde «No Harness ENGINEERING copy found». Se agregó `tools/config/harness.json`
  (marcador + rutas) y desde ahí funcionan `harness_security`/`harness_truth`/`harness_spec`/`harness_freeze`.
  **CUIDADO: `harness_learn` REESCRIBE `tools/progress/patterns.md`** con su formato auto-consolidado (borró este archivo
  una vez; se recuperó con `git checkout --`). Para lecciones del proyecto, editar este archivo a mano.
- **`harness_review` no puede correr en esta copia** (espera `tools/reviewer/parallel-review.ts`, que la v2.0 no trae):
  el reemplazo es `npx tsx tools/cli/index.ts parallel` (security + review + build) más una revisión adversarial con
  subagentes (esa revisión encontró el bloqueante de la ficha y 10 hallazgos más).

## Lecciones 2026-09-16 — F24 (renombrar/fusionar la lista de teléfonos)
- **UNA sola forma de calcular la clave**: `rename_phone` usaba `registry_key(brand, model)` (sin quitar la línea) mientras
  el padrón usa `phone_registry_key`. Resultado: la fila renombrada no coincidía con el catálogo y `rebuild_phones` volvía
  a crear la fila del nombre viejo (**duplicado**). Ahora todo pasa por `resolve_naming` (real_name + phone_registry_key).
- **Un teléfono renombrado pedía volver**: aunque la clave fuera correcta, el catálogo sigue teniendo el texto viejo en
  `products.compatibility` → el rebuild recreaba la fila. Solución: las **claves reclamadas por los ALIAS de las filas
  `source='manual'` no se resucitan** (`rebuild_phones`), y al fusionar el teléfono borrado aporta su marca+modelo como
  alias. Los repuestos NO se pierden: el vínculo es el alias (`merged_stats` une clave + alias).
- **`Edit`/`Write` pueden fallar con `ReplaceFileW EIO (Win32 1175)`** en archivos que otro proceso mira (p. ej. `ESTADO.md`
  con la app/harness corriendo). Workaround: escribir con `[System.IO.File]::WriteAllText` desde un script `pwsh` en `%TEMP%`.
  Con los `.rs` pasa igual si `tauri dev`/`cargo` está corriendo: **parar la app antes de editar Rust**.
- **La «línea» solo existe donde hay regla**: para marcas con línea (Samsung/Motorola/Apple/Xiaomi/Honor/Realme) el diálogo
  separa línea y modelo; para el resto (p. ej. Genérico) la línea escrita termina dentro del modelo («Test F24»). Es
  esperado: `real_name` no inventa líneas.
- **Gate de escritura útil en un backend sin sesiones**: un `AtomicBool` en `Database` que activa `verify_pin` con el PIN
  correcto (`owner_can_edit`/`require_owner`), y `Ok(())` cuando NO hay PIN configurado (instalación de un solo usuario).
  Los comandos de escritura del padrón lo exigen: la UI esconde los botones **y** el `invoke` directo falla.
  **Fail-closed**: si no se puede leer el estado del PIN, NO se permite escribir (misma regla que el gate de acceso).
- **«Resolver» una ficha del padrón es marcarla `manual`**: renombrar **y también fusionar** tienen que dejarla en
  `source='manual'` y guardar el nombre/marca+modelo VIEJOS (o los del borrado) como **alias**. Si no, el catálogo
  —que sigue teniendo el texto viejo en `products.compatibility`— **recrea la ficha** en el siguiente guardado de
  producto y la corrección se deshace. Y si el renombrado cambia la MARCA, el alias pelado se canonicaliza con la marca
  nueva y tampoco reclama la clave vieja: por eso hay que guardar `marca vieja + modelo`.
- **El rebuild no puede pisar las filas manuales**: `rebuild_phones` actualizaba brand/line/model/name/**aliases** de
  cualquier fila cuya clave apareciera en el mapa (incluidas las `manual`), borrando el único vínculo con los repuestos.
  Ahora trae `source` y las omite (solo refresca `needs_review`).
- **Los toast no se veían en NINGUNA pantalla**: el proyecto tenía `sonner` + `src/components/ui/sonner.tsx` pero
  **no había `<Toaster />` montado** en `App.tsx`. Montado con `richColors position="top-right"` (lección: antes de
  confiar en un `toast.success(...)` como confirmación, verificar que el Toaster esté montado).
- **El nombre comercial del padrón no repite la marca**: para marcas sin línea el `name` es solo el modelo («110»).
  Las búsquedas/selectores tienen que mirar **marca + nombre** (y el `ModelCombobox` muestra la marca al lado cuando el
  nombre no la incluye).

## Lecciones 2026-09-16 — F25 (asistente de carga de inventario) y F26 (regla «solo Pantalla»)
- **Cargar una lista física**: el parser reconoce la **marca por línea** como encabezado (solo si el texto ES una marca o
  su alias, sin dígitos y con ≤2 palabras), `modelo (N)` = unidades y `/` = modelos que comparten la pantalla. El cruce es
  **solo de la categoría Pantalla** (`PHONE_CATEGORY = 1`) con **gate de marca** — una línea Samsung no puede aterrizar en
  una ficha Tecno — y hasta 6 alternativas por línea para elegir a mano. Lo que no se entiende se cuenta (`skipped`), y lo
  que no matchea **se avisa**: nunca se inventa una ficha.
- **Aplicar SIEMPRE con respaldo primero** (`backup/registro_pre_carga_<fecha>.db` + `PRAGMA wal_checkpoint(TRUNCATE)`) y
  anotando el movimiento (`Carga de inventario`). El `zero_missing` (las pantallas que no están en la lista quedan en 0) es
  la semántica correcta cuando la lista es TODO el inventario físico — tiene que ser una opción visible y marcada.
- **Defensivo en el backend**: aunque la UI solo ofrezca candidatos válidos, `apply_load` valida que cada `product_id`
  **exista y sea de la categoría** que se está cargando, ignora líneas repetidas del mismo producto y **acota** la cantidad
  (100.000). Un `invoke` a mano no puede mover stock de otra categoría ni dejar el stock en las nubes.
- **Regla «solo Pantalla»**: la categoría del padrón vive en UNA constante (`catalog::PHONE_CATEGORY`) usada por
  `rebuild_phones` **y** por `phones::phone_index` (si solo se filtrara uno, los números de la tabla mentirían). En la UI, el
  filtro por defecto se resuelve **por nombre de categoría** («Pantalla»), no por id.
- **CDP: `scrollIntoView` antes de cada clic.** Un botón fuera de la pantalla tiene coordenadas que caen afuera de la
  ventana y el clic no llega: parecía «el botón no abre nada». `tools/cdp_driver.mjs` lo hace ahora (y descarta el clic si
  el elemento quedó fuera del viewport).
- **CDP: pegar texto multilínea se hace con `Input.insertText`**, no con eventos de teclado (un `\n` no viaja como tecla y
  el textarea quedaba con una sola línea → el parser veía «0 líneas»). `cdp_driver.mjs` expone `insertText`.
- **Un `<Toaster />` montado es requisito para que `toast.success()` se vea** (ver lección de F24).

### Lecciones de la revisión adversarial de F25/F26 (2ª vuelta, misma jornada)
- **Cuando dos líneas de una lista describen el MISMO producto, las unidades se SUMAN.** «Manda la primera» es una pérdida
  silenciosa de inventario real («13C (6)» + «Redmi 13C (12)» → se cargaban 6 en vez de 18). Vale para cualquier importador:
  agregar por clave destino, no fila por fila, y mostrar en la vista previa **el total por destino**, no el de la línea.
- **La categoría de un barrido masivo NUNCA la elige quien llama.** `apply_load` ignoraba que la UI mandara `categoryId`:
  un invoke a mano con `48` (Batería) **vaciaba la categoría entera**. La regla del local va en el backend
  (`catalog::PHONE_CATEGORIES`) y el parámetro desaparece del comando (si no se usa, mejor que no exista: una firma con un
  argumento ignorado invita a creer que sirve).
- **Un `match_quality` que espera texto normalizado no matchea nada si le llega el texto crudo.** Los `targets` del cruce
  se armaban como «Samsung A30» y `match_quality` compara contra `phone_model_norm` («a30»): **0 coincidencias** sin error
  visible (el síntoma era «no encuentra ninguna pantalla», no un crash). Normalizar en el borde y documentarlo en la firma.
- **Un `if` de "basura" demasiado amplio borra datos buenos**: `is_junk_entry` («solo dígitos») descartaba `13 (25)` =
  25 iPhone 13. La condición correcta era «basura **y** cantidad 0»: la cantidad es la señal de que la línea es real.
- **Cambiar de pestaña al terminar una acción desmonta el diálogo y mata el resumen.** El paso «Listo» del asistente no se
  veía nunca porque el padre hacía `refreshAll(); setTab('productos')`. Separar **refrescar** (`onRefresh`) de **navegar**
  (`onChanged`) — y verificar el paso final, no solo el feliz del medio.
- **`tauri dev` reinicia la app cuando cambia CUALQUIER archivo bajo `src-tauri/`** (incluidos `tests/` de prueba que crea
  un agente/script): la ventana nueva invalida el WebSocket de CDP y una verificación en curso se queda esperando para
  siempre. Con `Runtime.evaluate` a 10 s el síntoma era `timeout` con la app sana; ahora el driver usa 25 s + un reintento,
  y **no se deja nada escribiendo archivos mientras se verifica**.
- **Un `stock` negativo que vuelve a 0 es una ENTRADA**, no una salida: el movimiento debe derivarse del **delta** con
  signo (`0 - (-2) = +2`), no de la resta ciega `viejo - nuevo`.
- **La regla del negocio se prueba con el caso que la rompe**: la primera versión de F26 filtró solo `category_id = 1` y
  perdió 55 teléfonos que únicamente tenían repuestos de Táctil/Táctil Tablet. El conjunto de categorías
  (`[1, 18, 19]`) se descubrió contando teléfonos antes/después, no leyendo el código.

### Lecciones de la 2ª vuelta (medidas sobre la lista real del local)

- **Un barrido masivo del stock es la operación más peligrosa de la app: hay que BLOQUEARLA cuando la lista no está
  resuelta.** Si la lista es «todo el inventario» y una línea con unidades quedó sin destino, su ficha real termina en 0
  por no haber cruzado el nombre (medido: **79 de 87 fichas barridas estaban escritas en la lista**, 152 unidades). El
  gate correcto no es avisar: es **no cargar** y decir en el error las tres salidas (asignar, corregir el nombre en el
  catálogo, desmarcar el barrido).
- **El barrido tiene que respetar lo que la vista previa YA resolvió** (`keep_ids`): si el operario le cambia el producto
  a una línea, la ficha anterior no puede terminar en 0 — es mercancía que está en el mostrador.
- **Comparar una marca CRUDA contra una CANÓNICA rompe un gate silenciosamente.** El producto tenía `brand='Redmi'` y la
  sección se canonicalizaba a `Xiaomi`: **57 fichas (119 unidades) quedaron fuera del cruce** sin ningún error. Regla:
  canonicalizar LOS DOS lados (y dejar pasar lo que no tiene marca en vez de descartarlo).
- **La contención por subcadena infla unidades en la ficha de OTRO teléfono**: «a33 bateria» contenía «a3» → el A33
  cargaba una pantalla del **A3**; «15» cruzaba con «Redmi 15C». La contención tiene que ser por **palabra completa**
  (`catalog::contains_word`) — y como `norm()` conserva los espacios, la comparación por palabra es posible.
- **Un target incompleto deja fichas inalcanzables**: el cruce solo probaba las partes (`A17 4G`) y nunca el texto de la
  línea, así que la ficha que se llama IGUAL que la línea (`A17 c/m 4G/5G`) no era candidata — y el barrido se la llevaba.
  Agregar el texto completo como objetivo es una línea de código.
- **`PRAGMA wal_checkpoint(TRUNCATE)` con `execute_batch` NO informa si quedó ocupado** (devuelve `busy` como FILA): el
  respaldo parecía válido y le faltaba lo que estaba en el WAL. Para respaldar de verdad: **`VACUUM INTO '<dest>'`** (foto
  consistente que incluye el WAL, la misma técnica de `tools/snapshot_db.mjs`) y, como respaldo, leer el resultado del
  checkpoint y abortar si `busy != 0`.
- **Un límite que solo existe en una capa miente en las otras**: el tope de 100.000 estaba solo al aplicar, así que la
  vista previa y el botón prometían 999.999.999 y el reporte decía 100.000. Los límites se aplican en el **parseo** (una
  sola vez) y se avisan.
- **Un contador ambiguo en el resumen es un bug de confianza**: `skipped` contaba FICHAS y la UI hablaba de «líneas». Si
  el resumen no distingue líneas de unidades, el operario cree que cargó todo cuando no fue así (medido: 12 líneas / 31
  unidades desaparecidas con «0 líneas no se cargaron»).
- **Antes de dar por buena una corrección hay que MEDIR con la lista real** (`test_manual_preview_real_list`, hook
  `#[ignore]` sobre una copia): los números antes/después (249→260 cruzadas, 682→712 unidades, 87→47 barridas) son la
  única prueba de que los arreglos sirven para el local y no solo para el fixture.
- **Los scripts de verificación tienen que arrancar de un estado limpio**: `verify_*` ahora recargan la SPA antes de
  empezar (si no, quedaban en modo cajera de una corrida previa y «no encontraban» el menú), y `--cashier` exige app
  recién arrancada porque `owner_unlocked` es estado del PROCESO, no de la sesión de UI.
- **Los conteos esperados de un script son la expectativa independiente**: `verify_models_tab.mjs` los tiene escritos
  (1079/142, pisables por `EXPECT_PHONES`/`EXPECT_REVIEW`); si cambian los datos hay que actualizarlos a mano, que es
  justamente lo que hace que el script detecte cambios que nadie pidió.
