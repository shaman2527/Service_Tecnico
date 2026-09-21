# Spec F45–F48 — Alta guiada y avisos que NO bloquean (2026-09-20, MODO DEV)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
**Cero cambios en Rust y en la base**: son reglas de UI + reglas puras con pruebas.

Pedidos del dueño, textuales:

> **F45** «cuando vas a crear nuevo servicio [el técnico] esté predeterminado como sin asignar, lo deje seguir registrando el servicio nuevo y en la card aparezca una señal con un color: necesita asignar al técnico para ese trabajo».
> **F46** «el mensaje trata que sea centro de la pantalla, que la tenga que marcar como que sí tomó la foto también del teléfono, estilo modal bloqueante, colores suaves».
> **F47** «esto también dejarlo predeterminado, que no te bloquee pero sí deje el mensaje en rojo: *Esa pantalla no tiene stock* / *Si se entrega igual, el inventario de «Apple 5G» queda en -1 y el movimiento se marca como faltante*».
> **F48** «en los colores que sea un campo requerido; si no selecciono un color lo salte de una vez a que elija un color, y cuando está agregando un servicio hacerle una observación pero no bloqueante: falta número de tlf del cliente… que sea intuitivo, se ayude con teclado enter, lo vaya llevando de la mano» + «en los colores de servicios agregar un color más lila y marrón».

---

## 1. Qué se implementó

| Feature | Cambio | Regla pura |
|---|---|---|
| F45 | El técnico arranca en **«Sin asignar»** (se quitó el `last_technician` de localStorage) y la tarjeta en taller muestra el chip ámbar **«Falta asignar técnico»** (`data-needs-tech`, clickeable → selector rápido de F34) | `needsTechnician()` en `lib/service-guide.ts` |
| F46 | El recordatorio de política es un **modal centrado** (`PolicyModal.tsx`, cola en `policy-queue.ts`): velo suave, tinte claro por tono, acción a un toque y **«Después»**; bloquea la pantalla, nunca los datos | `policy-queue.ts` (dedupe por aviso+orden, FIFO) |
| F47 | `screenOk` ya no exige confirmar una pantalla **agotada**: el aviso queda **en rojo** con el texto del inventario y la confirmación arranca marcada; el gate que sigue es ELEGIR la pantalla | `outOfStockChoice()` en `lib/screen-rules.ts` |
| F48 | **Color obligatorio** (ficha `falta` + paso + guardado), **observaciones que no bloquean** (teléfono, técnico) y **«Ir al campo» con foco** (`data-ficha-target`); colores nuevos **Lila** y **Marrón** | `buildFicha` → `notas: FichaNota[]` y `color` required |

## 2. Criterios de aceptación

| # | Criterio | Comprobación |
|---|---|---|
| 1 | Al crear, el técnico está en «Sin asignar» **aunque** `last_technician` tenga un valor, y la orden se guarda sin técnico | EN VIVO (`verify_tecnico_sin_asignar` 30/30) |
| 2 | La tarjeta de una orden en taller sin técnico muestra la señal ámbar; al asignar **desaparece**; una **entregada** no la muestra | EN VIVO + `needsTechnician` (service_guide_test 44/44) |
| 3 | El recordatorio de política sale **centrado** (≤40px), con **velo que bloquea**, **tinte claro** y `role=alertdialog`; se responde con un toque o con **«Después»** (que no anota nada) | EN VIVO (verify_recordatorios 65/65) + policy_queue_test 13/13 |
| 4 | El mismo aviso **no se apila** y va **por encima** del comprobante (z-index) | EN VIVO + policy_queue_test |
| 5 | Una pantalla **agotada** muestra el aviso **rojo** con «queda en N-1» y «faltante», con la confirmación marcada por defecto, y **no bloquea** el guardado ni el cierre | EN VIVO (`verify_pantalla_agotada` 16/16) + queue_test 66/66 |
| 6 | Sin pantalla ELEGIDA (habiendo opciones) el guardado sigue bloqueado | queue_test + EN VIVO |
| 7 | El **color** es obligatorio: la ficha lo marca, el paso no avanza sin él y el guardado lo exige | ficha_test 75/75 + EN VIVO |
| 8 | El **teléfono** vacío es una **observación** («Falta el número de teléfono del cliente») y **no bloquea** el guardado | ficha_test + EN VIVO (guardado habilitado con el teléfono vacío) |
| 9 | «Ir al campo» deja el **foco** en el control del dato (`data-ficha-target`) | EN VIVO (foco=`color`) |
| 10 | La lista de colores incluye **Lila** y **Marrón** sin tocar los datos ya guardados (el color se guarda por nombre) | revisión + build |
| 11 | **Cero cambios** en Rust/DB (sin migraciones ni columnas) | diff + `cargo test` sin cambios |

## 3. Riesgos y decisiones

- **Bloqueo controlado:** F47 saca un bloqueo (pantalla agotada) y F48 agrega otro (color). El criterio del dueño: bloquear donde el dato se ELIGE (color), avisar donde el hecho ya ocurrió (pantalla agotada, teléfono faltante).
- **Datos viejos:** una orden sin color pide elegirlo al editarla (consecuencia de hacerlo obligatorio). Queda documentado; el asistente lleva al selector con un toque.
- **Modal bloqueante y pruebas:** un modal que intercepta clics cambia el orden de los scripts (responder o posponer antes de seguir) y `Escape` no puede cerrar dos capas a la vez.

## 4. Fuera de alcance

Nada de Rust/DB; no se toca el flujo de dinero (F38/F39), ni el inventario salvo el aviso; sin release ni push (MODO DEV).
