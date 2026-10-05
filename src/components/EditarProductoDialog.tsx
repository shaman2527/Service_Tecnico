import { useEffect, useMemo, useState } from 'react';
import { Banknote, Package, Plus, Pencil, Save, Smartphone, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CompatModelPicker } from './CompatModelPicker';
import { api } from '../db';
import { toast } from 'sonner';
import { ProductForm } from './ProductForm';
import {
  agregarModelo, argsUpdateProduct, compatDesdeCrudo, compatSiCambio, compatTexto, fichaConNombre,
  nombreDePantallaNueva, patchTieneCambios, tieneModelo, type FichaProducto,
} from '@/lib/product-edit';
import type { Category, Product } from '../types';

/**
 * F80 — EDITAR LA FICHA DEL REPUESTO **DESDE EL WIZARD** (el lápiz de la lista de pantallas).
 *
 * Pedido del dueño: «cuando se hace un registro, para elegir un producto desde el wizard, algo pequeño
 * — un icono — poder editarla ahí mismo… cambiarle el precio, etc. Así el registro va depurando, va
 * cargando el inventario». Y al confirmar el alcance: «que también pueda editar la compatibilidad, se
 * refleje en el inventario la edición» + «que me sirva, carga también nuevos stock».
 *
 * Este diálogo es CORTO a propósito (lo que se toca en el mostrador):
 *   Venta ($) · Efectivo ($) · Stock · Compatibilidad
 * y deja el resto (nombre, categoría, marca, modelo, variante, costo, stock mínimo, proveedor) al
 * formulario COMPLETO de Inventario (`ProductForm`), que se abre desde acá mismo con lo ya escrito
 * aplicado: un solo editor en el sistema, sin copias.
 *
 * Con `producto = null` el mismo diálogo sirve para REGISTRAR la pantalla que falta (nace con el
 * nombre y la compatibilidad de ese modelo, y con su stock): así el registro va cargando el catálogo.
 *
 * Reglas de dinero que respeta: el monto de la orden NO se toca desde acá (el wizard ofrece el precio
 * nuevo con un toque, como en F67); el stock se escribe directo, igual que en Inventario; y los campos
 * que el operario no toca viajan IDÉNTICOS (los arma `argsUpdateProduct`, con prueba pura).
 */
export function EditarProductoDialog({ producto, modeloDelEquipo, categories, categoriaSugeridaId, puedeCategorias = false, onClose, onSaved }: {
  /** La ficha que se está editando; `null` = alta de una pantalla nueva (la que falta para el modelo) */
  producto: Product | null;
  /** El modelo del equipo en el wizard: se ofrece para sumarlo a la compatibilidad y nombra la pantalla nueva */
  modeloDelEquipo: string;
  categories: Category[];
  /** Categoría con la que nace una pantalla nueva (la del padrón de pantallas del taller) */
  categoriaSugeridaId: number | null;
  puedeCategorias?: boolean;
  onClose: () => void;
  /** Avisa al wizard que la ficha cambió: recarga la compatibilidad (y el inventario se refresca solo por el bus) */
  onSaved: (id: number) => void;
}) {
  const esAlta = producto == null;
  /**
   * F80 — LA FILA VIVA. La copia que llega desde la lista puede estar VIEJA (el buscador libre no se
   * vuelve a pedir, y cada equipo de la misma recepción tiene su propia lista): armar los 12 argumentos
   * de `update_product` con ella REVIERTE en silencio lo que otro camino acaba de guardar — el
   * hallazgo BLOQUEANTE de la revisión adversarial (subía el precio a $25, después corregía la
   * compatibilidad y el segundo guardado devolvía el precio a $20). Se RELEE al abrir y otra vez antes
   * de escribir: es la misma regla que ya sigue el guardado de órdenes (`actualizarEquiposCreados`).
   */
  const [viva, setViva] = useState<Product | null>(producto);
  useEffect(() => {
    if (!producto?.id) { setViva(null); return; }
    let vivo = true;
    api.getProduct(producto.id).then(p => { if (vivo) setViva(p); }).catch(() => {});
    return () => { vivo = false; };
  }, [producto?.id]);

  /**
   * La compatibilidad con la que ARRANCA el diálogo: la de la ficha (texto «A / B») o —en el alta— el
   * modelo del equipo, porque la pantalla que se registra desde acá nace sirviendo para ESE teléfono
   * (lo cazó la prueba en vivo: sin esto nacía con la compatibilidad vacía y no aparecía en la lista).
   */
  const compatInicial = (p: Product | null) => (p ? compatTexto(compatDesdeCrudo(p.compatibility)) : modeloDelEquipo.trim());
  const [nombre, setNombre] = useState(producto?.name ?? nombreDePantallaNueva(modeloDelEquipo));
  const [categoryId, setCategoryId] = useState<number | null>(
    producto?.category_id ?? categoriaSugeridaId ?? (categories[0]?.id ?? null),
  );
  const [venta, setVenta] = useState(producto?.price_sale ?? 0);
  const [efectivo, setEfectivo] = useState(producto?.price_usd ?? 0);
  const [stock, setStock] = useState(producto?.stock ?? 0);
  const [compat, setCompat] = useState(compatInicial(producto));
  const [saving, setSaving] = useState(false);
  /** «Ficha completa» reemplaza la vista (no se apilan dos diálogos): su Cancelar vuelve al atajo. */
  const [verFichaCompleta, setVerFichaCompleta] = useState(false);
  /** F80: la ficha del catálogo que ya tiene el nombre que se está por crear (no se duplica el bin). */
  const [existente, setExistente] = useState<Product | null>(null);

  // Al cambiar de ficha (el operario tocó el lápiz de otra fila), o cuando llega la RELECTURA, el
  // diálogo se rearma con los datos de la fila viva.
  useEffect(() => {
    const base = viva ?? producto;
    setNombre(base?.name ?? nombreDePantallaNueva(modeloDelEquipo));
    setCategoryId(base?.category_id ?? categoriaSugeridaId ?? (categories[0]?.id ?? null));
    setVenta(base?.price_sale ?? 0);
    setEfectivo(base?.price_usd ?? 0);
    setStock(base?.stock ?? 0);
    setCompat(compatInicial(base));
    setVerFichaCompleta(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto?.id, esAlta, viva?.id, viva?.updated_at]);

  /**
   * F80 — LA CATEGORÍA DEL ALTA (bloqueante de la 2ª revisión adversarial): el diálogo se monta con las
   * categorías que llegan como prop y, si todavía no estaban cargadas, la ficha nacía SIN CATEGORÍA —
   * y como `onlyScreens()` filtra `category_id === 1`, la pantalla recién registrada **no aparecía en la
   * lista del wizard** (ni en el buscador, ni en el padrón) aunque el toast dijera «registrada».
   * El hook que abre el diálogo ahora espera a las categorías; esto es la red por si llegan después.
   */
  useEffect(() => {
    if (!esAlta) return;
    setCategoryId(prev => {
      if (prev != null && categories.some(c => c.id === prev)) return prev;
      return categoriaSugeridaId ?? categories[0]?.id ?? prev;
    });
  }, [esAlta, categories, categoriaSugeridaId]);

  // F80 — ¿ya hay una ficha con ese nombre? Registrar una gemela parte el stock en dos lugares y el
  // descuento de la entrega cae en una sola (el proyecto ya trata los duplicados como problema: F53).
  useEffect(() => {
    if (!esAlta) { setExistente(null); return; }
    const q = nombre.trim();
    if (q.length < 4) { setExistente(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      api.getProducts(q).then(list => { if (vivo) setExistente(fichaConNombre(list, q)); }).catch(() => {});
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [esAlta, nombre]);

  const listaCompat = useMemo(() => compatDesdeCrudo(compat), [compat]);
  const modeloYaEsta = tieneModelo(listaCompat, modeloDelEquipo);
  const puedeAgregarModelo = !esAlta && !modeloYaEsta && !!modeloDelEquipo.trim();

  const patch = { priceSale: venta, priceUsd: efectivo, stock, compatibility: compat };
  /** La fila del catálogo (`brand`/`model` pueden venir null) como ficha de trabajo de las reglas puras. */
  const aFicha = (p: Product): FichaProducto => ({
    id: p.id, name: p.name, category_id: p.category_id ?? null,
    brand: p.brand ?? '', model: p.model ?? '', variant: p.variant ?? '',
    compatibility: p.compatibility ?? '', price_cost: p.price_cost ?? 0,
    price_sale: p.price_sale ?? 0, stock: p.stock ?? 0,
    min_stock: p.min_stock ?? 0, price_usd: p.price_usd ?? 0,
  });
  const filaViva = viva ?? producto;
  const ficha: FichaProducto | null = filaViva ? aFicha(filaViva) : null;
  const hayCambios = esAlta
    ? nombre.trim().length > 0 && !existente && categoryId != null
    : (ficha ? patchTieneCambios(ficha, patch) : false);

  const sumarModelo = () => {
    const r = agregarModelo(listaCompat, modeloDelEquipo);
    setCompat(compatTexto(r.lista));
    toast.success(r.agregado
      ? `«${modeloDelEquipo.trim()}» agregado a la compatibilidad`
      : `«${modeloDelEquipo.trim()}» ya estaba en la compatibilidad`);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (esAlta) {
        const id = await api.addProduct(
          nombre.trim(), categoryId, '', modeloDelEquipo.trim(), '',
          JSON.stringify(listaCompat), 0, venta, stock, 2, efectivo,
        );
        toast.success(`Pantalla «${nombre.trim()}» registrada con ${stock} en stock`);
        onSaved(id);
      } else {
        // RELECTURA ANTES DE ESCRIBIR (hallazgo BLOQUEANTE): si la ficha cambió desde que se abrió el
        // diálogo —o si el operario la editó desde otra fila/equipo y esa lista quedó vieja—, los 12
        // argumentos se arman con lo que hay AHORA en la base + lo que él tocó acá. Nunca con la copia.
        const fresca = await api.getProduct(producto!.id).catch(() => null);
        if (!fresca) {
          toast.error('Esa ficha ya no está en el catálogo', { description: 'Se borró desde otra pantalla: elegí otra pantalla para el equipo.' });
          onClose();
          return;
        }
        const args = argsUpdateProduct(aFicha(fresca), {
          priceSale: venta,
          priceUsd: efectivo,
          stock,
          // Solo si el operario la cambió: una ficha con compatibilidad en formato viejo no se
          // reescribe por corregirle el precio (invariante «lo que no se toca viaja tal cual»).
          compatibility: compatSiCambio(aFicha(fresca), compat),
        });
        const red = await api.updateProduct(...args);
        toast.success(`Ficha «${fresca.name}» actualizada`);
        // F93 — la red de compatibilidad se sincroniza: se dice qué otras fichas se ajustaron.
        if ((red ?? []).length > 0) {
          toast.info(`Se sincronizó la red: ${red!.length} ficha${red!.length === 1 ? '' : 's'} más`,
            { description: red!.map(c => `«${c.name}»: ${c.antes} → ${c.despues}`).join(' · '), duration: 9000 });
        }
        onSaved(fresca.id);
      }
    } catch (e) {
      // Nunca mudo: `add_product`/`update_product` son del DUEÑO, así que una sesión sin permiso
      // (o un error del backend) tiene que decirse, no dejar el diálogo abierto sin explicación.
      toast.error(esAlta ? 'No se pudo registrar la pantalla' : 'No se pudo actualizar la ficha', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Ficha completa: el MISMO formulario de Inventario, con lo ya escrito aplicado ──────────────
  if (verFichaCompleta && producto) {
    return (
      <ProductForm
        product={{
          ...(viva ?? producto),
          price_sale: venta,
          price_usd: efectivo,
          stock,
          compatibility: JSON.stringify(listaCompat),
        }}
        categories={categories}
        canManageCategories={puedeCategorias}
        /* F80: desde el wizard NO se borra la ficha (la pantalla elegida quedaría apuntando a la nada
           y la ENTREGA fallaría); para borrar está Inventario. */
        permiteEliminar={false}
        /* F80: Cancelar/Escape de la ficha completa VUELVE al atajo con lo escrito intacto (antes
           cerraba todo y se perdía el precio recién cargado). */
        onClose={() => setVerFichaCompleta(false)}
        onSaved={() => onSaved(producto.id)}
      />
    );
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      {/* F86 (REQ-8/AC-11) — mismo patrón de la casa que `ProductForm`: con la ventana de 750 px de
          alto el contenido de la ficha se salía y el pie («Guardar ficha») quedaba fuera de la
          pantalla; acá el encabezado y el pie quedan fijos y el cuerpo se desplaza. */}
      <DialogContent className="sm:max-w-lg max-h-[92vh] flex flex-col overflow-hidden" data-editar-producto-corta={esAlta ? 'alta' : producto!.id}>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            {esAlta ? <Plus className="size-4 text-primary" /> : <Pencil className="size-4 text-primary" />}
            {esAlta
              ? (modeloDelEquipo.trim() ? `Registrar la pantalla de ${modeloDelEquipo.trim()}` : 'Registrar una pantalla nueva')
              : 'Editar esta pantalla'}
          </DialogTitle>
          {!esAlta && (
            <p className="text-xs text-muted-foreground" data-ficha-actual={producto!.name}>
              {producto!.name}
              {producto!.variant ? ` · ${producto!.variant}` : ''}
            </p>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          {esAlta && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Nombre *</label>
              <Input value={nombre} data-field="prod-nombre" onChange={e => setNombre(e.target.value)} />
              <div className="flex items-center gap-2">
                <Select value={String(categoryId ?? '')} onValueChange={v => setCategoryId(v ? Number(v) : null)}>
                  <SelectTrigger className="h-8 w-52 text-xs" data-field="prod-categoria"><SelectValue placeholder="Categoría" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  {modeloDelEquipo.trim()
                    ? <>Nace compatible con <strong>{modeloDelEquipo.trim()}</strong> y con su stock.</>
                    : 'Nace sin compatibilidad: escribile abajo los teléfonos que le sirven.'}
                </span>
              </div>
              {categoryId == null && (
                <p className="text-[11px] text-danger" data-falta-categoria>
                  Elegí una categoría: una pantalla fuera del padrón (Pantalla) no aparece en esta lista.
                </p>
              )}
            </div>
          )}

          {/* Lo que el mostrador toca todos los días: plata y unidades. */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Banknote className="size-3.5 text-muted-foreground" /> Venta ($)
              </label>
              <Input type="number" step={0.01} min={0} value={venta} data-field="prod-venta"
                aria-label="Precio de venta de la ficha"
                onChange={e => setVenta(Number(e.target.value))} />
              <p className="text-[11px] text-muted-foreground">Precio de lista (el que se imprime).</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Efectivo ($)</label>
              <Input type="number" step={0.01} min={0} value={efectivo} data-field="prod-efectivo"
                aria-label="Precio de contado de la ficha"
                onChange={e => setEfectivo(Number(e.target.value))} />
              <p className="text-[11px] text-muted-foreground">Contado: es el que se toma con efectivo.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Package className="size-3.5 text-muted-foreground" /> Stock
              </label>
              <Input type="number" min={0} value={stock} data-field="prod-stock"
                aria-label="Stock de la ficha"
                onChange={e => setStock(Math.max(0, Number(e.target.value)))} />
              <p className="text-[11px] text-muted-foreground">Unidades que quedan en el cajón.</p>
            </div>
          </div>

          {/* F80 — LA COMPATIBILIDAD, acá mismo: es lo que hace que el registro «depure» el catálogo.
              F91 — y se edita con la LISTA DE MODELOS del padrón (no con texto libre): el dueño pidió
              unificar en un solo lugar las compatibilidades, y ese lugar es esta lista. */}
          <div className="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Smartphone className="size-3.5 text-muted-foreground" /> Compatibilidad
                <span className="font-normal text-xs text-muted-foreground">(los teléfonos que llevan esta pantalla)</span>
              </label>
              {puedeAgregarModelo && (
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[11px]"
                  data-action="prod-agregar-modelo" onClick={sumarModelo}>
                  <Plus className="size-3" /> Agregar «{modeloDelEquipo.trim()}»
                </Button>
              )}
            </div>
            <CompatModelPicker value={compat} onChange={setCompat} maximaAltura />
            {modeloYaEsta && (
              <p className="text-[11px] text-emerald-600" data-compat-ok>
                «{modeloDelEquipo.trim()}» ya figura en la compatibilidad de esta pantalla.
              </p>
            )}
          </div>

          <Alert className="border-primary/30 bg-primary/5 py-2">
            <AlertDescription className="text-[11px] text-muted-foreground">
              {esAlta
                ? 'Nace con costo $0 y stock mínimo 2: el costo y el proveedor se completan después en Inventario.'
                : 'Lo que no toques queda igual (nombre, marca, modelo, costo, stock mínimo, proveedor). Si el monto de la orden lo había puesto el precio de la pantalla, deja de seguirlo: el wizard te OFRECE el precio nuevo con un toque (si lo escribiste a mano, no se toca).'}
            </AlertDescription>
          </Alert>

          {/* F80 — no crear fichas GEMELAS: dos fichas con el mismo nombre parten el stock en dos
              lugares y el descuento de la entrega cae en una sola. */}
          {esAlta && existente && (
            <Alert className="border-amber-500/40 bg-amber-500/10 py-2" data-producto-existente={existente.id}>
              <AlertTriangle className="size-4 text-warning" />
              <AlertDescription className="text-[11px] text-amber-800">
                Ya existe <strong>«{existente.name}»</strong> en el catálogo (stock {existente.stock}).
                Para no partir el stock en dos: cerrá esto, buscá esa pantalla en el buscador de abajo
                y corregila con su lápiz — o cambiale el nombre a esta si es otra variante.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3 gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {!esAlta && (
            <Button variant="outline" data-action="prod-ficha-completa"
              title="Abrir el formulario completo de Inventario con lo que escribiste acá"
              onClick={() => setVerFichaCompleta(true)}>
              <Pencil className="size-3.5" /> Ficha completa
            </Button>
          )}
          <Button onClick={save} disabled={saving || !hayCambios} data-action="prod-guardar"
            title={hayCambios ? 'Guardar la ficha' : 'No cambiaste nada todavía'}>
            <Save className="size-3.5" /> {saving ? 'Guardando…' : (esAlta ? 'Registrar pantalla' : 'Guardar ficha')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
