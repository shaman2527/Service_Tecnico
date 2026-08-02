pub mod bcv;
pub mod db;
mod commands;

use std::path::PathBuf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = get_db_path();

    let database = db::Database::new(&db_path).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(database)
        .invoke_handler(tauri::generate_handler![
            commands::get_categories,
            commands::get_payment_methods,
            commands::get_service_statuses,
            commands::next_order_num,
            commands::add_product,
            commands::update_product,
            commands::delete_product,
            commands::get_products,
            commands::get_low_stock_products,
            commands::get_reorder_suggestions,
            commands::suggest_products,
            commands::add_sale,
            commands::get_sales,
            commands::get_sales_stats,
            commands::add_service,
            commands::update_service,
            commands::delete_service,
            commands::get_services,
            commands::get_service,
            commands::get_service_dashboard,
            commands::get_dashboard_analytics,
            commands::get_service_payments,
            commands::add_service_payment,
            commands::delete_service_payment,
            commands::add_purchase_order,
            commands::get_purchase_orders,
            commands::get_purchase_order_items,
            commands::mark_purchase_order_received,
            commands::delete_purchase_order,
            commands::get_clients,
            commands::add_client,
            commands::add_or_find_client,
            commands::find_client,
            commands::find_client_by_ci,
            commands::get_client_services,
            commands::get_client_sales,
            commands::suggest_clients,
            commands::add_inventory_movement,
            commands::get_inventory_movements,
            commands::import_price_list,
            commands::export_data,
            commands::import_data,
            commands::get_daily_totals,
            commands::get_daily_closings,
            commands::get_bcv_rate,
            commands::open_day,
            commands::get_active_day,
            commands::close_day,
            commands::reopen_day,
            commands::update_daily_closing_settlement,
            commands::set_pin,
            commands::get_pin_status,
            commands::verify_pin,
            commands::remove_pin,
            commands::get_pago_movil_detail,
            commands::export_daily_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn get_db_path() -> PathBuf {
    // 1. Check next to executable
    let mut path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    path.pop();
    path.push("registro.db");
    if path.exists() {
        return path;
    }

    // 2. Check project root (for development)
    path.pop();
    path.pop();
    path.push("registro.db");
    if path.exists() {
        return path;
    }

    // 3. Fallback to app data directory
    if let Some(data_dir) = dirs_next() {
        std::fs::create_dir_all(&data_dir).ok();
        let mut p = data_dir;
        p.push("registro.db");
        if !p.exists() {
            // Create empty DB by copying from exe dir if exists
            let mut src = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
            src.pop();
            src.push("registro.db");
            if src.exists() {
                std::fs::copy(&src, &p).ok();
            }
        }
        return p;
    }

    path
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_DATA_HOME").ok().map(PathBuf::from)
            .or_else(|| {
                let home = std::env::var("HOME").ok()?;
                Some(PathBuf::from(home).join(".local/share"))
            })
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join("Library/Application Support"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { None }
}
// force rebuild
// force rebuild 2
// force rebuild 3
// force rebuild 4
// force rebuild 5
// force rebuild 6
// force rebuild 7
// force rebuild 8
// force rebuild 9
// force rebuild 10
// force rebuild 2026-08-02: moneda por método en ventas+abonos
// force rebuild 2026-08-02: centro de ayuda completo
// force rebuild 2026-08-02: perf+UX audit fixes
// force rebuild 2026-08-02: Libro Diario rediseño (moneda por método, desglose, tasa)
// force rebuild 2026-08-02: ServiceForm fixes (monto/ci/saldo/moneda)
// force rebuild 2026-08-02: ServiceForm fixes (monto/ci/saldo/moneda)
// force rebuild 2026-08-02: cards verdes entregados + garantia 7 dias
// force rebuild 2026-08-02: chips tipo trabajo + card amarilla por entregar
// force rebuild 2026-08-02: rediseno Total General (split card)
