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
    /// teléfonos sin familia comercial detectada (los que hay que revisar)
    pub needs_review: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhoneListRow {
    pub id: i64,
    pub brand: String,
    pub line: String,
    pub model: String,
    pub name: String,
    /// clave interna del padrón (marca + modelo sin línea, normalizados). NO se muestra
    /// en la UI: la usa el backend para saber si dos teléfonos son el mismo.
    pub key: String,
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

/// Índice teléfono -> (ids de producto, stock de cada uno, categorías).
/// (La marca y la etiqueta salen de la fila del padrón, no del índice.)
struct Idx {
    ids: BTreeSet<i64>,
    stock_by_id: BTreeMap<i64, i64>,
    cats: BTreeMap<i64, Vec<i64>>,
}

impl Idx {
    fn stock_of(&self, product_id: i64) -> i64 {
        self.stock_by_id.get(&product_id).copied().unwrap_or(0)
    }
}

fn phone_index(conn: &Connection) -> SqlResult<HashMap<String, Idx>> {
    let mut idx: HashMap<String, Idx> = HashMap::new();
    // Regla del local: el padrón (y lo que cuenta cada teléfono) sale de las categorías de
    // pantalla — `catalog::PHONE_CATEGORIES` (Pantalla + Táctil + Táctil Tablet).
    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(brand,''), COALESCE(compatibility,''), COALESCE(stock,0),
                COALESCE(category_id,0)
         FROM products
         WHERE COALESCE(compatibility,'') NOT IN ('','[]')
           AND COALESCE(category_id,0) IN (SELECT value FROM json_each(?1))",
    )?;
    let cats_json = serde_json::to_string(crate::catalog::PHONE_CATEGORIES).unwrap_or_else(|_| "[1]".to_string());
    let rows = stmt.query_map(params![cats_json], |r| {
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
                ids: BTreeSet::new(),
                stock_by_id: BTreeMap::new(),
                cats: BTreeMap::new(),
            });
            e.ids.insert(id);
            e.stock_by_id.insert(id, stock);
            let list = e.cats.entry(cat).or_default();
            if !list.contains(&id) {
                list.push(id);
            }
        }
    }
    Ok(idx)
}

/// Repuestos de un teléfono: une la clave actual con las claves de sus ALIAS, así
/// al RENOMBRAR (o fusionar) el teléfono no pierde sus repuestos. Devuelve
/// `(repuestos, stock, "Pantalla, Táctil", repuestos por categoría)`.
///
/// OJO (bug corregido 2026-09-16): las categorías y el stock salen de la MISMA
/// unión (clave + alias) que la lista de repuestos. Antes la ficha miraba solo la
/// clave canónica: tras renombrar un teléfono (`rename_phone` cambia la clave y
/// conserva los alias del inventario) quedaba vacía mientras el stock decía otra cosa.
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
    // Unión por ID de producto: el mismo repuesto puede aparecer en la clave actual
    // y en un alias (tras renombrar) y debe contar UNA sola vez.
    let mut stock_by_id: BTreeMap<i64, i64> = BTreeMap::new();
    let mut by_cat: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
    for k in &set {
        let Some(i) = idx.get(k) else { continue };
        for id in &i.ids {
            stock_by_id.entry(*id).or_insert_with(|| i.stock_of(*id));
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
    let products = stock_by_id.len() as i64;
    let stock: i64 = stock_by_id.values().sum();
    let mut names: Vec<String> = by_cat.keys().filter_map(|c| cats.get(c).cloned()).collect();
    names.sort();
    (products, stock, names.join(", "), by_cat.into_iter().collect())
}
pub(crate) fn category_names(conn: &Connection) -> SqlResult<HashMap<i64, String>> {
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

/// Repuestos y stock de TODOS los teléfonos del padrón en una sola pasada (clave + alias):
/// es el mismo cálculo que usa la pestaña Modelos, para que los números del formulario de
/// servicio y de la tabla no puedan divergir. Devuelve `clave -> (repuestos, stock)`.
pub fn phone_totals_map(conn: &Connection) -> SqlResult<HashMap<String, (i64, i64)>> {
    let idx = phone_index(conn)?;
    let cats = category_names(conn)?;
    let mut out: HashMap<String, (i64, i64)> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT COALESCE(key,''), COALESCE(aliases,'[]'), COALESCE(brand,'') FROM phones",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (key, aliases, brand) = row?;
        let (products, stock, _, _) = merged_stats(&idx, &key, &parse_aliases(&aliases), &brand, &cats);
        out.insert(key, (products, stock));
    }
    Ok(out)
}

/// Alias (cómo está escrito en el INVENTARIO) del teléfono del padrón que corresponde a un
/// texto libre: su nombre comercial, su modelo, su clave o cualquiera de sus alias. Lo usa
/// el servicio para encontrar los repuestos AUNQUE el taller haya renombrado el teléfono
/// (el vínculo con el inventario son justamente los alias).
pub fn lookup_aliases(conn: &Connection, text: &str) -> SqlResult<Vec<String>> {
    let target = crate::catalog::norm(text);
    if target.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT COALESCE(name,''), COALESCE(model,''), COALESCE(brand,''), COALESCE(key,''),
                COALESCE(aliases,'[]')
         FROM phones",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    let mut out: Vec<String> = Vec::new();
    for row in rows {
        let (name, model, brand, key, aliases_json) = row?;
        let aliases = parse_aliases(&aliases_json);
        let hit = crate::catalog::norm(&name) == target
            || crate::catalog::norm(&model) == target
            || key == target
            || crate::catalog::norm(&format!("{brand} {model}")) == target
            || aliases.iter().any(|a| crate::catalog::norm(a) == target);
        if hit {
            out.push(name.clone());
            if !model.is_empty() {
                out.push(model);
            }
            out.extend(aliases);
        }
    }
    out.retain(|s| !s.trim().is_empty());
    out.sort();
    out.dedup();
    Ok(out)
}

/// Marcas del padrón con su conteo (índice de marcas, estilo catálogo).
pub fn get_phone_brands(conn: &Connection) -> SqlResult<Vec<PhoneBrandRow>> {
    let idx = phone_index(conn)?;
    let cats = category_names(conn)?;
    let mut stmt = conn.prepare(
        "SELECT COALESCE(brand,''), COALESCE(key,''), COALESCE(needs_review,0), COALESCE(aliases,'[]')
         FROM phones",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut map: BTreeMap<String, PhoneBrandRow> = BTreeMap::new();
    for row in rows {
        let (brand, key, needs_review, aliases_json) = row?;
        let e = map.entry(brand.clone()).or_insert_with(|| PhoneBrandRow {
            brand: brand.clone(),
            ..Default::default()
        });
        e.phones += 1;
        if needs_review != 0 {
            e.needs_review += 1;
        }
        // Mismos números que la lista: clave + alias (un teléfono renombrado conserva
        // sus repuestos por los alias del inventario).
        let (products, stock, _, _) = merged_stats(
            &idx,
            &key,
            &parse_aliases(&aliases_json),
            &brand,
            &cats,
        );
        if products > 0 {
            e.with_products += 1;
        }
        if stock > 0 {
            e.with_stock += 1;
        }
    }
    Ok(map.into_values().collect())
}

/// Lista de teléfonos con filtros y orden (el orden lo elige la UI: 3 estados).
/// `sort` elige la columna y `dir` ("asc"/"desc") su sentido: TODAS las columnas
/// respetan el sentido (antes solo 3 lo hacían, con un `reverse()` que además
/// invertía el desempate por nombre).
#[allow(clippy::too_many_arguments)]
pub fn get_phones(
    conn: &Connection,
    brand: Option<&str>,
    search: &str,
    only_with_products: bool,
    only_stock: bool,
    only_review: bool,
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
        let review = needs_review != 0;
        if only_review && !review {
            continue;
        }
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
            key: key.clone(),
            needs_review: review,
            aliases: parse_aliases(&aliases),
            products,
            stock,
            categories: cats_txt,
        });
    }

    // El sentido elegido manda sobre la clave primaria de la columna; el nombre
    // queda SIEMPRE como desempate ascendente y el id cierra el empate (la consulta
    // no trae ORDER BY, así que sin él el orden de las filas iguales sería arbitrario).
    // Las claves de orden se calculan UNA vez por fila (sin `to_lowercase()` en cada
    // comparación) con `catalog::norm`, que además ignora acentos (Ñ/É ordenan con N/E).
    let desc = dir.eq_ignore_ascii_case("desc");
    let dir_ord = |o: std::cmp::Ordering| if desc { o.reverse() } else { o };
    let mut keyed: Vec<(String, String, PhoneListRow)> = items
        .into_iter()
        .map(|p| (crate::catalog::norm(&p.brand), crate::catalog::norm(&p.name), p))
        .collect();
    match sort {
        "marca" => keyed.sort_by(|a, b| dir_ord(a.0.cmp(&b.0)).then(a.1.cmp(&b.1)).then(a.2.id.cmp(&b.2.id))),
        "repuestos" => keyed.sort_by(|a, b| dir_ord(a.2.products.cmp(&b.2.products)).then(a.1.cmp(&b.1)).then(a.2.id.cmp(&b.2.id))),
        "stock" => keyed.sort_by(|a, b| dir_ord(a.2.stock.cmp(&b.2.stock)).then(a.1.cmp(&b.1)).then(a.2.id.cmp(&b.2.id))),
        "revisar" => keyed.sort_by(|a, b| dir_ord(a.2.needs_review.cmp(&b.2.needs_review)).then(a.1.cmp(&b.1)).then(a.2.id.cmp(&b.2.id))),
        _ => keyed.sort_by(|a, b| dir_ord(a.1.cmp(&b.1)).then(a.2.id.cmp(&b.2.id))),
    }
    let items: Vec<PhoneListRow> = keyed.into_iter().map(|(_, _, p)| p).collect();

    let total = items.len() as i64;
    // El comando no valida nada por su cuenta: se acota aquí para que un `limit`
    // absurdo no desborde `start + limit` (panic del slice) — regla de hardening.
    let limit = limit.clamp(0, 1000);
    let start = offset.max(0) as usize;
    let end = if limit > 0 { start.saturating_add(limit as usize).min(items.len()) } else { items.len() };
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

    // Las categorías y los repuestos salen de la MISMA unión (clave + alias) que
    // devuelve `merged_stats`: así la ficha no se contradice con el stock y sigue
    // funcionando después de RENOMBRAR el teléfono (la clave cambia, los alias no).
    let aliases_vec2 = parse_aliases(&aliases);
    let (nproducts, nstock, cats_txt, by_cat) = merged_stats(&idx, &key, &aliases_vec2, &brand, &cats);
    let mut cat_ids: Vec<i64> = by_cat.iter().map(|(c, _)| *c).collect();
    // Pantalla (1) primero; el resto por nombre
    cat_ids.sort_by_key(|c| (if *c == 1 { 0 } else { 1 }, cats.get(c).cloned().unwrap_or_default()));
    let mut blocks: Vec<PhoneCategoryBlock> = Vec::new();
    for cid in cat_ids {
        let ids = by_cat.iter().find(|(c, _)| *c == cid).map(|(_, l)| l.clone()).unwrap_or_default();
        let mut items: Vec<crate::db::Product> = Vec::new();
        for pid in ids {
            if let Ok(p) = conn.query_row(
                // Lista EXPLÍCITA de columnas: `p.*` cambia de orden cuando una
                // migración hace ALTER TABLE (search_text quedó en 14) y el mapeo
                // posicional leería la columna equivocada (regla del proyecto).
                "SELECT p.id, p.name, p.category_id, p.brand, p.model, p.variant, p.compatibility,
                        p.price_cost, p.price_sale, p.stock, p.min_stock, p.created_at, p.updated_at,
                        p.price_usd, c.name as category_name
                 FROM products p LEFT JOIN categories c ON c.id = p.category_id
                 WHERE p.id=?1",
                params![pid],
                |r| {
                    Ok(crate::db::Product {
                        id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?, brand: r.get(3)?,
                        model: r.get(4)?, variant: r.get(5)?, compatibility: r.get(6)?,
                        price_cost: r.get(7)?, price_sale: r.get(8)?, stock: r.get(9)?,
                        min_stock: r.get(10)?, created_at: r.get(11)?, updated_at: r.get(12)?,
                        price_usd: r.get(13)?, category_name: r.get(14)?,
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

    Ok(Some(PhoneDetail {
        phone: PhoneListRow {
            id,
            brand,
            line,
            model,
            name,
            key,
            needs_review: needs_review != 0,
            aliases: parse_aliases(&aliases),
            products: nproducts,
            stock: nstock,
            categories: cats_txt,
        },
        blocks,
    }))
}

/// Naming resuelto de un teléfono escrito a mano (marca / línea / modelo).
struct PhoneNaming {
    brand: String,
    line: String,
    model: String,
    name: String,
    key: String,
}

/// Lo que el taller escribe (marca + línea + modelo) pasado por las MISMAS reglas del
/// padrón: UNA sola forma de calcular nombre, modelo y clave. Si la clave se calculara
/// distinto que en `rebuild_phones`, al renombrar la fila no coincidiría con el catálogo
/// y el nombre viejo volvería a aparecer (hallazgo del re-verificador de F3).
///
/// `name` es el nombre comercial («Poco X3», «Galaxy A06») y `model` el modelo sin la línea.
fn resolve_naming(brand: &str, line: &str, model: &str) -> PhoneNaming {
    let brand = crate::catalog::canonical_brand(brand.trim());
    let line_in = line.trim();
    let model_in = crate::catalog::canonical_model(model.trim(), &brand);
    // tal como lo escribiría el inventario: con la línea delante si la hay
    let written = if line_in.is_empty() { model_in.clone() } else { format!("{line_in} {model_in}") };
    let (line_out, name) = crate::catalog::real_name(&brand, &written);
    let key = crate::catalog::phone_registry_key(&crate::catalog::Phone {
        brand: brand.clone(),
        model: written.clone(),
        label: name.clone(),
    });
    let model_out = crate::catalog::model_without_line(&written, &line_out);
    PhoneNaming { brand, line: line_out, model: model_out, name, key }
}

/// Renombra un teléfono del padrón (marca / línea / modelo). Recalcula nombre y clave con
/// las reglas del padrón, marca la fila como `manual` (el taller decide, no se pisa sola) y
/// guarda el nombre/marca+modelo VIEJOS como alias: así la clave vieja queda reclamada
/// (aunque cambie la marca) y el catálogo no vuelve a crear la ficha que se corrigió.
/// Si la clave nueva ya existe → error con el nombre del que ya está (para fusionarlos).
pub fn rename_phone(conn: &Connection, id: i64, brand: &str, line: &str, model: &str) -> SqlResult<()> {
    let n = resolve_naming(brand, line, model);
    let (brand, line, model, display, key) = (n.brand, n.line, n.model, n.name, n.key);
    // datos ACTUALES (para conservar el vínculo con el inventario al cambiar de nombre)
    let current: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT COALESCE(brand,''), COALESCE(model,''), COALESCE(name,''), COALESCE(aliases,'[]')
             FROM phones WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();
    let Some((old_brand, old_model, old_name, old_aliases)) = current else {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::ErrorCode::ConstraintViolation as i32),
            Some("Ese teléfono ya no está en la lista (¿se fusionó o se borró?): actualizá la tabla.".to_string()),
        ));
    };
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
    let mut set: BTreeSet<String> = parse_aliases(&old_aliases).into_iter().collect();
    if !old_name.trim().is_empty() {
        set.insert(old_name.clone());
    }
    if !old_model.trim().is_empty() {
        set.insert(format!("{old_brand} {old_model}").trim().to_string());
        set.insert(old_model.clone());
    }
    let aliases_json = serde_json::to_string(&set.into_iter().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "UPDATE phones SET brand=?1, line=?2, model=?3, name=?4, key=?5, aliases=?7, source='manual',
                          needs_review=0, updated_at=datetime('now','localtime')
         WHERE id=?6",
        params![brand, line, model, display, key, id, aliases_json],
    )?;
    Ok(())
}

/// Agrega un teléfono que no tenía repuesto en el inventario (padrón manual).
pub fn add_phone(conn: &Connection, brand: &str, line: &str, model: &str) -> SqlResult<i64> {
    let n = resolve_naming(brand, line, model);
    let clash: Option<String> = conn
        .query_row("SELECT name FROM phones WHERE key=?1", params![n.key], |r| r.get(0))
        .ok();
    if let Some(other) = clash {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::ErrorCode::ConstraintViolation as i32),
            Some(format!("Ya existe «{other}». Si es el mismo teléfono, fusiónalos.")),
        ));
    }
    conn.execute(
        "INSERT INTO phones (brand, line, model, name, key, aliases, source, needs_review)
         VALUES (?1,?2,?3,?4,?5,'[]','manual',0)",
        params![n.brand, n.line, n.model, n.name, n.key],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Lo que va a pasar si se renombra el teléfono — para que la UI lo muestre ANTES de
/// guardar: nombre resultante, clave, si choca con otro teléfono y cuántos repuestos
/// conserva (los alias del inventario son el vínculo con los repuestos).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RenamePreview {
    pub name: String,
    pub brand: String,
    pub line: String,
    pub model: String,
    pub key: String,
    /// nombre del teléfono que YA tiene esa clave (para ofrecer fusionar)
    pub clash: Option<String>,
    pub products: i64,
    pub stock: i64,
}

pub fn preview_rename_phone(
    conn: &Connection,
    id: i64,
    brand: &str,
    line: &str,
    model: &str,
) -> SqlResult<Option<RenamePreview>> {
    let aliases: String = match conn
        .query_row("SELECT COALESCE(aliases,'[]') FROM phones WHERE id=?1", params![id], |r| r.get(0))
        .ok()
    {
        Some(v) => v,
        None => return Ok(None),
    };
    let n = resolve_naming(brand, line, model);
    let clash: Option<String> = conn
        .query_row(
            "SELECT name FROM phones WHERE key=?1 AND id<>?2",
            params![n.key, id],
            |r| r.get(0),
        )
        .ok();
    let idx = phone_index(conn)?;
    let cats = category_names(conn)?;
    // los repuestos se cuentan con la clave NUEVA + los alias que ya tenía el teléfono
    let (products, stock, _, _) = merged_stats(&idx, &n.key, &parse_aliases(&aliases), &n.brand, &cats);
    Ok(Some(RenamePreview {
        name: n.name,
        brand: n.brand,
        line: n.line,
        model: n.model,
        key: n.key,
        clash,
        products,
        stock,
    }))
}

/// Fusiona dos teléfonos del padrón (mismo teléfono escrito distinto): junta alias
/// (los del borrado + SU CLAVE y SU MODELO, para que el catálogo no vuelva a crear la
/// fila del nombre viejo) y borra el duplicado. Los repuestos NO se tocan (se relacionan
/// por compatibilidad), así que el que queda hereda los del otro vía alias.
pub fn merge_phones(conn: &Connection, keep_id: i64, remove_id: i64) -> SqlResult<()> {
    if keep_id == remove_id {
        return Ok(());
    }
    // las dos fichas tienen que existir: si no, se borraría una y se perderían sus alias
    let keep_aliases: Option<String> = conn
        .query_row("SELECT COALESCE(aliases,'[]') FROM phones WHERE id=?1", params![keep_id], |r| r.get(0))
        .ok();
    let Some(keep_aliases) = keep_aliases else {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::ErrorCode::ConstraintViolation as i32),
            Some("El teléfono que se queda ya no está en la lista: actualizá la tabla y volvé a intentar.".to_string()),
        ));
    };
    let remove: Option<(String, String, String)> = conn
        .query_row(
            "SELECT COALESCE(aliases,'[]'), COALESCE(model,''), COALESCE(brand,'') FROM phones WHERE id=?1",
            params![remove_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    let Some((remove_aliases, remove_model, remove_brand)) = remove else {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::ErrorCode::ConstraintViolation as i32),
            Some("El teléfono que se quería juntar ya no está en la lista: actualizá la tabla.".to_string()),
        ));
    };
    let mut set: BTreeSet<String> = parse_aliases(&keep_aliases).into_iter().collect();
    for a in parse_aliases(&remove_aliases) {
        set.insert(a);
    }
    if !remove_model.trim().is_empty() {
        set.insert(format!("{} {}", remove_brand, remove_model).trim().to_string());
        set.insert(remove_model.clone());
    }
    let merged = serde_json::to_string(&set.into_iter().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string());
    let tx = conn.unchecked_transaction()?;
    // La que queda pasa a ser MANUAL: la fusión es una decisión del taller, y sus alias
    // (los del borrado incluidos) son los que reclaman la clave vieja para que el catálogo
    // no vuelva a crear la ficha del nombre que se acaba de juntar.
    tx.execute(
        "UPDATE phones SET aliases=?1, source='manual', needs_review=0,
                           updated_at=datetime('now','localtime')
         WHERE id=?2",
        params![merged, keep_id],
    )?;
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
        // Nombre por PROCESO: dos `cargo test` en paralelo compartían los mismos
        // archivos y se pisaban (fallos falsos).
        let path = std::env::temp_dir().join(format!("registro_{}_{}.db", name, std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Database::new(&path).expect("test db");
        db.add_product("Pantalla Tecno Spark 20", Some(1), "Tecno", "Spark 20", "", r#"["Tecno Spark 20"]"#, 0.0, 0.0, 3, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung Galaxy A06", Some(1), "Samsung", "A06", "", r#"["Samsung A06","Galaxy A06"]"#, 0.0, 0.0, 2, 0, 0.0).unwrap();
        // ZTE A3: sin familia y nombre corto → el padrón lo marca "por revisar"
        db.add_product("Pantalla ZTE A3", Some(1), "ZTE", "A3", "", r#"["ZTE A3"]"#, 0.0, 0.0, 0, 0, 0.0).unwrap();
        (db, path)
    }

    #[test]
    fn test_phone_list_brands_and_detail() {
        let (db, path) = setup("test_phones_list.db");
        let conn = db.conn.lock().unwrap();

        let brands = get_phone_brands(&conn).unwrap();
        assert!(brands.iter().any(|b| b.brand == "Tecno" && b.phones >= 1), "marcas: {:?}", brands);
        assert!(brands.iter().any(|b| b.brand == "Samsung" && b.with_stock == 1));
        assert_eq!(
            brands.iter().map(|b| b.needs_review).sum::<i64>(),
            1,
            "solo ZTE A3 nace por revisar: {:?}",
            brands.iter().map(|b| (&b.brand, b.phones, b.needs_review)).collect::<Vec<_>>()
        );
        assert!(brands.iter().any(|b| b.brand == "ZTE" && b.needs_review == 1 && b.with_stock == 0));

        let page = get_phones(&conn, Some("Samsung"), "", false, false, false, "nombre", "asc", 50, 0).unwrap();
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
        let by_stock = get_phones(&conn, None, "", false, false, false, "stock", "desc", 50, 0).unwrap();
        assert!(by_stock.items[0].stock >= by_stock.items[1].stock);

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F3: el sentido (asc/desc) manda en TODAS las columnas y el filtro
    /// «por revisar» recorta exactamente los `needs_review` del padrón.
    #[test]
    fn test_phone_sort_three_states_and_review_filter() {
        let (db, path) = setup("test_phones_sort.db");
        let conn = db.conn.lock().unwrap();
        // teléfono manual (sin repuesto y ya revisado por el taller) → 4 filas
        add_phone(&conn, "Alcatel", "", "1B").unwrap();

        let names = |brand: Option<&str>, sort: &str, dir: &str| {
            get_phones(&conn, brand, "", false, false, false, sort, dir, 50, 0)
                .unwrap()
                .items
                .into_iter()
                .map(|p| p.name)
                .collect::<Vec<_>>()
        };

        // nombre: asc / desc (antes `desc` se ignoraba en esta columna)
        assert_eq!(names(None, "nombre", "asc")[0], "1B");
        assert_eq!(names(None, "nombre", "desc")[0], "Spark 20");
        // marca: asc / desc (antes `desc` se ignoraba; ahora Alcatel ↔ ZTE)
        assert_eq!(names(None, "marca", "asc")[0], "1B", "Alcatel primero");
        assert_eq!(names(None, "marca", "desc")[0], "A3", "ZTE primero");
        // repuestos: desc primero el que más tiene, asc el que menos
        let by_parts_desc = get_phones(&conn, None, "", false, false, false, "repuestos", "desc", 50, 0).unwrap();
        assert_eq!(by_parts_desc.items[0].products, 1);
        assert_eq!(by_parts_desc.items.last().unwrap().products, 0);
        let by_parts_asc = get_phones(&conn, None, "", false, false, false, "repuestos", "asc", 50, 0).unwrap();
        assert_eq!(by_parts_asc.items[0].products, 0, "el manual no tiene repuestos");
        // stock: desc por unidades y asc al revés
        let by_stock = get_phones(&conn, None, "", false, false, false, "stock", "desc", 50, 0).unwrap();
        assert_eq!(by_stock.items[0].name, "Spark 20", "3 unidades");
        assert_eq!(by_stock.items[0].stock, 3);
        let by_stock_asc = get_phones(&conn, None, "", false, false, false, "stock", "asc", 50, 0).unwrap();
        assert_eq!(by_stock_asc.items[0].stock, 0);
        // revisar: desc deja los «por revisar» arriba; asc, abajo
        let review_desc = get_phones(&conn, None, "", false, false, false, "revisar", "desc", 50, 0).unwrap();
        assert!(review_desc.items[0].needs_review, "ZTE A3 arriba");
        assert_eq!(review_desc.items[0].name, "A3");
        let review_asc = get_phones(&conn, None, "", false, false, false, "revisar", "asc", 50, 0).unwrap();
        assert!(!review_asc.items[0].needs_review, "los revisados primero");
        assert_eq!(review_asc.items.last().unwrap().needs_review, true);

        // filtro «por revisar»: solo los needs_review (ZTE A3), no el manual
        let only = get_phones(&conn, None, "", false, false, true, "nombre", "asc", 50, 0).unwrap();
        assert_eq!(only.total, 1, "solo ZTE A3: {:?}", only.items.iter().map(|p| &p.name).collect::<Vec<_>>());
        assert!(only.items.iter().all(|p| p.needs_review));
        // y se combina con el filtro de marca
        let zte = get_phones(&conn, Some("ZTE"), "", false, false, true, "nombre", "asc", 50, 0).unwrap();
        assert_eq!(zte.total, 1);
        let samsung = get_phones(&conn, Some("Samsung"), "", false, false, true, "nombre", "asc", 50, 0).unwrap();
        assert_eq!(samsung.total, 0, "Samsung Galaxy A06 ya tiene familia");
        let alcatel = get_phones(&conn, Some("Alcatel"), "", false, false, true, "nombre", "asc", 50, 0).unwrap();
        assert_eq!(alcatel.total, 0, "el manual no está por revisar");

        // paginación: el total NO cambia, el slice sí
        let page2 = get_phones(&conn, None, "", false, false, false, "nombre", "asc", 2, 2).unwrap();
        assert_eq!(page2.total, 4, "total del padrón completo");
        assert_eq!(page2.items.len(), 2);

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_rename_add_and_merge_phones() {
        let (db, path) = setup("test_phones_rename.db");
        let conn = db.conn.lock().unwrap();
        let page = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        let id = page.items[0].id;

        rename_phone(&conn, id, "Tecno", "Spark", "20 Pro").unwrap();
        let after = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(after.items[0].name, "Spark 20 Pro");
        // sigue apuntando a su repuesto por los alias
        assert_eq!(after.items[0].products, 1);

        // chocar con otro teléfono → error claro
        let samsung = get_phones(&conn, Some("Samsung"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        let err = rename_phone(&conn, samsung.items[0].id, "Tecno", "Spark", "20 Pro").unwrap_err();
        assert!(format!("{err}").contains("Ya existe"), "error: {err}");

        let manual = add_phone(&conn, "Nokia", "", "110").unwrap();
        assert!(manual > 0);
        let all = get_phones(&conn, Some("Nokia"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(all.total, 1);
        assert_eq!(all.items[0].products, 0, "sin repuesto todavía (padrón completo)");
        // el "Nokia 110" escrito a mano se normaliza con las reglas del padrón
        assert_eq!(all.items[0].key, "nokia|110", "clave igual a la del catálogo");

        // fusión: queda UNA fila (el que se queda hereda nombre/modelo del otro como alias,
        // así el taller lo sigue encontrando por como estaba escrito y el catálogo no
        // vuelve a crear la fila vieja)
        merge_phones(&conn, id, manual).unwrap();
        let merged = get_phones(&conn, None, "Nokia", false, false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(merged.total, 1, "una sola fila: la del teléfono que se quedó");
        assert_eq!(merged.items[0].id, id);
        assert_eq!(merged.items[0].name, "Spark 20 Pro");
        assert!(merged.items[0].aliases.iter().any(|a| a.contains("Nokia")), "alias del fusionado: {:?}", merged.items[0].aliases);
        // y la clave vieja queda RECLAMADA (el catálogo no la resucita)
        assert_eq!(merged.items[0].key, "tecno|spark 20 pro");

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Regresión del bug detectado en la revisión adversarial de F3: al RENOMBRAR un
    /// teléfono cambia su clave (los alias del inventario quedan), y la ficha miraba
    /// solo la clave nueva → salía vacía mientras el stock decía otra cosa. La ficha
    /// debe seguir mostrando los repuestos por categoría, y el índice de marcas contar
    /// ese teléfono como «con repuestos».
    #[test]
    fn test_phone_detail_and_brands_survive_rename() {
        let (db, path) = setup("test_phones_detail_rename.db");
        let conn = db.conn.lock().unwrap();

        let before = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        let id = before.items[0].id;
        let detail_before = get_phone_detail(&conn, id).unwrap().unwrap();
        assert_eq!(detail_before.blocks.len(), 1, "antes de renombrar hay una categoría");
        assert_eq!(detail_before.phone.products, 1);

        // renombrar = clave nueva + los alias del inventario se conservan
        rename_phone(&conn, id, "Tecno", "Spark", "20 Pro").unwrap();

        let after = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(after.items[0].products, 1, "la LISTA ya funcionaba por los alias");

        let detail = get_phone_detail(&conn, id).unwrap().unwrap();
        assert_eq!(detail.phone.name, "Spark 20 Pro");
        assert_eq!(detail.phone.products, 1, "la ficha no puede quedar en 0 tras renombrar");
        assert_eq!(detail.phone.stock, 3, "el stock del repuesto sigue siendo 3");
        assert_eq!(detail.blocks.len(), 1, "la ficha conserva sus categorías tras renombrar");
        assert_eq!(detail.blocks[0].category, "Pantalla");
        assert_eq!(detail.blocks[0].items.len(), 1);
        assert_eq!(detail.blocks[0].items[0].stock, 3);
        assert_eq!(
            detail.blocks[0].items[0].category_name.as_deref(),
            Some("Pantalla"),
            "category_name sale del JOIN, no de la columna search_text (mapeo posicional)"
        );
        assert_eq!(detail.phone.categories, "Pantalla");

        // el índice de marcas cuenta igual que la lista
        let brands = get_phone_brands(&conn).unwrap();
        let tecno = brands.iter().find(|b| b.brand == "Tecno").expect("marca Tecno");
        assert_eq!(tecno.phones, 1);
        assert_eq!(tecno.with_products, 1, "tras renombrar sigue teniendo repuesto");
        assert_eq!(tecno.with_stock, 1, "y sigue teniendo stock");

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// El mismo repuesto NO se cuenta dos veces cuando aparece indexado bajo la clave
    /// actual y bajo un ALIAS (teléfono renombrado o fusionado) — el corazón del fix
    /// del bloqueante de F3.
    #[test]
    fn test_merged_stats_no_doble_conteo_por_alias() {
        let (db, path) = setup("test_phones_no_doble.db");
        // OJO: `add_product` toma el lock de la conexión → se llama ANTES de bloquear
        // (bloquear primero = deadlock del Mutex, lección del proyecto).
        db.add_product(
            "Pantalla Tecno Spark 20 / Spark 20 Pro", Some(1), "Tecno", "Spark 20", "",
            r#"["Tecno Spark 20","Tecno Spark 20 Pro"]"#, 0.0, 0.0, 4, 0, 0.0,
        ).unwrap();
        let conn = db.conn.lock().unwrap();

        let page = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        let names: Vec<&String> = page.items.iter().map(|p| &p.name).collect();
        let a = page.items.iter().find(|p| p.name == "Spark 20").expect("Spark 20");
        let b = page.items.iter().find(|p| p.name == "Spark 20 Pro").unwrap_or_else(|| panic!("teléfonos: {names:?}"));
        assert_eq!((a.products, a.stock), (2, 7), "el suelto (3) + el doble (4)");
        assert_eq!((b.products, b.stock), (1, 4));
        let (keep, remove) = (b.id, a.id);

        // Fusionar: el que queda HEREDA los alias del otro → su conjunto de claves pasa a
        // tener las dos, y el repuesto doble aparece en ambas (antes se sumaba dos veces).
        merge_phones(&conn, keep, remove).unwrap();

        let detail = get_phone_detail(&conn, keep).unwrap().unwrap();
        assert_eq!(detail.blocks.len(), 1, "una categoría (Pantalla)");
        assert_eq!(detail.phone.products, 2, "dos repuestos distintos, no tres");
        assert_eq!(detail.phone.stock, 7, "4 + 3 — el repuesto doble cuenta UNA vez (no 11)");
        assert_eq!(detail.phone.categories, "Pantalla");
        assert_eq!(detail.blocks[0].items.len(), 2);

        // y la fusión QUEDA: la ficha que se queda es manual y reclama la clave vieja, así
        // que el catálogo no recrea el teléfono que se juntó (si no, volvía al reconstruir)
        drop(conn);
        crate::catalog::rebuild_phones(&db.conn.lock().unwrap(), false).unwrap();
        let conn = db.conn.lock().unwrap();
        let after = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(after.total, 1, "sigue habiendo un solo teléfono Tecno: {:?}", after.items.iter().map(|p| &p.name).collect::<Vec<_>>());
        assert_eq!(after.items[0].id, keep, "y es el que se quedó");
        assert_eq!(after.items[0].products, 2, "con los repuestos de los dos");

        // y el índice de marcas cuenta lo mismo
        let brands = get_phone_brands(&conn).unwrap();
        let tecno = brands.iter().find(|b| b.brand == "Tecno").expect("Tecno");
        assert_eq!(tecno.phones, 1, "quedó un solo teléfono Tecno");
        assert_eq!(tecno.with_stock, 1);

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F4: la vista previa dice cómo queda el nombre, si choca con otro teléfono y
    /// cuántos repuestos conserva — sin escribir nada.
    #[test]
    fn test_preview_rename_phone() {
        let (db, path) = setup("test_phones_preview.db");
        let conn = db.conn.lock().unwrap();
        let phones = get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
        let tecno = phones.items.iter().find(|p| p.name == "Spark 20").unwrap();
        let samsung_id = phones.items.iter().find(|p| p.brand == "Samsung").unwrap().id;

        // 1) nombre nuevo, sin choque y conservando el repuesto
        let pv = preview_rename_phone(&conn, tecno.id, "Tecno", "Spark", "20 Pro").unwrap().unwrap();
        assert_eq!(pv.name, "Spark 20 Pro");
        assert_eq!(pv.key, "tecno|spark 20 pro");
        assert_eq!(pv.clash, None, "no hay otro teléfono con esa clave");
        assert_eq!((pv.products, pv.stock), (1, 3), "conserva su repuesto por los alias");

        // 2) la vista previa NO escribió nada
        let after = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        assert_eq!(after.items[0].name, "Spark 20");
        assert_eq!(after.items[0].key, "tecno|spark 20");

        // 3) choque: renombrar el Samsung al nombre del Tecno avisa cuál ya existe y
        //    muestra los repuestos que quedarían si se fusionan (los dos)
        let pv2 = preview_rename_phone(&conn, samsung_id, "Tecno", "Spark", "20").unwrap().unwrap();
        assert_eq!(pv2.clash.as_deref(), Some("Spark 20"), "avisa el que ya existe");
        assert_eq!(pv2.products, 2, "el suyo (Samsung) + el del otro (Tecno): lo que quedaría fusionados");
        assert_eq!(pv2.stock, 5, "2 + 3 unidades");

        // 4) la normalización de Poco se aplica también aquí
        let pv3 = preview_rename_phone(&conn, samsung_id, "Xiaomi", "Redmi", "Poco X3").unwrap().unwrap();
        assert_eq!(pv3.name, "Poco X3", "«Redmi Poco X3» se muestra como «Poco X3»");
        assert_eq!(pv3.key, "xiaomi|poco x3");

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F4: renombrar NO debe dejar un duplicado. Antes la clave se calculaba distinto que
    /// en `rebuild_phones`, así que la próxima reconstrucción volvía a crear la fila del
    /// nombre viejo (hallazgo del re-verificador de F3).
    #[test]
    fn test_rename_no_deja_duplicado_al_reconstruir() {
        let (db, path) = setup("test_phones_rename_dup.db");
        // `rebuild_phones` se llama fuera del lock (toma la conexión)
        let conn = db.conn.lock().unwrap();
        let before = get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap().total;
        let tecno = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        let id = tecno.items[0].id;
        drop(conn);

        {
            let conn = db.conn.lock().unwrap();
            rename_phone(&conn, id, "Tecno", "Spark", "20 Ultra").unwrap();
        }
        // reconstruir el padrón (lo que pasa al guardar cualquier producto)
        crate::catalog::rebuild_phones(&db.conn.lock().unwrap(), false).unwrap();

        let conn = db.conn.lock().unwrap();
        let after = get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
        assert_eq!(after.total, before, "el padrón no creció: {:?}", after.items.iter().map(|p| &p.name).collect::<Vec<_>>());
        let renamed = after.items.iter().find(|p| p.id == id).expect("el teléfono renombrado sigue");
        assert_eq!(renamed.name, "Spark 20 Ultra");
        assert_eq!(renamed.key, "tecno|spark 20 ultra");
        assert_eq!(renamed.products, 1, "conserva su repuesto (alias del inventario)");
        assert!(
            !after.items.iter().any(|p| p.name == "Spark 20"),
            "el catálogo NO resucita el nombre viejo: {:?}",
            after.items.iter().map(|p| &p.name).collect::<Vec<_>>()
        );

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F4 (bloqueante de la revisión adversarial): si el renombrado CAMBIA LA MARCA, la clave
    /// vieja tiene que quedar reclamada igual. Antes no lo quedaba (el alias pelado se
    /// canonicalizaba con la marca NUEVA) y el siguiente `rebuild_phones` recreaba la ficha
    /// vieja, dejando la renombrada sin repuestos.
    #[test]
    fn test_rename_con_cambio_de_marca_no_recrea_la_ficha_vieja() {
        let (db, path) = setup("test_phones_rename_marca.db");
        let conn = db.conn.lock().unwrap();
        let before = get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
        let tecno = before.items.iter().find(|p| p.name == "Spark 20").expect("Spark 20");
        let (id, repuestos_antes, stock_antes) = (tecno.id, tecno.products, tecno.stock);
        assert!(repuestos_antes > 0);
        let tecno_key = tecno.key.clone();
        assert_eq!(tecno_key, "tecno|spark 20");
        let total_before = before.total;
        drop(conn);

        {
            let conn = db.conn.lock().unwrap();
            // mismo aparato, marca corregida (¿era un Samsung? el taller lo decide)
            rename_phone(&conn, id, "Samsung", "", "Spark 20").unwrap();
        }
        crate::catalog::rebuild_phones(&db.conn.lock().unwrap(), false).unwrap();

        let conn = db.conn.lock().unwrap();
        let after = get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
        assert_eq!(after.total, total_before, "el padrón no creció: {:?}", after.items.iter().map(|p| &p.name).collect::<Vec<_>>());
        let renamed = after.items.iter().find(|p| p.id == id).expect("la ficha renombrada sigue");
        assert_eq!(renamed.brand, "Samsung");
        assert_eq!(renamed.name, "Galaxy Spark 20");
        assert_eq!(renamed.key, "samsung|spark 20");
        assert_eq!(renamed.products, repuestos_antes, "no perdió sus repuestos");
        assert_eq!(renamed.stock, stock_antes);
        assert!(
            !after.items.iter().any(|p| p.name == "Spark 20"),
            "el catálogo no resucita la ficha vieja: {:?}",
            after.items.iter().map(|p| format!("{} [{}]", p.name, p.key)).collect::<Vec<_>>()
        );
        assert!(renamed.aliases.iter().any(|a| a.contains("Spark 20")), "alias viejos: {:?}", renamed.aliases);

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F4: los ids inexistentes no pueden borrar ni fingir que guardaron.
    #[test]
    fn test_rename_y_merge_validan_que_existan() {
        let (db, path) = setup("test_phones_ids.db");
        let conn = db.conn.lock().unwrap();
        let err = rename_phone(&conn, 999_999, "Tecno", "", "Nada").unwrap_err();
        assert!(format!("{err}").contains("ya no está en la lista"), "error: {err}");
        let real = get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
        let keep = real.items[0].id;
        let remove = real.items[1].id;
        let total = real.total;
        // la que se quiere fusionar no existe → NO se borra nada
        assert!(merge_phones(&conn, keep, 999_999).is_err());
        assert_eq!(get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap().total, total);
        // la que se queda no existe → tampoco
        assert!(merge_phones(&conn, 999_999, remove).is_err());
        assert_eq!(get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap().total, total);
        // con las dos válidas sí
        merge_phones(&conn, keep, remove).unwrap();
        assert_eq!(get_phones(&conn, None, "", false, false, false, "nombre", "asc", 50, 0).unwrap().total, total - 1);

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F4: el rebuild NO pisa las filas escritas a mano (alias incluidos).
    #[test]
    fn test_rebuild_no_pisa_las_filas_manuales() {
        let (db, path) = setup("test_phones_no_pisa.db");
        let conn = db.conn.lock().unwrap();
        let tecno = get_phones(&conn, Some("Tecno"), "", false, false, false, "nombre", "asc", 10, 0).unwrap();
        let id = tecno.items[0].id;
        drop(conn);
        {
            let conn = db.conn.lock().unwrap();
            rename_phone(&conn, id, "Tecno", "Spark", "20 Pro").unwrap();
        }
        crate::catalog::rebuild_phones(&db.conn.lock().unwrap(), false).unwrap();
        let conn = db.conn.lock().unwrap();
        let after = get_phone_detail(&conn, id).unwrap().unwrap();
        assert_eq!(after.phone.name, "Spark 20 Pro", "el nombre corregido se mantiene");
        assert_eq!(after.phone.key, "tecno|spark 20 pro");
        assert!(after.phone.aliases.iter().any(|a| a == "Tecno Spark 20"), "alias intactos: {:?}", after.phone.aliases);
        assert_eq!(after.phone.products, 1, "y sigue con su repuesto");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F4: el gate de escritura del padrón (sesión de dueño). Sin PIN configurado la
    /// instalación es de un solo usuario; con PIN, hace falta verificarlo. FAIL-CLOSED.
    #[test]
    fn test_gate_de_dueno_para_escribir_el_padron() {
        let (db, path) = setup("test_phones_gate.db");
        assert!(db.owner_can_edit(), "sin PIN configurado se puede editar (un solo usuario)");
        db.set_pin("1234").unwrap();
        assert!(!db.owner_can_edit(), "con PIN y sin verificarlo, NO");
        assert!(db.require_owner().is_err(), "el comando devuelve error claro");
        assert!(!db.verify_pin("9999").unwrap());
        assert!(!db.owner_can_edit(), "un PIN incorrecto no desbloquea");
        assert!(db.verify_pin("1234").unwrap());
        assert!(db.owner_can_edit(), "el PIN correcto desbloquea la sesión de dueño");
        assert!(db.require_owner().is_ok());
        db.lock_owner();
        assert!(!db.owner_can_edit(), "al bloquear se vuelve a pedir");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// F4/AC-5: un teléfono dado de ALTA a mano (sin repuestos todavía) igual aparece en la
    /// lista del formulario de servicio — para eso lo agregó el taller.
    #[test]
    fn test_alta_manual_aparece_en_la_lista_del_servicio() {
        let (db, path) = setup("test_phones_alta_servicio.db");
        let id = {
            let conn = db.conn.lock().unwrap();
            add_phone(&conn, "Nokia", "", "110").unwrap()
        };
        assert!(id > 0);
        // el nombre comercial del padrón no repite la marca: «110» con marca Nokia
        let lista = db.get_phone_models("nokia", 10).unwrap();
        assert_eq!(lista.len(), 1, "el alta manual sale en el selector (se busca por marca + nombre): {lista:?}");
        assert_eq!(lista[0].label, "110");
        assert_eq!(lista[0].brand, "Nokia");
        assert_eq!(lista[0].screens, 0, "todavía sin repuestos cargados");
        assert_eq!(db.get_phone_models("110", 10).unwrap().len(), 1, "y también por el modelo");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
