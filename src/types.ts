export interface Category {
  id: number;
  name: string;
  description: string | null;
}

/**
 * F65 — Una categoría de producto vista desde «Ajustes»: además del nombre, cuánto la usa el
 * catálogo y si es una de las del PADRÓN DE TELÉFONOS (esas tres no se renombran ni se borran).
 */
export interface CategoryUsage {
  id: number;
  name: string;
  description: string | null;
  /** fichas de producto que la tienen puesta */
  products: number;
  /** unidades de stock sumadas de esas fichas */
  units: number;
  phone_padron: boolean;
}

/**
 * F65 — Resultado de crear una categoría: la categoría (nueva o la que YA existía) y si de verdad
 * se creó (si el nombre ya estaba, la UI elige esa y avisa en vez de crear una gemela).
 */
export interface CategoryOutcome {
  category: Category;
  created: boolean;
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
  address?: string | null;
  email?: string | null;
  notes?: string | null;
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
  /** Precio contado en efectivo (Divisas USD Cash) — descuento automático vs price_sale */
  price_usd: number;
  stock: number;
  min_stock: number;
  created_at: string | null;
  updated_at: string | null;
  category_name: string | null;
  /** Proveedor que trajo esta mercancía (lo anota la carga de inventario) */
  supplier?: string;
  /** F50: el local lo marcó como «lo uso» (lo que aparece al registrar un servicio). */
  in_use?: number;
  /** F50: código corto con el que el local lo dicta/busca (`P-0142`). */
  code?: string | null;
}

// --- F78: CARGA MASIVA DE INVENTARIO EN CSV ---

/**
 * Qué columnas traía el archivo. Es lo que distingue «celda vacía = no toques este campo» de
 * «poné 0»: viaja al backend al aplicar.
 */
export interface CsvColumns {
  name: boolean; category: boolean; brand: boolean; model: boolean; variant: boolean;
  compatibility: boolean; cost: boolean; sale: boolean; cash: boolean; stock: boolean;
  min_stock: boolean; supplier: boolean; code: boolean; in_use: boolean; id: boolean;
}

/** Los valores que la ficha del catálogo tiene HOY (para el diff de la pantalla de revisión). */
export interface CsvCurrent {
  id: number;
  name: string;
  category: string;
  category_id: number | null;
  brand: string;
  model: string;
  variant: string;
  /** el JSON crudo de la ficha (es lo que se conserva cuando la celda viene vacía) */
  compatibility: string;
  /** la compatibilidad como la lee una persona: es lo que se compara en el diff de la pantalla */
  compatibility_text: string;
  price_cost: number;
  price_sale: number;
  price_usd: number;
  stock: number;
  min_stock: number;
  supplier: string;
  code: string;
  in_use: number;
}

/** Qué se hace con una fila del archivo. */
export type CsvAction = 'crear' | 'actualizar' | 'dejar' | 'eliminar';

/** Una fila del archivo ya interpretada (es lo que el operario corrige en la vista previa). */
export interface CsvRow {
  line: number;
  name: string;
  category: string;
  category_id: number | null;
  category_new: boolean;
  brand: string;
  model: string;
  variant: string;
  compatibility: string;
  price_cost: number | null;
  price_sale: number | null;
  price_usd: number | null;
  stock: number | null;
  min_stock: number | null;
  supplier: string;
  code: string;
  in_use: number | null;
  product_id: number | null;
  current: CsvCurrent | null;
  action: CsvAction;
  excluded: boolean;
  name_clash: boolean;
  /** el código es de una ficha de OTRA categoría: bloquea hasta que el dueño decida */
  code_clash: boolean;
  clash_product_id: number | null;
  create_anyway: boolean;
  match_kind: string;
  shared: number;
  stock_after: number | null;
  issues: string[];
  notes: string[];
}

export interface CsvNewCategory {
  name: string;
  rows: number;
}

export interface CsvPreview {
  rows: CsvRow[];
  columns: CsvColumns;
  known: string[];
  ignored: string[];
  separator: string;
  total_rows: number;
  new_count: number;
  exists_count: number;
  new_categories: CsvNewCategory[];
  units_file: number;
  units_before: number;
  units_after: number;
  issues: string[];
  fatal: string | null;
}

export interface CsvApplyInput {
  rows: CsvRow[];
  columns: CsvColumns;
  supplier: string;
  file_name: string;
  new_categories: string[];
}

export interface CsvReport {
  created: number;
  updated: number;
  kept: number;
  deleted: number;
  categories_new: string[];
  units_added: number;
  movements: number;
  suppliered: number;
  skipped: number;
  backup: string;
}

// --- Inventario unificado (2026-09-15) ---

/** Página de productos: la tabla ya no trae las 1126 filas de golpe. */
export interface ProductPage {
  items: Product[];
  total: number;
}

export interface StockCount {
  name: string;
  sku: number;
  units: number;
}

/** KPIs del encabezado del módulo de inventario. */
export interface InventoryStats {
  sku: number;
  with_stock: number;
  out_of_stock: number;
  negative: number;
  low_stock: number;
  no_price: number;
  no_compat: number;
  brands: number;
  units: number;
  value_cost: number;
  value_sale: number;
  duplicate_groups: number;
  duplicate_ids: number[];
  by_category: StockCount[];
}

/** Teléfono del catálogo (lista maestra derivada de compatibility). */
export interface PhoneModelRow {
  label: string;
  brand: string;
  key: string;
  screens: number;
  stock: number;
  with_stock: number;
  /** F50: 1 = el local lo usa (es lo que ofrece el formulario de servicio por defecto). */
  in_use?: number;
  /** F50: código corto del modelo (`M-007`). */
  code?: string | null;
  /** F53 — pantalla de REFERENCIA del modelo: se auto-selecciona al registrar el servicio. */
  default_product_id?: number | null;
}

/** Candidata del desplegable "Pantalla a instalar" del servicio. */
export interface ScreenCandidate {
  product: Product;
  /** `exacta`/`prefijo`/`parcial` las calcula el backend; `buscada` = la eligió el operario a mano
   *  buscándola en el catálogo (F65c), porque no figuraba en la compatibilidad de ese modelo. */
  match_quality: 'exacta' | 'prefijo' | 'parcial' | 'buscada';
  in_stock: boolean;
  /** La compatibilidad del repuesto nombra la marca del teléfono (o el repuesto es de esa
   *  marca). `false` = solo coincidió el texto del modelo: se puede elegir a mano, pero el
   *  formulario NUNCA la elige solo. */
  brand_match: boolean;
  /** Se CONOCE la marca del teléfono (el padrón o el texto la dicen). Con `false` no hay
   *  certeza —modelo libre, o texto ambiguo entre marcas— y `brand_match: false` NO significa
   *  «es de otra marca»: la UI no avisa nada y el operario decide. */
  brand_known: boolean;
}

export interface MovementPage {
  items: InventoryMovement[];
  total: number;
}

// --- Padrón de teléfonos (F3: pestaña Modelos) ---

/** Índice de marcas del padrón (mismo patrón que el de productos). */
export interface PhoneBrandRow {
  brand: string;
  phones: number;
  with_products: number;
  with_stock: number;
  /** teléfonos sin familia comercial: hay que revisarlos (renombrar) */
  needs_review: number;
}

/** Un teléfono del padrón con sus repuestos y stock reales. */
export interface PhoneListRow {
  id: number;
  brand: string;
  line: string;
  model: string;
  name: string;
  /** clave interna del padrón (marca + modelo sin línea, normalizados); no se muestra */
  key: string;
  needs_review: boolean;
  aliases: string[];
  products: number;
  stock: number;
  categories: string;
  /** F50: 1 = el local lo usa (check del padrón) · código corto (`M-007`) · pantalla de referencia */
  in_use?: number;
  code?: string | null;
  default_product_id?: number | null;
  /** F53: nombre y código de la pantalla de referencia (para mostrarla sin otra consulta) */
  default_product_name?: string;
  default_product_code?: string;
  /** F52: variantes del modelo (chips de la vista «Por modelo»), en el orden canónico del taller */
  variants?: string[];
  /** F52: rango de precios de venta de sus repuestos (0/0 = ninguna ficha tiene precio) */
  price_min?: number;
  price_max?: number;
}

/** F53 — un TELÉFONO dentro de un grupo de repetidos (lo que muestra el asistente). */
export interface PhoneDuplicateRow {
  id: number;
  brand: string;
  name: string;
  code: string;
  in_use: number;
  /** cuántos repuestos le sirven (todos los del grupo comparten el MISMO conjunto) */
  repuestos: number;
  aliases: string[];
}

/** F53 — grupo de MODELOS que se sirven con los MISMOS repuestos: el asistente propone juntarlos. */
export interface PhoneDuplicateGroup {
  phones: PhoneDuplicateRow[];
}

/** F53 — Informe de «separar los modelos» (mismo formato para la vista previa y la aplicación). */export interface PhoneSplitPreview {
  phones_before: number;
  phones_after: number;
  /** teléfonos que APARECEN (los modelos que estaban pegados en una entrada compuesta) */
  created: string[];
  /** teléfonos que DEJAN de existir (el nombre combinado, «Samsung A70 A705») */
  removed: string[];
  updated: number;
  needs_review: number;
  /** variantes que estaban escritas en el TEXTO y pasaron al campo `variant` */
  variants_extracted: number;
  variant_samples: string[];
  backup?: string | null;
  /** true = es la revisión (no se escribió nada) */
  dry_run?: boolean;
}

/** F52 — Familia de variante con cuántas fichas (y stock) tiene en el catálogo. */
export interface VariantFamily {
  /** `incell` | `oled` | `original` | `am` | `''` (sin variante) */
  family: string;
  products: number;
  stock: number;
}

/** Lo que pasaría al renombrar un teléfono (vista previa: no escribe nada). */
export interface RenamePreview {
  name: string;
  brand: string;
  line: string;
  model: string;
  key: string;
  /** nombre del teléfono que YA tiene esa clave (para ofrecer fusionarlos) */
  clash: string | null;
  products: number;
  stock: number;
}

export interface PhonePage {
  items: PhoneListRow[];
  total: number;
}

/** Repuestos de un teléfono agrupados por categoría (Pantalla primero). */
export interface PhoneCategoryBlock {
  category_id: number;
  category: string;
  items: Product[];
}

export interface PhoneDetail {
  phone: PhoneListRow;
  blocks: PhoneCategoryBlock[];
}

/** Sentido del orden por columna: sin orden → asc → desc (3 estados). */
export type SortDir = 'asc' | 'desc';

// --- F25: asistente para cargar el inventario físico del local ---

/** Candidato del catálogo para una línea de la lista pegada. */
export interface LoadCandidate {
  product_id: number;
  product_name: string;
  category: string;
  stock: number;
  price_sale: number;
  /** exacta | prefijo | parcial */
  quality: string;
}

/** Una línea de la lista ya cruzada con el catálogo (editable en la vista previa). */
export interface LoadRow {
  raw: string;
  brand: string;
  model: string;
  qty: number;
  /** la cantidad no se pudo leer (o era absurda): la línea NO se aplica mientras siga así */
  qty_issue: boolean;
  product_id: number | null;
  product_name: string;
  stock_now: number;
  candidates: LoadCandidate[];
  /** otras líneas de la lista que caen en la misma ficha (sus unidades se suman) */
  shared: number;
  /** unidades que recibe la ficha sumando todas sus líneas */
  sum_qty: number;
  /** el operario dijo que esta línea NO se cargue (no es una línea sin resolver) */
  excluded?: boolean;
  /** proveedor que trajo esta pantalla (vacío = el proveedor general de la carga) */
  supplier?: string;
  issue: string | null;
}

export interface LoadPreview {
  rows: LoadRow[];
  lines: number;
  matched: number;
  unmatched: number;
  /** unidades que dice la lista */
  units: number;
  /** unidades que se van a cargar (sumando las líneas que comparten ficha) */
  applied_units: number;
  /** fichas distintas que se van a tocar */
  applied_products: number;
  /** fichas que quedan en 0 si se carga con «la lista es todo» */
  zero_count: number;
  zero_units: number;
  /** las mismas fichas con su stock: la UI recalcula el aviso contra las filas vivas */
  zero_ids: { product_id: number; stock: number }[];
  brands: number;
  skipped: number;
}

export interface LoadReport {
  updated: number;
  zeroed: number;
  movements: number;
  units: number;
  /** LÍNEAS que no se cargaron (otra categoría o ficha inexistente) */
  skipped: number;
  /** líneas de la lista que quedaron sin pantalla asignada (no se cargaron) */
  unassigned: number;
  /** unidades que se quedaron sin cargar por eso */
  unassigned_units: number;
  /** líneas que el operario excluyó a mano */
  excluded: number;
  excluded_units: number;
  /** fichas a las que se les anotó el proveedor */
  suppliered: number;
  backup: string;
}

/** Un producto dentro de un grupo de duplicados. */
export interface DuplicateItem {
  id: number;
  name: string;
  stock: number;
  price_sale: number;
  updated_at: string | null;
}

/** Grupo de productos repetidos (mismo teléfono en dos fichas). */
export interface DuplicateGroup {
  label: string;
  items: DuplicateItem[];
  stock_total: number;
}

/** Reporte de limpieza del catálogo (dry_run = solo cuenta). */
export interface CatalogSample {
  id: number;
  field: string;
  before: string;
  after: string;
}

export interface CatalogReport {
  dry_run: boolean;
  products: number;
  brands_fixed: number;
  models_fixed: number;
  models_split: number;
  names_fixed: number;
  compat_fixed: number;
  variants_fixed: number;
  phones_canonical: number;
  phone_labels_raw: number;
  duplicate_groups: number;
  duplicate_ids: number[];
  stock_units: number;
  search_fixed: number;
  backup: string | null;
  samples: CatalogSample[];
}

/** Reporte de restauración de precios desde la lista CELL WORLD. */
export interface PriceRestoreReport {
  dry_run: boolean;
  items: number;
  matched: number;
  updated: number;
  ambiguous: number;
  unmatched: number;
  already_priced: number;
  samples: { product_id: number; name: string; before_cost: number; before_sale: number; after_cost: number; after_sale: number }[];
  unmatched_samples: string[];
}

export interface Sale {  id: number;
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
  client_ci: string | null;
  /** Rebaja por pago en efectivo: total = cobrado real, precio de lista = total + discount_amount */
  discount_amount: number;
  /** F70 — ANULACIÓN: fecha/hora en que se anuló (null = la venta vale) y por qué. La venta nunca se
   *  borra: queda en la lista tachada, con su contra-asiento en el libro. */
  voided_at?: string | null;
  void_reason?: string | null;
  /** F74 — EL IVA de esta venta: alícuota (0 = sin IVA) y modo (`'agregado'` | `'incluido'` | `''`).
   *  `total` es SIEMPRE lo que pagó el cliente; base e IVA se despejan con la alícuota de la fila. */
  iva_rate?: number;
  iva_mode?: string | null;
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
  service_types: string | null;
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
  technician_id: number | null;
  technician: string | null;
  group_id: string | null;
  screen_product_id: number | null;
  color: string | null;
  printed: number;
  /** Rebaja por pago en efectivo: amount = cobrado real, precio de lista = amount + discount_amount */
  discount_amount: number;
  // F32 — señales de POLÍTICA del taller (recordatorios del operario). Las escribe SOLO
  // `setServicePolicy`: son anotaciones informativas, nunca bloquean nada.
  /** Foto de ENTRADA del equipo confirmada (fecha/hora local) — null = pendiente */
  photo_in_at: string | null;
  /** Foto de SALIDA del equipo confirmada (fecha/hora local) — null = pendiente */
  photo_out_at: string | null;
  /** Acuerdo de pago con el cliente: 'ahora' | 'al_retirar' | null (no se preguntó) */
  pay_intent: string | null;
  /** F74 — EL IVA de esta orden: alícuota (0 = sin IVA) y modo (`'agregado'` | `'incluido'` | `''`).
   *  `amount` es lo que paga el cliente (con IVA si el modo es «agregado»). */
  iva_rate: number;
  iva_mode: string;
}

export interface ServiceDeviceInput {
  model: string;
  fault: string;
  service_type: string;
  service_types: string;
  amount: number;
  payment_method: string;
  observations: string;
  bank_fee_percent: number;
  zelle_reference: string;
  currency: string;
  device_checklist: string;
  color: string;
  screen_product_id: number | null;
  discount_amount: number;
  /** F32: estado con el que NACE la orden (el wizard manda 'Recibido' por defecto) */
  status: string;
  /** F74 — IVA del equipo: alícuota (0 = sin IVA) y modo. `amount` es lo que paga el cliente. */
  iva_rate: number;
  iva_mode: string;
}

/** F74 — LA CONFIGURACIÓN DEL IVA tal como la devuelve/guarda el backend (`tax_config` en
 *  `settings`). `activo` la prende y la apaga; con el switch apagado no cambia ningún precio. */
export interface TaxConfig {
  activo: boolean;
  /** Alícuota en porcentaje (16 = 16%). */
  alicuota: number;
  /** `'incluido'` = el precio ya lo trae · `'agregado'` = se suma al cobrar. */
  modo: string;
}

export interface Technician {
  id: number;
  name: string;
  initials: string;
  color: string;
}

export interface TechnicianStat {
  technician_id: number | null;
  technician: string;
  initials: string;
  color: string;
  total: number;
  activos: number;
  entregados: number;
  ingresos: number;
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

export interface PaymentSearchResult {
  id: number;
  service_id: number;
  order_num: string | null;
  client: string | null;
  client_ci: string | null;
  model: string | null;
  amount: number;
  currency: string | null;
  payment_method: string | null;
  net_amount: number;
  zelle_reference: string | null;
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
  /** F42 — devuelto a clientes ese día, por moneda y en positivo (los totales por método ya vienen netos) */
  refund_usd: number;
  refund_bs: number;
}

export interface DailyClosing {
  id: number;
  close_date: string;
  pos_charged: number;
  pos_fees: number;
  pos_net: number;
  pos_settled: number;
  pos_settled_bs: number;
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
  /** F69 — ajuste del cajón usado al cerrar: fondo de caja − gastos pagados del cajón (USD) y
   *  − gastos pagados del cajón (Bs). Los cierres viejos vienen en 0 y se leen igual. */
  drawer_adjust_usd: number;
  drawer_adjust_bs: number;
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

export interface ExportResult {
  ok: boolean;
  format: 'xlsx' | 'csv';
  path: string;
  note: string;
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
  today_received: number;
  today_delivered: number;
  service_income_today_usd: number;
  service_income_today_bs: number;
}

export interface DaySummary {
  date: string;
  received: number;
  delivered: number;
  workshop: number;
  payments_count: number;
  payments_usd: number;
  payments_bs: number;
  sales_usd: number;
  sales_bs: number;
}

export interface Expense {
  id: number;
  expense_date: string;
  category: string;
  amount: number;
  currency: string;
  notes: string | null;
  /** F69 — de dónde salió la plata (`''` = sin declarar). Los métodos de cajón ajustan el arqueo. */
  method?: string | null;
}

/** F69 — lo que ajusta el arqueo del cajón ese día (lo lee `get_drawer_adjustments`). */
export interface DrawerAdjust {
  fondo_usd: number;
  gastos_usd: number;
  gastos_bs: number;
  /** Ya está restado en lo cobrado: se informa, no se resta otra vez. */
  devoluciones_usd: number;
  devoluciones_bs: number;
  sin_metodo: number;
}

export interface ProfitSummary {
  start: string;
  end: string;
  income_usd: number;
  income_bs: number;
  cost_usd: number;
  profit_usd: number;
  margin_pct: number;
  sales_income_usd: number;
  sales_income_bs: number;
  sales_cost_usd: number;
  services_income_usd: number;
  services_income_bs: number;
  services_cost_usd: number;
  tasa_bcv: number;
}

export interface ReceivableItem {
  order_num: string | null;
  client: string | null;
  model: string | null;
  saldo_usd: number;
  days_open: number;
}

export interface ReceivableBucket {
  label: string;
  count: number;
  total_usd: number;
}

export interface ReceivablesSummary {
  total_usd: number;
  count: number;
  buckets: ReceivableBucket[];
  items: ReceivableItem[];
}

export interface CategoryValue {
  category_name: string | null;
  units: number;
  cost_usd: number;
  sale_usd: number;
}

export interface InventoryValue {
  units: number;
  cost_usd: number;
  sale_usd: number;
  categories: CategoryValue[];
}

export const EXPENSE_CATEGORIES = ['Alquiler', 'Servicios', 'Salario', 'Retiro del dueño', 'Compra de repuestos', 'Otro'] as const;

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

export interface ComPort {
  name: string;
  description: string;
}

export interface PrinterSettings {
  port: string;
  baud: number;
  width: number;
  windowsPrinter: string;
  businessName: string;
  businessLine: string;
  /** Logo del ticket: data URL PNG ('' = sin logo). Se imprime en blanco y negro arriba de la cabecera. */
  logo: string;
}

/** Config por defecto de la impresora — fuente única compartida por db.ts (mock), PrinterSettingsDialog y PrintReceiptDialog. */
export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  port: '',
  baud: 9600,
  width: 58,
  windowsPrinter: '',
  businessName: 'SERVICIO TECNICO',
  businessLine: 'WILIAM SALGADO',
  logo: '',
};

export interface UpdateState {
  previous_version: string;
  new_version: string;
  status: 'pending' | 'ok' | 'rolled_back';
  installed_at: string;
}

export interface HealthReport {
  ok: boolean;
  issues: string[];
  /** Avisos NO críticos (ej. BCV sin internet) — no disparan rollback. */
  warnings: string[];
}

/** Resultado del respaldo previo a una actualización (F8; fail-closed desde 2026-09-18). */
export interface UpdateBackup {
  /** Copia de la base hecha ANTES de instalar (junto al exe, en `updates/`). */
  db_backup: string;
  /** Exe anterior guardado para poder volver atrás (`updates/prev/registro.exe`). */
  prev_exe: string;
  /** ¿Se pudo lanzar el vigilante? (proceso aparte que restaura la versión anterior si la nueva
   *  no arranca o no confirma su salud). Si es `false`, el respaldo existe pero nadie vela. */
  watchdog: boolean;
}

// --- Perfil del técnico (Dashboard) ---
export interface TechDayRow { date: string; received: number; delivered: number; usd: number }
export interface TechTypeRow { label: string; count: number; usd: number }
export interface TechServiceRow {
  id: number; order_num: string; date_in: string; date_out: string | null; client: string;
  model: string; status: string; types: string; amount: number; paid: number; saldo: number; currency: string;
}
export interface TechnicianProfile {
  technician_id: number | null; name: string; initials: string; color: string;
  start: string; end: string; days: TechDayRow[]; types: TechTypeRow[];
  services: number; delivered: number; active: number; finalized: number;
  income_usd: number; pending_usd: number; avg_per_day: number; items: TechServiceRow[];
}
// ─── F68 — SESIONES DE CAJA (Master / Caja) ─────────────────────────────────────────────────────

/** Una persona que puede entrar a la app (el PIN nunca viaja al frontend). */
export interface AppUser {
  id: number;
  name: string;
  role: 'master' | 'caja';
  color: string;
  active: boolean;
  has_pin: boolean;
}

/** Quién está usando la app ahora (lo devuelve el backend tras verificar SU PIN). */
export interface SessionUser {
  id: number;
  name: string;
  role: 'master' | 'caja';
}

/** Un movimiento del LIBRO DE PLATA (F68/F40): todo lo que entra o sale, con su AUTOR. */
export interface CashMovement {
  id: number;
  date: string;
  day: string;
  /** venta | abono | abono_anulado | devolucion | gasto | gasto_anulado | apertura | cierre | reapertura */
  type: string;
  method: string;
  currency: string;
  amount: number;
  /** +1 entra a la caja · −1 sale · 0 informativo (cierre/reapertura) */
  sign: number;
  reference: string;
  sale_id: number | null;
  service_id: number | null;
  payment_id: number | null;
  expense_id: number | null;
  user_id: number | null;
  user_name: string;
  note: string;
}

/** Resumen del libro por persona (sólo el Master). */
export interface CashMovementByUser {
  name: string;
  count: number;
  usd: number;
  bs: number;
}