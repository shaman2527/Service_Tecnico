# Spec F83 — La devolución dice a qué caja va (informar, no bloquear)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Hallazgo **MAYOR** de la revisión adversarial de F82 (2026-09-27), anotado como feature propia.

---

## 1. Diagnóstico (medido en el código)

| Pieza | Antes |
|---|---|
| `add_service_refund` (db.rs) | fecha la devolución con el **`close_date` del turno ABIERTO** (`SELECT close_date FROM daily_closings WHERE is_closed = 0 …`) — invariante F36/F69: la plata sale del cajón que se está trabajando |
| `RefundDialog.tsx` | **no consultaba el turno**, no tenía campo de fecha y no mostraba nada: con la caja del 21/09 abierta y hoy 27/09, una devolución hecha HOY entraba al arqueo del 21/09 **en silencio** |
| F82 | le puso el cartel de la caja vieja a **Pago/Abono** y al asistente de cierre… y la devolución quedó como la única escritura de dinero sin esa mitad visible |

**No es un bug de plata** (la devolución siempre cae en la única caja abierta, que es la que puede recibirla):
es un problema de **transparencia en el mostrador**. El backlog dejaba dos caminos: **(a)** decirlo y no
bloquear, o **(b)** gatearla por fecha como los cobros (lo que cambia el invariante de F69).

## 2. Decisión

**Opción (a): INFORMAR, NO BLOQUEAR.** La devolución sigue saliendo del cajón abierto (regla del local) y
el operario lo ve ANTES de confirmar, con el remedio a un toque si lo que quiere es que salga de la caja
de hoy. La opción (b) habría cambiado el invariante de F69 (`verify_devolucion_metodo`, `Help.tsx` y el
test de F36) y no aporta: el caso real es «la plata sale del cajón que estoy trabajando», y para que ese
cajón sea el de hoy el camino es cerrar el turno viejo — que es exactamente lo que el cartel ofrece.

## 3. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **[must]** La regla «a qué caja va la devolución» es PURA y vive en `src/lib/day-shift.ts` (`cajaDeLaDevolucion`), con las fechas en formato del local y **sin `new Date`** | `node tools/day_shift_test.ts` (13 comprobaciones nuevas) |
| 2 | **[must]** Con la caja de HOY: lo dice sin alarmar («CAJA DE HOY» + la fecha) y no hay cartel de turno viejo | EN VIVO `verify_f83_devolucion_caja.mjs` A1 |
| 3 | **[must]** Con la caja de OTRO día: avisa fuerte, nombra **las dos fechas**, dice «NO en la de hoy» y trae el remedio | EN VIVO B1 |
| 4 | **[must]** Con la caja de OTRO día aparece el MISMO cartel de F82 (con el botón «Ir a cerrar esa caja») y el guardado **SIGUE habilitado** | EN VIVO B2 y B3 |
| 5 | **[must]** Sin ninguna caja abierta el texto manda a abrir el día (el gate de siempre sigue igual) | `day_shift_test` |
| 6 | **[must]** Nada de lo verificado antes se rompe | `cargo test --lib` 217/217 · EN VIVO `verify_devolucion_metodo` 7/7, `verify_turno_viejo` 42/42, `verify_arqueo_f69` 39/39, `verify_smoke_integral` 110/110 |
| 7 | **[should]** La prueba en vivo arma su escenario (turno de hoy / turno viejo) y **lo restaura** | EN VIVO C |

## 4. Verificación

* `node tools/day_shift_test.ts` **54/54** (13 nuevas: las tres ramas + las fechas con hora + las dos del remedio).
* **EN VIVO** `node tools/verify_f83_devolucion_caja.mjs` (NUEVA) **6/6**, por el camino real de la UI, sobre
  una copia con el PIN de pruebas: crea la orden y la cobra en Bs, arma los dos escenarios con SQL
  (documentado: es una copia), recarga entre escrituras por IPC (lección F90: el `invoke` directo saltea el
  bus de datos) y al final borra su orden y devuelve el turno como estaba.
* Regresiones verdes: `verify_devolucion_metodo` 7/7 · `verify_turno_viejo` 42/42 · `verify_arqueo_f69` 39/39 ·
  `verify_smoke_integral` 110/110 · `tsc -b` 0 · `oxlint` 0 errores · `npm run build` ✓.

## 5. Fuera de alcance (anotado)

* **La devolución con NINGUNA caja abierta** sigue bloqueada (con reembolso): la plata sale del cajón y sin
  caja no hay de dónde sacarla. La devolución **sin reembolso** ya se permite (F36). Si el dueño quiere
  poder devolver plata con el día sin abrir, es una decisión de negocio (¿de qué cajón sale?) — no se
  inventó acá.
* **Navegar con «Ir a cerrar esa caja» desmonta el diálogo** (`App.tsx` renderiza un módulo por vez): si el
  operario ya cargó monto/método/notas, al volver están vacíos. Es una pérdida de tipeo, no de plata, y
  arreglarla bien pide confirmar antes de navegar (o conservar el borrador) — queda anotado para no
  inventar un diálogo de confirmación en una feature de avisos. Medido por la revisión adversarial.

## 6. Revisión adversarial (subagente, sólo lectura) — 1 MAYOR + 2 MENORES, TODOS arreglados

| # | Sev. | Hallazgo | Arreglo |
|---|---|---|---|
| **M** | **MAYOR** | `RefundDialog` imprimía `cajaDevolucion.texto` **sin mirar `puedeCerrarCaja`** (el prop sólo se usaba en el banner): al rol `caja` —que NO puede cerrar (`close_day` exige dueño y la pestaña Cierres no se le dibuja)— el MISMO diálogo le daba dos órdenes contradictorias: el cartel de arriba «pedile al dueño que cierre» y el bloque ámbar «Cerrá esa caja… contá el cajón». Escenario real: cajera con la caja del 21/09 abierta → sigue la instrucción imposible → callejón sin salida. Era **el M1 de F82 reintroducido dentro del mismo diálogo** | `cajaDeLaDevolucion(fechaTurno, hoy, { puedeCerrar })`: con `false` la rama «otro día» **pide** el cierre («cerrar esa caja es del DUEÑO: pedile que la cierre… la devolución se anota igual en esa caja») en vez de ordenarlo. El rol **sólo** cambia esa rama (con la caja de hoy y sin caja el texto es idéntico, fijado por test). `RefundDialog` le pasa `puedeCerrarCaja`. Pruebas: `day_shift_test.ts` **59/59** (5 nuevas) |
| m1 | MENOR | `fechaTurno === null` significaba a la vez «no hay ninguna caja» y «todavía no se sabe / la lectura falló», y era también el estado INICIAL: el diálogo podía afirmar «No hay ninguna caja abierta: hay que abrir el día» mientras el padre consideraba el día abierto (`Services` hace fail-open en su `catch`) | estado `turnoConsultado`: el bloque (y el cartel) **no afirman nada** hasta que la lectura del turno contesta |
| m2 | MENOR | el verify en vivo sólo cubría la sesión de DUEÑO: la rama del rol `caja` no tenía cobertura | los 5 asserts nuevos del módulo puro (no puede ordenar cerrar · pide el cierre nombrando la caja · sigue diciendo a qué caja va · el dueño conserva el remedio completo · el rol sólo cambia esa rama). La verificación en vivo sigue siendo de dueño (la sesión de caja la cubre `verify_arqueo_f69`, que además se endureció contra una carrera: ver F40 §4.2) |
