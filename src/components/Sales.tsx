import { useEffect, useState } from 'react';
import { Plus, Search, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

import { api } from '../db';
import type { Sale, Product, PaymentMethod, SaleStat } from '../types';

export default function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [, setProducts] = useState<Product[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('todo');
  const [showForm, setShowForm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<SaleStat[]>([]);
  const [statsDays, setStatsDays] = useState(7);

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
    const [s, p, m] = await Promise.all([
      api.getSales(search, days, start, end),
      api.getProducts(),
      api.getPaymentMethods(),
    ]);
    setSales(s);
    setProducts(p);
    setMethods(m);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [period, search]);

  const openStats = async (days: number) => {
    setStatsDays(days);
    setStats(await api.getSalesStats(days));
    setShowStats(true);
  };

  const totalAmount = sales.reduce((a, s) => a + s.total, 0);
  const totalQty = sales.reduce((a, s) => a + s.quantity, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground mt-1">Registro de ventas y estadísticas</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> Nueva Venta
        </Button>
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
          <CardContent><div className="text-2xl font-bold text-success">${totalAmount.toFixed(2)}</div></CardContent>
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
                    <TableCell className="text-right font-bold">${s.total.toFixed(2)}</TableCell>
                    <TableCell><Badge variant="outline">{s.payment_method ?? '-'}</Badge></TableCell>
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

function SaleForm({ methods, onClose, onSaved }: {
  methods: PaymentMethod[];
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

  useEffect(() => {
    api.getProducts('', null).then(setCatalog);
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
      setProductOpen(filtered.length > 0);
    } else {
      setSuggestions([]);
    }
  }, [productQuery, catalog]);

  useEffect(() => {
    if (clientQuery.length > 0) {
      api.suggestClients(clientQuery, 8).then(setClientSugs);
    } else {
      setClientSugs([]);
    }
  }, [clientQuery]);

  const selectProduct = (p: Product) => {
    setProductId(p.id);
    setProductName(p.name);
    setPrice(p.price_sale);
    setProductQuery(p.name);
    setProductOpen(false);
  };

  const selectClient = (c: { id: number; name: string }) => {
    setClientId(c.id);
    setClientName(c.name);
    setClientQuery(c.name);
    setClientOpen(false);
  };

  const save = async () => {
    if (!productName) return;
    if (price <= 0) return;
    setSaving(true);
    try {
      let cid = clientId;
      if (clientName && !cid) {
        cid = await api.addOrFindClient(clientName, '');
      }
      const total = quantity * price;
      await api.addSale(productId, productName, quantity, price, total, method, clientName, cid, notes);
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
              onChange={e => { setProductQuery(e.target.value); setProductOpen(true); }}
              onFocus={() => setProductOpen(true)} />
            {productOpen && suggestions.length > 0 && (
              <div className="rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                {suggestions.map(p => {
                  const compatList = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
                  return (
                    <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0"
                      onClick={() => selectProduct(p)}>
                      <span className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</span>
                      {p.brand && <span className="text-muted-foreground ml-1">{p.brand} {p.model}</span>}
                      <span className="float-right text-muted-foreground">${p.price_sale.toFixed(2)} · Stock: {p.stock}</span>
                      {compatList.length > 0 && (
                        <div className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                          {compatList.join(' · ')}
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
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {methods.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente</label>
              <Input placeholder="Buscar o escribir nombre..." value={clientQuery}
                onChange={e => { setClientQuery(e.target.value); setClientOpen(true); }}
                onFocus={() => setClientOpen(true)} />
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Notas</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : `Guardar Venta ($${(quantity * price).toFixed(2)})`}
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
