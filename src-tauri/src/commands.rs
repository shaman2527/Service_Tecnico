use tauri::State;
use crate::db::Database;

#[tauri::command]
pub fn get_categories(db: State<Database>) -> Result<Vec<crate::db::Category>, String> {
    db.get_categories().map_err(|e| e.to_string())
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
    db.get_products(&search, category_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_low_stock_products(db: State<Database>) -> Result<Vec<crate::db::Product>, String> {
    db.get_low_stock_products().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_reorder_suggestions(db: State<Database>) -> Result<Vec<crate::db::Product>, String> {
    db.get_reorder_suggestions().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn suggest_products(db: State<Database>, query: String, limit: i64) -> Result<Vec<crate::db::Product>, String> {
    db.suggest_products(&query, limit).map_err(|e| e.to_string())
}

// --- Sales ---

#[tauri::command]
pub fn add_sale(db: State<Database>, product_id: Option<i64>, product_name: String, quantity: i64,
                unit_price: f64, total: f64, payment_method: String, client_name: String,
                client_id: Option<i64>, notes: String,
                bank_fee_percent: f64, zelle_reference: String, currency: String, discount_amount: f64) -> Result<(), String> {
    db.add_sale(product_id, &product_name, quantity, unit_price, total, &payment_method, &client_name, client_id, &notes, bank_fee_percent, &zelle_reference, &currency, discount_amount)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sales(db: State<Database>, search: String, days: Option<i64>, start_date: String, end_date: String) -> Result<Vec<crate::db::Sale>, String> {
    db.get_sales(&search, days, &start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sales_stats(db: State<Database>, days: i64) -> Result<Vec<crate::db::SaleStat>, String> {
    db.get_sales_stats(days).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn get_dashboard_analytics(db: State<Database>) -> Result<crate::db::DashboardAnalytics, String> {
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

#[tauri::command]
pub fn add_purchase_order(db: State<Database>, supplier: String, notes: String, items_json: String) -> Result<i64, String> {
    // Pedir al proveedor es una compra (plata del negocio): decisión del dueño.
    // Recibir la mercancía que llegó SÍ es de la cajera (`mark_purchase_order_received`).
    db.require_owner()?;
    db.add_purchase_order(&supplier, &notes, &items_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_purchase_orders(db: State<Database>) -> Result<Vec<crate::db::PurchaseOrder>, String> {
    db.get_purchase_orders().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_purchase_order_items(db: State<Database>, order_id: i64) -> Result<Vec<crate::db::PurchaseOrderItem>, String> {
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

#[tauri::command]
pub fn export_data(db: State<Database>) -> Result<String, String> {
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

#[tauri::command]
pub fn add_expense(db: State<Database>, expense_date: String, category: String, amount: f64, currency: String, notes: String) -> Result<i64, String> {
    db.require_owner()?;
    db.add_expense(&expense_date, &category, amount, &currency, &notes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_expenses(db: State<Database>, start_date: String, end_date: String) -> Result<Vec<crate::db::Expense>, String> {
    db.get_expenses(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_expense(db: State<Database>, id: i64) -> Result<(), String> {
    db.require_owner()?;
    db.delete_expense(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_profit_summary(db: State<Database>, start_date: String, end_date: String) -> Result<crate::db::ProfitSummary, String> {
    db.get_profit_summary(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_receivables(db: State<Database>) -> Result<crate::db::ReceivablesSummary, String> {
    db.get_receivables().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_inventory_value(db: State<Database>) -> Result<crate::db::InventoryValue, String> {
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

// --- Updates (respaldo / rollback / salud — módulo updates.rs) ---

#[tauri::command]
pub fn backup_before_update(db: State<Database>, new_version: String, previous_version: String) -> Result<(), String> {
    // Checkpoint WAL para que la copia de la DB quede consistente antes de copiarla
    {
        let conn = db.conn.lock().unwrap();
        conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .map_err(|e| e.to_string())?;
    }
    let dir = crate::updates::install_dir();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    crate::updates::backup_before_update(&dir, &exe, &crate::get_db_path(), &previous_version, &new_version)?;
    crate::updates::spawn_watchdog(&dir);
    Ok(())
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
pub fn rollback_update() -> Result<(), String> {
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

#[tauri::command]
pub fn export_daily_report(db: State<Database>, start_date: String, end_date: String) -> Result<String, String> {
    db.export_daily_report(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_daily_report_xlsx(db: State<Database>, start_date: String, end_date: String) -> Result<String, String> {
    db.export_daily_report_xlsx(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_payments(db: State<Database>, start_date: Option<String>, end_date: Option<String>,
                       method: Option<String>, client: Option<String>,
                       reference: Option<String>, currency: Option<String>) -> Result<Vec<crate::db::PaymentSearchResult>, String> {
    db.search_payments(start_date.as_deref(), end_date.as_deref(), method.as_deref(), client.as_deref(), reference.as_deref(), currency.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_payment_daily_detail(db: State<Database>, date: String, method: Option<String>) -> Result<Vec<crate::db::PaymentSearchResult>, String> {
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
                         brand: Option<String>, stock_filter: Option<String>, sort: Option<String>,
                         limit: i64, offset: i64) -> Result<crate::db::ProductPage, String> {
    db.get_products_page(&search, category_id, brand.as_deref(), stock_filter.as_deref(), sort.as_deref(), limit, offset)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_inventory_stats(db: State<Database>) -> Result<crate::db::InventoryStats, String> {
    db.get_inventory_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_phone_models(db: State<Database>, search: String, limit: i64)
    -> Result<Vec<crate::db::PhoneModelRow>, String> {
    db.get_phone_models(&search, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn find_compatible_screens(db: State<Database>, model: String, limit: i64)
    -> Result<Vec<crate::db::ScreenCandidate>, String> {
    db.find_compatible_screens(&model, limit).map_err(|e| e.to_string())
}

/// Repuestos compatibles con un modelo (cualquier categoría si `category_id` es None).
#[tauri::command]
pub fn find_compatible_products(db: State<Database>, model: String, category_id: Option<i64>, limit: i64)
    -> Result<Vec<crate::db::ScreenCandidate>, String> {
    db.find_compatible_products(&model, category_id, limit).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn get_phone_detail(db: State<Database>, phone_id: i64) -> Result<Option<crate::phones::PhoneDetail>, String> {
    db.get_phone_detail(phone_id).map_err(|e| e.to_string())
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

    /// Guardia anti-regresión del bloqueante B3: TODO comando de ESCRITURA que no es de la
    /// cajera tiene el gate, y los de mostrador NO lo tienen (para no trabar la venta).
    /// Lee este mismo archivo: si alguien agrega un comando de escritura y se olvida el
    /// gate, el test falla con el nombre del comando.
    #[test]
    fn test_b3_todos_los_comandos_de_escritura_tienen_el_gate() {
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
            "add_expense", "delete_expense",
            "add_purchase_order", "delete_purchase_order",
            "add_technician", "update_technician", "delete_technician",
            "delete_service", "delete_service_payment",
            "close_day", "reopen_day", "update_daily_closing_settlement",
            "set_pin", "remove_pin", "set_printer_settings",
            "rename_phone", "add_phone", "merge_phones",
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
            "export_data", "export_daily_report", "export_daily_report_xlsx",
            "print_receipt", "print_to_windows_printer",
            "get_pin_status", "verify_pin", "lock_owner",
        ] {
            assert!(!cuerpo(cmd).contains("require_owner()"),
                    "B3: «{cmd}» lo usa la cajera y NO debe pedir el PIN del dueño");
        }
    }
}