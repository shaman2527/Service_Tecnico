# Spec F41 — Inventario RÁPIDO en cada pestaña (rendimiento medido)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Pedido del dueño (2026-09-17): **«vamos a optimizar la app, que sea rápida cuando entra inventario, cada
pestaña/sección»**.

Estado: **CERRADA** (2026-09-17). Feature **41** del backlog.

---

## 1. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** Entrar a Inventario y cambiar de pestaña muestra los datos en **menos de ~150 ms** (mediana, en frío: saliendo del módulo y volviendo) | `node tools/bench_inventory_ui.mjs` (medianas por pestaña) |
| 2 | **[must]** **Ningún número cambia**: los mismos valores, el mismo orden y los mismos conteos que el cálculo directo | tests Rust `test_catalog_cache_*`, `test_cached_catalog_keeps_the_repair_search_semantics` |
| 3 | **[must]** La memoria del catálogo se invalida ante **cualquier** escritura: de esta conexión **y** de otra (otra ventana de la app, `tools/` con la app abierta) | `test_catalog_cache_is_invalidated_by_writes`, `test_catalog_cache_sees_writes_from_another_connection` |
| 4 | **[must]** La pantalla nunca muestra un número que no sea el de la base | `node tools/verify_inventario_rapido.mjs` (compara la UI contra la BASE leída aparte con `node:sqlite`) |
| 5 | **[must]** La primera carga de cada pestaña y los cambios de filtro/página **no** esperan el rebote de 200 ms (el rebote queda sólo para lo que se escribe) | bench (`entrada`, `movimientos`) + inspección |
| 6 | **[should]** Con tabla en pantalla, una recarga **no la tapa** con esqueleto: se avisa «· actualizando…» (`data-refreshing`) | bench + `verify_models_tab` (que ahora espera ese marcador) |
| 7 | **[should]** El gate de marca del servicio y el filtro de categoría del buscador de repuestos **no cambian** | `node tools/verify_screen_brand_gate.mjs` (23/23) |

## 2. El problema (medido, no supuesto)

En release, sobre una copia de la base real (1126 productos · 1136 teléfonos del padrón):

| Medición (clics del operario → ver datos) | Antes |
|---|---|
| Entrar a Inventario (Productos) | 400 ms |
| Pestaña **Modelos** | **896 ms** |
| Sugerencias del buscador de modelo | 438 ms |
| Tabla de repuestos compatibles | 470 ms |
| Pestaña Movimientos | 234 ms |
| Volver a Productos (misma sesión) | 340 ms |

Backend (test manual `test_manual_inventory_bench`, release): índice de repuestos por teléfono **118 ms**
(recorría el catálogo y volvía a parsear el JSON de `compatibility` de cada producto **en cada llamada**),
totales de los 1135 teléfonos **~140 ms**, KPIs del inventario **113 ms**, catálogo con compatibilidad
parseada **240 ms por consulta** del buscador. Frontend: **toda** consulta (incluida la primera) esperaba
200 ms de rebote, se tapaba con esqueleto lo que ya estaba en pantalla y el combobox de modelo consultaba
el padrón al montarse aunque nadie hubiera escrito nada.

## 3. Diseño

### 3.1 Memoria corta del catálogo (`src-tauri/src/cache.rs`, NUEVO)

Todo lo que el módulo muestra se **deriva de dos tablas** (`products` + `phones`). Se calcula **a lo sumo
una vez por versión de la base**:

| Ranura | Cálculo que evita | La usan |
|---|---|---|
| `phone_index` | `phones::build_index` (118 ms) | pestaña Modelos, ficha del teléfono, preview de renombrado |
| `phone_rows` | `phones::build_rows` (~60 ms: los 1135 teléfonos con sus repuestos/stock/categorías) | pestaña Modelos (lista **y** franja de números: antes cada endpoint lo rehacía) |
| `phone_totals` | derivado de `phone_rows` (`clave -> (repuestos, stock)`) | selector de modelo del servicio (`get_phone_models`) |
| `stats` | `db::build_inventory_stats` (113 ms) | franja de KPIs de Productos |
| `products` | `db::build_parsed_products` (compatibilidad **ya parseada**) | buscador de repuestos (`find_compatible_products` / `find_compatible_screens`) |

**La versión la da SQLite, no un contador propio:** el par
`(SELECT total_changes(), PRAGMA data_version)`.
- `total_changes()` suma 1 por cada fila que **esta** conexión inserta/actualiza/borra.
- `PRAGMA data_version` sube en cada commit de **otra** conexión u otro proceso, y no cambia con las
  escrituras propias.

Un contador a mano se olvida en el próximo write point (esa clase de bug ya pasó en este proyecto); los de
SQLite no se pueden olvidar. **`total_changes()` solo NO alcanza** (es por conexión): sin `data_version`,
con dos ventanas de la app abiertas la memoria servía números viejos indefinidamente (hallazgo BLOQUEANTE de
la revisión adversarial, ver §5).

**Invariantes de implementación**
- **Orden de candados obligatorio: primero `conn`, después `cache`, siempre.** Los comandos no manejan la
  memoria: llaman a métodos de `Database` (`get_phone_brands`, `get_phones_page`, `get_phone_detail`,
  `preview_rename_phone`), así el orden vive en un solo lugar.
- Ningún camino usa una ranura sin verificar la versión (los campos son privados y la única puerta son los
  métodos, que llaman `sync` primero).
- `find_compatible_products` mantiene **la misma semántica**: filtro de categoría aplicado en Rust
  (`p.category_id = N`, también con `NULL` excluido), mismo orden de filas (`ORDER BY p.id` en el builder =
  scan por rowid de antes, y `sort_by` es estable) y el mismo gate de marca.
- `get_phones` usa las filas memorizadas con los mismos filtros; el texto de búsqueda es idéntico
  (`catalog::norm` colapsa lo no alfanumérico en un espacio, así que el JSON crudo de `aliases` y
  `aliases.join(" ")` dan el mismo `haystack`).

### 3.2 Frontend

- **Rebote de 200 ms sólo al escribir** (`searchInput` = lo que se tipea, `search` = lo que se consulta):
  la primera carga y los cambios de filtro/página salen en el acto, y el cambio de página va en el mismo
  paso que el texto para no consultar dos veces. **Movimientos** (desplegables y fechas) no tiene rebote.
- **`loading` vs `refreshing`:** esqueleto sólo cuando no hay nada que mostrar; con tabla en pantalla se
  avisa «· actualizando…» con `data-refreshing="1"` —que también aparece mientras el rebote espera—. Los
  `waitTable` de los verificadores en vivo cuentan ese marcador además de los esqueletos.
- **El combobox de modelo consulta cuando se lo usa** (`open || value !== ''`), y el desplegable se pinta
  según `optionsForQuery` (¿las opciones son de ESTE texto?), no según un estado de carga.
- **Precalentado en tiempo libre** (`requestIdleCallback` con `timeout` y fallback a `setTimeout`): al
  abrir el módulo se adelantan **las dos** llamadas que construyen la memoria del padrón. Son dos y no
  cuatro a propósito: la app tiene **una** conexión y construir la memoria la retiene un instante.

## 4. Resultado (mismas condiciones que la medición inicial)

| Medición | Antes | Después |
|---|---|---|
| Entrar a Inventario (Productos) | 400 ms | **~100 ms** |
| Pestaña **Modelos** | 896 ms | **~120 ms** |
| Repuestos compatibles | 470 ms | **~110 ms** |
| Pestaña Movimientos | 234 ms | **~30 ms** |
| Volver a una pestaña | 340 ms | **~60 ms** |
| Sugerencias del buscador de modelo | 438 ms | ~200 ms¹ |

¹ ~180 ms son el rebote intencional al escribir; la consulta bajó de ~250 ms a ~20 ms.

Backend con memoria caliente: KPIs **0,01 ms** (eran 113), padrón ~2 ms (eran ~250), compatibilidad
~5 ms (eran 240, la primera consulta tras una escritura paga la construcción una vez).

## 5. Revisión adversarial (2 subagentes: backend Rust/SQLite y frontend/pruebas)

**BLOQUEANTE 1 (backend) — la versión no veía las escrituras de OTRA conexión.** `total_changes()` es por
conexión: con dos ventanas de la app abiertas (no hay guard de instancia única) o con una herramienta de
`tools/` cargando inventario mientras la app está abierta, la memoria servía números viejos toda la jornada
(el desplegable «Pantalla a instalar» ofreciendo una pantalla ya instalada, mientras `apply_service_stock`
descontaba otra cosa). **Arreglo:** el par con `PRAGMA data_version`. **Fijado** con
`test_catalog_cache_sees_writes_from_another_connection` (segunda conexión al mismo archivo) y comprobado
en vivo con la app abierta: 1136 → (insert de otro proceso) 1137 → (delete) 1136, la pantalla siempre igual
a la base.

**BLOQUEANTE 2 (frontend) — el desplegable de modelo podía quedar en «Buscando…» para siempre.** `loading`
se ponía en `true` y el `finally` no lo bajaba si el efecto se abortaba (escribir un carácter y borrarlo
dentro de los 180 ms del rebote) mientras la corrida siguiente salía por el `return` temprano
(`loadedFor === query`). **Arreglo:** el desplegable se pinta según `optionsForQuery` y no existe ningún
estado de carga que pueda quedar trabado.

**Mayores/menores aplicados:** precalentado recortado a las dos llamadas que construyen la memoria (el
comentario ahora dice el porqué: contención de la única conexión); `changeSearch` de Modelos sólo guarda lo
escrito (el `setPage(0)` lo hace el rebote: antes, escribir en la página 3 lanzaba una consulta tirada con
el texto viejo); los verificadores nuevos esperan **condiciones** (no relojes), **abortan si falta
`REGISTRO_DB`** (leerían otro archivo que el de la app) y borran su ficha de prueba en un `finally`;
`verify_models_tab.mjs` **recarga la SPA** al empezar (si la app ya estaba en Inventario → Modelos, el clic
no remonta la pestaña y los KPIs quedaban con los números de la corrida anterior — un «KPI viejo» que
parecía un bug del producto y era del script).

**Descartado con evidencia (no eran defectos):** `INSERT OR IGNORE` que no inserta (no suma, pero tampoco
cambia datos); `ROLLBACK` (invalida de más: dirección segura); `VACUUM`/DDL (no suman, y `init()` corre
antes de que la memoria exista); escrituras por otro `Database` del mismo proceso (no existe); orden y
filtro de `find_compatible_products` (equivalente).

## 6. Fuera de alcance (decisión, no olvido)

**Dejar las pestañas MONTADAS entre cambios (keep-alive)** para conservar búsqueda, filtros y página. Con la
memoria del backend, volver a una pestaña ya visitada cuesta ~60 ms: lo que se pierde es **estado**, no
velocidad. Y montar varias pestañas a la vez obliga a reescribir **todos** los verificadores en vivo (cuentan
filas con `document.querySelectorAll('table tbody tr')` en todo el documento y pasarían a contar también las
tablas ocultas). Se evalúa aparte si el local pide conservar los filtros.

## 7. Pruebas y evidencia

- `cd src-tauri && cargo test --release --lib` → **132/132** (7 ignorados). Tests nuevos:
  `test_catalog_cache_is_invalidated_by_writes`, `test_catalog_cache_sees_writes_from_another_connection`,
  `test_cached_catalog_keeps_the_repair_search_semantics`.
- `test_manual_inventory_bench` (ignorado, manual): mide crudo vs memorizado y frío vs caliente sobre
  `REGISTRO_BENCH_DB`.
- **EN VIVO**: `tools/verify_inventario_rapido.mjs` **10/10** · `tools/verify_models_tab.mjs` **23/23** ·
  `tools/verify_screen_brand_gate.mjs` **23/23** · `tools/bench_inventory_ui.mjs` (medianas por pestaña).
- `tsc -b` 0 · `oxlint` 0 errores · `npm run build` ✓ · `cargo build --release` ✓ · `harness_security` PASS ·
  `harness_truth` PASS.
- Todos los `*_test.ts` en verde: pos_cuadre 66/66, receipt_acuerdo 52/52, ficha 66/66, service_guide 35/35,
  reminders 38/38, refund_math 24/24, payment_math 595/595, queue 61/61, fechas locales 17/17,
  method_picker 31/31.

## 8. Hallazgo aparte (NO de esta feature, queda anotado)

`delete_product` **no limpia el padrón**: `rebuild_phones` sólo inserta/actualiza por clave, así que borrar
un producto deja su teléfono en Modelos con 0 repuestos. La verificación de F41 compara contra la base (no
contra «el número de antes») justamente por eso, y lo deja dicho en pantalla.
