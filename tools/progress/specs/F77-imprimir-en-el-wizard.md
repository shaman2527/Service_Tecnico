# F77 — Imprimir al cerrar el registro del wizard (check predeterminado) + el aviso de política EN GRANDE

**Pedido del dueño (2026-09-25), textual:**

> «quiero que en el wizard dejando las card con sus botones, como están. pero cuando esté haciendo un
> registro tenga la opción de imprimir directamente en el proceso. si le doy clic a imprimir salga el
> mensaje que tenemos que diga o algo más en grande que diga *Toma la foto al Teléfono*, y el mensaje
> del modal que pregunta si va a pagar ahora o al retirar que sea más grande ese mensaje de aviso el
> que ya tenemos. al final salga para imprimir como te dije al principio con un check predeterminado
> que pregunte si va a imprimir o después; la idea de esto es aprovechar el mismo proceso de wizard
> para cerrar el registro completo.»

## Decisiones confirmadas con el dueño (preguntas cerradas antes de implementar)

1. **«Módulo 2» = el 2º aviso del guardado/impresión** (el del pago), NO un aviso nuevo en el paso 2
   del wizard: se agranda el texto del aviso que ya existe. No se agrega ningún modal durante el
   llenado (se respeta F33: nada flota sobre el formulario mientras se registra).
2. **La impresión va SOLO al final del wizard**, con un check **premarcado** y el botón del último
   paso como «Guardar e imprimir» / «Actualizar e imprimir». Sin botón de imprimir suelto.
3. **El aviso sale DESPUÉS del comprobante**, como hoy: se conserva la regla de F54 (el modal nunca se
   dibuja sobre un diálogo abierto; queda encolado y aparece al cerrarlo).

## Problema / oportunidad

Hoy el registro de una recepción termina cuando se cierra el wizard: para imprimir el comprobante el
operario tiene que **buscar la orden en la lista** y pulsar el botón «Orden» de la tarjeta. El
mostrador imprime el papel con el cliente enfrente, así que ese paso de más se nota. Y los dos avisos
de política (foto del teléfono y acuerdo de pago) se leen en letra chica (título de 11 px, mensaje de
14 px) en una pantalla de mostrador.

## Alcance (3 archivos de UI + pruebas + docs; CERO Rust, CERO SQL, CERO migraciones)

### REQ-1 — El aviso de política se lee de lejos (`src/components/PolicyModal.tsx`)

- Título (`reminder.title`): `text-[11px] font-bold uppercase tracking-widest` →
  **`text-xl font-black uppercase tracking-tight leading-tight`**.
- Mensaje (`reminder.message`): `text-sm leading-snug` → **`text-lg font-medium leading-snug`**.
- Tarjeta `w-[min(92vw,26rem)] p-5` → `w-[min(94vw,30rem)] p-6`; círculo del icono `size-11` → `size-14`
  (icono `size-5` → `size-7`); botón de la acción principal `h-8 text-xs` → `h-10 px-4 text-sm`;
  secundarios `h-9`; «Después» y la ✕ quedan chicos (siguen siendo la salida rápida).
- Ganchos nuevos `data-policy-title` y `data-policy-message` (para medir el tamaño computado en vivo).
- **Sin cambios de lógica**: cola, dedupe por aviso+orden, tinte por tono, «un toque cierra», Escape y
  `z-40` por debajo de los diálogos.

### REQ-2 — La línea grande dice qué hacer (`src/lib/reminders.ts`)

- `FOTO_ENTRADA.title`: `'Foto de ENTRADA'` → **`'Toma la foto al teléfono'`**.
- `FOTO_SALIDA.title`: `'Foto de SALIDA'` → **`'Toma la foto al entregar'`**.
- `PREGUNTA_PAGO.title`: `'Pregúntale al cliente'` (**sin cambios**) y su mensaje
  («¿Va a pagar ahora o al retirar el equipo? Pregúntale también con qué método va a pagar.») **igual**:
  se agranda por REQ-1.
- **Ningún `message` cambia** (la política de la empresa, el plural «a los N teléfonos de la orden» y
  «pagar» en vez de «cancelar» siguen fijados por los tests que ya existían).
- **La lógica de CUÁNDO sale cada aviso no se toca** (invariantes: nunca bloquean, no insisten por lo
  ya resuelto, tope de 2, orden en pantalla pago → entrada → salida).

### REQ-3 — Imprimir dentro del wizard (`src/components/Services.tsx`)

- Prop nueva `onPrint?: (s: Service) => void` en `ServiceForm`; el padre la conecta a la vía que ya
  existe: `onPrint={s => setPrintFor(s)}` (la misma de la tarjeta, `EntregadosHoy` y el asistente de
  cierre).
- Estado `imprimirAhora` **premarcado** (`true`) en crear y en editar.
- Bloque nuevo en el **último paso** (crear «Revisar y guardar», editar «Cierre de la orden»):
  - título «Al guardar», check `data-field="imprimir-al-guardar"` premarcado
    **«Imprimir la orden ahora (abre el comprobante al guardar)»**;
  - ayuda: «Si lo destildás, la orden se guarda igual y la imprimís después con el botón «Orden» de la
    tarjeta.»;
  - con varios equipos: «Se abre el comprobante del equipo 1; los demás se imprimen desde su tarjeta.»
- El botón del último paso cambia de rótulo según el check: **«Guardar e imprimir» / «Actualizar e
  imprimir»** (marcado) vs los actuales «Guardar Servicio (N equipos)» / «Actualizar Servicio». El
  `disabled` **no cambia**.
- En `save()`, **después** del `onSaved()` final (nada se imprime si el guardado se bloqueó o falló):
  - crear: se imprime la orden BASE de las filas ya releídas (`filas.find(r => r.order_num === base) ?? filas[0]`);
  - editar: se relee la orden (`api.getService(service.id)`) y se imprime;
  - sin check, sin `onPrint` o sin fila → no se abre nada (el registro ya quedó guardado).
- El comprobante es una **vista previa**: el papel sigue saliendo con su botón «Imprimir». Por eso el
  check premarcado no gasta papel ni sorprende.
- Secuencia resultante: Guardar → se cierra el wizard → se abre el comprobante → al cerrarlo aparecen
  los avisos ya encolados (el dedupe `policy-<clave>-<orden>` impide que se muestren dos veces).

### REQ-4 (F77b) — La pregunta del pago va ANTES del modelo (`src/components/Services.tsx`, `src/lib/ficha.ts`)

Segundo pedido del dueño en la misma jornada: «el método de pago, el mensaje debería preguntarlo antes,
en [el paso] 2 «Equipo», antes de colocar el modelo de teléfono, así le avisa para colocar el monto o un
producto en ese momento».

- En el paso **Equipos / Equipo y diagnóstico** (índice 1) el bloque del pago (`data-policy-block="pago"`) y el
  **método de pago** de cada equipo (`data-device-pay` en el alta, `data-device-pay="edit"` en la edición,
  con su comisión/moneda/referencia) van **ARRIBA del campo del modelo** (se comparan las posiciones con
  `getBoundingClientRect().top`) — en el alta **y** en la edición, que pasan por el mismo paso.
- El bloque del pago se **mueve** (no se duplica): ya no está en el último paso → **no se pregunta dos
  veces**. Mismo estado (`payIntentSel`), una sola fuente. El paso «Finanzas» de la edición se queda con
  el **estado** (y con el tilde de la foto de SALIDA, que depende del estado: ver «revisión adversarial»).
- En el alta se agrega el aviso `data-pay-early-hint`: «Aprovechá que el cliente está enfrente: al lado de
  cada equipo está el método de pago, y abajo el monto y —si lleva repuesto— el producto (la pantalla)…».
- `lib/ficha.ts`: el paso del dato `pay_intent` cambia de **3 → 1** (el «Ir al campo» de la ficha tiene que
  llevar al paso donde el control vive de verdad).

### Revisión adversarial (2 subagentes) y arreglos

1. **[MAYOR] F77b no se cumplía en EDICIÓN:** el método de pago seguía en «Finanzas», DESPUÉS del modelo,
  mientras la spec y `AGENTS.md` afirmaban «crear y editar». Arreglo: el bloque del método (picker +
  comisión Punto + moneda + referencia) se mudó también al **paso del equipo** de la edición, con su
  propio gancho `data-device-pay="edit"`, y «Finanzas» queda con el ESTADO. La prueba en vivo ahora cubre
  la edición (abre la orden, entra al paso del equipo y compara posiciones; y comprueba que «Finanzas» ya
  no tiene el método — no está duplicado).
2. **[MENOR] El tilde de la foto de SALIDA quedó desacoplado** de su control: vivía pegado al bloque del
  pago y, al moverlo al principio del paso del equipo, aparecía en una pantalla donde el operario todavía
  no había elegido el ESTADO (que es lo que decide si el equipo ya salió). Arreglo: se extrajo
  `PhotoOutField` y se puso en el paso «Finanzas», al lado del selector de estado, con la **misma
  condición de siempre** (`isDelivered(status) || status === 'Por entregar'`).
3. **[MENOR] Texto que quedó mintiendo:** el bloque del pago decía «con qué método paga se elige arriba» y
  con F77b el método puede estar debajo (alta) u en otro paso (edición) → se corrigió la frase.
4. **[NIT] `?? filas[0]`** en la elección de lo que se imprime: si la relectura no traía la fila base, ese
  fallback podía abrir el comprobante de una **variante vieja** `base-…`; ahora el fallback es **no
  imprimir** (la orden quedó guardada y se imprime desde su tarjeta).
5. **Verificado correcto por los revisores:** el comprobante sale de la fila realmente guardada (crear:
  match exacto del `order_num` base; editar: relectura por id); el check no imprime si el guardado se
  bloqueó; abrir el comprobante NO marca la orden como impresa; F54 y F33 intactos; el reordenamiento del
  método es un cut-and-paste idéntico (mismos bindings, sin resetear el descuento); y los scripts de
  regresión no quedaron con aserciones vacuas.

## Fuera de alcance (explícito)

- **Las tarjetas de la lista y sus botones, idénticos** (incluido «Orden / Reimprimir»).
- `PolicyModalHost`, `policy-queue.ts`, `policy-actions.ts`: sin cambios de lógica.
- `FichaIngreso.tsx` (la ficha en pantalla) y su contador «X/16 datos»: **sin cambios visuales**. De
  `lib/ficha.ts` cambia UNA cosa por F77b: el paso del dato `pay_intent` (3 → 1), porque el control se
  mudó de paso y el «Ir al campo» tiene que llevar donde el control vive.
- Entregar/cobrar sigue siendo un acto aparte (asistente «Cerrar» / botón «Entregar»).
- Backend: ningún comando, tabla, columna ni migración.

## Criterios de aceptación (medibles)

1. En el último paso del wizard existe el check `data-field="imprimir-al-guardar"` y está **marcado** por
   defecto; el botón del paso dice «Guardar e imprimir» (crear) / «Actualizar e imprimir» (editar).
2. Guardando con el check marcado, se crea la orden **y se abre el comprobante** de esa orden (título
   «Orden de servicio · <n>» con el número recién creado, verificado además contra la base).
3. Destildando el check, el botón vuelve a «Guardar Servicio» y **no se abre ningún diálogo**: la orden
   igual queda guardada.
4. Al cerrar el comprobante aparece el aviso de política, con **título ≥ 18 px** computados y **mensaje
   ≥ 16 px**, y el título de la foto dice «Toma la foto al teléfono».
5. El aviso **no** se dibuja con el comprobante abierto (F54 intacto).
6. **(F77b)** En el paso «Equipos» la pregunta del pago y el método de pago del equipo están **por encima**
   del campo del modelo (comparado por `top`), y el último paso **no** vuelve a preguntar el pago.
7. `node tools/reminders_test.ts` (46/46) y `node tools/ficha_test.ts` (76/76) verdes.
8. `npm run build` y `npx oxlint` sin errores; regresiones EN VIVO verdes.

## Pruebas

- **Puras:** `node tools/reminders_test.ts` **46/46** (títulos nuevos + todo lo anterior),
  `node tools/policy_queue_test.ts` **13/13**, `node tools/ficha_test.ts` **76/76** (paso del pago 3 → 1).
- **EN VIVO (nueva):** `node tools/verify_imprimir_en_wizard.mjs` **40/40** (CDP; aborta sin día abierto,
  exige `REGISTRO_DB` sobre una COPIA y borra sus órdenes; incluye los 5 chequeos de F77b).
- **Regresiones EN VIVO:** `verify_recordatorios.mjs` **69/69**, `verify_tecnico_sin_asignar.mjs` **33/33**,
  `verify_aviso_no_tapa.mjs` **14/14**, `verify_wizard_metodos.mjs` **18/18**, `verify_servicio_cierre.mjs`
  **18/18**, `verify_pantalla_agotada.mjs` **16/16**, `verify_precio_pantalla.mjs` **52/52**,
  `verify_smoke_integral.mjs` **109/110** (el único fallo es del entorno: el smoke compara la última venta
  del día y en la copia sembrada hay una venta de hoy a las 11:30 con «Pago Móvil» que se le adelanta — la
  venta que crea el smoke SÍ quedó en «Divisas (USD Cash)», verificado en la base).
- **Build:** `npm run build`, `npx tsc -b`, `npx oxlint`, `cargo build --release`.

## Riesgos

- **El pie del wizard cambia de alto** → las pruebas CDP que clickean por coordenadas pueden fallar
  (lección de F48). Mitigación: las regresiones en vivo se corren y se arreglan con `waitFor` y clic por
  elemento, nunca por coordenada fija.
- **Check premarcado que moleste en una corrección**: el comprobante es una vista previa (no imprime
  papel) y se cierra con un toque; aun así queda destildable y la ayuda dice dónde se imprime después.
