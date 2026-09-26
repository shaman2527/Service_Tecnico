//! F78 — CARGA MASIVA DE INVENTARIO EN **CSV**.
//!
//! El formato anterior (pegar la lista «marca / modelo (N)») sirve para el CONTEO FÍSICO: fija el
//! stock y puede poner en 0 lo que no está en la lista. Este módulo es otra cosa: carga el inventario
//! **con todos los campos del producto** (nombre, categoría, marca, modelo, variante, compatibilidad,
//! costo, venta, efectivo, stock, mínimo, proveedor, código, «lo uso»), sirve para CUALQUIER categoría
//! (y crea las que falten) y **SUMA** el stock de lo que ya existe en vez de pisarlo:
//!
//!   1. `parse`        — lee el archivo (RFC4180 tolerante: comillas, `,`/`;`/tab, BOM, CRLF, `#`).
//!   2. `preview_csv`  — cruza cada fila contra el catálogo y decide **NUEVO** o **YA EXISTE** (con el
//!                       diff campo por campo), resolviendo la categoría y avisando de todo lo dudoso.
//!   3. `apply_csv`    — aplica con **respaldo previo** de la base, en UNA transacción: crea, actualiza,
//!                       deja o elimina, con su movimiento de inventario por cada cambio de stock.
//!
//! Reglas que NO se negocian (pedido del dueño + invariantes del proyecto):
//!   · **El stock se SUMA** (`stock hoy + lo que dice el archivo`): un archivo parcial nunca baja
//!     mercancía. El CSV NUNCA deja stock en 0.
//!   · **Celda vacía = «no se toca»**: en una ficha existente, un campo vacío conserva lo que ya tiene
//!     (y el diff lo muestra). Un `0` escrito a mano SÍ se escribe.
//!   · **El nombre es único**: si el nombre (plegado) ya existe, la fila no se crea como nueva sin que
//!     el operario lo diga (`create_anyway`) — se ofrece actualizar esa ficha o declarar la variante.
//!   · **Nada inventado**: lo que no se entiende (un número raro, una fila sin nombre, stock negativo,
//!     un producto nuevo sin categoría) se marca con su número de línea y **bloquea** el aplicar.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};

use crate::catalog;

/// Tope de filas por archivo: una lista más grande se parte en dos. Es una guarda de memoria (la
/// vista previa viaja entera al frontend), no un límite técnico del parser.
pub const MAX_ROWS: usize = 5_000;
/// Tope de unidades/stock por fila (el mismo criterio del conteo: un dedo pegado no deja el stock en
/// las nubes). Es el MISMO tope al leer y al aplicar, así el número que ve el operario es el que se
/// escribe.
pub const MAX_QTY: i64 = 100_000;
/// Tope de precio (costo/venta/efectivo): un dedo pegado en el teclado no puede dejar un precio en las
/// nubes. Es un error de la fila (bloquea), no un recorte silencioso.
pub const MAX_PRECIO: f64 = 1_000_000.0;
/// Tope del ARCHIVO (no de la vista previa): 8 MB. Se comprueba ANTES de parsear, porque un `.csv` de
/// 300 MB elegido por error en el diálogo se lleva la memoria de la app (el texto vive en JS, en Rust y
/// una copia más por celda). 8 MB son ~100.000 filas: sobra para el uso real (el tope de filas es 5.000).
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
/// Motivo que queda en el historial de movimientos (referencia = nombre del archivo).
const MOTIVO: &str = "Carga masiva (CSV)";

// ---------------------------------------------------------------- columnas

/// Las columnas que el archivo puede traer, como flags (no como índices) porque el payload que va y
/// vuelve del frontend tiene que poder decir «esta columna NO venía en el archivo»: es lo que
/// distingue «no toques este campo» de «poné 0».
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvColumns {
    pub name: bool,
    pub category: bool,
    pub brand: bool,
    pub model: bool,
    pub variant: bool,
    pub compatibility: bool,
    pub cost: bool,
    pub sale: bool,
    pub cash: bool,
    pub stock: bool,
    pub min_stock: bool,
    pub supplier: bool,
    pub code: bool,
    pub in_use: bool,
    pub id: bool,
}

/// Columna reconocida del encabezado (uso interno del parser).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Col {
    Name, Category, Brand, Model, Variant, Compatibility,
    Cost, Sale, Cash, Stock, MinStock, Supplier, Code, InUse, Id,
}

const TODAS: [Col; 15] = [
    Col::Name, Col::Category, Col::Brand, Col::Model, Col::Variant, Col::Compatibility,
    Col::Cost, Col::Sale, Col::Cash, Col::Stock, Col::MinStock, Col::Supplier, Col::Code,
    Col::InUse, Col::Id,
];

impl Col {
    /// Alias aceptados, comparados PLEGADOS (minúsculas, sin acentos, solo alfanumérico): así
    /// «Categoría», «categoria» y «CATEGORIA» son la misma columna y el encabezado que exporta la app
    /// se vuelve a leer sin tocar nada.
    fn aliases(self) -> &'static [&'static str] {
        match self {
            Col::Name => &["nombre", "nombreproducto", "producto", "descripcion", "detalle"],
            Col::Category => &["categoria", "categorias", "rubro", "tipo"],
            Col::Brand => &["marca", "brand"],
            Col::Model => &["modelo", "model"],
            Col::Variant => &["variante", "variant", "calidad"],
            Col::Compatibility => &["compatibilidad", "compat", "compatible", "modeloscompatibles", "modelos", "sirvepara"],
            Col::Cost => &["costo", "costos", "preciocosto", "costousd", "compra"],
            Col::Sale => &["venta", "precioventa", "precio", "pvp", "preciolista", "listaprecio"],
            Col::Cash => &["efectivo", "contado", "precioefectivo", "preciocontado", "divisas"],
            Col::Stock => &["stock", "cantidad", "cant", "unidades", "existencia"],
            Col::MinStock => &["stockmin", "stockminimo", "minimo", "min", "alerta", "minimodestock"],
            Col::Supplier => &["proveedor", "suplidor", "distribuidor", "proveedores"],
            Col::Code => &["codigo", "cod", "sku", "referencia", "referencias"],
            Col::InUse => &["enuso", "uso", "activo", "louzo", "usar"],
            Col::Id => &["id", "idproducto", "idproductos"],
        }
    }

    fn from_header(texto: &str) -> Option<Col> {
        let plegado = crate::db::plegar_texto(texto);
        if plegado.is_empty() { return None; }
        TODAS.into_iter().find(|c| c.aliases().iter().any(|a| *a == plegado))
    }

    /// El encabezado que ESCRIBE la app (plantilla y export): los dos usan la misma lista, así el
    /// archivo que sale se vuelve a leer sin tocar nada.
    fn titulo(self) -> &'static str {
        match self {
            Col::Name => "nombre",
            Col::Category => "categoria",
            Col::Brand => "marca",
            Col::Model => "modelo",
            Col::Variant => "variante",
            Col::Compatibility => "compatibilidad",
            Col::Cost => "costo",
            Col::Sale => "venta",
            Col::Cash => "efectivo",
            Col::Stock => "stock",
            Col::MinStock => "stock_min",
            Col::Supplier => "proveedor",
            Col::Code => "codigo",
            Col::InUse => "en_uso",
            Col::Id => "id",
        }
    }
}

// ---------------------------------------------------------------- parser

/// Una fila cruda del archivo, con el número de línea para poder hablarle al operario.
#[derive(Debug, Clone, Default)]
struct RawRow {
    line: i64,
    cells: Vec<String>,
}

/// Partes del encabezado ya interpretado.
#[derive(Debug, Clone, Default)]
struct Header {
    labels: Vec<String>,
    index: HashMap<Col, usize>,
    /// encabezados que no reconocemos: se AVISAN, no se descartan en silencio
    ignored: Vec<String>,
}

impl Header {
    fn cell<'a>(&self, row: &'a RawRow, col: Col) -> &'a str {
        match self.index.get(&col) {
            Some(i) => row.cells.get(*i).map(|s| s.as_str()).unwrap_or("").trim(),
            None => "",
        }
    }
    fn has(&self, col: Col) -> bool {
        self.index.contains_key(&col)
    }
    fn flags(&self) -> CsvColumns {
        CsvColumns {
            name: self.has(Col::Name),
            category: self.has(Col::Category),
            brand: self.has(Col::Brand),
            model: self.has(Col::Model),
            variant: self.has(Col::Variant),
            compatibility: self.has(Col::Compatibility),
            cost: self.has(Col::Cost),
            sale: self.has(Col::Sale),
            cash: self.has(Col::Cash),
            stock: self.has(Col::Stock),
            min_stock: self.has(Col::MinStock),
            supplier: self.has(Col::Supplier),
            code: self.has(Col::Code),
            in_use: self.has(Col::InUse),
            id: self.has(Col::Id),
        }
    }
}

/// Quita el BOM del principio (Excel lo pone al guardar «CSV UTF-8»).
fn sin_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// ¿La línea es un comentario o está vacía? (`#` al principio, como la plantilla).
fn es_ignorable(linea: &str) -> bool {
    let t = linea.trim_start();
    t.is_empty() || t.starts_with('#')
}

/// Adivina el separador contando candidatos FUERA de comillas en las primeras líneas ÚTILES (los
/// comentarios `#` y las líneas vacías no cuentan: la plantilla explica el formato en comentarios y
/// ahí hay comas que no son separadores).
fn detectar_separador(text: &str) -> char {
    let candidatos = [',', ';', '\t'];
    let mut cuenta = [0usize; 3];
    let mut en_comillas = false;
    let mut lineas_utiles = 0;
    for linea in sin_bom(text).split_inclusive('\n') {
        if es_ignorable(linea) { continue; }
        for c in linea.chars() {
            if c == '"' { en_comillas = !en_comillas; }
            if !en_comillas {
                if let Some(i) = candidatos.iter().position(|x| *x == c) { cuenta[i] += 1; }
            }
        }
        en_comillas = false;
        lineas_utiles += 1;
        if lineas_utiles >= 5 { break; }
    }
    let mejor = cuenta.iter().enumerate().max_by_key(|(_, n)| **n).map(|(i, _)| i).unwrap_or(0);
    if cuenta[mejor] == 0 { ',' } else { candidatos[mejor] }
}

/// Parser RFC4180 tolerante: comillas dobles con `""` adentro, saltos de línea DENTRO de comillas,
/// CRLF/LF y BOM. Devuelve las filas con datos (sin comentarios ni líneas vacías).
fn parse_filas(text: &str, sep: char) -> Vec<RawRow> {
    let mut filas: Vec<RawRow> = Vec::new();
    let mut celdas: Vec<String> = Vec::new();
    let mut campo = String::new();
    let mut en_comillas = false;
    let mut linea = 1i64;
    let mut linea_de_fila = 1i64;
    let mut hubo_algo = false;
    let mut chars = sin_bom(text).chars().peekable();

    while let Some(c) = chars.next() {
        if en_comillas {
            if c == '"' {
                if chars.peek() == Some(&'"') { campo.push('"'); chars.next(); } else { en_comillas = false; }
            } else {
                if c == '\n' { linea += 1; }
                campo.push(c);
            }
            continue;
        }
        match c {
            '"' => { en_comillas = true; hubo_algo = true; }
            _ if c == sep => { celdas.push(std::mem::take(&mut campo)); hubo_algo = true; }
            '\r' => { /* CRLF: el CR se ignora */ }
            '\n' => {
                celdas.push(std::mem::take(&mut campo));
                let texto_linea = celdas.join(" ").trim().to_string();
                if hubo_algo && !es_ignorable(&texto_linea) {
                    filas.push(RawRow { line: linea_de_fila, cells: celdas.clone() });
                }
                celdas.clear();
                hubo_algo = false;
                linea += 1;
                linea_de_fila = linea;
            }
            _ => { campo.push(c); hubo_algo = true; }
        }
    }
    celdas.push(campo);
    let texto_linea = celdas.join(" ").trim().to_string();
    if hubo_algo && !es_ignorable(&texto_linea) {
        filas.push(RawRow { line: linea_de_fila, cells: celdas });
    }
    filas
}

/// Interpreta el encabezado. `None` si la primera fila no trae la columna `nombre`.
fn leer_encabezado(fila: &RawRow) -> Option<Header> {
    let mut h = Header {
        labels: fila.cells.iter().map(|c| c.trim().to_string()).collect(),
        ..Default::default()
    };
    for (i, celda) in fila.cells.iter().enumerate() {
        match Col::from_header(celda) {
            Some(col) => { h.index.entry(col).or_insert(i); }
            None => {
                let t = celda.trim();
                if !t.is_empty() { h.ignored.push(t.to_string()); }
            }
        }
    }
    if h.has(Col::Name) { Some(h) } else { None }
}

// ---------------------------------------------------------------- números

/// Lee un número escrito por una persona en Venezuela o en inglés: `12,50` · `12.50` · `1.234,56` ·
/// `$ 5,20` · `Bs. 1.200`. `None` = celda vacía (no se toca el campo); `Err` = no se entiende.
///
/// OJO con la notación CIENTÍFICA (`1E5` = cien mil, `1.5E3` = mil quinientos): Excel la usa en cuanto
/// la celda tiene formato Scientific o el número es grande. Filtrar los caracteres «que no son de
/// número» la convertía en OTRO número (`1E5` → `15`, `1.5E3` → `1.53`) y eso se escribía en el precio
/// o en el stock **sin avisar** (lo cazó la revisión adversarial). Acá se lee tal cual y, si no se
/// entiende, se avisa.
fn leer_numero(raw: &str) -> Option<Result<f64, String>> {
    let t = raw.trim();
    if t.is_empty() { return None; }
    if t.contains('e') || t.contains('E') {
        return Some(leer_cientifico(t).ok_or_else(|| format!("«{t}» no es un número")));
    }
    let limpio: String = t.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-').collect();
    if limpio.is_empty() { return Some(Err(format!("«{t}» no es un número"))); }
    let puntos = limpio.matches('.').count();
    let comas = limpio.matches(',').count();
    let normalizado = if puntos > 0 && comas > 0 {
        // los DOS separadores: el ÚLTIMO es el decimal y el otro son miles
        let ultimo = limpio.rfind(['.', ',']).unwrap();
        let sep_decimal = limpio.chars().nth(ultimo).unwrap();
        let otro = if sep_decimal == '.' { ',' } else { '.' };
        limpio.replace(otro, "").replace(sep_decimal, ".")
    } else if puntos + comas == 0 {
        limpio.clone()
    } else {
        let sep = if puntos > 0 { '.' } else { ',' };
        let partes: Vec<&str> = limpio.split(sep).collect();
        let ultima = partes.last().copied().unwrap_or("");
        let varios = partes.len() > 2;
        // «1.234» / «1,234» con 3 dígitos detrás y 1-3 delante = MILES (formato del local);
        // «12,5» / «12.50» con 1-2 dígitos = decimales.
        if (varios && ultima.len() == 3) || (!varios && ultima.len() == 3 && partes[0].len() <= 3) {
            limpio.replace(sep, "")
        } else {
            limpio.replace(sep, ".")
        }
    };
    match normalizado.parse::<f64>() {
        Ok(v) if v.is_finite() => Some(Ok(v)),
        _ => Some(Err(format!("«{t}» no es un número"))),
    }
}

/// `1E5` · `1,5E3` · `2E-3` (lo que exporta Excel en formato Scientific). Se quitan los símbolos de
/// moneda y el separador decimal local, y se parsea con el lector de Rust: si no da un número finito,
/// NO se adivina.
fn leer_cientifico(t: &str) -> Option<f64> {
    let limpio: String = t
        .chars()
        .filter(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | '-' | '+' | 'e' | 'E'))
        .collect();
    if limpio.is_empty() { return None; }
    let candidatos = if limpio.contains('.') {
        vec![limpio.clone()]
    } else {
        // sin punto: el único separador posible es la coma decimal («1,5E3»)
        vec![limpio.clone(), limpio.replace(',', ".")]
    };
    for c in candidatos {
        // la «e» tiene que estar UNA vez y en el medio: si no, es basura («12e», «e5»)
        let es = c.matches(['e', 'E']).count();
        if es > 1 { continue; }
        if es == 1 {
            let pos = c.find(['e', 'E']).unwrap();
            if pos == 0 || pos == c.len() - 1 { continue; }
        }
        if let Ok(v) = c.parse::<f64>() {
            if v.is_finite() { return Some(v); }
        }
    }
    None
}

/// Cantidad entera (stock / mínimo): 0…MAX_QTY.
fn leer_cantidad(raw: &str) -> Option<Result<i64, String>> {
    match leer_numero(raw)? {
        Err(e) => Some(Err(e)),
        Ok(v) => {
            if v < 0.0 { return Some(Err(format!("«{}» no puede ser negativo", raw.trim()))); }
            let n = v.trunc() as i64;
            if n > MAX_QTY { return Some(Err(format!("«{}» es un stock absurdo (máximo {MAX_QTY})", raw.trim()))); }
            Some(Ok(n))
        }
    }
}

/// Un precio (costo / venta / efectivo): 0…MAX_PRECIO. Un precio negativo o en las nubes es un error
/// de tipeo, no un dato: bloquea la fila (igual que el stock).
fn leer_precio(raw: &str) -> Option<Result<f64, String>> {
    match leer_numero(raw)? {
        Err(e) => Some(Err(e)),
        Ok(v) => {
            if v < 0.0 { return Some(Err(format!("«{}» no puede ser un precio negativo", raw.trim()))); }
            if v > MAX_PRECIO {
                return Some(Err(format!("«{}» es un precio absurdo (máximo {MAX_PRECIO:.0})", raw.trim())));
            }
            Some(Ok(v))
        }
    }
}

/// ¿sí/no? (para «lo uso»). Vacío → `None` (no se toca).
fn leer_si_no(raw: &str) -> Option<Result<i64, String>> {
    let p = crate::db::plegar_texto(raw);
    if p.is_empty() { return None; }
    match p.as_str() {
        "si" | "s" | "1" | "true" | "x" | "yes" | "usar" | "activo" => Some(Ok(1)),
        "no" | "n" | "0" | "false" | "apagado" | "inactivo" => Some(Ok(0)),
        _ => Some(Err(format!("«{}» no es sí/no", raw.trim()))),
    }
}

/// La compatibilidad se escribe con `/` o `|` (NUNCA con `,`: es el separador del CSV).
fn leer_compatibilidad(raw: &str) -> String {
    raw.split(['/', '|']).map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" / ")
}

/// Toma un número opcional dejando el aviso en la fila (una sola forma de leerlos).
fn tomar_num(valor: Option<Result<f64, String>>, campo: &str, issues: &mut Vec<String>) -> Option<f64> {
    match valor {
        None => None,
        Some(Ok(v)) => Some(v),
        Some(Err(e)) => { issues.push(format!("{campo}: {e}")); None }
    }
}

/// Un PRECIO con su rango (0…MAX_PRECIO): un negativo o un número absurdo bloquea la fila.
fn tomar_precio(valor: Option<Result<f64, String>>, campo: &str, issues: &mut Vec<String>) -> Option<f64> {
    tomar_num(valor, campo, issues)
}

fn tomar_qty(valor: Option<Result<i64, String>>, campo: &str, issues: &mut Vec<String>) -> Option<i64> {
    match valor {
        None => None,
        Some(Ok(v)) => Some(v),
        Some(Err(e)) => { issues.push(format!("{campo}: {e}")); None }
    }
}

// ---------------------------------------------------------------- filas y vista previa

/// Los valores ACTUALES de la ficha que la fila va a tocar (para el diff de la vista previa).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvCurrent {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub category_id: Option<i64>,
    pub brand: String,
    pub model: String,
    pub variant: String,
    /// el JSON CRUDO de la ficha: es lo que se conserva cuando la celda viene vacía
    pub compatibility: String,
    /// la compatibilidad como la LEE una persona (`Samsung A06 4G / Samsung A06`): es lo que se compara
    /// contra la celda del archivo en el diff de la pantalla (comparar el JSON crudo marcaba TODAS las
    /// filas con compatibilidad como «cambió» y mostraba `["Samsung A06 4G"]` — lo cazó la revisión)
    #[serde(default)]
    pub compatibility_text: String,
    pub price_cost: f64,
    pub price_sale: f64,
    pub price_usd: f64,
    pub stock: i64,
    pub min_stock: i64,
    pub supplier: String,
    pub code: String,
    pub in_use: i64,
}

/// Una fila del archivo ya interpretada (lo que la UI muestra y deja editar).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvRow {
    /// número de línea del archivo (para hablarle al operario)
    pub line: i64,
    pub name: String,
    /// categoría tal como viene escrita
    pub category: String,
    /// id resuelto (si ya existe) — el operario puede cambiarlo en la vista previa
    pub category_id: Option<i64>,
    /// la categoría todavía NO existe: hay que crearla (la confirma el operario)
    pub category_new: bool,
    pub brand: String,
    pub model: String,
    pub variant: String,
    pub compatibility: String,
    pub price_cost: Option<f64>,
    pub price_sale: Option<f64>,
    pub price_usd: Option<f64>,
    pub stock: Option<i64>,
    pub min_stock: Option<i64>,
    pub supplier: String,
    pub code: String,
    /// «lo uso» (1/0); `None` = la regla normal (stock > 0)
    pub in_use: Option<i64>,
    /// ficha del catálogo que esta fila toca (`None` = producto nuevo)
    pub product_id: Option<i64>,
    pub current: Option<CsvCurrent>,
    /// `crear` | `actualizar` | `dejar` | `eliminar`
    pub action: String,
    /// el operario quitó la fila del archivo (no se toca nada)
    pub excluded: bool,
    /// el nombre (plegado) ya existe en OTRA ficha: no se crea sin decirlo
    pub name_clash: bool,
    /// el código es de una ficha de OTRA categoría: no se toca sin decirlo
    #[serde(default)]
    pub code_clash: bool,
    /// la ficha que YA tiene ese nombre (para ofrecer «actualizar esa» a un clic)
    pub clash_product_id: Option<i64>,
    /// el operario dijo «crear igual: es otra variante»
    pub create_anyway: bool,
    /// por qué se reconoció la ficha: `id` | `codigo` | `identidad` | `nombre` | ``
    pub match_kind: String,
    /// cuántas filas MÁS del archivo caen en la misma ficha
    pub shared: i64,
    /// lo que va a quedar de stock (hoy + lo del archivo)
    pub stock_after: Option<i64>,
    /// lo que IMPIDE aplicar esta fila (con su motivo, para la pantalla)
    pub issues: Vec<String>,
    /// avisos que NO impiden aplicar (informativo)
    pub notes: Vec<String>,
}

/// Una categoría que el archivo trae y todavía no existe.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvNewCategory {
    pub name: String,
    pub rows: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvPreview {
    pub rows: Vec<CsvRow>,
    /// el mapa de columnas del archivo (viaja al aplicar: «celda vacía = no tocar»)
    pub columns: CsvColumns,
    /// encabezados reconocidos, tal como venían escritos
    pub known: Vec<String>,
    /// encabezados que NO reconocemos (se avisan)
    pub ignored: Vec<String>,
    pub separator: String,
    pub total_rows: i64,
    pub new_count: i64,
    pub exists_count: i64,
    /// categorías nuevas que el archivo necesita
    pub new_categories: Vec<CsvNewCategory>,
    /// unidades que trae el archivo (filas activas)
    pub units_file: i64,
    /// stock de hoy sumado de las fichas que el archivo toca
    pub units_before: i64,
    /// lo que va a quedar (hoy + archivo) — estimación inicial; la pantalla la recalcula al editar
    pub units_after: i64,
    /// avisos del ARCHIVO (columnas ignoradas, etc.)
    pub issues: Vec<String>,
    /// si esto trae texto, la vista previa no sirve: hay que arreglar el archivo
    pub fatal: Option<String>,
}

/// Ficha del catálogo ya leída (una sola consulta para todo el archivo: con 1.000 filas no se puede
/// ir a la base fila por fila).
#[derive(Debug, Clone, Default)]
struct Ficha {
    current: CsvCurrent,
    identidad: String,
    name_fold: String,
}

/// La clave de identidad de una ficha: **categoría (plegada) + marca + modelo + variante canónicos**.
/// Es la misma idea de los grupos de duplicados del catálogo (F53) con la categoría adentro: una
/// «Batería iPhone 11» y una «Pantalla iPhone 11» NO son el mismo producto.
fn identidad(category: &str, brand: &str, model: &str, variant: &str) -> String {
    format!(
        "{}|{}|{}|{}",
        crate::db::plegar_texto(category),
        catalog::norm(brand),
        catalog::norm(model),
        catalog::norm(variant)
    )
}

/// Carga TODAS las fichas del catálogo (nombre, categoría, identidad canónica y nombre plegado).
fn leer_catalogo(conn: &Connection) -> SqlResult<Vec<Ficha>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, COALESCE(p.name,''), p.category_id, COALESCE(c.name,''), COALESCE(p.brand,''),
                COALESCE(p.model,''), COALESCE(p.variant,''), COALESCE(p.compatibility,'[]'),
                COALESCE(p.price_cost,0), COALESCE(p.price_sale,0), COALESCE(p.price_usd,0),
                COALESCE(p.stock,0), COALESCE(p.min_stock,0), COALESCE(p.supplier,''),
                COALESCE(p.code,''), COALESCE(p.in_use,1)
         FROM products p LEFT JOIN categories c ON p.category_id = c.id",
    )?;
    let rows = stmt.query_map([], |r| {
        let category: String = r.get(3)?;
        let brand: String = r.get(4)?;
        let model: String = r.get(5)?;
        let variant: String = r.get(6)?;
        let compatibility: String = r.get(7)?;
        let name: String = r.get(1)?;
        let n = catalog::normalize_fields(&category, &brand, &model, &variant, &compatibility);
        Ok(Ficha {
            current: CsvCurrent {
                id: r.get(0)?,
                name: name.clone(),
                category: category.clone(),
                category_id: r.get(2)?,
                brand,
                model,
                variant,
                compatibility_text: catalog::parse_compat_publica(&compatibility).join(" / "),
                compatibility,
                price_cost: r.get(8)?,
                price_sale: r.get(9)?,
                price_usd: r.get(10)?,
                stock: r.get(11)?,
                min_stock: r.get(12)?,
                supplier: r.get(13)?,
                code: r.get(14)?,
                in_use: r.get(15)?,
            },
            identidad: identidad(&category, &n.brand, &n.model, &n.variant),
            name_fold: crate::db::plegar_texto(&name),
        })
    })?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

/// F78 — Cruza el archivo contra el catálogo y devuelve la vista previa (NO escribe nada).
pub fn preview_csv(conn: &Connection, text: &str) -> SqlResult<CsvPreview> {
    let texto = sin_bom(text);
    if texto.trim().is_empty() {
        return Ok(CsvPreview { fatal: Some("El archivo está vacío.".to_string()), ..Default::default() });
    }
    // El tope se mira ANTES de parsear: el parseo materializa el archivo entero (y su copia por celda).
    if texto.len() > MAX_BYTES {
        return Ok(CsvPreview {
            fatal: Some(format!(
                "El archivo pesa {:.1} MB y el máximo es {} MB. ¿Elegiste el archivo correcto? \
                 (Una lista de 5.000 productos pesa menos de 1 MB.)",
                texto.len() as f64 / (1024.0 * 1024.0),
                MAX_BYTES / (1024 * 1024)
            )),
            ..Default::default()
        });
    }
    let sep = detectar_separador(texto);
    let filas = parse_filas(texto, sep);
    if filas.is_empty() {
        return Ok(CsvPreview {
            fatal: Some("El archivo no tiene ninguna fila con datos (solo encabezado o comentarios).".to_string()),
            ..Default::default()
        });
    }
    let header = match leer_encabezado(&filas[0]) {
        Some(h) => h,
        None => {
            return Ok(CsvPreview {
                fatal: Some(
                    "El archivo no tiene la columna «nombre». La primera fila tiene que ser el \
                     encabezado (descargá la plantilla para ver el formato)."
                        .to_string(),
                ),
                ..Default::default()
            });
        }
    };
    let datos: Vec<RawRow> = filas[1..]
        .iter()
        .filter(|r| r.cells.iter().any(|c| !c.trim().is_empty()))
        .cloned()
        .collect();
    if datos.len() > MAX_ROWS {
        return Ok(CsvPreview {
            fatal: Some(format!(
                "El archivo tiene {} filas y el máximo por carga es {MAX_ROWS}: partilo en dos archivos.",
                datos.len()
            )),
            ..Default::default()
        });
    }

    let catalogo = leer_catalogo(conn)?;
    let mut por_id: HashMap<i64, usize> = HashMap::new();
    let mut por_codigo: HashMap<String, usize> = HashMap::new();
    let mut por_identidad: HashMap<String, usize> = HashMap::new();
    let mut por_nombre: HashMap<String, usize> = HashMap::new();
    // F78: archivo SIN columna de categoría (el operario pegó una lista de marca/modelo): se busca por
    // marca+modelo+variante canónicos, pero SOLO si esa combinación es única en el catálogo. Si hay dos
    // categorías con el mismo modelo (una Batería y un Flex «Redmi 9A»), NO se adivina: la fila queda
    // como nueva y el operario decide (mejor preguntar que actualizar la ficha equivocada).
    let mut por_identidad_sin_cat: HashMap<String, Option<usize>> = HashMap::new();
    for (i, f) in catalogo.iter().enumerate() {
        por_id.insert(f.current.id, i);
        if !f.current.code.trim().is_empty() {
            // el PRIMERO gana (igual que la identidad y el nombre): con dos fichas con el mismo código,
            // el destino no puede depender del orden en que SQLite devolvió las filas
            por_codigo.entry(f.current.code.trim().to_uppercase()).or_insert(i);
        }
        por_identidad.entry(f.identidad.clone()).or_insert(i);
        por_nombre.entry(f.name_fold.clone()).or_insert(i);
        let n = catalog::normalize_fields("", &f.current.brand, &f.current.model, &f.current.variant, "");
        let clave = format!("{}|{}|{}", catalog::norm(&n.brand), catalog::norm(&n.model), catalog::norm(&n.variant));
        match por_identidad_sin_cat.get(&clave) {
            None => { por_identidad_sin_cat.insert(clave, Some(i)); }
            Some(Some(_)) => { por_identidad_sin_cat.insert(clave, None); } // ambiguo
            Some(None) => {}
        }
    }
    let mut categorias: HashMap<String, (i64, String)> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, name FROM categories")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (id, name) = row?;
            categorias.insert(crate::db::plegar_texto(&name), (id, name));
        }
    }

    let columns = header.flags();
    let mut out_rows: Vec<CsvRow> = Vec::with_capacity(datos.len());

    for raw in &datos {
        let mut issues: Vec<String> = Vec::new();
        let mut notes: Vec<String> = Vec::new();

        let name = header.cell(raw, Col::Name).to_string();
        if name.is_empty() { issues.push("Falta el nombre".to_string()); }

        let category = header.cell(raw, Col::Category).to_string();
        let mut category_id: Option<i64> = None;
        let mut category_new = false;
        if !category.is_empty() {
            match categorias.get(&crate::db::plegar_texto(&category)) {
                Some((id, _)) => category_id = Some(*id),
                None => category_new = true,
            }
        }

        let price_cost = tomar_precio(leer_precio(header.cell(raw, Col::Cost)), "Costo", &mut issues);
        let price_sale = tomar_precio(leer_precio(header.cell(raw, Col::Sale)), "Venta", &mut issues);
        let price_usd = tomar_precio(leer_precio(header.cell(raw, Col::Cash)), "Efectivo", &mut issues);
        let stock = tomar_qty(leer_cantidad(header.cell(raw, Col::Stock)), "Stock", &mut issues);
        let min_stock = tomar_qty(leer_cantidad(header.cell(raw, Col::MinStock)), "Stock mínimo", &mut issues);
        let in_use = match leer_si_no(header.cell(raw, Col::InUse)) {
            None => None,
            Some(Ok(v)) => Some(v),
            Some(Err(e)) => { issues.push(format!("«Lo uso»: {e}")); None }
        };
        let compatibility = leer_compatibilidad(header.cell(raw, Col::Compatibility));
        let brand = header.cell(raw, Col::Brand).to_string();
        let model = header.cell(raw, Col::Model).to_string();
        let variant = header.cell(raw, Col::Variant).to_string();
        let supplier = header.cell(raw, Col::Supplier).to_string();
        let code = header.cell(raw, Col::Code).trim().to_uppercase();

        // ── identidad: id → código → identidad canónica → nombre
        let id_celda = header.cell(raw, Col::Id);
        let id_archivo: Option<i64> = if id_celda.is_empty() {
            None
        } else {
            match id_celda.parse::<i64>() {
                Ok(v) if v > 0 => Some(v),
                _ => { issues.push(format!("El id «{id_celda}» no es un número")); None }
            }
        };
        let mut idx_ficha: Option<usize> = None;
        let mut match_kind = String::new();
        // choques con una ficha AJENA: el nombre ya existe en otra categoría (`name_clash`) o el código
        // es de una ficha de otra categoría (`code_clash`). Ninguno se resuelve solo: bloquean hasta
        // que el dueño decida (actualizar esa ficha / cambiar el nombre / crear igual con otra variante).
        let mut name_clash = false;
        let mut code_clash = false;
        let mut clash_product_id: Option<i64> = None;
        if let Some(id) = id_archivo {
            match por_id.get(&id) {
                Some(i) => { idx_ficha = Some(*i); match_kind = "id".into(); }
                None => issues.push(format!("La ficha #{id} no existe en el catálogo")),
            }
        }
        if idx_ficha.is_none() && !code.is_empty() {
            if let Some(i) = por_codigo.get(&code) {
                // El código es de una ficha: se actualiza ESA, pero SOLO si la categoría coincide con
                // la que el archivo declara. Con la categoría del archivo distinta (una fila duplicada
                // en Excel a la que no le limpiaron el código) antes se actualizaba la ficha ajena:
                // le cambiaba el nombre, la marca y la CATEGORÍA, y le sumaba el stock. Ahora la fila
                // queda marcada y el dueño decide (lo cazó la revisión adversarial).
                let ficha = &catalogo[*i];
                let misma_cat = category.trim().is_empty()
                    || crate::db::plegar_texto(&category) == crate::db::plegar_texto(&ficha.current.category);
                if misma_cat {
                    idx_ficha = Some(*i);
                    match_kind = "codigo".into();
                } else {
                    code_clash = true;
                    clash_product_id = Some(ficha.current.id);
                }
            }
        }
        let n_archivo = catalog::normalize_fields(&category, &brand, &model, &variant, &compatibility);
        if idx_ficha.is_none() && !name.is_empty() {
            if category.trim().is_empty() {
                // sin categoría en el archivo: solo se cruza si marca+modelo+variante es ÚNICO
                let clave = format!(
                    "{}|{}|{}",
                    catalog::norm(&n_archivo.brand),
                    catalog::norm(&n_archivo.model),
                    catalog::norm(&n_archivo.variant)
                );
                if let Some(Some(i)) = por_identidad_sin_cat.get(&clave) {
                    idx_ficha = Some(*i);
                    match_kind = "identidad".into();
                }
            } else {
                let clave = identidad(&category, &n_archivo.brand, &n_archivo.model, &n_archivo.variant);
                if let Some(i) = por_identidad.get(&clave) { idx_ficha = Some(*i); match_kind = "identidad".into(); }
            }
        }
        if idx_ficha.is_none() && !name.is_empty() {
            let fold = crate::db::plegar_texto(&name);
            if let Some(i) = por_nombre.get(&fold) {
                let ficha = &catalogo[*i];
                // El NOMBRE es único (pedido del dueño). Si la categoría del archivo es la MISMA que
                // la de la ficha, es la misma ficha escrita distinto → se actualiza. Si la categoría
                // DIFIERE, no se toca nada por cuenta propia: la fila queda marcada y el operario
                // elige (actualizar esa ficha, cambiar el nombre o crear igual con otra variante).
                let misma_cat = !category.trim().is_empty()
                    && crate::db::plegar_texto(&category) == crate::db::plegar_texto(&ficha.current.category);
                if misma_cat {
                    idx_ficha = Some(*i);
                    match_kind = "nombre".into();
                    name_clash = true;
                } else {
                    name_clash = true;
                    if clash_product_id.is_none() { clash_product_id = Some(ficha.current.id); }
                }
            }
        }
        let product_id = idx_ficha.map(|i| catalogo[i].current.id);
        let current = idx_ficha.map(|i| catalogo[i].current.clone());

        if let Some(c) = &current {
            if !category.is_empty() && category_new {
                notes.push(format!("«{category}» no existe todavía; esta ficha está en «{}»", c.category));
            }
            if !code.is_empty() && !c.code.trim().is_empty() && !c.code.eq_ignore_ascii_case(&code) {
                notes.push(format!("El código del archivo ({code}) reemplaza al de la ficha ({})", c.code));
            }
        } else if category_id.is_none() && !category_new {
            // producto nuevo sin categoría: cae fuera de todos los filtros del inventario
            issues.push("Elegí la categoría (es un producto nuevo)".to_string());
        }
        if let Some(cid) = clash_product_id {
            let ya = catalogo.iter().find(|f| f.current.id == cid).map(|f| f.current.clone()).unwrap_or_default();
            notes.push(if code_clash {
                format!(
                    "El código «{code}» es de «{}» (categoría «{}»): elegí actualizar esa ficha o quitá \
                     el código de esta fila",
                    ya.name, ya.category
                )
            } else {
                format!(
                    "El nombre «{}» ya existe (categoría «{}»): elegí actualizar esa ficha, cambiar el \
                     nombre o crear igual con otra variante",
                    ya.name, ya.category
                )
            });
        }

        // ── stock: SUMA (nunca pisa) y nunca deja en 0 lo que ya hay
        let stock_hoy = current.as_ref().map(|c| c.stock).unwrap_or(0);
        let stock_after = match (product_id.is_some(), stock) {
            (true, Some(q)) => Some((stock_hoy + q).clamp(0, MAX_QTY)),
            (true, None) => Some(stock_hoy),
            (false, q) => Some(q.unwrap_or(0)),
        };
        // el tope es sobre la SUMA (no sobre la celda): 90.000 + 20.000 no puede quedar recortado en
        // silencio, porque el movimiento diría una cosa y el stock otra
        if let (Some(q), true) = (stock, product_id.is_some()) {
            if stock_hoy.saturating_add(q) > MAX_QTY {
                issues.push(format!(
                    "El stock quedaría en {} (hoy {stock_hoy} + {q} del archivo) y el máximo es {MAX_QTY}",
                    stock_hoy.saturating_add(q)
                ));
            }
        }

        out_rows.push(CsvRow {
            line: raw.line,
            name,
            category,
            category_id,
            category_new,
            brand,
            model,
            variant,
            compatibility,
            price_cost,
            price_sale,
            price_usd,
            stock,
            min_stock,
            supplier,
            code,
            in_use,
            product_id,
            current,
            action: if product_id.is_some() { "actualizar".into() } else { "crear".into() },
            excluded: false,
            name_clash,
            code_clash,
            clash_product_id,
            create_anyway: false,
            match_kind,
            shared: 0,
            stock_after,
            issues,
            notes,
        });
    }

    // colisiones internas: dos filas del archivo que caen en la MISMA ficha (o en el mismo nombre nuevo)
    let mut cuantas: BTreeMap<String, i64> = BTreeMap::new();
    for r in &out_rows {
        *cuantas.entry(clave_de_fila(r)).or_insert(0) += 1;
    }
    for r in out_rows.iter_mut() {
        r.shared = cuantas.get(&clave_de_fila(r)).copied().unwrap_or(1) - 1;
        if r.shared > 0 {
            r.notes.push(if r.product_id.is_some() {
                "Otra fila del archivo cae en esta misma ficha: el stock se SUMA".to_string()
            } else {
                "Otra fila del archivo tiene el mismo nombre: revisá si no es la misma ficha".to_string()
            });
        }
    }

    // DOS filas que CREAN lo mismo: el nombre es único, así que no pueden salir dos fichas iguales.
    // Bloquea (con el número de línea) salvo que el operario haya declarado «crear igual (otra
    // variante)» en LAS DOS y de verdad sean fichas distintas (categoría+marca+modelo+variante).
    let mut por_nombre_nuevo: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut por_codigo_nuevo: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, r) in out_rows.iter().enumerate() {
        if r.product_id.is_some() || r.name.trim().is_empty() { continue; }
        por_nombre_nuevo.entry(crate::db::plegar_texto(&r.name)).or_default().push(i);
        if !r.code.trim().is_empty() {
            por_codigo_nuevo.entry(r.code.trim().to_uppercase()).or_default().push(i);
        }
    }
    let mut choca_nombre: BTreeMap<usize, Vec<i64>> = BTreeMap::new();
    for indices in por_nombre_nuevo.values() {
        if indices.len() < 2 { continue; }
        let declaradas = indices.iter().all(|&i| out_rows[i].create_anyway);
        let identidades: BTreeSet<String> = indices
            .iter()
            .map(|&i| {
                let r = &out_rows[i];
                let n = catalog::normalize_fields(&r.category, &r.brand, &r.model, &r.variant, &r.compatibility);
                identidad(&r.category, &n.brand, &n.model, &n.variant)
            })
            .collect();
        if declaradas && identidades.len() == indices.len() { continue; }
        let lineas: Vec<i64> = indices.iter().map(|&i| out_rows[i].line).collect();
        for &i in indices { choca_nombre.insert(i, lineas.clone()); }
    }
    let mut choca_codigo: BTreeMap<usize, Vec<i64>> = BTreeMap::new();
    for indices in por_codigo_nuevo.values() {
        if indices.len() < 2 { continue; }
        let lineas: Vec<i64> = indices.iter().map(|&i| out_rows[i].line).collect();
        for &i in indices { choca_codigo.insert(i, lineas.clone()); }
    }
    for (i, r) in out_rows.iter_mut().enumerate() {
        if let Some(lineas) = choca_nombre.get(&i) {
            r.issues.push(format!(
                "Otras filas del archivo crean el mismo nombre «{}» (línea{} {})",
                r.name,
                if lineas.len() > 1 { "s" } else { "" },
                lineas.iter().filter(|l| **l != r.line).map(|l| l.to_string()).collect::<Vec<_>>().join(", ")
            ));
        }
        if let Some(lineas) = choca_codigo.get(&i) {
            r.issues.push(format!(
                "El código «{}» está repetido en el archivo (línea{} {})",
                r.code,
                if lineas.len() > 1 { "s" } else { "" },
                lineas.iter().filter(|l| **l != r.line).map(|l| l.to_string()).collect::<Vec<_>>().join(", ")
            ));
        }
    }

    // ── resumen
    let mut nuevas: BTreeMap<String, CsvNewCategory> = BTreeMap::new();
    for r in &out_rows {
        if r.category_new && !r.category.trim().is_empty() {
            let e = nuevas
                .entry(crate::db::plegar_texto(&r.category))
                .or_insert(CsvNewCategory { name: r.category.trim().to_string(), rows: 0 });
            e.rows += 1;
        }
    }
    let new_count = out_rows.iter().filter(|r| r.product_id.is_none()).count() as i64;
    let units_file: i64 = out_rows.iter().map(|r| r.stock.unwrap_or(0)).sum();
    let mut antes = 0i64;
    let mut vistos: BTreeSet<i64> = BTreeSet::new();
    for r in &out_rows {
        if let Some(c) = &r.current {
            if vistos.insert(c.id) { antes += c.stock; }
        }
    }
    let mut issues: Vec<String> = Vec::new();
    if !header.ignored.is_empty() {
        issues.push(format!("Columnas que no reconozco (no se cargan): {}", header.ignored.join(", ")));
    }
    Ok(CsvPreview {
        rows: out_rows,
        columns,
        known: header.labels.iter().filter(|l| Col::from_header(l).is_some()).cloned().collect(),
        ignored: header.ignored.clone(),
        separator: match sep { '\t' => "tabulador".to_string(), c => c.to_string() },
        total_rows: datos.len() as i64,
        new_count,
        exists_count: datos.len() as i64 - new_count,
        new_categories: nuevas.into_values().collect(),
        units_file,
        units_before: antes,
        units_after: antes + units_file,
        issues,
        fatal: None,
    })
}

/// La clave con la que se agrupan las filas del archivo (por ficha o por nombre nuevo).
fn clave_de_fila(r: &CsvRow) -> String {
    match r.product_id {
        Some(id) => format!("id:{id}"),
        None => format!("nuevo:{}", crate::db::plegar_texto(&r.name)),
    }
}

// ---------------------------------------------------------------- aplicar

/// Lo que manda la UI al aplicar: las filas YA corregidas por el operario, el mapa de columnas del
/// archivo (para «celda vacía = no tocar») y las categorías nuevas que confirmó crear.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvApplyInput {
    pub rows: Vec<CsvRow>,
    pub columns: CsvColumns,
    /// proveedor general de la carga (lo usa la fila que no trae el suyo)
    #[serde(default)]
    pub supplier: String,
    /// nombre del archivo (queda como referencia del movimiento: de dónde vino la mercancía)
    #[serde(default)]
    pub file_name: String,
    /// categorías nuevas confirmadas (por nombre)
    #[serde(default)]
    pub new_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvReport {
    pub created: i64,
    pub updated: i64,
    pub kept: i64,
    pub deleted: i64,
    pub categories_new: Vec<String>,
    /// unidades NETAS que entraron (positivas o negativas: el stock se suma)
    pub units_added: i64,
    pub movements: i64,
    pub suppliered: i64,
    /// filas que el operario quitó del archivo
    pub skipped: i64,
    pub backup: String,
}

/// El texto FINAL de una celda de texto: columna ausente o celda vacía = **conservar** lo que la ficha
/// ya tiene; `-` (o «ninguno/a», «sin compatibilidad») = **borrar** el campo. Es la única forma de
/// dejar un campo en blanco a propósito sin romper la regla «la celda vacía no toca nada».
fn texto_celda(valor: &str, columna: bool, actual: &str) -> String {
    if !columna { return actual.to_string(); }
    let t = valor.trim();
    if t.is_empty() { return actual.to_string(); }
    let p = crate::db::plegar_texto(t);
    if t == "-" || p == "ninguno" || p == "ninguna" || p == "nada" || p == "sincompatibilidad" {
        return String::new();
    }
    t.to_string()
}

/// Los valores FINALES de una fila: lo que dice el archivo y, donde la celda venía vacía, lo que ya
/// tiene la ficha (o el valor por defecto si es nueva). UNA sola función, así la vista previa y el
/// aplicar no pueden discrepar.
fn finales(row: &CsvRow, actual: &CsvCurrent, columns: &CsvColumns, supplier_general: &str, stock_final: i64) -> Finales {
    let name = if !row.name.trim().is_empty() { row.name.trim().to_string() } else { actual.name.clone() };
    // OJO (lo cazó la revisión adversarial): «celda vacía = no se toca» vale para TODOS los campos, no
    // solo para los números. Antes, con la columna presente y la celda vacía, la marca quedaba en
    // «Genérico», el modelo/variante en blanco y la COMPATIBILIDAD curada se BORRABA (y con ella el
    // vínculo del repuesto con su teléfono en el padrón de Modelos). Vacío = conservar; `-` = borrar.
    let brand = texto_celda(&row.brand, columns.brand, &actual.brand);
    let model = texto_celda(&row.model, columns.model, &actual.model);
    let variant = texto_celda(&row.variant, columns.variant, &actual.variant);
    let compatibility = texto_celda(&row.compatibility, columns.compatibility, &actual.compatibility);
    let price_cost = if columns.cost { row.price_cost.unwrap_or(actual.price_cost) } else { actual.price_cost };
    let price_sale = if columns.sale { row.price_sale.unwrap_or(actual.price_sale) } else { actual.price_sale };
    let price_usd = if columns.cash { row.price_usd.unwrap_or(actual.price_usd) } else { actual.price_usd };
    let min_stock = if columns.min_stock { row.min_stock.unwrap_or(actual.min_stock) } else { actual.min_stock };
    let supplier = {
        let de_fila = if columns.supplier { row.supplier.trim() } else { "" };
        if !de_fila.is_empty() { de_fila.to_string() }
        else if !supplier_general.trim().is_empty() { supplier_general.trim().to_string() }
        else { actual.supplier.clone() }
    };
    let code = if !row.code.trim().is_empty() { row.code.trim().to_uppercase() } else { actual.code.clone() };
    let in_use = row.in_use.unwrap_or(if row.product_id.is_some() { actual.in_use } else if stock_final > 0 { 1 } else { 0 });
    // la normalización canónica usa el NOMBRE DE LA CATEGORÍA (como `add_product`): si el archivo no
    // la trae, se usa la que la ficha ya tiene — si no, cambiar el modelo podría re-marcar la marca
    let categoria_para_norm = if !row.category.trim().is_empty() { row.category.clone() } else { actual.category.clone() };
    let n = catalog::normalize_fields(&categoria_para_norm, &brand, &model, &variant, &compatibility);
    let search_text = catalog::search_text(&name, &n.brand, &n.model, &n.variant, &n.compatibility);
    Finales {
        name,
        brand: n.brand,
        model: n.model,
        variant: n.variant,
        compatibility: n.compatibility,
        search_text,
        price_cost,
        price_sale,
        price_usd,
        stock: stock_final,
        min_stock,
        supplier,
        code,
        in_use,
    }
}

#[derive(Debug, Clone, Default)]
struct Finales {    name: String,
    brand: String,
    model: String,
    variant: String,
    compatibility: String,
    search_text: String,
    price_cost: f64,
    price_sale: f64,
    price_usd: f64,
    stock: i64,
    min_stock: i64,
    supplier: String,
    code: String,
    in_use: i64,
}

/// F78 — Aplica la carga. `cache` es la memoria del catálogo (feature 41): se usa para saber, con la
/// MISMA fuente que el padrón de Modelos, si un teléfono nuevo quedó «en uso».
///
/// Fallas CERRADO: si alguna fila trae algo que no se entiende (o un producto nuevo sin categoría, o
/// un nombre repetido sin decirlo), NO se escribe nada y se devuelve el motivo con el número de línea.
pub fn apply_csv(
    conn: &Connection,
    db_path: &Path,
    cache: &mut crate::cache::CatalogCache,
    input: &CsvApplyInput,
) -> Result<CsvReport, String> {
    let activas: Vec<&CsvRow> = input.rows.iter().filter(|r| !r.excluded).collect();
    if activas.is_empty() {
        return Err("No hay ninguna fila para cargar (todas están quitadas).".to_string());
    }
    // El payload lo arma la PANTALLA, que además deja editar las celdas: los topes del parser no
    // alcanzan (una celda de stock con 20 dígitos pegados llega cruda al backend). Todo se valida ACÁ
    // antes de respaldar y de escribir: un número fuera de rango es un error, nunca un recorte mudo ni
    // un desborde (un `i64::MAX` sumado al stock desbordaba y dejaba el stock en 0 — lo cazó la
    // revisión adversarial de seguridad).
    if input.rows.len() > MAX_ROWS {
        return Err(format!(
            "El archivo trae {} filas y el máximo por carga es {MAX_ROWS}: partilo en dos.",
            input.rows.len()
        ));
    }

    // 1) validación de lo que NO se puede adivinar
    let confirmadas: BTreeSet<String> = input.new_categories.iter().map(|c| crate::db::plegar_texto(c)).collect();
    let mut problemas: Vec<String> = Vec::new();
    // dos filas que CREAN el mismo nombre (o el mismo código): el nombre es único. La pantalla lo
    // bloquea, pero la pantalla no es el único guardián (el operario puede editar los nombres).
    let mut nombres_nuevos: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    let mut codigos_nuevos: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    for r in &activas {
        for i in &r.issues {
            problemas.push(format!("Línea {} ({}) — {i}", r.line, if r.name.is_empty() { "sin nombre" } else { r.name.as_str() }));
        }
        if let Some(q) = r.stock {
            if !(0..=MAX_QTY).contains(&q) {
                problemas.push(format!("Línea {} — el stock «{q}» está fuera del rango 0…{MAX_QTY}.", r.line));
            }
        }
        if let Some(q) = r.min_stock {
            if !(0..=MAX_QTY).contains(&q) {
                problemas.push(format!("Línea {} — el stock mínimo «{q}» está fuera del rango 0…{MAX_QTY}.", r.line));
            }
        }
        for (campo, v) in [("costo", r.price_cost), ("venta", r.price_sale), ("efectivo", r.price_usd)] {
            if let Some(v) = v {
                if !(0.0..=MAX_PRECIO).contains(&v) {
                    problemas.push(format!("Línea {} — el precio de {campo} «{v}» está fuera del rango 0…{MAX_PRECIO:.0}.", r.line));
                }
            }
        }
        match r.action.as_str() {
            "crear" => {
                if (r.name_clash || r.code_clash) && !r.create_anyway {
                    problemas.push(format!(
                        "Línea {} — «{}» ya existe en el catálogo{}: elegí «actualizar», cambiá el nombre/código \
                         o marcá «crear igual (otra variante)».",
                        r.line, r.name,
                        if r.code_clash { " (el código es de otra ficha)" } else { "" }
                    ));
                }
                // la categoría puede ser NUEVA (se crea si el operario la confirmó): lo que no puede
                // faltar es el NOMBRE de la categoría (una ficha sin categoría cae fuera de los filtros)
                if r.category_id.is_none() && r.category.trim().is_empty() {
                    problemas.push(format!("Línea {} — «{}» es nuevo y no tiene categoría.", r.line, r.name));
                }
                nombres_nuevos.entry(crate::db::plegar_texto(&r.name)).or_default().push(r.line);
                if !r.code.trim().is_empty() {
                    codigos_nuevos.entry(r.code.trim().to_uppercase()).or_default().push(r.line);
                }
            }
            "actualizar" => {
                if r.product_id.is_none() {
                    problemas.push(format!("Línea {} — no encontré la ficha para actualizar «{}».", r.line, r.name));
                }
            }
            "eliminar" => {
                if r.product_id.is_none() {
                    problemas.push(format!("Línea {} — no hay nada que eliminar en «{}».", r.line, r.name));
                }
            }
            "dejar" => {}
            otro => problemas.push(format!("Línea {} — acción desconocida «{otro}».", r.line)),
        }
    }
    for (nombre, lineas) in &nombres_nuevos {
        if lineas.len() > 1 && !nombre.is_empty() {
            problemas.push(format!(
                "El nombre «{}» se crea en {} filas del archivo (líneas {}): el nombre es único — dejá una \
                 o cambiá el nombre de las otras.",
                nombre, lineas.len(),
                lineas.iter().map(|l| l.to_string()).collect::<Vec<_>>().join(", ")
            ));
        }
    }
    for (code, lineas) in &codigos_nuevos {
        if lineas.len() > 1 {
            problemas.push(format!(
                "El código «{code}» se repite en {} filas nuevas del archivo (líneas {}).",
                lineas.len(),
                lineas.iter().map(|l| l.to_string()).collect::<Vec<_>>().join(", ")
            ));
        }
    }
    if !problemas.is_empty() {
        let muestra = problemas.iter().take(6).cloned().collect::<Vec<_>>().join("\n· ");
        let extra = if problemas.len() > 6 { format!("\n(y {} más)", problemas.len() - 6) } else { String::new() };
        return Err(format!("No se cargó nada — revisá el archivo:\n· {muestra}{extra}"));
    }

    // 2) respaldo ANTES de escribir (el mismo mecanismo probado del conteo: `VACUUM INTO` incluye el WAL)
    let stamp: String = conn
        .query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let dir = db_path.parent().unwrap_or(Path::new(".")).join("backup");
    std::fs::create_dir_all(&dir).ok();
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
            return Err("No pude cerrar el WAL para el respaldo (¿hay otra ventana de la app abierta?): no se cargó nada.".to_string());
        }
        std::fs::copy(db_path, &dest).map_err(|e| {
            format!("No pude hacer el respaldo antes de cargar ({e}; intento previo: {vacuum_err}): no se cargó nada.")
        })?;
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut report = CsvReport { backup: dest_str, ..Default::default() };

    // categorías: mapa plegado → id, y las NUEVAS se crean solo si el operario las confirmó (con las
    // MISMAS reglas de `add_category`, DENTRO de esta transacción: si algo falla, no queda suelta).
    // `confirmadas` se calculó arriba, en la validación.
    let mut categorias: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, name FROM categories").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, name) = row.map_err(|e| e.to_string())?;
            categorias.insert(crate::db::plegar_texto(&name), id);
        }
    }
    // qué teléfonos existían antes (para saber cuáles nacen con esta carga)
    let ultimo_phone: i64 = tx
        .query_row("SELECT COALESCE(MAX(id),0) FROM phones", [], |r| r.get(0))
        .unwrap_or(0);
    // ── la foto FRESCA del catálogo (una sola lectura para todo el archivo): es la que manda para
    // sumar el stock y para conservar lo que la celda vacía no toca.
    //
    // `vivo` se ACTUALIZA con cada escritura: si dos filas del archivo caen en la misma ficha (el mismo
    // id/código dos veces, o la misma categoría+marca+modelo), la segunda tiene que sumar sobre lo que
    // escribió la primera. Con la foto congelada, la segunda PISABA el stock de la primera y el
    // historial quedaba diciendo +15 mientras el stock subía 5 (bloqueante de la revisión adversarial).
    let mut vivo: HashMap<i64, CsvCurrent> = leer_catalogo(&tx)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|f| (f.current.id, f.current))
        .collect();
    // fichas que ESTE archivo ya borró: cualquier otra fila que apunte a una de ellas es un error (si no,
    // el UPDATE afectaría 0 filas y el informe diría «actualizada» sobre una ficha que ya no existe, o el
    // movimiento de inventario chocaría con la FK en inglés).
    let mut borrados: BTreeSet<i64> = BTreeSet::new();
    // fichas que ESTA carga escribió (creadas o actualizadas) y con qué stock quedaron: es lo que decide
    // el «en uso» de los teléfonos que nacen (misma regla que `add_product`: stock > 0 ⇒ en uso).
    let mut escritos: BTreeMap<i64, i64> = BTreeMap::new();
    // el padrón de teléfonos se reconstruye UNA sola vez y solo si esta carga cambió algo que lo afecta
    let mut padron_sucio = false;

    for row in &activas {
        match row.action.as_str() {
            "dejar" => { report.kept += 1; }
            "eliminar" => {
                let Some(pid) = row.product_id else { continue };
                if borrados.contains(&pid) {
                    // otra fila del archivo ya la borró: se cuenta UNA vez (antes el informe mentía con
                    // «2 eliminados» y el segundo DELETE afectaba 0 filas)
                    continue;
                }
                let stock: i64 = tx
                    .query_row("SELECT COALESCE(stock,0) FROM products WHERE id=?1", params![pid], |r| r.get(0))
                    .unwrap_or(0);
                // El DELETE tiene que afectar EXACTAMENTE una fila: si la ficha ya no está (otra
                // ventana la borró entre revisar y aplicar) se aborta la carga entera, no se sigue.
                let n = tx.execute("DELETE FROM products WHERE id=?1", params![pid]).map_err(|e| {
                    // el mensaje tiene que hablar como el resto de la app (el mismo texto que da
                    // `delete_product` cuando la ficha está en uso por ventas/servicios/movimientos)
                    if let rusqlite::Error::SqliteFailure(f, _) = &e {
                        if f.code == rusqlite::ErrorCode::ConstraintViolation {
                            format!(
                                "Línea {} — «{}» está en uso (ventas, servicios o movimientos) y no se \
                                 puede eliminar: cambiá esa fila a «Dejar como está» o quitá el producto \
                                 desde el inventario. No se cargó nada.",
                                row.line, row.name
                            )
                        } else {
                            format!("Línea {} — no pude eliminar «{}»: {e}. No se cargó nada.", row.line, row.name)
                        }
                    } else {
                        format!("Línea {} — no pude eliminar «{}»: {e}. No se cargó nada.", row.line, row.name)
                    }
                })?;
                if n != 1 {
                    return Err(format!(
                        "Línea {} — la ficha «{}» ya no existe: volvé a revisar el archivo. No se cargó nada.",
                        row.line, row.name
                    ));
                }
                report.deleted += 1;
                borrados.insert(pid);
                vivo.remove(&pid);
                escritos.remove(&pid);
                padron_sucio = true;
                if stock != 0 {
                    // el movimiento queda con product_id NULL: la ficha ya no existe, pero el historial
                    // tiene que decir que salió mercancía (y el informe, que el catálogo bajó)
                    tx.execute(
                        "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference)
                         VALUES (NULL, ?1, ?2, ?3, ?4)",
                        params![if stock < 0 { "entrada" } else { "salida" }, stock.abs(), MOTIVO, input.file_name.clone()],
                    )
                    .map_err(|e| e.to_string())?;
                    report.movements += 1;
                    report.units_added -= stock;
                }
            }
            _ => {
                // categoría de la fila: la del archivo (existente), la nueva confirmada, o la que ya tenía
                let mut category_id = row.category_id;
                if category_id.is_none() && !row.category.trim().is_empty() {
                    let clave = crate::db::plegar_texto(&row.category);
                    if let Some(id) = categorias.get(&clave) {
                        category_id = Some(*id);
                    } else if confirmadas.contains(&clave) {
                        let out = crate::db::Database::crear_categoria_en(&tx, &row.category, "").map_err(|e| e.to_string())?;
                        categorias.insert(clave, out.category.id);
                        category_id = Some(out.category.id);
                        if out.created { report.categories_new.push(out.category.name); }
                    } else {
                        return Err(format!(
                            "Línea {} — la categoría «{}» no existe y no confirmaste crearla: marcala en \
                             «categorías nuevas» o corregí la fila. No se cargó nada.",
                            row.line, row.category
                        ));
                    }
                }
                // Los valores ACTUALES de una ficha que se ACTUALIZA se leen ACÁ, dentro de la
                // transacción (no se confía en los que traía la vista previa): entre revisar y aplicar
                // pueden pasar minutos y otra pantalla puede haber cambiado esa ficha — y el stock se
                // SUMA, así que sumarle a un número viejo escribiría un stock que nadie pidió.
                // `vivo` (y no la foto inicial) es lo que hace que DOS filas del archivo sobre la misma
                // ficha sumen de verdad.
                let actualizacion = row.action == "actualizar";
                let pid = row.product_id;
                if let Some(id) = pid {
                    if borrados.contains(&id) {
                        return Err(format!(
                            "Línea {} — la ficha «{}» la eliminó otra fila del mismo archivo: sacá una de \
                             las dos. No se cargó nada.",
                            row.line, row.name
                        ));
                    }
                }
                let actual = match (actualizacion, pid) {
                    (true, Some(id)) => vivo.get(&id).cloned().ok_or_else(|| {
                        format!(
                            "Línea {} — la ficha #{id} («{}») ya no existe: volvé a revisar el archivo. No se cargó nada.",
                            row.line, row.name
                        )
                    })?,
                    _ => CsvCurrent::default(),
                };
                let stock_hoy = if actualizacion { actual.stock } else { 0 };
                let pedido = row.stock.unwrap_or(0);
                if !(0..=MAX_QTY).contains(&pedido) {
                    return Err(format!(
                        "Línea {} — el stock «{pedido}» está fuera del rango 0…{MAX_QTY}. No se cargó nada.",
                        row.line
                    ));
                }
                let stock_final = stock_hoy.checked_add(pedido).ok_or_else(|| {
                    format!("Línea {} — la suma del stock se sale de rango. No se cargó nada.", row.line)
                })?;
                if stock_final > MAX_QTY {
                    return Err(format!(
                        "Línea {} — el stock quedaría en {stock_final} (hoy {stock_hoy} + {pedido}) y el \
                         máximo es {MAX_QTY}. No se cargó nada.",
                        row.line
                    ));
                }
                let category_final = category_id.or(actual.category_id);
                let f = finales(row, &actual, &input.columns, &input.supplier, stock_final);

                if !actualizacion {
                    // el código no puede nacer repetido (la columna no tiene índice único): si ya es de
                    // otra ficha, la carga se frena acá en vez de dejar dos fichas con el mismo código
                    if !f.code.trim().is_empty() {
                        let dueno: Option<i64> = tx
                            .query_row(
                                "SELECT id FROM products WHERE UPPER(TRIM(COALESCE(code,''))) = ?1",
                                params![f.code.trim()],
                                |r| r.get(0),
                            )
                            .ok();
                        if let Some(otro) = dueno {
                            return Err(format!(
                                "Línea {} — el código «{}» ya es de la ficha #{otro}: cambiá el código o \
                                 marcá «actualizar esa ficha». No se cargó nada.",
                                row.line, f.code
                            ));
                        }
                    }
                    tx.execute(
                        "INSERT INTO products (name, category_id, brand, model, variant, compatibility,
                                               price_cost, price_sale, stock, min_stock, price_usd,
                                               search_text, in_use, supplier, code)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                        params![
                            f.name, category_final, f.brand, f.model, f.variant, f.compatibility,
                            f.price_cost, f.price_sale, f.stock, f.min_stock, f.price_usd,
                            f.search_text, f.in_use, f.supplier,
                            if f.code.trim().is_empty() { None } else { Some(f.code.clone()) }
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    let new_id = tx.last_insert_rowid();
                    // una ficha creada puede traer compatibilidad nueva: el padrón de teléfonos la tiene
                    // que ver
                    padron_sucio = true;
                    // código corto del local (P-0142) si el archivo no trajo uno
                    tx.execute(
                        "UPDATE products SET code = 'P-' || printf('%04d', id) WHERE id=?1 AND (code IS NULL OR code='')",
                        params![new_id],
                    )
                    .map_err(|e| e.to_string())?;
                    let code_real: String = tx
                        .query_row("SELECT COALESCE(code,'') FROM products WHERE id=?1", params![new_id], |r| r.get(0))
                        .unwrap_or_else(|_| f.code.clone());
                    // la ficha queda en `vivo` para que otra fila del archivo que caiga en ella (mismo
                    // id/código) sume sobre lo que se acaba de escribir, no sobre el catálogo de antes
                    vivo.insert(new_id, current_final(&f, category_final, &row.category, &actual, code_real));
                    escritos.insert(new_id, f.stock);
                    report.created += 1;
                    if !f.supplier.trim().is_empty() { report.suppliered += 1; }
                    if f.stock > 0 {
                        tx.execute(
                            "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference)
                             VALUES (?1, 'entrada', ?2, ?3, ?4)",
                            params![new_id, f.stock, MOTIVO, input.file_name.clone()],
                        )
                        .map_err(|e| e.to_string())?;
                        report.movements += 1;
                        report.units_added += f.stock;
                    }
                } else {
                    // ACTUALIZAR: se escriben los valores FINALES (el archivo manda donde trajo dato;
                    // donde la celda venía vacía se conserva lo que la ficha ya tenía)
                    let pid = pid.unwrap_or_default();
                    // el código no puede quedar repetido: si el archivo trae uno que ya es de OTRA ficha,
                    // se conserva el que la ficha tiene (y el operario lo ve en el diff de la pantalla)
                    let code_final = if f.code.trim().is_empty() {
                        None
                    } else {
                        let dueno: Option<i64> = tx
                            .query_row("SELECT id FROM products WHERE UPPER(TRIM(COALESCE(code,''))) = ?1", params![f.code.trim()], |r| r.get(0))
                            .ok();
                        match dueno {
                            Some(otro) if otro != pid => if actual.code.is_empty() { None } else { Some(actual.code.clone()) },
                            _ => Some(f.code.clone()),
                        }
                    };
                    let n = tx.execute(
                        "UPDATE products SET name=?1, category_id=?2, brand=?3, model=?4, variant=?5,
                                compatibility=?6, price_cost=?7, price_sale=?8, stock=?9, min_stock=?10,
                                price_usd=?11, search_text=?12, in_use=?13, supplier=?14, code=?15,
                                updated_at=datetime('now','localtime') WHERE id=?16",
                        params![
                            f.name, category_final, f.brand, f.model, f.variant, f.compatibility,
                            f.price_cost, f.price_sale, f.stock, f.min_stock, f.price_usd,
                            f.search_text, f.in_use, f.supplier, code_final, pid
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    // el UPDATE tiene que haber tocado UNA fila (misma defensa que el DELETE): con 0, la
                    // ficha desapareció y el informe no puede decir «actualizada»
                    if n != 1 {
                        return Err(format!(
                            "Línea {} — la ficha #{} («{}») ya no existe: volvé a revisar el archivo. No se cargó nada.",
                            row.line, pid, row.name
                        ));
                    }
                    vivo.insert(pid, current_final(&f, category_final, &row.category, &actual, code_final.clone().unwrap_or_default()));
                    escritos.insert(pid, f.stock);
                    // el padrón de teléfonos depende de la compatibilidad, del modelo/marca/variante y de
                    // la categoría: si alguno cambió, hay que reconstruirlo (y si no cambió, no se toca)
                    if f.compatibility != actual.compatibility
                        || f.brand != actual.brand
                        || f.model != actual.model
                        || f.variant != actual.variant
                        || f.name != actual.name
                        || category_final != actual.category_id
                    {
                        padron_sucio = true;
                    }
                    report.updated += 1;
                    if !f.supplier.trim().is_empty() { report.suppliered += 1; }
                    let delta = stock_final - stock_hoy;
                    if delta != 0 {
                        tx.execute(
                            "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![pid, if delta > 0 { "entrada" } else { "salida" }, delta.abs(), MOTIVO, input.file_name.clone()],
                        )
                        .map_err(|e| e.to_string())?;
                        report.movements += 1;
                        report.units_added += delta;
                    }
                }
            }
        }
    }
    report.skipped = input.rows.iter().filter(|r| r.excluded).count() as i64;

    // padrón de teléfonos: se reconstruye UNA sola vez (hacerlo por producto, como `add_product`,
    // sería cuadrático con 1.000 filas) y los teléfonos que NACEN con esta carga quedan numerados.
    // El error NO se ignora: la carga ya es una transacción, así que un padrón a medias se deshace con
    // todo lo demás (antes un `let _ =` commiteaba la carga con el padrón desincronizado).
    if padron_sucio {
        catalog::rebuild_phones(&tx, false)
            .map_err(|e| format!("No pude reconstruir el padrón de teléfonos ({e}): no se cargó nada."))?;
        tx.execute(
            "UPDATE phones SET code = 'M-' || printf('%04d', id) WHERE id > ?1 AND (code IS NULL OR code='')",
            params![ultimo_phone],
        )
        .map_err(|e| e.to_string())?;
        // «en uso» para los teléfonos nuevos: si alguno de sus repuestos quedó CON STOCK (la misma regla
        // de `add_product`: stock > 0 ⇒ en uso — antes miraba solo las fichas CREADAS, así que una ficha
        // actualizada con stock dejaba su teléfono nuevo apagado). El índice es el MISMO que usa el
        // padrón de Modelos (`phones::build_index`), no un segundo criterio.
        let idx = cache.phone_index(&tx).map_err(|e| e.to_string())?;
        let nuevos: Vec<(i64, String)> = {
            let mut stmt = tx
                .prepare("SELECT id, COALESCE(key,'') FROM phones WHERE id > ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![ultimo_phone], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            let mut v = Vec::new();
            for row in rows { v.push(row.map_err(|e| e.to_string())?); }
            v
        };
        for (id, key) in nuevos {
            let en_uso = idx
                .get(&key)
                .map(|e| e.ids.iter().any(|pid| escritos.get(pid).copied().unwrap_or(0) > 0))
                .unwrap_or(false);
            if en_uso {
                tx.execute("UPDATE phones SET in_use=1 WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(report)
}

/// La ficha tal como QUEDÓ después de escribirla: es lo que se guarda en `vivo` para que la próxima
/// fila del archivo que caiga en ella sume sobre el valor nuevo (y para que el diff siga diciendo la
/// verdad si el operario vuelve atrás en el asistente).
fn current_final(f: &Finales, category_id: Option<i64>, category_row: &str, actual: &CsvCurrent, code: String) -> CsvCurrent {
    CsvCurrent {
        id: actual.id,
        name: f.name.clone(),
        category: if category_row.trim().is_empty() { actual.category.clone() } else { category_row.trim().to_string() },
        category_id,
        brand: f.brand.clone(),
        model: f.model.clone(),
        variant: f.variant.clone(),
        compatibility: f.compatibility.clone(),
        compatibility_text: catalog::parse_compat_publica(&f.compatibility).join(" / "),
        price_cost: f.price_cost,
        price_sale: f.price_sale,
        price_usd: f.price_usd,
        stock: f.stock,
        min_stock: f.min_stock,
        supplier: f.supplier.clone(),
        code,
        in_use: f.in_use,
    }
}

/// F78 — El catálogo en CSV (mismo encabezado que la plantilla). OJO: exportar → editar → reimportar
/// NO da «0 cambios» en el stock si el archivo trae la columna `stock`: el stock del archivo **SUMA**
/// (es la regla de la carga). Para una edición de datos sin tocar mercancía, vaciá la columna `stock`
/// (o borrá su encabezado): una celda vacía no toca el stock. `category_id = None` = todas las categorías.
pub fn export_csv(conn: &Connection, category_id: Option<i64>) -> SqlResult<String> {
    let mut sql = String::from(
        "SELECT COALESCE(p.name,''), COALESCE(c.name,''), COALESCE(p.brand,''), COALESCE(p.model,''),
                COALESCE(p.variant,''), COALESCE(p.compatibility,'[]'), COALESCE(p.price_cost,0),
                COALESCE(p.price_sale,0), COALESCE(p.price_usd,0), COALESCE(p.stock,0),
                COALESCE(p.min_stock,0), COALESCE(p.supplier,''), COALESCE(p.code,''),
                COALESCE(p.in_use,1), p.id
         FROM products p LEFT JOIN categories c ON p.category_id = c.id",
    );
    let mut params_dyn: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(cid) = category_id {
        sql.push_str(" WHERE p.category_id = ?1");
        params_dyn.push(Box::new(cid));
    }
    sql.push_str(" ORDER BY c.name, p.name");
    let refs: Vec<&dyn rusqlite::types::ToSql> = params_dyn.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(refs.as_slice(), |r| {
        Ok((
            r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?,
            r.get::<_, String>(4)?, r.get::<_, String>(5)?, r.get::<_, f64>(6)?, r.get::<_, f64>(7)?,
            r.get::<_, f64>(8)?, r.get::<_, i64>(9)?, r.get::<_, i64>(10)?, r.get::<_, String>(11)?,
            r.get::<_, String>(12)?, r.get::<_, i64>(13)?, r.get::<_, i64>(14)?,
        ))
    })?;

    let mut out = String::new();
    out.push_str(&TODAS.iter().map(|c| c.titulo()).collect::<Vec<_>>().join(";"));
    out.push('\n');
    for row in rows {
        let (name, cat, brand, model, variant, compat, cost, sale, cash, stock, min_stock, supplier, code, in_use, id) = row?;
        let compat_lista = catalog::parse_compat_publica(&compat).join(" / ");
        let campos = [
            name,
            cat,
            brand,
            model,
            variant,
            compat_lista,
            numero(cost),
            numero(sale),
            numero(cash),
            stock.to_string(),
            min_stock.to_string(),
            supplier,
            code,
            if in_use != 0 { "si".to_string() } else { "no".to_string() },
            id.to_string(),
        ];
        out.push_str(&campos.iter().map(|c| campo_csv(c)).collect::<Vec<_>>().join(";"));
        out.push('\n');
    }
    Ok(out)
}

/// Número con coma decimal (lo que el local escribe a mano), sin ceros de más y SIN perder precisión:
/// `{}` de Rust da la representación más corta que vuelve a leerse igual (`0.125` → `0,125`), mientras
/// que `{:.2}` redondeaba un precio de 3 decimales y la ida y vuelta cambiaba la ficha.
fn numero(v: f64) -> String {
    if v.fract().abs() < f64::EPSILON {
        format!("{}", v as i64)
    } else {
        format!("{v}").replace('.', ",")
    }
}

/// Escapa un campo (el separador es `;`): comillas dobles si trae `;`, `"` o salto de línea.
fn campo_csv(s: &str) -> String {
    if s.contains(';') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// F78 — La PLANTILLA que se descarga desde la pantalla: encabezado + instrucciones + ejemplos de
/// las categorías que el local carga siempre (batería, flex, pin de carga…).
pub fn plantilla_csv() -> String {
    let encabezado = TODAS.iter().map(|c| c.titulo()).collect::<Vec<_>>().join(";");
    format!(
        "# Plantilla de carga de inventario (CSV). Borrá estas líneas de # y las filas de ejemplo.\n\
         # nombre = obligatorio y ÚNICO. categoria = si no existe, la app te la crea.\n\
         # stock = SUMA al que ya hay (nunca lo pisa). costo/venta/efectivo en $ (podés escribir 12,50).\n\
         # compatibilidad = teléfonos separados con / (no con coma). en_uso = si/no (vacío = lo decide el stock).\n\
         # Celda vacía = ese dato NO se toca (ni el stock, ni los precios, ni la marca). Si querés BORRAR\n\
         # un dato (por ejemplo la compatibilidad), escribí un guion: -.\n\
         # Los números pueden venir en notación científica de Excel (1,5E3 = 1500) y no pasa nada.\n\
         {encabezado}\n\
         Pantalla Samsung A06 4G INCELL;Batería;Samsung;A06 4G;INCELL;Samsung A06 4G / Samsung A06;4,50;9,00;8,00;3;1;Cell World;P-0001;si;\n\
         Flex de carga Tecno Spark 8P;Flex;Tecno;Spark 8P;;Tecno Spark 8P;1,20;4,00;3,50;5;2;Importadora;P-0002;si;\n\
         Pin de carga Redmi 9A;Pin de carga;Xiaomi;Redmi 9A;;Redmi 9A / Redmi 9C;0,80;3,00;2,50;0;2;Importadora;;no;\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::path::PathBuf;

    /// Base temporal de test (NUNCA toca registro.db del local).
    fn setup(name: &str) -> (Database, PathBuf) {
        let path = std::env::temp_dir().join(format!("registro_csv_{}_{}.db", name, std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Database::new(&path).expect("base de test");
        // categorías del arranque: se usan las que ya trae `init()` (Pantalla=1, Batería=4…)
        db.add_product("Pantalla Samsung A06 4G", Some(1), "Samsung", "A06 4G", "", r#"["Samsung A06 4G"]"#, 4.0, 9.0, 3, 1, 8.0).unwrap();
        (db, path)
    }

    fn aplicar(db: &Database, texto: &str, proveedor: &str) -> Result<CsvReport, String> {
        let preview = db.preview_csv_load(texto).unwrap();
        assert!(preview.fatal.is_none(), "archivo fatal: {:?}", preview.fatal);
        let nuevas: Vec<String> = preview.new_categories.iter().map(|c| c.name.clone()).collect();
        db.apply_csv_load(&CsvApplyInput {
            rows: preview.rows.clone(),
            columns: preview.columns.clone(),
            supplier: proveedor.to_string(),
            file_name: "prueba.csv".to_string(),
            new_categories: nuevas,
        })
    }

    // ── 1. El parser: comillas, separadores, BOM, comentarios y columnas que no conozco

    #[test]
    fn test_parser_tolerante() {
        let texto = "\u{feff}# comentario de la plantilla\nnombre;categoria;costo;stock\n\"Pantalla, rara\";Pantalla;\"1.234,56\";2\n";
        let sep = detectar_separador(texto);
        assert_eq!(sep, ';', "el separador se detecta por la primera línea útil");
        let filas = parse_filas(texto, sep);
        assert_eq!(filas.len(), 2, "el comentario y el BOM no cuentan: {filas:?}");
        assert_eq!(filas[1].cells[0], "Pantalla, rara");
        assert_eq!(filas[1].cells[2], "1.234,56");
    }

    #[test]
    fn test_numeros_del_local() {
        // decimales con coma, con punto, con símbolo de moneda y miles
        assert_eq!(leer_numero("12,50").unwrap().unwrap(), 12.5);
        assert_eq!(leer_numero("12.50").unwrap().unwrap(), 12.5);
        assert_eq!(leer_numero("$ 5,20").unwrap().unwrap(), 5.2);
        assert_eq!(leer_numero("1.234,56").unwrap().unwrap(), 1234.56);
        assert_eq!(leer_numero("1,234.56").unwrap().unwrap(), 1234.56);
        assert_eq!(leer_numero("1.234").unwrap().unwrap(), 1234.0, "3 dígitos detrás = miles (formato del local)");
        assert_eq!(leer_numero("8").unwrap().unwrap(), 8.0);
        // celda vacía = no se toca; basura = aviso
        assert!(leer_numero("   ").is_none());
        assert!(leer_numero("dos pesos").unwrap().is_err());
        // cantidades: negativas y absurdas se rechazan
        assert_eq!(leer_cantidad("3").unwrap().unwrap(), 3);
        assert!(leer_cantidad("-2").unwrap().is_err());
        assert!(leer_cantidad("999999").unwrap().is_err());
    }

    // ── 2. La vista previa: nuevo vs existente, categoría nueva y nombre repetido

    #[test]
    fn test_preview_clasifica_nuevo_y_existente() {
        let (db, _p) = setup("clasifica");
        let texto = "nombre;categoria;marca;modelo;costo;venta;stock\n\
                     Pantalla Samsung A06 4G;Batería;Samsung;A06 4G;4,50;10,00;2\n\
                     Pantalla Tecno Spark 8C;Pantalla;Tecno;Spark 8C;3,00;7,00;5\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert_eq!(p.total_rows, 2);
        assert_eq!(p.new_count, 2, "la del nombre repetido NO se cuenta como actualización: hay que decidir");
        assert_eq!(p.exists_count, 0);
        // La fila 1 trae el MISMO nombre que la ficha de «Pantalla» pero otra categoría: no se puede
        // adivinar cuál es — queda como nombre repetido y el operario decide (nada se pisa solo).
        let fila = &p.rows[0];
        assert_eq!(fila.match_kind, "", "categoría distinta = no se adivina: {fila:?}");
        assert!(fila.product_id.is_none(), "no se toca la ficha de otra categoría sin que lo diga");
        assert!(fila.name_clash, "el nombre ya existe");
        assert_eq!(fila.clash_product_id, Some(1), "y se ofrece actualizar ESA ficha");
        assert!(fila.notes.iter().any(|n| n.contains("ya existe")), "{:?}", fila.notes);
        // la segunda es nueva y su categoría existe
        assert!(p.rows[1].product_id.is_none());
        assert!(!p.rows[1].category_new, "«Pantalla» ya existe");
        // categoría nueva detectada (el arranque ya trae Pantalla/Teléfono/Accesorio/Repuesto/Batería/Flex)
        let p2 = db.preview_csv_load("nombre;categoria;stock\nFlex Tecno;Pin de carga;2\n").unwrap();
        assert!(p2.rows[0].category_new, "«Pin de carga» no existe todavía");
        assert_eq!(p2.new_categories.len(), 1);
        assert_eq!(p2.new_categories[0].name, "Pin de carga");
    }

    #[test]
    fn test_preview_actualiza_la_ficha_existente_y_suma_stock() {
        let (db, _p) = setup("suma");
        let texto = "nombre;categoria;marca;modelo;costo;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;5,00;4\n";
        let p = db.preview_csv_load(texto).unwrap();
        let fila = &p.rows[0];
        assert!(fila.product_id.is_some(), "misma categoría+marca+modelo → es la misma ficha");
        assert_eq!(fila.action, "actualizar");
        assert_eq!(fila.current.as_ref().unwrap().stock, 3);
        assert_eq!(fila.stock_after, Some(7), "el stock SUMA: 3 + 4");
        assert!(fila.issues.is_empty(), "sin problemas: {:?}", fila.issues);
        assert_eq!(p.units_before, 3);
        assert_eq!(p.units_file, 4);
    }

    #[test]
    fn test_preview_nombre_repetido_no_crea_sin_decirlo() {
        let (db, _p) = setup("nombre");
        // mismo NOMBRE, pero otra categoría y otro modelo: el nombre ya existe → hay que decidir
        let texto = "nombre;categoria;marca;modelo;stock\n\
                     Pantalla Samsung A06 4G;Flex;Genérico;A06;1\n";
        let p = db.preview_csv_load(texto).unwrap();
        let fila = &p.rows[0];
        assert!(fila.name_clash, "el nombre (plegado) ya existe");
        assert!(fila.product_id.is_none(), "no se elige sola: la categoría no coincide");
        assert_eq!(fila.clash_product_id, Some(1), "se ofrece actualizar esa ficha");
        // y si el operario fuerza «crear igual» sin marcarlo, el aplicar lo rechaza
        let mut rows = p.rows.clone();
        rows[0].action = "crear".into();
        let claves: Vec<String> = p.new_categories.iter().map(|c| c.name.clone()).collect();
        let err = db.apply_csv_load(&CsvApplyInput {
            rows, columns: p.columns.clone(), supplier: String::new(), file_name: "x.csv".into(), new_categories: claves,
        }).unwrap_err();
        assert!(err.contains("ya existe en el catálogo"), "{err}");
        // y si el operario elige «actualizar esa ficha» (un clic), entra por el camino normal
        let mut rows2 = p.rows.clone();
        rows2[0].action = "actualizar".into();
        rows2[0].product_id = p.rows[0].clash_product_id;
        rows2[0].category_id = Some(1);
        let r = db.apply_csv_load(&CsvApplyInput {
            rows: rows2, columns: p.columns.clone(), supplier: String::new(), file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap();
        assert_eq!(r.updated, 1);
        assert_eq!(db.get_products("A06", None).unwrap()[0].stock, 4, "3 + 1");
    }

    #[test]
    fn test_preview_marca_los_errores_con_su_linea() {
        let (db, _p) = setup("errores");
        let texto = "nombre;categoria;stock\n\
                     ;;3\n\
                     Repuesto raro;Pantalla;cinco\n\
                     Otro repuesto;Pantalla;-4\n";
        let p = db.preview_csv_load(texto).unwrap();
        // fila 2: sin nombre
        assert!(p.rows[0].issues.iter().any(|i| i.contains("Falta el nombre")), "{:?}", p.rows[0].issues);
        // fila 3: stock ilegible
        assert!(p.rows[1].issues.iter().any(|i| i.contains("no es un número")), "{:?}", p.rows[1].issues);
        // fila 4: stock negativo
        assert!(p.rows[2].issues.iter().any(|i| i.contains("negativo")), "{:?}", p.rows[2].issues);
        // y el aplicar falla cerrado, nombrando la línea
        let err = db.apply_csv_load(&CsvApplyInput {
            rows: p.rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap_err();
        assert!(err.contains("No se cargó nada"), "{err}");
        assert!(err.contains("Línea 2"), "{err}");
    }

    #[test]
    fn test_archivo_sin_encabezado_o_vacio() {
        let (db, _p) = setup("vacio");
        assert!(db.preview_csv_load("").unwrap().fatal.is_some());
        assert!(db.preview_csv_load("# solo comentarios\n").unwrap().fatal.is_some());
        let sin_nombre = db.preview_csv_load("precio;stock\n9;2\n").unwrap();
        assert!(sin_nombre.fatal.unwrap().contains("nombre"));
    }

    // ── 3. Aplicar: crear, actualizar, dejar, eliminar + stock sumado + movimientos + respaldo

    #[test]
    fn test_aplicar_crea_actualiza_deja_y_elimina() {
        let (db, _p) = setup("aplicar");
        // «Pin de carga» NO está entre las categorías del arranque: la tiene que crear la carga
        let texto = "nombre;categoria;marca;modelo;variante;compatibilidad;costo;venta;efectivo;stock;stock_min;proveedor;codigo;en_uso\n\
                     Pantalla Tecno Spark 8C;Pantalla;Tecno;Spark 8C;;Tecno Spark 8C / Tecno Spark 8C Pro;3,00;7,00;6,00;5;2;Cell World;P-9001;si\n\
                     Pin de carga Redmi 9A;Pin de carga;Xiaomi;Redmi 9A;;Redmi 9A;1,20;4,00;3,50;4;2;Importadora;;si\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;;Samsung A06 4G;4,50;10,00;9,00;2;1;Cell World;;si\n";
        let r = aplicar(&db, texto, "Cell World").unwrap();
        assert_eq!(r.created, 2, "dos productos que no existían");
        assert_eq!(r.updated, 1);
        assert!(r.categories_new.iter().any(|c| c == "Pin de carga"), "{:?}", r.categories_new);
        assert!(r.backup.ends_with(".db"), "respaldo: {}", r.backup);
        assert!(std::path::Path::new(&r.backup).exists(), "el respaldo existe");
        // el stock SE SUMA en la ficha que ya estaba
        let p = db.get_products("A06", None).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].stock, 5, "3 (de antes) + 2 (del archivo)");
        assert_eq!(p[0].price_cost, 4.5, "el archivo manda en el costo");
        assert_eq!(p[0].price_sale, 10.0);
        // el producto nuevo entra con SUS datos y su código del archivo
        // el producto nuevo entra con SUS datos
        let flex = db.get_products("Pin de carga Redmi", None).unwrap();
        assert_eq!(flex.len(), 1);
        assert_eq!(flex[0].stock, 4);
        assert_eq!(flex[0].category_name.as_deref(), Some("Pin de carga"), "la categoría nueva se creó");
        assert!(flex[0].category_id.is_some_and(|id| !crate::catalog::PHONE_CATEGORIES.contains(&id)), "y no pisa los ids del padrón");
        assert_eq!(flex[0].supplier, "Importadora");
        assert!(flex[0].code.starts_with("P-"), "sin código en el archivo se numera solo: {}", flex[0].code);
        // movimientos con el motivo y el nombre del archivo
        let movs = db.get_inventory_movements_page(None, None, Some(MOTIVO), None, None, 50, 0).unwrap();
        assert!(movs.total >= 3, "un movimiento por cada cambio de stock: {}", movs.total);
        // y el padrón de teléfonos se reconstruyó: el teléfono nuevo existe
        let phones = db.get_phones_page(None, "Spark 8C", false, false, false, "nombre", "asc", 10, 0).unwrap();
        assert!(phones.total >= 1, "el padrón tiene el teléfono nuevo: {}", phones.total);
    }

    #[test]
    fn test_aplicar_respeta_la_celda_vacia_y_la_categoria_que_ya_tenia() {
        let (db, _p) = setup("vacio_no_toca");
        // el archivo NO trae costo ni venta (columnas ausentes) → se conservan
        let texto = "nombre;marca;modelo;stock\nPantalla Samsung A06 4G;Samsung;A06 4G;1\n";
        let p = db.preview_csv_load(texto).unwrap();
        let fila = &p.rows[0];
        assert!(fila.product_id.is_some(), "sin columna de categoría se cruza por marca+modelo ÚNICO");
        let r = db.apply_csv_load(&CsvApplyInput {
            rows: p.rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "sin-precios.csv".into(), new_categories: vec![],
        }).unwrap();
        assert_eq!(r.updated, 1);
        let prod = &db.get_products("A06", None).unwrap()[0];
        assert_eq!(prod.price_cost, 4.0, "el costo que ya tenía NO se toca");
        assert_eq!(prod.price_sale, 9.0);
        assert_eq!(prod.price_usd, 8.0);
        assert_eq!(prod.category_id, Some(1), "la categoría que ya tenía se conserva");
        assert_eq!(prod.stock, 4, "3 + 1");
    }

    #[test]
    fn test_aplicar_dejar_y_eliminar() {
        let (db, _p) = setup("dejar_eliminar");
        // la ficha a borrar existe de verdad (con stock), y la del archivo se reconoce por identidad
        let pid = db.add_product("Repuesto a borrar", Some(5), "Genérico", "Raro", "", "[]", 1.0, 3.0, 7, 1, 2.0).unwrap();
        let texto = "nombre;categoria;marca;modelo;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;0\n\
                     Repuesto a borrar;Batería;Genérico;Raro;0\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert_eq!(p.rows[1].product_id, Some(pid), "se reconoce por identidad (categoría+marca+modelo)");
        let mut rows = p.rows.clone();
        rows[0].action = "dejar".into();
        rows[1].action = "eliminar".into();
        let r = db.apply_csv_load(&CsvApplyInput {
            rows, columns: p.columns.clone(), supplier: String::new(), file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap();
        assert_eq!(r.kept, 1);
        assert_eq!(r.deleted, 1);
        assert_eq!(db.get_products("A06", None).unwrap()[0].stock, 3, "«dejar» no toca el stock");
        assert!(db.get_products("Repuesto a borrar", None).unwrap().is_empty());
    }

    #[test]
    fn test_aplicar_rechaza_un_producto_en_uso() {
        let (db, _p) = setup("en_uso");
        // un movimiento de inventario del producto → borrarlo tiene que fallar (FK). Fallar CERRADO:
        // la carga entera se deshace y el mensaje dice qué hacer (antes se saltaba la fila y el informe
        // decía «0 eliminados» con la carga ya commiteada: la mitad del archivo aplicada y la otra no).
        let pid = db.get_products("A06", None).unwrap()[0].id;
        db.add_inventory_movement(pid, "entrada", 3, "compra", "prueba").unwrap();
        let texto = "nombre;categoria;marca;modelo;stock\n\
                     Pantalla Tecno Spark 8C;Pantalla;Tecno;Spark 8C;5\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;0\n";
        let p = db.preview_csv_load(texto).unwrap();
        let mut rows = p.rows.clone();
        rows[1].action = "eliminar".into();
        let err = db.apply_csv_load(&CsvApplyInput {
            rows, columns: p.columns.clone(), supplier: String::new(), file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap_err();
        assert!(err.contains("está en uso"), "{err}");
        assert!(err.contains("No se cargó nada"), "{err}");
        // y NADA quedó a medias: la ficha sigue ahí y el producto de la fila 1 no se creó
        assert_eq!(db.get_products("A06", None).unwrap().len(), 1, "la ficha no se borró");
        assert!(db.get_products("Spark 8C", None).unwrap().is_empty(), "la fila anterior se deshizo");
    }

    #[test]
    fn test_categoria_nueva_no_confirmada_rechaza() {
        let (db, _p) = setup("cat_sin_confirmar");
        let texto = "nombre;categoria;stock\nRepuesto raro;Categoría inventada;2\n";
        let p = db.preview_csv_load(texto).unwrap();
        let err = db.apply_csv_load(&CsvApplyInput {
            rows: p.rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "x.csv".into(), new_categories: vec![], // NO la confirmó
        }).unwrap_err();
        assert!(err.contains("no existe y no confirmaste"), "{err}");
        // y con la confirmación sí entra, creando la categoría
        let r = aplicar(&db, texto, "").unwrap();
        assert_eq!(r.created, 1);
        assert_eq!(r.categories_new, vec!["Categoría inventada".to_string()]);
    }

    // ── 4. Ida y vuelta: exportar el catálogo y volver a importarlo = 0 cambios

    #[test]
    fn test_ida_y_vuelta_export_import() {
        let (db, _p) = setup("ida_vuelta");
        // catálogo con variedad: dos categorías, compatibilidad, proveedor y código
        db.add_product("Batería Samsung A30", Some(4), "Samsung", "A30", "", r#"["Samsung A30"]"#, 3.0, 8.0, 7, 1, 6.0).unwrap();
        db.set_product_supplier(2, "Cell World").unwrap();
        let csv = db.export_products_csv(None).unwrap();
        assert!(csv.starts_with("nombre;categoria"), "{csv}");
        assert!(csv.contains("Batería Samsung A30"), "{csv}");
        let p = db.preview_csv_load(&csv).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);
        assert_eq!(p.new_count, 0, "todo lo exportado se reconoce (nada nuevo)");
        assert_eq!(p.exists_count, 2);
        // ninguna fila trae problemas y el stock de cada una queda IGUAL (el archivo trae el stock… que
        // SUMA: por eso la ida y vuelta se verifica con el stock a 0 en el archivo, que es «no agregar»)
        let mut rows = p.rows.clone();
        for r in rows.iter_mut() { r.stock = Some(0); }
        let r = db.apply_csv_load(&CsvApplyInput {
            rows, columns: p.columns.clone(), supplier: String::new(), file_name: "export.csv".into(), new_categories: vec![],
        }).unwrap();
        assert_eq!(r.created, 0);
        assert_eq!(r.updated, 2);
        assert_eq!(r.units_added, 0, "0 unidades nuevas: la ida y vuelta no cambia el inventario");
        assert_eq!(r.movements, 0, "sin cambios de stock no hay movimientos");
        // y los datos quedan iguales
        let b = &db.get_products("Batería Samsung A30", None).unwrap()[0];
        assert_eq!(b.stock, 7);
        assert_eq!(b.supplier, "Cell World");
    }

    #[test]
    fn test_plantilla_se_puede_leer() {
        let (db, _p) = setup("plantilla");
        let p = db.preview_csv_load(&plantilla_csv()).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);
        assert_eq!(p.total_rows, 3, "tres filas de ejemplo");
        assert_eq!(p.ignored.len(), 0, "la plantilla solo usa columnas conocidas");
        assert_eq!(p.rows[0].name, "Pantalla Samsung A06 4G INCELL");
        assert_eq!(p.rows[0].stock, Some(3));
        assert_eq!(p.rows[0].price_cost, Some(4.5));
    }

    #[test]
    fn test_limite_de_filas() {
        let (db, _p) = setup("limite");
        let mut texto = String::from("nombre;categoria;stock\n");
        for i in 0..(MAX_ROWS + 1) {
            texto.push_str(&format!("Repuesto {i};Pantalla;1\n"));
        }
        let p = db.preview_csv_load(&texto).unwrap();
        assert!(p.fatal.unwrap().contains("partilo en dos"));
    }

    #[test]
    fn test_archivo_demasiado_grande() {
        let (db, _p) = setup("muy_grande");
        // un archivo de más de MAX_BYTES se rechaza ANTES de parsear (no se lleva la memoria)
        let gordo = "x".repeat(MAX_BYTES + 1);
        let p = db.preview_csv_load(&gordo).unwrap();
        assert!(p.fatal.unwrap().contains("MB"), "el aviso dice el peso y el tope");
    }

    // ── 6. Dos filas del archivo sobre la MISMA ficha: el stock SUMA de verdad (BLOQUEANTE de la
    //      revisión adversarial: la segunda fila pisaba el stock de la primera)

    #[test]
    fn test_dos_filas_de_la_misma_ficha_suman_stock() {
        let (db, _p) = setup("dos_filas_misma_ficha");
        // la ficha existe con stock 3; el archivo la trae DOS veces (10 y 5) y las dos por código
        db.set_product_code(1, "PANT-A06").unwrap();
        let texto = "nombre;categoria;marca;modelo;codigo;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;PANT-A06;10\n\
                     Pantalla Samsung A06;Pantalla;Samsung;A06 4G;PANT-A06;5\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);
        assert_eq!(p.rows[0].product_id, Some(1), "la primera entra por código");
        assert_eq!(p.rows[1].product_id, Some(1), "la segunda también: es la misma ficha");
        assert!(p.rows[0].shared >= 1, "la pantalla avisa que otra fila cae en la misma ficha");
        let r = db.apply_csv_load(&CsvApplyInput {
            rows: p.rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "dos.csv".into(), new_categories: vec![],
        }).unwrap();
        assert_eq!(r.updated, 2);
        assert_eq!(r.units_added, 15, "entraron 10 + 5");
        let prod = &db.get_products("A06", None).unwrap()[0];
        assert_eq!(prod.stock, 18, "3 (de antes) + 10 + 5: la segunda fila suma sobre la primera");
        // y el historial cuenta lo MISMO que el stock
        let movs = db.get_inventory_movements_page(Some(1), None, Some(MOTIVO), None, None, 50, 0).unwrap();
        let suma: i64 = movs.items.iter().map(|m| m.quantity).sum();
        assert_eq!(suma, 15, "los movimientos dicen lo mismo que el stock: {suma}");
    }

    #[test]
    fn test_eliminar_y_actualizar_la_misma_ficha_en_un_archivo_es_error() {
        let (db, _p) = setup("borrar_y_actualizar");
        db.set_product_code(1, "PANT-A06").unwrap();
        let texto = "nombre;categoria;marca;modelo;codigo;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;PANT-A06;0\n\
                     Pantalla Samsung A06;Pantalla;Samsung;A06 4G;PANT-A06;4\n";
        let p = db.preview_csv_load(texto).unwrap();
        let mut rows = p.rows.clone();
        rows[0].action = "eliminar".into();
        let err = db.apply_csv_load(&CsvApplyInput {
            rows, columns: p.columns.clone(), supplier: String::new(), file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap_err();
        assert!(err.contains("la eliminó otra fila"), "{err}");
        assert_eq!(db.get_products("A06", None).unwrap()[0].stock, 3, "no se tocó nada");
    }

    // ── 7. «Celda vacía = no se toca» también en los TEXTOS (marca/modelo/variante/compatibilidad)

    #[test]
    fn test_celda_vacia_no_borra_los_textos() {
        let (db, _p) = setup("vacio_textos");
        // el archivo trae TODAS las columnas, pero las celdas de marca/modelo/variante/compatibilidad
        // vacías: antes la ficha quedaba «Genérico», sin modelo y SIN compatibilidad (y con eso el
        // repuesto perdía su teléfono en el padrón de Modelos)
        let texto = "nombre;categoria;marca;modelo;variante;compatibilidad;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;;;;;5\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert_eq!(p.rows[0].product_id, Some(1), "se reconoce por nombre (misma categoría)");
        let r = db.apply_csv_load(&CsvApplyInput {
            rows: p.rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "vacio.csv".into(), new_categories: vec![],
        }).unwrap();
        assert_eq!(r.updated, 1);
        let prod = &db.get_products("A06", None).unwrap()[0];
        assert_eq!(prod.brand.as_deref(), Some("Samsung"), "la marca NO se borra con la celda vacía");
        assert_eq!(prod.model.as_deref(), Some("A06 4G"));
        assert_eq!(prod.compatibility.as_deref(), Some(r#"["Samsung A06 4G"]"#), "la compatibilidad curada NO se pierde");
        assert_eq!(prod.stock, 8, "3 + 5 (el stock sí se suma)");
        // y el guion SÍ borra (es la forma explícita de dejar un campo en blanco)
        let texto2 = "nombre;categoria;marca;modelo;compatibilidad\nPantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;-\n";
        let p2 = db.preview_csv_load(texto2).unwrap();
        db.apply_csv_load(&CsvApplyInput {
            rows: p2.rows.clone(), columns: p2.columns.clone(), supplier: String::new(),
            file_name: "guion.csv".into(), new_categories: vec![],
        }).unwrap();
        let prod2 = &db.get_products("A06", None).unwrap()[0];
        assert_eq!(prod2.compatibility.as_deref(), Some(""), "el guion vacía la compatibilidad a propósito");
        assert_eq!(prod2.brand.as_deref(), Some("Samsung"), "y no toca lo demás");
    }

    // ── 8. Choques y validaciones que bloquean (revisión adversarial)

    #[test]
    fn test_codigo_de_otra_categoria_no_actualiza_la_ficha_ajena() {
        let (db, _p) = setup("codigo_ajeno");
        // una BATERÍA con el código BAT-1; el archivo trae una PANTALLA con ese código
        let bat = db.add_product("Batería Samsung A30", Some(4), "Samsung", "A30", "", "[]", 3.0, 8.0, 6, 1, 6.0).unwrap();
        db.set_product_code(bat, "BAT-1").unwrap();
        let texto = "nombre;categoria;marca;modelo;codigo;stock\n\
                     Pantalla rara;Pantalla;Samsung;A30;BAT-1;2\n";
        let p = db.preview_csv_load(texto).unwrap();
        let fila = &p.rows[0];
        assert!(fila.code_clash, "el choque de código se marca: {:?}", fila.notes);
        assert_eq!(fila.product_id, None, "no se cuelga de la batería");
        let err = db.apply_csv_load(&CsvApplyInput {
            rows: p.rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "choque.csv".into(), new_categories: vec![],
        }).unwrap_err();
        assert!(err.contains("el código es de otra ficha"), "{err}");
        // la batería quedó intacta (nombre, categoría y stock)
        let b = &db.get_products("Batería Samsung A30", None).unwrap()[0];
        assert_eq!(b.stock, 6);
        assert_eq!(b.category_id, Some(4));
        assert_eq!(b.name, "Batería Samsung A30");
    }

    #[test]
    fn test_dos_filas_nuevas_con_el_mismo_nombre_bloquean() {
        let (db, _p) = setup("dos_nuevas_iguales");
        let texto = "nombre;categoria;marca;modelo;stock\n\
                     Flex nuevo Tecno;Flex;;;3\n\
                     Flex nuevo Tecno;Flex;;;4\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);
        assert!(p.rows[0].issues.iter().any(|i| i.contains("mismo nombre")), "{:?}", p.rows[0].issues);
        let err = db.apply_csv_load(&CsvApplyInput {
            rows: p.rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap_err();
        assert!(err.contains("el nombre es único"), "{err}");
        assert!(db.get_products("Flex nuevo", None).unwrap().is_empty());
    }

    #[test]
    fn test_numeros_absurdos_bloquean_la_fila() {
        let (db, _p) = setup("numeros_absurdos");
        // La notación científica es un número VÁLIDO (Excel la usa), no un «15»: 1E5 = cien mil.
        let p = db.preview_csv_load("nombre;categoria;marca;modelo;costo;stock\nRaro;Pantalla;;;1,5E3;1E5\n").unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);
        assert_eq!(p.rows[0].price_cost, Some(1500.0), "1,5E3 es mil quinientos");
        assert_eq!(p.rows[0].stock, Some(100_000), "1E5 es cien mil, no quince");
        assert!(p.rows[0].issues.is_empty(), "y es un dato válido: {:?}", p.rows[0].issues);
        // por encima del tope sí bloquea
        let p2 = db.preview_csv_load("nombre;categoria;marca;modelo;stock\nRaro;Pantalla;;;1E6\n").unwrap();
        assert!(p2.rows[0].issues.iter().any(|i| i.contains("absurdo")), "{:?}", p2.rows[0].issues);
        // un precio negativo no es un dato: bloquea
        let p2 = db.preview_csv_load("nombre;categoria;marca;modelo;costo\nRaro;Pantalla;;;-5\n").unwrap();
        assert!(p2.rows[0].issues.iter().any(|i| i.contains("negativo")), "{:?}", p2.rows[0].issues);
        // y una celda que no es un número tampoco se adivina
        let p3 = db.preview_csv_load("nombre;categoria;marca;modelo;venta\nRaro;Pantalla;;;doce\n").unwrap();
        assert!(p3.rows[0].issues.iter().any(|i| i.contains("no es un número")), "{:?}", p3.rows[0].issues);
    }

    #[test]
    fn test_el_payload_del_frontend_se_valida_en_el_backend() {
        let (db, _p) = setup("payload");
        let texto = "nombre;categoria;marca;modelo;stock\nPantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;2\n";
        let p = db.preview_csv_load(texto).unwrap();
        // la pantalla puede mandar cualquier cosa en la celda de stock: el backend tiene que rechazarla
        let mut rows = p.rows.clone();
        rows[0].stock = Some(i64::MAX);
        let err = db.apply_csv_load(&CsvApplyInput {
            rows: rows.clone(), columns: p.columns.clone(), supplier: String::new(),
            file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap_err();
        assert!(err.contains("fuera del rango"), "{err}");
        assert_eq!(db.get_products("A06", None).unwrap()[0].stock, 3, "no se escribió nada");
        // y un precio absurdo tampoco
        let mut rows2 = p.rows.clone();
        rows2[0].price_sale = Some(-1.0);
        let err2 = db.apply_csv_load(&CsvApplyInput {
            rows: rows2, columns: p.columns.clone(), supplier: String::new(),
            file_name: "x.csv".into(), new_categories: vec![],
        }).unwrap_err();
        assert!(err2.contains("fuera del rango"), "{err2}");
    }
}
