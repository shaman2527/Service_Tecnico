# ESTADO DE LA SESIÓN — traspaso para seguir en este proyecto

> **Regla 0 (del dueño, 2026-10-04): PROHIBIDO tocar `C:\Users\ROBER\project-residend`.**
> Es OTRO proyecto (Residencias Camuri Mar). Acá se trabaja **ÚNICAMENTE** en `C:\Users\ROBER\registro`
> (Registro · Sistema de Servicio Técnico de celulares). No leerlo, no escribirlo, no correrle nada.

---

## 1. Qué quedó HECHO y VERIFICADO (no hay que tocarlo)

### F85 — El inventario se ve ENTERO de frente
Tabla del inventario con `table-fixed` + reparto por columnas: **sin scroll lateral** a 1200/1366/1920, y **apilada**
(una ficha por repuesto, con el rótulo de cada dato) por debajo de 1024 px. El «en uso» es un **interruptor** de verdad
(`src/components/ui/switch.tsx`, `role="switch"` + `aria-checked`). Ancho por `matchMedia` (`src/lib/use-media.ts`).

### F86 — La carga masiva que hace lo que dice (y el inventario que sale del MODELO)
- **El modelo arma la compatibilidad** (`catalog.rs`): si la ficha no trae lista, la lista es su modelo (`A30/A50` = dos
  teléfonos). Antes esa ficha **no entraba al padrón**.
- **La carga nunca escribe un stock negativo** y la vista previa dejó de mentir: una sola cuenta (`stock_final_de`) para
  preview y apply. El caso «ficha en −60 + archivo 30» queda en **0** (no en −30) y el informe lo dice.
- **Modo del stock elegible**: «Sumar (compras)» / «Reemplazar (el archivo es la verdad)».
- **Alias de encabezado de tienda** (+25 de stock, +4 de mínimo) y **aviso en la cara** cuando no reconoce la columna.
- **El stock falso del teléfono se eliminó** de «Modelos» y «Por modelo».
- **La pestaña «Repuesto por modelo» se eliminó** (había tres vistas de lo mismo): `Productos | Modelos | Movimientos | Ajustes`.
- **El conteo físico** dice cuántas fichas quedan en 0 y que eso escribe movimientos de SALIDA.
- **Modales**: red de seguridad en `ui/dialog.tsx` + el patrón de la casa en los de Inventario y los 9 de más tráfico
  (medido: antes el formulario de producto medía 760 px en una ventana de 600 y los botones quedaban **fuera y sin scroll**).

**Verificación de F85/F86 (toda verde, sobre una COPIA de la base):** `cargo test --lib` **199/199** ·
`verify_f86_carga` 20/20 · `verify_carga_csv` 33/33 · `verify_inventory_load` 31/31 · `verify_models_tab` 23/23 ·
`verify_por_modelo` 27/27 · `verify_inventario_rapido` 9/9 · `verify_uso_modelos` 38/38 · `verify_orden_columnas` 12/12 ·
`verify_inventario_responsive` 25/25 · **`verify_smoke_integral` 110/110** · `tsc -b` 0 · `oxlint` 0 errores ·
`npm run build` ✓. Documentado en `AGENTS.md` (secciones F85/F86), `README.md` y `feature_list.json` (85 y 86 = done).

---

## 2. Qué quedó A MEDIAS (F87 — continuar acá)

Pedido del dueño con **su archivo de prueba** en la mano: «mejorame diseño de la carga CSV masiva, el modal sea más
intuitivo para que sea más responsive y organizada. Usá la skill shadcn» + «los errores/compatibilidades… agregarlo o
mejorar eso por sus modelos».

**Spec completa: `tools/progress/specs/F87-carga-masiva-rediseno.md`** (REQ-1..REQ-9, AC-1..AC-8). Archivo de prueba:
**`tools/prueba-carga-catalogo.csv`** (83 filas reales de pantallas Infinix/Tecno, con los códigos `P-02xx` pegados al
nombre y la variante dentro de la etiqueta de compatibilidad).

### Lo que YA está en el árbol y VERDE

| Cambio | Dónde | Estado |
|---|---|---|
| `compat_incluye_modelo` ignora la VARIANTE pegada en la etiqueta (dejaba de avisar en falso) | `src-tauri/src/catalog.rs` | ✅ `test_compat_incluye_modelo_ignora_la_variante_de_la_etiqueta` |
| Recuperar el CÓDIGO pegado al nombre cuando no hay columna de código + `codigos_recuperados` + `columnas_repetidas` en el preview/reporte | `src-tauri/src/csvload.rs` | ✅ `test_f87_separar_codigo_pegado`, `test_f87_codigo_del_local_recuperado_del_nombre`, `test_f87_la_columna_de_codigo_manda_sobre_el_codigo_pegado`, `test_f87_codigo_pegado_en_la_columna_de_nombre_que_se_usa` |
| El paso «Revisar» rediseñado: componente nuevo `CsvRevisionTable.tsx` (ya conectado en `LoadCsvDialog.tsx` para las dos pestañas) + el Alert de códigos recuperados (`data-csv-aviso="codigos"`, `data-csv-codigos-recuperados`) | `src/components/inventory/` | ✅ `tsc` 0 · `oxlint` 0 avisos en esos archivos |

**Puertas ya corridas:** `cargo test --lib` **205 passed / 0 failed / 8 ignored** (base 199 → **6 tests nuevos** ya verdes) ·
`cargo check --lib` sin avisos · `npx tsc -b` **0** · `npx oxlint src` **30 avisos (el baseline del repo) / 0 errores** ·
`npm run build` **✓**.

### Lo que FALTA (poco: verificar en vivo y cerrar)

1. **`cargo build`** con la app **cerrada** (⚠ el `.exe` está bloqueado si está abierta; avisarle al dueño) y relanzarla.
2. **Verificación EN VIVO con su archivo**: `node tools/verify_f87_carga_catalogo.mjs` (ya escrita; **solo lee**, no aplica
   la carga). Mide: sin scroll lateral en el paso «Revisar» (antes del rediseño: **2371 px en una caja de 1213**), el
   aviso falso de `Infinix Gt 20 Pro INCELL` que tiene que **desaparecer**, el de `Tecno Spark 20 Pro ORIGINAL` que tiene
   que **seguir**, y los **83 códigos** recuperados. Los ganchos son `data-csv-*`, `data-aviso-compat`, `data-stock-final`,
   `data-csv-row`, `data-csv-modo-activo`, `data-csv-codigos-recuperados`; si algún selector no coincide con el rediseño,
   ajustarlo (la app viva es la fuente de verdad).
3. **Regresiones** (opcional pero recomendado, sobre la copia): `verify_carga_csv`, `verify_carga_aplica` y, si se toca,
   el humo integral (necesita el día abierto).
4. **Cerrar F87**: `feature_list.json` (id 87 → `done` con los números) + sección `## F87` en `AGENTS.md` + la fila en la
   tabla de herramientas del `README.md`.

---

## 3. Cómo se prueba (receta de este proyecto, aprendida a golpes)

- **La base del taller NUNCA se toca**: `C:\Users\ROBER\AppData\Local\Registro Servicio Tecnico\registro.db`.
  Para probar se trabaja sobre una **copia**:
  `node tools/snapshot_db.mjs --src <origen> --out %TEMP%\copia.db --force --pin-dev`
  (`--pin-dev` deja el PIN de pruebas **1234** en la copia; el origen no se toca).
- **La app se levanta con** `REGISTRO_DB=<copia>` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  y el binario de dev: `src-tauri\target\debug\registro.exe`.
  Para que el binario lleve el frontend nuevo hay que **`npm run build` + `cargo build`**.
- **⚠ `cargo build` FALLA si la app está abierta** (el `.exe` queda bloqueado): cerrarla un momento, recompilar y
  relanzar. El dueño la tiene abierta para usar, así que avisarle antes.
- **Las verificaciones en vivo** (`tools/verify_*.mjs`) necesitan la app abierta con el puerto 9222 y `REGISTRO_DB`
  apuntando a la copia. Algunas **escriben** (aplican cargas/ventas): correrlas SIEMPRE sobre la copia.
  Las que necesitan el día abierto (el humo integral vende y registra) requieren `open_day`
  (`$env:REGISTRO_DB` a la copia + `invoke('open_day', {initialCashUsd:0, tasaBcv:40, tasaEur:45})`).
- **`verify_models_tab.mjs` necesita** `$env:EXPECT_PHONES` y `$env:EXPECT_REVIEW` con los números reales de la copia
  (trae valores fijos viejos: 1134/161).
- **Aprendizaje registrado** en `tools/progress/patterns.md`: comparar el modelo del padrón contra el texto de la
  compatibilidad con `LIKE` da falsos positivos (el padrón guarda el canónico «iphone 11 pro», la compatibilidad la
  etiqueta corta «Apple 11 Pro»); el puente son los `aliases`.

---

## 4. Estado de la app del dueño

- **Está ABIERTA** con **su base real** (964 fichas, 0 ventas) y el **binario viejo** (el de antes de F87), así que puede
  seguir usándola. Al cerrarla y recompilar, la versión nueva trae F85+F86+F87.
- La app real **no se tocó nunca** con las pruebas: todo lo que escribieron las verificaciones fue sobre copias en
  `%TEMP%` (borradas al terminar).
