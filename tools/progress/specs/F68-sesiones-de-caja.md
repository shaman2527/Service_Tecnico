# Spec F68 — Sesiones de caja: Master y Caja 1 (quién cobra, qué ve cada uno y quién hizo cada movimiento)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Pedido del dueño (2026-09-23), al preparar la entrega al cliente final:

> «Sería bueno la sesión de caja 1 pueda usar todo, ver su día de caja, pero no pueda ver cuánto factura
> la master; no tenga tanto acceso.»

**Decisiones del dueño en la misma conversación:** una sola PC (multi-PC/multi-sucursal **fuera** de
alcance) · **sin fotos** por ahora · arranca el Sprint A de `AUDITORIA_ENTREGA.md`.

---

## 1. Diagnóstico (medido en el código, no supuesto)

| # | Qué pasaba |
|---|---|
| D1 | **Un solo PIN compartido** (`settings.pin`) y el rol «cajera» era un **botón sin autenticación** (`App.tsx:196-199`): cualquiera que se sentara en la PC entraba como cajera. |
| D2 | **Ningún movimiento de plata tenía autor**: 0 columnas `user/_by/who` en toda la base (verificado con `pragma_table_info`), `sync_log` existía y **nunca se escribía**. Borrar un abono era un clic sin rastro; reabrir un día borraba `closed_at` (la única evidencia). |
| D3 | La **caja veía la caja del día** (Libro Diario → Diario) pero también el inventario **con precios de costo** y el capital a costo. |
| D4 | Los totales del día se armaban **sumando tablas** en `compute_daily_totals` (la causa raíz que F40 venía a resolver): sin un libro único no hay forma de saber quién movió qué. |

## 2. Criterios de aceptación

| # | Criterio | Cómo se comprobó |
|---|---|---|
| 1 | **[must]** Cada persona entra con **su propio PIN**; un PIN equivocado no entra y el de una persona no sirve para otra | EN VIVO (PIN equivocado + entrada de Master y Caja) y test Rust `test_sesiones_master_y_caja` |
| 2 | **[must]** La migración **no rompe una instalación existente**: la fila Master nace con el PIN que ya tenía la instalación y se entra con ese PIN | test Rust (PIN 1234 → Master con PIN) + EN VIVO sobre una copia de la base del local |
| 3 | **[must]** La **caja usa todo el mostrador** (Ventas, Servicio Técnico, Inventario, Pedidos, Clientes, Libro Diario, Ayuda) y **puede vender** | EN VIVO: la barra lateral de la caja + una venta real registrada por la caja |
| 4 | **[must]** La **caja no ve los números del dueño**: sin Dashboard y el backend **no le devuelve** los movimientos de otras sesiones | EN VIVO: nav sin Dashboard + `get_cash_movements` con la sesión de caja solo trae lo suyo |
| 5 | **[must]** El **libro de plata anota el AUTOR** de cada movimiento (venta, abono, devolución, gasto, apertura, cierre, reapertura, y el contra-asiento al borrar) | test Rust `test_libro_de_plata_con_autor` + EN VIVO (`user_name = 'Caja 1'` en la base) |
| 6 | **[must]** El **Master ve todo**: los movimientos de las dos sesiones, el **resumen por persona** y la pestaña «Movimientos» con el autor | EN VIVO (invoke + pantalla) |
| 7 | **[must]** Las escrituras del dueño siguen **rechazadas** para la caja, incluso invocando el IPC directamente | EN VIVO: 5 comandos sensibles rechazados con el mensaje del gate |
| 8 | **[must]** El **costo** (y el capital a costo) **no se le muestran a la caja** | EN VIVO (columna y KPI ocultos) + regla pura `session.ts` |
| 9 | **[must]** **Nada de lo que ya funcionaba se rompe**: los scripts en vivo que entran con el PIN de siempre siguen verdes | 6 regresiones en vivo + smoke integral 110/110 (×2) |
| 10 | **[should]** Con **una sola persona** la app pide el PIN directo (sin selector): el local que sólo tiene al dueño no cambia su forma de entrar | EN VIVO (regresiones que teclean el PIN) |

## 3. Implementación

- **`db.rs` — tablas nuevas (idempotentes, en `init()`):** `users` (nombre, rol `master`|`caja`, `pin_hash`
  PBKDF2, color, activo) y `cash_movements` (tipo, método, moneda, monto, signo, referencia,
  venta/abono/servicio/gasto, **usuario** y **`user_name` copiado** para que el histórico no dependa de
  que la persona exista). `ensure_master_user` crea la fila Master con el PIN que ya tenía la
  instalación (idempotente, se llama en cada arranque).
- **`db.rs` — sesión:** la sesión pasó de un booleano «dueño desbloqueado» a **quién** está usando la app
  (`session: Mutex<Option<SessionUser>>` + `session_since`, 12 h). `require_owner`/`owner_gate` exigen
  rol `master`; `owner_session_set`/`lock_owner`/`owner_can_edit` se mantienen como compatibilidad (los
  tests viejos y el código que ya los usaba siguen funcionando).
- **`db.rs` — libro de plata:** `book_movement` (una sola implementación, llamada **dentro de la misma
  transacción** de cada write-point de dinero) + `get_cash_movements` (filtrable por persona) +
  `get_cash_movements_by_user`. Los write-points que anotan: `add_sale`, `add_service_payment`,
  `delete_service_payment` (contra-asiento), `add_service_refund`, `add_expense`, `delete_expense`,
  `open_day`, `close_day`, `reopen_day`.
- **`commands.rs`/`lib.rs`:** 9 comandos nuevos (leer personas, quién está, entrar con el PIN de una
  persona, alta/edición/PIN/borrado — todos del dueño —, el libro filtrado por sesión y el resumen por
  persona, del dueño).
- **`lib/session.ts` (NUEVO, regla pura):** qué puede y qué ve cada rol, en una sola implementación;
  fail-closed (un rol desconocido cae en el perfil de CAJA, nunca gana acceso).
- **`App.tsx`:** acceso por persona (selector + PIN propio), retoma la sesión al recargar (la sesión vive
  en el backend), con una sola persona pide el PIN directo, barra lateral con quién está y «Bloquear
  sesión» para los dos roles.
- **`UsuariosDialog.tsx` (NUEVO):** personas y accesos (alta, rol, color, PIN, apagar, borrar) desde
  Libro Diario → «Personas» (solo Master).
- **`DailyLedger.tsx`:** botón «Personas» y pestaña **«Movimientos»** (el libro con el autor; la caja ve
  sólo lo suyo — lo impone el backend, no el frontend).
- **Inventario:** `verCosto` oculta el precio de costo y el capital a costo a la caja.

## 4. Lecciones de las corridas en vivo (quedan en el script)

1. **La sesión vive en el backend 12 h:** al recargar la página la app la **retoma**, así que la UI y el
   backend pueden quedar desincronizados si no se pregunta `get_current_user` al arrancar (se arregló).
2. **Las sondas del gate no pueden mutar nada si pasan:** la primera versión usaba `set_pin` y, en la
   corrida donde la sesión era la del dueño, **le cambió el PIN al Master** — la corrida siguiente ya no
   podía entrar.
3. **`add_sale` devuelve `()`** → el IPC llega como `null`: el éxito se comprueba por la FILA en la base.
4. **La prueba se prepara su fixture y lo limpia**: crea «Caja 1» y borra sus ventas de prueba (y las que
   haya dejado una corrida anterior).

## 5. Pruebas

| Prueba | Resultado |
|---|---|
| `cd src-tauri && cargo test --lib` | **148/148** (8 ignorados; +2 nuevos de F68) |
| `node tools/session_test.ts` (regla pura de roles) | **41/41** |
| **EN VIVO `node tools/verify_sesiones_caja.mjs`** | **28/28** |
| Regresiones EN VIVO | `verify_wizard_metodos` 18/18 · `verify_pantalla_agotada` 16/16 · `verify_compat_pantalla` 12/12 · `verify_descuento` 15/15 · `verify_smoke_integral` **110/110** (×2) |
| `npx tsc -b` · `npx oxlint` | 0 · 0 errores |
| `npm run build` · `cargo build` | ✓ · ✓ |
| `harness_security` · `harness_truth` | PASS · PASS |

## 6. Lo que esta feature NO hace (es F69 y F70)

- **F69 — el arqueo cuenta gastos, retiros y fondo, y los digitales se verifican.** El libro ya está
  escribiendo, pero el **esperado de la caja sigue saliendo de `compute_daily_totals`** (que no incluye
  `expenses` ni la apertura): el día que se pague un gasto del cajón, el arqueo va a decir «falta» igual
  que antes. F69 cambia esa cuenta (por caja/sesión) y agrega la verificación de los métodos digitales.
- **F70 — anular una venta** (hoy no existe) con su contra-asiento en el libro y la devolución al stock.
