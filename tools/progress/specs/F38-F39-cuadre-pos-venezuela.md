# Spec F38 + F39 — Que TODO cuadre como un POS venezolano

Proyecto: **registro** (Tauri 2 + Rust/SQLite + React 19 + Vite + shadcn/ui + Tailwind v4) · MODO DEV.
Pedido del dueño (2026-09-17): **«¿cómo debería ser a nivel profesional que todo cuadre? Recuerda es
Venezuela, todo tiene que cuadrar como un sistema de POS de venta»**.

---

## La regla madre (lo que se implementó)

**La caja cuadra por MONEDA y por MÉTODO. La tasa BCV solo sirve para INFORMAR, nunca para cuadrar.**

| # | Regla profesional | Estado |
|---|---|---|
| 1 | **La deuda vive en la moneda en que se cobró y NO se revalúa.** El saldo en $ no cambia porque se mueva la tasa; la tasa solo da la equivalencia en Bs. **de hoy** (lo que el cliente va a entregar) | **F38** |
| 2 | **El arqueo se cuenta y se compara en CADA moneda por separado** (dos diferencias, dos semáforos), nunca con un número que mezcle $ y Bs./tasa | **F39** |
| 3 | Un cierre guardado **no se recalcula**: se reabre con ↺, se registra y se vuelve a cerrar | ya estaba (F35) |
| 4 | Tasa **congelada por turno**; nada **estimado** en la caja (el presupuesto es presupuesto) | ya estaba |
| 5 | **Un solo libro de movimientos de caja** del que salgan todos los reportes y el arqueo | **pendiente (feature 40)** |
| 6 | **Trazabilidad** de todo cambio de plata (quién borró un abono, quién movió una fecha, quién reabrió un día) | **pendiente (feature 40)** |

Lo que **nunca** se hace: mezclar monedas en un total de caja o en un semáforo, recalcular un cierre
ya guardado, o convertir para «cuadrar».

---

## F38 — El saldo se dice en la MONEDA DEL COBRO

### Criterios de aceptación
1. **[must]** Si **todos** los cobros de una orden fueron en Bs., el saldo se muestra **en Bs.** con la
   equivalencia en $ entre paréntesis: `Bs. 72.879,73 ($97.33)`. Con cobros **mixtos** o **sin cobros**
   el principal es `$` (la moneda del monto de la orden), con su equivalencia en Bs.
2. **[must]** **Sin tasa cargada** (0) NO se inventa ninguna equivalencia: se dice el `$` y
   «(falta la tasa BCV)».
3. **[must]** **La deuda NO se revalúa:** con la misma plata cobrada, el saldo en `$` es idéntico con
   tasa 40 y con tasa 60; lo único que cambia es la equivalencia en Bs.
4. **[must]** Donde se ve: **diálogo de abono** (Total / Por pagar / Saldo pendiente, `data-field="saldo"`),
   **badge de la tarjeta** y **banner de la orden multi-equipo**, y el **comprobante**: línea nueva
   **`FALTA Bs.`** en el recibo principal y en el talón cuando el cobro viene en bolívares.
5. **[must]** Sin desbordes de papel: ninguna línea > 32 chars (58mm) ni > 48 (80mm).
6. **[should]** Saldado («Sin saldo») y excedente («A favor $X») siguen diciéndose como antes.

### Implementación
- `src/lib/order-balance.ts` (NUEVO, puro): `orderBalance(amount, paidUsd, payments, tasa)` →
  `{ usd, bs, cobroEn, principal, saldado, excedente }` y `balanceLabel(...)`. La moneda del cobro sale
  del **neto por moneda** (`refund-math.netByCurrency`), reusando la regla de F36.
- `PaymentDialog.tsx` (bloque de totales + `data-field="saldo"`), `Services.tsx` (badge de la tarjeta,
  banner del grupo y estado `tasaDia` desde el `getActiveDay()` que ya existía),
  `src/lib/utils.ts` (`buildServiceReceiptParts`: `FALTA Bs.` con la `tasaBcv` que el builder ya recibía).

## F39 — El arqueo cuadra POR MONEDA

### Criterios de aceptación
1. **[must]** La lista de Libro Diario → Cierres muestra **«Diferencia $» y «Diferencia Bs.»** por
   separado (`data-diff="usd"`/`"bs"` + `data-ok`), cada una con su tolerancia (0,5 en las dos: lo que
   se redondea al contar el cajón).
2. **[must]** Las diferencias se calculan **leyendo las columnas guardadas del cierre** (`cash_usd`,
   `zelle_total`, `usd_cash_total`, `cash_bs`, `pago_movil_total`, `transfer_bs_total` y `actual_*`):
   **no se recalcula nada** — un cierre viejo se lee igual aunque después cambie algo.
3. **[must]** El texto dice la moneda real: «sobran $2.00 · faltan Bs. 1.000,00», y las DOS fallas se
   informan a la vez (antes el número mezclado las confundía).
4. **[must]** Un bolívar de diferencia **no** puede quedar escondido por la tasa (antes, con tasa alta,
   Bs. 1.000 de faltante eran «$1,34» y podían pasar por tolerancia de $0,5… o al revés).
5. **[should]** El Punto se liquida aparte y también por moneda (`puntoDifference`).
6. **[should]** El número mezclado en `$` que ya está en la base y en el Excel queda **informativo**, no
   como semáforo.

### Implementación
- `src/lib/cash-closing.ts` (NUEVO, puro): `closingDifference(closing)`, `closingLabel(diff)`,
  `puntoDifference(...)`, `TOL_USD = TOL_BS = 0.5`.
- `DailyLedger.tsx`: dos columnas nuevas en la tabla de Cierres con su color por moneda.

---

## Verificación

- `node tools/pos_cuadre_test.ts` **60/60** — reglas puras de las dos features (incluye el invariante
  «la deuda no se revalúa», **la paridad EXACTA entre el Bs. que se muestra y el que se cobra** —con el
  caso real de un `paid_amount` no redondo—, `hasArqueo` y las tolerancias por moneda).
- `node tools/receipt_acuerdo_test.ts` **52/52** — el comprobante con `FALTA Bs.` **con su monto
  exacto**, en 58/80mm sin desbordes, sin tasa (no se imprime), con cobro en $ (tampoco), con la
  devolución total en Bs. (tampoco, mismo criterio que la pantalla) y con cobro mixto.
- `tools/verify_tecnico_y_fecha_pago.mjs` **40/40 EN VIVO** — el saldo dice «Bs. 72.879,00 ($97.33)»
  **con la misma cifra que cobra «Todo el saldo»**; el toggle del monto arranca en Bs.; el aviso de
  excedente; la lista de Cierres con las dos columnas, los dos `data-ok` y «+$25.00» de un cierre
  guardado; y **una orden Devuelta rechaza pagos** (guard del backend, hallazgo de F36 que la prueba
  de paso comprobó).
- Regresiones: `verify_recordatorios` 56/56 · `verify_servicio_cierre` 17/17 ·
  `verify_cola_entregas` 13/13 · `verify_metodos_en_cobros` 15/15 · `verify_wizard_metodos` 18/18 ·
  `cargo test --lib` **128/128** · `tsc -b` 0 · `oxlint` 0 errores.

## 2ª vuelta adversarial — hallazgos y cómo quedaron

| Severidad | Hallazgo | Estado |
|---|---|---|
| **BLOQUEANTE** | El diálogo de cierre mandaba `actual_cash_usd = esperado`, así que «Diferencia $» daba **siempre 0** | **arreglado**: input «Divisas contadas ($)» (`usdCounted`) |
| MAYOR | El Bs. **mostrado** y el Bs. **cobrado** diferían en 1 bolívar (72.880 vs 72.879) por redondear el saldo antes de multiplicar por la tasa | **arreglado**: `bs = round(usdRaw × tasa)`, con prueba de paridad |
| MAYOR | El campo del monto no seguía la moneda del cobro (una orden pagándose en Bs. abría el campo en `$`) | **arreglado**: `cobroEn` + `curTouched` |
| MAYOR | Cobrar más que el saldo no avisaba nada | **arreglado**: aviso `data-field="aviso-excedente"` |
| MAYOR | El recibo juzgaba el cobro en Bs. por montos **brutos** (una devolución total dejaba un «FALTA Bs.» que la pantalla no mostraba) | **arreglado**: `netByCurrency` (una sola implementación) |
| MENOR | Un cierre **migrado** (sin arqueo) mostraba como diferencia **todo** el efectivo del día | **arreglado**: `hasArqueo` → «sin arqueo» |
| MENOR | El signo se imprimía **después** del símbolo (`$-2.00`) | **arreglado**: `-$2.00` / `-Bs. 1.000,00` |
| MENOR | Las ventas en Bs. se guardaban con centavos de bolívar (descuadre contra la tolerancia de 0,5 Bs.) | **arreglado**: `Math.round` y se muestra = se guarda |
| MENOR | `closingLabel` / `puntoDifference` no los usaba la UI (dos restas propias en el diálogo de Liquidar) | **arreglado**: cableados |
| MENOR | `colSpan` del estado vacío de Cierres quedó en 11 con 12 columnas | **arreglado** |
| MENOR | Estado de la orden anterior podía verse un instante al abrir el abono de otra orden | **arreglado**: `setPayments([])` al abrir |
| — | **No cerrado, anotado:** con más de **120 filas** en la lista no se piden los movimientos → se pierde el chip del método real y el ORDEN de las monedas (no la cifra en Bs.). Es la feature 40 | **documentado** en AGENTS.md y en el código |

## Decisiones y límites declarados
- La equivalencia en Bs. usa la **tasa del turno abierto** (la que se va a usar para cobrar hoy). Si el
  turno abierto es de otro día, la equivalencia es la de ESE turno — es coherente con que toda la caja
  trabaja contra ese turno (misma decisión que F35 para la fecha del pago).
- **Cobros mixtos** ($ y Bs. en la misma orden): no hay una sola moneda de cobro, así que el principal
  vuelve a ser `$` con su equivalencia — es el caso menos frecuente y el más honesto.
- **Todo lo que se cobra en bolívares se redondea al bolívar entero**, y el número que se muestra es el
  que se guarda (saldo, equivalencia del recibo y ventas en Bs.).
- El **libro único de caja** (feature 40) queda como el paso siguiente: es lo que hará que cuadre **por
  construcción** en vez de por una función bien escrita.
