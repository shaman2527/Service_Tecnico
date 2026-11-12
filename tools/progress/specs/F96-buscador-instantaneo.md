# F96 — El buscador de Servicio Técnico responde en el acto (búsqueda en memoria + abonos en un viaje)

**Estado:** en implementación (2026-10-07).
**Origen:** pedido del dueño con la app en la mano (2026-10-07): «optimización cuando escribe en filtro
buscador de servicio, escribe al rato es que aparece la búsqueda, debería ser rápido… tiene 1400
registros, no sé si se pone lenta por eso, no debería».
**Regla madre:** *escribir en el buscador no puede esperar a nadie: la lista que el operario ya tiene
cargada alcanza para filtrarla, y el resultado tiene que ser EXACTAMENTE el mismo que daría el
backend.*

---

## 1. El problema (medido antes de tocar nada)

Base real del taller: 10 órdenes, 980 productos, 1040 teléfonos del padrón. **El SQL no es el
problema**: `get_services` (que escanea con `LIKE %q%`) tarda **0,14–0,5 ms** con 1400 filas
(`tools/diag_servicios_perf.mjs`). Lo que se sentía «al rato» era el camino completo de la tecla:

| # | Causa | Dónde |
|---|-------|-------|
| 1 | **350 ms de espera artificial** antes de *empezar* a consultar, reiniciada en cada tecla | `setTimeout(load, 350)` en el efecto del buscador |
| 2 | **La búsqueda NO filtraba en la pantalla**: la resolvía el backend, así que mientras esperaba la lista seguía mostrando TODO (se escribía «a ciegas») | `visibleServices` solo aplicaba el chip de trabajo |
| 3 | **4 viajes IPC por tecla** y dos de ellos (estados, técnicos) **no dependen de la búsqueda** | `load()` |
| 4 | **N+1 de abonos**: hasta **120 viajes IPC** (uno por tarjeta) para el chip del método real, en cada búsqueda | `conPagos()` dentro de `load()` |
| 5 | Cada viaje = serialización JSON ida y vuelta + el `Mutex` de la conexión; y la lista se re-renderiza entera con cada respuesta | puente `tauriInvoke` |

## 2. Qué se implementa

1. **La búsqueda se resuelve en memoria** — `src/lib/service-search.ts` (regla PURA, sin React, con
   pruebas): `foldSearch`, `searchTokens`, `searchHaystack`/`cachedHaystack` (memoria corta por fila
   en `WeakMap`), `matchesServiceSearch` y `filterServicesBySearch`. Busca en **los mismos cinco
   campos** del `LIKE` del backend (`client`, `model`, `order_num`, `phone`, `client_ci`).
   Dos mejoras, ninguna quita resultados: **pliega acentos** («perez» → «Pérez», que el `LIKE` de
   SQLite no hace fuera de ASCII) y **acepta varias palabras en cualquier orden**.
2. **La lista del servidor se pide SIN texto** (`cargarLista()`): solo los filtros de servidor
   (estado + rango de fechas + eje). El buscador ya no dispara ninguna consulta.
3. **La carga se parte en dos**: `cargarLista()` (lo que depende de los filtros) y
   `cargarContexto()` (estados + técnicos, que no dependen de nada de eso: se leen al entrar y cuando
   la app escribe algo, F76). `load()` = las dos, para guardar/cobrar/borrar/entregar.
4. **Los abonos, en un viaje y con memoria**: comando nuevo `get_payments_for_services(ids)` (Rust,
   una sola consulta `WHERE service_id IN (...)`) + puente `api.getPaymentsForServices(ids)`. La
   pantalla pide solo los ids que no sabe, recuerda lo leído (se tira cuando `dataVersion` avisa de una
   escritura) y no pide nada por encima de 120 equipos a la vista (regla F44, se sigue avisando).
5. **`useDeferredValue`** para el valor con el que se pinta la lista: el campo de texto responde en el
   acto y las tarjetas se recalculan en el cuadro siguiente.
6. **El debounce que queda (120 ms) es solo para los filtros de servidor** (agrupa el tipeo de los
   `<input type="date">`); el buscador ya no tiene debounce porque no va al backend.

## 3. Por qué el resultado NO cambia

El backend busca con `LIKE` sobre las filas que ya pasaron los filtros de servidor. La lista cargada
es exactamente ese conjunto, así que filtrarlo por los mismos cinco campos da el mismo conjunto.
`tools/service_search_test.ts` lo fija con una **prueba de equivalencia**: reimplementa el `LIKE` de
SQLite (que solo pliega ASCII) y exige que, para una batería de consultas, **toda fila que el backend
devolvería también la devuelve la regla local**. Si esa prueba falla, la optimización estaría
escondiendo órdenes.

Los números que dependen de la lista **no cambian de significado**:
`report`/`WorkPicker` cuentan `porBusqueda` (servidor + búsqueda), o sea lo mismo que contaban antes;
el Resumen del día sigue reusando la lista cargada solo cuando no hay filtros de **servidor** (la
búsqueda ya no cambia qué filas se trajeron).

## 4. Criterios de aceptación

1. `node tools/service_search_test.ts` — 61/61, incluida la equivalencia con el `LIKE`.
2. `cargo test --lib` — verde, con `test_f96_mapa_de_pagos_en_un_solo_viaje` (el lote devuelve lo
   mismo que la consulta de a uno, ordenado, sin inventar ni duplicar).
3. **EN VIVO** (`tools/bench_buscador_servicios.mjs`, sobre una copia con 1400 órdenes): la lista
   sigue **cada tecla** en decenas de ms (no en cientos), pegar la búsqueda entera también, los viajes
   IPC por búsqueda bajan de ~124 a ≤2, y el número de tarjetas coincide con la regla y **no es menor**
   que el que traería el backend.
4. Regresión de las verificaciones en vivo del módulo (alta limpia de filtros, turno viejo, arqueo,
   fecha de pago, smoke integral) sin cambios.
5. `npx tsc -b` 0 · `npx oxlint` 0 errores.
