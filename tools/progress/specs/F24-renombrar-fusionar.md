# F24 — Renombrar y fusionar los teléfonos del padrón desde la app

- **Feature:** `feature_list.json` id **24** (priority high) · **MODO DEV** (sin release, sin push)
- **Base:** `backup/registro_pre_normalizacion_20260915.db` (1154 teléfonos · 217 «por revisar» · 26 marcas)
- **Backend previo:** `phones.rs` (`rename_phone`, `add_phone`, `merge_phones`, `get_phones`, `get_phone_detail`)
- **Reglas aprobadas por el usuario (2026-09-16):** «Poco» es **línea propia** (nombre «Poco X3», la clave conserva
  `poco`) y **Honor/Realme mandan** sobre la marca madre («Huawei Honor X6A» → «Honor X6A», «Oppo Realme C35» →
  «Realme C35»), fusionando los pares que así quedan iguales.
- **Estado:** en implementación.

## 1. Objetivo

Que el taller pueda **corregir su lista maestra de teléfonos** desde la app: renombrar los 217 que quedaron sin familia
(el nombre no dice de qué teléfono se trata: «8P», «11T Pro») y **fusionar** los que están escritos distinto, viendo
antes de guardar **cómo queda el nombre**, si **choca** con otro teléfono y **cuántos repuestos conserva**.

## 2. Alcance (IN)

### 2.1 Reglas canónicas (una sola fuente: `tools/canonical_brands.json` + `catalog.rs`)
| Regla | Antes | Después |
|---|---|---|
| **Poco** | `Poco F3` → clave `xiaomi\|f3`; `Mi Poco C40` → nombre «Mi Poco C40»; `Redmi Poco X3` → «Redmi Poco X3» | línea **Poco**: nombre «Poco F3», «Poco C40», «Poco X3» y clave que **conserva** `poco` (`xiaomi\|poco f3`), como el `iPhone` en Apple → «Poco X3» y «Redmi Poco X3» **colisionan** (mismo teléfono) |
| **Honor** | `Huawei Honor X6A` (marca Huawei, clave `huawei\|honor x6a`) y `X6A` (marca Honor, nombre «X6A») | familia `honor` → marca **Honor**, línea Honor: **un solo** teléfono «Honor X6A» (clave `honor\|x6a`) |
| **Realme** | `Oppo Realme C35` (marca Oppo) y `C35` (marca Realme) | familia `realme` → marca **Realme**: un solo «Realme C35» (clave `realme\|c35`) |

### 2.2 Backend
1. **`rename_phone` calcula la clave con la MISMA función que el padrón** (`phone_registry_key` sobre el nombre
   completo escrito) — antes usaba `registry_key(brand, model)` sin quitar la línea, así que la fila renombrada no
   coincidía con la clave del índice y `rebuild_phones` volvía a insertar la clave vieja (**duplicado**). Hallazgo del
   re-verificador de F3.
2. **Comando nuevo de solo lectura `preview_rename_phone(id, brand, line, model)`** → `{ name, key, clash, repuestos,
   stock }`: la UI muestra el nombre resultante y avisa si ya existe otro teléfono con esa clave (para ofrecer fusionar)
   y cuántos repuestos conserva (los alias del inventario son el vínculo).
3. **Gate de escritura en el BACKEND (no solo en la UI):** `Database` gana el flag `owner_unlocked`, que se activa
   cuando el PIN del dueño se verifica (`verify_pin`) y se apaga con `lock_owner`. `rename_phone`, `add_phone` y
   `merge_phones` exigen dueño desbloqueado; **si no hay PIN configurado** la app es de un solo usuario y se permite
   (compatibilidad con instalaciones sin PIN). Un `invoke` desde una sesión de cajera falla con un mensaje claro.
4. **`get_phone_models` (lista del formulario de servicio) lee el PADRÓN** en vez de derivarse de la compatibilidad:
   así el nombre que el taller corrige es el que ve al registrar un servicio (una sola fuente de verdad).
   Mantiene el contrato `PhoneModelRow { label, brand, key, screens, stock, with_stock }`.

### 2.3 UI (`ModelsTab`, solo dueño)
- **Editar / renombrar** por fila: Select de marca (marcas del padrón) + línea + modelo, **vista previa** del nombre
  («Quedará: Poco X3»), aviso si la clave existe («Ya existe «Poco X3». Los repuestos se pueden juntar → Fusionar») y
  el contador de repuestos/stock que conserva.
- **Fusionar** por fila: buscador de teléfonos (por nombre/marca/alias) → elige el que se queda; junta los alias de los
  dos y borra el otro (los repuestos NO se tocan: se relacionan por compatibilidad).
- **Alta** de un teléfono que no está en la lista (marca/línea/modelo) — ya existía el comando, faltaba la UI.
- Contador/atajo **«Revisar»** que lleva al siguiente teléfono «por revisar» sin salir de la tabla.
- Un solo commit por acción + `refreshAll` (los KPIs, la lista y el índice de marcas se recalculan solos).
- Las acciones de escritura se ocultan para cajera (y el backend las rechaza igual).

### 2.4 Datos (copia de trabajo)
- **Respaldo** previo (`tools/snapshot_db.mjs`) y luego `rebuild_phones` con las reglas nuevas sobre la copia de
  trabajo → colapsa los pares Poco/Honor/Realme y normaliza los nombres; reporte con los números antes/después.
- Los 217 «por revisar» que NO se pueden deducir de una regla (p. ej. «8P») quedan para revisarlos a mano desde la app.

## 3. Fuera de alcance
- Asistente de carga de inventario (feature 25) y regla «solo Pantalla» (feature 26).
- Sincronización del texto de `products.compatibility` con los nombres nuevos: se conserva el texto del inventario
  (es el registro de cómo estaba escrito) y el vínculo se mantiene por ALIAS.

## 4. Criterios de aceptación
| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-1 | Reglas: «Poco X3» y «Redmi Poco X3» dan la MISMA clave; «Huawei Honor X6A» = «Honor X6A»; «Oppo Realme C35» = «Realme C35» | tests Rust + consulta al padrón de la copia de trabajo |
| AC-2 | Renombrar un teléfono **no** deja duplicado ni pierde sus repuestos (ficha con categorías y stock correctos) | test Rust (rename → `get_phone_detail` + `rebuild_phones` idempotente) |
| AC-3 | `preview_rename_phone` avisa el choque de clave y los repuestos que conserva | test Rust + UI en vivo |
| AC-4 | Una sesión de cajera NO puede escribir el padrón (UI oculta + backend rechaza) | test Rust del gate + UI en vivo |
| AC-5 | El formulario de servicio ofrece los nombres del padrón (renombrados incluidos) | `get_phone_models` desde la tabla `phones` + verificación en vivo |
| AC-6 | La fusión junta alias y deja un solo teléfono, sin tocar stock ni precios | test Rust + conteos antes/después |
| AC-7 | Gates: `cargo test`, `npm run build`, `npm run lint`, `harness_security`, `harness_truth`, CLI parallel; verificación en vivo por CDP y revisión adversarial | herramientas + scripts |

## 5. Resultado sobre la copia de trabajo (2026-09-16)

| Medición | Antes | Después de las reglas | Tras fusionar «8P» desde la app |
|---|---|---|---|
| Teléfonos del padrón | 1154 | **1135** | **1134** |
| «Por revisar» (sin familia) | 217 | **162** | **161** |
| Marcas | 26 | 26 | 26 |

- **Respaldo previo:** `backup/pre_f24_reglas_20260916.db` (copia consistente, `quick_check ok`) + el que hace el propio hook
  (`backup/backup/registro_pre_telefonos_20260916_004340.db`).
- **Claves viejas que ya no existen** (eran los duplicados escritos distinto): `huawei|honor*` 0 · `oppo|realme*` 0 ·
  `honor|honor*` 0 · `xiaomi|x3` 0 (quedó `xiaomi|poco x3`). **Ningún producto, stock ni precio fue tocado** (solo la tabla `phones`).
- **Poco:** una ficha por modelo y nombre sin «Mi»/«Redmi» delante («Poco C40», «Poco F3», «Poco X3»…), con la clave conservando `poco`.
- **Honor/Realme:** nombres «Honor X6A» / «Realme C35» con su propia marca (ya no hay fichas «Huawei Honor …» ni «Oppo Realme …»).
- **Fusión real hecha desde la UI:** el par «8P» (Tecno) se juntó con «Spark 8P» → una sola ficha «Spark 8P» con alias
  `["8P","Spark 8P","Tecno 8P","Tecno Spark 8P"]` (sus repuestos se siguen encontrando) y el padrón bajó de 1135 a 1134.
  La ficha de prueba que se creó para verificar «Agregar/Renombrar» se borró después (la UI no tiene «borrar teléfono»).

**Verificación en vivo (CDP):**
- `tools/verify_models_tab.mjs` (F3, regresión): **23/23** con los conteos nuevos (1134 / 161).
- `tools/verify_phones_edit.mjs` (dueño): **9/9** — KPIs UI == backend, fichas «Poco X3»/«Honor X6A»/«Realme C35» presentes y
  sin las variantes viejas, el dueño ve «Corregir»/«Agregar teléfono», el diálogo abre con el nombre actual y la **vista previa**
  («Quedará: … repuestos · … u.», «Sin choques») y **Cancelar no escribe**.
- `tools/verify_phones_edit.mjs --cashier`: **6/6** — la cajera ve la lista pero **no** los botones de escritura y el **backend
  rechaza** un `rename_phone` por IPC directo: *«Solo el dueño puede cambiar la lista de modelos: entra con el PIN del dueño.»*
- `tools/verify_phones_write.mjs` (escrituras reales): **fusión** («8P» → «Spark 8P», −1 teléfono), **alta** («Prueba F24» con
  id creado) y **renombrado** («Prueba F24» → «Test F24» con línea) verificados end-to-end.
- Gates: `cargo test` **89/89** · `npm run build` ✓ · `npm run lint` **0 errores** (sin warnings nuevos) · `harness_security`
  PASS · `harness_truth` PASS · `tools/cli parallel` (security+review+build) ✅.

### 5.1 Bug encontrado al comprobar la IDEMPOTENCIA (corregido antes de cerrar)

Al volver a correr el rebuild en seco sobre la copia ya fusionada apareció **«creados 1»**: fusionar dos fichas del
CATÁLOGO no se sostenía. `merge_phones` copiaba los alias del borrado a la sobreviviente, pero las «claves reclamadas»
solo se miran en filas `source='manual'` → la ficha quedaba como `catalogo`, no reclamaba la clave vieja y el catálogo
**volvía a crear** el teléfono que se había juntado (la fusión se deshacía sola en el siguiente guardado de producto).

- **Fix:** `merge_phones` marca la ficha que queda como `source='manual'` + `needs_review=0` (la fusión es una decisión del
  taller, igual que un renombrado) → sus alias reclaman la clave vieja. Test ampliado: tras fusionar se corre
  `rebuild_phones` y se verifica que **sigue habiendo un solo teléfono**, el que se quedó y con los repuestos de los dos.
- **Verificación:** rebuild en seco sobre la copia → **creados 0 · actualizados 0 · sin cambios 1134** (idempotente).
  La fusión «8P» → «Spark 8P» que ya se había hecho a mano se completó marcando esa ficha como manual (mismo cambio).

## 6. Revisión adversarial (subagente independiente) — 1 bloqueante + 2 mayores + 7 menores, corregidos

| # | Sev. | Hallazgo | Fix aplicado |
|---|---|---|---|
| 1 | **BLOQUEANTE** | Si el renombrado **cambia la marca**, la clave vieja no quedaba reclamada (los alias sin marca se canonicalizaban con la marca NUEVA) → el siguiente `rebuild_phones` recreaba la ficha vieja y la renombrada quedaba **sin repuestos**. Reproducido por el revisor (`creados 1`). | `rename_phone` guarda el **nombre y marca+modelo VIEJOS como alias** antes del UPDATE (espejo de `merge_phones`) + test `test_rename_con_cambio_de_marca_no_recrea_la_ficha_vieja`. |
| 2 | MAYOR | El rebuild **pisaba** `brand/line/model/name/aliases` de filas `source='manual'` si su clave aparecía en el mapa, contradiciendo el comentario del paso 3 (borrar los alias mata el vínculo con los repuestos). | `existing` trae `source` y el rebuild **omite las manuales** (solo refresca `needs_review`) + test `test_rebuild_no_pisa_las_filas_manuales`. |
| 3 | MAYOR | `rename_phone`/`merge_phones` no validaban que las filas existieran: el merge con un `keep` inexistente borraba la otra ficha sin guardar sus alias, y el rename fingía guardar. | Los dos devuelven un error claro («ya no está en la lista…») + test `test_rename_y_merge_validan_que_existan`. |
| 4 | MENOR | En el choque, la vista previa mostraba los repuestos como si fueran el resultado del renombrado (son los de una fusión). | Con choque, el badge se oculta y el aviso dice «Fusionados quedarían N repuestos · M u.». |
| 5 | MENOR | `owner_can_edit` era **fail-open** si fallaba la lectura del PIN (el gate de acceso es fail-closed). | `match { Ok(false) => true, Ok(true) => owner_unlocked, Err(_) => false }`. |
| 6 | MENOR | `can_edit_phones` existía pero la UI no lo usaba (solo `role === 'owner'`) → UI y backend podían divergir. | `ModelsTab` consulta el backend y solo muestra los botones si `canWrite` (`role` **y** backend). |
| 7 | MENOR | `get_phone_models` filtraba `products > 0` → un teléfono dado de alta a mano nunca aparecía en el selector del servicio. | Las filas `manual` salen siempre (aunque tengan 0 repuestos) + test `test_alta_manual_aparece_en_la_lista_del_servicio`. De paso la búsqueda del selector ahora también mira la MARCA («nokia» encuentra «110»). |
| 8 | MENOR | Los toast de «Guardado»/«Fusionado» **no se veían nunca**: no había `<Toaster />` montado en la app (defecto global preexistente). | `<Toaster richColors position="top-right" />` en `App.tsx` (ahora sí se ven los avisos de toda la app). |
| 9 | MENOR | El botón de fusionar era un icono sin `aria-label` y con el MISMO icono que «ver repuestos» en la misma fila. | Icono `Merge` + `aria-label` descriptivo. |
| 10 | MENOR | Comentario doc partido en `phone_totals_map`. | Corregido. |
| — | nota | `lock_owner()` no se llama (el flag vive hasta cerrar la app; hoy no es explotable porque no se vuelve a la pantalla de PIN sin reiniciar). | Documentado en el código; queda listo para un futuro botón «Bloquear». |

**Sobre el punto 1 (contexto):** el mismo defecto, por la vía de la FUSIÓN, lo encontré yo antes de cerrar (ver §5.1) y quedó
corregido con el mismo criterio: marcar la ficha resuelta como `manual` para que sus alias reclamen la clave vieja.

**Estado final tras los fixes:** `cargo test` **93/93** (89 + 4 tests nuevos de F24) · build ✓ · lint 0 errores ·
rebuild en seco sobre la copia **creados 0 · sin cambios 1134** · CDP **23/23** (F3) + **9/9** (dueño) + **6/6** (cajera) ·
`can_edit_phones` = true en sesión de dueño y la pestaña lo usa · fusión «8P» → «Spark 8P» con 2 repuestos y 4 alias.
