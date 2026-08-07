# History — Session 2026-07-30

## Resumen
Integración de Harness Engineering tools/ al proyecto. Corrección de CSS y componentes UI.

## Build Status
- ✅ Build: PASS (52.6s)
- TypeScript: PASS
- CSS: 44.5KB con todas las utility classes

## Logro: CSS Dev Mode fixed
- **Problema:** `npm run dev` no generaba utility classes. Solo CSS variables.
- **Causa raíz:** `@plugin "tailwindcss-animate"` en index.css rompía la generación de utility classes en dev mode (es plugin v3 incompatible con v4).
- **Fix:** Remover `@plugin "tailwindcss-animate"` y reemplazar con `@utility` directives nativas v4.
- **Note:** También se eliminó `tailwindcss-animate` de package.json y se removió como dependencia.

## Logro: CSS Production fixed
- **Problema:** `@theme inline` no generaba CSS variables `--color-*` en producción.
- **Causa raíz:** `@theme inline` hardcodea valores, no genera variables.
- **Fix:** Cambiar a `@theme` + `:root {}` con variables cortas.

## Logro: shadcn conventions
- **Problema:** Uso de `space-y-*` en lugar de `flex flex-col gap-*`.
- **Fix:** Reemplazado en todos los componentes (Dashboard, Inventory, Sales, Services, Clients).
- **Problema:** `mr-2` en iconos dentro de botones.
- **Fix:** Removido `mr-2` — Button ya tiene `gap-2` en su cva definition.

## Logro: DB Bridge
- **Problema:** `Cannot read properties of undefined (reading 'invoke')` en browser mode.
- **Fix:** db.ts detecta `window.__TAURI__` y retorna mocks.
- **Añadido:** `vite-env.d.ts` con tipo `window.__TAURI__`.

## Known Issues
1. `@tailwindcss/vite` v4.3.3 dev mode: utility classes no se generan en dev. Probable bug del plugin.
   - Workaround: usar Tauri dev (`.\run.ps1 -Dev`) o build production.
2. shadcn base components (card.tsx:26, dialog.tsx:62, alert-dialog.tsx:54) usan `space-y-*` internamente.
   - Son patrones estándar de shadcn. No editar los archivos ui/.

---

# History — Session 2026-08-01 (fixes producción + verificación en vivo)

## Resumen
Se corrigieron las DOS causas raíz que impedían la app de producción funcionar con datos reales:
1. Frontend nunca embebido (falta feature `custom-protocol`)
2. DB nunca conectada (detección Tauri con `window.__TAURI__`, que no existe en Tauri 2)

Y se verificó TODO en vivo vía CDP (remote-debugging) en la app desplegada real.

## Logro: Frontend embebido en release (custom-protocol)
- **Problema:** Ventana en blanco en producción sin dev server corriendo.
- **Causa raíz:** `tauri = { version = "2", features = [] }` SIN `custom-protocol` → `generate_context!` (tauri-macros 2.6.3, context.rs:155) corre en modo dev (`cfg!(not(feature = "custom-protocol"))`) → tauri-codegen genera assets VACÍOS → la app release intentaba cargar devUrl localhost:5173.
- **Evidencia:** el exe nunca creció al cambiar frontend; el caché WebView2 tenía módulos de /node_modules/.vite/deps/; `tauri-codegen-assets/` vacío en OUT_DIR.
- **Fix:** `tauri = { version = "2", features = ["custom-protocol"] }` en Cargo.toml. Rebuild recompila tauri+macros.
- **Verificación:** assets en `target/release/build/registro-0acacd563edc35de/out/tauri-codegen-assets/` (JS 105616 B brotli q9, CSS, HTML, SVGs) — todos encontrados byte-a-byte dentro del exe; exe creció +114 KB (12817408 → 12931584).

## Logro: ProductForm compartido + UI de edición
- **Nuevo:** `src/components/ProductForm.tsx` — form compartido de producto con compatibilidad (modelos separados por `/`), usado por Inventario (crear/editar) y Pantallas (editar compatibilidad).
- **Inventory.tsx:** ahora muestra TODAS las categorías (catFilter default `''`, antes solo cat 1 Pantalla) → "registra la base de datos completa en inventario".
- **Catalog.tsx (Pantallas):** botón "Editar" (icono Pencil) por fila → abre ProductForm para editar compatibilidad.
- **Harness checks:** npm build ✅ (43.26s), cargo test ✅ 1/1, governance ✅ 55.7s.

## Logro: DB real conectada (detección Tauri 2)
- **Problema:** El usuario reportó "no está guardando, no muestra los modelos ni las pantallas".
- **Causa raíz:** db.ts:7 `isTauri = window.__TAURI__ !== undefined` — en Tauri 2 `window.__TAURI__` NO existe (solo `__TAURI_INTERNALS__`, con solo `plugins` enumerable; el invoke real está en `__TAURI_INTERNALS__.invoke` no enumerable). isTauri=false → getProducts rechazaba → "Sin productos registrados"; getServiceDashboard caía al mock (0 equipos).
- **Evidencia:** vía CDP `window.__TAURI_INTERNALS__.invoke('get_products', {search:'', categoryId:null})` → count=970 (el backend SIEMPRE respondió bien).
- **Fix:** `window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined` (fallback Tauri 1).
- **Verificación en vivo (app desplegada, CDP):** Inventario 970 filas reales en tbody; Pantallas 921 filas + 921 botones Editar + columna Modelos Compatibles; Dashboard 30 equipos reales (antes mocks); prueba de guardado end-to-end: editar compatibilidad del producto id=62 por UI → persistió en registro.db real en disco (dato revertido después); deploy verificado: Registro.exe == target/release/registro.exe (hash BA2ECAFE...).

## Hallazgo: dos DBs distintas (target/release vs raíz) — RESUELTO
- `registro.db` (raíz): 970 productos, 970 con compatibility, 8 categorías — la buena.
- `src-tauri/target/release/registro.db`: 973 productos, SOLO 202 con compatibility, 9 categorías (fecha 30/7) — vieja; el Copy-Item del deploy previo no se aplicó.
- `get_db_path()` prioriza la DB junto al exe → correr target\release\registro.exe usa la DB vieja. El acceso directo del Desktop apunta a Registro.exe de la raíz (DB buena).
- **Fix aplicado:** se copió registro.db (buena) sobre target/release/registro.db → ambas ahora 970/970.
- **Lesson:** verificar LastWriteTime y conteos de filas tras cada deploy; el Copy-Item puede fallar silenciosamente.

## Build Status final
- Build: ✅ PASS (51.2s frontend / 2m40s release), 0 errores, 0 warnings
- cargo test: ✅ 1/1; governance: ✅ PASS
- App desplegada corriendo con datos reales (970 productos, 921 pantallas)

## 2026-08-04 - Puesta en marcha + impresora + instalador NSIS (F1-F8)
- F1-F3: backup + limpieza total (982 productos conservados, 0 movimientos) + PIN 1234 verificado via CDP.
- F4: PRAGMA synchronous=FULL + test_durability_pragmas (robustez ante apagon).
- F5: LTO thin + strip + codegen-units=1 -> Registro.exe 13.1MB.
- F6: Impresora termica por COM (printer.rs ESC/POS CP850, list_com_ports, print_receipt, settings persistidas, PrintReceiptDialog + PrinterSettingsDialog, botones Impresora/Factura). 3 tests. Verificado en vivo (sin hardware: list_com_ports=[], error amigable COM9).
- F7: tauri.conf.json -> targets nsis + resources ../registro.db + webviewInstallMode embedBootstrapper. Setup 4.7MB (Registro Servicio Tecnico_0.1.0_x64-setup.exe). Instalado silenciosamente: DB limpia junto al exe, gate PIN, 982 productos, uninstall limpio.
- FIX gate PIN fail-open: el primer invoke en frio fallaba -> db.ts resolvia false (owner sin PIN). Ahora retry 3x400ms + rechaza (fail-closed). Verificado: arranque en frio del instalado muestra gate.
- FIX next_order_num tabla vacia: MAX(NULL) con .optional() no capturaba (InvalidColumnType). COALESCE(...,0) + test_next_order_num_empty_table. 20/20 tests.
- Governance: PASS (13.4s). AGENTS.md actualizado (64 comandos, secciones impresora/instalador/PIN, Entropy Registry +3).

## 2026-08-04 - QA E2E conversiones (sandbox aislado) + PRD + README
- Sandbox: copia de Registro.exe + registro.db limpia en temp (DB path: junto al exe). CDP + invokes reales.
- Escenario tasa BCV 748.79: venta USD 25 (Divisas) + venta Bs 7.487,90 (Pago Movil, 10x748.79) + servicio 50 con abonos 20 USD y 22.463,70 Bs (=30).
- Resultados: paid_amount=50.00 exacto (20+22463.70/748.79), grand_usd=45, grand_bs=29.951,60, grand_total=85.00 (=45+29951.60/748.79), cierre diferencia 0.00, apertura 50 aparte, active_day null.
- UI verificada: Libro Diario (Bs.29.951,60 / .00 / aprox .00), Ventas (2 filas con moneda correcta), Cierres (+.00 Cerrado). pm_detail con REF-PM-1/2 y fuentes Venta/Abono DEV-0001.
- Checks: cargo test 20/20, npm run build OK (CSS vars OK), governance PASS (16.1s).
- Docs: PRD.md nuevo (reglas R-1..R-17, mermaid flows, modelo de datos, QA, puesta en marcha), README.md actualizado (funcionalidades, flujos, estructura 64 comandos, impresora, PIN, instalador).

## 2026-08-04 - F8 Sistema de actualizaciones con rollback + instaladores
- Plugin oficial updater+process, firma (registro.key en ~/.tauri, pubkey en config, createUpdaterArtifacts).
- updates.rs: backup_before_update (exe prev + DB checkpoint + estado pending + watchdog), run_health_check (DB/ordenes/dia/totales + BCV warning), rollback, estado roundtrip. 5 tests (suite 25/25).
- UI: UpdateDialog (notas+progreso+Recordar despues localStorage), check arranque 5s silencioso, botones Ayuda (Revisar/Restaurar), version dinamica getVersion.
- tools/release.ps1: bump version + build firmado + latest.json + gh release.
- Icono nuevo: smartphone blanco sobre degradado azul->violeta (PIL, 32/128/256/ico).
- E2E feliz (servidor local 8901, build prueba): dialog->kit->descarga->instalacion NSIS->relanzamiento auto->PIN->health check->ok+aviso, DB intacta 282624.
- E2E roto: exe basura 39 bytes -> watchdog (con Try-Launch) restaura 16,448,000 bytes y relanza. Lesson: Start-Process de exe roto mataba al watchdog (fix try/catch).
- Lesson: el relanzamiento post-instalacion lo hace el instalador NSIS (no el JS relaunch); watchdog solo lanza si nadie lo hizo.
- Regresion final: BCV vivo 752.0943, venta Bs 7520.943 -> grand_total 35 exacto, cierre diff 0, health ok:true issues[].
- Reviewer 0 hallazgos, lint sin nuevos warnings, governance PASS.
- Carpeta instaladores/ (setup 5.69MB + INSTALACION.md) lista para pendrive. Pendiente en tienda: gh auth login para publicar releases.

## 2026-08-04 - Documentacion de estado (ESTADO.md)
- Creado ESTADO.md: resumen de todo lo completado (base, puesta en marcha, updater F8), QA verificado, y pendientes P1/P2/P3 (gh auth login invalido, publicar release v0.1.1, guardar llave privada, instalar en tienda, probar impresora fisica, verificar icono, cambiar PIN, confirmar internet tienda).
- README.md enlazado a ESTADO.md.

## 2026-08-05 - P3: stats por tecnico + catalogo sin duplicados + hallazgo GitHub
- get_technician_stats (TechnicianStat: total/activos/entregados/ingresos; LEFT JOIN technicians, fila 'Sin asignar', snapshot al borrar). Card 'Servicios por Técnico' en Dashboard. initialsOf movido a lib/utils.ts (fuente unica). Test test_technician_stats. Suite 26/26.
- Verificado en vivo (CDP): Aldri 1 entregado , William 1 en taller, UI con circulos A/W. Datos de prueba limpiados.
- Catalogo: 2 grupos duplicados (Infinix HOT 30i/60) eliminados (982->980, 0 duplicados) en DB proyecto + instalada; setup e instalador regenerados.
- Hallazgo: github.com y api.github.com NO responden desde esta PC (timeout TLS; bcv.org.ve si). gh auth login imposible por ahora -> release v0.1.1 pendiente hasta red que alcance GitHub (hotspot celular). Documentado en ESTADO.md P1-1/P1-2.

## 2026-08-05 - Hardening updater v0.1.2: DB nunca se sobreescribe + fallback de endpoints
- **Hallazgo CRITICO (verificado en vivo):** el instalador NSIS PISABA la DB del usuario. tauri-bundler template usa `File /a "/oname=registro.db"` (SetOverwrite on default; installer.nsi:655). Reinstalar el setup 0.1.2 sobre una instalación con datos QA -> hash de registro.db cambió y servicios=0. El claim previo de AGENTS ("solo escribe si no existe") era FALSO; el flujo del updater (corre el mismo setup) habría borrado todo el histórico de la tienda.
- **Fix:** la DB ya no viaja como recurso `registro.db` sino como plantilla **`registro.default.db`** (`bundle.resources: {"../registro.db": "registro.default.db"}`). El seed ocurre en `get_db_path()` (lib.rs, caso 1b + caso 3 APPDATA): copia la plantilla SOLO si `registro.db` no existe (primer arranque). Verificado: reinstalación sobre datos -> hash idéntico; DB borrada -> recreada desde plantilla (980 productos).
- **Multi-endpoint verificado:** `plugins.updater.endpoints` es un ARRAY; el plugin (tauri-plugin-updater core.rs ~L483) prueba en orden y solo rompe el loop con 2XX + JSON válido (error/timeout/status no-2XX -> siguiente). E2E en vivo: endpoint 1 roto (connection refused) -> endpoint 2 local (http.server 8901) -> dialog "0.1.3" -> kit -> instalación -> relanzamiento -> health check ok -> estado ok. **DB con datos QA intacta** (1 servicio + 1 cliente + 1 día + 980 productos).
- **release.ps1:** soporte opcional Google Drive (`-DriveLatestId/-DriveSetupId` + `tools/drive_ids.json` -> `latest_drive.json` con `https://drive.usercontent.google.com/download?id=<SETUP_ID>&export=download`; regla: sobrescribir el mismo archivo en cada release para que los IDs sean estables).
- **Build FINAL 0.1.2 firmado** (setup 5.975.222 B + .sig): endpoints revertidos a GitHub único (sin localhost ni dangerousInsecureTransportProtocol). Instalado sobre la instalación QA: hash DB idéntico, 980 productos, DEV-TEST-UPD visible, día abierto 748.79. Datos QA limpiados después (0 services/clients/días).
- Artefactos: `instaladores\Registro Servicio Tecnico_0.1.2_x64-setup.exe` + `latest.json` (URL GitHub `releases/download/v0.1.2/` + firma real) + `Registro.exe` raíz + `registro.db` -> target/release.
- Observed (menor): el useEffect de App.tsx que corre `mark_update_ok` tras el PIN no siempre completaba el flujo en el primer intento (quedó pending; marqué ok manualmente via CDP). Inofensivo: el siguiente arranque repite health check y marca ok; watchdog expira a los 90s.
- GitHub volvió a responder (200/404 <0.5s, intermitente) -> ESTADO.md P1-1 actualizado; release v0.1.2 sigue pendiente de `gh auth login` (token 401). Drive NO configurado (usuario no proporcionó IDs) -> P1-5 como paso manual documentado.
- Checks: cargo test 26/26 (2x), npm run build OK, Entropy Registry +2 filas (NSIS overwrite, GitHub intermitente), feature_list #22, ESTADO.md QA actualizado.

## 2026-08-06 - UI fix: cards de servicios + dialog de abono descuadrados
- **Card de servicio:** la fila inferior `flex justify-between` aplastaba los badges de trabajos (6 botones de acción shrink-0 ≈370px en cards de ~540px) -> los trabajos quedaban uno encima del otro y los botones desbordaban. Fix: badges en fila propia full-width (`flex-wrap` + `whitespace-nowrap`) y botones al pie (`flex flex-wrap gap-1.5 border-t pt-3`) — nunca se salen.
- **PaymentDialog:** `sm:max-w-sm` (384px) desbordaba: footer de 3 botones (~370px) fuera del contenedor, tabla de pagos apretada, sin max-h (footer fuera de pantalla en ventanas bajas). Fix: `sm:max-w-md` + patrón Libro Diario (`max-h-[88vh] flex flex-col overflow-hidden`, header/footer `shrink-0`, cuerpo `min-h-0 flex-1 overflow-y-auto`, tabla `overflow-x-auto`, footer `flex-wrap`).
- **Pills "Trabajos / Fallas"** del form: `whitespace-nowrap` (antes "Software / Formateo" se partía en 2 líneas, alturas disparejas).
- Verificación: npm build OK (25s), cargo test 26/26, harness loop GOAL MET (31.8s, 0 errores), release rebuilt (Compiling registro, 7m21s), Registro.exe == target/release (hash 73E98914...), app relanzada con el fix.

## 2026-08-06 - Modal de historial de cliente moderno + ServiceForm con footer fijo
- **Clients.tsx modal modernizado** (skill shadcn + patrones del harness): header con chip de avatar (User en rounded-lg bg-primary/10) + Badges de cédula (FileText), teléfono (Phone) y última actividad (CalendarDays); KPIs compactos con icono en chip de color (patrón Libro Diario): Total Gastado (Wallet/emerald), Servicios (Wrench/primary), Compras (ShoppingCart/amber), **Por cobrar** (CircleDollarSign/danger, calculado de clientServices); tablas de servicios (9 col) y compras envueltas en `rounded-md border overflow-x-auto` (nada fuera de rango); headers de sección con chip + contador Badge; badge "Por cobrar $X" al lado del título de Servicios; empty state con icono en border dashed; ServiceDetail reescrito con composición completa Card (CardHeader/CardTitle/CardContent) en vez de divs planos; badges de estado con color (Entregado verde / Por entregar ámbar / Cancelado-Devuelto rojo).
- **ServiceForm**: patrón de dialog del Libro Diario — `max-h-[88vh] flex flex-col overflow-hidden`, DialogHeader `shrink-0 pr-6`, banners de garantía `shrink-0`, cuerpo `min-h-0 flex-1 overflow-y-auto pr-1`, DialogFooter `shrink-0 border-t pt-3` → Cancelar/Guardar SIEMPRE visibles (antes se escrollaban fuera = "fuera de rango").
- **Cards de servicios**: botones de acción con `flex-1` (Entregar/Pago/Factura/Editar) → distribución uniforme al hacer wrap, nada desalineado.
- Verificación: npm build OK, harness loop GOAL MET (33.7s, 0 errores), release rebuilt (6m15s) + Registro.exe == target/release (hash A07E480B...) + app relanzada (PID 11004).

## 2026-08-06 - Pedidos: revisión completa + hardening funcional (E2E verificado)
- **Revisión de todo el flujo** (backend db.rs + commands.rs + frontend Pedidos.tsx): schema purchase_orders/items correcto (order_date default), add/get/get_items/mark_received/delete/reorder_suggestions cableados, types alineados.
- **E2E en sandbox (CDP, app real de producción):** open_day → get_reorder_suggestions (8 productos, incluye stock negativo -1) → add_purchase_order (2 items, 5 unidades, $9) → get_purchase_orders (Pendiente) → get_items (2) → mark_received (**stock 0→3, delta exacto**) → doble receive = error correcto "Este pedido ya fue recibido." → estado Recibido → delete (desaparece). **TODO FUNCIONAL**.
- **Hardening UI (Pedidos.tsx):** "Recibido" con **AlertDialog de confirmación** (conteo de artículos/unidades, evita sumar stock por click accidental); receive/remove/openDetail con try/catch + **banner de error** en la página (antes errores silenciosos); dialog Nuevo Pedido con **banner de día cerrado** (ácaro: `require_open_day` solo fallaba al guardar sin avisar) + Guardar deshabilitado; dialogs Nuevo/Detalle con patrón del Libro Diario (footer siempre visible); recibir desde el detalle refresca items/estado en vivo.
- Verificación: npm build OK, harness loop GOAL MET (36.5s, 0 errores), release rebuilt (8m50s) + Registro.exe actualizado + app relanzada (PID 12240). Sandbox E2E eliminado.

## 2026-08-07 - v0.1.4: "Ver más tarde" descarga en segundo plano + aviso al reiniciar (E2E verificado)
- **Feature:** botón "Ver más tarde" (antes "Recordar después") en UpdateDialog → `update.download()` en segundo plano con progreso, guarda `localStorage('update_downloaded_v')` y cierra sin instalar. Al reiniciar, el check de arranque muestra el dialog de nuevo con banner verde "Ya descargaste esta actualización — está lista para instalar". Dismiss forever eliminado (`clearDownloaded` al instalar OK). App.tsx ya no consulta `dismissedVersion`.
- **Decisión de repo:** el usuario pidió GitHub privado pero GitHub NO sirve assets de releases privadas sin auth (el updater no lleva token) → repo principal sigue PUBLICO; se creó y borró `Service_Tecnico-Releases` (descartado). Endpoint del updater en `releases/latest/download/latest.json` del repo principal; fallback documentado: Google Drive (multi-endpoint).
- **E2E en vivo (endpoint local + build debug):** app 0.1.4 con endpoint local → detecta "0.1.5" (setup 0.1.4 firmado renombrado) → dialog "Ver más tarde" → click → descarga en 6s → `update_downloaded_v=0.1.5` → dialog cerrado sin instalar → reiniciar → dialog visible + nota "ya descargaste esta actualización". Kit de rescate (backup + prev + watchdog) generado. Instalación NSIS en %LOCALAPPDATA% (destino por defecto — flujo completo ya verificado contra GitHub real en la iteración 0.1.3).
- Verificación: npm build OK, cargo 26/26, harness loop GOAL MET (65.7s, 0 errores), release v0.1.4 publicada en GitHub (URL normalizada con puntos), endpoint 200 + bytes idénticos (hash 472207E4...), commit fee012c pusheado.
