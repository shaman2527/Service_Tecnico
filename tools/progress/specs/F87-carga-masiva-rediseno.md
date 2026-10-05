# F87 — LA CARGA MASIVA, REDISEÑADA: sin avisos falsos, con los códigos del local y la revisión que se lee de frente

> Pedido del dueño (2026-10-04, con su archivo de prueba en la mano): «**mejorame diseño de la carga CSV masiva, el modal
> sea más intuitivo para que sea más responsive y organizada. Usá la skill shadcn.** Los errores/compatibilidades que no
> están en la base de datos: los productos nuevos no existen y las compatibilidades, si no existen, **agregarlo o mejorar
> eso por sus modelos**».

## Lo que MEDÍ con su archivo real (83 filas) antes de tocar nada

Archivo: `NOMBRE;Producto;En uso;Categoría;Marca;Modelo;Variante;Precio;Costo;Stock;Mín;Compatibilidad` (guardado en el
repo como `tools/prueba-carga-catalogo.csv`). Pasado por `preview_inventory_csv` en la app viva:

| Medición | Resultado |
|---|---|
| Filas / nuevas / a actualizar | 83 · 16 · 67 |
| Errores de fila | **0** |
| Columnas ignoradas | **0** |
| Avisos «la compatibilidad no incluye a su propio modelo» | **25 de 83 → FALSOS POSITIVOS** |
| Códigos recuperados (`P-0207`, `P-1036`…) | **0 de 83 → se pierden todos** |
| Tabla del paso «Revisar» | **2371 px dentro de una caja de 1213 px → SCROLL LATERAL** (18 columnas) |
| Consecuencia | «Avisos» y «Qué hacer» quedan **fuera de la pantalla**; los 20 avisos no se ven al abrir el paso |

### Causa del defecto 1 (avisos falsos)

El local escribe **la variante dentro de la etiqueta de compatibilidad** —como habla el mostrador—:
fila 2 = modelo `Gt 20 Pro`, variante `INCELL`, compatibilidad `Infinix Gt 20 Pro INCELL / Infinix Note 40 INCELL`.
`catalog::compat_incluye_modelo` comparaba claves de teléfono sin contemplar la variante pegada → avisaba en falso.
**Ojo**: en el mismo archivo hay un caso que SÍ es incoherente y tiene que seguir avisado («Tecno Spark 20 Pro ORIGINAL»
con una lista de Spark 10 / Spark Go 2023 / Pop 7…): el arreglo tiene que distinguir los dos.

### Causa del defecto 2 (los códigos)

Su Excel trae el código **pegado al nombre** en la segunda columna: `Producto` = `Infinix Gt 20 Pro (INCELL)P-0207`.
Esa columna mapea a `Name` (alias `producto`) **igual que `NOMBRE`**, así que se descarta en silencio (gana la primera) y
`code` queda vacío en las 83 filas. El código es la llave con la que el dueño busca sus productos.

## Requisitos

- **REQ-1 (Rust)** — `compat_incluye_modelo` ignora la **variante/material** que la etiqueta lleve pegada (misma regla que
  `variant_in_text`/F53, no una nueva) y **sigue avisando** cuando la lista no nombra al modelo de verdad.
- **REQ-2 (Rust)** — si el archivo **no trae columna de código**, se recupera un código pegado (`[A-Za-z]{1,3}-\d{3,6}`,
  p. ej. `P-0207`) del texto de las columnas de nombre; viaja como `row.code` y se cuenta en `codigos_recuperados`.
  Si el archivo trae columna de código, esa manda (sin cambios).
- **REQ-3 (Rust)** — el preview informa `columnas_repetidas: string[]` (encabezados descartados por repetir campo, ej.
  «Producto») para que la UI lo pueda decir en vez de descartarlos en silencio.
- **REQ-4 (UI)** — **cero scroll lateral** en el paso «Revisar» a 1366×715 y a 1200: agrupar el detalle secundario
  (precios, ficha) y/o desplegarlo por fila, con el criterio que ya usa `ProductsTab` (`table-fixed` + `colgroup` +
  truncado con `title`). **No vale** dejar la barra horizontal «porque se puede arrastrar».
- **REQ-5 (UI)** — lo que el dueño decide, en la primera pantalla: el **modo del stock** (ya está y funciona), el
  **resumen** (crear/actualizar/dejar/eliminar/unidades/en negativo→0) y **los avisos de cada fila visibles**.
- **REQ-6 (UI)** — organización por decisiones: qué ficha, con qué datos, qué va a pasar con ella y si tiene un problema;
  primitivas del sistema (Badge/Alert/Separator/Tooltip), jerarquía (nombre y problema primero) y el detalle agrupado.
- **REQ-7 (UI)** — a ventana angosta (<~1100 px) la revisión se **apila** (una ficha por fila) sin scroll lateral,
  reusando `useVentanaAngosta()` de `src/lib/use-media.ts`.
- **REQ-8 (UI)** — cuando el backend lo traiga, decir en pantalla «usé «NOMBRE» y descarté «Producto»; de ahí saqué N
  códigos» y mostrar el código de cada fila. Defensivo si el campo no viene.
- **REQ-9 (contrato)** — los `data-*` y `aria-label` que usan las verificaciones en vivo NO se renombran.

## Criterios de aceptación

| AC | Cómo se comprueba |
|---|---|
| AC-1 | Con `tools/prueba-carga-catalogo.csv`, los avisos de compatibilidad bajan de **25 a los que son de verdad** (el de Spark 20 Pro ORIGINAL se queda) | test Rust + EN VIVO |
| AC-2 | Las 83 filas traen su **código** (P-02xx) recuperado del texto pegado | test Rust + EN VIVO |
| AC-3 | El preview informa `codigos_recuperados` y `columnas_repetidas` con «Producto» | test Rust |
| AC-4 | El paso «Revisar» **no tiene scroll lateral** a 1366×715 ni a 1200 | EN VIVO (medido: tabla ≤ caja) |
| AC-5 | Los **avisos de las filas se ven sin arrastrar** (el aviso está en la parte visible de la fila) | EN VIVO |
| AC-6 | El modo del stock, el resumen y el botón de aplicar siguen funcionando igual | `verify_f86_carga` + EN VIVO |
| AC-7 | A ventana angosta la revisión se apila y sigue sin scroll lateral | EN VIVO |
| AC-8 | Las verificaciones existentes siguen verdes (los ganchos no se renombraron) | `verify_carga_csv` + `verify_carga_aplica` + humo |

## Fuera de alcance

- Crear productos/«teléfonos» que no existen: **ya lo hace** (`rebuild_phones` arma el padrón desde la compatibilidad de
  lo cargado); lo que faltaba era recuperar el código y no avisar en falso. Se verifica con el padrón antes/después.
- Cambiar la semántica del stock (modo sumar/reemplazar) o la del conteo físico (F86).
