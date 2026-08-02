import { useEffect, useState } from 'react';
import { Plus, PackagePlus, ShoppingCart, CheckCircle2, Trash2, AlertTriangle, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api } from '../db';
import type { Product, PurchaseOrder, PurchaseOrderItem } from '../types';

export default function Pedidos() {
  const [products, setProducts] = useState<Product[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [cart, setCart] = useState<{ productId: number; name: string; qty: number; price: number }[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [detailOrder, setDetailOrder] = useState<PurchaseOrder | null>(null);
  const [detailItems, setDetailItems] = useState<PurchaseOrderItem[]>([]);
  const [deleting, setDeleting] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [ps, os, cat] = await Promise.all([api.getReorderSuggestions(), api.getPurchaseOrders(), api.getProducts('', null)]);
    setProducts(ps);
    setOrders(os);
    setCatalog(cat);
  };

  useEffect(() => { load(); }, []);

  const lowStock = products
    .filter(p => {
      if (p.stock < 0) return true;
      if (p.min_stock > 0 && p.stock <= p.min_stock) return true;
      return false;
    })
    .sort((a, b) => a.stock - b.stock);

  const outOfStock = lowStock.filter(p => p.stock <= 0).length;
  const pendingOrders = orders.filter(o => o.status === 'Pendiente').length;

  useEffect(() => {
    const q = productQuery.trim().toLowerCase();
    if (q.length >= 1) {
      setSuggestions(catalog.filter(p => {
        const hay = [p.name, p.brand ?? '', p.model ?? ''].join(' ').toLowerCase();
        return hay.includes(q);
      }).slice(0, 8));
    } else {
      setSuggestions([]);
    }
  }, [productQuery, catalog]);

  const addToCart = (p: Product) => {
    setCart(c => {
      const exists = c.find(i => i.productId === p.id);
      if (exists) return c.map(i => i.productId === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...c, { productId: p.id, name: p.name.replace(/^Pantalla\s+/i, ''), qty: 1, price: p.price_cost > 0 ? p.price_cost : p.price_sale }];
    });
    setProductQuery('');
  };

  const quickAdd = (p: Product) => {
    const need = Math.max(p.min_stock * 2 - p.stock, 1);
    setCart(c => {
      const exists = c.find(i => i.productId === p.id);
      if (exists) return c.map(i => i.productId === p.id ? { ...i, qty: i.qty + need } : i);
      return [...c, { productId: p.id, name: p.name.replace(/^Pantalla\s+/i, ''), qty: need, price: p.price_cost > 0 ? p.price_cost : p.price_sale }];
    });
  };

  const saveOrder = async () => {
    if (cart.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const items = cart.map(i => ({ productId: i.productId, productName: i.name, quantity: i.qty, unitPrice: i.price }));
      await api.addPurchaseOrder(supplier, notes, JSON.stringify(items));
      setShowNew(false);
      setCart([]);
      setSupplier('');
      setNotes('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const receive = async (o: PurchaseOrder) => {
    await api.markPurchaseOrderReceived(o.id);
    await load();
  };

  const remove = async (o: PurchaseOrder) => {
    await api.deletePurchaseOrder(o.id);
    if (detailOrder?.id === o.id) setDetailOrder(null);
    setDeleting(null);
    await load();
  };

  const openDetail = async (o: PurchaseOrder) => {
    setDetailOrder(o);
    setDetailItems(await api.getPurchaseOrderItems(o.id));
  };

  const totalCart = cart.reduce((a, i) => a + i.qty * i.price, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-sm text-muted-foreground mt-1">Compras a proveedor y reposición de inventario</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="size-4" /> Nuevo Pedido
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Productos agotados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-danger">{outOfStock}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stock bajo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{lowStock.length - outOfStock}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pedidos pendientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{pendingOrders}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-warning" /> Por reponer (stock bajo / agotado)
          </CardTitle>
          <span className="text-xs text-muted-foreground">{lowStock.length} productos</span>
        </CardHeader>
        <CardContent className="p-0">
          {lowStock.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Inventario en buen estado — sin productos por reponer.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Stock actual</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Sugerido</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map(p => {
                  const need = Math.max(p.min_stock * 2 - p.stock, 1);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</TableCell>
                      <TableCell>
                        <span className={p.stock <= 0 ? 'font-bold text-danger' : 'font-medium text-warning'}>
                          {p.stock}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{p.min_stock}</TableCell>
                      <TableCell className="text-right font-semibold">{need}</TableCell>
                      <TableCell className="text-right">${(p.price_cost || p.price_sale).toFixed(2)}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => quickAdd(p)}>
                          <Plus className="size-3.5" /> Pedir {need}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="size-4 text-primary" /> Pedidos registrados
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Aún no hay pedidos registrados.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Artículos</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-bold">#{o.id}</TableCell>
                    <TableCell>{o.order_date?.slice(0, 16) ?? '-'}</TableCell>
                    <TableCell>{o.supplier ?? '-'}</TableCell>
                    <TableCell className="text-right">{o.item_count}</TableCell>
                    <TableCell className="text-right">{o.total_quantity}</TableCell>
                    <TableCell className="text-right font-semibold">${o.total_cost.toFixed(2)}</TableCell>
                    <TableCell>
                      {o.status === 'Recibido' ? (
                        <Badge variant="outline" className="text-success">Recibido</Badge>
                      ) : (
                        <Badge variant="outline" className="text-warning">Pendiente</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openDetail(o)}>Ver</Button>
                        {o.status !== 'Recibido' && (
                          <Button variant="outline" size="sm" className="text-success" onClick={() => receive(o)}>
                            <Truck className="size-3.5" /> Recibido
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-danger" onClick={() => setDeleting(o)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo Pedido</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Proveedor</label>
              <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Nombre del proveedor..." />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Buscar producto</label>
              <Input value={productQuery} onChange={e => setProductQuery(e.target.value)}
                placeholder="Buscar producto para agregar..." />
              {suggestions.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {suggestions.map(p => (
                    <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0 transition-colors"
                      onClick={() => addToCart(p)}>
                      <span className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</span>
                      <span className="text-muted-foreground text-xs ml-2">
                        Stock: {p.stock} · Costo: ${(p.price_cost || p.price_sale).toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {cart.length > 0 && (
              <div className="rounded-md border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="w-24">Cant</TableHead>
                      <TableHead className="w-24 text-right">Precio</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.map((i, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm">{i.name}</TableCell>
                        <TableCell>
                          <Input type="number" min={1} className="h-8" value={i.qty}
                            onChange={e => setCart(c => c.map((x, j) => j === idx ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x))} />
                        </TableCell>
                        <TableCell className="text-right text-sm">${i.price.toFixed(2)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-danger"
                            onClick={() => setCart(c => c.filter((_, j) => j !== idx))}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between px-4 py-2 border-t border-border/60 text-sm">
                  <span className="text-muted-foreground">{cart.reduce((a, i) => a + i.qty, 0)} unidades</span>
                  <span className="font-bold">Total: ${totalCart.toFixed(2)}</span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Notas (opcional)</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones del pedido..." />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={saveOrder} disabled={saving || cart.length === 0}>
              <PackagePlus className="size-4" /> Guardar Pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailOrder} onOpenChange={() => setDetailOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pedido #{detailOrder?.id} — {detailOrder?.supplier ?? 'Sin proveedor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Fecha: {detailOrder?.order_date?.slice(0, 16) ?? '-'} · Estado:{' '}
              <Badge variant="outline" className={detailOrder?.status === 'Recibido' ? 'text-success' : 'text-warning'}>
                {detailOrder?.status}
              </Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cant</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailItems.map(it => (
                  <TableRow key={it.id}>
                    <TableCell className="text-sm">{it.product_name ?? '-'}</TableCell>
                    <TableCell className="text-right">{it.quantity}</TableCell>
                    <TableCell className="text-right">${it.unit_price.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">${(it.quantity * it.unit_price).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between text-sm font-bold">
              <span>Total</span>
              <span>${(detailItems.reduce((a, i) => a + i.quantity * i.unit_price, 0)).toFixed(2)}</span>
            </div>
            {detailOrder?.status !== 'Recibido' && (
              <Button className="w-full" onClick={() => { receive(detailOrder!); setDetailOrder(null); }}>
                <CheckCircle2 className="size-4" /> Marcar como Recibido (suma al inventario)
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pedido #{deleting?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.status === 'Recibido'
                ? 'Este pedido ya fue recibido y sumó stock al inventario. El registro se eliminará, pero el stock ya descontado no se revierte.'
                : 'El pedido y sus artículos se eliminarán de forma permanente. Esta acción no se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => deleting && remove(deleting)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
