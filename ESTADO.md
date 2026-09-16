# 📋 Registro — Estado del Proyecto (2026-09-15)

> Documento vivo de **todo lo que se ha hecho** y **lo que falta**.
> Complementa a [PRD.md](PRD.md) (qué es el producto), [README.md](README.md) (cómo usarlo)
> y [AGENTS.md](AGENTS.md) (harness + registro de problemas).
>
> ⚠️ **MODO DEV (instrucción del usuario, 2026-09-15):** mientras se termina el módulo de
> inventario **no se publica release ni se hace push a producción**; la limpieza de datos se
> corre sobre copias (`backup/*.db`) o sobre la base de dev (`REGISTRO_DB=dev_registro.db`).

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

Baseline de la auditoría (para comparar cuando se aplique en la tienda): 1126 productos,
29 marcas literales (14 fuera del mapa), 222 modelos con varios teléfonos, 896 nombres no
canónicos, 38 grupos duplicados, 702 unidades, 1126 sin precio (antes de F3).

---

## 1. Resumen

Aplicación desktop **offline-first** (Tauri 2 + React 19 + SQLite) para servicio técnico de
celulares: inventario, ventas, órdenes de reparación, abonos, libro diario con tasa BCV,
impresora térmica y **actualizaciones automáticas con rollback**.

- **Versión en código:** 0.2.5 · **Última release publicada:** v0.2.5 (2026-08-24) — *las mejoras del inventario del 2026-09-15 están SOLO en el repo (modo dev), sin publicar*
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
