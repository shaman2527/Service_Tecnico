import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity, BookOpen, CheckCircle2, Clock, CreditCard, Download, Landmark, Lock, Package,
  Play, Plus, PiggyBank, Receipt, RefreshCw, RotateCcw, DollarSign, TrendingUp, Smartphone,
  Banknote, Globe, ArrowRightLeft, Trash2, Wallet, Pencil, AlertTriangle, Search, X, Eye, Undo2, Users, Percent,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import MoneyInput from '@/components/ui/money-input';
import { api } from '../db';
import type { DailyTotals, DailyClosing, PagoMovilDetail, DaySummary, Expense, ProfitSummary, ReceivablesSummary, InventoryValue, PaymentSearchResult, DrawerAdjust } from '../types';
import { EXPENSE_CATEGORIES } from '../types';
import { localDate, addDays, cn } from '@/lib/utils';
// F68: el libro de plata (quién hizo cada movimiento) y el alta de personas (Master / Caja).
import UsuariosDialog from './UsuariosDialog';
import type { CashMovement, CashMovementByUser } from '../types';
// F39: el arqueo cuadra POR MONEDA (dos diferencias, dos semáforos). Regla pura con test node.
import { closingDifference, closingLabel, sinContar, puntoDifference, TOL_USD, TOL_BS } from '@/lib/cash-closing';
// F69: el desglose del cajón (fondo + gastos del cajón) y el conteo que NADIE da por hecho.
// Regla pura con test node (`tools/arqueo_test.ts`).
import {
  desgloseCajon, lineasDelArqueo, lineasSinConfirmar, faltaConfirmar, diferenciaLinea,
  valorParaCerrar, formatoMoneda, esDeCajon, AJUSTE_CERO,
  type AjusteCajon, type ClaveArqueo, type LineaArqueo,
} from '@/lib/drawer';
// F68/F69: qué puede hacer y qué ve cada sesión (una sola regla, probada en `tools/session_test.ts`).
import { abilities } from '@/lib/session';
// F72: las SECCIONES del libro (agrupadas en subcategorías) y las ACCIONES del dueño. Una sola
// definición de las dos cosas, con la visibilidad por rol, probada en `tools/ledger_nav_test.ts`.
import {
  ledgerNav, ledgerActions, ledgerTabGroup, ledgerTabLabel,
  type LedgerActionId, type LedgerTab,
} from '@/lib/ledger-nav';
// F74 — el IVA: la configuración (prender/apagar, alícuota, modo) y el libro del período.
import {
  parseIvaConfig, ivaActivo, ivaDeGrupos, alicuotaLabel, IVA_DEFAULT,
  type IvaConfig, type GrupoIva,
} from '@/lib/iva';
import TaxSettingsDialog from './TaxSettingsDialog';

// El signo va ANTES del símbolo de la moneda («-$2.00», «-Bs. 1.000,00»), que es como se escribe un
// descuadre en un libro: «$-2.00» se lee mal y en el arqueo la diferencia puede ser negativa.
const fmtUsd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const fmtBs = (n: number) => `${n < 0 ? '-' : ''}Bs.${Math.abs(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** F68 — cómo se llama cada tipo del libro de plata en pantalla. */
const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  venta: 'Venta',
  abono: 'Abono',
  abono_anulado: 'Cobro borrado',
  devolucion: 'Devolución',
  gasto: 'Gasto',
  gasto_anulado: 'Gasto borrado',
  apertura: 'Apertura',
  cierre: 'Cierre',
  reapertura: 'Día reabierto',
};

// Combina USD + Bs en un string, omitiendo la moneda sin movimientos: "$150.00 + Bs.34.310,00"
const fmtMix = (usd: number, bs: number) => {
  const parts: string[] = [];
  if (usd > 0.005) parts.push(fmtUsd(usd));
  if (bs > 0.005) parts.push(fmtBs(bs));
  return parts.join(' + ') || '$0.00';
};

// Desglose "$X + Bs. Y" omitiendo la moneda sin movimientos
function totalCell(usd: number, bs: number) {
  const parts: React.ReactNode[] = [];
  if (usd > 0.005) parts.push(<span className="text-success">{fmtUsd(usd)}</span>);
  if (bs > 0.005) parts.push(<span className="text-warning">{fmtBs(bs)}</span>);
  if (parts.length === 0) return <span className="text-muted-foreground">$0.00</span>;
  return parts.map((p, i) => <span key={i}>{i > 0 && ' + '}{p}</span>);
}

function MethodRow({ icon, label, detail, value, valueClass }: {
  icon: React.ReactNode; label: string; detail?: string; value: string; valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-background text-muted-foreground">
          {icon}
        </span>
        <div>
          <div className="text-sm font-medium leading-tight">{label}</div>
          {detail && <div className="text-[11px] text-muted-foreground leading-tight">{detail}</div>}
        </div>
      </div>
      <div className={`text-sm font-bold tabular-nums ${valueClass ?? ''}`}>{value}</div>
    </div>
  );
}

function Kpi({ icon, label, value, accent, className }: {
  icon: React.ReactNode; label: string; value: string; accent?: string; className?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <span className={`flex h-6 w-6 items-center justify-center rounded-md ${accent ?? 'bg-muted text-muted-foreground'}`}>
            {icon}
          </span>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-xl font-bold tabular-nums ${className ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/**
 * F69 — UN DÍA SIN MOVIMIENTOS EXISTE (y se puede cerrar).
 * `getDailyTotals` devuelve sólo los días que tienen ventas, abonos u órdenes entregadas: un día en el
 * que el taller únicamente RECIBIÓ equipos (o un feriado) llega como lista vacía. Eso NO es un error de
 * lectura — es un día en cero, y `close_day` lo cierra igual (usa ceros cuando no hay movimientos).
 */
const diaSinMovimientos = (fecha: string, tasa: number): DailyTotals => ({
  date: fecha, pos_charged: 0, pos_fees: 0, pos_net: 0, pos_charged_usd: 0, pos_charged_bs: 0,
  pos_net_usd: 0, pos_net_bs: 0, cash_usd: 0, cash_bs: 0, zelle_total: 0, pago_movil_total: 0,
  transfer_bs_total: 0, usd_cash_total: 0, grand_total: 0, grand_usd: 0, grand_bs: 0,
  tasa_bcv: tasa, refund_usd: 0, refund_bs: 0,
});

/**
 * F69 — UNA LÍNEA DEL ARQUEO, contada por un humano.
 *
 * Tres reglas que se ven en la pantalla: (1) mientras nadie la cuente dice **«Sin contar»** y NO da por
 * bueno el número del sistema (es el hallazgo A1: los digitales entraban con el esperado y su diferencia
 * daba 0 siempre); (2) al tocarla o pulsar «Es el esperado» queda confirmada; (3) la diferencia se juzga
 * en la moneda de ESA línea, con su tolerancia (`diferenciaLinea`).
 */
function ConteoLinea({ linea, contado, confirmada, onContado, onConfirmar }: {
  linea: LineaArqueo;
  contado: number;
  confirmada: boolean;
  onContado: (v: number) => void;
  onConfirmar: () => void;
}) {
  const d = diferenciaLinea(linea, confirmada ? contado : null);
  const tono = d.estado === 'sin_contar' ? 'text-muted-foreground'
    : d.ok ? 'text-success' : 'text-danger';
  return (
    <div className="flex flex-col gap-2" data-arqueo={linea.clave} data-estado={d.estado}>
      <label className="text-sm font-medium">
        {linea.etiqueta}
        {!linea.enCajon && <span className="ml-1 text-xs text-muted-foreground">(se verifica en el banco)</span>}
      </label>
      <div className="flex items-center gap-2">
        <MoneyInput value={contado} onChange={onContado} className="text-lg font-semibold" placeholder="0,00" />
        {!confirmada && (
          <Button type="button" variant="outline" size="sm" data-action="usar-esperado" onClick={onConfirmar}
            title={`El sistema espera ${formatoMoneda(linea.monto, linea.moneda)} — confirmá que es lo que contaste/verificaste`}>
            Es el esperado
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          Esperado: <strong className="tabular-nums">{formatoMoneda(linea.monto, linea.moneda)}</strong>
        </span>
        {/* `dif-linea-*` = la diferencia de ESTA línea. La del resumen del arqueo es `dif-usd`/`dif-bs`
            (y NO se dibuja mientras falte contar: un número sin contar no es un número). */}
        <span className={`font-bold ${tono}`} data-field={`dif-linea-${linea.clave}`} data-ok={d.ok}>
          {d.estado === 'sin_contar' ? d.texto : `${d.ok ? '' : (d.dif > 0 ? '+' : '')}${d.texto}`}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">{linea.detalle}</p>
    </div>
  );
}

const PAYMENT_METHODS = [
  '', 'Pago Móvil', 'Efectivo Bs', 'Divisas (USD Cash)', 'Punto de Venta ($)',
  'Punto de Venta (Bs)', 'Transferencia Zelle', 'Transferencia Bs',
];

// F72 — los iconos de las SECCIONES y de las ACCIONES del encabezado. Viven acá (y no en la regla
// pura) porque son presentación: `ledger-nav.ts` define qué se ve, esto cómo se ve.
const ICONO_TAB: Record<LedgerTab, ReactNode> = {
  diario: <BookOpen className="size-4" />,
  cierres: <Lock className="size-4" />,
  pagos: <CreditCard className="size-4" />,
  gastos: <Receipt className="size-4" />,
  movimientos: <ArrowRightLeft className="size-4" />,
  salud: <Activity className="size-4" />,
};
const ICONO_ACCION: Record<LedgerActionId, ReactNode> = {
  exportar: <Download className="size-4" />,
  pin: <Lock className="size-4" />,
  iva: <Percent className="size-4" />,
  personas: <Users className="size-4" />,
};

export default function DailyLedger({ role = 'owner' }: { role?: 'owner' | 'cashier' }) {
  const isOwner = role === 'owner';
  // F69 — LAS CAPACIDADES DE LA SESIÓN salen de la regla pura (`src/lib/session.ts`), no de un
  // `isOwner` repartido por el archivo: es la única implementación de «qué ve y qué toca cada rol» y
  // está probada sin navegador (`tools/session_test.ts`). El backend tiene su propio gate
  // (`require_owner`): esto es para que la pantalla NO ofrezca lo que el backend va a rechazar.
  const ab = abilities(isOwner ? 'master' : 'caja');
  // Fecha LOCAL del local (ver `localDate`): con toISOString() el «hoy» del Libro Diario pasaba
  // al día siguiente después de las 20:00 en Venezuela y el día aparecía sin movimientos.
  const today = localDate();
  const [tab, setTab] = useState<'diario' | 'cierres' | 'pagos' | 'gastos' | 'salud' | 'movimientos'>('diario');
  const [startDate, setStartDate] = useState(() => addDays(today, -30));
  const [endDate, setEndDate] = useState(() => localDate());
  const [totals, setTotals] = useState<DailyTotals[]>([]);
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [activeDay, setActiveDay] = useState<DailyClosing | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  const [openInitial, setOpenInitial] = useState(0);
  const [openTasaUsd, setOpenTasaUsd] = useState(0);
  const [openTasaEur, setOpenTasaEur] = useState(0);
  const [openError, setOpenError] = useState<string | null>(null);
  const [bcvError, setBcvError] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [expected, setExpected] = useState<DailyTotals | null>(null);
  const [cashCounted, setCashCounted] = useState(0);
  /** F39: DIVISAS CONTADAS. Antes el cierre mandaba `actual_cash_usd = esperado` (una copia del propio
   *  sistema, no un conteo): la «Diferencia $» daba 0 SIEMPRE y el semáforo era decorativo — si faltaban
   *  dólares del cajón nadie se enteraba. Ahora se cuenta como los bolívares. */
  const [usdCounted, setUsdCounted] = useState(0);
  /** F69 — QUÉ LÍNEA DEL ARQUEO YA CONTÓ/VERIFICÓ UN HUMANO. Es la segunda mitad del hallazgo A1: los
   *  cobros digitales entraban al cierre con el monto del sistema, así que su diferencia daba 0 siempre.
   *  Acá nada entra «porque el sistema lo dice»: cada línea con algo que verificar tiene que quedar
   *  confirmada (contada a mano o verificada en el banco) antes de poder cerrar el día. */
  const [confirmadas, setConfirmadas] = useState<Partial<Record<ClaveArqueo, boolean>>>({});
  /** F69 — lo que ajusta el cajón ese día (fondo de caja + gastos/retiros del cajón, del libro). */
  const [drawerAdjust, setDrawerAdjust] = useState<DrawerAdjust | null>(null);
  /** F69 — el diálogo de cierre se abre recién cuando los datos del día están leídos. */
  const [cargandoCierre, setCargandoCierre] = useState(false);
  /** F69 — lo VERIFICADO en el banco para cada cobro digital. Arranca en el esperado para poder
   *  compararlo, pero no entra al cierre hasta que el operario lo confirme (el bug era justamente que
   *  se mandaba el esperado sin que nadie mirara el banco). */
  const [zelleVerified, setZelleVerified] = useState(0);
  const [pmVerified, setPmVerified] = useState(0);
  const [transVerified, setTransVerified] = useState(0);
  const [pagoMovilList, setPagoMovilList] = useState<PagoMovilDetail[]>([]);
  const [closeNotes, setCloseNotes] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [showSettle, setShowSettle] = useState<DailyClosing | null>(null);
  const [settleAmount, setSettleAmount] = useState(0);
  const [settleAmountBs, setSettleAmountBs] = useState(0);
  const [settleChargedUsd, setSettleChargedUsd] = useState(0);
  const [settleChargedBs, setSettleChargedBs] = useState(0);
  const [posSettledUsd, setPosSettledUsd] = useState(0);
  const [posSettledBs, setPosSettledBs] = useState(0);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinStatus, setPinStatus] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinNew, setPinNew] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  // F68 — personas y accesos (sólo Master) y el LIBRO DE PLATA del período.
  const [showUsuarios, setShowUsuarios] = useState(false);
  // F74 — EL IVA: la configuración vigente (la lee cualquiera, la escribe el dueño con el diálogo) y
  // el libro del período (operaciones agrupadas por alícuota, para declarar).
  const [taxConfig, setTaxConfig] = useState<IvaConfig>(IVA_DEFAULT);
  const [showTax, setShowTax] = useState(false);
  const [ivaGrupos, setIvaGrupos] = useState<GrupoIva[]>([]);
  const [movimientos, setMovimientos] = useState<CashMovement[]>([]);
  const [porPersona, setPorPersona] = useState<CashMovementByUser[]>([]);
  const [lastTasa, setLastTasa] = useState(0);
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
  // Salud del negocio: gastos, utilidad, por cobrar, inventario
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [todayExpenses, setTodayExpenses] = useState<Expense[]>([]);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [prevProfit, setPrevProfit] = useState<ProfitSummary | null>(null);
  const [receivables, setReceivables] = useState<ReceivablesSummary | null>(null);
  const [inventoryValue, setInventoryValue] = useState<InventoryValue | null>(null);
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expDate, setExpDate] = useState(today);
  const [expCategory, setExpCategory] = useState<string>('Otro');
  const [expAmount, setExpAmount] = useState(0);
  const [expCurrency, setExpCurrency] = useState('USD');
  // F69 — de dónde salió la plata del gasto ('' = sin declarar). Es lo que ajusta el arqueo del cajón.
  const [expMethod, setExpMethod] = useState('');
  const [expNotes, setExpNotes] = useState('');
  const [expError, setExpError] = useState<string | null>(null);
  const [expWarning, setExpWarning] = useState<string | null>(null);
  const [expenseMsg, setExpenseMsg] = useState<string | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  // Pestaña Pagos: búsqueda y drill-down
  const [payMethodFilter, setPayMethodFilter] = useState('');
  const [payClientFilter, setPayClientFilter] = useState('');
  const [payRefFilter, setPayRefFilter] = useState('');
  const [payCurrencyFilter, setPayCurrencyFilter] = useState('');
  const [payResults, setPayResults] = useState<PaymentSearchResult[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const [drillMethod, setDrillMethod] = useState<string>('');
  const [drillResults, setDrillResults] = useState<PaymentSearchResult[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // F68: la caja ve SU día (y SU libro de movimientos) — no los históricos ni los números del dueño.
  const effectiveTab = isOwner ? tab : (tab === 'movimientos' ? 'movimientos' : 'diario');
  const effectiveStart = isOwner ? startDate : today;
  const effectiveEnd = isOwner ? endDate : today;

  const loadTotals = async () => {
    setTotals(await api.getDailyTotals(effectiveStart, effectiveEnd));
  };

  const loadClosings = async () => {
    setClosings(await api.getDailyClosings());
  };

  const loadExpenses = async () => {
    try { setExpenses(await api.getExpenses(effectiveStart, effectiveEnd)); } catch { setExpenses([]); }
  };

  /** Los gastos de HOY (los usa la pestaña Gastos y el aviso al registrar uno). */
  const loadTodayExpenses = async () => {
    try { setTodayExpenses(await api.getExpenses(today, today)); } catch { setTodayExpenses([]); }
  };

  /** F69 — el ajuste del cajón del día que se está cerrando (fondo + gastos/retiros del cajón). */
  const loadDrawerAdjust = async (date: string = today) => {
    try { setDrawerAdjust(await api.getDrawerAdjustments(date)); } catch { setDrawerAdjust(null); }
  };

  /** F69 — los gastos DEL DÍA QUE SE CIERRA (no los de hoy: con ↺ se puede cerrar un turno viejo). */
  const loadExpensesDe = async (date: string) => {
    try { setTodayExpenses(await api.getExpenses(date, date)); } catch { setTodayExpenses([]); }
  };

  const loadProfit = async () => {
    try {
      const cur = await api.getProfitSummary(effectiveStart, effectiveEnd);
      // Período anterior del MISMO largo (para el comparativo %)
      const spanDays = Math.max(1, Math.round((Date.parse(effectiveEnd) - Date.parse(effectiveStart)) / 86400000) + 1);
      const prevEnd = addDays(effectiveStart, -1);
      const prevStart = addDays(prevEnd, -(spanDays - 1));
      const prev = await api.getProfitSummary(prevStart, prevEnd);
      setProfit(cur);
      setPrevProfit(prev);
    } catch { setProfit(null); setPrevProfit(null); }
  };

  const loadSalud = async () => {
    await loadProfit();
    try { setReceivables(await api.getReceivables()); } catch { setReceivables(null); }
    try { setInventoryValue(await api.getInventoryValue()); } catch { setInventoryValue(null); }
  };

  /**
   * F69 — un gasto pagado DEL CAJÓN tiene que declarar de dónde salió la plata: es lo que decide si
   * baja el esperado del cajón al cerrar el día. Si el operario no lo declara, se guarda igual (un
   * gasto anotado es mejor que un gasto perdido, y el backend nunca inventa de qué cajón salió) pero
   * se AVISA que el cierre no lo va a descontar.
   */
  const doAddExpense = async () => {
    setExpError(null);
    setExpWarning(null);
    if (expAmount <= 0) { setExpError('El monto debe ser mayor que 0.'); return; }
    try {
      await api.addExpense(expDate, expCategory, expAmount, expCurrency, expNotes, expMethod);
      setShowExpenseDialog(false);
      setExpAmount(0); setExpNotes(''); setExpMethod('');
      // F69 (revisión adversarial) — el aviso dice la VERDAD del método elegido: sólo los métodos de
      // cajón (`Divisas (USD Cash)` / `Efectivo Bs`) bajan el efectivo esperado; los digitales se
      // concilian por banco. Antes, cualquier método declarado decía «sale del cajón».
      setExpenseMsg(esDeCajon(expMethod)
        ? `Gasto registrado. Sale del cajón (${expMethod}): el cierre del ${expDate} lo va a descontar del efectivo esperado.`
        : expMethod
          ? `Gasto registrado con ${expMethod}: NO baja el cajón, se concilia por banco.`
          : `Gasto registrado sin declarar de dónde salió: el cierre del día NO lo va a descontar del cajón.`);
      loadExpenses(); loadTodayExpenses(); loadDrawerAdjust();
      setTimeout(() => setExpenseMsg(null), 6000);
    } catch (e) {
      setExpError(e instanceof Error ? e.message : String(e));
    }
  };

  const doDeleteExpense = async (id: number) => {
    try {
      await api.deleteExpense(id);
      loadExpenses(); loadTodayExpenses();
    } catch (e) {
      setExpenseMsg(e instanceof Error ? e.message : String(e));
      setTimeout(() => setExpenseMsg(null), 4000);
    }
  };

  const refreshActiveDay = async () => {
    try {
      setActiveDay(await api.getActiveDay());
    } catch {
      setActiveDay(null);
    }
    try {
      setDaySummary(await api.getDaySummary(today));
    } catch {
      setDaySummary(null);
    }
  };

  // F74 — LA CONFIGURACIÓN DEL IVA se lee una vez al montar (y al guardarla el diálogo). La lee
  // cualquiera: la caja necesita saber si hay IVA para desglosar lo que cobra.
  const loadTaxConfig = async () => {
    try { setTaxConfig(parseIvaConfig(await api.getTaxConfig())); } catch { setTaxConfig(IVA_DEFAULT); }
  };
  /** F74 — el libro de IVA del período: operaciones agrupadas por alícuota (sólo el dueño). */
  const loadIva = async () => {
    if (!isOwner) { setIvaGrupos([]); return; }
    try { setIvaGrupos(await api.getIvaGroups(startDate, endDate)); } catch { setIvaGrupos([]); }
  };

  useEffect(() => { loadTaxConfig(); }, []);
  useEffect(() => { if (tab === 'diario') loadIva(); }, [tab, startDate, endDate, isOwner]);
  useEffect(() => { if (tab === 'diario') loadTotals(); }, [tab, startDate, endDate, isOwner]);
  useEffect(() => { if (tab === 'cierres') loadClosings(); }, [tab]);
  // F69: el encabezado necesita saber si HOY ya se cerró (para no ofrecer «Abrir Día» sobre un día
  // cerrado, que el backend rechaza). Es una consulta chica y se refresca con las otras cargas.
  useEffect(() => { loadClosings(); }, [activeDay]);
  useEffect(() => { if (tab === 'gastos') loadExpenses(); }, [tab, startDate, endDate]);
  useEffect(() => { if (tab === 'salud') loadSalud(); }, [tab, startDate, endDate]);

  /**
   * F68 — el LIBRO DE PLATA del rango. El backend ya limita lo que devuelve según la sesión: una
   * CAJA sólo recibe SUS movimientos (es lo que pidió el dueño: «que vea su día de caja pero no
   * cuánto factura la master»), así que esta pantalla sirve para los dos roles sin filtrar acá.
   * El resumen por persona es del Master (la caja no ve lo que movió el dueño).
   */
  useEffect(() => {
    if (tab !== 'movimientos') return;
    let alive = true;
    api.getCashMovements(isOwner ? startDate : today, isOwner ? endDate : today)
      .then(m => { if (alive) setMovimientos(m); })
      .catch(() => { if (alive) setMovimientos([]); });
    if (isOwner) {
      api.getCashMovementsByUser(startDate, endDate)
        .then(p => { if (alive) setPorPersona(p); })
        .catch(() => { if (alive) setPorPersona([]); });
    } else {
      setPorPersona([]);
    }
    return () => { alive = false; };
  }, [tab, startDate, endDate, isOwner, today]);

  const loadPayments = async () => {
    setPayLoading(true);
    try {
      const results = await api.searchPayments(startDate, endDate, payMethodFilter, payClientFilter, payRefFilter, payCurrencyFilter);
      setPayResults(results);
    } catch {
      setPayResults([]);
    }
    setPayLoading(false);
  };
  useEffect(() => { if (tab === 'pagos') loadPayments(); }, [tab, startDate, endDate, payMethodFilter, payClientFilter, payRefFilter, payCurrencyFilter]);
  useEffect(() => { refreshActiveDay(); }, []);
  // Al volver a la ventana (tras facturar/registrar) la tabla diaria se recarga sola
  useEffect(() => {
    const onFocus = () => { if (tab === 'diario') loadTotals(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tab, effectiveStart, effectiveEnd]);
  // Última tasa BCV registrada (para el hint del dialog de apertura)
  useEffect(() => {
    api.getDailyClosings().then(cs => {
      const c = cs.find(x => x.tasa_bcv > 0);
      if (c) setLastTasa(c.tasa_bcv);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    api.getPinStatus().then(setPinStatus).catch(() => setPinStatus(false));
  }, []);

  const openDrillDown = async (date: string, method: string) => {
    setDrillDate(date);
    setDrillMethod(method);
    setDrillLoading(true);
    setDrillResults([]);
    try {
      const results = await api.getPaymentDailyDetail(date, method);
      setDrillResults(results);
    } catch {
      setDrillResults([]);
    }
    setDrillLoading(false);
  };

  const openOpenDialog = (prefill: boolean) => {
    setShowOpen(true);
    setOpenInitial(prefill && activeDay ? activeDay.initial_cash_usd : 0);
    setOpenTasaUsd(prefill && activeDay ? activeDay.tasa_bcv : 0);
    setOpenTasaEur(prefill && activeDay ? activeDay.tasa_eur : 0);
    setOpenError(null);
    setBcvError(false);
  };

  const doOpen = async () => {
    setOpenError(null);
    try {
      await api.openDay(openInitial, openTasaUsd, openTasaEur);
      setShowOpen(false);
      setBcvError(false);
      refreshActiveDay();
      loadClosings();
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  };

  const autoBcv = async () => {
    setBcvError(false);
    try {
      const rate = await api.getBcvRate();
      setOpenTasaUsd(rate.usd);
      setOpenTasaEur(rate.eur);
    } catch {
      setBcvError(true);
    }
  };

  const openCloseDialog = async () => {
    if (!activeDay) return;
    await abrirCierreDe(activeDay);
  };

  /** Día que se está cerrando en el diálogo. Normalmente es el turno abierto, pero F35 permite
   *  cerrar TAMBIÉN un día que quedó abierto de antes (por ejemplo uno que se reabrió con ↺ para
   *  anotar un pago cobrado ese día): con dos turnos abiertos, el único «Cerrar Día» apuntaba al más
   *  reciente y ese día quedaba sin arqueo para siempre. `close_day` ya acepta cualquier fecha. */
  const [cierreRow, setCierreRow] = useState<DailyClosing | null>(null);

  const abrirCierreDe = async (row: DailyClosing | null) => {
    if (!row || cargandoCierre) return;
    setCierreRow(row);
    setCloseNotes('');
    setCloseError(null);
    setPagoMovilList([]);
    // F69 — NINGUNA línea nace confirmada: el cajón se cuenta y el banco se verifica. Los campos
    // arrancan con el número del sistema (para tener contra qué comparar y poder corregirlo) pero
    // «sin contar» hasta que el operario los toque o pulse «Es el esperado».
    setConfirmadas({});
    setTodayExpenses([]);
    // F69 — EL DIÁLOGO SE ABRE CON LOS DATOS YA LEÍDOS. Antes se abría primero y se llenaba después:
    // durante ese instante mostraba el desglose en $0.00 (y el aviso rojo de «no se pudieron leer los
    // totales»), o sea que el número que decide el arqueo aparecía mintiendo mientras cargaba.
    setCargandoCierre(true);
    try {
      const [dayTotals, pms, adj] = await Promise.all([
        api.getDailyTotals(row.close_date, row.close_date),
        api.getPagoMovilDetail(row.close_date).catch(() => [] as PagoMovilDetail[]),
        api.getDrawerAdjustments(row.close_date),
      ]);
      // F69 (revisión adversarial, BLOQUEANTE) — UN DÍA SIN MOVIMIENTOS EXISTE. `getDailyTotals`
      // arma los días con las VENTAS, los ABONOS y las órdenes ENTREGADAS: un día en el que el taller
      // sólo recibió equipos (o un feriado) devuelve una lista VACÍA. Antes `dayTotals[0] ?? null`
      // dejaba `expected = null`, así que el botón quedaba apagado con el aviso rojo de «no se
      // pudieron leer los totales»… y el BACKEND sí sabe cerrarlo (`close_day` usa ceros cuando el día
      // no tiene movimientos): el turno quedaba abierto para siempre y no se podía abrir el siguiente.
      // Ceros = «no hubo movimientos», `null` = no se pudo leer (eso sí bloquea).
      const t = dayTotals[0] ?? diaSinMovimientos(row.close_date, row.tasa_bcv);
      setExpected(t);
      setDrawerAdjust(adj);
      if (!adj) {
        // El ajuste del cajón (fondo y gastos) no se pudo leer: cerrar ahora guardaría un esperado
        // distinto del que el operario contó (invariante: un cierre guardado no se recalcula).
        setCloseError('No se pudo leer el fondo/gastos del cajón: reintentá abrir el cierre (no se guardó nada).');
      }
      // F69 (revisión adversarial) — LO CONTADO ARRANCA EN EL ESPERADO DE VERDAD. Antes se precargaba
      // sólo lo COBRADO (`usd_cash_total + cash_usd`), sin el fondo ni los gastos del cajón: con fondo
      // $50 y un gasto de $20 el campo decía 100,00 mientras la línea decía «Esperado: $130.00», y el
      // operario que escribía encima guardaba un conteo equivocado. El desglose se calcula acá para
      // que el número del campo y el del rótulo sean el mismo.
      const desgloseInicial = desgloseCajon({
        cash_usd: t.cash_usd ?? 0, usd_cash_total: t.usd_cash_total ?? 0, cash_bs: t.cash_bs ?? 0,
        zelle_total: t.zelle_total ?? 0, pago_movil_total: t.pago_movil_total ?? 0,
        transfer_bs_total: t.transfer_bs_total ?? 0, pos_charged_usd: t.pos_charged_usd ?? 0,
        pos_charged_bs: t.pos_charged_bs ?? 0,
      }, adj ?? AJUSTE_CERO);
      setCashCounted(desgloseInicial.esperado_bs);
      setUsdCounted(desgloseInicial.esperado_usd);
      // Monto impreso del Punto: prellenado con lo que el sistema espera (regla: debe dar el mismo)
      setPosSettledUsd(t.pos_charged_usd ?? 0);
      setPosSettledBs(t.pos_charged_bs ?? 0);
      setPagoMovilList(pms);
      // Lo verificado en el banco arranca en lo que el sistema espera (para comparar), SIN confirmar.
      setZelleVerified(t.zelle_total ?? 0);
      setPmVerified(t.pago_movil_total ?? 0);
      setTransVerified(t.transfer_bs_total ?? 0);
      // Los gastos del día que se está cerrando (no los de hoy: F35 permite cerrar un turno viejo).
      loadExpensesDe(row.close_date);
    } catch {
      setExpected(null);
      setDrawerAdjust(null);
      setCashCounted(0);
      setUsdCounted(0);
      setPosSettledUsd(0);
      setPosSettledBs(0);
      setZelleVerified(0);
      setPmVerified(0);
      setTransVerified(0);
    } finally {
      setCargandoCierre(false);
      setShowClose(true);
    }
  };

  const doClose = async () => {
    if (!cierreRow) return;
    // No se cierra un día cuyos totales no se pudieron leer: el cierre guardaría el arqueo en 0 y
    // quedaría como «falta todo el cajón» para siempre (revisión adversarial F39).
    if (!expected) {
      setCloseError('No se pudieron leer los totales del día: reintentá abrir el cierre (no se guardó nada).');
      return;
    }
    // F69 — NO SE CIERRA SIN CONTAR: cada moneda del cajón y cada cobro digital que hubo ese día tiene
    // que estar confirmado por el operario (contado a mano o verificado en el banco). Antes el diálogo
    // mandaba el monto del sistema para Zelle/Pago Móvil/Transferencia, así que su diferencia daba 0
    // SIEMPRE y nadie miraba el banco (hallazgo A1 de la auditoría de entrega).
    const faltan = lineasSinConfirmar(lineasArqueo, confirmadas);
    if (faltan.length > 0) {
      setCloseError(faltaConfirmar(faltan));
      return;
    }
    setCloseError(null);
    try {
      await api.closeDay(
        cierreRow.close_date, closeNotes,
        cierreRow.initial_cash_usd, cierreRow.tasa_bcv, cierreRow.tasa_eur,
        usdCounted, cashCounted,
        // El Punto: el monto IMPRESO verificado (antes se mandaba el «cargado esperado» como si fuera
        // un conteo — un número que nadie había mirado).
        posSettledUsd, posSettledBs,
        // Lo verificado en el banco, NO el esperado: si el operario vio otra cosa, la diferencia se ve.
        valorParaCerrar(lineaArqueo('zelle'), confirmadas.zelle ? zelleVerified : null),
        valorParaCerrar(lineaArqueo('pago_movil'), confirmadas.pago_movil ? pmVerified : null),
        valorParaCerrar(lineaArqueo('trans_bs'), confirmadas.trans_bs ? transVerified : null),
        posSettledUsd, posSettledBs
      );
      setShowClose(false);
      refreshActiveDay();
      loadClosings();
      loadTotals();
      loadDrawerAdjust();
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
    }
  };

  const doSettle = async () => {
    if (!showSettle || !isOwner) return;
    await api.updateDailyClosingSettlement(showSettle.id, settleAmount, settleAmountBs);
    setShowSettle(null);
    loadClosings();
  };

  const doExport = async () => {
    setExportMsg(null);
    try {
      const res = await api.exportDailyReportXlsx(effectiveStart, effectiveEnd);
      const label = res.format === 'xlsx' ? 'Reporte Excel exportado' : 'Reporte CSV exportado (respaldo)';
      const note = res.note ? ` ${res.note}` : '';
      setExportMsg({ ok: res.ok, text: `${label} (${effectiveStart} → ${effectiveEnd}): ${res.path}${note}` });
    } catch (e) {
      setExportMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const savePin = async () => {
    setPinError(null);
    if (pinNew.length !== 4) { setPinError('El PIN debe tener 4 dígitos'); return; }
    if (pinNew !== pinConfirm) { setPinError('Los PIN no coinciden'); return; }
    try {
      await api.setPin(pinNew);
      setPinStatus(true);
      setShowPinDialog(false);
      setPinNew(''); setPinConfirm(''); setPinCurrent('');
    } catch (e) {
      setPinError(e instanceof Error ? e.message : String(e));
    }
  };

  const changePin = async () => {
    setPinError(null);
    if (pinCurrent.length !== 4) { setPinError('El PIN actual debe tener 4 dígitos'); return; }
    if (pinNew.length !== 4) { setPinError('El PIN nuevo debe tener 4 dígitos'); return; }
    if (pinNew !== pinConfirm) { setPinError('Los PIN no coinciden'); return; }
    try {
      const ok = await api.verifyPin(pinCurrent);
      if (!ok) { setPinError('PIN actual incorrecto'); return; }
      await api.setPin(pinNew);
      setShowPinDialog(false);
      setPinNew(''); setPinConfirm(''); setPinCurrent('');
    } catch (e) {
      setPinError(e instanceof Error ? e.message : String(e));
    }
  };

  const doRemovePin = async () => {
    setPinError(null);
    if (pinCurrent.length !== 4) { setPinError('Ingresa el PIN actual (4 dígitos)'); return; }
    try {
      const ok = await api.removePin(pinCurrent);
      if (!ok) { setPinError('PIN incorrecto'); return; }
      setPinStatus(false);
      setShowPinDialog(false);
      setPinNew(''); setPinConfirm(''); setPinCurrent('');
    } catch (e) {
      setPinError(e instanceof Error ? e.message : String(e));
    }
  };

  // Sumas del período (memoizado — harness perf)
  const sums = useMemo(() => totals.reduce((a, t) => ({
    pos_charged: a.pos_charged + t.pos_charged,
    pos_fees: a.pos_fees + t.pos_fees,
    pos_net: a.pos_net + t.pos_net,
    pos_net_usd: a.pos_net_usd + t.pos_net_usd,
    pos_net_bs: a.pos_net_bs + t.pos_net_bs,
    pos_charged_usd: a.pos_charged_usd + t.pos_charged_usd,
    pos_charged_bs: a.pos_charged_bs + t.pos_charged_bs,
    pago_movil: a.pago_movil + t.pago_movil_total,
    cash_bs: a.cash_bs + t.cash_bs,
    usd: a.usd + t.usd_cash_total + t.cash_usd,
    zelle: a.zelle + t.zelle_total,
    trans_bs: a.trans_bs + t.transfer_bs_total,
    grand_usd: a.grand_usd + t.grand_usd,
    grand_bs: a.grand_bs + t.grand_bs,
    grand_total: a.grand_total + t.grand_total,
    refund_usd: a.refund_usd + (t.refund_usd ?? 0),
    refund_bs: a.refund_bs + (t.refund_bs ?? 0),
  }), { pos_charged: 0, pos_fees: 0, pos_net: 0, pos_net_usd: 0, pos_net_bs: 0, pos_charged_usd: 0, pos_charged_bs: 0, pago_movil: 0, cash_bs: 0, usd: 0, zelle: 0, trans_bs: 0, grand_usd: 0, grand_bs: 0, grand_total: 0, refund_usd: 0, refund_bs: 0 }), [totals]);

  // F42 — «¿hay movimiento?» es ≠ 0, NO > 0: una devolución puede dejar el método en 0 o en negativo y
  // esconderlo era esconder la plata que salió (el caso real del 2026-09-17: una devolución anotada en
  // «Punto de Venta (Bs)» dejaba el Punto en −Bs. 1.697 y la fila del Punto NO se dibujaba → la
  // devolución desaparecía de la pantalla del cierre). Regla madre de F39: un descuadre nunca se esconde.
  const hay = (v: number) => Math.abs(v) > 0.005;
  const hasPos = totals.some(t => hay(t.pos_net_usd) || hay(t.pos_net_bs));
  const hasPM = totals.some(t => hay(t.pago_movil_total));
  const hasCashBs = totals.some(t => hay(t.cash_bs));
  const hasUsd = totals.some(t => hay(t.usd_cash_total + t.cash_usd));
  const hasZelle = totals.some(t => hay(t.zelle_total));
  const hasTransf = totals.some(t => hay(t.transfer_bs_total));
  const condCols = [hasPos, hasPM, hasCashBs, hasUsd, hasZelle, hasTransf].filter(Boolean).length;
  const tableCols = 3 + condCols;
  const dash = (n: number, fmt: (x: number) => string) => (Math.abs(n) > 0.005 ? fmt(n) : '—');
  const diasConMovimientos = totals.filter(t => hay(t.grand_usd) || hay(t.grand_bs)).length;

  // F69 — EL DESGLOSE DEL CAJÓN Y LAS LÍNEAS A CONTAR (regla pura `src/lib/drawer.ts`).
  // El esperado del cajón = efectivo cobrado (ya neto de devoluciones) + fondo de caja − gastos pagados
  // del cajón. Es EXACTAMENTE el número que usa `close_day` en el backend, así que el operario cuenta
  // contra lo que el cierre va a comparar (antes no incluía el fondo ni los gastos: un día perfecto
  // «faltaba» lo que se pagó del cajón y «sobraba» el fondo — hallazgo A1 de la auditoría de entrega).
  const ajuste: AjusteCajon = drawerAdjust ?? AJUSTE_CERO;
  const esperadoDia = {
    cash_usd: expected?.cash_usd ?? 0,
    usd_cash_total: expected?.usd_cash_total ?? 0,
    cash_bs: expected?.cash_bs ?? 0,
    zelle_total: expected?.zelle_total ?? 0,
    pago_movil_total: expected?.pago_movil_total ?? 0,
    transfer_bs_total: expected?.transfer_bs_total ?? 0,
    pos_charged_usd: expected?.pos_charged_usd ?? 0,
    pos_charged_bs: expected?.pos_charged_bs ?? 0,
  };
  const desglose = desgloseCajon(esperadoDia, ajuste);
  const lineasArqueo = lineasDelArqueo(esperadoDia, desglose);
  /** La línea del arqueo por clave (si ese día no hubo nada de ese método, devuelve una vacía). */
  const lineaArqueo = (clave: ClaveArqueo): LineaArqueo =>
    lineasArqueo.find(l => l.clave === clave)
    ?? { clave, etiqueta: '', detalle: '', monto: 0, moneda: clave === 'usd' || clave === 'pos_usd' || clave === 'zelle' ? 'USD' : 'VES', enCajon: clave === 'usd' || clave === 'bs' };
  const faltanConfirmar = lineasSinConfirmar(lineasArqueo, confirmadas);
  /** ¿El arqueo pide esta línea? (misma condición que la regla: `|monto| > 0.005`, negativos incluidos) */
  const tieneLinea = (clave: ClaveArqueo) => lineasArqueo.some(l => l.clave === clave);
  // Diferencias del cajón: la MISMA regla pura que la lista de Cierres. El esperado sale del desglose
  // (con fondo y gastos), no de las columnas crudas del día.
  const diffCierre = closingDifference({
    cash_usd: desglose.esperado_usd,
    zelle_total: esperadoDia.zelle_total,
    usd_cash_total: 0,
    cash_bs: desglose.esperado_bs,
    pago_movil_total: esperadoDia.pago_movil_total,
    transfer_bs_total: esperadoDia.transfer_bs_total,
    actual_cash_usd: confirmadas.usd ? usdCounted : 0,
    actual_zelle: confirmadas.zelle ? zelleVerified : 0,
    actual_cash_bs: confirmadas.bs ? cashCounted : 0,
    actual_pago_movil: confirmadas.pago_movil ? pmVerified : 0,
    actual_transfer_bs: confirmadas.trans_bs ? transVerified : 0,
  });
  const diffBs = diffCierre.bs;
  const diffUsd = diffCierre.usd;
  const hoyCerrado = !activeDay && closings.some(c => c.close_date === today);
  const pagoMovilTotal = pagoMovilList.reduce((a, p) => a + p.amount, 0);
  // F39: la liquidación del Punto también cuadra POR MONEDA (misma regla pura que el arqueo).
  // (El Punto que se declara al CERRAR el día ya no tiene una resta propia: es una línea más del arqueo
  //  con su esperado y su diferencia — `lineaArqueo('pos_usd' | 'pos_bs')`.)
  const settleDiff = puntoDifference(settleChargedUsd, settleAmount, settleChargedBs, settleAmountBs);

  // F74 — el libro de IVA del período (misma regla pura que usan ventas y servicios: una sola cuenta).
  const resumenIva = useMemo(() => ivaDeGrupos(ivaGrupos), [ivaGrupos]);

  // F72 — LO QUE ESTA SESIÓN VE EN EL ENCABEZADO: las subcategorías con sus pestañas y las acciones
  // del dueño. Sale de la regla pura (`src/lib/ledger-nav.ts`) con las mismas capacidades (`ab`) que
  // usa el resto de la pantalla: no hay una segunda lista de «quién ve qué» que se pueda desincronizar.
  const nav = ledgerNav(ab);
  const acciones = ledgerActions(ab);
  const accionDe = (id: LedgerActionId) => {
    if (id === 'exportar') { doExport(); return; }
    if (id === 'pin') {
      setShowPinDialog(true);
      setPinError(null);
      setPinNew(''); setPinConfirm(''); setPinCurrent('');
      return;
    }
    if (id === 'iva') { setShowTax(true); return; }
    setShowUsuarios(true);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* F72 — EL ENCABEZADO EN DOS NIVELES (pedido del dueño: «arregla toda esta pestaña… está muy
          larga»). Antes eran NUEVE botones iguales en una sola fila al lado del título, y no se
          distinguía una PESTAÑA (cambia lo de abajo) de una ACCIÓN (abre un diálogo o descarga):
            1) arriba, el título y —a su derecha— las ACCIONES del dueño (Exportar Excel · PIN ·
               Personas), que no cambian de sección;
            2) abajo, las SECCIONES del libro agrupadas en SUBCATEGORÍAS con su rótulo
               (Caja del día · Plata · Control), una sola definición en `src/lib/ledger-nav.ts`.
          La visibilidad por rol sale de esa regla: un ítem sin permiso no se dibuja, y un grupo que
          se queda sin ítems tampoco (la caja ve «Caja del día → Diario» y «Control → Movimientos»).
          Los rótulos son EXACTOS (`Diario`, `Cierres`, …): las verificaciones en vivo buscan los
          botones por su texto. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Libro Diario</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Control financiero y cierre diario
              <span className="text-muted-foreground/70"> · estás en {ledgerTabGroup(effectiveTab)} → {ledgerTabLabel(effectiveTab)}</span>
            </p>
          </div>
          {acciones.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" data-actions="libro-diario">
              {acciones.map(a => (
                <Button key={a.id} variant="outline" size="sm" title={a.hint}
                  data-action={a.id === 'personas' ? 'personas' : `libro-${a.id}`}
                  onClick={() => accionDe(a.id)}>
                  {ICONO_ACCION[a.id]}
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        <nav className="flex flex-wrap items-center gap-y-2 rounded-xl border border-border bg-muted/30 p-1.5"
          aria-label="Secciones del Libro Diario">
          {nav.map((g, gi) => (
            <div key={g.id} className="flex items-center gap-1" data-nav-group={g.id}>
              {gi > 0 && <span aria-hidden className="mx-1.5 h-6 w-px bg-border" />}
              <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                title={`Subcategoría: ${g.label}`}>
                {g.label}
              </span>
              {g.items.map(it => (
                <Button key={it.tab} size="sm" title={it.hint} data-tab={it.tab}
                  variant={effectiveTab === it.tab ? 'default' : 'ghost'}
                  aria-current={effectiveTab === it.tab ? 'page' : undefined}
                  onClick={() => setTab(it.tab)}>
                  {ICONO_TAB[it.tab]}
                  {it.label}
                </Button>
              ))}
            </div>
          ))}
        </nav>
      </div>

      {isOwner && exportMsg && (
        <p className={exportMsg.ok
          ? 'flex items-center gap-2 text-sm text-success'
          : 'text-sm text-danger'}>
          {exportMsg.ok && <CheckCircle2 className="size-4" />}
          {exportMsg.text}
        </p>
      )}

      {activeDay ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
            </span>
            <div>
              <p className="font-semibold text-emerald-700">Día ABIERTO — {activeDay.close_date}</p>
              <p className="text-sm text-emerald-700/80">Tasa Bs {activeDay.tasa_bcv.toFixed(2)} · Apertura ${activeDay.initial_cash_usd.toFixed(2)} (se guarda, no es venta del día)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => openOpenDialog(true)} title="Corrige la tasa BCV o la apertura sin cerrar el día (útil si se abrió sin tasa)">
              <Pencil className="size-4" /> Actualizar día
            </Button>
            {/* F69 — CERRAR EL DÍA ES DEL DUEÑO (`close_day` pide la sesión de dueño en el backend).
                El botón estaba abierto para la caja y el cierre le rebotaba con un error de permiso
                DESPUÉS de contar el cajón entero: acá se dice antes y se explica el camino. */}
            {ab.closeDay ? (
              <Button variant="default" onClick={openCloseDialog} data-action="cerrar-dia">
                <Lock className="size-4" /> Cerrar Día
              </Button>
            ) : (
              <span className="text-xs text-emerald-700/80 max-w-[230px] text-right" data-field="cierre-solo-dueno">
                El cierre del día lo hace el dueño (Cambiar persona → Master): vos seguí cobrando.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-3 text-amber-700">
            <Lock className="size-5" />
            <div>
              <p className="font-semibold">Día CERRADO — no se pueden registrar ventas ni servicios</p>
              {/* F69 (revisión adversarial): si el día de HOY ya está cerrado, «Abrir Día» no puede
                  reabrirlo (el backend lo rechaza: un cierre guardado no se recalcula) — el camino es
                  ↺ y es del dueño. Se dice acá en vez de ofrecer un botón que va a fallar. */}
              {hoyCerrado && (
                <p className="text-xs text-amber-700/80" data-field="dia-cerrado-hoy">
                  Hoy ya está cerrado con su arqueo: si hay que anotar algo de hoy, el dueño lo reabre en
                  Libro Diario → Cierres (botón ↺), se anota y se vuelve a cerrar.
                </p>
              )}
            </div>
          </div>
          {hoyCerrado ? (
            <span className="text-xs text-amber-700/80 max-w-[240px] text-right">Abrir el día siguiente, mañana</span>
          ) : (
            <Button variant="default" onClick={() => openOpenDialog(false)}>
              <Play className="size-4" /> Abrir Día
            </Button>
          )}
        </div>
      )}

      {isOwner && (effectiveTab === 'diario' || effectiveTab === 'gastos' || effectiveTab === 'pagos') && (
        <div className="flex items-center gap-2">
          <Input type="date" value={startDate}
            onChange={e => setStartDate(e.target.value)} className="w-44" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={endDate}
            onChange={e => setEndDate(e.target.value)} className="w-44" />
          <Button onClick={() => { if (effectiveTab === 'diario') loadTotals(); else if (effectiveTab === 'pagos') loadPayments(); else loadExpenses(); }} variant="outline">
            <TrendingUp className="size-4" /> Actualizar
          </Button>
        </div>
      )}

      {effectiveTab === 'diario' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi icon={<CreditCard className="size-3.5" />} label="Punto de Venta" value={fmtMix(sums.pos_net_usd, sums.pos_net_bs)}
              accent="bg-primary/10 text-primary" />
            <Kpi icon={<Smartphone className="size-3.5" />} label="Pago Móvil" value={fmtBs(sums.pago_movil)}
              accent="bg-warning/10 text-warning" className="text-warning" />
            <Kpi icon={<Banknote className="size-3.5" />} label="Efectivo Bs" value={fmtBs(sums.cash_bs)}
              accent="bg-warning/10 text-warning" className="text-warning" />
            <Kpi icon={<DollarSign className="size-3.5" />} label="Divisas $" value={fmtUsd(sums.usd)}
              accent="bg-success/10 text-success" className="text-success" />
            {/* F42: cuánto se DEVOLVIÓ en el período. Los KPI de arriba ya vienen netos (una devolución
                resta del método por el que salió), así que sin este número el día "da menos" sin motivo. */}
            {(hay(sums.refund_usd) || hay(sums.refund_bs)) && (
              <Kpi icon={<Undo2 className="size-3.5" />} label="Devuelto" value={fmtMix(sums.refund_usd, sums.refund_bs)}
                accent="bg-danger/10 text-danger" className="text-danger" />
            )}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Resumen del día {today}</CardTitle>
              <CardDescription className="text-xs">
                Movimientos del día de hoy — los equipos pendientes de ayer siguen activos y sus cobros/entregas cuentan en el día en que ocurren
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Recibidos hoy</p>
                <p className="text-xl font-bold tabular-nums">{daySummary?.received ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Entregados hoy</p>
                <p className="text-xl font-bold tabular-nums text-emerald-600">{daySummary?.delivered ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">En taller ahora</p>
                <p className="text-xl font-bold tabular-nums">{daySummary?.workshop ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Cobrado servicios</p>
                <p className="text-xl font-bold tabular-nums text-primary">
                  {fmtMix(daySummary?.payments_usd ?? 0, daySummary?.payments_bs ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Ventas del día</p>
                <p className="text-xl font-bold tabular-nums">
                  {fmtMix(daySummary?.sales_usd ?? 0, daySummary?.sales_bs ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-primary/30 bg-primary/5">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
              <div className="space-y-1">
                <CardTitle className="text-sm font-semibold">Total General del período</CardTitle>
                <CardDescription className="text-xs">Ingresos cobrados por moneda</CardDescription>
              </div>
              <Badge variant="secondary" className="gap-1.5 tabular-nums shrink-0">
                <ArrowRightLeft className="size-3" /> ≈ {fmtUsd(sums.grand_total)} USD
              </Badge>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
                <div className="flex items-center gap-3 pb-4 sm:pb-0 sm:pr-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <DollarSign className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Dólares</p>
                    <p className="text-2xl font-bold tabular-nums text-emerald-600">{fmtUsd(sums.grand_usd)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 py-4 sm:py-0 sm:px-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                    <Banknote className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Bolívares</p>
                    <p className="text-2xl font-bold tabular-nums text-warning">{fmtBs(sums.grand_bs)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-4 sm:pt-0 sm:pl-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ArrowRightLeft className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Equivalente en USD</p>
                    <p className="text-2xl font-bold tabular-nums">{fmtUsd(sums.grand_total)}</p>
                  </div>
                </div>
              </div>
              <Separator className="my-4" />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {diasConMovimientos} día(s) con movimientos
                </span>
                <span className="tabular-nums">
                  {activeDay && activeDay.tasa_bcv > 0
                    ? `Tasa BCV: Bs ${activeDay.tasa_bcv.toFixed(2)}`
                    : 'Tasa BCV: —'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* F74 — EL LIBRO DE IVA DEL PERÍODO (lo que se declara). Se ve cuando el IVA está activo o
              cuando el período TIENE operaciones con IVA: el desglose sale de la alícuota anotada en
              CADA fila (no de la de hoy), así un período cerrado no cambia. Las anuladas no cuentan. */}
          {(ivaActivo(taxConfig) || resumenIva.operaciones > 0) && (
            <Card data-panel="iva-periodo">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Percent className="size-4" /> IVA del período
                  <Badge variant="secondary" className="text-xs">
                    {ivaActivo(taxConfig)
                      ? `${alicuotaLabel(taxConfig.alicuota)} · ${taxConfig.modo === 'agregado' ? 'se suma al cobrar' : 'ya viene en el precio'}`
                      : 'IVA apagado ahora'}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Base imponible + IVA de las ventas y los servicios de {startDate} a {endDate}, con la
                  alícuota con la que se cargó cada operación.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Base imponible</p>
                    <p className="text-lg font-bold" data-field="iva-periodo-base">{fmtUsd(resumenIva.base)}</p>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      IVA {resumenIva.alicuotaMixta ? '(alícuotas mezcladas)' : alicuotaLabel(resumenIva.alicuota)}
                    </p>
                    <p className="text-lg font-bold text-primary" data-field="iva-periodo-iva">{fmtUsd(resumenIva.iva)}</p>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3" title="Lo cobrado por las operaciones CON IVA (base + IVA)">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cobrado con IVA</p>
                    <p className="text-lg font-bold" data-field="iva-periodo-total">{fmtUsd(resumenIva.total)}</p>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3" title="Lo cobrado sin IVA (alícuota 0: lo cargado antes de prenderlo, o lo exento). No es base imponible.">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sin IVA / exento</p>
                    <p className="text-lg font-bold" data-field="iva-periodo-sin">{fmtUsd(resumenIva.sinIva)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground" data-field="iva-periodo-nota">
                  {resumenIva.operaciones > 0
                    ? `${resumenIva.operaciones} operación(es) con IVA. La base imponible NO incluye lo cobrado sin IVA (${fmtUsd(resumenIva.sinIva)}), que se informa aparte. IVA en Bs. del período: ${fmtBs(resumenIva.iva)} (equivalente con la tasa del turno).`
                    : 'No hay operaciones con IVA en este período.'}
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    {hasPos && <TableHead className="text-right">Punto de Venta</TableHead>}
                    {hasPM && <TableHead className="text-right">Pago Móvil</TableHead>}
                    {hasCashBs && <TableHead className="text-right">Efectivo Bs</TableHead>}
                    {hasUsd && <TableHead className="text-right">Divisas $</TableHead>}
                    {hasZelle && <TableHead className="text-right">Zelle</TableHead>}
                    {hasTransf && <TableHead className="text-right">Transf Bs</TableHead>}
                    <TableHead className="text-right">Tasa BCV</TableHead>
                    <TableHead className="text-right font-bold">Total ($ + Bs.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tableCols} className="text-center text-muted-foreground py-8">
                        Sin transacciones en este período
                      </TableCell>
                    </TableRow>
                  ) : (
                    totals.map(t => (
                      <TableRow key={t.date}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{t.date}</span>
                            {/* F42: lo DEVUELTO ese día, visible (el total del día ya viene neto: sin
                                esto el operario no puede saber cuánto devolvió ni por qué el día da menos) */}
                            {hay(t.refund_usd ?? 0) || hay(t.refund_bs ?? 0) ? (
                              <Badge variant="outline" className="text-[10px] gap-1 text-danger border-danger/50"
                                data-field="refund-dia"
                                title="Devuelto a clientes ese día (ya está restado de los totales por método)">
                                <Undo2 className="size-3" /> Devuelto {fmtMix(t.refund_usd ?? 0, t.refund_bs ?? 0)}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        {hasPos && (
                          <TableCell className="text-right tabular-nums">
                            {hay(t.pos_net_usd) || hay(t.pos_net_bs) ? fmtMix(t.pos_net_usd, t.pos_net_bs) : '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-right tabular-nums text-warning cursor-pointer hover:underline" title="Ver detalle Pago Móvil"
                          onClick={() => hay(t.pago_movil_total) && openDrillDown(t.date, 'Pago Móvil')}>
                          {dash(t.pago_movil_total, fmtBs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-warning cursor-pointer hover:underline" title="Ver detalle Efectivo Bs"
                          onClick={() => hay(t.cash_bs) && openDrillDown(t.date, 'Efectivo Bs')}>
                          {dash(t.cash_bs, fmtBs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success cursor-pointer hover:underline" title="Ver detalle Divisas"
                          onClick={() => hay(t.usd_cash_total + t.cash_usd) && openDrillDown(t.date, 'Divisas (USD Cash)')}>
                          {dash(t.usd_cash_total + t.cash_usd, fmtUsd)}
                        </TableCell>
                        {hasZelle && <TableCell className="text-right tabular-nums text-success cursor-pointer hover:underline" title="Ver detalle Zelle"
                          onClick={() => hay(t.zelle_total) && openDrillDown(t.date, 'Transferencia Zelle')}>
                          {dash(t.zelle_total, fmtUsd)}
                        </TableCell>}
                        {hasTransf && <TableCell className="text-right tabular-nums text-warning cursor-pointer hover:underline" title="Ver detalle Transf Bs"
                          onClick={() => hay(t.transfer_bs_total) && openDrillDown(t.date, 'Transferencia Bs')}>
                          {dash(t.transfer_bs_total, fmtBs)}
                        </TableCell>}
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {t.tasa_bcv > 0 ? t.tasa_bcv.toFixed(2) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{totalCell(t.grand_usd, t.grand_bs)}</TableCell>
                      </TableRow>
                    ))
                  )}
                  {totals.length > 0 && (
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-semibold">Total</TableCell>
                      {hasPos && <TableCell className="text-right font-semibold tabular-nums">{fmtMix(sums.pos_net_usd, sums.pos_net_bs)}</TableCell>}
                      <TableCell className="text-right font-semibold tabular-nums text-warning">{fmtBs(sums.pago_movil)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-warning">{fmtBs(sums.cash_bs)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-success">{fmtUsd(sums.usd)}</TableCell>
                      {hasZelle && <TableCell className="text-right font-semibold tabular-nums text-success">{fmtUsd(sums.zelle)}</TableCell>}
                      {hasTransf && <TableCell className="text-right font-semibold tabular-nums text-warning">{fmtBs(sums.trans_bs)}</TableCell>}
                      <TableCell />
                      <TableCell className="text-right font-bold tabular-nums">{totalCell(sums.grand_usd, sums.grand_bs)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {effectiveTab === 'cierres' && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Punto Neto</TableHead>
                  <TableHead className="text-right">Liquidado</TableHead>
                  <TableHead className="text-right">Pago Móvil</TableHead>
                  <TableHead className="text-right">Efectivo Bs</TableHead>
                  <TableHead className="text-right">Divisas $</TableHead>
                  <TableHead className="text-right">Tasa</TableHead>
                  <TableHead className="text-right font-bold">Total ($ + Bs.)</TableHead>
                  {/* F39: la caja cuadra POR MONEDA. Un solo número en $ (faltante_$ + faltante_Bs/tasa)
                      mentía como semáforo: con la tasa moviéndose, un descuadre en Bs. parecía enorme y
                      un faltante real de $0,40 se diluía. */}
                  <TableHead className="text-right">Diferencia $</TableHead>
                  <TableHead className="text-right">Diferencia Bs.</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                      Sin cierres registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  closings.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.close_date}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(c.pos_net)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.pos_settled > 0 || c.pos_settled_bs > 0
                          ? <span className="font-medium">{fmtMix(c.pos_settled, c.pos_settled_bs)}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-warning">{fmtBs(c.pago_movil_total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-warning">{fmtBs(c.cash_bs)}</TableCell>
                      <TableCell className="text-right tabular-nums text-success">{fmtUsd(c.usd_cash_total + c.cash_usd)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {c.tasa_bcv > 0 ? c.tasa_bcv.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {!c.is_closed ? <span className="text-muted-foreground">—</span> : totalCell(c.total_usd, c.total_bs)}
                      </TableCell>
                      {(() => {
                        if (!c.is_closed) return (<>
                          <TableCell className="text-right text-muted-foreground">—</TableCell>
                          <TableCell className="text-right text-muted-foreground">—</TableCell>
                        </>);
                        // La diferencia se muestra SIEMPRE (esconderla tapaba un descuadre real: un
                        // cierre con el arqueo en 0 y un esperado grande es «falta todo el cajón»).
                        // `sinContar` solo AGREGA la marca de que nadie contó, con el remedio.
                        const d = closingDifference(c);
                        const sinContarEste = sinContar(c);
                        const aviso = sinContarEste
                          ? 'Nadie contó el cajón (arqueo en 0) o este cierre es anterior al arqueo real. Si es viejo, reabrilo con ↺, contá el cajón y volvé a cerrarlo.'
                          : closingLabel(d);
                        const colorUsd = sinContarEste ? 'text-warning' : Math.abs(d.usd) < TOL_USD ? 'text-success' : 'text-danger';
                        const colorBs = sinContarEste ? 'text-warning' : Math.abs(d.bs) < TOL_BS ? 'text-success' : 'text-danger';
                        return (<>
                          <TableCell className="text-right tabular-nums" title={aviso}>
                            <span className={colorUsd}
                              data-diff="usd" data-ok={Math.abs(d.usd) < TOL_USD} data-sin-contar={sinContarEste || null}>
                              {d.usd > 0 ? '+' : ''}{fmtUsd(d.usd)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums" title={aviso}>
                            <span className={colorBs}
                              data-diff="bs" data-ok={Math.abs(d.bs) < TOL_BS} data-sin-contar={sinContarEste || null}>
                              {d.bs > 0 ? '+' : ''}{fmtBs(d.bs)}
                            </span>
                            {sinContarEste && <span className="ml-1 text-[10px] text-muted-foreground">sin contar</span>}
                          </TableCell>
                        </>);
                      })()}
                      <TableCell>
                        {c.is_closed ? (
                          <Badge variant="default" className="bg-success">Cerrado</Badge>
                        ) : (
                          <Badge variant="outline">Abierto</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {/* F35: un día que quedó ABIERTO (p. ej. reabierto con ↺ para anotar un pago
                              cobrado ese día) se puede cerrar DESDE ACÁ. Antes el único «Cerrar Día»
                              apuntaba al turno más reciente: con dos abiertos, el viejo quedaba sin
                              arqueo. */}
                          {!c.is_closed && (
                            <Button variant="outline" size="sm" data-action="cerrar-dia-fila"
                              title={`Cerrar el día ${c.close_date} (arqueo de esa caja)`}
                              onClick={() => abrirCierreDe(c)}>
                              <Lock className="size-3" /> Cerrar
                            </Button>
                          )}
                          {c.is_closed && (
                            <Button variant="ghost" size="sm"
                              onClick={() => api.reopenDay(c.close_date).then(() => { loadClosings(); refreshActiveDay(); })}>
                              <RotateCcw className="size-3" />
                            </Button>
                          )}
                          <Button variant="outline" size="sm"
                            onClick={() => {
                              setShowSettle(c);
                              setSettleAmount(c.pos_settled);
                              setSettleAmountBs(c.pos_settled_bs);
                              api.getDailyTotals(c.close_date, c.close_date).then(ts => {
                                const t = ts[0];
                                setSettleChargedUsd(t?.pos_charged_usd ?? 0);
                                setSettleChargedBs(t?.pos_charged_bs ?? 0);
                              }).catch(() => {
                                setSettleChargedUsd(0);
                                setSettleChargedBs(0);
                              });
                            }}>
                            <DollarSign className="size-3" /> Liquidar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {effectiveTab === 'gastos' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Gastos del negocio registrados entre {startDate} y {endDate} —{' '}
              <span className="font-medium text-foreground">los que salieron del cajón SÍ bajan el efectivo
              esperado</span> al cerrar el día (columna «Salió de»)
            </p>
            <Button onClick={() => { setExpDate(today); setExpCategory('Otro'); setExpAmount(0); setExpCurrency('USD'); setExpNotes(''); setExpMethod(''); setExpError(null); setShowExpenseDialog(true); }}>
              <Plus className="size-4" /> Registrar gasto
            </Button>
          </div>
          {expenseMsg && (
            <p className="text-sm text-success flex items-center gap-2">
              <CheckCircle2 className="size-4" /> {expenseMsg}
            </p>
          )}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Salió de</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Sin gastos en este período
                      </TableCell>
                    </TableRow>
                  ) : (
                    expenses.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.expense_date}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{e.category}</Badge>
                        </TableCell>
                        <TableCell className={`text-right font-semibold tabular-nums ${e.currency === 'USD' ? 'text-success' : 'text-warning'}`}>
                          {e.currency === 'USD' ? fmtUsd(e.amount) : fmtBs(e.amount)}
                        </TableCell>
                        {/* F69 — DE DÓNDE SALIÓ LA PLATA: es lo que decide si este gasto baja el
                            efectivo esperado al cerrar el día (los de cajón) o se concilia por banco. */}
                        <TableCell data-expense-method={e.method || ''}>
                          {e.method ? (
                            esDeCajon(e.method)
                              ? <Badge className="bg-warning/15 text-warning border-warning/40" variant="outline">{e.method} (cajón)</Badge>
                              : <Badge variant="secondary">{e.method}</Badge>
                          ) : (
                            <span className="text-xs text-warning" title="Sin declarar: el cierre del día NO lo descuenta del cajón. Corregilo reabriendo el gasto (borrar y volver a anotarlo).">
                              Sin declarar
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{e.notes || '—'}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setExpenseToDelete(e)}>
                            <Trash2 className="size-3.5 text-danger" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {expenses.length > 0 && (
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-semibold" colSpan={2}>Total del período</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        <span className="text-success">{fmtUsd(expenses.filter(e => e.currency === 'USD').reduce((a, e) => a + e.amount, 0))}</span>
                        {expenses.some(e => e.currency === 'VES') && (
                          <span className="text-warning"> + {fmtBs(expenses.filter(e => e.currency === 'VES').reduce((a, e) => a + e.amount, 0))}</span>
                        )}
                      </TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {effectiveTab === 'pagos' && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Search className="size-4" /> Buscar pagos de servicios
              </CardTitle>
              <CardDescription className="text-xs">
                Busca por método, cliente, referencia o moneda — útil para reconciliar sobrantes/faltantes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Método</label>
                  <Select value={payMethodFilter} onValueChange={setPayMethodFilter}>
                    <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todos</SelectItem>
                      {PAYMENT_METHODS.filter(Boolean).map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Cliente / Cédula</label>
                  <Input value={payClientFilter} onChange={e => setPayClientFilter(e.target.value)}
                    placeholder="Nombre o cédula..." className="h-9" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Referencia</label>
                  <Input value={payRefFilter} onChange={e => setPayRefFilter(e.target.value)}
                    placeholder="Nº referencia..." className="h-9" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Moneda</label>
                  <Select value={payCurrencyFilter} onValueChange={setPayCurrencyFilter}>
                    <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todas</SelectItem>
                      <SelectItem value="USD">USD $</SelectItem>
                      <SelectItem value="VES">Bs.</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(payMethodFilter || payClientFilter || payRefFilter || payCurrencyFilter) && (
                <Button variant="ghost" size="sm" onClick={() => { setPayMethodFilter(''); setPayClientFilter(''); setPayRefFilter(''); setPayCurrencyFilter(''); }}>
                  <X className="size-3.5" /> Limpiar filtros
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Orden</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Cédula</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        Buscando...
                      </TableCell>
                    </TableRow>
                  ) : payResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        Sin pagos que coincidan con los filtros
                      </TableCell>
                    </TableRow>
                  ) : (
                    payResults.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium whitespace-nowrap">{p.payment_date?.slice(0, 16) ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">{p.order_num ?? '—'}</Badge>
                        </TableCell>
                        <TableCell>{p.client ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{p.client_ci || '—'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{p.model ?? '—'}</TableCell>
                        <TableCell className={`text-right font-semibold tabular-nums ${p.currency === 'VES' ? 'text-warning' : 'text-success'}`}>
                          {p.currency === 'VES' ? fmtBs(p.amount) : fmtUsd(p.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{p.payment_method ?? '—'}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.zelle_reference ? `····${p.zelle_reference.slice(-6)}` : '—'}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">{p.notes || '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                  {payResults.length > 0 && (() => {
                    const totalUsd = payResults.filter(p => p.currency !== 'VES').reduce((a, p) => a + p.amount, 0);
                    const totalBs = payResults.filter(p => p.currency === 'VES').reduce((a, p) => a + p.amount, 0);
                    return (
                      <TableRow className="bg-muted/50">
                        <TableCell className="font-semibold" colSpan={5}>
                          Total ({payResults.length} pago{payResults.length !== 1 ? 's' : ''})
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {totalUsd > 0.005 && <span className="text-success">{fmtUsd(totalUsd)}</span>}
                          {totalUsd > 0.005 && totalBs > 0.005 && ' + '}
                          {totalBs > 0.005 && <span className="text-warning">{fmtBs(totalBs)}</span>}
                          {totalUsd <= 0.005 && totalBs <= 0.005 && '$0.00'}
                        </TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    );
                  })()}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── F68 — LIBRO DE PLATA: quién hizo cada movimiento ──────────────────────────────────────
          Lo que pidió el dueño: la CAJA ve SU día («su día de caja») y el Master ve todo, con el
          nombre de la persona en cada línea. El backend NO devuelve a la caja los movimientos de
          otras sesiones, así que acá no hay forma de mirar la facturación del dueño. */}
      {/* F68 — PERSONAS Y ACCESOS (sólo Master): acá se crea la sesión «Caja 1» con SU PIN. */}
      {isOwner && (
        <UsuariosDialog open={showUsuarios} onClose={() => setShowUsuarios(false)} />
      )}
      {/* F74 — AJUSTES DEL IVA (sólo dueño): prender/apagar, alícuota y modo. Al guardar se recarga la
          configuración y el libro del período. */}
      {isOwner && (
        <TaxSettingsDialog open={showTax} onClose={() => setShowTax(false)} config={taxConfig}
          tasa={activeDay?.tasa_bcv ?? 0}
          onSaved={cfg => { setTaxConfig(cfg); loadIva(); }} />
      )}

      {effectiveTab === 'movimientos' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {isOwner
                ? `Todos los movimientos de plata entre ${startDate} y ${endDate} — con quién los hizo.`
                : 'Tus movimientos de hoy (vos sólo ves los tuyos).'}
            </p>
            <Button variant="outline" size="sm" onClick={() => { setTab('diario'); setTimeout(() => setTab('movimientos'), 0); }}>
              <RefreshCw className="size-3.5" /> Actualizar
            </Button>
          </div>

          {isOwner && porPersona.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {porPersona.map(p => (
                <div key={p.name} className="rounded-lg border border-border p-3" data-por-persona={p.name}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide truncate" title={p.name}>{p.name}</p>
                  <p className="text-lg font-bold">{fmtMix(p.usd, p.bs)}</p>
                  <p className="text-[11px] text-muted-foreground">{p.count} movimiento{p.count !== 1 ? 's' : ''}</p>
                </div>
              ))}
            </div>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Movimientos ({movimientos.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Qué</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Quién</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimientos.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                        Todavía no hay movimientos de plata en este rango.
                      </TableCell>
                    </TableRow>
                  )}
                  {movimientos.map(m => (
                    <TableRow key={m.id} data-movement={m.id} data-movement-type={m.type}>
                      <TableCell className="text-xs whitespace-nowrap">{m.date ? m.date.slice(0, 16) : '—'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{ETIQUETA_MOVIMIENTO[m.type] ?? m.type}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.method || '—'}</TableCell>
                      <TableCell className={cn('text-right font-medium tabular-nums whitespace-nowrap',
                        m.sign < 0 ? 'text-danger' : m.sign > 0 ? 'text-success' : 'text-muted-foreground')}>
                        {m.sign === 0 ? '—' : `${m.sign < 0 ? '−' : '+'}${m.currency === 'VES' ? fmtBs(m.amount) : fmtUsd(m.amount)}`}
                      </TableCell>
                      <TableCell className="text-xs" data-movement-user={m.user_name || '(sin asignar)'}>
                        {m.user_name || '(sin asignar)'}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">{m.reference || '—'}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">{m.note || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {effectiveTab === 'salud' && (        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi icon={<Wallet className="size-3.5" />} label="Ingresos del período"
              value={profit ? fmtUsd(profit.income_usd) : '—'} accent="bg-success/10 text-success" className="text-success" />
            <Kpi icon={<PiggyBank className="size-3.5" />} label="Utilidad bruta"
              value={profit ? `${fmtUsd(profit.profit_usd)} (${profit.margin_pct.toFixed(1)}%)` : '—'}
              accent="bg-primary/10 text-primary" />
            <Kpi icon={<Clock className="size-3.5" />} label="Por cobrar a clientes"
              value={receivables ? fmtUsd(receivables.total_usd) : '—'}
              accent={receivables && receivables.total_usd > 0.005 ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}
              className={receivables && receivables.total_usd > 0.005 ? 'text-warning' : ''} />
            <Kpi icon={<Package className="size-3.5" />} label="Capital en inventario"
              value={inventoryValue ? fmtUsd(inventoryValue.cost_usd) : '—'}
              accent="bg-muted text-muted-foreground" />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Utilidad del período</CardTitle>
              <CardDescription className="text-xs">
                Ingresos cobrados − costo de mercancía (precio de costo ACTUAL del producto; Bs convertidos a tasa BCV {profit?.tasa_bcv ? profit.tasa_bcv.toFixed(2) : 'del período'}). Costo de pantallas: solo órdenes con pantalla exacta.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">Ventas</p>
                <p className="text-lg font-bold tabular-nums text-success">{profit ? fmtUsd(profit.sales_income_usd + (profit.sales_income_bs > 0.005 && profit.tasa_bcv > 0 ? profit.sales_income_bs / profit.tasa_bcv : 0)) : '—'}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Costo: {fmtUsd(profit?.sales_cost_usd ?? 0)} · Utilidad: <span className="font-semibold text-success">{fmtUsd((profit?.sales_income_usd ?? 0) + ((profit?.sales_income_bs ?? 0) > 0.005 && (profit?.tasa_bcv ?? 0) > 0 ? (profit?.sales_income_bs ?? 0) / (profit?.tasa_bcv ?? 1) : 0) - (profit?.sales_cost_usd ?? 0))}</span>
                </p>
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">Servicios</p>
                <p className="text-lg font-bold tabular-nums">{profit ? fmtUsd(profit.services_income_usd + (profit.services_income_bs > 0.005 && profit.tasa_bcv > 0 ? profit.services_income_bs / profit.tasa_bcv : 0)) : '—'}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Costo pantallas: {fmtUsd(profit?.services_cost_usd ?? 0)} · Utilidad: <span className="font-semibold">{fmtUsd((profit?.services_income_usd ?? 0) + ((profit?.services_income_bs ?? 0) > 0.005 && (profit?.tasa_bcv ?? 0) > 0 ? (profit?.services_income_bs ?? 0) / (profit?.tasa_bcv ?? 1) : 0) - (profit?.services_cost_usd ?? 0))}</span>
                </p>
              </div>
              <div className="rounded-md border bg-primary/5 border-primary/20 p-3">
                <p className="text-xs font-medium text-muted-foreground">Vs. período anterior (mismo largo)</p>
                {profit && prevProfit && prevProfit.income_usd > 0 ? (
                  <>
                    <p className="text-lg font-bold tabular-nums">
                      {fmtUsd(profit.income_usd - prevProfit.income_usd)}
                    </p>
                    <p className={`text-xs font-semibold ${profit.income_usd >= prevProfit.income_usd ? 'text-success' : 'text-danger'}`}>
                      {((profit.income_usd - prevProfit.income_usd) / prevProfit.income_usd * 100).toFixed(1)}% vs {prevProfit.start}–{prevProfit.end}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin datos del período anterior</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Cuentas por cobrar</CardTitle>
                <CardDescription className="text-xs">
                  {receivables ? `${receivables.count} órdenes activas con saldo pendiente` : 'Cargando…'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {receivables?.buckets.map(b => (
                  <div key={b.label} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium">{b.label}</span>
                      <Badge variant="outline">{b.count}</Badge>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${b.total_usd > 0.005 ? 'text-warning' : 'text-muted-foreground'}`}>
                      {b.total_usd > 0.005 ? fmtUsd(b.total_usd) : '—'}
                    </span>
                  </div>
                ))}
                {receivables && receivables.items.length > 0 && (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Orden</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                          <TableHead className="text-right">Días</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receivables.items.map((it, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{it.order_num}</TableCell>
                            <TableCell className="text-sm">{it.client}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-warning">{fmtUsd(it.saldo_usd)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${it.days_open > 30 ? 'text-danger font-semibold' : it.days_open > 7 ? 'text-warning' : 'text-muted-foreground'}`}>{Math.max(0, it.days_open)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {receivables && receivables.items.length === 0 && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-success" /> Sin deudas pendientes
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Inventario</CardTitle>
                <CardDescription className="text-xs">
                  {inventoryValue ? `${inventoryValue.units} unidades — capital inmovilizado vs. potencial de venta` : 'Cargando…'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Capital invertido</p>
                    <p className="text-lg font-bold tabular-nums">{fmtUsd(inventoryValue?.cost_usd ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">stock × costo</p>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Potencial de venta</p>
                    <p className="text-lg font-bold tabular-nums text-success">{fmtUsd(inventoryValue?.sale_usd ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">stock × precio de venta</p>
                  </div>
                </div>
                {inventoryValue && inventoryValue.categories.length > 0 && (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Categoría</TableHead>
                          <TableHead className="text-right">Unidades</TableHead>
                          <TableHead className="text-right">Capital</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inventoryValue.categories.map((c, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{c.category_name ?? 'Sin categoría'}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.units}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(c.cost_usd)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <AlertDialog open={expenseToDelete !== null} onOpenChange={o => { if (!o) setExpenseToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar gasto</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el gasto {expenseToDelete ? `${expenseToDelete.category} · ${expenseToDelete.currency === 'USD' ? fmtUsd(expenseToDelete.amount) : fmtBs(expenseToDelete.amount)} (${expenseToDelete.expense_date})` : ''}. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (expenseToDelete) doDeleteExpense(expenseToDelete.id); setExpenseToDelete(null); }}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showExpenseDialog} onOpenChange={setShowExpenseDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar gasto</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Fecha</label>
              <Input type="date" value={expDate} onChange={e => setExpDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Categoría</label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={expCategory}
                onChange={e => setExpCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Monto</label>
              <MoneyInput value={expAmount} onChange={setExpAmount} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Moneda</label>
              <div className="flex gap-2">
                <Button type="button" variant={expCurrency === 'USD' ? 'default' : 'outline'} className="flex-1" onClick={() => setExpCurrency('USD')}>$ Dólares</Button>
                <Button type="button" variant={expCurrency === 'VES' ? 'default' : 'outline'} className="flex-1" onClick={() => setExpCurrency('VES')}>Bs. Bolívares</Button>
              </div>
            </div>
            {/* F69 — ¿DE DÓNDE SALIÓ LA PLATA? Es lo que decide si el gasto baja el esperado del cajón
                al cerrar el día. Antes no se preguntaba y el cajón «faltaba» en un día perfecto. */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">¿De dónde salió la plata?</label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                data-field="exp-metodo" value={expMethod} onChange={e => setExpMethod(e.target.value)}>
                <option value="">Sin declarar (no baja el cajón)</option>
                {PAYMENT_METHODS.filter(Boolean).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground" data-field="exp-metodo-aviso">
                {esDeCajon(expMethod)
                  ? `Sale del cajón: el cierre del ${expDate} va a esperar ${expCurrency === 'VES' ? 'bolívares' : 'dólares'} de menos.`
                  : expMethod
                    ? `Pagado con ${expMethod}: no toca el cajón (se concilia por banco).`
                    : 'Sin declarar: no toca el cajón y el cierre del día lo va a avisar.'}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Notas</label>
              <Input value={expNotes} onChange={e => setExpNotes(e.target.value)} placeholder="Detalle del gasto..." />
            </div>
            {expError && <p className="text-sm text-danger">{expError}</p>}
            {expWarning && <p className="text-sm text-warning">{expWarning}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExpenseDialog(false)}>Cancelar</Button>
            <Button onClick={doAddExpense}>
              <Plus className="size-4" /> Guardar gasto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showOpen} onOpenChange={setShowOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{activeDay ? 'Actualizar Día (tasa BCV)' : 'Abrir Día'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {activeDay && (
              <p className="text-xs text-muted-foreground">
                El día {activeDay.close_date} ya está abierto: guardar actualiza la tasa y la apertura
                sin cerrarlo (útil si se abrió sin tasa BCV).
              </p>
            )}
            {openTasaUsd <= 0 && (
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5 [&>svg]:text-warning">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs text-amber-800">
                  Sin tasa BCV no se puede cobrar en bolívares (las conversiones dan 0 y los pagos en
                  Bs quedan bloqueados). Puedes guardar igual y corregirla después con
                  <strong> "Actualizar día"</strong>.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Efectivo de apertura ($)</label>
              <MoneyInput value={openInitial} onChange={setOpenInitial} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Tasa Bs/USD</label>
              <div className="flex gap-2">
                <Input type="number" step={0.01} min={0} value={openTasaUsd}
                  onChange={e => setOpenTasaUsd(Number(e.target.value))} />
                <Button variant="outline" onClick={autoBcv}>
                  <RefreshCw className="size-4" /> Auto BCV
                </Button>
              </div>
              {lastTasa > 0 && (
                <p className="text-xs text-muted-foreground">
                  Última tasa registrada: <strong>{lastTasa.toFixed(2)}</strong> — verifica que sea la del día
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Tasa Bs/EUR</label>
              <Input type="number" step={0.01} min={0} value={openTasaEur}
                onChange={e => setOpenTasaEur(Number(e.target.value))} />
            </div>
            {bcvError && (
              <p className="text-sm text-danger">No se pudo obtener la tasa, ingrésala manualmente</p>
            )}
            {openError && <p className="text-sm text-danger">{openError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOpen(false)}>Cancelar</Button>
            <Button onClick={doOpen}>
              <Play className="size-4" /> {activeDay ? 'Actualizar Día' : 'Abrir Día'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showClose} onOpenChange={setShowClose}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle>Cerrar Día: {cierreRow?.close_date}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            <div>
              <p className="text-sm font-semibold mb-2">Cobros del día por método</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <MethodRow icon={<DollarSign className="size-3.5" />} label="Divisas (USD Cash)"
                  detail="Dinero en efectivo dólares" value={fmtUsd((expected?.usd_cash_total ?? 0) + (expected?.cash_usd ?? 0))}
                  valueClass="text-success" />
                <MethodRow icon={<Banknote className="size-3.5" />} label="Efectivo Bs"
                  detail="Bolívares en caja — se cuenta abajo" value={fmtBs(expected?.cash_bs ?? 0)}
                  valueClass="text-warning" />
                {(expected?.pos_net_usd ?? 0) > 0.005 && (
                  <MethodRow icon={<CreditCard className="size-3.5" />} label="Punto de Venta ($)"
                    detail="Punto en dólares · neto tras comisión" value={fmtUsd(expected?.pos_net_usd ?? 0)}
                    valueClass="text-success" />
                )}
                {(expected?.pos_net_bs ?? 0) > 0.005 && (
                  <MethodRow icon={<CreditCard className="size-3.5" />} label="Punto de Venta (Bs)"
                    detail="Punto en bolívares · neto tras comisión" value={fmtBs(expected?.pos_net_bs ?? 0)}
                    valueClass="text-warning" />
                )}
                <MethodRow icon={<Smartphone className="size-3.5" />} label="Pago Móvil"
                  detail={`${pagoMovilList.length} pago(s) por referencia`}
                  value={fmtBs(expected?.pago_movil_total ?? 0)} valueClass="text-warning" />
                {(expected?.zelle_total ?? 0) > 0 && (
                  <MethodRow icon={<Globe className="size-3.5" />} label="Transferencia Zelle"
                    detail="Cobros por Zelle en USD" value={fmtUsd(expected?.zelle_total ?? 0)}
                    valueClass="text-success" />
                )}
                {(expected?.transfer_bs_total ?? 0) > 0 && (
                  <MethodRow icon={<Landmark className="size-3.5" />} label="Transferencia Bs"
                    detail="Transferencias bancarias en bolívares" value={fmtBs(expected?.transfer_bs_total ?? 0)}
                    valueClass="text-warning" />
                )}
                <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2.5 sm:col-span-2">
                  <div>
                    <span className="text-sm font-bold">Total General del día</span>
                    <p className="text-[11px] text-muted-foreground">
                      ≈ ${(expected?.grand_total ?? 0).toFixed(2)} USD
                    </p>
                  </div>
                  <span className="text-base font-extrabold tabular-nums">{totalCell(expected?.grand_usd ?? 0, expected?.grand_bs ?? 0)}</span>
                </div>
              </div>
            </div>
            {/* F69 — DE DÓNDE SALE EL NÚMERO QUE HAY QUE CONTAR. Antes el cierre pedía contar el cajón
                contra un esperado que no incluía el fondo ni los gastos pagados del cajón: un día
                perfecto «faltaba» exactamente lo que se pagó del cajón y «sobraba» el fondo. */}
            <div className="rounded-md border bg-muted/40 px-3 py-2.5" data-panel="desglose-cajon">
              <p className="text-sm font-semibold mb-2">Lo que debe haber en el cajón</p>
              <div className="flex flex-col gap-1">
                {desglose.lineas.map((l, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className={l.monto < 0 ? 'text-danger' : 'text-muted-foreground'}>
                      {i > 0 && l.monto >= 0 ? '+ ' : ''}{l.etiqueta}
                    </span>
                    {/* F69 — cada línea con SU moneda (antes la de Bs. salía con el formato del dólar:
                        «Gastos pagados del cajón (Bs.) − $500.00»). */}
                    <span className={`tabular-nums font-medium ${l.monto < 0 ? 'text-danger' : ''}`}>
                      {l.monto < 0
                        ? `− ${formatoMoneda(Math.abs(l.monto), l.moneda)}`
                        : formatoMoneda(l.monto, l.moneda)}
                    </span>
                  </div>
                ))}
                <Separator className="my-1" />
                <div className="flex items-center justify-between text-sm font-bold">
                  <span>Esperado en el cajón (lo que hay que contar)</span>
                  <span className="tabular-nums" data-field="esperado-cajon">
                    {fmtUsd(desglose.esperado_usd)}
                    {Math.abs(desglose.esperado_bs) > 0.005 && <> + {fmtBs(desglose.esperado_bs)}</>}
                  </span>
                </div>
              </div>
              {(hay(desglose.devuelto_usd) || hay(desglose.devuelto_bs)) && (
                <p className="text-[11px] text-danger mt-2" data-field="cajon-devoluciones">
                  Devuelto hoy del cajón: {fmtMix(desglose.devuelto_usd, desglose.devuelto_bs)} — ya está
                  restado en lo cobrado de arriba (por eso se cobró más de lo que hay).
                </p>
              )}
              {ajuste.sin_metodo > 0 && (
                <p className="text-[11px] text-warning mt-2" data-field="cajon-sin-metodo">
                  {ajuste.sin_metodo} gasto(s) del día sin declarar de dónde salió la plata: NO se descuentan
                  del cajón. Anotalo al registrarlos (Gastos → ¿De dónde salió la plata?) y volvé a cerrar.
                </p>
              )}
            </div>
            {todayExpenses.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                <span className="font-medium flex items-center gap-2">
                  <Receipt className="size-4" /> Gastos del {cierreRow?.close_date} ({todayExpenses.length})
                </span>
                <span className="font-semibold tabular-nums">
                  {fmtUsd(todayExpenses.filter(e => e.currency === 'USD').reduce((a, e) => a + e.amount, 0))}
                  {todayExpenses.some(e => e.currency === 'VES') && (
                    <> + {fmtBs(todayExpenses.filter(e => e.currency === 'VES').reduce((a, e) => a + e.amount, 0))}</>
                  )}
                </span>
              </div>
            )}
            {/* F69 (revisión adversarial, BLOQUEANTE) — EL PUNTO SE DIBUJA SIEMPRE QUE LA REGLA LO PIDA.
                El bloque se mostraba sólo con `pos_charged_* > 0`, pero `lineasDelArqueo` incluye la
                línea con `|monto| > 0.005`: un día con el Punto en NEGATIVO (una devolución anotada
                por Punto, el caso real documentado en F42) exigía confirmar una línea que no existía en
                pantalla → el cierre quedaba imposible («Falta contar/verificar: Punto: monto impreso»).
                Ahora manda la MISMA condición que la regla (`tieneLinea`). */}
            {(tieneLinea('pos_usd') || tieneLinea('pos_bs')) && (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold">Punto de Venta — monto impreso</p>
                <p className="text-xs text-muted-foreground">
                  {tieneLinea('pos_usd') && <>El sistema cobró <strong>{fmtUsd(lineaArqueo('pos_usd').monto)}</strong>{' '}</>}
                  {tieneLinea('pos_bs') && <>{(lineaArqueo('pos_bs').monto < 0) ? 'El Punto quedó en ' : 'y '}<strong>{fmtBs(lineaArqueo('pos_bs').monto)}</strong></>}
                  {' '}por Punto. Escribí el monto total que imprimió la máquina al cerrarla — debe dar el mismo.
                  {(lineaArqueo('pos_usd').monto < 0 || lineaArqueo('pos_bs').monto < 0) && (
                    <> Un Punto en negativo significa que por ahí salió plata (una devolución): corregí el
                    método de esa devolución en la orden y el Punto vuelve a su lugar.</>
                  )}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tieneLinea('pos_usd') && (
                    <ConteoLinea linea={lineaArqueo('pos_usd')} contado={posSettledUsd}
                      confirmada={!!confirmadas.pos_usd}
                      onContado={v => { setPosSettledUsd(v); setConfirmadas(c => ({ ...c, pos_usd: true })); }}
                      onConfirmar={() => { setPosSettledUsd(lineaArqueo('pos_usd').monto); setConfirmadas(c => ({ ...c, pos_usd: true })); }} />
                  )}
                  {tieneLinea('pos_bs') && (
                    <ConteoLinea linea={lineaArqueo('pos_bs')} contado={posSettledBs}
                      confirmada={!!confirmadas.pos_bs}
                      onContado={v => { setPosSettledBs(v); setConfirmadas(c => ({ ...c, pos_bs: true })); }}
                      onConfirmar={() => { setPosSettledBs(lineaArqueo('pos_bs').monto); setConfirmadas(c => ({ ...c, pos_bs: true })); }} />
                  )}
                </div>
              </div>
            )}
            {/* F69 — EL ARQUEO: cada línea tiene que quedar CONFIRMADA por el operario (contada con las
                manos o verificada en el banco). Antes los digitales entraban con el monto del sistema y
                su diferencia daba 0 siempre. */}
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold">Arqueo — contá el cajón y verificá el banco</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* El CAJÓN se cuenta SIEMPRE en las dos monedas (regla en `lineasDelArqueo`): si el
                    esperado es 0 y en el cajón hay plata, la diferencia tiene que verse. */}
                {tieneLinea('usd') && (
                  <ConteoLinea linea={lineaArqueo('usd')} contado={usdCounted} confirmada={!!confirmadas.usd}
                    onContado={v => { setUsdCounted(v); setConfirmadas(c => ({ ...c, usd: true })); }}
                    onConfirmar={() => { setUsdCounted(lineaArqueo('usd').monto); setConfirmadas(c => ({ ...c, usd: true })); }} />
                )}
                {tieneLinea('bs') && (
                  <ConteoLinea linea={lineaArqueo('bs')} contado={cashCounted} confirmada={!!confirmadas.bs}
                    onContado={v => { setCashCounted(v); setConfirmadas(c => ({ ...c, bs: true })); }}
                    onConfirmar={() => { setCashCounted(lineaArqueo('bs').monto); setConfirmadas(c => ({ ...c, bs: true })); }} />
                )}
                {tieneLinea('zelle') && (
                  <ConteoLinea linea={lineaArqueo('zelle')} contado={zelleVerified} confirmada={!!confirmadas.zelle}
                    onContado={v => { setZelleVerified(v); setConfirmadas(c => ({ ...c, zelle: true })); }}
                    onConfirmar={() => { setZelleVerified(lineaArqueo('zelle').monto); setConfirmadas(c => ({ ...c, zelle: true })); }} />
                )}
                {tieneLinea('pago_movil') && (
                  <ConteoLinea linea={lineaArqueo('pago_movil')} contado={pmVerified} confirmada={!!confirmadas.pago_movil}
                    onContado={v => { setPmVerified(v); setConfirmadas(c => ({ ...c, pago_movil: true })); }}
                    onConfirmar={() => { setPmVerified(lineaArqueo('pago_movil').monto); setConfirmadas(c => ({ ...c, pago_movil: true })); }} />
                )}
                {tieneLinea('trans_bs') && (
                  <ConteoLinea linea={lineaArqueo('trans_bs')} contado={transVerified} confirmada={!!confirmadas.trans_bs}
                    onContado={v => { setTransVerified(v); setConfirmadas(c => ({ ...c, trans_bs: true })); }}
                    onConfirmar={() => { setTransVerified(lineaArqueo('trans_bs').monto); setConfirmadas(c => ({ ...c, trans_bs: true })); }} />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Las divisas y los bolívares se cuentan con las manos. Los cobros <span className="font-medium">digitales</span>
                {' '}(Zelle, Pago Móvil, Transferencia Bs.) no están en el cajón: se verifican en la app del banco, y lo que
                verifiques es lo que queda guardado (si no coincide con lo cobrado, la diferencia se ve y se guarda).
              </p>
              {faltanConfirmar.length > 0 && (
                <p className="text-sm text-warning" data-field="faltan-confirmar">{faltaConfirmar(faltanConfirmar)}</p>
              )}
            </div>
            {/* El resumen del arqueo por moneda: la MISMA regla pura que la lista de Cierres. No se
                muestra un «Cuadra ✅» mientras falte contar algo: un número sin contar no es un
                número, y decir «cuadra» con los valores del sistema es exactamente el engaño que
                tenía este diálogo (la diferencia daba 0 sin que nadie mirara el cajón ni el banco). */}
            <div className="flex flex-wrap items-center gap-4 rounded-md border px-3 py-2 text-sm"
              data-field="resumen-arqueo">
              {faltanConfirmar.length > 0 ? (
                <span className="text-warning">{faltaConfirmar(faltanConfirmar)}</span>
              ) : (
                <>
                  <span>
                    Diferencia $:{' '}
                    <span className={`font-bold ${Math.abs(diffUsd) < TOL_USD ? 'text-success' : 'text-danger'}`}
                      data-field="dif-usd" data-ok={Math.abs(diffUsd) < TOL_USD}>
                      {diffUsd > 0 ? '+' : ''}{fmtUsd(diffUsd)}
                    </span>
                  </span>
                  <span>
                    Diferencia Bs.:{' '}
                    <span className={`font-bold ${Math.abs(diffBs) < TOL_BS ? 'text-success' : 'text-danger'}`}
                      data-field="dif-bs" data-ok={Math.abs(diffBs) < TOL_BS}>
                      {diffBs > 0 ? '+' : ''}{fmtBs(diffBs)}
                    </span>
                  </span>
                  {diffCierre.cuadrado
                    ? <span className="text-success font-medium">Cuadra ✅</span>
                    : <span className="text-danger font-medium" data-field="dif-resumen">{closingLabel(diffCierre)}</span>}
                </>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Pago Móvil del día</p>
              {pagoMovilList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin pagos móviles hoy</p>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Referencia</TableHead>
                        <TableHead className="text-right">Monto (Bs.)</TableHead>
                        <TableHead>Origen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagoMovilList.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{p.reference ? `····${p.reference.slice(-4)}` : 'Sin referencia'}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(p.amount)}</TableCell>
                          <TableCell>{p.source}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell className="font-medium">Total</TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{money(pagoMovilTotal)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Lo que <span className="font-medium">verifiques en el banco</span> es lo que queda guardado en el cierre:
              si no coincide con lo que el sistema cobró, la diferencia se ve y se guarda (no se tapa con el esperado).
            </p>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Notas</label>
              <Input value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder="Observaciones del cierre..." />
            </div>
            {!expected && (
              <p className="text-sm text-danger">
                No se pudieron leer los totales del día: cerrá este diálogo y volvé a abrirlo. Cerrar sin
                leer el día guardaría un arqueo en 0 que después parece «falta todo el cajón».
              </p>
            )}
            {closeError && <p className="text-sm text-danger">{closeError}</p>}
          </div>
          <DialogFooter className="shrink-0 border-t pt-3">
            <Button variant="outline" onClick={() => setShowClose(false)}>Cancelar</Button>
            <Button onClick={doClose} disabled={!expected}>
              <Lock className="size-4" /> Cerrar Día
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showSettle} onOpenChange={() => setShowSettle(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Liquidación Punto: {showSettle?.close_date}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="text-sm flex flex-col gap-1">
              <p>Cargado esperado (sistema): <strong>{fmtMix(settleChargedUsd, settleChargedBs)}</strong></p>
              <p className="text-muted-foreground">Registra el monto total impreso por la máquina del Punto — debe dar el mismo.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Monto impreso ($)</label>
              <MoneyInput value={settleAmount} onChange={setSettleAmount} />
            </div>
            {settleChargedBs > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Monto impreso (Bs.)</label>
                <MoneyInput value={settleAmountBs} onChange={setSettleAmountBs} />
              </div>
            )}
            {(settleChargedUsd > 0 || settleAmount > 0) && (
              <div className="text-sm">
                Diferencia ($): <span className={Math.abs(settleDiff.usd) < TOL_USD ? 'text-success' : 'text-danger'}
                  data-field="settle-dif-usd" data-ok={Math.abs(settleDiff.usd) < TOL_USD}>
                  {settleDiff.usd > 0 ? '+' : ''}{fmtUsd(settleDiff.usd)}
                </span>
              </div>
            )}
            {(settleChargedBs > 0 || settleAmountBs > 0) && (
              <div className="text-sm">
                Diferencia (Bs.): <span className={Math.abs(settleDiff.bs) < TOL_BS ? 'text-success' : 'text-danger'}
                  data-field="settle-dif-bs" data-ok={Math.abs(settleDiff.bs) < TOL_BS}>
                  {settleDiff.bs > 0 ? '+' : ''}{fmtBs(settleDiff.bs)}
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettle(null)}>Cancelar</Button>
            <Button onClick={doSettle}>Guardar Liquidación</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{pinStatus ? 'Configurar PIN' : 'Crear PIN de dueño'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {!pinStatus ? (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">PIN nuevo (4 dígitos)</label>
                  <Input type="text" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={pinNew} onChange={e => setPinNew(digits(e.target.value))} />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Confirmar PIN</label>
                  <Input type="text" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={pinConfirm} onChange={e => setPinConfirm(digits(e.target.value))} />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold">Cambiar PIN</p>
                  <label className="text-sm font-medium">PIN actual</label>
                  <Input type="text" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={pinCurrent} onChange={e => setPinCurrent(digits(e.target.value))} />
                  <label className="text-sm font-medium">PIN nuevo</label>
                  <Input type="text" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={pinNew} onChange={e => setPinNew(digits(e.target.value))} />
                  <label className="text-sm font-medium">Confirmar PIN nuevo</label>
                  <Input type="text" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={pinConfirm} onChange={e => setPinConfirm(digits(e.target.value))} />
                  <Button onClick={changePin} className="w-full">Cambiar PIN</Button>
                </div>
                <div className="flex flex-col gap-2 border-t pt-3">
                  <p className="text-sm font-semibold">Quitar PIN</p>
                  <label className="text-sm font-medium">PIN actual</label>
                  <Input type="text" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={pinCurrent} onChange={e => setPinCurrent(digits(e.target.value))} />
                  <Button variant="outline" onClick={doRemovePin} className="w-full">Quitar PIN</Button>
                </div>
              </>
            )}
            {pinError && <p className="text-sm text-danger">{pinError}</p>}
            {!pinStatus && (
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPinDialog(false)}>Cancelar</Button>
                <Button onClick={savePin}>Guardar</Button>
              </DialogFooter>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!drillDate} onOpenChange={() => setDrillDate(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle className="flex items-center gap-2">
              <Eye className="size-4" /> Detalle de pagos — {drillDate}
              {drillMethod && <Badge variant="secondary">{drillMethod}</Badge>}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {drillLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Cargando...</p>
            ) : drillResults.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin pagos registrados para este día/método</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Orden</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drillResults.map(p => (
                    <TableRow key={p.id}>
                      {/* Un pago RETROACTIVO se guarda solo con la fecha (la hora real del cobro de
                          ese día es desconocida): se muestra «—» en vez de vacío o de un «00:00»
                          inventado. Los pagos del día sí traen su hora. */}
                      <TableCell className="whitespace-nowrap">{p.payment_date && p.payment_date.length > 10 ? p.payment_date.slice(11, 16) : '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{p.order_num ?? '—'}</Badge></TableCell>
                      <TableCell>{p.client ?? '—'}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{p.model ?? '—'}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${p.currency === 'VES' ? 'text-warning' : 'text-success'}`}>
                        {p.currency === 'VES' ? fmtBs(p.amount) : fmtUsd(p.amount)}
                      </TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs">{p.payment_method ?? '—'}</Badge></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.zelle_reference || '—'}</TableCell>
                    </TableRow>
                  ))}
                  {drillResults.length > 0 && (() => {
                    const tUsd = drillResults.filter(p => p.currency !== 'VES').reduce((a, p) => a + p.amount, 0);
                    const tBs = drillResults.filter(p => p.currency === 'VES').reduce((a, p) => a + p.amount, 0);
                    return (
                      <TableRow className="bg-muted/50">
                        <TableCell className="font-semibold" colSpan={4}>
                          Total ({drillResults.length} pago{drillResults.length !== 1 ? 's' : ''})
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {tUsd > 0.005 && <span className="text-success">{fmtUsd(tUsd)}</span>}
                          {tUsd > 0.005 && tBs > 0.005 && ' + '}
                          {tBs > 0.005 && <span className="text-warning">{fmtBs(tBs)}</span>}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    );
                  })()}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t pt-3">
            <Button variant="outline" onClick={() => setDrillDate(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
