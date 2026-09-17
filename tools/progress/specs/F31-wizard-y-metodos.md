# F31 — Wizard de recepción rápido + acceso directo a los métodos de pago que más se usan

- **Feature:** `feature_list.json` id **31** (priority high) · **MODO DEV** (sin release, sin push)
- **Origen:** pedido directo del usuario (2026-09-16): *«optimizar también el wizard de registrar un cliente, que sea
  rápido y funcional sin dañar nada, profesional»* y *«en los métodos de pago tener como predeterminado lo que más se
  usa, acceso rápido: Punto de Venta (Bs), Pago Móvil, Efectivo $; las demás se dejan pero que uno tenga que buscarlas
  en un desplegable»*.
- **Skills aplicadas:** `harness-engineering` (flujo SDD + gates) · `harness-design-standards` (shadcn/Tailwind v4,
  steppers, un solo lenguaje visual) · `shadcn` (componer con los componentes instalados, `ToggleGroup` para juegos
  de 2-7 opciones, `Select` para el resto) · `form-cro` (menos fricción: defaults inteligentes, auto-foco, validación
  en línea con mensaje específico, marcar obligatorio vs opcional, botones/áreas de toque grandes).
- **Estado:** 🔒 propuesto para congelar.

## 1. Diagnóstico (leído en el código, no supuesto)

**Métodos de pago.** El backend siembra 7 métodos (`db.rs`, `INSERT OR IGNORE INTO payment_methods`): Divisas (USD
Cash) · Pago Móvil · Punto de Venta ($) · Punto de Venta (Bs) · Transferencia Zelle · Transferencia Bs · Efectivo Bs.
Hoy **cada lugar que cobra** los muestra TODOS en un `<Select>` plano:

| Lugar | Archivo:línea |
|---|---|
| Crear servicio (por equipo) | `Services.tsx:1190` (`DeviceFields`) |
| Editar servicio (Finanzas) | `Services.tsx:1872` |
| Pago / Abono | `PaymentDialog.tsx:235` |
| Cerrar venta | `Sales.tsx:422` |
| Devolución | `RefundDialog.tsx:154` |
| Asistente de cierre | `CierreServiceDialog.tsx:429` |

Costo real: en el mostrador el 90 % de los cobros son **Punto de Venta (Bs)**, **Pago Móvil** o **Efectivo $**, y hoy
hay que abrir una lista de 7 y buscar el que corresponde, en cada equipo, cada vez. Además el mismo juego de opciones
está copiado en 6 archivos (la lista del asistente, por ejemplo, ya divergió: usa chips con **todos** los métodos).

**Wizard de recepción.** Es un wizard de 4 pasos (crear) / 5 (editar) con `FormStepper`. Lo que hoy cuesta tiempo:

- **P1 · El botón se apaga sin decir por qué.** «Siguiente» está `disabled={!steps[wizStep].done}` y «Guardar» tiene
  una condición larga (`Services.tsx:2078`): si falta la cédula de un cliente nuevo o el monto, el operario no sabe
  qué le falta para avanzar.
- **P2 · El teléfono no busca al cliente.** El backend `suggest_clients` YA busca por **nombre, teléfono y cédula**
  (con la cédula primero), pero el frontend solo dispara la búsqueda con el campo **Cliente**; escribir el teléfono
  en su campo no trae al cliente conocido (y el cliente casi siempre dice el teléfono).
- **P3 · Nada de teclado para avanzar.** Solo `Ctrl+Enter` guarda y `Escape` cierra: no hay forma de pasar de paso
  con `Enter` ni de que el foco caiga en el primer campo del paso (menos tipeo, menos mouse).
- **P4 · Obligatorio vs opcional sin marcar.** Cédula obligatoria solo para cliente nuevo, blindaje y falla
  opcionales: no está dicho en la pantalla.

## 2. Alcance

### A. Métodos de pago: 3 accesos directos + el resto en un desplegable

Componente COMPARTIDO `src/components/PaymentMethodPicker.tsx`:

- **Favoritos (chips grandes, ~44 px, un toque):** `Punto de Venta (Bs)` · `Pago Móvil` · `Divisas (USD Cash)`
  (se muestra como **EFECTIVO $** con el símbolo de su moneda, vía `shortMethodLabel` + `currencySymbol`).
- **El resto detrás de un desplegable** «Otros métodos…» (`Select`): Punto de Venta ($), Transferencia Zelle,
  Transferencia Bs, Efectivo Bs. Si el método elegido NO es un favorito, se muestra igual como chip/badge activo
  para que el operario siempre vea qué está cobrando (nunca un estado invisible).
- **Datos, no copias:** la lista sale de `api.getPaymentMethods()` (como hoy) y los favoritos son una constante
  exportada (`METODOS_FAVORITOS`); la moneda se sigue derivando del método con `methodCurrency` (una sola regla).
- **Se usa en los 6 lugares** de la tabla de arriba. **NO** se toca el filtro por método del Libro Diario (ahí hay
  que poder ver TODOS para reconciliar).
- El cambio de método conserva la lógica de cada pantalla (comisión del Punto en el servicio/abono, conversión del
  monto con la tasa del día en abono/asistente/venta, etc.): el picker solo elige el nombre.

### B. Wizard de recepción más rápido (sin cambiar ninguna regla)

1. **Enter avanza:** con el paso completo, `Enter` pasa al siguiente (y en el último paso guarda). `Ctrl+Enter`
   sigue guardando desde cualquier paso; `Escape` cierra. Nunca se guarda por accidente: solo avanza si el paso
   está completo.
2. **Auto-foco por paso:** al entrar a un paso, el foco va al primer campo (Cliente → Equipo/modelo → Revisar).
3. **El teléfono también busca al cliente existente** (usa `suggestClients`, que ya busca por nombre/teléfono/cédula):
   con 5+ dígitos en Teléfono se ofrecen los clientes que coinciden y un toque los trae completos.
4. **Qué falta, dicho en pantalla:** junto al botón de avance/guardado, un texto honesto
   («Falta: cédula del cliente nuevo · monto del equipo 1»), en vez de un botón apagado sin explicación.
5. **Obligatorio vs opcional marcado:** `Cédula *` (solo cliente nuevo), `Cliente *`, `Falla (opcional)`,
   `Blindaje (opcional)`.
6. **Resumen del blindaje en el paso Revisar** (chips Sí/No) para que se vea qué se está firmando en el recibo.

## 3. Invariantes (lo que NO puede cambiar)

| Regla | Por qué |
|---|---|
| La moneda se deriva del MÉTODO (`methodCurrency` / `payment-math`) | es la regla de negocio que ya causó bugs de Bs/USD |
| Mismas llamadas al backend: `addOrFindClient`, `addServiceOrder`, `updateService`, `addServicePayment` | el backend sigue siendo la única autoridad (`require_open_day`, `has_bcv_rate_for_payment`, auto-inventario) |
| **CERO cambios en Rust** | el flujo de caja/inventario está verificado y en producción |
| Sin tocar `buildServiceReceiptParts` ni `PrintReceiptDialog` | el recibo es el documento que firma el cliente |
| Los pasos, campos y validaciones del wizard siguen existiendo | «sin dañar nada»: se cambia el orden/foco/avisos, no las reglas |
| Comisión del Punto, referencia Zelle/Pago Móvil y toggle $/Bs. siguen funcionando igual | ya están verificados en vivo |

## 4. Criterios de aceptación

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-1 | En los 6 lugares se ven 3 chips (PUNTO Bs · PAGO MOVIL · EFECTIVO $) y el resto SOLO dentro del desplegable | prueba en vivo por CDP (contar chips y abrir el desplegable) |
| AC-2 | Elegir un favorito y elegir uno del desplegable dejan el mismo estado que antes (mismo nombre de método, misma moneda, misma comisión del Punto) | prueba pura + en vivo: `methodCurrency` del elegido, commission 3.5 % en Punto |
| AC-3 | `Enter` avanza de paso cuando el paso está completo y **no** guarda por accidente | en vivo con CDP (teclado) |
| AC-4 | Escribir el teléfono de un cliente conocido lo trae (nombre/cédula/dirección autocompletados) | en vivo + `suggestClients` (ya busca por teléfono) |
| AC-5 | Cuando falta algo, la pantalla dice QUÉ falta | prueba visual en vivo |
| AC-6 | `npx tsc -b` 0 errores · `npx oxlint` 0 errores · `npm run build` OK · pruebas puras nuevas verdes · `cargo test` intacto (cero cambios en Rust) | scripts |
| AC-7 | Cero regresión: recepción con 1 y con N equipos, abono, venta, devolución y cierre de día siguen igual | prueba en vivo + revisión adversarial |

## 5. Fuera de alcance

- F32 (`close_service_delivery` transaccional) y F33 (vuelto, contador de entregas): siguen pendientes.
- Reordenar/configurar los favoritos desde la app (se cambian en la constante `METODOS_FAVORITOS`; si el local lo
  pide, se hace con una tabla `payment_method_favorites` + pantalla en Ajustes).
- El filtro del Libro Diario y las tablas de reportes: ahí se muestran TODOS los métodos a propósito.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Un `<Select>` con `value` que no existe entre sus items (Radix) rompe el trigger | el desplegable solo lista los NO favoritos y el método activo se muestra aparte como chip; nunca se le pasa un valor ajeno |
| Enter guardando por accidente en medio del wizard | Enter **solo avanza** pasos completos; guardar sigue siendo `Ctrl+Enter` (o el botón del último paso) |
| Tocar 6 archivos y romper un cobro | un solo componente + diff mínimo por archivo (se reemplaza el `Select` por el picker conservando el handler de cada pantalla); revisión adversarial + prueba en vivo |
| El auto-foco pelea con el buscador de modelos | el foco va al primer campo de cada paso y no se re-aplica mientras el operario escribe |

## 7. Resultado de la implementación (2026-09-16) y evidencia

**Lo que quedó en el repo**

| Pieza | Archivo |
|---|---|
| Selector compartido (3 chips + «Otros métodos…») | `src/components/PaymentMethodPicker.tsx` |
| Reglas puras (favoritos + cómo se parte la lista) | `src/lib/payment-methods.ts` |
| Usado en: crear servicio · editar servicio · Pago/Abono · Ventas · Devolución · asistente de cierre | `Services.tsx` (x2), `PaymentDialog.tsx`, `Sales.tsx`, `RefundDialog.tsx`, `CierreServiceDialog.tsx` |
| Pruebas puras | `tools/method_picker_test.ts` (**18/18**) |
| Pruebas EN VIVO por CDP (solo lectura) | `tools/verify_wizard_metodos.mjs` (**14/14**) · `tools/verify_metodos_en_cobros.mjs` (**13/13**) |

**Gates**

| Gate | Resultado |
|---|---|
| `npx tsc -b` | 0 errores |
| `npx oxlint` | 0 errores |
| `npm run build` | OK |
| `tools/method_picker_test.ts` | **18/18** (favoritos en orden, resto en el desplegable, moneda de cada uno, robustez si el local renombra/borra un método) |
| `tools/queue_test.ts` / `tools/payment_math_test.ts` | 47/47 · 595/595 (sin regresión) |
| **Prueba EN VIVO del wizard** | **14/14**: «Nuevo Servicio» abre · **el foco arranca en Cliente** · avisa «Falta: nombre del cliente · cédula del cliente nuevo» · **escribir el teléfono 04125403690 trae al cliente conocido** y un toque completa nombre + cédula · **ENTER avanza a «Paso 2 de 4 · Equipos»** · **los 3 métodos que más se usan están como chips** · los otros 4 NO están a la vista · **el desplegable trae los otros 4** · elegir «Transferencia Zelle» deja ZELLE visible · cerrar no deja diálogos apilados |
| **Prueba EN VIVO de los cobros** | **13/13**: Registrar venta ✓, Pago / Abono ✓ y Devolución ✓ muestran los 3 chips + el desplegable y esconden los otros 4; el asistente de cierre se OMITE con aviso porque esa copia no tenía órdenes activas (usa el mismo componente compartido); y **no se escribió nada**: mismas 7 órdenes y 2 pagos antes y después |
| `cargo test` | no re-ejecutado: **cero cambios en Rust** (`git status` sin nada en `src-tauri/`), y `utils.ts` (recibo) y `PrintReceiptDialog.tsx` intactos |

## 8. Revisión adversarial (2 subagentes) y arreglos aplicados

`harness_review` sigue roto en este entorno → dos revisiones adversariales en paralelo (calidad/correctitud y
consistencia/regresión). Veredictos: **BLOQUEANTE** (calidad, con 2 hallazgos) y **OK con observaciones**
(consistencia, 0 bloqueantes). Todo lo encontrado quedó arreglado:

| # | Hallazgo | Estado |
|---|---|---|
| 1 | **El chip del método más usado se veía «PUNTO Bs Bs.»**: `currencySymbol('VES')` devuelve `'Bs. '` **con espacio final**, y el helper que quitaba el punto no lo recortaba → `'PUNTOBs'.includes('Bs ')` = false. Rompía el AC-1 congelado y **ninguna prueba lo cubría** (el test puro no tocaba el helper y el CDP solo contaba chips) | ✅ **ARREGLADO** en `lib/payment-methods.ts` (`simboloSiAporta` recorta `[.\s]`), aplicado también a los items del desplegable, **con 13 comprobaciones nuevas** (`method_picker_test.ts` 18 → **31/31**) y con la prueba EN VIVO ahora exigiendo el TEXTO exacto del chip (`PUNTO Bs` / `EFECTIVO $` / un solo `Bs`) |
| 2 | **Ctrl+Enter salteaba los gates del botón** (y F31 acababa de anunciar el atajo en el pie): `save()` no revalidaba `needCi`, `dayOpen === false` ni `saving` → se podía guardar un cliente nuevo **sin cédula** (dato que va en el recibo) o con el día cerrado, sin aviso | ✅ **ARREGLADO**: `save()` valida los mismos gates y muestra «No se guardó — falta: …» |
| 3 | **Doble chevron** en el desplegable (yo agregaba uno y `ui/select.tsx` ya pone el suyo) | ✅ **ARREGLADO** (y hay prueba en vivo: `svgs: 1`) |
| 4 | **Mensaje y botón se contradecían**: en el paso Cliente decía «Falta: cédula…» mientras «Siguiente»/Enter sí avanzaban (la cédula bloqueaba recién al guardar) | ✅ **ARREGLADO**: el paso Cliente exige la cédula del cliente nuevo (mismo criterio en el aviso y en los botones) |
| 5 | **En modo crear el aviso no cubría dos bloqueos reales de Guardar**: la pantalla exacta por equipo (`deviceScreenValid`) y (en el último paso) la cédula — botón apagado sin explicación | ✅ **ARREGLADO**: el último paso espeja EXACTAMENTE el `disabled` del botón (cédula, monto, modelo, trabajos, pantalla) |
| 6 | **Enter del combobox de modelo**: sin coincidencia exacta no hacía `preventDefault` → con el paso ya completo, avanzaba de paso en lugar de confirmar el texto | ✅ **ARREGLADO** en `ModelCombobox`: el combobox es dueño del Enter |
| 7 | **Un método fuera de la lista del backend** no daba chip ni badge (estado invisible) | ✅ **ARREGLADO**: el método vigente se muestra igual como badge |
| 8 | **Búsqueda por teléfono sensible a los guiones**: mandaba solo dígitos contra un `LIKE` crudo (un teléfono guardado «0412-1234567» nunca aparecía) | ✅ **MEJORADO**: si la búsqueda por dígitos no devuelve nada, se reintenta con el texto tal cual (2ª consulta al mismo comando) |
| 9 | Autofoco del modelo en el paso Equipos: al enfocarse, el combobox **abría su lista de 60 modelos** tapando los campos | ✅ **REVERTIDO** solo ese autofoco (se mantiene el del paso Cliente); el doc/spec ya no promete auto-foco en todos los pasos |
| 10 | `3.5` de la comisión del Punto hardcodeado en 2 lugares de `Services.tsx` mientras el resto usa `DEFAULT_PUNTO_FEE` | ✅ **ARREGLADO**: una sola constante |

**Lo que las revisiones confirmaron que quedó bien:** nada se perdió en los 6 lugares de cobro (cada `onChange` del
picker es idéntico al `onValueChange` del `<Select>` viejo, con su comisión del Punto, su conversión con la tasa y
sus resets), **moneda = método intacta**, los gates de dinero (Bs sin tasa · día abierto · motivo del saldo · pantalla
agotada) siguen en su lugar, `value=''` es seguro en Radix 2.3.7 (no rompe el trigger), el teléfono se busca sin
carrera de respuestas y sin pisar lo tipeado, el Enter del wizard no puede guardar, el conteo del blindaje es
correcto, **cero cambios en Rust** y `utils.ts`/`PrintReceiptDialog.tsx` sin tocar (recibo intacto).

**Limitaciones conocidas (no bloquean, anotadas):** los favoritos son una constante (cambiarlos desde la app
requiere una tabla + Ajustes); un método nuevo en dólares se etiqueta como Bs porque el frontend decide por
heurística (`isBsMethod`) y el backend conserva lo que le mandan para nombres desconocidos (preexistente); los chips
del modo `sm` miden 36 px (el mostrador con pantalla táctil agradecería 44).

1. La ventana que se está manejando puede servir los **assets EMBEBIDOS** (`http://tauri.localhost/` + `/assets/index-*.js`), no el dev server: en ese caso `npm run build` NO alcanza — hay que `cargo build` (re-embebe) y **relanzar** el exe. Para que `cargo build` no falle con «Acceso denegado (os error 5)» hay que **matar `registro.exe` y los `cargo` PRIMERO**.
2. Navegar la ventana a `http://localhost:5173` a mano da el código nuevo pero **rompe el IPC** («verify_pin not allowed. Plugin not found»): los permisos están atados al origen de la app.
3. `location.reload()` vuelve a pedir el PIN (el gate es fail-closed): los scripts de verificación se desbloquean solos con el PIN del local (1234).
4. En los scripts CDP: el `value` de un `<input>` **no** sale en `innerText` (hay que leerlo del DOM), los `Select` de Radix necesitan un **click real** (`clickCenter`, no `dispatchEvent`), y el texto del stepper nombra TODOS los pasos (la única prueba honesta de que avanzó es «Paso N de M»).
