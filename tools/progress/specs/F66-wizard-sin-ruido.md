# Spec F66 — El wizard de servicio pierde el ruido y la pantalla se elige junto al modelo

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Cuatro reportes del dueño con la app abierta y el wizard de recepción en pantalla (2026-09-23), todos
sobre el mismo objetivo declarado por él: **«estoy intentando que el wizard sea más intuitivo, más
rápido, optimizado a factura»**.

---

## 1. Los pedidos, textuales

1. **La ficha de ingreso ocupa demasiado:** «cuando vas a crear un servicio esta información ocupa
   demasiado espacio del wizard, no debería estar ahí, está muy grande» (listaba 4 renglones:
   título + progreso + «faltan N obligatorios» + el dato pedido + «para completar (no bloquea)» +
   «siguiente en el proceso»).
2. **El descuento:** «hay este botón de descuento grande, ese input no debería estar ahí o si está que
   uno aplique y coloque un monto X; de todas maneras tengo botón de descuento en la card».
3. **La pantalla del modelo:** «el input debería estar cerca al colocar el modelo, que pueda elegir la
   pantalla de ese modelo o su compatibilidad, pero con el beneficio de buscar otra pantalla que desee
   el operador seleccionar; en sí tiene que salir para ese modelo en específico y sus compatibilidades».
4. **El desplegable del modelo:** «cuando colocas un modelo, selecciono el modelo, se cierra el
   desplegable; no tenga que darle dos veces al modelo para cerrarlo».

## 2. Diagnóstico (medido en la ventana real, no supuesto)

| # | Qué se midió |
|---|---|
| 1 | `[data-ficha]` = **157 px** de alto dentro de un diálogo de 629 px (un 25% del wizard), repetido en cada paso |
| 2 | El bloque «Descuento ($)» era un renglón de ancho completo + 2 líneas de ayuda (~90 px) en los dos formularios, mientras el botón «Descuento» de la tarjeta (F49) ya cubre las órdenes guardadas |
| 3 | El bloque de pantalla vivía **después** de los trabajos y de la falla, y solo ofrecía las pantallas compatibles |
| 4 | `pick()` cerraba la lista y llamaba `inputRef.focus()`; ese `focus` dispara `onFocus → setOpen(true)` → **la lista se reabría** en el mismo instante (de ahí el «dos veces») |

## 3. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** La ficha de ingreso ocupa **una línea** y el resto (los 4 bloques, los obligatorios que faltan, los avisos que no bloquean y la explicación del paso siguiente) se consulta con **«Ver ficha»** | Medición en vivo: 157 → 61 px + `verify_recordatorios` 67/67 |
| 2 | **[must]** La ficha NO usa la palabra «Falta:» (el pie de cada paso la usa para ESE paso) | `verify_wizard_metodos` 18/18 y `verify_smoke_integral` 110/110 |
| 3 | **[must]** «Ir al campo» sigue en la línea visible y lleva al paso + foco del dato | `verify_tecnico_sin_asignar` 32/32 (foco = `color`) |
| 4 | **[must]** El descuento queda **al lado del precio** en los dos formularios, con el total visible solo si hay descuento, y **no cambia ninguna cuenta** (monto, total, factura, arqueo) | Sonda en vivo + `verify_descuento` 15/15 + `receipt_acuerdo_test` |
| 5 | **[must]** El bloque de pantalla aparece **debajo del modelo** y muestra las compatibles de ESE modelo con stock y aviso de otra marca | Sonda en vivo (`pantallaDebajoDelModelo: true`) + `verify_compat_pantalla` 12/12 + `verify_pantalla_agotada` 16/16 |
| 6 | **[must]** Se puede **buscar cualquier pantalla** del catálogo (las tres categorías de pantalla) y la elegida a mano **descuenta igual** y **no bloquea el guardado** | Sonda en vivo: búsqueda «Redmi 9A» → elegida + aviso + «Siguiente» habilitado |
| 7 | **[must]** La pantalla buscada se suelta al **cambiar de modelo** (no arrastra el repuesto de otro equipo) | Código + sonda (`screenExtra` se limpia con `device.model`) |
| 8 | **[must]** Elegir un modelo **cierra** el desplegable, con el foco en el campo para seguir tipeando | Sonda: tras elegir `[data-model-option]` = 0 |
| 9 | **[must]** Volver a hacer clic en el campo **reabre** la lista, y el **chevron** abre Y cierra | Sonda: clic → lista; chevron → abre/cierra/abre |
| 10 | **[must]** El alcance «solo lo que uso» / «Ver todos» sigue funcionando después de elegir (rótulo + `localStorage`) | `verify_uso_modelos` 37/37 |

## 4. Implementación

- **`FichaIngreso.tsx`**: una fila (`ficha-progreso` · `Siguiente dato: …` · `Siguiente en el proceso: …`
  · chip `⚠N` · `Ir al campo` · `Ver ficha`), con la guía de cada dato en el `title`; el detalle
  (`data-ficha-detalle`) junta los 4 bloques + `data-ficha-faltan` + `data-ficha-notas` + `data-ficha-paso-detalle`.
- **`Services.tsx`** (los dos formularios): `Monto [..] − [Desc.]` en la misma fila y el total solo con
  descuento; el bloque `ScreenSelect` movido justo debajo del modelo/monto/color; `screenExtra` en el
  estado del formulario (`FormDevice` / `useState`) + `screenOptionsTodas` (la buscada se suma a las
  compatibles para que figure elegida y con sus avisos).
- **`ScreenPicker.tsx`**: `permiteBuscar` + `onPickOtra`, búsqueda con rebote en las categorías 1/18/19,
  `match_quality: 'buscada'` y el aviso «no figura en la compatibilidad de este modelo»; la lista se
  acortó a 160 px.
- **`ModelCombobox.tsx`**: `focusSinReabrir` (el foco posterior a elegir no reabre) + `onClick` en el
  campo (siempre muestra la lista) + chevron que alterna de verdad.
- **`types.ts`**: `match_quality` suma `'buscada'` (y `ByModelTab` su etiqueta «Elegida a mano»).

## 5. Pruebas (todas EN VIVO, en serie)

| Prueba | Resultado |
|---|---|
| Sonda del wizard (medidas y flujos nuevos) | ficha 157→61 px · descuento en la fila del monto · pantalla debajo del modelo · búsqueda → elegida + gate OK |
| Sonda del combobox | elegir → 0 opciones · clic en el campo → vuelve · chevron abre/cierra · «Ver todos» sigue |
| `verify_wizard_metodos` · `verify_compat_pantalla` · `verify_tecnico_sin_asignar` | 18/18 · 12/12 · 32/32 |
| `verify_pantalla_agotada` · `verify_service_screen_stock` · `verify_descuento` | 16/16 · 6/6 · 15/15 |
| `verify_recordatorios` · `verify_uso_modelos` · `verify_modelo_legible` | 67/67 · 37/37 · 13/13 |
| `verify_smoke_integral` | **110/110** |
| Reglas puras (`category_rules`, `queue` + screen-rules) | 42/42 · 72/72 |
| `npm run build` · `oxlint` | ✓ · 0 errores |

## 6. Lecciones

- **Del producto:** dos palabras iguales para dos cosas distintas confunden al operario **y** rompen
  las pruebas que deciden con ellas («Falta:» del paso vs. «Siguiente dato:» de la ficha).
- **De la interacción:** un `focus()` programático puede **reabrir** un desplegable (`onFocus`), y un
  clic sobre un campo **ya enfocado** no dispara `focus` — las dos caras del mismo detalle. Se
  verifican con una sonda, no razonando.
- **Del método:** **dos scripts de CDP no pueden correr a la vez** sobre la misma ventana (se pisan
  clics, foco y hasta los conteos de la base: dio un «servicios 7 → 6» que parecía un bug del producto).
- **De las pruebas:** una prueba que **depende de un bug** deja de ser una prueba (F50 seguía
  clickeando dentro de una lista que solo quedaba abierta por el bug), y una prueba que necesita datos
  que el producto ya no tiene (F64 dejó todo «en uso») **se prepara su propio fixture** en vez de fallar.
