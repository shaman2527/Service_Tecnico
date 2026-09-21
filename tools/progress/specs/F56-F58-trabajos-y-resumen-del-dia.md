# F56-F61 — «Trabajos hechos» deja de ser un muro de categorías: Resumen del día + un selector + etiquetas limpias

> Pedido del dueño (2026-09-21, con captura de la pantalla de Servicios):
> «el cliente me pide que no quiere tener todas las categorías, así se ve poco profesional. Debería
> tener mejor manera de resolver eso, sea más profesional. Revisá, armame un plan que ellos pueda
> visualizar mejor los equipos que recibieron hoy, lo que entregaron hoy, cuántas pantallas —así como
> sale— pero no desordenado con ese poco de categorías.»

**ESTADO (2026-09-21):** F56 y F57 están IMPLEMENTADAS y verificadas EN VIVO (`tools/verify_resumen_dia.mjs` 24/24 y `tools/verify_trabajos_hechos.mjs` 34/34); F60 (nombre del equipo legible en el selector de modelo) y F61 (avisos: primero el PAGO, la foto al final) implementadas con prueba pura 39/39; F58 y F59 IMPLEMENTADAS y verificadas en vivo (alias de etiquetas 11/11 + «no es un trabajo»); **F60** (nombre del equipo legible), **F61** (avisos: pago primero) y **F64** (todo viaja EN USO: la base de trabajo tenía 857 productos y 862 modelos apagados) también están IMPLEMENTADAS y verificadas; **F62** (crear una categoría con «+» desde el registro) y **F63** (compatibilidad de pantalla elegible por modelo) quedan PENDIENTES. Todas las cerradas quedaron en `done` en `feature_list.json` con los artefactos `tools/progress/artifacts/close-feature-*.json` (el aviso «deploy readiness FAIL» es el ESPERADO: el proyecto está en MODO DEV, sin release ni push). Al final están las **decisiones de negocio** (§7).

**Revisión adversarial (subagente, 2026-09-21) — veredicto inicial BLOQUEADO, con 2 bloqueantes + 5 mayores + 5 menores; TODOS arreglados y re-verificados en vivo:**
1. «Sin trabajo anotado» mostraba «0 entregados · 0 en taller» (número INVENTADO) → el desglose ahora sale de `serviceReport` (`sinTrabajoEntregados/Taller/Anulados`) y no se dibuja si no hay dato.
2. Si el trabajo elegido quedaba sin equipos (elegir + acotar el período), el selector volvía a decir «Todos los trabajos» y la pantalla mostraba tres números contradictorios → muestra la clave con 0 y borde ámbar, el estado vacío lo explica y ofrece «Quitar el trabajo».
3. El resumen pintaba 0 si la consulta fallaba o en el primer pintado → `resumenEstado` (cargando/ok/error), tiles en «—» y aviso: un fallo de lectura NO es un día vacío.
4. «En taller»/«Listos» dejaban puesto el rango y el eje (lista vacía por definición) → limpian fechas y ponen el eje de recibo.
5. El `data-kpi="entregados-hoy"` de F32 seguía el alcance del resumen → se emite SOLO con el alcance en HOY.
6. Doble `getServices` de tabla completa y carrera de respuestas → el resumen reusa las filas de la lista cuando no hay filtros y descarta respuestas viejas (`resumenSeq`).
7. a11y del selector (aria-expanded/haspopup, foco de vuelta, flechas), chequeos vacuos corregidos en los guiones y `data-model-name` desambiguado (`data-model-label`/`data-model-detail`).

> Aclaración del dueño que CIERRA el diseño: «simplemente aplique para todos los clientes, sea intuitivo… se ve feo, mala práctica, tiene que ser profesional» → **nada de reglas condicionales** (no «las categorías solo si elegís un día»): UNA sola forma de la pantalla, igual para todos. Y «que esté oculta y uno elija una específica».
>
> OJO CON EL `dist/`: en este entorno `npx tauri dev` sirve el **`dist/` construido** (la URL es `tauri.localhost`), NO el servidor de Vite. Después de tocar el frontend hay que **`npm run build`** y reiniciar la app; si no, las verificaciones en vivo corren contra el bundle viejo (medido: los chequeos de F57 «fallaban» con el código nuevo ya escrito).

---

## 1. El problema, medido con los números REALES del local

Lo que se ve hoy en `Servicios` (F44, `Services.tsx` ~979-1026) es **una sola barra plana de chips**
que pinta TODAS las etiquetas distintas de trabajo que existan en la lista visible.

El dueño pasó el listado REAL de su pantalla (2026-09-21, en texto): **603 equipos y 50 categorías** = «Todos 603» + 16 canónicas + 33 etiquetas escritas a mano. **24 de esos 49 trabajos tienen UN solo equipo.** Los que mueven el local son otros: Cambio pantalla **323**, Pin de Carga **75**, Revisión **66**, Otro **65**, Cambio batería 27.

| Hecho | Dato de la captura |
|---|---|
| Categorías en pantalla | **50** (1 «Todos» + 49 trabajos) |
| Trabajos con **1 solo equipo** | **24 de 49** (CABLE, CARCASA, correo, fps, placa, sensor, «revision, cornetas», «sustitución de targeta logica»…) |
| Lo que de verdad se hace | Cambio pantalla **323** · Pin de Carga **75** · Revisión **66** · Otro **65** · Cambio batería **27** |
| Etiquetas que **repiten un trabajo que ya tiene su tipo canónico** | batería (2), REPARACIÓN DE BATTERIA (1), placa (1), MANTENIMIENTO (1), BANDEJA SIM (1), flex power (5), flex main (1), boton power (1), Boton encendido (1), cristal de camara (1), correo (1), recuperacion de correos (1)… |
| Etiquetas que **no son un trabajo** | garantía (8), VENTA (3), venta de pantalla (1) |
| Vocabulario **retirado** del formulario | «Cambio conector / puerto» (18) ya no está en `SERVICE_TYPES` |

Y la cabecera dice, en dos líneas de letra chica gris,
`Contando: todos los estados · por fecha de RECIBO · todo el historial · un equipo con varios trabajos
cuenta en cada uno` + `Lista muy larga: el método de pago real se muestra hasta 120 equipos…`:
o sea que **el número que ve el cliente al abrir la pantalla es el de TODO EL HISTORIAL** (603), no el
de hoy. Justo lo contrario de lo que el cliente pregunta («¿cuántas pantallas hiciste hoy?»).

> Nota de honestidad (corregida): la base de producción NO está en este checkout (la `registro.db` de la raíz tiene 5 órdenes y la instalada 0). **El listado de arriba lo pasó el dueño en texto**, así que es la fuente de verdad: la lectura de la captura por imagen NO era confiable en esta sesión (el modelo no acepta imágenes y no había OCR en el entorno). `tools/seed_work_labels_fixture.mjs` construye una COPIA DE DESARROLLO con esa distribución exacta (603 equipos, las mismas 49 etiquetas) para medir el antes/después sin tocar ninguna base real.

## 2. Diagnóstico: son TRES problemas distintos, con tres arreglos distintos

| # | Causa | Por qué se ve poco profesional | Se arregla en |
|---|---|---|---|
| A | **Presentación**: cada etiqueta recibe un chip, sin jerarquía, sin agrupar y sin plegar la cola larga | 46 botones iguales; el trabajo que importa (pantalla, 350) pesa visualmente lo mismo que «fps 1» | **F57** |
| B | **Alcance**: los contadores miran todo el historial y todos los estados | 603 equipos y números que no responden a la pregunta del día («recibieron hoy / entregaron hoy») | **F56** |
| C | **Higiene del dato**: el texto libre de «Otro» genera sinónimos, faltas de ortografía y mayúsculas del mismo trabajo, y se mezclan cosas que no son trabajos | 12 de las 29 etiquetas libres son el MISMO trabajo ya existente escrito distinto; «garantía» y «VENTA» contaminan el conteo | **F58** |

**Arreglar solo A (esconder la cola) es maquillaje**: la próxima semana habrá 40 etiquetas nuevas. El
plan hace A + B + C, con C como lo que impide que el desorden vuelva.

Lo que **NO** se toca (invariantes de F44, hoy verificados en vivo por `tools/verify_trabajos_hechos.mjs`):

1. **el número del chip == las tarjetas que aparecen al hacerle clic == el KPI** (misma función de
   conteo y de filtro: `workKeys` / `matchesWorkFilter`);
2. **los números cierran**: `entregados + taller + anulados === equipos`, y todo equipo cae en un
   trabajo o en «Sin trabajo anotado»;
3. **nada de fusiones adivinadas** (decisión explícita de F44: «adivinar sería peor que mostrar de
   más»). Las equivalencias son una **tabla explícita revisada por el dueño**, jamás un parecido
   automático;
4. **los avisos no bloquean** (doctrina del proyecto): sugerir un alias nunca impide guardar.

## 3. La pantalla nueva (objetivo)

```
 Servicios
 [Buscar…] [Estado ▾] [Recibidos|Entregados] [21/09] a [21/09]  Período: Hoy·7d·30d·Todo   Limpiar
 ─────────────────────────────────────────────────────────────────────────────────────────────
 RESUMEN DEL DÍA        (alcance: Hoy 21/09 · toca un número para filtrar la lista)
 ┌ Recibidos hoy 18 ┐ ┌ Entregados hoy 11 ┐ ┌ En taller 42 ┐ ┌ Listos para entregar 9 ┐ ┌ Monto … ┐
 └ por fecha de recibo ┘ └ por fecha de entrega ┘ └ de todo el taller ┘
 ─────────────────────────────────────────────────────────────────────────────────────────────
 TRABAJOS DEL DÍA                                   18 equipos · 11 entregados · 42 en taller
 Cambio pantalla   350   ████████████████████   312 entregados · 38 en taller
 Pin de Carga       76   ████                    70 · 6          ← fila clickeable = filtra
 Cambio batería     30   ██                      28 · 2
 Revisión           65   ███                     60 · 5
 …
 ▸ Otros 23 trabajos anotados a mano (28 equipos)                                   Ver ▾
```

Reglas de la presentación:

- **Una tabla, no una barra de botones**: cada trabajo es una FILA con cantidad, barra proporcional,
  entregados y en taller **visibles sin pasar el mouse** (hoy esos datos están en el `title`, o sea
  escondidos).
- **Orden por cantidad** (los 4 más hechos primero, destacados) y **no** por orden canónico: el orden
  canónico obliga a leer 16 renglones para encontrar el que importa.
- **Umbral para las etiquetas libres**: en la vista principal solo entran las libres con ≥ 5 equipos
  (o ≥ 2 % de la lista). «Cambio conector / puerto» (18) se sigue viendo —es un trabajo real, aunque
  su vocabulario se haya retirado del formulario— pero «fps 1», «CABLE 1» y «correo 1» se van a
  «Otros», que ocupa **una sola línea**.
- **«Otros (N)» plegable**: al abrirlo, lista con buscador, mismo clic = filtra. Una etiqueta de un
  solo equipo sigue siendo alcanzable en dos clics (nada se esconde de verdad).
- La letra chica de arriba se ordena: el alcance pasa a **una** línea en el encabezado del panel (y el
  aviso de «lista muy larga» queda como aviso ámbar solo cuando ocurre).
- shadcn/Tailwind del proyecto: `Card`, `Table`, `Badge`, `Collapsible`, `Dialog`, `ToggleGroup`,
  tokens de `index.css`. Cero estilos ad-hoc (estándar `harness-design-standards`).

---

## 4. Las features

### F56 — «Resumen del día»: recibidos hoy, entregados hoy y cuántas pantallas
**Qué**: un panel con SU PROPIO alcance (por defecto **Hoy**), encima de la lista, que responde la
pregunta del cliente sin tocar filtros:

- tiles: **Recibidos hoy** (por fecha de recibo) · **Entregados hoy** (por fecha de entrega) ·
  **En taller** · **Listos para entregar** · **Monto del día**; cada uno cliqueable = aplica ese
  filtro a la lista;
- **desglose por trabajo** de lo recibido hoy y de lo entregado hoy («Pantallas 4 · Pin de carga 2 ·
  Batería 1») — el «cuántas pantallas» que pidió el dueño, sin tener que leer un chip;
- **Destacados**: los 3-4 trabajos más hechos del alcance, como números grandes (auto, no
  configurado a mano);
- el alcance se dice SIEMPRE en una línea y con un selector propio (`Hoy · 7 días · Este mes · El
  rango de los filtros`), así el número nunca se puede malinterpretar;
- si el alcance del resumen ≠ el de la lista, un botón «Ver estos N en la lista» los iguala.

**Regla pura nueva** (`src/lib/service-report.ts`, mismo archivo, sin React): `daySummary(rows, hoy)` →
`{recibidosHoy, entregadosHoy, porTrabajoRecibidos, porTrabajoEntregados, destacados}`. Reusa
`workCounts`/`workBucket`: una sola implementación del conteo.

**Criterios de aceptación**
1. Al abrir Servicios, los números de «Recibidos hoy» y «Entregados hoy» coinciden con los KPIs de
   `Entregados hoy` (F32) y con la lista filtrada por ese día (el invariante de F44, ahora también en
   el resumen).
2. «Recibidos hoy» usa **fecha de recibo** y «Entregados hoy» **fecha de entrega**: un equipo recibido
   ayer y entregado hoy cuenta en el segundo y NO en el primero.
3. El desglose por trabajo de un día muestra exactamente las tarjetas que aparecen al hacerle clic.
4. Sin equipos ese día, el panel lo dice («Hoy todavía no se recibió ningún equipo») y no muestra 0
   pelado por todos lados.
5. La lista sigue abriendo en «Todos los estados» (pedido de F44 intacto).

### F57 — De muro de chips a tabla de trabajos con «Otros» plegable
**Qué**: reemplaza la barra de chips (y su letra chica) por el panel de §3: tabla ordenada por
cantidad, barra proporcional, entregados/en taller a la vista, y la cola larga en «Otros (N)».

**Reglas puras nuevas** (`service-report.ts`, con pruebas):
- `splitWorkCounts(counts, {umbral, minShare})` → `{principales, otros}`;
- el chip/fila sigue siendo el MISMO filtro (`key`), así que el invariante 1 se conserva por
  construcción;
- la fila «Otros» es un contenedor, no un filtro: al abrirla se elige un trabajo concreto.

**Criterios de aceptación**
1. Con los datos de la captura, la vista principal ocupa **≤ 8 filas de trabajos + 1 línea de
   «Otros»** (antes: 46 chips en 11 filas).
2. Cada fila muestra cantidad + entregados + en taller sin hover, y el clic filtra con el mismo número
   que muestra.
3. «Otros» abre con buscador y llega a una etiqueta de 1 equipo en ≤ 2 clics, con el mismo resultado
   de filtro que hoy.
4. «Todos» + «Sin trabajo anotado» siguen existiendo (los números cierran).
5. `Help.tsx` describe la pantalla nueva (hoy describe los chips) y `verify_trabajos_hechos.mjs` se
   actualiza **sin perder ninguno** de sus 56 chequeos de invariante.

### F58 — Etiquetas limpias (y que no vuelvan a ensuciarse)
**Qué**: la causa C, en cuatro partes:

1. **Tabla de alias explícita**, pura y revisable: `src/lib/work-aliases.ts` (+ espejo de datos en
   `tools/work_aliases.json`, como se hizo con `canonical_brands.json`), aprobada por el dueño.
   Propuesta inicial (a confirmar, §7):
   `bateria`, `REPARACIÓN DE BATTERIA`, `pila de bateria` → **Cambio batería** ·
   `placa`, `sustitución de targeta logica`, `reparación de marco` → **Reparación (placa)** ·
   `MANTENIMIENTO`, `baño quimico` → **Limpieza / Mantenimiento** ·
   `BANDEJA SIM` → **Cambio de bandeja SIM** · `flex power`, `flex main` → **Cambio flex** ·
   `boton power`, `Boton encendido` → **Reemplazo de botones** ·
   `cristal de camara` → **Cambio cámara** · `tubo de bocina`, `revision, cornetas` → **Cambio
   parlante / micrófono** · `correo`, `recuperacion de correos` → **Software / Formateo** ·
   `Cambio conector / puerto` (vocabulario retirado) → **Pin de Carga** (o el trabajo que diga el
   dueño).
   El alias se aplica a la vez al **contar** y al **filtrar** (una sola función): el número no puede
   mentir.
2. **Sugerencia al escribir** en «Otro»: el campo ofrece las etiquetas ya usadas (datalist/combobox) y
   avisa en gris «ya se usa «Cambio batería»» cuando lo escrito es equivalente por alias. **Aviso, no
   bloqueo.**
3. **Normalizar al guardar**: si el texto libre es equivalente a un tipo canónico, se guarda el
   canónico (con un toast «se guardó como «Cambio batería»»). Así no nacen sinónimos nuevos.
4. **Limpiar lo ya grabado** (opcional, con respaldo): reescribir `service_types` de las órdenes viejas
   aplicando el mapa — **idempotente**, con **dry-run** y respaldo previo, igual que
   `normalize_catalog`/`restore_prices`. Vista previa: «46 etiquetas → 24; se reescriben N órdenes;
   0 montos, 0 fechas y 0 stock tocados» (el invariante es que **solo cambia el texto de la etiqueta**).
   Sin esto, la tabla sigue limpia igual — es cosmético para los reportes viejos.

**Criterios de aceptación**
1. Con la tabla aplicada, los chips de la captura bajan de 45 a **≈21** trabajos reales, sin que
   ningún equipo cambie de bucket ni ningún número deje de cerrar.
2. El alias es **explícito**: un texto no listado NUNCA se fusiona (prueba que fija la decisión de F44).
3. Guardar «bateria» en «Otro» deja la orden con **«Cambio batería»** y lo dice.
4. La reescritura masiva (si se aprueba) es idempotente, con dry-run y respaldo, y se verifica que
   `SUM(amount)`, fechas, stock y `paid_amount` no cambian.
5. Un test de paridad node↔UI (como `canonical_fixtures.json`) impide que la tabla de alias se
   desincronice entre el reporte y el filtro.

### F59 (opcional, según lo que decida el dueño) — «No es un trabajo» y familias
- **`garantía` (8) y `VENTA` (3) / `venta de pantalla` (1)**: no son trabajos hechos. Propuesta: un
  grupo aparte **«No es un trabajo (garantía / venta)»** que se ve pero NO entra en los contadores de
  trabajos ni en «Destacados». Alternativa: alias a un tipo canónico propio. **Decisión del dueño.**
- **Vista por familia** (Pantalla · Batería · Carga y puerto · Placa · Software · Limpieza · Revisión ·
  Otros) con un toggle `Por trabajo | Por familia`. Ojo: una familia muestra **equipos distintos**, no
  la suma de sus trabajos (si no, un equipo con pantalla + batería contaría dos veces). Se deja para
  después salvo que el cliente lo pida.

---

## 5. Orden y esfuerzo

| Orden | Feature | Por qué primero | Tamaño |
|---|---|---|---|
| 0 | **Auditoría de etiquetas** (`tools/audit_work_labels.mjs`, solo lectura) | mide la base real y produce la tabla de alias candidata; sin esto F58 se aprueba a ciegas | chico |
| 1 | **F56** Resumen del día | es LITERALMENTE lo que pidió el cliente (recibidos hoy / entregados hoy / pantallas) y no depende de la limpieza | mediano |
| 2 | **F57** Tabla + «Otros» | mata el muro de chips; es el «se ve poco profesional» | mediano |
| 3 | **F58** Alias + sugerencias | impide que el desorden vuelva | mediano |
| 4 | **F59** «No es un trabajo» / familias | depende de las decisiones de negocio | chico |

## 6. Pruebas (todas las que existen hoy tienen que seguir verdes)

- **Puras (Node)**: `tools/service_report_test.ts` (hoy prueba el conteo, el plegado, el alcance y los
  cierres) — se le agregan `daySummary`, `splitWorkCounts`, la tabla de alias y sus antipatías
  («dos etiquetas distintas NO se fusionan solas»).
- **En vivo (CDP, contra una copia de la base)**: `tools/verify_trabajos_hechos.mjs` (56/56 hoy) se
  extiende — invariante chip==tarjetas==KPI en la presentación nueva, resumen del día vs lista
  filtrada, «Otros» plegable, y el caso «no aparece ninguna etiqueta basura en la vista principal».
  Regresiones que deben seguir verdes: `verify_servicio_cierre.mjs` 17/17, `verify_cola_entregas.mjs`
  13/13, `verify_metodos_en_cobros.mjs` 15/15, `verify_tecnico_y_fecha_pago.mjs` 41/41.
- **Rust**: `cargo test --lib` (129/129 hoy) — F58.3 (normalizar al guardar) toca `add_service_order`
  y necesita test propio; la reescritura masiva va como test `#[ignore]` con `REGISTRO_NORMALIZE_DB`,
  igual que la normalización del catálogo.
- `tsc -b` 0 · `oxlint` 0 · `npm run build` ✓ · `harness_security` PASS · `harness_truth` PASS.

## 7. Decisiones que necesito del dueño (bloquean el diseño, no el código)

1. **¿La pantalla abre en HOY?** Hoy abre en todo el historial (603). Recomiendo: el **resumen** nace
   en «Hoy» con su propio selector, y la **lista** sigue como está (F44 no se deshace). Alternativa:
   que la lista también abra en «Hoy».
2. **¿«Garantía» y «VENTA» son trabajos?** Recomiendo **no** (grupo aparte, F59).
3. **¿Se aprueba la tabla de alias de §4-F58.1?** Es una decisión de negocio: «¿`Cambio conector /
   puerto` es hoy «Pin de Carga», o es un trabajo que querés conservar?». Nada se fusiona sin tu OK.
4. **¿Se limpia lo ya grabado** (reescribir etiquetas viejas con respaldo y dry-run) o solo se limpia
   de acá en adelante?
5. **¿Cuántos trabajos querés ver en la vista principal** sin abrir nada? Recomiendo 4 destacados +
   tabla (≈8 filas) + «Otros (N)».

---

## 8. Paso 0 — auditoría (antes de tocar la UI)

`node tools/audit_work_labels.mjs [--db ruta] [--json]` (solo lectura, como
`tools/audit_inventory.mjs`): imprime

- total de equipos, etiquetas distintas, cuántas con 1 equipo y qué % de los equipos cubren;
- la lista completa ordenada por cantidad, marcando **canónicas / libres / vocabulario retirado / no
  es un trabajo**;
- **candidatos a alias** (pares que caen en la misma clave plegada o que coinciden con una palabra
  clave de un tipo canónico) — como SUGERENCIA para que el dueño apruebe, nunca aplicados solos;
- cuántos chips mostraría la vista nueva con el umbral propuesto (el «antes y después»).

Con ese resultado se cierran las decisiones de §7 y se arranca F56.
