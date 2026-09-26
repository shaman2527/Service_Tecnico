use tauri::State;
use crate::db::Database;

#[tauri::command]
pub fn get_categories(db: State<Database>) -> Result<Vec<crate::db::Category>, String> {
    db.get_categories().map_err(|e| e.to_string())
}

// --- F65: CATEGORÍAS DE PRODUCTO (crear / renombrar / borrar) -----------------------------------
// Pedido del dueño (2026-09-23): «cuando en este inventario pueda registrar nuevas categorías, no
// esté limitado a crear categorías de productos». La categoría era una lista CERRADA; ahora el
// catálogo del local se puede organizar como el local trabaje.
//
// Las tres ESCRITURAS son del DUEÑO (`require_owner`), igual que `add_product`/`update_product`/
// `delete_product`: son cambios del catálogo, no del mostrador. La LECTURA con uso real
// (`get_categories_with_usage`) no lleva gate, como el resto de las lecturas.
//
// La validación es del BACKEND (no del frontend): nombre recortado/no vacío/tope 40, sin duplicados
// comparando el nombre PLEGADO (mayúsculas y acentos), las tres categorías del padrón de teléfonos
// protegidas y una categoría con productos NO se borra (se dice cuántos son).

/// F65 — Las categorías con su uso (fichas, unidades y si son del padrón de teléfonos).
#[tauri::command]
pub fn get_categories_with_usage(db: State<Database>) -> Result<Vec<crate::db::CategoryUsage>, String> {
    db.get_categories_with_usage().map_err(|e| e.to_string())
}

/// F65 — Crea una categoría de producto (o devuelve la que ya existe, con `created: false`).
#[tauri::command]
pub fn add_category(db: State<Database>, name: String, description: String) -> Result<crate::db::CategoryOutcome, String> {
    db.require_owner()?;
    db.add_category(&name, &description).map_err(|e| e.to_string())
}

/// F65 — Renombra una categoría (los productos NO se tocan: siguen apuntando al mismo id).
#[tauri::command]
pub fn rename_category(db: State<Database>, id: i64, name: String, description: String) -> Result<crate::db::Category, String> {
    db.require_owner()?;
    db.rename_category(id, &name, &description).map_err(|e| e.to_string())
}

/// F65 — Borra una categoría VACÍA (deshacer un error de tipeo). Con productos adentro, no.
#[tauri::command]
pub fn delete_category(db: State<Database>, id: i64) -> Result<(), String> {
    db.require_owner()?;
    db.delete_category(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_payment_methods(db: State<Database>) -> Result<Vec<crate::db::PaymentMethod>, String> {
    db.get_payment_methods().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service_statuses(db: State<Database>) -> Result<Vec<crate::db::ServiceStatus>, String> {
    db.get_service_statuses().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn next_order_num(db: State<Database>) -> Result<String, String> {
    db.next_order_num().map_err(|e| e.to_string())
}

// --- Products (ESCRITURA solo para el DUENO: gate de rol en el backend) ---

#[tauri::command]
pub fn add_product(db: State<Database>, name: String, category_id: Option<i64>, brand: String, model: String,
                   variant: String, compatibility: String, price_cost: f64, price_sale: f64,
                   stock: i64, min_stock: i64, price_usd: f64) -> Result<i64, String> {
    db.require_owner()?;
    db.add_product(&name, category_id, &brand, &model, &variant, &compatibility, price_cost, price_sale, stock, min_stock, price_usd)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_product(db: State<Database>, id: i64, name: String, category_id: Option<i64>, brand: String, model: String,
                      variant: String, compatibility: String, price_cost: f64, price_sale: f64,
                      stock: i64, min_stock: i64, price_usd: f64) -> Result<(), String> {
    db.require_owner()?;
    db.update_product(id, &name, category_id, &brand, &model, &variant, &compatibility, price_cost, price_sale, stock, min_stock, price_usd)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_product(db: State<Database>, id: i64) -> Result<(), String> {
    db.require_owner()?;
    db.delete_product(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_products(db: State<Database>, search: String, category_id: Option<i64>) -> Result<Vec<crate::db::Product>, String> {
    let mut items = db.get_products(&search, category_id).map_err(|e| e.to_string())?;
    sin_costo_para_caja(&db, &mut items);
    Ok(items)
}

#[tauri::command]
pub fn get_low_stock_products(db: State<Database>) -> Result<Vec<crate::db::Product>, String> {
    let mut items = db.get_low_stock_products().map_err(|e| e.to_string())?;
    sin_costo_para_caja(&db, &mut items);
    Ok(items)
}

#[tauri::command]
pub fn get_reorder_suggestions(db: State<Database>) -> Result<Vec<crate::db::Product>, String> {
    let mut items = db.get_reorder_suggestions().map_err(|e| e.to_string())?;
    sin_costo_para_caja(&db, &mut items);
    Ok(items)
}

#[tauri::command]
pub fn suggest_products(db: State<Database>, query: String, limit: i64) -> Result<Vec<crate::db::Product>, String> {
    let mut items = db.suggest_products(&query, limit).map_err(|e| e.to_string())?;
    sin_costo_para_caja(&db, &mut items);
    Ok(items)
}

/// F69 — EL COSTO ES DEL DUEÑO. La pantalla ya escondía la columna «Costo» y el KPI «Capital a
/// costo» para la caja (`verCosto`), pero el número VIAJABA igual hasta el navegador: cualquiera
/// podía leerlo con un invoke directo o mirando la respuesta. Acá se borra en el origen, en el
/// único lugar por donde salen los productos. El precio de VENTA no se toca: la caja lo necesita
/// para cobrar.
///
/// F69 (revisión adversarial) — FAIL-CLOSED con la sesión vencida: `current_is_cashier()` es false
/// cuando la sesión venció (12 h) o cuando no hay ninguna, así que el costo VOLVÍA a viajar mientras
/// la pantalla seguía en modo caja. En una instalación con más de una persona, sin sesión válida se
/// asume el perfil más restrictivo (caja); en la instalación de un solo dueño no hay a quién
/// esconderle nada.
fn sin_costo_para_caja(db: &Database, items: &mut [crate::db::Product]) {
    let hay_sesion = db.current_user().is_some();
    let ocultar = db.current_is_cashier() || (!hay_sesion && db.has_multiple_people());
    if ocultar {
        for p in items.iter_mut() {
            p.price_cost = 0.0;
        }
    }
}

/// F69 (revisión adversarial) — el mismo criterio para las pantallas/repuestos compatibles: son
/// productos completos (con `price_cost`) y la pantalla de la cajera los pide al recibir un equipo.
fn sin_costo_candidatos(db: &Database, items: &mut [crate::db::ScreenCandidate]) {
    let hay_sesion = db.current_user().is_some();
    if db.current_is_cashier() || (!hay_sesion && db.has_multiple_people()) {
        for c in items.iter_mut() {
            c.product.price_cost = 0.0;
        }
    }
}

// --- Sales ---

#[tauri::command]
pub fn add_sale(db: State<Database>, product_id: Option<i64>, product_name: String, quantity: i64,
                unit_price: f64, total: f64, payment_method: String, client_name: String,
                client_id: Option<i64>, notes: String,
                bank_fee_percent: f64, zelle_reference: String, currency: String, discount_amount: f64,
                // F74 — el IVA con el que se cargó ESTA venta (0/'' = sin IVA). Opcionales: los
                // llamadores viejos siguen funcionando y una venta sin IVA nace en 0/''.
                iva_rate: Option<f64>, iva_mode: Option<String>) -> Result<(), String> {
    db.add_sale_tax(product_id, &product_name, quantity, unit_price, total, &payment_method, &client_name, client_id, &notes, bank_fee_percent, &zelle_reference, &currency, discount_amount,
                    iva_rate.unwrap_or(0.0), &iva_mode.unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sales(db: State<Database>, search: String, days: Option<i64>, start_date: String, end_date: String) -> Result<Vec<crate::db::Sale>, String> {
    db.get_sales(&search, days, &start_date, &end_date).map_err(|e| e.to_string())
}

/// F70 — ANULAR UNA VENTA (con reverso de stock). Es del DUEÑO: mueve la caja del día, devuelve stock
/// y `clients.total_spent`; la venta no se borra (queda marcada con su motivo y su contra-asiento).
#[tauri::command]
pub fn void_sale(db: State<Database>, id: i64, reason: String) -> Result<(), String> {
    db.require_owner()?;
    db.void_sale(id, &reason).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sales_stats(db: State<Database>, days: i64) -> Result<Vec<crate::db::SaleStat>, String> {
    db.get_sales_stats(days).map_err(|e| e.to_string())
}

// --- F74: LA CONFIGURACIÓN DEL IVA ---

/// La configuración del IVA (activar/desactivar, alícuota y modo). La **lectura no lleva gate**: la
/// caja necesita saber si hay IVA para desglosar lo que cobra. La escritura es del DUEÑO (es una
/// decisión del negocio y cambia lo que se cobra desde el próximo guardado).
#[tauri::command]
pub fn get_tax_config(db: State<Database>) -> Result<crate::db::TaxConfig, String> {
    Ok(db.get_tax_config())
}

/// Guarda la configuración del IVA. Valida el BACKEND (modo whitelist, alícuota 0…100): un modo
/// desconocido o una alícuota absurda se rechazan con un mensaje que dice qué se espera.
#[tauri::command]
pub fn set_tax_config(db: State<Database>, activo: bool, alicuota: f64, modo: String) -> Result<crate::db::TaxConfig, String> {
    db.require_owner()?;
    db.set_tax_config(activo, alicuota, &modo).map_err(|e| e.to_string())
}

/// F74 — EL LIBRO DE IVA del período (operaciones agrupadas por alícuota). Es del DUEÑO: es el número
/// con el que se declara (la caja no ve la facturación global, misma regla que la utilidad).
#[tauri::command]
pub fn get_iva_groups(db: State<Database>, start_date: String, end_date: String) -> Result<Vec<crate::db::IvaGroupRow>, String> {
    db.require_owner()?;
    db.get_iva_groups(&start_date, &end_date).map_err(|e| e.to_string())
}

// --- Services ---

#[tauri::command]
pub fn add_service(db: State<Database>, order_num: String, client: String, phone: String, model: String,
                   fault: String, service_type: String, service_types: String, amount: f64, payment_method: String, observations: String,
                   bank_fee_percent: f64, zelle_reference: String, currency: String,
                   client_ci: String, client_address: String, device_checklist: String,
                   client_id: Option<i64>, technician: String, technician_id: Option<i64>,
                   color: String, screen_product_id: Option<i64>, discount_amount: f64) -> Result<i64, String> {
    db.add_service(&order_num, &client, &phone, &model, &fault, &service_type, &service_types, amount, &payment_method, &observations, bank_fee_percent, &zelle_reference, &currency, &client_ci, &client_address, &device_checklist, client_id, &technician, technician_id, &color, screen_product_id, discount_amount)
        .map_err(|e| e.to_string())
}

// Orden multi-equipo: un cliente trae N teléfonos → una orden con group_id compartido (transaccional)
#[tauri::command]
pub fn add_service_order(db: State<Database>, client: String, phone: String, client_ci: String, client_address: String,
                         client_id: Option<i64>, technician: String, technician_id: Option<i64>,
                         devices: Vec<crate::db::ServiceDeviceInput>) -> Result<String, String> {
    db.add_service_order(&client, &phone, &client_ci, &client_address, client_id, &technician, technician_id, &devices)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_service(db: State<Database>, id: i64, client: String, phone: String, model: String, fault: String,
                      service_type: String, service_types: String, amount: f64, payment_method: String, date_out: String, status: String, observations: String,
                      bank_fee_percent: f64, zelle_reference: String, currency: String,
                      client_ci: String, client_address: String, device_checklist: String,
                      technician: String, technician_id: Option<i64>, color: String,
                      screen_product_id: Option<i64>, discount_amount: f64) -> Result<(), String> {
    db.update_service(id, &client, &phone, &model, &fault, &service_type, &service_types, amount, &payment_method, &date_out, &status, &observations, bank_fee_percent, &zelle_reference, &currency, &client_ci, &client_address, &device_checklist, &technician, technician_id, &color, screen_product_id, discount_amount)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_service_printed(db: State<Database>, id: i64) -> Result<(), String> {
    db.mark_service_printed(id).map_err(|e| e.to_string())
}

// F32 — señales de política del taller (foto de entrada/salida y acuerdo de pago).
// `key` sale de una whitelist en `Database::set_service_policy` (clave desconocida = error):
// un invoke a mano no puede escribir otra columna. `value`: "si"/"" para las fotos y
// ""/"ahora"/"al_retirar" para el acuerdo. La hora la estampa el backend (hora local).
#[tauri::command]
pub fn set_service_policy(db: State<Database>, id: i64, key: String, value: String) -> Result<(), String> {
    db.set_service_policy(id, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service(db: State<Database>, id: i64) -> Result<(), String> {
    // Borrar una orden también borra sus abonos (plata registrada): es del dueño.
    // La cajera sí puede crear, editar y entregar órdenes (add_service/add_service_order/update_service).
    db.require_owner()?;
    db.delete_service(id).map_err(|e| e.to_string())
}

// F32: `date_field` elige el eje del rango — "out" = fecha de ENTREGA (para «entregados hoy»),
// vacío o "in" = fecha de RECIBIDO (histórico). Opcional: los llamadores viejos siguen andando.
#[tauri::command]
pub fn get_services(db: State<Database>, search: String, status: String, start_date: String, end_date: String,
                    date_field: Option<String>) -> Result<Vec<crate::db::Service>, String> {
    let field = date_field.unwrap_or_default();
    db.get_services(&search, &status, &start_date, &end_date, &field).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service(db: State<Database>, id: i64) -> Result<crate::db::Service, String> {
    db.get_service_by_id(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Servicio no encontrado".to_string())
}

#[tauri::command]
pub fn get_service_dashboard(db: State<Database>) -> Result<crate::db::ServiceDashboard, String> {
    db.get_service_dashboard().map_err(|e| e.to_string())
}

// --- Technicians ---

#[tauri::command]
pub fn get_technicians(db: State<Database>) -> Result<Vec<crate::db::Technician>, String> {
    db.get_technicians().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_technician_stats(db: State<Database>) -> Result<Vec<crate::db::TechnicianStat>, String> {
    db.get_technician_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_technician(db: State<Database>, name: String, initials: String, color: String) -> Result<i64, String> {
    db.require_owner()?;
    db.add_technician(&name, &initials, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_technician(db: State<Database>, id: i64, name: String, initials: String, color: String) -> Result<(), String> {
    db.require_owner()?;
    db.update_technician(id, &name, &initials, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_technician(db: State<Database>, id: i64) -> Result<(), String> {
    db.require_owner()?;
    db.delete_technician(id).map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — las ANALÍTICAS DEL DASHBOARD (7 días de facturación con desglose por
/// categoría, top de modelos CON MONTOS, ingresos por método) son del DUEÑO: la pantalla Dashboard ya
/// estaba escondida para la caja, pero el invoke directo las devolvía. Los números operativos del día
/// que la caja SÍ usa salen por otros comandos (`get_daily_totals`, `get_service_dashboard`,
/// `get_sales_stats`), que siguen abiertos a propósito.
#[tauri::command]
pub fn get_dashboard_analytics(db: State<Database>) -> Result<crate::db::DashboardAnalytics, String> {
    db.require_owner()?;
    db.get_dashboard_analytics().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service_payments(db: State<Database>, service_id: i64) -> Result<Vec<crate::db::ServicePayment>, String> {
    db.get_service_payments(service_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_service_payment(db: State<Database>, service_id: i64, amount: f64, payment_method: String,
                           bank_fee_percent: f64, zelle_reference: String, currency: String,
                           notes: String, payment_date: String) -> Result<i64, String> {
    db.add_service_payment(service_id, amount, &payment_method, bank_fee_percent, &zelle_reference, &currency, &notes, &payment_date)
        .map_err(|e| e.to_string())
}

/// F35 — corregir la FECHA de un pago ya anotado (el cliente pagó el mismo día en que dejó el equipo
/// pero avisó después). No crea ni borra plata: la mueve al día en que entró, así la caja de ese día
/// cuadra. Sin gate de dueño (es la cajera la que está en el mostrador cuando pasa), pero con las
/// guardas de día cerrado/futuro del backend.
#[tauri::command]
pub fn update_service_payment_date(db: State<Database>, id: i64, date: String) -> Result<(), String> {
    db.update_service_payment_date(id, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service_payment(db: State<Database>, id: i64) -> Result<(), String> {
    // Borrar un abono tacha una plata ya cobrada: es del dueño. Para devolver plata
    // de verdad existe el camino trazable (`add_service_refund`, que la cajera SÍ usa).
    db.require_owner()?;
    db.delete_service_payment(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_service_refund(db: State<Database>, service_id: i64, amount: f64, payment_method: String,
                          zelle_reference: String, currency: String,
                          notes: String) -> Result<i64, String> {
    db.add_service_refund(service_id, amount, &payment_method, &zelle_reference, &currency, &notes)
        .map_err(|e| e.to_string())
}

// ── F50: «LO QUE USO» (el check del inventario y del padrón) + códigos de referencia ──────────
// Son columnas propias (in_use / code / default_product_id): comandos ANGOSTOS para que el check no
// pueda pisar precios, stock ni compatibilidad. El check solo decide QUÉ SE OFRECE al registrar un
// servicio; el descuento de inventario al entregar sigue por `screen_product_id` como siempre.
//
// F69 (revisión adversarial) — ESTAS ESCRITURAS SON DEL DUEÑO: deciden qué ve el mostrador (el
// catálogo que se ofrece) y la pantalla de referencia del modelo. La UI ya las escondía a la caja
// (`canEdit`); el gate del backend es el que vale.
#[tauri::command]
pub fn set_product_in_use(db: State<Database>, id: i64, in_use: bool) -> Result<(), String> {
    db.require_owner()?;
    db.set_product_in_use(id, in_use).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_phone_in_use(db: State<Database>, id: i64, in_use: bool) -> Result<(), String> {
    db.require_owner()?;
    db.set_phone_in_use(id, in_use).map_err(|e| e.to_string())
}

/// «Usar todo el modelo» / «Apagar todo el modelo»: el teléfono y sus repuestos en una transacción.
#[tauri::command]
pub fn set_phone_use_all(db: State<Database>, id: i64, in_use: bool) -> Result<i64, String> {
    db.require_owner()?;
    db.set_phone_use_all(id, in_use).map_err(|e| e.to_string())
}

/// F53: la pantalla de REFERENCIA del modelo (la que el local instala). `None` = ninguna.
#[tauri::command]
pub fn set_phone_default_product(db: State<Database>, id: i64, product_id: Option<i64>) -> Result<(), String> {
    db.require_owner()?;
    db.set_phone_default_product(id, product_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_product_code(db: State<Database>, id: i64, code: String) -> Result<(), String> {
    db.require_owner()?;
    db.set_product_code(id, &code).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_phone_code(db: State<Database>, id: i64, code: String) -> Result<(), String> {
    db.require_owner()?;
    db.set_phone_code(id, &code).map_err(|e| e.to_string())
}

/// F50: la lista de modelos del formulario de servicio, con `in_use_only` (el check del padrón).
#[tauri::command]
pub fn get_phone_models_in_use(db: State<Database>, search: String, limit: i64, in_use_only: bool)
    -> Result<Vec<crate::db::PhoneModelRow>, String> {
    db.get_phone_models_filtered(&search, limit, in_use_only).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_purchase_order(db: State<Database>, supplier: String, notes: String, items_json: String) -> Result<i64, String> {
    // Pedir al proveedor es una compra (plata del negocio): decisión del dueño.
    // Recibir la mercancía que llegó SÍ es de la cajera (`mark_purchase_order_received`).
    db.require_owner()?;
    db.add_purchase_order(&supplier, &notes, &items_json).map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — los PEDIDOS A PROVEEDOR traen lo que costó cada repuesto
/// (`unit_price`/`total_cost`), así que su lectura es del DUEÑO igual que su alta. La caja SÍ puede
/// marcar un pedido como recibido (`mark_purchase_order_received`, sin gate): es el trabajo del
/// mostrador cuando llega el proveedor.
#[tauri::command]
pub fn get_purchase_orders(db: State<Database>) -> Result<Vec<crate::db::PurchaseOrder>, String> {
    db.require_owner()?;
    db.get_purchase_orders().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_purchase_order_items(db: State<Database>, order_id: i64) -> Result<Vec<crate::db::PurchaseOrderItem>, String> {
    db.require_owner()?;
    db.get_purchase_order_items(order_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_purchase_order_received(db: State<Database>, order_id: i64) -> Result<(), String> {
    db.mark_purchase_order_received(order_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_purchase_order(db: State<Database>, order_id: i64) -> Result<(), String> {
    db.require_owner()?;
    db.delete_purchase_order(order_id).map_err(|e| e.to_string())
}

// --- Clients ---

#[tauri::command]
pub fn get_clients(db: State<Database>, search: String) -> Result<Vec<crate::db::ClientSummary>, String> {
    db.get_clients(&search).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_client(db: State<Database>, name: String, phone: String, email: String, notes: String) -> Result<i64, String> {
    db.add_client(&name, &phone, &email, &notes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_or_find_client(db: State<Database>, name: String, phone: String, ci: String, address: String) -> Result<i64, String> {
    db.add_or_find_client(&name, &phone, &ci, &address).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_client(db: State<Database>, id: Option<i64>, name: String, phone: String, ci: String, address: String, email: String, notes: String) -> Result<i64, String> {
    db.save_client(id, &name, &phone, &ci, &address, &email, &notes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn find_client_by_ci(db: State<Database>, ci: String) -> Result<Option<crate::db::Client>, String> {
    db.find_client_by_ci(&ci).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn find_client(db: State<Database>, name: String) -> Result<Option<i64>, String> {
    db.find_client(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_client_services(db: State<Database>, client_id: i64) -> Result<Vec<crate::db::Service>, String> {
    db.get_client_services(client_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_client_sales(db: State<Database>, client_id: i64) -> Result<Vec<crate::db::Sale>, String> {
    db.get_client_sales(client_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn suggest_clients(db: State<Database>, query: String, limit: i64) -> Result<Vec<crate::db::Client>, String> {
    db.suggest_clients(&query, limit).map_err(|e| e.to_string())
}

// --- Inventory ---

#[tauri::command]
pub fn add_inventory_movement(db: State<Database>, product_id: i64, type_: String, quantity: i64, reason: String, reference: String) -> Result<(), String> {
    // Ajuste MANUAL de stock (no es una venta ni una entrega): es del dueño.
    db.require_owner()?;
    db.add_inventory_movement(product_id, &type_, quantity, &reason, &reference).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_inventory_movements(db: State<Database>, days: Option<i64>) -> Result<Vec<crate::db::InventoryMovement>, String> {
    db.get_inventory_movements(days).map_err(|e| e.to_string())
}

// --- Import/Export (la carga masiva de precios y el reemplazo de la base son del dueño;
//     `export_data` es una LECTURA y la cajera puede exportar el día) ---

#[tauri::command]
pub fn import_price_list(db: State<Database>, items_json: String) -> Result<i64, String> {
    db.require_owner()?;
    db.import_price_list(&items_json).map_err(|e| e.to_string())
}

// --- F71: RESPALDO Y RESTAURACIÓN desde la app (bloqueante A2 de la auditoría de entrega) ---

/// «Respaldar ahora»: copia consistente de la base (VACUUM INTO, se lleva lo que está en el WAL) a la
/// carpeta elegida (o `respaldos/` al lado de la base). Es del DUEÑO: la copia tiene todo el negocio.
#[tauri::command]
pub fn backup_now(db: State<Database>, dir: Option<String>) -> Result<crate::backups::BackupInfo, String> {
    db.require_owner()?;
    let info = crate::backups::backup_now(&db.db_path, dir.as_deref(), false);
    match &info {
        Ok(i) => { let _ = db.set_setting("last_backup_at", &i.created_at); let _ = db.set_setting("last_backup_error", ""); }
        Err(e) => { let _ = db.set_setting("last_backup_error", e); }
    }
    info
}

/// Los respaldos de la carpeta (del más nuevo al más viejo) — para la lista de la pantalla.
#[tauri::command]
pub fn list_backups(db: State<Database>, dir: Option<String>) -> Result<Vec<crate::backups::BackupInfo>, String> {
    let d = match dir.as_deref().map(str::trim) {
        Some(x) if !x.is_empty() => std::path::PathBuf::from(x),
        _ => crate::backups::default_dir(&db.db_path),
    };
    Ok(crate::backups::listar(&d))
}

/// Estado del respaldo (carpeta, último, error) para mostrarlo en Ayuda.
#[tauri::command]
pub fn backup_status(db: State<Database>, dir: Option<String>) -> Result<crate::backups::BackupStatus, String> {
    let error = db.get_setting("last_backup_error").ok().flatten().filter(|e| !e.trim().is_empty());
    Ok(crate::backups::status(&db.db_path, dir.as_deref(), error))
}

/// «Restaurar desde un respaldo»: valida el archivo, guarda una copia de la base ACTUAL y deja la
/// restauración pendiente para el próximo arranque (con la conexión abierta no se pisa el archivo).
/// Del DUEÑO. Después de esto, el frontend reinicia la app.
#[tauri::command]
pub fn request_restore(db: State<Database>, path: String) -> Result<crate::backups::RestorePlan, String> {
    db.require_owner()?;
    crate::backups::request_restore(&db.db_path, &path)
}

/// ¿Hay una restauración pendiente de aplicar en el próximo arranque? (la pantalla lo avisa)
#[tauri::command]
pub fn restore_pending(db: State<Database>) -> Result<bool, String> {
    Ok(crate::backups::marker_path(&db.db_path).exists())
}

#[tauri::command]
pub fn export_data(db: State<Database>) -> Result<String, String> {
    db.require_owner()?;
    db.export_data().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_data(db: State<Database>, json_data: String, merge: bool) -> Result<String, String> {
    // Puede REEMPLAZAR toda la base (merge=false): jamás desde una sesión de cajera.
    db.require_owner()?;
    db.import_data(&json_data, merge).map_err(|e| e.to_string())
}

// --- Daily Ledger ---

#[tauri::command]
pub fn get_bcv_rate() -> Result<crate::bcv::TasasBCV, String> {
    crate::bcv::obtener_tasas()
}

#[tauri::command]
pub fn get_daily_totals(db: State<Database>, start_date: String, end_date: String) -> Result<Vec<crate::db::DailyTotals>, String> {
    db.get_daily_totals(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_day_summary(db: State<Database>, date: String) -> Result<crate::db::DaySummary, String> {
    db.get_day_summary(&date).map_err(|e| e.to_string())
}

// --- Salud del negocio: LECTURAS abiertas; anotar/borrar un GASTO es del dueño ---

/// F69 — `method` = DE DÓNDE SALIÓ LA PLATA ('' = sin declarar). Un gasto pagado DEL CAJÓN
/// (`Divisas (USD Cash)` / `Efectivo Bs`) baja el efectivo esperado al cerrar el día.
#[tauri::command]
pub fn add_expense(db: State<Database>, expense_date: String, category: String, amount: f64, currency: String,
                   notes: String, method: Option<String>) -> Result<i64, String> {
    db.require_owner()?;
    db.add_expense(&expense_date, &category, amount, &currency, &notes, method.as_deref().unwrap_or(""))
        .map_err(|e| e.to_string())
}

/// F69 — lo que ajusta el arqueo del cajón ese día (fondo, gastos y devoluciones pagados del cajón),
/// para que el operario VEA de dónde sale el número antes de contar la plata.
#[tauri::command]
pub fn get_drawer_adjustments(db: State<Database>, date: String) -> Result<crate::db::DrawerAdjust, String> {
    db.drawer_adjustments(&date).map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — los GASTOS DEL NEGOCIO (alquiler, sueldos, retiros del dueño) son del
/// dueño: la pestaña Gastos y la de Salud ya eran suyas, pero el listado se podía pedir por IPC desde
/// una sesión de caja. Lo que la caja necesita para su arqueo es el **agregado del cajón**
/// (`get_drawer_adjustments`: fondo y gastos pagados del cajón), no el detalle de en qué se gastó.
#[tauri::command]
pub fn get_expenses(db: State<Database>, start_date: String, end_date: String) -> Result<Vec<crate::db::Expense>, String> {
    db.require_owner()?;
    db.get_expenses(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_expense(db: State<Database>, id: i64) -> Result<(), String> {
    db.require_owner()?;
    db.delete_expense(id).map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — la UTILIDAD y los márgenes del negocio son del DUEÑO: es
/// exactamente el número que la caja no debe ver («no vea cuánto factura la master»). La cajera
/// sigue cerrando su día con los totales de caja (`get_daily_totals`), que no traen costo.
#[tauri::command]
pub fn get_profit_summary(db: State<Database>, start_date: String, end_date: String) -> Result<crate::db::ProfitSummary, String> {
    db.require_owner()?;
    db.get_profit_summary(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_receivables(db: State<Database>) -> Result<crate::db::ReceivablesSummary, String> {
    db.get_receivables().map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — el CAPITAL del inventario (a costo) es del DUEÑO: la caja cobra,
/// no negocia el capital del negocio. El KPI «Capital a costo» ya estaba escondido en pantalla;
/// esto cierra el camino del invoke directo.
#[tauri::command]
pub fn get_inventory_value(db: State<Database>) -> Result<crate::db::InventoryValue, String> {
    db.require_owner()?;
    db.get_inventory_value().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_daily_closings(db: State<Database>) -> Result<Vec<crate::db::DailyClosing>, String> {
    db.get_daily_closings().map_err(|e| e.to_string())
}

// --- Turno de caja: ABRIR el día es de la cajera (lo abre con la tasa BCV y la
//     apertura); CERRAR/REABRIR el día y liquidar el Punto son del dueño ---

#[tauri::command]
pub fn open_day(db: State<Database>, initial_cash_usd: f64, tasa_bcv: f64, tasa_eur: f64) -> Result<i64, String> {
    db.open_day(initial_cash_usd, tasa_bcv, tasa_eur).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_day(db: State<Database>) -> Result<Option<crate::db::DailyClosing>, String> {
    db.get_active_day().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_day(db: State<Database>, close_date: String, notes: String, initial_cash_usd: f64, tasa_bcv: f64, tasa_eur: f64,
                 actual_cash_usd: f64, actual_cash_bs: f64, actual_punto_usd: f64, actual_punto_bs: f64,
                 actual_zelle: f64, actual_pago_movil: f64, actual_transfer_bs: f64,
                 pos_settled: f64, pos_settled_bs: f64) -> Result<i64, String> {
    // El CIERRE (arqueo + diferencia) cierra el día y no lo puede deshacer la cajera.
    db.require_owner()?;
    db.close_day(&close_date, &notes, initial_cash_usd, tasa_bcv, tasa_eur,
                 actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs,
                 actual_zelle, actual_pago_movil, actual_transfer_bs, pos_settled, pos_settled_bs)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reopen_day(db: State<Database>, close_date: String) -> Result<(), String> {
    db.require_owner()?;
    db.reopen_day(&close_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_daily_closing_settlement(db: State<Database>, id: i64, pos_settled: f64, pos_settled_bs: f64) -> Result<(), String> {
    // Liquidar el Punto ajusta la plata de un día ya cerrado: es del dueño.
    db.require_owner()?;
    db.update_daily_closing_settlement(id, pos_settled, pos_settled_bs).map_err(|e| e.to_string())
}

// --- Settings / PIN (escribirlos es del DUENO; LECTURAS y `verify_pin` son de todos) ---

#[tauri::command]
pub fn set_pin(db: State<Database>, pin: String) -> Result<(), String> {
    db.require_owner()?;
    db.set_pin(&pin).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pin_status(db: State<Database>) -> Result<bool, String> {
    db.get_pin_status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn verify_pin(db: State<Database>, pin: String) -> Result<bool, String> {
    db.verify_pin(&pin).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_pin(db: State<Database>, pin: String) -> Result<bool, String> {
    db.require_owner()?;
    db.remove_pin(&pin).map_err(|e| e.to_string())
}

/// BLOQUEA la sesión de dueño (botón «Bloquear sesión» de la UI): a partir de acá los
/// comandos del dueño vuelven a pedir el PIN. Cualquiera puede llamarlo — cerrar la
/// sesión NUNCA es un privilegio (al contrario: es la salida segura).
#[tauri::command]
pub fn lock_owner(db: State<Database>) -> Result<(), String> {
    db.lock_owner();
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// F68 — SESIONES DE CAJA (Master / Caja): quién entra, con SU PIN, y quién hizo cada movimiento
// ─────────────────────────────────────────────────────────────────────────────────────────────

/// Las personas que pueden entrar a la app (sin el hash del PIN). Cualquiera puede LEER la lista:
/// la pantalla de acceso la necesita para mostrar a quién entrar.
#[tauri::command]
pub fn get_users(db: State<Database>, only_active: Option<bool>) -> Result<Vec<crate::db::UserOut>, String> {
    db.get_users(only_active.unwrap_or(true)).map_err(|e| e.to_string())
}

/// Quién está usando la app AHORA (`None` = sesión cerrada). La UI decide qué mostrar con esto.
#[tauri::command]
pub fn get_current_user(db: State<Database>) -> Result<Option<crate::db::SessionUser>, String> {
    Ok(db.current_user())
}

/// F68 — entrar como una persona con SU PIN. Abre la sesión (12 h) y devuelve quién entró.
/// Un PIN vacío en la fila = esa persona no tiene PIN (entra directo).
#[tauri::command]
pub fn verify_user_pin(db: State<Database>, user_id: i64, pin: String) -> Result<Option<crate::db::SessionUser>, String> {
    db.verify_user_pin(user_id, &pin).map_err(|e| e.to_string())
}

/// Crear una persona es del DUEÑO (crear accesos no puede ser una acción de la caja).
#[tauri::command]
pub fn add_user(db: State<Database>, name: String, role: String, pin: String, color: String) -> Result<i64, String> {
    db.require_owner()?;
    db.add_user(&name, &role, &pin, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_user(db: State<Database>, id: i64, name: String, color: String, active: bool) -> Result<(), String> {
    db.require_owner()?;
    db.update_user(id, &name, &color, active).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_user_pin(db: State<Database>, id: i64, pin: String) -> Result<(), String> {
    db.require_owner()?;
    db.set_user_pin(id, &pin).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_user(db: State<Database>, id: i64) -> Result<(), String> {
    db.require_owner()?;
    db.delete_user(id).map_err(|e| e.to_string())
}

/// F68/F40 — el LIBRO DE PLATA. La sesión de CAJA sólo ve SUS movimientos (el backend lo impone
/// con su propio id, no el frontend): es lo que pidió el dueño — «que vea su día de caja pero no
/// cuánto factura la master».
/// F69 (revisión adversarial, fail-closed): si NO hay sesión y la instalación tiene más de una
/// persona, NO se muestra nada de nadie — antes el filtro vacío se convertía en «mostrame todo»,
/// así que una sesión vencida (o un invoke directo) abría el libro completo a la caja.
#[tauri::command]
pub fn get_cash_movements(db: State<Database>, start_date: String, end_date: String, limit: Option<i64>)
    -> Result<Vec<crate::db::CashMovement>, String> {
    let filtro = match db.current_user() {
        Some(u) if u.role == "caja" => Some(u.id),
        Some(_) => None,
        None => {
            if db.has_multiple_people() {
                return Err("Entrá con tu PIN para ver el libro de caja.".to_string());
            }
            None
        }
    };
    db.get_cash_movements(&start_date, &end_date, filtro, limit.unwrap_or(300))
        .map_err(|e| e.to_string())
}

/// F68 — resumen del libro por persona. Es del DUEÑO: la caja no ve cuánto movió la master.
#[tauri::command]
pub fn get_cash_movements_by_user(db: State<Database>, start_date: String, end_date: String)
    -> Result<Vec<CashMovementByUser>, String> {
    db.require_owner()?;
    let filas = db.get_cash_movements_by_user(&start_date, &end_date).map_err(|e| e.to_string())?;
    Ok(filas.into_iter()
        .map(|(name, count, usd, bs)| CashMovementByUser { name, count, usd, bs })
        .collect())
}

#[derive(serde::Serialize)]
pub struct CashMovementByUser {
    pub name: String,
    pub count: i64,
    pub usd: f64,
    pub bs: f64,
}

// --- Impresora térmica: IMPRIMIR es de la cajera (es su trabajo del mostrador);
//     CONFIGURARLA (puerto, ancho, nombre del negocio, logo) es del dueño ---

#[tauri::command]
pub fn list_com_ports() -> Result<Vec<crate::printer::ComPortInfo>, String> {
    crate::printer::list_com_ports()
}

#[tauri::command]
pub fn probe_com_port(port: String, baud: u32) -> Result<(), String> {
    crate::printer::probe_com_port(&port, baud)
}

#[tauri::command]
pub fn print_receipt(port: String, baud: u32, text: String, terms: Option<String>, footer: Option<String>, raster: Option<Vec<u8>>, raster_width: Option<u32>) -> Result<(), String> {
    crate::printer::print_receipt(&port, baud, &text, terms.as_deref(), footer.as_deref(), raster.as_deref(), raster_width)
}

#[tauri::command]
pub fn list_windows_printers() -> Result<Vec<String>, String> {
    crate::printer::list_windows_printers()
}

#[tauri::command]
pub fn print_to_windows_printer(printer: String, text: String, terms: Option<String>, footer: Option<String>, raster: Option<Vec<u8>>, raster_width: Option<u32>) -> Result<(), String> {
    crate::printer::print_to_windows_printer(&printer, &text, terms.as_deref(), footer.as_deref(), raster.as_deref(), raster_width)
}

#[tauri::command]
pub fn get_printer_settings(db: State<Database>) -> Result<crate::db::PrinterSettings, String> {
    db.get_printer_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_printer_settings(db: State<Database>, port: String, baud: u32, width: u32, windows_printer: String,
                            business_name: String, business_line: String, logo: String) -> Result<(), String> {
    db.require_owner()?;
    db.set_printer_settings(&port, baud, width, &windows_printer, &business_name, &business_line, &logo).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_windows_printer_status(printer: String) -> Result<String, String> {
    crate::printer::get_windows_printer_status(&printer)
}

// --- F62: CATEGORÍAS DE TRABAJO QUE AGREGA EL LOCAL ---------------------------------------------
// Pedido del dueño (2026-09-21): «en las categorías o los types, donde sale Otro, cuando vas a hacer
// un registro poder registrar ahí mismo una nueva categoría con un +».
//
// Viven en `settings` (clave `work_types_extra`, un JSON array de nombres): son del LOCAL, no del
// producto, y NO se tocan las órdenes viejas (la etiqueta viaja dentro de cada orden).
// Dos comandos ANGOSTOS en vez de un `set_setting` genérico: el nombre se VALIDA en el backend (no
// vacío, tope de largo, sin duplicados que solo cambien mayúsculas/acentos) y el JSON lo arma el
// backend, nunca el texto crudo del frontend.

/// Las categorías extra del local (JSON array; `[]` si nunca se agregó ninguna).
#[tauri::command]
pub fn get_work_types_extra(db: State<Database>) -> Result<String, String> {
    db.get_work_types_extra().map_err(|e| e.to_string())
}

/// Agrega una categoría y devuelve la lista COMPLETA resultante (JSON array).
/// No exige día abierto: es una preferencia del local, no plata. **Es del MOSTRADOR a propósito**:
/// recibir un equipo con un trabajo que no está en la lista es parte del trabajo de la caja.
#[tauri::command]
pub fn add_work_type_extra(db: State<Database>, name: String) -> Result<String, String> {
    db.add_work_type_extra(&name).map_err(|e| e.to_string())
}

/// Quita una categoría del local (para deshacer un error de tipeo). NO toca las órdenes ya
/// registradas: la etiqueta vive dentro de cada orden.
/// F69 (revisión adversarial) — QUITAR es del DUEÑO: saca la categoría para TODOS (el mostrador
/// perdería un trabajo que ya usa), mientras que agregar es la necesidad real de la caja.
#[tauri::command]
pub fn remove_work_type_extra(db: State<Database>, name: String) -> Result<String, String> {
    db.require_owner()?;
    db.remove_work_type_extra(&name).map_err(|e| e.to_string())
}

// --- Updates (respaldo / rollback / salud — módulo updates.rs) ---

/// Qué dejó realmente el respaldo previo. Devuelve las RUTAS (para poder decirle al usuario dónde
/// está su copia) y si el vigilante se pudo lanzar: si PowerShell está bloqueado por política, el
/// proceso que restaura la versión anterior no corre y el usuario TIENE que enterarse (antes el
/// `let _ = spawn()` lo tapaba, igual que el `.catch` del frontend tapaba el error del respaldo).
#[derive(serde::Serialize)]
pub struct UpdateBackup {
    pub db_backup: String,
    pub prev_exe: String,
    pub watchdog: bool,
}

/// F69 (revisión adversarial, BLOQUEANTE) — INSTALAR/REVERTIR una versión es del DUEÑO. Sin gate,
/// desde la consola del WebView se podía pedir `rollback_update` y volver a la build ANTERIOR a F68
/// (donde no había sesiones por persona ni gate de caja: el control de acceso desaparecía sin PIN), y
/// `backup_before_update` lanza el vigilante que a los 90 s restaura el exe previo y relanza.
/// `mark_update_ok`/`mark_update_failed`/`run_health_check`/`get_update_state` NO se gatean a
/// propósito: los usa el arranque ANTES de que alguien entre (gatearlos dejaría el estado «pending»
/// colgado y dispararía un rollback solo).
#[tauri::command]
pub fn backup_before_update(db: State<Database>, new_version: String, previous_version: String) -> Result<UpdateBackup, String> {
    db.require_owner()?;
    // Checkpoint WAL para que la copia de la DB quede consistente antes de copiarla
    {
        let conn = db.conn.lock().unwrap();
        conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .map_err(|e| e.to_string())?;
    }
    let dir = crate::updates::install_dir();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    crate::updates::backup_before_update(&dir, &exe, &crate::get_db_path(), &previous_version, &new_version)?;
    let watchdog = crate::updates::spawn_watchdog(&dir);
    Ok(UpdateBackup {
        db_backup: crate::updates::db_backup_path(&dir, &new_version).to_string_lossy().to_string(),
        prev_exe: crate::updates::prev_exe_path(&dir).to_string_lossy().to_string(),
        watchdog,
    })
}

#[tauri::command]
pub fn run_health_check(db: State<Database>) -> Result<crate::updates::HealthReport, String> {
    Ok(crate::updates::run_health_check(&db, true))
}

#[tauri::command]
pub fn mark_update_ok() -> Result<(), String> {
    crate::updates::set_status(&crate::updates::install_dir(), "ok")
}

#[tauri::command]
pub fn mark_update_failed() -> Result<(), String> {
    // Limpia un estado "pending" colgado (update que nunca se aplicó) SIN tocar
    // el exe — rollback_update restauraría la versión anterior sobre la actual,
    // lo que bajaría la versión en vez de solo reconciliar el estado.
    crate::updates::set_status(&crate::updates::install_dir(), "rolled_back")
}

#[tauri::command]
pub fn get_update_state() -> Result<Option<crate::updates::UpdateState>, String> {
    Ok(crate::updates::read_state(&crate::updates::install_dir()))
}

#[tauri::command]
pub fn rollback_update(db: State<Database>) -> Result<(), String> {
    db.require_owner()?;
    crate::updates::rollback_update(&crate::updates::install_dir())
}

#[tauri::command]
pub fn has_previous_version() -> Result<bool, String> {
    Ok(crate::updates::has_previous_version(&crate::updates::install_dir()))
}

// --- Reportes ---

#[tauri::command]
pub fn get_pago_movil_detail(db: State<Database>, date: String) -> Result<Vec<crate::db::PagoMovilDetail>, String> {
    db.get_pago_movil_detail(&date).map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — LOS REPORTES DEL DÍA son del DUEÑO: vuelcan ventas con cliente,
/// abonos con referencia, los totales y el CIERRE (arqueos y diferencia) de todo el rango. El botón
/// «Exportar Excel» del Libro Diario ya era suyo; el invoke directo quedaba abierto.
#[tauri::command]
pub fn export_daily_report(db: State<Database>, start_date: String, end_date: String) -> Result<String, String> {
    db.require_owner()?;
    db.export_daily_report(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_daily_report_xlsx(db: State<Database>, start_date: String, end_date: String) -> Result<String, String> {
    db.require_owner()?;
    db.export_daily_report_xlsx(&start_date, &end_date).map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — el buscador de PAGOS y su detalle por día son de la pestaña «Pagos»
/// del Libro Diario, que es del dueño (lista los cobros de TODAS las sesiones, con cliente y
/// referencia): la caja ya tiene su propio libro (`get_cash_movements`, filtrado por el backend).
#[tauri::command]
pub fn search_payments(db: State<Database>, start_date: Option<String>, end_date: Option<String>,
                       method: Option<String>, client: Option<String>,
                       reference: Option<String>, currency: Option<String>) -> Result<Vec<crate::db::PaymentSearchResult>, String> {
    db.require_owner()?;
    db.search_payments(start_date.as_deref(), end_date.as_deref(), method.as_deref(), client.as_deref(), reference.as_deref(), currency.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_payment_daily_detail(db: State<Database>, date: String, method: Option<String>) -> Result<Vec<crate::db::PaymentSearchResult>, String> {
    db.require_owner()?;
    db.get_payment_daily_detail(&date, method.as_deref()).map_err(|e| e.to_string())
}

// --- Catálogo: limpieza (marcas, modelos, nombres, compatibilidad). Solo el DUENO,
//     incluso en modo `dry_run`: la pestaña «Ajustes» del Inventario es suya ---

#[tauri::command]
pub fn normalize_catalog(db: State<Database>, dry_run: bool) -> Result<crate::catalog::CatalogReport, String> {
    db.require_owner()?;
    db.normalize_catalog(dry_run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_prices(db: State<Database>, path: Option<String>, only_zero: bool, dry_run: bool)
    -> Result<crate::catalog::PriceRestoreReport, String> {
    db.require_owner()?;
    db.restore_prices_from_file(path.as_deref(), only_zero, dry_run).map_err(|e| e.to_string())
}

// --- Inventario unificado: página, KPIs, modelos de teléfono y pantallas ---

#[tauri::command]
pub fn get_products_page(db: State<Database>, search: String, category_id: Option<i64>,
                         brand: Option<String>, stock_filter: Option<String>,
                         variant_family: Option<String>, sort: Option<String>,
                         limit: i64, offset: i64) -> Result<crate::db::ProductPage, String> {
    let mut page = db.get_products_page(&search, category_id, brand.as_deref(), stock_filter.as_deref(),
                         variant_family.as_deref(), sort.as_deref(), limit, offset)
        .map_err(|e| e.to_string())?;
    sin_costo_para_caja(&db, &mut page.items);
    Ok(page)
}

/// F52 — las familias de variante del catálogo (INCELL / OLED / ORIGINAL / sin variante) con su
/// conteo: lo que llena el filtro «Variante» del inventario.
#[tauri::command]
pub fn get_variant_families(db: State<Database>) -> Result<Vec<crate::db::VariantFamily>, String> {
    db.get_variant_families().map_err(|e| e.to_string())
}

/// F53 — grupos de MODELOS que se sirven con los MISMOS repuestos (propuesta del asistente de
/// duplicados; el dueño confirma grupo por grupo y la fusión conserva los nombres viejos como alias).
#[tauri::command]
pub fn get_phone_duplicate_groups(db: State<Database>) -> Result<Vec<crate::db::PhoneDuplicateGroup>, String> {
    db.get_phone_duplicate_groups().map_err(|e| e.to_string())
}

/// F53 — vista previa de «separar los modelos» (NO escribe nada): qué teléfonos aparecen, cuáles
/// dejan de existir y cuántas variantes se sacan del texto.
#[tauri::command]
pub fn preview_phone_split(db: State<Database>) -> Result<crate::db::PhoneSplitPreview, String> {
    db.preview_phone_split().map_err(|e| e.to_string())
}

/// F53 — aplica la separación (respalda la base antes): una fila por teléfono REAL, numerada y con
/// su «en uso». Solo el dueño puede (es una reescritura del padrón, no del catálogo).
#[tauri::command]
pub fn apply_phone_split(db: State<Database>) -> Result<crate::db::PhoneSplitPreview, String> {
    if !db.owner_can_edit() {
        return Err("Solo el dueño puede separar los modelos del padrón.".to_string());
    }
    db.apply_phone_split().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_inventory_stats(db: State<Database>) -> Result<crate::db::InventoryStats, String> {
    let mut stats = db.get_inventory_stats().map_err(|e| e.to_string())?;
    // F69: el KPI «Capital a costo» es del dueño (los demás KPIs —cuántos productos, cuánto
    // valdría la venta, cuántos sin precio— los necesita la caja para trabajar).
    if db.current_is_cashier() || (db.current_user().is_none() && db.has_multiple_people()) {
        stats.value_cost = 0.0;
    }
    Ok(stats)
}

#[tauri::command]
pub fn get_phone_models(db: State<Database>, search: String, limit: i64)
    -> Result<Vec<crate::db::PhoneModelRow>, String> {
    db.get_phone_models(&search, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn find_compatible_screens(db: State<Database>, model: String, limit: i64)
    -> Result<Vec<crate::db::ScreenCandidate>, String> {
    let mut items = db.find_compatible_screens(&model, limit).map_err(|e| e.to_string())?;
    sin_costo_candidatos(&db, &mut items);
    Ok(items)
}

/// Repuestos compatibles con un modelo (cualquier categoría si `category_id` es None).
#[tauri::command]
pub fn find_compatible_products(db: State<Database>, model: String, category_id: Option<i64>, limit: i64)
    -> Result<Vec<crate::db::ScreenCandidate>, String> {
    let mut items = db.find_compatible_products(&model, category_id, limit).map_err(|e| e.to_string())?;
    sin_costo_candidatos(&db, &mut items);
    Ok(items)
}

#[tauri::command]
pub fn get_inventory_movements_page(db: State<Database>, product_id: Option<i64>, movement_type: Option<String>,
                                    reason: Option<String>, from_date: Option<String>, to_date: Option<String>,
                                    limit: i64, offset: i64) -> Result<crate::db::MovementPage, String> {
    db.get_inventory_movements_page(product_id, movement_type.as_deref(), reason.as_deref(),
                                    from_date.as_deref(), to_date.as_deref(), limit, offset)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn merge_products(db: State<Database>, keep_id: i64, remove_id: i64) -> Result<(), String> {
    // Fusiona dos fichas (suma stock, repunta ventas/servicios): es del dueño.
    db.require_owner()?;
    db.merge_products(keep_id, remove_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_duplicate_groups(db: State<Database>) -> Result<Vec<crate::db::DuplicateGroup>, String> {
    db.get_duplicate_groups().map_err(|e| e.to_string())
}

// --- F2/F4: padron de telefonos (lista de modelos del taller) ---
// ESCRITURA solo para el DUENO, con gate en el BACKEND (no solo en la UI): el PIN
// correcto desbloquea la sesion (`verify_pin` -> `Database::owner_unlocked`).

#[tauri::command]
pub fn get_phone_brands(db: State<Database>) -> Result<Vec<crate::phones::PhoneBrandRow>, String> {
    db.get_phone_brands().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_phones(db: State<Database>, brand: Option<String>, search: String,
                  only_with_products: bool, only_stock: bool, only_review: bool,
                  sort: String, dir: String,
                  limit: i64, offset: i64) -> Result<crate::phones::PhonePage, String> {
    db.get_phones_page(brand.as_deref(), &search, only_with_products, only_stock,
                       only_review, &sort, &dir, limit, offset).map_err(|e| e.to_string())
}

/// F69 (revisión adversarial) — la FICHA DEL TELÉFONO también trae los repuestos compatibles, o sea
/// `price_cost` de cada uno: se borra para una sesión de caja (es el mismo dato que la vista «Por
/// modelo» muestra y el que la caja NO debe ver). El precio de venta y el stock siguen intactos.
#[tauri::command]
pub fn get_phone_detail(db: State<Database>, phone_id: i64) -> Result<Option<crate::phones::PhoneDetail>, String> {
    let ocultar = db.current_is_cashier() || (db.current_user().is_none() && db.has_multiple_people());
    let mut detalle = db.get_phone_detail(phone_id).map_err(|e| e.to_string())?;
    if ocultar {
        if let Some(d) = detalle.as_mut() {
            for b in d.blocks.iter_mut() {
                for p in b.items.iter_mut() {
                    p.price_cost = 0.0;
                }
            }
        }
    }
    Ok(detalle)
}

/// Puede esta sesion ESCRIBIR la lista de modelos? (la UI esconde los botones si no)
#[tauri::command]
pub fn can_edit_phones(db: State<Database>) -> Result<bool, String> {
    Ok(db.owner_can_edit())
}

/// Vista previa de un renombrado: NO escribe nada (nombre nuevo, choque de clave, repuestos).
#[tauri::command]
pub fn preview_rename_phone(db: State<Database>, id: i64, brand: String, line: String, model: String)
    -> Result<Option<crate::phones::RenamePreview>, String> {
    db.preview_rename_phone(id, &brand, &line, &model).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_phone(db: State<Database>, id: i64, brand: String, line: String, model: String) -> Result<(), String> {
    db.require_owner()?;
    let conn = db.conn.lock().unwrap();
    crate::phones::rename_phone(&conn, id, &brand, &line, &model).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_phone(db: State<Database>, brand: String, line: String, model: String) -> Result<i64, String> {
    db.require_owner()?;
    let conn = db.conn.lock().unwrap();
    crate::phones::add_phone(&conn, &brand, &line, &model).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn merge_phones(db: State<Database>, keep_id: i64, remove_id: i64) -> Result<(), String> {
    db.require_owner()?;
    let conn = db.conn.lock().unwrap();
    crate::phones::merge_phones(&conn, keep_id, remove_id).map_err(|e| e.to_string())
}

// --- F25: asistente para CARGAR EL INVENTARIO del local (pegar/abrir lista → cruce →
// vista previa → aplicar con respaldo). Escritura solo para el dueno.
// La categoria NO se pasa: es la regla del local (`catalog::PHONE_CATEGORIES`).

/// Cruce de la lista pegada contra el catalogo (NO escribe nada).
#[tauri::command]
pub fn preview_inventory_load(db: State<Database>, text: String)
    -> Result<crate::loadlist::LoadPreview, String> {
    let conn = db.conn.lock().unwrap();
    crate::loadlist::preview_load(&conn, &text).map_err(|e| e.to_string())
}

/// Proveedor que trajo la mercancía de una ficha (el asistente de carga lo anota solo; acá se
/// corrige a mano desde la ficha del producto).
#[tauri::command]
pub fn set_product_supplier(db: State<Database>, id: i64, supplier: String) -> Result<(), String> {
    db.require_owner()?;
    db.set_product_supplier(id, &supplier).map_err(|e| e.to_string())
}

/// Busqueda de pantallas para ASIGNAR A MANO una linea del conteo (solo lectura).
#[tauri::command]
pub fn search_inventory_load_targets(db: State<Database>, query: String, limit: Option<i64>)
    -> Result<Vec<crate::loadlist::LoadCandidate>, String> {
    let conn = db.conn.lock().unwrap();
    crate::loadlist::search_targets(&conn, &query, limit.unwrap_or(12)).map_err(|e| e.to_string())
}

/// Aplica la vista previa: respaldo de la base + stock por producto + movimiento.
/// `keep_ids` = fichas que la vista previa ya tenía asignadas: el barrido no las toca.
/// `supplier` = proveedor general de la carga (cada línea puede traer el suyo).
#[tauri::command]
pub fn apply_inventory_load(db: State<Database>, rows: Vec<crate::loadlist::LoadRow>,
                            zero_missing: bool, keep_ids: Vec<i64>, supplier: Option<String>)
    -> Result<crate::loadlist::LoadReport, String> {
    db.require_owner()?;
    let conn = db.conn.lock().unwrap();
    crate::loadlist::apply_load(&conn, &db.db_path, &rows, zero_missing, &keep_ids,
                                supplier.as_deref().unwrap_or(""))
}
// --- F78: CARGA MASIVA DE INVENTARIO EN CSV ---
// El formato con TODOS los campos del producto (nombre, categoría —incluso nuevas—, marca, modelo,
// variante, compatibilidad, costo, venta, efectivo, stock, mínimo, proveedor, código, «lo uso»).
// La vista previa NO escribe; el aplicar es del DUEÑO (como el conteo y el alta de productos) y hace
// respaldo de la base. El stock se SUMA a lo que ya hay: un archivo parcial nunca baja mercancía.

/// Cruce del CSV contra el catálogo: cada fila queda como NUEVO o YA EXISTE, con el diff y los avisos.
#[tauri::command]
pub fn preview_inventory_csv(db: State<Database>, text: String)
    -> Result<crate::csvload::CsvPreview, String> {
    db.preview_csv_load(&text).map_err(|e| e.to_string())
}

/// Aplica la carga (crea / actualiza / deja / elimina) con respaldo previo, en UNA transacción.
#[tauri::command]
pub fn apply_inventory_csv(db: State<Database>, input: crate::csvload::CsvApplyInput)
    -> Result<crate::csvload::CsvReport, String> {
    db.require_owner()?;
    db.apply_csv_load(&input)
}

/// La plantilla que se descarga desde el asistente. Sale del BACKEND a propósito: es el MISMO módulo
/// que después la lee, así no puede quedar una plantilla de mentira en el frontend (antes había dos
/// copias y ya diferían en el ejemplo del código).
#[tauri::command]
pub fn plantilla_inventory_csv() -> String {
    crate::csvload::plantilla_csv()
}

/// El catálogo en CSV (mismo formato de la plantilla): exportar → editar en Excel → reimportar.
#[tauri::command]
pub fn export_inventory_csv(db: State<Database>, category_id: Option<i64>) -> Result<String, String> {
    db.require_owner()?;
    db.export_products_csv(category_id).map_err(|e| e.to_string())
}

// --- Perfil profesional del tecnico (Dashboard) ---

#[tauri::command]
pub fn get_technician_profile(db: State<Database>, technician_id: Option<i64>,
                              start_date: String, end_date: String)
    -> Result<crate::tech::TechnicianProfile, String> {
    let conn = db.conn.lock().unwrap();
    crate::tech::get_technician_profile(&conn, technician_id, &start_date, &end_date)
        .map_err(|e| e.to_string())
}

// ============================================================================
// B3 (validación pre-producción): GATE DE ROL en el backend.
// La UI elige el rol (PIN del dueño vs «Entrar como cajera»), pero el que MANDA es
// este archivo: un `invoke()` directo desde la consola de la app no puede saltearlo.
// ============================================================================
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Base temporal de test. NUNCA toca registro.db del local ni backup/*.db.
    fn temp_db(name: &str) -> (Database, PathBuf) {
        let path = PathBuf::from(name);
        let _ = std::fs::remove_file(&path);
        let db = Database::new(&path).expect("base de test");
        (db, path)
    }

    /// (a) El gate de rol **falla sin dueño** (con mensaje claro en español) y **deja pasar con
    /// el PIN del dueño**. Se prueba la MISMA función que llaman los comandos
    /// (`db.require_owner()?`): que cada comando de escritura la llame lo verifica el test
    /// estructural de abajo, que lee este archivo.
    /// NOTA: no se usa `tauri::test` (mock runtime): con el feature `test` de Tauri el binario
    /// de tests no arranca en esta PC (STATUS_ENTRYPOINT_NOT_FOUND), así que se prueba la capa
    /// de base —que es donde vive la regla— y la cobertura de los comandos queda a cargo del
    /// test estructural.
    #[test]
    fn test_b3_el_gate_de_dueno_funciona() {
        let (db, path) = temp_db("test_b3_cmd_catalogo.db");
        db.set_pin("1234").unwrap();

        // --- sin sesión de dueño (una cajera con la app abierta) ---
        let err = db.require_owner().unwrap_err();
        assert!(err.contains("Solo el dueño puede"), "mensaje claro para el operario: {err}");

        // --- con el PIN del dueño, el gate abre y las escrituras del catálogo pasan ---
        assert!(db.verify_pin("1234").unwrap());
        db.require_owner().unwrap();
        let pid = db.add_product("Pantalla Test", Some(1), "Xiaomi", "Red Note 11", "", "[]",
                                 8.0, 15.0, 3, 0, 0.0).unwrap();
        assert!(pid > 0);
        db.update_product(pid, "Pantalla Test 2", Some(1), "Xiaomi", "Red Note 11", "", "[]",
                          8.0, 16.0, 3, 0, 0.0).unwrap();
        assert_eq!(db.get_products("", None).unwrap()[0].price_sale, 16.0);

        // --- un PIN incorrecto la apaga, y `lock_owner` (botón «Bloquear sesión») también ---
        assert!(!db.verify_pin("0000").unwrap());
        assert!(db.require_owner().is_err());
        assert!(db.verify_pin("1234").unwrap());
        db.lock_owner();
        let err = db.require_owner().unwrap_err();
        assert!(err.contains("Solo el dueño puede"), "tras bloquear la sesión: {err}");

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// (b) El trabajo de MOSTRADOR sigue funcionando SIN sesión de dueño: turno, venta, orden
    /// de servicio, abono y devolución. Si esto se rompe, la cajera no puede cobrar.
    #[test]
    fn test_b3_la_cajera_cobra_sin_sesion_de_dueno() {
        let (db, path) = temp_db("test_b3_cmd_cajera.db");
        db.set_pin("1234").unwrap();
        assert!(!db.owner_can_edit(), "la cajera NO tiene sesión de dueño");

        // abrir el día es de la cajera (es quien abre el turno con la tasa BCV)
        assert!(db.open_day(10.0, 40.5, 45.0).unwrap() > 0);
        // venta de mostrador
        db.add_sale(None, "Forro", 1, 3.0, 3.0, "Divisas (USD Cash)", "Cliente", None, "", 0.0,
                    "", "USD", 0.0).unwrap();
        // orden de servicio
        let sid = db.add_service("DEV-B3", "Cliente", "0412-0000000", "Samsung A32", "No enciende",
                                 "Cambio batería", "[\"Cambio batería\"]", 25.0, "Divisas (USD Cash)",
                                 "", 0.0, "", "USD", "V-1", "", "{}", None, "", None, "", None, 0.0).unwrap();
        assert!(sid > 0);
        db.mark_service_printed(sid).unwrap();
        // abono y devolución (el camino trazable para devolver plata)
        db.add_service_payment(sid, 10.0, "Divisas (USD Cash)", 0.0, "", "USD", "abono", "").unwrap();
        db.add_service_refund(sid, 5.0, "Divisas (USD Cash)", "", "USD", "Devolución: prueba").unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert!((svc.paid_amount - 5.0).abs() < 0.01, "abono 10 − devolución 5 = 5, quedó {}", svc.paid_amount);
        // clientes (se crean en el mostrador)
        assert!(db.add_or_find_client("Cliente", "0412-0000000", "V-1", "").unwrap() > 0);
        // y las lecturas del mostrador
        assert_eq!(db.get_sales("", None, "", "").unwrap().len(), 1);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// (c) La sesión de dueño VENCE (12 h por defecto): pasado el límite los comandos del dueño
    /// vuelven a pedir el PIN, el mensaje lo dice, y el mostrador sigue trabajando igual.
    #[test]
    fn test_b3_la_sesion_de_dueno_vence() {
        let (db, path) = temp_db("test_b3_cmd_vence.db");
        db.set_pin("1234").unwrap();
        assert!(db.verify_pin("1234").unwrap());
        let pid = db.add_product("Pantalla Test", Some(1), "Xiaomi", "Red Note 11", "", "[]",
                                 8.0, 15.0, 3, 0, 0.0).unwrap();

        // 1 minuto ANTES del límite: la sesión sigue valiendo (el dueño no re-tipea el PIN en
        // plena jornada)
        db.owner_session_backdate(crate::db::OWNER_SESSION_HOURS * 3600 - 60);
        assert!(db.require_owner().is_ok());
        db.update_product(pid, "Pantalla Test", Some(1), "Xiaomi", "Red Note 11", "", "[]",
                          8.0, 15.0, 2, 0, 0.0).unwrap();

        // pasado el límite: el comando del dueño vuelve a pedir el PIN
        db.owner_session_backdate(crate::db::OWNER_SESSION_HOURS * 3600 + 60);
        let err = db.require_owner().unwrap_err();
        assert!(err.contains("venció"), "el mensaje avisa del vencimiento: {err}");
        // la cajera sigue trabajando igual (su trabajo no depende de la sesión de dueño)
        db.open_day(10.0, 40.5, 45.0).unwrap();
        db.add_sale(None, "Forro", 1, 3.0, 3.0, "Divisas (USD Cash)", "Cliente", None, "", 0.0,
                    "", "USD", 0.0).unwrap();
        // y el PIN correcto abre una sesión NUEVA
        assert!(db.verify_pin("1234").unwrap());
        db.require_owner().unwrap();
        db.delete_product(pid).unwrap();
        assert_eq!(db.get_products("", None).unwrap().len(), 0);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    /// Guardia anti-regresión del bloqueante B3: los comandos SENSIBLES que ya se clasificaron a mano
    /// tienen el gate, y los del mostrador NO lo tienen (para no trabar la venta ni la recepción).
    ///
    /// F69 (revisión adversarial, límite conocido y anotado): esto NO es un escaneo exhaustivo. Las
    /// dos listas son curadas a mano, así que un comando de escritura NUEVO que no se agregue acá pasa
    /// inadvertido (pasó con `set_product_in_use`, `set_phone_code`, `set_product_code` y
    /// `export_daily_report`, todos gateados en F69 justamente al leer estas listas). Derivar la lista
    /// de los `generate_handler!` de `lib.rs` y exigir que cada comando esté clasificado es trabajo
    /// pendiente (anotado para F71).
    #[test]
    fn test_b3_los_comandos_clasificados_tienen_el_gate_que_corresponde() {
        let src = &include_str!("commands.rs")[..include_str!("commands.rs")
            .find("\n#[cfg(test)]").expect("marca del módulo de tests")];
        let cuerpo = |nombre: &str| -> &str {
            let marca = format!("pub fn {nombre}(");
            let i = src.find(&marca).unwrap_or_else(|| panic!("no existe el comando {nombre}"));
            let resto = &src[i..];
            let fin = resto[1..].find("#[tauri::command]").map(|j| j + 1).unwrap_or(resto.len());
            &resto[..fin]
        };

        // ESCRITURA del DUEÑO (catálogo, precios, inventario masivo, gastos y compras,
        // cierres de caja, PIN y configuración, padrón de modelos)
        for cmd in [
            "add_product", "update_product", "delete_product", "merge_products",
            "set_product_supplier", "add_inventory_movement", "import_price_list", "import_data",
            "normalize_catalog", "restore_prices", "apply_inventory_load",
            // F78: la carga masiva en CSV (crea productos, cambia precios y stock) y el export del
            // catálogo (trae los COSTOS, que la caja no ve) son del DUEÑO.
            "apply_inventory_csv", "export_inventory_csv",
            "add_expense", "delete_expense",
            "add_purchase_order", "delete_purchase_order",
            "add_technician", "update_technician", "delete_technician",
            "delete_service", "delete_service_payment",
            "close_day", "reopen_day", "update_daily_closing_settlement",
            "set_pin", "remove_pin", "set_printer_settings",
            "rename_phone", "add_phone", "merge_phones",
            "add_category", "rename_category", "delete_category",
            // F69: lecturas que son del DUEÑO (utilidad/márgenes, capital del inventario y el
            // volcado completo de la base). La caja cierra su día con `get_daily_totals`.
            "export_data", "get_profit_summary", "get_inventory_value",
            // F69: los gastos del negocio y el buscador de pagos de TODAS las sesiones también.
            "get_expenses", "search_payments", "get_payment_daily_detail",
            // F69: definir QUÉ SE OFRECE (el check «lo que uso») y los códigos del catálogo.
            "set_product_in_use", "set_phone_in_use", "set_phone_use_all",
            "set_phone_default_product", "set_product_code", "set_phone_code",
            // F69: los reportes del día (traen los arqueos) y las compras a proveedor (traen costos).
            "export_daily_report", "export_daily_report_xlsx",
            "get_purchase_orders", "get_purchase_order_items",
            // F69: las analíticas del Dashboard y los comandos de INSTALACIÓN (revertir la versión
            // volvería a una build sin roles).
            "get_dashboard_analytics", "rollback_update", "backup_before_update",
            // F69: quitar una categoría de trabajo del local la saca para todos.
            "remove_work_type_extra",
        ] {
            assert!(cuerpo(cmd).contains("require_owner()"),
                    "B3: al comando «{cmd}» le falta el gate de rol (db.require_owner()?)");
        }

        // MOSTRADOR: la cajera trabaja sin PIN — estos NO pueden pedir dueño
        for cmd in [
            "add_sale", "add_service", "add_service_order", "update_service", "mark_service_printed",
            "add_service_payment", "add_service_refund", "add_client", "add_or_find_client", "save_client",
            "open_day", "mark_purchase_order_received",
            "get_products", "get_services", "get_sales", "get_daily_totals",
            "print_receipt", "print_to_windows_printer",
            "get_pin_status", "verify_pin", "lock_owner",
            // F69: del MOSTRADOR a propósito — anotar un trabajo que no está en la lista es parte de
            // recibir un equipo (y `set_service_policy` anota la foto/el acuerdo de pago). NO definen
            // precios ni stock: si se agregaran al gate, la caja no podría recibir un equipo raro.
            "set_service_policy", "add_work_type_extra",
        ] {
            assert!(!cuerpo(cmd).contains("require_owner()"),
                    "B3: «{cmd}» lo usa la cajera y NO debe pedir el PIN del dueño");
        }
    }
}