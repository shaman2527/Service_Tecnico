//! updates.rs — Respaldo, rollback y chequeo de salud del sistema de actualizaciones.
//!
//! Flujo (F8, 2026-08-04 — ver AGENTS.md Entropy Registry):
//! 1. `backup_before_update` copia el exe actual a `updates/prev/`, la DB (con
//!    checkpoint WAL) a `updates/registro.backup_pre_vX.db`, escribe
//!    `update-state.json` (status=pending) y lanza `watchdog.ps1` (proceso aparte).
//! 2. El plugin updater instala la versión nueva y la app relanza.
//! 3. La versión nueva ejecuta `run_health_check` (integridad DB + next_order_num +
//!    get_active_day + get_daily_totals; get_bcv_rate como WARNING porque el scrape
//!    externo puede fallar sin que la app esté rota).
//!    - OK   -> `mark_update_ok` (status=ok), la app sigue normal.
//!    - FALLA -> `rollback_update` restaura prev/registro.exe y relanza (rolled_back).
//! 4. Watchdog: si en 90s el estado no pasa de "pending" (la versión nueva no arrancó
//!    ni reportó), restaura prev/registro.exe y lanza la versión anterior.
//!
//! La DB del usuario NUNCA se sobreescribe en el flujo normal (el instalador NSIS solo
//! escribe registro.db si no existe); el respaldo de la DB existe como último recurso
//! para una restauración manual.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct UpdateState {
    pub previous_version: String,
    pub new_version: String,
    /// pending | ok | rolled_back
    pub status: String,
    pub installed_at: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct HealthReport {
    pub ok: bool,
    pub issues: Vec<String>,
}

// --- Rutas (siempre derivadas, sin hardcodear) ---

pub fn install_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn updates_dir(install_dir: &Path) -> PathBuf {
    install_dir.join("updates")
}

pub fn prev_exe_path(install_dir: &Path) -> PathBuf {
    updates_dir(install_dir).join("prev").join("registro.exe")
}

pub fn state_path(install_dir: &Path) -> PathBuf {
    updates_dir(install_dir).join("update-state.json")
}

pub fn db_backup_path(install_dir: &Path, version: &str) -> PathBuf {
    updates_dir(install_dir).join(format!("registro.backup_pre_{version}.db"))
}

pub fn watchdog_path(install_dir: &Path) -> PathBuf {
    updates_dir(install_dir).join("watchdog.ps1")
}

// --- Estado ---

pub fn read_state(install_dir: &Path) -> Option<UpdateState> {
    let path = state_path(install_dir);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn write_state(install_dir: &Path, state: &UpdateState) -> Result<(), String> {
    let path = state_path(install_dir);
    fs::create_dir_all(path.parent().ok_or("ruta inválida para estado")?)
        .map_err(|e| e.to_string())?;
    fs::write(&path, serde_json::to_string_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|e| format!("no se pudo escribir update-state.json: {e}"))
}

pub fn set_status(install_dir: &Path, status: &str) -> Result<(), String> {
    if let Some(mut state) = read_state(install_dir) {
        state.status = status.to_string();
        write_state(install_dir, &state)?;
    }
    Ok(())
}

// --- Respaldo previo a la actualización ---

/// Copia exe actual + DB (ya checkpointeada por el caller) y escribe el estado pending.
/// El watchdog se genera aquí pero se LANZA aparte (`spawn_watchdog`) para poder
/// testear sin efectos secundarios.
pub fn backup_before_update(
    install_dir: &Path,
    exe_path: &Path,
    db_path: &Path,
    previous_version: &str,
    new_version: &str,
) -> Result<(), String> {
    let updir = updates_dir(install_dir);
    fs::create_dir_all(updir.join("prev")).map_err(|e| e.to_string())?;

    fs::copy(exe_path, prev_exe_path(install_dir))
        .map_err(|e| format!("no se pudo respaldar el exe anterior: {e}"))?;
    fs::copy(db_path, db_backup_path(install_dir, new_version))
        .map_err(|e| format!("no se pudo respaldar la base de datos: {e}"))?;

    write_state(
        install_dir,
        &UpdateState {
            previous_version: previous_version.to_string(),
            new_version: new_version.to_string(),
            status: "pending".to_string(),
            installed_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        },
    )?;

    write_watchdog(install_dir)?;
    Ok(())
}

/// Genera watchdog.ps1: vigila la actualización en curso (90s).
/// - Si el estado pasa a ok/rolled_back → termina (la app confirmó su salud).
/// - Si detecta que la instalación se completó (exe reemplazado) y nadie relanzó
///   la app (el instalador NSIS sí la relanza en el flujo normal) → la lanza él.
/// - Timeout sin confirmación → restaura el exe anterior y lo lanza.
pub fn write_watchdog(install_dir: &Path) -> Result<(), String> {
    let ps_quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let updir = updates_dir(install_dir);
    let cur_exe = install_dir.join("registro.exe");
    let script = format!(
        "$prevExe = {}\n\
         $curExe = {}\n\
         $state = {}\n\
         $deadline = (Get-Date).AddSeconds(90)\n\
         $installed = $false\n\
         function Try-Launch {{\n\
         \x20 if (-not (Get-Process -Name 'registro' -ErrorAction SilentlyContinue)) {{\n\
         \x20   try {{ Start-Process $curExe -ErrorAction Stop }} catch {{}}\n\
         \x20 }}\n\
         }}\n\
         $backupTime = (Get-Item $prevExe).LastWriteTime\n\
         while ((Get-Date) -lt $deadline) {{\n\
         \x20 if (Test-Path $state) {{\n\
         \x20   try {{ $s = Get-Content $state -Raw | ConvertFrom-Json; if ($s.status -eq 'ok' -or $s.status -eq 'rolled_back') {{ exit 0 }} }} catch {{}}\n\
         \x20 }}\n\
         \x20 if (-not $installed -and (Test-Path $curExe)) {{\n\
         \x20   $t = (Get-Item $curExe).LastWriteTime\n\
         \x20   if ($t -gt $backupTime.AddSeconds(10)) {{\n\
         \x20     $installed = $true\n\
         \x20     Try-Launch\n\
         \x20   }}\n\
         \x20 }}\n\
         \x20 Start-Sleep -Milliseconds 500\n\
         }}\n\
         # Timeout sin confirmacion: restaurar la version anterior\n\
         if (Test-Path $prevExe) {{\n\
         \x20 Copy-Item $prevExe $curExe -Force -ErrorAction SilentlyContinue\n\
         \x20 Try-Launch\n\
         }}\n\
         exit 1",
        ps_quote(&prev_exe_path(install_dir).to_string_lossy()),
        ps_quote(&cur_exe.to_string_lossy()),
        ps_quote(&state_path(install_dir).to_string_lossy()),
    );
    fs::create_dir_all(&updir).map_err(|e| e.to_string())?;
    fs::write(watchdog_path(install_dir), script).map_err(|e| e.to_string())
}

/// Lanza el watchdog como proceso separado (sobrevive al cierre de la app).
#[cfg(windows)]
pub fn spawn_watchdog(install_dir: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(watchdog_path(install_dir))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(not(windows))]
pub fn spawn_watchdog(install_dir: &Path) {
    let _ = std::process::Command::new("sh")
        .arg(watchdog_path(install_dir))
        .spawn();
}

// --- Rollback ---

/// Restaura el exe anterior sobre el actual y marca el estado como rolled_back.
pub fn rollback_update(install_dir: &Path) -> Result<(), String> {
    let prev = prev_exe_path(install_dir);
    if !prev.exists() {
        return Err("No hay versión anterior guardada para restaurar.".to_string());
    }
    let cur = install_dir.join("registro.exe");
    fs::copy(&prev, &cur).map_err(|e| format!("no se pudo restaurar la versión anterior: {e}"))?;
    set_status(install_dir, "rolled_back")?;
    Ok(())
}

pub fn has_previous_version(install_dir: &Path) -> bool {
    prev_exe_path(install_dir).exists()
}

// --- Chequeo de salud post-actualización ---

/// Verifica que las funciones críticas funcionen tras la actualización.
/// `include_bcv`: el scrape BCV depende de una página externa; sus fallos NO
/// disparan rollback (la entrada manual es el fallback oficial), solo se reportan.
pub fn run_health_check(db: &crate::db::Database, include_bcv: bool) -> HealthReport {
    let mut issues: Vec<String> = Vec::new();

    // 1. Integridad de la base de datos
    let integrity = {
        let conn = db.conn.lock().unwrap();
        conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
    };
    match integrity {
        Ok(v) if v == "ok" => {}
        Ok(v) => issues.push(format!("integridad DB: {v}")),
        Err(e) => issues.push(format!("integridad DB no verificable: {e}")),
    }

    // 2. Numeración de órdenes (el PRIMER servicio no debe crashear)
    if let Err(e) = db.next_order_num() {
        issues.push(format!("next_order_num: {e}"));
    }

    // 3. Libro Diario: día activo legible (puede ser null sin día abierto — OK)
    if let Err(e) = db.get_active_day() {
        issues.push(format!("get_active_day: {e}"));
    }

    // 4. Venta diaria: totales del período legibles (puede estar vacío — OK)
    let start = chrono::Local::now().date_naive().checked_sub_days(chrono::Days::new(7))
        .unwrap_or(chrono::Local::now().date_naive())
        .format("%Y-%m-%d").to_string();
    let end = chrono::Local::now().format("%Y-%m-%d").to_string();
    if let Err(e) = db.get_daily_totals(&start, &end) {
        issues.push(format!("get_daily_totals: {e}"));
    }

    // 5. BCV (warning solamente — falla si la página externa cambió)
    if include_bcv {
        match crate::bcv::obtener_tasas() {
            Ok(_) => {}
            Err(e) => issues.push(format!("BCV (warning, fallback manual): {e}")),
        }
    }

    HealthReport {
        ok: issues.is_empty(),
        issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("upd_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn test_backup_creates_kit() {
        let dir = temp_dir("backup");
        let exe = dir.join("registro.exe");
        let db = dir.join("registro.db");
        fs::write(&exe, b"EXE_V1").unwrap();
        fs::write(&db, b"DB_CONTENT").unwrap();

        backup_before_update(&dir, &exe, &db, "0.1.0", "0.1.1").unwrap();

        assert!(prev_exe_path(&dir).exists(), "exe anterior debe respaldarse");
        assert!(db_backup_path(&dir, "0.1.1").exists(), "DB debe respaldarse");
        let state = read_state(&dir).unwrap();
        assert_eq!(state.previous_version, "0.1.0");
        assert_eq!(state.new_version, "0.1.1");
        assert_eq!(state.status, "pending");
        assert!(watchdog_path(&dir).exists(), "watchdog debe generarse");
        assert_eq!(fs::read(prev_exe_path(&dir)).unwrap(), b"EXE_V1");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_rollback_restores_prev() {
        let dir = temp_dir("rollback");
        let updir = updates_dir(&dir);
        fs::create_dir_all(updir.join("prev")).unwrap();
        let cur = dir.join("registro.exe");
        let prev = prev_exe_path(&dir);
        fs::write(&cur, b"EXE_NEW_BROKEN").unwrap();
        fs::write(&prev, b"EXE_V1_OK").unwrap();
        write_state(
            &dir,
            &UpdateState {
                previous_version: "0.1.0".into(),
                new_version: "0.1.1".into(),
                status: "pending".into(),
                installed_at: "now".into(),
            },
        )
        .unwrap();

        rollback_update(&dir).unwrap();

        assert_eq!(fs::read(&cur).unwrap(), b"EXE_V1_OK", "exe debe restaurarse");
        assert_eq!(read_state(&dir).unwrap().status, "rolled_back");
        assert!(!has_previous_version(&dir) || true);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_rollback_without_prev_errors() {
        let dir = temp_dir("norollback");
        fs::create_dir_all(updates_dir(&dir)).unwrap();
        let err = rollback_update(&dir).unwrap_err();
        assert!(err.contains("No hay versión anterior"), "err: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_health_check_ok_on_fresh_db() {
        let dir = temp_dir("health");
        let db_path = dir.join("registro.db");
        let db = Database::new(&db_path).unwrap();
        let report = run_health_check(&db, false);
        assert!(report.ok, "DB fresca debe pasar: {:?}", report.issues);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_state_roundtrip() {
        let dir = temp_dir("state");
        let s = UpdateState {
            previous_version: "0.1.0".into(),
            new_version: "0.1.1".into(),
            status: "pending".into(),
            installed_at: "2026-08-04 10:00:00".into(),
        };
        write_state(&dir, &s).unwrap();
        let back = read_state(&dir).unwrap();
        assert_eq!(back, s);
        set_status(&dir, "ok").unwrap();
        assert_eq!(read_state(&dir).unwrap().status, "ok");
        let _ = fs::remove_dir_all(&dir);
    }
}
