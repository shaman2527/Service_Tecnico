# F86 — LA CARGA MASIVA QUE HACE LO QUE DICE (y el inventario que sale del MODELO)

> Pedido del dueño (2026-10-04), textual: «revise la lógica de inventario de producto y modelos, estoy cargando una
> data masiva, me está cargando el producto -30 por ejemplo… no debería ir stock modelo de tlf, y tengo dos campos de
> compatibilidad, debería ver una, y que descuente de producto la nueva carga las compatibilidades, sea funciona en
> base al modelo que debería ir. Para cada modelo revisá si tiene que arreglarlo». Después: «la data de repuesto
> también debería ver eso. Se carga la actualización pero debería ser más intuitivo». «En Repuesto por modelo no sé
> por qué se está cargando ahí, no debería». Y: «el modal de cada sección debería verse, no salirse de la pantalla,
> que no te deja ver los botones».

## Decisiones del dueño (confirmadas 2026-10-04)

| # | Decisión | Elegido |
|---|---|---|
| D1 | El stock de la carga CSV | **Se elige en el asistente**: «Sumar (compras)» o «Reemplazar (el archivo es la verdad)». |
| D2 | Modelo ↔ compatibilidad | **El modelo MANDA**: si la ficha no trae lista de compatibilidad, la lista se arma con SU modelo. Una sola cosa que llenar; la lista aparte queda para «también le sirve a». |
| D3 | El «stock» del modelo | **Se quita del todo** de «Modelos» y de «Por modelo» (era la suma de los repuestos compatibles, no un stock real). |
| D4 | La pestaña «Repuesto por modelo» | **Se ELIMINA** (decisión 2026-10-04, 2ª vuelta): había TRES formas de ver «por modelo» y el dueño pidió «quitar cosa innecesaria». La consulta queda en **«Modelos»** (botón «Ficha», que ya trae los repuestos por categoría) y en la vista **«Por modelo»** dentro de Productos: `Productos | Modelos | Movimientos | Ajustes`. |
| D5 | El encabezado de stock que no se reconoce | El asistente lo dice **en la cara** (Alert visible con los nombres reales del archivo) + se amplían los alias aceptados. Causa medida del «el stock no carga en masa»: `STOCK ACTUAL` / `CANT. FÍSICA` / `QTY` no estaban en la lista y la columna se ignoraba en silencio. |
| D6 | Las tres vistas de modelo | Se borra la pestaña de consulta; `onByModel(modelo)` pasa a abrir **«Modelos»** con ese teléfono ya buscado. |

Contexto de la corrida: el dueño está en **modo prueba** («no importa mi inventario local, estoy haciendo prueba»),
así que se puede medir sobre copias y con datos de ejemplo.

## Diagnóstico (medido, con evidencia)

| Síntoma del dueño | Causa real | Evidencia |
|---|---|---|
| «me carga el producto −30» | El CSV **arrastra** un negativo que ya existía (ficha en −60 + archivo 30 = **−30**) y la **vista previa lo esconde** con `clamp(0)` | `csvload.rs:1428-1438` (apply), `:862` (preview) |
| «no debería ir stock modelo de tlf» | El padrón `phones` **no tiene stock**: lo que se ve es la suma del stock de sus repuestos compatibles; el mismo repuesto cuenta en varios modelos | `phones.rs:211-233`, `ModelsTab.tsx:301/360`, `ProductsByModel.tsx:183/244` |
| «dos campos de compatibilidad, debería ver una» | `model` (teléfono principal) y `compatibility` (lista). **El padrón sale SOLO de `compatibility`**: con la celda vacía la ficha **no entra** y no aparece en Modelos ni en Repuesto por modelo. La plantilla trae las dos columnas con el mismo dato y el alias `modelos` (plural) llena la compatibilidad | `catalog.rs:755/815-819/1035`, `csvload.rs:96-98`, `:1739-1741` |
| «en Repuesto por modelo no debería estar eso» | La pestaña lista también coincidencias **parciales** y **de otra marca** (el gate de marca solo ordena) | `db.rs:3197-3220`, `ByModelTab.tsx:15-21/119` |
| «el modal se sale y no deja ver los botones» | 17 diálogos sin tope de alto; en Inventario los dos que cortan son `ProductForm` y `EditarProductoDialog` | auditoría 2026-10-04 (38 sitios) |

## Requisitos (REQ)

- **REQ-1 — El modelo arma la compatibilidad.** `catalog::normalize_fields`: si la lista de compatibilidad viene vacía
  y hay modelo, la lista se arma con el modelo (sus alternativas separadas por «/» cuentan como varios teléfonos).
  Una ficha con modelo **siempre** entra al padrón. Sin modelo y sin lista sigue quedando sin compatibilidad.
- **REQ-2 — La carga nunca escribe un stock negativo** y la vista previa muestra **el número que se va a escribir**
  (sin `clamp`). Si la ficha venía en negativo, la carga lo deja en 0 y lo informa (no lo arrastra).
- **REQ-3 — El asistente de CSV elige el modo del stock**: «Sumar (compras)» (por defecto, como hoy) o
  «Reemplazar (el archivo es el inventario real)». El modo se dice en la pantalla y viaja al backend.
- **REQ-4 — Una sola cosa que llenar.** La columna/alias `modelos` deja de llenar la compatibilidad (pasa a ser
  alias de `modelo`). La plantilla no repite el mismo dato en dos columnas: la compatibilidad queda como «también le
  sirve a» y se explica en la hoja de instrucciones.
- **REQ-5 — El asistente avisa por fila** cuando la compatibilidad del archivo **no incluye al modelo** de la ficha
  (dato incoherente) y muestra, por fila, el stock con el que queda.
- **REQ-6 — El «stock» del modelo desaparece** de «Modelos» y de «Por modelo».
- **REQ-7 — Se elimina la pestaña «Repuesto por modelo»** (ByModelTab) y el enlace «por modelo» abre **«Modelos»**
  con ese teléfono buscado. Los repuestos de un modelo salen, en las superficies que quedan, **exactamente de la
  compatibilidad del producto** (la misma regla que arma el padrón, con los alias como único puente): nada de
  coincidencias «parecidas» ni de otra marca.
- **REQ-8 — Los modales entran en la pantalla**: red de seguridad en el primitivo (`ui/dialog.tsx`) + patrón de la
  casa (tope + cuerpo scrolleable + pie fijo) en `ProductForm` y `EditarProductoDialog`.
- **REQ-9 — El conteo físico avisa**: antes de aplicar dice cuántas fichas quedan en 0 y que eso escribe movimientos
  de SALIDA (hoy lo hace en silencio).
- **REQ-10 — El formulario de producto no acepta stock negativo** (UI + backend).

## Criterios de aceptación (AC)

| AC | Cómo se comprueba |
|---|---|
| AC-1 | `normalize_fields("Pantalla","Samsung","A30/A50","", "")` deja `compatibility` con **los dos** teléfonos y `phones` = 2 | test en `catalog.rs` |
| AC-2 | Una ficha cargada solo con modelo entra al padrón (`rebuild_phones` la cuenta) | test Rust + EN VIVO |
| AC-3 | Con una ficha en −60 y un archivo que trae 30, la carga NO deja −30: queda 0 y el informe lo dice | test en `csvload.rs` |
| AC-4 | La vista previa devuelve el MISMO número que el apply (nunca `clamp` escondiendo un negativo) | test Rust |
| AC-5 | Modo `reemplazar`: el stock final es el del archivo; modo `sumar`: hoy + archivo | test Rust |
| AC-6 | `apply_inventory_csv` sin `mode` se comporta como `sumar` (compatibilidad con lo que ya existe) | test Rust |
| AC-7 | La columna «MODELOS» de un Excel llena el MODELO (no la compatibilidad) | test del parser |
| AC-8 | El asistente muestra el badge «la compatibilidad no incluye su modelo» en la fila que corresponde | EN VIVO |
| AC-9 | «Modelos» y «Por modelo» no muestran ningún número como stock del teléfono | EN VIVO (no existe el nodo) |
| AC-10 | Inventario tiene 4 pestañas (`Productos | Modelos | Movimientos | Ajustes`), el botón de capas lleva a «Modelos» con el teléfono buscado, y la ficha del modelo lista SOLO los repuestos compatibles de verdad | EN VIVO |
| AC-14 | Con un archivo cuyo encabezado de stock es «STOCK ACTUAL», el asistente avisa EN PANTALLA que no reconoció la columna y que no va a tocar el stock | EN VIVO |
| AC-11 | Ningún diálogo del inventario deja los botones fuera de la pantalla a 750 px de alto | EN VIVO |
| AC-12 | El conteo físico, antes de aplicar, dice cuántas fichas quedan en 0 y que eso escribe salidas | EN VIVO |
| AC-13 | El formulario de producto rechaza un stock negativo con su motivo | test Rust + EN VIVO |

## Fuera de alcance (declarado)

- Unificar `model` y `compatibility` en una sola columna de la base (D2 se resolvió **derivando**, sin migración).
- Fusionar la lista de compatibilidad cuando el archivo trae texto (sigue reemplazando lo que trae; `-` la borra).
- El gate de marca del formulario de servicio (ya existe, `screen-rules.ts`) y `MoveHorizontal`/movimientos manuales.
- Los diálogos fuera de Inventario que no cortan botones en la ventana real (se dejó la red de seguridad del primitivo).

## Interfaces que cambian (para que Rust y UI no se desalineen)

| Contrato | Cambio |
|---|---|
| `csvload::CsvApplyInput` | + `mode: String` (`"sumar"` \| `"reemplazar"`, `#[serde(default)]` → sumar) |
| `csvload::CsvRowPreview` (aviso por fila) | + `stock_final: i64` (el número REAL) y + `aviso_compat: bool` (la lista no incluye al modelo) |
| `csvload::CsvReport` | + `mode` (eco), + `clamped_to_zero: i64` (fichas que venían en negativo), + `columnas_ignoradas: Vec<String>` y + `sin_columna_stock: bool` |
| `phones.rs::build_index` / `get_phone_detail` / `get_phone_models` | sin cambio de firma: se fija con test que los repuestos del modelo salen de la compatibilidad del producto |
| ~~`find_compatible_products(..., incluir_parecidas)`~~ | **NO se agrega** (D4: el consumidor desapareció). Los 7 scripts que lo invocan por IPC quedan intactos. |
