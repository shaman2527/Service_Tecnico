import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import type { Product, Category } from '../types';
import { NewCategoryInline } from './inventory/NewCategoryInline';
import { toast } from 'sonner';

export function ProductForm({ product, categories, onClose, onSaved, onCategoryChanged, defaultCategoryId, canManageCategories = true }: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  /** F65: avisa al inventario que se creó/elegió una categoría (para refrescar el filtro) */
  onCategoryChanged?: () => void;
  /**
   * F65 (2ª vuelta) — la categoría del FILTRO activo de la pestaña Productos. La pestaña abre
   * filtrada en «Pantalla» (regla del local), pero el desplegable arrancaba en `categories[0]`, que
   * por orden alfabético es «Accesorio»: la ficha nacía en la categoría equivocada y, como la tabla
   * seguía filtrada en Pantalla, **parecía que no se había guardado** (y el reintento creaba un
   * duplicado). Ahora el formulario arranca en la categoría que el operario está mirando.
   */
  defaultCategoryId?: number | null;
  /**
   * F65 (2ª vuelta) — crear/corregir categorías es del DUEÑO (`require_owner` en el backend, igual
   * que `add_product`): a la cajera no se le dibuja el botón en vez de dejar que choque contra el
   * mensaje del PIN (la convención del proyecto: «la cajera no ve esos botones»).
   */
  canManageCategories?: boolean;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState<number | null>(
    product?.category_id ?? defaultCategoryId ?? (categories[0]?.id ?? null),
  );
  // F65: las categorías que ve este formulario = las del inventario + las que se crean acá mismo. Se
  // DERIVA del prop (2ª vuelta adversarial) en vez de copiarlo a un estado: copiarlo dejaba un
  // desplegable VACÍO si el formulario se abría antes de que el inventario terminara de leerlas (y la
  // lista nunca se refrescaba después).
  const [creadas, setCreadas] = useState<Category[]>([]);
  const cats = useMemo(
    () => [...categories, ...creadas.filter(c => !categories.some(x => x.id === c.id))],
    [categories, creadas],
  );
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [model, setModel] = useState(product?.model ?? '');
  const [variant, setVariant] = useState(product?.variant ?? '');
  const [compatibility, setCompatibility] = useState('');
  const [priceCost, setPriceCost] = useState(product?.price_cost ?? 0);
  const [priceSale, setPriceSale] = useState(product?.price_sale ?? 0);
  const [priceUsd, setPriceUsd] = useState(product?.price_usd ?? 0);
  const [stock, setStock] = useState(product?.stock ?? 0);
  const [minStock, setMinStock] = useState(product?.min_stock ?? 2);
  const [supplier, setSupplier] = useState(product?.supplier ?? '');
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
    // F65 (2ª vuelta) — el guardado ya NO falla en silencio: `add_product`/`update_product` son del
    // DUEÑO, así que una cajera (o el dueño con la sesión vencida) veía el diálogo quedarse abierto
    // sin un solo mensaje y creía que la ficha estaba cargada (y la volvía a cargar → duplicados).
    if (!name.trim()) {
      toast.error('Falta el nombre', { description: 'El nombre del producto es obligatorio para guardar.' });
      return;
    }
    setSaving(true);
    try {
      const compatList = compatibility.split('/').map(s => s.trim()).filter(Boolean);
      const compatJson = JSON.stringify(compatList);
      if (product) {
        await api.updateProduct(product.id, name, categoryId, brand, model, variant, compatJson, priceCost, priceSale, stock, minStock, priceUsd);
        // el proveedor va por su propio comando (update_product no lo toca)
        if ((product.supplier ?? '') !== supplier.trim()) await api.setProductSupplier(product.id, supplier.trim());
        toast.success(`Producto «${name.trim()}» actualizado`);
      } else {
        const id = await api.addProduct(name, categoryId, brand, model, variant, compatJson, priceCost, priceSale, stock, minStock, priceUsd);
        if (supplier.trim()) await api.setProductSupplier(id, supplier.trim());
        toast.success(`Producto «${name.trim()}» guardado`);
      }
      onSaved();
    } catch (e) {
      toast.error('No se pudo guardar el producto', { description: String(e) });
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
                <SelectTrigger data-field="categoria"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cats.map(c => (
                    <SelectItem key={c.id} value={String(c.id)} data-categoria-opcion={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* F65: si el repuesto que llegó no entra en ninguna categoría, se crea acá mismo y
                  queda elegida en este producto (no hay que salir del formulario ni perder lo escrito). */}
              {canManageCategories && (
                <NewCategoryInline
                  existing={cats}
                  onCreated={c => {
                    setCreadas(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c]));
                    setCategoryId(c.id);
                    onCategoryChanged?.();
                  }}
                />
              )}
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

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="product-supplier">Proveedor</label>
            <Input
              id="product-supplier"
              value={supplier}
              onChange={e => setSupplier(e.target.value)}
              placeholder="Quién trajo esta mercancía (lo anota la carga de inventario)"
            />
            <p className="text-xs text-muted-foreground">
              Se llena solo al cargar el inventario del local; acá lo podés corregir.
            </p>
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
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Guardando...' : (product ? 'Actualizar' : 'Guardar Producto')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
