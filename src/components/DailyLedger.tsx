import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, CheckCircle2, CreditCard, Download, Landmark, Lock, Play, RefreshCw,
  RotateCcw, DollarSign, TrendingUp, Smartphone, Banknote, Globe, ArrowRightLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import MoneyInput from '@/components/ui/money-input';
import { api } from '../db';
import type { DailyTotals, DailyClosing, PagoMovilDetail } from '../types';

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
const fmtBs = (n: number) => `Bs.${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default function DailyLedger({ role = 'owner' }: { role?: 'owner' | 'cashier' }) {
  const isOwner = role === 'owner';
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState<'diario' | 'cierres'>('diario');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
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
  const [pagoMovilList, setPagoMovilList] = useState<PagoMovilDetail[]>([]);
  const [closeNotes, setCloseNotes] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [showSettle, setShowSettle] = useState<DailyClosing | null>(null);
  const [settleAmount, setSettleAmount] = useState(0);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinStatus, setPinStatus] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinNew, setPinNew] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const effectiveTab = isOwner ? tab : 'diario';
  const effectiveStart = isOwner ? startDate : today;
  const effectiveEnd = isOwner ? endDate : today;

  const loadTotals = async () => {
    setTotals(await api.getDailyTotals(effectiveStart, effectiveEnd));
  };

  const loadClosings = async () => {
    setClosings(await api.getDailyClosings());
  };

  const refreshActiveDay = async () => {
    try {
      setActiveDay(await api.getActiveDay());
    } catch {
      setActiveDay(null);
    }
  };

  useEffect(() => { if (tab === 'diario') loadTotals(); }, [tab, startDate, endDate, isOwner]);
  useEffect(() => { if (tab === 'cierres') loadClosings(); }, [tab]);
  useEffect(() => { refreshActiveDay(); }, []);
  useEffect(() => {
    api.getPinStatus().then(setPinStatus).catch(() => setPinStatus(false));
  }, []);

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
    setShowClose(true);
    setCloseNotes('');
    setCloseError(null);
    setPagoMovilList([]);
    try {
      const dayTotals = await api.getDailyTotals(activeDay.close_date, activeDay.close_date);
      const t = dayTotals[0] ?? null;
      setExpected(t);
      setCashCounted(t?.cash_bs ?? 0);
      const pms = await api.getPagoMovilDetail(activeDay.close_date);
      setPagoMovilList(pms);
    } catch {
      setExpected(null);
      setCashCounted(0);
    }
  };

  const doClose = async () => {
    if (!activeDay) return;
    setCloseError(null);
    try {
      await api.closeDay(
        activeDay.close_date, closeNotes,
        activeDay.initial_cash_usd, activeDay.tasa_bcv, activeDay.tasa_eur,
        expected?.usd_cash_total ?? 0, cashCounted,
        expected?.pos_charged ?? 0, 0,
        expected?.zelle_total ?? 0,
        expected?.pago_movil_total ?? 0,
        expected?.transfer_bs_total ?? 0
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
    await api.updateDailyClosingSettlement(showSettle.id, settleAmount);
    setShowSettle(null);
    loadClosings();
  };

  const doExport = async () => {
    setExportMsg(null);
    try {
      const date = activeDay?.close_date ?? today;
      const path = await api.exportDailyReport(date);
      setExportMsg({ ok: true, text: `Reporte exportado: ${path}` });
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
  }), { pos_charged: 0, pos_fees: 0, pos_net: 0, pos_net_usd: 0, pos_net_bs: 0, pos_charged_usd: 0, pos_charged_bs: 0, pago_movil: 0, cash_bs: 0, usd: 0, zelle: 0, trans_bs: 0, grand_usd: 0, grand_bs: 0, grand_total: 0 }), [totals]);

  const hasPos = totals.some(t => t.pos_net_usd > 0.005 || t.pos_net_bs > 0.005);
  const hasPM = totals.some(t => t.pago_movil_total > 0.005);
  const hasCashBs = totals.some(t => t.cash_bs > 0.005);
  const hasUsd = totals.some(t => t.usd_cash_total + t.cash_usd > 0.005);
  const hasZelle = totals.some(t => t.zelle_total > 0.005);
  const hasTransf = totals.some(t => t.transfer_bs_total > 0.005);
  const condCols = [hasPos, hasPM, hasCashBs, hasUsd, hasZelle, hasTransf].filter(Boolean).length;
  const tableCols = 3 + condCols;
  const dash = (n: number, fmt: (x: number) => string) => (n > 0.005 ? fmt(n) : '—');
  const diasConMovimientos = totals.filter(t => t.grand_usd > 0.005 || t.grand_bs > 0.005).length;

  const diffBs = expected ? cashCounted - expected.cash_bs : 0;
  const cuadrado = expected !== null && Math.abs(diffBs) < 0.5;
  const pagoMovilTotal = pagoMovilList.reduce((a, p) => a + p.amount, 0);

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
              <p className="text-sm text-emerald-700/80">Tasa Bs {activeDay.tasa_bcv.toFixed(2)} · Apertura ${activeDay.initial_cash_usd.toFixed(2)}</p>
            </div>
          </div>
          <Button variant="default" onClick={openCloseDialog}>
            <Lock className="size-4" /> Cerrar Día
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-3 text-amber-700">
            <Lock className="size-5" />
            <p className="font-semibold">Día CERRADO — no se pueden registrar ventas ni servicios</p>
          </div>
          <Button variant="default" onClick={() => {
            setShowOpen(true);
            setOpenInitial(0);
            setOpenTasaUsd(0);
            setOpenTasaEur(0);
            setOpenError(null);
            setBcvError(false);
          }}>
            <Play className="size-4" /> Abrir Día
          </Button>
        </div>
      )}

      {isOwner && effectiveTab === 'diario' && (
        <div className="flex items-center gap-2">
          <Input type="date" value={startDate}
            onChange={e => setStartDate(e.target.value)} className="w-44" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={endDate}
            onChange={e => setEndDate(e.target.value)} className="w-44" />
          <Button onClick={loadTotals} variant="outline">
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
          </div>

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
                        <TableCell className="font-medium">{t.date}</TableCell>
                        {hasPos && (
                          <TableCell className="text-right tabular-nums">
                            {t.pos_net_usd > 0.005 || t.pos_net_bs > 0.005 ? fmtMix(t.pos_net_usd, t.pos_net_bs) : '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-right tabular-nums text-warning">{dash(t.pago_movil_total, fmtBs)}</TableCell>
                        <TableCell className="text-right tabular-nums text-warning">{dash(t.cash_bs, fmtBs)}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{dash(t.usd_cash_total + t.cash_usd, fmtUsd)}</TableCell>
                        {hasZelle && <TableCell className="text-right tabular-nums text-success">{dash(t.zelle_total, fmtUsd)}</TableCell>}
                        {hasTransf && <TableCell className="text-right tabular-nums text-warning">{dash(t.transfer_bs_total, fmtBs)}</TableCell>}
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
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      Sin cierres registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  closings.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.close_date}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(c.pos_net)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.pos_settled > 0
                          ? <span className="font-medium">{fmtUsd(c.pos_settled)}</span>
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
                      <TableCell className="text-right tabular-nums">
                        {c.is_closed ? (
                          <span className={Math.abs(c.difference) < 0.5 ? 'text-success' : 'text-danger'}>
                            {c.difference >= 0 ? '+' : ''}{fmtUsd(c.difference)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {c.is_closed ? (
                          <Badge variant="default" className="bg-success">Cerrado</Badge>
                        ) : (
                          <Badge variant="outline">Abierto</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {c.is_closed && (
                            <Button variant="ghost" size="sm"
                              onClick={() => api.reopenDay(c.close_date).then(() => { loadClosings(); refreshActiveDay(); })}>
                              <RotateCcw className="size-3" />
                            </Button>
                          )}
                          <Button variant="outline" size="sm"
                            onClick={() => { setShowSettle(c); setSettleAmount(c.pos_settled); }}>
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

      <Dialog open={showOpen} onOpenChange={setShowOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Abrir Día</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
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
              <Play className="size-4" /> Abrir Día
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showClose} onOpenChange={setShowClose}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle>Cerrar Día: {activeDay?.close_date}</DialogTitle>
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
                <MethodRow icon={<CreditCard className="size-3.5" />} label="Punto de Venta ($ + Bs)"
                  value={fmtMix(expected?.pos_net_usd ?? 0, expected?.pos_net_bs ?? 0)} valueClass="text-success" />
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
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Efectivo en bolívares contado (Bs)</label>
              <MoneyInput value={cashCounted} onChange={setCashCounted} className="text-lg font-semibold" placeholder="0,00" />
              <div className="flex items-center gap-3 text-sm">
                <span>Diferencia:{' '}
                  <span className={`font-bold ${Math.abs(diffBs) < 0.5 ? 'text-success' : 'text-danger'}`}>
                    {diffBs >= 0 ? '+' : ''}{fmtBs(diffBs)}
                  </span>
                </span>
                {cuadrado && <span className="text-success font-medium">Cuadrado ✅</span>}
              </div>
              <p className="text-xs text-muted-foreground">Debe dar 0,00 para cuadrar. Si no hay efectivo, escribe 0.</p>
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
            <p className="text-xs text-muted-foreground">Los métodos digitales (Punto, Zelle, Pago Móvil, Transf Bs) se registran con los valores esperados del sistema.</p>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Notas</label>
              <Input value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder="Observaciones del cierre..." />
            </div>
            {closeError && <p className="text-sm text-danger">{closeError}</p>}
          </div>
          <DialogFooter className="shrink-0 border-t pt-3">
            <Button variant="outline" onClick={() => setShowClose(false)}>Cancelar</Button>
            <Button onClick={doClose}>
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
              <p>Neto esperado: <strong>${(showSettle?.pos_net ?? 0).toFixed(2)}</strong></p>
              <p className="text-muted-foreground">Registra el monto real liquidado por el banco.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Monto Liquidado ($)</label>
              <MoneyInput value={settleAmount} onChange={setSettleAmount} />
            </div>
            {showSettle && settleAmount > 0 && (
              <div className="text-sm">
                Diferencia: <span className={Math.abs(settleAmount - showSettle.pos_net) < 0.5 ? 'text-success' : 'text-danger'}>
                  {settleAmount >= showSettle.pos_net ? '+' : ''}${(settleAmount - showSettle.pos_net).toFixed(2)}
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
    </div>
  );
}
