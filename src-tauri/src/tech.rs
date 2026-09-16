//! Perfil profesional del TÉCNICO (2026-09-15): qué servicios hizo, cuándo, de qué
//! tipo y cuánto facturó, por día/semana/mes, para controlar el rendimiento.
//! Los datos salen de `services` (técnico asignado + fecha + tipo de trabajo).

use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TechDayRow {
    pub date: String,
    /// equipos recibidos ese día por el técnico
    pub received: i64,
    /// equipos entregados ese día
    pub delivered: i64,
    /// facturado (USD) de los entregados ese día
    pub usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TechTypeRow {
    pub label: String,
    pub count: i64,
    pub usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TechServiceRow {
    pub id: i64,
    pub order_num: String,
    pub date_in: String,
    pub date_out: Option<String>,
    pub client: String,
    pub model: String,
    pub status: String,
    pub types: String,
    pub amount: f64,
    pub paid: f64,
    pub saldo: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TechnicianProfile {
    pub technician_id: Option<i64>,
    pub name: String,
    pub initials: String,
    pub color: String,
    pub start: String,
    pub end: String,
    /// días del rango (para la gráfica)
    pub days: Vec<TechDayRow>,
    /// desglose por tipo de trabajo
    pub types: Vec<TechTypeRow>,
    pub services: i64,
    pub delivered: i64,
    pub active: i64,
    pub finalized: i64,
    /// facturado de los ENTREGADOS en el período
    pub income_usd: f64,
    /// saldo por cobrar de sus órdenes activas
    pub pending_usd: f64,
    /// promedio de equipos entregados por día trabajado
    pub avg_per_day: f64,
    pub items: Vec<TechServiceRow>,
}

const ACTIVE: [&str; 5] = ["Entregado", "Cancelado", "Devuelto", "Cancelado / Devuelto", ""];

fn is_finalized(status: &str) -> bool {
    matches!(status, "Entregado" | "Cancelado" | "Devuelto" | "Cancelado / Devuelto")
}

fn is_cancelled(status: &str) -> bool {
    matches!(status, "Cancelado" | "Devuelto" | "Cancelado / Devuelto")
}

/// Perfil del técnico en un rango de fechas (por fecha de RECEPCIÓN de la orden,
/// y los entregados se cuentan por su fecha de SALIDA dentro del rango).
pub fn get_technician_profile(
    conn: &Connection,
    technician_id: Option<i64>,
    start: &str,
    end: &str,
) -> SqlResult<TechnicianProfile> {
    let (name, initials, color) = match technician_id {
        Some(id) => conn
            .query_row(
                "SELECT name, COALESCE(initials,''), COALESCE(color,'bg-slate-500') FROM technicians WHERE id=?1",
                params![id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
            )
            .unwrap_or_else(|_| ("(técnico borrado)".to_string(), String::new(), "bg-slate-500".to_string())),
        None => ("Sin asignar".to_string(), "—".to_string(), "bg-slate-500".to_string()),
    };

    let mut profile = TechnicianProfile {
        technician_id,
        name,
        initials,
        color,
        start: start.to_string(),
        end: end.to_string(),
        ..Default::default()
    };

    // Todas las órdenes del técnico en el rango (por recepción) + las entregadas
    // en el rango aunque se hayan recibido antes (para no perder facturación).
    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(order_num,''), COALESCE(date_in,''), date_out, COALESCE(client,''),
                COALESCE(model,''), COALESCE(status,''), COALESCE(service_types,''), COALESCE(service_type,''),
                COALESCE(amount,0), COALESCE(paid_amount,0), COALESCE(currency,'USD')
         FROM services
         WHERE (technician_id IS ?1 OR (COALESCE(technician_id,0)=0 AND ?1 IS NOT NULL
                                AND lower(COALESCE(technician,'')) = lower(?4))
                OR (technician_id IS NULL AND ?1 IS NULL))
           AND (date(date_in) BETWEEN date(?2) AND date(?3)
                OR (date_out IS NOT NULL AND date(date_out) BETWEEN date(?2) AND date(?3)))
         ORDER BY COALESCE(date_out, date_in) DESC, id DESC",
        )?;
    let rows = stmt.query_map(params![technician_id, start, end, profile.name.clone()], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
            r.get::<_, f64>(9)?,
            r.get::<_, f64>(10)?,
            r.get::<_, String>(11)?,
        ))
    })?;

    let mut days: BTreeMap<String, TechDayRow> = BTreeMap::new();
    let mut types: BTreeMap<String, TechTypeRow> = BTreeMap::new();
    let days_count = days_between(start, end);

    for row in rows {
        let (id, order_num, date_in, date_out, client, model, status, types_json, type_primary, amount, paid, currency) = row?;
        let day_in = day(&date_in).to_string();
        let in_range = day_in.as_str() >= start && day_in.as_str() <= end;
        let out_range = date_out.as_deref().map(|d| {
            let dd = day(d);
            dd >= start && dd <= end
        }).unwrap_or(false);

        // etiquetas del trabajo (multi-trabajo) con fallback al tipo primario
        let mut labels: Vec<String> = serde_json::from_str::<Vec<String>>(&types_json)
            .unwrap_or_default()
            .into_iter()
            .filter(|t| !t.trim().is_empty())
            .collect();
        if labels.is_empty() && !type_primary.trim().is_empty() {
            labels.push(type_primary.clone());
        }

        let saldo = (amount - paid).max(0.0);
        profile.items.push(TechServiceRow {
            id,
            order_num,
            date_in: date_in.clone(),
            date_out: date_out.clone(),
            client,
            model,
            status: status.clone(),
            types: labels.join(" + "),
            amount,
            paid,
            saldo,
            currency,
        });

        if in_range {
            profile.services += 1;
            if !is_finalized(&status) {
                profile.active += 1;
                profile.pending_usd += saldo;
            }
            if is_cancelled(&status) {
                profile.finalized += 1;
            }
            let d = days.entry(day_in.clone()).or_insert_with(|| TechDayRow {
                date: day_in.clone(),
                ..Default::default()
            });
            d.received += 1;
            for l in &labels {
                let t = types.entry(l.clone()).or_insert_with(|| TechTypeRow {
                    label: l.clone(),
                    ..Default::default()
                });
                t.count += 1;
            }
        }

        if out_range && status == "Entregado" {
            profile.delivered += 1;
            profile.income_usd += amount;
            let day_out = day(date_out.as_deref().unwrap_or_default()).to_string();
            let d = days.entry(day_out.clone()).or_insert_with(|| TechDayRow {
                date: day_out,
                ..Default::default()
            });
            d.delivered += 1;
            d.usd += amount;
            for l in &labels {
                let t = types.entry(l.clone()).or_insert_with(|| TechTypeRow {
                    label: l.clone(),
                    ..Default::default()
                });
                t.usd += amount;
            }
        }
    }

    // serie completa del rango (días sin trabajo en 0 → la gráfica no miente)
    let mut series: Vec<TechDayRow> = Vec::new();
    for d in day_range(start, end, days_count) {
        series.push(days.get(&d).cloned().unwrap_or(TechDayRow { date: d, ..Default::default() }));
    }
    profile.days = series;
    let worked = profile.days.iter().filter(|d| d.received > 0 || d.delivered > 0).count() as f64;
    profile.avg_per_day = if worked > 0.0 { profile.delivered as f64 / worked } else { 0.0 };

    let mut type_list: Vec<TechTypeRow> = types.into_values().collect();
    type_list.sort_by(|a, b| b.count.cmp(&a.count).then(b.usd.partial_cmp(&a.usd).unwrap_or(std::cmp::Ordering::Equal)));
    profile.types = type_list;

    let _ = ACTIVE;
    Ok(profile)
}

/// Solo la parte de FECHA (date_in trae hora: 2026-09-15 22:08:43).
fn day(s: &str) -> &str {
    &s[..s.len().min(10)]
}

fn days_between(start: &str, end: &str) -> i64 {
    let parse = |s: &str| {
        chrono::NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d").ok()
    };
    match (parse(start), parse(end)) {
        (Some(a), Some(b)) => (b - a).num_days() + 1,
        _ => 1,
    }
}

fn day_range(start: &str, end: &str, count: i64) -> Vec<String> {
    let parse = |s: &str| chrono::NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d").ok();
    match parse(start) {
        Some(a) => (0..count.max(1))
            .map(|i| (a + chrono::Duration::days(i)).format("%Y-%m-%d").to_string())
            .filter(|d| d.as_str() <= end)
            .collect(),
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::path::PathBuf;

    #[test]
    fn test_technician_profile_period_and_types() {
        let path = PathBuf::from("test_tech_profile.db");
        let _ = std::fs::remove_file(&path);
        let db = Database::new(&path).expect("test db");
        db.open_day(0.0, 40.0, 45.0).unwrap();
        let techs = db.get_technicians().unwrap();
        let aldi = techs.iter().find(|t| t.name == "Aldri").unwrap().id;
        let will = techs.iter().find(|t| t.name == "William").unwrap().id;

        let mk = |tech: i64, order: &str, types: &str, amount: f64, deliver: bool| {
            let sid = db.add_service(order, "Cliente", "", "Samsung A06", "rota", "Cambio pantalla",
                types, amount, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "{}", None, "", Some(tech), "", None, 0.0).unwrap();
            if deliver {
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                db.update_service(sid, "Cliente", "", "Samsung A06", "rota", "Cambio pantalla", types,
                    amount, "Divisas (USD Cash)", &today, "Entregado", "", 0.0, "", "USD", "", "", "{}", "", None, "", None, 0.0).unwrap();
            }
            // el técnico se fija explícito (la firma posicional de add/update es larga)
            db.conn.lock().unwrap()
                .execute("UPDATE services SET technician_id=?1 WHERE id=?2", rusqlite::params![tech, sid])
                .unwrap();
            sid
        };
        // Aldri: 2 equipos hoy (1 entregado), William: 1 en taller
        mk(aldi, "T-1", r#"["Cambio pantalla","Cambio batería"]"#, 30.0, true);
        mk(aldi, "T-2", r#"["Cambio pantalla"]"#, 20.0, false);
        mk(will, "T-3", r#"["Software / Formateo"]"#, 15.0, false);

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let week_ago = (chrono::Local::now() - chrono::Duration::days(6)).format("%Y-%m-%d").to_string();

        let p = get_technician_profile(&db.conn.lock().unwrap(), Some(aldi), &week_ago, &today).unwrap();
        assert_eq!(p.name, "Aldri");
        assert_eq!(p.initials, "A");
        assert_eq!(p.services, 2, "los dos equipos recibidos por Aldri");
        assert_eq!(p.delivered, 1);
        assert_eq!(p.active, 1);
        assert!((p.income_usd - 30.0).abs() < 1e-6, "facturado del entregado: {}", p.income_usd);
        assert!((p.pending_usd - 20.0).abs() < 1e-6, "saldo del que sigue en taller");
        assert_eq!(p.days.len(), 7, "serie de 7 días completa");
        assert_eq!(p.days.last().unwrap().received, 2, "hoy recibió 2");
        assert!(p.types.iter().any(|t| t.label == "Cambio pantalla" && t.count == 2));
        assert!(p.types.iter().any(|t| t.label == "Cambio batería" && t.count == 1));
        assert_eq!(p.items.len(), 2);

        let w = get_technician_profile(&db.conn.lock().unwrap(), Some(will), &week_ago, &today).unwrap();
        assert_eq!(w.services, 1);
        assert_eq!(w.delivered, 0);
        assert_eq!(w.types[0].label, "Software / Formateo");

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
