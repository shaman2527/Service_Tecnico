# Spec F36 — Devoluciones y saldo POR MONEDA (fin del saldo fantasma por tasa)

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Cerrada el **2026-09-17**. Pedido del dueño y decisión aprobada antes de implementar.

---

## El pedido y la pregunta

> «¿qué sería lo correcto? que sea lo más eficiente — puede ser la de hoy o la de ese día del registro»

El dueño preguntaba **con qué tasa** comparar una devolución en bolívares. La respuesta aprobada:

## La decisión (lo que quedó implementado)

1. **Para el TOPE: ninguna tasa.** Se devuelve, como máximo, **lo que netamente entró en ESA moneda**
   (Bs contra Bs cobrados, $ contra $ cobrados). Es lo único exacto, lo más simple para el operario y
   lo que refleja el cajón: no se saca más de lo que entró, en la misma moneda.
2. **Para el VALOR en dólares de lo abonado: la tasa del día en que ENTRÓ la plata** (el día del
   registro de ese pago), **nunca la de hoy**. Un abono no cambia de valor con el paso de los días sin
   que nadie mueva un bolívar.
3. **`paid_amount` = neto por moneda:** `neto_USD + (neto_VES / tasa de referencia)`, con la tasa de
   referencia = la del **día del primer ingreso en Bs** de esa orden (fallback: día abierto con tasa →
   1:1, los mismos fallbacks históricos).
4. **La CAJA no se toca:** `compute_daily_totals` suma **montos crudos** por método y por día (los Bs.
   del lunes y los del miércoles cuadran cada día por separado). Verificado por lectura y por test.

**El bug que arregla (medido):** abono de Bs. 4.050 con tasa 40,50 → `paid_amount = $100`; devolución
de los MISMOS Bs. 4.050 con tasa 50 → restaba $81 → **la orden seguía «debiendo» $19 y el recibo lo
imprimía**, aunque el cliente ya estaba saldado en bolívares.

---

## Criterios de aceptación (todos verificados)

| # | Criterio | Evidencia |
|---|---|---|
| 1 | Abono de Bs. 4.050 a 40,50 + devolución de Bs. 4.050 a 50 → la orden queda **saldada** (`paid_amount = 0`) | `test_refund_by_currency_net` + en vivo |
| 2 | Devolver **un bolívar más** de lo que entró → rechazado, con el tope **en Bs.** | test Rust + en vivo («Solo puedes devolver hasta Bs. 1.000,00…») |
| 3 | Devolución parcial Bs. 1.000 → queda Bs. 3.050 valuados a la tasa **del pago** ($75,31) | test Rust |
| 4 | Un abono **no cambia de valor** con los días (sin movimientos nuevos) | test Rust (se recalcula y sigue igual) |
| 5 | El **Libro Diario** no cambia: el día del cobro suma los Bs. y el de la devolución los resta | test Rust (`cash_bs` +4.050 / −4.050) + `test_refund_ledger_full` |
| 6 | No se pueden devolver **dólares que nunca entraron** (ni al revés) | test Rust + mensaje |
| 7 | Sin pagos previos → disponible 0 → rechazado | test Rust |
| 8 | Mixto (USD 60 − USD 40 + Bs. 4.050/40,5) → $120 exactos | test Rust |
| 9 | **Rust ↔ TypeScript dan el mismo número** (la regla está en los dos lados) | `tools/refund_math_test.ts` 24/24 con los mismos casos |
| 10 | El diálogo muestra el tope **en la moneda real** y «Devolver todo» propone lo que entró | en vivo: `tope=Bs. 1.000,00`, `monto=1000` |
| 11 | La devolución en Bs. **ya no depende de la tasa de hoy** (no se bloquea por eso) | `RefundDialog` sin el gate de tasa de hoy |

## Riesgos y cómo se controlaron

- **Es la regla del dinero** (`recalc_paid_amount` la usan pagos, devoluciones, borrado, corrección de
  fecha y la migración de arranque): **medición de impacto sobre una copia de la base REAL** antes de
  tocar nada → `node tools/snapshot_db.mjs --src dev_registro.db --out backup/verif_f36.db --force` +
  `node tools/audit_paid_amount_f36.mjs --db backup/verif_f36.db`: **10 órdenes con movimientos, 4 con
  devoluciones, 0 cambian de `paid_amount`** → la migración es inocua sobre los datos del local.
- **Doble implementación** (Rust + TS) → test de paridad con los mismos números.
- **Fuera de alcance a propósito:** devoluciones en una moneda distinta a la que se cobró (el tope por
  moneda las bloquea; la salida honesta es «Devolver sin reembolso» + nota, o borrar el pago y
  anotarlo en la moneda de la devolución). Si el local alguna vez lo necesita, la regla a agregar es
  `min(disponible por moneda, equivalente en $ de lo abonado)`.

## 2ª vuelta — revisión adversarial de F36 (dinero) y lo que arregló

**BLOQUEANTES**
1. **La migración de arranque seguía usando la fórmula VIEJA** (`db.rs::init()` tenía su propio
   `UPDATE services SET paid_amount = …` con «convertir cada movimiento con la tasa de su día»). Como
   `init()` corre en **cada arranque**, F36 se revertía al reiniciar la app: el mismo saldo valía
   distinto según cuál fue la última acción. **Fix:** ese bloque se borró y ahora recorre las órdenes
   llamando a `recalc_paid_amount` (la ÚNICA implementación de la regla). **Regresión fijada** con
   `test_migration_keeps_f36_net_rule` (dos abonos en Bs en días con tasas distintas: $211,11 con
   F36 vs $190 con la vieja) — **comprobado reponiendo el bug**: con la fórmula vieja el test FALLA
   con «tras reiniciar la app el saldo NO puede volver a la regla vieja ($190): 190».
2. **`paid_amount` sí podía quedar negativo** por tres caminos: (a) borrar el cobro después de haber
   devuelto, (b) **regresión nueva de F36**: con el neto en 0 la tolerancia de 0,5 dejaba devolver 0,5
   una y otra vez (deriva sin límite), (c) un `add_service_payment` con **monto negativo** insertaba
   una devolución encubierta que salteaba el tope y restaba de la caja. **Fix:** `disponible > 0.005`
   como condición previa, `amount <= 0` → error en los pagos, `delete_service_payment` rechaza borrar
   un cobro ya devuelto, y **piso en 0** en `recalc_paid_amount` como red de seguridad. Los tres
   caminos quedaron cubiertos en `test_refund_by_currency_net` (pasos 9–11).

**MAYORES**
3. **`confirmNoMoney` se filtraba entre órdenes:** el diálogo queda montado, así que el «Devolver sin
   reembolso» marcado en una orden sin pago seguía puesto al abrir una orden **pagada** → un clic la
   marcaba Devuelto **sin devolver la plata** (y después la UI ya no ofrecía devolverla). Fix:
   `setConfirmNoMoney(false)` al abrir/cambiar de orden.
4. **La devolución se fechaba HOY (default de la tabla), no en el turno abierto:** con el turno abierto
   de otro día, ese egreso quedaba **fuera del cierre** (arqueo descuadrado) y en un día que nadie
   cierra. Medido en la base real (una devolución de −$20 con fecha 17-09 y el único turno abierto del
   14-08). Fix: la devolución se fecha en el **turno abierto** (con hora si es de hoy, solo fecha si es
   de un turno anterior) y el historial la sigue ordenando cronológicamente.
5. **«Devuelto/Cancelado no acepta pagos» solo existía en la UI:** un invoke directo cargaba plata en
   una orden devuelta (recreaba saldo y sumaba a la caja). Fix: gate en `add_service_payment` + botón
   «Guardar Pago» deshabilitado cuando la orden está finalizada.

**MENORES arreglados:** cambiar de método en la devolución ya no deja el monto anterior con otro
rótulo (se vuelve a proponer el disponible de la nueva moneda: antes «Devolver Bs. 100,00» ≈ $0,13 y
la orden quedaba Devuelta); el tope se muestra en el MISMO formato local en los dos lados
(`Bs. 4.050,00`, helper `fmt_miles` en Rust); el fallback de la tasa del día abierto tiene
`ORDER BY close_date DESC` (con dos turnos abiertos no elige una fila al azar); los mensajes de
`has_bcv_rate_for_date` describen lo que el SQL hace.

**Pendiente anotado (feature 37):** `isBsMethod` del frontend es heurístico (todo lo que no traiga
USD/Zelle → Bs), así que un método propio tipo «Binance» se contabilizaría en bolívares.

**Decisiones para el dueño (no son bugs del código):** valuar todo el neto en Bs con la tasa del
**primer** ingreso hace que, si la tasa subió entre abonos, el abonado en $ quede valuado a la tasa
más vieja. En el ejemplo del bloqueante 1 el saldo a cobrar es $38,89 en vez de $60 (y $79 al cambio
de hoy). Lo correcto del todo sería **mostrar el saldo en la moneda en que se cobró** cuando todos los
movimientos son de la misma moneda; queda como decisión de negocio.

---

## Evidencia de verificación (final)
- `cargo test --lib` **128/128** (incluye `test_refund_by_currency_net` con 12 pasos, `test_migration_keeps_f36_net_rule`).
- `node tools/refund_math_test.ts` **24/24** (paridad Rust↔TS).
- **EN VIVO `tools/verify_tecnico_y_fecha_pago.mjs` 30/30**; regresiones: 56/56, 17/17, 13/13, 15/15, 18/18.
- **Medición sobre la base real** (copia): 10 órdenes con movimientos, 4 con devoluciones, **0 cambian** de `paid_amount` → la migración es inocua sobre los datos del local.
- `tsc -b` 0 · `oxlint` 0 errores · build ✓ · `harness_security` y `harness_truth` PASS.
