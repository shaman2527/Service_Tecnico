# F78 — CARGA MASIVA DEL INVENTARIO EN CSV (2 pestañas, previsualización y proveedores)

**Pedido del dueño (2026-09-24), textual:**

> «cambiemos el formato de carga masiva aqui, quiero sea formato .CSV … que tome todo los campos del
> inventario … y que cree 2 pestaña … que muestra si son producto nuevo o son producto duplicado que
> permita editarlo o dejarlo o eliminarlo que categoria es si es nueva … preview como sale cuando
> cargas … que sirva para toda las categoria o nueva agregandola … que la data masiva se cargue
> importandolo desde la pc … pueda subir bateria, flex main, pin de carga, con su costo y precio de
> venta, stock, nombre etc. … los provedores … sin romper nada»

**Aclaraciones del dueño (respuestas a las preguntas cerradas, antes de implementar):**

1. **El stock SUMA** a lo que ya existe (`3 + 10 = 13`); si el producto no existe, nace con su stock.
   El CSV **nunca pone stock en 0** y una **celda vacía = no tocar** (misma regla que la lista física).
2. **El nombre del producto es único**: cada nombre se valida como duplicado. Si el nombre ya existe,
   el archivo **ACTUALIZA** esa ficha con los datos del CSV y **muestra el diff** («hoy → queda»).
3. **La lista simple** (conteo físico, `LoadInventoryDialog`) **se conserva** como segundo camino —el
   usuario delegó: «lo que sea más óptimo»—; el camino principal pasa a ser el CSV.
4. **Sin romper nada**: ninguna escritura sin respaldo, ningún cambio de esquema, ninguna plata ni
   stock movidos fuera de lo que dice el archivo.

## Problema / oportunidad

El único camino de carga masiva era una **lista de texto** pensada para el conteo físico del local
(`marca` / `modelo (N)`), que **solo maneja pantallas** (categoría 1): no tiene precio, costo, stock
por campo, proveedor ni categoría, y **pisa** el stock (es un conteo absoluto). Para subir el resto del
inventario —batería, flex main, pin de carga, etc.— había que crear ficha por ficha a mano.

## Alcance

Rust nuevo (`csvload.rs`), 4 comandos, helpers de categoría reutilizados, tipos del frontend, un
asistente de 3 pasos y la documentación. **CERO migraciones, CERO columnas nuevas, CERO crates nuevas.**

### REQ-1 — El archivo (`src-tauri/src/csvload.rs`)

- **Formato:** `.csv` con encabezado, separador **autodetectado** (`,` `;` o tabulador; se ignoran las
  líneas `#` al detectar), comillas dobles con escape `""`, **BOM** tolerado, saltos CRLF/LF.
- **Encabezados aceptados** (plegados: sin acentos, sin mayúsculas, sin guiones; alias en español e
  inglés) — **15 columnas**: `nombre`, `categoria`, `marca`, `modelo`, `variante`, `compatibilidad`
  (también `compat`/`compatible`), `costo`, `venta` (también `precio`), `efectivo`, `stock` (también
  `cantidad`), `stock_min`, `proveedor`, `codigo`, `en_uso` e `id`.
- **Números** con coma o punto decimal y separador de miles (`1.234,56` → 1234.56) y **notación
  científica** (`1E5`, `1,5E3`); cantidades enteras (negativas rechazadas); precios entre 0 y
  `MAX_PRECIO`. **Sí/No** para `en_uso` (`si|sí|yes|1|true|x`).
- **Límites duros:** `MAX_ROWS = 5_000` filas y `MAX_QTY = 100_000` unidades por fila (y por suma).
  Superarlos **rechaza el archivo entero** (no se carga a medias). Además `MAX_BYTES = 8 MB` se
  comprueba **antes de parsear** (un archivo de 300 MB elegido por error no se lleva la memoria).
- **Plantilla:** `plantilla_csv()` devuelve un CSV de ejemplo con comentarios `#` que explica cada
  columna; la descarga el asistente **desde el backend** (`plantilla_inventory_csv`), así no puede
  quedar una plantilla de mentira en el frontend.

### REQ-2 — Identidad del producto (la regla que decide «nuevo» o «duplicado»)

En este orden, la primera que acierta gana:

1. **id** (si el archivo lo trae y existe);
2. **code** (el código de la ficha) — **solo si la categoría del archivo coincide**; si el código es de
   una ficha de OTRA categoría, la fila queda **bloqueada** (antes actualizaba la ficha ajena: le
   cambiaba el nombre, la marca, la categoría y le sumaba el stock);
3. **clave canónica** = categoría + marca + modelo + variante (normalizados con las reglas del
   catálogo: `norm_model`, marca canónica);
4. **nombre plegado** (minúsculas, sin acentos ni puntuación) — **el nombre es único**.

- Una fila **sin** coincidencia → **NUEVO**: se crea el producto con su stock.
- Una fila **con** coincidencia → **DUPLICADO/EXISTENTE**: se muestra el diff y, según la acción
  elegida, se **actualiza** (con los datos del archivo) o se **deja** o se **elimina** (quitar) del lote.
- **Choque de nombre con OTRA categoría** (o `code` en uso por otra categoría): la fila queda
  **bloqueada** y **no se puede aplicar** hasta que el dueño decida («Actualizar esa ficha» / «Crear
  igual (otra variante)»). Nunca se actualiza en silencio la ficha equivocada.
- **Dos filas del archivo que CREAN el mismo nombre** (o el mismo código): bloquean con el número de
  línea (el nombre es único también dentro del archivo). Dos filas que caen en una ficha que YA existe
  **no** son un error: el stock de las dos **se suma** (y la pantalla lo avisa).

### REQ-3 — Stock: SUMA, nunca pisa (`apply_csv`)

- `stock` del archivo **se suma** al stock actual (`hoy 3 + 10 = 13`), con `MAX_QTY` de techo; si DOS
  filas del archivo tocan la misma ficha, **suman las dos** sobre el valor ya escrito (no sobre la foto
  de antes de la carga). Si la suma pasa el techo, la fila **bloquea** (no se recorta en silencio).
- **Celda vacía = no se toca el campo** — stock, precios, marca, modelo, variante, compatibilidad,
  proveedor y código. Para **borrar** un campo de texto a propósito se escribe un **guion** (`-`) o
  «ninguno/a»: es la única forma de vaciarlo sin romper la regla.
- **Los precios/costos toman el valor del archivo** cuando la celda trae número; un precio **negativo o
  absurdo** bloquea la fila (antes entraba al catálogo sin objeción).
- La **notación científica** se lee como el número que es (`1E5` = cien mil, `1,5E3` = mil quinientos):
  filtrar los caracteres «que no son de número» la convertía en otro número (`1E5` → `15`) y eso se
  escribía en el precio o en el stock sin avisar.
- Cada fila cargada deja **un movimiento de inventario** con `motivo = "Carga masiva (CSV)"` y el
  **nombre del archivo como referencia** (tipo entrada/salida según el signo del ajuste), y su suma es
  exactamente lo que subió el stock.

### REQ-4 — Categorías nuevas (`CsvNewCategory`)

- Una categoría que no existe queda **propuesta**, NO creada: el dueño la **tilda** en el asistente
  (`data-field="csv-categoria-nueva"`) y **recién ahí** se crea.
- Se reutilizan las reglas de `add_category` (helpers `pub(crate)` extraídos en `db.rs`:
  `es_categoria_del_padron`, `nombre_de_categoria`, `descripcion_de_categoria`, `categoria_por_nombre`,
  `crear_categoria_en`) → **se respeta la reserva de ids de las categorías de teléfono**
  (`PHONE_CATEGORIES = 1/18/19`: 1 = Pantalla, 18/19 las otras dos): una categoría nueva **jamás** cae
  en un id reservado (si no, `rebuild_phones` empezaría a tratar sus productos como repuestos de
  pantalla). Verificado en vivo: el id de la categoría creada no está en `PHONE_CATEGORIES`.

### REQ-5 — Aplicar es una transacción con respaldo (`apply_csv`)

1. **Respaldo** `VACUUM INTO backup/registro_pre_carga_<fecha>.db` **antes** de escribir.
2. **UNA transacción**: categorías nuevas (si se confirmaron) → altas → actualizaciones → movimientos.
   Cualquier error hace **ROLLBACK** completo: no queda media carga. Fallar cerrado incluye el borrado:
   una ficha que no se puede eliminar (está en uso) **aborta la carga entera** con el motivo y el
   remedio, en vez de saltarse la fila y commitear el resto.
3. **Relee el catálogo DENTRO de la transacción** (no confía en los valores de la previsualización):
   encontró un **bug real** — una vista previa vieja (el stock cambió entre revisar y aplicar) escribía
   el stock calculado sobre el valor viejo y **borraba** las unidades vendidas en el medio.
4. **El catálogo se refresca fila a fila (`vivo`)**: si dos filas del archivo caen en la MISMA ficha, la
   segunda **suma sobre lo que escribió la primera**. Con la foto congelada la segunda pisaba el stock de
   la primera (3 + 10 + 5 = 8 en vez de 18) mientras el historial decía +15 — **bloqueante de la
   revisión adversarial**, arreglado y fijado por test.
5. **Cada escritura se comprueba**: el `UPDATE` y el `DELETE` tienen que afectar **exactamente una fila**
   (si la ficha ya no está, la carga se aborta con «volvé a revisar el archivo»); el código no puede
   nacer repetido; el payload del frontend se valida (topes de filas, de unidades y de precios, y
   `checked_add` para que un número enorme no desborde ni deje el stock en 0).
6. **UN solo `rebuild_phones`** al final —y solo si la carga cambió algo que afecta al padrón
   (compatibilidad, marca/modelo/variante, categoría o alta nueva)—: con 5.000 filas eso es la
   diferencia entre segundos y minutos. Si el padrón falla, la carga **se deshace** (antes el error se
   ignoraba y quedaba un padrón a medias commiteado).
7. Devuelve `CsvReport` con creados/actualizados/movimientos/backup y el detalle por fila; el
   `units_added` es el **neto real** (incluye lo que sale por las eliminaciones).

### REQ-6 — Exportar lo que ya hay y plantilla (`export_csv`, `plantilla_csv`)

- `export_inventory_csv` vuelca **el catálogo actual** con las mismas columnas del archivo de carga: el
  camino natural es **exportar → editar en Excel → volver a cargar** (y así el dueño ve el formato
  exacto que el sistema entiende, sin adivinar). Los números salen **sin perder precisión** (`0,125` se
  relee 0,125).
- **Ojo (documentado, no escondido):** el stock del archivo **SUMA**, así que reimportar el export sin
  tocar la columna `stock` **duplica** las unidades. El asistente lo avisa con el número de fichas
  afectadas (`data-csv-warn="stock-suma"`) y la Ayuda lo dice con el remedio: vaciar la columna `stock`
  (una celda vacía no toca el stock). Para una edición de datos sin tocar mercancía ese es el camino.
- `plantilla_csv` baja una plantilla de ejemplo con las 15 columnas explicadas, servida por el backend.

### REQ-7 — El asistente (`src/components/inventory/LoadCsvDialog.tsx`)

Tres pasos (`WizardSteps`, el mismo stepper de la carga física: `Archivo → Revisar → Listo`):

1. **Archivo:** abrir el `.csv` con el selector nativo (`plugin-dialog` + `plugin-fs`), **pegar** el
   contenido, **descargar la plantilla** (la del backend) o **exportar el catálogo actual**. Resumen en
   vivo `data-csv-total="resumen|nuevos|existentes|unidades|bloqueadas"`.
2. **Revisar (la previsualización, que es lo que el dueño pidió):**
   - **2 pestañas**: `data-csv-tab="nuevos"` (lo que se va a crear) y `data-csv-tab="existentes"` (los
     duplicados), con su contador.
   - Cada fila (`data-csv-row="<línea>"`) muestra **el diff** de los campos que cambian («hoy → queda»
     por campo) y el stock con la suma explícita (`data-field="csv-stock-despues"`, texto `3 → 13`),
     que se **recalcula al editar** la celda (antes quedaba viejo y la pantalla se contradecía).
   - **Celdas editables** (`data-field="csv-<campo>"`): nombre, categoría, marca, modelo, variante,
     compatibilidad, costo, precio, stock, stock mínimo y proveedor. Las columnas que el archivo **no**
     trae quedan de **solo lectura** (`data-csv-readonly="si"`): editar un dato que el aplicar va a
     descartar sería una mentira. La compatibilidad se compara **como la lee una persona** (antes el
     diff la comparaba contra el JSON crudo y marcaba TODAS las filas).
   - **Por fila** (`data-field="csv-accion"`): **Actualizar / Dejar como está / Quitar del lote**, más
     «Quitar» / «Volver a poner» (`data-csv-action="quitar|reponer"`) y **«Revisar a mano»**
     (`data-csv-action="revisar-mano"`) que abre el `ProductForm` completo para esa ficha.
   - **Categoría por fila**: selector con las categorías existentes (`data-field="csv-categoria"`) y los
     tildes de categorías nuevas (`data-field="csv-categoria-nueva"`), que llegan **sin marcar**: la
     categoría se crea solo si el dueño la tilda.
   - Las filas **bloqueadas** (choque de nombre/código, nombre o código repetido dentro del archivo,
     número inválido, precio negativo) se listan aparte con su motivo y el botón
     `data-csv-action="quitar-bloqueadas"`; **mientras haya bloqueadas el botón de aplicar está apagado**
     (el backend también rechaza: la UI no es el único guardián) y un doble clic no carga dos veces.
3. **Listo:** el `CsvReport` (`data-csv-report`): creados, actualizados, movimientos, el **neto** que
   subió o bajó el inventario y el archivo de respaldo.

**Entradas al asistente:** tarjeta «Cargar inventario por CSV» en `PricesTab` (Ajustes) con el botón
`data-action="cargar-csv"` y su hermana «Cargar la lista del local (conteo físico)» (la de siempre), y
el botón **«Cargar CSV»** del encabezado de Inventario (`data-action="cargar-csv"`, **solo dueño**).

### REQ-8 — Seguridad y gobernanza

- **Solo el dueño**: `apply_inventory_csv` y `export_inventory_csv` llaman `db.require_owner()` en
  `commands.rs`; hay un test (B3) que fija por inspección de fuente qué comandos lo exigen.
  `plantilla_inventory_csv` devuelve un texto fijo (no lee la base) y la previsualización **no escribe
  nada** — hay un chequeo EN VIVO que compara productos/stock/categorías/movimientos antes y después de
  revisar.
- **Ningún `INSERT`/`UPDATE` con texto interpolado**: todo va por parámetros; el nombre del archivo se
  guarda como referencia (dato, no SQL) y nunca entra en una ruta (el respaldo se arma con la carpeta de
  la base + un timestamp de SQLite).
- **El payload del frontend se valida en el backend**: topes de filas, de stock y de precios, y
  `checked_add` en la suma (un `i64::MAX` en una celda editada desbordaba y dejaba el stock en 0 en
  release, y paniqueaba con el mutex tomado en dev — lo cazó la revisión de seguridad).
- Se conserva el invariante de F54/F33 (nada flota sobre el formulario) y el bus de sincronización
  (F76): `apply_*` está en la lista de prefijos de escritura, así que Inventario se refresca solo.

## Fuera de alcance (explícito)

- **No** se toca `loadlist.rs` ni `LoadInventoryDialog.tsx`: el conteo físico sigue igual (absoluto +
  barrido), con su propia verificación en vivo.
- **No** hay carga de imágenes, ni importación desde Excel `.xlsx` (el dueño exporta a CSV desde Excel).
- **No** hay borrado masivo de productos desde el archivo (quitar = sacar del lote; borrar una ficha es
  una acción de la ficha, con sus reglas de FK).
- **No** se agregan crates (lección del proyecto: `reqwest` tardaba minutos en compilar; el parseo de
  CSV se escribe a mano, como el scraping de BCV con `curl.exe`).
- **No** cambian las reglas del catálogo (`catalog.rs`): la carga usa las que ya existen.

## Criterios de aceptación (medibles)

1. Pegando un CSV con un producto **nuevo** y uno **existente**, el asistente muestra **2 pestañas** con
   el nuevo en «Nuevos» y el existente en «Existentes», y el resumen dice cuántos son de cada uno.
2. La fila del existente muestra el **diff** («hoy → queda») y el stock con la **suma** (ej. `3 → 13`).
3. Editando el stock de una fila antes de aplicar, el resumen se recalcula en vivo.
4. Al aplicar: el producto nuevo existe con su **categoría, stock, costo, precio y proveedor**; el
   existente tiene el **stock sumado** (no pisado) y sus precios actualizados.
5. Se crean **movimientos** con motivo «Carga masiva (CSV)» y la **referencia = nombre del archivo**.
6. Existe un **backup** nuevo de la base anterior a la carga.
7. Una categoría nueva **no** se crea si no se tilda; tildada, se crea con un **id que no está en
   `PHONE_CATEGORIES`** y los productos entran en ella.
8. Un archivo con una fila **inválida** (nombre en uso por otra categoría / número imposible) **bloquea
   la carga entera** y lo explica; la base queda **intacta**.
9. `preview_inventory_csv` **no escribe nada** (productos, stock, categorías y movimientos iguales antes
   y después de revisar — verificado EN VIVO).
10. `apply_inventory_csv` / `export_inventory_csv` **exigen dueño** (`require_owner`).
11. **Dos filas del archivo sobre la misma ficha suman las dos** (`3 + 10 + 6 = 19`) y los movimientos
    suman exactamente lo que subió el stock (16).
12. **Una celda vacía no borra los textos** (marca/modelo/variante/compatibilidad) y el guion (`-`) sí
    los vacía a propósito. Un precio negativo o un stock absurdo **bloquean** la fila, y la notación
    científica se lee como el número que es (`1E5` = 100 000).
13. Unicidad dentro del archivo: dos filas que crean el **mismo nombre** bloquean; un **código** de otra
    categoría bloquea; borrar y actualizar la misma ficha en un archivo da error (nada a medias).
14. `cargo test --lib` verde (**23 tests** de `csvload`), `tsc -b` 0 errores, `oxlint` 0 errores,
    `npm run build` OK y las regresiones EN VIVO verdes.

## Pruebas

- **Rust (unitarias, en `csvload.rs` y `db.rs`):** **23 tests** — separador autodetectado (`,` `;` tab,
  con comentarios `#`), BOM, comillas con `""`, números es-VE/US y **notación científica**, cantidades
  negativas, precios negativos/absurdos, tope de filas, de unidades **y de bytes**, identidad
  (id → code → clave canónica → nombre) y **nombre único**, **celda vacía = no tocar** (incluidos los
  TEXTOS) y el guion para borrar, **stock que suma** —incluso con DOS filas sobre la misma ficha y con
  el historial cuadrando—, la vista previa vieja que no pisa el stock nuevo, categoría nueva (tildada /
  no tildada / id fuera de `PHONE_CATEGORIES`), choque de nombre y de **código**, dos filas nuevas con
  el mismo nombre, borrar+actualizar la misma ficha, falla cerrado al eliminar una ficha **en uso**
  (rollback verificado: la fila anterior no queda), validación del **payload del frontend** (stock y
  precios fuera de rango), movimientos con su motivo y referencia, backup creado, y el
  `export` → `preview` round-trip.
- **EN VIVO (nueva):** `node tools/verify_carga_csv.mjs` **33/33** (CDP; exige `REGISTRO_DB` sobre una
  COPIA, entra como dueño por el selector de personas, pega un CSV con un producto nuevo y **dos filas
  de la misma ficha existente**, comprueba resumen/2 pestañas/diff/stock en vivo/tilde de categoría
  nueva/**que la vista previa no escribió nada**/**que las columnas ausentes son de solo lectura**/**el
  aviso del stock que suma**, aplica, y **verifica la verdad en la base**: producto creado con
  categoría/stock/precios/proveedor, categoría con id no reservado, stock del existente `3+10+6=19`,
  movimientos cuya suma es 16, referencia = nombre del archivo, backup; y un archivo con error
  **bloquea** la carga. Limpia sus productos, movimientos y categoría).
- **Regresiones:** `verify_inventory_load.mjs` **31/31** (lista física), `verify_carga_aplica.mjs`
  10/10 sobre copia sin la lista aplicada (8/10 si ya estaba aplicada — limitación del entorno,
  documentada), `verify_smoke_integral.mjs` **110/110**, `verify_uso_modelos.mjs` **38/38**,
  `verify_modelos_f53.mjs` **24/24**, `verify_categorias_producto.mjs` **35/35**,
  `verify_inventario_rapido.mjs` **10/10**, `verify_por_modelo.mjs` **27/27**,
  `verify_compat_pantalla.mjs` **12/12**, `verify_precio_pantalla.mjs` **52/52**.

## Revisión adversarial (2 perfiles: seguridad + calidad/consistencia) — 2026-09-24

**2 BLOQUEANTES + 5 MAYORES + 15 menores, TODOS arreglados** (los bloqueantes eran reales y estaban
cubiertos por la documentación de arriba):

1. **[BLOQUEANTE] Dos filas del mismo archivo sobre la misma ficha PISABAN el stock:** el catálogo se leía
   UNA vez antes del bucle, así que la segunda fila calculaba sobre el stock previo a la carga (ficha con
   3 + filas 10 y 5 → quedaba **8** en vez de 18) mientras los movimientos y el informe decían +15. Ahora
   el catálogo se refresca fila a fila (`vivo`) y el test `test_dos_filas_de_la_misma_ficha_suman_stock`
   lo fija (18 y movimientos que suman 15).
2. **[BLOQUEANTE] «Celda vacía = no tocar» no se cumplía en los TEXTOS:** con la columna presente y la
   celda vacía, la marca quedaba en «Genérico», el modelo/variante en blanco y la **compatibilidad curada
   se borraba** (con ella, el vínculo del repuesto con su teléfono en el padrón de Modelos). Ahora
   `texto_celda()` conserva el valor y el guion (`-`) es la forma explícita de vaciar
   (`test_celda_vacia_no_borra_los_textos`).
3. **[MAYOR] Notación científica leída como otro número** (`1E5` → `15`, `1.5E3` → `1.53`) y escribida en
   precio/stock sin aviso → `leer_cientifico()`.
4. **[MAYOR] El payload del frontend no se validaba en el backend:** `stock_hoy + i64::MAX` desbordaba
   (en release dejaba el **stock en 0**; en dev paniqueaba con el mutex tomado) → rangos + `checked_add`
   (`test_el_payload_del_frontend_se_valida_en_el_backend`).
5. **[MAYOR] Choque de `codigo` con una ficha de OTRA categoría actualizaba (y renombraba) esa ficha** →
   ahora bloquea como el nombre (`test_codigo_de_otra_categoria_no_actualiza_la_ficha_ajena`).
6. **[MAYOR] Dos filas nuevas con el mismo nombre creaban DOS fichas iguales** → bloquean con su línea
   (`test_dos_filas_nuevas_con_el_mismo_nombre_bloquean`).
7. **[MAYOR] «Exportar → editar → reimportar» duplica el stock** (el stock SUMA) y la Ayuda prometía «lo
   que no cambiaste queda igual» → aviso con el número de fichas afectadas en el asistente
   (`data-csv-warn="stock-suma"`), Ayuda y comentario del comando corregidos, y prueba de ida y vuelta
   documentada (con el stock vacío).
8. **[MAYOR] El diff mentía:** la compatibilidad se comparaba contra el **JSON crudo** (toda fila salía
   resaltada con `["Samsung A06 4G"]`) → `compatibility_text`; y editar una celda cuya columna **no venía
   en el archivo** se descartaba en silencio → esas celdas ahora son de **solo lectura**.
9. Menores arreglados: el resumen ya no cuenta las filas «dejar» ni esconde las eliminaciones; el
   `rebuild_phones` falla cerrado en vez de ignorar el error y solo corre si algo del padrón cambió; el
   «en uso» de un teléfono nuevo mira el **stock real** (no solo las fichas creadas); el informe dice el
   **neto** (no `Math.abs`); borrar una ficha ya borrada o eliminar+actualizar la misma ficha da error
   claro en español; el `UPDATE`/`DELETE` exigen **una fila afectada**; la plantilla la sirve el backend
   (era código muerto y ya difería del frontend); el export no pierde precisión; el tope de `MAX_QTY` se
   aplica a la **suma** (bloquea, no recorta); las categorías nuevas llegan **sin tildar**; el archivo
   tiene tope de **bytes** antes de parsear; `code` con `first-wins` consistente; una fila con nombre
   repetido ya no depende de un `.ok()` que se tragaba el error; y las aserciones flojas de la
   verificación en vivo se reemplazaron por conteos exactos (y se sumaron los casos nuevos).

## Riesgos y mitigaciones

- **Una carga masiva mal hecha es el peor escenario** (miles de fichas con el stock equivocado) →
  respaldo **antes** de escribir, **una** transacción, previsualización obligatoria con el diff, filas
  bloqueadas que **impiden** aplicar, y `stock` que **suma** (nunca pisa) para que el error humano no
  pueda borrar unidades.
- **Duplicados por nombre**: la identidad por nombre plegado + la validación de nombre único por fila;
  un choque **no se resuelve solo**, lo decide el dueño en pantalla.
- **Rendimiento:** un solo `rebuild_phones` al final; el catálogo de 1.200 teléfonos pasó de ~1 s por
  fila a **una** reconstrucción. Los topes (`5.000` filas / `100.000` unidades) evitan que un archivo
  pegado por error (una hoja de cálculo de 200.000 líneas) congele la app.
- **Categoría nueva con id reservado** → los teléfonos del local se romperían en silencio: cubierto por
  el helper compartido con `add_category` y por el test en vivo del id reservado.
- **Números en formato local** (`1.234,56` es mil doscientos treinta y cuatro con cincuenta y seis en
  es-VE, y `1,234.56` en el Excel en inglés): el lector acepta los dos y hay test para cada uno.
