//! F2 — Padrón de TELÉFONOS: lista de modelos del taller (marca → modelos → ficha).
//!
//! Los repuestos de cada teléfono salen de la MISMA compatibilidad del inventario
//! (`products.compatibility`), así que lo que se ve aquí es exactamente lo que se
//! puede instalar al registrar un servicio.

use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::catalog::{compat_phones_raw, phone_registry_key};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhoneBrandRow {
    pub brand: String,
    pub phones: i64,
    pub with_products: i64,
    pub with_stock: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhoneListRow {
    pub id: i64,
    pub brand: String,
    pub line: String,
    pub model: String,
    pub name: String,
    pub needs_review: bool,
    pub aliases: Vec<String>,
    /// cuántos repuestos del inventario le sirven
    pub products: i64,
    /// unidades disponibles de esos repuestos
    pub stock: i64,
    /// categorías con repuesto para este teléfono ("Pantalla, Táctil")
    pub categories: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhonePage {
    pub items: Vec<PhoneListRow>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneCategoryBlock {
    pub category_id: i64,
    pub category: String,
    pub items: Vec<crate::db::Product>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneDetail {
    pub phone: PhoneListRow,
    pub blocks: Vec<PhoneCategoryBlock>,
}

/// Índice teléfono -> (marca, etiqueta, ids de producto, stock, categorías).
struct Idx {
    brand: String,
    label: String,
    ids: BTreeSet<i64>,
    stock: i64,
    cats: BTreeMap<i64, Vec<i64>>,
}

fn phone_index(conn: &Connection) -> SqlResult<HashMap<String, Idx>> {
    let mut idx: HashMap<String, Idx> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(brand,''), COALESCE(compatibility,''), COALESCE(stock,0),
                COALESCE(category_id,0)
         FROM products WHERE COALESCE(compatibility,'') NOT IN ('','[]')",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
        ))
    })?;
    for row in rows {
        let (id, brand, compat, stock, cat) = row?;
        for (_, phone) in compat_phones_raw(&compat, &brand) {
            let key = phone_registry_key(&phone);
            let e = idx.entry(key).or_insert_with(|| Idx {
                brand: phone.brand.clone(),
                label: phone.label.clone(),
                ids: BTreeSet::new(),
                stock: 0,
                cats: BTreeMap::new(),
            });
            if e.ids.insert(id) {
                e.stock += stock;
            }
            let list = e.cats.entry(cat).or_default();
            if !list.contains(&id) {
                list.push(id);
            }
        }
    }
    Ok(idx)
}

/// Repuestos de un teléfono: une la clave actual con las claves de sus ALIAS, así
/// al RENOMBRAR (o fusionar) el teléfono no pierde sus repuestos.
fn merged_stats(
    idx: &HashMap<String, Idx>,
    key: &str,
    aliases: &[String],
    brand: &str,
    cats: &HashMap<i64, String>,
) -> (i64, i64, String, Vec<(i64, Vec<i64>)>) {
    let mut set: BTreeSet<String> = BTreeSet::new();
    set.insert(key.to_string());
    for a in aliases {
        let phone = crate::catalog::canonical_phone(a, brand);
        set.insert(phone_registry_key(&phone));
    }
    let mut ids: BTreeSet<i64> = BTreeSet::new();
    let mut stock = 0i64;
    let mut by_cat: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
    for k in &set {
        if let Some(i) = idx.get(k) {
            for id in &i.ids {
                if ids.insert(*id) {
                    stock += 0; // el stock se suma abajo, por producto una sola vez
                }
            }
            for (cat, list) in &i.cats {
                let e = by_cat.entry(*cat).or_default();
                for id in list {
                    if !e.contains(id) {
                        e.push(*id);
                    }
                }
            }
        }
    }
    // stock real: por producto distinto
    for list in by_cat.values() {
        for id in list {
            if let Some(i) = idx.values().find(|i| i.ids.contains(id)) {
                let _ = i;
            }
        }
    }
    for k in &set {
        if let Some(i) = idx.get(k) {
            stock += i.stock;
            break; // el stock del teléfono viene de su clave canonica
        }
    }
    let mut names: Vec<String> = by_cat.keys().filter_map(|c| cats.get(c).cloned()).collect();
    names.sort();
    (ids.len() as i64, stock, names.join(", "), by_cat.into_iter().collect())
}
fn category_names(conn: &Connection) -> SqlResult<HashMap<i64, String>> {
    let mut out = HashMap::new();
    let mut stmt = conn.prepare("SELECT id, name FROM categories")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, name) = row?;
        out.insert(id, name);
    }
    Ok(out)
}

fn parse_aliases(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(json).unwrap_or_default()
}

/// Marcas del padrón con su conteo (índice de marcas, estilo catálogo).
pub fn get_phone_brands(conn: &Connection) -> SqlResult<Vec<PhoneBrandRow>> {
    let idx = phone_index(conn)?;
    let mut stmt = conn.prepare("SELECT COALESCE(brand,''), COALESCE(key,'') FROM phones")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map: BTreeMap<String, PhoneBrandRow> = BTreeMap::new();
    for row in rows {
        let (brand, key) = row?;
        let e = map.entry(brand.clone()).or_insert_with(|| PhoneBrandRow {
            brand,
            ..Default::default()
        });
        e.phones += 1;
        if let Some(i) = idx.get(&key) {
            if !i.ids.is_empty() {
                e.with_products += 1;
            }
            if i.stock > 0 {
                e.with_stock += 1;
            }
        }
    }
    Ok(map.into_values().collect())
}

/// Lista de teléfonos con filtros y orden (el orden lo elige la UI: 3 estados).
pub fn get_phones(
    conn: &Connection,
    brand: Option<&str>,
    search: &str,
    only_with_products: bool,
    only_stock: bool,
    sort: &str,
    dir: &str,
    limit: i64,
    offset: i64,
) -> SqlResult<PhonePage> {
    let idx = phone_index(conn)?;
    let cats = category_names(conn)?;
    let tokens = crate::catalog::search_tokens(search);

    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(brand,''), COALESCE(line,''), COALESCE(model,''), COALESCE(name,''),
                COALESCE(key,''), COALESCE(needs_review,0), COALESCE(aliases,'[]')
         FROM phones",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, i64>(6)?,
            r.get::<_, String>(7)?,
        ))
    })?;

    let mut items: Vec<PhoneListRow> = Vec::new();
    for row in rows {
        let (id, brand_row, line, model, name, key, needs_review, aliases) = row?;
        if let Some(b) = brand {
            if !b.trim().is_empty() && !brand_row.eq_ignore_ascii_case(b.trim()) {
                continue;
            }
        }
        if !tokens.is_empty() {
            let hay = crate::catalog::norm(&format!("{brand_row} {name} {model} {}", aliases));
            if !tokens.iter().all(|t| hay.contains(t)) {
                continue;
            }
        }
        let aliases_vec = parse_aliases(&aliases);
        let (products, stock, cats_txt, _) = merged_stats(&idx, &key, &aliases_vec, &brand_row, &cats);
        if only_with_products && products == 0 {
            continue;
        }
        if only_stock && stock <= 0 {
            continue;
        }
        items.push(PhoneListRow {
            id,
            brand: brand_row,
            line,
            model,
            name,
            needs_review: needs_review != 0,
            aliases: parse_aliases(&aliases),
            products,
            stock,
            categories: cats_txt,
        });
    }

    let desc = !dir.eq_ignore_ascii_case("asc");
    match sort {
        "marca" => items.sort_by(|a, b| a.brand.to_lowercase().cmp(&b.brand.to_lowercase()).then(a.name.cmp(&b.name))),
        "repuestos" => items.sort_by(|a, b| a.products.cmp(&b.products).then(a.name.cmp(&b.name))),
        "stock" => items.sort_by(|a, b| a.stock.cmp(&b.stock).then(a.name.cmp(&b.name))),
        "revisar" => items.sort_by(|a, b| a.needs_review.cmp(&b.needs_review).then(a.name.cmp(&b.name))),
        _ => items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
    }
    if desc && matches!(sort, "repuestos" | "stock" | "revisar") {
        items.reverse();
    }

    let total = items.len() as i64;
    let start = offset.max(0) as usize;
    let end = if limit > 0 { (start + limit as usize).min(items.len()) } else { items.len() };
    let page = if start < items.len() { items[start..end].to_vec() } else { Vec::new() };
    Ok(PhonePage { items: page, total })
}

/// Ficha del teléfono: sus repuestos AGRUPADOS POR CATEGORÍA (Pantalla primero).
pub fn get_phone_detail(conn: &Connection, phone_id: i64) -> SqlResult<Option<PhoneDetail>> {
    let idx = phone_index(conn)?;
    let cats = category_names(conn)?;
    let row = conn
        .query_row(
            "SELECT id, COALESCE(brand,''), COALESCE(line,''), COALESCE(model,''), COALESCE(name,''),
                    COALESCE(key,''), COALESCE(needs_review,0), COALESCE(aliases,'[]')
             FROM phones WHERE id=?1",
            params![phone_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, String>(7)?,
                ))
            },
        )
        .ok();

    let Some((id, brand, line, model, name, key, needs_review, aliases)) = row else {
        return Ok(None);
    };

    let entry = idx.get(&key);
    let aliases_vec2 = parse_aliases(&aliases);
    let (_, nstock, _, by_cat) = merged_stats(&idx, &key, &aliases_vec2, &brand, &cats);
    let mut blocks: Vec<PhoneCategoryBlock> = Vec::new();
    if let Some(i) = entry {
        let mut cat_ids: Vec<i64> = i.cats.keys().copied().collect();
        // Pantalla (1) primero; el resto por nombre
        cat_ids.sort_by_key(|c| (if *c == 1 { 0 } else { 1 }, cats.get(c).cloned().unwrap_or_default()));
        for cid in cat_ids {
            let ids = by_cat.iter().find(|(c, _)| *c == cid).map(|(_, l)| l.clone()).unwrap_or_default();
            let mut items: Vec<crate::db::Product> = Vec::new();
            for pid in ids {
                if let Ok(p) = conn.query_row(
                    "SELECT p.*, c.name as category_name FROM products p
                     LEFT JOIN categories c ON c.id = p.category_id WHERE p.id=?1",
                    params![pid],
                    |r| {
                        Ok(crate::db::Product {
                            id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?, brand: r.get(3)?,
                            model: r.get(4)?, variant: r.get(5)?, compatibility: r.get(6)?,
                            price_cost: r.get(7)?, price_sale: r.get(8)?, stock: r.get(9)?,
                            min_stock: r.get(10)?, created_at: r.get(11)?, updated_at: r.get(12)?,
                            category_name: r.get(14)?, price_usd: r.get(13)?,
                        })
                    },
                ) {
                    items.push(p);
                }
            }
            items.sort_by(|a, b| b.stock.cmp(&a.stock).then(a.name.cmp(&b.name)));
            blocks.push(PhoneCategoryBlock {
                category_id: cid,
                category: cats.get(&cid).cloned().unwrap_or_else(|| "(sin categoría)".to_string()),
                items,
            });
        }
    }

    let products = blocks.iter().map(|b| b.items.len() as i64).sum();
    Ok(Some(PhoneDetail {
        phone: PhoneListRow {
            id,
            brand,
            line,
            model,
            name,
            needs_review: needs_review != 0,
            aliases: parse_aliases(&aliases),
            products,
            stock: nstock,
            categories: blocks.iter().map(|b| b.category.clone()).collect::<Vec<_>>().join(", "),
        },
        blocks,
    }))
}

/// Renombra un teléfono del padrón (marca / línea / modelo). Recalcula nombre y clave.
/// Si la clave nueva ya existe → error con el nombre del que ya está (para fusionarlos).
pub fn rename_phone(conn: &Connection, id: i64, brand: &str, line: &str, model: &str) -> SqlResult<()> {
    let brand = crate::catalog::canonical_brand(brand.trim());
    let model = crate::catalog::canonical_model(model.trim(), &brand);
    let line = line.trim().to_string();
    let display = if line.is_empty() { model.clone() } else { format!("{line} {model}") };
    let key = crate::catalog::registry_key(&brand, &model);
    let clash: Option<String> = conn
        .query_row(
            "SELECT name FROM phones WHERE key=?1 AND id<>?2",
            params![key, id],
            |r| r.get(0),
        )
        .ok();
    if let Some(other) = clash {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::ErrorCode::ConstraintViolation as i32),
            Some(format!("Ya existe «{other}». Úsalos como el mismo teléfono (fusionar) o cambia el modelo.")),
        ));
    }
    conn.execute(
        "UPDATE phones SET brand=?1, line=?2, model=?3, name=?4, key=?5, source='manual',
                          needs_review=0, updated_at=datetime('now','localtime')
         WHERE id=?6",
        params![brand, line, model, display, key, id],
    )?;
    Ok(())
}

/// Agrega un teléfono que no tenía repuesto en el inventario (padrón manual).
pub fn add_phone(conn: &Connection, brand: &str, line: &str, model: &str) -> SqlResult<i64> {
    let brand = crate::catalog::canonical_brand(brand.trim());
    let model = crate::catalog::canonical_model(model.trim(), &brand);
    let line = line.trim().to_string();
    let display = if line.is_empty() { model.clone() } else { format!("{line} {model}") };
    let key = crate::catalog::registry_key(&brand, &model);
    conn.execute(
        "INSERT INTO phones (brand, line, model, name, key, aliases, source, needs_review)
         VALUES (?1,?2,?3,?4,?5,'[]','manual',0)",
        params![brand, line, model, display, key],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Fusiona dos teléfonos del padrón (mismo teléfono escrito distinto): junta alias
/// y borra el duplicado. Los repuestos NO se tocan (se relacionan por compatibilidad).
pub fn merge_phones(conn: &Connection, keep_id: i64, remove_id: i64) -> SqlResult<()> {
    if keep_id == remove_id {
        return Ok(());
    }
    let keep_aliases: String = conn
        .query_row("SELECT COALESCE(aliases,'[]') FROM phones WHERE id=?1", params![keep_id], |r| r.get(0))
        .unwrap_or_else(|_| "[]".to_string());
    let remove_aliases: String = conn
        .query_row("SELECT COALESCE(aliases,'[]') FROM phones WHERE id=?1", params![remove_id], |r| r.get(0))
        .unwrap_or_else(|_| "[]".to_string());
    let mut set: BTreeSet<String> = parse_aliases(&keep_aliases).into_iter().collect();
    for a in parse_aliases(&remove_aliases) {
        set.insert(a);
    }
    let merged = serde_json::to_string(&set.into_iter().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string());
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE phones SET aliases=?1 WHERE id=?2", params![merged, keep_id])?;
    tx.execute("DELETE FROM phones WHERE id=?1", params![remove_id])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::path::PathBuf;

    fn setup(name: &str) -> (Database, PathBuf) {
        let path = PathBuf::from(name);
        let _ = std::fs::remove_file(&path);
        let db = Database::new(&path).expect("test db");
        db.add_product("Pantalla Tecno Spark 20", Some(1), "Tecno", "Spark 20", "", r#"["Tecno Spark 20"]"#, 0.0, 0.0, 3, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung Galaxy A06", Some(1), "Samsung", "A06", "", r#"["Samsung A06","Galaxy A06"]"#, 0.0, 0.0, 2, 0, 0.0).unwrap();
        (db, path)
    }

    #[test]
    fn test_phone_list_brands_and_detail() {
        let (db, path) = setup("test_phones_list.db");
        let conn = db.conn.lock().unwrap();

        let brands = get_phone_brands(&conn).unwrap();
        assert!(brands.iter().any(|b| b.brand == "Tecno" && b.phones >= 1), "marcas: {:?}", brands);
        assert!(brands.iter().any(|b| b.brand == "Samsung" && b.with_stock == 1));

        let page = get_phones(&conn, Some("Samsung"), "", false, false, "nombre", "asc", 50, 0).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].name, "Galaxy A06", "nombre comercial con la línea");
        assert_eq!(page.items[0].products, 1);
        assert_eq!(page.items[0].stock, 2);
        assert_eq!(page.items[0].categories, "Pantalla");

        let detail = get_phone_detail(&conn, page.items[0].id).unwrap().unwrap();
        assert_eq!(detail.blocks.len(), 1);
        assert_eq!(detail.blocks[0].category, "Pantalla");
        assert_eq!(detail.blocks[0].items.len(), 1);
        assert_eq!(detail.blocks[0].items[0].name, "Pantalla Samsung Galaxy A06");

        // orden por stock descendente (los 3 estados los maneja la UI con sort+dir)
        let by_stock = get_phones(&conn, None, "", false, false, "stock", "desc", 50, 0).unwrap();
        assert!(by_stock.items[0].stock >= by_stock.items[1].stock);

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_rename_add_and_merge_phones() {
        let (db, path) = setup("test_phones_rename.db");
        let conn = db.conn.lock().unwrap();
        let page = get_phones(&conn, Some("Tecno"), "", false, false, "nombre", "asc", 10, 0).unwrap();
        let id = page.items[0].id;

        rename_phone(&conn, id, "Tecno", "Spark", "20 Pro").unwrap();
        let after = get_phones(&conn, Some("Tecno"), "", false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(after.items[0].name, "Spark 20 Pro");
        // sigue apuntando a su repuesto por los alias
        assert_eq!(after.items[0].products, 1);

        // chocar con otro teléfono → error claro
        let samsung = get_phones(&conn, Some("Samsung"), "", false, false, "nombre", "asc", 10, 0).unwrap();
        let err = rename_phone(&conn, samsung.items[0].id, "Tecno", "Spark", "20 Pro").unwrap_err();
        assert!(format!("{err}").contains("Ya existe"), "error: {err}");

        let manual = add_phone(&conn, "Nokia", "", "110").unwrap();
        assert!(manual > 0);
        let all = get_phones(&conn, Some("Nokia"), "", false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(all.total, 1);
        assert_eq!(all.items[0].products, 0, "sin repuesto todavía (padrón completo)");

        merge_phones(&conn, id, manual).unwrap();
        let merged = get_phones(&conn, None, "Nokia", false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(merged.total, 0, "el teléfono fusionado desaparece");

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
