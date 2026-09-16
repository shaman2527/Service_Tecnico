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
                   stock: i64, min_stock: i64, price_usd: f64) -> Result<i64, String> {
    db.add_product(&name, category_id, &brand, &model, &variant, &compatibility, price_cost, price_sale, stock, min_stock, price_usd)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_product(db: State<Database>, id: i64, name: String, category_id: Option<i64>, brand: String, model: String,
                      variant: String, compatibility: String, price_cost: f64, price_sale: f64,
                      stock: i64, min_stock: i64, price_usd: f64) -> Result<(), String> {
    db.update_product(id, &name, category_id, &brand, &model, &variant, &compatibility, price_cost, price_sale, stock, min_stock, price_usd)
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
pub fn add_service_refund(db: State<Database>, service_id: i64, amount: f64, payment_method: String,
                          zelle_reference: String, currency: String,
                          notes: String) -> Result<i64, String> {
    db.add_service_refund(service_id, amount, &payment_method, &zelle_reference, &currency, &notes)
        .map_err(|e| e.to_string())
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
pub fn get_day_summary(db: State<Database>, date: String) -> Result<crate::db::DaySummary, String> {
    db.get_day_summary(&date).map_err(|e| e.to_string())
}

// --- Salud del negocio (gastos, utilidad, por cobrar, inventario) ---

#[tauri::command]
pub fn add_expense(db: State<Database>, expense_date: String, category: String, amount: f64, currency: String, notes: String) -> Result<i64, String> {
    db.add_expense(&expense_date, &category, amount, &currency, &notes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_expenses(db: State<Database>, start_date: String, end_date: String) -> Result<Vec<crate::db::Expense>, String> {
    db.get_expenses(&start_date, &end_date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_expense(db: State<Database>, id: i64) -> Result<(), String> {
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

// --- Catálogo: limpieza (marcas, modelos, nombres, compatibilidad) ---

#[tauri::command]
pub fn normalize_catalog(db: State<Database>, dry_run: bool) -> Result<crate::catalog::CatalogReport, String> {
    db.normalize_catalog(dry_run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_prices(db: State<Database>, path: Option<String>, only_zero: bool, dry_run: bool)
    -> Result<crate::catalog::PriceRestoreReport, String> {
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
    let conn = db.conn.lock().unwrap();
    crate::phones::get_phone_brands(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_phones(db: State<Database>, brand: Option<String>, search: String,
                  only_with_products: bool, only_stock: bool, only_review: bool,
                  sort: String, dir: String,
                  limit: i64, offset: i64) -> Result<crate::phones::PhonePage, String> {
    let conn = db.conn.lock().unwrap();
    crate::phones::get_phones(&conn, brand.as_deref(), &search, only_with_products, only_stock,
                              only_review, &sort, &dir, limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_phone_detail(db: State<Database>, phone_id: i64) -> Result<Option<crate::phones::PhoneDetail>, String> {
    let conn = db.conn.lock().unwrap();
    crate::phones::get_phone_detail(&conn, phone_id).map_err(|e| e.to_string())
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
    let conn = db.conn.lock().unwrap();
    crate::phones::preview_rename_phone(&conn, id, &brand, &line, &model).map_err(|e| e.to_string())
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

/// Aplica la vista previa: respaldo de la base + stock por producto + movimiento.
/// `keep_ids` = fichas que la vista previa ya tenía asignadas: el barrido no las toca.
#[tauri::command]
pub fn apply_inventory_load(db: State<Database>, rows: Vec<crate::loadlist::LoadRow>,
                            zero_missing: bool, keep_ids: Vec<i64>)
    -> Result<crate::loadlist::LoadReport, String> {
    db.require_owner()?;
    let conn = db.conn.lock().unwrap();
    crate::loadlist::apply_load(&conn, &db.db_path, &rows, zero_missing, &keep_ids)
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