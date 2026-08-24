import type {
  Category, Client, ClientSummary, Product, Sale, SaleStat, Service, ServicePayment,
  ServiceDashboard, DashboardAnalytics, InventoryMovement, PaymentMethod, ServiceStatus,
  DailyTotals, DailyClosing, BCVRate, PurchaseOrder, PurchaseOrderItem, PagoMovilDetail,
  Technician, TechnicianStat, ComPort, PrinterSettings, UpdateState, HealthReport,
  ServiceDeviceInput, DaySummary, ExportResult, Expense, ProfitSummary,
  ReceivablesSummary, InventoryValue, PaymentSearchResult
} from './types';
import { DEFAULT_PRINTER_SETTINGS } from './types';

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
    stock: number, minStock: number, priceUsd: number = 0) =>
    tauriInvoke<number>('add_product', {
      name, categoryId, brand, model, variant, compatibility, priceCost, priceSale, stock, minStock, priceUsd
    }),

  updateProduct: (id: number, name: string, categoryId: number | null, brand: string, model: string,
    variant: string, compatibility: string, priceCost: number, priceSale: number,
    stock: number, minStock: number, priceUsd: number = 0) =>
    tauriInvoke<void>('update_product', {
      id, name, categoryId, brand, model, variant, compatibility, priceCost, priceSale, stock, minStock, priceUsd
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
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD', discountAmount: number = 0) =>
    tauriInvoke<void>('add_sale', {
      productId, productName, quantity, unitPrice, total, paymentMethod, clientName, clientId, notes,
      bankFeePercent, zelleReference, currency, discountAmount
    }),

  getSales: (search: string = '', days: number | null = null, startDate: string = '', endDate: string = '') =>
    tauriInvoke<Sale[]>('get_sales', { search, days, startDate, endDate }),

  getSalesStats: (days: number) => tauriInvoke<SaleStat[]>('get_sales_stats', { days }),

  addService: (orderNum: string, client: string, phone: string, model: string,
    fault: string, serviceType: string, serviceTypes: string = '', amount: number, paymentMethod: string, observations: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    clientCi: string = '', clientAddress: string = '', deviceChecklist: string = '',
    clientId: number | null = null, technician: string = '', technicianId: number | null = null, color: string = '',
    screenProductId: number | null = null, discountAmount: number = 0) =>
    tauriInvoke<number>('add_service', { orderNum, client, phone, model, fault, serviceType, serviceTypes, amount, paymentMethod, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, deviceChecklist, clientId, technician, technicianId, color, screenProductId, discountAmount }),

  addServiceOrder: (client: string, phone: string, clientCi: string, clientAddress: string,
    clientId: number | null, technician: string, technicianId: number | null,
    devices: ServiceDeviceInput[]) =>
    tauriInvoke<string>('add_service_order', { client, phone, clientCi, clientAddress, clientId, technician, technicianId, devices }),

  updateService: (id: number, client: string, phone: string, model: string, fault: string,
    serviceType: string, serviceTypes: string = '', amount: number, paymentMethod: string, dateOut: string, status: string, observations: string,
    bankFeePercent: number = 0, zelleReference: string = '', currency: string = 'USD',
    clientCi: string = '', clientAddress: string = '', deviceChecklist: string = '',
    technician: string = '', technicianId: number | null = null, color: string = '', screenProductId: number | null = null,
    discountAmount: number = 0) =>
    tauriInvoke<void>('update_service', { id, client, phone, model, fault, serviceType, serviceTypes, amount, paymentMethod, dateOut, status, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, deviceChecklist, technician, technicianId, color, screenProductId, discountAmount }),

  deleteService: (id: number) => tauriInvoke<void>('delete_service', { id }),

  markServicePrinted: (id: number) =>
    tauriInvoke<void>('mark_service_printed', { id }).catch(() =>
      mock<void>(undefined)),

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

  addServiceRefund: (serviceId: number, amount: number, paymentMethod: string,
    zelleReference: string = '', currency: string = 'USD', notes: string = '') =>
    tauriInvoke<number>('add_service_refund', { serviceId, amount, paymentMethod, zelleReference, currency, notes }),

  searchPayments: (startDate: string = '', endDate: string = '', method: string = '',
    client: string = '', reference: string = '', currency: string = '') =>
    tauriInvoke<PaymentSearchResult[]>('search_payments', { startDate, endDate, method, client, reference, currency }),

  getPaymentDailyDetail: (date: string, method: string = '') =>
    tauriInvoke<PaymentSearchResult[]>('get_payment_daily_detail', { date, method }),

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
      today_received: 0, today_delivered: 0,
      service_income_today_usd: 0, service_income_today_bs: 0,
    })),

  getDaySummary: (date: string) =>
    tauriInvoke<DaySummary>('get_day_summary', { date }).catch(() =>
      mock<DaySummary>({
        date, received: 0, delivered: 0, workshop: 0, payments_count: 0,
        payments_usd: 0, payments_bs: 0, sales_usd: 0, sales_bs: 0,
      })),

  addExpense: (expenseDate: string, category: string, amount: number, currency: string, notes: string) =>
    tauriInvoke<number>('add_expense', { expenseDate, category, amount, currency, notes }),

  getExpenses: (startDate: string, endDate: string) =>
    tauriInvoke<Expense[]>('get_expenses', { startDate, endDate }).catch(() => mock<Expense[]>([])),

  deleteExpense: (id: number) => tauriInvoke<void>('delete_expense', { id }),

  getProfitSummary: (startDate: string, endDate: string) =>
    tauriInvoke<ProfitSummary>('get_profit_summary', { startDate, endDate }).catch(() =>
      mock<ProfitSummary>({
        start: startDate, end: endDate, income_usd: 0, income_bs: 0, cost_usd: 0,
        profit_usd: 0, margin_pct: 0, sales_income_usd: 0, sales_income_bs: 0,
        sales_cost_usd: 0, services_income_usd: 0, services_income_bs: 0,
        services_cost_usd: 0, tasa_bcv: 0,
      })),

  getReceivables: () =>
    tauriInvoke<ReceivablesSummary>('get_receivables').catch(() =>
      mock<ReceivablesSummary>({ total_usd: 0, count: 0, buckets: [], items: [] })),

  getInventoryValue: () =>
    tauriInvoke<InventoryValue>('get_inventory_value').catch(() =>
      mock<InventoryValue>({ units: 0, cost_usd: 0, sale_usd: 0, categories: [] })),

  getClients: (search: string = '') =>
    tauriInvoke<ClientSummary[]>('get_clients', { search }),

  addClient: (name: string, phone: string, email: string, notes: string) =>
    tauriInvoke<number>('add_client', { name, phone, email, notes }),

  addOrFindClient: (name: string, phone: string, ci: string = '', address: string = '') =>
    tauriInvoke<number>('add_or_find_client', { name, phone, ci, address }),

  saveClient: (id: number | null, name: string, phone: string, ci: string, address: string, email: string, notes: string) =>
    tauriInvoke<number>('save_client', { id, name, phone, ci, address, email, notes }),

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

  getActiveDay: async () => {
    // Reintenta como getPinStatus (2026-08-04): el PRIMER invoke() de WebView2 en
    // arranque en frío puede rechazar; si el día tenía tasa y el bridge falla,
    // las conversiones en Bs daban 0 silenciosamente (catch(() => {}) en los dialogs).
    // Tras 3 intentos fallidos devuelve null (los callers ya lo manejan).
    if (!isTauri) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    for (let i = 0; i < 3; i++) {
      try {
        return await invoke<DailyClosing | null>('get_active_day');
      } catch (e) {
        if (i === 2) return null;
        await new Promise(r => setTimeout(r, 400));
      }
    }
    return null;
  },

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

  exportDailyReportXlsx: async (startDate: string, endDate: string) => {
    const raw = await tauriInvoke<string>('export_daily_report_xlsx', { startDate, endDate });
    try {
      return JSON.parse(raw) as ExportResult;
    } catch {
      return { ok: false, format: 'csv' as const, path: '', note: raw };
    }
  },

  // --- Impresora térmica (facturas de servicio por puerto COM) ---
  listComPorts: () =>
    tauriInvoke<ComPort[]>('list_com_ports').catch(() =>
      mock<ComPort[]>([{ name: 'COM3', description: 'Impresora térmica (simulada en browser mode)' }])),

  probeComPort: (port: string, baud: number) => {
    if (!isTauri) return mock<void>(undefined);
    // Tauri mode: propagar el error real (el frontend muestra "Sin respuesta").
    return tauriInvoke<void>('probe_com_port', { port, baud });
  },

  printReceipt: (port: string, baud: number, text: string, terms?: string, footer?: string, raster?: number[], rasterWidth?: number) => {
    if (!isTauri) return mock<void>(undefined);
    // Tauri mode: NUNCA tragar el error de impresión — si falla el envío, el
    // frontend debe saberlo para no marcar printed=1 (bug órdenes quemadas).
    return tauriInvoke<void>('print_receipt', { port, baud, text, terms, footer, raster, rasterWidth });
  },

  // --- Impresoras de Windows (spooler, driver instalado ej. HPRT MPT-II) ---
  listWindowsPrinters: () =>
    tauriInvoke<string[]>('list_windows_printers').catch(() =>
      mock<string[]>([])),

  printToWindowsPrinter: (printer: string, text: string, terms?: string, footer?: string, raster?: number[], rasterWidth?: number) => {
    if (!isTauri) return mock<void>(undefined);
    // Tauri mode: propagar el error (mismo motivo que printReceipt).
    return tauriInvoke<void>('print_to_windows_printer', { printer, text, terms, footer, raster, rasterWidth });
  },

  getPrinterSettings: () => {
    if (!isTauri) return mock<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
    // Tauri mode: propagar el error (la UI decide: defaults + auto-save bloqueado).
    return tauriInvoke<PrinterSettings>('get_printer_settings');
  },

  setPrinterSettings: (port: string, baud: number, width: number, windowsPrinter: string, businessName: string, businessLine: string, logo: string) => {
    if (!isTauri) return mock<void>(undefined);
    // Tauri mode: propagar el error — la selección de impresora DEBE persistir
    // (bug 2026-08-13: fallaba en silencio y la BD nunca se actualizaba).
    return tauriInvoke<void>('set_printer_settings', { port, baud, width, windowsPrinter, businessName, businessLine, logo });
  },

  getWindowsPrinterStatus: (printer: string) =>
    tauriInvoke<string>('get_windows_printer_status', { printer }).catch(() =>
      mock<string>('')),

  // --- Actualizaciones (respaldo / rollback / chequeo de salud) ---
  backupBeforeUpdate: (newVersion: string, previousVersion: string) =>
    tauriInvoke<void>('backup_before_update', { newVersion, previousVersion }).catch(() =>
      mock<void>(undefined)),

  runHealthCheck: () =>
    tauriInvoke<HealthReport>('run_health_check').catch(() =>
      Promise.reject(new Error('run_health_check no disponible'))),

  markUpdateOk: () => {
    if (!isTauri) return mock<void>(undefined);
    return tauriInvoke<void>('mark_update_ok');
  },

  // Limpia un estado "pending" colgado (update que nunca se aplicó) SIN tocar el
  // exe — rollback_update restauraría la versión anterior sobre la actual.
  markUpdateFailed: () => {
    if (!isTauri) return mock<void>(undefined);
    return tauriInvoke<void>('mark_update_failed');
  },

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
