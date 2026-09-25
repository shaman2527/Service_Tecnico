# F71 — Respaldo y restauración desde la app (+ los arreglos baratos del alta)

**Estado:** implementada y verificada (Sprint A de `AUDITORIA_ENTREGA.md`, bloqueante **A2**).
**Origen:** la auditoría de entrega al cliente final (2026-09-23).
**Regla madre:** *el respaldo es la BASE ENTERA, y una restauración nunca puede dejar al local sin base:
primero se guarda lo que hay, después se pisa.*

---

## 1. El problema (medido)

* **No había respaldo ni restauración dentro de la app.** Los comandos existían y estaban probados
  (`export_data`/`import_data`) pero **ninguna pantalla los llamaba**: el respaldo automático sólo ocurría
  antes de una actualización, `rollback_update` restaura **el exe, no la base**, y lo único que la app le
  decía al dueño era «copiá `registro.db` a un USB» (Ayuda). Un local que trabaja todos los días con la
  caja adentro no puede depender de que alguien se acuerde de copiar un archivo a mano.
* **La Ayuda mentía en dos preguntas**: decía que se puede «corregir una venta» (F70 lo hizo posible
  recién ahora, y **anulando**, no editando) y que hay que copiar el archivo a mano (ya no hace falta).
* El **export** ya quedó detrás del dueño y sin el hash del PIN en F69 (el tercer «arreglo barato» de la
  auditoría), y el aviso de «ficha sin precio» quedó en F70 (el formulario lo dice y el KPI «Sin precio»
  del Inventario lista esas fichas).

## 2. Qué se implementa

### 2.1 Backend — `src-tauri/src/backups.rs` (módulo nuevo)

* **`backup_now`**: copia **consistente** de la base viva con `VACUUM INTO` (se lleva lo que todavía está
  en el WAL — un `Copy-Item` del `.db` deja esas escrituras afuera; es la lección que ya documenta
  `tools/copy_db.mjs`). Nombre con fecha: `respaldos/registro_AAAA-MM-DD_HHMMSS.db`, y los automáticos
  `registro_auto_…`.
* **`prune`**: retención de **14** automáticos (los más viejos se borran). Las copias previas a una
  restauración (`antes_de_restaurar_*`) y los respaldos pedidos a mano **no se tocan nunca**.
* **Copia AUTOMÁTICA al cerrar el día** (`db.rs :: close_day` → `auto_backup`): el momento en que la caja
  queda cuadrada. **Si falla, el cierre NO se rompe** — se anota el error en `settings` y la pantalla de
  respaldos lo muestra (`last_backup_error`).
* **`request_restore`**: valida el candidato (SQLite válido, `quick_check` ok, con las tablas de la app),
  guarda una **copia de seguridad de la base ACTUAL** y deja un **marcador**
  (`restaurar_pendiente.txt`). Devuelve el resumen que el diálogo le muestra al dueño.
* **`apply_pending_restore`**: se llama **en el arranque, antes de abrir la base** (pisar el archivo con
  la conexión abierta es pedir corrupción: SQLite tiene su WAL y su caché). Limpia `-wal`/`-shm`, copia el
  candidato y consume el marcador. **Fail-closed**: si el candidato ya no está o no valida, descarta el
  pedido y sigue con la base actual — nunca deja la app sin base.
* **`status` / `listar`**: carpeta, último respaldo (con su fecha legible), retención y error, para la
  pantalla.

### 2.2 Comandos (todos del DUEÑO)

`backup_now(dir?)`, `list_backups(dir?)`, `backup_status(dir?)`, `request_restore(path)`,
`restore_pending()`. La CAJA no respalda ni restaura (el backend lo rechaza): su trabajo es el mostrador.

### 2.3 UI — `src/components/BackupsDialog.tsx` (en **Ayuda → «Respaldos»**)

* **Estado a la vista** primero: «Respaldo de hoy (23/09/2026 18:15)» / «hace N días» / «todavía no hay
  ningún respaldo: si esta PC se rompe, se pierde todo el negocio» / «el último respaldo FALLÓ: …».
* **«Respaldar ahora»** + **«Elegir carpeta (USB)»** (diálogo nativo; si el plugin no está, se escribe la
  ruta a mano) + «Actualizar».
* **Lista** de respaldos con fecha, archivo, tamaño, de qué tipo es (automático / pedido a mano / copia
  previa a una restauración) y botón **«Restaurar»** por fila.
* **Confirmación explícita** antes de restaurar: qué archivo, de cuándo, cuánto pesa, que **antes se
  guarda una copia de lo que hay ahora** y que la app se reinicia. Sin eso, restaurar es un botón que
  asusta (y con razón: pisa todo el negocio).
* Regla pura **`src/lib/backup.ts`** (probada en `tools/backup_test.ts`): salud del respaldo por días
  transcurridos, etiquetas, tamaños/fechas legibles, validación de qué se puede restaurar y el texto de
  la confirmación.

### 2.4 Arreglos baratos de la Ayuda (veracidad)

* La respuesta «¿Cómo respaldo mi información?» ahora habla del botón **Respaldos**, de la copia
  automática al cerrar el día y de la restauración con copia previa (antes: «copiá `registro.db` a un
  USB»).
* «¿Puedo corregir una venta o servicio?» ahora dice la verdad: los **servicios** se editan (el stock se
  ajusta solo, los abonos se borran) y las **ventas se anulan** con motivo (devuelve el stock, sale de la
  caja de ese día, queda tachada) — nada de «editá el registro», que era imposible para ventas.

## 3. Pruebas (resultado real)

| Tipo | Qué | Resultado |
|---|---|---|
| Rust | `backups::tests::test_backup_copia_consistente_y_retencion` (copia válida con las filas, retención de automáticos, los manuales intactos) | ✅ |
| Rust | `backups::tests::test_restore_valida_y_deja_marcador` (basura rechazada sin marcador, copia de seguridad + marcador, aplicación al arrancar con el contenido del respaldo) | ✅ |
| Rust | `backups::tests::test_fecha_del_nombre_y_estado` (fecha legible del nombre, estado vacío/con respaldo/con error) | ✅ |
| Rust (suite) | `cd src-tauri && cargo test --lib` | **157/157** (8 ignorados) |
| Puro | `node tools/backup_test.ts` (salud del respaldo, etiquetas, tamaños, texto de restauración, qué se puede restaurar) | **37/37** |
| En vivo | `node tools/verify_respaldo.mjs` (parte 1: botón en Ayuda, estado y carpeta, respaldo REAL en disco con `quick_check` y las MISMAS filas que la viva, listado, «Respaldar ahora» creando otro, restauración rechazando basura, copia de seguridad + marcador) | **17/17** |
| En vivo | `node tools/verify_respaldo2.mjs` (parte 2, **después de reiniciar**: marcador consumido, la base volvió al respaldo, `quick_check` ok, copia previa en la carpeta, la caja no puede respaldar ni restaurar) | **7/7** |
| En vivo (regresión) | `verify_arqueo_f69.mjs` **37/37** · `verify_anular_venta.mjs` **36/36** · `verify_smoke_integral.mjs` **OK** | ✅ |

**Evidencia de la restauración de punta a punta:** se hizo un respaldo, se insertó un producto de prueba
(`PRUEBA-F71-…`), se pidió restaurar ese respaldo (copia de seguridad + marcador), se reinició la app y
quedaron **0 filas de prueba** con `quick_check: ok` — la base volvió al momento del respaldo.

## 4. Fuera de alcance (anotado, no oculto)

* El respaldo **no se sube a la nube** (offline-first: el dueño elige la carpeta, y un USB sirve).
* La restauración **reinicia la app** (una vez): es la única forma de pisar el archivo sin arriesgar
  corrupción con la base abierta, y el diálogo lo dice antes de confirmar.
* El respaldo **no lleva los PIN en texto claro ni el hash**: al restaurar, los PIN de las personas que ya
  existen en la instalación se conservan (no se pisan), así que nadie queda afuera.
