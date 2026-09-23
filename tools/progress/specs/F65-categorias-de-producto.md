# Spec F65 — Las categorías de PRODUCTO dejan de ser una lista cerrada

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Pedido del dueño (2026-09-23): **«necesito que cuando este inventario pueda registrar nuevas categorías
no esté limitado a crear categorías de productos»**.

---

## 1. Diagnóstico (leído en el código y en la base real)

| Dato | Valor |
|---|---|
| Tabla | `categories` (`id INTEGER PK AUTOINCREMENT`, `name TEXT NOT NULL UNIQUE`, `description TEXT`) |
| Categorías del `init` | Pantalla, Teléfono, Accesorio, Repuesto, Batería, Flex (`INSERT OR IGNORE`, db.rs) |
| Categorías en la copia real | Pantalla (1), Teléfono (2), Accesorio (3), Repuesto (4), Táctil (18), Táctil Tablet (19), Batería (48), Flex (49) |
| Cómo las lee la UI | `api.getCategories()` → **cacheada por sesión** (`cachedCategories` en `db.ts`) |
| Dónde se elige | `ProductForm.tsx` → `Select` con las categorías que le pasa `Inventory.tsx` (se cargan **una vez**, en el mount) |
| Escrituras | **ninguna**: no había comando de alta/baja/edición de categorías (solo el `INSERT OR IGNORE` del arranque y los importadores) |

**El defecto:** el catálogo del local se organiza con categorías que **el local no puede crear**. El
repuesto que llega y no entra en ninguna de las 6 (o 8) existentes se anota en la menos mala, y eso
ensucia los informes (`get_inventory_stats.by_category`, el filtro de Productos, la ficha por modelo).

**Lo que NO se puede romper (leído antes de escribir):**

1. `catalog::PHONE_CATEGORIES = [1, 18, 19]` (**Pantalla, Táctil, Táctil Tablet**) es el padrón de
   teléfonos: `phones.rs` y `loadlist.rs` filtran por **id**, y `catalog::normalize_fields` arma el
   nombre de la ficha con el **nombre** de la categoría («Pantalla Samsung A15»), que el frontend
   recorta con `partLabel()` (`/^(Pantalla|Táctil Tablet|Táctil)\s+/i`).
2. Los productos referencian la categoría por **id** (`products.category_id`, FK con `PRAGMA
   foreign_keys=ON`): renombrar una categoría **no toca ninguna ficha**, y borrar una categoría con
   productos **fallaría** con un error de FK (hay que decir por qué antes, en castellano).
3. `add_product` / `update_product` / `delete_product` son del **dueño** (`require_owner`) y el test
   `test_b3_todos_los_comandos_de_escritura_tienen_el_gate` (commands.rs) exige el gate por lista.

## 2. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** Al registrar un producto se puede **crear una categoría nueva ahí mismo** y queda **elegida** en ese producto, sin salir del formulario | EN VIVO (`verify_categorias_producto.mjs`) |
| 2 | **[must]** La categoría nueva **queda guardada** en la tabla `categories` y **aparece en el filtro** de la pestaña Productos sin reiniciar la app (caché invalidada) | EN VIVO (lectura de la base + filtro abierto) |
| 3 | **[must]** Un nombre que **ya existe** (mayúsculas, acentos y espacios no cuentan) **no crea una gemela**: el backend devuelve la existente (`created: false`) y la UI **avisa y ofrece usarla** | test Rust `test_categories_add_rename_delete` + `category_rules_test.ts` + EN VIVO |
| 4 | **[must]** Nombre **vacío**, **sin ninguna letra ni número** o de **más de 40 caracteres** (contados como caracteres reales) → rechazado por el BACKEND con su mensaje (no solo en la UI) | test Rust + `category_rules_test.ts` |
| 5 | **[must]** **Renombrar** una categoría cambia el nombre del listado y **NO toca los productos** (mismo `category_id`, mismo nombre de ficha guardado) | test Rust + `category_rules_test.ts` + EN VIVO |
| 6 | **[must]** Una categoría **CON productos NO se borra** (fail-closed) y el mensaje dice **cuántos** son; el botón de la pantalla está apagado con ese motivo | test Rust + `categoryDeleteBlock` + EN VIVO |
| 7 | **[must]** Las tres del **PADRÓN DE TELÉFONOS** no se renombran ni se borran (por **ID**, que es el contrato real del motor), pero sí se les puede anotar la descripción. **Ninguna categoría nueva puede caer en los ids 1/18/19** | test Rust (Pantalla; la 12.ª/13.ª categoría recibe 17 y 20) + EN VIVO |
| 8 | **[must]** Las tres **escrituras son del DUEÑO** (`require_owner`) y el test B3 lo exige; la lectura con uso **no** lleva gate, y a la cajera no se le dibuja el botón | `test_b3_todos_los_comandos_de_escritura_tienen_el_gate` + `canManageCategories` |
| 9 | **[must]** Ningún dato existente cambia: la prueba en vivo termina con **las mismas categorías (mismos id, nombre y descripción) y los mismos productos** que al entrar | EN VIVO (antes/después) |
| 10 | **[must]** (2ª vuelta) **Escape cierra el panel, no el diálogo del producto**: una tecla no puede borrar los ~12 campos ya cargados | EN VIVO (chequeo propio: el panel se cierra y el diálogo sigue abierto) |
| 11 | **[must]** (2ª vuelta) El **guardado del producto avisa** si falla (antes el error del backend se tragaba en silencio: la cajera creía la ficha cargada) | `ProductForm.save()` con try/catch + toast |
| 12 | **[should]** (2ª vuelta) El producto nuevo nace en la **categoría del filtro activo** (la pestaña abre en «Pantalla»), no en la primera alfabética | `ProductsTab.onCategoryFilter` → `ProductForm.defaultCategoryId` |

## 3. Implementación

**Backend (`src-tauri/src/`)**

- `db.rs`: `CategoryUsage {id, name, description, products, units, phone_padron}` y
  `CategoryOutcome {category, created}`; `es_categoria_del_padron(id, name)` (id **o** nombre plegado),
  `nombre_de_categoria` (recorte, no vacío, tope 40) y `descripcion_de_categoria` (vacío → NULL, tope 200);
  `get_categories_with_usage`, `add_category`, `rename_category`, `delete_category`.
- `plegar_texto()` pasa a ser la **única** implementación del plegado (la usaban las categorías de
  trabajo de F62 y ahora también las de producto): minúsculas, sin acentos, solo alfanuméricos.
- `commands.rs`: los cuatro comandos; `require_owner` en las tres escrituras. `lib.rs`: registrados.

**Frontend (`src/`)**

- `lib/product-categories.ts` (reglas PURAS, con prueba node): `foldCategory` (= `normPhoneModel`),
  `CATEGORY_NAME_MAX`, `categoryProblem(name, existing, editingId)`, `categoryNameOk`,
  `categoryDeleteBlock`, `categoryUsageLabel`, `categoryOutcomeToast`.
- `db.ts`: `getCategoriesWithUsage`, `addCategory`, `renameCategory`, `deleteCategory` y
  `reloadCategories` — **cada escritura invalida `cachedCategories`**.
- `components/inventory/NewCategoryInline.tsx`: el «+ Nueva categoría» compartido (formulario del
  producto y tarjeta de Ajustes).
- `components/ProductForm.tsx`: el bloque «Categoría» gana el «+»; la categoría creada se suma a la
  lista local y queda elegida (prop `onCategoryChanged` para que el inventario relea).
- `components/inventory/CategoriesCard.tsx`: la tarjeta de Ajustes (dueño) con uso real, corregir,
  borrar y el «+»; `PricesTab` la monta; `Inventory.tsx` relee las categorías al volver de Ajustes.

## 4. Pruebas

| Prueba | Qué fija |
|---|---|
| `cd src-tauri && cargo test --lib` | **146/146** — `test_categories_add_rename_delete` (alta, recorte, duplicado plegado → la misma, vacío/largo, uso real, borrado bloqueado con productos, renombrado sin tocar fichas, padrón por ID + **reserva de los ids 18/19**, borrado de una vacía, id inexistente, totales por categoría, **migración de una base vieja** sin `categories.description`) + B3 |
| `node tools/category_rules_test.ts` | **42/42** — plegado **idéntico al backend**, problemas de nombre (vacío / sin letras / largo por caracteres reales / duplicado / edición de la propia fila), bloqueo de borrado, textos de uso y de resultado |
| `node tools/verify_categorias_producto.mjs` | **35/35 EN VIVO** (CDP) contra una copia: crear desde el formulario, guardado en la base, elegida, duplicado (dos casos), **Escape que cierra sólo el panel**, filtro de Productos, Ajustes, corregir, bloqueo del padrón, bloqueo con productos, eliminar, limpieza |
| `node tools/verify_categoria_nueva.mjs` | **12/12** — regresión de F62 (categorías de trabajo del servicio) después del arreglo de Escape |

## 5. 2ª vuelta adversarial (2 revisores, 2026-09-23)

| Hallazgo | Qué se hizo |
|---|---|
| **(B) Escape en el panel cerraba TODO el formulario del producto** (medido en vivo: se perdían los ~12 campos cargados) | `src/components/use-escape-guard.ts` intercepta Escape en la captura de `window` (antes que el listener de Radix sobre `document`); aplicado también al «+ Nueva categoría» de Servicios (F62), que tenía el mismo defecto latente. Regresión EN VIVO en las dos pruebas |
| **(M) El padrón se definía por ID en el motor y por nombre en F65** + `AUTOINCREMENT` repartía los ids del padrón: en una base chica la 12.ª/13.ª categoría caían en 18/19 → sus fichas entraban al padrón de Modelos, el barrido les ponía stock 0 y quedaban fijas de por vida | `es_categoria_del_padron(id)` (sólo ID, como el motor) + `add_category` **reserva** los ids de `PHONE_CATEGORIES` con id explícito (`MAX(id)+1` salteando 1/18/19); test que crea 14 categorías y verifica que ninguna cae en 18/19 |
| **(M) El guardado del producto fallaba mudo** (invoke rechazado por el gate de dueño → diálogo abierto sin mensaje, ficha creída cargada, reintento = duplicado) | try/catch con `toast.error`, `disabled` sin nombre, aviso propio si falta el nombre y `toast.success` al guardar |
| **(M) El producto nuevo nacía en «Accesorio»** (primera alfabética) mientras la lista está filtrada en «Pantalla» → parecía no guardarse | `ProductsTab` informa su filtro y el formulario arranca en esa categoría |
| **(m)** Plegado distinto al del backend; tope contado en UTF-16; nombre sin letras colisionaba; error rojo al abrir el panel; «Usar …» inútil en Ajustes; «u.» viejos tras cargar la lista; error de lectura invisible; cortes mudos; foco perdido; toast sin cambios; `partLabel` sólo conocía 3 prefijos; la tarjeta afirmaba que los nombres nunca cambian (y «Ordenar los nombres» sí los reescribe) | Todos corregidos (detalle en `AGENTS.md` § F65) |

## 6. Fuera de alcance (a propósito)

- **Fusionar** dos categorías existentes (mover todos los productos de una a otra en un paso): el
  dueño no lo pidió; hoy se hace editando producto por producto (o con la carga de inventario). Con 40
  fichas son 40 diálogos: anotado como candidato a feature.
- **Reescribir el nombre de las fichas** al renombrar una categoría: los nombres guardados son
  canónicos y auditables (`normalize_catalog` los ordena); reescribirlos en caliente tocaría datos
  ya vendidos. La pantalla lo dice con todas las letras (y avisa que «Ordenar los nombres» sí lo hace).

