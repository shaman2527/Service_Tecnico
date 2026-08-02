use rusqlite::{Connection, OptionalExtension, params, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
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
}

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
}

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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SaleStat {
    pub product_name: Option<String>,
    pub product_id: Option<i64>,
    pub qty: i64,
    pub total: f64,
    pub count: i64,
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
pub struct DailyTotals {
    pub date: String,
    pub pos_charged: f64,
    pub pos_fees: f64,
    pub pos_net: f64,
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyClosing {
    pub id: i64,
    pub close_date: String,
    pub pos_charged: f64,
    pub pos_fees: f64,
    pub pos_net: f64,
    pub pos_settled: f64,
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
}

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &PathBuf) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
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
                observations TEXT
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
        ")?;

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
        // Migration: add client data + device checklist to services
        let has_client_ci: bool = conn.prepare("SELECT client_ci FROM services LIMIT 1").is_ok();
        if !has_client_ci {
            let _ = conn.execute_batch("
                ALTER TABLE services ADD COLUMN client_ci TEXT;
                ALTER TABLE services ADD COLUMN client_address TEXT;
                ALTER TABLE services ADD COLUMN device_checklist TEXT;
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
        // Migration: pagos con método Bs registrados como USD (bug moneda del frontend).
        // La moneda SIEMPRE se deriva del método: Efectivo Bs/Pago Móvil/Transf Bs/Punto (Bs) → VES.
        if conn.prepare("SELECT id FROM service_payments LIMIT 1").is_ok() {
            for m in BS_METHODS {
                let _ = conn.execute(
                    "UPDATE service_payments SET currency='VES' WHERE payment_method=?1 AND (currency IS NULL OR currency='USD')",
                    params![m],
                );
            }
            // Recalcular paid_amount de TODOS los servicios con conversión Bs→USD (idempotente)
            let _ = conn.execute(
                "UPDATE services SET paid_amount = (
                    SELECT COALESCE(SUM(CASE
                        WHEN sp.currency IS NULL OR sp.currency = 'USD' THEN sp.amount
                        ELSE sp.amount / COALESCE((
                            SELECT dc.tasa_bcv FROM daily_closings dc
                            WHERE dc.close_date = date(sp.payment_date) AND dc.tasa_bcv > 0
                            ORDER BY dc.id DESC LIMIT 1
                        ), (
                            SELECT dc2.tasa_bcv FROM daily_closings dc2
                            WHERE dc2.is_closed = 0 AND dc2.tasa_bcv > 0 LIMIT 1
                        ), 1)
                    END), 0)
                    FROM service_payments sp WHERE sp.service_id = services.id
                )",
                [],
            )?;
        }
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
        ")?;
        // PRAGMAs de robustez/rendimiento (idempotentes)
        conn.execute_batch("PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;")?;
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        Ok(())
    }

    pub fn next_order_num(&self) -> SqlResult<String> {
        let conn = self.conn.lock().unwrap();
        // Monótono: MAX del número existente (borrar servicios no reutiliza números)
        let max: Option<i64> = conn.query_row(
            "SELECT MAX(CAST(SUBSTR(order_num,5) AS INTEGER)) FROM services WHERE order_num LIKE 'ORD-%'",
            [], |r| r.get(0),
        ).optional()?;
        Ok(format!("ORD-{}", max.unwrap_or(999) + 1))
    }

    // --- Products ---
    pub fn add_product(&self, name: &str, category_id: Option<i64>, brand: &str, model: &str,
                       variant: &str, compatibility: &str, price_cost: f64, price_sale: f64,
                       stock: i64, min_stock: i64) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO products (name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_product(&self, id: i64, name: &str, category_id: Option<i64>, brand: &str, model: &str,
                          variant: &str, compatibility: &str, price_cost: f64, price_sale: f64,
                          stock: i64, min_stock: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE products SET name=?1, category_id=?2, brand=?3, model=?4, variant=?5, compatibility=?6, price_cost=?7, price_sale=?8, stock=?9, min_stock=?10, updated_at=datetime('now','localtime') WHERE id=?11",
            params![name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock, id],
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
        let mut sql = String::from(
            "SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1"
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if !search.is_empty() {
            sql.push_str(" AND (p.name LIKE ?1 OR p.brand LIKE ?1 OR p.model LIKE ?1 OR p.compatibility LIKE ?1)");
            param_values.push(Box::new(format!("%{}%", search)));
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
                category_name: r.get(13)?,
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
        let mut stmt = conn.prepare(
            "SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.stock <= p.min_stock ORDER BY p.stock ASC"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Product {
                id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?,
                brand: r.get(3)?, model: r.get(4)?, variant: r.get(5)?,
                compatibility: r.get(6)?, price_cost: r.get(7)?, price_sale: r.get(8)?,
                stock: r.get(9)?, min_stock: r.get(10)?, created_at: r.get(11)?,
                updated_at: r.get(12)?, category_name: r.get(13)?,
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
        let mut stmt = conn.prepare(
            "SELECT p.*, c.name as category_name FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.stock < 0
                OR (p.min_stock > 0 AND p.stock <= p.min_stock)
                OR EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id AND m.type = 'salida' AND p.stock <= 0)
             ORDER BY p.stock ASC"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Product {
                id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?,
                brand: r.get(3)?, model: r.get(4)?, variant: r.get(5)?,
                compatibility: r.get(6)?, price_cost: r.get(7)?, price_sale: r.get(8)?,
                stock: r.get(9)?, min_stock: r.get(10)?, created_at: r.get(11)?,
                updated_at: r.get(12)?, category_name: r.get(13)?,
            })
        })?;
        let mut products = Vec::new();
        for row in rows { products.push(row?); }
        Ok(products)
    }

    // --- Sales ---
    pub fn add_sale(&self, product_id: Option<i64>, product_name: &str, quantity: i64, unit_price: f64,
                    total: f64, payment_method: &str, client_name: &str, client_id: Option<i64>, notes: &str,
                    bank_fee_percent: f64, zelle_reference: &str, currency: &str) -> SqlResult<()> {
        if quantity <= 0 || unit_price < 0.0 || total < 0.0 {
            return Err(day_shift_error("Cantidad y montos deben ser positivos."));
        }
        let bank_fee_amount = if bank_fee_percent > 0.0 { total * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = total - bank_fee_amount;
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO sales (product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![product_id, product_name, quantity, unit_price, total, payment_method, client_name, client_id, notes, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency],
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
        tx.commit()?;
        Ok(())
    }

    pub fn get_sales(&self, search: &str, days: Option<i64>, start_date: &str, end_date: &str) -> SqlResult<Vec<Sale>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from("SELECT s.id, s.date, s.product_id, s.product_name, s.quantity, s.unit_price, s.total, s.payment_method, s.client_name, s.notes, s.client_id, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency FROM sales s WHERE 1=1");
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if !search.is_empty() {
            sql.push_str(" AND (s.product_name LIKE ?1 OR s.client_name LIKE ?1)");
            param_values.push(Box::new(format!("%{}%", search)));
        }
        if let Some(d) = days {
            let _ = param_values.len();
            sql.push_str(&format!(" AND date(s.date) >= date('now', '-{} days')", d));
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
             FROM sales s WHERE date(s.date) >= date('now', ?1)
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
                       fault: &str, service_type: &str, amount: f64, payment_method: &str, observations: &str,
                       bank_fee_percent: f64, zelle_reference: &str, currency: &str,
                       client_ci: &str, client_address: &str, device_checklist: &str,
                       client_id: Option<i64>) -> SqlResult<i64> {
        let bank_fee_amount = if bank_fee_percent > 0.0 { amount * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = amount - bank_fee_amount;
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        conn.execute(
            "INSERT INTO services (order_num, client, phone, model, fault, service_type, amount, payment_method, observations, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, client_ci, client_address, device_checklist, client_id, paid_amount) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,0)",
            params![order_num, client, phone, model, fault, service_type, amount, payment_method, observations, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, if client_ci.is_empty() { None } else { Some(client_ci) }, if client_address.is_empty() { None } else { Some(client_address) }, if device_checklist.is_empty() { None } else { Some(device_checklist) }, client_id],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_service(&self, id: i64, client: &str, phone: &str, model: &str, fault: &str,
                          service_type: &str, amount: f64, payment_method: &str, date_out: &str, status: &str, observations: &str,
                          bank_fee_percent: f64, zelle_reference: &str, currency: &str,
                          client_ci: &str, client_address: &str, device_checklist: &str) -> SqlResult<()> {
        let bank_fee_amount = if bank_fee_percent > 0.0 { amount * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = amount - bank_fee_amount;
        let conn = self.conn.lock().unwrap();

        // Auto-inventory: if status changes to Entregado → deduct screen stock; if leaves Entregado → return stock
        let prev_status: Option<String> = conn
            .query_row("SELECT status FROM services WHERE id=?1", params![id], |r| r.get(0))
            .optional()?;
        if let Some(prev) = prev_status.as_deref() {
            if prev != status {
                if status == "Entregado" {
                    self.apply_service_stock(&conn, model, -1)?;
                } else if prev == "Entregado" {
                    self.apply_service_stock(&conn, model, 1)?;
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
            "UPDATE services SET client=?1, phone=?2, model=?3, fault=?4, service_type=?16, amount=?5, payment_method=?6, date_out=?7, status=?8, observations=?9, bank_fee_percent=?11, bank_fee_amount=?12, net_amount=?13, zelle_reference=?14, currency=?15, client_ci=?17, client_address=?18, device_checklist=?19 WHERE id=?10",
            params![client, phone, model, fault, amount, payment_method, if effective_date_out.is_empty() { None } else { Some(effective_date_out.as_str()) }, status, observations, id, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, service_type, if client_ci.is_empty() { None } else { Some(client_ci) }, if client_address.is_empty() { None } else { Some(client_address) }, if device_checklist.is_empty() { None } else { Some(device_checklist) }],
        )?;
        Ok(())
    }

    // Busca un producto de pantalla cuyo compatibility/model/name coincida con el modelo del servicio.
    // Si no existe, lo crea automáticamente (categoría Pantalla) y ajusta el stock en delta.
    fn apply_service_stock(&self, conn: &rusqlite::Connection, model: &str, delta: i64) -> SqlResult<i64> {
        if model.trim().is_empty() {
            return Ok(0);
        }
        let target = norm_model(model);
        let mut product_id: Option<i64> = None;

        // 1) Match exacto contra compatibility JSON (modelos individuales) o nombre del producto
        let mut stmt = conn.prepare(
            "SELECT id, name, compatibility FROM products WHERE category_id=1 AND compatibility IS NOT NULL AND compatibility != ''",
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

        // 2) Fallback: búsqueda LIKE en model/name
        if product_id.is_none() {
            let like = format!("%{}%", model.trim());
            product_id = conn
                .query_row(
                    "SELECT id FROM products WHERE category_id=1 AND (model LIKE ?1 OR name LIKE ?1) LIMIT 1",
                    params![like],
                    |r| r.get(0),
                )
                .optional()?;
        }

        let pid = match product_id {
            Some(pid) => pid,
            None => {
                // Crear producto automáticamente
                let name = format!("Pantalla {}", model.trim());
                let comp = serde_json::json!([model.trim()]).to_string();
                conn.execute(
                    "INSERT INTO products (name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock) VALUES (?1,1,'','', '', ?2, 0.0, 0.0, 0, 0)",
                    params![name, comp],
                )?;
                conn.last_insert_rowid()
            }
        };

        conn.execute("UPDATE products SET stock = stock + ?1 WHERE id=?2", params![delta, pid])?;
        let mov_type = if delta < 0 { "salida" } else { "entrada" };
        let reason = if delta < 0 { "Servicio Entregado" } else { "Servicio Reabierto" };
        conn.execute(
            "INSERT INTO inventory_movements (product_id, type, quantity, reason, reference) VALUES (?1, ?2, ?3, ?4, 'Servicio')",
            params![pid, mov_type, delta.abs(), reason],
        )?;
        Ok(pid)
    }

    pub fn delete_service(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        // Si el servicio estaba entregado, devolver el stock antes de borrar
        let svc: Option<(String, String)> = conn
            .query_row("SELECT model, status FROM services WHERE id=?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        if let Some((model, status)) = svc {
            if status == "Entregado" {
                self.apply_service_stock(&conn, &model, 1)?;
            }
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

    pub fn add_service_payment(&self, service_id: i64, amount: f64, payment_method: &str,
                               bank_fee_percent: f64, zelle_reference: &str, currency: &str,
                               notes: &str) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        self.require_open_day(&conn)?;
        // La moneda se deriva del método (un pago por Pago Móvil/Efectivo Bs/Transf Bs SIEMPRE es Bs)
        let currency = normalize_payment_currency(payment_method, currency);
        let bank_fee_amount = if bank_fee_percent > 0.0 { amount * bank_fee_percent / 100.0 } else { 0.0 };
        let net_amount = amount - bank_fee_amount;
        conn.execute(
            "INSERT INTO service_payments (service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, zelle_reference, currency, notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![service_id, amount, payment_method, bank_fee_percent, bank_fee_amount, net_amount, if zelle_reference.is_empty() { None } else { Some(zelle_reference) }, currency, if notes.is_empty() { None } else { Some(notes) }],
        )?;
        let pid = conn.last_insert_rowid();
        self.recalc_paid_amount(&conn, service_id)?;
        Ok(pid)
    }

    pub fn delete_service_payment(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let service_id: i64 = conn.query_row("SELECT service_id FROM service_payments WHERE id=?1", params![id], |r| r.get(0))?;
        conn.execute("DELETE FROM service_payments WHERE id=?", params![id])?;
        self.recalc_paid_amount(&conn, service_id)?;
        Ok(())
    }

    // Recalcula paid_amount del servicio en USD equivalente:
    // pagos en Bs se convierten con la tasa BCV del día del pago (cierre del día)
    // o la tasa del día abierto actual; pagos USD se suman directo.
    fn recalc_paid_amount(&self, conn: &rusqlite::Connection, service_id: i64) -> SqlResult<()> {
        conn.execute(
            "UPDATE services SET paid_amount = (
                SELECT COALESCE(SUM(CASE
                    WHEN sp.currency IS NULL OR sp.currency = 'USD' THEN sp.amount
                    ELSE sp.amount / COALESCE((
                        SELECT dc.tasa_bcv FROM daily_closings dc
                        WHERE dc.close_date = date(sp.payment_date) AND dc.tasa_bcv > 0
                        ORDER BY dc.id DESC LIMIT 1
                    ), (
                        SELECT dc2.tasa_bcv FROM daily_closings dc2
                        WHERE dc2.is_closed = 0 AND dc2.tasa_bcv > 0 LIMIT 1
                    ), 1)
                END), 0)
                FROM service_payments sp WHERE sp.service_id = services.id
            ) WHERE id = ?1",
            params![service_id],
        )?;
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

    pub fn get_services(&self, search: &str, status: &str) -> SqlResult<Vec<Service>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from("SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.client_id, s.paid_amount FROM services s WHERE 1=1");
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if !search.is_empty() {
            sql.push_str(" AND (s.client LIKE ?1 OR s.model LIKE ?1 OR s.order_num LIKE ?1 OR s.phone LIKE ?1 OR s.client_ci LIKE ?1)");
            params_vec.push(Box::new(format!("%{}%", search)));
        }
        if !status.is_empty() {
            let idx = params_vec.len() + 1;
            sql.push_str(&format!(" AND s.status=?{}", idx));
            params_vec.push(Box::new(status.to_string()));
        }
        sql.push_str(" ORDER BY s.id DESC");

        let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |r| {
            Ok(Service {
                id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
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
                client_id: r.get(21).unwrap_or(None),
                paid_amount: r.get(22).unwrap_or(0.0),
            })
        })?;
        let mut services = Vec::new();
        for row in rows { services.push(row?); }
        Ok(services)
    }

    pub fn get_service_by_id(&self, id: i64) -> SqlResult<Option<Service>> {
        let conn = self.conn.lock().unwrap();
        let row = conn.query_row(
            "SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.client_id, s.paid_amount FROM services s WHERE s.id=?1",
            params![id],
            |r| Ok(Service {
                id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
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
                client_id: r.get(21).unwrap_or(None),
                paid_amount: r.get(22).unwrap_or(0.0),
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

        let (today_usd, today_bs) = sum_sales("date(date) = date('now','localtime')")?;
        let (week_usd, week_bs) = sum_sales("date(date) >= date('now','-6 days')")?;
        let week_units: i64 = conn.query_row(
            "SELECT COALESCE(SUM(quantity),0) FROM sales WHERE date(date) >= date('now','-6 days')", [], |r| r.get(0),
        )?;
        let week_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sales WHERE date(date) >= date('now','-6 days')", [], |r| r.get(0),
        )?;

        let mut stmt = conn.prepare(
            "SELECT COALESCE(c.name, 'Sin categoría'),
                    COALESCE(SUM(s.quantity),0),
                    COALESCE(SUM(CASE WHEN COALESCE(s.currency,'USD') = 'USD' THEN s.total ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN COALESCE(s.currency,'USD') != 'USD' THEN s.total ELSE 0 END),0)
             FROM sales s
             LEFT JOIN products p ON s.product_id = p.id
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE date(s.date) >= date('now','-6 days')
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
             WHERE date(s.date) >= date('now','-6 days')
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

        Ok(DashboardAnalytics {
            today_usd, today_bs, week_usd, week_bs, week_units, week_count,
            category_stats, top_models, product_count, sale_count, service_count,
            client_count, last_sale, last_service, last_movement, last_activity,
        })
    }

    // --- Clients ---
    pub fn get_clients(&self, search: &str) -> SqlResult<Vec<ClientSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT c.id, c.name, c.phone,
                    COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.client_id = c.id), 0) +
                    COALESCE((SELECT SUM(sv.amount) FROM services sv WHERE sv.client = c.name AND sv.status = 'Entregado'), 0) as total_spent,
                    (SELECT COUNT(*) FROM services sv WHERE sv.client = c.name) as service_count,
                    (SELECT COUNT(*) FROM sales s WHERE s.client_id = c.id) as sale_count,
                    COALESCE(
                        (SELECT MAX(sv.date_out) FROM services sv WHERE sv.client = c.name),
                        (SELECT MAX(s.date) FROM sales s WHERE s.client_id = c.id),
                        ''
                    ) as last_date,
                    c.ci
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
            })
        })?;
        let mut clients = Vec::new();
        for row in rows { clients.push(row?); }
        Ok(clients)
    }

    pub fn add_client(&self, name: &str, phone: &str, email: &str, notes: &str) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
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
        if let Some(id) = self.find_client(name)? {
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

    pub fn get_client_services(&self, client_id: i64) -> SqlResult<Vec<Service>> {
        let conn = self.conn.lock().unwrap();
        // Try by client_id first, fallback to name match
        let mut stmt = conn.prepare(
            "SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.client_id, s.paid_amount FROM services s WHERE s.client_id = ?1 ORDER BY s.id DESC"
        )?;
        let rows = stmt.query_map(params![client_id], |r| {
            Ok(Service {
                id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
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
                client_id: r.get(21).unwrap_or(None),
                paid_amount: r.get(22).unwrap_or(0.0),
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
                "SELECT s.id, s.order_num, s.date_in, s.client, s.phone, s.model, s.fault, s.service_type, s.amount, s.payment_method, s.date_out, s.status, s.observations, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency, s.client_ci, s.client_address, s.device_checklist, s.client_id, s.paid_amount FROM services s WHERE s.client = ?1 ORDER BY s.id DESC"
            )?;
            let rows = stmt.query_map(params![name], |r| {
                Ok(Service {
                    id: r.get(0)?, order_num: r.get(1)?, date_in: r.get(2)?,
                    client: r.get(3)?, phone: r.get(4)?, model: r.get(5)?,
                    fault: r.get(6)?, service_type: r.get(7).unwrap_or(None),
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
                    client_id: r.get(21).unwrap_or(None),
                    paid_amount: r.get(22).unwrap_or(0.0),
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
            "SELECT s.id, s.date, s.product_id, s.product_name, s.quantity, s.unit_price, s.total, s.payment_method, s.client_name, s.notes, s.client_id, s.bank_fee_percent, s.bank_fee_amount, s.net_amount, s.zelle_reference, s.currency FROM sales s WHERE s.client_id = ?1 ORDER BY s.date DESC"
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
            })
        })?;
        let mut sales = Vec::new();
        for row in rows { sales.push(row?); }
        Ok(sales)
    }

    // --- Autocomplete suggestions ---
    pub fn suggest_products(&self, query: &str, limit: i64) -> SqlResult<Vec<Product>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT p.*, c.name as category_name FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.name LIKE ?1 OR p.brand LIKE ?1 OR p.model LIKE ?1 OR p.compatibility LIKE ?1
             ORDER BY p.name LIMIT ?2"
        )?;
        let rows = stmt.query_map(params![format!("%{}%", query), limit], |r| {
            Ok(Product {
                id: r.get(0)?, name: r.get(1)?, category_id: r.get(2)?,
                brand: r.get(3)?, model: r.get(4)?, variant: r.get(5)?,
                compatibility: r.get(6)?, price_cost: r.get(7)?, price_sale: r.get(8)?,
                stock: r.get(9)?, min_stock: r.get(10)?, created_at: r.get(11)?,
                updated_at: r.get(12)?, category_name: r.get(13)?,
            })
        })?;
        let mut products = Vec::new();
        for row in rows { products.push(row?); }
        Ok(products)
    }

    pub fn suggest_clients(&self, query: &str, limit: i64) -> SqlResult<Vec<Client>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.* FROM clients c WHERE c.name LIKE ?1 OR c.phone LIKE ?1 OR c.ci LIKE ?1 ORDER BY c.name LIMIT ?2"
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
            sql.push_str(&format!(" AND date(m.date) >= date('now', '-{} days')", d));
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
        let mut stmt = conn.prepare("SELECT * FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(Category { id: r.get(0)?, name: r.get(1)?, description: r.get(2)? })
        })?;
        let mut cats = Vec::new();
        for row in rows { cats.push(row?); }
        Ok(cats)
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
            "SELECT d, payment_method, total, bank_fee_amount, net_amount, currency FROM (
                SELECT date(date) as d, payment_method, total, bank_fee_amount,
                       COALESCE(net_amount, total) as net_amount, COALESCE(currency,'USD') as currency
                FROM sales WHERE date(date) >= ?1 AND date(date) <= ?2
                UNION ALL
                SELECT date(payment_date) as d, payment_method, amount, bank_fee_amount,
                       COALESCE(net_amount, amount) as net_amount, COALESCE(currency,'USD') as currency
                FROM service_payments WHERE date(payment_date) >= ?1 AND date(payment_date) <= ?2
                UNION ALL
                SELECT date(date_out) as d, payment_method, amount, bank_fee_amount,
                       COALESCE(net_amount, amount) as net_amount, COALESCE(currency,'USD') as currency
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
            Ok((d, method, total, bank_fee, net, currency))
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
        let mut daily_map: std::collections::HashMap<String, DailyTotals> = std::collections::HashMap::new();
        for row in rows {
            let (d, method, total, bank_fee, net, currency) = row?;
            let entry = daily_map.entry(d.clone()).or_insert(DailyTotals {
                date: d.clone(), pos_charged: 0.0, pos_fees: 0.0, pos_net: 0.0,
                cash_usd: 0.0, cash_bs: 0.0, zelle_total: 0.0,
                pago_movil_total: 0.0, transfer_bs_total: 0.0,
                usd_cash_total: 0.0, grand_total: 0.0,
                grand_usd: 0.0, grand_bs: 0.0, tasa_bcv: 0.0,
            });
            // Moneda SIEMPRE derivada del método (harness): Efectivo Bs/Pago Móvil/Transf Bs/Punto (Bs) → VES
            let cur = normalize_payment_currency(method.as_deref().unwrap_or(""), &currency).to_string();
            let pos_methods = ["Punto de Venta ($)", "Punto de Venta (Bs)", "Punto de Venta"];
            let is_pos = method.as_deref().map_or(false, |m| pos_methods.contains(&m));
            let is_zelle = method.as_deref().map_or(false, |m| m == "Transferencia Zelle" || m == "Zelle");
            if is_pos {
                entry.pos_charged += total;
                entry.pos_fees += bank_fee;
                entry.pos_net += net;
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
    pub fn set_pin(&self, pin: &str) -> SqlResult<()> {
        if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(day_shift_error("El PIN debe tener exactamente 4 dígitos."));
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin', ?1)",
            params![pin],
        )?;
        Ok(())
    }

    pub fn get_pin_status(&self) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap();
        let value: Option<Option<String>> = conn
            .query_row("SELECT value FROM settings WHERE key='pin'", [], |r| r.get(0))
            .optional()?;
        Ok(value.flatten().map_or(false, |v| !v.is_empty()))
    }

    pub fn verify_pin(&self, pin: &str) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap();
        let stored: Option<Option<String>> = conn
            .query_row("SELECT value FROM settings WHERE key='pin'", [], |r| r.get(0))
            .optional()?;
        Ok(stored.flatten().as_deref() == Some(pin))
    }

    pub fn remove_pin(&self, pin: &str) -> SqlResult<bool> {
        if !self.verify_pin(pin)? {
            return Err(day_shift_error("PIN incorrecto."));
        }
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM settings WHERE key='pin'", [])?;
        Ok(true)
    }

    // --- Pago Móvil detail del día ---
    pub fn get_pago_movil_detail(&self, date: &str) -> SqlResult<Vec<PagoMovilDetail>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT zelle_reference, total, 'Venta' as source, date FROM sales
                   WHERE (payment_method LIKE '%Móvil%' OR payment_method LIKE '%Movil%') AND date(date) = ?1
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
    pub fn export_daily_report(&self, date: &str) -> SqlResult<String> {
        // Totales ANTES de tomar el lock (get_daily_totals lo toma → mutex no reentrante)
        let totals = self.get_daily_totals(date, date)?;
        let t = if totals.is_empty() {
            DailyTotals {
                date: date.to_string(), pos_charged: 0.0, pos_fees: 0.0, pos_net: 0.0,
                cash_usd: 0.0, cash_bs: 0.0, zelle_total: 0.0,
                pago_movil_total: 0.0, transfer_bs_total: 0.0,
                usd_cash_total: 0.0, grand_total: 0.0,
                grand_usd: 0.0, grand_bs: 0.0, tasa_bcv: 0.0,
            }
        } else { totals[0].clone() };

        let conn = self.conn.lock().unwrap();

        // Tasa BCV del día (daily_closings)
        let tasa: f64 = conn
            .query_row(
                "SELECT tasa_bcv FROM daily_closings WHERE close_date=?1 ORDER BY id DESC LIMIT 1",
                params![date],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0.0);

        // Ventas del día
        let mut sales_rows: Vec<(Option<String>, Option<String>, i64, f64, f64, Option<String>, Option<String>, Option<String>)> = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT date, product_name, quantity, unit_price, total, payment_method, zelle_reference, client_name
                 FROM sales WHERE date(date) = ?1 ORDER BY date ASC"
            )?;
            let rows = stmt.query_map(params![date], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?, r.get::<_, f64>(3)?, r.get::<_, f64>(4)?,
                    r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                ))
            })?;
            for row in rows { sales_rows.push(row?); }
        }

        // Pagos de servicios del día (join services)
        let mut payment_rows: Vec<(Option<String>, Option<String>, Option<String>, Option<String>, f64, Option<String>, Option<String>)> = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT sp.payment_date, s.order_num, s.client, s.model, sp.amount, sp.payment_method, sp.zelle_reference
                 FROM service_payments sp JOIN services s ON s.id = sp.service_id
                 WHERE date(sp.payment_date) = ?1 ORDER BY sp.payment_date ASC"
            )?;
            let rows = stmt.query_map(params![date], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?,
                    r.get::<_, f64>(4)?, r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })?;
            for row in rows { payment_rows.push(row?); }
        }

        // Pago móvil del día (query inline, mismo lock)
        let mut pm_rows: Vec<(Option<String>, f64, String)> = Vec::new();
        {
            let sql = "SELECT zelle_reference, total, 'Venta' as source, date FROM sales
                       WHERE (payment_method LIKE '%Móvil%' OR payment_method LIKE '%Movil%') AND date(date) = ?1
                       UNION ALL
                       SELECT sp.zelle_reference, sp.amount, 'Abono ' || COALESCE(s.order_num, ''), sp.payment_date
                       FROM service_payments sp
                       JOIN services s ON s.id = sp.service_id
                       WHERE (sp.payment_method LIKE '%Móvil%' OR sp.payment_method LIKE '%Movil%') AND date(sp.payment_date) = ?1
                       ORDER BY date";
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![date], |r| {
                Ok((
                    r.get::<_, Option<String>>(0).unwrap_or(None),
                    r.get::<_, f64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            for row in rows { pm_rows.push(row?); }
        }

        let mut csv = String::new();
        csv.push('\u{FEFF}');
        let tasa_str = if tasa > 0.0 { fmt_num(tasa) } else { String::new() };
        csv.push_str(&format!("REPORTE DIARIO;Fecha;{};Tasa BCV;{}\n", csv_field(date), csv_field(&tasa_str)));

        csv.push('\n');
        csv.push_str("VENTAS\n");
        csv.push_str("Fecha;Producto;Cant;Precio Unit;Total;Metodo;Referencia;Cliente\n");
        for (d, name, qty, unit, total, method, ref_, client) in &sales_rows {
            csv.push_str(&format!(
                "{};{};{};{};{};{};{};{}\n",
                csv_field(d.as_deref().unwrap_or("")),
                csv_field(name.as_deref().unwrap_or("")),
                qty,
                csv_field(&fmt_num(*unit)),
                csv_field(&fmt_num(*total)),
                csv_field(method.as_deref().unwrap_or("")),
                csv_field(ref_.as_deref().unwrap_or("")),
                csv_field(client.as_deref().unwrap_or("")),
            ));
        }

        csv.push('\n');
        csv.push_str("PAGOS DE SERVICIOS\n");
        csv.push_str("Fecha;Orden;Cliente;Equipo;Monto;Metodo;Referencia\n");
        for (d, order, client, model, amount, method, ref_) in &payment_rows {
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

        csv.push('\n');
        csv.push_str("PAGO MOVIL DEL DIA\n");
        csv.push_str("Referencia;Monto;Origen\n");
        for (ref_, amount, source) in &pm_rows {
            csv.push_str(&format!(
                "{};{};{}\n",
                csv_field(ref_.as_deref().unwrap_or("")),
                csv_field(&fmt_num(*amount)),
                csv_field(source),
            ));
        }

        csv.push('\n');
        csv.push_str("TOTALES\n");
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

        let mut dir = std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        dir.push("Documents");
        dir.push("Registro");
        std::fs::create_dir_all(&dir).map_err(|e| day_shift_error(&format!("No se pudo crear el directorio: {}", e)))?;
        let path = dir.join(format!("reporte_{}.csv", date));
        std::fs::write(&path, csv.as_bytes()).map_err(|e| day_shift_error(&format!("No se pudo escribir el archivo: {}", e)))?;

        let path_str = path.to_string_lossy().to_string();
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .spawn();
        Ok(path_str)
    }

    pub fn get_daily_closings(&self) -> SqlResult<Vec<DailyClosing>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT id, close_date, pos_charged, pos_fees, pos_net, pos_settled, cash_usd, cash_bs, zelle_total, pago_movil_total, transfer_bs_total, usd_cash_total, grand_total, is_closed, closed_at, notes, tasa_bcv, tasa_eur, opened_at, initial_cash_usd, actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs, actual_zelle, actual_pago_movil, actual_transfer_bs, difference, total_usd, total_bs FROM daily_closings ORDER BY close_date DESC";
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
            })
        })?;
        let mut closings = Vec::new();
        for row in rows { closings.push(row?); }
        Ok(closings)
    }

    pub fn get_active_day(&self) -> SqlResult<Option<DailyClosing>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT id, close_date, pos_charged, pos_fees, pos_net, pos_settled, cash_usd, cash_bs, zelle_total, pago_movil_total, transfer_bs_total, usd_cash_total, grand_total, is_closed, closed_at, notes, tasa_bcv, tasa_eur, opened_at, initial_cash_usd, actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs, actual_zelle, actual_pago_movil, actual_transfer_bs, difference, total_usd, total_bs FROM daily_closings WHERE is_closed=0 ORDER BY close_date DESC LIMIT 1";
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
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn open_day(&self, initial_cash_usd: f64, tasa_bcv: f64, tasa_eur: f64) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let already_open: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM daily_closings WHERE is_closed=0)",
            [], |r| r.get(0),
        )?;
        if already_open {
            return Err(day_shift_error("Ya hay un día abierto. Ciérralo antes de abrir uno nuevo."));
        }
        conn.execute(
            "INSERT INTO daily_closings (close_date, initial_cash_usd, tasa_bcv, tasa_eur, opened_at, is_closed)
             VALUES (?1,?2,?3,?4,datetime('now','localtime'),0)
             ON CONFLICT(close_date) DO UPDATE SET
                initial_cash_usd=excluded.initial_cash_usd, tasa_bcv=excluded.tasa_bcv,
                tasa_eur=excluded.tasa_eur, opened_at=excluded.opened_at, is_closed=0",
            params![today, initial_cash_usd, tasa_bcv, tasa_eur],
        )?;
        // Reabrir un día de hoy previamente cerrado conserva la fila (sin OR REPLACE destructivo)
        let id: i64 = conn.query_row("SELECT id FROM daily_closings WHERE close_date=?1", params![today], |r| r.get(0))?;
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

    pub fn close_day(&self, close_date: &str, notes: &str, initial_cash_usd: f64, tasa_bcv: f64, tasa_eur: f64,
                     actual_cash_usd: f64, actual_cash_bs: f64, actual_punto_usd: f64, actual_punto_bs: f64,
                     actual_zelle: f64, actual_pago_movil: f64, actual_transfer_bs: f64) -> SqlResult<i64> {
        // Calculate totals for this date from sales + services (sin lock: get_daily_totals lo toma)
        let totals = self.get_daily_totals(close_date, close_date)?;
        let t = if totals.is_empty() {
            DailyTotals {
                date: close_date.to_string(), pos_charged: 0.0, pos_fees: 0.0, pos_net: 0.0,
                cash_usd: 0.0, cash_bs: 0.0, zelle_total: 0.0,
                pago_movil_total: 0.0, transfer_bs_total: 0.0,
                usd_cash_total: 0.0, grand_total: 0.0,
                grand_usd: 0.0, grand_bs: 0.0, tasa_bcv: 0.0,
            }
        } else { totals[0].clone() };
        let conn = self.conn.lock().unwrap();

        // Expected vs actual difference per currency group
        // USD group: cash_usd + zelle + usd_cash vs actual_cash_usd + actual_zelle
        // Bs group: cash_bs + pago_movil + transfer_bs vs actual_cash_bs + actual_pago_movil + actual_transfer_bs
        let expected_usd = t.cash_usd + t.zelle_total + t.usd_cash_total;
        let actual_usd = actual_cash_usd + actual_zelle;
        let expected_bs = t.cash_bs + t.pago_movil_total + t.transfer_bs_total;
        let actual_bs = actual_cash_bs + actual_pago_movil + actual_transfer_bs;
        let diff_usd = actual_usd - expected_usd;
        let diff_bs = actual_bs - expected_bs;
        let difference = if tasa_bcv > 0.0 { diff_usd + diff_bs / tasa_bcv } else { diff_usd };
        // Total General en USD equivalente: USD + Bs convertidos con la tasa del cierre (nunca sumar Bs como USD)
        let grand_total = t.grand_usd + if tasa_bcv > 0.0 { t.grand_bs / tasa_bcv } else { 0.0 };

        let changes = conn.execute(
            "UPDATE daily_closings SET pos_charged=?2, pos_fees=?3, pos_net=?4, cash_usd=?5, cash_bs=?6, zelle_total=?7, pago_movil_total=?8, transfer_bs_total=?9, usd_cash_total=?10, grand_total=?11, is_closed=1, closed_at=datetime('now','localtime'), notes=?12, tasa_bcv=?13, tasa_eur=?14, initial_cash_usd=?15, actual_cash_usd=?16, actual_cash_bs=?17, actual_punto_usd=?18, actual_punto_bs=?19, actual_zelle=?20, actual_pago_movil=?21, actual_transfer_bs=?22, difference=?23, total_usd=?24, total_bs=?25
             WHERE close_date=?1 AND is_closed=0",
            params![close_date, t.pos_charged, t.pos_fees, t.pos_net, t.cash_usd, t.cash_bs,
                    t.zelle_total, t.pago_movil_total, t.transfer_bs_total, t.usd_cash_total, grand_total, notes,
                    tasa_bcv, tasa_eur, initial_cash_usd, actual_cash_usd, actual_cash_bs, actual_punto_usd, actual_punto_bs,
                    actual_zelle, actual_pago_movil, actual_transfer_bs, difference, t.grand_usd, t.grand_bs],
        )?;
        if changes == 0 {
            return Err(day_shift_error("No hay un día abierto con esa fecha para cerrar."));
        }
        let id: i64 = conn.query_row(
            "SELECT id FROM daily_closings WHERE close_date=?1", params![close_date], |r| r.get(0),
        )?;
        Ok(id)
    }

    pub fn reopen_day(&self, close_date: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE daily_closings SET is_closed=0, closed_at=NULL WHERE close_date=?1", params![close_date])?;
        Ok(())
    }

    pub fn update_daily_closing_settlement(&self, id: i64, pos_settled: f64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE daily_closings SET pos_settled=?1 WHERE id=?2", params![pos_settled, id])?;
        Ok(())
    }

    // --- Export/Import ---
    pub fn export_data(&self) -> SqlResult<String> {
        let conn = self.conn.lock().unwrap();
        let tables = ["categories", "payment_methods", "service_statuses", "products", "clients", "sales", "services", "service_payments", "inventory_movements", "purchase_orders", "purchase_order_items", "daily_closings"];
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
        let tables = ["categories", "payment_methods", "service_statuses", "products", "clients", "sales", "services", "service_payments", "inventory_movements", "purchase_orders", "purchase_order_items", "daily_closings"];

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
                        let sql = format!("INSERT INTO {} ({}) VALUES ({})", table, cols.join(", "), placeholders.join(", "));
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

fn day_shift_error(msg: &str) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::ErrorCode::CannotOpen as i32),
        Some(msg.to_string()),
    )
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

    // Ejecuta un cierre tomando el lock de la conexión una sola vez
    fn conn_query<T, F: FnOnce() -> T>(f: F) -> T {
        f()
    }

    #[test]
    fn test_all_operations() {
        let test_path = PathBuf::from("test_registro.db");
        let _ = std::fs::remove_file(&test_path);

        let db = Database::new(&test_path).expect("Failed to create test DB");

        // Blocking: sales/services require an open day
        let blocked = db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Efectivo Bs", "Test Client", None, "", 0.0, "", "USD");
        assert!(blocked.is_err(), "add_sale must fail without an open day");

        // Open day (shift) with BCV rate
        let day_id = db.open_day(10.0, 40.5, 45.0).unwrap();
        assert!(day_id > 0);
        let active = db.get_active_day().unwrap();
        assert!(active.is_some(), "There must be an active day");
        assert_eq!(active.unwrap().tasa_bcv, 40.5);
        // Cannot open twice
        assert!(db.open_day(0.0, 0.0, 0.0).is_err());

        // Categories
        let cats = db.get_categories().unwrap();
        assert!(!cats.is_empty(), "Should have default categories");
        println!("  Categories: {}", cats.len());

        // Add product
        let pid = db.add_product("Pantalla Test", Some(1), "Xiaomi", "Red Note 11",
            "Incell", "[\"Red Note 11\",\"Note 11S\"]", 8.0, 15.0, 5, 2).unwrap();
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
        db.add_sale(Some(pid), "Pantalla Test", 1, 15.0, 15.0, "Efectivo Bs", "Test Client", Some(cid), "", 0.0, "", "USD").unwrap();
        let sales = db.get_sales("", None, "", "").unwrap();
        assert_eq!(sales.len(), 1);

        // Sales stats
        let stats = db.get_sales_stats(30).unwrap();
        assert!(stats.len() >= 1);

        // Add service (linked to client id)
        let sid = db.add_service("ORD-TEST-1", "Juan Perez", "0412-1234567",
            "Samsung A32", "No enciende", "Cambio batería", 25.0, "Efectivo Bs", "", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"si","bandeja_sim":"si","botones":"si","boton_home":"na","camara":"si","puerto_carga":"si","parlante":"si","contrasena":"no","accesorios":"no"}"#, Some(cid)).unwrap();
        assert!(sid > 0);

        // Auto-inventory: create Samsung A32 screen product (stock 2) before delivering
        let a32_pid = db.add_product("Pantalla Samsung A32", Some(1), "Samsung", "A32",
            "", "[\"Samsung A32\"]", 12.0, 15.0, 2, 0).unwrap();

        db.update_service(sid, "Juan Perez", "0412-1234567", "Samsung A32",
            "No enciende - reparado", "Cambio batería", 25.0, "Efectivo Bs", "2026-07-30",
            "Entregado", "Garantía 15 días", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"no"}"#).unwrap();

        let stock_before: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![a32_pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(stock_before, 1, "stock debe bajar de 2 a 1 al entregar servicio");
        // Reopening returns stock
        db.update_service(sid, "Juan Perez", "0412-1234567", "Samsung A32",
            "No enciende - reparado", "Cambio batería", 25.0, "Efectivo Bs", "2026-07-30",
            "Por entregar", "Garantía 15 días", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"no"}"#).unwrap();
        let stock_back: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE id=?1", params![a32_pid], |r| r.get(0)).unwrap()
        });
        assert_eq!(stock_back, 2, "stock debe volver a 2 al reabrir");
        // Entregar de nuevo y borrar el servicio → stock vuelve
        db.update_service(sid, "Juan Perez", "0412-1234567", "Samsung A32",
            "No enciende - reparado", "Cambio batería", 25.0, "Efectivo Bs", "2026-07-30",
            "Entregado", "Garantía 15 días", 0.0, "", "USD",
            "V-12345678", "Av. Principal", r#"{"chip_sim":"si","tapa_trasera":"no"}"#).unwrap();

        // Auto-create: model not in catalog gets created on delivery
        db.add_service("ORD-TEST-2", "Maria Lopez", "0412-7654321",
            "Pantalla Inexistente XYZ", "Rota", "Cambio pantalla", 20.0, "Efectivo Bs", "", 0.0, "", "USD",
            "V-99999999", "", "", None).unwrap();
        let sid2 = db.get_services("", "").unwrap().iter().find(|s| s.order_num.as_deref() == Some("ORD-TEST-2")).unwrap().id;
        let new_prod: Option<i64> = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT id FROM products WHERE name LIKE '%Inexistente XYZ%'", [], |r| r.get(0)).ok()
        });
        assert!(new_prod.is_none(), "producto no existe antes de entregar");
        db.update_service(sid2, "Maria Lopez", "0412-7654321", "Pantalla Inexistente XYZ",
            "Rota", "Cambio pantalla", 20.0, "Efectivo Bs", "2026-07-30", "Entregado", "", 0.0, "", "USD",
            "V-99999999", "", "").unwrap();
        let new_prod_stock: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE name LIKE '%Inexistente XYZ%'", [], |r| r.get(0)).unwrap()
        });
        assert_eq!(new_prod_stock, -1, "producto auto-creado con stock -1 tras entrega");
        db.delete_service(sid2).unwrap();
        let new_prod_stock2: i64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT stock FROM products WHERE name LIKE '%Inexistente XYZ%'", [], |r| r.get(0)).unwrap()
        });
        assert_eq!(new_prod_stock2, 0, "borrar servicio entregado devuelve stock");

        let services = db.get_services("", "").unwrap();
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
        let pid1 = db.add_service_payment(sid, 10.0, "Efectivo Bs", 0.0, "", "USD", "Abono inicial").unwrap();
        assert!(pid1 > 0);
        let payments = db.get_service_payments(sid).unwrap();
        assert_eq!(payments.len(), 1);
        assert_eq!(payments[0].amount, 10.0);
        // La moneda se deriva del método: Efectivo Bs → VES aunque el frontend mande 'USD'
        assert_eq!(payments[0].currency.as_deref(), Some("VES"), "moneda derivada del método Bs");
        // paid_amount convierte Bs→USD con la tasa del día (40.5) => 10/40.5 ≈ 0.2469
        let expected_bs: f64 = 10.0 / 40.5;
        let paid: f64 = conn_query(|| {
            let c = db.conn.lock().unwrap();
            c.query_row("SELECT paid_amount FROM services WHERE id=?1", params![sid], |r| r.get(0)).unwrap()
        });
        assert!((paid - expected_bs).abs() < 1e-9, "paid_amount convierte Bs→USD con tasa del día: {paid}");
        db.add_service_payment(sid, 15.0, "Divisas (USD Cash)", 0.0, "", "USD", "Saldo final").unwrap();
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
        db.add_service_payment(sid, 10.0, "Efectivo Bs", 0.0, "", "USD", "Abono inicial").unwrap();
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
        let services_after = db.get_services("", "").unwrap();
        assert_eq!(services_after.len(), 0); // was deleted

        // Import price list
        let items = r#"[{"name":"Pantalla Samsung A15","brand":"Samsung","model":"A15 A155","variant":"Incell con marco","category":"Pantalla","price_cost":14.0,"price_sale":17.5,"compatibility":""}]"#;
        let imported = db.import_price_list(items).unwrap();
        assert_eq!(imported, 1);

        // Close day with arqueo (actual counts) and verify persistence
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let closing_id = db.close_day(&today, "cierre test", 10.0, 40.5, 45.0,
            15.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
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
        let blocked_after = db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Efectivo Bs", "Test Client", None, "", 0.0, "", "USD");
        assert!(blocked_after.is_err(), "add_sale must fail after closing");

        // Reopen day → active again
        db.reopen_day(&today).unwrap();
        assert!(db.get_active_day().unwrap().is_some());

        // Clean up
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
        db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Pago Móvil", "Cliente PM", None, "", 0.0, "REF-1234", "Bs").unwrap();

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
                currency TEXT
            )",
            [],
        ).unwrap();
        drop(conn);

        db.open_day(0.0, 0.0, 0.0).unwrap();
        let cid = db.add_or_find_client("Ana", "0412-111", "V-100", "Av 1").unwrap();
        db.add_sale(None, "Pantalla Test", 1, 15.0, 15.0, "Pago Móvil", "Ana", Some(cid), "nota de prueba", 0.0, "REF-99", "Bs").unwrap();

        let sales = db.get_sales("", None, "", "").unwrap();
        assert_eq!(sales.len(), 1, "get_sales con orden físico legacy");
        assert_eq!(sales[0].client_id, Some(cid));
        assert_eq!(sales[0].notes.as_deref(), Some("nota de prueba"));
        assert_eq!(sales[0].zelle_reference.as_deref(), Some("REF-99"));

        let client_sales = db.get_client_sales(cid).unwrap();
        assert_eq!(client_sales.len(), 1, "get_client_sales con orden físico legacy");
        assert_eq!(client_sales[0].payment_method.as_deref(), Some("Pago Móvil"));

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
            "Incell", "[\"A15 A155\"]", 14.0, 17.5, 10, 2).unwrap();
        db.add_sale(Some(pid), "Pantalla Samsung A15", 2, 17.5, 35.0, "Divisas (USD Cash)", "Ana", None, "", 0.0, "", "USD").unwrap();
        db.add_sale(Some(pid), "Pantalla Samsung A15", 1, 17.5, 17.5, "Pago Móvil", "Ana", None, "", 0.0, "REF-1", "Bs").unwrap();

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
        db.add_sale(None, "Pantalla Test", 1, 100.0, 100.0, "Pago Móvil", "Cliente", None, "", 0.0, "", "VES").unwrap();
        // Abono en Bs (Efectivo Bs) + abono en USD (Divisas)
        let sid = db.add_service("ORD-TEST-LEDGER", "Cliente", "0412-1", "Samsung A15", "Rota", "Cambio pantalla",
            50.0, "Pago Móvil", "", 0.0, "", "VES", "", "", "", None).unwrap();
        db.add_service_payment(sid, 100.0, "Efectivo Bs", 0.0, "", "USD", "abono bs").unwrap();
        db.add_service_payment(sid, 50.0, "Divisas (USD Cash)", 0.0, "", "USD", "abono usd").unwrap();

        let totals = db.get_daily_totals(&today, &today).unwrap();
        assert_eq!(totals.len(), 1, "un día con movimientos");
        let t = &totals[0];
        assert_eq!(t.grand_usd, 50.0, "desglose USD (solo divisas)");
        assert_eq!(t.grand_bs, 200.0, "desglose Bs (venta 100 PM + abono 100 Efectivo Bs)");
        assert_eq!(t.pago_movil_total, 100.0);
        assert_eq!(t.cash_bs, 100.0);
        assert_eq!(t.usd_cash_total, 50.0);
        assert_eq!(t.tasa_bcv, 40.5, "tasa del día abierto");
        assert!((t.grand_total - (50.0 + 200.0 / 40.5)).abs() < 1e-9, "grand_total en USD equivalente, got {}", t.grand_total);

        // Cierre: guarda desglose + grand_total correcto
        db.close_day(&today, "cierre moneda", 10.0, 40.5, 45.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let closings = db.get_daily_closings().unwrap();
        let c = closings.iter().find(|x| x.close_date == today).unwrap();
        assert_eq!(c.total_usd, 50.0, "cierre guarda total_usd");
        assert_eq!(c.total_bs, 200.0, "cierre guarda total_bs");
        assert!((c.grand_total - (50.0 + 200.0 / 40.5)).abs() < 1e-9, "grand_total del cierre en USD equiv, got {}", c.grand_total);

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

        let sid = db.add_service("ORD-WARR-1", "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla",
            25.0, "Efectivo Bs", "", 0.0, "", "USD", "V-100", "", "", None).unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        // 1) Entregar sin fecha → se asigna hoy
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla",
            25.0, "Efectivo Bs", "", "Entregado", "", 0.0, "", "USD", "V-100", "", "").unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.date_out.as_deref(), Some(today.as_str()), "date_out auto = hoy al entregar");

        // 2) Reabrir (garantía / reclamo) → date_out se limpia
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla",
            25.0, "Efectivo Bs", "2026-07-30", "Recibido", "", 0.0, "", "USD", "V-100", "", "").unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert!(svc.date_out.is_none(), "date_out limpio al reabrir, got {:?}", svc.date_out);

        // 3) Re-entregar sin fecha → nueva fecha de hoy
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla",
            25.0, "Efectivo Bs", "", "Entregado", "", 0.0, "", "USD", "V-100", "", "").unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.date_out.as_deref(), Some(today.as_str()), "nueva entrega → fecha nueva");

        // 4) Editar sin cambiar de Entregado → conserva la fecha
        db.update_service(sid, "Ana", "0412-1", "Samsung A32", "Rota", "Cambio pantalla",
            30.0, "Efectivo Bs", "", "Entregado", "nota", 0.0, "", "USD", "V-100", "", "").unwrap();
        let svc = db.get_service_by_id(sid).unwrap().unwrap();
        assert_eq!(svc.date_out.as_deref(), Some(today.as_str()), "sigue entregado → conserva fecha");

        drop(db);
        let _ = std::fs::remove_file(&test_path);
    }
}
