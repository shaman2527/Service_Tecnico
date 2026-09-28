# F81 — El filtro vuelve al predeterminado al ir a registrar un servicio (y la tarjeta nueva se ve)

**Estado:** en implementación (2026-09-27).
**Origen:** pedido del dueño con la app en la mano (2026-09-27), sobre Servicio Técnico.
**Regla madre:** *mientras el operario NO está registrando, la lista es SUYA (sus filtros se respetan);
en el momento en que va a registrar, la lista vuelve al estado en el que la orden nueva se ve — y la
lista le muestra cuál acaba de crear.*

---

## 1. El problema (medido)

El pedido textual: «cuando escribo en el filtro, en servicio, y cuando vaya a registrar un servicio
nuevo el filtro automáticamente se ponga sin filtro predeterminado, se borre la búsqueda, porque a
veces cuando creo un servicio y tiene un filtro activado me confunde la card: debería aparecerme el
servicio que acabe de registrar».

* Los filtros viven en el estado de `Services.tsx`: `search`, `statusFilter`, `dateField`,
  `dateStart`, `dateEnd` y `typeFilter` (chip de trabajo).
* El guardado del wizard **no los toca**: `onSaved` (`Services.tsx:1456`) solo cierra el formulario y
  llama a `refrescar()`.
* El botón **«Entregados hoy»** (`verEntregadosHoy`, `Services.tsx:667`) deja
  `status='Entregado' + dateField='out' + hoy`. Una orden recién **recibida** no tiene `date_out`,
  así que con ese filtro la tarjeta nueva es **invisible por definición**: el operario cree que no se
  guardó.
* `limpiarFiltros()` (`Services.tsx:742`, botón manual) borra búsqueda, estado, fechas y chip, pero
  **no** devuelve el eje a «Recibidos» (decisión de F44, se conserva).

## 2. Qué se implementa

1. **Una sola definición del «predeterminado»** — `src/lib/service-filters.ts` (regla PURA, sin
   React): `DEFAULT_SERVICE_FILTERS`, `defaultServiceFilters()`, `isDefaultServiceFilters(f)` y
   `clearServiceFilters(f)` (el borrado del botón manual, que **conserva el eje**, comportamiento F44
   intacto). Los seis `useState` de los filtros nacen de esa constante.
2. **`abrirAlta()`** es la ÚNICA puerta del alta en `Services.tsx` (botón «Nuevo Servicio» y atajo
   **N/F2**): guarda los filtros vigentes y los pone en el predeterminado **completo** (eje
   «Recibidos» incluido). Los caminos de **edición** no la usan: editar una orden **no** cambia los
   filtros.
3. **Si el wizard se cierra sin haber creado nada** (ESC/X), se **restauran** los filtros que había:
   un N apretado sin querer no le borra la búsqueda al operario. Si la orden se creó (aunque sea con
   el botón «Cobrar» del wizard, F79) **no** se restaura.
4. **La tarjeta nueva se ve**: al guardar un **alta**, el wizard devuelve la orden creada
   (`onSaved(nueva)` con `base`, `ids` y `groupId`) y el padre marca esas filas con `data-nueva`,
   un anillo temporal de resaltado y un `scrollIntoView({ block:'center', behavior:'smooth' })` que
   corre UNA vez, cuando la lista con esas filas ya está dibujada. El resaltado se apaga solo (~6 s) y
   con el primer cambio de filtro/búsqueda. En **multi-equipo** se resaltan todas las filas del grupo.
5. **F79 («Cobrar» dentro del wizard)**: la orden se crea y el wizard sigue abierto, así que la orden
   creada se anota y el resaltado/scroll se aplica **cuando el wizard se cierra** (detrás del modal
   nadie lo vería).

## 3. Trampas que el diseño tiene que respetar (medidas en el código)

* **`load()` lee los filtros del closure** (`Services.tsx:494`): limpiar el estado y llamar a
  `refrescar()` en el mismo tick consultaría con los filtros VIEJOS. La recarga correcta la hace el
  efecto con debounce de 350 ms (`Services.tsx:612`), del que depende la consulta.
* **`onSaved` es la MISMA callback para alta y edición** (`Services.tsx:1456`, `2729`, `3339`), y
  también viaja como callback a `avisosDeRecepcion(...)` (3342): se pasa **envuelta**, nunca como
  `map(onSaved)` (el índice de `map` entraría como si fuera la orden).
* **El resumen del día y los KPIs NO se tocan**: tienen alcance propio (`resumenKind`, `entregadosHoy`)
  y no dependen de los filtros de la lista.

## 4. Pruebas

* `node tools/service_filters_test.ts` (puro): el predeterminado es exactamente el estado en el que
  una orden nueva es visible; el reset es idempotente y desde cualquier combinación; `clearServiceFilters`
  conserva el eje.
* `node tools/verify_alta_limpia_filtros.mjs` (EN VIVO, CDP): con búsqueda + `Entregado` + eje
  «Entregados» + período puestos, abrir el alta deja la barra en el predeterminado **antes de
  guardar**; al guardar, la tarjeta nueva está en la lista, con `data-nueva` y dentro del viewport;
  editar una orden **no** limpia los filtros; cancelar el alta los **restaura**.
* Regresiones EN VIVO: `verify_trabajos_hechos` (botón «Limpiar filtros»), `verify_resumen_dia`,
  `verify_recordatorios`, `verify_smoke_integral`, `verify_cobro_en_wizard`, `verify_wizard_metodos`,
  `verify_metodos_en_cobros`.

## 5. Invariantes

1. La lista del operario **no se toca** mientras él no esté registrando (solo el alta la reencuadra).
2. Editar una orden **jamás** cambia los filtros.
3. El resaltado **no miente**: solo las filas de la orden recién creada, y se apaga solo.
4. Cero cambios en el backend, en la base y en las reglas de dinero/stock/entrega.
