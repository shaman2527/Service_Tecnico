import type {
  Category, Client, ClientSummary, Product, Sale, SaleStat, Service, ServicePayment,
  ServiceDashboard, InventoryMovement, PaymentMethod, ServiceStatus,
  DailyTotals, DailyClosing, BCVRate
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

export const api = {
  getCategories: () => tauriInvoke<Category[]>('get_categories').catch(() =>
    mock<Category[]>([{ id: 1, name: 'Pantalla', description: null }])),

  getPaymentMethods: () => tauriInvoke<PaymentMethod[]>('get_payment_methods').catch(() =>
    mock<PaymentMethod[]>([{ id: 1, name: 'Efectivo' }])),

  getServiceStatuses: () => tauriInvoke<ServiceStatus[]>('get_service_statuses').catch(() =>
    mock<ServiceStatus[]>([{ id: 1, name: 'Pendiente' }])),

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

  getServiceDashboard: () => tauriInvoke<ServiceDashboard>('get_service_dashboard').catch(() =>
    mock<ServiceDashboard>({
      total: 0, entregados: 0, pendientes: 0, total_ingresos: 0,
      method_stats: [], status_stats: []
    })),

  getClients: (search: string = '') =>
    tauriInvoke<ClientSummary[]>('get_clients', { search }),

  addClient: (name: string, phone: string, email: string, notes: string) =>
    tauriInvoke<number>('add_client', { name, phone, email, notes }),

  addOrFindClient: (name: string, phone: string) =>
    tauriInvoke<number>('add_or_find_client', { name, phone }),

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
};
