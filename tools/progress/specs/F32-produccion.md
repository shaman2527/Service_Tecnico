# F32 — Puesta en producción: plantilla de la base, gate de release y bloqueantes

- **Origen:** pedido del usuario (2026-09-16): *«si no tenemos nada pendiente usemos los agent que tenemos,
  empecemos un test de validación que todo funcione, inventario, servicio, pantallas… para lanzarnos a
  producción si todo está bien»*.
- **Estado:** 🔴 **NO LISTO para producción**. La validación (4 verificadores en paralelo + pruebas en vivo)
  encontró bloqueantes reales. Este documento es el **plan de release** y el registro de lo ya resuelto.

## 1. Qué se validó y cómo (evidencia)

| Frente | Herramienta | Resultado |
|---|---|---|
| Backend Rust | `cargo test` (lib + bin) | **111 passed · 0 failed · 5 ignored** |
| Integridad de datos | `PRAGMA integrity_check` / `foreign_key_check` en 3 bases | ok · **0 huérfanos** |
| Migraciones | lectura de `init()` (db.rs) | **idempotentes** (15 `CREATE TABLE IF NOT EXISTS`, ~30 `ALTER` tras sonda de columna) |
| Recepción (wizard) | `tools/verify_wizard_metodos.mjs` | **18/18** |
| Métodos de pago en los cobros | `tools/verify_metodos_en_cobros.mjs` | **13/13** (sin escribir nada) |
| Cola de entregas (F4) | `tools/verify_cola_entregas.mjs` | **11/11** (+ consistencia UI↔backend) |
| Cierre de servicio E2E | `tools/verify_servicio_cierre.mjs` | **16/17** → el fallo era una regex vieja del script (corregida); pantalla exacta stock 8→7, movimiento «Servicio Entregado», motivo obligatorio |
| Carga de inventario real | `tools/verify_inventory_load_real.mjs` | **12/12** (261 líneas / 713 u.; salir sin aplicar no toca stock) |
| Smoke integral de módulos | `tools/verify_smoke_integral.mjs` | 8 módulos abren, KPIs, chips, sugerencias, carrito, historial, pestañas |
| **Venta de punta a punta** | prueba manual por CDP | producto con stock+precio → **venta $25 registrada**, **stock 1→0**, **movimiento «Venta #1»** con referencia |
| Producto publicado v0.2.5 | extracción del setup + API de GitHub | firma coherente, `latest.json` con el nombre real del asset |
| Seguridad | escaneo manual (el gate del harness es un falso verde, ver §3) | 0 secretos, 0 `eval`, 0 `dangerouslySetInnerHTML`, SQL parametrizado |

## 2. ✅ Bloqueante de la plantilla: RESUELTO y verificable

**El problema:** `tauri.conf.json` empaqueta `../registro.db` (que es la base de DESARROLLO, con su WAL de
1,1 MB: 4 órdenes, 2 pagos, 3 cierres, **un día abierto** y **1 cliente real**), el repo es **PÚBLICO** y
`release.ps1` no verificaba nada. Además esa base era la **pre-normalización**: 896 nombres no canónicos,
38 grupos duplicados, 3 stocks negativos y **1126 productos sin precio** (una PC nueva no podía vender).

**Lo que quedó implementado (dos herramientas nuevas):**

| Herramienta | Qué hace |
|---|---|
| `tools/release_gate.mjs` | Valida la plantilla ANTES de empaquetar: WAL pendiente, filas en tablas transaccionales/clientes, día abierto, **productos con stock sin precio**, duplicados (marca+modelo+variante), stock negativo, integridad, FK, PIN. **Conectado a `tools/release.ps1`**: si la plantilla no está lista, **el release se aborta** |
| `tools/make_release_template.mjs` | Arma la plantilla de producción **en un archivo nuevo** (nunca toca `registro.db`): copia consistente con `VACUUM INTO` (incluye el WAL) → vacía transaccionales/clientes → técnicos al seed → limpia settings de la máquina → fusiona duplicados (sumando stock) → negativos a 0 → `wal_checkpoint(TRUNCATE)` + `VACUUM`. Tiene `--merge-only` para la pasada **post-canonización** |

**Pipeline completo (comandos exactos):**
```powershell
node tools/make_release_template.mjs --force                    # 1. copia consistente + limpieza + fusión
$env:REGISTRO_NORMALIZE_DB="C:\Users\ROBER\registro\backup\plantilla_candidata.db"; $env:REGISTRO_NORMALIZE_APPLY="1"
cd src-tauri; cargo test --lib -- --ignored test_manual_normalize_db --nocapture          # 2. canonizar
$env:REGISTRO_PHONES_DB="…"; $env:REGISTRO_PHONES_APPLY="1"
cargo test --lib -- --ignored test_manual_rebuild_phones --nocapture                     # 3. padrón de teléfonos
cd ..; node tools/make_release_template.mjs --merge-only --out backup/plantilla_candidata.db  # 4. dedupe final
$env:REGISTRO_PRICES_DB="…"; $env:REGISTRO_PRICES_APPLY="1"
cd src-tauri; cargo test --lib -- --ignored test_manual_restore_prices --nocapture        # 5. precios
cd ..; node tools/release_gate.mjs --db backup/plantilla_candidata.db                     # 6. gate
```

**Resultado medido de la candidata actual** (`backup/plantilla_candidata.db`):

| Métrica | Antes (`registro.db`) | Candidata |
|---|---|---|
| Productos | 1126 | **1087** (39 fichas duplicadas fusionadas) |
| Grupos duplicados | 38 | **0** |
| SKU negativos | 3 | **0** |
| Nombres no canónicos | 896 | **0** |
| Marcas fuera del mapa | 14 | **0** |
| Servicios / pagos / cierres / clientes | 4 / 2 / 3 / 1 | **0 / 0 / 0 / 0** |
| Día abierto | sí (2026-09-15, tasa congelada) | **no** |
| Productos con precio | 0 | **950** (valor a venta **$5.621,25**) |
| Tabla `phones` / `search_text` | no / no | **sí / sí** |
| Técnicos | 3 (incluía «rbs» de dev) | 2 (Aldri, William) |
| Settings de la máquina | puerto e impresora de dev | **limpios** |

## 3. 🔴 Bloqueantes que quedan

| # | Bloqueante | Evidencia / efecto | Arreglo |
|---|---|---|---|
| **B1** | **123 productos CON STOCK (333 de 706 unidades) sin precio de venta** | En el mostrador esa ficha **no se puede cobrar** (el botón queda apagado, verificado en vivo). La lista del local (`cellworld_items.json`, 957 fichas) no los cubre: son fichas cuyo modelo no matchea por nombre canónico | Decisión del local: (a) cargar esos precios a mano en Inventario, (b) mejorar el cruce de precios (tokens/compatibilidad en vez de modelo exacto) → feature nueva, o (c) aceptar que esos SKU no se venden y **actualizar el gate** con una excepción documentada |
| **B2** | **La búsqueda de pantallas NO tiene gate de marca y la app AUTO-ELIGE la ficha equivocada** | `find_compatible_products` filtra solo por categoría y ordena **más stock primero** (`db.rs:1601-1608`); `Services.tsx:1038-1043` auto-selecciona si hay UNA con stock y al entregar descuenta ESA. Medición del padrón: **371 teléfonos con auto-selección · 60 auto-eligen pantalla de OTRA marca · 16 sin opción de su marca**. Casos: `Honor 10 Lite`→`Infinix Hot 10 Lite`, `A11` (Umidigi)→`Samsung A11`, `Realme 11 5G`→`Xiaomi Redmi Note 11 5G` | Gate de marca en `find_compatible_products` + nunca auto-seleccionar una coincidencia `parcial` de otra marca (o pedir confirmación). **Es un cambio de código Rust + UI con test** |
| **B3** | **El rol se valida solo en la UI**: la cajera puede borrar productos, cambiar precios y fusionar (solo 4 comandos exigen dueño). `owner_unlocked` no expira | `commands.rs` / `db.rs` (líneas en el informe de seguridad) | `require_owner` en los comandos de escritura del catálogo/gastos/cierres + exponer `lock_owner` + ocultar botones por rol |
| **B4** | **PIN en texto plano** y `set_pin` sin exigir el PIN actual ni el rol | `db.rs:3811`, `commands.rs:395` | Hash + `require_owner` + PIN actual + límite de intentos |
| **B5** | **El «security gate» del harness es un falso verde** | `tools/governance/security-validator.ts:117-135` solo junta `.ts/.tsx` bajo `src-tauri/src` → **0 archivos** → PASS trivial; el comando `security` del CLI ni existe (imprime help, exit 0). **Los PASS anteriores de seguridad no valían nada** | Que escanee `.rs`/`src/` y que un comando inexistente salga con exit 1 |

## 4. Riesgos que conviene arreglar antes de vender (no bloquean el build)

1. `init()` **reescribe en cada arranque** `paid_amount` y los totales de **días cerrados** (`db.rs:1054-1078`, `1147-1165`); con el fallback de tasa `1` (`db.rs:1073`) un pago en Bs. de 24.035 se volvería **$24.035**.
2. `require_open_day` **ignora la fecha** (`db.rs:4530-4539`) mientras `open_day` rechaza otra fecha: con un turno viejo abierto el local **no puede abrir el día nuevo** y sigue facturando en el viejo con la tasa congelada (comprobado en vivo: venta del 16-09 registrada dentro del turno del 15-09).
3. El cierre de día se hace **contra 0** si falla `get_daily_totals` (`DailyLedger.tsx:332` catch silencioso) → arqueo y diferencia erróneos permanentes.
4. **5 rutas de escritura multi-sentencia sin transacción** (`delete_service`, `update_service`, `add_service`, `add_service_payment`, `add_inventory_movement`): un corte de luz desincroniza stock vs servicios.
5. La app **paniquea sin mensaje** si la base no abre (`lib.rs:17`) y `get_db_path` traga los fallos de copia de la plantilla (podría arrancar con catálogo vacío sin avisar).
6. **No existe «borrar venta»** (ni comando ni botón): una venta mal cargada no se puede anular.
7. Un solo endpoint del updater (GitHub) y WebView2 no embebido (requiere internet si falta el runtime).
8. Descuadre stock vs movimientos en la copia de dev: 8 productos / 19 unidades, y 21 referencias de movimiento colgadas (residuo de scripts de verificación).
9. 51 teléfonos cuyo único repuesto es Táctil/Táctil Tablet se quedan **sin opciones** en el selector del servicio (filtra categoría 1) y 3 teléfonos tienen 2 etiquetas duplicadas en el padrón.

## 5. Plan de release (cuando B1–B5 estén cerrados)

1. Cerrar **B1** (precios de los 123 SKU con stock) → `release_gate.mjs` en **verde**.
2. Cerrar **B2** (gate de marca + auto-selección) con test Rust y prueba en vivo; volver a correr `verify_wizard_metodos` / `verify_smoke_integral`.
3. Cerrar **B3–B5** (roles en backend, PIN con hash, gate de seguridad real).
4. Congelar la plantilla: promover `backup/plantilla_candidata.db` a `registro.db` (o apuntar `tauri.conf.json` a la candidata) y **borrar el `registro.db-wal` viejo**.
5. Bump de versión (`0.3.0` por el cambio de plantilla) + notas de release.
6. `tools/release.ps1 -Version 0.3.0 -Notes "…"` → corre tests + **gate** + build firmado + `latest.json` + `gh release create`.
7. **Instalación limpia en una PC** (o máquina virtual) como prueba final: abrir, PIN, cargar/verificar stock y precios, hacer una venta, un servicio completo, un cierre de día, e imprimir un ticket.
8. Rollback disponible: `updates/prev/registro.exe` + `backup/registro.backup_pre_v*.db` (automáticos) y el respaldo de la base del local **antes** de actualizar.
