// F71 — RESPALDO Y RESTAURACIÓN DESDE LA APP (el bloqueante A2 de `AUDITORIA_ENTREGA.md`).
//
// Antes: los comandos de exportación existían (`export_data`/`import_data`) pero **ninguna pantalla los
// llamaba**; el respaldo automático sólo ocurría antes de una actualización; y lo único que la app le
// decía al dueño era «copiá registro.db a un USB» (Ayuda). Un local que trabaja todos los días con la
// caja adentro no puede depender de que alguien se acuerde de copiar un archivo a mano.
//
// QUÉ HACE ESTE MÓDULO (una sola idea: el respaldo es el ARCHIVO ENTERO de la base, no un JSON parcial):
//
//   · **`backup_now`**: copia CONSISTENTE de la base viva con `VACUUM INTO` (el método que ya usa el
//     loader del proyecto: incluye lo que todavía vive en el WAL, cosa que un `Copy-Item` no hace).
//     El archivo va a `respaldos/registro_AAA-MM-DD_HHMMSS.db` con la fecha en el nombre.
//   · **`prune`**: retención — se conservan los últimos N respaldos automáticos (14 por defecto) y
//     SIEMPRE las copias de seguridad previas a una restauración (`antes_de_restaurar_*`).
//   · **`request_restore`**: valida el archivo elegido (que sea SQLite, que tenga las tablas de la app y
//     que pase `quick_check`), hace una **copia de seguridad de la base ACTUAL** y deja un MARCADOR
//     (`restaurar_pendiente.txt`). La restauración real se aplica al ARRANCAR, antes de abrir la base:
//     pisar el archivo con la conexión abierta es pedir corrupción.
//   · **`apply_pending_restore`**: se llama en el arranque; si hay marcador, reemplaza el archivo (y
//     limpia `-wal`/`-shm`) y lo consume. Idempotente y a prueba de apagones: si el marcador quedó con
//     el candidato ya aplicado, volver a copiarlo es lo mismo.
//   · **Copia automática al CERRAR EL DÍA** (`db.rs :: close_day`): el momento en que la caja queda
//     cuadrada. Si falla, NO rompe el cierre: se anota el error para que Ayuda lo muestre.
//
// El estado del último respaldo vive en `settings` (`last_backup_at`, `last_backup_error`), así que se
// puede mirar desde cualquier pantalla sin abrir archivos.

use std::path::{Path, PathBuf};

/// Cuántos respaldos AUTOMÁTICOS se conservan (los viejos se borran). Las copias previas a una
/// restauración no se tocan nunca: son la red de seguridad de la red de seguridad.
pub const RETENCION_AUTOMATICOS: usize = 14;

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    /// Fecha del nombre (`AAAA-MM-DD HH:MM:SS`) — la del archivo, no la del sistema de archivos.
    pub created_at: String,
    /// `true` = respaldo hecho por el sistema (al cerrar el día); `false` = lo pidió el dueño.
    pub automatico: bool,
    /// `true` = copia de seguridad previa a una restauración.
    pub seguridad: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupStatus {
    pub dir: String,
    pub total: usize,
    pub ultimo: Option<BackupInfo>,
    /// Último error de respaldo (el cierre del día NO se rompe por esto, pero se avisa).
    pub error: Option<String>,
    pub retencion: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RestorePlan {
    /// Copia de la base ACTUAL hecha antes de restaurar (lo que se puede volver atrás).
    pub copia_seguridad: String,
    /// El archivo que se va a aplicar al reiniciar.
    pub candidato: String,
    /// Resumen legible de lo que va a pasar (lo muestra el diálogo antes de confirmar).
    pub resumen: String,
}

/// Carpeta por defecto de los respaldos: `respaldos/` al lado de la base.
pub fn default_dir(db_path: &Path) -> PathBuf {
    db_path.parent().unwrap_or_else(|| Path::new(".")).join("respaldos")
}

fn dir_de(db_path: &Path, dir: Option<&str>) -> PathBuf {
    match dir.map(str::trim) {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => default_dir(db_path),
    }
}

/// Segundos desde epoch → `AAAA-MM-DD HH:MM:SS` local (sin dependencias: la fecha se arma con chrono,
/// que el proyecto ya usa).
fn stamp_archivo() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string()
}

/// Nombre de un respaldo nuevo. `automatico` = lo hizo el cierre del día.
pub fn nombre_respaldo(automatico: bool) -> String {
    let base = if automatico { "registro_auto" } else { "registro" };
    format!("{}_{}.db", base, stamp_archivo())
}

/// `AAAA-MM-DD HH:MM:SS` a partir del nombre del archivo (`registro[_auto]_2026-09-23_181500.db`).
pub fn fecha_del_nombre(name: &str) -> String {
    let limpio = name.trim_end_matches(".db");
    let partes: Vec<&str> = limpio.split('_').collect();
    if partes.len() >= 3 {
        // …_<fecha>_<hora>
        let hora = partes[partes.len() - 1];
        let fecha = partes[partes.len() - 2];
        let hh = hora.get(0..2).unwrap_or("00");
        let mm = hora.get(2..4).unwrap_or("00");
        let ss = hora.get(4..6).unwrap_or("00");
        return format!("{} {}:{}:{}", fecha, hh, mm, ss);
    }
    limpio.to_string()
}

fn info_de(path: &Path) -> Option<BackupInfo> {
    let name = path.file_name()?.to_string_lossy().to_string();
    if !name.to_lowercase().ends_with(".db") {
        return None;
    }
    let meta = std::fs::metadata(path).ok()?;
    Some(BackupInfo {
        created_at: fecha_del_nombre(&name),
        automatico: name.starts_with("registro_auto_"),
        seguridad: name.starts_with("antes_de_restaurar_"),
        size_bytes: meta.len(),
        path: path.to_string_lossy().to_string(),
        name,
    })
}

/// ¿Es un archivo de base de la app? (SQLite válido + las tablas mínimas). Fail-closed: cualquier
/// problema → `false`, y el mensaje dice qué pasó.
pub fn validar_candidato(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("No existe el archivo {}.", path.display()));
    }
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("No se pudo abrir el respaldo: {e}"))?;
    let integridad: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| format!("El archivo no parece una base SQLite: {e}"))?;
    if integridad != "ok" {
        return Err(format!("El respaldo está dañado (quick_check: {integridad})."));
    }
    let faltan: Vec<&str> = ["products", "sales", "services", "daily_closings"]
        .into_iter()
        .filter(|t| {
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                rusqlite::params![t],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) == 0
        })
        .collect();
    if !faltan.is_empty() {
        return Err(format!(
            "Ese archivo no es un respaldo de esta app (le faltan tablas: {}).",
            faltan.join(", ")
        ));
    }
    Ok(())
}

/// Copia consistente de la base viva a `dir`. Devuelve el respaldo creado.
pub fn backup_now(db_path: &Path, dir: Option<&str>, automatico: bool) -> Result<BackupInfo, String> {
    let destino_dir = dir_de(db_path, dir);
    std::fs::create_dir_all(&destino_dir)
        .map_err(|e| format!("No se pudo crear la carpeta de respaldos ({}): {e}", destino_dir.display()))?;
    let destino = destino_dir.join(nombre_respaldo(automatico));
    if destino.exists() {
        let _ = std::fs::remove_file(&destino);
    }
    // VACUUM INTO escribe un archivo NUEVO y consistente: se lleva lo que todavía vive en el WAL (un
    // `Copy-Item` del .db deja afuera esas escrituras — lección del proyecto, tools/copy_db.mjs).
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("No se pudo abrir la base para respaldar: {e}"))?;
    conn.execute("VACUUM INTO ?1", rusqlite::params![destino.to_string_lossy()])
        .map_err(|e| format!("No se pudo escribir el respaldo: {e}"))?;
    drop(conn);
    if automatico {
        prune(&destino_dir, RETENCION_AUTOMATICOS);
    }
    info_de(&destino).ok_or_else(|| "El respaldo se escribió pero no se pudo leer.".to_string())
}

/// Borra los respaldos AUTOMÁTICOS más viejos que sobren (conserva `keep`). Las copias de seguridad
/// previas a una restauración y los respaldos pedidos a mano NO se tocan.
pub fn prune(dir: &Path, keep: usize) -> usize {
    let mut autos: Vec<PathBuf> = listar(dir)
        .into_iter()
        .filter(|b| b.automatico && !b.seguridad)
        .map(|b| PathBuf::from(b.path))
        .collect();
    if autos.len() <= keep {
        return 0;
    }
    autos.sort(); // el nombre lleva la fecha → ordenar por nombre es ordenar por fecha
    let sobran = autos.len() - keep;
    let mut borrados = 0;
    for p in autos.into_iter().take(sobran) {
        if std::fs::remove_file(&p).is_ok() {
            borrados += 1;
        }
    }
    borrados
}

/// Los respaldos de la carpeta, del más nuevo al más viejo.
pub fn listar(dir: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter_map(|e| info_de(&e.path())).collect())
        .unwrap_or_default();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

/// Nombre del marcador de restauración pendiente (se deja al lado de la base).
pub fn marker_path(db_path: &Path) -> PathBuf {
    db_path.parent().unwrap_or_else(|| Path::new(".")).join("restaurar_pendiente.txt")
}

/// Pide una restauración: valida el candidato, hace la copia de seguridad de la base ACTUAL y deja el
/// marcador. La aplicación real ocurre al reiniciar (`apply_pending_restore`).
pub fn request_restore(db_path: &Path, candidato: &str) -> Result<RestorePlan, String> {
    let origen = PathBuf::from(candidato);
    validar_candidato(&origen)?;
    // Copia de seguridad de lo que hay AHORA (antes de pisar nada).
    let dir = default_dir(db_path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    let copia = dir.join(format!("antes_de_restaurar_{}.db", stamp_archivo()));
    {
        // `VACUUM INTO` se NIEGA a escribir si el destino ya existe: se borra primero, así dos
        // restauraciones pedidas en el mismo segundo no rompen la copia de seguridad.
        if copia.exists() {
            let _ = std::fs::remove_file(&copia);
        }
        let conn = rusqlite::Connection::open(db_path)
            .map_err(|e| format!("No se pudo abrir la base actual: {e}"))?;
        conn.execute("VACUUM INTO ?1", rusqlite::params![copia.to_string_lossy()])
            .map_err(|e| format!("No se pudo copiar la base actual: {e}"))?;
    }
    std::fs::write(marker_path(db_path), origen.to_string_lossy().as_bytes())
        .map_err(|e| format!("No se pudo dejar la restauración pendiente: {e}"))?;
    let resumen = format!(
        "Al reiniciar, la base se reemplaza por «{}» ({}). Antes se guardó una copia de lo que hay ahora en «{}».",
        origen.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| candidato.to_string()),
        hum(meta_len(&origen)),
        copia.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
    );
    Ok(RestorePlan {
        copia_seguridad: copia.to_string_lossy().to_string(),
        candidato: origen.to_string_lossy().to_string(),
        resumen,
    })
}

fn meta_len(p: &Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

/// Tamaño legible (lo usa el resumen del diálogo).
pub fn hum(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

/// SE LLAMA EN EL ARRANQUE, ANTES DE ABRIR LA BASE: si quedó una restauración pedida, la aplica.
/// Devuelve el nombre del archivo aplicado (para poder avisarlo) o `None` si no había nada pendiente.
///
/// Por qué al arrancar: reemplazar el archivo de la base con la conexión abierta es pedir corrupción
/// (SQLite tiene su propio WAL y su caché). El pedido se deja en un marcador y se aplica acá, cuando
/// todavía no hay nadie leyendo. Si el candidato ya no está o no valida, el marcador se descarta y se
/// sigue con la base actual (fail-closed: NUNCA se deja la app sin base).
pub fn apply_pending_restore(db_path: &Path) -> Option<String> {
    let marker = marker_path(db_path);
    if !marker.exists() {
        return None;
    }
    let candidato = std::fs::read_to_string(&marker).ok()?.trim().to_string();
    let origen = PathBuf::from(&candidato);
    if validar_candidato(&origen).is_err() {
        let _ = std::fs::remove_file(&marker);
        return None;
    }
    // Limpiar el WAL de la base vieja ANTES de pisar el archivo (si no, SQLite mezclaría el WAL de una
    // base con el archivo de otra).
    for sufijo in ["-wal", "-shm"] {
        let mut p = db_path.as_os_str().to_os_string();
        p.push(sufijo);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
    match std::fs::copy(&origen, db_path) {
        Ok(_) => {
            let _ = std::fs::remove_file(&marker);
            origen.file_name().map(|f| f.to_string_lossy().to_string())
        }
        Err(e) => {
            eprintln!("[registro] no se pudo restaurar el respaldo: {e}");
            None
        }
    }
}

/// Estado del respaldo para la pantalla (Ayuda): carpeta, último respaldo, errores.
pub fn status(db_path: &Path, dir: Option<&str>, error: Option<String>) -> BackupStatus {
    let d = dir_de(db_path, dir);
    let lista = listar(&d);
    BackupStatus {
        dir: d.to_string_lossy().to_string(),
        total: lista.len(),
        ultimo: lista.first().cloned(),
        error,
        retencion: RETENCION_AUTOMATICOS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_temporal(nombre: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("registro_bkp_{}_{}", nombre, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // La base viva vive FUERA de la carpeta de respaldos (como en la app: `respaldos/` al lado)
        let datos = dir.join("datos");
        std::fs::create_dir_all(&datos).unwrap();
        (dir, datos.join("registro.db"))
    }

    fn carpeta(dir: &Path) -> String {
        dir.join("respaldos").to_string_lossy().to_string()
    }

    fn crear_base(path: &Path, marca: &str) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY, total REAL);
             CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, amount REAL);
             CREATE TABLE IF NOT EXISTS daily_closings (id INTEGER PRIMARY KEY, close_date TEXT);",
        )
        .unwrap();
        conn.execute("INSERT INTO products (name) VALUES (?1)", rusqlite::params![marca]).unwrap();
    }

    #[test]
    fn test_backup_copia_consistente_y_retencion() {
        let (dir, db) = base_temporal("copia");
        crear_base(&db, "Pantalla A");
        let b1 = backup_now(&db, Some(&carpeta(&dir)), false).unwrap();
        assert!(std::path::Path::new(&b1.path).exists(), "el respaldo existe");
        assert!(b1.size_bytes > 0, "y no está vacío");
        assert!(!b1.automatico && !b1.seguridad);
        // El respaldo es una BASE VÁLIDA con los datos de la viva
        validar_candidato(Path::new(&b1.path)).unwrap();
        let conn = rusqlite::Connection::open(&b1.path).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "el respaldo se lleva las filas");

        // Retención: se arman 5 automáticos con nombres distintos (en la vida real los separa la hora;
        // en un test todos caen en el mismo segundo) y se conservan los 2 más nuevos.
        let carpeta_bkp = dir.join("respaldos");
        for hora in ["2026-01-01_090000", "2026-01-02_090000", "2026-01-03_090000", "2026-01-04_090000", "2026-01-05_090000"] {
            std::fs::write(carpeta_bkp.join(format!("registro_auto_{}.db", hora)), b"x").unwrap();
        }
        let manual = std::fs::read_dir(&carpeta_bkp).unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy().starts_with("registro_2026"))
            .map(|e| e.path())
            .expect("el respaldo pedido a mano sigue en la carpeta");
        assert!(manual.exists());
        let borrados = prune(&carpeta_bkp, 2);
        assert_eq!(borrados, 3, "de 5 automáticos con retención 2 se borran 3");
        let lista = listar(&carpeta_bkp);
        assert_eq!(lista.iter().filter(|b| b.automatico).count(), 2);
        assert_eq!(lista.iter().filter(|b| !b.automatico).count(), 1, "el pedido a mano NO se toca");
        assert!(manual.exists(), "y sigue en disco");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_restore_valida_y_deja_marcador() {
        let (dir, db) = base_temporal("restore");
        crear_base(&db, "Original");
        let b = backup_now(&db, Some(&carpeta(&dir)), false).unwrap();

        // Un archivo que no es de la app se RECHAZA (fail-closed) y no deja marcador
        let basura = dir.join("no_es_respaldo.db");
        std::fs::write(&basura, b"esto no es sqlite").unwrap();
        let err = request_restore(&db, &basura.to_string_lossy()).unwrap_err();
        assert!(err.contains("no parece una base SQLite") || err.contains("respald"), "rechaza la basura: {err}");
        assert!(!marker_path(&db).exists(), "sin marcador cuando el candidato no vale");

        // Con un candidato válido: copia de seguridad + marcador con el resumen
        let plan = request_restore(&db, &b.path).unwrap();
        assert!(std::path::Path::new(&plan.copia_seguridad).exists(), "copia de la base actual");
        assert!(plan.resumen.contains("Al reiniciar"), "el resumen dice qué va a pasar: {}", plan.resumen);
        assert!(marker_path(&db).exists(), "queda pendiente para el arranque");

        // Cambia la base viva y se aplica la restauración → vuelve el contenido del respaldo
        {
            let conn = rusqlite::Connection::open(&db).unwrap();
            conn.execute("DELETE FROM products", []).unwrap();
            conn.execute("INSERT INTO products (name) VALUES ('Basura')", []).unwrap();
        }
        let aplicado = apply_pending_restore(&db).expect("aplica la restauración pendiente");
        assert!(aplicado.ends_with(".db"));
        assert!(!marker_path(&db).exists(), "el marcador se consume");
        let conn = rusqlite::Connection::open(&db).unwrap();
        let nombre: String = conn.query_row("SELECT name FROM products", [], |r| r.get(0)).unwrap();
        assert_eq!(nombre, "Original", "la base quedó como el respaldo");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_fecha_del_nombre_y_estado() {
        assert_eq!(fecha_del_nombre("registro_2026-09-23_181500.db"), "2026-09-23 18:15:00");
        assert_eq!(fecha_del_nombre("registro_auto_2026-01-02_090000.db"), "2026-01-02 09:00:00");
        let (dir, db) = base_temporal("estado");
        crear_base(&db, "X");
        let s0 = status(&db, Some(&carpeta(&dir)), None);
        assert_eq!(s0.total, 0, "sin respaldos todavía");
        assert!(s0.ultimo.is_none());
        assert_eq!(s0.dir, carpeta(&dir));
        assert_eq!(s0.retencion, RETENCION_AUTOMATICOS);
        let _ = backup_now(&db, Some(&carpeta(&dir)), false).unwrap();
        let s1 = status(&db, Some(&carpeta(&dir)), Some("falló el de anoche".into()));
        assert_eq!(s1.total, 1);
        assert!(s1.ultimo.is_some(), "el último respaldo se informa");
        assert_eq!(s1.error.as_deref(), Some("falló el de anoche"), "un error de respaldo se muestra");
        assert!(s1.ultimo.unwrap().created_at.starts_with("20"), "con su fecha legible");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
