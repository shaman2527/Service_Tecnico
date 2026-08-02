import type {
  Category, Client, ClientSummary, Product, Sale, SaleStat, Service, ServicePayment,
  ServiceDashboard, DashboardAnalytics, InventoryMovement, PaymentMethod, ServiceStatus,
  DailyTotals, DailyClosing, BCVRate, PurchaseOrder, PurchaseOrderItem, PagoMovilDetail
} from './types';

const isTauri = typeof window !== 'undefined' &&
  ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined ||
    (window as unknown as Record<string, unknown>).__TAURI__ !== undefined);

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return Promise.reject(new Error('Tauri not available'));
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

const mock = <T>(val: T): Promise<T> => Promise.resolve(val);

// Cache estática: métodos/estados no cambian durante la sesión (evita invoke duplicados)
let cachedMethods: PaymentMethod[] | null = null;
let cachedStatuses: ServiceStatus[] | null = null;
let cachedCategories: Category[] | null = null;

export const api = {
  getCategories: () => {
    if (cachedCategories) return mock(cachedCategories);
    return tauriInvoke<Category[]>('get_categories').then(c => {
      cachedCategories = c;
      return c;
    }).catch(() =>
      mock<Category[]>([{ id: 1, name: 'Pantalla', description: null }]));
  },

  getPaymentMethods: () => {
    if (cachedMethods) return mock(cachedMethods);
    return tauriInvoke<PaymentMethod[]>('get_payment_methods').then(m => {
      cachedMethods = m;
      return m;
    }).catch(() =>
      mock<PaymentMethod[]>([{ id: 1, name: 'Efectivo' }]));
  },

  getServiceStatuses: () => {
    if (cachedStatuses) return mock(cachedStatuses);
    return tauriInvoke<ServiceStatus[]>('get_service_statuses').then(s => {
      cachedStatuses = s;
      return s;
    }).catch(() =>
      mock<ServiceStatus[]>([{ id: 1, name: 'Pendiente' }]));
  },

  nextOrderNum: () => tauriInvoke<string>('next_order_num').catch(() =>
    mock<string>('DEV-0001')),

  addProduct: (name: string, categoryId: number | null, brand: string, model: string,
    variant: string, compatibility: string, priceCost: number, priceSale: number,
    stock: number, minStock: number) =>
    tauriInvoke<number>('add_product', {
      name, categoryId, brand, model, variant, compatibility, priceCost, priceSale, stock, minStock
    }),

  updateProduct: (id: number, name: string, categoryId: number | null, brand: string, model: string,
    variant: string, compatibility: string, priceCost: number, priceSale: number,
    stock: number, minStock: number) =>
    tauriInvoke<void>('update_product', {
      id, name, categoryId, brand, model, variant, compatibility, priceCost, priceSale, stock, minStock
    }),

  deleteProduct: (id: number) => tauriInvoke<void>('delete_product', { id }),
  getProducts: (search: string = '', categoryId: number | null = null) =>
    tauriInvoke<Product[]>('get_products', { search, categoryId }),

  getLowStockProducts: () => tauriInvoke<Product[]>('get_low_stock_products').catch(() =>
    mock<Product[]>([])),
  getReorderSuggestions: () => tauriInvoke<Product[]>('get_reorder_suggestions').catch(() =>
    mock<Product[]>([])),
  suggestProducts: (query: string, limit: number = 10) =>
    tauriInvoke<Product[]>('suggest_products', { query, limit }),

  addSale: (productId: number | null, productName: string, quantity: number,
    unitPrice: number, total: number, paymentMethod: string, clientName: string,
    clientId: number | null, notes: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD') =>
    tauriInvoke<void>('add_sale', {
      productId, productName, quantity, unitPrice, total, paymentMethod, clientName, clientId, notes,
      bankFeePercent, zelleReference, currency
    }),

  getSales: (search: string = '', days: number | null = null, startDate: string = '', endDate: string = '') =>
    tauriInvoke<Sale[]>('get_sales', { search, days, startDate, endDate }),

  getSalesStats: (days: number) => tauriInvoke<SaleStat[]>('get_sales_stats', { days }),

  addService: (orderNum: string, client: string, phone: string, model: string,
    fault: string, serviceType: string, amount: number, paymentMethod: string, observations: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    clientCi: string = '', clientAddress: string = '', deviceChecklist: string = '',
    clientId: number | null = null) =>
    tauriInvoke<number>('add_service', { orderNum, client, phone, model, fault, serviceType, amount, paymentMethod, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, deviceChecklist, clientId }),

  updateService: (id: number, client: string, phone: string, model: string, fault: string,
    serviceType: string, amount: number, paymentMethod: string, dateOut: string, status: string, observations: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    clientCi: string = '', clientAddress: string = '', deviceChecklist: string = '') =>
    tauriInvoke<void>('update_service', { id, client, phone, model, fault, serviceType, amount, paymentMethod, dateOut, status, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, deviceChecklist }),

  deleteService: (id: number) => tauriInvoke<void>('delete_service', { id }),

  getServices: (search: string = '', status: string = '') =>
    tauriInvoke<Service[]>('get_services', { search, status }),

  getServicePayments: (serviceId: number) =>
    tauriInvoke<ServicePayment[]>('get_service_payments', { serviceId }),

  addServicePayment: (serviceId: number, amount: number, paymentMethod: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    notes: string = '') =>
    tauriInvoke<number>('add_service_payment', { serviceId, amount, paymentMethod, bankFeePercent, zelleReference, currency, notes }),

  deleteServicePayment: (id: number) =>
    tauriInvoke<void>('delete_service_payment', { id }),

  addPurchaseOrder: (supplier: string, notes: string, itemsJson: string) =>
    tauriInvoke<number>('add_purchase_order', { supplier, notes, itemsJson }),

  getPurchaseOrders: () => tauriInvoke<PurchaseOrder[]>('get_purchase_orders'),

  getPurchaseOrderItems: (orderId: number) =>
    tauriInvoke<PurchaseOrderItem[]>('get_purchase_order_items', { orderId }),

  markPurchaseOrderReceived: (orderId: number) =>
    tauriInvoke<void>('mark_purchase_order_received', { orderId }),

  deletePurchaseOrder: (orderId: number) =>
    tauriInvoke<void>('delete_purchase_order', { orderId }),

  getServiceDashboard: () => tauriInvoke<ServiceDashboard>('get_service_dashboard').catch(() =>
    mock<ServiceDashboard>({
      total: 0, entregados: 0, pendientes: 0, total_ingresos: 0,
      method_stats: [], status_stats: []
    })),

  getService: (id: number) => tauriInvoke<Service>('get_service', { id }),

  getDashboardAnalytics: () => tauriInvoke<DashboardAnalytics>('get_dashboard_analytics').catch(() =>
    mock<DashboardAnalytics>({
      today_usd: 0, today_bs: 0, week_usd: 0, week_bs: 0, week_units: 0, week_count: 0,
      category_stats: [], top_models: [], product_count: 0, sale_count: 0,
      service_count: 0, client_count: 0,
      last_sale: null, last_service: null, last_movement: null, last_activity: null,
    })),

  getClients: (search: string = '') =>
    tauriInvoke<ClientSummary[]>('get_clients', { search }),

  addClient: (name: string, phone: string, email: string, notes: string) =>
    tauriInvoke<number>('add_client', { name, phone, email, notes }),

  addOrFindClient: (name: string, phone: string, ci: string = '', address: string = '') =>
    tauriInvoke<number>('add_or_find_client', { name, phone, ci, address }),

  findClientByCi: (ci: string) =>
    tauriInvoke<Client | null>('find_client_by_ci', { ci }).catch(() =>
      mock<Client | null>(null)),

  findClient: (name: string) =>
    tauriInvoke<number | null>('find_client', { name }),

  getClientServices: (clientId: number) =>
    tauriInvoke<Service[]>('get_client_services', { clientId }),

  getClientSales: (clientId: number) =>
    tauriInvoke<Sale[]>('get_client_sales', { clientId }),

  suggestClients: (query: string, limit: number = 10) =>
    tauriInvoke<Client[]>('suggest_clients', { query, limit }),

  addInventoryMovement: (productId: number, type_: string, quantity: number, reason: string, reference: string) =>
    tauriInvoke<void>('add_inventory_movement', { productId, type_, quantity, reason, reference }),

  getInventoryMovements: (days: number | null = null) =>
    tauriInvoke<InventoryMovement[]>('get_inventory_movements', { days }),

  importPriceList: (itemsJson: string) =>
    tauriInvoke<number>('import_price_list', { itemsJson }),

  exportData: () => tauriInvoke<string>('export_data'),
  importData: (jsonData: string, merge: boolean) => tauriInvoke<string>('import_data', { jsonData, merge }),

  getDailyTotals: (startDate: string, endDate: string) =>
    tauriInvoke<DailyTotals[]>('get_daily_totals', { startDate, endDate }),

  getDailyClosings: () => tauriInvoke<DailyClosing[]>('get_daily_closings'),

  getBcvRate: () => tauriInvoke<BCVRate>('get_bcv_rate'),

  openDay: (initialCashUsd: number = 0, tasaBcv: number = 0, tasaEur: number = 0) =>
    tauriInvoke<number>('open_day', { initialCashUsd, tasaBcv, tasaEur }),

  getActiveDay: () => tauriInvoke<DailyClosing | null>('get_active_day'),

  closeDay: (closeDate: string, notes: string = '', initialCashUsd: number = 0, tasaBcv: number = 0, tasaEur: number = 0,
             actualCashUsd: number = 0, actualCashBs: number = 0, actualPuntoUsd: number = 0, actualPuntoBs: number = 0,
             actualZelle: number = 0, actualPagoMovil: number = 0, actualTransferBs: number = 0) =>
    tauriInvoke<number>('close_day', {
      closeDate, notes, initialCashUsd, tasaBcv, tasaEur,
      actualCashUsd, actualCashBs, actualPuntoUsd, actualPuntoBs,
      actualZelle, actualPagoMovil, actualTransferBs
    }),

  reopenDay: (closeDate: string) =>
    tauriInvoke<void>('reopen_day', { closeDate }),

  updateDailyClosingSettlement: (id: number, posSettled: number) =>
    tauriInvoke<void>('update_daily_closing_settlement', { id, posSettled }),

  setPin: (pin: string) =>
    tauriInvoke<void>('set_pin', { pin }).catch(() =>
      mock<void>(undefined)),

  getPinStatus: () =>
    tauriInvoke<boolean>('get_pin_status').catch(() =>
      mock<boolean>(false)),

  verifyPin: (pin: string) =>
    tauriInvoke<boolean>('verify_pin', { pin }).catch(() =>
      mock<boolean>(true)),

  removePin: (pin: string) =>
    tauriInvoke<boolean>('remove_pin', { pin }).catch(() =>
      mock<boolean>(true)),

  getPagoMovilDetail: (date: string) =>
    tauriInvoke<PagoMovilDetail[]>('get_pago_movil_detail', { date }).catch(() =>
      mock<PagoMovilDetail[]>([])),

  exportDailyReport: (date: string) =>
    tauriInvoke<string>('export_daily_report', { date }).catch(() =>
      mock<string>('mock/report.csv')),
};
