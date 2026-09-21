# Spec F50–F53 — Inventario: «lo que uso», relación modelo↔pantalla, orden por columnas y fin de los duplicados

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.

Pedido del dueño (2026-09-20), textual:

> «El cliente dice: muchos modelos está bien, pero él no lo usa todo; me dice para aplicar un check con su número de cada producto o modelo que él pueda seleccionar — esos son los productos o modelos que le van a aparecer cuando está haciendo un registro de un nuevo servicio, para que no le aparezca ese poco de modelos que no usa. Así sea más rápida la búsqueda. Aparte de eso dice que existen varios duplicados de modelos, y esos mismos modelos tienen que tener referencia: qué pantalla va a seleccionar para ese modelo. Y me pide que también en Producto tenga el ordenamiento por columnas. Cuando yo busco un Samsung A70 me sale también A705 — ya este viene siendo otro modelo de tlf, debería salir una sola por modelo: evitar eso. Si no existe ese modelo se agrega como un registro nuevo, modelo con su variante y compatibilidades. Debe ser en nombre, nada que se cambia; se quita el problema. Usá buena práctica, que sea todo profesional.»

**Sus respuestas al diseño:** el check va **en los dos** (producto y modelo), con **un número** para identificarlos rápido y que la relación modelo de teléfono ↔ modelo de pantalla ↔ compatibilidad sea evidente; en el registro de servicio debe salir **solo el modelo con su marca, uno solo, sin «A70 → A705»**; `A70 A705` se parte en **dos teléfonos reales** (A70 y A705) con la pantalla **compatible con ambos**; los duplicados se limpian con **asistente con vista previa**. Y el **inventario tiene que seguir descontando por servicio**, como hoy.

---

## 1. Diagnóstico (leído en el código, no supuesto)

| # | Hecho | Dónde |
|---|---|---|
| D1 | La **variante** (INCELL / OLED / ORIGINAL / CON MARCO / AM) **ya existe** como columna del producto, pero va **pegada al nombre** y no se muestra ni se filtra aparte | `products.variant`; `ProductsTab` |
| D2 | El **padrón** arma **una ficha por texto de compatibilidad**: cada grafía distinta («Samsung A70 A705», «Samsung A70 A705 AM») = un teléfono distinto, con sus alias y su «por revisar» | `catalog::phone_registry_key`, tabla `phones` |
| D3 | El **formulario de servicio** ofrece el padrón (`get_phone_models`), ocultando ya los teléfonos sin repuesto — por eso aparecen `A70 A705` **y** `A70 A705 AM`, y no hay forma de esconder lo que el local no usa | `db.rs::get_phone_models`, `ModelCombobox` |
| D4 | **No existe** ningún concepto de «esto lo uso» (ni en `products` ni en `phones`) | esquema actual |
| D5 | **Orden por columnas: no.** Hay un desplegable (`nombre/stock/marca/reciente`) y el endpoint ya acepta `sort` | `ProductsTab` + `db.rs::get_products_page` |
| D6 | El **descuento de inventario al entregar** es determinista por `services.screen_product_id` (o el matching legacy si falta) y **funciona**: es el invariante que este trabajo NO puede romper | `db.rs::apply_service_stock` |
| D7 | Ya existen herramientas por teléfono (**renombrar**, **juntar**, **agregar**) y un asistente de **duplicados de PRODUCTOS** con vista previa | F24 (`PhoneEditDialog`, `merge_phones`) y `DuplicatesDialog` |

## 2. Diseño

### F50 — «En uso» + CÓDIGO de referencia (para identificar rápido)
- **Columnas nuevas** (migración idempotente, **al final** del orden físico — regla del proyecto):
  `products.in_use INTEGER DEFAULT 1` · `products.code TEXT` · `phones.in_use INTEGER DEFAULT 0` · `phones.code TEXT` · `phones.default_product_id INTEGER`.
- **Códigos cortos y hablados**: `M-007` para el teléfono y `P-0142` para la pantalla (secuenciales, visibles y editables). En la fila del producto se muestra **su modelo con su código** (`M-007 Samsung A70`), y en la ficha del modelo se listan sus pantallas con el suyo: así la relación **modelo ↔ pantalla ↔ compatibilidad** se lee de un vistazo y se puede dictar/teclear por número.
- **Seed sensato:** al migrar, los teléfonos/pantallas **con stock** quedan en uso (`in_use=1`) y el resto queda apagado; el dueño prende lo que quiera. Así la búsqueda se acorta el primer día sin obligarlo a marcar cientos de fichas.
- **Acciones rápidas:** tilde por fila + `Usar todo el modelo` / `Apagar todo el modelo` (una sola llamada, transaccional).
- **El formulario de servicio** ofrece **solo lo que está en uso** (`get_phone_models(inUseOnly)`) con un interruptor **«Ver todos»**; se puede buscar por **código** además de por nombre.

> **DECISIÓN REVISADA AL IMPLEMENTAR (F50, 2026-09-20) — la lista de PANTALLAS del modelo NO se filtra por «en uso».**
> La spec decía «al elegir la pantalla exacta solo se ofrecen las pantallas **en uso** del modelo». Se implementó **solo el filtro del MODELO**: apagar una ficha del catálogo no puede dejar al taller sin poder elegir el repuesto que tiene que instalar (y `in_use` decide qué se **ofrece**, nunca qué se **descuenta** — lo fija el test `test_in_use_never_stops_the_inventory_deduction`). Verificado en vivo en `tools/verify_uso_modelos.mjs`: la cantidad de pantallas ofrecidas para un modelo apagado coincide con `find_compatible_products` del backend.

### F51 — Ordenamiento por COLUMNAS en Productos (y en Modelos)
- Clic en el encabezado ordena **asc → desc → sin orden** (flecha visible, `aria-sort`), server-side (el endpoint ya ordena; se amplían las claves: nombre, marca, modelo, **variante**, categoría, precio, costo, stock, mín, **en uso**).
- Se recuerda la última orden en `localStorage`. La paginación se resetea al cambiar de columna.
- **Sin riesgo:** no toca datos.

### F52 — Una fila por MODELO con sus variantes adentro (Productos)
- Vista nueva **«Por modelo»** (junto a la lista plana, que se conserva para trabajar ficha por ficha): **una fila por teléfono** con `M-007 · Samsung A70` → nº de pantallas, **chips de variante** que tiene (INCELL / OLED / ORIGINAL / CON MARCO), stock total, rango de precios, y **su check «en uso»** y su **pantalla de referencia**.
- Se despliega y muestra sus pantallas con **código, variante, precio, costo, stock y su propio check**; la **variante pasa a ser columna + filtro** en la lista plana (deja de ir pegada al nombre).
- Barra de búsqueda: escribe `a70` → **un solo resultado de modelo** (con su marca); las variantes aparecen **adentro**, no como modelos distintos.

### F53 — Un solo nombre por modelo, pantalla de referencia y fin de los duplicados
- **Partir el texto de compatibilidad en teléfonos reales:** `Samsung A70 A705` → **Samsung A70** + **Samsung A705** (la pantalla queda compatible con **ambos**); `Samsung A70 A705 AM (OLED CON MARCO)` → los mismos dos teléfonos y la **variante `OLED`/`AM` va al PRODUCTO** (sacada del nombre: diccionario de sufijos `INCELL/INCEL`, `OLED`, `AM`, `ORIGINAL`, `SERVICE PACK`, `CON/SIN MARCO`, `TÁCTIL`…). El nombre del teléfono queda **estable** («nada que se cambia», como pidió): sin variantes, sin marcas repetidas, Title Case canónico (`catalog.rs`, una sola fuente).
- **Si el teléfono no existe, se crea** con su marca, sus **alias** (las grafías viejas, para que buscar `A705` siga funcionando) y su compatibilidad.
- **Pantalla de referencia por modelo** (`phones.default_product_id`): al elegir el modelo en el registro de servicio, se **auto-selecciona esa** (hoy solo se auto-elige si hay una sola con stock y de la misma marca → `autoScreen`); el operario puede cambiarla, y el guardado sigue exigiendo pantalla exacta.
- **Duplicados de MODELOS: asistente con vista previa** (mismo patrón que el de productos): la app propone los grupos (`A70` / `A70 A705` / `A70 A705 AM` → un solo `Samsung A70`), muestra qué alias y qué fichas se llevan, y **el dueño confirma grupo por grupo**. La fusión: repunta `compatibility`, alias, `default_product_id` y **jamás toca precios, stock ni movimientos**.
- **Invariante de plata/inventario (intocable):** el descuento al entregar sigue por `services.screen_product_id`; si una pantalla se fusiona, el `screen_product_id` de las órdenes que la usan se **repunta al producto que queda** (lo que `merge_products` ya hace), y el stock se **suma** en el que queda.

## 3. Fases y verificación (una por turno, nada se rompe)

| Fase | Alcance | Datos | Pruebas |
|---|---|---|---|
| **1 · F51** | Orden por columnas (Productos y Modelos) | **ninguno** | pura de comparadores + EN VIVO (clic en cada encabezado, orden asc/desc, paginación) |
| **2 · F50** | Checks + códigos + búsqueda del servicio | 5 columnas nuevas, seed por stock | Rust (`test_in_use_*`, `test_code_*`), pura del filtro, EN VIVO (marcar/apagar y ver que el formulario cambia; el servicio sigue descontando la pantalla elegida) |
| **3 · F52** | Vista «Por modelo» con variantes + filtro de variante | ninguno | EN VIVO (buscar `a70` → 1 modelo; desplegar y ver variantes; el conteo cuadra con la base) |
| **4 · F53** | Normalización de nombres + pantalla de referencia + duplicados | reescritura de `phones` y de `products.variant`, **sobre COPIA** | `node tools/audit_inventory.mjs` antes/después + `verify_migracion_datos.mjs` (los datos de negocio no cambian) + EN VIVO del asistente de duplicados |

**Reglas de la casa que se respetan:** migración idempotente con columnas **al final**; listas de columnas explícitas (nunca `SELECT *` con mapping posicional); toda regla nueva como módulo **puro con test node**; verificación **EN VIVO** contra una **copia** (`REGISTRO_DB`), nunca la base del local; y **cero** cambios en la caja.

## 4. Fuera de alcance
Precios (los maneja la pestaña Precios y datos), códigos de barras físicos, y cualquier cambio en el flujo de dinero (F38/F39) o de cobro.
