import { useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, CheckCircle2, Clock, CreditCard, Download, Landmark, Lock, Package,
  Play, Plus, PiggyBank, Receipt, RefreshCw, RotateCcw, DollarSign, TrendingUp, Smartphone,
  Banknote, Globe, ArrowRightLeft, Trash2, Wallet, Pencil, AlertTriangle, Search, X, Eye, Undo2,
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
import type { DailyTotals, DailyClosing, PagoMovilDetail, DaySummary, Expense, ProfitSummary, ReceivablesSummary, InventoryValue, PaymentSearchResult } from '../types';
import { EXPENSE_CATEGORIES } from '../types';
import { localDate, addDays } from '@/lib/utils';
// F39: el arqueo cuadra POR MONEDA (dos diferencias, dos semáforos). Regla pura con test node.
import { closingDifference, closingLabel, sinContar, puntoDifference, TOL_USD, TOL_BS } from '@/lib/cash-closing';

// El signo va ANTES del símbolo de la moneda («-$2.00», «-Bs. 1.000,00»), que es como se escribe un
// descuadre en un libro: «$-2.00» se lee mal y en el arqueo la diferencia puede ser negativa.
const fmtUsd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const fmtBs = (n: number) => `${n < 0 ? '-' : ''}Bs.${Math.abs(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

const PAYMENT_METHODS = [
  '', 'Pago Móvil', 'Efectivo Bs', 'Divisas (USD Cash)', 'Punto de Venta ($)',
  'Punto de Venta (Bs)', 'Transferencia Zelle', 'Transferencia Bs',
];

export default function DailyLedger({ role = 'owner' }: { role?: 'owner' | 'cashier' }) {
  const isOwner = role === 'owner';
  // Fecha LOCAL del local (ver `localDate`): con toISOString() el «hoy» del Libro Diario pasaba
  // al día siguiente después de las 20:00 en Venezuela y el día aparecía sin movimientos.
  const today = localDate();
  const [tab, setTab] = useState<'diario' | 'cierres' | 'pagos' | 'gastos' | 'salud'>('diario');
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
  const [expNotes, setExpNotes] = useState('');
  const [expError, setExpError] = useState<string | null>(null);
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

  const effectiveTab = isOwner ? tab : 'diario';
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

  const loadTodayExpenses = async () => {
    try { setTodayExpenses(await api.getExpenses(today, today)); } catch { setTodayExpenses([]); }
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

  const doAddExpense = async () => {
    setExpError(null);
    if (expAmount <= 0) { setExpError('El monto debe ser mayor que 0.'); return; }
    try {
      await api.addExpense(expDate, expCategory, expAmount, expCurrency, expNotes);
      setShowExpenseDialog(false);
      setExpAmount(0); setExpNotes('');
      setExpenseMsg('Gasto registrado.');
      loadExpenses(); loadTodayExpenses();
      setTimeout(() => setExpenseMsg(null), 4000);
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

  useEffect(() => { if (tab === 'diario') loadTotals(); }, [tab, startDate, endDate, isOwner]);
  useEffect(() => { if (tab === 'cierres') loadClosings(); }, [tab]);
  useEffect(() => { if (tab === 'gastos') loadExpenses(); }, [tab, startDate, endDate]);
  useEffect(() => { if (tab === 'salud') loadSalud(); }, [tab, startDate, endDate]);

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
    if (!row) return;
    setCierreRow(row);
    setShowClose(true);
    setCloseNotes('');
    setCloseError(null);
    setPagoMovilList([]);
    loadTodayExpenses();
    try {
      const dayTotals = await api.getDailyTotals(row.close_date, row.close_date);
      const t = dayTotals[0] ?? null;
      setExpected(t);
      setCashCounted(t?.cash_bs ?? 0);
      // El conteo de divisas arranca en lo que el sistema espera (para confirmar o corregir, igual que
      // los bolívares) pero es EDITABLE: si el cajón tiene menos dólares, la diferencia se ve.
      setUsdCounted((t?.usd_cash_total ?? 0) + (t?.cash_usd ?? 0));
      // Monto impreso del Punto: prellenado con lo que el sistema espera (regla: debe dar el mismo)
      setPosSettledUsd(t?.pos_charged_usd ?? 0);
      setPosSettledBs(t?.pos_charged_bs ?? 0);
      const pms = await api.getPagoMovilDetail(row.close_date);
      setPagoMovilList(pms);
    } catch {
      setExpected(null);
      setCashCounted(0);
      setUsdCounted(0);
      setPosSettledUsd(0);
      setPosSettledBs(0);
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
    setCloseError(null);
    try {
      await api.closeDay(
        cierreRow.close_date, closeNotes,
        cierreRow.initial_cash_usd, cierreRow.tasa_bcv, cierreRow.tasa_eur,
        usdCounted, cashCounted,
        expected?.pos_charged ?? 0, 0,
        expected?.zelle_total ?? 0,
        expected?.pago_movil_total ?? 0,
        expected?.transfer_bs_total ?? 0,
        posSettledUsd, posSettledBs
      );
      setShowClose(false);
      refreshActiveDay();
      loadClosings();
      loadTotals();
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

  // F39 (revisión adversarial): la diferencia del diálogo sale de la MISMA regla pura que la lista de
  // Cierres (`closingDifference`), no de una resta propia. Lo único que aporta la UI es lo CONTADO
  // (divisas y efectivo Bs.); los cobros digitales (Zelle, Pago Móvil, Transferencia, Punto) entran con
  // su monto esperado porque no están en el cajón: se verifican en el banco, y el diálogo lo dice.
  const diffCierre = closingDifference({
    cash_usd: expected?.cash_usd ?? 0,
    zelle_total: expected?.zelle_total ?? 0,
    usd_cash_total: expected?.usd_cash_total ?? 0,
    cash_bs: expected?.cash_bs ?? 0,
    pago_movil_total: expected?.pago_movil_total ?? 0,
    transfer_bs_total: expected?.transfer_bs_total ?? 0,
    actual_cash_usd: usdCounted,
    actual_zelle: expected?.zelle_total ?? 0,
    actual_cash_bs: cashCounted,
    actual_pago_movil: expected?.pago_movil_total ?? 0,
    actual_transfer_bs: expected?.transfer_bs_total ?? 0,
  });
  const diffBs = diffCierre.bs;
  const diffUsd = diffCierre.usd;
  const pagoMovilTotal = pagoMovilList.reduce((a, p) => a + p.amount, 0);
  // F39: la liquidación del Punto también cuadra POR MONEDA (misma regla pura que el arqueo).
  const settleDiff = puntoDifference(settleChargedUsd, settleAmount, settleChargedBs, settleAmountBs);
  // …y el Punto que se declara al CERRAR el día usa exactamente la misma regla (no una resta aparte).
  const puntoDiff = puntoDifference(expected?.pos_charged_usd ?? 0, posSettledUsd, expected?.pos_charged_bs ?? 0, posSettledBs);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Libro Diario</h1>
          <p className="text-sm text-muted-foreground mt-1">Control financiero y cierre diario</p>
        </div>
        <div className="flex gap-2">
          {isOwner && (
            <>
              <Button variant="outline" onClick={doExport}>
                <Download className="size-4" /> Exportar Excel
              </Button>
              <Button variant="outline" onClick={() => {
                setShowPinDialog(true);
                setPinError(null);
                setPinNew(''); setPinConfirm(''); setPinCurrent('');
              }}>
                <Lock className="size-4" /> PIN
              </Button>
            </>
          )}
          <Button variant={effectiveTab === 'diario' ? 'default' : 'outline'} onClick={() => setTab('diario')}>
            <BookOpen className="size-4" /> Diario
          </Button>
          {isOwner && (
            <Button variant={tab === 'cierres' ? 'default' : 'outline'} onClick={() => setTab('cierres')}>
              <Lock className="size-4" /> Cierres
            </Button>
          )}
          {isOwner && (
            <Button variant={tab === 'pagos' ? 'default' : 'outline'} onClick={() => setTab('pagos')}>
              <CreditCard className="size-4" /> Pagos
            </Button>
          )}
          {isOwner && (
            <Button variant={tab === 'gastos' ? 'default' : 'outline'} onClick={() => setTab('gastos')}>
              <Receipt className="size-4" /> Gastos
            </Button>
          )}
          {isOwner && (
            <Button variant={tab === 'salud' ? 'default' : 'outline'} onClick={() => setTab('salud')}>
              <Activity className="size-4" /> Salud
            </Button>
          )}
        </div>
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
            <Button variant="default" onClick={openCloseDialog}>
              <Lock className="size-4" /> Cerrar Día
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-3 text-amber-700">
            <Lock className="size-5" />
            <p className="font-semibold">Día CERRADO — no se pueden registrar ventas ni servicios</p>
          </div>
          <Button variant="default" onClick={() => openOpenDialog(false)}>
            <Play className="size-4" /> Abrir Día
          </Button>
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
              Gastos del negocio registrados entre {startDate} y {endDate} — no afectan el arqueo de caja
            </p>
            <Button onClick={() => { setExpDate(today); setExpCategory('Otro'); setExpAmount(0); setExpCurrency('USD'); setExpNotes(''); setExpError(null); setShowExpenseDialog(true); }}>
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
                    <TableHead>Notas</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
                      <TableCell colSpan={2} />
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

      {effectiveTab === 'salud' && (
        <>
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
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Notas</label>
              <Input value={expNotes} onChange={e => setExpNotes(e.target.value)} placeholder="Detalle del gasto..." />
            </div>
            {expError && <p className="text-sm text-danger">{expError}</p>}
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
            {todayExpenses.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                <span className="font-medium flex items-center gap-2">
                  <Receipt className="size-4" /> Gastos del día ({todayExpenses.length})
                </span>
                <span className="font-semibold tabular-nums">
                  {fmtUsd(todayExpenses.filter(e => e.currency === 'USD').reduce((a, e) => a + e.amount, 0))}
                  {todayExpenses.some(e => e.currency === 'VES') && (
                    <> + {fmtBs(todayExpenses.filter(e => e.currency === 'VES').reduce((a, e) => a + e.amount, 0))}</>
                  )}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Punto de Venta — monto impreso</p>
              <p className="text-xs text-muted-foreground">
                {((expected?.pos_charged_usd ?? 0) > 0 || (expected?.pos_charged_bs ?? 0) > 0) ? (
                  <>
                    El sistema cobró{' '}
                    {(expected?.pos_charged_usd ?? 0) > 0 && <><strong>{fmtUsd(expected?.pos_charged_usd ?? 0)}</strong>{' '}</>}
                    {(expected?.pos_charged_bs ?? 0) > 0 && <><strong>{fmtBs(expected?.pos_charged_bs ?? 0)}</strong></>}
                    {' '}por Punto. Escribe el monto total que imprimió la máquina al cerrarla — debe dar el mismo.
                  </>
                ) : (
                  'No hubo cobros por Punto de Venta hoy.'
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(expected?.pos_charged_usd ?? 0) > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">Monto impreso ($)</label>
                    <MoneyInput value={posSettledUsd} onChange={setPosSettledUsd} />
                  </div>
                )}
                {(expected?.pos_charged_bs ?? 0) > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">Monto impreso (Bs.)</label>
                    <MoneyInput value={posSettledBs} onChange={setPosSettledBs} />
                  </div>
                )}
              </div>
              {(expected?.pos_charged_usd ?? 0) > 0 && (
                <div className="flex items-center gap-3 text-sm">
                  <span>Diferencia ($):{' '}
                    <span className={`font-bold ${Math.abs(puntoDiff.usd) < TOL_USD ? 'text-success' : 'text-danger'}`}>
                      {puntoDiff.usd > 0 ? '+' : ''}{fmtUsd(puntoDiff.usd)}
                    </span>
                  </span>
                  {Math.abs(puntoDiff.usd) < TOL_USD && <span className="text-success font-medium">Cuadrado ✅</span>}
                </div>
              )}
              {(expected?.pos_charged_bs ?? 0) > 0 && (
                <div className="flex items-center gap-3 text-sm">
                  <span>Diferencia (Bs.):{' '}
                    <span className={`font-bold ${Math.abs(puntoDiff.bs) < TOL_BS ? 'text-success' : 'text-danger'}`}>
                      {puntoDiff.bs > 0 ? '+' : ''}{fmtBs(puntoDiff.bs)}
                    </span>
                  </span>
                  {Math.abs(puntoDiff.bs) < TOL_BS && <span className="text-success font-medium">Cuadrado ✅</span>}
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Divisas contadas ($)</label>
                <MoneyInput value={usdCounted} onChange={setUsdCounted} className="text-lg font-semibold" placeholder="0,00" />
                <div className="flex items-center gap-3 text-sm">
                  <span>Diferencia:{' '}
                    <span className={`font-bold ${Math.abs(diffUsd) < TOL_USD ? 'text-success' : 'text-danger'}`}
                      data-field="dif-usd" data-ok={Math.abs(diffUsd) < TOL_USD}>
                      {diffUsd > 0 ? '+' : ''}{fmtUsd(diffUsd)}
                    </span>
                  </span>
                  {Math.abs(diffUsd) < TOL_USD && <span className="text-success font-medium">Cuadrado ✅</span>}
                </div>
                <p className="text-xs text-muted-foreground">Cuenta los dólares del cajón. El sistema espera {fmtUsd((expected?.usd_cash_total ?? 0) + (expected?.cash_usd ?? 0))}.</p>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Efectivo en bolívares contado (Bs)</label>
                <MoneyInput value={cashCounted} onChange={setCashCounted} className="text-lg font-semibold" placeholder="0,00" />
                <div className="flex items-center gap-3 text-sm">
                  <span>Diferencia:{' '}
                    <span className={`font-bold ${Math.abs(diffBs) < TOL_BS ? 'text-success' : 'text-danger'}`}
                      data-field="dif-bs" data-ok={Math.abs(diffBs) < TOL_BS}>
                      {diffBs > 0 ? '+' : ''}{fmtBs(diffBs)}
                    </span>
                  </span>
                  {Math.abs(diffBs) < TOL_BS && <span className="text-success font-medium">Cuadrado ✅</span>}
                </div>
                <p className="text-xs text-muted-foreground">Debe dar 0,00 para cuadrar. Si no hay efectivo, escribe 0.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Los cobros <span className="font-medium">digitales</span> (Zelle, Pago Móvil, Punto) no se cuentan en el cajón:
              se verifican en la app del banco y entran por su monto esperado.
            </p>
            {/* F42: el cierre tiene que decir qué se DEVOLVIÓ hoy. Si no, el operario ve un esperado más
                bajo que lo que cobró y no sabe por qué (la devolución ya está restada del método por el
                que salió la plata). */}
            {(hay(expected?.refund_usd ?? 0) || hay(expected?.refund_bs ?? 0)) && (
              <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs" data-field="cierre-devoluciones">
                <span className="font-medium text-danger">Devuelto hoy: {fmtMix(expected?.refund_usd ?? 0, expected?.refund_bs ?? 0)}</span>
                {' '}— ya está restado del esperado del método por el que salió la plata (por eso el cajón o el
                banco esperan menos de lo que se cobró).
              </div>
            )}
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
            <p className="text-xs text-muted-foreground">Zelle, Pago Móvil y Transf Bs se registran con los valores esperados del sistema.</p>
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
