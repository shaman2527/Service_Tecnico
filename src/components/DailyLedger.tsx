import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, Lock, RotateCcw, DollarSign, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import type { DailyTotals, DailyClosing } from '../types';

export default function DailyLedger() {
  const [tab, setTab] = useState<'diario' | 'cierres'>('diario');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [totals, setTotals] = useState<DailyTotals[]>([]);
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [showClose, setShowClose] = useState<string | null>(null);
  const [closeNotes, setCloseNotes] = useState('');
  const [showSettle, setShowSettle] = useState<DailyClosing | null>(null);
  const [settleAmount, setSettleAmount] = useState(0);

  const loadTotals = async () => {
    setTotals(await api.getDailyTotals(startDate, endDate));
  };

  const loadClosings = async () => {
    setClosings(await api.getDailyClosings());
  };

  useEffect(() => { if (tab === 'diario') loadTotals(); }, [tab, startDate, endDate]);
  useEffect(() => { if (tab === 'cierres') loadClosings(); }, [tab]);

  const doClose = async () => {
    if (!showClose) return;
    await api.closeDay(showClose, closeNotes);
    setShowClose(null);
    setCloseNotes('');
    loadTotals();
    loadClosings();
  };

  const doSettle = async () => {
    if (!showSettle) return;
    await api.updateDailyClosingSettlement(showSettle.id, settleAmount);
    setShowSettle(null);
    loadClosings();
  };

  const grandTotal = totals.reduce((a, t) => a + t.grand_total, 0);

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
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
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
                        <TableCell>
                          <Button variant="outline" size="sm"
                            onClick={() => setShowClose(t.date)}>
                            <CheckCircle2 className="size-3" /> Cerrar
                          </Button>
                        </TableCell>
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
                  <TableHead className="text-right font-bold">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-24"></TableHead>
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
                  closings.map(c => {
                    const diff = c.pos_settled - c.pos_net;
                    return (
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
                          {c.pos_settled > 0 ? (
                            <span className={Math.abs(diff) < 0.5 ? 'text-success' : 'text-danger'}>
                              {diff >= 0 ? '+' : ''}${diff.toFixed(2)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">${(c.cash_usd + c.cash_bs).toFixed(2)}</TableCell>
                        <TableCell className="text-right">${c.zelle_total.toFixed(2)}</TableCell>
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
                                onClick={() => api.reopenDay(c.close_date).then(loadClosings)}>
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
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!showClose} onOpenChange={() => setShowClose(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cerrar Día: {showClose}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Se calcularán los totales del día y se registrará el cierre.
              {totals.find(t => t.date === showClose) && (
                <span className="block mt-2 font-medium text-foreground">
                  Total: ${totals.find(t => t.date === showClose)!.grand_total.toFixed(2)}
                </span>
              )}
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notas</label>
              <Input value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder="Observaciones del cierre..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClose(null)}>Cancelar</Button>
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