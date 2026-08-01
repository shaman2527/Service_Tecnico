import { useEffect, useState } from 'react';
import { Plus, Search, MoveHorizontal, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import type { Product, Category, InventoryMovement } from '../types';
import { ProductForm } from './ProductForm';

export default function Inventory() {
  const [tab, setTab] = useState<'inventario' | 'movimientos'>('inventario');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<number | ''>(''); // default: todas
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [movementProduct, setMovementProduct] = useState<Product | null>(null);
  const [movementType, setMovementType] = useState<'entrada' | 'salida'>('entrada');
  const [movementQty, setMovementQty] = useState(1);
  const [movementReason, setMovementReason] = useState('Ajuste');

  const load = async () => {
    const [p, c] = await Promise.all([
      api.getProducts(search, catFilter || null),
      api.getCategories(),
    ]);
    setProducts(p);
    setCategories(c);
  };

  const loadMovements = async () => {
    setMovements(await api.getInventoryMovements(90));
  };

  const saveMovement = async () => {
    if (!movementProduct) return;
    await api.addInventoryMovement(movementProduct.id, movementType, movementQty, movementReason, '');
    setMovementProduct(null);
    load();
    if (tab === 'movimientos') loadMovements();
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [search, catFilter]);
  useEffect(() => { if (tab === 'movimientos') loadMovements(); }, [tab]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm text-muted-foreground mt-1">Productos, compatibilidad y movimientos</p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'inventario' ? 'default' : 'outline'} onClick={() => setTab('inventario')}>
            <Package className="size-4" /> Productos
          </Button>
          <Button variant={tab === 'movimientos' ? 'default' : 'outline'} onClick={() => setTab('movimientos')}>
            <MoveHorizontal className="size-4" /> Movimientos
          </Button>
          <Button onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="size-4" /> Nuevo Producto
          </Button>
        </div>
      </div>

      {tab === 'inventario' && (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Buscar producto..." className="pl-9"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={String(catFilter)} onValueChange={v => setCatFilter(v ? Number(v) : '')}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Todas las categorías" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todas las categorías</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Cat.</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Variante</TableHead>
                    <TableHead>Compatibilidad</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Venta</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Stock Mín</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                        Sin productos registrados
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</TableCell>
                        <TableCell>{p.category_name ?? '-'}</TableCell>
                        <TableCell>{p.brand ?? '-'}</TableCell>
                        <TableCell>{p.model ?? '-'}</TableCell>
                        <TableCell className="text-xs">{p.variant ?? '-'}</TableCell>
                        <TableCell className="max-w-[200px] text-xs">
                          {p.compatibility ? (() => {
                            try {
                              const list = JSON.parse(p.compatibility);
                              if (!Array.isArray(list) || list.length === 0) return <span className="text-muted-foreground">-</span>;
                              return (
                                <span className="text-muted-foreground">
                                  {list.slice(0, 3).join(' / ')}
                                  {list.length > 3 ? <span className="text-primary ml-1">+{list.length - 3}</span> : ''}
                                </span>
                              );
                            } catch { return <span className="text-muted-foreground">{p.compatibility}</span>; }
                          })() : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-right">${p.price_cost.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${p.price_sale.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <span className={p.stock <= p.min_stock ? 'text-danger font-bold' : ''}>
                            {p.stock}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{p.min_stock}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm"
                              onClick={() => { setEditing(p); setShowForm(true); }}>
                              Editar
                            </Button>
                            <Button variant="outline" size="sm"
                              onClick={() => {
                                setMovementProduct(p);
                                setMovementType('entrada');
                                setMovementQty(1);
                                setMovementReason('Ajuste');
                              }}>
                              Mov.
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
        </>
      )}

      {tab === 'movimientos' && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      Sin movimientos registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map(m => (
                    <TableRow key={m.id}>
                      <TableCell>{m.date ?? '-'}</TableCell>
                      <TableCell className="font-medium">{m.product_name ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={m.type === 'entrada' ? 'default' : 'destructive'}>
                          {m.type?.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{m.quantity}</TableCell>
                      <TableCell>{m.reason ?? '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{m.reference ?? '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <ProductForm
          product={editing}
          categories={categories}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}

      <Dialog open={!!movementProduct} onOpenChange={() => setMovementProduct(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Movimiento de Inventario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Producto: <strong>{movementProduct?.name}</strong>
              {movementProduct && <span className="ml-2">Stock actual: {movementProduct.stock}</span>}
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo</label>
              <Select value={movementType} onValueChange={v => setMovementType(v as 'entrada' | 'salida')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada (+)</SelectItem>
                  <SelectItem value="salida">Salida (-)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cantidad</label>
              <Input type="number" min={1} value={movementQty}
                onChange={e => setMovementQty(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Motivo</label>
              <Input value={movementReason} onChange={e => setMovementReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementProduct(null)}>Cancelar</Button>
            <Button onClick={saveMovement}>Registrar Movimiento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
