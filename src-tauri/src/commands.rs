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

// --- Products ---

#[tauri::command]
pub fn add_product(db: State<Database>, name: String, category_id: Option<i64>, brand: String, model: String,
                   variant: String, compatibility: String, price_cost: f64, price_sale: f64,
                   stock: i64, min_stock: i64) -> Result<i64, String> {
    db.add_product(&name, category_id, &brand, &model, &variant, &compatibility, price_cost, price_sale, stock, min_stock)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_product(db: State<Database>, id: i64, name: String, category_id: Option<i64>, brand: String, model: String,
                      variant: String, compatibility: String, price_cost: f64, price_sale: f64,
                      stock: i64, min_stock: i64) -> Result<(), String> {
    db.update_product(id, &name, category_id, &brand, &model, &variant, &compatibility, price_cost, price_sale, stock, min_stock)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_product(db: State<Database>, id: i64) -> Result<(), String> {
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
                bank_fee_percent: f64, zelle_reference: String, currency: String) -> Result<(), String> {
    db.add_sale(product_id, &product_name, quantity, unit_price, total, &payment_method, &client_name, client_id, &notes, bank_fee_percent, &zelle_reference, &currency)
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
                   client_id: Option<i64>, technician: String, technician_id: Option<i64>) -> Result<i64, String> {
    db.add_service(&order_num, &client, &phone, &model, &fault, &service_type, &service_types, amount, &payment_method, &observations, bank_fee_percent, &zelle_reference, &currency, &client_ci, &client_address, &device_checklist, client_id, &technician, technician_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_service(db: State<Database>, id: i64, client: String, phone: String, model: String, fault: String,
                      service_type: String, service_types: String, amount: f64, payment_method: String, date_out: String, status: String, observations: String,
                      bank_fee_percent: f64, zelle_reference: String, currency: String,
                      client_ci: String, client_address: String, device_checklist: String,
                      technician: String, technician_id: Option<i64>) -> Result<(), String> {
    db.update_service(id, &client, &phone, &model, &fault, &service_type, &service_types, amount, &payment_method, &date_out, &status, &observations, bank_fee_percent, &zelle_reference, &currency, &client_ci, &client_address, &device_checklist, &technician, technician_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service(db: State<Database>, id: i64) -> Result<(), String> {
    db.delete_service(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_services(db: State<Database>, search: String, status: String, start_date: String, end_date: String) -> Result<Vec<crate::db::Service>, String> {
    db.get_services(&search, &status, &start_date, &end_date).map_err(|e| e.to_string())
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
    db.add_technician(&name, &initials, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_technician(db: State<Database>, id: i64, name: String, initials: String, color: String) -> Result<(), String> {
    db.update_technician(id, &name, &initials, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_technician(db: State<Database>, id: i64) -> Result<(), String> {
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
                           notes: String) -> Result<i64, String> {
    db.add_service_payment(service_id, amount, &payment_method, bank_fee_percent, &zelle_reference, &currency, &notes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service_payment(db: State<Database>, id: i64) -> Result<(), String> {
    db.delete_service_payment(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_purchase_order(db: State<Database>, supplier: String, notes: String, items_json: String) -> Result<i64, String> {
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
    db.add_inventory_movement(product_id, &type_, quantity, &reason, &reference).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_inventory_movements(db: State<Database>, days: Option<i64>) -> Result<Vec<crate::db::InventoryMovement>, String> {
    db.get_inventory_movements(days).map_err(|e| e.to_string())
}

// --- Import/Export ---

#[tauri::command]
pub fn import_price_list(db: State<Database>, items_json: String) -> Result<i64, String> {
    db.import_price_list(&items_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_data(db: State<Database>) -> Result<String, String> {
    db.export_data().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_data(db: State<Database>, json_data: String, merge: bool) -> Result<String, String> {
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
pub fn get_daily_closings(db: State<Database>) -> Result<Vec<crate::db::DailyClosing>, String> {
    db.get_daily_closings().map_err(|e| e.to_string())
}

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
    db.close_day(&close_date, &notes, initial_cash_usd, tasa_bcv, tasa_eur,
                 actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs,
                 actual_zelle, actual_pago_movil, actual_transfer_bs, pos_settled, pos_settled_bs)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reopen_day(db: State<Database>, close_date: String) -> Result<(), String> {
    db.reopen_day(&close_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_daily_closing_settlement(db: State<Database>, id: i64, pos_settled: f64, pos_settled_bs: f64) -> Result<(), String> {
    db.update_daily_closing_settlement(id, pos_settled, pos_settled_bs).map_err(|e| e.to_string())
}

// --- Settings / PIN ---

#[tauri::command]
pub fn set_pin(db: State<Database>, pin: String) -> Result<(), String> {
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
    db.remove_pin(&pin).map_err(|e| e.to_string())
}

// --- Impresora térmica (tickets / facturas de servicio) ---

#[tauri::command]
pub fn list_com_ports() -> Result<Vec<crate::printer::ComPortInfo>, String> {
    crate::printer::list_com_ports()
}

#[tauri::command]
pub fn print_receipt(port: String, baud: u32, text: String) -> Result<(), String> {
    crate::printer::print_receipt(&port, baud, &text)
}

#[tauri::command]
pub fn get_printer_settings(db: State<Database>) -> Result<crate::db::PrinterSettings, String> {
    db.get_printer_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_printer_settings(db: State<Database>, port: String, baud: u32, width: u32) -> Result<(), String> {
    db.set_printer_settings(&port, baud, width).map_err(|e| e.to_string())
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
