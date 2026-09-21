# Spec F44 — «Trabajos hechos»: contar pantallas y trabajos por día (2026-09-20, MODO DEV)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV
(sin release, sin push). **Cero cambios en Rust y en la base.**

Pedido del dueño, textual:

> «El cliente me pregunta cuántas pantallas hice hoy o un día en específico. Al revisar en recibido sí
> me aparece, pero no sé si me aparece de verdad la cantidad. Cuando cambio el filtro debería darme los
> servicios que he hecho —cambio de pantalla, por ejemplo, o cambio de pin—; en entregado no me
> aparecen. El filtro predeterminado debería ser todos los estados; el que tengo actual es "activos en
> taller", no debería ser ese. Tengo mucho filtro por todo lados; quiero saber qué servicios hago, que
> todo salga bien reflejado.»

---

## 1. Diagnóstico (medido en el código y en la base real)

| # | Defecto | Evidencia |
|---|---|---|
| D1 | La lista abre con el sentinel `__activos__` («Activos en taller») | `Services.tsx:263` |
| D2 | **Con la base real la lista abre VACÍA**: 4 órdenes, `Entregado`×3 + `Devuelto`×1, ninguna activa | `SELECT status, COUNT(*) FROM services` |
| D3 | Los contadores de trabajos se calculan **solo sobre las órdenes activas** (`enTaller`) y se dibujan solo con count > 0 → al filtrar por entregado/Devuelto **desaparecen todos los chips** | `Services.tsx:459-462` |
| D4 | **El chip puede mentir**: el contador sale de una regla (tipo canónico exacto sobre `enTaller`) y el filtro al hacer clic de otra (`includes(t)` sobre `services`) | `Services.tsx:460` vs `464` |
| D5 | Los KPIs cuentan **otra lista**: «Total Equipos» y «Monto Total» usan `services` (ignoran el chip de trabajo activo) | `Services.tsx:455`, `796` |
| D6 | Los trabajos de **texto libre** («Otro» → el form sugiere «Cambio de pin de carga») **no tienen contador** | `Services.tsx:1822-1824`, `1833` |
| D7 | El estado vacío dice «Sin servicios registrados» **también cuando el culpable es el filtro**; y «Activos en taller» + eje ENTREGADOS es imposible por definición (de ahí el parche `estadoAuto`) | `Services.tsx:916-921`, `853-854` |
| D8 | Al abrir se hacen **dos** consultas (montaje + rebote de 350 ms) | `Services.tsx:389`, `392-395` |

## 2. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** Al abrir Servicio Técnico el filtro de estado es «Todos los estados» y **las órdenes entregadas se ven sin tocar nada** | EN VIVO (`verify_trabajos_hechos`) sobre 2 copias |
| 2 | **[must]** Un equipo **entregado** con `Cambio pantalla` cuenta en su chip; idem `Pin de Carga` y los trabajos de texto libre | `service_report_test` + EN VIVO |
| 3 | **[must]** **El número del chip == las tarjetas al hacerle clic == el KPI «Equipos en la lista»** | invariante en bucle en el test puro + EN VIVO |
| 4 | **[must]** Los números cierran: `entregados + taller + anulados == equipos` y todo equipo está en algún trabajo o en «Sin trabajo anotado» | test puro |
| 5 | **[must]** La pantalla **dice sobre qué cuenta** (estado, eje de fecha, rango y la nota de multi-trabajo) | `scopeLabel` + EN VIVO |
| 6 | **[must]** «Activos en taller» + eje ENTREGADOS **se explica** (no queda una lista vacía muda) y ofrece el arreglo | `scopeProblem` + EN VIVO |
| 7 | **[must]** «Entregados hoy» sigue igual (KPI, botón, panel, `dateField='out'`, inputs = hoy) | `verify_recordatorios` 56/56 |
| 8 | **[must]** **Cero cambios** en Rust/DB: sin migraciones ni columnas nuevas | `cargo test --lib` igual + revisión del diff |
| 9 | **[should]** La lista abre con una sola consulta | se saltea el rebote del montaje |

## 3. Qué se implementó

- **`src/lib/service-report.ts` (NUEVO, puro):** `foldWork` (reusa `normPhoneModel`), `workKeys`,
  **`matchesWorkFilter`** (una sola regla de pertenencia para el conteo Y el filtro), `workBucket`
  (entregado/anulado/taller, el mismo criterio del sentinel del backend), `workCounts` (canónicos en
  orden de `SERVICE_TYPES` + etiquetas libres por cantidad), `serviceReport`, `scopeLabel`,
  `scopeProblem`, `NO_WORK_FILTER`, `ACTIVE_SENTINEL`, `WORK_COUNT_NOTE`.
- **`Services.tsx`:** default `statusFilter = ''`; `estadoAuto` eliminado; `report`/`visibleServices`
  con `useMemo`; KPIs y montos sobre `visibleServices`; línea de reporte
  (`data-report="trabajos"`/`data-report-scope`) + chip **«Sin trabajo anotado»**; estado vacío que
  explica (`data-empty="filtro"`, conservando «Sin servicios registrados» para la base sin datos y sin
  filtros); **un solo «Limpiar filtros»** (`data-action="limpiar-filtros"`); «Período:» + «Todo el
  historial»; `aria-label="Filtrar por estado"` en el Select; aviso si el mapa de pagos no se cargó
  (>120 filas, `data-note="pagos-no-cargados"`); una sola carga inicial.
- **Pruebas:** `tools/service_report_test.ts` **68/68** (incluye control negativo de la regla vieja) ·
  `tools/verify_trabajos_hechos.mjs` **26/26 EN VIVO** sobre dos copias (crea 3 órdenes de prueba con
  monto $0, las borra y comprueba que el stock vuelva; aborta sin `REGISTRO_DB` o sin día abierto).
- **Docs:** `Help.tsx` (contadores + cómo responder «cuántas pantallas hice hoy»), `AGENTS.md` (sección
  F44 + nota del default viejo corregida), `README.md` (módulo, test y script), `feature_list.json`.
- **Scripts en vivo actualizados:** `verify_metodos_en_cobros.mjs` (el paso que forzaba «Todos los
  estados» pasa a comprobar el contrato nuevo) y `verify_tecnico_y_fecha_pago.mjs` (comentario + el
  clic muerto de «Limpiar», que ahora se llama «Limpiar filtros» y borra también la búsqueda).

## 4. Decisiones

1. **El default es una decisión de negocio:** «Activos en taller» escondía justo lo que el dueño
   necesita contestarle al cliente; `estadoAuto` era el síntoma, no la solución.
2. **Un contador que sale de otra regla que el filtro miente:** conteo y filtro comparten
   `matchesWorkFilter`, y la prueba recorre TODOS los chips comparando chip ↔ filas.
3. **Agrupar sin adivinar:** se pliega la etiqueta (mayúsculas/acentos/puntuación) pero NO se fusionan
   textos distintos («Cambio de pantalla» ≠ «Cambio pantalla»).
4. **Se cuenta por EQUIPO** (fila), que es lo que el local llama «cuántas pantallas»; el rótulo lo dice.
5. **Sin tocar el backend:** `status=''` ya significaba «todos» y el sentinel `__activos__` sigue vivo
   (cola de entregas + scripts).

## 5. Fuera de alcance

Reporte por día/semana en el Dashboard; libro único de movimientos de caja (feature 40); saldo/arqueo
(F38/F39) e inventario. Ningún `.exe`, release ni push.
