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
