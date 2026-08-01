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
}

export interface ClientSummary {
  id: number;
  name: string;
  phone: string | null;
  total_spent: number;
  service_count: number;
  sale_count: number;
  last_date: string | null;
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
}

export interface DailyTotals {
  date: string;
  pos_charged: number;
  pos_fees: number;
  pos_net: number;
  cash_usd: number;
  cash_bs: number;
  zelle_total: number;
  pago_movil_total: number;
  transfer_bs_total: number;
  usd_cash_total: number;
  grand_total: number;
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
}

export interface SaleStat {
  product_name: string | null;
  product_id: number | null;
  qty: number;
  total: number;
  count: number;
}

export interface Service {
  id: number;
  order_num: string | null;
  date_in: string | null;
  client: string | null;
  phone: string | null;
  model: string | null;
  fault: string | null;
  amount: number;
  payment_method: string | null;
  date_out: string | null;
  status: string | null;
  observations: string | null;
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
