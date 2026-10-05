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
//!   · **El modo del stock lo elige el asistente** (F86): «Sumar (compras)» = `stock hoy + archivo` (el
//!     de siempre, y el que se usa si no se dice nada) · «Reemplazar» = el archivo ES el inventario.
//!   · **La carga nunca escribe un stock NEGATIVO** (F86): si la ficha venía en −60 y el archivo trae 30,
//!     el stock final es **0** y el informe lo dice — antes lo arrastraba a −30 sin avisar.
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

// ---------------------------------------------------------------- modo del stock (F86/REQ-3)

/// REQ-3 (F86, decisión D1 del dueño): el asistente elige qué significa la columna `stock` del archivo.
///
/// - `sumar` (por DEFECTO, y lo que hacía la carga antes de F86): `stock final = stock de hoy + archivo`.
///   Es la carga de compras: el archivo trae lo que entró.
/// - `reemplazar`: `stock final = el del archivo` (el archivo ES el inventario real, como el conteo
///   físico). Si la celda de stock viene VACÍA se conserva el stock actual: «vacío = no se toca» vale en
///   los dos modos, y en modo reemplazar interpretarlo como 0 BORRARÍA la mercancía que la ficha tiene
///   (un archivo al que se le olvidó una columna dejaría el catálogo en cero).
pub const MODO_SUMAR: &str = "sumar";
pub const MODO_REEMPLAZAR: &str = "reemplazar";

/// El modo pedido, saneado: lo que no se entiende es «sumar» (nunca una sorpresa que pise mercancía).
/// `None` (el parámetro no vino) también es «sumar»: es la compatibilidad con lo que ya existe (AC-6).
/// SOLO se reconoce la palabra exacta `reemplazar`: un sinónimo o un typo («reemplazo», «pisar») NO puede
/// activar el modo que PISA el stock — con la duda, se suma.
fn modo_de(modo: Option<&str>) -> &'static str {
    match modo.map(|m| crate::db::plegar_texto(m)).as_deref() {
        Some("reemplazar") => MODO_REEMPLAZAR,
        _ => MODO_SUMAR,
    }
}

/// El stock con el que queda una fila, y si hubo que frenarlo en 0.
///
/// **UNA SOLA CUENTA**: la vista previa y el aplicar llaman a esta misma función, así el número que el
/// operario ve es exactamente el que se escribe (antes la vista previa hacía `clamp(0, MAX)` y el
/// aplicar no: con una ficha en −60 y un archivo de 30 el informe escribía −30 mientras la pantalla
/// mostraba 0 — el reclamo del dueño, «me está cargando el producto −30»).
///
/// Reglas, en orden:
///   1. Celda de stock VACÍA (`pedido = None`) = el stock NO se toca: queda el de hoy, aunque sea
///      negativo. No es la carga la que escribe ese negativo y «arreglarlo» a 0 inventaría una entrada
///      de mercancía que nadie contó.
///   2. `sumar`: hoy + archivo · `reemplazar`: el del archivo.
///   3. REQ-2: si el resultado da NEGATIVO, el stock final es **0** (la carga nunca escribe un negativo)
///      y la fila se cuenta como frenada para que el informe lo diga.
/// (`MAX_QTY` no se aplica acá: pasarse del tope es un ERROR de la fila —no un recorte mudo— y lo
/// reporta cada llamador con su propio mensaje.)
fn stock_final_de(stock_hoy: i64, pedido: Option<i64>, modo: &str) -> (i64, bool) {
    match pedido {
        None => (stock_hoy, false),
        Some(q) => {
            let bruto = if modo == MODO_REEMPLAZAR { q } else { stock_hoy.saturating_add(q) };
            if bruto < 0 { (0, true) } else { (bruto, false) }
        }
    }
}

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
            // REQ-4 (F86): «modelos» (plural) es el encabezado NATURAL del Excel del dueño y llenaba la
            // COMPATIBILIDAD, no el modelo: la ficha quedaba con el teléfono en la lista de «también le
            // sirve a» y sin modelo. Ahora llena el MODELO; la lista sigue con sus alias propios.
            Col::Model => &["modelo", "model", "modelos"],
            Col::Variant => &["variante", "variant", "calidad"],
            Col::Compatibility => &["compatibilidad", "compat", "compatible", "modeloscompatibles", "sirvepara"],
            Col::Cost => &["costo", "costos", "preciocosto", "costousd", "compra"],
            Col::Sale => &["venta", "precioventa", "precio", "pvp", "preciolista", "listaprecio"],
            Col::Cash => &["efectivo", "contado", "precioefectivo", "preciocontado", "divisas"],
            // F86: los encabezados REALES de las listas de tienda. El dueño reportó «stock en producto NO
            // está cargando en masa»: su Excel decía «STOCK ACTUAL»/«CANT. FÍSICA»/«QTY» y el encabezado
            // NO se reconocía, así que la columna se ignoraba y el stock no se tocaba (el aviso existía,
            // pero quedaba escondido en un `title`). Todo lo que el local escribe para decir «unidades»
            // tiene que entrar acá.
            Col::Stock => &[
                "stock", "cantidad", "cant", "unidades", "existencia",
                "stockactual", "stockfisico", "stockdisponible", "cantidadactual", "cantactual",
                "cantfisica", "cantfisico", "cantidadfisica", "cantidadreal", "cantreal",
                "fisico", "fisica", "disponible", "disponibles", "qty", "quantity",
                "unidadesdisponibles", "unidadesfisicas", "existenciaactual", "existenciafisica",
            ],
            Col::MinStock => &[
                "stockmin", "stockminimo", "minimo", "min", "alerta", "minimodestock",
                "stockminimoalerta", "minimoalerta", "alertastockminimo", "cantidadminima",
            ],
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
    /// F87 — encabezados que mapean a un campo que YA tenía dueño, con el texto TAL CUAL del archivo.
    /// Gana la PRIMERA columna (el nombre real del producto está en la primera) y las demás se
    /// descartaban sin decir nada: el Excel del dueño trae «NOMBRE» y «Producto», y «Producto» —que es
    /// donde van los códigos— desaparecía en silencio. Ahora viaja hasta la pantalla.
    duplicados: Vec<String>,
    /// F87 — los índices de las columnas de NOMBRE que se descartaron por repetir campo (además de la
    /// que se usa): ahí es donde el local deja el CÓDIGO pegado al nombre. Se guardan en el orden del
    /// archivo para que el rescate del código sea determinista.
    nombres_extra: Vec<usize>,
}

impl Header {
    fn cell<'a>(&self, row: &'a RawRow, col: Col) -> &'a str {
        match self.index.get(&col) {
            Some(i) => row.cells.get(*i).map(|s| s.as_str()).unwrap_or("").trim(),
            None => "",
        }
    }
    /// F87 — las columnas de NOMBRE, en orden de confianza: PRIMERO la que se usa y después las que se
    /// descartaron por repetir campo. El código pegado se busca acá (el local lo escribe junto al
    /// nombre, y en su archivo el nombre «bueno» está en la primera y el código en la segunda).
    fn columnas_de_nombre(&self) -> Vec<usize> {
        let mut out: Vec<usize> = self.index.get(&Col::Name).copied().into_iter().collect();
        out.extend(self.nombres_extra.iter().copied());
        out
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
            // F87 — la PRIMERA columna de cada campo es la que manda (`or_insert`), y las que quedan
            // afuera NO se pierden: se reportan (`duplicados`) y, si son de nombre, se miran para
            // rescatar el código pegado (el caso medido del dueño: «NOMBRE» + «Producto»).
            Some(col) => {
                if h.index.contains_key(&col) {
                    let t = celda.trim();
                    if !t.is_empty() { h.duplicados.push(t.to_string()); }
                    if col == Col::Name { h.nombres_extra.push(i); }
                } else {
                    h.index.insert(col, i);
                }
            }
            None => {
                let t = celda.trim();
                if !t.is_empty() { h.ignored.push(t.to_string()); }
            }
        }
    }
    if h.has(Col::Name) { Some(h) } else { None }
}

// ---------------------------------------------------------------- código pegado

/// F87 — EL CÓDIGO PEGADO AL NOMBRE. La forma del código del local es **una letra + guion + 3 a 6
/// dígitos** (`P-0207`, `P-1036`, `M-0707`) y el local lo escribe pegado al final del nombre del
/// repuesto: «Infinix Hot 10 LiteP-0211», «Tecno Spark 20 Pro ORIGINALP-0744» y
/// «Infinix Gt 20 Pro (INCELL)P-0207» (las tres, filas reales de su archivo).
///
/// Por eso se toma **UNA letra** y no la palabra entera que queda delante del guion: lo que va pegado
/// delante es la COLA DEL NOMBRE, no parte del código. Medido sobre el archivo real del dueño (83
/// filas): los 71 códigos son `P-####`, y el «token de 1-3 letras» de la izquierda daba basura
/// (`teP-0211`, `roP-0227`, `usP-1038`, `ALP-0744`) mientras que la última letra da `P-0211`,
/// `P-0227`, `P-1038`, `P-0744` — el código con el que el dueño busca.
///
/// Devuelve `(nombre sin el código, código)`. Se prefieren los candidatos cuya letra viene en
/// MAYÚSCULA (la convención del local) y, si no hay ninguno, se acepta uno en minúscula **suelto**
/// (« p-0207»): así un nombre con guion y número —«Hot 10 Pro-2024», cuya letra pegada es la «o» de
/// «Pro»— no se mutila por un código que no existe. `None` = ese texto no trae ningún código pegado.
fn separar_codigo(texto: &str) -> Option<(String, String)> {
    let chars: Vec<char> = texto.chars().collect();
    let mut en_minuscula: Option<(usize, usize)> = None; // (letra, fin de los dígitos)
    for i in 0..chars.len() {
        if chars[i] != '-' { continue; }
        let digitos = chars[i + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if !(3..=6).contains(&digitos) { continue; }
        // la letra PEGADA al guion: sin letra no hay código (un «-2024» suelto no lo es)
        let Some(&letra) = i.checked_sub(1).and_then(|j| chars.get(j)) else { continue };
        if !letra.is_ascii_alphabetic() { continue; }
        if letra.is_ascii_uppercase() {
            return Some(cortar(&chars, i - 1, i + 1 + digitos));
        }
        // una letra MINÚSCULA pegada a otra letra es la cola de una palabra («Pro-2024»), no un código:
        // solo se acepta si viene suelta (« p-0207»), y como último recurso (el local escribe «P-»)
        let suelta = i < 2 || !chars[i - 2].is_ascii_alphabetic();
        if suelta && en_minuscula.is_none() { en_minuscula = Some((i - 1, i + 1 + digitos)); }
    }
    let (ini, fin) = en_minuscula?;
    Some(cortar(&chars, ini, fin))
}

/// El texto partido en dos por el código: (lo de antes + lo de después, el código en mayúsculas).
/// El nombre se devuelve con los espacios colapsados: el código puede estar en el MEDIO del texto y
/// al sacarlo quedarían dos espacios seguidos dentro del nombre que se guarda.
fn cortar(chars: &[char], ini: usize, fin: usize) -> (String, String) {
    let nombre: String = chars[..ini]
        .iter()
        .chain(chars[fin..].iter())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let codigo: String = chars[ini..fin].iter().collect();
    (nombre, codigo.to_uppercase())
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
    /// REQ-2/REQ-5 (F86) — el stock REAL con el que queda la ficha después de aplicar, con la MISMA
    /// cuenta que usa el aplicar (`stock_final_de`): nunca negativo. Es el número que la fila muestra
    /// en la columna «queda en», y es el mismo que `stock_after` (que sigue viajando por compatibilidad
    /// con la pantalla que ya lo usaba).
    #[serde(default)]
    pub stock_final: i64,
    /// REQ-5 (F86) — AVISO (no bloqueo): el archivo trae una lista de compatibilidad que NO incluye al
    /// modelo de la ficha («es de un A06 y su compatibilidad dice A10 / A12»). Dato incoherente: el
    /// repuesto que se está cargando es del teléfono principal, así que la lista no puede ignorarlo.
    #[serde(default)]
    pub aviso_compat: bool,
    /// F88 — LA LISTA QUE VA A QUEDAR: los teléfonos donde entra esta pantalla, separados por « / »,
    /// ya normalizados como los guarda el catálogo. Es lo que el aplicar va a escribir: la lista del
    /// ARCHIVO y, si esa celda viene vacía, la que se arma con SU MODELO (REQ-1/F86). El dueño la pidió
    /// a la vista en cada fila: «la compatibilidad así es necesaria para cada modelo tiene que aparecer».
    #[serde(default)]
    pub compatibility_final: String,
    /// F88 — ¿esa lista la armó el MODELO porque el archivo no traía compatibilidad? (la fila lo dice)
    #[serde(default)]
    pub compat_del_modelo: bool,
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
    /// F86 — los MISMOS encabezados ignorados, con este nombre para la pantalla: el dueño cargó un Excel
    /// con «STOCK ACTUAL» y el stock no se movió; el asistente tiene que poder decir EN LA CARA qué
    /// encabezados no entendió (antes el aviso vivía en un `title` de un badge).
    #[serde(default)]
    pub columnas_ignoradas: Vec<String>,
    /// F87 — los encabezados que mapean a un campo que YA tenía dueño, con el texto TAL CUAL del
    /// archivo («NOMBRE» gana y «Producto» se descarta). Antes desaparecían sin decir nada: el dueño no
    /// podía saber que su segunda columna —la de los códigos— no se estaba leyendo. La pantalla puede
    /// decir con esto «usé «NOMBRE» y descarté «Producto»».
    #[serde(default)]
    pub columnas_repetidas: Vec<String>,
    /// F87 — cuántos CÓDIGOS se rescataron de las columnas de nombre porque el archivo NO trae una
    /// columna de código reconocida (el Excel del dueño los lleva PEGADOS al nombre: «…LiteP-0211»).
    /// Sin esto, 83 de 83 filas se guardaban sin código y el dueño —que busca por código— perdía su
    /// forma de encontrar los productos.
    #[serde(default)]
    pub codigos_recuperados: i64,
    /// F86 — `true` cuando NINGUNA columna del archivo mapea a `stock`: la carga NO va a tocar el stock
    /// de ninguna ficha. Es el aviso más importante de la pantalla (la causa medida del «no me carga el
    /// stock»), y va como booleano para que la UI no tenga que adivinar parseando texto.
    #[serde(default)]
    pub sin_columna_stock: bool,
    /// F86 — el modo del stock con el que se leyó la vista previa (`sumar` | `reemplazar`): es el eco de
    /// lo que el asistente eligió, para que la pantalla y el aplicar no puedan discrepar.
    #[serde(default)]
    pub mode: String,
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
///
/// `modo` (F86/REQ-3): qué significa la columna `stock` del archivo — `None` = «sumar» (como siempre).
/// La vista previa TIENE que saberlo: el número que muestra por fila (`stock_final`) es el que se va a
/// escribir, y en modo «reemplazar» ese número es el del archivo, no la suma.
pub fn preview_csv(conn: &Connection, text: &str, modo: Option<&str>) -> SqlResult<CsvPreview> {
    let modo = modo_de(modo);
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
    // F87 — cuántos códigos se rescataron del nombre (y un ejemplo para poder mostrarlo en la pantalla)
    let mut codigos_recuperados = 0i64;
    let mut ejemplo_codigo = String::new();

    for raw in &datos {
        let mut issues: Vec<String> = Vec::new();
        let mut notes: Vec<String> = Vec::new();

        let mut name = header.cell(raw, Col::Name).to_string();
        // F87 — SIN columna de código en el archivo: se busca el código PEGADO al nombre. Se mira la
        // columna de nombre que se usa y, si ahí no hay, las que se descartaron por repetir campo (el
        // Excel del dueño: «NOMBRE» trae el nombre y «Producto» el nombre con el código pegado).
        // Se hace ANTES de «Falta el nombre»: sacar el código puede dejar el nombre limpio, nunca vacío.
        let mut code = header.cell(raw, Col::Code).trim().to_uppercase();
        if !columns.code {
            for idx in header.columnas_de_nombre() {
                let celda = raw.cells.get(idx).map(|s| s.as_str()).unwrap_or("");
                let Some((limpio, codigo)) = separar_codigo(celda) else { continue };
                code = codigo.clone();
                codigos_recuperados += 1;
                if ejemplo_codigo.is_empty() { ejemplo_codigo = codigo.clone(); }
                // el código no se queda dentro del nombre que se guarda (solo la columna que se usa
                // define el nombre: lo que venga de una columna descartada no toca el nombre)
                if Some(idx) == header.index.get(&Col::Name).copied() && !limpio.is_empty() {
                    name = limpio;
                }
                notes.push(format!(
                    "El código «{codigo}» se rescató del nombre del archivo: el archivo no trae una \
                     columna de código"
                ));
                break;
            }
        }
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
        // `code` se resolvió arriba: la columna del archivo si existe, o el código pegado al nombre
        // rescatado por F87. Una sola fuente, así la vista previa y el aplicar no pueden discrepar.

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
        // ── F88: DOS CÓDIGOS DISTINTOS NO SON LA MISMA PANTALLA ────────────────────────────────────
        //
        // El código del local (`P-####`) es la IDENTIDAD de la ficha: es con el que el dueño la busca y
        // con el que su Excel la referencia. Medido con su archivo real (2026-10-05): la fila «Infinix
        // Hot 40i» (código P-0053) caía en la ficha #53 POR CÓDIGO, y la fila «Tecno Spark Go 2024»
        // (código P-1033) caía en esa MISMA #53 por IDENTIDAD (marca+modelo, porque el catálogo tenía
        // una ficha fusionada «Tecno Infinix Go 2024 / Infinix Hot 40i / Spark 20»). Las dos filas
        // apuntaban a una sola ficha, la última pisaba a la primera y **el código P-0053 desaparecía
        // del catálogo**. Si la fila trae un código y la ficha con la que se cruzó tiene OTRO, son
        // pantallas distintas: la fila se CREA con su código en vez de reescribir una ficha ajena.
        // (Si además el NOMBRE coincide exacto, la fila queda marcada y decide el operario: puede ser
        // la misma pantalla renumerada — eso lo sabe él, no el sistema.)
        if let Some(i) = idx_ficha {
            if !code.is_empty() && match_kind != "codigo" {
                let code_ficha = catalogo[i].current.code.trim().to_uppercase();
                if !code_ficha.is_empty() && code_ficha != code {
                    notes.push(format!(
                        "El código «{code}» no está en el catálogo y la ficha que coincide por nombre o \
                         modelo tiene otro («{}»): se carga como ficha NUEVA con tu código (esa no se toca).",
                        catalogo[i].current.code
                    ));
                    idx_ficha = None;
                    match_kind.clear();
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

        // ── stock: la ÚNICA cuenta del archivo (misma función que usa el aplicar)
        //
        // Antes acá había un `clamp(0, MAX_QTY)` y el aplicar NO: con una ficha en −60 y un archivo de 30
        // la pantalla mostraba 0 y el informe escribía −30 (el reclamo del dueño: «me está cargando el
        // producto −30»). Ahora los dos usan `stock_final_de`: el número que se muestra ES el que se
        // escribe, y nunca es negativo (si la ficha venía en faltante, la carga la deja en 0).
        let stock_hoy = current.as_ref().map(|c| c.stock).unwrap_or(0);
        let (stock_final, frenado) = stock_final_de(stock_hoy, stock, modo);
        let stock_after = Some(stock_final);
        // el tope es sobre el RESULTADO (no sobre la celda): 90.000 + 20.000 no puede quedar recortado en
        // silencio, porque el movimiento diría una cosa y el stock otra
        if stock_final > MAX_QTY {
            issues.push(match stock {
                Some(q) if modo != MODO_REEMPLAZAR => format!(
                    "El stock quedaría en {stock_final} (hoy {stock_hoy} + {q} del archivo) y el máximo es {MAX_QTY}"
                ),
                _ => format!("El stock quedaría en {stock_final} y el máximo es {MAX_QTY}"),
            });
        }
        // REQ-2: se avisa (sin bloquear) que la ficha venía en faltante y la carga la deja en 0
        if frenado {
            notes.push(format!(
                "Esta ficha estaba en {stock_hoy} (faltante): el archivo la deja en 0 — la carga nunca \
                 escribe un stock negativo"
            ));
        }

        let mut fila = CsvRow {
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
            stock_final,
            aviso_compat: false,
            // F88 — se completan unas líneas más abajo, con `finales` (la misma cuenta del aplicar)
            compatibility_final: String::new(),
            compat_del_modelo: false,
            issues,
            notes,
        };
        // REQ-5 (F86) — AVISO por fila: ¿la lista de compatibilidad que trae el ARCHIVO incluye al MODELO
        // de la ficha? Se compara contra el modelo FINAL (el del archivo y, si la celda viene vacía, el que
        // la ficha ya tiene) con `finales`: la misma función que usa el aplicar. Es un AVISO: la fila se
        // aplica igual — el dueño decide si corrige la lista o el modelo.
        // Si el archivo NO trae lista (celda vacía) no hay nada incoherente que avisar: la compatibilidad
        // del modelo la arma REQ-1, y avisar de una lista que la carga no escribe sería ruido (y la
        // pantalla mostraría una lista vacía en el mensaje).
        let f_fila = finales(&fila, &fila.current.clone().unwrap_or_default(), &columns, "", stock_final);
        fila.aviso_compat = !fila.compatibility.trim().is_empty()
            && !catalog::compat_incluye_modelo(&f_fila.brand, &f_fila.model, &fila.compatibility);
        // F88 — LA LISTA QUE VA A QUEDAR, tal como la va a escribir el aplicar (la del archivo o, con la
        // celda vacía, la que arma el MODELO). Sale de `finales` —la MISMA función que usa el aplicar—,
        // así que la fila no puede mostrar una lista distinta de la que se guarda.
        fila.compatibility_final = serde_json::from_str::<Vec<String>>(&f_fila.compatibility)
            .map(|v| v.join(" / "))
            .unwrap_or_default();
        // OJO: la celda vacía significa DOS cosas distintas y la fila no puede confundirlas (regla F78):
        //  - la ficha es NUEVA (o no tenía lista): la lista la arma el MODELO → «del modelo»;
        //  - la ficha YA tenía su lista curada: se CONSERVA la que tenía → NO es «del modelo».
        let compat_actual = fila.current.as_ref().map(|c| c.compatibility.trim().to_string()).unwrap_or_default();
        fila.compat_del_modelo = fila.compatibility.trim().is_empty()
            && compat_actual.is_empty()
            && !f_fila.model.trim().is_empty();
        if fila.compat_del_modelo {
            fila.notes.push(format!(
                "El archivo no trae compatibilidad para esta fila: la lista se arma con su MODELO ({})",
                fila.compatibility_final
            ));
        } else if columns.compatibility && fila.compatibility.trim().is_empty() && !compat_actual.is_empty() {
            // la columna vino en el archivo pero la celda está vacía: no se toca lo que la ficha ya tenía
            fila.notes.push(format!(
                "El archivo no trae compatibilidad para esta fila: la ficha CONSERVA la que ya tiene ({})",
                fila.compatibility_final
            ));
        }
        if fila.aviso_compat {
            fila.notes.push(format!(
                "La compatibilidad ({}) no incluye a su propio modelo ({}): revisá la lista o el modelo",
                fila.compatibility, f_fila.model
            ));
        }
        out_rows.push(fila);
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
    // «lo que va a quedar» se calcula por DIFERENCIA (`stock_final − stock de hoy`), no sumando la celda:
    // en modo «reemplazar» el archivo no suma, y con una ficha en faltante la carga la deja en 0 — la
    // resta es el único número que dice la verdad en los dos modos.
    let mut delta_total = 0i64;
    for r in &out_rows {
        delta_total += match &r.current {
            Some(c) => r.stock_final - c.stock,
            None => r.stock_final,
        };
    }
    // F86 — la CAUSA MEDIDA del «no me carga el stock»: el archivo traía «STOCK ACTUAL» / «QTY» y ninguna
    // columna mapeaba a Stock, así que el stock no se tocaba y el dueño no lo entendía. El aviso va en la
    // cara (y en `sin_columna_stock`, para que la pantalla lo pueda destacar), no escondido en un `title`.
    let sin_columna_stock = !columns.stock;
    let mut issues: Vec<String> = Vec::new();
    if !header.ignored.is_empty() {
        issues.push(format!("Columnas que no reconozco (no se cargan): {}", header.ignored.join(", ")));
    }
    // F87 — las columnas que mapean a un campo que ya tenía dueño: se usó la PRIMERA de cada uno (el
    // nombre real del producto está ahí) y las demás se descartaron. El dueño tiene que poder verlo:
    // su «Producto» es justo la columna de la que salieron los códigos.
    if !header.duplicados.is_empty() {
        issues.push(format!(
            "El archivo repite campos: usé la PRIMERA columna de cada uno y descarté {}",
            header.duplicados.join(", ")
        ));
    }
    // F87 — los códigos rescatados del nombre: sin columna de código en el archivo, el código del local
    // se saca del texto pegado al nombre. Si no hubiera ninguno, la carga dejaría el código vacío.
    if codigos_recuperados > 0 {
        issues.push(format!(
            "El archivo no trae una columna de código: rescaté {codigos_recuperados} código(s) pegados \
             al nombre (por ejemplo «{ejemplo_codigo}») y los saqué del nombre"
        ));
    }
    if sin_columna_stock {
        issues.push(if header.ignored.is_empty() {
            "Este archivo no trae una columna de stock reconocida: el stock NO se va a tocar.".to_string()
        } else {
            format!(
                "Este archivo no trae una columna de stock reconocida (no entendí: {}): el stock NO se \
                 va a tocar. Si el stock viene en una de esas columnas, poné el encabezado «stock».",
                header.ignored.join(", ")
            )
        });
    }
    Ok(CsvPreview {
        rows: out_rows,
        columns,
        known: header.labels.iter().filter(|l| Col::from_header(l).is_some()).cloned().collect(),
        ignored: header.ignored.clone(),
        columnas_ignoradas: header.ignored.clone(),
        columnas_repetidas: header.duplicados.clone(),
        codigos_recuperados,
        sin_columna_stock,
        mode: modo.to_string(),
        separator: match sep { '\t' => "tabulador".to_string(), c => c.to_string() },
        total_rows: datos.len() as i64,
        new_count,
        exists_count: datos.len() as i64 - new_count,
        new_categories: nuevas.into_values().collect(),
        units_file,
        units_before: antes,
        units_after: antes + delta_total,
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
    /// REQ-3 (F86) — qué significa la columna `stock` del archivo: `sumar` (por defecto, y lo que hacía
    /// la carga antes: el archivo trae lo que ENTRÓ) o `reemplazar` (el archivo ES el inventario real).
    /// `#[serde(default)]` a propósito: un payload viejo (o una llamada que no manda el campo) se
    /// comporta EXACTAMENTE como antes (AC-6) — nunca puede pisar mercancía por omitir un campo.
    #[serde(default)]
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CsvReport {
    /// F86 — eco del modo con el que se aplicó (`sumar` | `reemplazar`): el informe tiene que decir qué
    /// se hizo con el stock, no dejarlo a la memoria del operario.
    #[serde(default)]
    pub mode: String,
    /// F86 (REQ-2) — fichas que venían en NEGATIVO y quedaron en 0 porque el archivo las tocó: la carga
    /// nunca escribe un stock negativo. El informe las cuenta para que el dueño sepa qué arregló.
    #[serde(default)]
    pub clamped_to_zero: i64,
    /// F86 — el archivo no traía una columna de stock reconocida: el stock NO se tocó (mismo dato que la
    /// vista previa, para que el informe final tampoco mienta).
    #[serde(default)]
    pub sin_columna_stock: bool,
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
    // F88 — los códigos que ESTE archivo va a escribir (los que traen sus filas activas, en la forma
    // en que se guardan: recortados y en mayúsculas). Es lo que impide que el código automático de una
    // ficha nueva le robe el código a otra fila del mismo archivo (ver el INSERT más abajo).
    let codigos_del_archivo: BTreeSet<String> = activas
        .iter()
        .map(|r| r.code.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .collect();
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
    // REQ-3: el modo del stock, saneado una vez para todo el archivo (vacío o desconocido = «sumar»).
    let modo = modo_de(Some(&input.mode));
    let mut report = CsvReport {
        backup: dest_str,
        mode: modo.to_string(),
        sin_columna_stock: !input.columns.stock,
        ..Default::default()
    };

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
                // LA MISMA CUENTA QUE LA VISTA PREVIA (REQ-2/REQ-3): `stock_final_de` decide el modo
                // («sumar» = hoy + archivo · «reemplazar» = el del archivo) y frena el resultado en 0 si
                // daba negativo. Acá no hay una segunda fórmula: si la hubiera, la pantalla podría
                // mostrar un número y el informe escribir otro (fue exactamente el «−30» del dueño).
                let (stock_final, frenado) = stock_final_de(stock_hoy, row.stock, modo);
                if frenado {
                    report.clamped_to_zero += 1;
                }
                if stock_final > MAX_QTY {
                    return Err(format!(
                        "Línea {} — el stock quedaría en {stock_final} y el máximo es {MAX_QTY}. No se cargó nada.",
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
                    // ── F88: EL CÓDIGO AUTOMÁTICO NO LE PUEDE ROBAR EL CÓDIGO A NINGUNA FILA DEL ARCHIVO.
                    //
                    // Antes se generaba `P-` + el id a ciegas. Medido con el archivo real del dueño
                    // (2026-10-05): la primera ficha nueva nació con id 1031 → se quedó con «P-1031», y
                    // esa MISMA carga traía «P-1031» para otra pantalla (Infinix Smart 8). El archivo se
                    // frenaba entero con «el código «P-1031» ya es de la ficha #1031: cambiá el código o
                    // marcá «actualizar esa ficha»» — un choque que había provocado el propio sistema y
                    // que el operario no podía resolver sin tocar SUS códigos.
                    //
                    // Se busca el primer `P-####` que esté LIBRE: ni entre los códigos que este archivo
                    // va a escribir (`codigos_del_archivo`, ya validados arriba) ni entre los que ya
                    // tiene el catálogo (la columna no tiene índice único: dos fichas con el mismo código
                    // es justo lo que el chequeo de abajo evita). Si no hay ninguno libre, la ficha queda
                    // SIN código: nunca se le inventa uno que ya es de otra.
                    if f.code.trim().is_empty() {
                        let mut n = new_id;
                        let mut elegido: Option<String> = None;
                        while n <= new_id + 100_000 {
                            let candidato = format!("P-{n:04}");
                            let ocupado: bool = tx
                                .query_row(
                                    "SELECT EXISTS(SELECT 1 FROM products WHERE UPPER(TRIM(COALESCE(code,''))) = ?1)",
                                    params![candidato],
                                    |r| r.get::<_, i64>(0),
                                )
                                .map(|v| v != 0)
                                .unwrap_or(true);
                            if !ocupado && !codigos_del_archivo.contains(&candidato) {
                                elegido = Some(candidato);
                                break;
                            }
                            n += 1;
                        }
                        if let Some(codigo) = elegido {
                            tx.execute(
                                "UPDATE products SET code = ?1 WHERE id = ?2 AND (code IS NULL OR code = '')",
                                params![codigo, new_id],
                            )
                            .map_err(|e| e.to_string())?;
                        }
                    }
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
                    // El movimiento sale del DELTA (`lo que quedó − lo que había`), que es la única cuenta
                    // correcta en los DOS modos: en «sumar» el delta es lo que trajo el archivo y en
                    // «reemplazar» puede ser NEGATIVO (el archivo es el inventario real y el stock bajó,
                    // porque la mercancía se vendió o se perdió). Por eso la rama `salida` NO es código
                    // muerto: existe para el modo reemplazar y para una ficha que venía en faltante
                    // (`−60 + 30 ⇒ 0`, +60 de entrada). Si el delta fuera 0 no se escribe movimiento.
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
         # modelo = el teléfono (UNA sola cosa que llenar: de acá sale el padrón de Modelos). Si el\n\
         # repuesto sirve para dos teléfonos, escribilos separados con barra: A30/A50.\n\
         # compatibilidad = «también le sirve a» (OPCIONAL): los OTROS teléfonos que también lo llevan.\n\
         # Dejala vacía si el repuesto es solo del teléfono de la columna modelo. en_uso = si/no\n\
         # (vacío = lo decide el stock).\n\
         # Celda vacía = ese dato NO se toca (ni el stock, ni los precios, ni la marca). Si querés BORRAR\n\
         # un dato (por ejemplo la compatibilidad), escribí un guion: -.\n\
         # Los números pueden venir en notación científica de Excel (1,5E3 = 1500) y no pasa nada.\n\
         {encabezado}\n\
         Pantalla Samsung A06 4G INCELL;Batería;Samsung;A06 4G;INCELL;;4,50;9,00;8,00;3;1;Cell World;P-0001;si;\n\
         Flex de carga Tecno Spark 8P;Flex;Tecno;Spark 8P;;;1,20;4,00;3,50;5;2;Importadora;P-0002;si;\n\
         Pin de carga Redmi 9A;Pin de carga;Xiaomi;Redmi 9A;;Redmi 9C;0,80;3,00;2,50;0;2;Importadora;;no;\n"
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
        aplicar_modo(db, texto, proveedor, "")
    }

    /// F86 — la carga con el MODO del stock elegido (`""` = el payload viejo, sin el campo = «sumar»).
    /// La vista previa se pide con el MISMO modo, como hace el asistente.
    fn aplicar_modo(db: &Database, texto: &str, proveedor: &str, modo: &str) -> Result<CsvReport, String> {
        let preview = db.preview_csv_load_modo(texto, Some(modo)).unwrap();
        assert!(preview.fatal.is_none(), "archivo fatal: {:?}", preview.fatal);
        let nuevas: Vec<String> = preview.new_categories.iter().map(|c| c.name.clone()).collect();
        db.apply_csv_load(&CsvApplyInput {
            rows: preview.rows.clone(),
            columns: preview.columns.clone(),
            supplier: proveedor.to_string(),
            file_name: "prueba.csv".to_string(),
            new_categories: nuevas,
            mode: modo.to_string(),
        })
    }

    /// F86 — deja una ficha en FALTANTE por el camino legítimo (nace en 0 y el stock baja con un
    /// movimiento real de salida): es la única forma de que el stock quede negativo después de AC-13.
    fn dejar_en_faltante(db: &Database, id: i64, unidades: i64) {
        db.add_inventory_movement(id, "salida", unidades, "Ajuste de prueba (faltante)", "").unwrap();
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
        assert_eq!(fila.stock_final, 7, "y el número REAL de la fila es el mismo");
        assert!(fila.issues.is_empty(), "sin problemas: {:?}", fila.issues);
        assert_eq!(p.units_before, 3);
        assert_eq!(p.units_file, 4);
        assert_eq!(p.units_after, 7, "3 + 4");
    }

    // ── F86/REQ-2 y REQ-3: LA CARGA NUNCA ESCRIBE UN NEGATIVO Y SU MODO SE ELIGE (AC-3 a AC-6)

    /// AC-3 y AC-4 (el reclamo exacto del dueño: «me está cargando el producto −30»): con una ficha en
    /// −60 y un archivo que trae 30, la carga NO deja −30 — queda **0**, la vista previa muestra 0 (el
    /// MISMO número que se escribe) y el informe lo cuenta en `clamped_to_zero`.
    #[test]
    fn test_no_escribe_negativo_y_la_preview_dice_la_verdad() {
        let (db, _p) = setup("negativo");
        let pid = db.get_products("A06", None).unwrap()[0].id;
        dejar_en_faltante(&db, pid, 63); // 3 de stock − 63 = −60 (faltante real, por un movimiento)
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, -60);

        let texto = "nombre;categoria;marca;modelo;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;30\n";
        let p = db.preview_csv_load(texto).unwrap();
        let fila = &p.rows[0];
        assert_eq!(fila.current.as_ref().unwrap().stock, -60, "la ficha venía en faltante");
        assert_eq!(fila.stock_final, 0, "la vista previa NO ESCONDE el problema: muestra el 0 que se escribe");
        assert_eq!(fila.stock_after, Some(0), "y `stock_after` dice lo mismo (una sola cuenta)");
        assert!(fila.notes.iter().any(|n| n.contains("faltante")), "y lo explica: {:?}", fila.notes);
        assert_eq!(p.units_after, 0, "la estimación del archivo también usa el número real");

        let r = aplicar(&db, texto, "Proveedor").unwrap();
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, 0, "quedó en 0, NUNCA en −30");
        assert_eq!(r.clamped_to_zero, 1, "y el informe dice cuántas fichas frenó");
        assert_eq!(r.mode, MODO_SUMAR, "el informe dice con qué modo del stock se aplicó");
        // el movimiento es el delta REAL (−60 → 0 = +60 de entrada), no +30
        let movs = db.get_inventory_movements_page(Some(pid), None, Some(MOTIVO), None, None, 50, 0).unwrap();
        assert!(movs.items.iter().any(|m| m.r#type.as_deref() == Some("entrada") && m.quantity == 60), "{:?}", movs.items.iter().map(|m| (&m.r#type, m.quantity)).collect::<Vec<_>>());
    }

    /// REQ-2, el otro límite: si el archivo NO trae stock para esa fila (celda vacía = «no se toca»), la
    /// carga NO toca el faltante ni lo «arregla» a 0 — inventaría una entrada de mercancía que nadie contó.
    #[test]
    fn test_celda_de_stock_vacia_no_toca_el_faltante() {
        let (db, _p) = setup("faltante_intacto");
        let pid = db.get_products("A06", None).unwrap()[0].id;
        dejar_en_faltante(&db, pid, 63);
        let texto = "nombre;categoria;marca;modelo;costo\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;5,00\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert_eq!(p.rows[0].stock_final, -60, "el stock queda como estaba (no se toca)");
        let r = aplicar(&db, texto, "").unwrap();
        assert_eq!(r.clamped_to_zero, 0, "no se frenó nada: el stock no se escribió");
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, -60, "el faltante sigue visible");
    }

    /// AC-5 y AC-6: el modo del stock. «sumar» = hoy + archivo (y es el que se usa si el payload NO trae
    /// el campo, o sea el de siempre) · «reemplazar» = el archivo es el inventario real.
    #[test]
    fn test_modo_del_stock_sumar_reemplazar_y_ausente() {
        let (db, _p) = setup("modo");
        let pid = db.get_products("A06", None).unwrap()[0].id;
        let texto = "nombre;categoria;marca;modelo;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;4\n";

        // (1) SUMAR explícito: 3 + 4 = 7
        let p = db.preview_csv_load_modo(texto, Some("sumar")).unwrap();
        assert_eq!(p.mode, "sumar");
        assert_eq!(p.rows[0].stock_final, 7);
        let r = aplicar_modo(&db, texto, "", "sumar").unwrap();
        assert_eq!(r.mode, "sumar");
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, 7);

        // (2) AUSENTE (payload viejo): se comporta como «sumar» → 7 + 4 = 11
        let r = aplicar(&db, texto, "").unwrap();
        assert_eq!(r.mode, MODO_SUMAR, "sin campo = sumar");
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, 11, "11 = 7 + 4: la compatibilidad con lo que ya existe");

        // (3) REEMPLAZAR: el archivo ES el inventario → 4 (no 11 + 4)
        let p = db.preview_csv_load_modo(texto, Some("reemplazar")).unwrap();
        assert_eq!(p.mode, "reemplazar");
        assert_eq!(p.rows[0].stock_final, 4, "la vista previa ya muestra el número del archivo");
        let r = aplicar_modo(&db, texto, "", "reemplazar").unwrap();
        assert_eq!(r.mode, "reemplazar");
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, 4, "el archivo manda");
        // y el movimiento es una SALIDA real (11 → 4): la rama `delta < 0` existe por este modo
        let movs = db.get_inventory_movements_page(Some(pid), None, Some(MOTIVO), None, None, 50, 0).unwrap();
        assert!(movs.items.iter().any(|m| m.r#type.as_deref() == Some("salida") && m.quantity == 7), "{:?}", movs.items.iter().map(|m| (&m.r#type, m.quantity)).collect::<Vec<_>>());

        // (4) REEMPLAZAR con la celda de stock VACÍA: se CONSERVA el stock (no se puede leer «vacío» como
        // 0: eso borraría la mercancía de la ficha)
        let sin_stock = "nombre;categoria;marca;modelo;costo\n\
                         Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;6,00\n";
        let p = db.preview_csv_load_modo(sin_stock, Some("reemplazar")).unwrap();
        assert_eq!(p.rows[0].stock_final, 4, "se conserva el stock que ya tenía");
        let r = aplicar_modo(&db, sin_stock, "", "reemplazar").unwrap();
        assert_eq!(r.clamped_to_zero, 0);
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, 4, "el stock NO se borró");
        assert_eq!(db.get_product(pid).unwrap().unwrap().price_cost, 6.0, "y el precio del archivo sí entró");

        // (5) un modo ilegible no pisa nada: cae en «sumar» (nunca una sorpresa con la mercancía)
        let r = aplicar_modo(&db, texto, "", "lo-que-sea").unwrap();
        assert_eq!(r.mode, MODO_SUMAR);
        assert_eq!(db.get_product(pid).unwrap().unwrap().stock, 8, "4 + 4");
    }

    // ── F86/REQ-4, REQ-5 y los encabezados de tienda (AC-7)

    /// AC-7 — la columna «MODELOS» (plural, lo natural en el Excel del dueño) llena el MODELO, no la
    /// compatibilidad. Antes llenaba la lista de «también le sirve a» y la ficha quedaba SIN modelo.
    #[test]
    fn test_columna_modelos_llena_el_modelo() {
        let (db, _p) = setup("alias_modelos");
        let texto = "nombre;categoria;marca;MODELOS;stock\n\
                     Táctil Samsung A30;Pantalla;Samsung;A30/A50;2\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert!(p.columns.model, "«MODELOS» es la columna del MODELO");
        assert!(!p.columns.compatibility, "y NO la de compatibilidad");
        assert_eq!(p.ignored.len(), 0, "y no queda como encabezado ignorado");

        let r = aplicar(&db, texto, "").unwrap();
        assert_eq!(r.created, 1);
        let prod = &db.get_products("A30", None).unwrap()[0];
        assert_eq!(prod.model.as_deref(), Some("A30"), "el modelo es el principal");
        assert_eq!(
            prod.compatibility.as_deref(),
            Some(r#"["Samsung A30","Samsung A50"]"#),
            "y las dos alternativas quedaron como teléfonos compatibles"
        );

        // y el nombre viejo de la compatibilidad SIGUE funcionando (no se rompió ningún alias)
        let p2 = db.preview_csv_load("nombre;categoria;compatibilidad\nOtro;Pantalla;Samsung A10\n").unwrap();
        assert!(p2.columns.compatibility);
        assert!(!p2.columns.model);
        // «modelos compatibles» tampoco se confunde con el modelo
        let p3 = db.preview_csv_load("nombre;categoria;modelos compatibles\nOtro;Pantalla;Samsung A10\n").unwrap();
        assert!(p3.columns.compatibility, "«modelos compatibles» sigue siendo la lista");
    }

    /// REQ-5 — el aviso por fila: la lista de compatibilidad que va a quedar tiene que incluir al MODELO.
    /// Es un AVISO (no bloquea) y viaja en la fila, junto con el stock REAL (`stock_final`).
    #[test]
    fn test_aviso_compat_cuando_la_lista_ignora_al_modelo() {
        let (db, _p) = setup("aviso_compat");
        let texto = "nombre;categoria;marca;modelo;compatibilidad;stock\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;Samsung A10 / Samsung A12;1\n";
        let p = db.preview_csv_load(texto).unwrap();
        let fila = &p.rows[0];
        assert!(fila.aviso_compat, "la lista no incluye a su propio modelo");
        assert!(fila.notes.iter().any(|n| n.contains("no incluye a su propio modelo")), "{:?}", fila.notes);
        assert!(fila.issues.is_empty(), "es un AVISO: no bloquea la carga");
        assert_eq!(fila.stock_final, 4, "y la fila trae el stock real (3 + 1)");
        assert!(aplicar(&db, texto, "").is_ok(), "la fila se aplica igual");

        // con la lista vacía la compatibilidad sale del MODELO → no hay nada incoherente que avisar
        let p2 = db.preview_csv_load("nombre;categoria;marca;modelo;compatibilidad;stock\n\
                                      Otra;Categoría nueva;Samsung;A06 4G;;2\n").unwrap();
        assert!(!p2.rows[0].aviso_compat, "el modelo arma su propia lista");

        // y con el modelo DENTRO de la lista tampoco
        let p3 = db.preview_csv_load("nombre;categoria;marca;modelo;compatibilidad;stock\n\
                                      Tercera;Categoría nueva;Samsung;A06 4G;Samsung A06 4G / Samsung A10;2\n").unwrap();
        assert!(!p3.rows[0].aviso_compat);
    }

    /// AC-13 del asistente: los encabezados REALES de las listas de tienda se reconocen (el dueño reportó
    /// «el stock no está cargando en masa» con un Excel que decía «STOCK ACTUAL»), y cuando NO hay ninguna
    /// columna de stock el asistente lo dice EN LA CARA (`sin_columna_stock` + los encabezados ignorados).
    #[test]
    fn test_encabezados_de_stock_de_tienda_y_sin_columna_stock() {
        let (db, _p) = setup("encabezados");
        for encabezado in ["STOCK ACTUAL", "Stock físico", "CANT. FÍSICA", "CANTIDAD ACTUAL", "QTY", "Quantity", "unidades disponibles", "existencia física", "Cantidad real"] {
            let texto = format!("nombre;categoria;marca;modelo;{encabezado}\nRaro {encabezado};Pantalla;Samsung;A06 4G;5\n");
            let p = db.preview_csv_load(&texto).unwrap();
            assert!(p.columns.stock, "«{encabezado}» tiene que ser la columna de stock");
            assert!(!p.sin_columna_stock);
            assert_eq!(p.rows[0].stock, Some(5), "y el número tiene que leerse");
            assert_eq!(p.ignored.len(), 0, "encabezado reconocido: «{encabezado}»");
        }
        // el mínimo también tiene sus formas de tienda
        let p = db.preview_csv_load("nombre;categoria;stock;stock minimo alerta\nRaro;Pantalla;5;2\n").unwrap();
        assert!(p.columns.min_stock, "«stock minimo alerta» es el mínimo");

        // SIN columna de stock reconocida: el asistente lo dice y NO toca el stock
        let texto = "nombre;categoria;marca;modelo;EXISTENCIAS TOTALES\n\
                     Pantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;9\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert!(p.sin_columna_stock, "no hay ninguna columna de stock");
        assert_eq!(p.columnas_ignoradas, vec!["EXISTENCIAS TOTALES".to_string()], "con el texto TAL CUAL del archivo");
        assert_eq!(p.ignored, p.columnas_ignoradas, "la lista vieja sigue viajando igual");
        assert!(p.issues.iter().any(|i| i.contains("NO se va a tocar")), "el aviso va en la cara: {:?}", p.issues);
        assert_eq!(p.rows[0].stock_final, 3, "la vista previa muestra que el stock queda igual");
        let r = aplicar(&db, texto, "").unwrap();
        assert!(r.sin_columna_stock, "y el informe final lo repite");
        assert_eq!(db.get_products("A06", None).unwrap()[0].stock, 3, "el stock NO se tocó");
    }

    /// REQ-4 — la PLANTILLA no repite el mismo dato en «modelo» y «compatibilidad»: la lista queda como
    /// «también le sirve a» (opcional) y las instrucciones lo explican. Y la plantilla se sigue leyendo.
    #[test]
    fn test_plantilla_no_repite_el_modelo_en_compatibilidad() {
        let (db, _p) = setup("plantilla_f86");
        let t = plantilla_csv();
        assert!(t.contains("también le sirve a"), "las instrucciones explican para qué es la lista:\n{t}");
        assert!(t.contains("el padrón de Modelos"), "y de dónde sale el padrón");
        let p = db.preview_csv_load(&t).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);
        assert_eq!(p.ignored.len(), 0, "la plantilla solo usa columnas conocidas");
        assert_eq!(p.total_rows, 3, "tres filas de ejemplo");
        // las DOS primeras filas son de UN solo teléfono: la compatibilidad viene vacía a propósito
        assert_eq!(p.rows[0].compatibility, "", "la fila de ejemplo no repite el modelo en la lista");
        assert_eq!(p.rows[0].model, "A06 4G");
        assert!(!p.rows[0].aviso_compat, "y sin lista no hay aviso: el modelo arma la suya");
        // la tercera SÍ muestra el uso real de la lista: OTRO teléfono que también lo lleva
        assert_eq!(p.rows[2].compatibility, "Redmi 9C", "«también le sirve a»");
        assert!(p.rows[2].aviso_compat, "la compatibilidad del archivo no incluye al modelo «Redmi 9A»");
    }

    // ── F87: el código pegado al nombre y las columnas que se descartan por repetir campo

    /// F87 — el CÓDIGO PEGADO: la pieza pura. El local escribe «una letra + guion + 3-6 dígitos» pegado
    /// a la cola del nombre; lo que queda delante del guion es el fin del nombre, no parte del código.
    #[test]
    fn test_f87_separar_codigo_pegado() {
        let caso = |t: &str, nombre: &str, codigo: &str| {
            assert_eq!(
                separar_codigo(t),
                Some((nombre.to_string(), codigo.to_string())),
                "el código de «{t}»"
            );
        };
        // los TRES casos reales del archivo del dueño (dos con la etiqueta de material en el medio)
        caso("Infinix Hot 10 LiteP-0211", "Infinix Hot 10 Lite", "P-0211");
        caso("Tecno Spark 20 Pro ORIGINALP-0744", "Tecno Spark 20 Pro ORIGINAL", "P-0744");
        caso("Infinix Gt 20 Pro (INCELL)P-0207", "Infinix Gt 20 Pro (INCELL)", "P-0207");
        // pegado a un dígito («Hot 50 4GP-0228») y a una letra («PovaP-0730»)
        caso("Infinix Hot 50 4GP-0228", "Infinix Hot 50 4G", "P-0228");
        // con un espacio de por medio también
        caso("Infinix Hot 11 Play P-0215", "Infinix Hot 11 Play", "P-0215");
        // una letra suelta en minúscula se acepta (no es la cola de una palabra)
        caso("Infinix Hot 11 p-0215", "Infinix Hot 11", "P-0215");
        // lo que NO es un código: sin código, un guion con año, y el guion sin letra pegada
        assert_eq!(separar_codigo("Infinix Hot 11 Play"), None);
        assert_eq!(separar_codigo("Infinix Hot 10 Pro-2024"), None, "«o-2024» es la cola de «Pro»");
        assert_eq!(separar_codigo("Pantalla -2024"), None, "sin letra pegada no hay código");
        assert_eq!(separar_codigo("Samsung A06-12"), None, "dos dígitos no son un código del local");
    }

    /// F87 — la CARGA con el archivo REAL del dueño (las tres filas que importan, copiadas tal cual):
    /// «Producto» es un SEGUNDO encabezado de nombre, así que se descartaba y **el código se perdía en
    /// todas las filas**. Ahora se rescata, se saca del nombre, se reporta y llega hasta la ficha.
    #[test]
    fn test_f87_codigo_del_local_recuperado_del_nombre() {
        let (db, _p) = setup("codigo_pegado");
        let texto = "NOMBRE;Producto;En uso;Categoría;Marca;Modelo;Variante;Precio;Costo;Stock;Mín;Compatibilidad\n\
                     Infinix Gt 20 Pro INCELL;Infinix Gt 20 Pro (INCELL)P-0207;;Pantalla;Infinix;Gt 20 Pro;INCELL;35;11;0;0;Infinix Gt 20 Pro INCELL / Infinix Note 40 INCELL\n\
                     Tecno Spark 20 Pro ORIGINAL;Tecno Spark 20 Pro ORIGINALP-0744;;Pantalla;Tecno;Spark 20 Pro;ORIGINAL;100;39;0;0;Tecno Spark 10 / Tecno Spark Go 2023 / Infinix Hot 30i / Tecno Pop 7 / Tecno Spark 10C / Infinix Smart 7\n\
                     Infinix Hot 10 Lite ;Infinix Hot 10 LiteP-0211;;Pantalla;Infinix;Hot 10 Lite;;30;9;0;0;Infinix Hot 10 Lite  / Infinix Hot 10i\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);

        // 1) los códigos se rescatan y la fila LOS DICE (el campo `code` viaja al aplicar)
        assert_eq!(p.codigos_recuperados, 3, "las tres filas traen el código pegado en «Producto»");
        assert_eq!(
            p.rows.iter().map(|r| r.code.as_str()).collect::<Vec<_>>(),
            vec!["P-0207", "P-0744", "P-0211"]
        );
        // y se avisa en la cara: sin columna de código, la carga los sacó del nombre
        assert!(p.issues.iter().any(|i| i.contains("no trae una columna de código")), "{:?}", p.issues);
        assert!(p.rows[0].notes.iter().any(|n| n.contains("P-0207")), "{:?}", p.rows[0].notes);

        // 2) el NOMBRE que se guarda es el de «NOMBRE» y sin el código dentro
        assert_eq!(p.rows[0].name, "Infinix Gt 20 Pro INCELL");
        assert_eq!(p.rows[2].name, "Infinix Hot 10 Lite", "el nombre se lee limpio (sin «P-0211» pegado)");

        // 3) las columnas repetidas se REPORTAN (con el texto tal cual del archivo)
        assert_eq!(p.columnas_repetidas, vec!["Producto".to_string()]);
        assert!(p.ignored.is_empty(), "«Producto» no es un encabezado ignorado: es un campo repetido");
        assert!(p.issues.iter().any(|i| i.contains("repite campos") && i.contains("Producto")), "{:?}", p.issues);

        // 4) el aviso de compatibilidad con el archivo real: la fila del Gt 20 Pro INCELL NO avisa (su
        //    etiqueta lleva la variante pegada) y la del Spark 20 Pro SÍ (su lista no lo nombra)
        assert!(!p.rows[0].aviso_compat, "«Infinix Gt 20 Pro INCELL» ES su modelo");
        assert!(p.rows[1].aviso_compat, "la lista del Spark 20 Pro no lo incluye: tiene que avisar");
        assert!(!p.rows[2].aviso_compat);

        // 5) el código llega a la FICHA (es como el dueño busca sus productos)
        let r = aplicar(&db, texto, "").unwrap();
        assert_eq!(r.created, 3);
        let gt = &db.get_products("Gt 20 Pro", None).unwrap()[0];
        assert_eq!(gt.code, "P-0207", "el código del local queda en la ficha");
        assert_eq!(gt.stock, 0);
        let lite = &db.get_products("Hot 10 Lite", None).unwrap()[0];
        assert_eq!(lite.code, "P-0211");
        assert_eq!(lite.price_sale, 30.0, "y la «Precio» del archivo entró (30 en la columna Precio)");
        assert_eq!(lite.price_cost, 9.0, "y el «Costo» (9)");
    }

    /// F87 — si el archivo SÍ trae una columna de código, **la columna manda** y no se rescata nada del
    /// nombre (el comportamiento de siempre no cambia).
    #[test]
    fn test_f87_la_columna_de_codigo_manda_sobre_el_codigo_pegado() {
        let (db, _p) = setup("codigo_columna");
        let texto = "nombre;producto;codigo;stock\n\
                     Pantalla Prueba;Pantalla PruebaP-9999;P-0001;2\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert!(p.columns.code, "el archivo trae columna de código");
        assert_eq!(p.rows[0].code, "P-0001", "el de la columna, no el pegado al nombre");
        assert_eq!(p.codigos_recuperados, 0, "no se rescata nada: la columna manda");
        assert_eq!(p.rows[0].name, "Pantalla Prueba", "y el nombre sale de la PRIMERA columna");
        assert_eq!(p.columnas_repetidas, vec!["producto".to_string()], "aunque se reporta el repetido");
        // la celda de código vacía NO borra el de la ficha (regla de siempre: vacío = no tocar)
        let p2 = db.preview_csv_load("nombre;producto;codigo;stock\nPantalla Otra;OtraP-9999;;1\n").unwrap();
        assert_eq!(p2.rows[0].code, "", "sin nada en la columna no se inventa un código");
        assert_eq!(p2.codigos_recuperados, 0);
    }

    /// F87 — el código pegado también se rescata cuando está en la MISMA columna que se usa como nombre
    /// (el archivo trae una sola columna y el local escribió el código dentro).
    #[test]
    fn test_f87_codigo_pegado_en_la_columna_de_nombre_que_se_usa() {
        let (db, _p) = setup("codigo_en_nombre");
        let texto = "nombre;categoria;marca;modelo;stock\n\
                     Infinix Hot 10 LiteP-0211;Pantalla;Infinix;Hot 10 Lite;4\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert_eq!(p.rows[0].code, "P-0211");
        assert_eq!(p.rows[0].name, "Infinix Hot 10 Lite", "el código NO queda dentro del nombre");
        assert_eq!(p.codigos_recuperados, 1);
        let r = aplicar(&db, texto, "").unwrap();
        assert_eq!(r.created, 1);
        let prod = &db.get_products("Hot 10 Lite", None).unwrap()[0];
        assert_eq!(prod.code, "P-0211");
        assert_eq!(prod.name, "Infinix Hot 10 Lite", "y el nombre guardado está limpio");
    }

    /// F87 — el ARCHIVO REAL DEL DUEÑO como caso de regresión: `tools/prueba-carga-catalogo.csv` (83
    /// filas, el formato de su Excel) es el que destapó LOS DOS defectos de esta feature: 25 avisos de
    /// compatibilidad en falso y los 83 códigos perdidos. Los números que se afirman acá están MEDIDOS
    /// sobre ese archivo, no inventados; si alguien cambia el archivo o la regla, el test lo dice.
    #[test]
    fn test_f87_archivo_real_del_dueno() {
        let ruta = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools/prueba-carga-catalogo.csv");
        if !ruta.exists() {
            // el archivo vive en `tools/` (fuera del crate): sin él no hay nada que medir. Se avisa
            // fuerte en vez de fingir que pasó (el test no puede inventarse el caso real).
            println!("AVISO F87: falta {} — no se midió el caso real del dueño", ruta.display());
            return;
        }
        let texto = std::fs::read_to_string(&ruta).unwrap();
        let (db, _p) = setup("archivo_real");
        let p = db.preview_csv_load(&texto).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);
        assert_eq!(p.total_rows, 83, "las filas de datos del archivo del dueño");
        assert_eq!(p.rows.iter().filter(|r| !r.issues.is_empty()).count(), 0, "el archivo no tiene filas con error");

        // (1) DEFECTO 1 — el aviso de compatibilidad: con la comparación vieja eran 25, y los 25 se
        // contradecían con la variante pegada o con el «Con Marco» que el local escribe en la etiqueta.
        // Quedan SOLO 4, y los 4 son avisos DE VERDAD (su lista no nombra al modelo de la ficha).
        let lineas: Vec<i64> = p.rows.iter().filter(|r| r.aviso_compat).map(|r| r.line).collect();
        assert_eq!(lineas, vec![30, 61, 62, 81], "los avisos que quedan, por línea del archivo");
        assert!(!p.rows[0].aviso_compat, "línea 2: «Infinix Gt 20 Pro INCELL» ES el modelo Gt 20 Pro");
        assert!(!p.rows[2].aviso_compat, "línea 4: «Infinix Hot 10 Lite / Infinix Hot 10i»");
        assert!(p.rows.iter().any(|r| r.line == 61 && r.model == "Spark 20 Pro" && r.aviso_compat),
            "línea 61: el Spark 20 Pro ORIGINAL cuya lista (Spark 10 / Spark Go 2023 / Hot 30i / Pop 7 \
             / Spark 10C / Smart 7) NO lo nombra TIENE que seguir avisado");

        // (2) DEFECTO 2 — los códigos: 71 de las 83 filas traen el código pegado en «Producto» y antes
        // se perdían las 83. Todas las recuperadas son del local (`P-####`).
        assert_eq!(p.codigos_recuperados, 71);
        assert_eq!(p.rows.iter().filter(|r| !r.code.trim().is_empty()).count(), 71);
        assert!(p.rows.iter().all(|r| r.code.is_empty() || (r.code.starts_with("P-") && r.code.len() == 6)),
            "los códigos del local: {:?}", p.rows.iter().map(|r| r.code.clone()).take(5).collect::<Vec<_>>());
        assert_eq!(p.rows[0].code, "P-0207", "la línea 2 del archivo");
        assert!(p.rows.iter().any(|r| r.line == 61 && r.code == "P-0744"), "el Spark 20 Pro ORIGINAL");
        // y el código NO quedó dentro del nombre que se guarda
        assert!(p.rows.iter().all(|r| separar_codigo(&r.name).is_none()), "hay nombres con el código adentro");

        // (3) las columnas: «NOMBRE» manda, «Producto» se reporta (y de ahí salieron los códigos)
        assert_eq!(p.columnas_repetidas, vec!["Producto".to_string()]);
        assert!(p.ignored.is_empty(), "el archivo no trae encabezados que no entendamos");
        assert!(!p.sin_columna_stock, "y sí trae la columna de stock");
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
            mode: Default::default(),
        }).unwrap_err();
        assert!(err.contains("ya existe en el catálogo"), "{err}");
        // y si el operario elige «actualizar esa ficha» (un clic), entra por el camino normal
        let mut rows2 = p.rows.clone();
        rows2[0].action = "actualizar".into();
        rows2[0].product_id = p.rows[0].clash_product_id;
        rows2[0].category_id = Some(1);
        let r = db.apply_csv_load(&CsvApplyInput {
            rows: rows2, columns: p.columns.clone(), supplier: String::new(), file_name: "x.csv".into(), new_categories: vec![],
            mode: Default::default(),
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
            mode: Default::default(),
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

    /// F88 — EL CÓDIGO AUTOMÁTICO NO LE ROBÓ EL CÓDIGO AL ARCHIVO (el caso real del dueño, 2026-10-05).
    ///
    /// Con su archivo de 83 filas la carga se frenaba entera con «el código «P-1031» ya es de la ficha
    /// #1031: cambiá el código o marcá «actualizar esa ficha»». No era un choque de sus datos: la primera
    /// ficha NUEVA nacía con id 1031 y el sistema le regalaba `P-1031` — el mismo código que esa misma
    /// carga traía para otra pantalla (`Infinix Smart 8`). Acá se reproduce el escenario con los números
    /// de verdad: una ficha nueva sin código (que recibe el id siguiente) y una fila que trae ESE código.
    #[test]
    fn test_f88_el_codigo_automatico_no_le_roba_el_codigo_al_archivo() {
        let (db, _p) = setup("codigo_auto");
        // el id de la próxima ficha creada (el que le da SQLite) — es el que el sistema usaba a ciegas
        let max_id: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT COALESCE(MAX(id),0) FROM products", [], |r| r.get(0))
            .unwrap();
        let codigo_reservado = format!("P-{:04}", max_id + 1);

        let texto = format!(
            "nombre;categoria;marca;modelo;compatibilidad;costo;venta;stock;codigo\n\
             Pantalla ZZZ Sonda Sin Codigo;Pantalla;Infinix;Sonda A;Infinix Sonda A;1;2;1;\n\
             Pantalla ZZZ Sonda Con Codigo;Pantalla;Infinix;Sonda B;Infinix Sonda B;1;2;1;{codigo_reservado}\n"
        );
        let r = aplicar(&db, &texto, "").expect("la carga tiene que aplicarse: el código automático no puede chocar con el del archivo");
        assert_eq!(r.created, 2);

        let sin_codigo = db.get_products("ZZZ Sonda Sin Codigo", None).unwrap();
        let con_codigo = db.get_products("ZZZ Sonda Con Codigo", None).unwrap();
        assert_eq!(sin_codigo.len(), 1);
        assert_eq!(con_codigo.len(), 1);
        assert_eq!(
            con_codigo[0].code, codigo_reservado,
            "la ficha que TRAÍA el código se lo queda"
        );
        assert_ne!(
            sin_codigo[0].code, codigo_reservado,
            "y a la que no traía NO se le inventa el código del archivo"
        );
        assert!(
            sin_codigo[0].code.starts_with("P-"),
            "igual se numera sola, con el primer P-#### libre: {}",
            sin_codigo[0].code
        );
        // ninguna otra ficha del catálogo se quedó con un código repetido
        let repetidos: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM (SELECT UPPER(TRIM(code)) c FROM products \
                 WHERE code IS NOT NULL AND trim(code) <> '' GROUP BY c HAVING count(*) > 1)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(repetidos, 0, "no puede quedar ninguna ficha con un código repetido");
    }

    /// F88 — LA FILA DICE LA LISTA QUE VA A QUEDAR (pedido del dueño: «la compatibilidad así es necesaria
    /// para cada modelo tiene que aparecer»). `compatibility_final` es la lista del archivo —normalizada
    /// como la guarda el catálogo— y, con la celda vacía, la que se arma con el MODELO.
    /// F88 — DOS CÓDIGOS DISTINTOS NO SON LA MISMA PANTALLA. El caso REAL del archivo del dueño
    /// (2026-10-05): el catálogo tenía una ficha fusionada con el modelo «Spark Go 2024» y el código
    /// `P-0053`; su archivo trae DOS pantallas distintas —«Infinix Hot 40i» con `P-0053` y «Tecno Spark
    /// Go 2024» con `P-1033`—. Antes las dos caían en esa ficha, la última pisaba a la primera y **el
    /// código `P-0053` desaparecía del catálogo**. Ahora la fila del código desconocido se CREA.
    #[test]
    fn test_f88_dos_codigos_distintos_no_son_la_misma_pantalla() {
        let (db, _p) = setup("codigos_distintos");
        // la ficha fusionada del catálogo (mismo escenario que la #53 real), con SU código del local
        db.add_product(
            "Pantalla Tecno Infinix Go 2024 / Infinix Hot 40i / Spark 20",
            Some(1), "Infinix", "Spark Go 2024", "",
            r#"["Infinix Hot 40i","Tecno Spark 20"]"#, 1.0, 2.0, 5, 0, 0.0,
        )
        .unwrap();
        let fusionada = db.get_products("Infinix Go 2024", None).unwrap();
        let id_fusionada = fusionada[0].id;
        db.conn
            .lock()
            .unwrap()
            .execute("UPDATE products SET code = 'P-0053' WHERE id = ?1", rusqlite::params![id_fusionada])
            .unwrap();

        // DOS filas del archivo, cada una con SU código: la primera coincide por CÓDIGO con la ficha
        // fusionada y la segunda por IDENTIDAD (marca+modelo) — el choque que perdía un código.
        let texto = "nombre;categoria;marca;modelo;compatibilidad;stock;codigo\n\
                     Infinix Hot 40i;Pantalla;Infinix;Hot 40i;Infinix Hot 40i / Infinix Smart 8;1;P-0053\n\
                     Tecno Spark Go 2024;Pantalla;Infinix;Spark Go 2024;Infinix Smart 8 / Tecno Spark 20;1;P-1033\n";
        let r = aplicar(&db, texto, "").expect("la carga se tiene que aplicar sin pisar códigos");

        let con_codigo_viejo = db.get_products("Infinix Hot 40i", None).unwrap();
        assert_eq!(con_codigo_viejo.len(), 1, "la ficha que traía P-0053 sigue siendo UNA");
        assert_eq!(con_codigo_viejo[0].id, id_fusionada, "y es la ficha que ya estaba");
        assert_eq!(con_codigo_viejo[0].code, "P-0053", "que CONSERVA su código del local");
        assert_eq!(r.updated, 1, "esa fila actualizó la ficha existente");

        let nueva = db.get_products("Tecno Spark Go 2024", None).unwrap();
        let nueva_codigo = nueva.iter().find(|p| p.code == "P-1033").expect("la pantalla del código nuevo se crea aparte");
        assert_eq!(r.created, 1, "y la otra fila CREÓ su propia ficha");
        assert_ne!(nueva_codigo.id, id_fusionada, "no puede ser la misma ficha");
        assert_eq!(
            nueva_codigo.compatibility.as_deref(), Some(r#"["Infinix Smart 8","Tecno Spark 20"]"#),
            "con SU compatibilidad (por modelo), no la de la ficha ajena"
        );
    }

    #[test]
    fn test_f88_la_fila_dice_la_lista_que_va_a_quedar() {
        let (db, _p) = setup("compat_final");
        let texto = "nombre;categoria;marca;modelo;compatibilidad;stock\n\
                     Pantalla ZZZ Sonda Uno;Pantalla;Infinix;Hot 40i;Infinix Hot 40i / Infinix Smart 8 / Tecno Spark 20;1\n\
                     Pantalla ZZZ Sonda Dos;Pantalla;Samsung;A30 / A50;;1\n";
        let p = db.preview_csv_load(texto).unwrap();
        assert!(p.fatal.is_none(), "{:?}", p.fatal);

        let con_lista = p.rows.iter().find(|r| r.line == 2).unwrap();
        assert_eq!(
            con_lista.compatibility_final,
            "Infinix Hot 40i / Infinix Smart 8 / Tecno Spark 20",
            "la lista del archivo, tal como la va a guardar la carga"
        );
        assert!(!con_lista.compat_del_modelo, "esta fila SÍ traía lista");

        let sin_lista = p.rows.iter().find(|r| r.line == 3).unwrap();
        assert!(sin_lista.compat_del_modelo, "sin lista en el archivo, la arma el modelo");
        assert_eq!(
            sin_lista.compatibility_final, "Samsung A30 / Samsung A50",
            "«A30 / A50» son DOS teléfonos (el modelo manda): {:?}",
            sin_lista.compatibility_final
        );
        assert!(
            sin_lista.notes.iter().any(|n| n.contains("MODELO")),
            "y la fila lo dice: {:?}",
            sin_lista.notes
        );
        assert!(!sin_lista.aviso_compat, "una lista que arma el modelo no puede avisar de sí misma");

        // y la OTRA cara de la celda vacía: una ficha que YA tenía su lista curada la CONSERVA (regla F78)
        // — ahí la fila NO puede decir «del modelo», porque la lista no salió del modelo.
        db.add_product("ZZZ Sonda Conserva", Some(1), "Infinix", "Hot 40i", "",
            r#"["Infinix Hot 40i","Tecno Spark 20"]"#, 1.0, 2.0, 1, 0, 0.0).unwrap();
        let p2 = db.preview_csv_load(
            "nombre;categoria;marca;modelo;compatibilidad;stock\nZZZ Sonda Conserva;Pantalla;Infinix;Hot 40i;;1\n",
        ).unwrap();
        let conserva = p2.rows.iter().find(|r| r.line == 2).unwrap();
        assert!(conserva.product_id.is_some(), "la fila tiene que cruzar con la ficha que ya existe");
        assert!(!conserva.compat_del_modelo, "esta ficha ya tenía lista: NO es «del modelo»");
        assert_eq!(conserva.compatibility_final, "Infinix Hot 40i / Tecno Spark 20", "se conserva la suya");
        assert!(
            conserva.notes.iter().any(|n| n.contains("CONSERVA")),
            "y la fila lo dice: {:?}",
            conserva.notes
        );
    }

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
            mode: Default::default(),
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
            mode: Default::default(),
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
            mode: Default::default(),
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
            mode: Default::default(),
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
            mode: Default::default(),
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
            mode: Default::default(),
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
            mode: Default::default(),
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
            mode: Default::default(),
        }).unwrap();
        assert_eq!(r.updated, 1);
        let prod = &db.get_products("A06", None).unwrap()[0];
        assert_eq!(prod.brand.as_deref(), Some("Samsung"), "la marca NO se borra con la celda vacía");
        assert_eq!(prod.model.as_deref(), Some("A06 4G"));
        assert_eq!(prod.compatibility.as_deref(), Some(r#"["Samsung A06 4G"]"#), "la compatibilidad curada NO se pierde");
        assert_eq!(prod.stock, 8, "3 + 5 (el stock sí se suma)");
        // y el guion SIGUE borrando (es la forma explícita de dejar un campo en blanco). OJO con la
        // COMPATIBILIDAD (F86/REQ-1): si la ficha tiene MODELO, la lista no puede quedar vacía — el modelo
        // arma la suya. Lo que el guion borra en ese caso son los OTROS teléfonos («también le sirve a»).
        let texto2 = "nombre;categoria;marca;modelo;compatibilidad\nPantalla Samsung A06 4G;Pantalla;Samsung;A06 4G;-\n";
        let p2 = db.preview_csv_load(texto2).unwrap();
        db.apply_csv_load(&CsvApplyInput {
            rows: p2.rows.clone(), columns: p2.columns.clone(), supplier: String::new(),
            file_name: "guion.csv".into(), new_categories: vec![],
            mode: Default::default(),
        }).unwrap();
        let prod2 = &db.get_products("A06", None).unwrap()[0];
        assert_eq!(
            prod2.compatibility.as_deref(),
            Some(r#"["Samsung A06 4G"]"#),
            "con modelo, la lista queda con SU teléfono (el guion borró la lista aparte)"
        );
        assert_eq!(prod2.brand.as_deref(), Some("Samsung"), "y no toca lo demás");
        // y borrando el MODELO también (los dos guiones) la ficha queda sin compatibilidad: el guion sigue
        // siendo la forma de vaciar un campo a propósito
        let texto3 = "nombre;categoria;marca;modelo;compatibilidad\nPantalla Samsung A06 4G;Pantalla;Samsung;-;-\n";
        let p3 = db.preview_csv_load(texto3).unwrap();
        db.apply_csv_load(&CsvApplyInput {
            rows: p3.rows.clone(), columns: p3.columns.clone(), supplier: String::new(),
            file_name: "guion2.csv".into(), new_categories: vec![],
            mode: Default::default(),
        }).unwrap();
        let prod3 = &db.get_products("A06", None).unwrap()[0];
        assert_eq!(prod3.compatibility.as_deref(), Some(""), "sin modelo ni lista, sin compatibilidad");
        assert_eq!(prod3.model.as_deref(), Some(""), "el guion vació el modelo");
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
            mode: Default::default(),
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
            mode: Default::default(),
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
            mode: Default::default(),
        }).unwrap_err();
        assert!(err.contains("fuera del rango"), "{err}");
        assert_eq!(db.get_products("A06", None).unwrap()[0].stock, 3, "no se escribió nada");
        // y un precio absurdo tampoco
        let mut rows2 = p.rows.clone();
        rows2[0].price_sale = Some(-1.0);
        let err2 = db.apply_csv_load(&CsvApplyInput {
            rows: rows2, columns: p.columns.clone(), supplier: String::new(),
            file_name: "x.csv".into(), new_categories: vec![],
            mode: Default::default(),
        }).unwrap_err();
        assert!(err2.contains("fuera del rango"), "{err2}");
    }
}
