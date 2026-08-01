import { useEffect, useState, type ChangeEvent } from 'react';
import { BookOpen, CheckCircle2, Lock, Play, RefreshCw, RotateCcw, DollarSign, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import type { DailyTotals, DailyClosing } from '../types';

function SummaryItem({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md border bg-muted/50 px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-semibold ${valueClass ?? ''}`}>{value}</div>
    </div>
  );
}

export default function DailyLedger() {
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
  const [closeNotes, setCloseNotes] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [arqueo, setArqueo] = useState({
    actualCashUsd: 0, actualCashBs: 0, actualPuntoUsd: 0, actualPuntoBs: 0,
    actualZelle: 0, actualPagoMovil: 0, actualTransferBs: 0,
  });
  const [showSettle, setShowSettle] = useState<DailyClosing | null>(null);
  const [settleAmount, setSettleAmount] = useState(0);

  const loadTotals = async () => {
    setTotals(await api.getDailyTotals(startDate, endDate));
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

  useEffect(() => { if (tab === 'diario') loadTotals(); }, [tab, startDate, endDate]);
  useEffect(() => { if (tab === 'cierres') loadClosings(); }, [tab]);
  useEffect(() => { refreshActiveDay(); }, []);

  const setArq = (key: keyof typeof arqueo) => (e: ChangeEvent<HTMLInputElement>) =>
    setArqueo(a => ({ ...a, [key]: Number(e.target.value) }));

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
    try {
      const dayTotals = await api.getDailyTotals(activeDay.close_date, activeDay.close_date);
      const t = dayTotals[0] ?? null;
      setExpected(t);
      setArqueo({
        actualCashUsd: t?.usd_cash_total ?? 0,
        actualCashBs: t?.cash_bs ?? 0,
        actualPuntoUsd: t?.pos_charged ?? 0,
        actualPuntoBs: 0,
        actualZelle: t?.zelle_total ?? 0,
        actualPagoMovil: t?.pago_movil_total ?? 0,
        actualTransferBs: t?.transfer_bs_total ?? 0,
      });
    } catch {
      setExpected(null);
    }
  };

  const doClose = async () => {
    if (!activeDay) return;
    setCloseError(null);
    try {
      await api.closeDay(
        activeDay.close_date, closeNotes,
        activeDay.initial_cash_usd, activeDay.tasa_bcv, activeDay.tasa_eur,
        arqueo.actualCashUsd, arqueo.actualCashBs, arqueo.actualPuntoUsd, arqueo.actualPuntoBs,
        arqueo.actualZelle, arqueo.actualPagoMovil, arqueo.actualTransferBs
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
    if (!showSettle) return;
    await api.updateDailyClosingSettlement(showSettle.id, settleAmount);
    setShowSettle(null);
    loadClosings();
  };

  const grandTotal = totals.reduce((a, t) => a + t.grand_total, 0);
  const diffUsd = expected
    ? (arqueo.actualCashUsd + arqueo.actualZelle + arqueo.actualPuntoUsd) - (expected.usd_cash_total + expected.zelle_total + expected.pos_charged)
    : 0;
  const diffBs = expected
    ? (arqueo.actualCashBs + arqueo.actualPagoMovil + arqueo.actualTransferBs + arqueo.actualPuntoBs) - (expected.cash_bs + expected.pago_movil_total + expected.transfer_bs_total)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Libro Diario</h1>
          <p className="text-sm text-muted-foreground mt-1">Control financiero y cierre diario</p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'diario' ? 'default' : 'outline'} onClick={() => setTab('diario')}>
            <BookOpen className="size-4" /> Diario
          </Button>
          <Button variant={tab === 'cierres' ? 'default' : 'outline'} onClick={() => setTab('cierres')}>
            <Lock className="size-4" /> Cierres
          </Button>
        </div>
      </div>

      {activeDay ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-3 text-emerald-700">
            <CheckCircle2 className="size-5" />
            <div>
              <p className="font-semibold">Día ABIERTO — {activeDay.close_date}</p>
              <p className="text-sm">Tasa Bs {activeDay.tasa_bcv.toFixed(2)} · Apertura ${activeDay.initial_cash_usd.toFixed(2)}</p>
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

      {tab === 'diario' && (
        <>
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Punto Cargado</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">${totals.reduce((a, t) => a + t.pos_charged, 0).toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Comisión Punto</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-danger">${totals.reduce((a, t) => a + t.pos_fees, 0).toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Neto Punto</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">${totals.reduce((a, t) => a + t.pos_net, 0).toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total General</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-success">${grandTotal.toFixed(2)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Punto ($)</TableHead>
                    <TableHead className="text-right">Comisión</TableHead>
                    <TableHead className="text-right">Neto Punto</TableHead>
                    <TableHead className="text-right">Efectivo $</TableHead>
                    <TableHead className="text-right">Efectivo Bs</TableHead>
                    <TableHead className="text-right">Zelle</TableHead>
                    <TableHead className="text-right">Pago Móvil</TableHead>
                    <TableHead className="text-right">Transf Bs</TableHead>
                    <TableHead className="text-right">USD Cash</TableHead>
                    <TableHead className="text-right font-bold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                        Sin transacciones en este período
                      </TableCell>
                    </TableRow>
                  ) : (
                    totals.map(t => (
                      <TableRow key={t.date}>
                        <TableCell className="font-medium">{t.date}</TableCell>
                        <TableCell className="text-right">${t.pos_charged.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-danger">${t.pos_fees.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${t.pos_net.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${t.cash_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-right">Bs.{t.cash_bs.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${t.zelle_total.toFixed(2)}</TableCell>
                        <TableCell className="text-right">Bs.{t.pago_movil_total.toFixed(2)}</TableCell>
                        <TableCell className="text-right">Bs.{t.transfer_bs_total.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${t.usd_cash_total.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-bold">${t.grand_total.toFixed(2)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'cierres' && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Punto Cargado</TableHead>
                  <TableHead className="text-right">Comisiones</TableHead>
                  <TableHead className="text-right">Neto Esperado</TableHead>
                  <TableHead className="text-right">Liquidado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right">Efectivo</TableHead>
                  <TableHead className="text-right">Zelle</TableHead>
                  <TableHead className="text-right">Tasa</TableHead>
                  <TableHead>Apertura</TableHead>
                  <TableHead className="text-right font-bold">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      Sin cierres registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  closings.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.close_date}</TableCell>
                      <TableCell className="text-right">${c.pos_charged.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-danger">${c.pos_fees.toFixed(2)}</TableCell>
                      <TableCell className="text-right">${c.pos_net.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        {c.pos_settled > 0
                          ? <span className="font-medium">${c.pos_settled.toFixed(2)}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-right">
                        {c.is_closed ? (
                          <span className={Math.abs(c.difference) < 0.5 ? 'text-success' : 'text-danger'}>
                            {c.difference >= 0 ? '+' : ''}${c.difference.toFixed(2)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">${(c.cash_usd + c.cash_bs).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${c.zelle_total.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{c.tasa_bcv > 0 ? c.tasa_bcv.toFixed(2) : '—'}</TableCell>
                      <TableCell className="text-muted-foreground" title={c.opened_at ?? undefined}>
                        {c.opened_at ? c.opened_at.slice(0, 16) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-bold">${c.grand_total.toFixed(2)}</TableCell>
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
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Efectivo de apertura ($)</label>
              <Input type="number" step={0.01} min={0} value={openInitial}
                onChange={e => setOpenInitial(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tasa Bs/USD</label>
              <div className="flex gap-2">
                <Input type="number" step={0.01} min={0} value={openTasaUsd}
                  onChange={e => setOpenTasaUsd(Number(e.target.value))} />
                <Button variant="outline" onClick={autoBcv}>
                  <RefreshCw className="size-4" /> Auto BCV
                </Button>
              </div>
            </div>
            <div className="space-y-2">
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cerrar Día: {activeDay?.close_date}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <SummaryItem label="Punto $" value={`$${(expected?.pos_charged ?? 0).toFixed(2)}`} />
              <SummaryItem label="Comisión" value={`$${(expected?.pos_fees ?? 0).toFixed(2)}`} valueClass="text-danger" />
              <SummaryItem label="Neto Punto" value={`$${(expected?.pos_net ?? 0).toFixed(2)}`} />
              <SummaryItem label="Efectivo $" value={`$${(expected?.usd_cash_total ?? 0).toFixed(2)}`} />
              <SummaryItem label="Efectivo Bs" value={`Bs.${(expected?.cash_bs ?? 0).toFixed(2)}`} />
              <SummaryItem label="Zelle" value={`$${(expected?.zelle_total ?? 0).toFixed(2)}`} />
              <SummaryItem label="Pago Móvil" value={`Bs.${(expected?.pago_movil_total ?? 0).toFixed(2)}`} />
              <SummaryItem label="Transf Bs" value={`Bs.${(expected?.transfer_bs_total ?? 0).toFixed(2)}`} />
              <SummaryItem label="Total General" value={`$${(expected?.grand_total ?? 0).toFixed(2)}`} valueClass="text-success" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Arqueo de caja (valores reales)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Efectivo USD ($)</label>
                  <Input type="number" step={0.01} min={0} value={arqueo.actualCashUsd} onChange={setArq('actualCashUsd')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Efectivo Bs</label>
                  <Input type="number" step={0.01} min={0} value={arqueo.actualCashBs} onChange={setArq('actualCashBs')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Punto $</label>
                  <Input type="number" step={0.01} min={0} value={arqueo.actualPuntoUsd} onChange={setArq('actualPuntoUsd')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Punto Bs</label>
                  <Input type="number" step={0.01} min={0} value={arqueo.actualPuntoBs} onChange={setArq('actualPuntoBs')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Zelle</label>
                  <Input type="number" step={0.01} min={0} value={arqueo.actualZelle} onChange={setArq('actualZelle')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Pago Móvil</label>
                  <Input type="number" step={0.01} min={0} value={arqueo.actualPagoMovil} onChange={setArq('actualPagoMovil')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Transf Bs</label>
                  <Input type="number" step={0.01} min={0} value={arqueo.actualTransferBs} onChange={setArq('actualTransferBs')} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <span>Diferencia USD:{' '}
                <span className={`font-bold ${Math.abs(diffUsd) < 0.5 ? 'text-success' : 'text-danger'}`}>
                  {diffUsd >= 0 ? '+' : ''}${diffUsd.toFixed(2)}
                </span>
              </span>
              <span>Diferencia Bs:{' '}
                <span className={`font-bold ${Math.abs(diffBs) < 0.5 ? 'text-success' : 'text-danger'}`}>
                  {diffBs >= 0 ? '+' : ''}Bs.{diffBs.toFixed(2)}
                </span>
              </span>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notas</label>
              <Input value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder="Observaciones del cierre..." />
            </div>
            {closeError && <p className="text-sm text-danger">{closeError}</p>}
          </div>
          <DialogFooter>
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
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <p>Neto esperado: <strong>${(showSettle?.pos_net ?? 0).toFixed(2)}</strong></p>
              <p className="text-muted-foreground">Registra el monto real liquidado por el banco.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Monto Liquidado ($)</label>
              <Input type="number" step={0.01} min={0} value={settleAmount}
                onChange={e => setSettleAmount(Number(e.target.value))} />
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
    </div>
  );
}
