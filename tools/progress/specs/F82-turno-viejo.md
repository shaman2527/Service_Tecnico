# F82 — La caja del día anterior sin cerrar: aviso y bloqueo ANTES de facturar

**Estado:** en implementación (2026-09-27).
**Origen:** pedido del dueño (2026-09-27): «si yo no he cerrado la caja del día y estamos en otro
día — por ejemplo hoy no cerré la caja — que me diga "tiene que cerrar la caja del día anterior para
facturar", un mensaje así, ANTES de que vaya a facturar: todo se liga hasta la venta de ayer».
**Regla madre:** *la plata entra al turno de SU día. Si el turno abierto es de otro día, la app lo
dice ANTES de dejar facturar y nombra el remedio completo — nunca lo anota en silencio en el día
equivocado.*

---

## 1. El problema (medido en el código)

`require_open_day` (`src-tauri/src/db.rs:7499`) solo preguntaba **«¿hay algún turno abierto?»**:

```sql
SELECT EXISTS(SELECT 1 FROM daily_closings WHERE is_closed=0)
```

No comparaba la fecha. Con el turno del **16/09** abierto (nadie lo cerró) y hoy **17/09**:

* una **venta** (`add_sale`, 3731) y una **orden de servicio** (`add_service_order`, 4018) se
  registran con la fecha de HOY pero **entran en la caja del 16/09** → el arqueo de ayer se descuadra,
  el de hoy no existe, y el resumen del día miente;
* lo único que comparaba fechas era `open_day` (7438: «Ya hay un día abierto (…) — ciérralo antes de
  abrir uno nuevo.») — y solo hablaba si alguien intentaba **abrir** el día.

## 2. Qué se implementa

### 2.1 Backend — `require_open_day_para(conn, fecha_efectiva)`

Regla **por fecha** (fail-closed), con la fecha **efectiva** de cada operación:

| Operación | Fecha efectiva |
|---|---|
| `add_sale`, `add_sale_tax`, `add_service`, `add_service_order`, `add_service_refund` | **HOY** (`date('now','localtime')` — nunca UTC) |
| `add_service_payment`, `add_expense` | la fecha elegida por el operario (vacío = hoy), la misma que ya normaliza `payment_date_ok` (7543) |

| Situación | Resultado |
|---|---|
| No hay ningún turno abierto | error histórico («Debe abrir el día (Libro Diario)…) |
| Hay un turno abierto con la fecha efectiva | OK |
| **El turno abierto es de otro día y la operación es de hoy** | **RECHAZO** con el mensaje nuevo (las dos fechas + el camino completo) |
| El operario elige **a propósito** la fecha de un turno abierto viejo (abono retroactivo, F35) | OK — se conserva, con su aviso ámbar «va a la caja del …» |

* **El remedio nunca se bloquea:** `close_day` (7601), `reopen_day` (7731) y `open_day` (7412) quedan
  **sin gate** (si no, quedaría encerrado sin salida). Test explícito.
* **No** se toca `set_service_policy` (anotación sin dinero, F32) ni `update_service_payment_date`
  (ya tiene sus portones propios).
* Mensaje (mismo texto conceptual en backend y UI): **«La caja del 16/09 sigue ABIERTA y hoy es
  17/09. Si registrás esto ahora, la plata se anota en el día 16/09 y ese arqueo queda descuadrado.
  Cerrá esa caja en Libro Diario → Cierres → botón «Cerrar» de esa fila (contá el cajón) y después
  abrí el día de hoy.»**

**Validación de SOLO LECTURA:** no hay migración, ni columnas nuevas, ni escrituras. Ningún dato
existente se toca.

### 2.2 Frontend — `src/lib/day-shift.ts` (regla PURA) + los avisos

* `shiftPending(fechaTurno, hoy)` → `{ stale, fecha, message, remedy }`, con UNA sola implementación
  del texto para las pantallas que hoy gatean por `dayOpen` (boolean): **Ventas** (`Sales.tsx`: 81,
  banner 123-128, `SaleForm` 639), **Servicio Técnico** (`Services.tsx`: 638, banner 1075-1080,
  bloqueos 3080/3548, botones 4334/4457), **Pedidos** (41, 331, 403), `PaymentDialog` (111, 476),
  `CierreServiceDialog` (109, 200, 461) y `RefundDialog` (290).
* **El aviso sale ANTES de facturar**: banner en la cabecera con las dos fechas y **«Cerrar esa
  caja» / «Ir al Libro Diario»** (navegación de `App.tsx` + pestaña `cierres` de `DailyLedger`, que ya
  tiene el botón «Cerrar» por fila de F34/M2) — el remedio tiene que ser **completable desde el propio
  aviso** (lección ya documentada de F34/M2).
* Los diálogos de venta/cobro/servicio muestran el banner y **apagan Guardar** por la razón nueva
  (nunca un botón muerto sin explicación).
* **Aviso al arrancar** (mismo texto, no bloquea) en el Dashboard.
* `Help.tsx` (la «regla de oro» del dinero) explica la regla nueva.

### 2.3 Decisión declarada (default de la fecha del abono)

`PaymentDialog` fecha por defecto **la del turno abierto** (decisión de F35). Con un turno viejo ese
default haría que un cobro de hoy se anote en ayer **sin que el operario lo note**. Ahora: **si el
turno abierto no es de hoy, el default pasa a HOY** (choca con el portón y obliga a cerrar primero), y
el camino retroactivo sigue disponible **eligiendo la fecha a propósito** (con el aviso ámbar que ya
existe, que dice a qué caja va). Es la opción recomendada del plan; si el dueño prefiere que el cobro
siga cayendo en el turno viejo por defecto, se revierte solo este punto (una línea).

## 3. Pruebas

* **Rust** (cobertura principal del portón): venta / servicio / devolución de hoy con turno de ayer →
  rechazados nombrando las dos fechas; abono con la fecha del turno viejo → permitido; abono de hoy
  con turno viejo → rechazado; **`close_day` + `open_day` funcionan con el turno viejo** (el remedio
  destraba); sin ningún turno → mensaje histórico. Auditoría de los tests existentes que abren turnos
  con fecha vieja (fixtures con DOS turnos abiertos: siguen verdes con la regla por fecha).
* **EN VIVO `tools/verify_turno_viejo.mjs`**: arma el escenario (cierra el turno de hoy y reabre el de
  ayer con ↺), comprueba el banner **antes** de guardar en Ventas/Servicios, que el guardado falla con
  el mensaje correcto, que el remedio se completa por la UI (Cerrar → Abrir Día) y que **después ya
  factura**; al terminar **restaura** el estado de los turnos.
* **Preflight para la familia `verify_*`**: helper compartido que detecta un turno abierto que no es
  de hoy y **aborta con el mensaje del remedio** (nunca cierra el turno de nadie solo).
* Regresiones: `verify_tecnico_y_fecha_pago` (F35/F36), `verify_servicio_cierre`, `verify_cola_entregas`,
  `verify_metodos_en_cobros`, `verify_cobro_en_wizard`, `verify_smoke_integral`.

## 4. Invariantes

1. Un día **cerrado** sigue siendo intocable (su arqueo no se recalcula solo) — F35/F39.
2. Un abono **fechado a propósito** en un turno abierto viejo sigue funcionando (retroactivo).
3. El **remedio** (`close_day`/`reopen_day`/`open_day`) nunca queda gateado por la regla nueva.
4. La regla **no escribe nada**: es validación. Ningún dato existente cambia.
5. La app **no** cierra ni abre turnos por su cuenta: solo dice qué hacer y lleva al lugar exacto.
