# 📋 Registro — Estado del Proyecto (2026-08-04)

> Documento vivo de **todo lo que se ha hecho** y **lo que falta**.
> Complementa a [PRD.md](PRD.md) (qué es el producto), [README.md](README.md) (cómo usarlo)
> y [AGENTS.md](AGENTS.md) (harness + registro de problemas).

---

## 1. Resumen

Aplicación desktop **offline-first** (Tauri 2 + React 19 + SQLite) para servicio técnico de
celulares: inventario, ventas, órdenes de reparación, abonos, libro diario con tasa BCV,
impresora térmica y **actualizaciones automáticas con rollback**.

- **Versión actual:** 0.1.1 (con sistema de actualizaciones incluido)
- **Últimos commits:** `637514c` (puesta en marcha) → `275937e` (F8 updater) — en `main`, pusheado
- **Repo:** https://github.com/shaman2527/Service_Tecnico

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
| Suite Rust `cargo test` | **25/25** (5 nuevos de updates) |
| `npm run build` + CSS vars | ✅ PASS |
| Governance harness (`--build-only` / `--security`) | ✅ PASS |
| Reviewer bus | **0 hallazgos** (9 categorías) |
| Lint | solo warnings preexistentes (tools/, exhaustive-deps viejos) |
| E2E conversiones (sandbox, tasa 748.79) | venta $25 + Bs 7.487,90 + abonos $20/Bs 22.463,70 → `grand_total $85` exacto, cierre diff 0 |
| E2E actualización feliz (servidor local) | dialog → kit de rescate → descarga → instalación → relanzamiento → health check → **ok** + aviso; DB intacta |
| E2E update roto (exe basura 39 bytes) | watchdog **restauró** exe 16.448.000 bytes y relanzó la app |
| BCV en vivo (build final) | **752.09 Bs/USD** (scrape real bcv.org.ve) |
| Venta diaria (build final) | venta Bs 7.520,943 → `grand_total 35` exacto, cierre diferencia 0 |
| Gate PIN arranque en frío (instalado) | pide PIN antes de abrir ✅ |
| Instalador /S + desinstalación | DB limpia instalada, 982 productos, uninstall limpio ✅ |

---

## 3. ⏳ Lo que falta (pendientes)

### P1 — Urgentes (antes de dejar la app en la tienda)

| # | Pendiente | Por qué | Cómo resolverlo |
|---|---|---|---|
| 1 | **`gh auth login` en esta PC** | El token de GitHub está **inválido** (HTTP 401) → no se pueden publicar releases → el updater no tiene de dónde bajar. | En la PC de desarrollo: `gh auth login` (elige HTTPS + login con navegador). Una sola vez. |
| 2 | **Publicar la release v0.1.1** | Sin release en GitHub, el endpoint `latest.json` da 404 (la app lo maneja silencioso, pero no llegan updates). | `.\tools\release.ps1 -Version 0.1.1 -Notes "Primera versión con actualizaciones automáticas"` (tras el paso 1). |
| 3 | **Guardar copia de la llave privada** | `C:\Users\ROBER\.tauri\registro.key` — **si se pierde, no se pueden publicar más actualizaciones** (los instaladores ya distribuidos quedarían huérfanos). | Copiarla a un USB/carpeta segura. NO subirla a GitHub ni a la nube pública. |
| 4 | **Instalar v0.1.1 manualmente en la PC de la tienda** | Es la primera versión con updater: se instala una sola vez a mano (pendrive). De ahí en adelante todo automático. | Copiar `instaladores\` al pendrive → ejecutar el setup → seguir `INSTALACION.md` (cambiar PIN 1234, abrir día, impresora). |

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
| 9 | Dashboard: estadísticas por técnico (fase 2 documentada) | Ya existe la marca de técnico en cada orden |
| 10 | Duplicados del catálogo (Pantalla vs Táctil del mismo modelo) | Verificado con GROUP BY; hay que decidir cuál conservar |
| 11 | Sincronización multiusuario en la nube | Fuera de alcance v1: el respaldo es copiar `registro.db` |
| 12 | Notificación de actualización tipo toast de Windows | Hoy es aviso in-app (suficiente); se puede añadir `tauri-plugin-notification` |
| 13 | Prueba de actualización real contra GitHub | Solo posible tras P1-1 y P1-2 (se haría con una release de prueba v0.1.2) |

---

## 4. Flujos operativos

### Publicar una versión nueva (cuando haya cambios)
```powershell
gh auth login                                     # una sola vez (P1-1)
.\tools\release.ps1 -Version 0.1.2 -Notes "Qué cambió"
# → tests, bump versión, build firmado, latest.json, release en GitHub
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
