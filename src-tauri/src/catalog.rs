//! Reglas canónicas del catálogo + limpieza masiva (F2 del plan de inventario).
//!
//! FUENTE DE REGLAS: `tools/canonical_brands.json` (se lee con `include_str!`).
//! El MISMO archivo lo lee `tools/audit_inventory.mjs`, así que la auditoría
//! previa y el dry-run de Rust se pueden comparar número a número. Si no
//! coinciden, hay divergencia de reglas y se corrige ANTES de aplicar nada.
//!
//! Convenciones del local (verificadas contra la lista física del taller):
//!  - Marca = fabricante. "Redmi" NO es marca: es la línea Redmi de Xiaomi.
//!  - Modelo "bien escrito": Title Case por palabra, códigos alfanuméricos en
//!    mayúscula (A06, X7B, 13C), acrónimos en mayúscula (4G, 5G, AM, OLED),
//!    sufijo i/s en minúscula para Infinix/Tecno ("Hot 40i") y "iPhone"/"iPad"
//!    con su grafía real.
//!  - Un producto = una pantalla física (bin). Su `model` es el teléfono
//!    PRINCIPAL; los demás teléfonos compatibles viven en `compatibility`.

use rusqlite::{Connection, params, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::OnceLock;

// ---------------------------------------------------------------- estructura

/// Reglas crudas tal como vienen del JSON compartido con las herramientas node.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RulesFile {
    brands: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    sub_brands: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    sub_brand_key_strippable: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    styled_tokens: BTreeMap<String, String>,
    #[serde(default)]
    acronyms: Vec<String>,
    #[serde(default)]
    lower_suffix_brands: Vec<String>,
    #[serde(default)]
    family_brands: BTreeMap<String, String>,
}

/// Reglas ya indexadas para consultar rápido.
struct Rules {
    /// (alias normalizado, marca canónica) — el alias más largo primero
    brand_aliases: Vec<(String, String)>,
    /// marca canónica -> sus alias normalizados (más largo primero)
    brand_reverse: HashMap<String, Vec<String>>,
    /// (alias normalizado, marca padre) — para submarcas usadas como marca
    sub_aliases: Vec<(String, String)>,
    /// marca -> [(alias normalizado, forma canónica)], alias más largo primero
    sub_canonical: HashMap<String, Vec<(String, String)>>,
    /// marca -> submarcas que se ignoran al AGRUPAR teléfonos
    key_strippable: HashMap<String, Vec<String>>,
    styled: HashMap<String, String>,
    acronyms: HashSet<String>,
    lower_suffix: HashSet<String>,
    /// familia comercial -> marca ("camon" -> Tecno): identifica la marca sola
    family_brands: HashMap<String, String>,
}

const RULES_JSON: &str = include_str!("../../tools/canonical_brands.json");

fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| {
        let raw: RulesFile = serde_json::from_str(RULES_JSON)
            .expect("tools/canonical_brands.json inválido");
        let mut brand_aliases: Vec<(String, String)> = raw
            .brands
            .iter()
            .flat_map(|(brand, aliases)| {
                aliases.iter().map(move |a| (norm(a), brand.clone()))
            })
            .collect();
        brand_aliases.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));

        let mut brand_reverse: HashMap<String, Vec<String>> = HashMap::new();
        for (brand, aliases) in &raw.brands {
            let mut list: Vec<String> = aliases.iter().map(|a| norm(a)).collect();
            list.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
            brand_reverse.insert(brand.clone(), list);
        }

        let mut sub_aliases: Vec<(String, String)> = raw
            .sub_brands
            .iter()
            .flat_map(|(parent, subs)| {
                subs.keys().map(move |alias| (norm(alias), parent.clone()))
            })
            .collect();
        sub_aliases.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));

        let mut sub_canonical: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for (parent, subs) in &raw.sub_brands {
            let mut list: Vec<(String, String)> = subs
                .iter()
                .map(|(alias, canonical)| (norm(alias), canonical.clone()))
                .collect();
            list.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
            sub_canonical.insert(parent.clone(), list);
        }

        let key_strippable = raw
            .sub_brand_key_strippable
            .iter()
            .map(|(brand, aliases)| (brand.clone(), aliases.iter().map(|a| norm(a)).collect()))
            .collect();

        Rules {
            brand_aliases,
            brand_reverse,
            sub_aliases,
            sub_canonical,
            key_strippable,
            styled: raw.styled_tokens.iter().map(|(k, v)| (norm(k), v.clone())).collect(),
            acronyms: raw.acronyms.iter().map(|a| a.to_uppercase()).collect(),
            lower_suffix: raw.lower_suffix_brands.iter().cloned().collect(),
            family_brands: raw
                .family_brands
                .iter()
                .map(|(family, brand)| (norm(family), brand.clone()))
                .collect(),
        }
    })
}

// -------------------------------------------------------------------- normas

/// Normaliza para COMPARAR: minúsculas, sin acentos, solo letras/números.
/// (Debe coincidir con `norm()` de tools/audit_inventory.mjs y con el
/// `norm_model()` histórico del backend.)
pub fn norm(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for ch in s.chars() {
        let flat = match ch {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'Á' | 'À' | 'Ä' | 'Â' | 'Ã' => 'a',
            'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'Ó' | 'Ò' | 'Ö' | 'Ô' | 'Õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'u',
            'ñ' | 'Ñ' => 'n',
            other => other,
        };
        if flat.is_ascii_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(flat.to_ascii_lowercase());
        } else {
            pending_space = true;
        }
    }
    out
}

fn words(s: &str) -> Vec<&str> {
    s.split_whitespace().collect()
}

/// Marca canónica de un valor de la columna `brand`.
/// `Redmi` -> `Xiaomi`; `Lg` -> `LG`; `Zte`/`ZTE` -> `ZTE`; `Iphone` -> `Apple`.
pub fn canonical_brand(raw: &str) -> String {
    let r = rules();
    let n = norm(raw);
    if n.is_empty() {
        return "Genérico".to_string();
    }
    for (alias, brand) in &r.brand_aliases {
        if n == *alias {
            return brand.clone();
        }
    }
    for (alias, parent) in &r.sub_aliases {
        if n == *alias {
            return parent.clone();
        }
    }
    for (alias, brand) in &r.brand_aliases {
        if n.starts_with(&format!("{alias} ")) {
            return brand.clone();
        }
    }
    raw.trim().to_string()
}

/// ¿El texto ES una marca (o su alias), sin nada más? Lo usa el asistente de carga de
/// inventario para reconocer los encabezados de sección de la lista del local
/// («Samsung», «Iphone», «zte»).
pub fn is_brand_alias(text: &str) -> bool {
    let r = rules();
    let n = norm(text);
    r.brand_aliases.iter().any(|(alias, _)| *alias == n)
        || r.sub_aliases.iter().any(|(alias, _)| *alias == n)
}

/// Marca explícita al inicio de un texto ("HONOR X7" -> "Honor"), si la hay.
pub fn explicit_brand(text: &str) -> Option<String> {
    let r = rules();
    let n = norm(text);
    for (alias, brand) in &r.brand_aliases {
        if n.starts_with(&format!("{alias} ")) {
            return Some(brand.clone());
        }
    }
    for (alias, parent) in &r.sub_aliases {
        if n == *alias || n.starts_with(&format!("{alias} ")) {
            return Some(parent.clone());
        }
    }
    None
}

/// ¿Dos marcas son la MISMA? Compara marcas CANÓNICAS (`Redmi` = `Xiaomi`,
/// `Iphone` = `Apple`, `Lg` = `LG`). Una marca vacía o «Genérico» NUNCA coincide: sin marca
/// no hay prueba de que el repuesto sirva, y el gate de marca del servicio
/// (`find_compatible_products`) se apoya en esto para no ofrecer la pantalla de otro
/// teléfono que solo coincide en el texto del modelo.
pub fn same_brand(a: &str, b: &str) -> bool {
    let na = norm(&canonical_brand(a));
    let nb = norm(&canonical_brand(b));
    !na.is_empty() && na == nb && na != "generico"
}

fn canonical_token(token: &str, brand: &str) -> String {
    let r = rules();
    let t = token.trim();
    if t.is_empty() {
        return String::new();
    }
    let key = norm(t);
    if let Some(styled) = r.styled.get(&key) {
        return styled.clone();
    }
    let upper = t.to_uppercase();
    if r.acronyms.contains(&upper) {
        return upper;
    }
    if t.chars().any(|c| c.is_ascii_digit()) {
        // sufijo i/s en minúscula SOLO para Infinix/Tecno ("HOT 30I" -> "Hot 30i");
        // "Spark 10C" y "Spark 8P" se quedan en mayúscula (así los escribe el local)
        let chars: Vec<char> = t.chars().collect();
        let suffix_len = chars.len();
        let is_i_or_s_suffix = suffix_len >= 2
            && matches!(chars[suffix_len - 1], 'i' | 'I' | 's' | 'S')
            && chars[..suffix_len - 1].iter().all(|c| c.is_ascii_digit());
        if is_i_or_s_suffix && r.lower_suffix.contains(brand) {
            return t.to_lowercase();
        }
        return upper;
    }
    let mut cs = t.chars();
    match cs.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), cs.as_str().to_lowercase()),
        None => String::new(),
    }
}

/// Un modelo "bien escrito". Acepta varias alternativas separadas por "/".
pub fn canonical_model(raw: &str, brand: &str) -> String {
    let r = rules();
    let subs = r.sub_canonical.get(brand);
    raw.split('/')
        .map(|part| {
            let mut text = part.replace('-', " ");
            text = words(&text).join(" ");
            if text.is_empty() {
                return String::new();
            }
            // submarca al inicio: "Red Note 11" -> "Redmi Note 11"
            if let Some(subs) = subs {
                let n = norm(&text);
                for (alias, canonical) in subs {
                    let alias_words = alias.split(' ').count();
                    if n == *alias || n.starts_with(&format!("{alias} ")) {
                        let rest: Vec<&str> = words(&text).into_iter().skip(alias_words).collect();
                        text = if rest.is_empty() {
                            canonical.clone()
                        } else {
                            format!("{} {}", canonical, rest.join(" "))
                        };
                        break;
                    }
                }
            }
            words(&text)
                .into_iter()
                .map(|t| canonical_token(t, brand))
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" / ")
}

/// Teléfono canónico: `label` = "Marca [Submarca] Modelo".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Phone {
    pub brand: String,
    pub model: String,
    pub label: String,
}

/// Resuelve una entrada de compatibilidad a un teléfono canónico. Si la entrada
/// nombra otra marca ("HONOR X7" dentro de un producto Blu) se respeta; si no,
/// hereda la marca indicada por el llamador.
pub fn canonical_phone(entry: &str, inherited_brand: &str) -> Phone {
    let r = rules();
    let text = words(&entry.replace('-', " ")).join(" ");
    let n = norm(&text);
    for (alias, brand) in &r.brand_aliases {
        if n.starts_with(&format!("{alias} ")) {
            let skip = alias.split(' ').count();
            let rest: Vec<&str> = words(&text).into_iter().skip(skip).collect();
            let model = canonical_model(&rest.join(" "), brand);
            return Phone {
                brand: brand.clone(),
                model: model.clone(),
                label: format!("{brand} {model}").trim().to_string(),
            };
        }
    }
    // submarca (iPhone, Redmi, Poco…): la marca es la padre y el modelo conserva la submarca
    for (alias, parent) in &r.sub_aliases {
        if n == *alias || n.starts_with(&format!("{alias} ")) {
            let model = canonical_model(&text, parent);
            return Phone {
                brand: parent.clone(),
                model: model.clone(),
                label: format!("{parent} {model}").trim().to_string(),
            };
        }
    }
    let brand = if inherited_brand.trim().is_empty() { "Genérico" } else { inherited_brand };
    let model = canonical_model(&text, brand);
    Phone {
        brand: brand.to_string(),
        model: model.clone(),
        label: format!("{brand} {model}").trim().to_string(),
    }
}

/// Clave de agrupación del teléfono: marca + modelo sin las submarcas
/// "strippables" (Xiaomi red/redmi). Así "Xiaomi Redmi Note 11S 4G" y
/// "Xiaomi Note 11S 4G" son el MISMO teléfono, pero "Xiaomi Mi A2" y
/// "Xiaomi Redmi A2" siguen siendo DOS.
pub fn phone_key(phone: &Phone) -> String {
    let r = rules();
    let mut m = norm(&phone.model);
    if let Some(aliases) = r.key_strippable.get(&phone.brand) {
        for alias in aliases {
            if m == *alias {
                m.clear();
                break;
            }
            if m.starts_with(&format!("{alias} ")) {
                m = m[alias.len() + 1..].to_string();
                break;
            }
        }
    }
    format!("{}|{}", norm(&phone.brand), m)
}

/// Teléfonos canónicos declarados por un producto, aplicando la marca
/// contextual (una entrada sin marca hereda la última marca explícita).
pub fn compat_phones(compatibility: &str, product_brand: &str) -> Vec<Phone> {
    compat_phones_raw(compatibility, product_brand).into_iter().map(|(_, p)| p).collect()
}

/// Limpia una entrada de compatibilidad de los restos del formato de la lista
/// física del local: `"1B (3"` -> `"1B"`, `"4) (1)"` -> `"4"`, `"13 Pro (ORIGINAL)"`
/// -> `"13 Pro"` (el paréntesis describe el REPUESTO, no el teléfono).
pub fn clean_compat_entry(raw: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for ch in raw.chars() {
        match ch {
            '(' => depth += 1,
            ')' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            c => {
                if depth == 0 {
                    out.push(c);
                }
            }
        }
    }
    words(&out.replace('-', " ")).join(" ")
}

/// ¿La entrada quedó en nada útil? (`""`, `"4"`, `"3 4"` = contadores de la lista)
pub fn is_junk_entry(cleaned: &str) -> bool {
    cleaned.trim().is_empty()
        || cleaned.chars().filter(|c| c.is_alphanumeric()).all(|c| c.is_ascii_digit())
}

/// F53 — ¿El token identifica un MODELO por sí solo? (`A70`, `A705`, `MS350`, `13C`, `A035F`).
/// Se exige que tenga letras **y** dígitos: los números puros (`11`, `2019`) son medidas o años y
/// las palabras sueltas (`Note`, `Pro`, `Plus`) describen la familia — ninguno es un teléfono por sí
/// solo. Los sufijos de RED (`4G`, `5G`, `LTE`) quedan afuera a propósito: «A06 4G» es UN teléfono.
fn is_model_code(token: &str) -> bool {
    let t = norm(token);
    if t.is_empty() || matches!(t.as_str(), "2g" | "3g" | "4g" | "5g" | "lte") {
        return false;
    }
    t.chars().any(|c| c.is_ascii_alphabetic()) && t.chars().any(|c| c.is_ascii_digit())
}

/// F53 — PARTIR EL TEXTO DE UN MODELO EN TELÉFONOS REALES (pedido del dueño): «cuando yo busco un
/// Samsung A70 me sale también A705 — ya este viene siendo otro modelo de tlf; debería salir una sola
/// por modelo». `A70 A705` son DOS teléfonos (y la pantalla queda compatible con los DOS, porque el
/// repuesto conserva las dos entradas en su compatibilidad).
///
/// Regla (medida contra las 181 entradas reales del catálogo): se parte cuando el modelo tiene **2 o
/// más CÓDIGOS** (`is_model_code`). Cada parte es
/// **[palabras de familia que van adelante] + [código] + [palabras que lo siguen hasta el próximo
/// código]**: así `Galaxy A70 A705` → `Galaxy A70` + `Galaxy A705`, `K20 Plus MP260` → `K20 Plus` +
/// `MP260` y `A13 4G A135 M13` → `A13 4G` + `A135` + `M13`. Con un solo código (o ninguno) el texto
/// se devuelve tal cual: `Redmi Note 11`, `Galaxy S21 Ultra 5G` y `Alcatel 5001 1V 2019` NO se
/// parten (un solo código cada uno).
pub fn split_model_models(model: &str) -> Vec<String> {
    let texto = model.trim();
    if texto.is_empty() {
        return vec![String::new()];
    }
    let tokens: Vec<&str> = texto.split_whitespace().collect();
    let codes: Vec<usize> = tokens
        .iter()
        .enumerate()
        .filter(|(_, t)| is_model_code(t))
        .map(|(i, _)| i)
        .collect();
    if codes.len() < 2 {
        return vec![texto.to_string()];
    }
    let prefijo = &tokens[..codes[0]];
    let mut parts: Vec<String> = Vec::new();
    for (n, &ci) in codes.iter().enumerate() {
        let end = codes.get(n + 1).copied().unwrap_or(tokens.len());
        let mut palabras: Vec<&str> = prefijo.to_vec();
        palabras.extend(&tokens[ci..end]);
        let parte = palabras.join(" ");
        // nada de partes vacías ni repetidas (el mismo código dos veces en la misma entrada)
        if parte.trim().is_empty() || parts.iter().any(|p| norm(p) == norm(&parte)) {
            continue;
        }
        parts.push(parte);
    }
    if parts.len() < 2 {
        return vec![texto.to_string()];
    }
    parts
}

/// F53 — la VARIANTE que nombra un TEXTO de compatibilidad («Samsung A25 5G OLED C» → `OLED`).
/// Se busca como **palabra completa** (con `contains('am')` «Camon» daría AM, que es un error real
/// que apareció al medir el catálogo) y se le agrega el marco cuando el texto lo dice
/// («OLED Con Marco»), para que el valor guardado sea del mismo vocabulario que ya usa el catálogo.
pub fn variant_in_text(text: &str) -> Option<String> {
    let t = norm(text);
    let palabras: Vec<&str> = t.split(' ').collect();
    let material = ["incell", "incel", "oled", "am", "original", "tactil"]
        .into_iter()
        .find(|m| palabras.contains(m))?;
    let mut v = match material {
        "incell" | "incel" => "INCELL",
        "oled" => "OLED",
        "am" => "AM",
        "original" => "ORIGINAL",
        _ => "TÁCTIL",
    }
    .to_string();
    if t.contains("con marco") {
        v.push_str(" Con Marco");
    } else if t.contains("sin marco") {
        v.push_str(" Sin Marco");
    }
    Some(v)
}

/// Cuenta de palabras de la MARCA real al inicio del texto (no de la línea:
/// "Redmi Note 11" NO se toca, "Infinix Spark 10C" sí).
fn leading_brand_words(text: &str) -> Option<usize> {    let r = rules();
    let n = norm(text);
    r.brand_aliases
        .iter()
        .find(|(alias, _)| n.starts_with(&format!("{alias} ")))
        .map(|(alias, _)| alias.split(' ').count())
}

/// Teléfono canónico con la marca IMPUESTA (sin auto-detección): lo usa la regla
/// de familia, que manda sobre lo que diga el texto.
fn canonical_phone_forced(text: &str, brand: &str) -> Phone {
    let t = words(&text.replace('-', " ")).join(" ");
    let model = canonical_model(&t, brand);
    Phone {
        brand: brand.to_string(),
        model: model.clone(),
        label: format!("{brand} {model}").trim().to_string(),
    }
}

/// Igual que `compat_phones` pero conservando el texto CRUDO (ya limpio) de cada
/// entrada, para guardarlo como alias del teléfono en el padrón.
pub fn compat_phones_raw(compatibility: &str, product_brand: &str) -> Vec<(String, Phone)> {
    let mut current = if product_brand.trim().is_empty() { "Genérico".to_string() } else { product_brand.to_string() };
    let mut out = Vec::new();
    for entry in parse_compat(compatibility) {
        let cleaned = clean_compat_entry(&entry);
        if is_junk_entry(&cleaned) {
            continue;
        }
        // 1º la FAMILIA comercial: es exclusiva de una marca y manda sobre lo que
        //    diga el texto, incluso si el texto trae otra marca delante
        //    ("Infinix Spark 10C" y "ZTE Spark 10C" son el MISMO Tecno Spark 10C).
        let r = rules();
        let family = words(&cleaned)
            .into_iter()
            .map(|w| norm(w))
            .find(|t| r.family_brands.contains_key(t));
        let phone = if let Some(family) = family {
            let brand = r.family_brands.get(&family).cloned().unwrap_or_else(|| current.clone());
            // si el texto traía OTRA marca delante, se quita ("Infinix Spark 10C" -> "Spark 10C")
            let text = match leading_brand_words(&cleaned) {
                Some(k) if words(&cleaned).len() > k => words(&cleaned).into_iter().skip(k).collect::<Vec<_>>().join(" "),
                _ => cleaned.clone(),
            };
            current = brand.clone();
            canonical_phone_forced(&text, &brand)
        } else {
            if let Some(explicit) = explicit_brand(&cleaned) {
                current = explicit;
            }
            canonical_phone(&cleaned, &current)
        };
        // si el MODELO quedó en puros números es un contador de la lista, no un teléfono
        if is_junk_entry(&phone.model) {
            continue;
        }
        // F53 — el texto puede nombrar VARIOS teléfonos («Samsung A70 A705»): cada uno entra al padrón
        // con su nombre limpio y su alias, así el mostrador busca «A70» y le sale A70 (y A705 por su
        // lado), no una ficha confusa con los dos. El repuesto queda compatible con los DOS.
        let partes = split_model_models(&phone.model);
        if partes.len() <= 1 {
            out.push((cleaned, phone));
            continue;
        }
        for parte in partes {
            let p = Phone {
                brand: phone.brand.clone(),
                model: parte.clone(),
                label: format!("{} {}", phone.brand, parte).trim().to_string(),
            };
            if is_junk_entry(&p.model) {
                continue;
            }
            // el alias es el nombre de ESTE teléfono (con su marca): la entrada combinada ya no se
            // guarda como alias de ninguno de los dos (era justamente lo que confundía la búsqueda).
            let alias = format!("{} {}", p.brand, p.model).trim().to_string();
            out.push((alias, p));
        }
    }
    out
}

/// Normaliza SOLO la parte de modelo de un teléfono (sin marca), para comparar
/// lo que escribe el operario ("Red Note 11") contra el catálogo ("Redmi Note 11").
pub fn phone_model_norm(label_or_model: &str) -> String {
    let text = words(&label_or_model.replace('-', " ")).join(" ");
    let n = norm(&text);
    // quita la marca inicial si la trae ("Xiaomi Redmi Note 11" -> "redmi note 11")
    let r = rules();
    for (alias, _brand) in &r.brand_aliases {
        if n.starts_with(&format!("{alias} ")) {
            let skip = alias.split(' ').count();
            let rest: Vec<&str> = words(&text).into_iter().skip(skip).collect();
            return norm(&rest.join(" "));
        }
    }
    n
}

/// ¿`needle` aparece dentro de `hay` como PALABRA completa?
/// Con `contains()` a secas los modelos se cruzaban por prefijos numéricos: «a33 bateria»
/// contenía «a3» (ficha del A3, otro teléfono) y «15» cruzaba con «redmi 15c». Falsos
/// positivos medidos en la revisión de F25, con unidades infladas a la ficha equivocada.
pub fn contains_word(hay: &str, needle: &str) -> bool {
    if needle.is_empty() || hay.len() < needle.len() {
        return false;
    }
    let bytes = hay.as_bytes();
    for (start, _) in hay.match_indices(needle) {
        let end = start + needle.len();
        let before_ok = start == 0 || bytes[start - 1] == b' ';
        let after_ok = end == bytes.len() || bytes[end] == b' ';
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// Calidad de coincidencia entre lo buscado y el teléfono de un producto.
/// Devuelve `None` si no coinciden.
pub fn match_quality(target_model_norm: &str, phone_model: &str) -> Option<&'static str> {
    if target_model_norm.is_empty() {
        return None;
    }
    let pn = phone_model_norm(phone_model);
    if pn.is_empty() {
        return None;
    }
    if pn == target_model_norm {
        return Some("exacta");
    }
    let pref = |a: &str, b: &str| a.starts_with(&format!("{b} "));
    if pref(&pn, target_model_norm) || pref(target_model_norm, &pn) {
        return Some("prefijo");
    }
    // parcial solo con 4+ caracteres y por PALABRA completa (ver `contains_word`): evita que
    // "12" matchee medio catálogo y que "a3" cruce con "a33"
    if target_model_norm.len() >= 4
        && (contains_word(&pn, target_model_norm) || contains_word(target_model_norm, &pn))
    {
        return Some("parcial");
    }
    None
}

fn parse_compat(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return items
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }
    trimmed.split('/').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

/// Texto de búsqueda NORMALIZADO de un producto (columna `products.search_text`).
/// Incluye nombre, marca, modelo, variante y cada teléfono compatible: así una
/// búsqueda por "red note" encuentra "Xiaomi Redmi Note 11".
pub fn search_text(name: &str, brand: &str, model: &str, variant: &str, compatibility: &str) -> String {
    let mut parts = vec![norm(name), norm(brand), norm(model), norm(variant)];
    for entry in parse_compat(compatibility) {
        parts.push(norm(&entry));
    }
    parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ")
}

/// Tokens normalizados de lo que escribió el operario. La búsqueda exige que
/// TODOS aparezcan en `search_text` (AND), en cualquier orden.
pub fn search_tokens(query: &str) -> Vec<String> {
    norm(query).split(' ').map(|s| s.to_string()).filter(|s| !s.is_empty()).collect()
}

/// Condición SQL (AND) de búsqueda por tokens sobre `search_text`.
/// Devuelve la cláusula y los valores para los parámetros `?n` a partir de `first_index`.
pub fn search_clause(tokens: &[String], first_index: usize) -> (String, Vec<String>) {
    if tokens.is_empty() {
        return (String::new(), Vec::new());
    }
    let mut sql = String::new();
    let mut values = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        sql.push_str(&format!(" AND COALESCE(search_text,'') LIKE ?{}", first_index + i));
        values.push(format!("%{token}%"));
    }
    (sql, values)
}

/// Campos de un producto ya normalizados.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NormalizedFields {
    pub brand: String,
    pub model: String,
    pub variant: String,
    pub compatibility: String,
    pub name: String,
    pub phones: Vec<String>,
}

/// Quita la marca repetida al inicio del modelo ("Samsung A06 4G" con marca
/// Samsung -> "A06 4G"; "AMAZON FIRE 7 HD" sin marca -> "Fire 7 HD").
/// NUNCA quita sub-marcas: "iPhone 11" conserva el iPhone.
pub fn strip_brand_prefix(model: &str, brand: &str) -> Option<String> {
    let r = rules();
    let aliases = r.brand_reverse.get(brand)?;
    let n = norm(model);
    for alias in aliases {
        if n.starts_with(&format!("{alias} ")) {
            let skip = alias.split(' ').count();
            let rest: Vec<&str> = words(model).into_iter().skip(skip).collect();
            let rest = rest.join(" ");
            if !rest.trim().is_empty() {
                return Some(rest);
            }
        }
    }
    None
}

/// Normaliza los campos de un producto (función PURA, sin base de datos).
///
/// - `model` queda como el teléfono PRINCIPAL (el primero de la lista).
/// - `compatibility` queda como JSON de etiquetas canónicas ("Marca Modelo"),
///   deduplicadas por teléfono y con el principal primero.
/// - `name` queda "<Categoría> <Marca> <modelos sin la marca del producto> [(Variante)]".
pub fn normalize_fields(
    category: &str,
    brand: &str,
    model: &str,
    variant: &str,
    compatibility: &str,
) -> NormalizedFields {
    let raw_brand = brand.trim();
    let raw_model = model.trim();

    // marca: canónica; si viene vacía se intenta inferir del modelo
    // ("AMAZON FIRE 7 HD 2019" -> Amazon; si no, Genérico)
    let mut brand_out = if raw_brand.is_empty() {
        explicit_brand(raw_model).unwrap_or_else(|| "Genérico".to_string())
    } else {
        canonical_brand(raw_brand)
    };
    if brand_out.is_empty() {
        brand_out = "Genérico".to_string();
    }

    // la marca repetida al inicio del modelo no se duplica en el nombre
    let model_clean = strip_brand_prefix(raw_model, &brand_out).unwrap_or_else(|| raw_model.to_string());
    let c_model = canonical_model(&model_clean, &brand_out);

    // marca CONTEXTUAL entre las entradas de compatibilidad
    let entries = parse_compat(compatibility);
    let mut current_brand = brand_out.clone();
    let mut by_key: BTreeMap<String, String> = BTreeMap::new();
    let mut order: Vec<(String, String)> = Vec::new();
    for entry in &entries {
        if let Some(explicit) = explicit_brand(entry) {
            current_brand = explicit;
        }
        let phone = canonical_phone(entry, &current_brand);
        let key = phone_key(&phone);
        match by_key.get(&key) {
            Some(prev) if prev.len() >= phone.label.len() => {}
            _ => {
                by_key.insert(key.clone(), phone.label.clone());
            }
        }
        order.push((key, phone.label));
    }

    let primary_key = phone_key(&canonical_phone(
        c_model.split(" / ").next().unwrap_or(&c_model),
        &brand_out,
    ));

    // principal primero, el resto alfabético
    let mut labels: Vec<String> = by_key.values().cloned().collect();
    labels.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    if let Some(pos) = labels.iter().position(|l| {
        phone_key(&canonical_phone(l, &brand_out)) == primary_key
    }) {
        let primary = labels.remove(pos);
        labels.insert(0, primary);
    }

    // nombre: se omite la marca del producto al inicio de cada teléfono
    let display: Vec<String> = if labels.is_empty() {
        vec![c_model.clone()]
    } else {
        labels
            .iter()
            .map(|l| {
                if l.to_lowercase().starts_with(&format!("{} ", brand_out.to_lowercase())) {
                    l[brand_out.len() + 1..].to_string()
                } else {
                    l.clone()
                }
            })
            .collect()
    };
    let variant_out = canonical_model(variant.trim(), &brand_out);
    let variant_txt = if variant_out.is_empty() { String::new() } else { format!(" ({variant_out})") };
    let name = words(&format!(
        "{} {} {}{}",
        category.trim(),
        brand_out,
        display.join(" / "),
        variant_txt
    ))
    .join(" ");

    let compat_out = if entries.is_empty() {
        compatibility.trim().to_string()
    } else {
        serde_json::to_string(&labels).unwrap_or_else(|_| compatibility.to_string())
    };

    NormalizedFields {
        brand: brand_out,
        model: c_model.split(" / ").next().unwrap_or(&c_model).to_string(),
        variant: variant_out,
        compatibility: compat_out,
        name,
        phones: labels,
    }
}

// ---------------------------------------------------- padrón de teléfonos

/// Regla del local (2026-09-16): **el taller instala pantallas**, así que el padrón de
/// teléfonos se arma con las categorías de pantalla: `1` = Pantalla, `18` = Táctil y
/// `19` = Táctil Tablet (el táctil es el vidrio del mismo trabajo y el local lo vende).
/// El resto del catálogo (baterías, flex, repuestos, accesorios) **no crea teléfonos**.
pub const PHONE_CATEGORIES: &[i64] = &[1, 18, 19];

/// La categoría "principal" del padrón (la primera del listado anterior).
pub const PHONE_CATEGORY: i64 = PHONE_CATEGORIES[0];

/// Nombre comercial real de un teléfono: separa la LÍNEA (Galaxy / Moto / Redmi / Poco…
/// cuando es segura) del MODELO, y devuelve (line, display).
///   Samsung  A06           -> ("Galaxy", "Galaxy A06")
///   Motorola G52           -> ("Moto",   "Moto G52")
///   Apple    13 Mini       -> ("",       "iPhone 13 Mini")
///   Xiaomi   Redmi Note 11 -> ("Redmi",  "Redmi Note 11")
///   Tecno    Spark 20      -> ("",       "Spark 20")
///   Xiaomi   Poco X3       -> ("Poco",   "Poco X3")   (sin «Mi» ni «Redmi» delante)
///   Honor    X6A           -> ("Honor",  "Honor X6A") (la marca es la línea)
pub fn real_name(brand: &str, model: &str) -> (String, String) {
    let m = model.trim();
    let mn = norm(m);
    let strip_first = |s: &str| words(s).into_iter().skip(1).collect::<Vec<_>>().join(" ");

    let (line, rest) = match brand {
        "Samsung" => {
            if mn.starts_with("galaxy") {
                ("Galaxy".to_string(), strip_first(m))
            } else {
                ("Galaxy".to_string(), m.to_string())
            }
        }
        "Motorola" => {
            if mn.starts_with("moto") {
                ("Moto".to_string(), strip_first(m))
            } else if mn.starts_with("edge") {
                (String::new(), m.to_string())
            } else {
                ("Moto".to_string(), m.to_string())
            }
        }
        "Apple" => {
            if mn.starts_with("iphone") || mn.starts_with("ipad") || mn.starts_with("ipod") {
                (String::new(), m.to_string())
            } else {
                ("iPhone".to_string(), m.to_string())
            }
        }
        // Honor y Realme son marcas propias (dejaron de ser submarcas de Huawei/Oppo):
        // el nombre comercial las lleva delante, la clave no.
        "Honor" => {
            if mn.starts_with("honor") {
                ("Honor".to_string(), strip_first(m))
            } else {
                ("Honor".to_string(), m.to_string())
            }
        }
        "Realme" => {
            if mn.starts_with("realme") {
                ("Realme".to_string(), strip_first(m))
            } else {
                ("Realme".to_string(), m.to_string())
            }
        }
        "Xiaomi" => {
            let first = words(m).first().map(|w| norm(w)).unwrap_or_default();
            // «Mi Poco C40» y «Redmi Poco X3» son «Poco C40» y «Poco X3»: Poco es su propia
            // línea (decisión del local 2026-09-16) y el «Mi»/«Redmi» que la precede es ruido.
            let after_pre = match first.as_str() {
                "mi" | "redmi" => words(m).into_iter().skip(1).collect::<Vec<_>>().join(" "),
                _ => m.to_string(),
            };
            if first == "poco" {
                ("Poco".to_string(), strip_first(m))
            } else if norm(&after_pre).starts_with("poco") {
                ("Poco".to_string(), words(&after_pre).into_iter().skip(1).collect::<Vec<_>>().join(" "))
            } else {
                match first.as_str() {
                    "redmi" => ("Redmi".to_string(), strip_first(m)),
                    "mi" => ("Mi".to_string(), strip_first(m)),
                    _ => (String::new(), m.to_string()),
                }
            }
        }
        _ => (String::new(), m.to_string()),
    };
    let rest = rest.trim().to_string();
    let display = if line.is_empty() { rest.clone() } else { format!("{line} {rest}") };
    (line, display.trim().to_string())
}

/// Modelo SIN la línea, tal como está escrito: si el texto YA empieza con la
/// línea se quita; si la línea se dedujo (Samsung "A06 4G" -> "Galaxy") el modelo
/// queda igual. Así `A06 4G`, `Galaxy A06 4G` y `Samsung Galaxy A06 4G` dan la
/// MISMA clave y no se duplican.
pub fn model_without_line(model: &str, line: &str) -> String {
    let m = model.trim();
    if line.trim().is_empty() {
        return m.to_string();
    }
    let mn = norm(m);
    let ln = norm(line);
    if mn == ln {
        return String::new();
    }
    if mn.starts_with(&format!("{ln} ")) {
        return words(m).into_iter().skip(ln.split(' ').count()).collect::<Vec<_>>().join(" ");
    }
    m.to_string()
}

/// Clave del teléfono en el PADRÓN (la misma que usa `rebuild_phones`).
/// Apple: el "iPhone" es parte del nombre. Poco: la línea es la MARCA comercial del
/// teléfono (decisión del local 2026-09-16), así «Poco X3» y «Redmi Poco X3» —que hoy
/// dan `xiaomi|x3` y `xiaomi|poco x3`— caen en la MISMA clave. El resto: marca + modelo sin línea.
pub fn phone_registry_key(phone: &Phone) -> String {
    let (line, display) = real_name(&phone.brand, &phone.model);
    let model = if phone.brand == "Apple" || line == "Poco" {
        display
    } else {
        model_without_line(&phone.model, &line)
    };
    registry_key(&phone.brand, &model)
}

/// Clave ÚNICA de un teléfono en el padrón: marca + modelo sin la línea.
/// Es la garantía de "nada repetido": `A06` = `Galaxy A06` = `Samsung Galaxy A06`.
pub fn registry_key(brand: &str, model_without_line: &str) -> String {
    format!("{}|{}", norm(brand), norm(model_without_line))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhoneRebuildReport {
    pub dry_run: bool,
    pub products: i64,
    /// teléfonos distintos que salieron de la compatibilidad del catálogo
    pub phones: i64,
    pub created: i64,
    pub updated: i64,
    pub unchanged: i64,
    /// filas viejas del catálogo que ya no existen (se limpian)
    pub removed: i64,
    /// teléfonos a los que les falta la familia en el nombre (revisar/renombrar)
    pub needs_review: i64,
    /// entradas de compatibilidad basura descartadas (contadores de la lista física)
    pub dropped_entries: i64,
    /// entradas de compatibilidad que apuntan al MISMO teléfono (dedupe)
    pub merged_entries: i64,
    pub samples: Vec<CatalogSample>,
}

/// Reconstruye el padrón de teléfonos (`phones`) desde la compatibilidad del
/// catálogo. Idempotente: la segunda corrida no cambia nada.
/// NUNCA borra filas agregadas a mano (`source = 'manual'`).
pub fn rebuild_phones(conn: &Connection, dry_run: bool) -> SqlResult<PhoneRebuildReport> {
    // Autosuficiente: crea la tabla/columna si falta, para poder reconstruir el
    // padrón de una base externa (copia, PC de la tienda) sin abrir la app.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS phones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand TEXT NOT NULL, line TEXT NOT NULL DEFAULT '', model TEXT NOT NULL,
            name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, aliases TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'catalogo', needs_review INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_phones_key ON phones(key);
        CREATE INDEX IF NOT EXISTS idx_phones_brand ON phones(brand);",
    )?;
    if conn.prepare("SELECT needs_review FROM phones LIMIT 1").is_err() {
        let _ = conn.execute_batch("ALTER TABLE phones ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;");
    }

    // 1) juntar todos los teléfonos declarados por los productos
    let mut map: BTreeMap<String, (String, String, String, String, BTreeSet<String>)> = BTreeMap::new();
    // CLAVES RECLAMADAS por filas escritas a mano: si el taller RENOMBRÓ un teléfono,
    // sus alias (cómo estaba escrito en el inventario) reclaman la clave vieja para que
    // el catálogo no vuelva a crear la fila con el nombre que ya se corrigió.
    let claimed: BTreeSet<String> = {
        let mut set = BTreeSet::new();
        let mut stmt = conn.prepare(
            "SELECT COALESCE(aliases,'[]'), COALESCE(brand,''), COALESCE(key,'') FROM phones WHERE source='manual'",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        for row in rows {
            let (aliases, brand, own_key) = row?;
            for a in parse_compat(&aliases) {
                let phone = canonical_phone(&a, &brand);
                let k = phone_registry_key(&phone);
                // la clave propia de la fila no se reclama (esa fila existe)
                if k != own_key {
                    set.insert(k);
                }
            }
        }
        set
    };
    let products: Vec<(i64, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(brand,''), COALESCE(compatibility,'')
             FROM products
             WHERE COALESCE(compatibility,'') NOT IN ('','[]')
               AND COALESCE(category_id,0) IN (
                   SELECT value FROM json_each(?1)
               )
             ORDER BY id",
        )?;
        let cats_json = serde_json::to_string(PHONE_CATEGORIES).unwrap_or_else(|_| "[1]".to_string());
        let rows = stmt.query_map(params![cats_json], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<SqlResult<Vec<_>>>()?
    };
    let products_count = products.len() as i64;
    let mut merged_entries = 0i64;
    let mut dropped_entries = 0i64;
    for (_id, brand, compat) in &products {
        let raw_count = parse_compat(compat).len() as i64;
        let phones = compat_phones_raw(compat, brand);
        // con el split de F53 una entrada puede dar MÁS de un teléfono: lo «descartado» nunca es
        // negativo (una entrada que se parte no perdió nada, se repartió).
        dropped_entries += (raw_count - phones.len() as i64).max(0);
        for (raw, phone) in phones {
            let (line, display) = real_name(&phone.brand, &phone.model);
            // En Apple el "iPhone" ES parte del nombre del teléfono (no una línea
            // publicitaria): la clave usa el nombre completo para no duplicar
            // "iPhone 11" con "11". En Poco pasa lo mismo desde 2026-09-16.
            let key = phone_registry_key(&phone);
            // el taller ya corrigió ese nombre a mano → no se resucita la fila vieja
            if claimed.contains(&key) {
                dropped_entries += 1;
                continue;
            }
            let key_model = phone_registry_key(&phone).split('|').nth(1).unwrap_or("").to_string();
            // si la clave ya existe, esta entrada se está DEDUPLICANDO
            if map.contains_key(&key) {
                merged_entries += 1;
            }
            let entry = map.entry(key).or_insert_with(|| {
                (phone.brand.clone(), line.clone(), key_model.clone(), display.clone(), BTreeSet::new())
            });
            // el nombre más completo gana
            if display.len() > entry.3.len() {
                entry.3 = display.clone();
                entry.1 = line.clone();
            }
            // alias = cómo estaba escrito en el inventario
            entry.4.insert(phone.model.clone());
            entry.4.insert(raw);
        }
    }

    // 2) comparar con lo que ya hay en la tabla
    // `source` viaja en la tupla: una fila MANUAL (renombrada o fusionada por el taller)
    // NO se pisa — sobrescribirle los alias borraría el vínculo con los repuestos.
    let existing: BTreeMap<String, (i64, String, String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, key, COALESCE(brand,''), COALESCE(line,''), COALESCE(name,''),
                    COALESCE(source,'catalogo')
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
            ))
        })?;
        let mut out = BTreeMap::new();
        for row in rows {
            let (id, key, brand, line, name, source) = row?;
            out.insert(key, (id, brand, line, name, source));
        }
        out
    };

    let mut report = PhoneRebuildReport {
        dry_run,
        products: products_count,
        phones: map.len() as i64,
        merged_entries,
        dropped_entries,
        ..Default::default()
    };

    for (key, (brand, line, model, display, aliases)) in &map {
        let aliases_json = serde_json::to_string(&aliases.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_else(|_| "[]".to_string());
        // "por revisar" = sin familia y con nombre que no se explica solo ("8P", "18i", "11T Pro")
        let first_is_digit = model.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);
        let needs_review = if line.is_empty() && (first_is_digit || model.chars().count() <= 4) { 1i64 } else { 0i64 };
        if needs_review == 1 {
            report.needs_review += 1;
        }
        match existing.get(key) {
            None => {
                report.created += 1;
                if report.samples.len() < 12 {
                    report.samples.push(CatalogSample {
                        id: 0,
                        field: "phone".to_string(),
                        before: String::new(),
                        after: format!("{brand} {display}"),
                    });
                }
                if !dry_run {
                    conn.execute(
                        "INSERT OR IGNORE INTO phones (brand, line, model, name, key, aliases, source, needs_review)
                         VALUES (?1,?2,?3,?4,?5,?6,'catalogo',?7)",
                        params![brand, line, model, display, key, aliases_json, needs_review],
                    )?;
                }
            }
            Some((id, ex_brand, ex_line, ex_name, ex_source)) => {
                // fila MANUAL (renombrada o fusionada por el taller): el catálogo NO la pisa
                // (pisarle los alias borraría su vínculo con los repuestos y la reclamación
                // de la clave vieja). Solo se refresca el flag de revisión.
                if ex_source == "manual" {
                    report.unchanged += 1;
                    if !dry_run {
                        let _ = conn.execute("UPDATE phones SET needs_review=?1 WHERE id=?2", params![needs_review, id]);
                    }
                    continue;
                }
                if ex_brand != brand || ex_line != line || ex_name != display {
                    report.updated += 1;
                    if report.samples.len() < 12 {
                        report.samples.push(CatalogSample {
                            id: *id,
                            field: "phone".to_string(),
                            before: format!("{ex_brand} {ex_name}"),
                            after: format!("{brand} {display}"),
                        });
                    }
                    if !dry_run {
                        conn.execute(
                            "UPDATE phones SET brand=?1, line=?2, model=?3, name=?4, aliases=?5,
                                      needs_review=?7, updated_at=datetime('now','localtime')
                             WHERE id=?6",
                            params![brand, line, model, display, aliases_json, id, needs_review],
                        )?;
                    }
                } else {
                    report.unchanged += 1;
                    if !dry_run {
                        let _ = conn.execute("UPDATE phones SET needs_review=?1 WHERE id=?2", params![needs_review, id]);
                    }
                }
            }
        }
    }

    // 3) RECONCILIACIÓN: las filas que venían del catálogo y ya no existen se
    //    borran (así no quedan nombres repetidos de corridas viejas). Las filas
    //    agregadas a mano o renombradas por el local NUNCA se tocan.
    if !dry_run {
        let mut stale: Vec<i64> = Vec::new();
        {
            let mut stmt = conn.prepare("SELECT id, key FROM phones WHERE source='catalogo'")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (id, key) = row?;
                if !map.contains_key(&key) {
                    stale.push(id);
                }
            }
        }
        for id in &stale {
            conn.execute("DELETE FROM phones WHERE id=?1", params![id])?;
        }
        report.removed = stale.len() as i64;
    }

    Ok(report)
}

// --------------------------------------------------- limpieza de productos

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DedupeReport {
    pub dry_run: bool,
    pub groups: i64,
    pub kept: i64,
    pub removed: i64,
    pub compat_added: i64,
    pub samples: Vec<CatalogSample>,
}

/// Variante para AGRUPAR productos: INCELL es la genérica del taller, así que
/// cuenta igual que "sin variante". OLED/AM/ORIGINAL sí son repuestos distintos.
pub fn variant_key(variant: &str) -> String {
    let v = norm(variant);
    if v == "incell" { String::new() } else { v }
}

// ── F52 — FAMILIA y ORDEN de las variantes (lo que el local pide en el mostrador) ──────────────
// Las variantes REALES del catálogo son: INCELL · OLED · «OLED Con Marco» · ORIGINAL ·
// «INCELL Con Marco» · «ORIGINAL Con Marco» · «ORIGINAL Sin Marco» (y 613 fichas SIN variante).
// Para el mostrador la FAMILIA es el MATERIAL (la primera palabra): quien pide «una OLED» acepta
// OLED y OLED Con Marco. El marco es un detalle que se dice aparte y NO cambia la familia.
// Es la única regla que usan el filtro del inventario y los chips de la vista «Por modelo»
// (en SQL se escribe la MISMA regla — primera palabra del texto recortado — y hay un test que
// compara las dos implementaciones contra los valores reales del catálogo).

/// Familia de una variante: `OLED Con Marco` → `oled` · `AM (OLED)` → `am` · `""` → `""`.
pub fn variant_family(variant: &str) -> String {
    norm(variant).split(' ').next().unwrap_or("").to_string()
}

/// ¿La variante pertenece a la familia pedida? (`family` vacía = las que NO tienen familia).
pub fn variant_is_family(variant: &str, family: &str) -> bool {
    variant_family(variant) == norm(family)
}

/// Orden canónico para MOSTRAR: sin variante primero (es la ficha genérica), después el material
/// en el orden en que lo pide el taller (INCELL → OLED → AM → ORIGINAL), y dentro de cada familia el
/// repuesto PELADO antes que sus variantes de marco («OLED» → «OLED Con Marco» → «OLED Sin Marco»).
pub fn variant_rank(variant: &str) -> (u8, u8, String) {
    let v = norm(variant);
    let pos = match variant_family(&v).as_str() {
        "" => 0,
        "incell" => 1,
        "oled" => 2,
        "am" => 3,
        "original" => 4,
        "service" => 5,
        _ => 6,
    };
    let marco = if v.contains("con marco") {
        1
    } else if v.contains("sin marco") {
        2
    } else {
        0
    };
    (pos, marco, v)
}

/// Ordena (y deduplica dejando vacíos afuera) una lista de variantes para mostrarla.
pub fn sort_variants(list: &mut Vec<String>) {
    list.retain(|v| !v.trim().is_empty());
    list.sort_by_key(|v| variant_rank(v));
    list.dedup();
}

/// Deja UN solo producto por modelo duplicado (misma marca+modelo+variante) y
/// conserva el de MAYOR compatibilidad: une la lista de teléfonos de todos los
/// duplicados en el que se queda, repunta movimientos/ventas/servicios/pedidos
/// y borra los demás.
pub fn merge_duplicate_products(conn: &Connection, dry_run: bool) -> SqlResult<DedupeReport> {
    let mut cats: HashMap<i64, String> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, name FROM categories")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (id, name) = row?;
            cats.insert(id, name);
        }
    }

    struct P {
        id: i64,
        name: String,
        brand: String,
        model: String,
        variant: String,
        compat: String,
        category_id: Option<i64>,
    }
    let rows: Vec<P> = {
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(name,''), COALESCE(brand,''), COALESCE(model,''),
                    COALESCE(variant,''), COALESCE(compatibility,''), category_id
             FROM products ORDER BY id",
        )?;
        let mapped = stmt.query_map([], |r| {
            Ok(P {
                id: r.get(0)?, name: r.get(1)?, brand: r.get(2)?, model: r.get(3)?,
                variant: r.get(4)?, compat: r.get(5)?, category_id: r.get(6)?,
            })
        })?;
        mapped.collect::<SqlResult<Vec<_>>>()?
    };

    let mut groups: BTreeMap<String, Vec<&P>> = BTreeMap::new();
    for p in &rows {
        let n = normalize_fields("", &p.brand, &p.model, &p.variant, "");
        // Apple: el "iPhone" es parte del nombre (evita "Apple 11" vs "Apple iPhone 11")
        let model_key = if n.brand == "Apple" {
            let (_, display) = real_name(&n.brand, &n.model);
            display
        } else {
            n.model.clone()
        };
        let key = format!("{}|{}|{}", norm(&n.brand), norm(&model_key), variant_key(&n.variant));
        groups.entry(key).or_default().push(p);
    }

    let mut report = DedupeReport { dry_run, ..Default::default() };
    for (_key, members) in groups.iter().filter(|(_, m)| m.len() > 1) {
        report.groups += 1;
        // keeper = el de MÁS teléfonos compatibles (empate → el id más bajo)
        let mut ordered: Vec<&P> = members.to_vec();
        ordered.sort_by_key(|p| {
            let n = normalize_fields("", &p.brand, &p.model, &p.variant, &p.compat);
            (std::cmp::Reverse(n.phones.len()), p.id)
        });
        let keeper = ordered[0];
        let cat = keeper.category_id.and_then(|c| cats.get(&c)).cloned().unwrap_or_default();

        // unión de teléfonos conservando el orden (principal primero)
        let mut merged: Vec<String> = Vec::new();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut before = 0usize;
        for (i, p) in ordered.iter().enumerate() {
            let n = normalize_fields(&cat, &p.brand, &p.model, &p.variant, &p.compat);
            if i == 0 {
                before = n.phones.len();
            }
            for label in n.phones {
                let key = phone_key(&canonical_phone(&label, &n.brand));
                if seen.insert(key) {
                    merged.push(label);
                }
            }
        }
        let compat_json = serde_json::to_string(&merged).unwrap_or_else(|_| "[]".to_string());
        let new_name = normalize_fields(&cat, &keeper.brand, &keeper.model, &keeper.variant, &compat_json).name;
        let added = merged.len().saturating_sub(before);
        report.compat_added += added as i64;

        if report.samples.len() < 10 {
            report.samples.push(CatalogSample {
                id: keeper.id,
                field: "merge".to_string(),
                before: format!(
                    "{} fichas: {}",
                    members.len(),
                    members.iter().map(|p| p.name.clone()).collect::<Vec<_>>().join(" + ")
                ),
                after: format!("{new_name} ({} teléfonos)", merged.len()),
            });
        }

        if !dry_run {
            conn.execute(
                "UPDATE products SET compatibility=?1, name=?2, updated_at=datetime('now','localtime') WHERE id=?3",
                params![compat_json, new_name, keeper.id],
            )?;
            for p in ordered.iter().skip(1) {
                for sql in [
                    "UPDATE inventory_movements SET product_id=?1 WHERE product_id=?2",
                    "UPDATE sales SET product_id=?1 WHERE product_id=?2",
                    "UPDATE services SET screen_product_id=?1 WHERE screen_product_id=?2",
                    "UPDATE purchase_order_items SET product_id=?1 WHERE product_id=?2",
                ] {
                    let _ = conn.execute(sql, params![keeper.id, p.id]);
                }
                conn.execute("DELETE FROM products WHERE id=?1", params![p.id])?;
                report.removed += 1;
            }
        } else {
            report.removed += (members.len() - 1) as i64;
        }
        report.kept += 1;
    }

    Ok(report)
}

/// Deja stock y precios en CERO en todos los productos (los datos de inventario
/// de prueba no son reales). NO toca movimientos, ventas ni servicios.
pub fn wipe_stock_and_prices(conn: &Connection, dry_run: bool) -> SqlResult<i64> {
    if dry_run {
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM products WHERE stock<>0 OR COALESCE(price_cost,0)<>0
                OR COALESCE(price_sale,0)<>0 OR COALESCE(price_usd,0)<>0",
            [],
            |r| r.get(0),
        )?;
        return Ok(n);
    }
    conn.execute(
        "UPDATE products SET stock=0, price_cost=0, price_sale=0, price_usd=0,
                             updated_at=datetime('now','localtime')",
        [],
    )?;
    Ok(conn.changes() as i64)
}

// --------------------------------------------------------------- precios

/// Una ficha de la lista de precios (formato de `cellworld_items.json`).
#[derive(Debug, Clone, Deserialize)]
pub struct PriceItem {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub brand: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub price_cost: Option<f64>,
    #[serde(default)]
    pub price_sale: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PriceSample {
    pub product_id: i64,
    pub name: String,
    pub before_cost: f64,
    pub before_sale: f64,
    pub after_cost: f64,
    pub after_sale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PriceRestoreReport {
    pub dry_run: bool,
    pub items: i64,
    /// fichas que encontraron al menos un producto
    pub matched: i64,
    /// productos cuyo precio se escribió (o se escribiría)
    pub updated: i64,
    /// fichas que cayeron en más de un producto (se actualizan todos y se avisa)
    pub ambiguous: i64,
    /// fichas sin producto en el catálogo
    pub unmatched: i64,
    /// productos que ya tenían precio y NO se tocaron (`only_zero`)
    pub already_priced: i64,
    pub samples: Vec<PriceSample>,
    pub unmatched_samples: Vec<String>,
}

/// Clave de match de precio: marca + modelo principal + variante, canónicos y
/// normalizados. Funciona con el catálogo ya limpio o con el viejo.
fn price_key(brand: &str, model: &str, variant: &str) -> String {
    let n = normalize_fields("", brand, model, variant, "");
    format!("{}|{}|{}", norm(&n.brand), norm(&n.model), norm(&n.variant))
}

/// Busca el archivo de lista de precios: junto al .exe, en tools/ del proyecto
/// o en el directorio actual (mismo patrón que el script de Excel).
pub fn find_price_list_file() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("cellworld_items.json"));
            candidates.push(dir.join("tools").join("cellworld_items.json"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("cellworld_items.json"));
        candidates.push(cwd.join("tools").join("cellworld_items.json"));
    }
    candidates.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../cellworld_items.json"));
    candidates.into_iter().find(|p| p.is_file())
}

/// Restaura precio de costo/venta desde una lista (JSON con `price_cost`/`price_sale`)
/// cruzando marca+modelo+variante canónicos.
///
/// - `only_zero = true` (recomendado): NO pisa precios ya cargados a mano.
/// - `dry_run = true`: no escribe nada, solo reporta los 3 cubos (match / ambiguo / sin match).
/// No crea productos: a diferencia de `import_price_list`, solo ACTUALIZA los existentes.
pub fn restore_prices(
    conn: &Connection,
    items_json: &str,
    only_zero: bool,
    dry_run: bool,
) -> SqlResult<PriceRestoreReport> {
    let items: Vec<PriceItem> = serde_json::from_str(items_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    // índice de productos por clave de precio
    let mut index: HashMap<String, Vec<PriceSample>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(name,''), COALESCE(brand,''), COALESCE(model,''),
                    COALESCE(variant,''), COALESCE(price_cost,0), COALESCE(price_sale,0)
             FROM products",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, f64>(5)?,
                r.get::<_, f64>(6)?,
            ))
        })?;
        for row in rows {
            let (id, name, brand, model, variant, cost, sale) = row?;
            let key = price_key(&brand, &model, &variant);
            index.entry(key).or_default().push(PriceSample {
                product_id: id,
                name,
                before_cost: cost,
                before_sale: sale,
                after_cost: cost,
                after_sale: sale,
            });
        }
    }

    let mut report = PriceRestoreReport { dry_run, items: items.len() as i64, ..Default::default() };
    let mut updates: Vec<PriceSample> = Vec::new();

    for item in &items {
        let brand = item.brand.clone().unwrap_or_default();
        let mut model = item.model.clone().unwrap_or_default();
        if model.trim().is_empty() {
            // ficha sin model: se usa el nombre sin el prefijo de categoría
            let name = item.name.clone().unwrap_or_default();
            model = name
                .split_whitespace()
                .skip(1)
                .collect::<Vec<_>>()
                .join(" ");
        }
        let variant = item.variant.clone().unwrap_or_default();
        let cost = item.price_cost.unwrap_or(0.0);
        let sale = item.price_sale.unwrap_or(0.0);
        if cost <= 0.0 && sale <= 0.0 {
            continue; // ficha sin precios: no aporta nada
        }

        match index.get(&price_key(&brand, &model, &variant)) {
            Some(cands) if !cands.is_empty() => {
                report.matched += 1;
                if cands.len() > 1 {
                    report.ambiguous += 1;
                }
                for c in cands {
                    if only_zero && (c.before_cost > 0.0 || c.before_sale > 0.0) {
                        report.already_priced += 1;
                        continue;
                    }
                    let mut updated = c.clone();
                    updated.after_cost = cost;
                    updated.after_sale = sale;
                    updates.push(updated);
                }
            }
            _ => {
                report.unmatched += 1;
                if report.unmatched_samples.len() < 12 {
                    report.unmatched_samples.push(format!("{brand} {model} {variant}").trim().to_string());
                }
            }
        }
    }

    report.updated = updates.len() as i64;
    report.samples = updates.iter().take(12).cloned().collect();

    if !dry_run && !updates.is_empty() {
        let tx = conn.unchecked_transaction()?;
        for u in &updates {
            tx.execute(
                "UPDATE products SET price_cost=?1, price_sale=?2,
                                     updated_at=datetime('now','localtime') WHERE id=?3",
                params![u.after_cost, u.after_sale, u.product_id],
            )?;
        }
        tx.commit()?;
    }

    Ok(report)
}

// ------------------------------------------------------------ limpieza masiva

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogSample {
    pub id: i64,
    pub field: String,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogReport {
    pub dry_run: bool,
    pub products: i64,
    pub brands_fixed: i64,
    pub models_fixed: i64,
    pub models_split: i64,
    pub names_fixed: i64,
    pub compat_fixed: i64,
    pub variants_fixed: i64,
    /// teléfonos distintos con las reglas canónicas (lo que mostrará "Por modelo")
    pub phones_canonical: i64,
    /// etiquetas crudas distintas (como se ve hoy, con duplicados)
    pub phone_labels_raw: i64,
    pub duplicate_groups: i64,
    pub duplicate_ids: Vec<i64>,
    pub stock_units: i64,
    /// filas a las que se les (re)generó el texto de búsqueda
    pub search_fixed: i64,
    /// ruta del respaldo previo (solo cuando se APLICÓ de verdad)
    pub backup: Option<String>,
    pub samples: Vec<CatalogSample>,
}

/// Normaliza TODO el catálogo. Con `dry_run = true` solo cuenta y devuelve
/// muestras (no escribe NADA). Idempotente: correrlo dos veces no cambia nada.
pub fn normalize_catalog(conn: &Connection, dry_run: bool) -> SqlResult<CatalogReport> {
    // La columna search_text la crea la migración de init(); aquí se asegura
    // también para poder limpiar una base externa (copia, PC de la tienda) sin
    // abrir la app.
    let has_search_text = conn.prepare("SELECT search_text FROM products LIMIT 1").is_ok();
    if !has_search_text {
        conn.execute_batch("ALTER TABLE products ADD COLUMN search_text TEXT;")?;
    }

    let mut cats: HashMap<i64, String> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, name FROM categories")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (id, name) = row?;
            cats.insert(id, name);
        }
    }

    struct Row {
        id: i64,
        category_id: Option<i64>,
        name: String,
        brand: String,
        model: String,
        variant: String,
        compatibility: String,
        search_text: String,
        stock: i64,
    }

    let rows: Vec<Row> = {
        let mut stmt = conn.prepare(
            "SELECT id, category_id, COALESCE(name,''), COALESCE(brand,''), COALESCE(model,''),
                    COALESCE(variant,''), COALESCE(compatibility,''), COALESCE(search_text,''),
                    COALESCE(stock,0)
             FROM products ORDER BY id",
        )?;
        let mapped = stmt.query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                category_id: r.get(1)?,
                name: r.get(2)?,
                brand: r.get(3)?,
                model: r.get(4)?,
                variant: r.get(5)?,
                compatibility: r.get(6)?,
                search_text: r.get(7)?,
                stock: r.get(8)?,
            })
        })?;
        mapped.collect::<SqlResult<Vec<_>>>()?
    };

    let mut report = CatalogReport { dry_run, products: rows.len() as i64, ..Default::default() };
    let mut updates: Vec<(i64, NormalizedFields, String, String, String, String)> = Vec::new();
    let mut canonical_keys: BTreeSet<String> = BTreeSet::new();
    let mut raw_labels: BTreeSet<String> = BTreeSet::new();
    let mut dup_map: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    let mut samples: Vec<CatalogSample> = Vec::new();

    for row in &rows {
        let category = row.category_id.and_then(|id| cats.get(&id)).cloned().unwrap_or_default();
        let n = normalize_fields(&category, &row.brand, &row.model, &row.variant, &row.compatibility);

        report.stock_units += row.stock;
        for entry in parse_compat(&row.compatibility) {
            raw_labels.insert(norm(&entry));
        }
        for label in &n.phones {
            canonical_keys.insert(phone_key(&canonical_phone(label, &n.brand)));
        }

        let mut changed = false;
        let note = |field: &str, before: &str, after: &str, samples: &mut Vec<CatalogSample>| {
            if samples.len() < 14 {
                samples.push(CatalogSample {
                    id: row.id,
                    field: field.to_string(),
                    before: before.to_string(),
                    after: after.to_string(),
                });
            }
        };

        if n.brand != row.brand {
            report.brands_fixed += 1;
            changed = true;
            note("brand", &row.brand, &n.brand, &mut samples);
        }
        if n.model != row.model {
            report.models_fixed += 1;
            changed = true;
            if row.model.contains('/') {
                report.models_split += 1;
            }
            note("model", &row.model, &n.model, &mut samples);
        }
        if n.variant != row.variant {
            report.variants_fixed += 1;
            changed = true;
            note("variant", &row.variant, &n.variant, &mut samples);
        }
        if n.compatibility != row.compatibility {
            report.compat_fixed += 1;
            changed = true;
            note("compatibility", &row.compatibility, &n.compatibility, &mut samples);
        }
        if n.name != row.name {
            report.names_fixed += 1;
            changed = true;
            note("name", &row.name, &n.name, &mut samples);
        }

        // el texto de búsqueda se regenera si falta o quedó viejo (idempotente)
        let search = search_text(&n.name, &n.brand, &n.model, &n.variant, &n.compatibility);
        if row.search_text != search {
            report.search_fixed += 1;
            changed = true;
        }

        let primary = n.model.to_lowercase();
        let dup_key = format!("{}|{}|{}", norm(&n.brand), norm(&primary), norm(&n.variant));
        dup_map.entry(dup_key).or_default().push(row.id);

        if changed {
            updates.push((row.id, n, row.brand.clone(), row.model.clone(), row.variant.clone(), row.name.clone()));
        }
    }

    report.phone_labels_raw = raw_labels.len() as i64;
    report.phones_canonical = canonical_keys.len() as i64;
    report.duplicate_groups = dup_map.values().filter(|ids| ids.len() > 1).count() as i64;
    report.duplicate_ids = dup_map
        .values()
        .filter(|ids| ids.len() > 1)
        .flat_map(|ids| ids.iter().copied())
        .collect();
    report.samples = samples;

    if !dry_run {
        let tx = conn.unchecked_transaction()?;
        for (id, n, brand_before, model_before, variant_before, name_before) in &updates {
            let _ = (brand_before, model_before, variant_before, name_before);
            let search = search_text(&n.name, &n.brand, &n.model, &n.variant, &n.compatibility);
            tx.execute(
                "UPDATE products SET name=?1, brand=?2, model=?3, variant=?4, compatibility=?5,
                                     search_text=?6, updated_at=datetime('now','localtime')
                 WHERE id=?7",
                params![n.name, n.brand, n.model, n.variant, n.compatibility, search, id],
            )?;
        }
        tx.commit()?;
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_brand_canonical_map() {
        assert_eq!(canonical_brand("Redmi"), "Xiaomi");
        assert_eq!(canonical_brand("REDMI"), "Xiaomi");
        assert_eq!(canonical_brand("Lg"), "LG");
        assert_eq!(canonical_brand("Zte"), "ZTE");
        assert_eq!(canonical_brand("ZTE"), "ZTE");
        assert_eq!(canonical_brand("Iphone"), "Apple");
        assert_eq!(canonical_brand("Generico"), "Genérico");
        assert_eq!(canonical_brand("Google Pixel"), "Google");
        assert_eq!(canonical_brand("Samsung"), "Samsung");
        assert_eq!(canonical_brand(""), "Genérico");
    }

    /// Gate de marca del servicio (B2): dos marcas son la misma solo si lo son de verdad.
    #[test]
    fn test_same_brand_gate() {
        assert!(same_brand("Redmi", "Xiaomi"));   // submarca del mismo fabricante
        assert!(same_brand("Iphone", "Apple"));
        assert!(same_brand("lg", "LG"));
        assert!(same_brand("Samsung", "samsung"));
        assert!(!same_brand("Honor", "Infinix"));
        assert!(!same_brand("Umidigi", "Samsung"));
        assert!(!same_brand("Realme", "Xiaomi"));
        // sin marca NO hay coincidencia: es lo que evita elegir la pantalla de otro teléfono
        assert!(!same_brand("", "Honor"));
        assert!(!same_brand("Genérico", "Honor"));
        assert!(!same_brand("Genérico", ""));     // dos «sin marca» tampoco prueban nada
        assert!(!same_brand("Genérico", "Genérico"));
    }

    #[test]
    fn test_model_conventions() {
        // submarca Xiaomi
        assert_eq!(canonical_model("Red Note 11", "Xiaomi"), "Redmi Note 11");
        assert_eq!(canonical_model("Redmi 11S 4g", "Xiaomi"), "Redmi 11S 4G");
        assert_eq!(canonical_model("Poco x6 pro", "Xiaomi"), "Poco X6 Pro");
        // códigos alfanuméricos en mayúscula, palabras en Title Case
        assert_eq!(canonical_model("A80 PLUS", "Blu"), "A80 Plus");
        assert_eq!(canonical_model("5028 1S 2020", "Alcatel"), "5028 1S 2020");
        // acrónimos
        assert_eq!(canonical_model("13 PRO MAX AM", "Apple"), "13 Pro Max AM");
        // guión -> espacio (evita el teléfono duplicado "G51-5G")
        assert_eq!(canonical_model("G51-5G", "Motorola"), "G51 5G");
        // grafía real de Apple
        assert_eq!(canonical_model("iphone 11", "Apple"), "iPhone 11");
        // sufijo i/s minúscula solo en Infinix/Tecno
        assert_eq!(canonical_model("Hot 40i", "Infinix"), "Hot 40i");
        assert_eq!(canonical_model("HOT 30I", "Infinix"), "Hot 30i");
        assert_eq!(canonical_model("20i", "Huawei"), "20I");
        // varias alternativas (la marca dentro del modelo también va en Title Case)
        assert_eq!(canonical_model("G73 / g73l / HONOR X7", "Blu"), "G73 / G73L / Honor X7");
    }

    #[test]
    fn test_phone_and_key() {
        let p = canonical_phone("HONOR X7", "Blu");
        assert_eq!(p.brand, "Honor");
        assert_eq!(p.label, "Honor X7");
        // el mismo teléfono con y sin submarca comparte clave
        let a = canonical_phone("Xiaomi Redmi Note 11S 4G", "Xiaomi");
        let b = canonical_phone("Note 11S 4G", "Xiaomi");
        assert_eq!(phone_key(&a), phone_key(&b));
        // pero Mi A2 y Redmi A2 son teléfonos distintos
        let c = canonical_phone("Mi A2", "Xiaomi");
        let d = canonical_phone("Redmi A2", "Xiaomi");
        assert_ne!(phone_key(&c), phone_key(&d));
    }

    #[test]
    fn test_normalize_fields_splits_multi_model() {
        let n = normalize_fields(
            "Pantalla",
            "Blu",
            "G73 / G73L / HONOR X7",
            "",
            r#"["G73","G73L","HONOR X7"]"#,
        );
        assert_eq!(n.brand, "Blu");
        assert_eq!(n.model, "G73"); // el principal (primero) queda en model
        assert_eq!(n.phones, vec!["Blu G73", "Blu G73L", "Honor X7"]);
        assert_eq!(n.name, "Pantalla Blu G73 / G73L / Honor X7");
        let compat: Vec<String> = serde_json::from_str(&n.compatibility).unwrap();
        assert_eq!(compat, vec!["Blu G73", "Blu G73L", "Honor X7"]);
    }

    #[test]
    fn test_normalize_fields_infers_brand_from_model() {
        let n = normalize_fields("Táctil Tablet", "", "AMAZON FIRE 7 HD 2019", "", "");
        assert_eq!(n.brand, "Amazon");
        assert_eq!(n.name, "Táctil Tablet Amazon Fire 7 HD 2019");
        let g = normalize_fields("Táctil Tablet", "", "287 3G", "", "");
        assert_eq!(g.brand, "Genérico");
    }

    #[test]
    fn test_normalize_fields_contextual_brand() {
        // las entradas sin marca heredan la última marca explícita del producto
        let n = normalize_fields(
            "Pantalla",
            "Huawei",
            "HONOR 10 LITE  / 20i / 20 LITE",
            "",
            r#"["HONOR 10 LITE","20i","20 LITE"]"#,
        );
        let compat: Vec<String> = serde_json::from_str(&n.compatibility).unwrap();
        // principal primero, el resto alfabético ("20 Lite" antes que "20I")
        assert_eq!(compat, vec!["Honor 10 Lite", "Honor 20 Lite", "Honor 20I"]);
        assert_eq!(n.name, "Pantalla Huawei Honor 10 Lite / Honor 20 Lite / Honor 20I");
    }

    #[test]
    fn test_normalize_catalog_dry_run_and_apply() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category_id INTEGER,
                brand TEXT, model TEXT, variant TEXT, compatibility TEXT, price_cost REAL DEFAULT 0,
                price_sale REAL DEFAULT 0, stock INTEGER DEFAULT 0, min_stock INTEGER DEFAULT 0,
                created_at TEXT, updated_at TEXT, search_text TEXT);
             INSERT INTO categories (id, name) VALUES (1, 'Pantalla');
             INSERT INTO products (id, name, category_id, brand, model, variant, compatibility, stock)
                VALUES (1, 'Pantalla REDMI 10 5g', 1, 'Redmi', 'REDMI 10 5g', '', '[\"Redmi 10 5g\"]', 3),
                       (2, 'Pantalla Red 10 5G', 1, 'Redmi', 'Red 10 5G', '', '[\"Red 10 5G\"]', 2);",
        )
        .unwrap();

        let dry = normalize_catalog(&conn, true).unwrap();
        assert!(dry.dry_run);
        assert_eq!(dry.products, 2);
        assert_eq!(dry.stock_units, 5);
        // nada se escribió todavía
        let name: String = conn.query_row("SELECT name FROM products WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Pantalla REDMI 10 5g");

        let applied = normalize_catalog(&conn, false).unwrap();
        assert!(!applied.dry_run);
        let (name1, brand1, model1): (String, String, String) = conn
            .query_row("SELECT name, brand, model FROM products WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(brand1, "Xiaomi");
        assert_eq!(model1, "Redmi 10 5G");
        assert_eq!(name1, "Pantalla Xiaomi Redmi 10 5G");

        // los dos productos son el MISMO teléfono -> grupo duplicado detectado
        assert_eq!(applied.duplicate_groups, 1);
        assert_eq!(applied.duplicate_ids.len(), 2);

        // idempotente: una segunda corrida no cambia nada
        let again = normalize_catalog(&conn, false).unwrap();
        assert_eq!(again.brands_fixed, 0);
        assert_eq!(again.models_fixed, 0);
        assert_eq!(again.names_fixed, 0);
        assert_eq!(again.compat_fixed, 0);
    }

    #[test]
    fn test_restore_prices_match_only_zero_and_unmatched() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category_id INTEGER,
                brand TEXT, model TEXT, variant TEXT, compatibility TEXT, price_cost REAL DEFAULT 0,
                price_sale REAL DEFAULT 0, stock INTEGER DEFAULT 0, min_stock INTEGER DEFAULT 0,
                created_at TEXT, updated_at TEXT, search_text TEXT);
             INSERT INTO products (id, name, brand, model, variant, price_cost, price_sale) VALUES
                (1, 'Pantalla Alcatel 5001 1V 2019', 'Alcatel', '5001 1V 2019', '', 0, 0),
                (2, 'Pantalla Xiaomi Redmi 10 4G', 'Xiaomi', 'Redmi 10 4G', '', 5, 9),
                (3, 'Pantalla Blu A80 Plus', 'Blu', 'A80 PLUS', '', 0, 0);",
        )
        .unwrap();

        // la ficha vieja dice "Redmi"/"Red 10 4G": el match es por clave canónica
        let items = r#"[
            {"brand":"Alcatel","model":"5001 1V 2019","price_cost":12,"price_sale":15},
            {"brand":"Redmi","model":"Red 10 4G","price_cost":10,"price_sale":20},
            {"brand":"Blu","model":"A80 PLUS","price_cost":7,"price_sale":11},
            {"brand":"Nokia","model":"3310","price_cost":3,"price_sale":5}
        ]"#;

        let dry = restore_prices(&conn, items, true, true).unwrap();
        assert!(dry.dry_run);
        assert_eq!(dry.items, 4);
        assert_eq!(dry.matched, 3);
        assert_eq!(dry.updated, 2);          // id1 e id3 (id2 ya tenía precio)
        assert_eq!(dry.already_priced, 1);
        assert_eq!(dry.unmatched, 1);
        assert_eq!(dry.ambiguous, 0);
        // dry-run no escribió nada
        let cost: f64 = conn.query_row("SELECT price_cost FROM products WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(cost, 0.0);

        let applied = restore_prices(&conn, items, true, false).unwrap();
        assert_eq!(applied.updated, 2);
        let (c1, s1): (f64, f64) = conn
            .query_row("SELECT price_cost, price_sale FROM products WHERE id=1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((c1, s1), (12.0, 15.0));
        let (c2, s2): (f64, f64) = conn
            .query_row("SELECT price_cost, price_sale FROM products WHERE id=2", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((c2, s2), (5.0, 9.0)); // precio a mano intacto (only_zero)
    }

    /// Hook manual para restaurar precios contra una base real:
    ///   $env:REGISTRO_PRICES_DB="C:\ruta\copia.db"; cargo test -- --ignored test_manual_restore_prices --nocapture
    /// Con `REGISTRO_PRICES_APPLY=1` escribe (sin la variable solo dry-run).
    #[test]
    #[ignore = "manual: restaura precios en la base indicada en REGISTRO_PRICES_DB"]
    fn test_manual_restore_prices() {
        let path = std::env::var("REGISTRO_PRICES_DB").expect("define REGISTRO_PRICES_DB");
        let apply = std::env::var("REGISTRO_PRICES_APPLY").map(|v| v == "1").unwrap_or(false);
        let file = find_price_list_file().expect("no encontré cellworld_items.json");
        let content = std::fs::read_to_string(&file).unwrap();
        let conn = Connection::open(&path).unwrap();
        let r = restore_prices(&conn, &content, true, !apply).unwrap();
        println!(
            "lista {} | fichas {} | match {} | actualizados {} | ambiguos {} | sin match {} | ya tenían precio {}",
            file.display(), r.items, r.matched, r.updated, r.ambiguous, r.unmatched, r.already_priced
        );
        for s in r.samples.iter().take(5) {
            println!(
                "  id{} {} -> costo {:.2} venta {:.2} (antes {:.2}/{:.2})",
                s.product_id, s.name, s.after_cost, s.after_sale, s.before_cost, s.before_sale
            );
        }
        if !r.unmatched_samples.is_empty() {
            println!("  sin match (ej.): {}", r.unmatched_samples.join(" | "));
        }
    }

    #[test]
    fn test_real_name_lines() {
        assert_eq!(real_name("Samsung", "A06"), ("Galaxy".to_string(), "Galaxy A06".to_string()));
        assert_eq!(real_name("Samsung", "Galaxy A06"), ("Galaxy".to_string(), "Galaxy A06".to_string()));
        assert_eq!(real_name("Motorola", "G52"), ("Moto".to_string(), "Moto G52".to_string()));
        assert_eq!(real_name("Motorola", "Moto G52"), ("Moto".to_string(), "Moto G52".to_string()));
        assert_eq!(real_name("Motorola", "Edge 30"), ("".to_string(), "Edge 30".to_string()));
        assert_eq!(real_name("Apple", "iPhone 13 Mini"), ("".to_string(), "iPhone 13 Mini".to_string()));
        assert_eq!(real_name("Xiaomi", "Redmi Note 11"), ("Redmi".to_string(), "Redmi Note 11".to_string()));
        assert_eq!(real_name("Xiaomi", "Poco X6 Pro"), ("Poco".to_string(), "Poco X6 Pro".to_string()));
        assert_eq!(real_name("Tecno", "Spark 20"), ("".to_string(), "Spark 20".to_string()));
        assert_eq!(real_name("ZTE", "Blade A34"), ("".to_string(), "Blade A34".to_string()));
        // Poco es línea propia: «Mi Poco X» y «Redmi Poco X» se muestran como «Poco X»
        assert_eq!(real_name("Xiaomi", "Mi Poco C40"), ("Poco".to_string(), "Poco C40".to_string()));
        assert_eq!(real_name("Xiaomi", "Redmi Poco X3"), ("Poco".to_string(), "Poco X3".to_string()));
        assert_eq!(real_name("Xiaomi", "Poco F3"), ("Poco".to_string(), "Poco F3".to_string()));
        // «Mi 10 Lite» sigue siendo la línea Mi (no todo lo que trae Mi es Poco)
        assert_eq!(real_name("Xiaomi", "Mi 10 Lite"), ("Mi".to_string(), "Mi 10 Lite".to_string()));
        assert_eq!(real_name("Xiaomi", "Redmi Note 11"), ("Redmi".to_string(), "Redmi Note 11".to_string()));
        // Honor y Realme son marcas propias: la marca es la línea del nombre
        assert_eq!(real_name("Honor", "X6A"), ("Honor".to_string(), "Honor X6A".to_string()));
        assert_eq!(real_name("Honor", "Honor X6A"), ("Honor".to_string(), "Honor X6A".to_string()));
        assert_eq!(real_name("Realme", "C35"), ("Realme".to_string(), "Realme C35".to_string()));
        assert_eq!(real_name("Realme", "Realme C35"), ("Realme".to_string(), "Realme C35".to_string()));
    }

    /// Contención por PALABRA completa: los modelos comparten prefijos numéricos y con
    /// `contains()` a secas se cruzaban entre sí (falsos positivos medidos en la revisión de
    /// F25: «a3» con «a33 bateria», «15» con «redmi 15c» — unidades a la ficha equivocada).
    #[test]
    fn test_contencion_por_palabra_completa() {
        assert!(contains_word("redmi 15", "15"), "el 15 es una palabra del nombre");
        assert!(contains_word("redmi 9a umidigi", "9a"), "«9a» es palabra y el nombre sigue");
        assert!(!contains_word("redmi 15c", "15"), "el 15 no puede cruzar con el 15C");
        assert!(!contains_word("a33 bateria", "a3"), "el a3 no puede cruzar con el a33");
        assert!(!contains_word("pantalla samsung a30", "a3"));
        assert!(contains_word("spark 10 pro", "spark 10"), "«spark 10» está al inicio");
        assert!(!contains_word("", "a30"));
        assert!(!contains_word("a30", ""));

        // y en la calidad de coincidencia: el A3 no matchea el A33 ni el 15 el 15C
        assert_eq!(match_quality("a33 bateria", "A3"), None, "otro teléfono");
        assert_eq!(match_quality("a33", "A33"), Some("exacta"));
        assert_eq!(match_quality("redmi 15", "REDMI 15C"), None);
        assert_eq!(match_quality("spark 10", "SPARK 10 PRO"), Some("prefijo"));
        assert_eq!(match_quality("redmi 9a umidigi", "9A"), Some("parcial"));
    }

    /// Reglas aprobadas por el local (2026-09-16): Poco es línea propia (la clave conserva
    /// «poco») y Honor/Realme mandan sobre la marca madre.
    #[test]
    fn test_reglas_poco_honor_realme() {
        // --- POCO: «Poco X3» y «Redmi Poco X3» son el MISMO teléfono ---
        let poco_x3 = phone_registry_key(&canonical_phone("Poco X3", "Xiaomi"));
        let redmi_poco_x3 = phone_registry_key(&canonical_phone("Redmi Poco X3", "Xiaomi"));
        let mi_poco_x3 = phone_registry_key(&canonical_phone("Mi Poco X3", "Xiaomi"));
        assert_eq!(poco_x3, "xiaomi|poco x3", "la clave conserva la línea Poco");
        assert_eq!(poco_x3, redmi_poco_x3, "«Poco X3» y «Redmi Poco X3» son el mismo teléfono");
        assert_eq!(poco_x3, mi_poco_x3, "«Mi Poco X3» también");
        // y NO se mezclan con el Redmi X3 ni con el Poco X3 Pro
        assert_ne!(poco_x3, phone_registry_key(&canonical_phone("Redmi X3", "Xiaomi")));
        assert_ne!(poco_x3, phone_registry_key(&canonical_phone("Poco X3 Pro", "Xiaomi")));

        // --- HONOR: la familia manda sobre la marca escrita (path real del padrón) ---
        let honor_full = compat_phones(r#"["Huawei Honor X6A"]"#, "Huawei");
        assert_eq!(honor_full.len(), 1);
        assert_eq!(honor_full[0].brand, "Honor", "la marca es Honor, no Huawei");
        let honor_solo = compat_phones(r#"["Honor X6A"]"#, "Honor");
        assert_eq!(
            phone_registry_key(&honor_full[0]),
            phone_registry_key(&honor_solo[0]),
            "«Huawei Honor X6A» y «Honor X6A» son el mismo teléfono"
        );
        assert_eq!(phone_registry_key(&honor_solo[0]), "honor|x6a");
        assert_eq!(real_name(&honor_solo[0].brand, &honor_solo[0].model).1, "Honor X6A", "nombre comercial");

        // --- REALME: ídem (dejó de ser submarca de Oppo) ---
        let realme_full = compat_phones(r#"["Oppo Realme C35"]"#, "Oppo");
        assert_eq!(realme_full[0].brand, "Realme");
        let realme_solo = compat_phones(r#"["Realme C35"]"#, "Realme");
        assert_eq!(phone_registry_key(&realme_full[0]), phone_registry_key(&realme_solo[0]));
        assert_eq!(phone_registry_key(&realme_solo[0]), "realme|c35");

        // el camino completo del padrón (compatibilidad del producto) aplica las mismas reglas
        let phones = compat_phones(r#"["Huawei Honor X6A","Oppo Realme C35","Redmi Poco X3","Poco X3"]"#, "Blu");
        let keys: Vec<String> = phones.iter().map(phone_registry_key).collect();
        assert_eq!(keys.iter().filter(|k| *k == "honor|x6a").count(), 1);
        assert_eq!(keys.iter().filter(|k| *k == "realme|c35").count(), 1);
        assert_eq!(keys.iter().filter(|k| *k == "xiaomi|poco x3").count(), 2, "las dos formas del Poco X3: {keys:?}");
    }

    #[test]
    fn test_registry_key_es_la_garantia_de_no_duplicar() {
        // A06 == Galaxy A06 (la línea no cambia el teléfono)
        assert_eq!(registry_key("Samsung", "A06"), registry_key("Samsung", "A06"));
        // teléfonos DISTINTOS que jamás se deben fusionar
        assert_ne!(registry_key("Xiaomi", "Mi A2"), registry_key("Xiaomi", "Redmi A2"));
        assert_ne!(registry_key("Samsung", "A16 4G"), registry_key("Samsung", "A16 5G"));
        assert_ne!(registry_key("Samsung", "A06"), registry_key("Motorola", "A06"));
    }

    #[test]
    fn test_rebuild_phones_dedupe_e_idempotencia() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, brand TEXT, model TEXT,
                variant TEXT, compatibility TEXT, price_cost REAL DEFAULT 0, price_sale REAL DEFAULT 0,
                stock INTEGER DEFAULT 0, min_stock INTEGER DEFAULT 0, created_at TEXT,
                updated_at TEXT, search_text TEXT, category_id INTEGER);
             CREATE TABLE phones (id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL,
                line TEXT NOT NULL DEFAULT '', model TEXT NOT NULL, name TEXT NOT NULL,
                key TEXT NOT NULL UNIQUE, aliases TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'catalogo', needs_review INTEGER NOT NULL DEFAULT 0,
                created_at TEXT, updated_at TEXT);
             -- el MISMO teléfono escrito de 3 formas distintas (categoría Pantalla: el padrón
             -- se arma solo con esa categoría, regla del local)
             INSERT INTO products (id, name, brand, model, compatibility, category_id) VALUES
                (1, 'Pantalla Redmi Note 11', 'Xiaomi', 'Redmi Note 11', '[\"Red Note 11\",\"Redmi Note 11\",\"Note 11\"]', 1),
                (2, 'Pantalla Samsung A06 4G', 'Samsung', 'A06 4G', '[\"Samsung A06 4G\",\"Galaxy A06 4G\"]', 1),
                (3, 'Pantalla Tecno Spark 20', 'Tecno', 'Spark 20', '[\"Tecno Spark 20\"]', 1),
                (4, 'Batería Samsung A06', 'Samsung', 'A06', '[\"Samsung A06\"]', 4);",
        )
        .unwrap();

        let dry = rebuild_phones(&conn, true).unwrap();
        assert!(dry.dry_run);
        assert_eq!(dry.phones, 3, "tres teléfonos distintos: {:?}", dry.samples);
        assert_eq!(dry.created, 3);
        assert!(dry.merged_entries >= 3, "las escrituras repetidas cuentan como dedupe: {}", dry.merged_entries);
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM phones", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "el dry-run no escribe");

        let applied = rebuild_phones(&conn, false).unwrap();
        assert_eq!(applied.created, 3);
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM phones", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 3);
        // nombre comercial real con la línea
        let samsung: String = conn
            .query_row("SELECT name FROM phones WHERE key='samsung|a06 4g'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(samsung, "Galaxy A06 4G");
        let xiaomi: String = conn
            .query_row("SELECT name FROM phones WHERE key=?1", params![registry_key("Xiaomi", "Note 11")], |r| r.get(0))
            .unwrap();
        assert_eq!(xiaomi, "Redmi Note 11");

        // idempotente
        let again = rebuild_phones(&conn, false).unwrap();
        assert_eq!(again.created, 0);
        assert_eq!(again.updated, 0);
        assert_eq!(again.unchanged, 3);
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM phones", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 3, "seguimos con 3: nada duplicado");
    }

    /// Hook manual: limpia una base de prueba (stock/precios a 0 y fusiona
    /// productos duplicados dejando el de mayor compatibilidad).
    ///   $env:REGISTRO_WIPE_DB="C:\ruta\copia.db"; cargo test -- --ignored test_manual_wipe_and_dedupe --nocapture
    /// Con `REGISTRO_WIPE_APPLY=1` escribe (respalda antes).
    #[test]
    #[ignore = "manual: aplica wipe + dedupe en REGISTRO_WIPE_DB"]
    fn test_manual_wipe_and_dedupe() {
        let path = std::env::var("REGISTRO_WIPE_DB").expect("define REGISTRO_WIPE_DB");
        let apply = std::env::var("REGISTRO_WIPE_APPLY").map(|v| v == "1").unwrap_or(false);
        let conn = Connection::open(&path).unwrap();
        if apply {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
            let stamp: String = conn
                .query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))
                .unwrap();
            let dir = std::path::Path::new(&path).parent().unwrap().join("backup");
            std::fs::create_dir_all(&dir).unwrap();
            let dest = dir.join(format!("registro_pre_wipe_{stamp}.db"));
            std::fs::copy(&path, &dest).expect("respaldo");
            println!("respaldo -> {}", dest.display());
        }

        let dry_wipe = wipe_stock_and_prices(&conn, true).unwrap();
        let dry_dedupe = merge_duplicate_products(&conn, true).unwrap();
        println!("DRY  wipe: {dry_wipe} productos con stock/precio distinto de 0");
        println!(
            "DRY  duplicados: {} grupos | se quitan {} fichas | +{} teléfonos ganados al fusionar",
            dry_dedupe.groups, dry_dedupe.removed, dry_dedupe.compat_added
        );

        if apply {
            let wiped = wipe_stock_and_prices(&conn, false).unwrap();
            let dedupe = merge_duplicate_products(&conn, false).unwrap();
            let phones = rebuild_phones(&conn, false).unwrap();
            println!("APLICADO wipe: {wiped} filas | duplicados: {} grupos, {} fichas borradas", dedupe.groups, dedupe.removed);
            println!("padrón: {} teléfonos", phones.phones);
            for s in dedupe.samples.iter().take(8) {
                println!("  {} -> {}", s.before, s.after);
            }
        }
    }

    /// Hook manual: arma el padrón de teléfonos de una base concreta.
    ///   $env:REGISTRO_PHONES_DB="C:\ruta\copia.db"; cargo test -- --ignored test_manual_rebuild_phones --nocapture
    /// Con `REGISTRO_PHONES_APPLY=1` escribe (sin la variable solo dry-run).
    #[test]
    #[ignore = "manual: reconstruye el padrón de teléfonos de REGISTRO_PHONES_DB"]
    fn test_manual_rebuild_phones() {
        let path = std::env::var("REGISTRO_PHONES_DB").expect("define REGISTRO_PHONES_DB");
        let apply = std::env::var("REGISTRO_PHONES_APPLY").map(|v| v == "1").unwrap_or(false);
        let conn = Connection::open(&path).unwrap();
        if apply {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
            let stamp: String = conn
                .query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))
                .unwrap();
            let dir = std::path::Path::new(&path).parent().unwrap().join("backup");
            std::fs::create_dir_all(&dir).unwrap();
            let dest = dir.join(format!("registro_pre_telefonos_{stamp}.db"));
            std::fs::copy(&path, &dest).expect("respaldo");
            println!("respaldo -> {}", dest.display());
        }
        let r = rebuild_phones(&conn, !apply).unwrap();
        println!(
            "productos {} | teléfonos distintos {} | creados {} | actualizados {} | sin cambios {} | entradas deduplicadas {}",
            r.products, r.phones, r.created, r.updated, r.unchanged, r.merged_entries
        );
        for s in r.samples.iter().take(8) {
            println!("  {} -> {}", if s.before.is_empty() { "(nuevo)" } else { &s.before }, s.after);
        }
    }

    /// Hook manual (no corre por defecto) para limpiar una base concreta sin abrir la app:
    ///   $env:REGISTRO_NORMALIZE_DB="C:\ruta\copia.db"; cargo test -- --ignored test_manual_normalize_db --nocapture
    /// Con `REGISTRO_NORMALIZE_APPLY=1` APLICA (hace respaldo antes); sin la variable solo dry-run.
    #[test]
    #[ignore = "manual: limpia la base indicada en REGISTRO_NORMALIZE_DB"]
    fn test_manual_normalize_db() {
        let path = std::env::var("REGISTRO_NORMALIZE_DB")
            .expect("define REGISTRO_NORMALIZE_DB con la ruta del .db");
        let apply = std::env::var("REGISTRO_NORMALIZE_APPLY").map(|v| v == "1").unwrap_or(false);
        let conn = Connection::open(&path).expect("no se pudo abrir la base");
        if apply {
            let dir = std::path::Path::new(&path).parent().unwrap().join("backup");
            std::fs::create_dir_all(&dir).unwrap();
            let stamp: String = conn
                .query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))
                .unwrap();
            let dest = dir.join(format!("registro_pre_normalizacion_{stamp}.db"));
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
            std::fs::copy(&path, &dest).expect("no se pudo respaldar");
            println!("respaldo -> {}", dest.display());
        }
        let r = normalize_catalog(&conn, !apply).unwrap();
        println!(
            "productos {} | marcas {} | modelos {} (multi {}) | variantes {} | compat {} | nombres {} | duplicados {} | telefonos {} (crudos {}) | unidades {}",
            r.products, r.brands_fixed, r.models_fixed, r.models_split, r.variants_fixed,
            r.compat_fixed, r.names_fixed, r.duplicate_groups, r.phones_canonical,
            r.phone_labels_raw, r.stock_units
        );
        assert!(r.products > 0);
    }

    #[test]
    fn test_split_model_models_real_cases() {
        // Casos REALES medidos en el catálogo del local (181 entradas con 2+ códigos).
        for (texto, esperado) in [
            // el caso del dueño: son DOS teléfonos, y la pantalla sirve para los dos
            ("A70 A705", vec!["A70", "A705"]),
            ("Galaxy A70 A705", vec!["Galaxy A70", "Galaxy A705"]),
            ("A16 4G A165", vec!["A16 4G", "A165"]),
            ("A13 4G A135 M13", vec!["A13 4G", "A135", "M13"]),
            ("K20 Plus MP260", vec!["K20 Plus", "MP260"]),
            ("A01 Core A013", vec!["A01 Core", "A013"]),
            ("Y6 2019 8A", vec!["Y6 2019", "8A"]),
            // NO se parten: un solo código (o ninguno)
            ("Redmi Note 11", vec!["Redmi Note 11"]),
            ("A06 4G", vec!["A06 4G"]),
            ("Galaxy S21 Ultra 5G", vec!["Galaxy S21 Ultra 5G"]),
            ("Redmi 9A", vec!["Redmi 9A"]),
            ("iPhone 11 Pro Max", vec!["iPhone 11 Pro Max"]),
            ("5001 1V 2019", vec!["5001 1V 2019"]),
            ("", vec![""]),
        ] {
            assert_eq!(split_model_models(texto), esperado.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                "el split de «{texto}» no es el esperado");
        }
    }

    #[test]
    fn test_split_model_models_match_node_fixtures() {
        // F55 — PARIDAD node <-> Rust del split de modelos: `tools/audit_inventory.mjs` tiene su
        // PROPIA copia de la regla (no puede llamar a Rust) y su reporte se compara con el padrón de
        // la app; si las dos copias se separan, el reporte cuenta teléfonos que la app no tiene y la
        // comparación deja de significar algo. Se regenera con:
        //   node tools/audit_inventory.mjs --gen-split-fixtures
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools/split_fixtures.json");
        let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!("falta {} ({e}). Genera con: node tools/audit_inventory.mjs --gen-split-fixtures", path.display())
        });
        let cases: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
        assert!(!cases.is_empty(), "el archivo de fixtures está vacío");
        for case in &cases {
            let model = case["model"].as_str().unwrap_or("");
            let esperado: Vec<String> = case["expect"].as_array().unwrap().iter()
                .map(|v| v.as_str().unwrap().to_string()).collect();
            assert_eq!(split_model_models(model), esperado, "el split de «{model}» no coincide con node");
        }
    }

    #[test]
    fn test_compat_phones_parte_la_entrada_compuesta() {
        // «Samsung A70 A705» = DOS teléfonos, cada uno con su clave y su alias propio
        let phones = compat_phones_raw(r#"["Samsung A70 A705"]"#, "Samsung");
        let nombres: Vec<String> = phones.iter().map(|(_, p)| p.label.clone()).collect();
        assert_eq!(nombres, vec!["Samsung A70".to_string(), "Samsung A705".to_string()], "{nombres:?}");
        let aliases: Vec<String> = phones.iter().map(|(raw, _)| raw.clone()).collect();
        assert_eq!(aliases, vec!["Samsung A70".to_string(), "Samsung A705".to_string()],
            "el alias es el nombre de CADA teléfono (la entrada combinada ya no se guarda como alias)");
        let claves: Vec<String> = phones.iter().map(|(_, p)| phone_registry_key(p)).collect();
        assert_eq!(claves, vec!["samsung|a70".to_string(), "samsung|a705".to_string()]);
        // y una entrada normal sigue dando UN teléfono con su texto original como alias
        let simple = compat_phones_raw(r#"["Samsung Galaxy A06 4G"]"#, "Samsung");
        assert_eq!(simple.len(), 1);
        assert_eq!(simple[0].0, "Samsung Galaxy A06 4G", "el alias conserva cómo estaba escrito");
    }

    #[test]
    fn test_canonical_rules_match_node_fixtures() {        // Paridad node <-> Rust: el MISMO JSON de reglas y las MISMAS salidas.
        // Se regenera con: node tools/audit_inventory.mjs --gen-fixtures
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tools/canonical_fixtures.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("falta {} ({e}). Genera con: node tools/audit_inventory.mjs --gen-fixtures", path.display()));
        let cases: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
        assert!(!cases.is_empty(), "el archivo de fixtures está vacío");
        for case in &cases {
            let category = case["category"].as_str().unwrap_or("");
            let brand = case["brand"].as_str().unwrap_or("");
            let model = case["model"].as_str().unwrap_or("");
            let variant = case["variant"].as_str().unwrap_or("");
            let compat = case["compatibility"].as_str().unwrap_or("");
            let n = normalize_fields(category, brand, model, variant, compat);
            let expect = &case["expect"];
            let label = format!("[{brand}] [{model}]");
            assert_eq!(n.brand, expect["brand"].as_str().unwrap(), "marca {label}");
            assert_eq!(n.model, expect["model"].as_str().unwrap(), "modelo {label}");
            assert_eq!(n.variant, expect["variant"].as_str().unwrap(), "variante {label}");
            assert_eq!(n.name, expect["name"].as_str().unwrap(), "nombre {label}");
            assert_eq!(n.compatibility, expect["compatibility"].as_str().unwrap(), "compat {label}");
        }
    }
}
