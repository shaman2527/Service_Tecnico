import { useEffect, useState } from 'react';
import { Search, Smartphone, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../db';
import type { Product, Category } from '../types';
import { ProductForm } from './ProductForm';

function parseCompat(compat: string | null): string[] {
  if (!compat) return [];
  try {
    const list = JSON.parse(compat);
    return Array.isArray(list) ? list.map((s: unknown) => String(s)).filter(Boolean) : [];
  } catch {
    return compat.split('/').map(s => s.trim()).filter(Boolean);
  }
}

export default function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<number | ''>(1);
  const [editing, setEditing] = useState<Product | null>(null);

  const load = async () => {
    const [p, c] = await Promise.all([
      api.getProducts('', null),
      api.getCategories(),
    ]);
    setProducts(p);
    setCategories(c);
  };

  useEffect(() => { load(); }, []);

  const q = search.trim().toLowerCase();
  const filtered = q.length === 0
    ? products
    : products.filter(p => {
        const compat = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
        const hay = [p.name, p.brand ?? '', p.model ?? '', p.variant ?? '', ...compat].join(' ').toLowerCase();
        return hay.includes(q);
      });

  const shown = catFilter === '' ? filtered : filtered.filter(p => p.category_id === catFilter);

  const total = shown.length;
  const withCompat = shown.filter(p => parseCompat(p.compatibility).length > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pantallas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Busca por nombre de pantalla o por modelo de teléfono para ver qué pantalla le sirve
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Ej: Redmi Note 11, Samsung A32, iPhone 13..." className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={String(catFilter)} onValueChange={v => setCatFilter(v ? Number(v) : '')}>
          <SelectTrigger className="w-48">
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
                <TableHead>Pantalla</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead className="text-right">Venta</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Modelos Compatibles</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Sin resultados. Prueba otro término de búsqueda.
                  </TableCell>
                </TableRow>
              ) : (
                shown.map(p => {
                  const compat = parseCompat(p.compatibility);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</TableCell>
                      <TableCell>{p.brand ?? '-'}</TableCell>
                      <TableCell>{p.model ?? '-'}</TableCell>
                      <TableCell className="text-xs">{p.variant ?? '-'}</TableCell>
                      <TableCell className="text-right">${p.price_sale.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <span className={p.stock <= p.min_stock ? 'text-danger font-bold' : ''}>
                          {p.stock}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        {compat.length === 0 ? (
                          <span className="text-muted-foreground text-sm">Sin compatibilidad registrada</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 py-1">
                            {compat.map(m => (
                              <Badge key={m} variant="outline" className="text-xs font-normal">
                                {m}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm"
                          onClick={() => setEditing(p)}>
                          <Pencil className="size-3.5" /> Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {shown.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Smartphone className="size-3.5" /> {total} pantallas
          </span>
          <span>{withCompat} con compatibilidad</span>
        </div>
      )}

      {editing && (
        <ProductForm
          product={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
