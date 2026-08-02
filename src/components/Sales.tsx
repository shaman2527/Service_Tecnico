import { useEffect, useRef, useState } from 'react';
import { Plus, Search, TrendingUp, Lock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

import { api } from '../db';
import { methodCurrency, currencySymbol } from '@/lib/utils';
import type { Sale, Product, PaymentMethod, SaleStat } from '../types';

export default function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('todo');
  const [showForm, setShowForm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<SaleStat[]>([]);
  const [statsDays, setStatsDays] = useState(7);
  const [dayOpen, setDayOpen] = useState<boolean | null>(null);

  const load = async () => {
    let days: number | null = null;
    let start = '', end = '';
    if (period === '7d') days = 7;
    else if (period === '30d') days = 30;
    else if (period === 'mes') {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      end = now.toISOString().slice(0, 10);
    }
    const [s, m] = await Promise.all([
      api.getSales(search, days, start, end),
      api.getPaymentMethods(),
    ]);
    setSales(s);
    setMethods(m);
  };

  useEffect(() => { load(); }, []);
  // Debounce: la búsqueda solo consulta tras 350ms de inactividad
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [period, search]);

  useEffect(() => {
    api.getActiveDay().then(d => setDayOpen(!!d)).catch(() => setDayOpen(true));
  }, []);

  const openStats = async (days: number) => {
    setStatsDays(days);
    setStats(await api.getSalesStats(days));
    setShowStats(true);
  };

  const totalUsd = sales.reduce((a, s) => a + (s.currency === 'VES' ? 0 : s.total), 0);
  const totalBs = sales.reduce((a, s) => a + (s.currency === 'VES' ? s.total : 0), 0);
  const totalQty = sales.reduce((a, s) => a + s.quantity, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground mt-1">Registro de ventas y estadísticas</p>
        </div>
        <div className="flex items-center gap-3">
          {dayOpen === false && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
              <Lock className="size-4" /> Día cerrado — abre el día en Libro Diario para registrar ventas
            </div>
          )}
          {dayOpen === true && (
            <span className="text-sm text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="size-4" /> Día abierto
            </span>
          )}
          <Button onClick={() => setShowForm(true)}>
            <Plus className="size-4" /> Nueva Venta
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Ventas</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{sales.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Unidades</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalQty}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">${totalUsd.toFixed(2)}</div>
            {totalBs > 0 && <div className="text-sm text-muted-foreground">+ Bs. {totalBs.toFixed(2)}</div>}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar producto o cliente..." className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todo">Todo</SelectItem>
            <SelectItem value="7d">7 días</SelectItem>
            <SelectItem value="30d">30 días</SelectItem>
            <SelectItem value="mes">Este mes</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => openStats(7)}>
          <TrendingUp className="size-4" /> Stats
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cant</TableHead>
                <TableHead className="text-right">P/U</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Cliente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Sin ventas registradas
                  </TableCell>
                </TableRow>
              ) : (
                sales.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="text-muted-foreground text-xs">{s.id}</TableCell>
                    <TableCell>{s.date ?? '-'}</TableCell>
                    <TableCell className="font-medium">{s.product_name ?? '-'}</TableCell>
                    <TableCell className="text-right">{s.quantity}</TableCell>
                    <TableCell className="text-right">${s.unit_price.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold">{currencySymbol(s.currency)}{s.total.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.payment_method ?? '-'}</Badge>
                      {((s.payment_method ?? '').includes('Móvil') || (s.payment_method ?? '').includes('Movil') || (s.payment_method ?? '').includes('Zelle')) && s.zelle_reference && (
                        <div className="text-[11px] text-muted-foreground">ref ····{s.zelle_reference.slice(-4)}</div>
                      )}
                    </TableCell>
                    <TableCell>{s.client_name ?? '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showForm && (
        <SaleForm
          methods={methods}
          dayOpen={dayOpen}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}

      {showStats && (
        <StatsModal
          title={statsDays === 7 ? 'Stats semanales' : 'Stats mensuales'}
          stats={stats}
          onClose={() => setShowStats(false)}
        />
      )}
    </div>
  );
}

function SaleForm({ methods, dayOpen, onClose, onSaved }: {
  methods: PaymentMethod[];
  dayOpen: boolean | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [productOpen, setProductOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [method, setMethod] = useState(methods[0]?.name ?? '');
  const [clientName, setClientName] = useState('');
  const [clientId, setClientId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [clientSugs, setClientSugs] = useState<{ id: number; name: string; phone: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [reference, setReference] = useState('');
  const [tasaBcv, setTasaBcv] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const productPicked = useRef(false);
  const clientPicked = useRef(false);

  useEffect(() => {
    api.getProducts('', null).then(setCatalog);
    api.getActiveDay().then(d => setTasaBcv(d?.tasa_bcv ?? 0)).catch(() => {});
  }, []);

  useEffect(() => {
    const q = productQuery.trim().toLowerCase();
    if (q.length >= 1 && catalog.length > 0) {
      const filtered = catalog
        .filter(p => {
          const compat = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
          const hay = [p.name, p.brand ?? '', p.model ?? '', ...compat].join(' ').toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 12);
      setSuggestions(filtered);
      setProductOpen(filtered.length > 0 && !productPicked.current);
    } else {
      setSuggestions([]);
    }
  }, [productQuery, catalog]);

  useEffect(() => {
    if (clientQuery.length > 0 && !clientPicked.current) {
      api.suggestClients(clientQuery, 8).then(setClientSugs);
    } else {
      setClientSugs([]);
    }
  }, [clientQuery]);

  const selectProduct = (p: Product) => {
    productPicked.current = true;
    setProductId(p.id);
    setProductName(p.name);
    setPrice(p.price_sale);
    setProductQuery(p.name);
    setProductOpen(false);
  };

  const selectClient = (c: { id: number; name: string }) => {
    clientPicked.current = true;
    setClientId(c.id);
    setClientName(c.name);
    setClientQuery(c.name);
    setClientOpen(false);
  };

  const isRef = method.includes('Móvil') || method.includes('Movil') || method.includes('Zelle');
  const saleCurrency = methodCurrency(method);
  const isBs = saleCurrency === 'VES';
  const totalUsdTmp = quantity * price;
  const totalFinal = isBs ? totalUsdTmp * tasaBcv : totalUsdTmp;

  const save = async () => {
    if (!productName) return;
    if (price <= 0) return;
    if (isBs && tasaBcv <= 0) {
      setSaveError('Para vender en bolívares se necesita la tasa BCV del día. Ábrela en Libro Diario (el día debe estar abierto con tasa).');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let cid = clientId;
      if (clientName && !cid) {
        cid = await api.addOrFindClient(clientName, '');
      }
      const total = quantity * price;
      await api.addSale(productId, productName, quantity, price, isBs ? total * tasaBcv : total, method, clientName, cid, notes, 0, reference, saleCurrency);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva Venta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Producto</label>
            <Input placeholder="Buscar producto..." value={productQuery}
              onChange={e => { productPicked.current = false; setProductQuery(e.target.value); setProductOpen(true); }} />
            {productOpen && suggestions.length > 0 && (
              <div className="rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                {suggestions.map(p => {
                  const compatList = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
                  const outOfStock = p.stock <= 0;
                  return (
                    <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0"
                      onClick={() => selectProduct(p)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</span>
                        <span className={outOfStock ? 'text-danger font-semibold text-xs shrink-0' : 'text-muted-foreground text-xs shrink-0'}>
                          ${p.price_sale.toFixed(2)} · Stock: {p.stock}
                        </span>
                      </div>
                      {p.brand && <span className="text-muted-foreground text-xs">{p.brand} {p.model}</span>}
                      {compatList.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {compatList.map(m => (
                            <span key={m} className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cantidad</label>
              <Input type="number" min={1} value={quantity}
                onChange={e => setQuantity(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Precio Unitario ($)</label>
              <Input type="number" step={0.01} min={0} value={price}
                onChange={e => setPrice(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Método de Pago</label>
              <Select value={method} onValueChange={m => { setMethod(m); setSaveError(null); if (!m.includes('Móvil') && !m.includes('Movil') && !m.includes('Zelle')) setReference(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {methods.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {methodCurrency(method) === 'VES' && (
                <p className="text-xs text-amber-600">
                  {tasaBcv > 0
                    ? `Se cobra en bolívares: total ≈ Bs. ${totalFinal.toFixed(2)} (tasa BCV ${tasaBcv.toFixed(2)})`
                    : 'Sin tasa BCV en el día abierto — abre/actualiza el día en Libro Diario para cobrar en Bs.'}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente</label>
              <Input placeholder="Buscar o escribir nombre..." value={clientQuery}
                onChange={e => { clientPicked.current = false; setClientQuery(e.target.value); setClientOpen(true); }} />
              {clientOpen && clientSugs.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {clientSugs.map(c => (
                    <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0"
                      onClick={() => selectClient(c)}>
                      <span className="font-medium">{c.name}</span>
                      {c.phone && <span className="text-muted-foreground ml-2">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isRef && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Referencia</label>
              <Input placeholder="Número de referencia (últimos 4 dígitos)..." value={reference}
                onChange={e => setReference(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Notas</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          {saveError && <p className="text-sm text-danger">{saveError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || dayOpen === false || !productName || price <= 0}>
            {saving ? 'Guardando...' : `Guardar Venta (${isBs ? `Bs. ${totalFinal.toFixed(2)}` : `$${totalUsdTmp.toFixed(2)}`})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatsModal({ title, stats, onClose }: { title: string; stats: SaleStat[]; onClose: () => void }) {
  const totalQty = stats.reduce((a, s) => a + s.qty, 0);
  const totalAmount = stats.reduce((a, s) => a + s.total, 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-4">
          Total: <strong>{totalQty}</strong> unidades · <strong>${totalAmount.toFixed(2)}</strong>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Ventas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{s.product_name ?? 'N/A'}</TableCell>
                <TableCell className="text-right">{s.qty}</TableCell>
                <TableCell className="text-right">${s.total.toFixed(2)}</TableCell>
                <TableCell className="text-right">{s.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DialogFooter>
          <Button onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
