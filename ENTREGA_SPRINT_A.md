# Entrega — Sprint A: qué cambió, cómo se usa y cómo se verifica

**Fecha:** 2026-09-23 · **Producto:** Registro · Sistema de Servicio Técnico (Tauri 2 + React 19 + SQLite, offline-first)
**Alcance acordado:** **una sola PC**, **sin fotos por ahora** · **Origen:** `AUDITORIA_ENTREGA.md` (secciones 0 y 3.A)

> Este documento es para el dueño del local y para quien entrega: dice **qué se cerró**, **cómo se usa en el
> mostrador**, **cómo se comprueba** y **cómo se publica**. El detalle técnico de cada feature está en su spec
> (`tools/progress/specs/`) y el registro de decisiones en `AGENTS.md` + `tools/progress/history.md`.

---

## 1. Lo que se cerró (4 features, los 3 bloqueantes + los arreglos baratos)

| Feature | Qué problema cerró | Qué hace ahora la app |
|---|---|---|
| **F68 — Sesiones de caja** | El rol «cajera» era **un botón sin autenticación** y **ningún movimiento de plata tenía autor** | Acceso **por persona** con PIN propio (Master / Caja 1 / Caja N), **sesión en el backend** de 12 h con «Bloquear sesión», y un **LIBRO DE PLATA** donde cada movimiento (venta, abono, devolución, gasto, apertura, cierre, anulación) queda **con el nombre de quien lo hizo**. La caja ve su día y sus movimientos; **no** ve utilidad, capital, costos de compra ni los cobros de otras sesiones |
| **F69 — Cada caja cuadra su día** | **El arqueo mentía**: no contaba el fondo de caja ni los gastos pagados del cajón, y los cobros digitales entraban «con el valor del sistema» (diferencia siempre 0) | El cierre muestra el **desglose** (cobrado + fondo − gastos del cajón = lo que debe haber), pide **contar el cajón en las dos monedas** y **verificar en el banco** los digitales, y **no deja cerrar** mientras falte contar algo. Un día sin movimientos también se puede cerrar |
| **F70 — Anular una venta** | Una venta mal tecleada quedaba en la caja **para siempre** y una pantalla devuelta **no volvía al stock** | Botón **«Anular»** en la fila (solo dueño) con **motivo**: devuelve el stock, saca la plata de la caja de ese día y deja el asiento en el libro. La venta **no se borra**: queda tachada con su motivo. Y el botón de vender **ya no está mudo** cuando una ficha no tiene precio |
| **F71 — Respaldo y restauración** | No había respaldo ni restauración **dentro de la app**: la Ayuda decía «copiá registro.db a un USB» | **Ayuda → Respaldos**: «Respaldar ahora» (carpeta elegible, USB incluido), **copia automática al cerrar el día** (se conservan las últimas 14), lista de respaldos y **«Restaurar»** con confirmación — que antes de pisar nada guarda una copia de lo que hay ahora |

---

## 2. Cómo se usa (lo que cambia en el mostrador)

### 2.1 Entrar a la app
* Con **más de una persona** cargada, la app pide **elegir quién entra** y **su PIN** (4 dígitos).
* **Master (el dueño)**: ve y hace todo. **Caja**: vende, recibe equipos, cobra, abona, devuelve, entrega, abre el día, imprime y arma pedidos; **no** cierra el día, no anula ventas, no toca precios/costos/personas/respaldos.
* Con **una sola persona sin PIN** (el caso de siempre: el dueño solo), la app entra directo — nada que aprender.
* **Bloquear sesión** (barra lateral) devuelve a la pantalla de acceso. **La sesión vence a las 12 h**: si vence, la app pide el PIN otra vez (así ningún movimiento queda sin autor).

### 2.2 Cerrar el día (el número del POS)
1. Libro Diario → **Cerrar Día** (lo hace el **dueño**).
2. Arriba está el **desglose**: *cobrado en efectivo + fondo de caja − gastos pagados del cajón = **lo que debe haber en el cajón***.
3. **Contá el cajón**: divisas y bolívares (siempre las dos monedas). Escribí lo que contaste, o pulsá **«Es el esperado»** si coincide.
4. **Verificá el banco**: Zelle, Pago Móvil y Transferencia Bs. **no están en el cajón** — se comparan con la app del banco, y lo que verifiques es lo que queda guardado.
5. El **Punto** se compara con el monto impreso por la máquina.
6. Si algo no cuadra, la diferencia se muestra **en su moneda** («faltan $85.00» / «sobran Bs. 500,00») y **se guarda igual**: un descuadre se documenta, no se esconde.
7. El cierre guarda además una **copia automática de la base**.

### 2.3 Anular una venta (cuando se cobró mal)
Ventas → botón **«Anular»** en la fila (dueño) → el diálogo dice **de qué caja sale la plata y cuántas unidades vuelven al stock** → escribí el motivo → «Anular la venta». La fila queda **tachada** con el motivo y en el libro queda el asiento de reverso con tu nombre.
**Ojo:** una venta de un día **ya cerrado** no se anula hasta reabrir ese día (↺ en Cierres), anularla y volver a cerrarlo — un cierre guardado no se recalcula.

### 2.4 Respaldar y restaurar
* **Ayuda → Respaldos** muestra arriba cómo está el respaldo: «Respaldo de hoy (23/09/2026 18:15)» / «hace 3 días: hacé uno nuevo» / «**todavía no hay ningún respaldo: si esta PC se rompe, se pierde todo el negocio**».
* **«Respaldar ahora»** guarda la base entera en la carpeta que elijas (**«Elegir carpeta (USB)»**).
* **«Restaurar»** en cualquier fila: la app avisa qué se va a pisar, **guarda una copia de lo que hay ahora** y **se reinicia** para aplicar el cambio. Todo lo cargado después de ese respaldo se pierde (por eso el diálogo lo dice).

### 2.5 Personas y accesos (dueño)
Libro Diario → **Personas**: alta de personas (rol Master/Caja, color, PIN), cambiar PIN, apagar y borrar. Reglas: no se puede borrar ni apagar al último Master, y **el dueño no puede quedar sin PIN** si hay más de una persona.

---

## 3. Cómo se verifica (evidencia, reproducible)

Todo se probó **sobre copias de la base** (`REGISTRO_DB` apuntando a `backup/*.db`), nunca contra la base real, y
cada verificación en vivo **compara contra la base leída aparte** (no contra la pantalla).

| Qué | Comando | Resultado |
|---|---|---|
| Tests del backend (Rust) | `cd src-tauri && cargo test --lib` | **157/157** (8 ignorados) |
| Reglas puras | `node tools/arqueo_test.ts` · `void_sale_test.ts` · `backup_test.ts` · `session_test.ts` · `pos_cuadre_test.ts` · `screen_price_test.ts` | **49/49 · 35/35 · 37/37 · 42/42 · 66/66 · 45/45** |
| **F68** en vivo | `node tools/verify_sesiones_caja.mjs` | **28/28** |
| **F69** en vivo | `node tools/verify_arqueo_f69.mjs` | **37/37** y **39/39** (dos copias) |
| **F70** en vivo | `node tools/verify_anular_venta.mjs` | **36/36** |
| **F71** en vivo | `node tools/verify_respaldo.mjs` + `verify_respaldo2.mjs` | **17/17** + **7/7** |
| Regresiones | `verify_smoke_integral.mjs` · `verify_tecnico_y_fecha_pago.mjs` · `release_gate.mjs` | **OK** · **41/41** · **LISTO** |
| Gates del harness | `harness_security` · `harness_truth` | **PASS** · **PASS** |

**Cómo correr una verificación en vivo** (receta del proyecto):
```powershell
# 1) copia consistente de la base (incluye el WAL)
node tools/copy_db.mjs "$env:LOCALAPPDATA\Registro Servicio Tecnico\registro.db" backup\verif.db
# 2) abrir la app de desarrollo apuntando a ESA copia, con el puerto de depuración
$env:REGISTRO_DB="C:\...\backup\verif.db"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
$env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\registro_verif"      # FUERA del proyecto (si no, el watcher muere)
& ".\src-tauri\target\debug\registro.exe"
# 3) correr la verificación (una por vez: los scripts manejan el mouse)
node tools/verify_arqueo_f69.mjs
```
Los scripts **abortan** si `REGISTRO_DB` no está o apunta a `registro.db`, **esperan condiciones** (nunca duermen
a ojo) y **limpian sus residuos** al terminar.

---

## 4. Publicar la release (lo único que falta para el cliente final)

La PC del local sigue con la **0.4.4** (sin F67–F71). El gate de release ya da **LISTO** (5 avisos aceptados por
el dueño: 123 fichas con stock sin precio, 137 sin costo, nombre del negocio de la plantilla).

Pasos:
1. **Subir la versión** en `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml` (0.4.4 → **0.5.0**) y anotarlo en `AGENTS.md`.
2. **Build de release + instalador**: `.\run.ps1 -Build` (compila el frontend, embebe el `dist`, firma y deja el NSIS).
3. **`node tools/release_gate.mjs`** antes de publicar (plantilla limpia, con precios, sin datos de nadie).
4. **Publicar** el instalador + `latest.json` en GitHub Releases (el updater de la app lo lee desde ahí).
5. **Instalar en la PC del local**: la instalación **no pisa** la base del usuario (`registro.db` viaja sólo como
   `registro.default.db` para instalaciones limpias). Al abrir, la app migra la base sola (crea `users`,
   `cash_movements`, las columnas de F69/F70) y, si había un PIN, **nace el Master con ese PIN**.
6. **Primer arranque en el local**: entrar como Master → cargar «Caja 1» en **Personas** con su PIN → hacer un
   **respaldo** desde Ayuda → cerrar un día de prueba con el desglose a la vista.

---

## 5. Fuera de alcance (acordado) y pendientes anotados

**Fuera de alcance por decisión:** multi-PC/multi-sucursal (una sola PC), fotos del equipo (sin fotos por ahora),
nube (offline-first: el respaldo va a una carpeta o USB).

**Pendientes anotados, no ocultos** (no impiden entregar):

| Pendiente | Por qué quedó | Dónde está |
|---|---|---|
| **F40** — libro único de movimientos + conciliación bancaria **por referencia** | Es el proyecto grande: hoy el arqueo se arma sumando ventas + abonos + entregados, y los digitales se verifican por monto, no por referencia | `feature_list.json` (F40) |
| **F37** — tope de la devolución en Bs. cuando la tasa cambió | Decisión de negocio (¿la devolución salda en Bs. o en $?) | `feature_list.json` (F37) |
| El **fondo de caja sólo se declara en dólares** (`initial_cash_bs` no existe) | F69 lo mitiga contando el cajón **siempre en las dos monedas** (un sobrante de Bs. se ve como diferencia) | spec F69 §6 |
| La **caja no puede anotar el gasto que pagó del cajón** (`add_expense` es del dueño) | El dueño lo anota; el arqueo igual lo descuenta porque lee el libro | spec F69 §6 |
| El **test de gates** de comandos es una lista curada a mano | Derivarlo de `lib.rs` es trabajo pendiente | spec F69 §6, AGENTS.md |
| El resto de la sección **3.B/3.C/3.D** de la auditoría (IMEI, vuelto, presupuesto/autorización, garantía con reclamo, impuestos, códigos de barra, cobranza activa…) | Mejoras de valor, no agujeros de entrega | `AUDITORIA_ENTREGA.md` |

---

## 6. Índice de la documentación

| Documento | Qué tiene |
|---|---|
| `AUDITORIA_ENTREGA.md` | La auditoría que originó el Sprint A, con **la sección 0: qué se cerró y con qué evidencia** |
| `ENTREGA_SPRINT_A.md` (este) | La entrega: qué cambió, cómo se usa, cómo se verifica, cómo se publica |
| `AGENTS.md` | El registro de ingeniería: una sección por feature (diagnóstico, qué se implementó, lecciones, pruebas) |
| `tools/progress/specs/F68-sesiones-de-caja.md` · `F69-arqueo-del-cajon.md` · `F70-anular-venta.md` · `F71-respaldo-y-restauracion.md` | La spec de cada feature (reglas, alcance, pruebas, fuera de alcance) |
| `tools/progress/history.md` | Historia append-only, con las vueltas de revisión adversarial y los bugs que cazaron |
| `tools/progress/patterns.md` | Lecciones que futuras sesiones no pueden repetir |
| `README.md` | Índice de scripts de verificación y receta de las pruebas en vivo |
