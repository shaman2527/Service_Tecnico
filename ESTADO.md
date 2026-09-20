# 📋 Registro — Estado del Proyecto (2026-09-18)

> Documento vivo de **todo lo que se ha hecho** y **lo que falta**.
> Complementa a [PRD.md](PRD.md) (qué es el producto), [README.md](README.md) (cómo usarlo)
> y [AGENTS.md](AGENTS.md) (harness + registro de problemas).
>
> ✅ **EL MODO DEV SE LEVANTÓ (2026-09-18):** se publicó la **release oficial v0.4.0** con todo el
> trabajo de septiembre (inventario completo + F30–F42). Ver §15. La regla que sigue valiendo: la
> limpieza y las pruebas de datos se corren sobre **copias** (`backup/*.db`) o sobre
> `REGISTRO_DB=dev_registro.db`; la base del taller (`registro.db`) no se toca nunca desde `tools/`.

---

## 0. Módulo de inventario — trabajo en curso (2026-09-15)

| Fase | Qué se hizo | Evidencia |
|---|---|---|
| F1 | Auditoría del catálogo + mapa canónico de reglas | `tools/audit_inventory.mjs`, `tools/canonical_brands.json`, copia `backup/registro_pre_normalizacion_20260915.db` |
| F2 | Reglas canónicas en Rust + limpieza con respaldo e idempotencia | `src-tauri/src/catalog.rs`, `normalize_catalog`; invariante de stock **702/702 intacto** |
| F3 | Precios restaurados desde la lista CELL WORLD | 957/957 fichas, 982 filas, 0 sin match → 971 SKU con precio (valor a costo $4.407 / venta $5.508,75) |
| F4 | 10 comandos nuevos (página, KPIs, teléfonos, pantallas, movimientos, duplicados, precios, limpieza) | `cargo test` **75/75** |
| F5/F6 | Módulo único con pestañas, tabla paginada, sin columna "Efectivo ($)", sin "Pantallas" en el sidebar | `src/components/Inventory.tsx` + `src/components/inventory/`; `npm run build` ✓ y `npm run lint` 0 errores |
| F7 | Servicio: modelo canónico → pantallas rankeadas → confirmación de agotada → descuento exacto con número de orden | `Services.tsx`, `ModelCombobox.tsx`; test `test_service_stock_faltante_and_order_reference` |
| **F41** | **Inventario RÁPIDO**: memoria corta del catálogo (una vez por versión de la base) + el frontend deja de esperar 200 ms por consulta | `src-tauri/src/cache.rs`, `tools/bench_inventory_ui.mjs`, `tools/verify_inventario_rapido.mjs`; medido: **Modelos 896 → ~120 ms**, entrada 400 → ~100 ms, Movimientos 234 → ~30 ms (detalle en §13) |

Baseline de la auditoría (para comparar cuando se aplique en la tienda): 1126 productos,
29 marcas literales (14 fuera del mapa), 222 modelos con varios teléfonos, 896 nombres no
canónicos, 38 grupos duplicados, 702 unidades, 1126 sin precio (antes de F3).

---

## 0.a Validación pre-producción: bloqueantes B2 y B6 cerrados (2026-09-16) — MODO DEV

El usuario pidió validar todo antes de producción ("quiero la app al 100%"). Se corrió una
validación integral en vivo y se cerraron dos bloqueantes REALES de datos/negocio (B2 de la
lista previa + B6, nuevo, encontrado por el smoke integral).

| Qué | Antes (medido) | Ahora | Evidencia |
|---|---|---|---|
| **B2 · gate de marca de la pantalla a instalar** | El formulario auto-elegía la pantalla de OTRA marca cuando era la única con stock: **36 de 263** teléfonos del padrón (p. ej. `Honor 10 Lite`→`Infinix Hot 10 Lite`, `A11`→`Samsung A11 A115`, `Realme 11 5G`→`Xiaomi Redmi Note 11 5G`, `7 Pro`→Tecno, `G50`/`G60`→Motorola). Al entregar se descontaba el bin EQUIVOCADO | Cada candidata trae `brand_match` + `brand_known`; el orden pone **marca primero**; `autoScreen` (regla pura) solo auto-elige UNA con stock **de la misma marca** y coincidencia exacta/prefijo, en el wizard **y en edición**; aviso «otra marca» en el selector y en el asistente de cierre. Texto AMBIGUO (`A11` = Umidigi A11 y Samsung Galaxy A11) → **sin certeza: no se marca ni se auto-elige** | `cargo test -- --ignored test_manual_brand_gate_report` (263 → 279 auto-selecciones seguras, 0 cruzadas) · `db::tests::test_brand_gate_screens` · `catalog::tests::test_same_brand_gate` · `tools/queue_test.ts` 61/61 · `node tools/verify_screen_brand_gate.mjs` **23/23 en vivo** |
| **B6 · «hoy» usaba la fecha UTC** | `toISOString().slice(0,10)` en Ventas/Servicios/Libro Diario/perfil de técnico: a partir de las **20:00** en Venezuela (UTC−4) los listados de «hoy» quedaban VACÍOS con las ventas ya registradas, y el rango del Libro Diario se corría un día. Las ventanas del backend (`date('now','-N days')`) también eran UTC | Helpers `localDate`/`addDays`/`monthStart` en los 4 componentes y `date('now','localtime','-N days')` en las 7 consultas de ventana | `tools/local_date_test.ts` **17/17** (también con `$env:TZ="America/Caracas"`) · verificado en vivo: la venta del día (22:14) vuelve a aparecer en la lista «Hoy» |

Revisión adversarial (2 revisores independientes sobre el diff, porque `harness_review` está roto
en este entorno): encontraron 2 hallazgos BLOQUEANTES que ya están corregidos y con test —
(1) el **modo EDICIÓN** seguía con la regla vieja de auto-selección, (2) `lookup_brand` elegía marca
por orden de fila en textos ambiguos (invertía el gate)— y 3 menores también corregidos
(auto-precio del descuento dependiente del orden de la lista, `addDays` con fechas que no son
`YYYY-MM-DD`, aviso «otra marca» cuando la marca es DESCONOCIDA). **Riesgo de datos del cliente:
ninguno** — el cambio no escribe ni migra nada y no invalida órdenes viejas (un `screen_product_id`
ya guardado sigue siendo válido y es el que se descuenta).

Abiertos: **B1** (123 SKU con stock sin precio de venta → decisión del local).

### 0.a.2 B5 cerrado: el gate de seguridad del harness ya no es un falso verde (2026-09-16)

El «security gate» que veníamos corriendo no auditaba nada: juntaba solo `.ts/.tsx` bajo `paths.apiDir` (que en este proyecto es `src-tauri/src`), así que **escaneaba el backend dos veces y el frontend nunca**, y los chequeos de secretos/debug vivían únicamente en la rama «API» → **0 hallazgos siempre** (todos los PASS de seguridad anteriores no valían nada).

Ahora escanea `.ts/.tsx/.js/.jsx/.mjs/.rs/.sql` de `src/` **y** `src-tauri/src` (ignorando `target/`), los chequeos universales (secretos/debug) corren en TODOS los archivos, la regla de secretos es «clave/token/contraseña asignada a un literal», y el informe publica `scanned` **fallando si escaneó 0 archivos**. Prueba por comportamiento (inyecta un secreto en el frontend y en el backend, verifica que el gate FALLA, y que al borrarlo vuelve a PASS): `node tools/node_modules/tsx/dist/cli.mjs tools/verify_security_gate.mjs` → **6/6**, 79 archivos auditados. *Pendiente menor: que el CLI del harness salga con exit 1 ante un subcomando inexistente.*

### 0.a.1 B3 y B4 cerrados: rol en el backend + PIN hasheado (2026-09-16)

| Qué | Antes | Ahora | Evidencia |
|---|---|---|---|
| **B3 · rol solo en la UI** | La cajera podía borrar productos, cambiar precios, fusionar fichas, cargar inventario o tocar el PIN con un `invoke()` directo: solo 4 comandos exigían dueño | `db.require_owner()?` en los **25 comandos de escritura del dueño** (catálogo, precios, inventario masivo, gastos, compras, técnicos, borrar servicios/pagos, cierres, PIN, configuración/impresora, padrón) y **ninguno** en los del mostrador (venta, orden, abono, devolución, clientes, abrir turno, recibir pedido, lecturas, impresión). La sesión de dueño **vence a las 12 h** y hay botón **«Bloquear sesión»** en el sidebar (`lock_owner`) | `commands::tests::test_b3_*` (4 tests, incluido uno que LEE `commands.rs` y falla nombrando cualquier comando de escritura que se olvide el gate) · verificado en vivo |
| **B4 · PIN en texto plano** | `settings.pin` guardaba `"1234"`; `set_pin` no exigía nada; sin límite de intentos | PIN **hasheado** (PBKDF2-HMAC-SHA256, 60.000 iteraciones, sal aleatoria) con **migración automática** al primer desbloqueo; cambiar el PIN exige la sesión de dueño; **5 intentos fallidos → 60 s bloqueado** con mensaje | `db::tests::test_pin_hash_owner_gate_and_lockout` · en vivo: el PIN del local pasó de `"1234"` a `pbkdf2$…` y siguió entrando igual |

`cargo test`: **120 pasan / 0 fallan / 6 ignorados** (hooks manuales). En vivo: smoke integral **108/108**, gate de marca **23/23**, wizard+métodos **18/18**, cola de entregas **13/13**, cierre de servicio **17/17**, métodos en cobros **15/15**; puros: queue 61/61, fechas locales 17/17, payment-math 595/595, method-picker 31/31.

**Falta para producción:** decisión de **B1** (precios de los 123 SKU con stock), **B5** (que el security gate del harness escanee `.rs`/`src/` de verdad) y los pasos de release (promover `backup/plantilla_candidata.db` a `registro.db`, bump de versión, `tools/release.ps1` → publica en GitHub, prueba en PC limpia).

---

## 0.b Asistente de Cierre de Servicio (F30, 2026-09-16) — MODO DEV

El taller recibe mucho cliente; cerrar una entrega CON cobro costaba ~13 interacciones y 3 diálogos.
Ahora hay **cola de entregas (F4)** + **asistente de cierre** que pide solo lo que falta y cobra y
entrega en un mismo paso.

| Qué | Dónde | Evidencia |
|---|---|---|
| Cola de entregas (F4): busca por cédula/teléfono/nombre/modelo/nº de orden | `src/components/CierreQueueDialog.tsx` + `src/lib/queue.ts` | filtrado LOCAL (1 sola consulta al abrir); `node tools/node_modules/tsx/dist/cli.mjs tools/queue_test.ts` **47/47** |
| Asistente: pantalla que se instaló (con stock y confirmación de agotada) + cobro ($ / Bs., chips, «todo el saldo», Punto) + entrega + motivo obligatorio si queda saldo + recibo | `src/components/CierreServiceDialog.tsx` | abierto desde la tarjeta («Cerrar») o desde la cola |
| Reglas de dinero en UN módulo | `src/lib/payment-math.ts` (lo usan `PaymentDialog` y el asistente) | `node tools/payment_math_test.ts` **595/595** de paridad con las fórmulas viejas |
| Reglas de pantalla + stepper + actualización de orden, sin copias | `src/lib/screen-rules.ts`, `src/components/ScreenPicker.tsx`, `src/components/FormStepper.tsx`, `src/lib/service-update.ts` | movidos literalmente desde `Services.tsx` |
| Gates | `npx tsc -b` 0 errores · `npx oxlint` 0 errores · `npm run build` OK · `harness_security` PASS · `harness_truth` PASS | `cargo test` NO se re-corrió a propósito (cero cambios en Rust y la otra sesión tenía la app en vivo) |
| **Prueba EN VIVO propia (solo lectura)** | `node tools/verify_cola_entregas.mjs` → **13/13**: botón «Cerrar entrega» · **F4 abre la cola** («3 en taller · 3 con saldo») · cada fila dice «falta cobrar» · la búsqueda acota los resultados · **elegir una fila abre el asistente de ESA orden** · Escape cierra sin apilar diálogos | la app de dev corría contra la COPIA `backup/registro_pre_normalizacion_20260915.db`; el script no escribe NADA y aborta si ya hay un diálogo abierto (para no pisar a otra sesión) |

**Datos de prueba a limpiar en la copia de dev:** esa copia quedó con 5 órdenes «Prueba Cierre A/B…»
(ids 8-10 y 17-18, con `order_num` deformados `''`, `-8`, `-9`, `-10`, `-11`) de las corridas del script de
la otra sesión; 3 de ellas aparecen en la cola como «en taller». Son de la COPIA (no de la tienda) y no se
tocaron desde esta sesión.

**Pendiente (no mezclar con F30):** F31 (cola y pagos en UNA consulta — fin del N+1 de hasta 120
`getServicePayments`), F32 (`close_service_delivery` transaccional: cobro + entrega + stock + `printed`
en un solo tx, con test de rollback; hoy el asistente llama `api.updateService` a mano y el botón
«Entregar» usa `updateOrderKeepingFields`), F33 (vuelto en efectivo, contador de entregas del día).

**Aviso de proceso:** durante F30 hubo **otra sesión de trabajo escribiendo los mismos archivos**
(`CierreServiceDialog.tsx`, `Services.tsx`). Se resolvió cooperando por módulos compartidos y sin
reescribir archivos ajenos en caliente (ver lección en `AGENTS.md`). `harness_review` está roto en este
entorno (falta `tools/reviewer/parallel-review.ts`) → se reemplazó por revisiones adversariales con
subagentes.

---

## 0.c Wizard de recepción rápido + métodos de pago con acceso directo (F31, 2026-09-16) — MODO DEV

Pedido del local: wizard de registrar cliente **rápido y profesional**, y en los métodos de pago los 3 que
más se usan a un toque —**Punto de Venta (Bs), Pago Móvil, Efectivo $**— con **el resto en un desplegable**.

| Qué | Dónde | Evidencia |
|---|---|---|
| Selector de método compartido: 3 chips (PUNTO Bs · PAGO MOVIL · EFECTIVO $) + «Otros métodos…» con los 4 restantes | `src/components/PaymentMethodPicker.tsx` + `src/lib/payment-methods.ts` | `node tools/node_modules/tsx/dist/cli.mjs tools/method_picker_test.ts` **31/31** |
| Se usa en TODOS los cobros: crear servicio, editar, Pago/Abono, Ventas, Devolución y asistente de cierre | `Services.tsx` (x2), `PaymentDialog.tsx`, `Sales.tsx`, `RefundDialog.tsx`, `CierreServiceDialog.tsx` | EN VIVO: `tools/verify_metodos_en_cobros.mjs` **13/13** (Ventas ✓ · Pago/Abono ✓ · Devolución ✓; el asistente se omite porque esa copia no tenía órdenes activas) |
| Wizard más rápido: **Enter avanza** (Ctrl+Enter guarda), auto-foco por paso, **el teléfono trae al cliente conocido**, aviso **«Falta: …»**, Blindaje rotulado (opcional) y su resumen en Revisar | `Services.tsx` (`ServiceForm`) | EN VIVO: `tools/verify_wizard_metodos.mjs` **18/18** |
| Sin regresión y sin escrituras | — | `tsc -b` 0 errores · `oxlint` 0 errores · `npm run build` OK · `queue_test` 47/47 · `payment_math_test` 595/595 · **mismas 7 órdenes y 2 pagos antes/después** de la prueba en vivo · **CERO cambios en Rust**, `utils.ts` (recibo) y `PrintReceiptDialog` intactos |

**Pendiente (no mezclar):** los favoritos son una constante (`METODOS_FAVORITOS`): si el local quiere
cambiarlos desde la app, hace falta una tabla + pantalla en Ajustes. Siguen pendientes F32 (cierre
transaccional), F31-viejo (cola/pagos en una consulta) y F33 (vuelto, contador de entregas).

**Lecciones de verificación en vivo (están también en `AGENTS.md`):** la ventana puede estar sirviendo los
**assets embebidos** (`tauri.localhost` + `/assets/index-*.js`) → `npm run build` no alcanza: hay que
`cargo build` (matando antes `registro.exe` y los `cargo`) y relanzar; navegar a `localhost:5173` rompe el
IPC; `location.reload()` vuelve a pedir el PIN (los scripts se desbloquean con 1234); en CDP el `value` de un
input no sale en `innerText` y los `Select` de Radix necesitan click real.

---

## 1. Resumen

Aplicación desktop **offline-first** (Tauri 2 + React 19 + SQLite) para servicio técnico de
celulares: inventario, ventas, órdenes de reparación, abonos, libro diario con tasa BCV,
impresora térmica y **actualizaciones automáticas con rollback**.

- **Versión en código:** 0.4.0 · **Última release publicada:** **v0.4.0 (2026-09-18)** — [release](https://github.com/shaman2527/Service_Tecnico/releases/tag/v0.4.0). Antes de esta, la 0.2.5 (24/8): todo el trabajo de septiembre estaba sin publicar.
- **Repo:** https://github.com/shaman2527/Service_Tecnico — **PUBLICO** (se descartó privado: GitHub no sirve assets de releases privadas sin auth; el updater no lleva token)

---

## 2. ✅ Todo lo que se ha hecho

### 2.1 Base del producto (sesiones previas, commits hasta `ab2d6aa`)
- Catálogo 982 productos importado (CELL WORLD) con compatibilidad por modelo
- Ventas: conversión automática Bs con tasa BCV, métodos de pago (Punto $/Bs con comisión,
  Zelle con referencia, Divisas, Efectivo Bs, Pago Móvil, Transferencia Bs), filtros y stats
- Servicio Técnico: workflow de 8 estados, multi-trabajo por orden, checklist de blindaje
  10 ítems, garantía 7 días, auto-inventario al entregar, entrega rápida con saldo pendiente
- Abonos/pagos parciales: moneda siempre del método, saldo honesto (pendiente/excedente/cancelado)
- Clientes: auto-creación sin duplicados, búsqueda por cédula tolerante, historial completo
- Libro Diario: un día abierto a la vez, tasa BCV congelada (Auto BCV scrapea con curl.exe),
  cierre con arqueo por método y diferencia, liquidación de Punto, export CSV por rango
- Pedidos a proveedor con reposición sugerida; Dashboard analítico; Centro de Ayuda
- Correcciones duras: `custom-protocol` (ventana en blanco), detección Tauri 2,
  `InvalidColumnType` (SELECTs con lista explícita), deadlocks de Mutex, tasas fallback,
  tabla diaria sin mezclar monedas (grand_usd + grand_bs/tasa del día)

### 2.2 Puesta en marcha producción (`637514c`)
- **Backup** pre-limpieza en `backup/` (DB + export JSON)
- **DB limpia**: 982 productos, 8 categorías, 0 ventas/servicios/cierres, técnicos
  Aldri/William, PIN `1234`, settings impresora por defecto
- **Durabilidad:** `PRAGMA synchronous=FULL` + WAL + busy_timeout (test)
- **Release optimizado:** LTO thin + strip + codegen-units=1 → exe 13.1MB
- **Impresora térmica:** `printer.rs` (ESC/POS, CP850, list_com_ports, print_receipt),
  settings persistidas (puerto/baudios/58-80mm), PrintReceiptDialog + PrinterSettingsDialog,
  botones Impresora/Factura (Services + PaymentDialog)
- **Instalador NSIS:** DB limpia embebida (no sobreescribe la instalada) + WebView2 embebido
- **Gate PIN fail-closed:** nunca abre sin PIN (fix del bypass en arranque en frío)
- **Fix `next_order_num`** con tabla vacía (COALESCE) — el primer servicio no crashea

### 2.3 Actualizaciones automáticas con rollback (`275937e`)
- **Plugin oficial** `tauri-plugin-updater` + `tauri-plugin-process`, firma obligatoria
  (llaves en `~/.tauri/registro.key`, pubkey en `tauri.conf.json`, `createUpdaterArtifacts`)
- **`updates.rs`** (5 tests): `backup_before_update` (exe prev + DB checkpoint + estado +
  watchdog 90s), `run_health_check` (DB/órdenes/día/totales + BCV warning),
  `rollback_update`, `mark_update_ok`, `has_previous_version`
- **UI:** UpdateDialog (notas + progreso + "Recordar después"), check al arranque 5s
  silencioso, botones Revisar/Restaurar en Ayuda, versión dinámica `getVersion()`
- **`tools/release.ps1`**: tests → bump versión → build firmado → `latest.json` → `gh release`
- **Icono nuevo:** smartphone sobre degradado azul→violeta (32/128/256/ICO)

### 2.4 Verificaciones hechas (QA en vivo)
| Prueba | Resultado |
|---|---|
| Suite Rust `cargo test` | **26/26** (5 updates + test_technician_stats) |
| `npm run build` + CSS vars | ✅ PASS |
| Governance harness (`--build-only` / `--security`) | ✅ PASS |
| Loop completo del harness (9 fases) | ✅ **GOAL MET** (61s, 0 errores) |
| Reviewer bus | **0 hallazgos** (9 categorías) |
| Lint | solo warnings preexistentes (tools/, exhaustive-deps viejos) |
| Catálogo | **980 productos, 0 duplicados** (2 Infinix viejos eliminados) |
| Stats por técnico (vivo) | Aldri: 1 entregado $50 · William: 1 en taller — card "Servicios por Técnico" OK |
| E2E conversiones (sandbox, tasa 748.79) | venta $25 + Bs 7.487,90 + abonos $20/Bs 22.463,70 → `grand_total $85` exacto, cierre diff 0 |
| E2E actualización feliz (servidor local) | dialog → kit de rescate → descarga → instalación → relanzamiento → health check → **ok** + aviso; DB intacta |
| E2E update roto (exe basura 39 bytes) | watchdog **restauró** exe 16.448.000 bytes y relanzó la app |
| BCV en vivo (build final) | **752.09 Bs/USD** (scrape real bcv.org.ve) |
| Venta diaria (build final) | venta Bs 7.520,943 → `grand_total 35` exacto, cierre diferencia 0 |
| Gate PIN arranque en frío (instalado) | pide PIN antes de abrir ✅ |
| Instalador /S + desinstalación | DB limpia instalada, 982 productos, uninstall limpio ✅ |
| **E2E multi-endpoint (2026-08-05)** | endpoint 1 roto (connection refused) → endpoint 2 local → dialog "0.1.3" apareció → kit → instalación → relanzamiento → health check ok → estado ok. **DB con datos de prueba INTACTA** (1 servicio + 1 cliente + 1 día + 980 productos) |
| **Fix DB nunca se sobreescribe (2026-08-05)** | reinstalación del setup sobre datos → **hash DB idéntico**; DB borrada → recreada desde `registro.default.db` (980 productos). **Antes: el instalador pisaba la DB (crítico)** |
| Reinstalación build final 0.1.2 sobre instalación con datos | hash DB idéntico, servicio de prueba visible, día abierto con tasa 748.79 ✅ (datos QA limpiados después) |

---

## 3. ⏳ Lo que falta (pendientes)

### P1 — Urgentes (antes de dejar la app en la tienda)

| # | Pendiente | Por qué | Cómo resolverlo |
|---|---|---|---|
| 1 | ~~**`gh auth login` en esta PC**~~ | ~~El token de GitHub estaba inválido (HTTP 401)~~ | ✅ **HECHO (2026-08-06):** token permanente guardado en keyring (`gh auth login --with-token`), scopes completos, rate 5000 |
| 2 | ~~**Publicar la release v0.1.3**~~ | ~~Sin release el endpoint daba 404~~ | ✅ **HECHO (2026-08-06):** `release.ps1 -Version 0.1.3` → setup + .sig + latest.json en GitHub; endpoint `releases/latest/download/latest.json` → 200. **E2E real verificado:** app 0.1.2 detectó 0.1.3, descargó (firma válida), instaló, relanzó y health check → `ok`, kit de rescate generado. **Bug encontrado y fixeado:** GitHub normaliza espacios→puntos en los nombres de assets (`Registro.Servicio.Tecnico_...`) pero `release.ps1` generaba la URL con `%20` → 404 en descarga; fix: `$setupLeaf = (Split-Path $setup -Leaf) -replace ' ', '.'` en release.ps1 |
| 3 | **Guardar copia de la llave privada** | `C:\Users\ROBER\.tauri\registro.key` — **si se pierde, no se pueden publicar más actualizaciones** (los instaladores ya distribuidos quedarían huérfanos). | Copiarla a un USB/carpeta segura. NO subirla a GitHub ni a la nube pública. |
| 4 | **Instalar v0.1.4 manualmente en la PC de la tienda** | La otra PC (cliente) debe tener la app instalada al menos con updater funcional. De ahí en adelante todo automático (la v0.1.4 ya trae "Ver más tarde" con descarga en segundo plano). | Copiar `instaladores\` al pendrive → ejecutar el setup → seguir `INSTALACION.md` (cambiar PIN 1234, abrir día, impresora). |
| 5 | **Activar respaldo Google Drive (opcional)** | Si GitHub estuviera bloqueado en la tienda, los updates no llegarían. Con Drive como 2º endpoint se cubre. | Subir a Drive (público) `latest.json` + el setup (sobrescribir el mismo archivo en cada release — los IDs NO cambian). Crear `tools\drive_ids.json` con los 2 IDs. Agregar el endpoint de Drive en `tauri.conf.json` (`https://drive.usercontent.google.com/download?id=<LATEST_ID>&export=download`) y rebuild. |

### P2 — Importantes (verificar en la tienda)

| # | Pendiente | Por qué | Cómo resolverlo |
|---|---|---|---|
| 5 | **Probar impresora física (COM real)** | Aquí no hay hardware: `list_com_ports` devolvió `[]` y solo se probó el error amigable. | En la tienda: Servicio Técnico → Impresora → Detectar → Imprimir prueba (58mm default; si es 80mm cambiar en configuración). |
| 6 | **Verificar icono visualmente** | Generado por script (no pude previsualizarlo: el modelo no soporta imágenes). | Abrir `src-tauri\icons\128x128.png` y confirmar que se ve bien; si no, se rediseña. |
| 7 | **Cambiar PIN 1234 en la tienda** | El PIN inicial es público en esta documentación. | En la tienda: Libro Diario → botón PIN → cambiar. |
| 8 | **Confirmar internet en la PC de la tienda** | Los updates llegan por GitHub (necesitan internet al arrancar; sin internet la app funciona igual, solo no hay avisos). | En la tienda: abrir la app con WiFi/plan de datos disponible y ver el estado en Ayuda → Revisar actualizaciones. |

### P3 — Mejoras futuras (opcionales, no bloquean nada)

| # | Idea | Nota |
|---|---|---|
| 9 | ~~Dashboard: estadísticas por técnico~~ | ✅ **HECHO (2026-08-05):** card "Servicios por Técnico" (en taller/entregados/ingresos) + `get_technician_stats` + test |
| 10 | ~~Duplicados del catálogo~~ | ✅ **HECHO (2026-08-05):** 982→980 productos, 0 grupos duplicados (2 Infinix viejos sin stock/movimientos eliminados) |
| 11 | Sincronización multiusuario en la nube | Fuera de alcance v1: el respaldo es copiar `registro.db` |
| 12 | Notificación de actualización tipo toast de Windows | Hoy es aviso in-app (suficiente); se puede añadir `tauri-plugin-notification` |
| 13 | Prueba de actualización real contra GitHub | En curso: GitHub volvió a responder (intermitente). Probar tras publicar la release v0.1.2 (P1-2). |

---

## 4. Flujos operativos

### Publicar una versión nueva (cuando haya cambios)
```powershell
# El token ya está en el keyring (gh auth status → Logged in)
.\tools\release.ps1 -Version 0.1.4 -Notes "Qué cambió"
# → tests, bump versión, build firmado, latest.json (URL con puntos, ver fix), release en GitHub
# → las PCs de la tienda avisan solas al arrancar
```

### Instalar en una PC nueva (cliente)
1. Copiar carpeta `instaladores\` a pendrive.
2. Ejecutar el setup (SmartScreen → "Más información → Ejecutar de todos modos").
3. PIN `1234` → cambiar → abrir el día (Auto BCV) → configurar impresora.

### Respaldo manual de datos
- Copiar `%LOCALAPPDATA%\Registro Servicio Tecnico\registro.db` (app cerrada).
- Las actualizaciones ya hacen respaldo automático en `updates\` (exe + DB).

---

## 5. Estado técnico actual

| Componente | Estado |
|---|---|
| Frontend (React 19 + Vite + shadcn) | ✅ build PASS, lint sin nuevos warnings |
| Backend (Rust/Tauri 2, 70 comandos) | ✅ 25/25 tests |
| DB SQLite (WAL + FULL + migraciones idempotentes) | ✅ limpia (982 productos, 0 movimientos, PIN 1234) |
| Instalador NSIS + WebView2 embebido | ✅ 5.69MB en `instaladores\` |
| Updater (firma + rollback + watchdog) | ✅ E2E verificado (feliz y roto) |
| GitHub Releases | ⚠️ pendiente `gh auth login` + primera release |
| Impresora física | ⚠️ pendiente prueba en tienda |

---

*Actualizado: 2026-08-04 · ver también `tools/progress/history.md` (historial append-only) y AGENTS.md (Entropy Registry).*

---

## 6. Actualización 2026-09-15 (tarde) — padrón de teléfonos y limpieza

- **Padrón de teléfonos (tabla `phones`)**: nombre comercial real (`Galaxy A06`, `Moto G52`, `iPhone 13 Mini`, `Redmi Note 11`),
  clave única (`brand|modelo sin línea`, con INCELL = genérica) → **1154 teléfonos, 0 claves repetidas, 341 entradas fusionadas,
  217 marcados “por revisar”** (sin familia, se renombran desde la app). Se reconstruye desde la compatibilidad del catálogo y se
  **reconcilia** (borra filas viejas del catálogo, nunca las manuales).
- **Fusión de productos duplicados**: deja **UNA** ficha por modelo conservando la de **mayor compatibilidad** (une los teléfonos de las
  demás) → **1126 → 1083 fichas**; movimientos/ventas/servicios/pedidos repuntados a la que se queda.
- **Stock y precios en 0** (los datos de inventario/precio de prueba no son reales): `stock`, `price_cost`, `price_sale`, `price_usd`
  → 0 en los 1083. Historial (4 movimientos) y servicios (4) intactos. Respaldos en `backup/backup/registro_pre_wipe_*.db`.
- **UI**: KPIs compactos en una franja; pestaña **Ajustes** (antes “Precios y datos”) en lenguaje de tienda con botones
  “1. Revisar qué cambiaría / 2. Cargar los precios / Ordenar los nombres”; el campo **Modelo** del servicio muestra solo nombres
  (stock únicamente al elegir la pantalla) y el inventario **se refresca solo** al guardar/fusionar/aplicar.
- **Herramientas nuevas de auditoría**: `tools/phones_report.mjs`, `tools/phones_aliases.mjs`, `tools/phones_by_category.mjs`,
  `tools/verify_clean_inventory.mjs` (+ las ya existentes `audit_inventory.mjs`, `snapshot_db.mjs`).
- **Tests Rust: 78/78** (catalog x12 incl. padrón/dedupe/INCELL, inventario unificado x5, precios, printer, multi-equipo, refund E2E).
- **Pendiente inmediato**: F2 comandos del padrón (marcas/lista/ficha/renombrar/añadir/fusionar), F3 tabla de modelos con filtros y
  **orden de 3 estados** en cada columna, F4 ficha por categoría + renombrar los 217, F5 servicio con nombre real,
  F6 **asistente de cargar inventario** y la regla **“solo Pantalla”** (1122 teléfonos desde categoría Pantalla).
- **Sigue todo en MODO DEV**: sin release, sin push, siempre sobre copia con respaldo.

## 7. Cierre 2026-09-15 (noche)

- **Perfil profesional del técnico** funcionando (Dashboard → “Servicios por Técnico” → botón **Ver perfil**): período, KPIs,
  gráfica de trabajo por día, gráfica por tipo de trabajo y tabla de servicios con orden por columna. Backend `tech.rs`
  (`get_technician_profile`) con test pasando; el bug del rango (fecha con hora) quedó corregido.
- La tarjeta del técnico se movió **antes de “Stock Bajo”** en el Dashboard.
- Suite Rust **81/81**; `npm run build` ✓. App de dev corriendo sobre la copia de prueba.
- **Pendiente**: F3 tabla de modelos con filtros + orden de 3 estados · renombrar los 217 · asistente de cargar inventario ·
  regla “solo Pantalla”. Sin release ni push (modo dev).

## 8. F3 — Pestaña «Modelos» del padrón (2026-09-16, MODO DEV)

**Hecho:** pestaña **Modelos** en Inventario (tabla del padrón `phones`), **marca como columna y como filtro** (Select con
conteos por marca), **orden de 3 estados** (`sin orden → ascendente → descendente`) en Teléfono/Marca/Repuestos/Stock/Estado,
búsqueda por tokens, vistas `Todos / Con repuestos / Con stock / Por revisar` + botón «Ver los 217 por revisar»,
paginación server-side, KPIs (Teléfonos 1154 · Con repuestos · Con stock · Por revisar 217) y **ficha de solo lectura**
con los repuestos **por categoría (Pantalla primero)**. La pestaña de consulta se renombró «Por modelo» →
**«Repuesto por modelo»** para no confundirla con el padrón (y el Centro de Ayuda se actualizó).

- **Backend:** `get_phones` gana `only_review` y el sentido (`dir`) ahora manda en **todas** las columnas con el nombre
  como desempate ascendente (antes solo 3 columnas y con un `reverse()` que invertía el desempate); `PhoneBrandRow`
  gana `needs_review`. **Sin comandos de escritura nuevos** (renombrar/fusionar = feature 24).
- **Archivos:** `src/components/inventory/ModelsTab.tsx`, `PhoneDetailDialog.tsx`, `Kpi.tsx`, `src/lib/phoneOrder.ts`,
  `tools/verify_models_tab.mjs`, `tools/progress/specs/F3-modelos-tabla.md`; tocados `Inventory.tsx`, `ProductsTab.tsx`
  (KPIs compartidos), `Help.tsx`, `types.ts`, `db.ts`, `phones.rs`, `commands.rs`.
- **Verificación:** suite Rust **82/82** (test nuevo de orden de 3 estados + filtro por revisar); `npm run build` ✓ y
  `npm run lint` **0 errores** (sin warnings nuevos); **CDP en vivo 23/23** (`tools/verify_models_tab.mjs` sobre
  `backup/registro_pre_normalizacion_20260915.db`); **contraste SQL↔comandos 12/12** (1154/teléfonos, 217 por revisar,
  26 marcas, Samsung 261, órdenes asc/desc de nombre y marca); gates: `harness_security` PASS, `harness_truth` PASS,
  `npx tsx tools/cli/index.ts parallel` (security+review+build) ✅ y revisión adversarial con subagente.
- **Nota de herramienta:** `harness_*` necesitaba `tools/config/` como DIRECTORIO (con la config en `tools/config.ts`
  respondía «No Harness ENGINEERING copy found»); se agregó `tools/config/harness.json`. `harness_review` sigue sin poder
  correr (espera `tools/reviewer/parallel-review.ts`, que esta copia v2.0 no trae): se reemplazó por el CLI del proyecto
  + subagente revisor.

### Revisión adversarial de F3 (subagente independiente) — 1 bloqueante + 10 hallazgos, todos corregidos

| # | Sev. | Qué | Fix |
|---|---|---|---|
| 1 | **BLOQUEANTE** | `get_phone_detail` sacaba las **categorías** de la clave canónica y los **repuestos/stock** de la unión con alias: tras **renombrar** (clave nueva + alias del inventario, justo el flujo de la feature 24) la ficha salía **vacía** diciendo «0 repuestos» y «N u. en stock» a la vez. | `merged_stats` reescrito (unión clave+alias = única fuente de repuestos, stock por ID y categorías); la ficha usa `by_cat`; `get_phone_brands` también. **Test de regresión `test_phone_detail_and_brands_survive_rename`** (83/83). |
| 2 | MAYOR | `SELECT p.*, c.name` + `r.get(14)`: `search_text` está en cid 14 → `category_name` leía basura (visible en la columna «Categoría» de Productos). | Corregido en `phones.rs` con **lista explícita de columnas**; los 6 sitios de `db.rs` quedan como **feature 27** (bug pre-existente, verificado en vivo: `get_products` devuelve `category_name` = texto de búsqueda). |
| 3-6, 9 | MENOR | Copy del estado vacío, reset de página en el efecto (consulta con offset viejo), `page` sin acotar («Mostrando 351–300 de 300»), `.catch` silencioso (un fallo de IPC se veía como «sin resultados»), botón de icono sin `aria-label`. | Copy condicionada + singular/plural; reset de página en los handlers; clamp a la última página real; `db.ts` ya no se traga el error dentro de Tauri y la pestaña muestra **Alert + Reintentar**; `aria-label`. |
| 7, 10, 11 | MENOR | Paginación que corta en memoria (aceptado, 1154 filas); `limit`/`offset` sin validar; roles (la pestaña es solo lectura y el backend del proyecto no tiene gates de rol). | `limit.clamp(0,1000)` + `saturating_add`; documentado. **Para F4:** `rename_phone`/`add_phone`/`merge_phones` ya están registrados y cualquier rol puede invocarlos → gatear en UI **y** backend. |
| 8 | MENOR | `to_lowercase()` por comparación y sin quitar acentos. | Claves de orden precalculadas con `catalog::norm` (Ñ/É ordenan con N/E). |

Además el revisor detectó que los tests usaban **nombres de DB fijos** (dos `cargo test` en paralelo se pisaban y daban
fallos falsos) → ahora usan `std::env::temp_dir()` + `std::process::id()`.

**Extra de esta sesión (fuera del alcance de F3, ya aplicado):** `vite.config.ts` ignora los temporales de los editores
(`**/.*.tmpdir/**`, `**/*.tmp`) — sin eso, editar cualquier `.tsx` con la app corriendo mataba el dev server y con él
`tauri dev` (`EBUSY`). Y `tools/cdp_driver.mjs` envía `awaitPromise` (sin él las evaluaciones async devolvían `{}`).

**Pendiente (en este orden):**
1. Corregir a mano los teléfonos que siguen «por revisar» (**142**) desde Inventario → Modelos → «Corregir».
2. Cuando esté conforme con el módulo de inventario: levantar el MODO DEV (release + push) — lo decide el usuario.
3. Pendientes de tienda que no son de código: guardar copia de la llave privada del updater, probar la impresora física y
   cambiar el PIN 1234 (ver §3).

## 12. F30 — asistente para cerrar cada servicio (2026-09-16, MODO DEV)

En **Servicio Técnico**, cada tarjeta de una orden activa tiene un botón **«Cerrar»** (rayo) que abre
`src/components/CierreServiceDialog.tsx`: un asistente que dice **qué falta** para cerrar la orden y pide **solo eso**.

1. **¿Qué pantalla se instaló?** (solo si el trabajo incluye «Cambio pantalla» y hay pantallas en el catálogo): lista las
   compatibles del modelo con el **stock** de cada una y badge «agotada».
2. **Cobro:** monto con toggle **$ / Bs.**, chips rápidos, **«Todo el saldo»**, método, comisión del Punto y referencia
   Zelle. La aritmética sale de **`src/lib/payment-math.ts`**, el módulo compartido con «Pago / Abono» (test de paridad
   `tools/payment_math_test.ts`: **595 comprobaciones**).
3. **Cerrar y entregar:** un botón que registra el cobro y pasa la orden a **Entregado** (descuenta el stock de la
   pantalla elegida y le pone la fecha de hoy), con la opción de **imprimir la orden al cerrar**.

- **Entrega con saldo:** permitida, pero con **motivo obligatorio** (el botón queda deshabilitado sin él) que se guarda en
  la orden como `Entregado con saldo ($X): motivo`.
- **Antes vs ahora:** ~13 interacciones y 3 diálogos por cliente (cobrar → entregar → imprimir) → **un diálogo y, como
  mucho, dos datos** (pantalla y monto, ambos precargados). Ctrl+Enter cierra, Escape sale.
- **Verificación en vivo:** `tools/verify_servicio_cierre.mjs` **14/14** (crea dos órdenes de prueba y las borra): avisa lo
  que falta, elige la pantalla con su stock, precarga el saldo, cierra dejando la orden **Entregado + abonada $30 + stock
  6 → 5 + movimiento «Servicio Entregado»**, y exige el motivo cuando se entrega debiendo.
- **Origen:** pedido del usuario («un asistente en la parte de servicio que vaya ayudándolo a cerrar cada servicio rápido,
  sea intuitivo, que a medida vaya necesitando introducir un dato, optimizar el proceso»). El spec lo había escrito otra
  sesión en paralelo; por decisión del usuario **esta sesión lo cierra** y **reutiliza su módulo de dinero compartido** en
  vez de duplicar la aritmética.
## 11. F25 + F26 + F28 + F29 — cargar el inventario desde la app y regla «solo Pantalla» (2026-09-16, MODO DEV)

### F25 — Asistente de carga de inventario
Para cuando se cuenta la mercancía del mostrador: **Inventario → Ajustes → «Cargar la lista del local»**.

1. **Pegar o abrir** la lista tal como está escrita (una marca por línea y debajo sus modelos:
   `A30/A50 (2)` = 2 unidades de la pantalla que sirve para los dos).
2. La app **cruza** cada línea contra el catálogo — **solo pantallas**, con **gate de marca** y calidad
   exacta/prefijo/parecida, hasta 6 alternativas por línea — y muestra una **vista previa editable**: cantidad fila por
   fila y el producto que la recibe. Lo que no encuentra **lo avisa** (nunca inventa una ficha).
3. Al aplicar: **respaldo** de la base (`backup/registro_pre_carga_<fecha>.db`), stock por producto y **movimiento**
   «Carga de inventario»; la opción (marcada por defecto) deja en **0** las pantallas que no están en la lista, porque la
   lista es todo lo que hay. **No toca precios ni compatibilidad** y **exige el PIN del dueño**.
4. Módulo `src-tauri/src/loadlist.rs` (parseo + cruce + aplicar), comandos `preview_inventory_load` /
   `apply_inventory_load`, UI `src/components/inventory/LoadInventoryDialog.tsx` (3 pasos, con abrir `.txt`).

**Endurecido en DOS vueltas de revisión adversarial (misma jornada):**

Primera vuelta:

- **Las líneas que caen en la MISMA ficha SUMAN** sus unidades (`13C (6)` + `Redmi 13C (12)` → 18): antes mandaba la
  primera y **se perdían unidades reales**. La vista previa avisa «otra línea comparte pantalla» y el botón dice
  **fichas** (no líneas) y unidades reales.
- **La categoría NO la elige quien llama**: el barrido usa siempre `catalog::PHONE_CATEGORIES` (Pantalla/Táctil/Táctil
  Tablet). Antes un invoke a mano con `categoryId=48` podía **vaciar Batería/Flex** entera.
- **`c/m` (con marco) no es modelo** y la conectividad (`4G`, `5G`…) no se cruza sola. El encabezado de marca exige que
  el texto **sea** una marca conocida («Note» ya no re-marca la sección).
- **Un modelo solo de números vale si trae unidades**: `13 (25)` = 25 iPhone 13; sin número sigue siendo basura.
- **Cantidad ilegible** («A30 (dos)») → la fila se avisa y **no se aplica sola**.
- **El barrido se muestra ANTES de aplicar** (fichas y unidades que quedarían en 0); un **stock negativo** que vuelve a 0
  se registra como **entrada**.
- **El resumen se VE**: al aplicar, la pestaña ya **no** salta a Productos (el diálogo se desmontaba y el paso 3 nunca se
  veía). `PricesTab` recibe `onRefresh` para refrescar sin desmontar el asistente.

Segunda vuelta (hallazgos con **evidencia medida** sobre `tools/inventario_real.txt` — 261 líneas / 713 unidades — y una
copia consistente de la base):

- **GATE DEL BARRIDO (lo más grave):** si la lista es TODO el inventario y alguna línea con unidades quedó **sin pantalla
  asignada**, la carga **no se hace** y el error dice qué hacer (asignarla, corregir el nombre en Productos o desmarcar el
  barrido). Medido antes: de las 87 fichas que el barrido dejaba en 0, **79 (152 unidades) estaban escritas en la lista**
  —solo que con un nombre que no cruzó— y quedaban movimientos de «salida» de mercancía que nunca salió.
- **keep_ids:** el barrido **nunca toca** las fichas que la vista previa ya tenía asignadas, así cambiarle el producto a una
  línea (o desmarcarla) no deja en 0 una mercancía que sí está.
- **Marca canónica en el gate:** la marca del producto se canonicaliza igual que la de la sección (`Redmi` → `Xiaomi`).
  Comparar la marca cruda dejaba **fuera del cruce 57 fichas «Redmi» (119 unidades)**; una ficha **sin marca** sigue siendo
  candidata.
- **Contención por PALABRA completa** (`catalog::contains_word`): «a3» ya no cruza con «a33 bateria» ni «15» con
  «redmi 15c» — antes se inflaban unidades en la ficha de OTRO teléfono (el A33 cargaba una pantalla del A3).
- **El texto completo de la línea es objetivo del cruce:** fichas que se llaman igual que la línea («A17 c/m 4G/5G»)
  quedaban sin candidato y el barrido se las llevaba a 0.
- **Respaldo honesto de verdad:** se hace con **`VACUUM INTO`** (foto completa que incluye el `-wal`); si no se puede, cae a
  checkpoint + copia y **aborta si el checkpoint queda ocupado** (antes `execute_batch` descartaba la fila `busy` y el
  respaldo podía quedar viejo sin aviso).
- **Cantidad absurda** acotada YA en el parseo (la vista previa, el botón y el reporte dicen el mismo número) y la línea
  queda **avisada** para que la corrija el operario.
- **El reporte dice la verdad:** `unassigned`/`unassigned_units` (líneas y unidades que NO se cargaron) se muestran en el
  paso 3, `skipped` cuenta **líneas** (no fichas), y la tira de la vista previa avisa «N líneas sin pantalla (M u. que NO
  se cargan)».
- **Resultado medido sobre la lista real del local** (misma base y misma lista, antes → después): líneas cruzadas
  **249 → 260**, líneas sin pantalla **12 → 1** (queda «6 c/m Accesorios», que en el catálogo se llama «6 c/m Acasonor»:
  un error de tipeo del catálogo), unidades que se aplican **682 → 712** de 713, fichas que el barrido dejaría en 0
  **87 → 47**. Es decir: **30 unidades reales que se perdían y 40 fichas (93 unidades) que se vaciaban de más**.
- **Limitación que quedó cerrada por F28** (ver abajo): una línea SIN ningún candidato no se podía asignar a mano.

### F26 — regla «solo Pantalla»
- `catalog::PHONE_CATEGORIES = [1 Pantalla, 18 Táctil, 19 Táctil Tablet]` es la regla del local: el **padrón**
  (`rebuild_phones`) y sus **números** (`phones::phone_index`) se arman **solo con esas categorías**.
- La pestaña **Productos** abre **filtrada en Pantalla** (se busca la categoría por nombre, no por id), el filtro se puede
  quitar para ver el resto del catálogo, y un aviso aclara que **los KPI de arriba son de todo el catálogo**.
- Resultado en la copia de trabajo: padrón **1134 → 1079** teléfonos y «por revisar» **161 → 142** (25 marcas), con los
  **1083 productos y 6 unidades intactos** (48 fichas quedan fuera del padrón por no ser pantallas). Respaldo:
  `backup/pre_f26_solo_pantalla_20260916.db`. **Ojo:** con solo `1` (primera versión) se perdían 55 teléfonos que solo
  tenían repuestos de Táctil/Táctil Tablet — de ahí el conjunto de tres categorías.

### F28 — asignar a mano CUALQUIER pantalla a una línea (cierra el módulo)
El nombre de la lista escrita a mano y el del catálogo no siempre coinciden. Caso real de la lista del local:
**«6 c/m Accesorios (1)»** contra la ficha **«Pantalla Xiaomi Redmi 6 C / Redmi M Acasonor / Redmi M Accesorios»**
(`c/m` = **con marco**: la pantalla viene con el marco). Antes esa línea quedaba sin pantalla y, con el barrido marcado,
bloqueaba la carga (a propósito, para no vaciar mercancía que sí está).

- **Cada fila tiene buscador:** botón **«Buscar la pantalla»** (o «Buscar otra…» si ya tenía candidatos) que abre un
  buscador por texto sobre las fichas de las **categorías de pantalla** (nombre + marca + modelo + compatibilidad: la
  misma búsqueda por tokens del inventario). Al elegir una, la fila queda **«asignada a mano»** y se comporta igual que
  un cruce automático: suma unidades por ficha, entra en `keepIds` (el barrido no la vacía) y deja de contar como
  `unassigned`.
- **Backend:** `loadlist::search_targets(conn, query, limit)` (solo lectura, `limit` acotado 1..50 y mínimo 2 caracteres:
  una sola letra devolvería medio catálogo) + comando **`search_inventory_load_targets`**.
- **Medido en vivo con la lista REAL (261 líneas / 713 u.):** 260 cruzadas + 1 sin pantalla (712 u.) → se busca
  «acasonor», se asigna → **261 cruzadas, 713 unidades en 226 pantallas** y el aviso de «línea sin pantalla»
  desaparece. `tools/verify_inventory_load_real.mjs` **12/12** (sin aplicar: el stock no se toca).
- **Ayuda al usuario:** el Centro de Ayuda (sección *Inventario*) explica el conteo (marca por línea, `(N)` unidades,
  `A30/A50`, **`c/m` = con marco**, corregir a mano y el respaldo) y los botones de escritura del padrón (F24).
- **Revisión adversarial aplicada:** la **cantidad sin leer** es un campo propio (`LoadRow.qty_issue`) que **no se borra**
  al asignar a mano y que **bloquea la carga** (antes, asignar la ficha escribía 0 o 100.000 u. en silencio); Escape cierra
  el buscador y no el asistente (`onEscapeKeyDown` de Radix — el handler de React era código muerto); la carrera de
  respuestas del buscador se resuelve con un contador; el error de búsqueda se muestra (antes decía «ninguna coincide»);
  `Atrás` avisa si hay correcciones; la etiqueta «asignada a mano» es **por fila**; y la fila avisa si hay **fichas
  parecidas** (duplicados) para fusionarlas en Productos.

### F29 — carga rápida y proveedor que trajo la mercancía
Lo que el local pidió para que la carga sirva de verdad: **no tener que verificar tanto** y dejar anotado **quién trajo
cada pantalla**.

- **Carga rápida:** cada fila tiene un tilde **«Cargar»**. El operario puede **excluir** una línea (no es una línea sin
  resolver: no bloquea el barrido, no cuenta como `unassigned` y queda informada en el resumen) y, cuando el barrido está
  marcado y quedan líneas sin pantalla, el asistente ofrece el botón **«Excluir esas líneas y cargar el resto»** — antes
  había que elegir entre no cargar nada o asignarle una ficha equivocada.
- **Proveedor:** campo **«Proveedor que trajo la mercancía»** para toda la carga **+ proveedor por línea** (la línea manda
  sobre el general). Se guarda en **`products.supplier`** (columna nueva, migración idempotente al final del orden físico)
  de cada pantalla cargada, el paso 3 informa «N pantallas quedaron con su proveedor anotado», y se puede **ver y
  corregir** en la ficha del producto (comando `set_product_supplier`) y en el inventario (chip junto al nombre). Sin
  proveedor **no se pisa** el que ya estaba.
- **Medido en vivo:** `tools/verify_inventory_load.mjs` **30/30** (incluye que el proveedor quede guardado en la ficha) y
  `tools/verify_inventory_load_real.mjs` **12/12** (con la lista real: exclusión de un clic → 712 u., re-incluir y asignar
  a mano → 713 u.).

### Verificación
- `cargo test` **111/111** (17 de F25/F28/F29: parseo con `c/m`/numéricos/marca estricta, tope de cantidad, cruce con gate
  de marca, suma de líneas que comparten ficha, aviso del barrido con el faltante, aplicar con
  respaldo/movimientos/idempotencia, suma de repetidas e inválidas, **gate del barrido**, lista vacía, `keep_ids`, marca
  canónica sin falsos positivos, **búsqueda a mano**, **gate de la cantidad sin leer**, **exclusión de línea** y **el
  proveedor que trajo la mercancía**) + hook manual `test_manual_preview_real_list` para medir la lista real sobre una copia.
- **CDP en vivo** `tools/verify_inventory_load.mjs` **30/30**: el Inventario abre en «Pantalla» con el aviso de KPI; el
  asistente está en Ajustes; el paso 1 acepta la lista pegada; el cruce muestra 3 líneas / 2 cruzadas / 1 sin producto
  **con su aviso**; cantidades editables y con etiqueta accesible; **avisa las pantallas que quedarían en 0** y las
  **unidades que NO se cargan**; el **barrido no deja en 0 mercancía que la lista menciona**; **la línea sin pantalla se
  busca y se asigna a mano** (entra en el total y queda marcada); **el proveedor se anota y queda guardado**; cerrar sin
  aplicar no toca el stock; al cargar **se ve
  el paso 3** (resumen + respaldo) **sin saltar de pestaña**; y la **Ayuda** explica el conteo.
- **CDP con la lista REAL** `tools/verify_inventory_load_real.mjs` **12/12** (261 líneas / 713 u., sin aplicar nada):
  260 cruzadas → exclusión de un clic (712 u.) → se re-incluye y se asigna a mano la única línea sin pantalla →
  **261 cruzadas y 713 unidades**; stock `6 → 6`.
- Regresión: `tools/verify_models_tab.mjs` **23/23** (con 1079/142) y `tools/verify_phones_edit.mjs` (**dueño 9/9**,
  **cajera 6/6** — este último exige app arrancada limpia: el gate del backend queda abierto mientras vive el proceso).
- `harness_security` PASS · `harness_truth` PASS · `tools/cli parallel` ✅ · specs:
  `tools/progress/specs/F25-F26-carga-y-solo-pantalla.md` · **sin features abiertas (1-29 cerradas)**.

## 10. F24 — renombrar y fusionar la lista de teléfonos (2026-09-16, MODO DEV)

Ya se puede **corregir la lista maestra desde la app** (Inventario → Modelos, solo el dueño):

- **Reglas canónicas aplicadas** (decisión del usuario): «**Poco**» es línea propia → el nombre es «Poco X3» (sin «Mi» ni
  «Redmi» delante) y la **clave conserva `poco`**, así que «Poco X3» y «Redmi Poco X3» son el MISMO teléfono;
  «**Honor**» y «**Realme**» mandan sobre la marca madre («Huawei Honor X6A» → «Honor X6A», «Oppo Realme C35» → «Realme C35»).
- **Resultado en la copia de trabajo:** **1154 → 1135** teléfonos y **217 → 162** «por revisar» (tras fusionar «8P» con
  «Spark 8P» desde la app quedó en **1134 / 161**). Cero productos, stock o precios tocados. Respaldo previo en
  `backup/pre_f24_reglas_20260916.db`.
- **UI (solo dueño):** «**Corregir**» (marca + línea + modelo con **vista previa** del nombre, aviso si ya existe otro
  teléfono con ese nombre y oferta de fusionar, mostrando los repuestos que conserva), «**juntar**» (fusiona dos fichas del
  mismo teléfono: la que abrís se queda y hereda los alias) y «**Agregar teléfono**».
- **Backend:** `rename_phone` ahora calcula la clave con la MISMA función que el padrón (antes dejaba el nombre viejo
  duplicado en la próxima reconstrucción); `add_phone` avisa si ya existe; **comando nuevo `preview_rename_phone`** (solo
  lectura) y **`can_edit_phones`**; el catálogo **no resucita** las claves reclamadas por los alias de las filas escritas a
  mano (renombrar no deja rastro del nombre viejo); `get_phone_models` (lista del formulario de servicio) lee el **padrón**,
  así el nombre corregido es el que se ve al registrar un servicio, y la búsqueda de repuestos del servicio **resuelve los
  alias** (renombrar no rompe la pantalla compatible).
- **Gate de escritura real:** el PIN del dueño desbloquea la sesión (`owner_unlocked`); `rename_phone`/`add_phone`/`merge_phones`
  exigen esa sesión. Verificado en vivo con una sesión de cajera: los botones no aparecen **y** el backend rechaza el
  `invoke` con «Solo el dueño puede cambiar la lista de modelos…».
- **Verificación:** `cargo test` **89/89** (tests nuevos de reglas Poco/Honor/Realme, vista previa, renombrar sin duplicado y
  gate de dueño) · build ✓ · lint 0 errores · **CDP 23/23** (F3) + **9/9** (dueño) + **6/6** (cajera) + escrituras reales
  (fusión/alta/renombrado) · `harness_security` y `harness_truth` PASS · CLI parallel ✅.
- Spec y scripts: `tools/progress/specs/F24-renombrar-fusionar.md`, `tools/verify_phones_edit.mjs`,
  `tools/verify_phones_write.mjs`.

### Revisión adversarial de F24 (subagente independiente) — 1 bloqueante + 2 mayores + 7 menores, corregidos

| # | Sev. | Qué | Fix |
|---|---|---|---|
| 1 | **BLOQUEANTE** | Si el renombrado **cambia la marca**, la clave vieja no quedaba reclamada (los alias se canonicalizan con la marca NUEVA) → el siguiente rebuild **recreaba la ficha vieja** y la renombrada quedaba sin repuestos (reproducido por el revisor: `creados 1`). | `rename_phone` guarda el **nombre y marca+modelo VIEJOS como alias** + test `test_rename_con_cambio_de_marca_no_recrea_la_ficha_vieja`. |
| 2 | MAYOR | El rebuild **pisaba** las filas `source='manual'` (brand/line/model/name/**aliases**), borrando el vínculo con los repuestos. | `existing` trae `source` y el rebuild omite las manuales + test `test_rebuild_no_pisa_las_filas_manuales`. |
| 3 | MAYOR | `rename_phone`/`merge_phones` no validaban que las filas existieran (el merge podía borrar una ficha sin guardar sus alias). | Error claro («ya no está en la lista…») + test `test_rename_y_merge_validan_que_existan`. |
| 4-10 | MENOR | Vista previa con choque mal etiquetada; `owner_can_edit` **fail-open**; `can_edit_phones` sin uso en la UI; `get_phone_models` escondía las altas manuales; **los toast no se veían** (no había `<Toaster />` montado — defecto global); icono/aria del botón de fusionar; comentario doc partido. | Cada uno corregido (ahora la UI consulta `can_edit_phones`, el gate es fail-closed, las altas manuales salen en el selector —buscando también por marca—, `App.tsx` monta `<Toaster richColors />`, icono `Merge` + `aria-label`). |

**Corregido además antes de la revisión (encontrado al comprobar idempotencia):** fusionar dos fichas del CATÁLOGO no se
sostenía (la sobreviviente quedaba como `catalogo`, no reclamaba la clave vieja y el rebuild recreaba el teléfono juntado);
`merge_phones` ahora marca la que queda como `manual` → rebuild en seco **creados 0 · sin cambios 1134**.
**Estado final:** `cargo test` **93/93** · build ✓ · lint 0 errores · CDP 23/23 + 9/9 + 6/6 · security/truth PASS · CLI parallel ✅.

## 9. F27 — columna «Categoría» del inventario (2026-09-16, MODO DEV)

Bug **pre-existente** (detectado por la revisión adversarial de F3): `products` tiene 15 columnas físicas y
`search_text` quedó en **cid 14** por un `ALTER TABLE`; los 6 `SELECT p.*, c.name as category_name` de `db.rs`
mapeaban `category_name: r.get(14)` → leían el texto de búsqueda. La columna **«Categoría»** de
Inventario → Productos mostraba «pantalla infinix hot 30i go 2023 …».

- **Fix:** constante **`PRODUCT_COLS`** (lista explícita; `0..13` producto y **14 = `c.name`**) aplicada en
  `get_products_page`, `find_compatible_products`, `get_products`, `get_low_stock_products`, `get_reorder_suggestions`
  y `suggest_products`. Cero `SELECT p.*` en el backend. Test nuevo `test_product_category_name_is_real_category`
  (recorre los 6 comandos y compara contra la tabla `categories`).
- **Verificado:** `cargo test` **85/85**, build ✓, lint 0 errores; en vivo los 4 comandos devuelven «Pantalla» y la
  **columna de la UI ya dice «Pantalla»** (CDP); sin regresión en Modelos (23/23) ni en el contraste SQL (12/12);
  KPIs iguales a SQL (1083 SKU · 1 con stock · 6 u. · 26 marcas); security/truth PASS y CLI parallel ✅.
- Spec: `tools/progress/specs/F27-category-name.md`.

---

## 13. F41 — Inventario RÁPIDO: cada pestaña muestra los datos al instante (2026-09-17, MODO DEV) · CERRADA

**Pedido del dueño:** «vamos a optimizar la app, que sea rápida cuando entra inventario, cada
pestaña/sección». **Método:** primero MEDIR (release, sobre copia de la base real de 1126 productos y
1136 teléfonos), después tocar, y volver a medir con las mismas condiciones.

### Lo que se sentía (mediana de la carrera clic → ver datos)

| Pantalla | Antes | Después |
|---|---|---|
| Entrar a Inventario (Productos) | 400 ms | **~100 ms** |
| Pestaña **Modelos** (la más lenta) | **896 ms** | **~120 ms** |
| Tabla de repuestos compatibles («Repuesto por modelo») | 470 ms | **~110 ms** |
| Pestaña Movimientos | 234 ms | **~30 ms** |
| Volver a una pestaña | 340 ms | **~60 ms** |
| Sugerencias del buscador de modelo | 438 ms | ~200 ms¹ |

¹ ~180 ms son el rebote **a propósito** al escribir (esperar a que el operario termine de tipear): la
consulta en sí bajó de ~230-300 ms a ~10-25 ms.

### Por qué estaba lento
Cada pestaña rehacía cálculos **derivados del catálogo** (dos tablas: `products` + `phones`): parsear el
JSON de compatibilidad de todos los productos (118 ms), recalcular los 1135 teléfonos uno por uno
(~140 ms), los KPIs del inventario (113 ms) y **volver a leer el catálogo entero en cada consulta** del
buscador (240 ms). Y el frontend tiraba trabajo: **toda** consulta —incluida la primera— esperaba 200 ms de
rebote, se tapaba con esqueleto lo que ya estaba en pantalla y el combobox de modelo consultaba el padrón al
montarse aunque nadie hubiera escrito nada.

### Qué se hizo
- **Backend — memoria corta del catálogo** (`src-tauri/src/cache.rs`, NUEVO): índice de repuestos por
  teléfono, filas del padrón (de las que se **derivan** los totales que usa el selector de modelo), KPIs y
  catálogo con la compatibilidad **ya parseada**. Se calcula **a lo sumo una vez por versión de la base** y
  la versión la da SQLite: el par `(SELECT total_changes(), PRAGMA data_version)` — el primero cuenta lo que
  escribió ESTA conexión, el segundo lo que escribió OTRA. **No hay que acordarse de invalidar** en cada
  punto de escritura (un contador a mano se olvida; el de SQLite no).
- **Frontend:** el rebote de 200 ms quedó **sólo para lo que se escribe** (la primera carga y los filtros
  salen en el acto; el cambio de página va en el mismo paso para no consultar dos veces); esqueleto sólo
  cuando no hay nada que mostrar (con «· actualizando…» y `data-refreshing` si ya hay tabla); el combobox
  consulta cuando se lo usa; y **precalentado en tiempo libre** al abrir el módulo (las dos llamadas que
  construyen la memoria del padrón, ni una más: la app tiene una sola conexión).
- **Orden de candados obligatorio: primero `conn`, después `cache`.** Los comandos no manejan la memoria:
  llaman a métodos de `Database`, así el orden vive en un solo lugar.

### Revisión adversarial (2 subagentes) — 2 BLOQUEANTES y varios menores, TODOS arreglados
1. **(BLOQUEANTE backend) La memoria no veía las escrituras de OTRA conexión.** `total_changes()` es por
   conexión: con **dos ventanas de la app abiertas** (no hay guard de instancia única) o con una herramienta
   de `tools/` cargando inventario con la app abierta, habría mostrado números viejos toda la jornada (el
   desplegable «Pantalla a instalar» ofreciendo una pantalla ya instalada). Arreglo: sumar
   `PRAGMA data_version` a la versión. Fijado con `test_catalog_cache_sees_writes_from_another_connection`
   (segunda conexión al mismo archivo) y comprobado EN VIVO con la app abierta: 1136 → (escritura de otro
   proceso) 1137 → (borrado) 1136, la pantalla siempre igual a la base.
2. **(BLOQUEANTE frontend) El buscador de modelo podía quedar en «Buscando…» para siempre** (estado de carga
   trabado si el efecto se abortaba escribiendo y borrando dentro del rebote). Ahora el desplegable se pinta
   según de qué texto son las opciones (`optionsForQuery`) y no hay estado de carga que pueda quedar colgado.
   Menores: precalentado recortado a dos llamadas; escribir en Modelos estando en la página 3 ya no lanza una
   consulta tirada con el texto viejo; los verificadores nuevos esperan **condiciones** (no relojes), abortan
   si falta `REGISTRO_DB` y limpian sus restos en un `finally`; `verify_models_tab.mjs` recarga la SPA al
   empezar (si la app ya estaba en esa pestaña, el clic no la remonta y los KPIs quedaban con los números de
   la corrida anterior: un «KPI viejo» que parecía un bug del producto y era del script).

### Verificación
- `cd src-tauri && cargo test --release --lib` → **132/132** (7 ignorados; 3 tests nuevos de la memoria).
- `tsc -b` 0 · `oxlint` 0 errores · `npm run build` ✓ · `cargo build --release` ✓ · `harness_security` PASS ·
  `harness_truth` PASS.
- **EN VIVO:** `tools/verify_inventario_rapido.mjs` **10/10** (compara la pantalla contra la BASE leída aparte
  con `node:sqlite`: es lo único que distingue «número correcto» de «número viejo que coincide»),
  `tools/verify_models_tab.mjs` **23/23**, `tools/verify_screen_brand_gate.mjs` **23/23** (el gate de marca
  del servicio, lo que más podía romper el catálogo memorizado).
- Todos los `*_test.ts` en verde (pos_cuadre 66/66, receipt 52/52, ficha 66/66, service_guide 35/35,
  reminders 38/38, refund 24/24, payment_math 595/595, queue 61/61, fechas 17/17, method_picker 31/31).

### Herramientas nuevas (quedan en el repo)
- **`tools/bench_inventory_ui.mjs`** — mide EN VIVO, por pestaña y en frío (saliendo del módulo y volviendo),
  los milisegundos desde el clic hasta **ver los datos**, con medianas. Es la medición que le importa al
  dueño, y la que se usó para el antes/después de arriba.
- **`tools/verify_inventario_rapido.mjs`** — verifica que la memoria **no mienta**: escribe una ficha de
  prueba, comprueba que los números se muevan, los compara contra la base leída aparte y borra la ficha.
- **`test_manual_inventory_bench`** (Rust, ignorado) — mide crudo vs memorizado y frío vs caliente sobre
  `REGISTRO_BENCH_DB` (`node tools/snapshot_db.mjs --out backup/perf.db`).

### Fuera de alcance por decisión (anotado, no escondido)
**Dejar las pestañas montadas (keep-alive)** para conservar búsqueda, filtros y página. Con la memoria,
volver a una pestaña cuesta ~60 ms: lo que se pierde es **estado**, no velocidad; y montar varias pestañas a
la vez obliga a reescribir TODOS los verificadores en vivo (cuentan filas de `table tbody` en todo el
documento y pasarían a contar las tablas ocultas). Se evalúa aparte si el local pide conservar los filtros.

### Hallazgo aparte (NO de esta feature)
`delete_product` **no limpia el padrón** (`rebuild_phones` sólo inserta/actualiza por clave): borrar un
producto deja su teléfono en Modelos con 0 repuestos. La verificación de F41 lo compara contra la base
justamente por eso y lo deja anotado en pantalla.

**Spec:** `tools/progress/specs/F41-inventario-rapido.md` · **Detalle para agentes:** `AGENTS.md` §F41.
Sigue todo en **MODO DEV**. Abiertas: **37** (`isBsMethod` por whitelist) y **40** (libro único de
movimientos de caja + auditoría).

---

## 14. F42 — La devolución vuelve POR DONDE ENTRÓ la plata (2026-09-17, MODO DEV) · CERRADA

**Reporte del dueño:** «devolví 2 dólares en Bs, en el Libro al cerrar obviamente se ve reflejado, pero cuando voy a cerrar caja me sale **43 dólares efectivo**. Revisá esa lógica» + «lo que quiero es que en el Libro se vea el monto que devolví, para saber cuánto llevo, datos reales; al igual cuando cierro».

### Qué pasaba (con los datos reales, sobre una copia de `registro.db`)
- **Los $43 estaban BIEN:** son los dos cobros en efectivo dólares del día ($40 + $3). La devolución fue **en bolívares**, así que no toca el cajón de dólares.
- **El defecto:** la orden DEV-0001 ($5, formulario en «Punto de Venta (Bs)») se cobró **$3 en efectivo + Bs. 1.697 por PAGO MÓVIL** (Bs. 1.697 ÷ 848,5458 = exactamente $2). La devolución de esos Bs. 1.697 quedó anotada en el **Punto** porque el diálogo de devolución **proponía el método del FORMULARIO** (`service.payment_method`, que es sólo lo que se esperaba cobrar).
- **Consecuencia en el cierre:** Punto de Venta (Bs) esperado **−Bs. 1.697** (imposible: la máquina no devuelve plata) y, como la fila del Punto sólo se dibuja con esperado **> 0**, **la devolución no aparecía en ninguna parte**; el cajón esperaba 0 por la plata que sí salió.
- **Regla del local (del dueño):** «se devolvió la misma manera que el cliente me pagó».

### Qué se hizo
- **Reglas puras** en `src/lib/refund-math.ts`: `incomeByMethod`, `methodHasIncome`, `isCashMethod`, `refundMethodDefault`, `refundMethodProblem`, `incomeSummary`.
- **Gate en el BACKEND (fail-closed):** un método que **no cobró nada** en esa moneda no puede registrar la devolución; el error dice **por dónde entró**. Los de **cajón** (Efectivo Bs / Divisas) sí pueden pagar del cajón (se avisa, no se bloquea).
- **Diálogo de devolución:** propone método y moneda **de lo que entró**, muestra «Entró por: …», ofrece «Usar «<método real>»» a un toque y bloquea el guardado cuando el método no cobró.
- **Libro Diario y cierre:** `|x| > 0.005` en vez de `x > 0.005` (una devolución puede dejar el método en 0 o negativo: **ya no se esconde** y la celda vuelve a ser clickeable) + campos nuevos `refund_usd`/`refund_bs` mostrados como **chip «Devuelto …»** en la fila del día, **KPI «Devuelto»** y **línea en el diálogo de cierre** («ya está restado del esperado del método por el que salió la plata»).

### Datos de hoy corregidos
Por los comandos de la propia app (no por SQL a mano), con respaldo `backup/registro_pre_fix_devolucion_20260917.db`: se borró el movimiento mal anotado y se reanotó la devolución por **Pago Móvil**. Cierre de hoy: Divisas **$43**, Pago Móvil **0**, Efectivo Bs. **0**, Punto **0**, «Devuelto **Bs. 1.697,00**» visible.

### Verificación
`cargo test --release --lib` **133/133** · `node tools/refund_math_test.ts` **45/45** · **EN VIVO `tools/verify_devolucion_metodo.mjs` 7/7** (pedido de prueba: el backend rechaza el Punto nombrando por dónde entró, el diálogo dice «Entró por: Pago Móvil Bs. 4.243,00», propone ese método y borra sus residuos) · EN VIVO además: el Libro muestra «Devuelto Bs.1.697,00» y el cierre «Devuelto hoy: Bs.1.697,00 — ya está restado…» · `tsc -b` 0.

**Spec:** `tools/progress/specs/F42-devolucion-por-donde-entro.md`. **Pendiente (feature 43 si el local lo pide):** poder **editar el método** de un pago ya anotado (hoy: borrar y reanotar).

---

## 15. 🚀 RELEASE OFICIAL v0.4.0 publicada — con la prueba de que NO toca los datos del local (2026-09-18)

**Pedido del dueño:** «vamos a lanzar la actualización oficial de una vez **siempre y cuando no se dañen
los datos de los usuarios**: cuando se hagan los cambios de sus db se mantenga y sus ventas registradas».

**Lo que se encontró al empezar:** la última release publicada era la **v0.2.5 (24/8)** — todo el trabajo
de septiembre estaba en el repo sin publicar; el instalador local 0.3.0 era anterior a F34–F42; y la base
que el instalador **empaquetaba** era `../registro.db`, la base de TRABAJO del taller (4 órdenes, 6 abonos,
1 cliente, un día abierto y un WAL de 1,3 MB) en un **repo público**.

### 15.1 La condición del dueño, convertida en una prueba que se corre siempre

| Herramienta | Qué hace | Resultado |
|---|---|---|
| `src-tauri/src/db.rs` → `test_manual_migrate_db` (hook ignorado, env `REGISTRO_MIGRATE_DB`) | Corre la **migración REAL** de la app sobre una base dada (`Database::new` → `init()`, el mismo camino del arranque), con `integrity_check`, `foreign_key_check`, el `run_health_check` del updater y un **CENTINELA** que solo se escribe si todo pasó | migración de la base real: **118 ms** |
| `node tools/verify_migracion_datos.mjs --db <base>` | Toma una **COPIA** (VACUUM INTO, la original no se escribe), fotografía la historia, corre la migración y compara **columna por columna** | **50/50** base real · **52/52** base de la era 0.2.5 con ventas y clientes · **68/68** base de julio |
| `node tools/verify_migracion_negativa.mjs` | **Prueba por comportamiento**: inyecta una migración que daña datos a propósito y exige que la verificación FALLE | **5/5 daños detectados** + exit 1 |
| `node tools/verify_release_publicado.mjs` | Verifica lo publicado: release, endpoint del updater, firma, y que la plantilla empaquetada sea la LIMPIA | **21/21** |

**La regla que aplica la prueba** (y que antes no estaba escrita en ningún lado): *no pueden cambiar*
`sales`, `service_payments`, `clients`, `expenses`, `inventory_movements`, `purchase_orders` y
`purchase_order_items` (todas las filas y columnas, **sin filas borradas ni nuevas**), `services` (salvo
`paid_amount`), `products` (stock, precios y datos de cada ficha por id) ni el **arqueo contado
(`actual_*`), la diferencia, las fechas, el estado y las notas** de cada cierre. *Cambian por diseño*, cada
cosa con su propia comprobación: los nombres propios a Title Case (solo si el nuevo es EXACTAMENTE
`titleCase(viejo)`), `paid_amount` (no puede mover el SALDO más de un centavo), la tasa de un cierre
(solo puede LLENARSE si estaba en 0) y las columnas resumen del cierre (no pueden cambiar de signo).

### 15.2 Lo que la revisión adversarial encontró y se arregló (2 BLOQUEANTES, 3 MAYORES, 6 menores)

1. **(B1) La prueba podía dar un falso verde** si el filtro del test no matcheaba (`cargo test` sale 0 con
   «0 filtered out» y la comparación era la copia contra sí misma). Ahora la salida del hook va a un
   archivo, se exige `test result: ok. 1 passed` y el **centinela** de la corrida. *(Al escribir el chequeo
   se coló un falso negativo propio: `«140 filtered out»` contiene `«0 filtered out»` — corregido.)*
2. **(B2) Las filas BORRADAS pasaban como «intactas»** (el bucle recorría solo el «después») y quedaban sin
   comparar `inventory_movements`, compras, y casi todas las columnas de `products`. Ahora se comparan
   conteos, la **unión de ids** (borrada = FAIL, nueva = FAIL) y esas tablas/columnas.
3. **(M1) La plata recalculada no tenía umbral**: `paid_amount` de una orden podía pasar a 999999 y el
   veredicto seguía siendo verde. Ahora se compara el **saldo** (`amount - paid_amount`) con tolerancia de
   un centavo, y un cambio de signo en el total de un cierre cerrado es FAIL.
4. **(M2) El gate de release imprimía PASS sobre consultas que fallaban** (una base sin el esquema de
   precios daba «LISTO»). Ahora todo error de consulta es BLOQUEANTE y se exige el esquema central.
5. **(M3) El gate solo miraba que hubiera PIN**: no podía detectar la regresión que este release arregló
   (el PIN real del dueño viajando en la plantilla). Ahora exige el inicial documentado (`1234`).
6. Menores: la plantilla que se valida es la que `bundle.resources` empaqueta de verdad; el verificador de
   migración avisa si la base es vieja (columnas ausentes) en vez de morir; el deduplicador de
   aprendizajes ya no descarta niveles desconocidos ni borra los backticks del texto; el PIN viejo no se
   imprime en el log del generador; higiene del repo en el gate.

### 15.3 La plantilla que viaja dentro del instalador

- Se regeneró con `node tools/make_release_template.mjs --force` desde la base real: **1087 productos, 950
  con precio, 704 unidades, 0 filas** en transaccionales/clientes, sin día abierto, negativos a 0.
- **`tauri.conf.json` ahora empaqueta `../backup/plantilla_candidata.db`**, no `registro.db` (la base de
  trabajo del taller no se toca ni se publica). Verificado DESPUÉS del build: el `registro.default.db` que
  quedó junto al exe tiene 0 filas de historia y el PIN inicial.
- **Arreglo de seguridad:** el PIN de la plantilla se resetea SIEMPRE a `1234`. Antes solo se creaba si
  faltaba: desde que el PIN se guarda hasheado (B4) la plantilla viajaba con el **PIN real del dueño**
  dentro de un instalador público.
- **Los 123 SKU con stock (333 unidades) sin precio** son una **excepción acotada y auditable**
  (`tools/release_excepciones.json`, con motivo, fecha y TOPES: si empeora, el gate vuelve a bloquear).
  Son modelos más nuevos que la lista del local: un cruce automático les pondría el precio de OTRO modelo.

### 15.4 Lo publicado y cómo se verificó

- **Release:** https://github.com/shaman2527/Service_Tecnico/releases/tag/v0.4.0 — setup firmado (6,39 MB),
  `.sig` y `latest.json`. El endpoint del updater (`releases/latest/download/latest.json`) responde 200 y
  anuncia la 0.4.0 con la MISMA firma del build local (o sea: las PC del local la van a aceptar).
- `cargo test --release --lib` **133/133** (8 ignorados, incluido el hook nuevo) · 10 pruebas puras
  **1006/1006** · `tsc -b` 0 · `oxlint` 0 errores · `npm run build` ✓ · `harness_security` PASS ·
  `harness_truth` PASS · gate de release **0 bloqueantes** sobre la plantilla.
- **Rollback disponible:** el updater respaldo el exe anterior y la base en `updates/` antes de instalar, y
  el chequeo de salud post-actualización revierte si la base, la numeración de órdenes, el libro diario o la
  tasa fallaran.

### 15.5 Hallazgo aparte: `tools/progress/patterns.md` había llegado a 310 MB

El consolidador de aprendizajes del harness **duplicaba el archivo en cada corrida** (crecimiento
exponencial: 20 aprendizajes únicos, uno repetido **524.288 veces = 2^19**, con los backticks de escape
acumulados). El `git add -A` de este release lo metió al historial (blob de 325 MB) → se deduplicó con
`node tools/dedupe_patterns.mjs` (310 MB → **21 KB**, conservando los **26 aprendizajes únicos**, de los
cuales **14 no estaban en la versión de git**), se quitó el blob del commit y se limpió el objeto
(`.git`: 14,5 MB → **1,5 MB**). El gate ahora **bloquea** un archivo de más de 100 MB (GitHub rechaza ese
push). *Pendiente real: la causa raíz está en `tools/governance/learning-injector.ts` (envuelve la
evidencia otra vez en cada corrida: `- \`X\`` → `  - \`- \`X\``); no se pudo reproducir la duplicación
2^19 desde ese código, así que queda anotado y con red de seguridad.*

### 15.6 Qué queda pendiente

- Cargar el precio de los 123 SKU (Inventario → Precios y datos) y después borrar la excepción del gate.
- **Instalar la 0.4.1 en la PC del local** (la 0.4.0 quedó superada por la 0.4.1) y confirmar en el mostrador:
  PIN, abrir el día, una venta, un servicio con entrega, un cierre y un ticket. (La actualización se ofrece
  sola al arrancar.) **Antes: copiar `registro.db` a un pendrive** (ver §15.7).
- Features 37 (`isBsMethod` por whitelist) y 40 (libro único de movimientos de caja + auditoría).
- Cerrar la causa raíz del desborde de `patterns.md`.

---

## 15.7 🔒 v0.4.1 — el respaldo previo ya no puede fallar en silencio + PRUEBA DE INSTALACIÓN REAL (2026-09-18)

**Origen:** el dueño preguntó, antes de actualizar la PC del local (que está en la **0.2.5**): «¿si cargo la
nueva actualización del cliente se me puede dañar la app?». Auditando el camino de actualización apareció
un agujero real —y de la peor clase: silencioso—.

### El bug (desde F8, presente en TODAS las versiones publicadas, incluida la 0.2.5)

`api.backupBeforeUpdate` (`src/db.ts`) terminaba en `.catch(() => mock(undefined))`. Si el respaldo previo
fallaba (permisos, antivirus, disco lleno, PowerShell bloqueado por política), la actualización **seguía
igual y sin avisar**: sin copia de la base, sin el exe anterior y sin el vigilante → **sin red de seguridad
y sin que nadie se enterara**. Además `spawn_watchdog` hacía `let _ = spawn()`, que tapaba el mismo tipo de
fallo.

### El arreglo (v0.4.1, publicada)

| Qué | Antes | Ahora |
|---|---|---|
| Respaldo previo | error tragado → instalaba igual | **fail-closed**: si no se puede respaldar, `UpdateDialog` corta y dice «no se instaló nada; tu app y tus datos quedan igual» |
| Detalle del respaldo | no se devolvía nada | el comando devuelve `UpdateBackup { db_backup, prev_exe, watchdog }` (rutas de la copia + si el vigilante arrancó) |
| Vigilante | `let _ = spawn()` | `spawn_watchdog -> bool` y la UI **avisa** cuando no se pudo lanzar |
| Mensaje de error | genérico | distingue la etapa con una variable LOCAL (el estado de React no cambia dentro del mismo closure: usarlo daba el mensaje equivocado) |

Red anti-regresión: **`node tools/update_backup_test.ts` 17/17** (lee los archivos reales y falla si vuelve
el `.catch` o se pierde el aviso del vigilante — mismo patrón que el test del gate de rol).

### Prueba de INSTALACIÓN REAL en esta PC (la que el plan de release pedía)

Sobre una instalación vieja de verdad (`%LOCALAPPDATA%\Registro Servicio Tecnico`, exe 0.1.2, esquema
anterior a todo: sin `search_text`, sin `phones`, sin las columnas de política) se sembró **historia
representativa** (2 órdenes, 2 abonos de $20 + Bs. 11.250, 1 venta, 2 clientes en minúscula, 1 cierre con
arqueo) y se instaló la **0.4.1 encima**:

| Qué se midió | Resultado |
|---|---|
| `registro.db` después de instalar (antes de abrir la app) | **sha256 IDÉNTICO** (95F9C1D5FFDEE142E64BD7F6…) → el instalador **no toca la base del usuario** |
| exe / plantilla | exe pasó a **0.4.1**; `registro.default.db` 282.624 → **856.064 bytes** (la plantilla nueva y limpia) |
| La app abre sobre esa base vieja | **sí** (proceso vivo, ventana «Registro - Servicio Técnico») y migra: agrega las 7 columnas nuevas de `services`, `search_text`/`price_usd`/`supplier` en `products` y arma el padrón (**999 teléfonos**) |
| Historia (comparación columna por columna) | **ninguna fila perdida ni inventada**: ventas, abonos, clientes, cierres y las 980 fichas con su stock/precio intactos; el **arqueo contado** (`actual_cash_usd` 50, `actual_pago_movil` 11.250, `difference` 0) **sin tocar**; los únicos cambios: nombres a Title Case y columnas *resumen* recalculadas |
| El único «FAIL» de la comparación | **era mi dato de prueba**: sembré `paid_amount = 0` con $35 en abonos. La app lo recalculó **exacto** (20 + 11.250/748,79 = **35,0242**) — verificado con la cuenta. Premisa anotada en `verify_migracion_datos.mjs`: el chequeo del saldo vale para una base REAL, donde `paid_amount` ya salió de la regla vigente (init() corre en cada arranque) |

**Lecciones de la prueba (anotadas):** (1) el instalador NSIS **reutiliza la carpeta registrada** de una
instalación previa: la primera corrida se instaló en `…\Temp\prueba_update` y la base «intacta» era una
conclusión **vacía** — hay que forzar la carpeta con `/D=` y verificar *dónde* se instaló, no solo que algo
se instaló; (2) después de la prueba, la instalación quedó con la base original restaurada (sin datos
sembrados) y la app 0.4.1 funcionando.

### Lo que el dueño tiene que hacer en el local

1. **Cerrar la app** y copiar `registro.db` (y `registro.db-wal` si está) de
   `%LOCALAPPDATA%\Registro Servicio Tecnico\` a un pendrive. Esa copia es la garantía total.
2. Actualizar (desde la app, o corriendo el setup 0.4.1).
3. Al abrir: PIN, Libro Diario (día y tasa), Servicios (órdenes y montos), Clientes, una venta de prueba.
   Y revisar que existan `updates\registro.backup_pre_0.4.1.db` y `updates\prev\registro.exe` (red armada).
4. Si algo fallara: reponer la copia del paso 1, o `updates\prev\registro.exe`, o Ayuda → «Restaurar
   versión anterior».
