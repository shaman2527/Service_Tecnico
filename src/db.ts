import type {
  Category, Client, ClientSummary, Product, Sale, SaleStat, Service, ServicePayment,
  ServiceDashboard, DashboardAnalytics, InventoryMovement, PaymentMethod, ServiceStatus,
  DailyTotals, DailyClosing, BCVRate, PurchaseOrder, PurchaseOrderItem, PagoMovilDetail,
  Technician, TechnicianStat, ComPort, PrinterSettings, UpdateState, HealthReport
} from './types';

export const isTauri = typeof window !== 'undefined' &&
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
    fault: string, serviceType: string, serviceTypes: string = '', amount: number, paymentMethod: string, observations: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    clientCi: string = '', clientAddress: string = '', deviceChecklist: string = '',
    clientId: number | null = null, technician: string = '', technicianId: number | null = null) =>
    tauriInvoke<number>('add_service', { orderNum, client, phone, model, fault, serviceType, serviceTypes, amount, paymentMethod, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, deviceChecklist, clientId, technician, technicianId }),

  updateService: (id: number, client: string, phone: string, model: string, fault: string,
    serviceType: string, serviceTypes: string = '', amount: number, paymentMethod: string, dateOut: string, status: string, observations: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    clientCi: string = '', clientAddress: string = '', deviceChecklist: string = '',
    technician: string = '', technicianId: number | null = null) =>
    tauriInvoke<void>('update_service', { id, client, phone, model, fault, serviceType, serviceTypes, amount, paymentMethod, dateOut, status, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, deviceChecklist, technician, technicianId }),

  deleteService: (id: number) => tauriInvoke<void>('delete_service', { id }),

  getServices: (search: string = '', status: string = '', startDate: string = '', endDate: string = '') =>
    tauriInvoke<Service[]>('get_services', { search, status, startDate, endDate }),

  getServicePayments: (serviceId: number) =>
    tauriInvoke<ServicePayment[]>('get_service_payments', { serviceId }),

  addServicePayment: (serviceId: number, amount: number, paymentMethod: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    notes: string = '') =>
    tauriInvoke<number>('add_service_payment', { serviceId, amount, paymentMethod, bankFeePercent, zelleReference, currency, notes }),

  deleteServicePayment: (id: number) =>
    tauriInvoke<void>('delete_service_payment', { id }),

  getTechnicians: () => tauriInvoke<Technician[]>('get_technicians'),
  getTechnicianStats: () => tauriInvoke<TechnicianStat[]>('get_technician_stats'),

  addTechnician: (name: string, initials: string, color: string) =>
    tauriInvoke<number>('add_technician', { name, initials, color }),

  updateTechnician: (id: number, name: string, initials: string, color: string) =>
    tauriInvoke<void>('update_technician', { id, name, initials, color }),

  deleteTechnician: (id: number) =>
    tauriInvoke<void>('delete_technician', { id }),

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
             actualZelle: number = 0, actualPagoMovil: number = 0, actualTransferBs: number = 0,
             posSettled: number = 0, posSettledBs: number = 0) =>
    tauriInvoke<number>('close_day', {
      closeDate, notes, initialCashUsd, tasaBcv, tasaEur,
      actualCashUsd, actualCashBs, actualPuntoUsd, actualPuntoBs,
      actualZelle, actualPagoMovil, actualTransferBs, posSettled, posSettledBs
    }),

  reopenDay: (closeDate: string) =>
    tauriInvoke<void>('reopen_day', { closeDate }),

  updateDailyClosingSettlement: (id: number, posSettled: number, posSettledBs: number = 0) =>
    tauriInvoke<void>('update_daily_closing_settlement', { id, posSettled, posSettledBs }),

  setPin: (pin: string) =>
    tauriInvoke<void>('set_pin', { pin }).catch(() =>
      mock<void>(undefined)),

  // FIX 2026-08-04: en arranque en frío el primer invoke() puede rechazar (WebView2
  // aún no completa el bridge) — el catch anterior resolvía false → la app ENTRABA
  // sin PIN (fail-open). Ahora: reintenta y si falla de verdad, rechaza (App.tsx
  // muestra el gate igual — fail-closed). En browser mode sigue mock(false).
  getPinStatus: () => {
    if (!isTauri) return mock<boolean>(false);
    const attempt = (n: number): Promise<boolean> =>
      tauriInvoke<boolean>('get_pin_status').catch(err => {
        if (n < 3) return new Promise(res => setTimeout(() => res(attempt(n + 1)), 400));
        return Promise.reject(err);
      });
    return attempt(0);
  },

  verifyPin: (pin: string) => {
    if (!isTauri) return mock<boolean>(true);
    const attempt = (n: number): Promise<boolean> =>
      tauriInvoke<boolean>('verify_pin', { pin }).catch(err => {
        if (n < 3) return new Promise(res => setTimeout(() => res(attempt(n + 1)), 400));
        return Promise.reject(err);
      });
    return attempt(0);
  },

  removePin: (pin: string) =>
    tauriInvoke<boolean>('remove_pin', { pin }).catch(() =>
      mock<boolean>(true)),

  getPagoMovilDetail: (date: string) =>
    tauriInvoke<PagoMovilDetail[]>('get_pago_movil_detail', { date }).catch(() =>
      mock<PagoMovilDetail[]>([])),

  exportDailyReport: (startDate: string, endDate: string) =>
    tauriInvoke<string>('export_daily_report', { startDate, endDate }).catch(() =>
      mock<string>('mock/report.csv')),

  // --- Impresora térmica (facturas de servicio por puerto COM) ---
  listComPorts: () =>
    tauriInvoke<ComPort[]>('list_com_ports').catch(() =>
      mock<ComPort[]>([{ name: 'COM3', description: 'Impresora térmica (simulada en browser mode)' }])),

  printReceipt: (port: string, baud: number, text: string) =>
    tauriInvoke<void>('print_receipt', { port, baud, text }).catch(() =>
      mock<void>(undefined)),

  getPrinterSettings: () =>
    tauriInvoke<PrinterSettings>('get_printer_settings').catch(() =>
      mock<PrinterSettings>({ port: '', baud: 9600, width: 58 })),

  setPrinterSettings: (port: string, baud: number, width: number) =>
    tauriInvoke<void>('set_printer_settings', { port, baud, width }).catch(() =>
      mock<void>(undefined)),

  // --- Actualizaciones (respaldo / rollback / chequeo de salud) ---
  backupBeforeUpdate: (newVersion: string, previousVersion: string) =>
    tauriInvoke<void>('backup_before_update', { newVersion, previousVersion }).catch(() =>
      mock<void>(undefined)),

  runHealthCheck: () =>
    tauriInvoke<HealthReport>('run_health_check').catch(() =>
      Promise.reject(new Error('run_health_check no disponible'))),

  markUpdateOk: () =>
    tauriInvoke<void>('mark_update_ok').catch(() => mock<void>(undefined)),

  getUpdateState: () =>
    tauriInvoke<UpdateState | null>('get_update_state').catch(() =>
      mock<UpdateState | null>(null)),

  rollbackUpdate: () =>
    tauriInvoke<void>('rollback_update').catch(() =>
      Promise.reject(new Error('No hay versión anterior guardada para restaurar.'))),

  hasPreviousVersion: () =>
    tauriInvoke<boolean>('has_previous_version').catch(() =>
      mock<boolean>(false)),
};
