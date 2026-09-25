# F70 — Anular (o corregir) una venta con reverso de stock, y fin del «botón muerto» sin precio

**Estado:** en implementación (Sprint A de `AUDITORIA_ENTREGA.md`, bloqueante **A3**).
**Origen:** la auditoría de entrega al cliente final (2026-09-23) + la revisión adversarial de F68/F69.
**Regla madre:** *una venta mal tecleada no puede quedar en la caja para siempre, y una pantalla devuelta
tiene que volver al stock — pero un movimiento de plata NUNCA se borra: se ANULA con su asiento de
reverso, su autor y su motivo.*

---

## 1. El problema (medido)

* **No existe `update_sale` ni `delete_sale`** entre los comandos del backend, y no hay ningún
  `DELETE FROM sales` (sólo migraciones internas): un precio o una cantidad mal tecleados **quedan en la
  caja de ese día para siempre**, y `Help.tsx` afirma lo contrario («¿Puedo corregir una venta o
  servicio? Sí» — verdad para servicios, mentira para ventas).
* **Una pantalla vendida y devuelta no vuelve al stock**: el movimiento de inventario de la venta se
  queda como salida.
* **El botón de vender queda mudo sin precio**: `Sales.tsx` hace `if (price <= 0) return;` — el
  operario aprieta «Guardar Venta» y no pasa nada, sin explicación (en la base real hay **8 fichas con
  stock y sin precio** entregables).

## 2. Qué se implementa

### 2.1 Backend — `void_sale(id, reason)` (del DUEÑO, transaccional)

1. **La venta no se borra: se marca.** Columnas nuevas `sales.voided_at TEXT` y
   `sales.void_reason TEXT` (migración idempotente ALTER en `init()`, **apendadas al final** del orden
   físico — regla InvalidColumnType: los SELECTs son listas explícitas).
2. **Sólo el DUEÑO** (`require_owner()`): anular mueve la caja del día y el stock, y borra evidencia de
   lo que el cliente ya tiene en la mano si se hace mal. Es exactamente el hueco que F68 dejó abierto
   (`voidSale: false` para la caja en `src/lib/session.ts`).
3. **Sólo si el día de la venta está ABIERTO.** Un cierre guardado no se recalcula: si el día ya se
   cerró, el error dice el camino real («el dueño lo reabre con ↺ en Libro Diario → Cierres, anula la
   venta y vuelve a cerrar»). Mismo criterio que F35 para mover la fecha de un pago.
4. **Reverso de stock**: `products.stock + quantity` del producto vendido y un movimiento de inventario
   de **entrada** con motivo «Anulación de venta» y referencia `Venta #id`.
5. **`clients.total_spent`** baja por el total de la venta (si la venta era de un cliente del padrón).
6. **Contra-asiento en el LIBRO DE PLATA** (`cash_movements`, tipo `venta_anulada`, **mismo método,
   misma moneda, mismo monto NETO** que la venta y **signo −1**), con el **autor** de la sesión, el
   **motivo** en la nota y el **día de la venta** (no el de hoy: un día perfecto no puede descuadrar
   porque la anulación se tecleó al día siguiente).
7. **Idempotencia**: anular dos veces se rechaza («Esa venta ya está anulada»).
8. **La caja y los reportes dejan de contarla**: `compute_daily_totals` (el esperado del arqueo),
   `get_sales_stats` (top de productos) y el conteo/`total_spent` del cliente la **excluyen**
   (`voided_at IS NULL`). La **lista** de ventas SÍ la muestra, tachada y con su motivo: la historia no
   se esconde.

### 2.2 UI — `Sales.tsx`

* Acción **«Anular»** por fila (sólo dueño, `abilities().voidSale`), con diálogo de confirmación que
  dice el **impacto exacto**: «sale de la caja del día D» + «vuelven N unidad(es) al stock» + el motivo
  obligatorio (texto libre, no puede quedar vacío).
* Las ventas anuladas se ven **tachadas** con un badge «Anulada», el motivo y la fecha, y **no suman**
  en los KPIs de la pantalla.
* **El botón de vender deja de estar muerto sin precio:** si la ficha no tiene precio, se dice qué pasa
  («Esta ficha no tiene precio de venta: no se puede cobrar») y, si la sesión es del dueño, se ofrece
  **cargarlo en el momento** (abre el formulario del producto en Inventario). Para la caja, se le dice
  que lo cargue el dueño.

### 2.3 Inventario — fichas con stock y sin precio

* Un **acceso directo** en Inventario → Productos: filtro/botón «Sin precio (N)» que deja sólo las
  fichas con `stock > 0` y `price_sale = 0`, para cargarles el precio de una pasada (el KPI «sin precio»
  ya existe; lo que faltaba era poder LISTARLAS).

## 3. Lo que NO cambia (invariantes)

* **Nada se borra**: ni la venta, ni su movimiento de inventario, ni su fila del libro.
* **La plata se mueve dos veces y las dos se ven**: el esperado del día baja (la venta deja de contar)
  y el libro guarda el par venta/venta_anulada con su autor.
* **Un cierre guardado no se recalcula** (por eso la venta de un día cerrado no se puede anular hasta
  reabrirlo).
* **La deuda y la caja siguen cuadrando por moneda**: el contra-asiento conserva método y moneda.

## 4. Pruebas (resultado real)

| Tipo | Qué | Resultado |
|---|---|---|
| Rust | `test_void_sale_returns_stock_and_book` (stock +1, movimiento de ENTRADA, contra-asiento con autor/motivo/método/monto/signo, `total_spent` del cliente, el día deja de contarla, la fila queda marcada y sigue en la lista) | ✅ |
| Rust | `test_void_sale_reglas` (motivo obligatorio, venta inexistente, doble anulación, día CERRADO con el camino del remedio, día sin turno, y el asiento en el día **de la venta**) | ✅ |
| Rust | `test_sales_legacy_physical_order` (ampliado: una DB vieja sin las columnas nuevas se lee con `voided_at = None`) | ✅ |
| Rust (suite) | `cd src-tauri && cargo test --lib` | **154/154** (8 ignorados) |
| Puro | `node tools/void_sale_test.ts` (impacto con números, motivo obligatorio, fila anulada, KPIs sin contar lo anulado, moneda/día) | **35/35** |
| En vivo | `node tools/verify_anular_venta.mjs` (vender → anular con motivo → BASE: stock, movimiento, contra-asiento con autor, el arqueo baja EXACTAMENTE el monto; fila tachada + badge + motivo; la caja sin botón y el IPC rechazado; el formulario avisa sin precio y el KPI «Sin precio» LISTA las fichas) | **36/36** |
| En vivo (regresión) | `verify_smoke_integral.mjs` (el chequeo del «botón bloqueado sin producto» se reescribió a la regla nueva: el formulario DICE qué falta) · `verify_arqueo_f69.mjs` **37/37** | ✅ |

**Nota de la 2ª corrección medida en la prueba en vivo:** el botón «Guardar Venta» estaba `disabled` sin
producto o con precio 0 — o sea que el «botón muerto» de la auditoría era un botón **apagado en silencio**
(el operario apretaba y no pasaba nada). Ahora está siempre apretable y el formulario muestra el aviso
(`data-field="aviso-venta"`), además del mensaje al intentar guardar (`data-field="error-venta"`).
