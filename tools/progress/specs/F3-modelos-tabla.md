# F3 — Pestaña «Modelos»: padrón de teléfonos con marca (filtro + columna) y orden de 3 estados

- **Feature:** `feature_list.json` id **23** (priority high) · **Modo DEV** (sin release, sin push)
- **Base:** `backup/registro_pre_normalizacion_20260915.db` (copia de trabajo: **1154 teléfonos**, **217 por revisar**, 26 marcas, 1083 productos)
- **Backend ya listo (F2):** `phones.rs` → `get_phone_brands`, `get_phones`, `get_phone_detail`; comandos registrados en `lib.rs`
- **Estado del spec:** ✅ **implementado y verificado** (2026-09-16, MODO DEV) — evidencia en §7.

## 1. Objetivo

Que el taller pueda **auditar su lista maestra de teléfonos** desde la app (hoy solo se ve dentro del desplegable del
servicio): cuántos repuestos y cuánto stock tiene cada teléfono, qué marcas hay y **cuáles quedaron «por revisar»**
(sin familia comercial, 217).

## 2. Alcance (IN)

1. **Pestaña «Modelos»** en el módulo Inventario (`Inventory.tsx`), con el padrón `phones` paginado server-side.
2. **Marca como columna y como filtro** (Select con conteos por marca: teléfonos / con repuestos / con stock / por revisar).
3. **Orden de 3 estados por columna**: sin orden → ascendente → descendente → sin orden, en Teléfono, Marca,
   Repuestos, Stock y Estado; iconos `ChevronsUpDown` / `ChevronUp` / `ChevronDown` y `aria-sort`.
4. **Filtros**: búsqueda por tokens (marca/nombre/modelo/alias), `Solo con repuestos`, `Solo con stock`,
   `Por revisar` (los 217), y atajo «Ver solo por revisar» desde los KPIs.
5. **KPIs** del padrón: teléfonos, marcas, con repuestos, con stock, por revisar.
6. **Ficha del teléfono (solo lectura)**: repuestos agrupados por categoría (Pantalla primero) con stock y precio,
   más alias y estado de revisión — usa `get_phone_detail`.
7. **Enlace a la consulta de repuestos** («Repuestos» por fila → pestaña `Por modelo` con ese teléfono cargado).
8. Renombrar la pestaña existente «Por modelo» → **«Repuesto por modelo»** para que no se confunda con «Modelos»
   (solo etiqueta; el valor de tab sigue siendo `modelo`). Ayuda (`Help.tsx`) actualizada en los 2 puntos que la nombran.

## 3. Fuera de alcance (features siguientes)

- **Escribir** el padrón: renombrar los 217, añadir teléfonos, fusionar pares (`Mi Poco X3` vs `Redmi Poco X3`) → **feature 24**.
  En F3 **no hay ningún comando nuevo de escritura**: la ficha solo muestra el botón de edición como referencia deshabilitada/no incluida.
- Asistente de carga de inventario (pegar/abrir lista → cruce → vista previa → aplicar con respaldo) → feature 25.
- Regla «solo Pantalla» (padrón desde categoría Pantalla; Inventario abriendo filtrado en Pantalla) → feature 26.

## 4. Cambios técnicos

### Backend (`src-tauri`)
| Archivo | Cambio |
|---|---|
| `src/phones.rs` | `get_phones` acepta `only_review: bool` (filtra `needs_review=1`). El orden aplica `dir` a la **clave primaria de TODAS** las columnas (`nombre`, `marca`, `repuestos`, `stock`, `revisar`) con desempate por nombre ascendente — se elimina el `items.reverse()` que solo cubría 3 claves y daba vuelta el desempate. `PhoneBrandRow` gana `needs_review: i64`. |
| `src/commands.rs` | `get_phones` pasa el parámetro nuevo. |
| Tests | `test_phone_list_brands_and_detail` extendido: `dir=desc` en `nombre` y `marca`, filtro `only_review`, conteo `needs_review` por marca. |

### Frontend (`src`)
| Archivo | Cambio |
|---|---|
| `types.ts` | `PhoneBrandRow`, `PhoneListRow`, `PhonePage`, `PhoneCategoryBlock`, `PhoneDetail` |
| `db.ts` | `getPhoneBrands()`, `getPhones(brand, search, onlyWithProducts, onlyStock, onlyReview, sort, dir, limit, offset)`, `getPhoneDetail(id)` con mock de respaldo |
| `components/inventory/ModelsTab.tsx` | **nuevo**: KPIs, filtros, tabla con orden de 3 estados, paginación, skeleton y estado vacío |
| `components/inventory/PhoneDetailDialog.tsx` | **nuevo**: ficha por categoría (solo lectura) |
| `components/Inventory.tsx` | pestaña `modelos` + reetiquetado de `modelo` a «Repuesto por modelo» |
| `components/Help.tsx` | nombrar la pestaña nueva y el reetiquetado |

## 5. Criterios de aceptación (verificables)

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-1 | `cargo test` verde (suite actual 81 + los tests nuevos de `phones.rs`) | `cargo test` en `src-tauri` |
| AC-2 | El orden de 3 estados responde en las 5 columnas, tanto asc como desc, con el desempate por nombre estable | test Rust (orden) + clic en vivo en los encabezados (CDP) |
| AC-3 | El filtro «Por revisar» devuelve exactamente los `needs_review=1` (217 en la copia de trabajo) y el filtro de marca cuenta igual que la BD | consulta SQL directa vs UI en vivo |
| AC-4 | La ficha muestra los repuestos agrupados por categoría con stock y precio, y `Pantalla` primero | UI en vivo (CDP) sobre un teléfono con repuestos |
| AC-5 | Ningún comando de escritura nuevo; el padrón no cambia al usar la pestaña | `git diff` de `lib.rs`/`commands.rs` + conteo de teléfonos antes/después |
| AC-6 | `npm run build` y `npm run lint` sin errores nuevos | scripts del proyecto |
| AC-7 | Gates: `harness_security` PASS, `harness_review` sin hallazgos bloqueantes, `harness_truth`, governance `--build-only` | herramientas del harness |

## 6. Riesgos y supuestos

- **R1** El orden se resuelve en memoria en Rust (el padrón son ~1.2k filas): aceptado, mismo patrón que `get_products_page`.
- **R2** `get_phones` recalcula el índice de compatibilidad en cada llamada (1 query de productos + merge): ~1.2k filas, aceptado; si molesta, se cachea más adelante.
- **R3** Supuesto: la pestaña es **visible para todos los roles** (es consulta); las escrituras de la feature 24 sí quedarán solo para el dueño.
- **R4** El nombre comercial mostrado (`name`) es el del padrón; los 217 «por revisar» pueden verse raros — es justamente la señal para revisarlos en F4.

## 7. Evidencia de cumplimiento (2026-09-16)

| AC | Resultado |
|---|---|
| AC-1 | `cd src-tauri && cargo test` → **82 passed / 0 failed** (4 ignorados). Tests nuevos: `phones::tests::test_phone_sort_three_states_and_review_filter`; extendido `test_phone_list_brands_and_detail` (conteo `needs_review` por marca). |
| AC-2 | CDP: `click 1 → aria-sort=ascending`, `click 2 → descending`, `click 3 → none`; `asc[0]=1 desc[0]=4` en Repuestos; Marca `asc=Alcatel… desc=ZTE…`. Contraste SQL: `orden nombre asc/desc` y `orden marca asc/desc` idénticos al `ORDER BY` de SQLite. |
| AC-3 | CDP: KPI Teléfonos 1154, Por revisar 217, «Mostrando 1–50 de **1154**», vista «Por revisar» → **217** y las 50 filas de la página marcadas «POR REVISAR». Contraste SQL↔comandos **12/12** (marcas 26, total 1154, por revisar 217, Samsung 261, Samsung+por revisar 0). |
| AC-4 | CDP: la ficha de «Galaxy A06» abre con marca Samsung, muestra la sección **Pantalla** primero y lista repuestos. |
| AC-5 | `commands.rs` solo cambia la firma de `get_phones` (+`only_review`); `lib.rs` intacto; el KPI de teléfonos y de «por revisar» siguen 1154/217 después de usar la pestaña. |
| AC-6 | `npm run build` ✓ (tsc -b + vite) y `npm run lint` → **0 errores**; sin warnings nuevos en los archivos de la feature (los 2 warnings de react-refresh se eliminaron moviendo la lógica a `src/lib/phoneOrder.ts`). |
| AC-7 | `harness_security` **PASS**, `harness_truth` **PASS** (build pass), `npx tsx tools/cli/index.ts parallel` → security ✅ review ✅ build ✅. `harness_review` **no puede correr** en esta copia (busca `tools/reviewer/parallel-review.ts`, ausente en la v2.0): se sustituyó por el CLI del proyecto + revisión adversarial con subagente (ver nota abajo). |

**Scripts reproducibles:** `node tools/verify_models_tab.mjs` (23/23) y el contraste SQL↔comandos descrito en §5
(copia de la DB con `node:sqlite` + `Runtime.evaluate` contra `window.__TAURI_INTERNALS__.invoke`).
**Lanzar la app para verificar:** `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` +
`REGISTRO_DB="<copia de trabajo>"` + `npx tauri dev`.

## 8. Revisión adversarial (subagente revisor independiente) — hallazgos y fixes

Veredicto inicial **BLOCK** por 1 hallazgo bloqueante. Todo corregido y re-verificado:

| # | Sev. | Hallazgo | Fix aplicado |
|---|---|---|---|
| 1 | **BLOQUEANTE** | `get_phone_detail` armaba las categorías SOLO desde la clave canónica (`idx.get(&key)`) mientras los repuestos/stock venían de la unión con ALIAS: tras **renombrar** (`rename_phone` cambia la clave y conserva los alias del inventario) la ficha salía vacía diciendo «0 repuestos» y «N u. en stock» a la vez — justo el flujo de la feature 24. | `merged_stats` reescrito: la unión (clave + alias) es la ÚNICA fuente de repuestos, stock y categorías (stock por ID de producto, sin doble conteo). La ficha usa `by_cat.keys()`; `get_phone_brands` también pasó a `merged_stats` (antes el índice de marcas mentía igual tras renombrar). Test de regresión **`test_phone_detail_and_brands_survive_rename`** (ficha con categoría/stock tras renombrar + marca con repuestos/stock). |
| 2 | MAYOR | `SELECT p.*, c.name` + `r.get(14)`: `search_text` quedó en cid 14 → `category_name` leía el texto de búsqueda. En `phones.rs` (archivo de la feature) y **pre-existente en 6 sitios de `db.rs`**. | Corregido en `phones.rs` con **lista explícita de columnas** (y assert del test nuevo). Los 6 sitios de `db.rs` quedan registrados como **feature 27** (bug pre-existente, fuera del alcance de F3). |
| 3 | MENOR | El estado vacío sugería «quita la vista …» aun con la vista «Todos»; «Ver los 1 por revisar» no concordaba. | Copy condicionada a la vista activa + singular/plural en el botón. |
| 4 | MENOR | `setPage(0)` en un efecto aparte → una consulta extra con el offset viejo al cambiar filtros. | El reset de página vive en los handlers (`changeSearch/changeBrand/changeVista/toggleOrder`); se eliminó el efecto. |
| 5 | MENOR | `page` sin acotar: si el total bajaba, el pie mostraba «Mostrando 351–300 de 300». | Al recibir la respuesta se vuelve a la última página real (`if (page > last) setPage(last)`). |
| 6 | MENOR | `.catch` silencioso: un fallo real de IPC se mostraba como «Ningún teléfono con esos filtros». | `db.ts` ya no se traga el error dentro de Tauri (en navegador mantiene el mock) y la pestaña muestra un **Alert** con botón «Reintentar». |
| 7 | MENOR (perf) | La «paginación server-side» corta en memoria (carga padrón + índice por llamada). | Aceptado y documentado (1154 filas; mismo patrón que el resto del módulo). Revisar si F5/F6 lo multiplican. |
| 8 | MENOR | `to_lowercase()` en cada comparación y sin quitar acentos. | Claves de orden precalculadas una vez por fila con `catalog::norm` (sin acentos: Ñ/É ordenan con N/E). |
| 9 | MENOR (a11y) | Botón solo-icono sin `aria-label`. | `aria-label` descriptivo añadido. |
| 10 | MENOR (hardening) | `limit`/`offset` sin validar → `start + limit` podía desbordar. | `limit.clamp(0, 1000)` + `saturating_add`. |
| 11 | Nota (roles) | `ModelsTab` visible para cajera (solo lectura, sin gates de rol en el backend del proyecto). | Aceptado (decisión R3). **Para F4:** `rename_phone`/`add_phone`/`merge_phones` ya están registrados y cualquier rol puede invocarlos por IPC → hay que gatear en UI **y** en backend. |

El revisor también detectó que el fixture de tests usaba nombres de DB FIJOS en el directorio del paquete: dos
`cargo test` en paralelo se pisaban y reportaban fallos falsos → los tests de `phones.rs` ahora usan
`std::env::temp_dir()` + `std::process::id()`.

## 9. Re-verificación adversarial de los fixes (segundo subagente) — FIXES OK

Veredicto: **FIXES OK** (ningún fix roto; el bloqueante y el mapeo posicional correctos y **con cobertura real**: el
verificador comprobó contra `git show HEAD:src-tauri/src/phones.rs` que el test nuevo **habría fallado** con el código
viejo, incluso en el assert de `category_name`; y que HEAD además devolvía **stock 0** al renombrar, así que el fix
también arregló el stock de la lista). Cerró con 2 residuales y 3 menores, atendidos así:

| Hallazgo del 2º revisor | Acción |
|---|---|
| MENOR: tras un error real se veía el `Alert` **y** el vacío falso («Ningún teléfono con esos filtros») | `!error` en la condición del estado vacío + pie «No se pudo leer la lista de teléfonos» + paginación deshabilitada |
| MENOR: `getPhoneDetail` seguía tragándose el error dentro de Tauri → la ficha mostraba «Sin repuestos» ante un fallo de IPC o un teléfono borrado | `db.ts` re-lanza en Tauri; el diálogo tiene estado de error (`Alert`) y distingue «sin repuestos» (teléfono existe) de «ese teléfono ya no está en la lista» |
| MENOR: sin desempate final por `id` el orden de filas iguales dependía del escaneo del SELECT (sin `ORDER BY`) | `.then(a.2.id.cmp(&b.2.id))` en los 5 órdenes |
| MENOR: «Limpiar» visible con el 3.º clic del encabezado sin nada que limpiar | **falso positivo**: verificado en vivo (clic 1 → aparece, clic 2 → sigue, clic 3 → desaparece porque `order` vuelve a `null`) |
| HUECO DE TEST: nadie ejercitaba el «sin doble conteo» (repuesto indexado bajo 2 claves) | Test nuevo **`test_merged_stats_no_doble_conteo_por_alias`**: repuesto con compat doble + fusión de teléfonos → `products=2`, `stock=7` (un doble conteo daría 11). Suite **84/84** |
| NOTA PARA F4 (bug real, fuera de F3): `rename_phone` calcula la clave con `registry_key(brand, model)` **sin quitar la línea**, mientras el padrón usa `phone_registry_key` → la fila renombrada no coincide con la clave del índice y `rebuild_phones` re-inserta una fila para la clave vieja (queda el renombrado + un duplicado) | Anotado como requisito de la **feature 24** en `feature_list.json` |

**Estado final de la verificación (contra el código FINAL):** `cargo test` **84/84** · `npm run build` ✓ ·
`npm run lint` 0 errores · CDP en vivo **23/23** + sanidad de Productos/enlace **3/3** · contraste SQL↔comandos **12/12** ·
`harness_security` PASS · `harness_truth` PASS · `tools/cli parallel` (security+review+build) ✅.
