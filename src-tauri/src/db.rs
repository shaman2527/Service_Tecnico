use rusqlite::{Connection, OptionalExtension, params, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}

/// F65 — Una categoría de PRODUCTO vista desde «Ajustes»: además del nombre, cuánto la usa el
/// catálogo (fichas y unidades) y si es una de las del PADRÓN DE TELÉFONOS (esas tres no se
/// renombran ni se borran: las reglas del padrón y los nombres de las fichas dependen de ellas).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryUsage {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    /// fichas de producto que la tienen puesta
    pub products: i64,
    /// unidades de stock sumadas de esas fichas
    pub units: i64,
    /// es una categoría del padrón de teléfonos (`catalog::PHONE_CATEGORIES`) → fija
    pub phone_padron: bool,
}

/// F65 — Resultado de crear una categoría: la categoría (nueva o la que YA existía) y si de verdad
/// se creó. La UI necesita los dos datos: si el nombre ya existía se elige ESA categoría y se avisa
/// («ya existía»), en vez de crear una gemela y partir el catálogo en dos.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryOutcome {
    pub category: Category,
    pub created: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Client {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
    pub total_spent: f64,
    pub last_service: Option<String>,
    pub last_purchase: Option<String>,
    pub created_at: Option<String>,
    pub ci: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClientSummary {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub total_spent: f64,
    pub service_count: i64,
    pub sale_count: i64,
    pub last_date: Option<String>,
    pub ci: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
}

/// Columnas de `products` para los `SELECT` que devuelven la ficha completa.
///
/// REGLA DEL PROYECTO: nunca `SELECT p.*`. Las migraciones usan `ALTER TABLE`, que
/// agrega la columna al FINAL del orden físico (`search_text` quedó en 14) y el mapeo
/// posicional pasaba a leer la columna equivocada: `category_name: r.get(14)` devolvía
/// `search_text` y la columna «Categoría» de Inventario mostraba el texto de búsqueda.
/// Con esta lista el orden es fijo: 0..13 = producto, **14 = `c.name`**, 15 = supplier y
/// **16/17 = `in_use` / `code` (F50, apendadas al final)**.
pub(crate) const PRODUCT_COLS: &str = "p.id, p.name, p.category_id, p.brand, p.model, \
     p.variant, p.compatibility, p.price_cost, p.price_sale, p.stock, p.min_stock, \
     p.created_at, p.updated_at, p.price_usd, c.name as category_name, COALESCE(p.supplier,'') as supplier, \
     COALESCE(p.in_use,1) as in_use, COALESCE(p.code,'') as code";

/// F52 — FAMILIA de la variante escrita en SQL: la PRIMERA PALABRA del texto recortado, en
/// minúsculas (sin acentos: las variantes reales del catálogo son INCELL / OLED / ORIGINAL / AM /
/// «OLED Con Marco»…). Es la MISMA regla que `catalog::variant_family` — que es la que usan los
/// chips y los textos de la app — y el test `test_variant_family_sql_matches_rust` compara las dos
/// implementaciones contra los valores REALES del catálogo, así que no pueden divergir en silencio.
pub(crate) const VARIANT_FAMILY_SQL: &str = "lower(CASE \
     WHEN instr(trim(COALESCE(p.variant,'')), ' ') > 0 \
       THEN substr(trim(COALESCE(p.variant,'')), 1, instr(trim(COALESCE(p.variant,'')), ' ') - 1) \
       ELSE trim(COALESCE(p.variant,'')) END)";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id: i64,
    pub name: String,
    pub category_id: Option<i64>,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub variant: Option<String>,
    pub compatibility: Option<String>,
    pub price_cost: f64,
    pub price_sale: f64,
    pub stock: i64,
    pub min_stock: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub category_name: Option<String>,
    pub price_usd: f64,
    /// Proveedor que trajo esta mercancía (lo llena la carga de inventario; editable en la ficha)
    #[serde(default)]
    pub supplier: String,
    /// F50: 1 = el local lo marcó como «lo uso» (es lo que ofrece el formulario de servicio).
    #[serde(default = "uno")]
    pub in_use: i64,
    /// F50: código corto con el que el local lo dicta/busca (`P-0142`).
    #[serde(default)]
    pub code: String,
}

/// `serde` necesita una función para el default de `in_use` (siempre «en uso» si falta el campo).
fn uno() -> i64 { 1 }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Sale {
    pub id: i64,
    pub date: Option<String>,
    pub product_id: Option<i64>,
    pub product_name: Option<String>,
    pub quantity: i64,
    pub unit_price: f64,
    pub total: f64,
    pub payment_method: Option<String>,
    pub client_name: Option<String>,
    pub client_id: Option<i64>,
    pub notes: Option<String>,
    pub bank_fee_percent: f64,
    pub bank_fee_amount: f64,
    pub net_amount: f64,
    pub zelle_reference: Option<String>,
    pub currency: Option<String>,
    pub client_ci: Option<String>,
    pub discount_amount: f64,
    /// F70 — ANULACIÓN: cuándo se anuló (NULL = la venta vale) y por qué. La fila NUNCA se borra: la
    /// venta queda en la lista tachada y el libro guarda su contra-asiento. Se APENDAN al final del
    /// orden físico (regla InvalidColumnType: listas explícitas, nunca `SELECT *` posicional).
    pub voided_at: Option<String>,
    pub void_reason: Option<String>,
    /// F74 — EL IVA DE ESTA VENTA: la alícuota (0 = sin IVA) y el modo con que se cargó
    /// ('agregado' | 'incluido' | ''). `total` es SIEMPRE lo que pagó el cliente; de ahí se despeja
    /// base e IVA (`src/lib/iva.ts`). Apendadas al final (regla InvalidColumnType).
    pub iva_rate: f64,
    pub iva_mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SaleStat {
    pub product_name: Option<String>,
    pub product_id: Option<i64>,
    pub qty: i64,
    pub total: f64,
    pub count: i64,
}

/// F74 — LA CONFIGURACIÓN DEL IVA (tabla `settings`, clave `tax_config`).
/// `activo` la prende y la apaga; con el switch apagado NADA cambia en los precios. `alicuota` es el
/// porcentaje (16 = 16%) y `modo` dice si el IVA ya viene en el precio (`incluido`) o se suma al
/// cobrar (`agregado`). La lee todo el mundo (la caja necesita saber si hay IVA para desglosar) y la
/// escribe sólo el DUEÑO.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct TaxConfig {
    pub activo: bool,
    pub alicuota: f64,
    pub modo: String,
}

impl Default for TaxConfig {
    /// De fábrica el IVA está **APAGADO** (los precios del local quedan como están) y listo con 16%,
    /// la alícuota general de Venezuela.
    fn default() -> Self {
        Self { activo: false, alicuota: 16.0, modo: "incluido".to_string() }
    }
}

/// F74 — una fila del LIBRO DE IVA del período: las operaciones agrupadas por alícuota. El desglose
/// base/IVA se calcula en el frontend con la regla pura (`src/lib/iva.ts`), no acá.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IvaGroupRow {
    pub iva_rate: f64,
    pub total: f64,
    pub operaciones: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Service {
    pub id: i64,
    pub order_num: Option<String>,
    pub date_in: Option<String>,
    pub client: Option<String>,
    pub phone: Option<String>,
    pub model: Option<String>,
    pub fault: Option<String>,
    pub service_type: Option<String>,
    pub service_types: Option<String>,
    pub amount: f64,
    pub payment_method: Option<String>,
    pub date_out: Option<String>,
    pub status: Option<String>,
    pub observations: Option<String>,
    pub bank_fee_percent: f64,
    pub bank_fee_amount: f64,
    pub net_amount: f64,
    pub zelle_reference: Option<String>,
    pub currency: Option<String>,
    pub client_ci: Option<String>,
    pub client_address: Option<String>,
    pub device_checklist: Option<String>,
    pub client_id: Option<i64>,
    pub paid_amount: f64,
    pub technician_id: Option<i64>,
    pub technician: Option<String>,
    pub group_id: Option<String>,
    pub color: Option<String>,
    pub printed: i64,
    pub screen_product_id: Option<i64>,
    pub discount_amount: f64,
    // F32 — señales de POLÍTICA del taller (recordatorios del operario). Son anotaciones
    // informativas: las escribe SOLO `set_service_policy` (comando angosto), nunca
    // insert_service_row/update_service, así que editar una orden jamás las pisa.
    /// Foto de ENTRADA del equipo confirmada (fecha/hora local) — NULL = pendiente
    pub photo_in_at: Option<String>,
    /// Foto de SALIDA del equipo confirmada (fecha/hora local) — NULL = pendiente
    pub photo_out_at: Option<String>,
    /// Acuerdo de pago con el cliente: 'ahora' | 'al_retirar' | NULL (no se preguntó)
    pub pay_intent: Option<String>,
    /// F74 — EL IVA DE ESTA ORDEN: alícuota (0 = sin IVA) y modo ('agregado' | 'incluido' | '').
    /// `amount` sigue siendo lo que paga el cliente (con IVA si el modo es «agregado»); base e IVA se
    /// despejan de ese monto con la alícuota de la fila. Apendadas al FINAL del orden físico.
    pub iva_rate: f64,
    pub iva_mode: String,
}

// Un equipo dentro de una orden multi-equipo (add_service_order)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceDeviceInput {
    pub model: String,
    pub fault: String,
    pub service_type: String,
    pub service_types: String,
    pub amount: f64,
    pub payment_method: String,
    pub observations: String,
    pub bank_fee_percent: f64,
    pub zelle_reference: String,
    pub currency: String,
    pub device_checklist: String,
    pub color: String,
    pub screen_product_id: Option<i64>,
    pub discount_amount: f64,
    /// F32: estado con el que nace la orden ("Recibido" por defecto en el wizard).
    /// Se apenda al FINAL: el INSERT lo toma por nombre de columna, no por posición.
    #[serde(default)]
    pub status: String,
    /// F74 — IVA del equipo: alícuota (0 = sin IVA) y modo ('agregado' | 'incluido' | '').
    /// `amount` es lo que paga el cliente. `#[serde(default)]`: los llamadores viejos siguen
    /// funcionando y una orden sin IVA nace en 0/''.
    #[serde(default)]
    pub iva_rate: f64,
    #[serde(default)]
    pub iva_mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Technician {
    pub id: i64,
    pub name: String,
    pub initials: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TechnicianStat {
    pub technician_id: Option<i64>,
    /// Snapshot del nombre (sobrevive al borrado del técnico); '' = sin asignar
    pub technician: String,
    pub initials: String,
    pub color: String,
    pub total: i64,
    /// En taller: estados activos (no Entregado/Cancelado/Devuelto)
    pub activos: i64,
    pub entregados: i64,
    /// Ingresos acumulados de servicios Entregado (USD)
    pub ingresos: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServicePayment {
    pub id: i64,
    pub service_id: i64,
    pub amount: f64,
    pub payment_method: Option<String>,
    pub bank_fee_percent: f64,
    pub bank_fee_amount: f64,
    pub net_amount: f64,
    pub zelle_reference: Option<String>,
    pub currency: Option<String>,
    pub payment_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentSearchResult {
    pub id: i64,
    pub service_id: i64,
    pub order_num: Option<String>,
    pub client: Option<String>,
    pub client_ci: Option<String>,
    pub model: Option<String>,
    pub amount: f64,
    pub currency: Option<String>,
    pub payment_method: Option<String>,
    pub net_amount: f64,
    pub zelle_reference: Option<String>,
    pub payment_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PurchaseOrder {
    pub id: i64,
    pub order_date: Option<String>,
    pub supplier: Option<String>,
    pub status: Option<String>,
    pub notes: Option<String>,
    pub item_count: i64,
    pub total_quantity: i64,
    pub total_cost: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PurchaseOrderItem {
    pub id: i64,
    pub order_id: i64,
    pub product_id: Option<i64>,
    pub product_name: Option<String>,
    pub quantity: i64,
    pub unit_price: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceDashboard {
    pub total: i64,
    pub entregados: i64,
    pub pendientes: i64,
    pub total_ingresos: f64,
    pub method_stats: Vec<MethodStat>,
    pub status_stats: Vec<StatusStat>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MethodStat {
    pub payment_method: Option<String>,
    pub count: i64,
    pub total: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StatusStat {
    pub status: Option<String>,
    pub count: i64,
    pub total: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InventoryMovement {
    pub id: i64,
    pub date: Option<String>,
    pub product_id: Option<i64>,
    pub r#type: Option<String>,
    pub quantity: i64,
    pub reason: Option<String>,
    pub reference: Option<String>,
    pub product_name: Option<String>,
}

// --- Inventario unificado (2026-09-15): página, KPIs, modelos y pantallas ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProductPage {
    pub items: Vec<Product>,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct StockCount {
    pub name: String,
    pub sku: i64,
    pub units: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct InventoryStats {
    pub sku: i64,
    pub with_stock: i64,
    pub out_of_stock: i64,
    pub negative: i64,
    pub low_stock: i64,
    pub no_price: i64,
    pub no_compat: i64,
    pub brands: i64,
    pub units: i64,
    pub value_cost: f64,
    pub value_sale: f64,
    pub duplicate_groups: i64,
    pub duplicate_ids: Vec<i64>,
    pub by_category: Vec<StockCount>,
}

/// Un teléfono del catálogo (lista maestra derivada de `compatibility`).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PhoneModelRow {
    pub label: String,
    pub brand: String,
    pub key: String,
    /// cuántas pantallas/repuestos distintos le sirven
    pub screens: i64,
    /// unidades totales de esos repuestos
    pub stock: i64,
    pub with_stock: i64,
    /// F50: el local MARCA este modelo como «lo uso» (0/1) y su código corto (`M-007`).
    pub in_use: i64,
    pub code: String,
    /// F53 — pantalla de REFERENCIA del modelo: la que el local instala siempre. Al elegir el modelo
    /// en el registro de servicio, esta se **auto-selecciona** (`autoScreen`), y el operario puede
    /// cambiarla a mano si ese día pone otra.
    pub default_product_id: Option<i64>,
}

/// F53 — un TELÉFONO dentro de un grupo de repetidos (lo que muestra el asistente).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PhoneDuplicateRow {
    pub id: i64,
    pub brand: String,
    pub name: String,
    pub code: String,
    pub in_use: i64,
    /// cuántos repuestos le sirven (todos los del grupo comparten el MISMO conjunto)
    pub repuestos: i64,
    pub aliases: Vec<String>,
}

/// F53 — grupo de MODELOS que se sirven con los MISMOS repuestos: el asistente propone juntarlos
/// (el dueño decide, con vista previa de qué nombre queda y qué alias se conservan).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PhoneDuplicateGroup {
    pub phones: Vec<PhoneDuplicateRow>,
}

/// F52 — Familia de variante con cuántas fichas (y stock) tiene en el catálogo.
/// La llena `get_variant_families` para el desplegable de «Variante» del inventario.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct VariantFamily {
    /// familia en minúsculas (`incell`, `oled`, `original`, `am`) o `""` = sin variante
    pub family: String,
    pub products: i64,
    pub stock: i64,
}

/// F53 — Resultado de «separar los modelos» (vista previa y aplicación): es el mismo informe para
/// las dos, así el dueño ve ANTES exactamente lo que va a pasar (`preview_phone_split`) y después
/// lo que pasó (`apply_phone_split`).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PhoneSplitPreview {
    pub phones_before: i64,
    pub phones_after: i64,
    /// teléfonos que APARECEN (los modelos que estaban pegados en una entrada compuesta)
    pub created: Vec<String>,
    /// teléfonos que DEJAN de existir (la entrada combinada, «Samsung A70 A705»)
    pub removed: Vec<String>,
    /// filas del padrón con nombre/marca refrescados
    pub updated: i64,
    /// teléfonos que quedan «por revisar» (sin familia)
    pub needs_review: i64,
    /// variantes que estaban escritas en el TEXTO y pasaron al campo `variant`
    pub variants_extracted: i64,
    pub variant_samples: Vec<String>,
    /// respaldo de la base antes de escribir (solo al aplicar)
    pub backup: Option<String>,
}

/// Foto del padrón: clave → (id, nombre). La usan la vista previa y la aplicación del split para
/// decir con nombres y apellidos qué se crea y qué se borra.
fn phone_snapshot(conn: &Connection) -> SqlResult<std::collections::BTreeMap<String, (i64, String)>> {
    let mut stmt = conn.prepare("SELECT COALESCE(key,''), id, COALESCE(name,'') FROM phones")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, String>(2)?))))?;
    let mut out = std::collections::BTreeMap::new();
    for row in rows {
        let (k, v) = row?;
        out.insert(k, v);
    }
    Ok(out)
}

/// F53 — fichas de pantalla SIN variante y con el material escrito en el texto de compatibilidad.
fn productos_sin_variante(conn: &Connection) -> SqlResult<Vec<(i64, String, String, String, String)>> {
    let cats: Vec<String> = crate::catalog::PHONE_CATEGORIES.iter().map(|c| c.to_string()).collect();
    let mut stmt = conn.prepare(&format!(
        "SELECT id, COALESCE(name,''), COALESCE(brand,''), COALESCE(model,''), COALESCE(compatibility,'')
         FROM products
         WHERE COALESCE(variant,'')='' AND COALESCE(compatibility,'') NOT IN ('','[]')
           AND COALESCE(category_id,0) IN ({})",
        cats.join(",")
    ))?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })?;
    rows.collect::<SqlResult<Vec<_>>>()
}

/// F53 — las variantes que se pueden sacar del texto (para el informe de la vista previa).
fn variantes_a_extraer(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut out = Vec::new();
    for (_, nombre, _, _, compat) in productos_sin_variante(conn)? {
        if let Some(v) = crate::catalog::variant_in_text(&compat) {
            out.push(format!("{nombre} → {v}"));
        }
    }
    Ok(out)
}

/// Candidata del desplegable "Pantalla a instalar" del formulario de servicio.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScreenCandidate {
    pub product: Product,
    /// "exacta" | "prefijo" | "parcial"
    pub match_quality: String,
    pub in_stock: bool,
    /// La compatibilidad del repuesto NOMBRA la marca del teléfono (o el repuesto es de
    /// esa marca). `false` = solo coincidió el texto del modelo (`Honor 10 Lite` con una
    /// pantalla de `Infinix Hot 10 Lite`): sirve para mostrarla, nunca para elegirla sola.
    pub brand_match: bool,
    /// Se CONOCE la marca del teléfono (el padrón o el texto la dicen). Con `false` no hay
    /// certeza —modelo escrito a mano, o texto ambiguo entre marcas— y `brand_match` no
    /// significa «es de otra marca»: la UI no debe avisar nada.
    pub brand_known: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MovementPage {
    pub items: Vec<InventoryMovement>,
    pub total: i64,
}

/// Un producto dentro de un grupo de duplicados.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DuplicateItem {
    pub id: i64,
    pub name: String,
    pub stock: i64,
    pub price_sale: f64,
    pub updated_at: Option<String>,
}

/// Grupo de productos repetidos (mismo teléfono en dos fichas distintas).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DuplicateGroup {
    pub label: String,
    pub items: Vec<DuplicateItem>,
    pub stock_total: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentMethod {
    pub id: i64,
    pub name: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceStatus {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PagoMovilDetail {
    pub reference: Option<String>,
    pub amount: f64,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrinterSettings {
    pub port: String,
    pub baud: u32,
    pub width: u32,
    pub windows_printer: String,
    /// Cabecera del ticket de servicio (escalable: más claves = más campos futuros)
    pub business_name: String,
    pub business_line: String,
    /// Logo del ticket: PNG en base64 (data URL) — se imprime como raster monocromo arriba de la cabecera
    pub logo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyTotals {
    pub date: String,
    pub pos_charged: f64,
    pub pos_fees: f64,
    pub pos_net: f64,
    /// Punto de Venta desglosado por moneda (para no mostrar Bs con símbolo $)
    pub pos_charged_usd: f64,
    pub pos_charged_bs: f64,
    pub pos_net_usd: f64,
    pub pos_net_bs: f64,
    pub cash_usd: f64,
    pub cash_bs: f64,
    pub zelle_total: f64,
    pub pago_movil_total: f64,
    pub transfer_bs_total: f64,
    pub usd_cash_total: f64,
    pub grand_total: f64,
    /// Desglose por moneda: lo cobrado en USD y en Bs (moneda derivada del método)
    pub grand_usd: f64,
    pub grand_bs: f64,
    /// Tasa BCV del día (de daily_closings; fallback día abierto)
    pub tasa_bcv: f64,
    /// F42 — DEVUELTO al cliente ese día, por moneda, en positivo para poder mostrarlo
    /// («Devoluciones: Bs. 1.697,00»). Es informativo: los totales por método ya vienen NETOS
    /// (la devolución es un movimiento negativo con el método por el que salió la plata).
    /// Se calcula acá y no en el frontend porque el frontend no ve los movimientos del día.
    pub refund_usd: f64,
    pub refund_bs: f64,
}

// Resumen de actividad de un día (Libro Diario → tarjeta "Resumen del día", harness 2026-08-07)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DaySummary {
    pub date: String,
    /// Equipos RECIBIDOS ese día (date_in)
    pub received: i64,
    /// Entregados ese día (status='Entregado' AND date_out = día)
    pub delivered: i64,
    /// En taller ahora mismo (status activo, sin entregados/cancelados)
    pub workshop: i64,
    /// Abonos/pagos de servicios registrados ese día
    pub payments_count: i64,
    /// Abonos del día en USD
    pub payments_usd: f64,
    /// Abonos del día en Bs
    pub payments_bs: f64,
    /// Ventas del día en USD
    pub sales_usd: f64,
    /// Ventas del día en Bs
    pub sales_bs: f64,
}

// Gastos del negocio (Libro Diario → tab Gastos, harness 2026-08-19)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Expense {
    pub id: i64,
    pub expense_date: String,
    pub category: String,
    pub amount: f64,
    pub currency: String,
    pub notes: Option<String>,
    /// F69 — DE DÓNDE SALIÓ LA PLATA. Es lo que decide si el gasto baja el ESPERADO DEL CAJÓN
    /// ('Divisas (USD Cash)' / 'Efectivo Bs') o si salió por banco/otros (no toca el cajón).
    /// Vacío = sin declarar: NO se descuenta del cajón y el arqueo lo avisa.
    pub method: String,
}

/// F69 — LO QUE AJUSTA EL ARQUEO, leído del LIBRO DE PLATA del día (una sola fuente):
/// los gastos y las devoluciones pagados DEL CAJÓN bajan el efectivo esperado; los que salieron por
/// banco/otros no lo tocan. Es la respuesta al hallazgo principal de la auditoría de entrega: pagar
/// un gasto del cajón hacía que la caja «faltara» en un día perfecto.
#[derive(Clone, Debug, serde::Serialize, Default)]
pub struct DrawerAdjust {
    /// Gastos pagados del cajón, en USD (columna «Divisas contadas»)
    pub gastos_usd: f64,
    /// Gastos pagados del cajón, en Bs.
    pub gastos_bs: f64,
    /// Devoluciones pagadas del cajón, en USD
    pub devoluciones_usd: f64,
    /// Devoluciones pagadas del cajón, en Bs.
    pub devoluciones_bs: f64,
    /// Gastos del día SIN método declarado (no se descuentan: el arqueo los AVISA)
    pub sin_metodo: i64,
    /// Fondo de caja declarado al abrir el día (entra al esperado del cajón, en las dos monedas)
    pub fondo_usd: f64,
    pub fondo_bs: f64,
}

// Utilidad bruta del período: ingresos (ventas + servicios cobrados) − costo de mercancía.
// Costo = price_cost ACTUAL del producto (decisión del dueño: no se congela en la venta).
// Los Bs se convierten con la tasa BCV del período (misma convención del Libro Diario).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfitSummary {
    pub start: String,
    pub end: String,
    /// Ingresos totales del período en USD (incluye Bs convertidos a tasa BCV)
    pub income_usd: f64,
    /// Ingresos brutos en Bs (sin convertir — para mostrar el desglose)
    pub income_bs: f64,
    /// Costo de mercancía (USD): ventas con product_id + pantallas instaladas con screen_product_id
    pub cost_usd: f64,
    /// Utilidad bruta en USD equivalente
    pub profit_usd: f64,
    /// Margen bruto % (profit/income)
    pub margin_pct: f64,
    pub sales_income_usd: f64,
    pub sales_income_bs: f64,
    pub sales_cost_usd: f64,
    pub services_income_usd: f64,
    pub services_income_bs: f64,
    pub services_cost_usd: f64,
    /// Tasa BCV usada para convertir Bs (cierre del último día del período, fallback día abierto/último cierre)
    pub tasa_bcv: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReceivableItem {
    pub order_num: Option<String>,
    pub client: Option<String>,
    pub model: Option<String>,
    /// Saldo pendiente en USD equivalente (amount − paid_amount)
    pub saldo_usd: f64,
    /// Días desde que entró la orden (date_in)
    pub days_open: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReceivableBucket {
    pub label: String,
    pub count: i64,
    pub total_usd: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReceivablesSummary {
    /// Total pendiente por cobrar (USD equiv)
    pub total_usd: f64,
    pub count: i64,
    pub buckets: Vec<ReceivableBucket>,
    /// Top 15 órdenes morosas por saldo
    pub items: Vec<ReceivableItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryValue {
    pub category_name: Option<String>,
    pub units: i64,
    pub cost_usd: f64,
    pub sale_usd: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InventoryValue {
    pub units: i64,
    /// Capital inmovilizado: stock × price_cost
    pub cost_usd: f64,
    /// Potencial de venta: stock × price_sale
    pub sale_usd: f64,
    /// Top 5 categorías por capital
    pub categories: Vec<CategoryValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyClosing {
    pub id: i64,
    pub close_date: String,
    pub pos_charged: f64,
    pub pos_fees: f64,
    pub pos_net: f64,
    pub pos_settled: f64,
    /// Monto impreso por el Punto en Bs (migración 2026-08-02)
    pub pos_settled_bs: f64,
    pub cash_usd: f64,
    pub cash_bs: f64,
    pub zelle_total: f64,
    pub pago_movil_total: f64,
    pub transfer_bs_total: f64,
    pub usd_cash_total: f64,
    pub grand_total: f64,
    pub is_closed: bool,
    pub closed_at: Option<String>,
    pub notes: Option<String>,
    pub tasa_bcv: f64,
    pub tasa_eur: f64,
    pub opened_at: Option<String>,
    pub initial_cash_usd: f64,
    pub actual_cash_usd: f64,
    pub actual_cash_bs: f64,
    pub actual_punto_usd: f64,
    pub actual_punto_bs: f64,
    pub actual_zelle: f64,
    pub actual_pago_movil: f64,
    pub actual_transfer_bs: f64,
    pub difference: f64,
    /// Desglose del día en moneda real (migración 2026-08-02)
    pub total_usd: f64,
    pub total_bs: f64,
    /// F69 — AJUSTE DEL CAJÓN que se usó al cerrar: `fondo − gastos pagados del cajón` (USD) y
    /// `− gastos pagados del cajón` (Bs). Sin esto, la lista de Cierres comparaba el efectivo contado
    /// contra un esperado sin el fondo ni los gastos y mostraba un descuadre inventado en cualquier día
    /// que hubiera tenido fondo de caja o un gasto pagado del cajón. Se APENDA al final del orden
    /// físico (regla InvalidColumnType: listas explícitas, nunca `SELECT *` posicional).
    pub drawer_adjust_usd: f64,
    pub drawer_adjust_bs: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryStat {
    pub category_name: Option<String>,
    pub units: i64,
    pub total_usd: f64,
    pub total_bs: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelStat {
    pub product_name: Option<String>,
    pub model: Option<String>,
    pub brand: Option<String>,
    pub units: i64,
    pub total_usd: f64,
    pub total_bs: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardAnalytics {
    pub today_usd: f64,
    pub today_bs: f64,
    pub week_usd: f64,
    pub week_bs: f64,
    pub week_units: i64,
    pub week_count: i64,
    pub category_stats: Vec<CategoryStat>,
    pub top_models: Vec<ModelStat>,
    pub product_count: i64,
    pub sale_count: i64,
    pub service_count: i64,
    pub client_count: i64,
    pub last_sale: Option<String>,
    pub last_service: Option<String>,
    pub last_movement: Option<String>,
    pub last_activity: Option<String>,
    /// Equipos recibidos hoy (date_in = hoy)
    pub today_received: i64,
    /// Entregados hoy (status Entregado y date_out = hoy)
    pub today_delivered: i64,
    /// Cobrado de servicios HOY (misma definición que el Libro Diario: abonos + entregados sin pago)
    pub service_income_today_usd: f64,
    pub service_income_today_bs: f64,
}

/// Duración máxima de la sesión de DUEÑO: UNA jornada de trabajo del local.
/// Pasado ese tiempo desde que se puso el PIN correcto, la sesión vence y el dueño
/// vuelve a entrar con el PIN (una sola vez por jornada en el uso normal). Sin esto,
/// una sesión de dueño abierta a las 8 de la mañana seguía siendo válida al día
/// siguiente (bloqueante B3 de la validación pre-producción).
pub const OWNER_SESSION_HOURS: u64 = 12;

/// Segundos desde la época (para fechar la sesión de dueño). 0 si el reloj falla.
pub(crate) fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Formato local de bolívares para los MENSAJES (`4.050,00`), el mismo que muestra la UI: los
/// mensajes de dinero se leen tal como se escriben en el mostrador.
fn fmt_miles(v: f64) -> String {
    let neg = v < 0.0;
    let centavos = (v.abs() * 100.0).round() as i64;
    let entero = centavos / 100;
    let resto = centavos % 100;
    let mut s = entero.to_string();
    let mut con_puntos = String::new();
    while s.len() > 3 {
        let corte = s.len() - 3;
        con_puntos = format!(".{}{}", &s[corte..], con_puntos);
        s.truncate(corte);
    }
    format!("{}{}{},{:02}", if neg { "-" } else { "" }, s, con_puntos, resto)
}

pub struct Database {
    pub conn: Mutex<Connection>,
    /// MEMORIA CORTA del catálogo (feature 41): lo que se deriva de `products` + `phones`
    /// (índice de repuestos por teléfono, totales, KPIs y compatibilidad ya parseada) se
    /// calcula a lo sumo UNA vez por versión de la base. La versión la da SQLite con
    /// `total_changes()`: si no hubo NINGUNA escritura por esta conexión, lo calculado sigue
    /// valiendo. Ver `src/cache.rs` (ahí está el porqué y lo que NO cubre).
    /// ORDEN DE CANDADOS (obligatorio): PRIMERO `conn`, DESPUÉS `cache`, siempre.
    pub cache: Mutex<crate::cache::CatalogCache>,
    /// Ruta del archivo .db (para respaldos antes de operaciones masivas)
    pub db_path: PathBuf,
    /// F68 — SESIÓN ACTUAL: QUIÉN está usando la app (id, nombre y rol) y desde cuándo.
    /// `None` = sesión cerrada (la app pide el PIN de nuevo). Antes de F68 esto era un booleano
    /// «dueño desbloqueado»; ahora es la persona, porque el libro de plata anota el AUTOR de cada
    /// movimiento y la sesión de caja ve sólo lo suyo. El rol `master` es lo que habilita las
    /// escrituras sensibles (`require_owner`).
    session: Mutex<Option<SessionUser>>,
    /// Hora (epoch, segundos) en que arrancó la sesión actual; 0 = sin fecha.
    /// La sesión VENCE a las `OWNER_SESSION_HOURS` (ver `session_active_for`).
    session_since: std::sync::atomic::AtomicU64,
    /// La última sesión se cerró por VENCIMIENTO: el gate da un mensaje distinto
    /// («venció») para que el operario sepa que solo tiene que volver a poner el PIN.
    owner_expired: std::sync::atomic::AtomicBool,
    /// Intentos fallidos de PIN seguidos (se reinicia con el PIN correcto o al bloquear).
    pin_failures: std::sync::atomic::AtomicU32,
    /// Hasta cuándo está bloqueada la entrada del PIN tras demasiados intentos fallidos.
    pin_locked_until: Mutex<Option<std::time::Instant>>,
}

/// F68 — quién está usando la app. `role` = 'master' (dueño) | 'caja' (operario de caja).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct SessionUser {
    pub id: i64,
    pub name: String,
    pub role: String,
}

/// F68 — una persona de la app, tal como la ve la UI (sin el hash del PIN).
#[derive(Clone, Debug, serde::Serialize)]
pub struct UserOut {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub color: String,
    pub active: bool,
    pub has_pin: bool,
}

/// F68 — un movimiento del libro de plata.
#[derive(Clone, Debug, serde::Serialize)]
pub struct CashMovement {
    pub id: i64,
    pub date: String,
    pub day: String,
    pub r#type: String,
    pub method: String,
    pub currency: String,
    pub amount: f64,
    pub sign: i64,
    pub reference: String,
    pub sale_id: Option<i64>,
    pub service_id: Option<i64>,
    pub payment_id: Option<i64>,
    pub expense_id: Option<i64>,
    pub user_id: Option<i64>,
    pub user_name: String,
    pub note: String,
}

/// F68 — datos mínimos para anotar un movimiento en el libro (el resto lo pone el helper).
pub struct NewCashMovement<'a> {
    pub r#type: &'a str,
    pub method: &'a str,
    pub currency: &'a str,
    pub amount: f64,
    /// +1 entra a la caja, -1 sale.
    pub sign: i64,
    pub reference: &'a str,
    pub sale_id: Option<i64>,
    pub service_id: Option<i64>,
    pub payment_id: Option<i64>,
    pub expense_id: Option<i64>,
    pub note: &'a str,
    /// F69 — FECHA REAL del movimiento cuando se conoce (`payment_date` del abono, `expense_date` del
    /// gasto, la fecha del día al abrir/cerrar). `None` = ahora. Sin esto, un abono o un gasto
    /// retroactivo quedaba anotado en el día en que se tipeó y el arqueo de ese día no lo veía.
    pub when: Option<&'a str>,
}


impl Database {
    pub fn new(db_path: &PathBuf) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Database {
            conn: Mutex::new(conn),
            cache: Mutex::new(crate::cache::CatalogCache::default()),
            db_path: db_path.clone(),
            session: Mutex::new(None),
            session_since: std::sync::atomic::AtomicU64::new(0),
            owner_expired: std::sync::atomic::AtomicBool::new(false),
            pin_failures: std::sync::atomic::AtomicU32::new(0),
            pin_locked_until: Mutex::new(None),
        };
        db.init()?;
        Ok(db)
    }

    /// ¿Esta sesión puede ESCRIBIR? (la usa la UI vía `can_edit_phones` para esconder
    /// botones). Es la misma regla que `require_owner`: `owner_gate().is_ok()`.
    pub fn owner_can_edit(&self) -> bool {
        self.owner_gate().is_ok()
    }

    /// GATE DE ROL del backend (FUENTE ÚNICA, bloqueante B3). TODO comando de escritura
    /// que NO es de la cajera lo llama ANTES de tocar la base:
    ///   catálogo/precios/inventario (productos, fusiones, normalizar, precios, cargas
    ///   masivas, import/export de datos), gastos y compras, cierres de caja, PIN y
    ///   configuración de la impresora.
    /// Los comandos de mostrador (ventas, servicios, abonos, clientes, turno de caja,
    /// impresión y TODAS las lecturas) NO lo llevan: la cajera trabaja sin PIN.
    /// FAIL-CLOSED: si no se puede leer el estado del PIN, NO se permite escribir.
    pub fn require_owner(&self) -> Result<(), String> {
        self.owner_gate()
    }

    /// Implementación única del gate de rol.
    ///
    /// F68 (revisión adversarial, BLOQUEANTE): antes alcanazaba con que `settings.pin` estuviera vacío
    /// para que el gate se abriera — y con F68 hay TRES caminos a ese estado (una instalación nueva sin
    /// PIN, el botón «Quitar PIN» y ponerle PIN vacío al Master desde «Personas»). Con el gate abierto,
    /// una sesión de CAJA podía borrar productos, cerrar/reabrir el día, importar precios, crear
    /// personas y **ponerse su propio PIN de dueño**. Ahora la instalación es «de un solo usuario»
    /// **sólo si no existe ninguna otra persona y el Master no tiene PIN**: en cualquier otro caso se
    /// exige una sesión de Master de verdad.
    fn owner_gate(&self) -> Result<(), String> {
        match self.get_pin_status() {
            Ok(false) if self.single_user_install() => Ok(()),
            Ok(_) => {
                if self.master_session_active() {
                    Ok(())
                } else {
                    Err(self.owner_gate_error())
                }
            }
            Err(_) => Err(
                "No se pudo comprobar el estado del PIN: por seguridad el cambio queda bloqueado. Cierra y vuelve a abrir la app.".to_string(),
            ),
        }
    }

    /// ¿La instalación es de UN SOLO USUARIO? (sin ninguna persona de caja y sin PIN en el Master).
    /// Es la única situación en la que el gate se abre sin sesión: la app del local que sólo tiene al
    /// dueño y nunca puso PIN. Fail-closed: si no se puede leer, NO es de un solo usuario.
    fn single_user_install(&self) -> bool {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };
        // F69 (revisión adversarial): se cuentan sólo las personas ACTIVAS — la MISMA definición que
        // `has_multiple_people`. Antes esta contaba todas las filas y la otra sólo las activas: con la
        // única caja apagada, el dueño sin PIN se quedaba con el gate cerrado («entrá con el PIN del
        // dueño», y no había ningún PIN que entrar) mientras el libro sí se abría sin sesión.
        let otras: i64 = conn
            .query_row("SELECT COUNT(*) FROM users WHERE role <> 'master' AND active=1", [], |r| r.get(0))
            .unwrap_or(1);
        if otras > 0 {
            return false;
        }
        let master_con_pin: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM users WHERE role='master' AND COALESCE(pin_hash,'') <> ''",
                [], |r| r.get(0),
            )
            .unwrap_or(1);
        master_con_pin == 0
    }

    /// ¿Hay más de una persona activa? (la usa el filtro del libro de plata: sin sesión NO se puede
    /// mostrar todo si hay varias personas — fail-closed).
    pub fn has_multiple_people(&self) -> bool {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return true,
        };
        conn.query_row("SELECT COUNT(*) FROM users WHERE active=1", [], |r| r.get::<_, i64>(0))
            .map(|n| n > 1)
            .unwrap_or(true)
    }

    /// F68 — la sesión de MASTER (dueño) vigente: alguien con rol `master` desbloqueado y dentro de
    /// `OWNER_SESSION_HOURS`. Es lo que habilita las escrituras sensibles.
    fn master_session_active(&self) -> bool {
        self.session_active_for(Some("master"))
    }

    /// F68 — ¿hay una sesión vigente (de cualquier rol)? `role`: `Some("master")` / `Some("caja")`
    /// para exigir el rol, `None` para cualquiera.
    fn session_active_for(&self, role: Option<&str>) -> bool {
        use std::sync::atomic::Ordering::Relaxed;
        let who = match self.session.lock() {
            Ok(g) => g.clone(),
            Err(_) => None,
        };
        let Some(who) = who else {
            // sesión cerrada (o PIN incorrecto): se olvida la fecha para que el próximo PIN
            // correcto empiece a contar de cero.
            self.session_since.store(0, Relaxed);
            return false;
        };
        if let Some(r) = role {
            if who.role != r {
                return false;
            }
        }
        let since = self.session_since.load(Relaxed);
        if since == 0 {
            // desbloqueada sin fecha: se fecha acá
            self.session_since.store(now_secs(), Relaxed);
            return true;
        }
        if now_secs().saturating_sub(since) >= OWNER_SESSION_HOURS * 3600 {
            self.lock_owner();
            self.owner_expired.store(true, Relaxed);
            return false;
        }
        true
    }

    /// F68 — la persona de la sesión actual (para anotar el AUTOR de cada movimiento).
    pub fn current_user(&self) -> Option<SessionUser> {
        if !self.session_active_for(None) {
            return None;
        }
        self.session.lock().ok().and_then(|g| g.clone())
    }

    /// F68 — ¿la sesión actual es de caja (operario)? La UI lo usa para esconder los números del
    /// dueño. Sin usuarios ni PIN, la instalación es de un solo usuario → NO es caja.
    pub fn current_is_cashier(&self) -> bool {
        matches!(self.current_user().map(|u| u.role), Some(r) if r == "caja")
    }

    /// Mensaje en español para el operario, con lo que tiene que hacer.
    fn owner_gate_error(&self) -> String {
        if self.owner_expired.load(std::sync::atomic::Ordering::Relaxed) {
            format!(
                "La sesión de dueño venció (pasaron más de {} horas). Entra otra vez con el PIN del dueño para hacer este cambio.",
                OWNER_SESSION_HOURS
            )
        } else {
            "Solo el dueño puede hacer este cambio: entra con el PIN del dueño.".to_string()
        }
    }

    /// F68 — abre la sesión de `user` (sellada AHORA) o la cierra si es `None`.
    /// La usan `verify_pin` (compatibilidad), `verify_user_pin` y el botón «Bloquear sesión».
    pub fn session_set(&self, user: Option<SessionUser>) {
        use std::sync::atomic::Ordering::Relaxed;
        if let Ok(mut g) = self.session.lock() {
            *g = user;
        }
        let abierta = self.session.lock().map(|g| g.is_some()).unwrap_or(false);
        self.session_since.store(if abierta { now_secs() } else { 0 }, Relaxed);
        if abierta {
            self.owner_expired.store(false, Relaxed);
        }
    }

    /// Compatibilidad (F68): el resto del código y los tests hablaban de «sesión de dueño
    /// desbloqueada». `true` abre la sesión del MASTER; `false` la cierra.
    pub fn owner_session_set(&self, unlocked: bool) {
        if unlocked {
            let master = self.master_user().ok().flatten().map(|u| SessionUser {
                id: u.id,
                name: u.name,
                role: u.role,
            });
            match master {
                Some(m) => self.session_set(Some(m)),
                // instalación sin usuarios: sesión de dueño sin persona (compatibilidad)
                None => self.session_set(Some(SessionUser { id: 0, name: "Dueño".to_string(), role: "master".to_string() })),
            }
        } else {
            self.session_set(None);
        }
    }

    /// Cierra la sesión actual: la llama el botón «Bloquear sesión» de la UI y el
    /// vencimiento de `session_active_for`.
    pub fn lock_owner(&self) {
        self.session_set(None);
    }

    /// SOLO para verificación: mueve hacia atrás la fecha de arranque de la sesión de dueño
    /// para poder probar el vencimiento sin esperar 12 horas. No puede desbloquear nada
    /// (adelantar el arranque solo hace que la sesión venza ANTES).
    #[doc(hidden)]
    pub fn owner_session_backdate(&self, secs_ago: u64) {
        self.session_since.store(
            now_secs().saturating_sub(secs_ago),
            std::sync::atomic::Ordering::Relaxed,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // F68 — USUARIOS (Master / Caja) Y LIBRO DE PLATA
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// La fila del MASTER, que nace con el PIN que ya tenía la instalación (`settings.pin`).
    /// Idempotente: se llama en cada arranque y sólo crea la fila si no existe ninguna master.
    /// Así, una instalación vieja (un solo PIN) sigue entrando con SU PIN y una nueva arranca
    /// sin PIN (un solo usuario, sin pantalla de acceso).
    fn ensure_master_user(&self, conn: &Connection) -> SqlResult<()> {
        let hay_master: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role='master'",
            [],
            |r| r.get(0),
        )?;
        if hay_master > 0 {
            return Ok(());
        }
        let pin_hash: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key='pin'", [], |r| r.get(0))
            .optional()?
            .flatten();
        // F69 — el nombre `users.name` es UNIQUE: si ya hay una persona llamada «Master», el INSERT
        // fallaba y con él TODO el arranque (la app no abría). Se busca un nombre libre.
        let mut nombre = "Master".to_string();
        let mut n = 2;
        while conn
            .query_row("SELECT 1 FROM users WHERE name=?1", params![nombre], |r| r.get::<_, i64>(0))
            .optional()?
            .is_some()
        {
            nombre = format!("Master {n}");
            n += 1;
        }
        conn.execute(
            "INSERT INTO users (name, role, pin_hash, color) VALUES (?2, 'master', ?1, '#0ea5e9')",
            params![pin_hash.unwrap_or_default(), nombre],
        )?;
        Ok(())
    }

    /// F68 — el usuario MASTER (el dueño). `None` sólo en instalaciones sin usuarios.
    pub fn master_user(&self) -> SqlResult<Option<UserOut>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, name, role, color, active, CASE WHEN COALESCE(pin_hash,'')<>'' THEN 1 ELSE 0 END
             FROM users WHERE role='master' ORDER BY id LIMIT 1",
            [],
            |r| {
                Ok(UserOut {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    role: r.get(2)?,
                    color: r.get(3)?,
                    active: r.get::<_, i64>(4)? != 0,
                    has_pin: r.get::<_, i64>(5)? != 0,
                })
            },
        )
        .optional()
    }

    /// F68 — las personas que pueden entrar a la app (sin el hash del PIN).
    pub fn get_users(&self, only_active: bool) -> SqlResult<Vec<UserOut>> {
        let conn = self.conn.lock().unwrap();
        let sql = if only_active {
            "SELECT id, name, role, color, active, CASE WHEN COALESCE(pin_hash,'')<>'' THEN 1 ELSE 0 END
             FROM users WHERE active=1 ORDER BY CASE role WHEN 'master' THEN 0 ELSE 1 END, name"
        } else {
            "SELECT id, name, role, color, active, CASE WHEN COALESCE(pin_hash,'')<>'' THEN 1 ELSE 0 END
             FROM users ORDER BY CASE role WHEN 'master' THEN 0 ELSE 1 END, name"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| {
            Ok(UserOut {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                color: r.get(3)?,
                active: r.get::<_, i64>(4)? != 0,
                has_pin: r.get::<_, i64>(5)? != 0,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// F68 — crea una persona. `role` sólo puede ser `master` o `caja` (fail-closed: cualquier
    /// otra cosa es error, no un default silencioso). El nombre no puede repetirse.
    pub fn add_user(&self, name: &str, role: &str, pin: &str, color: &str) -> SqlResult<i64> {
        let nombre = name.trim();
        if nombre.is_empty() {
            return Err(rusqlite::Error::InvalidParameterName(
                "El nombre de la persona no puede estar vacío.".to_string(),
            ));
        }
        if role != "master" && role != "caja" {
            return Err(rusqlite::Error::InvalidParameterName(
                "El rol tiene que ser 'master' (dueño) o 'caja' (operario de caja).".to_string(),
            ));
        }
        let hash = if pin.trim().is_empty() { String::new() } else { hash_pin(pin)? };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (name, role, pin_hash, color) VALUES (?1, ?2, ?3, ?4)",
            params![nombre, role, hash, color],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// F68 — corrige nombre/color/activo de una persona (el PIN va por `set_user_pin`).
    /// No se puede desactivar al último master activo (dejaría la app sin dueño).
    pub fn update_user(&self, id: i64, name: &str, color: &str, active: bool) -> SqlResult<()> {
        let nombre = name.trim();
        if nombre.is_empty() {
            return Err(rusqlite::Error::InvalidParameterName(
                "El nombre de la persona no puede estar vacío.".to_string(),
            ));
        }
        let conn = self.conn.lock().unwrap();
        let role: Option<String> = conn
            .query_row("SELECT role FROM users WHERE id=?1", params![id], |r| r.get(0))
            .optional()?;
        let Some(role) = role else {
            return Err(rusqlite::Error::InvalidParameterName("Esa persona no existe.".to_string()));
        };
        if !active && role == "master" {
            let otros: i64 = conn.query_row(
                "SELECT COUNT(*) FROM users WHERE role='master' AND active=1 AND id<>?1",
                params![id],
                |r| r.get(0),
            )?;
            if otros == 0 {
                return Err(rusqlite::Error::InvalidParameterName(
                    "No se puede apagar al único dueño activo: la app quedaría sin Master.".to_string(),
                ));
            }
        }
        conn.execute(
            "UPDATE users SET name=?2, color=?3, active=?4 WHERE id=?1",
            params![id, nombre, color, if active { 1 } else { 0 }],
        )?;
        // El PIN del master también vive en settings.pin (compatibilidad): si se renombra la
        // persona, la pantalla vieja de PIN sigue funcionando igual.
        Ok(())
    }

    /// F68 — PIN propio de una persona (vacío = esa persona entra sin PIN).
    /// F69 (revisión): el PIN vacío es una facilidad para la instalación de UN solo usuario. Con
    /// más gente NO se acepta dejar a un `master` sin PIN: cualquier operario podría quedarse con
    /// el rol de dueño (los permisos del dueño ven todo el dinero) y además el master no podría
    /// entrar por la pantalla nueva. Tampoco se permite vaciar el PIN del master de la sesión si
    /// eso dejaría la instalación sin ningún dueño con PIN.
    pub fn set_user_pin(&self, id: i64, pin: &str) -> SqlResult<()> {
        let vacio = pin.trim().is_empty();
        // F69 (revisión adversarial): el PIN de una persona tiene la MISMA forma que el del dueño
        // (4 dígitos). Sin esto, un invoke directo podía dejar un PIN de 1 o de 12 caracteres que la
        // pantalla de acceso no puede teclear (el campo corta en 4).
        if !vacio && (pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit())) {
            return Err(day_shift_error("El PIN debe tener exactamente 4 dígitos."));
        }
        {
            let conn = self.conn.lock().unwrap();
            let role: Option<String> = conn
                .query_row("SELECT role FROM users WHERE id=?1", params![id], |r| r.get(0))
                .optional()?;
            let Some(role) = role else {
                return Err(rusqlite::Error::InvalidParameterName("Esa persona no existe.".to_string()));
            };
            if vacio && role == "master" {
                let otras: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM users WHERE id<>?1 AND active=1",
                    params![id],
                    |r| r.get(0),
                )?;
                if otras > 0 {
                    return Err(day_shift_error(
                        "El dueño no puede quedar sin PIN en una instalación con más de una persona: \
                         cualquiera podría entrar como dueño. Poné un PIN de 4 dígitos.",
                    ));
                }
            }
        }
        let hash = if vacio { String::new() } else { hash_pin(pin)? };
        // ¿Es el master «de la casa»? `settings.pin` (la pantalla vieja de PIN y `verify_pin`) es de
        // ESE master — el de menor id, el mismo que usa `master_user()`. Sincronizar a cualquiera
        // otro master le pondría su PIN a un dueño distinto.
        let de_la_casa: bool = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT role='master' AND id=(SELECT id FROM users WHERE role='master' ORDER BY id LIMIT 1) FROM users WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(false)
        };
        let conn = self.conn.lock().unwrap();
        let cambiados = conn.execute("UPDATE users SET pin_hash=?2 WHERE id=?1", params![id, hash])?;
        if cambiados == 0 {
            return Err(rusqlite::Error::InvalidParameterName("Esa persona no existe.".to_string()));
        }
        if de_la_casa {
            // compatibilidad con la pantalla/PIN viejo y con `get_pin_status`
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('pin', ?1)
                 ON CONFLICT(key) DO UPDATE SET value=?1",
                params![hash],
            )?;
        }
        Ok(())
    }

    /// F68 — borra una persona. No se puede borrar al último master (la app quedaría sin dueño)
    /// y el histórico NO se pierde: el libro de plata guarda el nombre del autor copiado.
    pub fn delete_user(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let role: Option<String> = conn
            .query_row("SELECT role FROM users WHERE id=?1", params![id], |r| r.get(0))
            .optional()?;
        let Some(role) = role else {
            return Err(rusqlite::Error::InvalidParameterName("Esa persona no existe.".to_string()));
        };
        if role == "master" {
            let otros: i64 = conn.query_row(
                "SELECT COUNT(*) FROM users WHERE role='master' AND id<>?1",
                params![id],
                |r| r.get(0),
            )?;
            if otros == 0 {
                return Err(rusqlite::Error::InvalidParameterName(
                    "No se puede borrar al único Master: la app quedaría sin dueño.".to_string(),
                ));
            }
        }
        conn.execute("DELETE FROM users WHERE id=?1", params![id])?;
        // F69 (revisión adversarial, MAYOR) — `settings.pin` es la copia de compatibilidad del PIN del
        // master «de la casa» (el de menor id), y `verify_pin` compara contra ESA copia. Al borrar a ese
        // master, la copia quedaba apuntando a un PIN que ya no existe: `verify_pin` seguía aceptando el
        // PIN del borrado y abría sesión como el master vigente. Se resincroniza con el master que queda
        // (y si no queda ninguno con PIN, se vacía: la instalación vuelve a estar «sin PIN»).
        if role == "master" {
            let nuevo: Option<String> = conn
                .query_row(
                    "SELECT COALESCE(pin_hash,'') FROM users WHERE role='master' ORDER BY id LIMIT 1",
                    [], |r| r.get(0),
                )
                .optional()?;
            match nuevo {
                Some(hash) if !hash.is_empty() => {
                    conn.execute(
                        "INSERT INTO settings (key, value) VALUES ('pin', ?1)
                         ON CONFLICT(key) DO UPDATE SET value=?1",
                        params![hash],
                    )?;
                }
                _ => {
                    conn.execute("DELETE FROM settings WHERE key='pin'", [])?;
                }
            }
            // El bloqueo por intentos también se limpia: era del PIN que ya no existe.
            conn.execute("DELETE FROM settings WHERE key IN ('pin_failures','pin_locked_until')", [])?;
        }
        Ok(())
    }

    /// F68 — entra como `user_id` con SU PIN. Abre la sesión (12 h) y devuelve quién entró.
    /// PIN vacío en la fila = esa persona entra sin PIN, **pero sólo en una instalación de un solo
    /// usuario**: si hay más gente, un Master sin PIN no puede entrar sin PIN (sería la puerta para
    /// quedarse con el rol de dueño) — hallazgo MENOR/tronco del BLOQUEANTE de la revisión.
    /// F69: reusa el MISMO bloqueo por intentos que el PIN viejo (`pin_failures`/`PIN_MAX_ATTEMPTS`).
    pub fn verify_user_pin(&self, user_id: i64, pin: &str) -> SqlResult<Option<SessionUser>> {
        let faltan = self.pin_lock_seconds();
        if faltan > 0 {
            return Err(day_shift_error(&format!(
                "Demasiados intentos fallidos. Probá de nuevo en {faltan} segundo(s)."
            )));
        }
        let fila: Option<(String, String, String, i64)> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT name, role, COALESCE(pin_hash,''), active FROM users WHERE id=?1",
                params![user_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
        };
        let Some((name, role, hash, active)) = fila else {
            return Ok(None);
        };
        if active == 0 {
            return Ok(None);
        }
        let ok = if hash.is_empty() {
            if self.single_user_install() {
                true
            } else {
                // Con más gente, la única forma de entrar es con PIN: se dice qué hacer (y que lo
                // haga OTRO dueño, porque esta persona tampoco puede entrar a Personas y accesos).
                self.pin_failure();
                return Err(day_shift_error(&format!(
                    "«{}» no tiene PIN y esta instalación tiene más de una persona: que otro dueño le ponga \
                     un PIN de 4 dígitos desde Libro Diario → Personas y accesos.",
                    name
                )));
            }
        } else {
            check_pin(pin, &hash).is_some()
        };
        if !ok {
            self.pin_failure();
            return Ok(None);
        }
        self.pin_success();
        let user = SessionUser { id: user_id, name, role };
        self.session_set(Some(user.clone()));
        Ok(Some(user))
    }

    /// F68/F40 — anota un movimiento en el LIBRO DE PLATA con el AUTOR de la sesión actual.
    /// La llaman los write-points de dinero DENTRO de su misma transacción (recibe la conexión).
    /// Si no hay sesión (instalación de un solo usuario), el autor queda vacío = «sin asignar».
    ///
    /// F69 (revisión adversarial, MAYOR): `when` es la FECHA REAL del movimiento cuando se conoce
    /// (`payment_date` de un abono retroactivo, `expense_date` de un gasto, la fecha del día al abrir/
    /// cerrar). Antes SIEMPRE se usaba el default `datetime('now')`, así que un abono del 14 anotado el
    /// 17 quedaba en el libro del 17 (y el arqueo del 14 no lo veía). `None` = ahora.
    fn book_movement(&self, conn: &Connection, mv: &NewCashMovement) -> SqlResult<()> {
        let who = self.current_user();
        let (uid, uname) = match who {
            Some(u) => (Some(u.id), u.name),
            None => (None, String::new()),
        };
        conn.execute(
            "INSERT INTO cash_movements
                (type, method, currency, amount, sign, reference, sale_id, service_id, payment_id, expense_id, user_id, user_name, note, date, day)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     COALESCE(?14, datetime('now','localtime')),
                     COALESCE(date(?14), date('now','localtime')))",
            params![
                mv.r#type, mv.method, mv.currency, mv.amount, mv.sign, mv.reference,
                mv.sale_id, mv.service_id, mv.payment_id, mv.expense_id, uid, uname, mv.note,
                mv.when.filter(|w| !w.trim().is_empty())
            ],
        )?;
        Ok(())
    }

    /// F69 (revisión adversarial, MAYOR) — CONTRA-ASIENTO ESPEJO: busca en el libro el movimiento
    /// original de un cobro o de un gasto y escribe su opuesto (mismo monto —el NETO que se anotó—,
    /// mismo método, misma moneda y signo invertido). Así el par suma CERO y el arqueo no inventa
    /// plata: antes el borrado de un cobro iba con el BRUTO y sin método (borrar un cobro en efectivo
    /// no bajaba el esperado del cajón) y el de un gasto perdía el método declarado.
    fn reverse_book_entry(&self, conn: &Connection, por_pago: Option<i64>, por_gasto: Option<i64>, note: &str) -> SqlResult<()> {
        let original: Option<(String, String, String, f64, i64, String, String)> = conn
            .query_row(
                "SELECT type, method, currency, amount, sign, date, day FROM cash_movements
                 WHERE (?1 IS NOT NULL AND payment_id = ?1) OR (?2 IS NOT NULL AND expense_id = ?2)
                 ORDER BY id DESC LIMIT 1",
                params![por_pago, por_gasto],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .optional()?;
        let Some((tipo, metodo, moneda, monto, signo, fecha_original, _dia_original)) = original else {
            return Ok(()); // sin movimiento en el libro (dato viejo o borrado dos veces): nada que espejar
        };
        let tipo_anulado = format!("{}_anulado", tipo.trim_end_matches("_anulado"));
        self.book_movement(conn, &NewCashMovement {
            r#type: &tipo_anulado,
            method: &metodo,
            currency: &moneda,
            amount: monto,
            sign: -signo,
            reference: "",
            sale_id: None,
            service_id: None,
            payment_id: por_pago,
            expense_id: por_gasto,
            note,
            // F69 (bug cazado en la 2ª corrida en vivo): el contra-asiento va al DÍA DEL MOVIMIENTO
            // ORIGINAL, no al de hoy. Si el gasto era del 21 y se borra el 23, el asiento espejo caía
            // en el 23: el 21 seguía descontando ese gasto del cajón para siempre y el 23 se llevaba
            // un «+20» de un gasto que nunca tuvo. Se copia la fecha original tal cual.
            when: Some(&fecha_original),
        })
    }

    /// F68 — el libro de plata, filtrado. `user_id` = sólo lo de esa persona (la sesión de caja
    /// usa SU id para ver sólo su día, y también las filas del NEGOCIO sin autor — historia vieja
    /// o movimientos que no son de nadie en particular: si no, el día de la cajera saldría
    /// incompleto); `None` = todo (el Master).
    pub fn get_cash_movements(&self, start_date: &str, end_date: &str, user_id: Option<i64>, limit: i64)
        -> SqlResult<Vec<CashMovement>> {
        let conn = self.conn.lock().unwrap();
        let desde = if start_date.is_empty() { "0000-01-01" } else { start_date };
        let hasta = if end_date.is_empty() { "9999-12-31" } else { end_date };
        let mut stmt = conn.prepare(
            "SELECT id, date, day, type, method, currency, amount, sign, reference,
                    sale_id, service_id, payment_id, expense_id, user_id, user_name, note
             FROM cash_movements
             WHERE day >= ?1 AND day <= ?2 AND (?3 IS NULL OR user_id = ?3 OR user_id IS NULL)
             ORDER BY id DESC LIMIT ?4",
        )?;
        let rows = stmt.query_map(params![desde, hasta, user_id, limit.clamp(1, 2000)], |r| {
            Ok(CashMovement {
                id: r.get(0)?,
                date: r.get(1)?,
                day: r.get(2)?,
                r#type: r.get(3)?,
                method: r.get(4)?,
                currency: r.get(5)?,
                amount: r.get(6)?,
                sign: r.get(7)?,
                reference: r.get(8)?,
                sale_id: r.get(9)?,
                service_id: r.get(10)?,
                payment_id: r.get(11)?,
                expense_id: r.get(12)?,
                user_id: r.get(13)?,
                user_name: r.get(14)?,
                note: r.get(15)?,
            })
        })?;
        // F69 (revisión adversarial): una fila que no se puede leer NO se descarta en silencio — el
        // libro del día saldría incompleto sin ningún aviso y el arqueo se explicaría con menos
        // movimientos de los que hay. Se avisa por consola (el llamador igual recibe el resto).
        let mut salida = Vec::new();
        for r in rows {
            match r {
                Ok(m) => salida.push(m),
                Err(e) => eprintln!("[registro] movimiento del libro ilegible (se omite): {e}"),
            }
        }
        Ok(salida)
    }

    /// F68 — resumen del libro por persona en un rango (para la pantalla del Master):
    /// cuántos movimientos y cuánto neto por moneda. Es informativo y NO recalcula la caja.
    pub fn get_cash_movements_by_user(&self, start_date: &str, end_date: &str) -> SqlResult<Vec<(String, i64, f64, f64)>> {
        let conn = self.conn.lock().unwrap();
        let desde = if start_date.is_empty() { "0000-01-01" } else { start_date };
        let hasta = if end_date.is_empty() { "9999-12-31" } else { end_date };
        let mut stmt = conn.prepare(
            "SELECT CASE WHEN COALESCE(user_name,'')='' THEN '(sin asignar)' ELSE user_name END AS quien,
                    COUNT(*) n,
                    COALESCE(SUM(CASE WHEN currency='USD' THEN amount*sign ELSE 0 END),0) usd,
                    COALESCE(SUM(CASE WHEN currency<>'USD' THEN amount*sign ELSE 0 END),0) bs
             FROM cash_movements WHERE day >= ?1 AND day <= ?2
             GROUP BY quien ORDER BY quien",
        )?;
        let rows = stmt.query_map(params![desde, hasta], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    fn init(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT
            );
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category_id INTEGER REFERENCES categories(id),
                brand TEXT,
                model TEXT,
                variant TEXT,
                compatibility TEXT,
                price_cost REAL DEFAULT 0,
                price_sale REAL DEFAULT 0,
                stock INTEGER DEFAULT 0,
                min_stock INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                notes TEXT,
                total_spent REAL DEFAULT 0,
                last_service TEXT,
                last_purchase TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT DEFAULT (datetime('now','localtime')),
                product_id INTEGER REFERENCES products(id),
                product_name TEXT,
                quantity INTEGER DEFAULT 1,
                unit_price REAL,
                total REAL,
                payment_method TEXT,
                client_name TEXT,
                client_id INTEGER REFERENCES clients(id),
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_num TEXT UNIQUE,
                date_in TEXT DEFAULT (datetime('now','localtime')),
                client TEXT,
                phone TEXT,
                model TEXT,
                fault TEXT,
                amount REAL DEFAULT 0,
                payment_method TEXT,
                date_out TEXT,
                status TEXT DEFAULT 'Por entregar',
                observations TEXT,
                color TEXT,
                printed INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS inventory_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT DEFAULT (datetime('now','localtime')),
                product_id INTEGER REFERENCES products(id),
                type TEXT CHECK(type IN ('entrada','salida')),
                quantity INTEGER,
                reason TEXT,
                reference TEXT
            );
            CREATE TABLE IF NOT EXISTS payment_methods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS service_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id INTEGER REFERENCES services(id),
                amount REAL DEFAULT 0,
                payment_method TEXT,
                bank_fee_percent REAL DEFAULT 0,
                bank_fee_amount REAL DEFAULT 0,
                net_amount REAL DEFAULT 0,
                zelle_reference TEXT,
                currency TEXT DEFAULT 'USD',
                payment_date TEXT DEFAULT (datetime('now','localtime')),
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS purchase_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_date TEXT DEFAULT (datetime('now','localtime')),
                supplier TEXT,
                status TEXT DEFAULT 'Pendiente',
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS purchase_order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER REFERENCES purchase_orders(id),
                product_id INTEGER REFERENCES products(id),
                product_name TEXT,
                quantity INTEGER DEFAULT 1,
                unit_price REAL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS service_statuses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS daily_closings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                close_date TEXT NOT NULL UNIQUE,
                pos_charged REAL DEFAULT 0,
                pos_fees REAL DEFAULT 0,
                pos_net REAL DEFAULT 0,
                pos_settled REAL DEFAULT 0,
                cash_usd REAL DEFAULT 0,
                cash_bs REAL DEFAULT 0,
                zelle_total REAL DEFAULT 0,
                pago_movil_total REAL DEFAULT 0,
                transfer_bs_total REAL DEFAULT 0,
                usd_cash_total REAL DEFAULT 0,
                grand_total REAL DEFAULT 0,
                is_closed INTEGER DEFAULT 0,
                closed_at TEXT,
                notes TEXT,
                tasa_bcv REAL DEFAULT 0,
                tasa_eur REAL DEFAULT 0,
                opened_at TEXT,
                initial_cash_usd REAL DEFAULT 0,
                actual_cash_usd REAL DEFAULT 0,
                actual_cash_bs REAL DEFAULT 0,
                actual_punto_usd REAL DEFAULT 0,
                actual_punto_bs REAL DEFAULT 0,
                actual_zelle REAL DEFAULT 0,
                actual_pago_movil REAL DEFAULT 0,
                actual_transfer_bs REAL DEFAULT 0,
                difference REAL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                expense_date TEXT NOT NULL DEFAULT (date('now','localtime')),
                category TEXT NOT NULL DEFAULT 'Otro',
                amount REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );
            -- F68 — SESIONES DE CAJA: una fila por PERSONA que usa la app (Master = dueño,
            -- caja = operario de caja). El PIN de cada una es su propia llave (hash PBKDF2, igual
            -- que settings.pin); `key_legacy` del dueño sigue viviendo en settings.pin para no
            -- romper las instalaciones viejas (al migrar se copia a la fila Master).
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL DEFAULT 'caja' CHECK(role IN ('master','caja')),
                pin_hash TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );
            -- F68/F40 — LIBRO ÚNICO DE MOVIMIENTOS DE PLATA: cada movimiento de dinero de la app
            -- (venta, abono, devolución, gasto, apertura, cierre…) se anota ACÁ con su AUTOR.
            -- Es la base de «quién hizo qué» y, en F69, del esperado de la caja (una sola fuente en
            -- vez de ir sumando tablas). `user_name` va desnormalizado a propósito: el histórico no
            -- puede depender de que el usuario siga existiendo.
            CREATE TABLE IF NOT EXISTS cash_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                day TEXT NOT NULL DEFAULT (date('now','localtime')),
                type TEXT NOT NULL,
                method TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT 'USD',
                amount REAL NOT NULL DEFAULT 0,
                sign INTEGER NOT NULL DEFAULT 1,
                reference TEXT NOT NULL DEFAULT '',
                sale_id INTEGER,
                service_id INTEGER,
                payment_id INTEGER,
                expense_id INTEGER,
                user_id INTEGER,
                user_name TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_cash_movements_day ON cash_movements(day);
            CREATE INDEX IF NOT EXISTS idx_cash_movements_user ON cash_movements(user_id);
        ")?;

        // F68 — la fila Master nace con el PIN que ya tenía la instalación (si había): el dueño
        // sigue entrando con SU PIN y las instalaciones nuevas arrancan sin PIN (un solo usuario).
        // F69: si esto fallara, la app tiene que ABRIR igual (el padrón de personas es una comodidad,
        // no un requisito para vender): se avisa por consola y se sigue.
        if let Err(e) = self.ensure_master_user(&conn) {
            eprintln!("[registro] no se pudo preparar la fila Master del padrón: {e}");
        }

        // Migration: add client_id to sales if missing
        let has_client_id: bool = conn
            .prepare("SELECT client_id FROM sales LIMIT 1")
            .is_ok();
        if !has_client_id {
            let _ = conn.execute_batch("ALTER TABLE sales ADD COLUMN client_id INTEGER REFERENCES clients(id);");
        }

        // Migration: add payment tracking columns to sales
        let has_bank_fee: bool = conn.prepare("SELECT bank_fee_percent FROM sales LIMIT 1").is_ok();
        if !has_bank_fee {
            let _ = conn.execute_batch("
                ALTER TABLE sales ADD COLUMN bank_fee_percent REAL DEFAULT 0;
                ALTER TABLE sales ADD COLUMN bank_fee_amount REAL DEFAULT 0;
                ALTER TABLE sales ADD COLUMN net_amount REAL;
                ALTER TABLE sales ADD COLUMN zelle_reference TEXT;
                ALTER TABLE sales ADD COLUMN currency TEXT DEFAULT 'USD';
            ");
        }
        // Migration: add payment tracking columns to services
        let has_svc_fee: bool = conn.prepare("SELECT bank_fee_percent FROM services LIMIT 1").is_ok();
        if !has_svc_fee {
            let _ = conn.execute_batch("
                ALTER TABLE services ADD COLUMN bank_fee_percent REAL DEFAULT 0;
                ALTER TABLE services ADD COLUMN bank_fee_amount REAL DEFAULT 0;
                ALTER TABLE services ADD COLUMN net_amount REAL;
                ALTER TABLE services ADD COLUMN zelle_reference TEXT;
                ALTER TABLE services ADD COLUMN currency TEXT DEFAULT 'USD';
            ");
        }
        // Migration: add service_type to services
        let has_svc_type: bool = conn.prepare("SELECT service_type FROM services LIMIT 1").is_ok();
        if !has_svc_type {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN service_type TEXT;");
        }
        // Migration: add service_types (JSON array de todos los trabajos/fallas) a services
        // Almacena TODOS los tipos del servicio (ej. ["Cambio pantalla","Cambio conector / puerto"]).
        // service_type queda como el primario (primero elegido) para compatibilidad.
        let has_svc_types: bool = conn.prepare("SELECT service_types FROM services LIMIT 1").is_ok();
        if !has_svc_types {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN service_types TEXT;");
            // Backfill idempotente: [service_type] o [] en filas existentes
            let mut st = conn.prepare("SELECT id, service_type FROM services").unwrap();
            let rows: Vec<(i64, Option<String>)> = st
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map(|rows| rows.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();
            for (id, primary) in rows {
                let json = match primary {
                    Some(t) if !t.trim().is_empty() => serde_json::to_string(&vec![t.trim()]).unwrap_or_else(|_| "[]".to_string()),
                    _ => "[]".to_string(),
                };
                let _ = conn.execute("UPDATE services SET service_types=?1 WHERE id=?2", params![json, id]);
            }
        }
        // Migration: technicians (técnicos) + asignación en services
        // technicians: nombre único editable + iniciales + color de marca (clase Tailwind bg-*).
        // services.technician = snapshot del nombre (sobrevive al borrado del técnico),
        // services.technician_id = ref para resolver color/iniciales (si el técnico se borra,
        // la marca cae a gris pero el nombre persiste — patrón denormalizado de client/client_id).
        let has_technicians: bool = conn.prepare("SELECT id FROM technicians LIMIT 1").is_ok();
        if !has_technicians {
            let _ = conn.execute_batch("
                CREATE TABLE IF NOT EXISTS technicians (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    initials TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT 'bg-slate-500'
                );
                INSERT INTO technicians (name, initials, color) VALUES ('Aldri', 'A', 'bg-purple-500'), ('William', 'W', 'bg-blue-500');
            ");
        }
        let has_tech_col: bool = conn.prepare("SELECT technician FROM services LIMIT 1").is_ok();
        if !has_tech_col {
            let _ = conn.execute_batch("
                ALTER TABLE services ADD COLUMN technician TEXT;
                ALTER TABLE services ADD COLUMN technician_id INTEGER;
            ");
        }
        // Migration: add client data + device checklist to services
        let has_client_ci: bool = conn.prepare("SELECT client_ci FROM services LIMIT 1").is_ok();
        if !has_client_ci {
            let _ = conn.execute_batch("
                ALTER TABLE services ADD COLUMN client_ci TEXT;
                ALTER TABLE services ADD COLUMN client_address TEXT;
                ALTER TABLE services ADD COLUMN device_checklist TEXT;
            ");
        }
        // F69 — DE DÓNDE SALIÓ LA PLATA de un gasto (`Divisas (USD Cash)` / `Efectivo Bs` = del cajón;
        // el resto = banco/otros; vacío = sin declarar). Es lo que permite que el arqueo descuente los
        // gastos pagados del cajón en vez de decir «faltan Bs. X» en un día perfecto.
        // AL FINAL del orden físico (regla de siempre: mover una columna rompe el mapping posicional).
        let has_expense_method: bool = conn.prepare("SELECT method FROM expenses LIMIT 1").is_ok();
        if !has_expense_method {
            let _ = conn.execute_batch("ALTER TABLE expenses ADD COLUMN method TEXT DEFAULT '';");
        }
        // F69 — el AJUSTE DEL CAJÓN que se usó al cerrar (fondo + gastos/retiros del cajón), guardado
        // para que un cierre viejo siga explicándose solo (invariante: un cierre guardado no se recalcula).
        let has_drawer_adjust: bool = conn.prepare("SELECT drawer_adjust_usd FROM daily_closings LIMIT 1").is_ok();
        if !has_drawer_adjust {
            let _ = conn.execute_batch("
                ALTER TABLE daily_closings ADD COLUMN drawer_adjust_usd REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN drawer_adjust_bs REAL DEFAULT 0;
            ");
        }
        // Migration: add ci + address to clients
        let has_client_ci_col: bool = conn.prepare("SELECT ci FROM clients LIMIT 1").is_ok();
        if !has_client_ci_col {
            let _ = conn.execute_batch("
                ALTER TABLE clients ADD COLUMN ci TEXT;
                ALTER TABLE clients ADD COLUMN address TEXT;
            ");
        }
        // Migration: daily shift (open/close day) with BCV rate + actual count (arqueo)
        let has_tasa: bool = conn.prepare("SELECT tasa_bcv FROM daily_closings LIMIT 1").is_ok();
        if !has_tasa {
            let _ = conn.execute_batch("
                ALTER TABLE daily_closings ADD COLUMN tasa_bcv REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN tasa_eur REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN opened_at TEXT;
                ALTER TABLE daily_closings ADD COLUMN initial_cash_usd REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN actual_cash_usd REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN actual_cash_bs REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN actual_punto_usd REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN actual_punto_bs REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN actual_zelle REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN actual_pago_movil REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN actual_transfer_bs REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN difference REAL DEFAULT 0;
            ");
        }
        // Migration: payments/abonos for services + client link
        let has_payments: bool = conn.prepare("SELECT id FROM service_payments LIMIT 1").is_ok();
        if !has_payments {
            let _ = conn.execute_batch("
                CREATE TABLE IF NOT EXISTS service_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service_id INTEGER REFERENCES services(id),
                    amount REAL DEFAULT 0,
                    payment_method TEXT,
                    bank_fee_percent REAL DEFAULT 0,
                    bank_fee_amount REAL DEFAULT 0,
                    net_amount REAL DEFAULT 0,
                    zelle_reference TEXT,
                    currency TEXT DEFAULT 'USD',
                    payment_date TEXT DEFAULT (datetime('now','localtime')),
                    notes TEXT
                );
            ");
        }
        let has_svc_client_id: bool = conn.prepare("SELECT client_id FROM services LIMIT 1").is_ok();
        if !has_svc_client_id {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN client_id INTEGER REFERENCES clients(id);");
        }
        let has_paid_amount: bool = conn.prepare("SELECT paid_amount FROM services LIMIT 1").is_ok();
        if !has_paid_amount {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN paid_amount REAL DEFAULT 0;");
        }
        // Migration: órdenes multi-equipo (un cliente trae varios teléfonos → filas con group_id compartido)
        let has_group_id: bool = conn.prepare("SELECT group_id FROM services LIMIT 1").is_ok();
        if !has_group_id {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN group_id TEXT;");
        }
        // Migration: factura de servicio — color del equipo (identifica el teléfono al entregar)
        // y printed (0 = factura pendiente de imprimir → badge "Sin imprimir" en la tarjeta).
        let has_color: bool = conn.prepare("SELECT color FROM services LIMIT 1").is_ok();
        if !has_color {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN color TEXT;");
        }
        let has_printed: bool = conn.prepare("SELECT printed FROM services LIMIT 1").is_ok();
        if !has_printed {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN printed INTEGER NOT NULL DEFAULT 0;");
        }
        // Migration: pantalla EXACTA a instalar (inventario exacto de pantallas — 2026-08-12).
        // La orden guarda el producto de pantalla elegido por el técnico (desplegable de
        // compatibilidad); al entregar se descuenta SOLO ese producto. Sin FK (patrón
        // technician_id) para no romper la importación de respaldos.
        let has_screen_product_id: bool = conn.prepare("SELECT screen_product_id FROM services LIMIT 1").is_ok();
        if !has_screen_product_id {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN screen_product_id INTEGER;");
        }
        // Migration: PRECIO DOBLE (precio en divisa / efectivo $) — 2026-08-14.
        // products.price_usd = precio sugerido cuando el cliente paga en efectivo $ (con descuento);
        // services/sales.discount_amount = descuento total aplicado (amount/total guardan lo REALMENTE cobrado).
        let has_price_usd: bool = conn.prepare("SELECT price_usd FROM products LIMIT 1").is_ok();
        if !has_price_usd {
            let _ = conn.execute_batch("ALTER TABLE products ADD COLUMN price_usd REAL NOT NULL DEFAULT 0;");
        }
        // Migration: `categories.description` (F65, 2026-09-23). La columna viaja en el CREATE TABLE
        // desde el principio, pero una base instalada ANTES de que existiera la tiene sin ella (la
        // guarda es `SELECT description … LIMIT 1`: falla si la columna no está). Sin esta migración,
        // leer las categorías de esa instalación fallaba y el frontend caía a su mock
        // (`[{Pantalla}]`): el local veía UNA sola categoría y no había forma de arreglarlo desde la
        // pantalla. La columna va al FINAL (patrón de siempre: mover una columna rompe el orden físico).
        let has_cat_description: bool = conn.prepare("SELECT description FROM categories LIMIT 1").is_ok();
        if !has_cat_description {
            let _ = conn.execute_batch("ALTER TABLE categories ADD COLUMN description TEXT;");
        }
        let has_svc_discount: bool = conn.prepare("SELECT discount_amount FROM services LIMIT 1").is_ok();
        if !has_svc_discount {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;");
        }
        let has_sale_discount: bool = conn.prepare("SELECT discount_amount FROM sales LIMIT 1").is_ok();
        if !has_sale_discount {
            let _ = conn.execute_batch("ALTER TABLE sales ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;");
        }
        // F70 — ANULACIÓN DE UNA VENTA (`void_sale`): la venta no se borra, se marca. Las dos columnas
        // se APENDAN al final del orden físico (misma regla que `discount_amount`/`photo_in_at`: los
        // SELECTs son listas explícitas y una columna movida rompe el mapping posicional).
        {
            let has_voided_at: bool = conn.prepare("SELECT voided_at FROM sales LIMIT 1").is_ok();
            if !has_voided_at {
                let _ = conn.execute_batch("ALTER TABLE sales ADD COLUMN voided_at TEXT;");
            }
            let has_void_reason: bool = conn.prepare("SELECT void_reason FROM sales LIMIT 1").is_ok();
            if !has_void_reason {
                let _ = conn.execute_batch("ALTER TABLE sales ADD COLUMN void_reason TEXT;");
            }
        }
        // Migration: SEÑALES DE POLÍTICA del taller (F32) — foto de ENTRADA, foto de SALIDA y
        // acuerdo de pago (paga ahora o al retirar). Son ANOTACIONES informativas de los
        // recordatorios del operario: NO afectan montos, stock ni cierres y las escribe
        // únicamente el comando `set_service_policy`. Se apendan al FINAL del orden físico de
        // columnas → en los SELECT hay que listarlas explícitas y en el MISMO orden (nunca
        // `SELECT s.*`: lección InvalidColumnType).
        let has_photo_in: bool = conn.prepare("SELECT photo_in_at FROM services LIMIT 1").is_ok();
        if !has_photo_in {
            let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN photo_in_at TEXT;");
        }
        {
            let has_photo_out: bool = conn.prepare("SELECT photo_out_at FROM services LIMIT 1").is_ok();
            if !has_photo_out {
                let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN photo_out_at TEXT;");
            }
            let has_pay_intent: bool = conn.prepare("SELECT pay_intent FROM services LIMIT 1").is_ok();
            if !has_pay_intent {
                let _ = conn.execute_batch("ALTER TABLE services ADD COLUMN pay_intent TEXT;");
            }
        }
        // Migration: EL IVA POR FILA (F74, 2026-09-25). Cada venta y cada orden guarda con qué
        // ALÍCUOTA y en qué MODO se cargó (`agregado` = se sumó al cobrar · `incluido` = ya venía en
        // el precio · '' = sin IVA). El monto (`sales.total` / `services.amount`) sigue siendo LO QUE
        // PAGA EL CLIENTE, así que la caja, el arqueo y los saldos no cambian de significado: la base
        // y el IVA se despejan de ese total con la alícuota de la fila (`src/lib/iva.ts`), y cambiar
        // la alícuota hoy NO reescribe el IVA de una operación vieja.
        // Las 4 columnas se APENDAN al FINAL del orden físico (regla InvalidColumnType: los SELECT
        // son listas explícitas y una columna movida rompe el mapping posicional).
        {
            let has_sale_iva: bool = conn.prepare("SELECT iva_rate FROM sales LIMIT 1").is_ok();
            if !has_sale_iva {
                let _ = conn.execute_batch(
                    "ALTER TABLE sales ADD COLUMN iva_rate REAL NOT NULL DEFAULT 0;
                     ALTER TABLE sales ADD COLUMN iva_mode TEXT NOT NULL DEFAULT '';",
                );
            }
            let has_svc_iva: bool = conn.prepare("SELECT iva_rate FROM services LIMIT 1").is_ok();
            if !has_svc_iva {
                let _ = conn.execute_batch(
                    "ALTER TABLE services ADD COLUMN iva_rate REAL NOT NULL DEFAULT 0;
                     ALTER TABLE services ADD COLUMN iva_mode TEXT NOT NULL DEFAULT '';",
                );
            }
        }
        // Migration: TEXTO DE BÚSQUEDA normalizado (2026-09-15).
        // El catálogo se guarda canónico ("Xiaomi Redmi Note 11"), pero el operario
        // sigue escribiendo como antes ("Red Note"). search_text = nombre+marca+modelo+
        // variante+compatibilidad normalizados (sin acentos/puntuación, minúsculas) y la
        // búsqueda exige TODOS los tokens del texto escrito → "red note" encuentra
        // "xiaomi redmi note 11" (red ⊂ redmi).
        let has_search_text: bool = conn.prepare("SELECT search_text FROM products LIMIT 1").is_ok();
        if !has_search_text {
            let _ = conn.execute_batch("ALTER TABLE products ADD COLUMN search_text TEXT;");
        }
        // PROVEEDOR de la mercancía (F29): el local quiere saber quién le trajo cada pantalla
        // que entra. Se llena al cargar el inventario (y se puede corregir en la ficha del
        // producto). Columna nueva al FINAL del orden físico: NUNCA usar SELECT * posicional.
        let has_supplier: bool = conn.prepare("SELECT supplier FROM products LIMIT 1").is_ok();
        if !has_supplier {
            let _ = conn.execute_batch("ALTER TABLE products ADD COLUMN supplier TEXT;");
        }
        {
            let pending: Vec<(i64, String, String, String, String, String)> = {
                let mut stmt = conn.prepare(
                    "SELECT id, COALESCE(name,''), COALESCE(brand,''), COALESCE(model,''),
                            COALESCE(variant,''), COALESCE(compatibility,'')
                     FROM products WHERE search_text IS NULL OR search_text=''",
                )?;
                let rows = stmt.query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
                })?;
                rows.collect::<SqlResult<Vec<_>>>()?
            };
            for (id, name, brand, model, variant, compatibility) in pending {
                let text = crate::catalog::search_text(&name, &brand, &model, &variant, &compatibility);
                let _ = conn.execute("UPDATE products SET search_text=?1 WHERE id=?2", params![text, id]);
            }
        }
        // ── F50: «LO QUE USO» + CÓDIGOS DE REFERENCIA ─────────────────────────────────────────
        // Pedido del dueño: «él no lo usa todo; aplicar un check con su número de cada producto o
        // modelo que él pueda seleccionar: esos son los que le van a aparecer cuando registra un
        // servicio… así es más rápida la búsqueda». El check va en los DOS (producto y modelo) y el
        // número sirve para identificarlos rápido y ver la relación modelo ↔ pantalla.
        // Columnas nuevas AL FINAL del orden físico (regla del proyecto: nunca SELECT * posicional).
        // OJO — CADA TABLA SE MIGRA DONDE SU TABLA YA EXISTE. La de `phones` va MÁS ABAJO (después de
        // su `CREATE TABLE IF NOT EXISTS`): en una base nueva esa tabla todavía no existe acá y el
        // ALTER dentro del mismo batch fallaba en silencio (`let _ =`) dejando la base a medias
        // («no such column: code» en la primera consulta del padrón). Y cada columna se prueba por
        // separado: si una ya existe, las otras igual entran.
        let products_cols_new: bool = conn.prepare("SELECT in_use FROM products LIMIT 1").is_err();
        if products_cols_new {
            let _ = conn.execute("ALTER TABLE products ADD COLUMN in_use INTEGER DEFAULT 1", []);
        }
        if conn.prepare("SELECT code FROM products LIMIT 1").is_err() {
            let _ = conn.execute("ALTER TABLE products ADD COLUMN code TEXT", []);
        }
        if products_cols_new {
            // SEED (una sola vez, en la misma migración que crea las columnas): queda EN USO lo que
            // tiene stock cargado — es lo que el taller realmente tiene en el cajón — y se apaga el
            // resto. Así la búsqueda del servicio se acorta desde el primer día sin que el dueño
            // tenga que marcar cientos de fichas; después prende/apaga lo que quiera a mano.
            let _ = conn.execute_batch("UPDATE products SET in_use = CASE WHEN stock > 0 THEN 1 ELSE 0 END;");
        }
        // Códigos cortos y secuenciales por id: P-0001 / M-0001 (el local los puede dictar).
        // Filas nuevas sin código (por si alguien insertó a mano): se completa sin pisar lo que haya.
        let _ = conn.execute_batch("UPDATE products SET code = 'P-' || printf('%04d', id) WHERE code IS NULL OR code = '';");
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
             CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
             CREATE INDEX IF NOT EXISTS idx_products_model ON products(model);
             CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);",
        );

        // Padrón de TELÉFONOS (2026-09-15): nombre comercial real + clave ÚNICA.
        // Nace de la compatibilidad del catálogo (los MISMOS modelos que se eligen al
        // registrar un servicio) y es editable desde la app (renombrar / fusionar).
        //   key = norm(marca) + '|' + norm(modelo sin línea)  → 0 duplicados
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS phones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand TEXT NOT NULL,
                line TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL,
                name TEXT NOT NULL,
                key TEXT NOT NULL UNIQUE,
                aliases TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'catalogo',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_phones_key ON phones(key);
            CREATE INDEX IF NOT EXISTS idx_phones_brand ON phones(brand);",
        )?;
        // migración idempotente: columna de "nombre por revisar" (sin familia)
        if conn.prepare("SELECT needs_review FROM phones LIMIT 1").is_err() {
            let _ = conn.execute_batch("ALTER TABLE phones ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;");
        }
        // primera carga: si el padrón está vacío se arma desde el catálogo
        let phones_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM phones", [], |r| r.get(0))
            .unwrap_or(0);
        if phones_count == 0 {
            let _ = crate::catalog::rebuild_phones(&conn, false);
        }
        // ── F50 (continuación): «LO QUE USO» + CÓDIGO en el PADRÓN de teléfonos ───────────────
        // Recién ACÁ existe la tabla `phones` (el bloque de arriba corre antes de su CREATE TABLE).
        // Columnas nuevas AL FINAL del orden físico; se prueba cada una por separado.
        let phones_cols_new: bool = conn.prepare("SELECT in_use FROM phones LIMIT 1").is_err();
        if phones_cols_new {
            let _ = conn.execute("ALTER TABLE phones ADD COLUMN in_use INTEGER DEFAULT 0", []);
        }
        if conn.prepare("SELECT code FROM phones LIMIT 1").is_err() {
            let _ = conn.execute("ALTER TABLE phones ADD COLUMN code TEXT", []);
        }
        if conn.prepare("SELECT default_product_id FROM phones LIMIT 1").is_err() {
            let _ = conn.execute("ALTER TABLE phones ADD COLUMN default_product_id INTEGER", []);
        }
        // Filas nuevas sin código (el padrón se rearma desde el catálogo / alguien inserta a mano):
        // se numera lo que falte sin pisar los códigos que ya están (el local los usa para hablar).
        let _ = conn.execute_batch("UPDATE phones SET code = 'M-' || printf('%04d', id) WHERE code IS NULL OR code = '';");
        if phones_cols_new {
            // Un teléfono queda EN USO si alguno de sus repuestos quedó en uso (misma fuente que el
            // padrón: la compatibilidad ya indexada en `phones.key`). Una sola vez: después manda el
            // check del dueño, que puede apagar un modelo sin que el arranque se lo vuelva a prender.
            let _ = crate::phones::seed_phone_in_use(&conn);
        }
        // Migration: pagos con método Bs registrados como USD (bug moneda del frontend).
        // La moneda SIEMPRE se deriva del método: Efectivo Bs/Pago Móvil/Transf Bs/Punto (Bs) → VES.
        if conn.prepare("SELECT id FROM service_payments LIMIT 1").is_ok() {
            for m in BS_METHODS {
                let _ = conn.execute(
                    "UPDATE service_payments SET currency='VES' WHERE payment_method=?1 AND (currency IS NULL OR currency='USD')",
                    params![m],
                );
            }
            // Recalcular paid_amount de TODOS los servicios (idempotente).
            // F36: la regla vive en UN SOLO lugar (`recalc_paid_amount` → neto por moneda). Antes acá
            // había un UPDATE con la fórmula vieja («convertir cada movimiento con la tasa de su día»)
            // y como esto corre en CADA ARRANQUE, reescribía todos los saldos con la regla vieja: el
            // mismo saldo valía distinto según cuál fue la última acción (bloqueante de la revisión
            // adversarial de F36). Ahora se llama a la ÚNICA implementación de la regla.
            let ids: Vec<i64> = {
                let mut stmt = conn.prepare("SELECT id FROM services")?;
                let filas = stmt.query_map([], |r| r.get(0))?;
                filas.filter_map(|r| r.ok()).collect()
            };
            for id in ids {
                let _ = self.recalc_paid_amount(&conn, id);
            }       }
        // Migration: purchase orders (pedidos a proveedor)
        let has_purchase_orders: bool = conn.prepare("SELECT id FROM purchase_orders LIMIT 1").is_ok();
        if !has_purchase_orders {
            let _ = conn.execute_batch("
                CREATE TABLE IF NOT EXISTS purchase_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_date TEXT DEFAULT (datetime('now','localtime')),
                    supplier TEXT,
                    status TEXT DEFAULT 'Pendiente',
                    notes TEXT
                );
                CREATE TABLE IF NOT EXISTS purchase_order_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER REFERENCES purchase_orders(id),
                    product_id INTEGER REFERENCES products(id),
                    product_name TEXT,
                    quantity INTEGER DEFAULT 1,
                    unit_price REAL DEFAULT 0
                );
            ");
        }
        // Migration: desglose por moneda en cierres (total_usd/total_bs) — bug: grand_total sumaba Bs como USD
        let has_total_usd: bool = conn.prepare("SELECT total_usd FROM daily_closings LIMIT 1").is_ok();
        if !has_total_usd {
            let _ = conn.execute_batch("
                ALTER TABLE daily_closings ADD COLUMN total_usd REAL DEFAULT 0;
                ALTER TABLE daily_closings ADD COLUMN total_bs REAL DEFAULT 0;
            ");
        }
        // Migration: monto impreso por el Punto en Bs (pos_settled_bs) — el sistema debe dar el mismo monto que imprime la máquina
        let has_pos_settled_bs: bool = conn.prepare("SELECT pos_settled_bs FROM daily_closings LIMIT 1").is_ok();
        if !has_pos_settled_bs {
            let _ = conn.execute("ALTER TABLE daily_closings ADD COLUMN pos_settled_bs REAL DEFAULT 0", []);
        }
        // Corrección de moneda histórica: ventas/servicios con método Bs guardados como USD (bug frontend viejo)
        for m in BS_METHODS {
            let _ = conn.execute(
                "UPDATE sales SET currency='VES' WHERE payment_method=?1 AND (currency IS NULL OR currency='USD')",
                params![m],
            );
            let _ = conn.execute(
                "UPDATE services SET currency='VES' WHERE payment_method=?1 AND (currency IS NULL OR currency='USD')",
                params![m],
            );
        }
        // Recalcular totales históricos de cierres con la moneda real (idempotente; tasa del propio cierre)
        // Primero: cierres con tasa 0 heredan la del último cierre anterior con tasa > 0
        // (bug: abrir/cerrar el día sin tasa dejaba equivalentes USD rotos)
        let zero_tasa_dates: Vec<String> = {
            let mut stmt = conn.prepare("SELECT close_date FROM daily_closings WHERE is_closed=1 AND (tasa_bcv IS NULL OR tasa_bcv <= 0) ORDER BY close_date ASC")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut v = Vec::new();
            for r in rows { v.push(r?); }
            v
        };
        for d in &zero_tasa_dates {
            let prev_tasa: Option<f64> = conn.query_row(
                "SELECT tasa_bcv FROM daily_closings WHERE close_date < ?1 AND tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1",
                params![d], |r| r.get(0),
            ).optional()?;
            if let Some(t) = prev_tasa {
                let _ = conn.execute(
                    "UPDATE daily_closings SET tasa_bcv=?1 WHERE close_date=?2 AND is_closed=1",
                    params![t, d],
                );
            }
        }
        let closed_dates: Vec<String> = {
            let mut stmt = conn.prepare("SELECT close_date FROM daily_closings WHERE is_closed=1")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut v = Vec::new();
            for r in rows { v.push(r?); }
            v
        };
        for d in &closed_dates {
            if let Ok(ts) = self.compute_daily_totals(&conn, d, d) {
                if let Some(t0) = ts.first() {
                    let tasa = t0.tasa_bcv;
                    let gt = t0.grand_usd + if tasa > 0.0 { t0.grand_bs / tasa } else { 0.0 };
                    let _ = conn.execute(
                        "UPDATE daily_closings SET total_usd=?1, total_bs=?2, grand_total=?3 WHERE close_date=?4 AND is_closed=1",
                        params![t0.grand_usd, t0.grand_bs, gt, d],
                    );
                }
            }
        }

        let defaults = [
            ("INSERT OR IGNORE INTO categories (name) VALUES ('Pantalla')",),
            ("INSERT OR IGNORE INTO categories (name) VALUES ('Teléfono')",),
            ("INSERT OR IGNORE INTO categories (name) VALUES ('Accesorio')",),
            ("INSERT OR IGNORE INTO categories (name) VALUES ('Repuesto')",),
            ("INSERT OR IGNORE INTO categories (name) VALUES ('Batería')",),
            ("INSERT OR IGNORE INTO categories (name) VALUES ('Flex')",),
            ("INSERT OR IGNORE INTO payment_methods (name) VALUES ('Divisas (USD Cash)')",),
            ("INSERT OR IGNORE INTO payment_methods (name) VALUES ('Pago Móvil')",),
            ("INSERT OR IGNORE INTO payment_methods (name) VALUES ('Punto de Venta ($)')",),
            ("INSERT OR IGNORE INTO payment_methods (name) VALUES ('Punto de Venta (Bs)')",),
            ("INSERT OR IGNORE INTO payment_methods (name) VALUES ('Transferencia Zelle')",),
            ("INSERT OR IGNORE INTO payment_methods (name) VALUES ('Transferencia Bs')",),
            ("INSERT OR IGNORE INTO payment_methods (name) VALUES ('Efectivo Bs')",),
            ("INSERT OR IGNORE INTO service_statuses (name) VALUES ('Recibido')",),
            ("INSERT OR IGNORE INTO service_statuses (name) VALUES ('En reparación')",),
            ("INSERT OR IGNORE INTO service_statuses (name) VALUES ('Esperando repuesto')",),
            ("INSERT OR IGNORE INTO service_statuses (name) VALUES ('Reparado / Pendiente Pago')",),
            ("INSERT OR IGNORE INTO service_statuses (name) VALUES ('Por entregar')",),
            ("INSERT OR IGNORE INTO service_statuses (name) VALUES ('Entregado')",),
            ("INSERT OR IGNORE INTO service_statuses (name) VALUES ('Cancelado / Devuelto')",),
        ];
        for (sql,) in &defaults {
            conn.execute(sql, [])?;
        }
        // Índices para queries frecuentes (dashboard, listados, historial, saldo)
        conn.execute_batch("
            CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
            CREATE INDEX IF NOT EXISTS idx_service_payments_service ON service_payments(service_id);
            CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
            CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
            CREATE INDEX IF NOT EXISTS idx_services_client ON services(client_id);
            CREATE INDEX IF NOT EXISTS idx_daily_closings_closed ON daily_closings(is_closed);
            CREATE INDEX IF NOT EXISTS idx_service_payments_method ON service_payments(payment_method);
            CREATE INDEX IF NOT EXISTS idx_service_payments_date ON service_payments(payment_date);
            CREATE INDEX IF NOT EXISTS idx_service_payments_reference ON service_payments(zelle_reference);
        ")?;
        // PRAGMAs de robustez/rendimiento (idempotentes).
        // synchronous=FULL con WAL: ante un corte de luz/PC no se pierde el último commit
        // (acompaña el requisito "si se apaga la PC con un proceso en el momento, los datos
        // deben quedar guardados"). El coste de escritura es despreciable para esta carga.
        conn.execute_batch("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;")?;
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        // Migración 2026-08-07: normalizar nombres propios a Title Case (idempotente).
        // Clientes: solo si no existe ya otro cliente con el nombre normalizado (sin duplicar).
        // services.client / sales.client_name son snapshots: se normalizan siempre.
        Self::migrate_title_case_names(&conn)?;
        Ok(())
    }

    // Title Case en datos existentes (migración idempotente): clients, services.client, sales.client_name.
    fn migrate_title_case_names(conn: &rusqlite::Connection) -> SqlResult<()> {
        let normalize_column = |conn: &rusqlite::Connection, table: &str, column: &str| -> SqlResult<()> {
            let sql = format!("SELECT id, {} FROM {}", column, table);
            let mut stmt = conn.prepare(&sql)?;
            // F75 (hallazgo medido): leer el nombre con `String` a secas REVENTABA el arranque de la
            // app si la base traía una fila con NULL (una importación, un Excel migrado o una fila
            // escrita a mano): `Failed to initialize database: InvalidColumnType(1, "client_name",
            // Null)` y la app quedaba INSERVIBLE (no abría). El nombre es un snapshot opcional: se lee
            // defensivo y NULL se trata como vacío (nada que normalizar).
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default()))
            })?;
            let mut updates: Vec<(String, i64)> = Vec::new();
            for row in rows {
                let (id, name) = row?;
                let norm = title_case(&name);
                if norm != name {
                    updates.push((norm, id));
                }
            }
            drop(stmt);
            for (norm, id) in updates {
                if table == "clients" {
                    let exists: bool = conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM clients WHERE name=?1 AND id<>?2)",
                        params![norm, id], |r| r.get(0),
                    )?;
                    if exists {
                        continue; // no duplicar clientes
                    }
                }
                let sql = format!("UPDATE {} SET {}=?1 WHERE id=?2", table, column);
                conn.execute(&sql, params![norm, id])?;
            }
            Ok(())
        };
        normalize_column(conn, "clients", "name")?;
        normalize_column(conn, "services", "client")?;
        normalize_column(conn, "sales", "client_name")?;
        Ok(())
    }

    pub fn next_order_num(&self) -> SqlResult<String> {
        let conn = self.conn.lock().unwrap();
        Self::next_order_num_on(&conn)
    }

    // Cálculo conn-level (reutilizable sin re-lock: patrón deadlock de open_day).
    fn next_order_num_on(conn: &rusqlite::Connection) -> SqlResult<String> {
        // Monótono e idempotente: MAX del número existente + 1 (borrar no reutiliza).
        // El PREFIJO y el ancho se derivan del último número guardado ("DEV-0001" -> "DEV-0002",
        // "ORD-1023" -> "ORD-1024") — antes estaba fijo a 'ORD-%' y un back con prefijo distinto
        // hacía MAX=NULL <- error "Invalid column type Null" (r.get(0) se infiere i64, no Option).
        // Órdenes multi-equipo: las filas grupales tienen group_id NOT NULL y order_num con sufijo
        // ("DEV-0001-B"), se excluyen de la derivación (un sufijo deformaría el ancho del número).
        let last: Option<String> = conn
            .query_row("SELECT order_num FROM services WHERE group_id IS NULL ORDER BY id DESC LIMIT 1", [], |r| r.get(0))
            .optional()?;
        let (prefix, width): (String, usize) = match &last {
            Some(s) => {
                let mut parts = s.split('-');
                let pre = parts.next().unwrap_or("DEV").to_string() + "-";
                let num = parts.next().unwrap_or("");
                (pre, (num.len()).max(1))
            }
            None => ("DEV-".to_string(), 4),
        };
        // Incluye TODOS los números con separador '-' (cualquier prefijo).
        // COALESCE(...,0): cuando la tabla está VACÍA, MAX(expr) devuelve NULL en una
        // fila (no "no rows"); recuperar ese NULL como i64 lanza InvalidColumnType que
        // .optional() NO captura (solo captura QueryReturnedNoRows). FIX 2026-08-04:
        // el primer servicio después de vaciar la DB (inicio de operación) crasheaba.
        let max: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(CAST(SUBSTR(order_num, INSTR(order_num, '-') + 1) AS INTEGER)), 0) \
                 FROM services WHERE INSTR(order_num, '-') > 0",
                [],
                |r| r.get(0),
            )?;
        Ok(format!("{}{:0width$}", prefix, max + 1, width = width))
    }

    // --- Products ---
    /// Nombre de la categoría (para reconstruir nombres canónicos).
    fn category_name(conn: &Connection, category_id: Option<i64>) -> String {
        let Some(id) = category_id else { return String::new() };
        conn.query_row("SELECT name FROM categories WHERE id=?1", params![id], |r| r.get::<_, String>(0))
            .optional()
            .ok()
            .flatten()
            .unwrap_or_default()
    }

    /// Limpieza masiva del catálogo (marcas/modelos/nombres/compatibilidad).
    /// `dry_run = true` NO escribe nada: devuelve conteos y muestras.
    /// `dry_run = false` respalda el .db (checkpoint + copia en `backup/`) y aplica.
    /// Es idempotente: correrlo dos veces no cambia nada la segunda vez.
    pub fn normalize_catalog(&self, dry_run: bool) -> SqlResult<crate::catalog::CatalogReport> {
        let conn = self.conn.lock().unwrap();
        if dry_run {
            return crate::catalog::normalize_catalog(&conn, true);
        }

        // respaldo ANTES de escribir: checkpoint del WAL y copia del archivo
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
        let backup = (|| -> Option<PathBuf> {
            let stamp: String = conn
                .query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))
                .unwrap_or_else(|_| "sin_fecha".to_string());
            let dir = self.db_path.parent()?.join("backup");
            std::fs::create_dir_all(&dir).ok()?;
            let dest = dir.join(format!("registro_pre_normalizacion_{stamp}.db"));
            std::fs::copy(&self.db_path, &dest).ok()?;
            Some(dest)
        })();

        let mut report = crate::catalog::normalize_catalog(&conn, false)?;
        report.backup = backup.map(|p| p.to_string_lossy().to_string());
        // la compatibilidad cambió → se refresca el padrón de teléfonos
        let _ = crate::catalog::rebuild_phones(&conn, false);
        Ok(report)
    }

    // --- Inventario unificado: consultas del módulo de pantallas/productos ---

    // ── F53 — MODELOS: UN SOLO NOMBRE POR TELÉFONO (separar, numerar y marcar lo nuevo) ─────────
    /// Vista previa (NO escribe nada) de «separar los modelos»: qué teléfonos nuevos aparecen al
    /// partir las entradas compuestas («Samsung A70 A705» → **A70** + **A705**), cuáles dejan de
    /// existir y cuántas variantes se sacan del texto.
    ///
    /// Se calcula **ejecutando el rebuild de verdad dentro de una transacción que se revierte**: la
    /// vista previa muestra exactamente lo que va a pasar, no una estimación.
    pub fn preview_phone_split(&self) -> SqlResult<PhoneSplitPreview> {
        let conn = self.conn.lock().unwrap();
        let antes = phone_snapshot(&conn)?;
        let variantes = variantes_a_extraer(&conn)?;
        conn.execute_batch("BEGIN")?;
        let r = crate::catalog::rebuild_phones(&conn, false);
        let despues = phone_snapshot(&conn);
        let _ = conn.execute_batch("ROLLBACK");
        let despues = despues?;
        let r = r?;
        let mut nuevos: Vec<String> = despues.iter()
            .filter(|(k, _)| !antes.contains_key(*k))
            .map(|(_, n)| n.1.clone())
            .collect();
        let mut borrados: Vec<String> = antes.iter()
            .filter(|(k, _)| !despues.contains_key(*k))
            .map(|(_, n)| n.1.clone())
            .collect();
        nuevos.sort();
        borrados.sort();
        Ok(PhoneSplitPreview {
            phones_before: antes.len() as i64,
            phones_after: despues.len() as i64,
            created: nuevos,
            removed: borrados,
            updated: r.updated,
            needs_review: r.needs_review,
            variants_extracted: variantes.len() as i64,
            variant_samples: variantes,
            ..Default::default()
        })
    }

    /// Aplica la separación: respalda la base, saca del texto las variantes que falten, reconstruye
    /// el padrón (una fila por teléfono REAL), **numera los nuevos** (`M-…`) y les pone el «en uso»
    /// con la misma regla del seed (en uso ⇔ alguno de sus repuestos está en uso y con stock).
    /// NO toca stock, precios, movimientos, ventas ni órdenes (lo verifica el test).
    pub fn apply_phone_split(&self) -> SqlResult<PhoneSplitPreview> {
        let conn = self.conn.lock().unwrap();
        let antes = phone_snapshot(&conn)?;
        // respaldo ANTES de escribir (mismo patrón que la limpieza del catálogo)
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
        let backup = (|| -> Option<PathBuf> {
            let stamp: String = conn
                .query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))
                .unwrap_or_else(|_| "sin_fecha".to_string());
            let padre = self.db_path.parent()?;
            // si la base ya vive en una carpeta `backup/` (copias de verificación), no se anida otra
            let dir = if padre.file_name().map(|n| n.eq_ignore_ascii_case("backup")).unwrap_or(false) {
                padre.to_path_buf()
            } else {
                padre.join("backup")
            };
            std::fs::create_dir_all(&dir).ok()?;
            let dest = dir.join(format!("registro_pre_modelos_{stamp}.db"));
            std::fs::copy(&self.db_path, &dest).ok()?;
            Some(dest)
        })();

        // 1) la variante que estaba escrita en el TEXTO pasa al campo `variant` (y se reindexa)
        let mut extraidas: Vec<String> = Vec::new();
        for (id, nombre, marca, modelo, compat) in productos_sin_variante(&conn)? {
            let Some(v) = crate::catalog::variant_in_text(&compat) else { continue };
            let texto = crate::catalog::search_text(&nombre, &marca, &modelo, &v, &compat);
            conn.execute(
                "UPDATE products SET variant=?1, search_text=?2, updated_at=datetime('now','localtime') WHERE id=?3",
                params![v, texto, id],
            )?;
            extraidas.push(format!("{nombre} → {v}"));
        }

        // 2) el padrón se reconstruye con el split (una fila por teléfono real)
        let r = crate::catalog::rebuild_phones(&conn, false)?;
        let despues = phone_snapshot(&conn)?;
        let mut nuevos: Vec<(i64, String)> = despues.iter()
            .filter(|(k, _)| !antes.contains_key(*k))
            .map(|(_, v)| v.clone())
            .collect();
        let mut borrados: Vec<String> = antes.iter()
            .filter(|(k, _)| !despues.contains_key(*k))
            .map(|(_, v)| v.1.clone())
            .collect();
        nuevos.sort_by_key(|(_, n)| n.clone());
        borrados.sort();

        // 3) los NUEVOS se numeran y se marcan «en uso» con la regla del seed (solo los nuevos: un
        //    check hecho a mano por el dueño no se toca nunca).
        //    OJO RENDIMIENTO: los repuestos «en uso y con stock» se leen UNA sola vez (con 201
        //    teléfonos nuevos, preguntar producto por producto era un N+1 que tardaba minutos).
        let en_uso: std::collections::BTreeSet<i64> = {
            let mut stmt = conn.prepare(
                "SELECT id FROM products WHERE COALESCE(in_use,1)=1 AND COALESCE(stock,0)>0")?;
            let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        let mut cache = self.cache.lock().unwrap();
        let idx = cache.phone_index(&conn)?.clone();
        for (id, _) in &nuevos {
            let _ = conn.execute(
                "UPDATE phones SET code = 'M-' || printf('%04d', id) WHERE id=?1 AND (code IS NULL OR code='')",
                params![id],
            );
            let key: String = conn
                .query_row("SELECT COALESCE(key,'') FROM phones WHERE id=?1", params![id], |x| x.get(0))
                .unwrap_or_default();
            let tiene = idx.get(&key).map(|e| e.ids.iter().any(|pid| en_uso.contains(pid))).unwrap_or(false);
            let _ = conn.execute("UPDATE phones SET in_use=?1 WHERE id=?2",
                params![if tiene { 1 } else { 0 }, id]);
        }
        drop(cache);

        Ok(PhoneSplitPreview {
            phones_before: antes.len() as i64,
            phones_after: despues.len() as i64,
            created: nuevos.into_iter().map(|(_, n)| n).collect(),
            removed: borrados,
            updated: r.updated,
            needs_review: r.needs_review,
            variants_extracted: extraidas.len() as i64,
            variant_samples: extraidas,
            backup: backup.map(|p| p.to_string_lossy().to_string()),
            ..Default::default()
        })
    }

    /// Página de productos con filtros y orden server-side (la tabla ya no trae 1126 filas).
    ///
    /// `variant_family` (F52) filtra por FAMILIA de la variante (`INCELL` / `OLED` / `ORIGINAL` /
    /// `""` = sin variante). Se compara por familia, no por texto exacto: pedir «OLED» trae «OLED» y
    /// «OLED Con Marco» — la regla vive en `catalog::variant_family` y el SQL escribe la MISMA
    /// (primera palabra del texto recortado); la paridad la fija un test.
    pub fn get_products_page(
        &self,
        search: &str,
        category_id: Option<i64>,
        brand: Option<&str>,
        stock_filter: Option<&str>,
        variant_family: Option<&str>,
        sort: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> SqlResult<ProductPage> {
        let conn = self.conn.lock().unwrap();
        let mut where_sql = String::from(" WHERE 1=1");
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        // Búsqueda por tokens: misma regla de siempre (TODOS tienen que aparecer, en cualquier
        // orden) y, además, F50: la ficha se encuentra por su CÓDIGO («p-142», «142») — es como el
        // local la dicta. El código se compara SIN guiones ni espacios (`p0142`) porque `norm` no
        // deja puntuación (misma normalización que usa el buscador de modelos con `M-007`).
        // Se escribe acá y no en `catalog::search_clause` porque el código es una columna más del
        // producto (esa función solo conoce el `search_text`).
        let tokens = crate::catalog::search_tokens(search);
        for t in tokens.iter() {
            values.push(Box::new(format!("%{t}%")));
            let i = values.len();
            values.push(Box::new(format!("%{}%", t.replace(' ', ""))));
            let j = values.len();
            where_sql.push_str(&format!(
                " AND (COALESCE(p.search_text,'') LIKE ?{i}
                       OR REPLACE(REPLACE(LOWER(COALESCE(p.code,'')),'-',''),' ','') LIKE ?{j})"
            ));
        }

        if let Some(cid) = category_id {
            values.push(Box::new(cid));
            where_sql.push_str(&format!(" AND p.category_id=?{}", values.len()));
        }
        if let Some(b) = brand {
            if !b.trim().is_empty() {
                values.push(Box::new(b.trim().to_string()));
                where_sql.push_str(&format!(" AND p.brand=?{}", values.len()));
            }
        }
        let stock_clause = match stock_filter.unwrap_or("todos") {
            "con_stock" => " AND p.stock > 0",
            "agotado" => " AND p.stock = 0",
            "negativo" => " AND p.stock < 0",
            "bajo_minimo" => " AND p.min_stock > 0 AND p.stock <= p.min_stock",
            "sin_precio" => " AND COALESCE(p.price_cost,0)=0 AND COALESCE(p.price_sale,0)=0",
            "sin_compat" => " AND COALESCE(p.compatibility,'') IN ('','[]')",
            // F50: el check «lo uso» — el filtro que muestra solo lo marcado (y su inverso).
            "solo_uso" => " AND COALESCE(p.in_use,1) = 1",
            "sin_uso" => " AND COALESCE(p.in_use,1) = 0",
            _ => "",
        };
        where_sql.push_str(stock_clause);

        // F52 — FILTRO POR FAMILIA DE VARIANTE. La familia es la PRIMERA PALABRA del texto recortado
        // (misma regla que `catalog::variant_family`, que es la que usan los chips de la vista «Por
        // modelo»): pedir «OLED» trae «OLED» y «OLED Con Marco»; el valor vacío trae las fichas SIN
        // variante (613 en el catálogo real). La paridad de las dos implementaciones la fija el test
        // `test_variant_family_sql_matches_rust`.
        if let Some(f) = variant_family {
            let fam = crate::catalog::norm(f);
            values.push(Box::new(fam));
            let idx = values.len();
            where_sql.push_str(&format!(
                " AND {VARIANT_FAMILY_SQL} = ?{idx}"
            ));
        }

        // F51 — ORDEN POR COLUMNAS: el frontend manda la clave de la columna (y `_desc` para el
        // orden inverso). Convención: `<col>` = el orden ÚTIL de esa columna (nombre A-Z, stock/
        // precio/costo/mínimo de MAYOR a menor) y `<col>_desc` = el inverso. TODAS las columnas
        // tienen sus DOS claves: si falta la inversa, la consulta caía en «orden por nombre» y el
        // segundo clic del encabezado no hacía nada (bug real medido en vivo).
        // Se conservan las claves viejas del desplegable (`stock`, `stock_asc`, `marca`, `reciente`).
        let order = match sort.unwrap_or("nombre") {
            "nombre" => "p.name",
            "nombre_desc" => "p.name DESC",
            "marca" => "p.brand, p.model, p.name",
            "marca_desc" => "p.brand DESC, p.model DESC, p.name",
            "modelo" => "p.model, p.name",
            "modelo_desc" => "p.model DESC, p.name",
            "variante" => "COALESCE(p.variant,'') ASC, p.name",
            "variante_desc" => "COALESCE(p.variant,'') DESC, p.name",
            "categoria" => "c.name, p.name",
            "categoria_desc" => "c.name DESC, p.name",
            "stock" => "p.stock DESC, p.name",
            "stock_desc" => "p.stock ASC, p.name",
            "stock_asc" => "p.stock ASC, p.name",              // alias viejo del desplegable
            "precio" => "p.price_sale DESC, p.name",
            "precio_desc" => "p.price_sale ASC, p.name",
            "precio_asc" => "p.price_sale ASC, p.name",        // alias
            "costo" => "p.price_cost DESC, p.name",
            "costo_desc" => "p.price_cost ASC, p.name",
            "costo_asc" => "p.price_cost ASC, p.name",         // alias
            "minimo" => "p.min_stock DESC, p.name",
            "minimo_desc" => "p.min_stock ASC, p.name",
            "minimo_asc" => "p.min_stock ASC, p.name",         // alias
            "reciente" => "p.updated_at DESC, p.name",
            // F50: «lo que uso» primero (y su inverso).
            "uso" => "COALESCE(p.in_use,1) DESC, p.name",
            "uso_desc" => "COALESCE(p.in_use,1) ASC, p.name",
            _ => "p.name",
        };
        // (F52/F53 van a usar esta misma base para la vista por modelo.)

        let total: i64 = {
            let sql = format!("SELECT COUNT(*) FROM products p{}", where_sql);
            let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|p| p.as_ref()).collect();
            conn.query_row(&sql, params_ref.as_slice(), |r| r.get(0))?
        };

        values.push(Box::new(limit.max(1)));
        let limit_idx = values.len();
        values.push(Box::new(offset.max(0)));
        let offset_idx = values.len();
        let sql = format!(
            "SELECT {PRODUCT_COLS} FROM products p
             LEFT JOIN categories c ON p.category_id = c.id{where_sql}
             ORDER BY {order} LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(Product {
                id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?, brand: r.get(3)?,
                model: r.get(4)?, variant: r.get(5)?, compatibility: r.get(6)?,
                price_cost: r.get(7)?, price_sale: r.get(8)?, stock: r.get(9)?,
                min_stock: r.get(10)?, created_at: r.get(11)?, updated_at: r.get(12)?,
                category_name: r.get(14)?, price_usd: r.get(13)?, supplier: r.get(15).unwrap_or_default(),
                        in_use: r.get(16).unwrap_or(1), code: r.get(17).unwrap_or_default(),
            })
        })?;
        let mut items = Vec::new();
        for row in rows { items.push(row?); }
        Ok(ProductPage { items, total })
    }

    /// KPIs del inventario (los del encabezado del módulo). MEMORIZADO (feature 41): el cálculo
    /// vuelve a normalizar TODOS los productos para agrupar los repetidos (113 ms medidos con
    /// datos reales) y se pedía cada vez que se abría el módulo o se guardaba algo.
    pub fn get_inventory_stats(&self) -> SqlResult<InventoryStats> {
        let conn = self.conn.lock().unwrap();
        let mut cache = self.cache.lock().unwrap();
        let stats = cache.inventory_stats(&conn)?;
        Ok((*stats).clone())
    }

    /// F53 — GRUPOS DE MODELOS REPETIDOS (propuesta para el asistente, con vista previa).
    ///
    /// Señal que usa el taller: **dos teléfonos que se sirven con EXACTAMENTE los mismos repuestos**
    /// son, para el local, el mismo teléfono (le pone la misma pantalla). Se agrupan por marca +
    /// conjunto de repuestos, así que la propuesta sale de los DATOS y no de parecidos de texto.
    /// **Los que se juntan los decide el dueño**, grupo por grupo, y la fusión conserva los nombres
    /// viejos como ALIAS (buscar «A705» sigue encontrando «A70»).
    pub fn get_phone_duplicate_groups(&self) -> SqlResult<Vec<PhoneDuplicateGroup>> {
        let conn = self.conn.lock().unwrap();
        let mut cache = self.cache.lock().unwrap();
        let idx = cache.phone_index(&conn)?;
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(brand,''), COALESCE(name,''), COALESCE(code,''),
                    COALESCE(aliases,'[]'), COALESCE(key,''), COALESCE(in_use,0)
             FROM phones",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
                r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })?;
        // firma = marca + ids de sus repuestos (los MISMOS para todos los del grupo)
        let mut grupos: std::collections::BTreeMap<String, Vec<PhoneDuplicateRow>> = std::collections::BTreeMap::new();
        for row in rows {
            let (id, brand, name, code, aliases_json, key, in_use) = row?;
            let aliases: Vec<String> = serde_json::from_str(&aliases_json).unwrap_or_default();
            // unión clave + alias (misma fuente que el stock y la ficha)
            let mut ids: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
            let mut claves: Vec<String> = vec![key.clone()];
            for a in &aliases {
                let phone = crate::catalog::canonical_phone(a, &brand);
                claves.push(crate::catalog::phone_registry_key(&phone));
            }
            for k in &claves {
                if let Some(e) = idx.get(k) {
                    for pid in &e.ids {
                        ids.insert(*pid);
                    }
                }
            }
            if ids.is_empty() {
                continue;
            }
            let firma = format!("{}|{}", crate::catalog::norm(&brand), ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(","));
            grupos.entry(firma).or_default().push(PhoneDuplicateRow {
                id, brand, name, code, in_use, repuestos: ids.len() as i64, aliases,
            });
        }
        let mut out: Vec<PhoneDuplicateGroup> = grupos
            .into_iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|(_, mut phones)| {
                // el que MÁS repuestos/stock tiene primero (es el más probable de quedar)
                phones.sort_by(|a, b| b.repuestos.cmp(&a.repuestos).then(a.name.cmp(&b.name)));
                PhoneDuplicateGroup { phones }
            })
            .collect();
        // los grupos con más teléfonos primero (los más útiles de revisar)
        out.sort_by(|a, b| b.phones.len().cmp(&a.phones.len()).then(a.phones[0].name.cmp(&b.phones[0].name)));
        out.truncate(60);
        Ok(out)
    }

    /// es lo que llena el desplegable de «Variante» del inventario. Sale de la MISMA expresión SQL
    /// que el filtro (`VARIANT_FAMILY_SQL`), así que las opciones y lo que devuelve el filtro no
    /// pueden discrepar. `family` vacío = fichas sin variante (se muestra «Sin variante»).
    pub fn get_variant_families(&self) -> SqlResult<Vec<VariantFamily>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {VARIANT_FAMILY_SQL} AS familia, COUNT(*) AS n, COALESCE(SUM(p.stock),0) AS stock
             FROM products p GROUP BY familia"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| {
            Ok(VariantFamily {
                family: r.get(0)?,
                products: r.get(1)?,
                stock: r.get(2)?,
            })
        })?;
        let mut out: Vec<VariantFamily> = rows.collect::<SqlResult<Vec<_>>>()?;
        // orden canónico del local: sin variante primero, después INCELL → OLED → AM → ORIGINAL…
        out.sort_by(|a, b| crate::catalog::variant_rank(&a.family).cmp(&crate::catalog::variant_rank(&b.family)));
        Ok(out)
    }
}

/// Cálculo crudo de los KPIs del inventario (SIN memoria): una consulta agregada, el agrupado
/// de duplicados y los totales por categoría. Lo llama la memoria del catálogo
/// (`cache::CatalogCache::inventory_stats`), que es lo que usan los comandos.
pub(crate) fn build_inventory_stats(conn: &Connection) -> SqlResult<InventoryStats> {
    let mut stats = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN stock < 0 THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN min_stock > 0 AND stock <= min_stock THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN COALESCE(price_cost,0)=0 AND COALESCE(price_sale,0)=0 THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN COALESCE(compatibility,'') IN ('','[]') THEN 1 ELSE 0 END),0),
                COUNT(DISTINCT brand),
                COALESCE(SUM(stock),0),
                COALESCE(SUM(stock * COALESCE(price_cost,0)),0),
                COALESCE(SUM(stock * COALESCE(price_sale,0)),0)
         FROM products",
        [],
        |r| {
            Ok(InventoryStats {
                sku: r.get(0)?, with_stock: r.get(1)?, out_of_stock: r.get(2)?,
                negative: r.get(3)?, low_stock: r.get(4)?, no_price: r.get(5)?,
                no_compat: r.get(6)?, brands: r.get(7)?, units: r.get(8)?,
                value_cost: r.get(9)?, value_sale: r.get(10)?,
                ..Default::default()
            })
        },
    )?;

    let mut stmt = conn.prepare(
        "SELECT COALESCE(brand,''), COALESCE(model,''), COALESCE(variant,''), id
         FROM products ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?))
    })?;
    let mut groups: std::collections::BTreeMap<String, Vec<i64>> = std::collections::BTreeMap::new();
    for row in rows {
        let (brand, model, variant, id) = row?;
        let n = crate::catalog::normalize_fields("", &brand, &model, &variant, "");
        let key = format!("{}|{}|{}", crate::catalog::norm(&n.brand), crate::catalog::norm(&n.model), crate::catalog::norm(&n.variant));
        groups.entry(key).or_default().push(id);
    }
    let dups: Vec<Vec<i64>> = groups.into_values().filter(|v| v.len() > 1).collect();
    stats.duplicate_groups = dups.len() as i64;
    stats.duplicate_ids = dups.into_iter().flatten().collect();

    let mut stmt = conn.prepare(
        "SELECT COALESCE(c.name,'(sin categoría)'), COUNT(*) sku, COALESCE(SUM(p.stock),0) units
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         GROUP BY c.name ORDER BY sku DESC",
    )?;
    let rows = stmt.query_map([], |r| Ok(StockCount { name: r.get(0)?, sku: r.get(1)?, units: r.get(2)? }))?;
    for row in rows { stats.by_category.push(row?); }

    Ok(stats)
}

/// Un producto del catálogo con su compatibilidad YA PARSEADA.
///
/// Parsear el JSON de `compatibility` de cada producto era la mitad del costo del buscador de
/// repuestos (se re-leía el catálogo entero en CADA consulta: 240 ms medidos). Se calcula una
/// sola vez por versión de la base y lo guarda `src/cache.rs`.
pub(crate) struct ParsedProduct {
    pub product: Product,
    pub phones: Vec<crate::catalog::Phone>,
}

/// Lee TODO el catálogo con la compatibilidad parseada. Lista EXPLÍCITA de columnas (nunca
/// `p.*`, que cambia de orden con las migraciones) y `ORDER BY p.id` para que el desempate del
/// orden sea siempre el mismo. Lo llama la memoria del catálogo, no los comandos.
pub(crate) fn build_parsed_products(conn: &Connection) -> SqlResult<Vec<ParsedProduct>> {
    let sql = format!(
        "SELECT {PRODUCT_COLS} FROM products p
         LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(Product {
            id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?, brand: r.get(3)?,
            model: r.get(4)?, variant: r.get(5)?, compatibility: r.get(6)?,
            price_cost: r.get(7)?, price_sale: r.get(8)?, stock: r.get(9)?,
            min_stock: r.get(10)?, created_at: r.get(11)?, updated_at: r.get(12)?,
            category_name: r.get(14)?, price_usd: r.get(13)?, supplier: r.get(15).unwrap_or_default(),
                        in_use: r.get(16).unwrap_or(1), code: r.get(17).unwrap_or_default(),
        })
    })?;
    let mut out: Vec<ParsedProduct> = Vec::new();
    for row in rows {
        let product = row?;
        let brand = product.brand.clone().unwrap_or_default();
        let compat = product.compatibility.clone().unwrap_or_default();
        let phones = crate::catalog::compat_phones(&compat, &brand);
        out.push(ParsedProduct { product, phones });
    }
    Ok(out)
}

impl Database {
    /// Catálogo con la compatibilidad ya parseada, MEMORIZADO (ver `src/cache.rs`).
    fn catalog_products(&self, conn: &Connection) -> SqlResult<Arc<Vec<ParsedProduct>>> {
        let mut cache = self.cache.lock().unwrap();
        cache.products(conn)
    }

    /// Pestaña Modelos: conteo por marca. MEMORIZADO: comparte con la lista el índice de
    /// repuestos por teléfono (antes cada endpoint lo rehacía por su cuenta).
    /// ORDEN DE CANDADOS: primero `conn`, después `cache`, siempre.
    pub fn get_phone_brands(&self) -> SqlResult<Vec<crate::phones::PhoneBrandRow>> {
        let conn = self.conn.lock().unwrap();
        let mut cache = self.cache.lock().unwrap();
        crate::phones::get_phone_brands(&conn, &mut cache)
    }

    /// Pestaña Modelos: lista de teléfonos con filtros y orden. MEMORIZADO.
    #[allow(clippy::too_many_arguments)]
    pub fn get_phones_page(
        &self,
        brand: Option<&str>,
        search: &str,
        only_with_products: bool,
        only_stock: bool,
        only_review: bool,
        sort: &str,
        dir: &str,
        limit: i64,
        offset: i64,
    ) -> SqlResult<crate::phones::PhonePage> {
        let conn = self.conn.lock().unwrap();
        let mut cache = self.cache.lock().unwrap();
        crate::phones::get_phones(&conn, &mut cache, brand, search, only_with_products, only_stock,
                                  only_review, sort, dir, limit, offset)
    }

    /// Ficha de un teléfono del padrón (diálogo «Ficha»). MEMORIZADO.
    pub fn get_phone_detail(&self, phone_id: i64) -> SqlResult<Option<crate::phones::PhoneDetail>> {
        let conn = self.conn.lock().unwrap();
        let mut cache = self.cache.lock().unwrap();
        crate::phones::get_phone_detail(&conn, &mut cache, phone_id)
    }

    /// Vista previa de un renombrado de teléfono (no escribe nada). MEMORIZADO.
    pub fn preview_rename_phone(&self, id: i64, brand: &str, line: &str, model: &str)
        -> SqlResult<Option<crate::phones::RenamePreview>> {
        let conn = self.conn.lock().unwrap();
        let mut cache = self.cache.lock().unwrap();
        crate::phones::preview_rename_phone(&conn, &mut cache, id, brand, line, model)
    }

    /// Lista maestra de teléfonos derivada de `compatibility`, deduplicada por
    /// clave canónica (evita el mismo teléfono dos veces por escribir la marca
    /// de otra forma). Incluye cuántos repuestos le sirven y su stock.
    pub fn get_phone_models(&self, search: &str, limit: i64) -> SqlResult<Vec<PhoneModelRow>> {
        self.get_phone_models_filtered(search, limit, false)
    }

    /// F50 — igual que `get_phone_models` pero con `in_use_only`: el formulario de servicio ofrece
    /// **solo los modelos que el local usa** (el check del padrón), con «Ver todos» para el caso
    /// raro. La búsqueda también entiende el CÓDIGO (`M-007`) además del nombre.
    pub fn get_phone_models_filtered(&self, search: &str, limit: i64, in_use_only: bool) -> SqlResult<Vec<PhoneModelRow>> {
        let conn = self.conn.lock().unwrap();
        let mut cache = self.cache.lock().unwrap();
        #[derive(Default)]
        struct Acc {
            label: String,
            brand: String,
            products: i64,
            stock: i64,
            in_use: i64,
            code: String,
            /// F53: pantalla de REFERENCIA del modelo (se auto-selecciona al registrar el servicio).
            default_product_id: Option<i64>,
        }
        // FUENTE ÚNICA: el PADRÓN (`phones`), no la compatibilidad cruda. Así el
        // formulario de servicio ofrece el MISMO nombre que el taller ve (y corrige)
        // en Inventario → Modelos, y una sola ficha por teléfono.
        let mut map: std::collections::HashMap<String, Acc> = std::collections::HashMap::new();
        {
            // repuestos/stock de todos los teléfonos en UNA pasada (mismo cálculo que la
            // pestaña Modelos: clave + alias, sin contar dos veces el mismo repuesto).
            // MEMORIZADO (feature 41): este cálculo recorría las dos tablas enteras y se
            // repetía en cada consulta del selector de modelo (230-300 ms medidos).
            let totals = cache.phone_totals(&conn)?;
            let mut stmt = conn.prepare(
                "SELECT COALESCE(key,''), COALESCE(brand,''), COALESCE(name,''), COALESCE(source,'catalogo'),
                        COALESCE(in_use,0), COALESCE(code,''), default_product_id
                 FROM phones",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, Option<i64>>(6).unwrap_or(None),
                ))
            })?;
            for row in rows {
                let (key, brand, name, source, in_use, code, default_product_id) = row?;
                let (products, stock) = totals.get(&key).copied().unwrap_or((0, 0));
                // los teléfonos dados de ALTA a mano salen siempre (aunque todavía no tengan
                // repuesto cargado): el taller los agregó justamente para poder usarlos
                if products == 0 && source != "manual" {
                    continue;
                }
                // F50: con «solo lo que uso» se esconden los modelos apagados del padrón (el check).
                if in_use_only && in_use != 1 {
                    continue;
                }
                map.insert(key, Acc { label: name, brand, products, stock, in_use, code, default_product_id });
            }
        }

        let tokens = crate::catalog::search_tokens(search);
        let mut list: Vec<PhoneModelRow> = map
            .into_iter()
            .filter(|(_, a)| {
                // se busca por marca + nombre: el nombre comercial del padrón no repite la
                // marca («110» es un Nokia 110), así que «nokia» tiene que encontrarlo.
                // F50: además se puede BUSCAR POR CÓDIGO («M-007»): el local lo dicta y aparece.
                tokens.is_empty()
                    || tokens.iter().all(|t| {
                        crate::catalog::norm(&format!("{} {} {}", a.brand, a.label, a.code)).contains(t)
                            || crate::catalog::norm(&a.code).contains(t)
                    })
            })
            .map(|(key, a)| PhoneModelRow {
                label: a.label,
                brand: a.brand,
                key,
                screens: a.products,
                stock: a.stock,
                with_stock: if a.stock > 0 { 1 } else { 0 },
                in_use: a.in_use,
                code: a.code,
                default_product_id: a.default_product_id,
            })
            .collect();
        // F50: lo que el local USA va primero (y con el mismo nombre, el orden es estable).
        list.sort_by(|a, b| b.in_use.cmp(&a.in_use).then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase())));
        if limit > 0 { list.truncate(limit as usize); }
        Ok(list)
    }

    /// Productos compatibles con un modelo, RANKEADOS: primero los de la MISMA MARCA que el
    /// teléfono, después las coincidencias exactas y, dentro de cada nivel, los que tienen
    /// stock.
    /// `category_id = None` → todas las categorías (para sugerir precios del
    /// repuesto que corresponda); `Some(1)` → solo pantallas.
    pub fn find_compatible_products(&self, model: &str, category_id: Option<i64>, limit: i64) -> SqlResult<Vec<ScreenCandidate>> {
        let conn = self.conn.lock().unwrap();
        let base = crate::catalog::phone_model_norm(model);
        if base.is_empty() {
            return Ok(Vec::new());
        }
        // El nombre puede venir del PADRÓN (nombre comercial: «Galaxy A06 4G», «Poco X3»)
        // o escrito a mano. Se prueban TAMBIÉN sus alias (cómo está escrito en el
        // inventario) para que renombrar un teléfono no le haga perder sus repuestos.
        let mut targets: Vec<String> = vec![base];
        for a in crate::phones::lookup_aliases(&conn, model)? {
            let t = crate::catalog::phone_model_norm(&a);
            if !t.is_empty() && !targets.contains(&t) {
                targets.push(t);
            }
        }
        // GATE DE MARCA: la marca del teléfono sale del PADRÓN (ficha del modelo) y, si el
        // modelo se escribió a mano con la marca delante («Honor 10 Lite»), del texto. Sirve
        // para que «10 Lite» no traiga la pantalla de un Infinix Hot 10 Lite: el texto del
        // modelo solo (sin marca) cruzaba teléfonos de marcas distintas con medidas y
        // conectores distintos (A11 Umidigi → A11 Samsung, Realme 11 5G → Redmi Note 11 5G).
        let phone_brand = match crate::phones::lookup_brand(&conn, model)? {
            Some(b) if !b.trim().is_empty() => b,
            _ => crate::catalog::explicit_brand(model).unwrap_or_default(),
        };
        let gate = !phone_brand.trim().is_empty();

        // MEMORIZADO (feature 41): antes se releía el catálogo COMPLETO y se volvía a parsear la
        // compatibilidad de cada producto en CADA consulta (240 ms medidos con datos reales; el
        // buscador de «Repuesto por modelo» y el desplegable de pantalla del servicio lo pagan
        // en cada uso). La memoria devuelve EXACTAMENTE lo mismo, sólo evita repetirlo: el
        // filtro por categoría se aplica acá igual que lo hacía el `WHERE`.
        let catalog = self.catalog_products(&conn)?;

        let mut out: Vec<ScreenCandidate> = Vec::new();
        for item in catalog.iter() {
            if let Some(cid) = category_id {
                if item.product.category_id != Some(cid) {
                    continue;
                }
            }
            let p = &item.product;
            let mut best: Option<&'static str> = None;
            let mut brand_match = false;
            for target in &targets {
                for phone in &item.phones {
                    if let Some(q) = crate::catalog::match_quality(target, &phone.model) {
                        let rank = |s: &str| match s { "exacta" => 0, "prefijo" => 1, _ => 2 };
                        if best.map(|b| rank(q) < rank(b)).unwrap_or(true) {
                            best = Some(q);
                        }
                        // la MARCA la resuelve compat_phones: la entrada puede nombrar otra
                        // marca («HONOR X7» dentro de una ficha Genérico) y eso cuenta como
                        // coincidencia de marca — la compatibilidad curada manda
                        if gate && crate::catalog::same_brand(&phone.brand, &phone_brand) {
                            brand_match = true;
                        }
                    }
                }
            }
            if let Some(q) = best {
                out.push(ScreenCandidate {
                    in_stock: p.stock > 0,
                    brand_match,
                    brand_known: gate,
                    product: p.clone(),
                    match_quality: q.to_string(),
                });
            }
        }
        let rank = |s: &str| match s { "exacta" => 0, "prefijo" => 1, _ => 2 };
        out.sort_by(|a, b| {
            b.brand_match.cmp(&a.brand_match)
                .then(rank(&a.match_quality).cmp(&rank(&b.match_quality)))
                .then(b.in_stock.cmp(&a.in_stock))
                .then(b.product.stock.cmp(&a.product.stock))
                .then(a.product.name.cmp(&b.product.name))
        });
        if limit > 0 { out.truncate(limit as usize); }
        Ok(out)
    }

    /// Pantallas (categoría 1) compatibles con un modelo (desplegable del servicio).
    pub fn find_compatible_screens(&self, model: &str, limit: i64) -> SqlResult<Vec<ScreenCandidate>> {
        self.find_compatible_products(model, Some(1), limit)
    }

    /// Grupos de productos repetidos (mismo marca+modelo+variante canónicos).
    /// La fusión NO es automática: el local decide cuál ficha se queda.
    pub fn get_duplicate_groups(&self) -> SqlResult<Vec<DuplicateGroup>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(name,''), COALESCE(brand,''), COALESCE(model,''),
                    COALESCE(variant,''), COALESCE(stock,0), COALESCE(price_sale,0), updated_at
             FROM products ORDER BY id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                DuplicateItem {
                    id: r.get(0)?, name: r.get(1)?, stock: r.get(5)?,
                    price_sale: r.get(6)?, updated_at: r.get(7)?,
                },
                r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?,
            ))
        })?;
        let mut groups: std::collections::BTreeMap<String, Vec<DuplicateItem>> = std::collections::BTreeMap::new();
        for row in rows {
            let (item, brand, model, variant) = row?;
            let n = crate::catalog::normalize_fields("", &brand, &model, &variant, "");
            let key = format!(
                "{}|{}|{}",
                crate::catalog::norm(&n.brand),
                crate::catalog::norm(&n.model),
                crate::catalog::norm(&n.variant)
            );
            groups.entry(key).or_default().push(item);
        }
        let mut out: Vec<DuplicateGroup> = groups
            .into_iter()
            .filter(|(_, items)| items.len() > 1)
            .map(|(_, items)| {
                let label = items[0].name.clone();
                let stock_total = items.iter().map(|i| i.stock).sum();
                DuplicateGroup { label, items, stock_total }
            })
            .collect();
        out.sort_by(|a, b| b.stock_total.cmp(&a.stock_total));
        Ok(out)
    }

    /// Movimientos de inventario con filtros y paginación (auditoría del módulo).
    pub fn get_inventory_movements_page(
        &self,
        product_id: Option<i64>,
        type_: Option<&str>,
        reason: Option<&str>,
        from: Option<&str>,
        to: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> SqlResult<MovementPage> {
        let conn = self.conn.lock().unwrap();
        let mut where_sql = String::from(" WHERE 1=1");
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(pid) = product_id {
            values.push(Box::new(pid));
            where_sql.push_str(&format!(" AND m.product_id=?{}", values.len()));
        }
        if let Some(t) = type_ {
            if !t.trim().is_empty() {
                values.push(Box::new(t.trim().to_string()));
                where_sql.push_str(&format!(" AND m.type=?{}", values.len()));
            }
        }
        if let Some(r) = reason {
            if !r.trim().is_empty() {
                values.push(Box::new(format!("%{}%", r.trim())));
                where_sql.push_str(&format!(" AND m.reason LIKE ?{}", values.len()));
            }
        }
        if let Some(f) = from {
            if !f.trim().is_empty() {
                values.push(Box::new(f.trim().to_string()));
                where_sql.push_str(&format!(" AND date(m.date) >= date(?{})", values.len()));
            }
        }
        if let Some(t) = to {
            if !t.trim().is_empty() {
                values.push(Box::new(t.trim().to_string()));
                where_sql.push_str(&format!(" AND date(m.date) <= date(?{})", values.len()));
            }
        }

        let total: i64 = {
            let sql = format!("SELECT COUNT(*) FROM inventory_movements m{}", where_sql);
            let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|p| p.as_ref()).collect();
            conn.query_row(&sql, params_ref.as_slice(), |r| r.get(0))?
        };

        values.push(Box::new(limit.max(1)));
        let limit_idx = values.len();
        values.push(Box::new(offset.max(0)));
        let offset_idx = values.len();
        let sql = format!(
            "SELECT m.id, m.date, m.product_id, m.type, m.quantity, m.reason, m.reference, p.name
             FROM inventory_movements m LEFT JOIN products p ON p.id = m.product_id{where_sql}
             ORDER BY m.id DESC LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(InventoryMovement {
                id: r.get(0)?, date: r.get(1)?, product_id: r.get(2)?, r#type: r.get(3)?,
                quantity: r.get(4)?, reason: r.get(5)?, reference: r.get(6)?, product_name: r.get(7)?,
            })
        })?;
        let mut items = Vec::new();
        for row in rows { items.push(row?); }
        Ok(MovementPage { items, total })
    }

    /// Fusiona dos productos DUPLICADOS: mueve stock, movimientos, ventas,
    /// servicios y pedidos al que se queda, y borra el otro. Suma el stock
    /// (son bins distintos del mismo repuesto).
    pub fn merge_products(&self, keep_id: i64, remove_id: i64) -> SqlResult<()> {
        if keep_id == remove_id {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let remove_stock: i64 = tx.query_row(
            "SELECT COALESCE(stock,0) FROM products WHERE id=?1", params![remove_id], |r| r.get(0),
        )?;
        tx.execute("UPDATE products SET stock = stock + ?1 WHERE id=?2", params![remove_stock, keep_id])?;
        // referencias: se repuntan al producto que queda
        for sql in [
            "UPDATE inventory_movements SET product_id=?1 WHERE product_id=?2",
            "UPDATE sales SET product_id=?1 WHERE product_id=?2",
            "UPDATE services SET screen_product_id=?1 WHERE screen_product_id=?2",
            "UPDATE purchase_order_items SET product_id=?1 WHERE product_id=?2",
        ] {
            let _ = tx.execute(sql, params![keep_id, remove_id]);
        }
        tx.execute("DELETE FROM products WHERE id=?1", params![remove_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Restaura costo/venta desde la lista de precios (JSON `cellworld_items.json`).
    /// `path = None` busca el archivo junto al .exe / en la raíz del proyecto.
    pub fn restore_prices_from_file(
        &self,
        path: Option<&str>,
        only_zero: bool,
        dry_run: bool,
    ) -> SqlResult<crate::catalog::PriceRestoreReport> {
        let file = match path {
            Some(p) if !p.trim().is_empty() => PathBuf::from(p),
            _ => crate::catalog::find_price_list_file().ok_or_else(|| {
                day_shift_error("No encontré la lista de precios (cellworld_items.json). Elige el archivo con Examinar.")
            })?,
        };
        let content = std::fs::read_to_string(&file).map_err(|e| {
            day_shift_error(&format!("No se pudo leer {}: {e}", file.display()))
        })?;
        let conn = self.conn.lock().unwrap();
        crate::catalog::restore_prices(&conn, &content, only_zero, dry_run)
    }

    pub fn add_product(&self, name: &str, category_id: Option<i64>, brand: &str, model: &str,
                       variant: &str, compatibility: &str, price_cost: f64, price_sale: f64,
                       stock: i64, min_stock: i64, price_usd: f64) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        // Marca/modelo/variante/compatibilidad se guardan CANÓNICOS (mismas reglas
        // que la limpieza masiva). El nombre lo escribe el operario y se respeta.
        let cat = Self::category_name(&conn, category_id);
        let n = crate::catalog::normalize_fields(&cat, brand, model, variant, compatibility);
        let search = crate::catalog::search_text(name, &n.brand, &n.model, &n.variant, &n.compatibility);
        conn.execute(
            "INSERT INTO products (name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock, price_usd, search_text, in_use) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![name, category_id, n.brand, n.model, n.variant, n.compatibility, price_cost, price_sale, stock, min_stock, price_usd, search,
                // F50 — MISMA regla que el seed de la migración: arranca EN USO lo que tiene stock y
                // lo demás se marca a mano (un toque en Inventario). Una sola regla, sin sorpresas.
                if stock > 0 { 1 } else { 0 }],
        )?;
        // OJO: el rowid se captura ANTES del rebuild (que inserta en `phones`)
        let new_id = conn.last_insert_rowid();
        // F50: código corto del producto («P-0142») y, si nace con stock, queda EN USO (el mismo
        // criterio del seed de la migración: lo que entra al cajón es lo que el taller usa).
        let _ = conn.execute(
            "UPDATE products SET code = 'P-' || printf('%04d', id) WHERE id=?1 AND (code IS NULL OR code='')",
            params![new_id],
        );
        // el padrón de teléfonos sigue la compatibilidad del catálogo
        // F50: los teléfonos que NACEN con este producto se numeran (`M-…`) y, si el producto entró
        // al cajón (stock > 0), quedan EN USO — la misma regla del seed de la migración. Un modelo
        // que YA existía no se toca: si el dueño lo apagó a mano, el sistema no se lo vuelve a
        // prender (para prender todo un modelo está «usar todo el modelo», a un toque).
        let ultimo_phone: i64 = conn
            .query_row("SELECT COALESCE(MAX(id),0) FROM phones", [], |r| r.get(0))
            .unwrap_or(0);
        let _ = crate::catalog::rebuild_phones(&conn, false);
        let _ = conn.execute(
            "UPDATE phones SET code = 'M-' || printf('%04d', id) WHERE id > ?1 AND (code IS NULL OR code='')",
            params![ultimo_phone],
        );
        let _ = conn.execute(
            "UPDATE phones SET in_use=?1 WHERE id > ?2",
            params![if stock > 0 { 1 } else { 0 }, ultimo_phone],
        );
        Ok(new_id)
    }

    // ── F50: «LO QUE USO» (el check) + CÓDIGOS DE REFERENCIA ────────────────────────────────────
    // Comandos ANGOSTOS (una columna cada uno): así el check del inventario no puede pisar precios,
    // stock ni compatibilidad, y el código se corrige sin tocar nada más.
    // El check NO toca el stock ni el descuento por servicio: solo decide qué se OFRECE al registrar.

    /// El local marca/desmarca un PRODUCTO (una pantalla concreta) como «lo uso».
    pub fn set_product_in_use(&self, id: i64, in_use: bool) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE products SET in_use=?1, updated_at=datetime('now','localtime') WHERE id=?2",
            params![if in_use { 1 } else { 0 }, id],
        )?;
        if changed == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        Ok(())
    }

    /// El local marca/desmarca un MODELO del padrón (el teléfono) como «lo uso».
    pub fn set_phone_in_use(&self, id: i64, in_use: bool) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE phones SET in_use=?1 WHERE id=?2",
            params![if in_use { 1 } else { 0 }, id],
        )?;
        if changed == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        Ok(())
    }

    /// «Usar todo el modelo» / «Apagar todo el modelo»: prende (o apaga) el teléfono Y TODOS sus
    /// repuestos en UNA transacción — así el padrón y el inventario no quedan en estados distintos.
    /// Devuelve cuántos productos cambiaron (para avisar en pantalla).
    pub fn set_phone_use_all(&self, phone_id: i64, in_use: bool) -> SqlResult<i64> {
        let mut conn = self.conn.lock().unwrap();
        let key: String = conn.query_row(
            "SELECT COALESCE(key,'') FROM phones WHERE id=?1", params![phone_id], |r| r.get(0),
        )?;
        let tx = conn.transaction()?;
        // ids de repuesto de ese teléfono: MISMA fuente que el padrón (clave + alias), sin depender
        // de un segundo criterio de compatibilidad.
        let total = {
            let mut cache = self.cache.lock().unwrap();
            let idx = cache.phone_index(&tx)?;
            let ids: Vec<i64> = idx.get(&key).map(|e| e.ids.iter().copied().collect()).unwrap_or_default();
            let mut n = 0i64;
            for id in ids {
                n += tx.execute(
                    "UPDATE products SET in_use=?1, updated_at=datetime('now','localtime') WHERE id=?2",
                    params![if in_use { 1 } else { 0 }, id],
                )? as i64;
            }
            n
        };
        tx.execute("UPDATE phones SET in_use=?1 WHERE id=?2", params![if in_use { 1 } else { 0 }, phone_id])?;
        tx.commit()?;
        Ok(total)
    }

    /// F53: la PANTALLA DE REFERENCIA del modelo (la que el local instala siempre). `None` = ninguna.
    pub fn set_phone_default_product(&self, phone_id: i64, product_id: Option<i64>) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        if let Some(pid) = product_id {
            let existe: i64 = conn.query_row("SELECT COUNT(*) FROM products WHERE id=?1", params![pid], |r| r.get(0))?;
            if existe == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        }
        conn.execute("UPDATE phones SET default_product_id=?1 WHERE id=?2", params![product_id, phone_id])?;
        Ok(())
    }

    /// Corregir el CÓDIGO de un producto (el número con el que el local lo dicta: `P-0142`).
    pub fn set_product_code(&self, id: i64, code: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let limpio = code.trim().to_uppercase();
        let changed = conn.execute(
            "UPDATE products SET code=?1, updated_at=datetime('now','localtime') WHERE id=?2",
            params![if limpio.is_empty() { None } else { Some(limpio) }, id],
        )?;
        if changed == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        Ok(())
    }

    /// Corregir el CÓDIGO de un teléfono del padrón (`M-007`).
    pub fn set_phone_code(&self, id: i64, code: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let limpio = code.trim().to_uppercase();
        conn.execute("UPDATE phones SET code=?1 WHERE id=?2", params![if limpio.is_empty() { None } else { Some(limpio) }, id])?;
        Ok(())
    }

    pub fn update_product(&self, id: i64, name: &str, category_id: Option<i64>, brand: &str, model: &str,
                          variant: &str, compatibility: &str, price_cost: f64, price_sale: f64,
                          stock: i64, min_stock: i64, price_usd: f64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let cat = Self::category_name(&conn, category_id);
        let n = crate::catalog::normalize_fields(&cat, brand, model, variant, compatibility);
        let search = crate::catalog::search_text(name, &n.brand, &n.model, &n.variant, &n.compatibility);
        conn.execute(
            "UPDATE products SET name=?1, category_id=?2, brand=?3, model=?4, variant=?5, compatibility=?6, price_cost=?7, price_sale=?8, stock=?9, min_stock=?10, price_usd=?11, updated_at=datetime('now','localtime'), search_text=?13 WHERE id=?12",
            params![name, category_id, n.brand, n.model, n.variant, n.compatibility, price_cost, price_sale, stock, min_stock, price_usd, id, search],
        )?;
        let _ = crate::catalog::rebuild_phones(&conn, false);
        Ok(())
    }

    /// Proveedor que trajo esta mercancía (lo anota la carga de inventario; se puede corregir
    /// en la ficha del producto). Vacío = se borra el dato.
    pub fn set_product_supplier(&self, id: i64, supplier: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE products SET supplier=?1, updated_at=datetime('now','localtime') WHERE id=?2",
            params![supplier.trim(), id],
        )?;
        Ok(())
    }

    pub fn delete_product(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM products WHERE id=?", params![id]).map_err(|e| {
            if let rusqlite::Error::SqliteFailure(f, _) = &e {
                if f.code == rusqlite::ErrorCode::ConstraintViolation {
                    return day_shift_error("Producto en uso (ventas, servicios o movimientos) — no se puede eliminar.");
                }
            }
            e
        })?;
        Ok(())
    }

    pub fn get_products(&self, search: &str, category_id: Option<i64>) -> SqlResult<Vec<Product>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = format!(
            "SELECT {PRODUCT_COLS} FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1"
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        // Búsqueda por TOKENS normalizados: "red note" encuentra "Xiaomi Redmi Note 11"
        // (el catálogo se guarda canónico, pero el operario sigue escribiendo como antes).
        let tokens = crate::catalog::search_tokens(search);
        let (clause, values) = crate::catalog::search_clause(&tokens, 1);
        sql.push_str(&clause);
        for v in values {
            param_values.push(Box::new(v));
        }
        if let Some(cid) = category_id {
            let idx = param_values.len() + 1;
            sql.push_str(&format!(" AND p.category_id=?{}", idx));
            param_values.push(Box::new(cid));
        }
        sql.push_str(" ORDER BY p.name");

        let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(Product {
                id: r.get(0)?,
                name: r.get(1)?,
                category_id: r.get(2)?,
                brand: r.get(3)?,
                model: r.get(4)?,
                variant: r.get(5)?,
                compatibility: r.get(6)?,
                price_cost: r.get(7)?,
                price_sale: r.get(8)?,
                stock: r.get(9)?,
                min_stock: r.get(10)?,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
                category_name: r.get(14)?,
                price_usd: r.get(13)?,
                supplier: r.get(15).unwrap_or_default(),
                        in_use: r.get(16).unwrap_or(1), code: r.get(17).unwrap_or_default(),
            })
        })?;
        let mut products = Vec::new();
        for row in rows {
            products.push(row?);
        }
        Ok(products)
    }

    pub fn get_low_stock_products(&self) -> SqlResult<Vec<Product>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {PRODUCT_COLS} FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.stock <= p.min_stock ORDER BY p.stock ASC"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok(Product {
                id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?,
                brand: r.get(3)?, model: r.get(4)?, variant: r.get(5)?,
                compatibility: r.get(6)?, price_cost: r.get(7)?, price_sale: r.get(8)?,
                stock: r.get(9)?, min_stock: r.get(10)?, created_at: r.get(11)?,
                updated_at: r.get(12)?, category_name: r.get(14)?, price_usd: r.get(13)?, supplier: r.get(15).unwrap_or_default(),
                        in_use: r.get(16).unwrap_or(1), code: r.get(17).unwrap_or_default(),
            })
        })?;
        let mut products = Vec::new();
        for row in rows { products.push(row?); }
        Ok(products)
    }

    // Sugerencias de reposición: productos que se venden/usan y están bajos
    // (stock negativo, min_stock definido y bajo, o que han tenido salidas en inventory_movements)
    pub fn get_reorder_suggestions(&self) -> SqlResult<Vec<Product>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {PRODUCT_COLS} FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.stock < 0
                OR (p.min_stock > 0 AND p.stock <= p.min_stock)
                OR EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id AND m.type = 'salida' AND p.stock <= 0)
             ORDER BY p.stock ASC"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok(Product {
                id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?,
                brand: r.get(3)?, model: r.get(4)?, variant: r.get(5)?,
                compatibility: r.get(6)?, price_cost: r.get(7)?, price_sale: r.get(8)?,
                stock: r.get(9)?, min_stock: r.get(10)?, created_at: r.get(11)?,
                updated_at: r.get(12)?, category_name: r.get(14)?, price_usd: r.get(13)?, supplier: r.get(15).unwrap_or_default(),
                        in_use: r.get(16).unwrap_or(1), code: r.get(17).unwrap_or_default(),
            })
        })?;
        let mut products = Vec::new();
        for row in rows { products.push(row?); }
        Ok(products)
    }

    // --- Sales ---
    /// F74 — la venta CON IVA: `total` es lo que pagó el cliente (con IVA si el modo es «agregado») y
    /// la alícuota/modo quedan anotados en la fila. `add_sale` (13 parámetros, compatibilidad con los
    /// llamadores de siempre) delega acá con 0/'' = sin IVA: así ninguna llamada vieja cambia.
    pub fn add_sale(&self, product_id: Option<i64>, product_name: &str, quantity: i64, unit_price: f64,
                    total: f64, payment_method: &str, client_name: &str, client_id: Option<i64>, notes: &str,
                    bank_fee_percent: f64, zelle_reference: &str, currency: &str, discount_amount: f64) -> SqlResult<()> {
        self.add_sale_tax(product_id, product_name, quantity, unit_price, total, payment_method, client_name,
                          client_id, notes, bank_fee_percent, zelle_reference, currency, discount_amount, 0.0, "")
    }

    pub fn add_sale_tax(&self, product_id: Option<i64>, product_name: &str, quantity: i64, unit_price: f64,
                    total: f64, payment_method: &str, client_name: &str, client_id: Option<i64>, notes: &str,
                    bank_fee_percent: f64, zelle_reference: &str, currency: &str, discount_amount: f64,
                    // F74 — el IVA con el que se cargó ESTA venta (0/'' = sin IVA). `total` es lo que
                    // pagó el cliente (con IVA si el modo es «agregado»).
                    iva_rate: f64, iva_mode: &str) -> SqlResult<()> {
        if quantity <= 0 || unit_price < 0.0 || total < 0.0 {
            return Err(day_shift_error("Cantidad y montos deben ser positivos."));
        }
        let bank_fee_amount = if bank_fee_percent > 0.0 { total * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = total - bank_fee_amount;
        let client_name = title_case(client_name.trim());
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO sales (product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, discount_amount, iva_rate, iva_mode) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, discount_amount, if iva_rate > 0.0 { iva_rate } else { 0.0 }, if iva_rate > 0.0 { iva_mode } else { "" }],
        )?;
        let sale_id = tx.last_insert_rowid();
        if let Some(pid) = product_id {
            tx.execute("UPDATE products SET stock = stock - ?1 WHERE id=?2", params![quantity, pid])?;
            tx.execute(
                "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference) VALUES (?1, 'salida', ?2, 'Venta', ?3)",
                params![pid, quantity, format!("Venta #{}", sale_id)],
            )?;
        }
        // Update client total_spent and last_purchase
        if let Some(cid) = client_id {
            tx.execute(
                "UPDATE clients SET total_spent = total_spent + ?1, last_purchase = datetime('now','localtime') WHERE id=?2",
                params![total, cid],
            )?;
        }
        // F68/F40: la venta queda en el LIBRO DE PLATA con su AUTOR (quién la cobró). El monto va
        // en la moneda del método (lo que realmente entró a la caja o al banco) y neto de comisión.
        self.book_movement(&tx, &NewCashMovement {
            r#type: "venta",
            method: payment_method,
            currency,
            amount: net_amount,
            sign: 1,
            reference: zelle_reference,
            sale_id: Some(sale_id),
            service_id: None,
            payment_id: None,
            expense_id: None,
            note: "",
            when: None,
        })?;
        tx.commit()?;
        Ok(())
    }

    /// F70 — ANULAR UNA VENTA (con reverso de stock). El bloqueante A3 de la auditoría de entrega: una
    /// venta mal tecleada quedaba en la caja de ese día **para siempre** (no existía `update_sale` ni
    /// `delete_sale`) y una pantalla vendida y devuelta **no volvía al stock**.
    ///
    /// Reglas (todas probadas en `test_void_sale_*`):
    ///   · **La venta NO se borra**: se marca (`voided_at` + `void_reason`) y sigue en la lista tachada.
    ///   · **Día de la venta ABIERTO**: un cierre guardado no se recalcula. Si ya se cerró, el error dice
    ///     el camino real (↺ → anular → volver a cerrar), igual que F35 con la fecha de un pago.
    ///   · **Reverso de stock** (`stock + quantity`) con su movimiento de inventario de ENTRADA.
    ///   · **`clients.total_spent`** baja por el total (si la venta era de un cliente del padrón).
    ///   · **Contra-asiento en el libro** (tipo `venta_anulada`, MISMO método/moneda/monto neto, signo
    ///     −1) con el autor de la sesión, el motivo y **el día de la venta** (no el de hoy).
    ///   · Doble anulación rechazada; el dueño es el único que puede (lo pide el comando).
    pub fn void_sale(&self, id: i64, reason: &str) -> SqlResult<()> {
        let motivo = reason.trim();
        if motivo.is_empty() {
            return Err(day_shift_error("Hay que decir por qué se anula la venta."));
        }
        let conn = self.conn.lock().unwrap();
        let fila: Option<(Option<i64>, i64, f64, f64, String, Option<String>, Option<i64>, Option<String>)> = conn
            .query_row(
                "SELECT product_id, quantity, total, COALESCE(net_amount, total), COALESCE(payment_method,''),
                        currency, client_id, voided_at
                 FROM sales WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
            )
            .optional()?;
        let Some((product_id, cantidad, total, neto, metodo, moneda, client_id, ya_anulada)) = fila else {
            return Err(day_shift_error("Esa venta no existe."));
        };
        if ya_anulada.is_some() {
            return Err(day_shift_error("Esa venta ya está anulada."));
        }
        // El día de la VENTA (no el de hoy): la anulación pertenece a la caja de ese día.
        let dia_venta: String = conn.query_row(
            "SELECT date(date) FROM sales WHERE id=?1", params![id], |r| r.get(0),
        )?;
        let dia_abierto: Option<i64> = conn
            .query_row(
                "SELECT id FROM daily_closings WHERE close_date=?1 AND is_closed=0",
                params![dia_venta], |r| r.get(0),
            )
            .optional()?;
        if dia_abierto.is_none() {
            let cerrado: Option<i64> = conn
                .query_row(
                    "SELECT id FROM daily_closings WHERE close_date=?1 AND is_closed=1",
                    params![dia_venta], |r| r.get(0),
                )
                .optional()?;
            return Err(day_shift_error(&if cerrado.is_some() {
                format!(
                    "El día {} ya está CERRADO con su arqueo: el dueño lo reabre (Libro Diario → Cierres → ↺), \
                     anula la venta y vuelve a cerrarlo.", dia_venta)
            } else {
                format!("El día {} de esa venta no tiene turno abierto: no se puede anular.", dia_venta)
            }));
        }
        let tx = conn.unchecked_transaction()?;
        let cambiadas = tx.execute(
            "UPDATE sales SET voided_at=datetime('now','localtime'), void_reason=?2 WHERE id=?1 AND voided_at IS NULL",
            params![id, motivo],
        )?;
        if cambiadas == 0 {
            return Err(day_shift_error("Esa venta ya está anulada."));
        }
        // Reverso de STOCK + movimiento de inventario (la historia del movimiento se conserva).
        if let Some(pid) = product_id {
            tx.execute("UPDATE products SET stock = stock + ?1 WHERE id=?2", params![cantidad, pid])?;
            tx.execute(
                "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference) VALUES (?1, 'entrada', ?2, 'Anulación de venta', ?3)",
                params![pid, cantidad, format!("Venta #{}", id)],
            )?;
        }
        if let Some(cid) = client_id {
            tx.execute(
                "UPDATE clients SET total_spent = MAX(0, total_spent - ?1) WHERE id=?2",
                params![total, cid],
            )?;
        }
        // Contra-asiento: mismo método/moneda/monto NETO, signo invertido, autor y motivo. El `day` es
        // el de la venta (`date` del movimiento original) para que el arqueo de ESE día deje de contarla.
        let original: Option<(String, String)> = tx
            .query_row(
                "SELECT date, day FROM cash_movements WHERE sale_id=?1 AND type='venta' ORDER BY id LIMIT 1",
                params![id], |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (fecha_original, _) = original.unwrap_or_else(|| (dia_venta.clone(), dia_venta.clone()));
        self.book_movement(&tx, &NewCashMovement {
            r#type: "venta_anulada",
            method: &metodo,
            currency: moneda.as_deref().unwrap_or("USD"),
            amount: neto,
            sign: -1,
            reference: "",
            sale_id: Some(id),
            service_id: None,
            payment_id: None,
            expense_id: None,
            note: motivo,
            when: Some(&fecha_original),
        })?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_sales(&self, search: &str, days: Option<i64>, start_date: &str, end_date: &str) -> SqlResult<Vec<Sale>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from("SELECT s.id, s.date, s.product_id, s.product_name, s.quantity, s.unit_price, s.total, s.payment_method, s.client_name, s.notes, s.client_id, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, c.ci AS client_ci, s.discount_amount, s.voided_at, s.void_reason, s.iva_rate, s.iva_mode FROM sales s LEFT JOIN clients c ON s.client_id = c.id WHERE 1=1");
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if !search.is_empty() {
            sql.push_str(" AND (s.product_name LIKE ?1 OR s.client_name LIKE ?1 OR c.ci LIKE ?1)");
            param_values.push(Box::new(format!("%{}%", search)));
        }
        if let Some(d) = days {
            let _ = param_values.len();
            sql.push_str(&format!(" AND date(s.date) >= date('now','localtime', '-{} days')", d));
        }
        if !start_date.is_empty() {
            let idx = param_values.len() + 1;
            sql.push_str(&format!(" AND date(s.date) >= ?{}", idx));
            param_values.push(Box::new(start_date.to_string()));
        }
        if !end_date.is_empty() {
            let idx = param_values.len() + 1;
            sql.push_str(&format!(" AND date(s.date) <= ?{}", idx));
            param_values.push(Box::new(end_date.to_string()));
        }
        sql.push_str(" ORDER BY s.date DESC");

        let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(Sale {
                id: r.get(0)?, date: r.get(1)?, product_id: r.get(2)?,
                product_name: r.get(3)?, quantity: r.get(4)?, unit_price: r.get(5)?,
                total: r.get(6)?, payment_method: r.get(7)?, client_name: r.get(8)?,
                notes: r.get(9)?, client_id: r.get(10)?,
                bank_fee_percent: r.get(11).unwrap_or(0.0),
                bank_fee_amount: r.get(12).unwrap_or(0.0),
                net_amount: r.get(13).unwrap_or(0.0),
                zelle_reference: r.get(14).unwrap_or(None),
                currency: r.get(15).unwrap_or(Some("USD".into())),
                client_ci: r.get(16).unwrap_or(None),
                discount_amount: r.get(17).unwrap_or(0.0),
                voided_at: r.get(18).unwrap_or(None),
                void_reason: r.get(19).unwrap_or(None),
                iva_rate: r.get(20).unwrap_or(0.0),
                iva_mode: r.get(21).unwrap_or_default(),
            })
        })?;
        let mut sales = Vec::new();
        for row in rows { sales.push(row?); }
        Ok(sales)
    }

    pub fn get_sales_stats(&self, days: i64) -> SqlResult<Vec<SaleStat>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.product_name, s.product_id, SUM(s.quantity) as qty, SUM(s.total) as total, COUNT(*) as count
             FROM sales s WHERE date(s.date) >= date('now','localtime', ?1) AND s.voided_at IS NULL
             GROUP BY s.product_name ORDER BY total DESC"
        )?;
        let rows = stmt.query_map(params![format!("-{} days", days)], |r| {
            Ok(SaleStat {
                product_name: r.get(0)?, product_id: r.get(1)?,
                qty: r.get(2)?, total: r.get(3)?, count: r.get(4)?,
            })
        })?;
        let mut stats = Vec::new();
        for row in rows { stats.push(row?); }
        Ok(stats)
    }

    // --- Services ---
    pub fn add_service(&self, order_num: &str, client: &str, phone: &str, model: &str,
                       fault: &str, service_type: &str, service_types: &str, amount: f64, payment_method: &str, observations: &str,
                       bank_fee_percent: f64, zelle_reference: &str, currency: &str,
                       client_ci: &str, client_address: &str, device_checklist: &str,
                       client_id: Option<i64>, technician: &str, technician_id: Option<i64>,
                       color: &str, screen_product_id: Option<i64>, discount_amount: f64) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        // F32: `add_service` (compatibilidad) no elige estado → histórico 'Por entregar'.
        Self::insert_service_row(&conn, order_num, None, client, phone, model, fault, service_type, service_types, amount, payment_method, observations, bank_fee_percent, zelle_reference, currency, client_ci, client_address, device_checklist, client_id, technician, technician_id, color, screen_product_id, discount_amount, "", 0.0, "")
    }

    // Insert transaccional conn-level (sin lock: lo comparte add_service y add_service_order).
    // group_id: None = orden de un solo equipo (compatible con datos viejos).
    // F32: `status` = estado con el que nace la orden. Vacío (llamadores viejos como
    // `add_service`) → el histórico 'Por entregar' de la tabla; el wizard de recepción manda
    // el estado elegido ('Recibido' por defecto) para que el flujo arranque donde corresponde.
    #[allow(clippy::too_many_arguments)]
    fn insert_service_row(conn: &rusqlite::Connection, order_num: &str, group_id: Option<&str>,
                          client: &str, phone: &str, model: &str,
                          fault: &str, service_type: &str, service_types: &str, amount: f64, payment_method: &str, observations: &str,
                          bank_fee_percent: f64, zelle_reference: &str, currency: &str,
                          client_ci: &str, client_address: &str, device_checklist: &str,
                          client_id: Option<i64>, technician: &str, technician_id: Option<i64>,
                          color: &str, screen_product_id: Option<i64>, discount_amount: f64,
                          status: &str,
                          // F74 — IVA del equipo (0/'' = sin IVA). `amount` es lo que paga el cliente.
                          iva_rate: f64, iva_mode: &str) -> SqlResult<i64> {
        let bank_fee_amount = if bank_fee_percent > 0.0 { amount * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = amount - bank_fee_amount;
        let client = title_case(client.trim());
        let status_val: &str = if status.trim().is_empty() { "Por entregar" } else { status.trim() };
        let iva_rate_val = if iva_rate > 0.0 { iva_rate } else { 0.0 };
        let iva_mode_val: &str = if iva_rate_val > 0.0 { iva_mode } else { "" };
        conn.execute(
            "INSERT INTO services (order_num, client, phone, model, fault, service_type, service_types, amount, payment_method, observations, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, client_ci, client_address, device_checklist, client_id, paid_amount, technician, technician_id, group_id, color, screen_product_id, discount_amount, status, iva_rate, iva_mode) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,0,?20,?21,?22,?23,?24,?25,?26,?27,?28)",
            params![order_num, client, phone, model, fault, service_type, if service_types.trim().is_empty() { None } else { Some(service_types) }, amount, payment_method, observations, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, if client_ci.is_empty() { None } else { Some(client_ci) }, if client_address.is_empty() { None } else { Some(client_address) }, if device_checklist.is_empty() { None } else { Some(device_checklist) }, client_id, if technician.trim().is_empty() { None } else { Some(technician) }, technician_id, group_id, if color.trim().is_empty() { None } else { Some(color) }, screen_product_id, discount_amount, status_val, iva_rate_val, iva_mode_val],
        )?;
        Ok(conn.last_insert_rowid())
    }

    // Orden multi-equipo: un cliente, N teléfonos, UNA orden (mismo group_id).
    // Transaccional: si un equipo falla, NO se guarda ninguno.
    // Números: equipo 1 = base ("DEV-0001"), equipos 2+ = base + sufijo ("DEV-0001-B", ...).
    pub fn add_service_order(&self, client: &str, phone: &str, client_ci: &str, client_address: &str,
                             client_id: Option<i64>, technician: &str, technician_id: Option<i64>,
                             devices: &[ServiceDeviceInput]) -> SqlResult<String> {
        if devices.is_empty() {
            return Err(day_shift_error("Debe agregar al menos un equipo."));
        }
        for (i, d) in devices.iter().enumerate() {
            if d.model.trim().is_empty() {
                return Err(day_shift_error(&format!("Equipo {}: el modelo es obligatorio.", i + 1)));
            }
            // F32: una orden NUEVA no puede nacer ENTREGADA (ni anulada). El INSERT no escribe
            // `date_out` ni toca el stock —eso lo hace el cambio de estado, con el asistente
            // «Cerrar»—, así que nacer en «Entregado» dejaba la orden sin fecha de entrega (fuera
            // del panel «Entregados hoy» y sin garantía) y con el stock sin descontar. Entregar es
            // un ACTO aparte de recibir: se hace con el estado y ahí caen todas las reglas.
            if !es_estado_de_taller(&d.status) {
                let estado = if d.status.trim().is_empty() { "Por entregar" } else { d.status.trim() };
                return Err(day_shift_error(&format!(
                    "Equipo {}: una orden nueva no puede nacer en «{}». Recibilo en un estado de taller \
                     y entregalo desde la tarjeta con «Cerrar» (así se cobra, se descuenta el stock y queda la fecha).",
                    i + 1, estado)));
            }
        }
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        let tx = conn.unchecked_transaction()?;
        let base = Self::next_order_num_on(&tx)?;
        let group_id = if devices.len() > 1 { Some(base.as_str()) } else { None };
        for (i, d) in devices.iter().enumerate() {
            let order_num = if i == 0 {
                base.clone()
            } else {
                let suffix = char::from(b'A' + (i - 1) as u8);
                format!("{}-{}", base, suffix)
            };
            Self::insert_service_row(&tx, &order_num, group_id, client, phone, &d.model, &d.fault,
                                     &d.service_type, &d.service_types, d.amount, &d.payment_method, &d.observations,
                                     d.bank_fee_percent, &d.zelle_reference, &d.currency,
                                     client_ci, client_address, &d.device_checklist,
                                     client_id, technician, technician_id, &d.color, d.screen_product_id, d.discount_amount,
                                     &d.status, d.iva_rate, &d.iva_mode)?;
        }
        tx.commit()?;
        Ok(base)
    }

    pub fn update_service(&self, id: i64, client: &str, phone: &str, model: &str, fault: &str,
                          service_type: &str, service_types: &str, amount: f64, payment_method: &str, date_out: &str, status: &str, observations: &str,
                          bank_fee_percent: f64, zelle_reference: &str, currency: &str,
                          client_ci: &str, client_address: &str, device_checklist: &str,
                          technician: &str, technician_id: Option<i64>, color: &str,
                          screen_product_id: Option<i64>, discount_amount: f64) -> SqlResult<()> {
        let bank_fee_amount = if bank_fee_percent > 0.0 { amount * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = amount - bank_fee_amount;
        let client = title_case(client.trim());
        let conn = self.conn.lock().unwrap();

        // Auto-inventory: if status changes to Entregado → deduct the EXACT screen chosen
        // (screen_product_id) or match by model (legacy); if leaves Entregado → return stock.
        // Gate: solo trabajos que incluyen "Cambio pantalla" consumen inventario (harness 2026-08-12).
        let prev_status: Option<String> = conn
            .query_row("SELECT status FROM services WHERE id=?1", params![id], |r| r.get(0))
            .optional()?;
        if let Some(prev) = prev_status.as_deref() {
            if prev != status {
                let order_num: String = conn
                    .query_row("SELECT COALESCE(order_num,'') FROM services WHERE id=?1", params![id], |r| r.get(0))
                    .unwrap_or_default();
                if status == "Entregado" {
                    self.apply_service_stock(&conn, model, screen_product_id, service_types, service_type, &order_num, -1)?;
                } else if prev == "Entregado" {
                    self.apply_service_stock(&conn, model, screen_product_id, service_types, service_type, &order_num, 1)?;
                }
            }
        }

        // Garantía: la fecha de entrega SIEMPRE es la del día de la entrega.
        // Al entregar sin fecha → hoy; al reabrir un entregado → se limpia (la nueva entrega reinicia la garantía de 7 días).
        let effective_date_out: String = if status == "Entregado" {
            if date_out.trim().is_empty() {
                chrono::Local::now().format("%Y-%m-%d").to_string()
            } else {
                date_out.to_string()
            }
        } else if prev_status.as_deref() == Some("Entregado") {
            String::new()
        } else {
            date_out.to_string()
        };

        conn.execute(
            "UPDATE services SET client=?1, phone=?2, model=?3, fault=?4, service_type=?16, service_types=?20, amount=?5, payment_method=?6, date_out=?7, status=?8, observations=?9, bank_fee_percent=?11, bank_fee_amount=?12, net_amount=?13, zelle_reference=?14, currency=?15, client_ci=?17, client_address=?18, device_checklist=?19, technician=?21, technician_id=?22, color=?23, screen_product_id=?24, discount_amount=?25 WHERE id=?10",
            params![client, phone, model, fault, amount, payment_method, if effective_date_out.is_empty() { None } else { Some(effective_date_out.as_str()) }, status, observations, id, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, service_type, if client_ci.is_empty() { None } else { Some(client_ci) }, if client_address.is_empty() { None } else { Some(client_address) }, if device_checklist.is_empty() { None } else { Some(device_checklist) }, if service_types.trim().is_empty() { None } else { Some(service_types) }, if technician.trim().is_empty() { None } else { Some(technician) }, technician_id, if color.trim().is_empty() { None } else { Some(color) }, screen_product_id, discount_amount],
        )?;
        Ok(())
    }

    // Marca la factura de un servicio como IMPRESA (printed=1).
    // El badge "Sin imprimir" desaparece al imprimir desde la tarjeta o tras guardar.
    pub fn mark_service_printed(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE services SET printed=1 WHERE id=?1", params![id])?;
        Ok(())
    }

    // F32 — SEÑALES DE POLÍTICA del taller (recordatorios del operario).
    //
    // Por qué un comando ANGOSTO y no `update_service`: ese UPDATE recibe la fila completa en 25
    // parámetros POSICIONALES (lección InvalidColumnType) y lo llaman 3 caminos de la UI; agregarle
    // campos de política obligaría a tocar todos y una llamada incompleta PISARÍA datos de la orden.
    // Acá se escribe UNA columna, elegida de una whitelist (nunca se interpola texto del frontend).
    //
    //  · clave `photo_in`  → photo_in_at  (valor "si" = el BACKEND estampa la hora local; "" = limpiar)
    //  · clave `photo_out` → photo_out_at (igual)
    //  · clave `pay_intent` → pay_intent  ("ahora" | "al_retirar" | "" = no se preguntó)
    //
    // No exige día abierto (es una anotación, no dinero) y NO toca montos, abonos, stock, fechas
    // ni el estado de la orden.
    pub fn set_service_policy(&self, id: i64, key: &str, value: &str) -> SqlResult<()> {
        // Columnas de fecha: se estampa la hora LOCAL (regla B6: nunca UTC para "hoy").
        let stamp_sql = match key {
            "photo_in" => "UPDATE services SET photo_in_at = CASE WHEN ?2 = 'si' THEN datetime('now','localtime') ELSE NULL END WHERE id = ?1",
            "photo_out" => "UPDATE services SET photo_out_at = CASE WHEN ?2 = 'si' THEN datetime('now','localtime') ELSE NULL END WHERE id = ?1",
            "pay_intent" => {
                let v = value.trim();
                if !matches!(v, "" | "ahora" | "al_retirar") {
                    return Err(day_shift_error("Acuerdo de pago inválido: usá 'ahora' o 'al_retirar'."));
                }
                "UPDATE services SET pay_intent = CASE WHEN ?2 = '' THEN NULL ELSE ?2 END WHERE id = ?1"
            }
            other => return Err(day_shift_error(&format!("Recordatorio desconocido: {}", other))),
        };
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(stamp_sql, params![id, value.trim()])?;
        if changed == 0 {
            return Err(day_shift_error("Orden no encontrada."));
        }
        Ok(())
    }

    // Ajusta el stock de la pantalla de un servicio. Reglas (harness 2026-08-12):
    // - Gate: SOLO si el trabajo incluye "Cambio pantalla" (service_types JSON, fallback
    //   service_type para órdenes viejas). Batería/software/limpieza NO consumen pantalla.
    // - screen_pid presente → descuenta/devuelve ESE producto exacto (pantalla elegida en el
    //   desplegable de compatibilidad). Inventario exacto de pantallas, sin adivinar.
    // - sin screen_pid (órdenes legacy / sin elegir) → matching por modelo: compatibilidad JSON
    //   exacta → nombre/modelo exacto → LIKE determinista. NUNCA auto-crea productos: si el
    //   modelo no matchea nada, no descuenta (regla: aviso sin descuento, no fantasmas).
    fn apply_service_stock(&self, conn: &rusqlite::Connection, model: &str, screen_pid: Option<i64>,
                           service_types: &str, service_type: &str, order_num: &str, delta: i64) -> SqlResult<i64> {
        let is_screen_job = serde_json::from_str::<Vec<String>>(service_types)
            .map(|v| v.iter().any(|t| t == "Cambio pantalla"))
            .unwrap_or_else(|_| service_type.trim() == "Cambio pantalla");
        if !is_screen_job || model.trim().is_empty() {
            return Ok(0);
        }

        // Descuento EXACTO: pantalla elegida por el técnico en la orden.
        if let Some(pid) = screen_pid {
            conn.execute("UPDATE products SET stock = stock + ?1 WHERE id=?2", params![delta, pid])?;
            let new_stock: i64 = conn
                .query_row("SELECT COALESCE(stock,0) FROM products WHERE id=?1", params![pid], |r| r.get(0))
                .unwrap_or(0);
            let mov_type = if delta < 0 { "salida" } else { "entrada" };
            // Entregar una pantalla sin stock deja faltante: queda registrado como tal
            // (la mercancía salió de verdad del local — no se esconde el descuadre).
            let reason = if delta < 0 {
                if new_stock < 0 { "Servicio Entregado (faltante)" } else { "Servicio Entregado" }
            } else {
                "Servicio Reabierto"
            };
            conn.execute(
                "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![pid, mov_type, delta.abs(), reason, ref_label(order_num)],
            )?;
            return Ok(new_stock);
        }

        // Legacy: match por modelo contra pantallas del catálogo (sin auto-create).
        let target = norm_model(model);
        let mut product_id: Option<i64> = None;

        // 1) Match exacto contra compatibility JSON (modelos individuales) o nombre del producto
        let mut stmt = conn.prepare(
            "SELECT id, name, compatibility FROM products WHERE category_id=1 AND compatibility IS NOT NULL AND compatibility != '' ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?))
        })?;
        for row in rows {
            let (pid, name, compat) = row?;
            let comp: Vec<String> = compat
                .as_deref()
                .and_then(|c| serde_json::from_str(c).ok())
                .unwrap_or_default();
            let name_norm = norm_model(&name);
            let name_models: Vec<String> = name_norm.split('/').map(norm_model).collect();
            if comp.iter().any(|c| norm_model(c) == target)
                || name_norm == target
                || name_models.iter().any(|m| m == &target)
            {
                product_id = Some(pid);
                break;
            }
        }

        // 2) Fallback determinista: LIKE en model/name ordenado por id (nunca por rowid implícito).
        if product_id.is_none() && !model.trim().is_empty() {
            let like = format!("%{}%", model.trim());
            product_id = conn
                .query_row(
                    "SELECT id FROM products WHERE category_id=1 AND (model LIKE ?1 OR name LIKE ?1) ORDER BY id ASC LIMIT 1",
                    params![like],
                    |r| r.get(0),
                )
                .optional()?;
        }

        let pid = match product_id {
            Some(pid) => pid,
            // Sin pantalla en catálogo → NO descontar ni crear fantasmas (regla: aviso sin descuento).
            None => return Ok(0),
        };

        conn.execute("UPDATE products SET stock = stock + ?1 WHERE id=?2", params![delta, pid])?;
        let new_stock: i64 = conn
            .query_row("SELECT COALESCE(stock,0) FROM products WHERE id=?1", params![pid], |r| r.get(0))
            .unwrap_or(0);
        let mov_type = if delta < 0 { "salida" } else { "entrada" };
        let reason = if delta < 0 {
            if new_stock < 0 { "Servicio Entregado (faltante)" } else { "Servicio Entregado" }
        } else {
            "Servicio Reabierto"
        };
        conn.execute(
            "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![pid, mov_type, delta.abs(), reason, ref_label(order_num)],
        )?;
        Ok(new_stock)
    }

    pub fn delete_service(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        // Si el servicio estaba entregado, devolver el stock antes de borrar
        // (usa la pantalla EXACTA elegida si existe; si no, matching por modelo legacy).
        let svc: Option<(String, String, Option<i64>, String, String, String)> = conn
            .query_row(
                "SELECT model, status, screen_product_id, COALESCE(service_types,''), COALESCE(service_type,''), COALESCE(order_num,'') FROM services WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()?;
        if let Some((model, status, screen_pid, s_types, s_type, order_num)) = svc {
            if status == "Entregado" {
                self.apply_service_stock(&conn, &model, screen_pid, &s_types, &s_type, &order_num, 1)?;
            }
        }
        // F69 (revisión adversarial, MAYOR): antes de borrar los cobros de la orden hay que dejar su
        // CONTRA-ASIENTO en el libro. Sin esto el libro seguía mostrando abonos que ya no existen (los
        // totales del día sí los perdían): el dueño veía plata que no entró y el libro quedaba
        // descuadrado para siempre, sólo arreglable con SQL a mano.
        let pagos: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM service_payments WHERE service_id=?1")?;
            let rows = stmt.query_map(params![id], |r| r.get::<_, i64>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for pid in pagos {
            self.reverse_book_entry(&conn, Some(pid), None, "Orden borrada")?;
        }
        conn.execute("DELETE FROM service_payments WHERE service_id=?", params![id])?;
        conn.execute("DELETE FROM services WHERE id=?", params![id])?;
        Ok(())
    }

    // --- Service Payments (abonos) ---
    pub fn get_service_payments(&self, service_id: i64) -> SqlResult<Vec<ServicePayment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, payment_date, notes FROM service_payments WHERE service_id = ?1 ORDER BY payment_date ASC, id ASC"
        )?;
        let rows = stmt.query_map(params![service_id], |r| {
            Ok(ServicePayment {
                id: r.get(0)?, service_id: r.get(1)?, amount: r.get(2)?,
                payment_method: r.get(3)?,
                bank_fee_percent: r.get(4).unwrap_or(0.0),
                bank_fee_amount: r.get(5).unwrap_or(0.0),
                net_amount: r.get(6).unwrap_or(0.0),
                zelle_reference: r.get(7).unwrap_or(None),
                currency: r.get(8).unwrap_or(Some("USD".into())),
                payment_date: r.get(9)?, notes: r.get(10)?,
            })
        })?;
        let mut payments = Vec::new();
        for row in rows { payments.push(row?); }
        Ok(payments)
    }

    /// Búsqueda cruzada de pagos de servicios con filtros opcionales.
    /// Devuelve pagos con info del servicio (orden, cliente, modelo) para UI de búsqueda.
    pub fn search_payments(&self, start_date: Option<&str>, end_date: Option<&str>,
                           method: Option<&str>, client: Option<&str>,
                           reference: Option<&str>, currency: Option<&str>) -> SqlResult<Vec<PaymentSearchResult>> {
        let conn = self.conn.lock().unwrap();
        let mut conditions = Vec::new();
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut idx = 1;
        if let Some(sd) = start_date {
            if !sd.is_empty() {
                conditions.push(format!("date(sp.payment_date) >= ?{}", idx));
                param_values.push(Box::new(sd.to_string()));
                idx += 1;
            }
        }
        if let Some(ed) = end_date {
            if !ed.is_empty() {
                conditions.push(format!("date(sp.payment_date) <= ?{}", idx));
                param_values.push(Box::new(ed.to_string()));
                idx += 1;
            }
        }
        if let Some(m) = method {
            if !m.is_empty() {
                conditions.push(format!("sp.payment_method = ?{}", idx));
                param_values.push(Box::new(m.to_string()));
                idx += 1;
            }
        }
        if let Some(c) = client {
            if !c.is_empty() {
                let pattern = format!("%{}%", c);
                conditions.push(format!("(s.client LIKE ?{} OR COALESCE(s.client_ci,'') LIKE ?{})", idx, idx + 1));
                param_values.push(Box::new(pattern.clone()));
                param_values.push(Box::new(pattern));
                idx += 2;
            }
        }
        if let Some(r) = reference {
            if !r.is_empty() {
                let pattern = format!("%{}%", r);
                conditions.push(format!("COALESCE(sp.zelle_reference,'') LIKE ?{}", idx));
                param_values.push(Box::new(pattern));
                idx += 1;
            }
        }
        if let Some(cr) = currency {
            if !cr.is_empty() {
                conditions.push(format!("sp.currency = ?{}", idx));
                param_values.push(Box::new(cr.to_string()));
            }
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let sql = format!(
            "SELECT sp.id, sp.service_id, s.order_num, s.client, COALESCE(s.client_ci,''), s.model,
                    sp.amount, sp.currency, sp.payment_method, sp.net_amount,
                    sp.zelle_reference, sp.payment_date, sp.notes
             FROM service_payments sp
             JOIN services s ON s.id = sp.service_id
             {} ORDER BY sp.payment_date DESC, sp.id DESC", where_clause
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params.as_slice(), |r| {
            Ok(PaymentSearchResult {
                id: r.get(0)?, service_id: r.get(1)?, order_num: r.get(2)?,
                client: r.get(3)?, client_ci: r.get(4)?, model: r.get(5)?,
                amount: r.get(6)?, currency: r.get(7)?, payment_method: r.get(8)?,
                net_amount: r.get(9)?, zelle_reference: r.get(10)?,
                payment_date: r.get(11)?, notes: r.get(12)?,
            })
        })?;
        let mut results = Vec::new();
        for row in rows { results.push(row?); }
        Ok(results)
    }

    /// Detalle de pagos de un día específico, opcionalmente filtrado por método.
    /// Para drill-down de reconciliación: el usuario hace clic en una celda de la tabla diaria
    /// y ve línea por línea qué pagos componen ese total.
    pub fn get_payment_daily_detail(&self, date: &str, method: Option<&str>) -> SqlResult<Vec<PaymentSearchResult>> {
        let conn = self.conn.lock().unwrap();
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match method {
            Some(m) if !m.is_empty() => (
                "SELECT sp.id, sp.service_id, s.order_num, s.client, COALESCE(s.client_ci,''), s.model,
                        sp.amount, sp.currency, sp.payment_method, sp.net_amount,
                        sp.zelle_reference, sp.payment_date, sp.notes
                 FROM service_payments sp
                 JOIN services s ON s.id = sp.service_id
                 WHERE date(sp.payment_date) = ?1 AND sp.payment_method = ?2
                 ORDER BY sp.payment_date ASC, sp.id ASC".to_string(),
                vec![Box::new(date.to_string()), Box::new(m.to_string())],
            ),
            _ => (
                "SELECT sp.id, sp.service_id, s.order_num, s.client, COALESCE(s.client_ci,''), s.model,
                        sp.amount, sp.currency, sp.payment_method, sp.net_amount,
                        sp.zelle_reference, sp.payment_date, sp.notes
                 FROM service_payments sp
                 JOIN services s ON s.id = sp.service_id
                 WHERE date(sp.payment_date) = ?1
                 ORDER BY sp.payment_date ASC, sp.id ASC".to_string(),
                vec![Box::new(date.to_string())],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params.as_slice(), |r| {
            Ok(PaymentSearchResult {
                id: r.get(0)?, service_id: r.get(1)?, order_num: r.get(2)?,
                client: r.get(3)?, client_ci: r.get(4)?, model: r.get(5)?,
                amount: r.get(6)?, currency: r.get(7)?, payment_method: r.get(8)?,
                net_amount: r.get(9)?, zelle_reference: r.get(10)?,
                payment_date: r.get(11)?, notes: r.get(12)?,
            })
        })?;
        let mut results = Vec::new();
        for row in rows { results.push(row?); }
        Ok(results)
    }

    /// F35: `payment_date` vacía = HOY (histórico). Una fecha anterior permite anotar un cobro en la
    /// caja del día en que REALMENTE entró la plata (ver `payment_date_ok`).
    pub fn add_service_payment(&self, service_id: i64, amount: f64, payment_method: &str,
                               bank_fee_percent: f64, zelle_reference: &str, currency: &str,
                               notes: &str, payment_date: &str) -> SqlResult<i64> {
        // Un monto negativo NO es un pago: sería una devolución encubierta que saltea el tope por
        // moneda y RESTA de la caja del día (bloqueante de la revisión adversarial de F36).
        if amount <= 0.0 {
            return Err(day_shift_error("El monto del pago debe ser mayor a 0. Para devolver dinero usá «Devolución»."));
        }
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        // Una orden devuelta o cancelada no acepta más pagos (antes esto solo existía en la UI).
        let estado: Option<String> = conn.query_row(
            "SELECT status FROM services WHERE id = ?1", params![service_id], |r| r.get(0),
        ).optional()?;
        let estado = estado.ok_or_else(|| day_shift_error("El servicio no existe."))?;
        if estado == "Devuelto" || estado == "Cancelado" || estado == "Cancelado / Devuelto" {
            return Err(day_shift_error(&format!("La orden está {}: no acepta más pagos.", estado)));
        }
        let fecha = self.payment_date_ok(&conn, payment_date)?;
        // La moneda se deriva del método (un pago por Pago Móvil/Efectivo Bs/Transf Bs SIEMPRE es Bs)
        let currency = normalize_payment_currency(payment_method, currency);
        // Gate anti-corrupción: un pago Bs sin tasa BCV se convertiría a 1:1 en paid_amount.
        // La tasa que manda es la DEL DÍA DEL PAGO (recalc_paid_amount usa la misma).
        if currency == "VES" && !self.has_bcv_rate_for_date(&conn, &fecha)? {
            return Err(day_shift_error(&format!("El día {} no tiene tasa BCV (está en 0). Actualizala en Libro Diario (botón \"Actualizar día\" o abrí esa fecha con su tasa) antes de registrar pagos en bolívares.", fecha)));
        }
        let bank_fee_amount = if bank_fee_percent > 0.0 { amount * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = amount - bank_fee_amount;
        // La HORA se conserva en el pago del día (el mostrador la necesita para cuadrar contra la app
        // del banco: el detalle de pagos del Libro Diario tiene columna «Hora»). Un pago RETROACTIVO se
        // guarda solo con la fecha: la hora real del cobro es desconocida y mostrar «00:00» sería
        // inventarla (la columna lo muestra como «—»).
        let stamp = if fecha == self.today_local(&conn)? {
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
        } else {
            fecha.clone()
        };
        conn.execute(
            "INSERT INTO service_payments (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, notes, payment_date) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, if notes.is_empty() { None } else { Some(notes) }, stamp],
        )?;
        let pid = conn.last_insert_rowid();
        self.recalc_paid_amount(&conn, service_id)?;
        // F68/F40: el abono queda en el LIBRO DE PLATA con su AUTOR. La fecha del libro es la del
        // PAGO (no la de hoy): un abono retroactivo pertenece a la caja de ese día.
        self.book_movement(&conn, &NewCashMovement {
            r#type: "abono",
            method: payment_method,
            currency: &currency,
            amount: net_amount,
            sign: 1,
            reference: zelle_reference,
            sale_id: None,
            service_id: Some(service_id),
            payment_id: Some(pid),
            expense_id: None,
            note: if notes.is_empty() { "" } else { notes },
            // F69: la fecha del libro es la DEL PAGO (puede ser retroactiva), no la de hoy.
            when: Some(&stamp),
        })?;
        Ok(pid)
    }

    /// F35 — CORREGIR LA FECHA de un pago ya anotado (lo que pidió el dueño: «pueda editar o agregar
    /// la fecha de ese pago»). Comando ANGOSTO: toca UNA columna. Recalcula `paid_amount` porque la
    /// tasa BCV del día del pago es la que convierte un abono en Bs a dólares.
    pub fn update_service_payment_date(&self, id: i64, payment_date: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let (service_id, currency, desde): (i64, Option<String>, Option<String>) = conn.query_row(
            "SELECT service_id, currency, date(payment_date) FROM service_payments WHERE id = ?1",
            params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?.ok_or_else(|| day_shift_error("El pago no existe."))?;
        // F69 (revisión adversarial, MAYOR): mover la fecha de un pago AJENO mueve plata entre dos
        // cajas y descuadra dos arqueos. F35 decidió que la cajera pueda corregir la fecha (está en el
        // mostrador cuando pasa), pero eso era sobre SUS cobros: si el movimiento del libro está a
        // nombre de otra persona, hace falta la sesión del dueño.
        let autor: Option<i64> = conn.query_row(
            "SELECT user_id FROM cash_movements WHERE payment_id = ?1 ORDER BY id DESC LIMIT 1",
            params![id], |r| r.get(0),
        ).optional()?.flatten();
        if let Some(autor_id) = autor {
            let propio = self.current_user().map(|u| u.id == autor_id).unwrap_or(false);
            if !propio && !self.master_session_active() {
                return Err(day_shift_error(
                    "Ese cobro lo anotó otra persona: para cambiarle la fecha entrá con el PIN del dueño.",
                ));
            }
        }
        let hacia = self.payment_date_ok(&conn, payment_date)?;
        let desde = desde.unwrap_or_default();
        self.payment_date_movable(&conn, &desde, &hacia)?;
        if currency.as_deref() == Some("VES") && !self.has_bcv_rate_for_date(&conn, &hacia)? {
            return Err(day_shift_error(&format!("El día {} no tiene tasa BCV (está en 0): sin tasa, un abono en Bs se convertiría 1:1. Cargá la tasa de ese día en Libro Diario.", hacia)));
        }
        // La fecha se guarda con la HORA si el pago es de HOY (el mostrador usa esa hora para cuadrar
        // contra el banco) y solo con la fecha si es retroactiva: la hora real del cobro de ese día es
        // desconocida y mostrar «00:00» sería inventarla — el detalle de pagos la muestra como «—».
        let hora_vieja: Option<String> = conn.query_row(
            "SELECT substr(payment_date, 11) FROM service_payments WHERE id = ?1", params![id], |r| r.get(0),
        ).optional()?;
        let stamp = if hacia == self.today_local(&conn)? {
            let hora = hora_vieja.filter(|h| !h.trim().is_empty())
                .unwrap_or_else(|| chrono::Local::now().format(" %H:%M:%S").to_string());
            format!("{}{}", hacia, hora)
        } else {
            hacia.clone()
        };
        conn.execute(
            "UPDATE service_payments SET payment_date = ?2 WHERE id = ?1",
            params![id, stamp],
        )?;
        self.recalc_paid_amount(&conn, service_id)?;
        // F69 (revisión adversarial, MAYOR): mover la fecha de un pago MUEVE PLATA ENTRE CAJAS, así que
        // el libro tiene que moverse con él. Antes era el único write-point de dinero sin `book_movement`:
        // la caja que lo cobró seguía mostrando plata que se fue y el día destino no la veía.
        // Se actualiza el `date`/`day` del movimiento del pago (es el MISMO movimiento, no otro asiento).
        conn.execute(
            "UPDATE cash_movements SET date=?2, day=date(?2), note = COALESCE(NULLIF(note,''),'') || ' · fecha corregida' 
             WHERE payment_id = ?1",
            params![id, stamp],
        )?;
        Ok(())
    }

    pub fn delete_service_payment(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let (service_id, amount, currency): (i64, f64, Option<String>) = conn.query_row(
            "SELECT service_id, amount, currency FROM service_payments WHERE id=?1",
            params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?.ok_or_else(|| day_shift_error("El pago no existe."))?;
        // F36: borrar un cobro del que ya se devolvió plata dejaría el neto de esa moneda en NEGATIVO
        // (abonado «−$100») y el descuadre se arrastraría a la caja. Se rechaza y se dice el orden.
        let currency = if currency.as_deref() == Some("VES") { "VES" } else { "USD" };
        let (usd_net, ves_net) = self.paid_net_by_currency(&conn, service_id)?;
        let neto_moneda = if currency == "VES" { ves_net } else { usd_net };
        if amount > 0.0 && (neto_moneda - amount) < -0.5 {
            return Err(day_shift_error("Este cobro ya tiene una devolución registrada: borrá primero la devolución (o anulá la devolución) y después el cobro."));
        }
        conn.execute("DELETE FROM service_payments WHERE id=?", params![id])?;
        self.recalc_paid_amount(&conn, service_id)?;
        // F68/F40 — F69 (revisión adversarial, MAYOR): el contra-asiento es el ESPEJO del movimiento
        // original (mismo NETO que se anotó, mismo método y moneda, signo invertido). Antes iba con el
        // BRUTO y sin método: un cobro por Punto con comisión inventaba −comisión, y borrar un cobro
        // EN EFECTIVO no bajaba el esperado del cajón (la caja «sobraba» lo borrado).
        self.reverse_book_entry(&conn, Some(id), None, "Cobro borrado")?;
        Ok(())
    }

    /// Reembolso al cliente: inserta un pago NEGATIVO en service_payments (resta
    /// del paid_amount del servicio y de los totales del día en el Libro Diario).
    /// Requiere día abierto (movimiento de caja) y monto > 0.
    pub fn add_service_refund(&self, service_id: i64, amount: f64, payment_method: &str,
                              zelle_reference: &str, currency: &str, notes: &str) -> SqlResult<i64> {
        if amount <= 0.0 {
            return Err(day_shift_error("El monto a devolver debe ser mayor a 0."));
        }
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        let currency = normalize_payment_currency(payment_method, currency);
        // F36 — TOPE POR MONEDA (sin tasas): solo se devuelve lo que NETAMENTE entró en esa moneda.
        // Así el operario nunca tiene que pensar en el cambio y el cajón siempre puede cubrirlo
        // (no se sacan más bolívares de los que entraron, ni más dólares).
        let disponible = self.refundable_in(&conn, service_id, &currency)?;
        // `disponible > 0.005` es imprescindible: sin esa condición, con el neto ya en 0 la tolerancia
        // de 0.5 dejaba devolver 0,5 una y otra vez (deriva negativa sin límite — bloqueante de la
        // revisión adversarial de F36).
        if disponible <= 0.005 || amount > disponible + 0.5 {
            let monto = if currency == "VES" {
                format!("Bs. {}", fmt_miles(disponible))
            } else {
                format!("${:.2}", disponible)
            };
            let en_moneda = if currency == "VES" { "en bolívares" } else { "en dólares" };
            return Err(day_shift_error(&format!("Solo puedes devolver hasta {} (lo que entró {}). Si el cliente pagó en otra moneda, borrá el pago y anotalo en la moneda de la devolución.", monto, en_moneda)));
        }
        // Gate anti-corrupción: si quedan bolívares por devolver y NO hay ninguna tasa con la que
        // valuarlos, el neto se convertiría 1:1 y corrompería paid_amount.
        if currency == "VES" && self.ves_rate_for_net(&conn, service_id)? <= 0.0 {
            return Err(day_shift_error("No hay ninguna tasa BCV cargada con la que valuar los bolívares de esta orden. Cargala en Libro Diario (día del pago o día abierto) antes de devolver en bolívares."));
        }
        // F42 — LA DEVOLUCIÓN VUELVE POR DONDE ENTRÓ (regla del local, 2026-09-17). El frontend ya lo
        // bloquea, pero acá está el gate de verdad (fail-closed): un método que NO cobró nada en esa
        // moneda no puede registrar una salida. Caso real que lo motivó: una orden de $5 con el
        // formulario en «Punto de Venta (Bs)» se cobró $3 en efectivo + Bs. 1.697 por Pago Móvil, y la
        // devolución de esos Bs. 1.697 quedó anotada en el PUNTO → el cierre mostraba Punto −Bs. 1.697
        // (la máquina nunca devuelve plata) y la plata que salió del cajón no aparecía en ninguna parte.
        // Los métodos de CAJÓN sí pueden pagar la devolución (la plata puede salir del cajón aunque haya
        // entrado por transferencia): eso se avisa en la UI, no se bloquea.
        let es_de_cajon = payment_method == "Efectivo Bs" || payment_method == "Divisas (USD Cash)";
        if !es_de_cajon {
            let cobrado_por_metodo: f64 = conn.query_row(
                "SELECT COALESCE(SUM(amount),0) FROM service_payments WHERE service_id=?1 AND payment_method=?2 AND COALESCE(currency,'USD')=?3",
                params![service_id, payment_method, currency], |r| r.get(0),
            )?;
            if cobrado_por_metodo <= 0.005 {
                let mut stmt = conn.prepare(
                    "SELECT DISTINCT payment_method FROM service_payments WHERE service_id=?1 AND amount > 0.005 AND COALESCE(currency,'USD')=?2",
                )?;
                let de: Vec<String> = stmt
                    .query_map(params![service_id, currency], |r| r.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                let donde = if de.is_empty() {
                    format!("no entraron {}", if currency == "VES" { "bolívares" } else { "dólares" })
                } else {
                    format!("entraron por {}", de.join(", "))
                };
                return Err(day_shift_error(&format!(
                    "Por «{}» no entró plata en esta orden: la devolución tiene que salir por donde entró ({}). Si le devolvés del cajón, elegí «{}».",
                    payment_method, donde,
                    if currency == "VES" { "Efectivo Bs" } else { "Divisas (USD Cash)" }
                )));
            }
        }
        // F35/F36 — LA FECHA DE LA DEVOLUCIÓN ES LA DEL TURNO ABIERTO, no la de hoy: la plata sale de
        // la caja que se está trabajando, y `close_day` solo suma los movimientos de SU fecha. Con el
        // default de la tabla (`datetime('now')`) una devolución hecha con el turno abierto de otro día
        // quedaba FUERA de ese cierre (arqueo descuadrado) y en un día que nadie cierra.
        let fecha_devolucion: Option<String> = conn.query_row(
            "SELECT close_date FROM daily_closings WHERE is_closed = 0 ORDER BY close_date DESC, id DESC LIMIT 1",
            [], |r| r.get(0),
        ).optional()?;
        let fecha_devolucion = fecha_devolucion.unwrap_or_default();
        // Con hora si la devolución es de HOY (así el historial la ordena cronológicamente junto a los
        // cobros del día) y solo con la fecha si pertenece a un turno abierto de otro día.
        let stamp_devolucion = if fecha_devolucion == self.today_local(&conn)? {
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
        } else {
            fecha_devolucion.clone()
        };
        let final_notes = if notes.trim().is_empty() {
            "Devolución".to_string()
        } else {
            format!("Devolución: {}", notes.trim())
        };
        conn.execute(
            "INSERT INTO service_payments (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, notes, payment_date) VALUES (?1,?2,?3,0,0,?2,?4,?5,?6,COALESCE(?7, datetime('now','localtime')))",
            params![service_id, -amount, payment_method, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, final_notes, stamp_devolucion],
        )?;
        let pid = conn.last_insert_rowid();
        self.recalc_paid_amount(&conn, service_id)?;
        // F68/F40: la devolución es plata que SALE (signo −1) y queda en el libro con su autor.
        self.book_movement(&conn, &NewCashMovement {
            r#type: "devolucion",
            method: payment_method,
            currency: &currency,
            amount,
            sign: -1,
            reference: zelle_reference,
            sale_id: None,
            service_id: Some(service_id),
            payment_id: Some(pid),
            expense_id: None,
            note: if notes.trim().is_empty() { "Devolución" } else { notes },
            // F69: la devolución pertenece a la caja del turno abierto (su fecha), no a la de hoy.
            when: Some(&stamp_devolucion),
        })?;
        Ok(pid)
    }

    // ── F36: LA REGLA DE DINERO DE LOS ABONOS (un solo lugar) ────────────────────────────────
    //
    // El saldo de una orden se calcula POR MONEDA, sobre el NETO de cada una:
    //
    //     paid_amount = neto_USD + (neto_VES / tasa de referencia)
    //
    // ¿Por qué neto y no «convertir cada movimiento con la tasa de su día»? Porque un abono y su
    // devolución tienen que CANCELARSE. Medido: abono de Bs. 4.050 con tasa 40,50 = $100; devolución
    // de los MISMOS Bs. 4.050 con tasa 50 = −$81 → la orden quedaba debiendo $19 (y el recibo lo
    // imprimía) aunque el cliente ya estaba saldado en bolívares. Con el neto, 4.050 − 4.050 = 0 y
    // la orden queda SALDADA, sin importar la tasa.
    //
    // La tasa de referencia es la del DÍA EN QUE ENTRÓ LA PLATA (el primer ingreso en Bs de esa
    // orden), NUNCA la de hoy: un abono no puede cambiar de valor con el paso de los días. Con varios
    // abonos en días distintos se valúa el neto a la del primer ingreso — que es como piensa el local
    // («me quedaron Bs. 3.050 de ese pago»).
    //
    // La CAJA no participa de esto: `compute_daily_totals` suma montos CRUDOS por método y por día
    // (los Bs. que entran el lunes y los que salen el miércoles cuadran cada día por separado).

    /// Neto por moneda de los movimientos de una orden (las devoluciones ya son negativas).
    /// El reparto es el MISMO que el del frontend (`refund-math.ts`): **VES** es VES y **todo lo
    /// demás cuenta como dólares** (una moneda desconocida nunca se descarta: la plata no puede
    /// desaparecer del saldo por un dato raro).
    fn paid_net_by_currency(&self, conn: &rusqlite::Connection, service_id: i64) -> SqlResult<(f64, f64)> {
        conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN currency = 'VES' THEN 0 ELSE amount END), 0),
                COALESCE(SUM(CASE WHEN currency = 'VES' THEN amount ELSE 0 END), 0)
             FROM service_payments WHERE service_id = ?1",
            params![service_id], |r| Ok((r.get(0)?, r.get(1)?)),
        )
    }

    /// Tasa BCV con la que se valúan los bolívares de esa orden: la del día del PRIMER ingreso en Bs
    /// (cierre de ese día con tasa > 0) → el día abierto con tasa > 0 (el más reciente) → 0 (sin tasa).
    fn ves_rate_for_net(&self, conn: &rusqlite::Connection, service_id: i64) -> SqlResult<f64> {
        conn.query_row(
            "SELECT COALESCE((
                SELECT dc.tasa_bcv FROM daily_closings dc
                WHERE dc.close_date = (
                    SELECT date(MIN(sp.payment_date)) FROM service_payments sp
                    WHERE sp.service_id = ?1 AND sp.currency = 'VES' AND sp.amount > 0
                ) AND dc.tasa_bcv > 0 ORDER BY dc.id DESC LIMIT 1
             ), (
                SELECT dc2.tasa_bcv FROM daily_closings dc2
                WHERE dc2.is_closed = 0 AND dc2.tasa_bcv > 0
                ORDER BY dc2.close_date DESC, dc2.id DESC LIMIT 1
             ), 0)",
            params![service_id], |r| r.get(0),
        )
    }

    /// Cuánto se puede DEVOLVER en esa moneda: lo que netamente entró en ella (nunca negativo).
    /// Sin tasas de por medio: no se puede sacar del cajón más de lo que entró, en la misma moneda.
    fn refundable_in(&self, conn: &rusqlite::Connection, service_id: i64, currency: &str) -> SqlResult<f64> {
        let (usd, ves) = self.paid_net_by_currency(conn, service_id)?;
        let net = if currency == "VES" { ves } else { usd };
        Ok(if net > 0.0 { net } else { 0.0 })
    }

    // Recalcula paid_amount en USD equivalente con la regla de arriba (neto por moneda).
    fn recalc_paid_amount(&self, conn: &rusqlite::Connection, service_id: i64) -> SqlResult<()> {
        let (usd_net, ves_net) = self.paid_net_by_currency(conn, service_id)?;
        let ves_usd = if ves_net.abs() < 1e-9 {
            0.0
        } else {
            let tasa = self.ves_rate_for_net(conn, service_id)?;
            // Sin ninguna tasa conocida se cae a 1:1, el mismo fallback histórico (y el gate de
            // abonos/devoluciones en Bs avisa antes de llegar acá).
            if tasa > 0.0 { ves_net / tasa } else { ves_net }
        };
        let total = ((usd_net + ves_usd) * 10000.0).round() / 10000.0;
        // PISO EN 0 (invariante 1): el «abonado» de una orden nunca puede ser negativo. Un neto
        // negativo solo puede salir de datos incoherentes (p. ej. borrar el cobro después de haber
        // devuelto: `delete_service_payment` lo rechaza, y esto es la red de seguridad). Mostrar
        // «abonado −$100» haría que el recibo y el saldo digan cualquier cosa.
        let total = if total < 0.0 { 0.0 } else { total };
        conn.execute("UPDATE services SET paid_amount = ?2 WHERE id = ?1", params![service_id, total])?;
        Ok(())
    }

    // --- Purchase Orders (pedidos a proveedor) ---
    pub fn add_purchase_order(&self, supplier: &str, notes: &str, items_json: &str) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        let items: Vec<serde_json::Value> = serde_json::from_str(items_json).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;
        if items.is_empty() {
            return Err(day_shift_error("El pedido debe tener al menos un producto."));
        }
        conn.execute(
            "INSERT INTO purchase_orders (supplier, notes) VALUES (?1, ?2)",
            params![if supplier.is_empty() { None } else { Some(supplier) }, if notes.is_empty() { None } else { Some(notes) }],
        )?;
        let order_id = conn.last_insert_rowid();
        for item in &items {
            let product_id = item["productId"].as_i64();
            let product_name = item["productName"].as_str().unwrap_or("").to_string();
            let quantity = item["quantity"].as_i64().unwrap_or(1);
            let unit_price = item["unitPrice"].as_f64().unwrap_or(0.0);
            conn.execute(
                "INSERT INTO purchase_order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?1,?2,?3,?4,?5)",
                params![order_id, product_id, product_name, quantity, unit_price],
            )?;
        }
        Ok(order_id)
    }

    pub fn get_purchase_orders(&self) -> SqlResult<Vec<PurchaseOrder>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT po.id, po.order_date, po.supplier, po.status, po.notes,
                    COUNT(poi.id) as item_count,
                    COALESCE(SUM(poi.quantity),0) as total_quantity,
                    COALESCE(SUM(poi.quantity * poi.unit_price),0) as total_cost
             FROM purchase_orders po
             LEFT JOIN purchase_order_items poi ON poi.order_id = po.id
             GROUP BY po.id ORDER BY po.id DESC"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(PurchaseOrder {
                id: r.get(0)?, order_date: r.get(1)?, supplier: r.get(2)?,
                status: r.get(3)?, notes: r.get(4)?,
                item_count: r.get(5)?, total_quantity: r.get(6)?, total_cost: r.get(7)?,
            })
        })?;
        let mut orders = Vec::new();
        for row in rows { orders.push(row?); }
        Ok(orders)
    }

    pub fn get_purchase_order_items(&self, order_id: i64) -> SqlResult<Vec<PurchaseOrderItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, order_id, product_id, product_name, quantity, unit_price FROM purchase_order_items WHERE order_id = ?1 ORDER BY id ASC"
        )?;
        let rows = stmt.query_map(params![order_id], |r| {
            Ok(PurchaseOrderItem {
                id: r.get(0)?, order_id: r.get(1)?, product_id: r.get(2)?,
                product_name: r.get(3)?, quantity: r.get(4)?, unit_price: r.get(5)?,
            })
        })?;
        let mut items = Vec::new();
        for row in rows { items.push(row?); }
        Ok(items)
    }

    pub fn mark_purchase_order_received(&self, order_id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let status: Option<String> = conn
            .query_row("SELECT status FROM purchase_orders WHERE id=?1", params![order_id], |r| r.get(0))
            .optional()?;
        if status.as_deref() == Some("Recibido") {
            return Err(day_shift_error("Este pedido ya fue recibido."));
        }
        let tx = conn.unchecked_transaction()?;
        // Query inline (sin re-tomar el lock)
        let mut stmt = tx.prepare(
            "SELECT product_id, quantity FROM purchase_order_items WHERE order_id = ?1"
        )?;
        let rows = stmt.query_map(params![order_id], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (pid, qty) = row?;
            if let Some(pid) = pid {
                tx.execute("UPDATE products SET stock = stock + ?1 WHERE id=?2", params![qty, pid])?;
                tx.execute(
                    "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference) VALUES (?1, 'entrada', ?2, 'Pedido Recibido', ?3)",
                    params![pid, qty, format!("Pedido #{}", order_id)],
                )?;
            }
        }
        drop(stmt);
        tx.execute("UPDATE purchase_orders SET status='Recibido' WHERE id=?1", params![order_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_purchase_order(&self, order_id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM purchase_order_items WHERE order_id=?", params![order_id])?;
        conn.execute("DELETE FROM purchase_orders WHERE id=?", params![order_id])?;
        Ok(())
    }

    /// Lista de órdenes con filtros. `date_field` elige POR QUÉ FECHA se filtra el rango:
    /// `"out"` = fecha de ENTREGA (`date_out`, para «entregados hoy») · cualquier otra cosa
    /// (o vacío) = fecha de RECIBIDO (`date_in`, comportamiento histórico).
    /// La columna sale de una whitelist (nunca se interpola texto del frontend).
    pub fn get_services(&self, search: &str, status: &str, start_date: &str, end_date: &str, date_field: &str) -> SqlResult<Vec<Service>> {
        let conn = self.conn.lock().unwrap();
        let date_col = if date_field == "out" { "s.date_out" } else { "s.date_in" };
        let mut sql = String::from("SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.service_types, s.client_id, s.paid_amount, s.technician_id, s.technician, s.group_id, s.color, s.printed, s.screen_product_id, s.discount_amount, s.photo_in_at, s.photo_out_at, s.pay_intent, s.iva_rate, s.iva_mode FROM services s WHERE 1=1");
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if !search.is_empty() {
            sql.push_str(" AND (s.client LIKE ?1 OR s.model LIKE ?1 OR s.order_num LIKE ?1 OR s.phone LIKE ?1 OR s.client_ci LIKE ?1)");
            params_vec.push(Box::new(format!("%{}%", search)));
        }
        // Sentinela "__activos__": órdenes EN TALLER (Recibido → Por entregar), sin entregados/terminales.
        // Harness 2026-08-07: la vista por defecto de Servicios ya no mezcla lo entregado con lo pendiente.
        if status == "__activos__" {
            sql.push_str(" AND s.status NOT IN ('Entregado','Cancelado','Devuelto','Cancelado / Devuelto')");
        } else if !status.is_empty() {
            let idx = params_vec.len() + 1;
            sql.push_str(&format!(" AND s.status=?{}", idx));
            params_vec.push(Box::new(status.to_string()));
        }
        if !start_date.is_empty() {
            let idx = params_vec.len() + 1;
            sql.push_str(&format!(" AND date({}) >= ?{}", date_col, idx));
            params_vec.push(Box::new(start_date.to_string()));
        }
        if !end_date.is_empty() {
            let idx = params_vec.len() + 1;
            sql.push_str(&format!(" AND date({}) <= ?{}", date_col, idx));
            params_vec.push(Box::new(end_date.to_string()));
        }
        sql.push_str(" ORDER BY s.id DESC");

        let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(Service {
                id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
                service_types: r.get(21).unwrap_or(None),
                amount: r.get(8)?, payment_method: r.get(9)?,
                date_out: r.get(10)?, status: r.get(11)?, observations: r.get(12)?,
                bank_fee_percent: r.get(13).unwrap_or(0.0),
                bank_fee_amount: r.get(14).unwrap_or(0.0),
                net_amount: r.get(15).unwrap_or(0.0),
                zelle_reference: r.get(16).unwrap_or(None),
                currency: r.get(17).unwrap_or(Some("USD".into())),
                client_ci: r.get(18).unwrap_or(None),
                client_address: r.get(19).unwrap_or(None),
                device_checklist: r.get(20).unwrap_or(None),
                client_id: r.get(22).unwrap_or(None),
                paid_amount: r.get(23).unwrap_or(0.0),
                technician_id: r.get(24).unwrap_or(None),
                technician: r.get(25).unwrap_or(None),
                group_id: r.get(26).unwrap_or(None),
                color: r.get(27).unwrap_or(None),
                printed: r.get(28).unwrap_or(0),
                screen_product_id: r.get(29).unwrap_or(None),
                discount_amount: r.get(30).unwrap_or(0.0),
                photo_in_at: r.get(31).unwrap_or(None),
                photo_out_at: r.get(32).unwrap_or(None),
                pay_intent: r.get(33).unwrap_or(None),
                iva_rate: r.get(34).unwrap_or(0.0),
                iva_mode: r.get(35).unwrap_or_default(),
            })
        })?;
        let mut services = Vec::new();
        for row in rows { services.push(row?); }
        Ok(services)
    }

    pub fn get_service_by_id(&self, id: i64) -> SqlResult<Option<Service>> {
        let conn = self.conn.lock().unwrap();
        let row = conn.query_row(
            "SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.service_types, s.client_id, s.paid_amount, s.technician_id, s.technician, s.group_id, s.color, s.printed, s.screen_product_id, s.discount_amount, s.photo_in_at, s.photo_out_at, s.pay_intent, s.iva_rate, s.iva_mode FROM services s WHERE s.id=?1",
            params![id],
            |r| Ok(Service {
                id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
                service_types: r.get(21).unwrap_or(None),
                amount: r.get(8)?, payment_method: r.get(9)?,
                date_out: r.get(10)?, status: r.get(11)?, observations: r.get(12)?,
                bank_fee_percent: r.get(13).unwrap_or(0.0),
                bank_fee_amount: r.get(14).unwrap_or(0.0),
                net_amount: r.get(15).unwrap_or(0.0),
                zelle_reference: r.get(16).unwrap_or(None),
                currency: r.get(17).unwrap_or(Some("USD".into())),
                client_ci: r.get(18).unwrap_or(None),
                client_address: r.get(19).unwrap_or(None),
                device_checklist: r.get(20).unwrap_or(None),
                client_id: r.get(22).unwrap_or(None),
                paid_amount: r.get(23).unwrap_or(0.0),
                technician_id: r.get(24).unwrap_or(None),
                technician: r.get(25).unwrap_or(None),
                group_id: r.get(26).unwrap_or(None),
                color: r.get(27).unwrap_or(None),
                printed: r.get(28).unwrap_or(0),
                screen_product_id: r.get(29).unwrap_or(None),
                discount_amount: r.get(30).unwrap_or(0.0),
                photo_in_at: r.get(31).unwrap_or(None),
                photo_out_at: r.get(32).unwrap_or(None),
                pay_intent: r.get(33).unwrap_or(None),
                iva_rate: r.get(34).unwrap_or(0.0),
                iva_mode: r.get(35).unwrap_or_default(),
            }),
        ).optional()?;
        Ok(row)
    }

    pub fn get_service_dashboard(&self) -> SqlResult<ServiceDashboard> {
        let conn = self.conn.lock().unwrap();
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM services", [], |r| r.get(0))?;
        let entregados: i64 = conn.query_row("SELECT COUNT(*) FROM services WHERE status='Entregado'", [], |r| r.get(0))?;
        let pendientes: i64 = conn.query_row("SELECT COUNT(*) FROM services WHERE status='Por entregar'", [], |r| r.get(0))?;
        let total_ingresos: f64 = conn.query_row("SELECT COALESCE(SUM(amount),0) FROM services WHERE status='Entregado'", [], |r| r.get(0))?;

        let mut stmt = conn.prepare(
            "SELECT payment_method, COUNT(*), COALESCE(SUM(amount),0) FROM services WHERE status='Entregado' GROUP BY payment_method"
        )?;
        let method_stats: Vec<MethodStat> = stmt.query_map([], |r| {
            Ok(MethodStat { payment_method: r.get(0)?, count: r.get(1)?, total: r.get(2)? })
        })?.collect::<Result<Vec<_>, _>>()?;

        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*), COALESCE(SUM(amount),0) FROM services GROUP BY status"
        )?;
        let status_stats: Vec<StatusStat> = stmt.query_map([], |r| {
            Ok(StatusStat { status: r.get(0)?, count: r.get(1)?, total: r.get(2)? })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(ServiceDashboard { total, entregados, pendientes, total_ingresos, method_stats, status_stats })
    }

    // --- Technicians (técnicos) ---
    pub fn get_technicians(&self) -> SqlResult<Vec<Technician>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, initials, color FROM technicians ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(Technician { id: r.get(0)?, name: r.get(1)?, initials: r.get(2)?, color: r.get(3)? })
        })?;
        let mut out = Vec::new();
        for row in rows { out.push(row?); }
        Ok(out)
    }

    /// Estadísticas por técnico (fase 2 del Dashboard): totales, en taller,
    /// entregados e ingresos. Fila "Sin asignar" incluida. El snapshot de nombre
    /// sobrevive al borrado del técnico (patrón denormalizado).
    pub fn get_technician_stats(&self) -> SqlResult<Vec<TechnicianStat>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.technician_id, COALESCE(s.technician,''), COALESCE(t.initials,''), COALESCE(t.color,''),
                    COUNT(*),
                    SUM(CASE WHEN s.status IN ('Entregado','Cancelado','Devuelto') THEN 0 ELSE 1 END),
                    SUM(CASE WHEN s.status='Entregado' THEN 1 ELSE 0 END),
                    COALESCE(SUM(CASE WHEN s.status='Entregado' THEN s.amount ELSE 0 END),0)
             FROM services s LEFT JOIN technicians t ON t.id = s.technician_id
             GROUP BY s.technician_id, s.technician
             ORDER BY COUNT(*) DESC"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(TechnicianStat {
                technician_id: r.get(0)?,
                technician: r.get(1)?,
                initials: r.get(2)?,
                color: r.get(3)?,
                total: r.get(4)?,
                activos: r.get(5)?,
                entregados: r.get(6)?,
                ingresos: r.get(7)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn add_technician(&self, name: &str, initials: &str, color: &str) -> SqlResult<i64> {
        let name = name.trim();
        if name.is_empty() {
            return Err(day_shift_error("El nombre del técnico es obligatorio."));
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO technicians (name, initials, color) VALUES (?1,?2,?3)",
            params![name, initials, color],
        ).map_err(|e| {
            if let rusqlite::Error::SqliteFailure(f, _) = &e {
                if f.code == rusqlite::ErrorCode::ConstraintViolation {
                    return day_shift_error(&format!("Ya existe un técnico llamado '{}'.", name));
                }
            }
            e
        })?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_technician(&self, id: i64, name: &str, initials: &str, color: &str) -> SqlResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(day_shift_error("El nombre del técnico es obligatorio."));
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE technicians SET name=?1, initials=?2, color=?3 WHERE id=?4",
            params![name, initials, color, id],
        ).map_err(|e| {
            if let rusqlite::Error::SqliteFailure(f, _) = &e {
                if f.code == rusqlite::ErrorCode::ConstraintViolation {
                    return day_shift_error(&format!("Ya existe un técnico llamado '{}'.", name));
                }
            }
            e
        })?;
        Ok(())
    }

    pub fn delete_technician(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        // Los servicios conservan el snapshot del nombre; solo se limpia la referencia al color
        let _ = tx.execute("UPDATE services SET technician_id=NULL WHERE technician_id=?1", params![id]);
        tx.execute("DELETE FROM technicians WHERE id=?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    // --- Dashboard Analytics (ventas, categorías, modelos, sync) ---
    pub fn get_dashboard_analytics(&self) -> SqlResult<DashboardAnalytics> {
        let conn = self.conn.lock().unwrap();

        let sum_sales = |where_sql: &str| -> SqlResult<(f64, f64)> {
            let sql = format!(
                "SELECT COALESCE(SUM(CASE WHEN COALESCE(currency,'USD') = 'USD' THEN total ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN COALESCE(currency,'USD') != 'USD' THEN total ELSE 0 END),0)
                 FROM sales WHERE {}",
                where_sql
            );
            let row = conn.query_row(&sql, [], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)))?;
            Ok(row)
        };

        let (today_usd, today_bs) = sum_sales("date(date) = date('now','localtime') AND voided_at IS NULL")?;
        let (week_usd, week_bs) = sum_sales("date(date) >= date('now','localtime','-6 days') AND voided_at IS NULL")?;
        let week_units: i64 = conn.query_row(
            "SELECT COALESCE(SUM(quantity),0) FROM sales WHERE date(date) >= date('now','localtime','-6 days') AND voided_at IS NULL", [], |r| r.get(0),
        )?;
        let week_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sales WHERE date(date) >= date('now','localtime','-6 days') AND voided_at IS NULL", [], |r| r.get(0),
        )?;

        let mut stmt = conn.prepare(
            "SELECT COALESCE(c.name, 'Sin categoría'),
                    COALESCE(SUM(s.quantity),0),
                    COALESCE(SUM(CASE WHEN COALESCE(s.currency,'USD') = 'USD' THEN s.total ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN COALESCE(s.currency,'USD') != 'USD' THEN s.total ELSE 0 END),0)
             FROM sales s
             LEFT JOIN products p ON s.product_id = p.id
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE date(s.date) >= date('now','localtime','-6 days') AND s.voided_at IS NULL
             GROUP BY c.name
             ORDER BY 3 + 4 DESC"
        )?;
        let category_stats: Vec<CategoryStat> = stmt.query_map([], |r| {
            Ok(CategoryStat {
                category_name: r.get(0)?, units: r.get(1)?,
                total_usd: r.get(2)?, total_bs: r.get(3)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        let mut stmt = conn.prepare(
            "SELECT s.product_name, p.model, p.brand,
                    COALESCE(SUM(s.quantity),0),
                    COALESCE(SUM(CASE WHEN COALESCE(s.currency,'USD') = 'USD' THEN s.total ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN COALESCE(s.currency,'USD') != 'USD' THEN s.total ELSE 0 END),0)
             FROM sales s
             LEFT JOIN products p ON s.product_id = p.id
             WHERE date(s.date) >= date('now','localtime','-6 days') AND s.voided_at IS NULL
             GROUP BY s.product_name, p.model, p.brand
             ORDER BY 5 + 6 DESC
             LIMIT 6"
        )?;
        let top_models: Vec<ModelStat> = stmt.query_map([], |r| {
            Ok(ModelStat {
                product_name: r.get(0)?, model: r.get(1)?, brand: r.get(2)?,
                units: r.get(3)?, total_usd: r.get(4)?, total_bs: r.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        let product_count: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?;
        let sale_count: i64 = conn.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))?;
        let service_count: i64 = conn.query_row("SELECT COUNT(*) FROM services", [], |r| r.get(0))?;
        let client_count: i64 = conn.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))?;
        let last_sale: Option<String> = conn.query_row("SELECT MAX(date) FROM sales", [], |r| r.get(0)).ok();
        let last_service: Option<String> = conn.query_row("SELECT MAX(date_in) FROM services", [], |r| r.get(0)).ok();
        let last_movement: Option<String> = conn.query_row("SELECT MAX(date) FROM inventory_movements", [], |r| r.get(0)).ok();
        let last_activity: Option<String> = conn.query_row(
            "SELECT MAX(m) FROM (
                SELECT MAX(date) as m FROM sales
                UNION ALL SELECT MAX(date_in) FROM services
                UNION ALL SELECT MAX(date) FROM inventory_movements
            )", [], |r| r.get(0),
        ).ok();

        // Actividad de servicios HOY (para el Dashboard "qué hice hoy")
        let today_received: i64 = conn.query_row(
            "SELECT COUNT(*) FROM services WHERE date(date_in)=date('now','localtime')", [], |r| r.get(0),
        )?;
        let today_delivered: i64 = conn.query_row(
            "SELECT COUNT(*) FROM services WHERE status='Entregado' AND date(date_out)=date('now','localtime')", [], |r| r.get(0),
        )?;
        // Cobrado de servicios HOY — MISMA definición que el Libro Diario (compute_daily_totals):
        // abonos/pagos del día + servicios entregados hoy SIN ningún pago (monto completo en date_out).
        let mut service_income_today_usd = 0.0;
        let mut service_income_today_bs = 0.0;
        {
            let mut stmt = conn.prepare(
                "SELECT method, amount, currency FROM (
                    SELECT payment_method as method, CAST(COALESCE(net_amount, amount) AS REAL) as amount, COALESCE(currency,'USD') as currency
                    FROM service_payments WHERE date(payment_date)=date('now','localtime')
                    UNION ALL
                    SELECT payment_method, CAST(COALESCE(net_amount, amount) AS REAL), COALESCE(currency,'USD')
                    FROM services WHERE status='Entregado' AND date(date_out)=date('now','localtime')
                      AND NOT EXISTS (SELECT 1 FROM service_payments sp WHERE sp.service_id=services.id)
                )"
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, Option<String>>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?))
            })?;
            for row in rows {
                let (method, amount, currency) = row?;
                if normalize_payment_currency(method.as_deref().unwrap_or(""), &currency) == "USD" {
                    service_income_today_usd += amount;
                } else {
                    service_income_today_bs += amount;
                }
            }
        }

        Ok(DashboardAnalytics {
            today_usd, today_bs, week_usd, week_bs, week_units, week_count,
            category_stats, top_models, product_count, sale_count, service_count,
            client_count, last_sale, last_service, last_movement, last_activity,
            today_received, today_delivered, service_income_today_usd, service_income_today_bs,
        })
    }

    // Resumen de actividad de un día (Libro Diario → "Resumen del día")
    pub fn get_day_summary(&self, date: &str) -> SqlResult<DaySummary> {
        let conn = self.conn.lock().unwrap();
        let received: i64 = conn.query_row(
            "SELECT COUNT(*) FROM services WHERE date(date_in)=?1", params![date], |r| r.get(0),
        )?;
        let delivered: i64 = conn.query_row(
            "SELECT COUNT(*) FROM services WHERE status='Entregado' AND date(date_out)=?1", params![date], |r| r.get(0),
        )?;
        let workshop: i64 = conn.query_row(
            "SELECT COUNT(*) FROM services WHERE status NOT IN ('Entregado','Cancelado','Devuelto','Cancelado / Devuelto')", [], |r| r.get(0),
        )?;
        let payments_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM service_payments WHERE date(payment_date)=?1", params![date], |r| r.get(0),
        )?;
        let (payments_usd, payments_bs) = {
            let row = conn.query_row(
                "SELECT COALESCE(SUM(CASE WHEN currency='USD' THEN CAST(COALESCE(net_amount, amount) AS REAL) ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN currency!='USD' THEN CAST(COALESCE(net_amount, amount) AS REAL) ELSE 0 END),0)
                 FROM service_payments WHERE date(payment_date)=?1",
                params![date], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)),
            )?;
            row
        };
        let (sales_usd, sales_bs) = {
            let row = conn.query_row(
                "SELECT COALESCE(SUM(CASE WHEN COALESCE(currency,'USD')='USD' THEN total ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN COALESCE(currency,'USD')!='USD' THEN total ELSE 0 END),0)
                 FROM sales WHERE date(date)=?1 AND voided_at IS NULL",
                params![date], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)),
            )?;
            row
        };
        Ok(DaySummary {
            date: date.to_string(), received, delivered, workshop,
            payments_count, payments_usd, payments_bs, sales_usd, sales_bs,
        })
    }

    // --- Salud del negocio (harness 2026-08-19): gastos, utilidad, por cobrar, inventario ---

    /// Tasa BCV del período: cierre del último día del rango con tasa > 0,
    /// fallback día abierto, fallback último cierre con tasa (misma cadena que compute_daily_totals).
    fn period_tasa(&self, conn: &rusqlite::Connection, start_date: &str, end_date: &str) -> f64 {
        let r = conn.query_row(
            "SELECT tasa_bcv FROM daily_closings WHERE close_date >= ?1 AND close_date <= ?2 AND tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1",
            params![start_date, end_date], |r| r.get(0),
        ).optional();
        if let Ok(Some(t)) = r {
            if t > 0.0 { return t; }
        }
        let r2 = conn.query_row(
            "SELECT tasa_bcv FROM daily_closings WHERE is_closed=0 AND tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1",
            [], |r| r.get(0),
        ).optional();
        if let Ok(Some(t)) = r2 {
            if t > 0.0 { return t; }
        }
        conn.query_row(
            "SELECT tasa_bcv FROM daily_closings WHERE tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1",
            [], |r| r.get(0),
        ).optional().ok().flatten().unwrap_or(0.0)
    }

    /// F69 — LO QUE AJUSTA EL ARQUEO DEL CAJÓN de un día, leído del **LIBRO DE PLATA** (una sola
    /// fuente: si el movimiento no está en el libro, no existe para la caja):
    ///
    ///   · los **gastos pagados DEL CAJÓN** (método `Divisas (USD Cash)` / `Efectivo Bs`) RESTAN del
    ///     efectivo esperado — es el hallazgo principal de la auditoría de entrega (pagar al mensajero
    ///     del cajón hacía que la caja «faltara» en un día perfecto);
    ///   · las **devoluciones pagadas del cajón** también restan (la plata salió del cajón);
    ///   · el **fondo de caja** declarado al abrir el día SUMA (si no, la caja «sobra» todos los días);
    ///   · los gastos **sin método declarado** NO se descuentan y se cuentan aparte para avisarlos
    ///     (nunca se inventa de qué cajón salieron).
    ///
    /// Los gastos pagados por banco/otros métodos (Pago Móvil, Transferencia, Zelle, Punto) NO tocan el
    /// cajón: se concilian por banco, igual que los cobros digitales.
    pub fn drawer_adjustments(&self, date: &str) -> SqlResult<DrawerAdjust> {
        let conn = self.conn.lock().unwrap();
        self.drawer_adjustments_conn(&conn, date)
    }

    /// Implementación a nivel conexión (la usa también `close_day` con su lock ya tomado).
    fn drawer_adjustments_conn(&self, conn: &Connection, date: &str) -> SqlResult<DrawerAdjust> {
        let mut adj = DrawerAdjust::default();
        // Los gastos sin método declarado se AVISAN (no se descuentan).
        adj.sin_metodo = conn.query_row(
            "SELECT COUNT(*) FROM expenses WHERE date(expense_date)=?1 AND COALESCE(method,'')=''",
            params![date], |r| r.get(0),
        ).unwrap_or(0);
        // Fondo de caja declarado al abrir el día (USD; el Bs. no se declara hoy).
        adj.fondo_usd = conn.query_row(
            "SELECT COALESCE(initial_cash_usd,0) FROM daily_closings WHERE close_date=?1",
            params![date], |r| r.get(0),
        ).optional()?.unwrap_or(0.0);
        let mut stmt = conn.prepare(
            "SELECT type, method, currency, COALESCE(SUM(amount*sign),0)
             FROM cash_movements
             WHERE day = ?1
               AND type IN ('gasto','gasto_anulado','devolucion','abono_anulado')
             GROUP BY type, method, currency",
        )?;
        let filas = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, f64>(3)?))
        })?;
        for f in filas {
            let (tipo, metodo, moneda, neto) = f?;
            let es_cajon = metodo == "Divisas (USD Cash)" || metodo == "Efectivo Bs";
            if !es_cajon {
                continue; // banco/otros: no toca el cajón (se concilia por banco)
            }
            // `neto` ya viene con el signo del libro: gasto = −monto, gasto borrado = +monto.
            // Lo que resta al cajón es el valor ABSOLUTO de lo que quedó saliendo.
            let sale = -neto; // positivo = plata que salió del cajón
            let es_usd = moneda != "VES";
            let es_gasto = tipo.starts_with("gasto");
            match (es_usd, es_gasto) {
                (true, true) => adj.gastos_usd += sale,
                (false, true) => adj.gastos_bs += sale,
                (true, false) => adj.devoluciones_usd += sale,
                (false, false) => adj.devoluciones_bs += sale,
            }
        }
        Ok(adj)
    }

    /// Registra un gasto del negocio. NO requiere día abierto (los gastos se anotan
    /// cuando ocurren; la caja física es independiente del registro).
    ///
    /// F69: `method` dice DE DÓNDE SALIÓ LA PLATA — es lo que decide si el gasto baja el **esperado
    /// del cajón** al cerrar (`Divisas (USD Cash)` / `Efectivo Bs`) o si salió por banco/otros (no lo
    /// toca). Vacío = sin declarar: no se descuenta y el arqueo lo avisa.
    pub fn add_expense(&self, expense_date: &str, category: &str, amount: f64, currency: &str, notes: &str,
                       method: &str) -> SqlResult<i64> {
        if amount <= 0.0 {
            return Err(day_shift_error("El monto del gasto debe ser mayor que 0."));
        }
        let cur = if currency == "VES" { "VES" } else { "USD" };
        if expense_date.len() != 10 {
            return Err(day_shift_error("Fecha inválida (use AAAA-MM-DD)."));
        }
        let metodo = method.trim();
        if !metodo.is_empty() {
            // Un método declarado tiene que ser uno de los del sistema: si no, la moneda del gasto
            // podría no coincidir con el cajón que se descuenta (misma regla que los cobros).
            let conocido: bool = self.conn.lock().unwrap()
                .query_row("SELECT EXISTS(SELECT 1 FROM payment_methods WHERE name=?1)", params![metodo], |r| r.get(0))
                .unwrap_or(false);
            if !conocido {
                return Err(day_shift_error(&format!(
                    "«{}» no es un método de pago del sistema. Elegí de dónde salió la plata (o dejalo sin declarar).",
                    metodo
                )));
            }
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO expenses (expense_date, category, amount, currency, notes, method) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![expense_date, category, amount, cur, notes, metodo],
        )?;
        let id = conn.last_insert_rowid();
        // F68/F40: el gasto es plata que SALE de la caja → queda en el LIBRO con su autor y con el
        // método declarado (F69 lee de ahí el ajuste del cajón: una sola fuente).
        self.book_movement(&conn, &NewCashMovement {
            r#type: "gasto",
            method: metodo,
            currency: cur,
            amount,
            sign: -1,
            reference: category,
            sale_id: None,
            service_id: None,
            payment_id: None,
            expense_id: Some(id),
            note: notes,
            // F69: el gasto pertenece al día que se declara (puede ser retroactivo), no al de hoy.
            when: Some(expense_date),
        })?;
        Ok(id)
    }

    pub fn get_expenses(&self, start_date: &str, end_date: &str) -> SqlResult<Vec<Expense>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, expense_date, category, amount, currency, notes, COALESCE(method,'') FROM expenses
             WHERE date(expense_date) >= ?1 AND date(expense_date) <= ?2 ORDER BY expense_date DESC, id DESC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date], |r| {
            Ok(Expense {
                id: r.get(0)?, expense_date: r.get(1)?, category: r.get(2)?,
                amount: r.get(3)?, currency: r.get(4)?, notes: r.get(5)?, method: r.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_expense(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let existe: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM expenses WHERE id=?1)", params![id], |r| r.get(0))
            .unwrap_or(false);
        if !existe {
            return Err(day_shift_error("El gasto ya no existe."));
        }
        conn.execute("DELETE FROM expenses WHERE id=?1", params![id])?;
        // F68/F40 — F69 (revisión adversarial, MAYOR): el contra-asiento es el ESPEJO del movimiento
        // original, así que conserva el MÉTODO declarado. Antes iba con método vacío: un gasto pagado
        // del cajón seguía restando del esperado después de borrarlo (el cajón «faltaba» para siempre).
        self.reverse_book_entry(&conn, None, Some(id), "Gasto borrado")?;
        Ok(())
    }

    /// Utilidad bruta del período. Ingresos = MISMA definición del Libro Diario
    /// (compute_daily_totals: ventas netas + pagos de servicios + entregados sin pago).
    /// Costo = price_cost ACTUAL del producto (decisión del dueño) × cantidad vendida,
    /// + pantalla instalada (screen_product_id) de servicios ENTREGADOS en el período.
    pub fn get_profit_summary(&self, start_date: &str, end_date: &str) -> SqlResult<ProfitSummary> {
        let conn = self.conn.lock().unwrap();
        let totals = self.compute_daily_totals(&conn, start_date, end_date)?;
        let mut income_usd = 0.0;
        let mut income_bs = 0.0;
        for t in &totals {
            income_usd += t.grand_usd;
            income_bs += t.grand_bs;
        }
        let tasa = self.period_tasa(&conn, start_date, end_date);
        // Equivalente USD del período: tasas PER-DÍA del libro (mismo criterio que grand_total del Libro Diario)
        let income_total_usd: f64 = totals.iter().map(|t| t.grand_total).sum();
        let income_total_usd = if income_total_usd > 0.0 { income_total_usd } else { income_usd + if tasa > 0.0 { income_bs / tasa } else { 0.0 } };
        // Ingresos de VENTAS por moneda (neto, mismo criterio del libro)
        let (sales_income_usd, sales_income_bs) = conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN COALESCE(currency,'USD')='USD' THEN CAST(COALESCE(net_amount,total) AS REAL) ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN COALESCE(currency,'USD')!='USD' THEN CAST(COALESCE(net_amount,total) AS REAL) ELSE 0 END),0)
             FROM sales WHERE date(date) >= ?1 AND date(date) <= ?2 AND voided_at IS NULL",
            params![start_date, end_date], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)),
        )?;
        // Costo de la mercancía vendida (ventas con producto referenciado; sin producto → 0).
        // F70: una venta ANULADA no aporta ingreso NI costo (si no, la utilidad quedaría con el costo
        // de una pantalla que volvió al stock).
        let sales_cost: f64 = conn.query_row(
            "SELECT COALESCE(SUM(COALESCE(p.price_cost,0) * s.quantity),0) FROM sales s
             LEFT JOIN products p ON p.id = s.product_id
             WHERE date(s.date) >= ?1 AND date(s.date) <= ?2 AND s.voided_at IS NULL",
            params![start_date, end_date], |r| r.get(0),
        )?;
        // Costo de pantallas: se reconoce en el MISMO período que su ingreso (regla del libro).
        // 1) Servicios con pagos en el rango (no devueltos/cancelados) → costo en el rango del pago.
        // 2) Entregados en el rango SIN pagos en el rango → costo en el rango de la entrega (dedupe con NOT EXISTS).
        let services_cost_paid: f64 = conn.query_row(
            "SELECT COALESCE(SUM(COALESCE(p.price_cost,0)),0) FROM service_payments sp
             JOIN services s ON s.id = sp.service_id AND s.screen_product_id IS NOT NULL
             LEFT JOIN products p ON p.id = s.screen_product_id
             WHERE date(sp.payment_date) >= ?1 AND date(sp.payment_date) <= ?2
               AND s.status NOT IN ('Devuelto','Cancelado','Cancelado / Devuelto')
               AND sp.amount > 0",
            params![start_date, end_date], |r| r.get(0),
        )?;
        let services_cost_delivered: f64 = conn.query_row(
            "SELECT COALESCE(SUM(COALESCE(p.price_cost,0)),0) FROM services s
             LEFT JOIN products p ON p.id = s.screen_product_id
             WHERE s.status='Entregado' AND s.screen_product_id IS NOT NULL
               AND date(s.date_out) >= ?1 AND date(s.date_out) <= ?2
               AND NOT EXISTS (SELECT 1 FROM service_payments sp
                               WHERE sp.service_id = s.id AND sp.amount > 0
                                 AND date(sp.payment_date) >= ?1 AND date(sp.payment_date) <= ?2)",
            params![start_date, end_date], |r| r.get(0),
        )?;
        let services_cost = services_cost_paid + services_cost_delivered;
        // Ingresos de servicios = totales − ventas (misma base UNION del libro)
        let services_income_usd = (income_usd - sales_income_usd).max(0.0);
        let services_income_bs = (income_bs - sales_income_bs).max(0.0);
        let cost_usd = sales_cost + services_cost;
        let profit_usd = income_total_usd - cost_usd;
        let margin_pct = if income_total_usd > 0.0 { profit_usd / income_total_usd * 100.0 } else { 0.0 };
        Ok(ProfitSummary {
            start: start_date.to_string(), end: end_date.to_string(),
            income_usd: income_total_usd, income_bs, cost_usd, profit_usd, margin_pct,
            sales_income_usd, sales_income_bs, sales_cost_usd: sales_cost,
            services_income_usd, services_income_bs, services_cost_usd: services_cost,
            tasa_bcv: tasa,
        })
    }

    /// Cuentas por cobrar: servicios activos (no finalizados) con saldo pendiente.
    /// Saldo = amount − paid_amount (paid_amount ya está en USD equivalente).
    pub fn get_receivables(&self) -> SqlResult<ReceivablesSummary> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT order_num, client, model, (amount - COALESCE(paid_amount,0)) AS saldo,
                    CAST(julianday('now','localtime') - julianday(date_in) AS INTEGER) AS days
             FROM services
             WHERE status NOT IN ('Cancelado','Devuelto','Cancelado / Devuelto')
               AND (amount - COALESCE(paid_amount,0)) > 0.005
             ORDER BY saldo DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(ReceivableItem {
                order_num: r.get(0)?, client: r.get(1)?, model: r.get(2)?,
                saldo_usd: r.get(3)?, days_open: r.get(4)?,
            })
        })?;
        let items: Vec<ReceivableItem> = rows.collect::<Result<Vec<_>, _>>()?;
        let count = items.len() as i64;
        let total_usd: f64 = items.iter().map(|i| i.saldo_usd).sum();
        let bucket = |lo: i64, hi: i64| -> ReceivableBucket {
            let label = if hi == 7 { "0-7 dias".to_string() } else if hi == 30 { "8-30 dias".to_string() } else { "mas de 30 dias".to_string() };
            let (c, t) = items.iter().fold((0i64, 0f64), |acc, i| {
                let d = if i.days_open < 0 { 0 } else { i.days_open };
                if d >= lo && d <= hi { (acc.0 + 1, acc.1 + i.saldo_usd) } else { acc }
            });
            ReceivableBucket { label, count: c, total_usd: t }
        };
        let buckets = vec![bucket(0, 7), bucket(8, 30), bucket(31, i64::MAX)];
        Ok(ReceivablesSummary {
            total_usd, count, buckets,
            items: items.into_iter().take(15).collect(),
        })
    }

    /// Valor del inventario: capital inmovilizado (stock × costo) y potencial de venta (stock × precio).
    pub fn get_inventory_value(&self) -> SqlResult<InventoryValue> {
        let conn = self.conn.lock().unwrap();
        let (units, cost_usd, sale_usd) = conn.query_row(
            "SELECT COALESCE(SUM(stock),0), COALESCE(SUM(stock * price_cost),0), COALESCE(SUM(stock * price_sale),0) FROM products WHERE stock > 0",
            [], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?)),
        )?;
        let mut stmt = conn.prepare(
            "SELECT c.name, COALESCE(SUM(p.stock),0), COALESCE(SUM(p.stock * p.price_cost),0), COALESCE(SUM(p.stock * p.price_sale),0)
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.stock > 0 GROUP BY c.name ORDER BY 3 DESC LIMIT 5",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(CategoryValue {
                category_name: r.get(0)?, units: r.get(1)?,
                cost_usd: r.get(2)?, sale_usd: r.get(3)?,
            })
        })?;
        let categories: Vec<CategoryValue> = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(InventoryValue { units, cost_usd, sale_usd, categories })
    }

    // --- Clients ---
    pub fn get_clients(&self, search: &str) -> SqlResult<Vec<ClientSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT c.id, c.name, c.phone,
                    COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.client_id = c.id AND s.voided_at IS NULL), 0) +
                    COALESCE((SELECT SUM(sv.amount) FROM services sv WHERE (sv.client_id = c.id OR (sv.client_id IS NULL AND sv.client = c.name)) AND sv.status = 'Entregado'), 0) as total_spent,
                    (SELECT COUNT(*) FROM services sv WHERE sv.client_id = c.id OR (sv.client_id IS NULL AND sv.client = c.name)) as service_count,
                    (SELECT COUNT(*) FROM sales s WHERE s.client_id = c.id AND s.voided_at IS NULL) as sale_count,
                    COALESCE(
                        (SELECT MAX(sv.date_out) FROM services sv WHERE sv.client_id = c.id OR (sv.client_id IS NULL AND sv.client = c.name)),
                        (SELECT MAX(s.date) FROM sales s WHERE s.client_id = c.id),
                        ''
                    ) as last_date,
                    c.ci, c.address, c.email, c.notes
             FROM clients c WHERE 1=1"
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if !search.is_empty() {
            sql.push_str(" AND (c.name LIKE ?1 OR c.phone LIKE ?1 OR c.ci LIKE ?1)");
            param_values.push(Box::new(format!("%{}%", search)));
        }
        sql.push_str(" ORDER BY c.name");
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(ClientSummary {
                id: r.get(0)?, name: r.get(1)?, phone: r.get(2)?,
                total_spent: r.get(3)?, service_count: r.get(4)?,
                sale_count: r.get(5)?, last_date: r.get(6)?,
                ci: r.get(7).unwrap_or(None),
                address: r.get(8).unwrap_or(None),
                email: r.get(9).unwrap_or(None),
                notes: r.get(10).unwrap_or(None),
            })
        })?;
        let mut clients = Vec::new();
        for row in rows { clients.push(row?); }
        Ok(clients)
    }

    pub fn add_client(&self, name: &str, phone: &str, email: &str, notes: &str) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        let name = title_case(name.trim());
        conn.execute(
            "INSERT INTO clients (name, phone, email, notes) VALUES (?1,?2,?3,?4)",
            params![name, phone, email, notes],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn find_client(&self, name: &str) -> SqlResult<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id FROM clients WHERE name = ?1", params![name], |r| r.get(0)
        );
        match result {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn find_client_by_ci(&self, ci: &str) -> SqlResult<Option<Client>> {
        let conn = self.conn.lock().unwrap();
        // Búsqueda tolerante a formato: la DB puede tener "24906999" o "V-24906999".
        // Se compara contra el texto crudo y sus variantes normalizadas (solo dígitos, con/sin prefijo V-/E-).
        let raw = ci.trim();
        let digits = norm_ci_digits(raw);
        let with_v = if digits.is_empty() { raw.to_string() } else { format!("V-{}", digits) };
        let with_e = if digits.is_empty() { raw.to_string() } else { format!("E-{}", digits) };
        let result = conn.query_row(
            "SELECT c.* FROM clients c WHERE c.ci IN (?1, ?2, ?3, ?4) LIMIT 1",
            params![raw, digits, with_v, with_e],
            |r| {
                Ok(Client {
                    id: r.get(0)?, name: r.get(1)?, phone: r.get(2)?,
                    email: r.get(3)?, notes: r.get(4)?, total_spent: r.get(5)?,
                    last_service: r.get(6)?, last_purchase: r.get(7)?, created_at: r.get(8)?,
                    ci: r.get(9).unwrap_or(None),
                    address: r.get(10).unwrap_or(None),
                })
            },
        );
        match result {
            Ok(client) => Ok(Some(client)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn add_or_find_client(&self, name: &str, phone: &str, ci: &str, address: &str) -> SqlResult<i64> {
        let name = title_case(name.trim());
        // 1) Buscar por cédula exacta si viene
        if !ci.is_empty() {
            if let Some(client) = self.find_client_by_ci(ci)? {
                let id = client.id;
                if !phone.is_empty() || !address.is_empty() {
                    let conn = self.conn.lock().unwrap();
                    if !phone.is_empty() {
                        conn.execute("UPDATE clients SET phone=?1 WHERE id=?2", params![phone, id])?;
                    }
                    if !address.is_empty() {
                        conn.execute("UPDATE clients SET address=?1 WHERE id=?2", params![address, id])?;
                    }
                }
                return Ok(id);
            }
        }
        // 2) Buscar por nombre exacto
        if let Some(id) = self.find_client(&name)? {
            if !phone.is_empty() || !ci.is_empty() || !address.is_empty() {
                let conn = self.conn.lock().unwrap();
                if !phone.is_empty() {
                    conn.execute("UPDATE clients SET phone=?1 WHERE id=?2", params![phone, id])?;
                }
                if !ci.is_empty() {
                    conn.execute("UPDATE clients SET ci=?1 WHERE id=?2", params![ci, id])?;
                }
                if !address.is_empty() {
                    conn.execute("UPDATE clients SET address=?1 WHERE id=?2", params![address, id])?;
                }
            }
            return Ok(id);
        }
        // 3) Insertar nuevo cliente
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO clients (name, phone, ci, address) VALUES (?1,?2,?3,?4)",
            params![
                name,
                if phone.is_empty() { None } else { Some(phone) },
                if ci.is_empty() { None } else { Some(ci) },
                if address.is_empty() { None } else { Some(address) },
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    // Upsert de cliente con TODA la información (Clientes → Nuevo / Editar, harness 2026-08-07).
    // - id=None → busca existente por cédula o nombre exacto (no duplica) y completa datos faltantes;
    //   si no existe, inserta nuevo con name/phone/ci/address/email/notes.
    // - id=Some → actualiza todos los campos; si el NOMBRE cambió, propaga el nuevo nombre a los
    //   snapshots services.client / sales.client_name (historial y búsqueda coherentes).
    pub fn save_client(&self, id: Option<i64>, name: &str, phone: &str, ci: &str, address: &str, email: &str, notes: &str) -> SqlResult<i64> {
        let name = title_case(name.trim());
        if name.is_empty() {
            return Err(day_shift_error("El nombre del cliente es obligatorio."));
        }
        let conn = self.conn.lock().unwrap();
        if let Some(cid) = id {
            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM clients WHERE id=?1)", params![cid], |r| r.get(0),
            )?;
            if !exists {
                return Err(day_shift_error("El cliente no existe."));
            }
            conn.execute(
                "UPDATE clients SET name=?1, phone=?2, ci=?3, address=?4, email=?5, notes=?6 WHERE id=?7",
                params![name,
                        if phone.is_empty() { None } else { Some(phone) },
                        if ci.is_empty() { None } else { Some(ci) },
                        if address.is_empty() { None } else { Some(address) },
                        if email.is_empty() { None } else { Some(email) },
                        if notes.is_empty() { None } else { Some(notes) },
                        cid],
            )?;
            conn.execute("UPDATE services SET client=?1 WHERE client_id=?2", params![name, cid])?;
            conn.execute("UPDATE sales SET client_name=?1 WHERE client_id=?2", params![name, cid])?;
            return Ok(cid);
        }
        // Nuevo: buscar existente (por cédula o nombre) sin re-lock (deadlock pattern)
        let existing: Option<i64> = if !ci.trim().is_empty() {
            let raw = ci.trim();
            let digits = norm_ci_digits(raw);
            let with_v = if digits.is_empty() { raw.to_string() } else { format!("V-{}", digits) };
            let with_e = if digits.is_empty() { raw.to_string() } else { format!("E-{}", digits) };
            conn.query_row(
                "SELECT id FROM clients WHERE ci IN (?1,?2,?3,?4) LIMIT 1",
                params![raw, digits, with_v, with_e], |r| r.get(0),
            ).optional()?
        } else {
            conn.query_row("SELECT id FROM clients WHERE name=?1", params![name], |r| r.get(0)).optional()?
        };
        if let Some(cid) = existing {
            conn.execute(
                "UPDATE clients SET name=?1,
                    phone=COALESCE(NULLIF(?2,''), phone),
                    ci=COALESCE(NULLIF(?3,''), ci),
                    address=COALESCE(NULLIF(?4,''), address),
                    email=COALESCE(NULLIF(?5,''), email),
                    notes=COALESCE(NULLIF(?6,''), notes) WHERE id=?7",
                params![name, phone, ci, address, email, notes, cid],
            )?;
            conn.execute("UPDATE services SET client=?1 WHERE client_id=?2", params![name, cid])?;
            conn.execute("UPDATE sales SET client_name=?1 WHERE client_id=?2", params![name, cid])?;
            return Ok(cid);
        }
        conn.execute(
            "INSERT INTO clients (name, phone, ci, address, email, notes) VALUES (?1,?2,?3,?4,?5,?6)",
            params![name,
                    if phone.is_empty() { None } else { Some(phone) },
                    if ci.is_empty() { None } else { Some(ci) },
                    if address.is_empty() { None } else { Some(address) },
                    if email.is_empty() { None } else { Some(email) },
                    if notes.is_empty() { None } else { Some(notes) }],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_client_services(&self, client_id: i64) -> SqlResult<Vec<Service>> {
        let conn = self.conn.lock().unwrap();
        // Try by client_id first, fallback to name match
        let mut stmt = conn.prepare(
            "SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.service_types, s.client_id, s.paid_amount, s.technician_id, s.technician, s.group_id, s.color, s.printed, s.screen_product_id, s.discount_amount, s.photo_in_at, s.photo_out_at, s.pay_intent, s.iva_rate, s.iva_mode FROM services s WHERE s.client_id = ?1 ORDER BY s.id DESC"
        )?;
        let rows = stmt.query_map(params![client_id], |r| {
            Ok(Service {
                id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
                service_types: r.get(21).unwrap_or(None),
                amount: r.get(8)?, payment_method: r.get(9)?,
                date_out: r.get(10)?, status: r.get(11)?, observations: r.get(12)?,
                bank_fee_percent: r.get(13).unwrap_or(0.0),
                bank_fee_amount: r.get(14).unwrap_or(0.0),
                net_amount: r.get(15).unwrap_or(0.0),
                zelle_reference: r.get(16).unwrap_or(None),
                currency: r.get(17).unwrap_or(Some("USD".into())),
                client_ci: r.get(18).unwrap_or(None),
                client_address: r.get(19).unwrap_or(None),
                device_checklist: r.get(20).unwrap_or(None),
                client_id: r.get(22).unwrap_or(None),
                paid_amount: r.get(23).unwrap_or(0.0),
                technician_id: r.get(24).unwrap_or(None),
                technician: r.get(25).unwrap_or(None),
                group_id: r.get(26).unwrap_or(None),
                color: r.get(27).unwrap_or(None),
                printed: r.get(28).unwrap_or(0),
                screen_product_id: r.get(29).unwrap_or(None),
                discount_amount: r.get(30).unwrap_or(0.0),
                photo_in_at: r.get(31).unwrap_or(None),
                photo_out_at: r.get(32).unwrap_or(None),
                pay_intent: r.get(33).unwrap_or(None),
                iva_rate: r.get(34).unwrap_or(0.0),
                iva_mode: r.get(35).unwrap_or_default(),
            })
        })?;
        let mut services = Vec::new();
        for row in rows { services.push(row?); }
        if !services.is_empty() {
            return Ok(services);
        }
        // Fallback: by name
        let client_name: Option<String> = conn.query_row(
            "SELECT name FROM clients WHERE id=?1", params![client_id], |r| r.get(0)
        ).ok();
        if let Some(ref name) = client_name {
            let mut stmt = conn.prepare(
                "SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.service_types, s.client_id, s.paid_amount, s.technician_id, s.technician, s.group_id, s.color, s.printed, s.screen_product_id, s.discount_amount, s.photo_in_at, s.photo_out_at, s.pay_intent, s.iva_rate, s.iva_mode FROM services s WHERE s.client = ?1 ORDER BY s.id DESC"
            )?;
            let rows = stmt.query_map(params![name], |r| {
                Ok(Service {
                    id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                    client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                    fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
                    service_types: r.get(21).unwrap_or(None),
                    amount: r.get(8)?, payment_method: r.get(9)?,
                    date_out: r.get(10)?, status: r.get(11)?, observations: r.get(12)?,
                    bank_fee_percent: r.get(13).unwrap_or(0.0),
                    bank_fee_amount: r.get(14).unwrap_or(0.0),
                    net_amount: r.get(15).unwrap_or(0.0),
                    zelle_reference: r.get(16).unwrap_or(None),
                    currency: r.get(17).unwrap_or(Some("USD".into())),
                    client_ci: r.get(18).unwrap_or(None),
                    client_address: r.get(19).unwrap_or(None),
                    device_checklist: r.get(20).unwrap_or(None),
                    client_id: r.get(22).unwrap_or(None),
                    paid_amount: r.get(23).unwrap_or(0.0),
                    technician_id: r.get(24).unwrap_or(None),
                    technician: r.get(25).unwrap_or(None),
                group_id: r.get(26).unwrap_or(None),
                color: r.get(27).unwrap_or(None),
                printed: r.get(28).unwrap_or(0),
                screen_product_id: r.get(29).unwrap_or(None),
                discount_amount: r.get(30).unwrap_or(0.0),
                photo_in_at: r.get(31).unwrap_or(None),
                photo_out_at: r.get(32).unwrap_or(None),
                pay_intent: r.get(33).unwrap_or(None),
                iva_rate: r.get(34).unwrap_or(0.0),
                iva_mode: r.get(35).unwrap_or_default(),
            })
        })?;
            let mut services = Vec::new();
            for row in rows { services.push(row?); }
            return Ok(services);
        }
        Ok(Vec::new())
    }

    pub fn get_client_sales(&self, client_id: i64) -> SqlResult<Vec<Sale>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.date, s.product_id, s.product_name, s.quantity, s.unit_price, s.total, s.payment_method, s.client_name, s.notes, s.client_id, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, c.ci AS client_ci, s.discount_amount, s.voided_at, s.void_reason, s.iva_rate, s.iva_mode FROM sales s LEFT JOIN clients c ON s.client_id = c.id WHERE s.client_id = ?1 ORDER BY s.date DESC"
        )?;
        let rows = stmt.query_map(params![client_id], |r| {
            Ok(Sale {
                id: r.get(0)?, date: r.get(1)?, product_id: r.get(2)?,
                product_name: r.get(3)?, quantity: r.get(4)?, unit_price: r.get(5)?,
                total: r.get(6)?, payment_method: r.get(7)?, client_name: r.get(8)?,
                notes: r.get(9)?, client_id: r.get(10)?,
                bank_fee_percent: r.get(11).unwrap_or(0.0),
                bank_fee_amount: r.get(12).unwrap_or(0.0),
                net_amount: r.get(13).unwrap_or(0.0),
                zelle_reference: r.get(14).unwrap_or(None),
                currency: r.get(15).unwrap_or(Some("USD".into())),
                client_ci: r.get(16).unwrap_or(None),
                discount_amount: r.get(17).unwrap_or(0.0),
                voided_at: r.get(18).unwrap_or(None),
                void_reason: r.get(19).unwrap_or(None),
                iva_rate: r.get(20).unwrap_or(0.0),
                iva_mode: r.get(21).unwrap_or_default(),
            })
        })?;
        let mut sales = Vec::new();
        for row in rows { sales.push(row?); }
        Ok(sales)
    }

    // --- Autocomplete suggestions ---
    pub fn suggest_products(&self, query: &str, limit: i64) -> SqlResult<Vec<Product>> {
        let conn = self.conn.lock().unwrap();
        // Mismos tokens normalizados que get_products: "red note" sugiere la pantalla
        // de "Xiaomi Redmi Note 11" aunque el catálogo ya esté canónico.
        let tokens = crate::catalog::search_tokens(query);
        let (clause, values) = crate::catalog::search_clause(&tokens, 1);
        let limit_idx = values.len() + 1;
        let sql = format!(
            "SELECT {PRODUCT_COLS} FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE 1=1{clause}
             ORDER BY p.name LIMIT ?{limit_idx}"
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for v in values {
            param_values.push(Box::new(v));
        }
        param_values.push(Box::new(limit));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(Product {
                id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?,
                brand: r.get(3)?, model: r.get(4)?, variant: r.get(5)?,
                compatibility: r.get(6)?, price_cost: r.get(7)?, price_sale: r.get(8)?,
                stock: r.get(9)?, min_stock: r.get(10)?, created_at: r.get(11)?,
                updated_at: r.get(12)?, category_name: r.get(14)?, price_usd: r.get(13)?, supplier: r.get(15).unwrap_or_default(),
                        in_use: r.get(16).unwrap_or(1), code: r.get(17).unwrap_or_default(),
            })
        })?;
        let mut products = Vec::new();
        for row in rows { products.push(row?); }
        Ok(products)
    }

    pub fn suggest_clients(&self, query: &str, limit: i64) -> SqlResult<Vec<Client>> {
        let conn = self.conn.lock().unwrap();
        // La coincidencia por CÉDULA va PRIMERO (el técnico escribe la cédula y
        // el cliente aparece arriba); luego por nombre.
        let mut stmt = conn.prepare(
            "SELECT c.* FROM clients c WHERE c.name LIKE ?1 OR c.phone LIKE ?1 OR c.ci LIKE ?1 \
             ORDER BY CASE WHEN c.ci LIKE ?1 THEN 0 ELSE 1 END, c.name LIMIT ?2"
        )?;
        let rows = stmt.query_map(params![format!("%{}%", query), limit], |r| {
            Ok(Client {
                id: r.get(0)?, name: r.get(1)?, phone: r.get(2)?,
                email: r.get(3)?, notes: r.get(4)?, total_spent: r.get(5)?,
                last_service: r.get(6)?, last_purchase: r.get(7)?, created_at: r.get(8)?,
                ci: r.get(9).unwrap_or(None),
                address: r.get(10).unwrap_or(None),
            })
        })?;
        let mut clients = Vec::new();
        for row in rows { clients.push(row?); }
        Ok(clients)
    }

    // --- Auto-import from CELL WORLD price list ---
    pub fn import_price_list(&self, items_json: &str) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        let items: Vec<serde_json::Value> = serde_json::from_str(items_json).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;
        let mut count = 0i64;
        let cat_pantalla = conn.query_row("SELECT id FROM categories WHERE name='Pantalla'", [], |r| r.get(0)).unwrap_or(1);
        let _cat_tactil = conn.query_row("SELECT id FROM categories WHERE name='Táctil'", [], |r| r.get(0)).unwrap_or(5);
        // Ensure Táctil category exists
        let _ = conn.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Táctil')", []);
        let cat_tactil = conn.query_row("SELECT id FROM categories WHERE name='Táctil'", [], |r| r.get(0)).unwrap_or(1);
        let _ = conn.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Táctil Tablet')", []);

        for item in &items {
            let name = item["name"].as_str().unwrap_or("").to_string();
            let brand = item["brand"].as_str().unwrap_or("").to_string();
            let model = item["model"].as_str().unwrap_or("").to_string();
            let variant = item["variant"].as_str().unwrap_or("").to_string();
            let category = item["category"].as_str().unwrap_or("Pantalla").to_string();
            let price_cost = item["price_cost"].as_f64().unwrap_or(0.0);
            let price_sale = item["price_sale"].as_f64().unwrap_or(0.0);
            let compatibility = item["compatibility"].as_str().unwrap_or("").to_string();

            let cat_id = if category == "Táctil" { cat_tactil } else if category == "Táctil Tablet" { cat_tactil } else { cat_pantalla };

            conn.execute(
                "INSERT OR IGNORE INTO products (name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,0)",
                params![name, cat_id, brand, model, variant, compatibility, price_cost, price_sale],
            )?;
            count += 1;
        }
        Ok(count)
    }

    // --- Inventory ---
    pub fn add_inventory_movement(&self, product_id: i64, type_: &str, quantity: i64, reason: &str, reference: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference) VALUES (?1,?2,?3,?4,?5)",
            params![product_id, type_, quantity, reason, reference],
        )?;
        if type_ == "entrada" {
            conn.execute("UPDATE products SET stock = stock + ?1 WHERE id=?2", params![quantity, product_id])?;
        } else {
            conn.execute("UPDATE products SET stock = stock - ?1 WHERE id=?2", params![quantity, product_id])?;
        }
        Ok(())
    }

    pub fn get_inventory_movements(&self, days: Option<i64>) -> SqlResult<Vec<InventoryMovement>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT m.*, p.name as product_name FROM inventory_movements m LEFT JOIN products p ON m.product_id = p.id WHERE 1=1"
        );
        if let Some(d) = days {
            sql.push_str(&format!(" AND date(m.date) >= date('now','localtime', '-{} days')", d));
        }
        sql.push_str(" ORDER BY m.date DESC");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| {
            Ok(InventoryMovement {
                id: r.get(0)?, date: r.get(1)?, product_id: r.get(2)?,
                r#type: r.get(3)?, quantity: r.get(4)?, reason: r.get(5)?,
                reference: r.get(6)?, product_name: r.get(7)?,
            })
        })?;
        let mut movements = Vec::new();
        for row in rows { movements.push(row?); }
        Ok(movements)
    }

    // --- Lookups ---
    pub fn get_categories(&self) -> SqlResult<Vec<Category>> {
        let conn = self.conn.lock().unwrap();
        // Columnas EXPLÍCITAS (nunca `SELECT *` con mapping posicional: regla del proyecto).
        let mut stmt = conn.prepare("SELECT id, name, description FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(Category { id: r.get(0)?, name: r.get(1)?, description: r.get(2)? })
        })?;
        let mut cats = Vec::new();
        for row in rows { cats.push(row?); }
        Ok(cats)
    }

    // --- F65: CATEGORÍAS DE PRODUCTO QUE AGREGA EL LOCAL ---
    // Pedido del dueño (2026-09-23): «cuando en este inventario pueda registrar nuevas categorías,
    // no esté limitado a crear categorías de productos». Antes la categoría era una lista CERRADA
    // (las 6 del `init` + lo que trajeran los catálogos importados): si el repuesto que llegó no
    // entraba en Pantalla/Teléfono/Accesorio/Repuesto/Batería/Flex no había forma de anotarlo.
    //
    // La tabla `categories` es REAL (id + name UNIQUE + description) y los productos la referencian
    // por ID, así que crear/renombrar una categoría NO toca ninguna ficha: el nombre se lee por JOIN.
    // Reglas (todas en el backend, fail-closed):
    //   · nombre no vacío, recortado y con tope de 40 caracteres;
    //   · sin duplicados comparando el nombre PLEGADO (mayúsculas/acentos): crear «pantalla» cuando
    //     existe «Pantalla» devuelve la que ya está (nunca una gemela);
    //   · las tres categorías del PADRÓN DE TELÉFONOS (`catalog::PHONE_CATEGORIES`) no se renombran
    //     ni se borran: `phones.rs`/`loadlist.rs` filtran por su ID y el catálogo arma el nombre de la
    //     ficha con su nombre («Pantalla Samsung A15»), que el frontend recorta con `partLabel`;
    //   · una categoría CON productos no se borra (se dice cuántos son: el remedio es pasarlos a otra);
    //   · renombrar NO reescribe los nombres de las fichas ya cargadas (esas quedan como se guardaron).

    /// ¿Esta categoría es una de las del PADRÓN DE TELÉFONOS (`catalog::PHONE_CATEGORIES`)?
    ///
    /// **El padrón es por ID** (es lo que filtran `phones.rs`, `loadlist.rs` y `catalog.rs`), así que
    /// el criterio también es por ID: el badge de la pantalla dice exactamente lo que el motor hace.
    /// Antes también se protegía por NOMBRE y eso mentía en una base chica: una categoría propia
    /// llamada «Táctil» quedaba marcada como padrón (y sin poder renombrar ni borrar) mientras el
    /// padrón de modelos NO la miraba. Los nombres del padrón no se pueden DUPLICAR (el duplicado
    /// plegado devuelve la existente), así que protegerlas por id alcanza — y `add_category` además
    /// **reserva** esos ids para que una categoría nueva nunca caiga en ellos.
    fn es_categoria_del_padron(id: i64) -> bool {
        crate::catalog::PHONE_CATEGORIES.contains(&id)
    }

    /// Nombre de categoría validado (recortado, no vacío, tope 40) — el mismo criterio para crear
    /// y para renombrar, así lo que se puede escribir es exactamente lo que se puede corregir.
    fn nombre_de_categoria(name: &str) -> SqlResult<String> {
        let nombre = name.trim();
        if nombre.is_empty() {
            return Err(day_shift_error("El nombre de la categoría no puede estar vacío."));
        }
        if nombre.chars().count() > 40 {
            return Err(day_shift_error("El nombre de la categoría es muy largo (máximo 40 caracteres)."));
        }
        Ok(nombre.to_string())
    }

    /// Descripción opcional (vacía → NULL, nunca cadena vacía guardada).
    fn descripcion_de_categoria(description: &str) -> Option<String> {
        let d = description.trim();
        if d.is_empty() { None } else { Some(d.chars().take(200).collect()) }
    }

    /// F65 — Las categorías del catálogo con su uso real (fichas, unidades y si son del padrón).
    /// Lo llama la pestaña «Ajustes» (dueño): con esto la pantalla puede decir POR QUÉ una categoría
    /// no se puede borrar antes de intentarlo. Es de SOLO LECTURA (sin gate de rol, como el resto).
    pub fn get_categories_with_usage(&self) -> SqlResult<Vec<CategoryUsage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, c.description,
                    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id),
                    (SELECT COALESCE(SUM(p.stock), 0) FROM products p WHERE p.category_id = c.id)
             FROM categories c ORDER BY c.name",
        )?;
        let rows = stmt.query_map([], |r| {
            let id: i64 = r.get(0)?;
            let name: String = r.get(1)?;
            Ok(CategoryUsage {
                phone_padron: Self::es_categoria_del_padron(id),
                id,
                name,
                description: r.get(2)?,
                products: r.get(3)?,
                units: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows { out.push(row?); }
        Ok(out)
    }

    /// F65 — Crea una categoría de producto y devuelve la categoría resultante.
    /// Si el nombre ya existe (comparando plegado) NO se crea: se devuelve la que ya está con
    /// `created = false`, para que la UI la deje elegida y avise en vez de partir el catálogo en dos.
    /// No exige día abierto: es una preferencia del local, no plata (igual que las categorías de trabajo).
    pub fn add_category(&self, name: &str, description: &str) -> SqlResult<CategoryOutcome> {
        let nombre = Self::nombre_de_categoria(name)?;
        let desc = Self::descripcion_de_categoria(description);
        let conn = self.conn.lock().unwrap();
        let clave = plegar_texto(&nombre);
        let existentes: Vec<(i64, String, Option<String>)> = {
            let mut stmt = conn.prepare("SELECT id, name, description FROM categories")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            let mut v = Vec::new();
            for row in rows { v.push(row?); }
            v
        };
        if let Some((id, ya, ya_desc)) = existentes.iter().find(|(_, n, _)| plegar_texto(n) == clave) {
            return Ok(CategoryOutcome {
                category: Category { id: *id, name: ya.clone(), description: ya_desc.clone() },
                created: false,
            });
        }
        // EL ID SE ELIGE A MANO (2ª vuelta adversarial): `PHONE_CATEGORIES = [1, 18, 19]` es el padrón
        // de teléfonos **por ID** — lo filtran `phones.rs`, `loadlist.rs` y `catalog.rs`, y el barrido
        // «la lista es todo» pone en 0 el stock de esas categorías. `AUTOINCREMENT` reparte los ids de
        // a uno, así que en una base creada por `init()` (6 categorías del arranque, sin Táctil ni
        // Táctil Tablet) la **12.ª y la 13.ª** categoría que creaba el dueño caían JUSTO en 18 y 19: sus
        // fichas entraban al padrón de Modelos, el barrido les ponía el stock en 0 y la categoría
        // quedaba fija (sin poder renombrar ni borrar) sin que nadie lo hubiera pedido. Reservar esos
        // ids es más barato —y más seguro— que cambiar el padrón.
        //
        // Se toma `MAX(id) + 1` (y no el `last_insert_rowid`): un id que se libere al borrar la última
        // categoría puede volver a usarse, y eso es inocuo porque una categoría SOLO se puede borrar
        // cuando ningún producto la usa (nada queda apuntando a ese id).
        let mut id_nuevo: i64 = conn.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM categories", [], |r| r.get(0))?;
        while crate::catalog::PHONE_CATEGORIES.contains(&id_nuevo) {
            id_nuevo += 1;
        }
        conn.execute(
            "INSERT INTO categories (id, name, description) VALUES (?1, ?2, ?3)",
            params![id_nuevo, nombre, desc],
        )?;
        Ok(CategoryOutcome { category: Category { id: id_nuevo, name: nombre, description: desc }, created: true })
    }

    /// F65 — Renombra una categoría (y actualiza su descripción). NO toca ningún producto: el
    /// `category_id` de las fichas sigue siendo el mismo, así que lo ya cargado se lee igual (las
    /// fichas conservan el nombre con el que se guardaron; el nombre nuevo se usa de acá en adelante).
    /// Las del padrón de teléfonos solo aceptan cambio de DESCRIPCIÓN (mismo nombre exacto).
    pub fn rename_category(&self, id: i64, name: &str, description: &str) -> SqlResult<Category> {
        let nombre = Self::nombre_de_categoria(name)?;
        let desc = Self::descripcion_de_categoria(description);
        let conn = self.conn.lock().unwrap();
        let actual: Option<String> = conn
            .query_row("SELECT name FROM categories WHERE id=?1", params![id], |r| r.get(0))
            .optional()?;
        let actual = actual.ok_or_else(|| day_shift_error("Categoría no encontrada."))?;
        // Las del padrón de teléfonos: el NOMBRE es fijo (el buscador de modelos y el nombre de las
        // fichas dependen de él), pero la DESCRIPCIÓN sí se puede anotar — por eso el gate compara el
        // nombre exacto: mandar el mismo nombre es «solo descripción», cualquier otro es renombrar.
        // Las del PADRÓN DE TELÉFONOS: el NOMBRE es fijo (el buscador de modelos y el nombre de las
        // fichas dependen de él), pero la DESCRIPCIÓN sí se puede anotar — por eso el gate compara el
        // nombre exacto: mandar el mismo nombre es «solo descripción», cualquier otro es renombrar.
        if Self::es_categoria_del_padron(id) && nombre != actual {
            return Err(day_shift_error(&format!(
                "«{}» es una de las categorías del padrón de teléfonos: su nombre es fijo (el buscador de modelos y el nombre de las fichas dependen de él). Sí podés cambiarle la descripción.",
                actual
            )));
        }
        let clave = plegar_texto(&nombre);
        let repetida: Option<String> = {
            let mut stmt = conn.prepare("SELECT name FROM categories WHERE id <> ?1")?;
            let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
            let mut v = Vec::new();
            for row in rows { v.push(row?); }
            v.into_iter().find(|n| plegar_texto(n) == clave)
        };
        if let Some(otra) = repetida {
            return Err(day_shift_error(&format!("Ya existe otra categoría con ese nombre: «{}».", otra)));
        }
        conn.execute(
            "UPDATE categories SET name=?1, description=?2 WHERE id=?3",
            params![nombre, desc, id],
        )?;
        Ok(Category { id, name: nombre, description: desc })
    }

    /// F65 — Borra una categoría VACÍA (deshacer un error de tipeo). Fail-closed:
    ///   · no existe → error;
    ///   · es del padrón de teléfonos → error (aunque esté vacía);
    ///   · la usan productos → error diciendo CUÁNTOS (el remedio: pasarlos a otra categoría).
    pub fn delete_category(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let actual: Option<String> = conn
            .query_row("SELECT name FROM categories WHERE id=?1", params![id], |r| r.get(0))
            .optional()?;
        let actual = actual.ok_or_else(|| day_shift_error("Categoría no encontrada."))?;
        if Self::es_categoria_del_padron(id) {
            return Err(day_shift_error(&format!(
                "«{}» es una de las categorías del padrón de teléfonos: no se puede eliminar.",
                actual
            )));
        }
        let usos: i64 = conn.query_row(
            "SELECT COUNT(*) FROM products WHERE category_id=?1",
            params![id],
            |r| r.get(0),
        )?;
        if usos > 0 {
            return Err(day_shift_error(&format!(
                "No se puede eliminar «{}»: {} productos la están usando. Pasalos a otra categoría y volvé a intentar (ninguna ficha se borra por esto).",
                actual, usos
            )));
        }
        conn.execute("DELETE FROM categories WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn get_payment_methods(&self) -> SqlResult<Vec<PaymentMethod>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM payment_methods ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(PaymentMethod { id: r.get(0)?, name: r.get(1)? })
        })?;
        let mut methods = Vec::new();
        for row in rows { methods.push(row?); }
        Ok(methods)
    }

    pub fn get_service_statuses(&self) -> SqlResult<Vec<ServiceStatus>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM service_statuses ORDER BY id")?;
        let rows = stmt.query_map([], |r| {
            Ok(ServiceStatus { id: r.get(0)?, name: r.get(1)? })
        })?;
        let mut statuses = Vec::new();
        for row in rows { statuses.push(row?); }
        Ok(statuses)
    }

    // --- Daily Ledger ---
    fn compute_daily_totals(&self, conn: &rusqlite::Connection, start_date: &str, end_date: &str) -> SqlResult<Vec<DailyTotals>> {
        let union_sql = format!(
            "SELECT d, payment_method, total, bank_fee_amount, net_amount, currency, presume FROM (
                SELECT date(date) as d, payment_method, total, bank_fee_amount,
                       CAST(COALESCE(net_amount, total) AS REAL) as net_amount, COALESCE(currency,'USD') as currency,
                       0 as presume
                FROM sales WHERE date(date) >= ?1 AND date(date) <= ?2 AND voided_at IS NULL
                UNION ALL
                SELECT date(payment_date) as d, payment_method, amount, bank_fee_amount,
                       CAST(COALESCE(net_amount, amount) AS REAL) as net_amount, COALESCE(currency,'USD') as currency,
                       0 as presume
                FROM service_payments WHERE date(payment_date) >= ?1 AND date(payment_date) <= ?2
                UNION ALL
                SELECT date(date_out) as d, payment_method, amount, bank_fee_amount,
                       CAST(COALESCE(net_amount, amount) AS REAL) as net_amount, COALESCE(currency,'USD') as currency,
                       1 as presume
                FROM services WHERE status='Entregado' AND date(date_out) >= ?1 AND date(date_out) <= ?2
                  AND NOT EXISTS (SELECT 1 FROM service_payments sp WHERE sp.service_id = services.id)
            )
            ORDER BY d"
        );
        let mut stmt = conn.prepare(&union_sql)?;
        let rows = stmt.query_map(params![start_date, end_date], |r| {
            let d: String = r.get(0)?;
            let method: Option<String> = r.get(1)?;
            let total: f64 = r.get(2)?;
            let bank_fee: f64 = r.get(3)?;
            let net: f64 = r.get(4)?;
            let currency: String = r.get(5)?;
            let presume: i64 = r.get(6)?;
            Ok((d, method, total, bank_fee, net, currency, presume))
        })?;
        // Tasa BCV por fecha: la del cierre del día (daily_closings), fallback día abierto
        let mut tasa_map: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
        let mut tasa_stmt = conn.prepare("SELECT close_date, tasa_bcv FROM daily_closings WHERE close_date >= ?1 AND close_date <= ?2 AND tasa_bcv > 0")?;
        let tasa_rows = tasa_stmt.query_map(params![start_date, end_date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        })?;
        for tr in tasa_rows {
            let (d, t) = tr?;
            tasa_map.insert(d, t);
        }
        let fallback_tasa: f64 = conn.query_row(
            "SELECT tasa_bcv FROM daily_closings WHERE is_closed=0 AND tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1",
            [], |r| r.get(0),
        ).optional()?.unwrap_or(0.0);
        // Si no hay día abierto con tasa, usar el último cierre que sí tenga tasa (el equivalente USD nunca queda en 0)
        let fallback_tasa: f64 = if fallback_tasa > 0.0 {
            fallback_tasa
        } else {
            conn.query_row(
                "SELECT tasa_bcv FROM daily_closings WHERE tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1",
                [], |r| r.get(0),
            ).optional()?.unwrap_or(0.0)
        };
        let mut daily_map: std::collections::HashMap<String, DailyTotals> = std::collections::HashMap::new();
        for row in rows {
            let (d, method, total, bank_fee, net, currency, presume) = row?;
            let entry = daily_map.entry(d.clone()).or_insert(DailyTotals {
                date: d.clone(), pos_charged: 0.0, pos_fees: 0.0, pos_net: 0.0,
                pos_charged_usd: 0.0, pos_charged_bs: 0.0, pos_net_usd: 0.0, pos_net_bs: 0.0,
                cash_usd: 0.0, cash_bs: 0.0, zelle_total: 0.0,
                pago_movil_total: 0.0, transfer_bs_total: 0.0,
                usd_cash_total: 0.0, grand_total: 0.0,
                grand_usd: 0.0, grand_bs: 0.0, tasa_bcv: 0.0,
                refund_usd: 0.0, refund_bs: 0.0,
            });
            // Moneda SIEMPRE derivada del método (harness): Efectivo Bs/Pago Móvil/Transf Bs/Punto (Bs) → VES
            let cur = normalize_payment_currency(method.as_deref().unwrap_or(""), &currency).to_string();
            // **PRESUNCIÓN de cobro en mostrador (revisión adversarial F39):** una orden ENTREGADA sin
            // ningún pago registrado entra a la caja con el monto del formulario. Ese monto es SIEMPRE
            // en DÓLARES (`services.amount` es el precio de la lista del taller, el form dice «Monto ($)»),
            // pero el método del formulario puede ser en bolívares. Antes se sumaba el número crudo al
            // bucket de Bs → 20 dólares contados como 20 BOLÍVARES (749× menos): el esperado del cajón en
            // Bs quedaba ridículo y la «Diferencia Bs.» de F39 mostraba un descuadre inventado.
            // Se convierte con la **tasa del día de la entrega** (`tasa_map`/`fallback_tasa`, las mismas
            // que usa el resto de la función). Sin tasa no se puede expresar el monto en Bs.: se DEJA
            // FUERA de la caja en vez de inventar un número (invariante «nada estimado en la caja»).
            let (total, bank_fee, net) = if presume == 1 && cur == "VES" {
                let tasa = tasa_map.get(&d).copied().unwrap_or(fallback_tasa);
                if tasa > 0.0 {
                    (total * tasa, bank_fee * tasa, net * tasa)
                } else {
                    continue;
                }
            } else {
                (total, bank_fee, net)
            };
            let pos_methods = ["Punto de Venta ($)", "Punto de Venta (Bs)", "Punto de Venta"];
            let is_pos = method.as_deref().map_or(false, |m| pos_methods.contains(&m));
            let is_zelle = method.as_deref().map_or(false, |m| m == "Transferencia Zelle" || m == "Zelle");
            if is_pos {
                entry.pos_charged += total;
                entry.pos_fees += bank_fee;
                entry.pos_net += net;
                // Desglose del punto por moneda (el cobro puede ser en $ o en Bs)
                if cur == "USD" {
                    entry.pos_charged_usd += total;
                    entry.pos_net_usd += net;
                } else {
                    entry.pos_charged_bs += total;
                    entry.pos_net_bs += net;
                }
            } else if is_zelle {
                entry.zelle_total += total;
            } else {
                match method.as_deref() {
                    Some("Efectivo Bs") => { entry.cash_bs += total; }
                    Some("Divisas (USD Cash)") => { entry.usd_cash_total += total; }
                    Some("Pago Móvil") | Some("Pago Movil") => { entry.pago_movil_total += total; }
                    Some("Transferencia Bs") => { entry.transfer_bs_total += total; }
                    _ => {
                        if cur == "USD" { entry.usd_cash_total += total; }
                        else { entry.cash_bs += total; }
                    }
                }
            }
            // Desglose por moneda (mismo criterio que el antiguo grand_total: Punto usa neto, resto bruto)
            let contrib = if is_pos { net } else { total };
            if cur == "USD" { entry.grand_usd += contrib; }
            else { entry.grand_bs += contrib; }
            // F42 — DEVUELTO al cliente, por MONEDA y en positivo: es lo que el operario quiere ver
            // («cuánto devolví hoy»). Los buckets por método ya quedan NETOS (una devolución es un
            // movimiento negativo con el método por el que salió la plata), así que esto NO se suma:
            // sólo se informa. La moneda es la del movimiento (`cur`), no la del método del formulario.
            if total < 0.0 {
                if cur == "USD" { entry.refund_usd += -total; }
                else { entry.refund_bs += -total; }
            }
        }
        let mut totals: Vec<DailyTotals> = daily_map.into_values().collect();
        totals.sort_by(|a, b| a.date.cmp(&b.date));
        for t in &mut totals {
            let tasa = tasa_map.get(&t.date).copied().unwrap_or(fallback_tasa);
            t.tasa_bcv = tasa;
            t.grand_total = t.grand_usd + if tasa > 0.0 { t.grand_bs / tasa } else { 0.0 };
        }
        Ok(totals)
    }

    pub fn get_daily_totals(&self, start_date: &str, end_date: &str) -> SqlResult<Vec<DailyTotals>> {
        let conn = self.conn.lock().unwrap();
        self.compute_daily_totals(&conn, start_date, end_date)
    }

    // --- Settings / PIN ---
    //
    // El PIN NUNCA se guarda en texto plano: se guarda su HASH (PBKDF2-HMAC-SHA256 con sal
    // aleatoria por PIN) en el formato `pbkdf2$<iteraciones>$<sal_hex>$<hash_hex>`.
    // Una base vieja con el PIN en texto plano (4 dígitos) SIGUE FUNCIONANDO y se actualiza al
    // hash sola la primera vez que se verifica bien: una actualización nunca deja al dueño afuera.
    //
    // F69 (revisión adversarial) — EL BLOQUEO POR INTENTOS AHORA SE PERSISTE (`settings.pin_failures`
    // y `settings.pin_locked_until`): antes vivía sólo en memoria, así que reiniciar la app borraba el
    // castigo y quedaban «5 intentos por arranque» contra un PIN de 4 dígitos (cualquiera puede
    // reiniciar el exe desde el escritorio). Los contadores en memoria siguen existiendo para las
    // lecturas rápidas del reloj, pero la fuente es la base.
    pub fn set_pin(&self, pin: &str) -> SqlResult<()> {
        if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(day_shift_error("El PIN debe tener exactamente 4 dígitos."));
        }
        // Cambiar el PIN es del DUEÑO: o no hay PIN todavía (primera vez) o la sesión de dueño
        // está abierta (la abre `verify_pin` con el PIN correcto). Un invoke directo desde una
        // sesión de cajera NO puede cambiar el PIN. (owner_can_edit toma su propio lock: se
        // consulta ANTES de bloquear la conexión.)
        let hay_pin = self.get_pin_status()?;
        if hay_pin && !self.owner_can_edit() {
            return Err(day_shift_error(
                "Solo el dueño puede cambiar el PIN: entrá con el PIN actual.",
            ));
        }
        let stored = hash_pin(pin)?;
        // F69 (revisión adversarial): este PIN es el del DUEÑO QUE ESTÁ EN SESIÓN, no el de
        // TODOS los masters. Antes `WHERE role='master'` le pisaba el PIN a cualquier otro
        // dueño del padrón (y con él, su forma de entrar). Si no hay sesión de dueño (primera
        // vez, instalación de un solo usuario) se toma el master de menor id.
        let en_sesion: Option<i64> = if self.session_active_for(Some("master")) {
            self.current_user().map(|u| u.id)
        } else {
            None
        };
        let objetivo: Option<i64> = match en_sesion {
            Some(id) => Some(id),
            None => {
                let conn = self.conn.lock().unwrap();
                conn.query_row(
                    "SELECT id FROM users WHERE role='master' ORDER BY id LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .optional()?
            }
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin', ?1)",
            params![stored],
        )?;
        // F68: el PIN del dueño vive también en SU fila de `users` (la pantalla de acceso nueva
        // entra por `verify_user_pin`). Si no se sincronizara, el dueño quedaría con dos PIN
        // distintos según por dónde entre.
        if let Some(id) = objetivo {
            conn.execute(
                "UPDATE users SET pin_hash=?1 WHERE id=?2",
                params![stored, id],
            )?;
        }
        Ok(())
    }

    pub fn get_pin_status(&self) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap();
        let value: Option<Option<String>> = conn
            .query_row("SELECT value FROM settings WHERE key='pin'", [], |r| r.get(0))
            .optional()?;
        Ok(value.flatten().map_or(false, |v| !v.is_empty()))
    }

    /// Segundos que faltan para poder volver a probar el PIN (0 = se puede probar ya).
    /// F69: la fuente es la BASE (`settings.pin_locked_until`), no sólo la memoria: reiniciar la app
    /// ya no borra el castigo. Si la base no se puede leer, cae al contador en memoria (fail-safe: el
    /// bloqueo en memoria sigue valiendo).
    pub fn pin_lock_seconds(&self) -> u64 {
        let desde_base: Option<i64> = self
            .get_setting("pin_locked_until")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok());
        if let Some(hasta) = desde_base {
            let ahora = now_secs() as i64;
            if hasta > ahora {
                return (hasta - ahora) as u64 + 1;
            }
        }
        let guard = self.pin_locked_until.lock().unwrap();
        match *guard {
            Some(until) if until > std::time::Instant::now() => {
                until.duration_since(std::time::Instant::now()).as_secs() + 1
            }
            _ => 0,
        }
    }

    /// F69 — un PIN/entrada fallida cuenta para el MISMO bloqueo por intentos que el PIN viejo:
    /// si no, la pantalla nueva de personas sería un camino sin límite para probar PINes.
    /// El contador y la hora del bloqueo se guardan en `settings` (sobreviven al reinicio).
    fn pin_failure(&self) {
        let n = self.pin_failures.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        let _ = self.set_setting("pin_failures", &n.to_string());
        if n >= PIN_MAX_ATTEMPTS {
            let hasta = now_secs() + PIN_LOCK_SECS;
            *self.pin_locked_until.lock().unwrap() =
                Some(std::time::Instant::now() + std::time::Duration::from_secs(PIN_LOCK_SECS));
            self.pin_failures.store(0, std::sync::atomic::Ordering::Relaxed);
            let _ = self.set_setting("pin_failures", "0");
            let _ = self.set_setting("pin_locked_until", &hasta.to_string());
        }
    }

    fn pin_success(&self) {
        self.pin_failures.store(0, std::sync::atomic::Ordering::Relaxed);
        *self.pin_locked_until.lock().unwrap() = None;
        let _ = self.set_setting("pin_failures", "0");
        let _ = self.set_setting("pin_locked_until", "0");
    }

    /// Lee el contador de intentos de la base (0 si nunca falló). Lo usa `pin_lock_seconds` y lo
    /// pueden comprobar las pruebas: el bloqueo ya no vive sólo en memoria.
    pub fn pin_failures_persisted(&self) -> i64 {
        self.get_setting("pin_failures")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0)
    }

    pub fn verify_pin(&self, pin: &str) -> SqlResult<bool> {
        // Bloqueo por intentos: NO se compara nada mientras esté bloqueado.
        let faltan = self.pin_lock_seconds();
        if faltan > 0 {
            return Err(day_shift_error(&format!(
                "Demasiados intentos fallidos. Probá de nuevo en {faltan} segundo(s)."
            )));
        }
        let stored: Option<Option<String>> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row("SELECT value FROM settings WHERE key='pin'", [], |r| r.get(0))
                .optional()?
        };
        let stored = stored.flatten().unwrap_or_default();
        let (ok, upgrade) = match check_pin(pin, &stored) {
            Some(necesita_upgrade) => (true, necesita_upgrade),
            None => (false, false),
        };
        if ok {
            // base vieja con texto plano → se guarda el hash (una sola vez, sin avisar)
            if upgrade {
                let hashed = hash_pin(pin)?;
                let conn = self.conn.lock().unwrap();
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin', ?1)",
                    params![hashed],
                );
            }
            self.pin_success();
        } else {
            self.pin_failure();
        }
        // el PIN correcto = sesión de DUEÑO desbloqueada y SELLADA AHORA (vence a las
        // OWNER_SESSION_HOURS; la usa el gate de escritura `require_owner`). Un PIN
        // incorrecto apaga la sesión y olvida la fecha.
        self.owner_session_set(ok);
        Ok(ok)
    }

    /// F68 — borra el PIN del dueño. Deja la instalación **sin PIN**, o sea que cualquiera entra y
    /// el gate de dueño se abre solo (es la decisión del dueño para su equipo de un solo usuario).
    /// Por eso: (a) exige el PIN actual, (b) NO se permite si hay más de una persona activa — ahí
    /// la instalación necesita PIN para saber quién es quién, y un Master sin PIN no podría ni
    /// entrar por la pantalla nueva, y (c) borra también `users.pin_hash` del master: si quedara,
    /// el PIN viejo seguiría sirviendo para entrar (`verify_user_pin`).
    pub fn remove_pin(&self, pin: &str) -> SqlResult<bool> {
        if !self.verify_pin(pin)? {
            return Err(day_shift_error("PIN incorrecto."));
        }
        if self.has_multiple_people() {
            return Err(day_shift_error(
                "No se puede quitar el PIN: esta instalación tiene más de una persona (Personas y accesos). \
                 Cambiale el PIN al dueño en vez de quitarlo.",
            ));
        }
        let objetivo: Option<i64> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT id FROM users WHERE role='master' ORDER BY id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?
        };
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM settings WHERE key='pin'", [])?;
        if let Some(id) = objetivo {
            conn.execute("UPDATE users SET pin_hash='' WHERE id=?1", params![id])?;
        }
        Ok(true)
    }

    // --- Configuración genérica (tabla settings key/value) ---
    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let v: Option<Option<String>> = conn
            .query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0))
            .optional()?;
        Ok(v.flatten())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    // --- F74: LA CONFIGURACIÓN DEL IVA ---
    /// La clave de la tabla `settings` donde vive la configuración del IVA.
    pub const TAX_CONFIG_KEY: &'static str = "tax_config";

    /// La configuración del IVA guardada. **Fail-closed**: si no hay nada guardado o el JSON está
    /// roto, devuelve la de fábrica — que tiene el IVA **APAGADO** (nunca se le inventa un impuesto al
    /// dueño) — y sanea el modo (cualquier cosa que no sea «agregado» se lee como «incluido», que es
    /// el que NO cambia lo que paga el cliente).
    pub fn get_tax_config(&self) -> TaxConfig {
        let crudo = self.get_setting(Self::TAX_CONFIG_KEY).ok().flatten().unwrap_or_default();
        let mut cfg: TaxConfig = serde_json::from_str(&crudo).unwrap_or_default();
        cfg.modo = if cfg.modo == "agregado" { "agregado".to_string() } else { "incluido".to_string() };
        if !cfg.alicuota.is_finite() || cfg.alicuota < 0.0 || cfg.alicuota > 100.0 {
            cfg.alicuota = TaxConfig::default().alicuota;
        }
        cfg
    }

    /// Guarda la configuración del IVA VALIDADA (fail-closed): el modo tiene que ser uno de los dos y
    /// la alícuota un número entre 0 y 100. Devuelve lo que quedó guardado.
    pub fn set_tax_config(&self, activo: bool, alicuota: f64, modo: &str) -> SqlResult<TaxConfig> {
        let modo = modo.trim().to_lowercase();
        if modo != "incluido" && modo != "agregado" {
            return Err(day_shift_error(
                "El modo del IVA tiene que ser «incluido» (ya viene en el precio) o «agregado» (se suma al cobrar).",
            ));
        }
        if !alicuota.is_finite() || alicuota < 0.0 || alicuota > 100.0 {
            return Err(day_shift_error("La alícuota del IVA tiene que ser un número entre 0 y 100 (por ejemplo 16)."));
        }
        let cfg = TaxConfig { activo, alicuota, modo };
        self.set_setting(Self::TAX_CONFIG_KEY, &serde_json::to_string(&cfg).unwrap_or_default())?;
        Ok(cfg)
    }

    // --- F74: EL LIBRO DE IVA DEL PERÍODO ---
    /// Las operaciones del período AGRUPADAS por alícuota (ventas vigentes + órdenes de servicio), que
    /// es lo que hace falta para declarar el IVA. Se agrupa acá (SQL) y el desglose base/IVA se calcula
    /// con la regla pura del frontend (`src/lib/iva.ts`): UNA sola implementación de la matemática.
    ///
    /// Criterios (los mismos del libro del día): las ventas **anuladas no cuentan** (F70) y de las
    /// órdenes se toma su `amount` (lo que paga el cliente) por fecha de RECIBIDO. Las filas sin IVA
    /// entran igual (alícuota 0) para que el total del libro cuadre con la facturación del período.
    pub fn get_iva_groups(&self, start_date: &str, end_date: &str) -> SqlResult<Vec<IvaGroupRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT iva_rate, SUM(total) AS total, COUNT(*) AS operaciones FROM (
                 SELECT COALESCE(iva_rate, 0) AS iva_rate, total AS total
                   FROM sales
                  WHERE date(date) BETWEEN date(?1) AND date(?2) AND voided_at IS NULL
                 UNION ALL
                 SELECT COALESCE(iva_rate, 0) AS iva_rate, amount AS total
                   FROM services
                  WHERE date(date_in) BETWEEN date(?1) AND date(?2) AND amount > 0
             ) GROUP BY iva_rate ORDER BY iva_rate DESC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date], |r| {
            Ok(IvaGroupRow {
                iva_rate: r.get(0).unwrap_or(0.0),
                total: r.get(1).unwrap_or(0.0),
                operaciones: r.get(2).unwrap_or(0),
            })
        })?;
        let mut grupos = Vec::new();
        for g in rows { grupos.push(g?); }
        Ok(grupos)
    }

    // --- F62: CATEGORÍAS DE TRABAJO QUE AGREGA EL LOCAL ---
    // Pedido del dueño (2026-09-21): «en las categorías o los types, donde sale Otro, cuando vas a
    // hacer un registro poder registrar ahí mismo una nueva categoría con un +».
    //
    // Viven en `settings` bajo la clave `work_types_extra`, como JSON array de nombres. Son del LOCAL
    // (no del producto) y NO tocan las órdenes viejas: la etiqueta viaja dentro de cada orden, así que
    // borrar o renombrar una categoría más adelante no rompe nada de lo ya registrado.

    /// Las categorías extra del local (JSON array; `[]` si nunca se agregó ninguna o el valor guardado
    /// no es un array válido — fail-closed: nunca se devuelve basura al frontend).
    pub fn get_work_types_extra(&self) -> SqlResult<String> {
        let crudo = self.get_setting("work_types_extra")?.unwrap_or_default();
        let t = crudo.trim();
        if t.is_empty() {
            return Ok("[]".to_string());
        }
        match serde_json::from_str::<Vec<String>>(t) {
            Ok(lista) => Ok(serde_json::to_string(&lista).unwrap_or_else(|_| "[]".to_string())),
            Err(_) => Ok("[]".to_string()),
        }
    }

    /// Agrega una categoría y devuelve la lista COMPLETA resultante (JSON array).
    /// Validación acá (no en el frontend): no vacía, tope de 40 caracteres y sin duplicados que solo
    /// cambien mayúsculas/acentos. No exige día abierto: es una preferencia del local, no plata.
    pub fn add_work_type_extra(&self, name: &str) -> SqlResult<String> {
        let nombre = name.trim();
        if nombre.is_empty() {
            return Err(day_shift_error("La categoría no puede estar vacía."));
        }
        if nombre.chars().count() > 40 {
            return Err(day_shift_error("El nombre de la categoría es muy largo (máximo 40 caracteres)."));
        }
        let actual = self.get_work_types_extra()?;
        let mut lista: Vec<String> = serde_json::from_str(&actual).unwrap_or_default();
        let clave = plegar_texto(nombre);
        if lista.iter().any(|x| plegar_texto(x) == clave) {
            return Err(day_shift_error("Esa categoría ya existe."));
        }
        lista.push(nombre.to_string());
        let json = serde_json::to_string(&lista)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        self.set_setting("work_types_extra", &json)?;
        Ok(json)
    }

    /// Quita una categoría del local (comparando plegado) y devuelve la lista restante.
    /// NO toca las órdenes: la etiqueta vive dentro de cada orden, así que lo ya registrado se lee
    /// igual (y el trabajo sigue apareciendo en los contadores como etiqueta propia).
    pub fn remove_work_type_extra(&self, name: &str) -> SqlResult<String> {
        let clave = plegar_texto(name);
        let actual = self.get_work_types_extra()?;
        let lista: Vec<String> = serde_json::from_str(&actual).unwrap_or_default();
        let quedan: Vec<String> = lista.into_iter().filter(|x| plegar_texto(x) != clave).collect();
        let json = serde_json::to_string(&quedan)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        self.set_setting("work_types_extra", &json)?;
        Ok(json)
    }

    // --- Impresora térmica (puerto COM + impresora de Windows persisten en settings) ---
    pub fn get_printer_settings(&self) -> SqlResult<PrinterSettings> {
        let default = PrinterSettings {
            port: String::new(), baud: 9600, width: 58, windows_printer: String::new(),
            business_name: "SERVICIO TECNICO".into(), business_line: "WILIAM SALGADO".into(),
            logo: String::new(),
        };
        Ok(PrinterSettings {
            port: self.get_setting("printer_port")?.unwrap_or_default(),
            baud: match self.get_setting("printer_baud")? {
                Some(b) => b.parse::<u32>().unwrap_or(default.baud),
                None => default.baud,
            },
            width: match self.get_setting("printer_width")? {
                Some(w) => w.parse::<u32>().unwrap_or(default.width),
                None => default.width,
            },
            windows_printer: self.get_setting("printer_windows")?.unwrap_or_default(),
            business_name: self.get_setting("printer_business_name")?.unwrap_or(default.business_name),
            business_line: self.get_setting("printer_business_line")?.unwrap_or(default.business_line),
            logo: self.get_setting("printer_logo")?.unwrap_or_default(),
        })
    }

    pub fn set_printer_settings(&self, port: &str, baud: u32, width: u32, windows_printer: &str,
                                business_name: &str, business_line: &str, logo: &str) -> SqlResult<()> {
        self.set_setting("printer_port", port)?;
        self.set_setting("printer_baud", &baud.to_string())?;
        self.set_setting("printer_width", &width.to_string())?;
        self.set_setting("printer_windows", windows_printer)?;
        self.set_setting("printer_business_name", business_name)?;
        self.set_setting("printer_business_line", business_line)?;
        self.set_setting("printer_logo", logo)?;
        Ok(())
    }

    // --- Pago Móvil detail del día ---
    pub fn get_pago_movil_detail(&self, date: &str) -> SqlResult<Vec<PagoMovilDetail>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT zelle_reference, total, 'Venta' as source, date FROM sales
                   WHERE (payment_method LIKE '%Móvil%' OR payment_method LIKE '%Movil%') AND date(date) = ?1
                     AND voided_at IS NULL
                   UNION ALL
                   SELECT sp.zelle_reference, sp.amount, 'Abono ' || COALESCE(s.order_num, ''), sp.payment_date
                   FROM service_payments sp
                   JOIN services s ON s.id = sp.service_id
                   WHERE (sp.payment_method LIKE '%Móvil%' OR sp.payment_method LIKE '%Movil%') AND date(sp.payment_date) = ?1
                   ORDER BY date";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(params![date], |r| {
            Ok(PagoMovilDetail {
                reference: r.get(0).unwrap_or(None),
                amount: r.get(1)?,
                source: r.get(2)?,
            })
        })?;
        let mut details = Vec::new();
        for row in rows { details.push(row?); }
        Ok(details)
    }

    // --- Exportar reporte diario a CSV (Excel es-VE) ---
    pub fn export_daily_report(&self, start_date: &str, end_date: &str) -> SqlResult<String> {
        // Totales y cierres ANTES de tomar el lock (ambos lo toman → mutex no reentrante)
        let totals = self.get_daily_totals(start_date, end_date)?;
        let all_closings = self.get_daily_closings()?;
        let closings: Vec<&DailyClosing> = all_closings.iter()
            .filter(|c| c.close_date.as_str() >= start_date && c.close_date.as_str() <= end_date)
            .collect();
        let zero = DailyTotals {
            date: String::new(), pos_charged: 0.0, pos_fees: 0.0, pos_net: 0.0,
            pos_charged_usd: 0.0, pos_charged_bs: 0.0, pos_net_usd: 0.0, pos_net_bs: 0.0,
            cash_usd: 0.0, cash_bs: 0.0, zelle_total: 0.0,
            pago_movil_total: 0.0, transfer_bs_total: 0.0,
            usd_cash_total: 0.0, grand_total: 0.0,
            grand_usd: 0.0, grand_bs: 0.0, tasa_bcv: 0.0,
            refund_usd: 0.0, refund_bs: 0.0,
        };
        let t_of = |d: &str| totals.iter().find(|x| x.date == d).unwrap_or(&zero);

        let conn = self.conn.lock().unwrap();

        // Ventas del rango (F70: se incluye la marca de anulada para que el reporte no cuente una
        // venta anulada como buena — la fila queda, con su motivo, pero se ve que no vale)
        let mut sales_rows: Vec<(Option<String>, Option<String>, i64, f64, f64, Option<String>, Option<String>, Option<String>, Option<String>)> = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT date, product_name, quantity, unit_price, total, payment_method, zelle_reference, client_name,
                        CASE WHEN voided_at IS NULL THEN '' ELSE 'ANULADA: ' || COALESCE(void_reason,'') END
                 FROM sales WHERE date(date) >= ?1 AND date(date) <= ?2 ORDER BY date ASC"
            )?;
            let rows = stmt.query_map(params![start_date, end_date], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?, r.get::<_, f64>(3)?, r.get::<_, f64>(4)?,
                    r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?,
                ))
            })?;
            for row in rows { sales_rows.push(row?); }
        }

        // Pagos de servicios del rango (join services)
        let mut payment_rows: Vec<(Option<String>, Option<String>, Option<String>, Option<String>, f64, Option<String>, Option<String>)> = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT sp.payment_date, s.order_num, s.client, s.model, sp.amount, sp.payment_method, sp.zelle_reference
                 FROM service_payments sp JOIN services s ON s.id = sp.service_id
                 WHERE date(sp.payment_date) >= ?1 AND date(sp.payment_date) <= ?2 ORDER BY sp.payment_date ASC"
            )?;
            let rows = stmt.query_map(params![start_date, end_date], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?,
                    r.get::<_, f64>(4)?, r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })?;
            for row in rows { payment_rows.push(row?); }
        }

        // Pago móvil del rango (query inline, mismo lock)
        let mut pm_rows: Vec<(Option<String>, f64, String, String)> = Vec::new();
        {
            let sql = "SELECT zelle_reference, total, 'Venta' as source, date FROM sales
                       WHERE (payment_method LIKE '%Móvil%' OR payment_method LIKE '%Movil%') AND date(date) >= ?1 AND date(date) <= ?2
                         AND voided_at IS NULL
                       UNION ALL
                       SELECT sp.zelle_reference, sp.amount, 'Abono ' || COALESCE(s.order_num, ''), sp.payment_date
                       FROM service_payments sp
                       JOIN services s ON s.id = sp.service_id
                       WHERE (sp.payment_method LIKE '%Móvil%' OR sp.payment_method LIKE '%Movil%') AND date(sp.payment_date) >= ?1 AND date(sp.payment_date) <= ?2
                       ORDER BY date";
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![start_date, end_date], |r| {
                Ok((
                    r.get::<_, Option<String>>(0).unwrap_or(None),
                    r.get::<_, f64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?;
            for row in rows { pm_rows.push(row?); }
        }

        // Días del rango: unión de fechas con movimientos + fechas con cierre
        let mut day_dates: Vec<String> = totals.iter().map(|t| t.date.clone()).collect();
        for c in &closings {
            if !day_dates.contains(&c.close_date) { day_dates.push(c.close_date.clone()); }
        }
        day_dates.sort();

        let mut csv = String::new();
        csv.push('\u{FEFF}');
        csv.push_str(&format!(
            "REPORTE LIBRO DIARIO;Desde;{};Hasta;{}\n",
            csv_field(start_date), csv_field(end_date)
        ));

        for day in &day_dates {
            let t = t_of(day);
            let closing = closings.iter().find(|c| c.close_date == *day);
            csv.push_str(&format!("\n===== {} =====\n", day));

            // VENTAS del día
            csv.push_str("VENTAS\n");
            csv.push_str("Fecha;Producto;Cant;Precio Unit;Total;Metodo;Referencia;Cliente;Estado\n");
            for (d, name, qty, unit, total, method, ref_, client, estado) in &sales_rows {
                if d.as_deref().map(|x| &x[..10]) != Some(day.as_str()) { continue; }
                csv.push_str(&format!(
                    "{};{};{};{};{};{};{};{};{}\n",
                    csv_field(d.as_deref().unwrap_or("")),
                    csv_field(name.as_deref().unwrap_or("")),
                    qty,
                    csv_field(&fmt_num(*unit)),
                    csv_field(&fmt_num(*total)),
                    csv_field(method.as_deref().unwrap_or("")),
                    csv_field(ref_.as_deref().unwrap_or("")),
                    csv_field(client.as_deref().unwrap_or("")),
                    csv_field(estado.as_deref().unwrap_or("")),
                ));
            }

            // PAGOS DE SERVICIOS del día
            csv.push_str("\nPAGOS DE SERVICIOS\n");
            csv.push_str("Fecha;Orden;Cliente;Equipo;Monto;Metodo;Referencia\n");
            for (d, order, client, model, amount, method, ref_) in &payment_rows {
                if d.as_deref().map(|x| &x[..10]) != Some(day.as_str()) { continue; }
                csv.push_str(&format!(
                    "{};{};{};{};{};{};{}\n",
                    csv_field(d.as_deref().unwrap_or("")),
                    csv_field(order.as_deref().unwrap_or("")),
                    csv_field(client.as_deref().unwrap_or("")),
                    csv_field(model.as_deref().unwrap_or("")),
                    csv_field(&fmt_num(*amount)),
                    csv_field(method.as_deref().unwrap_or("")),
                    csv_field(ref_.as_deref().unwrap_or("")),
                ));
            }

            // PAGO MÓVIL del día
            csv.push_str("\nPAGO MOVIL DEL DIA\n");
            csv.push_str("Referencia;Monto;Origen\n");
            for (ref_, amount, source, d) in &pm_rows {
                if d.len() >= 10 && &d[..10] != day.as_str() { continue; }
                csv.push_str(&format!(
                    "{};{};{}\n",
                    csv_field(ref_.as_deref().unwrap_or("")),
                    csv_field(&fmt_num(*amount)),
                    csv_field(source),
                ));
            }

            // TOTALES del día (sistema)
            csv.push_str("\nTOTALES DEL DIA\n");
            csv.push_str(&format!("Punto Cargado;{}\n", fmt_num(t.pos_charged)));
            csv.push_str(&format!("Comision;{}\n", fmt_num(t.pos_fees)));
            csv.push_str(&format!("Neto Punto;{}\n", fmt_num(t.pos_net)));
            csv.push_str(&format!("Efectivo USD;{}\n", fmt_num(t.cash_usd)));
            csv.push_str(&format!("Efectivo Bs;{}\n", fmt_num(t.cash_bs)));
            csv.push_str(&format!("Zelle;{}\n", fmt_num(t.zelle_total)));
            csv.push_str(&format!("Pago Movil;{}\n", fmt_num(t.pago_movil_total)));
            csv.push_str(&format!("Transf Bs;{}\n", fmt_num(t.transfer_bs_total)));
            csv.push_str(&format!("Total General USD;{}\n", fmt_num(t.grand_usd)));
            csv.push_str(&format!("Total General Bs;{}\n", fmt_num(t.grand_bs)));
            csv.push_str(&format!("Total General (USD equiv);{}\n", fmt_num(t.grand_total)));
            if t.tasa_bcv > 0.0 {
                csv.push_str(&format!("Tasa BCV;{}\n", fmt_num(t.tasa_bcv)));
            }

            // CIERRE del día (solo días cerrados — "venta cerrada completa")
            if let Some(c) = closing {
                if c.is_closed {
                    csv.push_str("\nCIERRE DEL DIA\n");
                    csv.push_str(&format!("Apertura (no es venta);{}\n", fmt_num(c.initial_cash_usd)));
                    csv.push_str(&format!("Monto impreso Punto USD;{}\n", fmt_num(c.pos_settled)));
                    csv.push_str(&format!("Monto impreso Punto Bs;{}\n", fmt_num(c.pos_settled_bs)));
                    csv.push_str(&format!("Arqueo Divisas USD;{}\n", fmt_num(c.actual_cash_usd)));
                    csv.push_str(&format!("Arqueo Efectivo Bs;{}\n", fmt_num(c.actual_cash_bs)));
                    csv.push_str(&format!("Arqueo Punto USD;{}\n", fmt_num(c.actual_punto_usd)));
                    csv.push_str(&format!("Arqueo Punto Bs;{}\n", fmt_num(c.actual_punto_bs)));
                    csv.push_str(&format!("Arqueo Zelle;{}\n", fmt_num(c.actual_zelle)));
                    csv.push_str(&format!("Arqueo Pago Movil;{}\n", fmt_num(c.actual_pago_movil)));
                    csv.push_str(&format!("Arqueo Transf Bs;{}\n", fmt_num(c.actual_transfer_bs)));
                    csv.push_str(&format!("Diferencia (USD equiv);{}\n", fmt_num(c.difference)));
                    if let Some(n) = &c.notes {
                        if !n.is_empty() {
                            csv.push_str(&format!("Notas;{}\n", csv_field(n)));
                        }
                    }
                }
            }
        }

        let mut dir = std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        dir.push("Documents");
        dir.push("Registro");
        std::fs::create_dir_all(&dir).map_err(|e| day_shift_error(&format!("No se pudo crear el directorio: {}", e)))?;
        let path = dir.join(format!("reporte_{}_{}.csv", start_date, end_date));
        std::fs::write(&path, csv.as_bytes()).map_err(|e| day_shift_error(&format!("No se pudo escribir el archivo: {}", e)))?;

        let path_str = path.to_string_lossy().to_string();
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .spawn();
        Ok(path_str)
    }

    /// Exporta el Libro Diario como Excel profesional (.xlsx) vía Python + openpyxl
    /// (patrón curl.exe: proceso externo, sin deps Rust). Genera un JSON con TODOS los
    /// datos del rango (ventas con cédula, pagos/abonos, servicios, movimientos de
    /// inventario, totales por día y cierres) y llama a `export_libro_diario.py`.
    /// Si Python/openpyxl no está disponible → fallback al CSV (export_daily_report).
    /// Devuelve JSON {ok, format, path, note} para que la UI muestre el formato real.
    pub fn export_daily_report_xlsx(&self, start_date: &str, end_date: &str) -> SqlResult<String> {
        // Totales y cierres ANTES de tomar el lock (ambos lo toman → mutex no reentrante)
        let totals = self.get_daily_totals(start_date, end_date)?;
        let all_closings = self.get_daily_closings()?;
        let closings: Vec<&DailyClosing> = all_closings.iter()
            .filter(|c| c.close_date.as_str() >= start_date && c.close_date.as_str() <= end_date)
            .collect();
        let zero = DailyTotals {
            date: String::new(), pos_charged: 0.0, pos_fees: 0.0, pos_net: 0.0,
            pos_charged_usd: 0.0, pos_charged_bs: 0.0, pos_net_usd: 0.0, pos_net_bs: 0.0,
            cash_usd: 0.0, cash_bs: 0.0, zelle_total: 0.0,
            pago_movil_total: 0.0, transfer_bs_total: 0.0,
            usd_cash_total: 0.0, grand_total: 0.0,
            grand_usd: 0.0, grand_bs: 0.0, tasa_bcv: 0.0,
            refund_usd: 0.0, refund_bs: 0.0,
        };
        let t_of = |d: &str| totals.iter().find(|x| x.date == d).unwrap_or(&zero);

        let sales_rows;
        let payment_rows;
        let pm_rows;
        let service_rows;
        let movement_rows;
        let expense_rows;
        let mut day_dates;
        {
            let conn = self.conn.lock().unwrap();

            // Ventas del rango (con cédula del cliente)
            sales_rows = {
                let mut stmt = conn.prepare(
                    // F70: una venta anulada se exporta MARCADA (no se esconde ni se cuenta como buena)
                    "SELECT s.date, CASE WHEN s.voided_at IS NULL THEN s.product_name
                                         ELSE '(ANULADA) ' || COALESCE(s.product_name,'') END,
                            s.quantity, s.unit_price, s.total, s.payment_method,
                            s.zelle_reference, s.client_name, s.currency, COALESCE(c.ci, ''), COALESCE(s.iva_rate, 0)
                     FROM sales s LEFT JOIN clients c ON c.id = s.client_id
                     WHERE date(s.date) >= ?1 AND date(s.date) <= ?2 ORDER BY s.date ASC"
                )?;
                let rows = stmt.query_map(params![start_date, end_date], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                        r.get::<_, i64>(2)?, r.get::<_, f64>(3)?, r.get::<_, f64>(4)?,
                        r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?,
                        r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?,
                        r.get::<_, Option<String>>(9)?, r.get::<_, f64>(10).unwrap_or(0.0),
                    ))
                })?;
                let mut v = Vec::new();
                for row in rows { v.push(row?); }
                v
            };

            // Pagos/abonos de servicios del rango (con cédula del cliente)
            payment_rows = {
                let mut stmt = conn.prepare(
                    "SELECT sp.payment_date, s.order_num, s.client, s.model, sp.amount, sp.payment_method,
                            sp.zelle_reference, sp.currency, sp.notes, COALESCE(s.client_ci, '')
                     FROM service_payments sp JOIN services s ON s.id = sp.service_id
                     WHERE date(sp.payment_date) >= ?1 AND date(sp.payment_date) <= ?2 ORDER BY sp.payment_date ASC"
                )?;
                let rows = stmt.query_map(params![start_date, end_date], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?,
                        r.get::<_, f64>(4)?, r.get::<_, Option<String>>(5)?,
                        r.get::<_, Option<String>>(6)?, r.get::<_, Option<String>>(7)?,
                        r.get::<_, Option<String>>(8)?, r.get::<_, Option<String>>(9)?,
                    ))
                })?;
                let mut v = Vec::new();
                for row in rows { v.push(row?); }
                v
            };

            // Pago móvil del rango (query inline, mismo lock)
            pm_rows = {
                let sql = "SELECT zelle_reference, total, 'Venta' as source, date FROM sales
                           WHERE (payment_method LIKE '%Móvil%' OR payment_method LIKE '%Movil%') AND date(date) >= ?1 AND date(date) <= ?2
                             AND voided_at IS NULL
                           UNION ALL
                           SELECT sp.zelle_reference, sp.amount, 'Abono ' || COALESCE(s.order_num, ''), sp.payment_date
                           FROM service_payments sp
                           JOIN services s ON s.id = sp.service_id
                           WHERE (sp.payment_method LIKE '%Móvil%' OR sp.payment_method LIKE '%Movil%') AND date(sp.payment_date) >= ?1 AND date(sp.payment_date) <= ?2
                           ORDER BY date";
                let mut stmt = conn.prepare(sql)?;
                let rows = stmt.query_map(params![start_date, end_date], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0).unwrap_or(None),
                        r.get::<_, f64>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?;
                let mut v = Vec::new();
                for row in rows { v.push(row?); }
                v
            };

            // Servicios recibidos en el rango (para la hoja "Servicios" del Excel)
            service_rows = {
                let mut stmt = conn.prepare(
                    "SELECT s.date_in, s.order_num, s.client, COALESCE(s.client_ci, ''), s.model,
                            COALESCE(s.service_types, s.service_type), COALESCE(s.technician, ''),
                            s.amount, s.paid_amount, s.status, COALESCE(s.date_out, ''), COALESCE(p.name, ''), COALESCE(s.iva_rate, 0)
                     FROM services s LEFT JOIN products p ON p.id = s.screen_product_id
                     WHERE date(s.date_in) >= ?1 AND date(s.date_in) <= ?2 ORDER BY s.date_in ASC"
                )?;
                let rows = stmt.query_map(params![start_date, end_date], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?,
                        r.get::<_, Option<String>>(6)?, r.get::<_, f64>(7)?,
                        r.get::<_, f64>(8)?, r.get::<_, Option<String>>(9)?,
                        r.get::<_, Option<String>>(10)?, r.get::<_, Option<String>>(11)?,
                        r.get::<_, f64>(12).unwrap_or(0.0),
                    ))
                })?;
                let mut v = Vec::new();
                for row in rows { v.push(row?); }
                v
            };

            // Movimientos de inventario del rango
            movement_rows = {
                let mut stmt = conn.prepare(
                    "SELECT im.date, COALESCE(p.name, ''), im.type, im.quantity, COALESCE(im.reason, ''), COALESCE(im.reference, '')
                     FROM inventory_movements im LEFT JOIN products p ON p.id = im.product_id
                     WHERE date(im.date) >= ?1 AND date(im.date) <= ?2 ORDER BY im.date ASC"
                )?;
                let rows = stmt.query_map(params![start_date, end_date], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?, r.get::<_, i64>(3)?,
                        r.get::<_, String>(4)?, r.get::<_, String>(5)?,
                    ))
                })?;
                let mut v = Vec::new();
                for row in rows { v.push(row?); }
                v
            };

            // Gastos del negocio del rango
            expense_rows = {
                let mut stmt = conn.prepare(
                    "SELECT e.expense_date, e.category, e.amount, e.currency, COALESCE(e.notes, '')
                     FROM expenses e
                     WHERE date(e.expense_date) >= ?1 AND date(e.expense_date) <= ?2 ORDER BY e.expense_date ASC"
                )?;
                let rows = stmt.query_map(params![start_date, end_date], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?,
                        r.get::<_, f64>(2)?, r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                })?;
                let mut v = Vec::new();
                for row in rows { v.push(row?); }
                v
            };

            // Días del rango: unión de fechas con movimientos + fechas con cierre
            day_dates = totals.iter().map(|t| t.date.clone()).collect::<Vec<String>>();
            for c in &closings {
                if !day_dates.contains(&c.close_date) { day_dates.push(c.close_date.clone()); }
            }
            day_dates.sort();
        } // ← se suelta el lock ANTES de escribir archivos / fallback (mutex no reentrante)

        let mut days = Vec::new();
        for day in &day_dates {
            let t = t_of(day);
            let closing = closings.iter().find(|c| c.close_date == *day);
            let sales_day: Vec<_> = sales_rows.iter()
                .filter(|r| r.0.as_deref().map(|x| &x[..10]) == Some(day.as_str()))
                .collect();
            let payments_day: Vec<_> = payment_rows.iter()
                .filter(|r| r.0.as_deref().map(|x| &x[..10]) == Some(day.as_str()))
                .collect();
            let pm_day: Vec<_> = pm_rows.iter()
                .filter(|r| r.3.len() >= 10 && &r.3[..10] == day.as_str())
                .collect();
            days.push(serde_json::json!({
                "date": day,
                "sales": sales_day.iter().map(|r| serde_json::json!({
                    "date": r.0.clone().unwrap_or_default(), "client": r.7.clone().unwrap_or_default(),
                    "ci": r.9.clone().unwrap_or_default(), "product": r.1.clone().unwrap_or_default(),
                    "qty": r.2, "unit": r.3, "total": r.4,
                    "method": r.5.clone().unwrap_or_default(), "ref": r.6.clone().unwrap_or_default(),
                    "currency": r.8.clone().unwrap_or_default(), "iva_rate": r.10,
                })).collect::<Vec<_>>(),
                "payments": payments_day.iter().map(|r| serde_json::json!({
                    "date": r.0.clone().unwrap_or_default(), "order": r.1.clone().unwrap_or_default(),
                    "client": r.2.clone().unwrap_or_default(), "model": r.3.clone().unwrap_or_default(),
                    "amount": r.4, "method": r.5.clone().unwrap_or_default(),
                    "ref": r.6.clone().unwrap_or_default(), "currency": r.7.clone().unwrap_or_default(),
                    "notes": r.8.clone().unwrap_or_default(), "ci": r.9.clone().unwrap_or_default(),
                })).collect::<Vec<_>>(),
                "pago_movil": pm_day.iter().map(|r| serde_json::json!({
                    "ref": r.0.clone().unwrap_or_default(), "amount": r.1, "source": r.2.clone(),
                })).collect::<Vec<_>>(),
                "totals": serde_json::json!({
                    "pos_charged": t.pos_charged, "pos_fees": t.pos_fees, "pos_net": t.pos_net,
                    "pos_charged_usd": t.pos_charged_usd, "pos_charged_bs": t.pos_charged_bs,
                    "pos_net_usd": t.pos_net_usd, "pos_net_bs": t.pos_net_bs,
                    "cash_usd": t.cash_usd, "cash_bs": t.cash_bs, "zelle_total": t.zelle_total,
                    "pago_movil_total": t.pago_movil_total, "transfer_bs_total": t.transfer_bs_total,
                    "usd_cash_total": t.usd_cash_total,
                    "grand_usd": t.grand_usd, "grand_bs": t.grand_bs, "grand_total": t.grand_total,
                    "tasa_bcv": t.tasa_bcv,
                }),
                "closing": closing.filter(|c| c.is_closed).map(|c| serde_json::json!({
                    "initial_cash_usd": c.initial_cash_usd, "pos_settled": c.pos_settled,
                    "pos_settled_bs": c.pos_settled_bs, "actual_cash_usd": c.actual_cash_usd,
                    "actual_cash_bs": c.actual_cash_bs, "actual_punto_usd": c.actual_punto_usd,
                    "actual_punto_bs": c.actual_punto_bs, "actual_zelle": c.actual_zelle,
                    "actual_pago_movil": c.actual_pago_movil, "actual_transfer_bs": c.actual_transfer_bs,
                    "difference": c.difference, "notes": c.notes.clone().unwrap_or_default(),
                    "closed_at": c.closed_at.clone().unwrap_or_default(),
                })).unwrap_or(serde_json::Value::Null),
            }));
        }

        let services = service_rows.iter().map(|r| serde_json::json!({
            "date_in": r.0.clone().unwrap_or_default(), "order": r.1.clone().unwrap_or_default(),
            "client": r.2.clone().unwrap_or_default(), "ci": r.3.clone().unwrap_or_default(),
            "model": r.4.clone().unwrap_or_default(), "types": r.5.clone().unwrap_or_default(),
            "technician": r.6.clone().unwrap_or_default(), "amount": r.7, "paid": r.8,
            "status": r.9.clone().unwrap_or_default(), "date_out": r.10.clone().unwrap_or_default(),
            "screen": r.11.clone().unwrap_or_default(),
            // F75: la alícuota del IVA con la que se cargó la orden (0 = sin IVA). El Excel la usa para
            // desglosar base/IVA por fila sin recalcular con la alícuota de hoy.
            "iva_rate": r.12,
        })).collect::<Vec<_>>();

        let movements = movement_rows.iter().map(|r| serde_json::json!({
            "date": r.0.clone().unwrap_or_default(), "product": r.1.clone(),
            "type": r.2.clone(), "qty": r.3, "reason": r.4.clone(), "ref": r.5.clone(),
        })).collect::<Vec<_>>();

        let expenses = expense_rows.iter().map(|r| serde_json::json!({
            "date": r.0.clone().unwrap_or_default(), "category": r.1.clone(),
            "amount": r.2, "currency": r.3.clone(), "notes": r.4.clone(),
        })).collect::<Vec<_>>();

        let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        // F75: el nombre del negocio (el que ya se imprime en el recibo) para el encabezado del Excel.
        let negocio = self.get_printer_settings().map(|p| p.business_name).unwrap_or_default();
        let linea = self.get_printer_settings().map(|p| p.business_line).unwrap_or_default();
        let data = serde_json::json!({
            "start": start_date, "end": end_date, "generado": now,
            "negocio": negocio, "linea": linea,
            "days": days, "services": services, "movements": movements, "expenses": expenses,
        });

        let mut dir = std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        dir.push("Documents");
        dir.push("Registro");
        std::fs::create_dir_all(&dir).map_err(|e| day_shift_error(&format!("No se pudo crear el directorio: {}", e)))?;
        let json_path = dir.join(format!("libro_diario_{}_{}.json", start_date, end_date));
        let out_path = dir.join(format!("reporte_{}_{}.xlsx", start_date, end_date));
        std::fs::write(&json_path, data.to_string()).map_err(|e| day_shift_error(&format!("No se pudo escribir el JSON: {}", e)))?;

        let script = self.find_export_script();
        let run = match script {
            Some(s) => run_python_export(&s, &json_path, &out_path),
            None => Err("script export_libro_diario.py no encontrado".to_string()),
        };
        match run {
            Ok(()) => {
                let path_str = out_path.to_string_lossy().to_string();
                let _ = std::process::Command::new("cmd")
                    .args(["/C", "start", "", &path_str])
                    .spawn();
                Ok(serde_json::json!({"ok": true, "format": "xlsx", "path": path_str, "note": ""}).to_string())
            }
            Err(e) => {
                // Fallback: CSV clásico (escribe + abre el archivo)
                let csv = self.export_daily_report(start_date, end_date)?;
                Ok(serde_json::json!({
                    "ok": true, "format": "csv", "path": csv,
                    "note": format!("Python/openpyxl no disponible ({}). Se generó el CSV como respaldo.", e),
                }).to_string())
            }
        }
    }

    fn find_export_script(&self) -> Option<PathBuf> {
        // 1) junto al exe (instalado: recurso Tauri; dev: proyecto raíz)
        if let Ok(exe) = std::env::current_exe() {
            let p = exe.parent()?.join("export_libro_diario.py");
            if p.exists() { return Some(p); }
        }
        // 2) tools/ del proyecto (modo dev con cargo run)
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("tools").join("export_libro_diario.py");
        if dev.exists() { return Some(dev); }
        None
    }

    pub fn get_daily_closings(&self) -> SqlResult<Vec<DailyClosing>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT id, close_date, pos_charged, pos_fees, pos_net, pos_settled, cash_usd, cash_bs, zelle_total, pago_movil_total, transfer_bs_total, usd_cash_total, grand_total, is_closed, closed_at, notes, tasa_bcv, tasa_eur, opened_at, initial_cash_usd, actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs, actual_zelle, actual_pago_movil, actual_transfer_bs, difference, total_usd, total_bs, pos_settled_bs, drawer_adjust_usd, drawer_adjust_bs FROM daily_closings ORDER BY close_date DESC";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| {
            Ok(DailyClosing {
                id: r.get(0)?, close_date: r.get(1)?,
                pos_charged: r.get(2)?, pos_fees: r.get(3)?,
                pos_net: r.get(4)?, pos_settled: r.get(5)?,
                cash_usd: r.get(6)?, cash_bs: r.get(7)?,
                zelle_total: r.get(8)?, pago_movil_total: r.get(9)?,
                transfer_bs_total: r.get(10)?, usd_cash_total: r.get(11)?,
                grand_total: r.get(12)?,
                is_closed: r.get::<_, i64>(13)? != 0,
                closed_at: r.get(14)?, notes: r.get(15)?,
                tasa_bcv: r.get::<_, Option<f64>>(16)?.unwrap_or(0.0),
                tasa_eur: r.get::<_, Option<f64>>(17)?.unwrap_or(0.0),
                opened_at: r.get(18)?,
                initial_cash_usd: r.get::<_, Option<f64>>(19)?.unwrap_or(0.0),
                actual_cash_usd: r.get::<_, Option<f64>>(20)?.unwrap_or(0.0),
                actual_cash_bs: r.get::<_, Option<f64>>(21)?.unwrap_or(0.0),
                actual_punto_usd: r.get::<_, Option<f64>>(22)?.unwrap_or(0.0),
                actual_punto_bs: r.get::<_, Option<f64>>(23)?.unwrap_or(0.0),
                actual_zelle: r.get::<_, Option<f64>>(24)?.unwrap_or(0.0),
                actual_pago_movil: r.get::<_, Option<f64>>(25)?.unwrap_or(0.0),
                actual_transfer_bs: r.get::<_, Option<f64>>(26)?.unwrap_or(0.0),
                difference: r.get::<_, Option<f64>>(27)?.unwrap_or(0.0),
                total_usd: r.get::<_, Option<f64>>(28)?.unwrap_or(0.0),
                total_bs: r.get::<_, Option<f64>>(29)?.unwrap_or(0.0),
                pos_settled_bs: r.get::<_, Option<f64>>(30)?.unwrap_or(0.0),
                drawer_adjust_usd: r.get::<_, Option<f64>>(31)?.unwrap_or(0.0),
                drawer_adjust_bs: r.get::<_, Option<f64>>(32)?.unwrap_or(0.0),
            })
        })?;
        let mut closings = Vec::new();
        for row in rows { closings.push(row?); }
        Ok(closings)
    }

    pub fn get_active_day(&self) -> SqlResult<Option<DailyClosing>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT id, close_date, pos_charged, pos_fees, pos_net, pos_settled, cash_usd, cash_bs, zelle_total, pago_movil_total, transfer_bs_total, usd_cash_total, grand_total, is_closed, closed_at, notes, tasa_bcv, tasa_eur, opened_at, initial_cash_usd, actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs, actual_zelle, actual_pago_movil, actual_transfer_bs, difference, total_usd, total_bs, pos_settled_bs, drawer_adjust_usd, drawer_adjust_bs FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1";
        let mut stmt = conn.prepare(sql)?;
        let mut rows = stmt.query_map([], |r| {
            Ok(DailyClosing {
                id: r.get(0)?, close_date: r.get(1)?,
                pos_charged: r.get(2)?, pos_fees: r.get(3)?,
                pos_net: r.get(4)?, pos_settled: r.get(5)?,
                cash_usd: r.get(6)?, cash_bs: r.get(7)?,
                zelle_total: r.get(8)?, pago_movil_total: r.get(9)?,
                transfer_bs_total: r.get(10)?, usd_cash_total: r.get(11)?,
                grand_total: r.get(12)?,
                is_closed: r.get::<_, i64>(13)? != 0,
                closed_at: r.get(14)?, notes: r.get(15)?,
                tasa_bcv: r.get::<_, Option<f64>>(16)?.unwrap_or(0.0),
                tasa_eur: r.get::<_, Option<f64>>(17)?.unwrap_or(0.0),
                opened_at: r.get(18)?,
                initial_cash_usd: r.get::<_, Option<f64>>(19)?.unwrap_or(0.0),
                actual_cash_usd: r.get::<_, Option<f64>>(20)?.unwrap_or(0.0),
                actual_cash_bs: r.get::<_, Option<f64>>(21)?.unwrap_or(0.0),
                actual_punto_usd: r.get::<_, Option<f64>>(22)?.unwrap_or(0.0),
                actual_punto_bs: r.get::<_, Option<f64>>(23)?.unwrap_or(0.0),
                actual_zelle: r.get::<_, Option<f64>>(24)?.unwrap_or(0.0),
                actual_pago_movil: r.get::<_, Option<f64>>(25)?.unwrap_or(0.0),
                actual_transfer_bs: r.get::<_, Option<f64>>(26)?.unwrap_or(0.0),
                difference: r.get::<_, Option<f64>>(27)?.unwrap_or(0.0),
                total_usd: r.get::<_, Option<f64>>(28)?.unwrap_or(0.0),
                total_bs: r.get::<_, Option<f64>>(29)?.unwrap_or(0.0),
                pos_settled_bs: r.get::<_, Option<f64>>(30)?.unwrap_or(0.0),
                drawer_adjust_usd: r.get::<_, Option<f64>>(31)?.unwrap_or(0.0),
                drawer_adjust_bs: r.get::<_, Option<f64>>(32)?.unwrap_or(0.0),
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn open_day(&self, initial_cash_usd: f64, tasa_bcv: f64, tasa_eur: f64) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // F69 (revisión adversarial, BLOQUEANTE) — ABRIR EL DÍA NO PUEDE REABRIR UN DÍA YA CERRADO.
        // Antes, si el día de HOY ya estaba cerrado, el `INSERT ... ON CONFLICT DO UPDATE SET
        // is_closed=0` lo volvía a abrir con el fondo y la tasa que mandara quien llamara (y borraba
        // y re-anotaba la apertura del libro): `require_open_day` volvía a pasar, así que se podían
        // anotar ventas y abonos en un día cuyo arqueo ya estaba firmado — y un cierre guardado no se
        // recalcula. La UI además le daba el botón «Abrir Día» a los dos roles.
        // Reabrir un día es del DUEÑO y tiene su camino explícito: Libro Diario → Cierres → ↺.
        let hoy_cerrado: Option<i64> = conn
            .query_row(
                "SELECT id FROM daily_closings WHERE close_date=?1 AND is_closed=1",
                params![today], |r| r.get(0),
            )
            .optional()?;
        if hoy_cerrado.is_some() {
            return Err(day_shift_error(&format!(
                "El día de hoy ({today}) ya está CERRADO con su arqueo. Si hay que anotar algo de ese día, \
                 el dueño lo reabre desde Libro Diario → Cierres (botón ↺), se anota y se vuelve a cerrar."
            )));
        }
        let open_date: Option<String> = conn.query_row(
            "SELECT close_date FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1",
            [], |r| r.get(0),
        ).optional()?;
        if let Some(d) = open_date {
            if d != today {
                return Err(day_shift_error(&format!("Ya hay un día abierto ({}) — ciérralo antes de abrir uno nuevo.", d)));
            }
            // Día de HOY ya abierto: actualiza tasa/apertura sin cerrar (corregir a mitad de día,
            // ej. se abrió sin tasa BCV y ahora hay internet). Conserva la fila y su id.
            conn.execute(
                "UPDATE daily_closings SET initial_cash_usd=?1, tasa_bcv=?2, tasa_eur=?3, opened_at=datetime('now','localtime') WHERE close_date=?4 AND is_closed=0",
                params![initial_cash_usd, tasa_bcv, tasa_eur, today],
            )?;
            let id: i64 = conn.query_row("SELECT id FROM daily_closings WHERE close_date=?1 AND is_closed=0", params![today], |r| r.get(0))?;
            // F68/F40 → F69: la apertura (fondo de caja) queda en el libro con su autor, y entra en el
            // ESPERADO del cajón al cerrar. Se REEMPLAZA la del día (no se acumula): «Actualizar día»
            // vuelve a llamar `open_day`, y antes cada llamada dejaba otra apertura (el fondo quedaba
            // dos veces y un fantasma viejo si se corregía a 0) — hallazgo MAYOR de la revisión.
            conn.execute("DELETE FROM cash_movements WHERE day=?1 AND type='apertura'", params![today])?;
            self.book_movement(&conn, &NewCashMovement {
                r#type: "apertura",
                method: "Divisas (USD Cash)",
                currency: "USD",
                amount: initial_cash_usd,
                sign: 1,
                reference: &today,
                sale_id: None,
                service_id: None,
                payment_id: None,
                expense_id: None,
                note: "Apertura del día (fondo de caja)",
                when: Some(&today),
            })?;
            return Ok(id);
        }
        // (El día de hoy ya cerrado se rechazó arriba: acá sólo se llega con un día nuevo o sin turno.)
        conn.execute(
            "INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, tasa_eur, opened_at, is_closed)
             VALUES (?1,?2,?3,?4,datetime('now','localtime'),0)
             ON CONFLICT(close_date) DO UPDATE SET
                initial_cash_usd=excluded.initial_cash_usd, tasa_bcv=excluded.tasa_bcv,
                tasa_eur=excluded.tasa_eur, opened_at=excluded.opened_at, is_closed=0",
            params![today, initial_cash_usd, tasa_bcv, tasa_eur],
        )?;
        let id: i64 = conn.query_row("SELECT id FROM daily_closings WHERE close_date=?1", params![today], |r| r.get(0))?;
        // F69: una sola apertura por día (ver arriba: «Actualizar día» reemplaza, no acumula).
        conn.execute("DELETE FROM cash_movements WHERE day=?1 AND type='apertura'", params![today])?;
        self.book_movement(&conn, &NewCashMovement {
            r#type: "apertura",
            method: "Divisas (USD Cash)",
            currency: "USD",
            amount: initial_cash_usd,
            sign: 1,
            reference: &today,
            sale_id: None,
            service_id: None,
            payment_id: None,
            expense_id: None,
            note: "Apertura del día (fondo de caja)",
                when: Some(&today),
        })?;
        Ok(id)
    }

    fn require_open_day(&self, conn: &rusqlite::Connection) -> SqlResult<()> {
        let day_open: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM daily_closings WHERE is_closed=0)",
            [], |r| r.get(0),
        )?;
        if !day_open {
            return Err(day_shift_error("Debe abrir el día (Libro Diario) antes de registrar ventas o servicios."));
        }
        Ok(())
    }

    /// F35 — ¿hay tasa BCV > 0 para el DÍA de un pago? (cierre de ese día con tasa, o el turno
    /// abierto de ese día). Un pago en Bs fechado en un día sin tasa se convertiría a 1:1 y
    /// corrompería `paid_amount`, así que se rechaza igual que hoy.
    /// (F36: la devolución ya NO usa un gate «¿hoy tiene tasa?»: se compara por moneda y valúa el
    /// neto con `ves_rate_for_net`, así que devolver todo lo cobrado en Bs funciona aunque hoy no
    /// haya tasa.)
    fn has_bcv_rate_for_date(&self, conn: &rusqlite::Connection, date: &str) -> SqlResult<bool> {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM daily_closings WHERE close_date = ?1 AND tasa_bcv > 0)",
            params![date], |r| r.get(0),
        )?;
        Ok(ok)
    }

    /// Fecha de HOY en hora local (helper de las señales de pago: nunca UTC).
    fn today_local(&self, conn: &rusqlite::Connection) -> SqlResult<String> {
        conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))
    }

    /// F35 — FECHA DE UN PAGO (la clave para que la caja cuadre).
    ///
    /// Por qué existe: un cliente deja el teléfono y paga el mismo día, pero avisa después (o el
    /// operario se olvidó de anotarlo). Si el abono se guarda con la fecha del día en que se TIPEA,
    /// la caja del día del cobro cierra con FALTA y la del día del tipeo con SOBRA.
    ///
    /// Reglas (fail-closed):
    ///   · vacío → HOY (local), el comportamiento histórico;
    ///   · no puede ser FUTURA (no se anota plata que todavía no entró);
    ///   · el día tiene que tener un turno (`daily_closings`) **ABIERTO**. Si está cerrado, el error
    ///     dice el camino real (abrir ese día, anotar el pago y volver a cerrarlo) en vez de dejar un
    ///     arqueo guardado que miente: el cierre de ese día ya se calculó y no se recalcula solo.
    ///
    /// Devuelve la fecha normalizada `YYYY-MM-DD`.
    fn payment_date_ok(&self, conn: &rusqlite::Connection, date: &str) -> SqlResult<String> {
        let date = date.trim();
        let hoy: String = conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))?;
        if date.is_empty() {
            return Ok(hoy);
        }
        // Formato: exactamente YYYY-MM-DD (el input date del navegador lo manda así).
        if date.len() != 10 || !date.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }) {
            return Err(day_shift_error("Fecha del pago inválida: usá el formato AAAA-MM-DD."));
        }
        // Calendario REAL: `2026-02-31` tiene la forma correcta pero no existe, y sin esto el error
        // que salía era «no hay un turno con esa fecha» (engañoso: parecía un problema de caja).
        let existe: Option<String> = conn.query_row("SELECT date(?1)", params![date], |r| r.get(0)).optional()?;
        if existe.as_deref() != Some(date) {
            return Err(day_shift_error(&format!("La fecha {} no existe en el calendario.", date)));
        }
        if date > hoy.as_str() {
            return Err(day_shift_error("La fecha del pago no puede ser futura: el dinero todavía no entró a la caja."));
        }
        let abierto: Option<i64> = conn.query_row(
            "SELECT is_closed FROM daily_closings WHERE close_date = ?1 ORDER BY id DESC LIMIT 1",
            params![date], |r| r.get(0),
        ).optional()?;
        match abierto {
            None => {
                // El turno abierto (el único que puede recibir plata) se nombra en el error: el
                // operario tiene que ver A QUÉ caja puede anotar el pago.
                let turno: Option<String> = conn.query_row(
                    "SELECT close_date FROM daily_closings WHERE is_closed = 0 ORDER BY close_date DESC LIMIT 1",
                    [], |r| r.get(0),
                ).optional()?;
                let pista = match turno {
                    Some(t) => format!(" El turno abierto es el {}.", t),
                    None => " No hay ningún turno abierto: abrí el día en Libro Diario.".to_string(),
                };
                Err(day_shift_error(&format!("No hay un turno de caja con la fecha {}.{}", date, pista)))
            }
            Some(1) => Err(day_shift_error(&format!(
                "El día {} ya está CERRADO: su cierre ya se calculó y no cambia solo. En Libro Diario → pestaña Cierres, pulsá el botón ↺ de ese día para abrirlo, anotá el pago con esa fecha y volvé a cerrarlo — así la caja de ese día cuadra.", date))),
            _ => Ok(date.to_string()),
        }
    }

    /// F35 — ¿se puede MOVER un pago desde/ hacia esos días? El día de origen también tiene que
    /// estar abierto: sacar un pago de un día ya cerrado dejaría ese arqueo mintiendo igual.
    fn payment_date_movable(&self, conn: &rusqlite::Connection, desde: &str, hacia: &str) -> SqlResult<()> {
        if desde == hacia { return Ok(()); }
        let cerrado: Option<i64> = conn.query_row(
            "SELECT is_closed FROM daily_closings WHERE close_date = ?1 ORDER BY id DESC LIMIT 1",
            params![desde], |r| r.get(0),
        ).optional()?;
        if cerrado == Some(1) {
            return Err(day_shift_error(&format!(
                "El día {} (donde está anotado el pago) ya está CERRADO: abrilo con ↺ en Libro Diario → Cierres, mové el pago y volvé a cerrarlo.", desde)));
        }
        Ok(())
    }

    pub fn close_day(&self, close_date: &str, notes: &str, initial_cash_usd: f64, tasa_bcv: f64, tasa_eur: f64,
                     actual_cash_usd: f64, actual_cash_bs: f64, actual_punto_usd: f64, actual_punto_bs: f64,
                     actual_zelle: f64, actual_pago_movil: f64, actual_transfer_bs: f64,
                     pos_settled: f64, pos_settled_bs: f64) -> SqlResult<i64> {
        // Calculate totals for this date from sales + services (sin lock: get_daily_totals lo toma)
        let totals = self.get_daily_totals(close_date, close_date)?;
        let t = if totals.is_empty() {
            DailyTotals {
                date: close_date.to_string(), pos_charged: 0.0, pos_fees: 0.0, pos_net: 0.0,
                pos_charged_usd: 0.0, pos_charged_bs: 0.0, pos_net_usd: 0.0, pos_net_bs: 0.0,
                cash_usd: 0.0, cash_bs: 0.0, zelle_total: 0.0,
                pago_movil_total: 0.0, transfer_bs_total: 0.0,
                usd_cash_total: 0.0, grand_total: 0.0,
                grand_usd: 0.0, grand_bs: 0.0, tasa_bcv: 0.0,
                refund_usd: 0.0, refund_bs: 0.0,
            }
        } else { totals[0].clone() };
        let conn = self.conn.lock().unwrap();

        // Expected vs actual difference per currency group
        // USD group: cash_usd + zelle + usd_cash vs actual_cash_usd + actual_zelle
        // Bs group: cash_bs + pago_movil + transfer_bs vs actual_cash_bs + actual_pago_movil + actual_transfer_bs
        //
        // F69 — EL CAJÓN CUENTA LA PLATA REAL: al esperado del efectivo se le SUMA el fondo de caja
        // declarado al abrir y se le RESTAN los **gastos pagados del cajón** (leídos del libro de
        // plata). Antes nada de eso entraba: pagar un gasto del cajón hacía que la caja «faltara» en un
        // día perfecto y el fondo la hacía «sobrar» todos los días. Los métodos digitales (Zelle, Pago
        // Móvil, Transferencia) NO se tocan: se concilian por banco.
        //
        // OJO con las DEVOLUCIONES (bug que cazó `test_refund_ledger_full`): NO se restan acá. Una
        // devolución se guarda como un `service_payments` NEGATIVO con el método por el que salió la
        // plata, así que `t.cash_usd`/`t.cash_bs` YA vienen netos — restarla otra vez descontaba la
        // misma plata dos veces (una orden de $50 devuelta entera daba un «faltante» de $50 con el
        // cajón cuadrado). `adj.devoluciones_*` queda para MOSTRAR cuánto se devolvió del cajón.
        let adj = self.drawer_adjustments_conn(&conn, close_date)?;
        // F69 (revisión adversarial) — EL FONDO DE CAJA ES EL DE LA FILA DEL DÍA, no el parámetro.
        // `initial_cash_usd` se declara al ABRIR (`open_day`/«Actualizar día»); `close_day` calculaba
        // el esperado con el guardado pero PERSISTÍA el del parámetro: un llamador que mandara 0
        // dejaba el cierre con `initial_cash_usd=0` y un `drawer_adjust_usd` que decía +30 — al
        // reabrirlo (↺, el camino del remedio) el fondo desaparecía y el recierre mostraba «sobran
        // $50». Ahora el fondo tiene UNA fuente (la fila del turno) y se guarda el mismo que se usó.
        let fondo_usd = adj.fondo_usd;
        let cash_usd_esperado = t.cash_usd + t.usd_cash_total + fondo_usd - adj.gastos_usd;
        let cash_bs_esperado = t.cash_bs - adj.gastos_bs;
        let expected_usd = cash_usd_esperado + t.zelle_total;
        let actual_usd = actual_cash_usd + actual_zelle;
        let expected_bs = cash_bs_esperado + t.pago_movil_total + t.transfer_bs_total;
        let actual_bs = actual_cash_bs + actual_pago_movil + actual_transfer_bs;
        let diff_usd = actual_usd - expected_usd;
        let diff_bs = actual_bs - expected_bs;
        // Tasa del cierre: si viene 0 (día abierto sin tasa), heredar la del último cierre con tasa
        let effective_tasa = if tasa_bcv > 0.0 {
            tasa_bcv
        } else {
            conn.query_row(
                "SELECT tasa_bcv FROM daily_closings WHERE tasa_bcv > 0 ORDER BY close_date DESC LIMIT 1",
                [], |r| r.get(0),
            ).optional()?.unwrap_or(0.0)
        };
        let difference = if effective_tasa > 0.0 { diff_usd + diff_bs / effective_tasa } else { diff_usd };
        // Total General en USD equivalente: USD + Bs convertidos con la tasa del cierre (nunca sumar Bs como USD)
        let grand_total = t.grand_usd + if effective_tasa > 0.0 { t.grand_bs / effective_tasa } else { 0.0 };

        let changes = conn.execute(
            "UPDATE daily_closings SET pos_charged=?2, pos_fees=?3, pos_net=?4, cash_usd=?5, cash_bs=?6, zelle_total=?7, pago_movil_total=?8, transfer_bs_total=?9, usd_cash_total=?10, grand_total=?11, is_closed=1, closed_at=datetime('now','localtime'), notes=?12, tasa_bcv=?13, tasa_eur=?14, initial_cash_usd=?15, actual_cash_usd=?16, actual_cash_bs=?17, actual_punto_usd=?18, actual_punto_bs=?19, actual_zelle=?20, actual_pago_movil=?21, actual_transfer_bs=?22, difference=?23, total_usd=?24, total_bs=?25, pos_settled=?26, pos_settled_bs=?27, drawer_adjust_usd=?28, drawer_adjust_bs=?29
             WHERE close_date=?1 AND is_closed=0",
            params![close_date, t.pos_charged, t.pos_fees, t.pos_net, t.cash_usd, t.cash_bs,
                    t.zelle_total, t.pago_movil_total, t.transfer_bs_total, t.usd_cash_total, grand_total, notes,
                    // F69: se guarda el fondo que se USÓ (`fondo_usd`, el de la fila del turno) y no el
                    // parámetro: un recierre después de reabrir (↺) tiene que volver a dar lo mismo.
                    effective_tasa, tasa_eur, if fondo_usd > 0.0 { fondo_usd } else { initial_cash_usd },
                    actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs,
                    actual_zelle, actual_pago_movil, actual_transfer_bs, difference, t.grand_usd, t.grand_bs,
                    pos_settled, pos_settled_bs,
                    // F69: el ajuste del cajón que se usó (fondo + gastos), guardado para que
                    // este cierre se siga explicando solo aunque después cambie algo. Las
                    // devoluciones NO van acá: ya están dentro de `cash_*` (vienen netas).
                    fondo_usd - adj.gastos_usd,
                    -adj.gastos_bs],
        )?;
        if changes == 0 {
            return Err(day_shift_error("No hay un día abierto con esa fecha para cerrar."));
        }
        let id: i64 = conn.query_row(
            "SELECT id FROM daily_closings WHERE close_date=?1", params![close_date], |r| r.get(0),
        )?;
        // F68/F40: el cierre queda en el LIBRO con su autor y con la diferencia del arqueo en la
        // nota (es el acto que congela el día; hasta F68 no quedaba rastro de QUIÉN lo hizo).
        self.book_movement(&conn, &NewCashMovement {
            r#type: "cierre",
            method: "",
            currency: "USD",
            amount: difference,
            sign: 0,
            reference: close_date,
            sale_id: None,
            service_id: None,
            payment_id: None,
            expense_id: None,
            note: "Cierre del día (diferencia del arqueo)",
            when: Some(close_date),
        })?;
        drop(conn);
        // F71: el cierre deja una COPIA AUTOMÁTICA de la base (no rompe el cierre si falla).
        let _ = self.auto_backup();
        Ok(id)
    }

    /// F71 — COPIA AUTOMÁTICA AL CERRAR EL DÍA (bloqueante A2 de la auditoría): el cierre es el momento
    /// en que la caja queda cuadrada, o sea el mejor punto del día para guardar el respaldo. NO rompe el
    /// cierre si falla: se anota el error en `settings` para que la pantalla de respaldos lo muestre
    /// (un disco lleno no puede impedir que el local cierre su caja).
    ///
    /// Se llama desde `close_day` (después del commit) y también la puede llamar el arranque.
    pub fn auto_backup(&self) -> SqlResult<Option<crate::backups::BackupInfo>> {
        // (el lock de la conexión NO se toma acá: `backup_now` abre su propia conexión y `set_setting`
        //  toma el suyo — pedirlo dos veces en el mismo hilo sería un deadlock)
        match crate::backups::backup_now(&self.db_path, None, true) {
            Ok(info) => {
                let _ = self.set_setting("last_backup_at", &info.created_at);
                let _ = self.set_setting("last_backup_error", "");
                Ok(Some(info))
            }
            Err(e) => {
                let _ = self.set_setting("last_backup_error", &e);
                Ok(None)
            }
        }
    }

    pub fn reopen_day(&self, close_date: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE daily_closings SET is_closed=0, closed_at=NULL WHERE close_date=?1", params![close_date])?;
        // F68/F40: reabrir un día es un acto sobre la CAJA (y hasta F68 se llevaba `closed_at`, la
        // única evidencia de que estaba cerrado). Queda anotado quién lo hizo.
        self.book_movement(&conn, &NewCashMovement {
            r#type: "reapertura",
            method: "",
            currency: "USD",
            amount: 0.0,
            sign: 0,
            reference: close_date,
            sale_id: None,
            service_id: None,
            payment_id: None,
            expense_id: None,
            note: "Día reabierto",
            when: Some(close_date),
        })?;
        Ok(())
    }

    pub fn update_daily_closing_settlement(&self, id: i64, pos_settled: f64, pos_settled_bs: f64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE daily_closings SET pos_settled=?1, pos_settled_bs=?2 WHERE id=?3", params![pos_settled, pos_settled_bs, id])?;
        Ok(())
    }

    // --- Export/Import ---
    //
    // F69 (revisión adversarial) — EL RESPALDO NO LLEVA EL HASH DEL PIN. `settings.pin` guardaba el
    // hash PBKDF2 de un PIN de 4 dígitos: con 10.000 combinaciones se revierte offline en segundos, y
    // el archivo de respaldo es justo el que el dueño comparte o deja en un pendrive. Se exporta el
    // resto de `settings` (nombre del negocio, impresora, categorías de trabajo) con `pin` en blanco,
    // y la restauración tampoco lo pisa (el PIN de la instalación no viaja en un archivo).
    pub fn export_data(&self) -> SqlResult<String> {
        let conn = self.conn.lock().unwrap();
        let tables = ["categories", "payment_methods", "service_statuses", "products", "clients", "sales", "services", "service_payments", "inventory_movements", "purchase_orders", "purchase_order_items", "daily_closings", "technicians", "settings", "expenses"];
        let mut map = serde_json::Map::new();
        for table in &tables {
            let sql = format!("SELECT * FROM {}", table);
            let mut stmt = conn.prepare(&sql)?;
            let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
            let rows: Vec<serde_json::Value> = stmt.query_map([], |r| {
                let mut obj = serde_json::Map::new();
                for (i, col) in cols.iter().enumerate() {
                    let val: rusqlite::types::Value = r.get_unwrap(i);
                    obj.insert(col.clone(), match val {
                        rusqlite::types::Value::Null => serde_json::Value::Null,
                        rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                        rusqlite::types::Value::Real(f) => serde_json::json!(f),
                        rusqlite::types::Value::Text(s) => serde_json::json!(s),
                        _ => serde_json::Value::Null,
                    });
                }
                Ok(serde_json::Value::Object(obj))
            })?.collect::<Result<Vec<_>, _>>()?;
            // Los secretos de `settings` (el hash del PIN y el estado del bloqueo) NO se exportan:
            // ni la clave ni el valor. Lo demás de `settings` (negocio, impresora, trabajos) sí.
            let rows: Vec<serde_json::Value> = if *table == "settings" {
                rows.into_iter()
                    .filter(|r| !es_secreto_de_settings(r.get("key").and_then(|v| v.as_str()).unwrap_or("")))
                    .collect()
            } else {
                rows
            };
            map.insert(table.to_string(), serde_json::Value::Array(rows));
        }
        serde_json::to_string_pretty(&serde_json::Value::Object(map)).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
    }

    pub fn import_data(&self, json_str: &str, merge: bool) -> SqlResult<String> {
        let conn = self.conn.lock().unwrap();
        let data: serde_json::Value = serde_json::from_str(json_str).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;
        // Orden respeta las FK: catálogos → productos → clientes → ventas/servicios → pagos → movimientos → pedidos → cierres
        let tables = ["categories", "payment_methods", "service_statuses", "products", "clients", "sales", "services", "service_payments", "inventory_movements", "purchase_orders", "purchase_order_items", "daily_closings", "technicians", "settings", "expenses"];

        // Validar columnas del JSON contra el schema real (anti inyección SQL por nombre de columna)
        let valid_columns: std::collections::HashMap<String, Vec<String>> = tables.iter().map(|t| {
            let mut st = conn.prepare(&format!("PRAGMA table_info({})", t)).unwrap();
            let cols: Vec<String> = st.query_map([], |r| r.get::<_, String>(1))
                .map(|rows| rows.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();
            (t.to_string(), cols)
        }).collect();

        let tx = conn.unchecked_transaction()?;
        for table in &tables {
            if let Some(arr) = data.get(*table).and_then(|v| v.as_array()) {
                let valid = valid_columns.get(*table).cloned().unwrap_or_default();
                for row in arr {
                    if let Some(obj) = row.as_object() {
                        let cols: Vec<&str> = obj.keys()
                            .filter(|k| *k != "id" && valid.iter().any(|v| v == *k))
                            .map(|k| k.as_str())
                            .collect();
                        if cols.is_empty() { continue; }

                        if merge && obj.contains_key("name") && (*table == "categories" || *table == "payment_methods" || *table == "service_statuses") {
                            let name = obj["name"].as_str().unwrap_or("");
                            let existing: Option<i64> = tx.query_row(
                                &format!("SELECT id FROM {} WHERE name=?1", table),
                                params![name], |r| r.get(0),
                            ).ok();
                            if let Some(eid) = existing {
                                let set_clause: Vec<String> = cols.iter().filter(|c| **c != "name").map(|c| format!("{} = ?", c)).collect();
                                if !set_clause.is_empty() {
                                    let sql = format!("UPDATE {} SET {} WHERE id=?", table, set_clause.join(", "));
                                    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
                                    for c in &cols {
                                        if *c != "name" {
                                            values.push(val_to_sql(&obj[&**c]));
                                        }
                                    }
                                    values.push(Box::new(eid));
                                    let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
                                    tx.execute(&sql, params_ref.as_slice())?;
                                }
                                continue;
                            }
                        }

                        if merge && obj.contains_key("id") {
                            let oid = obj["id"].as_i64().unwrap_or(0);
                            let existing: Option<i64> = tx.query_row(
                                &format!("SELECT id FROM {} WHERE id=?1", table),
                                params![oid], |r| r.get(0),
                            ).ok();
                            if existing.is_some() {
                                let set_clause: Vec<String> = cols.iter().map(|c| format!("{} = ?", c)).collect();
                                let sql = format!("UPDATE {} SET {} WHERE id=?", table, set_clause.join(", "));
                                let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
                                for c in &cols { values.push(val_to_sql(&obj[&**c])); }
                                values.push(Box::new(oid));
                                let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
                                tx.execute(&sql, params_ref.as_slice())?;
                                continue;
                            }
                        }

                        let placeholders: Vec<String> = cols.iter().map(|_| "?".to_string()).collect();
                        // settings no tiene columna `id` (PK = key): el merge por id no la captura
                        // y un INSERT plano chocaría con claves existentes (pin, printer_port...).
                        // OR REPLACE = semántica de actualización por key (idempotente).
                        let verb = if *table == "settings" { "INSERT OR REPLACE INTO" } else { "INSERT INTO" };
                        let sql = format!("{} {} ({}) VALUES ({})", verb, table, cols.join(", "), placeholders.join(", "));
                        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
                        for c in &cols { values.push(val_to_sql(&obj[&**c])); }
                        let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
                        tx.execute(&sql, params_ref.as_slice())?;
                    }
                }
            }
        }
        tx.commit()?;
        Ok("OK".to_string())
    }
}

// Corre `python export_libro_diario.py <json> <out>` con tope de 30s (patrón printer.rs:
// proceso externo en hilo + channel — NUNCA bloquear si Python se cuelga). Prueba
// `python` y luego `py -3` (launcher de Windows).
fn run_python_export(script: &std::path::Path, json: &std::path::Path, out: &std::path::Path) -> Result<(), String> {
    let _ = std::fs::remove_file(out); // descarta un xlsx viejo: el éxito se mide por re-crearlo
    let (tx, rx) = std::sync::mpsc::channel();
    let script = script.to_path_buf();
    let json = json.to_path_buf();
    let out = out.to_path_buf();
    std::thread::spawn(move || {
        for cmd in [vec!["python".to_string()], vec!["py".to_string(), "-3".to_string()]] {
            let result = std::process::Command::new(&cmd[0])
                .args(&cmd[1..])
                .arg(&script)
                .arg(&json)
                .arg(&out)
                .output();
            match result {
                Ok(o) => {
                    if o.status.success() && out.exists() {
                        let _ = tx.send(Ok(()));
                        return;
                    }
                    let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                    let err = if err.is_empty() {
                        String::from_utf8_lossy(&o.stdout).trim().to_string()
                    } else { err };
                    let _ = tx.send(Err(if err.is_empty() {
                        format!("{} no generó el archivo", cmd[0])
                    } else { err }));
                    return;
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("{}: {}", cmd[0], e)));
                    return;
                }
            }
        }
    });
    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(r) => r,
        Err(_) => Err("tiempo agotado (30s) generando el Excel".to_string()),
    }
}

/// Etiqueta de referencia de un movimiento de inventario generado por un
/// servicio: el número de orden (trazabilidad: DEV-0004) o "Servicio" como antes.
fn ref_label(order_num: &str) -> String {
    let t = order_num.trim();
    if t.is_empty() { "Servicio".to_string() } else { t.to_string() }
}

fn day_shift_error(msg: &str) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::ErrorCode::CannotOpen as i32),
        Some(msg.to_string()),
    )
}

/// F62/F65 — Plegado de un NOMBRE (de trabajo o de categoría) para comparar duplicados:
/// minúsculas, sin acentos y solo alfanuméricos. Es el MISMO criterio que `foldWork`/`normPhoneModel`
/// del frontend, así que «Cambio de Tapa» y «cambio de tapa» son el mismo nombre y no se crean dos
/// (una sola implementación: la usan las categorías de trabajo del local y las de producto).
pub(crate) fn plegar_texto(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            otro => otro,
        })
        .collect()
}

/// F32 — ¿este estado es de TALLER (el equipo todavía está en el local)?
///
/// Una orden NUEVA solo puede nacer en un estado de taller: el `INSERT` no escribe `date_out` ni
/// toca el stock (eso lo hace el cambio de estado, y con todas sus reglas: pantalla exacta,
/// garantía de 7 días, movimiento de inventario, cobro). Si se permitiera nacer «Entregado», la
/// orden quedaría SIN fecha de entrega (fuera del panel «Entregados hoy», sin garantía y sin
/// entrar en el libro del día) y con el stock sin descontar. Entregar es un ACTO aparte de recibir.
///
/// `""` (llamadores viejos como `add_service`) → sí: cae al histórico `Por entregar`.
fn es_estado_de_taller(status: &str) -> bool {
    !matches!(status.trim(), "Entregado" | "Cancelado" | "Devuelto" | "Cancelado / Devuelto")
}

// ---------------------------------------------------------------- PIN (hash)
/// Iteraciones de PBKDF2-HMAC-SHA256 para el PIN (2026-09-16).
const PIN_ITERATIONS: u32 = 60_000;
/// Intentos fallidos seguidos antes de bloquear la entrada del PIN.
const PIN_MAX_ATTEMPTS: u32 = 5;

/// F69 — claves de `settings` que NO salen de la app en un respaldo (`export_data`): el hash del PIN
/// y el estado del bloqueo por intentos. Un PIN de 4 dígitos tiene 10.000 combinaciones: su hash se
/// revierte offline en segundos, y el respaldo es el archivo que se comparte.
fn es_secreto_de_settings(key: &str) -> bool {
    matches!(key, "pin" | "pin_failures" | "pin_locked_until")
}

/// Segundos de bloqueo tras agotar los intentos.
const PIN_LOCK_SECS: u64 = 60;

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok())
        .collect()
}

/// Hash del PIN en el formato `pbkdf2$<iteraciones>$<sal_hex>$<hash_hex>`.
fn hash_pin(pin: &str) -> SqlResult<String> {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut salt = [0u8; 16];
    SystemRandom::new()
        .fill(&mut salt)
        .map_err(|_| day_shift_error("No se pudo generar el sal del PIN."))?;
    let mut out = [0u8; 32];
    let iters = std::num::NonZeroU32::new(PIN_ITERATIONS).unwrap();
    ring::pbkdf2::derive(ring::pbkdf2::PBKDF2_HMAC_SHA256, iters, &salt, pin.as_bytes(), &mut out);
    Ok(format!("pbkdf2${PIN_ITERATIONS}${}${}", hex_encode(&salt), hex_encode(&out)))
}

/// Comprueba el PIN contra lo guardado. Devuelve:
///   `Some(false)` = correcto (ya estaba hasheado)
///   `Some(true)`  = correcto pero guardado en TEXTO PLANO (base vieja: hay que re-hashear)
///   `None`        = incorrecto (o guardado vacío)
fn check_pin(pin: &str, stored: &str) -> Option<bool> {
    if stored.is_empty() {
        return None;
    }
    if let Some(rest) = stored.strip_prefix("pbkdf2$") {
        let mut parts = rest.split('$');
        let iters: u32 = parts.next()?.parse().ok()?;
        let salt = hex_decode(parts.next()?)?;
        let expected = hex_decode(parts.next()?)?;
        let iters = std::num::NonZeroU32::new(iters)?;
        return ring::pbkdf2::verify(
            ring::pbkdf2::PBKDF2_HMAC_SHA256, iters, &salt, pin.as_bytes(), &expected,
        ).ok().map(|_| false);
    }
    // Base vieja: PIN en texto plano de 4 dígitos
    if stored == pin {
        Some(true)
    } else {
        None
    }
}

// Métodos de pago en bolívares (la moneda SIEMPRE se deriva del método, no del servicio)
const BS_METHODS: [&str; 5] = ["Efectivo Bs", "Pago Móvil", "Pago Movil", "Transferencia Bs", "Punto de Venta (Bs)"];

fn is_bs_method(method: &str) -> bool {
    BS_METHODS.iter().any(|m| method.trim() == *m)
}

// Devuelve la moneda correcta para el método; si el método no es reconocido, conserva la pasada.
fn normalize_payment_currency<'a>(method: &str, currency: &'a str) -> &'a str {
    if is_bs_method(method) { return "VES"; }
    if method.trim() == "Divisas (USD Cash)" || method.trim() == "Transferencia Zelle" || method.trim() == "Punto de Venta ($)" {
        return "USD";
    }
    if currency.is_empty() { "USD" } else { currency }
}

// Escapa un campo CSV: si contiene ';' o '"' o salto de línea → comillas dobles con comillas internas duplicadas
fn csv_field(s: &str) -> String {
    if s.contains(';') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

// Número con decimal coma (es-VE), sin separador de miles: 1234.50 → "1234,50"
fn fmt_num(v: f64) -> String {
    format!("{:.2}", v).replace('.', ",")
}

// Normaliza una cédula a solo dígitos ("V-24906999" → "24906999")
fn norm_ci_digits(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

// Normaliza un nombre propio: cada palabra con inicial mayúscula y resto minúsculas
// ("ROBERTH SILVA", "roberth  silva" → "Roberth Silva"). Harness 2026-08-07.
fn title_case(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(f) => f.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// Normaliza un modelo para matching: minúsculas, sin acentos, sin espacios extra
fn norm_model(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.to_lowercase().chars() {
        let c = match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            _ => c,
        };
        if !c.is_whitespace() && !c.is_ascii_punctuation() {
            out.push(c);
        }
    }
    out
}

fn val_to_sql(val: &serde_json::Value) -> Box<dyn rusqlite::types::ToSql> {
    match val {
        serde_json::Value::Null => Box::new(rusqlite::types::Null),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() { Box::new(i) }
            else { Box::new(n.as_f64().unwrap_or(0.0)) }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        _ => Box::new(val.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // Regresión 2026-08-13: la serialización de PrinterSettings DEBE usar claves
    // camelCase (windowsPrinter/businessName/businessLine) porque el frontend las
    // lee así. Antes (snake_case) la selección de impresora "nunca se guardaba":
    // el frontend leía undefined → el save mandaba campos faltantes → el invoke
    // fallaba en silencio y la BD conservaba el valor viejo.
    #[test]
    fn test_printer_settings_serializes_camel_case() {
        let s = PrinterSettings {
            port: "COM16".into(),
            baud: 9600,
            width: 58,
            windows_printer: "POS-58-Series USB".into(),
            business_name: "Mi Negocio".into(),
            business_line: "Linea".into(),
            logo: "".into(),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["port"], "COM16");
        assert_eq!(v["baud"], 9600);
        assert_eq!(v["width"], 58);
        assert_eq!(v["windowsPrinter"], "POS-58-Series USB");
        assert_eq!(v["businessName"], "Mi Negocio");
        assert_eq!(v["businessLine"], "Linea");
        assert_eq!(v["logo"], "");
        // NUNCA deben aparecer claves snake_case en la respuesta (bug persistencia)
        assert!(v.get("windows_printer").is_none());
        assert!(v.get("business_name").is_none());
    }

    // Ejecuta un cierre tomando el lock de la conexión una sola vez
    fn conn_query<T, F: FnOnce() -> T>(f: F) -> T {
        f()
    }

    /// PIN: hash + gate de dueño + límite de intentos (B4 de la validación pre-producción).
    /// Lo CRÍTICO es no dejar al dueño afuera: una base vieja con el PIN en texto plano tiene
    /// que seguir funcionando (y actualizarse al hash sola) después de una actualización.
    // ─── F68 — SESIONES DE CAJA (Master / Caja) Y LIBRO DE PLATA ────────────────────────────────

    /// F68 — El Master nace con el PIN que ya tenía la instalación; cada persona entra con SU PIN,
    /// y el rol decide si puede hacer las escrituras del dueño.
    #[test]
    fn test_sesiones_master_y_caja() {
        let test_path = PathBuf::from("test_registro_f68.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // 1) Instalación VIEJA: un PIN suelto en settings → al migrar nace la fila Master con ESE PIN
        db.set_pin("1234").unwrap();
        let master = db.master_user().unwrap().expect("tiene que existir el Master");
        assert_eq!(master.role, "master");
        assert!(master.has_pin, "el Master hereda el PIN de la instalación");
        assert!(db.verify_user_pin(master.id, "1234").unwrap().is_some(), "el dueño entra con su PIN de siempre");
        assert_eq!(db.current_user().unwrap().role, "master");
        assert!(db.owner_can_edit(), "con sesión de Master se puede escribir");

        // PIN equivocado: NO abre sesión
        db.lock_owner();
        assert!(db.verify_user_pin(master.id, "0000").unwrap().is_none());
        assert!(!db.owner_can_edit(), "sin PIN correcto no hay sesión");

        // 2) Se crea la CAJA 1 con su propio PIN
        let caja_id = db.add_user("Caja 1", "caja", "2468", "#22c55e").unwrap();
        assert!(db.verify_user_pin(master.id, "1234").unwrap().is_some(), "el Master vuelve a entrar");
        let caja = db.verify_user_pin(caja_id, "2468").unwrap().expect("la caja entra con SU PIN");
        assert_eq!(caja.role, "caja");
        assert_eq!(db.current_user().unwrap().name, "Caja 1");
        assert!(db.current_is_cashier(), "la sesión es de caja");
        // La caja NO puede hacer lo del dueño (el gate real del backend)
        assert!(!db.owner_can_edit(), "la caja no puede tocar catálogo/precios/cierres");
        assert!(db.require_owner().is_err(), "y el error se lo dice");
        assert!(db.set_pin("9999").is_err(), "la caja tampoco cambia el PIN del dueño");
        // El PIN de la caja no sirve para el Master (ni al revés)
        assert!(db.verify_user_pin(master.id, "2468").unwrap().is_none(), "PINes separados por persona");
        assert!(db.verify_user_pin(caja_id, "1234").unwrap().is_none());

        // 3) Reglas fail-closed de las personas
        assert!(db.add_user("Caja 1", "caja", "1111", "").is_err(), "no se repiten nombres");
        assert!(db.add_user("Admin", "admin", "1111", "").is_err(), "un rol fuera de master/caja se rechaza");
        assert!(db.add_user("   ", "caja", "1111", "").is_err(), "sin nombre no se crea");
        assert!(db.delete_user(master.id).is_err(), "no se borra al único Master");
        assert!(db.update_user(master.id, "Master", "#000", false).is_err(), "no se apaga al único Master");
        // F69 — con más de una persona, NADIE entra sin PIN: una fila sin PIN es la puerta para
        // quedarse con el rol que esa persona tenga (el dueño ve todo el dinero).
        let aux = db.add_user("Ayudante", "caja", "", "").unwrap();
        let err = db.verify_user_pin(aux, "").unwrap_err().to_string();
        assert!(err.contains("no tiene PIN"), "sin PIN no se entra con más gente: {err}");
        // …pero SÍ entra con el PIN que se le ponga, y una persona apagada no entra ni con PIN
        db.set_user_pin(aux, "1111").unwrap();
        assert!(db.set_user_pin(aux, "12").is_err(), "un PIN de 2 dígitos se rechaza (misma forma que el del dueño)");
        assert!(db.set_user_pin(aux, "12a4").is_err(), "y uno con letras también");
        assert!(db.verify_user_pin(aux, "1111").unwrap().is_some(), "con PIN sí entra");
        db.update_user(aux, "Ayudante", "", false).unwrap();
        assert!(db.verify_user_pin(aux, "1111").unwrap().is_none(), "una persona apagada no entra");
        // Un MASTER no puede quedar sin PIN si hay más gente (cualquiera entraría como dueño)…
        db.owner_session_set(true);
        let err = db.set_user_pin(master.id, "").unwrap_err().to_string();
        assert!(err.contains("no puede quedar sin PIN"), "el dueño no queda sin PIN: {err}");
        // …y en la instalación de UN solo usuario (sin nadie más) el PIN vacío sí se acepta.
        assert!(!db.single_user_install(), "acá hay más de una persona");
        let solo = {
            let p = PathBuf::from("test_registro_f68_solo.db");
            let _ = std::fs::remove_file(&p);
            let d = Database::new(&p).expect("DB de un solo usuario");
            let m = d.master_user().unwrap().unwrap();
            (d, m.id, p)
        };
        assert!(solo.0.set_user_pin(solo.1, "").is_ok(), "un solo usuario: el dueño puede quedar sin PIN");
        assert!(solo.0.verify_user_pin(solo.1, "").unwrap().is_some(), "y entra directo");
        drop(solo.0);
        let _ = std::fs::remove_file(&solo.2);

        // 4) El PIN del dueño se sincroniza en las DOS tablas (pantalla vieja y nueva)
        db.owner_session_set(true);
        db.set_pin("5678").unwrap();
        assert_eq!(db.master_user().unwrap().unwrap().has_pin, true);
        db.lock_owner();
        assert!(db.verify_user_pin(master.id, "5678").unwrap().is_some(), "el PIN nuevo sirve por la pantalla nueva");
        db.lock_owner();
        assert!(db.verify_pin("5678").unwrap(), "y también por la pantalla vieja");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F68/F40 — El LIBRO DE PLATA anota el AUTOR de cada movimiento, y la sesión de CAJA sólo ve
    /// los suyos (es lo que pidió el dueño: «que vea su día de caja pero no cuánto factura la master»).
    #[test]
    fn test_libro_de_plata_con_autor() {
        let test_path = PathBuf::from("test_registro_f68_book.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        db.set_pin("1234").unwrap();
        let master = db.master_user().unwrap().unwrap();
        db.verify_user_pin(master.id, "1234").unwrap();
        let caja_id = db.add_user("Caja 1", "caja", "2468", "#22c55e").unwrap();

        // El dueño abre el día con fondo de caja: la apertura queda en el libro con SU nombre
        db.open_day(50.0, 100.0, 0.0).unwrap();
        let hoy = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT date('now','localtime')", [], |r| r.get::<_, String>(0)).unwrap()
        };
        let libro = db.get_cash_movements(&hoy, &hoy, None, 100).unwrap();
        let apertura = libro.iter().find(|m| m.r#type == "apertura").expect("la apertura queda en el libro");
        assert_eq!(apertura.user_name, "Master", "el autor de la apertura es quien abrió el día");
        assert_eq!(apertura.amount, 50.0);

        // La CAJA vende (queda con SU nombre) y el dueño vende (queda con el suyo)
        let p1 = db.add_product("Pantalla Prueba F68", Some(1), "Tecno", "Spark 10", "", "[\"Spark 10\"]",
                                5.0, 12.0, 10, 0, 0.0).unwrap();
        assert!(db.verify_user_pin(caja_id, "2468").unwrap().is_some(), "entra la caja");
        db.add_sale(Some(p1), "Pantalla Prueba F68", 1, 12.0, 12.0, "Divisas (USD Cash)", "", None, "", 0.0, "", "USD", 0.0).unwrap();
        assert!(db.verify_user_pin(master.id, "1234").unwrap().is_some(), "entra el dueño");
        db.add_sale(Some(p1), "Pantalla Prueba F68", 2, 12.0, 24.0, "Divisas (USD Cash)", "", None, "", 0.0, "", "USD", 0.0).unwrap();

        let todas = db.get_cash_movements(&hoy, &hoy, None, 100).unwrap();
        let ventas: Vec<_> = todas.iter().filter(|m| m.r#type == "venta").collect();
        assert_eq!(ventas.len(), 2, "las dos ventas están en el libro");
        assert!(ventas.iter().any(|m| m.user_name == "Caja 1"), "la venta de la caja lleva su nombre");
        assert!(ventas.iter().any(|m| m.user_name == "Master"), "la del dueño lleva el suyo");

        // LA CLAVE DEL PEDIDO: la caja NO ve lo del dueño, el dueño ve todo
        let solo_caja = db.get_cash_movements(&hoy, &hoy, Some(caja_id), 100).unwrap();
        assert!(solo_caja.iter().all(|m| m.user_name == "Caja 1"),
            "la sesión de caja sólo recibe SUS movimientos: {:?}", solo_caja.iter().map(|m| &m.user_name).collect::<Vec<_>>());
        assert_eq!(solo_caja.iter().filter(|m| m.r#type == "venta").count(), 1);
        assert!(db.get_cash_movements(&hoy, &hoy, None, 100).unwrap().len() > solo_caja.len(),
            "el Master ve más que la caja");

        // Resumen por persona (pantalla del dueño)
        let resumen = db.get_cash_movements_by_user(&hoy, &hoy).unwrap();
        assert!(resumen.iter().any(|(n, _, _, _)| n == "Caja 1"), "la caja aparece en el resumen");
        assert!(resumen.iter().any(|(n, _, _, _)| n == "Master"), "el Master también");

        // Borrar un cobro deja el CONTRA-ASIENTO (el libro sigue siendo la verdad)
        let svc_id = db.add_service("DEV-F68", "Cliente F68", "", "Spark 10", "", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 30.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "V-1", "", "", None, "", None, "Negro", None, 0.0).unwrap();
        let pay_id = db.add_service_payment(svc_id, 10.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();
        assert!(db.get_cash_movements(&hoy, &hoy, None, 100).unwrap().iter().any(|m| m.r#type == "abono" && m.payment_id == Some(pay_id)));
        db.delete_service_payment(pay_id).unwrap();
        let borrado = db.get_cash_movements(&hoy, &hoy, None, 100).unwrap()
            .into_iter().find(|m| m.r#type == "abono_anulado").expect("queda el contra-asiento");
        assert_eq!(borrado.sign, -1, "el contra-asiento sale de la caja");
        assert_eq!(borrado.amount, 10.0);
        assert_eq!(borrado.user_name, "Master", "y dice quién lo borró");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_pin_hash_owner_gate_and_lockout() {        let test_path = PathBuf::from("test_registro_pin.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // 1) sin PIN configurado: se crea el primero (instalación de un solo usuario)
        assert!(!db.get_pin_status().unwrap());
        db.set_pin("1234").unwrap();
        assert!(db.get_pin_status().unwrap());

        // 2) se guarda HASHEADO, nunca en texto plano
        let guardado: String = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT value FROM settings WHERE key='pin'", [], |r| r.get(0)).unwrap()
        };
        assert!(guardado.starts_with("pbkdf2$"), "guardado: {guardado}");
        assert!(!guardado.contains("1234"), "el PIN no puede quedar en texto plano: {guardado}");

        // 3) dos hashes del MISMO pin son distintos (sal aleatoria)
        let g2 = hash_pin("1234").unwrap();
        assert_ne!(guardado, g2);

        // 4) verificar bien desbloquea la sesión de DUEÑO; mal la apaga
        assert!(db.verify_pin("1234").unwrap());
        assert!(db.owner_can_edit());
        assert!(!db.verify_pin("9999").unwrap());
        assert!(!db.owner_can_edit(), "un PIN incorrecto apaga la sesión de dueño");

        // 5) cambiar el PIN exige la sesión de dueño (una cajera no puede)
        assert!(db.set_pin("5678").is_err(), "sin sesión de dueño NO se cambia el PIN");
        assert!(db.verify_pin("1234").unwrap());
        db.set_pin("5678").unwrap();
        assert!(db.verify_pin("5678").unwrap());
        assert!(!db.verify_pin("1234").unwrap(), "el PIN viejo ya no sirve");

        // 6) límite de intentos: 5 fallos seguidos bloquean 60 s
        //    (se limpia el contador primero: los pasos anteriores ya dejaron fallos contados)
        db.pin_failures.store(0, std::sync::atomic::Ordering::Relaxed);
        for _ in 0..(PIN_MAX_ATTEMPTS - 1) {
            assert!(!db.verify_pin("0000").unwrap(), "los primeros fallos responden «incorrecto»");
        }
        assert_eq!(db.pin_lock_seconds(), 0, "todavía no está bloqueado con 4 fallos");
        assert!(!db.verify_pin("0000").unwrap(), "el 5º fallo todavía responde «incorrecto»");
        assert!(db.pin_lock_seconds() > 0, "el 5º fallo bloquea");
        let err = db.verify_pin("5678").unwrap_err().to_string();
        assert!(err.contains("Demasiados intentos"), "error: {err}");
        // el PIN correcto tampoco pasa mientras está bloqueado (no se puede sondear)
        assert!(db.verify_pin("5678").is_err());
        // (el vencimiento por tiempo se prueba sin esperar 60 s: se limpia el bloqueo a mano — ahora
        //  el bloqueo vive en `settings`, así que se limpian las DOS fuentes, como haría el reloj)
        *db.pin_locked_until.lock().unwrap() = None;
        db.pin_failures.store(0, std::sync::atomic::Ordering::Relaxed);
        {
            let c = db.conn.lock().unwrap();
            c.execute("DELETE FROM settings WHERE key IN ('pin_failures','pin_locked_until')", []).unwrap();
        }
        assert_eq!(db.pin_lock_seconds(), 0, "sin bloqueo ni en memoria ni en la base");
        assert!(db.verify_pin("5678").unwrap());

        // 6b) F69: el bloqueo por intentos SE PERSISTE (reiniciar la app ya no borra el castigo)
        for _ in 0..PIN_MAX_ATTEMPTS {
            let _ = db.verify_pin("0000");
        }
        assert!(db.pin_failures_persisted() == 0 || db.pin_lock_seconds() > 0);
        let bloqueado_en_base: i64 = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT COUNT(*) FROM settings WHERE key='pin_locked_until' AND CAST(value AS INTEGER) > 0",
                        [], |r| r.get(0)).unwrap()
        };
        assert_eq!(bloqueado_en_base, 1, "la hora del bloqueo queda guardada en la base");
        // Una instancia NUEVA de la app (mismo archivo) sigue bloqueada: no se puede reiniciar para probar
        {
            let db2 = Database::new(&test_path).expect("reabrir la misma base");
            assert!(db2.pin_lock_seconds() > 0, "el bloqueo sobrevive al reinicio de la app");
            assert!(db2.verify_pin("5678").is_err(), "y no se puede sondear el PIN tras reiniciar");
        }
        {
            let c = db.conn.lock().unwrap();
            c.execute("DELETE FROM settings WHERE key IN ('pin_failures','pin_locked_until')", []).unwrap();
        }
        *db.pin_locked_until.lock().unwrap() = None;
        db.pin_failures.store(0, std::sync::atomic::Ordering::Relaxed);

        // 7) base VIEJA con el PIN en texto plano: sigue funcionando y se actualiza al hash
        {
            let c = db.conn.lock().unwrap();
            c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('pin','4321')", []).unwrap();
        }
        assert!(db.verify_pin("4321").unwrap(), "una base vieja en texto plano tiene que seguir entrando");
        let migrado: String = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT value FROM settings WHERE key='pin'", [], |r| r.get(0)).unwrap()
        };
        assert!(migrado.starts_with("pbkdf2$"), "se actualiza al hash solo: {migrado}");
        assert!(db.verify_pin("4321").unwrap());

        // 8) quitar el PIN exige el PIN (y deja la instalación sin PIN)
        assert!(db.remove_pin("0000").is_err());
        assert!(db.remove_pin("4321").unwrap());
        assert!(!db.get_pin_status().unwrap());
        assert!(db.owner_can_edit(), "sin PIN la instalación es de un solo usuario");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_all_operations() {
        let test_path = PathBuf::from("test_registro.db");
        let _ = std::fs::remove_file(&test_path);

        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Blocking: sales/services require an open day
        let blocked = db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Efectivo Bs", "Test Client", None, "", 0.0, "", "USD", 0.0);
        assert!(blocked.is_err(), "add_sale must fail without an open day");

        // Open day (shift) with BCV rate
        let day_id = db.open_day(10.0, 40.5, 45.0).unwrap();
        assert!(day_id > 0);
        let active = db.get_active_day().unwrap();
        assert!(active.is_some(), "There must be an active day");
        assert_eq!(active.unwrap().tasa_bcv, 40.5);
        // Re-abrir HOY actualiza el día (corregir tasa a mitad de día) conservando la fila
        let day2 = db.open_day(10.0, 40.5, 45.0).unwrap();
        assert_eq!(day2, day_id, "el update del día conserva la fila");

        // Categories
        let cats = db.get_categories().unwrap();
        assert!(!cats.is_empty(), "Should have default categories");
        println!("  Categories: {}", cats.len());

        // Add product
        let pid = db.add_product("Pantalla Test", Some(1), "Xiaomi", "Red Note 11",
            "Incell", "[\"Red Note 11\",\"Note 11S\"]", 8.0, 15.0, 5, 2, 0.0).unwrap();
        assert!(pid > 0);

        // Get products
        let products = db.get_products("", None).unwrap();
        assert_eq!(products.len(), 1);

        // Search
        let found = db.get_products("Red Note", None).unwrap();
        assert_eq!(found.len(), 1);

        // Low stock
        let _low = db.get_low_stock_products().unwrap();

        // Add client
        let cid = db.add_client("Test Client", "0412-1234567", "", "").unwrap();
        assert!(cid > 0);

        // Find client
        let found_cid = db.find_client("Test Client").unwrap();
        assert_eq!(found_cid, Some(cid));

        // Suggest clients
        let suggestions = db.suggest_clients("Test", 5).unwrap();
        assert!(!suggestions.is_empty());

        // Add sale
        db.add_sale(Some(pid), "Pantalla Test", 1, 15.0, 15.0, "Efectivo Bs", "Test Client", Some(cid), "", 0.0, "", "USD", 0.0).unwrap();
        let sales = db.get_sales("", None, "", "").unwrap();
        assert_eq!(sales.len(), 1);

        // Sales stats
        let stats = db.get_sales_stats(30).unwrap();
        assert!(stats.len() >= 1);

        // Add service (linked to client id)
        let sid = db.add_service("ORD-TEST-1", "Juan Perez", "0412-1234567",
            "Samsung A32", "No enciende", "Cambio batería", "[\"Cambio batería\"]", 25.0, "Efectivo Bs", "", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"si","bandeja_sim":"si","botones":"si","boton_home":"na","camara":"si","puerto_carga":"si","parlante":"si","contrasena":"no","accesorios":"no"}"#, Some(cid), "", None, "", None, 0.0).unwrap();
        assert!(sid > 0);

        // Auto-inventory: create Samsung A32 screen product (stock 2) before delivering
        let a32_pid = db.add_product("Pantalla Samsung A32", Some(1), "Samsung", "A32",
            "", "[\"Samsung A32\"]", 12.0, 15.0, 2, 0, 0.0).unwrap();

        db.update_service(sid, "Juan Perez", "0412-1234567", "Samsung A32",
            "No enciende - reparado", "Cambio pantalla", "[\"Cambio pantalla\"]", 25.0, "Efectivo Bs", "2026-07-30",
            "Entregado", "Garantía 15 días", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"no"}"#, "", None, "", None, 0.0).unwrap();

        let stock_before: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![a32_pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(stock_before, 1, "stock debe bajar de 2 a 1 al entregar servicio");
        // Reopening returns stock
        db.update_service(sid, "Juan Perez", "0412-1234567", "Samsung A32",
            "No enciende - reparado", "Cambio pantalla", "[\"Cambio pantalla\"]", 25.0, "Efectivo Bs", "2026-07-30",
            "Por entregar", "Garantía 15 días", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"no"}"#, "", None, "", None, 0.0).unwrap();
        let stock_back: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![a32_pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(stock_back, 2, "stock debe volver a 2 al reabrir");
        // Entregar de nuevo y borrar el servicio → stock vuelve
        db.update_service(sid, "Juan Perez", "0412-1234567", "Samsung A32",
            "No enciende - reparado", "Cambio pantalla", "[\"Cambio pantalla\"]", 25.0, "Efectivo Bs", "2026-07-30",
            "Entregado", "Garantía 15 días", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"no"}"#, "", None, "", None, 0.0).unwrap();

        // SIN auto-create: modelo sin pantalla en catálogo → al entregar NO se crea producto
        // ni se descuenta (regla 2026-08-12: aviso sin descuento, no fantasmas).
        db.add_service("ORD-TEST-2", "Maria Lopez", "0412-7654321",
            "Pantalla Inexistente XYZ", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]", 20.0, "Efectivo Bs", "", 0.0, "", "USD",
            "V-99999999", "", "", None, "", None, "", None, 0.0).unwrap();
        let sid2 = db.get_services("", "", "", "", "").unwrap().iter().find(|s| s.order_num.as_deref() == Some("ORD-TEST-2")).unwrap().id;
        let new_prod: Option<i64> = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT id FROM products WHERE name LIKE '%Inexistente XYZ%'", [], |r| r.get(0)).ok()
        });
        assert!(new_prod.is_none(), "producto no existe antes de entregar");
        let movs_before = db.get_inventory_movements(None).unwrap().len();
        db.update_service(sid2, "Maria Lopez", "0412-7654321", "Pantalla Inexistente XYZ",
            "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]", 20.0, "Efectivo Bs", "2026-07-30", "Entregado", "", 0.0, "", "USD",
            "V-99999999", "", "", "", None, "", None, 0.0).unwrap();
        let phantom: Option<i64> = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT id FROM products WHERE name LIKE '%Inexistente XYZ%'", [], |r| r.get(0)).ok()
        });
        assert!(phantom.is_none(), "NO se auto-crea producto fantasma al entregar");
        let movs_after = db.get_inventory_movements(None).unwrap().len();
        assert_eq!(movs_after, movs_before, "sin movimiento de stock para modelo sin pantalla en catálogo");
        db.delete_service(sid2).unwrap();
        let phantom2: Option<i64> = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT id FROM products WHERE name LIKE '%Inexistente XYZ%'", [], |r| r.get(0)).ok()
        });
        assert!(phantom2.is_none(), "borrar servicio no crea nada (no había producto)");

        let services = db.get_services("", "", "", "", "").unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].client_ci.as_deref(), Some("V-12345678"));
        assert_eq!(services[0].client_address.as_deref(), Some("Av. Principal"));
        assert!(services[0].device_checklist.as_deref().unwrap_or("").contains("chip_sim"));

        // Dashboard
        let dash = db.get_service_dashboard().unwrap();
        assert!(dash.total > 0);

        // Next order
        let next = db.next_order_num().unwrap();
        assert!(!next.is_empty());

        // Inventory movement
        db.add_inventory_movement(pid, "entrada", 10, "Compra inicial", "FAC-001").unwrap();
        let movs = db.get_inventory_movements(None).unwrap();
        assert!(movs.len() >= 1);

        // Payment methods
        let _methods = db.get_payment_methods().unwrap();

        // Service statuses
        let _statuses = db.get_service_statuses().unwrap();

        // Export
        let exported = db.export_data().unwrap();
        assert!(!exported.is_empty());

        // Import
        let result = db.import_data(&exported, true).unwrap();
        assert_eq!(result, "OK");

        // Suggest products
        let prod_suggestions = db.suggest_products("Pantalla", 5).unwrap();
        assert!(!prod_suggestions.is_empty());

        // Client services (linked by client_id now)
        let client_services = db.get_client_services(cid).unwrap();
        assert_eq!(client_services.len(), 1, "servicio vinculado al cliente via client_id");
        assert_eq!(client_services[0].order_num.as_deref(), Some("ORD-TEST-1"));

        // Service payments (abonos): abono en Bs (Efectivo Bs → SIEMPRE VES) + $15 en USD
        let pid1 = db.add_service_payment(sid, 10.0, "Efectivo Bs", 0.0, "", "USD", "Abono inicial", "").unwrap();
        assert!(pid1 > 0);
        let payments = db.get_service_payments(sid).unwrap();
        assert_eq!(payments.len(), 1);
        assert_eq!(payments[0].amount, 10.0);
        // La moneda se deriva del método: Efectivo Bs → VES aunque el frontend mande 'USD'
        assert_eq!(payments[0].currency.as_deref(), Some("VES"), "moneda derivada del método Bs");
        // paid_amount convierte Bs→USD con la tasa del día (40.5) => 10/40.5 ≈ 0.2469 (ROUND 4 dp, D3)
        let expected_bs: f64 = (10.0_f64 / 40.5 * 10000.0).round() / 10000.0;
        let paid: f64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap()
        });
        assert!((paid - expected_bs).abs() < 1e-9, "paid_amount convierte Bs→USD con tasa del día: {paid}");
        db.add_service_payment(sid, 15.0, "Divisas (USD Cash)", 0.0, "", "USD", "Saldo final", "").unwrap();
        let paid2: f64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap()
        });
        assert!((paid2 - (15.0 + expected_bs)).abs() < 1e-9, "paid_amount = 15 + 10/40.5, got {paid2}");
        // Eliminar un abono recalcula
        db.delete_service_payment(pid1).unwrap();
        let paid3: f64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap()
        });
        assert_eq!(paid3, 15.0, "paid_amount tras eliminar abono");
        db.add_service_payment(sid, 10.0, "Efectivo Bs", 0.0, "", "USD", "Abono inicial", "").unwrap();
        // Libro Diario cuenta pagos por fecha de pago
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let totals_today = db.get_daily_totals(&today, &today).unwrap();
        assert!(!totals_today.is_empty(), "daily totals con pagos");
        let t0 = &totals_today[0];
        assert!(t0.usd_cash_total > 0.0 || t0.cash_bs > 0.0 || t0.grand_total > 0.0, "pagos suman en el día");

        // Purchase orders: create order for A32 product, receive → stock increases
        let a32_stock_before: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![a32_pid], |r| r.get(0)).unwrap()
        });
        let items_json = format!(r#"[{{"productId":{},"productName":"Pantalla Samsung A32","quantity":5,"unitPrice":12.0}}]"#, a32_pid);
        let poid = db.add_purchase_order("Proveedor Test", "Reposición", &items_json).unwrap();
        assert!(poid > 0);
        let orders = db.get_purchase_orders().unwrap();
        assert_eq!(orders.len(), 1);
        assert_eq!(orders[0].status.as_deref(), Some("Pendiente"));
        assert_eq!(orders[0].total_quantity, 5);
        let po_items = db.get_purchase_order_items(poid).unwrap();
        assert_eq!(po_items.len(), 1);
        assert_eq!(po_items[0].product_name.as_deref(), Some("Pantalla Samsung A32"));
        // Receive → stock +5 y movimiento entrada
        db.mark_purchase_order_received(poid).unwrap();
        let a32_stock_after: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![a32_pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(a32_stock_after, a32_stock_before + 5, "recibir pedido suma stock");
        assert!(db.mark_purchase_order_received(poid).is_err(), "no se puede recibir dos veces");
        // Delete order
        db.delete_purchase_order(poid).unwrap();
        assert!(db.get_purchase_orders().unwrap().is_empty());

        // Delete service
        db.delete_service(sid).unwrap();
        let services_after = db.get_services("", "", "", "", "").unwrap();
        assert_eq!(services_after.len(), 0); // was deleted

        // Import price list
        let items = r#"[{"name":"Pantalla Samsung A15","brand":"Samsung","model":"A15 A155","variant":"Incell con marco","category":"Pantalla","price_cost":14.0,"price_sale":17.5,"compatibility":""}]"#;
        let imported = db.import_price_list(items).unwrap();
        assert_eq!(imported, 1);

        // Close day with arqueo (actual counts) and verify persistence
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let closing_id = db.close_day(&today, "cierre test", 10.0, 40.5, 45.0,
            15.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        assert!(closing_id > 0);
        let closings = db.get_daily_closings().unwrap();
        assert!(!closings.is_empty());
        let c = closings.iter().find(|x| x.close_date == today).unwrap();
        assert!(c.is_closed, "Day must be closed");
        assert_eq!(c.tasa_bcv, 40.5);
        assert_eq!(c.initial_cash_usd, 10.0);
        assert_eq!(c.actual_cash_usd, 15.0);
        println!("  Closing: charged={} net={} diff={:.2}", c.pos_charged, c.pos_net, c.difference);

        // After closing, no active day and sales blocked again
        assert!(db.get_active_day().unwrap().is_none());
        let blocked_after = db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Efectivo Bs", "Test Client", None, "", 0.0, "", "USD", 0.0);
        assert!(blocked_after.is_err(), "add_sale must fail after closing");

        // Reopen day → active again
        db.reopen_day(&today).unwrap();
        assert!(db.get_active_day().unwrap().is_some());

        // Clean up
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_open_day_updates_today_tasa() {
        // Caso real de la tienda: se abrió el día SIN tasa (Auto BCV sin internet) →
        // re-abrir HOY actualiza la tasa a mitad de día sin cerrar (fix conversión a 0).
        let test_path = PathBuf::from("test_open_day_update.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(10.0, 0.0, 0.0).unwrap(); // abierto sin tasa

        let id2 = db.open_day(15.0, 748.79, 900.0).unwrap();
        let active = db.get_active_day().unwrap().unwrap();
        assert_eq!(active.id, id2, "el update conserva la fila");
        assert_eq!(active.tasa_bcv, 748.79);
        assert_eq!(active.tasa_eur, 900.0);
        assert_eq!(active.initial_cash_usd, 15.0);
        let open_rows: i64 = db.conn.lock().unwrap()
            .query_row("SELECT COUNT(*) FROM daily_closings WHERE is_closed=0", [], |r| r.get(0)).unwrap();
        assert_eq!(open_rows, 1, "sigue habiendo UN solo día abierto");

        // Cerrar y querer «abrir el día» otra vez: F69 (revisión adversarial) RECHAZA el atajo —
        // antes el `ON CONFLICT ... is_closed=0` volvía a abrir un día ya auditado y reescribía su
        // fondo/tasa. Reabrir es del DUEÑO y tiene su camino explícito (↺ → `reopen_day`)…
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.close_day(&today, "", 15.0, 748.79, 900.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let err = db.open_day(20.0, 750.0, 901.0).unwrap_err().to_string();
        assert!(err.contains("ya está CERRADO"), "abrir un día cerrado se rechaza: {err}");
        assert!(db.get_active_day().unwrap().is_none(), "y el día sigue cerrado");

        // …y con ese camino la fila se conserva (el id no cambia).
        db.reopen_day(&today).unwrap();
        let reabierto = db.get_active_day().unwrap().unwrap();
        assert_eq!(reabierto.id, id2, "reabrir el mismo día conserva la fila");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_bs_payment_requires_tasa() {
        // Gate anti-corrupción: día abierto con tasa 0 → pago/refund Bs rechazados
        // (antes se convertía a 1:1 → paid_amount corrupto). USD sí pasa. Al
        // actualizar la tasa (open_day HOY), el pago Bs funciona.
        let test_path = PathBuf::from("test_bs_payment_tasa.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 0.0, 0.0).unwrap(); // el caso real: día sin tasa

        let sid = db.add_service("ORD-TASA-1", "Cliente", "0412-1", "Modelo X", "falla",
            "Software / Formateo", "[\"Software / Formateo\"]", 100.0, "Divisas (USD Cash)", "",
            0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();

        let err = db.add_service_payment(sid, 1000.0, "Pago Móvil", 0.0, "", "USD", "", "").unwrap_err().to_string();
        assert!(err.contains("tasa BCV"), "pago Bs sin tasa debe rechazarse: {err}");
        // F36: una devolución en Bs sin NINGÚN bolívar cobrado se rechaza por la regla por moneda
        // (antes se rechazaba solo por la tasa). El mensaje dice el tope en la moneda real.
        let err2 = db.add_service_refund(sid, 1000.0, "Pago Móvil", "", "USD", "").unwrap_err().to_string();
        assert!(err2.contains("Bs. 0,00") && err2.contains("en bolívares"),
                "refund Bs sin bolívares cobrados debe rechazarse por moneda: {err2}");
        // Y si SÍ entraron bolívares pero no hay ninguna tasa para valuarlos, el gate de tasa sigue
        // vigente (el neto se convertiría 1:1):
        db.open_day(0.0, 40.0, 45.0).unwrap();  // día con tasa → pago Bs válido
        let pid_bs = db.add_service_payment(sid, 2000.0, "Pago Móvil", 0.0, "", "USD", "", "").unwrap();
        db.conn.lock().unwrap().execute("UPDATE daily_closings SET tasa_bcv = 0", []).unwrap();
        let err3 = db.add_service_refund(sid, 1000.0, "Pago Móvil", "", "USD", "").unwrap_err().to_string();
        assert!(err3.contains("tasa BCV"), "refund Bs con bolívares pero sin tasa debe rechazarse: {err3}");
        db.conn.lock().unwrap().execute("UPDATE daily_closings SET tasa_bcv = 40.0", []).unwrap();
        // El pago de prueba se borra para que el resto del test mida SOLO el abono en dólares.
        db.delete_service_payment(pid_bs).unwrap();

        // USD no necesita tasa → pasa
        db.add_service_payment(sid, 30.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();
        let paid: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        assert!((paid - 30.0).abs() < 1e-9, "paid=30 solo USD, got {paid}");

        // Actualizar la tasa del día → el pago Bs ya funciona (30 + 810 @40.5 = 50)
        db.open_day(0.0, 40.5, 45.0).unwrap();
        db.add_service_payment(sid, 810.0, "Pago Móvil", 0.0, "", "USD", "", "").unwrap();
        let paid2: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        assert!((paid2 - 50.0).abs() < 1e-9, "30 USD + 810 Bs @40.5 = 50, got {paid2}");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_client_ci_and_address() {
        let test_path = PathBuf::from("test_client_ci.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Insertar cliente con ci, llamar de nuevo con el mismo ci → mismo id
        let id1 = db.add_or_find_client("Ana", "0412-111", "V-100", "Av 1").unwrap();
        let id2 = db.add_or_find_client("Ana", "0412-222", "V-100", "Av 2").unwrap();
        assert_eq!(id1, id2, "mismo ci → mismo cliente");
        // Los datos se actualizan al re-llamar
        let found = db.find_client_by_ci("V-100").unwrap().expect("cliente por ci");
        assert_eq!(found.phone.as_deref(), Some("0412-222"));
        assert_eq!(found.address.as_deref(), Some("Av 2"));

        // Ci nuevo (nombre distinto) → id distinto
        let id3 = db.add_or_find_client("Carlos", "", "V-200", "").unwrap();
        assert_ne!(id1, id3, "ci nuevo → otro cliente");

        // find_client_by_ci: encuentra y None para inexistente
        let found = db.find_client_by_ci("V-200").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "Carlos");
        assert!(db.find_client_by_ci("V-999").unwrap().is_none());

        // suggest_clients busca por ci
        let suggestions = db.suggest_clients("V-100", 5).unwrap();
        assert!(!suggestions.is_empty());
        assert_eq!(suggestions[0].ci.as_deref(), Some("V-100"));
        assert_eq!(suggestions[0].address.as_deref(), Some("Av 2"));

        // La cédula va PRIMERO que un nombre que también matchee el texto
        let idc = db.add_or_find_client("Alex Centro 100", "", "", "").unwrap();
        let by_digits = db.suggest_clients("100", 5).unwrap();
        assert_eq!(by_digits[0].ci.as_deref(), Some("V-100"), "cédula primero que nombre");
        assert!(by_digits.iter().any(|c| c.id == idc), "el nombre también aparece");

        // get_clients busca por ci y lo incluye en el resumen
        let list = db.get_clients("V-200").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].ci.as_deref(), Some("V-200"));

        // Sin ci: sigue funcionando por nombre
        let id4 = db.add_or_find_client("Pedro", "0414-000", "", "").unwrap();
        let id5 = db.add_or_find_client("Pedro", "", "", "").unwrap();
        assert_eq!(id4, id5, "mismo nombre → mismo cliente");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_pin_settings() {
        let test_path = PathBuf::from("test_pin.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Sin pin por defecto
        assert!(!db.get_pin_status().unwrap(), "sin pin al inicio");

        // Pines inválidos rechazados
        assert!(db.set_pin("12").is_err(), "2 dígitos inválido");
        assert!(db.set_pin("abcd").is_err(), "letras inválido");
        assert!(db.set_pin("12345").is_err(), "5 dígitos inválido");
        assert!(!db.get_pin_status().unwrap(), "sigue sin pin tras intentos inválidos");

        // Set + verify
        db.set_pin("1234").unwrap();
        assert!(db.get_pin_status().unwrap(), "status true tras set_pin");
        assert!(db.verify_pin("1234").unwrap(), "verify correcto");
        assert!(!db.verify_pin("9999").unwrap(), "verify incorrecto");

        // Remove con pin incorrecto falla; con el correcto elimina
        assert!(db.remove_pin("9999").is_err(), "remove con pin incorrecto falla");
        assert!(db.get_pin_status().unwrap(), "el pin sigue tras fallo");
        assert!(db.remove_pin("1234").unwrap(), "remove con pin correcto");
        assert!(!db.get_pin_status().unwrap(), "pin eliminado");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_pago_movil_detail() {
        let test_path = PathBuf::from("test_pm.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 0.0, 0.0).unwrap();

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Pago Móvil", "Cliente PM", None, "", 0.0, "REF-1234", "Bs", 0.0).unwrap();

        let detail = db.get_pago_movil_detail(&today).unwrap();
        assert_eq!(detail.len(), 1, "una fila de pago móvil hoy");
        assert_eq!(detail[0].reference.as_deref(), Some("REF-1234"));
        assert_eq!(detail[0].amount, 15.0);
        assert_eq!(detail[0].source, "Venta");

        // Otro día → vacío
        assert!(db.get_pago_movil_detail("2020-01-01").unwrap().is_empty());

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_sales_legacy_physical_order() {
        // Regresión: en DBs reales, client_id se agregó por ALTER TABLE → queda
        // DESPUÉS de notes en el orden físico. get_sales/get_client_sales deben
        // usar lista de columnas explícita (nunca SELECT * con mapping posicional).
        let test_path = PathBuf::from("test_sales_legacy.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        let conn = db.conn.lock().unwrap();
        conn.execute("DROP TABLE sales", []).unwrap();
        conn.execute(
            "CREATE TABLE sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                product_id INTEGER,
                product_name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price REAL NOT NULL,
                total REAL NOT NULL,
                payment_method TEXT NOT NULL,
                client_name TEXT,
                notes TEXT,
                client_id INTEGER REFERENCES clients(id),
                bank_fee_percent REAL DEFAULT 0,
                bank_fee_amount REAL DEFAULT 0,
                net_amount REAL,
                zelle_reference TEXT,
                currency TEXT,
                discount_amount REAL DEFAULT 0,
                voided_at TEXT,
                void_reason TEXT,
                -- F74: el IVA de la venta (una base vieja sin estas columnas se migra sola en init(),
                -- pero este fixture arma la tabla a mano y tiene que reflejar el orden físico real).
                iva_rate REAL NOT NULL DEFAULT 0,
                iva_mode TEXT NOT NULL DEFAULT ''
            )",
            [],
        ).unwrap();
        drop(conn);

        db.open_day(0.0, 0.0, 0.0).unwrap();
        let cid = db.add_or_find_client("Ana", "0412-111", "V-100", "Av 1").unwrap();
        db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Pago Móvil", "Ana", Some(cid), "nota de prueba", 0.0, "REF-99", "Bs", 0.0).unwrap();

        let sales = db.get_sales("", None, "", "").unwrap();
        assert_eq!(sales.len(), 1, "get_sales con orden físico legacy");
        assert_eq!(sales[0].client_id, Some(cid));
        assert_eq!(sales[0].notes.as_deref(), Some("nota de prueba"));
        assert_eq!(sales[0].zelle_reference.as_deref(), Some("REF-99"));
        // F70: una DB legacy (sin las columnas de anulación) se lee con `voided_at = None` → la venta vale
        assert!(sales[0].voided_at.is_none(), "sin columna de anulación la venta está vigente");

        let client_sales = db.get_client_sales(cid).unwrap();
        assert_eq!(client_sales.len(), 1, "get_client_sales con orden físico legacy");
        assert_eq!(client_sales[0].payment_method.as_deref(), Some("Pago Móvil"));

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_sales_search_by_ci_and_range() {
        // Feature 2026-08-02: ventas buscables por cédula (JOIN clients.ci) y
        // ventas/servicios filtrables por rango de fechas.
        let test_path = PathBuf::from("test_sales_ci_range.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        db.open_day(0.0, 0.0, 0.0).unwrap();
        let cid = db.add_or_find_client("Roberto", "0414-222", "V-24906999", "Av 2").unwrap();
        db.add_sale(None, "Pantalla Samsung A15", 1, 15.0, 15.0, "Divisas (USD Cash)", "Roberto", Some(cid), "", 0.0, "", "USD", 0.0).unwrap();
        db.add_sale(None, "Funda iPhone", 1, 5.0, 5.0, "Pago Móvil", "Cliente Suelto", None, "", 0.0, "", "Bs", 0.0).unwrap();

        // Búsqueda por cédula (con y sin formato) → encuentra la venta vinculada
        assert_eq!(db.get_sales("24906999", None, "", "").unwrap().len(), 1, "venta por cédula sin formato");
        assert_eq!(db.get_sales("V-24906999", None, "", "").unwrap().len(), 1, "venta por cédula formateada");
        assert!(db.get_sales("999999999", None, "", "").unwrap().is_empty(), "cédula inexistente");
        // client_ci viaja en la venta (JOIN)
        let venta = db.get_sales("24906999", None, "", "").unwrap();
        assert_eq!(venta[0].client_ci.as_deref(), Some("V-24906999"));
        assert_eq!(db.get_sales("Funda iPhone", None, "", "").unwrap()[0].client_ci, None, "venta sin cliente → sin cédula");

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let tomorrow = chrono::Local::now().checked_add_days(chrono::Days::new(1)).unwrap().format("%Y-%m-%d").to_string();
        let yesterday = chrono::Local::now().checked_sub_days(chrono::Days::new(1)).unwrap().format("%Y-%m-%d").to_string();

        // Rango de fechas en ventas
        assert_eq!(db.get_sales("", None, &today, &today).unwrap().len(), 2, "rango hoy → 2 ventas");
        assert_eq!(db.get_sales("", None, &yesterday, &yesterday).unwrap().len(), 0, "rango ayer → 0 ventas");
        assert_eq!(db.get_sales("", None, &today, &tomorrow).unwrap().len(), 2, "rango hoy→mañana → 2 ventas");

        // Rango de fechas en servicios (date_in)
        let sid = db.add_service("ORD-2001", "Roberto", "0414-222", "Samsung A15 A155", "Pantalla rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            20.0, "Efectivo Bs", "", 0.0, "", "Bs", "V-24906999", "", "{}", Some(cid), "", None, "", None, 0.0).unwrap();
        assert_eq!(db.get_services("", "", &today, &today, "").unwrap().len(), 1, "servicio de hoy en rango");
        assert_eq!(db.get_services("", "", &yesterday, &yesterday, "").unwrap().len(), 0, "servicio no aparece ayer");
        assert_eq!(db.get_services("24906999", "", "", "", "").unwrap().len(), 1, "servicio por cédula");
        assert_eq!(db.get_services("", "Por entregar", &today, &today, "").unwrap().len(), 1, "servicio por estado + rango");
        assert!(sid > 0);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_dashboard_analytics() {
        let test_path = PathBuf::from("test_dash_analytics.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 0.0, 0.0).unwrap();

        // Producto con categoría Pantalla
        let pid = db.add_product("Pantalla Samsung A15", Some(1), "Samsung", "A15 A155",
            "Incell", "[\"A15 A155\"]", 14.0, 17.5, 10, 2, 0.0).unwrap();
        db.add_sale(Some(pid), "Pantalla Samsung A15", 2, 17.5, 35.0, "Divisas (USD Cash)", "Ana", None, "", 0.0, "", "USD", 0.0).unwrap();
        db.add_sale(Some(pid), "Pantalla Samsung A15", 1, 17.5, 17.5, "Pago Móvil", "Ana", None, "", 0.0, "REF-1", "Bs", 0.0).unwrap();

        let a = db.get_dashboard_analytics().unwrap();
        assert_eq!(a.today_usd, 35.0, "venta USD de hoy");
        assert_eq!(a.today_bs, 17.5, "venta Bs de hoy");
        assert!(a.week_usd >= 35.0 && a.week_bs >= 17.5);
        assert_eq!(a.week_units, 3);
        assert_eq!(a.week_count, 2);
        assert_eq!(a.category_stats.len(), 1);
        assert_eq!(a.category_stats[0].category_name.as_deref(), Some("Pantalla"));
        assert_eq!(a.category_stats[0].units, 3);
        assert_eq!(a.category_stats[0].total_usd, 35.0);
        assert_eq!(a.category_stats[0].total_bs, 17.5);
        assert_eq!(a.top_models.len(), 1);
        assert_eq!(a.top_models[0].product_name.as_deref(), Some("Pantalla Samsung A15"));
        assert_eq!(a.top_models[0].units, 3);
        assert!(a.product_count >= 1 && a.sale_count >= 2 && a.client_count >= 0);
        assert!(a.last_sale.is_some());
        assert!(a.last_activity.is_some());

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_dashboard_analytics_punto_neto() {
        // D1 (2026-08-18): "Cobrado Servicios Hoy" debe usar el NETO del punto
        // (mismo criterio que el Libro Diario) — antes sumaba el BRUTO ($70 vs $69.30).
        let test_path = PathBuf::from("test_dash_punto_neto.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        // Pago de $100 por Punto (comisión 3.5%) → neto $96.50
        let sid = db.add_service("NET-1", "Cliente", "", "M1", "f", "Cambio batería",
            "[\"Cambio batería\"]", 100.0, "Punto de Venta ($)", "", 3.5, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid, 100.0, "Punto de Venta ($)", 3.5, "", "USD", "", "").unwrap();
        // Pago directo de $20 en efectivo → neto $20 (sin comisión)
        let sid2 = db.add_service("NET-2", "Cliente2", "", "M2", "g", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 20.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid2, 20.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();

        let a = db.get_dashboard_analytics().unwrap();
        assert!((a.service_income_today_usd - 116.5).abs() < 1e-9,
            "cobrado servicios HOY debe ser NETO (96.5 + 20), got {}", a.service_income_today_usd);

        // Coherencia con el Libro: pos_net del día = 96.5
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let totals = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(totals[0].pos_net_usd, 96.5, "el libro usa neto");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_paid_amount_rounded_no_float_noise() {
        // D3 (2026-08-18): paid_amount no debe arrastrar ruido flotante
        // (60.000323284571245) al convertir Bs→USD — ROUND(...,4).
        let test_path = PathBuf::from("test_paid_rounded.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 773.3125, 0.0).unwrap();

        let sid = db.add_service("RND-1", "Cliente", "", "M1", "f", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 60.0, "Pago Móvil", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        // Bs 46.399 @ 773.3125 = $60.00032328... → ROUND(...,4) = $60.0003 (sin ruido flotante)
        db.add_service_payment(sid, 46399.0, "Pago Móvil", 0.0, "", "USD", "", "").unwrap();

        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert!((svc.paid_amount - 60.0003).abs() < 1e-9,
            "paid_amount redondeado a 4 decimales (60.0003, sin 60.000323284571245), got {}", svc.paid_amount);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_daily_totals_currency() {
        // Regresión: grand_total sumaba Bs como USD (bug 2026-08-02: "$2076" falsos).
        // Verifica el desglose por moneda (grand_usd/grand_bs), la tasa BCV por día,
        // y que el cierre guarde total_usd/total_bs y grand_total en USD equivalente.
        let test_path = PathBuf::from("test_daily_totals_currency.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(10.0, 40.5, 45.0).unwrap();

        // Venta en Bs (Pago Móvil) — el frontend guarda total en Bs con currency 'VES'
        db.add_sale(None, "Pantalla Test", 1, 100.0, 100.0, "Pago Móvil", "Cliente", None, "", 0.0, "", "VES", 0.0).unwrap();
        // Punto de Venta en Bs (cobro real de Bs 35.000 con comisión 2%) → neto Bs 34.300
        db.add_sale(None, "Venta Punto Bs", 1, 35000.0, 35000.0, "Punto de Venta (Bs)", "Cliente", None, "", 2.0, "", "VES", 0.0).unwrap();
        // Punto de Venta en USD (cobro real de $100) → neto $100
        db.add_sale(None, "Venta Punto USD", 1, 100.0, 100.0, "Punto de Venta ($)", "Cliente", None, "", 0.0, "", "USD", 0.0).unwrap();
        // Abono en Bs (Efectivo Bs) + abono en USD (Divisas)
        let sid = db.add_service("ORD-TEST-LEDGER", "Cliente", "0412-1", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            50.0, "Pago Móvil", "", 0.0, "", "VES", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid, 100.0, "Efectivo Bs", 0.0, "", "USD", "abono bs", "").unwrap();
        db.add_service_payment(sid, 50.0, "Divisas (USD Cash)", 0.0, "", "USD", "abono usd", "").unwrap();

        let totals = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(totals.len(), 1, "un día con movimientos");
        let t = &totals[0];
        assert_eq!(t.pos_net_usd, 100.0, "neto del punto en USD");
        assert_eq!(t.pos_net_bs, 34300.0, "neto del punto en Bs (35.000 - 2%)");
        assert_eq!(t.pos_charged_bs, 35000.0, "cargado del punto en Bs");
        assert_eq!(t.pos_charged_usd, 100.0, "cargado del punto en USD");
        assert_eq!(t.grand_usd, 150.0, "desglose USD (punto $100 + divisas 50)");
        assert_eq!(t.grand_bs, 34500.0, "desglose Bs (PM 100 + punto Bs 34.300 + abono 100)");
        assert_eq!(t.pago_movil_total, 100.0);
        assert_eq!(t.cash_bs, 100.0);
        assert_eq!(t.usd_cash_total, 50.0);
        assert_eq!(t.tasa_bcv, 40.5, "tasa del día abierto");
        assert!((t.grand_total - (150.0 + 34500.0 / 40.5)).abs() < 1e-9, "grand_total en USD equivalente, got {}", t.grand_total);

        // Cierre: guarda desglose + grand_total correcto
        db.close_day(&today, "cierre moneda", 10.0, 40.5, 45.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let closings = db.get_daily_closings().unwrap();
        let c = closings.iter().find(|x| x.close_date == today).unwrap();
        assert_eq!(c.total_usd, 150.0, "cierre guarda total_usd");
        assert_eq!(c.total_bs, 34500.0, "cierre guarda total_bs");
        assert!((c.grand_total - (150.0 + 34500.0 / 40.5)).abs() < 1e-9, "grand_total del cierre en USD equiv, got {}", c.grand_total);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_presumed_counter_charge_uses_the_day_rate() {
        // REVISIÓN ADVERSARIAL F39 (2026-09-17) — BLOQUEANTE: una orden ENTREGADA **sin ningún pago
        // registrado** entra a la caja con el monto del formulario (la presunción «el cliente pagó en el
        // mostrador y nadie lo anotó»). Ese monto es SIEMPRE en DÓLARES, pero el método del formulario
        // puede ser en bolívares: se sumaba el número crudo al bucket de Bs, así que $20 de una orden
        // con método «Efectivo Bs» quedaban contados como **Bs. 20** en vez de Bs. 14.975,80 (tasa
        // 748,79) → el esperado del cajón en Bs quedaba 749 veces corto y la «Diferencia Bs.» de F39
        // mostraba un descuadre inventado. Ahora se convierte con la tasa del DÍA DE LA ENTREGA.
        let test_path = PathBuf::from("test_presumed_counter_charge.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(0.0, 748.79, 0.0).unwrap();

        // Orden en Bs SIN pagos, entregada hoy (la presunción)
        let sid = db.add_service("ORD-PRESUME-BS", "Cliente", "0412-1", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            20.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.conn.lock().unwrap()
            .execute("UPDATE services SET status='Entregado', date_out=?1 WHERE id=?2", params![today, sid]).unwrap();

        let t = db.get_daily_totals(&today, &today).unwrap();
        let t = t.first().expect("el día tiene la orden presumida");
        assert!((t.cash_bs - 20.0 * 748.79).abs() < 0.01,
            "20 dólares con método Bs NO pueden contarse como Bs. 20 (esperado Bs. {}, got {})", 20.0 * 748.79, t.cash_bs);
        assert_eq!(t.usd_cash_total, 0.0, "no se cuela en el bolsillo de dólares");

        // La MISMA orden con método en dólares sí entra cruda (no hay nada que convertir)
        let sid2 = db.add_service("ORD-PRESUME-USD", "Cliente", "0412-2", "Samsung A16", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            20.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.conn.lock().unwrap()
            .execute("UPDATE services SET status='Entregado', date_out=?1 WHERE id=?2", params![today, sid2]).unwrap();
        let t = db.get_daily_totals(&today, &today).unwrap();
        let t = t.first().unwrap();
        assert_eq!(t.usd_cash_total, 20.0, "una orden en $ entra cruda a las divisas");
        assert!((t.cash_bs - 20.0 * 748.79).abs() < 0.01, "y los Bs. siguen siendo solo los de la orden en Bs.");

        // SIN TASA no se inventa un número en Bs.: la presunción no entra a la caja (invariante
        // «nada estimado»). La orden en $ sigue entrando.
        db.conn.lock().unwrap().execute("UPDATE daily_closings SET tasa_bcv = 0", []).unwrap();
        let sin_tasa = db.get_daily_totals(&today, &today).unwrap();
        let sin_tasa = sin_tasa.first().unwrap();
        assert_eq!(sin_tasa.cash_bs, 0.0, "sin tasa no se presume un monto en bolívares");
        assert_eq!(sin_tasa.usd_cash_total, 20.0, "lo que no necesita tasa sigue contando");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_daily_totals_resilient_to_text_net_amount() {
        // Regresión 2026-08-08: un INSERT externo (seed dev) metió 'REF-VENTA-01'
        // (TEXT) en sales.net_amount → get_daily_totals crasheaba con
        // InvalidColumnType(4) y el dialog Cerrar Día mostraba todo en $0.00.
        // CAST(... AS REAL) hace la query resiliente (texto → 0.0, no crash).
        let test_path = PathBuf::from("test_totals_text_net.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(0.0, 40.5, 45.0).unwrap();

        db.add_sale(None, "Venta OK", 1, 5.0, 5.0, "Divisas (USD Cash)", "Cliente", None, "", 0.0, "", "USD", 0.0).unwrap();
        // Simular la fila corrupta del seed: net_amount con texto (INSERT directo)
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sales (date, product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 0, 0, ?8, ?9, ?10)",
            params![format!("{} 10:00:00", today), "Cargador Rapido 33W", 1, 10.0, 7487.9, "Pago Movil", "Maria", "REF-VENTA-01", "VES", "VES"],
        ).unwrap();
        drop(conn);

        let totals = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(totals.len(), 1, "no debe crashear con fila corrupta");
        let t = &totals[0];
        assert_eq!(t.usd_cash_total, 5.0, "la venta sana suma normal");
        assert_eq!(t.pago_movil_total, 7487.9, "el bucket usa total (columna REAL, sana)");
        assert_eq!(t.grand_bs, 7487.9, "grand_bs usa total, no el net_amount corrupto");
        assert!((t.grand_total - (5.0 + 7487.9 / 40.5)).abs() < 1e-9, "grand_total coherente, got {}", t.grand_total);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_refund() {
        // Reembolso: pago NEGATIVO en service_payments → resta del paid_amount,
        // del Libro Diario (método del día) y del saldo visible del servicio.
        let test_path = PathBuf::from("test_refund.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(0.0, 40.5, 45.0).unwrap();

        // Servicio de $100 con $60 abonados en Divisas (USD)
        let sid = db.add_service("ORD-REF-1", "Cliente", "0412-1", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid, 60.0, "Divisas (USD Cash)", 0.0, "", "USD", "Abono", "").unwrap();
        let paid_before: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        assert_eq!(paid_before, 60.0);

        // Reembolso de $20 en Divisas → paid_amount baja a 40
        let rpid = db.add_service_refund(sid, 20.0, "Divisas (USD Cash)", "", "USD", "Cliente devolvió").unwrap();
        assert!(rpid > 0);
        let payments = db.get_service_payments(sid).unwrap();
        assert_eq!(payments.len(), 2);
        assert_eq!(payments[1].amount, -20.0, "reembolso se guarda NEGATIVO");
        assert_eq!(payments[1].notes.as_deref(), Some("Devolución: Cliente devolvió"), "nota con prefijo");
        assert_eq!(payments[1].currency.as_deref(), Some("USD"), "moneda del método");
        let paid_after: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        assert!((paid_after - 40.0).abs() < 1e-9, "paid_amount resta el reembolso: {paid_after}");

        // Libro Diario: el reembolso resta del método del día (Divisas 60 - 20 = 40)
        let totals = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(totals.len(), 1);
        assert_eq!(totals[0].usd_cash_total, 40.0, "reembolso resta del total del día");
        assert_eq!(totals[0].grand_usd, 40.0);

        // Reembolso en Bs: resta también (conversión Bs→USD con la tasa del día)
        let pid_bs = db.add_service_payment(sid, 1000.0, "Efectivo Bs", 0.0, "", "USD", "abono bs", "").unwrap();
        assert!(pid_bs > 0);
        db.add_service_refund(sid, 400.0, "Efectivo Bs", "", "USD", "").unwrap();
        let paid_final: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        let expected: f64 = ((40.0_f64 + (1000.0 - 400.0) / 40.5) * 10000.0).round() / 10000.0;
        assert!((paid_final - expected).abs() < 1e-9, "paid_final={paid_final} expected={expected}");
        assert_eq!(payments[1].amount, -20.0, "el reembolso Bs queda negativo en service_payments");

        // Validaciones: monto 0 o negativo → error; día cerrado → error
        let err = db.add_service_refund(sid, 0.0, "Divisas (USD Cash)", "", "USD", "").unwrap_err().to_string();
        assert!(err.contains("mayor a 0"), "monto inválido rechazado: {err}");
        db.close_day(&today, "cierre", 0.0, 40.5, 45.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let err2 = db.add_service_refund(sid, 5.0, "Divisas (USD Cash)", "", "USD", "").unwrap_err().to_string();
        assert!(err2.contains("Debe abrir el día"), "día cerrado bloquea reembolso: {err2}");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_refund_ledger_full() {
        // Flujo COMPLETO devolución + Libro Diario (2026-08-14):
        // día abierto → servicio con pantalla exacta → entregar (descuenta stock) →
        // abonos USD + Bs → reembolsos (USD + Bs) → totals del día → cerrar día
        // cuadra → transición a Devuelto devuelve el stock.
        let test_path = PathBuf::from("test_refund_ledger.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(0.0, 40.5, 45.0).unwrap();

        // Producto pantalla con stock 5 + servicio con screen_product_id
        let pid = db.add_product("Pantalla Test", Some(1), "Samsung", "A15", "Incell",
            "[\"Samsung A15\"]", 8.0, 15.0, 5, 2, 0.0).unwrap();
        let sid = db.add_service("ORD-REF2", "Cliente", "0412-1", "Samsung A15", "Rota",
            "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "V-1", "", "",
            None, "", None, "", Some(pid), 0.0).unwrap();

        // 1) Entregar → descuenta la pantalla exacta (stock 5 → 4)
        db.update_service(sid, "Cliente", "0412-1", "Samsung A15", "Rota",
            "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", "Entregado", "", 0.0, "", "USD",
            "V-1", "", "", "", None, "", Some(pid), 0.0).unwrap();
        let stock: i64 = db.conn.lock().unwrap()
            .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap();
        assert_eq!(stock, 4, "entregar descuenta la pantalla exacta");

        // 2) Abonos: $30 Divisas + Bs 810 Efectivo Bs (= $20 @ 40.5) → paid = 50
        db.add_service_payment(sid, 30.0, "Divisas (USD Cash)", 0.0, "", "USD", "abono usd", "").unwrap();
        db.add_service_payment(sid, 810.0, "Efectivo Bs", 0.0, "", "USD", "abono bs", "").unwrap();
        let paid: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        assert!((paid - 50.0).abs() < 1e-9, "paid=50 tras abonos, got {paid}");

        let totals = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(totals[0].usd_cash_total, 30.0, "divisas del día = 30");
        assert_eq!(totals[0].cash_bs, 810.0, "efectivo bs del día = 810");
        assert_eq!(totals[0].grand_usd, 30.0);
        assert_eq!(totals[0].grand_bs, 810.0);

        // 3) GUARD backend (F36, por moneda): no se devuelve más de lo que entró EN ESA MONEDA
        let err = db.add_service_refund(sid, 60.0, "Divisas (USD Cash)", "", "USD", "").unwrap_err().to_string();
        assert!(err.contains("hasta $30.00"), "devuelve más dólares de los que entraron → rechazado: {err}");
        let err2 = db.add_service_refund(sid, 2500.0, "Efectivo Bs", "", "USD", "").unwrap_err().to_string();
        assert!(err2.contains("hasta Bs. 810,00"), "refund Bs excedente → rechazado en bolívares: {err2}");

        // 4) Reembolso total: Bs 810 (→0) y $30 (→0); paid_amount termina en 0
        db.add_service_refund(sid, 810.0, "Efectivo Bs", "", "USD", "todo el efectivo").unwrap();
        db.add_service_refund(sid, 30.0, "Divisas (USD Cash)", "", "USD", "todo en divisas").unwrap();
        let paid_final: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        assert!(paid_final.abs() < 1e-9, "paid_amount 0 tras devolver todo, got {paid_final}");

        let totals = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(totals[0].usd_cash_total, 0.0, "refunds restan por método USD");
        assert_eq!(totals[0].cash_bs, 0.0, "refunds restan por método Bs");
        assert_eq!(totals[0].grand_usd, 0.0);
        assert_eq!(totals[0].grand_bs, 0.0);

        // 5) Marcar Devuelto (transición Entregado → Devuelto) → devuelve el stock y limpia date_out
        db.update_service(sid, "Cliente", "0412-1", "Samsung A15", "Rota",
            "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "2026-08-13", "Devuelto", "", 0.0, "", "USD",
            "V-1", "", "", "", None, "", Some(pid), 0.0).unwrap();
        let stock2: i64 = db.conn.lock().unwrap()
            .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap();
        assert_eq!(stock2, 5, "Devuelto devuelve el stock de la pantalla");
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.status.as_deref(), Some("Devuelto"), "status → Devuelto");
        assert!(svc.date_out.is_none(), "date_out limpio al devolver (fuera de garantía)");

        // 6) Cerrar el día: sin movimientos netos → arqueo 0 cuadra (difference ≈ 0)
        let close_id = db.close_day(&today, "cierre con devoluciones", 0.0, 40.5, 45.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let closing: crate::db::DailyClosing = db.conn.lock().unwrap()
            .query_row(
                "SELECT id, close_date, pos_charged, pos_fees, pos_net, pos_settled, pos_settled_bs,
                        cash_usd, cash_bs, zelle_total, pago_movil_total, transfer_bs_total, usd_cash_total,
                        grand_total, is_closed, closed_at, notes, tasa_bcv, tasa_eur, opened_at,
                        initial_cash_usd, actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs,
                        actual_zelle, actual_pago_movil, actual_transfer_bs, difference, total_usd, total_bs,
                        drawer_adjust_usd, drawer_adjust_bs
                 FROM daily_closings WHERE id=?1",
                params![close_id],
                |r| Ok(crate::db::DailyClosing {
                    id: r.get(0)?, close_date: r.get(1)?, pos_charged: r.get(2)?, pos_fees: r.get(3)?,
                    pos_net: r.get(4)?, pos_settled: r.get(5)?, pos_settled_bs: r.get(6)?,
                    cash_usd: r.get(7)?, cash_bs: r.get(8)?, zelle_total: r.get(9)?,
                    pago_movil_total: r.get(10)?, transfer_bs_total: r.get(11)?, usd_cash_total: r.get(12)?,
                    grand_total: r.get(13)?, is_closed: r.get(14)?, closed_at: r.get(15)?, notes: r.get(16)?,
                    tasa_bcv: r.get(17)?, tasa_eur: r.get(18)?, opened_at: r.get(19)?,
                    initial_cash_usd: r.get(20)?, actual_cash_usd: r.get(21)?, actual_cash_bs: r.get(22)?,
                    actual_punto_usd: r.get(23)?, actual_punto_bs: r.get(24)?, actual_zelle: r.get(25)?,
                    actual_pago_movil: r.get(26)?, actual_transfer_bs: r.get(27)?, difference: r.get(28)?,
                    total_usd: r.get(29)?, total_bs: r.get(30)?,
                    drawer_adjust_usd: r.get(31)?, drawer_adjust_bs: r.get(32)?,
                })).unwrap();
        assert_eq!(closing.total_usd, 0.0, "total_usd del cierre refleja las devoluciones");
        assert_eq!(closing.total_bs, 0.0, "total_bs del cierre refleja las devoluciones");
        assert!(closing.difference.abs() < 1e-9, "arqueo 0 cuadra tras devolver todo, diff={}", closing.difference);
        assert_eq!(closing.grand_total, 0.0);

        // 7) Reembolso con día cerrado → bloqueado
        let err3 = db.add_service_refund(sid, 5.0, "Divisas (USD Cash)", "", "USD", "").unwrap_err().to_string();
        assert!(err3.contains("Debe abrir el día"), "día cerrado bloquea reembolso: {err3}");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_warranty_dates() {
        // Garantía: al entregar sin fecha → date_out = hoy; al reabrir → se limpia;
        // al re-entregar → nueva fecha (garantía de 7 días reinicia).
        let test_path = PathBuf::from("test_warranty.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let sid = db.add_service("ORD-WARR-1", "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            25.0, "Efectivo Bs", "", 0.0, "", "USD", "V-100", "", "", None, "", None, "", None, 0.0).unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        // 1) Entregar sin fecha → se asigna hoy
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            25.0, "Efectivo Bs", "", "Entregado", "", 0.0, "", "USD", "V-100", "", "", "", None, "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.date_out.as_deref(), Some(today.as_str()), "date_out auto = hoy al entregar");

        // 2) Reabrir (garantía / reclamo) → date_out se limpia
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            25.0, "Efectivo Bs", "2026-07-30", "Recibido", "", 0.0, "", "USD", "V-100", "", "", "", None, "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert!(svc.date_out.is_none(), "date_out limpio al reabrir, got {:?}", svc.date_out);

        // 3) Re-entregar sin fecha → nueva fecha de hoy
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            25.0, "Efectivo Bs", "", "Entregado", "", 0.0, "", "USD", "V-100", "", "", "", None, "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.date_out.as_deref(), Some(today.as_str()), "nueva entrega → fecha nueva");

        // 4) Editar sin cambiar de Entregado → conserva la fecha
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            30.0, "Efectivo Bs", "", "Entregado", "nota", 0.0, "", "USD", "V-100", "", "", "", None, "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.date_out.as_deref(), Some(today.as_str()), "sigue entregado → conserva fecha");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_initial_cash_not_in_totals() {
        // Regresión (2026-08-02): la apertura ($50) es efectivo semilla — se guarda en el cierre
        // pero NUNCA debe sumarse a las ventas del día ni al Dashboard ni a los totales.
        let test_path = PathBuf::from("test_initial_cash.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(50.0, 40.5, 45.0).unwrap();

        // Venta real de $30
        db.add_sale(None, "Pantalla Test", 1, 30.0, 30.0, "Divisas (USD Cash)", "Cliente", None, "", 0.0, "", "USD", 0.0).unwrap();

        // Totales del día = SOLO la venta, la apertura no cuenta
        let totals = db.get_daily_totals(&today, &today).unwrap();
        let t = totals.iter().find(|x| x.date == today).unwrap();
        assert_eq!(t.usd_cash_total, 30.0, "Divisas del día = solo ventas (sin apertura)");
        assert_eq!(t.grand_usd, 30.0, "grand_usd sin apertura");

        // Dashboard: Ventas Hoy sin apertura
        let a = db.get_dashboard_analytics().unwrap();
        assert_eq!(a.today_usd, 30.0, "dashboard no suma apertura");

        // Cierre: apertura guardada pero NO en totales
        let closing_id = db.close_day(&today, "cierre test", 50.0, 40.5, 45.0,
            30.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        assert!(closing_id > 0);
        let closings = db.get_daily_closings().unwrap();
        let c = closings.iter().find(|x| x.close_date == today).unwrap();
        assert_eq!(c.initial_cash_usd, 50.0, "apertura guardada");
        assert_eq!(c.total_usd, 30.0, "cierre total_usd = ventas sin apertura");
        assert_eq!(c.usd_cash_total, 30.0, "cierre divisas sin apertura");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_void_sale_returns_stock_and_book() {
        // F70 (bloqueante A3 de la auditoría de entrega): una venta mal tecleada quedaba en la caja de
        // ese día PARA SIEMPRE (no existía update_sale/delete_sale) y una pantalla vendida y devuelta
        // no volvía al stock. Ahora se ANULA: la fila queda marcada, el stock vuelve, el cliente deja de
        // deber su compra y el libro guarda el contra-asiento con autor y motivo.
        let test_path = PathBuf::from("test_void_sale.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.set_pin("1234").unwrap();
        db.verify_pin("1234").unwrap();   // sesión de dueño (el gate del comando lo exige)
        db.open_day(0.0, 40.0, 45.0).unwrap();

        let pid = db.add_product("Pantalla Anulable", Some(1), "Tecno", "Spark 20", "", "[\"Spark 20\"]",
                                 10.0, 25.0, 5, 0, 0.0).unwrap();
        let cid = db.add_client("Cliente Anula", "0412-0000000", "", "").unwrap();
        db.add_sale(Some(pid), "Pantalla Anulable", 1, 25.0, 25.0, "Divisas (USD Cash)", "Cliente Anula",
                    Some(cid), "venta de prueba", 0.0, "", "USD", 0.0).unwrap();
        let venta: i64 = db.conn.lock().unwrap()
            .query_row("SELECT id FROM sales WHERE notes='venta de prueba'", [], |r| r.get(0)).unwrap();

        let stock_antes: i64 = db.conn.lock().unwrap()
            .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap();
        assert_eq!(stock_antes, 4, "la venta descontó 1 del stock");
        let t_antes = db.get_daily_totals(&today, &today).unwrap();
        assert!((t_antes[0].usd_cash_total - 25.0).abs() < 1e-9, "la venta entra en el arqueo del día");

        // ANULAR (con motivo)
        db.void_sale(venta, "precio mal tecleado").unwrap();

        let stock_despues: i64 = db.conn.lock().unwrap()
            .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap();
        assert_eq!(stock_despues, 5, "anular DEVUELVE la unidad al stock");
        let mov: (String, i64, String) = db.conn.lock().unwrap()
            .query_row("SELECT type, quantity, reason FROM inventory_movements WHERE reference=?1 ORDER BY id DESC LIMIT 1",
                       params![format!("Venta #{}", venta)], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(mov.0, "entrada", "el movimiento de inventario es de ENTRADA");
        assert_eq!(mov.1, 1);
        assert_eq!(mov.2, "Anulación de venta");

        // La fila NO se borra: queda marcada con su motivo
        let fila: (Option<String>, Option<String>) = db.conn.lock().unwrap()
            .query_row("SELECT voided_at, void_reason FROM sales WHERE id=?1", params![venta],
                       |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert!(fila.0.is_some(), "la venta queda marcada con su fecha de anulación");
        assert_eq!(fila.1.as_deref(), Some("precio mal tecleado"), "y con su motivo");
        let listadas = db.get_sales("", None, "", "").unwrap();
        assert!(listadas.iter().any(|s| s.id == venta && s.voided_at.is_some()), "sigue en la lista (tachada)");

        // El contra-asiento del libro: mismo método/moneda/monto, signo invertido, con autor y motivo
        let contra = db.get_cash_movements(&today, &today, None, 100).unwrap()
            .into_iter().find(|m| m.r#type == "venta_anulada").expect("queda el contra-asiento");
        assert_eq!(contra.method, "Divisas (USD Cash)");
        assert_eq!(contra.amount, 25.0);
        assert_eq!(contra.sign, -1);
        assert_eq!(contra.user_name, "Master", "con el AUTOR de quien anuló");
        assert_eq!(contra.note, "precio mal tecleado");

        // La caja y el cliente dejan de contarla (el día se queda sin movimientos → no hay fila de totales)
        let t_despues = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(t_despues.first().map(|t| t.usd_cash_total).unwrap_or(0.0), 0.0,
            "el arqueo del día ya NO la cuenta");
        let total_cliente: f64 = db.conn.lock().unwrap()
            .query_row("SELECT total_spent FROM clients WHERE id=?1", params![cid], |r| r.get(0)).unwrap();
        assert_eq!(total_cliente, 0.0, "el cliente tampoco la debe");
        let stats = db.get_sales_stats(30).unwrap();
        assert!(!stats.iter().any(|s| s.product_name.as_deref() == Some("Pantalla Anulable")),
            "el top de productos no la cuenta");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_void_sale_reglas() {
        // Las guardas de F70: motivo obligatorio, venta inexistente, doble anulación, día cerrado (con
        // el camino del remedio) y día sin turno abierto. Y el día del contra-asiento es el DE LA VENTA.
        let test_path = PathBuf::from("test_void_sale_reglas.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let ayer = (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
        db.set_pin("1234").unwrap();
        db.verify_pin("1234").unwrap();
        db.open_day(0.0, 40.0, 45.0).unwrap();
        db.add_sale(None, "Forro", 1, 5.0, 5.0, "Divisas (USD Cash)", "", None, "", 0.0, "", "USD", 0.0).unwrap();
        let venta: i64 = db.conn.lock().unwrap()
            .query_row("SELECT MAX(id) FROM sales", [], |r| r.get(0)).unwrap();

        // Motivo obligatorio
        let err = db.void_sale(venta, "   ").unwrap_err().to_string();
        assert!(err.contains("por qué"), "sin motivo no se anula: {err}");
        // Venta inexistente
        assert!(db.void_sale(999999, "no existe").unwrap_err().to_string().contains("no existe"));
        // Anular una vez: bien; la segunda se rechaza
        db.void_sale(venta, "mal tecleada").unwrap();
        let err2 = db.void_sale(venta, "otra vez").unwrap_err().to_string();
        assert!(err2.contains("ya está anulada"), "no se anula dos veces: {err2}");

        // Día CERRADO: se rechaza y el mensaje dice el camino real (↺ → anular → volver a cerrar)
        db.add_sale(None, "Cable", 1, 3.0, 3.0, "Divisas (USD Cash)", "", None, "segunda", 0.0, "", "USD", 0.0).unwrap();
        let venta2: i64 = db.conn.lock().unwrap()
            .query_row("SELECT id FROM sales WHERE notes='segunda'", [], |r| r.get(0)).unwrap();
        db.close_day(&today, "", 0.0, 40.0, 45.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let err3 = db.void_sale(venta2, "mal").unwrap_err().to_string();
        assert!(err3.contains("ya está CERRADO"), "un día cerrado no se anula a ciegas: {err3}");
        assert!(err3.contains("↺"), "y el mensaje dice el remedio: {err3}");

        // El día del contra-asiento es el DE LA VENTA (no el de hoy): se retrodata la venta COMO LO
        // HARÍA EL SISTEMA (la fila y su movimiento del libro) y se abre un turno de ese día.
        {
            let c = db.conn.lock().unwrap();
            c.execute("UPDATE sales SET date=?1 WHERE id=?2", params![format!("{} 10:00:00", ayer), venta2]).unwrap();
            c.execute("UPDATE cash_movements SET date=?1, day=?2 WHERE sale_id=?3 AND type='venta'",
                      params![format!("{} 10:00:00", ayer), ayer, venta2]).unwrap();
            c.execute("INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, is_closed) VALUES (?1, 0, 40.0, 0)",
                      params![ayer]).unwrap();
        }
        db.void_sale(venta2, "de ayer").unwrap();
        let libro_ayer = db.get_cash_movements(&ayer, &ayer, None, 50).unwrap();
        assert!(libro_ayer.iter().any(|m| m.r#type == "venta_anulada" && m.sale_id == Some(venta2)),
            "el contra-asiento de esa venta cae en el día de la venta, no en el de hoy: {:?}",
            libro_ayer.iter().map(|m| (&m.r#type, &m.day, m.sale_id)).collect::<Vec<_>>());
        let libro_hoy = db.get_cash_movements(&today, &today, None, 50).unwrap();
        assert!(!libro_hoy.iter().any(|m| m.r#type == "venta_anulada" && m.sale_id == Some(venta2)),
            "y no en el de hoy (descuadraría un día que no la vendió)");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_open_day_no_reabre_un_dia_cerrado() {
        // F69 (revisión adversarial, BLOQUEANTE): `open_day` volvía a abrir el día de HOY si ya estaba
        // cerrado (el `ON CONFLICT ... SET is_closed=0`), reescribiendo el fondo y la tasa y borrando
        // la apertura del libro. Con el día reabierto, `require_open_day` dejaba anotar ventas y abonos
        // en un arqueo YA FIRMADO (y un cierre guardado no se recalcula).
        let test_path = PathBuf::from("test_open_day_cerrado.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        db.open_day(50.0, 40.0, 45.0).unwrap();
        db.add_sale(None, "Forro", 1, 10.0, 10.0, "Divisas (USD Cash)", "C", None, "", 0.0, "", "USD", 0.0).unwrap();
        db.close_day(&today, "cierre", 0.0, 40.0, 45.0, 60.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let fondo_cerrado: f64 = db.get_daily_closings().unwrap()[0].initial_cash_usd;

        // Intentar «abrir el día» otra vez: se RECHAZA y el cierre queda intacto
        let err = db.open_day(99999.0, 1.0, 0.0).unwrap_err().to_string();
        assert!(err.contains("ya está CERRADO"), "el mensaje dice que está cerrado y el camino: {err}");
        assert!(err.contains("↺"), "y nombra el botón del remedio: {err}");
        assert!(db.get_active_day().unwrap().is_none(), "el día sigue CERRADO (no hay turno abierto)");
        assert_eq!(db.get_daily_closings().unwrap()[0].initial_cash_usd, fondo_cerrado,
            "el fondo del día auditado no se reescribe");
        // Y el mostrador no puede anotar nada de ese día (el gate real)
        let err2 = db.add_sale(None, "Forro", 1, 5.0, 5.0, "Divisas (USD Cash)", "C", None, "", 0.0, "", "USD", 0.0)
            .unwrap_err().to_string();
        assert!(err2.contains("Debe abrir el día"), "sin turno abierto no se vende: {err2}");

        // El camino del dueño SÍ funciona: ↺ (reopen_day) y volver a cerrar
        db.reopen_day(&today).unwrap();
        assert!(db.get_active_day().unwrap().is_some(), "reabrir con ↺ deja el turno abierto");
        db.add_sale(None, "Forro", 1, 5.0, 5.0, "Divisas (USD Cash)", "C", None, "", 0.0, "", "USD", 0.0).unwrap();
        assert!(db.close_day(&today, "recierre", 0.0, 40.0, 45.0, 65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).is_ok());

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_contra_asiento_va_al_dia_del_movimiento() {
        // F69 — BUG CAZADO EN LA 2ª CORRIDA EN VIVO: `reverse_book_entry` escribía el asiento espejo
        // con la fecha de HOY. Con un gasto de un día anterior, el día original seguía descontando ese
        // gasto del cajón PARA SIEMPRE y el día de hoy se llevaba un «+monto» de un gasto que nunca
        // tuvo (el arqueo de los dos días mentía). El espejo tiene que caer en el día del original.
        let test_path = PathBuf::from("test_contra_asiento_dia.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let hoy = chrono::Local::now().format("%Y-%m-%d").to_string();
        let ayer = (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();

        // Un gasto de AYER pagado del cajón (el operario lo anota retroactivo)
        let id = db.add_expense(&ayer, "Otro", 15.0, "USD", "de ayer", "Divisas (USD Cash)").unwrap();
        assert_eq!(db.drawer_adjustments(&ayer).unwrap().gastos_usd, 15.0, "el gasto de ayer baja el cajón de AYER");
        assert_eq!(db.drawer_adjustments(&hoy).unwrap().gastos_usd, 0.0, "y NO toca el cajón de hoy");

        // Se borra HOY: el espejo tiene que caer en AYER para que el ajuste de ayer vuelva a 0…
        db.delete_expense(id).unwrap();
        assert_eq!(db.drawer_adjustments(&ayer).unwrap().gastos_usd, 0.0,
            "el asiento espejo del gasto de ayer cae en AYER (si no, ayer descuenta para siempre)");
        assert_eq!(db.drawer_adjustments(&hoy).unwrap().gastos_usd, 0.0,
            "y hoy no recibe un gasto que nunca tuvo (antes quedaba un «+15» inventado)");
        let espejo = db.get_cash_movements(&ayer, &ayer, None, 50).unwrap()
            .into_iter().find(|m| m.r#type == "gasto_anulado").expect("queda el contra-asiento");
        assert_eq!(espejo.amount, 15.0);
        assert_eq!(espejo.method, "Divisas (USD Cash)", "y conserva el método declarado");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_arqueo_del_cajon_con_fondo_y_gastos() {
        // F69 — HALLAZGO A1 DE LA AUDITORÍA DE ENTREGA: el cierre pedía contar el cajón contra un
        // esperado que NO incluía el fondo de caja ni los gastos pagados del cajón. Un día perfecto
        // «faltaba» exactamente lo que se pagó del cajón y «sobraba» el fondo declarado al abrir.
        // Acá se fija la regla completa: esperado = efectivo cobrado (ya neto) + fondo − gastos del cajón.
        let test_path = PathBuf::from("test_arqueo_f69.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        // Fondo de caja de $50 al abrir + tasa
        db.open_day(50.0, 40.0, 45.0).unwrap();
        // Cobros del día: $100 en divisas y Bs. 4.000 en efectivo
        db.add_sale(None, "Pantalla A", 1, 100.0, 100.0, "Divisas (USD Cash)", "C1", None, "", 0.0, "", "USD", 0.0).unwrap();
        db.add_sale(None, "Pantalla B", 1, 100.0, 4000.0, "Efectivo Bs", "C2", None, "", 0.0, "", "VES", 0.0).unwrap();
        // Gastos pagados DEL cajón: $20 de divisas y Bs. 500
        db.add_expense(&today, "Compra de repuestos", 20.0, "USD", "mensajero", "Divisas (USD Cash)").unwrap();
        db.add_expense(&today, "Otro", 500.0, "VES", "flete", "Efectivo Bs").unwrap();
        // …y uno pagado por banco, que NO puede tocar el cajón
        db.add_expense(&today, "Servicios", 999.0, "USD", "por Zelle", "Transferencia Zelle").unwrap();
        // …y uno sin declarar de dónde salió: tampoco se descuenta (se avisa)
        db.add_expense(&today, "Otro", 77.0, "USD", "sin método", "").unwrap();

        let adj = db.drawer_adjustments(&today).unwrap();
        assert_eq!(adj.fondo_usd, 50.0, "el fondo declarado al abrir");
        assert_eq!(adj.gastos_usd, 20.0, "sólo el gasto pagado DEL cajón en divisas");
        assert_eq!(adj.gastos_bs, 500.0, "y el pagado del cajón en bolívares");
        assert_eq!(adj.sin_metodo, 1, "el gasto sin método se cuenta aparte para avisarlo");

        // El operario cuenta exactamente lo que debe haber: 100 + 50 − 20 = $130 y 4.000 − 500 = Bs. 3.500
        let close_id = db.close_day(&today, "arqueo con fondo y gastos", 0.0, 40.0, 45.0,
            130.0, 3500.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let c = db.get_daily_closings().unwrap().into_iter().find(|x| x.id == close_id).unwrap();
        assert!(c.difference.abs() < 1e-9,
            "un día perfecto con fondo y gastos del cajón cuadra: diferencia={}", c.difference);
        assert_eq!(c.cash_usd, 0.0, "las columnas crudas del día NO se maquillan");
        assert_eq!(c.usd_cash_total, 100.0);
        assert_eq!(c.cash_bs, 4000.0);
        assert_eq!(c.initial_cash_usd, 50.0, "el fondo queda guardado tal como se usó (una sola fuente)");
        assert_eq!(c.drawer_adjust_usd, 30.0, "fondo 50 − gastos 20 = el ajuste que se usó");
        assert_eq!(c.drawer_adjust_bs, -500.0, "los gastos en Bs. del cajón, en negativo");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_arqueo_no_resta_la_devolucion_dos_veces() {
        // La devolución se guarda como un cobro NEGATIVO con el método por el que salió la plata, así
        // que el neto por método YA viene con ella: restarla otra vez en el esperado del cajón
        // descontaba la misma plata dos veces (lo cazó `test_refund_ledger_full` en F69).
        let test_path = PathBuf::from("test_arqueo_dev_f69.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(0.0, 40.0, 45.0).unwrap();

        let sid = db.add_service("ORD-ARQ-1", "Ana", "0412-1", "Samsung A15", "Rota",
            "Cambio pantalla", "[\"Cambio pantalla\"]", 50.0, "Divisas (USD Cash)", "", 0.0, "", "USD",
            "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid, 50.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();
        db.add_service_refund(sid, 50.0, "Divisas (USD Cash)", "", "USD", "se devolvió todo").unwrap();

        let adj = db.drawer_adjustments(&today).unwrap();
        assert_eq!(adj.devoluciones_usd, 50.0, "el libro dice cuánto se devolvió del cajón");

        // El cajón quedó vacío: cobró 50 y devolvió 50 → 0 esperado, 0 contado, cuadra.
        let close_id = db.close_day(&today, "devolución total", 0.0, 40.0, 45.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let c = db.get_daily_closings().unwrap().into_iter().find(|x| x.id == close_id).unwrap();
        assert!(c.difference.abs() < 1e-9,
            "una orden devuelta entera no puede dejar «faltante» en el cajón: diferencia={}", c.difference);
        assert_eq!(c.usd_cash_total, 0.0, "el neto por método ya trae la devolución");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_close_day_pos_settled() {
        // (2026-08-02): al cerrar el día se registra el monto que imprimió el Punto
        // (regla: el sistema debe dar el mismo monto) en USD y Bs; se puede corregir luego.
        let test_path = PathBuf::from("test_pos_settled.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(0.0, 40.5, 45.0).unwrap();
        db.add_sale(None, "Pantalla Test", 1, 100.0, 100.0, "Punto de Venta (Bs)", "Cliente", None, "", 0.0, "", "VES", 0.0).unwrap();

        let closing_id = db.close_day(&today, "cierre", 0.0, 40.5, 45.0,
            0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 0.0, 100.0, 35000.0).unwrap();
        assert!(closing_id > 0);
        let closings = db.get_daily_closings().unwrap();
        let c = closings.iter().find(|x| x.close_date == today).unwrap();
        assert_eq!(c.pos_settled, 100.0, "monto impreso Punto USD guardado");
        assert_eq!(c.pos_settled_bs, 35000.0, "monto impreso Punto Bs guardado");

        // Liquidación posterior (corrección) en ambas monedas
        db.update_daily_closing_settlement(closing_id, 98.0, 34900.0).unwrap();
        let closings = db.get_daily_closings().unwrap();
        let c = closings.iter().find(|x| x.close_date == today).unwrap();
        assert_eq!(c.pos_settled, 98.0, "liquidación USD corregida");
        assert_eq!(c.pos_settled_bs, 34900.0, "liquidación Bs corregida");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_multi_types() {
        // (2026-08-03): un servicio puede tener VARIOS trabajos/fallas (service_types JSON array).
        // service_type queda como el primario; service_types guarda todos.
        let test_path = PathBuf::from("test_multi_types.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let sid = db.add_service("ORD-MULTI-1", "Luis", "0412-1", "Tecno SPARK 10 PRO",
            "Pantalla rota y puerto de carga flojo", "Cambio pantalla",
            r#"["Cambio pantalla","Cambio conector / puerto"]"#,
            45.0, "Efectivo Bs", "", 0.0, "", "USD", "V-100", "", "{}", None, "", None, "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.service_type.as_deref(), Some("Cambio pantalla"), "primario = primer tipo");
        assert_eq!(svc.service_types.as_deref(), Some(r#"["Cambio pantalla","Cambio conector / puerto"]"#), "guarda TODOS los tipos");

        // update_service reemplaza la lista completa
        db.update_service(sid, "Luis", "0932-000", "Tecno SPARK 10 PRO",
            "Parlante muerto", "Cambio parlante / micrófono",
            r#"["Cambio parlante / micrófono","Cambio batería"]"#,
            30.0, "Efectivo Bs", "", "Recibido", "", 0.0, "", "USD", "V-100", "", "{}", "", None, "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.service_types.as_deref(), Some(r#"["Cambio parlante / micrófono","Cambio batería"]"#));

        // get_services / get_client_services también devuelven service_types
        let all = db.get_services("", "", "", "", "").unwrap();
        let s = all.iter().find(|x| x.id == sid).unwrap();
        assert_eq!(s.service_types.as_deref(), Some(r#"["Cambio parlante / micrófono","Cambio batería"]"#));

        // NULL si no se manda lista
        let sid2 = db.add_service("ORD-MULTI-2", "Ana", "0933-000", "Samsung A32", "Rota", "Cambio pantalla",
            "", 15.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        let svc2 = db.get_service_by_id(sid2).unwrap().unwrap();
        assert!(svc2.service_types.is_none(), "service_types NULL si la lista va vacía");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_types_legacy_backfill() {
        // (2026-08-03): DB legacy sin columna service_types → migración agrega y
        // hace backfill idempotente desde service_type ([tipo] o []).
        let test_path = PathBuf::from("test_service_types_mig.db");
        let _ = std::fs::remove_file(&test_path);
        {
            let legacy = rusqlite::Connection::open(&test_path).unwrap();
            legacy.execute_batch("
                CREATE TABLE services (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_num TEXT UNIQUE,
                    date_in TEXT DEFAULT (datetime('now','localtime')),
                    client TEXT, phone TEXT, model TEXT, fault TEXT,
                    amount REAL DEFAULT 0, payment_method TEXT,
                    date_out TEXT, status TEXT DEFAULT 'Por entregar', observations TEXT,
                    bank_fee_percent REAL DEFAULT 0, bank_fee_amount REAL DEFAULT 0,
                    net_amount REAL, zelle_reference TEXT, currency TEXT DEFAULT 'USD',
                    service_type TEXT
                );
            ").unwrap();
            legacy.execute("INSERT INTO services (order_num, client, model, fault, service_type) VALUES ('LEGACY-1','Pedro','Xiaomi Red 10','Rota','Cambio pantalla')", []).unwrap();
            legacy.execute("INSERT INTO services (order_num, client, model, fault, service_type) VALUES ('LEGACY-2','Marta','Samsung A06','NA','')", []).unwrap();
        }

        let db = Database::new(&test_path).expect("Failed to open legacy DB");
        let all = db.get_services("", "", "", "", "").unwrap();
        let s1 = all.iter().find(|x| x.order_num.as_deref() == Some("LEGACY-1")).unwrap();
        assert_eq!(s1.service_types.as_deref(), Some(r#"["Cambio pantalla"]"#), "backfill desde service_type");
        let s2 = all.iter().find(|x| x.order_num.as_deref() == Some("LEGACY-2")).unwrap();
        assert_eq!(s2.service_types.as_deref(), Some("[]"), "backfill vacío para NULL/vacío");
        assert_eq!(s2.service_type.as_deref(), Some(""), "service_type conservado");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_technicians_crud() {
        let test_path = PathBuf::from("test_technicians.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Seed inicial: Aldri (morado) + William (azul)
        let techs = db.get_technicians().unwrap();
        assert_eq!(techs.len(), 2, "sembrados en migración");
        let aldri = techs.iter().find(|t| t.name == "Aldri").unwrap();
        assert_eq!(aldri.initials, "A");
        assert_eq!(aldri.color, "bg-purple-500");
        let will = techs.iter().find(|t| t.name == "William").unwrap();
        assert_eq!(will.color, "bg-blue-500");

        // Añadir más → UNIQUE por nombre
        let luis_id = db.add_technician("Luis", "L", "bg-green-600").unwrap();
        assert!(luis_id > 0);
        assert_eq!(db.get_technicians().unwrap().len(), 3);
        let dup = db.add_technician("Luis", "X", "bg-red-500");
        assert!(dup.is_err(), "nombre duplicado no debe guardarse");

        // Renombrar / cambiar color / iniciales (corrige errores de tipeo)
        db.update_technician(luis_id, "Luis Felipe", "LF", "bg-amber-500").unwrap();
        let after = db.get_technicians().unwrap().into_iter().find(|t| t.id == luis_id).unwrap();
        assert_eq!(after.name, "Luis Felipe");
        assert_eq!(after.initials, "LF");
        assert_eq!(after.color, "bg-amber-500");

        // Borrar → se limpia technician_id de los servicios pero el nombre persiste
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let sid = db.add_service("ORD-TECH-1", "Cliente", "0412-1", "Samsung A32", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "Aldri", Some(aldri.id), "", None, 0.0).unwrap();
        db.delete_technician(aldri.id).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.technician.as_deref(), Some("Aldri"), "nombre snapshot persiste tras borrar técnico");
        assert!(svc.technician_id.is_none(), "technician_id se limpia al borrar técnico");
        assert_eq!(db.get_technicians().unwrap().len(), 2, "William + Luis Felipe");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_technician() {
        let test_path = PathBuf::from("test_service_technician.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let techs = db.get_technicians().unwrap();
        let aldri = techs.iter().find(|t| t.name == "Aldri").unwrap();

        // Crear servicio asignado a Aldri
        let sid = db.add_service("ORD-TEC-1", "Cliente", "0412-1", "Samsung A32", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            10.0, "Efectivo Bs", "", 0.0, "", "USD", "1", "", "", None, "Aldri", Some(aldri.id), "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.technician.as_deref(), Some("Aldri"));
        assert_eq!(svc.technician_id, Some(aldri.id));

        // get_services devuelve el técnico (mapeo de columna 24/25 del SELECT explícito)
        let all = db.get_services("", "", "", "", "").unwrap();
        let s = all.iter().find(|x| x.id == sid).unwrap();
        assert_eq!(s.technician.as_deref(), Some("Aldri"));
        assert_eq!(s.technician_id, Some(aldri.id));

        // Cambiar de técnico con update_service (limpiar → otra persona)
        let will = techs.iter().find(|t| t.name == "William").unwrap();
        db.update_service(sid, "Cliente", "0412-1", "Samsung A11", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            10.0, "Efectivo Bs", "", "Recibido", "", 0.0, "", "USD", "1", "", "", "William", Some(will.id), "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.technician.as_deref(), Some("William"));
        assert_eq!(svc.technician_id, Some(will.id));

        // Sin técnico asignado → ambos NULL
        db.update_service(sid, "Cliente", "0412-1", "Samsung A11", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            10.0, "Efectivo Bs", "", "Recibido", "", 0.0, "", "USD", "1", "", "", "", None, "", None, 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert!(svc.technician.is_none() && svc.technician_id.is_none());

        // get_client_services también lo devuelve
        let cid = db.add_or_find_client("Cliente", "0412-1", "1", "").unwrap();
        db.update_service(sid, "Cliente", "0412-1", "Samsung A11", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            10.0, "Efectivo Bs", "", "Recibido", "", 0.0, "", "USD", "1", "", "", "Aldri", Some(aldri.id), "", None, 0.0).unwrap();
        let cs = db.get_client_services(cid).unwrap();
        let s = cs.iter().find(|x| x.id == sid).unwrap();
        assert_eq!(s.technician.as_deref(), Some("Aldri"));
        assert_eq!(s.technician_id, Some(aldri.id));

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_screen_exact_deduction() {
        // (2026-08-12) Inventario EXACTO de pantallas: la orden guarda screen_product_id
        // (pantalla elegida en el desplegable de compatibilidad) → al entregar se descuenta
        // SOLO ese producto, aunque el modelo coincida con varias pantallas del catálogo.
        let test_path = PathBuf::from("test_screen_exact.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        // Dos pantallas distintas compatibles con el MISMO teléfono (variantes Incell / FHD)
        let p_incell = db.add_product("Pantalla Tecno SPARK 10 PRO Incell", Some(1), "Tecno",
            "SPARK 10 PRO", "Incell", r#"["Tecno SPARK 10 PRO"]"#, 10.0, 15.0, 2, 0, 0.0).unwrap();
        let p_fhd = db.add_product("Pantalla Tecno SPARK 10 PRO FHD", Some(1), "Tecno",
            "SPARK 10 PRO", "FHD", r#"["Tecno SPARK 10 PRO"]"#, 11.0, 16.0, 5, 0, 0.0).unwrap();

        // El técnico elige la variante FHD → descuento EXACTO de la FHD
        let sid = db.add_service("DEV-0001", "Luis", "0412-1", "Tecno SPARK 10 PRO",
            "Pantalla rota", "Cambio pantalla", r#"["Cambio pantalla"]"#,
            16.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "V-1", "", "{}", None, "", None, "",
            Some(p_fhd), 0.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.screen_product_id, Some(p_fhd), "la orden guarda la pantalla exacta elegida");

        db.update_service(sid, "Luis", "0412-1", "Tecno SPARK 10 PRO", "Pantalla rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 16.0, "Divisas (USD Cash)", "", "Entregado", "",
            0.0, "", "USD", "V-1", "", "{}", "", None, "", Some(p_fhd), 0.0).unwrap();

        let fhd_stock: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_fhd], |r| r.get(0)).unwrap()
        });
        let incell_stock: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_incell], |r| r.get(0)).unwrap()
        });
        assert_eq!(fhd_stock, 4, "se descuenta la pantalla EXACTA elegida (5→4)");
        assert_eq!(incell_stock, 2, "la otra variante compatible queda intacta");

        // Reabrir → devuelve a la MISMA pantalla exacta
        db.update_service(sid, "Luis", "0412-1", "Tecno SPARK 10 PRO", "Pantalla rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 16.0, "Divisas (USD Cash)", "", "Recibido", "",
            0.0, "", "USD", "V-1", "", "{}", "", None, "", Some(p_fhd), 0.0).unwrap();
        let fhd_stock2: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_fhd], |r| r.get(0)).unwrap()
        });
        assert_eq!(fhd_stock2, 5, "reabrir devuelve el stock a la pantalla exacta");

        // Borrar un servicio ENTREGADO → devuelve a la pantalla exacta
        db.update_service(sid, "Luis", "0412-1", "Tecno SPARK 10 PRO", "Pantalla rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 16.0, "Divisas (USD Cash)", "", "Entregado", "",
            0.0, "", "USD", "V-1", "", "{}", "", None, "", Some(p_fhd), 0.0).unwrap();
        db.delete_service(sid).unwrap();
        let fhd_stock3: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_fhd], |r| r.get(0)).unwrap()
        });
        assert_eq!(fhd_stock3, 5, "borrar servicio entregado devuelve stock a la pantalla exacta");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F50 — EL CHECK NO FRENA EL INVENTARIO (invariante que el dueño pidió sostener: «el inventario
    /// tiene que seguir descontando por servicio»). `in_use` decide **qué se OFRECE** al registrar
    /// (la lista de modelos del formulario), NUNCA qué se descuenta: una pantalla apagada a mano que
    /// igual se elige y se entrega **se descuenta** y al reabrir **se devuelve** a esa misma ficha.
    /// Si el check pudiera parar el descuento, apagar una ficha del catálogo dejaría el stock
    /// mintiendo con el repuesto ya instalado en la calle.
    #[test]
    fn test_in_use_never_stops_the_inventory_deduction() {
        let test_path = PathBuf::from("test_in_use_stock.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let p = db.add_product("Pantalla Samsung A70 Incell", Some(1), "Samsung", "A70", "Incell",
            r#"["Samsung A70"]"#, 8.0, 15.0, 3, 0, 0.0).unwrap();

        // el local APAGA la pantalla y el modelo (no los usa: no quieren verlos en el formulario)
        db.set_product_in_use(p, false).unwrap();
        let phone_id: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT id FROM phones WHERE name LIKE '%A70%'", [], |r| r.get(0)).unwrap()
        };
        db.set_phone_use_all(phone_id, false).unwrap();
        assert!(db.get_phone_models_filtered("A70", 50, true).unwrap().iter().all(|m| m.in_use == 0),
            "apagado NO se ofrece en el formulario (para eso es el check)");
        // …pero la pantalla SIGUE estando entre las compatibles del modelo: apagar una ficha no
        // puede dejar al taller sin poder elegir el repuesto que tiene que instalar.
        assert!(db.find_compatible_products("Samsung A70", None, 40).unwrap().iter().any(|c| c.product.id == p),
            "la lista de pantallas del modelo no se filtra por «en uso»");

        let sid = db.add_service("DEV-0500", "Luis", "0412-1", "Samsung A70",
            "Pantalla rota", "Cambio pantalla", r#"["Cambio pantalla"]"#,
            15.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "V-1", "", "{}", None, "", None, "",
            Some(p), 0.0).unwrap();
        db.update_service(sid, "Luis", "0412-1", "Samsung A70", "Pantalla rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 15.0, "Divisas (USD Cash)", "", "Entregado", "",
            0.0, "", "USD", "V-1", "", "{}", "", None, "", Some(p), 0.0).unwrap();

        let stock = |id: i64| -> i64 {
            conn_query(|| {
                let c = db.conn.lock().unwrap();
                c.query_row("SELECT stock FROM products WHERE id=?1", params![id], |r| r.get(0)).unwrap()
            })
        };
        assert_eq!(stock(p), 2, "entregar descuenta la pantalla ELEGIDA aunque esté apagada (3→2)");

        db.update_service(sid, "Luis", "0412-1", "Samsung A70", "Pantalla rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 15.0, "Divisas (USD Cash)", "", "Recibido", "",
            0.0, "", "USD", "V-1", "", "{}", "", None, "", Some(p), 0.0).unwrap();
        assert_eq!(stock(p), 3, "reabrir la devuelve a la MISMA ficha (el check no la desvía)");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F52 — LA FAMILIA DE LA VARIANTE TIENE UNA SOLA REGLA, escrita dos veces (Rust para los chips y
    /// el orden, SQL para el filtro) y **comparada acá contra los valores REALES del catálogo**: si
    /// las dos implementaciones se separan, el filtro del inventario y los chips dirían cosas
    /// distintas y esto se pone rojo.
    #[test]
    fn test_variant_family_sql_matches_rust() {
        let test_path = PathBuf::from("test_variant_family.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // los valores reales del catálogo del local + casos de borde (espacios, minúsculas, AM).
        // OJO: `add_product` NORMALIZA la variante, así que la comparación se hace contra lo que
        // quedó GUARDADO (que es lo que el filtro va a ver), no contra el texto de entrada.
        let valores = ["INCELL", "OLED", "OLED Con Marco", "ORIGINAL", "ORIGINAL Sin Marco",
                       "INCELL Con Marco", "AM (OLED)", "", "  oled  "];
        for (i, v) in valores.iter().enumerate() {
            db.add_product(&format!("Pantalla Prueba {i}"), Some(1), "Samsung", "A70", v,
                r#"["Samsung A70"]"#, 1.0, 10.0, 1, 0, 0.0).unwrap();
        }

        // (1) la familia calculada en Rust == la que calcula el SQL, para CADA variante guardada
        // (se leen TODAS las filas, no los valores distintos: el filtro cuenta fichas, no textos)
        let guardadas: Vec<String> = {
            let conn = db.conn.lock().unwrap();
            let mut stmt = conn.prepare("SELECT COALESCE(variant,'') FROM products ORDER BY id").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        assert!(guardadas.len() >= 6, "el catálogo de prueba debe tener varias variantes: {guardadas:?}");
        for v in &guardadas {
            let conn = db.conn.lock().unwrap();
            let sql: String = conn.query_row(
                &format!("SELECT {VARIANT_FAMILY_SQL} FROM products p WHERE COALESCE(p.variant,'')=?1 LIMIT 1"),
                params![v], |r| r.get(0)).unwrap();
            drop(conn);
            assert_eq!(sql, crate::catalog::variant_family(v),
                "la familia de «{v}» difiere entre el SQL del filtro y catalog::variant_family");
        }

        // (2) el FILTRO agrupa por familia: la expectativa sale de aplicar la regla de Rust a TODAS
        // las fichas guardadas, y el SQL tiene que devolver exactamente lo mismo.
        for familia in ["oled", "incell", "original", "am", ""] {
            let esperadas = guardadas.iter().filter(|v| crate::catalog::variant_family(v) == familia).count() as i64;
            let page = db.get_products_page("", None, None, Some("todos"), Some(familia), Some("nombre"), 50, 0).unwrap();
            assert_eq!(page.total, esperadas, "la familia «{familia}» debe traer {esperadas} fichas (trajo {})", page.total);
            for p in &page.items {
                let v = p.variant.clone().unwrap_or_default();
                assert_eq!(crate::catalog::variant_family(&v), familia,
                    "el filtro «{familia}» trajo «{v}» (familia {})", crate::catalog::variant_family(&v));
            }
        }
        // (3) «OLED» trae también «OLED Con Marco» (es la familia, no el texto exacto)
        let oled = db.get_products_page("", None, None, Some("todos"), Some("OLED"), Some("nombre"), 50, 0).unwrap();
        let variantes: Vec<String> = oled.items.iter().map(|p| p.variant.clone().unwrap_or_default()).collect();
        assert!(variantes.iter().any(|v| v == "OLED") && variantes.iter().any(|v| v == "OLED Con Marco"),
            "el filtro OLED trae la familia completa: {variantes:?}");
        // (4) sin filtro salen todas
        let todas = db.get_products_page("", None, None, Some("todos"), None, Some("nombre"), 50, 0).unwrap();
        assert_eq!(todas.total, valores.len() as i64, "sin filtro de variante salen todas las fichas");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F52 — LA FILA DE UN MODELO trae sus VARIANTES y su RANGO DE PRECIOS (lo que muestra la vista
    /// «Por modelo»): una sola ficha por teléfono, con las variantes ADENTRO, no como modelos aparte.
    #[test]
    fn test_model_row_carries_variants_and_price_range() {
        let test_path = PathBuf::from("test_model_variants.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // 4 pantallas del MISMO teléfono (variantes reales) — precios y stock distintos a propósito
        db.add_product("Pantalla Samsung A70 Incell", Some(1), "Samsung", "A70", "INCELL",
            r#"["Samsung A70"]"#, 8.0, 10.0, 3, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung A70 OLED", Some(1), "Samsung", "A70", "OLED",
            r#"["Samsung A70"]"#, 9.0, 15.0, 2, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung A70 OLED Con Marco", Some(1), "Samsung", "A70", "OLED Con Marco",
            r#"["Samsung A70"]"#, 10.0, 12.5, 1, 0, 0.0).unwrap();
        // una ficha SIN precio: no puede arruinar el rango (min/max salen de las que tienen precio).
        // Es también la que se APAGA a mano más abajo, para comprobar que la ficha lo dice.
        let sin_precio = db.add_product("Pantalla Samsung A70 sin precio", Some(1), "Samsung", "A70", "ORIGINAL",
            r#"["Samsung A70"]"#, 0.0, 0.0, 1, 0, 0.0).unwrap();

        let page = db.get_phones_page(None, "A70", false, false, false, "nombre", "asc", 50, 0).unwrap();
        let fila = page.items.iter().find(|p| p.model.to_lowercase().contains("a70"))
            .unwrap_or_else(|| panic!("el teléfono existe en el padrón: {:?}",
                page.items.iter().map(|p| format!("{}|{}", p.brand, p.model)).collect::<Vec<_>>()));
        assert_eq!(fila.products, 4, "una sola fila por MODELO con sus 4 repuestos adentro");
        assert_eq!(fila.stock, 7, "el stock del modelo es la suma de sus repuestos (3+2+1+1)");
        // variantes en ORDEN canónico (INCELL → OLED → ORIGINAL) y sin repetir: las dos OLED son familia
        // distinta pero la lista muestra el texto real de cada una
        assert_eq!(fila.variants, vec!["INCELL".to_string(), "OLED".to_string(), "OLED Con Marco".to_string(), "ORIGINAL".to_string()],
            "las variantes del modelo salen ordenadas y completas: {:?}", fila.variants);
        assert!((fila.price_min - 10.0).abs() < 1e-6, "el mínimo ignora la ficha sin precio ({})", fila.price_min);
        assert!((fila.price_max - 15.0).abs() < 1e-6, "el máximo es el precio más alto ({})", fila.price_max);

        // la ficha del teléfono trae lo mismo (es la misma fuente: merged_stats)
        let detalle = db.get_phone_detail(fila.id).unwrap().expect("ficha del teléfono");
        assert_eq!(detalle.phone.variants, fila.variants, "la ficha y la lista dicen las mismas variantes");
        assert_eq!(detalle.phone.products, 4, "la ficha lista los 4 repuestos del modelo");
        // …y cada repuesto de la ficha trae SU código y SU «en uso» de la base (bug real: la lista de
        // columnas del detalle se había quedado sin `code`/`in_use` y el despliegue mostraba todo
        // «en uso» y sin código — lo cazó la verificación en vivo de la vista «Por modelo»).
        db.set_product_in_use(sin_precio, false).unwrap();
        let detalle2 = db.get_phone_detail(fila.id).unwrap().expect("ficha del teléfono");
        let repuestos: Vec<&crate::db::Product> = detalle2.blocks.iter().flat_map(|b| b.items.iter()).collect();
        for r in &repuestos {
            let code: String = {
                let conn = db.conn.lock().unwrap();
                conn.query_row("SELECT COALESCE(code,'') FROM products WHERE id=?1", params![r.id], |x| x.get(0)).unwrap()
            };
            assert_eq!(r.code, code, "el repuesto {} de la ficha tiene que traer su código real", r.id);
        }
        let apagado = repuestos.iter().find(|r| r.id == sin_precio).expect("el repuesto apagado está en la ficha");
        assert_eq!(apagado.in_use, 0, "el repuesto apagado a mano se muestra apagado en la ficha (no «todo en uso»)");
        assert!(repuestos.iter().filter(|r| r.id != sin_precio).all(|r| r.in_use == 1),
            "los demás siguen en uso");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F52 — el ORDEN de las variantes es canonico y estable (lo que el taller espera ver primero).
    #[test]
    fn test_variant_order_is_canonical() {
        let mut v: Vec<String> = ["ORIGINAL Sin Marco", "OLED", "", "INCELL Con Marco", "AM", "ORIGINAL", "OLED Con Marco"]
            .iter().map(|s| s.to_string()).collect();
        crate::catalog::sort_variants(&mut v);
        assert_eq!(v, vec!["INCELL Con Marco", "OLED", "OLED Con Marco", "AM", "ORIGINAL", "ORIGINAL Sin Marco"],
            "orden canónico: material (INCELL→OLED→AM→ORIGINAL) y, dentro de cada uno, el pelado antes de sus marcos, sin vacíos");
        assert_eq!(crate::catalog::variant_family("OLED Con Marco"), "oled");
        assert_eq!(crate::catalog::variant_family(""), "");
        assert!(crate::catalog::variant_is_family("OLED Con Marco", "OLED"));
        assert!(!crate::catalog::variant_is_family("OLED Con Marco", "incell"));
    }

    /// F53 — SEPARAR LOS MODELOS: la pantalla queda compatible con **los dos** teléfonos, los nuevos
    /// se numeran y se marcan «en uso», y **no se mueve ni el stock ni los precios** (ni los
    /// movimientos). El patrón es el del dueño: «Samsung A70 A705» → «Samsung A70» + «Samsung A705».
    #[test]
    fn test_split_models_preview_and_apply() {
        let test_path = PathBuf::from("test_split_models.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // una pantalla que hoy sirve a los DOS teléfonos en una sola entrada pegada
        let p = db.add_product("Pantalla Samsung A70 A705 Incell", Some(1), "Samsung", "A70 A705", "INCELL",
            r#"["Samsung A70 A705","Samsung A70"]"#, 8.0, 15.0, 4, 0, 0.0).unwrap();
        let (stock_antes, precio_antes) = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock, price_sale FROM products WHERE id=?1", params![p],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))).unwrap()
        };

        // El padrón de una base que viene de la versión VIEJA: una sola fila con los dos teléfonos
        // pegados en el nombre («Samsung A70 A705»). Se arma a mano porque `add_product` ya reconstruye
        // con la regla nueva: acá se prueba justamente la MIGRACIÓN de lo que ya estaba.
        {
            let c = db.conn.lock().unwrap();
            c.execute("DELETE FROM phones", []).unwrap();
            c.execute(
                "INSERT INTO phones (brand, line, model, name, key, aliases, source, in_use, code)
                 VALUES ('Samsung','','A70 A705','Samsung A70 A705','samsung|a70a705','[\"Samsung A70 A705\"]','catalogo',1,'M-0001')",
                [],
            ).unwrap();
        }

        // 1) VISTA PREVIA: no escribe nada y dice qué aparece y qué se va
        let prev = db.preview_phone_split().unwrap();
        assert!(prev.created.iter().any(|n| n.contains("A70")), "aparece «A70»: {:?}", prev.created);
        assert!(prev.created.iter().any(|n| n.contains("A705")), "aparece «A705»: {:?}", prev.created);
        assert!(prev.removed.iter().any(|n| n.contains("A70 A705")), "deja de existir el nombre pegado: {:?}", prev.removed);
        let phones_previos: i64 = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT COUNT(*) FROM phones", [], |r| r.get(0)).unwrap()
        };
        assert!(!prev.created.is_empty() && prev.phones_after > prev.phones_before,
            "la vista previa dice que el padrón crece ({} → {})", prev.phones_before, prev.phones_after);

        // 2) APLICAR
        let rep = db.apply_phone_split().unwrap();
        assert!(rep.backup.is_some(), "antes de escribir se guarda una copia de seguridad");
        assert!(rep.created.iter().any(|n| n.contains("A70")) && rep.created.iter().any(|n| n.contains("A705")));

        // el padrón ya NO tiene el nombre pegado y SÍ los dos reales, cada uno numerado y EN USO
        let filas: Vec<(i64, String, String, i64)> = {
            let c = db.conn.lock().unwrap();
            let mut stmt = c.prepare("SELECT id, name, COALESCE(code,''), COALESCE(in_use,0) FROM phones").unwrap();
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        let nombres: Vec<String> = filas.iter().map(|(_, n, _, _)| n.clone()).collect();
        assert!(nombres.iter().any(|n| n.ends_with("A70")), "existe el teléfono «…A70»: {nombres:?}");
        assert!(nombres.iter().any(|n| n.ends_with("A705")), "existe el teléfono «…A705»: {nombres:?}");
        assert!(!nombres.iter().any(|n| n.contains("A70 A705")), "el nombre pegado ya no está: {nombres:?}");
        for (id, nombre, code, in_use) in &filas {
            if nombre.ends_with("A70") || nombre.ends_with("A705") {
                assert!(!code.is_empty(), "el modelo nuevo queda numerado ({nombre})");
                assert_eq!(*in_use, 1, "el modelo nuevo queda EN USO (su repuesto está en uso y con stock)");
                // y el teléfono nuevo encuentra la pantalla (compatible con los dos)
                let det = db.get_phone_detail(*id).unwrap().expect("ficha del teléfono nuevo");
                assert_eq!(det.phone.products, 1, "{nombre} tiene que ver la pantalla");
                assert_eq!(det.phone.stock, stock_antes, "{nombre} ve el stock de la pantalla");
            }
        }
        let _ = phones_previos;

        // 3) NADA de plata ni de stock se movió
        let (stock_despues, precio_despues): (i64, f64) = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock, price_sale FROM products WHERE id=?1", params![p],
                |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };
        assert_eq!(stock_despues, stock_antes, "el stock no se toca");
        assert!((precio_despues - precio_antes).abs() < 1e-9, "el precio no se toca");
        let movs: i64 = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT COUNT(*) FROM inventory_movements", [], |r| r.get(0)).unwrap()
        };
        assert_eq!(movs, 0, "no se inventa ningún movimiento de inventario");
        // y la compatibilidad del producto sigue diciendo lo mismo (no se reescribe el texto)
        let compat: String = {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT COALESCE(compatibility,'') FROM products WHERE id=?1", params![p], |r| r.get(0)).unwrap()
        };
        assert!(compat.contains("A70 A705"), "la compatibilidad del repuesto NO se toca: {compat}");

        // 4) idempotente: correrlo otra vez no cambia nada
        let rep2 = db.apply_phone_split().unwrap();
        assert!(rep2.created.is_empty(), "la segunda corrida no crea nada: {:?}", rep2.created);
        assert!(rep2.removed.is_empty(), "la segunda corrida no borra nada: {:?}", rep2.removed);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F53 — la variante escrita en el TEXTO pasa al campo `variant` (y solo cuando falta).
    #[test]
    fn test_variant_extracted_from_text() {
        assert_eq!(crate::catalog::variant_in_text("Samsung A25 5G OLED C"), Some("OLED".to_string()));
        assert_eq!(crate::catalog::variant_in_text("Samsung A52 A525 OLED Con Marco"), Some("OLED Con Marco".to_string()));
        assert_eq!(crate::catalog::variant_in_text("Apple 13 Pro Max AM"), Some("AM".to_string()));
        assert_eq!(crate::catalog::variant_in_text("Xiaomi Redmi 9A Incell"), Some("INCELL".to_string()));
        // trampa real medida en el catálogo: «Camon» NO es la variante AM
        assert_eq!(crate::catalog::variant_in_text("Tecno Camon 20"), None);
        // «American» tampoco
        assert_eq!(crate::catalog::variant_in_text("Motorola E4 Plus Americano"), None);
        assert_eq!(crate::catalog::variant_in_text("Samsung A70"), None);
    }

    #[test]
    fn test_service_screen_gate_non_screen_job() {
        // (2026-08-12) Gate: SOLO los trabajos que incluyen "Cambio pantalla" consumen
        // inventario. Batería/software NO descuentan aunque el modelo coincida con un
        // producto del catálogo (y aunque se haya guardado screen_product_id por error).
        let test_path = PathBuf::from("test_screen_gate.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let pid = db.add_product("Pantalla Samsung A32", Some(1), "Samsung", "A32",
            "", r#"["Samsung A32"]"#, 12.0, 15.0, 2, 0, 0.0).unwrap();

        // 1) Batería con screen_product_id seteado (dato defensivo) → NO descuenta
        let s1 = db.add_service("DEV-0001", "Ana", "1", "Samsung A32", "Batería mala",
            "Cambio batería", r#"["Cambio batería"]"#,
            10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", Some(pid), 0.0).unwrap();
        db.update_service(s1, "Ana", "1", "Samsung A32", "Batería mala",
            "Cambio batería", r#"["Cambio batería"]"#, 10.0, "Efectivo Bs", "", "Entregado", "",
            0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();

        // 2) Software / Formateo sin screen id → NO descuenta
        let s2 = db.add_service("DEV-0002", "Beto", "2", "Samsung A32", "Se traba",
            "Software / Formateo", r#"["Software / Formateo"]"#,
            10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.update_service(s2, "Beto", "2", "Samsung A32", "Se traba",
            "Software / Formateo", r#"["Software / Formateo"]"#, 10.0, "Efectivo Bs", "", "Entregado", "",
            0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();

        let stock: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(stock, 2, "batería y software NO consumen pantalla");
        let movs = db.get_inventory_movements(None).unwrap();
        assert!(!movs.iter().any(|m| m.reason.as_deref() == Some("Servicio Entregado")),
            "sin movimientos de servicio para trabajos no-pantalla");

        // Reabrir un servicio no-pantalla tampoco "devuelve" nada (simétrico)
        db.update_service(s2, "Beto", "2", "Samsung A32", "Se traba",
            "Software / Formateo", r#"["Software / Formateo"]"#, 10.0, "Efectivo Bs", "", "Recibido", "",
            0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        let stock2: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(stock2, 2, "reabrir no-pantalla no altera stock");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_screen_legacy_model_match_and_like() {
        // (2026-08-12) Órdenes legacy (sin screen_product_id): matching por modelo endurecido
        // (compat exacto → LIKE determinista por id). Y el LIKE NO elige el primero por rowid
        // arbitrario: ordena por id ASC.
        let test_path = PathBuf::from("test_screen_legacy.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        // "SPARK 10 PRO" y "SPARK 10" y "SPARK 10 PRO FHD" — subcadenas que confunden al LIKE
        let p_pro = db.add_product("Pantalla Tecno SPARK 10 PRO", Some(1), "Tecno", "SPARK 10 PRO",
            "", r#"["Tecno SPARK 10 PRO"]"#, 10.0, 15.0, 3, 0, 0.0).unwrap();
        let _p_base = db.add_product("Pantalla Tecno SPARK 10", Some(1), "Tecno", "SPARK 10",
            "", r#"["Tecno SPARK 10"]"#, 10.0, 15.0, 3, 0, 0.0).unwrap();
        let _p_fhd = db.add_product("Pantalla Tecno SPARK 10 PRO FHD", Some(1), "Tecno", "SPARK 10 PRO",
            "FHD", r#"["Tecno SPARK 10 PRO"]"#, 11.0, 16.0, 3, 0, 0.0).unwrap();

        // 1) Modelo con marca y compat exacta → descuenta la PRIMERA pantalla por id que
        //    matchea la compatibilidad (sin screen id, orden legacy). p_pro es la más antigua.
        let s1 = db.add_service("DEV-0001", "Ana", "1", "Tecno SPARK 10 PRO", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#,
            15.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.update_service(s1, "Ana", "1", "Tecno SPARK 10 PRO", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 15.0, "Efectivo Bs", "", "Entregado", "",
            0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        let pro_stock: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_pro], |r| r.get(0)).unwrap()
        });
        assert_eq!(pro_stock, 2, "legacy con compat exacta descuenta la pantalla correcta");
        db.delete_service(s1).unwrap();

        // 2) Modelo tipeado SIN marca ("SPARK 10 PRO") → no matchea compat exacta → LIKE
        //    determinista (id ASC) → p_pro (la primera que contiene la cadena), NO p_fhd ni p_base.
        let s2 = db.add_service("DEV-0002", "Beto", "2", "SPARK 10 PRO", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#,
            15.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.update_service(s2, "Beto", "2", "SPARK 10 PRO", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 15.0, "Efectivo Bs", "", "Entregado", "",
            0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        let pro_stock2: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_pro], |r| r.get(0)).unwrap()
        });
        assert_eq!(pro_stock2, 2, "LIKE determinista: descontó p_pro (la primera por id), no otra variante");
        db.delete_service(s2).unwrap();

        // 3) Modelo con detalles que NO matchea nada → sin descuento, sin fantasma
        let s3 = db.add_service("DEV-0003", "Carla", "3", "SPARK 10 PRO 4/128 GB", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#,
            15.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        let movs_before = db.get_inventory_movements(None).unwrap().len();
        db.update_service(s3, "Carla", "3", "SPARK 10 PRO 4/128 GB", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 15.0, "Efectivo Bs", "", "Entregado", "",
            0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        let movs_after = db.get_inventory_movements(None).unwrap().len();
        assert_eq!(movs_after, movs_before, "modelo sin pantalla en catálogo: sin movimiento");
        let phantom: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT COUNT(*) FROM products WHERE name LIKE '%4/128 GB%'", [], |r| r.get(0)).unwrap()
        });
        assert_eq!(phantom, 0, "no se crea producto fantasma");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_screen_group_order_exact() {
        // (2026-08-12) Orden multi-equipo: cada equipo con su pantalla EXACTA → al entregar
        // cada uno descuenta la suya (nunca la del otro).
        let test_path = PathBuf::from("test_screen_group.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let p_a15 = db.add_product("Pantalla Samsung A15", Some(1), "Samsung", "A15",
            "", r#"["Samsung A15"]"#, 10.0, 15.0, 4, 0, 0.0).unwrap();
        let p_spark = db.add_product("Pantalla Tecno SPARK 10", Some(1), "Tecno", "SPARK 10",
            "", r#"["Tecno SPARK 10"]"#, 10.0, 15.0, 4, 0, 0.0).unwrap();

        let dev = |model: &str, screen: Option<i64>| ServiceDeviceInput {
            model: model.into(), fault: "Rota".into(), service_type: "Cambio pantalla".into(),
            service_types: "[\"Cambio pantalla\"]".into(), amount: 15.0, payment_method: "Efectivo Bs".into(),
            observations: String::new(), bank_fee_percent: 0.0, zelle_reference: String::new(),
            currency: "VES".into(), device_checklist: String::new(), color: "Negro".into(),
            screen_product_id: screen,
discount_amount: 0.0,
            status: "Recibido".into(),
            iva_rate: 0.0, iva_mode: String::new(),
        };
        db.add_service_order("Cliente", "0412", "", "", None, "", None,
            &[dev("Samsung A15", Some(p_a15)), dev("Tecno SPARK 10", Some(p_spark))]).unwrap();
        let svcs = db.get_services("", "", "", "", "").unwrap();
        assert_eq!(svcs.len(), 2, "2 equipos → 2 filas");
        assert!(svcs.iter().all(|s| s.screen_product_id.is_some()), "cada equipo guarda su pantalla");

        // Entregar ambos (mecánica normal: update_service por fila, con SU pantalla exacta)
        for s in &svcs {
            db.update_service(s.id, "Cliente", "0412", s.model.as_deref().unwrap(), "Rota",
                "Cambio pantalla", r#"["Cambio pantalla"]"#, 15.0, "Efectivo Bs", "", "Entregado", "",
                0.0, "", "USD", "", "", "", "", None, "", s.screen_product_id, 0.0).unwrap();
        }
        let stock_a15: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_a15], |r| r.get(0)).unwrap()
        });
        let stock_spark: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![p_spark], |r| r.get(0)).unwrap()
        });
        assert_eq!(stock_a15, 3, "equipo 1 descuenta SU pantalla (4→3)");
        assert_eq!(stock_spark, 3, "equipo 2 descuenta SU pantalla (4→3)");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_technician_stats() {
        let test_path = PathBuf::from("test_technician_stats.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let techs = db.get_technicians().unwrap();
        let aldri = techs.iter().find(|t| t.name == "Aldri").unwrap();
        let will = techs.iter().find(|t| t.name == "William").unwrap();

        // Aldri: 1 activo (Recibido) + 1 entregado ($50) → ingresos 50
        let s1 = db.add_service("ORD-STA-1", "C1", "1", "M1", "F", "Cambio pantalla", "[\"Cambio pantalla\"]",
            50.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "Aldri", Some(aldri.id), "", None, 0.0).unwrap();
        db.add_service("ORD-STA-2", "C2", "2", "M2", "F", "Cambio batería", "[\"Cambio batería\"]",
            30.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "Aldri", Some(aldri.id), "", None, 0.0).unwrap();
        db.update_service(s1, "C1", "1", "M1", "F", "Cambio pantalla", "[\"Cambio pantalla\"]",
            50.0, "Efectivo Bs", "", "Entregado", "", 0.0, "", "USD", "", "", "", "Aldri", Some(aldri.id), "", None, 0.0).unwrap();

        // William: 1 cancelado (no cuenta como activo ni ingresos)
        let s3 = db.add_service("ORD-STA-3", "C3", "3", "M3", "F", "Software / Formateo", "[\"Software / Formateo\"]",
            20.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "William", Some(will.id), "", None, 0.0).unwrap();
        db.update_service(s3, "C3", "3", "M3", "F", "Software / Formateo", "[\"Software / Formateo\"]",
            20.0, "Efectivo Bs", "", "Cancelado", "", 0.0, "", "USD", "", "", "", "William", Some(will.id), "", None, 0.0).unwrap();

        // Sin asignar: 1 servicio
        db.add_service("ORD-STA-4", "C4", "4", "M4", "F", "Cambio pantalla", "[\"Cambio pantalla\"]",
            10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();

        let stats = db.get_technician_stats().unwrap();
        let aldri_s = stats.iter().find(|s| s.technician == "Aldri").unwrap();
        assert_eq!(aldri_s.total, 2);
        assert_eq!(aldri_s.activos, 1, "1 Recibido en taller");
        assert_eq!(aldri_s.entregados, 1);
        assert_eq!(aldri_s.ingresos, 50.0);
        let will_s = stats.iter().find(|s| s.technician == "William").unwrap();
        assert_eq!(will_s.total, 1);
        assert_eq!(will_s.activos, 0, "Cancelado no cuenta");
        assert_eq!(will_s.ingresos, 0.0);
        let sin_s = stats.iter().find(|s| s.technician.is_empty()).unwrap();
        assert_eq!(sin_s.total, 1);

        // Borrar el técnico conserva el snapshot (patrón denormalizado)
        db.delete_technician(aldri.id).unwrap();
        let stats2 = db.get_technician_stats().unwrap();
        let aldri_s2 = stats2.iter().find(|s| s.technician == "Aldri").unwrap();
        assert_eq!(aldri_s2.technician_id, None, "id limpio al borrar el técnico");
        assert_eq!(aldri_s2.total, 2, "las órdenes conservan el nombre snapshot");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_next_order_num_empty_table() {
        // FIX 2026-08-04: con la tabla de servicios VACÍA (inicio de operación tras
        // limpiar la DB), MAX(...) devuelve NULL y .optional() no lo capturaba ->
        // "Invalid column type Null". COALESCE lo resuelve.
        let test_path = PathBuf::from("test_next_order_empty.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let n = db.next_order_num().unwrap();
        assert_eq!(n, "DEV-0001", "Sin servicios debe generar DEV-0001 (no crashear)");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let sid = db.add_service("DEV-0001", "Cliente", "", "Samsung A1", "Rota", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        assert!(sid > 0);
        let n2 = db.next_order_num().unwrap();
        assert_eq!(n2, "DEV-0002", "Debe continuar monotónicamente");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_add_service_order_batch() {
        // Orden multi-equipo: 3 teléfonos → 3 filas, mismo group_id, números DEV-0001/B/C.
        let test_path = PathBuf::from("test_add_service_order_batch.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let dev = |model: &str, fault: &str, amount: f64| ServiceDeviceInput {
            model: model.into(), fault: fault.into(), service_type: "Cambio pantalla".into(),
            service_types: "[\"Cambio pantalla\"]".into(), amount, payment_method: "Divisas (USD Cash)".into(),
            observations: String::new(), bank_fee_percent: 0.0, zelle_reference: String::new(),
            currency: "USD".into(), device_checklist: String::new(), color: "Negro".into(),
            screen_product_id: None,
discount_amount: 0.0,
            status: "Recibido".into(),
            iva_rate: 0.0, iva_mode: String::new(),
        };
        let base = db.add_service_order("Cliente 1", "0412-1", "V-1", "Dir", None, "", None,
            &[dev("Samsung A15", "Pantalla rota", 50.0), dev("Tecno SPARK 10", "No carga", 30.0), dev("Apple 11 PRO", "Sin señal", 40.0)]).unwrap();
        assert_eq!(base, "DEV-0001", "La orden devuelve el número base");
        let svcs = db.get_services("", "", "", "", "").unwrap();
        assert_eq!(svcs.len(), 3, "3 equipos → 3 filas de servicio");
        let nums: Vec<&str> = svcs.iter().map(|s| s.order_num.as_deref().unwrap()).collect();
        assert_eq!(nums, vec!["DEV-0001-B", "DEV-0001-A", "DEV-0001"], "Números: base + sufijos por equipo");
        assert!(svcs.iter().all(|s| s.group_id.as_deref() == Some("DEV-0001")), "Todas las filas comparten group_id");
        assert_eq!(svcs.iter().map(|s| s.amount).sum::<f64>(), 120.0, "Total de la orden = suma de equipos");
        assert_eq!(db.next_order_num().unwrap(), "DEV-0002", "El siguiente número ignora las filas grupales");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_discount_amount_roundtrip() {
        // Precio doble (2026-08-14): amount = lo cobrado real; discount_amount = rebaja en efectivo.
        // El recibo muestra PRECIO (amount+discount) / DESCUENTO / TOTAL (amount).
        let test_path = PathBuf::from("test_discount_roundtrip.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        // Producto con precio doble: price_sale (Bs/lista) = 30, price_usd (efectivo) = 20
        let pid = db.add_product("Pantalla Samsung A15", Some(1), "Samsung", "A15 A155",
            "", r#"["Samsung A15","Samsung A155"]"#, 12.0, 30.0, 5, 2, 20.0).unwrap();
        let prod = db.get_products("A15", None).unwrap().into_iter().find(|p| p.id == pid).unwrap();
        assert_eq!(prod.price_sale, 30.0);
        assert_eq!(prod.price_usd, 20.0);

        // Servicio con descuento: precio real 30, cobrado 20 (descuento 10)
        let sid = db.add_service("DEV-0001", "Juan", "0412-1", "Samsung A15 A155", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 20.0, "Divisas (USD Cash)", "", 0.0, "", "USD",
            "", "", "", None, "", None, "", Some(pid), 10.0).unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.amount, 20.0, "amount = cobrado");
        assert_eq!(svc.discount_amount, 10.0, "descuento guardado");
        assert_eq!(svc.amount + svc.discount_amount, 30.0, "precio real = amount + discount");

        // update_service conserva/actualiza el descuento
        db.update_service(sid, "Juan", "0412-1", "Samsung A15 A155", "Rota",
            "Cambio pantalla", r#"["Cambio pantalla"]"#, 25.0, "Divisas (USD Cash)", "", "Entregado", "",
            0.0, "", "USD", "", "", "", "", None, "", Some(pid), 5.0).unwrap();
        let svc2 = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc2.amount, 25.0);
        assert_eq!(svc2.discount_amount, 5.0);

        // Venta con descuento: total = cobrado, discount_amount aparte
        db.add_sale(Some(pid), "Pantalla Samsung A15", 1, 20.0, 20.0, "Divisas (USD Cash)", "Ana",
            None, "", 0.0, "", "USD", 10.0).unwrap();
        let sales = db.get_sales("", None, "", "").unwrap();
        assert_eq!(sales[0].total, 20.0, "total = cobrado en efectivo");
        assert_eq!(sales[0].discount_amount, 10.0);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_add_service_order_single_device_no_group() {
        // 1 solo equipo → SIN group_id (compatible con órdenes viejas y next_order_num)
        let test_path = PathBuf::from("test_add_service_order_single.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let d = ServiceDeviceInput {
            model: "Samsung A15".into(), fault: "Rota".into(), service_type: "Cambio pantalla".into(),
            service_types: "[\"Cambio pantalla\"]".into(), amount: 10.0, payment_method: "Efectivo Bs".into(),
            observations: String::new(), bank_fee_percent: 0.0, zelle_reference: String::new(),
            currency: "VES".into(), device_checklist: String::new(), color: "Negro".into(),
            screen_product_id: None,
discount_amount: 0.0,
            status: "Recibido".into(),
            iva_rate: 0.0, iva_mode: String::new(),
        };
        let base = db.add_service_order("Cliente", "0412", "", "", None, "", None, &[d]).unwrap();
        assert_eq!(base, "DEV-0001");
        let svcs = db.get_services("", "", "", "", "").unwrap();
        assert_eq!(svcs.len(), 1);
        assert!(svcs[0].group_id.is_none(), "Un solo equipo no forma grupo");
        assert_eq!(svcs[0].amount, 10.0);
        assert_eq!(db.next_order_num().unwrap(), "DEV-0002");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_add_service_order_rollback_and_validation() {
        let test_path = PathBuf::from("test_add_service_order_rollback.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let d = ServiceDeviceInput {
            model: "Samsung A15".into(), fault: "Rota".into(), service_type: "Cambio pantalla".into(),
            service_types: "[\"Cambio pantalla\"]".into(), amount: 10.0, payment_method: "Efectivo Bs".into(),
            observations: String::new(), bank_fee_percent: 0.0, zelle_reference: String::new(),
            currency: "VES".into(), device_checklist: String::new(), color: "Negro".into(),
            screen_product_id: None,
discount_amount: 0.0,
            status: "Recibido".into(),
            iva_rate: 0.0, iva_mode: String::new(),
        };
        // Sin día abierto → error de negocio (gate require_open_day)
        let err = db.add_service_order("C", "1", "", "", None, "", None, &[d.clone()]).unwrap_err();
        assert!(err.to_string().contains("Debe abrir el día"));
        // Sin equipos → error sin tocar la DB
        let err2 = db.add_service_order("C", "1", "", "", None, "", None, &[]).unwrap_err();
        assert!(err2.to_string().contains("al menos un equipo"));
        db.open_day(0.0, 40.5, 45.0).unwrap();
        // Equipo 2 con modelo vacío → rollback TOTAL (ninguna fila queda)
        let bad = ServiceDeviceInput { model: String::new(), ..d.clone() };
        let err3 = db.add_service_order("C", "1", "", "", None, "", None, &[d.clone(), bad]).unwrap_err();
        assert!(err3.to_string().contains("Equipo 2"), "El error indica qué equipo falló");
        assert_eq!(db.get_services("", "", "", "", "").unwrap().len(), 0, "Rollback: no queda ninguna fila");
        assert_eq!(db.next_order_num().unwrap(), "DEV-0001", "Los números no se consumen al hacer rollback");
        // Falla vacía es OPCIONAL: la orden de 2 equipos se guarda normal (la falla queda '')
        let no_fault = ServiceDeviceInput { fault: String::new(), ..d.clone() };
        db.add_service_order("C", "1", "", "", None, "", None, &[d.clone(), no_fault]).unwrap();
        let saved = db.get_services("", "", "", "", "").unwrap();
        assert_eq!(saved.len(), 2, "Falla vacía no bloquea la orden");
        assert!(saved.iter().any(|s| s.fault.as_deref().unwrap_or("").is_empty()), "La falla vacía se guarda tal cual");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_durability_pragmas() {
        let test_path = PathBuf::from("test_durability_pragmas.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // synchronous=FULL: ante un corte de luz no se pierde el último commit (durabilidad).
        let conn = db.conn.lock().unwrap();
        let sync: i64 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0)).unwrap();
        assert_eq!(sync, 2, "synchronous debe ser FULL (2) para no perder el último registro en un apagón");
        let journal: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(journal.to_lowercase(), "wal", "journal_mode debe ser WAL");
        let busy: i64 = conn.query_row("PRAGMA busy_timeout", [], |r| r.get(0)).unwrap();
        assert_eq!(busy, 5000, "busy_timeout debe ser 5000ms");
        drop(conn);

        // Con FULL, una escritura persiste y es legible con una conexión nueva (fsync real)
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let sid = db.add_service("ORD-DUR-1", "Cliente", "", "Samsung A1", "Rota", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        drop(db);

        let db2 = Database::new(&test_path).expect("Failed to reopen test DB");
        let svc = db2.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.order_num.as_deref(), Some("ORD-DUR-1"), "El registro debe persistir tras fsync FULL");
        drop(db2);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_title_case_helper() {
        assert_eq!(title_case("roberth silva"), "Roberth Silva");
        assert_eq!(title_case("MARÍA JOSÉ"), "María José");
        assert_eq!(title_case("  juan   perez  "), "Juan Perez");
        assert_eq!(title_case(""), "");
    }

    #[test]
    fn test_title_case_on_write_and_migration() {
        let test_path = PathBuf::from("test_title_case.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Los write points aplican title_case automáticamente
        let cid = db.add_client("roberth silva", "0412-1111111", "", "").unwrap();
        assert!(cid > 0);
        let cid2 = db.save_client(None, "MARIA LOPEZ", "0412-2222222", "V-111", "Av 1", "m@x.com", "nota").unwrap();
        assert!(cid2 > 0);
        let clients = db.get_clients("").unwrap();
        let r = clients.iter().find(|c| c.id == cid).unwrap();
        assert_eq!(r.name, "Roberth Silva", "add_client aplica title_case");
        let m = clients.iter().find(|c| c.id == cid2).unwrap();
        assert_eq!(m.name, "Maria Lopez", "save_client aplica title_case");
        assert_eq!(m.email.as_deref(), Some("m@x.com"));
        assert_eq!(m.address.as_deref(), Some("Av 1"));
        assert_eq!(m.notes.as_deref(), Some("nota"));

        // save_client con id=None + misma cédula → no duplica
        let again = db.save_client(None, "maria lopez", "", "V-111", "", "", "").unwrap();
        assert_eq!(again, cid2, "misma cédula → reutiliza el cliente existente");

        // Datos legacy en minúsculas via SQL directo (la migración de init ya corrió) → migración idempotente
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("INSERT INTO clients (name, phone) VALUES ('viejito ruiz', '000')", []).unwrap();
            conn.execute(
                "INSERT INTO services (order_num, client, phone, model, fault, service_type, service_types, amount, payment_method, status, currency, date_in) \
                 VALUES ('LEG-1','viejito ruiz','','M1','f','Cambio batería','[\"Cambio batería\"]',10,'Efectivo Bs','Recibido','USD','2026-08-07')",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO sales (product_name, quantity, unit_price, total, payment_method, client_name, currency, date) \
                 VALUES ('P1',1,10,10,'Efectivo Bs','viejito ruiz','VES','2026-08-07')",
                [],
            ).unwrap();
        }
        Database::migrate_title_case_names(&db.conn.lock().unwrap()).unwrap();
        {
            let conn = db.conn.lock().unwrap();
            let n: String = conn.query_row("SELECT name FROM clients WHERE phone='000'", [], |r| r.get(0)).unwrap();
            assert_eq!(n, "Viejito Ruiz", "migración normaliza clientes");
            let cn: String = conn.query_row("SELECT client FROM services WHERE order_num='LEG-1'", [], |r| r.get(0)).unwrap();
            assert_eq!(cn, "Viejito Ruiz", "migración normaliza services.client");
            let sn: String = conn.query_row("SELECT client_name FROM sales WHERE product_name='P1'", [], |r| r.get(0)).unwrap();
            assert_eq!(sn, "Viejito Ruiz", "migración normaliza sales.client_name");
        }
        // Idempotente: correr de nuevo no cambia nada
        Database::migrate_title_case_names(&db.conn.lock().unwrap()).unwrap();
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_save_client_rename_propagates() {
        let test_path = PathBuf::from("test_save_client_rename.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let cid = db.save_client(None, "juan perez", "0412-3333333", "V-222", "Calle 2", "", "").unwrap();
        db.add_sale(None, "P1", 1, 10.0, 10.0, "Efectivo Bs", "Juan Perez", Some(cid), "", 0.0, "", "VES", 0.0).unwrap();
        let sid = db.add_service("REN-1", "Juan Perez", "0412-3333333", "M1", "f", "Cambio batería",
            "[\"Cambio batería\"]", 20.0, "Efectivo Bs", "", 0.0, "", "USD", "V-222", "", "", Some(cid), "", None, "", None, 0.0).unwrap();

        // Renombrar el cliente → los snapshots se propagan
        db.save_client(Some(cid), "JUAN PÉREZ R.", "0412-3333333", "V-222", "Calle 2", "", "").unwrap();
        let sales = db.get_sales("", None, "", "").unwrap();
        assert_eq!(sales[0].client_name.as_deref(), Some("Juan Pérez R."), "rename propaga a sales.client_name");
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.client.as_deref(), Some("Juan Pérez R."), "rename propaga a services.client");
        let clients = db.get_clients("").unwrap();
        assert_eq!(clients[0].name, "Juan Pérez R.");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_get_day_summary() {
        let test_path = PathBuf::from("test_get_day_summary.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let sid = db.add_service("SUM-1", "Cliente", "", "M1", "f", "Cambio batería",
            "[\"Cambio batería\"]", 50.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        // Entregado hoy → delivered
        db.update_service(sid, "Cliente", "", "M1", "f", "Cambio batería", "[\"Cambio batería\"]", 50.0,
            "Divisas (USD Cash)", &today, "Entregado", "", 0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        // En taller (recibido hoy, sin entregar)
        let sid2 = db.add_service("SUM-2", "Cliente2", "", "M2", "g", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 30.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        // Abono hoy: $10 USD + Bs 2025 (≈ $50 a tasa 40.5)
        db.add_service_payment(sid, 10.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();
        db.add_service_payment(sid2, 2025.0, "Efectivo Bs", 0.0, "", "USD", "", "").unwrap();
        // Punto hoy: $100 cargado con comisión 3.5% → NETO $96.5 (D2: igual que la tabla del Libro)
        db.add_service_payment(sid, 100.0, "Punto de Venta ($)", 3.5, "", "USD", "", "").unwrap();
        // Venta hoy: $15 USD + 1 en Bs (VES 405)
        db.add_sale(None, "P1", 1, 15.0, 15.0, "Divisas (USD Cash)", "C1", None, "", 0.0, "", "USD", 0.0).unwrap();
        db.add_sale(None, "P2", 1, 10.0, 405.0, "Efectivo Bs", "C2", None, "", 0.0, "", "VES", 0.0).unwrap();

        let s = db.get_day_summary(&today).unwrap();
        assert_eq!(s.received, 2, "2 equipos recibidos hoy");
        assert_eq!(s.delivered, 1, "1 entregado hoy");
        assert_eq!(s.workshop, 1, "1 en taller");
        assert_eq!(s.payments_count, 3);
        assert!((s.payments_usd - 106.5).abs() < 1e-9, "pago USD directo + punto NETO (10 + 96.5): {}", s.payments_usd);
        assert!((s.payments_bs - 2025.0).abs() < 1e-9, "pago Bs por método Bs: {}", s.payments_bs);
        assert!((s.sales_usd - 15.0).abs() < 1e-9, "venta USD: {}", s.sales_usd);
        assert!((s.sales_bs - 405.0).abs() < 1e-9, "venta Bs: {}", s.sales_bs);
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_get_services_active_sentinel() {
        let test_path = PathBuf::from("test_active_sentinel.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        db.add_service("ACT-1", "Cliente A", "", "M1", "f", "Cambio batería",
            "[\"Cambio batería\"]", 10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap(); // Recibido
        db.add_service("ACT-2", "Cliente B", "", "M2", "g", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap(); // Recibido
        let sid3 = db.add_service("ACT-3", "Cliente C", "", "M3", "h", "Software / Formateo",
            "[\"Software / Formateo\"]", 10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        let sid4 = db.add_service("ACT-4", "Cliente D", "", "M4", "i", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 10.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        // Terminar dos: Entregado y Cancelado
        db.update_service(sid3, "Cliente C", "", "M3", "h", "Software / Formateo", "[\"Software / Formateo\"]", 10.0,
            "Efectivo Bs", "2026-08-07", "Entregado", "", 0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        db.update_service(sid4, "Cliente D", "", "M4", "i", "Cambio pantalla", "[\"Cambio pantalla\"]", 10.0,
            "Efectivo Bs", "", "Cancelado", "", 0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();

        let activos = db.get_services("", "__activos__", "", "", "").unwrap();
        assert_eq!(activos.len(), 2, "solo los equipos en taller");
        assert!(activos.iter().all(|s| s.status.as_deref() != Some("Entregado")));
        assert!(activos.iter().all(|s| s.status.as_deref() != Some("Cancelado")));
        let todos = db.get_services("", "", "", "", "").unwrap();
        assert_eq!(todos.len(), 4, "sin filtro sigue devolviendo todo");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_expenses_crud() {
        let test_path = PathBuf::from("test_expenses.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // Sin día abierto: los gastos NO requieren día (decisión de diseño)
        let e1 = db.add_expense("2026-08-19", "Alquiler", 100.0, "USD", "Local", "Divisas (USD Cash)").unwrap();
        let _e2 = db.add_expense("2026-08-19", "Servicios", 2500.0, "VES", "Luz", "").unwrap();
        let e3 = db.add_expense("2026-08-18", "Retiro del dueño", 20.0, "USD", "", "Divisas (USD Cash)").unwrap();
        let err = db.add_expense("2026-08-19", "Otro", 0.0, "USD", "", "").unwrap_err();
        assert!(err.to_string().contains("mayor que 0"), "monto 0 rechazado");
        // F69: un método declarado que NO existe en el sistema se rechaza (la moneda del cajón que
        // se descuenta tiene que ser una de verdad).
        let err = db.add_expense("2026-08-19", "Otro", 1.0, "USD", "", "De la gaveta").unwrap_err();
        assert!(err.to_string().contains("no es un método de pago"), "método inventado rechazado: {}", err);

        let todos = db.get_expenses("2026-08-01", "2026-08-31").unwrap();
        assert_eq!(todos.len(), 3);
        assert!((todos.iter().filter(|e| e.currency == "USD").map(|e| e.amount).sum::<f64>() - 120.0).abs() < 1e-9);
        assert!((todos.iter().filter(|e| e.currency == "VES").map(|e| e.amount).sum::<f64>() - 2500.0).abs() < 1e-9);

        let solo_ayer = db.get_expenses("2026-08-18", "2026-08-18").unwrap();
        assert_eq!(solo_ayer.len(), 1);
        assert_eq!(solo_ayer[0].id, e3);

        db.delete_expense(e1).unwrap();
        assert!(db.delete_expense(9999).is_err(), "borrar inexistente falla");
        assert_eq!(db.get_expenses("2026-08-01", "2026-08-31").unwrap().len(), 2);
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_profit_summary() {
        let test_path = PathBuf::from("test_profit.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        // Producto con costo 30, venta $80 (USD) + venta Bs 405 (≈$10 a tasa 40.5)
        let pid = db.add_product("Repuesto A", Some(1), "Marca", "M1", "", "[]", 30.0, 80.0, 5, 0, 90.0).unwrap();
        db.add_sale(Some(pid), "Repuesto A", 1, 80.0, 80.0, "Divisas (USD Cash)", "C1", None, "", 0.0, "", "USD", 0.0).unwrap();
        db.add_sale(None, "Repuesto B", 1, 10.0, 405.0, "Efectivo Bs", "C2", None, "", 0.0, "", "VES", 0.0).unwrap();

        // Servicio con pantalla exacta (costo 15), cobrado $50 USD, entregado hoy
        let screen = db.add_product("Pantalla X", Some(1), "Marca", "M2", "", "[]", 15.0, 40.0, 3, 0, 45.0).unwrap();
        let sid = db.add_service("PRF-1", "Cliente", "", "M2", "f", "Cambio pantalla",
            "[\"Cambio pantalla\"]", 50.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.update_service(sid, "Cliente", "", "M2", "f", "Cambio pantalla", "[\"Cambio pantalla\"]", 50.0,
            "Divisas (USD Cash)", &today, "Entregado", "", 0.0, "", "USD", "", "", "", "", None, "", Some(screen), 0.0).unwrap();
        db.add_service_payment(sid, 50.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();

        let p = db.get_profit_summary(&today, &today).unwrap();
        // Ingresos: $80 + $50 (USD) + Bs 405→$10 = $140
        assert!((p.income_usd - 140.0).abs() < 1e-6, "ingresos USD equiv: {}", p.income_usd);
        assert!((p.income_bs - 405.0).abs() < 1e-6);
        // Costo: 30 (venta) + 15 (pantalla) = 45
        assert!((p.cost_usd - 45.0).abs() < 1e-6, "costo: {}", p.cost_usd);
        // Utilidad: 140 − 45 = 95; margen ≈ 67.86%
        assert!((p.profit_usd - 95.0).abs() < 1e-6, "utilidad: {}", p.profit_usd);
        assert!((p.margin_pct - 95.0 / 140.0 * 100.0).abs() < 1e-6);
        assert!((p.sales_income_usd - 80.0).abs() < 1e-6);
        assert!((p.sales_income_bs - 405.0).abs() < 1e-6);
        assert!((p.sales_cost_usd - 30.0).abs() < 1e-6);
        assert!((p.services_income_usd - 50.0).abs() < 1e-6);
        assert!((p.services_cost_usd - 15.0).abs() < 1e-6);
        assert!(p.tasa_bcv > 0.0);
        // Rango vacío → todo 0, sin pánico
        let vacio = db.get_profit_summary("2026-01-01", "2026-01-02").unwrap();
        assert_eq!(vacio.income_usd, 0.0);
        assert_eq!(vacio.profit_usd, 0.0);
        assert_eq!(vacio.margin_pct, 0.0);
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_receivables_buckets() {
        let test_path = PathBuf::from("test_receivables.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let days_ago = |n: i64| {
            (chrono::Local::now() - chrono::Duration::days(n)).format("%Y-%m-%d").to_string()
        };
        let mk = |order: &str, amount: f64, status: &str| {
            let sid = db.add_service(order, "Cliente", "", "M", "f", "Cambio batería",
                "[\"Cambio batería\"]", amount, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
            db.update_service(sid, "Cliente", "", "M", "f", "Cambio batería", "[\"Cambio batería\"]", amount,
                "Divisas (USD Cash)", "", status, "", 0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
            sid
        };
        // Sin pagos, entrado hoy → 0-7 días
        mk("REC-1", 100.0, "Recibido");
        // Abonó 20 de 50, entrado hace 10 días → 8-30
        let s2 = mk("REC-2", 50.0, "Recibido");
        let old2 = days_ago(10);
        db.conn.lock().unwrap().execute("UPDATE services SET date_in=?1 WHERE id=?2", params![old2, s2]).unwrap();
        db.add_service_payment(s2, 20.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();
        // Entrado hace 40 días, sin pagos → +30 días
        let s3 = mk("REC-3", 40.0, "Por entregar");
        let old3 = days_ago(40);
        db.conn.lock().unwrap().execute("UPDATE services SET date_in=?1 WHERE id=?2", params![old3, s3]).unwrap();
        // Entregado con saldo SÍ cuenta (entrega con saldo es válida)
        let s4 = mk("REC-4", 60.0, "Recibido");
        db.update_service(s4, "Cliente", "", "M", "f", "Cambio batería", "[\"Cambio batería\"]", 60.0,
            "Divisas (USD Cash)", &today, "Entregado", "", 0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        // Cancelado/Devuelto NO cuentan
        mk("REC-5", 999.0, "Cancelado");
        mk("REC-6", 999.0, "Devuelto");

        let r = db.get_receivables().unwrap();
        assert_eq!(r.count, 4, "solo activos con saldo: {}", r.count);
        assert!((r.total_usd - 230.0).abs() < 1e-6, "total: {}", r.total_usd);
        assert_eq!(r.buckets[0].count, 2, "0-7 días: REC-1 + REC-4");
        assert_eq!(r.buckets[1].count, 1, "8-30 días: REC-2");
        assert_eq!(r.buckets[2].count, 1, "+30 días: REC-3");
        assert!((r.buckets[0].total_usd - 160.0).abs() < 1e-6);
        assert!((r.buckets[1].total_usd - 30.0).abs() < 1e-6);
        assert!((r.buckets[2].total_usd - 40.0).abs() < 1e-6);
        assert_eq!(r.items.len(), 4);
        assert_eq!(r.items[0].order_num.as_deref(), Some("REC-1"), "top por saldo");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_inventory_value() {
        let test_path = PathBuf::from("test_inventory_value.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.add_product("A", Some(1), "M1", "X", "", "[]", 10.0, 25.0, 5, 0, 30.0).unwrap();  // 50 costo, 125/150
        db.add_product("B", Some(2), "M2", "Y", "", "[]", 100.0, 200.0, 2, 0, 220.0).unwrap(); // 200 costo
        db.add_product("C", Some(1), "M3", "Z", "", "[]", 0.0, 5.0, 10, 0, 5.0).unwrap();     // stock sí, costo 0
        db.add_product("D", Some(1), "M4", "W", "", "[]", 10.0, 25.0, 0, 0, 30.0).unwrap();   // stock 0 → no cuenta

        let v = db.get_inventory_value().unwrap();
        assert_eq!(v.units, 17, "5+2+10, el de stock 0 no cuenta");
        assert!((v.cost_usd - 250.0).abs() < 1e-6, "50+200+0: {}", v.cost_usd);
        assert!((v.sale_usd - 575.0).abs() < 1e-6, "125+400+50: {}", v.sale_usd);
        assert!(!v.categories.is_empty(), "top categorías poblado");
        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    // --- Inventario unificado (F4): página, KPIs, teléfonos, pantallas, movimientos ---

    /// Feature 27: `category_name` tiene que ser el NOMBRE REAL de la categoría.
    /// Con `SELECT p.*, c.name` el mapeo posicional leía `search_text` (cid 14) y la
    /// columna «Categoría» del inventario mostraba el texto normalizado de búsqueda.
    #[test]
    fn test_product_category_name_is_real_category() {
        let test_path = PathBuf::from("test_category_name.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.add_product("Pantalla Xiaomi Redmi Note 11", Some(1), "Xiaomi", "Note 11", "", r#"["Xiaomi Redmi Note 11"]"#, 5.0, 12.0, 3, 1, 7.0).unwrap();
        // min_stock 1 con stock 0 → entra en «bajo mínimo» y en sugerencias de reposición
        db.add_product("Táctil Xiaomi Redmi Note 11", Some(2), "Xiaomi", "Note 11", "", r#"["Xiaomi Redmi Note 11"]"#, 2.0, 6.0, 0, 1, 0.0).unwrap();

        let cats: std::collections::HashMap<i64, String> = db
            .get_categories()
            .unwrap()
            .into_iter()
            .map(|c| (c.id, c.name))
            .collect();

        let ok = |label: &str, items: &[Product]| {
            assert!(!items.is_empty(), "{label}: sin resultados");
            for p in items {
                let expected = p.category_id.and_then(|id| cats.get(&id)).cloned();
                assert_eq!(
                    p.category_name, expected,
                    "{label}: category_name = {:?}, esperaba el nombre real de la categoría — producto {}",
                    p.category_name, p.name
                );
                assert!(p.price_usd >= 0.0, "{label}: price_usd sigue leyéndose en 13");
            }
        };

        ok("get_products", &db.get_products("", None).unwrap());
        ok("get_products_page", &db.get_products_page("", None, None, None, None, None, 50, 0).unwrap().items);
        ok("get_low_stock_products", &db.get_low_stock_products().unwrap());
        ok("get_reorder_suggestions", &db.get_reorder_suggestions().unwrap());
        ok("suggest_products", &db.suggest_products("note", 10).unwrap());
        ok("find_compatible_products", &db.find_compatible_products("Note 11", None, 10).unwrap().into_iter().map(|c| c.product).collect::<Vec<_>>());

        // la categoría concreta: id 1 = Pantalla (la de la ficha de la pantalla)
        let all = db.get_products("", None).unwrap();
        let pantalla = all.iter().find(|p| p.name.starts_with("Pantalla")).unwrap();
        assert_eq!(pantalla.category_id, Some(1));
        assert_eq!(pantalla.category_name.as_deref(), Some("Pantalla"), "no el search_text del producto");
        let otra = all.iter().find(|p| p.name.starts_with("Táctil")).unwrap();
        assert_eq!(otra.category_name, cats.get(&otra.category_id.unwrap()).cloned(), "categoría id {:?}", otra.category_id);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_get_products_page_filters_and_total() {
        let test_path = PathBuf::from("test_products_page.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // la marca/modelo se guardan CANÓNICOS (Redmi -> Xiaomi)
        db.add_product("Pantalla Redmi 10 4G", Some(1), "Redmi", "Red 10 4G", "", r#"["Red 10 4G"]"#, 10.0, 20.0, 5, 2, 0.0).unwrap();
        db.add_product("Pantalla Samsung A06", Some(1), "Samsung", "A06 4G", "", r#"["Samsung A06 4G"]"#, 8.0, 15.0, 0, 2, 0.0).unwrap();
        db.add_product("Táctil Tecno", Some(2), "Tecno", "Spark 8C", "", r#"["Tecno Spark 8C"]"#, 0.0, 0.0, -1, 0, 0.0).unwrap();

        let all = db.get_products_page("", None, None, None, None, None, 50, 0).unwrap();
        assert_eq!(all.total, 3);
        assert_eq!(all.items.len(), 3);

        // búsqueda con la jerga vieja sobre catálogo canónico
        let red = db.get_products_page("red note", None, None, None, None, None, 50, 0).unwrap();
        assert_eq!(red.total, 0, "no hay Redmi Note en este fixture");
        let old = db.get_products_page("Red 10", None, None, None, None, None, 50, 0).unwrap();
        assert_eq!(old.total, 1, "'Red 10' encuentra 'Redmi 10 4G'");

        // filtros
        let out = db.get_products_page("", None, None, Some("agotado"), None, None, 50, 0).unwrap();
        assert_eq!(out.total, 1);
        let neg = db.get_products_page("", None, None, Some("negativo"), None, None, 50, 0).unwrap();
        assert_eq!(neg.total, 1);
        let low = db.get_products_page("", None, None, Some("bajo_minimo"), None, None, 50, 0).unwrap();
        assert_eq!(low.total, 1, "solo el de stock 0 con min 2 (el negativo tiene min 0)");
        let cat = db.get_products_page("", Some(2), None, None, None, None, 50, 0).unwrap();
        assert_eq!(cat.total, 1, "filtro por categoría");
        let brand = db.get_products_page("", None, Some("Xiaomi"), None, None, None, 50, 0).unwrap();
        assert_eq!(brand.total, 1, "filtro por marca canónica");

        // paginación
        let p1 = db.get_products_page("", None, None, None, None, Some("stock"), 2, 0).unwrap();
        assert_eq!(p1.total, 3);
        assert_eq!(p1.items.len(), 2);
        let p2 = db.get_products_page("", None, None, None, None, Some("stock"), 2, 2).unwrap();
        assert_eq!(p2.items.len(), 1);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F51 — TODAS las claves de orden por columna existen y son SQL válido.
    ///
    /// El bug real que esto evita (medido en vivo): el encabezado mandaba `costo_desc` y la clave no
    /// estaba en el `match`, así que caía en el `_ => "p.name"` y el clic **no hacía nada** (la tabla
    /// se veía igual). Un test que solo mira el código no lo ve; esto ejecuta cada clave contra SQLite.
    #[test]
    fn test_product_sort_keys_are_valid() {
        let test_path = PathBuf::from("test_sort_keys.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.add_product("P1", Some(1), "Xiaomi", "Redmi 9A", "INCELL", r#"["Xiaomi Redmi 9A"]"#, 5.0, 10.0, 2, 1, 0.0).unwrap();
        db.add_product("P2", Some(1), "Samsung", "A70", "OLED", r#"["Samsung A70"]"#, 7.0, 15.0, 0, 1, 0.0).unwrap();

        // Las DOS claves de cada columna que ofrece la tabla (más las viejas del desplegable).
        for key in [
            "nombre", "nombre_desc", "marca", "marca_desc", "modelo", "modelo_desc",
            "variante", "variante_desc", "categoria", "categoria_desc", "stock", "stock_desc",
            "stock_asc", "precio", "precio_desc", "precio_asc", "costo", "costo_desc", "costo_asc",
            "minimo", "minimo_desc", "minimo_asc", "reciente",
        ] {
            let page = db.get_products_page("", None, None, Some("todos"), None, Some(key), 50, 0)
                .unwrap_or_else(|e| panic!("la clave de orden «{key}» rompe la consulta: {e}"));
            assert_eq!(page.total, 2, "la clave «{key}» no debe filtrar nada");
        }

        // Y que ORDENE de verdad: el más caro primero con `precio` y el más barato con `precio_desc`.
        let caro = db.get_products_page("", None, None, Some("todos"), None, Some("precio"), 50, 0).unwrap();
        assert_eq!(caro.items[0].name, "P2", "precio = más caro primero");
        let barato = db.get_products_page("", None, None, Some("todos"), None, Some("precio_desc"), 50, 0).unwrap();
        assert_eq!(barato.items[0].name, "P1", "precio_desc = más barato primero");
        let variante = db.get_products_page("", None, None, Some("todos"), None, Some("variante"), 50, 0).unwrap();
        assert_eq!(variante.items[0].variant.as_deref(), Some("INCELL"), "variante ordena por su valor");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F50 — «LO QUE USO» (el check) + CÓDIGOS de referencia (`P-0001` / `M-0001`).
    ///
    /// Lo que fija: (1) las columnas nacen en la migración con su SEED (queda en uso lo que tiene
    /// stock); (2) los códigos se asignan solos; (3) el check del producto y el del modelo son
    /// comandos ANGOSTOS que no tocan nada más; (4) `set_phone_use_all` prende el teléfono Y sus
    /// repuestos; (5) el formulario de servicio (`get_phone_models_filtered`) puede ofrecer SOLO lo
    /// que el local usa, sin perder el camino de «ver todos».
    #[test]
    fn test_in_use_and_codes() {
        let test_path = PathBuf::from("test_in_use.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // P1 con stock (debería quedar EN USO) y P2 sin stock (apagado)
        db.add_product("Pantalla Xiaomi Redmi 9A", Some(1), "Xiaomi", "Redmi 9A", "INCELL",
            r#"["Xiaomi Redmi 9A"]"#, 5.0, 10.0, 3, 1, 0.0).unwrap();
        db.add_product("Pantalla Samsung A70", Some(1), "Samsung", "A70", "OLED",
            r#"["Samsung A70"]"#, 7.0, 15.0, 0, 1, 0.0).unwrap();

        // (1) SEED + (2) códigos
        let con_stock = db.get_products_page("", None, None, Some("con_stock"), None, Some("nombre"), 10, 0).unwrap();
        assert_eq!(con_stock.items[0].in_use, 1, "lo que tiene stock queda EN USO al migrar");
        assert!(con_stock.items[0].code.starts_with("P-"), "el código del producto es P-… ({})", con_stock.items[0].code);
        let sin_stock = db.get_products_page("", None, None, Some("agotado"), None, Some("nombre"), 10, 0).unwrap();
        assert_eq!(sin_stock.items[0].in_use, 0, "lo agotado queda apagado (se prende a mano)");

        // (3) el check del producto es angosto: cambia `in_use` y NADA más
        let pid = con_stock.items[0].id;
        let leer = |id: i64| db.get_products_page("", None, None, Some("todos"), None, Some("nombre"), 50, 0)
            .unwrap().items.into_iter().find(|p| p.id == id).unwrap();
        let antes = leer(pid);
        db.set_product_in_use(pid, false).unwrap();
        let despues = leer(pid);
        assert_eq!(despues.in_use, 0);
        assert_eq!(despues.stock, antes.stock, "el check NO toca el stock");
        assert_eq!(despues.price_sale, antes.price_sale, "el check NO toca el precio");
        assert_eq!(despues.compatibility, antes.compatibility, "el check NO toca la compatibilidad");
        // el filtro del inventario lo respeta
        assert_eq!(db.get_products_page("", None, None, Some("solo_uso"), None, Some("nombre"), 10, 0).unwrap().total, 0);
        assert_eq!(db.get_products_page("", None, None, Some("sin_uso"), None, Some("nombre"), 10, 0).unwrap().total, 2);
        db.set_product_in_use(pid, true).unwrap();

        // (3b) la ficha también se encuentra por su CÓDIGO (como la dicta el local): con el guion y
        // sin él. Es la otra mitad del «check con su número» que pidió el dueño.
        let cod = leer(pid).code;
        assert!(!cod.is_empty(), "el producto tiene código para dictar");
        for escrito in [cod.clone(), cod.replace('-', "")] {
            let hallado = db.get_products_page(&escrito, None, None, Some("todos"), None, Some("nombre"), 10, 0).unwrap();
            assert!(hallado.items.iter().any(|p| p.id == pid), "se encuentra por código «{escrito}» ({cod})");
        }

        // (4) el padrón y su check: el teléfono con repuesto EN USO queda en uso; el otro no
        let (phone_redmi, phone_samsung) = {
            let conn = db.conn.lock().unwrap();
            let uno = |like: &str| conn.query_row(
                "SELECT id, COALESCE(code,''), COALESCE(in_use,0) FROM phones WHERE name LIKE ?1",
                params![like], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
            ).unwrap();
            (uno("%Redmi 9A%"), uno("%A70%"))
        };
        assert_eq!(phone_redmi.2, 1, "el modelo con repuesto en uso queda EN USO");
        assert!(phone_redmi.1.starts_with("M-"), "el modelo nace con código M-… ({})", phone_redmi.1);
        assert_eq!(phone_samsung.2, 0, "el modelo sin repuesto en uso queda apagado");

        // (4b) la REGLA DEL SEED, probada sobre la MISMA función que corre en la migración (`init()`):
        // un catálogo que ya existía (repuesto en uso y con stock) prende su teléfono, y el padrón
        // sale numerado. Se simula una base de la versión vieja (todo apagado y sin códigos).
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("UPDATE phones SET in_use=0, code=NULL", []).unwrap();
            conn.execute("UPDATE products SET in_use = CASE WHEN stock > 0 THEN 1 ELSE 0 END", []).unwrap();
            crate::phones::seed_phone_in_use(&conn).unwrap();
            conn.execute("UPDATE phones SET code = 'M-' || printf('%04d', id) WHERE code IS NULL OR code=''", []).unwrap();
            let en_uso: i64 = conn.query_row(
                "SELECT COUNT(*) FROM phones WHERE COALESCE(in_use,0)=1", [], |r| r.get(0)).unwrap();
            assert_eq!(en_uso, 1, "el seed prende SOLO el teléfono con repuesto en uso y con stock");
            let code: String = conn.query_row(
                "SELECT COALESCE(code,'') FROM phones WHERE name LIKE '%Redmi 9A%'", [], |r| r.get(0)).unwrap();
            assert!(code.starts_with("M-"), "el padrón queda numerado para poder dictarlo ({code})");
        }

        // «usar todo el modelo» prende el teléfono Y sus repuestos (una transacción)
        let n = db.set_phone_use_all(phone_samsung.0, true).unwrap();
        assert!(n >= 1, "marcó al menos un repuesto del modelo (marcó {n})");
        {
            let conn = db.conn.lock().unwrap();
            let in_use: i64 = conn.query_row("SELECT COALESCE(in_use,0) FROM phones WHERE id=?1",
                params![phone_samsung.0], |r| r.get(0)).unwrap();
            assert_eq!(in_use, 1, "el modelo quedó en uso");
        }
        let n2 = db.set_phone_use_all(phone_samsung.0, false).unwrap();
        assert!(n2 >= 1, "apagó al menos un repuesto (apagó {n2})");
        assert_eq!(db.get_products_page("", None, None, Some("solo_uso"), None, Some("nombre"), 10, 0).unwrap().total, 1,
            "quedó en uso solo el producto del otro modelo");

        // (5) el formulario de servicio: solo lo que se usa, y «ver todos» lo trae todo
        let solo_uso = db.get_phone_models_filtered("", 50, true).unwrap();
        let todos = db.get_phone_models_filtered("", 50, false).unwrap();
        assert!(solo_uso.iter().all(|p| p.in_use == 1), "con in_use_only solo salen los marcados");
        assert!(todos.len() > solo_uso.len(), "«ver todos» trae más que «solo lo que uso» ({solo_uso:?} vs {} )", todos.len());
        let con_uso = db.get_phone_models_filtered("", 50, false).unwrap().iter().find(|p| p.label.contains("Redmi 9A")).unwrap().clone();
        assert_eq!(con_uso.in_use, 1);
        assert!(!con_uso.code.is_empty(), "el modelo del formulario trae su código");
        // buscar por CÓDIGO (el local lo dicta)
        let por_codigo = db.get_phone_models_filtered(&con_uso.code, 50, false).unwrap();
        assert!(por_codigo.iter().any(|p| p.label == con_uso.label), "se puede buscar por código ({})", con_uso.code);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_inventory_stats_counts() {
        let test_path = PathBuf::from("test_inv_stats.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.add_product("P1", Some(1), "Tecno", "Spark 8C", "", r#"["Tecno Spark 8C"]"#, 10.0, 20.0, 3, 1, 0.0).unwrap();
        db.add_product("P2", Some(1), "Tecno", "Spark 8C", "", r#"["Tecno Spark 8C"]"#, 10.0, 20.0, 1, 1, 0.0).unwrap(); // duplicado
        db.add_product("P3", Some(2), "Samsung", "A06 4G", "", "[]", 0.0, 0.0, 0, 0, 0.0).unwrap();  // sin precio y sin compat
        db.add_product("P4", Some(1), "Blu", "G73", "", r#"["Blu G73"]"#, 5.0, 9.0, -2, 0, 0.0).unwrap();

        let s = db.get_inventory_stats().unwrap();
        assert_eq!(s.sku, 4);
        assert_eq!(s.with_stock, 2);
        assert_eq!(s.out_of_stock, 1);
        assert_eq!(s.negative, 1);
        assert_eq!(s.low_stock, 1, "solo P2 (stock 1 <= min 1); P1 3>1 y P4 tiene min 0");
        assert_eq!(s.no_price, 1);
        assert_eq!(s.no_compat, 1);
        assert_eq!(s.units, 2, "3+1+0-2");
        assert!((s.value_cost - 30.0).abs() < 1e-6, "3*10 + 1*10 - 2*5 = 30");
        assert_eq!(s.duplicate_groups, 1);
        assert_eq!(s.duplicate_ids.len(), 2);
        assert!(s.by_category.iter().any(|c| c.name == "Pantalla" && c.sku == 3));

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_phone_models_dedup_and_screens_ranking() {
        let test_path = PathBuf::from("test_phone_models.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // el MISMO teléfono escrito de dos formas (con y sin submarca) + una sin marca
        db.add_product("Pantalla Redmi Note 11 Incell", Some(1), "Redmi", "Redmi Note 11", "INCELL",
            r#"["Redmi Note 11","Note 11","Redmi 11S 4g"]"#, 10.0, 20.0, 0, 0, 0.0).unwrap();
        db.add_product("Pantalla Redmi Note 11 OLED", Some(1), "Xiaomi", "Redmi Note 11", "OLED",
            r#"["Xiaomi Note 11"]"#, 12.0, 25.0, 4, 0, 0.0).unwrap();
        db.add_product("Pantalla Samsung A06 4G", Some(1), "Samsung", "A06 4G", "",
            r#"["Samsung A06 4G"]"#, 8.0, 15.0, 2, 0, 0.0).unwrap();

        // La lista viene del PADRÓN: nombre comercial (línea + modelo) y una sola ficha
        // por teléfono, con la marca aparte.
        let phones = db.get_phone_models("", 100).unwrap();
        let note11: Vec<_> = phones.iter().filter(|p| p.label.contains("Note 11")).collect();
        assert_eq!(note11.len(), 1, "el mismo teléfono NO se duplica: {:?}", phones.iter().map(|p| &p.label).collect::<Vec<_>>());
        assert_eq!(note11[0].label, "Redmi Note 11", "nombre comercial del padrón");
        assert_eq!(note11[0].brand, "Xiaomi");
        assert_eq!(note11[0].screens, 2);
        assert_eq!(note11[0].stock, 4, "0 + 4 unidades");

        // búsqueda de teléfonos
        let sam = db.get_phone_models("a06", 100).unwrap();
        assert_eq!(sam.len(), 1);
        assert_eq!(sam[0].label, "Galaxy A06 4G", "nombre comercial del padrón");
        assert_eq!(sam[0].brand, "Samsung");

        // el nombre del PADRÓN («Galaxy A06 4G») encuentra su pantalla aunque el inventario
        // la tenga escrita con la marca («Samsung A06 4G»): se resuelven los alias
        let sam_screens = db.find_compatible_screens("Galaxy A06 4G", 10).unwrap();
        assert_eq!(sam_screens.len(), 1, "la pantalla del Samsung A06");
        assert_eq!(sam_screens[0].match_quality, "exacta", "los alias la vuelven coincidencia exacta");

        // pantallas compatibles RANKEADAS: primero la coincidencia EXACTA y, dentro de cada
        // nivel, la que TIENE STOCK. Ahora las dos variantes son «exacta» (los alias del
        // padrón —«Note 11»— también cuentan), así que gana la que hay en vitrina (OLED).
        let screens = db.find_compatible_screens("Redmi Note 11", 10).unwrap();
        assert_eq!(screens.len(), 2, "las dos variantes sirven");
        assert_eq!(screens[0].match_quality, "exacta");
        assert_eq!(screens[1].match_quality, "exacta");
        assert_eq!(screens[0].product.variant.as_deref(), Some("OLED"), "exacta y con stock");
        assert!(screens[0].in_stock);
        assert_eq!(screens[1].product.variant.as_deref(), Some("INCELL"));
        assert!(!screens[1].in_stock, "exacta pero sin stock: queda segunda");
        // la búsqueda por una variante del nombre ("11S 4G" vs "Redmi 11S 4G")
        // cae en 'prefijo'/'parcial' y encuentra la pantalla que la declara
        let screens2 = db.find_compatible_screens("11S 4G", 10).unwrap();
        assert_eq!(screens2.len(), 1, "encuentra la pantalla que declara 'Redmi 11S 4G'");
        assert_eq!(screens2[0].product.variant.as_deref(), Some("INCELL"));
        let none = db.find_compatible_screens("Zzz 1", 10).unwrap();
        assert!(none.is_empty());

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_movements_page_and_merge_products() {
        let test_path = PathBuf::from("test_movements_page.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        let keep = db.add_product("P1", Some(1), "Tecno", "Spark 8C", "", r#"["Tecno Spark 8C"]"#, 10.0, 20.0, 3, 0, 0.0).unwrap();
        let dup = db.add_product("P2 duplicado", Some(1), "Tecno", "SPARK 8C", "", r#"["Tecno SPARK 8C"]"#, 10.0, 20.0, 2, 0, 0.0).unwrap();
        db.add_inventory_movement(keep, "entrada", 3, "Ajuste", "manual").unwrap();
        db.add_inventory_movement(dup, "salida", 1, "Servicio Entregado", "DEV-0009").unwrap();

        let page = db.get_inventory_movements_page(None, None, None, None, None, 10, 0).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.items.len(), 2);
        let by_type = db.get_inventory_movements_page(None, Some("salida"), None, None, None, 10, 0).unwrap();
        assert_eq!(by_type.total, 1);
        assert_eq!(by_type.items[0].reference.as_deref(), Some("DEV-0009"));
        let by_prod = db.get_inventory_movements_page(Some(dup), None, None, None, None, 10, 0).unwrap();
        assert_eq!(by_prod.total, 1);
        let by_reason = db.get_inventory_movements_page(None, None, Some("Ajuste"), None, None, 10, 0).unwrap();
        assert_eq!(by_reason.total, 1);
        // paginación
        let p2 = db.get_inventory_movements_page(None, None, None, None, None, 1, 1).unwrap();
        assert_eq!(p2.total, 2);
        assert_eq!(p2.items.len(), 1);

        // Fusión de duplicados: suma stock y repunta los movimientos.
        // Ojo: add_inventory_movement YA ajusta el stock (keep 3+3=6, dup 2-1=1) → 7.
        db.merge_products(keep, dup).unwrap();
        let merged_stock: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![keep], |r| r.get(0)).unwrap()
        });
        assert_eq!(merged_stock, 7, "6 del que se queda + 1 del duplicado");
        let after = db.get_inventory_movements_page(Some(keep), None, None, None, None, 10, 0).unwrap();
        assert_eq!(after.total, 2, "los dos movimientos quedaron en el producto que se queda");
        let gone = db.get_products_page("duplicado", None, None, None, None, None, 10, 0).unwrap();
        assert_eq!(gone.total, 0, "el duplicado se borró");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    #[test]
    fn test_service_stock_faltante_and_order_reference() {
        // Entregar una pantalla SIN stock deja faltante registrado y el movimiento
        // guarda el número de orden (trazabilidad), no un genérico "Servicio".
        let test_path = PathBuf::from("test_faltante.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let pid = db.add_product("Pantalla Tecno SPARK 8C", Some(1), "Tecno", "Spark 8C", "",
            r#"["Tecno Spark 8C"]"#, 10.0, 20.0, 0, 0, 0.0).unwrap();

        let sid = db.add_service("DEV-0042", "Ana", "", "Tecno Spark 8C", "rota", "Cambio pantalla",
            r#"["Cambio pantalla"]"#, 20.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "{}",
            None, "", None, "", Some(pid), 0.0).unwrap();
        db.update_service(sid, "Ana", "", "Tecno Spark 8C", "rota", "Cambio pantalla",
            r#"["Cambio pantalla"]"#, 20.0, "Divisas (USD Cash)", "", "Entregado", "", 0.0, "", "USD",
            "", "", "{}", "", None, "", Some(pid), 0.0).unwrap();

        let (stock, reason, reference): (i64, String, String) = conn_query(|| {
            let c = db.conn.lock().unwrap();
            let stock: i64 = c.query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap();
            let (reason, reference): (String, String) = c
                .query_row("SELECT reason, reference FROM inventory_movements ORDER BY id DESC LIMIT 1", [], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .unwrap();
            (stock, reason, reference)
        });
        assert_eq!(stock, -1, "sin stock queda en faltante visible");
        assert_eq!(reason, "Servicio Entregado (faltante)");
        assert_eq!(reference, "DEV-0042");

        // Reabrir devuelve el faltante a 0
        db.update_service(sid, "Ana", "", "Tecno Spark 8C", "rota", "Cambio pantalla",
            r#"["Cambio pantalla"]"#, 20.0, "Divisas (USD Cash)", "", "Recibido", "", 0.0, "", "USD",
            "", "", "{}", "", None, "", Some(pid), 0.0).unwrap();
        let back: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(back, 0, "reabrir devuelve el faltante");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// GATE DE MARCA de la pantalla a instalar (B2 de la validación pre-producción).
    /// Casos REALES medidos en el catálogo del local: el modelo sin marca cruzaba teléfonos
    /// de marcas distintas y el formulario elegía SOLO una pantalla de otra marca:
    ///   «Honor 10 Lite» → «Infinix Hot 10 Lite» (5 unidades)
    ///   «A11» (Umidigi) → «Samsung A11» (5 unidades)
    ///   «Realme 11 5G»  → «Xiaomi Redmi Note 11 5G» (4 unidades)
    /// La marca del teléfono sale del PADRÓN (`phones`); si el modelo se escribe a mano con
    /// la marca delante, del texto.
    #[test]
    fn test_brand_gate_screens() {
        let test_path = PathBuf::from("test_registro_brand_gate.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Pantallas: la de OTRA marca tiene stock a montones; la del teléfono está agotada.
        // Si el gate no funcionara, gana la de otra marca solo por tener stock.
        let honor = db.add_product("Pantalla Honor 10 Lite", Some(1), "Honor", "10 Lite", "",
            r#"["Honor 10 Lite"]"#, 5.0, 12.0, 0, 0, 0.0).unwrap();
        let infinix = db.add_product("Pantalla Infinix Hot 10 Lite", Some(1), "Infinix", "Hot 10 Lite", "",
            r#"["Hot 10 Lite"]"#, 4.0, 9.0, 5, 0, 0.0).unwrap();
        // Ficha sin marca propia que SÍ nombra el teléfono en su compatibilidad: cuenta como
        // coincidencia de marca (la compatibilidad curada manda sobre la columna brand).
        let generico = db.add_product("Pantalla 10 Lite compatible", Some(1), "", "10 Lite", "",
            r#"["Honor 10 Lite"]"#, 3.0, 8.0, 0, 0, 0.0).unwrap();
        // El padrón dice que «10 Lite» es un Honor
        {
            let c = db.conn.lock().unwrap();
            c.execute(
                "INSERT INTO phones (brand, line, model, name, key, aliases, source)
                 VALUES ('Honor', '', '10 Lite', 'Honor 10 Lite', 'honor 10 lite', '[\"10 Lite\"]', 'catalogo')",
                [],
            ).unwrap();
        }

        let cands = db.find_compatible_products("Honor 10 Lite", Some(1), 20).unwrap();
        let by_id: Vec<(i64, bool, String, bool)> = cands.iter()
            .map(|c| (c.product.id, c.brand_match, c.match_quality.clone(), c.in_stock))
            .collect();
        assert!(by_id.len() >= 3, "esperaba las 3 fichas, salió {by_id:?}");
        // 1) las PRIMERAS son de la marca del teléfono aunque estén agotadas
        assert!(cands[0].brand_match, "la primera debe ser de la marca del teléfono: {by_id:?}");
        assert_ne!(cands[0].product.id, infinix, "el Infinix no puede ir primero: {by_id:?}");
        // 2) la ficha sin marca que nombra el Honor también cuenta como su marca
        assert!(cands.iter().any(|c| c.product.id == generico && c.brand_match));
        // 3) la de Infinix queda marcada como OTRA marca y fuera del primer lugar
        let inf = cands.iter().find(|c| c.product.id == infinix).expect("falta el Infinix");
        assert!(!inf.brand_match, "la pantalla Infinix NO es la del Honor");
        assert!(inf.in_stock);
        let pos_honor = cands.iter().position(|c| c.product.id == honor).unwrap();
        let pos_inf = cands.iter().position(|c| c.product.id == infinix).unwrap();
        assert!(pos_honor < pos_inf, "marca antes que stock: {by_id:?}");
        // 4) el frontend solo auto-elige cuando hay UNA con stock Y de la marca: acá hay una
        //    sola con stock (Infinix) y NO es de la marca → no se elige sola
        let auto: Vec<i64> = cands.iter().filter(|c| c.in_stock && c.brand_match).map(|c| c.product.id).collect();
        assert!(auto.is_empty(), "nada debe auto-elegirse acá: {auto:?}");

        // --- A11: el texto ES AMBIGUO en el padrón («A11» = Umidigi A11 y Samsung Galaxy A11,
        //     que es como la lista del local escribe la pantalla Samsung) → SIN CERTEZA: no se
        //     marca ninguna candidata y el formulario NO auto-elige (lo decide el operario) ---
        let umidigi = db.add_product("Pantalla Umidigi A11", Some(1), "Umidigi", "A11", "",
            r#"["Umidigi A11"]"#, 5.0, 12.0, 0, 0, 0.0).unwrap();
        let samsung = db.add_product("Pantalla Samsung A11", Some(1), "Samsung", "A11", "",
            r#"["Samsung A11"]"#, 4.0, 10.0, 3, 0, 0.0).unwrap();
        {
            let c = db.conn.lock().unwrap();
            // la pantalla Samsung es «A11» a secas en el inventario del local
            c.execute("UPDATE products SET compatibility='[\"A11\"]' WHERE id=?1", params![samsung]).unwrap();
            let marca = crate::phones::lookup_brand(&c, "A11").unwrap();
            assert_eq!(marca, None, "«A11» es ambiguo (Umidigi A11 y Samsung Galaxy A11): sin certeza");
        }
        let a11 = db.find_compatible_products("A11", Some(1), 20).unwrap();
        assert!(a11.iter().any(|c| c.product.id == samsung) && a11.iter().any(|c| c.product.id == umidigi));
        assert!(a11.iter().all(|c| !c.brand_match && !c.brand_known),
            "con el texto ambiguo NO se marca marca: {:?}",
            a11.iter().map(|c| (c.product.id, c.brand_match, c.brand_known)).collect::<Vec<_>>());
        let auto_a11: Vec<i64> = a11.iter().filter(|c| c.in_stock && c.brand_match).map(|c| c.product.id).collect();
        assert!(auto_a11.is_empty(), "nada se auto-elige con marca ambigua: {auto_a11:?}");

        // escrito a mano CON marca («Samsung A11») la marca SÍ se conoce y el gate funciona
        let a11s = db.find_compatible_products("Samsung A11", Some(1), 20).unwrap();
        let s2 = a11s.iter().find(|c| c.product.id == samsung).expect("falta el Samsung (2)");
        assert!(s2.brand_match && s2.brand_known);
        let u2 = a11s.iter().find(|c| c.product.id == umidigi).expect("falta el Umidigi (2)");
        assert!(!u2.brand_match, "un Umidigi A11 no es la pantalla de un Samsung A11");

        // --- Realme 11 5G contra Redmi Note 11 5G (Xiaomi) ---
        let realme = db.add_product("Pantalla Realme 11 5G", Some(1), "Realme", "11 5G", "",
            r#"["Realme 11 5G"]"#, 6.0, 14.0, 0, 0, 0.0).unwrap();
        let redmi = db.add_product("Pantalla Xiaomi Redmi Note 11 5G", Some(1), "Xiaomi", "Redmi Note 11", "5G",
            r#"["Redmi Note 11 5G"]"#, 5.0, 13.0, 4, 0, 0.0).unwrap();
        {
            let c = db.conn.lock().unwrap();
            c.execute(
                "INSERT INTO phones (brand, line, model, name, key, aliases, source)
                 VALUES ('Realme', '11', '11 5G', 'Realme 11 5G', 'realme 11 5g', '[]', 'catalogo')",
                [],
            ).unwrap();
        }
        let r5g = db.find_compatible_products("Realme 11 5G", Some(1), 20).unwrap();
        let rl = r5g.iter().find(|c| c.product.id == realme).expect("falta el Realme");
        let rd = r5g.iter().find(|c| c.product.id == redmi).expect("falta el Redmi (parcial por texto)");
        assert!(rl.brand_match && !rd.brand_match, "Redmi ≠ Realme");
        assert!(r5g.iter().position(|c| c.product.id == realme).unwrap()
              < r5g.iter().position(|c| c.product.id == redmi).unwrap());

        // modelo que NO está en el padrón y sin marca en el texto → sin gate (no se rompe nada)
        let libre = db.find_compatible_products("Zzz 999", Some(1), 20).unwrap();
        assert!(libre.is_empty());

        // AMBIGÜEDAD = SIN CERTEZA: el mismo texto apunta a DOS marcas («A11» es Umidigi y
        // Samsung Galaxy A11; «10 Lite» es Honor y Xiaomi Mi 10 Lite). Devolver una por orden
        // de fila invertiría el gate (marcaría como «de otra marca» la pantalla correcta), así
        // que no se marca ninguna y el formulario deja elegir al operario.
        let xiaomi10 = db.add_product("Pantalla Xiaomi Mi 10 Lite", Some(1), "Xiaomi", "Mi 10 Lite", "",
            r#"["Mi 10 Lite"]"#, 4.0, 11.0, 6, 0, 0.0).unwrap();
        {
            let c = db.conn.lock().unwrap();
            // el padrón tiene las DOS fichas y las dos coinciden con el texto «10 Lite»
            c.execute(
                "INSERT INTO phones (brand, line, model, name, key, aliases, source)
                 VALUES ('Xiaomi', 'Mi', '10 Lite', 'Xiaomi Mi 10 Lite', 'xiaomi mi 10 lite', '[\"10 Lite\"]', 'catalogo')",
                [],
            ).unwrap();
            c.execute(
                "INSERT INTO phones (brand, line, model, name, key, aliases, source)
                 VALUES ('Honor', '', '10 Lite', 'Honor 10 Lite', 'honor 10 lite', '[\"10 Lite\"]', 'catalogo')",
                [],
            ).unwrap();
        }
        let amb = db.find_compatible_products("10 Lite", Some(1), 20).unwrap();
        assert!(!amb.is_empty(), "el texto ambiguo igual devuelve candidatas para mostrar");
        assert!(amb.iter().all(|c| !c.brand_match), "sin certeza de marca NO se marca ninguna: {:?}",
            amb.iter().map(|c| (c.product.id, c.brand_match, c.brand_known)).collect::<Vec<_>>());
        assert!(amb.iter().all(|c| !c.brand_known), "la UI necesita saber que la marca es desconocida");
        // y la que era del Xiaomi queda fuera de la auto-selección (regla del frontend)
        let auto_amb: Vec<i64> = amb.iter().filter(|c| c.in_stock && c.brand_match).map(|c| c.product.id).collect();
        assert!(auto_amb.is_empty(), "nada se auto-elige con marca ambigua: {auto_amb:?} (incluye {xiaomi10})");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// Informe manual del GATE DE MARCA sobre una copia del catálogo REAL (B2). NO toca la
    /// base que se le pasa: la COPIA a un temporal y mide ahí (el original solo se lee).
    ///   node tools/snapshot_db.mjs --out backup/medicion.db
    ///   $env:REGISTRO_BRANDGATE_DB="C:\...\backup\medicion.db"
    ///   cargo test -- --ignored test_manual_brand_gate_report --nocapture
    /// Cuenta, para cada teléfono del padrón: cuántos tenían el problema (una sola pantalla
    /// con stock y de OTRA marca → el formulario la elegía sola) y cuántos se auto-eligen
    /// ahora con la regla nueva (una sola con stock, de la marca y coincidencia exacta/prefijo).
    #[test]
    #[ignore = "manual: mide el gate de marca sobre la copia indicada en REGISTRO_BRANDGATE_DB"]
    fn test_manual_brand_gate_report() {
        let src = std::env::var("REGISTRO_BRANDGATE_DB").expect("define REGISTRO_BRANDGATE_DB");
        let tmp = std::env::temp_dir().join("registro_brandgate_report.db");
        let _ = std::fs::remove_file(&tmp);
        std::fs::copy(&src, &tmp).expect("no pude copiar la base a un temporal");
        let db = Database::new(&tmp).expect("no pude abrir la copia");

        let labels: Vec<String> = {
            let c = db.conn.lock().unwrap();
            let mut stmt = c.prepare("SELECT COALESCE(name,'') FROM phones WHERE TRIM(name) <> '' ORDER BY name").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        // El informe se apoya en el PADRÓN: si la copia no lo tiene (o quedó vacío) los números
        // saldrían todos en 0 y parecería que el gate no encuentra nada. Mejor fallar claro.
        assert!(!labels.is_empty(),
            "el padrón está VACÍO en {src}: usá una copia con padrón (node tools/snapshot_db.mjs --out backup/medicion.db)");
        println!("(copia temporal: la base pasada NO se toca)");

        let (mut con_opciones, mut viejo_auto, mut cruzadas, mut nuevo_auto, mut sin_marca, mut parciales) = (0, 0, 0, 0, 0, 0);
        let mut muestras: Vec<String> = Vec::new();
        let mut perdidas: Vec<String> = Vec::new();
        for label in &labels {
            let c = match db.find_compatible_products(label, Some(1), 40) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if c.is_empty() {
                continue;
            }
            con_opciones += 1;
            if !c.iter().any(|x| x.brand_match) {
                sin_marca += 1;
            }
            let con_stock: Vec<_> = c.iter().filter(|x| x.in_stock).collect();
            // regla VIEJA: una sola con stock → se elegía sola, fuera de la marca que fuera
            if con_stock.len() == 1 {
                viejo_auto += 1;
                if !con_stock[0].brand_match {
                    cruzadas += 1;
                    if muestras.len() < 20 {
                        muestras.push(format!("{}  →  {}", label, con_stock[0].product.name));
                    }
                } else if con_stock[0].match_quality == "parcial" {
                    // era de la marca pero por coincidencia PARCIAL: ahora la elige el
                    // operario (antes se elegía sola y podía ser otro modelo de la marca)
                    parciales += 1;
                    if perdidas.len() < 20 {
                        perdidas.push(format!("{}  →  {}  ({})", label, con_stock[0].product.name, con_stock[0].match_quality));
                    }
                }
            }
            // regla NUEVA: una sola con stock, DE LA MARCA y coincidencia exacta/prefijo
            let propias: Vec<_> = c.iter()
                .filter(|x| x.in_stock && x.brand_match && x.match_quality != "parcial")
                .collect();
            if propias.len() == 1 {
                nuevo_auto += 1;
            }
        }

        println!("base medida: {src}");
        println!("teléfonos en el padrón: {}", labels.len());
        println!("con pantallas compatibles: {con_opciones}");
        println!("  · sin ninguna candidata de la MISMA marca: {sin_marca}");
        println!("regla VIEJA — se elegían solos (una sola con stock): {viejo_auto}");
        println!("  · de esos, de OTRA marca (el bug B2): {cruzadas}");
        println!("regla NUEVA — se eligen solos (una sola con stock, de la marca, exacta/prefijo): {nuevo_auto}");
        println!("  · de los viejos, de la marca pero coincidencia PARCIAL (ahora los elige el operario): {parciales}");
        println!("casos que ya NO se eligen solos (eran de OTRA marca):");
        for m in &muestras {
            println!("  {m}");
        }
        println!("casos que ahora se resuelven a mano (misma marca, coincidencia parcial):");
        for m in &perdidas {
            println!("  {m}");
        }

        drop(db);
        let _ = std::fs::remove_file(&tmp);
    }

    // --- B3: gate de ROL y vencimiento de la sesión de dueño ---

    /// Base temporal de test (NUNCA toca registro.db del local ni backup/*.db).
    fn b3_db(name: &str) -> (Database, PathBuf) {
        let path = PathBuf::from(name);
        let _ = std::fs::remove_file(&path);
        let db = Database::new(&path).expect("base de test");
        (db, path)
    }

    /// (a) El gate corta las escrituras que no son de la cajera: mensaje claro sin dueño,
    /// y con el PIN correcto la escritura se hace de verdad.
    #[test]
    fn test_b3_gate_de_rol_sin_y_con_dueno() {
        let (db, path) = b3_db("test_b3_gate_rol.db");
        // instalación SIN PIN: un solo usuario (el dueño) → se permite
        assert!(db.require_owner().is_ok());
        assert!(db.owner_can_edit());

        db.set_pin("1234").unwrap();
        assert!(!db.owner_can_edit(), "con PIN configurado y sin verificarlo, NO");
        let err = db.require_owner().unwrap_err();
        assert!(err.contains("Solo el dueño puede"), "mensaje claro para el operario: {err}");

        assert!(db.verify_pin("1234").unwrap());
        assert!(db.require_owner().is_ok(), "con el PIN del dueño sí");
        let pid = db.add_product("Pantalla Test", Some(1), "Xiaomi", "Red Note 11",
                                 "Incell", "[\"Red Note 11\"]", 8.0, 15.0, 5, 2, 0.0).unwrap();
        assert!(pid > 0, "la escritura de catálogo se hace con la sesión de dueño");
        db.delete_product(pid).unwrap();

        // el botón «Bloquear sesión» cierra el gate
        db.lock_owner();
        assert!(!db.owner_can_edit());
        assert!(db.require_owner().is_err());

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// (c) La sesión de dueño VENCE a las `OWNER_SESSION_HOURS` (jornada del local): dentro
    /// del plazo sigue valiendo (no se re-tipea el PIN en plena jornada); pasada la jornada
    /// se cierra sola, el mensaje lo dice y el PIN correcto abre una sesión NUEVA.
    #[test]
    fn test_b3_la_sesion_de_dueno_vence() {
        let (db, path) = b3_db("test_b3_sesion_vence.db");
        db.set_pin("1234").unwrap();
        assert!(db.verify_pin("1234").unwrap());
        assert!(db.owner_can_edit(), "recién puesta, la sesión vale");

        // 1 minuto antes del límite: todavía vale
        db.owner_session_backdate(OWNER_SESSION_HOURS * 3600 - 60);
        assert!(db.owner_can_edit(), "dentro de las {OWNER_SESSION_HOURS} h sigue valiendo");

        // pasada la jornada: venció, se cierra sola y el mensaje lo avisa
        db.owner_session_backdate(OWNER_SESSION_HOURS * 3600 + 60);
        assert!(!db.owner_can_edit(), "vencida: ya no se puede escribir");
        let err = db.require_owner().unwrap_err();
        assert!(err.contains("venció"), "el mensaje avisa del vencimiento: {err}");
        assert!(!db.owner_can_edit(), "la sesión vencida queda cerrada (no revive sola)");

        // el PIN correcto abre una sesión NUEVA (no arrastra la fecha vieja)
        assert!(db.verify_pin("1234").unwrap());
        assert!(db.owner_can_edit(), "sesión nueva: se puede escribir otra vez");
        let err = db.require_owner();
        assert!(err.is_ok(), "y sin el mensaje de vencimiento: {err:?}");

        // un PIN incorrecto cierra la sesión y olvida la fecha
        db.lock_owner();
        assert!(!db.verify_pin("9999").unwrap());
        assert!(!db.owner_can_edit());
        assert!(db.require_owner().unwrap_err().contains("Solo el dueño puede"),
                "sin vencimiento, el mensaje es el genérico");

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    // ── F32: recepción guiada + recordatorios de política + entregados de hoy ──────────────

    /// Helper: una orden de prueba (un equipo) con el estado que se pida.
    fn f32_order(db: &Database, client: &str, model: &str, status: &str) -> i64 {
        let d = ServiceDeviceInput {
            model: model.into(), fault: "Rota".into(), service_type: "Cambio pantalla".into(),
            service_types: "[\"Cambio pantalla\"]".into(), amount: 30.0, payment_method: "Efectivo Bs".into(),
            observations: String::new(), bank_fee_percent: 0.0, zelle_reference: String::new(),
            currency: "USD".into(), device_checklist: String::new(), color: "Negro".into(),
            screen_product_id: None, discount_amount: 0.0, status: status.into(),
            iva_rate: 0.0, iva_mode: String::new(),
        };
        let base = db.add_service_order(client, "0412-0000000", "V-1", "", None, "", None, &[d]).unwrap();
        let all = db.get_services("", "", "", "", "").unwrap();
        all.iter().find(|s| s.order_num.as_deref() == Some(base.as_str())).unwrap().id
    }

    // F62 — las categorías de trabajo que agrega el local: se guardan, se validan y no se duplican.
    #[test]
    fn test_work_types_extra() {
        let test_path = PathBuf::from("test_f62_work_types.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Arranca vacío y devuelve un JSON array válido (nunca basura).
        assert_eq!(db.get_work_types_extra().unwrap(), "[]");

        // Agregar: devuelve la lista completa y queda guardada.
        let tras = db.add_work_type_extra("Cambio de tapa").unwrap();
        assert_eq!(tras, "[\"Cambio de tapa\"]");
        assert_eq!(db.get_work_types_extra().unwrap(), "[\"Cambio de tapa\"]");

        // Se recorta el espacio de los bordes (el operario escribe apurado).
        db.add_work_type_extra("  Cambio de lente  ").unwrap();
        assert_eq!(db.get_work_types_extra().unwrap(), "[\"Cambio de tapa\",\"Cambio de lente\"]");

        // Duplicado que solo cambia mayúsculas/acentos → rechazado con un mensaje claro.
        let dup = db.add_work_type_extra("CAMBIO DE TAPA").unwrap_err().to_string();
        assert!(dup.contains("ya existe"), "mensaje: {dup}");
        // …y tampoco se creó una segunda.
        assert_eq!(serde_json::from_str::<Vec<String>>(&db.get_work_types_extra().unwrap()).unwrap().len(), 2);

        // Vacío y demasiado largo → rechazados.
        assert!(db.add_work_type_extra("   ").unwrap_err().to_string().contains("vacía"));
        assert!(db.add_work_type_extra(&"x".repeat(41)).unwrap_err().to_string().contains("muy largo"));

        // Un valor corrupto en `settings` no rompe la pantalla: se devuelve [].
        db.set_setting("work_types_extra", "{no es un array").unwrap();
        assert_eq!(db.get_work_types_extra().unwrap(), "[]");

        let _ = std::fs::remove_file(&test_path);
    }

    /// F65 — las categorías de PRODUCTO que agrega el local: se crean (sin duplicar), se renombran
    /// sin tocar ninguna ficha, y solo se borran si están VACÍAS (las del padrón de teléfonos nunca).
    #[test]
    fn test_categories_add_rename_delete() {
        let test_path = PathBuf::from("test_f65_categories.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");

        // La lista de arranque trae las del `init` y «Pantalla» (id 1) es la del padrón de teléfonos.
        let base = db.get_categories_with_usage().unwrap();
        let n0 = base.len();
        assert!(n0 >= 6, "categorías del init: {n0}");
        let pantalla = base.iter().find(|c| c.name == "Pantalla").expect("Pantalla existe");
        assert!(pantalla.phone_padron, "Pantalla es del padrón de teléfonos");

        // CREAR: devuelve la categoría con su id, recién nacida y sin productos.
        let nueva = db.add_category("Tapa trasera", "Tapas y carasas").unwrap();
        assert!(nueva.created, "es nueva");
        assert!(nueva.category.id > 0);
        assert_eq!(nueva.category.name, "Tapa trasera");
        assert_eq!(nueva.category.description.as_deref(), Some("Tapas y carasas"));
        let tras = db.get_categories_with_usage().unwrap();
        let fila = tras.iter().find(|c| c.id == nueva.category.id).expect("aparece en la lista");
        assert_eq!((fila.products, fila.units), (0, 0));
        assert!(!fila.phone_padron, "una categoría nueva NO es del padrón");

        // Se recorta el espacio de los bordes y la descripción vacía queda en NULL.
        let otra = db.add_category("  Cámaras  ", "   ").unwrap();
        assert_eq!(otra.category.name, "Cámaras");
        assert_eq!(otra.category.description, None);

        // DUPLICADO plegado (mayúsculas/acentos) → se devuelve LA QUE YA ESTÁ, no una gemela.
        let dup = db.add_category("CAMARAS", "otra cosa").unwrap();
        assert!(!dup.created, "no se creó nada");
        assert_eq!(dup.category.id, otra.category.id, "es la misma categoría");
        assert_eq!(dup.category.description, None, "tampoco se le pisa la descripción");
        assert_eq!(db.add_category("camaras", "").unwrap().category.id, otra.category.id);
        assert_eq!(db.get_categories().unwrap().len(), n0 + 2, "solo dos categorías nuevas");

        // Vacío y demasiado largo → rechazados con mensaje (validación del backend).
        assert!(db.add_category("   ", "").unwrap_err().to_string().contains("vacío"));
        assert!(db.add_category(&"x".repeat(41), "").unwrap_err().to_string().contains("muy largo"));

        // Un producto entra en la categoría nueva: la lista de uso lo cuenta.
        let pid = db.add_product("Tapa Samsung A15", Some(nueva.category.id), "Samsung", "A15", "",
                                 "[\"Samsung A15\"]", 1.0, 2.0, 4, 0, 0.0).unwrap();
        let antes = db.get_products("", None).unwrap().into_iter().find(|p| p.id == pid).unwrap();
        let fila = db.get_categories_with_usage().unwrap();
        let fila = fila.iter().find(|c| c.id == nueva.category.id).unwrap();
        assert_eq!((fila.products, fila.units), (1, 4), "una ficha con 4 unidades");

        // CON PRODUCTOS no se borra: el mensaje dice cuántos son y la categoría sigue ahí.
        let err = db.delete_category(nueva.category.id).unwrap_err().to_string();
        assert!(err.contains("1 productos"), "mensaje: {err}");
        assert!(db.get_categories().unwrap().iter().any(|c| c.id == nueva.category.id));

        // RENOMBRAR: cambia el nombre de la categoría; la ficha NO se toca (mismo category_id y
        // mismo nombre guardado), y el JOIN del listado ya muestra el nombre nuevo.
        let ren = db.rename_category(nueva.category.id, "Tapas y carcasas", "Tapas y forros").unwrap();
        assert_eq!(ren.name, "Tapas y carcasas");
        assert_eq!(ren.description.as_deref(), Some("Tapas y forros"));
        let despues = db.get_products("", None).unwrap().into_iter().find(|p| p.id == pid).unwrap();
        assert_eq!(despues.category_id, Some(nueva.category.id), "la ficha no se movió");
        assert_eq!(despues.category_name.as_deref(), Some("Tapas y carcasas"));
        assert_eq!(despues.name, antes.name, "el nombre de la ficha NO se reescribe al renombrar");

        // Renombrar a un nombre que ya existe (plegado) → rechazado, y no cambia nada.
        let err = db.rename_category(nueva.category.id, "cámaras", "").unwrap_err().to_string();
        assert!(err.contains("Ya existe otra categoría"), "mensaje: {err}");
        assert!(db.get_categories().unwrap().iter().any(|c| c.name == "Tapas y carcasas"));

        // Las del PADRÓN DE TELÉFONOS no se renombran (rompería el padrón y los nombres de las fichas),
        // pero su DESCRIPCIÓN sí se puede anotar mandando el mismo nombre.
        let err = db.rename_category(pantalla.id, "Pantallas", "").unwrap_err().to_string();
        assert!(err.contains("padrón de teléfonos"), "mensaje: {err}");
        db.rename_category(pantalla.id, "Pantalla", "El vidrio completo del equipo").unwrap();
        let p2 = db.get_categories_with_usage().unwrap();
        assert_eq!(p2.iter().find(|c| c.id == pantalla.id).unwrap().description.as_deref(),
                   Some("El vidrio completo del equipo"), "solo cambió la descripción");
        let err = db.delete_category(pantalla.id).unwrap_err().to_string();
        assert!(err.contains("padrón de teléfonos"), "mensaje: {err}");
        // Y el padrón de teléfonos se protege POR ID (es lo que filtran phones.rs/loadlist.rs): una
        // categoría PROPIA llamada «Táctil» en una base que no tiene la del padrón NO queda fija —
        // antes se marcaba por nombre y la pantalla mentía (badge + sin poder renombrar) mientras el
        // padrón de modelos ni la miraba.
        let tactil = db.add_category("Táctil", "").unwrap();
        assert!(tactil.created, "en una base chica la crea");
        assert!(tactil.category.id != pantalla.id);
        assert!(!db.get_categories_with_usage().unwrap()
            .iter().find(|c| c.id == tactil.category.id).unwrap().phone_padron,
            "una «Táctil» propia no es el padrón (el padrón es por id)");
        db.rename_category(tactil.category.id, "Táctil de tablet", "").unwrap();
        db.delete_category(tactil.category.id).unwrap();
        assert!(!db.get_categories().unwrap().iter().any(|c| c.id == tactil.category.id));

        // RESERVA DE IDS (2ª vuelta adversarial): en una base chica (las 6 del init) la 12.ª y la 13.ª
        // categoría que crea el dueño caían en los ids 18 y 19 = `PHONE_CATEGORIES` → sus fichas
        // entraban al padrón de Modelos, el barrido les ponía el stock en 0 y quedaban fijas sin que
        // nadie lo hubiera pedido. `add_category` los saltea.
        let mut creadas = Vec::new();
        for i in 1..=14 {
            creadas.push(db.add_category(&format!("Categoría {i:02}"), "").unwrap().category.id);
        }
        assert!(!creadas.contains(&18) && !creadas.contains(&19),
                "los ids del padrón quedan reservados: {creadas:?}");
        assert!(creadas.contains(&17) && creadas.contains(&20), "y no se pierde ningún id libre: {creadas:?}");
        let con_uso = db.get_categories_with_usage().unwrap();
        assert_eq!(con_uso.iter().filter(|c| c.phone_padron).map(|c| c.id).collect::<Vec<_>>(),
                   vec![pantalla.id], "solo el padrón real queda marcado");
        for id in &creadas { db.delete_category(*id).unwrap(); }
        assert_eq!(db.get_categories().unwrap().len(), n0 + 2,
                   "se limpiaron las 14 de prueba: quedan las del init + las dos de arriba");

        // VACÍA → sí se borra (deshacer un error de tipeo).
        db.delete_category(otra.category.id).unwrap();
        assert!(!db.get_categories().unwrap().iter().any(|c| c.id == otra.category.id));

        // Id inexistente → mensaje claro, nunca un error críptico de SQLite.
        assert!(db.delete_category(99999).unwrap_err().to_string().contains("no encontrada"));
        assert!(db.rename_category(99999, "X", "").unwrap_err().to_string().contains("no encontrada"));

        // Y los TOTALES POR CATEGORÍA (memoria corta del catálogo, `cache.rs`) reflejan la categoría
        // nueva y el nombre corregido sin quedarse pegados: la memoria se invalida con
        // `total_changes()`, o sea que una escritura de categorías también la vence.
        let stats = db.get_inventory_stats().unwrap();
        assert!(stats.by_category.iter().any(|c| c.name == "Tapas y carcasas" && c.sku == 1),
                "la categoría corregida aparece con su ficha: {:?}",
                stats.by_category.iter().map(|c| (&c.name, c.sku)).collect::<Vec<_>>());
        assert!(!stats.by_category.iter().any(|c| c.name == "Tapa trasera"),
                "el nombre viejo ya no está");

        drop(db);

        // UNA BASE INSTALADA ANTES de que existiera `categories.description` se ARREGLA al abrir la
        // app (migración idempotente de `init()`): sin eso, `SELECT *` con mapping posicional fallaba
        // y el desplegable de categorías caía al mock del frontend (una sola categoría, sin arreglo).
        {
            let conn = Connection::open(&test_path).unwrap();
            conn.execute_batch("ALTER TABLE categories DROP COLUMN description;").unwrap();
            conn.execute_batch("INSERT INTO categories (name) VALUES ('De la base vieja');").unwrap();
            drop(conn);
            let viejo = Database::new(&test_path).expect("init sobre una base vieja");
            let cats = viejo.get_categories().expect("la columna se agrega sola en init()");
            assert!(cats.iter().any(|c| c.name == "De la base vieja"), "la categoría vieja sigue");
            let con_uso = viejo.get_categories_with_usage().unwrap();
            assert_eq!(con_uso.iter().filter(|c| c.description.is_none()).count(), con_uso.len(),
                       "description queda NULL, no rompe la lectura");
            assert!(con_uso.iter().any(|c| c.name == "Pantalla" && c.phone_padron));
            drop(viejo);
        }

        let _ = std::fs::remove_file(&test_path);
    }

    /// F74 — EL IVA: la configuración (fail-closed) y las columnas por fila de ventas y servicios.
    /// Lo que fija: apagado no cambia nada, una alícuota/modo inválidos se rechazan, la alícuota viaja
    /// con la operación (y sobrevive a una edición de la orden), y una base vieja sin las columnas se
    /// migra sola al abrir (leyendo 0 = sin IVA).
    #[test]
    fn test_tax_config_and_iva_columns() {
        let test_path = PathBuf::from("test_f74_iva.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        // De fábrica el IVA está APAGADO y con 16% listo: los precios del local no cambian solos.
        let base = db.get_tax_config();
        assert!(!base.activo, "de fábrica el IVA está apagado");
        assert_eq!(base.alicuota, 16.0);
        assert_eq!(base.modo, "incluido");

        // Se prende con una alícuota y un modo: queda guardado tal cual (y se relee del JSON).
        let guardada = db.set_tax_config(true, 16.0, "agregado").unwrap();
        assert!(guardada.activo && guardada.alicuota == 16.0 && guardada.modo == "agregado");
        let leida = db.get_tax_config();
        assert!(leida.activo && leida.modo == "agregado", "la configuración se relee: {:?}", leida);

        // Validación fail-closed: modo fuera de la whitelist y alícuota absurda.
        assert!(db.set_tax_config(true, 16.0, "lo-que-sea").is_err(), "un modo raro se rechaza");
        assert!(db.set_tax_config(true, 999.0, "incluido").is_err(), "una alícuota > 100 se rechaza");
        assert!(db.set_tax_config(true, -1.0, "incluido").is_err(), "una alícuota negativa se rechaza");
        // …y la configuración guardada NO se pisó con el intento fallido.
        assert_eq!(db.get_tax_config().modo, "agregado");

        // Una VENTA con IVA 16% «agregado»: 34,80 cobrados, con su alícuota anotada en la fila.
        db.add_sale_tax(None, "Pantalla A15", 1, 34.8, 34.8, "Divisas (USD Cash)", "", None, "", 0.0, "", "USD", 0.0, 16.0, "agregado").unwrap();
        let ventas = db.get_sales("", None, "", "").unwrap();
        assert_eq!(ventas.len(), 1);
        assert_eq!(ventas[0].iva_rate, 16.0, "la venta guarda su alícuota");
        assert_eq!(ventas[0].iva_mode, "agregado", "y el modo con el que se cargó");
        assert_eq!(ventas[0].total, 34.8, "el total sigue siendo lo que pagó el cliente");
        // Una venta sin IVA (el caso de hoy, con el switch apagado) nace en 0/''.
        db.add_sale_tax(None, "Cable", 1, 5.0, 5.0, "Divisas (USD Cash)", "", None, "", 0.0, "", "USD", 0.0, 0.0, "").unwrap();
        let todas = db.get_sales("", None, "", "").unwrap();
        let sin = todas.iter().find(|s| s.iva_rate < 0.001).expect("hay una venta sin IVA");
        assert_eq!(sin.iva_mode, "", "sin IVA el modo queda vacío");

        // Una ORDEN con IVA: se guarda con su alícuota y EDITARLA no la pierde, porque
        // update_service no toca esas columnas (comando angosto, patrón F32).
        let id = f74_order(&db, 34.8, 16.0, "agregado");
        let s = db.get_service_by_id(id).unwrap().unwrap();
        assert_eq!(s.iva_rate, 16.0);
        assert_eq!(s.iva_mode, "agregado");
        db.update_service(id, "Ana", "0412", "Samsung A15", "Pantalla", "Cambio pantalla", "[\"Cambio pantalla\"]",
                          40.0, "Divisas (USD Cash)", "", "Recibido", "", 0.0, "", "USD", "", "", "", "", None, "", None, 0.0)
            .unwrap();
        let editada = db.get_service_by_id(id).unwrap().unwrap();
        assert_eq!(editada.amount, 40.0, "el monto se editó");
        assert_eq!(editada.iva_rate, 16.0, "editar la orden NO borra la alícuota con la que se cargó");

        // El LIBRO DE IVA agrupa por alícuota (ventas vigentes + órdenes). OJO: la orden se editó
        // arriba a $40, así que el grupo del 16% suma 34,80 (venta) + 40,00 (orden) = 74,80.
        let grupos = db.get_iva_groups("2000-01-01", "2100-01-01").unwrap();
        let g16 = grupos.iter().find(|g| (g.iva_rate - 16.0).abs() < 0.001).expect("hay filas al 16%");
        assert!((g16.total - 74.8).abs() < 0.001, "el libro suma las dos operaciones al 16%: {}", g16.total);
        assert!(g16.operaciones >= 2, "y cuenta las operaciones");
        let g0 = grupos.iter().find(|g| g.iva_rate.abs() < 0.001).expect("y las que no llevan IVA");
        assert!((g0.total - 5.0).abs() < 0.001, "la venta de $5 sin IVA entra al grupo 0: {}", g0.total);

        // UNA BASE VIEJA (sin las columnas del IVA) se migra sola al abrir y lee 0 = sin IVA.
        drop(db);
        {
            let conn = Connection::open(&test_path).unwrap();
            conn.execute_batch("ALTER TABLE sales DROP COLUMN iva_rate; ALTER TABLE sales DROP COLUMN iva_mode;").unwrap();
            drop(conn);
            let viejo = Database::new(&test_path).expect("init sobre una base sin IVA");
            let v = viejo.get_sales("", None, "", "").unwrap();
            assert!(!v.is_empty(), "las ventas viejas se siguen leyendo");
            assert!(v.iter().all(|s| s.iva_rate == 0.0 && s.iva_mode.is_empty()),
                    "sin columnas, todo lee 0/'' (sin IVA) y nada explota");
            drop(viejo);
        }

        let _ = std::fs::remove_file(&test_path);
    }

    /// Una orden de servicio con IVA (helper del test de F74).
    fn f74_order(db: &Database, amount: f64, iva_rate: f64, iva_mode: &str) -> i64 {
        let d = ServiceDeviceInput {
            model: "Samsung A15".into(), fault: "Pantalla".into(),
            service_type: "Cambio pantalla".into(), service_types: "[\"Cambio pantalla\"]".into(),
            amount, payment_method: "Divisas (USD Cash)".into(), observations: String::new(),
            bank_fee_percent: 0.0, zelle_reference: String::new(), currency: "USD".into(),
            device_checklist: String::new(), color: String::new(), screen_product_id: None,
            discount_amount: 0.0, status: "Recibido".into(), iva_rate, iva_mode: iva_mode.into(),
        };
        db.add_service_order("Ana", "0412-1234567", "", "", None, "", None, &[d]).unwrap();
        db.get_services("", "", "", "", "in").unwrap()
            .into_iter().max_by_key(|s| s.id).expect("la orden se guardó").id
    }

    /// F75 (hallazgo medido en vivo) — UNA BASE CON NULL EN LOS NOMBRES NO PUEDE IMPEDIR ARRANCAR.
    /// La migración de Title Case leía el nombre con `String` a secas y una fila con NULL
    /// (`client_name`, `services.client` o `clients.name`, típico de una importación o de una base
    /// tocada a mano) hacía fallar `init()`: la app NO ABRÍA ("Failed to initialize database:
    /// InvalidColumnType(1, \"client_name\", Null)"). Ahora se lee defensivo y la base abre igual.
    #[test]
    fn test_null_names_do_not_break_startup() {
        let test_path = PathBuf::from("test_f75_null_names.db");
        let _ = std::fs::remove_file(&test_path);

        {
            let db = Database::new(&test_path).expect("base nueva");
            db.open_day(0.0, 40.5, 45.0).unwrap();
            drop(db);
        }
        // Se ensucian con NULL las columnas de nombres que LO PERMITEN (clients.name es NOT NULL, así
        // que ahí no puede pasar): son las que deja una importación o un Excel migrado.
        {
            let conn = Connection::open(&test_path).unwrap();
            conn.execute_batch(
                "INSERT INTO sales (product_name, quantity, unit_price, total, payment_method, client_name, currency)
                   VALUES ('Pantalla NULL', 1, 10, 10, 'Divisas (USD Cash)', NULL, 'USD');
                 INSERT INTO services (order_num, client, model, amount, payment_method, status)
                   VALUES ('NULL-1', NULL, 'Samsung A15', 20, 'Divisas (USD Cash)', 'Recibido');
",
            )
            .unwrap();
            drop(conn);
        }

        // Lo que importa: la app ABRE (init corre la migración sin reventar) y las filas se leen.
        let db = Database::new(&test_path).expect("una base con NULL tiene que abrir igual");
        let ventas = db.get_sales("", None, "", "").unwrap();
        let con_null = ventas.iter().find(|s| s.product_name.as_deref() == Some("Pantalla NULL"))
            .expect("la venta con NULL está");
        assert!(con_null.client_name.is_none() || con_null.client_name.as_deref() == Some(""),
                "el nombre NULL se lee vacío: {:?}", con_null.client_name);
        let servicios = db.get_services("", "", "", "", "").unwrap();
        assert!(servicios.iter().any(|s| s.order_num.as_deref() == Some("NULL-1")),
                "la orden con NULL se lee");

        // Y una segunda apertura (migración idempotente) tampoco revienta.
        drop(db);
        let otra_vez = Database::new(&test_path).expect("segunda apertura");
        assert!(!otra_vez.get_sales("", None, "", "").unwrap().is_empty());
        drop(otra_vez);
        let _ = std::fs::remove_file(&test_path);
    }

    /// (a) Las tres señales de política: la hora la estampa el backend, se pueden limpiar,
    /// la clave sale de una whitelist y una orden inexistente se rechaza.
    #[test]
    fn test_service_policy_flags() {
        let test_path = PathBuf::from("test_f32_policy.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let id = f32_order(&db, "Ana", "Samsung A15", "Recibido");

        // Al crear: las tres señales están VACÍAS (nadie inventó que se tomó la foto)
        let s = db.get_service_by_id(id).unwrap().unwrap();
        assert!(s.photo_in_at.is_none() && s.photo_out_at.is_none() && s.pay_intent.is_none(),
                "orden nueva: sin señales de política");

        // Foto de ENTRADA: el backend estampa la fecha/hora local (no la manda el frontend)
        db.set_service_policy(id, "photo_in", "si").unwrap();
        let s = db.get_service_by_id(id).unwrap().unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        assert!(s.photo_in_at.as_deref().unwrap_or("").starts_with(&today),
                "la foto de entrada queda con la fecha de hoy: {:?}", s.photo_in_at);
        assert!(s.photo_out_at.is_none(), "la salida sigue pendiente");

        // Foto de SALIDA
        db.set_service_policy(id, "photo_out", "si").unwrap();
        assert!(db.get_service_by_id(id).unwrap().unwrap().photo_out_at.is_some());

        // Acuerdo de pago: solo los valores del local
        db.set_service_policy(id, "pay_intent", "al_retirar").unwrap();
        assert_eq!(db.get_service_by_id(id).unwrap().unwrap().pay_intent.as_deref(), Some("al_retirar"));
        db.set_service_policy(id, "pay_intent", "ahora").unwrap();
        assert_eq!(db.get_service_by_id(id).unwrap().unwrap().pay_intent.as_deref(), Some("ahora"));
        assert!(db.set_service_policy(id, "pay_intent", "mañana").is_err(), "valor inválido → error");

        // Limpiar (el operario se equivocó al confirmar)
        db.set_service_policy(id, "pay_intent", "").unwrap();
        db.set_service_policy(id, "photo_in", "").unwrap();
        let s = db.get_service_by_id(id).unwrap().unwrap();
        assert!(s.pay_intent.is_none() && s.photo_in_at.is_none(), "se pueden limpiar");
        assert!(s.photo_out_at.is_some(), "limpiar una NO toca la otra");

        // Whitelist: una clave desconocida no escribe nada (fail-closed)
        assert!(db.set_service_policy(id, "status", "Entregado").is_err(), "no se puede tocar el estado");
        assert!(db.set_service_policy(id, "amount", "0").is_err(), "no se puede tocar el monto");
        assert_eq!(db.get_service_by_id(id).unwrap().unwrap().status.as_deref(), Some("Recibido"));

        // Orden inexistente
        assert!(db.set_service_policy(999999, "photo_in", "si").is_err(), "orden inexistente → error");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// (a2) Anotar la política NO exige día abierto: es una anotación de la orden, no dinero. Si
    /// alguien mete `require_open_day` acá, esta prueba falla (la doc lo afirmaba sin cubrirlo).
    #[test]
    fn test_service_policy_without_open_day() {
        let test_path = PathBuf::from("test_f32_policy_no_day.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // Sin abrir el día: ninguna consulta de turno. La orden nace por SQL directo para no
        // depender del gate de `add_service_order` (que sí exige día abierto).
        let id: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO services (order_num, client, model, fault, status, amount, date_in) \
                 VALUES ('DEV-9001', 'Sin Dia', 'Samsung A15', 'no carga', 'Recibido', 30, date('now','localtime'))",
                [],
            ).unwrap();
            conn.query_row("SELECT id FROM services WHERE order_num = 'DEV-9001'", [], |r| r.get(0)).unwrap()
        };

        assert!(db.get_active_day().unwrap().is_none(), "no hay día abierto");
        db.set_service_policy(id, "photo_in", "si").expect("anotar la foto NO puede exigir día abierto");
        db.set_service_policy(id, "pay_intent", "al_retirar").expect("el acuerdo de pago tampoco");
        let s = db.get_service_by_id(id).unwrap().unwrap();
        assert!(s.photo_in_at.is_some() && s.pay_intent.as_deref() == Some("al_retirar"),
                "las dos señales quedaron escritas sin día abierto");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// (b) Las señales SOBREVIVEN a `update_service` (el UPDATE de 25 campos de la UI) — es la prueba
    /// de que el comando angosto protege las marcas de política.
    #[test]
    fn test_service_policy_survives_update() {
        let test_path = PathBuf::from("test_f32_policy_update.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let id = f32_order(&db, "Beto", "Samsung A15", "Recibido");
        db.set_service_policy(id, "photo_in", "si").unwrap();
        db.set_service_policy(id, "pay_intent", "al_retirar").unwrap();

        // Editar la orden como lo hace la UI (todos los campos, sin los de política)
        db.update_service(id, "Beto", "0412-0000000", "Samsung A15", "Rota", "Cambio pantalla",
                          "[\"Cambio pantalla\"]", 30.0, "Efectivo Bs", "", "En reparación", "nota",
                          0.0, "", "USD", "V-1", "", "", "", None, "Negro", None, 0.0).unwrap();

        let s = db.get_service_by_id(id).unwrap().unwrap();
        assert!(s.photo_in_at.is_some(), "la foto de entrada sobrevive a la edición");
        assert_eq!(s.pay_intent.as_deref(), Some("al_retirar"), "el acuerdo sobrevive a la edición");
        assert_eq!(s.status.as_deref(), Some("En reparación"));

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// (c) Filtro por fecha de ENTREGA: una orden recibida AYER y entregada HOY aparece con
    /// `date_field = "out"` + hoy, y NO con `"in"` + hoy (es el caso que el dueño quiere ver).
    #[test]
    fn test_get_services_date_field_out() {
        let test_path = PathBuf::from("test_f32_date_field.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();
        let id = f32_order(&db, "Carla", "Samsung A15", "Recibido");

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let yesterday = chrono::Local::now().checked_sub_days(chrono::Days::new(1)).unwrap()
            .format("%Y-%m-%d").to_string();
        // Recibida AYER (se fuerza la fecha de entrada como en las órdenes viejas)
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("UPDATE services SET date_in=?1 WHERE id=?2", params![yesterday, id]).unwrap();
        }
        // Entregada HOY
        db.update_service(id, "Carla", "0412-0000000", "Samsung A15", "Rota", "Cambio pantalla",
                          "[\"Cambio pantalla\"]", 30.0, "Efectivo Bs", "", "Entregado", "",
                          0.0, "", "USD", "V-1", "", "", "", None, "Negro", None, 0.0).unwrap();

        let por_entrega = db.get_services("", "Entregado", &today, &today, "out").unwrap();
        assert_eq!(por_entrega.len(), 1, "entregada hoy SÍ aparece filtrando por fecha de entrega");
        assert_eq!(por_entrega[0].id, id);
        assert_eq!(por_entrega[0].date_out.as_deref(), Some(today.as_str()));

        let por_recibo = db.get_services("", "Entregado", &today, &today, "in").unwrap();
        assert_eq!(por_recibo.len(), 0, "…y NO con el eje de recibido (llegó ayer)");

        // Con el eje viejo (vacío) el comportamiento histórico no cambia
        assert_eq!(db.get_services("", "Entregado", &today, &today, "").unwrap().len(), 0);
        assert_eq!(db.get_services("", "Entregado", &yesterday, &yesterday, "in").unwrap().len(), 1);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// (d) El estado inicial lo elige el wizard (`ServiceDeviceInput.status`); sin estado
    /// (llamadores viejos como `add_service`) se conserva el histórico 'Por entregar'.
    #[test]
    fn test_new_order_status_from_wizard() {
        let test_path = PathBuf::from("test_f32_new_status.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        db.open_day(0.0, 40.5, 45.0).unwrap();

        let id = f32_order(&db, "Dora", "Samsung A15", "Recibido");
        assert_eq!(db.get_service_by_id(id).unwrap().unwrap().status.as_deref(), Some("Recibido"),
                   "el wizard manda el estado: la orden arranca en Recibido");

        // Sin estado explícito → histórico (compatibilidad con add_service)
        let legacy = db.add_service("DEV-9000", "Legacy", "0412", "Samsung A15", "Rota",
            "Cambio pantalla", "[\"Cambio pantalla\"]", 10.0, "Efectivo Bs", "", 0.0, "", "USD",
            "V-9", "", "", None, "", None, "", None, 0.0).unwrap();
        assert_eq!(db.get_service_by_id(legacy).unwrap().unwrap().status.as_deref(), Some("Por entregar"));

        // F32: una orden NUEVA no puede nacer ENTREGADA (ni anulada): el INSERT no escribe
        // `date_out` ni descuenta stock —eso lo hace el cambio de estado con el asistente «Cerrar»—
        // así que nacer «Entregado» dejaba la orden sin fecha (fuera de «Entregados hoy» y sin
        // garantía) y con el inventario sin descontar. El backend lo rechaza (no solo la UI).
        for finalizado in ["Entregado", "Cancelado / Devuelto", "Devuelto"] {
            let d = ServiceDeviceInput {
                model: "Samsung A15".into(), fault: "Rota".into(), service_type: "Cambio pantalla".into(),
                service_types: "[\"Cambio pantalla\"]".into(), amount: 30.0, payment_method: "Efectivo Bs".into(),
                observations: String::new(), bank_fee_percent: 0.0, zelle_reference: String::new(),
                currency: "USD".into(), device_checklist: String::new(), color: "Negro".into(),
                screen_product_id: None, discount_amount: 0.0, status: finalizado.into(),
                iva_rate: 0.0, iva_mode: String::new(),
            };
            let err = db.add_service_order("Nace final", "0412", "", "", None, "", None, &[d]).unwrap_err();
            assert!(err.to_string().contains("estado de taller"),
                    "nacer en {finalizado} se rechaza: {err}");
        }
        // …y el estado de taller sí se acepta (el flujo normal del mostrador)
        let por_entregar = f32_order(&db, "Nace taller", "Samsung A15", "Por entregar");
        assert_eq!(db.get_service_by_id(por_entregar).unwrap().unwrap().status.as_deref(), Some("Por entregar"));

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F35 — FECHA DEL PAGO: el abono entra en la caja del día en que la plata entró de verdad.
    /// Pedido del dueño: «cliente[s] dejan el tlf a reparar pero pagan ese mismo día y no lo
    /// notifican; [que] pueda editar o agregar la fecha de ese pago… porque a veces tiende [a]
    /// faltar dinero o sobrar al cerrar esa caja».
    #[test]
    fn test_payment_date_lands_on_the_right_day() {
        let test_path = PathBuf::from("test_f35_payment_date.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // Las fechas se calculan UNA vez en locales: hacerlo dentro de un `db.conn.lock()...execute(...)`
        // es un DEADLOCK (el guard del mutex vive mientras se evalúan los argumentos y la consulta
        // intenta tomar el MISMO mutex — me pasó al escribir esta prueba).
        let (hoy, ayer, manana, cerrado, sin_turno): (String, String, String, String, String) = {
            let conn = db.conn.lock().unwrap();
            let q = |sql: &str| -> String { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
            (
                q("SELECT date('now','localtime')"),
                q("SELECT date('now','localtime','-1 day')"),
                q("SELECT date('now','localtime','+1 day')"),
                q("SELECT date('now','localtime','-3 day')"),
                q("SELECT date('now','localtime','-10 day')"),
            )
        };
        // Turno de HOY (abierto) + turno de AYER (abierto, como queda después de pulsar ↺ en
        // Libro Diario → Cierres): los dos días que necesita la prueba. `open_day` se llama primero
        // porque rechaza abrir un día si ya hay otro abierto.
        db.open_day(0.0, 50.0, 55.0).unwrap();
        db.conn.lock().unwrap().execute(
            "INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, tasa_eur, is_closed) VALUES (?1, 0, 40.5, 45, 0)",
            params![ayer],
        ).unwrap();

        let sid = db.add_service("DEV-F35", "Cliente", "0412-1", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();

        // 1) Fecha vacía = HOY (comportamiento histórico intacto)
        let pid_hoy = db.add_service_payment(sid, 30.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();
        let fecha_hoy: String = db.conn.lock().unwrap()
            .query_row("SELECT date(payment_date) FROM service_payments WHERE id=?1", params![pid_hoy], |r| r.get(0)).unwrap();
        assert_eq!(fecha_hoy, hoy, "sin fecha el pago es de hoy");

        // 2) Un pago del día ANTERIOR entra en la caja de AYER, no en la de hoy: es el pedido
        let pid_ayer = db.add_service_payment(sid, 20.0, "Divisas (USD Cash)", 0.0, "", "USD", "cobrado ayer", &ayer).unwrap();
        let t_ayer = db.get_daily_totals(&ayer, &ayer).unwrap();
        let t_hoy = db.get_daily_totals(&hoy, &hoy).unwrap();
        assert_eq!(t_ayer[0].usd_cash_total, 20.0, "la caja de AYER tiene los $20 cobrados ayer");
        assert_eq!(t_hoy[0].usd_cash_total, 30.0, "la caja de HOY solo tiene los $30 de hoy");

        // 3) CORREGIR la fecha de un pago ya anotado mueve la plata de caja (y recalcula paid_amount)
        db.update_service_payment_date(pid_hoy, &ayer).unwrap();
        let t_ayer = db.get_daily_totals(&ayer, &ayer).unwrap();
        let t_hoy = db.get_daily_totals(&hoy, &hoy).unwrap();
        assert_eq!(t_ayer[0].usd_cash_total, 50.0, "ayer ahora tiene los dos pagos");
        // Hoy se queda SIN movimientos: `get_daily_totals` no devuelve fila para un día vacío
        // (es el comportamiento documentado: expected = null cuando el día no tiene nada).
        assert_eq!(t_hoy.first().map(|t| t.usd_cash_total).unwrap_or(0.0), 0.0, "hoy quedó sin pagos");
        let paid: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap();
        assert!((paid - 50.0).abs() < 1e-9, "paid_amount se mantiene (30+20=50): {paid}");

        // 4) FECHA FUTURA → rechazada (no se anota plata que no entró)
        let err = db.add_service_payment(sid, 5.0, "Divisas (USD Cash)", 0.0, "", "USD", "", &manana).unwrap_err().to_string();
        assert!(err.contains("no puede ser futura"), "futuro rechazado: {err}");
        let err = db.update_service_payment_date(pid_ayer, &manana).unwrap_err().to_string();
        assert!(err.contains("no puede ser futura"), "tampoco al editar: {err}");

        // 5) DÍA CERRADO → rechazado con el camino real (así el arqueo guardado no queda mintiendo)
        db.conn.lock().unwrap().execute(
            "INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, tasa_eur, is_closed) VALUES (?1, 0, 40.5, 45, 1)",
            params![cerrado],
        ).unwrap();
        let err = db.add_service_payment(sid, 5.0, "Divisas (USD Cash)", 0.0, "", "USD", "", &cerrado).unwrap_err().to_string();
        assert!(err.contains("ya está CERRADO") && err.contains("Cierres"), "día cerrado rechazado con la salida: {err}");
        // …y mover un pago FUERA de un día cerrado tampoco se permite
        db.conn.lock().unwrap().execute("UPDATE service_payments SET payment_date = ?2 WHERE id = ?1",
            params![pid_ayer, format!("{} 00:00:00", cerrado)]).unwrap();
        let err = db.update_service_payment_date(pid_ayer, &hoy).unwrap_err().to_string();
        assert!(err.contains("ya está CERRADO"), "no se saca un pago de un día cerrado: {err}");

        // 6) DÍA SIN TURNO → rechazado (la plata quedaría fuera de toda caja)
        let err = db.add_service_payment(sid, 5.0, "Divisas (USD Cash)", 0.0, "", "USD", "", &sin_turno).unwrap_err().to_string();
        assert!(err.contains("No hay un turno"), "día sin turno rechazado: {err}");

        // 7) Formato inválido y pago inexistente
        assert!(db.add_service_payment(sid, 5.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "17/09/2026").unwrap_err()
            .to_string().contains("AAAA-MM-DD"));
        assert!(db.update_service_payment_date(999999, &hoy).unwrap_err().to_string().contains("no existe"));

        // 8) Pago en Bs fechado en un día SIN tasa para ESE día → rechazado (no se convierte 1:1)
        //    (HOY tiene tasa 50; ayer tiene 40.5 → se le pone 0 para probar el gate POR FECHA)
        db.conn.lock().unwrap().execute("UPDATE daily_closings SET tasa_bcv = 0 WHERE close_date = ?1", params![ayer]).unwrap();
        let err = db.add_service_payment(sid, 1000.0, "Efectivo Bs", 0.0, "", "USD", "", &ayer).unwrap_err().to_string();
        assert!(err.contains("no tiene tasa BCV"), "Bs sin tasa de ESE día se rechaza: {err}");

        // 9) CONVERSIÓN POR DÍA (must #6): un abono en Bs fechado en un día con OTRA tasa se convierte
        //    con la tasa DE ESE DÍA, no con la de hoy. Con la tasa de ayer en 40.5 y la de hoy en 50,
        //    Bs 4.050 son $100 ayer y $81 hoy.
        db.conn.lock().unwrap().execute("UPDATE daily_closings SET tasa_bcv = 40.5 WHERE close_date = ?1", params![ayer]).unwrap();
        let sid_bs = db.add_service("DEV-F35B", "Cliente Bs", "0412-2", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            500.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid_bs, 4050.0, "Efectivo Bs", 0.0, "", "USD", "abono en Bs de ayer", &ayer).unwrap();
        let paid_bs: f64 = db.conn.lock().unwrap()
            .query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid_bs], |r| r.get(0)).unwrap();
        assert!((paid_bs - 100.0).abs() < 0.5, "Bs 4.050 del día con tasa 40,5 = $100 (no $81): {paid_bs}");
        // Y el pago del día conserva su HORA (el mostrador la usa para cuadrar contra el banco)
        let pid_dia = db.add_service_payment(sid_bs, 50.0, "Divisas (USD Cash)", 0.0, "", "USD", "del día", &hoy).unwrap();
        let fecha_dia: String = db.conn.lock().unwrap()
            .query_row("SELECT payment_date FROM service_payments WHERE id=?1", params![pid_dia], |r| r.get(0)).unwrap();
        assert!(fecha_dia.len() > 10, "un pago de HOY guarda fecha Y hora: {fecha_dia}");
        // …y un pago RETROACTIVO se guarda solo con la fecha (la hora real del cobro es desconocida)
        let pid_retro = db.add_service_payment(sid_bs, 10.0, "Divisas (USD Cash)", 0.0, "", "USD", "retroactivo", &ayer).unwrap();
        let fecha_retro: String = db.conn.lock().unwrap()
            .query_row("SELECT payment_date FROM service_payments WHERE id=?1", params![pid_retro], |r| r.get(0)).unwrap();
        assert_eq!(fecha_retro, ayer, "retroactivo: solo la fecha, sin hora inventada");

        // 10) Calendario: una fecha con forma válida pero inexistente se rechaza como tal
        let err = db.add_service_payment(sid, 5.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "2026-02-31").unwrap_err().to_string();
        assert!(err.contains("no existe en el calendario"), "2026-02-31 se rechaza por calendario: {err}");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F36 — DEVOLUCIONES Y SALDO POR MONEDA: devolver todo lo cobrado en Bs deja la orden SALDADA
    /// (aunque la tasa haya cambiado entre el pago y la devolución) y el tope se compara en la
    /// moneda del movimiento, sin tasas.
    #[test]
    fn test_refund_by_currency_net() {
        let test_path = PathBuf::from("test_f36_refund_currency.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("Failed to create test DB");
        // Turno de HOY con tasa 50 + turno de AYER (abierto) con tasa 40,5: el pago en Bs es de ayer.
        let (hoy, ayer): (String, String) = {
            let conn = db.conn.lock().unwrap();
            let q = |sql: &str| -> String { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
            (q("SELECT date('now','localtime')"), q("SELECT date('now','localtime','-1 day')"))
        };
        db.open_day(0.0, 50.0, 55.0).unwrap();
        db.conn.lock().unwrap().execute(
            "INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, tasa_eur, is_closed) VALUES (?1, 0, 40.5, 45, 0)",
            params![ayer],
        ).unwrap();

        let sid = db.add_service("DEV-F36", "Cliente Bs", "0412-3", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        let paid = |db: &Database| -> f64 {
            db.get_service_by_id(sid).unwrap().unwrap().paid_amount
        };

        // 1) Abono de Bs. 4.050 del día con tasa 40,5 → $100 (la tasa de ESE día)
        db.add_service_payment(sid, 4050.0, "Efectivo Bs", 0.0, "", "USD", "abono", &ayer).unwrap();
        assert!((paid(&db) - 100.0).abs() < 0.01, "$100 con la tasa del día del pago: {}", paid(&db));
        // …y NO cambia con el paso de los días (no se revalúa con la tasa de hoy)
        db.recalc_paid_amount(&db.conn.lock().unwrap(), sid).unwrap();
        assert!((paid(&db) - 100.0).abs() < 0.01, "un abono no cambia de valor solo: {}", paid(&db));

        // 2) Devolver MÁS de lo que entró en Bs → rechazado, con el tope en bolívares
        let err = db.add_service_refund(sid, 4051.0, "Efectivo Bs", "", "USD", "de más").unwrap_err().to_string();
        assert!(err.contains("Bs. 4.050,00"), "el tope se dice en bolívares: {err}");
        // Un tope en DÓLARES no se puede pasar desde un pago en Bs (no entraron dólares)
        let err = db.add_service_refund(sid, 100.0, "Divisas (USD Cash)", "", "USD", "en otra moneda").unwrap_err().to_string();
        assert!(err.contains("$0.00"), "no hay dólares que devolver: {err}");

        // 3) Devolución PARCIAL de Bs. 1.000 (con la tasa de hoy en 50) → queda Bs. 3.050 valuados a
        //    la tasa del PAGO (40,5) = $75,31, no $61 (que sería valuarlos a la tasa de hoy)
        db.add_service_refund(sid, 1000.0, "Efectivo Bs", "", "USD", "parcial").unwrap();
        assert!((paid(&db) - 75.31).abs() < 0.05, "Bs. 3.050 al cambio del pago = $75,31: {}", paid(&db));

        // 4) Devolver TODO lo que queda → la orden queda SALDADA (sin el saldo fantasma de $19)
        db.add_service_refund(sid, 3050.0, "Efectivo Bs", "", "USD", "todo").unwrap();
        assert!(paid(&db).abs() < 0.01, "devolver todo lo cobrado en Bs salda la orden: {}", paid(&db));

        // 5) La CAJA no se mezcla: cada día cuenta sus bolívares crudos
        let t_ayer = db.get_daily_totals(&ayer, &ayer).unwrap();
        assert_eq!(t_ayer[0].cash_bs, 4050.0, "ayer: los Bs que entraron");
        let t_hoy = db.get_daily_totals(&hoy, &hoy).unwrap();
        assert_eq!(t_hoy[0].cash_bs, -4050.0, "hoy: los Bs que salieron (devoluciones)");

        // 6) Mixto: un pago en dólares y una devolución de dólares se cancelan entre ellos y no tocan
        //    los bolívares (que ya quedaron en 0)
        let sid_mix = db.add_service("DEV-F36M", "Cliente Mix", "0412-4", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid_mix, 60.0, "Divisas (USD Cash)", 0.0, "", "USD", "usd", "").unwrap();
        db.add_service_payment(sid_mix, 4050.0, "Efectivo Bs", 0.0, "", "USD", "bs", &ayer).unwrap();
        db.add_service_refund(sid_mix, 40.0, "Divisas (USD Cash)", "", "USD", "dev usd").unwrap();
        let mix = db.get_service_by_id(sid_mix).unwrap().unwrap().paid_amount;
        assert!((mix - 120.0).abs() < 0.05, "USD 60-40 + Bs 4.050/40,5 = $120: {mix}");

        // 7) Devolución sin ningún pago previo → rechazada (disponible 0)
        let sid_vacio = db.add_service("DEV-F36V", "Cliente Vacio", "0412-5", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        assert!(db.add_service_refund(sid_vacio, 10.0, "Divisas (USD Cash)", "", "USD", "sin pagos").is_err(),
                "sin pagos no hay nada que devolver");

        // ── GUARDAS de la 2ª vuelta adversarial de F36 ──────────────────────────────────────────
        // 8) La DEVOLUCIÓN se fecha en el TURNO ABIERTO (no en «hoy»): así entra en la caja que se
        //    cierra. Con el default de la tabla, una devolución hecha con el turno abierto de otro día
        //    quedaba fuera de ese cierre (arqueo descuadrado) y en un día que nadie cierra.
        let sid_dia = db.add_service("DEV-F36D", "Cliente Dia", "0412-6", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        let t_antes = db.get_daily_totals(&hoy, &hoy).unwrap().first().map(|t| t.usd_cash_total).unwrap_or(0.0);
        db.add_service_payment(sid_dia, 30.0, "Divisas (USD Cash)", 0.0, "", "USD", "cobro", "").unwrap();
        let pid_dev = db.add_service_refund(sid_dia, 30.0, "Divisas (USD Cash)", "", "USD", "todo").unwrap();
        let fecha_dev: String = db.conn.lock().unwrap()
            .query_row("SELECT date(payment_date) FROM service_payments WHERE id=?1", params![pid_dev], |r| r.get(0)).unwrap();
        assert_eq!(fecha_dev, hoy, "la devolución cae en el turno abierto");
        let t_dev = db.get_daily_totals(&hoy, &hoy).unwrap();
        assert_eq!(t_dev[0].usd_cash_total, t_antes, "cobro y devolución del mismo día se cancelan en la caja (delta 0)");
        let historial = db.get_service_payments(sid_dia).unwrap();
        assert_eq!(historial.len(), 2);
        assert!(historial[0].amount > 0.0 && historial[1].amount < 0.0, "el historial queda en orden cronológico");

        // 9) NO se puede devolver con la tolerancia una y otra vez (deriva negativa): con el neto en 0
        //    el tope es 0 y no 0,5 — regresión que introdujo la primera versión de F36.
        for _ in 0..3 {
            let err = db.add_service_refund(sid_dia, 0.5, "Divisas (USD Cash)", "", "USD", "deriva").unwrap_err().to_string();
            assert!(err.contains("hasta $0.00"), "sin disponible no se devuelve ni la tolerancia: {err}");
        }
        assert!(db.get_service_by_id(sid_dia).unwrap().unwrap().paid_amount.abs() < 0.01, "el abonado sigue en 0");

        // 10) Un MONTO NEGATIVO no es un pago (sería una devolución encubierta que saltea el tope)
        let err = db.add_service_payment(sid_dia, -100.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap_err().to_string();
        assert!(err.contains("mayor a 0"), "un pago negativo se rechaza: {err}");

        // 11) BORRAR el cobro del que ya se devolvió → rechazado (dejaría el neto en −$30)
        let pid_cobro: i64 = db.conn.lock().unwrap()
            .query_row("SELECT id FROM service_payments WHERE service_id=?1 AND amount > 0", params![sid_dia], |r| r.get(0)).unwrap();
        let err = db.delete_service_payment(pid_cobro).unwrap_err().to_string();
        assert!(err.contains("devolución registrada"), "no se borra un cobro ya devuelto: {err}");

        // 12) Una orden DEVUELTA no acepta más pagos (antes solo lo decía la UI)
        let sid_dev = db.add_service("DEV-F36X", "Cliente Dev", "0412-7", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.update_service(sid_dev, "Cliente Dev", "0412-7", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
            100.0, "Divisas (USD Cash)", "", "Devuelto", "", 0.0, "", "USD", "", "", "", "", None, "", None, 0.0).unwrap();
        let err = db.add_service_payment(sid_dev, 10.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap_err().to_string();
        assert!(err.contains("no acepta más pagos"), "una orden Devuelta no recibe plata: {err}");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F36 (bloqueante de la revisión adversarial): la MIGRACIÓN DE ARRANQUE tiene que usar la MISMA
    /// regla que `recalc_paid_amount`. Antes `init()` tenía su propio UPDATE con la fórmula vieja
    /// («convertir cada movimiento con la tasa de su día») y, como corre en CADA arranque, reescribía
    /// todos los saldos con la regla vieja: el mismo saldo valía distinto según la última acción.
    #[test]
    fn test_migration_keeps_f36_net_rule() {
        let test_path = PathBuf::from("test_f36_migration.db");
        let _ = std::fs::remove_file(&test_path);
        let (hoy, ayer): (String, String) = {
            let db = Database::new(&test_path).expect("Failed to create test DB");
            let conn = db.conn.lock().unwrap();
            let q = |sql: &str| -> String { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
            let (h, a) = (q("SELECT date('now','localtime')"), q("SELECT date('now','localtime','-1 day')"));
            drop(conn);
            drop(db);
            (h, a)
        };
        // Dos turnos abiertos con tasas DISTINTAS: ayer 40,5 (primero donde entra la plata) y hoy 50.
        {
            let db = Database::new(&test_path).expect("reopen");
            db.open_day(0.0, 50.0, 55.0).unwrap();
            db.conn.lock().unwrap().execute(
                "INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, tasa_eur, is_closed) VALUES (?1, 0, 40.5, 45, 0)",
                params![ayer],
            ).unwrap();
            let sid = db.add_service("DEV-F36M", "Cliente", "0412-1", "Samsung A15", "Rota", "Cambio pantalla", "[\"Cambio pantalla\"]",
                250.0, "Efectivo Bs", "", 0.0, "", "USD", "", "", "", None, "", None, "", None, 0.0).unwrap();
            // Abono de ayer (tasa 40,5) + abono de hoy (tasa 50) → neto 8.550 Bs
            db.add_service_payment(sid, 4050.0, "Efectivo Bs", 0.0, "", "USD", "ayer", &ayer).unwrap();
            db.add_service_payment(sid, 4500.0, "Efectivo Bs", 0.0, "", "USD", "hoy", &hoy).unwrap();
            let paid = db.get_service_by_id(sid).unwrap().unwrap().paid_amount;
            // Regla F36: todo el neto valuado a la tasa del PRIMER ingreso (40,5) = $211,11
            assert!((paid - 211.11).abs() < 0.05, "regla F36 en la app: {paid}");
            assert!((paid - 190.0).abs() > 1.0, "NO es la suma por día ($190): {paid}");
        }
        // «REINICIO»: al volver a abrir la base corre `init()` (y su migración de paid_amount)
        {
            let db = Database::new(&test_path).expect("reopen 2");
            let sid: i64 = db.conn.lock().unwrap()
                .query_row("SELECT id FROM services WHERE order_num='DEV-F36M'", [], |r| r.get(0)).unwrap();
            let paid = db.get_service_by_id(sid).unwrap().unwrap().paid_amount;
            assert!((paid - 211.11).abs() < 0.05,
                    "tras reiniciar la app el saldo NO puede volver a la regla vieja ($190): {paid}");
        }
        let _ = std::fs::remove_file(&test_path);
    }

    /// F41 — LA MEMORIA TIENE QUE ENTERARSE DE CUALQUIER ESCRITURA. Es el riesgo declarado de
    /// esta feature: un número viejo en pantalla es peor que un número lento. La señal es
    /// `total_changes()` de SQLite (ver `src/cache.rs`), y acá se prueban los tres tipos de
    /// escritura que importan: alta de producto, cambio de stock POR DETRÁS (el que hace el
    /// auto-inventario al entregar un servicio: `UPDATE products SET stock = stock + ?1`, que
    /// NO toca `updated_at`) y un cambio en el padrón de teléfonos.
    #[test]
    fn test_catalog_cache_is_invalidated_by_writes() {
        let test_path = PathBuf::from("test_catalog_cache_invalidates.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("db");

        // (0) memoria FRÍA sobre base vacía
        assert_eq!(db.get_inventory_stats().unwrap().sku, 0);
        assert!(db.get_phone_brands().unwrap().is_empty());

        // (1) alta de producto (pasa por rebuild_phones: también crea la ficha del teléfono)
        db.add_product("Pantalla Samsung A10", Some(1), "Samsung", "A10", "",
                       r#"["Samsung A10"]"#, 1.0, 2.0, 5, 0, 0.0).unwrap();
        assert_eq!(db.get_inventory_stats().unwrap().sku, 1,
                   "el alta tiene que verse en los KPIs: la memoria quedó vieja");

        let stock_de = |db: &Database| -> (i64, String) {
            let page = db.get_phones_page(None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
            let visto: Vec<String> = page.items.iter().map(|p| format!("{}|{}|{}", p.name, p.model, p.stock)).collect();
            let stock = page.items.iter()
                .find(|p| p.name.contains("A10") || p.model.contains("A10"))
                .map(|p| p.stock).unwrap_or(-1);
            (stock, visto.join(" · "))
        };
        let (stock0, visto0) = stock_de(&db);
        assert_eq!(stock0, 5, "el padrón ve el stock del catálogo (filas: {visto0})");

        // (2) cambio de stock por detrás (auto-inventario al entregar): NO toca updated_at
        db.conn.lock().unwrap()
            .execute("UPDATE products SET stock = stock + 3 WHERE name='Pantalla Samsung A10'", []).unwrap();
        let (stock1, visto1) = stock_de(&db);
        assert_eq!(stock1, 8,
                   "un cambio de stock sin updated_at también tiene que invalidar la memoria (filas: {visto1})");
        let modelo = db.get_phone_models("", 0).unwrap();
        assert_eq!(modelo.iter().find(|m| m.label.contains("A10")).map(|m| m.stock).unwrap_or(-1), 8,
                   "el selector de modelo ve el stock nuevo (misma memoria)");

        // (3) cambio en el PADRÓN de teléfonos (renombrar es la operación real del taller)
        let name_before = db.get_phones_page(None, "", false, false, false, "nombre", "asc", 50, 0).unwrap()
            .items[0].name.clone();
        let id = db.get_phones_page(None, "", false, false, false, "nombre", "asc", 50, 0).unwrap().items[0].id;
        crate::phones::rename_phone(&db.conn.lock().unwrap(), id, "Samsung", "", "A10s").unwrap();
        let name_after = db.get_phones_page(None, "", false, false, false, "nombre", "asc", 50, 0).unwrap()
            .items[0].name.clone();
        assert_ne!(name_before, name_after, "el renombrado tiene que verse en la lista");
        assert!(name_after.to_lowercase().contains("a10s"), "nombre nuevo: {name_after}");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F41 — EL BUSCADOR DE REPUESTOS usa el catálogo memorizado (con la compatibilidad ya
    /// parseada) y tiene que comportarse IGUAL que antes: respeta el filtro de categoría (el
    /// desplegable de pantalla del servicio pide sólo categoría 1), marca la coincidencia de
    /// marca del padrón y ve los cambios apenas se guarda un producto.
    #[test]
    fn test_cached_catalog_keeps_the_repair_search_semantics() {
        let test_path = PathBuf::from("test_cached_catalog_search.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("db");

        let pantalla = db.add_product("Pantalla Samsung A10", Some(1), "Samsung", "A10", "",
                                      r#"["Samsung A10"]"#, 1.0, 2.0, 5, 0, 0.0).unwrap();
        db.add_product("Batería Samsung A10", Some(2), "Samsung", "A10", "",
                       r#"["Samsung A10"]"#, 1.0, 2.0, 3, 0, 0.0).unwrap();
        db.add_product("Pantalla Honor 10 Lite", Some(1), "Honor", "10 Lite", "",
                       r#"["Honor 10 Lite"]"#, 1.0, 2.0, 1, 0, 0.0).unwrap();

        // sólo PANTALLAS (categoría 1) para el desplegable del servicio, y con marca confirmada
        let pantallas = db.find_compatible_screens("Samsung A10", 100).unwrap();
        assert_eq!(pantallas.len(), 1, "el filtro de categoría sigue valiendo: {:?}",
                   pantallas.iter().map(|c| c.product.name.clone()).collect::<Vec<_>>());
        assert_eq!(pantallas[0].product.id, pantalla);
        assert!(pantallas[0].brand_match, "la marca del padrón marca la coincidencia");
        assert_eq!(pantallas[0].match_quality, "exacta");

        // todas las categorías (sugerencia de precio del repuesto que corresponda)
        let todos = db.find_compatible_products("Samsung A10", None, 100).unwrap();
        assert_eq!(todos.len(), 2, "sin filtro entran pantalla y batería");

        // la otra marca NO se cuela aunque el modelo se parezca («10 Lite»)
        let honor = db.find_compatible_screens("Honor 10 Lite", 100).unwrap();
        assert_eq!(honor.len(), 1);
        assert_eq!(honor[0].product.name, "Pantalla Honor 10 Lite");

        // y un producto EDITADO se ve al instante (la compatibilidad parseada no queda vieja)
        db.update_product(pantalla, "Pantalla Samsung A10", Some(1), "Samsung", "A10", "",
                          r#"["Samsung A10"]"#, 1.0, 2.0, 0, 0, 0.0).unwrap();
        let tras_editar = db.find_compatible_screens("Samsung A10", 100).unwrap();
        assert_eq!(tras_editar[0].product.stock, 0, "el stock editado tiene que verse");
        assert!(!tras_editar[0].in_stock);

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F41 — LA MEMORIA TIENE QUE VER TAMBIÉN LAS ESCRITURAS DE OTRA CONEXIÓN (bloqueante de la
    /// revisión adversarial). `total_changes()` es un contador POR CONEXIÓN: por sí solo no
    /// alcanza, y hay un caso real sin salir de la app: **dos ventanas abiertas** (no hay guard
    /// de instancia única) o una herramienta de `tools/` cargando inventario con la app abierta.
    /// La segunda mitad de la versión es `PRAGMA data_version`, que cambia en cada commit AJENO y
    /// no con las escrituras propias. Este test abre una SEGUNDA conexión al mismo archivo.
    #[test]
    fn test_catalog_cache_sees_writes_from_another_connection() {
        let test_path = PathBuf::from("test_catalog_cache_otra_conexion.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("db");
        db.add_product("Pantalla Samsung A20", Some(1), "Samsung", "A20", "",
                       r#"["Samsung A20"]"#, 1.0, 2.0, 4, 0, 0.0).unwrap();
        let stock_padron = |db: &Database| -> i64 {
            db.get_phones_page(None, "", false, false, false, "nombre", "asc", 50, 0)
                .unwrap().items.iter().map(|p| p.stock).sum()
        };
        assert_eq!(db.get_inventory_stats().unwrap().units, 4, "stock inicial");
        assert_eq!(stock_padron(&db), 4);

        // OTRA conexión (como otra ventana de la app) cambia el stock
        {
            let otra = Connection::open(&test_path).expect("segunda conexión");
            otra.execute("UPDATE products SET stock = 9 WHERE name='Pantalla Samsung A20'", []).unwrap();
        }

        assert_eq!(db.get_inventory_stats().unwrap().units, 9,
                   "una escritura de OTRA conexión tiene que verse (PRAGMA data_version)");
        assert_eq!(stock_padron(&db), 9,
                   "el padrón tampoco puede quedar con el stock viejo");
        assert_eq!(db.get_phone_models("", 0).unwrap().iter().map(|m| m.stock).sum::<i64>(), 9,
                   "el selector de modelo tampoco");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// F42 — LA DEVOLUCIÓN VUELVE POR DONDE ENTRÓ, y el arqueo no la esconde.
    ///
    /// Caso REAL de la tienda (2026-09-17): orden de $5 con el formulario en «Punto de Venta (Bs)»,
    /// cobrada $3 en efectivo + Bs. 1.697 por **Pago Móvil** (Bs. 1.697 = $2 a la tasa 848,5458). El
    /// operario devolvió esos Bs. 1.697 y el diálogo propuso el método del FORMULARIO → la devolución
    /// quedó anotada en el Punto: el cierre mostraba **Punto −Bs. 1.697** (una máquina que devuelve
    /// plata no existe), el cajón esperaba 0 por la plata que salió y, como la fila del Punto sólo se
    /// dibuja con esperado > 0, la devolución **no aparecía en ninguna parte** del arqueo.
    #[test]
    fn test_refund_goes_back_by_the_method_that_collected() {
        let test_path = PathBuf::from("test_refund_metodo.db");
        let _ = std::fs::remove_file(&test_path);
        let db = Database::new(&test_path).expect("db");
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.open_day(0.0, 848.5458, 974.4191).unwrap();

        let sid = db.add_service("DEV-0001", "Roberth", "0412-1", "Spark 10 Pro", "Rota",
            "Cambio pantalla", "[\"Cambio pantalla\"]", 5.0, "Punto de Venta (Bs)", "", 0.0, "", "VES",
            "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid, 3.0, "Divisas (USD Cash)", 0.0, "", "USD", "", "").unwrap();
        db.add_service_payment(sid, 1697.0, "Pago Móvil", 0.0, "", "VES", "ref 1234", "").unwrap();

        // (1) El PUNTO no puede devolver: nunca cobró nada en esa orden
        let err = db.add_service_refund(sid, 1697.0, "Punto de Venta (Bs)", "", "VES", "").unwrap_err().to_string();
        assert!(err.contains("no entró plata"), "devolución por un método que no cobró → rechazada: {err}");
        assert!(err.contains("Pago Móvil"), "el mensaje dice POR DÓNDE entró: {err}");

        // (2) Por donde entró (Pago Móvil) sí: el día queda honesto y la devolución se VE
        db.add_service_refund(sid, 1697.0, "Pago Móvil", "", "VES", "devuelto igual que pagó").unwrap();
        let t = db.get_daily_totals(&today, &today).unwrap()[0].clone();
        assert_eq!(t.pago_movil_total, 0.0, "Pago Móvil neto = 0 (entró y salió)");
        assert_eq!(t.pos_charged_bs, 0.0, "el Punto NUNCA queda en negativo");
        assert_eq!(t.cash_bs, 0.0, "el cajón no se toca (la plata volvió por el banco)");
        assert_eq!(t.usd_cash_total, 3.0, "las divisas del día no cambian");
        assert_eq!(t.refund_bs, 1697.0, "el día dice cuánto se devolvió (en positivo)");
        assert_eq!(t.refund_usd, 0.0);
        assert_eq!(t.grand_bs, 0.0, "neto del día en Bs = 0");

        // (3) El CAJÓN sí puede pagar una devolución aunque la plata haya entrado por transferencia:
        //     es legítimo (el mostrador devuelve en efectivo) y el esperado queda NEGATIVO — o sea que
        //     la UI tiene que mostrarlo (por eso el arqueo usa «≠ 0», no «> 0»).
        let sid2 = db.add_service("DEV-0002", "Roberth", "0412-2", "iPhone 13", "Rota", "Cambio batería",
            "[\"Cambio batería\"]", 20.0, "Pago Móvil", "", 0.0, "", "VES", "", "", "", None, "", None, "", None, 0.0).unwrap();
        db.add_service_payment(sid2, 2000.0, "Pago Móvil", 0.0, "", "VES", "", "").unwrap();
        db.add_service_refund(sid2, 2000.0, "Efectivo Bs", "", "VES", "devuelto del cajón").unwrap();
        let t2 = db.get_daily_totals(&today, &today).unwrap()[0].clone();
        assert_eq!(t2.pago_movil_total, 2000.0, "el Pago Móvil de la 2ª orden sigue ahí (plata en el banco)");
        assert_eq!(t2.cash_bs, -2000.0, "el cajón espera −Bs. 2.000: salió plata del cajón (la UI lo muestra con signo)");
        assert_eq!(t2.refund_bs, 3697.0, "lo devuelto del día suma las dos devoluciones (1.697 + 2.000)");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }

    /// MIDE (no afirma) los endpoints del inventario sobre una COPIA de la base real: la
    /// original no se toca. Sirve para decidir con números dónde está la lentitud y para
    /// comprobar que una optimización realmente movió la aguja.
    ///   node tools/snapshot_db.mjs --out backup/perf.db
    ///   $env:REGISTRO_BENCH_DB="C:\Users\ROBER\registro\backup\perf.db"
    ///   cd src-tauri; cargo test --release -- --ignored test_manual_inventory_bench --nocapture
    /// OJO: hay que medir en RELEASE. En debug los tiempos son 5-20x peores y llevarían a
    /// «optimizar» algo que en producción ya estaba bien.
    #[test]
    #[ignore = "manual: mide los endpoints del inventario sobre REGISTRO_BENCH_DB"]
    fn test_manual_inventory_bench() {
        use std::time::Instant;
        fn ms<F: FnMut()>(label: &str, reps: u32, mut f: F) {
            f(); // calentamiento (páginas de SQLite, asignaciones, caché de CPU)
            let t = Instant::now();
            for _ in 0..reps { f(); }
            println!("{:>9.2} ms  {}", t.elapsed().as_secs_f64() * 1000.0 / f64::from(reps), label);
        }

        let src = std::env::var("REGISTRO_BENCH_DB").expect("define REGISTRO_BENCH_DB");
        let tmp = std::env::temp_dir().join("registro_inventory_bench.db");
        let _ = std::fs::remove_file(&tmp);
        std::fs::copy(&src, &tmp).expect("no pude copiar la base a un temporal");
        let t0 = Instant::now();
        let db = Database::new(&tmp).expect("no pude abrir la copia");
        println!("{:>9.2} ms  Database::new (arranque + migraciones)",
                 t0.elapsed().as_secs_f64() * 1000.0);

        {
            let c = db.conn.lock().unwrap();
            let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap_or(-1) };
            println!(
                "datos: {} productos · {} teléfonos del padrón · {} movimientos · {} categorías",
                n("SELECT COUNT(*) FROM products"),
                n("SELECT COUNT(*) FROM phones"),
                n("SELECT COUNT(*) FROM inventory_movements"),
                n("SELECT COUNT(*) FROM categories"),
            );
        }

        ms("Inventario: get_categories", 20, || { db.get_categories().unwrap(); });
        ms("Productos : get_products_page (Pantalla, 50)", 20, || {
            db.get_products_page("", Some(1), None, Some("todos"), None, Some("nombre"), 50, 0).unwrap();
        });
        ms("Productos : get_products_page (sin filtro, 50)", 20, || {
            db.get_products_page("", None, None, Some("todos"), None, Some("nombre"), 50, 0).unwrap();
        });
        ms("Productos : get_products_page (busca 'red note')", 20, || {
            db.get_products_page("red note", None, None, Some("todos"), None, Some("nombre"), 50, 0).unwrap();
        });
        ms("Movim.    : get_inventory_movements_page (50)", 20, || {
            db.get_inventory_movements_page(None, None, None, None, None, 50, 0).unwrap();
        });

        // ---------------- cálculos CRUDOS (lo que costaba cada pestaña antes de la memoria) --
        println!("\n--- cálculos CRUDOS (sin memoria) ---");
        ms("Modelos   : build_index (recorre y parsea compat.)", 5, || {
            let c = db.conn.lock().unwrap();
            crate::phones::build_index(&c).unwrap();
        });
        ms("Modelos   : build_rows (los 1135 teléfonos)", 5, || {
            let c = db.conn.lock().unwrap();
            let idx = crate::phones::build_index(&c).unwrap();
            crate::phones::build_rows(&c, &idx).unwrap();
        });
        ms("Productos : build_inventory_stats (KPIs)", 5, || {
            let c = db.conn.lock().unwrap();
            build_inventory_stats(&c).unwrap();
        });
        ms("Por modelo: build_parsed_products (catálogo)", 5, || {
            let c = db.conn.lock().unwrap();
            build_parsed_products(&c).unwrap();
        });

        // ---------------- lo que ve la PESTAÑA, con la memoria del catálogo -----------------
        // Memoria FRÍA = primera visita después de abrir la app (o después de cualquier
        // escritura). Memoria CALIENTE = volver a la pestaña sin haber escrito nada.
        println!("\n--- endpoints del inventario (memoria FRÍA = primera vez) ---");
        let cold_path = std::env::temp_dir().join("registro_inventory_bench_cold.db");
        let _ = std::fs::remove_file(&cold_path);
        std::fs::copy(&src, &cold_path).expect("no pude copiar la base (fría)");
        let cold = Database::new(&cold_path).expect("no pude abrir la copia fría");
        let one = |label: &str, f: &mut dyn FnMut()| {
            let t = Instant::now();
            f();
            println!("{:>9.2} ms  {}", t.elapsed().as_secs_f64() * 1000.0, label);
        };
        one("Productos : get_inventory_stats (1ª vez)", &mut || { cold.get_inventory_stats().unwrap(); });
        one("Modelos   : get_phone_brands (1ª vez)", &mut || { cold.get_phone_brands().unwrap(); });
        one("Modelos   : get_phones (1ª vez)", &mut || {
            cold.get_phones_page(None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
        });
        one("Modelos   : get_phone_models (1ª vez)", &mut || { cold.get_phone_models("", 60).unwrap(); });
        one("Por modelo: find_compatible_screens (1ª vez)", &mut || {
            cold.find_compatible_screens("Redmi Note 11", 100).unwrap();
        });

        println!("\n--- endpoints del inventario (memoria CALIENTE = pestaña ya usada) ---");
        ms("Productos : get_inventory_stats (KPIs)", 20, || { db.get_inventory_stats().unwrap(); });
        ms("Modelos   : get_phone_brands", 20, || { db.get_phone_brands().unwrap(); });
        ms("Modelos   : get_phones (página 50 de N)", 20, || {
            db.get_phones_page(None, "", false, false, false, "nombre", "asc", 50, 0).unwrap();
        });
        ms("Modelos   : get_phones (busca 'a06')", 20, || {
            db.get_phones_page(None, "a06", false, false, false, "nombre", "asc", 50, 0).unwrap();
        });
        ms("Modelos   : get_phone_models (combobox, 60)", 20, || { db.get_phone_models("", 60).unwrap(); });
        ms("Modelos   : get_phone_models (busca 'red')", 20, || { db.get_phone_models("red", 60).unwrap(); });
        ms("Por modelo: find_compatible_screens", 20, || { db.find_compatible_screens("Redmi Note 11", 100).unwrap(); });
        println!("(reconstrucciones del catálogo en total: {})",
                 db.cache.lock().unwrap().builds());

        drop(cold);
        drop(db);
        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(&cold_path);
    }

    /// PRUEBA DE LA ACTUALIZACIÓN: corre la MIGRACIÓN REAL de la app sobre una base concreta.
    ///
    /// POR QUÉ EXISTE: cuando el local actualiza (`0.2.5 → 0.4.0`), lo primero que hace la versión
    /// nueva es abrir SU base (la del taller) y correr `init()`: `ALTER TABLE` de las columnas
    /// nuevas, reconstrucción del padrón de teléfonos, recálculo de `paid_amount`, etc. Eso tiene
    /// que dejar intactas las ventas, los servicios, los abonos, los clientes y los cierres — es la
    /// condición del dueño («que no le afecte la db ni las ventas registradas»). Medirlo con un
    /// test que AFIRMA cosas no alcanza cuando la pregunta es «¿y con MIS datos?»: este hook abre
    /// la base que le indiques con el MISMO camino que el arranque (nada de SQL reimplementado acá)
    /// y deja la base lista para que `tools/verify_migracion_datos.mjs` compare antes/después.
    ///
    /// SIEMPRE sobre una COPIA (el script se encarga); nunca la base del taller.
    ///   $env:REGISTRO_MIGRATE_DB="C:\ruta\copia.db"
    ///   $env:REGISTRO_MIGRATE_MARK="C:\ruta\centinela.txt"   (opcional: evidencia de que corrió)
    ///   cd src-tauri; cargo test --lib -- --ignored test_manual_migrate_db --nocapture
    ///
    /// El CENTINELA existe por una lección de la revisión adversarial del 2026-09-18: la prueba que
    /// usa este hook comparaba la copia contra sí misma si la migración no llegaba a correr (un
    /// filtro que no matchea deja `cargo test` en exit 0 con «0 filtered out»), o sea un FALSO VERDE
    /// sobre lo único que el dueño pidió. Con el centinela, `tools/verify_migracion_datos.mjs` exige
    /// un archivo que SOLO se escribe al final de una migración real.
    #[test]
    #[ignore = "manual: corre la migración real (Database::new/init) sobre REGISTRO_MIGRATE_DB"]
    fn test_manual_migrate_db() {
        use std::time::Instant;
        let path = std::env::var("REGISTRO_MIGRATE_DB")
            .expect("define REGISTRO_MIGRATE_DB con la ruta de una COPIA de la base");
        let centinela = std::env::var("REGISTRO_MIGRATE_MARK").ok();

        let t0 = Instant::now();
        let db = Database::new(&PathBuf::from(&path)).expect("la migración falló: la app no abriría");
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        println!("migración (Database::new + init): {ms:.1} ms");

        let resumen = {
            let c = db.conn.lock().unwrap();
            let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap_or(-1) };
            let resumen = format!(
                "historia: {} ventas · {} servicios · {} abonos · {} clientes · {} cierres · {} gastos\n\
                 catálogo: {} productos · {} unidades · {} teléfonos del padrón\n\
                 integrity_check: {}\n\
                 foreign_key_check: {} violación(es)",
                n("SELECT COUNT(*) FROM sales"),
                n("SELECT COUNT(*) FROM services"),
                n("SELECT COUNT(*) FROM service_payments"),
                n("SELECT COUNT(*) FROM clients"),
                n("SELECT COUNT(*) FROM daily_closings"),
                n("SELECT COUNT(*) FROM expenses"),
                n("SELECT COUNT(*) FROM products"),
                n("SELECT COALESCE(SUM(stock),0) FROM products"),
                n("SELECT COUNT(*) FROM phones"),
                c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                    .unwrap_or_else(|e| format!("ERROR: {e}")),
                c.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0))
                    .unwrap_or(-1),
            );
            let integ: String = c
                .query_row("PRAGMA integrity_check", [], |r| r.get(0))
                .unwrap_or_else(|e| format!("ERROR: {e}"));
            assert_eq!(integ, "ok", "la base quedó íntegra después de migrar");
            resumen
        };
        println!("{resumen}");

        // El mismo chequeo de salud que corre la app DESPUÉS de actualizarse (updates.rs): si esto
        // falla, el updater hace rollback. Que pase acá significa que no habría rollback por datos.
        let salud = crate::updates::run_health_check(&db, false);
        println!("salud post-migración: ok={} avisos={:?}", salud.ok, salud.warnings);
        assert!(salud.ok, "el chequeo de salud falló: {:?}", salud.issues);
        drop(db);

        // CENTINELA: última línea del hook. Solo se escribe si todo lo de arriba pasó.
        if let Some(marca) = centinela {
            let texto = format!(
                "OK\nbase: {path}\nmigración: {ms:.1} ms\n{resumen}\nsalud: ok={}\n",
                salud.ok
            );
            std::fs::write(&marca, texto).expect("no pude escribir el centinela de la migración");
        }
    }
}
