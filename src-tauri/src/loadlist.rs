//! F25 — Asistente para CARGAR EL INVENTARIO FÍSICO del local.
//!
//! El taller pega (o abre) la lista que tiene escrita —«Samsung», después «A30/A50 (2)»,
//! «Tecno» y «Spark 8P (1)»…— y la app:
//!   1. la **parsea** (secciones por marca, `modelo (N)` = unidades, `/` = modelos que
//!      comparte la misma pantalla física),
//!   2. la **cruza** contra el catálogo (solo pantallas, con **gate de marca** y calidad de
//!      coincidencia exacta / prefijo / parecida),
//!   3. muestra una **vista previa editable** (qué producto recibe qué cantidad, con las
//!      alternativas a un click),
//!   4. y **aplica con respaldo** de la base, dejando el movimiento en el historial.
//!
//! No toca precios ni compatibilidad: eso lo cura el local (ver `ProductForm`).

use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};

use crate::catalog::{self, phone_model_norm};

/// Tope de unidades por línea: un dedo pegado en el teclado («999999999») no puede dejar el
/// stock en las nubes. Es el MISMO tope en el parseo, en la vista previa y al aplicar, así el
/// número que ve el operario es el que se escribe.
pub const MAX_QTY: i64 = 100_000;

/// Máximo de alternativas que se ofrecen por línea en la vista previa (hay catálogos con 11
/// fichas para un mismo modelo: con 6 quedaban cruces imposibles de corregir a mano).
const MAX_CANDIDATES: usize = 15;

/// Una línea de la lista física ya interpretada.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadLine {
    pub raw: String,
    pub brand: String,
    pub model: String,
    /// unidades que dice la lista (0 si no traía número)
    pub qty: i64,
    /// la cantidad no se pudo leer («A30 (dos)»): la fila se avisa y no se aplica sola
    pub qty_issue: bool,
    /// modelos que comparten esa pantalla (`A30/A50` → ["A30", "A50"])
    pub parts: Vec<String>,
}

/// Candidato del catálogo para una línea de la lista.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadCandidate {
    pub product_id: i64,
    pub product_name: String,
    pub category: String,
    pub stock: i64,
    pub price_sale: f64,
    /// exacta | prefijo | parcial
    pub quality: String,
}

/// Una fila de la vista previa (lo que la UI deja editar).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadRow {
    pub raw: String,
    pub brand: String,
    pub model: String,
    pub qty: i64,
    /// la cantidad de esta línea NO se pudo leer (o era absurda): la fila se avisa y NO se aplica
    /// mientras siga así. Es un campo propio (no solo el texto de `issue`) porque el operario
    /// puede asignarle una pantalla a mano y eso no arregla la cantidad: sin este flag, asignar
    /// la ficha borraba el aviso y se escribía 100.000 o 0 unidades en silencio (medido en revisión).
    pub qty_issue: bool,
    /// producto elegido (por defecto, la mejor coincidencia)
    pub product_id: Option<i64>,
    pub product_name: String,
    pub stock_now: i64,
    pub candidates: Vec<LoadCandidate>,
    /// OTRAS líneas de la lista que aterrizan en el mismo producto: las unidades se SUMAN
    pub shared: i64,
    /// unidades que recibe el producto sumando todas sus líneas
    pub sum_qty: i64,
    /// el operario dijo que esta línea NO se cargue (no es una línea sin resolver): el barrido y
    /// los avisos la ignoran y no bloquea la carga
    pub excluded: bool,
    /// proveedor que trajo ESTA pantalla (vacío = el proveedor general de la carga)
    #[serde(default)]
    pub supplier: String,
    /// aviso para el operario ("no está en el catálogo", "sin número…")
    pub issue: Option<String>,
}

/// Ficha que el barrido dejaría en 0 si se aplica con «la lista es todo».
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ZeroTarget {
    pub product_id: i64,
    pub stock: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadPreview {
    pub rows: Vec<LoadRow>,
    pub lines: i64,
    pub matched: i64,
    pub unmatched: i64,
    /// unidades que dice la lista (todas las líneas)
    pub units: i64,
    /// unidades que se van a APLICAR (sumando las líneas que comparten ficha)
    pub applied_units: i64,
    /// fichas distintas que se van a tocar
    pub applied_products: i64,
    /// fichas que quedan en 0 si se aplica con «la lista es todo»
    pub zero_count: i64,
    pub zero_units: i64,
    /// las mismas fichas con su stock: la UI recalcula el aviso contra las filas VIVAS (si el
    /// operario asigna a mano una de ellas, ya no se barre y el aviso tiene que decir la verdad)
    pub zero_ids: Vec<ZeroTarget>,
    pub brands: i64,
    pub skipped: i64,
}

/// Resultado de aplicar la carga.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadReport {
    /// fichas de producto actualizadas con lo que dice la lista
    pub updated: i64,
    /// fichas que quedaron en 0 porque no estaban en la lista
    pub zeroed: i64,
    /// movimientos de inventario escritos
    pub movements: i64,
    /// unidades cargadas
    pub units: i64,
    /// LÍNEAS que no se cargaron (apuntaban a otra categoría o a una ficha que ya no existe)
    pub skipped: i64,
    /// líneas de la lista que quedaron sin pantalla asignada (no se cargaron)
    pub unassigned: i64,
    /// unidades que se quedaron sin cargar por eso
    pub unassigned_units: i64,
    /// líneas que el operario excluyó a mano (no cuentan como «sin resolver»)
    pub excluded: i64,
    /// unidades de esas líneas (tampoco se cargan, pero por decisión del operario)
    pub excluded_units: i64,
    /// fichas a las que se les anotó el proveedor que trajo la mercancía
    pub suppliered: i64,
    pub backup: String,
}

// ---------------------------------------------------------------- parseo

/// ¿La línea es un ENCABEZADO de marca («Samsung», «Iphone», «sin marca»)? Solo si el texto
/// ES una marca conocida (o su alias) y no trae números: si no, «Note» o «A20 5G» se
/// tomarían como marca y re-marcarían la sección (bug detectado en revisión).
fn brand_header(line: &str) -> Option<String> {
    let words: Vec<&str> = line.split_whitespace().collect();
    if words.is_empty() || words.len() > 2 {
        return None;
    }
    if line.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    if !catalog::is_brand_alias(line) {
        return None;
    }
    let brand = catalog::canonical_brand(line);
    if brand.is_empty() { None } else { Some(brand) }
}

/// ¿Es una parte "de conectividad" (`4G`, `5G`, `WIFI`…)? No sirve como modelo por sí sola.
fn is_connectivity_token(part: &str) -> bool {
    let n = catalog::norm(part);
    matches!(n.as_str(), "4g" | "5g" | "3g" | "2g" | "lte" | "wifi" | "nfc" | "esim" | "sim")
}

/// Convierte el texto pegado en líneas interpretadas. Ignora lo que no se entiende
/// (cuenta en `skipped` y no rompe nada).
pub fn parse_list(text: &str) -> (Vec<LoadLine>, i64) {
    let mut out = Vec::new();
    let mut brand: Option<String> = None;
    let mut skipped = 0i64;
    for raw_line in text.lines() {
        let line = raw_line.trim().trim_start_matches(['-', '*', '•']).trim();
        if line.is_empty() {
            continue;
        }
        if let Some(b) = brand_header(line) {
            brand = Some(b);
            continue;
        }
        let Some(active_brand) = brand.clone() else {
            // sin marca previa no se puede cruzar con seguridad
            skipped += 1;
            continue;
        };
        // "Spark 8P (2)" → modelo + unidades. Si el paréntesis NO es un número
        // ("A30 (dos)") la cantidad queda ILEGIBLE: se avisa y la fila no se aplica sola.
        let mut qty_issue = false;
        let (model_raw, qty) = match line.rfind('(') {
            Some(pos) if line.ends_with(')') => {
                let inside = &line[pos + 1..line.len() - 1];
                let tail = line[..pos].trim_end().to_string();
                match inside.trim().parse::<i64>() {
                    Ok(n) => {
                        // una cantidad absurda no se aplica sola: se avisa y la corrige el operario
                        if n > MAX_QTY {
                            qty_issue = true;
                        }
                        (tail, n.clamp(0, MAX_QTY))
                    }
                    // "Pantalla (Pantallas) (1)": el paréntesis describe el repuesto, no la
                    // cantidad → la línea queda ilegible y se avisa
                    Err(_) => {
                        qty_issue = true;
                        (tail, 0)
                    }
                }
            }
            _ => (line.to_string(), 0),
        };
        let model = model_raw
            .trim()
            .trim_end_matches(['.', ','])
            .trim()
            .to_string();
        let cleaned = catalog::clean_compat_entry(&model);
        // un modelo que son SOLO números es legítimo si trae unidades ("13 (25)" = 25 iPhone 13);
        // sin unidades sí es basura del pegado ("4)")
        if cleaned.is_empty() || (catalog::is_junk_entry(&cleaned) && qty == 0) {
            skipped += 1;
            continue;
        }
        // "A17 c/m 4G/5G" = la pantalla CON MARCO sirve para el A17 4G y 5G: el "c/m" no es
        // modelo y las partes de conectividad no se cruzan solas (daban falsos «exacta»)
        let for_parts = cleaned.replace("c/m", " ").replace("C/M", " ");
        let mut parts: Vec<String> = for_parts
            .split('/')
            // el hueco que dejó el "c/m" se colapsa: «A17   4G» → «A17 4G»
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|s| s.chars().count() >= 2 && !is_connectivity_token(s))
            .collect();
        if parts.is_empty() {
            // todo eran partes de conectividad: se cruza el modelo completo tal cual
            parts = vec![catalog::clean_compat_entry(&for_parts)];
        }
        parts.retain(|p| !p.trim().is_empty());
        if parts.is_empty() {
            skipped += 1;
            continue;
        }
        out.push(LoadLine {
            raw: line.to_string(),
            brand: active_brand,
            model: cleaned,
            qty,
            qty_issue,
            parts,
        });
    }
    (out, skipped)
}

// ---------------------------------------------------------------- cruce

/// Texto de búsqueda de una parte: si ya trae la marca, tal cual; si no, se le antepone la
/// marca de la sección («A30» en la sección Samsung → «Samsung A30»).
fn part_with_brand(brand: &str, part: &str) -> String {
    let first = part.split_whitespace().next().map(catalog::norm).unwrap_or_default();
    if catalog::norm(brand) == first || catalog::is_brand_alias(&first) {
        part.to_string()
    } else {
        format!("{brand} {part}")
    }
}

/// Mejor calidad de coincidencia de una parte contra un producto (compatibilidad + nombre/modelo).
/// Los `targets` tienen que venir normalizados con `phone_model_norm` (sin marca): `match_quality`
/// compara contra esa forma.
fn best_quality(targets: &[String], product_models: &[String], product_text: &str) -> Option<&'static str> {
    let rank = |q: &str| match q {
        "exacta" => 0,
        "prefijo" => 1,
        _ => 2,
    };
    let mut best: Option<&'static str> = None;
    let product_norm = catalog::norm(product_text);
    let product_model_norm = phone_model_norm(product_text);
    for target in targets {
        for model in product_models {
            if let Some(q) = catalog::match_quality(target, model) {
                if best.map(|b| rank(q) < rank(b)).unwrap_or(true) {
                    best = Some(q);
                }
            }
        }
        // el nombre/modelo de la ficha también cuenta (productos sin compatibilidad curada),
        // siempre por PALABRA completa: «15» no puede cruzar con «Redmi 15C»
        if catalog::contains_word(&product_norm, target)
            || (!product_model_norm.is_empty() && catalog::contains_word(target, &product_model_norm))
        {
            if best.map(|b| rank("parcial") < rank(b)).unwrap_or(true) {
                best = Some("parcial");
            }
        }
    }
    best
}

/// Cruza la lista contra el catálogo (solo `category_id`, por defecto pantallas).
pub fn preview_load(conn: &Connection, text: &str) -> SqlResult<LoadPreview> {
    let cats = crate::phones::category_names(conn)?;
    let (lines, skipped) = parse_list(text);

    // catálogo de las categorías de pantalla, con su compatibilidad ya canonicalizada
    let mut catalog: Vec<(i64, String, String, String, i64, f64, Vec<String>, i64)> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT p.id, COALESCE(p.name,''), COALESCE(p.brand,''), COALESCE(p.model,''),
                    COALESCE(p.stock,0), COALESCE(p.price_sale,0), COALESCE(p.compatibility,''),
                    COALESCE(p.category_id,0)
             FROM products p
             WHERE COALESCE(p.category_id,0) IN (SELECT value FROM json_each(?1))
             ORDER BY p.name",
        )?;
        let cats_json = serde_json::to_string(crate::catalog::PHONE_CATEGORIES).unwrap_or_else(|_| "[1]".to_string());
        let rows = stmt.query_map(params![cats_json], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, f64>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })?;
        for row in rows {
            let (id, name, brand, model, stock, price, compat, cat_id) = row?;
            let phones = catalog::compat_phones(&compat, &brand);
            let mut models: Vec<String> = phones.iter().map(|p| phone_model_norm(&p.model)).collect();
            if !model.trim().is_empty() {
                models.push(phone_model_norm(&model));
            }
            if !name.trim().is_empty() {
                models.push(phone_model_norm(&name));
            }
            models.retain(|m| !m.is_empty());
            models.sort();
            models.dedup();
            catalog.push((id, name, brand, model, stock, price, models, cat_id));
        }
    }

    let mut rows: Vec<LoadRow> = Vec::new();
    let mut matched = 0i64;
    let mut units = 0i64;
    let mut brands: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for line in &lines {
        brands.insert(line.brand.clone());
        units += line.qty.max(0);
        // `match_quality` compara contra la forma normalizada del teléfono (sin marca):
        // «Xiaomi 13C» → «13c», que es como están guardados los modelos del catálogo.
        let mut targets: Vec<String> = line
            .parts
            .iter()
            .map(|p| phone_model_norm(&part_with_brand(&line.brand, p)))
            .filter(|t| !t.is_empty())
            .collect();
        // el texto COMPLETO de la línea también es objetivo del cruce: hay fichas que se llaman
        // igual que la línea («A17 c/m 4G/5G») y sin esto quedaban sin candidato (y el barrido
        // las dejaba en 0 con su stock real).
        let full = phone_model_norm(&part_with_brand(&line.brand, &line.model));
        if !full.is_empty() && !targets.contains(&full) {
            targets.push(full);
        }
        let brand_norm = catalog::norm(&line.brand);
        let mut candidates: Vec<LoadCandidate> = Vec::new();
        for (id, name, pbrand, _model, stock, price, models, cat_id) in &catalog {
            // GATE DE MARCA: una pantalla Samsung nunca cruza con una línea Tecno. La marca del
            // producto se CANONICALIZA igual que la de la sección («Redmi» → «Xiaomi»): comparar
            // la marca cruda dejaba fuera del cruce fichas reales (57 fichas «Redmi» medidas).
            // Una ficha SIN marca sigue siendo candidata (no se la puede descartar por marca).
            let pb = if pbrand.trim().is_empty() {
                String::new()
            } else {
                catalog::norm(&catalog::canonical_brand(pbrand))
            };
            if !pb.is_empty() && !brand_norm.is_empty() && pb != brand_norm {
                continue;
            }
            if let Some(q) = best_quality(&targets, models, name) {
                let category = cats.get(cat_id).cloned().unwrap_or_default();
                candidates.push(LoadCandidate {
                    product_id: *id,
                    product_name: name.clone(),
                    category,
                    stock: *stock,
                    price_sale: *price,
                    quality: q.to_string(),
                });
            }
        }
        let rank = |q: &str| match q {
            "exacta" => 0,
            "prefijo" => 1,
            _ => 2,
        };
        candidates.sort_by(|a, b| {
            rank(&a.quality)
                .cmp(&rank(&b.quality))
                .then(b.stock.cmp(&a.stock))
                .then(a.product_name.cmp(&b.product_name))
        });
        // una cantidad ilegible NO se aplica sola: el operario la corrige
        let chosen = if line.qty_issue { None } else { candidates.first().cloned() };
        if chosen.is_some() {
            matched += 1;
        }
        let has_candidates = !candidates.is_empty();
        rows.push(LoadRow {
            raw: line.raw.clone(),
            brand: line.brand.clone(),
            model: line.model.clone(),
            qty: line.qty,
            qty_issue: line.qty_issue,
            product_id: chosen.as_ref().map(|c| c.product_id),
            product_name: chosen.as_ref().map(|c| c.product_name.clone()).unwrap_or_default(),
            stock_now: chosen.as_ref().map(|c| c.stock).unwrap_or(0),
            candidates: candidates.into_iter().take(MAX_CANDIDATES).collect(),
            shared: 0,
            sum_qty: line.qty.max(0),
            excluded: false,
            supplier: String::new(),
            issue: if line.qty_issue {
                Some("No entiendo la cantidad de esta línea: escribila con números (máx. 100.000) y revisá que sean las unidades reales.".to_string())
            } else if chosen.is_none() && has_candidates {
                Some("Revisá esta línea: no pude elegir una pantalla.".to_string())
            } else if chosen.is_none() {
                Some("No encuentro esa pantalla en el catálogo: revisá el nombre, buscala a mano o cargala desde Productos.".to_string())
            } else if line.qty == 0 {
                Some("La lista no dice cuántas unidades hay (queda en 0).".to_string())
            } else {
                None
            },
        });
    }

    // Varias líneas pueden describir la MISMA pantalla física («13C (6)» + «Redmi 13C (12)»):
    // las unidades se SUMAN. La vista previa lo muestra para que el botón diga la verdad.
    let mut per_product: std::collections::BTreeMap<i64, i64> = std::collections::BTreeMap::new();
    for r in &rows {
        if let Some(pid) = r.product_id {
            *per_product.entry(pid).or_insert(0) += r.qty.max(0);
        }
    }
    let shared_counts: std::collections::BTreeMap<i64, i64> =
        per_product.iter().map(|(pid, _)| (*pid, rows.iter().filter(|o| o.product_id == Some(*pid)).count() as i64)).collect();
    for r in rows.iter_mut() {
        if let Some(pid) = r.product_id {
            r.sum_qty = per_product.get(&pid).copied().unwrap_or(r.qty.max(0));
            r.shared = shared_counts.get(&pid).copied().unwrap_or(1) - 1;
        }
    }

    // lo que el barrido («la lista es todo») dejaría en 0: pantallas con stock que ninguna
    // línea toca — se muestra ANTES de aplicar. Se devuelven las fichas (id + stock) para que la
    // UI recalcule el aviso contra las filas VIVAS: si el operario asigna una a mano, ya no se barre.
    let touched: std::collections::BTreeSet<i64> = per_product.keys().copied().collect();
    let zero_ids: Vec<ZeroTarget> = {
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(stock,0) FROM products
             WHERE COALESCE(category_id,0) IN (SELECT value FROM json_each(?1)) AND COALESCE(stock,0) <> 0",
        )?;
        let cats_json = serde_json::to_string(crate::catalog::PHONE_CATEGORIES).unwrap_or_else(|_| "[1]".to_string());
        let pend: Vec<(i64, i64)> = stmt
            .query_map(params![cats_json], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<SqlResult<Vec<_>>>()?;
        pend.into_iter()
            .filter(|(id, _)| !touched.contains(id))
            .map(|(id, stock)| ZeroTarget { product_id: id, stock })
            .collect()
    };
    let zero_count = zero_ids.len() as i64;
    let zero_units: i64 = zero_ids.iter().map(|z| z.stock.abs()).sum();

    let applied_units: i64 = per_product.values().sum();
    Ok(LoadPreview {
        lines: rows.len() as i64,
        matched,
        unmatched: rows.iter().filter(|r| r.product_id.is_none()).count() as i64,
        units,
        applied_units,
        applied_products: per_product.len() as i64,
        zero_count,
        zero_units,
        zero_ids,
        brands: brands.len() as i64,
        skipped,
        rows,
    })
}

// ---------------------------------------------------------------- buscar a mano

/// Busca pantallas del catálogo por texto para ASIGNAR A MANO una línea del conteo.
///
/// Existe porque el nombre del catálogo y el de la lista escrita a mano no siempre coinciden
/// («6 c/m Accesorios» en la lista vs «Pantalla Redmi 6 c/m Acasonor» en el catálogo): el
/// operario tiene que poder elegir la ficha correcta sin salir del asistente.
/// Busca por tokens sobre `search_text` (nombre+marca+modelo+compatibilidad), igual que el
/// inventario, y devuelve las fichas de las categorías de pantalla con stock primero.
pub fn search_targets(conn: &Connection, query: &str, limit: i64) -> SqlResult<Vec<LoadCandidate>> {
    let tokens = catalog::search_tokens(query);
    // una sola letra no busca: devolvería medio catálogo (la UI ya pide 2, el backend lo exige)
    if tokens.is_empty() || catalog::norm(query).chars().count() < 2 {
        return Ok(Vec::new());
    }
    let cats_json = serde_json::to_string(crate::catalog::PHONE_CATEGORIES).unwrap_or_else(|_| "[1]".to_string());
    // ?1 = categorías, ?2 = tope; la búsqueda por tokens empieza en ?3
    let (clause, values) = catalog::search_clause(&tokens, 3);
    let sql = format!(
        "SELECT p.id, COALESCE(p.name,''), COALESCE(p.category_id,0), COALESCE(p.stock,0),
                COALESCE(p.price_sale,0)
         FROM products p
         WHERE COALESCE(p.category_id,0) IN (SELECT value FROM json_each(?1))
           AND COALESCE(p.search_text,'') <> ''{clause}
         ORDER BY CASE WHEN COALESCE(p.stock,0) > 0 THEN 0 ELSE 1 END, p.name
         LIMIT ?2"
    );
    let cats = crate::phones::category_names(conn)?;
    let mut stmt = conn.prepare(&sql)?;
    let mut params_dyn: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params_dyn.push(Box::new(cats_json));
    params_dyn.push(Box::new(limit.clamp(1, 50)));
    for v in values {
        params_dyn.push(Box::new(v));
    }
    let refs: Vec<&dyn rusqlite::types::ToSql> = params_dyn.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(refs.as_slice(), |r| {
        let cat_id: i64 = r.get(2)?;
        Ok(LoadCandidate {
            product_id: r.get(0)?,
            product_name: r.get(1)?,
            category: cats.get(&cat_id).cloned().unwrap_or_default(),
            stock: r.get(3)?,
            price_sale: r.get(4)?,
            // a mano: la calidad no la decide el cruce, la decide el operario
            quality: "a mano".to_string(),
        })
    })?;
    rows.collect()
}

// ---------------------------------------------------------------- aplicar

/// Aplica la vista previa: respaldo de la base, stock por producto y movimiento en el
/// historial. Si `zero_missing`, las pantallas que NO están en la lista quedan en 0
/// (la lista es el inventario físico completo).
///
/// `keep_ids` son las fichas que la vista previa YA tenía asignadas: el barrido nunca las
/// toca. Sin eso, desmarcar una línea o cambiarle el producto entregaba su ficha al barrido
/// y la dejaba en 0 sin que el operario lo pidiera (pérdida de stock real).
pub fn apply_load(
    conn: &Connection,
    db_path: &std::path::Path,
    rows: &[LoadRow],
    zero_missing: bool,
    keep_ids: &[i64],
    supplier: &str,
) -> Result<LoadReport, String> {
    // La categoría NO la elige el cliente: es la regla del local (`PHONE_CATEGORIES`). Antes
    // un invoke a mano con otro id podía barrer el stock de Batería/Flex entera.
    let cats_json = serde_json::to_string(crate::catalog::PHONE_CATEGORIES).unwrap_or_else(|_| "[1]".to_string());

    // Varias líneas pueden describir la MISMA pantalla física («13C (6)» + «Redmi 13C (12)»):
    // las unidades se SUMAN (antes «mandaba la primera» y se perdían unidades reales).
    // Las líneas EXCLUIDAS a mano por el operario no se cargan ni cuentan para nada.
    let mut per_product: std::collections::BTreeMap<i64, i64> = std::collections::BTreeMap::new();
    let mut skipped_rows: i64 = 0;
    for row in rows {
        if row.excluded {
            continue;
        }
        if let Some(pid) = row.product_id {
            *per_product.entry(pid).or_insert(0) += row.qty.max(0);
        }
    }

    // GATE DE LA CANTIDAD: una línea cuya cantidad no se pudo leer (o era absurda) no puede
    // aplicarse — ni siquiera asignándole una pantalla a mano: escribiría 0 o 100.000 unidades
    // en silencio (hallazgo de la revisión de F28).
    let sin_cantidad: Vec<&LoadRow> = rows.iter().filter(|r| r.qty_issue && !r.excluded).collect();
    if !sin_cantidad.is_empty() {
        return Err(format!(
            "Hay {} línea(s) con la cantidad sin leer ({}): corregí la cantidad en la vista previa \
             (o excluí la línea si no se carga) antes de cargar. No se cargó nada.",
            sin_cantidad.len(),
            sin_cantidad.iter().map(|r| r.raw.clone()).collect::<Vec<_>>().join(", ")
        ));
    }

    // GATE DEL BARRIDO: si la lista es TODO el inventario, ninguna línea con unidades puede
    // quedarse sin pantalla asignada — su ficha real terminaría en 0 por no haber coincidido
    // el nombre (medido: 79 de 87 fichas barridas estaban escritas en la lista).
    let (sin_asignar, unidades_sin_asignar) = rows
        .iter()
        .filter(|r| !r.excluded)
        .fold((0i64, 0i64), |(n, u), r| {
            if r.product_id.is_none() {
                (n + 1, u + r.qty.max(0))
            } else {
                (n, u)
            }
        });
    if zero_missing && unidades_sin_asignar > 0 {
        return Err(format!(
            "Hay {sin_asignar} línea(s) de la lista sin pantalla asignada ({unidades_sin_asignar} unidades): \
             buscalas a mano, corregí el nombre de la pantalla en Inventario → Productos, excluí la línea \
             o desmarcá «las pantallas que no están en la lista quedan en 0». \
             No cargué nada para no dejar en 0 mercancía que sí está en la lista."
        ));
    }
    if zero_missing && per_product.is_empty() && keep_ids.is_empty() {
        return Err(
            "No hay ninguna línea con pantalla asignada: no puedo dejar todo el inventario en 0.".to_string(),
        );
    }

    // 1) respaldo consistente ANTES de escribir. `VACUUM INTO` copia una foto completa
    // (incluye lo que esté en el -wal); si no se puede, se cae al checkpoint + copia y se
    // ABORTA si el checkpoint queda ocupado (un respaldo sin el WAL no es un respaldo).
    let stamp: String = conn
        .query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let dir = db_path.parent().unwrap_or(std::path::Path::new(".")).join("backup");
    std::fs::create_dir_all(&dir).ok();
    // nombre único (dos cargas en el mismo segundo no pueden pisar el respaldo anterior)
    let mut dest = dir.join(format!("registro_pre_carga_{stamp}.db"));
    let mut n = 1;
    while dest.exists() {
        n += 1;
        dest = dir.join(format!("registro_pre_carga_{stamp}_{n}.db"));
    }
    let dest_str = dest.to_string_lossy().to_string();
    if let Err(vacuum_err) = conn.execute("VACUUM INTO ?1", params![dest_str]) {
        let (busy, _log, _ckpt): (i64, i64, i64) = conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| format!("No pude preparar el respaldo antes de cargar ({e}): no se cargó nada."))?;
        if busy != 0 {
            return Err(
                "No pude cerrar el WAL para el respaldo (¿hay otra ventana de la app abierta?): \
                 no se cargó nada."
                    .to_string(),
            );
        }
        std::fs::copy(db_path, &dest).map_err(|e| {
            format!("No pude hacer el respaldo antes de cargar ({e}; intento previo: {vacuum_err}): no se cargó nada.")
        })?;
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut report = LoadReport {
        backup: dest_str,
        skipped: skipped_rows,
        unassigned: sin_asignar,
        unassigned_units: unidades_sin_asignar,
        excluded: rows.iter().filter(|r| r.excluded).count() as i64,
        excluded_units: rows.iter().filter(|r| r.excluded).map(|r| r.qty.max(0)).sum(),
        ..Default::default()
    };

    let mut touched: std::collections::BTreeSet<i64> = keep_ids.iter().copied().collect();
    for (pid, qty) in &per_product {
        // defensivo: la ficha tiene que existir y ser de las categorías de pantalla
        // (la UI solo ofrece candidatos de ahí; un invoke a mano podría mandar otra)
        let cat_ok: Option<i64> = tx
            .query_row("SELECT COALESCE(category_id,0) FROM products WHERE id=?1", params![pid], |r| r.get(0))
            .ok();
        let in_set = match cat_ok {
            Some(c) => crate::catalog::PHONE_CATEGORIES.contains(&c),
            None => false,
        };
        if !in_set {
            // se cuentan las LÍNEAS descartadas (no las fichas): el resumen se lo dice al operario
            skipped_rows += rows.iter().filter(|r| r.product_id == Some(*pid)).count() as i64;
            continue;
        }
        let old: i64 = tx
            .query_row("SELECT COALESCE(stock,0) FROM products WHERE id=?1", params![pid], |r| r.get(0))
            .unwrap_or(0);
        // una cantidad absurda (dedo pegado en el teclado) no puede dejar el stock en las nubes
        let new = (*qty).clamp(0, MAX_QTY);
        tx.execute(
            "UPDATE products SET stock=?1, updated_at=datetime('now','localtime') WHERE id=?2",
            params![new, pid],
        )
        .map_err(|e| e.to_string())?;
        touched.insert(*pid);
        report.updated += 1;
        report.units += new;
        // PROVEEDOR: el de la línea si lo tiene, si no el general de la carga (lo que el local
        // quiere saber: quién le trajo esa pantalla). No se pisa con vacío.
        let prov = rows
            .iter()
            .filter(|r| r.product_id == Some(*pid))
            .map(|r| r.supplier.trim())
            .find(|s| !s.is_empty())
            .unwrap_or_else(|| supplier.trim());
        if !prov.is_empty() {
            tx.execute("UPDATE products SET supplier=?1 WHERE id=?2", params![prov, pid])
                .map_err(|e| e.to_string())?;
            report.suppliered += 1;
        }
        let delta = new - old;
        if delta != 0 {
            tx.execute(
                "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference)
                 VALUES (?1, ?2, ?3, 'Carga de inventario', 'Lista del local')",
                params![pid, if delta > 0 { "entrada" } else { "salida" }, delta.abs()],
            )
            .map_err(|e| e.to_string())?;
            report.movements += 1;
        }
    }
    if zero_missing {
        let mut stmt = tx
            .prepare(
                "SELECT id, COALESCE(stock,0) FROM products
                 WHERE COALESCE(category_id,0) IN (SELECT value FROM json_each(?1)) AND COALESCE(stock,0) <> 0",
            )
            .map_err(|e| e.to_string())?;
        let pending: Vec<(i64, i64)> = stmt
            .query_map(params![cats_json], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<SqlResult<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        for (pid, old) in pending {
            if touched.contains(&pid) {
                continue;
            }
            tx.execute(
                "UPDATE products SET stock=0, updated_at=datetime('now','localtime') WHERE id=?1",
                params![pid],
            )
            .map_err(|e| e.to_string())?;
            // un stock negativo que vuelve a 0 es una ENTRADA (faltaba mercancía)
            tx.execute(
                "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference)
                 VALUES (?1, ?2, ?3, 'Carga de inventario (no estaba en la lista)', 'Lista del local')",
                params![pid, if old < 0 { "entrada" } else { "salida" }, old.abs()],
            )
            .map_err(|e| e.to_string())?;
            report.zeroed += 1;
            report.movements += 1;
        }
    }
    report.skipped = skipped_rows;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::path::PathBuf;

    fn setup(name: &str) -> (Database, PathBuf) {
        let path = std::env::temp_dir().join(format!("registro_{}_{}.db", name, std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Database::new(&path).expect("test db");
        db.add_product("Pantalla Samsung A30", Some(1), "Samsung", "A30", "", r#"["Samsung A30"]"#, 5.0, 12.0, 4, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung A50", Some(1), "Samsung", "A50", "", r#"["Samsung A50"]"#, 5.0, 12.0, 0, 0, 0.0).unwrap();
        db.add_product("Pantalla Tecno Spark 8P", Some(1), "Tecno", "Spark 8P", "", r#"["Tecno Spark 8P"]"#, 4.0, 9.0, 0, 0, 0.0).unwrap();
        // dos pantallas que la lista NO menciona: una con stock (se barre) y una en faltante
        db.add_product("Pantalla Samsung A10", Some(1), "Samsung", "A10", "", r#"["Samsung A10"]"#, 4.0, 9.0, 6, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung J7", Some(1), "Samsung", "J7", "", r#"["Samsung J7"]"#, 4.0, 9.0, -2, 0, 0.0).unwrap();
        // una sola ficha para el 13C: la lista la nombra de dos maneras («13C» y «Redmi 13C»)
        db.add_product("Pantalla Xiaomi Redmi 13C", Some(1), "Xiaomi", "Redmi 13C", "", r#"["Redmi 13C"]"#, 5.0, 13.0, 0, 0, 0.0).unwrap();
        // una batería: NO debe entrar en el cruce de pantallas
        db.add_product("Batería Samsung A30", Some(4), "Samsung", "A30", "", r#"["Samsung A30"]"#, 3.0, 8.0, 7, 0, 0.0).unwrap();
        (db, path)
    }

    const LISTA: &str = "Samsung\nA30/A50 (3)\nA20 (0)\n\nTecno\nSpark 8P (2)\n";

    #[test]
    fn test_parse_list_secciones_y_cantidades() {
        let (lines, skipped) = parse_list(LISTA);
        assert_eq!(skipped, 0, "nada raro en la lista");
        assert_eq!(lines.len(), 3, "{lines:?}");
        assert_eq!(lines[0].brand, "Samsung");
        assert_eq!(lines[0].parts, vec!["A30", "A50"]);
        assert_eq!(lines[0].qty, 3);
        assert_eq!(lines[1].model, "A20");
        assert_eq!(lines[1].qty, 0);
        assert_eq!(lines[2].brand, "Tecno");
        assert_eq!(lines[2].model, "Spark 8P");
        assert_eq!(lines[2].qty, 2);

        // el alias de marca también abre sección, y una línea suelta sin marca se ignora
        let (l2, skipped2) = parse_list("A30 (1)\nIphone\n11 Pro (2)\n");
        assert_eq!(skipped2, 1, "la primera línea no tenía marca");
        assert_eq!(l2.len(), 1);
        assert_eq!(l2[0].brand, "Apple");
        assert_eq!(l2[0].qty, 2);

        // «A17 c/m 4G/5G»: el «c/m» describe el repuesto (con marco) y no es modelo; la
        // conectividad sola no se cruza (daba falsos «exacta»)
        let (l3, _) = parse_list("Samsung\nA17 c/m 4G/5G (3)\n");
        assert_eq!(l3.len(), 1);
        assert_eq!(l3[0].model, "A17 c/m 4G/5G");
        assert_eq!(l3[0].parts, vec!["A17 4G"], "{:?}", l3[0].parts);

        // un modelo que es SOLO número vale si trae unidades («13 (25)» = 25 iPhone 13)
        let (l4, sk4) = parse_list("Apple\n13 (25)\n4)\n");
        assert_eq!(sk4, 1, "«4)» sin unidades es basura del pegado");
        assert_eq!(l4.len(), 1);
        assert_eq!(l4[0].model, "13");
        assert_eq!(l4[0].qty, 25);

        // «Note» NO es marca: sigue siendo el modelo de la sección Samsung
        let (l5, _) = parse_list("Samsung\nNote (1)\n");
        assert_eq!(l5.len(), 1);
        assert_eq!(l5[0].brand, "Samsung");
        assert_eq!(l5[0].model, "Note");

        // cantidad ilegible («A30 (dos)»): se avisa y no se aplica sola
        let (l6, _) = parse_list("Samsung\nA30 (dos)\n");
        assert_eq!(l6.len(), 1);
        assert!(l6[0].qty_issue, "la cantidad ilegible queda marcada");
        assert_eq!(l6[0].qty, 0);
    }

    #[test]
    fn test_preview_cruza_con_gate_de_marca_y_solo_pantallas() {
        let (db, path) = setup("test_load_preview.db");
        let conn = db.conn.lock().unwrap();
        let pv = preview_load(&conn, LISTA).unwrap();
        assert_eq!(pv.lines, 3);
        assert_eq!(pv.matched, 2, "A30/A50 y Spark 8P");
        assert_eq!(pv.unmatched, 1, "el A20 no está en el catálogo");
        assert_eq!(pv.units, 5, "3 + 0 + 2");
        assert_eq!(pv.applied_products, 2, "dos fichas reciben unidades");

        // A30/A50: gana el que TIENE stock (el A30 tiene 4) y el A50 queda como alternativa
        let fila = &pv.rows[0];
        assert!(fila.product_name.contains("A30"), "{:?}", fila.product_name);
        assert_eq!(fila.qty, 3);
        assert_eq!(fila.sum_qty, 3, "una sola línea toca esta ficha");
        assert_eq!(fila.shared, 0);
        assert!(fila.candidates.iter().any(|c| c.product_name.contains("A50")));
        // la BATERÍA no aparece: el cruce es solo de las categorías de pantalla
        assert!(!fila.candidates.iter().any(|c| c.category.contains("Batería")));

        // el A20 sin match avisa y deja la fila sin producto
        let sin = &pv.rows[1];
        assert!(sin.product_id.is_none());
        assert!(sin.issue.is_some(), "avisa al operario");

        // la marca del encabezado manda: «A30» (Tecno) no matchea la pantalla Samsung
        let (rows2, _) = parse_list("Tecno\nA30 (1)\n");
        assert_eq!(rows2.len(), 1);
        let pv2 = preview_load(&conn, "Tecno\nA30 (1)\n").unwrap();
        assert_eq!(pv2.matched, 0, "no hay pantalla Tecno A30 en el fixture");

        // una cantidad ilegible no se aplica sola aunque haya candidatos
        let pv3 = preview_load(&conn, "Samsung\nA30 (dos)\n").unwrap();
        assert_eq!(pv3.matched, 0);
        assert!(pv3.rows[0].product_id.is_none());
        assert!(pv3.rows[0].issue.as_deref().unwrap_or("").contains("cantidad"));

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Dos maneras de nombrar la MISMA pantalla («13C» y «Redmi 13C») suman sus unidades:
    /// antes mandaba la primera línea y se perdían 12 unidades reales.
    #[test]
    fn test_preview_suma_las_lineas_que_comparten_ficha() {
        let (db, path) = setup("test_load_shared.db");
        let conn = db.conn.lock().unwrap();
        let pv = preview_load(&conn, "Xiaomi\n13C (6)\nRedmi 13C (12)\n").unwrap();
        assert_eq!(pv.matched, 2);
        assert_eq!(pv.units, 18);
        assert_eq!(pv.applied_products, 1, "las dos líneas caen en la misma ficha");
        assert_eq!(pv.applied_units, 18, "6 + 12, no 6");
        for r in &pv.rows {
            assert_eq!(r.sum_qty, 18, "la vista previa dice lo que se va a aplicar");
            assert_eq!(r.shared, 1, "la otra línea comparte la ficha");
        }
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// El barrido («la lista es todo») se AVISA antes de aplicar: cuántas fichas y unidades
    /// quedarían en 0, contando el faltante (negativo) como unidades que vuelven.
    #[test]
    fn test_preview_avisa_el_barrido_y_el_faltante() {
        let (db, path) = setup("test_load_sweep.db");
        let pv = {
            let conn = db.conn.lock().unwrap();
            preview_load(&conn, LISTA).unwrap()
        };
        // la lista no nombra el A10 (6 unidades) ni el J7 (faltante de 2)
        assert_eq!(pv.zero_count, 2, "{:?}", pv.rows.iter().map(|r| &r.model).collect::<Vec<_>>());
        assert_eq!(pv.zero_units, 8, "6 + |-2|: lo que el barrido va a mover");
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &pv.rows, true, &[], "").unwrap()
        };
        assert_eq!(report.zeroed, 2);

        let conn = db.conn.lock().unwrap();
        let stock = |name: &str| -> i64 {
            conn.query_row("SELECT COALESCE(stock,0) FROM products WHERE name=?1", params![name], |r| r.get(0)).unwrap()
        };
        assert_eq!(stock("Pantalla Samsung A10"), 0);
        assert_eq!(stock("Pantalla Samsung J7"), 0, "el faltante vuelve a 0");
        assert_eq!(stock("Batería Samsung A30"), 7, "la batería no se barre (otra categoría)");
        // el faltante vuelve como ENTRADA (faltaba mercancía, no sobraba)
        let (tipo, cant): (String, i64) = conn
            .query_row(
                "SELECT m.type, m.quantity FROM inventory_movements m
                 JOIN products p ON p.id = m.product_id
                 WHERE p.name='Pantalla Samsung J7' AND m.reason LIKE 'Carga de inventario%'
                 ORDER BY m.id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(tipo, "entrada");
        assert_eq!(cant, 2);
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Hook manual (no corre en la suite): mide el CRUCE de la lista real del local contra una
    /// copia de la base. Sirve para ver cuántas líneas quedan sin pantalla antes de contar.
    ///
    /// `$env:REGISTRO_PREVIEW_DB="<copia.db>"`
    /// `cd src-tauri; cargo test -- --ignored test_manual_preview_real_list --nocapture`
    #[test]
    #[ignore]
    fn test_manual_preview_real_list() {
        let Ok(db) = std::env::var("REGISTRO_PREVIEW_DB") else { return };
        let list = std::env::var("REGISTRO_PREVIEW_LIST")
            .unwrap_or_else(|_| "../tools/inventario_real.txt".to_string());
        let text = std::fs::read_to_string(&list).expect("lista");
        let database = Database::new(&std::path::PathBuf::from(&db)).expect("db");
        let conn = database.conn.lock().unwrap();
        let pv = preview_load(&conn, &text).expect("preview");
        println!(
            "lines={} matched={} unmatched={} units={} applied_units={} applied_products={} zero_count={} zero_units={} skipped={}",
            pv.lines, pv.matched, pv.unmatched, pv.units, pv.applied_units, pv.applied_products,
            pv.zero_count, pv.zero_units, pv.skipped
        );
        for r in pv.rows.iter().filter(|r| r.product_id.is_none() && r.qty > 0) {
            println!("SIN PANTALLA  {:>4} u.  {:<12} {:<28} ({})", r.qty, r.brand, r.model, r.issue.as_deref().unwrap_or(""));
        }
    }

    /// Asignar a mano: la búsqueda tiene que encontrar una ficha que el cruce NO encontró
    /// («6 c/m Accesorios» en la lista vs «Pantalla Redmi 6 c/m Acasonor» en el catálogo),
    /// sin salirse de las categorías de pantalla.
    #[test]
    fn test_buscar_pantallas_a_mano() {
        let (db, path) = setup("test_load_search.db");
        db.add_product("Pantalla Redmi 6 c/m Acasonor", Some(1), "Xiaomi", "6 c/m Acasonor", "", r#"["Redmi 6"]"#, 5.0, 12.0, 1, 0, 0.0).unwrap();
        db.add_product("Batería Redmi Acasonor", Some(4), "Xiaomi", "6", "", r#"["Redmi 6"]"#, 3.0, 8.0, 9, 0, 0.0).unwrap();
        let conn = db.conn.lock().unwrap();

        let hits = search_targets(&conn, "acasonor", 12).unwrap();
        assert_eq!(hits.len(), 1, "{:?}", hits.iter().map(|c| &c.product_name).collect::<Vec<_>>());
        assert_eq!(hits[0].product_name, "Pantalla Redmi 6 c/m Acasonor");
        assert_eq!(hits[0].quality, "a mano", "la calidad la decide el operario");
        assert_eq!(hits[0].stock, 1);
        assert_eq!(hits[0].category, "Pantalla");

        // por tokens y en cualquier orden (misma búsqueda que el inventario)
        assert_eq!(search_targets(&conn, "redmi acasonor", 12).unwrap().len(), 1);
        assert_eq!(search_targets(&conn, "Redmi 6", 12).unwrap().len(), 1, "el texto pegado tal cual también");
        // una sola letra no busca (no vuelca medio catálogo)
        assert!(search_targets(&conn, "a", 12).unwrap().is_empty());
        // y NUNCA devuelve repuestos de otra categoría (el buscador es de pantallas)
        assert!(!search_targets(&conn, "acasonor", 12).unwrap().iter().any(|c| c.category.contains("Batería")));

        // una vez asignada a mano, la ficha entra en `keep_ids` como cualquier otra
        let asignada = hits[0].product_id;
        let rows = vec![LoadRow { qty: 1, product_id: Some(asignada), ..Default::default() }];
        drop(conn);
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, true, &[asignada], "Cell World").unwrap()
        };
        assert_eq!(report.updated, 1);
        assert_eq!(report.units, 1, "la unidad de la línea a mano se carga");
        assert_eq!(report.unassigned, 0);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_apply_carga_stock_con_respaldo_y_movimientos() {
        let (db, path) = setup("test_load_apply.db");
        let pv = {
            let conn = db.conn.lock().unwrap();
            preview_load(&conn, LISTA).unwrap()
        };
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &pv.rows, true, &[], "").unwrap()
        };
        // A30 (3 unidades, tenía 4) + Spark 8P (2, tenía 0); el A50 (0) ya estaba en 0
        assert_eq!(report.updated, 2);
        assert_eq!(report.units, 5);
        assert!(report.backup.contains("registro_pre_carga_"), "respaldo: {}", report.backup);
        assert!(std::path::Path::new(&report.backup).exists(), "el respaldo existe");

        let conn = db.conn.lock().unwrap();
        let stock = |name: &str| -> i64 {
            conn.query_row("SELECT COALESCE(stock,0) FROM products WHERE name=?1", params![name], |r| r.get(0)).unwrap()
        };
        assert_eq!(stock("Pantalla Samsung A30"), 3);
        assert_eq!(stock("Pantalla Tecno Spark 8P"), 2);
        assert_eq!(stock("Batería Samsung A30"), 7, "la batería no se toca (otra categoría)");
        // movimientos: entrada del Spark (0→2) y salida del A30 (4→3)
        let movs: i64 = conn
            .query_row("SELECT COUNT(*) FROM inventory_movements WHERE reason='Carga de inventario'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(movs, 2, "un movimiento por cambio real de stock");

        // segunda corrida con la MISMA lista: sin cambios de stock (idempotente en datos)
        drop(conn);
        let pv2 = {
            let conn = db.conn.lock().unwrap();
            preview_load(&conn, LISTA).unwrap()
        };
        let r2 = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &pv2.rows, true, &[], "").unwrap()
        };
        assert_eq!(r2.movements, 0, "ya no hay nada que mover");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Defensivo: fichas de OTRA categoría e ids inexistentes no se aplican, y las líneas que
    /// caen en la misma ficha SUMAN sus unidades (no se pisan).
    #[test]
    fn test_apply_suma_repetidas_y_ignora_invalidas() {
        let (db, path) = setup("test_load_hardening.db");
        let (pantalla_id, bateria_id) = {
            let conn = db.conn.lock().unwrap();
            let pantalla: i64 = conn
                .query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0))
                .unwrap();
            let bateria: i64 = conn
                .query_row("SELECT id FROM products WHERE name='Batería Samsung A30'", [], |r| r.get(0))
                .unwrap();
            (pantalla, bateria)
        };
        let rows = vec![
            LoadRow { qty: 2, product_id: Some(pantalla_id), ..Default::default() },
            LoadRow { qty: 9, product_id: Some(pantalla_id), ..Default::default() }, // misma ficha: se SUMA
            LoadRow { qty: 5, product_id: Some(bateria_id), ..Default::default() },  // otra categoría: se ignora
            LoadRow { qty: 3, product_id: Some(999_999), ..Default::default() },     // no existe: se ignora
        ];
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, false, &[], "").unwrap()
        };
        assert_eq!(report.updated, 1, "solo la pantalla válida");
        assert_eq!(report.units, 11, "2 + 9: las unidades reales no se pierden");
        assert_eq!(report.skipped, 2, "otra categoría + inexistente");

        let conn = db.conn.lock().unwrap();
        let stock = |id: i64| -> i64 {
            conn.query_row("SELECT COALESCE(stock,0) FROM products WHERE id=?1", params![id], |r| r.get(0)).unwrap()
        };
        assert_eq!(stock(pantalla_id), 11);
        assert_eq!(stock(bateria_id), 7, "la batería quedó intacta");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Una cantidad absurda (dedo pegado en el teclado) se acota: el stock no se va a las nubes.
    #[test]
    fn test_apply_acota_cantidades_absurdas() {
        let (db, path) = setup("test_load_clamp.db");
        let pantalla_id: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0)).unwrap()
        };
        let solo = vec![LoadRow { qty: 999_999_999, product_id: Some(pantalla_id), ..Default::default() }];
        let r2 = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &solo, false, &[], "").unwrap()
        };
        assert_eq!(r2.units, 100_000, "cantidad acotada");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// El barrido NO lo elige quien llama: siempre son las categorías de pantalla del local,
    /// así un invoke a mano no puede vaciar Batería/Flex.
    #[test]
    fn test_apply_barre_solo_las_categorias_de_pantalla() {
        let (db, path) = setup("test_load_cats.db");
        let pantalla_id: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0)).unwrap()
        };
        let rows = vec![LoadRow { qty: 4, product_id: Some(pantalla_id), ..Default::default() }];
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, true, &[], "").unwrap()
        };
        // el A10 (6) y el J7 (faltante de 2) son pantallas que la lista no nombra → a 0;
        // la batería (categoría 4) ni se mira: el barrido no lo elige quien llama
        assert_eq!(report.zeroed, 2, "solo las pantallas que la lista no nombra");
        let conn = db.conn.lock().unwrap();
        let stock = |name: &str| -> i64 {
            conn.query_row("SELECT COALESCE(stock,0) FROM products WHERE name=?1", params![name], |r| r.get(0)).unwrap()
        };
        assert_eq!(stock("Pantalla Samsung A10"), 0);
        assert_eq!(stock("Pantalla Samsung J7"), 0);
        assert_eq!(stock("Batería Samsung A30"), 7, "el repuesto conserva su stock");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Una cantidad absurda («999999999») se acota YA en el parseo: la vista previa, el botón y
    /// el reporte dicen el mismo número, y la línea queda avisada para que la corrija el operario.
    #[test]
    fn test_parse_acota_una_cantidad_absurda() {
        let (lines, _) = parse_list("Samsung\nA30 (999999999)\n");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].qty, MAX_QTY, "acotada al tope");
        assert!(lines[0].qty_issue, "y la línea se avisa (no se aplica sola)");

        // en la vista previa la fila queda sin producto: la corrige el operario
        let (db, path) = setup("test_load_qty_issue.db");
        let conn = db.conn.lock().unwrap();
        let pv = preview_load(&conn, "Samsung\nA30 (999999999)\n").unwrap();
        assert_eq!(pv.rows[0].qty, MAX_QTY);
        assert!(pv.rows[0].product_id.is_none(), "no se aplica sola");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// GATE DEL BARRIDO: si la lista es TODO y hay líneas con unidades sin pantalla asignada, no
    /// se carga nada. Antes su ficha real terminaba en 0 por no haber coincidido el nombre
    /// (medido en revisión: 79 de 87 fichas barridas estaban escritas en la lista).
    #[test]
    fn test_apply_no_barre_si_hay_lineas_sin_pantalla() {
        let (db, path) = setup("test_load_gate.db");
        let a30: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0)).unwrap()
        };
        let rows = vec![
            LoadRow { qty: 4, product_id: Some(a30), ..Default::default() },
            LoadRow {
                raw: "RMA3 (10)".to_string(),
                brand: "Redmi".to_string(),
                model: "RMA3".to_string(),
                qty: 10,
                ..Default::default()
            },
        ];
        let err = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, true, &[], "").unwrap_err()
        };
        assert!(err.contains("sin pantalla asignada"), "{err}");
        assert!(err.contains("desmarcá"), "el error dice cómo seguir: {err}");

        let conn = db.conn.lock().unwrap();
        let stock = |name: &str| -> i64 {
            conn.query_row("SELECT COALESCE(stock,0) FROM products WHERE name=?1", params![name], |r| r.get(0)).unwrap()
        };
        assert_eq!(stock("Pantalla Samsung A10"), 6, "se cortó ANTES de tocar nada");
        assert_eq!(stock("Pantalla Samsung A30"), 4);
        drop(conn);

        // sin el barrido sí se carga, y el reporte dice qué quedó afuera
        let r = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, false, &[], "").unwrap()
        };
        assert_eq!(r.updated, 1);
        assert_eq!(r.unassigned, 1, "una línea sin pantalla");
        assert_eq!(r.unassigned_units, 10, "con 10 unidades que no se cargaron");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Ni el dueño puede vaciar el inventario con una lista sin líneas asignadas.
    #[test]
    fn test_apply_no_vacia_todo_con_lista_vacia() {
        let (db, path) = setup("test_load_vacio.db");
        let err = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &[], true, &[], "").unwrap_err()
        };
        assert!(err.contains("todo el inventario en 0"), "{err}");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// La cantidad sin leer NO se arregla asignando la pantalla a mano: la línea sigue sin poder
    /// aplicarse (antes, asignar a mano borraba el aviso y se escribían 0 o 100.000 unidades).
    #[test]
    fn test_apply_no_carga_con_la_cantidad_sin_leer() {
        let (db, path) = setup("test_load_qty_gate.db");
        let a30: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0)).unwrap()
        };
        let rows = vec![
            LoadRow { qty: 3, product_id: Some(a30), ..Default::default() },
            LoadRow {
                raw: "A30 (dos)".to_string(),
                brand: "Samsung".to_string(),
                model: "A30".to_string(),
                qty: 0,
                qty_issue: true,
                // el operario le asignó la pantalla a mano: la cantidad sigue sin leerse
                product_id: Some(a30),
                ..Default::default()
            },
        ];
        let err = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, false, &[], "").unwrap_err()
        };
        assert!(err.contains("cantidad sin leer"), "{err}");
        assert!(err.contains("A30 (dos)"), "el error dice cuál línea: {err}");
        let conn = db.conn.lock().unwrap();
        let stock: i64 = conn
            .query_row("SELECT COALESCE(stock,0) FROM products WHERE id=?1", params![a30], |r| r.get(0))
            .unwrap();
        assert_eq!(stock, 4, "no se tocó nada");

        // y si el operario EXCLUYE esa línea, la carga sigue con el resto
        drop(conn);
        let rows2 = vec![
            LoadRow { qty: 3, product_id: Some(a30), ..Default::default() },
            LoadRow { qty: 0, qty_issue: true, excluded: true, ..Default::default() },
        ];
        let r = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows2, true, &[], "").unwrap()
        };
        assert_eq!(r.updated, 1);
        assert_eq!(r.excluded, 1, "el reporte dice que una línea quedó excluida");
        assert_eq!(r.unassigned, 0, "una línea excluida no es una línea sin resolver");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// «Carga rápida»: las líneas que el operario excluye a mano no se cargan, NO bloquean el
    /// barrido y no se cuentan como «sin resolver» (antes había que elegir entre no cargar nada o
    /// asignar una ficha equivocada).
    #[test]
    fn test_apply_excluir_una_linea_no_bloquea_el_barrido() {
        let (db, path) = setup("test_load_excluir.db");
        let a30: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0)).unwrap()
        };
        let rows = vec![
            LoadRow { qty: 5, product_id: Some(a30), ..Default::default() },
            // la línea que no se pudo cruzar: el operario la excluye
            LoadRow {
                raw: "6 c/m Accesorios (1)".to_string(),
                brand: "Xiaomi".to_string(),
                model: "6 c/m Accesorios".to_string(),
                qty: 1,
                excluded: true,
                ..Default::default()
            },
        ];
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, true, &[], "").unwrap()
        };
        assert_eq!(report.updated, 1, "solo la línea que sí cruzó");
        assert_eq!(report.units, 5);
        assert_eq!(report.excluded, 1);
        assert_eq!(report.excluded_units, 1);
        assert_eq!(report.unassigned_units, 0, "excluir no es quedar sin resolver");
        let conn = db.conn.lock().unwrap();
        let stock = |name: &str| -> i64 {
            conn.query_row("SELECT COALESCE(stock,0) FROM products WHERE name=?1", params![name], |r| r.get(0)).unwrap()
        };
        assert_eq!(stock("Pantalla Samsung A30"), 5);
        assert_eq!(stock("Pantalla Samsung A10"), 0, "el barrido igual corrió");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// El PROVEEDOR que trajo la mercancía queda anotado en cada pantalla cargada: el de la línea
    /// si lo tiene, si no el general de la carga.
    #[test]
    fn test_apply_anota_el_proveedor_que_trajo_la_mercancia() {
        let (db, path) = setup("test_load_proveedor.db");
        let (a30, spark) = {
            let conn = db.conn.lock().unwrap();
            let a30: i64 = conn
                .query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0))
                .unwrap();
            let spark: i64 = conn
                .query_row("SELECT id FROM products WHERE name='Pantalla Tecno Spark 8P'", [], |r| r.get(0))
                .unwrap();
            (a30, spark)
        };
        let rows = vec![
            LoadRow { qty: 4, product_id: Some(a30), ..Default::default() },
            // este llegó de otro proveedor: la línea manda sobre el general
            LoadRow { qty: 2, product_id: Some(spark), supplier: "Importadora Sur".to_string(), ..Default::default() },
        ];
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, false, &[], "Cell World").unwrap()
        };
        assert_eq!(report.suppliered, 2);
        let conn = db.conn.lock().unwrap();
        let prov = |name: &str| -> String {
            conn.query_row("SELECT COALESCE(supplier,'') FROM products WHERE name=?1", params![name], |r| r.get(0)).unwrap()
        };
        assert_eq!(prov("Pantalla Samsung A30"), "Cell World", "el general de la carga");
        assert_eq!(prov("Pantalla Tecno Spark 8P"), "Importadora Sur", "el de la línea manda");
        assert_eq!(prov("Batería Samsung A30"), "", "la batería no se toca (otra categoría)");

        // sin proveedor no se pisa el que ya estaba
        drop(conn);
        let rows2 = vec![LoadRow { qty: 4, product_id: Some(a30), ..Default::default() }];
        let r2 = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows2, false, &[], "").unwrap()
        };
        assert_eq!(r2.suppliered, 0);
        let conn = db.conn.lock().unwrap();
        let prov_final: String = conn
            .query_row("SELECT COALESCE(supplier,'') FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(prov_final, "Cell World", "conserva el proveedor anterior");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Las fichas que la vista previa YA tenía asignadas no las toca el barrido: cambiarle el
    /// producto a una línea (o desmarcarla) no puede dejar en 0 una mercancía que sí está.
    #[test]
    fn test_apply_no_barre_la_ficha_que_la_vista_previa_ya_tenia() {
        let (db, path) = setup("test_load_keep.db");
        let (a10, a30) = {
            let conn = db.conn.lock().unwrap();
            let a10: i64 = conn
                .query_row("SELECT id FROM products WHERE name='Pantalla Samsung A10'", [], |r| r.get(0))
                .unwrap();
            let a30: i64 = conn
                .query_row("SELECT id FROM products WHERE name='Pantalla Samsung A30'", [], |r| r.get(0))
                .unwrap();
            (a10, a30)
        };
        let rows = vec![LoadRow { qty: 2, product_id: Some(a30), ..Default::default() }];
        let report = {
            let conn = db.conn.lock().unwrap();
            apply_load(&conn, &path, &rows, true, &[a10], "").unwrap()
        };
        let conn = db.conn.lock().unwrap();
        let stock = |name: &str| -> i64 {
            conn.query_row("SELECT COALESCE(stock,0) FROM products WHERE name=?1", params![name], |r| r.get(0)).unwrap()
        };
        assert_eq!(report.zeroed, 1, "solo el J7 (faltante) queda en 0");
        assert_eq!(stock("Pantalla Samsung A10"), 6, "la ficha de la vista previa conserva su stock");
        assert_eq!(stock("Pantalla Samsung A30"), 2);
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Marca canónica en el gate (una ficha «Redmi» cruza con la sección «Redmi») y contención
    /// por PALABRA completa (el A33 no puede caer en la ficha del A3).
    #[test]
    fn test_preview_marca_canonica_y_sin_falsos_positivos() {
        let (db, path) = setup("test_load_marcas.db");
        db.add_product("Pantalla Redmi RMA3", Some(1), "Redmi", "RMA3", "", r#"["Redmi RMA3"]"#, 5.0, 12.0, 10, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung A3", Some(1), "Samsung", "A3", "", r#"["Samsung A3"]"#, 4.0, 9.0, 5, 0, 0.0).unwrap();
        let conn = db.conn.lock().unwrap();

        // la marca del producto se canonicaliza igual que la de la sección: «Redmi» → «Xiaomi»
        let pv = preview_load(&conn, "Redmi\nRMA3 (10)\n").unwrap();
        assert_eq!(pv.matched, 1, "la ficha «Redmi RMA3» tiene que ser candidata");
        assert_eq!(pv.rows[0].product_name, "Pantalla Redmi RMA3");
        assert_eq!(pv.rows[0].candidates[0].quality, "exacta");

        // «A33 …» NO puede aterrizar en la ficha del A3 (prefijo numérico, no el mismo teléfono)
        let pv2 = preview_load(&conn, "Samsung\nA33 Bateria (1)\n").unwrap();
        assert!(!pv2.rows[0].candidates.iter().any(|c| c.product_name == "Pantalla Samsung A3"),
            "{:?}", pv2.rows[0].candidates.iter().map(|c| &c.product_name).collect::<Vec<_>>());
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
