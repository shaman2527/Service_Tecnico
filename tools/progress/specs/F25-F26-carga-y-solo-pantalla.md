# F25 + F26 — Asistente de carga de inventario y regla «solo Pantalla»

- **Features:** `feature_list.json` id **25** y **26** · **MODO DEV** (sin release, sin push)
- **Copia de trabajo:** `backup/registro_pre_normalizacion_20260915.db`
- **Estado:** implementadas y verificadas (2026-09-16).

## 1. Objetivo

1. **F25:** que el taller pueda **contar la mercancía desde la app**: pegar (o abrir) la lista tal como la tiene escrita,
   ver **qué producto recibe cada cantidad** y corregirlo antes de aplicar, con **respaldo** y movimiento en el historial.
   Reemplaza el flujo manual `tools/load_real_inventory.mjs`.
2. **F26:** que todo el módulo asuma lo que el local realmente trabaja — **pantallas** —: el padrón de teléfonos se arma
   solo con esa categoría y el Inventario abre filtrado en Pantalla.

## 2. Reglas

### 2.1 Lista física (F25)
- Una **marca por línea** (`Samsung`, `Tecno`, `Iphone`…; se aceptan alias) abre una sección; las líneas siguientes son
  modelos de esa marca.
- `modelo (N)` → **N unidades**; sin número → 0 (y el asistente lo avisa).
- `A30/A50` → la MISMA pantalla sirve para los dos teléfonos: se cruza con los dos y se cuenta UNA vez.
- Se ignoran (con aviso del total) las líneas sin marca previa, los contadores sueltos y la basura del pegado.

### 2.2 Cruce
- Solo productos de las categorías de pantalla (`PHONE_CATEGORIES = [1 Pantalla, 18 Táctil, 19 Táctil Tablet]`).
- **Gate de marca**: una línea de la sección Samsung jamás cruza con una ficha Tecno (los productos sin marca sí son
  candidatos).
- Calidad de coincidencia `exacta → prefijo → parcial` (misma función que usa el formulario de servicio); a igualdad,
  gana la ficha **con stock** y después el nombre. Los textos de búsqueda se normalizan con `phone_model_norm` (sin marca,
  sin espacios) porque `match_quality` compara contra esa forma.
- Hasta 6 candidatos por línea para que el operario elija otro a mano; si no hay ninguno, la fila queda **sin producto**
  con el aviso «No encuentro esa pantalla en el catálogo…» (nunca se inventa una ficha).
- Un encabezado de marca solo si el texto **es** una marca conocida; `c/m` (con marco) no es modelo y la conectividad
  (`4G`/`5G`) no se cruza sola; un modelo solo de números vale si trae unidades (`13 (25)` = 25 unidades del iPhone 13).

### 2.3 Aplicar (F25)
- **Respaldo** de la base antes de escribir (`backup/registro_pre_carga_<fecha>.db`, con checkpoint del WAL; si el
  checkpoint falla se aborta con aviso, y el nombre es único).
- `stock = cantidad` por producto elegido + **movimiento** `entrada`/`salida` con el motivo `Carga de inventario`
  (solo si el stock cambia).
- Opción (marcada por defecto) **«las pantallas que no están en la lista quedan en 0»**, con su movimiento (motivo
  `Carga de inventario (no estaba en la lista)`); un stock **negativo** que vuelve a 0 se anota como **entrada**.
  La vista previa **avisa antes** cuántas fichas y unidades quedarían en 0.
- **No toca precios ni compatibilidad** (eso lo cura el taller en Productos) y **exige sesión de dueño** (mismo gate que
  el padrón).
- **Dos líneas al mismo producto: las unidades se SUMAN** (dos maneras de nombrar la misma pantalla no pueden perder
  unidades reales) y el resumen dice cuántas **fichas** se tocan.
- El barrido usa SIEMPRE `PHONE_CATEGORIES`: la categoría no la elige quien llama (un invoke con otro id podía vaciar
  Batería/Flex). Cantidades acotadas a 0..100.000.

### 2.4 «Solo Pantalla» (F26)
- `catalog::PHONE_CATEGORIES = [1 Pantalla, 18 Táctil, 19 Táctil Tablet]` se usa en `rebuild_phones` (qué teléfonos
  existen) y en `phones::phone_index` (qué repuestos/stock cuenta cada teléfono): el padrón y sus números hablan solo de
  pantallas.
- La pestaña **Productos** abre con el filtro de categoría en **Pantalla** (buscando la categoría por nombre, no por id),
  se puede quitar para ver el resto del catálogo y **avisa** que los KPI son de todo el catálogo.

## 3. Fuera de alcance
- Reescritura de la compatibilidad de los productos desde la lista (se conserva la curada).
- Precios (siguen en Ajustes → «Cargar los precios»).

## 4. Criterios de aceptación

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-1 | El parseo entiende secciones, `(N)`, `/`, `c/m`, modelos numéricos y descarta basura (contándola) | tests de `loadlist::tests` (parseo) |
| AC-2 | El cruce respeta el gate de marca, es solo de pantallas, propone alternativas y no inventa fichas | test `test_preview_cruza_con_gate_de_marca_y_solo_pantallas` |
| AC-3 | Dos líneas que caen en la misma ficha **suman** sus unidades (y la vista previa lo dice) | test `test_preview_suma_las_lineas_que_comparten_ficha` + `test_apply_suma_repetidas_y_ignora_invalidas` |
| AC-4 | Aplicar respalda, deja el stock de la lista, anota movimientos y no re-mueve nada si se repite | test `test_apply_carga_stock_con_respaldo_y_movimientos` |
| AC-5 | El barrido avisa antes (fichas y unidades) y solo toca categorías de pantalla | tests `test_preview_avisa_el_barrido_y_el_faltante`, `test_apply_barre_solo_las_categorias_de_pantalla` |
| AC-6 | El asistente se puede usar sin miedo: previsualizar y salir no toca el stock, y al cargar **se ve el resumen** | CDP: `tools/verify_inventory_load.mjs` |
| AC-7 | La escritura exige dueño | `require_owner()` en `apply_inventory_load` (+ gate ya probado en F24) |
| AC-8 | El padrón se arma solo con las categorías de pantalla y el Inventario abre filtrado en Pantalla | test del rebuild (producto de otra categoría no crea teléfono) + CDP |
| AC-9 | Gates del proyecto: `cargo test`, build, lint, security, truth, CLI parallel, revisión adversarial | herramientas |

## 5. Resultado (2026-09-16)

- **Copia de trabajo tras F26:** padrón **1079** teléfonos (antes 1134 con todas las categorías) · **142** «por revisar» ·
  25 marcas · **1083 productos y 6 unidades intactos** (48 fichas están fuera del padrón por no ser pantallas).
  Respaldos: `backup/pre_f26_solo_pantalla_20260916.db` + `backup/backup/registro_pre_telefonos_20260916_074531.db`.
- **Verificación en vivo (CDP):** `tools/verify_inventory_load.mjs` → **18/18**: el Inventario abre en «Pantalla» (con el
  aviso de los KPI), el asistente está en Ajustes, el paso 1 acepta la lista pegada, el cruce muestra 3 líneas / 2 cruzadas /
  1 sin producto con su aviso, las cantidades son editables y tienen etiqueta accesible, **avisa las pantallas que
  quedarían en 0**, cerrar sin aplicar **no toca el stock**, y al cargar **se ve el paso 3** (resumen + respaldo) **sin
  saltar de pestaña**.
- **Regresión F3/F24:** `tools/verify_models_tab.mjs` **23/23** con los conteos nuevos (1079 / 142);
  `tools/verify_phones_edit.mjs` (dueño y cajera) sigue en verde.
- **Gates:** `cargo test` **101/101** · `npm run build` ✓ · `npm run lint` 0 errores · `harness_security` PASS ·
  `harness_truth` PASS · `tools/cli parallel` ✅ · revisión adversarial (2ª vuelta) con hallazgos corregidos.

## 6. Correcciones de la revisión adversarial

### 6.1 Primera vuelta (revisión leyendo código)

| Hallazgo | Corrección |
|---|---|
| Dos líneas al mismo producto perdían unidades (mandaba la primera) | las unidades se **suman** por ficha (vista previa + aplicar) |
| `is_junk_entry` descartaba modelos numéricos reales (`13 (25)`) | solo es basura si además la cantidad es 0 |
| El paso 3 (resumen) nunca se veía: al aplicar se cambiaba de pestaña y el diálogo se desmontaba | `PricesTab` recibe `onRefresh` (refrescar sin desmontar) |
| `c/m 4G/5G` partía mal y daba falsos «exacta» con la conectividad | se quita `c/m`, se colapsa el espacio y se filtran las partes de conectividad |
| El `category_id` lo elegía quien llama → podía barrer Batería/Flex | se ignora el parámetro: siempre `PHONE_CATEGORIES` |
| `brand_header` demasiado laxo («Note» como marca) | exige `is_brand_alias` |
| El barrido del stock no se mostraba antes de aplicar | `zero_count`/`zero_units` en la vista previa + aviso en la UI |
| F26 con solo la categoría 1 perdía 55 teléfonos de Táctil/Táctil Tablet | conjunto de tres categorías |
| Menores: respaldo sin WAL, nombre de respaldo repetido, movimiento del faltante con signo equivocado, cantidad ilegible aplicada sola, sin `aria-label`, KPI vs filtro | corregidos (checkpoint con aviso, nombre único, signo por delta, no se aplica sola, etiquetas accesibles, aviso de KPI) |

### 6.2 Segunda vuelta (medida sobre la lista REAL del local)

Base: `tools/inventario_real.txt` (261 líneas / 713 unidades) contra una copia consistente de la base, ejecutando
`preview_load`/`apply_load` reales solo sobre copias.

| Hallazgo | Corrección |
|---|---|
| **BLOQUEANTE:** el barrido dejaba en 0 fichas que la lista SÍ menciona (79 de 87 fichas / 152 u. estaban escritas en la lista) y anotaba salidas de mercancía que nunca salió | **GATE**: con `zero_missing` y líneas con unidades sin pantalla asignada **no se carga nada** (error con las tres salidas) |
| **BLOQUEANTE:** el gate de marca comparaba la marca CRUDA del producto con la CANÓNICA de la sección (57 fichas «Redmi» / 119 u. invisibles) | se canonicaliza la marca del producto; una ficha sin marca sigue siendo candidata |
| **MAYOR:** contención por subcadena («a3» cruzaba con «a33 bateria»; «15» con «redmi 15c») | `catalog::contains_word` (palabra completa) en `match_quality` y en el nombre de la ficha |
| **MAYOR:** el texto de la línea no era objetivo del cruce (una ficha que se llama igual que la línea quedaba sin candidato) | el texto completo de la línea entra como target |
| **MAYOR:** respaldo potencialmente VIEJO (`execute_batch` descarta la fila `busy` del checkpoint) | respaldo con **`VACUUM INTO`**; si falla, checkpoint leído + aborto si `busy != 0` |
| **MAYOR:** el tope de 100.000 existía solo al aplicar (la vista previa prometía 999.999.999) | tope en el **parseo** (`MAX_QTY`) y la línea queda avisada |
| **MAYOR:** 12 líneas / 31 unidades desaparecían en silencio y el resumen decía «0 líneas no se cargaron» | `skipped` cuenta **líneas**, `unassigned`/`unassigned_units` en el reporte y en el paso 3 |
| **MAYOR:** el aviso del barrido no se recalculaba al editar (desmarcar una línea la dejaba en 0) | **`keep_ids`**: el barrido no toca lo que la vista previa ya había asignado |
| Menores: `rows=[]` + barrido podía vaciar todo el inventario; candidatos 6 → 15; avisos/aria/plural | corregidos |

**Resultado medido (misma base y misma lista, antes → después):** cruzadas **249 → 260**, líneas sin pantalla **12 → 1**,
unidades aplicadas **682 → 712** de 713, fichas que el barrido dejaría en 0 **87 → 47**. La línea que queda sin pantalla es
«6 c/m Accesorios (1)» porque en el catálogo se llama «Pantalla Redmi 6 c/m **Acasonor**» (error de tipeo del catálogo).

**Limitación cerrada por F28** (ver §7): una línea **sin ningún candidato** ya se puede asignar a mano desde el asistente.

## 7. F28 — asignar a mano cualquier pantalla (cierra el módulo)

**Problema real:** la lista escrita a mano y el catálogo no siempre se llaman igual. Caso de la lista del local:
«6 c/m Accesorios (1)» contra la ficha «Pantalla Xiaomi Redmi 6 C / Redmi M Acasonor / Redmi M Accesorios»
(`c/m` = **con marco**). El cruce no puede adivinarlo y, con el barrido marcado, el gate bloqueaba la carga.

**Solución:** cada fila de la vista previa tiene un **buscador de pantallas** («Buscar la pantalla» / «Buscar otra…»)
que consulta el catálogo **solo de las categorías de pantalla** por texto (nombre + marca + modelo + compatibilidad, la
misma búsqueda por tokens del inventario). La ficha elegida entra en la fila como si el cruce la hubiera encontrado.

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-10 | La búsqueda devuelve fichas de pantalla por nombre/marca/modelo en cualquier orden, nunca de otra categoría | test `loadlist::tests::test_buscar_pantallas_a_mano` |
| AC-11 | La búsqueda exige 2+ caracteres y acota el límite (no vuelca medio catálogo) | test `test_buscar_pantallas_a_mano` (una letra → vacío) |
| AC-12 | Lo asignado a mano suma unidades por ficha, entra en `keepIds` y no cuenta como `unassigned` | test `test_buscar_pantallas_a_mano` (aplica 1 u. y comprueba el reporte) |
| AC-13 | En vivo, la línea sin pantalla de la lista real se resuelve desde el asistente y quedan las 713 unidades | `tools/verify_inventory_load_real.mjs` **9/9** |
| AC-14 | El asistente sigue sin tocar el stock si se sale sin aplicar | `verify_inventory_load.mjs` + `verify_inventory_load_real.mjs` |
| AC-15 | La Ayuda del usuario explica el conteo (`c/m` = con marco, buscar a mano, respaldo) | `verify_inventory_load.mjs` (chequeo de la Ayuda) |

**Resultado medido (lista real, 261 líneas / 713 u.):** antes de asignar: 260 cruzadas, 1 sin pantalla, botón
«Cargar 225 pantallas (712 u.)» → después de buscar «acasonor» y asignar: **261 cruzadas, «Cargar 226 pantallas
(713 u.)»** y sin avisos de líneas pendientes. Stock `6 → 6` (no se aplicó).

## 8. F29 — carga rápida y proveedor (cierra el circuito del conteo)

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-16 | El operario puede EXCLUIR una línea: no se carga, no bloquea el barrido y no cuenta como «sin resolver» | test `loadlist::tests::test_apply_excluir_una_linea_no_bloquea_el_barrido` |
| AC-17 | El asistente ofrece «Excluir esas líneas y cargar el resto» cuando el barrido está marcado y quedan líneas sin pantalla | `tools/verify_inventory_load_real.mjs` (con la lista real) |
| AC-18 | La cantidad sin leer bloquea la carga aunque se le asigne una pantalla a mano | test `test_apply_no_carga_con_la_cantidad_sin_leer` |
| AC-19 | El proveedor que trajo la mercancía se anota en cada pantalla cargada; la línea manda sobre el general y no se pisa con vacío | test `test_apply_anota_el_proveedor_que_trajo_la_mercancia` |
| AC-20 | El proveedor se ve y se corrige en la ficha del producto y en la tabla del inventario | comando `set_product_supplier` + `ProductForm` + chip en `ProductsTab`; CDP `verify_inventory_load.mjs` 30/30 |

**Resultado medido (lista real, 261 líneas / 713 u.):** con la línea sin pantalla pendiente el botón dice **712 u.**;
el atajo de carga rápida la excluye (**1 línea excluida (1 u.)**, sigue en 712 u. pero sin bloqueo); re-incluirla y
asignarla a mano la lleva a **713 u. en 226 pantallas**. Nada de esto toca el stock si se sale sin aplicar (`6 → 6`).
