import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import type { Product, Category } from '../types';

export function ProductForm({ product, categories, onClose, onSaved }: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState<number | null>(product?.category_id ?? (categories[0]?.id ?? null));
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [model, setModel] = useState(product?.model ?? '');
  const [variant, setVariant] = useState(product?.variant ?? '');
  const [compatibility, setCompatibility] = useState('');
  const [priceCost, setPriceCost] = useState(product?.price_cost ?? 0);
  const [priceSale, setPriceSale] = useState(product?.price_sale ?? 0);
  const [priceUsd, setPriceUsd] = useState(product?.price_usd ?? 0);
  const [stock, setStock] = useState(product?.stock ?? 0);
  const [minStock, setMinStock] = useState(product?.min_stock ?? 2);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product?.compatibility) {
      try {
        const list = JSON.parse(product.compatibility);
        setCompatibility(Array.isArray(list) ? list.join(' / ') : product.compatibility);
      } catch {
        setCompatibility(product.compatibility);
      }
    }
  }, [product]);

  // Vista previa de la compatibilidad tal como se va a guardar (chips, sin repetidos)
  const compatPreview = useMemo(
    () => [...new Set(compatibility.split('/').map(s => s.trim()).filter(Boolean))].slice(0, 12),
    [compatibility],
  );

  const save = async () => {
    if (!name) return;
    setSaving(true);
    try {
      const compatList = compatibility.split('/').map(s => s.trim()).filter(Boolean);
      const compatJson = JSON.stringify(compatList);
      if (product) {
        await api.updateProduct(product.id, name, categoryId, brand, model, variant, compatJson, priceCost, priceSale, stock, minStock, priceUsd);
      } else {
        await api.addProduct(name, categoryId, brand, model, variant, compatJson, priceCost, priceSale, stock, minStock, priceUsd);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{product ? `Editar: ${product.name}` : 'Nuevo Producto'}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {product
              ? product.created_at
                ? <>Agregado el <strong>{product.created_at.slice(0, 10)}</strong> — la fecha se guarda automáticamente al crear.</>
                : 'Producto sin fecha de registro (migrado antes de esta versión).'
              : <>Se guardará con la fecha de hoy (automática).</>}
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Nombre *</label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Categoría</label>
              <Select value={String(categoryId ?? '')} onValueChange={v => setCategoryId(v ? Number(v) : null)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Marca</label>
              <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Xiaomi, Samsung, Tecno…" />
              <p className="text-xs text-muted-foreground">Se guarda normalizada (Lg→LG, Redmi→Xiaomi, Iphone→Apple).</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Modelo</label>
              <Input value={model} onChange={e => setModel(e.target.value)} placeholder="Hot 40i, A06 4G…" />
              <p className="text-xs text-muted-foreground">Teléfono PRINCIPAL de la ficha.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Variante</label>
              <Input value={variant} onChange={e => setVariant(e.target.value)} placeholder="INCELL, OLED…" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Compatibilidad</label>
            <p className="text-xs text-muted-foreground">
              Teléfonos separados por <strong>/</strong>. Se guardan con su marca (ej. <em>Honor X7</em>) y sin repetidos,
              así la lista de modelos no duplica el mismo teléfono.
            </p>
            <Textarea value={compatibility} onChange={e => setCompatibility(e.target.value)}
              placeholder="Redmi Note 11 / Redmi Note 11S / Redmi Note 11 Pro" />
            {compatPreview.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {compatPreview.map(m => (
                  <Badge key={m} variant="outline" className="text-[11px] font-normal">{m}</Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Costo ($)</label>
              <Input type="number" step={0.01} min={0} value={priceCost}
                onChange={e => setPriceCost(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Venta ($)</label>
              <Input type="number" step={0.01} min={0} value={priceSale}
                onChange={e => setPriceSale(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Efectivo ($)</label>
              <Input type="number" step={0.01} min={0} value={priceUsd}
                onChange={e => setPriceUsd(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">Precio contado / descuento</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Stock</label>
              <Input type="number" min={0} value={stock}
                onChange={e => setStock(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Stock Mín</label>
              <Input type="number" min={0} value={minStock}
                onChange={e => setMinStock(Number(e.target.value))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {product && (
            <Button variant="destructive" onClick={async () => {
              if (confirm(`¿Eliminar '${product.name}'?`)) {
                await api.deleteProduct(product.id);
                onSaved();
              }
            }}>Eliminar</Button>
          )}
          <Button onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : (product ? 'Actualizar' : 'Guardar Producto')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
