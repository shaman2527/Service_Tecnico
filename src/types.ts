export interface Category {
  id: number;
  name: string;
  description: string | null;
}

export interface Client {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  total_spent: number;
  last_service: string | null;
  last_purchase: string | null;
  created_at: string | null;
  ci?: string | null;
  address?: string | null;
}

export interface ClientSummary {
  id: number;
  name: string;
  phone: string | null;
  total_spent: number;
  service_count: number;
  sale_count: number;
  last_date: string | null;
  ci?: string | null;
}

export interface PagoMovilDetail {
  reference: string | null;
  amount: number;
  source: string;
}

export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  brand: string | null;
  model: string | null;
  variant: string | null;
  compatibility: string | null;
  price_cost: number;
  price_sale: number;
  stock: number;
  min_stock: number;
  created_at: string | null;
  updated_at: string | null;
  category_name: string | null;
}

export interface Sale {
  id: number;
  date: string | null;
  product_id: number | null;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  payment_method: string | null;
  client_name: string | null;
  client_id: number | null;
  notes: string | null;
  bank_fee_percent: number;
  bank_fee_amount: number;
  net_amount: number;
  zelle_reference: string | null;
  currency: string | null;
}

export interface Service {
  id: number;
  order_num: string | null;
  date_in: string | null;
  client: string | null;
  phone: string | null;
  model: string | null;
  fault: string | null;
  service_type: string | null;
  amount: number;
  payment_method: string | null;
  date_out: string | null;
  status: string | null;
  observations: string | null;
  bank_fee_percent: number;
  bank_fee_amount: number;
  net_amount: number;
  zelle_reference: string | null;
  currency: string | null;
  client_ci: string | null;
  client_address: string | null;
  device_checklist: string | null;
  client_id: number | null;
  paid_amount: number;
}

export interface ServicePayment {
  id: number;
  service_id: number;
  amount: number;
  payment_method: string | null;
  bank_fee_percent: number;
  bank_fee_amount: number;
  net_amount: number;
  zelle_reference: string | null;
  currency: string | null;
  payment_date: string | null;
  notes: string | null;
}

export interface PurchaseOrder {
  id: number;
  order_date: string | null;
  supplier: string | null;
  status: string | null;
  notes: string | null;
  item_count: number;
  total_quantity: number;
  total_cost: number;
}

export interface PurchaseOrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string | null;
  quantity: number;
  unit_price: number;
}

export interface DeviceChecklist {
  [key: string]: 'si' | 'no' | '';
}

export interface DailyTotals {
  date: string;
  pos_charged: number;
  pos_fees: number;
  pos_net: number;
  /** Punto de Venta desglosado por moneda (el cobro puede ser $ o Bs) */
  pos_charged_usd: number;
  pos_charged_bs: number;
  pos_net_usd: number;
  pos_net_bs: number;
  cash_usd: number;
  cash_bs: number;
  zelle_total: number;
  pago_movil_total: number;
  transfer_bs_total: number;
  usd_cash_total: number;
  grand_total: number;
  /** Desglose por moneda (moneda derivada del método de pago) */
  grand_usd: number;
  grand_bs: number;
  /** Tasa BCV del día (de daily_closings; fallback día abierto) */
  tasa_bcv: number;
}

export interface DailyClosing {
  id: number;
  close_date: string;
  pos_charged: number;
  pos_fees: number;
  pos_net: number;
  pos_settled: number;
  cash_usd: number;
  cash_bs: number;
  zelle_total: number;
  pago_movil_total: number;
  transfer_bs_total: number;
  usd_cash_total: number;
  grand_total: number;
  is_closed: boolean;
  closed_at: string | null;
  notes: string | null;
  tasa_bcv: number;
  tasa_eur: number;
  opened_at: string | null;
  initial_cash_usd: number;
  actual_cash_usd: number;
  actual_cash_bs: number;
  actual_punto_usd: number;
  actual_punto_bs: number;
  actual_zelle: number;
  actual_pago_movil: number;
  actual_transfer_bs: number;
  difference: number;
  /** Desglose del día en moneda real (migración 2026-08-02) */
  total_usd: number;
  total_bs: number;
}

export interface BCVRate {
  usd: number;
  eur: number;
}

export interface SaleStat {
  product_name: string | null;
  product_id: number | null;
  qty: number;
  total: number;
  count: number;
}

export interface ServiceDashboard {
  total: number;
  entregados: number;
  pendientes: number;
  total_ingresos: number;
  method_stats: MethodStat[];
  status_stats: StatusStat[];
}

export interface MethodStat {
  payment_method: string | null;
  count: number;
  total: number;
}

export interface StatusStat {
  status: string | null;
  count: number;
  total: number;
}

export interface CategoryStat {
  category_name: string | null;
  units: number;
  total_usd: number;
  total_bs: number;
}

export interface ModelStat {
  product_name: string | null;
  model: string | null;
  brand: string | null;
  units: number;
  total_usd: number;
  total_bs: number;
}

export interface DashboardAnalytics {
  today_usd: number;
  today_bs: number;
  week_usd: number;
  week_bs: number;
  week_units: number;
  week_count: number;
  category_stats: CategoryStat[];
  top_models: ModelStat[];
  product_count: number;
  sale_count: number;
  service_count: number;
  client_count: number;
  last_sale: string | null;
  last_service: string | null;
  last_movement: string | null;
  last_activity: string | null;
}

export interface InventoryMovement {
  id: number;
  date: string | null;
  product_id: number | null;
  type: string | null;
  quantity: number;
  reason: string | null;
  reference: string | null;
  product_name: string | null;
}

export interface PaymentMethod {
  id: number;
  name: string;
}

export interface ServiceStatus {
  id: number;
  name: string;
}
